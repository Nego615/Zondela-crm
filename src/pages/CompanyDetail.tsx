import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useCompanies, useContacts, useSiteVisits, useFollowUps, useProfiles } from '../hooks/useCrmData'
import { STAGE_LIST, STAGE_META } from '../lib/stage'
import type { Stage } from '../lib/database.types'
import CompanyFormModal from '../components/CompanyFormModal'
import ContactFormModal from '../components/ContactFormModal'
import SiteVisitFormModal from '../components/SiteVisitFormModal'
import FollowUpFormModal from '../components/FollowUpFormModal'
import SharePricingModal from '../components/SharePricingModal'
import '../components/ui.css'
import './company-detail.css'

export default function CompanyDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { companies, setStage, deleteCompany } = useCompanies()
  const { contacts, deleteContact } = useContacts(id)
  const { visits, updateVisit, deleteVisit } = useSiteVisits(id)
  const { followUps, updateFollowUp, deleteFollowUp } = useFollowUps(id)
  const { profiles } = useProfiles()

  const company = companies.find((c) => c.id === id)

  const [editCompany, setEditCompany] = useState(false)
  const [contactModal, setContactModal] = useState<'new' | string | null>(null)
  const [visitModal, setVisitModal] = useState<'new' | string | null>(null)
  const [followUpModal, setFollowUpModal] = useState<'new' | string | null>(null)
  const [shareModal, setShareModal] = useState(false)

  if (!company) {
    return (
      <div className="empty-state card">
        <h3>Company not found</h3>
        <p>It may have been removed.</p>
        <button className="btn" style={{ marginTop: 12 }} onClick={() => navigate('/companies')}>
          Back to companies
        </button>
      </div>
    )
  }

  const meta = STAGE_META[company.stage]
  const repName = (id: string | null) => profiles.find((p) => p.id === id)?.full_name || 'Unassigned'

  async function handleDeleteCompany() {
    if (!confirm(`Delete ${company!.name}? This removes all contacts, visits, and follow-ups too.`)) return
    await deleteCompany(company!.id)
    navigate('/companies')
  }

  const editingContact = contactModal && contactModal !== 'new' ? contacts.find((c) => c.id === contactModal) : undefined
  const editingVisit = visitModal && visitModal !== 'new' ? visits.find((v) => v.id === visitModal) : undefined
  const editingFollowUp = followUpModal && followUpModal !== 'new' ? followUps.find((f) => f.id === followUpModal) : undefined

  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={() => navigate('/companies')} style={{ marginBottom: 12 }}>
        ← All companies
      </button>

      <div className="page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1>{company.name}</h1>
            <select
              value={company.stage}
              onChange={(e) => setStage(company.id, e.target.value as Stage)}
              className="badge"
              style={{ background: meta.bg, color: meta.color, border: 'none', fontWeight: 600 }}
            >
              {STAGE_LIST.map((s) => (
                <option key={s} value={s}>
                  {STAGE_META[s].label}
                </option>
              ))}
            </select>
          </div>
          <p>
            {[company.industry, company.city].filter(Boolean).join(' · ') || 'No industry or city on file'} · Rep: {repName(company.owner_id)}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => setShareModal(true)}>
            Share STO pricing
          </button>
          <button className="btn" onClick={() => setEditCompany(true)}>
            Edit
          </button>
          <button className="btn btn-danger" onClick={handleDeleteCompany}>
            Delete
          </button>
        </div>
      </div>

      {company.notes && (
        <div className="card" style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 13, color: 'var(--text-soft)', whiteSpace: 'pre-wrap' }}>{company.notes}</p>
        </div>
      )}

      <div className="detail-grid">
        {/* Contacts */}
        <section className="card">
          <div className="section-header">
            <h3>Contacts</h3>
            <button className="btn btn-sm" onClick={() => setContactModal('new')}>
              + Add
            </button>
          </div>
          {contacts.length === 0 ? (
            <p className="section-empty">No contacts yet.</p>
          ) : (
            <ul className="list">
              {contacts.map((c) => (
                <li key={c.id} className="list-item">
                  <div>
                    <p className="list-item-title">
                      {c.full_name} {c.is_primary && <span className="badge" style={{ background: 'var(--stage-won-bg)', color: 'var(--stage-won)', marginLeft: 6 }}>Primary</span>}
                    </p>
                    <p className="list-item-sub">
                      {[c.job_title, c.email, c.phone].filter(Boolean).join(' · ') || 'No details on file'}
                    </p>
                  </div>
                  <div className="list-item-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => setContactModal(c.id)}>
                      Edit
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={async () => {
                        if (confirm(`Remove contact ${c.full_name}?`)) await deleteContact(c.id)
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Site visits */}
        <section className="card">
          <div className="section-header">
            <h3>Site visits</h3>
            <button className="btn btn-sm" onClick={() => setVisitModal('new')}>
              + Schedule
            </button>
          </div>
          {visits.length === 0 ? (
            <p className="section-empty">No site visits logged.</p>
          ) : (
            <ul className="list">
              {visits.map((v) => {
                const contact = contacts.find((c) => c.id === v.contact_id)
                return (
                  <li key={v.id} className="list-item">
                    <div>
                      <p className="list-item-title">
                        {new Date(v.scheduled_for).toLocaleString(undefined, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                        <span
                          className="badge"
                          style={{
                            marginLeft: 8,
                            background: v.status === 'completed' ? 'var(--stage-won-bg)' : v.status === 'cancelled' ? 'var(--stage-lost-bg)' : 'var(--stage-visit-bg)',
                            color: v.status === 'completed' ? 'var(--stage-won)' : v.status === 'cancelled' ? 'var(--stage-lost)' : 'var(--stage-visit)',
                          }}
                        >
                          {v.status}
                        </span>
                      </p>
                      <p className="list-item-sub">
                        {contact ? contact.full_name : 'No contact'} · {repName(v.rep_id)}
                        {v.summary ? ` · ${v.summary}` : ''}
                      </p>
                    </div>
                    <div className="list-item-actions">
                      {v.status === 'scheduled' && (
                        <button className="btn btn-ghost btn-sm" onClick={() => updateVisit(v.id, { status: 'completed' })}>
                          Mark done
                        </button>
                      )}
                      <button className="btn btn-ghost btn-sm" onClick={() => setVisitModal(v.id)}>
                        Edit
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={async () => {
                          if (confirm('Delete this site visit?')) await deleteVisit(v.id)
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* Follow-ups */}
        <section className="card">
          <div className="section-header">
            <h3>Follow-ups</h3>
            <button className="btn btn-sm" onClick={() => setFollowUpModal('new')}>
              + Schedule
            </button>
          </div>
          {followUps.length === 0 ? (
            <p className="section-empty">No follow-ups scheduled.</p>
          ) : (
            <ul className="list">
              {followUps.map((f) => {
                const overdue = f.status === 'pending' && new Date(f.due_at) < new Date()
                return (
                  <li key={f.id} className="list-item">
                    <div>
                      <p className="list-item-title">
                        {f.note}
                        {f.status === 'pending' && overdue && (
                          <span className="badge" style={{ marginLeft: 8, background: '#fbeaea', color: 'var(--danger)' }}>
                            Overdue
                          </span>
                        )}
                        {f.status !== 'pending' && (
                          <span className="badge" style={{ marginLeft: 8, background: 'var(--paper-dim)', color: 'var(--text-soft)' }}>
                            {f.status}
                          </span>
                        )}
                      </p>
                      <p className="list-item-sub">
                        Due {new Date(f.due_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · {repName(f.assigned_to)}
                      </p>
                    </div>
                    <div className="list-item-actions">
                      {f.status === 'pending' && (
                        <button className="btn btn-ghost btn-sm" onClick={() => updateFollowUp(f.id, { status: 'done' })}>
                          Mark done
                        </button>
                      )}
                      <button className="btn btn-ghost btn-sm" onClick={() => setFollowUpModal(f.id)}>
                        Edit
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={async () => {
                          if (confirm('Delete this follow-up?')) await deleteFollowUp(f.id)
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      {editCompany && <CompanyFormModal company={company} onClose={() => setEditCompany(false)} onSaved={() => setEditCompany(false)} />}
      {contactModal && (
        <ContactFormModal
          companyId={company.id}
          contact={editingContact}
          onClose={() => setContactModal(null)}
          onSaved={() => setContactModal(null)}
        />
      )}
      {visitModal && (
        <SiteVisitFormModal
          companyId={company.id}
          contacts={contacts}
          visit={editingVisit}
          onClose={() => setVisitModal(null)}
          onSaved={() => setVisitModal(null)}
        />
      )}
      {followUpModal && (
        <FollowUpFormModal
          companyId={company.id}
          contacts={contacts}
          followUp={editingFollowUp}
          onClose={() => setFollowUpModal(null)}
          onSaved={() => setFollowUpModal(null)}
        />
      )}
      {shareModal && <SharePricingModal company={company} contacts={contacts} onClose={() => setShareModal(false)} />}
    </div>
  )
}
