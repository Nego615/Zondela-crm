import { useState, type FormEvent } from 'react'
import { useCompanies, useProfiles } from '../hooks/useCrmData'
import { useAuth } from '../hooks/useAuth'
import { STAGE_LIST, STAGE_META } from '../lib/stage'
import { MAIN_MARKET_OPTIONS, RELATIONSHIP_OPTIONS } from '../lib/company'
import { repLabel } from '../lib/rep'
import type { Company, MainMarket, Relationship, Stage } from '../lib/database.types'
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

  const [website, setWebsite] = useState(company?.website ?? '')
  const [address, setAddress] = useState(company?.address ?? '')
  const [country, setCountry] = useState(company?.country ?? '')
  const [relationship, setRelationship] = useState<Relationship | ''>(company?.relationship ?? '')
  const [mainMarket, setMainMarket] = useState<MainMarket | ''>(company?.main_market ?? '')
  const [stage, setStage] = useState<Stage>(company?.stage ?? 'lead')
  // Assigned rep is a typed name; nothing here links a login any more.
  //
  // Null means "not edited yet", resolved at render rather than in initial
  // state: profiles load after the first render, so a company still linked to
  // a team member would otherwise open with an empty box and lose the name on
  // save. Seeding it with the linked rep's name keeps the label when the link
  // itself goes.
  const [ownerNameDraft, setOwnerNameDraft] = useState<string | null>(null)
  const ownerName =
    ownerNameDraft ?? (company ? repLabel(profiles, company.owner_id, company.owner_name, '') : '')
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
      // No control links a profile any more, so a save by someone who sees the
      // whole pipeline always clears the link and the company falls back to the
      // shared pool.
      //
      // A rep is still pinned to their own id: companies_insert checks
      // `can_view_all_data() or owner_id = auth.uid()`, so a null from a rep is rejected
      // outright.
      const effectiveOwnerId = isOwner ? null : profile?.id ?? null
      const payload = {
        name: name.trim(),
        website: website.trim() || null,
        address: address.trim() || null,
        country: country.trim() || null,
        relationship: relationship || null,
        main_market: mainMarket || null,
        stage,
        owner_id: effectiveOwnerId,
        // Always kept, even when a link is pinned above: the field is a plain
        // input for everyone now, so a name someone typed should never be
        // thrown away on save. repLabel still prefers the link when both are
        // set, which is right — the link is what row-level security acts on.
        owner_name: ownerName.trim() || null,
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
            <input id="c_name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Serengeti Trails Safaris Ltd" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field">
              <label htmlFor="c_country">Country</label>
              <input id="c_country" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Tanzania" />
            </div>
            <div className="field">
              <label htmlFor="c_market">Main market</label>
              <select id="c_market" value={mainMarket} onChange={(e) => setMainMarket(e.target.value as MainMarket | '')}>
                <option value="">Not set</option>
                {MAIN_MARKET_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label htmlFor="c_relationship">Relationship</label>
            <select
              id="c_relationship"
              value={relationship}
              onChange={(e) => setRelationship(e.target.value as Relationship | '')}
            >
              <option value="">Not set</option>
              {RELATIONSHIP_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field">
              <label htmlFor="c_website">Website</label>
              <input id="c_website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
            </div>
            <div className="field">
              <label htmlFor="c_address">Address</label>
              <input id="c_address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, area" />
            </div>
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
              <input
                id="c_owner"
                value={ownerName}
                onChange={(e) => setOwnerNameDraft(e.target.value)}
                placeholder="Their name"
              />
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
