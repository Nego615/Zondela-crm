import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { invalidate, useSharedResource } from './sharedResource'
import type { ActivityLog, PermissionRow, Profile, Role, RolePermissionRow, UserStatus } from '../lib/database.types'

/**
 * User management.
 *
 * Nothing here writes `role` or `status` directly — a trigger on profiles
 * rejects that, whoever sends it. Both go through set_user_role() and
 * set_user_status(), which re-check the hierarchy against the caller's own
 * JWT and write the audit log in the same transaction.
 *
 * Creating and deleting accounts need the service role key, which cannot live
 * in a browser bundle, so those two go to the `admin-users` edge function.
 */

export interface NewUserInput {
  full_name: string
  email: string
  phone_number?: string
  role: Role
}

export interface CreateUserResult {
  id: string
  /** 'email' when the invitation was sent; 'link' when SMTP is not set up. */
  delivery: 'email' | 'link'
  invite_link: string | null
  message: string
}

/** Turns a PostgREST/function error into something worth showing a person. */
function messageOf(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const raw = String((error as { message: unknown }).message)
    if (raw) return raw
  }
  return fallback
}

/** Pulls `{ error }` out of a failed edge function reply, if there is one. */
async function reasonFromResponse(response: Response | undefined): Promise<string | null> {
  if (!response || typeof response.clone !== 'function') return null
  try {
    const parsed = await response.clone().json()
    return parsed?.error ? String(parsed.error) : null
  } catch {
    return null
  }
}

/**
 * Calls the admin-users edge function.
 *
 * The user's access token goes along as the Authorization header — that, not
 * anything in the body, is what the function uses to work out who is calling
 * and whether they are allowed to.
 */
async function callAdminFunction<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body })

  if (error) {
    // The request never reached anything: the function is not deployed, or the
    // browser could not get to it. supabase-js calls this "Failed to send a
    // request to the Edge Function", which tells the person reading it nothing
    // about what to do — and because it *has* a message, the fallback below
    // never used to get its turn.
    if ((error as { name?: string }).name === 'FunctionsFetchError') {
      throw new Error(
        'Could not reach the user service. Deploy the admin-users edge function — see README step 4. Until then, add accounts from the Supabase dashboard (Authentication → Users) and set their role from Admin → Users.',
      )
    }

    // A non-2xx reply carries the real reason in its body ("Only a Super Admin
    // can create or promote Admins"); supabase-js only reports "Edge Function
    // returned a non-2xx status code", so dig the body out first.
    const reason = await reasonFromResponse((error as { context?: Response }).context)
    throw new Error(reason ?? messageOf(error, 'Could not reach the user service.'))
  }

  if (data && typeof data === 'object' && 'error' in data) {
    throw new Error(String((data as { error: unknown }).error))
  }
  return data as T
}

const NO_USERS: Profile[] = []
const NO_LOGS: ActivityLog[] = []

/**
 * The roster shares its key with useProfiles() in useCrmData, so a role or
 * status change made on the Users page also reaches every list that resolves a
 * rep's name — and the modal that saved it no longer holds a private copy the
 * page behind it cannot see.
 */
export function useUsers() {
  const {
    data: users,
    loading,
    error,
    refresh,
  } = useSharedResource(
    'profiles:all',
    NO_USERS,
    useCallback(async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('full_name', { ascending: true })
      if (error) throw new Error(messageOf(error, 'Could not load users.'))
      return (data ?? []) as Profile[]
    }, [])
  )

  async function createUser(input: NewUserInput): Promise<CreateUserResult> {
    const result = await callAdminFunction<CreateUserResult>({
      action: 'create',
      full_name: input.full_name,
      email: input.email,
      phone_number: input.phone_number ?? '',
      role: input.role,
    })
    await invalidate('profiles', 'activity_logs')
    return result
  }

  async function updateUser(id: string, fullName: string, phoneNumber: string | null) {
    const { error } = await supabase.rpc('update_user_profile', {
      p_target: id,
      p_full_name: fullName,
      p_phone_number: phoneNumber,
    })
    if (error) throw new Error(messageOf(error, 'Could not save the user.'))
    await invalidate('profiles', 'activity_logs')
  }

  async function setRole(id: string, role: Role) {
    const { error } = await supabase.rpc('set_user_role', { p_target: id, p_role: role })
    if (error) throw new Error(messageOf(error, 'Could not change the role.'))
    await invalidate('profiles', 'activity_logs')
  }

  async function setStatus(id: string, status: UserStatus) {
    const { error } = await supabase.rpc('set_user_status', { p_target: id, p_status: status })
    if (error) throw new Error(messageOf(error, 'Could not change the account status.'))
    await invalidate('profiles', 'activity_logs')
  }

  async function deleteUser(id: string) {
    await callAdminFunction<{ message: string }>({ action: 'delete', user_id: id })
    await invalidate('profiles', 'activity_logs')
  }

  /**
   * Sends the user a reset email through Supabase Auth — the same path the
   * self-service "Forgot password" form uses, so it works whether or not the
   * edge function is deployed.
   */
  async function sendPasswordReset(email: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    if (error) throw new Error(messageOf(error, 'Could not send the reset email.'))
    await supabase.rpc('log_password_reset_request', { p_email: email, p_by_admin: true })
    await invalidate('activity_logs')
  }

  /** Re-issues the invitation link for someone who never accepted theirs. */
  async function resendInvite(id: string) {
    return callAdminFunction<{ invite_link: string | null; message: string }>({
      action: 'resend_invite',
      user_id: id,
    })
  }

  return {
    users,
    loading,
    error,
    refresh,
    createUser,
    updateUser,
    setRole,
    setStatus,
    deleteUser,
    sendPasswordReset,
    resendInvite,
  }
}

/**
 * One account, for the detail page. Keyed under `profiles:` like the roster,
 * so the mutations above reach it too — a role changed on this page updates
 * the header without a reload.
 */
export function useUser(id: string | undefined) {
  const {
    data: user,
    loading,
    refresh,
  } = useSharedResource<Profile | null>(
    `profiles:one:${id ?? 'none'}`,
    null,
    useCallback(async () => {
      if (!id) return null
      const { data, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle()
      if (error) throw new Error(messageOf(error, 'Could not load the user.'))
      return (data as Profile | null) ?? null
    }, [id])
  )

  return { user, loading, refresh }
}

export function useActivityLogs(targetUserId?: string, limit = 200) {
  const {
    data: logs,
    loading,
    refresh,
  } = useSharedResource(
    `activity_logs:${targetUserId ?? 'all'}:${limit}`,
    NO_LOGS,
    useCallback(async () => {
      let query = supabase
        .from('activity_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit)
      if (targetUserId) query = query.eq('target_user', targetUserId)
      const { data, error } = await query
      if (error) throw new Error(messageOf(error, 'Could not load the activity log.'))
      return (data ?? []) as ActivityLog[]
    }, [targetUserId, limit])
  )

  return { logs, loading, refresh }
}

/** The live role → permission grants, for the Roles & Permissions page. */
export function useRolePermissions() {
  const [permissions, setPermissions] = useState<PermissionRow[]>([])
  const [grants, setGrants] = useState<RolePermissionRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [catalogue, granted] = await Promise.all([
        supabase.from('permissions').select('*').order('sort_order'),
        supabase.from('role_permissions').select('*'),
      ])
      if (cancelled) return
      setPermissions((catalogue.data ?? []) as PermissionRow[])
      setGrants((granted.data ?? []) as RolePermissionRow[])
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  return { permissions, grants, loading }
}
