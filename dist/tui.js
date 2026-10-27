// @bun
// src/tui.tsx
import { memo as _$memo } from "opentui:runtime-module:%40opentui%2Fsolid";
import { setProp as _$setProp } from "opentui:runtime-module:%40opentui%2Fsolid";
import { effect as _$effect } from "opentui:runtime-module:%40opentui%2Fsolid";
import { insert as _$insert } from "opentui:runtime-module:%40opentui%2Fsolid";
import { createElement as _$createElement } from "opentui:runtime-module:%40opentui%2Fsolid";
import { createComponent as _$createComponent } from "opentui:runtime-module:%40opentui%2Fsolid";
import { Plugin } from "@opencode/plugin/tui";
import { createEffect, createRoot, createSignal, For, Show } from "opentui:runtime-module:solid-js";

// src/rpc.ts
import { Rpc } from "@opencode/plugin/rpc";
var ClaudeUsage = Rpc.define({
  id: "claude-usage-sidebar",
  events: {},
  methods: {
    get: {
      input: {
        type: "object",
        properties: {
          refresh: {
            type: "boolean"
          }
        },
        additionalProperties: false
      },
      output: {
        type: "object"
      }
    }
  }
});

// src/options.ts
import { homedir } from "os";
import { join } from "path";
var LINE_IDS = ["title", "usage", "session", "weekly", "opus", "sonnet", "spend", "reset", "account", "organization", "updated"];
var DEFAULT_PROVIDERS = ["claude-local"];
var defaultAuthDir = () => join(homedir(), ".config", "cliproxyapi", "auth");
var record = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
var finite = (value) => typeof value === "number" && Number.isFinite(value);
var text = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
function surface(value, defaults) {
  const input = record(value);
  return {
    enabled: typeof input.enabled === "boolean" ? input.enabled : true,
    lines: Array.isArray(input.lines) ? [...new Set(input.lines.filter((id) => LINE_IDS.includes(id)))] : [...defaults]
  };
}
function expand(path) {
  if (path === "~")
    return homedir();
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}
function normalizeOptions(value) {
  const input = record(value);
  const colors = record(input.colors);
  const display = record(input.display);
  const warning = colors.warningAt === undefined ? 75 : colors.warningAt;
  const critical = colors.criticalAt === undefined ? 90 : colors.criticalAt;
  const valid = finite(warning) && finite(critical) && warning >= 0 && warning < critical && critical <= 100;
  const providers = Array.isArray(input.providers) ? [...new Set(input.providers.map(text).filter((id) => id !== undefined))] : [];
  const authDir = text(input.authDir);
  return {
    authDir: authDir ? expand(authDir) : defaultAuthDir(),
    account: text(input.account)?.toLowerCase(),
    providers: providers.length > 0 ? providers : [...DEFAULT_PROVIDERS],
    refreshSeconds: finite(input.refreshSeconds) ? Math.max(30, input.refreshSeconds) : 60,
    colors: {
      mode: colors.mode === "muted" || colors.mode === "inherit" ? colors.mode : "theme",
      warningAt: valid ? warning : 75,
      criticalAt: valid ? critical : 90
    },
    display: {
      sidebar: surface(display.sidebar, ["title", "usage", "weekly", "reset"]),
      home: surface(display.home, ["usage"])
    }
  };
}
var enabled = (surface2) => surface2.enabled && surface2.lines.length > 0;

