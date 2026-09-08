/**
 * Reading Supabase Auth's rate-limit refusals.
 *
 * Until a project configures its own SMTP, Supabase sends auth email through a
 * shared service that is throttled hard — a couple of messages an hour for the
 * whole project — and on top of that every address has a cooldown of about a
 * minute between requests. Both refusals arrive as a 429 whose message is
 * either "email rate limit exceeded" or "For security purposes, you can only
 * request this after 47 seconds", neither of which tells the person at the
 * keyboard what to do next.
 *
 * The real ceiling is raised in the Supabase dashboard (Project Settings →
 * Authentication → SMTP, then Authentication → Rate Limits). This module only
 * makes the refusal legible, and gives the UI a number to count down from so
 * the form stops walking into the limit it just hit.
 */

/** What the server falls back to when it refuses without naming a wait. */
const DEFAULT_COOLDOWN_SECONDS = 60

/** The longest countdown worth showing; past this, say "an hour" instead. */
const MAX_COOLDOWN_SECONDS = 60 * 60

const RATE_LIMIT_CODES = new Set([
  'over_email_send_rate_limit',
  'over_request_rate_limit',
  'over_sms_send_rate_limit',
])

interface MaybeAuthError {
  status?: unknown
  code?: unknown
  message?: unknown
}

/**
 * How long to wait, or null if this was not a rate-limit refusal.
 *
 * Matched on the error code first — that is the stable signal — then on the
 * status and wording, because older releases send a 429 with no code at all.
 */
export function emailRateLimitSeconds(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null

  const { status, code, message } = err as MaybeAuthError
  const text = typeof message === 'string' ? message : ''

  const isRateLimit =
    (typeof code === 'string' && RATE_LIMIT_CODES.has(code)) ||
    status === 429 ||
    /rate limit/i.test(text)

  if (!isRateLimit) return null

  // "you can only request this after 47 seconds" — the server's own number is
  // better than a guess, so prefer it when it is there.
  const named = /after (\d+) second/i.exec(text)
  const seconds = named ? Number(named[1]) : DEFAULT_COOLDOWN_SECONDS

  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_COOLDOWN_SECONDS
  return Math.min(Math.ceil(seconds), MAX_COOLDOWN_SECONDS)
}

/** "45 seconds", "3 minutes" — for a sentence, not a countdown. */
export function describeWait(seconds: number): string {
  if (seconds < 90) return `${seconds} second${seconds === 1 ? '' : 's'}`
  const minutes = Math.ceil(seconds / 60)
  return `${minutes} minute${minutes === 1 ? '' : 's'}`
}

/**
 * The message to put on screen for a failed reset or invitation email.
 *
 * Deliberately vague about *why* the limit was hit: on the public sign-in form
 * saying "this address asked recently" would confirm the address exists.
 */
export function emailSendMessage(err: unknown, fallback: string): string {
  const wait = emailRateLimitSeconds(err)
  if (wait !== null) {
    return `Too many reset emails have been requested. Try again in ${describeWait(wait)}.`
  }
  return err instanceof Error ? err.message : fallback
}
