import { isDeepStrictEqual } from "node:util";

import type { Db } from "@paperclipai/db";
import type {
  AutomationArtifactGateCheck,
  AutomationArtifactGateReport,
  AutomationArtifactKind,
} from "@paperclipai/shared";

import {
  WorkflowOutputSchemaError,
  validateWorkflowOutput,
} from "../workflows/workflow-output-schema.js";
import {
  AutomationArtifactDeclarativeError,
  executeAutomationArtifactDeclarativeSource,
  validateAutomationArtifactDeclarativeSource,
} from "./automation-artifact-declarative.js";
import {
  AutomationArtifactCodeRuntimeError,
  executeAutomationArtifactTypeScriptSandbox,
  scanAndTranspileAutomationArtifactTypeScript,
} from "./automation-artifact-code-runtime.js";
import {
  automationArtifactService,
  automationArtifactVersionContentHash,
  type AutomationArtifactMutationActor,
} from "./automation-artifact-service.js";

const MAX_TEST_CASES = 50;
const DEFAULT_TEST_TIMEOUT_MS = 3_000;
const MAX_TEST_TIMEOUT_MS = 10_000;

interface ArtifactTestCase {
  name: string;
  input: unknown;
  expectedOutput: unknown;
}

interface ParsedArtifactTestSpec {
  cases: ArtifactTestCase[];
  timeoutMs: number;
}

function failedCheck(code: string, detail: string): AutomationArtifactGateCheck {
  return { code, status: "failed", detail };
}

function passedCheck(code: string, detail: string): AutomationArtifactGateCheck {
  return { code, status: "passed", detail };
}

function parseTestSpec(raw: Record<string, unknown>): ParsedArtifactTestSpec {
  const rawCases = raw.cases;
  if (!Array.isArray(rawCases) || rawCases.length === 0) {
    throw new Error("Automation Artifact testSpec.cases must contain at least one case.");
  }
  if (rawCases.length > MAX_TEST_CASES) {
    throw new Error(
      `Automation Artifact testSpec.cases may contain at most ${MAX_TEST_CASES} cases.`,
    );
  }

  const cases = rawCases.map((value, index): ArtifactTestCase => {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value)
    ) {
      throw new Error(`Automation Artifact test case ${index + 1} must be an object.`);
    }
    const record = value as Record<string, unknown>;
    const hasExpectedOutput =
      Object.prototype.hasOwnProperty.call(record, "expectedOutput") ||
      Object.prototype.hasOwnProperty.call(record, "output");
    if (
      !Object.prototype.hasOwnProperty.call(record, "input") ||
      !hasExpectedOutput
    ) {
      throw new Error(
        `Automation Artifact test case ${index + 1} requires input and output.`,
      );
    }
    const name =
      typeof record.name === "string" && record.name.trim().length > 0
        ? record.name.trim().slice(0, 160)
        : `case-${index + 1}`;
    return {
      name,
      input: record.input,
      expectedOutput: Object.prototype.hasOwnProperty.call(record, "expectedOutput")
        ? record.expectedOutput
        : record.output,
    };
  });

  const requestedTimeout =
    typeof raw.timeoutMs === "number" && Number.isFinite(raw.timeoutMs)
      ? Math.round(raw.timeoutMs)
      : DEFAULT_TEST_TIMEOUT_MS;

  return {
    cases,
    timeoutMs: Math.max(
      100,
      Math.min(requestedTimeout, MAX_TEST_TIMEOUT_MS),
    ),
  };
}

function assertSchema(
  label: "input" | "output",
  schema: Record<string, unknown>,
  value: unknown,
) {
  try {
    validateWorkflowOutput(schema, value);
  } catch (error) {
    if (error instanceof WorkflowOutputSchemaError) {
      throw new Error(
        `Automation Artifact ${label} schema validation failed.`,
      );
    }
    throw error;
  }
}

