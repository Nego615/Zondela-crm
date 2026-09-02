import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useActivityLogs, useUser, useUsers } from '../../hooks/useUsers'
import UserFormModal from '../../components/UserFormModal'
import ActivityLogList from '../../components/ActivityLogList'
import {
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  STATUS_LABELS,
  assignableRoles,
  canManageUser,
  whyCannotManage,
} from '../../lib/permissions'
import type { Role } from '../../lib/database.types'
import '../../components/ui.css'
import '../admin.css'

function formatDateTime(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

export default function UserDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { profile, can } = useAuth()
  const { user, loading, refresh } = useUser(id)
  const { setRole, setStatus, deleteUser, sendPasswordReset, resendInvite } = useUsers()
  const { logs, loading: logsLoading, refresh: refreshLogs } = useActivityLogs(id, 50)

  const [pendingRole, setPendingRole] = useState<Role | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  // The dropdown starts on whatever the user's role is now, and re-syncs when
  // the row reloads after a save.
  useEffect(() => {
    if (user) setPendingRole(user.role)
  }, [user])

  if (loading) return <p style={{ color: 'var(--text-soft)' }}>Loading user…</p>

  if (!user) {
    return (
      <div className="card empty-state">
        <h3>User not found</h3>
        <p>
          They may have been deleted. <Link to="/admin/users">Back to all users</Link>
        </p>
      </div>
    )
  }

  // Bound once past the null check above, so the handlers below (hoisted
  // declarations, which TypeScript will not narrow into) have a non-null value
  // to close over.
  const target = user

  const manageable = canManageUser(profile, target)
  const lockedReason = whyCannotManage(profile, target)
  const roleOptions = assignableRoles(profile)
  const roleChanged = pendingRole !== null && pendingRole !== target.role
  const canEditRole = can('users.assign_role') && manageable

  async function run(work: () => Promise<void>, success: string) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await work()
      setNotice(success)
      await refresh()
      await refreshLogs()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  async function handleSaveRole() {
    if (!pendingRole || !roleChanged) return
    const from = ROLE_LABELS[target.role]
    const to = ROLE_LABELS[pendingRole]
    await run(
      () => setRole(target.id, pendingRole),
      `${target.full_name || target.email} changed from ${from} to ${to}.`,
    )
  }

  async function handleDelete() {
    const confirmed = window.confirm(
      `Delete ${target.full_name || target.email}? Their login and profile are removed for good. ` +
        'Their companies, follow-ups and agreements stay, unassigned. ' +
        'If you only want to block access, deactivate them instead.',
    )
    if (!confirmed) return

    setBusy(true)
    setError(null)
    try {
      await deleteUser(target.id)
      navigate('/admin/users', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the account.')
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{user.full_name || user.email}</h1>
          <p>
            <Link to="/admin/users">All users</Link> · {user.email}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {can('users.update') && manageable && (
            <button className="btn" onClick={() => setEditing(true)}>
              Edit details
            </button>
          )}
          {can('users.delete') && manageable && (
            <button className="btn btn-danger" onClick={handleDelete} disabled={busy}>
              Delete
            </button>
          )}
        </div>
      </div>

      {notice && <p className="admin-success" style={{ marginTop: 0 }}>{notice}</p>}
      {error && <p className="admin-error" style={{ marginTop: 0 }}>{error}</p>}
      {inviteLink && (
        <div className="invite-link-box">
          Email delivery is not configured, so pass this on yourself. It works once.
          <code>{inviteLink}</code>
        </div>
      )}

      <div className="admin-detail-grid" style={{ marginTop: 18 }}>
        <div style={{ display: 'grid', gap: 20 }}>
          <div className="card">
            <div className="panel-header">
              <h2>Role</h2>
            </div>

            <p style={{ fontSize: 13, color: 'var(--text-soft)', margin: '0 0 12px' }}>
              Current role:{' '}
              <span className={`badge role-badge role-${user.role}`}>{ROLE_LABELS[user.role]}</span>
            </p>

            {canEditRole ? (
              <>
                <div className="role-editor">
                  <div className="field">
                    <label htmlFor="role_select">Change role</label>
                    <select
                      id="role_select"
                      value={pendingRole ?? user.role}
                      onChange={(e) => setPendingRole(e.target.value as Role)}
                    >
                      {/* The user's current role is always listed, even when it
                          sits above what this administrator may assign, so the
                          dropdown never silently misreports where they are. */}
                      {(roleOptions.includes(user.role)
                        ? roleOptions
                        : [user.role, ...roleOptions]
                      ).map((option) => (
                        <option key={option} value={option}>
                          {ROLE_LABELS[option]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    className="btn btn-primary"
                    onClick={handleSaveRole}
                    disabled={busy || !roleChanged}
                  >
                    {busy ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
                <p className="field-hint" style={{ marginTop: 8, display: 'block' }}>
                  {ROLE_DESCRIPTIONS[pendingRole ?? user.role]}
                </p>
              </>
            ) : (
              <p className="admin-locked">
                {lockedReason ?? 'You do not have permission to change roles.'}
              </p>
            )}
          </div>

          <div className="card">
            <div className="panel-header">
              <h2>Account</h2>
            </div>
            <dl className="admin-facts">
              <dt>Status</dt>
              <dd>
                <span className={`badge status-badge status-${user.status}`}>
                  {STATUS_LABELS[user.status]}
                </span>
              </dd>
              <dt>Email</dt>
              <dd>{user.email}</dd>
              <dt>Phone</dt>
              <dd>{user.phone_number || '—'}</dd>
              <dt>Created</dt>
              <dd>{formatDateTime(user.created_at)}</dd>
              <dt>Last updated</dt>
              <dd>{formatDateTime(user.updated_at)}</dd>
              <dt>Last login</dt>
              <dd>{formatDateTime(user.last_login)}</dd>
            </dl>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
              {can('users.set_status') && manageable && (
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => setStatus(user.id, user.status === 'active' ? 'inactive' : 'active'),
                      user.status === 'active' ? 'Account deactivated.' : 'Account activated.',
                    )
                  }
                >
                  {user.status === 'active' ? 'Deactivate account' : 'Activate account'}
                </button>
              )}
              {can('users.reset_password') && manageable && (
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => sendPasswordReset(user.email),
                      `Password reset link sent to ${user.email}.`,
                    )
                  }
                >
                  Send password reset
                </button>
              )}
              {can('users.create') && manageable && user.status === 'pending' && (
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const result = await resendInvite(user.id)
                      setInviteLink(result.invite_link)
                    }, 'Invitation re-issued.')
                  }
                >
                  Re-send invitation
                </button>
              )}
            </div>

            {!manageable && (
              <p className="admin-locked" style={{ marginTop: 14 }}>
                {lockedReason}
              </p>
            )}
          </div>
        </div>

        <div className="card">
          <div className="panel-header">
            <h2>History</h2>
            <p>Administrative actions on this account.</p>
          </div>
          {logsLoading ? (
            <p style={{ color: 'var(--text-soft)', fontSize: 13 }}>Loading…</p>
          ) : logs.length === 0 ? (
            <p style={{ color: 'var(--text-soft)', fontSize: 13 }}>Nothing recorded yet.</p>
          ) : (
            <ActivityLogList logs={logs} />
          )}
        </div>
      </div>

      {editing && (
        <UserFormModal
          user={user}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            setNotice('Details saved.')
            refresh()
            refreshLogs()
          }}
        />
      )}
    </div>
  )
}
