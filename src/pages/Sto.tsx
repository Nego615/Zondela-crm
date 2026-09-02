import { Fragment, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAllContacts, useCompanies, useSentMessages, useStoAgreements } from '../hooks/useCrmData'
import {
  AGREEMENT_STATUS_LIST,
  AGREEMENT_STATUS_META,
  agreementTotals,
  formatDate,
  formatMoney,
  isExpired,
  lineTotal,
} from '../lib/agreement'
import type { AgreementStatus, StoAgreementWithItems } from '../lib/database.types'
import AgreementFormModal from '../components/AgreementFormModal'
import SendAgreementModal from '../components/SendAgreementModal'
import RateCardPanel from '../components/RateCardPanel'
import TemplatesPanel from '../components/TemplatesPanel'
import StoSettingsPanel from '../components/StoSettingsPanel'
import AgreementPreviewModal from '../components/AgreementPreviewModal'
import MessageStatusPanel from '../components/MessageStatusPanel'
import { MESSAGE_STATUS_META, bestStatus, statusSummary } from '../lib/messageStatus'
import type { MessageStatus, SentMessage } from '../lib/database.types'
import '../components/ui.css'
import './sto.css'

type Tab = 'agreements' | 'rate-card' | 'templates' | 'settings'
type StatusFilter = AgreementStatus | 'all'

/**
 * Everything an agreement needs, in the order it is needed: build it from the
 * rate card, compose it from a template, brand it in settings.
 *
 * Email templates were a top-level section of their own; nothing outside STO
 * read them, so they moved in here alongside the branding they are composed
 * with. /templates still resolves — App.tsx redirects it to this tab.
 */
const TABS: { value: Tab; label: string }[] = [
  { value: 'agreements', label: 'Agreements' },
  { value: 'rate-card', label: 'Rate card' },
  { value: 'templates', label: 'Email templates' },
  { value: 'settings', label: 'Branding & email' },
]

const STATUS_FILTERS: StatusFilter[] = ['all', ...AGREEMENT_STATUS_LIST]

const FILTER_LABELS: Record<StatusFilter, string> = {
  all: 'All',
  draft: 'Drafts',
  sent: 'Sent',
  accepted: 'Accepted',
  declined: 'Declined',
}

const isStatusFilter = (v: string | null): v is StatusFilter =>
  v !== null && (STATUS_FILTERS as string[]).includes(v)

