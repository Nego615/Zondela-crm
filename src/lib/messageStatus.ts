import type { MessageStatus, SentMessage } from './database.types'

/**
 * The delivery lifecycle of a message the team sent.
 *
 * Worth being precise about what is known and what is claimed. The app hands
 * off to a mail client or to WhatsApp; neither reports back. So `sent` is the
 * last state the app establishes by itself — everything after it is either the
 * sender recording what they saw (a bounce came back, the client replied) or,
 * once an email provider is connected, that provider's webhooks writing the
 * same columns.
 *
 * `approved` and `rejected` are not marked here at all: they follow the
 * agreement, and a database trigger keeps the two in step.
 */

export const MESSAGE_STATUS_LIST: MessageStatus[] = [
  'queued',
  'sent',
  'delivered',
  'viewed',
  'failed',
  'approved',
  'rejected',
]

interface StatusMeta {
  label: string
  /** Shown under the badge, and as the button's title in the picker. */
  hint: string
  color: string
  bg: string
}

export const MESSAGE_STATUS_META: Record<MessageStatus, StatusMeta> = {
  queued: {
    label: 'Queued',
    hint: 'Composed, not sent yet.',
    color: 'var(--stage-lead)',
    bg: 'var(--stage-lead-bg)',
  },
  sent: {
    label: 'Sent',
    hint: 'Handed to the mail client or WhatsApp.',
    color: 'var(--stage-contacted)',
    bg: 'var(--stage-contacted-bg)',
  },
  delivered: {
    label: 'Delivered',
    hint: 'It reached them.',
    color: 'var(--brand-teal-bright)',
    bg: 'var(--brand-teal-tint)',
  },
  viewed: {
    label: 'Viewed',
    hint: 'They opened it, or replied.',
    color: 'var(--stage-negotiation)',
    bg: 'var(--stage-negotiation-bg)',
  },
  failed: {
    label: 'Failed',
    hint: 'It bounced, or could not be sent.',
    color: 'var(--danger)',
    bg: 'var(--brand-brick-tint)',
  },
  approved: {
    label: 'Approved',
    hint: 'The client accepted the agreement.',
    color: 'var(--stage-won)',
    bg: 'var(--stage-won-bg)',
  },
  rejected: {
    label: 'Rejected',
    hint: 'The client declined the agreement.',
    color: 'var(--stage-lost)',
    bg: 'var(--stage-lost-bg)',
  },
}

/**
 * The states a person may set by hand.
 *
 * approved and rejected are absent deliberately — marking those here would let
 * the message disagree with the agreement it belongs to. They are set by
 * moving the agreement itself to accepted or declined, which the
 * sync_agreement_message_status trigger mirrors down onto the message.
 */
export const MANUAL_STATUSES: MessageStatus[] = [
  'sent',
  'delivered',
  'viewed',
  'failed',
]

export function isOutcome(status: MessageStatus): boolean {
  return status === 'approved' || status === 'rejected'
}

/** One step of the timeline: a state the message actually reached, and when. */
export interface StatusStep {
  status: MessageStatus
  at: string | null
  label: string
}

/**
 * Builds the timeline from the timestamps rather than from a log of events.
 *
 * Each stamp is only ever filled once (the database trigger uses coalesce), so
 * "delivered on the 3rd" stays true after the message is later marked viewed.
 * A step with no timestamp is one the message never reached.
 */
export function statusTimeline(message: SentMessage): StatusStep[] {
  const steps: StatusStep[] = [{ status: 'sent', at: message.sent_at, label: 'Sent' }]

  if (message.delivered_at) {
    steps.push({ status: 'delivered', at: message.delivered_at, label: 'Delivered' })
  }
  if (message.viewed_at) {
    steps.push({ status: 'viewed', at: message.viewed_at, label: 'Viewed' })
  }
  if (message.failed_at) {
    steps.push({
      status: 'failed',
      at: message.failed_at,
      label: message.failure_reason ? `Failed — ${message.failure_reason}` : 'Failed',
    })
  }
  if (message.responded_at) {
    steps.push({
      status: message.status === 'rejected' ? 'rejected' : 'approved',
      at: message.responded_at,
      label: message.status === 'rejected' ? 'Rejected by client' : 'Approved by client',
    })
  }

  return steps
}

/** A one-line summary for a table cell: "Delivered · 3 Sep". */
export function statusSummary(message: SentMessage): string {
  const meta = MESSAGE_STATUS_META[message.status]
  const at =
    message.responded_at ??
    message.failed_at ??
    message.viewed_at ??
    message.delivered_at ??
    message.sent_at
  if (!at) return meta.label
  return `${meta.label} · ${new Date(at).toLocaleDateString()}`
}

/**
 * The single status for an agreement, across however many times it was sent.
 *
 * The furthest-along message wins: resending after a bounce should show the
 * resend's progress, not leave the agreement reading as failed for good.
 * Returns null when nothing has been sent.
 */
const PROGRESS_ORDER: MessageStatus[] = [
  'failed',
  'queued',
  'sent',
  'delivered',
  'viewed',
  'rejected',
  'approved',
]

export function bestStatus(messages: SentMessage[]): MessageStatus | null {
  if (messages.length === 0) return null
  return messages.reduce<MessageStatus>((best, m) => {
    return PROGRESS_ORDER.indexOf(m.status) > PROGRESS_ORDER.indexOf(best) ? m.status : best
  }, messages[0].status)
}
