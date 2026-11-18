import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agents, companies, createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, heartbeatRunEvents, heartbeatRuns, issues, nativeRunFinalizations,
  type Db } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { agentService } from "../agents.js";
import { companyService } from "../companies.js";
import { removeRuntimeStorageTree } from "../runtime-skill-cache.js";
import { managedOpenCodeRuntimeDirectory, nativeRuntimeAssetsRoot } from "./runtime-asset-retention.js";
import { lockNativeRunDeletionPrivacy, prepareNativeRunDeletionErasure } from "./native-run-deletion-erasure.js";

// PRIV-R7 (CE-15). Agent deletion and the legacy local company remove delete
// Run rows. Without an erasure step the Runs' runtime folders, managed
// OpenCode provider homes and controller durable session folders lose the only
// owner that ties them to the company and are never erased.
const support = await getEmbeddedPostgresTestSupport();
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

(support.supported ? describe : describe.skip)("Native runtime erasure on Run row deletion (PRIV-R7)", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let home: string;
  let base: string;
  const oldEnv = { home: process.env.PAPERCLIP_HOME, instance: process.env.PAPERCLIP_INSTANCE_ID,
    state: process.env.PAPERCLIP_RUNNER_STATE_DIR };

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("native-run-deletion-erasure-");
    db = createDb(database.connectionString);
    home = await fs.mkdtemp(path.join(os.tmpdir(), "native-run-deletion-erasure-"));
    process.env.PAPERCLIP_HOME = home;
    process.env.PAPERCLIP_INSTANCE_ID = "native_run_deletion_erasure";
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  beforeEach(async () => {
    base = await fs.mkdtemp(path.join(home, "durable-sessions-"));
    process.env.PAPERCLIP_RUNNER_STATE_DIR = base;
  });

  afterEach(async () => {
    delete process.env.PAPERCLIP_RUNNER_STATE_DIR;
    await removeRuntimeStorageTree(base).catch(() => undefined);
  });

  afterAll(async () => {
    for (const [key, value] of [["PAPERCLIP_HOME", oldEnv.home], ["PAPERCLIP_INSTANCE_ID", oldEnv.instance],
      ["PAPERCLIP_RUNNER_STATE_DIR", oldEnv.state]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    if (home) await removeRuntimeStorageTree(home).catch(() => undefined);
    await database?.cleanup();
  }, 30_000);

  async function company() {
    const companyId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Run deletion fixture", issuePrefix: randomUUID() });
    return companyId;
  }

  async function agent(companyId: string) {
    const agentId = randomUUID(), issueId = randomUUID();
    await db.insert(agents).values({ id: agentId, companyId, name: "Run deletion agent", adapterType: "paperclip_runner" });
    await db.insert(issues).values({ id: issueId, companyId, title: "Task", assigneeAgentId: agentId });
    return { companyId, agentId, issueId };
  }

  let seq = 0;
  /** A Native Run without a finalization row: deleting the Run row is otherwise blocked by its no-action FK. */
  async function insertRun(owner: { companyId: string; agentId: string; issueId: string }, spec: {
    sessionId: string | null; status?: string; stopped?: boolean; profile?: Record<string, unknown> }) {
    const id = randomUUID(), createdAt = new Date(Date.now() - 600_000);
    const terminal = (spec.status ?? "succeeded") !== "running";
    await db.insert(heartbeatRuns).values({ id, companyId: owner.companyId, agentId: owner.agentId, scopeKind: "issue",
      issueId: owner.issueId, nativeIssueId: owner.issueId, runtimeMode: "native", driverKind: "codex_app_server",
      status: spec.status ?? "succeeded", nativeSessionId: spec.sessionId, runnerInstanceId: randomUUID(),
      startedAt: createdAt, finishedAt: terminal ? new Date(createdAt.getTime() + 1_000) : null, createdAt,
      ...(spec.profile ? { runnerProfileJson: spec.profile } : {}),
      ...(terminal ? {} : { processPid: 4242, controllerLeaseExpiresAt: new Date(Date.now() + 600_000) }) });
    if (terminal && spec.stopped !== false) await recordStop({ ...owner, id });
    return id;
  }

  async function recordStop(run: { id: string; companyId: string; agentId: string }) {
    await db.insert(heartbeatRunEvents).values({ companyId: run.companyId, runId: run.id, agentId: run.agentId, seq: ++seq,
      eventType: "native.local_process_stopped", stream: "system", level: "info", message: "Stopped", payload: {} });
  }

  async function writeFile(file: string, contents: string) {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await fs.writeFile(file, contents, { mode: 0o600 });
  }

  async function exists(target: string) {
    return await fs.lstat(target).then(() => true, (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    });
  }

  /** The Run's generated runtime copies, plus a managed OpenCode provider home when asked. */
  async function writeRunRoot(companyId: string, runId: string, providerHome = false) {
    const root = nativeRuntimeAssetsRoot({ companyId, runId });
    await writeFile(path.join(root, "bundles", "AGENTS.md"), `runtime context of ${runId}`);
    if (providerHome) await writeFile(path.join(managedOpenCodeRuntimeDirectory({ companyId, runId }), "opencode.db"), "provider transcript");
    return root;
  }

  function controlPlane(sessionId: string, runId: string, transcript: string) {
    return JSON.stringify({ schema: "paperclip.runner.durable.control-plane-state.v1",
      identity: { runnerInstanceId: randomUUID(), environmentLeaseId: randomUUID(), runId, normalizedSessionId: sessionId,
        turnId: "turn-1", itemId: "item-1" },
      committedEvents: [{ sourceSeq: 1, envelope: { text: transcript } }] });
  }

  /** The executor's v2 layout: one folder per scope digest, with a continuity-break archive. */
  async function writeScope(sessionId: string, runId: string, priorRunId: string, transcript: string) {
    const root = path.join(base, sha256(`scope:${randomUUID()}`));
    await writeFile(path.join(root, "control-plane", "control-plane-state.json"), controlPlane(sessionId, runId, transcript));
    await writeFile(path.join(root, "codex-home", "sessions", "rollout.jsonl"), `${transcript} provider transcript`);
    const archive = path.join(root, "continuity-breaks", `${Date.now()}-${randomUUID()}`);
    await writeFile(path.join(archive, "control-plane", "control-plane-state.json"), controlPlane(sessionId, priorRunId, `${transcript} (prior)`));
    await writeFile(path.join(archive, "codex-home", "auth.json"), "archived provider credential");
    return root;
  }

  /** One company with the deleted agent, a neighbour agent and a second company. */
  async function seed() {
    const companyId = await company(), otherCompanyId = await company();
    const deleted = await agent(companyId), neighbour = await agent(companyId), other = await agent(otherCompanyId);
    const sessionId = randomUUID(), neighbourSessionId = randomUUID(), otherSessionId = randomUUID();
    const run1 = await insertRun(deleted, { sessionId });
    const run2 = await insertRun(deleted, { sessionId });
    // A native Run that never received a session id keys its folder by its own id.
    const unbound = await insertRun(deleted, { sessionId: null });
    const neighbourRun = await insertRun(neighbour, { sessionId: neighbourSessionId });
    const otherRun = await insertRun(other, { sessionId: otherSessionId });
    const scope = await writeScope(sessionId, run2, run1, "Run 2");
    const legacy = path.join(base, sha256(JSON.stringify([companyId, sessionId])));
    await writeFile(path.join(legacy, "codex-home", "sessions", "rollout.jsonl"), "legacy transcript");
    const quarantined = path.join(base, "quarantine", `${path.basename(scope)}.identity_indeterminate.${Date.now()}.1.${randomUUID()}`);
    await writeFile(path.join(quarantined, "control-plane", "control-plane-state.json"), controlPlane(sessionId, run1, "quarantined"));
    const unboundScope = path.join(base, sha256(`session-${unbound}`));
    await writeFile(path.join(unboundScope, "codex-home", "sessions", "rollout.jsonl"), "unbound transcript");
    const neighbourScope = await writeScope(neighbourSessionId, neighbourRun, neighbourRun, "Neighbour");
    const otherScope = await writeScope(otherSessionId, otherRun, otherRun, "Other company");
    const roots = [await writeRunRoot(companyId, run1, true), await writeRunRoot(companyId, run2), await writeRunRoot(companyId, unbound)];
    const neighbourRoot = await writeRunRoot(companyId, neighbourRun, true);
    const otherRoot = await writeRunRoot(otherCompanyId, otherRun, true);
    return { companyId, otherCompanyId, deleted, neighbour, other, sessionId, run1, run2, unbound, neighbourRun, otherRun,
      erasedFolders: [scope, legacy, quarantined, unboundScope], roots, neighbourScope, otherScope, neighbourRoot, otherRoot };
  }

  async function runIds(where: ReturnType<typeof eq>) {
    return (await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(where)).map(row => row.id).sort();
  }

  it("agent deletion erases the agent's run folders, provider home and durable session folders, and nothing else", async () => {
    const s = await seed();
    // An ordinary non-Native Run of the agent is deleted as before.
    const legacyRun = randomUUID();
    await db.insert(heartbeatRuns).values({ id: legacyRun, companyId: s.companyId, agentId: s.deleted.agentId, status: "succeeded" });

    const removed = await agentService(db).remove(s.deleted.agentId);

    expect(removed?.id).toBe(s.deleted.agentId);
    expect(await runIds(eq(heartbeatRuns.agentId, s.deleted.agentId))).toEqual([]);
    for (const target of [...s.roots, ...s.erasedFolders]) expect(await exists(target)).toBe(false);
    for (const target of [s.neighbourScope, s.otherScope, s.neighbourRoot, s.otherRoot]) expect(await exists(target)).toBe(true);
    expect(await fs.readFile(path.join(s.neighbourScope, "codex-home", "sessions", "rollout.jsonl"), "utf8"))
      .toBe("Neighbour provider transcript");
    expect(await fs.readFile(path.join(managedOpenCodeRuntimeDirectory({ companyId: s.companyId, runId: s.neighbourRun }), "opencode.db"), "utf8"))
      .toBe("provider transcript");
    expect(await runIds(eq(heartbeatRuns.agentId, s.neighbour.agentId))).toEqual([s.neighbourRun]);
    expect((await fs.readdir(base)).filter(name => name.includes(".erasing-"))).toEqual([]);
  });

  it("agent deletion refuses while a session Run is live, deletes nothing, and erases after its Stop", async () => {
    const s = await seed();
    // The neighbour agent's Run in the deleted agent's session writes into the same durable folder.
    const live = await insertRun(s.neighbour, { sessionId: s.sessionId, status: "running" });

    await expect(agentService(db).remove(s.deleted.agentId)).rejects.toMatchObject({ status: 409,
      details: { code: "agent_deletion_runtime_erasure_pending" } });

    expect(await db.select({ id: agents.id }).from(agents).where(eq(agents.id, s.deleted.agentId))).toHaveLength(1);
    expect(await runIds(eq(heartbeatRuns.agentId, s.deleted.agentId))).toEqual([s.run1, s.run2, s.unbound].sort());
    for (const target of [...s.roots, ...s.erasedFolders]) expect(await exists(target)).toBe(true);

    await db.update(heartbeatRuns).set({ status: "succeeded", processPid: null, controllerLeaseExpiresAt: null, finishedAt: new Date() })
      .where(eq(heartbeatRuns.id, live));
    await agentService(db).remove(s.deleted.agentId);
    for (const target of [...s.roots, ...s.erasedFolders]) expect(await exists(target)).toBe(false);
    for (const target of [s.neighbourScope, s.otherScope, s.neighbourRoot, s.otherRoot]) expect(await exists(target)).toBe(true);
  });

  it("agent deletion keeps a managed OpenCode provider home until its Run's recorded Stop", async () => {
    const owner = await agent(await company());
    const runId = await insertRun(owner, { sessionId: randomUUID(), stopped: false });
    const root = await writeRunRoot(owner.companyId, runId, true);

    await expect(agentService(db).remove(owner.agentId)).rejects.toMatchObject({ status: 409,
      details: { code: "agent_deletion_runtime_erasure_pending", reason: "Managed OpenCode data erasure awaits Native Stop receipt" } });
    expect(await exists(managedOpenCodeRuntimeDirectory({ companyId: owner.companyId, runId }))).toBe(true);
    expect(await runIds(eq(heartbeatRuns.id, runId))).toEqual([runId]);

    await recordStop({ ...owner, id: runId });
    await agentService(db).remove(owner.agentId);
    expect(await exists(root)).toBe(false);
  });

  it("agent deletion refuses a Run whose managed remote session tree it cannot erase", async () => {
    const owner = await agent(await company());
    const runId = await insertRun(owner, { sessionId: randomUUID(),
      profile: { nativeRemoteRuntimeAssetLocator: { schema: "paperclip.native-remote-runtime-asset-locator.v1" } } });
    const root = await writeRunRoot(owner.companyId, runId);

    await expect(agentService(db).remove(owner.agentId)).rejects.toMatchObject({ status: 409,
      details: { code: "agent_deletion_remote_runtime_erasure_required" } });
    expect(await exists(root)).toBe(true);
    expect(await runIds(eq(heartbeatRuns.id, runId))).toEqual([runId]);
  });

  it("agent deletion returns a 409 and deletes nothing when a Run has a finalization record", async () => {
    const owner = await agent(await company());
    const runId = await insertRun(owner, { sessionId: randomUUID() });
    await db.insert(nativeRunFinalizations).values({ runId, companyId: owner.companyId, issueId: owner.issueId,
      phase: "committed", leaseOwner: null, leaseExpiresAt: null });
    const root = await writeRunRoot(owner.companyId, runId);

    await expect(agentService(db).remove(owner.agentId)).rejects.toMatchObject({ status: 409,
      details: { code: "agent_deletion_requires_governed_cleanup" } });

    expect(await db.select({ id: agents.id }).from(agents).where(eq(agents.id, owner.agentId))).toHaveLength(1);
    expect(await runIds(eq(heartbeatRuns.id, runId))).toEqual([runId]);
    expect(await db.select({ id: nativeRunFinalizations.runId }).from(nativeRunFinalizations)
      .where(eq(nativeRunFinalizations.runId, runId))).toHaveLength(1);
    expect(await db.select({ id: issues.id }).from(issues).where(eq(issues.id, owner.issueId))).toHaveLength(1);
    expect(await exists(root)).toBe(true);
  });

  it("a Run that was not gated rolls the deletion's erasure back before any file is removed", async () => {
    const s = await seed();
    await expect(db.transaction(async rawTx => {
      const tx = rawTx as unknown as Db;
      await lockNativeRunDeletionPrivacy(tx, s.companyId);
      const erasure = await prepareNativeRunDeletionErasure(tx, { companyId: s.companyId, agentId: s.deleted.agentId });
      await erasure.execute([s.run1, s.run2, s.unbound, randomUUID()]);
    })).rejects.toMatchObject({ status: 409, details: { code: "agent_deletion_runtime_erasure_pending" } });
    for (const target of [...s.roots, ...s.erasedFolders]) expect(await exists(target)).toBe(true);
  });

  it("the legacy company remove erases every runtime folder and durable session folder of the company, and nothing else", async () => {
    const s = await seed();
    // A folder whose Run row an earlier deletion already removed has no other owner.
    const orphan = nativeRuntimeAssetsRoot({ companyId: s.companyId, runId: randomUUID() });
    await writeFile(path.join(orphan, "bundles", "AGENTS.md"), "orphaned runtime context");

    const removed = await companyService(db).remove(s.companyId);

    expect(removed?.id).toBe(s.companyId);
    expect(await runIds(eq(heartbeatRuns.companyId, s.companyId))).toEqual([]);
    for (const target of [...s.roots, ...s.erasedFolders, s.neighbourScope, s.neighbourRoot, orphan,
      path.dirname(s.neighbourRoot)]) expect(await exists(target)).toBe(false);
    for (const target of [s.otherScope, s.otherRoot]) expect(await exists(target)).toBe(true);
    expect(await fs.readFile(path.join(s.otherScope, "codex-home", "sessions", "rollout.jsonl"), "utf8"))
      .toBe("Other company provider transcript");
    expect(await runIds(eq(heartbeatRuns.companyId, s.otherCompanyId))).toEqual([s.otherRun]);
  });

  it("the legacy company remove refuses a managed OpenCode provider home that has no current Run Stop owner", async () => {
    const s = await seed();
    const orphanHome = managedOpenCodeRuntimeDirectory({ companyId: s.companyId, runId: randomUUID() });
    await writeFile(path.join(orphanHome, "opencode.db"), "orphaned provider transcript");

    await expect(companyService(db).remove(s.companyId)).rejects.toMatchObject({ status: 409,
      details: { code: "company_removal_runtime_erasure_pending", reason: "Managed OpenCode runtime data has no current Run Stop owner" } });
    expect(await db.select({ id: companies.id }).from(companies).where(eq(companies.id, s.companyId))).toHaveLength(1);
    for (const target of [...s.roots, ...s.erasedFolders, orphanHome]) expect(await exists(target)).toBe(true);
  });

  it("the legacy company remove refuses while a company Run is live and deletes nothing", async () => {
    const s = await seed();
    await insertRun(s.neighbour, { sessionId: randomUUID(), status: "running" });

    await expect(companyService(db).remove(s.companyId)).rejects.toMatchObject({ status: 409,
      details: { code: "company_removal_runtime_erasure_pending" } });

    expect(await db.select({ id: companies.id }).from(companies).where(eq(companies.id, s.companyId))).toHaveLength(1);
    expect(await runIds(eq(heartbeatRuns.companyId, s.companyId))).toHaveLength(5);
    for (const target of [...s.roots, ...s.erasedFolders, s.neighbourScope, s.neighbourRoot]) expect(await exists(target)).toBe(true);
  });
});
