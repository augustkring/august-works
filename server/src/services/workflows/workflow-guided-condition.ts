import { isDeepStrictEqual } from "node:util";
import { workflowGuidedConditionSchema } from "@paperclipai/shared";
import { parseWorkflowConditionExpression } from "./workflow-condition-expression.js";

type GuidedCondition = ReturnType<typeof workflowGuidedConditionSchema.parse>;
/** JSON string keys and literals preserve their exact meaning. No expression
 * supplied by a customer or inferred from a label is executed here. */
export function guidedConditionExpression(raw: GuidedCondition): string {
  const condition = workflowGuidedConditionSchema.parse(raw);
  return `{{${condition.source}${condition.path.map(key => `[${JSON.stringify(key)}]`).join("")}}} ${condition.operator} ${JSON.stringify(condition.value)}`;
}

export function reviewGuidedCondition(config: unknown): GuidedCondition | null {
  if (!config || typeof config !== "object" || Array.isArray(config) || Object.keys(config).length !== 1 ||
    !("expression" in config) || typeof config.expression !== "string") return null;
  try {
    const parsed = parseWorkflowConditionExpression(config.expression);
    if (parsed.kind !== "comparison" || parsed.left.kind !== "reference" || parsed.right.kind !== "literal") return null;
    const guided = workflowGuidedConditionSchema.safeParse({ kind: "condition", source: parsed.left.segments[0],
      path: parsed.left.segments.slice(1), operator: parsed.operator, value: parsed.right.value });
    // Do not expose a partially editable representation which silently changes
    // private field names or literal whitespace on a name-only save.
    return guided.success && isDeepStrictEqual(parseWorkflowConditionExpression(guidedConditionExpression(guided.data)), parsed) ? guided.data : null;
  } catch { return null; }
}
