import { useMemo } from 'react'
import { useUsers } from '../../hooks/useUsers'
import { ROLE_LABELS, ROLES } from '../../lib/permissions'
import '../../components/ui.css'
import '../admin.css'

/**
 * What the system currently looks like, and where the switches that are not in
 * the app actually live.
 *
 * Access itself is configured in Supabase, not here — turning signups off, SMTP
 * for invitation emails, session length. Rather than build a settings screen
 * that pretends to own those, this page states the current shape of the system
 * and points at the place each setting is really changed.
 */
export default function SystemSettings() {
  const { users, loading } = useUsers()

  const counts = useMemo(() => {
    const byRole = new Map<string, number>()
    let active = 0
    let pending = 0
    let inactive = 0
    for (const user of users) {
      byRole.set(user.role, (byRole.get(user.role) ?? 0) + 1)
      if (user.status === 'active') active += 1
      else if (user.status === 'pending') pending += 1
      else inactive += 1
    }
    return { byRole, active, pending, inactive }
  }, [users])

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>System settings</h1>
          <p>How access is configured, and where each setting is changed.</p>
        </div>
      </div>

      <div className="admin-detail-grid">
        <div style={{ display: 'grid', gap: 20 }}>
          <div className="card">
            <div className="panel-header">
              <h2>Access model</h2>
            </div>
            <dl className="admin-facts">
              <dt>Public sign-up</dt>
              <dd>Disabled — accounts are created by administrators only.</dd>
              <dt>New accounts</dt>
              <dd>Invitation email with a one-time password setup link.</dd>
              <dt>Password reset</dt>
              <dd>Self-service from the sign-in page, or triggered by an administrator.</dd>
              <dt>Inactive accounts</dt>
              <dd>Blocked at the database, not only in the interface.</dd>
              <dt>Audit trail</dt>
              <dd>Append-only. Written by the database on every sensitive action.</dd>
            </dl>
          </div>

          <div className="card">
            <div className="panel-header">
              <h2>Changed in Supabase, not here</h2>
              <p>These live with the auth provider.</p>
            </div>
            <dl className="admin-facts">
              <dt>Disable signups</dt>
              <dd>Authentication → Sign In / Providers → turn off "Allow new users to sign up".</dd>
              <dt>Invitation emails</dt>
              <dd>Project Settings → Authentication → SMTP. Without it, invitations fall back to a link you pass on yourself.</dd>
              <dt>Email templates</dt>
              <dd>Authentication → Emails → Invite user, and Reset password.</dd>
              <dt>Redirect URLs</dt>
              <dd>Authentication → URL Configuration. Must list /set-password and /reset-password.</dd>
              <dt>Role grants</dt>
              <dd>supabase/migrations/0001_closed_access_rbac.sql, in the role_permissions seed.</dd>
            </dl>
          </div>
        </div>

        <div className="card">
          <div className="panel-header">
            <h2>Accounts</h2>
          </div>
          {loading ? (
            <p style={{ color: 'var(--text-soft)', fontSize: 13 }}>Loading…</p>
          ) : (
            <dl className="admin-facts">
              <dt>Total</dt>
              <dd>{users.length}</dd>
              <dt>Active</dt>
              <dd>{counts.active}</dd>
              <dt>Pending invite</dt>
              <dd>{counts.pending}</dd>
              <dt>Inactive</dt>
              <dd>{counts.inactive}</dd>
              {ROLES.map((role) => (
                <div key={role} style={{ display: 'contents' }}>
                  <dt>{ROLE_LABELS[role]}</dt>
                  <dd>{counts.byRole.get(role) ?? 0}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    </div>
  )
}
