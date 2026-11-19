import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { managedReviewerDocumentReadExact, managedStageReviewCommentResultExact } from "./worker-model-gateway.js";

// MS1f decisions 4 and 6. The gateway admits a stage Reviewer's stage-comment
// call_api result, and either Reviewer kind's declared output read, into the
// next model input only as its exact current receipt (mirroring MS1h16).
const emptyPolicy = { issueIds: [], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] };

function stageBinding(input: { issueId: string; planId: string; stageId: string; runId: string; agentId: string }) {
  return { kind: "execution_stage" as const, planId: input.planId, issueId: input.issueId, stageId: input.stageId,
    decisionId: randomUUID(), sourceRunId: randomUUID(), sourceWorkerId: randomUUID(), sourceAgentId: randomUUID(),
    sourceAttemptId: randomUUID(), sourceResultId: randomUUID(), sourceReceiptDigest: "a".repeat(64),
    sourceResultCanonicalSha256: "b".repeat(64), reviewerAgentId: input.agentId, reviewerRunId: input.runId,
    executionManifestId: randomUUID(), expectedPlanVersion: 2 };
}

type CommentInput = Parameters<typeof managedStageReviewCommentResultExact>[0];
function commentFixture(outcome: "approved" | "changes_requested" = "approved"): CommentInput {
  const runId = randomUUID(), agentId = randomUUID(), issueId = randomUUID(), planId = randomUUID(), stageId = randomUUID();
  const commentId = randomUUID(), toolUseId = "stage-comment-call-1";
  const args = { operationId: "POST /api/issues/{id}/comments", pathParams: { id: issueId },
    body: { body: "## Review: APPROVED\n\nLooks right." } };
  const providerArgumentsHash = nativeSha256(args);
  const apiResult = { ok: true, status: 201, apiOperationId: "POST /api/issues/{id}/comments",
    data: { id: commentId, companyId: randomUUID(), issueId, createdByRunId: runId } };
  const envelopeHash = nativeSha256({ ok: true, operationId: "call_api", callId: toolUseId, result: apiResult });
  const source = { kind: "tool_result", runId, callId: toolUseId, toolName: "call_api", invocationId: null, contentHash: envelopeHash };
  const stageComment = { operationId: "POST /api/issues/{id}/comments", callId: toolUseId, argumentsHash: providerArgumentsHash,
    resultDigest: envelopeHash, commentId, transitionHash: "c".repeat(64), apiReceiptHash: "d".repeat(64),
    outputCapture: { runId, dispatch: { kind: "review_model_dispatch" } } };
  return {
    claims: { scope: "review_model", run_id: runId, sub: agentId, responsible_user_id: "user-1",
      review_model: stageBinding({ issueId, planId, stageId, runId, agentId }) },
    toolUseId, providerArgumentsHash,
    capture: { managedOpenCode: true, callId: toolUseId, tool: "call_api", argumentsHash: providerArgumentsHash,
      resultDigest: envelopeHash, source, stageComment },
    source, apiResult,
    currentCapture: structuredClone(stageComment),
    decision: { id: randomUUID(), issueId, stageId, createdByRunId: runId, actorAgentId: agentId, actorUserId: null, outcome },
    invocation: { id: randomUUID(), issueId, runId, agentId, toolName: "call_api", status: "succeeded",
      idempotencyKey: `aw-native-tool:${runId}:${toolUseId}`, argumentsHash: providerArgumentsHash,
      resultHash: nativeSha256(apiResult) },
    chargedPlanId: planId,
    consumedEntry: { responsibleUserId: "user-1", inputs: [source], policy: emptyPolicy },
  };
}

