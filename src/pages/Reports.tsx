import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  useAllContacts,
  useCompanies,
  useFollowUps,
  useProfiles,
  useRateCard,
  useSentMessages,
  useSiteVisits,
  useStoAgreements,
} from '../hooks/useCrmData'
import { useAuth } from '../hooks/useAuth'
import { STAGE_LIST, STAGE_META } from '../lib/stage'
import {
  MAIN_MARKET_OPTIONS,
  RELATIONSHIP_OPTIONS,
  mainMarketLabel,
  relationshipLabel,
} from '../lib/company'
import { APPOINTMENT_KIND_LABELS, APPOINTMENT_KIND_STYLE } from '../lib/appointment'
import { agreementTotals, formatMoney, lineTotal } from '../lib/agreement'
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
  Stage,
} from '../lib/database.types'
import '../components/ui.css'
import './reports.css'

/* ===========================================================================
   The eight reports.
   ---------------------------------------------------------------------------
   Every one is a table over the same period and the same filters, so they
   share a filter bar, a CSV export and a print layout; only the rows differ.
   `slug` names the exported file, and `status` lists the status values that
   report understands — a status left over from another tab is ignored rather
   than silently narrowing the next table you open.
   =========================================================================== */
type Tab =
  | 'overview'
  | 'visits'
  | 'reps'
  | 'services'
  | 'follow-ups'
  | 'conversion'
  | 'outreach'
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
    blurb: 'Where every company stands, and what the period produced.',
  },
  {
    value: 'visits',
    label: 'Visits & meetings',
    slug: 'visits',
    title: 'Marketing visit report',
    blurb: 'Every site visit and meeting in the period, with its outcome and what happens next.',
    status: [
      { value: 'completed', label: 'Completed' },
      { value: 'scheduled', label: 'Scheduled' },
      { value: 'cancelled', label: 'Cancelled' },
    ],
  },
  {
    value: 'reps',
    label: 'Rep performance',
    slug: 'rep-performance',
    title: 'Rep performance',
    blurb: 'What each rep booked, closed and chased in the period.',
  },
  {
    value: 'services',
    label: 'Service interest',
    slug: 'service-interest',
    title: 'Service interest',
    blurb: 'Which STO services are being quoted, and what they are worth.',
  },
  {
    value: 'follow-ups',
    label: 'Follow-ups',
    slug: 'follow-ups',
    title: 'Follow-up report',
    blurb: 'Everything due in the period, and how much of it is still open.',
    status: [
      { value: 'pending', label: 'Pending' },
      { value: 'overdue', label: 'Overdue' },
      { value: 'done', label: 'Done' },
      { value: 'skipped', label: 'Skipped' },
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
  quotesSent: number
  accepted: number
  acceptedValue: number
  currency: string
  winRate: number | null
}

interface ServiceRow {
  id: string
  service: string
  quotes: number
  companies: number
  quantity: number
  quoted: number
  acceptedValue: number
  currency: string
  onRateCard: boolean
  acceptRate: number | null
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
  quoted: boolean
  quotedOn: string | null
  accepted: boolean
  stage: Stage
  value: number
  currency: string
  daysToQuote: number | null
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
  const { agreements } = useStoAgreements()
  const { items: rateCard } = useRateCard()
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
  const relationshipFilter = params.get('relationship') ?? ''
  const marketFilter = params.get('market') ?? ''
  const stageFilter = params.get('stage') ?? ''
  const serviceFilter = params.get('service') ?? ''
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
    relationshipFilter,
    marketFilter,
    stageFilter,
    serviceFilter,
    statusFilter,
    search,
  ].filter(Boolean).length

  /**
   * Companies that have been quoted the selected service.
   *
   * Matched by id *or* by the copied name: an agreement line keeps its own copy
   * of the name (so an old quote cannot be repriced), and a line typed by hand
   * never had an id to point at in the first place.
   */
  const serviceCompanyIds = useMemo(() => {
    if (!serviceFilter) return null
    const name = rateCard.find((i) => i.id === serviceFilter)?.service_name.trim().toLowerCase()
    const ids = new Set<string>()
    for (const a of agreements) {
      const hit = a.items.some(
        (i) =>
          i.rate_card_item_id === serviceFilter ||
          (name !== undefined && i.service_name.trim().toLowerCase() === name)
      )
      if (hit) ids.add(a.company_id)
    }
    return ids
  }, [serviceFilter, agreements, rateCard])

  /** The company-shaped half of the filter bar, applied wherever a row has one. */
  const companyPasses = (company: Company | undefined) => {
    if (!company) return false
    if (relationshipFilter && company.relationship !== relationshipFilter) return false
    if (marketFilter && company.main_market !== marketFilter) return false
    if (stageFilter && company.stage !== stageFilter) return false
    if (serviceCompanyIds && !serviceCompanyIds.has(company.id)) return false
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
    relationshipFilter,
    marketFilter,
    stageFilter,
    serviceFilter,
    needle,
  ].join('|')

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
        // Agreements record their author as a link and nothing else, so a rep
        // with no login has none to their name.
        const theirAgreements = p.profileId
          ? agreements.filter(
              (a) => a.created_by === p.profileId && companyPasses(companyById.get(a.company_id))
            )
          : []

        const sent = theirAgreements.filter((a) => inRange(a.sent_at, from, to))
        const accepted = theirAgreements.filter((a) => inRange(a.accepted_at, from, to))
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
          quotesSent: sent.length,
          accepted: accepted.length,
          acceptedValue: accepted.reduce(
            (sum, a) => sum + agreementTotals(a.items, a.discount_percent).total,
            0
          ),
          currency: accepted[0]?.currency ?? 'TZS',
          winRate: percent(won, won + lost),
        }
      })
      .filter(
        (r) =>
          r.companies + r.visitsDone + r.visitsUpcoming + r.followUpsDone + r.followUpsOpen + r.quotesSent >
          0
      )
      .sort((a, b) => b.acceptedValue - a.acceptedValue || b.visitsDone - a.visitsDone)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, companies, visits, followUps, agreements, companyById, filterKey])

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
    { key: 'quotes', label: 'Quotes sent', value: (r) => r.quotesSent, numeric: true },
    { key: 'accepted', label: 'Accepted', value: (r) => r.accepted, numeric: true },
    {
      key: 'value',
      label: 'Accepted value',
      value: (r) => Math.round(r.acceptedValue),
      numeric: true,
      cell: (r) => (r.acceptedValue > 0 ? formatMoney(r.acceptedValue, r.currency) : '—'),
    },
    {
      key: 'winRate',
      label: 'Win rate',
      value: (r) => r.winRate,
      numeric: true,
      cell: (r) => (r.winRate === null ? '—' : `${r.winRate}%`),
    },
  ]

  /* =========================================================================
     Service interest — what the rate card is actually selling
     ========================================================================= */
  const serviceRows = useMemo<ServiceRow[]>(() => {
    interface Acc extends ServiceRow {
      companyIds: Set<string>
      acceptedQuotes: number
      answered: number
    }
    const acc = new Map<string, Acc>()
    const onRateCard = new Set(rateCard.map((i) => i.service_name.trim().toLowerCase()))
    const wanted = serviceFilter
      ? rateCard.find((i) => i.id === serviceFilter)?.service_name.trim().toLowerCase()
      : undefined

    for (const a of agreements) {
      if (!inRange(a.created_at, from, to)) continue
      if (!companyPasses(companyById.get(a.company_id))) continue
      const afterDiscount = 1 - a.discount_percent / 100

      for (const item of a.items) {
        const key = item.service_name.trim().toLowerCase()
        if (!key) continue
        if (serviceFilter && item.rate_card_item_id !== serviceFilter && key !== wanted) continue
        if (!matchesSearch(item.service_name, companyName(a.company_id))) continue

        let row = acc.get(key)
        if (!row) {
          row = {
            id: key,
            service: item.service_name.trim(),
            quotes: 0,
            companies: 0,
            quantity: 0,
            quoted: 0,
            acceptedValue: 0,
            currency: a.currency,
            onRateCard: onRateCard.has(key),
            acceptRate: null,
            companyIds: new Set<string>(),
            acceptedQuotes: 0,
            answered: 0,
          }
          acc.set(key, row)
        }
        // Net of the agreement's discount, so the column totals what was
        // actually asked for rather than a list price nobody was charged.
        const value = lineTotal(item) * afterDiscount
        row.quotes += 1
        row.quantity += item.quantity
        row.quoted += value
        row.companyIds.add(a.company_id)
        if (a.status === 'accepted') {
          row.acceptedValue += value
          row.acceptedQuotes += 1
        }
        if (a.status === 'accepted' || a.status === 'declined') row.answered += 1
      }
    }

    return [...acc.values()]
      .map((r) => ({
        ...r,
        companies: r.companyIds.size,
        acceptRate: percent(r.acceptedQuotes, r.answered),
      }))
      .sort((a, b) => b.quoted - a.quoted)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agreements, rateCard, companyById, filterKey])

  const maxQuoted = Math.max(1, ...serviceRows.map((r) => r.quoted))

  const serviceColumns: Column<ServiceRow>[] = [
    {
      key: 'service',
      label: 'Service',
      value: (r) => r.service,
      cell: (r) => (
        <span className="rp-strong">
          {r.service}
          {!r.onRateCard && <span className="rp-tag">off rate card</span>}
        </span>
      ),
    },
    { key: 'quotes', label: 'Times quoted', value: (r) => r.quotes, numeric: true },
    { key: 'companies', label: 'Companies', value: (r) => r.companies, numeric: true },
    { key: 'quantity', label: 'Units', value: (r) => r.quantity, numeric: true },
    {
      key: 'quoted',
      label: 'Quoted value',
      value: (r) => Math.round(r.quoted),
      numeric: true,
      cell: (r) => (
        <span className="rp-bar-cell">
          <span className="rp-bar" style={{ width: `${(r.quoted / maxQuoted) * 100}%` }} />
          <span>{formatMoney(r.quoted, r.currency)}</span>
        </span>
      ),
    },
    {
      key: 'acceptedValue',
      label: 'Accepted value',
      value: (r) => Math.round(r.acceptedValue),
      numeric: true,
      cell: (r) => (r.acceptedValue > 0 ? formatMoney(r.acceptedValue, r.currency) : '—'),
    },
    {
      key: 'acceptRate',
      label: 'Accept rate',
      value: (r) => r.acceptRate,
      numeric: true,
      cell: (r) => (r.acceptRate === null ? '—' : `${r.acceptRate}%`),
    },
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
     Visit conversion — did going out there lead anywhere?
     ========================================================================= */
  const conversionRows = useMemo<ConversionRow[]>(() => {
    const byCompany = new Map<string, { first: string; count: number }>()
    for (const v of visits) {
      if (v.status === 'cancelled') continue
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
        // Only agreements sent *after* the visit count as its result; one sent
        // a month earlier says nothing about the trip.
        const after = agreements
          .filter((a) => a.company_id === id && a.sent_at !== null && a.sent_at >= first)
          .sort((a, b) => (a.sent_at ?? '').localeCompare(b.sent_at ?? ''))
        const acceptedOnes = after.filter((a) => a.status === 'accepted')
        const quotedOn = after[0]?.sent_at ?? null
        return {
          id,
          company: companyName(id),
          firstVisit: first,
          visits: count,
          quoted: after.length > 0,
          quotedOn,
          accepted: acceptedOnes.length > 0,
          stage: companyById.get(id)?.stage ?? 'lead',
          value: acceptedOnes.reduce(
            (sum, a) => sum + agreementTotals(a.items, a.discount_percent).total,
            0
          ),
          currency: acceptedOnes[0]?.currency ?? 'TZS',
          daysToQuote: quotedOn
            ? Math.max(
                0,
                Math.round((new Date(quotedOn).getTime() - new Date(first).getTime()) / 86_400_000)
              )
            : null,
        }
      })
      .sort((a, b) => b.value - a.value || a.company.localeCompare(b.company))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visits, agreements, companyById, filterKey])

  const conversionSummary = useMemo(() => {
    const visited = conversionRows.length
    const quoted = conversionRows.filter((r) => r.quoted).length
    const accepted = conversionRows.filter((r) => r.accepted).length
    const won = conversionRows.filter((r) => r.stage === 'won').length
    // Median, not mean: one quote that sat for six months would otherwise
    // describe a turnaround nobody experienced.
    const lags = conversionRows
      .map((r) => r.daysToQuote)
      .filter((d): d is number => d !== null)
      .sort((a, b) => a - b)
    return {
      visited,
      quoted,
      accepted,
      won,
      quoteRate: percent(quoted, visited),
      acceptRate: percent(accepted, quoted),
      wonRate: percent(won, visited),
      value: conversionRows.reduce((sum, r) => sum + r.value, 0),
      currency: conversionRows.find((r) => r.value > 0)?.currency ?? 'TZS',
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
      key: 'quoted',
      label: 'Quoted after',
      value: (r) => (r.quotedOn ? dayKey(r.quotedOn) : 'No'),
      cell: (r) => (r.quoted ? formatDay(r.quotedOn) : <span className="rp-muted">Not yet</span>),
    },
    {
      key: 'lag',
      label: 'Days to quote',
      value: (r) => r.daysToQuote,
      numeric: true,
      cell: (r) => (r.daysToQuote === null ? '—' : r.daysToQuote),
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
    {
      key: 'value',
      label: 'Accepted value',
      value: (r) => Math.round(r.value),
      numeric: true,
      cell: (r) => (r.value > 0 ? formatMoney(r.value, r.currency) : '—'),
    },
  ]

  /* =========================================================================
     STO outreach — pricing shares and agreement sends
     ========================================================================= */
  const outreachRows = useMemo<OutreachRow[]>(() => {
    // A message with no company attached cannot be judged against the company
    // filters, so it only survives while none of them are set.
    const companyFiltersOff = !relationshipFilter && !marketFilter && !stageFilter && !serviceCompanyIds
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

  /** Agreements that went out in the period — the formal half of outreach. */
  const agreementsSent = useMemo(
    () =>
      agreements
        .filter((a) => inRange(a.sent_at, from, to))
        .filter((a) => companyPasses(companyById.get(a.company_id)))
        .filter((a) => matchesSearch(a.reference, a.title, companyName(a.company_id)))
        .sort((a, b) => (b.sent_at ?? '').localeCompare(a.sent_at ?? '')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agreements, companyById, filterKey]
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
    const accepted = agreements.filter((a) => inRange(a.accepted_at, from, to) && inScope(a.company_id))
    const sent = agreements.filter((a) => inRange(a.sent_at, from, to) && inScope(a.company_id))
    return {
      companies: scopedCompanies.length,
      newCompanies: scopedCompanies.filter((c) => inRange(c.created_at, from, to)).length,
      visitsDone: visitRows.filter((r) => r.outcome === 'Completed').length,
      visitsBooked: visitRows.length,
      followUpsDone: followUpRows.filter((r) => r.status === 'Done').length,
      overdue: followUps.filter(
        (f) => f.status === 'pending' && new Date(f.due_at) < new Date() && inScope(f.company_id)
      ).length,
      quotesSent: sent.length,
      accepted: accepted.length,
      acceptedValue: accepted.reduce(
        (sum, a) => sum + agreementTotals(a.items, a.discount_percent).total,
        0
      ),
      // Summed flat and labelled with one currency; if the period ever mixes
      // them the tile says so rather than presenting the sum as a total.
      currency: accepted[0]?.currency ?? 'TZS',
      mixedCurrency: new Set(accepted.map((a) => a.currency)).size > 1,
      winRate: percent(won, won + lost),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedCompanies, stageCounts, agreements, followUps, companyById, visitRows, followUpRows, filterKey])

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
      case 'reps':
        return pack(repColumns, repRows)
      case 'services':
        return pack(serviceColumns, serviceRows)
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
  }, [tab, visitRows, repRows, serviceRows, followUpRows, conversionRows, outreachRows, noteRows])

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
     Render
     ========================================================================= */
  const filterSummary = [
    `${formatDay(from)} – ${formatDay(to)}`,
    selectedRep?.name ?? 'All reps',
    relationshipFilter ? relationshipLabel(relationshipFilter as Relationship) : 'All relationships',
    marketFilter ? mainMarketLabel(marketFilter as MainMarket) : 'All markets',
    stageFilter ? STAGE_META[stageFilter as Stage].label : 'All stages',
    serviceFilter
      ? (rateCard.find((i) => i.id === serviceFilter)?.service_name ?? 'Selected service')
      : 'All services',
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
              ? 'Executive reports across visits, reps, services, follow-ups, STO outreach and conversion.'
              : 'Your own visits, follow-ups, outreach and conversion.'}
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
            <span>Service</span>
            <select value={serviceFilter} onChange={(e) => setParam('service', e.target.value)}>
              <option value="">All services</option>
              {rateCard.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.service_name}
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
                label="Quotes sent"
                value={overview.quotesSent}
                sub={`${overview.accepted} accepted`}
              />
              <Metric
                label="Accepted value"
                value={
                  overview.mixedCurrency
                    ? 'Mixed'
                    : formatMoney(overview.acceptedValue, overview.currency)
                }
                sub={overview.mixedCurrency ? 'mixed currencies' : 'signed in period'}
                small
              />
              <Metric
                label="Win rate"
                value={overview.winRate === null ? '—' : `${overview.winRate}%`}
                sub="won vs. closed"
              />
            </div>

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
          renderTable(visitColumns, visitRows, 'No visits or meetings in this period.', (r) => r.note)
        ) : tab === 'reps' ? (
          renderTable(repColumns, repRows, 'No rep activity in this period.')
        ) : tab === 'services' ? (
          renderTable(serviceColumns, serviceRows, 'No services quoted in this period.')
        ) : tab === 'follow-ups' ? (
          renderTable(followUpColumns, followUpRows, 'No follow-ups due in this period.')
        ) : tab === 'conversion' ? (
          <>
            <div className="metric-row">
              <Metric label="Companies visited" value={conversionSummary.visited} sub="in the period" />
              <Metric
                label="Quoted afterwards"
                value={conversionSummary.quoted}
                sub={
                  conversionSummary.quoteRate === null
                    ? 'no visits yet'
                    : `${conversionSummary.quoteRate}% of visited`
                }
              />
              <Metric
                label="Accepted"
                value={conversionSummary.accepted}
                sub={
                  conversionSummary.acceptRate === null
                    ? 'nothing quoted'
                    : `${conversionSummary.acceptRate}% of quoted`
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
                label="Value signed"
                value={formatMoney(conversionSummary.value, conversionSummary.currency)}
                sub="from visits in period"
                small
              />
              <Metric
                label="Visit → quote"
                value={conversionSummary.medianLag === null ? '—' : `${conversionSummary.medianLag}d`}
                sub="median turnaround"
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
              <Metric label="Agreements sent" value={agreementsSent.length} sub="formal quotes" />
            </div>
            {renderTable(
              outreachColumns,
              outreachRows,
              'Nothing shared in this period.',
              (r) => r.preview
            )}
            {agreementsSent.length > 0 && (
              <>
                <h3 className="rp-sub">Agreements sent in this period</h3>
                <div className="rp-table-wrap">
                  <table className="data-table rp-table">
                    <thead>
                      <tr>
                        <th>Sent</th>
                        <th>Reference</th>
                        <th>Company</th>
                        <th>Title</th>
                        <th>Status</th>
                        <th className="rp-num">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agreementsSent.map((a) => (
                        <tr key={a.id}>
                          <td>{formatDay(a.sent_at)}</td>
                          <td>
                            <span className="rp-strong">{a.reference}</span>
                          </td>
                          <td>{companyName(a.company_id)}</td>
                          <td>{a.title}</td>
                          <td>
                            <span className={`rp-pill rp-pill-${a.status}`}>{a.status}</span>
                          </td>
                          <td className="rp-num">
                            {formatMoney(
                              agreementTotals(a.items, a.discount_percent).total,
                              a.currency
                            )}
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
          renderTable(noteColumns, noteRows, 'No notes recorded in this period.', (r) => r.note)
        )}
      </div>
    </div>
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
