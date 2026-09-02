import { useEffect } from 'react'
import { useCompanies, useContacts, useOrgSettings } from '../hooks/useCrmData'
import AgreementDocument from './AgreementDocument'
import type { StoAgreementWithItems } from '../lib/database.types'
import './ui.css'
import './agreement-preview.css'

interface Props {
  agreement: StoAgreementWithItems
  onClose: () => void
}

/**
 * The agreement as the client will see it, with a print button.
 *
 * Print is the export: the browser's own dialogue offers "Save as PDF" on
 * every platform the team uses, which is a better PDF than anything this app
 * could assemble, and it needs no library. The @media print rules in
 * agreement-preview.css collapse the modal chrome so only the document is on
 * the page.
 */
export default function AgreementPreviewModal({ agreement, onClose }: Props) {
  const { companies } = useCompanies()
  const { contacts } = useContacts(agreement.company_id)
  const { settings } = useOrgSettings()

  const company = companies.find((c) => c.id === agreement.company_id)
  const contact = contacts.find((c) => c.id === agreement.contact_id)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="modal-backdrop agr-preview-backdrop" onClick={onClose}>
      <div className="agr-preview" onClick={(e) => e.stopPropagation()}>
        <div className="agr-preview-bar">
          <div>
            <strong>{agreement.reference}</strong>
            <span> · {agreement.title}</span>
          </div>
          <div className="agr-preview-actions">
            <button className="btn btn-primary btn-sm" onClick={() => window.print()}>
              Print / Save as PDF
            </button>
            <button className="btn btn-ghost btn-sm" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="agr-preview-page">
          <AgreementDocument
            agreement={agreement}
            company={company}
            contact={contact}
            settings={settings}
          />
        </div>
      </div>
    </div>
  )
}
