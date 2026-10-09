import { z } from "zod";
import { businessEventPurposeSchema } from "./business-events.js";
import { NATIVE_PROCESS_ACTIVITIES, assessProcessDataSchema, type ProcessDataReadinessResult } from "./process-data-readiness.js";
import { processConformanceSchema, type NativeProcessConformanceSummary } from "./process-conformance.js";

export const NATIVE_PROCESS_ANALYSIS_FAMILIES = ["event_volume","directly_follows","variants","cycle_time","blocked_time","rework","conformance"] as const;
export const processAnalysisDefinitionSchema = z.object({
  ...businessEventPurposeSchema.shape,
  name:z.string().trim().min(3).max(160), businessQuestion:z.string().trim().min(10).max(2000),
  ownerUserId:z.string().trim().min(1).max(200), reviewFrequencyDays:z.number().int().min(1).max(3650),
  scope:z.literal("company"), sensitivity:z.literal("internal"), purpose:z.literal("process_intelligence"),
  requiredSourceProviders:assessProcessDataSchema.shape.requiredSourceProviders,
  objectTypes:assessProcessDataSchema.shape.requiredObjectTypes,
  requiredActivities:z.array(z.enum(NATIVE_PROCESS_ACTIVITIES)).min(1).max(6),
  minimumCoverageSeconds:assessProcessDataSchema.shape.minimumCoverageSeconds,
  analysisFamilies:z.array(z.enum(NATIVE_PROCESS_ANALYSIS_FAMILIES)).min(1).max(7),
  conformance:processConformanceSchema.nullable().default(null),
  cycleTimeSemantics:z.literal("first_completion_since_recorded_creation").default("first_completion_since_recorded_creation"),
  requiresArrivalEvidence:z.boolean(), maxLateArrivalRate:z.number().min(0).max(1),
}).strict().refine(value => new Set(value.objectTypes).size===value.objectTypes.length && new Set(value.requiredSourceProviders).size===value.requiredSourceProviders.length
  && new Set(value.requiredActivities).size===value.requiredActivities.length && new Set(value.analysisFamilies).size===value.analysisFamilies.length,"Definition identities cannot repeat")
  .superRefine((value,ctx)=>{
    if(value.analysisFamilies.includes("conformance") !== (value.conformance!==null))
      ctx.addIssue({code:"custom",message:"Conformance requires an explicit typed expectation and the selected analysis family"});
    if(value.conformance && (new Set(value.conformance.expectations.map(model=>model.objectType)).size!==value.objectTypes.length
      || value.conformance.expectations.length!==value.objectTypes.length || value.objectTypes.some(type=>!value.conformance!.expectations.some(model=>model.objectType===type))))
      ctx.addIssue({code:"custom",message:"Every selected object perspective requires exactly one typed conformance model"});
  });
export type ProcessAnalysisDefinition=z.infer<typeof processAnalysisDefinitionSchema>;
const revision=z.number().int().min(1);
export const createProcessAnalysisDefinitionSchema=z.object({key:z.string().trim().regex(/^[a-z][a-z0-9_-]{2,99}$/),definition:processAnalysisDefinitionSchema}).strict();
export const reviseProcessAnalysisDefinitionSchema=z.object({expectedRevision:revision,definition:processAnalysisDefinitionSchema}).strict();
export const publishProcessAnalysisDefinitionSchema=z.object({expectedRevision:revision,versionId:z.string().uuid(),rationale:z.string().trim().min(10).max(2000)}).strict();
export const retireProcessAnalysisDefinitionSchema=z.object({expectedRevision:revision,rationale:z.string().trim().min(10).max(2000)}).strict();
export type CreateProcessAnalysisDefinition=z.infer<typeof createProcessAnalysisDefinitionSchema>;
export type ReviseProcessAnalysisDefinition=z.infer<typeof reviseProcessAnalysisDefinitionSchema>;
export type PublishProcessAnalysisDefinition=z.infer<typeof publishProcessAnalysisDefinitionSchema>;
export type RetireProcessAnalysisDefinition=z.infer<typeof retireProcessAnalysisDefinitionSchema>;
export const runProcessAnalysisSchema=z.object({versionId:z.string().uuid(),from:assessProcessDataSchema.shape.from,until:assessProcessDataSchema.shape.until}).strict()
  .refine(value => Date.parse(value.from)<Date.parse(value.until),"A nonempty process window is required")
  .refine(value => Date.parse(value.until)-Date.parse(value.from)<=3650*86400000,"Native process windows are bounded to ten years");
export type RunProcessAnalysis=z.infer<typeof runProcessAnalysisSchema>;
export interface ProcessAnalysisVersionView {
  id:string;companyId:string;definitionId:string;revision:number;definition:ProcessAnalysisDefinition;contentHash:string;
  createdAt:string;nextReviewAt:string;expiresAt:string;
}
export interface ProcessAnalysisDefinitionView {
  id:string;companyId:string;key:string;revision:number;status:"draft"|"published"|"retired"|"needs_review";publishedVersionId:string|null;createdAt:string;updatedAt:string;
}
export interface ProcessAnalysisDefinitionDetail {
  root:ProcessAnalysisDefinitionView;effectiveVersion:ProcessAnalysisVersionView;latestVersion:ProcessAnalysisVersionView;
  versions:ProcessAnalysisVersionView[];hasMoreVersions:boolean;reviewReason:string|null;
}
export interface NativeProcessObjectSummary {
  objectType:"issue"|"project";objectCount:number;eventCount:number;closedCompletionCount:number|null;cancelledCount:number|null;censoredCount:number|null;
  medianCycleSeconds:number|null;p90CycleSeconds:number|null;knownBlockedSeconds:number|null;reopenCount:number|null;
  directlyFollows:{from:string;to:string;count:number}[];
  variants:{hash:string;activities:string[];objectCount:number}[];
  conformance?:NativeProcessConformanceSummary|null;
}
export interface NativeProcessAnalysisResult {
  engineVersion:string;status:"succeeded"|"inconclusive";errorCode:"DATA_NOT_READY"|"RESULT_BOUND_EXCEEDED"|null;
  readiness:ProcessDataReadinessResult;objectSummaries:NativeProcessObjectSummary[];
  semantics:"observed_native_activity_paths_no_causal_or_person_effect";
}
export interface ProcessAnalysisRunView {
  id:string;companyId:string;definitionId:string;versionId:string;lineageManifestId:string;definitionHash:string;eventSetHash:string;
  from:string;until:string;createdAt:string;expiresAt:string;authorizationCheckedAt:string;result:NativeProcessAnalysisResult;
}
