import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type {
  SendStatus,
  StoAgreementSend,
  StoAgreementVersion,
  StoVersionRate,
  StoVersionSection,
  StoVersionSupplement,
  StoVersionWithRates,
} from '../lib/database.types'

/**
 * The STO rate agreement: one version a season, sent to many operators.
 *
 * Separate from useCrmData because nothing else in the CRM reads it, and
 * because a version is not a per-company record — it is the house's own
 * document, and every hook in here treats it that way.
 */

/** Public bucket, so an operator can open the rate sheet from an email. */
const STO_BUCKET = 'sto'

/** One rate line as the editor holds it, before the database gives it an id. */
export interface RateInput {
  season: string
  room_type: string
  description: string | null
  bb_price: number
  hb_price: number
  fb_price: number
  max_occupancy: number
  currency: string
}

export type SupplementInput = Omit<StoVersionSupplement, 'id' | 'version_id' | 'sort_order'>
export type SectionInput = Omit<StoVersionSection, 'id' | 'version_id' | 'sort_order'>

/** Everything printed under the header, saved and replaced as one block. */
export interface VersionBody {
  rates: RateInput[]
  supplements: SupplementInput[]
  sections: SectionInput[]
}

export function useStoVersions() {
  const [versions, setVersions] = useState<StoVersionWithRates[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('sto_agreement_versions')
      .select('*')
      .order('year', { ascending: false })
      .order('created_at', { ascending: false })

    if (error) {
      setError(error.message)
      setVersions([])
      setLoading(false)
      return
    }

    const rows = (data ?? []) as StoAgreementVersion[]
    let rates: StoVersionRate[] = []
    let supplements: StoVersionSupplement[] = []
    let sections: StoVersionSection[] = []

    if (rows.length > 0) {
      // Four tables, one hook: a rate sheet is never useful in pieces — the
      // list, the document and the reports all read the whole contract — and
      // three `in` queries beat a request per version.
      const ids = rows.map((v) => v.id)
      const [rateData, supplementData, sectionData] = await Promise.all([
        supabase.from('sto_version_rates').select('*').in('version_id', ids).order('sort_order'),
        supabase
          .from('sto_version_supplements')
          .select('*')
          .in('version_id', ids)
          .order('sort_order'),
        supabase.from('sto_version_sections').select('*').in('version_id', ids).order('sort_order'),
      ])
      rates = (rateData.data ?? []) as StoVersionRate[]
      supplements = (supplementData.data ?? []) as StoVersionSupplement[]
      sections = (sectionData.data ?? []) as StoVersionSection[]
    }

    setError(null)
    setVersions(
      rows.map((v) => ({
        ...v,
        rates: rates.filter((r) => r.version_id === v.id),
        supplements: supplements.filter((r) => r.version_id === v.id),
        sections: sections.filter((r) => r.version_id === v.id),
      }))
    )
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  /**
   * Replace everything printed under the header, in order.
   *
   * Deleted and re-inserted rather than diffed: a contract is edited as a
   * block, and nothing points at an individual line — a send references the
   * version, never a row inside it.
   */
  async function saveBody(versionId: string, body: VersionBody) {
    const tables = [
      ['sto_version_rates', body.rates],
      ['sto_version_supplements', body.supplements],
      ['sto_version_sections', body.sections],
    ] as const

    for (const [table, entries] of tables) {
      const { error: clearError } = await supabase
        .from(table)
        .delete()
        .eq('version_id', versionId)
      if (clearError) throw clearError

      if (entries.length === 0) continue
      const { error: insertError } = await supabase
        .from(table)
        .insert(entries.map((entry, index) => ({ ...entry, version_id: versionId, sort_order: index })))
      if (insertError) throw insertError
    }
  }

  async function createVersion(input: Partial<StoAgreementVersion>, body: VersionBody) {
    const { data, error } = await supabase
      .from('sto_agreement_versions')
      .insert(input)
      .select()
      .single()
    if (error) throw error
    const version = data as StoAgreementVersion

    // A version with no rates is a header nobody can send, so a failed insert
    // takes the header down with it rather than leaving one behind.
    try {
      await saveBody(version.id, body)
    } catch (err) {
      await supabase.from('sto_agreement_versions').delete().eq('id', version.id)
      throw err
    }

    await refresh()
    return version
  }

  async function updateVersion(
    id: string,
    input: Partial<StoAgreementVersion>,
    body?: VersionBody
  ) {
    const { error } = await supabase
      .from('sto_agreement_versions')
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
    if (body) await saveBody(id, body)
    await refresh()
  }

  async function setVersionStatus(id: string, status: StoAgreementVersion['status']) {
    await updateVersion(id, { status })
  }

  async function deleteVersion(version: StoAgreementVersion) {
    const { error } = await supabase.from('sto_agreement_versions').delete().eq('id', version.id)
    if (error) throw error
    // Best effort: the row is gone either way, and a stranded object is
    // invisible rather than harmful.
    if (version.pdf_path) await supabase.storage.from(STO_BUCKET).remove([version.pdf_path])
    await refresh()
  }

  /**
   * Attach the rate sheet as supplied.
   *
   * A random path keeps the public URL unguessable and means two uploads of the
   * same filename cannot collide. The previous file is removed only after the
   * row points at the new one, so a failure mid-way leaves the old sheet
   * reachable rather than nothing at all.
   */
  async function uploadPdf(version: StoAgreementVersion, file: File) {
    if (file.type !== 'application/pdf') throw new Error('Only PDF files can be uploaded.')

    const storagePath = `${crypto.randomUUID()}.pdf`
    const { error: uploadError } = await supabase.storage
      .from(STO_BUCKET)
      .upload(storagePath, file, { contentType: 'application/pdf', upsert: false })
    if (uploadError) throw uploadError

    const { error } = await supabase
      .from('sto_agreement_versions')
      .update({
        pdf_path: storagePath,
        pdf_name: file.name,
        pdf_size_bytes: file.size,
        updated_at: new Date().toISOString(),
      })
      .eq('id', version.id)

    if (error) {
      await supabase.storage.from(STO_BUCKET).remove([storagePath])
      throw error
    }

    if (version.pdf_path) await supabase.storage.from(STO_BUCKET).remove([version.pdf_path])
    await refresh()
  }

  async function removePdf(version: StoAgreementVersion) {
    const { error } = await supabase
      .from('sto_agreement_versions')
      .update({ pdf_path: null, pdf_name: null, pdf_size_bytes: 0 })
      .eq('id', version.id)
    if (error) throw error
    if (version.pdf_path) await supabase.storage.from(STO_BUCKET).remove([version.pdf_path])
    await refresh()
  }

  return {
    versions,
    loading,
    error,
    refresh,
    createVersion,
    updateVersion,
    setVersionStatus,
    deleteVersion,
    uploadPdf,
    removePdf,
  }
}

/** Permanent public URL for a stored rate sheet — this is what goes to the operator. */
export function stoPdfUrl(path: string) {
  const { data } = supabase.storage.from(STO_BUCKET).getPublicUrl(path)
  return data.publicUrl
}

/** Where the emailed button points. Absolute, because it is read outside the app. */
export const agreementLink = (token: string) => `${window.location.origin}/agreement/${token}`

export function useAgreementSends() {
  const [sends, setSends] = useState<StoAgreementSend[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('sto_agreement_sends')
      .select('*')
      .order('sent_at', { ascending: false })
    if (error) setError(error.message)
    else {
      setError(null)
      setSends((data ?? []) as StoAgreementSend[])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  /**
   * Record a send, and hand back the row.
   *
   * The token is generated by the database, so the link cannot exist before the
   * row does — the caller needs the row back before it can compose the email.
   */
  async function createSend(input: Partial<StoAgreementSend>) {
    const { data, error } = await supabase
      .from('sto_agreement_sends')
      .insert(input)
      .select()
      .single()
    if (error) throw error
    await refresh()
    return data as StoAgreementSend
  }

  async function updateSend(id: string, input: Partial<StoAgreementSend>) {
    const { error } = await supabase
      .from('sto_agreement_sends')
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
    await refresh()
  }

  /**
   * Answer on the operator's behalf — they replied by email, or over the phone.
   *
   * The timestamps are set here rather than left to the public page, so a send
   * marked accepted by a rep reads the same as one accepted on the link.
   */
  async function setSendStatus(id: string, status: SendStatus, respondedName?: string | null) {
    const now = new Date().toISOString()
    await updateSend(id, {
      status,
      accepted_at: status === 'accepted' ? now : null,
      declined_at: status === 'declined' ? now : null,
      viewed_at: status === 'sent' ? null : undefined,
      ...(respondedName !== undefined ? { responded_name: respondedName } : {}),
    })
  }

  async function deleteSend(id: string) {
    const { error } = await supabase.from('sto_agreement_sends').delete().eq('id', id)
    if (error) throw error
    await refresh()
  }

  return { sends, loading, error, refresh, createSend, updateSend, setSendStatus, deleteSend }
}
