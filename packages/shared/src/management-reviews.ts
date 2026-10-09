import { z } from "zod";
import { decisionEvidenceReferenceSchema } from "./decision-intelligence.js";
import { strategyExecutionReferenceSchema } from "./strategy-execution.js";
import type { CapturedDecisionEvidence } from "./decision-intelligence.js";
import type { BusinessMetricResult } from "./business-metrics.js";
import type { BusinessMetricTargetDefinition } from "./business-metric-targets.js";
import type { DecisionOutcomeReviewView } from "./decision-outcome-reviews.js";
import type { GovernanceObligation } from "./ai-governance.js";

const key = z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/);
const instant = z.string().datetime({ offset: true });
const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const managementReviewSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("analytical"), reference: decisionEvidenceReferenceSchema }).strict(),
  z.object({ kind: z.literal("canonical"), reference: strategyExecutionReferenceSchema }).strict(),
  z.object({ kind: z.literal("decision_outcome"), decisionId: z.string().uuid(), reviewId: z.string().uuid(), revision: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("learning_cycle"), id: z.string().uuid(), expectedVersion: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("governance_obligation"), id: z.string().uuid(), contentHash: sha }).strict(),
]);
export const managementAgendaCategorySchema = z.enum(["DECISION_REQUIRED", "INVESTIGATE", "APPROVAL_REQUIRED", "AT_RISK", "NO_ACTION"]);
export const managementReviewDefinitionSchema = z.object({
  name: z.string().trim().min(3).max(200),
  reviewType: z.enum(["daily_operational", "weekly_leadership", "monthly_business", "quarterly_strategy", "ad_hoc"]),
  period: z.object({ from: instant, until: instant }).strict(),
  purpose: z.literal("management_intelligence"), sensitivity: z.enum(["internal", "confidential"]),
  retentionDays: z.number().int().min(1).max(365), governanceObligationRefs: z.array(z.string().uuid()).min(1).max(16),
  sources: z.array(z.object({ key, source: managementReviewSourceSchema }).strict()).min(1).max(20),
  // Optional preserves the exact definition/replay of pre-comparison snapshots.
  comparisons: z.array(z.object({ key, kind: z.enum(["target_actual", "metric_change"]), leftSourceKey: key, rightSourceKey: key }).strict()).max(20).optional(),
  // Human-selected order is explicit. It is not an executive-performance score.
  agenda: z.array(z.object({
    key, category: managementAgendaCategorySchema, ownerUserId: z.string().trim().min(1).max(300), dueAt: instant,
    sourceKeys: z.array(key).min(1).max(20), nextAction: z.string().trim().min(10).max(2000),
    hypothesis: z.string().trim().min(10).max(2000).nullable().default(null),
  }).strict()).min(1).max(10),
}).strict().superRefine((definition, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if (Date.parse(definition.period.from) >= Date.parse(definition.period.until) || Date.parse(definition.period.until) - Date.parse(definition.period.from) > 366 * 86400000) issue("Review period must be nonempty and at most 366 days");
  const keys = new Set(definition.sources.map((source) => source.key));
  if (keys.size !== definition.sources.length || new Set(definition.agenda.map((item) => item.key)).size !== definition.agenda.length || new Set(definition.governanceObligationRefs).size !== definition.governanceObligationRefs.length) issue("Native sources, agenda items and policy references must be unique");
  for (const item of definition.agenda) if (new Set(item.sourceKeys).size !== item.sourceKeys.length || item.sourceKeys.some((key) => !keys.has(key))) issue("Every agenda item requires distinct declared source citations");
  if (new Set(definition.comparisons?.map(item => item.key)).size !== (definition.comparisons?.length ?? 0)) issue("Comparison keys must be unique");
  const observation = (source: ManagementReviewSource | undefined) => (source?.kind === "canonical" || source?.kind === "analytical") && source.reference.type === "metric_observation";
  for (const item of definition.comparisons ?? []) {
    const left = definition.sources.find(source => source.key === item.leftSourceKey)?.source, right = definition.sources.find(source => source.key === item.rightSourceKey)?.source;
    if (!left || !right || item.leftSourceKey === item.rightSourceKey || !observation(right) || (item.kind === "metric_change" ? !observation(left) : left.kind !== "canonical" || left.reference.type !== "metric_target")) issue("Comparisons require distinct declared native target/observation citations");
  }
});
export const publishManagementReviewSchema = z.object({ expectedContentHash: sha, rationale: z.string().trim().min(10).max(2000), evidenceAndUncertaintyAcknowledged: z.literal(true), supersedesId: z.string().uuid().nullable().default(null) }).strict();
export const recordManagementReviewEventSchema = z.object({ expectedContentHash: sha, itemKey: key, event: z.enum(["opened", "ignored", "acted_on", "false_alarm", "correction"]), rationale: z.string().trim().min(10).max(2000) }).strict();
export const createManagementReviewTaskSchema = z.object({
  expectedContentHash: sha, itemKey: key, idempotencyKey: z.string().uuid(),
  title: z.string().trim().min(3).max(200), description: z.string().trim().min(10).max(4000),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  humanReviewAcknowledged: z.literal(true),
}).strict();
export type CreateManagementReviewTask = z.infer<typeof createManagementReviewTaskSchema>;
export type ManagementReviewDefinition = z.infer<typeof managementReviewDefinitionSchema>;
/** Stored on a native Routine revision; observations are resolved afresh per run. */
export const routineManagementReviewTemplateSchema = z.object({
  name: managementReviewDefinitionSchema.shape.name,
  reviewType: managementReviewDefinitionSchema.shape.reviewType,
  purpose: managementReviewDefinitionSchema.shape.purpose,
  sensitivity: managementReviewDefinitionSchema.shape.sensitivity,
  retentionDays: managementReviewDefinitionSchema.shape.retentionDays,
  governanceObligationRefs: managementReviewDefinitionSchema.shape.governanceObligationRefs,
  periodDays: z.number().int().min(1).max(366),
  sources: z.array(z.object({ key, selector: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("metric_query"), metricId: z.string().uuid(), offsetDays: z.number().int().min(0).max(366).default(0), dimensions: z.array(z.enum(["status", "project"])).max(2).default([]), maxRows: z.number().int().min(1).max(10000).default(5000) }).strict(),
    z.object({ kind: z.literal("canonical"), reference: strategyExecutionReferenceSchema.refine(ref => ["goal", "project", "milestone", "issue", "metric_target", "decision"].includes(ref.type), "Use a fresh metric selector rather than a stored analytical observation") }).strict(),
  ]) }).strict()).min(1).max(20),
  comparisons: managementReviewDefinitionSchema.shape.comparisons,
  agenda: z.array(managementReviewDefinitionSchema.shape.agenda.element.omit({ dueAt: true }).extend({ dueAfterDays: z.number().int().min(0).max(366) })).min(1).max(10),
}).strict().superRefine((value, ctx) => {
  const keys = new Set(value.sources.map(item => item.key));
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if (keys.size !== value.sources.length || value.agenda.some(item => new Set(item.sourceKeys).size !== item.sourceKeys.length || item.sourceKeys.some(key => !keys.has(key)))) issue("Every agenda citation must name a distinct declared selector");
  if (new Set(value.agenda.map(item => item.key)).size !== value.agenda.length || new Set(value.governanceObligationRefs).size !== value.governanceObligationRefs.length || new Set(value.comparisons?.map(item => item.key)).size !== (value.comparisons?.length ?? 0)) issue("Agenda, comparison and governance declarations must be unique");
  for (const comparison of value.comparisons ?? []) {
    const left = value.sources.find(item => item.key === comparison.leftSourceKey)?.selector, right = value.sources.find(item => item.key === comparison.rightSourceKey)?.selector;
    if (!left || comparison.leftSourceKey === comparison.rightSourceKey || right?.kind !== "metric_query" || (comparison.kind === "metric_change" ? left.kind !== "metric_query" : left.kind !== "canonical" || left.reference.type !== "metric_target")) issue("Comparisons require the declared native target and fresh metric selectors");
  }
});
export type RoutineManagementReviewTemplate = z.infer<typeof routineManagementReviewTemplateSchema>;
export type ManagementReviewSource = z.infer<typeof managementReviewSourceSchema>;
export const managementSourceOptionsQuerySchema = z.object({
  kind: z.enum(["foundation_section", "goal", "project", "milestone", "issue", "decision", "metric", "metric_target", "metric_observation", "decision_outcome", "learning_cycle", "governance_obligation"]),
  q: z.string().trim().max(200).optional(), parentId: z.string().uuid().optional(), expectedUserId: z.string().min(1).max(300).optional(),
}).strict();
export type ManagementSourceOptionsQuery = z.infer<typeof managementSourceOptionsQuerySchema>;
export interface ManagementSourceOptions { items: Array<{ source: ManagementReviewSource; title: string }>; coverage: "bounded_authorized_native_choices" }
export type ManagementAgendaItem = ManagementReviewDefinition["agenda"][number];
export type ManagementEvidenceGrade = "native_observation" | "native_current_state" | "predictive" | "conditional_scenario" | "human_interpreted_experiment" | "conditional_causal" | "native_outcome_review" | "native_learning_cycle";
/** Internal owner capture: public inputs provide pins only. The source owner
 * supplies facts and source hashes after current purpose/tenant/ACL admission. */
