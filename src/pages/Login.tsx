import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import BrandMark from '../components/BrandMark'
import '../components/ui.css'
import './login.css'

/**
 * Sign in, and nothing else.
 *
 * This is a closed system: there is no "create an account" path, because
 * accounts only ever come from an administrator inviting someone from
 * Admin → Users. The two things a person can do without an account already
 * existing are sign in and ask for a password reset link.
 */
export default function Login() {
  const { blockedReason, clearBlockedReason } = useAuth()

  const [mode, setMode] = useState<'sign_in' | 'forgot'>('sign_in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    clearBlockedReason()

    if (!email) {
      setError('Enter your email address.')
      return
    }
    if (mode === 'sign_in' && !password) {
      setError('Enter your password.')
      return
    }

    setLoading(true)
    try {
      if (mode === 'sign_in') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        })
        if (error) throw error

        // Logged as a sensitive action. Writes nothing for an address with no
        // account, and returns the same either way.
        await supabase.rpc('log_password_reset_request', { p_email: email, p_by_admin: false })

        // Deliberately does not say whether the address is known — that would
        // turn this form into a way of finding out who works here.
        setInfo(
          'If that address has an account, a reset link is on its way. Check your inbox, and your spam folder.',
        )
        setPassword('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  function switchMode(next: 'sign_in' | 'forgot') {
    setMode(next)
    setError(null)
    setInfo(null)
    // Never leave a password on screen once the form has moved on.
    setShowPassword(false)
    clearBlockedReason()
  }

  return (
    <div className="login-page">
      <div className="login-card card">
        <div className="login-brand">
          <span className="login-brand-mark">
            <BrandMark size={26} />
          </span>
          <h1>Zondela House</h1>
        </div>
        <p className="login-sub">
          {mode === 'sign_in'
            ? 'Sign in to your pipeline.'
            : 'We will email you a link to set a new password.'}
        </p>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              autoComplete="email"
            />
          </div>

          {mode === 'sign_in' && (
            <div className="field">
              <label htmlFor="password">Password</label>
              <div className="password-field">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your password"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  // The icon carries no text, so the label has to say what the
                  // button does rather than what it currently looks like.
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  <EyeIcon crossed={showPassword} />
                </button>
              </div>
            </div>
          )}

          {blockedReason && <p className="login-error">{blockedReason}</p>}
          {error && <p className="login-error">{error}</p>}
          {info && <p className="login-info">{info}</p>}

          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
            {loading ? 'Please wait…' : mode === 'sign_in' ? 'Sign in' : 'Send reset link'}
          </button>
        </form>

        <button
          type="button"
          className="btn btn-ghost login-switch"
          onClick={() => switchMode(mode === 'sign_in' ? 'forgot' : 'sign_in')}
        >
          {mode === 'sign_in' ? 'Forgot your password?' : 'Back to sign in'}
        </button>

        <p className="login-note">
          Accounts are created by an administrator. If you need access, ask them to invite you.
        </p>
      </div>
    </div>
  )
}

/** An eye, struck through once the password is actually on screen. */
function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
      {crossed && <path d="m3.5 3.5 17 17" />}
    </svg>
  )
}
