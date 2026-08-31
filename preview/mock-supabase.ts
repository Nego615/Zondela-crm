/**
 * In-memory stand-in for the Supabase client, used only by the static
 * preview build (see vite.preview.config.ts, which aliases
 * src/lib/supabase over to this file). Nothing here ships to production.
 *
 * It deliberately re-implements the visibility rules from
 * supabase/schema.sql so the preview demonstrates per-rep scoping: switching
 * the acting user changes what the real pages render, the same way RLS
 * changes what Postgres returns.
 */

type Row = Record<string, any>

export const OWNER_ID = '11111111-1111-1111-1111-111111111111'
export const REP_A_ID = '22222222-2222-2222-2222-222222222222'
export const REP_B_ID = '33333333-3333-3333-3333-333333333333'

const day = 86_400_000
const now = Date.now()
const at = (offsetDays: number) => new Date(now + offsetDays * day).toISOString()

function seed(): Record<string, Row[]> {
  return {
    profiles: [
      { id: OWNER_ID, full_name: 'Olive Mushi', email: 'olive@zondela.co.tz', role: 'owner', created_at: at(-120) },
      { id: REP_A_ID, full_name: 'Amina Kessy', email: 'amina@zondela.co.tz', role: 'marketing', created_at: at(-90) },
      { id: REP_B_ID, full_name: 'Baraka Lyimo', email: 'baraka@zondela.co.tz', role: 'marketing', created_at: at(-60) },
    ],
    companies: [
      { id: 'c-01', name: 'Kilimanjaro Coffee Union', industry: 'Agriculture', city: 'Moshi', website: 'https://kcu.co.tz', address: 'Boma Rd', stage: 'negotiation', owner_id: REP_A_ID, notes: 'Wants regional keyword coverage before harvest season.', created_at: at(-40), updated_at: at(-2) },
      { id: 'c-02', name: 'Arusha Auto Spares', industry: 'Retail', city: 'Arusha', website: 'https://arushaauto.co.tz', address: 'Sokoine Rd', stage: 'proposal_sent', owner_id: REP_A_ID, notes: 'Proposal sent for STO Growth.', created_at: at(-30), updated_at: at(-4) },
      { id: 'c-03', name: 'Serengeti Safari Lodges', industry: 'Hospitality', city: 'Arusha', website: 'https://serengetilodges.com', address: 'Njiro', stage: 'won', owner_id: REP_A_ID, notes: 'Signed STO Pro, 12 months.', created_at: at(-75), updated_at: at(-9) },
      { id: 'c-04', name: 'Mwanza Fresh Foods', industry: 'FMCG', city: 'Mwanza', website: null, address: 'Nyerere Rd', stage: 'site_visit', owner_id: REP_B_ID, notes: 'Visit booked with the ops manager.', created_at: at(-22), updated_at: at(-3) },
      { id: 'c-05', name: 'Dodoma Building Supplies', industry: 'Construction', city: 'Dodoma', website: null, address: 'Area C', stage: 'contacted', owner_id: REP_B_ID, notes: null, created_at: at(-15), updated_at: at(-6) },
      { id: 'c-06', name: 'Zanzibar Spice Exporters', industry: 'Export', city: 'Zanzibar', website: 'https://znzspice.com', address: 'Stone Town', stage: 'lead', owner_id: null, notes: 'Inbound from the website form — nobody has picked this up.', created_at: at(-5), updated_at: at(-5) },
      { id: 'c-07', name: 'Tanga Cement Retail', industry: 'Construction', city: 'Tanga', website: null, address: 'Ngamiani', stage: 'lead', owner_id: null, notes: 'Referral from Serengeti Lodges.', created_at: at(-3), updated_at: at(-3) },
      { id: 'c-08', name: 'Iringa Highlands Tea', industry: 'Agriculture', city: 'Iringa', website: null, address: 'Mafinga Rd', stage: 'lost', owner_id: REP_B_ID, notes: 'Went with an in-house hire.', created_at: at(-88), updated_at: at(-30) },
    ],
    contacts: [
      { id: 'ct-01', company_id: 'c-01', full_name: 'Neema Shirima', job_title: 'Marketing Lead', email: 'neema@kcu.co.tz', phone: '+255 754 110 220', whatsapp: '255754110220', is_primary: true, created_at: at(-40) },
      { id: 'ct-02', company_id: 'c-01', full_name: 'Joseph Mrema', job_title: 'Finance Director', email: 'joseph@kcu.co.tz', phone: '+255 754 110 221', whatsapp: null, is_primary: false, created_at: at(-38) },
      { id: 'ct-03', company_id: 'c-02', full_name: 'Rashid Juma', job_title: 'Owner', email: 'rashid@arushaauto.co.tz', phone: '+255 713 445 001', whatsapp: '255713445001', is_primary: true, created_at: at(-30) },
      { id: 'ct-04', company_id: 'c-03', full_name: 'Grace Kimaro', job_title: 'GM', email: 'grace@serengetilodges.com', phone: '+255 767 900 100', whatsapp: '255767900100', is_primary: true, created_at: at(-75) },
      { id: 'ct-05', company_id: 'c-04', full_name: 'Peter Magesa', job_title: 'Ops Manager', email: 'peter@mwanzafresh.co.tz', phone: '+255 786 220 330', whatsapp: '255786220330', is_primary: true, created_at: at(-22) },
      { id: 'ct-06', company_id: 'c-05', full_name: 'Halima Said', job_title: 'Procurement', email: 'halima@dodomabuild.co.tz', phone: '+255 762 505 707', whatsapp: null, is_primary: true, created_at: at(-15) },
      { id: 'ct-07', company_id: 'c-06', full_name: 'Salma Ali', job_title: 'Director', email: 'salma@znzspice.com', phone: '+255 777 313 414', whatsapp: '255777313414', is_primary: true, created_at: at(-5) },
    ],
    site_visits: [
      { id: 'sv-01', company_id: 'c-01', contact_id: 'ct-01', rep_id: REP_A_ID, scheduled_for: at(-12), status: 'completed', summary: 'Walked the estate, agreed on a two-cluster scope.', created_at: at(-20) },
      { id: 'sv-02', company_id: 'c-02', contact_id: 'ct-03', rep_id: REP_A_ID, scheduled_for: at(3), status: 'scheduled', summary: null, created_at: at(-6) },
      { id: 'sv-03', company_id: 'c-03', contact_id: 'ct-04', rep_id: REP_A_ID, scheduled_for: at(-60), status: 'completed', summary: 'Signed on site.', created_at: at(-70) },
      { id: 'sv-04', company_id: 'c-04', contact_id: 'ct-05', rep_id: REP_B_ID, scheduled_for: at(5), status: 'scheduled', summary: null, created_at: at(-4) },
      // Delegated: Baraka's account, but Amina is the attending rep. Under the
      // new policies this stays visible to Amina even though c-04 is not hers.
      { id: 'sv-05', company_id: 'c-04', contact_id: 'ct-05', rep_id: REP_A_ID, scheduled_for: at(8), status: 'scheduled', summary: null, created_at: at(-1) },
    ],
    follow_ups: [
      { id: 'fu-01', company_id: 'c-01', contact_id: 'ct-01', assigned_to: REP_A_ID, due_at: at(-2), note: 'Send revised pricing for the second cluster.', status: 'pending', created_at: at(-10) },
      { id: 'fu-02', company_id: 'c-02', contact_id: 'ct-03', assigned_to: REP_A_ID, due_at: at(2), note: 'Chase the proposal decision.', status: 'pending', created_at: at(-4) },
      { id: 'fu-03', company_id: 'c-03', contact_id: 'ct-04', assigned_to: REP_A_ID, due_at: at(-30), note: 'Onboarding call.', status: 'done', created_at: at(-40) },
      { id: 'fu-04', company_id: 'c-05', contact_id: 'ct-06', assigned_to: REP_B_ID, due_at: at(1), note: 'Book the site visit.', status: 'pending', created_at: at(-5) },
      // Delegated the same way: Baraka's company, assigned to Amina.
      { id: 'fu-05', company_id: 'c-04', contact_id: 'ct-05', assigned_to: REP_A_ID, due_at: at(4), note: 'Cover the Mwanza visit while Baraka is away.', status: 'pending', created_at: at(-1) },
    ],
    sto_rate_card: [
      { id: 'rc-01', service_name: 'STO Starter', description: 'Basic search & directory optimization for a single location', price: 350000, currency: 'TZS', unit: 'per month', active: true, sort_order: 1, created_at: at(-120) },
      { id: 'rc-02', service_name: 'STO Growth', description: 'Multi-page optimization, monthly reporting, 2 keyword clusters', price: 650000, currency: 'TZS', unit: 'per month', active: true, sort_order: 2, created_at: at(-120) },
      { id: 'rc-03', service_name: 'STO Pro', description: 'Full-site optimization, competitor tracking, weekly reporting', price: 1200000, currency: 'TZS', unit: 'per month', active: true, sort_order: 3, created_at: at(-120) },
      { id: 'rc-04', service_name: 'STO Enterprise', description: 'Custom scope for multi-location or high-competition sectors', price: 2500000, currency: 'TZS', unit: 'per month', active: true, sort_order: 4, created_at: at(-120) },
    ],
    email_templates: [
      { id: 'tp-01', name: 'STO pricing intro', subject: 'STO pricing for {{company}}', body_html: 'Hi {{name}},\n\nThanks for your time today. Here is our STO pricing:\n\n{{pricing}}\n\nHappy to walk through any of it.\n\nZondela', category: 'pricing', created_by: OWNER_ID, created_at: at(-100), updated_at: at(-14) },
      { id: 'tp-02', name: 'Post-visit follow-up', subject: 'Great meeting you at {{company}}', body_html: 'Hi {{name}},\n\nThanks for showing us around. As promised, our recommended scope is below.\n\n{{pricing}}\n\nZondela', category: 'follow_up', created_by: OWNER_ID, created_at: at(-95), updated_at: at(-20) },
      { id: 'tp-03', name: 'Proposal nudge', subject: 'Following up on our proposal', body_html: 'Hi {{name}},\n\nJust checking whether you had a chance to review the proposal.\n\nZondela', category: 'proposal', created_by: OWNER_ID, created_at: at(-80), updated_at: at(-25) },
    ],
    sent_messages: [
      { id: 'sm-01', company_id: 'c-01', contact_id: 'ct-01', sent_by: REP_A_ID, channel: 'email', template_id: 'tp-01', subject: 'STO pricing for Kilimanjaro Coffee Union', body: 'Pricing shared for STO Growth and STO Pro.', sent_at: at(-8) },
      { id: 'sm-02', company_id: 'c-02', contact_id: 'ct-03', sent_by: REP_A_ID, channel: 'whatsapp', template_id: null, subject: null, body: 'Sent the STO Growth pricing over WhatsApp.', sent_at: at(-5) },
      { id: 'sm-03', company_id: 'c-04', contact_id: 'ct-05', sent_by: REP_B_ID, channel: 'email', template_id: 'tp-02', subject: 'Great meeting you at Mwanza Fresh Foods', body: 'Recommended STO Starter to begin.', sent_at: at(-3) },
    ],
  }
}

