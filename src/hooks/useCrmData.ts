import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type {
  Company,
  Contact,
  SiteVisit,
  FollowUp,
  StoRateCardItem,
  EmailTemplate,
  Profile,
  PricingDocument,
  Stage,
} from '../lib/database.types'

export function useCompanies() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('companies')
      .select('*')
      .order('updated_at', { ascending: false })
    if (error) setError(error.message)
    else setCompanies((data ?? []) as Company[])
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function createCompany(input: Partial<Company>) {
    const { data, error } = await supabase.from('companies').insert(input).select().single()
    if (error) throw error
    await refresh()
    return data as Company
  }

  async function updateCompany(id: string, input: Partial<Company>) {
    const { error } = await supabase.from('companies').update(input).eq('id', id)
    if (error) throw error
    await refresh()
  }

  async function setStage(id: string, stage: Stage) {
    await updateCompany(id, { stage })
  }

  async function deleteCompany(id: string) {
    const { error } = await supabase.from('companies').delete().eq('id', id)
    if (error) throw error
    await refresh()
  }

  return { companies, loading, error, refresh, createCompany, updateCompany, setStage, deleteCompany }
}

export function useContacts(companyId: string | undefined) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!companyId) {
      setContacts([])
      setLoading(false)
      return
    }
    setLoading(true)
    const { data } = await supabase
      .from('contacts')
      .select('*')
      .eq('company_id', companyId)
      .order('is_primary', { ascending: false })
    setContacts((data ?? []) as Contact[])
    setLoading(false)
  }, [companyId])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function createContact(input: Partial<Contact>) {
    const { data, error } = await supabase.from('contacts').insert(input).select().single()
    if (error) throw error
    await refresh()
    return data as Contact
  }

  async function updateContact(id: string, input: Partial<Contact>) {
    const { error } = await supabase.from('contacts').update(input).eq('id', id)
    if (error) throw error
    await refresh()
  }

  async function deleteContact(id: string) {
    const { error } = await supabase.from('contacts').delete().eq('id', id)
    if (error) throw error
    await refresh()
  }

  return { contacts, loading, refresh, createContact, updateContact, deleteContact }
}

export function useSiteVisits(companyId?: string) {
  const [visits, setVisits] = useState<SiteVisit[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    let query = supabase.from('site_visits').select('*').order('scheduled_for', { ascending: true })
    if (companyId) query = query.eq('company_id', companyId)
    const { data } = await query
    setVisits((data ?? []) as SiteVisit[])
    setLoading(false)
  }, [companyId])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function createVisit(input: Partial<SiteVisit>) {
    const { data, error } = await supabase.from('site_visits').insert(input).select().single()
    if (error) throw error
    await refresh()
    return data as SiteVisit
  }

  async function updateVisit(id: string, input: Partial<SiteVisit>) {
    const { error } = await supabase.from('site_visits').update(input).eq('id', id)
    if (error) throw error
    await refresh()
  }

  async function deleteVisit(id: string) {
    const { error } = await supabase.from('site_visits').delete().eq('id', id)
    if (error) throw error
    await refresh()
  }

  return { visits, loading, refresh, createVisit, updateVisit, deleteVisit }
}

export function useFollowUps(companyId?: string) {
  const [followUps, setFollowUps] = useState<FollowUp[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    let query = supabase.from('follow_ups').select('*').order('due_at', { ascending: true })
    if (companyId) query = query.eq('company_id', companyId)
    const { data } = await query
    setFollowUps((data ?? []) as FollowUp[])
    setLoading(false)
  }, [companyId])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function createFollowUp(input: Partial<FollowUp>) {
    const { data, error } = await supabase.from('follow_ups').insert(input).select().single()
    if (error) throw error
    await refresh()
    return data as FollowUp
  }

  async function updateFollowUp(id: string, input: Partial<FollowUp>) {
    const { error } = await supabase.from('follow_ups').update(input).eq('id', id)
    if (error) throw error
    await refresh()
  }

  async function deleteFollowUp(id: string) {
    const { error } = await supabase.from('follow_ups').delete().eq('id', id)
    if (error) throw error
    await refresh()
  }

  return { followUps, loading, refresh, createFollowUp, updateFollowUp, deleteFollowUp }
}

