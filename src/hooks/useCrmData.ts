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