let db = seed()
let currentUserId: string = OWNER_ID

export function getActingUserId() {
  return currentUserId
}

export function setActingUserId(id: string) {
  currentUserId = id
}

export function resetPreviewData() {
  db = seed()
}

export function listPreviewUsers() {
  return db.profiles.map((p) => ({ id: p.id, name: p.full_name, role: p.role as 'owner' | 'marketing' }))
}

// --- visibility, mirroring the RLS policies in supabase/schema.sql ----------

function isOwner() {
  return db.profiles.find((p) => p.id === currentUserId)?.role === 'owner'
}

function canAccessCompany(companyId: string | null | undefined) {
  if (companyId == null) return false
  const c = db.companies.find((x) => x.id === companyId)
  return !!c && (isOwner() || c.owner_id === currentUserId || c.owner_id == null)
}

function isVisible(table: string, row: Row): boolean {
  switch (table) {
    case 'companies':
      return isOwner() || row.owner_id === currentUserId || row.owner_id == null
    case 'contacts':
      return canAccessCompany(row.company_id)
    case 'site_visits':
      return canAccessCompany(row.company_id) || row.rep_id === currentUserId
    case 'follow_ups':
      return canAccessCompany(row.company_id) || row.assigned_to === currentUserId
    case 'sent_messages':
      return canAccessCompany(row.company_id) || row.sent_by === currentUserId
    default:
      return true
  }
}

