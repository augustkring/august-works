import { z } from "zod";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const requestId = z.uuid().refine(value => value === value.toLowerCase(), "Use the canonical request ID");

export const agentModelMigrationMonitorReviewSchema = z.strictObject({
  companyId: z.uuid(), draftId: z.uuid(), agentId: z.uuid(), migrationRevisionId: z.uuid(),
  publishedVersion: z.number().int().positive(), publishedAt: z.iso.datetime(),
  targetProfileHash: digest, targetConfigurationHash: digest, targetLifecycleHash: digest,
  canRecord: z.boolean(), blockers: z.array(z.string().min(1).max(100)).max(20),
  tests: z.array(z.strictObject({ testId: z.uuid(), runId: z.uuid(), scenarioIndex: z.number().int().min(0).max(9),
    testCreatedAt: z.iso.datetime(), runStartedAt: z.iso.datetime(), verificationId: z.uuid(),
    verificationCreatedAt: z.iso.datetime(), execution: z.enum(["succeeded", "failed", "unknown", "cancelled"]),
    verificationResult: z.enum(["pass", "fail", "inconclusive", "needs_human"]), testQualified: z.boolean(),
    outputHash: digest, resultHash: digest })).max(10),
  recommendation: z.enum(["healthy", "hold"]),
  reviewHash: digest,
}).superRefine((review, context) => {
  if (review.canRecord !== (review.blockers.length === 0 && review.tests.length > 0) ||
    review.recommendation !== (review.tests.length > 0 && review.tests.every(test => test.testQualified) ? "healthy" : "hold"))
    context.addIssue({ code: "custom", path: ["canRecord"], message: "A monitoring receipt needs current post-publication Human-reviewed tests for every scenario" });
});

export const agentModelMigrationMonitorCommandSchema = z.strictObject({
  requestId, expectedReviewHash: digest, confirmMonitoring: z.literal(true),
});

export const agentModelMigrationMonitorReceiptSchema = agentModelMigrationMonitorReviewSchema.extend({
  requestId, reviewedByUserId: z.string().min(1).max(200), recordedAt: z.iso.datetime(),
  decision: z.enum(["healthy", "hold"]),
});

export type AgentModelMigrationMonitorReview = z.infer<typeof agentModelMigrationMonitorReviewSchema>;
export type AgentModelMigrationMonitorCommand = z.infer<typeof agentModelMigrationMonitorCommandSchema>;
export type AgentModelMigrationMonitorReceipt = z.infer<typeof agentModelMigrationMonitorReceiptSchema>;
