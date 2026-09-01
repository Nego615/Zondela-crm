import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useSiteVisits, useCompanies, useProfiles } from '../hooks/useCrmData'
import { APPOINTMENT_KIND_LABELS, APPOINTMENT_KIND_STYLE } from '../lib/appointment'
import AppointmentFormModal from '../components/AppointmentFormModal'
import { repLabel } from '../lib/rep'
import '../components/ui.css'

type Filter = 'upcoming' | 'past' | 'all'

const FILTERS: Filter[] = ['upcoming', 'past', 'all']
const isFilter = (val: string | null): val is Filter => val !== null && (FILTERS as string[]).includes(val)

export default function Appointments() {
  const { visits, loading, updateVisit, refresh } = useSiteVisits()
  const { companies } = useCompanies()
  const { profiles } = useProfiles()
  const navigate = useNavigate()
  // Kept in the URL so the dashboard can link to a specific view.
  const [params, setParams] = useSearchParams()
  const fromUrl = params.get('filter')
  const filter: Filter = isFilter(fromUrl) ? fromUrl : 'upcoming'
  const [showNew, setShowNew] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const setFilter = (next: Filter) => setParams(next === 'upcoming' ? {} : { filter: next }, { replace: true })

  const companyName = (id: string) => companies.find((c) => c.id === id)?.name || 'Unknown company'


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
          <h1>Appointments</h1>
          <p>Site visits and meetings, scheduled and past, across the team.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>
          + Schedule
        </button>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {FILTERS.map((f) => (
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
        <p style={{ color: 'var(--text-soft)' }}>Loading appointments…</p>
      ) : filtered.length === 0 ? (
        <div className="empty-state card">
          <h3>Nothing here</h3>
          <p>Use Schedule to book a site visit or a meeting with a client.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Type</th>
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
                  <td>
                    <span className="badge" style={APPOINTMENT_KIND_STYLE[v.kind]}>
                      {APPOINTMENT_KIND_LABELS[v.kind]}
                    </span>
                  </td>
                  <td
                    style={{ fontWeight: 600, color: 'var(--ink)', cursor: 'pointer' }}
                    onClick={() => navigate(`/companies/${v.company_id}`)}
                  >
                    {companyName(v.company_id)}
                  </td>
                  <td>{repLabel(profiles, v.rep_id, v.rep_name)}</td>
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
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditing(v.id)}>
                      Edit
                    </button>
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

      {(showNew || editing) && (
        <AppointmentFormModal
          visit={editing ? visits.find((v) => v.id === editing) : undefined}
          onClose={() => {
            setShowNew(false)
            setEditing(null)
          }}
          onSaved={() => {
            setShowNew(false)
            setEditing(null)
            refresh()
          }}
        />
      )}
    </div>
  )
}
