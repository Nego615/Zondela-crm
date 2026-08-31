import { useProfiles } from '../hooks/useCrmData'
import { useAuth } from '../hooks/useAuth'
import '../components/ui.css'

export default function Team() {
  const { profiles, loading, updateRole } = useProfiles()
  const { profile: currentProfile } = useAuth()

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Team</h1>
          <p>Team members with access to this CRM. New members join by creating an account on the sign-in page.</p>
        </div>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-soft)' }}>Loading team…</p>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600, color: 'var(--ink)' }}>
                    {p.full_name || '—'} {p.id === currentProfile?.id && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> (you)</span>}
                  </td>
                  <td>{p.email}</td>
                  <td>
                    <select
                      value={p.role}
                      onChange={(e) => updateRole(p.id, e.target.value as 'owner' | 'marketing')}
                      disabled={p.id === currentProfile?.id}
                      style={{ padding: '5px 8px', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius)' }}
                    >
                      <option value="owner">Owner</option>
                      <option value="marketing">Marketing</option>
                    </select>
                  </td>
                  <td>{new Date(p.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card" style={{ marginTop: 20 }}>
        <h3 style={{ marginBottom: 8 }}>Adding a new team member</h3>
        <p style={{ fontSize: 13, color: 'var(--text-soft)', lineHeight: 1.6 }}>
          Share the app link with them and have them create their own account from the sign-in page. New accounts
          default to the marketing role — return here to promote anyone to owner.
        </p>
      </div>
    </div>
  )
}
