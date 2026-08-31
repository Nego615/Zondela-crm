import { useState, type FormEvent } from 'react'
import { useContacts } from '../hooks/useCrmData'
import type { Contact } from '../lib/database.types'
import './ui.css'

interface Props {
  companyId: string
  contact?: Contact
  onClose: () => void
  onSaved: () => void
}

export default function ContactFormModal({ companyId, contact, onClose, onSaved }: Props) {
  const { createContact, updateContact } = useContacts(companyId)

  const [fullName, setFullName] = useState(contact?.full_name ?? '')
  const [jobTitle, setJobTitle] = useState(contact?.job_title ?? '')
  const [email, setEmail] = useState(contact?.email ?? '')
  const [phone, setPhone] = useState(contact?.phone ?? '')
  const [whatsapp, setWhatsapp] = useState(contact?.whatsapp ?? '')
  const [isPrimary, setIsPrimary] = useState(contact?.is_primary ?? false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!fullName.trim()) {
      setError('Contact name is required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload = {
        company_id: companyId,
        full_name: fullName.trim(),
        job_title: jobTitle.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        whatsapp: whatsapp.trim() || null,
        is_primary: isPrimary,
      }
      if (contact) {
        await updateContact(contact.id, payload)
      } else {
        await createContact(payload)
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save contact.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{contact ? 'Edit contact' : 'Add contact'}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="ct_name">Full name</label>
            <input id="ct_name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Jane Mushi" />
          </div>
          <div className="field">
            <label htmlFor="ct_title">Job title</label>
            <input id="ct_title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="Marketing manager" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field">
              <label htmlFor="ct_email">Email</label>
              <input id="ct_email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@company.com" />
            </div>
            <div className="field">
              <label htmlFor="ct_phone">Phone</label>
              <input id="ct_phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+255 7XX XXX XXX" />
            </div>
          </div>
          <div className="field">
            <label htmlFor="ct_whatsapp">WhatsApp number</label>
            <input
              id="ct_whatsapp"
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="+255 7XX XXX XXX (if different)"
            />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 14 }}>
            <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />
            Primary contact for this company
          </label>

          {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : contact ? 'Save changes' : 'Add contact'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
