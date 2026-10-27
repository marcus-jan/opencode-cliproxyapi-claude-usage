import { expect, test } from "bun:test"
import { createUsageCache } from "../src/cache"
import { unavailable, type Usage } from "../src/usage"

test("cache deduplicates concurrent calls and expires without persisting", async () => {
  let now = 100
  let calls = 0
  const cache = createUsageCache(30_000, () => now)
  const load = async () => { calls++; return { fetchedAt: now, tokenBasedBilling: false } }
  const first = cache.get("a", load)
  expect(cache.get("a", load)).toBe(first)
  await first
  await cache.get("a", load)
  expect(calls).toBe(1)
  now += 30_001
  await cache.get("a", load)
  expect(calls).toBe(2)
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

test("error responses are cached and rejected loads can retry", async () => {
  let calls = 0
  const cache = createUsageCache()
  const load = async () => { calls++; return unavailable("test") }
  await cache.get("a", load)
  await cache.get("a", load)
  expect(calls).toBe(1)
  await expect(cache.get("b", () => Promise.reject(new Error("test")))).rejects.toThrow("test")
  await cache.get("b", load)
  expect(calls).toBe(2)
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
