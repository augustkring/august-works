import { describe, expect, it } from "vitest";
import { BUSINESS_EVENT_PROJECTOR_VERSION, processAnalysisDefinitionSchema, type BusinessEvent, type ProcessAnalysisDefinition } from "@paperclipai/shared";
import { calculateNativeProcess, nativeProcessRequirements } from "../services/process-analysis-engine.js";
import { assessNativeProcessData } from "../services/process-data-readiness-engine.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = new Date("2026-10-07T00:00:00Z");
const window = { versionId: id(50), from: "2026-01-01T00:00:00Z", until: "2026-01-02T00:00:00Z" };
const definition = processAnalysisDefinitionSchema.parse({
  name: "Recorded task flow", businessQuestion: "How long do recorded native task paths take?", ownerUserId: "operator",
  reviewFrequencyDays: 30, scope: "company", sensitivity: "internal", purpose: "process_intelligence",
  governanceObligationRefs: [id(10)], retentionDays: 30, requiredSourceProviders: ["activity_log"], objectTypes: ["issue"],
  requiredActivities: ["issue.created", "issue.updated"], minimumCoverageSeconds: 3600,
  analysisFamilies: ["event_volume", "directly_follows", "variants", "cycle_time", "blocked_time", "rework"],
  requiresArrivalEvidence: false, maxLateArrivalRate: 0,
});
function event(n: number, second: number, status: string | undefined, objectId = id(7), created = false): BusinessEvent {
  const activity = created ? "issue.created" : "issue.updated";
  return {
    id: id(n), companyId: id(1), eventType: activity, activity, lifecycle: created ? "created" : "updated",
    occurredAt: new Date(Date.parse(window.from) + second * 1000).toISOString(), observedAt: "2026-10-06T00:00:00Z", sourceUpdatedAt: null, receivedAt: null,
    source: { class: "aw_native", provider: "activity_log", ref: id(n), version: BUSINESS_EVENT_PROJECTOR_VERSION, contentHash: String(n).padStart(64, "0") },
    revision: 1, objects: [{ objectType: "issue", objectId, qualifier: "primary" }, { objectType: "project", objectId: id(8), qualifier: "related" }],
    attributes: status ? { status } : {}, purpose: "process_intelligence", sensitivity: "internal", trustLevel: "observed", supersedesEventId: null, tombstonedAt: null,
    governanceObligationRefs: [id(10)], retentionDays: 30, expiresAt: "2099-01-01T00:00:00Z",
  };
}
function assess(events: BusinessEvent[], input = definition) {
  return assessNativeProcessData(id(1), nativeProcessRequirements(input, window), events, {
    sourceScanExhausted: true, eventScanExhausted: true, nativeSourceLifecycleVerified: true,
    expectedNativeSources: events.map(item => ({ ref: item.source.ref, hash: item.source.contentHash })),
  }, now);
}
function calculate(events: BusinessEvent[], input = definition) {
  return calculateNativeProcess(id(1), input, window, events, assess(events, input), now);
}

