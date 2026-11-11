import {
  agents,
  heartbeatRuns,
  nativeRunFinalizations,
  statusDecisionEffects,
  nativeRunResults,
  workAssessments,
  issueThreadInteractions,
  issues,
  statusDecisions,
  type Db,
} from "@paperclipai/db";
import { and, eq, isNull, or } from "drizzle-orm";
import { evaluateAgentInvokabilityFromDb } from "../agent-invokability.js";
import { canonicalizeStoredResolverPolicy } from "../issue-thread-interaction-resolution.js";
import { nativeRunInputSourceReceiptSchema, type NativePayloadSourceInput } from "@paperclipai/shared";
import { nativeSha256 } from "./canonical.js";
import { buildNativeReviewRequest } from "./native-review-prompt.js";

export type NativeReviewAssignmentContext = {
  nativeReviewInteractionId: string;
  nativeReviewDecisionId: string;
};

type ReviewPayload = {
  version?: number;
  prompt?: string;
  target?: { type?: string; key?: string; revisionId?: string } | null;
  toolAction?: unknown;
  secretProposal?: unknown;
};
type InteractionFacts = Pick<typeof issueThreadInteractions.$inferSelect,
  "id" | "companyId" | "issueId" | "kind" | "status" | "sourceRunId" | "addresseeAgentId" |
  "addresseeUserId" | "effectiveResolverPolicy" | "resolverPolicyProvenance" |
  "resolvedByAgentId" | "resolvedByRunId"> & { payload: ReviewPayload };
type DecisionFacts = Pick<typeof statusDecisions.$inferSelect,
  "id" | "companyId" | "issueId" | "runId" | "decisionJson" | "applicationState">;
type SourceRunFacts = Pick<typeof heartbeatRuns.$inferSelect,
  "id" | "companyId" | "agentId" | "nativeIssueId">;

export type NativeReviewAssignmentFacts = {
  companyId: string;
  issueId: string;
  agentId: string;
  issueStatus: string;
  issueStatusVersion: number;
  issueLastStatusDecisionId: string | null;
  issueAssigneeAgentId: string | null;
  issueExecutionRunId?: string | null;
  interaction: InteractionFacts;
  decision: DecisionFacts;
  sourceRun: SourceRunFacts;
  agentInvokable: boolean;
  actingRun?: {
    id: string;
    companyId: string;
    agentId: string;
    status: string;
    nativeIssueId: string | null;
    contextSnapshot: Record<string, unknown> | null;
  };
  allowResolvedByRunId?: string;
};

export type NativeReviewAssignment = {
  interaction: typeof issueThreadInteractions.$inferSelect;
  sourceDecision: typeof statusDecisions.$inferSelect;
  sourceRun: typeof heartbeatRuns.$inferSelect;
};

export function readNativeReviewAssignmentContext(
  snapshot: unknown,
): NativeReviewAssignmentContext | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const value = snapshot as Record<string, unknown>;
  const interactionId = value.nativeReviewInteractionId;
  const decisionId = value.nativeReviewDecisionId;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (typeof interactionId !== "string" || !uuid.test(interactionId)) return null;
  if (typeof decisionId !== "string" || !uuid.test(decisionId)) return null;
  return { nativeReviewInteractionId: interactionId, nativeReviewDecisionId: decisionId };
}

function isNativeCompletionReview(interaction: InteractionFacts, decisionId: string) {
  const target = interaction.payload?.target;
  return target?.type === "custom"
    && target.key === "native_completion_review"
    && target.revisionId === decisionId;
}

