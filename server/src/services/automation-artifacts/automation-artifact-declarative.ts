import type { AutomationArtifactKind } from "@paperclipai/shared";
import {
  evaluateWorkflowTransformExpression,
  evaluateWorkflowTransformMapping,
  parseWorkflowTransformExpression,
  type WorkflowTransformContext,
} from "../workflows/workflow-transform-expression.js";

export class AutomationArtifactDeclarativeError extends Error {
  readonly code:
    | "automation_artifact_source_invalid"
    | "automation_artifact_reference_scope_denied";

  constructor(
    code: AutomationArtifactDeclarativeError["code"],
    message: string,
  ) {
    super(message);
    this.name = "AutomationArtifactDeclarativeError";
    this.code = code;
  }
}

const REFERENCE_RE = /\{\{([^{}]+)\}\}/gu;
const SAFE_MAPPING_KEY_RE = /^[^\u0000]{1,160}$/u;
const FORBIDDEN_MAPPING_KEYS = new Set([
  "__proto__",
  "prototype",
  "constructor",
]);

function assertInputOnlyReferences(expression: string) {
  parseWorkflowTransformExpression(expression);
  for (const match of expression.matchAll(REFERENCE_RE)) {
    const reference = match[1]?.trim() ?? "";
    const root = /^[A-Za-z_$][A-Za-z0-9_$]*/u.exec(reference)?.[0] ?? "";
    if (root !== "input") {
      throw new AutomationArtifactDeclarativeError(
        "automation_artifact_reference_scope_denied",
        "Automation Artifact expressions may only read the explicit input object",
      );
    }
  }
}

function parseTransformMapping(sourceCode: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(sourceCode);
  } catch {
    throw new AutomationArtifactDeclarativeError(
      "automation_artifact_source_invalid",
      "Transform artifact source must be a JSON object mapping output keys to expressions",
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new AutomationArtifactDeclarativeError(
      "automation_artifact_source_invalid",
      "Transform artifact source must be a JSON object",
    );
  }

  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length > 200) {
    throw new AutomationArtifactDeclarativeError(
      "automation_artifact_source_invalid",
      "Transform artifact source may define at most 200 output fields",
    );
  }

  const mapping: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  for (const [key, value] of entries) {
    if (
      !SAFE_MAPPING_KEY_RE.test(key) ||
      FORBIDDEN_MAPPING_KEYS.has(key) ||
      typeof value !== "string"
    ) {
      throw new AutomationArtifactDeclarativeError(
        "automation_artifact_source_invalid",
        "Transform artifact mappings require safe string keys and string expressions",
      );
    }
    assertInputOnlyReferences(value);
    mapping[key] = value;
  }
  return mapping;
}

export function validateAutomationArtifactDeclarativeSource(
  kind: AutomationArtifactKind,
  sourceCode: string,
): void {
  if (kind === "expression") {
    assertInputOnlyReferences(sourceCode);
    return;
  }
  if (kind === "transform") {
    parseTransformMapping(sourceCode);
  }
}

export function executeAutomationArtifactDeclarativeSource(
  kind: Extract<AutomationArtifactKind, "expression" | "transform">,
  sourceCode: string,
  input: unknown,
): unknown {
  const context: WorkflowTransformContext = {
    input,
    trigger: {},
    variables: {},
    steps: {},
  };
  if (kind === "expression") {
    assertInputOnlyReferences(sourceCode);
    return evaluateWorkflowTransformExpression(sourceCode, context);
  }
  return evaluateWorkflowTransformMapping(
    parseTransformMapping(sourceCode),
    context,
  );
}
