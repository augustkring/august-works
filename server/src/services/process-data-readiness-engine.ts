import { z } from "zod";
import { BUSINESS_EVENT_PROJECTOR_VERSION, NATIVE_PROCESS_STATES, PROCESS_DATA_DIMENSIONS, assessProcessDataSchema, businessEventObjectSchema,
  type AssessProcessData, type BusinessEvent, type ProcessDataDimension, type ProcessDataDimensionResult, type ProcessDataReadinessResult } from "@paperclipai/shared";
import { nativeSha256 } from "./native-runtime/canonical.js";

export const PROCESS_DATA_READINESS_VERSION = "aw-native-process-data-readiness-v3";
/** Internal owner facts, not accepted in the public assessment request. A bounded
 * event page or a customer assertion cannot certify source coverage or deletion. */
export interface NativeProcessSourceInspection {
  sourceScanExhausted: boolean;
  eventScanExhausted: boolean;
  expectedNativeSources: readonly { ref: string; hash: string }[];
  nativeSourceLifecycleVerified: boolean;
}
// Parse UTC microseconds without JS Date's within-millisecond truncation.
export function processTimestampMicros(value: string): bigint | null {
  if (!z.iso.datetime().safeParse(value).success) return null;
  const match = /^(.*:\d{2})(?:\.(\d{1,6}))?Z$/.exec(value);
  if (!match) return null;
  const seconds = Date.parse(`${match[1]}Z`);
  return Number.isFinite(seconds) ? BigInt(seconds)*1000n+BigInt((match[2] ?? "").padEnd(6,"0")) : null;
}
export function assessNativeProcessData(companyId: string, raw: AssessProcessData, events: readonly BusinessEvent[], inspection: NativeProcessSourceInspection, now = new Date()): ProcessDataReadinessResult {
  const requirements = assessProcessDataSchema.parse(raw);
  if (events.length>2000 || events.some(event => event.companyId!==companyId)) throw new Error("Process readiness requires a bounded single-company native snapshot");
  const dimensions = new Map<ProcessDataDimension, ProcessDataDimensionResult>();
  const set = (dimension: ProcessDataDimension, state: ProcessDataDimensionResult["state"], reason: string, required = true) => dimensions.set(dimension,{ dimension,state,reason,required });
  for (const dimension of PROCESS_DATA_DIMENSIONS) set(dimension,"unknown","Current native evidence has not established this dimension");
  const from = processTimestampMicros(requirements.from)!, until = processTimestampMicros(requirements.until)!, asOf = BigInt(now.getTime())*1000n;
  const expected = new Map(inspection.expectedNativeSources.map(source => [source.ref,source.hash]));
  const available = new Map(events.map(event => [event.source.ref,event.source.contentHash]));
  const providerCoverage = requirements.requiredSourceProviders.every(provider => provider === "activity_log");
  const currentEvents = events.every(event => event.source.provider==="activity_log" && event.source.version===BUSINESS_EVENT_PROJECTOR_VERSION
    && event.purpose==="process_intelligence" && event.trustLevel==="observed" && event.tombstonedAt===null && Date.parse(event.expiresAt)>now.getTime()
    && Number.isFinite(Date.parse(event.observedAt)) && Date.parse(event.observedAt)<=now.getTime());
  const coverage = inspection.sourceScanExhausted && inspection.eventScanExhausted && providerCoverage
    && currentEvents
    && expected.size === inspection.expectedNativeSources.length && expected.size===available.size
    && [...expected].every(([ref,hash]) => available.get(ref)===hash);
  const periodComplete = until<=asOf && until-from>=BigInt(requirements.minimumCoverageSeconds)*1_000_000n;
  set("source_coverage",coverage ? "satisfied" : "unknown",coverage ? "Exact current native source identities and hashes match the admitted event snapshot" : "Required source or complete current projection coverage is unestablished; bounded pages cannot certify it");
  set("sampling_filter_completeness",periodComplete && coverage ? "satisfied" : "unknown",periodComplete ? "Current native coverage must include the complete requested source/window filter" : "The requested period is open or shorter than its required coverage interval");
  const activities = new Set(events.map(event => event.activity));
  set("activity_completeness",requirements.requiredActivities.every(activity => activities.has(activity)) ? "satisfied" : "unknown","Every declared required activity must be observed; absence does not prove that activity never occurs");
  const times = events.map(event => processTimestampMicros(event.occurredAt));
  const completeTimes = times.every(time => time!==null);
  set("timestamp_completeness",completeTimes ? "satisfied" : "failed","Event time must be a valid explicit UTC timestamp with supported microsecond precision");
  set("timestamp_plausibility",completeTimes && times.every(time => time!==null && time>=from && time<=until && time<=asOf) ? "satisfied" : "failed","Occurrence must fall within the requested observed period and cannot be in the future");
  const parsedObjects = events.flatMap(event => event.objects.map(object => businessEventObjectSchema.safeParse(object)));
  const unknownRate = parsedObjects.length ? parsedObjects.filter(object => !object.success).length/parsedObjects.length : events.length ? 1 : 0;
  set("stable_object_identity",unknownRate>requirements.maxUnknownObjectRate ? "failed" : unknownRate>0 ? "warning" : "satisfied","Object identities must satisfy the typed native UUID contract; the declared unknown-object threshold is explicit");
  set("object_link_completeness",events.every(event => event.objects.length>0 && event.objects.some(object => object.qualifier === "primary"))
    && requirements.requiredObjectTypes.every(type => events.some(event => event.objects.some(object => object.objectType===type))) ? "satisfied" : "failed","Recorded primary links and required object types must exist; current assignments cannot invent historical links");
  set("referential_integrity",inspection.nativeSourceLifecycleVerified && coverage && unknownRate===0 ? "satisfied" : "unknown","Only the native owner's current source/object/purpose admission can establish referential integrity");
  const duplicates = events.length-Math.min(new Set(events.map(event => event.id)).size,new Set(events.map(event => event.source.ref)).size);
  const duplicateRate = events.length ? duplicates/events.length : 0;
  set("duplicate_rate",duplicateRate>requirements.maxDuplicateRate ? "failed" : duplicates ? "warning" : "satisfied","Duplicate event or native source identities are evaluated against the declared threshold");
  const paths = new Map<string,{ event: BusinessEvent; time: bigint | null }[]>();
  for (let i=0;i<events.length;i++) for (const object of events[i].objects) {
    const key = `${object.objectType}:${object.objectId}`; const path=paths.get(key) ?? [];
    path.push({ event: events[i], time: times[i] }); paths.set(key,path);
  }
  let ambiguous = false;
  // Ordering requirements belong to the requested object perspectives. Two
  // tasks may start together without asserting a Project-level sequence.
  for (const [objectKey,path] of paths) {
    if (!requirements.requiredObjectTypes.some(type => objectKey.startsWith(`${type}:`))) continue;
    const counts = new Map<string,Set<string>>();
    for (const item of path) if (item.time!==null) { const key=String(item.time); const ids=counts.get(key) ?? new Set<string>(); ids.add(item.event.id); counts.set(key,ids); }
    if ([...counts.values()].some(ids => ids.size>1)) ambiguous=true;
  }
  set("ordering_ambiguity",ambiguous && requirements.requiresOrdering ? "failed" : ambiguous ? "warning" : "satisfied","Distinct events sharing an object's exact occurrence time have no asserted causal order",requirements.requiresOrdering);
  set("clock_timezone_ambiguity",completeTimes ? "satisfied" : "unknown","Native database occurrence time is explicit UTC; external clock provenance is not inferred");
  const lifecycles = [...paths].filter(([key]) => requirements.requiredObjectTypes.some(type => key.startsWith(`${type}:`))).every(([key,path]) => {
    const primary = path.filter(item => item.event.objects.some(object => object.qualifier==="primary" && `${object.objectType}:${object.objectId}`===key));
    const ordered=primary.toSorted((a,b) => a.time===null || b.time===null ? 0 : a.time<b.time ? -1 : a.time>b.time ? 1 : 0);
    if (!ordered.length || ordered[0].event.lifecycle!=="created") return false;
    const objectType=key.startsWith("issue:") ? "issue" : "project";
    const terminal=(status:string|undefined) => status==="cancelled" || status===(objectType==="issue" ? "done" : "completed");
    if(requirements.lifecycleSemantics==="recorded_creation_and_any_terminal") return ordered.some(item=>terminal(item.event.attributes.status));
    const allowed=new Set<string>(NATIVE_PROCESS_STATES[objectType]);
    const states=ordered.flatMap(item=>item.event.attributes.status ? [item.event.attributes.status] : []);
    if(!ordered[0].event.attributes.status || !states.every(status=>allowed.has(status)) || !terminal(states.at(-1))) return false;
    let recordedState=ordered[0].event.attributes.status;
    for(const {event} of ordered.slice(1)) {
      // A native row-lock receipt can establish a missing/reordered state fact.
      // Its contradiction is a data gap, not a deviation from a process model.
      if(event.attributes.previousStatus!==undefined && event.attributes.previousStatus!==recordedState) return false;
      if(event.attributes.status!==undefined) recordedState=event.attributes.status;
    }
    return true;
  });
  set("lifecycle_completeness",requirements.requiresLifecycle ? lifecycles && !ambiguous && events.length>0 ? "satisfied" : "unknown" : "not_applicable",
    requirements.lifecycleSemantics==="recorded_typed_creation_and_latest_terminal"
      ? "Complete state paths require typed native creation, known states, consistent supplied previous-state receipts and a latest terminal; gaps and reopened paths remain incomplete"
      : "First-completion claims require observed creation and a recorded native terminal state; later reopenings do not erase the first completion",requirements.requiresLifecycle);
  set("late_arrival_rate",requirements.requiresArrivalEvidence ? "unknown" : "not_applicable","Projection observedAt is not a transport-arrival timestamp; no late-arrival rate is fabricated",requirements.requiresArrivalEvidence);
  set("source_deletion_edit_propagation",inspection.nativeSourceLifecycleVerified && coverage ? "satisfied" : "unknown","Current source hash, suppression, retention and native Memory admission must all hold for the inspected snapshot");
  set("actor_mapping_quality","not_applicable","No actor mapping, person ranking or person-level attribute is used",false);
  set("cross_system_entity_resolution",providerCoverage && unknownRate===0 ? "not_applicable" : "unknown","This native snapshot uses typed native identities; external entity resolution is unqualified",!providerCoverage);
  if (!events.length) set("activity_completeness","unknown","An empty authorized snapshot does not establish required process evidence");
  const values=PROCESS_DATA_DIMENSIONS.map(dimension => dimensions.get(dimension)!);
  const blocked=values.some(dimension => dimension.required && dimension.state==="failed");
  const unknown=values.some(dimension => dimension.required && dimension.state==="unknown");
  const status: ProcessDataReadinessResult["status"] = blocked ? "blocked" : unknown ? "unknown" : values.some(dimension => dimension.state==="warning") ? "ready_with_warning" : "ready";
  const findingTypes: Partial<Record<ProcessDataDimension,ProcessDataReadinessResult["findings"][number]["type"]>> = {
    source_coverage: "source_gap", sampling_filter_completeness: "partial_period", activity_completeness: "unknown_activity",
    timestamp_completeness: "missing_timestamp", timestamp_plausibility: "impossible_order", stable_object_identity: "ambiguous_identity",
    object_link_completeness: "missing_object_link", duplicate_rate: "duplicate_event", ordering_ambiguity: "impossible_order",
    late_arrival_rate: "late_event", lifecycle_completeness: "lifecycle_gap",
  };
  const expiry=Math.min(now.getTime()+300_000,...events.map(event => Date.parse(event.expiresAt)));
  return { companyId, engineVersion: PROCESS_DATA_READINESS_VERSION, status, admission: blocked || unknown ? "DATA_NOT_READY" : "DATA_READY",
    analysisKey: requirements.analysisKey, requirementHash: nativeSha256({ companyId, requirements }), eventSetHash: nativeSha256(events.toSorted((a,b) => a.id.localeCompare(b.id))),
    assessedAt: now.toISOString(), expiresAt: new Date(expiry).toISOString(), authorizedEventCount: events.length,
    dimensions: values, findings: values.filter(dimension => findingTypes[dimension.dimension] && !["satisfied","not_applicable"].includes(dimension.state))
      .map(dimension => ({ type: findingTypes[dimension.dimension]!, dimension: dimension.dimension, summary: dimension.reason })),
    coverage: coverage && periodComplete ? "current_native_activity_snapshot" : "bounded_incomplete_snapshot" };
}
