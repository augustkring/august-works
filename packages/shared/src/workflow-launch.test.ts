import { expect, it } from "vitest";
import {
  workflowLaunchCommandSchema,
  workflowLaunchReceiptSchema,
} from "./workflow-launch.js";
const id = "10000000-0000-4000-8000-000000000001";
const command = {
  requestId: id,
  expectedUpdatedAt: "2026-10-09T10:00:00.000Z",
  expectedPublishedRevisionId: id,
  expectedDraftRevisionId: null,
  acknowledgeInternalExecution: true,
};
it.each([
  { acknowledgeInternalExecution: false },
  { input: { secret: "PRIVATE" } },
  { expectedPublishedRevisionId: null },
  { requestId: "unstable" },
])("rejects unreviewed or unbounded launch command %j", (override) => {
  expect(
    workflowLaunchCommandSchema.safeParse({ ...command, ...override }).success,
  ).toBe(false);
});
it("keeps admission separate from completion and independent verification", () => {
  const receipt = {
    companyId: id,
    workflowId: id,
    requestId: id,
    runId: id,
    revisionId: id,
    disposition: "admitted",
  };
  expect(workflowLaunchReceiptSchema.parse(receipt)).toEqual(receipt);
  for (const override of [
    { disposition: "completed" },
    { independentlyVerified: true },
    { output: { secret: "PRIVATE" } },
  ])
    expect(
      workflowLaunchReceiptSchema.safeParse({ ...receipt, ...override })
        .success,
    ).toBe(false);
});
