import type { ActivityLog, Role } from '../lib/database.types'
import { ROLE_LABELS, STATUS_LABELS } from '../lib/permissions'
import './ui.css'
import '../pages/admin.css'

/**
 * Renders the audit trail as sentences rather than a grid of columns —
 * "Super Admin John promoted Sarah from Staff to Admin" is read at a glance in
 * a way that performed_by / action / previous_value / new_value is not.
 *
 * The rows carry snapshots of the names and roles as they were at the time, so
 * an entry still reads correctly after the people in it have been renamed or
 * deleted.
 */

function label(value: string | null): string {
  if (!value) return '—'
  const asRole = ROLE_LABELS[value as Role]
  if (asRole) return asRole
  const asStatus = STATUS_LABELS[value as keyof typeof STATUS_LABELS]
  if (asStatus) return asStatus
  return value
}

function actor(log: ActivityLog) {
  const role = log.performed_by_role ? ROLE_LABELS[log.performed_by_role] : null
  const name = log.performed_by_name ?? 'Someone'
  return role ? `${role} ${name}` : name
}

function sentence(log: ActivityLog): string {
  const who = actor(log)
  const target = log.target_user_name ?? 'a user'
  const from = label(log.previous_value)
  const to = label(log.new_value)

  switch (log.action) {
    case 'user.create':
      return `${who} created ${target} as ${to}.`
    case 'user.delete':
      return `${who} deleted ${target} (${from}).`
    case 'user.promote_admin':
      return `${who} promoted ${target} from ${from} to ${to}.`
    case 'user.demote_admin':
      return `${who} moved ${target} from ${from} down to ${to}.`
    case 'user.promote':
      return `${who} promoted ${target} from ${from} to ${to}.`
    case 'user.demote':
      return `${who} moved ${target} from ${from} to ${to}.`
    case 'user.activate':
      return `${who} activated ${target}'s account.`
    case 'user.deactivate':
      return `${who} deactivated ${target}'s account.`
    case 'user.status_change':
      return `${who} changed ${target}'s status from ${from} to ${to}.`
    case 'user.update':
      return `${who} edited ${target}'s details.`
    case 'user.password_reset_request':
      return log.details?.self_service
        ? `${target} requested a password reset.`
        : `${who} sent ${target} a password reset link.`
    case 'user.bootstrap_super_admin':
      return `${target} was made the first Super Admin from the database setup script.`
    default:
      return `${who} — ${log.action}${log.new_value ? `: ${to}` : ''}`
  }
}

export default function ActivityLogList({ logs }: { logs: ActivityLog[] }) {
  return (
    <div>
      {logs.map((log) => (
        <div key={log.id} className="log-entry">
          <div className="log-sentence">{sentence(log)}</div>
          <div className="log-meta">
            {new Date(log.created_at).toLocaleString()} · {log.action}
          </div>
        </div>
      ))}
    </div>
  )
}
