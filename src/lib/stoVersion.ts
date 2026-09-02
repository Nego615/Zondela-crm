import type { SendStatus, StoVersionRate, VersionStatus } from './database.types'

/**
 * Reading an STO rate agreement.
 *
 * The version is the season's rate sheet for Zondela House; a send is one
 * operator's copy of it. Everything here is about describing those two in
 * words — the labels, the scope, the placeholders an email is written with —
 * because what the team needs from this section is a sentence, not a subtotal.
 */

export const VERSION_STATUS_META: Record<
  VersionStatus,
  { label: string; color: string; bg: string; hint: string }
> = {
  draft: {
    label: 'Draft',
    color: 'var(--stage-lead)',
    bg: 'var(--stage-lead-bg)',
    hint: 'Being prepared. Cannot be sent yet.',
  },
  active: {
    label: 'Active',
    color: 'var(--stage-won)',
    bg: 'var(--stage-won-bg)',
    hint: 'Published. This is what operators are sent.',
  },
  archived: {
    label: 'Archived',
    color: 'var(--text-soft)',
    bg: 'var(--paper-dim)',
    hint: 'A past season, kept for the record.',
  },
}

export const SEND_STATUS_META: Record<
  SendStatus,
  { label: string; color: string; bg: string; hint: string }
> = {
  sent: {
    label: 'Sent',
    color: 'var(--stage-contacted)',
    bg: 'var(--stage-contacted-bg)',
    hint: 'Gone out. Not opened yet.',
  },
  viewed: {
    label: 'Viewed',
    color: 'var(--stage-proposal)',
    bg: 'var(--stage-proposal-bg)',
    hint: 'The operator opened the link.',
  },
  accepted: {
    label: 'Accepted',
    color: 'var(--stage-won)',
    bg: 'var(--stage-won-bg)',
    hint: 'They accepted the season’s rates.',
  },
  declined: {
    label: 'Declined',
    color: 'var(--stage-lost)',
    bg: 'var(--stage-lost-bg)',
    hint: 'They answered no.',
  },
}

export const VERSION_STATUS_LIST: VersionStatus[] = ['draft', 'active', 'archived']
export const SEND_STATUS_LIST: SendStatus[] = ['sent', 'viewed', 'accepted', 'declined']

/** A price as it is quoted: "USD 180". Whole numbers — rate sheets have no cents. */
export const formatRate = (price: number, currency: string) =>
  `${currency} ${Math.round(price).toLocaleString()}`

export const formatDay = (iso: string | null | undefined) =>
  iso
    ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString(undefined, {
        dateStyle: 'medium',
      })
    : '—'

export const formatDayTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—'

/** The seasons a version prices, in the order its rates were entered. */
export function seasonsOf(rates: Pick<StoVersionRate, 'season'>[]) {
  const seen: string[] = []
  for (const rate of rates) {
    const season = rate.season.trim() || 'All year'
    if (!seen.includes(season)) seen.push(season)
  }
  return seen
}

/** The room types a version prices, in the order its rates were entered. */
export function roomTypesOf(rates: Pick<StoVersionRate, 'room_type'>[]) {
  const seen: string[] = []
  for (const rate of rates) {
    const room = rate.room_type.trim()
    if (room && !seen.includes(room)) seen.push(room)
  }
  return seen
}

/**
 * What the version covers, as a tag: "6 room types · sleeps up to 4".
 *
 * Derived rather than typed, so it cannot drift from the rates underneath it.
 * Zondela House is one property, so the scope of a version is the rooms it
 * prices, the seasons it prices them for, and how many people they take.
 */
