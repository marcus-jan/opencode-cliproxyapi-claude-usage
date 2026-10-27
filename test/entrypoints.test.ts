import { expect, test } from "bun:test"
import { Host } from "@opencode/plugin/host"
import server from "../src/index"
import tui from "../src/tui"
import { ClaudeUsage } from "../src/rpc"

test("OpenCode resolves and loads all entrypoints from a local plugin directory", async () => {
  const directory = new URL("..", import.meta.url).pathname
  const entrypoints = Host.resolve({ directory })
  expect(entrypoints.server).toBeDefined()
  expect(entrypoints.tui).toBeDefined()
  expect(entrypoints.rpc).toBeDefined()
  expect(await Host.load(entrypoints.server!)).toHaveProperty("default", server)
  expect(await Host.load(entrypoints.tui!)).toHaveProperty("default", tui)
  expect(await Host.load(entrypoints.rpc!)).toHaveProperty("ClaudeUsage", ClaudeUsage)
})
