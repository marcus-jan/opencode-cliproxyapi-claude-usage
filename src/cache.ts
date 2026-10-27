import type { Usage } from "./usage"

type Entry = { good?: Usage; latest?: Usage; pending?: Promise<Usage>; retryAt?: number; failures: number }

export const BACKOFF_BASE = 60_000
export const BACKOFF_MAX = 15 * 60_000

/**
 * In-memory, account-scoped cache; concurrent callers share a single quota request.
 * Failures never replace the last good reading (it is served marked `stale`) and
 * trigger exponential backoff so the usage endpoint's strict rate limit is respected.
 */
export function createUsageCache(ttl = 60_000, now = Date.now, floor = 20_000) {
  const entries = new Map<string, Entry>()

  function serve(entry: Entry): Usage | undefined {
    if (entry.latest?.error && entry.good) return { ...entry.good, stale: entry.latest.error }
    return entry.latest
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
      const cached = serve(entry)
      const age = entry.latest ? now() - entry.latest.fetchedAt : Infinity
      if (cached && entry.retryAt !== undefined && now() < entry.retryAt) return Promise.resolve(cached)
      if (cached && age < (force ? floor : ttl)) return Promise.resolve(cached)
      const current = entry
      current.pending = Promise.resolve().then(load).then((value) => {
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
        return serve(current)!
      }).finally(() => { current.pending = undefined })
      return current.pending
    },
  }
}
