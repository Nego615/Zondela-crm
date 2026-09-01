import { useMemo, useState } from 'react'
import { useCompanies, useContacts, useTemplates, usePricingDocuments, useStoAgreements } from '../hooks/useCrmData'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { agreementTotals, formatMoney, formatDate, lineTotal } from '../lib/agreement'
import type { StoAgreementWithItems } from '../lib/database.types'
import './ui.css'

interface Props {
  agreement: StoAgreementWithItems
  onClose: () => void
  onSent: () => void
}

export default function SendAgreementModal({ agreement, onClose, onSent }: Props) {
  const { companies } = useCompanies()
  const { contacts } = useContacts(agreement.company_id)
  const { templates } = useTemplates()
  const { documents, documentUrl } = usePricingDocuments()
  const { setStatus } = useStoAgreements()
  const { profile } = useAuth()

  const company = companies.find((c) => c.id === agreement.company_id)
  const companyName = company?.name ?? 'this company'

  // Null means "not picked yet", resolved at render rather than in initial
  // state: contacts arrive after the first render, so an initial value would
  // lock in "none" for an agreement that never named a signing contact.
  const [contactChoice, setContactChoice] = useState<string | null>(agreement.contact_id)
  const contactId =
    contactChoice ?? contacts.find((c) => c.is_primary)?.id ?? contacts[0]?.id ?? ''

  const [channel, setChannel] = useState<'email' | 'whatsapp'>('email')
  const [templateId, setTemplateId] = useState('')
  const [subject, setSubject] = useState(`${companyName} — ${agreement.title} (${agreement.reference})`)
  const [includePdf, setIncludePdf] = useState(true)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const contact = contacts.find((c) => c.id === contactId)
  const totals = agreementTotals(agreement.items, agreement.discount_percent)

  // The default PDF, if there is one — the price list the team already sends.
  const defaultDoc = documents.find((d) => d.is_default) ?? documents[0]
  const pdfUrl = includePdf && defaultDoc ? documentUrl(defaultDoc) : null

  const messageBody = useMemo(() => {
    const greeting = contact ? `Hi ${contact.full_name.split(' ')[0]},` : 'Hi,'
    const templateBody = templateId ? templates.find((t) => t.id === templateId)?.body_html : ''
    const intro = templateBody
      ? templateBody.replace(/<[^>]+>/g, '')
      : `Here is the STO agreement for ${companyName}, reference ${agreement.reference}.`

    const lines = agreement.items.map(
      (i) =>
        `• ${i.service_name}${i.quantity !== 1 ? ` ×${i.quantity}` : ''} — ${formatMoney(lineTotal(i), agreement.currency)}${i.unit ? ` (${i.unit})` : ''}${i.description ? `\n  ${i.description}` : ''}`
    )

    const money = [
      agreement.discount_percent > 0
        ? `Subtotal: ${formatMoney(totals.subtotal, agreement.currency)}\nDiscount (${agreement.discount_percent}%): −${formatMoney(totals.discount, agreement.currency)}`
        : '',
      `Total: ${formatMoney(totals.total, agreement.currency)}`,
    ].filter(Boolean)

    const dates = [
      agreement.starts_on ? `Starts: ${formatDate(agreement.starts_on)}` : '',
      agreement.valid_until ? `Valid until: ${formatDate(agreement.valid_until)}` : '',
    ].filter(Boolean)

    const closing = `Reply to confirm and we'll get started.\n\nBest,\n${profile?.full_name || 'Zondela team'}`

    return [
      greeting,
      '',
      intro,
      '',
      agreement.title,
      ...lines,
      '',
      ...money,
      ...(dates.length ? ['', ...dates] : []),
      ...(agreement.terms ? ['', 'Terms', agreement.terms] : []),
      ...(pdfUrl ? ['', `Full price list (PDF): ${pdfUrl}`] : []),
      '',
      closing,
    ]
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
  }, [agreement, companyName, contact, templateId, templates, totals, pdfUrl, profile])

  const whatsappNumber = (contact?.whatsapp || contact?.phone || '').replace(/[^\d+]/g, '')
  const whatsappUrl = `https://wa.me/${whatsappNumber.replace('+', '')}?text=${encodeURIComponent(messageBody)}`

  async function handleCopy() {
    await navigator.clipboard.writeText(messageBody)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  /**
   * Marking it sent is the point of this modal, so that write is the one
   * allowed to fail loudly. The share history entry is best effort — a
   * message that went out should not be recorded as unsent because a log
   * insert was rejected.
   */
  async function sendVia(open: () => void) {
    setBusy(true)
    setError(null)
    try {
      await setStatus(agreement.id, 'sent')
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : 'Could not mark this agreement as sent.')
      return
    }

    try {
      await supabase.from('sent_messages').insert({
        company_id: agreement.company_id,
        contact_id: contactId || null,
        sent_by: profile?.id ?? null,
        channel,
        template_id: templateId || null,
        subject: channel === 'email' ? subject : null,
        body: messageBody,
      })
    } catch {
      // history is a convenience; the agreement's own sent_at is the record
    }

    setBusy(false)
    open()
    onSent()
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Send {agreement.reference}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="field">
          <label htmlFor="sa_contact">Send to</label>
          <select id="sa_contact" value={contactId} onChange={(e) => setContactChoice(e.target.value)}>
            <option value="">Select a contact</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name} {c.email ? `— ${c.email}` : ''}
              </option>
            ))}
          </select>
          {contacts.length === 0 && (
            <p className="field-hint">{companyName} has no contacts yet — add one on its page first.</p>
          )}
        </div>

        <div className="field">
          <label>Channel</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className={`btn ${channel === 'email' ? 'btn-primary' : ''}`}
              onClick={() => setChannel('email')}
            >
              Email
            </button>
            <button
              type="button"
              className={`btn ${channel === 'whatsapp' ? 'btn-primary' : ''}`}
              onClick={() => setChannel('whatsapp')}
            >
              WhatsApp
            </button>
          </div>
        </div>

        {channel === 'email' && (
          <div className="field">
            <label htmlFor="sa_subject">Subject</label>
            <input id="sa_subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
        )}

        <div className="field">
          <label htmlFor="sa_template">Opening paragraph from a template (optional)</label>
          <select id="sa_template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">No template</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        {defaultDoc && (
          <div className="field">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none' }}>
              <input type="checkbox" checked={includePdf} onChange={(e) => setIncludePdf(e.target.checked)} />
              Include a link to {defaultDoc.name}.pdf
            </label>
          </div>
        )}

        <div className="field">
          <label htmlFor="sa_preview">Message preview</label>
          <textarea id="sa_preview" value={messageBody} readOnly style={{ minHeight: 200, fontSize: 13 }} />
        </div>

        {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
          Sending marks {agreement.reference} as sent and logs it to this company's share history.
        </p>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button type="button" className="btn" onClick={handleCopy}>
            {copied ? 'Copied' : 'Copy message'}
          </button>
          {channel === 'email' ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !contact?.email}
              onClick={() =>
                sendVia(() => {
                  window.location.href = `mailto:${contact?.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(messageBody)}`
                })
              }
            >
              {busy ? 'Sending…' : 'Open in email client'}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !whatsappNumber}
              onClick={() => sendVia(() => window.open(whatsappUrl, '_blank'))}
            >
              {busy ? 'Sending…' : 'Open in WhatsApp'}
            </button>
          )}
        </div>

        {channel === 'email' && contact && !contact.email && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
            This contact has no email on file.
          </p>
        )}
        {channel === 'whatsapp' && contact && !whatsappNumber && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
            This contact has no WhatsApp or phone number on file.
          </p>
        )}
      </div>
    </div>
  )
}
