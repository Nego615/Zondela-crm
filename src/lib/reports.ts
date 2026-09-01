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
 * Both ends inclusive, in the reader's own timezone.
 *
 * Timestamps (`scheduled_for`) and bare dates (`valid_until`) both arrive here;
 * slicing to the date part first means a visit at 22:00 on the last day of the
 * range still counts as that day, whatever offset the browser is in.
 */
export function inRange(iso: string | null | undefined, from: string, to: string) {
  if (!iso) return false
  const key = iso.length >= 10 && iso[4] === '-' ? iso.slice(0, 10) : toDateKey(new Date(iso))
  return key >= from && key <= to
}

export const formatDay = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—'

export const formatDayTime = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : '—'

/** Whole days from `iso` to now; negative means still in the future. */
export function daysAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime()
  return Math.floor(ms / 86_400_000)
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
