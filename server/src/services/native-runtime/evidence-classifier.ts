import { and, eq, inArray, or } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  approvals,
  agents,
  heartbeatRunEvents,
  heartbeatRuns,
  issueApprovals,
  issueAttachments,
  issueThreadInteractions,
  issueWorkProducts,
  orchestrationToolCharges,
  toolActionRequests,
  toolInvocations,
  toolPolicies,
} from "@paperclipai/db";
import { orchestrationCompletionSchema } from "@paperclipai/shared";
import { nativeSha256 } from "./canonical.js";
import { checkTaskDocumentOutput, readTaskDocumentOutputs } from "../supervision/task-document-output.js";
import {
  normalizePrpResultSignals,
  type PrpIgnoredAttentionRequest,
  type PrpNormalizedAttentionRequest,
  type PrpVerificationReasonCode,
} from "../../vendor/paperclip-runner/index.js";

export type NativeEvidenceOutcome = "accepted" | "missing" | "rejected" | "unverifiable";

export interface NativeEvidenceRefAssessment {
  ref: string;
  kind: "event" | "work_product" | "approval" | "interaction" | "tool_invocation" | "attachment" | "document" | "unknown";
  outcome: NativeEvidenceOutcome;
  reasonCode: string;
  durableRecordId: string | null;
  /** Task document evidence only: the declared required-output key of the accepted document. */
  outputKey?: string;
}

export interface NativeEvidenceAssessment {
  objectiveClaimSatisfied: boolean;
  objectiveSatisfied: boolean;
  allCriteriaSatisfied: boolean;
  verificationPassed: boolean;
  hasFailedVerification: boolean;
  hasBlockingRemainingWork: boolean;
  reportedDisposition: "done" | "blocked" | "needs_review" | "yielded";
  summary: string;
  contractRevisionMatches: boolean;
  criterionAssessments: Array<{
    criterionId: string;
    claimStatus: "satisfied" | "not_satisfied" | "unknown" | null;
    outcome: NativeEvidenceOutcome;
    evidenceRefs: NativeEvidenceRefAssessment[];
    reasonCode: string;
  }>;
  verificationAssessments: Array<{
    commandOrCheck: string;
    claimStatus: "passed" | "failed" | "not_run";
    outcome: NativeEvidenceOutcome;
    evidenceRef: NativeEvidenceRefAssessment | null;
    reasonCode: string;
    reportedReasonCode: PrpVerificationReasonCode | null;
    detail: string | null;
  }>;
  verificationCaveats: Array<{
    commandOrCheck: string;
    reasonCode: PrpVerificationReasonCode | null;
    detail: string | null;
  }>;
  acceptedEvidenceRefs: string[];
  missingRequirements: string[];
  rejectedEvidence: Array<{ ref: string; reasonCode: string }>;
  unverifiableEvidence: Array<{ ref: string; reasonCode: string }>;
  blocker: {
    unblockAction: string;
    boardOwned: boolean;
    scope: "current_track" | "task_wide";
  } | null;
  continuation: {
    kind: "same_agent" | "retry" | "delegated_issue" | "response_wake" | "monitor";
    summary: string;
    idempotencyKey: string;
  } | null;
  /** Actionable, blocking requests only. */
  attentionRequests: PrpNormalizedAttentionRequest[];
  ignoredAttentionRequests: PrpIgnoredAttentionRequest[];
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function uuidRef(ref: string, prefixes: string[]): string | null {
  for (const prefix of prefixes) {
    if (!ref.startsWith(`${prefix}:`)) continue;
    const value = ref.slice(prefix.length + 1).trim();
    // Model-authored evidence often annotates a durable reference, for example
    // `interaction:<uuid> (request_confirmation, status accepted)`. Extract the
    // canonical UUID only; never pass the descriptive suffix (or arbitrary
    // malformed text) to a Postgres UUID comparison.
    const match = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?=$|[^0-9a-f-])/i.exec(value);
    return match?.[1] ?? null;
  }
  return null;
}

