import type { MainMarket, Relationship } from './database.types'

/** Where a client stands with Zondela. */
export const RELATIONSHIP_OPTIONS: { value: Relationship; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'existing_partner', label: 'Existing Partner' },
  { value: 'works_zondela', label: 'Works with Zondela' },
  { value: 'dormant', label: 'Dormant' },
  { value: 'not_interested', label: 'Not Interested' },
]

/** The market the client sells into, which is what STO keywords target. */
export const MAIN_MARKET_OPTIONS: { value: MainMarket; label: string }[] = [
  { value: 'arusha', label: 'Arusha' },
  { value: 'dar_es_salaam', label: 'Dar es Salaam' },
  { value: 'dodoma', label: 'Dodoma' },
  { value: 'mwanza', label: 'Mwanza' },
  { value: 'zanzibar', label: 'Zanzibar' },
  { value: 'tanzania', label: 'Tanzania-wide' },
  { value: 'east_africa', label: 'East Africa' },
  { value: 'international', label: 'International' },
]

export const RELATIONSHIP_LABELS: Record<Relationship, string> = Object.fromEntries(
  RELATIONSHIP_OPTIONS.map((o) => [o.value, o.label])
) as Record<Relationship, string>

export const MAIN_MARKET_LABELS: Record<MainMarket, string> = Object.fromEntries(
  MAIN_MARKET_OPTIONS.map((o) => [o.value, o.label])
) as Record<MainMarket, string>

/** Null-safe lookups: both fields are optional on a company. */
export const relationshipLabel = (v: Relationship | null) => (v ? RELATIONSHIP_LABELS[v] : null)
export const mainMarketLabel = (v: MainMarket | null) => (v ? MAIN_MARKET_LABELS[v] : null)
