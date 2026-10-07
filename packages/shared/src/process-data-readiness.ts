import { z } from "zod";
import { businessEventPurposeSchema } from "./business-events.js";

export const PROCESS_DATA_DIMENSIONS = [
  "source_coverage", "activity_completeness", "timestamp_completeness", "timestamp_plausibility",
  "stable_object_identity", "object_link_completeness", "referential_integrity", "lifecycle_completeness",
  "duplicate_rate", "late_arrival_rate", "ordering_ambiguity", "clock_timezone_ambiguity",
  "source_deletion_edit_propagation", "actor_mapping_quality", "sampling_filter_completeness", "cross_system_entity_resolution",
] as const;
export type ProcessDataDimension = typeof PROCESS_DATA_DIMENSIONS[number];
export const NATIVE_PROCESS_ACTIVITIES = ["issue.created", "issue.updated", "issue.checked_out", "issue.released", "project.created", "project.updated"] as const;
const utcMicros = z.iso.datetime().refine(value => /:\d{2}(?:\.\d{1,6})?Z$/.test(value), "Explicit UTC with at most six fractional digits is required");
export const assessProcessDataSchema = z.object({
  ...businessEventPurposeSchema.shape,
  analysisKey: z.string().trim().regex(/^[a-z][a-z0-9_-]{2,99}$/),
  businessQuestion: z.string().trim().min(10).max(2000),
  from: utcMicros, until: utcMicros,
  requiredSourceProviders: z.array(z.string().trim().regex(/^[a-z][a-z0-9_-]{1,99}$/)).min(1).max(16),
  requiredObjectTypes: z.array(z.enum(["issue", "project"])).min(1).max(2),
  requiredActivities: z.array(z.enum(NATIVE_PROCESS_ACTIVITIES)).min(1).max(6),
  minimumCoverageSeconds: z.number().int().min(1).max(3650*86400),
  requiresOrdering: z.boolean(),
  requiresLifecycle: z.boolean(),
  lifecycleSemantics: z.enum(["recorded_creation_and_any_terminal", "recorded_typed_creation_and_latest_terminal"]).default("recorded_creation_and_any_terminal"),
  requiresArrivalEvidence: z.boolean(),
  maxDuplicateRate: z.number().min(0).max(1),
  maxUnknownObjectRate: z.number().min(0).max(1),
  maxLateArrivalRate: z.number().min(0).max(1),
}).strict().refine(value => Date.parse(value.from)<Date.parse(value.until), "A nonempty event window is required")
  .refine(value => new Set(value.requiredSourceProviders).size===value.requiredSourceProviders.length
    && new Set(value.requiredObjectTypes).size===value.requiredObjectTypes.length && new Set(value.requiredActivities).size===value.requiredActivities.length,
  "Requirements cannot repeat source, object or activity identities");
export type AssessProcessData = z.infer<typeof assessProcessDataSchema>;
export interface ProcessDataDimensionResult {
  dimension: ProcessDataDimension;
  state: "satisfied" | "warning" | "failed" | "unknown" | "not_applicable";
  reason: string;
  required: boolean;
}
export interface ProcessDataReadinessResult {
  companyId: string;
  engineVersion: string;
  status: "ready" | "ready_with_warning" | "review_required" | "blocked" | "unknown";
  admission: "DATA_READY" | "DATA_NOT_READY";
  analysisKey: string;
  requirementHash: string;
  eventSetHash: string;
  assessedAt: string;
  expiresAt: string;
  authorizedEventCount: number;
  dimensions: ProcessDataDimensionResult[];
  findings: { type: "source_gap" | "missing_timestamp" | "unknown_activity" | "missing_object_link" | "ambiguous_identity" | "impossible_order" | "duplicate_event" | "late_event" | "lifecycle_gap" | "partial_period"; dimension: ProcessDataDimension; summary: string }[];
  coverage: "current_native_activity_snapshot" | "bounded_incomplete_snapshot";
}
