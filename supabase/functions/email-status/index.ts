// ============================================================================
// email-status — where the provider tells us what happened to a message
// ============================================================================
// `send-email` knows one thing: the provider accepted the message. Everything
// after that — it arrived, they opened it, it bounced — happens minutes or days
// later, and the provider reports it by calling this function.
//
// Each event carries the provider's own message id, which `send-email` wrote
// onto the `sent_messages` row. That id is the join, and it is the reason a
// status can never be attached to the wrong message.
//
// This endpoint is public by necessity: the provider has no Supabase session.
// It is protected instead by a shared secret sent in a header, so a stranger
// cannot mark a client's message as read. Deploy it with JWT verification off
// or the provider's call is rejected before it reaches this code:
//
//   supabase functions deploy email-status --no-verify-jwt
//   supabase secrets set EMAIL_WEBHOOK_SECRET=$(openssl rand -hex 32)
//
// Then in Resend → Webhooks, point a webhook at
//   https://<project-ref>.functions.supabase.co/email-status
// and add the header `x-webhook-secret: <the same value>`.
//
// The statuses map onto the ones the CRM already shows on a message's Delivery
// panel, so nothing in the UI changes for these to start arriving.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WEBHOOK_SECRET = Deno.env.get('EMAIL_WEBHOOK_SECRET') ?? ''

/**
 * What each provider event means in the CRM's own vocabulary.
 *
 * `delivered` and `opened` are the two that matter; a bounce or a complaint is
 * a failure with a reason, which is what someone chasing a silent operator
 * needs to see. Anything not listed is ignored rather than guessed at.
 */
const EVENTS: Record<string, { status: string; stamp: string; failure?: string }> = {
  'email.delivered': { status: 'delivered', stamp: 'delivered_at' },
  'email.opened': { status: 'viewed', stamp: 'viewed_at' },
  'email.clicked': { status: 'viewed', stamp: 'viewed_at' },
  'email.bounced': { status: 'failed', stamp: 'failed_at', failure: 'The address bounced.' },
  'email.complained': {
    status: 'failed',
    stamp: 'failed_at',
    failure: 'The recipient marked it as spam.',
  },
  'email.delivery_delayed': {
    status: 'sent',
    stamp: 'updated_at',
    failure: 'Delivery is being retried by the provider.',
  },
}

/** How far along each status is. A later event never moves a message backwards. */
const RANK: Record<string, number> = {
  queued: 0,
  sent: 1,
  delivered: 2,
  viewed: 3,
  failed: 4,
  approved: 5,
  rejected: 5,
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // No secret configured means no webhook: refusing is safer than accepting
  // anything from anyone while someone believes this is locked down.
  if (!WEBHOOK_SECRET) return json({ error: 'Webhook secret is not set.' }, 503)
  if (req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) {
    return json({ error: 'Not authorised' }, 401)
  }

  const payload = await req.json().catch(() => null)
  if (!payload) return json({ error: 'Unreadable body' }, 400)

  const type = String(payload.type ?? '')
  const providerId = String(payload?.data?.email_id ?? payload?.data?.id ?? '')
  const event = EVENTS[type]

  // Acknowledged rather than refused: a provider that gets an error back will
  // retry an event this CRM has no use for, over and over.
  if (!event || !providerId) return json({ ignored: type || 'unknown' })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const { data: message } = await admin
    .from('sent_messages')
    .select('id, status, delivered_at, viewed_at, failed_at')
    .eq('provider_message_id', providerId)
    .maybeSingle()

  if (!message) return json({ ignored: 'no matching message' })

  // A bounce after a delivery is real and must land; an out-of-order
  // "delivered" arriving after someone has already opened it is not news.
  const nextRank = RANK[event.status] ?? 0
  const currentRank = RANK[message.status] ?? 0
  if (nextRank <= currentRank && event.status !== 'failed') {
    return json({ ignored: 'already further along', status: message.status })
  }

  const now = new Date().toISOString()
  const update: Record<string, unknown> = { status: event.status, updated_at: now }

  // Stamped once and never overwritten, so "delivered on the 3rd" stays true
  // after the message is later marked viewed.
  if (event.stamp !== 'updated_at') {
    const existing = (message as Record<string, unknown>)[event.stamp]
    if (!existing) update[event.stamp] = now
  }
  if (event.failure) update.failure_reason = event.failure

  const { error } = await admin.from('sent_messages').update(update).eq('id', message.id)
  if (error) return json({ error: error.message }, 500)

  return json({ recorded: event.status })
})
