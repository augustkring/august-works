import { expect, it } from "vitest";
import { agentModelMigrationMonitorCommandSchema, agentModelMigrationMonitorReviewSchema,
  agentModelMigrationMonitorReceiptSchema } from "./agent-model-migration-monitoring.js";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (char: string) => char.repeat(64);
const review = { companyId: id(1), draftId: id(2), agentId: id(3), migrationRevisionId: id(4), publishedVersion: 2,
  publishedAt: "2026-10-28T10:00:00.000Z", targetProfileHash: hash("a"), targetConfigurationHash: hash("b"), targetLifecycleHash: hash("c"),
  canRecord: true, blockers: [], recommendation: "healthy", tests: [{ testId: id(5), runId: id(6), scenarioIndex: 0, testCreatedAt: "2026-10-28T10:01:00.000Z",
    runStartedAt: "2026-10-28T10:01:00.000Z", verificationId: id(7), verificationCreatedAt: "2026-10-28T10:02:00.000Z",
    execution: "succeeded", verificationResult: "pass", testQualified: true, outputHash: hash("d"), resultHash: hash("e") }], reviewHash: hash("f") };

it("requires exact active profile evidence and post-publication Human verification for a monitor receipt", () => {
  expect(agentModelMigrationMonitorReviewSchema.parse(review).canRecord).toBe(true);
  expect(agentModelMigrationMonitorReviewSchema.safeParse({ ...review, blockers: ["migration_version_is_not_current"] }).success).toBe(false);
  expect(agentModelMigrationMonitorReviewSchema.safeParse({ ...review, tests: [] }).success).toBe(false);
  expect(agentModelMigrationMonitorReceiptSchema.safeParse({ ...review, requestId: id(8), reviewedByUserId: "human",
    recordedAt: "2026-10-28T10:03:00.000Z", decision: "healthy" }).success).toBe(true);
  expect(agentModelMigrationMonitorCommandSchema.safeParse({ requestId: id(8), expectedReviewHash: hash("f"), confirmMonitoring: true,
    approveRollback: true }).success).toBe(false);
  expect(agentModelMigrationMonitorReviewSchema.parse({ ...review, recommendation: "hold", tests: [{ ...review.tests[0]!, testQualified: false,
    verificationResult: "fail" }] }).recommendation).toBe("hold");
});
