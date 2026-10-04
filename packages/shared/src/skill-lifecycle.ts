import { z } from "zod";

export const SKILL_LIFECYCLE_STATES = ["draft", "proposed", "testing", "active", "needs_revalidation", "degraded", "deprecated", "revoked"] as const;
export const SKILL_VERSION_STATES = ["candidate", "testing", "validated", "active", "rejected", "superseded"] as const;
export const SKILL_DEPENDENCY_TYPES = ["playbook_revision", "foundation_revision", "tool_schema", "provider_capability", "workflow_revision", "automation_artifact_version", "external_source_commit", "policy_revision"] as const;
export const skillDependencyInputSchema = z.object({ dependencyType: z.enum(SKILL_DEPENDENCY_TYPES), dependencyRef: z.string().min(1).max(500), dependencyVersion: z.string().min(1).max(200), required: z.boolean().default(true) }).strict();
export const skillReviewPolicySchema = z.object({ reviewIntervalDays: z.number().int().min(1).max(365).default(90), stewardUserId: z.string().min(1).max(200).nullable().default(null) }).strict();
export const skillPromotionPolicySchema = z.object({ allowAutonomousPromotion: z.boolean().default(false), minimumPairedTrials: z.number().int().min(2).max(20).default(2), minimumOutcomeScore: z.number().min(0).max(1).default(0.9), maximumCostRegressionRatio: z.number().min(1).max(5).default(1.25), requireHumanReview: z.boolean().default(true) }).strict();
export const updateSkillGovernanceSchema = z.object({ ownerAgentId: z.string().uuid().nullable().optional(), reviewPolicy: skillReviewPolicySchema.optional(), promotionPolicy: skillPromotionPolicySchema.optional() }).strict();
export const skillCandidateInputSchema = z.object({ baseActiveVersionId: z.string().uuid().nullable(), markdown: z.string().min(1).max(100_000), summary: z.string().max(4000).default(""), dependencies: z.array(skillDependencyInputSchema).max(64).default([]), sharing: z.enum(["private_draft", "company_proposed"]).default("private_draft") }).strict();
export const skillPromotionInputSchema = z.object({ versionId: z.string().uuid(), expectedActiveVersionId: z.string().uuid().nullable(), evaluationRunId: z.string().uuid() }).strict();
export const skillLifecycleTransitionSchema = z.object({ state: z.enum(["proposed", "testing", "needs_revalidation", "degraded", "deprecated", "revoked"]), reason: z.string().trim().min(1).max(2000) }).strict();
export const skillEvalRubricSchema = z.object({
  requiredText: z.array(z.string().min(1).max(1000)).max(32).default([]), forbiddenText: z.array(z.string().min(1).max(1000)).max(32).default([]),
  requiredTools: z.array(z.string().min(1).max(300)).max(32).default([]), prohibitedTools: z.array(z.string().min(1).max(300)).max(32).default([]),
  maximumCostCents: z.number().int().nonnegative().max(1_000_000).nullable().default(null), maximumRuntimeMs: z.number().int().positive().max(3_600_000).nullable().default(null),
  requiresHumanJudgement: z.boolean().default(true),
}).strict();
export type SkillEvalRubric = z.infer<typeof skillEvalRubricSchema>;
export const createSkillEvalSuiteSchema = z.object({ name: z.string().trim().min(1).max(200), requiredForPromotion: z.boolean().default(true), cases: z.array(z.object({ name: z.string().trim().min(1).max(200), input: z.string().min(1).max(20_000), shouldTrigger: z.boolean(), risk: z.enum(["low", "medium", "high", "critical"]).default("low"), rubric: skillEvalRubricSchema }).strict()).min(2).max(100) }).strict().superRefine((suite, ctx) => {
  if (!suite.cases.some((test) => test.shouldTrigger) || !suite.cases.some((test) => !test.shouldTrigger)) ctx.addIssue({ code: "custom", message: "Evaluation suites require positive and negative trigger controls" });
});
export const createSkillEvalRunSchema = z.object({ suiteId: z.string().uuid(), candidateVersionId: z.string().uuid(), championVersionId: z.string().uuid().nullable(), trials: z.number().int().min(2).max(20).default(2) }).strict();
export const replaceSkillEvalSuiteSchema = z.object({ reason: z.string().trim().min(20).max(4000), replacement: createSkillEvalSuiteSchema }).strict();
export const skillEvaluationBindingSchema = z.object({ evaluationRunId: z.string().uuid(), caseId: z.string().uuid(), arm: z.enum(["champion", "candidate"]), trial: z.number().int().min(0).max(19) }).strict();
export type SkillEvaluationBinding = z.infer<typeof skillEvaluationBindingSchema>;
export const attachSkillEvalObservationSchema = z.object({ caseId: z.string().uuid(), trial: z.number().int().min(0).max(19), arm: z.enum(["champion", "candidate"]), testRunId: z.string().uuid(), humanAssessment: z.object({ processScore: z.number().min(0).max(1), outcomeScore: z.number().min(0).max(1), safetyPassed: z.boolean(), rationale: z.string().trim().min(20).max(4000) }).strict().optional() }).strict();
export const skillUsageInputSchema = z.object({ runId: z.string().uuid(), skillId: z.string().uuid(), skillVersionId: z.string().uuid(), stage: z.enum(["loaded", "used", "completed", "corrected", "failure"]), outcome: z.enum(["success", "failure", "corrected", "unknown"]).default("unknown") }).strict();

export const createGovernedSkillSchema = z.object({ slug: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,99}$/), name: z.string().trim().min(1).max(200), description: z.string().max(2000).default(""), markdown: z.string().min(1).max(100_000), triggerTerms: z.array(z.string().trim().min(1).max(100)).max(32).default([]), excludeTerms: z.array(z.string().trim().min(1).max(100)).max(32).default([]), sharing: z.enum(["private_draft", "company_proposed"]).default("private_draft") }).strict();

export type SkillPromotionPolicy = z.infer<typeof skillPromotionPolicySchema>;
export type SkillReviewPolicy = z.infer<typeof skillReviewPolicySchema>;

export const reviewSkillOverlapSchema = z.object({ rationale: z.string().trim().min(20).max(4000) }).strict();
