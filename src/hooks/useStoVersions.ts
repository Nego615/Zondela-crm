import { useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { invalidate, useSharedResource } from './sharedResource'
import type {
  SendStatus,
  StoAgreementSend,
  StoAgreementVersion,
  StoPropertySection,
  StoSectionImage,
  StoVersionRate,
  StoVersionSupplement,
  StoVersionTerm,
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
  /** The room category it belongs to, when the contract is divided. */
  section_id: string | null
  season: string
  room_type: string
  description: string | null
  pax: number
  bb_price: number
  hb_price: number
  fb_price: number
  bb_rack: number
  hb_rack: number
  fb_rack: number
  max_occupancy: number
  currency: string
}

export type SupplementInput = Omit<StoVersionSupplement, 'id' | 'version_id' | 'sort_order'>
export type TermInput = Omit<StoVersionTerm, 'id' | 'version_id' | 'sort_order'>
export type PropertySectionInput = Omit<StoPropertySection, 'id' | 'version_id' | 'sort_order'>

/**
 * Everything printed under the header, saved and replaced as one block.
 *
 * Room categories are the exception: a rate line points at one and a
 * photograph hangs off one, so they keep their ids and are saved on their own.
 */
export interface VersionBody {
  rates: RateInput[]
  supplements: SupplementInput[]
  terms: TermInput[]
}

const NO_VERSIONS: StoVersionWithRates[] = []
const NO_SENDS: StoAgreementSend[] = []

export function useStoVersions() {
  const {
    data: versions,
    loading,
    error,
    refresh,
  } = useSharedResource(
    'sto_versions',
    NO_VERSIONS,
    useCallback(async () => {
      const { data, error } = await supabase
        .from('sto_agreement_versions')
        .select('*')
        .order('year', { ascending: false })
        .order('created_at', { ascending: false })

      if (error) throw new Error(error.message)

      const rows = (data ?? []) as StoAgreementVersion[]
      let rates: StoVersionRate[] = []
      let supplements: StoVersionSupplement[] = []
      let sections: StoPropertySection[] = []
      let terms: StoVersionTerm[] = []
      let images: StoSectionImage[] = []

      if (rows.length > 0) {
        // Five tables, one hook: a contract is never useful in pieces — the
        // list, the document and the reports all read the whole thing — and a
        // handful of `in` queries beats a request per version.
        const ids = rows.map((v) => v.id)
        const [rateData, supplementData, sectionData, termData] = await Promise.all([
          supabase.from('sto_version_rates').select('*').in('version_id', ids).order('sort_order'),
          supabase
            .from('sto_version_supplements')
            .select('*')
            .in('version_id', ids)
            .order('sort_order'),
          supabase
            .from('sto_version_property_sections')
            .select('*')
            .in('version_id', ids)
            .order('sort_order'),
          supabase.from('sto_version_terms').select('*').in('version_id', ids).order('sort_order'),
        ])
        rates = (rateData.data ?? []) as StoVersionRate[]
        supplements = (supplementData.data ?? []) as StoVersionSupplement[]
        sections = (sectionData.data ?? []) as StoPropertySection[]
        terms = (termData.data ?? []) as StoVersionTerm[]

        if (sections.length > 0) {
          const { data: imageData } = await supabase
            .from('sto_section_images')
            .select('*')
            .in(
              'section_id',
              sections.map((x) => x.id)
            )
            .order('sort_order')
          images = (imageData ?? []) as StoSectionImage[]
        }
      }

      return rows.map((v) => ({
        ...v,
        rates: rates.filter((r) => r.version_id === v.id),
        supplements: supplements.filter((r) => r.version_id === v.id),
        sections: sections
          .filter((r) => r.version_id === v.id)
          .map((section) => ({
            ...section,
            images: images.filter((im) => im.section_id === section.id),
          })),
        terms_list: terms.filter((r) => r.version_id === v.id),
      }))
    }, [])
  )

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
      ['sto_version_terms', body.terms],
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

    await invalidate('sto_versions')
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
    await invalidate('sto_versions')
  }

  /**
   * Copy a contract into a new draft, to be edited into next season's.
   *
   * Everything printed comes across — categories, photographs, rates,
   * supplements, clauses and the PDF. The sends do not: a copy has not been
   * sent to anyone, and its answers would be somebody else's.
   *
   * Files are copied rather than shared. Deleting a photograph or a version
   * removes its object from the bucket, so a shared path would let tidying up
   * the copy strip the original.
   */
  async function duplicateVersion(source: StoVersionWithRates, createdBy: string | null) {
    const copiedPaths: string[] = []

    async function copyObject(path: string, folder: string) {
      const extension = path.split('.').pop() || 'bin'
      const target = `${folder}${crypto.randomUUID()}.${extension}`
      const { error } = await supabase.storage.from(STO_BUCKET).copy(path, target)
      if (error) throw error
      copiedPaths.push(target)
      return target
    }

    const header = without(
      source,
      'id',
      'created_at',
      'updated_at',
      'rates',
      'supplements',
      'sections',
      'terms_list',
      'pdf_path',
      'pdf_name',
      'pdf_size_bytes'
    )
    const { data, error } = await supabase
      .from('sto_agreement_versions')
      .insert({ ...header, name: `${source.name} (copy)`, status: 'draft', created_by: createdBy })
      .select()
      .single()
    if (error) throw error
    const version = data as StoAgreementVersion

    try {
      if (source.pdf_path) {
        const pdfPath = await copyObject(source.pdf_path, '')
        const { error: pdfError } = await supabase
          .from('sto_agreement_versions')
          .update({
            pdf_path: pdfPath,
            pdf_name: source.pdf_name,
            pdf_size_bytes: source.pdf_size_bytes,
          })
          .eq('id', version.id)
        if (pdfError) throw pdfError
      }

      // Categories first, one at a time: a rate line points at its category,
      // so each new id has to be known before the rates can follow.
      const sectionIds = new Map<string, string>()
      for (const section of source.sections) {
        const { data: sectionData, error: sectionError } = await supabase
          .from('sto_version_property_sections')
          .insert({ ...without(section, 'id', 'images'), version_id: version.id })
          .select()
          .single()
        if (sectionError) throw sectionError
        const copy = sectionData as StoPropertySection
        sectionIds.set(section.id, copy.id)

        for (const image of section.images) {
          const storagePath = await copyObject(image.storage_path, 'sections/')
          const { error: imageError } = await supabase.from('sto_section_images').insert({
            ...without(image, 'id'),
            section_id: copy.id,
            storage_path: storagePath,
          })
          if (imageError) throw imageError
        }
      }

      const lines: [string, Record<string, unknown>[]][] = [
        [
          'sto_version_rates',
          source.rates.map((rate) => ({
            ...without(rate, 'id'),
            version_id: version.id,
            section_id: rate.section_id ? (sectionIds.get(rate.section_id) ?? null) : null,
          })),
        ],
        [
          'sto_version_supplements',
          source.supplements.map((row) => ({ ...without(row, 'id'), version_id: version.id })),
        ],
        [
          'sto_version_terms',
          source.terms_list.map((row) => ({ ...without(row, 'id'), version_id: version.id })),
        ],
      ]

      for (const [table, rows] of lines) {
        if (rows.length === 0) continue
        const { error: insertError } = await supabase.from(table).insert(rows)
        if (insertError) throw insertError
      }
    } catch (err) {
      // All or nothing, as with createVersion: a copy missing half its rates
      // looks finished and is not. The rows cascade with the header; the
      // files have to be removed by hand.
      await supabase.from('sto_agreement_versions').delete().eq('id', version.id)
      if (copiedPaths.length > 0) await supabase.storage.from(STO_BUCKET).remove(copiedPaths)
      throw err
    }

    await invalidate('sto_versions')
    return version
  }

  async function setVersionStatus(id: string, status: StoAgreementVersion['status']) {
    await updateVersion(id, { status })
  }

  async function deleteVersion(version: StoAgreementVersion) {
    const { data, error } = await supabase
      .from('sto_agreement_versions')
      .delete()
      .eq('id', version.id)
      .select('id')
    if (error) throw error
    // Row-level security refuses a delete by matching nothing rather than by
    // raising, so an empty result *is* the refusal. Without this check the
    // sheet silently stays put and the page says nothing.
    if (!data || data.length === 0) {
      throw new Error(
        'That rate sheet was not deleted — the database refused it. Your account may not be allowed to delete rate sheets, or it was already removed. Refresh to check.'
      )
    }
    // Best effort: the row is gone either way, and a stranded object is
    // invisible rather than harmful.
    if (version.pdf_path) await supabase.storage.from(STO_BUCKET).remove([version.pdf_path])
    // The sends that pointed at it go with it.
    await invalidate('sto_versions', 'sto_sends')
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
    await invalidate('sto_versions')
  }

  /* -------------------------------------------------------------------------
     Room categories
     ---------------------------------------------------------------------------
     Saved one at a time rather than replaced as a block, because a rate line
     points at a category and a photograph hangs off one: wiping and re-inserting
     would orphan both on every save.
     ------------------------------------------------------------------------- */
  async function addSection(versionId: string, input: Partial<StoPropertySection>) {
    const { data, error } = await supabase
      .from('sto_version_property_sections')
      .insert({ ...input, version_id: versionId })
      .select()
      .single()
    if (error) throw error
    await invalidate('sto_versions')
    return data as StoPropertySection
  }

  async function updateSection(id: string, input: Partial<StoPropertySection>) {
    const { error } = await supabase
      .from('sto_version_property_sections')
      .update(input)
      .eq('id', id)
    if (error) throw error
    await invalidate('sto_versions')
  }

  async function deleteSection(section: { id: string; images: StoSectionImage[] }) {
    const { error } = await supabase
      .from('sto_version_property_sections')
      .delete()
      .eq('id', section.id)
    if (error) throw error
    // Best effort, as with the PDF: the rows are gone either way, and a
    // stranded object is invisible rather than harmful.
    if (section.images.length > 0) {
      await supabase.storage.from(STO_BUCKET).remove(section.images.map((im) => im.storage_path))
    }
    await invalidate('sto_versions')
  }

  /**
   * Attach a photograph to a room category.
   *
   * Uploaded under a random path, like the PDFs: the bucket is public so an
   * operator can see the picture in a document opened with no session, and an
   * unguessable path is what keeps that from being a directory anyone can walk.
   */
  async function addSectionImage(sectionId: string, file: File, caption: string, sortOrder: number) {
    if (!file.type.startsWith('image/')) throw new Error('That file is not an image.')

    const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const storagePath = `sections/${crypto.randomUUID()}.${extension}`
    const { error: uploadError } = await supabase.storage
      .from(STO_BUCKET)
      .upload(storagePath, file, { contentType: file.type, upsert: false })
    if (uploadError) throw uploadError

    const { error } = await supabase.from('sto_section_images').insert({
      section_id: sectionId,
      storage_path: storagePath,
      caption: caption.trim() || null,
      sort_order: sortOrder,
    })
    if (error) {
      await supabase.storage.from(STO_BUCKET).remove([storagePath])
      throw error
    }
    await invalidate('sto_versions')
  }

  async function updateSectionImage(id: string, caption: string) {
    const { error } = await supabase
      .from('sto_section_images')
      .update({ caption: caption.trim() || null })
      .eq('id', id)
    if (error) throw error
    await invalidate('sto_versions')
  }

  async function deleteSectionImage(image: StoSectionImage) {
    const { error } = await supabase.from('sto_section_images').delete().eq('id', image.id)
    if (error) throw error
    await supabase.storage.from(STO_BUCKET).remove([image.storage_path])
    await invalidate('sto_versions')
  }

  async function removePdf(version: StoAgreementVersion) {
    const { error } = await supabase
      .from('sto_agreement_versions')
      .update({ pdf_path: null, pdf_name: null, pdf_size_bytes: 0 })
      .eq('id', version.id)
    if (error) throw error
    if (version.pdf_path) await supabase.storage.from(STO_BUCKET).remove([version.pdf_path])
    await invalidate('sto_versions')
  }

  return {
    versions,
    loading,
    error,
    refresh,
    createVersion,
    updateVersion,
    duplicateVersion,
    setVersionStatus,
    deleteVersion,
    uploadPdf,
    removePdf,
    addSection,
    updateSection,
    deleteSection,
    addSectionImage,
    updateSectionImage,
    deleteSectionImage,
  }
}

