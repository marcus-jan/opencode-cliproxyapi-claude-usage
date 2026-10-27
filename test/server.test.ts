import { expect, spyOn, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Plugin } from "@opencode/plugin"
import plugin from "../src/index"
import type { Usage } from "../src/usage"

const file = (token: string, email = "someone@example.com") => JSON.stringify({
  type: "claude", access_token: token, refresh_token: `${token}-refresh`, email, organization_name: "Example",
  expired: new Date(Date.now() + 3_600_000).toISOString(), disabled: false,
})

test("server reads the proxy credential securely, caches by token, and aborts on unload", async () => {
  const dir = await mkdtemp(join(tmpdir(), "claude-server-"))
  const path = join(dir, "claude-test.json")
  await writeFile(path, file("test-access"))
  let handler!: (input: { refresh?: boolean }) => Promise<Usage>
  let lastSignal: AbortSignal | undefined
  let requests = 0
  const headers: string[] = []
  const mockFetch = async (...[_url, init]: Parameters<typeof fetch>) => {
    requests++
    lastSignal = init?.signal ?? undefined
    headers.push(new Headers(init?.headers).get("Authorization") ?? "")
    return Response.json({ five_hour: { utilization: requests * 10 }, seven_day: null })
  }
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(Object.assign(mockFetch, { preconnect: fetch.preconnect }))
  const context = {
    options: { authDir: dir, cacheDir: join(dir, "cache") },
    rpc: { register: async (_definition: unknown, handlers: { get: typeof handler }) => { handler = handlers.get } },
  } as unknown as Plugin.Context
  let cleanup: Awaited<ReturnType<typeof plugin.setup>>
  try {
    cleanup = await plugin.setup(context)
    expect(typeof handler).toBe("function")
    expect(requests).toBe(0) // Loading the plugin alone makes no Anthropic request.
    const result = await handler({})
    expect(headers[0]).toBe("Bearer test-access")
    expect(result).toMatchObject({ account: "someone@example.com", organization: "Example", fiveHour: { utilization: 10 } })
    expect(JSON.stringify(result)).not.toMatch(/test-access|refresh/)
    await handler({})
    await handler({ refresh: true }) // Forced refreshes are rate-limited too: the endpoint throttles aggressively.
    expect(requests).toBe(1)

    // The proxy rewrites the file when it refreshes the token; the cache follows the new token.
    await writeFile(path, file("test-rotated"))
    await handler({})
    expect(requests).toBe(2)
    expect(headers[1]).toBe("Bearer test-rotated")

    const { readdir, readFile } = await import("node:fs/promises")
    const [cached] = await readdir(join(dir, "cache"))
    expect(cached).toMatch(/^[0-9a-f]{16}\.json$/)
    expect(await readFile(join(dir, "cache", cached!), "utf8")).not.toMatch(/test-access|test-rotated|refresh/)

    await rm(path)
    expect((await handler({})).error).toBe("No Claude login found in the cliproxyapi auth directory")
    expect(requests).toBe(2)
    if (typeof cleanup === "function") await cleanup()
    expect(lastSignal?.aborted).toBe(true)
  } finally {
    fetchSpy.mockRestore()
    await rm(dir, { recursive: true, force: true })
  }
})

test("account option selects among multiple proxy logins", async () => {
  const dir = await mkdtemp(join(tmpdir(), "claude-server-"))
  await writeFile(join(dir, "claude-a.json"), file("token-a", "a@example.com"))
  await writeFile(join(dir, "claude-b.json"), file("token-b", "b@example.com"))
  let handler!: (input: { refresh?: boolean }) => Promise<Usage>
  const headers: string[] = []
  const mockFetch = async (...[_url, init]: Parameters<typeof fetch>) => {
    headers.push(new Headers(init?.headers).get("Authorization") ?? "")
    return Response.json({ five_hour: { utilization: 1 } })
  }
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(Object.assign(mockFetch, { preconnect: fetch.preconnect }))
  const context = {
    options: { authDir: dir, account: "B@example.com", cacheDir: false },
    rpc: { register: async (_definition: unknown, handlers: { get: typeof handler }) => { handler = handlers.get } },
  } as unknown as Plugin.Context
  try {
    const cleanup = await plugin.setup(context)
    expect((await handler({})).account).toBe("b@example.com")
    expect(headers).toEqual(["Bearer token-b"])
    if (typeof cleanup === "function") await cleanup()
  } finally {
    fetchSpy.mockRestore()
    await rm(dir, { recursive: true, force: true })
  }
})
