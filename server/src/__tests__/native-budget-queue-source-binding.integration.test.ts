import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  agentWakeupRequests,
  authUsers,
  companyMemberships,
  companies,
  costEvents,
  createDb,
  issueComments,
  issues,
  projects,
} from "@paperclipai/db";
import { EMBEDDED_POSTGRES_TEST_TIMEOUT_MS } from "@paperclipai/db";
import { budgetService } from "../services/budgets.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { createQueuedCommentIssueLockWriter } from "../modules/wake-queue/adapters/queued-comment-postgres.js";
import type { QueuedCommentQueuePostgresAdapterDeps } from "../modules/wake-queue/adapters/queued-comment-postgres.js";

describe("native payload snapshot invalidation in budget and queued-comment writers", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("v10-budget-queue-payload-binding-");
    db = createDb(database.connectionString);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  afterAll(async () => { await database?.cleanup(); }, 30_000);

  async function bindSnapshot(table: "projects" | "issue_comments", kind: "project" | "comment", companyId: string, id: string) {
    await db.execute(sql`update ${sql.identifier(table)} target set payload_source_snapshot=(
      select content || jsonb_build_object('digest',encode(sha256(convert_to(content::text,'UTF8')),'hex')) from (
        select jsonb_build_object('version',1,'owner',jsonb_build_object('kind',${kind}::text,'companyId',target.company_id,
          'id',target.id,'contentHash',public.aw_native_payload_body_hash(${kind}::text,to_jsonb(target))),
          'policy',jsonb_build_object('issueIds','[]'::jsonb,'projectIds','[]'::jsonb,'runIds','[]'::jsonb,
            'memoryIds','[]'::jsonb,'foundationRevisionIds','[]'::jsonb),'inputs','[]'::jsonb) as content
      ) structural_body
    ) where target.company_id=${companyId}::uuid and target.id=${id}::uuid`);
  }

  it("retains the Project capture for a same-body budget no-op before a hard-stop edit", async () => {
    const companyId = randomUUID();
    const userId = randomUUID();
    const agentId = randomUUID();
    const pausedProjectId = randomUUID();
    const controlProjectId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Budget snapshot fixture", issuePrefix: randomUUID() });
    await db.insert(authUsers).values({ id: userId, name: "Budget owner", email: `${userId}@example.test`, emailVerified: true,
      createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId,
      status: "active", membershipRole: "owner" });
    await db.insert(agents).values({ id: agentId, companyId, name: "Budget fixture agent", role: "engineer",
      status: "active", adapterType: "codex_local", adapterConfig: {}, runtimeConfig: {}, permissions: {} });
    await db.insert(projects).values([
      { id: pausedProjectId, companyId, name: "Budget pause project", status: "in_progress", payloadSourceProtocolVersion: 1 },
      { id: controlProjectId, companyId, name: "Budget no-op project", status: "in_progress", payloadSourceProtocolVersion: 1 },
    ]);
    await bindSnapshot("projects", "project", companyId, pausedProjectId);
    await bindSnapshot("projects", "project", companyId, controlProjectId);
    const [beforeControl] = await db.select().from(projects).where(eq(projects.id, controlProjectId));
    expect(beforeControl!.payloadSourceSnapshot).not.toBeNull();

    await db.insert(costEvents).values([
      { companyId, agentId, projectId: pausedProjectId, provider: "test", biller: "test", billingType: "metered_api",
        model: "budget-fixture", costCents: 125, occurredAt: new Date() },
      { companyId, agentId, projectId: controlProjectId, provider: "test", biller: "test", billingType: "metered_api",
        model: "budget-fixture", costCents: 125, occurredAt: new Date() },
    ]);

    const service = budgetService(db);
    await service.upsertPolicy(companyId, { scopeType: "project", scopeId: controlProjectId, metric: "billed_cents",
      windowKind: "lifetime", amount: 200, hardStopEnabled: true, notifyEnabled: false }, userId);
    const [afterControl] = await db.select().from(projects).where(eq(projects.id, controlProjectId));
    expect(afterControl!.payloadSourceSnapshot).not.toBeNull();
    expect(afterControl!.payloadSourceSnapshot).toEqual(beforeControl!.payloadSourceSnapshot);
    expect(afterControl!.payloadSourceSnapshotInvalidated).toBe(false);

    await service.upsertPolicy(companyId, { scopeType: "project", scopeId: pausedProjectId, metric: "billed_cents",
      windowKind: "lifetime", amount: 100, hardStopEnabled: true, notifyEnabled: false }, userId);
    const [paused] = await db.select().from(projects).where(eq(projects.id, pausedProjectId));
    expect(paused).toMatchObject({ pauseReason: "budget", payloadSourceSnapshot: null, payloadSourceSnapshotInvalidated: true });
  });

  it("invalidates a fresh Project capture when a budget policy resumes the project", async () => {
    const companyId = randomUUID();
    const userId = randomUUID();
    const agentId = randomUUID();
    const projectId = randomUUID();
    const pausedAt = new Date();
    await db.insert(companies).values({ id: companyId, name: "Budget resume fixture", issuePrefix: randomUUID() });
    await db.insert(authUsers).values({ id: userId, name: "Budget owner", email: `${userId}@example.test`, emailVerified: true,
      createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId,
      status: "active", membershipRole: "owner" });
    await db.insert(agents).values({ id: agentId, companyId, name: "Budget fixture agent", role: "engineer",
      status: "active", adapterType: "codex_local", adapterConfig: {}, runtimeConfig: {}, permissions: {} });
    await db.insert(projects).values({ id: projectId, companyId, name: "Already budget-paused project", status: "in_progress",
      pauseReason: "budget", pausedAt, payloadSourceProtocolVersion: 1 });
    await db.insert(costEvents).values({ companyId, agentId, projectId, provider: "test", biller: "test", billingType: "metered_api",
      model: "budget-fixture", costCents: 125, occurredAt: new Date() });
    await bindSnapshot("projects", "project", companyId, projectId);
    const [before] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(before!.payloadSourceSnapshot).not.toBeNull();

    await budgetService(db).upsertPolicy(companyId, { scopeType: "project", scopeId: projectId, metric: "billed_cents",
      windowKind: "lifetime", amount: 175, hardStopEnabled: true, notifyEnabled: false }, userId);
    const [resumed] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(resumed).toMatchObject({ pauseReason: null, payloadSourceSnapshot: null, payloadSourceSnapshotInvalidated: true });
  });

  it("invalidates only changed queued-comment bodies within the original adapter transaction", async () => {
    const companyId = randomUUID();
    const userId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const unchangedCommentId = randomUUID();
    const changedCommentId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Queue snapshot fixture", issuePrefix: randomUUID() });
    await db.insert(authUsers).values({ id: userId, name: "Queue owner", email: `${userId}@example.test`, emailVerified: true,
      createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId,
      status: "active", membershipRole: "owner" });
    await db.insert(agents).values({ id: agentId, companyId, name: "Queue fixture agent", role: "engineer",
      status: "active", adapterType: "codex_local", adapterConfig: {}, runtimeConfig: { heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 1 } }, permissions: {} });
    await db.insert(issues).values({ id: issueId, companyId, title: "Queued comment fixture", status: "in_progress",
      priority: "medium", assigneeAgentId: agentId });
    await db.insert(issueComments).values([
      { id: unchangedCommentId, companyId, issueId, authorUserId: userId, body: "same body", payloadSourceProtocolVersion: 1 },
      { id: changedCommentId, companyId, issueId, authorUserId: userId, body: "before edit", payloadSourceProtocolVersion: 1 },
    ]);
    await bindSnapshot("issue_comments", "comment", companyId, unchangedCommentId);
    await bindSnapshot("issue_comments", "comment", companyId, changedCommentId);
    const [beforeUnchanged] = await db.select().from(issueComments).where(eq(issueComments.id, unchangedCommentId));
    expect(beforeUnchanged!.payloadSourceSnapshot).not.toBeNull();
    const queueId = randomUUID();
    await db.insert(agentWakeupRequests).values({ id: queueId, companyId, agentId,
      source: "automation", reason: "issue_commented", status: "deferred_issue_execution", requestedByActorType: "user",
      payload: { issueId, _paperclipWakeContext: { wakeCommentIds: [unchangedCommentId, changedCommentId] } } });

    const lockWriter = createQueuedCommentIssueLockWriter(db, {
      syncCommentReferences: async () => {}, deleteCommentReferenceSource: async () => {}, syncCommentExternalObjectsSafely: async () => {},
    } satisfies QueuedCommentQueuePostgresAdapterDeps);
    const issueContext = { id: issueId, companyId, assigneeAgentId: agentId, executionRunId: null };
    const actor = { actorType: "user" as const, actorId: userId, agentId: null, runId: null, agentApiKeyId: null };

    await lockWriter.withLockedQueue({ issue: issueContext, actor, queueId }, async (_locked, transaction) => {
      expect(await transaction.updateCommentBody({ issueId, commentId: unchangedCommentId, body: "same body", updatedAt: new Date() })).toBe(true);
    });
    const [afterUnchanged] = await db.select().from(issueComments).where(eq(issueComments.id, unchangedCommentId));
    expect(afterUnchanged!.payloadSourceSnapshot).not.toBeNull();
    expect(afterUnchanged!.payloadSourceSnapshot).toEqual(beforeUnchanged!.payloadSourceSnapshot);
    expect(afterUnchanged!.payloadSourceSnapshotInvalidated).toBe(false);

    await lockWriter.withLockedQueue({ issue: issueContext, actor, queueId }, async (_locked, transaction) => {
      expect(await transaction.updateCommentBody({ issueId, commentId: changedCommentId, body: "after edit", updatedAt: new Date() })).toBe(true);
    });
    const [afterChanged] = await db.select().from(issueComments).where(eq(issueComments.id, changedCommentId));
    expect(afterChanged).toMatchObject({ body: "after edit", payloadSourceSnapshot: null, payloadSourceSnapshotInvalidated: true });
  });
});
