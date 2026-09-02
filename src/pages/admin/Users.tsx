import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useUsers } from '../../hooks/useUsers'
import UserFormModal from '../../components/UserFormModal'
import { ROLE_LABELS, ROLES, STATUS_LABELS, canManageUser } from '../../lib/permissions'
import type { Role, UserStatus } from '../../lib/database.types'
import '../../components/ui.css'
import '../admin.css'

const STATUSES: UserStatus[] = ['active', 'pending', 'inactive']

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString()
}

export default function Users() {
  const { profile, can } = useAuth()
  const { users, loading, error, setStatus, sendPasswordReset, refresh } = useUsers()

  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<Role | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<UserStatus | 'all'>('all')
  const [showForm, setShowForm] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return users.filter((user) => {
      if (roleFilter !== 'all' && user.role !== roleFilter) return false
      if (statusFilter !== 'all' && user.status !== statusFilter) return false
      if (!term) return true
      return (
        user.full_name.toLowerCase().includes(term) ||
        user.email.toLowerCase().includes(term) ||
        (user.phone_number ?? '').toLowerCase().includes(term)
      )
    })
  }, [users, search, roleFilter, statusFilter])

  async function run(id: string, work: () => Promise<void>, success: string) {
    setBusyId(id)
    setActionError(null)
    setNotice(null)
    try {
      await work()
      setNotice(success)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'That did not work.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Users</h1>
          <p>
            Everyone with access to this CRM. Accounts are created here — there is no public
            sign-up.
          </p>
        </div>
        {can('users.create') && (
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>
            Add user
          </button>
        )}
      </div>

      <div className="admin-toolbar">
        <input
          className="admin-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email or phone"
          aria-label="Search users"
        />
        <select
          className="admin-filter"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as Role | 'all')}
          aria-label="Filter by role"
        >
          <option value="all">All roles</option>
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </select>
        <select
          className="admin-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as UserStatus | 'all')}
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        <span className="admin-count">
          {filtered.length} of {users.length}
        </span>
      </div>

      {notice && <p className="admin-success" style={{ marginTop: 0, marginBottom: 12 }}>{notice}</p>}
      {(actionError || error) && (
        <p className="admin-error" style={{ marginTop: 0, marginBottom: 12 }}>
          {actionError ?? error}
        </p>
      )}

      {loading ? (
        <p style={{ color: 'var(--text-soft)' }}>Loading users…</p>
      ) : filtered.length === 0 ? (
        <div className="card empty-state">
          <h3>No users match</h3>
          <p>Try a different search or clear the filters.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last login</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((user) => {
                const manageable = canManageUser(profile, user)
                const isSelf = user.id === profile?.id
                const busy = busyId === user.id

                return (
                  <tr key={user.id}>
                    <td>
                      <Link to={`/admin/users/${user.id}`} className="admin-name-link">
                        {user.full_name || '—'}
                      </Link>
                      {isSelf && <span className="admin-you"> (you)</span>}
                    </td>
                    <td>{user.email}</td>
                    <td>
                      <span className={`badge role-badge role-${user.role}`}>
                        {ROLE_LABELS[user.role]}
                      </span>
                    </td>
                    <td>
                      <span className={`badge status-badge status-${user.status}`}>
                        {STATUS_LABELS[user.status]}
                      </span>
                    </td>
                    <td>{formatDate(user.last_login)}</td>
                    <td>
                      <div className="admin-row-actions">
                        {can('users.set_status') && manageable && (
                          <button
                            className="btn btn-sm"
                            disabled={busy}
                            onClick={() =>
                              run(
                                user.id,
                                () =>
                                  setStatus(user.id, user.status === 'active' ? 'inactive' : 'active'),
                                user.status === 'active'
                                  ? `${user.full_name || user.email} deactivated.`
                                  : `${user.full_name || user.email} activated.`,
                              )
                            }
                          >
                            {user.status === 'active' ? 'Deactivate' : 'Activate'}
                          </button>
                        )}
                        {can('users.reset_password') && manageable && (
                          <button
                            className="btn btn-sm"
                            disabled={busy}
                            onClick={() =>
                              run(
                                user.id,
                                () => sendPasswordReset(user.email),
                                `Password reset link sent to ${user.email}.`,
                              )
                            }
                          >
                            Reset password
                          </button>
                        )}
                        <Link to={`/admin/users/${user.id}`} className="btn btn-sm">
                          Details
                        </Link>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <UserFormModal
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false)
            setNotice('User created. The invitation is on its way.')
            refresh()
          }}
        />
      )}
    </div>
  )
}
