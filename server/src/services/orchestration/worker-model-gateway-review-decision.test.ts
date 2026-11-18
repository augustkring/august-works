import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { managedReviewDecisionResultExact } from "./worker-model-gateway.js";

// MS1h16. The gateway admits a Native completion Reviewer's resolve_review
// result into its next model input only as its exact current decision receipt.
type Input = Parameters<typeof managedReviewDecisionResultExact>[0];

function fixture(status: "accepted" | "rejected" = "accepted"): Input {
  const runId = randomUUID(), agentId = randomUUID(), issueId = randomUUID(), interactionId = randomUUID();
  const invocationId = randomUUID(), toolUseId = "resolve-provider-call-1";
  const providerArgumentsHash = nativeSha256({ decision: status === "accepted" ? "accept" : "reject" });
  const source = { kind: "tool_result", runId, callId: toolUseId, toolName: "resolve_review", invocationId,
    contentHash: nativeSha256({ interactionId, status }) };
  return {
    claims: { scope: "review_model", run_id: runId, sub: agentId, responsible_user_id: "user-1",
      review_model: { issueId, interactionId } },
    toolUseId,
    providerArgumentsHash,
    capture: { managedOpenCode: true, callId: toolUseId, tool: "resolve_review", argumentsHash: providerArgumentsHash,
      resultDigest: source.contentHash, source },
    source,
    invocation: { id: invocationId, issueId, runId, agentId, toolName: "resolve_review", status: "succeeded",
      idempotencyKey: `aw-native-tool:${runId}:${toolUseId}`, argumentsHash: providerArgumentsHash },
    consumedEntry: { responsibleUserId: "user-1", inputs: [source],
      policy: { issueIds: [], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] } },
    result: { interactionId, status },
    interaction: { id: interactionId, issueId, status, resolvedByRunId: runId, resolvedByAgentId: agentId },
  };
}

describe("managed resolve_review result receipt (MS1h16)", () => {
  it("admits the exact current accepted and rejected decision receipts", () => {
    expect(managedReviewDecisionResultExact(fixture("accepted"))).toBe(true);
    expect(managedReviewDecisionResultExact(fixture("rejected"))).toBe(true);
  });

  const refusals: Array<[string, (input: Input) => Input]> = [
    ["a result with an extra key", input => ({ ...input, result: { ...(input.result as object), comment: "extra" } })],
    ["a result missing its status", input => ({ ...input,
      result: { interactionId: (input.result as { interactionId: string }).interactionId } })],
    ["a result naming another interaction", input => ({ ...input,
      result: { ...(input.result as object), interactionId: randomUUID() } })],
    ["a result status that is not the recorded decision", input => ({ ...input,
      result: { ...(input.result as object), status: "rejected" } })],
    ["a pending status", input => ({ ...input, result: { ...(input.result as object), status: "pending" },
      interaction: { ...input.interaction!, status: "pending" } })],
    ["a decision recorded by another Run", input => ({ ...input,
      interaction: { ...input.interaction!, resolvedByRunId: randomUUID() } })],
    ["a decision recorded by another Agent", input => ({ ...input,
      interaction: { ...input.interaction!, resolvedByAgentId: randomUUID() } })],
    ["no recorded decision", input => ({ ...input, interaction: null })],
    ["an interaction on another Task", input => ({ ...input, interaction: { ...input.interaction!, issueId: randomUUID() } })],
    ["an invocation on another Task", input => ({ ...input, invocation: { ...input.invocation!, issueId: randomUUID() } })],
    ["a worker_model credential", input => ({ ...input, claims: { ...input.claims, scope: "worker_model" } })],
    ["a conversation_model credential", input => ({ ...input, claims: { ...input.claims, scope: "conversation_model" } })],
    ["a review credential without its binding", input => ({ ...input, claims: { ...input.claims, review_model: null } })],
    ["a missing invocation receipt", input => ({ ...input, invocation: undefined })],
    ["an invocation that did not succeed", input => ({ ...input, invocation: { ...input.invocation!, status: "failed" } })],
    ["an invocation of another tool", input => ({ ...input, invocation: { ...input.invocation!, toolName: "write_document" } })],
    ["an invocation keyed to another provider call", input => ({ ...input,
      invocation: { ...input.invocation!, idempotencyKey: `aw-native-tool:${input.claims.run_id}:other-call` } })],
    ["an invocation of another Run", input => ({ ...input, invocation: { ...input.invocation!, runId: randomUUID() } })],
    ["an invocation bound to the request hash, not the provider arguments", input => ({ ...input,
      invocation: { ...input.invocation!, argumentsHash: nativeSha256({ interactionId: randomUUID(), decision: "accept", reason: "" }) } })],
    ["a capture bound to other arguments", input => ({ ...input,
      capture: { ...input.capture, argumentsHash: nativeSha256({ decision: "reject" }) } })],
    ["a capture that is not a managed tool-result capture", input => ({ ...input,
      capture: { ...input.capture, managedOpenCode: undefined } })],
    ["a source naming another invocation", input => {
      const source = { ...input.source, invocationId: randomUUID() };
      return { ...input, source, consumedEntry: { ...input.consumedEntry!, inputs: [source] } };
    }],
    ["a consumed entry with another source", input => ({ ...input, consumedEntry: { ...input.consumedEntry!,
      inputs: [input.source, { kind: "task", issueId: randomUUID(), sourceVersion: "v", contentHash: "a".repeat(64) }] } })],
    ["a consumed entry with a source policy", input => ({ ...input, consumedEntry: { ...input.consumedEntry!,
      policy: { issueIds: [randomUUID()], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] } } })],
    ["a consumed entry of another Human", input => ({ ...input,
      consumedEntry: { ...input.consumedEntry!, responsibleUserId: "user-2" } })],
    ["a missing consumed entry", input => ({ ...input, consumedEntry: undefined })],
  ];
  it.each(refusals)("refuses %s", (_name, change) => {
    const input = fixture();
    expect(managedReviewDecisionResultExact(input)).toBe(true);
    expect(managedReviewDecisionResultExact(change(input))).toBe(false);
  });
});
