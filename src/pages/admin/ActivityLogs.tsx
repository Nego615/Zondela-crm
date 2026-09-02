import { useMemo, useState } from 'react'
import { useActivityLogs } from '../../hooks/useUsers'
import ActivityLogList from '../../components/ActivityLogList'
import '../../components/ui.css'
import '../admin.css'

/** The action groups worth filtering by, in the order they matter. */
const ACTION_FILTERS: { value: string; label: string; match: (action: string) => boolean }[] = [
  { value: 'all', label: 'All activity', match: () => true },
  {
    value: 'roles',
    label: 'Role changes',
    match: (a) => a.startsWith('user.promote') || a.startsWith('user.demote'),
  },
  {
    value: 'admins',
    label: 'Admin promotions',
    match: (a) => a === 'user.promote_admin' || a === 'user.demote_admin',
  },
  { value: 'accounts', label: 'Accounts created / deleted', match: (a) => a === 'user.create' || a === 'user.delete' },
  {
    value: 'status',
    label: 'Activation changes',
    match: (a) => a === 'user.activate' || a === 'user.deactivate' || a === 'user.status_change',
  },
  { value: 'passwords', label: 'Password resets', match: (a) => a === 'user.password_reset_request' },
]

export default function ActivityLogs() {
  const { logs, loading } = useActivityLogs(undefined, 300)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const rule = ACTION_FILTERS.find((f) => f.value === filter) ?? ACTION_FILTERS[0]
    const term = search.trim().toLowerCase()
    return logs.filter((log) => {
      if (!rule.match(log.action)) return false
      if (!term) return true
      return (
        (log.performed_by_name ?? '').toLowerCase().includes(term) ||
        (log.target_user_name ?? '').toLowerCase().includes(term) ||
        log.action.toLowerCase().includes(term)
      )
    })
  }, [logs, filter, search])

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Activity logs</h1>
          <p>
            Every sensitive administrative action, written by the database as it happens. The trail
            cannot be edited or deleted from the app.
          </p>
        </div>
      </div>

      <div className="admin-toolbar">
        <input
          className="admin-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by person or action"
          aria-label="Search activity"
        />
        <select
          className="admin-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter activity"
        >
          {ACTION_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="admin-count">{filtered.length} entries</span>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-soft)' }}>Loading activity…</p>
      ) : filtered.length === 0 ? (
        <div className="card empty-state">
          <h3>Nothing here yet</h3>
          <p>Role changes, new accounts and activation changes will show up here.</p>
        </div>
      ) : (
        <div className="card">
          <ActivityLogList logs={filtered} />
        </div>
      )}
    </div>
  )
}