export function scopeLabel(
  rates: Pick<StoVersionRate, 'season' | 'room_type' | 'max_occupancy'>[]
) {
  if (rates.length === 0) return 'No rates yet'
  const rooms = roomTypesOf(rates)
  const seasons = seasonsOf(rates)
  const sleeps = Math.max(0, ...rates.map((r) => r.max_occupancy ?? 0))
  const parts = [rooms.length === 1 ? rooms[0] : `${rooms.length} room types`]
  if (!(seasons.length === 1 && seasons[0] === 'All year')) {
    parts.push(seasons.length <= 2 ? seasons.join(' and ') : `${seasons.length} seasons`)
  }
  if (sleeps > 0) parts.push(`sleeps up to ${sleeps}`)
  return parts.join(' · ')
}

/** Rates grouped the way the document prints them: a table per season. */
export function bySeason<T extends Pick<StoVersionRate, 'season'>>(rates: T[]) {
  return seasonsOf(rates).map((season) => ({
    season,
    rates: rates.filter((r) => (r.season.trim() || 'All year') === season),
  }))
}

/** The meal plans a rate is quoted at, in the order the contract prints them. */
export const MEAL_PLANS = [
  { key: 'bb_price', label: 'BB', full: 'Bed & breakfast' },
  { key: 'hb_price', label: 'HB', full: 'Half board' },
  { key: 'fb_price', label: 'FB', full: 'Full board' },
] as const

export type MealPlanKey = (typeof MEAL_PLANS)[number]['key']

/**
 * The cheapest and dearest night on the sheet.
 *
 * Across all three meal plans, because that is the span an operator is being
 * offered: the lowest BB and the highest FB are the two ends of the contract.
 */
export function rateRange(
  rates: Pick<StoVersionRate, 'bb_price' | 'hb_price' | 'fb_price' | 'currency'>[]
) {
  const prices = rates
    .flatMap((r) => [r.bb_price, r.hb_price, r.fb_price])
    .filter((p) => p > 0)
  if (prices.length === 0) return null
  return {
    from: Math.min(...prices),
    to: Math.max(...prices),
    currency: rates[0].currency,
  }
}

/**
 * A policy body, split the way it was written.
 *
 * A line opening with a bullet is a bullet; anything else is a paragraph. The
 * contract is written that way, and re-typing it into markup would be one more
 * thing to get wrong every season.
 */
export function policyBlocks(body: string) {
  return body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n').map((line) => line.trim()).filter(Boolean)
      const bullets = lines.filter((line) => /^[•\-*]\s*/.test(line))
      return bullets.length === lines.length && lines.length > 0
        ? { kind: 'list' as const, items: lines.map((line) => line.replace(/^[•\-*]\s*/, '')) }
        : { kind: 'text' as const, text: block }
    })
}

/**
 * The placeholders an email template may use.
 *
 * Named for what the writer means, not for the column they come from: the
 * person composing the email is thinking about the operator, not the schema.
 */
export const PLACEHOLDERS = [
  '{{contact_name}}',
  '{{company_name}}',
  '{{agreement_year}}',
  '{{agreement_name}}',
  '{{agreement_button}}',
  '{{sender_name}}',
] as const

/**
 * Fill a template.
 *
 * `{{agreement_button}}` becomes the link itself in plain text — the CRM hands
 * off to the user's own mail client, which is given text rather than HTML, so
 * a bare URL is the only button that survives the trip.
 */
export function fillTemplate(
  text: string,
  values: {
    contactName: string
    companyName: string
    year: number | string
    versionName: string
    link: string
    senderName: string
  }
) {
  return text
    .replace(/\{\{contact_name\}\}/g, values.contactName)
    .replace(/\{\{company_name\}\}/g, values.companyName)
    .replace(/\{\{agreement_year\}\}/g, String(values.year))
    .replace(/\{\{agreement_name\}\}/g, values.versionName)
    .replace(/\{\{agreement_button\}\}/g, values.link)
    .replace(/\{\{sender_name\}\}/g, values.senderName)
}

/** Whether a version is still inside its validity dates, on the day it is read. */
export function isCurrent(version: { valid_from: string | null; valid_to: string | null }) {
  const today = new Date().toISOString().slice(0, 10)
  if (version.valid_from && today < version.valid_from) return false
  if (version.valid_to && today > version.valid_to) return false
  return true
}
