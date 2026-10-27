export const USAGE_URL = "https://api.anthropic.com/api/oauth/usage"

export type Window = { utilization: number; resetsAt?: string }
export type Spend = { used: number; limit?: number; currency: string; percent?: number; enabled: boolean }

export type Usage = {
  fetchedAt: number
  account?: string
  organization?: string
  fiveHour?: Window
  sevenDay?: Window
  sevenDayOpus?: Window
  sevenDaySonnet?: Window
  spend?: Spend
  error?: string
  /** Set when a fresh fetch failed and these are the last good numbers. */
  stale?: string
  /** Epoch ms before which the endpoint asked us not to retry. */
  retryAt?: number
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

// The RPC output validator rejects `undefined` values, so optional keys must be absent rather than undefined.
function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T
}

function window(value: unknown): Window | undefined {
  const input = record(value)
  const utilization = number(input.utilization)
  if (utilization === undefined) return undefined
  return compact({ utilization: Math.min(100, utilization), resetsAt: string(input.resets_at) })
}

function money(value: unknown, fallbackExponent: number): number | undefined {
  const input = record(value)
  const minor = number(input.amount_minor)
  if (minor === undefined) return undefined
  const exponent = number(input.exponent) ?? fallbackExponent
  return minor / 10 ** exponent
}

function spend(body: Record<string, unknown>): Spend | undefined {
  const extra = record(body.extra_usage)
  const reported = record(body.spend)
  const exponent = number(extra.decimal_places) ?? 2
  const currency = string(reported.currency) ?? string(extra.currency) ?? "USD"
  const enabled = reported.enabled === true || extra.is_enabled === true
  const used = money(reported.used, exponent) ?? (
    number(extra.used_credits) === undefined ? undefined : number(extra.used_credits)! / 10 ** exponent
  )
  const limit = money(reported.limit, exponent) ?? (
    number(extra.monthly_limit) === undefined ? undefined : number(extra.monthly_limit)! / 10 ** exponent
  )
  if (used === undefined && limit === undefined && !enabled) return undefined
  const percent = number(extra.utilization) ?? (
    used !== undefined && limit !== undefined && limit > 0 ? used / limit * 100 : number(reported.percent)
  )
  return compact({ used: used ?? 0, limit, currency, percent: percent === undefined ? undefined : Math.min(100, percent), enabled })
}

export function parseUsage(value: unknown, now = Date.now(), identity: { account?: string; organization?: string } = {}): Usage {
  const body = record(value)
  if (Object.keys(body).length === 0) throw new Error("Invalid usage response")
  return compact({
    fetchedAt: now,
    account: identity.account,
    organization: identity.organization,
    fiveHour: window(body.five_hour),
    sevenDay: window(body.seven_day),
    sevenDayOpus: window(body.seven_day_opus),
    sevenDaySonnet: window(body.seven_day_sonnet),
    spend: spend(body),
  })
}

export function isClaude(providerID: string | undefined, providers: readonly string[]): boolean {
  return providerID !== undefined && providers.includes(providerID)
}

export function unavailable(message: string, retryAt?: number): Usage {
  return compact({ fetchedAt: Date.now(), error: message, retryAt })
}

function retryAfter(response: Response, now: number): number | undefined {
  const header = response.headers.get("retry-after")
  if (!header) return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return seconds > 0 ? now + seconds * 1000 : undefined
  const date = Date.parse(header)
  return Number.isNaN(date) || date <= now ? undefined : date
}

/** Claude OAuth access token read from the cliproxyapi auth store. Never return/log it. */
export async function fetchUsage(
  token: string,
  identity: { account?: string; organization?: string } = {},
  fetcher: (url: string, init: RequestInit) => Promise<Response> = fetch,
  signal?: AbortSignal,
): Promise<Usage> {
  try {
    const response = await fetcher(USAGE_URL, {
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
      redirect: "error",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
      },
    })
    // Do not surface response bodies or arbitrary exceptions: either may contain secrets.
    if (response.status === 401) return unavailable("Claude token expired or revoked; send a request through the proxy or log in again")
    if (response.status === 429) return unavailable("Claude usage rate limited; retrying later", retryAfter(response, Date.now()))
    if (!response.ok) return unavailable(`Claude usage unavailable (HTTP ${response.status})`)
    return parseUsage(await response.json(), Date.now(), identity)
  } catch {
    return unavailable("Could not retrieve Claude usage")
  }
}

