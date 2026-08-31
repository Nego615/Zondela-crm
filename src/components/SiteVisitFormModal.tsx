import { useState, type FormEvent } from 'react'
import { useSiteVisits, useProfiles } from '../hooks/useCrmData'
import { useAuth } from '../hooks/useAuth'
import type { Contact, SiteVisit, VisitStatus } from '../lib/database.types'
import './ui.css'

interface Props {
  companyId: string
  contacts: Contact[]
  visit?: SiteVisit
  onClose: () => void
  onSaved: () => void
}

function toLocalInputValue(iso?: string) {
  const d = iso ? new Date(iso) : new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function SiteVisitFormModal({ companyId, contacts, visit, onClose, onSaved }: Props) {
  const { createVisit, updateVisit } = useSiteVisits(companyId)
  const { profiles } = useProfiles()
  const { profile } = useAuth()

  const [contactId, setContactId] = useState(visit?.contact_id ?? contacts.find((c) => c.is_primary)?.id ?? '')
  const [repId, setRepId] = useState(visit?.rep_id ?? profile?.id ?? '')
  const [scheduledFor, setScheduledFor] = useState(toLocalInputValue(visit?.scheduled_for))
  const [status, setStatus] = useState<VisitStatus>(visit?.status ?? 'scheduled')
  const [summary, setSummary] = useState(visit?.summary ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!scheduledFor) {
      setError('Pick a date and time.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload = {
        company_id: companyId,
        contact_id: contactId || null,
        rep_id: repId || null,
        scheduled_for: new Date(scheduledFor).toISOString(),
        status,
        summary: summary.trim() || null,
      }
      if (visit) {
        await updateVisit(visit.id, payload)
      } else {
        await createVisit(payload)
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the visit.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{visit ? 'Edit site visit' : 'Schedule site visit'}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="v_when">Date and time</label>
            <input id="v_when" type="datetime-local" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field">
              <label htmlFor="v_contact">Company representative</label>
              <select id="v_contact" value={contactId} onChange={(e) => setContactId(e.target.value)}>
                <option value="">No contact selected</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="v_rep">Zondela rep</label>
              <select id="v_rep" value={repId} onChange={(e) => setRepId(e.target.value)}>
                <option value="">Unassigned</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.email}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label htmlFor="v_status">Status</label>
            <select id="v_status" value={status} onChange={(e) => setStatus(e.target.value as VisitStatus)}>
              <option value="scheduled">Scheduled</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="v_summary">Notes / summary</label>
            <textarea
              id="v_summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="What was discussed, what to prepare, outcomes"
            />
          </div>

          {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : visit ? 'Save changes' : 'Schedule visit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
