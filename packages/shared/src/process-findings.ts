import { z } from "zod";

export const PROCESS_FINDING_STATES = ["OPEN", "ACKNOWLEDGED", "INVESTIGATING", "RESOLVED", "SUPPRESSED_WITH_REASON"] as const;
export type ProcessFindingState = typeof PROCESS_FINDING_STATES[number];
export const createProcessFindingSchema = z.object({
  findingType: z.enum(["missing_process_data", "rework", "avoidable_wait", "bottleneck", "unusual_variant"]),
  objectType: z.enum(["issue", "project"]).nullable(),
  variantHash: z.string().regex(/^[0-9a-f]{64}$/).nullable().default(null),
  severity: z.enum(["low", "medium", "high"]),
  interpretation: z.string().trim().min(10).max(2000),
}).strict().superRefine((value, ctx) => {
  if ((value.findingType === "missing_process_data") !== (value.objectType === null))
    ctx.addIssue({ code: "custom", message: "Missing data is a run finding; other findings require an object perspective" });
  if ((value.findingType === "unusual_variant") !== (value.variantHash !== null))
    ctx.addIssue({ code: "custom", message: "Only a variant finding selects an observed variant hash" });
});
export const transitionProcessFindingSchema = z.object({
  expectedVersion: z.number().int().min(1),
  status: z.enum(PROCESS_FINDING_STATES),
  reason: z.string().trim().min(10).max(2000),
}).strict();
export type CreateProcessFinding = z.infer<typeof createProcessFindingSchema>;
export type TransitionProcessFinding = z.infer<typeof transitionProcessFindingSchema>;
export function processFindingTransitionAllowed(from: ProcessFindingState, to: ProcessFindingState) {
  return (from === "OPEN" && (to === "ACKNOWLEDGED" || to === "SUPPRESSED_WITH_REASON"))
    || (from === "ACKNOWLEDGED" && (to === "INVESTIGATING" || to === "SUPPRESSED_WITH_REASON"))
    || (from === "INVESTIGATING" && (to === "RESOLVED" || to === "SUPPRESSED_WITH_REASON"));
}
export interface ProcessFindingFacts {
  observed: Record<string, number | string | null>;
  semantics: "human_process_interpretation_of_observed_facts";
  limitations: string[];
}
export interface ProcessFindingView {
  id: string; companyId: string; definitionId: string; analysisRunId: string;
  findingType: CreateProcessFinding["findingType"]; objectType: CreateProcessFinding["objectType"]; variantHash: string | null;
  severity: CreateProcessFinding["severity"]; interpretation: string; summary: string; facts: ProcessFindingFacts;
  definitionHash: string; eventSetHash: string; contentHash: string;
  status: ProcessFindingState; version: number; createdAt: string; expiresAt: string;
  resolvedAt: string | null; resolutionRef: null; authorizationCheckedAt: string;
}
export interface ProcessFindingTransitionView {
  version: number; fromStatus: ProcessFindingState | null; toStatus: ProcessFindingState;
  reason: string; recordedAt: string;
}
