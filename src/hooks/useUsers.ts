import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
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
    // A non-2xx reply carries the real reason in its body ("Only a Super Admin
    // can create or promote Admins"); supabase-js only reports "Edge Function
    // returned a non-2xx status code", so dig the body out first.
    const reason = await reasonFromResponse((error as { context?: Response }).context)
    throw new Error(
      reason ??
        messageOf(
          error,
          'Could not reach the user service. Deploy the admin-users edge function (see README).',
        ),
    )
  }

  if (data && typeof data === 'object' && 'error' in data) {
    throw new Error(String((data as { error: unknown }).error))
  }
  return data as T
}

export function useUsers() {
  const [users, setUsers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('full_name', { ascending: true })
    if (error) setError(messageOf(error, 'Could not load users.'))
    else setError(null)
    setUsers((data ?? []) as Profile[])
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function createUser(input: NewUserInput): Promise<CreateUserResult> {
    const result = await callAdminFunction<CreateUserResult>({
      action: 'create',
      full_name: input.full_name,
      email: input.email,
      phone_number: input.phone_number ?? '',
      role: input.role,
    })
    await refresh()
    return result
  }

  async function updateUser(id: string, fullName: string, phoneNumber: string | null) {
    const { error } = await supabase.rpc('update_user_profile', {
      p_target: id,
      p_full_name: fullName,
      p_phone_number: phoneNumber,
    })
    if (error) throw new Error(messageOf(error, 'Could not save the user.'))
    await refresh()
  }

  async function setRole(id: string, role: Role) {
    const { error } = await supabase.rpc('set_user_role', { p_target: id, p_role: role })
    if (error) throw new Error(messageOf(error, 'Could not change the role.'))
    await refresh()
  }

  async function setStatus(id: string, status: UserStatus) {
    const { error } = await supabase.rpc('set_user_status', { p_target: id, p_status: status })
    if (error) throw new Error(messageOf(error, 'Could not change the account status.'))
    await refresh()
  }

  async function deleteUser(id: string) {
    await callAdminFunction<{ message: string }>({ action: 'delete', user_id: id })
    await refresh()
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

export function useUser(id: string | undefined) {
  const [user, setUser] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!id) {
      setUser(null)
      setLoading(false)
      return
    }
    setLoading(true)
    const { data } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle()
    setUser((data as Profile | null) ?? null)
    setLoading(false)
  }, [id])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { user, loading, refresh }
}

export function useActivityLogs(targetUserId?: string, limit = 200) {
  const [logs, setLogs] = useState<ActivityLog[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('activity_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (targetUserId) query = query.eq('target_user', targetUserId)
    const { data } = await query
    setLogs((data ?? []) as ActivityLog[])
    setLoading(false)
  }, [targetUserId, limit])

  useEffect(() => {
    refresh()
  }, [refresh])

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
