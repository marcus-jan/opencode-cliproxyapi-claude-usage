import { expect, test } from "bun:test"
import { homedir } from "node:os"
import { join } from "node:path"
import { enabled, normalizeOptions } from "../src/options"

test("defaults apply for missing or invalid options", () => {
  const options = normalizeOptions(undefined)
  expect(options).toEqual({
    authDir: join(homedir(), ".config", "cliproxyapi", "auth"),
    account: undefined,
    providers: ["claude-local"],
    refreshSeconds: 60,
    colors: { mode: "theme", warningAt: 75, criticalAt: 90 },
    display: { sidebar: { enabled: true, lines: ["title", "usage", "weekly", "reset"] }, home: { enabled: true, lines: ["usage"] } },
  })
  expect(normalizeOptions({ refreshSeconds: 5, colors: { mode: "bogus", warningAt: 95, criticalAt: 50 }, providers: "nope", authDir: 7 }))
    .toMatchObject({ refreshSeconds: 30, colors: { mode: "theme", warningAt: 75, criticalAt: 90 }, providers: ["claude-local"] })
})

test("auth directory, account and providers are normalized", () => {
  const options = normalizeOptions({
    authDir: "~/custom/auth", account: " Someone@Example.com ", providers: ["claude-local", "", "claude-work", "claude-local"],
  })
  expect(options.authDir).toBe(join(homedir(), "custom", "auth"))
  expect(options.account).toBe("someone@example.com")
  expect(options.providers).toEqual(["claude-local", "claude-work"])
  expect(normalizeOptions({ authDir: "/abs/path" }).authDir).toBe("/abs/path")
})

test("surfaces drop unknown and duplicate line ids and can be disabled", () => {
  const options = normalizeOptions({
    colors: { mode: "muted", warningAt: 50, criticalAt: 80 },
    display: { sidebar: { lines: ["usage", "bogus", "usage", "spend"] }, home: { enabled: false } },
  })
  expect(options.colors).toEqual({ mode: "muted", warningAt: 50, criticalAt: 80 })
  expect(options.display.sidebar.lines).toEqual(["usage", "spend"])
  expect(enabled(options.display.sidebar)).toBe(true)
  expect(enabled(options.display.home)).toBe(false)
  expect(enabled(normalizeOptions({ display: { home: { lines: [] } } }).display.home)).toBe(false)
})
