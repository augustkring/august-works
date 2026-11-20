import { describe, expect, it } from "vitest";
import type { NativePayloadSourceInput } from "@paperclipai/shared";
import { nativeSha256 } from "./canonical.js";
import type { NativeGovernedInteractionContinuationCapture } from "./native-interaction-bridge.js";
import type { NativeToolActionDeliveryCapture } from "../tool-action-delivery.js";
import { nativeGovernedDeclineOutcomeIds, nativeGovernedWakeHistoricalSources } from "./native-governed-wake-sources.js";

// APR-E2E-15. Pure owner checks used by the Native task-wake source reader.
// The captures here are shaped like the governed decision materialization;
// they are not accepted results and grant nothing by themselves.
const issueId = "11111111-1111-4111-8111-111111111111";
const cardId = "22222222-2222-4222-8222-222222222222";
const otherCardId = "33333333-3333-4333-8333-333333333333";
const sourceVersion = "1795204754.958000";

function governed(input: { id?: string; status?: "accepted" | "rejected"; requestStatus?: string } = {}) {
  const id = input.id ?? cardId, status = input.status ?? "rejected";
  const interactionOutcome = { id, kind: "request_confirmation", status, result: { version: 1, outcome: status } };
  const nativeSource = { kind: "interaction" as const, issueId, interactionId: id, sourceVersion,
    contentHash: nativeSha256({ native: id, status }) };
  return {
    companyId: "company", issueId, runId: "run", agentId: "agent", nativeSource,
    continuationSource: { ...nativeSource, contentHash: nativeSha256({ rendition: "native_governed_continuation_v1", id, status }) },
    nativeResponse: { interactionId: id, kind: "request_confirmation", response: { status } },
    projection: { version: 1, companyId: "company", issueId, interactionId: id, sourceVersion,
      nativeResponseDigest: nativeSource.contentHash,
      owner: { sourceRunId: "producer", sourceCommentId: null, originCommentIds: [], continuationPolicy: "wake_assignee",
        resolvedByUserId: "user", resolvedAt: "2026-11-20T00:00:00.000Z", actionRequestId: "request", invocationId: "invocation",
        argumentsHash: "a".repeat(64), requestStatus: input.requestStatus ?? (status === "rejected" ? "rejected" : "executed"),
        invocationStatus: status === "rejected" ? "denied" : "succeeded" },
      humanResponse: { id, kind: "request_confirmation", status, resolvedByUserId: "user", resolvedAt: "2026-11-20T00:00:00.000Z" },
      interactionOutcome },
  } as unknown as NativeGovernedInteractionContinuationCapture;
}

function delivery(capture: NativeGovernedInteractionContinuationCapture, overrides: { interactionId?: string; sourceVersion?: string } = {}) {
  const interactionId = overrides.interactionId ?? capture.projection.interactionId;
  const version = overrides.sourceVersion ?? capture.nativeSource.sourceVersion;
  return { companyId: "company", issueId, agentId: "agent", runId: "run", wakeupRequestId: "wake",
    projection: { interactionId, sourceVersion: version } as NativeToolActionDeliveryCapture["projection"],
    source: { kind: "interaction" as const, issueId, interactionId, sourceVersion: version,
      contentHash: nativeSha256({ rendition: "native_tool_action_delivery_v1", interactionId, version }) },
  } satisfies NativeToolActionDeliveryCapture;
}

const sealed = (...captures: NativeGovernedInteractionContinuationCapture[]): NativePayloadSourceInput[] =>
  captures.flatMap(value => [value.nativeSource, value.continuationSource]);

describe("nativeGovernedDeclineOutcomeIds", () => {
  it("owns a declined tool-action card by its single rejected governed decision", () => {
    const decision = governed();
    const inputs = sealed(decision);
    expect([...nativeGovernedDeclineOutcomeIds({ outcomes: [decision.projection.interactionOutcome],
      governedInteractions: [decision], bootstrapInputs: inputs, inputs })]).toEqual([cardId]);
  });

  it("refuses an accepted or executed decision, a changed outcome, duplicates and missing renditions", () => {
    const decision = governed();
    const inputs = sealed(decision);
    const own = (value: Partial<Parameters<typeof nativeGovernedDeclineOutcomeIds>[0]>) => [...nativeGovernedDeclineOutcomeIds({
      outcomes: [decision.projection.interactionOutcome], governedInteractions: [decision], bootstrapInputs: inputs, inputs, ...value })];
    const accepted = governed({ status: "accepted" });
    expect(own({ outcomes: [accepted.projection.interactionOutcome], governedInteractions: [accepted],
      bootstrapInputs: sealed(accepted), inputs: sealed(accepted) })).toEqual([]);
    expect(own({ governedInteractions: [governed({ requestStatus: "executed" })] })).toEqual([]);
    expect(own({ outcomes: [{ ...decision.projection.interactionOutcome, result: { version: 1, outcome: "rejected", reason: "changed" } }] })).toEqual([]);
    expect(own({ outcomes: [decision.projection.interactionOutcome, decision.projection.interactionOutcome] })).toEqual([]);
    expect(own({ governedInteractions: [decision, decision] })).toEqual([]);
    expect(own({ governedInteractions: [] })).toEqual([]);
    expect(own({ bootstrapInputs: [decision.nativeSource] })).toEqual([]);
    expect(own({ inputs: [decision.continuationSource] })).toEqual([]);
    // A rejected decision for another card owns nothing here.
    const other = governed({ id: otherCardId });
    expect(own({ governedInteractions: [other], bootstrapInputs: sealed(other), inputs: sealed(other) })).toEqual([]);
  });
});

describe("nativeGovernedWakeHistoricalSources", () => {
  it("returns each decision's continuation rendition and the delivery rendition for that decision only", () => {
    const decision = governed(), sent = delivery(decision);
    expect(nativeGovernedWakeHistoricalSources({ governedInteractions: [decision], delivery: sent }))
      .toEqual([decision.continuationSource, sent.source]);
    expect(nativeGovernedWakeHistoricalSources({ governedInteractions: [decision], delivery: undefined }))
      .toEqual([decision.continuationSource]);
  });

  it("never returns the Native rendition, a delivery for another card or version, or anything without a decision", () => {
    const decision = governed();
    const sources = nativeGovernedWakeHistoricalSources({ governedInteractions: [decision], delivery: delivery(decision) });
    expect(sources).not.toContainEqual(decision.nativeSource);
    expect(nativeGovernedWakeHistoricalSources({ governedInteractions: [decision],
      delivery: delivery(decision, { interactionId: otherCardId }) })).toEqual([decision.continuationSource]);
    expect(nativeGovernedWakeHistoricalSources({ governedInteractions: [decision],
      delivery: delivery(decision, { sourceVersion: "1795204999.000000" }) })).toEqual([decision.continuationSource]);
    expect(nativeGovernedWakeHistoricalSources({ governedInteractions: [], delivery: delivery(decision) })).toEqual([]);
  });
});
