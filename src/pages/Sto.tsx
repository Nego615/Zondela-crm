import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useCompanies, useProfiles } from '../hooks/useCrmData'
import { useAgreementSends, useStoVersions, agreementLink, stoPdfUrl } from '../hooks/useStoVersions'
import {
  SEND_STATUS_LIST,
  SEND_STATUS_META,
  VERSION_STATUS_META,
  bySeason,
  formatDay,
  formatDayTime,
  formatRate,
  rateRange,
  scopeLabel,
} from '../lib/stoVersion'
import { PLACEHOLDERS } from '../lib/stoVersion'
import { repLabel } from '../lib/rep'
import type { SendStatus, StoAgreementSend, StoVersionWithRates } from '../lib/database.types'
import VersionFormModal from '../components/VersionFormModal'
import VersionPreviewModal from '../components/VersionPreviewModal'
import SendVersionModal from '../components/SendVersionModal'
import TemplatesPanel from '../components/TemplatesPanel'
import StoSettingsPanel from '../components/StoSettingsPanel'
import RateCardPanel from '../components/RateCardPanel'
import '../components/ui.css'
import './sto.css'

/**
 * STO: the season's rates for Zondela House, and who has them.
 *
 * The section is built around one fact — Zondela publishes one rate sheet a
 * season and sends the same document to every tour operator. So there is a
 * version, there are the operators it went to, and there are the ones who said
 * yes. Nothing here is priced per client, and nothing is an invoice.
 *
 * Every tab leads with a sentence rather than a number: what the season covers,
 * what has been sent and what came back. The counts are there, under the words.
 */
type Tab = 'versions' | 'sent' | 'accepted' | 'templates' | 'settings'

const TABS: { value: Tab; label: string }[] = [
  { value: 'versions', label: 'Agreement versions' },
  { value: 'sent', label: 'Sent agreements' },
  { value: 'accepted', label: 'Accepted agreements' },
  { value: 'templates', label: 'Email templates' },
  { value: 'settings', label: 'Settings' },
]

type SendFilter = SendStatus | 'all'
const SEND_FILTERS: SendFilter[] = ['all', ...SEND_STATUS_LIST]

