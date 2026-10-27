import { expect, test } from "bun:test"
import { normalizeOptions, LINE_IDS, type Surface } from "../src/options"
import { displayLines } from "../src/presentation"
import { parseUsage, unavailable, type Usage } from "../src/usage"

const now = Date.parse("2026-10-27T10:00:00Z")
const usage = parseUsage({
  five_hour: { utilization: 90, resets_at: "2026-10-27T12:30:00Z" },
  seven_day: { utilization: 35, resets_at: "2026-10-30T10:00:00Z" },
  seven_day_opus: { utilization: 5 },
  spend: { used: { amount_minor: 250, currency: "USD", exponent: 2 }, limit: { amount_minor: 10000, currency: "USD", exponent: 2 }, enabled: true },
}, now, { account: "someone@example.com", organization: "Example" })
const text = (value: Usage | undefined, surface: Surface, home = false) =>
  displayLines(value, surface, home, now).map((line) => line.segments.map((part) => part.text).join(""))

test("default text and ordered optional lines share formatting", () => {
  const options = normalizeOptions({})
  expect(text(usage, options.display.sidebar)).toEqual(["Claude usage", "90% of 5h limit · 35% weekly", "Weekly: 35% used · 3d 0h", "Resets: in 2h 30m"])
  expect(text(usage, options.display.home, true)).toEqual(["Claude: 90% of 5h limit · 35% weekly"])
  const lines = ["account", "organization", "session", "opus", "sonnet", "spend", "updated", "usage"] as const
  expect(displayLines(usage, { enabled: true, lines: [...lines] }, false, now).map((line) => line.id))
    .toEqual(["account", "organization", "session", "opus", "spend", "updated", "usage"])
  expect(text(usage, { enabled: true, lines: [...lines] }).slice(0, 5))
    .toEqual(["Account: someone@example.com", "Org: Example", "Session: 90% used", "Opus: 5% used", "Extra: $2.50 / $100.00"])
})

test("status fallback, empty/disabled surfaces and missing values", () => {
  const surface: Surface = { enabled: true, lines: ["account"] }
  expect(text(undefined, surface)).toEqual(["loading usage…"])
  expect(text(unavailable("HTTP 401"), surface, true)).toEqual(["Claude: HTTP 401"])
  expect(text({ fetchedAt: 0 }, surface)).toEqual(["no usage reported"])
  expect(text({ fetchedAt: 0, account: "x" }, surface)).toEqual(["Account: x", "no usage reported"])
  expect(text(undefined, { enabled: true, lines: [] })).toEqual([])
  expect(text(undefined, { enabled: false, lines: ["usage"] })).toEqual([])
  const spendOnly = parseUsage({ extra_usage: { is_enabled: true, monthly_limit: 150000, used_credits: 99, utilization: 0.066 } }, now)
  expect(text(spendOnly, { enabled: true, lines: [...LINE_IDS] }))
    .toEqual(["Claude usage", "$0.99 / $1,500.00 extra usage", "Extra: $0.99 / $1,500.00", `Updated: ${new Date(now).toLocaleTimeString()}`])
  const weeklyOnly = parseUsage({ seven_day: { utilization: 10 } }, now)
  expect(text(weeklyOnly, { enabled: true, lines: ["usage", "session", "weekly", "reset"] })).toEqual(["10% weekly", "Weekly: 10% used"])
})
