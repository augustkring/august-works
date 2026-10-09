import { z } from "zod";
import type { BusinessExperimentAnalysisView, BusinessExperimentDefinition } from "./business-experiments.js";
import type { CausalAnalysisRunView, CausalClaimDefinition } from "./causal-claims.js";

const prose=z.string().trim().min(10).max(2000),key=z.string().regex(/^[a-z][a-z0-9_-]{1,79}$/),id=z.string().uuid();
const scope=z.discriminatedUnion("type",[
  z.object({type:z.literal("company"),id:z.null()}).strict(),
  z.object({type:z.literal("project"),id}).strict(),z.object({type:z.literal("issue"),id}).strict(),
]);
export const experimentAnalysisEvidenceReferenceSchema=z.object({type:z.literal("experiment_analysis"),id,experimentId:id,versionId:id,interpretationId:id}).strict();
export const causalAnalysisEvidenceReferenceSchema=z.object({type:z.literal("causal_analysis"),id,claimId:id,versionId:id,reviewId:id}).strict();
export type CausalAnalysisEvidenceReference=z.infer<typeof causalAnalysisEvidenceReferenceSchema>;
export const decisionEvidenceReferenceSchema=z.discriminatedUnion("type",[
  z.object({type:z.literal("metric_observation"),id,metricId:id,metricVersionId:id}).strict(),
  z.object({type:z.literal("process_finding"),id,definitionId:id,runId:id}).strict(),
  z.object({type:z.literal("forecast_run"),id,specId:id,versionId:id,pointIndex:z.number().int().min(0).max(59)}).strict(),
  z.object({type:z.literal("scenario_run"),id,scenarioId:id,versionId:id,caseKey:z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),outputKey:z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)}).strict(),
  experimentAnalysisEvidenceReferenceSchema,
  causalAnalysisEvidenceReferenceSchema,
]);
const evidence=z.object({key,source:decisionEvidenceReferenceSchema,
  relationship:z.enum(["supports_option","contradicts_option","informs_criterion","establishes_constraint","metric_observation","process_finding","forecast_result","scenario_result","experiment_result","causal_result","risk"]),
  optionId:z.string().trim().min(1).max(120).nullable(),criterionKey:key.nullable(),rationale:prose,
}).strict().superRefine((value,ctx)=>{
  if(["supports_option","contradicts_option"].includes(value.relationship)!==(value.optionId!==null))
    ctx.addIssue({code:"custom",message:"Option evidence requires exactly its declared option"});
  if((value.relationship==="informs_criterion")!==(value.criterionKey!==null))
    ctx.addIssue({code:"custom",message:"Criterion evidence requires exactly its declared criterion"});
  if(value.relationship==="metric_observation" && value.source.type!=="metric_observation" || value.relationship==="process_finding" && value.source.type!=="process_finding")
    ctx.addIssue({code:"custom",message:"Evidence relationship and native source type differ"});
});
const assumption=z.object({key,statement:prose,type:z.enum(["factual","model","delivery","financial","strategic"]),
  confidence:z.object({kind:z.literal("human_judgment"),level:z.enum(["low","medium","high"])}).strict(),
  materiality:z.enum(["low","medium","high"]),status:z.literal("unverified"),
}).strict();
const criterion=z.object({key,name:z.string().trim().min(3).max(160),description:prose,
  type:z.enum(["qualitative","constraint","trade_off","measured"]),priority:z.enum(["low","medium","high"]),
  evidenceKey:key.nullable(),
}).strict().refine(value=>value.type!=="measured" || value.evidenceKey!==null,"A measured criterion needs pinned observation evidence");
const range=z.object({lower:z.number().finite(),upper:z.number().finite()}).strict().refine(value=>value.lower<=value.upper,"Expected range is ordered");
const expectation=z.discriminatedUnion("kind",[
  z.object({kind:z.literal("qualitative"),optionId:z.string().trim().min(1).max(120),statement:prose,reviewAt:z.iso.datetime(),uncertaintySummary:prose}).strict(),
  z.object({kind:z.literal("metric"),optionId:z.string().trim().min(1).max(120),evidenceKey:key,expectedRange:range,
    expectedDirection:z.enum(["increase","decrease","stable"]).nullable(),reviewAt:z.iso.datetime(),uncertaintySummary:prose}).strict(),
]);
export const decisionContextDefinitionSchema=z.object({
  question:prose,objective:prose,ownerUserId:z.string().trim().min(1).max(200),scope,
  timeHorizon:z.object({from:z.iso.datetime(),until:z.iso.datetime()}).strict(),uncertaintySummary:prose,revisitAt:z.iso.datetime().nullable(),
  sensitivity:z.enum(["internal","confidential"]),purpose:z.literal("management_intelligence"),
  governanceObligationRefs:z.array(id).min(1).max(16),retentionDays:z.number().int().min(1).max(3650),
  evidence:z.array(evidence).max(20),assumptions:z.array(assumption).max(20),criteria:z.array(criterion).min(1).max(20),
  expectedOutcomes:z.array(expectation).min(1).max(16),
}).strict().superRefine((value,ctx)=>{
  const reject=(message:string)=>ctx.addIssue({code:"custom",message});
  for(const items of [value.evidence,value.assumptions,value.criteria]) if(new Set(items.map(item=>item.key)).size!==items.length) reject("Material context keys cannot repeat");
  if(new Set(value.governanceObligationRefs).size!==value.governanceObligationRefs.length) reject("Purpose references cannot repeat");
  if(Date.parse(value.timeHorizon.from)>=Date.parse(value.timeHorizon.until)) reject("A nonempty explicit time horizon is required");
  if(value.expectedOutcomes.some(item=>Date.parse(item.reviewAt)<Date.parse(value.timeHorizon.until))) reject("Final outcome review cannot precede the declared horizon");
  const links=new Map(value.evidence.map(item=>[item.key,item])),criteria=new Set(value.criteria.map(item=>item.key));
  for(const item of value.evidence) if(item.criterionKey && !criteria.has(item.criterionKey)) reject("Evidence must refer to a declared criterion");
  for(const item of value.criteria) if(item.evidenceKey && (!links.has(item.evidenceKey) || item.type==="measured" && links.get(item.evidenceKey)!.source.type!=="metric_observation")) reject("Criteria require declared evidence of the appropriate native type");
  for(const item of value.expectedOutcomes) if(item.kind==="metric" && links.get(item.evidenceKey)?.source.type!=="metric_observation") reject("Metric expectations require a pinned native observation link");
});
export type DecisionContextDefinition=z.infer<typeof decisionContextDefinitionSchema>;
export type DecisionEvidenceReference=z.infer<typeof decisionEvidenceReferenceSchema>;
export const proposeDecisionContextSchema=z.object({expectedRevision:z.number().int().min(0),definition:decisionContextDefinitionSchema}).strict();
export const prepareDecisionContextSchema=z.object({expectedRevision:z.number().int().positive(),versionId:id,rationale:prose}).strict();
export const withdrawPreparedDecisionContextSchema=z.object({expectedRevision:z.number().int().positive(),rationale:prose}).strict();
export type ProposeDecisionContext=z.infer<typeof proposeDecisionContextSchema>;
export type PrepareDecisionContext=z.infer<typeof prepareDecisionContextSchema>;
export type WithdrawPreparedDecisionContext=z.infer<typeof withdrawPreparedDecisionContextSchema>;
/** Server-owned historical facts. Public proposal inputs contain source pins,
 * never copied values, source hashes, confidence probabilities or capture times. */
