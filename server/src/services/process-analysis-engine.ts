import { assessProcessDataSchema, processAnalysisDefinitionSchema, runProcessAnalysisSchema, type BusinessEvent, type NativeProcessAnalysisResult, type NativeProcessObjectSummary,
  type ProcessAnalysisDefinition, type ProcessDataReadinessResult, type RunProcessAnalysis } from "@paperclipai/shared";
import { nativeSha256 } from "./native-runtime/canonical.js";
import { processTimestampMicros } from "./process-data-readiness-engine.js";

export const NATIVE_PROCESS_ENGINE_VERSION="aw-native-object-process-v1";
export function nativeProcessRequirements(definition:ProcessAnalysisDefinition,window:RunProcessAnalysis) {
  runProcessAnalysisSchema.parse(window);
  return assessProcessDataSchema.parse({governanceObligationRefs:definition.governanceObligationRefs,retentionDays:definition.retentionDays,
    analysisKey:"published_native_process",businessQuestion:definition.businessQuestion,from:window.from,until:window.until,
    requiredSourceProviders:definition.requiredSourceProviders,requiredObjectTypes:definition.objectTypes,requiredActivities:definition.requiredActivities,
    minimumCoverageSeconds:definition.minimumCoverageSeconds,requiresOrdering:definition.analysisFamilies.some(family => family!=="event_volume"),
    requiresLifecycle:definition.analysisFamilies.some(family => ["cycle_time","blocked_time","rework"].includes(family)),
    requiresArrivalEvidence:definition.requiresArrivalEvidence,maxDuplicateRate:0,maxUnknownObjectRate:0,maxLateArrivalRate:definition.maxLateArrivalRate});
}
type Point={event:BusinessEvent;time:bigint};
const completion=(status:string|undefined) => status==="done" || status==="completed";
const terminal=(status:string|undefined) => completion(status) || status==="cancelled";
const seconds=(duration:bigint) => Number(duration)/1_000_000;
function quantile(values:number[],probability:number) {
  if (!values.length) return null;
  const ordered=values.toSorted((a,b)=>a-b),position=(ordered.length-1)*probability,lower=Math.floor(position),upper=Math.ceil(position);
  return ordered[lower]+(ordered[upper]-ordered[lower])*(position-lower);
}
/** Only native observed paths are summarized. The caller cannot promote a
 * relaxed preview: intrinsic family requirements and exact input hashes bind it. */
