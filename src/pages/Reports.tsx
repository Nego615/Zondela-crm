import { useMemo } from 'react'
import { useCompanies, useSiteVisits, useFollowUps, useProfiles } from '../hooks/useCrmData'
import { STAGE_LIST, STAGE_META } from '../lib/stage'
import '../components/ui.css'
import './reports.css'

export default function Reports() {
  const { companies } = useCompanies()
  const { visits } = useSiteVisits()
  const { followUps } = useFollowUps()
  const { profiles } = useProfiles()

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const s of STAGE_LIST) counts[s] = 0
    for (const c of companies) counts[c.stage]++
    return counts
  }, [companies])

  const winRate = useMemo(() => {
    const won = stageCounts.won ?? 0
    const lost = stageCounts.lost ?? 0
    const closed = won + lost
    return closed === 0 ? null : Math.round((won / closed) * 100)
  }, [stageCounts])

  const repStats = useMemo(() => {
    return profiles
      .filter((p) => p.role === 'marketing' || p.role === 'owner')
      .map((rep) => {
        const repCompanies = companies.filter((c) => c.owner_id === rep.id)
        const repVisitsCompleted = visits.filter((v) => v.rep_id === rep.id && v.status === 'completed').length
        const repVisitsScheduled = visits.filter((v) => v.rep_id === rep.id && v.status === 'scheduled').length
        const repFollowUpsDone = followUps.filter((f) => f.assigned_to === rep.id && f.status === 'done').length
        const repFollowUpsPending = followUps.filter((f) => f.assigned_to === rep.id && f.status === 'pending').length
        const repFollowUpsOverdue = followUps.filter(
          (f) => f.assigned_to === rep.id && f.status === 'pending' && new Date(f.due_at) < new Date()
        ).length
        const won = repCompanies.filter((c) => c.stage === 'won').length
        return {
          rep,
          totalCompanies: repCompanies.length,
          won,
          visitsCompleted: repVisitsCompleted,
          visitsScheduled: repVisitsScheduled,
          followUpsDone: repFollowUpsDone,
          followUpsPending: repFollowUpsPending,
          followUpsOverdue: repFollowUpsOverdue,
        }
      })
      .filter((r) => r.totalCompanies > 0 || r.visitsCompleted > 0 || r.followUpsDone > 0)
  }, [profiles, companies, visits, followUps])

  const maxStageCount = Math.max(1, ...STAGE_LIST.map((s) => stageCounts[s] ?? 0))

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Reports</h1>
          <p>How the pipeline and the team are moving.</p>
        </div>
      </div>

      <div className="metric-row">
        <div className="metric-card">
          <p className="metric-label">Total companies</p>
          <p className="metric-value">{companies.length}</p>
        </div>
        <div className="metric-card">
          <p className="metric-label">Won</p>
          <p className="metric-value" style={{ color: 'var(--stage-won)' }}>
            {stageCounts.won ?? 0}
          </p>
        </div>
        <div className="metric-card">
          <p className="metric-label">Lost</p>
          <p className="metric-value" style={{ color: 'var(--stage-lost)' }}>
            {stageCounts.lost ?? 0}
          </p>
        </div>
        <div className="metric-card">
          <p className="metric-label">Win rate</p>
          <p className="metric-value">{winRate === null ? '—' : `${winRate}%`}</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ marginBottom: 16 }}>Pipeline by stage</h3>
        <div className="stage-bars">
          {STAGE_LIST.map((s) => {
            const meta = STAGE_META[s]
            const count = stageCounts[s] ?? 0
            return (
              <div key={s} className="stage-bar-row">
                <span className="stage-bar-label">{meta.label}</span>
                <div className="stage-bar-track">
                  <div
                    className="stage-bar-fill"
                    style={{ width: `${(count / maxStageCount) * 100}%`, background: meta.color }}
                  />
                </div>
                <span className="stage-bar-count">{count}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 16 }}>Team activity</h3>
        {repStats.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No activity logged by team members yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Rep</th>
                <th>Companies</th>
                <th>Won</th>
                <th>Visits done</th>
                <th>Visits upcoming</th>
                <th>Follow-ups done</th>
                <th>Follow-ups pending</th>
                <th>Overdue</th>
              </tr>
            </thead>
            <tbody>
              {repStats.map((r) => (
                <tr key={r.rep.id}>
                  <td style={{ fontWeight: 600, color: 'var(--ink)' }}>{r.rep.full_name || r.rep.email}</td>
                  <td>{r.totalCompanies}</td>
                  <td>{r.won}</td>
                  <td>{r.visitsCompleted}</td>
                  <td>{r.visitsScheduled}</td>
                  <td>{r.followUpsDone}</td>
                  <td>{r.followUpsPending}</td>
                  <td style={{ color: r.followUpsOverdue > 0 ? 'var(--danger)' : undefined, fontWeight: r.followUpsOverdue > 0 ? 600 : undefined }}>
                    {r.followUpsOverdue}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
