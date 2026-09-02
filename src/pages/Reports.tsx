import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  useAllContacts,
  useCompanies,
  useFollowUps,
  useOrgSettings,
  useProfiles,
  useSiteVisits,
} from '../hooks/useCrmData'
import { useAgreementSends, useStoVersions } from '../hooks/useStoVersions'
import { STAGE_META } from '../lib/stage'
import { RELATIONSHIP_OPTIONS, relationshipLabel } from '../lib/company'
import { APPOINTMENT_KIND_LABELS } from '../lib/appointment'
import { SEND_STATUS_LIST, SEND_STATUS_META } from '../lib/stoVersion'
import { repLabel } from '../lib/rep'
import {
  dayKey,
  daysAgo,
  downloadCsv,
  formatDay,
  formatDayTime,
  inRange,
  monthKey,
  monthLabel,
  monthsBetween,
  presetRange,
  reportFilename,
  toCsv,
} from '../lib/reports'
import type { Company, Relationship, SendStatus, Stage } from '../lib/database.types'
import '../components/ui.css'
import './reports.css'

/* ===========================================================================
   Seven reports.
   ---------------------------------------------------------------------------
   Every one is a table over the same period and the same filters, so they
   share a filter bar, a CSV export and a print layout; only the rows differ.
   `slug` names the exported file, and `status` lists the status values that
   report understands — a status left over from another tab is ignored rather
   than silently narrowing the next table you open.
   =========================================================================== */
type Tab = 'visits' | 'agents' | 'interest' | 'follow-ups' | 'conversion' | 'sto' | 'feedback'

interface TabDef {
  value: Tab
  label: string
  slug: string
  title: string
  status?: { value: string; label: string }[]
}

const TABS: TabDef[] = [
  {
    value: 'visits',
    label: 'Monthly Visits',
    slug: 'monthly-visits',
    title: 'Monthly Marketing Visit Report',
    status: [
      { value: 'completed', label: 'Completed' },
      { value: 'scheduled', label: 'Scheduled' },
      { value: 'cancelled', label: 'Cancelled' },
    ],
  },
  {
    value: 'agents',
    label: 'Agent Performance',
    slug: 'agent-performance',
    title: 'Agent Performance Report',
  },
  {
    value: 'interest',
    label: 'Property Interest',
    slug: 'property-interest',
    title: 'Property Interest Report',
    status: [
      { value: 'sent', label: 'Sent the rates' },
      { value: 'accepted', label: 'Accepted the rates' },
      { value: 'visited', label: 'Visited' },
      { value: 'untouched', label: 'Nothing yet' },
    ],
  },
  {
    value: 'follow-ups',
    label: 'Follow-ups',
    slug: 'follow-ups',
    title: 'Follow-up Report',
    status: [
      { value: 'pending', label: 'Pending' },
      { value: 'overdue', label: 'Overdue' },
      { value: 'done', label: 'Done' },
      { value: 'skipped', label: 'Skipped' },
    ],
  },
  {
    value: 'conversion',
    label: 'Site Visit Conversion',
    slug: 'site-visit-conversion',
    title: 'Site Visit Conversion Report',
    status: [
      { value: 'sent', label: 'Rates sent after' },
      { value: 'accepted', label: 'Accepted after' },
      { value: 'none', label: 'Nothing sent' },
    ],
  },
  {
    value: 'sto',
    label: 'STO Agreements',
    slug: 'sto-agreements',
    title: 'STO Agreement Report',
    status: SEND_STATUS_LIST.map((v) => ({ value: v as string, label: SEND_STATUS_META[v].label })),
  },
  {
    value: 'feedback',
    label: 'Feedback & Recs',
    slug: 'feedback',
    title: 'Recommendations & Feedback Report',
  },
]

const TAB_BY_VALUE = Object.fromEntries(TABS.map((t) => [t.value, t])) as Record<Tab, TabDef>
const isTab = (v: string | null): v is Tab => v !== null && v in TAB_BY_VALUE

/** Prefix marking an agent who has no login: matched on the typed name. */
const TYPED_PREFIX = 'name:'

/**
 * A column, and how to pull it out of a row.
 *
 * One definition drives both the table and the CSV, so an export can never
 * quietly disagree with what is on screen.
 */
interface Column<T> {
  key: string
  label: string
  /** The exported value. The table renders `cell` when given, else this. */
  value: (row: T) => string | number | null
  cell?: (row: T) => React.ReactNode
  numeric?: boolean
}

interface VisitRow {
  id: string
  date: string
  company: string
  agent: string
  type: string
  property: string
  outcome: string
  nextAction: string
  followUp: string | null
  note: string | null
}

interface AgentRow {
  id: string
  agent: string
  hasLogin: boolean
  visits: number
  newCompanies: number
  stoSent: number
  svRequested: number
  svCompleted: number
  activePartners: number
}

interface InterestRow {
  id: string
  company: string
  type: string
  location: string
  property: string
  interest: string
  agent: string
  note: string | null
  /** Counted for the status filter, not printed. */
  sentCount: number
  acceptedCount: number
  visitCount: number
}

interface FollowUpRow {
  id: string
  due: string
  company: string
  contact: string
  agent: string
  action: string
  status: string
  daysLate: number | null
}

