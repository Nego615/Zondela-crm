import { MEAL_PLANS, bySeason, formatDay, formatRate, policyBlocks } from '../lib/stoVersion'
import './rate-sheet.css'

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
  season: string
  room_type: string
  description: string | null
  bb_price: number
  hb_price: number
  fb_price: number
  max_occupancy: number
  currency: string
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
  sections?: SheetSection[]
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
 * Laid out the way the signed PDF is, because that is the document both sides
 * argue from: overview, the rates chart, the VAT line, supplements, then the
 * numbered policies, and the signature block at the end. The original PDF is
 * still linked for anyone who wants the file itself — this is the version that
 * opens on a phone without a download.
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
  org,
  recipient,
  pdfUrl,
  pdfName,
  draft,
  acceptance,
}: Props) {
  const brand = org?.brand_color || '#0c3b35'
  const accent = org?.accent_color || '#a9463a'
  const seasons = bySeason(rates)
  const orgName = org?.org_name || 'Zondela House'

  const orgLines = [
    org?.address,
    [org?.city, org?.country].filter(Boolean).join(', ') || null,
    org?.phone,
    org?.email,
    org?.website,
  ].filter(Boolean) as string[]

  const validity =
    version.valid_from || version.valid_to
      ? `Valid ${formatDay(version.valid_from)} → ${formatDay(version.valid_to)}`
      : `Season ${version.year}`

  // Numbered continuously through the document, the way the contract is: the
  // overview is 1, the rates are 2, and the policies carry on from there.
  let sectionNumber = 0
  const next = () => ++sectionNumber

  return (
    <article className="rs-doc" aria-label={version.name}>
      {draft && (
        <div className="rs-watermark" aria-hidden="true">
          DRAFT
        </div>
      )}

      <header className="rs-head" style={{ borderBottomColor: brand }}>
        <div className="rs-head-org">
          {org?.logo_url ? (
            <img className="rs-logo" src={org.logo_url} alt="" />
          ) : (
            <div className="rs-logo-fallback" style={{ background: brand }}>
              {orgName.slice(0, 1)}
            </div>
          )}
          <div>
            <h1 style={{ color: brand }}>{orgName}</h1>
            {org?.tagline && <p className="rs-tagline">{org.tagline}</p>}
          </div>
        </div>

        <div className="rs-head-meta">
          <span className="rs-kind" style={{ color: accent }}>
            Standard Tour Operator Rate Contract
          </span>
          <span className="rs-year">{version.year}</span>
          <span className="rs-validity">{validity}</span>
        </div>
      </header>

      <section className="rs-title">
        <h2 style={{ color: brand }}>{version.name}</h2>
        {version.summary && <p className="rs-summary">{version.summary}</p>}
        {(recipient?.company || recipient?.name) && (
          <p className="rs-for">
            Prepared for <strong>{recipient.company || recipient.name}</strong>
            {recipient.company && recipient.name ? ` · ${recipient.name}` : ''}
          </p>
        )}
      </section>

      {version.intro && (
        <section className="rs-section">
          <h3 style={{ color: brand }}>
            <span className="rs-num-badge">{next()}</span> Overview
          </h3>
          <div className="rs-prose">{paragraphs(version.intro)}</div>
        </section>
      )}

      <section className="rs-section">
        <h3 style={{ color: brand }}>
          <span className="rs-num-badge">{next()}</span> Accommodation rates
          {version.rate_basis ? ` (${version.rate_basis.toLowerCase()})` : ''}
        </h3>

        {seasons.length === 0 ? (
          <p className="rs-empty">No rates have been entered on this contract yet.</p>
        ) : (
          seasons.map(({ season, rates: seasonRates }) => (
            <div key={season} className="rs-season">
              {seasons.length > 1 && <h4>{season}</h4>}
              <table className="rs-table">
                <thead>
                  <tr style={{ background: `${brand}0f` }}>
                    <th>Room type</th>
                    {MEAL_PLANS.map((plan) => (
                      <th key={plan.key} className="rs-num" title={plan.full}>
                        STO {plan.label}
                      </th>
                    ))}
                    <th className="rs-num">Max occupancy</th>
                  </tr>
                </thead>
                <tbody>
                  {seasonRates.map((rate, i) => (
                    <tr key={rate.id ?? `${season}-${i}`}>
                      <td>
                        <span className="rs-room">{rate.room_type}</span>
                        {rate.description && <span className="rs-note">{rate.description}</span>}
                      </td>
                      {MEAL_PLANS.map((plan) => (
                        <td key={plan.key} className="rs-num rs-price">
                          {rate[plan.key] > 0 ? formatRate(rate[plan.key], rate.currency) : '—'}
                        </td>
                      ))}
                      <td className="rs-num rs-occupancy">{rate.max_occupancy || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        )}

        <p className="rs-plans">
          {MEAL_PLANS.map((plan) => `${plan.label} — ${plan.full.toLowerCase()}`).join(' · ')}
        </p>

        {version.rates_note && (
          <p className="rs-rates-note" style={{ borderLeftColor: accent }}>
            {version.rates_note}
          </p>
        )}
      </section>

      {supplements.length > 0 && (
        <section className="rs-section">
          <h3 style={{ color: brand }}>
            <span className="rs-num-badge">{next()}</span> Supplements
          </h3>
          <ul className="rs-supplements">
            {supplements.map((item, i) => (
              <li key={item.id ?? i}>
                <span>
                  <strong>{item.name}</strong>
                  {item.description ? ` — ${item.description}` : ''}
                </span>
                <span className="rs-price">
                  {formatRate(item.price, item.currency)} {item.unit}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {sections.map((section) => (
        <section key={section.id ?? section.title} className="rs-section">
          <h3 style={{ color: brand }}>
            <span className="rs-num-badge">{next()}</span> {section.title}
          </h3>
          <div className="rs-prose">
            {policyBlocks(section.body).map((block, i) =>
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
        </section>
      ))}

      {version.terms && (
        <section className="rs-section">
          <h3 style={{ color: brand }}>
            <span className="rs-num-badge">{next()}</span> Additional terms
          </h3>
          <div className="rs-prose">{paragraphs(version.terms)}</div>
        </section>
      )}

      {pdfUrl && (
        <p className="rs-pdf">
          <a href={pdfUrl} target="_blank" rel="noreferrer" style={{ color: accent }}>
            Download the signed contract{pdfName ? ` — ${pdfName}` : ''} (PDF)
          </a>
        </p>
      )}

      <section className="rs-sign">
        <div className="rs-sign-col">
          <p className="rs-sign-intro">On behalf of {orgName}</p>
          <p className="rs-sign-name">{org?.signatory_name || '________________________'}</p>
          <p className="rs-sign-title">{org?.signatory_title || 'Signatory position / title'}</p>
        </div>
        <div className="rs-sign-col">
          <p className="rs-sign-intro">
            On behalf of {acceptance?.company || recipient?.company || '________________________'},
            accepting the rates offered by {orgName} and the terms and conditions pertaining thereto
          </p>
          {acceptance?.name ? (
            <>
              <p className="rs-sign-name">{acceptance.name}</p>
              <p className="rs-sign-title">
                {acceptance.title ? `${acceptance.title} · ` : ''}
                Accepted {formatDay(acceptance.at)}
              </p>
            </>
          ) : (
            <>
              <p className="rs-sign-name">________________________</p>
              <p className="rs-sign-title">Signatory position / title</p>
            </>
          )}
        </div>
      </section>

      <footer className="rs-foot" style={{ borderTopColor: brand }}>
        <div className="rs-foot-org">
          <strong>{org?.legal_name || orgName}</strong>
          {orgLines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
        {org?.agreement_footer && (
          <div className="rs-foot-sign">
            <span className="rs-foot-note">{org.agreement_footer}</span>
          </div>
        )}
      </footer>
    </article>
  )
}

/** Blank-line-separated text, as the paragraphs whoever typed it meant. */
function paragraphs(text: string) {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, i) => <p key={i}>{block}</p>)
}