export interface CapturedManagementSource {
  key: string; source: ManagementReviewSource; sourceHash: string; capturedAt: string; expiresAt: string;
  grade: ManagementEvidenceGrade; facts: Record<string, string | number | boolean | null>; limitations: string[];
  analytical?: CapturedDecisionEvidence;
  metric?: { observation: BusinessMetricResult; unit: string; timeSemantics: string };
  target?: { id: string; versionId: string; definition: BusinessMetricTargetDefinition };
  outcome?: Omit<DecisionOutcomeReviewView, "authorizationCheckedAt">;
  governance?: { id: string; contentHash: string; obligation: GovernanceObligation };
}
export interface ManagementReviewPacket {
  engineVersion: "aw-native-management-skeleton-v1";
  definitionHash: string; inputHash: string; contentHash: string; asOf: string;
  period: ManagementReviewDefinition["period"];
  claims: Array<{ key: string; sourceKeys: string[]; grade: ManagementEvidenceGrade; facts: CapturedManagementSource["facts"]; limitations: string[] }>;
  agenda: Array<ManagementAgendaItem & { interpretation: "human_declared_agenda"; hypothesisAuthority: "human_hypothesis" | "none" }>;
  coverage: "explicit_selected_native_sources";
  limitations: string[];
  executionAuthority: "read_only_historical_review";
}
export interface ManagementReviewView {
  id: string; companyId: string; status: "draft" | "published" | "superseded";
  definition: ManagementReviewDefinition; sources: CapturedManagementSource[]; packet: ManagementReviewPacket;
  createdBy: string; createdAt: string; expiresAt: string; publishedBy: string | null; publishedAt: string | null;
  currentQualification: "current" | "needs_revalidation";
  events: Array<{ id: string; itemKey: string; event: "opened" | "ignored" | "acted_on" | "false_alarm" | "correction"; rationale: string; recordedBy: string; recordedAt: string; ordinal: number; interpretation: "human_reported_event" }>;
}
