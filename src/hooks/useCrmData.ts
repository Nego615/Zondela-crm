import { useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { invalidate, useSharedResource } from './sharedResource'
import type {
  Company,
  Contact,
  SiteVisit,
  FollowUp,
  StoRateCardItem,
  EmailTemplate,
  Profile,
  PricingDocument,
  SentMessage,
  MessageStatus,
  OrgSettings,
  Stage,
} from '../lib/database.types'

/**
 * Every hook here reads through the shared store in ./sharedResource, so a
 * save made in a modal shows up in the list behind it without a page refresh.
 * Writes end with invalidate(<key prefix>), which re-reads every mounted view
 * of those rows rather than only the caller's own copy.
 */

const NO_COMPANIES: Company[] = []
const NO_CONTACTS: Contact[] = []
const NO_VISITS: SiteVisit[] = []
const NO_FOLLOW_UPS: FollowUp[] = []
const NO_RATE_CARD: StoRateCardItem[] = []
const NO_TEMPLATES: EmailTemplate[] = []
const NO_PROFILES: Profile[] = []
const NO_DOCUMENTS: PricingDocument[] = []
const NO_MESSAGES: SentMessage[] = []

/** Unwraps a PostgREST reply, turning its error into a thrown one. */
function rows<T>(result: { data: unknown; error: { message: string } | null }): T[] {
  if (result.error) throw new Error(result.error.message)
  return (result.data ?? []) as T[]
}

export function useCompanies() {
  const {
    data: companies,
    loading,
    error,
    refresh,
  } = useSharedResource(
    'companies',
    NO_COMPANIES,
    useCallback(
      async () =>
        rows<Company>(
          await supabase.from('companies').select('*').order('updated_at', { ascending: false })
        ),
      []
    )
  )

  async function createCompany(input: Partial<Company>) {
    const { data, error } = await supabase.from('companies').insert(input).select().single()
    if (error) throw error
    await invalidate('companies')
    return data as Company
  }

  async function updateCompany(id: string, input: Partial<Company>) {
    const { error } = await supabase.from('companies').update(input).eq('id', id)
    if (error) throw error
    await invalidate('companies')
  }

  async function setStage(id: string, stage: Stage) {
    await updateCompany(id, { stage })
  }

  async function deleteCompany(id: string) {
    const { error } = await supabase.from('companies').delete().eq('id', id)
    if (error) throw error
    // A company takes its contacts, visits and follow-ups with it.
    await invalidate('companies', 'contacts', 'site_visits', 'follow_ups', 'sent_messages')
  }

  return { companies, loading, error, refresh, createCompany, updateCompany, setStage, deleteCompany }
}

export function useContacts(companyId: string | undefined) {
  const {
    data: contacts,
    loading,
    refresh,
  } = useSharedResource(
    `contacts:company:${companyId ?? 'none'}`,
    NO_CONTACTS,
    useCallback(async () => {
      if (!companyId) return NO_CONTACTS
      return rows<Contact>(
        await supabase
          .from('contacts')
          .select('*')
          .eq('company_id', companyId)
          .order('is_primary', { ascending: false })
      )
    }, [companyId])
  )

  async function createContact(input: Partial<Contact>) {
    const { data, error } = await supabase.from('contacts').insert(input).select().single()
    if (error) throw error
    await invalidate('contacts')
    return data as Contact
  }

  async function updateContact(id: string, input: Partial<Contact>) {
    const { error } = await supabase.from('contacts').update(input).eq('id', id)
    if (error) throw error
    await invalidate('contacts')
  }

  async function deleteContact(id: string) {
    const { error } = await supabase.from('contacts').delete().eq('id', id)
    if (error) throw error
    await invalidate('contacts')
  }

  return { contacts, loading, refresh, createContact, updateContact, deleteContact }
}

export function useSiteVisits(companyId?: string) {
  const {
    data: visits,
    loading,
    refresh,
  } = useSharedResource(
    `site_visits:${companyId ? `company:${companyId}` : 'all'}`,
    NO_VISITS,
    useCallback(async () => {
      let query = supabase
        .from('site_visits')
        .select('*')
        .order('scheduled_for', { ascending: true })
      if (companyId) query = query.eq('company_id', companyId)
      return rows<SiteVisit>(await query)
    }, [companyId])
  )

  async function createVisit(input: Partial<SiteVisit>) {
    const { data, error } = await supabase.from('site_visits').insert(input).select().single()
    if (error) throw error
    await invalidate('site_visits')
    return data as SiteVisit
  }

  async function updateVisit(id: string, input: Partial<SiteVisit>) {
    const { error } = await supabase.from('site_visits').update(input).eq('id', id)
    if (error) throw error
    await invalidate('site_visits')
  }

  async function deleteVisit(id: string) {
    const { error } = await supabase.from('site_visits').delete().eq('id', id)
    if (error) throw error
    await invalidate('site_visits')
  }

  return { visits, loading, refresh, createVisit, updateVisit, deleteVisit }
}

export function useFollowUps(companyId?: string) {
  const {
    data: followUps,
    loading,
    refresh,
  } = useSharedResource(
    `follow_ups:${companyId ? `company:${companyId}` : 'all'}`,
    NO_FOLLOW_UPS,
    useCallback(async () => {
      let query = supabase.from('follow_ups').select('*').order('due_at', { ascending: true })
      if (companyId) query = query.eq('company_id', companyId)
      return rows<FollowUp>(await query)
    }, [companyId])
  )

  async function createFollowUp(input: Partial<FollowUp>) {
    const { data, error } = await supabase.from('follow_ups').insert(input).select().single()
    if (error) throw error
    await invalidate('follow_ups')
    return data as FollowUp
  }

  async function updateFollowUp(id: string, input: Partial<FollowUp>) {
    const { error } = await supabase.from('follow_ups').update(input).eq('id', id)
    if (error) throw error
    await invalidate('follow_ups')
  }

  async function deleteFollowUp(id: string) {
    const { error } = await supabase.from('follow_ups').delete().eq('id', id)
    if (error) throw error
    await invalidate('follow_ups')
  }

  return { followUps, loading, refresh, createFollowUp, updateFollowUp, deleteFollowUp }
}

export function useRateCard() {
  const {
    data: items,
    loading,
    refresh,
  } = useSharedResource(
    'sto_rate_card',
    NO_RATE_CARD,
    useCallback(
      async () =>
        rows<StoRateCardItem>(
          await supabase.from('sto_rate_card').select('*').order('sort_order', { ascending: true })
        ),
      []
    )
  )

  async function createItem(input: Partial<StoRateCardItem>) {
    const { error } = await supabase.from('sto_rate_card').insert(input)
    if (error) throw error
    await invalidate('sto_rate_card')
  }

  async function updateItem(id: string, input: Partial<StoRateCardItem>) {
    const { error } = await supabase.from('sto_rate_card').update(input).eq('id', id)
    if (error) throw error
    await invalidate('sto_rate_card')
  }

  async function deleteItem(id: string) {
    const { error } = await supabase.from('sto_rate_card').delete().eq('id', id)
    if (error) throw error
    await invalidate('sto_rate_card')
  }

  return { items, loading, refresh, createItem, updateItem, deleteItem }
}

export function useTemplates() {
  const {
    data: templates,
    loading,
    refresh,
  } = useSharedResource(
    'email_templates',
    NO_TEMPLATES,
    useCallback(
      async () =>
        rows<EmailTemplate>(
          await supabase
            .from('email_templates')
            .select('*')
            .order('updated_at', { ascending: false })
        ),
      []
    )
  )

  async function createTemplate(input: Partial<EmailTemplate>) {
    const { data, error } = await supabase.from('email_templates').insert(input).select().single()
    if (error) throw error
    await invalidate('email_templates')
    return data as EmailTemplate
  }

  async function updateTemplate(id: string, input: Partial<EmailTemplate>) {
    const { error } = await supabase.from('email_templates').update(input).eq('id', id)
    if (error) throw error
    await invalidate('email_templates')
  }

  async function deleteTemplate(id: string) {
    const { error } = await supabase.from('email_templates').delete().eq('id', id)
    if (error) throw error
    await invalidate('email_templates')
  }

  /**
   * Move the default to one template — the wording the agreement send uses.
   *
   * Cleared before it is set, never the other way round: a partial unique index
   * allows only one row carrying `is_default`, so setting first would collide
   * with the incumbent. Deleting the default simply leaves none, and the send
   * modal falls back to its built-in wording.
   */
  async function setDefaultTemplate(id: string) {
    const { error: clearError } = await supabase
      .from('email_templates')
      .update({ is_default: false })
      .eq('is_default', true)
    if (clearError) throw clearError

    const { error } = await supabase
      .from('email_templates')
      .update({ is_default: true })
      .eq('id', id)
    if (error) throw error
    await invalidate('email_templates')
  }

  return {
    templates,
    loading,
    refresh,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    setDefaultTemplate,
  }
}

/**
 * The team roster, used to resolve a record's rep link (owner_id, rep_id,
 * assigned_to) back to a name.
 *
 * Everyone, including deactivated accounts: a company assigned to someone who
 * has since left must still show their name rather than falling back to the
 * typed one and re-bucketing them in Reports as a separate "no login" row.
 *
 * Managing the accounts themselves is useUsers(), which is where role and
 * status changes go through their permission checks. Both read the same
 * `profiles:` keys, so a change made there shows up here without a reload.
 */
export function useProfiles() {
  const {
    data: profiles,
    loading,
    refresh,
  } = useSharedResource(
    'profiles:all',
    NO_PROFILES,
    useCallback(
      async () => rows<Profile>(await supabase.from('profiles').select('*').order('full_name')),
      []
    )
  )

  return { profiles, loading, refresh }
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
  const {
    data: documents,
    loading,
    refresh,
  } = useSharedResource(
    'pricing_documents',
    NO_DOCUMENTS,
    useCallback(
      async () =>
        rows<PricingDocument>(
          await supabase
            .from('pricing_documents')
            .select('*')
            .order('created_at', { ascending: false })
        ),
      []
    )
  )

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

    await invalidate('pricing_documents')
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
    const { error } = await supabase
      .from('pricing_documents')
      .update({ is_default: true })
      .eq('id', id)
    if (error) throw error
    await invalidate('pricing_documents')
  }

  async function deleteDocument(doc: PricingDocument) {
    const { error } = await supabase.from('pricing_documents').delete().eq('id', doc.id)
    if (error) throw error
    // Best effort: the row is gone either way, and a stranded object is
    // invisible rather than harmful.
    await supabase.storage.from(PRICING_BUCKET).remove([doc.storage_path])
    await invalidate('pricing_documents')
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
  const {
    data: contacts,
    loading,
    refresh,
  } = useSharedResource(
    'contacts:all',
    NO_CONTACTS,
    useCallback(
      async () => rows<Contact>(await supabase.from('contacts').select('*').order('full_name')),
      []
    )
  )

  return { contacts, loading, refresh }
}

/**
 * Every pricing share and agreement send the signed-in user can see, with
 * where each one got to.
 *
 * RLS scopes it the same way contacts are scoped — by the company the message
 * was sent about.
 */
export function useSentMessages(companyId?: string) {
  const {
    data: messages,
    loading,
    refresh,
  } = useSharedResource(
    `sent_messages:${companyId ? `company:${companyId}` : 'all'}`,
    NO_MESSAGES,
    useCallback(async () => {
      let query = supabase.from('sent_messages').select('*').order('sent_at', { ascending: false })
      if (companyId) query = query.eq('company_id', companyId)
      return rows<SentMessage>(await query)
    }, [companyId])
  )

  /**
   * Records where a message got to.
   *
   * Only the status and, for a failure, the reason are sent: the timestamp
   * that goes with each state is stamped by a trigger, so a client that
   * guessed the wrong one cannot rewrite when something was delivered.
   */
  async function setMessageStatus(id: string, status: MessageStatus, note?: string) {
    const patch: Partial<SentMessage> = { status }
    if (status === 'failed') patch.failure_reason = note?.trim() || null
    else if (note !== undefined) patch.status_note = note.trim() || null

    const { error } = await supabase.from('sent_messages').update(patch).eq('id', id)
    if (error) throw error
    await invalidate('sent_messages')
  }

  return { messages, loading, refresh, setMessageStatus }
}

/**
 * The letterhead — one row, shared by the agreement document, the send modal
 * and the email signature.
 *
 * Every active user reads it; saving needs settings.branding, and the RLS
 * policy is what enforces that rather than the button being hidden.
 */
export function useOrgSettings() {
  const {
    data: settings,
    loading,
    refresh,
  } = useSharedResource<OrgSettings | null>(
    'org_settings',
    null,
    useCallback(async () => {
      const { data, error } = await supabase
        .from('org_settings')
        .select('*')
        .eq('id', 1)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return (data as OrgSettings | null) ?? null
    }, [])
  )

  async function save(input: Partial<OrgSettings>) {
    const { error } = await supabase.from('org_settings').update(input).eq('id', 1)
    if (error) throw error
    await invalidate('org_settings')
  }

  return { settings, loading, refresh, save }
}
