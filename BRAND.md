# Zondela House — brand palette

Sampled from the Zondela House logo (cream circular badge: teal gabled roof and
wordmark, brick-red house body with cream mortar, olive leaf and `H` monogram).

All tokens live in [`src/index.css`](src/index.css). Use the semantic tokens in
components; reach for a `--brand-*` value only when you genuinely mean the brand
colour itself (a logo tile, a marketing surface).

## Core

| Token | Hex | Comes from | Used for |
| --- | --- | --- | --- |
| `--brand-teal` | `#14564d` | roof + wordmark | the mark, primary brand colour |
| `--brand-teal-deep` | `#0c3b35` | shaded roof | `--ink` — sidebar, login ground, headings |
| `--brand-teal-bright` | `#1f7a6c` | roof highlight | focus rings, hover on teal |
| `--brand-teal-tint` | `#e2edea` | — (derived) | selection, soft teal fills |
| `--brand-brick` | `#a9463a` | house body | `--accent` — primary buttons, links |
| `--brand-brick-deep` | `#8f3830` | brick shadow | `--accent-hover` |
| `--brand-brick-tint` | `#f6e7e2` | — (derived) | proposal-stage chips |
| `--brand-olive` | `#8fa83c` | leaf + `H` | growth/positive accents, brand sub-label |
| `--brand-olive-deep` | `#5c6f26` | leaf midrib | `--stage-won`, success text |
| `--brand-olive-tint` | `#eef1de` | — (derived) | won-stage chips |
| `--brand-cream` | `#f7f3ea` | logo ground | `--paper`, logo tiles |
| `--brand-slate` | `#3c4a47` | keyline circle | rules, quiet chrome |

## Neutrals

Warm, pulled toward the cream ground rather than pure grey.

| Token | Hex |
| --- | --- |
| `--paper` | `#f7f3ea` |
| `--paper-dim` | `#efe9dc` |
| `--card` | `#ffffff` |
| `--line` | `#e2dccd` |
| `--line-strong` | `#cfc7b4` |
| `--text` | `#22201c` |
| `--text-soft` | `#6b665c` |
| `--text-muted` | `#9b9587` |

## Pipeline stages

Rebased around the brand hues — proposal is the brick, won is the olive — with
the rest spaced far enough apart to stay tellable at chip size.

| Stage | Foreground | Background |
| --- | --- | --- |
| Lead | `#5a6b72` | `#e9eef0` |
| Contacted | `#2a7296` | `#e3eff5` |
| Site visit | `#8a6018` | `#f8efdc` |
| Proposal | `#a9463a` (brick) | `#f6e7e2` |
| Negotiation | `#8c4a63` | `#f3e6ec` |
| Won | `#5c6f26` (olive) | `#eef1de` |
| Lost | `#6b665c` | `#edeae2` |

Every stage foreground clears 4.5:1 against its own chip background, against
`--card` and against `--paper`. Four of them were darkened from the raw sampled
hue to get there — chip labels are 11–12px, so they need the contrast.

`--text-muted` (2.7:1) is the one deliberate exception: it is for decorative
repetition of information stated elsewhere, never for text you must read.

## Assets

| File | What it is |
| --- | --- |
| [`public/logo.svg`](public/logo.svg) | full circular lockup — mark, wordmark, `EST. 2026` |
| [`public/logo-mark.svg`](public/logo-mark.svg) | house + leaf mark alone, transparent |
| [`public/favicon.svg`](public/favicon.svg) | mark on a cream rounded square |
| [`src/components/BrandMark.tsx`](src/components/BrandMark.tsx) | the mark inline, painted from the `--brand-*` tokens |

In the app, use `<BrandMark />` rather than linking `logo-mark.svg`: the
shareable preview is inlined into one file under a CSP that blocks external
requests, so a linked asset renders there as a broken image.

The wordmark in `logo.svg` is live text in Archivo, so it needs the webfont to
render exactly as drawn — convert it to outlines before sending the file to a
printer.
