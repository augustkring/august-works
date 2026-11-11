import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  agents, companies, createDb, heartbeatRuns, issueComments, issueThreadInteractions, issues,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { issueThreadInteractionService } from "../issue-thread-interactions.js";
import { captureNativeManagedQuestionInteractionOwner, materializeNativeInteractionResponses } from "./native-interaction-bridge.js";

const support = await getEmbeddedPostgresTestSupport();
const describePostgres = support.supported ? describe : describe.skip;

describePostgres("managed Native Human question owner reconstruction", () => {
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;
  let companyId: string;
  let issueId: string;
  let agentId: string;
  let runId: string;
  const userId = "managed-question-owner-test-human";

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("paperclip-managed-question-owner-");
    db = createDb(temporary.connectionString);
    companyId = randomUUID(); issueId = randomUUID(); agentId = randomUUID(); runId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Managed question owner", issuePrefix: `MQ${companyId.replaceAll("-", "").slice(0, 6)}`,
      requireBoardApprovalForNewAgents: false });
    await db.insert(agents).values({ id: agentId, companyId, name: "Native question author", adapterType: "paperclip_runner",
      status: "running", adapterConfig: { provider: "codex" }, runtimeConfig: {} });
    await db.insert(issues).values({ id: issueId, companyId, title: "Preserve managed question result ownership", status: "in_progress",
      assigneeAgentId: agentId, responsibleUserId: userId });
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, status: "running", runtimeMode: "native",
      runtimeModeResolvedAt: new Date(), nativeIssueId: issueId, responsibleUserId: userId, contextSnapshot: { issueId } });
  }, 20_000);

  afterAll(async () => { await temporary?.cleanup(); });

  const reader = () => ({ type: "agent" as const, source: "agent_jwt" as const, companyId, agentId, runId, onBehalfOfUserId: userId });
  const issueRef = () => ({ id: issueId, companyId, status: "in_progress" });
  const service = () => issueThreadInteractionService(db);
  const snapshot = async (interactionId: string) => (await db.select({ row: issueThreadInteractions,
    version: sql<string>`extract(epoch from ${issueThreadInteractions.updatedAt})::text` }).from(issueThreadInteractions)
    .where(and(eq(issueThreadInteractions.companyId, companyId), eq(issueThreadInteractions.issueId, issueId),
      eq(issueThreadInteractions.id, interactionId))))[0]!;
  async function question(key: string) {
    return service().create({ id: issueId, companyId }, { kind: "ask_user_questions", idempotencyKey: `${runId}:${key}`,
      sourceRunId: runId, title: "Choose a value", continuationPolicy: "none",
      payload: { version: 1, questions: [{ id: "choice", prompt: "Choose", selectionMode: "single", required: true,
        allowOther: false, options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] }] } }, { agentId });
  }

  it("reconstructs accepted, rejected, and comment-superseded owners without mutating their canonical source rows", async () => {
    const answered = await question("answered");
    const pendingOwner = await captureNativeManagedQuestionInteractionOwner({ db, companyId, issueId, runId, agentId,
      interactionId: answered.id, reader: reader() });
    expect(pendingOwner).toMatchObject({ status: "pending", decisionSource: null });
    const terminalAnswer = await service().answerQuestions(issueRef(), answered.id,
      { answers: [{ questionId: "choice", optionIds: ["b"] }] }, { userId });
    expect(terminalAnswer.status).toBe("answered");
    const answeredBeforeOwner = await snapshot(answered.id);
    const answeredOwner = await captureNativeManagedQuestionInteractionOwner({ db, companyId, issueId, runId, agentId,
      interactionId: answered.id, reader: reader() });
    expect(await snapshot(answered.id)).toEqual(answeredBeforeOwner);
    expect(answeredOwner.status).toBe("answered");
    expect(answeredOwner.decisionSource).toMatchObject({ kind: "interaction", interactionId: answered.id,
      sourceVersion: answeredOwner.sourceVersion, contentHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(answeredOwner.sourceVersion).not.toBe(pendingOwner.sourceVersion);
    await expect(captureNativeManagedQuestionInteractionOwner({ db, companyId, issueId, runId: randomUUID(), agentId,
      interactionId: answered.id, reader: reader() })).rejects.toMatchObject({ code: "native_interaction_binding_mismatch" });

    const accepted = await service().create({ id: issueId, companyId }, { kind: "request_confirmation", idempotencyKey: `${runId}:accepted`,
      sourceRunId: runId, title: "Confirm", continuationPolicy: "none", resolverPolicy: "human_only",
      payload: { version: 1, prompt: "Confirm the change?", acceptLabel: "Accept", rejectLabel: "Reject", allowDeclineReason: true } }, { agentId });
    await service().acceptInteraction({ ...issueRef(), projectId: null, goalId: null }, accepted.id, {}, { userId });
    const acceptedBeforeOwner = await snapshot(accepted.id);
    const acceptedOwner = await captureNativeManagedQuestionInteractionOwner({ db, companyId, issueId, runId, agentId,
      interactionId: accepted.id, reader: reader() });
    expect(await snapshot(accepted.id)).toEqual(acceptedBeforeOwner);
    expect(acceptedOwner.status).toBe("accepted");
    expect(acceptedOwner.decisionSource).toMatchObject({ kind: "interaction", interactionId: accepted.id,
      sourceVersion: acceptedOwner.sourceVersion, contentHash: expect.stringMatching(/^[a-f0-9]{64}$/) });

    const rejected = await service().create({ id: issueId, companyId }, { kind: "request_confirmation", idempotencyKey: `${runId}:rejected`,
      sourceRunId: runId, title: "Confirm", continuationPolicy: "none", resolverPolicy: "human_only",
      payload: { version: 1, prompt: "Confirm the change?", acceptLabel: "Accept", rejectLabel: "Reject", allowDeclineReason: true } }, { agentId });
    await service().rejectInteraction(issueRef(), rejected.id, { reason: "Needs revision" }, { userId });
    const rejectedBeforeOwner = await snapshot(rejected.id);
    const rejectedOwner = await captureNativeManagedQuestionInteractionOwner({ db, companyId, issueId, runId, agentId,
      interactionId: rejected.id, reader: reader() });
    expect(await snapshot(rejected.id)).toEqual(rejectedBeforeOwner);
    expect(rejectedOwner.status).toBe("rejected");
    expect(rejectedOwner.decisionSource).toMatchObject({ kind: "interaction", interactionId: rejected.id,
      sourceVersion: rejectedOwner.sourceVersion, contentHash: expect.stringMatching(/^[a-f0-9]{64}$/) });

    const supersededQuestion = await question("comment-superseded-question");
    const itemVerdicts = await service().create({ id: issueId, companyId }, { kind: "request_item_verdicts",
      idempotencyKey: `${runId}:comment-superseded-items`, sourceRunId: runId, title: "Review items", continuationPolicy: "none",
      payload: { version: 1, prompt: "Review these items", items: [{ id: "item-a", label: "Item A" }],
        verdicts: ["approve", "reject"], requireReasonOn: ["reject"], allowBulkApprove: true,
        supersedeOnUserComment: true } }, { agentId });
    const commentId = randomUUID();
    const commentCreatedAt = new Date(Date.now() + 1_000);
    await db.insert(issueComments).values({ id: commentId, companyId, issueId, authorUserId: userId, authorType: "user",
      body: "The review context changed.", createdAt: commentCreatedAt });
    const expired = await service().expireRequestConfirmationsSupersededByComment(issueRef(),
      { id: commentId, createdAt: commentCreatedAt, authorUserId: userId }, { userId });
    expect(expired.map(value => value.id).sort()).toEqual([supersededQuestion.id, itemVerdicts.id].sort());

    for (const [interactionId, kind, expectedResult] of [
      [supersededQuestion.id, "ask_user_questions", { expirationReason: "superseded_by_comment", commentId }],
      [itemVerdicts.id, "request_item_verdicts", { outcome: "superseded_by_comment", complete: false, commentId, items: [] }],
    ] as const) {
      const [before] = await db.select({ row: issueThreadInteractions,
        version: sql<string>`extract(epoch from ${issueThreadInteractions.updatedAt})::text` }).from(issueThreadInteractions)
        .where(and(eq(issueThreadInteractions.companyId, companyId), eq(issueThreadInteractions.issueId, issueId),
          eq(issueThreadInteractions.id, interactionId)));
      expect(before!.row).toMatchObject({ kind, status: "expired", result: expect.objectContaining(expectedResult) });
      const owner = await captureNativeManagedQuestionInteractionOwner({ db, companyId, issueId, runId, agentId,
        interactionId, reader: reader() });
      expect(owner.status).toBe("expired");
      expect(owner.decisionSource).toMatchObject({ kind: "interaction", interactionId, sourceVersion: before!.version,
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
      const [afterOwner] = await db.select({ row: issueThreadInteractions,
        version: sql<string>`extract(epoch from ${issueThreadInteractions.updatedAt})::text` }).from(issueThreadInteractions)
        .where(and(eq(issueThreadInteractions.companyId, companyId), eq(issueThreadInteractions.issueId, issueId),
          eq(issueThreadInteractions.id, interactionId)));
      expect(afterOwner).toEqual(before);
    }

    // Keep pre-existing non-opt-in behavior intact: item-verdict comments still
    // project audit attention, while ask-user expiration is not newly enabled.
    const beforeDefaultAsk = await snapshot(supersededQuestion.id);
    await expect(materializeNativeInteractionResponses({ db, companyId, issueId, runId, agentId,
      interactionIds: [supersededQuestion.id] })).rejects.toMatchObject({ code: "native_interaction_unresolved" });
    expect(await snapshot(supersededQuestion.id)).toEqual(beforeDefaultAsk);
    await expect(materializeNativeInteractionResponses({ db, companyId, issueId, runId, agentId,
      interactionIds: [itemVerdicts.id] })).rejects.toMatchObject({ code: "native_interaction_missing" });
    const [legacyProjected] = await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.id, itemVerdicts.id));
    expect(legacyProjected?.summary).toBe("Response retained for audit after native supersession.");
  }, 30_000);
});