export const percent = (value: number | undefined) => value === undefined ? "?" : `${Math.round(value)}%`

export function amount(value: number | undefined, currency: string): string {
  if (value === undefined) return "?"
  try {
    return value.toLocaleString("en-US", { style: "currency", currency })
  } catch {
    return `${value.toFixed(2)} ${currency}`
  }
}

export function resetTime(value: string | undefined, now = Date.now()): string | undefined {
  if (!value) return undefined
  const at = Date.parse(value)
  if (!Number.isFinite(at)) return undefined
  const minutes = Math.max(0, Math.round((at - now) / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

export function spendSummary(spend: Spend): string {
  const limit = spend.limit === undefined ? "" : ` / ${amount(spend.limit, spend.currency)}`
  return `${amount(spend.used, spend.currency)}${limit} extra usage`
}

export function summary(usage: Usage | undefined): string {
  if (!usage) return "Claude: loading usage…"
  if (usage.error) return `Claude: ${usage.error}`
  if (usage.fiveHour) {
    const weekly = usage.sevenDay ? ` · ${percent(usage.sevenDay.utilization)} weekly` : ""
    return `Claude: ${percent(usage.fiveHour.utilization)} of 5h limit${weekly}`
  }
  if (usage.sevenDay) return `Claude: ${percent(usage.sevenDay.utilization)} weekly`
  if (usage.spend?.enabled) return `Claude: ${spendSummary(usage.spend)}`
  return "Claude: no usage reported"
}

export function percentUsed(usage: Usage | undefined): number | undefined {
  if (!usage || usage.error) return undefined
  const values = [usage.fiveHour?.utilization, usage.sevenDay?.utilization]
  if (!usage.fiveHour && !usage.sevenDay) values.push(usage.spend?.percent)
  const known = values.filter((value): value is number => value !== undefined)
  return known.length === 0 ? undefined : Math.max(...known)
}

export function severity(usage: Usage | undefined, warningAt = 75, criticalAt = 90): "normal" | "warning" | "error" {
  if (usage?.error) return "warning"
  const used = percentUsed(usage)
  if (used === undefined) return "normal"
  return used >= criticalAt ? "error" : used >= warningAt ? "warning" : "normal"
}

const windowDetail = (label: string, window: Window | undefined, now: number) => {
  if (!window) return []
  const reset = resetTime(window.resetsAt, now)
  return [`${label}: ${percent(window.utilization)} used${reset ? ` · resets in ${reset}` : ""}`]
}

export function details(usage: Usage | undefined, now = Date.now()): string[] {
  if (!usage || usage.error) return [summary(usage)]
  return [
    summary(usage),
    ...(usage.account ? [`Account: ${usage.account}`] : []),
    ...(usage.organization ? [`Organization: ${usage.organization}`] : []),
    ...windowDetail("Session (5h)", usage.fiveHour, now),
    ...windowDetail("Weekly", usage.sevenDay, now),
    ...windowDetail("Weekly Opus", usage.sevenDayOpus, now),
    ...windowDetail("Weekly Sonnet", usage.sevenDaySonnet, now),
    ...(usage.spend?.enabled ? [`Extra usage: ${spendSummary(usage.spend)}${usage.spend.percent === undefined ? "" : ` · ${usage.spend.percent.toFixed(1)}%`}`] : []),
    `Updated: ${new Date(usage.fetchedAt).toLocaleTimeString()}${usage.stale ? ` (stale: ${usage.stale})` : ""}`,
  ]
}