export default function Sto() {
  const {
    versions,
    loading,
    error,
    refresh,
    setVersionStatus,
    deleteVersion,
  } = useStoVersions()
  const { sends, refresh: refreshSends, setSendStatus, updateSend, deleteSend } = useAgreementSends()
  const { companies } = useCompanies()
  const { profiles } = useProfiles()
  const navigate = useNavigate()

  // Tab and filters live in the URL, so a filtered list is a link the team can
  // send each other.
  const [params, setParams] = useSearchParams()
  const tabParam = params.get('tab')
  const tab: Tab = TABS.some((t) => t.value === tabParam) ? (tabParam as Tab) : 'versions'
  const statusFilter = (SEND_FILTERS as string[]).includes(params.get('status') ?? '')
    ? (params.get('status') as SendFilter)
    : 'all'
  const search = params.get('q') ?? ''

  function setParam(key: string, value: string, fallback: string) {
    const next = new URLSearchParams(params)
    if (value === fallback) next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  const [formFor, setFormFor] = useState<'new' | string | null>(null)
  const [previewFor, setPreviewFor] = useState<string | null>(null)
  const [sendFor, setSendFor] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const companyName = (id: string) => companies.find((c) => c.id === id)?.name ?? 'Unknown company'
  const versionById = useMemo(
    () => new Map(versions.map((v) => [v.id, v])),
    [versions]
  )
  const versionName = (id: string) => versionById.get(id)?.name ?? 'Withdrawn version'
  const senderName = (id: string | null) => repLabel(profiles, id, null, 'A team member')

  const editing = formFor && formFor !== 'new' ? versionById.get(formFor) : undefined
  const previewing = previewFor ? versionById.get(previewFor) : undefined
  const sending = sendFor ? versionById.get(sendFor) : undefined

  /** Where one version got to: the line under every version card. */
  const statsFor = (versionId: string) => {
    const mine = sends.filter((s) => s.version_id === versionId)
    return {
      sent: mine.length,
      viewed: mine.filter((s) => s.status === 'viewed' || s.status === 'accepted').length,
      accepted: mine.filter((s) => s.status === 'accepted').length,
      declined: mine.filter((s) => s.status === 'declined').length,
      waiting: mine.filter((s) => s.status === 'sent' || s.status === 'viewed').length,
    }
  }

  const needle = search.trim().toLowerCase()
  const matches = (send: StoAgreementSend) =>
    !needle ||
    [
      companyName(send.company_id),
      send.to_name ?? '',
      send.to_email ?? '',
      versionName(send.version_id),
      send.note ?? '',
      send.responded_name ?? '',
    ].some((part) => part.toLowerCase().includes(needle))

  const sentRows = useMemo(
    () =>
      sends
        .filter((s) => statusFilter === 'all' || s.status === statusFilter)
        .filter(matches),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sends, statusFilter, needle, companies, versions]
  )

  const acceptedRows = useMemo(
    () => sends.filter((s) => s.status === 'accepted').filter(matches),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sends, needle, companies, versions]
  )

  /* Counted over everything, not the filtered view: the sentence at the top of
     a tab is the reason you pick a filter, so it cannot depend on one. */
  const overall = useMemo(() => {
    const active = versions.filter((v) => v.status === 'active')
    return {
      versions: versions.length,
      active: active.length,
      activeYears: active.map((v) => v.year).sort((a, b) => b - a),
      sent: sends.length,
      operators: new Set(sends.map((s) => s.company_id)).size,
      waiting: sends.filter((s) => s.status === 'sent' || s.status === 'viewed').length,
      accepted: sends.filter((s) => s.status === 'accepted').length,
      declined: sends.filter((s) => s.status === 'declined').length,
    }
  }, [versions, sends])

  async function copyLink(send: StoAgreementSend) {
    await navigator.clipboard.writeText(agreementLink(send.token))
    setCopied(send.id)
    setTimeout(() => setCopied(null), 1800)
  }

  async function guard(action: () => Promise<void>, message: string) {
    setActionError(null)
    try {
      await action()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : message)
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>STO Agreements</h1>
          <p>Publish, send and track the season’s rates for Zondela House.</p>
        </div>
        {tab === 'versions' && (
          <button className="btn btn-primary" onClick={() => setFormFor('new')}>
            + New rate sheet
          </button>
        )}
        {(tab === 'sent' || tab === 'accepted') && (
          <button
            className="btn btn-primary"
            // Only an active sheet may go out, so with none published there is
            // nothing this button could honestly do.
            disabled={!versions.some((v) => v.status === 'active')}
            title={
              versions.some((v) => v.status === 'active')
                ? undefined
                : 'Activate a rate sheet first.'
            }
            onClick={() => setSendFor(versions.find((v) => v.status === 'active')?.id ?? null)}
          >
            Send agreement
          </button>
        )}
      </div>

      <div className="sto-tabs" role="tablist" aria-label="STO agreements">
        {TABS.map((t) => (
          <button
            key={t.value}
            role="tab"
            aria-selected={tab === t.value}
            className={`sto-tab${tab === t.value ? ' active' : ''}`}
            onClick={() => setParam('tab', t.value, 'versions')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {(error || actionError) && <p className="sto-error">{error || actionError}</p>}

      {tab === 'templates' ? (
        <>
          <p className="sto-lede">
            The email an operator receives with the rate sheet. Placeholders are filled in as it is
            sent: {PLACEHOLDERS.join(', ')} — the button becomes that operator’s own link, which is
            how the CRM knows when they open it.
          </p>
          <TemplatesPanel />
        </>
      ) : tab === 'settings' ? (
        <>
          <p className="sto-lede">
            Who Zondela is on the rate sheet and in the email it travels with. Everything here is
            printed on the document the operator opens.
          </p>
          <StoSettingsPanel />
          <h2 className="sto-section">Service rate card</h2>
          <p className="sto-lede">
            Separate from the season’s rates: this is the list behind <strong>Share pricing</strong>{' '}
            on a company’s page, along with the price list PDF it links to.
          </p>
          <RateCardPanel />
        </>
      ) : tab === 'versions' ? (
        <>
          <p className="sto-lede">
            {overall.versions === 0
              ? 'No rate sheet yet. A rate sheet is one season’s rates for Zondela House — room types, seasons and what each costs — published once and sent to every operator.'
              : `${overall.versions} rate ${overall.versions === 1 ? 'sheet' : 'sheets'} on file${
                  overall.active > 0
                    ? `, ${overall.active} of them active (${overall.activeYears.join(', ')})`
                    : ', none of them active yet'
                }. ${
                  overall.sent > 0
                    ? `Sent to ${overall.operators} ${overall.operators === 1 ? 'operator' : 'operators'}, ${overall.accepted} accepted.`
                    : 'Nothing has been sent yet.'
                }`}
          </p>

          {loading ? (
            <p className="sto-loading">Loading rate sheets…</p>
          ) : versions.length === 0 ? (
            <div className="empty-state card">
              <h3>No rate sheets yet</h3>
              <p>
                Create the season’s sheet, enter the room types and rates, attach the PDF you
                already send, and it is ready to go out to operators.
              </p>
            </div>
          ) : (
            <div className="ver-list">
              {versions.map((version) => (
                <VersionCard
                  key={version.id}
                  version={version}
                  stats={statsFor(version.id)}
                  open={expanded === version.id}
                  onToggle={() => setExpanded(expanded === version.id ? null : version.id)}
                  onEdit={() => setFormFor(version.id)}
                  onPreview={() => setPreviewFor(version.id)}
                  onSend={() => setSendFor(version.id)}
                  onStatus={(status) =>
                    guard(
                      () => setVersionStatus(version.id, status),
                      'Could not change that rate sheet.'
                    )
                  }
                  onDelete={() =>
                    guard(async () => {
                      if (
                        confirm(
                          `Delete ${version.name}? Everything sent from it goes too. This cannot be undone.`
                        )
                      )
                        await deleteVersion(version)
                    }, 'Could not delete that rate sheet.')
                  }
                />
              ))}
            </div>
          )}
        </>
      ) : tab === 'sent' ? (
        <>
          <p className="sto-lede">
            {overall.sent === 0
              ? 'Nothing sent yet. Sending a rate sheet emails the operator their own link; opening it marks the row viewed, and accepting it marks it accepted — without anyone here having to chase.'
              : `${overall.sent} ${overall.sent === 1 ? 'send' : 'sends'} to ${overall.operators} ${
                  overall.operators === 1 ? 'operator' : 'operators'
                }: ${overall.accepted} accepted, ${overall.waiting} still to answer${
                  overall.declined > 0 ? `, ${overall.declined} declined` : ''
                }.`}
          </p>

          <div className="sto-filters">
            <div className="sto-filter-group">
              {SEND_FILTERS.map((f) => (
                <button
                  key={f}
                  className={`btn btn-sm ${statusFilter === f ? 'btn-primary' : ''}`}
                  onClick={() => setParam('status', f, 'all')}
                >
                  {f === 'all' ? 'All' : SEND_STATUS_META[f].label}
                </button>
              ))}
            </div>
            <div className="sto-filter-inputs">
              <input
                aria-label="Search sent agreements"
                value={search}
                onChange={(e) => setParam('q', e.target.value, '')}
                placeholder="Search company, contact or email"
              />
            </div>
          </div>

          {sentRows.length === 0 ? (
            <div className="empty-state card">
              <h3>{sends.length === 0 ? 'Nothing sent yet' : 'Nothing matches that filter'}</h3>
              <p>
                {sends.length === 0
                  ? 'Send an active rate sheet to an operator and it appears here with its status.'
                  : 'Try a different status or search.'}
              </p>
            </div>
          ) : (
            <div className="card sto-table-card">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Operator</th>
                    <th>Contact</th>
                    <th>Rate sheet</th>
                    <th>Sent</th>
                    <th>Status</th>
                    <th>Opened</th>
                    <th>Answered</th>
                    <th>Follow-up</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sentRows.map((send) => (
                    <tr key={send.id}>
                      <td>
                        <button
                          className="sto-company-link"
                          onClick={() => navigate(`/companies/${send.company_id}`)}
                        >
                          {companyName(send.company_id)}
                        </button>
                        {send.note && <span className="sto-row-note">{send.note}</span>}
                      </td>
                      <td>
                        <span className="sto-strong">{send.to_name ?? '—'}</span>
                        {send.to_email && <span className="sto-row-sub">{send.to_email}</span>}
                      </td>
                      <td>
                        <span className="sto-strong">{versionName(send.version_id)}</span>
                        <span className="sto-row-sub">
                          Sent by {senderName(send.sent_by)}
                        </span>
                      </td>
                      <td className="sto-date">{formatDay(send.sent_at)}</td>
                      <td>
                        <span
                          className="badge"
                          title={SEND_STATUS_META[send.status].hint}
                          style={{
                            background: SEND_STATUS_META[send.status].bg,
                            color: SEND_STATUS_META[send.status].color,
                          }}
                        >
                          {SEND_STATUS_META[send.status].label}
                        </span>
                      </td>
                      <td className="sto-date">{send.viewed_at ? formatDayTime(send.viewed_at) : '—'}</td>
                      <td className="sto-date">
                        {send.accepted_at
                          ? formatDayTime(send.accepted_at)
                          : send.declined_at
                            ? formatDayTime(send.declined_at)
                            : '—'}
                      </td>
                      <td>
                        <input
                          className="sto-followup"
                          type="date"
                          aria-label={`Follow up with ${companyName(send.company_id)}`}
                          value={send.follow_up_at ?? ''}
                          onChange={(e) =>
                            guard(
                              () => updateSend(send.id, { follow_up_at: e.target.value || null }),
                              'Could not save that follow-up date.'
                            )
                          }
                        />
                      </td>
                      <td>
                        <div className="sto-actions">
                          <button className="btn btn-ghost btn-sm" onClick={() => copyLink(send)}>
                            {copied === send.id ? 'Copied' : 'Copy link'}
                          </button>
                          {send.status !== 'accepted' && (
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() =>
                                guard(
                                  () => setSendStatus(send.id, 'accepted'),
                                  'Could not mark that as accepted.'
                                )
                              }
                            >
                              Accepted
                            </button>
                          )}
                          {send.status !== 'declined' && (
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() =>
                                guard(
                                  () => setSendStatus(send.id, 'declined'),
                                  'Could not mark that as declined.'
                                )
                              }
                            >
                              Declined
                            </button>
                          )}
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() =>
                              guard(async () => {
                                if (
                                  confirm(
                                    `Remove this send to ${companyName(send.company_id)}? Their link stops working.`
                                  )
                                )
                                  await deleteSend(send.id)
                              }, 'Could not remove that send.')
                            }
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="sto-lede">
            {overall.accepted === 0
              ? 'Nobody has accepted yet. When an operator accepts on their link, their name, the moment they accepted and anything they wrote lands here.'
              : `${overall.accepted} ${overall.accepted === 1 ? 'operator has' : 'operators have'} accepted the rates${
                  overall.waiting > 0 ? `, and ${overall.waiting} have yet to answer` : ''
                }.`}
          </p>

          {acceptedRows.length === 0 ? (
            <div className="empty-state card">
              <h3>No acceptances yet</h3>
              <p>
                An operator accepts on the link they were emailed — no login, no forms. Their answer
                shows up here.
              </p>
            </div>
          ) : (
            <div className="card sto-table-card">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Operator</th>
                    <th>Sent to</th>
                    <th>Rate sheet</th>
                    <th>Accepted</th>
                    <th>Accepted by</th>
                    <th>What they said</th>
                    <th>Documents</th>
                  </tr>
                </thead>
                <tbody>
                  {acceptedRows.map((send) => {
                    const version = versionById.get(send.version_id)
                    return (
                      <tr key={send.id}>
                        <td>
                          <button
                            className="sto-company-link"
                            onClick={() => navigate(`/companies/${send.company_id}`)}
                          >
                            {companyName(send.company_id)}
                          </button>
                        </td>
                        <td>
                          <span className="sto-strong">{send.to_name ?? '—'}</span>
                          {send.to_email && <span className="sto-row-sub">{send.to_email}</span>}
                        </td>
                        <td>
                          <span className="sto-strong">{versionName(send.version_id)}</span>
                          {version && (
                            <span className="sto-row-sub">
                              {version.year} · {scopeLabel(version.rates)}
                            </span>
                          )}
                        </td>
                        <td className="sto-date">{formatDayTime(send.accepted_at)}</td>
                        <td>
                          <span className="sto-strong">{send.responded_name ?? send.to_name ?? '—'}</span>
                          {send.responded_email && (
                            <span className="sto-row-sub">{send.responded_email}</span>
                          )}
                        </td>
                        <td className="sto-said">
                          {send.responded_note ? (
                            send.responded_note
                          ) : (
                            <span className="sto-muted">Accepted without a note</span>
                          )}
                        </td>
                        <td>
                          <div className="sto-actions">
                            <a
                              className="btn btn-ghost btn-sm"
                              href={agreementLink(send.token)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Agreement
                            </a>
                            {version?.pdf_path && (
                              <a
                                className="btn btn-ghost btn-sm"
                                href={stoPdfUrl(version.pdf_path)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                PDF
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {formFor && (
        <VersionFormModal
          version={editing}
          onClose={() => setFormFor(null)}
          onSaved={refresh}
        />
      )}
      {previewing && (
        <VersionPreviewModal version={previewing} onClose={() => setPreviewFor(null)} />
      )}
      {sending && (
        <SendVersionModal
          version={sending}
          onClose={() => setSendFor(null)}
          onSent={() => {
            refreshSends()
            setParam('tab', 'sent', 'versions')
          }}
        />
      )}
    </div>
  )
}

/**
 * One season on the list.
 *
 * The card answers three questions before it is opened: what this sheet
 * covers, where it stands, and what came back from it. Opening it shows the
 * rates themselves, because "what did we quote them?" is asked far more often
 * than anything else on this page.
 */
function VersionCard({
  version,
  stats,
  open,
  onToggle,
  onEdit,
  onPreview,
  onSend,
  onStatus,
  onDelete,
}: {
  version: StoVersionWithRates
  stats: { sent: number; viewed: number; accepted: number; declined: number; waiting: number }
  open: boolean
  onToggle: () => void
  onEdit: () => void
  onPreview: () => void
  onSend: () => void
  onStatus: (status: StoVersionWithRates['status']) => void
  onDelete: () => void
}) {
  const meta = VERSION_STATUS_META[version.status]
  const range = rateRange(version.rates)

  return (
    <section className={`ver-card${open ? ' open' : ''}`}>
      <div className="ver-card-head">
        <div className="ver-card-title">
          <button className="ver-name" aria-expanded={open} onClick={onToggle}>
            {version.name}
          </button>
          <span className="badge" style={{ background: meta.bg, color: meta.color }}>
            {meta.label}
          </span>
          <span className="badge ver-year">{version.year}</span>
          <span className="ver-scope">{scopeLabel(version.rates)}</span>
        </div>

        <div className="sto-actions">
          <button className="btn btn-sm" onClick={onPreview}>
            Preview
          </button>
          <button
            className="btn btn-sm"
            disabled={version.status !== 'active'}
            title={version.status === 'active' ? undefined : 'Only an active sheet can be sent.'}
            onClick={onSend}
          >
            Send
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onEdit}>
            Edit
          </button>
          {version.status !== 'active' ? (
            <button className="btn btn-ghost btn-sm" onClick={() => onStatus('active')}>
              Activate
            </button>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={() => onStatus('archived')}>
              Archive
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>

      <p className="ver-meta">
        {version.valid_from || version.valid_to
          ? `Valid ${formatDay(version.valid_from)} → ${formatDay(version.valid_to)}`
          : `Season ${version.year}`}
        {range ? ` · ${formatRate(range.from, range.currency)}–${formatRate(range.to, range.currency)}` : ''}
        {version.pdf_path ? ` · PDF attached (${version.pdf_name})` : ' · No PDF attached'}
      </p>

      {version.summary && <p className="ver-summary">{version.summary}</p>}

      <p className="ver-stats">
        {stats.sent === 0 ? (
          <span className="sto-muted">Not sent to anyone yet.</span>
        ) : (
          <>
            Sent to <strong>{stats.sent}</strong>{' '}
            {stats.sent === 1 ? 'operator' : 'operators'} · <strong>{stats.viewed}</strong> opened it
            · <strong>{stats.accepted}</strong> accepted
            {stats.declined > 0 && (
              <>
                {' '}
                · <strong>{stats.declined}</strong> declined
              </>
            )}
            {stats.waiting > 0 && (
              <>
                {' '}
                · <strong>{stats.waiting}</strong> still to answer
              </>
            )}
          </>
        )}
      </p>

      {open && (
        <div className="ver-detail">
          {version.intro && <p className="ver-prose">{version.intro}</p>}

          {version.rates.length === 0 ? (
            <p className="sto-muted">No rates on this sheet yet — open Edit and add the room types.</p>
          ) : (
            bySeason(version.rates).map(({ season, rates }) => (
              <div key={season} className="ver-season">
                <h4>{season}</h4>
                <table className="data-table ver-rates">
                  <thead>
                    <tr>
                      <th>Room type</th>
                      <th>Basis</th>
                      <th className="ver-num">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rates.map((rate) => (
                      <tr key={rate.id}>
                        <td>
                          <span className="sto-strong">{rate.room_type}</span>
                          {rate.description && (
                            <span className="sto-row-note">{rate.description}</span>
                          )}
                        </td>
                        <td className="sto-row-sub">{rate.basis || '—'}</td>
                        <td className="ver-num">{formatRate(rate.price, rate.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          )}

          {version.terms && (
            <>
              <h4 className="ver-terms-head">Terms and conditions</h4>
              <p className="ver-prose">{version.terms}</p>
            </>
          )}
        </div>
      )}
    </section>
  )
}
