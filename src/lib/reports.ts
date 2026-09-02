/**
 * Shared machinery for the Reports page: the reporting period, and turning a
 * rendered table into a file someone can open in Excel.
 *
 * Every report on that page is a table over a date range, so the range and the
 * export live here rather than being rebuilt per tab.
 */

/** Local YYYY-MM-DD. `toISOString` would shift the day for anyone east of UTC. */
export function toDateKey(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export type DatePreset = 'this_month' | 'last_month' | 'last_90' | 'this_year' | 'all'

export const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'last_90', label: 'Last 90 days' },
  { value: 'this_year', label: 'This year' },
  { value: 'all', label: 'All time' },
]

/**
 * A preset resolved against today.
 *
 * "All time" still returns real dates rather than nulls — the whole page reads
 * one range, and a range that is sometimes absent would need a null check at
 * every comparison. 2020 predates the business.
 */
export function presetRange(preset: DatePreset, today = new Date()): { from: string; to: string } {
  const y = today.getFullYear()
  const m = today.getMonth()
  switch (preset) {
    case 'this_month':
      return { from: toDateKey(new Date(y, m, 1)), to: toDateKey(new Date(y, m + 1, 0)) }
    case 'last_month':
      return { from: toDateKey(new Date(y, m - 1, 1)), to: toDateKey(new Date(y, m, 0)) }
    case 'this_year':
      return { from: toDateKey(new Date(y, 0, 1)), to: toDateKey(new Date(y, 11, 31)) }
    case 'all':
      return { from: '2020-01-01', to: toDateKey(new Date(y, 11, 31)) }
    case 'last_90':
    default: {
      const start = new Date(today)
      start.setDate(start.getDate() - 89)
      return { from: toDateKey(start), to: toDateKey(today) }
    }
  }
}

/** The preset a range corresponds to, or null when it was hand-edited. */
export function matchPreset(from: string, to: string, today = new Date()): DatePreset | null {
  for (const { value } of DATE_PRESETS) {
    const r = presetRange(value, today)
    if (r.from === from && r.to === to) return value
  }
  return null
}

/**
 * Both ends inclusive, on the day the tables show.
 *
 * Two shapes arrive here and they are not read the same way. A timestamp
 * (`scheduled_for`, `sent_at`) is displayed in the reader's timezone, so it has
 * to be *converted* — slicing the ISO string would use the UTC day, and a visit
 * at 20:00 in Tanzania is stored as 17:00 UTC, one day earlier at the month's
 * edge. A bare date column (`due_at`, `valid_until`) carries no time to convert
 * and is already the day it means; putting it through `new Date()` would read
 * it as UTC midnight and shift it backwards west of Greenwich.
 */
export function dayKey(iso: string): string {
  return iso.length === 10 ? iso : toDateKey(new Date(iso))
}

export function inRange(iso: string | null | undefined, from: string, to: string) {
  if (!iso) return false
  const key = dayKey(iso)
  return key >= from && key <= to
}

/**
 * A moment, however it was stored.
 *
 * A bare date is parsed at local midnight rather than through `new Date`, which
 * would read it as UTC and hand back the day before west of Greenwich.
 */
const parse = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)

export const formatDay = (iso: string | null | undefined) =>
  iso ? parse(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—'

export const formatDayTime = (iso: string | null | undefined) =>
  iso ? parse(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—'

/** Whole days from `iso` to now; negative means still in the future. */
export function daysAgo(iso: string) {
  return Math.floor((Date.now() - parse(iso).getTime()) / 86_400_000)
}

export const percent = (part: number, whole: number) =>
  whole === 0 ? null : Math.round((part / whole) * 100)

/**
 * One CSV cell.
 *
 * Always quoted: a note field is free text and will eventually contain a comma,
 * a quote and a newline, and quoting unconditionally is cheaper to be sure
 * about than deciding per value.
 */
const csvCell = (value: string | number | null | undefined) =>
  `"${String(value ?? '').replace(/"/g, '""')}"`

export function toCsv(columns: string[], rows: (string | number | null)[][]) {
  return [columns, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
}

/**
 * Hand the browser a file.
 *
 * The BOM is what makes Excel read the file as UTF-8 — without it a client name
 * with an accent in it arrives mangled, which is exactly the sort of thing that
 * gets noticed in a report sent to a partner.
 */
export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/** `zondela-visits-2026-08-03-to-2026-09-29.csv` */
export const reportFilename = (slug: string, from: string, to: string) =>
  `zondela-${slug}-${from}-to-${to}.csv`

/* ===========================================================================
   Months
   ---------------------------------------------------------------------------
   "How many visits did we do in August?" is the first question asked of every
   one of these reports, so bucketing by month lives here beside the range that
   defines which months there are.
   =========================================================================== */

/** `2026-08`, read the same way `dayKey` reads its input. */
export const monthKey = (iso: string) => dayKey(iso).slice(0, 7)

/** `Aug 2026`. Day 1 at local noon: no timezone can push that into a neighbouring month. */
export function monthLabel(key: string) {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1, 12).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

/**
 * Every month the period touches, oldest first.
 *
 * Months with nothing in them are included: a gap in the middle of a report is
 * a finding, and dropping the row would hide it. Capped, because "All time"
 * spans years and eighty mostly-empty rows is not a report — past the cap the
 * caller drops the empty ones instead.
 */
export function monthsBetween(from: string, to: string, cap = 24): string[] {
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  const months: string[] = []
  for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); ) {
    months.push(`${y}-${String(m).padStart(2, '0')}`)
    if (++m > 12) {
      m = 1
      y++
    }
  }
  return months.length > cap ? [] : months
}
