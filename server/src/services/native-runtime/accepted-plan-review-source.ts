import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { heartbeatRuns, issueComments, issueThreadInteractions, issues } from "@paperclipai/db";
import type { NativePayloadSourceInput, PlanReviewContext } from "@paperclipai/shared";
import type { DocumentRevisionSourceCapture } from "../documents.js";
import { getTaskPlanContext } from "../task-plan-context.js";
import { buildPlanReviewContext } from "../plan-review-context.js";
import { continuationOriginCommentIds, projectHumanInteractionResponse, type NativeTaskContinuationCapture } from "../execution-continuation.js";
import { materializeNativeInteractionResponses } from "./native-interaction-bridge.js";
import { nativeSha256 } from "./canonical.js";
import { createRunSecretRedactionRegistry } from "../run-secret-redaction.js";

type InteractionSource = Extract<NativePayloadSourceInput, { kind: "interaction" }>;
type DocumentRevisionSource = Extract<NativePayloadSourceInput, { kind: "document_revision" }>;

/** Closed first-step accepted-plan profile. Annotation threads and comments
 * remain unsupported because they have no independently sourced payload owner. */
export type NativeAcceptedPlanReviewCapture = {
  version: 1;
  companyId: string;
  issueId: string;
  agentId: string;
  runId: string;
  interactionId: string;
  sourceRunId: string | null;
  resolvedByUserId: string;
  resolvedAt: string;
  originCommentIds: string[];
  taskObjective: string;
  interactionSource: InteractionSource;
  planSource: DocumentRevisionSourceCapture;
  planRendition: { documentId: string; revisionId: string; revisionNumber: number; bodyHash: string };
  planReviewContext: PlanReviewContext;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Rebuild every accepted-plan input from existing interaction and document
 * owners. The supplied source lists are the immutable Native source set (at
 * initial construction) or the previously captured source set (on re-read). */
export async function captureNativeAcceptedPlanReview(input: {
  db: Db;
  companyId: string;
  issueId: string;
  agentId: string;
  runId: string;
  responsibleUserId: string | null;
  envelope: NativeTaskContinuationCapture["envelope"];
  wakePayload: unknown;
  context: unknown;
  workMode: string;
  exposeLowTrustRaw?: boolean;
  interactionSources: readonly InteractionSource[];
  documentSources: readonly (DocumentRevisionSource | DocumentRevisionSourceCapture)[];
}): Promise<NativeAcceptedPlanReviewCapture | null> {
  if (!input.responsibleUserId || !input.wakePayload || typeof input.wakePayload !== "object" || Array.isArray(input.wakePayload)) return null;
  const payload = record(input.wakePayload);
  const review = record(payload.planReviewContext) as unknown as PlanReviewContext;
  const interactionContext = record(review.interaction);
  const interactionResult = record(interactionContext.result);
  const accepted = record(interactionContext.acceptedTargetRevision);
  const interactionId = typeof interactionContext.id === "string" ? interactionContext.id : null;
  if (!interactionId || interactionContext.kind !== "request_confirmation" || interactionContext.status !== "accepted" ||
      review.documentKey !== "plan" || review.issueId !== input.issueId || review.truncated !== false ||
      !Array.isArray(review.threads) || review.threads.length !== 0 ||
      !review.totals || review.totals.openThreadCount !== 0 || review.totals.includedThreadCount !== 0 ||
      review.totals.omittedThreadCount !== 0 || review.totals.commentCount !== 0 ||
      review.totals.includedCommentCount !== 0 || review.totals.omittedCommentCount !== 0 ||
      accepted.issueId !== input.issueId || accepted.key !== "plan" ||
      typeof accepted.documentId !== "string" || typeof accepted.revisionId !== "string" ||
      !Number.isSafeInteger(accepted.revisionNumber) || Number(accepted.revisionNumber) < 1) return null;
  const [run] = await input.db.select({ responsibleUserId: heartbeatRuns.responsibleUserId,
    companyId: heartbeatRuns.companyId, issueId: heartbeatRuns.nativeIssueId, agentId: heartbeatRuns.agentId,
  }).from(heartbeatRuns).where(and(eq(heartbeatRuns.id, input.runId),
    eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.agentId, input.agentId),
    eq(heartbeatRuns.nativeIssueId, input.issueId))).limit(1);
  if (!run || run.responsibleUserId !== input.responsibleUserId) return null;
  const [selectedOwner] = await input.db.select({ row: issueThreadInteractions,
    sourceVersion: sql<string>`extract(epoch from ${issueThreadInteractions.updatedAt})::text` })
    .from(issueThreadInteractions).where(and(
      eq(issueThreadInteractions.id, interactionId), eq(issueThreadInteractions.companyId, input.companyId),
      eq(issueThreadInteractions.issueId, input.issueId))).limit(1);
  const owner = selectedOwner?.row;
  if (!owner || owner.kind !== "request_confirmation" || owner.status !== "accepted" ||
      owner.resolvedByUserId !== input.responsibleUserId || owner.resolvedByAgentId || owner.resolvedByRunId ||
      !owner.resolvedAt || owner.sourceRunId !== (typeof interactionContext.sourceRunId === "string" ? interactionContext.sourceRunId : null)) return null;
  const ownerPayload = record(owner.payload), target = record(ownerPayload.target), result = record(owner.result);
  if (target.type !== "issue_document" || target.issueId !== undefined && target.issueId !== null && target.issueId !== input.issueId ||
      target.documentId !== accepted.documentId || target.key !== "plan" || target.revisionId !== accepted.revisionId ||
      target.revisionNumber !== accepted.revisionNumber || result.outcome !== "accepted" ||
      interactionContext.sourceCommentId !== (owner.sourceCommentId ?? null) ||
      interactionContext.continuationPolicy !== owner.continuationPolicy ||
      interactionResult.outcome !== "accepted" || interactionResult.commentId !== (typeof result.commentId === "string" ? result.commentId : null)) return null;
  const context = record(input.context);
  const explicitContinuation = record(context.explicitUserContinuation);
  const resumeSourceRunId = (typeof explicitContinuation.previousRunId === "string" ? explicitContinuation.previousRunId : null) ??
    (typeof context.retryOfRunId === "string" ? context.retryOfRunId : null) ??
    (typeof context.previousRunId === "string" ? context.previousRunId : null) ??
    (typeof context.interruptedRunId === "string" ? context.interruptedRunId : null);
  const selectedSourceRunId = resumeSourceRunId ?? owner.sourceRunId ?? null;
  const loadRun = async (id: string) => (await input.db.select({ context: heartbeatRuns.contextSnapshot }).from(heartbeatRuns)
    .where(and(eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, id))).limit(1))[0] ?? null;
  const sourceCandidate = selectedSourceRunId ? await loadRun(selectedSourceRunId) : null;
  const sourceRun = record(sourceCandidate?.context).issueId === input.issueId ? sourceCandidate : null;
  if ((selectedSourceRunId && !sourceCandidate) || (resumeSourceRunId && !sourceRun)) return null;
  const producerRunId = owner.sourceRunId ?? null;
  const producer = producerRunId === selectedSourceRunId ? sourceCandidate : producerRunId ? await loadRun(producerRunId) : null;
  if (producerRunId && !producer) return null;
  const producerIssueId = typeof record(producer?.context).issueId === "string" ? String(record(producer?.context).issueId) : null;
  const producerOrigins = new Set(continuationOriginCommentIds(producer?.context));
  const recordedOrigins = Array.isArray(owner.originCommentIds) ? owner.originCommentIds.filter((value): value is string => typeof value === "string") : null;
  if (!recordedOrigins) return null;
  const inheritedOrigins = recordedOrigins.filter(id => producerOrigins.has(id));
  const inheritedForeign = producerIssueId && producerIssueId !== input.issueId && inheritedOrigins.length
    ? await input.db.select({ id: issueComments.id }).from(issueComments).where(and(
        eq(issueComments.companyId, input.companyId), sql`${issueComments.issueId}::text = ${producerIssueId}`,
        inArray(sql<string>`${issueComments.id}::text`, inheritedOrigins))) : [];
  const inheritedForeignIds = new Set(inheritedForeign.map(row => row.id));
  const originCommentIds = [...new Set([
    ...continuationOriginCommentIds(input.context), ...continuationOriginCommentIds(sourceRun?.context),
    ...recordedOrigins.filter(id => !inheritedForeignIds.has(id)), ...(owner.sourceCommentId ? [owner.sourceCommentId] : []),
  ])];
  const envelopeOriginIds = [...input.envelope.originCommentIds].sort();
  if (originCommentIds.length !== envelopeOriginIds.length ||
      originCommentIds.slice().sort().some((id, index) => id !== envelopeOriginIds[index])) return null;
  const latestHumanRequest = input.envelope.messages.findLast(message => message.authorType === "user" &&
    message.createdByRunId === null && !message.deleted && message.body.trim().length > 0);
  const [currentTask] = await input.db.select({ title: issues.title, description: issues.description, assigneeAgentId: issues.assigneeAgentId })
    .from(issues).where(and(eq(issues.companyId, input.companyId), eq(issues.id, input.issueId))).limit(1);
  if (!currentTask || currentTask.assigneeAgentId !== input.agentId) return null;
  const taskObjective = latestHumanRequest?.body ?? currentTask.description ?? currentTask.title;
  if (input.envelope.objective !== taskObjective) return null;
  const expectedReview = await buildPlanReviewContext({ db: input.db, companyId: input.companyId, issueId: input.issueId,
    issueWorkMode: input.workMode, interactionId });
  if (!expectedReview || !sameEmptyPlanReview(expectedReview) || !sameEmptyPlanReview(review) ||
      nativeSha256(expectedReview) !== nativeSha256(review)) return null;
  const matchingPlans: Array<{ plan: NonNullable<Awaited<ReturnType<typeof getTaskPlanContext>>>;
    source: DocumentRevisionSourceCapture }> = [];
  for (const exposeLowTrustRaw of input.exposeLowTrustRaw === undefined ? [false, true] : [input.exposeLowTrustRaw]) {
    const selectedPlanSources: DocumentRevisionSourceCapture[] = [];
    const plan = await getTaskPlanContext({ db: input.db, companyId: input.companyId, issueId: input.issueId,
      approvedRevisionId: accepted.revisionId, exposeLowTrustRaw,
      onSourceCapture: capture => { if (capture) selectedPlanSources.push(capture); } });
    if (plan && selectedPlanSources.length === 1 && plan.documentId === accepted.documentId &&
        plan.revisionId === accepted.revisionId && plan.revisionNumber === accepted.revisionNumber &&
        input.documentSources.some(source => isSameDocumentSource(source, selectedPlanSources[0]!.input))) {
      matchingPlans.push({ plan, source: selectedPlanSources[0]! });
    }
  }
  const uniquePlanHashes = new Set(matchingPlans.map(value => value.source.input.contentHash));
  if (matchingPlans.length === 0 || uniquePlanHashes.size !== 1) return null;
  const { plan, source: planSource } = matchingPlans[0]!;
  const selectedResponses: InteractionSource[] = [];
  const { interactionResponses } = await materializeNativeInteractionResponses({
    db: input.db, companyId: input.companyId, issueId: input.issueId, runId: input.runId,
    agentId: input.agentId, interactionIds: [interactionId], onSourceCapture: source => { selectedResponses.push(source); },
  }).then(interactionResponses => ({ interactionResponses }));
  if (selectedResponses.length !== 1 || selectedOwner?.sourceVersion !== selectedResponses[0]!.sourceVersion ||
      !input.interactionSources.some(source => isSameInteractionSource(source, selectedResponses[0]!)) ||
      interactionResponses.length !== 1 || interactionResponses[0]!.interactionId !== interactionId ||
      interactionResponses[0]!.kind !== "request_confirmation" || interactionResponses[0]!.response.status !== "accepted") return null;
  const humanResponse = projectHumanInteractionResponse(owner);
  const outcome = input.envelope.interactionOutcomes.filter(value => value.id === interactionId);
  const human = (input.envelope.humanResponses ?? []).filter(value => value.id === interactionId);
  const redactions = createRunSecretRedactionRegistry(input.db);
  const safeHumanResponse = humanResponse
    ? await redactions.redactForIssue(input.companyId, input.issueId, humanResponse) : null;
  const safeOutcome = await redactions.redactForIssue(input.companyId, input.issueId, {
    id: owner.id, kind: owner.kind, status: owner.status, result: owner.result,
  });
  if (!safeHumanResponse || outcome.length !== 1 || human.length !== 1 ||
      nativeSha256(safeHumanResponse) !== nativeSha256(human[0]) ||
      outcome[0]!.kind !== "request_confirmation" || outcome[0]!.status !== "accepted" ||
      nativeSha256(safeOutcome) !== nativeSha256(outcome[0])) return null;
  return {
    version: 1, companyId: input.companyId, issueId: input.issueId, agentId: input.agentId, runId: input.runId,
    interactionId, sourceRunId: owner.sourceRunId ?? null, resolvedByUserId: owner.resolvedByUserId,
    resolvedAt: owner.resolvedAt.toISOString(), originCommentIds, taskObjective,
    interactionSource: selectedResponses[0]!, planSource,
    planRendition: { documentId: plan.documentId, revisionId: plan.revisionId, revisionNumber: plan.revisionNumber,
      bodyHash: planSource.input.contentHash }, planReviewContext: expectedReview,
  };
}

function isSameInteractionSource(left: InteractionSource, right: InteractionSource): boolean {
  return left.kind === right.kind && left.issueId === right.issueId && left.interactionId === right.interactionId &&
    left.sourceVersion === right.sourceVersion && left.contentHash === right.contentHash;
}
function isSameDocumentSource(left: DocumentRevisionSource | DocumentRevisionSourceCapture, right: DocumentRevisionSource): boolean {
  const source = "input" in left ? left.input : left;
  return source.kind === "document_revision" && source.issueId === right.issueId && source.documentId === right.documentId &&
    source.revisionId === right.revisionId && source.contentHash === right.contentHash;
}
function sameEmptyPlanReview(value: PlanReviewContext): boolean {
  return value.documentKey === "plan" && value.truncated === false && value.threads.length === 0 &&
    value.totals.openThreadCount === 0 && value.totals.includedThreadCount === 0 && value.totals.omittedThreadCount === 0 &&
    value.totals.commentCount === 0 && value.totals.includedCommentCount === 0 && value.totals.omittedCommentCount === 0;
}
