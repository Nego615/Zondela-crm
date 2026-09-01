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
    // The three preview logins are kept: they are what the role switcher
    // switches between, and session() dereferences the acting profile at
    // startup, so an empty list would crash the preview rather than empty it.
    // Every business record was sample data and has been removed.
    profiles: [
      { id: OWNER_ID, full_name: 'Owner', email: 'owner@example.com', role: 'owner', created_at: at(-120) },
      { id: REP_A_ID, full_name: 'Rep One', email: 'rep-one@example.com', role: 'marketing', created_at: at(-90) },
      { id: REP_B_ID, full_name: 'Rep Two', email: 'rep-two@example.com', role: 'marketing', created_at: at(-60) },
    ],
    companies: [],
    contacts: [],
    site_visits: [],
    follow_ups: [],
    sto_rate_card: [],
    email_templates: [],
    pricing_documents: [],
    sent_messages: [],
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
  clearStorage()
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

// --- storage ---------------------------------------------------------------

/**
 * Object URLs standing in for the `pricing` bucket. They live as long as the
 * tab does, which is the right lifetime for a preview: an uploaded PDF really
 * opens, and nothing is kept once the page is closed.
 *
 * The published preview runs inside a sandbox that blocks downloads and may
 * block opening a blob: URL in a new tab. Uploading, listing and switching the
 * default all work there; only opening the file itself may not.
 */
const objectUrls = new Map<string, string>()

function clearStorage() {
  for (const url of objectUrls.values()) URL.revokeObjectURL(url)
  objectUrls.clear()
}

const storage = {
  from(_bucket: string) {
    return {
      async upload(path: string, file: File, _opts?: Record<string, unknown>) {
        if (objectUrls.has(path)) {
          return { data: null, error: { message: 'The resource already exists' } }
        }
        objectUrls.set(path, URL.createObjectURL(file))
        return { data: { path }, error: null }
      },
      async remove(paths: string[]) {
        for (const path of paths) {
          const url = objectUrls.get(path)
          if (url) URL.revokeObjectURL(url)
          objectUrls.delete(path)
        }
        return { data: null, error: null }
      },
      getPublicUrl(path: string) {
        return { data: { publicUrl: objectUrls.get(path) ?? '' } }
      },
    }
  },
}

export const supabase = {
  storage,
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
