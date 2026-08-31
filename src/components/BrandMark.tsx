/**
 * The Zondela House mark, inline rather than an <img src="/logo-mark.svg">.
 * The shareable preview (see preview/) is inlined into a single file under a
 * CSP that blocks every external request, so a linked asset would render as a
 * broken image there. public/logo-mark.svg stays the copy for outside use.
 */
export default function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label="Zondela House"
      focusable="false"
    >
      <rect x="14" y="35" width="36" height="19" fill="var(--brand-brick)" />
      <g stroke="var(--brand-cream)" strokeWidth="1.6" strokeLinecap="square">
        <path d="M14 41.3h36M14 47.6h36" />
        <path d="M26 35v6.3M38 35v6.3" />
        <path d="M20 41.3v6.3M44 41.3v6.3" />
        <path d="M26 47.6v6.4M38 47.6v6.4" />
      </g>
      <g stroke="var(--brand-olive)" strokeWidth="2.6" strokeLinecap="round">
        <path d="M28.6 40v9M35.4 40v9M28.6 44.5h6.8" />
      </g>
      <path
        d="M5 35 32 13.5 59 35"
        fill="none"
        stroke="var(--brand-teal)"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M32 15.5c0-6.6 5.4-11.4 11.6-11.5 1 6.8-4 12-11.6 11.5z"
        fill="var(--brand-olive)"
      />
      <path
        d="M34 13.6 41.2 6.6"
        fill="none"
        stroke="var(--brand-olive-deep)"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  )
}
