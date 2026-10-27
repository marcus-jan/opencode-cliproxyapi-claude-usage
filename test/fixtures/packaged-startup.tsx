/** @jsxImportSource @opentui/solid */
import assert from "node:assert/strict"
import { ensureRuntimePluginSupport } from "@opentui/solid/runtime-plugin-support/configure"
import { testRender, useRenderer } from "@opentui/solid"
import { createSignal, runWithOwner } from "solid-js"
import type { Plugin } from "@opencode/plugin/tui"

// Match OpenCode: register host runtime modules before loading an installed
// package, and call setup without a Solid owner before models have hydrated.
ensureRuntimePluginSupport()
const { default: plugin } = await import(process.argv[2]!) as { default: typeof import("../../src/tui").default }
type Claim = Parameters<Plugin.Context["ui"]["slot"]>[0]
const [provider, setProvider] = createSignal<string>()
const claims: Claim[] = []
let calls = 0
let reads = 0
let cleanup!: () => void
const context = {
  options: { refreshSeconds: 120, providers: ["claude-local", "claude-work"] },
  client: { rpc: () => ({ get: async () => {
    calls++
    return { fetchedAt: 1, fiveHour: { utilization: 25 }, sevenDay: { utilization: 40 } }
  } }) },
  data: { on: () => () => {} },
  keymap: { layer: () => {} },
  theme: { text: { base: "#ffffff", muted: "#aaaaaa", feedback: {
    warning: { base: "#ffff00" }, error: { base: "#ff0000" },
  } } },
  ui: {
    model: { current: () => { reads++; return provider() ? { providerID: provider(), modelID: "test" } : undefined } },
    router: { current: () => ({ type: "home" }) },
    slot: (claim: Claim) => { claims.push(claim); return () => {} },
  },
} as unknown as Plugin.Context
const view = await testRender(() => {
  Object.assign(context, { renderer: useRenderer() })
  const result = runWithOwner(null, () => plugin.setup(context))
  assert.equal(typeof result, "function")
  cleanup = result as () => void
  const home = claims.find((claim) => "prepend" in claim && claim.prepend === "home.footer")!
  return <box flexDirection="column">
    {home.render({} as never)}
    <text>Host footer preserved</text>
  </box>
}, { width: 100, height: 15 })
try {
  await view.renderOnce()
  assert.equal(calls, 0)
  setProvider("claude-local")
  await view.waitForFrame((frame) => frame.includes("25% of 5h limit"))
  assert.equal(calls, 1)
  assert.ok(view.captureCharFrame().includes("Host footer preserved"))
  setProvider("anthropic")
  await view.waitForFrame((frame) => !frame.includes("Claude"))
  setProvider("claude-work")
  await view.waitForFrame((frame) => frame.includes("25% of 5h limit"))
  assert.equal(calls, 2)
} finally {
  cleanup()
  await view.dispose()
}
const previousReads = reads
setProvider("claude-local")
await new Promise((resolve) => setTimeout(resolve, 10))
assert.equal(reads, previousReads, "unloading must dispose the model effect")
assert.equal(calls, 2)
console.log("packaged startup passed")
