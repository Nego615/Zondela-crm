import { useMemo, useState } from 'react'
import { useCompanies, useContacts, useOrgSettings, useTemplates } from '../hooks/useCrmData'
import { useAgreementSends, agreementLink } from '../hooks/useStoVersions'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { PLACEHOLDERS, fillTemplate, formatRate, rateRange, scopeLabel } from '../lib/stoVersion'
import type { StoVersionWithRates } from '../lib/database.types'
import './ui.css'
import './send-version.css'

interface Props {
  version: StoVersionWithRates
  /** Pre-selects the operator, when sending from a company's own page. */
  companyId?: string
  onClose: () => void
  onSent: () => void
}

/**
 * Sending the season's rates to one operator.
 *
 * The send row is created first, because the link in the email is the token on
 * that row — there is nothing to paste into a message until the database has
 * issued it. The message itself goes out through the user's own mail client:
 * the CRM has no mail server, and pretending otherwise would mean claiming a
 * delivery it cannot see. What it does know is when the operator opens the
 * link, and that comes back on its own.
 */
export default function SendVersionModal({ version, companyId, onClose, onSent }: Props) {
  const { companies } = useCompanies()
  const { templates } = useTemplates()
  const { settings } = useOrgSettings()
  const { sends, createSend } = useAgreementSends()
  const { profile } = useAuth()

  const [company, setCompany] = useState(companyId ?? '')
  const { contacts } = useContacts(company || undefined)

  const [contactChoice, setContactChoice] = useState<string | null>(null)
  const contactId = contactChoice ?? contacts.find((c) => c.is_primary)?.id ?? contacts[0]?.id ?? ''
  const contact = contacts.find((c) => c.id === contactId)
  const companyName = companies.find((c) => c.id === company)?.name ?? ''

  const [templateId, setTemplateId] = useState('')
  const [subject, setSubject] = useState(`${settings?.org_name || 'Zondela House'} STO Rates — ${version.year}`)
  const [note, setNote] = useState('')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sentLink, setSentLink] = useState<string | null>(null)

  const template = templates.find((t) => t.id === templateId)
  const range = rateRange(version.rates)

  // Already sent this season's sheet to this operator? Sending again is
  // legitimate — a contact changes, a link is lost — but doing it unknowingly
  // is not, so the modal says so before the button is pressed.
  const previous = sends.filter((s) => s.version_id === version.id && s.company_id === company)

  /**
   * The message, with the link left as a placeholder until there is one.
   *
   * Composed the same way whether it comes from a template or not, so what is
   * previewed here is exactly what the mail client is handed.
   */
  const compose = (link: string) => {
    const values = {
      contactName: contact?.full_name?.split(' ')[0] || 'there',
      companyName: companyName || 'your team',
      year: version.year,
      versionName: version.name,
      link,
      senderName: profile?.full_name || settings?.org_name || 'Zondela House',
    }

    if (template) {
      // Templates are stored as HTML; the mail client is handed text, so the
      // tags come out and the placeholders go in.
      return fillTemplate(template.body_html.replace(/<[^>]+>/g, ''), values)
    }

    const rates = version.rates
      .map((r) => `• ${r.season} — ${r.room_type}: ${formatRate(r.price, r.currency)}${r.basis ? ` (${r.basis})` : ''}`)
      .join('\n')

    const signature = [
      'Kind regards,',
      profile?.full_name || settings?.org_name || 'Zondela House',
      settings?.email_signature || '',
    ]
      .filter(Boolean)
      .join('\n')

    return [
      `Dear ${values.contactName},`,
      '',
      `Please find the ${version.year} STO rates for ${settings?.org_name || 'Zondela House'}${companyName ? ` for ${companyName}` : ''}.`,
      version.summary ?? '',
      '',
      rates,
      '',
      'Open the rates in full and confirm your acceptance here:',
      link,
      '',
      'Should you have any questions, please do not hesitate to reach out.',
      '',
      signature,
    ]
      .filter((line) => line !== null)
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
  }

  const preview = useMemo(
    () => compose('[the operator’s own agreement link]'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [template, contact, companyName, version, profile, settings]
  )

  async function handleSend() {
    setError(null)
    if (!company) {
      setError('Choose the operator this is going to.')
      return
    }
    if (!contact?.email) {
      setError('That contact has no email address. Add one on the company page first.')
      return
    }

    setBusy(true)
    try {
      // The row first: its token is the link, so nothing can be composed
      // before it exists.
      const send = await createSend({
        version_id: version.id,
        company_id: company,
        contact_id: contactId || null,
        to_name: contact.full_name,
        to_email: contact.email,
        subject,
        sent_by: profile?.id ?? null,
        note: note.trim() || null,
      })

      const link = agreementLink(send.token)
      const body = compose(link)
      await supabase.from('sto_agreement_sends').update({ body }).eq('id', send.id)

      // The share log too, so the send shows up in the company's activity and
      // in reports alongside every other message. Best effort: the send row is
      // the record, and a rejected log insert must not read as an unsent sheet.
      try {
        await supabase.from('sent_messages').insert({
          company_id: company,
          contact_id: contactId || null,
          sent_by: profile?.id ?? null,
          channel: 'email',
          template_id: templateId || null,
          subject,
          body,
          to_name: contact.full_name,
          to_email: contact.email,
          status: 'sent',
        })
      } catch {
        // history is a convenience; sto_agreement_sends is the record
      }

      window.location.href = `mailto:${encodeURIComponent(contact.email)}?subject=${encodeURIComponent(
        subject
      )}&body=${encodeURIComponent(body)}`

      setSentLink(link)
      onSent()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record this send.')
    } finally {
      setBusy(false)
    }
  }

  async function copyLink(link: string) {
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal send-version" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Send {version.name}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        {sentLink ? (
          <div className="sv-done">
            <h3>Sent to {contact?.full_name}</h3>
            <p>
              Your mail client has the message. The operator opens the link below, reads the{' '}
              {version.year} rates and accepts them there — this page will show it as viewed, then
              accepted, on its own.
            </p>
            <div className="sv-link">
              <code>{sentLink}</code>
              <button className="btn btn-sm" onClick={() => copyLink(sentLink)}>
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
            <div className="version-actions">
              <button className="btn btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="sv-version">
              <strong>{version.name}</strong>
              <span>
                {scopeLabel(version.rates)}
                {range
                  ? ` · ${formatRate(range.from, range.currency)}–${formatRate(range.to, range.currency)}`
                  : ''}
              </span>
              {version.summary && <p>{version.summary}</p>}
            </div>

            <div className="sv-row">
              <div className="field">
                <label htmlFor="sv_company">Operator</label>
                <select
                  id="sv_company"
                  value={company}
                  onChange={(e) => {
                    setCompany(e.target.value)
                    setContactChoice(null)
                  }}
                >
                  <option value="">Select a company</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="sv_contact">Send to</label>
                <select
                  id="sv_contact"
                  value={contactId}
                  disabled={!company}
                  onChange={(e) => setContactChoice(e.target.value)}
                >
                  <option value="">Select a contact</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name}
                      {c.email ? ` — ${c.email}` : ' (no email)'}
                    </option>
                  ))}
                </select>
                {company && contacts.length === 0 && (
                  <p className="field-hint">
                    {companyName} has no contacts yet — add one on its page first.
                  </p>
                )}
              </div>
            </div>

            {previous.length > 0 && (
              <p className="sv-warn">
                {companyName} has already been sent this sheet {previous.length}{' '}
                {previous.length === 1 ? 'time' : 'times'}. Sending again issues a new link; the old
                one keeps working.
              </p>
            )}

            <div className="field">
              <label htmlFor="sv_subject">Subject</label>
              <input id="sv_subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>

            <div className="field">
              <label htmlFor="sv_template">Template</label>
              <select
                id="sv_template"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
              >
                <option value="">Standard rates email</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <p className="field-hint">
                Placeholders filled on send: {PLACEHOLDERS.join(', ')}
              </p>
            </div>

            <div className="field">
              <label htmlFor="sv_note">Internal note</label>
              <input
                id="sv_note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Only the team sees this — why this operator, what they asked for"
              />
            </div>

            <div className="field">
              <label>Message</label>
              <pre className="sv-preview">{preview}</pre>
            </div>

            {error && <p className="version-error">{error}</p>}

            <div className="version-actions">
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || !company || !contact?.email}
                onClick={handleSend}
              >
                {busy ? 'Recording…' : 'Open email and record send'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
