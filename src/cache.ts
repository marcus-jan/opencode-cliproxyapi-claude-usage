import type { Usage } from "./usage"

/** In-memory, account-scoped cache; concurrent callers share a single quota request. */
export function createUsageCache(ttl = 30_000, now = Date.now) {
  const entries = new Map<string, { value?: Usage; pending?: Promise<Usage> }>()
  return {
    get(key: string, load: () => Promise<Usage>, force = false): Promise<Usage> {
      let entry = entries.get(key)
      if (!entry) {
        entries.clear() // Never retain an old account's usage after switching accounts.
        entry = {}
        entries.set(key, entry)
      }
      if (entry.pending) return entry.pending
      if (!force && entry.value && now() - entry.value.fetchedAt < ttl) return Promise.resolve(entry.value)
      const current = entry
      current.pending = Promise.resolve().then(load).then((value) => {
        current.value = value
        return value
      }).finally(() => { current.pending = undefined })
      return current.pending
    },
  }
}
