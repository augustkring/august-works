import { describe, expect, it } from "vitest";
import {
  evaluateWorkflowTransformExpression,
  evaluateWorkflowTransformMapping,
  parseWorkflowTransformExpression,
} from "./workflow-transform-expression.js";

const context = {
  input: {
    value: 42,
    payload: { id: "lead-1", tags: ["priority"] },
  },
  trigger: {
    label: "Acme",
    active: true,
  },
  variables: {
    region: "DK",
  },
  steps: {
    start: {
      value: 42,
    },
  },
};

describe("workflow transform expression", () => {
  it("reads existing array elements without exposing prototype methods or length", () => {
    expect(evaluateWorkflowTransformExpression("{{input.payload.tags[0]}}", context)).toBe("priority");
    expect(evaluateWorkflowTransformExpression('{{input.payload.tags["0"]}}', context)).toBe("priority");
    for (const expression of ["{{input.payload.tags[1]}}", "{{input.payload.tags.constructor}}", "{{input.payload.tags.map}}", "{{input.payload.tags.length}}"]) {
      expect(() => evaluateWorkflowTransformExpression(expression, context)).toThrow(/could not resolve/);
    }
    for (const expression of ["{{input.payload.tags[-1]}}", "{{input.payload.tags[variables.index]}}", "{{input.payload.tags[9007199254740992]}}"])
      expect(() => parseWorkflowTransformExpression(expression)).toThrow();
  });
  it("preserves the native value when the expression is exactly one reference", () => {
    expect(
      evaluateWorkflowTransformExpression("{{input.payload}}", context),
    ).toEqual({ id: "lead-1", tags: ["priority"] });
    expect(
      evaluateWorkflowTransformExpression("{{input.value}}", context),
    ).toBe(42);
  });

  it("interpolates scalar references into deterministic strings", () => {
    expect(
      evaluateWorkflowTransformExpression(
        "Lead {{trigger.label}} / {{variables.region}} / {{steps.start.value}}",
        context,
      ),
    ).toBe("Lead Acme / DK / 42");
  });

  it("keeps strings without references as literal values", () => {
    expect(evaluateWorkflowTransformExpression("fixed", context)).toBe("fixed");
  });

  it("evaluates a mapping without executing host JavaScript", () => {
    expect(
      evaluateWorkflowTransformMapping(
        {
          amount: "{{input.value}}",
          account: "{{trigger.label}}",
          summary: "{{trigger.label}} in {{variables.region}}",
        },
        context,
      ),
    ).toEqual({
      amount: 42,
      account: "Acme",
      summary: "Acme in DK",
    });
  });

  it("fails closed for missing references", () => {
    try {
      evaluateWorkflowTransformExpression("{{input.missing}}", context);
      throw new Error("Expected a missing transform reference to fail");
    } catch (error) {
      expect(error).toMatchObject({
        code: "workflow_transform_reference_missing",
      });
    }
  });

  it("rejects object interpolation inside a string template", () => {
    try {
      evaluateWorkflowTransformExpression("payload={{input.payload}}", context);
      throw new Error("Expected object interpolation to fail");
    } catch (error) {
      expect(error).toMatchObject({
        code: "workflow_transform_interpolation_type_invalid",
      });
    }
  });

  it("rejects unsupported roots and incomplete delimiters", () => {
    for (const expression of ["{{process.env.SECRET}}", "{{input.value}"]) {
      try {
        parseWorkflowTransformExpression(expression);
        throw new Error("Expected an invalid transform expression to fail");
      } catch (error) {
        expect(error).toMatchObject({
          code: "workflow_transform_expression_invalid",
        });
      }
    }
  });
});
