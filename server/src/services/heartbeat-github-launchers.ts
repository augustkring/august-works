import { createHash } from "node:crypto";
import { githubBrokerEnvironment } from "@paperclipai/adapter-utils/github-launcher";
import { cleanupGitHubOperationLaunchers, prepareGitHubOperationLaunchers } from "@paperclipai/adapter-utils/execution-target";

type LauncherInput = Parameters<typeof prepareGitHubOperationLaunchers>[0];

/**
 * Native chat sandboxes that are proven to be projectless have no repository
 * metadata to discover and no GitHub capability to broker. Keep this path
 * side-effect free: the workspace owner has already pinned the exact private
 * Task root, and an empty metadata root set is the truthful no-repository
 * result. Leave network roots unset so the runner's existing local policy
 * resolves its standard DNS/CA roots inside the selected execution runtime;
 * do not issue a pre-selection command to discover them.
 */
export function prepareHeartbeatProjectlessNativeEnvironment(
  env: Record<string, unknown>,
  networkAccess: boolean,
): Record<string, string> {
  const result = {
    ...githubBrokerEnvironment(env, { url: "", token: "" }),
    // Without staged wrappers, prevent the provider image's gh config and
    // shell startup files from restoring ambient credentials/configuration.
    GH_CONFIG_DIR: "/dev/null",
    ZDOTDIR: "/dev/null",
    BASH_ENV: "/dev/null",
    PAPERCLIP_GITHUB_LAUNCHER_DIR: "",
    PAPERCLIP_GIT_METADATA_ROOTS: "[]",
    PAPERCLIP_GITHUB_AUTH_MODE: "managed",
    PAPERCLIP_RUNNER_NETWORK_ACCESS: networkAccess ? "enabled" : "disabled",
  };
  delete result.PAPERCLIP_RUNNER_NETWORK_ROOTS;
  return result;
}

export async function prepareHeartbeatGitHubLaunchers(
  input: LauncherInput & {
    native: boolean;
    githubConfigured: boolean;
    agentId: string;
    brokerUrl: string;
    createBrokerToken: () => string;
  },
  prepareLaunchers = prepareGitHubOperationLaunchers,
  cleanupLaunchers = cleanupGitHubOperationLaunchers,
) {
  // Native configured access is owned by the provider session supervisor.
  // Defer staging until it has acquired that session; never mutate a live
  // process's authorization from heartbeat preparation.
  if (input.native && input.githubConfigured) {
    return { env: githubBrokerEnvironment(input.env, { url: "", token: "" }), cleanupLocation: null };
  }
  // An unconfigured sandbox has no managed GitHub identity to broker. Its
  // token-free wrappers still isolate image credentials, but may live as long
  // as the workspace so a warm provider never inherits a deleted run path.
  // Other adapter paths retain their run-scoped capability/retirement rules.
  const anonymous = input.native && !input.githubConfigured &&
    input.target?.kind === "remote" && input.target.transport === "sandbox";
  const location = {
    runId: anonymous
      ? `anonymous-${input.agentId}-${createHash("sha256").update(input.env.PATH ?? "").digest("hex").slice(0, 16)}`
      : input.runId,
    target: input.target,
  };
  const env = githubBrokerEnvironment(input.env, {
    url: anonymous ? "" : input.brokerUrl,
    token: anonymous ? "" : input.createBrokerToken(),
  });
  try {
    return {
      env: await prepareLaunchers({ ...location, cwd: input.cwd, env }),
      cleanupLocation: anonymous ? null : location,
    };
  } catch (error) {
    // The caller cannot retain a cleanup location until staging returns. Clean
    // partial run-specific files here, preserving the original staging failure.
    // Anonymous files may still belong to a live warm provider; never delete them.
    if (!anonymous) await cleanupLaunchers(location).catch(() => undefined);
    throw error;
  }
}
