import { expect, it } from "vitest";
import type { WorkflowGraphV1 } from "@paperclipai/shared";
import { reviewWorkflowStepInput } from "./workflow-step-input-review.js";

function node(type: string, config: unknown): WorkflowGraphV1["nodes"][number] {
  return { id: "selected", type, name: "Selected", position: { x: 0, y: 0 }, config };
}
it("reviews exact Native condition values and field levels without evaluating or flattening them", () => {
  expect(reviewWorkflowStepInput(node("core.condition", { expression: '{{trigger["customer.name"]["amount"]}} >= 10000' }))).toEqual({
    kind: "condition", source: "trigger", path: ["customer.name", "amount"], operator: ">=", value: 10000 });
  expect(reviewWorkflowStepInput(node("core.condition", { expression: '{{variables["answer"]}} === " false "' }))).toMatchObject({ value: " false " });
  for (const expression of ['true', '{{trigger.amount}} === {{variables.amount}}', '{{trigger.amount}} > "1"', '{{trigger.amount}} === 1; malicious()'])
    expect(reviewWorkflowStepInput(node("core.condition", { expression }))).toEqual({ kind: "advanced" });
});
it("preserves exact approval material and never trims, copies hidden fields or accepts a config-supplied kind", () => {
  const config = { summary: "PRIVATE approval\nmaterial", consequence: "PRIVATE consequence" }, source = node("human.approval", config);
  expect(reviewWorkflowStepInput(source)).toEqual({ kind: "approval", ...config });
  expect(source.config).toEqual(config);
  for (const config of [{ summary: " padded ", consequence: "Consequence" }, { summary: "Valid", consequence: "Valid", recipient: "PRIVATE" },
    { summary: "Valid", consequence: "Valid", kind: "approval" }, { summary: "x".repeat(1001), consequence: "Valid" }])
    expect(reviewWorkflowStepInput(node("human.approval", config))).toEqual({ kind: "advanced" });
});
it("only exposes a complete literal wait and keeps unrelated task/tool inputs Advanced", () => {
  expect(reviewWorkflowStepInput(node("core.wait", { durationSeconds: 10 }))).toEqual({ kind: "wait", durationSeconds: 10 });
  expect(reviewWorkflowStepInput(node("core.wait", { durationSeconds: 10, secret: "PRIVATE" }))).toEqual({ kind: "advanced" });
  expect(reviewWorkflowStepInput(node("agent.task", { objective: "PRIVATE" }))).toEqual({ kind: "advanced" });
});