const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
/** The ref plan verification emits for a Task document output (`document:<docId>:<revisionId>`). */
const TASK_DOCUMENT_REF = new RegExp(`^document:(${UUID_PATTERN}):(${UUID_PATTERN})(?=$|[^0-9a-f-])`, "i");

/**
 * MS1f decision 2. A Task document is evidence that this Run produced the
 * current declared output, not that its content is good. Accepted only if all
 * hold: the document is linked to this Task under a required-output key the
 * contract declares; the cited revision is its latest revision and matches its
 * latest body (the check plan verification uses); the declared JSON schema, if
 * any, validates; this Run created the revision; and this Run has a succeeded,
 * plan-charged `write_document` invocation that wrote exactly this revision
 * under that key.
 */
async function classifyTaskDocumentRef(input: {
  db: Db;
  companyId: string;
  issueId: string;
  runId: string;
  ref: string;
  contract: Record<string, unknown>;
  documentId: string;
  revisionId: string;
}): Promise<NativeEvidenceRefAssessment> {
  const assessment = (outcome: NativeEvidenceOutcome, reasonCode: string, durableRecordId: string | null,
    outputKey?: string): NativeEvidenceRefAssessment =>
    ({ ref: input.ref, kind: "document", outcome, reasonCode, durableRecordId, ...(outputKey ? { outputKey } : {}) });
  const [output] = await readTaskDocumentOutputs(input.db, {
    companyId: input.companyId, issueId: input.issueId, documentId: input.documentId, lock: false,
  });
  if (!output) return assessment("missing", "document_missing", null);
  const declared = orchestrationCompletionSchema.safeParse(input.contract.v7);
  const required = declared.success
    ? declared.data.requiredOutputs.find((entry) => entry.kind === "task_document" && entry.key === output.key)
    : undefined;
  if (!required) return assessment("unverifiable", "document_output_not_declared", output.doc.id);
  const check = await checkTaskDocumentOutput(input.db, {
    companyId: input.companyId, output, jsonSchema: required.jsonSchema, lock: false,
  });
  if (check.status === "missing") return assessment("missing", "document_output_missing", output.doc.id);
  if (output.doc.latestRevisionId !== input.revisionId) return assessment("rejected", "document_revision_not_latest", input.revisionId);
  if (!check.revisionCurrent) return assessment("rejected", "document_revision_not_current", input.revisionId);
  if (check.schemaValid === false) return assessment("rejected", "document_schema_mismatch", input.revisionId);
  if (check.revision?.createdByRunId !== input.runId) return assessment("unverifiable", "document_revision_not_from_run", input.revisionId);
  // The Run's server-written semantic receipt names the key and revision the
  // write produced (a revision belongs to one document); its input hashes to
  // the tool invocation's arguments hash, as for the other Native output receipts.
  const [run] = await input.db.select({ resultJson: heartbeatRuns.resultJson }).from(heartbeatRuns)
    .where(and(eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, input.runId))).limit(1);
  const receiptArgumentHashes = [...new Set(Object.values(record(record(run?.resultJson).semanticToolReceipts)).map(record)
    .filter((receipt) => {
      const written = record(record(receipt.result).document);
      return receipt.operationId === "write_document" && written.key === output.key &&
        written.latestRevisionId === input.revisionId;
    })
    .map((receipt) => nativeSha256(receipt.input)))];
  const charged = receiptArgumentHashes.length === 0 ? [] : await input.db.select({ id: toolInvocations.id }).from(toolInvocations)
    .innerJoin(orchestrationToolCharges, and(
      eq(orchestrationToolCharges.companyId, toolInvocations.companyId),
      eq(orchestrationToolCharges.invocationId, toolInvocations.id),
    ))
    .where(and(
      eq(toolInvocations.companyId, input.companyId),
      eq(toolInvocations.runId, input.runId),
      eq(toolInvocations.issueId, input.issueId),
      eq(toolInvocations.toolName, "write_document"),
      eq(toolInvocations.status, "succeeded"),
      inArray(toolInvocations.argumentsHash, receiptArgumentHashes),
    )).limit(1);
  if (charged.length === 0) return assessment("unverifiable", "document_write_not_charged", input.revisionId);
  return assessment("accepted", "task_document_output_current", input.revisionId, output.key);
}