describe("managed stage Reviewer stage-comment receipt (MS1f decision 4)", () => {
  it("admits the exact current approval and changes-requested receipts", () => {
    expect(managedStageReviewCommentResultExact(commentFixture("approved"))).toBe(true);
    expect(managedStageReviewCommentResultExact(commentFixture("changes_requested"))).toBe(true);
  });
  const refusals: Array<[string, (input: CommentInput) => CommentInput]> = [
    ["a completion review binding", input => ({ ...input, claims: { ...input.claims,
      review_model: { ...(({ kind: _kind, stageId: _stage, ...rest }) => rest)(input.claims.review_model as ReturnType<typeof stageBinding>),
        interactionId: randomUUID() } as never } })],
    ["a worker_model credential", input => ({ ...input, claims: { ...input.claims, scope: "worker_model" } })],
    ["a conversation_model credential", input => ({ ...input, claims: { ...input.claims, scope: "conversation_model" } })],
    ["a review credential without its binding", input => ({ ...input, claims: { ...input.claims, review_model: null } })],
    ["no current route acknowledgement", input => ({ ...input, currentCapture: null })],
    ["a capture that differs from the current acknowledgement", input => ({ ...input,
      currentCapture: { ...input.currentCapture!, transitionHash: "e".repeat(64) } })],
    ["a capture that is not a managed tool-result capture", input => ({ ...input, capture: { ...input.capture, managedOpenCode: undefined } })],
    ["a capture bound to other arguments", input => ({ ...input, capture: { ...input.capture, argumentsHash: "f".repeat(64) } })],
    ["a capture of another tool", input => ({ ...input, capture: { ...input.capture, tool: "read_document" } })],
    ["an acknowledgement of another comment", input => ({ ...input, currentCapture: { ...input.currentCapture!, commentId: randomUUID() },
      capture: { ...input.capture, stageComment: { ...(input.capture.stageComment as object), commentId: randomUUID() } } })],
    ["a failed HTTP result", input => ({ ...input, apiResult: { ...(input.apiResult as object), ok: false } })],
    ["a comment on another Task", input => ({ ...input, apiResult: { ...(input.apiResult as Record<string, unknown>),
      data: { ...((input.apiResult as Record<string, unknown>).data as object), issueId: randomUUID() } } })],
    ["a comment created by another Run", input => ({ ...input, apiResult: { ...(input.apiResult as Record<string, unknown>),
      data: { ...((input.apiResult as Record<string, unknown>).data as object), createdByRunId: randomUUID() } } })],
    ["no recorded stage decision", input => ({ ...input, decision: null })],
    ["a decision on another stage", input => ({ ...input, decision: { ...input.decision!, stageId: randomUUID() } })],
    ["a decision of another Run", input => ({ ...input, decision: { ...input.decision!, createdByRunId: randomUUID() } })],
    ["a decision of another Agent", input => ({ ...input, decision: { ...input.decision!, actorAgentId: randomUUID() } })],
    ["a Human decision", input => ({ ...input, decision: { ...input.decision!, actorUserId: "user-1" } })],
    ["a decision with another outcome", input => ({ ...input, decision: { ...input.decision!, outcome: "pending" } })],
    ["a missing invocation", input => ({ ...input, invocation: undefined })],
    ["an invocation that did not succeed", input => ({ ...input, invocation: { ...input.invocation!, status: "failed" } })],
    ["an invocation of another tool", input => ({ ...input, invocation: { ...input.invocation!, toolName: "resolve_review" } })],
    ["an invocation keyed to another call", input => ({ ...input,
      invocation: { ...input.invocation!, idempotencyKey: `aw-native-tool:${input.claims.run_id}:other` } })],
    ["an invocation of another Run", input => ({ ...input, invocation: { ...input.invocation!, runId: randomUUID() } })],
    ["an invocation on another Task", input => ({ ...input, invocation: { ...input.invocation!, issueId: randomUUID() } })],
    ["an invocation with another result", input => ({ ...input, invocation: { ...input.invocation!, resultHash: "0".repeat(64) } })],
    ["an invocation bound to other arguments", input => ({ ...input, invocation: { ...input.invocation!, argumentsHash: "0".repeat(64) } })],
    ["an uncharged invocation", input => ({ ...input, chargedPlanId: null })],
    ["an invocation charged to another plan", input => ({ ...input, chargedPlanId: randomUUID() })],
    ["a source naming a plan invocation", input => {
      const source = { ...input.source, invocationId: randomUUID() };
      return { ...input, source, consumedEntry: { ...input.consumedEntry!, inputs: [source] } };
    }],
    ["a source of another Run", input => {
      const source = { ...input.source, runId: randomUUID() };
      return { ...input, source, consumedEntry: { ...input.consumedEntry!, inputs: [source] } };
    }],
    ["a consumed entry with another source", input => ({ ...input, consumedEntry: { ...input.consumedEntry!,
      inputs: [input.source, { kind: "task", issueId: randomUUID(), sourceVersion: "v", contentHash: "a".repeat(64) }] } })],
    ["a consumed entry with a source policy", input => ({ ...input, consumedEntry: { ...input.consumedEntry!,
      policy: { ...emptyPolicy, issueIds: [randomUUID()] } } })],
    ["a consumed entry of another Human", input => ({ ...input, consumedEntry: { ...input.consumedEntry!, responsibleUserId: "user-2" } })],
    ["a missing consumed entry", input => ({ ...input, consumedEntry: undefined })],
  ];
  it.each(refusals)("refuses %s", (_name, change) => {
    const input = commentFixture();
    expect(managedStageReviewCommentResultExact(input)).toBe(true);
    expect(managedStageReviewCommentResultExact(change(input))).toBe(false);
  });
});

