import type { Role, UserStatus } from './database.types'

/**
 * The role hierarchy and the rules that go with it.
 *
 * Everything here is for the UI only — hiding a button someone may not press,
 * and giving them the reason before they press it. None of it is a security
 * boundary. The same rules are implemented again in Postgres
 * (supabase/migrations/0001_closed_access_rbac.sql: assert_can_manage_user,
 * assert_can_assign_role, set_user_role, and the RLS policies), and it is that
 * copy which decides what actually happens. A request that skips this file
 * entirely — a hand-written fetch, a patched bundle — still hits the same
 * checks and still fails.
 *
 * Keep the two in step. If you change a grant below, change the seed in
 * role_permissions to match, or the UI will offer something the database
 * refuses.
 */

export const ROLES: Role[] = ['super_admin', 'admin', 'manager', 'staff', 'viewer']

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  manager: 'Manager',
  staff: 'Staff',
  viewer: 'Viewer',
}

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  super_admin: 'Full control of the system, including other administrators.',
  admin: 'Manages users and operational data. Cannot touch Super Admins.',
  manager: 'Sees the whole pipeline and reports. Changes no accounts.',
  staff: 'Works their own companies and the unclaimed pool.',
  viewer: 'Read-only access.',
}

/** Higher wins. Used for "you may only act on someone below you". */
export const ROLE_RANK: Record<Role, number> = {
  super_admin: 100,
  admin: 80,
  manager: 60,
  staff: 40,
  viewer: 20,
}

export const STATUS_LABELS: Record<UserStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  pending: 'Pending invite',
}

export type Permission =
  | 'users.view'
  | 'users.create'
  | 'users.update'
  | 'users.assign_role'
  | 'users.manage_admins'
  | 'users.set_status'
  | 'users.reset_password'
  | 'users.delete'
  | 'roles.view'
  | 'logs.view'
  | 'settings.manage'
  | 'settings.branding'
  | 'data.view_all'
  | 'data.write'
  | 'reports.view'

/**
 * Mirrors the role_permissions seed. Used as the fallback when the
 * my_permissions() call has not answered yet, and to render the Roles &
 * Permissions page offline; the live grants are read from the database.
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  super_admin: [
    'users.view',
    'users.create',
    'users.update',
    'users.assign_role',
    'users.manage_admins',
    'users.set_status',
    'users.reset_password',
    'users.delete',
    'roles.view',
    'logs.view',
    'settings.manage',
    'settings.branding',
    'data.view_all',
    'data.write',
    'reports.view',
  ],
  admin: [
    'users.view',
    'users.create',
    'users.update',
    'users.assign_role',
    'users.set_status',
    'users.reset_password',
    'roles.view',
    'logs.view',
    'settings.branding',
    'data.view_all',
    'data.write',
    'reports.view',
  ],
  manager: ['users.view', 'settings.branding', 'data.view_all', 'data.write', 'reports.view'],
  staff: ['data.write', 'reports.view'],
  viewer: ['reports.view'],
}

export function rankOf(role: Role | null | undefined): number {
  return role ? ROLE_RANK[role] ?? 0 : 0
}

export function roleLabel(role: Role | null | undefined): string {
  return role ? ROLE_LABELS[role] ?? role : '—'
}

/**
 * Whether `actor` may act on `target` at all — edit them, change their role,
 * activate or delete them.
 *
 * Super Admin is exempt from the rank rule: it is the top of the tree, so it
 * has to be able to appoint peers and successors. Nobody, Super Admin
 * included, may act on their own account from User management — that is the
 * rule that stops self-promotion.
 */
export function canManageUser(
  actor: { id: string; role: Role } | null,
  target: { id: string; role: Role },
): boolean {
  if (!actor) return false
  if (actor.id === target.id) return false
  if (actor.role === 'super_admin') return true
  return rankOf(target.role) < rankOf(actor.role)
}

/** Whether `actor` may hand out `role`. Same rule, applied to the new value. */
export function canAssignRole(actor: { role: Role } | null, role: Role): boolean {
  if (!actor) return false
  if (actor.role === 'super_admin') return true
  return rankOf(role) < rankOf(actor.role)
}

/** The roles this actor may choose from in a role dropdown. */
export function assignableRoles(actor: { role: Role } | null): Role[] {
  return ROLES.filter((role) => canAssignRole(actor, role))
}

/**
 * Why an action is unavailable, phrased for the person reading it. Returns
 * null when the action is allowed.
 */
export function whyCannotManage(
  actor: { id: string; role: Role } | null,
  target: { id: string; role: Role },
): string | null {
  if (!actor) return 'You are not signed in.'
  if (actor.id === target.id) return 'You cannot change your own account here.'
  if (actor.role === 'super_admin') return null
  if (rankOf(target.role) >= rankOf(actor.role)) {
    return `Only a Super Admin can change a ${ROLE_LABELS[target.role]}.`
  }
  return null
}
