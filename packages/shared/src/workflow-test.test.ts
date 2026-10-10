import { expect, it } from "vitest";
import {
  workflowTestCommandSchema,
  workflowTestReceiptSchema,
} from "./workflow-test.js";
const id = "10000000-0000-4000-8000-000000000001";
const command = {
  requestId: id,
  expectedWorkflowId: id,
  expectedDraftRevisionId: id,
  expectedUpdatedAt: "2026-10-10T10:00:00.000Z",
  expectedRunStatus: "succeeded",
  acknowledgeInternalTest: true,
};
it.each([
  { acknowledgeInternalTest: false },
  { input: { secret: "PRIVATE" } },
  { expectedRunStatus: "running" },
  { expectedDraftRevisionId: null },
  { requestId: "unstable" },
  { purpose: "live" },
])("rejects unreviewed test command %j", (override) => {
  expect(
    workflowTestCommandSchema.safeParse({ ...command, ...override }).success,
  ).toBe(false);
});
it("separates native test admission from production validity and completed execution", () => {
  const receipt = {
    companyId: id,
    workflowId: id,
    requestId: id,
    runId: id,
    revisionId: id,
    purpose: "test",
    disposition: "admitted",
  };
  expect(workflowTestReceiptSchema.parse(receipt)).toEqual(receipt);
  for (const override of [
    { purpose: "live" },
    { disposition: "completed" },
    { independentlyVerified: true },
    { output: { secret: "PRIVATE" } },
  ])
    expect(
      workflowTestReceiptSchema.safeParse({ ...receipt, ...override }).success,
    ).toBe(false);
});
