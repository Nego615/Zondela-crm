import { useState, type FormEvent } from 'react'
import { useSiteVisits, useCompanies, useAllContacts, useProfiles } from '../hooks/useCrmData'
import { useAuth } from '../hooks/useAuth'
import { APPOINTMENT_KINDS } from '../lib/appointment'
import { repLabel } from '../lib/rep'
import type { AppointmentKind, Contact, SiteVisit, VisitStatus } from '../lib/database.types'
import './ui.css'

interface Props {
  /** Omitted when scheduling from the Appointments page, which then asks. */
  companyId?: string
  contacts?: Contact[]
  visit?: SiteVisit
  onClose: () => void
  onSaved: () => void
}

function toLocalInputValue(iso?: string) {
  const d = iso ? new Date(iso) : new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function AppointmentFormModal({
  companyId,
  contacts,
  visit,
  onClose,
  onSaved,
}: Props) {
  const { createVisit, updateVisit } = useSiteVisits(companyId)
  const { profiles } = useProfiles()
  const { profile } = useAuth()

  // Only fetched for the standalone case; a company page already has both.
  const needsCompanyPicker = !companyId
  const { companies } = useCompanies()
  const { contacts: allContacts } = useAllContacts()

  const [selectedCompanyId, setSelectedCompanyId] = useState(companyId ?? visit?.company_id ?? '')

  const effectiveCompanyId = companyId ?? selectedCompanyId
  const contactOptions = contacts ?? allContacts.filter((c) => c.company_id === effectiveCompanyId)

  const [kind, setKind] = useState<AppointmentKind>(visit?.kind ?? 'site_visit')
  const [contactId, setContactId] = useState(visit?.contact_id ?? '')
  // The rep is a typed name; nothing here links a login any more.
  //
  // Null means "not edited yet", resolved at render rather than in initial
  // state: profiles load after the first render, so an appointment still
  // linked to a team member would otherwise open with an empty box and lose
  // the name on save. A new appointment starts on the signed-in user, which is
  // who it usually belongs to.
  const [repNameDraft, setRepNameDraft] = useState<string | null>(null)
  const repName =
    repNameDraft ??
    (visit
      ? repLabel(profiles, visit.rep_id, visit.rep_name, '')
      : profile?.full_name || profile?.email || '')
  const [scheduledFor, setScheduledFor] = useState(toLocalInputValue(visit?.scheduled_for))
  const [status, setStatus] = useState<VisitStatus>(visit?.status ?? 'scheduled')
  const [summary, setSummary] = useState(visit?.summary ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!effectiveCompanyId) {
      setError('Choose which company this is with.')
      return
    }
    if (!scheduledFor) {
      setError('Pick a date and time.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload = {
        company_id: effectiveCompanyId,
        kind,
        contact_id: contactId || null,
        // No control links a profile any more. site_visits_access still
        // passes on can_access_company, so a null rep_id is accepted — unlike
        // companies, nothing has to be pinned here.
        rep_id: null,
        rep_name: repName.trim() || null,
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
      setError(err instanceof Error ? err.message : 'Could not save the appointment.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{visit ? 'Edit appointment' : 'Schedule an appointment'}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Type</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {APPOINTMENT_KINDS.map((k) => (
                <button
                  key={k.value}
                  type="button"
                  className={`btn${kind === k.value ? ' btn-primary' : ''}`}
                  aria-pressed={kind === k.value}
                  onClick={() => setKind(k.value)}
                >
                  {k.label}
                </button>
              ))}
            </div>
            <p className="field-hint">
              {APPOINTMENT_KINDS.find((k) => k.value === kind)?.hint}
            </p>
          </div>

          {needsCompanyPicker && (
            <div className="field">
              <label htmlFor="v_company">Company</label>
              <select
                id="v_company"
                value={selectedCompanyId}
                onChange={(e) => {
                  setSelectedCompanyId(e.target.value)
                  // The old contact belongs to the old company.
                  setContactId('')
                }}
              >
                <option value="">Choose a company</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="field">
            <label htmlFor="v_when">Date and time</label>
            <input id="v_when" type="datetime-local" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field">
              <label htmlFor="v_contact">Company representative</label>
              <select id="v_contact" value={contactId} onChange={(e) => setContactId(e.target.value)}>
                <option value="">No contact selected</option>
                {contactOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="v_rep">Zondela rep</label>
              <input
                id="v_rep"
                value={repName}
                onChange={(e) => setRepNameDraft(e.target.value)}
                placeholder="Their name"
              />
              <p className="field-hint">
                A name only — with no login linked, this will not show up in that person's own
                Dashboard.
              </p>
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
              {saving ? 'Saving…' : visit ? 'Save changes' : 'Schedule it'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
