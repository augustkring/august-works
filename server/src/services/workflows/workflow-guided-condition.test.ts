import { expect, it } from "vitest";
import { workflowGuidedConditionSchema } from "@paperclipai/shared";
import { guidedConditionExpression, reviewGuidedCondition } from "./workflow-guided-condition.js";
import { evaluateWorkflowConditionExpression } from "./workflow-condition-expression.js";

it("uses Original parsing and evaluation for both outcomes, preserving exact literal whitespace", () => {
  const value = reviewGuidedCondition({ expression: '{{trigger.amount}} >= 50000' });
  expect(value).toEqual({ kind: "condition", source: "trigger", path: ["amount"], operator: ">=", value: 50000 });
  const expression = guidedConditionExpression(value!);
  expect(evaluateWorkflowConditionExpression(expression, { trigger: { amount: 50000 }, variables: {}, steps: {} })).toBe(true);
  expect(evaluateWorkflowConditionExpression(expression, { trigger: { amount: 49999 }, variables: {}, steps: {} })).toBe(false);
  const text = reviewGuidedCondition({ expression: '{{variables["status"]}} === " ready "' });
  expect(text?.value).toBe(" ready ");
  expect(reviewGuidedCondition({ expression: guidedConditionExpression(text!) })).toEqual(text);
});
it("quotes untrusted field names and literals as data rather than executable expressions", () => {
  const key = 'amount"]}} >= 0 === {{trigger["other', value = '" or process.exit()';
  const guided = workflowGuidedConditionSchema.parse({ kind: "condition", source: "steps", path: [key], operator: "===", value });
  const expression = guidedConditionExpression(guided);
  expect(reviewGuidedCondition({ expression })).toEqual(guided);
  expect(evaluateWorkflowConditionExpression(expression, { trigger: {}, variables: {}, steps: { [key]: value } })).toBe(true);
});
it("keeps partially representable, extra, malformed and type-invalid configurations in Advanced", () => {
  for (const config of [{ expression: 'true' }, { expression: '{{trigger.a}} === {{variables.b}}' },
    { expression: '{{trigger.a}} === "yes"', hidden: "private" }, { expression: '{{trigger[" name "]}} === "yes"' },
    { expression: '{{trigger.a}} >= "10"' }, { expression: 'process.exit()' }]) expect(reviewGuidedCondition(config)).toBeNull();
  expect(() => guidedConditionExpression({ kind: "condition", source: "trigger", path: ["amount"], operator: ">", value: null })).toThrow();
});