describe("bounded native object-process calculations", () => {
  it("calculates known first-completion durations, observed blocked intervals, and reopening without person effects", () => {
    const events = [event(2, 0, "todo", id(7), true), event(3, 10, "blocked"), event(4, 15, undefined),
      event(5, 30, "done"), event(6, 40, "in_progress"), event(9, 50, "done"),
      event(11, 0, "todo", id(12), true), event(13, 100, "done", id(12))];
    const result = calculate(events);
    expect(result.status).toBe("succeeded");
    expect(result.objectSummaries[0]).toMatchObject({ objectType: "issue", objectCount: 2, eventCount: 8,
      closedCompletionCount: 2, cancelledCount: 0, censoredCount: 0, medianCycleSeconds: 65, p90CycleSeconds: 93,
      knownBlockedSeconds: 20, reopenCount: 1 });
    expect(result.objectSummaries[0].directlyFollows.reduce((sum, edge) => sum + edge.count, 0)).toBe(6);
    expect(result.objectSummaries[0].variants.map(variant => variant.objectCount)).toEqual([1, 1]);
    expect(calculate([...events].reverse())).toEqual(result);
    expect(result.semantics).toBe("observed_native_activity_paths_no_causal_or_person_effect");
  });
  it("keeps cancellation distinct from completion and accepts genuine zero duration", () => {
    const cancelled = calculate([event(2, 0, "todo", id(7), true), event(3, 10, "cancelled"), event(4, 20, undefined)]);
    expect(cancelled.status).toBe("succeeded");
    expect(cancelled.objectSummaries[0]).toMatchObject({ closedCompletionCount: 0, cancelledCount: 1, censoredCount: 0,
      medianCycleSeconds: null, p90CycleSeconds: null, knownBlockedSeconds: 0, reopenCount: 0 });
    const completeAtCreation = calculate([event(2, 0, "done", id(7), true), event(3, 10, undefined)]);
    expect(completeAtCreation.objectSummaries[0]).toMatchObject({ closedCompletionCount: 1, medianCycleSeconds: 0, p90CycleSeconds: 0 });
  });
  it("preserves multi-object paths without assigning task lifecycle to related projects", () => {
    const events = [event(2, 0, "todo", id(7), true), event(3, 10, "done"), event(4, 20, "todo", id(9), true), event(5, 30, "done", id(9))];
    const paths = { ...definition, objectTypes: ["issue", "project"] as ("issue" | "project")[], analysisFamilies: ["event_volume", "directly_follows", "variants"] as ProcessAnalysisDefinition["analysisFamilies"] };
    const result = calculate(events, paths);
    expect(result.status).toBe("succeeded");
    expect(result.objectSummaries.map(summary => [summary.objectType, summary.objectCount, summary.eventCount])).toEqual([["issue", 2, 4], ["project", 1, 4]]);
    expect(result.objectSummaries.every(summary => summary.closedCompletionCount === null && summary.knownBlockedSeconds === null)).toBe(true);
    expect(calculate(events, { ...definition, objectTypes: ["issue", "project"] }).errorCode).toBe("DATA_NOT_READY");
  });
  it("cannot promote relaxed, expired, changed, cross-tenant, or ambiguous readiness", () => {
    const events = [event(2, 0, "todo", id(7), true), event(3, 10, "done")];
    const relaxed = { ...definition, analysisFamilies: ["event_volume"] as ProcessAnalysisDefinition["analysisFamilies"] };
    expect(calculateNativeProcess(id(1), definition, window, events, assess(events, relaxed), now).errorCode).toBe("DATA_NOT_READY");
    expect(calculateNativeProcess(id(1), definition, window, [{ ...events[0], attributes: { status: "blocked" } }, events[1]], assess(events), now).errorCode).toBe("DATA_NOT_READY");
    expect(calculateNativeProcess(id(1), definition, window, events, assess(events), new Date("2026-10-08T00:00:00Z")).errorCode).toBe("DATA_NOT_READY");
    expect(calculateNativeProcess(id(20), definition, window, events, assess(events), now).errorCode).toBe("DATA_NOT_READY");
    const tied = [events[0], { ...events[1], occurredAt: events[0].occurredAt }];
    expect(calculate(tied).errorCode).toBe("DATA_NOT_READY");
    expect(calculate([events[0]]).errorCode).toBe("DATA_NOT_READY");
    expect(calculate(events, { ...definition, requiresArrivalEvidence: true }).errorCode).toBe("DATA_NOT_READY");
    expect(calculate(events, { ...definition, requiredSourceProviders: ["activity_log", "crm"] }).errorCode).toBe("DATA_NOT_READY");
  });
  it("allows a volume-only path beyond the display bound while abstaining from an oversized variant", () => {
    const events = Array.from({ length: 513 }, (_, i) => event(100 + i, i, i === 0 ? "todo" : i === 512 ? "done" : undefined, id(7), i === 0));
    const volume = { ...definition, analysisFamilies: ["event_volume"] as ProcessAnalysisDefinition["analysisFamilies"] };
    expect(calculate(events, volume).objectSummaries[0]).toMatchObject({ eventCount: 513, closedCompletionCount: null, censoredCount: null });
    expect(calculate(events).errorCode).toBe("RESULT_BOUND_EXCEEDED");
  });
});
