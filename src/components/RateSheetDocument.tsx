import BrandMark from './BrandMark'
import {
  MEAL_PLANS,
  bySeason,
  formatDay,
  formatDayTime,
  scopeLabel,
  policyBlocks,
} from '../lib/stoVersion'
import './rate-sheet.css'

/** The rack column that sits beside each contracted rate. */
const RACK_OF = {
  bb_price: 'bb_rack',
  hb_price: 'hb_rack',
  fb_price: 'fb_rack',
} as const

/** The letterhead, as either the CRM or the public page has it. */
export interface SheetOrg {
  org_name?: string | null
  legal_name?: string | null
  tagline?: string | null
  address?: string | null
  city?: string | null
  country?: string | null
  phone?: string | null
  email?: string | null
  website?: string | null
  logo_url?: string | null
  brand_color?: string | null
  accent_color?: string | null
  agreement_footer?: string | null
  signatory_name?: string | null
  signatory_title?: string | null
}

export interface SheetRate {
  id?: string
  section_id?: string | null
  season: string
  room_type: string
  description: string | null
  pax?: number
  bb_price: number
  hb_price: number
  fb_price: number
  bb_rack?: number
  hb_rack?: number
  fb_rack?: number
  max_occupancy: number
  currency: string
}

export interface SheetImage {
  id?: string
  storage_path: string
  caption: string | null
}

/** A room category as the contract sets it out, with its photographs. */
export interface SheetPropertySection {
  id: string
  name: string
  description: string | null
  gallery_url: string | null
  meal_plan_notes: string | null
  seasonal_notes: string | null
  images: SheetImage[]
}

export interface SheetSupplement {
  id?: string
  name: string
  description?: string | null
  price: number
  currency: string
  unit: string
}

export interface SheetSection {
  id?: string
  title: string
  body: string
}

export interface SheetVersion {
  name: string
  year: number
  summary?: string | null
  intro?: string | null
  terms?: string | null
  rate_basis?: string | null
  rates_note?: string | null
  valid_from: string | null
  valid_to: string | null
}

interface Props {
  version: SheetVersion
  rates: SheetRate[]
  supplements?: SheetSupplement[]
  /** The named clauses, printed after the rooms. */
  sections?: SheetSection[]
  /** The room categories, printed before the rates. */
  propertySections?: SheetPropertySection[]
  /** Turns a stored path into a URL. Different on each side of the login. */
  imageUrl?: (path: string) => string
  org: SheetOrg | null
  /** Who it was sent to, printed under the title so the operator sees their own name. */
  recipient?: { name?: string | null; company?: string | null }
  /** The signed PDF, offered alongside the rendered contract. */
  pdfUrl?: string | null
  pdfName?: string | null
  draft?: boolean
  /** The answer, once there is one — printed where the signature block goes. */
  acceptance?: {
    name?: string | null
    title?: string | null
    company?: string | null
    at?: string | null
  } | null
}

/**
 * The Standard Tour Operator Rate Contract, as the operator reads it.
 *
 * A page rather than a printout: a banner carrying both names and the terms of
 * the offer, a covering letter, then one block per room category — photographs,
 * what the rooms are, and a rates chart that reads across the seasons — and the
 * named clauses under it. The signed PDF, when there is one, is embedded at the
 * end rather than only linked, because most operators never download it.
 *
 * Everything identifying Zondela comes from org_settings, so rebranding is the
 * STO → Settings form rather than an edit in here. The two colours are applied
 * inline rather than through CSS variables on purpose: this markup is also what
 * gets printed, and inline styles are the only styling that survives that.
 */