export interface CapturedDecisionEvidence {
  key:string;source:DecisionEvidenceReference;sourceHash:string;capturedAt:string;expiresAt:string;
  facts:Record<string,string|number|null>;limitations:string[];
  causal?: {definition:CausalClaimDefinition;run:CausalAnalysisRunView;review:{id:string;versionId:string;rationale:string;reviewedBy:string;reviewedAt:string;receiptHash:string}};
  experiment?: {
    analysis:BusinessExperimentAnalysisView;
    registeredMetrics:Pick<BusinessExperimentDefinition,"primaryMetric"|"guardrailMetrics"|"secondaryMetrics"|"diagnostics">;
    interpretation:{id:string;analysisId:string;conclusion:"ship_candidate"|"do_not_ship"|"iterate"|"abstain";rationale:string;executionAuthority:"advisory_only";receiptHash:string;interpretedBy:string;interpretedAt:string};
  };
}
export interface DecisionContextVersionView {
  id:string;companyId:string;decisionId:string;revision:number;definition:DecisionContextDefinition;contentHash:string;decisionSpecHash:string;
  evidence:CapturedDecisionEvidence[];createdAt:string;expiresAt:string;state:"draft"|"frozen_for_decision"|"superseded";
  revalidationRequiredEvidenceKeys?:string[];
}
export interface DecisionContextBindingView {
  versionId:string;optionId:string;contextHash:string;decisionSpecHash:string;frozenAt:string;
}
export interface DecisionContextView {
  companyId:string;decisionId:string;revision:number;preparedVersionId:string|null;binding:DecisionContextBindingView|null;
  versions:DecisionContextVersionView[];hasMoreVersions:boolean;authorizationCheckedAt:string;
}
