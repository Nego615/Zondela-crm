import { useEffect } from 'react'
import { useOrgSettings } from '../hooks/useCrmData'
import { stoPdfUrl } from '../hooks/useStoVersions'
import RateSheetDocument from './RateSheetDocument'
import type { StoVersionWithRates } from '../lib/database.types'
import './ui.css'
import './agreement-preview.css'

interface Props {
  version: StoVersionWithRates
  /** Shown under the title, when previewing what one operator will see. */
  recipient?: { name?: string | null; company?: string | null }
  onClose: () => void
}

/**
 * The rate sheet as the operator will see it, with a print button.
 *
 * Print is the export: the browser's own dialogue offers "Save as PDF" on every
 * platform the team uses, which is a better PDF than anything this app could
 * assemble, and it needs no library. Reuses the preview chrome the old
 * agreement document had — same job, same toolbar.
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

  return (
    <div className="modal-backdrop agr-preview-backdrop" onClick={onClose}>
      <div className="agr-preview" onClick={(e) => e.stopPropagation()}>
        <div className="agr-preview-bar">
          <div>
            <strong>{version.name}</strong>
            <span> · {version.rates.length} rates</span>
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
    </div>
  )
}
