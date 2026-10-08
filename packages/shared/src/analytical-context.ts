import {z} from "zod";
import {decisionEvidenceReferenceSchema} from "./decision-intelligence.js";
const id=z.string().uuid();
/** Internal native provenance. Source identifiers never grant access. */
export const analyticalContextAuthorityPinSchema=z.discriminatedUnion("kind",[
 z.object({kind:z.literal("analytical_evidence"),source:decisionEvidenceReferenceSchema}).strict(),
 z.object({kind:z.literal("process_run"),definitionId:id,runId:id}).strict(),
 z.object({kind:z.literal("decision_context"),decisionId:id,versionId:id}).strict(),
 z.object({kind:z.literal("outcome_review"),decisionId:id,revision:z.number().int().positive()}).strict(),
 z.object({kind:z.literal("metric_definition"),metricId:id,versionId:id,manifestId:id}).strict(),
 z.object({kind:z.literal("planning_outcome"),projectId:id,proposalId:id,manifestId:id}).strict(),
 z.object({kind:z.literal("forecast_specification"),specId:id,versionId:id}).strict(),
]);
export type AnalyticalContextAuthorityPin=z.infer<typeof analyticalContextAuthorityPinSchema>;
