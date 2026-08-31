import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSiteVisits, useCompanies, useProfiles } from '../hooks/useCrmData'
import '../components/ui.css'

type Filter = 'upcoming' | 'past' | 'all'

export default function Visits() {
  const { visits, loading, updateVisit } = useSiteVisits()
  const { companies } = useCompanies()
  const { profiles } = useProfiles()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>('upcoming')

  const companyName = (id: string) => companies.find((c) => c.id === id)?.name || 'Unknown company'
  const repName = (id: string | null) => profiles.find((p) => p.id === id)?.full_name || '—'

  const filtered = useMemo(() => {
    const now = new Date()
    return visits
      .filter((v) => {
        if (filter === 'upcoming') return v.status === 'scheduled' && new Date(v.scheduled_for) >= now
        if (filter === 'past') return new Date(v.scheduled_for) < now || v.status !== 'scheduled'
        return true
      })
      .sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime())
  }, [visits, filter])

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Site visits</h1>
          <p>All scheduled and completed visits across the team.</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {(['upcoming', 'past', 'all'] as Filter[]).map((f) => (
          <button
            key={f}
            className={`btn btn-sm ${filter === f ? 'btn-primary' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'upcoming' ? 'Upcoming' : f === 'past' ? 'Past' : 'All'}
          </button>
        ))}
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-soft)' }}>Loading visits…</p>
      ) : filtered.length === 0 ? (
        <div className="empty-state card">
          <h3>No visits here</h3>
          <p>Schedule a site visit from a company's page.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Company</th>
                <th>Rep</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => (
                <tr key={v.id}>
                  <td>{new Date(v.scheduled_for).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td
                    style={{ fontWeight: 600, color: 'var(--ink)', cursor: 'pointer' }}
                    onClick={() => navigate(`/companies/${v.company_id}`)}
                  >
                    {companyName(v.company_id)}
                  </td>
                  <td>{repName(v.rep_id)}</td>
                  <td>
                    <span
                      className="badge"
                      style={{
                        background: v.status === 'completed' ? 'var(--stage-won-bg)' : v.status === 'cancelled' ? 'var(--stage-lost-bg)' : 'var(--stage-visit-bg)',
                        color: v.status === 'completed' ? 'var(--stage-won)' : v.status === 'cancelled' ? 'var(--stage-lost)' : 'var(--stage-visit)',
                      }}
                    >
                      {v.status}
                    </span>
                  </td>
                  <td>
                    {v.status === 'scheduled' && (
                      <button className="btn btn-ghost btn-sm" onClick={() => updateVisit(v.id, { status: 'completed' })}>
                        Mark done
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