type ReadInput = Parameters<typeof managedReviewerDocumentReadExact>[0];
function readFixture(kind: "completion" | "execution_stage" = "execution_stage"): ReadInput {
  const runId = randomUUID(), agentId = randomUUID(), issueId = randomUUID(), planId = randomUUID(), toolUseId = "read-call-1";
  const providerArgumentsHash = nativeSha256({ key: "report" });
  const stage = stageBinding({ issueId, planId, stageId: randomUUID(), runId, agentId });
  const { kind: _kind, stageId: _stageId, ...completion } = stage;
  return {
    claims: { scope: "review_model", run_id: runId, sub: agentId,
      review_model: kind === "execution_stage" ? stage : { ...completion, interactionId: randomUUID() } },
    toolUseId, providerArgumentsHash,
    readSource: { kind: "document_revision", issueId, documentId: randomUUID(), revisionId: randomUUID() },
    linkedKey: "report", declaredKeys: ["report", "summary"],
    invocation: { issueId, runId, agentId, toolName: "read_document", status: "succeeded",
      idempotencyKey: `aw-native-tool:${runId}:${toolUseId}`, argumentsHash: providerArgumentsHash },
    chargedPlanId: planId,
  };
}

describe("managed Reviewer declared output read receipt (MS1f decision 6)", () => {
  it("admits the exact declared output read of both Reviewer kinds", () => {
    expect(managedReviewerDocumentReadExact(readFixture("execution_stage"))).toBe(true);
    expect(managedReviewerDocumentReadExact(readFixture("completion"))).toBe(true);
  });
  const refusals: Array<[string, (input: ReadInput) => ReadInput]> = [
    ["a worker_model credential", input => ({ ...input, claims: { ...input.claims, scope: "worker_model" } })],
    ["a review credential without its binding", input => ({ ...input, claims: { ...input.claims, review_model: null } })],
    ["a document of another Task", input => ({ ...input, readSource: { ...input.readSource, issueId: randomUUID() } })],
    ["a source that is not a document revision", input => ({ ...input, readSource: { ...input.readSource, kind: "task" } })],
    ["a document not linked to the reviewed Task", input => ({ ...input, linkedKey: null })],
    ["an undeclared document key", input => ({ ...input, linkedKey: "notes", providerArgumentsHash: nativeSha256({ key: "notes" }),
      invocation: { ...input.invocation!, argumentsHash: nativeSha256({ key: "notes" }) } })],
    ["arguments naming another declared key", input => ({ ...input, providerArgumentsHash: nativeSha256({ key: "summary" }),
      invocation: { ...input.invocation!, argumentsHash: nativeSha256({ key: "summary" }) } })],
    ["arguments with an extra field", input => ({ ...input, providerArgumentsHash: nativeSha256({ key: "report", extra: true }),
      invocation: { ...input.invocation!, argumentsHash: nativeSha256({ key: "report", extra: true }) } })],
    ["a missing invocation", input => ({ ...input, invocation: undefined })],
    ["an invocation that did not succeed", input => ({ ...input, invocation: { ...input.invocation!, status: "failed" } })],
    ["an invocation of another tool", input => ({ ...input, invocation: { ...input.invocation!, toolName: "call_api" } })],
    ["an invocation keyed to another call", input => ({ ...input,
      invocation: { ...input.invocation!, idempotencyKey: `aw-native-tool:${input.claims.run_id}:other` } })],
    ["an invocation of another Run", input => ({ ...input, invocation: { ...input.invocation!, runId: randomUUID() } })],
    ["an invocation of another Agent", input => ({ ...input, invocation: { ...input.invocation!, agentId: randomUUID() } })],
    ["an invocation on another Task", input => ({ ...input, invocation: { ...input.invocation!, issueId: randomUUID() } })],
    ["an invocation bound to other arguments", input => ({ ...input, invocation: { ...input.invocation!, argumentsHash: "0".repeat(64) } })],
    ["an uncharged invocation", input => ({ ...input, chargedPlanId: null })],
    ["an invocation charged to another plan", input => ({ ...input, chargedPlanId: randomUUID() })],
  ];
  it.each(refusals)("refuses %s", (_name, change) => {
    const input = readFixture();
    expect(managedReviewerDocumentReadExact(input)).toBe(true);
    expect(managedReviewerDocumentReadExact(change(input))).toBe(false);
  });
});