export default function RateSheetDocument({
  version,
  rates,
  supplements = [],
  sections = [],
  propertySections = [],
  imageUrl,
  org,
  recipient,
  pdfUrl,
  pdfName,
  draft,
  acceptance,
}: Props) {
  const brand = org?.brand_color || '#0c3b35'
  const accent = org?.accent_color || '#a9463a'
  const orgName = org?.org_name || 'Zondela House'
  const partner = recipient?.company || recipient?.name || 'Partner'

  // Rack rates are optional on a contract; a column of dashes is worse than no
  // column, so they appear only once one has been entered.
  const showRack = rates.some((r) => (r.bb_rack ?? 0) + (r.hb_rack ?? 0) + (r.fb_rack ?? 0) > 0)

  /**
   * The rooms, grouped the way the contract sets them out.
   *
   * A category with no rates still prints — it is a room being offered — and
   * rates belonging to no category fall together at the end rather than
   * vanishing, which is what makes an un-filed rate visible enough to file.
   */
  const groups = [
    ...propertySections.map((section) => ({
      key: section.id,
      name: section.name as string | null,
      section,
      rates: rates.filter((r) => r.section_id === section.id),
    })),
    ...(rates.some((r) => !r.section_id) || propertySections.length === 0
      ? [
          {
            key: 'uncategorised',
            name: propertySections.length === 0 ? null : ('Other rooms' as string | null),
            section: undefined,
            rates: rates.filter((r) => !r.section_id),
          },
        ]
      : []),
  ]

  const validity =
    version.valid_from && version.valid_to
      ? `${formatDay(version.valid_from)} – ${formatDay(version.valid_to)}`
      : `${version.year} season`

  /** The clauses, with the free-text terms carried in as one more of them. */
  const clauses: SheetSection[] = [
    ...sections,
    ...(version.terms ? [{ id: 'terms', title: 'Additional terms', body: version.terms }] : []),
  ]

  return (
    <article className="rs-doc" aria-label={version.name}>
      {draft && (
        <div className="rs-watermark" aria-hidden="true">
          DRAFT
        </div>
      )}

      {/* The banner: who this is between, what it covers, and how long for. */}
      <header className="rs-banner">
        <div className="rs-banner-inner">
          {/* An uploaded logo wins; otherwise the contract heads itself with
              Zondela's own mark rather than an initial in a box. Admin swaps
              it in STO → Settings. */}
          {org?.logo_url ? (
            <img className="rs-logo" src={org.logo_url} alt={orgName} />
          ) : (
            <span className="rs-logo-mark">
              <BrandMark size={56} />
            </span>
          )}

          <span
            className="rs-badge"
            style={{ color: brand, background: `${brand}1a`, borderColor: `${brand}4d` }}
          >
            <ShieldIcon /> Secure agreement · Confidential
          </span>

          <h1 className="rs-banner-title">
            {orgName} &amp; {partner} STO Agreement – {version.year}
          </h1>

          {version.summary && <p className="rs-banner-sub">{version.summary}</p>}

          <div className="rs-meta">
            <Meta label="Prepared for" value={recipient?.company || recipient?.name} />
            <Meta label="Prepared by" value={org?.signatory_name || orgName} />
            <Meta label="Valid period" value={validity} />
            <Meta label="Agreement" value={version.name} />
            <Meta
              label="Rooms included"
              value={rates.length > 0 ? scopeLabel(rates) : null}
            />
          </div>

          {pdfUrl && (
            <p className="rs-banner-actions">
              <a
                className="rs-btn"
                style={{ background: brand }}
                href={pdfUrl}
                target="_blank"
                rel="noreferrer"
              >
                <DownloadIcon /> Download Official STO PDF
              </a>
            </p>
          )}
        </div>
      </header>

      <main className="rs-main">
        {/* The covering letter. The version's own intro when it has one, and
            the standing wording when it does not. */}
        <div className="rs-card rs-letter">
          <p>Dear {recipient?.name || partner},</p>
          {version.intro ? (
            paragraphs(version.intro)
          ) : (
            <p>
              Thank you for your interest in working with {orgName}. We are pleased to share our STO
              rates and terms for the {version.year} season.
            </p>
          )}
          <p>
            Kindly review the rates, terms and conditions, and complete the company details section
            below to accept the agreement.
          </p>
        </div>

        {/* One block per room category: photographs, what the rooms are, and
            a chart that reads across every season at once. */}
        {groups.map((group) => {
          const columns = rateColumns(group.rates, showRack)
          const rows = rateRows(group.rates)
          const currencies = [...new Set(group.rates.map((r) => r.currency))]
          const currency = currencies.length === 1 ? currencies[0] : null

          return (
            <section key={group.key} className="rs-section">
              <div>
                <h2 className="rs-h2">
                  {group.name === null ? 'Accommodation' : group.name}
                </h2>
                {group.section?.description && (
                  <p className="rs-section-sub">{group.section.description}</p>
                )}
              </div>

              <div className="rs-gallery">
                {group.section && group.section.images.length > 0 && imageUrl ? (
                  group.section.images.map((image, i) => (
                    <div key={image.id ?? i} className="rs-shot">
                      <img
                        src={imageUrl(image.storage_path)}
                        alt={image.caption || `${group.name ?? 'Room'} ${i + 1}`}
                        loading="lazy"
                      />
                    </div>
                  ))
                ) : (
                  <div className="rs-shots-empty">
                    <ImageIcon /> Images coming soon
                  </div>
                )}
              </div>

              {/* Sits directly under the three photographs, because three is
                  never the whole room and the album is where the rest is. */}
              {group.section?.gallery_url && (
                <p className="rs-gallery-action">
                  <a
                    className="rs-btn rs-btn-outline"
                    href={group.section.gallery_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ImageIcon /> View the full {group.name ?? 'room'} gallery →
                  </a>
                </p>
              )}

              <div className="rs-card">
                <div className="rs-card-head">
                  <h3>
                    Rates ({currency ?? 'per currency shown'},{' '}
                    {version.rate_basis ? version.rate_basis.toLowerCase() : 'per room per night'})
                  </h3>
                </div>
                <div className="rs-table-wrap">
                  <table className="rs-table">
                    <thead>
                      <tr>
                        <th>Room type</th>
                        <th>Pax</th>
                        {columns.map((column) => (
                          <th key={column.key} className="rs-num">
                            <span className="rs-col-group">{column.group}</span>
                            {column.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.key}>
                          <td className="rs-room">
                            {row.room_type}
                            {row.description && <span className="rs-note">{row.description}</span>}
                          </td>
                          <td>{row.pax || '—'}</td>
                          {columns.map((column) => {
                            const value = row.cells[column.key]
                            return (
                              <td
                                key={column.key}
                                className={`rs-num${column.rack ? ' rs-rack' : ''}`}
                              >
                                {value ? cell(value, currency ? null : row.currency) : '—'}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                      {rows.length === 0 && (
                        <tr>
                          <td className="rs-empty" colSpan={columns.length + 2}>
                            Rates to be confirmed.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {(group.section?.meal_plan_notes || group.section?.seasonal_notes) && (
                <div className="rs-side-notes">
                  {group.section?.meal_plan_notes && (
                    <div>
                      <h4>Meal plan</h4>
                      <p>{group.section.meal_plan_notes}</p>
                    </div>
                  )}
                  {group.section?.seasonal_notes && (
                    <div>
                      <h4>Seasons</h4>
                      <p>{group.section.seasonal_notes}</p>
                    </div>
                  )}
                </div>
              )}
            </section>
          )
        })}

        <p className="rs-plans">
          {MEAL_PLANS.map((plan) => `${plan.label} — ${plan.full.toLowerCase()}`).join(' · ')}
          {showRack ? ' · STO is the contracted rate, rack the published one' : ''}
        </p>

        {version.rates_note && (
          <p className="rs-rates-note" style={{ borderLeftColor: accent }}>
            {version.rates_note}
          </p>
        )}

        {supplements.length > 0 && (
          <section className="rs-section">
            <h2 className="rs-h2">Supplements</h2>
            <div className="rs-card">
              <div className="rs-table-wrap">
                <table className="rs-table">
                  <thead>
                    <tr>
                      <th>Supplement</th>
                      <th className="rs-num">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {supplements.map((item, i) => (
                      <tr key={item.id ?? i}>
                        <td className="rs-room">
                          {item.name}
                          {item.description && <span className="rs-note">{item.description}</span>}
                        </td>
                        <td className="rs-num">
                          {cell(item.price, item.currency)} {item.unit}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        <section className="rs-section">
          <h2 className="rs-h2">Terms and Conditions</h2>
          <div className="rs-card rs-terms">
            {clauses.length === 0 ? (
              <p className="rs-muted">Detailed terms are provided in the official STO PDF.</p>
            ) : (
              clauses.map((clause) => (
                <div key={clause.id ?? clause.title}>
                  <h3>{clause.title}</h3>
                  {policyBlocks(clause.body).map((block, i) =>
                    block.kind === 'list' ? (
                      <ul key={i} className="rs-bullets">
                        {block.items.map((item, j) => (
                          <li key={j}>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <p key={i}>{block.text}</p>
                    )
                  )}
                </div>
              ))
            )}
          </div>
        </section>

        {/* The signed file itself, shown rather than only offered: most
            operators never click a download. */}
        {pdfUrl && (
          <section className="rs-section">
            <div className="rs-card">
              <div className="rs-card-head">
                <h3>Official STO PDF{pdfName ? ` — ${pdfName}` : ''}</h3>
              </div>
              <div className="rs-pdf-frame">
                <object data={pdfUrl} type="application/pdf">
                  <div className="rs-pdf-fallback">
                    <p>Your browser can&apos;t display the PDF inline.</p>
                    <a
                      className="rs-btn"
                      style={{ background: brand }}
                      href={pdfUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <DownloadIcon /> Download PDF
                    </a>
                  </div>
                </object>
              </div>
              <p className="rs-card-foot">
                <a className="rs-btn rs-btn-outline" href={pdfUrl} target="_blank" rel="noreferrer">
                  <DownloadIcon /> Download Official STO PDF
                </a>
              </p>
            </div>
          </section>
        )}

        {/* Once answered, the acceptance itself is the record — the same four
            lines the CRM keeps. Before that, the signature block stands in. */}
        <section className="rs-section">
          <h2 className="rs-h2">Agreement Acceptance</h2>
          <div className="rs-card rs-accept">
            {acceptance?.name ? (
              <>
                <p className="rs-accepted" style={{ color: brand }}>
                  <CheckIcon /> Agreement accepted
                </p>
                <p className="rs-muted">
                  Thank you. Your STO Agreement with {orgName} has been accepted successfully.
                </p>
                <dl className="rs-record">
                  <Record label="Company" value={acceptance.company || recipient?.company} />
                  <Record label="Agreement year" value={String(version.year)} />
                  <Record label="Accepted at" value={formatDayTime(acceptance.at)} />
                  <Record
                    label="Authorized representative"
                    value={[acceptance.name, acceptance.title].filter(Boolean).join(' · ')}
                  />
                </dl>
              </>
            ) : (
              <div className="rs-sign">
                <div>
                  <p className="rs-sign-party">{orgName}</p>
                  <div className="rs-sign-space" aria-hidden="true" />
                  <div className="rs-sign-rule" />
                  <p className="rs-sign-name">{org?.signatory_name || ' '}</p>
                  <p className="rs-sign-title">
                    {org?.signatory_title || 'Signatory position / title'}
                  </p>
                </div>
                <div>
                  <p className="rs-sign-party">{recipient?.company || 'The Partner'}</p>
                  <div className="rs-sign-space" aria-hidden="true" />
                  <div className="rs-sign-rule" />
                  <p className="rs-sign-name"> </p>
                  <p className="rs-sign-title">Signatory position / title</p>
                </div>
              </div>
            )}
          </div>
        </section>

        <div className="rs-foot-mark">
          {org?.logo_url ? (
            <img src={org.logo_url} alt={orgName} />
          ) : (
            <BrandMark size={40} />
          )}
        </div>

        <p className="rs-foot">
          {org?.email || org?.phone ? (
            <>
              Questions? Contact {org?.email}
              {org?.email && org?.phone ? ' · ' : ''}
              {org?.phone}
            </>
          ) : (
            <>Questions? Reply to the email this agreement came with.</>
          )}
        </p>

        {org?.agreement_footer && <p className="rs-foot">{org.agreement_footer}</p>}
      </main>
    </article>
  )
}

/** One label-over-value pair, as the banner and the acceptance record set them. */
function Meta({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="rs-meta-item">
      <span className="rs-meta-label">{label}</span>
      <span className="rs-meta-value">{value || '—'}</span>
    </div>
  )
}

function Record({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="rs-meta-item">
      <dt className="rs-meta-label">{label}</dt>
      <dd className="rs-meta-value">{value || '—'}</dd>
    </div>
  )
}

interface RateColumn {
  key: string
  group: string
  label: string
  rack: boolean
}

/**
 * The price columns, one per season and meal plan.
 *
 * The chart reads across rather than down: a room type is one row, and its
 * seasons sit beside each other under a season heading, which is how an
 * operator compares what they are being offered.
 */
function rateColumns(rates: SheetRate[], showRack: boolean): RateColumn[] {
  return bySeason(rates).flatMap(({ season }) =>
    MEAL_PLANS.flatMap((plan) => [
      { key: `${season}|${plan.key}`, group: season, label: `${plan.label} STO`, rack: false },
      ...(showRack
        ? [
            {
              key: `${season}|${RACK_OF[plan.key]}`,
              group: season,
              label: `${plan.label} Rack`,
              rack: true,
            },
          ]
        : []),
    ])
  )
}

interface RateRow {
  key: string
  room_type: string
  description: string | null
  pax: number
  currency: string
  cells: Record<string, number>
}

/**
 * One row per room type at a given occupancy.
 *
 * Keyed on both, because a Suite at 2 and the same Suite at 4 are two prices
 * and collapsing them onto one row would quietly drop one of them.
 */
function rateRows(rates: SheetRate[]): RateRow[] {
  const rows: RateRow[] = []
  const seen = new Map<string, RateRow>()

  for (const rate of rates) {
    const pax = rate.pax || rate.max_occupancy || 0
    const key = `${rate.room_type}|${pax}`
    let row = seen.get(key)
    if (!row) {
      row = {
        key,
        room_type: rate.room_type,
        description: rate.description,
        pax,
        currency: rate.currency,
        cells: {},
      }
      seen.set(key, row)
      rows.push(row)
    }
    if (!row.description && rate.description) row.description = rate.description

    const season = rate.season.trim() || 'All year'
    for (const plan of MEAL_PLANS) {
      row.cells[`${season}|${plan.key}`] = rate[plan.key]
      row.cells[`${season}|${RACK_OF[plan.key]}`] = rate[RACK_OF[plan.key]] ?? 0
    }
  }

  return rows
}

/** A figure in the chart. The currency rides in the heading unless it varies. */
function cell(value: number, currency: string | null) {
  const amount = Math.round(value).toLocaleString()
  return currency ? `${currency} ${amount}` : amount
}

/** Blank-line-separated text, as the paragraphs whoever typed it meant. */
function paragraphs(text: string) {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, i) => <p key={i}>{block}</p>)
}

const iconProps = {
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

function ShieldIcon() {
  return (
    <svg {...iconProps}>
      <path d="M20 13c0 5-3.5 7.5-7.7 8.9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1 1 0 0 1 1.5 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg {...iconProps}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </svg>
  )
}

function ImageIcon() {
  return (
    <svg {...iconProps} width={16} height={16}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg {...iconProps} width={18} height={18}>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  )
}
