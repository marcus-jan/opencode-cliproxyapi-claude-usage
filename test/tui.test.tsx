/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { Plugin } from "@opencode/plugin/tui"
import { testRender, useRenderer } from "@opentui/solid"
import { createRoot, createSignal } from "solid-js"
import plugin from "../src/tui"
import { parseUsage } from "../src/usage"

type Context = Plugin.Context
type Claim = Parameters<Context["ui"]["slot"]>[0]

test("real TUI rendering is additive, reacts to providers, and creates a separate home row", async () => {
  const [provider, setProvider] = createSignal("anthropic")
  const claims: Claim[] = []
  let calls = 0
  let stopEvent = false
  let disposeRoot!: () => void
  const usage = parseUsage({ five_hour: { utilization: 25 }, seven_day: { utilization: 40 } })
  const context = {
    options: { providers: ["claude-local", "claude-work"] },
    client: { rpc: () => ({ get: async () => { calls++; return usage } }) },
    data: { on: () => () => { stopEvent = true } },
    keymap: { layer: () => {} },
    theme: { text: { base: "#ffffff", muted: "#aaaaaa", feedback: {
      warning: { base: "#ffff00" }, error: { base: "#ff0000" },
    } } },
    ui: {
      model: { current: () => ({ providerID: provider(), modelID: "test" }) },
      router: { current: () => ({ type: "home" }) },
      slot: (claim: Claim) => { claims.push(claim); return () => {} },
    },
  } as unknown as Context
  let cleanup!: () => void
  const view = await testRender(() => {
    Object.assign(context, { renderer: useRenderer() })
    const result = createRoot((dispose) => {
      disposeRoot = dispose
      return plugin.setup(context)
    })
    if (typeof result !== "function") throw new Error("Expected synchronous cleanup")
    cleanup = result
    const home = claims.find((claim) => "prepend" in claim && claim.prepend === "home.footer")!
    const sidebar = claims.find((claim) => "append" in claim && claim.append === "sidebar.content")!
    expect(home).toBeDefined()
    expect(sidebar).toBeDefined()
    expect(claims.every((claim) => !("replace" in claim))).toBe(true)
    expect(claims).toHaveLength(2)
    return <box flexDirection="column">
      <text>branch: main</text>
      {home.render({} as never)}
      <text>MCP healthy · version</text>
      {sidebar.render({} as never)}
    </box>
  }, { width: 100, height: 15 })
  try {
    await view.renderOnce()
    expect(view.captureCharFrame()).not.toContain("Claude")
    expect(calls).toBe(0)
    setProvider("claude-local")
    await view.waitForFrame((frame) => frame.includes("25% of 5h limit"))
    const frame = view.captureCharFrame()
    const rows = frame.split("\n")
    const branch = rows.findIndex((row) => row.includes("branch: main"))
    const footer = rows.findIndex((row) => row.includes("Claude: 25%"))
    const health = rows.findIndex((row) => row.includes("MCP healthy"))
    expect(footer).toBeGreaterThan(branch)
    expect(health).toBeGreaterThan(footer)
    expect(frame).toContain("Claude usage")
    expect(frame).toContain("Weekly: 40% used")
    expect(calls).toBe(1)

    setProvider("openai")
    await view.waitForFrame((text) => !text.includes("Claude"))
    expect(view.captureCharFrame()).toContain("branch: main")
    expect(view.captureCharFrame()).toContain("MCP healthy")
    expect(calls).toBe(1)

    setProvider("claude-work")
    await view.waitForFrame((text) => text.includes("Claude usage"))
    expect(calls).toBe(2)
  } finally {
    cleanup()
    disposeRoot()
    await view.dispose()
  }
  expect(stopEvent).toBe(true)
})
