/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { createEffect, createRoot, createSignal, For, Show } from "solid-js"
import { ClaudeUsage } from "./rpc"
import { enabled, normalizeOptions } from "./options"
import { displayLines, type Line, type Role } from "./presentation"
import { details, isClaude, severity, unavailable, type Usage } from "./usage"

export default Plugin.define({
  id: "claude-usage-sidebar.tui",
  setup(context) {
    const rpc = context.client.rpc(ClaudeUsage)
    const [usage, setUsage] = createSignal<Usage>()
    // Options configured in cli.json arrive here. Plugins configured in opencode.json
    // load their TUI with empty options, so ask the server half for its options.
    const local = Object.keys(context.options ?? {}).length > 0
    const [options, setOptions] = createSignal(normalizeOptions(context.options), {
      equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    })
    const active = () => isClaude(context.ui.model.current()?.providerID, options().providers)
    // Packaged slots need not share OpenTUI's ambient RendererContext. Use the
    // renderer supplied by the plugin host instead of renderer-context hooks.
    const [dimensions, setDimensions] = createSignal({ width: context.renderer.width, height: context.renderer.height })
    const resize = (width: number, height: number) => setDimensions({ width, height })
    context.renderer.on("resize", resize)
    const automatic = () => active() && (enabled(options().display.sidebar) || enabled(options().display.home))
    let disposed = false
    let pending: Promise<void> | undefined
    let turnTimer: ReturnType<typeof setTimeout> | undefined

    function loadOptions(): Promise<void> {
      if (local) return Promise.resolve()
      return Promise.resolve().then(() => rpc.options({})).then((result) => {
        if (!disposed) setOptions(normalizeOptions(result))
      }).catch(() => {})
    }

    function refresh(force = false): Promise<void> {
      if (disposed || !active()) return Promise.resolve()
      if (pending) return pending
      pending = rpc.get({ refresh: force }).then((result) => {
        if (!disposed && active()) setUsage(result as Usage)
      }).catch(() => {
        if (!disposed && active()) setUsage(unavailable("Usage service unavailable; enable the server plugin"))
      }).finally(() => { pending = undefined })
      return pending
    }

    // setup has no Solid owner. Own this effect explicitly and dispose on unload.
    // Refresh immediately when switching to Claude, not just at the next poll.
    const stopModel = createRoot((dispose) => {
      createEffect(() => {
        const providerID = context.ui.model.current()?.providerID
        if (isClaude(providerID, options().providers) && automatic()) void refresh()
        else setUsage(undefined)
      })
      return dispose
    })
    let timer: ReturnType<typeof setInterval> | undefined
    const stopTimer = createRoot((dispose) => {
      createEffect(() => {
        const seconds = options().refreshSeconds
        clearInterval(timer)
        timer = setInterval(() => {
          if (local) { if (automatic()) void refresh(); return }
          void loadOptions().then(() => { if (automatic()) void refresh() })
        }, seconds * 1000)
      })
      return dispose
    })
    void loadOptions()
    const stopTurn = context.data.on("session.execution.succeeded", (event) => {
      const route = context.ui.router.current()
      if (!automatic() || route.type !== "session" || event.data.sessionID !== route.sessionID) return
      clearTimeout(turnTimer)
      turnTimer = setTimeout(() => { if (automatic()) void refresh(true) }, 3_000)
    })

    const color = (role: Role) => {
      if (options().colors.mode === "inherit") return undefined
      if (options().colors.mode === "muted" || role === "label") return context.theme.text.muted
      const level = severity(usage(), options().colors.warningAt, options().colors.criticalAt)
      return role === "quota" && level !== "normal" ? context.theme.text.feedback[level].base : context.theme.text.base
    }
    const Lines = (props: { lines: Line[] }) => <For each={props.lines}>{(line) => (
      <text><For each={line.segments}>{(segment) => (
        <span style={{ fg: color(segment.role) }}><Show when={segment.role === "heading"} fallback={segment.text}><b>{segment.text}</b></Show></span>
      )}</For></text>
    )}</For>
    const sidebarLines = () => displayLines(usage(), options().display.sidebar)
    const homeLines = () => displayLines(usage(), options().display.home, true)

    // Additive: no replace claims, host lookups, or mutation of the built-in layout.
    context.ui.slot({
      append: "sidebar.content",
      render: () => (
        <Show when={active() && sidebarLines().length > 0}>
          <box flexDirection="column" flexShrink={0}>
            <Lines lines={sidebarLines()} />
          </box>
        </Show>
      ),
    })

    // home.footer is a vertical region; prepending creates a genuinely separate
    // line ABOVE the bottom health/version row, not another item in that row.
    context.ui.slot({
      prepend: "home.footer",
      render: () => {
        // The built-in footer has one top padding row at height >= 16 and is
        // hidden below width 44. Consume only that spacer using our own margin.
        const spacing = () => dimensions().height >= 16 && dimensions().width >= 44 ? -1 : 0
        return (
          <Show when={active() && homeLines().length > 0}>
            <box flexDirection="column" paddingLeft={2} paddingRight={2} marginBottom={spacing()} flexShrink={0}>
              <Lines lines={homeLines()} />
            </box>
          </Show>
        )
      },
    })

    context.keymap.layer(() => ({
      mode: "global",
      commands: [{
        id: "claude-usage-sidebar.show",
        title: "Show Claude account usage",
        group: "Claude",
        palette: true,
        enabled: active,
        slash: { name: "claude-usage" },
        run: async () => {
          if (disposed || !active()) return
          await refresh(true)
          if (!disposed) await context.ui.dialog.alert({ title: "Claude account usage", message: details(usage()).join("\n") })
        },
      }],
    }))

    return () => {
      disposed = true
      stopModel()
      stopTimer()
      clearInterval(timer)
      clearTimeout(turnTimer)
      context.renderer.off("resize", resize)
      stopTurn()
    }
  },
})