export function calculateNativeProcess(companyId:string,raw:ProcessAnalysisDefinition,window:RunProcessAnalysis,events:readonly BusinessEvent[],readiness:ProcessDataReadinessResult,now=new Date()):NativeProcessAnalysisResult {
  const definition=processAnalysisDefinitionSchema.parse(raw),requirements=nativeProcessRequirements(definition,window);
  const result=(status:NativeProcessAnalysisResult["status"],errorCode:NativeProcessAnalysisResult["errorCode"],objectSummaries:NativeProcessObjectSummary[]=[]):NativeProcessAnalysisResult => ({engineVersion:NATIVE_PROCESS_ENGINE_VERSION,status,errorCode,readiness,objectSummaries,semantics:"observed_native_activity_paths_no_causal_or_person_effect"});
  if (events.length>2000 || events.some(event=>event.companyId!==companyId) || readiness.companyId!==companyId
    || readiness.admission!=="DATA_READY" || !["ready","ready_with_warning"].includes(readiness.status)
    || Date.parse(readiness.expiresAt)<=now.getTime() || readiness.authorizedEventCount!==events.length
    || readiness.requirementHash!==nativeSha256({companyId,requirements})
    || readiness.eventSetHash!==nativeSha256(events.toSorted((a,b)=>a.id.localeCompare(b.id)))) return result("inconclusive","DATA_NOT_READY");
  const summaries:NativeProcessObjectSummary[]=[];
  const orderedRequired=requirements.requiresOrdering,lifecycleRequired=requirements.requiresLifecycle;
  for (const objectType of definition.objectTypes) {
    const paths=new Map<string,Point[]>(),typeEvents=new Set<string>();
    for (const event of events) for (const object of event.objects) if (object.objectType===objectType) {
      const time=processTimestampMicros(event.occurredAt);if(time===null) return result("inconclusive","DATA_NOT_READY");
      const path=paths.get(object.objectId) ?? [];path.push({event,time});paths.set(object.objectId,path);typeEvents.add(event.id);
    }
    const edges=new Map<string,{from:string;to:string;count:number}>(),variants=new Map<string,{hash:string;activities:string[];objectCount:number}>();
    const cycles:number[]=[];let cancelled=0,censored=0,blocked=0,reopened=0;
    for (const [objectId,path] of paths) {
      // A tie cannot become a UUID-defined path for an ordered family.
      if (orderedRequired && new Set(path.map(point=>String(point.time))).size!==path.length) return result("inconclusive","DATA_NOT_READY");
      const ordered=path.toSorted((a,b)=>a.time<b.time ? -1 : a.time>b.time ? 1 : 0);
      const activity=ordered.map(point=>point.event.activity+(point.event.attributes.status ? `:${point.event.attributes.status}` : ""));
      if (activity.length>512 && definition.analysisFamilies.some(family=>family==="variants" || family==="directly_follows")) return result("inconclusive","RESULT_BOUND_EXCEEDED");
      if (definition.analysisFamilies.includes("directly_follows")) for(let i=1;i<activity.length;i++) {
        const key=JSON.stringify([activity[i-1],activity[i]]),edge=edges.get(key) ?? {from:activity[i-1],to:activity[i],count:0};edge.count++;edges.set(key,edge);
      }
      if (definition.analysisFamilies.includes("variants")) {
        const hash=nativeSha256(activity),variant=variants.get(hash) ?? {hash,activities:activity,objectCount:0};variant.objectCount++;variants.set(hash,variant);
      }
      // Related objects contribute observed activity paths, but cannot borrow a
      // Task's status/creation as their own lifecycle or blocked interval.
      const primary=ordered.filter(point=>point.event.objects.some(object=>object.objectType===objectType && object.objectId===objectId && object.qualifier==="primary"));
      const created=primary.find(point=>point.event.lifecycle==="created"),completed=created && primary.find(point=>point.time>=created.time && completion(point.event.attributes.status));
      if (primary.some(point=>point.event.attributes.status==="cancelled")) cancelled++;
      if (completed) cycles.push(seconds(completed.time-created!.time));
      else if (!created || !terminal(primary.findLast(point=>point.event.attributes.status)?.event.attributes.status)) censored++;
      if (lifecycleRequired && (!created || !primary.some(point=>terminal(point.event.attributes.status)))) return result("inconclusive","DATA_NOT_READY");
      if (definition.analysisFamilies.includes("blocked_time") || definition.analysisFamilies.includes("rework")) {
        if (!created?.event.attributes.status) return result("inconclusive","DATA_NOT_READY");
        let lastStatus=created.event.attributes.status,lastTime=created.time;
        for(const point of primary.filter(point=>point.time>created.time)) {
          // Metadata-only native updates do not fabricate a state transition.
          if (!point.event.attributes.status) continue;
          if (lastStatus==="blocked") blocked+=seconds(point.time-lastTime);
          if (terminal(lastStatus) && !terminal(point.event.attributes.status)) reopened++;
          lastStatus=point.event.attributes.status;lastTime=point.time;
        }
        if (!terminal(lastStatus)) return result("inconclusive","DATA_NOT_READY");
      }
    }
    if(edges.size>500 || variants.size>100) return result("inconclusive","RESULT_BOUND_EXCEEDED");
    summaries.push({objectType,objectCount:paths.size,eventCount:typeEvents.size,closedCompletionCount:lifecycleRequired ? cycles.length : null,
      cancelledCount:lifecycleRequired ? cancelled : null,censoredCount:lifecycleRequired ? censored : null,
      medianCycleSeconds:definition.analysisFamilies.includes("cycle_time") ? quantile(cycles,.5) : null,
      p90CycleSeconds:definition.analysisFamilies.includes("cycle_time") ? quantile(cycles,.9) : null,
      knownBlockedSeconds:definition.analysisFamilies.includes("blocked_time") ? blocked : null,reopenCount:definition.analysisFamilies.includes("rework") ? reopened : null,
      directlyFollows:[...edges.values()].sort((a,b)=>b.count-a.count || a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
      variants:[...variants.values()].sort((a,b)=>b.objectCount-a.objectCount || a.hash.localeCompare(b.hash))});
  }
  return result("succeeded",null,summaries);
}
