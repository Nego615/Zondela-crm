// ============================================================================
// admin-users — the only way an account is created in this system
// ============================================================================
// Creating a login, re-sending an invitation and deleting an account all need
// the Supabase service role key. That key can do anything in the project, so it
// can never reach the browser — which is why these three operations live here
// instead of in the React app.
//
// Every request is checked twice:
//
//   1. The caller's own JWT is used to build a normal, RLS-bound client, and
//      that client calls the assert_can_* functions in the database. Those
//      functions are the same ones the in-app RPCs use, so the hierarchy rules
//      (you may only act on someone below you; you may only hand out a role
//      below your own; Admins cannot touch Admins) are enforced in one place.
//   2. Only once a check has passed does the service-role client run the
//      privileged operation.
//
// Nothing in the request body decides who the caller is — that comes from the
// verified JWT alone. A caller who edits the payload to say `role: super_admin`
// gets a 403 from assert_can_create_user, not a promotion.
//
// Deploy:  supabase functions deploy admin-users
// Secrets: supabase secrets set SITE_URL=https://your-app.example.com
//          (SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are
//           injected by the platform.)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// Where the invitation and reset links land. Falls back to the local dev
// server so `supabase functions serve` works without extra setup.
const SITE_URL = Deno.env.get('SITE_URL') ?? 'http://localhost:5173'

const ROLES = ['super_admin', 'admin', 'manager', 'staff', 'viewer']

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

