import { useRef, useState } from 'react'
import { usePricingDocuments } from '../hooks/useCrmData'
import { useAuth } from '../hooks/useAuth'
import type { PricingDocument } from '../lib/database.types'
import './ui.css'
import './pricing-documents.css'

// Supabase's default object size limit is 50 MB; a price list has no business
// being anywhere near that, and rejecting early beats a slow failed upload.
const MAX_BYTES = 10 * 1024 * 1024

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function PricingDocuments() {
  const { documents, loading, uploadDocument, setDefaultDocument, deleteDocument, documentUrl } =
    usePricingDocuments()
  const { profile } = useAuth()
  const fileInput = useRef<HTMLInputElement>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)

  async function handleFile(file: File | undefined) {
    if (!file) return
    setError(null)

    if (file.type !== 'application/pdf') {
      setError('That is not a PDF. Only PDF price lists can be uploaded.')
      return
    }
    if (file.size > MAX_BYTES) {
      setError(`That file is ${formatSize(file.size)}. The limit is ${formatSize(MAX_BYTES)}.`)
      return
    }

    setBusy(true)
    try {
      await uploadDocument(file, profile?.id ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setBusy(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  async function handleDelete(doc: PricingDocument) {
    setError(null)
    setBusy(true)
    try {
      await deleteDocument(doc)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete that file.')
    } finally {
      setBusy(false)
      setConfirmingDelete(null)
    }
  }

  return (
    <section className="card pricing-docs">
      <div className="pricing-docs-head">
        <div>
          <h3>Price list PDF</h3>
          <p>
            Upload the PDF you already send clients. Sharing pricing puts a link to it in the
            message, and the client opens the file exactly as you uploaded it.
          </p>
        </div>
        <div>
          <input
            ref={fileInput}
            id="pricing_pdf"
            type="file"
            accept="application/pdf,.pdf"
            className="visually-hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
            disabled={busy}
          />
          <label htmlFor="pricing_pdf" className={`btn btn-primary${busy ? ' btn-disabled' : ''}`}>
            {busy ? 'Working…' : 'Upload PDF'}
          </label>
        </div>
      </div>

      {error && <p className="pricing-docs-error">{error}</p>}

      {loading ? (
        <p className="pricing-docs-quiet">Loading…</p>
      ) : documents.length === 0 ? (
        <p className="pricing-docs-quiet">
          No PDF uploaded yet. Without one, sharing pricing sends the rate card as text in the
          message body.
        </p>
      ) : (
        <ul className="pricing-docs-list">
          {documents.map((doc) => (
            <li key={doc.id}>
              <div className="pricing-docs-name">
                <a href={documentUrl(doc)} target="_blank" rel="noopener noreferrer">
                  {doc.name}.pdf
                </a>
                {doc.is_default && (
                  <span
                    className="badge"
                    style={{ background: 'var(--stage-won-bg)', color: 'var(--stage-won)' }}
                  >
                    Default
                  </span>
                )}
                <span className="pricing-docs-meta">
                  {formatSize(doc.size_bytes)} · {new Date(doc.created_at).toLocaleDateString()}
                </span>
              </div>

              <div className="pricing-docs-actions">
                {!doc.is_default && (
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={busy}
                    onClick={() => setDefaultDocument(doc.id)}
                  >
                    Make default
                  </button>
                )}
                {confirmingDelete === doc.id ? (
                  <>
                    <button
                      className="btn btn-danger btn-sm"
                      disabled={busy}
                      onClick={() => handleDelete(doc)}
                    >
                      Delete for good
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setConfirmingDelete(null)}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={busy}
                    onClick={() => setConfirmingDelete(doc.id)}
                  >
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {documents.length > 0 && (
        <p className="pricing-docs-note">
          Anyone with the link can open these files — they are unlisted, not private. Deleting one
          breaks the link in quotes already sent.
        </p>
      )}
    </section>
  )
}
