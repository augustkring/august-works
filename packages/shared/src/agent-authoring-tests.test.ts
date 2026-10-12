import { expect, it } from "vitest";
import { agentDraftTestCommandSchema, agentDraftTestViewSchema } from "./agent-authoring-tests.js";
const id = "10000000-0000-4000-8000-000000000001";
it("requires explicit bounded spend and company-result consent and rejects model or tool overrides", () => {
  const command = { requestId: id, expectedVersion: 1, scenarioIndex: 0, expectedReviewHash: "a".repeat(64), confirmRepresentativeTest: true, confirmCompanyVisibleResult: true };
  expect(agentDraftTestCommandSchema.safeParse(command).success).toBe(true);
  for (const change of [{ confirmCompanyVisibleResult: false }, { confirmRepresentativeTest: false }, { model: "override" }, { tools: ["send"] }, { scenarioIndex: 10 }])
    expect(agentDraftTestCommandSchema.safeParse({ ...command, ...change }).success).toBe(false);
});
it("cannot label a stale, unverified or unsuccessful test as qualified", () => {
  const value = { id, companyId: id, draftId: id, version: 1, requestId: id, scenarioIndex: 0, scenario: "Create an internal draft", agentId: id, runId: id, planId: id,
    candidateCurrent: true, runtimeCurrent: true, resultCurrent: true, execution: "succeeded", verification: "pass", testQualified: true,
    toolsGranted: false, activatesAgent: false, result: "Draft", maximumCostMinor: 3, currency: "USD", createdAt: "2026-10-12T00:00:00.000Z" };
  expect(agentDraftTestViewSchema.safeParse(value).success).toBe(true);
  for (const change of [{ candidateCurrent: false }, { runtimeCurrent: false }, { resultCurrent: false }, { execution: "unknown" }, { verification: "not_reviewed" }, { activatesAgent: true }])
    expect(agentDraftTestViewSchema.safeParse({ ...value, ...change }).success).toBe(false);
});
