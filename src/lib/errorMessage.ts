/**
 * The sentence out of anything a failed call can throw.
 *
 * Supabase rejects with plain objects rather than Error instances, so an
 * `instanceof Error` check throws away the one line that says what went wrong
 * and leaves the reader with a generic fallback instead.
 */
export function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const raw = String((error as { message: unknown }).message)
    if (raw) return raw
  }
  return fallback
}
