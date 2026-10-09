import type jsQRType from 'jsqr'
import { supabase } from './supabase'

/**
 * What a business card can tell the CRM.
 *
 * Every field is a string, empty when the card does not say, because that is
 * what both sources produce: a QR code's vCard has no notion of "unknown", and
 * the scan-card function is constrained to the same shape. Kept in step with
 * FIELDS in supabase/functions/scan-card/index.ts.
 */
export interface ScannedCard {
  full_name: string
  job_title: string
  company: string
  email: string
  phone: string
  mobile: string
  whatsapp: string
  website: string
  address: string
  country: string
  notes: string
}

export type ScanSource = 'qr' | 'photo'

export function emptyCard(): ScannedCard {
  return {
    full_name: '',
    job_title: '',
    company: '',
    email: '',
    phone: '',
    mobile: '',
    whatsapp: '',
    website: '',
    address: '',
    country: '',
    notes: '',
  }
}

/** Does the card name a person, as opposed to only a company or a link? */
export function hasPerson(card: ScannedCard) {
  return Boolean(card.full_name || card.email || card.mobile || card.phone)
}

/** The number to file as the contact's phone: the mobile, since that is who answers. */
export function primaryPhone(card: ScannedCard) {
  return card.mobile || card.phone
}

/**
 * The numbers and addresses that had no field of their own, as one line for
 * the notes. An office number is kept here when the mobile took the phone
 * field, so nothing the card printed is lost on the way in.
 */
export function cardExtras(card: ScannedCard) {
  const extras: string[] = []
  if (card.mobile && card.phone) extras.push(`Office: ${card.phone}`)
  if (card.notes) extras.push(card.notes)
  return extras.join(' · ')
}

// ---------------------------------------------------------------------------
// QR codes
// ---------------------------------------------------------------------------

/**
 * What a QR code holds, read into card fields.
 *
 * Business card QR codes come in three shapes: a vCard (`BEGIN:VCARD`, the
 * common one), a MECARD (`MECARD:N:…;TEL:…;;`, from older generators), or a
 * bare link — usually the company website or an online profile. A link alone
 * is returned as `kind: 'link'` so the scanner can keep the camera open for the
 * printed side; it is a website, not a contact.
 */
export function parseQrPayload(
  raw: string
): { kind: 'contact'; card: ScannedCard } | { kind: 'link'; url: string } | null {
  const text = raw.trim()
  if (!text) return null

  if (/^BEGIN:VCARD/i.test(text)) {
    const card = parseVCard(text)
    return isEmpty(card) ? null : { kind: 'contact', card }
  }
  if (/^MECARD:/i.test(text)) {
    const card = parseMeCard(text)
    return isEmpty(card) ? null : { kind: 'contact', card }
  }
  if (/^mailto:/i.test(text)) {
    const card = emptyCard()
    card.email = decodeURIComponent(text.slice(7).split('?')[0])
    return { kind: 'contact', card }
  }
  if (/^tel:/i.test(text)) {
    const card = emptyCard()
    card.mobile = text.slice(4)
    return { kind: 'contact', card }
  }
  if (/^https?:\/\//i.test(text) || /^www\./i.test(text)) {
    return { kind: 'link', url: text }
  }
  return null
}

function isEmpty(card: ScannedCard) {
  return Object.values(card).every((v) => !v)
}

/** vCard text escapes: `\,` `\;` `\\` and `\n`. */
function unescapeVCard(value: string) {
  return value.replace(/\\([,;\\nN])/g, (_m, ch: string) => (ch === 'n' || ch === 'N' ? ' ' : ch))
}

/** Split on separators that are not escaped. */
function splitUnescaped(value: string, sep: string) {
  const parts: string[] = []
  let current = ''
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (ch === '\\' && i + 1 < value.length) {
      current += ch + value[i + 1]
      i++
    } else if (ch === sep) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  parts.push(current)
  return parts
}

