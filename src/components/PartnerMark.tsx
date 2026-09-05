import { useMemo, useState } from 'react'

/**
 * The operator's own mark, opposite Zondela's on the agreement.
 *
 * Nothing is uploaded and nothing is stored: the icons are read straight off
 * the website already held on the company record, trying the places a site
 * conventionally puts one and falling through to the next on each failure.
 *
 * Deliberately not a logo service. This page carries confidential rates, and
 * asking a third party for `logo.example.com/wakali-safaris.com` tells that
 * third party who is reading it and when. Their own server already knows.
 *
 * When every candidate fails — no website, an unreachable one, a site with no
 * icon at its root — the company's name stands in, which is what the contract
 * would have said anyway.
 */
export default function PartnerMark({
  name,
  website,
  size = 52,
}: {
  name: string
  website?: string | null
  size?: number
}) {
  const candidates = useMemo(() => iconCandidates(website), [website])
  const [attempt, setAttempt] = useState(0)

  const src = candidates[attempt]

  if (!src) {
    return <span className="pm-name">{name}</span>
  }

  return (
    <img
      className="pm-logo"
      // Remounts on each failure so the browser actually re-requests rather
      // than re-showing the error it already has for this element.
      key={src}
      src={src}
      alt={name}
      style={{ maxHeight: size }}
      // A broken icon in place of a partner's name looks like a mistake on our
      // side, so a failure moves on rather than showing anything at all.
      onError={() => setAttempt((n) => n + 1)}
      referrerPolicy="no-referrer"
      loading="lazy"
    />
  )
}

/**
 * Where a site keeps its icon, best first.
 *
 * The touch icons come first because they are the only ones a site is obliged
 * to publish at a usable size; favicon.ico is last because at 16px it prints
 * as a smudge, but a smudge still beats nothing.
 */
function iconCandidates(website: string | null | undefined): string[] {
  const origin = originOf(website)
  if (!origin) return []
  return [
    `${origin}/apple-touch-icon.png`,
    `${origin}/apple-touch-icon-precomposed.png`,
    `${origin}/favicon.svg`,
    `${origin}/favicon.png`,
    `${origin}/favicon.ico`,
  ]
}

/**
 * The site's origin, from whatever was typed into the website field.
 *
 * People enter "wakalisafaris.com", "www.wakalisafaris.com/about" and the full
 * URL in roughly equal measure. Anything that is not http(s) is dropped rather
 * than coerced: a `javascript:` or `data:` value has no business becoming the
 * src of an image on a page we serve.
 */
function originOf(website: string | null | undefined): string | null {
  const raw = website?.trim()
  if (!raw) return null
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!url.hostname.includes('.')) return null
    return url.origin
  } catch {
    return null
  }
}