/** Postgres raises our authorisation failures with SQLSTATE 42501. */
function statusFor(error: { code?: string; message?: string }) {
  if (error.code === '42501') return 403
  if (error.code === 'P0002') return 404
  if (error.code === '22023') return 400
  return 400
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return json({ error: 'Not signed in' }, 401)
  }

  // Bound by RLS and by the caller's own permissions — used for every check.
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })

  // Bypasses RLS. Only ever used after a check above has passed.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: userData, error: userError } = await caller.auth.getUser()
  if (userError || !userData?.user) {
    return json({ error: 'Not signed in' }, 401)
  }
  const actorId = userData.user.id

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Expected a JSON body' }, 400)
  }

  const action = String(body.action ?? '')

  try {
    switch (action) {
      case 'create':
        return await createUser(body)
      case 'resend_invite':
        return await resendInvite(body)
      case 'reset_password':
        return await resetPassword(body)
      case 'delete':
        return await deleteUser(body)
      default:
        return json({ error: `Unknown action: ${action}` }, 400)
    }
  } catch (err) {
    console.error(action, err)
    return json({ error: err instanceof Error ? err.message : 'Something went wrong.' }, 500)
  }

  // --------------------------------------------------------------------------

  async function createUser(payload: Record<string, unknown>) {
    const email = String(payload.email ?? '').trim().toLowerCase()
    const fullName = String(payload.full_name ?? '').trim()
    const phone = String(payload.phone_number ?? '').trim()
    const role = String(payload.role ?? '')

    if (!email) return json({ error: 'Email is required.' }, 400)
    if (!fullName) return json({ error: 'Full name is required.' }, 400)
    if (!ROLES.includes(role)) return json({ error: 'Pick a role.' }, 400)

    // The gate. Checks that the caller is active, holds users.create, and is
    // allowed to hand out this particular role.
    const { error: denied } = await caller.rpc('assert_can_create_user', { p_role: role })
    if (denied) return json({ error: denied.message }, statusFor(denied))

    // inviteUserByEmail creates the account AND sends the invitation, which is
    // the flow we want. It needs SMTP configured on the project; if that has
    // not been done the call fails, and the fallback below creates the account
    // anyway and hands back a link the admin can pass on by hand.
    let userId: string | null = null
    let delivery = 'email'
    let inviteLink: string | null = null

    const invited = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName, phone_number: phone || null },
      redirectTo: `${SITE_URL}/set-password`,
    })

    if (invited.error) {
      // "already registered" is a real conflict, not an email problem.
      if (/already|exists|registered/i.test(invited.error.message)) {
        return json({ error: 'Someone already has an account with that email.' }, 409)
      }

      const created = await admin.auth.admin.createUser({
        email,
        email_confirm: false,
        user_metadata: { full_name: fullName, phone_number: phone || null },
      })
      if (created.error) return json({ error: created.error.message }, 400)
      userId = created.data.user.id

      const link = await admin.auth.admin.generateLink({
        type: 'invite',
        email,
        options: { redirectTo: `${SITE_URL}/set-password` },
      })
      if (link.error) return json({ error: link.error.message }, 400)

      delivery = 'link'
      inviteLink = link.data.properties?.action_link ?? null
    } else {
      userId = invited.data.user.id
    }

    if (!userId) return json({ error: 'Could not create the account.' }, 500)

    // on_auth_user_created has already inserted the profile as a pending
    // viewer. Raise it to the role the admin chose — service role, so past the
    // guard trigger, and correct because assert_can_create_user said so.
    const { error: profileError } = await admin
      .from('profiles')
      .update({
        full_name: fullName,
        phone_number: phone || null,
        role,
        status: 'pending',
        invited_by: actorId,
      })
      .eq('id', userId)

    if (profileError) return json({ error: profileError.message }, 400)

    await caller.rpc('log_user_created', {
      p_target: userId,
      p_role: role,
      p_method: delivery,
    })

    return json({
      id: userId,
      delivery,
      invite_link: inviteLink,
      message:
        delivery === 'email'
          ? `Invitation sent to ${email}.`
          : `Account created. Email delivery is not configured, so send them this link yourself.`,
    })
  }

  async function resendInvite(payload: Record<string, unknown>) {
    const targetId = String(payload.user_id ?? '')
    if (!targetId) return json({ error: 'user_id is required.' }, 400)

    const { error: denied } = await caller.rpc('assert_can_manage_user', { p_target: targetId })
    if (denied) return json({ error: denied.message }, statusFor(denied))

    const { data: profile, error: readError } = await admin
      .from('profiles')
      .select('email')
      .eq('id', targetId)
      .single()
    if (readError || !profile) return json({ error: 'User not found.' }, 404)

    const link = await admin.auth.admin.generateLink({
      type: 'invite',
      email: profile.email,
      options: { redirectTo: `${SITE_URL}/set-password` },
    })
    if (link.error) return json({ error: link.error.message }, 400)

    await caller.rpc('log_password_reset_request', {
      p_email: profile.email,
      p_by_admin: true,
    })

    return json({
      invite_link: link.data.properties?.action_link ?? null,
      message: `Invitation re-sent to ${profile.email}.`,
    })
  }

  async function resetPassword(payload: Record<string, unknown>) {
    const targetId = String(payload.user_id ?? '')
    if (!targetId) return json({ error: 'user_id is required.' }, 400)

    const { error: denied } = await caller.rpc('assert_can_manage_user', { p_target: targetId })
    if (denied) return json({ error: denied.message }, statusFor(denied))

    const { data: profile, error: readError } = await admin
      .from('profiles')
      .select('email')
      .eq('id', targetId)
      .single()
    if (readError || !profile) return json({ error: 'User not found.' }, 404)

    const link = await admin.auth.admin.generateLink({
      type: 'recovery',
      email: profile.email,
      options: { redirectTo: `${SITE_URL}/reset-password` },
    })
    if (link.error) return json({ error: link.error.message }, 400)

    await caller.rpc('log_password_reset_request', {
      p_email: profile.email,
      p_by_admin: true,
    })

    return json({
      reset_link: link.data.properties?.action_link ?? null,
      message: `Password reset link generated for ${profile.email}.`,
    })
  }

  async function deleteUser(payload: Record<string, unknown>) {
    const targetId = String(payload.user_id ?? '')
    if (!targetId) return json({ error: 'user_id is required.' }, 400)

    const { error: denied } = await caller.rpc('assert_can_delete_user', { p_target: targetId })
    if (denied) return json({ error: denied.message }, statusFor(denied))

    // Read the name and role before the row goes, so the log entry still says
    // who was removed once the foreign key has nulled out.
    const { data: profile } = await admin
      .from('profiles')
      .select('full_name, email, role')
      .eq('id', targetId)
      .single()

    // Logged first: a delete that succeeds and then fails to log is worse than
    // a log line for a delete that did not happen, and the second is visible.
    await caller.rpc('log_user_deleted', {
      p_target: targetId,
      p_name: profile?.full_name || profile?.email || 'Unknown user',
      p_role: profile?.role ?? null,
    })

    // Deleting the Auth user cascades to profiles via the foreign key.
    const { error: deleteError } = await admin.auth.admin.deleteUser(targetId)
    if (deleteError) return json({ error: deleteError.message }, 400)

    return json({ message: 'Account deleted.' })
  }
})
