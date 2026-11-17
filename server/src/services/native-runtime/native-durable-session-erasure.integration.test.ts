import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agents, companies, createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, heartbeatRunEvents, heartbeatRuns, issues,
  memoryJobs, nativeRunFinalizations } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { resolvePaperclipInstanceRoot } from "../../home-paths.js";
import { memoryJobService } from "../memory/memory-jobs.js";
import { removeRuntimeStorageTree } from "../runtime-skill-cache.js";
import { purgeCompanyContent } from "../saas/company-purge.js";
import { eraseNativeRuntimeAssets } from "./runtime-asset-retention.js";
import { eraseCompanyNativeDurableSessions, nativeDurableSessionsRoot } from "./native-durable-session-erasure.js";

// PRIV-R5. The controller's durable session folder of an erased session (its
// committed control-plane events, runner/provider state, continuity-break
// archives, quarantine and cleanup copies) is removed by the existing runtime
// asset erasure owner and by company purge, and nothing else is.
const support = await getEmbeddedPostgresTestSupport();
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

(support.supported ? describe : describe.skip)("Native durable session erasure (PRIV-R5)", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let home: string;
  let base: string;
  const oldEnv = { home: process.env.PAPERCLIP_HOME, instance: process.env.PAPERCLIP_INSTANCE_ID,
    state: process.env.PAPERCLIP_RUNNER_STATE_DIR };

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("native-durable-session-erasure-");
    db = createDb(database.connectionString);
    home = await fs.mkdtemp(path.join(os.tmpdir(), "native-durable-session-erasure-"));
    process.env.PAPERCLIP_HOME = home;
    process.env.PAPERCLIP_INSTANCE_ID = "native_durable_session_erasure";
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

  async function tenant() {
    const companyId = randomUUID(), agentId = randomUUID(), issueId = randomUUID(), liveIssueId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Durable session fixture", issuePrefix: randomUUID() });
    await db.insert(agents).values({ id: agentId, companyId, name: "Durable session agent", adapterType: "paperclip_runner" });
    // A retired native Task is an existing Source erasure receipt for its Runs.
    await db.insert(issues).values([
      { id: issueId, companyId, title: "Erased Task", status: "cancelled", hiddenAt: new Date(), conversationRetiredAt: new Date() },
      { id: liveIssueId, companyId, title: "Live Task", assigneeAgentId: agentId },
    ]);
    return { companyId, agentId, issueId, liveIssueId };
  }

  let seq = 0;
  async function insertRun(spec: { companyId: string; agentId: string; issueId: string; sessionId: string;
    status?: string; createdAt?: Date }) {
    const id = randomUUID(), createdAt = spec.createdAt ?? new Date(Date.now() - 600_000);
    const terminal = (spec.status ?? "succeeded") !== "running";
    await db.insert(heartbeatRuns).values({ id, companyId: spec.companyId, agentId: spec.agentId, scopeKind: "issue",
      issueId: spec.issueId, nativeIssueId: spec.issueId, runtimeMode: "native", driverKind: "codex_app_server",
      status: spec.status ?? "succeeded", nativeSessionId: spec.sessionId, runnerInstanceId: randomUUID(),
      startedAt: createdAt, finishedAt: terminal ? new Date(createdAt.getTime() + 1_000) : null, createdAt,
      ...(terminal ? {} : { processPid: 4242, controllerLeaseExpiresAt: new Date(Date.now() + 600_000) }) });
    if (terminal) await stop({ ...spec, id });
    return id;
  }

  async function stop(run: { id: string; companyId: string; agentId: string; issueId: string }) {
    await db.update(heartbeatRuns).set({ status: "succeeded", processPid: null, processGroupId: null,
      controllerLeaseExpiresAt: null, finishedAt: new Date() }).where(eq(heartbeatRuns.id, run.id));
    await db.insert(heartbeatRunEvents).values({ companyId: run.companyId, runId: run.id, agentId: run.agentId, seq: ++seq,
      eventType: "native.local_process_stopped", stream: "system", level: "info", message: "Stopped", payload: {} });
    await db.insert(nativeRunFinalizations).values({ runId: run.id, companyId: run.companyId, issueId: run.issueId,
      phase: "committed", leaseOwner: null, leaseExpiresAt: null }).onConflictDoNothing();
  }

  async function writeFile(file: string, contents: string, mode = 0o600) {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await fs.writeFile(file, contents, { mode });
  }

  function controlPlane(sessionId: string, runId: string, transcript: string) {
    return JSON.stringify({ schema: "paperclip.runner.durable.control-plane-state.v1",
      identity: { runnerInstanceId: randomUUID(), environmentLeaseId: randomUUID(), runId, normalizedSessionId: sessionId,
        turnId: "turn-1", itemId: "item-1" },
      committedEvents: [{ sourceSeq: 1, envelope: { text: transcript } }] });
  }

  function runnerState(sessionId: string, runId: string) {
    return JSON.stringify({ schema: "paperclip.runner.durable.state.v1", lifecycle: "suspended", runId,
      normalizedSessionId: sessionId, runnerInstanceId: randomUUID(), environmentLeaseId: randomUUID() });
  }

  /** The executor's v2 layout: one folder per scope digest. */
  async function writeScope(digest: string, sessionId: string, runId: string, priorRunId: string, transcript: string) {
    const root = path.join(base, digest);
    await writeFile(path.join(root, "control-plane", "control-plane-state.json"), controlPlane(sessionId, runId, transcript));
    await writeFile(path.join(root, "runner", "runner-state.json"), runnerState(sessionId, runId));
    await writeFile(path.join(root, "codex-home", "sessions", "rollout.jsonl"), `${transcript} provider transcript`);
    const archive = path.join(root, "continuity-breaks", `${Date.now()}-${randomUUID()}`);
    await writeFile(path.join(archive, "control-plane", "control-plane-state.json"), controlPlane(sessionId, priorRunId, `${transcript} (prior)`));
    await writeFile(path.join(archive, "runner", "runner-state.json"), runnerState(sessionId, priorRunId));
    await writeFile(path.join(archive, "codex-home", "auth.json"), "archived provider credential");
    await writeFile(path.join(archive, "codex-home", "sessions", "prior.jsonl"), `${transcript} prior transcript`);
    await writeFile(path.join(root, "failover-backups", "current", "manifest.json"), JSON.stringify({ normalizedSessionId: sessionId }));
    await fs.chmod(path.join(archive, "codex-home", "sessions"), 0o500);
    return root;
  }

  async function exists(target: string) {
    return await fs.lstat(target).then(() => true, (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    });
  }

  async function seedSession() {
    const t = await tenant(), other = await tenant();
    const sessionId = randomUUID(), neighbourSessionId = randomUUID(), otherSessionId = randomUUID();
    const base0 = Date.now() - 600_000;
    const run1 = await insertRun({ ...t, sessionId, createdAt: new Date(base0) });
    const run2 = await insertRun({ ...t, sessionId, createdAt: new Date(base0 + 60_000) });
    const neighbour = await insertRun({ ...t, issueId: t.liveIssueId, sessionId: neighbourSessionId });
    const otherRun = await insertRun({ ...other, issueId: other.liveIssueId, sessionId: otherSessionId });
    const digest = sha256(`scope:${randomUUID()}`), continuityOnly = sha256(`scope:${randomUUID()}`);
    const neighbourDigest = sha256(`scope:${randomUUID()}`), otherDigest = sha256(`scope:${randomUUID()}`);
    const unattributed = sha256(`scope:${randomUUID()}`);
    const scope = await writeScope(digest, sessionId, run2, run1, "Run 2 continued");
    // A continuity break whose new control plane was never written: only the archive names the session.
    const archiveOnly = path.join(base, continuityOnly, "continuity-breaks", `${Date.now()}-${randomUUID()}`);
    await writeFile(path.join(archiveOnly, "control-plane", "control-plane-state.json"), controlPlane(sessionId, run1, "Run 1"));
    await writeFile(path.join(base, continuityOnly, "codex-home", "sessions", "rollout.jsonl"), "Run 1 provider transcript");
    // Digest-named siblings and a quarantined copy of the same scope.
    const cleanupCopy = path.join(base, `${digest}.cleanup-Ab12Cd`);
    await writeFile(path.join(cleanupCopy, "control-plane", "control-plane-state.json"), controlPlane(sessionId, run2, "copy"));
    const emptyArchive = path.join(base, `${digest}.empty-before-cleanup.native-cleanup:${randomUUID()}`);
    await fs.mkdir(emptyArchive, { mode: 0o700 });
    const quarantined = path.join(base, "quarantine", `${digest}.identity_indeterminate.${Date.now()}.42.${randomUUID()}`);
    await writeFile(path.join(quarantined, "control-plane", "control-plane-state.json"), controlPlane(sessionId, run1, "quarantined"));
    await writeFile(path.join(quarantined, "codex-home", "sessions", "rollout.jsonl"), "quarantined transcript");
    // Pre-v2 company-scoped layout, derived from company and session ids alone (no identity file).
    const legacy = path.join(base, sha256(JSON.stringify([t.companyId, sessionId])));
    await writeFile(path.join(legacy, "codex-home", "sessions", "rollout.jsonl"), "legacy transcript");
    // Neighbours: another session of this company, another company, and a folder naming no session.
    const neighbourScope = await writeScope(neighbourDigest, neighbourSessionId, neighbour, neighbour, "Neighbour");
    const otherScope = await writeScope(otherDigest, otherSessionId, otherRun, otherRun, "Other company");
    const otherQuarantine = path.join(base, "quarantine", `${otherDigest}.identity_mismatch.${Date.now()}.7.${randomUUID()}`);
    await writeFile(path.join(otherQuarantine, "control-plane", "control-plane-state.json"), controlPlane(otherSessionId, otherRun, "x"));
    const unattributedRoot = path.join(base, unattributed);
    await fs.mkdir(unattributedRoot, { mode: 0o700 });
    return { ...t, other, sessionId, neighbourSessionId, run1, run2, neighbour, otherRun, digest, continuityOnly, scope, cleanupCopy,
      emptyArchive, quarantined, legacy, neighbourScope, otherScope, otherQuarantine, unattributedRoot,
      erased: [scope, path.join(base, continuityOnly), cleanupCopy, emptyArchive, quarantined, legacy],
      untouched: [neighbourScope, otherScope, otherQuarantine, unattributedRoot] };
  }

  it("resolves the same folder as the executor's runnerd state base", () => {
    delete process.env.PAPERCLIP_RUNNER_STATE_DIR;
    expect(nativeDurableSessionsRoot()).toBe(path.resolve(resolvePaperclipInstanceRoot(), "runtime", "paperclip-runner", "durable-sessions"));
    process.env.PAPERCLIP_RUNNER_STATE_DIR = base;
    expect(nativeDurableSessionsRoot()).toBe(path.resolve(base));
  });

  it("the runtime asset erasure job removes the erased session's folders, archives and copies, and nothing else", async () => {
    const s = await seedSession();
    // The source-erased Runs' existing outbox (queued by the Run trigger) owns the work.
    for (const runId of [s.run1, s.run2])
      await db.insert(memoryJobs).values({ companyId: s.companyId, operationType: "retention", jobKey: `runtime-asset-erasure:v1:${runId}`,
        sourceRefJson: { kind: "runtime_asset_erasure", runId, legacyDigests: [] } }).onConflictDoNothing();
    await memoryJobService(db).tick({ limit: 20, companyId: s.companyId });
    const receipts: Record<string, unknown>[] = [];
    for (const runId of [s.run1, s.run2]) {
      const [job] = await db.select().from(memoryJobs).where(and(eq(memoryJobs.companyId, s.companyId),
        eq(memoryJobs.jobKey, `runtime-asset-erasure:v1:${runId}`))).orderBy(desc(memoryJobs.attemptNumber)).limit(1);
      expect(job?.status).toBe("succeeded");
      receipts.push((job?.resultJson as Record<string, Record<string, unknown>>).nativeDurableSessionErasure!);
    }
    for (const target of s.erased) expect(await exists(target)).toBe(false);
    for (const target of s.untouched) expect(await exists(target)).toBe(true);
    expect(await fs.readFile(path.join(s.neighbourScope, "codex-home", "sessions", "rollout.jsonl"), "utf8"))
      .toBe("Neighbour provider transcript");
    // Exactly one job removed the folders; its receipt names exactly what it removed.
    const removing = receipts.filter(receipt => Number(receipt.removedEntryCount) > 0);
    expect(removing).toEqual([{ schema: "paperclip.native-durable-session-erasure.v1", companyId: s.companyId,
      normalizedSessionIds: [s.sessionId],
      removedScopeDigests: [s.digest, s.continuityOnly, path.basename(s.legacy)].sort(),
      removedEntryCount: s.erased.length }]);
    expect(receipts.filter(receipt => receipt.removedEntryCount === 0)).toHaveLength(1);
    expect((await fs.readdir(base)).filter(name => name.includes(".erasing-"))).toEqual([]);
    // Idempotent: a later erasure of another Run of the session finds nothing more.
    const again = await eraseNativeRuntimeAssets(db, { companyId: s.companyId, runId: s.run2 }, []);
    expect(again.durableSessionErasure).toMatchObject({ removedScopeDigests: [], removedEntryCount: 0 });
    for (const target of s.untouched) expect(await exists(target)).toBe(true);
  });

  it("stays pending while any Run of the session is active, then erases after its Stop", async () => {
    const s = await seedSession();
    // Another Task's Run of the same session: outside the carry cascade, inside the durable folder.
    const run3 = await insertRun({ ...s, issueId: s.liveIssueId, sessionId: s.sessionId, status: "running", createdAt: new Date() });
    await expect(eraseNativeRuntimeAssets(db, { companyId: s.companyId, runId: s.run1 }, []))
      .rejects.toThrow("awaits every session Run's confirmed Native Stop");
    for (const target of [...s.erased, ...s.untouched]) expect(await exists(target)).toBe(true);
    // A terminal Run whose finalization is still leased is live state too.
    await stop({ id: run3, companyId: s.companyId, agentId: s.agentId, issueId: s.liveIssueId });
    await db.update(nativeRunFinalizations).set({ leaseOwner: "cleanup-worker", leaseExpiresAt: new Date(Date.now() + 60_000) })
      .where(eq(nativeRunFinalizations.runId, run3));
    await expect(eraseNativeRuntimeAssets(db, { companyId: s.companyId, runId: s.run1 }, []))
      .rejects.toThrow("awaits a session Run's finalization lease");
    for (const target of s.erased) expect(await exists(target)).toBe(true);
    await db.update(nativeRunFinalizations).set({ leaseOwner: null, leaseExpiresAt: null })
      .where(eq(nativeRunFinalizations.runId, run3));
    const result = await eraseNativeRuntimeAssets(db, { companyId: s.companyId, runId: s.run1 }, []);
    expect(result.durableSessionErasure?.removedEntryCount).toBe(s.erased.length);
    for (const target of s.erased) expect(await exists(target)).toBe(false);
    for (const target of s.untouched) expect(await exists(target)).toBe(true);
  });

  it("company purge removes every durable folder of the company's sessions and leaves other companies", async () => {
    const s = await seedSession();
    const secondSession = randomUUID();
    const secondRun = await insertRun({ ...s, issueId: s.liveIssueId, sessionId: secondSession });
    const second = await writeScope(sha256(`scope:${randomUUID()}`), secondSession, secondRun, secondRun, "Second session");
    const receipt = await eraseCompanyNativeDurableSessions(db, s.companyId);
    expect(receipt.normalizedSessionIds).toEqual([s.sessionId, s.neighbourSessionId, secondSession].sort());
    expect(receipt.removedEntryCount).toBe(s.erased.length + 2);
    for (const target of [...s.erased, s.neighbourScope, second]) expect(await exists(target)).toBe(false);
    for (const target of [s.otherScope, s.otherQuarantine, s.unattributedRoot]) expect(await exists(target)).toBe(true);
    expect(await fs.readFile(path.join(s.otherScope, "codex-home", "sessions", "rollout.jsonl"), "utf8"))
      .toBe("Other company provider transcript");
  });

  it("the company purge owner erases the company's durable folders before deleting their Run owners", async () => {
    const s = await seedSession();
    const databaseEvidence = await purgeCompanyContent(db, s.companyId);
    expect(databaseEvidence).toBeTruthy();
    expect(await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(eq(heartbeatRuns.companyId, s.companyId))).toEqual([]);
    for (const target of [...s.erased, s.neighbourScope]) expect(await exists(target)).toBe(false);
    for (const target of [s.otherScope, s.otherQuarantine, s.unattributedRoot]) expect(await exists(target)).toBe(true);
  });

  it("refuses symlinked entries and never follows a link out of the erased folder", async () => {
    const s = await seedSession();
    const outside = await fs.mkdtemp(path.join(home, "outside-"));
    await writeFile(path.join(outside, "keep.txt"), "outside data");
    // A link inside the erased folder is removed as a link; its target survives.
    await fs.symlink(path.join(outside, "keep.txt"), path.join(s.scope, "codex-home", "escape"));
    // A symlink in place of a scope folder fails closed and removes nothing.
    const planted = path.join(base, sha256(`planted:${randomUUID()}`));
    await fs.symlink(outside, planted);
    await expect(eraseNativeRuntimeAssets(db, { companyId: s.companyId, runId: s.run1 }, []))
      .rejects.toThrow("Unsafe native durable session entry blocks erasure");
    for (const target of s.erased) expect(await exists(target)).toBe(true);
    await fs.unlink(planted);
    // A symlinked identity holder makes ownership undecidable: fail closed.
    const foreign = path.join(base, sha256(`foreign:${randomUUID()}`));
    await fs.mkdir(foreign, { mode: 0o700 });
    await fs.symlink(path.join(s.scope, "control-plane"), path.join(foreign, "control-plane"));
    await expect(eraseNativeRuntimeAssets(db, { companyId: s.companyId, runId: s.run1 }, []))
      .rejects.toThrow("Unreadable native durable session state blocks erasure");
    for (const target of s.erased) expect(await exists(target)).toBe(true);
    await removeRuntimeStorageTree(foreign);
    const result = await eraseNativeRuntimeAssets(db, { companyId: s.companyId, runId: s.run1 }, []);
    expect(result.durableSessionErasure?.removedEntryCount).toBe(s.erased.length);
    for (const target of s.erased) expect(await exists(target)).toBe(false);
    expect(await fs.readFile(path.join(outside, "keep.txt"), "utf8")).toBe("outside data");
    expect(await exists(outside)).toBe(true);
  });

  it("refuses a folder that names the erased session without a Run of this company", async () => {
    const s = await seedSession();
    const impostor = path.join(base, sha256(`impostor:${randomUUID()}`));
    await writeFile(path.join(impostor, "control-plane", "control-plane-state.json"),
      controlPlane(s.sessionId, s.otherRun, "another company's Run"));
    await expect(eraseNativeRuntimeAssets(db, { companyId: s.companyId, runId: s.run1 }, []))
      .rejects.toThrow("names the erased session without a Run of this company");
    for (const target of [...s.erased, impostor]) expect(await exists(target)).toBe(true);
  });

  it("finishes an interrupted erasure of the same session by its derived tag", async () => {
    const s = await seedSession();
    await eraseNativeRuntimeAssets(db, { companyId: s.companyId, runId: s.run1 }, []);
    // Simulate a crash after rename: a renamed copy that no longer has any identity.
    const tag = createHash("sha256")
      .update(`paperclip.native-durable-session-erasure.v1\0${s.companyId}\0${s.sessionId}`).digest("hex").slice(0, 32);
    const leftover = path.join(base, `${s.digest}.erasing-${tag}-${randomUUID()}`);
    await writeFile(path.join(leftover, "codex-home", "sessions", "rollout.jsonl"), "half-removed transcript");
    const foreignTag = path.join(base, `${s.digest}.erasing-${"0".repeat(32)}-${randomUUID()}`);
    await fs.mkdir(foreignTag, { mode: 0o700 });
    const result = await eraseNativeRuntimeAssets(db, { companyId: s.companyId, runId: s.run2 }, []);
    expect(result.durableSessionErasure).toMatchObject({ removedScopeDigests: [s.digest], removedEntryCount: 1 });
    expect(await exists(leftover)).toBe(false);
    expect(await exists(foreignTag)).toBe(true);
  });
});
