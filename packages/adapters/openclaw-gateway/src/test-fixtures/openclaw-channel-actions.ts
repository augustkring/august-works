/**
 * Unit-only implementation of OpenClaw's pinned jsonResult helper.
 * Source: OpenClaw a54402e27d585ab69cccda86ce7c0160a68afeaf,
 * src/agents/tools/tool-results.ts (SHA-256 13d2e22b750609d8cc848a548a17324e99000f004e89730bf305b3960da2ce3b).
 * The plugin host runtime supplies the actual SDK module; this fixture lets
 * bridge boundary tests exercise the plugin without installing OpenClaw.
 */
export function jsonResult<TDetails>(payload: TDetails) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}
