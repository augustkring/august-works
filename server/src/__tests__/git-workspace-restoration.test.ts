import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveManagedProjectWorkspaceDir } from "../home-paths.js";
import { localEncryptedProvider } from "../secrets/local-encrypted-provider.js";
import {
  GIT_CACHE_RESTORATION_KEY,
  inspectGitCacheRecipe,
  restoreManagedGitCacheWorktree,
  type GitCacheRestoration,
} from "../services/git-workspace-restoration.js";
import { restoreGitWorkspaceContents } from "../services/git-workspace-contents.js";
import { PROJECT_REPOSITORIES_DIR } from "@paperclipai/adapter-utils/git-workspace-sync";
import { assertReproducibleManagedCheckout } from "../services/git-workspace-restoration.js";
import { managedProjectCheckoutName } from "../services/managed-project-checkout-name.js";
import { readManagedCheckoutContents, type ManagedCheckoutContents } from "../services/git-workspace-contents.js";
import { gitWorkspaceRestoreCredentialArgs, gitWorkspaceRestoreEnv, isSupportedRestorationGitSource } from "../services/git-workspace-auth-env.js";

const execFile = promisify(execFileCallback);
let tempHome: string;
let oldHome: string | undefined;
let oldKey: string | undefined;

beforeAll(async () => {
  oldHome = process.env.PAPERCLIP_HOME;
  oldKey = process.env.PAPERCLIP_SECRETS_MASTER_KEY;
  tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-git-cache-restoration-"));
  process.env.PAPERCLIP_HOME = tempHome;
  process.env.PAPERCLIP_SECRETS_MASTER_KEY = "0123456789abcdef0123456789abcdef";
});

afterAll(async () => {
  if (oldHome === undefined) delete process.env.PAPERCLIP_HOME;
  else process.env.PAPERCLIP_HOME = oldHome;
  if (oldKey === undefined) delete process.env.PAPERCLIP_SECRETS_MASTER_KEY;
  else process.env.PAPERCLIP_SECRETS_MASTER_KEY = oldKey;
  await fs.rm(tempHome, { recursive: true, force: true });
});

async function git(cwd: string, ...args: string[]) {
  return (await execFile("git", ["-c", "core.fsmonitor=false", "-C", cwd, ...args])).stdout.trim();
}

