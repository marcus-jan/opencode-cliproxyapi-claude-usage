import { homedir } from "node:os"
import { join } from "node:path"

export const LINE_IDS = [
  "title", "usage", "session", "weekly", "opus", "sonnet", "spend", "reset", "account", "organization", "updated",
] as const
export type LineID = typeof LINE_IDS[number]
export type Surface = { enabled: boolean; lines: LineID[] }
export type Options = {
  authDir: string
  cacheDir: string | false
  account?: string
  providers: string[]
  refreshSeconds: number
  colors: { mode: "theme" | "muted" | "inherit"; warningAt: number; criticalAt: number }
  display: { sidebar: Surface; home: Surface }
}

export const DEFAULT_PROVIDERS = ["claude-local"]
export const defaultAuthDir = () => join(homedir(), ".config", "cliproxyapi", "auth")
export const defaultCacheDir = () => join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "opencode-claude-usage")

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)
const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined

function surface(value: unknown, defaults: LineID[]): Surface {
  const input = record(value)
  return {
    enabled: typeof input.enabled === "boolean" ? input.enabled : true,
    lines: Array.isArray(input.lines)
      ? [...new Set(input.lines.filter((id): id is LineID => LINE_IDS.includes(id as LineID)))]
      : [...defaults],
  }
}

function expand(path: string): string {
  if (path === "~") return homedir()
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path
}

/** Treat plugin configuration as untrusted; never log raw options. */
export function normalizeOptions(value: unknown): Options {
  const input = record(value)
  const colors = record(input.colors)
  const display = record(input.display)
  const warning = colors.warningAt === undefined ? 75 : colors.warningAt
  const critical = colors.criticalAt === undefined ? 90 : colors.criticalAt
  const valid = finite(warning) && finite(critical) && warning >= 0 && warning < critical && critical <= 100
  const providers = Array.isArray(input.providers)
    ? [...new Set(input.providers.map(text).filter((id): id is string => id !== undefined))]
    : []
  const authDir = text(input.authDir)
  const cacheDir = text(input.cacheDir)
  return {
    authDir: authDir ? expand(authDir) : defaultAuthDir(),
    cacheDir: input.cacheDir === false ? false : cacheDir ? expand(cacheDir) : defaultCacheDir(),
    account: text(input.account)?.toLowerCase(),
    providers: providers.length > 0 ? providers : [...DEFAULT_PROVIDERS],
    refreshSeconds: finite(input.refreshSeconds) ? Math.max(60, input.refreshSeconds) : 300,
    colors: {
      mode: colors.mode === "muted" || colors.mode === "inherit" ? colors.mode : "theme",
      warningAt: valid ? warning : 75,
      criticalAt: valid ? critical : 90,
    },
    display: {
      sidebar: surface(display.sidebar, ["title", "usage", "weekly", "reset"]),
      home: surface(display.home, ["usage"]),
    },
  }
}

export const enabled = (surface: Surface) => surface.enabled && surface.lines.length > 0
