import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const childState = vi.hoisted(() => ({ calls: [] as Array<{ runId: string; command: string; args: string[]; options: Record<string, any> }> }));
vi.mock("@paperclipai/adapter-utils/server-utils", async importOriginal => {
  const actual = await importOriginal<typeof import("@paperclipai/adapter-utils/server-utils")>();
  return { ...actual, runChildProcess: vi.fn(async (runId: string, command: string, args: string[], options: Record<string, any>) => {
    childState.calls.push({ runId, command, args, options });
    if (args[0] === "config" && args[2] === "mcp_servers") {
      return { exitCode: 0, signal: null, timedOut: false, stdout: JSON.stringify({ blentera_run_0: { url: options.env.BLENTERA_HERMES_MCP_0_URL, headers: { Authorization: `Bearer ${options.env.BLENTERA_HERMES_MCP_0_TOKEN}` } } }), stderr: "", pid: null, startedAt: null };
    }
    if (args[0] === "config" && args[2] === "skills") {
      return { exitCode: 0, signal: null, timedOut: false, stdout: JSON.stringify({ project_discovery: false, external_dirs: [], create_dir: null, trusted_project_dirs: [] }), stderr: "", pid: null, startedAt: null };
    }
    return { exitCode: 0, signal: null, timedOut: false, stdout: "Hermes completed the governed task.\nsession_id: hermes-fixture-session\n", stderr: "", pid: null, startedAt: null };
  }) };
});

import { execute } from "./execute.js";
import { hermesPresenceConfig, hermesProfileHash } from "./presence-profile.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../");
const skillRoot = path.join(repositoryRoot, "skills-releases/blentera-platform/v3");
const registry = JSON.parse(await fs.readFile(path.join(repositoryRoot, "skills-releases/blentera-platform/releases.json"), "utf8"));
const release = registry.at(-1)!;
const originalPaperclipHome = process.env.PAPERCLIP_HOME;
const temporaryRoots: string[] = [];

async function newPaperclipHome() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-platform-conformance-"));
  temporaryRoots.push(home);
  return home;
}

async function fixture(companyId = randomUUID(), agentId = randomUUID(), paperclipHomeInput?: string) {
  const paperclipHome = paperclipHomeInput ?? await newPaperclipHome();
  process.env.PAPERCLIP_HOME = paperclipHome;
  const runId = randomUUID();
  const server = { name: "paperclip-assigned", url: `https://paperclip.invalid/api/mcp/run/${runId}`, token: `fixture-token-${randomUUID()}`, connectionId: `assignment:${"a".repeat(64)}` };
  const context: any = {
    runId,
    agent: { id: agentId, companyId, name: "Hermes conformance fixture", adapterType: "hermes_local", adapterConfig: {} },
    runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
    config: {
      command: "hermes-fixture-never-spawned", provider: "openrouter", model: "openai/gpt-4.1-mini", timeoutSec: 10,
      cwd: paperclipHome,
      paperclipRuntimeSkills: [{ key: "blentera-platform", runtimeName: "blentera-platform", source: skillRoot, versionId: release.id, sourceStatus: "available" }],
    },
    context: { issueId: "issue-conformance", wakeReason: "manual" },
    onLog: vi.fn(async () => undefined),
    platformSkillAdmission: { key: "blentera-platform", version: release.id, digest: release.contentDigest, sourceSha: release.sourceSha },
    platformSkillContracts: { operationManifestHash: release.operationManifestHash, toolCatalogContractHash: release.toolCatalogContractHash },
    providerRuntime: { isolationMode: "isolated_per_presence", capabilitySnapshotHash: "b".repeat(64) },
    runtimeMcp: { getServers: () => [server] },
  };
  return { context, server, paperclipHome };
}

beforeEach(() => { childState.calls.length = 0; });
afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
  if (originalPaperclipHome === undefined) delete process.env.PAPERCLIP_HOME;
  else process.env.PAPERCLIP_HOME = originalPaperclipHome;
});

it("delivers and verifies the exact immutable Platform Skill at Hermes adapter dispatch", async () => {
  const { context, paperclipHome } = await fixture("company-positive", "agent-positive");
  const result = await execute(context);
  const profileConfig = hermesPresenceConfig(context.config, { companyId: context.agent.companyId, agentId: context.agent.id });
  const profileHome = profileConfig.env.HERMES_HOME as string;
  expect(result.exitCode).toBe(0);
  expect(result.resultJson?.hermesGovernedProfile).toMatchObject({ platformSkill: context.platformSkillAdmission, qualification: "requires_runtime_conformance" });
  expect(await fs.readlink(path.join(profileHome, "skills", "blentera-platform"))).toBe(skillRoot);
  expect(childState.calls.some(call => call.args[0] === "chat" && call.options.env.HERMES_HOME === profileHome)).toBe(true);
  expect(profileHome.startsWith(paperclipHome)).toBe(true);
});

