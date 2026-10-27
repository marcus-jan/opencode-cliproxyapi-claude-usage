import { expect, test } from "bun:test"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadCredential, type AuthFs } from "../src/auth"

const now = Date.parse("2026-10-27T10:00:00Z")
const file = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  type: "claude", access_token: "tok", refresh_token: "ref", email: "Someone@Example.com",
  organization_name: "Example", expired: "2026-10-27T18:00:00Z", disabled: false, ...overrides,
})

function memory(files: Record<string, string>, failing = new Set<string>()): AuthFs {
  return {
    readdir: async () => Object.keys(files),
    readFile: async (path) => {
      const name = path.split("/").pop()!
      if (failing.has(name) || !(name in files)) throw new Error("EACCES")
      return files[name]!
    },
  }
}

test("selects a live claude credential and exposes identity without secrets", async () => {
  const credential = await loadCredential("/auth", undefined, memory({
    "notes.txt": "ignored",
    "codex-x.json": file({ type: "codex", access_token: "codex" }),
    "claude-a.json": file({ access_token: "a", disabled: true }),
    "claude-b.json": file({ access_token: "b", expired: "2026-10-27T09:00:00Z" }),
    "claude-c.json": file({ access_token: "c" }),
    "claude-d.json": "{not json",
  }), now)
  expect(credential).toEqual({ token: "c", account: "Someone@Example.com", organization: "Example", expired: Date.parse("2026-10-27T18:00:00Z") })
})

test("falls back to an expired credential and filters by account", async () => {
  const io = memory({
    "claude-a.json": file({ access_token: "a", email: "a@example.com", expired: "2026-10-27T09:00:00Z" }),
    "claude-b.json": file({ access_token: "b", email: "b@example.com", expired: "bogus" }),
  })
  expect((await loadCredential("/auth", "a@example.com", io, now))?.token).toBe("a")
  expect((await loadCredential("/auth", "b@example.com", io, now))).toMatchObject({ token: "b", expired: undefined })
  expect(await loadCredential("/auth", "c@example.com", io, now)).toBeUndefined()
  expect((await loadCredential("/auth", undefined, io, now))?.token).toBe("b")
})

test("unreadable directories and files yield no credential instead of throwing", async () => {
  expect(await loadCredential("/auth", undefined, { readdir: async () => { throw new Error("ENOENT") }, readFile: async () => "" })).toBeUndefined()
  const io = memory({ "claude-a.json": file({ access_token: "a" }), "claude-b.json": file({ access_token: "b" }) }, new Set(["claude-a.json"]))
  expect((await loadCredential("/auth", undefined, io, now))?.token).toBe("b")
  expect(await loadCredential("/auth", undefined, memory({ "claude-a.json": file({ access_token: "" }) }), now)).toBeUndefined()
})

test("reads real files from disk", async () => {
  const dir = await mkdtemp(join(tmpdir(), "claude-auth-"))
  try {
    await chmod(dir, 0o700)
    await writeFile(join(dir, "claude-x.json"), file({ access_token: "disk" }))
    expect((await loadCredential(dir, undefined, undefined, now))?.token).toBe("disk")
    expect(await loadCredential(join(dir, "missing"), undefined, undefined, now)).toBeUndefined()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