/** Task document evidence is evidence for its own output criterion only. */
function taskDocumentEvidenceForCriterion(entry: NativeEvidenceRefAssessment, criterionId: string): NativeEvidenceRefAssessment {
  // APR-E2E (tool_invocation evidence). An executed, Human-admitted tool call
  // is evidence for invariant and verification criteria, never for an output.
  if (entry.kind === "tool_invocation" && entry.outcome === "accepted" && criterionId.startsWith("output_"))
    return { ...entry, outcome: "unverifiable", reasonCode: "tool_invocation_evidence_not_output" };
  if (entry.kind !== "document" || entry.outcome !== "accepted" || criterionId === `output_${entry.outputKey}`) return entry;
  return { ...entry, outcome: "unverifiable", reasonCode: "document_evidence_other_criterion" };
}

/**
 * `tool_invocation:<invocationId>`: a tool call this Task's work executed under
 * a Human's admission. Accepted only when all hold, re-read here:
 * - the invocation is this company's and this Task's;
 * - it succeeded and its Run holds the sealed `tool_result` capture for it;
 * - it was admitted either by an action request on this Task that a Human
 *   (not an Agent) approved and that executed, or, with no approval needed,
 *   by a matched trust rule ("always allow") that a Human created and that is
 *   enabled, not revoked and not expired now (fail closed on any doubt).
 * A failed, pending, declined, other-Task or no-longer-granted call is never
 * accepted. It counts for invariant and verification criteria only.
 */
async function classifyToolInvocationRef(input: { db: Db; companyId: string; issueId: string; ref: string;
  invocationId: string; now?: Date }): Promise<NativeEvidenceRefAssessment> {
  const result = (outcome: NativeEvidenceOutcome, reasonCode: string, durableRecordId: string | null): NativeEvidenceRefAssessment =>
    ({ ref: input.ref, kind: "tool_invocation", outcome, reasonCode, durableRecordId });
  const [invocation] = await input.db.select().from(toolInvocations).where(and(
    eq(toolInvocations.id, input.invocationId), eq(toolInvocations.companyId, input.companyId),
    eq(toolInvocations.issueId, input.issueId))).limit(1);
  if (!invocation) return result("missing", "tool_invocation_missing", null);
  if (["failed", "denied", "cancelled", "timed_out", "rate_limited"].includes(invocation.status) ||
    ["rejected", "expired"].includes(invocation.approvalState))
    return result("rejected", "tool_invocation_not_executed", invocation.id);
  if (invocation.status !== "succeeded" || !invocation.runId)
    return result("missing", "tool_invocation_pending", invocation.id);
  const [run] = await input.db.select({ profile: heartbeatRuns.runnerProfileJson }).from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, invocation.runId))).limit(1);
  const captures = record(run?.profile).nativeToolResultSourceCaptures;
  const sealed = Array.isArray(captures) && captures.some((entry) => {
    const source = record(record(entry).source);
    return source.kind === "tool_result" && source.invocationId === invocation.id && source.runId === invocation.runId;
  });
  if (!sealed) return result("unverifiable", "tool_invocation_result_not_sealed", invocation.id);
  const requests = await input.db.select().from(toolActionRequests).where(and(
    eq(toolActionRequests.companyId, input.companyId), eq(toolActionRequests.invocationId, invocation.id)));
  if (requests.length > 0) {
    const humanApproved = requests.length === 1 && invocation.approvalState === "approved" &&
      requests[0]!.issueId === input.issueId && requests[0]!.status === "executed" &&
      requests[0]!.decidedByUserId !== null && requests[0]!.decidedByAgentId === null && requests[0]!.decidedAt !== null;
    return humanApproved ? result("accepted", "tool_invocation_human_approved", invocation.id)
      : result("rejected", "tool_invocation_admission_not_human", invocation.id);
  }
  if (invocation.policyDecision !== "allow" || invocation.approvalState !== "not_required" ||
    !Array.isArray(invocation.matchedPolicyIds) || invocation.matchedPolicyIds.length === 0)
    return result("rejected", "tool_invocation_admission_not_human", invocation.id);
  const policyIds = invocation.matchedPolicyIds.filter((value): value is string => typeof value === "string");
  const rules = policyIds.length === 0 ? [] : await input.db.select().from(toolPolicies).where(and(
    eq(toolPolicies.companyId, input.companyId), inArray(toolPolicies.id, policyIds), eq(toolPolicies.policyType, "trust_rule")));
  const now = (input.now ?? new Date()).getTime();
  const currentHumanGrant = rules.some((rule) => {
    const trust = record(record(rule.config).trustRule);
    const expiresAt = trust.expiresAt;
    return rule.enabled && rule.createdByUserId !== null && rule.createdByAgentId === null &&
      trust.revokedAt === null && typeof trust.sourceActionRequestId === "string" &&
      (expiresAt === null || (typeof expiresAt === "string" && Number.isFinite(Date.parse(expiresAt)) && Date.parse(expiresAt) > now));
  });
  return currentHumanGrant ? result("accepted", "tool_invocation_standing_human_grant", invocation.id)
    : result("rejected", "tool_invocation_grant_not_current", invocation.id);
}