export default function Sto() {
  const { agreements, loading, error, refresh, setStatus, deleteAgreement } = useStoAgreements()
  const { companies } = useCompanies()
  const { contacts } = useAllContacts()
  const navigate = useNavigate()

  // Tab and filter live in the URL so a filtered list is a link the team can
  // send each other, the way the dashboard already links into follow-ups.
  const [params, setParams] = useSearchParams()
  const tabParam = params.get('tab')
  const tab: Tab = TABS.some((t) => t.value === tabParam) ? (tabParam as Tab) : 'agreements'
  const statusFilter: StatusFilter = isStatusFilter(params.get('status')) ? (params.get('status') as StatusFilter) : 'all'
  const companyFilter = params.get('company') ?? ''
  const search = params.get('q') ?? ''

  function setParam(key: string, value: string, fallback: string) {
    const next = new URLSearchParams(params)
    if (value === fallback) next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  const [formFor, setFormFor] = useState<'new' | string | null>(null)
  const [sendFor, setSendFor] = useState<string | null>(null)
  const [previewFor, setPreviewFor] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // Every message the user can see, grouped by the agreement it carried, so a
  // row can show where its last send got to without a query per row.
  const { messages, refresh: refreshMessages, setMessageStatus } = useSentMessages()
  const messagesByAgreement = useMemo(() => {
    const map = new Map<string, SentMessage[]>()
    for (const message of messages) {
      if (!message.agreement_id) continue
      const list = map.get(message.agreement_id) ?? []
      list.push(message)
      map.set(message.agreement_id, list)
    }
    return map
  }, [messages])

  const companyName = (id: string) => companies.find((c) => c.id === id)?.name ?? 'Unknown company'
  const contactName = (id: string | null) => contacts.find((c) => c.id === id)?.full_name

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return agreements.filter((a) => {
      if (statusFilter !== 'all' && a.status !== statusFilter) return false
      if (companyFilter && a.company_id !== companyFilter) return false
      if (!needle) return true
      // Searching the company name too: "the Serengeti one" is how people
      // remember an agreement, not by its reference.
      const company = companies.find((c) => c.id === a.company_id)?.name ?? ''
      return (
        a.reference.toLowerCase().includes(needle) ||
        a.title.toLowerCase().includes(needle) ||
        company.toLowerCase().includes(needle)
      )
    })
  }, [agreements, statusFilter, companyFilter, search, companies])

  const total = (a: StoAgreementWithItems) =>
    agreementTotals(a.items, a.discount_percent).total

  // Counted over everything, not the filtered view: the tiles are the reason
  // you pick a filter, so they cannot depend on the one already applied.
  const summary = useMemo(() => {
    const by = (s: AgreementStatus) => agreements.filter((a) => a.status === s)
    const accepted = by('accepted')
    return {
      draft: by('draft').length,
      sent: by('sent').length,
      awaitingExpired: by('sent').filter(isExpired).length,
      accepted: accepted.length,
      // Summed flat, and labelled with the newest accepted agreement's
      // currency. Everything is priced in TZS in practice; if that ever stops
      // being true the tile says "mixed currencies" rather than quietly
      // presenting the sum as if it were one.
      acceptedValue: accepted.reduce((sum, a) => sum + total(a), 0),
      acceptedCurrency: accepted[0]?.currency ?? 'TZS',
      mixedCurrency: new Set(accepted.map((a) => a.currency)).size > 1,
    }
  }, [agreements])

  const editing =
    formFor && formFor !== 'new' ? agreements.find((a) => a.id === formFor) : undefined
  const sending = sendFor ? agreements.find((a) => a.id === sendFor) : undefined
  const previewing = previewFor ? agreements.find((a) => a.id === previewFor) : undefined

  async function move(id: string, status: AgreementStatus) {
    setActionError(null)
    try {
      await setStatus(id, status)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update that agreement.')
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>STO</h1>
          <p>Create, send and track STO rates and agreements for Zondela.</p>
        </div>
        {tab === 'agreements' && (
          <button className="btn btn-primary" onClick={() => setFormFor('new')}>
            + Build agreement
          </button>
        )}
      </div>

      <div className="sto-tabs" role="tablist" aria-label="STO">
        {TABS.map((t) => (
          <button
            key={t.value}
            role="tab"
            aria-selected={tab === t.value}
            className={`sto-tab${tab === t.value ? ' active' : ''}`}
            onClick={() => setParam('tab', t.value, 'agreements')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'rate-card' ? (
        <RateCardPanel />
      ) : tab === 'templates' ? (
        <TemplatesPanel />
      ) : tab === 'settings' ? (
        <StoSettingsPanel />
      ) : (
        <>
          <div className="sto-summary">
            <button className="sto-tile" onClick={() => setParam('status', 'draft', 'all')}>
              <span className="sto-tile-value">{summary.draft}</span>
              <span className="sto-tile-label">In draft</span>
            </button>
            <button className="sto-tile" onClick={() => setParam('status', 'sent', 'all')}>
              <span className="sto-tile-value">{summary.sent}</span>
              <span className="sto-tile-label">
                Sent, awaiting reply
                {summary.awaitingExpired > 0 && ` · ${summary.awaitingExpired} expired`}
              </span>
            </button>
            <button className="sto-tile" onClick={() => setParam('status', 'accepted', 'all')}>
              <span className="sto-tile-value">{summary.accepted}</span>
              <span className="sto-tile-label">Accepted</span>
            </button>
            <div className="sto-tile sto-tile-static">
              <span className="sto-tile-value">
                {formatMoney(summary.acceptedValue, summary.acceptedCurrency)}
              </span>
              <span className="sto-tile-label">
                Accepted value{summary.mixedCurrency ? ' (mixed currencies)' : ''}
              </span>
            </div>
          </div>

          <div className="sto-filters">
            <div className="sto-filter-group">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f}
                  className={`btn btn-sm ${statusFilter === f ? 'btn-primary' : ''}`}
                  onClick={() => setParam('status', f, 'all')}
                >
                  {FILTER_LABELS[f]}
                </button>
              ))}
            </div>
            <div className="sto-filter-inputs">
              <select
                aria-label="Filter by company"
                value={companyFilter}
                onChange={(e) => setParam('company', e.target.value, '')}
              >
                <option value="">All companies</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                aria-label="Search agreements"
                value={search}
                onChange={(e) => setParam('q', e.target.value, '')}
                placeholder="Search reference, title or company"
              />
            </div>
          </div>

          {(error || actionError) && <p className="sto-error">{error || actionError}</p>}

          {loading ? (
            <p style={{ color: 'var(--text-soft)' }}>Loading agreements…</p>
          ) : filtered.length === 0 ? (
            <div className="empty-state card">
              <h3>{agreements.length === 0 ? 'No agreements yet' : 'Nothing matches that filter'}</h3>
              <p>
                {agreements.length === 0
                  ? 'Build one from your rate card, send it, and track the reply here.'
                  : 'Try a different status, company or search.'}
              </p>
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Company</th>
                    <th>Total</th>
                    <th>Status</th>
                    <th>Delivery</th>
                    <th>Sent</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a) => {
                    const meta = AGREEMENT_STATUS_META[a.status]
                    const expired = isExpired(a)
                    const open = expanded === a.id
                    const sends = messagesByAgreement.get(a.id) ?? []
                    // The furthest-along send wins, so resending after a bounce
                    // stops the row reading as failed for good.
                    const delivery = bestStatus(sends)
                    const latest = sends[0]
                    return (
                      <Fragment key={a.id}>
                        <tr>
                          <td>
                            <button
                              className="sto-ref"
                              aria-expanded={open}
                              onClick={() => setExpanded(open ? null : a.id)}
                            >
                              {a.reference}
                            </button>
                            <span className="sto-title">{a.title}</span>
                          </td>
                          <td
                            className="sto-company"
                            onClick={() => navigate(`/companies/${a.company_id}`)}
                          >
                            {companyName(a.company_id)}
                          </td>
                          <td className="sto-total">{formatMoney(total(a), a.currency)}</td>
                          <td>
                            <span
                              className="badge"
                              style={
                                expired
                                  ? { background: 'var(--stage-visit-bg)', color: 'var(--stage-visit)' }
                                  : { background: meta.bg, color: meta.color }
                              }
                            >
                              {expired ? 'Expired' : meta.label}
                            </span>
                          </td>
                          <td>
                            {delivery && latest ? (
                              <span
                                className="badge"
                                style={{
                                  background: MESSAGE_STATUS_META[delivery].bg,
                                  color: MESSAGE_STATUS_META[delivery].color,
                                }}
                                title={MESSAGE_STATUS_META[delivery].hint}
                              >
                                {statusSummary({ ...latest, status: delivery })}
                              </span>
                            ) : (
                              <span className="sto-date">—</span>
                            )}
                          </td>
                          <td className="sto-date">{a.sent_at ? formatDate(a.sent_at) : '—'}</td>
                          <td>
                            <div className="sto-actions">
                              <button
                                className="btn btn-ghost btn-sm"
                                onClick={() => setPreviewFor(a.id)}
                              >
                                Preview
                              </button>
                              {a.status === 'draft' && (
                                <button className="btn btn-ghost btn-sm" onClick={() => setSendFor(a.id)}>
                                  Send
                                </button>
                              )}
                              {a.status === 'sent' && (
                                <>
                                  <button
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => move(a.id, 'accepted')}
                                  >
                                    Accepted
                                  </button>
                                  <button
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => move(a.id, 'declined')}
                                  >
                                    Declined
                                  </button>
                                  <button className="btn btn-ghost btn-sm" onClick={() => setSendFor(a.id)}>
                                    Resend
                                  </button>
                                </>
                              )}
                              {(a.status === 'accepted' || a.status === 'declined') && (
                                <button
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => move(a.id, 'sent')}
                                >
                                  Reopen
                                </button>
                              )}
                              <button className="btn btn-ghost btn-sm" onClick={() => setFormFor(a.id)}>
                                Edit
                              </button>
                              <button
                                className="btn btn-ghost btn-sm"
                                onClick={async () => {
                                  if (confirm(`Delete ${a.reference}? This cannot be undone.`))
                                    await deleteAgreement(a.id)
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                        {open && (
                          <tr className="sto-detail-row">
                            <td colSpan={7}>
                              <AgreementDetail
                                agreement={a}
                                contactName={contactName(a.contact_id)}
                                messages={sends}
                                onSetStatus={async (id, status, note) => {
                                  await setMessageStatus(id, status, note)
                                }}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {formFor && (
        <AgreementFormModal
          agreement={editing}
          // Building while filtered to one company starts on that company.
          companyId={companyFilter || undefined}
          onClose={() => setFormFor(null)}
          onSaved={refresh}
        />
      )}

      {sending && (
        <SendAgreementModal
          agreement={sending}
          onClose={() => setSendFor(null)}
          onSent={() => {
            refresh()
            // The send just wrote a delivery row; without this the new
            // agreement status shows but its Delivery column stays empty.
            refreshMessages()
          }}
        />
      )}

      {previewing && (
        <AgreementPreviewModal agreement={previewing} onClose={() => setPreviewFor(null)} />
      )}
    </div>
  )
}

function AgreementDetail({
  agreement,
  contactName,
  messages,
  onSetStatus,
}: {
  agreement: StoAgreementWithItems
  contactName?: string
  messages: SentMessage[]
  onSetStatus: (id: string, status: MessageStatus, note?: string) => Promise<void>
}) {
  const totals = agreementTotals(agreement.items, agreement.discount_percent)

  return (
    <div className="sto-detail">
      <ul className="sto-detail-lines">
        {agreement.items.map((i) => (
          <li key={i.id}>
            <div>
              <strong>{i.service_name}</strong>
              {i.quantity !== 1 && <span className="sto-detail-qty"> ×{i.quantity}</span>}
              {i.unit && <span className="sto-detail-qty"> · {i.unit}</span>}
              {i.description && <p>{i.description}</p>}
            </div>
            <span>{formatMoney(lineTotal(i), agreement.currency)}</span>
          </li>
        ))}
      </ul>

      <div className="sto-detail-totals">
        {agreement.discount_percent > 0 && (
          <>
            <div>
              <span>Subtotal</span>
              <span>{formatMoney(totals.subtotal, agreement.currency)}</span>
            </div>
            <div>
              <span>Discount ({agreement.discount_percent}%)</span>
              <span>− {formatMoney(totals.discount, agreement.currency)}</span>
            </div>
          </>
        )}
        <div className="sto-detail-grand">
          <span>Total</span>
          <span>{formatMoney(totals.total, agreement.currency)}</span>
        </div>
      </div>

      <dl className="sto-detail-meta">
        {contactName && (
          <>
            <dt>Contact</dt>
            <dd>{contactName}</dd>
          </>
        )}
        <dt>Starts</dt>
        <dd>{formatDate(agreement.starts_on)}</dd>
        <dt>Valid until</dt>
        <dd>{formatDate(agreement.valid_until)}</dd>
        <dt>Accepted</dt>
        <dd>{formatDate(agreement.accepted_at)}</dd>
      </dl>

      {agreement.terms && (
        <div className="sto-detail-text">
          <h4>Terms</h4>
          <p>{agreement.terms}</p>
        </div>
      )}
      {agreement.notes && (
        <div className="sto-detail-text">
          <h4>Internal notes</h4>
          <p>{agreement.notes}</p>
        </div>
      )}

      {/* Its own class rather than .sto-detail-text: that rule restyles every
          <p> inside it, which would flatten the status panel's own text. */}
      <div className="sto-detail-delivery">
        <h4>Delivery</h4>
        <MessageStatusPanel messages={messages} onSetStatus={onSetStatus} />
      </div>
    </div>
  )
}
