import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import {
  MANUAL_STATUSES,
  MESSAGE_STATUS_META,
  isOutcome,
  statusTimeline,
} from '../lib/messageStatus'
import type { MessageStatus, SentMessage } from '../lib/database.types'
import './ui.css'
import './message-status.css'

interface Props {
  messages: SentMessage[]
  onSetStatus: (id: string, status: MessageStatus, note?: string) => Promise<void>
}

function when(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Delivery history for one agreement: every time it went out, where each one
 * got to, and the buttons to record what happened next.
 *
 * The buttons cover sent → delivered → viewed → failed only. Approved and
 * rejected are missing on purpose: they belong to the agreement, and marking
 * them here would let a message contradict the agreement it carried. Moving
 * the agreement to Accepted or Declined is what sets them, and a database
 * trigger mirrors it down onto every message the agreement went out on.
 */
export default function MessageStatusPanel({ messages, onSetStatus }: Props) {
  const { can } = useAuth()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [failingId, setFailingId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const editable = can('data.write')

  async function apply(id: string, status: MessageStatus, note?: string) {
    setBusyId(id)
    setError(null)
    try {
      await onSetStatus(id, status, note)
      setFailingId(null)
      setReason('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update that message.')
    } finally {
      setBusyId(null)
    }
  }

  if (messages.length === 0) {
    return <p className="msg-empty">Not sent yet — no delivery history.</p>
  }

  return (
    <div className="msg-panel">
      {error && <p className="msg-error">{error}</p>}

      {messages.map((message) => {
        const meta = MESSAGE_STATUS_META[message.status]
        const steps = statusTimeline(message)
        const busy = busyId === message.id

        return (
          <div key={message.id} className="msg-item">
            <div className="msg-item-head">
              <span className="badge" style={{ background: meta.bg, color: meta.color }}>
                {meta.label}
              </span>
              <span className="msg-channel">
                {message.channel === 'email' ? 'Email' : 'WhatsApp'}
                {message.to_email ? ` · ${message.to_email}` : message.to_name ? ` · ${message.to_name}` : ''}
              </span>
              <span className="msg-when">{when(message.sent_at)}</span>
            </div>

            <ol className="msg-timeline">
              {steps.map((step) => (
                <li key={`${step.status}-${step.at}`} className={`msg-step msg-step-${step.status}`}>
                  <span className="msg-dot" style={{ background: MESSAGE_STATUS_META[step.status].color }} />
                  <span className="msg-step-label">{step.label}</span>
                  <span className="msg-step-when">{when(step.at)}</span>
                </li>
              ))}
            </ol>

            {isOutcome(message.status) ? (
              <p className="msg-locked">{meta.hint} Change it on the agreement itself.</p>
            ) : editable ? (
              failingId === message.id ? (
                <div className="msg-fail-form">
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="What went wrong? (bounced, wrong address…)"
                    aria-label="Failure reason"
                  />
                  <button
                    className="btn btn-sm btn-danger"
                    disabled={busy}
                    onClick={() => apply(message.id, 'failed', reason)}
                  >
                    Mark failed
                  </button>
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => {
                      setFailingId(null)
                      setReason('')
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="msg-actions">
                  <span className="msg-actions-label">Mark as</span>
                  {MANUAL_STATUSES.map((status) => {
                    const active = message.status === status
                    if (status === 'failed') {
                      return (
                        <button
                          key={status}
                          className={`btn btn-sm${active ? ' btn-primary' : ''}`}
                          title={MESSAGE_STATUS_META[status].hint}
                          disabled={busy}
                          onClick={() => setFailingId(message.id)}
                        >
                          Failed
                        </button>
                      )
                    }
                    return (
                      <button
                        key={status}
                        className={`btn btn-sm${active ? ' btn-primary' : ''}`}
                        title={MESSAGE_STATUS_META[status].hint}
                        disabled={busy || active}
                        onClick={() => apply(message.id, status)}
                      >
                        {MESSAGE_STATUS_META[status].label}
                      </button>
                    )
                  })}
                </div>
              )
            ) : null}

            {message.failure_reason && (
              <p className="msg-reason">Reason: {message.failure_reason}</p>
            )}
          </div>
        )
      })}

      <p className="msg-note">
        Delivery and open tracking is recorded by hand: the app opens your mail client or WhatsApp
        to send, and neither reports back. Connect an email provider to have these set
        automatically.
      </p>
    </div>
  )
}