/** Mirrors the WITH CHECK clauses: what a row is allowed to look like after a write. */
function writeCheck(table: string, row: Row): string | null {
  if (table !== 'companies') return null
  if (isOwner()) return null
  if (row.owner_id === currentUserId || row.owner_id == null) return null
  return 'new row violates row-level security policy for table "companies"'
}

// --- query builder ---------------------------------------------------------

type Op = 'select' | 'insert' | 'update' | 'delete'

let idCounter = 0
const newId = () => `gen-${++idCounter}`

class Query implements PromiseLike<{ data: any; error: { message: string } | null }> {
  private filters: Array<[string, unknown]> = []
  private orders: Array<{ col: string; asc: boolean }> = []
  private wantsSingle = false

  constructor(private table: string, private op: Op, private payload?: Row) {}

  eq(col: string, val: unknown) {
    this.filters.push([col, val])
    return this
  }

  order(col: string, opts?: { ascending?: boolean }) {
    this.orders.push({ col, asc: opts?.ascending ?? true })
    return this
  }

  // On a read this is a no-op; on a write it means "return the affected row".
  select(_cols?: string) {
    return this
  }

  single() {
    this.wantsSingle = true
    return this
  }

  private matches(row: Row) {
    return this.filters.every(([col, val]) => row[col] === val)
  }

