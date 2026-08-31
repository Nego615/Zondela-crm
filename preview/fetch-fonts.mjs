/**
 * Downloads the latin subsets of the two faces the app's design tokens name
 * (Archivo for display, Inter for body) and writes them out as @font-face
 * rules with base64 data URIs.
 *
 * The preview is published somewhere that blocks external requests, so the
 * app's Google Fonts @import can't load. Without this the preview silently
 * falls back to system-ui and stops looking like the real product.
 *
 * Run: node preview/fetch-fonts.mjs   (regenerates preview/fonts.generated.css)
 */
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
const CSS_URL =
  'https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=Inter:wght@400;500;600&display=swap'

// The UA matters: without a modern one Google serves ttf instead of woff2.
const css = await fetch(CSS_URL, { headers: { 'User-Agent': UA } }).then((r) => r.text())

const blocks = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1])
const field = (block, name) => block.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]?.trim()

// Google serves these as variable fonts: every requested weight of a family
// points at the same woff2. Group by URL so each file is embedded once and
// declared with a weight *range*, instead of three identical copies.
const groups = new Map()
for (const block of blocks) {
  // Google splits each face across subsets; we only need latin + latin-ext,
  // both of which cover U+0000-00FF. Everything else is dead weight here.
  const range = field(block, 'unicode-range') ?? ''
  if (!range.includes('U+0000-00FF')) continue

  const url = field(block, 'src')?.match(/url\((https:[^)]+\.woff2)\)/)?.[1]
  if (!url) continue

  const key = url
  const g = groups.get(key) ?? {
    url,
    family: field(block, 'font-family'),
    style: field(block, 'font-style') ?? 'normal',
    weights: [],
  }
  g.weights.push(Number(field(block, 'font-weight')))
  groups.set(key, g)
}

const out = []
for (const g of groups.values()) {
  const buf = Buffer.from(await fetch(g.url).then((r) => r.arrayBuffer()))
  const lo = Math.min(...g.weights)
  const hi = Math.max(...g.weights)
  const weight = lo === hi ? `${lo}` : `${lo} ${hi}`

  out.push(
    `@font-face{font-family:${g.family};font-style:${g.style};font-weight:${weight};font-display:swap;` +
      `src:url(data:font/woff2;base64,${buf.toString('base64')}) format('woff2');}`
  )
  console.log(`${g.family} ${weight} — ${(buf.length / 1024).toFixed(1)} kB`)
}

if (!out.length) throw new Error('no latin font faces resolved; refusing to write an empty file')

const dest = fileURLToPath(new URL('./fonts.generated.css', import.meta.url))
await writeFile(dest, out.join('\n') + '\n', 'utf8')
console.log(`\nwrote ${dest} (${(out.join('\n').length / 1024).toFixed(0)} kB of CSS)`)
