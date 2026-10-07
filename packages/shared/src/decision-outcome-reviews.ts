import {z} from "zod";
import {decisionEvidenceReferenceSchema,type CapturedDecisionEvidence} from "./decision-intelligence.js";

const prose=z.string().trim().min(10).max(2000),key=z.string().regex(/^[a-z][a-z0-9_-]{1,79}$/);
const revision=z.number().int().positive();
const citations=z.array(z.string().regex(/^(baseline|actual):[a-z][a-z0-9_-]{1,79}$|^native_execution$/)).max(40);
const judgment=z.object({kind:z.literal("human_judgment"),assessment:z.enum(["supported","mixed","not_supported","unknown"]),explanation:prose,evidenceKeys:citations}).strict();
export const decisionReviewAssessmentsSchema=z.object({
  decisionProcessQuality:judgment,assumptionAccuracy:judgment,executionFidelity:judgment,externalChange:judgment,observedOutcome:judgment,
  causalConfidence:z.object({assessment:z.enum(["association_only","not_assessed"]),explanation:prose}).strict(),
}).strict();
export const scheduleDecisionOutcomeReviewSchema=z.object({contextVersionId:z.string().uuid(),rationale:prose}).strict();
export const transitionDecisionOutcomeReviewSchema=z.object({expectedRevision:revision,action:z.enum(["begin","cancel"]),rationale:prose}).strict();
export const finishDecisionOutcomeReviewSchema=z.object({
  expectedRevision:revision,result:z.enum(["completed","inconclusive"]),lessonSummary:prose,assessments:decisionReviewAssessmentsSchema,
  actualMetrics:z.array(z.object({key,source:decisionEvidenceReferenceSchema.refine(value=>value.type==="metric_observation","Outcome measurement requires a native metric observation")}).strict()).max(20),
  metricOutcomes:z.array(z.object({expectationIndex:z.number().int().min(0).max(15),actualEvidenceKey:key}).strict()).max(16),
  qualitativeOutcomes:z.array(z.object({expectationIndex:z.number().int().min(0).max(15),kind:z.literal("human_judgment"),assessment:z.enum(["met","not_met","inconclusive"]),explanation:prose,evidenceKeys:citations}).strict()).max(16),
  assumptionOutcomes:z.array(z.object({key,kind:z.literal("human_judgment"),assessment:z.enum(["supported","contradicted","inconclusive"]),explanation:prose,evidenceKeys:citations}).strict()).max(20),
}).strict().superRefine((value,ctx)=>{
  const reject=(message:string)=>ctx.addIssue({code:"custom",message});
  if(new Set(value.actualMetrics.map(item=>item.key)).size!==value.actualMetrics.length) reject("Actual observation keys cannot repeat");
  if(new Set([...value.metricOutcomes,...value.qualitativeOutcomes].map(item=>item.expectationIndex)).size!==value.metricOutcomes.length+value.qualitativeOutcomes.length) reject("Each expectation has exactly one outcome assessment");
  if(new Set(value.assumptionOutcomes.map(item=>item.key)).size!==value.assumptionOutcomes.length) reject("Assumption outcomes cannot repeat");
  if(value.metricOutcomes.some(item=>!value.actualMetrics.some(actual=>actual.key===item.actualEvidenceKey))) reject("Comparison requires a declared actual observation pin");
});
export type ScheduleDecisionOutcomeReview=z.infer<typeof scheduleDecisionOutcomeReviewSchema>;
export type TransitionDecisionOutcomeReview=z.infer<typeof transitionDecisionOutcomeReviewSchema>;
export type FinishDecisionOutcomeReview=z.infer<typeof finishDecisionOutcomeReviewSchema>;
export type DecisionReviewAssessments=z.infer<typeof decisionReviewAssessmentsSchema>;
export type DecisionOutcomeReviewState="scheduled"|"due"|"in_review"|"completed"|"inconclusive"|"cancelled";
export interface DecisionMetricComparison {
  expectationIndex:number;baselineEvidenceKey:string;actualEvidenceKey:string;metricId:string;metricVersionId:string;unit:string;
  baselineValue:number|null;actualValue:number|null;expectedRange:{lower:number;upper:number};
  rangePosition:"below"|"within"|"above"|"unavailable";observedDirection:"increase"|"decrease"|"stable"|"unavailable";
  expectedDirection:"increase"|"decrease"|"stable"|null;limitations:string[];
}
export interface DecisionOutcomeReviewReceipt {
  revision:number;action:"schedule"|"begin"|"cancel"|"finish";fromState:Exclude<DecisionOutcomeReviewState,"due">|null;toState:Exclude<DecisionOutcomeReviewState,"due">;
  rationale:string;recordedBy:string;recordedAt:string;contextHash:string;contentHash:string;
  assessment:FinishDecisionOutcomeReview|null;actualEvidence:CapturedDecisionEvidence[];comparisons:DecisionMetricComparison[];
  nativeExecution:{status:string|null;capturedAt:string}|null;expiresAt:string;
}
export interface DecisionOutcomeReviewView {
  id:string;companyId:string;decisionId:string;contextVersionId:string;contextHash:string;optionId:string;revision:number;
  status:DecisionOutcomeReviewState;reviewDueAt:string;reviewedAt:string|null;reviewedByUserId:string|null;
  receipts:DecisionOutcomeReviewReceipt[];causalClaimRef:null;learningCycleId:null;authorizationCheckedAt:string;
}
