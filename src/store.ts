import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { Usage } from "./usage"

export type Entry = { good?: Usage; latest?: Usage; pending?: Promise<Usage>; retryAt?: number; failures: number }
export type Store = { load(key: string): Promise<Entry | undefined>; save(key: string, entry: Entry): Promise<void> }

/**
 * Shares usage readings and backoff state between every OpenCode server instance
 * (one per open workspace) and across restarts. Files hold only what the TUI already
 * displays; the name is a prefix of the token hash and cannot be reversed.
 */
export function createFileStore(dir: string): Store {
  const path = (key: string) => join(dir, `${key.slice(0, 16)}.json`)
  return {
    async load(key) {
      try {
        const parsed = JSON.parse(await readFile(path(key), "utf8")) as Partial<Entry>
        if (typeof parsed !== "object" || parsed === null) return undefined
        return { good: parsed.good, latest: parsed.latest, retryAt: parsed.retryAt, failures: parsed.failures ?? 0 }
      } catch {
        return undefined
      }
    },
    async save(key, entry) {
      try {
        await mkdir(dir, { recursive: true, mode: 0o700 })
        const tmp = `${path(key)}.${process.pid}.tmp`
        await writeFile(tmp, JSON.stringify(entry), { mode: 0o600 })
        await rename(tmp, path(key))
      } catch {
        // Best effort: the in-memory cache still works without a shared store.
      }
    },
  }
}
