import type { Entry, Store } from "./store"
import type { Usage } from "./usage"

export const BACKOFF_BASE = 60_000
export const BACKOFF_MAX = 15 * 60_000

/**
 * Account-scoped cache; concurrent callers share a single quota request.
 * Failures never replace the last good reading (it is served marked `stale`) and
 * trigger exponential backoff so the usage endpoint's strict rate limit is respected.
 * With a store, readings made by other server instances are reused before fetching.
 */
export function createUsageCache(ttl = 60_000, now = Date.now, floor = 60_000, store?: Store) {
  const entries = new Map<string, Entry>()

  function serve(entry: Entry): Usage | undefined {
    if (entry.latest?.error && entry.good) return { ...entry.good, stale: entry.latest.error }
    return entry.latest
  }

  function fresh(entry: Entry, force: boolean): Usage | undefined {
    const cached = serve(entry)
    if (!cached) return undefined
    if (entry.retryAt !== undefined && now() < entry.retryAt) return cached
    const age = now() - entry.latest!.fetchedAt
    return age < (force ? floor : ttl) ? cached : undefined
  }

  function adopt(entry: Entry, shared: Entry | undefined) {
    if (!shared?.latest) return
    if (entry.latest && entry.latest.fetchedAt >= shared.latest.fetchedAt) return
    entry.latest = shared.latest
    entry.retryAt = shared.retryAt
    entry.failures = shared.failures
    if (!shared.good) return
    if (!entry.good || shared.good.fetchedAt > entry.good.fetchedAt) entry.good = shared.good
  }

  return {
    get(key: string, load: () => Promise<Usage>, force = false): Promise<Usage> {
      let entry = entries.get(key)
      if (!entry) {
        entries.clear() // Never retain an old account's usage after switching accounts.
        entry = { failures: 0 }
        entries.set(key, entry)
      }
      if (entry.pending) return entry.pending
      const cached = fresh(entry, force)
      if (cached) return Promise.resolve(cached)
      const current = entry
      current.pending = (async () => {
        adopt(current, await store?.load(key))
        const shared = fresh(current, force)
        if (shared) return shared
        const value = await load()
        current.latest = value
        if (value.error) {
          current.failures += 1
          const backoff = Math.min(BACKOFF_BASE * 2 ** (current.failures - 1), BACKOFF_MAX)
          current.retryAt = Math.max(value.retryAt ?? 0, now() + backoff)
        } else {
          current.failures = 0
          current.retryAt = undefined
          current.good = value
        }
        const { pending: _, ...persisted } = current
        await store?.save(key, persisted)
        return serve(current)!
      })().finally(() => { current.pending = undefined })
      return current.pending
    },
  }
}