/** A row with the named fields taken off, ready to insert under a new parent. */
function without<T extends object, K extends keyof T>(row: T, ...keys: K[]): Omit<T, K> {
  const copy = { ...row }
  for (const key of keys) delete copy[key]
  return copy
}

/** Permanent public URL for anything in the STO bucket — a PDF, a photograph. */
export function stoPdfUrl(path: string) {
  const { data } = supabase.storage.from(STO_BUCKET).getPublicUrl(path)
  return data.publicUrl
}

/** Where the emailed button points. Absolute, because it is read outside the app. */
export const agreementLink = (token: string) => `${window.location.origin}/agreement/${token}`

export function useAgreementSends() {
  const {
    data: sends,
    loading,
    error,
    refresh,
  } = useSharedResource(
    'sto_sends',
    NO_SENDS,
    useCallback(async () => {
      const { data, error } = await supabase
        .from('sto_agreement_sends')
        .select('*')
        .order('sent_at', { ascending: false })
      if (error) throw new Error(error.message)
      return (data ?? []) as StoAgreementSend[]
    }, [])
  )

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
    await invalidate('sto_sends')
    return data as StoAgreementSend
  }

  async function updateSend(id: string, input: Partial<StoAgreementSend>) {
    const { error } = await supabase
      .from('sto_agreement_sends')
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
    await invalidate('sto_sends')
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
    const { data, error } = await supabase
      .from('sto_agreement_sends')
      .delete()
      .eq('id', id)
      .select('id')
    if (error) throw error
    // As with deleteVersion: a refused delete comes back empty, not as an error.
    if (!data || data.length === 0) {
      throw new Error(
        'That send was not removed — the database refused it. Your account may not be allowed to remove sends, or it was already removed. Refresh to check.'
      )
    }
    await invalidate('sto_sends')
  }

  return { sends, loading, error, refresh, createSend, updateSend, setSendStatus, deleteSend }
}
