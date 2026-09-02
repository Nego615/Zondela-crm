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

import { ROLE_PERMISSIONS, ROLE_LABELS, rankOf } from '../src/lib/permissions'
import type { Role } from '../src/lib/database.types'

type Row = Record<string, any>

export const OWNER_ID = '11111111-1111-1111-1111-111111111111'
export const REP_A_ID = '22222222-2222-2222-2222-222222222222'
export const REP_B_ID = '33333333-3333-3333-3333-333333333333'
export const VIEWER_ID = '44444444-4444-4444-4444-444444444444'

const day = 86_400_000
const now = Date.now()
const at = (offsetDays: number) => new Date(now + offsetDays * day).toISOString()

function profile(id: string, name: string, email: string, role: Role, ageDays: number): Row {
  return {
    id,
    full_name: name,
    email,
    phone_number: null,
    role,
    status: 'active',
    invited_by: null,
    last_login: at(-1),
    created_at: at(ageDays),
    updated_at: at(ageDays),
  }
}

function seed(): Record<string, Row[]> {
  return {
    // The preview logins are what the role switcher switches between, and
    // session() dereferences the acting profile at startup, so an empty list
    // would crash the preview rather than empty it. Every business record was
    // sample data and has been removed.
    profiles: [
      profile(OWNER_ID, 'Super Admin', 'super-admin@example.com', 'super_admin', -120),
      profile(REP_A_ID, 'Rep One', 'rep-one@example.com', 'staff', -90),
      profile(REP_B_ID, 'Rep Two', 'rep-two@example.com', 'staff', -60),
      profile(VIEWER_ID, 'Read Only', 'viewer@example.com', 'viewer', -30),
    ],
    // The permission catalogue, so the Roles & permissions page renders in the
    // preview exactly as it does against the real database.
    permissions: [
      { key: 'users.view', label: 'View users', description: 'Open the User management section and see every account.', category: 'Users', sort_order: 10 },
      { key: 'users.create', label: 'Create users', description: 'Invite a new user and choose their starting role.', category: 'Users', sort_order: 20 },
      { key: 'users.update', label: 'Edit user details', description: "Change another user's name and phone number.", category: 'Users', sort_order: 30 },
      { key: 'users.assign_role', label: 'Change user roles', description: 'Promote or demote users below their own level.', category: 'Users', sort_order: 40 },
      { key: 'users.manage_admins', label: 'Manage Admins', description: 'Create, promote, demote and edit Admin and Super Admin accounts.', category: 'Users', sort_order: 50 },
      { key: 'users.set_status', label: 'Activate / deactivate', description: 'Switch an account between active and inactive.', category: 'Users', sort_order: 60 },
      { key: 'users.reset_password', label: 'Send password resets', description: 'Trigger a password reset or re-send an invitation.', category: 'Users', sort_order: 70 },
      { key: 'users.delete', label: 'Delete users', description: 'Permanently remove an account and its login.', category: 'Users', sort_order: 80 },
      { key: 'roles.view', label: 'View roles & permissions', description: 'See the role hierarchy and what each role may do.', category: 'System', sort_order: 90 },
      { key: 'logs.view', label: 'View activity logs', description: 'Read the audit trail of administrative actions.', category: 'System', sort_order: 100 },
      { key: 'settings.manage', label: 'Manage system settings', description: 'Change system-wide configuration.', category: 'System', sort_order: 110 },
      { key: 'data.view_all', label: 'See all pipeline data', description: 'View every company, not only their own and the unclaimed pool.', category: 'Data', sort_order: 120 },
      { key: 'data.write', label: 'Edit business records', description: 'Create and change companies, contacts, appointments, follow-ups and agreements.', category: 'Data', sort_order: 130 },
      { key: 'reports.view', label: 'Access reports', description: 'Open the Reports section.', category: 'Data', sort_order: 140 },
    ],
    role_permissions: (Object.keys(ROLE_PERMISSIONS) as Role[]).flatMap((role) =>
      ROLE_PERMISSIONS[role].map((permission) => ({ role, permission })),
    ),
    activity_logs: [],
    // The letterhead. Seeded with the same defaults as the migration, so the
    // preview's agreement document and Branding tab look like a fresh install.
    org_settings: [
      {
        id: 1,
        org_name: 'Zondela House',
        legal_name: null,
        tagline: 'Search and traffic optimisation',
        address: null,
        city: 'Arusha',
        country: 'Tanzania',
        phone: null,
        email: null,
        website: null,
        logo_url: null,
        brand_color: '#0c3b35',
        accent_color: '#a9463a',
        agreement_intro: null,
        agreement_terms_default: null,
        agreement_footer: null,
        signatory_name: null,
        signatory_title: null,
        email_from_name: null,
        email_from_address: null,
        email_reply_to: null,
        email_bcc: null,
        email_signature: null,
        created_at: at(-120),
        updated_at: at(-120),
      },
    ],
    companies: [],
    contacts: [],
    site_visits: [],
    follow_ups: [],
    sto_rate_card: [],
    sto_agreements: [],
    sto_agreement_items: [],
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
  return db.profiles.map((p) => ({
    id: p.id,
    name: p.full_name,
    role: p.role as Role,
    roleLabel: ROLE_LABELS[p.role as Role],
  }))
}

// --- visibility, mirroring the RLS policies in supabase/schema.sql ----------

function actingProfile() {
  return db.profiles.find((p) => p.id === currentUserId)
}

/** Stands in for has_permission(): active account, and the role holds it. */
function hasPermission(permission: string) {
  const me = actingProfile()
  if (!me || me.status !== 'active') return false
  return db.role_permissions.some((g) => g.role === me.role && g.permission === permission)
}

// Named for the SQL helper it mirrors: "sees the whole pipeline", which is now
// the data.view_all grant rather than a role called owner.
function isOwner() {
  return hasPermission('data.view_all')
}

function canWriteData() {
  return hasPermission('data.write')
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
    case 'sto_agreements':
      return canAccessCompany(row.company_id) || row.created_by === currentUserId
    case 'sto_agreement_items': {
      // Mirrors can_access_agreement: a line is reachable exactly when its
      // agreement is.
      const parent = db.sto_agreements.find((a) => a.id === row.agreement_id)
      return !!parent && isVisible('sto_agreements', parent)
    }
    case 'activity_logs':
      return hasPermission('logs.view')
    default:
      return true
  }
}

