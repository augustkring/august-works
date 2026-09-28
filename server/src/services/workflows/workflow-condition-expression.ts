import { isDeepStrictEqual } from "node:util";

const ROOTS = new Set(["trigger", "variables", "steps"]);
const COMPARATORS = ["===", "!==", ">=", "<=", ">", "<"] as const;

type Comparator = (typeof COMPARATORS)[number];

type Operand =
  | { kind: "literal"; value: string | number | boolean | null }
  | { kind: "reference"; segments: string[] };

export interface WorkflowConditionContext {
  trigger: Record<string, unknown>;
  variables: Record<string, unknown>;
  steps: Record<string, unknown>;
}

export class WorkflowConditionExpressionError extends Error {
  code: "workflow_condition_expression_invalid" | "workflow_condition_reference_missing" | "workflow_condition_type_invalid";

  constructor(
    code: WorkflowConditionExpressionError["code"],
    message: string,
  ) {
    super(message);
    this.name = "WorkflowConditionExpressionError";
    this.code = code;
  }
}

export type ParsedWorkflowCondition =
  | { kind: "boolean"; operand: Operand }
  | { kind: "comparison"; left: Operand; operator: Comparator; right: Operand };

function syntaxError(message: string): never {
  throw new WorkflowConditionExpressionError(
    "workflow_condition_expression_invalid",
    message,
  );
}

function parseReferencePath(raw: string): string[] {
  const input = raw.trim();
  const root = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(input);
  if (!root) syntaxError("Condition reference must start with trigger, variables or steps");
  const segments = [root[0]];
  if (!ROOTS.has(segments[0]!)) {
    syntaxError("Condition references may only read trigger, variables or steps");
  }

  let index = root[0].length;
  while (index < input.length) {
    const char = input[index];
    if (char === ".") {
      const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(input.slice(index + 1));
      if (!identifier) syntaxError("Invalid dotted condition reference");
      segments.push(identifier[0]);
      index += identifier[0].length + 1;
      continue;
    }

    if (char === "[") {
      const remaining = input.slice(index + 1);
      if (!remaining.startsWith('"')) {
        syntaxError("Condition bracket references must use a JSON string key");
      }
      let cursor = 1;
      let escaped = false;
      for (; cursor < remaining.length; cursor += 1) {
        const current = remaining[cursor]!;
        if (escaped) {
          escaped = false;
          continue;
        }
        if (current === "\\") {
          escaped = true;
          continue;
        }
        if (current === '"') break;
      }
      if (cursor >= remaining.length || remaining[cursor] !== '"') {
        syntaxError("Unterminated condition reference key");
      }
      const literal = remaining.slice(0, cursor + 1);
      let key: unknown;
      try {
        key = JSON.parse(literal);
      } catch {
        syntaxError("Invalid JSON string in condition reference");
      }
      if (typeof key !== "string" || key.length === 0) {
        syntaxError("Condition reference keys must be non-empty strings");
      }
      if (remaining[cursor + 1] !== "]") {
        syntaxError("Condition bracket reference is missing ]");
      }
      segments.push(key);
      index += cursor + 3;
      continue;
    }

    syntaxError("Condition reference contains unsupported syntax");
  }

  return segments;
}

function parseOperand(raw: string): Operand {
  const input = raw.trim();
  if (!input) syntaxError("Condition operand is empty");

  if (input.startsWith("{{") || input.endsWith("}}")) {
    if (!input.startsWith("{{") || !input.endsWith("}}")) {
      syntaxError("Condition reference delimiters are incomplete");
    }
    const inner = input.slice(2, -2).trim();
    if (!inner) syntaxError("Condition reference is empty");
    return { kind: "reference", segments: parseReferencePath(inner) };
  }

  if (input === "true") return { kind: "literal", value: true };
  if (input === "false") return { kind: "literal", value: false };
  if (input === "null") return { kind: "literal", value: null };

  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(input)) {
    const value = Number(input);
    if (!Number.isFinite(value)) syntaxError("Condition number must be finite");
    return { kind: "literal", value };
  }

  if (input.startsWith('"')) {
    let value: unknown;
    try {
      value = JSON.parse(input);
    } catch {
      syntaxError("Condition string literal must be valid JSON");
    }
    if (typeof value !== "string") syntaxError("Unsupported condition literal");
    return { kind: "literal", value };
  }

  syntaxError("Unsupported condition operand");
}

