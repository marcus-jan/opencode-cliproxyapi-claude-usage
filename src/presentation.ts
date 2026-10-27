import { enabled, type LineID, type Surface } from "./options"
import { percent, resetTime, spendSummary, summary, type Usage, type Window } from "./usage"

export type Role = "heading" | "label" | "value" | "quota"
export type Segment = { text: string; role: Role }
export type Line = { id: LineID; segments: Segment[] }

const used = (window: Window | undefined) => window ? `${percent(window.utilization)} used` : undefined

/** Pure presentation model; neither theme tokens nor credentials belong here. */
export function displayLines(usage: Usage | undefined, surface: Surface, home = false, now = Date.now()): Line[] {
  if (!enabled(surface)) return []
  const reported = usage && !usage.error && (usage.fiveHour || usage.sevenDay || usage.spend?.enabled)
  const status = !reported
  const line = (id: LineID): Line | undefined => {
    if (id === "title") return { id, segments: [{ text: "Claude usage", role: "heading" }] }
    if (id === "usage") return { id, segments: [
      ...(home ? [{ text: "Claude: ", role: "label" as const }] : []),
      { text: summary(usage).replace(/^Claude: /, ""), role: "quota" },
    ] }
    if (!usage || usage.error) return undefined
    const reset = resetTime(usage.fiveHour?.resetsAt, now)
    const weekly = resetTime(usage.sevenDay?.resetsAt, now)
    const values: Partial<Record<LineID, [string, string | undefined]>> = {
      session: ["Session", used(usage.fiveHour)],
      weekly: ["Weekly", used(usage.sevenDay) && weekly ? `${used(usage.sevenDay)} · ${weekly}` : used(usage.sevenDay)],
      opus: ["Opus", used(usage.sevenDayOpus)],
      sonnet: ["Sonnet", used(usage.sevenDaySonnet)],
      spend: ["Extra", usage.spend?.enabled ? spendSummary(usage.spend).replace(/ extra usage$/, "") : undefined],
      reset: ["Resets", reset ? `in ${reset}` : undefined],
      account: ["Account", usage.account],
      organization: ["Org", usage.organization],
      updated: ["Updated", new Date(usage.fetchedAt).toLocaleTimeString()],
    }
    const value = values[id]
    return value?.[1] ? { id, segments: [
      { text: `${value[0]}: `, role: "label" }, { text: value[1], role: "value" },
    ] } : undefined
  }
  const lines = surface.lines.map(line).filter((value): value is Line => value !== undefined)
  // An enabled surface must not silently hide loading, missing usage, or failures.
  if (status && !surface.lines.includes("usage")) lines.push(line("usage")!)
  return lines
}