/**
 * Mirrors the WITH CHECK clauses: what a row is allowed to look like after a
 * write. `changes` is the payload as sent, which is what the profiles guard
 * needs — the merged row always carries a role, sent or not.
 */
function writeCheck(table: string, row: Row, changes?: Row): string | null {
  // Every business table's write policy carries can_write_data(), which is the
  // grant a Viewer does not hold. Switching to Read Only in the preview should
  // fail a save the same way the database would.
  const businessTables = [
    'companies', 'contacts', 'site_visits', 'follow_ups', 'sent_messages',
    'sto_rate_card', 'sto_agreements', 'sto_agreement_items',
    'email_templates', 'pricing_documents',
  ]
  if (businessTables.includes(table) && !canWriteData()) {
    return `new row violates row-level security policy for table "${table}"`
  }

  // role and status are unwritable through the table — the guard trigger sends
  // them through set_user_role() / set_user_status() instead.
  const sent = changes ?? row
  if (table === 'profiles' && ('role' in sent || 'status' in sent)) {
    return 'role and status can only be changed through set_user_role() or set_user_status()'
  }

  // The letterhead is its own permission: the people who send agreements fix
  // the phone number on them, but a Staff member does not.
  if (table === 'org_settings' && !hasPermission('settings.branding')) {
    return 'new row violates row-level security policy for table "org_settings"'
  }

  if (table !== 'companies') return null
  if (isOwner()) return null
  if (row.owner_id === currentUserId || row.owner_id == null) return null
  return 'new row violates row-level security policy for table "companies"'
}

