import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { agentWakeupRequests, createDb, heartbeatRuns, issueComments, type Db } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Presences } from "../../__tests__/helpers/v5-fixtures.js";
import { seedCurrentHumanSourceActor } from "../../__tests__/helpers/current-human-source-fixture.js";
import { issueService } from "../issues.js";
import { readNativeManualQueueAdoption } from "./manual-queue-adoption.js";

// SQL proof-constructor fixture only: no Native result, source receipt, model call or paid dispatch.
let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: Db;
beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("manual-queue-adoption-owner-"); db = createDb(database.connectionString, { maxConnections: 3 }); await enableV5ForTest(db); }, 60_000);
afterAll(async () => { await database?.cleanup(); });

async function wake(id: string) {
  const [row] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, id));
  if (!row) throw new Error("manual_adoption_wake_missing");
  return row;
}

async function fixture(mode: "cold" | "merged" = "cold", operatorIsAuthor = false) {
  const f = await seedV5Presences(db), tasks = issueService(db);
  const author = await seedCurrentHumanSourceActor(db, [f.home], f.userId);
  const operatorId = operatorIsAuthor ? f.userId : `manual-operator-${randomUUID()}`;
  const operator = operatorIsAuthor ? author : await seedCurrentHumanSourceActor(db, [f.home], operatorId);
  const task = await tasks.create(f.home, { title: "Retained comment source", description: "Bounded queue proof fixture",
    status: "todo", workMode: "standard", responsibleUserId: f.userId, createdByUserId: f.userId,
    assigneeAgentId: f.presence.id }, db, undefined,
    { manualInputActor: author, privacyActor: author, sourceAccessActor: author });
  const comment = await tasks.addComment(task.id, "Original Human comment.", { userId: f.userId }, { manualInputActor: author });
  const queuePayload = { issueId: task.id, commentId: comment.id, _paperclipWakeContext: { wakeCommentIds: [comment.id] } };
  const currentPayload = { ...queuePayload, manualUserWake: true };
  const [currentWake] = await db.insert(agentWakeupRequests).values({ companyId: f.home, agentId: f.presence.id,
    source: mode === "merged" ? "automation" : "on_demand", triggerDetail: mode === "merged" ? "system" : "manual",
    reason: "issue_commented", status: "claimed", coalescedCount: mode === "merged" ? 1 : 0,
    requestedByActorType: "user", requestedByActorId: operatorId, payload: currentPayload }).returning();
  if (!currentWake) throw new Error("manual_adoption_current_wake_missing");
  const [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id,
    issueId: task.id, nativeIssueId: null, runtimeMode: "legacy", status: "running", responsibleUserId: operatorId,
    wakeupRequestId: currentWake.id, contextSnapshot: { issueId: task.id, taskId: task.id } }).returning();
  if (!run) throw new Error("manual_adoption_pre_native_run_missing");
  await db.update(agentWakeupRequests).set({ runId: run.id }).where(eq(agentWakeupRequests.id, currentWake.id));
  let originalWake = currentWake;
  if (mode === "cold") {
    const [saved] = await db.insert(agentWakeupRequests).values({ companyId: f.home, agentId: f.presence.id,
      source: "automation", triggerDetail: null, reason: "issue_commented", status: "coalesced",
      requestedByActorType: "user", requestedByActorId: f.userId, runId: run.id, payload: queuePayload }).returning();
    if (!saved) throw new Error("manual_adoption_original_queue_missing");
    originalWake = saved;
  }
  return { f, author, operator, operatorId, task, comment, currentWake: await wake(currentWake.id),
    originalWake, run, queuePayload };
}

it("constructs cold and merged adoptions from exact PostgreSQL queue owners and survives claim-to-processed status changes", async () => {
  for (const mode of ["cold", "merged"] as const) {
    const f = await fixture(mode);
    const before = await readNativeManualQueueAdoption(db, { run: f.run, issueId: f.task.id, currentWake: f.currentWake });
    expect(before).toMatchObject({ schema: "paperclip.native-manual-queue-adoption.v1", companyId: f.f.home,
      agentId: f.f.presence.id, runId: f.run.id, wakeupRequestId: f.currentWake.id, operatorUserId: f.operatorId,
      originQueueIds: [f.originalWake.id], originCommentIds: [f.comment.id] });
    await db.update(agentWakeupRequests).set({ status: "processed" }).where(eq(agentWakeupRequests.id, f.currentWake.id));
    await expect(readNativeManualQueueAdoption(db, { run: f.run, issueId: f.task.id,
      currentWake: await wake(f.currentWake.id) })).resolves.toEqual(before);
  }
});

