import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agentWakeupRequests,
  agents,
  authSessions,
  authUsers,
  companies,
  companyMemberships,
  completionContracts,
  createDb,
  heartbeatRuns,
  issueComments,
  issueThreadInteractions,
  issues,
  nativeRunResults,
  statusDecisions,
  toolActionDeliveries,
  toolActionRequests,
  toolInvocations,
  workAssessments,
} from "@paperclipai/db";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";
import { heartbeatService } from "../services/heartbeat.js";
import { toolActionDeliveryService } from "../services/tool-action-delivery.js";
import { commitToolActionReview } from "../services/tool-action-review.js";
import { GOVERNED_TOOL_DECISION_NOTE_DEFERRED_ACTION } from "../services/governed-tool-decision-wait.js";
import { seedNativePasskeySession } from "./helpers/native-authentication-fixtures.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe.sequential : describe.skip;
if (!embeddedPostgresSupport.supported) {
  console.warn(`Skipping governed tool decision note tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`);
}

type WakeCall = { agentId: string; options: Record<string, any> };

/**
 * APR-E2E-1 (option B). A Human's note while the Task waits only for its
 * assignee's governed tool decision starts no Run; the tool-action review wake
 * that follows the decision carries the note once. Real routes, services and
 * PostgreSQL; only the comment-route wake sink is recorded.
 */
