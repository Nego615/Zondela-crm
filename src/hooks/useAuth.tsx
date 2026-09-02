import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Profile, Role } from '../lib/database.types'
import { ROLE_PERMISSIONS, type Permission } from '../lib/permissions'

interface AuthContextValue {
  session: Session | null
  profile: Profile | null
  loading: boolean
  role: Role | null
  /** Granted by the user's role, read from the database on sign-in. */
  permissions: Permission[]
  /** UI gate only — the database enforces the same grant on every call. */
  can: (permission: Permission) => boolean
  isSuperAdmin: boolean
  /** Holds data.view_all: sees the whole pipeline, not only their own work. */
  isOwner: boolean
  /**
   * Set when the account exists but is not active — a pending invite, or one
   * an administrator has switched off. The session is signed out immediately,
   * so this is what the sign-in screen has left to explain.
   */
  blockedReason: string | null
  clearBlockedReason: () => void
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

const INACTIVE_MESSAGE =
  'This account has been deactivated. Ask an administrator to switch it back on.'
const PENDING_MESSAGE =
  'This account has not been set up yet. Open the invitation link in your email to choose a password.'

/**
 * The two screens an invited or locked-out user is *supposed* to reach.
 *
 * An invitation link opens a recovery session for an account that is still
 * `pending` — which is exactly the state the sign-out below is there to catch.
 * Signing them out on arrival would destroy the session they need to set a
 * password with, and the page would report a dead link. So on these two routes
 * the profile is loaded and left alone.
 *
 * Read off window rather than useLocation() so this does not depend on the
 * provider sitting inside a router, and covers the preview build's HashRouter
 * as well as the app's BrowserRouter.
 */
const PASSWORD_SETUP_PATHS = ['/set-password', '/reset-password']

function isPasswordSetupRoute() {
  const { pathname, hash } = window.location
  return PASSWORD_SETUP_PATHS.some((path) => pathname.startsWith(path) || hash.startsWith(`#${path}`))
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [loading, setLoading] = useState(true)
  const [blockedReason, setBlockedReason] = useState<string | null>(null)

  /**
   * Loads the profile and the permission set that goes with it.
   *
   * A profile whose status is not `active` ends the session on the spot. That
   * is a courtesy, not the lockout: deactivating someone does not invalidate
   * the token already in their browser, so the real enforcement is
   * is_active_user() inside every RLS policy. This just means they see a clear
   * message instead of an app full of empty tables.
   */
  async function loadProfile(userId: string) {
    setLoading(true)
    try {
      await loadProfileInner(userId)
    } finally {
      setLoading(false)
    }
  }

  async function loadProfileInner(userId: string) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
    const next = (data as Profile | null) ?? null

    // A non-active account never becomes the signed-in profile, and holds no
    // permissions — matching the database, where has_permission() returns false
    // for anything but `active`.
    if (next && next.status !== 'active') {
      setProfile(null)
      setPermissions([])
      // The one place the session is left alone: they arrived on their
      // invitation or reset link and are about to use it.
      if (!isPasswordSetupRoute()) {
        setBlockedReason(next.status === 'pending' ? PENDING_MESSAGE : INACTIVE_MESSAGE)
        await supabase.auth.signOut()
      }
      return
    }

    setProfile(next)

    if (!next) {
      setPermissions([])
      return
    }

    // The authoritative list, straight from role_permissions. The static map
    // is the fallback for the moment before it answers (or if it errors), so
    // the UI is never blank for a user who does have access.
    const { data: granted } = await supabase.rpc('my_permissions')
    setPermissions(
      Array.isArray(granted) && granted.length > 0
        ? (granted as Permission[])
        : ROLE_PERMISSIONS[next.role] ?? [],
    )
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session?.user) {
        loadProfile(session.user.id)
      } else {
        setLoading(false)
      }
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      if (session?.user) {
        loadProfile(session.user.id)
        // Stamp last_login for the User management list. Fire and forget: a
        // failed stamp must never stand between someone and their pipeline.
        if (event === 'SIGNED_IN') {
          supabase.rpc('record_login').then(() => {})
        }
      } else {
        setProfile(null)
        setPermissions([])
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  async function signOut() {
    await supabase.auth.signOut()
  }

  async function refreshProfile() {
    if (session?.user) await loadProfile(session.user.id)
  }

  const value: AuthContextValue = {
    session,
    profile,
    loading,
    role: profile?.role ?? null,
    permissions,
    can: (permission) => permissions.includes(permission),
    isSuperAdmin: profile?.role === 'super_admin',
    isOwner: permissions.includes('data.view_all'),
    blockedReason,
    clearBlockedReason: () => setBlockedReason(null),
    signOut,
    refreshProfile,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
