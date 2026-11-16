import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, desc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, companyDeletionOperations, createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, environmentLeases,
  environments, heartbeatRunEvents, heartbeatRuns, issues, memoryJobs, nativeRunFinalizations } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { memoryJobService } from "../memory/memory-jobs.js";
import { removeRuntimeStorageTree } from "../runtime-skill-cache.js";
import {
  assertCompanyManagedOpenCodeRuntimeDataErased,
  carryManagedOpenCodeSessionData,
  enqueueCompanyManagedOpenCodeRuntimeErasure,
  eraseNativeRuntimeAssets,
  managedOpenCodeRuntimeDirectory,
  nativeRuntimeAssetsRoot,
} from "./runtime-asset-retention.js";

// CONF15-R (A). A verified cold lease handoff may carry Run 1's exact managed
// OpenCode session data into Run 2's own per-Run folder. Erasing Run 1 then
// also erases every later Run of that session after its Stop (CE-15).
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("Managed OpenCode cross-Run carry and erasure cascade (CONF15-R)", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let home: string;
  const oldHome = process.env.PAPERCLIP_HOME, oldInstance = process.env.PAPERCLIP_INSTANCE_ID;
  const environmentId = randomUUID();

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("native-session-carry-");
    db = createDb(database.connectionString);
    home = await fs.mkdtemp(path.join(os.tmpdir(), "native-session-carry-"));
    process.env.PAPERCLIP_HOME = home;
    process.env.PAPERCLIP_INSTANCE_ID = "native_session_carry";
    await db.insert(environments).values({ id: environmentId, name: `carry-sandbox-${environmentId}`, driver: "sandbox" });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  afterAll(async () => {
    if (oldHome === undefined) delete process.env.PAPERCLIP_HOME; else process.env.PAPERCLIP_HOME = oldHome;
    if (oldInstance === undefined) delete process.env.PAPERCLIP_INSTANCE_ID; else process.env.PAPERCLIP_INSTANCE_ID = oldInstance;
    if (home) await removeRuntimeStorageTree(home).catch(() => undefined);
    await database?.cleanup();
  }, 30_000);

  type RunSpec = { companyId: string; agentId: string; issueId: string; sessionId: string; status?: string;
    createdAt: Date; driverKind?: string; stopped?: boolean };

  async function tenant(options: { retiredTask?: boolean } = {}) {
    const companyId = randomUUID(), agentId = randomUUID(), otherAgentId = randomUUID();
    const issueId = randomUUID(), otherIssueId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Carry fixture", issuePrefix: randomUUID() });
    await db.insert(agents).values([{ id: agentId, companyId, name: "Carry agent", adapterType: "paperclip_runner" },
      { id: otherAgentId, companyId, name: "Other carry agent", adapterType: "paperclip_runner" }]);
    // A retired native Task is an existing Source erasure receipt for its Runs.
    await db.insert(issues).values([options.retiredTask
      ? { id: issueId, companyId, title: "Carry Task", status: "cancelled", hiddenAt: new Date(), conversationRetiredAt: new Date() }
      : { id: issueId, companyId, title: "Carry Task", assigneeAgentId: agentId },
    { id: otherIssueId, companyId, title: "Other carry Task", assigneeAgentId: agentId }]);
    return { companyId, agentId, otherAgentId, issueId, otherIssueId };
  }

  let seq = 0;
  async function insertRun(spec: RunSpec) {
    const id = randomUUID();
    const terminal = (spec.status ?? "succeeded") !== "running";
    await db.insert(heartbeatRuns).values({ id, companyId: spec.companyId, agentId: spec.agentId, scopeKind: "issue",
      issueId: spec.issueId, nativeIssueId: spec.issueId, runtimeMode: "native", driverKind: spec.driverKind ?? "opencode_server",
      status: spec.status ?? "succeeded", nativeSessionId: spec.sessionId, runnerInstanceId: randomUUID(),
      startedAt: spec.createdAt, finishedAt: terminal ? new Date(spec.createdAt.getTime() + 1_000) : null,
      createdAt: spec.createdAt, ...(terminal ? {} : { processPid: 4242, controllerLeaseExpiresAt: new Date(Date.now() + 600_000) }) });
    if (spec.stopped !== false && terminal) await stop({ ...spec, id });
    return id;
  }

  /** The existing local Stop owner: observed process stop event and settled finalization. */
  async function stop(run: { id: string; companyId: string; agentId: string; issueId: string }) {
    await db.update(heartbeatRuns).set({ status: "succeeded", processPid: null, processGroupId: null,
      controllerLeaseExpiresAt: null, finishedAt: new Date() }).where(eq(heartbeatRuns.id, run.id));
    await db.insert(heartbeatRunEvents).values({ companyId: run.companyId, runId: run.id, agentId: run.agentId, seq: ++seq,
      eventType: "native.local_process_stopped", stream: "system", level: "info", message: "Stopped", payload: {} });
    await db.insert(nativeRunFinalizations).values({ runId: run.id, companyId: run.companyId, issueId: run.issueId,
      phase: "committed", leaseOwner: null, leaseExpiresAt: null }).onConflictDoNothing();
  }

  async function lease(companyId: string, runId: string, issueId: string) {
    const id = randomUUID();
    await db.insert(environmentLeases).values({ id, companyId, environmentId, issueId, heartbeatRunId: runId, status: "active",
      provider: "fixture-sandbox", providerLeaseId: `sandbox-${randomUUID()}`, metadata: { remoteCwd: "/sandbox/workspace" } });
    return id;
  }

  /** Real OpenCode session-root shape: only `workspace` and `data` are session data. */
  async function writeSession(companyId: string, runId: string, sessionId: string, marker = "Run 1 transcript") {
    const root = path.join(managedOpenCodeRuntimeDirectory({ companyId, runId }), sessionId);
    await fs.mkdir(path.join(root, "data", "opencode", "storage", "session"), { recursive: true, mode: 0o700 });
    await fs.mkdir(path.join(root, "config", "opencode"), { recursive: true, mode: 0o700 });
    await fs.mkdir(path.join(root, "cache"), { recursive: true, mode: 0o700 });
    await fs.mkdir(path.join(root, "home-launch"), { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(root, "workspace"), "/sandbox/workspace\n", { mode: 0o600 });
    await fs.writeFile(path.join(root, "data", "opencode", "opencode.db"), `${marker} provider database`, { mode: 0o600 });
    await fs.writeFile(path.join(root, "data", "opencode", "storage", "session", "ses_fixture.json"),
      JSON.stringify({ id: "ses_fixture", marker }), { mode: 0o644 });
    await fs.writeFile(path.join(root, "config", "opencode", "opencode.json"), "per-launch bridge secret", { mode: 0o400 });
    await fs.writeFile(path.join(root, "cache", "models.json"), "{}", { mode: 0o600 });
    await fs.writeFile(path.join(root, "home-launch", "launch-only"), "per-launch home", { mode: 0o600 });
    await fs.chmod(path.join(root, "data", "opencode", "storage"), 0o500);
    return root;
  }

  async function exists(target: string) {
    return await fs.lstat(target).then(() => true, (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    });
  }

  async function seedCarry(options: { priorStatus?: string; priorDriver?: string } = {}) {
    const t = await tenant();
    const sessionId = randomUUID(), base = Date.now() - 600_000;
    const run1 = await insertRun({ ...t, sessionId, createdAt: new Date(base), status: options.priorStatus,
      driverKind: options.priorDriver });
    const run2 = await insertRun({ ...t, sessionId, createdAt: new Date(base + 60_000), status: "running" });
    const lease2 = await lease(t.companyId, run2, t.issueId);
    const source = await writeSession(t.companyId, run1, sessionId);
    const target = path.join(managedOpenCodeRuntimeDirectory({ companyId: t.companyId, runId: run2 }), sessionId);
    const handoff = { priorRunId: run1, normalizedSessionId: sessionId, currentEnvironmentLeaseId: lease2 };
    const carry = (overrides: Partial<typeof handoff> | null = {}, options: Parameters<typeof carryManagedOpenCodeSessionData>[2] = {}) =>
      carryManagedOpenCodeSessionData(db, { companyId: t.companyId, runId: run2,
        handoff: overrides === null ? null : { ...handoff, ...overrides } }, options);
    return { ...t, sessionId, run1, run2, lease2, source, target, handoff, carry, base };
  }

  async function expectRefused(seeded: Awaited<ReturnType<typeof seedCarry>>, result: Awaited<ReturnType<typeof carryManagedOpenCodeSessionData>>,
    refusal: string) {
    expect(result).toEqual({ ok: false, refusal });
    expect(await exists(seeded.target)).toBe(false);
    const homeEntries = await fs.readdir(path.dirname(seeded.target)).catch(() => [] as string[]);
    expect(homeEntries.filter(name => name.startsWith(".carry-"))).toEqual([]);
  }

  describe("carry", () => {
    it("copies exactly Run 1's session data into Run 2's own folder after a verified handoff", async () => {
      const seeded = await seedCarry();
      const result = await seeded.carry();
      expect(result).toMatchObject({ ok: true, status: "carried", entryCount: 7 });
      expect(await fs.readFile(path.join(seeded.target, "workspace"), "utf8")).toBe("/sandbox/workspace\n");
      expect(await fs.readFile(path.join(seeded.target, "data", "opencode", "opencode.db"), "utf8"))
        .toBe("Run 1 transcript provider database");
      expect((await fs.stat(path.join(seeded.target, "data", "opencode", "storage", "session", "ses_fixture.json"))).mode & 0o777)
        .toBe(0o644);
      expect((await fs.stat(path.join(seeded.target, "data", "opencode", "storage"))).mode & 0o777).toBe(0o500);
      // Per-launch secrets, cache and homes are never carried.
      for (const name of ["config", "cache", "home-launch"]) expect(await exists(path.join(seeded.target, name))).toBe(false);
      // Run 1 keeps its own folder; Run 2's is separate, nothing is shared.
      expect(await fs.readFile(path.join(seeded.source, "data", "opencode", "opencode.db"), "utf8"))
        .toBe("Run 1 transcript provider database");
      expect((await fs.stat(path.join(seeded.target, "workspace"))).ino)
        .not.toBe((await fs.stat(path.join(seeded.source, "workspace"))).ino);
      // Idempotent when the same exact copy is already present.
      expect(await seeded.carry()).toMatchObject({ ok: true, status: "already_present", digest: (result as { digest: string }).digest });
    });

    it("refuses without a handoff", async () => {
      const seeded = await seedCarry();
      await expectRefused(seeded, await seeded.carry(null), "no_handoff");
    });

    it("refuses a handoff accepted for another Run", async () => {
      const seeded = await seedCarry();
      const run3 = await insertRun({ ...seeded, createdAt: new Date(seeded.base + 120_000), status: "running" });
      const otherLease = await lease(seeded.companyId, run3, seeded.issueId);
      await expectRefused(seeded, await seeded.carry({ currentEnvironmentLeaseId: otherLease }), "no_handoff");
    });

    it("refuses a handoff for another session", async () => {
      const seeded = await seedCarry();
      await expectRefused(seeded, await seeded.carry({ normalizedSessionId: randomUUID() }), "no_handoff");
    });

    it("refuses a prior Run of another company", async () => {
      const seeded = await seedCarry();
      const other = await tenant();
      const foreign = await insertRun({ companyId: other.companyId, agentId: seeded.agentId, issueId: seeded.issueId,
        sessionId: seeded.sessionId, createdAt: new Date(seeded.base), stopped: false });
      await writeSession(other.companyId, foreign, seeded.sessionId, "Foreign company transcript");
      await expectRefused(seeded, await seeded.carry({ priorRunId: foreign }), "scope_mismatch");
    });

    it("refuses a prior Run of another Agent", async () => {
      const seeded = await seedCarry();
      const foreign = await insertRun({ ...seeded, agentId: seeded.otherAgentId, createdAt: new Date(seeded.base) });
      await writeSession(seeded.companyId, foreign, seeded.sessionId, "Other Agent transcript");
      await expectRefused(seeded, await seeded.carry({ priorRunId: foreign }), "scope_mismatch");
    });

    it("refuses a prior Run of another Task", async () => {
      const seeded = await seedCarry();
      const foreign = await insertRun({ ...seeded, issueId: seeded.otherIssueId, createdAt: new Date(seeded.base) });
      await writeSession(seeded.companyId, foreign, seeded.sessionId, "Other Task transcript");
      await expectRefused(seeded, await seeded.carry({ priorRunId: foreign }), "scope_mismatch");
    });

    it("refuses a prior Run of another session", async () => {
      const seeded = await seedCarry();
      const foreign = await insertRun({ ...seeded, sessionId: randomUUID(), createdAt: new Date(seeded.base) });
      // Even a folder named for this session under that Run is not this session's data.
      await writeSession(seeded.companyId, foreign, seeded.sessionId, "Other session transcript");
      await expectRefused(seeded, await seeded.carry({ priorRunId: foreign }), "scope_mismatch");
    });

    it("refuses the current Run itself as the prior Run", async () => {
      const seeded = await seedCarry();
      await db.update(heartbeatRuns).set({ status: "succeeded" }).where(eq(heartbeatRuns.id, seeded.run2));
      await writeSession(seeded.companyId, seeded.run2, seeded.sessionId, "Run 2 own transcript");
      const result = await seeded.carry({ priorRunId: seeded.run2 });
      expect(result).toEqual({ ok: false, refusal: "scope_mismatch" });
    });

    it("refuses a prior Run created after the current Run", async () => {
      const seeded = await seedCarry();
      const later = await insertRun({ ...seeded, createdAt: new Date(seeded.base + 120_000) });
      await writeSession(seeded.companyId, later, seeded.sessionId, "Later Run transcript");
      await expectRefused(seeded, await seeded.carry({ priorRunId: later }), "scope_mismatch");
    });

    it("refuses a prior Run that is not terminal", async () => {
      const seeded = await seedCarry({ priorStatus: "running" });
      await expectRefused(seeded, await seeded.carry(), "scope_mismatch");
    });

    it("refuses a prior Run that is not managed OpenCode", async () => {
      const seeded = await seedCarry({ priorDriver: "codex" });
      await expectRefused(seeded, await seeded.carry(), "scope_mismatch");
    });

    for (const status of ["queued", "succeeded"] as const) {
      it(`refuses when Run 1 has a ${status} erasure job`, async () => {
        const seeded = await seedCarry();
        await db.insert(memoryJobs).values({ companyId: seeded.companyId, operationType: "retention", status,
          jobKey: `runtime-asset-erasure:v1:${seeded.run1}`,
          ...(status === "succeeded" ? { finishedAt: new Date() } : {}),
          sourceRefJson: { kind: "runtime_asset_erasure", runId: seeded.run1, legacyDigests: [] } });
        await expectRefused(seeded, await seeded.carry(), "prior_erasure_pending");
      });
    }

    it("refuses when an earlier Run of the session has an erasure job", async () => {
      const seeded = await seedCarry();
      const run0 = await insertRun({ ...seeded, createdAt: new Date(seeded.base - 60_000) });
      await db.insert(memoryJobs).values({ companyId: seeded.companyId, operationType: "retention", status: "failed",
        finishedAt: new Date(), jobKey: `runtime-asset-erasure:v1:${run0}`, sourceRefJson: { kind: "runtime_asset_erasure", runId: run0, legacyDigests: [] } });
      await expectRefused(seeded, await seeded.carry(), "prior_erasure_pending");
    });

    it("refuses when Run 1's folder is gone", async () => {
      const seeded = await seedCarry();
      await removeRuntimeStorageTree(managedOpenCodeRuntimeDirectory({ companyId: seeded.companyId, runId: seeded.run1 }));
      await expectRefused(seeded, await seeded.carry(), "source_missing");
    });

    it("refuses when Run 1's session data is incomplete", async () => {
      const seeded = await seedCarry();
      await removeRuntimeStorageTree(path.join(seeded.source, "data"));
      await expectRefused(seeded, await seeded.carry(), "source_missing");
    });

    it("refuses a copy whose digest does not equal the source", async () => {
      const seeded = await seedCarry();
      const result = await seeded.carry({}, { afterCopy: async staging => {
        await fs.writeFile(path.join(staging, "data", "opencode", "opencode.db"), "Tampered copy");
      } });
      await expectRefused(seeded, result, "digest_mismatch");
    });

    it("refuses a source that changed during the copy", async () => {
      const seeded = await seedCarry();
      const result = await seeded.carry({}, { afterCopy: async () => {
        await fs.writeFile(path.join(seeded.source, "data", "opencode", "opencode.db"), "Run 1 changed during the carry");
      } });
      await expectRefused(seeded, result, "digest_mismatch");
    });

    it("refuses a symlink in the session data", async () => {
      const seeded = await seedCarry();
      const outside = path.join(home, `outside-${randomUUID()}`);
      await fs.writeFile(outside, "Operator-owned file");
      await fs.symlink(outside, path.join(seeded.source, "data", "opencode", "link"));
      await expectRefused(seeded, await seeded.carry(), "symlink");
    });

    it("refuses a special file in the session data", async () => {
      const seeded = await seedCarry();
      const fifo = spawnSync("mkfifo", [path.join(seeded.source, "data", "opencode", "pipe")]);
      expect(fifo.status).toBe(0);
      await expectRefused(seeded, await seeded.carry(), "special_file");
    });

    it("refuses a hard-linked file in the session data", async () => {
      const seeded = await seedCarry();
      const outside = path.join(home, `outside-${randomUUID()}`);
      await fs.writeFile(outside, "Another owner's file");
      await fs.link(outside, path.join(seeded.source, "data", "opencode", "linked.db"));
      await expectRefused(seeded, await seeded.carry(), "hardlink");
    });

    it("refuses a source path outside Run 1's own folder", async () => {
      const seeded = await seedCarry();
      const providerHome = managedOpenCodeRuntimeDirectory({ companyId: seeded.companyId, runId: seeded.run1 });
      const elsewhere = path.join(home, `elsewhere-${randomUUID()}`);
      await fs.rename(providerHome, elsewhere);
      await fs.symlink(elsewhere, providerHome);
      await expectRefused(seeded, await seeded.carry(), "path_escape");
    });

    it("refuses a target path outside Run 2's own folder", async () => {
      const seeded = await seedCarry();
      const elsewhere = path.join(home, `elsewhere-${randomUUID()}`);
      await fs.mkdir(elsewhere);
      await fs.mkdir(nativeRuntimeAssetsRoot({ companyId: seeded.companyId, runId: seeded.run2 }), { recursive: true });
      await fs.symlink(elsewhere, managedOpenCodeRuntimeDirectory({ companyId: seeded.companyId, runId: seeded.run2 }));
      expect(await seeded.carry()).toEqual({ ok: false, refusal: "path_escape" });
      expect(await fs.readdir(elsewhere)).toEqual([]);
    });

    it("refuses a session tree over its bound", async () => {
      const seeded = await seedCarry();
      await expectRefused(seeded, await seeded.carry({}, { limits: { maxEntries: 3 } }), "bound_exceeded");
    });

    it("refuses to replace a different session copy already in Run 2's folder", async () => {
      const seeded = await seedCarry();
      await writeSession(seeded.companyId, seeded.run2, seeded.sessionId, "Run 2 own transcript");
      expect(await seeded.carry()).toEqual({ ok: false, refusal: "target_conflict" });
      expect(await fs.readFile(path.join(seeded.target, "data", "opencode", "opencode.db"), "utf8"))
        .toBe("Run 2 own transcript provider database");
    });
  });

  describe("erasure cascade", () => {
    async function seedCascade() {
      const t = await tenant({ retiredTask: true });
      const other = await tenant();
      const sessionId = randomUUID(), base = Date.now() - 600_000;
      const run1 = await insertRun({ ...t, sessionId, createdAt: new Date(base) });
      const run2 = await insertRun({ ...t, sessionId, createdAt: new Date(base + 60_000) });
      // Later Runs that cannot hold Run 1's bytes: another session, another
      // Task (same session id) and another company (same Agent, Task and session).
      // An earlier Run of the session cannot hold Run 1's bytes either.
      const run0 = await insertRun({ ...t, sessionId, createdAt: new Date(base - 60_000) });
      const otherAgent = await insertRun({ ...t, agentId: t.otherAgentId, sessionId, createdAt: new Date(base + 120_000) });
      const otherSession = await insertRun({ ...t, sessionId: randomUUID(), createdAt: new Date(base + 120_000) });
      const otherTask = await insertRun({ ...t, issueId: t.otherIssueId, sessionId, createdAt: new Date(base + 120_000) });
      // Its Stop owner cannot exist for a foreign Task; the cascade must never reach it.
      const otherCompany = await insertRun({ companyId: other.companyId, agentId: t.agentId, issueId: t.issueId, sessionId,
        createdAt: new Date(base + 120_000), stopped: false });
      await writeSession(t.companyId, run1, sessionId);
      await writeSession(t.companyId, run2, sessionId, "Run 2 carried and continued transcript");
      await writeSession(t.companyId, run0, sessionId, "Run 0 transcript");
      await writeSession(t.companyId, otherAgent, sessionId, "Other Agent transcript");
      await writeSession(t.companyId, otherSession, sessionId, "Other session transcript");
      await writeSession(t.companyId, otherTask, sessionId, "Other Task transcript");
      await writeSession(other.companyId, otherCompany, sessionId, "Other company transcript");
      // Run 2's own generated runtime context is not carried data.
      const run2Context = path.join(nativeRuntimeAssetsRoot({ companyId: t.companyId, runId: run2 }), "bundles", "AGENTS.md");
      await fs.mkdir(path.dirname(run2Context), { recursive: true });
      await fs.writeFile(run2Context, "Run 2 runtime context");
      const homeOf = (companyId: string, runId: string) => managedOpenCodeRuntimeDirectory({ companyId, runId });
      return { ...t, other, sessionId, base, run0, run1, run2, otherAgent, otherSession, otherTask, otherCompany, run2Context, homeOf };
    }

    it("erasing Run 1 removes Run 1's folder and the carried copy in Run 2's folder, and nothing else", async () => {
      const s = await seedCascade();
      await eraseNativeRuntimeAssets(db, { companyId: s.companyId, runId: s.run1 }, []);
      expect(await exists(nativeRuntimeAssetsRoot({ companyId: s.companyId, runId: s.run1 }))).toBe(false);
      expect(await exists(s.homeOf(s.companyId, s.run2))).toBe(false);
      expect(await fs.readFile(s.run2Context, "utf8")).toBe("Run 2 runtime context");
      for (const runId of [s.run0, s.otherAgent, s.otherSession, s.otherTask])
        expect(await exists(path.join(s.homeOf(s.companyId, runId), s.sessionId, "data"))).toBe(true);
      expect(await exists(path.join(s.homeOf(s.other.companyId, s.otherCompany), s.sessionId, "data"))).toBe(true);
      // Idempotent re-run.
      await eraseNativeRuntimeAssets(db, { companyId: s.companyId, runId: s.run1 }, []);
      expect(await exists(s.homeOf(s.companyId, s.run2))).toBe(false);
      expect(await exists(path.join(s.homeOf(s.companyId, s.otherSession), s.sessionId, "data"))).toBe(true);
    });

    it("a still-active later Run defers the job; it erases both only after that Run's Stop", async () => {
      const s = await seedCascade();
      const run3 = await insertRun({ ...s, sessionId: s.sessionId, createdAt: new Date(s.base + 180_000), status: "running" });
      await writeSession(s.companyId, run3, s.sessionId, "Run 3 live transcript");
      await expect(eraseNativeRuntimeAssets(db, { companyId: s.companyId, runId: s.run1 }, []))
        .rejects.toThrow("awaits a later Run's confirmed Native Stop");
      for (const runId of [s.run1, s.run2, run3])
        expect(await exists(path.join(s.homeOf(s.companyId, runId), s.sessionId, "data"))).toBe(true);
      // Through the existing worker: the job fails and stays retryable.
      const jobKey = `runtime-asset-erasure:v1:${s.run1}`;
      await db.insert(memoryJobs).values({ companyId: s.companyId, operationType: "retention", jobKey,
        sourceRefJson: { kind: "runtime_asset_erasure", runId: s.run1, legacyDigests: [] } }).onConflictDoNothing();
      await db.update(memoryJobs).set({ status: "queued", updatedAt: new Date() }).where(and(
        eq(memoryJobs.companyId, s.companyId), sql`${memoryJobs.sourceRefJson}->>'kind'='runtime_asset_erasure'`));
      await memoryJobService(db).tick({ limit: 20, companyId: s.companyId });
      const [deferred] = await db.select().from(memoryJobs).where(and(eq(memoryJobs.companyId, s.companyId),
        eq(memoryJobs.jobKey, jobKey))).orderBy(desc(memoryJobs.attemptNumber)).limit(1);
      expect(deferred?.status).toBe("failed");
      expect(await exists(path.join(s.homeOf(s.companyId, run3), s.sessionId, "data"))).toBe(true);
      expect(await exists(path.join(s.homeOf(s.companyId, s.run1), s.sessionId, "data"))).toBe(true);
      // A terminal later Run without its Stop receipt still defers the job.
      await db.update(heartbeatRuns).set({ status: "succeeded", processPid: null, controllerLeaseExpiresAt: null,
        finishedAt: new Date() }).where(eq(heartbeatRuns.id, run3));
      await expect(eraseNativeRuntimeAssets(db, { companyId: s.companyId, runId: s.run1 }, []))
        .rejects.toThrow("awaits a later Run's Native Stop receipt");
      expect(await exists(path.join(s.homeOf(s.companyId, run3), s.sessionId, "data"))).toBe(true);
      await stop({ id: run3, companyId: s.companyId, agentId: s.agentId, issueId: s.issueId });
      await db.update(memoryJobs).set({ updatedAt: new Date(Date.now() - 61_000) }).where(and(
        eq(memoryJobs.companyId, s.companyId), eq(memoryJobs.status, "failed")));
      await memoryJobService(db).tick({ limit: 20, companyId: s.companyId });
      const [settled] = await db.select().from(memoryJobs).where(and(eq(memoryJobs.companyId, s.companyId),
        eq(memoryJobs.jobKey, jobKey))).orderBy(desc(memoryJobs.attemptNumber)).limit(1);
      expect(settled?.status).toBe("succeeded");
      for (const runId of [s.run1, s.run2, run3]) expect(await exists(s.homeOf(s.companyId, runId))).toBe(false);
      expect(await exists(path.join(s.homeOf(s.companyId, s.otherTask), s.sessionId, "data"))).toBe(true);
    });

    it("company purge still removes every managed provider home", async () => {
      const t = await tenant();
      const sessionId = randomUUID(), base = Date.now() - 600_000;
      const run1 = await insertRun({ ...t, sessionId, createdAt: new Date(base) });
      const run2 = await insertRun({ ...t, sessionId, createdAt: new Date(base + 60_000) });
      const run3 = await insertRun({ ...t, sessionId: randomUUID(), createdAt: new Date(base + 120_000) });
      for (const runId of [run1, run2, run3]) await writeSession(t.companyId, runId, sessionId, `Purge ${runId}`);
      const operationId = randomUUID();
      await db.insert(companyDeletionOperations).values({ id: operationId, companyId: t.companyId,
        requestedByUserId: "fixture-human", idempotencyKey: `carry-purge-${operationId}`, status: "processing", stage: "purge",
        evidence: { runtimesErasedAt: new Date().toISOString() } });
      await expect(assertCompanyManagedOpenCodeRuntimeDataErased(db, t.companyId, operationId)).rejects.toThrow();
      const scheduled = await enqueueCompanyManagedOpenCodeRuntimeErasure(db, t.companyId, operationId);
      expect(new Set(scheduled)).toEqual(new Set([run1, run2, run3]));
      await memoryJobService(db).tick({ limit: 20, companyId: t.companyId });
      await assertCompanyManagedOpenCodeRuntimeDataErased(db, t.companyId, operationId);
      for (const runId of [run1, run2, run3]) expect(await exists(managedOpenCodeRuntimeDirectory({ companyId: t.companyId, runId })))
        .toBe(false);
    });
  });
});