interface ConversionRow {
  id: string
  company: string
  firstVisit: string
  visits: number
  ratesSentOn: string | null
  daysToSend: number | null
  accepted: boolean
  stage: Stage
  agent: string
}

interface StoRow {
  id: string
  sentAt: string
  company: string
  contact: string
  email: string
  agreement: string
  statusKey: SendStatus
  status: string
  opened: string | null
  answered: string | null
  answeredBy: string | null
  agent: string
  note: string | null
}

interface FeedbackRow {
  id: string
  date: string
  company: string
  type: string
  source: string
  agent: string
  text: string
}

export default function Reports() {
  const { companies, loading: companiesLoading } = useCompanies()
  const { visits } = useSiteVisits()
  const { followUps } = useFollowUps()
  const { profiles } = useProfiles()
  const { contacts } = useAllContacts()
  const { versions } = useStoVersions()
  const { sends } = useAgreementSends()
  const { settings } = useOrgSettings()

  /* -------------------------------------------------------------------------
     Filters live in the URL. A report is something you send someone — "the
     August numbers for Arusha" has to survive being pasted into a chat.
     ------------------------------------------------------------------------- */
  const [params, setParams] = useSearchParams()
  const tab: Tab = isTab(params.get('tab')) ? (params.get('tab') as Tab) : 'visits'
  const def = TAB_BY_VALUE[tab]

  const defaults = useMemo(() => presetRange('last_90'), [])
  const from = params.get('from') || defaults.from
  const to = params.get('to') || defaults.to
  const agentFilter = params.get('agent') ?? ''
  const typeFilter = params.get('type') ?? ''
  const locationFilter = params.get('location') ?? ''
  const sheetFilter = params.get('sheet') ?? ''
  const statusFilter = def.status?.some((s) => s.value === params.get('status'))
    ? (params.get('status') as string)
    : ''

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (!value) next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  /* -------------------------------------------------------------------------
     Lookups shared by every report
     ------------------------------------------------------------------------- */
  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies])
  const contactById = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts])
  const versionById = useMemo(() => new Map(versions.map((v) => [v.id, v])), [versions])
  const companyName = (id: string | null) => (id && companyById.get(id)?.name) || 'Unknown company'
  const agentName = (profileId: string | null, typedName: string | null) =>
    repLabel(profiles, profileId, typedName, 'Unassigned')

  /** The property these reports are about. One house, named from the letterhead. */
  const propertyName = settings?.org_name || 'Zondela House'

  /**
   * Everyone who could be credited with something, with a login or without.
   *
   * The agent fields on the forms write a typed name and clear the profile
   * link, so a person's visits arrive under their name while a company they
   * saved themselves is still pinned by `owner_id`. Matching a typed name back
   * to the profile that bears it is what keeps one person from showing up as
   * two rows — the name is the only join available, so it is the one used.
   * A name matching no profile stays its own entry.
   */
  const people = useMemo(() => {
    const fromProfiles = profiles.map((p) => ({
      id: p.id,
      name: p.full_name || p.email,
      profileId: p.id as string | null,
      alias: p.full_name?.trim().toLowerCase() || null,
      hasLogin: true,
    }))
    const claimed = new Set(fromProfiles.map((p) => p.alias).filter(Boolean))

    const typed = new Set<string>()
    for (const v of visits) if (!v.rep_id && v.rep_name?.trim()) typed.add(v.rep_name.trim())
    for (const f of followUps)
      if (!f.assigned_to && f.assigned_name?.trim()) typed.add(f.assigned_name.trim())
    for (const c of companies) if (!c.owner_id && c.owner_name?.trim()) typed.add(c.owner_name.trim())

    const orphans = [...typed]
      .filter((n) => !claimed.has(n.toLowerCase()))
      .sort()
      .map((n) => ({
        id: `${TYPED_PREFIX}${n}`,
        name: n,
        profileId: null,
        alias: n.toLowerCase(),
        hasLogin: false,
      }))

    return [...fromProfiles, ...orphans]
  }, [profiles, visits, followUps, companies])

  const selectedAgent = useMemo(
    () => (agentFilter ? (people.find((p) => p.id === agentFilter) ?? null) : null),
    [agentFilter, people]
  )

  /** Does this record belong to a person, by link or by the name written on it? */
  const belongsTo = (
    person: { profileId: string | null; alias: string | null },
    profileId: string | null,
    typedName: string | null
  ) => {
    if (profileId) return profileId === person.profileId
    const typed = (typedName ?? '').trim().toLowerCase()
    return typed !== '' && typed === person.alias
  }

  const agentMatches = (profileId: string | null, typedName: string | null) =>
    !selectedAgent || belongsTo(selectedAgent, profileId, typedName)

  /** The locations on file, as they were typed. Country is free text on a company. */
  const locations = useMemo(() => {
    const seen = new Map<string, string>()
    for (const c of companies) {
      const name = c.country?.trim()
      if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name)
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b))
  }, [companies])

  /** Operators who were sent the selected agreement — the season, as a filter. */
  const sheetCompanyIds = useMemo(() => {
    if (!sheetFilter) return null
    const ids = new Set<string>()
    for (const send of sends) if (send.version_id === sheetFilter) ids.add(send.company_id)
    return ids
  }, [sheetFilter, sends])

  /** The company-shaped half of the filter bar, applied wherever a row has one. */
  const companyPasses = (company: Company | undefined) => {
    if (!company) return false
    if (typeFilter && company.relationship !== typeFilter) return false
    if (
      locationFilter &&
      (company.country ?? '').trim().toLowerCase() !== locationFilter.toLowerCase()
    )
      return false
    if (sheetCompanyIds && !sheetCompanyIds.has(company.id)) return false
    return true
  }

  // Every report reads the same filter values; listing them once and depending
  // on the tuple keeps the memo deps below honest and readable.
  const filterKey = [from, to, agentFilter, typeFilter, locationFilter, sheetFilter].join('|')

  /* =========================================================================
     Monthly visits
     ========================================================================= */
  const visitRows = useMemo<VisitRow[]>(
    () =>
      visits
        .filter((v) => inRange(v.scheduled_for, from, to))
        .filter((v) => companyPasses(companyById.get(v.company_id)))
        .filter((v) => agentMatches(v.rep_id, v.rep_name))
        .filter((v) => !statusFilter || v.status === statusFilter)
        .sort((a, b) => b.scheduled_for.localeCompare(a.scheduled_for))
        .map((v) => {
          // What happens next is the earliest follow-up booked at that company
          // on or after the visit — the answer to "and then?" on every row.
          const next = followUps
            .filter(
              (f) => f.company_id === v.company_id && dayKey(f.due_at) >= dayKey(v.scheduled_for)
            )
            .sort((a, b) => a.due_at.localeCompare(b.due_at))[0]
          return {
            id: v.id,
            date: v.scheduled_for,
            company: companyName(v.company_id),
            agent: agentName(v.rep_id, v.rep_name),
            type: APPOINTMENT_KIND_LABELS[v.kind],
            property: propertyName,
            outcome:
              v.status === 'completed'
                ? 'Completed'
                : v.status === 'cancelled'
                  ? 'Cancelled'
                  : 'Scheduled',
            nextAction:
              next?.note ?? (v.status === 'completed' ? 'Nothing booked' : 'Visit still ahead'),
            followUp: next?.due_at ?? null,
            note: v.summary?.trim() || null,
          }
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visits, followUps, companyById, profiles, settings, statusFilter, filterKey]
  )

  const visitColumns: Column<VisitRow>[] = [
    { key: 'date', label: 'Date', value: (r) => dayKey(r.date), cell: (r) => formatDay(r.date) },
    {
      key: 'company',
      label: 'Company',
      value: (r) => r.company,
      cell: (r) => <span className="rp-strong">{r.company}</span>,
    },
    { key: 'agent', label: 'Agent', value: (r) => r.agent },
    { key: 'type', label: 'Type', value: (r) => r.type },
    { key: 'property', label: 'Property', value: (r) => r.property },
    {
      key: 'outcome',
      label: 'Outcome',
      value: (r) => r.outcome,
      cell: (r) => <span className={`rp-pill rp-pill-${r.outcome.toLowerCase()}`}>{r.outcome}</span>,
    },
    { key: 'next', label: 'Next action', value: (r) => r.nextAction },
    {
      key: 'followUp',
      label: 'Follow-up',
      value: (r) => (r.followUp ? dayKey(r.followUp) : null),
      cell: (r) => formatDay(r.followUp),
    },
    { key: 'note', label: 'Note', value: (r) => r.note },
  ]

  /**
   * The months the visit report covers, newest first.
   *
   * "How many did we do in August?" is the first question asked of a report
   * called Monthly, so it opens with the answer. Empty months are kept — a
   * month with no visits in it is the finding — until the span is too long for
   * that, when only the months with something in them are listed.
   */
  const visitMonths = useMemo(() => {
    const spanned = monthsBetween(from, to)
    const keys =
      spanned.length > 0 ? spanned : [...new Set(visitRows.map((r) => monthKey(r.date)))].sort()
    return keys
      .map((key) => {
        const rows = visitRows.filter((r) => monthKey(r.date) === key)
        return {
          key,
          label: monthLabel(key),
          visits: rows.length,
          completed: rows.filter((r) => r.outcome === 'Completed').length,
          companies: new Set(rows.map((r) => r.company)).size,
          notes: rows.filter((r) => r.note).length,
        }
      })
      .reverse()
  }, [visitRows, from, to])

  /* =========================================================================
     Agent performance
     ========================================================================= */
  const agentRows = useMemo<AgentRow[]>(() => {
    return people
      .filter((p) => !agentFilter || agentFilter === p.id)
      .map((p) => {
        const owned = companies.filter(
          (c) => companyPasses(c) && belongsTo(p, c.owner_id, c.owner_name)
        )
        const theirVisits = visits.filter(
          (v) => companyPasses(companyById.get(v.company_id)) && belongsTo(p, v.rep_id, v.rep_name)
        )
        const inPeriod = theirVisits.filter((v) => inRange(v.scheduled_for, from, to))
        // A send records its sender as a link and nothing else, so an agent
        // with no login has none to their name.
        const theirSends = p.profileId
          ? sends.filter(
              (s) =>
                s.sent_by === p.profileId &&
                companyPasses(companyById.get(s.company_id)) &&
                inRange(s.sent_at, from, to)
            )
          : []

        return {
          id: p.id,
          agent: p.name,
          hasLogin: p.hasLogin,
          visits: inPeriod.length,
          newCompanies: owned.filter((c) => inRange(c.created_at, from, to)).length,
          stoSent: theirSends.length,
          // A site visit is booked, then it happens: requested counts what went
          // in the diary, completed what actually took place.
          svRequested: inPeriod.filter((v) => v.kind === 'site_visit').length,
          svCompleted: inPeriod.filter((v) => v.kind === 'site_visit' && v.status === 'completed')
            .length,
          // Companies of theirs already working with the house, which is what
          // the visiting is ultimately for.
          activePartners: owned.filter(
            (c) => c.relationship === 'existing_partner' || c.relationship === 'works_zondela'
          ).length,
        }
      })
      .sort((a, b) => b.visits - a.visits || a.agent.localeCompare(b.agent))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, companies, visits, sends, companyById, agentFilter, filterKey])

  const agentColumns: Column<AgentRow>[] = [
    {
      key: 'agent',
      label: 'Agent',
      // Flagged, because the row is built by matching a typed name: there is
      // no account behind it, and nothing stops two people sharing a spelling.
      value: (r) => (r.hasLogin ? r.agent : `${r.agent} (no login)`),
      cell: (r) => (
        <span className="rp-strong">
          {r.agent}
          {!r.hasLogin && <span className="rp-tag">no login</span>}
        </span>
      ),
    },
    { key: 'visits', label: 'Visits', value: (r) => r.visits, numeric: true },
    { key: 'new', label: 'New companies', value: (r) => r.newCompanies, numeric: true },
    { key: 'sto', label: 'STO sent', value: (r) => r.stoSent, numeric: true },
    { key: 'svReq', label: 'SV requested', value: (r) => r.svRequested, numeric: true },
    { key: 'svDone', label: 'SV completed', value: (r) => r.svCompleted, numeric: true },
    { key: 'partners', label: 'Active partners', value: (r) => r.activePartners, numeric: true },
  ]

  /* =========================================================================
     Property interest — where every company stands with the house
     ========================================================================= */
  const interestRows = useMemo<InterestRow[]>(() => {
    return companies
      .filter((c) => companyPasses(c) && agentMatches(c.owner_id, c.owner_name))
      .map((c) => {
        const theirSends = sends.filter((s) => s.company_id === c.id)
        const sent = theirSends.filter((s) => inRange(s.sent_at, from, to))
        const accepted = theirSends.filter((s) => s.status === 'accepted')
        const visited = visits.filter(
          (v) =>
            v.company_id === c.id && v.status === 'completed' && inRange(v.scheduled_for, from, to)
        )

        // What the record actually says about their interest, strongest first:
        // an acceptance beats a rates send, which beats a relationship label.
        const interest = accepted.length
          ? 'Accepted the rates'
          : sent.length
            ? 'Sent the rates'
            : (relationshipLabel(c.relationship) ?? STAGE_META[c.stage].label)

        return {
          id: c.id,
          company: c.name,
          type: relationshipLabel(c.relationship) ?? '—',
          location: c.country?.trim() || '—',
          property: propertyName,
          interest,
          agent: agentName(c.owner_id, c.owner_name),
          note: c.notes?.trim() || null,
          sentCount: sent.length,
          acceptedCount: accepted.length,
          visitCount: visited.length,
        }
      })
      .filter((r) => {
        switch (statusFilter) {
          case 'sent':
            return r.sentCount > 0
          case 'accepted':
            return r.acceptedCount > 0
          case 'visited':
            return r.visitCount > 0
          case 'untouched':
            return r.sentCount === 0 && r.visitCount === 0
          default:
            return true
        }
      })
      .sort(
        (a, b) =>
          b.acceptedCount - a.acceptedCount ||
          b.sentCount - a.sentCount ||
          a.company.localeCompare(b.company)
      )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies, sends, visits, profiles, settings, statusFilter, filterKey])

  const interestColumns: Column<InterestRow>[] = [
    {
      key: 'company',
      label: 'Company',
      value: (r) => r.company,
      cell: (r) => <span className="rp-strong">{r.company}</span>,
    },
    { key: 'type', label: 'Type', value: (r) => r.type },
    { key: 'location', label: 'Location', value: (r) => r.location },
    { key: 'property', label: 'Property', value: (r) => r.property },
    { key: 'interest', label: 'Interest status', value: (r) => r.interest },
    { key: 'agent', label: 'Agent', value: (r) => r.agent },
    { key: 'note', label: 'Note', value: (r) => r.note },
  ]

  /* =========================================================================
     Follow-ups
     ========================================================================= */
  const followUpRows = useMemo<FollowUpRow[]>(() => {
    const now = new Date()
    return followUps
      .filter((f) => inRange(f.due_at, from, to))
      .filter((f) => companyPasses(companyById.get(f.company_id)))
      .filter((f) => agentMatches(f.assigned_to, f.assigned_name))
      .filter((f) => {
        if (!statusFilter) return true
        if (statusFilter === 'overdue') return f.status === 'pending' && new Date(f.due_at) < now
        return f.status === statusFilter
      })
      .sort((a, b) => a.due_at.localeCompare(b.due_at))
      .map((f) => {
        const overdue = f.status === 'pending' && new Date(f.due_at) < now
        return {
          id: f.id,
          due: f.due_at,
          company: companyName(f.company_id),
          contact: (f.contact_id && contactById.get(f.contact_id)?.full_name) || '—',
          agent: agentName(f.assigned_to, f.assigned_name),
          action: f.note,
          status: overdue
            ? 'Overdue'
            : f.status === 'done'
              ? 'Done'
              : f.status === 'skipped'
                ? 'Skipped'
                : 'Pending',
          daysLate: overdue ? daysAgo(f.due_at) : null,
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followUps, companyById, contactById, profiles, statusFilter, filterKey])

  const followUpColumns: Column<FollowUpRow>[] = [
    { key: 'due', label: 'Due', value: (r) => dayKey(r.due), cell: (r) => formatDay(r.due) },
    {
      key: 'company',
      label: 'Company',
      value: (r) => r.company,
      cell: (r) => <span className="rp-strong">{r.company}</span>,
    },
    { key: 'contact', label: 'Contact', value: (r) => r.contact },
    { key: 'agent', label: 'Agent', value: (r) => r.agent },
    { key: 'action', label: 'What to do', value: (r) => r.action },
    {
      key: 'status',
      label: 'Status',
      value: (r) => r.status,
      cell: (r) => <span className={`rp-pill rp-pill-${r.status.toLowerCase()}`}>{r.status}</span>,
    },
    {
      key: 'late',
      label: 'Days late',
      value: (r) => r.daysLate,
      numeric: true,
      cell: (r) => (r.daysLate === null ? '—' : <span className="rp-danger">{r.daysLate}</span>),
    },
  ]

  /* =========================================================================
     Site visit conversion — did going out there lead anywhere?
     ========================================================================= */
  const conversionRows = useMemo<ConversionRow[]>(() => {
    const byCompany = new Map<string, { first: string; count: number; agent: string }>()
    for (const v of visits) {
      if (v.status === 'cancelled') continue
      // Site visits only: this report is about the cost of going out there.
      if (v.kind !== 'site_visit') continue
      if (!inRange(v.scheduled_for, from, to)) continue
      if (!companyPasses(companyById.get(v.company_id))) continue
      if (!agentMatches(v.rep_id, v.rep_name)) continue
      const seen = byCompany.get(v.company_id)
      if (!seen)
        byCompany.set(v.company_id, {
          first: v.scheduled_for,
          count: 1,
          agent: agentName(v.rep_id, v.rep_name),
        })
      else {
        seen.count += 1
        if (v.scheduled_for < seen.first) seen.first = v.scheduled_for
      }
    }

    return [...byCompany.entries()]
      .map(([id, { first, count, agent }]) => {
        // Only rates sent *after* the visit count as its result; a sheet sent a
        // month earlier says nothing about the trip.
        const after = sends
          .filter((s) => s.company_id === id && s.sent_at >= first)
          .sort((a, b) => a.sent_at.localeCompare(b.sent_at))
        const sentOn = after[0]?.sent_at ?? null
        return {
          id,
          company: companyName(id),
          firstVisit: first,
          visits: count,
          ratesSentOn: sentOn,
          daysToSend: sentOn
            ? Math.max(
                0,
                Math.round((new Date(sentOn).getTime() - new Date(first).getTime()) / 86_400_000)
              )
            : null,
          accepted: after.some((s) => s.status === 'accepted'),
          stage: companyById.get(id)?.stage ?? 'lead',
          agent,
        }
      })
      .filter((r) => {
        switch (statusFilter) {
          case 'sent':
            return r.ratesSentOn !== null
          case 'accepted':
            return r.accepted
          case 'none':
            return r.ratesSentOn === null
          default:
            return true
        }
      })
      .sort(
        (a, b) =>
          Number(b.accepted) - Number(a.accepted) ||
          Number(b.ratesSentOn !== null) - Number(a.ratesSentOn !== null) ||
          a.company.localeCompare(b.company)
      )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visits, sends, companyById, profiles, statusFilter, filterKey])

  const conversionColumns: Column<ConversionRow>[] = [
    {
      key: 'company',
      label: 'Company',
      value: (r) => r.company,
      cell: (r) => <span className="rp-strong">{r.company}</span>,
    },
    {
      key: 'first',
      label: 'First site visit',
      value: (r) => dayKey(r.firstVisit),
      cell: (r) => formatDay(r.firstVisit),
    },
    { key: 'visits', label: 'Site visits', value: (r) => r.visits, numeric: true },
    { key: 'agent', label: 'Agent', value: (r) => r.agent },
    {
      key: 'sent',
      label: 'Rates sent after',
      value: (r) => (r.ratesSentOn ? dayKey(r.ratesSentOn) : 'No'),
      cell: (r) =>
        r.ratesSentOn ? formatDay(r.ratesSentOn) : <span className="rp-muted">Not yet</span>,
    },
    {
      key: 'lag',
      label: 'Days to send',
      value: (r) => r.daysToSend,
      numeric: true,
      cell: (r) => (r.daysToSend === null ? '—' : r.daysToSend),
    },
    {
      key: 'accepted',
      label: 'Accepted',
      value: (r) => (r.accepted ? 'Yes' : 'No'),
      cell: (r) =>
        r.accepted ? (
          <span className="rp-pill rp-pill-accepted">Yes</span>
        ) : (
          <span className="rp-muted">—</span>
        ),
    },
    {
      key: 'stage',
      label: 'Stage now',
      value: (r) => STAGE_META[r.stage].label,
      cell: (r) => (
        <span
          className="badge"
          style={{ color: STAGE_META[r.stage].color, background: STAGE_META[r.stage].bg }}
        >
          {STAGE_META[r.stage].label}
        </span>
      ),
    },
  ]

  /* =========================================================================
     STO agreements — the season's rates, and the operators they went to
     ========================================================================= */
  const stoRows = useMemo<StoRow[]>(() => {
    return sends
      .filter((s) => inRange(s.sent_at, from, to))
      .filter((s) => companyPasses(companyById.get(s.company_id)))
      .filter((s) => agentMatches(s.sent_by, null))
      .filter((s) => !statusFilter || s.status === statusFilter)
      .sort((a, b) => b.sent_at.localeCompare(a.sent_at))
      .map((s) => ({
        id: s.id,
        sentAt: s.sent_at,
        company: companyName(s.company_id),
        contact: s.to_name ?? '—',
        email: s.to_email ?? '—',
        agreement: versionById.get(s.version_id)?.name ?? 'Withdrawn agreement',
        statusKey: s.status,
        status: SEND_STATUS_META[s.status].label,
        opened: s.viewed_at,
        answered: s.accepted_at ?? s.declined_at,
        answeredBy: s.responded_name
          ? `${s.responded_name}${s.responded_title ? `, ${s.responded_title}` : ''}`
          : null,
        agent: agentName(s.sent_by, null),
        // What the operator wrote back is the interesting half of this row;
        // the team's own note stands in when they wrote nothing.
        note: s.responded_note?.trim() || s.note?.trim() || null,
      }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sends, versions, companyById, profiles, statusFilter, filterKey])

  const stoColumns: Column<StoRow>[] = [
    { key: 'sent', label: 'Sent', value: (r) => dayKey(r.sentAt), cell: (r) => formatDay(r.sentAt) },
    {
      key: 'company',
      label: 'Company',
      value: (r) => r.company,
      cell: (r) => <span className="rp-strong">{r.company}</span>,
    },
    { key: 'contact', label: 'Contact', value: (r) => r.contact },
    { key: 'email', label: 'Email', value: (r) => r.email },
    { key: 'agreement', label: 'Agreement', value: (r) => r.agreement },
    {
      key: 'status',
      label: 'Status',
      value: (r) => r.status,
      cell: (r) => (
        <span
          className="badge"
          title={SEND_STATUS_META[r.statusKey].hint}
          style={{
            background: SEND_STATUS_META[r.statusKey].bg,
            color: SEND_STATUS_META[r.statusKey].color,
          }}
        >
          {r.status}
        </span>
      ),
    },
    {
      key: 'opened',
      label: 'Opened',
      value: (r) => (r.opened ? dayKey(r.opened) : null),
      cell: (r) => (r.opened ? formatDayTime(r.opened) : <span className="rp-muted">Not yet</span>),
    },
    {
      key: 'answered',
      label: 'Answered',
      value: (r) => (r.answered ? dayKey(r.answered) : null),
      cell: (r) => (r.answered ? formatDayTime(r.answered) : <span className="rp-muted">—</span>),
    },
    { key: 'answeredBy', label: 'Accepted by', value: (r) => r.answeredBy },
    { key: 'agent', label: 'Agent', value: (r) => r.agent },
    { key: 'note', label: 'What they said', value: (r) => r.note },
  ]

  /* =========================================================================
     Feedback & recommendations — the qualitative record, in one stream
     ========================================================================= */
  const feedbackRows = useMemo<FeedbackRow[]>(() => {
    const rows: FeedbackRow[] = []
    const typeOf = (company: Company | undefined) =>
      relationshipLabel(company?.relationship ?? null) ?? 'Company'

    for (const v of visits) {
      if (!v.summary?.trim()) continue
      if (!inRange(v.scheduled_for, from, to)) continue
      const company = companyById.get(v.company_id)
      if (!companyPasses(company)) continue
      if (!agentMatches(v.rep_id, v.rep_name)) continue
      rows.push({
        id: `visit-${v.id}`,
        date: v.scheduled_for,
        company: companyName(v.company_id),
        type: typeOf(company),
        source: 'Feedback',
        agent: agentName(v.rep_id, v.rep_name),
        text: v.summary.trim(),
      })
    }

    // What an operator wrote back when they answered the rates — the only
    // words on this page that are the client's own.
    for (const s of sends) {
      if (!s.responded_note?.trim()) continue
      const when = s.accepted_at ?? s.declined_at ?? s.sent_at
      if (!inRange(when, from, to)) continue
      const company = companyById.get(s.company_id)
      if (!companyPasses(company)) continue
      if (!agentMatches(s.sent_by, null)) continue
      rows.push({
        id: `send-${s.id}`,
        date: when,
        company: companyName(s.company_id),
        type: typeOf(company),
        source: 'From the operator',
        agent: s.responded_name ?? agentName(s.sent_by, null),
        text: s.responded_note.trim(),
      })
    }

    for (const f of followUps) {
      if (!f.note?.trim()) continue
      if (!inRange(f.due_at, from, to)) continue
      const company = companyById.get(f.company_id)
      if (!companyPasses(company)) continue
      if (!agentMatches(f.assigned_to, f.assigned_name)) continue
      rows.push({
        id: `followup-${f.id}`,
        date: f.due_at,
        company: companyName(f.company_id),
        type: typeOf(company),
        source: 'Follow-up',
        agent: agentName(f.assigned_to, f.assigned_name),
        text: f.note.trim(),
      })
    }

    for (const c of companies) {
      if (!c.notes?.trim()) continue
      // A company note carries no date of its own; when the company was last
      // touched is the closest honest stand-in.
      if (!inRange(c.updated_at, from, to)) continue
      if (!companyPasses(c)) continue
      if (!agentMatches(c.owner_id, c.owner_name)) continue
      rows.push({
        id: `company-${c.id}`,
        date: c.updated_at,
        company: c.name,
        type: typeOf(c),
        source: 'Company note',
        agent: agentName(c.owner_id, c.owner_name),
        text: c.notes.trim(),
      })
    }

    return rows.sort((a, b) => b.date.localeCompare(a.date))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visits, sends, followUps, companies, companyById, profiles, filterKey])

  const feedbackColumns: Column<FeedbackRow>[] = [
    { key: 'date', label: 'Date', value: (r) => dayKey(r.date) },
    { key: 'company', label: 'Company', value: (r) => r.company },
    { key: 'type', label: 'Type', value: (r) => r.type },
    { key: 'source', label: 'Source', value: (r) => r.source },
    { key: 'agent', label: 'Agent', value: (r) => r.agent },
    { key: 'feedback', label: 'Feedback', value: (r) => r.text },
  ]

  /* =========================================================================
     Export
     ========================================================================= */
  /**
   * The report currently on screen, type-erased so one export path can serve
   * every tab. The columns and rows always come from the same branch, so the
   * erasure cannot pair a column with a row it does not fit.
   */
  const current = useMemo<{ columns: Column<never>[]; rows: never[] }>(() => {
    const pack = <T,>(columns: Column<T>[], rows: T[]) =>
      ({ columns, rows }) as unknown as { columns: Column<never>[]; rows: never[] }
    switch (tab) {
      case 'agents':
        return pack(agentColumns, agentRows)
      case 'interest':
        return pack(interestColumns, interestRows)
      case 'follow-ups':
        return pack(followUpColumns, followUpRows)
      case 'conversion':
        return pack(conversionColumns, conversionRows)
      case 'sto':
        return pack(stoColumns, stoRows)
      case 'feedback':
        return pack(feedbackColumns, feedbackRows)
      default:
        return pack(visitColumns, visitRows)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, visitRows, agentRows, interestRows, followUpRows, conversionRows, stoRows, feedbackRows])

  function exportCsv() {
    downloadCsv(
      reportFilename(def.slug, from, to),
      toCsv(
        current.columns.map((c) => c.label),
        current.rows.map((row) => current.columns.map((c) => c.value(row)))
      )
    )
  }

  /* =========================================================================
     Render
     ========================================================================= */
  const filterSummary = [
    `${formatDay(from)} – ${formatDay(to)}`,
    selectedAgent?.name ?? 'All agents',
    typeFilter ? relationshipLabel(typeFilter as Relationship) : 'All types',
    locationFilter || 'All locations',
    sheetFilter ? (versionById.get(sheetFilter)?.name ?? 'Selected agreement') : 'All agreements',
    statusFilter ? (def.status?.find((s) => s.value === statusFilter)?.label ?? '') : 'All statuses',
  ]
    .filter(Boolean)
    .join(' · ')

  const rowCount = current.rows.length

  /**
   * One table for every report.
   *
   * `noteOf` moves a row's free text under the row instead of into a cell: a
   * visit summary is a sentence, and a sentence in a column squeezes every
   * other column to nothing. It still exports as a column of its own.
   */
  function renderTable<T extends { id: string }>(
    columns: Column<T>[],
    rows: T[],
    empty: string,
    noteOf?: (row: T) => string | null
  ) {
    if (rows.length === 0) return <p className="rp-empty">{empty}</p>
    const visible = noteOf ? columns.filter((c) => c.key !== 'note') : columns
    return (
      <div className="rp-table-wrap">
        <table className="data-table rp-table">
          <thead>
            <tr>
              {visible.map((c) => (
                <th key={c.key} className={c.numeric ? 'rp-num' : undefined}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const note = noteOf?.(row)
              return (
                <tr key={row.id}>
                  {visible.map((c, i) => (
                    <td key={c.key} className={c.numeric ? 'rp-num' : undefined}>
                      {c.cell ? c.cell(row) : (c.value(row) ?? '—')}
                      {i === 0 && note && <span className="rp-note">{note}</span>}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="rp">
      <div className="page-header">
        <div>
          <h1>Reports</h1>
          <p>
            Executive reports across visits, agents, properties, follow-ups, STO, and site visits.
          </p>
        </div>
      </div>

      {/* Paper only. A printed table with no period on it is not a report, it
          is a list — so the range and the filters travel with it. */}
      <div className="rp-print-head">
        <h2>
          {propertyName} — {def.title}
        </h2>
        <p>{filterSummary}</p>
        <p>
          {rowCount} {rowCount === 1 ? 'row' : 'rows'} · generated{' '}
          {formatDay(new Date().toISOString())}
        </p>
      </div>

      <div className="card rp-filters rp-no-print">
        <h3>Filters</h3>
        <div className="rp-filter-row">
          <label className="rp-filter">
            <span>From</span>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setParam('from', e.target.value)}
            />
          </label>
          <label className="rp-filter">
            <span>To</span>
            <input type="date" value={to} min={from} onChange={(e) => setParam('to', e.target.value)} />
          </label>
          <label className="rp-filter">
            <span>Agent</span>
            <select value={selectedAgent?.id ?? ''} onChange={(e) => setParam('agent', e.target.value)}>
              <option value="">All agents</option>
              {people
                .filter((p) => p.hasLogin)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              {people.some((p) => !p.hasLogin) && (
                <optgroup label="No login">
                  {people
                    .filter((p) => !p.hasLogin)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </optgroup>
              )}
            </select>
          </label>
          <label className="rp-filter">
            <span>Company type</span>
            <select value={typeFilter} onChange={(e) => setParam('type', e.target.value)}>
              <option value="">All types</option>
              {RELATIONSHIP_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="rp-filter">
            <span>Location</span>
            <select value={locationFilter} onChange={(e) => setParam('location', e.target.value)}>
              <option value="">All locations</option>
              {locations.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="rp-filter">
            <span>Agreement</span>
            <select value={sheetFilter} onChange={(e) => setParam('sheet', e.target.value)}>
              <option value="">All agreements</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label className="rp-filter">
            <span>Status</span>
            <select
              value={statusFilter}
              disabled={!def.status}
              onChange={(e) => setParam('status', e.target.value)}
            >
              <option value="">{def.status ? 'All statuses' : 'Not on this report'}</option>
              {def.status?.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="rp-tabs rp-no-print" role="tablist" aria-label="Reports">
        {TABS.map((t) => (
          <button
            key={t.value}
            role="tab"
            aria-selected={tab === t.value}
            className={`rp-tab${tab === t.value ? ' active' : ''}`}
            onClick={() => setParam('tab', t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="card rp-panel">
        <div className="rp-panel-head">
          <h2>
            {def.title} <span className="rp-count">({rowCount})</span>
          </h2>
          <div className="rp-panel-actions rp-no-print">
            <button className="btn btn-sm" onClick={exportCsv}>
              CSV
            </button>
            <button className="btn btn-sm" onClick={() => window.print()}>
              PDF
            </button>
          </div>
        </div>

        {companiesLoading ? (
          <p className="rp-empty">Loading…</p>
        ) : tab === 'visits' ? (
          <>
            {visitRows.length > 0 && visitMonths.length > 0 && (
              <div className="rp-months">
                {visitMonths.map((m) => (
                  <div key={m.key} className="rp-month">
                    <span className="rp-month-label">{m.label}</span>
                    <span className="rp-month-value">{m.visits}</span>
                    <span className="rp-month-sub">
                      {m.completed} completed · {m.companies}{' '}
                      {m.companies === 1 ? 'company' : 'companies'} · {m.notes} noted
                    </span>
                  </div>
                ))}
              </div>
            )}
            {renderTable(visitColumns, visitRows, 'No visits in this period.', (r) => r.note)}
          </>
        ) : tab === 'agents' ? (
          renderTable(agentColumns, agentRows, 'No agent activity in this period.')
        ) : tab === 'interest' ? (
          renderTable(
            interestColumns,
            interestRows,
            'No companies match these filters.',
            (r) => r.note
          )
        ) : tab === 'follow-ups' ? (
          renderTable(followUpColumns, followUpRows, 'No follow-ups due in this period.')
        ) : tab === 'conversion' ? (
          renderTable(
            conversionColumns,
            conversionRows,
            'No site visits in this period to follow through.'
          )
        ) : tab === 'sto' ? (
          renderTable(stoColumns, stoRows, 'No agreements sent in this period.', (r) => r.note)
        ) : feedbackRows.length === 0 ? (
          <p className="rp-empty">Nothing was written down in this period.</p>
        ) : (
          /* Not a table: feedback is a paragraph, and a paragraph in a cell is
             unreadable. One card per note, newest first. */
          <ul className="rp-feedback">
            {feedbackRows.map((row) => (
              <li key={row.id} className="rp-feedback-card">
                <div className="rp-feedback-head">
                  <span className="rp-feedback-meta">
                    {dayKey(row.date)} · <strong>{row.company}</strong> · {row.type}
                  </span>
                  <span className="rp-feedback-agent">{row.agent}</span>
                </div>
                <p className="rp-feedback-text">
                  <span className="rp-feedback-label">{row.source}:</span> {row.text}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
