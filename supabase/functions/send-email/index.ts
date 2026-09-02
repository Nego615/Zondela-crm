// ============================================================================
// send-email — the CRM sends the message itself, instead of handing it off
// ============================================================================
// Without this, sending a rate contract opens the user's own mail client with
// `mailto:` and the app records that it went out. That is honest but blind: it
// cannot know whether the message arrived, and nothing can go out unattended.
//
// This function closes that gap. It takes a message the app has already
// composed and recorded, sends it through an email provider, and writes the
// provider's message id back onto the row so the webhook in `email-status` can
// match delivery events to it later.
//
// **Only STO agreements are sent this way.** Pricing shares, template messages
// and every other email in the CRM still open the sender's own mail client;
// this route exists because a rate contract goes to dozens of operators at once
// and its delivery is worth knowing about. And whatever goes out through here,
// **the reply comes back to the normal inbox** — Reply-To is set to the address
// the team already reads, never to the sending address, so nobody has to watch
// two places for an operator's answer.
//
// The provider's API key is the reason this is a function at all. It can send
// mail as your domain to anyone, so it can never reach the browser — anything
// in a VITE_* variable ships to every visitor.
//
// Every request is checked before anything is sent:
//
//   1. The caller's own JWT builds a normal, RLS-bound client. If that client
//      cannot read the sent_messages row being sent, neither can the caller,
//      and the request stops there.
//   2. Only then does the service-role client stamp the provider's ids onto
//      the row — a column the app itself is not allowed to write.
//
// Nothing in the request body decides who the caller is, and nothing in it
// decides what the message says: the subject and body are read from the row
// that was already saved. A caller who edits the payload changes the address
// it goes to and nothing else, which is a thing they could already do.
//
// Deploy:  supabase functions deploy send-email
// Secrets: supabase secrets set RESEND_API_KEY=re_xxx
//          supabase secrets set EMAIL_FROM="Zondela House <reservations@zondelahouse.com>"
//          (SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are
//           injected by the platform.)
//
// The From address must be on a domain verified with the provider, with SPF,
// DKIM and DMARC records in place. Sending as a gmail.com address is rejected
// outright by Gmail; sending as an unverified domain lands in spam.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const EMAIL_FROM = Deno.env.get('EMAIL_FROM') ?? ''
// Where an operator's reply lands. Left unset, it is taken from the letterhead
// in org_settings — see replyTo() below — because the address the team reads is
// already recorded there and a send-only From address is not it.
const EMAIL_REPLY_TO = Deno.env.get('EMAIL_REPLY_TO') ?? ''
const EMAIL_BCC = Deno.env.get('EMAIL_BCC') ?? ''

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

/**
 * Plain text as an email body.
 *
 * The app composes messages as text, because that is what a mail client is
 * handed. A provider wants HTML as well or the message renders as one run-on
 * paragraph, so the text is escaped and its line breaks are kept.
 */
function asHtml(text: string) {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  // A bare URL on its own line is the agreement link. Left as text it is still
  // clickable in most clients, but not all, and this is the one link that
  // matters.
  const linked = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" style="color:#0c3b35">$1</a>'
  )
  return `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#22201c;white-space:pre-wrap">${linked}</div>`
}

/**
 * The inbox an operator's reply should land in.
 *
 * The secret wins when it is set. Otherwise the letterhead decides: the
 * reply-to on org_settings, or failing that the organisation's own address.
 * Falling through to nothing would mean replies going to the From address,
 * which is typically `reservations@` — a mailbox that may exist only to send.
 */
async function replyTo(admin: ReturnType<typeof createClient>) {
  if (EMAIL_REPLY_TO) return EMAIL_REPLY_TO
  const { data } = await admin
    .from('org_settings')
    .select('email_reply_to, email')
    .eq('id', 1)
    .maybeSingle()
  return (data?.email_reply_to || data?.email || '') as string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // Answered before anything else so the app can ask whether email is wired up
  // without composing a message first, and fall back to `mailto:` if it is not.
  const configured = Boolean(RESEND_API_KEY && EMAIL_FROM)

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Not signed in' }, 401)

  const body = await req.json().catch(() => ({}))
  const action = String(body.action ?? 'send')

  if (action === 'status') {
    const replyAddress = configured
      ? await replyTo(createClient(SUPABASE_URL, SERVICE_ROLE_KEY))
      : ''
    return json({ configured, from: EMAIL_FROM || null, replyTo: replyAddress || null })
  }

  if (!configured) {
    return json(
      {
        configured: false,
        error:
          'Email is not configured. Set RESEND_API_KEY and EMAIL_FROM on this function, then try again.',
      },
      503
    )
  }

  const messageId = String(body.messageId ?? '')
  const sendId = body.sendId ? String(body.sendId) : null
  const to = String(body.to ?? '').trim()
  if (!messageId) return json({ error: 'Which message?' }, 400)
  if (!to.includes('@')) return json({ error: 'That is not an email address.' }, 400)

  // Bound by RLS and by the caller's own permissions. If they cannot read the
  // row, the send stops here — the body of the email is whatever was saved on
  // it, so reading it is exactly the right permission to require.
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: message, error: readError } = await caller
    .from('sent_messages')
    .select('id, subject, body, to_name, status')
    .eq('id', messageId)
    .single()

  if (readError || !message) {
    return json({ error: 'That message is not yours to send.' }, 403)
  }

  // Already gone. Sending again on a retry would put a second copy in front of
  // a client who has one, which is worse than the retry failing.
  if (message.status !== 'queued') {
    return json({ error: 'That message has already been sent.', status: message.status }, 409)
  }

  // Privileged: the provider columns are not writable by the app, so a status
  // can only ever be set by something that actually talked to the provider.
  // Needed before the send as well, to read the letterhead's reply address.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const replyAddress = await replyTo(admin)

  const payload: Record<string, unknown> = {
    from: EMAIL_FROM,
    to: [to],
    subject: message.subject ?? 'Zondela House',
    text: message.body,
    html: asHtml(message.body),
  }
  // Always set when there is an address to set it to: the whole point is that
  // the answer arrives where the team is already looking.
  if (replyAddress) payload.reply_to = replyAddress
  if (EMAIL_BCC) payload.bcc = [EMAIL_BCC]

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const result = await response.json().catch(() => ({}))

  if (!response.ok) {
    const reason = String(result?.message ?? result?.error ?? `Provider returned ${response.status}`)
    await admin
      .from('sent_messages')
      .update({
        status: 'failed',
        failed_at: new Date().toISOString(),
        failure_reason: reason.slice(0, 500),
        provider: 'resend',
      })
      .eq('id', messageId)
    return json({ error: reason }, 502)
  }

  const providerId = String(result?.id ?? '')

  await admin
    .from('sent_messages')
    .update({
      status: 'sent',
      provider: 'resend',
      provider_message_id: providerId || null,
      failure_reason: null,
      failed_at: null,
    })
    .eq('id', messageId)

  // The agreement's own row keeps the provider id too, so a delivery event can
  // find its way back to the operator it belongs to.
  if (sendId) {
    await admin
      .from('sto_agreement_sends')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', sendId)
  }

  return json({ sent: true, providerMessageId: providerId || null, replyTo: replyAddress || null })
})
