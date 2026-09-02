import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import BrandMark from '../components/BrandMark'
import '../components/ui.css'
import './login.css'

const MIN_LENGTH = 8

interface Props {
  /**
   * `invite` is the last step of an admin creating an account; `reset` is
   * someone who forgot their password. The flow is identical — Supabase has
   * already exchanged the emailed token for a session by the time we get here,
   * and all that is left is to set a password — so only the wording differs.
   */
  mode: 'invite' | 'reset'
}

/**
 * Where the invitation and password-reset emails land.
 *
 * Opening the link puts a short-lived recovery session in place, which is what
 * lets updateUser() set a password without knowing the old one. No session
 * means the link was already used, or it expired, and there is nothing to do
 * here but ask for a new one.
 */
export default function SetPassword({ mode }: Props) {
  const navigate = useNavigate()

  const [checking, setChecking] = useState(true)
  const [hasSession, setHasSession] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let cancelled = false

    // The token arrives in the URL fragment and is exchanged for a session
    // asynchronously, so a plain getSession() on mount can land just before it
    // is ready. Listening as well catches the PASSWORD_RECOVERY event that
    // follows.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return
      setHasSession(Boolean(session))
      setChecking(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return
      setHasSession(Boolean(session))
      setChecking(false)
    })

    return () => {
      cancelled = true
      listener.subscription.unsubscribe()
    }
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < MIN_LENGTH) {
      setError(`Use at least ${MIN_LENGTH} characters.`)
      return
    }
    if (password !== confirm) {
      setError('The two passwords do not match.')
      return
    }

    setSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error

      // Setting the password confirms the address, and the on_auth_user_confirmed
      // trigger flips the profile from pending to active. Signing out sends
      // them through a normal sign-in, which is what loads that fresh profile.
      setDone(true)
      await supabase.auth.signOut()
      setTimeout(() => navigate('/login', { replace: true }), 2500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set your password.')
    } finally {
      setSaving(false)
    }
  }

  const heading = mode === 'invite' ? 'Set your password' : 'Choose a new password'

  return (
    <div className="login-page">
      <div className="login-card card">
        <div className="login-brand">
          <span className="login-brand-mark">
            <BrandMark size={26} />
          </span>
          <h1>Zondela House</h1>
        </div>

        {checking ? (
          <p className="login-sub">Checking your link…</p>
        ) : done ? (
          <>
            <p className="login-sub">{heading}</p>
            <p className="login-info">
              Password saved. Taking you to the sign-in page…
            </p>
          </>
        ) : !hasSession ? (
          <>
            <p className="login-sub">This link is no longer valid.</p>
            <p className="login-note" style={{ borderTop: 'none', paddingTop: 0, textAlign: 'left' }}>
              {mode === 'invite'
                ? 'Invitation links expire, and can only be used once. Ask your administrator to send you a new one.'
                : 'Reset links expire, and can only be used once. Request a new one from the sign-in page.'}
            </p>
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', marginTop: 8 }}
              onClick={() => navigate('/login', { replace: true })}
            >
              Back to sign in
            </button>
          </>
        ) : (
          <>
            <p className="login-sub">
              {mode === 'invite'
                ? 'Pick a password and your account is ready to use.'
                : 'Pick a new password for your account.'}
            </p>

            <form onSubmit={handleSubmit}>
              <div className="field">
                <label htmlFor="new_password">New password</label>
                <input
                  id="new_password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={`At least ${MIN_LENGTH} characters`}
                  autoComplete="new-password"
                />
              </div>
              <div className="field">
                <label htmlFor="confirm_password">Confirm password</label>
                <input
                  id="confirm_password"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Type it again"
                  autoComplete="new-password"
                />
              </div>

              {error && <p className="login-error">{error}</p>}

              <button
                type="submit"
                className="btn btn-primary"
                style={{ width: '100%' }}
                disabled={saving}
              >
                {saving ? 'Saving…' : heading}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
