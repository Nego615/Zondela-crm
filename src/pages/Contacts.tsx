import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAllContacts, useCompanies } from '../hooks/useCrmData'
import { STAGE_META } from '../lib/stage'
import '../components/ui.css'
import './contacts.css'

export default function Contacts() {
  const { contacts, loading: contactsLoading } = useAllContacts()
  const { companies, loading: companiesLoading } = useCompanies()

  // Both, not just the contacts: the two queries resolve independently, and
  // rendering rows against a company list that has not arrived would show
  // every contact as having no company for a frame.
  const loading = contactsLoading || companiesLoading
  const navigate = useNavigate()

  const [search, setSearch] = useState('')
  const [primaryOnly, setPrimaryOnly] = useState(false)

  const companyById = useMemo(
    () => new Map(companies.map((c) => [c.id, c])),
    [companies]
  )

  const companyCount = useMemo(
    () => new Set(contacts.map((c) => c.company_id)).size,
    [contacts]
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return contacts.filter((c) => {
      if (primaryOnly && !c.is_primary) return false
      if (!q) return true
      const company = companyById.get(c.company_id)
      return [c.full_name, c.job_title, c.email, c.phone, c.whatsapp, company?.name]
        .some((field) => (field ?? '').toLowerCase().includes(q))
    })
  }, [contacts, companyById, search, primaryOnly])

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Contacts</h1>
          <p>
            {contacts.length} {contacts.length === 1 ? 'person' : 'people'} across{' '}
            {companyCount} {companyCount === 1 ? 'company' : 'companies'}. Contacts are added and
            edited on a company's page.
          </p>
        </div>
      </div>

      <div className="contacts-controls">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, job title, company, email, or phone"
          aria-label="Search contacts"
        />
        <label className="contacts-toggle">
          <input
            type="checkbox"
            checked={primaryOnly}
            onChange={(e) => setPrimaryOnly(e.target.checked)}
          />
          Primary contacts only
        </label>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-soft)' }}>Loading contacts…</p>
      ) : filtered.length === 0 ? (
        <div className="empty-state card">
          <h3>{contacts.length === 0 ? 'No contacts yet' : 'No contacts match'}</h3>
          <p>
            {contacts.length === 0
              ? "Open a company and add the people you deal with there. They will all appear here."
              : 'Try a different search, or clear the primary-only filter.'}
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Job title</th>
                <th>Company</th>
                <th>Email</th>
                <th>Phone</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((contact) => {
                const company = companyById.get(contact.company_id)
                const meta = company ? STAGE_META[company.stage] : null
                return (
                  <tr key={contact.id}>
                    <td>
                      <button
                        className="contacts-link"
                        onClick={() => navigate(`/companies/${contact.company_id}`)}
                      >
                        {contact.full_name}
                      </button>
                      {contact.is_primary && (
                        <span
                          className="badge contacts-primary"
                          style={{ background: 'var(--brand-teal-tint)', color: 'var(--brand-teal)' }}
                        >
                          Primary
                        </span>
                      )}
                    </td>
                    <td style={{ color: 'var(--text-soft)' }}>{contact.job_title || '—'}</td>
                    <td>
                      {company ? (
                        <span className="contacts-company">
                          <button
                            className="contacts-link"
                            onClick={() => navigate(`/companies/${company.id}`)}
                          >
                            {company.name}
                          </button>
                          {meta && (
                            <span className="badge" style={{ background: meta.bg, color: meta.color }}>
                              {meta.label}
                            </span>
                          )}
                        </span>
                      ) : (
                        // Defensive only. contacts_access matches purely on
                        // can_access_company, so a visible contact always has a
                        // visible company — but a stale list beats a crash.
                        <span className="contacts-unknown">Unknown company</span>
                      )}
                    </td>
                    <td>
                      {contact.email ? (
                        <a href={`mailto:${contact.email}`}>{contact.email}</a>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                    <td className="contacts-phone">
                      {contact.phone || contact.whatsapp ? (
                        <>
                          {contact.phone && <a href={`tel:${contact.phone}`}>{contact.phone}</a>}
                          {contact.whatsapp && (
                            <a
                              href={`https://wa.me/${contact.whatsapp.replace(/[^\d]/g, '')}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="contacts-wa"
                            >
                              WhatsApp
                            </a>
                          )}
                        </>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
