# opencode-cliproxyapi-claude-usage

OpenCode plugin that shows Claude subscription usage in the sidebar and on the home screen when the active model is served through a local [cliproxyapi](https://github.com/router-for-me/CLIProxyAPI) Claude login.

It reads the OAuth access token that cliproxyapi already keeps on disk, asks Anthropic's `api/oauth/usage` endpoint for the account's rate-limit windows, and renders:

- **Pro/Max accounts** — 5-hour session utilization, 7-day utilization (plus Opus/Sonnet model windows when reported) and reset countdowns.
- **Team/Enterprise (org-managed) accounts** — Anthropic reports no windows, so the plugin falls back to the *extra usage* spend (`$used / $limit`).

Sidebar (Pro/Max):

```
Claude usage
42% of 5h limit · 61% weekly
Weekly: 61% used · 3d 0h
Resets: in 2h 30m
```

Home footer (org-managed):

```
Claude: $5.96 / $1,500.00 extra usage
```

A `/claude-usage` slash command (also in the command palette) force-refreshes and opens a dialog with the full breakdown.

## Requirements

- OpenCode 2.1.4 or newer (same host APIs as the Copilot usage sidebar).
- cliproxyapi with a Claude OAuth login. The plugin reads `claude-*.json` from the proxy's auth directory (default `~/.config/cliproxyapi/auth`).
- An OpenCode provider pointing at the proxy. The provider id defaults to `claude-local`; configure `providers` if yours differs.

## Install

```jsonc
// ~/.config/opencode/opencode.json
{
  "plugin": [
    {
      "package": "github:marcus-jan/opencode-cliproxyapi-claude-usage#v0.3.0",
      "options": {
        "refreshSeconds": 120,
        "display": {
          "sidebar": { "lines": ["title", "usage", "weekly", "spend", "reset"] },
          "home": { "lines": ["usage"] }
        }
      }
    }
  ]
}
```

Use `#latest` instead of a tag to track the newest release. `latest` is a moving git tag that is re-pointed on every release (`git tag -f latest vX.Y.Z^{} && git push -f origin latest`); OpenCode resolves it as an ordinary git ref. The TUI bundle in `dist/` is committed, so GitHub installs need no build step.

For local development point `package` at the checkout directory, run `bun install --frozen-lockfile` and `bun run build:tui`.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `authDir` | `~/.config/cliproxyapi/auth` | Directory holding the proxy's `claude-*.json` login files. `~` is expanded. |
| `cacheDir` | `$XDG_CACHE_HOME/opencode-claude-usage` (`~/.cache/...`) | Where readings are shared between OpenCode server instances and restarts. Set to `false` for memory-only caching. |
| `account` | first live login | Email of the login to use when several Claude accounts are logged in. |
| `providers` | `["claude-local"]` | OpenCode provider ids that route to the proxy. Usage shows only while one of them is selected. |
| `refreshSeconds` | `300` (min 60) | Automatic poll interval. A forced refresh also runs 3s after each completed turn in the current session, but never more than once a minute. |
| `colors.mode` | `"theme"` | `theme` colors the usage line by severity; `muted` uses the muted text color; `inherit` sets no colors. |
| `colors.warningAt` / `colors.criticalAt` | `75` / `90` | Utilization thresholds (percent). The higher of the session and weekly windows drives severity; spend-only accounts use spend percent. |
| `display.sidebar` | `{ enabled: true, lines: ["title", "usage", "weekly", "reset"] }` | Sidebar surface. |
| `display.home` | `{ enabled: true, lines: ["usage"] }` | Home-screen footer surface. Lines render in the listed order. |

Line ids:

| Id | Content |
| --- | --- |
| `title` | `Claude usage` heading |
| `usage` | One-line summary (`42% of 5h limit · 61% weekly`, or `$5.96 / $1,500.00 extra usage`) |
| `session` | `Session: 42% used` |
| `weekly` | `Weekly: 61% used · 3d 0h` |
| `opus` / `sonnet` | Per-model weekly windows when Anthropic reports them |
| `spend` | `Extra: $5.96 / $1,500.00` |
| `reset` | `Resets: in 2h 30m` (5-hour window) |
| `account` / `organization` | Login email / organization name from the proxy auth file |
| `updated` | Local time of the last fetch |

Lines whose value is unknown are skipped. If a surface is enabled but has no `usage` line, loading and error states are still shown so failures are never silent.

## Privacy

- The access token is read from disk by the server plugin only, kept in memory, and used solely for the `Authorization` header to `https://api.anthropic.com/api/oauth/usage`.
- It never crosses the TUI RPC boundary, is never logged, and never appears in error messages; HTTP failures surface only as status codes.
- The cache key is a SHA-256 of the token so a proxy-side token refresh triggers a fresh fetch.
- Responses are cached for 60 seconds per account; forced refreshes are deduplicated within 60 seconds.
- The cache file under `cacheDir` (mode 0600) contains only what the sidebar displays plus backoff state; its name is a prefix of the token hash. It never contains the token.

## Rate limiting

Anthropic throttles `api/oauth/usage` aggressively (HTTP 429, often for many minutes). The plugin treats this as routine:

- The last successful reading keeps being displayed; the detail dialog marks it `(stale: …)` with the reason.
- After a failure the server backs off exponentially (1 min doubling to 15 min, or longer if `Retry-After` says so). Polls and forced refreshes during the backoff are served from cache and make no request.
- OpenCode runs one server plugin instance per open workspace. They share one reading and one backoff timer through `cacheDir`, so opening five workspaces (or restarting) does not multiply requests.
- A plain error is shown only when no good reading has been obtained yet.

## Development

```sh
bun install
bun run check   # build dist/tui.js, typecheck, run tests
```

Tests cover option parsing, auth-file selection, response parsing (Pro/Max windows and org-managed spend), the server RPC handler, presentation, and the real OpenTUI render path, including a packaged-startup smoke test.

## License

MIT. Structure adapted from [opencode-copilot-usage](https://github.com/marcus-jan/opencode-copilot-usage).