  private sorted(rows: Row[]) {
    if (!this.orders.length) return rows
    return [...rows].sort((a, b) => {
      for (const { col, asc } of this.orders) {
        const av = a[col]
        const bv = b[col]
        if (av === bv) continue
        // Nulls last, then plain comparison — enough for the preview's data.
        if (av == null) return 1
        if (bv == null) return -1
        return (av < bv ? -1 : 1) * (asc ? 1 : -1)
      }
      return 0
    })
  }

  private run() {
    const rows = db[this.table] ?? []

    if (this.op === 'select') {
      const found = this.sorted(rows.filter((r) => isVisible(this.table, r) && this.matches(r)))
      return { data: this.wantsSingle ? found[0] ?? null : found, error: null }
    }

    if (this.op === 'insert') {
      const row: Row = {
        id: newId(),
        created_at: new Date().toISOString(),
        ...(this.table === 'companies' || this.table === 'email_templates'
          ? { updated_at: new Date().toISOString() }
          : {}),
        ...this.payload,
      }
      const violation = writeCheck(this.table, row)
      if (violation) return { data: null, error: { message: violation } }
      rows.push(row)
      return { data: this.wantsSingle ? row : [row], error: null }
    }

    if (this.op === 'update') {
      // `USING` decides which rows are reachable at all; an unreachable row is
      // simply not matched, exactly as Postgres would report 0 rows affected.
      const targets = rows.filter((r) => isVisible(this.table, r) && this.matches(r))
      for (const t of targets) {
        const next = { ...t, ...this.payload }
        const violation = writeCheck(this.table, next)
        if (violation) return { data: null, error: { message: violation } }
      }
      for (const t of targets) {
        Object.assign(t, this.payload, { updated_at: new Date().toISOString() })
      }
      return { data: targets, error: null }
    }

    // delete
    const doomed = rows.filter((r) => isVisible(this.table, r) && this.matches(r))
    db[this.table] = rows.filter((r) => !doomed.includes(r))
    return { data: doomed, error: null }
  }

  then<R1 = any, R2 = never>(
    onfulfilled?: ((v: { data: any; error: { message: string } | null }) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
  ): PromiseLike<R1 | R2> {
    // Small delay so loading states in the real pages actually render.
    return new Promise<{ data: any; error: { message: string } | null }>((resolve) =>
      setTimeout(() => resolve(this.run()), 60)
    ).then(onfulfilled, onrejected)
  }
}

function session() {
  const p = db.profiles.find((x) => x.id === currentUserId)!
  return {
    access_token: 'preview',
    token_type: 'bearer',
    expires_in: 3600,
    refresh_token: 'preview',
    user: { id: p.id, email: p.email, user_metadata: { full_name: p.full_name }, app_metadata: {}, aud: 'authenticated', created_at: p.created_at },
  }
}

export const supabase = {
  from(table: string) {
    return {
      select: (cols?: string) => new Query(table, 'select').select(cols),
      insert: (payload: Row) => new Query(table, 'insert', payload),
      update: (payload: Row) => new Query(table, 'update', payload),
      delete: () => new Query(table, 'delete'),
    }
  },
  auth: {
    async getSession() {
      return { data: { session: session() }, error: null }
    },
    onAuthStateChange(_cb: (event: string, s: unknown) => void) {
      return { data: { subscription: { unsubscribe() {} } } }
    },
    async signOut() {
      return { error: null }
    },
    async signInWithPassword() {
      return { data: { session: session() }, error: null }
    },
    async signUp() {
      return { data: { session: session() }, error: null }
    },
  },
} as any