async function fixture() {
  const workspaceId = randomUUID();
  const projectWorkspaceId = randomUUID();
  const nestedWorkspaceId = randomUUID();
  const sourceIssueId = randomUUID();
  const companyId = randomUUID();
  const projectId = randomUUID();
  const sourcePath = resolveManagedProjectWorkspaceDir({ companyId, projectId, repoName: "sample" });
  const repoUrl = pathToFileURL(sourcePath).href;
  const worktreePath = path.join(tempHome, "workspaces", workspaceId);
  await fs.mkdir(sourcePath, { recursive: true });
  await execFile("git", ["init", "-b", "main"], { cwd: sourcePath });
  await execFile("git", ["remote", "add", "origin", repoUrl], { cwd: sourcePath });
  await fs.writeFile(path.join(sourcePath, ".gitignore"), ".claude/settings.local.json\n.paperclip-repositories/\n", "utf8");
  await fs.writeFile(path.join(sourcePath, "README.md"), "saved tree\n", "utf8");
  await execFile("git", ["add", ".gitignore", "README.md"], { cwd: sourcePath });
  await execFile("git", ["commit", "-m", "initial"], { cwd: sourcePath,
    env: { ...process.env, GIT_AUTHOR_NAME: "Paperclip", GIT_AUTHOR_EMAIL: "paperclip@example.test",
      GIT_COMMITTER_NAME: "Paperclip", GIT_COMMITTER_EMAIL: "paperclip@example.test" } });
  const branchName = "paperclip/issue-1";
  await fs.mkdir(path.dirname(worktreePath), { recursive: true });
  await execFile("git", ["-C", sourcePath, "worktree", "add", "-b", branchName, worktreePath, "HEAD"]);
  const settings = Buffer.from('{"permissions":{"allow":["Read"]}}\n');
  await fs.mkdir(path.join(worktreePath, ".claude"), { recursive: true });
  await fs.writeFile(path.join(worktreePath, ".claude/settings.local.json"), settings, { mode: 0o600 });
  const nestedSourcePath = path.join(tempHome, `nested-source-${randomUUID()}`);
  const nestedRepoUrl = pathToFileURL(nestedSourcePath).href;
  await fs.mkdir(nestedSourcePath, { recursive: true });
  await execFile("git", ["init", "-b", "main"], { cwd: nestedSourcePath });
  await fs.writeFile(path.join(nestedSourcePath, ".gitignore"), ".claude/settings.local.json\n", "utf8");
  await fs.writeFile(path.join(nestedSourcePath, "README.md"), "nested source\n", "utf8");
  await execFile("git", ["add", ".gitignore", "README.md"], { cwd: nestedSourcePath });
  await execFile("git", ["commit", "-m", "nested source"], { cwd: nestedSourcePath,
    env: { ...process.env, GIT_AUTHOR_NAME: "Paperclip", GIT_AUTHOR_EMAIL: "paperclip@example.test",
      GIT_COMMITTER_NAME: "Paperclip", GIT_COMMITTER_EMAIL: "paperclip@example.test" } });
  const nestedSource = { id: nestedWorkspaceId, repoUrl: nestedRepoUrl, repoRef: "main", cwd: null,
    sourceType: "git_repo", visibility: "default" };
  const nestedName = managedProjectCheckoutName(nestedSource);
  const nestedPath = path.join(worktreePath, PROJECT_REPOSITORIES_DIR, nestedName);
  await fs.mkdir(path.dirname(nestedPath), { recursive: true });
  await execFile("git", ["clone", "--", nestedRepoUrl, nestedPath]);
  const nestedSettings = Buffer.from('{"permissions":{"deny":["Write"]}}\n');
  await fs.mkdir(path.join(nestedPath, ".claude"), { recursive: true });
  await fs.writeFile(path.join(nestedPath, ".claude/settings.local.json"), nestedSettings, { mode: 0o600 });
  await fs.chmod(path.join(nestedPath, ".claude/settings.local.json"), 0o640);
  const workspace = {
    id: workspaceId, companyId, projectId, projectWorkspaceId, sourceIssueId, repoUrl, baseRef: "main",
    sourceRepoRef: "main", sourceCwd: null, sourceType: "remote_managed", sourceVisibility: "default",
    mode: "isolated_workspace", strategyType: "git_worktree",
    branchName, cwd: worktreePath, providerRef: worktreePath,
    metadata: { createdByRuntime: true, gitBranchOwnershipVersion: 1 },
  };
  return { workspace, settings, sourcePath, nestedName, nestedSource, nestedSettings };
}