export function validateNativeReviewAssignmentFacts(input: NativeReviewAssignmentFacts): boolean {
  const { interaction, decision, sourceRun } = input;
  if (!input.agentInvokable) return false;
  if (input.issueAssigneeAgentId !== sourceRun?.agentId) return false;
  if (sourceRun?.agentId === input.agentId) return false;
  if (!interaction || interaction.companyId !== input.companyId || interaction.issueId !== input.issueId) return false;
  if (!decision || decision.companyId !== input.companyId || decision.issueId !== input.issueId) return false;
  if (decision.applicationState !== "applied") return false;
  if (!sourceRun || sourceRun.companyId !== input.companyId || sourceRun.nativeIssueId !== input.issueId) return false;
  if (interaction.kind !== "request_confirmation") return false;
  if (interaction.sourceRunId !== decision.runId || interaction.sourceRunId !== sourceRun.id) return false;
  if (interaction.addresseeAgentId !== input.agentId) return false;
  if (interaction.addresseeUserId) return false;
  if (interaction.payload?.toolAction || interaction.payload?.secretProposal) return false;
  if (!isNativeCompletionReview(interaction, decision.id)) return false;

  if (input.actingRun) {
    const actingContext = readNativeReviewAssignmentContext(
      input.actingRun.contextSnapshot,
    );
    if (
      input.actingRun.id.length === 0 ||
      input.actingRun.companyId !== input.companyId ||
      input.actingRun.agentId !== input.agentId ||
      input.actingRun.status !== "running" ||
      input.actingRun.nativeIssueId !== input.issueId ||
      (input.issueExecutionRunId !== undefined &&
        input.issueExecutionRunId !== input.actingRun.id) ||
      !actingContext ||
      actingContext.nativeReviewInteractionId !== interaction.id ||
      actingContext.nativeReviewDecisionId !== decision.id
    ) return false;
    const context = input.actingRun.contextSnapshot ?? {};
    if (context.issueId !== undefined && context.issueId !== input.issueId)
      return false;
    if (context.sourceRunId !== undefined && context.sourceRunId !== sourceRun.id)
      return false;
    if (context.revisionId !== undefined && context.revisionId !== decision.id)
      return false;
  }

  const policy = canonicalizeStoredResolverPolicy(
    interaction.effectiveResolverPolicy,
    interaction.resolverPolicyProvenance,
  );
  if (policy === "human_only") return false;
  if (interaction.status === "pending") {
    if (input.issueStatus !== "in_review") return false;
    if (input.issueLastStatusDecisionId !== decision.id) return false;
    const projected = Number(decision.decisionJson?.projectedStatusVersion);
    return Number.isFinite(projected) && input.issueStatusVersion === projected;
  }
  return (interaction.status === "accepted" || interaction.status === "rejected")
    && typeof input.allowResolvedByRunId === "string"
    && interaction.resolvedByRunId === input.allowResolvedByRunId
    && interaction.resolvedByAgentId === input.agentId;
}

