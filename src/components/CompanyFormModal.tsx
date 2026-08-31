import { useState, type FormEvent } from 'react'
import { useCompanies, useProfiles } from '../hooks/useCrmData'
import { useAuth } from '../hooks/useAuth'
import { STAGE_LIST, STAGE_META } from '../lib/stage'
import type { Company, Stage } from '../lib/database.types'
import './ui.css'

interface Props {
  company?: Company
  onClose: () => void
  onSaved: () => void
}

export default function CompanyFormModal({ company, onClose, onSaved }: Props) {
  const { createCompany, updateCompany } = useCompanies()
  const { profiles } = useProfiles()
  const { profile, isOwner } = useAuth()

  const [name, setName] = useState(company?.name ?? '')
  const [industry, setIndustry] = useState(company?.industry ?? '')
  const [website, setWebsite] = useState(company?.website ?? '')
  const [address, setAddress] = useState(company?.address ?? '')
  const [city, setCity] = useState(company?.city ?? '')
  const [stage, setStage] = useState<Stage>(company?.stage ?? 'lead')
  const [ownerId, setOwnerId] = useState(company?.owner_id ?? profile?.id ?? '')
  const [notes, setNotes] = useState(company?.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setError('Company name is required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      // Only owners may assign a company to someone else; RLS rejects anything
      // else, so pin a rep's own id rather than letting the request fail.
      const effectiveOwnerId = isOwner ? ownerId || null : profile?.id ?? null
      const payload = {
        name: name.trim(),
        industry: industry.trim() || null,
        website: website.trim() || null,
        address: address.trim() || null,
        city: city.trim() || null,
        stage,
        owner_id: effectiveOwnerId,
        notes: notes.trim() || null,
      }
      if (company) {
        await updateCompany(company.id, payload)
      } else {
        await createCompany(payload)
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save company.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{company ? 'Edit company' : 'Add company'}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="c_name">Company name</label>
            <input id="c_name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Retail Ltd" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field">
              <label htmlFor="c_industry">Industry</label>
              <input id="c_industry" value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Retail" />
            </div>
            <div className="field">
              <label htmlFor="c_city">City</label>
              <input id="c_city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Arusha" />
            </div>
          </div>

          <div className="field">
            <label htmlFor="c_website">Website</label>
            <input id="c_website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
          </div>

          <div className="field">
            <label htmlFor="c_address">Address</label>
            <input id="c_address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, area" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field">
              <label htmlFor="c_stage">Pipeline stage</label>
              <select id="c_stage" value={stage} onChange={(e) => setStage(e.target.value as Stage)}>
                {STAGE_LIST.map((s) => (
                  <option key={s} value={s}>
                    {STAGE_META[s].label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="c_owner">Assigned rep</label>
              {isOwner ? (
                <select id="c_owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                  <option value="">Unassigned</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name || p.email}
                    </option>
                  ))}
                </select>
              ) : (
                <>
                  <input id="c_owner" value={profile?.full_name || profile?.email || 'You'} disabled />
                  <p className="field-hint">
                    {company && !company.owner_id
                      ? 'Saving claims this company for you. Only an Owner can reassign it later.'
                      : 'Only an Owner can assign companies to another rep.'}
                  </p>
                </>
              )}
            </div>
          </div>

          <div className="field">
            <label htmlFor="c_notes">Notes</label>
            <textarea id="c_notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything worth remembering about this account" />
          </div>

          {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : company ? 'Save changes' : 'Add company'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
