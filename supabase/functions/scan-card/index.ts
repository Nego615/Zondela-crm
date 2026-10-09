// ============================================================================
// scan-card — read a photographed business card into contact fields
// ============================================================================
// A card with a QR code never comes here: the browser decodes the vCard itself
// (src/lib/businessCard.ts) and nothing leaves the device. This is for the
// cards that are only print — which is most of them — where the text has to be
// read off the photograph.
//
// Claude does the reading. It is handed the image and a JSON schema, and the
// response is constrained to that schema, so what comes back is always the
// same eleven fields — empty strings where the card says nothing — and never
// prose that has to be picked apart. Nothing is saved here: the fields go back
// to the form, and the rep checks them before anything is written.
//
// The API key is the reason this is a function. Like the email provider's key
// it can spend money on Zondela's account, so it can never ship in a VITE_*
// variable.
//
// Every request is checked before the image goes anywhere: the caller must be
// signed in, active, and allowed to write data (`can_write_data()`), which is
// exactly who can save the company the card turns into.
//
// Deploy:  supabase functions deploy scan-card
// Secrets: supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxx
//          (SUPABASE_URL and SUPABASE_ANON_KEY are injected by the platform.)
//
// Without the key, `status` answers `configured: false` and the app says that
// printed cards cannot be read yet — QR codes keep working regardless.

import Anthropic from 'npm:@anthropic-ai/sdk@0.128.0'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''

const MODEL = 'claude-opus-5-5'

/** The app downsizes before sending; this only stops something unreasonable. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
type MediaType = (typeof MEDIA_TYPES)[number]

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
 * The fields the forms can take. Every one is required and a string — empty
 * when the card does not say — because a schema of optional, nullable fields
 * is one more shape for the app to handle and buys nothing.
 *
 * Kept in step with `ScannedCard` in src/lib/businessCard.ts.
 */
const FIELDS = [
  'full_name',
  'job_title',
  'company',
  'email',
  'phone',
  'mobile',
  'whatsapp',
  'website',
  'address',
  'country',
  'notes',
] as const

const SCHEMA = {
  type: 'object',
  properties: Object.fromEntries(FIELDS.map((f) => [f, { type: 'string' }])),
  required: [...FIELDS],
  additionalProperties: false,
}

const SYSTEM = `You read business cards for a CRM used by a hotel's sales team in Tanzania. The cards mostly come from tour operators and travel agents.

Read the photograph and return what the card itself says. Use an empty string for anything the card does not show; never guess a value that is not printed. If the image is not a business card, or is unreadable, return every field empty.

- full_name: the person's name as printed, in normal capitalisation (not ALL CAPS).
- job_title: their position.
- company: the organisation's trading name, without a slogan.
- email: the person's email; if there are several, the personal one rather than info@ or sales@.
- phone: an office or landline number. mobile: a mobile number. If only one number is printed and it is not marked, put it in mobile when it looks like a mobile (e.g. +255 6/7…), otherwise in phone.
- whatsapp: only a number the card marks as WhatsApp (a label or the WhatsApp icon).
- Write numbers in international form with the country code when the card or the address makes the country clear, e.g. "+255 754 123 456".
- website: the domain or URL, as printed.
- address: street, building, P.O. Box and town, on one line, without the country.
- country: the country, in English.
- notes: anything else worth keeping that has no field above — a second email or number, social handles, licence numbers — as one short line. Leave it empty rather than restating the fields above.`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Not signed in' }, 401)

  const body = await req.json().catch(() => ({}))

  // Answered before the permission check so the scanner can say up front that
  // photos cannot be read, rather than after someone has framed a card.
  if (body.action === 'status') {
    return json({ configured: Boolean(ANTHROPIC_API_KEY) })
  }
  if (!ANTHROPIC_API_KEY) {
    return json({ configured: false, error: 'Reading card photos is not set up yet.' }, 503)
  }

  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })
  const { data: userData, error: userError } = await caller.auth.getUser()
  if (userError || !userData?.user) return json({ error: 'Not signed in' }, 401)

  const { data: mayWrite } = await caller.rpc('can_write_data')
  if (!mayWrite) {
    return json({ error: 'Your account cannot add companies or contacts.' }, 403)
  }

  const image = typeof body.image === 'string' ? body.image : ''
  const mediaType = String(body.mediaType ?? '') as MediaType
  if (!image) return json({ error: 'No image was sent.' }, 400)
  if (!MEDIA_TYPES.includes(mediaType)) {
    return json({ error: 'The photo must be a JPEG, PNG or WebP image.' }, 400)
  }
  // Base64 is four characters for every three bytes.
  if ((image.length * 3) / 4 > MAX_IMAGE_BYTES) {
    return json({ error: 'That photo is too large. Try a smaller one.' }, 413)
  }

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      // Reading a card is transcription, not reasoning; low effort keeps it
      // quick enough to wait for with the phone still in hand.
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: SCHEMA },
      },
      // If a safety classifier declines the request, the API retries it on
      // Anthropic's recommended fallback model instead of returning nothing.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
            { type: 'text', text: 'Read this business card.' },
          ],
        },
      ],
    })

    if (response.stop_reason === 'refusal') {
      return json({ error: 'The card could not be read. Fill the fields in by hand.' }, 422)
    }

    const text = response.content.find((b) => b.type === 'text')
    if (!text || text.type !== 'text') {
      return json({ error: 'The card could not be read. Try another photo.' }, 502)
    }

    const parsed = JSON.parse(text.text) as Record<string, unknown>
    const card = Object.fromEntries(
      FIELDS.map((f) => [f, typeof parsed[f] === 'string' ? (parsed[f] as string).trim() : ''])
    )
    return json({ configured: true, card })
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return json({ error: 'Too many cards at once. Wait a moment and try again.' }, 429)
    }
    if (err instanceof Anthropic.AuthenticationError) {
      console.error('scan-card: ANTHROPIC_API_KEY was rejected')
      return json({ error: 'Reading card photos is misconfigured. Tell an admin.' }, 500)
    }
    if (err instanceof Anthropic.APIError) {
      console.error('scan-card', err.status, err.message)
      return json({ error: 'The card reader is unavailable right now. Try again shortly.' }, 502)
    }
    console.error('scan-card', err)
    return json({ error: 'Something went wrong reading the card.' }, 500)
  }
})
