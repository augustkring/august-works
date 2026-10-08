import { z } from "zod";
import { experimentAnalysisEvidenceReferenceSchema } from "./decision-intelligence.js";
import type { BusinessExperimentAnalysisView, BusinessExperimentDefinition } from "./business-experiments.js";
const id=z.string().uuid(),key=z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),prose=z.string().trim().min(10).max(2000);
export const causalExperimentReferenceSchema=experimentAnalysisEvidenceReferenceSchema;
export const causalGraphSchema=z.object({
  nodes:z.array(z.object({key,label:z.string().trim().min(3).max(120),role:z.enum(["randomized_assignment","outcome","pretreatment","unobserved","context"])}).strict()).min(2).max(16),
  edges:z.array(z.object({from:key,to:key,authority:z.literal("human_assumption"),rationale:prose}).strict()).min(1).max(32),
}).strict().superRefine((graph,ctx)=>{
  const reject=(message:string)=>ctx.addIssue({code:"custom",message});
  const nodes=new Set(graph.nodes.map(n=>n.key)),pairs=new Set<string>(),outgoing=new Map<string,string[]>();
  if(nodes.size!==graph.nodes.length)reject("Graph nodes cannot repeat");
  if(graph.nodes.filter(n=>n.role==="randomized_assignment").length!==1||graph.nodes.filter(n=>n.role==="outcome").length!==1)reject("Graph needs exactly one assignment and one outcome node");
  for(const edge of graph.edges){const pair=`${edge.from}:${edge.to}`;if(!nodes.has(edge.from)||!nodes.has(edge.to)||edge.from===edge.to||pairs.has(pair))reject("Graph edges require distinct declared nodes and cannot repeat");pairs.add(pair);outgoing.set(edge.from,[...(outgoing.get(edge.from)??[]),edge.to]);}
  const visiting=new Set<string>(),done=new Set<string>();
  function visit(node:string):boolean{if(visiting.has(node))return false;if(done.has(node))return true;visiting.add(node);for(const next of outgoing.get(node)??[])if(!visit(next))return false;visiting.delete(node);done.add(node);return true;}
  if([...nodes].some(node=>!visit(node)))reject("Human causal graph must be acyclic");
});
const assumption=z.object({status:z.enum(["assumed","unknown","violated"]),rationale:prose}).strict();
export const doWhyCausalProfileSchema=z.object({provider:z.literal("dowhy"),version:z.literal("0.14"),python:z.literal("3.12.14"),bundleHash:z.string().regex(/^[a-f0-9]{64}$/),conformanceHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type DoWhyCausalProfile=z.infer<typeof doWhyCausalProfileSchema>;
export const doWhyCausalDiagnosticsSchema=z.object({provider:z.literal("dowhy"),version:z.literal("0.14"),python:z.literal("3.12.14"),bundleHash:z.string().regex(/^[a-f0-9]{64}$/),method:z.literal("backdoor.linear_regression"),identification:z.literal("identified_under_registered_randomization"),adjustmentSet:z.array(z.never()).length(0),effect:z.number().finite().min(-1.001).max(1.001),representation:z.literal("anonymous_binary_sufficient_counts"),simulations:z.literal(16),seed:z.literal(1729),refutations:z.array(z.object({method:z.enum(["random_common_cause","placebo_treatment_refuter","data_subset_refuter"]),effect:z.number().finite().min(-1.001).max(1.001),pValue:z.number().finite().min(0).max(1).nullable(),status:z.enum(["passed","failed","unknown"])}).strict()).length(3),sensitivity:z.literal("unknown"),uncertainty:z.literal("native_registered_interval_required")}).strict().superRefine((value,ctx)=>{
 const methods=["random_common_cause","placebo_treatment_refuter","data_subset_refuter"];
 if(value.refutations.some((item,index)=>item.method!==methods[index]||item.status!==(item.pValue===null?"unknown":item.pValue<0.05?"failed":"passed")))ctx.addIssue({code:"custom",message:"Refutation methods and numerical diagnostic statuses must agree"});
});
export type DoWhyCausalDiagnostics=z.infer<typeof doWhyCausalDiagnosticsSchema>;
export const causalClaimDefinitionSchema=z.object({
  providerProfile:doWhyCausalProfileSchema.optional(),
  name:z.string().trim().min(3).max(160),question:prose,humanHypothesis:prose,ownerUserId:z.string().trim().min(1).max(200),
  outcomeMetricId:id,outcomeMetricVersionId:id,
  population:z.object({scope:z.discriminatedUnion("type",[z.object({type:z.literal("company"),id:z.null()}).strict(),z.object({type:z.literal("project"),id}).strict()]),unit:z.enum(["issue","project"]),eligibilityStatement:prose,externalValidityLimits:prose}).strict(),
  horizon:z.object({from:z.iso.datetime(),until:z.iso.datetime()}).strict(),
  estimand:z.object({kind:z.literal("assignment_intention_to_treat_native_binary_outcome"),beneficialDirection:z.enum(["increase","decrease"]),minimumMeaningfulEffect:z.number().finite().min(0).max(1)}).strict(),
  identificationStrategy:z.enum(["registered_randomized_assignment","backdoor_adjustment","instrumental_variables","regression_discontinuity","difference_in_differences","association_only"]),
  graph:causalGraphSchema,
  assumptions:z.object({noInterference:assumption,stableOutcomeMeasurement:assumption,registeredPopulationValidity:assumption}).strict(),
  experimentEvidence:causalExperimentReferenceSchema.nullable(),
  interpretationBoundary:z.literal("conditional_native_proxy_advisory_only"),
  purpose:z.literal("management_intelligence"),sensitivity:z.enum(["internal","confidential"]),governanceObligationRefs:z.array(id).min(1).max(16),retentionDays:z.number().int().min(1).max(3650),
}).strict().superRefine((value,ctx)=>{
  if(value.providerProfile&&(value.identificationStrategy!=="registered_randomized_assignment"||!value.experimentEvidence||value.graph.nodes.length!==2||value.graph.edges.length!==1||value.graph.nodes.find(n=>n.role==="randomized_assignment")?.key!==value.graph.edges[0].from||value.graph.nodes.find(n=>n.role==="outcome")?.key!==value.graph.edges[0].to))ctx.addIssue({code:"custom",message:"DoWhy requires the qualified fixed registered assignment-to-outcome model"});
  if(Date.parse(value.horizon.from)>=Date.parse(value.horizon.until))ctx.addIssue({code:"custom",message:"Causal horizon must be ordered"});
  if(new Set(value.governanceObligationRefs).size!==value.governanceObligationRefs.length)ctx.addIssue({code:"custom",message:"Purpose pins cannot repeat"});
});
export type CausalClaimDefinition=z.infer<typeof causalClaimDefinitionSchema>;
export type CausalExperimentReference=z.infer<typeof causalExperimentReferenceSchema>;
export const createCausalClaimSchema=z.object({key,definition:causalClaimDefinitionSchema}).strict();
export const reviseCausalClaimSchema=z.object({expectedRevision:z.number().int().positive(),definition:causalClaimDefinitionSchema,rationale:prose}).strict();
export const reviewCausalClaimSchema=z.object({expectedRevision:z.number().int().positive(),versionId:id,rationale:prose,graphAndAssumptionsAcknowledged:z.literal(true)}).strict();
export const analyzeCausalClaimSchema=z.object({expectedRevision:z.number().int().positive(),versionId:id}).strict();
export const revokeCausalClaimSchema=z.object({expectedRevision:z.number().int().positive(),rationale:prose}).strict();
export type CreateCausalClaim=z.infer<typeof createCausalClaimSchema>;
export type ReviseCausalClaim=z.infer<typeof reviseCausalClaimSchema>;
export type ReviewCausalClaim=z.infer<typeof reviewCausalClaimSchema>;
export type AnalyzeCausalClaim=z.infer<typeof analyzeCausalClaimSchema>;
export type RevokeCausalClaim=z.infer<typeof revokeCausalClaimSchema>;
export type CausalEvidenceGrade="randomized_experiment"|"quasi_experiment"|"natural_experiment"|"observational_adjusted"|"observational_association"|"descriptive_only";
export type CausalClaimStatus="hypothesis"|"association"|"supported"|"refuted"|"inconclusive"|"expired"|"revoked";
export interface NativeCausalSource {
  analysis:BusinessExperimentAnalysisView;
  definition:BusinessExperimentDefinition;
  sourceHash:string;interpretationId:string;
}
export interface NativeCausalResult {
  engineVersion:"aw-native-causal-registered-primary-v1";definitionHash:string;inputHash:string;
  evidenceGrade:CausalEvidenceGrade;status:"supported"|"refuted"|"inconclusive";
  stages:readonly ["question","human_model_and_assumptions","identification","estimation_or_abstention","robustness","conditional_interpretation"];
  identification:{status:"conditional_identified"|"unsupported"|"assumptions_not_admitted"|"source_not_qualified";strategy:CausalClaimDefinition["identificationStrategy"];conditions:string[]};
  estimate:{effect:number;interval:{lower:number;upper:number;method:"bonferroni_clopper_pearson_difference_v1";familywiseCoverage:number};unit:"fraction_difference";estimand:"assignment_intention_to_treat_native_binary_outcome";derivedFromRegisteredAnalysis:true}|null;
  robustness:{assignmentRatio:"passed"|"failed"|"unavailable";registeredBaselineBalance:"passed"|"failed"|"unavailable";completeOutcomeAndExposureReceipts:"passed"|"failed"|"unavailable";guardrails:"excluded_within_registered_bounds"|"harm_detected"|"uncertain"|"unavailable";assumptions:"human_assumed"|"unknown_or_violated";sensitivity:"unknown";providerRefutations:"not_run"|"passed"|"failed"|"unknown"};
  providerAnalysis?:{profile:DoWhyCausalProfile;nativeResultHash:string;diagnostics:DoWhyCausalDiagnostics};
  language:"conditional_assignment_effect_on_native_proxy"|"causal_reliance_withheld";
  limitations:string[];reasons:string[];executionAuthority:"advisory_only";
}
export interface CausalClaimView {id:string;companyId:string;key:string;revision:number;status:CausalClaimStatus;currentVersionId:string|null;reviewedVersionId:string|null;latestRunId:string|null;createdAt:string;updatedAt:string}
export interface CausalClaimVersionView {id:string;companyId:string;claimId:string;revision:number;definition:CausalClaimDefinition;contentHash:string;sourceHash:string|null;createdAt:string;expiresAt:string;currentQualification:"current"|"needs_revalidation"}
export interface CausalAnalysisRunView {id:string;companyId:string;claimId:string;versionId:string;providerKey:"aw_native_registered_randomization"|"dowhy";providerVersion:"1"|"0.14";methodKey:"registered_primary_itt"|"backdoor.linear_regression";analysisPlanHash:string;assumptionsSnapshotHash:string;sourceHash:string|null;result:NativeCausalResult;receiptHash:string;startedAt:string;completedAt:string;currentQualification:"current"|"needs_revalidation"}