// --- write triggers, mirroring migration 0002 ------------------------------

/**
 * Stands in for stamp_message_status() and sync_agreement_message_status().
 *
 * Both exist so the preview shows the delivery feature behaving the way it
 * does against Postgres: marking a message viewed backfills its delivered
 * stamp, and accepting an agreement turns its sends green without anyone
 * touching them.
 */
function runWriteTriggers(table: string, row: Row, payload: Row) {
  const now = new Date().toISOString()

  if (table === 'sent_messages' && 'status' in payload) {
    const fill = (key: string) => {
      if (!row[key]) row[key] = now
    }
    switch (row.status) {
      case 'delivered':
        fill('delivered_at')
        break
      case 'viewed':
        fill('delivered_at')
        fill('viewed_at')
        break
      case 'failed':
        fill('failed_at')
        break
      case 'approved':
      case 'rejected':
        fill('delivered_at')
        fill('responded_at')
        break
    }
    if (row.status !== 'failed') row.failure_reason = null
  }

  if (table === 'sto_agreements' && 'status' in payload) {
    const linked = db.sent_messages.filter((m) => m.agreement_id === row.id)
    for (const message of linked) {
      if (row.status === 'accepted' && !['approved', 'failed'].includes(message.status)) {
        message.status = 'approved'
        runWriteTriggers('sent_messages', message, { status: 'approved' })
      } else if (row.status === 'declined' && !['rejected', 'failed'].includes(message.status)) {
        message.status = 'rejected'
        runWriteTriggers('sent_messages', message, { status: 'rejected' })
      } else if (row.status === 'sent' && ['approved', 'rejected'].includes(message.status)) {
        message.status = 'delivered'
      }
    }
  }
}

// --- query builder ---------------------------------------------------------

type Op = 'select' | 'insert' | 'update' | 'delete'

let idCounter = 0
const newId = () => `gen-${++idCounter}`

class Query implements PromiseLike<{ data: any; error: { message: string } | null }> {
  private filters: Array<(row: Row) => boolean> = []
  private orders: Array<{ col: string; asc: boolean }> = []
  private wantsSingle = false
  private rowLimit: number | null = null

  constructor(private table: string, private op: Op, private payload?: Row) {}

  eq(col: string, val: unknown) {
    this.filters.push((row) => row[col] === val)
    return this
  }