async function executeCase(input: {
  kind: AutomationArtifactKind;
  sourceCode: string;
  dependencyManifest: Record<string, unknown>;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  value: unknown;
  timeoutMs: number;
}) {
  assertSchema("input", input.inputSchema, input.value);

  let output: unknown;
  if (input.kind === "expression" || input.kind === "transform") {
    output = executeAutomationArtifactDeclarativeSource(
      input.kind,
      input.sourceCode,
      input.value,
    );
  } else if (input.kind === "typescript") {
    output = await executeAutomationArtifactTypeScriptSandbox({
      sourceCode: input.sourceCode,
      dependencyManifest: input.dependencyManifest,
      value: input.value,
      timeoutMs: input.timeoutMs,
    });
  } else {
    throw new Error(
      `Automation Artifact runtime is not qualified for ${input.kind}.`,
    );
  }

  assertSchema("output", input.outputSchema, output);
  return output;
}

function report(input: {
  kind: "validation" | "security";
  contentHash: string;
  checks: AutomationArtifactGateCheck[];
  checkedAt: Date;
}): AutomationArtifactGateReport {
  return {
    schema: "automation_artifact_gate.v1",
    kind: input.kind,
    status: input.checks.every((check) => check.status === "passed")
      ? "passed"
      : "failed",
    contentHash: input.contentHash,
    checkedAt: input.checkedAt.toISOString(),
    checks: input.checks,
  };
}

