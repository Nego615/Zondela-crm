import { agreementTotals, formatDate, formatMoney, lineTotal } from '../lib/agreement'
import type { Company, Contact, OrgSettings, StoAgreementWithItems } from '../lib/database.types'
import './agreement-document.css'

interface Props {
  agreement: StoAgreementWithItems
  company?: Company
  contact?: Contact
  settings: OrgSettings | null
  /** Draws the "DRAFT" watermark. On by default for anything not yet sent. */
  draft?: boolean
}

/**
 * The branded agreement — what the client actually receives.
 *
 * Everything identifying Zondela comes from org_settings, so rebranding is the
 * STO → Settings form rather than an edit in here. The two colours are applied
 * as inline styles rather than CSS variables on purpose: this markup is also
 * what gets printed to PDF and pasted into mail, and inline styles are the
 * only styling that survives both.
 *
 * Layout is print-first — A4 proportions, no interactivity, and a page-break
 * rule that keeps a line item off the fold. `agreement-document.css` carries
 * the @media print block that hides everything else on the page.
 */
export default function AgreementDocument({
  agreement,
  company,
  contact,
  settings,
  draft,
}: Props) {
  const totals = agreementTotals(agreement.items, agreement.discount_percent)
  const brand = settings?.brand_color || '#0c3b35'
  const accent = settings?.accent_color || '#a9463a'
  const isDraft = draft ?? agreement.status === 'draft'

  const orgLines = [
    settings?.address,
    [settings?.city, settings?.country].filter(Boolean).join(', ') || null,
    settings?.phone,
    settings?.email,
    settings?.website,
  ].filter(Boolean) as string[]

  // The agreement's own terms win; the default from settings is what a new
  // agreement falls back to when nobody typed any.
  const terms = agreement.terms || settings?.agreement_terms_default

  return (
    <article className="agr-doc" aria-label={`Agreement ${agreement.reference}`}>
      {isDraft && (
        <div className="agr-watermark" aria-hidden="true">
          DRAFT
        </div>
      )}

      <header className="agr-head" style={{ borderBottomColor: brand }}>
        <div className="agr-head-org">
          {settings?.logo_url ? (
            <img className="agr-logo" src={settings.logo_url} alt="" />
          ) : (
            <div className="agr-logo-fallback" style={{ background: brand }}>
              {(settings?.org_name || 'Z').slice(0, 1)}
            </div>
          )}
          <div>
            <h1 style={{ color: brand }}>{settings?.org_name || 'Zondela House'}</h1>
            {settings?.tagline && <p className="agr-tagline">{settings.tagline}</p>}
          </div>
        </div>

        <div className="agr-head-meta">
          <span className="agr-doc-kind" style={{ color: accent }}>
            Service agreement
          </span>
          <span className="agr-ref">{agreement.reference}</span>
          <span className="agr-issued">Issued {formatDate(agreement.sent_at ?? agreement.created_at)}</span>
        </div>
      </header>

      <section className="agr-parties">
        <div>
          <h2>From</h2>
          <p className="agr-party-name">{settings?.legal_name || settings?.org_name || 'Zondela House'}</p>
          {orgLines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        <div>
          <h2>Prepared for</h2>
          <p className="agr-party-name">{company?.name ?? '—'}</p>
          {contact && <p>{contact.full_name}{contact.job_title ? `, ${contact.job_title}` : ''}</p>}
          {contact?.email && <p>{contact.email}</p>}
          {company?.address && <p>{company.address}</p>}
          {company?.country && <p>{company.country}</p>}
        </div>
      </section>

      <h2 className="agr-title">{agreement.title}</h2>

      {settings?.agreement_intro && <p className="agr-intro">{settings.agreement_intro}</p>}

      <table className="agr-table">
        <thead>
          <tr style={{ background: brand }}>
            <th>Service</th>
            <th className="agr-num">Qty</th>
            <th className="agr-num">Unit price</th>
            <th className="agr-num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {agreement.items.map((item) => (
            <tr key={item.id}>
              <td>
                <strong>{item.service_name}</strong>
                {item.unit && <span className="agr-unit"> · {item.unit}</span>}
                {item.description && <p className="agr-line-desc">{item.description}</p>}
              </td>
              <td className="agr-num">{item.quantity}</td>
              <td className="agr-num">{formatMoney(item.unit_price, agreement.currency)}</td>
              <td className="agr-num">{formatMoney(lineTotal(item), agreement.currency)}</td>
            </tr>
          ))}
          {agreement.items.length === 0 && (
            <tr>
              <td colSpan={4} className="agr-empty">
                No lines on this agreement yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="agr-totals">
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
        <div className="agr-grand" style={{ background: brand }}>
          <span>Total</span>
          <span>{formatMoney(totals.total, agreement.currency)}</span>
        </div>
      </div>

      {(agreement.starts_on || agreement.valid_until) && (
        <dl className="agr-dates">
          {agreement.starts_on && (
            <>
              <dt>Starts</dt>
              <dd>{formatDate(agreement.starts_on)}</dd>
            </>
          )}
          {agreement.valid_until && (
            <>
              <dt>Valid until</dt>
              <dd>{formatDate(agreement.valid_until)}</dd>
            </>
          )}
        </dl>
      )}

      {terms && (
        <section className="agr-terms">
          <h3 style={{ color: brand }}>Terms</h3>
          <p>{terms}</p>
        </section>
      )}

      <section className="agr-signatures">
        <div>
          <span className="agr-sig-line" />
          <p className="agr-sig-name">{settings?.signatory_name || '—'}</p>
          <p className="agr-sig-role">
            {settings?.signatory_title || 'Authorised signatory'},{' '}
            {settings?.org_name || 'Zondela House'}
          </p>
        </div>
        <div>
          <span className="agr-sig-line" />
          <p className="agr-sig-name">{contact?.full_name || '—'}</p>
          <p className="agr-sig-role">
            {contact?.job_title ? `${contact.job_title}, ` : ''}
            {company?.name ?? 'Client'}
          </p>
        </div>
      </section>

      <footer className="agr-foot" style={{ borderTopColor: brand }}>
        <p>{settings?.agreement_footer || `${settings?.org_name || 'Zondela House'} · ${agreement.reference}`}</p>
      </footer>
    </article>
  )
}
