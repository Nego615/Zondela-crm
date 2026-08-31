import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCompanies, useFollowUps, useSiteVisits, useProfiles } from '../hooks/useCrmData'
import { BOARD_STAGES, STAGE_META } from '../lib/stage'
import type { Company, Stage } from '../lib/database.types'
import CompanyFormModal from '../components/CompanyFormModal'
import '../components/ui.css'
import './pipeline.css'

export default function Pipeline() {
  const { companies, loading, setStage, refresh } = useCompanies()
  const { followUps } = useFollowUps()
  const { visits } = useSiteVisits()
  const { profiles } = useProfiles()
  const navigate = useNavigate()

  const [showNew, setShowNew] = useState(false)
  const [dragStage, setDragStage] = useState<Stage | null>(null)

  const nextActionByCompany = useMemo(() => {
    const map = new Map<string, { label: string; overdue: boolean }>()
    const now = new Date()

    for (const fu of followUps) {
      if (fu.status !== 'pending') continue
      const due = new Date(fu.due_at)
      const existing = map.get(fu.company_id)
      const label = `Follow up ${due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
      if (!existing || due < new Date(existing.label)) {
        map.set(fu.company_id, { label, overdue: due < now })
      }
    }
    for (const v of visits) {
      if (v.status !== 'scheduled') continue
      const due = new Date(v.scheduled_for)
      if (!map.has(v.company_id)) {
        map.set(v.company_id, {
          label: `Visit ${due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
          overdue: due < now,
        })
      }
    }
    return map
  }, [followUps, visits])

  const repName = (id: string | null) => {
    if (!id) return null
    return profiles.find((p) => p.id === id)?.full_name || null
  }

  const columns = useMemo(() => {
    const grouped: Record<Stage, Company[]> = {
      lead: [],
      contacted: [],
      site_visit: [],
      proposal_sent: [],
      negotiation: [],
      won: [],
      lost: [],
    }
    for (const c of companies) grouped[c.stage].push(c)
    return grouped
  }, [companies])

  async function handleDrop(stage: Stage, e: React.DragEvent) {
    e.preventDefault()
    const companyId = e.dataTransfer.getData('text/company-id')
    if (companyId) {
      await setStage(companyId, stage)
    }
    setDragStage(null)
  }

  const wonCount = columns.won.length
  const lostCount = columns.lost.length

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Pipeline</h1>
          <p>Drag a company card to move it through the pipeline. Click a card for details.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>
          + Add company
        </button>
      </div>

      {loading ? (
        <p className="text-soft">Loading pipeline…</p>
      ) : companies.length === 0 ? (
        <div className="empty-state card">
          <h3>No companies yet</h3>
          <p>Add your first company to start building the pipeline.</p>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => setShowNew(true)}>
            + Add company
          </button>
        </div>
      ) : (
        <>
          <div className="board">
            {BOARD_STAGES.map((stage) => {
              const meta = STAGE_META[stage]
              const items = columns[stage]
              return (
                <div
                  key={stage}
                  className={`board-col${dragStage === stage ? ' drag-over' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragStage(stage)
                  }}
                  onDragLeave={() => setDragStage(null)}
                  onDrop={(e) => handleDrop(stage, e)}
                >
                  <div className="board-col-header">
                    <span className="board-col-dot" style={{ background: meta.color }} />
                    <span className="board-col-title">{meta.label}</span>
                    <span className="board-col-count">{items.length}</span>
                  </div>
                  <div className="board-col-body">
                    {items.map((company) => {
                      const nextAction = nextActionByCompany.get(company.id)
                      return (
                        <div
                          key={company.id}
                          className="board-card"
                          draggable
                          onDragStart={(e) => e.dataTransfer.setData('text/company-id', company.id)}
                          onClick={() => navigate(`/companies/${company.id}`)}
                        >
                          <p className="board-card-name">{company.name}</p>
                          {company.industry && <p className="board-card-meta">{company.industry}</p>}
                          <div className="board-card-footer">
                            {repName(company.owner_id) && (
                              <span className="board-card-rep">{repName(company.owner_id)}</span>
                            )}
                            {nextAction && (
                              <span className={`board-card-next${nextAction.overdue ? ' overdue' : ''}`}>
                                {nextAction.label}
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                    {items.length === 0 && <div className="board-col-empty">No companies</div>}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="board-summary">
            <div className="board-summary-item">
              <span className="badge" style={{ background: STAGE_META.won.bg, color: STAGE_META.won.color }}>
                Won
              </span>
              <span>{wonCount} companies</span>
            </div>
            <div className="board-summary-item">
              <span className="badge" style={{ background: STAGE_META.lost.bg, color: STAGE_META.lost.color }}>
                Lost
              </span>
              <span>{lostCount} companies</span>
            </div>
          </div>
        </>
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