export function useRateCard() {
  const [items, setItems] = useState<StoRateCardItem[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('sto_rate_card')
      .select('*')
      .order('sort_order', { ascending: true })
    setItems((data ?? []) as StoRateCardItem[])
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function createItem(input: Partial<StoRateCardItem>) {
    const { error } = await supabase.from('sto_rate_card').insert(input)
    if (error) throw error
    await refresh()
  }

  async function updateItem(id: string, input: Partial<StoRateCardItem>) {
    const { error } = await supabase.from('sto_rate_card').update(input).eq('id', id)
    if (error) throw error
    await refresh()
  }

  async function deleteItem(id: string) {
    const { error } = await supabase.from('sto_rate_card').delete().eq('id', id)
    if (error) throw error
    await refresh()
  }

  return { items, loading, refresh, createItem, updateItem, deleteItem }
}

export function useTemplates() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('email_templates')
      .select('*')
      .order('updated_at', { ascending: false })
    setTemplates((data ?? []) as EmailTemplate[])
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function createTemplate(input: Partial<EmailTemplate>) {
    const { data, error } = await supabase.from('email_templates').insert(input).select().single()
    if (error) throw error
    await refresh()
    return data as EmailTemplate
  }

  async function updateTemplate(id: string, input: Partial<EmailTemplate>) {
    const { error } = await supabase.from('email_templates').update(input).eq('id', id)
    if (error) throw error
    await refresh()
  }

  async function deleteTemplate(id: string) {
    const { error } = await supabase.from('email_templates').delete().eq('id', id)
    if (error) throw error
    await refresh()
  }

  return { templates, loading, refresh, createTemplate, updateTemplate, deleteTemplate }
}

export function useProfiles() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('profiles').select('*').order('full_name')
    setProfiles((data ?? []) as Profile[])
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function updateRole(id: string, role: 'owner' | 'marketing') {
    const { error } = await supabase.from('profiles').update({ role }).eq('id', id)
    if (error) throw error
    await refresh()
  }

  return { profiles, loading, refresh, updateRole }
}

const PRICING_BUCKET = 'pricing'

/**
 * The price list as a PDF, uploaded once and sent to clients unchanged.
 *
 * Two things move together here: a row in pricing_documents (the catalogue)
 * and an object in the `pricing` storage bucket (the file). The upload writes
 * the file first — a row pointing at a file that failed to upload would show a
 * broken link in every quote, which is worse than no row at all.
 */
export function usePricingDocuments() {
  const [documents, setDocuments] = useState<PricingDocument[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('pricing_documents')
      .select('*')
      .order('created_at', { ascending: false })
    setDocuments((data ?? []) as PricingDocument[])
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function uploadDocument(file: File, uploadedBy: string | null) {
    if (file.type !== 'application/pdf') throw new Error('Only PDF files can be uploaded.')

    // A random path keeps the public URL unguessable and means two uploads of
    // the same filename cannot collide.
    const storagePath = `${crypto.randomUUID()}.pdf`

    const { error: uploadError } = await supabase.storage
      .from(PRICING_BUCKET)
      .upload(storagePath, file, { contentType: 'application/pdf', upsert: false })
    if (uploadError) throw uploadError

    const { data, error } = await supabase
      .from('pricing_documents')
      .insert({
        name: file.name.replace(/\.pdf$/i, ''),
        storage_path: storagePath,
        size_bytes: file.size,
        uploaded_by: uploadedBy,
        // First one uploaded becomes the default, so sharing works without a
        // second deliberate step.
        is_default: documents.length === 0,
      })
      .select()
      .single()

    // Leaving the file behind would be an orphan nobody can see or remove.
    if (error) {
      await supabase.storage.from(PRICING_BUCKET).remove([storagePath])
      throw error
    }

    await refresh()
    return data as PricingDocument
  }

  async function setDefaultDocument(id: string) {
    // The partial unique index allows only one is_default row, so the old one
    // has to be cleared before the new one is set, not after.
    const current = documents.find((d) => d.is_default)
    if (current && current.id !== id) {
      const { error } = await supabase
        .from('pricing_documents')
        .update({ is_default: false })
        .eq('id', current.id)
      if (error) throw error
    }
    const { error } = await supabase.from('pricing_documents').update({ is_default: true }).eq('id', id)
    if (error) throw error
    await refresh()
  }

  async function deleteDocument(doc: PricingDocument) {
    const { error } = await supabase.from('pricing_documents').delete().eq('id', doc.id)
    if (error) throw error
    // Best effort: the row is gone either way, and a stranded object is
    // invisible rather than harmful.
    await supabase.storage.from(PRICING_BUCKET).remove([doc.storage_path])
    await refresh()
  }

  /** Permanent public URL — this is what goes to the client. */
  function documentUrl(doc: PricingDocument) {
    const { data } = supabase.storage.from(PRICING_BUCKET).getPublicUrl(doc.storage_path)
    return data.publicUrl
  }

  return {
    documents,
    loading,
    refresh,
    uploadDocument,
    setDefaultDocument,
    deleteDocument,
    documentUrl,
  }
}

/**
 * Every contact the signed-in user can see, across all companies.
 *
 * Separate from useContacts, which is scoped to one company and treats "no
 * company id" as "show nothing" — a contract CompanyDetail depends on while
 * its company loads. RLS does the scoping here: contacts_access matches on
 * can_access_company, so a rep receives only the contacts at companies they
 * already reach.
 */
export function useAllContacts() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('contacts').select('*').order('full_name')
    setContacts((data ?? []) as Contact[])
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { contacts, loading, refresh }
}