it("fails closed for foreign queue tuples, missing manual marker, changed requester or comment set", async () => {
  const f = await fixture("cold");
  await db.update(agentWakeupRequests).set({ runId: randomUUID() }).where(eq(agentWakeupRequests.id, f.originalWake.id));
  await expect(readNativeManualQueueAdoption(db, { run: f.run, issueId: f.task.id, currentWake: f.currentWake })).resolves.toBeNull();

  const g = await fixture("cold");
  await expect(readNativeManualQueueAdoption(db, { run: { ...g.run, nativeIssueId: randomUUID() },
    issueId: g.task.id, currentWake: g.currentWake })).resolves.toBeNull();
  await db.update(agentWakeupRequests).set({ payload: g.queuePayload }).where(eq(agentWakeupRequests.id, g.currentWake.id));
  await expect(readNativeManualQueueAdoption(db, { run: g.run, issueId: g.task.id,
    currentWake: await wake(g.currentWake.id) })).resolves.toBeNull();
  const mismatchedActor = await fixture("cold");
  await db.update(agentWakeupRequests).set({ requestedByActorId: mismatchedActor.f.userId })
    .where(eq(agentWakeupRequests.id, mismatchedActor.currentWake.id));
  await expect(readNativeManualQueueAdoption(db, { run: mismatchedActor.run, issueId: mismatchedActor.task.id,
    currentWake: await wake(mismatchedActor.currentWake.id) })).resolves.toBeNull();
  const wrongComment = randomUUID();
  const changed = { ...g.currentWake, payload: { issueId: g.task.id, commentId: wrongComment,
    _paperclipWakeContext: { wakeCommentIds: [wrongComment] }, manualUserWake: true } };
  await db.update(agentWakeupRequests).set({ payload: changed.payload }).where(eq(agentWakeupRequests.id, g.currentWake.id));
  await expect(readNativeManualQueueAdoption(db, { run: g.run, issueId: g.task.id,
    currentWake: await wake(g.currentWake.id) })).resolves.toBeNull();
});

it("does not opt in same-author history and rejects deleted, machine-authored or oversized sources", async () => {
  const same = await fixture("cold", true);
  await expect(readNativeManualQueueAdoption(db, { run: same.run, issueId: same.task.id,
    currentWake: same.currentWake })).resolves.toBeNull();

  const deleted = await fixture("cold");
  await db.update(issueComments).set({ deletedAt: new Date() }).where(and(eq(issueComments.companyId, deleted.f.home),
    eq(issueComments.id, deleted.comment.id)));
  await expect(readNativeManualQueueAdoption(db, { run: deleted.run, issueId: deleted.task.id,
    currentWake: deleted.currentWake })).resolves.toBeNull();

  const machine = await fixture("cold");
  const agentComment = await issueService(db).addComment(machine.task.id, "Agent-authored source.",
    { agentId: machine.f.presence.id, runId: machine.run.id });
  const machinePayload = { issueId: machine.task.id, commentId: agentComment.id,
    _paperclipWakeContext: { wakeCommentIds: [agentComment.id] }, manualUserWake: true };
  await db.update(agentWakeupRequests).set({ payload: machinePayload }).where(eq(agentWakeupRequests.id, machine.currentWake.id));
  await db.update(agentWakeupRequests).set({ payload: { issueId: machine.task.id, commentId: agentComment.id,
    _paperclipWakeContext: { wakeCommentIds: [agentComment.id] } } }).where(eq(agentWakeupRequests.id, machine.originalWake.id));
  await expect(readNativeManualQueueAdoption(db, { run: machine.run, issueId: machine.task.id,
    currentWake: await wake(machine.currentWake.id) })).resolves.toBeNull();

  const oversized = await fixture("cold");
  const ids = Array.from({ length: 257 }, () => randomUUID());
  await expect(readNativeManualQueueAdoption(db, { run: oversized.run, issueId: oversized.task.id,
    currentWake: { ...oversized.currentWake, payload: { issueId: oversized.task.id, manualUserWake: true,
      commentIds: ids } } })).resolves.toBeNull();
});


it("bounds the exact linked PostgreSQL queue scan at 257 rows", async () => {
  const f = await fixture("cold");
  await db.insert(agentWakeupRequests).values(Array.from({ length: 256 }, () => ({
    companyId: f.f.home, agentId: f.f.presence.id, source: "automation" as const, triggerDetail: null,
    reason: "issue_commented" as const, status: "coalesced" as const, requestedByActorType: "user" as const,
    requestedByActorId: f.f.userId, runId: f.run.id, payload: f.queuePayload,
  })));
  await expect(readNativeManualQueueAdoption(db, { run: f.run, issueId: f.task.id,
    currentWake: f.currentWake })).resolves.toBeNull();
});
