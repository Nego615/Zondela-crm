import { useMemo, useState } from 'react'
import { useRateCard, useTemplates, usePricingDocuments } from '../hooks/useCrmData'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import type { Contact, Company } from '../lib/database.types'
import './ui.css'

interface Props {
  company: Company
  contacts: Contact[]
  onClose: () => void
}

function formatPrice(price: number, currency: string) {
  return `${currency} ${price.toLocaleString()}`
}

export default function SharePricingModal({ company, contacts, onClose }: Props) {
  const { items } = useRateCard()
  const { templates } = useTemplates()
  const { documents, documentUrl } = usePricingDocuments()
  const { profile } = useAuth()

  const [contactId, setContactId] = useState(contacts.find((c) => c.is_primary)?.id ?? contacts[0]?.id ?? '')
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [templateId, setTemplateId] = useState<string>('')
  const [subject, setSubject] = useState(`${company.name} — SEO / STO proposal from Zondela`)
  const [channel, setChannel] = useState<'email' | 'whatsapp'>('email')
  const [documentChoice, setDocumentChoice] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)

  const contact = contacts.find((c) => c.id === contactId)

  // Resolved at render rather than held in state: the list loads after the
  // first render, so an initial value would be locked in as "none".
  const defaultDoc = documents.find((d) => d.is_default) ?? documents[0]
  const chosenDoc =
    documentChoice === null ? defaultDoc : documents.find((d) => d.id === documentChoice)
  const chosenDocUrl = chosenDoc ? documentUrl(chosenDoc) : null

  function toggleItem(id: string) {
    setSelectedItems((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const priceLines = useMemo(() => {
    return items
      .filter((i) => selectedItems.has(i.id))
      .map((i) => `• ${i.service_name} — ${formatPrice(i.price, i.currency)}${i.unit ? ` (${i.unit})` : ''}${i.description ? `\n  ${i.description}` : ''}`)
      .join('\n\n')
  }, [items, selectedItems])

  const messageBody = useMemo(() => {
    const templateBody = templateId ? templates.find((t) => t.id === templateId)?.body_html : ''
    const greeting = contact ? `Hi ${contact.full_name.split(' ')[0]},` : 'Hi,'
    const intro = templateBody
      ? templateBody.replace(/<[^>]+>/g, '')
      : `Thank you for your time. Below is our STO (search & optimization) pricing for ${company.name}.`
    const closing = `Let me know if you'd like to move forward or have any questions.\n\nBest,\n${profile?.full_name || 'Zondela team'}`

    // The PDF is the thing being sent; the text lines are a summary in the
    // body so the client sees the numbers without opening anything. When a PDF
    // is attached and nothing is ticked, the link carries the message alone.
    const pdfLines = chosenDocUrl
      ? [`Full price list (PDF): ${chosenDocUrl}`]
      : []
    const body = priceLines || (chosenDocUrl ? '' : '(No pricing items selected yet)')

    return [greeting, '', intro, '', body, ...(body ? [''] : []), ...pdfLines, ...(pdfLines.length ? [''] : []), closing]
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
  }, [contact, templateId, templates, priceLines, company.name, profile, chosenDocUrl])

  const whatsappNumber = (contact?.whatsapp || contact?.phone || '').replace(/[^\d+]/g, '')
  const whatsappUrl = `https://wa.me/${whatsappNumber.replace('+', '')}?text=${encodeURIComponent(messageBody)}`

  async function handleCopy() {
    await navigator.clipboard.writeText(messageBody)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  async function logAndOpen(action: () => void) {
    try {
      await supabase.from('sent_messages').insert({
        company_id: company.id,
        contact_id: contactId || null,
        channel,
        template_id: templateId || null,
        subject: channel === 'email' ? subject : null,
        body: messageBody,
      })
      setSaved(true)
    } catch {
      // logging failure shouldn't block the send action
    }
    action()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Share STO pricing</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="field">
          <label htmlFor="s_contact">Send to</label>
          <select id="s_contact" value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">Select a contact</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name} {c.email ? `— ${c.email}` : ''}
              </option>
            ))}
          </select>
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
            <label htmlFor="s_subject">Subject</label>
            <input id="s_subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
        )}

        <div className="field">
          <label htmlFor="s_template">Start from a template (optional)</label>
          <select id="s_template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">No template</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>STO rate card — select items to include</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, border: '1px solid var(--line)', borderRadius: 8, padding: 10, maxHeight: 160, overflowY: 'auto' }}>
            {items.length === 0 && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No rate card items yet. Add some on the STO rate card page.</p>}
            {items.map((item) => (
              <label key={item.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13 }}>
                <input type="checkbox" checked={selectedItems.has(item.id)} onChange={() => toggleItem(item.id)} style={{ marginTop: 3 }} />
                <span>
                  <strong>{item.service_name}</strong> — {formatPrice(item.price, item.currency)}
                  {item.unit ? ` (${item.unit})` : ''}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="s_pdf">Price list PDF</label>
          {documents.length === 0 ? (
            <p className="field-hint">
              None uploaded. Add one on the STO rate card page and it will be offered here.
            </p>
          ) : (
            <>
              <select
                id="s_pdf"
                value={chosenDoc?.id ?? ''}
                onChange={(e) => setDocumentChoice(e.target.value)}
              >
                <option value="">Don't include a PDF</option>
                {documents.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}.pdf{d.is_default ? ' (default)' : ''}
                  </option>
                ))}
              </select>
              <p className="field-hint">
                {chosenDocUrl
                  ? 'A link to this file goes in the message. Neither email nor WhatsApp links can carry an attachment, so the client opens it from the link — or use Download to attach it yourself.'
                  : 'The message will carry the ticked rate card items as text only.'}
              </p>
            </>
          )}
        </div>

        <div className="field">
          <label htmlFor="s_preview">Message preview</label>
          <textarea id="s_preview" value={messageBody} readOnly style={{ minHeight: 160, fontSize: 13 }} />
        </div>

        {saved && <p style={{ fontSize: 12, color: 'var(--stage-won)', marginBottom: 10 }}>Logged to this company's activity.</p>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {chosenDocUrl && (
            <a
              className="btn"
              href={chosenDocUrl}
              target="_blank"
              rel="noopener noreferrer"
              download={`${chosenDoc?.name ?? 'pricing'}.pdf`}
            >
              Download PDF
            </a>
          )}
          <button type="button" className="btn" onClick={handleCopy}>
            {copied ? 'Copied' : 'Copy message'}
          </button>
          {channel === 'email' ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!contact?.email}
              onClick={() =>
                logAndOpen(() => {
                  window.location.href = `mailto:${contact?.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(messageBody)}`
                })
              }
            >
              Open in email client
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!whatsappNumber}
              onClick={() => logAndOpen(() => window.open(whatsappUrl, '_blank'))}
            >
              Open in WhatsApp
            </button>
          )}
        </div>
        {channel === 'email' && !contact?.email && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>This contact has no email on file.</p>
        )}
        {channel === 'whatsapp' && !whatsappNumber && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>This contact has no WhatsApp or phone number on file.</p>
        )}
      </div>
    </div>
  )
}