async function classifyEvidenceRef(input: {
  db: Db;
  companyId: string;
  issueId: string;
  runId: string;
  ref: string;
  contract: Record<string, unknown>;
}): Promise<NativeEvidenceRefAssessment> {
  const eventMatch = /^event:(\d+)$/.exec(input.ref);
  if (eventMatch) {
    const cursor = Number(eventMatch[1]);
    const event = await input.db.select({
      id: heartbeatRunEvents.id,
      eventType: heartbeatRunEvents.eventType,
      payload: heartbeatRunEvents.payload,
    })
      .from(heartbeatRunEvents)
      .where(and(
        eq(heartbeatRunEvents.companyId, input.companyId),
        eq(heartbeatRunEvents.runId, input.runId),
        or(eq(heartbeatRunEvents.seq, cursor), eq(heartbeatRunEvents.sourceSeq, cursor)),
      )).limit(1).then((rows) => rows[0] ?? null);
    if (!event) {
      return { ref: input.ref, kind: "event", outcome: "missing", reasonCode: "durable_run_event_missing", durableRecordId: null };
    }
    const prpEvent = record(record(event.payload).prpEvent);
    const evidenceOutcome = text(record(prpEvent.payload).evidenceOutcome);
    if (prpEvent.sourceKind === "control_plane" && evidenceOutcome === "accepted") {
      return { ref: input.ref, kind: "event", outcome: "accepted", reasonCode: "control_plane_evidence_accepted", durableRecordId: String(event.id) };
    }
    if (prpEvent.sourceKind === "control_plane" && evidenceOutcome === "rejected") {
      return { ref: input.ref, kind: "event", outcome: "rejected", reasonCode: "control_plane_evidence_rejected", durableRecordId: String(event.id) };
    }
    return {
      ref: input.ref,
      kind: "event",
      outcome: "unverifiable",
      reasonCode: event.eventType === "run.result.proposed"
        ? "model_result_event_is_claim_only"
        : "run_event_has_no_authoritative_evidence_verdict",
      durableRecordId: String(event.id),
    };
  }

  const documentMatch = TASK_DOCUMENT_REF.exec(input.ref);
  if (documentMatch) {
    return classifyTaskDocumentRef({
      ...input, documentId: documentMatch[1]!.toLowerCase(), revisionId: documentMatch[2]!.toLowerCase(),
    });
  }

  const workProductId = uuidRef(input.ref, ["work_product", "work-product", "artifact"]);
  if (workProductId) {
    const row = await input.db.select({
      id: issueWorkProducts.id,
      status: issueWorkProducts.status,
      reviewState: issueWorkProducts.reviewState,
    }).from(issueWorkProducts).where(and(
      eq(issueWorkProducts.id, workProductId),
      eq(issueWorkProducts.companyId, input.companyId),
      eq(issueWorkProducts.issueId, input.issueId),
    )).limit(1).then((rows) => rows[0] ?? null);
    if (!row) return { ref: input.ref, kind: "work_product", outcome: "missing", reasonCode: "work_product_missing", durableRecordId: null };
    if (
      ["failed", "error", "cancelled", "rejected", "changes_requested"].includes(row.status)
      || ["rejected", "changes_requested"].includes(row.reviewState)
    ) {
      return { ref: input.ref, kind: "work_product", outcome: "rejected", reasonCode: "work_product_rejected", durableRecordId: row.id };
    }
    if (
      row.reviewState === "approved"
      || ["approved", "passed", "succeeded", "completed", "merged", "published"].includes(row.status)
    ) {
      return { ref: input.ref, kind: "work_product", outcome: "accepted", reasonCode: "work_product_authoritatively_accepted", durableRecordId: row.id };
    }
    return { ref: input.ref, kind: "work_product", outcome: "unverifiable", reasonCode: "work_product_not_yet_accepted", durableRecordId: row.id };
  }

  const approvalId = uuidRef(input.ref, ["approval"]);
  if (approvalId) {
    const row = await input.db.select({ id: approvals.id, status: approvals.status })
      .from(issueApprovals)
      .innerJoin(approvals, eq(issueApprovals.approvalId, approvals.id))
      .where(and(
        eq(issueApprovals.companyId, input.companyId),
        eq(issueApprovals.issueId, input.issueId),
        eq(approvals.companyId, input.companyId),
        eq(approvals.id, approvalId),
      )).limit(1).then((rows) => rows[0] ?? null);
    if (!row) return { ref: input.ref, kind: "approval", outcome: "missing", reasonCode: "approval_missing", durableRecordId: null };
    if (row.status === "approved") return { ref: input.ref, kind: "approval", outcome: "accepted", reasonCode: "approval_approved", durableRecordId: row.id };
    if (["rejected", "cancelled"].includes(row.status)) return { ref: input.ref, kind: "approval", outcome: "rejected", reasonCode: "approval_rejected", durableRecordId: row.id };
    return { ref: input.ref, kind: "approval", outcome: "missing", reasonCode: "approval_pending", durableRecordId: row.id };
  }

  const interactionId = uuidRef(input.ref, ["interaction"]);
  if (interactionId) {
    const row = await input.db.select({
      id: issueThreadInteractions.id,
      status: issueThreadInteractions.status,
      result: issueThreadInteractions.result,
    }).from(issueThreadInteractions).where(and(
      eq(issueThreadInteractions.id, interactionId),
      eq(issueThreadInteractions.companyId, input.companyId),
      eq(issueThreadInteractions.issueId, input.issueId),
    )).limit(1).then((rows) => rows[0] ?? null);
    if (!row) return { ref: input.ref, kind: "interaction", outcome: "missing", reasonCode: "interaction_missing", durableRecordId: null };
    const outcome = text(record(row.result).outcome);
    if (["accepted", "answered", "resolved"].includes(outcome ?? "") || ["accepted", "answered"].includes(row.status)) {
      return { ref: input.ref, kind: "interaction", outcome: "accepted", reasonCode: "interaction_resolved", durableRecordId: row.id };
    }
    if (["rejected", "expired", "cancelled"].includes(row.status) || ["rejected", "withdrawn", "issue_closed"].includes(outcome ?? "")) {
      return { ref: input.ref, kind: "interaction", outcome: "rejected", reasonCode: "interaction_rejected", durableRecordId: row.id };
    }
    return { ref: input.ref, kind: "interaction", outcome: "missing", reasonCode: "interaction_pending", durableRecordId: row.id };
  }

  const invocationId = uuidRef(input.ref, ["tool_invocation"]);
  if (invocationId) return classifyToolInvocationRef({ db: input.db, companyId: input.companyId, issueId: input.issueId,
    ref: input.ref, invocationId });

  const attachmentId = uuidRef(input.ref, ["attachment"]);
  if (attachmentId) {
    const row = await input.db.select({ id: issueAttachments.id }).from(issueAttachments).where(and(
      eq(issueAttachments.id, attachmentId),
      eq(issueAttachments.companyId, input.companyId),
      eq(issueAttachments.issueId, input.issueId),
    )).limit(1).then((rows) => rows[0] ?? null);
    return row
      ? { ref: input.ref, kind: "attachment", outcome: "accepted", reasonCode: "attachment_persisted", durableRecordId: row.id }
      : { ref: input.ref, kind: "attachment", outcome: "missing", reasonCode: "attachment_missing", durableRecordId: null };
  }

  return {
    ref: input.ref,
    kind: "unknown",
    outcome: "unverifiable",
    reasonCode: "unsupported_evidence_reference",
    durableRecordId: null,
  };
}

