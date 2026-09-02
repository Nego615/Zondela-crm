import { supabase } from './supabase'

/**
 * Sending mail, when the CRM is allowed to.
 *
 * Two worlds, and the app has to work in both. With no provider wired up the
 * CRM composes the message and hands it to the user's own mail client through
 * `mailto:` — honest, but it cannot see what happens next. With `send-email`
 * deployed and its secrets set, the same message goes out from Zondela's own
 * domain and delivery comes back through the `email-status` webhook.
 *
 * Which one is in play is asked of the function itself rather than configured
 * again in the frontend, so there is one place to get it right and it is the
 * place holding the API key.
 */

let cached: { configured: boolean; from: string | null } | null = null

/**
 * Is the CRM able to send mail itself?
 *
 * Cached for the session: the answer changes when someone deploys a function or
 * sets a secret, which is not something that happens between two clicks.
 * Failures — the function missing entirely, a network that is down — answer
 * "no" rather than throwing, because the fallback works and an error here would
 * stop a send that could have gone out by hand.
 */
export async function emailStatus() {
  if (cached) return cached
  try {
    const { data, error } = await supabase.functions.invoke('send-email', {
      body: { action: 'status' },
    })
    cached = error
      ? { configured: false, from: null }
      : { configured: Boolean(data?.configured), from: data?.from ?? null }
  } catch {
    cached = { configured: false, from: null }
  }
  return cached
}

export interface SendResult {
  /** What actually happened, which is what the UI has to tell the truth about. */
  delivery: 'provider' | 'mail-client'
  providerMessageId?: string | null
  error?: string
}

/**
 * Send a message the app has already saved.
 *
 * The row is the message: its subject and body are read server-side from
 * `sent_messages`, so what goes out is what was recorded, and no caller can
 * quietly send something other than what the CRM shows it sent.
 *
 * A provider failure falls back to the mail client rather than surfacing as a
 * dead end — the rates still have to reach the operator today.
 */
export async function sendRecordedEmail(input: {
  messageId: string
  sendId?: string | null
  to: string
  subject: string
  body: string
}): Promise<SendResult> {
  const status = await emailStatus()

  if (status.configured) {
    try {
      const { data, error } = await supabase.functions.invoke('send-email', {
        body: { messageId: input.messageId, sendId: input.sendId ?? null, to: input.to },
      })
      if (!error && data?.sent) {
        return { delivery: 'provider', providerMessageId: data.providerMessageId ?? null }
      }
      openMailClient(input)
      return {
        delivery: 'mail-client',
        error:
          (data?.error as string) ??
          error?.message ??
          'The provider refused the message, so it was opened in your mail client instead.',
      }
    } catch (err) {
      openMailClient(input)
      return {
        delivery: 'mail-client',
        error: err instanceof Error ? err.message : 'Could not reach the mail service.',
      }
    }
  }

  openMailClient(input)
  return { delivery: 'mail-client' }
}

/** The handoff: the user's own mail client, with everything already written. */
export function openMailClient({
  to,
  subject,
  body,
}: {
  to: string
  subject: string
  body: string
}) {
  window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(body)}`
}