export function automationArtifactSecurityService(db: Db) {
  const artifacts = automationArtifactService(db);

  return {
    evaluateLatestVersion: async (
      companyId: string,
      artifactId: string,
      actor: AutomationArtifactMutationActor,
    ) => {
      if (actor.principal.type !== "system") {
        throw new Error(
          "Automation Artifact security evaluation requires a system principal.",
        );
      }

      const detail = await artifacts.getDetail(companyId, artifactId, actor);
      if (!detail?.latestVersion) {
        throw new Error("Automation Artifact latest version is unavailable.");
      }
      const { artifact, latestVersion: version } = detail;
      const checkedAt = new Date();

      const recomputedHash = automationArtifactVersionContentHash({
        kind: artifact.kind,
        language: artifact.language,
        sourceCode: version.sourceCode,
        inputSchema: version.inputSchema,
        outputSchema: version.outputSchema,
        dependencyManifest: version.dependencyManifest,
        testSpec: version.testSpec,
      });

      // Native gate receipts are finalized once for this immutable content hash.
      // Re-evaluation verifies content integrity and reuses the original
      // receipts instead of changing their checkedAt values.
      if (recomputedHash === version.contentHash &&
        version.validationReport?.contentHash === version.contentHash &&
        version.securityReport?.contentHash === version.contentHash) return detail;

      const validationChecks: AutomationArtifactGateCheck[] = [];
      const securityChecks: AutomationArtifactGateCheck[] = [];

      if (recomputedHash !== version.contentHash) {
        validationChecks.push(
          failedCheck(
            "content_hash",
            "Persisted artifact content does not match its immutable content hash.",
          ),
        );
        securityChecks.push(
          failedCheck(
            "content_hash",
            "Security evaluation stopped because content integrity failed.",
          ),
        );
      } else {
        validationChecks.push(
          passedCheck(
            "content_hash",
            "Persisted artifact content matches the immutable content hash.",
          ),
        );
        securityChecks.push(
          passedCheck(
            "content_hash",
            "Security evaluation is bound to the immutable content hash.",
          ),
        );
      }

      let tests: ParsedArtifactTestSpec | null = null;
      try {
        tests = parseTestSpec(version.testSpec);
        validationChecks.push(
          passedCheck(
            "test_spec",
            `${tests.cases.length} bounded artifact test case(s) are defined.`,
          ),
        );
      } catch (error) {
        validationChecks.push(
          failedCheck(
            "test_spec",
            error instanceof Error ? error.message : "Artifact test specification is invalid.",
          ),
        );
      }

      try {
        if (artifact.kind === "expression" || artifact.kind === "transform") {
          validateAutomationArtifactDeclarativeSource(
            artifact.kind,
            version.sourceCode,
          );
          validationChecks.push(
            passedCheck(
              "source_validation",
              "Declarative source parsed successfully.",
            ),
          );
          securityChecks.push(
            passedCheck(
              "runtime_boundary",
              "Declarative artifacts execute only in the existing input-scoped expression runtime.",
            ),
          );
        } else if (artifact.kind === "typescript") {
          const scan = scanAndTranspileAutomationArtifactTypeScript({
            sourceCode: version.sourceCode,
            dependencyManifest: version.dependencyManifest,
          });
          validationChecks.push(
            passedCheck(
              "source_validation",
              "TypeScript parsed and transpiled successfully.",
            ),
          );
          securityChecks.push(...scan.checks);
          securityChecks.push(
            passedCheck(
              "sandbox_policy",
              "Execution requires Linux bwrap isolation, denied network, no inherited environment, bounded resources, and bounded output.",
            ),
          );
        } else {
          validationChecks.push(
            failedCheck(
              "runtime_qualification",
              `Runtime qualification for ${artifact.kind} is not implemented.`,
            ),
          );
          securityChecks.push(
            failedCheck(
              "runtime_qualification",
              `Runtime qualification for ${artifact.kind} is not implemented.`,
            ),
          );
        }
      } catch (error) {
        const detail =
          error instanceof AutomationArtifactCodeRuntimeError ||
          error instanceof AutomationArtifactDeclarativeError
            ? error.message
            : "Artifact source failed validation.";
        validationChecks.push(failedCheck("source_validation", detail));
        securityChecks.push(
          failedCheck(
            "source_policy",
            "Artifact source did not satisfy the generated-code security policy.",
          ),
        );
      }

      if (tests && validationChecks.every((check) => check.status === "passed")) {
        let passed = 0;
        let failed = 0;
        for (const testCase of tests.cases) {
          try {
            const output = await executeCase({
              kind: artifact.kind,
              sourceCode: version.sourceCode,
              dependencyManifest: version.dependencyManifest,
              inputSchema: version.inputSchema,
              outputSchema: version.outputSchema,
              value: testCase.input,
              timeoutMs: tests.timeoutMs,
            });
            if (!isDeepStrictEqual(output, testCase.expectedOutput)) {
              failed += 1;
              continue;
            }
            passed += 1;
          } catch (error) {
            if (
              error instanceof AutomationArtifactCodeRuntimeError &&
              (
                error.code === "automation_artifact_code_runtime_unsupported_platform" ||
                error.code === "automation_artifact_code_runtime_unavailable"
              )
            ) {
              throw error;
            }
            failed += 1;
          }
        }
        if (failed === 0) {
          validationChecks.push(
            passedCheck(
              "tests",
              `All ${passed} artifact test case(s) passed.`,
            ),
          );
          securityChecks.push(
            passedCheck(
              "sandbox_tests",
              `All ${passed} artifact test case(s) completed inside the qualified execution boundary.`,
            ),
          );
        } else {
          validationChecks.push(
            failedCheck(
              "tests",
              `${failed} of ${tests.cases.length} artifact test case(s) failed.`,
            ),
          );
          securityChecks.push(
            failedCheck(
              "sandbox_tests",
              "At least one bounded artifact test did not complete successfully.",
            ),
          );
        }
      }

      const validationReport = report({
        kind: "validation",
        contentHash: version.contentHash,
        checks: validationChecks,
        checkedAt,
      });
      const securityReport = report({
        kind: "security",
        contentHash: version.contentHash,
        checks: securityChecks,
        checkedAt,
      });

      return artifacts.recordGateReports(
        companyId,
        artifact.id,
        version.id,
        { validationReport, securityReport },
        actor,
      );
    },
  };
}