/**
 * Classifies model claims against immutable server-owned records. A model's
 * `satisfied` or `passed` value is retained as a claim but never becomes proof.
 */
export async function classifyNativeEvidence(input: {
  db: Db;
  companyId: string;
  issueId: string;
  runId: string;
  contract: Record<string, unknown>;
  result: Record<string, unknown>;
}): Promise<NativeEvidenceAssessment> {
  const claim = record(input.result.completionClaim);
  const claimedCriteria = Array.isArray(claim.criteria) ? claim.criteria.map(record) : [];
  const contractCriteria = Array.isArray(input.contract.criteria) ? input.contract.criteria.map(record) : [];
  const remaining = Array.isArray(claim.remainingWork) ? claim.remainingWork.map(record) : [];
  const normalizedSignals = normalizePrpResultSignals(input.result);
  const verification = normalizedSignals.verification;
  const reported = input.result.reportedWorkDisposition;
  const blocker = record(input.result.blocker);
  const blockerOwner = record(blocker.owner);
  const continuation = record(input.result.continuation);
  if (!["done", "blocked", "needs_review", "yielded"].includes(String(reported))) {
    throw new Error("native_result_invalid_disposition");
  }

  const contractRevision = text(input.contract.revision);
  const contractRevisionMatches = contractRevision !== null && text(claim.contractRevision) === contractRevision;
  const cache = new Map<string, Promise<NativeEvidenceRefAssessment>>();
  const resolveRef = (ref: string) => {
    let pending = cache.get(ref);
    if (!pending) {
      pending = classifyEvidenceRef({ ...input, ref });
      cache.set(ref, pending);
    }
    return pending;
  };

  const criterionAssessments = await Promise.all(contractCriteria.map(async (criterion) => {
    const criterionId = text(criterion.id) ?? "invalid-contract-criterion";
    const claimed = claimedCriteria.find((entry) => text(entry.criterionId) === criterionId) ?? null;
    const claimStatus = claimed && ["satisfied", "not_satisfied", "unknown"].includes(String(claimed.status))
      ? claimed.status as "satisfied" | "not_satisfied" | "unknown"
      : null;
    const refs = claimed && Array.isArray(claimed.evidenceRefs)
      ? claimed.evidenceRefs.flatMap((value) => text(value) ? [text(value)!] : [])
      : [];
    const evidenceRefs = (await Promise.all(refs.map(resolveRef)))
      .map((entry) => taskDocumentEvidenceForCriterion(entry, criterionId));
    let outcome: NativeEvidenceOutcome;
    let reasonCode: string;
    if (!contractRevisionMatches) {
      outcome = "rejected";
      reasonCode = "contract_revision_stale";
    } else if (!claimed) {
      outcome = "missing";
      reasonCode = "criterion_claim_missing";
    } else if (claimStatus === "not_satisfied") {
      outcome = "rejected";
      reasonCode = "criterion_reported_not_satisfied";
    } else if (claimStatus !== "satisfied") {
      outcome = "unverifiable";
      reasonCode = "criterion_claim_not_satisfied";
    } else if (refs.length === 0) {
      outcome = "missing";
      reasonCode = "criterion_evidence_missing";
    } else if (evidenceRefs.some((entry) => entry.outcome === "rejected")) {
      outcome = "rejected";
      reasonCode = "criterion_evidence_rejected";
    } else if (evidenceRefs.some((entry) => entry.outcome === "unverifiable")) {
      outcome = "unverifiable";
      reasonCode = "criterion_evidence_unverifiable";
    } else if (evidenceRefs.some((entry) => entry.outcome === "missing")) {
      outcome = "missing";
      reasonCode = "criterion_evidence_missing";
    } else {
      outcome = "accepted";
      reasonCode = "criterion_evidence_accepted";
    }
    return { criterionId, claimStatus, outcome, evidenceRefs, reasonCode };
  }));

  const verificationAssessments = await Promise.all(verification.map(async (entry) => {
    const commandOrCheck = entry.commandOrCheck;
    const claimStatus = entry.status;
    const ref = entry.artifactRef;
    const resolvedRef = ref ? await resolveRef(ref) : null;
    // A current Task document proves who produced an output, not that a check passed.
    const evidenceRef: NativeEvidenceRefAssessment | null = resolvedRef?.kind === "document" && resolvedRef.outcome === "accepted"
      ? { ...resolvedRef, outcome: "unverifiable", reasonCode: "document_evidence_not_verification" }
      : resolvedRef;
    const common = { commandOrCheck, claimStatus, evidenceRef, reportedReasonCode: entry.reasonCode, detail: entry.detail };
    if (claimStatus === "failed") return { ...common, outcome: "rejected" as const, reasonCode: "verification_reported_failed" };
    if (claimStatus === "not_run") return { ...common, outcome: "missing" as const, reasonCode: "verification_not_run" };
    if (!evidenceRef) return { ...common, outcome: "unverifiable" as const, reasonCode: "verification_has_no_durable_reference" };
    return {
      ...common,
      outcome: evidenceRef.outcome,
      reasonCode: evidenceRef.outcome === "accepted" ? "verification_evidence_accepted" : evidenceRef.reasonCode,
    };
  }));

  const allRefs = [...cache.keys()].map((ref) => cache.get(ref)!);
  const resolvedRefs = await Promise.all(allRefs);
  // MS1f phase 2 finding 3. A Task document ref counts as accepted evidence
  // only where it was accepted for its own output criterion; one cited only for
  // another criterion or a verification is not listed (those assessments
  // already downgrade it).
  const acceptedDocumentUses = new Set([
    ...criterionAssessments.flatMap((entry) => entry.evidenceRefs.filter((ref) => ref.outcome === "accepted").map((ref) => ref.ref)),
    ...verificationAssessments.flatMap((entry) => entry.evidenceRef?.outcome === "accepted" ? [entry.evidenceRef.ref] : []),
  ]);
  const acceptedEvidenceRefs = resolvedRefs.filter((entry) => entry.outcome === "accepted" &&
    (entry.kind !== "document" || acceptedDocumentUses.has(entry.ref))).map((entry) => entry.ref);
  const missingRequirements = [
    ...criterionAssessments.filter((entry) => entry.outcome === "missing").map((entry) => entry.criterionId),
    ...verificationAssessments.filter((entry) => entry.outcome === "missing").map((entry) => entry.commandOrCheck),
  ];
  const rejectedEvidence = resolvedRefs.filter((entry) => entry.outcome === "rejected").map((entry) => ({ ref: entry.ref, reasonCode: entry.reasonCode }));
  const unverifiableEvidence = resolvedRefs.filter((entry) => entry.outcome === "unverifiable").map((entry) => ({ ref: entry.ref, reasonCode: entry.reasonCode }));
  const allCriteriaSatisfied = contractCriteria.length > 0 && criterionAssessments.every((entry) => entry.outcome === "accepted");
  const verificationPassed = verificationAssessments.length > 0 && verificationAssessments.every((entry) => entry.outcome === "accepted");
  const hasFailedVerification = verificationAssessments.some((entry) => entry.claimStatus === "failed");
  const continuationKind = continuation.kind;
  const actionableAttentionRequests: PrpNormalizedAttentionRequest[] = [];
  const ignoredAttentionRequests = [...normalizedSignals.ignoredAttentionRequests];
  for (const request of normalizedSignals.actionableAttentionRequests) {
    if (request.ownerClass === "agent" && request.targetAgentId) {
      const targetExists = await input.db.select({ id: agents.id }).from(agents).where(and(
        eq(agents.id, request.targetAgentId),
        eq(agents.companyId, input.companyId),
      )).limit(1).then((rows) => rows.length > 0);
      if (!targetExists) {
        ignoredAttentionRequests.push({
          sourceIndex: request.sourceIndex,
          sourceKind: request.sourceKind,
          summary: request.summary,
          disposition: "rejected",
          reasonCode: "attention_request_target_agent_unavailable",
        });
        continue;
      }
    }
    actionableAttentionRequests.push(request);
  }

  return {
    objectiveClaimSatisfied: claim.objectiveSatisfied === true,
    objectiveSatisfied: claim.objectiveSatisfied === true && allCriteriaSatisfied,
    allCriteriaSatisfied,
    verificationPassed,
    hasFailedVerification,
    hasBlockingRemainingWork:
      remaining.some((entry) => entry.blocksCompletion === true)
      || (reported === "done" && Object.keys(blocker).length > 0),
    reportedDisposition: reported as NativeEvidenceAssessment["reportedDisposition"],
    summary: typeof input.result.summary === "string" ? input.result.summary : "Native run completed.",
    contractRevisionMatches,
    criterionAssessments,
    verificationAssessments,
    verificationCaveats: verificationAssessments
      .filter((entry) => entry.claimStatus === "not_run")
      .map((entry) => ({
        commandOrCheck: entry.commandOrCheck,
        reasonCode: entry.reportedReasonCode,
        detail: entry.detail,
      })),
    acceptedEvidenceRefs,
    missingRequirements,
    rejectedEvidence,
    unverifiableEvidence,
    blocker: reported === "blocked" && typeof blocker.unblockAction === "string"
      ? {
          unblockAction: blocker.unblockAction,
          boardOwned: blockerOwner.kind === "board" || blockerOwner.owner === "board",
          scope: blocker.scope === "task_wide" ? "task_wide" : "current_track",
        }
      : null,
    continuation: reported === "yielded"
      && ["same_agent", "retry", "delegated_issue", "response_wake", "monitor"].includes(String(continuationKind))
      && text(continuation.summary)
      && text(continuation.idempotencyKey)
      ? {
          kind: continuationKind as NativeEvidenceAssessment["continuation"] extends infer T ? T extends { kind: infer K } ? K : never : never,
          summary: text(continuation.summary)!,
          idempotencyKey: text(continuation.idempotencyKey)!,
        }
      : null,
    attentionRequests: actionableAttentionRequests,
    ignoredAttentionRequests,
  };
}
