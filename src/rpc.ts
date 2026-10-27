import { Rpc } from "@opencode/plugin/rpc"

export const ClaudeUsage = Rpc.define({
  id: "claude-usage-sidebar",
  events: {},
  methods: {
    get: {
      input: {
        type: "object",
        properties: { refresh: { type: "boolean" } },
        additionalProperties: false,
      },
      output: { type: "object" },
    },
  },
})
