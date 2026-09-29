const ROOTS = new Set(["input", "trigger", "variables", "steps"]);

export interface WorkflowTransformContext {
  input: unknown;
  trigger: Record<string, unknown>;
  variables: Record<string, unknown>;
  steps: Record<string, unknown>;
}

export class WorkflowTransformExpressionError extends Error {
  readonly code:
    | "workflow_transform_expression_invalid"
    | "workflow_transform_reference_missing"
    | "workflow_transform_interpolation_type_invalid";

  constructor(
    code: WorkflowTransformExpressionError["code"],
    message: string,
  ) {
    super(message);
    this.name = "WorkflowTransformExpressionError";
    this.code = code;
  }
}

function expressionError(message: string): never {
  throw new WorkflowTransformExpressionError(
    "workflow_transform_expression_invalid",
    message,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseReferencePath(raw: string): string[] {
  const input = raw.trim();
  const root = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(input);
  if (!root) {
    expressionError("Transform reference must start with input, trigger, variables or steps");
  }

  const segments = [root[0]];
  if (!ROOTS.has(segments[0]!)) {
    expressionError("Transform references may only read input, trigger, variables or steps");
  }

  let index = root[0].length;
  while (index < input.length) {
    const char = input[index];
    if (char === ".") {
      const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(input.slice(index + 1));
      if (!identifier) expressionError("Invalid dotted transform reference");
      segments.push(identifier[0]);
      index += identifier[0].length + 1;
      continue;
    }

    if (char === "[") {
      const remaining = input.slice(index + 1);
      if (!remaining.startsWith('"')) {
        expressionError("Transform bracket references must use a JSON string key");
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
        expressionError("Unterminated transform reference key");
      }

      const literal = remaining.slice(0, cursor + 1);
      let key: unknown;
      try {
        key = JSON.parse(literal);
      } catch {
        expressionError("Invalid JSON string in transform reference");
      }
      if (typeof key !== "string" || key.length === 0) {
        expressionError("Transform reference keys must be non-empty strings");
      }
      if (remaining[cursor + 1] !== "]") {
        expressionError("Transform bracket reference is missing ]");
      }
      segments.push(key);
      index += cursor + 3;
      continue;
    }

    expressionError("Transform reference contains unsupported syntax");
  }

  return segments;
}

function referenceRoot(
  root: string | undefined,
  context: WorkflowTransformContext,
): unknown {
  switch (root) {
    case "input":
      return context.input;
    case "trigger":
      return context.trigger;
    case "variables":
      return context.variables;
    case "steps":
      return context.steps;
    default:
      expressionError("Transform reference has an unsupported root");
  }
}

function resolveReference(
  rawReference: string,
  context: WorkflowTransformContext,
): unknown {
  const segments = parseReferencePath(rawReference);
  const [root, ...path] = segments;
  let current: unknown = referenceRoot(root, context);

  for (const segment of path) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      throw new WorkflowTransformExpressionError(
        "workflow_transform_reference_missing",
        `Transform reference could not resolve ${segments.join(".")}`,
      );
    }
    current = current[segment];
  }

  return current;
}

export function parseWorkflowTransformExpression(expression: string): void {
  if (expression.length > 10_000) {
    expressionError("Transform expression exceeds 10000 characters");
  }

  let index = 0;
  let foundReference = false;
  while (index < expression.length) {
    const open = expression.indexOf("{{", index);
    const closeWithoutOpen = expression.indexOf("}}", index);

    if (open === -1) {
      if (closeWithoutOpen !== -1) {
        expressionError("Transform reference delimiters are incomplete");
      }
      break;
    }

    if (closeWithoutOpen !== -1 && closeWithoutOpen < open) {
      expressionError("Transform reference delimiters are incomplete");
    }

    const close = expression.indexOf("}}", open + 2);
    if (close === -1) {
      expressionError("Transform reference delimiters are incomplete");
    }

    const inner = expression.slice(open + 2, close).trim();
    if (!inner) expressionError("Transform reference is empty");
    parseReferencePath(inner);
    foundReference = true;
    index = close + 2;
  }

  if (!foundReference && (expression.includes("{{") || expression.includes("}}"))) {
    expressionError("Transform reference delimiters are incomplete");
  }
}

export function evaluateWorkflowTransformExpression(
  expression: string,
  context: WorkflowTransformContext,
): unknown {
  parseWorkflowTransformExpression(expression);

  const trimmed = expression.trim();
  const fullReference = /^\{\{([\s\S]+)\}\}$/.exec(trimmed);
  if (fullReference) {
    return resolveReference(fullReference[1]!, context);
  }

  let output = "";
  let index = 0;
  while (index < expression.length) {
    const open = expression.indexOf("{{", index);
    if (open === -1) {
      output += expression.slice(index);
      break;
    }

    output += expression.slice(index, open);
    const close = expression.indexOf("}}", open + 2);
    if (close === -1) {
      expressionError("Transform reference delimiters are incomplete");
    }

    const value = resolveReference(
      expression.slice(open + 2, close).trim(),
      context,
    );
    if (
      value !== null &&
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      throw new WorkflowTransformExpressionError(
        "workflow_transform_interpolation_type_invalid",
        "Embedded transform references must resolve to a scalar value",
      );
    }

    output += value === null ? "null" : String(value);
    index = close + 2;
  }

  return output;
}

export function evaluateWorkflowTransformMapping(
  mapping: Record<string, string>,
  context: WorkflowTransformContext,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(mapping).map(([key, expression]) => [
      key,
      evaluateWorkflowTransformExpression(expression, context),
    ]),
  );
}
