const CLOUD_ADAPTERS = new Set([
  "claude_local",
  "codex_local",
  "opencode_local",
  "grok_local",
]);

/** Creation policy shared by the picker and direct setup links. */
export function isNewAgentAdapterAllowed(
  type: string,
  {
    cloud,
    nativeRunnerEnabled,
    saas,
  }: { cloud: boolean; nativeRunnerEnabled: boolean; saas?: boolean },
) {
  if (saas)
    return [
      "openclaw_gateway",
      "hermes_gateway",
      "http",
      "cursor_cloud",
    ].includes(type);
  if (cloud) return CLOUD_ADAPTERS.has(type);
  return type !== "paperclip_runner" || nativeRunnerEnabled;
}
