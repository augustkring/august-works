import fs from "node:fs/promises";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { PROJECT_REPOSITORIES_DIR, readGitWorkspaceSnapshot } from "@paperclipai/adapter-utils/git-workspace-sync";
import { captureDirectorySnapshot, mergeDirectoryWithBaseline } from "@paperclipai/adapter-utils/workspace-restore-merge";
import { sanitizeRuntimeServiceBaseEnv } from "./runtime-service-env.js";
import { describeGitAuthFailure, scrubGitCredentialText, type GitRemoteAuthProvider } from "./git-credentials.js";
import { isWorkspaceGitScanError, WorkspaceGitScanError } from "./workspace-git-operation-scheduler.js";
import { gitWorkspaceRestoreCredentialArgs, gitWorkspaceRestoreEnv, isSupportedRestorationGitSource } from "./git-workspace-auth-env.js";

const execFile = promisify(execFileCallback);
const MANAGED_WORKSPACE_GIT_CLONE_TIMEOUT_MS = 10 * 60 * 1000;

export async function materializeManagedProjectWorkspace(
  cwd: string,
  input: {
    repoUrl: string | null;
    repoRef?: string | null;
    localSource?: string | null;
    resolveGitAuth?: GitRemoteAuthProvider | null;
    beforePublish?: (cloneCwd: string) => Promise<void>;
    /** Exact restore only: remove all ambient Git identities/config and use
     * only the canonical credential provider result for a remote source. */
    strictSourceAuth?: boolean;
  },
): Promise<{ cwd: string; warning: string | null }> {
  if (input.strictSourceAuth && (!input.repoUrl || !isSupportedRestorationGitSource(input.repoUrl))) {
    throw new Error("Unsupported source for exact workspace restoration");
  }
  if (input.beforePublish && !input.repoUrl) {
    throw new Error("Exact saved-source inspection requires a repository URL");
  }
  await fs.mkdir(path.dirname(cwd), { recursive: true });
  const stats = await fs.stat(cwd).catch(() => null);

  if (!input.repoUrl) {
    if (!stats) {
      await fs.mkdir(cwd, { recursive: true });
    }
    return { cwd, warning: null };
  }

  const hasAdoptableGitDir = () =>
    fs
      .stat(path.resolve(cwd, ".git"))
      .then((entry) => entry.isDirectory())
      .catch(() => false);
  if (await hasAdoptableGitDir()) {
    if (input.beforePublish) throw new Error("An existing checkout requires exact saved-source inspection before reuse");
    return { cwd, warning: null };
  }

  if (stats) {
    // An inspection callback is an authorization and snapshot fence, not an
    // optional hint. It cannot validate an existing directory that bypasses
    // the clone-and-publish path, or a directory whose contents cannot be
    // inspected. Keep the historical no-callback adoption behavior unchanged.
    const entries = input.beforePublish
      ? await fs.readdir(cwd)
      : await fs.readdir(cwd).catch(() => []);
    if (entries.length > 0) {
      if (input.beforePublish) {
        throw new Error("An existing non-Git directory cannot bypass exact saved-source inspection");
      }
      return {
        cwd,
        warning: `Managed workspace path "${cwd}" already exists but is not a git checkout. Using it as-is.`,
      };
    }
    await fs.rm(cwd, { recursive: true, force: true });
  }

  // Clone into a temp sibling, then move into place atomically. The shared target directory
  // is never created in a partial state and never removed on failure, so a concurrent
  // materialization (another process, or a run racing this one) can neither adopt a broken
  // checkout nor lose its own completed one.
  const auth = input.resolveGitAuth && !input.localSource
    ? await input.resolveGitAuth(input.repoUrl)
    : null;
  const cloneTmpDir = await fs.mkdtemp(`${cwd}.clone-`);
  try {
    await execFile(
      "git",
      [...(input.strictSourceAuth ? gitWorkspaceRestoreCredentialArgs(auth) : auth?.configArgs ?? []),
        "clone", "--no-hardlinks", "--", input.localSource ?? input.repoUrl, cloneTmpDir],
      {
        env: {
          // Spread order matters: the sanitizer strips PAPERCLIP_*, which would remove the
          // credential-helper token env if it came first. GIT_TERMINAL_PROMPT=0 fails a
          // credential-less private clone immediately instead of hanging on a prompt until
          // the clone timeout.
          ...(input.strictSourceAuth
            ? gitWorkspaceRestoreEnv(auth)
            : {
              ...sanitizeRuntimeServiceBaseEnv(process.env),
              GIT_TERMINAL_PROMPT: "0",
              ...(auth?.env ?? {}),
            }),
        },
        timeout: MANAGED_WORKSPACE_GIT_CLONE_TIMEOUT_MS,
      },
    );
    if (input.localSource) {
      const snapshot = await readGitWorkspaceSnapshot(input.localSource, false);
      if (!snapshot) throw new Error("Configured repository folder is not a Git checkout");
      const baseline = await captureDirectorySnapshot(cloneTmpDir, { exclude: [".git", ".paperclip-runtime", PROJECT_REPOSITORIES_DIR, ...snapshot.ignoredPaths] });
      await mergeDirectoryWithBaseline({ baseline, sourceDir: input.localSource, targetDir: cloneTmpDir });
      await execFile("git", ["-C", cloneTmpDir, "remote", "set-url", "origin", input.repoUrl], { timeout: 10_000 });
    } else if (input.repoRef) {
      await execFile("git", ["-C", cloneTmpDir, "checkout", input.repoRef], { timeout: MANAGED_WORKSPACE_GIT_CLONE_TIMEOUT_MS });
    }
  } catch (error) {
    await fs
      .rm(cloneTmpDir, { recursive: true, force: true })
      .catch(() => undefined);
    const reason = error instanceof Error ? error.message : String(error);
    const authNote = describeGitAuthFailure({
      error: reason,
      used: auth ? { source: auth.source, secretName: auth.secretName } : null,
    });
    const message = scrubGitCredentialText(
      `Failed to prepare managed checkout for "${input.repoUrl}" at "${cwd}": ${reason}${authNote ? ` ${authNote}` : ""}`,
    );
    // Preserve the closed failure code without copying subprocess output or
    // credentials into the durable run. Setup recovery needs the actual cause.
    if (isWorkspaceGitScanError(error)) throw new WorkspaceGitScanError(error.code, message);
    throw new Error(message);
  }

  // Exact restore callers validate the prepared commit and current source
  // authority immediately before publication. Failure removes only our clone.
  try { await input.beforePublish?.(cloneTmpDir); }
  catch (error) {
    await fs.rm(cloneTmpDir, { recursive: true, force: true });
    throw error;
  }

  try {
    await fs.rename(cloneTmpDir, cwd);
  } catch (renameError) {
    await fs
      .rm(cloneTmpDir, { recursive: true, force: true })
      .catch(() => undefined);
    // The target appearing between the emptiness check and the rename means another
    // materialization won the race; adopt its checkout instead of failing the run.
    if (!input.beforePublish && await hasAdoptableGitDir()) {
      return { cwd, warning: null };
    }
    const reason =
      renameError instanceof Error ? renameError.message : String(renameError);
    throw new Error(
      `Failed to move managed checkout into place at "${cwd}": ${reason}`,
    );
  }
  return { cwd, warning: null };
}

