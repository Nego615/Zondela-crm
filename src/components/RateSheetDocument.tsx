import { bySeason, formatDay, formatRate } from '../lib/stoVersion'
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
  basis: string | null
  description: string | null
  price: number
  currency: string
}

export interface SheetVersion {
  name: string
  year: number
  summary?: string | null
  intro?: string | null
  terms?: string | null
  valid_from: string | null
  valid_to: string | null
}

interface Props {
  version: SheetVersion
  rates: SheetRate[]
  org: SheetOrg | null
  /** Who it was sent to, printed under the title so the operator sees their own name. */
  recipient?: { name?: string | null; company?: string | null }
  /** The uploaded rate sheet, offered alongside the rendered one. */
  pdfUrl?: string | null
  pdfName?: string | null
  draft?: boolean
}

/**
 * The season's rates for Zondela House, as the operator reads them.
 *
 * This is the redesign of the rate sheet that used to travel only as a PDF
 * attachment: the same content, laid out as a document the operator can read
 * on a phone, with the original PDF still linked for anyone who wants the file
 * they are used to. One table per season, because that is how a rate sheet is
 * quoted and how it is argued over.
 *
 * Everything identifying Zondela comes from org_settings, so rebranding is the
 * STO → Settings form rather than an edit in here. The two colours are applied
 * inline rather than through CSS variables on purpose: this markup is also what
 * gets printed, and inline styles are the only styling that survives that.
 */
export default function RateSheetDocument({
  version,
  rates,
  org,
  recipient,
  pdfUrl,
  pdfName,
  draft,
}: Props) {
  const brand = org?.brand_color || '#0c3b35'
  const accent = org?.accent_color || '#a9463a'
  const seasons = bySeason(rates)

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
              {(org?.org_name || 'Z').slice(0, 1)}
            </div>
          )}
          <div>
            <h1 style={{ color: brand }}>{org?.org_name || 'Zondela House'}</h1>
            {org?.tagline && <p className="rs-tagline">{org.tagline}</p>}
          </div>
        </div>

        <div className="rs-head-meta">
          <span className="rs-kind" style={{ color: accent }}>
            STO rates
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

      {version.intro && <div className="rs-prose">{paragraphs(version.intro)}</div>}

      {seasons.length === 0 ? (
        <p className="rs-empty">No rates have been entered on this sheet yet.</p>
      ) : (
        seasons.map(({ season, rates: seasonRates }) => (
          <section key={season} className="rs-season">
            <h3 style={{ color: brand }}>{season}</h3>
            <table className="rs-table">
              <thead>
                <tr style={{ background: `${brand}0f` }}>
                  <th>Room type</th>
                  <th>Basis</th>
                  <th className="rs-num">Rate</th>
                </tr>
              </thead>
              <tbody>
                {seasonRates.map((rate, i) => (
                  <tr key={rate.id ?? `${season}-${i}`}>
                    <td>
                      <span className="rs-room">{rate.room_type}</span>
                      {rate.description && <span className="rs-note">{rate.description}</span>}
                    </td>
                    <td className="rs-basis">{rate.basis || '—'}</td>
                    <td className="rs-num rs-price" style={{ color: brand }}>
                      {formatRate(rate.price, rate.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))
      )}

      {pdfUrl && (
        <p className="rs-pdf">
          <a href={pdfUrl} target="_blank" rel="noreferrer" style={{ color: accent }}>
            Download the signed rate sheet{pdfName ? ` — ${pdfName}` : ''} (PDF)
          </a>
        </p>
      )}

      {version.terms && (
        <section className="rs-terms">
          <h3 style={{ color: brand }}>Terms and conditions</h3>
          <div className="rs-prose">{paragraphs(version.terms)}</div>
        </section>
      )}

      <footer className="rs-foot" style={{ borderTopColor: brand }}>
        <div className="rs-foot-org">
          <strong>{org?.legal_name || org?.org_name || 'Zondela House'}</strong>
          {orgLines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
        {(org?.signatory_name || org?.agreement_footer) && (
          <div className="rs-foot-sign">
            {org?.signatory_name && (
              <>
                <span className="rs-sign-name">{org.signatory_name}</span>
                {org.signatory_title && <span>{org.signatory_title}</span>}
              </>
            )}
            {org?.agreement_footer && <span className="rs-foot-note">{org.agreement_footer}</span>}
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
