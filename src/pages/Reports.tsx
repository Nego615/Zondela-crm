import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  useAllContacts,
  useCompanies,
  useFollowUps,
  useProfiles,
  useSentMessages,
  useSiteVisits,
} from '../hooks/useCrmData'
import { useAgreementSends, useStoVersions } from '../hooks/useStoVersions'
import { useAuth } from '../hooks/useAuth'
import { STAGE_LIST, STAGE_META } from '../lib/stage'
import {
  MAIN_MARKET_OPTIONS,
  RELATIONSHIP_OPTIONS,
  mainMarketLabel,
  relationshipLabel,
} from '../lib/company'
import { APPOINTMENT_KINDS, APPOINTMENT_KIND_LABELS, APPOINTMENT_KIND_STYLE } from '../lib/appointment'
import {
  SEND_STATUS_LIST,
  SEND_STATUS_META,
  VERSION_STATUS_META,
  formatRate,
  rateRange,
  roomTypesOf,
  scopeLabel,
  seasonsOf,
} from '../lib/stoVersion'
import { repLabel } from '../lib/rep'
import {
  DATE_PRESETS,
  dayKey,
  daysAgo,
  downloadCsv,
  formatDay,
  formatDayTime,
  inRange,
  matchPreset,
  monthKey,
  monthLabel,
  monthsBetween,
  percent,
  presetRange,
  reportFilename,
  toCsv,
  type DatePreset,
} from '../lib/reports'
import type {
  AppointmentKind,
  Company,
  MainMarket,
  Relationship,
  SendStatus,
  Stage,
} from '../lib/database.types'
import '../components/ui.css'
import './reports.css'

/* ===========================================================================
   The ten reports.
   ---------------------------------------------------------------------------
   Every one is a table over the same period and the same filters, so they
   share a filter bar, a monthly breakdown, a CSV export and a print layout;
   only the rows differ. `slug` names the exported file, and `status` lists the
   status values that report understands — a status left over from another tab
   is ignored rather than silently narrowing the next table you open.
   =========================================================================== */
type Tab =
  | 'overview'
  | 'visits'
  | 'companies'
  | 'reps'
  | 'follow-ups'
  | 'agreements'
  | 'rates'
  | 'outreach'
  | 'conversion'
  | 'notes'

interface TabDef {
  value: Tab
  label: string
  slug: string
  title: string
  blurb: string
  status?: { value: string; label: string }[]
}

const TABS: TabDef[] = [
  {
    value: 'overview',
    label: 'Overview',
    slug: 'pipeline',
    title: 'Pipeline overview',
    blurb: 'Where every company stands, and what the period produced month by month.',
  },
  {
    value: 'visits',
    label: 'Visits & site visits',
    slug: 'visits',
    title: 'Marketing visit report',
    blurb:
      'Every site visit and meeting in the period, with its outcome, the summary written after it and what happens next.',
    status: [
      { value: 'completed', label: 'Completed' },
      { value: 'scheduled', label: 'Scheduled' },
      { value: 'cancelled', label: 'Cancelled' },
    ],
  },
  {
    value: 'companies',
    label: 'Companies',
    slug: 'companies',
    title: 'Company report',
    blurb:
      'Every client property in scope: what the period produced against it, and where it stands now.',
    status: [
      { value: 'visited', label: 'Visited in period' },
      { value: 'not_visited', label: 'Not visited' },
      { value: 'quoted', label: 'Quoted in period' },
      { value: 'accepted', label: 'Accepted in period' },
      { value: 'overdue', label: 'Has an overdue follow-up' },
    ],
  },
  {
    value: 'reps',
    label: 'Reps',
    slug: 'rep-performance',
    title: 'Rep performance',
    blurb: 'What each rep booked, closed and chased in the period.',
  },
  {
    value: 'follow-ups',
    label: 'Follow-ups',
    slug: 'follow-ups',
    title: 'Follow-up report',
    blurb: 'Everything due in the period, what was written on it, and how much is still open.',
    status: [
      { value: 'pending', label: 'Pending' },
      { value: 'overdue', label: 'Overdue' },
      { value: 'done', label: 'Done' },
      { value: 'skipped', label: 'Skipped' },
    ],
  },
  {
    value: 'agreements',
    label: 'STO agreements',
    slug: 'sto-agreements',
    title: 'STO agreements sent',
    blurb:
      'Every operator sent the season’s rates in the period: whether they opened them, what they answered, and anything they wrote back.',
    status: SEND_STATUS_LIST.map((v) => ({ value: v as string, label: SEND_STATUS_META[v].label })),
  },
  {
    value: 'rates',
    label: 'Rate sheets',
    slug: 'rate-sheets',
    title: 'Rate sheets',
    blurb:
      'The seasons Zondela House has published — what each one covers, what it costs, and how operators answered it.',
  },
  {
    value: 'outreach',
    label: 'STO outreach',
    slug: 'sto-outreach',
    title: 'STO outreach',
    blurb: 'Pricing and agreements sent to clients by email and WhatsApp.',
    status: [
      { value: 'email', label: 'Email' },
      { value: 'whatsapp', label: 'WhatsApp' },
    ],
  },
  {
    value: 'conversion',
    label: 'Visit conversion',
    slug: 'visit-conversion',
    title: 'Visit conversion',
    blurb: 'How far the companies visited in the period got afterwards.',
  },
  {
    value: 'notes',
    label: 'Notes & feedback',
    slug: 'notes-feedback',
    title: 'Notes & feedback',
    blurb: 'What clients actually said, gathered from visits, follow-ups and company notes.',
  },
]

const TAB_BY_VALUE = Object.fromEntries(TABS.map((t) => [t.value, t])) as Record<Tab, TabDef>
const isTab = (v: string | null): v is Tab => v !== null && v in TAB_BY_VALUE

/** Prefix marking a rep who has no login: matched on the typed name. */
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
  rep: string
  kind: string
  kindKey: AppointmentKind
  market: string
  relationship: string
  outcome: string
  nextAction: string
  followUpOn: string | null
  note: string | null
}

interface RepRow {
  id: string
  hasLogin: boolean
  name: string
  companies: number
  newCompanies: number
  visitsDone: number
  visitsUpcoming: number
  followUpsDone: number
  followUpsOpen: number
  overdue: number
  sheetsSent: number
  accepted: number
  winRate: number | null
}

interface SheetRow {
  id: string
  sheet: string
  year: number
  statusLabel: string
  scope: string
  rooms: string
  seasons: string
  rates: string
  basis: string
  policies: number
  validity: string
  document: string
  sent: number
  opened: number
  accepted: number
  declined: number
  acceptRate: number | null
  note: string | null
}

interface FollowUpRow {
  id: string
  due: string
  company: string
  contact: string
  assignee: string
  note: string
  status: string
  lateBy: number | null
}

interface ConversionRow {
  id: string
  company: string
  firstVisit: string
  visits: number
  sheetSent: boolean
  sentOn: string | null
  accepted: boolean
  stage: Stage
  daysToSend: number | null
}

interface OutreachRow {
  id: string
  sentAt: string
  company: string
  contact: string
  channel: string
  subject: string
  sentBy: string
  preview: string
}

interface CompanyRow {
  id: string
  company: string
  stage: Stage
  stageLabel: string
  relationship: string
  market: string
  location: string
  rep: string
  contacts: number
  visits: number
  visitsDone: number
  lastVisit: string | null
  openFollowUps: number
  overdue: number
  sheetsSent: number
  accepted: number
  addedOn: string
  lastActivity: string
  note: string | null
}

interface SendRow {
  id: string
  sentAt: string
  company: string
  contact: string
  email: string
  sheet: string
  year: number
  scope: string
  statusKey: SendStatus
  status: string
  openedAt: string | null
  answeredAt: string | null
  answeredBy: string | null
  answeredTitle: string | null
  sentBy: string
  followUpOn: string | null
  /** What the operator wrote back, or failing that the team's own note. */
  note: string | null
}

interface NoteRow {
  id: string
  date: string
  source: 'Visit' | 'Follow-up' | 'Company note'
  company: string
  rep: string
  note: string
}

