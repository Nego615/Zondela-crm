import type { AgreementStatus, StoAgreement, StoAgreementItem } from './database.types'

export const AGREEMENT_STATUS_META: Record<
  AgreementStatus,
  { label: string; color: string; bg: string }
> = {
  draft: { label: 'Draft', color: 'var(--stage-lead)', bg: 'var(--stage-lead-bg)' },
  sent: { label: 'Sent', color: 'var(--stage-proposal)', bg: 'var(--stage-proposal-bg)' },
  accepted: { label: 'Accepted', color: 'var(--stage-won)', bg: 'var(--stage-won-bg)' },
  declined: { label: 'Declined', color: 'var(--stage-lost)', bg: 'var(--stage-lost-bg)' },
}

export const AGREEMENT_STATUS_LIST: AgreementStatus[] = ['draft', 'sent', 'accepted', 'declined']

export function formatMoney(amount: number, currency: string) {
  return `${currency} ${Math.round(amount).toLocaleString()}`
}

/** Line total before the agreement-wide discount. */
export const lineTotal = (item: Pick<StoAgreementItem, 'quantity' | 'unit_price'>) =>
  item.quantity * item.unit_price

export function agreementTotals(
  items: Pick<StoAgreementItem, 'quantity' | 'unit_price'>[],
  discountPercent: number
) {
  const subtotal = items.reduce((sum, i) => sum + lineTotal(i), 0)
  const discount = subtotal * (discountPercent / 100)
  return { subtotal, discount, total: subtotal - discount }
}

/**
 * Past its validity date and still waiting on an answer.
 *
 * Derived rather than stored, the way an overdue follow-up is: a date that has
 * passed needs no write to become true, and an accepted agreement is settled
 * whatever its quote date said.
 */
export function isExpired(agreement: Pick<StoAgreement, 'status' | 'valid_until'>) {
  if (agreement.status !== 'sent' || !agreement.valid_until) return false
  // valid_until is a date, so it stays valid through the whole of that day.
  const end = new Date(`${agreement.valid_until}T23:59:59`)
  return end < new Date()
}

export const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—'

/** `<input type="date">` wants YYYY-MM-DD, and so does a Postgres date column. */
export const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '')
