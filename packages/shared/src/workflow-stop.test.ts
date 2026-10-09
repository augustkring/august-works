import { expect, it } from "vitest";
import {
  workflowStopCommandSchema,
  workflowStopReceiptSchema,
} from "./workflow-stop.js";
const id = "10000000-0000-4000-8000-000000000001";
const command = {
  requestId: id,
  expectedWorkflowId: id,
  expectedRevisionId: id,
  expectedUpdatedAt: "2026-10-09T10:00:00.000Z",
  acknowledgeCompletedEffectsRemain: true,
};
it.each([
  { acknowledgeCompletedEffectsRemain: false },
  { expectedRevisionId: null },
  { requestId: "unstable" },
  { killAllAgents: true },
  { reason: "PRIVATE" },
])("rejects an unreviewed or expanded stop command %j", (override) => {
  expect(
    workflowStopCommandSchema.safeParse({ ...command, ...override }).success,
  ).toBe(false);
});
it("accepts only a bound cancellation admission, never completion or reversal", () => {
  const receipt = {
    companyId: id,
    workflowId: id,
    runId: id,
    revisionId: id,
    requestId: id,
    disposition: "cancellation_requested",
  };
  expect(workflowStopReceiptSchema.parse(receipt)).toEqual(receipt);
  for (const override of [
    { disposition: "stopped" },
    { effectsReversed: true },
    { output: "PRIVATE" },
  ])
    expect(
      workflowStopReceiptSchema.safeParse({ ...receipt, ...override }).success,
    ).toBe(false);
});