export default function Reports() {
  const { isOwner } = useAuth()
  const { companies, loading: companiesLoading } = useCompanies()
  const { visits } = useSiteVisits()
  const { followUps } = useFollowUps()
  const { profiles } = useProfiles()
  const { versions } = useStoVersions()
  const { sends } = useAgreementSends()
  const { messages } = useSentMessages()
  const { contacts } = useAllContacts()

  /* -------------------------------------------------------------------------
     Filters live in the URL. A report is something you send someone — "the
     August numbers for Arusha" has to survive being pasted into a chat.
     ------------------------------------------------------------------------- */
  const [params, setParams] = useSearchParams()
  const tab: Tab = isTab(params.get('tab')) ? (params.get('tab') as Tab) : 'overview'
  const def = TAB_BY_VALUE[tab]

  const defaults = useMemo(() => presetRange('last_90'), [])
  const from = params.get('from') || defaults.from
  const to = params.get('to') || defaults.to
  const repFilter = params.get('rep') ?? ''
  const companyFilter = params.get('company') ?? ''
  const locationFilter = params.get('location') ?? ''
  const kindFilter = params.get('kind') ?? ''
  const relationshipFilter = params.get('relationship') ?? ''
  const marketFilter = params.get('market') ?? ''
  const stageFilter = params.get('stage') ?? ''
  const sheetFilter = params.get('sheet') ?? ''
  const search = params.get('q') ?? ''
  const statusFilter = def.status?.some((s) => s.value === params.get('status'))
    ? (params.get('status') as string)
    : ''

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (!value) next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  function setRange(preset: DatePreset) {
    const range = presetRange(preset)
    const next = new URLSearchParams(params)
    next.set('from', range.from)
    next.set('to', range.to)
    setParams(next, { replace: true })
  }

  function resetFilters() {
    setParams(new URLSearchParams({ tab }), { replace: true })
  }

  const activePreset = matchPreset(from, to)

  /* -------------------------------------------------------------------------
     Lookups shared by every report
     ------------------------------------------------------------------------- */
  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies])
  const contactById = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts])
  const companyName = (id: string | null) => (id && companyById.get(id)?.name) || 'Unknown company'

  /** Companies for the picker, by name rather than by the list's own recency order. */
  const companyOptions = useMemo(
    () => [...companies].sort((a, b) => a.name.localeCompare(b.name)),
    [companies]
  )

  /**
   * The locations on file, as they were typed.
   *
   * Country is free text on the company form, so the list is whatever has been
   * entered — matched case-insensitively, but shown with the first spelling
   * seen so the dropdown reads like the records do.
   */
  const locations = useMemo(() => {
    const seen = new Map<string, string>()
    for (const c of companies) {
      const name = c.country?.trim()
      if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name)
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b))
  }, [companies])
  const repName = (profileId: string | null, typedName: string | null) =>
    repLabel(profiles, profileId, typedName, 'Unassigned')

  /**
   * Everyone who could be credited with something, with a login or without.
   *
   * The rep fields on the forms write a typed name and clear the profile link,
   * so a person's visits arrive under their name while a company they saved
   * themselves is still pinned by `owner_id`. Matching a typed name back to
   * the profile that bears it is what keeps that one person from showing up as
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

  const selectedRep = useMemo(
    () => (repFilter ? (people.find((p) => p.id === repFilter) ?? null) : null),
    [repFilter, people]
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

  const repMatches = (profileId: string | null, typedName: string | null) =>
    !selectedRep || belongsTo(selectedRep, profileId, typedName)

  // Counted from the rep that actually resolved, not from the URL: a link
  // naming someone since removed narrows nothing, and must not offer to clear
  // a filter that is not being applied.
  const filterCount = [
    selectedRep,
    companyFilter,
    locationFilter,
    kindFilter,
    relationshipFilter,
    marketFilter,
    stageFilter,
    sheetFilter,
    statusFilter,
    search,
  ].filter(Boolean).length

  /** Operators who were sent the selected rate sheet — the season, as a filter. */
  const sheetCompanyIds = useMemo(() => {
    if (!sheetFilter) return null
    const ids = new Set<string>()
    for (const send of sends) if (send.version_id === sheetFilter) ids.add(send.company_id)
    return ids
  }, [sheetFilter, sends])

  const versionById = useMemo(() => new Map(versions.map((v) => [v.id, v])), [versions])
  const sheetName = (id: string) => versionById.get(id)?.name ?? 'Withdrawn rate sheet'

  /** The company-shaped half of the filter bar, applied wherever a row has one. */
  const companyPasses = (company: Company | undefined) => {
    if (!company) return false
    if (companyFilter && company.id !== companyFilter) return false
    if (
      locationFilter &&
      (company.country ?? '').trim().toLowerCase() !== locationFilter.toLowerCase()
    )
      return false
    if (relationshipFilter && company.relationship !== relationshipFilter) return false
    if (marketFilter && company.main_market !== marketFilter) return false
    if (stageFilter && company.stage !== stageFilter) return false
    if (sheetCompanyIds && !sheetCompanyIds.has(company.id)) return false
    return true
  }

  const needle = search.trim().toLowerCase()
  const matchesSearch = (...parts: (string | null | undefined)[]) =>
    !needle || parts.some((p) => (p ?? '').toLowerCase().includes(needle))

  // Every report reads the same six filter values; listing them once and
  // depending on the tuple keeps the memo deps below honest and readable.
  const filterKey = [
    from,
    to,
    repFilter,
    companyFilter,
    locationFilter,
    kindFilter,
    relationshipFilter,
    marketFilter,
    stageFilter,
    sheetFilter,
    needle,
  ].join('|')

  /**
   * Site visit or meeting.
   *
   * Both live in `site_visits` and both are "a visit" in the reports; the filter
   * is what separates a pure site-visit report from one that also counts calls
   * and sit-downs. Every report that counts a visit reads it.
   */
  const kindMatches = (kind: AppointmentKind) => !kindFilter || kind === kindFilter

  /**
   * The months a report is broken down by, newest first.
   *
   * Normally every month the period touches, empty ones included — a month with
   * no visits in it is the finding. Over a span too long for that (All time),
   * `monthsBetween` declines and the months actually present in the data are
   * used instead.
   */
  function monthsOf(...streams: (string | null | undefined)[][]) {
    const spanned = monthsBetween(from, to)
    const keys =
      spanned.length > 0
        ? spanned
        : [
            ...new Set(
              streams.flat().filter((d): d is string => !!d).map(monthKey)
            ),
          ].sort()
    return keys.map((key) => ({ key, label: monthLabel(key) })).reverse()
  }

  const inMonth = (iso: string | null | undefined, key: string) => !!iso && monthKey(iso) === key

  /** Companies passing the non-date filters — the denominator for the funnel. */
  const scopedCompanies = useMemo(
    () =>
      companies.filter(
        (c) => companyPasses(c) && repMatches(c.owner_id, c.owner_name) && matchesSearch(c.name)
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [companies, filterKey]
  )

  /* =========================================================================
     Visits & meetings
     ========================================================================= */
  const visitRows = useMemo<VisitRow[]>(
    () =>
      visits
        .filter((v) => inRange(v.scheduled_for, from, to))
        .filter((v) => kindMatches(v.kind))
        .filter((v) => companyPasses(companyById.get(v.company_id)))
        .filter((v) => repMatches(v.rep_id, v.rep_name))
        .filter((v) => !statusFilter || v.status === statusFilter)
        .filter((v) =>
          matchesSearch(companyName(v.company_id), v.summary, repName(v.rep_id, v.rep_name))
        )
        .sort((a, b) => b.scheduled_for.localeCompare(a.scheduled_for))
        .map((v) => {
          // What happens next is the earliest follow-up booked at that company
          // on or after the visit — the answer to "and then?" on every row.
          const next = followUps
            .filter((f) => f.company_id === v.company_id && dayKey(f.due_at) >= dayKey(v.scheduled_for))
            .sort((a, b) => a.due_at.localeCompare(b.due_at))[0]
          const company = companyById.get(v.company_id)
          return {
            id: v.id,
            date: v.scheduled_for,
            company: companyName(v.company_id),
            rep: repName(v.rep_id, v.rep_name),
            kind: APPOINTMENT_KIND_LABELS[v.kind],
            kindKey: v.kind,
            market: mainMarketLabel(company?.main_market ?? null) ?? '—',
            relationship: relationshipLabel(company?.relationship ?? null) ?? '—',
            outcome:
              v.status === 'completed'
                ? 'Completed'
                : v.status === 'cancelled'
                  ? 'Cancelled'
                  : 'Scheduled',
            nextAction:
              next?.note ?? (v.status === 'completed' ? 'Nothing booked' : 'Visit still ahead'),
            followUpOn: next?.due_at ?? null,
            note: v.summary,
          }
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visits, followUps, companyById, profiles, statusFilter, filterKey]
  )

  const visitColumns: Column<VisitRow>[] = [
    {
      key: 'date',
      label: 'Date',
      value: (r) => dayKey(r.date),
      cell: (r) => formatDayTime(r.date),
    },
    {
      key: 'company',
      label: 'Company',
      value: (r) => r.company,
      cell: (r) => <span className="rp-strong">{r.company}</span>,
    },
    { key: 'rep', label: 'Rep', value: (r) => r.rep },
    {
      key: 'kind',
      label: 'Type',
      value: (r) => r.kind,
      cell: (r) => (
        <span className="badge" style={APPOINTMENT_KIND_STYLE[r.kindKey]}>
          {r.kind}
        </span>
      ),
    },
    { key: 'market', label: 'Market', value: (r) => r.market },
    { key: 'relationship', label: 'Relationship', value: (r) => r.relationship },
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
      value: (r) => r.followUpOn,
      cell: (r) => formatDay(r.followUpOn),
    },
    { key: 'note', label: 'Note', value: (r) => r.note },
  ]

  /* =========================================================================
     Companies — one row per client property, and what the period did to it
     ========================================================================= */
  const companyRows = useMemo<CompanyRow[]>(() => {
    const now = new Date()
    return companies
      .filter((c) => companyPasses(c) && repMatches(c.owner_id, c.owner_name))
      .filter((c) => matchesSearch(c.name, c.notes, c.country, repName(c.owner_id, c.owner_name)))
      .map((c) => {
        const theirVisits = visits.filter((v) => v.company_id === c.id && kindMatches(v.kind))
        const inPeriod = theirVisits.filter((v) => inRange(v.scheduled_for, from, to))
        const theirFollowUps = followUps.filter((f) => f.company_id === c.id)
        const theirSends = sends.filter((s) => s.company_id === c.id)
        const sent = theirSends.filter((s) => inRange(s.sent_at, from, to))
        const accepted = theirSends.filter((s) => inRange(s.accepted_at, from, to))

        // The last visit that has actually happened, whenever it was. The
        // period says what was done lately; this column says how long it has
        // been since anyone was there, which a period on its own cannot.
        const past = theirVisits
          .filter((v) => v.status === 'completed' && new Date(v.scheduled_for) <= now)
          .sort((a, b) => b.scheduled_for.localeCompare(a.scheduled_for))

        return {
          id: c.id,
          company: c.name,
          stage: c.stage,
          stageLabel: STAGE_META[c.stage].label,
          relationship: relationshipLabel(c.relationship) ?? '—',
          market: mainMarketLabel(c.main_market) ?? '—',
          location: c.country?.trim() || '—',
          rep: repName(c.owner_id, c.owner_name),
          contacts: contacts.filter((x) => x.company_id === c.id).length,
          visits: inPeriod.length,
          visitsDone: inPeriod.filter((v) => v.status === 'completed').length,
          lastVisit: past[0]?.scheduled_for ?? null,
          openFollowUps: theirFollowUps.filter((f) => f.status === 'pending').length,
          overdue: theirFollowUps.filter((f) => f.status === 'pending' && new Date(f.due_at) < now)
            .length,
          sheetsSent: sent.length,
          accepted: accepted.length,
          addedOn: c.created_at,
          lastActivity: c.updated_at,
          note: c.notes?.trim() || null,
        }
      })
      .filter((r) => {
        switch (statusFilter) {
          case 'visited':
            return r.visits > 0
          case 'not_visited':
            return r.visits === 0
          case 'quoted':
            return r.sheetsSent > 0
          case 'accepted':
            return r.accepted > 0
          case 'overdue':
            return r.overdue > 0
          default:
            return true
        }
      })
      .sort(
        (a, b) => b.accepted - a.accepted || b.visits - a.visits || a.company.localeCompare(b.company)
      )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies, visits, followUps, sends, contacts, profiles, statusFilter, filterKey])

  const companyColumns: Column<CompanyRow>[] = [
    {
      key: 'company',
      label: 'Company',
      value: (r) => r.company,
      cell: (r) => <span className="rp-strong">{r.company}</span>,
    },
    {
      key: 'stage',
      label: 'Stage',
      value: (r) => r.stageLabel,
      cell: (r) => (
        <span
          className="badge"
          style={{ color: STAGE_META[r.stage].color, background: STAGE_META[r.stage].bg }}
        >
          {r.stageLabel}
        </span>
      ),
    },
    { key: 'relationship', label: 'Relationship', value: (r) => r.relationship },
    { key: 'market', label: 'Market', value: (r) => r.market },
    { key: 'location', label: 'Location', value: (r) => r.location },
    { key: 'rep', label: 'Rep', value: (r) => r.rep },
    { key: 'contacts', label: 'Contacts', value: (r) => r.contacts, numeric: true },
    {
      key: 'visits',
      label: 'Visits',
      value: (r) => r.visits,
      numeric: true,
      cell: (r) => (r.visits === 0 ? <span className="rp-muted">0</span> : r.visits),
    },
    { key: 'visitsDone', label: 'Completed', value: (r) => r.visitsDone, numeric: true },
    {
      key: 'lastVisit',
      label: 'Last visit',
      value: (r) => (r.lastVisit ? dayKey(r.lastVisit) : null),
      cell: (r) =>
        r.lastVisit ? (
          <>
            {formatDay(r.lastVisit)}
            <span className="rp-muted"> · {daysAgo(r.lastVisit)}d ago</span>
          </>
        ) : (
          <span className="rp-muted">Never</span>
        ),
    },
    { key: 'open', label: 'Open follow-ups', value: (r) => r.openFollowUps, numeric: true },
    {
      key: 'overdue',
      label: 'Overdue',
      value: (r) => r.overdue,
      numeric: true,
      cell: (r) => (r.overdue > 0 ? <span className="rp-danger">{r.overdue}</span> : r.overdue),
    },
    { key: 'sheets', label: 'Rate sheets sent', value: (r) => r.sheetsSent, numeric: true },
    { key: 'accepted', label: 'Accepted', value: (r) => r.accepted, numeric: true },
    {
      key: 'added',
      label: 'Added',
      value: (r) => dayKey(r.addedOn),
      cell: (r) => formatDay(r.addedOn),
    },
    { key: 'note', label: 'Note', value: (r) => r.note },
  ]

  /* =========================================================================
     Rep performance
     ========================================================================= */
  const repRows = useMemo<RepRow[]>(() => {
    return people
      .filter((p) => (!repFilter || repFilter === p.id) && matchesSearch(p.name))
      .map((p) => {
        const owned = companies.filter(
          (c) => companyPasses(c) && belongsTo(p, c.owner_id, c.owner_name)
        )
        const theirVisits = visits.filter(
          (v) => companyPasses(companyById.get(v.company_id)) && belongsTo(p, v.rep_id, v.rep_name)
        )
        const theirFollowUps = followUps.filter(
          (f) =>
            companyPasses(companyById.get(f.company_id)) &&
            belongsTo(p, f.assigned_to, f.assigned_name)
        )
        // A send records its sender as a link and nothing else, so a rep with
        // no login has none to their name.
        const theirSends = p.profileId
          ? sends.filter(
              (s) => s.sent_by === p.profileId && companyPasses(companyById.get(s.company_id))
            )
          : []

        const sent = theirSends.filter((s) => inRange(s.sent_at, from, to))
        const accepted = theirSends.filter((s) => inRange(s.accepted_at, from, to))
        const won = owned.filter((c) => c.stage === 'won').length
        const lost = owned.filter((c) => c.stage === 'lost').length
        const now = new Date()

        return {
          id: p.id,
          hasLogin: p.hasLogin,
          name: p.name,
          companies: owned.length,
          newCompanies: owned.filter((c) => inRange(c.created_at, from, to)).length,
          visitsDone: theirVisits.filter(
            (v) => v.status === 'completed' && inRange(v.scheduled_for, from, to)
          ).length,
          visitsUpcoming: theirVisits.filter(
            (v) => v.status === 'scheduled' && new Date(v.scheduled_for) >= now
          ).length,
          followUpsDone: theirFollowUps.filter((f) => f.status === 'done' && inRange(f.due_at, from, to))
            .length,
          followUpsOpen: theirFollowUps.filter((f) => f.status === 'pending').length,
          overdue: theirFollowUps.filter((f) => f.status === 'pending' && new Date(f.due_at) < now)
            .length,
          sheetsSent: sent.length,
          accepted: accepted.length,
          winRate: percent(won, won + lost),
        }
      })
      .filter(
        (r) =>
          r.companies + r.visitsDone + r.visitsUpcoming + r.followUpsDone + r.followUpsOpen + r.sheetsSent >
          0
      )
      .sort((a, b) => b.accepted - a.accepted || b.visitsDone - a.visitsDone)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, companies, visits, followUps, sends, companyById, filterKey])

  const repColumns: Column<RepRow>[] = [
    {
      key: 'name',
      label: 'Rep',
      // Flagged, because the row is built by matching a typed name: there is
      // no account behind it, and nothing stops two people sharing a spelling.
      value: (r) => (r.hasLogin ? r.name : `${r.name} (no login)`),
      cell: (r) => (
        <span className="rp-strong">
          {r.name}
          {!r.hasLogin && <span className="rp-tag">no login</span>}
        </span>
      ),
    },
    { key: 'companies', label: 'Companies', value: (r) => r.companies, numeric: true },
    { key: 'new', label: 'New in period', value: (r) => r.newCompanies, numeric: true },
    { key: 'visitsDone', label: 'Visits done', value: (r) => r.visitsDone, numeric: true },
    { key: 'visitsUpcoming', label: 'Upcoming', value: (r) => r.visitsUpcoming, numeric: true },
    { key: 'fuDone', label: 'Follow-ups done', value: (r) => r.followUpsDone, numeric: true },
    { key: 'fuOpen', label: 'Open', value: (r) => r.followUpsOpen, numeric: true },
    {
      key: 'overdue',
      label: 'Overdue',
      value: (r) => r.overdue,
      numeric: true,
      cell: (r) => (r.overdue > 0 ? <span className="rp-danger">{r.overdue}</span> : r.overdue),
    },
    { key: 'sheets', label: 'Rate sheets sent', value: (r) => r.sheetsSent, numeric: true },
    { key: 'accepted', label: 'Accepted', value: (r) => r.accepted, numeric: true },
    {
      key: 'winRate',
      label: 'Win rate',
      value: (r) => r.winRate,
      numeric: true,
      cell: (r) => (r.winRate === null ? '—' : `${r.winRate}%`),
    },
  ]

  /* =========================================================================
     Rate sheets — the seasons themselves, and how operators answered them
     ========================================================================= */
  const sheetRows = useMemo<SheetRow[]>(() => {
    return versions
      .filter((v) => !sheetFilter || v.id === sheetFilter)
      .filter((v) =>
        matchesSearch(
          v.name,
          v.summary,
          String(v.year),
          roomTypesOf(v.rates).join(' '),
          seasonsOf(v.rates).join(' ')
        )
      )
      .map((v) => {
        // Scoped the same way every other report is: the sends that count are
        // the ones in the period, to companies the filters let through.
        const mine = sends.filter(
          (send) =>
            send.version_id === v.id &&
            inRange(send.sent_at, from, to) &&
            companyPasses(companyById.get(send.company_id)) &&
            repMatches(send.sent_by, null)
        )
        const accepted = mine.filter((send) => send.status === 'accepted').length
        const declined = mine.filter((send) => send.status === 'declined').length
        const range = rateRange(v.rates)

        return {
          id: v.id,
          sheet: v.name,
          year: v.year,
          statusLabel: VERSION_STATUS_META[v.status].label,
          scope: scopeLabel(v.rates),
          rooms: roomTypesOf(v.rates).join(', ') || '—',
          seasons: seasonsOf(v.rates).join(', ') || '—',
          rates: range
            ? range.from === range.to
              ? formatRate(range.from, range.currency)
              : `${formatRate(range.from, range.currency)} – ${formatRate(range.to, range.currency)}`
            : 'No rates entered',
          basis: v.rate_basis ?? '—',
          policies: v.sections.length,
          validity:
            v.valid_from || v.valid_to
              ? `${formatDay(v.valid_from)} → ${formatDay(v.valid_to)}`
              : `Season ${v.year}`,
          document: v.pdf_name ?? 'Rendered by the CRM',
          sent: mine.length,
          opened: mine.filter((send) => send.status === 'viewed' || send.status === 'accepted').length,
          accepted,
          declined,
          // Against the ones that answered: an operator still thinking about it
          // is not a refusal, and counting it as one understates every season.
          acceptRate: percent(accepted, accepted + declined),
          note: v.summary?.trim() || null,
        }
      })
      .sort((a, b) => b.year - a.year || b.sent - a.sent)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versions, sends, companyById, filterKey])

  const sheetColumns: Column<SheetRow>[] = [
    {
      key: 'sheet',
      label: 'Rate sheet',
      value: (r) => r.sheet,
      cell: (r) => (
        <span className="rp-strong">
          {r.sheet}
          {r.statusLabel !== 'Active' && <span className="rp-tag">{r.statusLabel.toLowerCase()}</span>}
        </span>
      ),
    },
    { key: 'year', label: 'Season', value: (r) => r.year, numeric: true },
    { key: 'validity', label: 'Valid', value: (r) => r.validity },
    { key: 'rooms', label: 'Room types', value: (r) => r.rooms },
    { key: 'seasons', label: 'Seasons priced', value: (r) => r.seasons },
    { key: 'rates', label: 'Rates', value: (r) => r.rates },
    { key: 'basis', label: 'Quoted', value: (r) => r.basis },
    { key: 'policies', label: 'Policies', value: (r) => r.policies, numeric: true },
    { key: 'document', label: 'Document', value: (r) => r.document },
    { key: 'sent', label: 'Sent to', value: (r) => r.sent, numeric: true },
    { key: 'opened', label: 'Opened', value: (r) => r.opened, numeric: true },
    { key: 'accepted', label: 'Accepted', value: (r) => r.accepted, numeric: true },
    { key: 'declined', label: 'Declined', value: (r) => r.declined, numeric: true },
    {
      key: 'acceptRate',
      label: 'Accept rate',
      value: (r) => r.acceptRate,
      numeric: true,
      cell: (r) => (r.acceptRate === null ? '—' : `${r.acceptRate}%`),
    },
    { key: 'note', label: 'Summary', value: (r) => r.note },
  ]

  /* =========================================================================
     Follow-ups
     ========================================================================= */
  const followUpRows = useMemo<FollowUpRow[]>(() => {
    const now = new Date()
    return followUps
      .filter((f) => inRange(f.due_at, from, to))
      .filter((f) => companyPasses(companyById.get(f.company_id)))
      .filter((f) => repMatches(f.assigned_to, f.assigned_name))
      .filter((f) => {
        if (!statusFilter) return true
        if (statusFilter === 'overdue') return f.status === 'pending' && new Date(f.due_at) < now
        return f.status === statusFilter
      })
      .filter((f) =>
        matchesSearch(companyName(f.company_id), f.note, repName(f.assigned_to, f.assigned_name))
      )
      .sort((a, b) => a.due_at.localeCompare(b.due_at))
      .map((f) => {
        const overdue = f.status === 'pending' && new Date(f.due_at) < now
        return {
          id: f.id,
          due: f.due_at,
          company: companyName(f.company_id),
          contact: (f.contact_id && contactById.get(f.contact_id)?.full_name) || '—',
          assignee: repName(f.assigned_to, f.assigned_name),
          note: f.note,
          status: overdue
            ? 'Overdue'
            : f.status === 'done'
              ? 'Done'
              : f.status === 'skipped'
                ? 'Skipped'
                : 'Pending',
          lateBy: overdue ? daysAgo(f.due_at) : null,
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
    { key: 'assignee', label: 'Assigned to', value: (r) => r.assignee },
    { key: 'note', label: 'What to do', value: (r) => r.note },
    {
      key: 'status',
      label: 'Status',
      value: (r) => r.status,
      cell: (r) => <span className={`rp-pill rp-pill-${r.status.toLowerCase()}`}>{r.status}</span>,
    },
    {
      key: 'late',
      label: 'Days late',
      value: (r) => r.lateBy,
      numeric: true,
      cell: (r) => (r.lateBy === null ? '—' : <span className="rp-danger">{r.lateBy}</span>),
    },
  ]

  /* =========================================================================
     STO agreements — the season's rates, and the operators they went to
     ========================================================================= */
  const sendRows = useMemo<SendRow[]>(() => {
    return sends
      .filter((s) => inRange(s.sent_at, from, to))
      .filter((s) => companyPasses(companyById.get(s.company_id)))
      .filter((s) => repMatches(s.sent_by, null))
      .filter((s) => !statusFilter || s.status === statusFilter)
      .filter((s) =>
        matchesSearch(
          companyName(s.company_id),
          s.to_name,
          s.to_email,
          sheetName(s.version_id),
          s.note,
          s.responded_name,
          s.responded_title,
          s.responded_note
        )
      )
      .sort((a, b) => b.sent_at.localeCompare(a.sent_at))
      .map((s) => {
        const version = versionById.get(s.version_id)
        return {
          id: s.id,
          sentAt: s.sent_at,
          company: companyName(s.company_id),
          contact: s.to_name ?? '—',
          email: s.to_email ?? '—',
          sheet: sheetName(s.version_id),
          year: version?.year ?? 0,
          scope: version ? scopeLabel(version.rates) : '—',
          statusKey: s.status,
          status: SEND_STATUS_META[s.status].label,
          openedAt: s.viewed_at,
          answeredAt: s.accepted_at ?? s.declined_at,
          answeredBy: s.responded_name,
          answeredTitle: s.responded_title,
          sentBy: repName(s.sent_by, null),
          followUpOn: s.follow_up_at,
          // What the operator wrote back is the interesting half of this row;
          // the team's own note stands in when they wrote nothing.
          note: s.responded_note?.trim() || s.note?.trim() || null,
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sends, versions, companyById, profiles, statusFilter, filterKey])

  const sendSummary = useMemo(() => {
    const count = (fn: (r: SendRow) => boolean) => sendRows.filter(fn).length
    const accepted = count((r) => r.statusKey === 'accepted')
    const declined = count((r) => r.statusKey === 'declined')
    // Median, not mean: one operator who answered six months later would
    // otherwise describe a turnaround nobody experienced.
    const lags = sendRows
      .filter((r) => r.answeredAt)
      .map((r) => Math.max(0, Math.round((new Date(r.answeredAt as string).getTime() - new Date(r.sentAt).getTime()) / 86_400_000)))
      .sort((a, b) => a - b)
    return {
      sent: sendRows.length,
      operators: new Set(sendRows.map((r) => r.company)).size,
      opened: count((r) => r.openedAt !== null),
      accepted,
      declined,
      waiting: count((r) => r.statusKey === 'sent' || r.statusKey === 'viewed'),
      openRate: percent(count((r) => r.openedAt !== null), sendRows.length),
      acceptRate: percent(accepted, accepted + declined),
      medianAnswer: lags.length ? lags[Math.floor(lags.length / 2)] : null,
      withWords: count((r) => r.note !== null),
    }
  }, [sendRows])

  const sendColumns: Column<SendRow>[] = [
    {
      key: 'sentAt',
      label: 'Sent',
      value: (r) => dayKey(r.sentAt),
      cell: (r) => formatDay(r.sentAt),
    },
    {
      key: 'company',
      label: 'Operator',
      value: (r) => r.company,
      cell: (r) => <span className="rp-strong">{r.company}</span>,
    },
    { key: 'contact', label: 'Contact', value: (r) => r.contact },
    { key: 'email', label: 'Email', value: (r) => r.email },
    { key: 'sheet', label: 'Rate sheet', value: (r) => r.sheet },
    { key: 'scope', label: 'Covers', value: (r) => r.scope },
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
      value: (r) => (r.openedAt ? dayKey(r.openedAt) : null),
      cell: (r) => (r.openedAt ? formatDayTime(r.openedAt) : <span className="rp-muted">Not yet</span>),
    },
    {
      key: 'answered',
      label: 'Answered',
      value: (r) => (r.answeredAt ? dayKey(r.answeredAt) : null),
      cell: (r) => (r.answeredAt ? formatDayTime(r.answeredAt) : <span className="rp-muted">—</span>),
    },
    {
      key: 'answeredBy',
      label: 'Answered by',
      value: (r) =>
        r.answeredBy ? `${r.answeredBy}${r.answeredTitle ? `, ${r.answeredTitle}` : ''}` : null,
      cell: (r) =>
        r.answeredBy ? (
          <>
            <span className="rp-strong">{r.answeredBy}</span>
            {r.answeredTitle && <span className="rp-note">{r.answeredTitle}</span>}
          </>
        ) : (
          <span className="rp-muted">—</span>
        ),
    },
    { key: 'sentBy', label: 'Sent by', value: (r) => r.sentBy },
    {
      key: 'followUp',
      label: 'Follow-up',
      value: (r) => r.followUpOn,
      cell: (r) => formatDay(r.followUpOn),
    },
    { key: 'note', label: 'What they said', value: (r) => r.note },
  ]

  /* =========================================================================
     Visit conversion — did going out there lead anywhere?
     ========================================================================= */
  const conversionRows = useMemo<ConversionRow[]>(() => {
    const byCompany = new Map<string, { first: string; count: number }>()
    for (const v of visits) {
      if (v.status === 'cancelled') continue
      if (!kindMatches(v.kind)) continue
      if (!inRange(v.scheduled_for, from, to)) continue
      if (!companyPasses(companyById.get(v.company_id))) continue
      if (!repMatches(v.rep_id, v.rep_name)) continue
      const seen = byCompany.get(v.company_id)
      if (!seen) byCompany.set(v.company_id, { first: v.scheduled_for, count: 1 })
      else {
        seen.count += 1
        if (v.scheduled_for < seen.first) seen.first = v.scheduled_for
      }
    }

    return [...byCompany.entries()]
      .filter(([id]) => matchesSearch(companyName(id)))
      .map(([id, { first, count }]) => {
        // Only rates sent *after* the visit count as its result; a sheet sent a
        // month earlier says nothing about the trip.
        const after = sends
          .filter((send) => send.company_id === id && send.sent_at >= first)
          .sort((a, b) => a.sent_at.localeCompare(b.sent_at))
        const sentOn = after[0]?.sent_at ?? null
        return {
          id,
          company: companyName(id),
          firstVisit: first,
          visits: count,
          sheetSent: after.length > 0,
          sentOn,
          accepted: after.some((send) => send.status === 'accepted'),
          stage: companyById.get(id)?.stage ?? 'lead',
          daysToSend: sentOn
            ? Math.max(
                0,
                Math.round((new Date(sentOn).getTime() - new Date(first).getTime()) / 86_400_000)
              )
            : null,
        }
      })
      .sort(
        (a, b) =>
          Number(b.accepted) - Number(a.accepted) ||
          Number(b.sheetSent) - Number(a.sheetSent) ||
          a.company.localeCompare(b.company)
      )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visits, sends, companyById, filterKey])

  const conversionSummary = useMemo(() => {
    const visited = conversionRows.length
    const sheetSent = conversionRows.filter((r) => r.sheetSent).length
    const accepted = conversionRows.filter((r) => r.accepted).length
    const won = conversionRows.filter((r) => r.stage === 'won').length
    // Median, not mean: one sheet that went out six months later would
    // otherwise describe a turnaround nobody experienced.
    const lags = conversionRows
      .map((r) => r.daysToSend)
      .filter((d): d is number => d !== null)
      .sort((a, b) => a - b)
    return {
      visited,
      sheetSent,
      accepted,
      won,
      sentRate: percent(sheetSent, visited),
      acceptRate: percent(accepted, sheetSent),
      wonRate: percent(won, visited),
      medianLag: lags.length ? lags[Math.floor(lags.length / 2)] : null,
    }
  }, [conversionRows])

  const conversionColumns: Column<ConversionRow>[] = [
    {
      key: 'company',
      label: 'Company',
      value: (r) => r.company,
      cell: (r) => <span className="rp-strong">{r.company}</span>,
    },
    {
      key: 'first',
      label: 'First visit',
      value: (r) => dayKey(r.firstVisit),
      cell: (r) => formatDay(r.firstVisit),
    },
    { key: 'visits', label: 'Visits', value: (r) => r.visits, numeric: true },
    {
      key: 'sent',
      label: 'Rates sent after',
      value: (r) => (r.sentOn ? dayKey(r.sentOn) : 'No'),
      cell: (r) => (r.sheetSent ? formatDay(r.sentOn) : <span className="rp-muted">Not yet</span>),
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
          <span className="rp-pill rp-pill-completed">Yes</span>
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
     STO outreach — pricing shares and agreement sends
     ========================================================================= */
  const outreachRows = useMemo<OutreachRow[]>(() => {
    // A message with no company attached cannot be judged against the company
    // filters, so it only survives while none of them are set.
    const companyFiltersOff = !relationshipFilter && !marketFilter && !stageFilter && !sheetCompanyIds
    return messages
      .filter((m) => inRange(m.sent_at, from, to))
      .filter((m) => (m.company_id ? companyPasses(companyById.get(m.company_id)) : companyFiltersOff))
      .filter((m) => repMatches(m.sent_by, null))
      .filter((m) => !statusFilter || m.channel === statusFilter)
      .filter((m) => matchesSearch(companyName(m.company_id), m.subject, m.body))
      .sort((a, b) => b.sent_at.localeCompare(a.sent_at))
      .map((m) => ({
        id: m.id,
        sentAt: m.sent_at,
        company: m.company_id ? companyName(m.company_id) : '—',
        contact: (m.contact_id && contactById.get(m.contact_id)?.full_name) || '—',
        channel: m.channel === 'email' ? 'Email' : 'WhatsApp',
        subject: m.subject || '—',
        sentBy: repName(m.sent_by, null),
        // One line, not the whole message: the table is for scanning who was
        // contacted, not for re-reading what was said.
        preview: m.body.replace(/\s+/g, ' ').trim().slice(0, 160),
      }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, companyById, contactById, profiles, statusFilter, filterKey])

  /** Rate sheets that went out in the period — the formal half of outreach. */
  const sheetsSent = useMemo(
    () =>
      sends
        .filter((send) => inRange(send.sent_at, from, to))
        .filter((send) => companyPasses(companyById.get(send.company_id)))
        .filter((send) =>
          matchesSearch(sheetName(send.version_id), send.to_name, companyName(send.company_id))
        )
        .sort((a, b) => b.sent_at.localeCompare(a.sent_at)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sends, versions, companyById, filterKey]
  )

  const outreachColumns: Column<OutreachRow>[] = [
    {
      key: 'sentAt',
      label: 'Sent',
      value: (r) => dayKey(r.sentAt),
      cell: (r) => formatDayTime(r.sentAt),
    },
    {
      key: 'company',
      label: 'Company',
      value: (r) => r.company,
      cell: (r) => <span className="rp-strong">{r.company}</span>,
    },
    { key: 'contact', label: 'Contact', value: (r) => r.contact },
    {
      key: 'channel',
      label: 'Channel',
      value: (r) => r.channel,
      cell: (r) => <span className={`rp-pill rp-pill-${r.channel.toLowerCase()}`}>{r.channel}</span>,
    },
    { key: 'subject', label: 'Subject', value: (r) => r.subject },
    { key: 'sentBy', label: 'Sent by', value: (r) => r.sentBy },
    { key: 'note', label: 'Message', value: (r) => r.preview },
  ]

  /* =========================================================================
     Notes & feedback — the qualitative record, in one stream
     ========================================================================= */
  const noteRows = useMemo<NoteRow[]>(() => {
    const rows: NoteRow[] = []

    for (const v of visits) {
      if (!v.summary?.trim()) continue
      if (!kindMatches(v.kind)) continue
      if (!inRange(v.scheduled_for, from, to)) continue
      if (!companyPasses(companyById.get(v.company_id))) continue
      if (!repMatches(v.rep_id, v.rep_name)) continue
      rows.push({
        id: `visit-${v.id}`,
        date: v.scheduled_for,
        source: 'Visit',
        company: companyName(v.company_id),
        rep: repName(v.rep_id, v.rep_name),
        note: v.summary.trim(),
      })
    }

    for (const f of followUps) {
      if (!f.note?.trim()) continue
      if (!inRange(f.due_at, from, to)) continue
      if (!companyPasses(companyById.get(f.company_id))) continue
      if (!repMatches(f.assigned_to, f.assigned_name)) continue
      rows.push({
        id: `followup-${f.id}`,
        date: f.due_at,
        source: 'Follow-up',
        company: companyName(f.company_id),
        rep: repName(f.assigned_to, f.assigned_name),
        note: f.note.trim(),
      })
    }

    for (const c of companies) {
      if (!c.notes?.trim()) continue
      // A company note carries no date of its own; when the company was last
      // touched is the closest honest stand-in.
      if (!inRange(c.updated_at, from, to)) continue
      if (!companyPasses(c)) continue
      if (!repMatches(c.owner_id, c.owner_name)) continue
      rows.push({
        id: `company-${c.id}`,
        date: c.updated_at,
        source: 'Company note',
        company: c.name,
        rep: repName(c.owner_id, c.owner_name),
        note: c.notes.trim(),
      })
    }

    return rows
      .filter((r) => matchesSearch(r.note, r.company, r.rep))
      .sort((a, b) => b.date.localeCompare(a.date))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visits, followUps, companies, companyById, profiles, filterKey])

  const noteColumns: Column<NoteRow>[] = [
    { key: 'date', label: 'Date', value: (r) => dayKey(r.date), cell: (r) => formatDay(r.date) },
    {
      key: 'source',
      label: 'Source',
      value: (r) => r.source,
      cell: (r) => <span className="rp-tag rp-tag-plain">{r.source}</span>,
    },
    {
      key: 'company',
      label: 'Company',
      value: (r) => r.company,
      cell: (r) => <span className="rp-strong">{r.company}</span>,
    },
    { key: 'rep', label: 'Rep', value: (r) => r.rep },
    { key: 'note', label: 'Note', value: (r) => r.note },
  ]

  /* =========================================================================
     Overview
     ========================================================================= */
  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const s of STAGE_LIST) counts[s] = 0
    for (const c of scopedCompanies) counts[c.stage]++
    return counts
  }, [scopedCompanies])

  const overview = useMemo(() => {
    const won = stageCounts.won ?? 0
    const lost = stageCounts.lost ?? 0
    const inScope = (companyId: string) => companyPasses(companyById.get(companyId))
    const accepted = sends.filter((s) => inRange(s.accepted_at, from, to) && inScope(s.company_id))
    const sent = sends.filter((s) => inRange(s.sent_at, from, to) && inScope(s.company_id))
    const answered = accepted.length + sent.filter((s) => s.status === 'declined').length
    return {
      companies: scopedCompanies.length,
      newCompanies: scopedCompanies.filter((c) => inRange(c.created_at, from, to)).length,
      visitsDone: visitRows.filter((r) => r.outcome === 'Completed').length,
      visitsBooked: visitRows.length,
      followUpsDone: followUpRows.filter((r) => r.status === 'Done').length,
      overdue: followUps.filter(
        (f) => f.status === 'pending' && new Date(f.due_at) < new Date() && inScope(f.company_id)
      ).length,
      sheetsSent: sent.length,
      operators: new Set(sent.map((s) => s.company_id)).size,
      accepted: accepted.length,
      opened: sent.filter((s) => s.viewed_at !== null).length,
      // Against the operators who answered, not everyone who was sent one:
      // a sheet still being considered is not a refusal.
      acceptRate: percent(accepted.length, answered),
      winRate: percent(won, won + lost),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedCompanies, stageCounts, sends, followUps, companyById, visitRows, followUpRows, filterKey])

  /** Where the companies in scope sit, by market and by relationship. */
  const breakdowns = useMemo(() => {
    const tally = <K extends string>(read: (c: Company) => K | null, options: { value: K; label: string }[]) =>
      options
        .map((o) => ({ label: o.label, count: scopedCompanies.filter((c) => read(c) === o.value).length }))
        .filter((r) => r.count > 0)
        .sort((a, b) => b.count - a.count)
    return {
      markets: tally<MainMarket>((c) => c.main_market, MAIN_MARKET_OPTIONS),
      relationships: tally<Relationship>((c) => c.relationship, RELATIONSHIP_OPTIONS),
    }
  }, [scopedCompanies])

  const maxStageCount = Math.max(1, ...STAGE_LIST.map((s) => stageCounts[s] ?? 0))

  /* =========================================================================
     Export
     ========================================================================= */
  /**
   * The table currently on screen, type-erased so one export path can serve
   * every tab. The columns and rows always come from the same branch, so the
   * erasure cannot pair a column with a row it does not fit.
   */
  const current = useMemo<{ columns: Column<never>[]; rows: never[] } | null>(() => {
    const pack = <T,>(columns: Column<T>[], rows: T[]) =>
      ({ columns, rows }) as unknown as { columns: Column<never>[]; rows: never[] }
    switch (tab) {
      case 'visits':
        return pack(visitColumns, visitRows)
      case 'companies':
        return pack(companyColumns, companyRows)
      case 'agreements':
        return pack(sendColumns, sendRows)
      case 'reps':
        return pack(repColumns, repRows)
      case 'rates':
        return pack(sheetColumns, sheetRows)
      case 'follow-ups':
        return pack(followUpColumns, followUpRows)
      case 'conversion':
        return pack(conversionColumns, conversionRows)
      case 'outreach':
        return pack(outreachColumns, outreachRows)
      case 'notes':
        return pack(noteColumns, noteRows)
      default:
        return null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tab,
    visitRows,
    companyRows,
    sendRows,
    repRows,
    sheetRows,
    followUpRows,
    conversionRows,
    outreachRows,
    noteRows,
  ])

  function exportCsv() {
    if (!current) {
      // The overview is tiles and bars rather than a table; the stage counts
      // are the part of it worth opening in a spreadsheet.
      downloadCsv(
        reportFilename(def.slug, from, to),
        toCsv(
          ['Stage', 'Companies'],
          STAGE_LIST.map((s) => [STAGE_META[s].label, stageCounts[s] ?? 0])
        )
      )
      return
    }
    downloadCsv(
      reportFilename(def.slug, from, to),
      toCsv(
        current.columns.map((c) => c.label),
        current.rows.map((row) => current.columns.map((c) => c.value(row)))
      )
    )
  }

  /* =========================================================================
     Monthly breakdowns
     ---------------------------------------------------------------------------
     "How many visits did we do last month, and what came back?" is the first
     question asked of every one of these sections, so each gets the same shape
     of answer: one row per month over the period, counts across, totals under.
     Cheap enough to derive on render — the rows they read are already memoised.
     ========================================================================= */
  const visitMonths = monthsOf(visitRows.map((r) => r.date))
  const companyMonths = monthsOf(companyRows.map((r) => r.addedOn))
  const followUpMonths = monthsOf(followUpRows.map((r) => r.due))
  const sendMonths = monthsOf(sendRows.map((r) => r.sentAt))
  const outreachMonths = monthsOf(outreachRows.map((r) => r.sentAt))
  const noteMonths = monthsOf(noteRows.map((r) => r.date))
  const overviewMonths = monthsOf(
    visitRows.map((r) => r.date),
    followUpRows.map((r) => r.due),
    sendRows.map((r) => r.sentAt),
    scopedCompanies.map((c) => c.created_at)
  )

  /** Rows of one section falling in a given month — the shape every column below counts. */
  const inMonthOf = <T,>(rows: T[], dateOf: (row: T) => string | null, key: string) =>
    rows.filter((r) => inMonth(dateOf(r), key))

  /* =========================================================================
     Render
     ========================================================================= */
  const filterSummary = [
    `${formatDay(from)} – ${formatDay(to)}`,
    selectedRep?.name ?? 'All reps',
    companyFilter ? companyName(companyFilter) : 'All companies',
    locationFilter || 'All locations',
    kindFilter ? APPOINTMENT_KIND_LABELS[kindFilter as AppointmentKind] : 'Visits and meetings',
    relationshipFilter ? relationshipLabel(relationshipFilter as Relationship) : 'All relationships',
    marketFilter ? mainMarketLabel(marketFilter as MainMarket) : 'All markets',
    stageFilter ? STAGE_META[stageFilter as Stage].label : 'All stages',
    sheetFilter ? sheetName(sheetFilter) : 'All rate sheets',
    statusFilter ? (def.status?.find((s) => s.value === statusFilter)?.label ?? '') : 'All statuses',
  ]
    .filter(Boolean)
    .join(' · ')

  const rowCount = current ? current.rows.length : scopedCompanies.length

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
      <div className="page-header rp-no-print">
        <div>
          <h1>Reports</h1>
          <p>
            {isOwner
              ? 'Executive reports across visits and site visits, companies, reps, follow-ups and STO — month by month, with the notes written on each.'
              : 'Your own visits, companies, follow-ups and STO work, month by month.'}
          </p>
        </div>
        <div className="rp-header-actions">
          <button className="btn" onClick={exportCsv}>
            Download CSV
          </button>
          <button className="btn btn-primary" onClick={() => window.print()}>
            Print / PDF
          </button>
        </div>
      </div>

      {/* Paper only. A printed table with no period on it is not a report, it
          is a list — so the range and the filters travel with it. */}
      <div className="rp-print-head">
        <h2>Zondela House CRM — {def.title}</h2>
        <p>{filterSummary}</p>
        <p>
          {rowCount} {rowCount === 1 ? 'row' : 'rows'} · generated{' '}
          {formatDay(new Date().toISOString())}
        </p>
      </div>

      <div className="card rp-filters rp-no-print">
        <div className="rp-filters-head">
          <h3>Filters</h3>
          <div className="rp-presets">
            {DATE_PRESETS.map((p) => (
              <button
                key={p.value}
                className={`rp-preset${activePreset === p.value ? ' active' : ''}`}
                onClick={() => setRange(p.value)}
              >
                {p.label}
              </button>
            ))}
            {filterCount > 0 && (
              <button className="rp-preset rp-preset-reset" onClick={resetFilters}>
                Clear {filterCount} filter{filterCount === 1 ? '' : 's'}
              </button>
            )}
          </div>
        </div>

        <div className="rp-filter-grid">
          <label className="rp-filter">
            <span>From</span>
            <input type="date" value={from} max={to} onChange={(e) => setParam('from', e.target.value)} />
          </label>
          <label className="rp-filter">
            <span>To</span>
            <input type="date" value={to} min={from} onChange={(e) => setParam('to', e.target.value)} />
          </label>
          <label className="rp-filter">
            <span>Rep</span>
            <select value={selectedRep?.id ?? ''} onChange={(e) => setParam('rep', e.target.value)}>
              <option value="">All reps</option>
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
            <span>Company</span>
            <select value={companyFilter} onChange={(e) => setParam('company', e.target.value)}>
              <option value="">All companies</option>
              {companyOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
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
            <span>Visit type</span>
            <select value={kindFilter} onChange={(e) => setParam('kind', e.target.value)}>
              <option value="">Visits and meetings</option>
              {APPOINTMENT_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label className="rp-filter">
            <span>Relationship</span>
            <select
              value={relationshipFilter}
              onChange={(e) => setParam('relationship', e.target.value)}
            >
              <option value="">All relationships</option>
              {RELATIONSHIP_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="rp-filter">
            <span>Market</span>
            <select value={marketFilter} onChange={(e) => setParam('market', e.target.value)}>
              <option value="">All markets</option>
              {MAIN_MARKET_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="rp-filter">
            <span>Stage</span>
            <select value={stageFilter} onChange={(e) => setParam('stage', e.target.value)}>
              <option value="">All stages</option>
              {STAGE_LIST.map((s) => (
                <option key={s} value={s}>
                  {STAGE_META[s].label}
                </option>
              ))}
            </select>
          </label>
          <label className="rp-filter">
            <span>Rate sheet</span>
            <select value={sheetFilter} onChange={(e) => setParam('sheet', e.target.value)}>
              <option value="">All rate sheets</option>
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
          <label className="rp-filter rp-filter-wide">
            <span>Search</span>
            <input
              type="search"
              placeholder="Company, note, rep…"
              value={search}
              onChange={(e) => setParam('q', e.target.value)}
            />
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
        <div className="panel-header rp-panel-head">
          <div>
            <h2>
              {def.title}
              {current && <span className="rp-count"> ({rowCount})</span>}
            </h2>
            <p>{def.blurb}</p>
          </div>
        </div>

        {companiesLoading ? (
          <p className="rp-empty">Loading…</p>
        ) : tab === 'overview' ? (
          <>
            <div className="metric-row">
              <Metric
                label="Companies in scope"
                value={overview.companies}
                sub={`${overview.newCompanies} new this period`}
              />
              <Metric
                label="Visits completed"
                value={overview.visitsDone}
                sub={`${overview.visitsBooked} booked in period`}
              />
              <Metric
                label="Follow-ups done"
                value={overview.followUpsDone}
                sub={`${overview.overdue} overdue now`}
                tone={overview.overdue > 0 ? 'danger' : undefined}
              />
              <Metric
                label="Rate sheets sent"
                value={overview.sheetsSent}
                sub={`to ${overview.operators} ${overview.operators === 1 ? 'operator' : 'operators'}`}
              />
              <Metric
                label="Operators accepted"
                value={overview.accepted}
                sub={
                  overview.acceptRate === null
                    ? 'none answered yet'
                    : `${overview.acceptRate}% of those who answered`
                }
              />
              <Metric
                label="Win rate"
                value={overview.winRate === null ? '—' : `${overview.winRate}%`}
                sub="won vs. closed"
              />
            </div>

            <MonthlyPanel
              caption="Month by month"
              months={overviewMonths}
              columns={[
                {
                  label: 'Visits',
                  primary: true,
                  value: (k) => inMonthOf(visitRows, (r) => r.date, k).length,
                },
                {
                  label: 'Completed',
                  value: (k) =>
                    inMonthOf(visitRows, (r) => r.date, k).filter((r) => r.outcome === 'Completed')
                      .length,
                },
                {
                  label: 'Follow-ups due',
                  value: (k) => inMonthOf(followUpRows, (r) => r.due, k).length,
                },
                {
                  label: 'Follow-ups done',
                  value: (k) =>
                    inMonthOf(followUpRows, (r) => r.due, k).filter((r) => r.status === 'Done')
                      .length,
                },
                {
                  label: 'Rate sheets sent',
                  value: (k) => inMonthOf(sendRows, (r) => r.sentAt, k).length,
                },
                {
                  label: 'Accepted',
                  value: (k) =>
                    inMonthOf(sendRows, (r) => r.sentAt, k).filter((r) => r.statusKey === 'accepted')
                      .length,
                },
                {
                  label: 'New companies',
                  value: (k) => scopedCompanies.filter((c) => inMonth(c.created_at, k)).length,
                },
                {
                  label: 'Notes written',
                  value: (k) => inMonthOf(noteRows, (r) => r.date, k).length,
                },
              ]}
            />

            <h3 className="rp-sub">Pipeline by stage</h3>
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
                        style={{
                          width: `${(count / maxStageCount) * 100}%`,
                          background: meta.color,
                        }}
                      />
                    </div>
                    <span className="stage-bar-count">{count}</span>
                  </div>
                )
              })}
            </div>

            <div className="rp-split">
              <div>
                <h3 className="rp-sub">By market</h3>
                <Breakdown rows={breakdowns.markets} total={scopedCompanies.length} />
              </div>
              <div>
                <h3 className="rp-sub">By relationship</h3>
                <Breakdown rows={breakdowns.relationships} total={scopedCompanies.length} />
              </div>
            </div>
          </>
        ) : tab === 'visits' ? (
          <>
            <div className="metric-row">
              <Metric
                label="Visits in period"
                value={visitRows.length}
                sub={`${visitRows.filter((r) => r.outcome === 'Completed').length} completed`}
              />
              <Metric
                label="Site visits"
                value={visitRows.filter((r) => r.kindKey === 'site_visit').length}
                sub="at the client's premises"
              />
              <Metric
                label="Meetings"
                value={visitRows.filter((r) => r.kindKey === 'meeting').length}
                sub="calls and sit-downs"
              />
              <Metric
                label="Companies seen"
                value={new Set(visitRows.map((r) => r.company)).size}
                sub="distinct clients"
              />
              <Metric
                label="Cancelled"
                value={visitRows.filter((r) => r.outcome === 'Cancelled').length}
                sub="called off"
                tone={visitRows.some((r) => r.outcome === 'Cancelled') ? 'danger' : undefined}
              />
              <Metric
                label="Summaries written"
                value={visitRows.filter((r) => r.note).length}
                sub={`of ${visitRows.length} visits`}
              />
            </div>

            <MonthlyPanel
              caption="Visits by month"
              months={visitMonths}
              columns={[
                { label: 'Visits', primary: true, value: (k) => inMonthOf(visitRows, (r) => r.date, k).length },
                {
                  label: 'Site visits',
                  value: (k) =>
                    inMonthOf(visitRows, (r) => r.date, k).filter((r) => r.kindKey === 'site_visit')
                      .length,
                },
                {
                  label: 'Meetings',
                  value: (k) =>
                    inMonthOf(visitRows, (r) => r.date, k).filter((r) => r.kindKey === 'meeting')
                      .length,
                },
                {
                  label: 'Completed',
                  value: (k) =>
                    inMonthOf(visitRows, (r) => r.date, k).filter((r) => r.outcome === 'Completed')
                      .length,
                },
                {
                  label: 'Cancelled',
                  value: (k) =>
                    inMonthOf(visitRows, (r) => r.date, k).filter((r) => r.outcome === 'Cancelled')
                      .length,
                },
                {
                  label: 'Companies',
                  noTotal: true,
                  value: (k) =>
                    new Set(inMonthOf(visitRows, (r) => r.date, k).map((r) => r.company)).size,
                },
                {
                  label: 'With a summary',
                  value: (k) => inMonthOf(visitRows, (r) => r.date, k).filter((r) => r.note).length,
                },
              ]}
            />

            <h3 className="rp-sub">Every visit, with what was written after it</h3>
            {renderTable(
              visitColumns,
              visitRows,
              'No visits or meetings in this period.',
              (r) => r.note
            )}
          </>
        ) : tab === 'companies' ? (
          <>
            <div className="metric-row">
              <Metric
                label="Companies in scope"
                value={companyRows.length}
                sub={`${companyRows.filter((r) => inRange(r.addedOn, from, to)).length} added this period`}
              />
              <Metric
                label="Visited in period"
                value={companyRows.filter((r) => r.visits > 0).length}
                sub={`${companyRows.filter((r) => r.visits === 0).length} not visited`}
              />
              <Metric
                label="Sent the rates"
                value={companyRows.filter((r) => r.sheetsSent > 0).length}
                sub={`${companyRows.filter((r) => r.accepted > 0).length} accepted them`}
              />
              <Metric
                label="Open follow-ups"
                value={companyRows.reduce((sum, r) => sum + r.openFollowUps, 0)}
                sub={`${companyRows.reduce((sum, r) => sum + r.overdue, 0)} overdue`}
                tone={companyRows.some((r) => r.overdue > 0) ? 'danger' : undefined}
              />
              <Metric
                label="Never visited"
                value={companyRows.filter((r) => r.lastVisit === null).length}
                sub="no completed visit on file"
              />
              <Metric
                label="Contacts on file"
                value={companyRows.reduce((sum, r) => sum + r.contacts, 0)}
                sub="people to send rates to"
              />
            </div>

            <MonthlyPanel
              caption="Companies added by month"
              months={companyMonths}
              columns={[
                {
                  label: 'Added',
                  primary: true,
                  value: (k) => inMonthOf(companyRows, (r) => r.addedOn, k).length,
                },
                {
                  label: 'Visited since',
                  value: (k) =>
                    inMonthOf(companyRows, (r) => r.addedOn, k).filter((r) => r.lastVisit !== null)
                      .length,
                },
                {
                  label: 'Sent the rates',
                  value: (k) =>
                    inMonthOf(companyRows, (r) => r.addedOn, k).filter((r) => r.sheetsSent > 0).length,
                },
                {
                  label: 'Won',
                  value: (k) =>
                    inMonthOf(companyRows, (r) => r.addedOn, k).filter((r) => r.stage === 'won')
                      .length,
                },
                {
                  label: 'Lost',
                  value: (k) =>
                    inMonthOf(companyRows, (r) => r.addedOn, k).filter((r) => r.stage === 'lost')
                      .length,
                },
              ]}
            />

            <h3 className="rp-sub">Every company in scope</h3>
            {renderTable(
              companyColumns,
              companyRows,
              'No companies match these filters.',
              (r) => r.note
            )}
          </>
        ) : tab === 'agreements' ? (
          <>
            <div className="metric-row">
              <Metric
                label="Rate sheets sent"
                value={sendSummary.sent}
                sub={`to ${sendSummary.operators} ${sendSummary.operators === 1 ? 'operator' : 'operators'}`}
              />
              <Metric
                label="Opened"
                value={sendSummary.opened}
                sub={
                  sendSummary.openRate === null
                    ? 'nothing sent yet'
                    : `${sendSummary.openRate}% of those sent`
                }
              />
              <Metric
                label="Accepted"
                value={sendSummary.accepted}
                sub={`${sendSummary.declined} declined`}
              />
              <Metric
                label="Still to answer"
                value={sendSummary.waiting}
                sub="sent or opened, no reply"
                tone={sendSummary.waiting > 0 ? 'danger' : undefined}
              />
              <Metric
                label="Accept rate"
                value={sendSummary.acceptRate === null ? '—' : `${sendSummary.acceptRate}%`}
                sub="of those who answered"
              />
              <Metric
                label="Sent → answered"
                value={sendSummary.medianAnswer === null ? '—' : `${sendSummary.medianAnswer}d`}
                sub="median turnaround"
              />
            </div>

            <MonthlyPanel
              caption="Rate sheets by month sent"
              months={sendMonths}
              columns={[
                {
                  label: 'Sent',
                  primary: true,
                  value: (k) => inMonthOf(sendRows, (r) => r.sentAt, k).length,
                },
                {
                  label: 'Opened',
                  value: (k) =>
                    inMonthOf(sendRows, (r) => r.sentAt, k).filter((r) => r.openedAt !== null).length,
                },
                {
                  label: 'Accepted',
                  value: (k) =>
                    inMonthOf(sendRows, (r) => r.sentAt, k).filter((r) => r.statusKey === 'accepted')
                      .length,
                },
                {
                  label: 'Declined',
                  value: (k) =>
                    inMonthOf(sendRows, (r) => r.sentAt, k).filter((r) => r.statusKey === 'declined')
                      .length,
                },
                {
                  label: 'Still waiting',
                  value: (k) =>
                    inMonthOf(sendRows, (r) => r.sentAt, k).filter(
                      (r) => r.statusKey === 'sent' || r.statusKey === 'viewed'
                    ).length,
                },
                {
                  label: 'Operators',
                  noTotal: true,
                  value: (k) =>
                    new Set(inMonthOf(sendRows, (r) => r.sentAt, k).map((r) => r.company)).size,
                },
                {
                  label: 'Wrote back',
                  value: (k) => inMonthOf(sendRows, (r) => r.sentAt, k).filter((r) => r.note).length,
                },
              ]}
            />

            <h3 className="rp-sub">Every operator sent the rates, and what came back</h3>
            {renderTable(
              sendColumns,
              sendRows,
              'No rate sheets sent in this period.',
              (r) => r.note
            )}
          </>
        ) : tab === 'reps' ? (
          renderTable(repColumns, repRows, 'No rep activity in this period.')
        ) : tab === 'rates' ? (
          renderTable(
            sheetColumns,
            sheetRows,
            'No rate sheets published yet.',
            (r) => r.note
          )
        ) : tab === 'follow-ups' ? (
          <>
            <div className="metric-row">
              <Metric label="Due in period" value={followUpRows.length} sub="booked to happen" />
              <Metric
                label="Done"
                value={followUpRows.filter((r) => r.status === 'Done').length}
                sub={
                  percent(
                    followUpRows.filter((r) => r.status === 'Done').length,
                    followUpRows.length
                  ) === null
                    ? 'nothing due'
                    : `${percent(followUpRows.filter((r) => r.status === 'Done').length, followUpRows.length)}% of those due`
                }
              />
              <Metric
                label="Still pending"
                value={followUpRows.filter((r) => r.status === 'Pending').length}
                sub="not yet late"
              />
              <Metric
                label="Overdue"
                value={followUpRows.filter((r) => r.status === 'Overdue').length}
                sub="past their date"
                tone={followUpRows.some((r) => r.status === 'Overdue') ? 'danger' : undefined}
              />
              <Metric
                label="Skipped"
                value={followUpRows.filter((r) => r.status === 'Skipped').length}
                sub="deliberately dropped"
              />
              <Metric
                label="Companies"
                value={new Set(followUpRows.map((r) => r.company)).size}
                sub="being chased"
              />
            </div>

            <MonthlyPanel
              caption="Follow-ups by month due"
              months={followUpMonths}
              columns={[
                { label: 'Due', primary: true, value: (k) => inMonthOf(followUpRows, (r) => r.due, k).length },
                {
                  label: 'Done',
                  value: (k) =>
                    inMonthOf(followUpRows, (r) => r.due, k).filter((r) => r.status === 'Done')
                      .length,
                },
                {
                  label: 'Pending',
                  value: (k) =>
                    inMonthOf(followUpRows, (r) => r.due, k).filter((r) => r.status === 'Pending')
                      .length,
                },
                {
                  label: 'Overdue',
                  value: (k) =>
                    inMonthOf(followUpRows, (r) => r.due, k).filter((r) => r.status === 'Overdue')
                      .length,
                },
                {
                  label: 'Skipped',
                  value: (k) =>
                    inMonthOf(followUpRows, (r) => r.due, k).filter((r) => r.status === 'Skipped')
                      .length,
                },
                {
                  label: 'Companies',
                  noTotal: true,
                  value: (k) =>
                    new Set(inMonthOf(followUpRows, (r) => r.due, k).map((r) => r.company)).size,
                },
              ]}
            />

            <h3 className="rp-sub">Everything due, and what it says</h3>
            {renderTable(followUpColumns, followUpRows, 'No follow-ups due in this period.')}
          </>
        ) : tab === 'conversion' ? (
          <>
            <div className="metric-row">
              <Metric label="Companies visited" value={conversionSummary.visited} sub="in the period" />
              <Metric
                label="Sent the rates after"
                value={conversionSummary.sheetSent}
                sub={
                  conversionSummary.sentRate === null
                    ? 'no visits yet'
                    : `${conversionSummary.sentRate}% of visited`
                }
              />
              <Metric
                label="Accepted"
                value={conversionSummary.accepted}
                sub={
                  conversionSummary.acceptRate === null
                    ? 'nothing sent yet'
                    : `${conversionSummary.acceptRate}% of those sent`
                }
              />
              <Metric
                label="Now won"
                value={conversionSummary.won}
                sub={
                  conversionSummary.wonRate === null
                    ? 'no visits yet'
                    : `${conversionSummary.wonRate}% of visited`
                }
              />
              <Metric
                label="Visit → rates"
                value={conversionSummary.medianLag === null ? '—' : `${conversionSummary.medianLag}d`}
                sub="median days from visit to rates"
              />
            </div>
            {renderTable(
              conversionColumns,
              conversionRows,
              'No visits in this period to follow through.'
            )}
          </>
        ) : tab === 'outreach' ? (
          <>
            <div className="metric-row">
              <Metric label="Messages sent" value={outreachRows.length} sub="pricing and templates" />
              <Metric
                label="By email"
                value={outreachRows.filter((r) => r.channel === 'Email').length}
                sub="mailto handoffs"
              />
              <Metric
                label="By WhatsApp"
                value={outreachRows.filter((r) => r.channel === 'WhatsApp').length}
                sub="wa.me handoffs"
              />
              <Metric
                label="Companies reached"
                value={new Set(outreachRows.map((r) => r.company)).size}
                sub="distinct clients"
              />
              <Metric
                label="Rate sheets sent"
                value={sheetsSent.length}
                sub="the season’s rates"
              />
            </div>
            <MonthlyPanel
              caption="Messages by month"
              months={outreachMonths}
              columns={[
                {
                  label: 'Messages',
                  primary: true,
                  value: (k) => inMonthOf(outreachRows, (r) => r.sentAt, k).length,
                },
                {
                  label: 'Email',
                  value: (k) =>
                    inMonthOf(outreachRows, (r) => r.sentAt, k).filter((r) => r.channel === 'Email')
                      .length,
                },
                {
                  label: 'WhatsApp',
                  value: (k) =>
                    inMonthOf(outreachRows, (r) => r.sentAt, k).filter(
                      (r) => r.channel === 'WhatsApp'
                    ).length,
                },
                {
                  label: 'Companies',
                  noTotal: true,
                  value: (k) =>
                    new Set(inMonthOf(outreachRows, (r) => r.sentAt, k).map((r) => r.company)).size,
                },
                {
                  label: 'Rate sheets sent',
                  value: (k) => sheetsSent.filter((send) => inMonth(send.sent_at, k)).length,
                },
              ]}
            />

            <h3 className="rp-sub">Every message sent</h3>
            {renderTable(
              outreachColumns,
              outreachRows,
              'Nothing shared in this period.',
              (r) => r.preview
            )}
            {sheetsSent.length > 0 && (
              <>
                <h3 className="rp-sub">Rate sheets sent in this period</h3>
                <div className="rp-table-wrap">
                  <table className="data-table rp-table">
                    <thead>
                      <tr>
                        <th>Sent</th>
                        <th>Rate sheet</th>
                        <th>Operator</th>
                        <th>Contact</th>
                        <th>Status</th>
                        <th>Answered</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sheetsSent.map((send) => (
                        <tr key={send.id}>
                          <td>{formatDay(send.sent_at)}</td>
                          <td>
                            <span className="rp-strong">{sheetName(send.version_id)}</span>
                          </td>
                          <td>{companyName(send.company_id)}</td>
                          <td>{send.to_name ?? '—'}</td>
                          <td>
                            <span
                              className="badge"
                              style={{
                                background: SEND_STATUS_META[send.status].bg,
                                color: SEND_STATUS_META[send.status].color,
                              }}
                            >
                              {SEND_STATUS_META[send.status].label}
                            </span>
                          </td>
                          <td>
                            {send.accepted_at || send.declined_at
                              ? formatDay(send.accepted_at ?? send.declined_at)
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <MonthlyPanel
              caption="Notes by month"
              months={noteMonths}
              columns={[
                { label: 'Notes', primary: true, value: (k) => inMonthOf(noteRows, (r) => r.date, k).length },
                {
                  label: 'From visits',
                  value: (k) =>
                    inMonthOf(noteRows, (r) => r.date, k).filter((r) => r.source === 'Visit').length,
                },
                {
                  label: 'From follow-ups',
                  value: (k) =>
                    inMonthOf(noteRows, (r) => r.date, k).filter((r) => r.source === 'Follow-up')
                      .length,
                },
                {
                  label: 'Company notes',
                  value: (k) =>
                    inMonthOf(noteRows, (r) => r.date, k).filter((r) => r.source === 'Company note')
                      .length,
                },
                {
                  label: 'Companies',
                  noTotal: true,
                  value: (k) =>
                    new Set(inMonthOf(noteRows, (r) => r.date, k).map((r) => r.company)).size,
                },
              ]}
            />

            <h3 className="rp-sub">What was written, newest first</h3>
            {renderTable(noteColumns, noteRows, 'No notes recorded in this period.', (r) => r.note)}
          </>
        )}
      </div>
    </div>
  )
}

interface MonthColumn {
  label: string
  /** The month's figure, counted from whichever rows that section holds. */
  value: (monthKey: string) => number
  /** The column the bar is drawn on. Defaults to the first. */
  primary?: boolean
  /** Distinct counts do not add up down the page, so their total is left blank. */
  noTotal?: boolean
}

/**
 * One section, month by month.
 *
 * The same table for every report: months down the side newest first, counts
 * across, a total under each column. Empty months are kept — a month with no
 * visits in it is the thing worth seeing — and the bar goes on the column the
 * section is actually about, so the shape of the year reads without a chart.
 */
function MonthlyPanel({
  caption,
  months,
  columns,
}: {
  caption: string
  months: { key: string; label: string }[]
  columns: MonthColumn[]
}) {
  if (months.length === 0) return null

  const cells = months.map((m) => columns.map((c) => c.value(m.key)))
  const totals = columns.map((_, i) => cells.reduce((sum, row) => sum + row[i], 0))
  // Nothing at all in any month: the empty table below already says so, and a
  // grid of zeroes on top of it is noise.
  if (totals.every((t) => t === 0)) return null

  const primary = Math.max(
    0,
    columns.findIndex((c) => c.primary)
  )
  const max = Math.max(1, ...cells.map((row) => row[primary]))

  return (
    <>
      <h3 className="rp-sub">{caption}</h3>
      <div className="rp-table-wrap">
        <table className="data-table rp-table">
          <thead>
            <tr>
              <th>Month</th>
              {columns.map((c) => (
                <th key={c.label} className="rp-num">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {months.map((m, row) => (
              <tr key={m.key}>
                <td>
                  <span className="rp-strong">{m.label}</span>
                </td>
                {columns.map((c, i) => (
                  <td key={c.label} className="rp-num">
                    {i === primary ? (
                      <span className="rp-bar-cell">
                        <span
                          className="rp-bar"
                          style={{ width: `${(cells[row][i] / max) * 100}%` }}
                        />
                        <span>{cells[row][i]}</span>
                      </span>
                    ) : cells[row][i] === 0 ? (
                      <span className="rp-muted">0</span>
                    ) : (
                      cells[row][i]
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="rp-total-row">
              <td>Total</td>
              {columns.map((c, i) => (
                <td key={c.label} className="rp-num">
                  {c.noTotal ? <span className="rp-muted">—</span> : totals[i]}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  )
}

function Metric({
  label,
  value,
  sub,
  tone,
  small,
}: {
  label: string
  value: string | number
  sub?: string
  tone?: 'danger'
  small?: boolean
}) {
  return (
    <div className="metric-card">
      <p className="metric-label">{label}</p>
      <p
        className={`metric-value${small ? ' metric-value-sm' : ''}`}
        style={tone === 'danger' ? { color: 'var(--danger)' } : undefined}
      >
        {value}
      </p>
      {sub && <p className="metric-sub">{sub}</p>}
    </div>
  )
}

function Breakdown({ rows, total }: { rows: { label: string; count: number }[]; total: number }) {
  if (rows.length === 0) return <p className="rp-empty">Nothing recorded.</p>
  const max = Math.max(1, ...rows.map((r) => r.count))
  return (
    <div className="stage-bars">
      {rows.map((r) => (
        <div key={r.label} className="stage-bar-row">
          <span className="stage-bar-label">{r.label}</span>
          <div className="stage-bar-track">
            <div
              className="stage-bar-fill"
              style={{ width: `${(r.count / max) * 100}%`, background: 'var(--brand-teal-bright)' }}
            />
          </div>
          <span className="stage-bar-count">
            {r.count}
            <span className="rp-muted"> · {percent(r.count, total) ?? 0}%</span>
          </span>
        </div>
      ))}
    </div>
  )
}