// src/usage.ts
function isClaude(providerID, providers) {
  return providerID !== undefined && providers.includes(providerID);
}
function unavailable(message) {
  return {
    fetchedAt: Date.now(),
    error: message
  };
}
var percent = (value) => value === undefined ? "?" : `${Math.round(value)}%`;
function amount(value, currency) {
  if (value === undefined)
    return "?";
  try {
    return value.toLocaleString("en-US", {
      style: "currency",
      currency
    });
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}
function resetTime(value, now = Date.now()) {
  if (!value)
    return;
  const at = Date.parse(value);
  if (!Number.isFinite(at))
    return;
  const minutes = Math.max(0, Math.round((at - now) / 60000));
  if (minutes < 60)
    return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48)
    return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
function spendSummary(spend) {
  const limit = spend.limit === undefined ? "" : ` / ${amount(spend.limit, spend.currency)}`;
  return `${amount(spend.used, spend.currency)}${limit} extra usage`;
}
function summary(usage) {
  if (!usage)
    return "Claude: loading usage\u2026";
  if (usage.error)
    return `Claude: ${usage.error}`;
  if (usage.fiveHour) {
    const weekly = usage.sevenDay ? ` \xB7 ${percent(usage.sevenDay.utilization)} weekly` : "";
    return `Claude: ${percent(usage.fiveHour.utilization)} of 5h limit${weekly}`;
  }
  if (usage.sevenDay)
    return `Claude: ${percent(usage.sevenDay.utilization)} weekly`;
  if (usage.spend?.enabled)
    return `Claude: ${spendSummary(usage.spend)}`;
  return "Claude: no usage reported";
}
function percentUsed(usage) {
  if (!usage || usage.error)
    return;
  const values = [usage.fiveHour?.utilization, usage.sevenDay?.utilization];
  if (!usage.fiveHour && !usage.sevenDay)
    values.push(usage.spend?.percent);
  const known = values.filter((value) => value !== undefined);
  return known.length === 0 ? undefined : Math.max(...known);
}
function severity(usage, warningAt = 75, criticalAt = 90) {
  if (usage?.error)
    return "warning";
  const used = percentUsed(usage);
  if (used === undefined)
    return "normal";
  return used >= criticalAt ? "error" : used >= warningAt ? "warning" : "normal";
}
var windowDetail = (label, window, now) => {
  if (!window)
    return [];
  const reset = resetTime(window.resetsAt, now);
  return [`${label}: ${percent(window.utilization)} used${reset ? ` \xB7 resets in ${reset}` : ""}`];
};
function details(usage, now = Date.now()) {
  if (!usage || usage.error)
    return [summary(usage)];
  return [summary(usage), ...usage.account ? [`Account: ${usage.account}`] : [], ...usage.organization ? [`Organization: ${usage.organization}`] : [], ...windowDetail("Session (5h)", usage.fiveHour, now), ...windowDetail("Weekly", usage.sevenDay, now), ...windowDetail("Weekly Opus", usage.sevenDayOpus, now), ...windowDetail("Weekly Sonnet", usage.sevenDaySonnet, now), ...usage.spend?.enabled ? [`Extra usage: ${spendSummary(usage.spend)}${usage.spend.percent === undefined ? "" : ` \xB7 ${usage.spend.percent.toFixed(1)}%`}`] : [], `Updated: ${new Date(usage.fetchedAt).toLocaleTimeString()}`];
}

// src/presentation.ts
var used = (window) => window ? `${percent(window.utilization)} used` : undefined;
function displayLines(usage, surface2, home = false, now = Date.now()) {
  if (!enabled(surface2))
    return [];
  const reported = usage && !usage.error && (usage.fiveHour || usage.sevenDay || usage.spend?.enabled);
  const status = !reported;
  const line = (id) => {
    if (id === "title")
      return {
        id,
        segments: [{
          text: "Claude usage",
          role: "heading"
        }]
      };
    if (id === "usage")
      return {
        id,
        segments: [...home ? [{
          text: "Claude: ",
          role: "label"
        }] : [], {
          text: summary(usage).replace(/^Claude: /, ""),
          role: "quota"
        }]
      };
    if (!usage || usage.error)
      return;
    const reset = resetTime(usage.fiveHour?.resetsAt, now);
    const weekly = resetTime(usage.sevenDay?.resetsAt, now);
    const values = {
      session: ["Session", used(usage.fiveHour)],
      weekly: ["Weekly", used(usage.sevenDay) && weekly ? `${used(usage.sevenDay)} \xB7 ${weekly}` : used(usage.sevenDay)],
      opus: ["Opus", used(usage.sevenDayOpus)],
      sonnet: ["Sonnet", used(usage.sevenDaySonnet)],
      spend: ["Extra", usage.spend?.enabled ? spendSummary(usage.spend).replace(/ extra usage$/, "") : undefined],
      reset: ["Resets", reset ? `in ${reset}` : undefined],
      account: ["Account", usage.account],
      organization: ["Org", usage.organization],
      updated: ["Updated", new Date(usage.fetchedAt).toLocaleTimeString()]
    };
    const value = values[id];
    return value?.[1] ? {
      id,
      segments: [{
        text: `${value[0]}: `,
        role: "label"
      }, {
        text: value[1],
        role: "value"
      }]
    } : undefined;
  };
  const lines = surface2.lines.map(line).filter((value) => value !== undefined);
  if (status && !surface2.lines.includes("usage"))
    lines.push(line("usage"));
  return lines;
}

// src/tui.tsx
var tui_default = Plugin.define({
  id: "claude-usage-sidebar.tui",
  setup(context) {
    const rpc = context.client.rpc(ClaudeUsage);
    const [usage, setUsage] = createSignal();
    const options = normalizeOptions(context.options);
    const active = () => isClaude(context.ui.model.current()?.providerID, options.providers);
    const [dimensions, setDimensions] = createSignal({
      width: context.renderer.width,
      height: context.renderer.height
    });
    const resize = (width, height) => setDimensions({
      width,
      height
    });
    context.renderer.on("resize", resize);
    const automatic = () => active() && (enabled(options.display.sidebar) || enabled(options.display.home));
    let disposed = false;
    let pending;
    let turnTimer;
    function refresh(force = false) {
      if (disposed || !active())
        return Promise.resolve();
      if (pending)
        return pending;
      pending = rpc.get({
        refresh: force
      }).then((result) => {
        if (!disposed && active())
          setUsage(result);
      }).catch(() => {
        if (!disposed && active())
          setUsage(unavailable("Usage service unavailable; enable the server plugin"));
      }).finally(() => {
        pending = undefined;
      });
      return pending;
    }
    const stopModel = createRoot((dispose) => {
      createEffect(() => {
        const providerID = context.ui.model.current()?.providerID;
        if (isClaude(providerID, options.providers) && automatic())
          refresh();
        else
          setUsage(undefined);
      });
      return dispose;
    });
    const timer = setInterval(() => {
      if (automatic())
        refresh();
    }, options.refreshSeconds * 1000);
    const stopTurn = context.data.on("session.execution.succeeded", (event) => {
      const route = context.ui.router.current();
      if (!automatic() || route.type !== "session" || event.data.sessionID !== route.sessionID)
        return;
      clearTimeout(turnTimer);
      turnTimer = setTimeout(() => {
        if (automatic())
          refresh(true);
      }, 3000);
    });
    const color = (role) => {
      if (options.colors.mode === "inherit")
        return;
      if (options.colors.mode === "muted" || role === "label")
        return context.theme.text.muted;
      const level = severity(usage(), options.colors.warningAt, options.colors.criticalAt);
      return role === "quota" && level !== "normal" ? context.theme.text.feedback[level].base : context.theme.text.base;
    };
    const Lines = (props) => _$createComponent(For, {
      get each() {
        return props.lines;
      },
      children: (line) => (() => {
        var _el$ = _$createElement("text");
        _$insert(_el$, _$createComponent(For, {
          get each() {
            return line.segments;
          },
          children: (segment) => (() => {
            var _el$2 = _$createElement("span");
            _$insert(_el$2, _$createComponent(Show, {
              get when() {
                return segment.role === "heading";
              },
              get fallback() {
                return segment.text;
              },
              get children() {
                var _el$3 = _$createElement("b");
                _$insert(_el$3, () => segment.text);
                return _el$3;
              }
            }));
            _$effect((_$p) => _$setProp(_el$2, "style", {
              fg: color(segment.role)
            }, _$p));
            return _el$2;
          })()
        }));
        return _el$;
      })()
    });
    const sidebarLines = () => displayLines(usage(), options.display.sidebar);
    const homeLines = () => displayLines(usage(), options.display.home, true);
    context.ui.slot({
      append: "sidebar.content",
      render: () => _$createComponent(Show, {
        get when() {
          return _$memo(() => !!active())() && sidebarLines().length > 0;
        },
        get children() {
          var _el$4 = _$createElement("box");
          _$setProp(_el$4, "flexDirection", "column");
          _$setProp(_el$4, "flexShrink", 0);
          _$insert(_el$4, _$createComponent(Lines, {
            get lines() {
              return sidebarLines();
            }
          }));
          return _el$4;
        }
      })
    });
    context.ui.slot({
      prepend: "home.footer",
      render: () => {
        const spacing = () => dimensions().height >= 16 && dimensions().width >= 44 ? -1 : 0;
        return _$createComponent(Show, {
          get when() {
            return _$memo(() => !!active())() && homeLines().length > 0;
          },
          get children() {
            var _el$5 = _$createElement("box");
            _$setProp(_el$5, "flexDirection", "column");
            _$setProp(_el$5, "paddingLeft", 2);
            _$setProp(_el$5, "paddingRight", 2);
            _$setProp(_el$5, "flexShrink", 0);
            _$insert(_el$5, _$createComponent(Lines, {
              get lines() {
                return homeLines();
              }
            }));
            _$effect((_$p) => _$setProp(_el$5, "marginBottom", spacing(), _$p));
            return _el$5;
          }
        });
      }
    });
    context.keymap.layer(() => ({
      mode: "global",
      commands: [{
        id: "claude-usage-sidebar.show",
        title: "Show Claude account usage",
        group: "Claude",
        palette: true,
        enabled: active,
        slash: {
          name: "claude-usage"
        },
        run: async () => {
          if (disposed || !active())
            return;
          await refresh(true);
          if (!disposed)
            await context.ui.dialog.alert({
              title: "Claude account usage",
              message: details(usage()).join(`
`)
            });
        }
      }]
    }));
    return () => {
      disposed = true;
      stopModel();
      clearInterval(timer);
      clearTimeout(turnTimer);
      context.renderer.off("resize", resize);
      stopTurn();
    };
  }
});
export {
  tui_default as default
};
