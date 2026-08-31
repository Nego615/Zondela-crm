import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { addDays, differenceInCalendarDays, format, isToday, isTomorrow, startOfDay } from 'date-fns'
import { useAuth } from '../hooks/useAuth'
import { useCompanies, useFollowUps, useProfiles, useSiteVisits } from '../hooks/useCrmData'
import { BOARD_STAGES, STAGE_META } from '../lib/stage'
import type { Company, FollowUp } from '../lib/database.types'
import '../components/ui.css'
import './dashboard.css'

// How far ahead the agenda looks. A week is what a rep can act on; further out
// belongs on the Follow-ups and Site visits pages.
const HORIZON_DAYS = 7

// A company nobody has touched for this long, with nothing booked next, is the
// one the dashboard should surface — it will not resurface on its own.
const STALLED_AFTER_DAYS = 10

type Scope = 'mine' | 'all'

/** A follow-up or a visit, flattened so the two can be sorted into one agenda. */
interface AgendaItem {
  key: string
  kind: 'follow_up' | 'visit'
  at: Date
  title: string
  companyId: string
  assignedTo: string | null
  followUp?: FollowUp
}

export default function Dashboard() {
  const { profile, isOwner } = useAuth()
  const { companies, loading: companiesLoading } = useCompanies()
  const { visits } = useSiteVisits()
  const { followUps, updateFollowUp } = useFollowUps()
  const { profiles } = useProfiles()
  const navigate = useNavigate()

  const [scopeChoice, setScopeChoice] = useState<Scope | null>(null)

  const me = profile?.id ?? null
  // Owners open on the whole team, reps on their own work. Resolved at render
  // rather than as useState's initial value, which would be computed before the
  // profile (and so isOwner) has loaded and would then never update.
  const scope: Scope = scopeChoice ?? (isOwner ? 'all' : 'mine')

  // Fixed at mount so the horizon and the overdue cutoff cannot shift between
  // one memo and the next mid-render.
  const now = useMemo(() => new Date(), [])
  const today = startOfDay(now)
  const horizon = addDays(today, HORIZON_DAYS)

  // A rep can be assigned a follow-up on a company they cannot open: RLS shows
  // follow_ups where assigned_to is them, but companies only where they are the
  // owner. Then the name will not resolve, and linking it would send them to a
  // page that loads nothing.
  const findCompany = (id: string) => companies.find((c) => c.id === id)
  const repName = (id: string | null) => profiles.find((p) => p.id === id)?.full_name ?? null

  const scoped = useMemo(() => {
    const mine = scope === 'mine'
    return {
      companies: mine ? companies.filter((c) => c.owner_id === me) : companies,
      followUps: mine ? followUps.filter((f) => f.assigned_to === me) : followUps,
      visits: mine ? visits.filter((v) => v.rep_id === me) : visits,
    }
  }, [scope, me, companies, followUps, visits])

  const counts = useMemo(() => {
    const pending = scoped.followUps.filter((f) => f.status === 'pending')
    return {
      overdue: pending.filter((f) => new Date(f.due_at) < now).length,
      // Only what is still ahead today — anything earlier is already counted as
      // overdue, and showing it twice would overstate the day's load.
      laterToday: pending.filter((f) => {
        const due = new Date(f.due_at)
        return due >= now && isToday(due)
      }).length,
      visitsAhead: scoped.visits.filter((v) => {
        const at = new Date(v.scheduled_for)
        return v.status === 'scheduled' && at >= now && at <= horizon
      }).length,
      activeDeals: scoped.companies.filter((c) => BOARD_STAGES.includes(c.stage)).length,
    }
  }, [scoped, now, horizon])

  const agenda = useMemo(() => {
    const items: AgendaItem[] = []

    for (const f of scoped.followUps) {
      if (f.status !== 'pending') continue
      const at = new Date(f.due_at)
      if (at > horizon) continue
      items.push({
        key: `f-${f.id}`,
        kind: 'follow_up',
        at,
        title: f.note,
        companyId: f.company_id,
        assignedTo: f.assigned_to,
        followUp: f,
      })
    }

    for (const v of scoped.visits) {
      if (v.status !== 'scheduled') continue
      const at = new Date(v.scheduled_for)
      if (at > horizon) continue
      items.push({
        key: `v-${v.id}`,
        kind: 'visit',
        at,
        title: 'Site visit',
        companyId: v.company_id,
        assignedTo: v.rep_id,
      })
    }

    items.sort((a, b) => a.at.getTime() - b.at.getTime())

    // One bucket per day, with everything already past pulled to the front —
    // a visit that was never closed out matters as much as a late follow-up.
    const groups: { key: string; label: string; overdue: boolean; items: AgendaItem[] }[] = []
    for (const item of items) {
      const overdue = item.at < today
      const key = overdue ? 'overdue' : format(item.at, 'yyyy-MM-dd')
      let group = groups.find((g) => g.key === key)
      if (!group) {
        group = {
          key,
          label: overdue
            ? 'Overdue'
            : isToday(item.at)
              ? 'Today'
              : isTomorrow(item.at)
                ? 'Tomorrow'
                : format(item.at, 'EEEE d MMM'),
          overdue,
          items: [],
        }
        groups.push(group)
      }
      group.items.push(item)
    }
    return groups
  }, [scoped, today, horizon])

  const pipeline = useMemo(() => {
    const active = scoped.companies.filter((c) => BOARD_STAGES.includes(c.stage))
    const byStage = BOARD_STAGES.map((stage) => ({
      stage,
      count: active.filter((c) => c.stage === stage).length,
    }))
    const won = scoped.companies.filter((c) => c.stage === 'won').length
    const lost = scoped.companies.filter((c) => c.stage === 'lost').length
    const closed = won + lost
    return { byStage, total: active.length, won, lost, winRate: closed === 0 ? null : Math.round((won / closed) * 100) }
  }, [scoped])

  const stalled = useMemo(() => {
    const booked = new Set<string>()
    for (const f of followUps) if (f.status === 'pending') booked.add(f.company_id)
    for (const v of visits) if (v.status === 'scheduled') booked.add(v.company_id)

    return scoped.companies
      .filter((c) => BOARD_STAGES.includes(c.stage))
      .filter((c) => !booked.has(c.id))
      .map((c) => ({ company: c, idleDays: differenceInCalendarDays(now, new Date(c.updated_at)) }))
      .filter((s) => s.idleDays >= STALLED_AFTER_DAYS)
      .sort((a, b) => b.idleDays - a.idleDays)
  }, [scoped, followUps, visits, now])

  // Shown whatever the scope: the pool is nobody's until someone takes it, so
  // it is exactly the thing that goes unnoticed on a "my work" view.
  const unclaimed = useMemo(
    () => companies.filter((c) => c.owner_id === null && BOARD_STAGES.includes(c.stage)),
    [companies]
  )

  const firstName = (profile?.full_name || '').split(' ')[0]

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{firstName ? `Habari, ${firstName}` : 'Dashboard'}</h1>
          <p>
            {scope === 'mine' ? 'Your work' : 'The whole team'} for the next {HORIZON_DAYS} days —{' '}
            {format(now, 'EEEE d MMMM')}.
          </p>
        </div>
        {isOwner && (
          <div className="scope-switch" role="group" aria-label="Dashboard scope">
            <button
              className={`btn btn-sm${scope === 'all' ? ' btn-primary' : ''}`}
              onClick={() => setScopeChoice('all')}
              aria-pressed={scope === 'all'}
            >
              Whole team
            </button>
            <button
              className={`btn btn-sm${scope === 'mine' ? ' btn-primary' : ''}`}
              onClick={() => setScopeChoice('mine')}
              aria-pressed={scope === 'mine'}
            >
              Just me
            </button>
          </div>
        )}
      </div>

      <div className="tile-row">
        <button
          className={`tile${counts.overdue > 0 ? ' tile-alert' : ''}`}
          onClick={() => navigate('/follow-ups?filter=overdue')}
        >
          <span className="tile-label">Overdue follow-ups</span>
          <span className="tile-value">{counts.overdue}</span>
          <span className="tile-hint">{counts.overdue > 0 ? 'Past their due date' : 'Nothing late'}</span>
        </button>
        <button className="tile" onClick={() => navigate('/follow-ups?filter=pending')}>
          <span className="tile-label">Due later today</span>
          <span className="tile-value">{counts.laterToday}</span>
          <span className="tile-hint">Still ahead of you</span>
        </button>
        <button className="tile" onClick={() => navigate('/visits?filter=upcoming')}>
          <span className="tile-label">Visits this week</span>
          <span className="tile-value">{counts.visitsAhead}</span>
          <span className="tile-hint">Scheduled, next {HORIZON_DAYS} days</span>
        </button>
        <button className="tile" onClick={() => navigate('/pipeline')}>
          <span className="tile-label">Active deals</span>
          <span className="tile-value">{counts.activeDeals}</span>
          <span className="tile-hint">
            {pipeline.winRate === null ? 'No closed deals yet' : `${pipeline.winRate}% win rate so far`}
          </span>
        </button>
      </div>

      <div className="dash-grid">
        <section className="card dash-agenda">
          <div className="dash-card-head">
            <h3>What's next</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/follow-ups')}>
              All follow-ups
            </button>
          </div>

          {companiesLoading ? (
            <p className="dash-quiet">Loading…</p>
          ) : agenda.length === 0 ? (
            <p className="dash-quiet">
              Nothing due in the next {HORIZON_DAYS} days. Book a follow-up from a company's page to
              put something here.
            </p>
          ) : (
            agenda.map((group) => (
              <div key={group.key} className="agenda-group">
                <h4 className={`agenda-day${group.overdue ? ' agenda-day-overdue' : ''}`}>
                  {group.label}
                  <span className="agenda-day-count">{group.items.length}</span>
                </h4>
                <ul className="agenda-list">
                  {group.items.map((item) => (
                    <li key={item.key} className="agenda-item">
                      <span
                        className="badge agenda-kind"
                        style={
                          item.kind === 'visit'
                            ? { background: 'var(--stage-visit-bg)', color: 'var(--stage-visit)' }
                            : { background: 'var(--brand-teal-tint)', color: 'var(--brand-teal)' }
                        }
                      >
                        {item.kind === 'visit' ? 'Visit' : 'Follow up'}
                      </span>
                      <div className="agenda-body">
                        <p className="agenda-title">{item.title}</p>
                        <p className="agenda-meta">
                          {(() => {
                            const company = findCompany(item.companyId)
                            return company ? (
                              <button
                                className="link-button"
                                onClick={() => navigate(`/companies/${company.id}`)}
                              >
                                {company.name}
                              </button>
                            ) : (
                              <span className="agenda-unknown">Company not shared with you</span>
                            )
                          })()}
                          {' · '}
                          {format(item.at, 'HH:mm')}
                          {scope === 'all' && repName(item.assignedTo) ? ` · ${repName(item.assignedTo)}` : ''}
                        </p>
                      </div>
                      {item.followUp && (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => updateFollowUp(item.followUp!.id, { status: 'done' })}
                        >
                          Done
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>

        <div className="dash-side">
          <section className="card">
            <div className="dash-card-head">
              <h3>Pipeline</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate('/pipeline')}>
                Open board
              </button>
            </div>
            {pipeline.total === 0 ? (
              <p className="dash-quiet">No active deals in this view.</p>
            ) : (
              <>
                <div
                  className="pipe-bar"
                  role="img"
                  aria-label={pipeline.byStage
                    .filter((s) => s.count > 0)
                    .map((s) => `${STAGE_META[s.stage].label}: ${s.count}`)
                    .join(', ')}
                >
                  {pipeline.byStage
                    .filter((s) => s.count > 0)
                    .map((s) => (
                      <span
                        key={s.stage}
                        className="pipe-seg"
                        style={{
                          flexGrow: s.count,
                          background: STAGE_META[s.stage].color,
                        }}
                      />
                    ))}
                </div>
                <ul className="pipe-key">
                  {pipeline.byStage.map((s) => (
                    <li key={s.stage}>
                      <span className="pipe-dot" style={{ background: STAGE_META[s.stage].color }} />
                      <span className="pipe-key-label">{STAGE_META[s.stage].label}</span>
                      <span className="pipe-key-count">{s.count}</span>
                    </li>
                  ))}
                </ul>
                <div className="pipe-closed">
                  <span>
                    <strong style={{ color: 'var(--stage-won)' }}>{pipeline.won}</strong> won
                  </span>
                  <span>
                    <strong style={{ color: 'var(--stage-lost)' }}>{pipeline.lost}</strong> lost
                  </span>
                  <span>{pipeline.winRate === null ? '— win rate' : `${pipeline.winRate}% win rate`}</span>
                </div>
              </>
            )}
          </section>

          {unclaimed.length > 0 && (
            <section className="card">
              <div className="dash-card-head">
                <h3>Unclaimed leads</h3>
              </div>
              <p className="dash-quiet dash-quiet-tight">
                In the pool with no owner. Anyone can take these.
              </p>
              <ul className="mini-list">
                {unclaimed.map((c) => (
                  <li key={c.id}>
                    <button className="link-button" onClick={() => navigate(`/companies/${c.id}`)}>
                      {c.name}
                    </button>
                    <span className="badge" style={stageBadge(c)}>
                      {STAGE_META[c.stage].label}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card">
            <div className="dash-card-head">
              <h3>Going cold</h3>
            </div>
            {stalled.length === 0 ? (
              <p className="dash-quiet">
                {pipeline.total === 0
                  ? 'Nothing to watch yet — no active deals in this view.'
                  : 'Every active deal has a follow-up or a visit booked. Nothing is drifting.'}
              </p>
            ) : (
              <>
                <p className="dash-quiet dash-quiet-tight">
                  Active deals with nothing booked next, quietest first.
                </p>
                <ul className="mini-list">
                  {stalled.map(({ company, idleDays }) => (
                    <li key={company.id}>
                      <button className="link-button" onClick={() => navigate(`/companies/${company.id}`)}>
                        {company.name}
                      </button>
                      <span className="mini-note">{idleDays}d quiet</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

function stageBadge(company: Company) {
  const meta = STAGE_META[company.stage]
  return { background: meta.bg, color: meta.color }
}
