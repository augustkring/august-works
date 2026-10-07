import {z} from "zod";
import {queryBusinessMetricSchema} from "./business-metrics.js";
import {runProcessAnalysisSchema} from "./process-analysis.js";
import {decisionEvidenceReferenceSchema,experimentAnalysisEvidenceReferenceSchema} from "./decision-intelligence.js";
const id=z.string().uuid();
const metric=z.object({type:z.literal("metric_observation"),id,metricId:id,metricVersionId:id}).strict();
const scenario=z.object({type:z.literal("scenario_run"),id,scenarioId:id,versionId:id,caseKey:z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),outputKey:z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)}).strict();
/** First-party tool arguments contain bounded native pins, never identities,
 * copied measurements, SQL, authorization flags or approval decisions. */
export const managementChatToolSchemas={
 list_business_metrics:z.object({cursor:id.optional(),limit:z.number().int().min(1).max(20).default(5)}).strict(),
 list_forecasts:z.object({cursor:id.optional(),limit:z.number().int().min(1).max(20).default(5)}).strict(),
 query_business_metric:queryBusinessMetricSchema,
 compare_business_metrics:z.object({before:metric,after:metric}).strict().refine(v=>v.before.id!==v.after.id,"Two distinct observations are required"),
 explain_metric_lineage:z.object({source:metric}).strict(),
 list_process_findings:z.object({definitionId:id,runId:id,cursor:id.optional(),limit:z.number().int().min(1).max(20).default(20)}).strict(),
 analyze_process_scope:z.object({definitionId:id,analysis:runProcessAnalysisSchema}).strict(),
 get_decision_context:z.object({decisionId:id,versionId:id}).strict(),
 review_decision_outcome:z.object({decisionId:id,revision:z.number().int().positive()}).strict(),
 compare_scenarios:z.object({sources:z.array(scenario).min(2).max(4)}).strict(),
 get_experiment_result:z.object({source:experimentAnalysisEvidenceReferenceSchema}).strict(),
 propose_management_action:z.object({action:z.enum(["investigate","prepare_decision","propose_experiment","replan_project"]),rationale:z.string().trim().min(10).max(2000),sources:z.array(decisionEvidenceReferenceSchema).min(1).max(8)}).strict(),
};
export type ManagementChatToolName=keyof typeof managementChatToolSchemas;