describeEmbeddedPostgres("governed tool decision: deferred Human note (routes + postgres)", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const wakeCalls: WakeCall[] = [];
  const userId = "governed-note-owner";
  let sessionId = "";

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-governed-note-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    wakeCalls.length = 0;
    await db.delete(authSessions);
    await db.delete(authUsers);
    await db.execute(sql`TRUNCATE TABLE companies CASCADE`);
  });

  afterAll(async () => {
    await db.$client.end();
    await tempDb?.cleanup();
  });

  function app(companyId: string, actorOverride?: Record<string, unknown>) {
    const realHeartbeat = heartbeatService(db);
    const heartbeat = {
      ...realHeartbeat,
      wakeup: async (agentId: string, options: Record<string, any>) => {
        wakeCalls.push({ agentId, options });
        return null;
      },
    } as unknown as ReturnType<typeof heartbeatService>;
    const testApp = express();
    testApp.use(express.json());
    testApp.use((req, _res, next) => {
      (req as any).actor = actorOverride ?? {
        type: "board", source: "session", userId, sessionId,
        companyIds: [companyId],
        memberships: [{ companyId, status: "active", membershipRole: "operator" }],
        isInstanceAdmin: false,
      };
      next();
    });
    testApp.use("/api", issueRoutes(db, {} as any, { heartbeat }));
    testApp.use(errorHandler);
    return testApp;
  }

  async function seed(options: {
    cardCreatedBy?: "assignee" | "other_agent" | "user";
    secondPendingInteraction?: boolean;
    decisionReason?: string;
    toolAction?: boolean;
  } = {}) {
    const now = new Date();
    const companyId = randomUUID(), agentId = randomUUID(), otherAgentId = randomUUID(), issueId = randomUUID();
    const sourceRunId = randomUUID(), contractId = randomUUID(), resultId = randomUUID();
    const assessmentId = randomUUID(), decisionId = randomUUID();
    const invocationId = randomUUID(), actionRequestId = randomUUID(), interactionId = randomUUID();
    await db.insert(authUsers).values({ id: userId, name: "Owner", email: "governed-note@example.test",
      emailVerified: true, createdAt: now, updatedAt: now });
    sessionId = await seedNativePasskeySession(db, userId);
    await db.insert(companies).values({ id: companyId, name: "Governed note", issuePrefix: `GN${Math.floor(Math.random() * 9000 + 1000)}`,
      defaultResponsibleUserId: userId, requireBoardApprovalForNewAgents: false });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId,
      status: "active", membershipRole: "operator" });
    await db.insert(agents).values([
      { id: agentId, companyId, name: "Reviewed reader", role: "engineer", status: "idle",
        adapterType: "process", adapterConfig: {}, runtimeConfig: {}, permissions: {} },
      { id: otherAgentId, companyId, name: "Other agent", role: "engineer", status: "idle",
        adapterType: "process", adapterConfig: {}, runtimeConfig: {}, permissions: {} },
    ]);
    await db.insert(issues).values({ id: issueId, companyId, identifier: `GN-${issueId.slice(0, 4)}`,
      title: "Read projects", status: "in_review", priority: "medium", assigneeAgentId: agentId,
      responsibleUserId: userId, createdByUserId: userId });
    await db.insert(completionContracts).values({ id: contractId, companyId, issueId, revision: 1,
      schemaVersion: "paperclip.completion-contract.v1", policyVersion: "fixture-v1", risk: "standard",
      completionAuthority: "server_arbiter", incompleteCriteriaPolicy: "preserve_non_terminal",
      contractJson: { revision: "1", objective: "Read", criteria: [{ id: "objective", requirement: "Read" }] },
      canonicalSha256: "a".repeat(64), createdByActorType: "system", createdByActorId: "test" });
    await db.insert(heartbeatRuns).values({ id: sourceRunId, companyId, agentId, issueId, scopeKind: "issue",
      nativeIssueId: issueId, responsibleUserId: userId, runtimeMode: "native", status: "succeeded",
      invocationSource: "assignment", triggerDetail: "system", completionContractId: contractId,
      completionContractSha256: "a".repeat(64), startedAt: new Date(now.getTime() - 60_000),
      finishedAt: new Date(now.getTime() - 30_000), contextSnapshot: { issueId } });
    await db.insert(nativeRunResults).values({ id: resultId, companyId, issueId, runId: sourceRunId,
      completionContractId: contractId, serverFingerprint: resultId, schemaStatus: "accepted",
      resultJson: { schema: "paperclip.run_result.v1", reportedWorkDisposition: "yielded" }, canonicalSha256: "b".repeat(64) });
    await db.insert(workAssessments).values({ id: assessmentId, companyId, issueId, runId: sourceRunId, contractId,
      resultId, triggerKind: "native_result", triggerActorCompanyId: companyId, priorIssueStatus: "in_progress",
      priorStatusVersion: 0, policyVersion: "fixture-v1", assessmentJson: {}, inputDigest: "c".repeat(64) });
    await db.insert(statusDecisions).values({ id: decisionId, companyId, issueId, runId: sourceRunId, assessmentId,
      decisionVersion: 1, policyVersion: "fixture-v1", fromStatus: "in_progress", toStatus: "in_review",
      reasonCode: options.decisionReason ?? "governed_response_waiting",
      decisionJson: { statusAction: "in_review" }, decisionDigest: "d".repeat(64), applicationState: "applied", appliedAt: now });
    await db.update(issues).set({ lastStatusDecisionId: decisionId }).where(eq(issues.id, issueId));
    await db.insert(toolInvocations).values({ id: invocationId, companyId, actorType: "agent", actorId: agentId,
      agentId, issueId, runId: sourceRunId, toolName: "railway_list_projects", approvalState: "pending",
      status: "awaiting_approval" });
    const cardCreatedBy = options.cardCreatedBy ?? "assignee";
    await db.insert(issueThreadInteractions).values({ id: interactionId, companyId, issueId,
      kind: "request_confirmation", status: "pending", continuationPolicy: "wake_assignee",
      requestedResolverPolicy: "human_only", effectiveResolverPolicy: "human_only", resolverPolicyProvenance: "explicit",
      sourceRunId,
      ...(cardCreatedBy === "assignee" ? { createdByAgentId: agentId }
        : cardCreatedBy === "other_agent" ? { createdByAgentId: otherAgentId } : { createdByUserId: userId }),
      payload: { version: 1, prompt: "Approve railway_list_projects?",
        ...(options.toolAction === false ? {} : { toolAction: { version: 1, actionRequestId, invocationId,
          toolName: "railway_list_projects", toolDisplayName: "List projects", connectionId: null, applicationId: null,
          appDisplayName: null, risk: "read", previewMarkdown: "List the workspace's projects.",
          argumentsSummaryJson: "{\"first\":25}", argumentsHash: "e".repeat(64),
          expiresAt: new Date(now.getTime() + 3_600_000).toISOString() } }) } as never });
    await db.insert(toolActionRequests).values({ id: actionRequestId, companyId, invocationId, issueId, interactionId,
      status: "pending", canonicalArgumentsHash: "e".repeat(64), canonicalArgumentsSummary: {} as never,
      requestedByAgentId: agentId });
    if (options.secondPendingInteraction) {
      await db.insert(issueThreadInteractions).values({ companyId, issueId, kind: "request_confirmation",
        status: "pending", continuationPolicy: "wake_assignee", requestedResolverPolicy: "human_only",
        effectiveResolverPolicy: "human_only", resolverPolicyProvenance: "explicit", createdByAgentId: agentId,
        sourceRunId, payload: { version: 1, prompt: "Also approve the plan?" } as never });
    }
    return { companyId, agentId, otherAgentId, issueId, sourceRunId, interactionId, actionRequestId };
  }

  const note = "Keeping this review pending while I check.";
  async function postNote(seeded: Awaited<ReturnType<typeof seed>>, body = note) {
    const res = await request(app(seeded.companyId)).post(`/api/issues/${seeded.issueId}/comments`).send({ body });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  }
  const assigneeWakesFor = (agentId: string, commentId: string) => wakeCalls.filter(call =>
    call.agentId === agentId && (call.options.payload?.commentId === commentId || call.options.contextSnapshot?.commentId === commentId));
  const deferrals = (companyId: string) => db.select().from(activityLog).where(and(eq(activityLog.companyId, companyId),
    eq(activityLog.action, GOVERNED_TOOL_DECISION_NOTE_DEFERRED_ACTION)));
  // The comment route enqueues its wakes after responding.
  const waitForAssigneeWake = (agentId: string, commentId: string) =>
    vi.waitFor(() => expect(assigneeWakesFor(agentId, commentId)).toHaveLength(1), { timeout: 10_000 });
  const settleAfterDeferral = async (companyId: string) => {
    await vi.waitFor(async () => expect(await deferrals(companyId)).toHaveLength(1), { timeout: 10_000 });
    await new Promise(resolve => setTimeout(resolve, 1_000));
  };

  it("starts no Run for the note, records the deferral, and hands the note once to the review resolution wake", async () => {
    const seeded = await seed();
    const commentId = await postNote(seeded);
    await settleAfterDeferral(seeded.companyId);
    // Removal check: without the deferral this note wakes the assignee here.
    expect(assigneeWakesFor(seeded.agentId, commentId)).toEqual([]);
    const recorded = await deferrals(seeded.companyId);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.actorType).toBe("user");
    expect(recorded[0]!.details).toMatchObject({ commentId, interactionId: seeded.interactionId,
      sourceRunId: seeded.sourceRunId, assigneeAgentId: seeded.agentId, reason: "governed_tool_decision_pending" });
    expect(await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.companyId, seeded.companyId))).toEqual([]);

    // The Human declines the card; the gateway records the decision and its outcome receipt.
    await db.update(issueThreadInteractions).set({ status: "rejected", resolvedByUserId: userId, resolvedAt: new Date(),
      result: { version: 1, outcome: "rejected" } as never }).where(eq(issueThreadInteractions.id, seeded.interactionId));
    await db.update(toolActionRequests).set({ status: "rejected", decidedByUserId: userId, resolvedByUserId: userId,
      resolvedAt: new Date() }).where(eq(toolActionRequests.id, seeded.actionRequestId));
    await db.update(issues).set({ status: "todo" }).where(eq(issues.id, seeded.issueId));
    await db.insert(toolActionDeliveries).values({ actionRequestId: seeded.actionRequestId, companyId: seeded.companyId,
      issueId: seeded.issueId, interactionId: seeded.interactionId });
    const deliveryWakes: WakeCall[] = [];
    const delivery = toolActionDeliveryService(db, {
      wakeup: (async (agentId: string, options: Record<string, any>) => {
        deliveryWakes.push({ agentId, options });
        // The committed wake row the delivery attests, as heartbeat.wakeup writes it.
        await db.insert(agentWakeupRequests).values({ companyId: seeded.companyId, agentId, source: options.source,
          triggerDetail: options.triggerDetail, reason: options.reason, payload: options.payload,
          idempotencyKey: options.idempotencyKey, requestedByActorType: options.requestedByActorType,
          requestedByActorId: options.requestedByActorId, status: "queued" });
        return null;
      }) as never,
    });
    expect(await delivery.deliver(seeded.actionRequestId)).toBe(true);
    expect(deliveryWakes).toHaveLength(1);
    expect(deliveryWakes[0]!.agentId).toBe(seeded.agentId);
    expect(deliveryWakes[0]!.options.idempotencyKey).toBe(`tool-action-response:${seeded.actionRequestId}`);
    expect(deliveryWakes[0]!.options.contextSnapshot.wakeCommentIds).toEqual([commentId]);
    expect(deliveryWakes[0]!.options.contextSnapshot.interactionId).toBe(seeded.interactionId);
    // Exactly once: the receipt is settled and a retry sends nothing.
    expect(await delivery.deliver(seeded.actionRequestId)).toBe(false);
    expect(deliveryWakes).toHaveLength(1);
  });

  it("puts the deferred note into the resolution Run's comment batch through the real wake owner", async () => {
    const seeded = await seed();
    const commentId = await postNote(seeded);
    await settleAfterDeferral(seeded.companyId);
    const [comment] = await db.select().from(issueComments).where(eq(issueComments.id, commentId));
    expect(comment?.authorUserId).toBe(userId);
    await db.update(issueThreadInteractions).set({ status: "rejected", resolvedByUserId: userId, resolvedAt: new Date(),
      result: { version: 1, outcome: "rejected" } as never }).where(eq(issueThreadInteractions.id, seeded.interactionId));
    await db.update(toolActionRequests).set({ status: "rejected", decidedByUserId: userId, resolvedByUserId: userId,
      resolvedAt: new Date() }).where(eq(toolActionRequests.id, seeded.actionRequestId));
    await db.update(issues).set({ status: "todo" }).where(eq(issues.id, seeded.issueId));
    await db.insert(toolActionDeliveries).values({ actionRequestId: seeded.actionRequestId, companyId: seeded.companyId,
      issueId: seeded.issueId, interactionId: seeded.interactionId });
    const realHeartbeat = heartbeatService(db);
    const delivery = toolActionDeliveryService(db, realHeartbeat);
    await delivery.deliver(seeded.actionRequestId);
    const wakes = await db.select().from(agentWakeupRequests).where(and(eq(agentWakeupRequests.companyId, seeded.companyId),
      eq(agentWakeupRequests.idempotencyKey, `tool-action-response:${seeded.actionRequestId}`)));
    expect(wakes).toHaveLength(1);
    const context = (wakes[0]!.payload as Record<string, any>)._paperclipWakeContext ?? {};
    const runs = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, seeded.companyId),
      eq(heartbeatRuns.wakeupRequestId, wakes[0]!.id)));
    const runContext = (runs[0]?.contextSnapshot ?? context) as Record<string, any>;
    expect(runContext.wakeCommentIds).toEqual([commentId]);
    expect(runContext.interactionId).toBe(seeded.interactionId);
  });

  it.each(["approved", "rejected"] as const)("returns the Task to todo when the governed card is %s through the gateway (APR-E2E-12)", async (decision) => {
    const seeded = await seed();
    await commitToolActionReview(db, { companyId: seeded.companyId, actionRequestId: seeded.actionRequestId,
      issueId: seeded.issueId, interactionId: seeded.interactionId, decision, actor: { userId } });
    const [issue] = await db.select().from(issues).where(eq(issues.id, seeded.issueId));
    expect(issue?.status).toBe("todo");
    const [card] = await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.id, seeded.interactionId));
    expect(card?.status).toBe(decision === "approved" ? "accepted" : "rejected");
    const updates = await db.select().from(activityLog).where(and(eq(activityLog.companyId, seeded.companyId),
      eq(activityLog.action, "issue.updated")));
    expect(updates.some(row => (row.details as Record<string, unknown>).source === "tool_action_review")).toBe(true);
  });

  it("keeps the Task in review when the resolved card was not the Task's governed wait (APR-E2E-12)", async () => {
    const seeded = await seed({ decisionReason: "execution_policy_stage_handoff" });
    await commitToolActionReview(db, { companyId: seeded.companyId, actionRequestId: seeded.actionRequestId,
      issueId: seeded.issueId, interactionId: seeded.interactionId, decision: "rejected", actor: { userId } });
    const [issue] = await db.select().from(issues).where(eq(issues.id, seeded.issueId));
    expect(issue?.status).toBe("in_review");
  });

  it.each([
    ["the card was created by another Agent", { cardCreatedBy: "other_agent" as const }],
    ["the card was created by a user", { cardCreatedBy: "user" as const }],
    ["a second interaction is pending", { secondPendingInteraction: true }],
    ["the latest decision is a review handoff", { decisionReason: "execution_policy_stage_handoff" }],
    ["the card is not a tool-action card (plan or signoff review)", { toolAction: false }],
  ])("keeps the ordinary wake when %s", async (_label, options) => {
    const seeded = await seed(options);
    const commentId = await postNote(seeded);
    await waitForAssigneeWake(seeded.agentId, commentId);
    expect(await deferrals(seeded.companyId)).toEqual([]);
  });

  it("keeps the ordinary wake when the Task is not in review", async () => {
    const seeded = await seed();
    await db.update(issues).set({ status: "in_progress" }).where(eq(issues.id, seeded.issueId));
    const commentId = await postNote(seeded);
    await waitForAssigneeWake(seeded.agentId, commentId);
    expect(await deferrals(seeded.companyId)).toEqual([]);
  });

  it("keeps the ordinary wake for a comment from another Agent", async () => {
    const seeded = await seed();
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({ id: runId, companyId: seeded.companyId, agentId: seeded.otherAgentId,
      invocationSource: "assignment", triggerDetail: "system", status: "running",
      contextSnapshot: { issueId: seeded.issueId } });
    const res = await request(app(seeded.companyId, { type: "agent", source: "agent_key", companyId: seeded.companyId,
      agentId: seeded.otherAgentId, runId })).post(`/api/issues/${seeded.issueId}/comments`).send({ body: "From a peer agent." });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    await waitForAssigneeWake(seeded.agentId, res.body.id);
    expect(await deferrals(seeded.companyId)).toEqual([]);
  });

  it("also defers an @-mention of the assignee inside the deferred note", async () => {
    const seeded = await seed();
    const commentId = await postNote(seeded, `@Reviewed reader ${note}`);
    await settleAfterDeferral(seeded.companyId);
    expect(wakeCalls.filter(call => call.agentId === seeded.agentId)).toEqual([]);
    const recorded = await deferrals(seeded.companyId);
    expect(recorded.map(row => (row.details as Record<string, unknown>).commentId)).toEqual([commentId]);
  });
});
