import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useCompanies, useContacts, useProfiles } from '../hooks/useCrmData'
import { useAuth } from '../hooks/useAuth'
import { STAGE_LIST, STAGE_META } from '../lib/stage'
import { MAIN_MARKET_OPTIONS, RELATIONSHIP_OPTIONS } from '../lib/company'
import { repLabel } from '../lib/rep'
import { errorMessage } from '../lib/errorMessage'
import { cardExtras, hasPerson, primaryPhone, type ScanSource, type ScannedCard } from '../lib/businessCard'
import type { Company, MainMarket, Relationship, Stage } from '../lib/database.types'
import CardScanModal, { CameraIcon } from './CardScanModal'
import './ui.css'
import './card-scan.css'

interface Props {
  company?: Company
  /** Open straight onto the card scanner — the Companies page's "Scan card". */
  startWithScan?: boolean
  onClose: () => void
  onSaved: () => void
}

export default function CompanyFormModal({ company, startWithScan, onClose, onSaved }: Props) {
  const { companies, createCompany, updateCompany } = useCompanies()
  const { createContact } = useContacts(undefined)
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

  // A scanned card. The person on it becomes the company's primary contact,
  // saved in the same step, so a card is one form rather than two.
  const [scanning, setScanning] = useState(Boolean(startWithScan && !company))
  const [scannedFrom, setScannedFrom] = useState<ScanSource | null>(null)
  const [addContact, setAddContact] = useState(false)
  const [contactName, setContactName] = useState('')
  const [contactTitle, setContactTitle] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [contactWhatsapp, setContactWhatsapp] = useState('')
  // Set once the company row exists. If the contact then fails, a second
  // press of Add retries the contact alone instead of a duplicate company.
  const [createdCompanyId, setCreatedCompanyId] = useState<string | null>(null)

  // Cards get handed out twice. Catching the second one here is cheaper than
  // merging two companies later.
  const duplicate = company
    ? null
    : companies.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase() && name.trim())

  function applyCard(card: ScannedCard, source: ScanSource) {
    // Only what the card says replaces what is in the form: a field the card
    // leaves empty keeps anything already typed.
    if (card.company) setName(card.company)
    if (card.website) setWebsite(card.website)
    if (card.address) setAddress(card.address)
    if (card.country) setCountry(card.country)
    const extras = cardExtras(card)
    if (extras) setNotes((current) => (current.trim() ? current : `From business card: ${extras}`))

    if (hasPerson(card)) {
      setContactName(card.full_name)
      setContactTitle(card.job_title)
      setContactEmail(card.email)
      setContactPhone(primaryPhone(card))
      setContactWhatsapp(card.whatsapp)
      setAddContact(true)
    }
    setScannedFrom(source)
    setScanning(false)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setError('Company name is required.')
      return
    }
    if (addContact && !contactName.trim()) {
      setError('Give the contact a name, or untick "Add as primary contact".')
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
        let companyId = createdCompanyId
        if (!companyId) {
          companyId = (await createCompany(payload)).id
          setCreatedCompanyId(companyId)
        }
        if (addContact) {
          try {
            await createContact({
              company_id: companyId,
              full_name: contactName.trim(),
              job_title: contactTitle.trim() || null,
              email: contactEmail.trim() || null,
              phone: contactPhone.trim() || null,
              whatsapp: contactWhatsapp.trim() || null,
              is_primary: true,
            })
          } catch (err) {
            setError(
              `The company was saved, but the contact was not: ${errorMessage(err, 'unknown error')}. ` +
                'Press Add again to retry the contact, or Cancel and add them from the company page.'
            )
            return
          }
        }
      }
      onSaved()
    } catch (err) {
      setError(errorMessage(err, 'Could not save company.'))
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
          {!company &&
            (scannedFrom ? (
              <p className="scan-card-notice">
                Filled from the card's {scannedFrom === 'qr' ? 'QR code' : 'photo'}. Check each field before saving.
                <button type="button" onClick={() => setScanning(true)}>
                  Scan again
                </button>
              </p>
            ) : (
              <button type="button" className="btn scan-card-trigger" onClick={() => setScanning(true)}>
                <CameraIcon />
                Scan business card
              </button>
            ))}

          <div className="field">
            <label htmlFor="c_name">Company name</label>
            <input id="c_name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Serengeti Trails Safaris Ltd" />
            {duplicate && !createdCompanyId && (
              <span className="field-warning">
                {duplicate.name} is already in the system.{' '}
                <Link to={`/companies/${duplicate.id}`} onClick={onClose}>
                  Open it
                </Link>{' '}
                to add this person as a contact there instead.
              </span>
            )}
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

          {!company && scannedFrom && (contactName || addContact) && (
            <div className="scan-card-contact">
              <label>
                <input type="checkbox" checked={addContact} onChange={(e) => setAddContact(e.target.checked)} />
                Add as primary contact
              </label>
              {addContact && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div className="field">
                      <label htmlFor="c_ct_name">Full name</label>
                      <input id="c_ct_name" value={contactName} onChange={(e) => setContactName(e.target.value)} />
                    </div>
                    <div className="field">
                      <label htmlFor="c_ct_title">Job title</label>
                      <input id="c_ct_title" value={contactTitle} onChange={(e) => setContactTitle(e.target.value)} />
                    </div>
                  </div>
                  <div className="field">
                    <label htmlFor="c_ct_email">Email</label>
                    <input
                      id="c_ct_email"
                      type="email"
                      value={contactEmail}
                      onChange={(e) => setContactEmail(e.target.value)}
                    />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div className="field">
                      <label htmlFor="c_ct_phone">Phone</label>
                      <input id="c_ct_phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
                    </div>
                    <div className="field">
                      <label htmlFor="c_ct_whatsapp">WhatsApp</label>
                      <input
                        id="c_ct_whatsapp"
                        value={contactWhatsapp}
                        onChange={(e) => setContactWhatsapp(e.target.value)}
                        placeholder="If different"
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

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
              {saving ? 'Saving…' : company ? 'Save changes' : addContact ? 'Add company and contact' : 'Add company'}
            </button>
          </div>
        </form>
        {/* Inside .modal, whose stopPropagation keeps a click on the
            scanner's backdrop (portalled, but bubbling through React) from
            reaching this form's backdrop and closing it too. */}
        {scanning && <CardScanModal onClose={() => setScanning(false)} onResult={applyCard} />}
      </div>
    </div>
  )
}
