import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCompanies, useProfiles } from '../hooks/useCrmData'
import { STAGE_LIST, STAGE_META } from '../lib/stage'
import type { Stage } from '../lib/database.types'
import CompanyFormModal from '../components/CompanyFormModal'
import '../components/ui.css'

export default function Companies() {
  const { companies, loading, refresh } = useCompanies()
  const { profiles } = useProfiles()
  const navigate = useNavigate()

  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState<Stage | 'all'>('all')
  const [showNew, setShowNew] = useState(false)

  const repName = (id: string | null) => profiles.find((p) => p.id === id)?.full_name || '—'

  const filtered = useMemo(() => {
    return companies.filter((c) => {
      const matchesSearch =
        !search ||
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        (c.industry ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (c.city ?? '').toLowerCase().includes(search.toLowerCase())
      const matchesStage = stageFilter === 'all' || c.stage === stageFilter
      return matchesSearch && matchesStage
    })
  }, [companies, search, stageFilter])

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Companies</h1>
          <p>{companies.length} companies in the system.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>
          + Add company
        </button>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, industry, or city"
          style={{
            flex: 1,
            padding: '8px 12px',
            border: '1px solid var(--line-strong)',
            borderRadius: 'var(--radius)',
          }}
        />
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value as Stage | 'all')}
          style={{ padding: '8px 12px', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius)' }}
        >
          <option value="all">All stages</option>
          {STAGE_LIST.map((s) => (
            <option key={s} value={s}>
              {STAGE_META[s].label}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-soft)' }}>Loading companies…</p>
      ) : filtered.length === 0 ? (
        <div className="empty-state card">
          <h3>No companies match</h3>
          <p>Try a different search or add a new company.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Industry</th>
                <th>City</th>
                <th>Stage</th>
                <th>Rep</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const meta = STAGE_META[c.stage]
                return (
                  <tr key={c.id} onClick={() => navigate(`/companies/${c.id}`)} style={{ cursor: 'pointer' }}>
                    <td style={{ fontWeight: 600, color: 'var(--ink)' }}>{c.name}</td>
                    <td>{c.industry || '—'}</td>
                    <td>{c.city || '—'}</td>
                    <td>
                      <span className="badge" style={{ background: meta.bg, color: meta.color }}>
                        {meta.label}
                      </span>
                    </td>
                    <td>{repName(c.owner_id)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <CompanyFormModal
          onClose={() => setShowNew(false)}
          onSaved={() => {
            setShowNew(false)
            refresh()
          }}
        />
      )}
    </div>
  )
}
