import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  agentWakeupRequests,
  authUsers,
  companies,
  companyMemberships,
  createDb,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  issues,
  routineRuns,
} from "@paperclipai/db";
import { createRoutineSchema } from "@paperclipai/shared";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { routineService } from "../services/routines.js";

describe("Routine pending assignment recovery", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("routine-pending-assignment-");
    db = createDb(database.connectionString, { maxConnections: 8 });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  afterAll(async () => { await database?.cleanup(); }, 30_000);

  async function seed(title: string) {
    const companyId = randomUUID();
    const userId = randomUUID();
    const agentId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: title, issuePrefix: `RPA${companyId.slice(0, 5).toUpperCase()}` });
    await db.insert(authUsers).values({ id: userId, name: "Routine owner", email: `${userId}@test.invalid`,
      emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId,
      membershipRole: "admin", status: "active" });
    await db.insert(agents).values({ id: agentId, companyId, name: "Routine agent", role: "engineer",
      status: "idle", adapterType: "paperclip_runner" });
    const service = routineService(db, { heartbeat: { wakeup: async () => ({ status: "queued" }) } });
    const routine = await service.create(companyId, createRoutineSchema.parse({ title,
      executionTarget: { kind: "agent_task", agentId }, concurrencyPolicy: "always_enqueue" }), { userId });
    return { companyId, agentId, routine, service };
  }

  it("recovers a failed queue from a fresh service scheduler tick", async () => {
    const owner = await seed("Routine retry without client replay");
    let initialWakeCount = 0;
    const failing = routineService(db, { heartbeat: { wakeup: async () => {
      initialWakeCount++;
      throw new Error("queue temporarily unavailable");
    } } });
    const run = await failing.runRoutine(owner.routine.id, { source: "api", idempotencyKey: randomUUID() });
    expect(run).toMatchObject({ status: "received", failureReason: "assignment_queue_pending", linkedIssueId: expect.any(String) });

    let retryWakeCount = 0;
    const fresh = routineService(db, { heartbeat: { wakeup: async (_agentId, request) => {
      retryWakeCount++;
      expect(request.idempotencyKey).toBe(`routine-assignment:${run.id}`);
      expect(request.payload?.issueId).toBe(run.linkedIssueId);
      return { status: "queued" };
    } } });
    await fresh.tickScheduledTriggers();
    const [stored] = await db.select().from(routineRuns).where(eq(routineRuns.id, run.id));
    expect(stored).toMatchObject({ status: "issue_created", linkedIssueId: run.linkedIssueId });
    expect(initialWakeCount).toBe(1);
    expect(retryWakeCount).toBe(1);
  }, 90_000);

  it("does not accept a mismatched persisted receipt or issue another wake", async () => {
    const owner = await seed("Routine mismatched persisted receipt");
    const failing = routineService(db, { heartbeat: { wakeup: async () => { throw new Error("queue unavailable"); } } });
    const run = await failing.runRoutine(owner.routine.id, { source: "api", idempotencyKey: randomUUID() });
    const [task] = await db.select().from(issues).where(eq(issues.id, run.linkedIssueId!));
    await db.insert(agentWakeupRequests).values({ companyId: owner.companyId, agentId: owner.agentId,
      source: "timer", triggerDetail: "system", reason: "wrong receipt", payload: { issueId: randomUUID() },
      idempotencyKey: `routine-assignment:${run.id}` });

    let wakeCount = 0;
    const fresh = routineService(db, { heartbeat: { wakeup: async () => {
      wakeCount++;
      return { status: "queued" };
    } } });
    await fresh.tickScheduledTriggers();
    const [stored] = await db.select().from(routineRuns).where(eq(routineRuns.id, run.id));
    expect(stored).toMatchObject({ status: "received", failureReason: "assignment_queue_pending", linkedIssueId: task!.id });
    expect(wakeCount).toBe(0);
  }, 90_000);

  it("allows at most one concurrent fresh-service recovery wake", async () => {
    const owner = await seed("Routine concurrent pending recovery");
    const failing = routineService(db, { heartbeat: { wakeup: async () => { throw new Error("queue unavailable"); } } });
    const run = await failing.runRoutine(owner.routine.id, { source: "api", idempotencyKey: randomUUID() });
    let wakeCount = 0;
    let markStarted!: () => void;
    let releaseWake!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const gate = new Promise<void>((resolve) => { releaseWake = resolve; });
    const first = routineService(db, { heartbeat: { wakeup: async () => {
      wakeCount++;
      markStarted();
      await gate;
      return { status: "queued" };
    } } });
    const second = routineService(db, { heartbeat: { wakeup: async () => {
      wakeCount++;
      return { status: "queued" };
    } } });

    const firstRecovery = first.tickScheduledTriggers();
    try {
      await started;
      const secondRecovery = second.tickScheduledTriggers();
      await secondRecovery;
    } finally {
      releaseWake();
    }
    await firstRecovery;
    expect(wakeCount).toBe(1);
    const [stored] = await db.select().from(routineRuns).where(eq(routineRuns.id, run.id));
    expect(stored).toMatchObject({ status: "issue_created", linkedIssueId: run.linkedIssueId });
  }, 90_000);
});
