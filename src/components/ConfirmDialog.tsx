import { useEffect } from 'react'
import './ui.css'

interface Props {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Asks before something that cannot be undone.
 *
 * Drawn in the page rather than left to window.confirm(). A browser that has
 * been told to stop this site's dialogs, or an embedded preview that sandboxes
 * them, answers confirm() with an instant, invisible "Cancel" — so the button
 * does nothing, says nothing, and looks broken.
 */
export default function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="confirm-title">{title}</h2>
        </div>
        <p id="confirm-message" style={{ margin: '0 0 20px', color: 'var(--text-soft)' }}>
          {message}
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {/* Cancel takes the focus, so a stray Enter backs out rather than deletes. */}
          <button type="button" className="btn" onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
