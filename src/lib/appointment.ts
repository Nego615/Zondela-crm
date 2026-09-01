import type { AppointmentKind } from './database.types'

/**
 * An appointment is either going to the client's premises or sitting down with
 * them somewhere else — a call, their office, ours. The distinction matters for
 * planning a day: one costs travel, the other does not.
 */
export const APPOINTMENT_KINDS: { value: AppointmentKind; label: string; hint: string }[] = [
  { value: 'site_visit', label: 'Site visit', hint: "At the client's premises" },
  { value: 'meeting', label: 'Meeting', hint: 'Call, or a sit-down elsewhere' },
]

export const APPOINTMENT_KIND_LABELS: Record<AppointmentKind, string> = {
  site_visit: 'Site visit',
  meeting: 'Meeting',
}

export const APPOINTMENT_KIND_STYLE: Record<AppointmentKind, { color: string; bg: string }> = {
  site_visit: { color: 'var(--stage-visit)', bg: 'var(--stage-visit-bg)' },
  meeting: { color: 'var(--brand-teal)', bg: 'var(--brand-teal-tint)' },
}
