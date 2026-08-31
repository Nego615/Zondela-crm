import { useMemo, useState } from 'react'
import { useRateCard, useTemplates } from '../hooks/useCrmData'
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
  const { profile } = useAuth()

  const [contactId, setContactId] = useState(contacts.find((c) => c.is_primary)?.id ?? contacts[0]?.id ?? '')
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [templateId, setTemplateId] = useState<string>('')
  const [subject, setSubject] = useState(`${company.name} — SEO / STO proposal from Zondela`)
  const [channel, setChannel] = useState<'email' | 'whatsapp'>('email')
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)

  const contact = contacts.find((c) => c.id === contactId)

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

    return [greeting, '', intro, '', priceLines || '(No pricing items selected yet)', '', closing].join('\n')
  }, [contact, templateId, templates, priceLines, company.name, profile])

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
          <label htmlFor="s_preview">Message preview</label>
          <textarea id="s_preview" value={messageBody} readOnly style={{ minHeight: 160, fontSize: 13 }} />
        </div>

        {saved && <p style={{ fontSize: 12, color: 'var(--stage-won)', marginBottom: 10 }}>Logged to this company's activity.</p>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
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
