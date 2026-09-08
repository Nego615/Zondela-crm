import { useCallback, useEffect, useSyncExternalStore } from 'react'

/**
 * One copy of each server resource, shared by every component that asks for it.
 *
 * The hooks in useCrmData/useUsers/useStoVersions are called in several places
 * at once — a page renders the list while the modal on top of it holds its own
 * copy of the same hook to do the saving. With per-component state that save
 * refreshed the modal's copy and left the list underneath showing what it
 * loaded on mount, so an edit only appeared after a manual page refresh.
 *
 * Keying the state by resource instead fixes that at the source: whoever
 * refreshes, everyone watching the same key re-renders with the new rows.
 */

interface Snapshot<T> {
  data: T
  loading: boolean
  error: string | null
}

interface Entry<T> {
  snapshot: Snapshot<T>
  listeners: Set<() => void>
  fetcher: () => Promise<T>
  /** The fetch currently in flight, so simultaneous mounts share one request. */
  inflight: Promise<void> | null
  /** Rising per fetch: a reply from an older one is dropped rather than applied. */
  seq: number
  /** Whether the data on hand came from the server, as opposed to the seed value. */
  loaded: boolean
}

const entries = new Map<string, Entry<unknown>>()

function ensure<T>(key: string, initial: T, fetcher: () => Promise<T>): Entry<T> {
  const existing = entries.get(key) as Entry<T> | undefined
  if (existing) {
    // Every caller's fetcher runs the same query; the latest one is as good as
    // any, and keeping it current means a refresh after the key's inputs change
    // reads the new ones.
    existing.fetcher = fetcher
    return existing
  }
  const created: Entry<T> = {
    snapshot: { data: initial, loading: true, error: null },
    listeners: new Set(),
    fetcher,
    inflight: null,
    seq: 0,
    loaded: false,
  }
  entries.set(key, created)
  return created
}

function emit<T>(entry: Entry<T>, patch: Partial<Snapshot<T>>) {
  entry.snapshot = { ...entry.snapshot, ...patch }
  for (const listener of entry.listeners) listener()
}

/**
 * Fetches a key.
 *
 * `dedupe` joins a request already on its way — right for a mount, wrong after
 * a write, where the answer has to be newer than the write itself.
 */
function load(key: string, dedupe: boolean): Promise<void> {
  const entry = entries.get(key)
  if (!entry) return Promise.resolve()
  if (dedupe && entry.inflight) return entry.inflight

  const seq = ++entry.seq
  // A background refresh keeps the rows on screen; only a first load has
  // nothing to show and earns the loading state.
  if (!entry.loaded) emit(entry, { loading: true })

  const run = (async () => {
    try {
      const data = await entry.fetcher()
      if (entry.seq !== seq) return
      entry.loaded = true
      emit(entry, { data, loading: false, error: null })
    } catch (err) {
      if (entry.seq !== seq) return
      emit(entry, { loading: false, error: err instanceof Error ? err.message : String(err) })
    } finally {
      if (entry.seq === seq) entry.inflight = null
    }
  })()

  entry.inflight = run
  return run
}

/**
 * Re-reads every resource under these key prefixes.
 *
 * Call it after a write instead of a local refresh: `invalidate('contacts')`
 * reaches the company-scoped list, the all-contacts list and any other view of
 * the same rows, wherever they happen to be mounted.
 */
export function invalidate(...prefixes: string[]): Promise<void> {
  const jobs: Promise<void>[] = []
  for (const [key, entry] of entries) {
    if (!prefixes.some((p) => key === p || key.startsWith(`${p}:`))) continue
    if (entry.listeners.size === 0) {
      // Nothing is watching, so there is no one to re-render. Marking it
      // unloaded is enough: whatever mounts next fetches rather than showing
      // what it had.
      entry.loaded = false
      continue
    }
    jobs.push(load(key, false))
  }
  return Promise.all(jobs).then(() => undefined)
}

export function useSharedResource<T>(key: string, initial: T, fetcher: () => Promise<T>) {
  ensure(key, initial, fetcher)

  const subscribe = useCallback(
    (listener: () => void) => {
      const entry = entries.get(key)
      if (!entry) return () => {}
      entry.listeners.add(listener)
      return () => {
        entry.listeners.delete(listener)
      }
    },
    [key],
  )

  const getSnapshot = useCallback(() => ensure(key, initial, fetcher).snapshot, [key, initial, fetcher])

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  useEffect(() => {
    load(key, true)
  }, [key])

  const refresh = useCallback(() => load(key, false), [key])

  return { data: snapshot.data, loading: snapshot.loading, error: snapshot.error, refresh }
}