export async function getNativeReviewAssignment(
  db: Db,
  input: {
    companyId: string;
    issueId: string;
    agentId: string;
    contextSnapshot: unknown;
    actingRunId?: string;
    issueExecutionRunId?: string | null;
    allowResolvedByRunId?: string;
  },
): Promise<NativeReviewAssignment | null> {
  const context = readNativeReviewAssignmentContext(input.contextSnapshot);
  if (!context) return null;
  const issue = await db.select().from(issues).where(and(
    eq(issues.companyId, input.companyId), eq(issues.id, input.issueId),
  )).limit(1).then((rows) => rows[0] ?? null);
  const agent = await db.select().from(agents).where(and(
    eq(agents.companyId, input.companyId), eq(agents.id, input.agentId),
  )).limit(1).then((rows) => rows[0] ?? null);
  if (!issue || !agent) return null;
  const interaction = await db.select().from(issueThreadInteractions).where(and(
    eq(issueThreadInteractions.id, context.nativeReviewInteractionId),
    eq(issueThreadInteractions.companyId, input.companyId),
    eq(issueThreadInteractions.issueId, input.issueId),
  )).limit(1).then((rows) => rows[0] ?? null);
  const decision = await db.select().from(statusDecisions).where(and(
    eq(statusDecisions.id, context.nativeReviewDecisionId),
    eq(statusDecisions.companyId, input.companyId),
    eq(statusDecisions.issueId, input.issueId),
  )).limit(1).then((rows) => rows[0] ?? null);
  if (!interaction || !decision) return null;
  const sourceRun = await db.select().from(heartbeatRuns).where(and(
    eq(heartbeatRuns.id, decision.runId),
    eq(heartbeatRuns.companyId, input.companyId),
    eq(heartbeatRuns.agentId, issue.assigneeAgentId ?? "00000000-0000-0000-0000-000000000000"),
    eq(heartbeatRuns.nativeIssueId, input.issueId),
  )).limit(1).then((rows) => rows[0] ?? null);
  if (!sourceRun) return null;
  const actingRun = input.actingRunId
    ? await db.select().from(heartbeatRuns).where(and(
        eq(heartbeatRuns.id, input.actingRunId),
        eq(heartbeatRuns.companyId, input.companyId),
        eq(heartbeatRuns.agentId, input.agentId),
      )).limit(1).then((rows) => rows[0] ?? null)
    : undefined;
  if (input.actingRunId && !actingRun) return null;
  const invokability = await evaluateAgentInvokabilityFromDb(db, agent);
  const valid = validateNativeReviewAssignmentFacts({
    companyId: input.companyId,
    issueId: input.issueId,
    agentId: input.agentId,
    issueStatus: issue.status,
    issueStatusVersion: Number(issue.statusVersion),
    issueLastStatusDecisionId: issue.lastStatusDecisionId,
    issueAssigneeAgentId: issue.assigneeAgentId,
    interaction: interaction as InteractionFacts,
    decision,
    sourceRun,
    agentInvokable: invokability.invokable,
    actingRun: actingRun
      ? {
          id: actingRun.id,
          companyId: actingRun.companyId,
          agentId: actingRun.agentId,
          status: actingRun.status,
          nativeIssueId: actingRun.nativeIssueId,
          contextSnapshot: actingRun.contextSnapshot,
        }
      : undefined,
    issueExecutionRunId: input.issueExecutionRunId,
    allowResolvedByRunId: input.allowResolvedByRunId,
  });
  return valid ? { interaction, sourceDecision: decision, sourceRun } : null;
}

/** Resolve an already-captured review's immutable owner rows without applying
 * live admission policy (current assignee or reviewer invokability). Callers
 * must still recheck source ACLs, receipt, committed result and current owners. */
export async function getNativeReviewSourceAssignment(db: Db, input: {
  companyId: string; issueId: string; reviewerAgentId: string; contextSnapshot: unknown;
}): Promise<NativeReviewAssignment | null> {
  const context = readNativeReviewAssignmentContext(input.contextSnapshot);
  if (!context) return null;
  const [interaction] = await db.select().from(issueThreadInteractions).where(and(
    eq(issueThreadInteractions.id, context.nativeReviewInteractionId), eq(issueThreadInteractions.companyId, input.companyId),
    eq(issueThreadInteractions.issueId, input.issueId))).limit(1);
  const [decision] = await db.select().from(statusDecisions).where(and(
    eq(statusDecisions.id, context.nativeReviewDecisionId), eq(statusDecisions.companyId, input.companyId),
    eq(statusDecisions.issueId, input.issueId))).limit(1);
  if (!interaction || !decision || decision.applicationState !== "applied" ||
      interaction.sourceRunId !== decision.runId || interaction.addresseeAgentId !== input.reviewerAgentId ||
      interaction.addresseeUserId || decision.assessmentId === null) return null;
  const [sourceRun] = await db.select().from(heartbeatRuns).where(and(
    eq(heartbeatRuns.id, decision.runId), eq(heartbeatRuns.companyId, input.companyId),
    eq(heartbeatRuns.nativeIssueId, input.issueId))).limit(1);
  if (!sourceRun || sourceRun.agentId === input.reviewerAgentId) return null;
  return { interaction, sourceDecision: decision, sourceRun };
}

