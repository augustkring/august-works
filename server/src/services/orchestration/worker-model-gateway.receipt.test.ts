import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { nativeRunInputSourceReceiptSchema, type NativePayloadSourcePolicy,
  type NativeRunInputSourceReceipt } from "@paperclipai/shared";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { exactManagedAssistantHistoryPrefix } from "./worker-model-gateway.js";

const hash = (value: string) => value.repeat(64).slice(0, 64);

function fixture() {
  const companyId = randomUUID(), runId = randomUUID(), agentId = randomUUID(), issueId = randomUUID();
  const reservationId = randomUUID(), callId = "provider-call-1", responsibleUserId = randomUUID();
  const responseHash = hash("a"), requestHash = hash("b"), wireBodyHash = hash("c");
  const sourceDispatchDigest = hash("d");
  const policy: NativePayloadSourcePolicy = { issueIds: [issueId], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] };
  const inputs = [{ kind: "task" as const, issueId, sourceVersion: "2026-10-26T00:00:00.000Z", contentHash: hash("e") }];
  const consumedSourceSet = { policy, inputs };
  const marker = { kind: "worker_model_dispatch" as const, runId, reservationId, callId,
    requestHash, wireBodyHash, responseHash };
  const receipt = nativeRunInputSourceReceiptSchema.parse({ version: 1,
    binding: { companyId, runId, agentId, responsibleUserId, issueId },
    bootstrap: { executionInputDigest: hash("f"), policy, inputs },
    dispatches: [{ executionInputDigest: sourceDispatchDigest, responsibleUserId, policy, inputs: [...inputs, marker] }],
    additionalInputs: [], digest: hash("9"),
  }) as NativeRunInputSourceReceipt;
  const intent = { reservationId, callId, requestHash, wireBodyHash, sourceDispatchDigest,
    consumedSourceSet, consumedSourceSetHash: nativeSha256(consumedSourceSet),
    consumedSourceComponents: [{ kind: "bootstrap" }], };
  return { receipt, intent, runId, responseHash, responsibleUserId, sourceDispatchDigest };
}

describe("managed OpenCode assistant history receipt binding", () => {
  it("resolves the exact acknowledged source prefix and its provider response marker", () => {
    const value = fixture();
    expect(exactManagedAssistantHistoryPrefix({ receipt: value.receipt, intent: value.intent,
      runId: value.runId, providerResponseHash: value.responseHash })).toEqual(value.receipt.dispatches[0]);
  });

  it("leaves changed response receipts unknown", () => {
    const value = fixture();
    const changed = { ...value.intent, requestHash: hash("8") };
    expect(exactManagedAssistantHistoryPrefix({ receipt: value.receipt, intent: changed,
      runId: value.runId, providerResponseHash: value.responseHash })).toBeNull();
  });

  it("rejects an otherwise valid dispatch prefix containing an extra unbound source", () => {
    const value = fixture();
    const extraIssueId = randomUUID();
    const dispatch = value.receipt.dispatches[0]!;
    const extraReceipt = nativeRunInputSourceReceiptSchema.parse({ ...value.receipt,
      dispatches: [{ ...dispatch,
        policy: { ...dispatch.policy, issueIds: [...dispatch.policy.issueIds, extraIssueId].sort() },
        inputs: [...dispatch.inputs, { kind: "task", issueId: extraIssueId,
          sourceVersion: "2026-10-26T00:00:01.000Z", contentHash: hash("7") }],
      }],
    });
    expect(exactManagedAssistantHistoryPrefix({ receipt: extraReceipt, intent: value.intent,
      runId: value.runId, providerResponseHash: value.responseHash })).toBeNull();
  });
});
