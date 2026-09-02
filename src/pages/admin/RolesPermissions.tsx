import { Fragment, useMemo } from 'react'
import { useRolePermissions } from '../../hooks/useUsers'
import { ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS } from '../../lib/permissions'
import '../../components/ui.css'
import '../admin.css'

/**
 * The role hierarchy and the live permission grants behind it.
 *
 * Read-only on purpose. The grants are seeded by
 * supabase/migrations/0001_closed_access_rbac.sql and re-applied whenever that
 * runs, so an edit made here would be silently reverted on the next deploy —
 * better to show where the answer actually comes from.
 */
export default function RolesPermissions() {
  const { permissions, grants, loading } = useRolePermissions()

  const granted = useMemo(() => {
    const set = new Set<string>()
    for (const grant of grants) set.add(`${grant.role}:${grant.permission}`)
    return set
  }, [grants])

  const categories = useMemo(() => {
    const groups = new Map<string, typeof permissions>()
    for (const permission of permissions) {
      const list = groups.get(permission.category) ?? []
      list.push(permission)
      groups.set(permission.category, list)
    }
    return [...groups.entries()]
  }, [permissions])

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Roles &amp; permissions</h1>
          <p>
            What each role may do. Every check in the app and in the database goes through this
            table rather than testing role names, so changing a grant changes it everywhere.
          </p>
        </div>
      </div>

      <div className="admin-detail-grid">
        <div className="card" style={{ order: 2 }}>
          <div className="panel-header">
            <h2>Permissions</h2>
            <p>Live grants, read from the database.</p>
          </div>

          {loading ? (
            <p style={{ color: 'var(--text-soft)', fontSize: 13 }}>Loading…</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="perm-matrix">
                <thead>
                  <tr>
                    <th>Permission</th>
                    {ROLES.map((role) => (
                      <th key={role} className="perm-cell">
                        {ROLE_LABELS[role]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {categories.map(([category, rows]) => (
                    <Fragment key={category}>
                      <tr>
                        <th colSpan={ROLES.length + 1} style={{ paddingTop: 16 }}>
                          {category}
                        </th>
                      </tr>
                      {rows.map((permission) => (
                        <tr key={permission.key}>
                          <td>
                            <span className="perm-name">{permission.label}</span>
                            <span className="perm-desc">{permission.description}</span>
                          </td>
                          {ROLES.map((role) => (
                            <td key={role} className="perm-cell">
                              {granted.has(`${role}:${permission.key}`) ? (
                                <span className="perm-yes" aria-label="granted">
                                  ●
                                </span>
                              ) : (
                                <span className="perm-no" aria-label="not granted">
                                  –
                                </span>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card" style={{ order: 1 }}>
          <div className="panel-header">
            <h2>Hierarchy</h2>
            <p>Each level can act on the ones below it, never on its own or above.</p>
          </div>

          <div className="role-ladder">
            {ROLES.map((role, index) => (
              <div key={role}>
                <div className="role-ladder-step">
                  <h4>{ROLE_LABELS[role]}</h4>
                  <p>{ROLE_DESCRIPTIONS[role]}</p>
                </div>
                {index < ROLES.length - 1 && (
                  <div className="role-ladder-arrow" aria-hidden="true">
                    ↓
                  </div>
                )}
              </div>
            ))}
          </div>

          <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6, marginTop: 16 }}>
            Only a Super Admin can create or change an Admin. Nobody can change their own role, and
            the last active Super Admin cannot be demoted, deactivated or deleted.
          </p>
        </div>
      </div>
    </div>
  )
}