export type NativeReviewWakeWitness = NonNullable<Extract<NativePayloadSourceInput, { kind: "native_task_wake" }>["nativeReview"]>;

/** Bind review prompt bytes to the exact committed Native result that created
 * the assigned review. The current wake source rederives this witness; it is
 * not accepted as a saved permission or a caller-selected review label. */
export async function captureNativeReviewWakeWitness(db: Db | Parameters<Parameters<Db["transaction"]>[0]>[0], input: {
  companyId: string; issueId: string; reviewerRunId: string; reviewerAgentId: string; responsibleUserId: string;
  reviewerCompletionContract: { id: string; sha256: string };
  assignment: NativeReviewAssignment;
}): Promise<NativeReviewWakeWitness | null> {
  const assignment = input.assignment;
  const interaction = assignment.interaction;
  const decision = assignment.sourceDecision;
  const sourceRun = assignment.sourceRun;
  const [reviewerRun] = await db.select({ id: heartbeatRuns.id, companyId: heartbeatRuns.companyId,
    agentId: heartbeatRuns.agentId, responsibleUserId: heartbeatRuns.responsibleUserId, createdAt: heartbeatRuns.createdAt })
    .from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, input.companyId),
      eq(heartbeatRuns.id, input.reviewerRunId), eq(heartbeatRuns.agentId, input.reviewerAgentId))).limit(1);
  if (!reviewerRun || reviewerRun.responsibleUserId !== input.responsibleUserId ||
      sourceRun.id === reviewerRun.id || sourceRun.createdAt >= reviewerRun.createdAt ||
      interaction.createdAt > reviewerRun.createdAt) return null;
  if (interaction.kind !== "request_confirmation" || interaction.addresseeAgentId !== input.reviewerAgentId ||
      interaction.addresseeUserId !== null || interaction.companyId !== input.companyId || interaction.issueId !== input.issueId ||
      decision.companyId !== input.companyId || decision.issueId !== input.issueId ||
      sourceRun.companyId !== input.companyId || sourceRun.nativeIssueId !== input.issueId ||
      interaction.sourceRunId !== sourceRun.id || decision.runId !== sourceRun.id ||
      decision.applicationState !== "applied" || !decision.appliedAt ||
      !sourceRun.responsibleUserId || !sourceRun.completionContractId || !sourceRun.completionContractSha256 ||
      !input.responsibleUserId || !input.reviewerCompletionContract.id || !input.reviewerCompletionContract.sha256 ||
      sourceRun.status !== "succeeded" || sourceRun.nativePhase !== "committed" || sourceRun.nativeProcessCleanupPending !== false ||
      sourceRun.nativeInputSourceProtocolVersion !== 1) return null;
  const profile = sourceRun.runnerProfileJson && typeof sourceRun.runnerProfileJson === "object" && !Array.isArray(sourceRun.runnerProfileJson)
    ? sourceRun.runnerProfileJson as Record<string, unknown> : {};
  const receipt = nativeRunInputSourceReceiptSchema.safeParse(profile.nativeInputSourceReceipt);
  if (!receipt.success || receipt.data.binding.companyId !== input.companyId || receipt.data.binding.runId !== sourceRun.id ||
      receipt.data.binding.agentId !== sourceRun.agentId || receipt.data.binding.issueId !== input.issueId ||
      receipt.data.binding.responsibleUserId !== sourceRun.responsibleUserId) return null;
  const [coordinator] = await db.select().from(nativeRunFinalizations).where(and(
    eq(nativeRunFinalizations.companyId, input.companyId), eq(nativeRunFinalizations.issueId, input.issueId),
    eq(nativeRunFinalizations.runId, sourceRun.id), eq(nativeRunFinalizations.phase, "committed"),
    isNull(nativeRunFinalizations.leaseOwner))).limit(1);
  if (!coordinator?.resultId || !coordinator.assessmentId || coordinator.decisionId !== decision.id ||
      coordinator.failureCode || coordinator.nextAttemptAt) return null;
  const [accepted] = await db.select().from(nativeRunResults).where(and(
    eq(nativeRunResults.companyId, input.companyId), eq(nativeRunResults.issueId, input.issueId),
    eq(nativeRunResults.runId, sourceRun.id), eq(nativeRunResults.id, coordinator.resultId),
    eq(nativeRunResults.schemaStatus, "accepted"))).limit(1);
  const [assessment] = await db.select().from(workAssessments).where(and(
    eq(workAssessments.companyId, input.companyId), eq(workAssessments.issueId, input.issueId),
    eq(workAssessments.runId, sourceRun.id), eq(workAssessments.id, coordinator.assessmentId),
    eq(workAssessments.resultId, coordinator.resultId))).limit(1);
  if (!accepted || !assessment || decision.assessmentId !== assessment.id || decision.runId !== sourceRun.id ||
      accepted.completionContractId !== sourceRun.completionContractId) return null;
  const runResult = sourceRun.resultJson && typeof sourceRun.resultJson === "object" && !Array.isArray(sourceRun.resultJson)
    ? sourceRun.resultJson as Record<string, unknown> : {};
  if (runResult.finalizationPhase !== "committed" || runResult.assessmentId !== assessment.id || runResult.decisionId !== decision.id)
    return null;
  const { acceptedResponseDigestMatches } = await import("./native-run-finalizer.js");
  if (!await acceptedResponseDigestMatches(db, sourceRun, accepted)) return null;
  const decisionRecord = decision.decisionJson && typeof decision.decisionJson === "object" && !Array.isArray(decision.decisionJson)
    ? decision.decisionJson as Record<string, unknown> : {};
  const effects = Array.isArray(decisionRecord.effects) ? decisionRecord.effects : [];
  const payload = interaction.payload && typeof interaction.payload === "object" && !Array.isArray(interaction.payload)
    ? interaction.payload as unknown as Record<string, unknown> : {};
  const effectOwners = await db.select().from(statusDecisionEffects).where(and(
    eq(statusDecisionEffects.companyId, input.companyId), eq(statusDecisionEffects.issueId, input.issueId),
    eq(statusDecisionEffects.decisionId, decision.id), eq(statusDecisionEffects.effectKind, "bind_reviewer"),
    eq(statusDecisionEffects.targetType, "issue_thread_interaction"), eq(statusDecisionEffects.targetId, interaction.id),
    eq(statusDecisionEffects.deliveryState, "delivered"))).limit(2);
  const effectOwner = effectOwners.length === 1 ? effectOwners[0] : null;
  const candidateEffects = effects.filter(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const candidate = value as Record<string, unknown>;
    if (candidate.kind !== "bind_reviewer" || candidate.ownerAgentId !== input.reviewerAgentId ||
        (candidate.ownerUserId !== null && candidate.ownerUserId !== undefined)) return false;
    const suffix = typeof candidate.requestKey === "string" && candidate.requestKey.length > 0 ? `:${candidate.requestKey}` : "";
    return interaction.idempotencyKey === `native-review:${decision.id}${suffix}` &&
      candidate.prompt === interaction.summary && (candidate.detailsMarkdown ?? null) === (payload.detailsMarkdown ?? null);
  });
  const effect = candidateEffects[0] && typeof candidateEffects[0] === "object" ? candidateEffects[0] as Record<string, unknown> : null;
  const target = payload.target && typeof payload.target === "object" && !Array.isArray(payload.target)
    ? payload.target as Record<string, unknown> : null;
  if (!effectOwner || !effect || candidateEffects.length !== 1 || effectOwner.payload.interactionId !== interaction.id ||
      effectOwner.payload.interactionKind !== "request_confirmation" || effectOwner.payload.ownerAgentId !== input.reviewerAgentId ||
      (effectOwner.payload.ownerUserId !== null && effectOwner.payload.ownerUserId !== undefined) || interaction.title !== "Review requested" ||
      typeof effect.prompt !== "string" || interaction.summary !== effect.prompt || payload.prompt !== effect.prompt ||
      (payload.detailsMarkdown ?? null) !== (effect.detailsMarkdown ?? null) || !target || target.type !== "custom" ||
      target.key !== "native_completion_review" || target.revisionId !== decision.id ||
      !/^[0-9a-f]{64}$/.test(decision.decisionDigest)) return null;
  const requestEvidence = { title: interaction.title, summary: interaction.summary, payload: interaction.payload };
  const renderedRequest = buildNativeReviewRequest(requestEvidence);
  return {
    version: 1, companyId: input.companyId, issueId: input.issueId, reviewerRunId: input.reviewerRunId,
    reviewerAgentId: input.reviewerAgentId, responsibleUserId: input.responsibleUserId,
    interactionId: interaction.id, decisionId: decision.id, interactionCreatedAt: interaction.createdAt.toISOString(),
    sourceRunCreatedAt: sourceRun.createdAt.toISOString(), reviewerRunCreatedAt: reviewerRun.createdAt.toISOString(),
    interactionRequestHash: nativeSha256(requestEvidence), renderedRequestHash: nativeSha256(renderedRequest),
    decisionDigest: decision.decisionDigest, sourceRunId: sourceRun.id, sourceAgentId: sourceRun.agentId,
    sourceResponsibleUserId: sourceRun.responsibleUserId, sourceReceiptDigest: receipt.data.digest, sourceResultId: accepted.id, sourceResultCanonicalSha256: accepted.canonicalSha256,
    sourceCompletionContractId: sourceRun.completionContractId, sourceCompletionContractSha256: sourceRun.completionContractSha256,
    reviewerCompletionContractId: input.reviewerCompletionContract.id,
    reviewerCompletionContractSha256: input.reviewerCompletionContract.sha256,
  };
}


