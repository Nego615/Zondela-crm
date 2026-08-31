import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFollowUps, useCompanies, useProfiles } from '../hooks/useCrmData'
import '../components/ui.css'

type Filter = 'pending' | 'overdue' | 'done' | 'all'

export default function FollowUps() {
  const { followUps, loading, updateFollowUp } = useFollowUps()
  const { companies } = useCompanies()
  const { profiles } = useProfiles()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>('pending')

  const companyName = (id: string) => companies.find((c) => c.id === id)?.name || 'Unknown company'
  const repName = (id: string | null) => profiles.find((p) => p.id === id)?.full_name || '—'

  const filtered = useMemo(() => {
    const now = new Date()
    return followUps
      .filter((f) => {
        if (filter === 'pending') return f.status === 'pending'
        if (filter === 'overdue') return f.status === 'pending' && new Date(f.due_at) < now
        if (filter === 'done') return f.status === 'done'
        return true
      })
      .sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime())
  }, [followUps, filter])

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Follow-ups</h1>
          <p>Tasks the team needs to action, across all companies.</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {(['pending', 'overdue', 'done', 'all'] as Filter[]).map((f) => (
          <button key={f} className={`btn btn-sm ${filter === f ? 'btn-primary' : ''}`} onClick={() => setFilter(f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-soft)' }}>Loading follow-ups…</p>
      ) : filtered.length === 0 ? (
        <div className="empty-state card">
          <h3>Nothing here</h3>
          <p>Follow-ups are created from a company's page.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Due</th>
                <th>Note</th>
                <th>Company</th>
                <th>Assigned to</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((f) => {
                const overdue = f.status === 'pending' && new Date(f.due_at) < new Date()
                return (
                  <tr key={f.id}>
                    <td style={{ color: overdue ? 'var(--danger)' : undefined, fontWeight: overdue ? 600 : undefined }}>
                      {new Date(f.due_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                    </td>
                    <td>{f.note}</td>
                    <td
                      style={{ fontWeight: 600, color: 'var(--ink)', cursor: 'pointer' }}
                      onClick={() => navigate(`/companies/${f.company_id}`)}
                    >
                      {companyName(f.company_id)}
                    </td>
                    <td>{repName(f.assigned_to)}</td>
                    <td>
                      <span
                        className="badge"
                        style={{
                          background: f.status === 'done' ? 'var(--stage-won-bg)' : overdue ? '#fbeaea' : 'var(--stage-visit-bg)',
                          color: f.status === 'done' ? 'var(--stage-won)' : overdue ? 'var(--danger)' : 'var(--stage-visit)',
                        }}
                      >
                        {f.status === 'pending' && overdue ? 'Overdue' : f.status}
                      </span>
                    </td>
                    <td>
                      {f.status === 'pending' && (
                        <button className="btn btn-ghost btn-sm" onClick={() => updateFollowUp(f.id, { status: 'done' })}>
                          Mark done
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
