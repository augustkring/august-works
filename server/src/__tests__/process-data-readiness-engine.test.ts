import { describe, expect, it } from "vitest";
import { BUSINESS_EVENT_PROJECTOR_VERSION, PROCESS_DATA_DIMENSIONS, assessProcessDataSchema, type BusinessEvent } from "@paperclipai/shared";
import { assessNativeProcessData, processTimestampMicros } from "../services/process-data-readiness-engine.js";
const id=(n:number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const now=new Date("2026-10-07T00:00:00Z");
const requirement=assessProcessDataSchema.parse({ analysisKey: "task_flow", businessQuestion: "How do recorded native task activities flow?",
  from: "2026-01-01T00:00:00Z",until: "2026-01-02T00:00:00Z",requiredSourceProviders: ["activity_log"],requiredObjectTypes: ["issue"],
  requiredActivities: ["issue.created","issue.updated"],minimumCoverageSeconds: 3600,requiresOrdering: true,requiresLifecycle: true,requiresArrivalEvidence: false,
  maxDuplicateRate: 0,maxUnknownObjectRate: 0,maxLateArrivalRate: 0,governanceObligationRefs: [id(10)],retentionDays: 30 });
function event(n:number): BusinessEvent {
  const activity=n===2 ? "issue.created" : "issue.updated";
  return { id:id(n),companyId:id(1),eventType:activity,activity,lifecycle:n===2 ? "created" : "updated",
    occurredAt:`2026-01-01T01:00:00.00000${n}Z`,observedAt:"2026-10-06T00:00:00Z",sourceUpdatedAt:null,receivedAt:null,
    source:{ class:"aw_native",provider:"activity_log",ref:id(n),version:BUSINESS_EVENT_PROJECTOR_VERSION,contentHash:String(n).repeat(64) },
    revision:1,objects:[{objectType:"issue",objectId:id(7),qualifier:"primary"},{objectType:"project",objectId:id(8),qualifier:"related"}],
    attributes:{status:n===2 ? "todo" : "done"},purpose:"process_intelligence",sensitivity:"internal",trustLevel:"observed",supersedesEventId:null,tombstonedAt:null,
    governanceObligationRefs:[id(10)],retentionDays:30,expiresAt:"2099-01-01T00:00:00Z" };
}
const events=[event(2),event(3)];
const inspection={ sourceScanExhausted:true,eventScanExhausted:true,nativeSourceLifecycleVerified:true,
  expectedNativeSources:events.map(event => ({ ref:event.source.ref,hash:event.source.contentHash })) };
describe("multidimensional native process-data readiness",() => {
  it("requires all material dimensions and distinguishes exact microseconds without a universal score",() => {
    const result=assessNativeProcessData(id(1),requirement,events,inspection,now);
    expect(result).toMatchObject({ status:"ready",admission:"DATA_READY",coverage:"current_native_activity_snapshot",authorizedEventCount:2 });
    expect(result.dimensions.map(dimension => dimension.dimension)).toEqual(PROCESS_DATA_DIMENSIONS);
    expect(result).not.toHaveProperty("score");
    expect(processTimestampMicros(events[1].occurredAt)!-processTimestampMicros(events[0].occurredAt)!).toBe(1n);
    expect(assessNativeProcessData(id(1),requirement,[...events].reverse(),inspection,now).eventSetHash).toBe(result.eventSetHash);
  });
  it("abstains for a bounded scan or a missing source instead of qualifying a subset",() => {
    expect(assessNativeProcessData(id(1),requirement,events,{ ...inspection,sourceScanExhausted:false },now).admission).toBe("DATA_NOT_READY");
    const result=assessNativeProcessData(id(1),requirement,events,{ ...inspection,expectedNativeSources:[...inspection.expectedNativeSources,{ ref:id(11),hash:"b".repeat(64) }] },now);
    expect(result).toMatchObject({ status:"unknown",admission:"DATA_NOT_READY",coverage:"bounded_incomplete_snapshot" });
    expect(result.findings.some(finding => finding.type==="source_gap")).toBe(true);
  });
  it("does not use UUID order for tied occurrences or borrow a related object's primary lifecycle",() => {
    const tied=[events[0],{...events[1],occurredAt:events[0].occurredAt}];
    expect(assessNativeProcessData(id(1),requirement,tied,inspection,now)).toMatchObject({status:"blocked",admission:"DATA_NOT_READY"});
    const related=assessNativeProcessData(id(1),{...requirement,requiredObjectTypes:["issue","project"]},events,inspection,now);
    expect(related.dimensions.find(dimension => dimension.dimension==="lifecycle_completeness")?.state).toBe("unknown");
    expect(related.admission).toBe("DATA_NOT_READY");
    const duplicateSources=[events[0],{...events[1],source:events[0].source}];
    const duplicated=assessNativeProcessData(id(1),requirement,duplicateSources,{...inspection,expectedNativeSources:inspection.expectedNativeSources.slice(0,1)},now);
    expect(duplicated.dimensions.find(dimension => dimension.dimension==="duplicate_rate")?.state).toBe("failed");
    expect(duplicated.admission).toBe("DATA_NOT_READY");
    expect(assessProcessDataSchema.safeParse({...requirement,from:"2026-01-01T00:00:00.1234567Z"}).success).toBe(false);
  });
  it("keeps external source/arrival evidence unknown and rejects expired evidence and open periods",() => {
    const arrival=assessNativeProcessData(id(1),{...requirement,requiresArrivalEvidence:true},events,inspection,now);
    expect(arrival.dimensions.find(dimension => dimension.dimension==="late_arrival_rate")?.state).toBe("unknown");
    expect(arrival.admission).toBe("DATA_NOT_READY");
    expect(assessNativeProcessData(id(1),{...requirement,requiredSourceProviders:["activity_log","crm"]},events,inspection,now).admission).toBe("DATA_NOT_READY");
    expect(assessNativeProcessData(id(1),requirement,events.map(event => ({...event,expiresAt:"2026-01-01T00:00:00Z"})),inspection,now).admission).toBe("DATA_NOT_READY");
    expect(assessNativeProcessData(id(1),{...requirement,until:"2027-01-01T00:00:00Z"},events,inspection,now).admission).toBe("DATA_NOT_READY");
  });
});
