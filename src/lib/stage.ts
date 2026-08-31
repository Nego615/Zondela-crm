import type { Stage } from './database.types'

export const STAGE_META: Record<Stage, { label: string; color: string; bg: string }> = {
  lead: { label: 'Lead', color: 'var(--stage-lead)', bg: 'var(--stage-lead-bg)' },
  contacted: { label: 'Contacted', color: 'var(--stage-contacted)', bg: 'var(--stage-contacted-bg)' },
  site_visit: { label: 'Site visit', color: 'var(--stage-visit)', bg: 'var(--stage-visit-bg)' },
  proposal_sent: { label: 'Proposal sent', color: 'var(--stage-proposal)', bg: 'var(--stage-proposal-bg)' },
  negotiation: { label: 'Negotiation', color: 'var(--stage-negotiation)', bg: 'var(--stage-negotiation-bg)' },
  won: { label: 'Won', color: 'var(--stage-won)', bg: 'var(--stage-won-bg)' },
  lost: { label: 'Lost', color: 'var(--stage-lost)', bg: 'var(--stage-lost-bg)' },
}

export const STAGE_LIST: Stage[] = [
  'lead',
  'contacted',
  'site_visit',
  'proposal_sent',
  'negotiation',
  'won',
  'lost',
]

// Stages shown as board columns (won/lost usually get filtered to a summary row)
export const BOARD_STAGES: Stage[] = [
  'lead',
  'contacted',
  'site_visit',
  'proposal_sent',
  'negotiation',
]
