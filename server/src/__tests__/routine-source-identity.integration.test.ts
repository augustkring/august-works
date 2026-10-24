import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  authUsers,
  companies,
  companyMemberships,
  createDb,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  heartbeatRuns,
  issues,
  routineRevisions,
  routineRuns,
  routines,
} from "@paperclipai/db";
import { createRoutineSchema } from "@paperclipai/shared";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { issueService } from "../services/issues.js";
import { companyService } from "../services/companies.js";
import { routineService } from "../services/routines.js";

/**
 * Run after migration 0525 is installed. Direct SQL in negative cases probes
 * database identity invariants only; these rows are not source proof or
 * permission fixtures.
 */
describe("Routine run and revision source identity", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("routine-source-identity-");
    db = createDb(database.connectionString, { maxConnections: 8 });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  afterAll(async () => { await database?.cleanup(); }, 30_000);

  async function seedCompany(name: string) {
    const companyId = randomUUID();
    const userId = randomUUID();
    const agentId = randomUUID();
    await db.insert(companies).values({ id: companyId, name, issuePrefix: `RSI${companyId.slice(0, 5).toUpperCase()}` });
    await db.insert(authUsers).values({ id: userId, name: "Routine source owner", email: `${userId}@test.invalid`,
      emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId,
      membershipRole: "admin", status: "active" });
    await db.insert(agents).values({ id: agentId, companyId, name: "Routine execution Agent", role: "engineer",
      status: "idle", adapterType: "paperclip_runner" });
    const service = routineService(db, { heartbeat: { wakeup: async () => ({ status: "queued" }) } });
    return { companyId, userId, agentId, service };
  }

  async function createRoutine(owner: Awaited<ReturnType<typeof seedCompany>>, title: string) {
    return owner.service.create(owner.companyId, createRoutineSchema.parse({
      title,
      executionTarget: { kind: "agent_task", agentId: owner.agentId },
      concurrencyPolicy: "always_enqueue",
    }), { userId: owner.userId });
  }

  it("keeps the service-pinned older revision through routine updates and run completion", async () => {
    const owner = await seedCompany("Routine identity lifecycle");
    const routine = await createRoutine(owner, "Original retained routine");
    const originalRevisionId = routine.latestRevisionId!;
    const run = await owner.service.runRoutine(routine.id, { source: "api", idempotencyKey: randomUUID() });
    expect(run).toMatchObject({ companyId: owner.companyId, routineId: routine.id,
      routineRevisionId: originalRevisionId, status: "issue_created" });
    expect(run.linkedIssueId).toBeTruthy();

    const updated = await owner.service.update(routine.id, {
      baseRevisionId: routine.latestRevisionId,
      title: "New routine revision after this execution was retained",
    }, { userId: owner.userId });
    expect(updated!.latestRevisionId).not.toBe(originalRevisionId);
    const [retainedRun] = await db.select().from(routineRuns).where(eq(routineRuns.id, run.id));
    expect(retainedRun).toMatchObject({ companyId: owner.companyId, routineId: routine.id,
      routineRevisionId: originalRevisionId });

    await issueService(db).update(run.linkedIssueId!, { status: "done" });
    await expect(owner.service.syncRunStatusForIssue(run.linkedIssueId!)).resolves.toMatchObject({ status: "completed" });
    const [completedRun] = await db.select().from(routineRuns).where(eq(routineRuns.id, run.id));
    expect(completedRun).toMatchObject({ status: "completed", companyId: owner.companyId,
      routineId: routine.id, routineRevisionId: originalRevisionId });
  }, 90_000);

  it("rejects cross-company, wrong-parent, and retargeted run or revision identities", async () => {
    const owner = await seedCompany("Routine identity tenant A");
    const other = await seedCompany("Routine identity tenant B");
    const routine = await createRoutine(owner, "Original routine owner");
    const otherRoutine = await createRoutine(owner, "Other routine in same company");
    const foreignRoutine = await createRoutine(other, "Foreign company routine");
    const originalRevisionId = routine.latestRevisionId!;
    const otherRevisionId = otherRoutine.latestRevisionId!;
    const [run] = await db.insert(routineRuns).values({ companyId: owner.companyId, routineId: routine.id,
      routineRevisionId: originalRevisionId, source: "api", status: "received" }).returning();
    const [originalRevision] = await db.select().from(routineRevisions)
      .where(eq(routineRevisions.id, originalRevisionId));

    await expect(db.insert(routineRuns).values({ companyId: owner.companyId, routineId: foreignRoutine.id,
      routineRevisionId: foreignRoutine.latestRevisionId!, source: "api", status: "received" })).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.insert(routineRuns).values({ companyId: owner.companyId, routineId: routine.id,
      routineRevisionId: otherRevisionId, source: "api", status: "received" })).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.update(routineRuns).set({ routineId: otherRoutine.id }).where(eq(routineRuns.id, run!.id))
      .returning()).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.update(routineRuns).set({ routineRevisionId: otherRevisionId }).where(eq(routineRuns.id, run!.id))
      .returning()).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.update(routineRuns).set({ companyId: other.companyId }).where(eq(routineRuns.id, run!.id))
      .returning()).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.update(routineRevisions).set({ routineId: otherRoutine.id })
      .where(eq(routineRevisions.id, originalRevisionId)).returning()).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.insert(routineRevisions).values({ ...originalRevision!, id: randomUUID(), revisionNumber: 999,
      restoredFromRevisionId: otherRevisionId }).returning()).rejects.toMatchObject({ cause: { code: "23514" } });
    for (const snapshot of [
      { ...originalRevision!.snapshot, routine: { ...originalRevision!.snapshot.routine, id: otherRoutine.id } },
      { ...originalRevision!.snapshot, routine: { ...originalRevision!.snapshot.routine, companyId: other.companyId } },
    ]) {
      await expect(db.insert(routineRevisions).values({ ...originalRevision!, id: randomUUID(), revisionNumber: 999,
        snapshot }).returning()).rejects.toMatchObject({ cause: { code: "23514" } });
    }
    await expect(db.update(routines).set({ companyId: other.companyId })
      .where(eq(routines.id, routine.id)).returning()).rejects.toMatchObject({ cause: { code: "23514" } });
  }, 90_000);

  it("rejects routine revision snapshot edits but preserves the existing null-revision run shape", async () => {
    const owner = await seedCompany("Routine revision snapshot identity");
    const routine = await createRoutine(owner, "Immutable routine snapshot");
    const [revision] = await db.select().from(routineRevisions).where(eq(routineRevisions.id, routine.latestRevisionId!));
    const changedSnapshot = { ...revision!.snapshot,
      routine: { ...revision!.snapshot.routine, title: "Forged revision payload" } };
    await expect(db.update(routineRevisions).set({ title: "Forged revision title" })
      .where(eq(routineRevisions.id, revision!.id)).returning()).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.update(routineRevisions).set({ snapshot: changedSnapshot })
      .where(eq(routineRevisions.id, revision!.id)).returning()).rejects.toMatchObject({ cause: { code: "23514" } });

    // Historical rows with no retained revision remain explicitly unknown;
    // this only preserves their old nullable schema shape and grants no read.
    const [legacyShape] = await db.insert(routineRuns).values({ companyId: owner.companyId,
      routineId: routine.id, routineRevisionId: null, source: "api", status: "received" }).returning();
    await expect(db.update(routineRuns).set({ status: "failed", failureReason: "legacy lifecycle update" })
      .where(eq(routineRuns.id, legacyShape!.id)).returning()).resolves.toMatchObject([{ status: "failed",
        companyId: owner.companyId, routineId: routine.id, routineRevisionId: null }]);
    expect(await db.select({ id: issues.id }).from(issues).where(eq(issues.companyId, owner.companyId))).toEqual([]);
  }, 90_000);

  it("preserves ON DELETE SET NULL for stale revision, creator run, and creator Agent references", async () => {
    const owner = await seedCompany("Routine source FK deletion");
    const routine = await createRoutine(owner, "Retained revision before restore");
    const oldRevisionId = routine.latestRevisionId!;
    const revisionTwo = await owner.service.update(routine.id, {
      baseRevisionId: oldRevisionId,
      title: "Current routine revision after append",
    }, { userId: owner.userId });
    expect(revisionTwo!.latestRevisionId).not.toBe(oldRevisionId);

    const [authorRun] = await db.insert(heartbeatRuns).values({ companyId: owner.companyId,
      agentId: owner.agentId, status: "running", runtimeMode: "native", responsibleUserId: owner.userId,
      startedAt: new Date() }).returning();
    const restored = await owner.service.restoreRevision(routine.id, oldRevisionId, {
      userId: owner.userId, agentId: owner.agentId, runId: authorRun!.id,
    });
    expect(restored.revision.restoredFromRevisionId).toBe(oldRevisionId);
    expect(restored.revision.createdByAgentId).toBe(owner.agentId);
    expect(restored.revision.createdByRunId).toBe(authorRun!.id);
    expect(restored.routine.latestRevisionId).not.toBe(oldRevisionId);

    const [retainedRun] = await db.insert(routineRuns).values({ companyId: owner.companyId,
      routineId: routine.id, routineRevisionId: oldRevisionId, source: "api", status: "received" }).returning();
    const beforeDelete = {
      id: restored.revision.id,
      companyId: restored.revision.companyId,
      routineId: restored.revision.routineId,
      revisionNumber: restored.revision.revisionNumber,
      title: restored.revision.title,
      snapshot: restored.revision.snapshot,
    };

    await db.delete(routineRevisions).where(eq(routineRevisions.id, oldRevisionId));
    const [afterRevisionDelete] = await db.select().from(routineRevisions).where(eq(routineRevisions.id, restored.revision.id));
    expect(afterRevisionDelete).toMatchObject({ ...beforeDelete, restoredFromRevisionId: null,
      createdByAgentId: owner.agentId, createdByRunId: authorRun!.id });
    const [afterRunRevisionDelete] = await db.select().from(routineRuns).where(eq(routineRuns.id, retainedRun!.id));
    expect(afterRunRevisionDelete).toMatchObject({ companyId: owner.companyId, routineId: routine.id,
      routineRevisionId: null, status: "received" });

    await db.delete(heartbeatRuns).where(eq(heartbeatRuns.id, authorRun!.id));
    const [afterAuthorRunDelete] = await db.select().from(routineRevisions).where(eq(routineRevisions.id, restored.revision.id));
    expect(afterAuthorRunDelete).toMatchObject({ ...beforeDelete, restoredFromRevisionId: null,
      createdByAgentId: owner.agentId, createdByRunId: null });

    const currentRoutine = await owner.service.get(routine.id);
    await owner.service.update(routine.id, {
      baseRevisionId: currentRoutine!.latestRevisionId,
      status: "paused",
      executionTarget: null,
      assigneeAgentId: null,
    }, { userId: owner.userId });
    await db.delete(agents).where(eq(agents.id, owner.agentId));
    const [afterAgentDelete] = await db.select().from(routineRevisions).where(eq(routineRevisions.id, restored.revision.id));
    expect(afterAgentDelete).toMatchObject({ ...beforeDelete, restoredFromRevisionId: null,
      createdByAgentId: null, createdByRunId: null });
    expect(afterAgentDelete?.snapshot).toEqual(beforeDelete.snapshot);
    expect(afterAgentDelete?.title).toBe(beforeDelete.title);

    await expect(companyService(db).remove(owner.companyId)).resolves.toMatchObject({ id: owner.companyId });
    expect(await db.select().from(routines).where(eq(routines.companyId, owner.companyId))).toEqual([]);
    expect(await db.select().from(routineRevisions).where(eq(routineRevisions.companyId, owner.companyId))).toEqual([]);
    expect(await db.select().from(routineRuns).where(eq(routineRuns.companyId, owner.companyId))).toEqual([]);
  }, 90_000);
});
