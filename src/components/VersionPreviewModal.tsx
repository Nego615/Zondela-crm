import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useOrgSettings } from '../hooks/useCrmData'
import { stoPdfUrl } from '../hooks/useStoVersions'
import { printPage } from '../lib/print'
import RateSheetDocument from './RateSheetDocument'
import type { StoVersionWithRates } from '../lib/database.types'
import './ui.css'
import './agreement-preview.css'

interface Props {
  version: StoVersionWithRates
  /** Shown under the title, when previewing what one operator will see. */
  recipient?: { name?: string | null; company?: string | null; website?: string | null }
  onClose: () => void
}

/**
 * The rate sheet as the operator will see it, with a print button.
 *
 * Print is the export: the browser's own dialogue offers "Save as PDF" on every
 * platform the team uses, which is a better PDF than anything this app could
 * assemble, and it needs no library. Reuses the preview chrome the old
 * agreement document had — same job, same toolbar.
 *
 * Portalled to <body>, and marks <body> while open: the print styles hide
 * every other child of body, which only works if this is one of them and only
 * should while it is on screen.
 */
export default function VersionPreviewModal({ version, recipient, onClose }: Props) {
  const { settings } = useOrgSettings()

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useEffect(() => {
    document.body.classList.add('agr-previewing')
    return () => document.body.classList.remove('agr-previewing')
  }, [])

  return createPortal(
    <div className="modal-backdrop agr-preview-backdrop" onClick={onClose}>
      <div className="agr-preview" onClick={(e) => e.stopPropagation()}>
        <div className="agr-preview-bar">
          <div>
            <strong>{version.name}</strong>
            <span> · {version.rates.length} rates</span>
          </div>
          <div className="agr-preview-actions">
            <button className="btn btn-primary btn-sm" onClick={() => printPage()}>
              Print / Save as PDF
            </button>
            <button className="btn btn-ghost btn-sm" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="agr-preview-page">
          <RateSheetDocument
            version={version}
            rates={version.rates}
            supplements={version.supplements}
            sections={version.terms_list}
            propertySections={version.sections}
            imageUrl={stoPdfUrl}
            org={settings}
            recipient={recipient}
            pdfUrl={version.pdf_path ? stoPdfUrl(version.pdf_path) : null}
            pdfName={version.pdf_name}
            draft={version.status === 'draft'}
          />
        </div>
      </div>
    </div>,
    document.body
  )
}
