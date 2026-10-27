import { createHash } from "node:crypto"
import { Plugin } from "@opencode/plugin"
import { loadCredential } from "./auth"
import { createUsageCache } from "./cache"
import { normalizeOptions } from "./options"
import { ClaudeUsage } from "./rpc"
import { createFileStore } from "./store"
import { fetchUsage, unavailable } from "./usage"

export default Plugin.define({
  id: "claude-usage-sidebar",
  async setup(context) {
    const options = normalizeOptions(context.options)
    const cache = createUsageCache(undefined, undefined, undefined, options.cacheDir ? createFileStore(options.cacheDir) : undefined)
    const controller = new AbortController()
    await context.rpc.register(ClaudeUsage, {
      get: async (input) => {
        try {
          const credential = await loadCredential(options.authDir, options.account)
          if (!credential) return unavailable("No Claude login found in the cliproxyapi auth directory")
          const { token, account, organization } = credential
          // Fingerprint only in RAM. Credentials never cross RPC or enter persistent storage.
          const key = createHash("sha256").update(token).digest("hex")
          const force = (input as { refresh?: boolean }).refresh === true
          return await cache.get(key, () => fetchUsage(token, { account, organization }, fetch, controller.signal), force)
        } catch {
          return unavailable("Could not read the Claude credential")
        }
      },
    })
    return () => controller.abort()
  },
})
