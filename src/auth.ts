import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

export type Credential = { token: string; account?: string; organization?: string; expired?: number }
export type AuthFs = {
  readdir: (dir: string) => Promise<string[]>
  readFile: (path: string) => Promise<string>
}

const FILE = /^claude-.*\.json$/
const fs: AuthFs = {
  readdir: (dir) => readdir(dir),
  readFile: (path) => readFile(path, "utf8"),
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function parse(text: string): Credential | undefined {
  let body: Record<string, unknown>
  try {
    body = record(JSON.parse(text))
  } catch {
    return undefined
  }
  if (body.type !== "claude" || body.disabled === true) return undefined
  const token = string(body.access_token)
  if (!token) return undefined
  const expired = Date.parse(string(body.expired) ?? "")
  return {
    token,
    account: string(body.email),
    organization: string(body.organization_name),
    expired: Number.isFinite(expired) ? expired : undefined,
  }
}

/**
 * Reads the Claude OAuth credential cliproxyapi keeps on disk. The token stays
 * in RAM; callers must never log it or send it over RPC.
 */
export async function loadCredential(
  dir: string,
  account?: string,
  io: AuthFs = fs,
  now = Date.now(),
): Promise<Credential | undefined> {
  let names: string[]
  try {
    names = (await io.readdir(dir)).filter((name) => FILE.test(name)).sort()
  } catch {
    return undefined
  }
  const found: Credential[] = []
  for (const name of names) {
    let text: string
    try {
      text = await io.readFile(join(dir, name))
    } catch {
      continue
    }
    const credential = parse(text)
    if (!credential) continue
    if (account && credential.account?.toLowerCase() !== account) continue
    found.push(credential)
  }
  // Prefer a token the proxy has not yet marked as expired; fall back to the first match.
  return found.find((credential) => credential.expired === undefined || credential.expired > now) ?? found[0]
}
