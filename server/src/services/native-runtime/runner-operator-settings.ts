/** Server-process operator settings that let a remote Sandbox reach and stage
 * the Paperclip runner: the direct runner WebSocket URL and its CA bundle, and
 * the configured runner, Codex and provider-pack artifacts. They are read only
 * from the server's own environment, never from an Agent environment, a hook
 * DTO or the runner environment sent into the Sandbox. Every owner that builds
 * a remote runnerd backend (the heartbeat and the provider-conformance probe)
 * reads them here, so neither can silently lose a transport the other has. */
export type NativeRunnerOperatorSettings = Readonly<{
  runnerPublicUrl: string | null;
  runnerCaBundlePath: string | null;
  runnerRemoteBinaryPath: string | null;
  runnerRemoteCodexPath: string | null;
  runnerRemoteCodexNpmSpec: string | null;
  runnerRemoteProviderPackPath: string | null;
}>;

export function nativeRunnerOperatorSettings(
  serverEnvironment: Readonly<Record<string, string | undefined>>,
): NativeRunnerOperatorSettings {
  const read = (name: string) => serverEnvironment[name]?.trim() || null;
  return Object.freeze({
    runnerPublicUrl: read("PAPERCLIP_RUNNER_PUBLIC_URL"),
    runnerCaBundlePath: read("PAPERCLIP_RUNNER_CA_BUNDLE_PATH"),
    runnerRemoteBinaryPath: read("PAPERCLIP_RUNNER_REMOTE_BINARY_PATH"),
    runnerRemoteCodexPath: read("PAPERCLIP_RUNNER_REMOTE_CODEX_PATH"),
    runnerRemoteCodexNpmSpec: read("PAPERCLIP_RUNNER_REMOTE_CODEX_NPM_SPEC"),
    runnerRemoteProviderPackPath: read("PAPERCLIP_RUNNER_REMOTE_PROVIDER_PACK_PATH"),
  });
}
