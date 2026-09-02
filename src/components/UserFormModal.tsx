import { useState, type FormEvent } from 'react'
import { useAuth } from '../hooks/useAuth'
import { assignableRoles, ROLE_DESCRIPTIONS, ROLE_LABELS } from '../lib/permissions'
import type { Profile, Role } from '../lib/database.types'
import { useUsers, type CreateUserResult } from '../hooks/useUsers'
import './ui.css'
import '../pages/admin.css'

interface Props {
  /** Omitted when inviting someone new. */
  user?: Profile
  onClose: () => void
  onSaved: () => void
}

/**
 * Invite a new user, or edit an existing one's details.
 *
 * The role dropdown only lists roles the signed-in administrator may actually
 * hand out — an Admin sees Manager, Staff and Viewer, a Super Admin sees all
 * five. That is a convenience, not the rule: assert_can_assign_role() in the
 * database checks the same thing against the caller's own JWT, so a request
 * that names a role that is not in this list is refused there.
 *
 * Editing does not include the role. Changing someone's role is its own
 * action, with its own audit entry, and lives on the user's detail page.
 */
export default function UserFormModal({ user, onClose, onSaved }: Props) {
  const { profile } = useAuth()
  const { createUser, updateUser } = useUsers()

  const editing = Boolean(user)
  const roleOptions = assignableRoles(profile)

  const [fullName, setFullName] = useState(user?.full_name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [phone, setPhone] = useState(user?.phone_number ?? '')
  const [role, setRole] = useState<Role>(user?.role ?? roleOptions[roleOptions.length - 1] ?? 'viewer')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<CreateUserResult | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!fullName.trim()) {
      setError('Full name is required.')
      return
    }
    if (!editing && !email.trim()) {
      setError('Email is required — it is where the invitation goes.')
      return
    }

    setSaving(true)
    try {
      if (user) {
        await updateUser(user.id, fullName.trim(), phone.trim() || null)
        onSaved()
      } else {
        const created = await createUser({
          full_name: fullName.trim(),
          email: email.trim(),
          phone_number: phone.trim(),
          role,
        })
        // When email delivery is not configured the account still exists, and
        // the reply carries a link to pass on by hand. Keep the modal open so
        // the admin can copy it — closing would lose it for good.
        if (created.delivery === 'link' && created.invite_link) {
          setResult(created)
        } else {
          onSaved()
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the user.')
    } finally {
      setSaving(false)
    }
  }

  if (result) {
    return (
      <div className="modal-backdrop" onClick={onSaved}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2>Account created</h2>
            <button className="btn btn-ghost btn-sm" onClick={onSaved}>
              Close
            </button>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-soft)', lineHeight: 1.6 }}>
            {result.message}
          </p>
          <div className="invite-link-box">
            Send this link to {email}. It sets their password and activates the account, and it
            can only be used once.
            <code>{result.invite_link}</code>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button
              type="button"
              className="btn"
              onClick={() => navigator.clipboard?.writeText(result.invite_link ?? '')}
            >
              Copy link
            </button>
            <button type="button" className="btn btn-primary" onClick={onSaved}>
              Done
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{editing ? 'Edit user' : 'Add user'}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="u_name">Full name</label>
            <input
              id="u_name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="John Doe"
            />
          </div>

          <div className="field">
            <label htmlFor="u_email">Email</label>
            <input
              id="u_email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="john@zondela.co.tz"
              disabled={editing}
              autoComplete="off"
            />
            {editing && (
              <span className="field-hint">
                The email is the login identity and cannot be changed here.
              </span>
            )}
          </div>

          <div className="field">
            <label htmlFor="u_phone">Phone number</label>
            <input
              id="u_phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+255 7XX XXX XXX"
            />
          </div>

          {!editing && (
            <div className="field">
              <label htmlFor="u_role">Role</label>
              <select id="u_role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {roleOptions.map((option) => (
                  <option key={option} value={option}>
                    {ROLE_LABELS[option]}
                  </option>
                ))}
              </select>
              <span className="field-hint">{ROLE_DESCRIPTIONS[role]}</span>
            </div>
          )}

          {!editing && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 14 }}>
              They will get an email with a link to set their own password. The account stays
              pending until they use it — you never see or set their password.
            </p>
          )}

          {error && <p className="admin-error" style={{ marginBottom: 12 }}>{error}</p>}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Send invitation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