it("rejects a stale immutable Skill digest before Hermes starts", async () => {
  const { context } = await fixture("company-stale", "agent-stale");
  context.platformSkillAdmission.digest = `sha256:${"0".repeat(64)}`;
  await expect(execute(context)).rejects.toThrow("platform_skill_digest_mismatch");
  expect(childState.calls).toHaveLength(0);
});

it("rejects a missing Platform Skill before Hermes starts", async () => {
  const { context } = await fixture("company-missing", "agent-missing");
  context.config.paperclipRuntimeSkills = [];
  await expect(execute(context)).rejects.toThrow("hermes_required_platform_skill_unavailable");
  expect(childState.calls).toHaveLength(0);
});

it("rejects a reserved-name profile collision before Hermes starts", async () => {
  const { context } = await fixture("company-collision", "agent-collision");
  const profileConfig = hermesPresenceConfig(context.config, { companyId: context.agent.companyId, agentId: context.agent.id });
  const skillsHome = path.join(profileConfig.env.HERMES_HOME as string, "skills");
  await fs.mkdir(path.join(skillsHome, "blentera-platform"), { recursive: true });
  await fs.writeFile(path.join(skillsHome, "blentera-platform", "SKILL.md"), "# Customer shadow\n");
  await expect(execute(context)).rejects.toThrow("platform_skill_collision");
  expect(childState.calls).toHaveLength(0);
});

it("keeps two admitted companies on distinct Hermes profiles and Skill deliveries", async () => {
  const paperclipHome = await newPaperclipHome();
  const first = await fixture("company-isolated-a", "agent-isolated-a", paperclipHome);
  const second = await fixture("company-isolated-b", "agent-isolated-b", paperclipHome);
  const firstResult = await execute(first.context);
  const secondResult = await execute(second.context);
  const firstHome = hermesPresenceConfig(first.context.config, { companyId: first.context.agent.companyId, agentId: first.context.agent.id }).env.HERMES_HOME as string;
  const secondHome = hermesPresenceConfig(second.context.config, { companyId: second.context.agent.companyId, agentId: second.context.agent.id }).env.HERMES_HOME as string;
  expect(firstHome).not.toBe(secondHome);
  const firstProfile = firstResult.resultJson?.hermesGovernedProfile as Record<string, any>;
  const secondProfile = secondResult.resultJson?.hermesGovernedProfile as Record<string, any>;
  expect(firstProfile.presenceProfileHash).not.toBe(secondProfile.presenceProfileHash);
  expect(await fs.readlink(path.join(firstHome, "skills", "blentera-platform"))).toBe(skillRoot);
  expect(await fs.readlink(path.join(secondHome, "skills", "blentera-platform"))).toBe(skillRoot);
  const dispatched = childState.calls.filter(call => call.args[0] === "chat");
  expect(dispatched.map(call => call.options.env.HERMES_HOME)).toEqual([firstHome, secondHome]);
});

it("resumes only with the current admitted Hermes profile hash", async () => {
  const { context } = await fixture("company-recovery", "agent-recovery");
  const firstResult = await execute(context);
  const profileHash = hermesProfileHash(hermesPresenceConfig(context.config, { companyId: context.agent.companyId, agentId: context.agent.id }));
  const resumed = { ...context, runtime: { ...context.runtime, sessionId: "hermes-fixture-session", sessionParams: { sessionId: "hermes-fixture-session", hermesProfileHash: profileHash } } };
  const resumedResult = await execute(resumed);
  const dispatches = childState.calls.filter(call => call.args[0] === "chat");
  expect(firstResult.sessionParams?.hermesProfileHash).toBe(profileHash);
  expect(resumedResult.sessionParams?.hermesProfileHash).toBe(profileHash);
  expect(dispatches).toHaveLength(2);
  expect(dispatches[1]!.args).toContain("--resume");
  expect(dispatches[1]!.args).toContain("hermes-fixture-session");

  const staleResume = { ...context, runtime: { ...context.runtime, sessionId: "hermes-fixture-session", sessionParams: { sessionId: "hermes-fixture-session", hermesProfileHash: "0".repeat(64) } } };
  await expect(execute(staleResume)).rejects.toThrow("hermes_session_profile_unverified");
  expect(childState.calls.filter(call => call.args[0] === "chat")).toHaveLength(2);
});