function comparisonAt(input: string): { index: number; operator: Comparator } | null {
  let inString = false;
  let escaped = false;
  let referenceDepth = 0;

  for (let index = 0; index < input.length; index += 1) {
    const current = input[index]!;
    const next = input[index + 1];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === '"') {
        inString = false;
      }
      continue;
    }

    if (current === '"') {
      inString = true;
      continue;
    }
    if (current === "{" && next === "{") {
      referenceDepth += 1;
      index += 1;
      continue;
    }
    if (current === "}" && next === "}") {
      referenceDepth = Math.max(0, referenceDepth - 1);
      index += 1;
      continue;
    }
    if (referenceDepth > 0) continue;

    for (const operator of COMPARATORS) {
      if (input.startsWith(operator, index)) return { index, operator };
    }
  }

  return null;
}

export function parseWorkflowConditionExpression(
  expression: string,
): ParsedWorkflowCondition {
  const input = expression.trim();
  if (!input) syntaxError("Condition expression is empty");

  const comparison = comparisonAt(input);
  if (!comparison) {
    const operand = parseOperand(input);
    if (operand.kind === "literal" && typeof operand.value !== "boolean") {
      syntaxError("A condition without comparison must be boolean");
    }
    return { kind: "boolean", operand };
  }

  const left = parseOperand(input.slice(0, comparison.index));
  const right = parseOperand(
    input.slice(comparison.index + comparison.operator.length),
  );
  return {
    kind: "comparison",
    left,
    operator: comparison.operator,
    right,
  };
}

function resolveReference(
  operand: Extract<Operand, { kind: "reference" }>,
  context: WorkflowConditionContext,
): unknown {
  const [root, ...path] = operand.segments;
  let current: unknown = context[root as keyof WorkflowConditionContext];

  for (const segment of path) {
    if (
      typeof current !== "object" ||
      current === null ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      throw new WorkflowConditionExpressionError(
        "workflow_condition_reference_missing",
        `Condition reference could not resolve ${operand.segments.join(".")}`,
      );
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function resolveOperand(
  operand: Operand,
  context: WorkflowConditionContext,
): unknown {
  return operand.kind === "literal"
    ? operand.value
    : resolveReference(operand, context);
}

function numericComparison(
  left: unknown,
  right: unknown,
  operator: Extract<Comparator, ">" | ">=" | "<" | "<=">,
) {
  if (
    typeof left !== "number" ||
    typeof right !== "number" ||
    !Number.isFinite(left) ||
    !Number.isFinite(right)
  ) {
    throw new WorkflowConditionExpressionError(
      "workflow_condition_type_invalid",
      `Condition operator ${operator} requires finite numeric operands`,
    );
  }
  switch (operator) {
    case ">":
      return left > right;
    case ">=":
      return left >= right;
    case "<":
      return left < right;
    case "<=":
      return left <= right;
  }
}

export function evaluateWorkflowConditionExpression(
  expression: string,
  context: WorkflowConditionContext,
): boolean {
  const parsed = parseWorkflowConditionExpression(expression);
  if (parsed.kind === "boolean") {
    const value = resolveOperand(parsed.operand, context);
    if (typeof value !== "boolean") {
      throw new WorkflowConditionExpressionError(
        "workflow_condition_type_invalid",
        "Condition reference must resolve to a boolean when no comparison is used",
      );
    }
    return value;
  }

  const left = resolveOperand(parsed.left, context);
  const right = resolveOperand(parsed.right, context);
  switch (parsed.operator) {
    case "===":
      return isDeepStrictEqual(left, right);
    case "!==":
      return !isDeepStrictEqual(left, right);
    case ">":
    case ">=":
    case "<":
    case "<=":
      return numericComparison(left, right, parsed.operator);
  }
}
