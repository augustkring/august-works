import { z } from "zod";
import { updateWorkflowDraftSchema } from "./validators/workflow.js";
import { rolePackVersionInputSchema } from "./role-packs.js";
import { memoryScopeSchema } from "./validators/memory.js";
import { skillCandidateInputSchema } from "./skill-lifecycle.js";
import { proposePlaybookSchema } from "./playbooks.js";
import { roadmapProposalSchema, roadmapPolicySchema } from "./project-control.js";
import { createReadinessRequirementSchema } from "./readiness.js";

export const LEARNING_TARGETS = ["foundation", "skill", "playbook", "project", "policy", "workflow", "role_pack", "automation_artifact"] as const;
export const learningCycleSchema = z.object({
  scope: memoryScopeSchema.refine((scope) => scope.type === "company" || scope.type === "project", "Learning requires an authorized shared company or project scope"),
  purpose: z.string().trim().min(1).max(240), trigger: z.string().trim().min(10).max(1000),
  memoryRecordIds: z.array(z.string().uuid()).min(1).max(32).refine((ids) => new Set(ids).size === ids.length, "Unique roots required"),
  maxHypotheses: z.number().int().min(1).max(20).default(5), maxEvaluations: z.number().int().min(1).max(40).default(10),
}).strict();
export const learningHypothesisSchema = z.object({
  expectedCycleVersion: z.number().int().positive(), claim: z.string().trim().min(20).max(4000), predictedEffect: z.string().trim().min(20).max(4000),
  targetDomain: z.enum(LEARNING_TARGETS), targetId: z.string().uuid(), riskClass: z.enum(["low", "material", "high", "critical"]),
  evaluationContract: z.object({
    expectedImprovement: z.string().trim().min(10).max(2000), protectedInvariants: z.array(z.string().trim().min(5).max(500)).min(1).max(16),
    baselineRef: z.string().trim().min(1).max(500), challengerHash: z.string().regex(/^[a-f0-9]{64}$/),
    minimumCases: z.number().int().min(2).max(32), minimumQuality: z.number().min(0).max(1), minimumImprovement: z.number().min(0).max(1),
    rollbackPath: z.string().trim().min(20).max(2000),
  }).strict(),
}).strict();
const judgment = z.object({ correctness: z.boolean(), safety: z.boolean(), policy: z.boolean(), businessOutcome: z.number().min(0).max(1), reliability: z.number().min(0).max(1), latencyMs: z.number().nonnegative().nullable(), costCents: z.number().nonnegative().nullable() }).strict();
export const learningEvaluationSchema = z.object({
  expectedHypothesisVersion: z.number().int().positive(), method: z.literal("manual_review"),
  cases: z.array(z.object({ baselineTaskId: z.string().uuid(), challengerTaskId: z.string().uuid(), baseline: judgment, challenger: judgment,
    invariantResults: z.array(z.boolean()).min(1).max(16), rationale: z.string().trim().min(20).max(2000) }).strict()).min(2).max(32),
  limitations: z.array(z.string().trim().min(10).max(1000)).min(1).max(16),
}).strict().refine((value) => new Set(value.cases.flatMap((item) => [item.baselineTaskId, item.challengerTaskId])).size === value.cases.length * 2, "Independent cases require distinct canonical outcomes");
export const learningPolicyPayloadSchema = z.discriminatedUnion("policyType", [
  z.object({ policyType: z.literal("project_roadmap"), expectedProjectUpdatedAt: z.string().datetime({ offset: true }), policy: roadmapPolicySchema }).strict(),
  z.object({ policyType: z.literal("readiness_requirement"), requirement: createReadinessRequirementSchema }).strict(),
]);
export const learningChangeSchema = z.discriminatedUnion("targetDomain", [
  z.object({ targetDomain: z.literal("automation_artifact"), optimizerEvaluationId: z.string().uuid(), expectedArtifactVersionId: z.string().uuid(), expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ targetDomain: z.literal("workflow"), draft: updateWorkflowDraftSchema }).strict(),
  z.object({ targetDomain: z.literal("role_pack"), expectedPublishedVersionId: z.string().uuid().nullable(), draft: rolePackVersionInputSchema }).strict(),
  z.object({ targetDomain: z.literal("foundation"), baseRevisionId: z.string().uuid(), proposedBody: z.string().trim().min(1).max(100000), reason: z.string().trim().min(20).max(2000) }).strict(),
  z.object({ targetDomain: z.literal("skill"), candidate: skillCandidateInputSchema }).strict(),
  z.object({ targetDomain: z.literal("playbook"), proposal: proposePlaybookSchema }).strict(),
  z.object({ targetDomain: z.literal("project"), proposal: roadmapProposalSchema }).strict(),
  z.object({ targetDomain: z.literal("policy"), proposal: learningPolicyPayloadSchema, reason: z.string().trim().min(20).max(2000) }).strict(),
]);
export const proposeLearningChangeSchema = z.object({ expectedHypothesisVersion: z.number().int().positive(), evaluationId: z.string().uuid(), change: learningChangeSchema }).strict();
export const reviewLearningPolicySchema = z.object({ expectedVersion: z.number().int().positive(), decision: z.enum(["accept", "reject"]), rationale: z.string().trim().min(20).max(4000), acknowledgeApprovalOrSecurityChange: z.boolean().default(false) }).strict();
export type LearningCycleInput = z.input<typeof learningCycleSchema>;
export type LearningHypothesisInput = z.infer<typeof learningHypothesisSchema>;
export type LearningEvaluationInput = z.infer<typeof learningEvaluationSchema>;
export type LearningChangeInput = z.input<typeof learningChangeSchema>;
export type LearningChange = z.infer<typeof learningChangeSchema>;
export type ProposeLearningChange = z.infer<typeof proposeLearningChangeSchema>;
export type LearningPolicyPayload = z.infer<typeof learningPolicyPayloadSchema>;
export interface LearningCycleView { id: string; companyId: string; scopeType: string; scopeId: string | null; purpose: string; trigger: string; status: string; version: number; maxHypotheses: number; maxEvaluations: number; createdAt: string; }
export interface LearningHypothesisView { id: string; cycleId: string; claim: string; predictedEffect: string; targetDomain: typeof LEARNING_TARGETS[number]; targetId: string; riskClass: string; status: string; version: number; evaluationContract: z.infer<typeof learningHypothesisSchema>["evaluationContract"]; }
export interface LearningEvaluationView { id: string; hypothesisId: string; result: "passed" | "failed" | "inconclusive"; method: "manual_review"; metrics: Record<string, unknown>; limitations: string[]; reviewedBy: string; createdAt: string; }
export interface LearningPolicyProposalView { id: string; companyId: string; targetId: string; policyType: string; version: number; proposal: LearningPolicyPayload | null; baseline?: LearningPolicyPayload | null; reason: string; status: string; reviewedBy: string | null; reviewRationale: string | null; }

export const finishLearningCycleSchema = z.object({ expectedVersion: z.number().int().positive(), decision: z.enum(["complete", "cancel"]), rationale: z.string().trim().min(20).max(2000) }).strict();
export type FinishLearningCycleInput = z.infer<typeof finishLearningCycleSchema>;
