# Blentera governed tools in OpenClaw

The OpenClaw adapter requires the repository-owned `blentera-platform` extension for V10 headless tool execution. OpenClaw's stock `agent` request has no per-run MCP injection field, and `tools.catalog` is read-only. This extension therefore uses OpenClaw's documented plugin API to expose two fixed tools, `blentera_platform_list_tools` and `blentera_platform_call_tool`, and three versioned Gateway methods:

- `blentera.platform.bind.v1`
- `blentera.platform.status.v1`
- `blentera.platform.unbind.v1`

This is a Blentera extension protocol, not a stock OpenClaw Gateway method. The adapter checks that all three methods are advertised before dispatch. It waits for the accepted OpenClaw `runId`, binds that exact provider run to the exact agent and session, confirms the binding, and removes it after completion. Tools deny access until that handshake completes. A failed or missing extension cannot fall back to ungoverned tools.

## Authority and credential handling

The adapter passes the run's existing `paperclip-assigned` endpoint and bearer token to the extension over the authenticated Gateway WebSocket. The plugin accepts only HTTPS endpoints whose origin is in its explicit `paperclipApiOrigins` allowlist, and only the exact `/mcp/gateways/gw_*` route. Fetch redirects are rejected. The bearer remains in process memory and is never included in prompts, tool schemas, results, or logs.

At bind time, the plugin calls the authenticated MCP `initialize` and `tools/list` methods. The Gateway's `blentera/governed-run-binding.v1` metadata is reconstructed from the authenticated run-scoped bearer, current Run record, current Human, current Skill admission, current operation/catalog hashes, provider capability snapshot, selected Gateway profile, and immutable assignment digest. The adapter's claimed data must match. The Human identity is taken from server metadata, never from bind arguments. The plugin does not create its own grant or authorization ledger.

Each model tool call first uses the existing MCP `tools/list` endpoint to establish that the requested name remains visible, then forwards the call to the existing MCP `tools/call` endpoint. Tool Gateway checks current run status, responsible Human, token expiry/revocation, assigned-connection authorization, operation policy, and native-operation provenance on every request. OpenClaw tool context version 2 also asserts invocation currentness at the plugin boundary. Adapter completion unbinds immediately; if the adapter or Gateway process stops unexpectedly, the run-scoped token expires and the server rejects further calls.

The two wrapper tools keep a stable schema because the plugin API does not promise that an installed plugin can replace an active run's tool definitions after a Gateway method call. The list tool returns the current catalog schemas for model selection. The call tool accepts a catalog name and arguments, but checks that the name is currently listed and still delegates all permission decisions to Tool Gateway.

## Install and configure

Copy `openclaw-extension/` from this adapter package into the OpenClaw host's local plugin directory. Keep the plugin's `package.json`, `openclaw.plugin.json`, and `index.ts` together. Use a dedicated OpenClaw agent/runtime for Paperclip and allow exactly the two bridge tools at the host and selected-agent levels. The plugin checks the active runtime configuration at bind time and on every tool call; any broader tool group or extra tool causes a closed denial.

```json
{
  "plugins": {
    "entries": {
      "blentera-platform": {
        "enabled": true,
        "config": {
          "paperclipApiOrigins": ["https://paperclip.example"]
        }
      }
    }
  },
  "tools": {
    "allow": [
      "blentera_platform_list_tools",
      "blentera_platform_call_tool"
    ]
  },
  "agents": {
    "entries": {
      "paperclip-worker": {
        "tools": {
          "allow": [
            "blentera_platform_list_tools",
            "blentera_platform_call_tool"
          ]
        }
      }
    }
  }
}
```

Do not place a Paperclip gateway token in plugin configuration. The adapter supplies a short-lived run token at dispatch. Keep the Gateway protected by its normal authentication and use the HTTPS origin that the Paperclip Runner actually issues. Configure the adapter's `agentId` to the dedicated agent key and do not attach broad tool groups to that agent.

## Official API pin and conformance

This extension targets OpenClaw commit `a54402e27d585ab69cccda86ce7c0160a68afeaf`. The pinned source files and SHA-256 values are:

| Upstream file | SHA-256 |
| --- | --- |
| `src/plugins/plugin-api.types.ts` (`registerTool`, `registerGatewayMethod`) | `b361b20b14c714b5be09c7060e14dc2a01d8b35dfef4c9e1b90641f517e36024` |
| `src/plugins/tool-types.ts` (trusted tool context, `agentId`, `sessionKey`, host `runId`, context version 2) | `f4fe73d4137e69ae7d0bd92fa753523a98b5d9c15d17a9c146558cd3f9d45535` |
| `src/gateway/server-methods/agent-run-handler.ts` (server-owned accepted run lifecycle) | `1fc79b627f192b8259abcfa169201197ea6f14e8a5921109bb2b786eaeeb507a` |
| `packages/gateway-protocol/src/schema/agent.ts` (`idempotencyKey`, no caller-supplied run ID) | `ee017410bce9bd019ed959e2535ea5dfbea5a2a5b0f543a0c485b60cd5c4036e` |

`conformance.test.ts` uses fake MCP and Gateway boundaries to exercise successful binding, exact accepted-run matching, wrong-run admission, untrusted origins, expiry, policy revocation, invocation-context substitution, and explicit unbinding. It does not mock or weaken Tool Gateway authorization; the actual Gateway remains responsible for the final allow/deny decision. The V10 OpenClaw profile is not qualified until the repository's serialized adapter and Gateway database lanes pass this harness against the exact release source pins.
