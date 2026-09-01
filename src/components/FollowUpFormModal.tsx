import { useState, type FormEvent } from 'react'
import { useFollowUps, useProfiles } from '../hooks/useCrmData'
import { useAuth } from '../hooks/useAuth'
import { repLabel } from '../lib/rep'
import type { Contact, FollowUp, FollowUpStatus } from '../lib/database.types'
import './ui.css'

interface Props {
  companyId: string
  contacts: Contact[]
  followUp?: FollowUp
  onClose: () => void
  onSaved: () => void
}

function toLocalInputValue(iso?: string) {
  const d = iso ? new Date(iso) : new Date(Date.now() + 24 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function FollowUpFormModal({ companyId, contacts, followUp, onClose, onSaved }: Props) {
  const { createFollowUp, updateFollowUp } = useFollowUps(companyId)
  const { profiles } = useProfiles()
  const { profile } = useAuth()

  const [contactId, setContactId] = useState(followUp?.contact_id ?? contacts.find((c) => c.is_primary)?.id ?? '')
  // A typed name, resolved at render so a follow-up still linked to a team
  // member keeps that name once profiles load. See the note in
  // AppointmentFormModal.
  const [assignedNameDraft, setAssignedNameDraft] = useState<string | null>(null)
  const assignedName =
    assignedNameDraft ??
    (followUp
      ? repLabel(profiles, followUp.assigned_to, followUp.assigned_name, '')
      : profile?.full_name || profile?.email || '')
  const [dueAt, setDueAt] = useState(toLocalInputValue(followUp?.due_at))
  const [note, setNote] = useState(followUp?.note ?? '')
  const [status, setStatus] = useState<FollowUpStatus>(followUp?.status ?? 'pending')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!note.trim()) {
      setError('Add a short note about what this follow-up is for.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload = {
        company_id: companyId,
        contact_id: contactId || null,
        // follow_ups_access passes on can_access_company, so a null
        // assigned_to is accepted.
        assigned_to: null,
        assigned_name: assignedName.trim() || null,
        due_at: new Date(dueAt).toISOString(),
        note: note.trim(),
        status,
      }
      if (followUp) {
        await updateFollowUp(followUp.id, payload)
      } else {
        await createFollowUp(payload)
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the follow-up.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{followUp ? 'Edit follow-up' : 'Schedule follow-up'}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="f_note">What's this follow-up about?</label>
            <textarea id="f_note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Call to confirm they received the STO proposal" />
          </div>

          <div className="field">
            <label htmlFor="f_due">Due</label>
            <input id="f_due" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field">
              <label htmlFor="f_contact">Contact</label>
              <select id="f_contact" value={contactId} onChange={(e) => setContactId(e.target.value)}>
                <option value="">No contact selected</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="f_assigned">Assigned to</label>
              <input
                id="f_assigned"
                value={assignedName}
                onChange={(e) => setAssignedNameDraft(e.target.value)}
                placeholder="Their name"
              />
              <p className="field-hint">
                A name only — with no login linked, this will not appear in that person's own queue.
              </p>
            </div>
          </div>

          <div className="field">
            <label htmlFor="f_status">Status</label>
            <select id="f_status" value={status} onChange={(e) => setStatus(e.target.value as FollowUpStatus)}>
              <option value="pending">Pending</option>
              <option value="done">Done</option>
              <option value="skipped">Skipped</option>
            </select>
          </div>

          {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : followUp ? 'Save changes' : 'Schedule follow-up'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
