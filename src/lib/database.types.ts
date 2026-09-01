export type Role = 'owner' | 'marketing'

export type Stage =
  | 'lead'
  | 'contacted'
  | 'site_visit'
  | 'proposal_sent'
  | 'negotiation'
  | 'won'
  | 'lost'

export type VisitStatus = 'scheduled' | 'completed' | 'cancelled'
export type FollowUpStatus = 'pending' | 'done' | 'skipped'
export type TemplateCategory = 'general' | 'pricing' | 'follow_up' | 'proposal'
export type Channel = 'email' | 'whatsapp'

export interface Profile {
  id: string
  full_name: string
  email: string
  role: Role
  created_at: string
}

export interface Company {
  id: string
  name: string
  industry: string | null
  website: string | null
  address: string | null
  city: string | null
  stage: Stage
  notes: string | null
  owner_id: string | null
  created_at: string
  updated_at: string
}

export interface Contact {
  id: string
  company_id: string
  full_name: string
  job_title: string | null
  email: string | null
  phone: string | null
  whatsapp: string | null
  is_primary: boolean
  created_at: string
}

export interface SiteVisit {
  id: string
  company_id: string
  contact_id: string | null
  rep_id: string | null
  scheduled_for: string
  status: VisitStatus
  summary: string | null
  created_at: string
}

export interface FollowUp {
  id: string
  company_id: string
  contact_id: string | null
  assigned_to: string | null
  due_at: string
  note: string
  status: FollowUpStatus
  created_at: string
}

export interface StoRateCardItem {
  id: string
  service_name: string
  description: string | null
  price: number
  currency: string
  unit: string | null
  active: boolean
  sort_order: number
  created_at: string
}

export interface EmailTemplate {
  id: string
  name: string
  subject: string
  body_html: string
  category: TemplateCategory
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface PricingDocument {
  id: string
  name: string
  /** Key into the `pricing` storage bucket, not a URL. */
  storage_path: string
  size_bytes: number
  is_default: boolean
  uploaded_by: string | null
  created_at: string
}

export interface SentMessage {
  id: string
  company_id: string | null
  contact_id: string | null
  sent_by: string | null
  channel: Channel
  template_id: string | null
  subject: string | null
  body: string
  sent_at: string
}

// Minimal Supabase Database type. Since we're not using generated types
// (no CLI access assumed), this keeps the client typed loosely but usably.
// Run `supabase gen types typescript` later for full type safety.
export interface Database {
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: Partial<Profile>; Update: Partial<Profile> }
      companies: { Row: Company; Insert: Partial<Company>; Update: Partial<Company> }
      contacts: { Row: Contact; Insert: Partial<Contact>; Update: Partial<Contact> }
      site_visits: { Row: SiteVisit; Insert: Partial<SiteVisit>; Update: Partial<SiteVisit> }
      follow_ups: { Row: FollowUp; Insert: Partial<FollowUp>; Update: Partial<FollowUp> }
      sto_rate_card: {
        Row: StoRateCardItem
        Insert: Partial<StoRateCardItem>
        Update: Partial<StoRateCardItem>
      }
      email_templates: {
        Row: EmailTemplate
        Insert: Partial<EmailTemplate>
        Update: Partial<EmailTemplate>
      }
      pricing_documents: {
        Row: PricingDocument
        Insert: Partial<PricingDocument>
        Update: Partial<PricingDocument>
      }
      sent_messages: {
        Row: SentMessage
        Insert: Partial<SentMessage>
        Update: Partial<SentMessage>
      }
    }
  }
}

export const STAGE_LABELS: Record<Stage, string> = {
  lead: 'Lead',
  contacted: 'Contacted',
  site_visit: 'Site visit',
  proposal_sent: 'Proposal sent',
  negotiation: 'Negotiation',
  won: 'Won',
  lost: 'Lost',
}

export const STAGE_ORDER: Stage[] = [
  'lead',
  'contacted',
  'site_visit',
  'proposal_sent',
  'negotiation',
  'won',
  'lost',
]