/** Quoted-printable, which vCard 2.1 still uses for anything non-ASCII. */
function decodeQuotedPrintable(value: string) {
  const bytes: number[] = []
  const soft = value.replace(/=\r?\n/g, '')
  for (let i = 0; i < soft.length; i++) {
    if (soft[i] === '=' && /^[0-9A-F]{2}$/i.test(soft.slice(i + 1, i + 3))) {
      bytes.push(parseInt(soft.slice(i + 1, i + 3), 16))
      i += 2
    } else {
      bytes.push(soft.charCodeAt(i))
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

function parseVCard(text: string): ScannedCard {
  const card = emptyCard()
  const extras: string[] = []
  let structuredName = ''

  // Folded lines continue with a leading space or tab.
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n')

  for (const line of lines) {
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const head = line.slice(0, colon)
    let value = line.slice(colon + 1)

    // `item1.TEL;TYPE=CELL` → name TEL, params TYPE=CELL
    const [nameWithGroup, ...params] = head.split(';')
    const name = nameWithGroup.split('.').pop()!.toUpperCase()
    const paramText = params.join(';').toUpperCase()

    if (/ENCODING=QUOTED-PRINTABLE/.test(paramText)) value = decodeQuotedPrintable(value)
    const plain = unescapeVCard(value).trim()
    if (!plain) continue

    switch (name) {
      case 'FN':
        card.full_name = plain
        break
      case 'N': {
        // Family;Given;Additional;Prefix;Suffix
        const [family, given, additional, prefix] = splitUnescaped(value, ';').map((p) =>
          unescapeVCard(p).trim()
        )
        structuredName = [prefix, given, additional, family].filter(Boolean).join(' ')
        break
      }
      case 'ORG':
        // Organisation;Unit — the unit is noise for a company name.
        card.company = unescapeVCard(splitUnescaped(value, ';')[0]).trim()
        break
      case 'TITLE':
      case 'ROLE':
        if (!card.job_title) card.job_title = plain
        break
      case 'EMAIL':
        if (!card.email) card.email = plain
        else extras.push(plain)
        break
      case 'TEL': {
        const number = plain.replace(/^tel:/i, '')
        if (/WHATSAPP/.test(paramText) && !card.whatsapp) card.whatsapp = number
        else if (/CELL|MOBILE|IPHONE/.test(paramText) && !card.mobile) card.mobile = number
        else if (/FAX/.test(paramText)) extras.push(`Fax: ${number}`)
        else if (!card.phone) card.phone = number
        else if (!card.mobile) card.mobile = number
        else extras.push(number)
        break
      }
      case 'URL':
        if (!card.website) card.website = plain
        else extras.push(plain)
        break
      case 'ADR': {
        // PO box;Extended;Street;Locality;Region;Postal code;Country
        const parts = splitUnescaped(value, ';').map((p) => unescapeVCard(p).trim())
        const [poBox, extended, street, locality, region, postal, country] = parts
        if (!card.address) {
          // Some generators already write "P.O. Box" into the field.
          const box = poBox && `P.O. Box ${poBox.replace(/^p\.?\s*o\.?\s*box\s*/i, '')}`
          card.address = [box, extended, street, locality, region, postal].filter(Boolean).join(', ')
        }
        if (!card.country && country) card.country = country
        break
      }
      case 'NOTE':
        extras.push(plain)
        break
    }
  }

  if (!card.full_name) card.full_name = structuredName
  card.notes = extras.join(' · ')
  return card
}

function parseMeCard(text: string): ScannedCard {
  const card = emptyCard()
  const extras: string[] = []
  const body = text.replace(/^MECARD:/i, '').replace(/;;\s*$/, '')

  for (const field of splitUnescaped(body, ';')) {
    const colon = field.indexOf(':')
    if (colon < 0) continue
    const key = field.slice(0, colon).toUpperCase()
    const value = field.slice(colon + 1).replace(/\\(.)/g, '$1').trim()
    if (!value) continue

    switch (key) {
      case 'N': {
        // MECARD writes "Family,Given".
        const [family, given] = value.split(',').map((p) => p.trim())
        card.full_name = given ? `${given} ${family}` : family
        break
      }
      case 'ORG':
        card.company = value
        break
      case 'TITLE':
        card.job_title = value
        break
      case 'TEL':
        if (!card.mobile) card.mobile = value
        else if (!card.phone) card.phone = value
        else extras.push(value)
        break
      case 'EMAIL':
        if (!card.email) card.email = value
        else extras.push(value)
        break
      case 'URL':
        card.website = value
        break
      case 'ADR':
        card.address = value
        break
      case 'NOTE':
        extras.push(value)
        break
    }
  }

  card.notes = extras.join(' · ')
  return card
}

let jsQR: typeof jsQRType | null = null

/**
 * Fetch the QR decoder. Loaded when the scanner opens rather than with the
 * app, since most visits never scan anything.
 */
export async function loadQrDecoder() {
  if (!jsQR) jsQR = (await import('jsqr')).default
}

/**
 * Look for a QR code in a frame or a photo. Finds nothing until
 * loadQrDecoder() has resolved.
 *
 * jsQR rather than the browser's BarcodeDetector: the latter does not exist in
 * Safari or Firefox, and a scanner that works on half the team's phones is a
 * scanner nobody trusts.
 */
export function findQrCode(source: CanvasImageSource, width: number, height: number, maxSide = 900) {
  if (!jsQR) return null
  const scale = Math.min(1, maxSide / Math.max(width, height))
  const w = Math.round(width * scale)
  const h = Math.round(height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(source, 0, 0, w, h)
  const { data } = ctx.getImageData(0, 0, w, h)
  return jsQR(data, w, h, { inversionAttempts: 'attemptBoth' })?.data ?? null
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

/** Load a picked file as something a canvas can draw. */
export function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('That file could not be opened as an image.'))
    }
    img.src = url
  })
}

/**
 * The photo as a JPEG small enough to send.
 *
 * A phone camera produces 4000-pixel images of several megabytes; the model
 * reads a card just as well at 1600 on the long side, and the upload is a
 * fraction of the size on a mobile connection.
 */
export function toJpegBase64(source: CanvasImageSource, width: number, height: number, maxSide = 1600) {
  const scale = Math.min(1, maxSide / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot prepare the photo.')
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
  return { base64: dataUrl.slice(dataUrl.indexOf(',') + 1), dataUrl }
}

let photoReadingConfigured: boolean | null = null

/**
 * Can printed cards be read — is scan-card deployed with its key?
 *
 * Cached for the session, and a failure answers "no": QR codes still work
 * without it, so the scanner should open either way and say what it can do.
 */
export async function photoReadingAvailable() {
  if (photoReadingConfigured !== null) return photoReadingConfigured
  try {
    const { data, error } = await supabase.functions.invoke('scan-card', { body: { action: 'status' } })
    photoReadingConfigured = !error && Boolean(data?.configured)
  } catch {
    photoReadingConfigured = false
  }
  return photoReadingConfigured
}

/** Send a card photo to scan-card and get its fields back. */
export async function readCardPhoto(base64: string): Promise<ScannedCard> {
  const { data, error } = await supabase.functions.invoke('scan-card', {
    body: { image: base64, mediaType: 'image/jpeg' },
  })
  if (error) {
    // A non-2xx carries the function's own sentence in the response body.
    const context = (error as { context?: Response }).context
    const body = context ? await context.json().catch(() => null) : null
    throw new Error(body?.error ?? 'The card could not be read. Try again, or fill the fields in by hand.')
  }
  return { ...emptyCard(), ...(data?.card ?? {}) }
}
