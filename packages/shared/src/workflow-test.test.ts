import { expect, it } from "vitest";
import {
  workflowTestCommandSchema,
  workflowTestReceiptSchema,
  workflowSyntheticInputSchema, workflowSyntheticTriggerPayload,
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
it("constructs bounded literal start data without prototype mutation, code execution or overlapping paths", () => {
  const input = workflowSyntheticInputSchema.parse([{ path: ["amount"], value: 10000 }, { path: ["customer", "note"], value: " ready " },
    { path: ["__proto__", "polluted"], value: true }, { path: ["constructor", "prototype", "other"], value: "value" }]);
  const payload = workflowSyntheticTriggerPayload(input);
  expect(payload).toMatchObject({ amount: 10000, customer: { note: " ready " } });
  expect(Object.getPrototypeOf(payload)).toBe(Object.prototype);
  expect(Object.prototype).not.toHaveProperty("polluted"); expect(Object.prototype).not.toHaveProperty("other");
  expect(JSON.parse(JSON.stringify(payload))["__proto__"]).toEqual({ polluted: true });
  expect(workflowSyntheticInputSchema.safeParse([{ path: ["customer"], value: "text" }, { path: ["customer", "name"], value: "name" }]).success).toBe(false);
  expect(workflowSyntheticInputSchema.safeParse([{ path: ["amount"], value: Infinity }]).success).toBe(false);
  expect(workflowSyntheticInputSchema.safeParse([{ path: ["amount"], value: 1 }, { path: ["amount"], value: 2 }]).success).toBe(false);
  expect(workflowTestCommandSchema.parse(command)).toEqual(command);
});
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
