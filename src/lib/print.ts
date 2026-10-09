/** How long to wait for pictures before printing anyway. */
const IMAGE_WAIT_MS = 4000

/**
 * Open the print window — which is how the rate sheet becomes a PDF — once
 * every picture on the page has loaded.
 *
 * The room photographs are `loading="lazy"`, so any the reader has not
 * scrolled to have not been fetched, and Chrome prints an unfetched image as
 * an empty box. Each is switched to eager and waited for first. A picture that
 * fails or is slow does not hold the print up past a few seconds: a PDF with
 * one gap beats a button that does nothing.
 */
export async function printPage() {
  const pending = Array.from(document.images).filter((img) => {
    if (img.loading === 'lazy') img.loading = 'eager'
    return !img.complete
  })

  if (pending.length > 0) {
    const loaded = Promise.all(
      pending.map(
        (img) =>
          new Promise<void>((resolve) => {
            img.addEventListener('load', () => resolve(), { once: true })
            img.addEventListener('error', () => resolve(), { once: true })
          })
      )
    )
    await Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, IMAGE_WAIT_MS))])
  }

  window.print()
}
