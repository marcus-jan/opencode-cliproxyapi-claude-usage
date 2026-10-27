import { expect, test } from "bun:test"
import { BACKOFF_BASE, BACKOFF_MAX, createUsageCache } from "../src/cache"
import { unavailable, type Usage } from "../src/usage"

const good = (fetchedAt: number): Usage => ({ fetchedAt, spend: { used: 1, currency: "USD", enabled: true } })
const bad = (fetchedAt: number, error: string, retryAt?: number): Usage => ({ ...unavailable(error, retryAt), fetchedAt })

test("cache deduplicates concurrent calls and expires without persisting", async () => {
  let now = 100
  let calls = 0
  const cache = createUsageCache(30_000, () => now, 5_000)
  const load = async () => { calls++; return good(now) }
  const first = cache.get("a", load)
  expect(cache.get("a", load)).toBe(first)
  await first
  await cache.get("a", load)
  expect(calls).toBe(1)
  now += 30_001
  await cache.get("a", load)
  expect(calls).toBe(2)
  await cache.get("a", load, true)
  expect(calls).toBe(2) // forced refreshes still respect the floor
  now += 5_001
  await cache.get("a", load, true)
  expect(calls).toBe(3)
})

test("switching accounts discards the old cache", async () => {
  let calls = 0
  const load = async () => { calls++; return unavailable("test") }
  const cache = createUsageCache()
  await cache.get("a", load)
  await cache.get("b", load)
  await cache.get("a", load)
  expect(calls).toBe(3)
})

test("failures serve the last good reading as stale and back off exponentially", async () => {
  let now = 1_000
  let calls = 0
  let fail = false
  const cache = createUsageCache(30_000, () => now, 0)
  const load = async () => { calls++; return fail ? bad(now, "HTTP 429") : good(now) }
  expect(await cache.get("a", load)).toEqual(good(1_000))
  fail = true
  now += 30_001
  expect(await cache.get("a", load, true)).toEqual({ ...good(1_000), stale: "HTTP 429" })
  expect(calls).toBe(2)
  now += BACKOFF_BASE - 1
  expect(await cache.get("a", load, true)).toEqual({ ...good(1_000), stale: "HTTP 429" })
  expect(calls).toBe(2) // inside backoff: no request, even when forced
  now += 1
  await cache.get("a", load, true)
  expect(calls).toBe(3)
  now += BACKOFF_BASE * 2 - 1
  await cache.get("a", load, true)
  expect(calls).toBe(3) // second failure doubles the wait
  now += 1
  fail = false
  expect(await cache.get("a", load, true)).toEqual(good(now))
  expect(calls).toBe(4)
  now += 30_001
  fail = true
  await cache.get("a", load)
  now += BACKOFF_BASE
  await cache.get("a", load)
  expect(calls).toBe(6) // backoff reset after success
})

test("backoff honors retry-after, is capped, and errors show when nothing good is known", async () => {
  let now = 0
  let calls = 0
  const cache = createUsageCache(30_000, () => now, 0)
  const load = async () => { calls++; return bad(now, "rate limited", now + BACKOFF_MAX * 2) }
  expect(await cache.get("a", load)).toEqual({ fetchedAt: 0, error: "rate limited", retryAt: BACKOFF_MAX * 2 })
  now += BACKOFF_MAX * 2 - 1
  await cache.get("a", load, true)
  expect(calls).toBe(1)
  now += 1
  await cache.get("a", load, true)
  expect(calls).toBe(2)
  const capped = createUsageCache(30_000, () => now, 0)
  const plain = async () => bad(now, "down")
  for (let i = 0; i < 10; i++) { now += BACKOFF_MAX; await capped.get("a", plain) }
  let hits = 0
  now += BACKOFF_MAX - 1 // ten straight failures would exceed the cap without clamping
  await capped.get("a", async () => { hits++; return bad(now, "down") })
  expect(hits).toBe(0)
  now += 1
  await capped.get("a", async () => { hits++; return bad(now, "down") })
  expect(hits).toBe(1)
})

test("rejected loads can retry", async () => {
  let calls = 0
  const cache = createUsageCache()
  const load = async () => { calls++; return unavailable("test") }
  await expect(cache.get("b", () => Promise.reject(new Error("test")))).rejects.toThrow("test")
  await cache.get("b", load)
  expect(calls).toBe(1)
})

test("a slow response from an old account cannot overwrite the current account cache", async () => {
  const cache = createUsageCache()
  let resolve!: (value: Usage) => void
  const old = cache.get("a", () => new Promise<Usage>((done) => { resolve = done }))
  await Promise.resolve()
  const current = unavailable("current")
  await cache.get("b", async () => current)
  resolve(unavailable("old"))
  await old
  expect(await cache.get("b", async () => unavailable("unexpected"))).toBe(current)
})

test("a store shares readings and backoff between cache instances", async () => {
  let now = 1_000
  const files = new Map<string, string>()
  const store = {
    load: async (key: string) => files.has(key) ? JSON.parse(files.get(key)!) : undefined,
    save: async (key: string, entry: unknown) => { files.set(key, JSON.stringify(entry)) },
  }
  let calls = 0
  const load = async () => { calls++; return good(now) }
  const a = createUsageCache(30_000, () => now, 0, store)
  const b = createUsageCache(30_000, () => now, 0, store)
  expect(await a.get("k", load)).toEqual(good(1_000))
  expect(await b.get("k", load)).toEqual(good(1_000)) // second instance reuses the file
  expect(calls).toBe(1)
  expect(files.get("k")).not.toContain("pending")
  now += 30_001
  await b.get("k", async () => { calls++; return bad(now, "429") })
  expect(calls).toBe(2)
  now += 1
  expect(await a.get("k", load, true)).toEqual({ ...good(1_000), stale: "429" }) // backoff shared
  expect(calls).toBe(2)
  now += BACKOFF_BASE
  expect(await a.get("k", load, true)).toEqual(good(now))
  expect(calls).toBe(3)
})

test("file store round-trips entries and tolerates a missing or corrupt file", async () => {
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const { createFileStore } = await import("../src/store")
  const dir = await mkdtemp(join(tmpdir(), "claude-store-"))
  try {
    const store = createFileStore(join(dir, "nested"))
    const key = "a".repeat(64)
    expect(await store.load(key)).toBeUndefined()
    await store.save(key, { good: good(5), latest: good(5), failures: 0 })
    expect(await store.load(key)).toEqual({ good: good(5), latest: good(5), retryAt: undefined, failures: 0 })
    await writeFile(join(dir, "nested", `${"a".repeat(16)}.json`), "{nope")
    expect(await store.load(key)).toBeUndefined()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