/** Claim the normal issue execution lock without changing the worker assignee. */
export async function claimNativeReviewExecutionLock(db: Db, input: {
  companyId: string;
  issueId: string;
  agentId: string;
  runId: string;
  contextSnapshot: unknown;
  agentNameKey: string | null;
  claimedAt: Date;
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const issue = await tx.select({ id: issues.id }).from(issues).where(and(
      eq(issues.id, input.issueId), eq(issues.companyId, input.companyId),
    )).for("update").limit(1).then((rows) => rows[0]);
    if (!issue || !await getNativeReviewAssignment(tx as unknown as Db, input)) return false;
    const run = await tx.select().from(heartbeatRuns).where(and(
      eq(heartbeatRuns.id, input.runId), eq(heartbeatRuns.companyId, input.companyId),
      eq(heartbeatRuns.agentId, input.agentId),
    )).limit(1).then((rows) => rows[0]);
    const admitted = readNativeReviewAssignmentContext(run?.contextSnapshot);
    const expected = readNativeReviewAssignmentContext(input.contextSnapshot);
    if (!run || !["queued", "running"].includes(run.status) || !admitted || !expected
      || admitted.nativeReviewInteractionId !== expected.nativeReviewInteractionId
      || admitted.nativeReviewDecisionId !== expected.nativeReviewDecisionId) return false;
    const claimed = await tx.update(issues).set({
      executionRunId: input.runId,
      executionAgentNameKey: input.agentNameKey,
      executionLockedAt: input.claimedAt,
      updatedAt: input.claimedAt,
    }).where(and(
      eq(issues.id, input.issueId), eq(issues.companyId, input.companyId),
      or(isNull(issues.executionRunId), eq(issues.executionRunId, input.runId)),
    )).returning({ id: issues.id });
    return claimed.length === 1;
  });
}