  in(col: string, vals: unknown[]) {
    this.filters.push((row) => vals.includes(row[col]))
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

  // Same as single() here: the preview never distinguishes "no rows" from an
  // error the way PostgREST does.
  maybeSingle() {
    this.wantsSingle = true
    return this
  }

  limit(n: number) {
    this.rowLimit = n
    return this
  }

  private matches(row: Row) {
    return this.filters.every((f) => f(row))
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
      let found = this.sorted(rows.filter((r) => isVisible(this.table, r) && this.matches(r)))
      if (this.rowLimit != null) found = found.slice(0, this.rowLimit)
      return { data: this.wantsSingle ? found[0] ?? null : found, error: null }
    }

    if (this.op === 'insert') {
      const stamped = new Date().toISOString()
      const incoming = Array.isArray(this.payload) ? this.payload : [this.payload as Row]
      const inserted: Row[] = []

      for (const payload of incoming) {
        const row: Row = {
          id: newId(),
          created_at: stamped,
          ...(this.table === 'companies' ||
          this.table === 'email_templates' ||
          this.table === 'sto_agreements' ||
          this.table === 'sent_messages'
            ? { updated_at: stamped }
            : {}),
          // Column defaults from migration 0002. `sent` is what the app knows
          // on its own; the rest stay blank until something records them.
          ...(this.table === 'sent_messages'
            ? {
                status: 'sent',
                agreement_id: null,
                to_name: null,
                to_email: null,
                delivered_at: null,
                viewed_at: null,
                failed_at: null,
                responded_at: null,
                failure_reason: null,
                status_note: null,
                provider: null,
                provider_message_id: null,
              }
            : {}),
          // Postgres generates the reference from a sequence; the preview
          // counts its own rows, which is the same thing for one session.
          ...(this.table === 'sto_agreements'
            ? { reference: `STO-${String(db.sto_agreements.length + inserted.length + 1).padStart(4, '0')}` }
            : {}),
          ...payload,
        }
        const violation = writeCheck(this.table, row)
        if (violation) return { data: null, error: { message: violation } }
        inserted.push(row)
      }

      rows.push(...inserted)
      return { data: this.wantsSingle ? inserted[0] ?? null : inserted, error: null }
    }

    if (this.op === 'update') {
      // `USING` decides which rows are reachable at all; an unreachable row is
      // simply not matched, exactly as Postgres would report 0 rows affected.
      const targets = rows.filter((r) => isVisible(this.table, r) && this.matches(r))
      for (const t of targets) {
        const next = { ...t, ...this.payload }
        const violation = writeCheck(this.table, next, this.payload)
        if (violation) return { data: null, error: { message: violation } }
      }
      for (const t of targets) {
        Object.assign(t, this.payload, { updated_at: new Date().toISOString() })
        runWriteTriggers(this.table, t, this.payload ?? {})
      }
      return { data: targets, error: null }
    }

    // delete
    const doomed = rows.filter((r) => isVisible(this.table, r) && this.matches(r))
    db[this.table] = rows.filter((r) => !doomed.includes(r))
    if (this.table === 'sto_agreements') {
      // Standing in for the on delete cascade from sto_agreement_items.
      const gone = new Set(doomed.map((r) => r.id))
      db.sto_agreement_items = db.sto_agreement_items.filter((i) => !gone.has(i.agreement_id))
    }
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

// --- RPCs, mirroring the security definer functions ------------------------

type RpcResult = { data: any; error: { message: string } | null }

const fail = (message: string): RpcResult => ({ data: null, error: { message } })
const ok = (data: any = null): RpcResult => ({ data, error: null })

/**
 * Mirrors assert_can_manage_user(): active caller, never yourself, and only
 * someone strictly below you unless you are a Super Admin.
 */
function assertCanManage(targetId: string): string | null {
  const me = actingProfile()
  if (!me || me.status !== 'active') return 'Your account is not active'
  if (targetId === currentUserId) {
    return 'You cannot change your own account from User management'
  }
  const target = db.profiles.find((p) => p.id === targetId)
  if (!target) return 'User not found'
  if (me.role === 'super_admin') return null
  if (rankOf(target.role) >= rankOf(me.role)) {
    return 'You cannot modify a user at or above your own level'
  }
  if ((target.role === 'super_admin' || target.role === 'admin') && !hasPermission('users.manage_admins')) {
    return 'Only a Super Admin can modify Admin accounts'
  }
  return null
}

/** Mirrors assert_can_assign_role(). */
function assertCanAssign(role: string): string | null {
  const me = actingProfile()
  if (!hasPermission('users.assign_role')) return 'You are not allowed to set user roles'
  if (!me || me.role === 'super_admin') return null
  if (rankOf(role as Role) >= rankOf(me.role)) {
    return 'You cannot assign a role at or above your own level'
  }
  if ((role === 'super_admin' || role === 'admin') && !hasPermission('users.manage_admins')) {
    return 'Only a Super Admin can create or promote Admins'
  }
  return null
}

function lastActiveSuperAdmin(targetId: string) {
  const target = db.profiles.find((p) => p.id === targetId)
  if (target?.role !== 'super_admin') return false
  return db.profiles.filter((p) => p.role === 'super_admin' && p.status === 'active').length <= 1
}

function writeLog(action: string, targetId: string | null, previous: string | null, next: string | null, details?: Row) {
  const me = actingProfile()
  const target = db.profiles.find((p) => p.id === targetId)
  db.activity_logs.push({
    id: newId(),
    performed_by: me?.id ?? null,
    performed_by_name: me?.full_name || me?.email || 'System',
    performed_by_role: me?.role ?? null,
    action,
    target_user: targetId,
    target_user_name: target?.full_name || target?.email || null,
    previous_value: previous,
    new_value: next,
    details: details ?? null,
    created_at: new Date().toISOString(),
  })
}

function rpc(name: string, args: Row = {}): RpcResult {
  switch (name) {
    case 'my_permissions': {
      const me = actingProfile()
      if (!me || me.status !== 'active') return ok([])
      return ok(db.role_permissions.filter((g) => g.role === me.role).map((g) => g.permission))
    }

    case 'record_login': {
      const me = actingProfile()
      if (me) me.last_login = new Date().toISOString()
      return ok()
    }

    case 'assert_can_manage_user': {
      const denied = assertCanManage(String(args.p_target))
      return denied ? fail(denied) : ok()
    }

    case 'assert_can_create_user': {
      if (!hasPermission('users.create')) return fail('You are not allowed to create users')
      const denied = assertCanAssign(String(args.p_role))
      return denied ? fail(denied) : ok()
    }

    case 'assert_can_delete_user': {
      if (!hasPermission('users.delete')) return fail('You are not allowed to delete users')
      const denied = assertCanManage(String(args.p_target)) ?? null
      if (denied) return fail(denied)
      if (lastActiveSuperAdmin(String(args.p_target))) {
        return fail('This is the last active Super Admin — promote someone else first')
      }
      return ok()
    }

    case 'set_user_role': {
      const targetId = String(args.p_target)
      const role = String(args.p_role)
      const denied = assertCanManage(targetId) ?? assertCanAssign(role)
      if (denied) return fail(denied)

      const target = db.profiles.find((p) => p.id === targetId)!
      if (target.role === role) return ok(target)
      if (lastActiveSuperAdmin(targetId)) {
        return fail('This is the last active Super Admin — promote someone else first')
      }

      const previous = target.role
      target.role = role
      target.updated_at = new Date().toISOString()

      const action =
        role === 'super_admin' || role === 'admin'
          ? 'user.promote_admin'
          : previous === 'super_admin' || previous === 'admin'
            ? 'user.demote_admin'
            : rankOf(role as Role) > rankOf(previous as Role)
              ? 'user.promote'
              : 'user.demote'
      writeLog(action, targetId, previous, role)
      return ok(target)
    }

    case 'set_user_status': {
      const targetId = String(args.p_target)
      const status = String(args.p_status)
      if (!hasPermission('users.set_status')) {
        return fail('You are not allowed to change account status')
      }
      const denied = assertCanManage(targetId)
      if (denied) return fail(denied)

      const target = db.profiles.find((p) => p.id === targetId)!
      if (target.status === status) return ok(target)
      if (status !== 'active' && lastActiveSuperAdmin(targetId)) {
        return fail('This is the last active Super Admin — promote someone else first')
      }

      const previous = target.status
      target.status = status
      target.updated_at = new Date().toISOString()
      writeLog(
        status === 'active' ? 'user.activate' : status === 'inactive' ? 'user.deactivate' : 'user.status_change',
        targetId,
        previous,
        status,
      )
      return ok(target)
    }

    case 'update_user_profile': {
      const targetId = String(args.p_target)
      if (targetId !== currentUserId) {
        if (!hasPermission('users.update')) return fail('You are not allowed to edit other users')
        const denied = assertCanManage(targetId)
        if (denied) return fail(denied)
      }
      const target = db.profiles.find((p) => p.id === targetId)
      if (!target) return fail('User not found')

      const previous = target.full_name
      const name = String(args.p_full_name ?? '').trim()
      if (name) target.full_name = name
      target.phone_number = String(args.p_phone_number ?? '').trim() || null
      target.updated_at = new Date().toISOString()

      if (targetId !== currentUserId) writeLog('user.update', targetId, previous, target.full_name)
      return ok(target)
    }

    case 'log_password_reset_request': {
      const email = String(args.p_email ?? '').trim().toLowerCase()
      const target = db.profiles.find((p) => p.email.toLowerCase() === email)
      if (target) {
        writeLog('user.password_reset_request', target.id, null, null, {
          self_service: !args.p_by_admin,
        })
      }
      return ok()
    }

    case 'log_user_created':
      writeLog('user.create', String(args.p_target), null, String(args.p_role), {
        delivery: args.p_method,
      })
      return ok()

    case 'log_user_deleted':
      writeLog('user.delete', null, String(args.p_role ?? ''), null)
      return ok()

    default:
      return fail(`Unknown function: ${name}`)
  }
}

/**
 * Stands in for the admin-users edge function. The real one runs the same
 * assert_can_* checks before touching the Auth admin API; here the account is
 * simply a new profiles row, created active so the preview can be switched
 * into it straight away.
 */
function invokeAdminUsers(body: Row): RpcResult {
  const action = String(body.action ?? '')

  if (action === 'create') {
    const role = String(body.role ?? 'viewer')
    const check = rpc('assert_can_create_user', { p_role: role })
    if (check.error) return check

    const email = String(body.email ?? '').trim().toLowerCase()
    if (db.profiles.some((p) => p.email.toLowerCase() === email)) {
      return fail('Someone already has an account with that email.')
    }

    const id = newId()
    db.profiles.push({
      id,
      full_name: String(body.full_name ?? ''),
      email,
      phone_number: String(body.phone_number ?? '') || null,
      role,
      status: 'pending',
      invited_by: currentUserId,
      last_login: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    rpc('log_user_created', { p_target: id, p_role: role, p_method: 'email' })

    return ok({
      id,
      delivery: 'email',
      invite_link: null,
      message: `Invitation sent to ${email}.`,
    })
  }

  if (action === 'delete') {
    const targetId = String(body.user_id ?? '')
    const check = rpc('assert_can_delete_user', { p_target: targetId })
    if (check.error) return check

    const target = db.profiles.find((p) => p.id === targetId)
    rpc('log_user_deleted', { p_target: targetId, p_role: target?.role })
    db.profiles = db.profiles.filter((p) => p.id !== targetId)
    return ok({ message: 'Account deleted.' })
  }

  if (action === 'resend_invite') {
    const check = rpc('assert_can_manage_user', { p_target: String(body.user_id ?? '') })
    if (check.error) return check
    return ok({ invite_link: null, message: 'Invitation re-sent.' })
  }

  return fail(`Unknown action: ${action}`)
}

export const supabase = {
  storage,
  rpc(name: string, args?: Row) {
    return new Promise<RpcResult>((resolve) => setTimeout(() => resolve(rpc(name, args ?? {})), 60))
  },
  functions: {
    invoke(name: string, options?: { body?: Row }) {
      return new Promise<RpcResult>((resolve) =>
        setTimeout(() => {
          if (name !== 'admin-users') {
            resolve(fail(`Unknown function: ${name}`))
            return
          }
          resolve(invokeAdminUsers(options?.body ?? {}))
        }, 60),
      )
    },
  },
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
    async getUser() {
      return { data: { user: session().user }, error: null }
    },
    async signInWithPassword() {
      return { data: { session: session() }, error: null }
    },
    // There is no signUp in the real app any more; these two are what the
    // sign-in screen and the set-password screen call instead.
    async resetPasswordForEmail() {
      return { data: {}, error: null }
    },
    async updateUser() {
      return { data: { user: session().user }, error: null }
    },
  },
} as any
