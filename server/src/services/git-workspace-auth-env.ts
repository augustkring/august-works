import os from "node:os";
import { sanitizeRuntimeServiceBaseEnv } from "./runtime-service-env.js";
import { isGitHubHttpsRemoteUrl, type GitAuthInvocation } from "./git-credentials.js";
import { localRepositoryPath } from "./local-repository-path.js";

/** Exact restoration accepts HTTPS GitHub sources (a credential-less fetch must
 * succeed anonymously) or a current, explicitly authorized local repository.
 * Other remote schemes require a separate credential owner before a saved recipe
 * may use them. */
export function isSupportedRestorationGitSource(repoUrl: string): boolean {
  try { if (localRepositoryPath(repoUrl)) return true; }
  catch { return false; }
  return isGitHubHttpsRemoteUrl(repoUrl);
}

/** Prevent the server process's Git config, helper, agent, or token from becoming
 * an implicit identity. Provider credentials are layered only when the canonical
 * credential factory returns them for this source. */
export function gitWorkspaceRestoreEnv(auth?: GitAuthInvocation | null): NodeJS.ProcessEnv {
  const env = sanitizeRuntimeServiceBaseEnv(process.env);
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_CONFIG_") || key.startsWith("GIT_TRACE") || [
      "GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES",
      "GIT_INDEX_FILE", "GIT_CEILING_DIRECTORIES", "GIT_PREFIX", "GIT_SSH", "GIT_SSH_COMMAND", "GIT_ASKPASS",
      "SSH_AUTH_SOCK", "SSH_AGENT_PID", "SSH_ASKPASS", "GH_TOKEN", "GITHUB_TOKEN", "PAPERCLIP_GIT_TOKEN",
    ].includes(key)) delete env[key];
  }
  return {
    ...env,
    ...auth?.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: os.devNull,
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    // Unsupported SSH remotes fail source validation. This also prevents any
    // malformed source from borrowing the operator's agent or SSH config.
    GIT_SSH_COMMAND: `ssh -F ${os.devNull} -o BatchMode=yes -o IdentityAgent=none -o IdentitiesOnly=yes -i ${os.devNull}`,
  };
}

export function gitWorkspaceRestoreCredentialArgs(auth?: GitAuthInvocation | null): string[] {
  // The explicit empty helper prevents Git from consulting configured credential
  // stores when no canonical auth provider selected an identity.
  return auth?.configArgs ?? ["-c", "credential.helper="];
}
