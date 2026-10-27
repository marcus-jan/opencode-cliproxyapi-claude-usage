import { expect, test } from "bun:test"
import { details, fetchUsage, isClaude, parseUsage, percentUsed, resetTime, severity, summary, USAGE_URL } from "../src/usage"

const now = Date.parse("2026-10-27T10:00:00Z")
const plan = {
  five_hour: { utilization: 42.4, resets_at: "2026-10-27T12:30:00Z" },
  seven_day: { utilization: 61, resets_at: "2026-10-30T10:00:00Z" },
  seven_day_opus: { utilization: 12, resets_at: "2026-10-30T10:00:00Z" },
  seven_day_sonnet: null,
  extra_usage: { is_enabled: false, monthly_limit: null, used_credits: null, utilization: null, currency: "USD", decimal_places: 2 },
}
const team = {
  five_hour: null, seven_day: null, seven_day_opus: null, seven_day_sonnet: null,
  extra_usage: { is_enabled: true, monthly_limit: 150000, used_credits: 99, utilization: 0.066, currency: "USD", decimal_places: 2 },
  spend: { used: { amount_minor: 99, currency: "USD", exponent: 2 }, limit: { amount_minor: 150000, currency: "USD", exponent: 2 },
    percent: 0, severity: "normal", enabled: true },
  limits: [],
}

test("parses subscription windows and extra usage, ignoring unknown and null fields", () => {
  const usage = parseUsage(plan, now, { account: "someone@example.com", organization: "Example" })
  expect(usage).toEqual({
    fetchedAt: now, account: "someone@example.com", organization: "Example",
    fiveHour: { utilization: 42.4, resetsAt: "2026-10-27T12:30:00Z" },
    sevenDay: { utilization: 61, resetsAt: "2026-10-30T10:00:00Z" },
    sevenDayOpus: { utilization: 12, resetsAt: "2026-10-30T10:00:00Z" },
    sevenDaySonnet: undefined,
    spend: undefined,
  })
  expect(summary(usage)).toBe("Claude: 42% of 5h limit · 61% weekly")
  expect(percentUsed(usage)).toBe(61)
  expect(details(usage, now)).toEqual([
    "Claude: 42% of 5h limit · 61% weekly",
    "Account: someone@example.com",
    "Organization: Example",
    "Session (5h): 42% used · resets in 2h 30m",
    "Weekly: 61% used · resets in 3d 0h",
    "Weekly Opus: 12% used · resets in 3d 0h",
    `Updated: ${new Date(now).toLocaleTimeString()}`,
  ])
})

test("org-managed accounts without windows fall back to extra usage spend", () => {
  const usage = parseUsage(team, now)
  expect(usage.fiveHour).toBeUndefined()
  expect(usage.spend).toEqual({ used: 0.99, limit: 1500, currency: "USD", percent: 0.066, enabled: true })
  expect(summary(usage)).toBe("Claude: $0.99 / $1,500.00 extra usage")
  expect(percentUsed(usage)).toBe(0.066)
  expect(details(usage, now)).toContain("Extra usage: $0.99 / $1,500.00 extra usage · 0.1%")
  const legacy = parseUsage({ extra_usage: { is_enabled: true, monthly_limit: 5000, used_credits: 2500, decimal_places: 2 } }, now)
  expect(legacy.spend).toEqual({ used: 25, limit: 50, currency: "USD", percent: 50, enabled: true })
  expect(summary(parseUsage({ five_hour: null, extra_usage: { is_enabled: false } }, now))).toBe("Claude: no usage reported")
  expect(() => parseUsage({})).toThrow("Invalid usage response")
  expect(() => parseUsage("nope")).toThrow("Invalid usage response")
})

test("utilization is clamped and spend only counts toward severity without windows", () => {
  const usage = parseUsage({ five_hour: { utilization: 250 }, extra_usage: { is_enabled: true, utilization: 99 } }, now)
  expect(usage.fiveHour?.utilization).toBe(100)
  expect(percentUsed(usage)).toBe(100)
  expect(severity(usage)).toBe("error")
  expect(severity(parseUsage({ five_hour: { utilization: 80 } }, now))).toBe("warning")
  expect(severity(parseUsage({ five_hour: { utilization: 80 } }, now), 85, 95)).toBe("normal")
  expect(severity(parseUsage(team, now))).toBe("normal")
  expect(severity({ fetchedAt: now, error: "x" })).toBe("warning")
  expect(severity(undefined)).toBe("normal")
})

test("reset times are relative and tolerant", () => {
  expect(resetTime("2026-10-27T10:20:00Z", now)).toBe("20m")
  expect(resetTime("2026-10-27T09:00:00Z", now)).toBe("0m")
  expect(resetTime("2026-10-29T13:00:00Z", now)).toBe("2d 3h")
  expect(resetTime("garbage", now)).toBeUndefined()
  expect(resetTime(undefined, now)).toBeUndefined()
})

test("provider matching uses the configured list", () => {
  expect(isClaude("claude-local", ["claude-local"])).toBe(true)
  expect(isClaude("anthropic", ["claude-local"])).toBe(false)
  expect(isClaude(undefined, ["claude-local"])).toBe(false)
})

test("fetch sends the OAuth bearer token and never surfaces bodies or exceptions", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetcher = (status: number, body: unknown) => async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  }
  const ok = await fetchUsage("secret-token", { account: "me" }, fetcher(200, plan))
  expect(ok.fiveHour?.utilization).toBe(42.4)
  expect(ok.account).toBe("me")
  expect(calls[0]!.url).toBe(USAGE_URL)
  const headers = new Headers(calls[0]!.init.headers)
  expect(headers.get("Authorization")).toBe("Bearer secret-token")
  expect(headers.get("anthropic-beta")).toBe("oauth-2025-04-20")
  expect(calls[0]!.init.redirect).toBe("error")
  expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal)

  const denied = await fetchUsage("secret-token", {}, fetcher(401, { error: "secret-token leaked" }))
  expect(denied.error).toBe("Claude token expired or revoked; send a request through the proxy or log in again")
  const failed = await fetchUsage("secret-token", {}, fetcher(503, { error: "secret-token leaked" }))
  expect(failed.error).toBe("Claude usage unavailable (HTTP 503)")
  expect(JSON.stringify([denied, failed])).not.toContain("secret-token")
  const thrown = await fetchUsage("secret-token", {}, async () => { throw new Error("secret-token in message") })
  expect(thrown.error).toBe("Could not retrieve Claude usage")
  const invalid = await fetchUsage("secret-token", {}, fetcher(200, []))
  expect(invalid.error).toBe("Could not retrieve Claude usage")
  const aborted = new AbortController()
  aborted.abort()
  await fetchUsage("secret-token", {}, fetcher(200, plan), aborted.signal)
  expect(calls.at(-1)!.init.signal?.aborted).toBe(true)
})
