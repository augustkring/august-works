import { z } from "zod";
import { businessExperimentDefinitionSchema, BUSINESS_EXPERIMENT_STATES } from "./business-experiments.js";

const id = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), time = z.iso.datetime({ offset: true });
const qualification = z.enum(["current", "needs_revalidation"]), count = z.number().int().min(0).max(4000), proportion = z.number().finite().min(0).max(1);
const root = z.object({ id, companyId: id, revision: z.number().int().positive(), state: z.enum(BUSINESS_EXPERIMENT_STATES), currentVersionId: id.nullable() });
const version = z.object({ id, companyId: id, experimentId: id, contentHash: hash, expiresAt: time, currentQualification: qualification, definition: businessExperimentDefinitionSchema });
export const insightExperimentPageSchema = z.object({ items: z.array(z.object({ experiment: root, version })).max(20), nextCursor: id.nullable(), coverage: z.literal("bounded_current_authorized_page") });
export const insightExperimentDetailSchema = z.object({ experiment: root, versions: z.array(version).max(5), coverage: z.literal("bounded_recent_versions_and_transitions") });
const arm = z.object({ units: count, successes: count, rate: proportion }).refine(value => value.successes <= value.units);
const metric = z.object({ key: z.string().min(1).max(64), role: z.enum(["primary", "guardrail", "exploratory"]), control: arm, treatment: arm,
  effect: z.number().finite().min(-1).max(1), interval: z.object({ lower: z.number().finite().min(-1).max(1), upper: z.number().finite().min(-1).max(1),
    method: z.literal("bonferroni_clopper_pearson_difference_v1"), familywiseCoverage: proportion }).refine(value => value.lower <= value.upper).nullable(),
  interpretation: z.enum(["threshold_met", "threshold_not_met", "harm_excluded", "harm_detected", "uncertain", "exploratory"]) });
const analysis = z.object({ id, companyId: id, experimentId: id, versionId: id, definitionHash: hash,
  qualityGates: z.object({ assignmentReceipts: z.boolean(), exposureReports: z.boolean(), finalOutcomeCapture: z.enum(["complete", "incomplete", "not_required_nonconfirmatory_stop"]), identityJoins: z.boolean(), baselineBalance: z.boolean(), concurrentReviewAdmitted: z.boolean() }),
  result: z.object({ engineVersion: z.literal("aw-native-business-experiment-v1"), definitionHash: hash, inputHash: hash,
    status: z.enum(["pass", "fail", "inconclusive", "invalid"]), numericallyQualified: z.boolean(), reasons: z.array(z.string().max(2000)).max(64),
    diagnostics: z.object({ assigned: count, control: count, treatment: count, exposed: count }), metrics: z.array(metric).max(17), limitations: z.array(z.string().max(2000)).max(64) }),
  causalAuthority: z.enum(["conditional_on_registered_randomization_and_human_attestations", "withheld"]),
  exposureProvenance: z.literal("human_attestation"), outcomeTimeSemantics: z.literal("created_in_window_current_state_at_common_final_capture"),
  analyzedAt: time, receiptHash: hash, currentQualification: qualification });
export const insightExperimentSummarySchema = z.object({ companyId: id, experimentId: id, versionId: id, definitionHash: hash, expiresAt: time,
  currentQualification: qualification, analysis: analysis.nullable(), interpretation: z.object({ analysisId: id, conclusion: z.enum(["ship_candidate", "do_not_ship", "iterate", "abstain"]),
    rationale: z.string().min(10).max(2000), executionAuthority: z.literal("advisory_only"), interpretedAt: time, receiptHash: hash }).nullable() });
export interface InsightExperimentResult { experimentId: string; state: z.infer<typeof root>["state"]; definition: z.infer<typeof businessExperimentDefinitionSchema>;
  expiresAt: string; currentQualification: z.infer<typeof qualification>; summary: z.infer<typeof insightExperimentSummarySchema>; }
export interface InsightExperimentResultPage { items: InsightExperimentResult[]; hasMoreExperiments: boolean; boundedPage: true; }