describe("managed project worktree restoration recipe", () => {
  it("uses no ambient Git helper, token, or SSH agent when restore auth is absent", () => {
    const previous = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries({
      GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "credential.helper", GIT_CONFIG_VALUE_0: "ambient-helper",
      GIT_CONFIG_PARAMETERS: "credential.helper=ambient", GH_TOKEN: "ambient-gh", GITHUB_TOKEN: "ambient-github",
      SSH_AUTH_SOCK: "/ambient/agent", GIT_SSH_COMMAND: "ambient-ssh",
    })) {
      previous.set(key, process.env[key]);
      process.env[key] = value;
    }
    try {
      const env = gitWorkspaceRestoreEnv();
      expect(env).not.toHaveProperty("GIT_CONFIG_COUNT");
      expect(env).not.toHaveProperty("GIT_CONFIG_PARAMETERS");
      expect(env).not.toHaveProperty("GH_TOKEN");
      expect(env).not.toHaveProperty("GITHUB_TOKEN");
      expect(env).not.toHaveProperty("SSH_AUTH_SOCK");
      expect(env.GIT_CONFIG_GLOBAL).toBe(os.devNull);
      expect(env.GIT_CONFIG_SYSTEM).toBe(os.devNull);
      expect(gitWorkspaceRestoreCredentialArgs()).toEqual(["-c", "credential.helper="]);
      const selected = gitWorkspaceRestoreEnv({
        configArgs: ["-c", "credential.helper="],
        env: { GH_TOKEN: "selected-token", GITHUB_TOKEN: "selected-token", PAPERCLIP_GIT_TOKEN: "selected-token",
          GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "credential.helper", GIT_CONFIG_VALUE_0: "selected-helper" },
        source: "company_secret", secretName: "GITHUB_TOKEN",
      });
      expect(selected.GH_TOKEN).toBe("selected-token");
      expect(selected.GIT_CONFIG_VALUE_0).toBe("selected-helper");
      expect(selected.SSH_AUTH_SOCK).toBeUndefined();
      expect(gitWorkspaceRestoreCredentialArgs({ configArgs: ["-c", "credential.helper="],
        env: {}, source: "company_secret", secretName: null })).toEqual(["-c", "credential.helper="]);
      expect(isSupportedRestorationGitSource("git@github.com:private/repo.git")).toBe(false);
      expect(isSupportedRestorationGitSource("https://github.com/owner/repo.git")).toBe(true);
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("restores the exact saved commit and encrypted local settings idempotently", async () => {
    const { workspace, settings, sourcePath, nestedName, nestedSource, nestedSettings } = await fixture();
    const resolveGitAuth = async () => null;
    const managedCheckouts: ManagedCheckoutContents[] = [];
    const recipe = await inspectGitCacheRecipe(workspace, resolveGitAuth, undefined, {
      managedCheckouts,
      proveManagedCheckout: async (checkoutPath, name, signal) => {
        expect(name).toBe(nestedName);
        await assertReproducibleManagedCheckout(checkoutPath, { repoUrl: nestedSource.repoUrl, resolveGitAuth, signal });
        managedCheckouts.push(await readManagedCheckoutContents(checkoutPath, name, nestedSource, signal));
      },
    });
    expect(recipe.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(recipe.contents?.settings).not.toBeNull();
    expect(recipe.contents?.checkouts).toHaveLength(1);
    await fs.writeFile(path.join(sourcePath, "README.md"), "new moving main ref\n", "utf8");
    await execFile("git", ["add", "README.md"], { cwd: sourcePath });
    await execFile("git", ["commit", "-m", "advance source ref"], { cwd: sourcePath,
      env: { ...process.env, GIT_AUTHOR_NAME: "Paperclip", GIT_AUTHOR_EMAIL: "paperclip@example.test",
        GIT_COMMITTER_NAME: "Paperclip", GIT_COMMITTER_EMAIL: "paperclip@example.test" } });
    await execFile("git", ["-C", recipe.sourcePath, "worktree", "remove", "--force", workspace.cwd!]);
    const persisted = { ...workspace, metadata: { ...workspace.metadata, [GIT_CACHE_RESTORATION_KEY]: recipe } };
    let checks = 0;
    const authorizeSource = async (source: { id: string; repoUrl: string; repoRef: string | null; cwd: string | null; sourceType: string; visibility: string }) => {
      expect([workspace.projectWorkspaceId, nestedSource.id]).toContain(source.id);
      checks += 1;
    };
    const hostileConfigKeys = ["GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0", "GIT_CONFIG_KEY_1",
      "GIT_CONFIG_VALUE_1", "GIT_CONFIG_PARAMETERS", "GH_TOKEN", "GITHUB_TOKEN", "SSH_AUTH_SOCK"];
    const priorHostileConfig = new Map(hostileConfigKeys.map(key => [key, process.env[key]]));
    const hostileHelperMarker = path.join(tempHome, "ambient-git-helper-used");
    await fs.rm(hostileHelperMarker, { force: true });
    Object.assign(process.env, {
      GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_0: "protocol.file.allow", GIT_CONFIG_VALUE_0: "never",
      GIT_CONFIG_KEY_1: "credential.helper", GIT_CONFIG_VALUE_1: `!touch ${hostileHelperMarker}`,
      GIT_CONFIG_PARAMETERS: "protocol.file.allow=never", GH_TOKEN: "ambient-token", GITHUB_TOKEN: "ambient-token",
      SSH_AUTH_SOCK: "/ambient/ssh-agent",
    });
    try {
      await restoreManagedGitCacheWorktree({ workspace: persisted, baseCwd: recipe.sourcePath,
        resolveGitAuth, beforeMutation: async () => { checks += 1; }, authorizeSource,
        prepareLocalSource: async () => async () => {} });
      expect(await fs.access(hostileHelperMarker).then(() => true, () => false)).toBe(false);
    } finally {
      for (const [key, value] of priorHostileConfig) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await fs.rm(hostileHelperMarker, { force: true });
    }
    expect(await git(workspace.cwd!, "rev-parse", "HEAD")).toBe(recipe.commit);
    expect(await fs.readFile(path.join(workspace.cwd!, ".claude/settings.local.json"))).toEqual(settings);
    expect(await fs.readFile(path.join(workspace.cwd!, PROJECT_REPOSITORIES_DIR, nestedName, ".claude/settings.local.json")))
      .toEqual(nestedSettings);
    const stat = await fs.stat(path.join(workspace.cwd!, ".claude/settings.local.json"));
    expect(stat.mode & 0o777).toBe(0o600);
    const nestedStat = await fs.stat(path.join(workspace.cwd!, PROJECT_REPOSITORIES_DIR, nestedName, ".claude/settings.local.json"));
    expect(nestedStat.mode & 0o777).toBe(0o640);
    const encrypted = await localEncryptedProvider.resolveVersion({ material: recipe.contents!.settings!.material, externalRef: null });
    expect(encrypted).not.toContain(settings.toString());
    await restoreManagedGitCacheWorktree({ workspace: persisted, baseCwd: recipe.sourcePath,
      resolveGitAuth, beforeMutation: async () => { checks += 1; }, authorizeSource,
      prepareLocalSource: async () => async () => {} });
    const before = await fs.readFile(path.join(workspace.cwd!, ".claude/settings.local.json"));
    await restoreGitWorkspaceContents({ companyId: workspace.companyId, workspaceId: workspace.id,
      cwd: workspace.cwd!, contents: recipe.contents, resolveGitAuth, authorizeSource,
      prepareLocalSource: async () => async () => {} });
    expect(await fs.readFile(path.join(workspace.cwd!, ".claude/settings.local.json"))).toEqual(before);
    expect(checks).toBeGreaterThan(2);
  });

  it("refuses source withdrawal before creating a worktree and rejects lost encryption keys", async () => {
    const { workspace, nestedName, nestedSource } = await fixture();
    const resolveGitAuth = async () => null;
    const managedCheckouts: ManagedCheckoutContents[] = [];
    const recipe: GitCacheRestoration = await inspectGitCacheRecipe(workspace, resolveGitAuth, undefined, {
      managedCheckouts,
      proveManagedCheckout: async (checkoutPath, name, signal) => {
        expect(name).toBe(nestedName);
        await assertReproducibleManagedCheckout(checkoutPath, { repoUrl: nestedSource.repoUrl, resolveGitAuth, signal });
        managedCheckouts.push(await readManagedCheckoutContents(checkoutPath, name, nestedSource, signal));
      },
    });
    await execFile("git", ["-C", recipe.sourcePath, "worktree", "remove", "--force", workspace.cwd!]);
    const persisted = { ...workspace, metadata: { ...workspace.metadata, [GIT_CACHE_RESTORATION_KEY]: recipe } };
    await expect(restoreManagedGitCacheWorktree({ workspace: persisted, baseCwd: recipe.sourcePath,
      resolveGitAuth: async () => null, beforeMutation: async () => {},
      authorizeSource: async () => { throw new Error("source withdrawn"); } })).rejects.toThrow("source withdrawn");
    await expect(fs.access(workspace.cwd!)).rejects.toMatchObject({ code: "ENOENT" });

    // Restore the authorized checkout, then demonstrate that encrypted settings
    // cannot be interpreted after the master key changes.
    await restoreManagedGitCacheWorktree({ workspace: persisted, baseCwd: recipe.sourcePath,
      resolveGitAuth: async () => null, beforeMutation: async () => {}, authorizeSource: async () => {},
      prepareLocalSource: async () => async () => {} });
    process.env.PAPERCLIP_SECRETS_MASTER_KEY = "abcdef0123456789abcdef0123456789";
    await expect(restoreGitWorkspaceContents({ companyId: workspace.companyId, workspaceId: workspace.id,
      cwd: workspace.cwd!, contents: recipe.contents, resolveGitAuth: async () => null,
      authorizeSource: async () => {} })).rejects.toThrow("saved workspace commit could not be restored");
    expect(await fs.readFile(path.join(workspace.cwd!, "README.md"), "utf8")).toBe("saved tree\n");
  });

  it("rechecks source authority after preparation and before publishing a restored checkout", async () => {
    const { workspace, nestedName, nestedSource } = await fixture();
    const resolveGitAuth = async () => null;
    const managedCheckouts: ManagedCheckoutContents[] = [];
    const recipe = await inspectGitCacheRecipe(workspace, resolveGitAuth, undefined, {
      managedCheckouts,
      proveManagedCheckout: async (checkoutPath, name, signal) => {
        await assertReproducibleManagedCheckout(checkoutPath, { repoUrl: nestedSource.repoUrl, resolveGitAuth, signal });
        managedCheckouts.push(await readManagedCheckoutContents(checkoutPath, name, nestedSource, signal));
      },
    });
    await execFile("git", ["-C", recipe.sourcePath, "worktree", "remove", "--force", workspace.cwd!]);
    const persisted = { ...workspace, metadata: { ...workspace.metadata, [GIT_CACHE_RESTORATION_KEY]: recipe } };
    let authorizationChecks = 0;
    await expect(restoreManagedGitCacheWorktree({
      workspace: persisted,
      baseCwd: recipe.sourcePath,
      resolveGitAuth,
      beforeMutation: async () => {},
      authorizeSource: async source => {
        if (source.id === workspace.projectWorkspaceId && ++authorizationChecks > 1) throw new Error("source withdrawn");
      },
      prepareLocalSource: async () => async () => {},
    })).rejects.toThrow("source withdrawn");
    await expect(fs.access(workspace.cwd!)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.access(path.join(path.dirname(workspace.cwd!), `.${path.basename(workspace.cwd!)}.tmp`)))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps an interrupted exact worktree intact and lets the original recipe finish restoration", async () => {
    const { workspace, settings, nestedSource } = await fixture();
    const resolveGitAuth = async () => null;
    const recipe: GitCacheRestoration = await inspectGitCacheRecipe(workspace, resolveGitAuth, undefined, {
      managedCheckouts: [],
      proveManagedCheckout: async (checkoutPath, name, signal) => {
        await assertReproducibleManagedCheckout(checkoutPath, { repoUrl: nestedSource.repoUrl, resolveGitAuth, signal });
        return readManagedCheckoutContents(checkoutPath, name, nestedSource, signal);
      },
    });
    await execFile("git", ["-C", recipe.sourcePath, "worktree", "remove", "--force", workspace.cwd!]);
    const persisted = { ...workspace, metadata: { ...workspace.metadata, [GIT_CACHE_RESTORATION_KEY]: recipe } };
    let mutationChecks = 0;
    await expect(restoreManagedGitCacheWorktree({
      workspace: persisted,
      baseCwd: recipe.sourcePath,
      resolveGitAuth,
      beforeMutation: async () => {
        if (++mutationChecks === 2) throw new Error("simulated interruption after worktree publication");
      },
      authorizeSource: async () => {},
      prepareLocalSource: async () => async () => {},
    })).rejects.toThrow("simulated interruption");

    // The canonical path and registration still point to the exact saved commit;
    // the next owner retry completes encrypted local-content restoration.
    expect(await git(workspace.cwd!, "rev-parse", "HEAD")).toBe(recipe.commit);
    expect((await git(recipe.sourcePath, "worktree", "list", "--porcelain"))).toContain(`worktree ${workspace.cwd}`);
    await restoreManagedGitCacheWorktree({ workspace: persisted, baseCwd: recipe.sourcePath,
      resolveGitAuth, beforeMutation: async () => {}, authorizeSource: async () => {},
      prepareLocalSource: async () => async () => {} });
    expect(await git(workspace.cwd!, "rev-parse", "HEAD")).toBe(recipe.commit);
    expect(await fs.readFile(path.join(workspace.cwd!, ".claude/settings.local.json"))).toEqual(settings);
  });
});
