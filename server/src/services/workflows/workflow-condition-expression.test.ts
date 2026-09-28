import { describe, expect, it } from "vitest";
import {
  evaluateWorkflowConditionExpression,
  parseWorkflowConditionExpression,
  WorkflowConditionExpressionError,
} from "./workflow-condition-expression.js";

const context = {
  trigger: {
    active: true,
    amount: 75_000,
    customer: { tier: "enterprise" },
  },
  variables: { threshold: 50_000 },
  steps: {
    "first-step": { result: false },
  },
};

describe("workflow condition expression", () => {
  it("supports booleans, typed references and strict comparisons", () => {
    expect(evaluateWorkflowConditionExpression("true", context)).toBe(true);
    expect(evaluateWorkflowConditionExpression("{{trigger.active}}", context)).toBe(true);
    expect(
      evaluateWorkflowConditionExpression(
        '{{trigger.customer.tier}} === "enterprise"',
        context,
      ),
    ).toBe(true);
    expect(
      evaluateWorkflowConditionExpression(
        "{{trigger.amount}} >= {{variables.threshold}}",
        context,
      ),
    ).toBe(true);
    expect(
      evaluateWorkflowConditionExpression(
        '{{steps["first-step"].result}} === false',
        context,
      ),
    ).toBe(true);
  });

  it("rejects arbitrary host-language expressions", () => {
    expect(() => parseWorkflowConditionExpression("process.exit(1)")).toThrow(
      WorkflowConditionExpressionError,
    );
    expect(() => parseWorkflowConditionExpression("trigger.active && true")).toThrow(
      WorkflowConditionExpressionError,
    );
  });

  it("fails closed on missing references and invalid runtime types", () => {
    expect(() =>
      evaluateWorkflowConditionExpression("{{trigger.missing}}", context),
    ).toThrowError(
      expect.objectContaining({ code: "workflow_condition_reference_missing" }),
    );
    expect(() =>
      evaluateWorkflowConditionExpression("{{trigger.amount}}", context),
    ).toThrowError(
      expect.objectContaining({ code: "workflow_condition_type_invalid" }),
    );
  });

  it("requires numeric operands for ordered comparisons", () => {
    expect(() =>
      evaluateWorkflowConditionExpression(
        '{{trigger.customer.tier}} > "basic"',
        context,
      ),
    ).toThrowError(
      expect.objectContaining({ code: "workflow_condition_type_invalid" }),
    );
  });
});
