import {lockAnalyticalCompany} from "../analytical-privacy.js";
import {lockMemoryPrivacy} from "../memory/memory-privacy.js";
import {assertLearnedAssetAnalyticalSources} from "../learning/learning-analytical-sources.js";
import { automationArtifacts, automationArtifactVersions, type Db } from "@paperclipai/db";
import { and, eq } from "drizzle-orm";
import {
  automationArtifactGateReportSchema,
  type AutomationArtifactRuntimeBinding,
  type AutomationArtifact,
  type AutomationArtifactVersion,
} from "@paperclipai/shared";
import { conflict, notFound, unprocessable } from "../../errors.js";
import { instanceSettingsService } from "../instance-settings.js";
import {
  WorkflowOutputSchemaError,
  validateWorkflowOutput,
} from "../workflows/workflow-output-schema.js";
import {
  AutomationArtifactDeclarativeError,
  executeAutomationArtifactDeclarativeSource,
} from "./automation-artifact-declarative.js";
import {
  AutomationArtifactCodeRuntimeError,
} from "./automation-artifact-code-runtime.js";
import { executeNativeArtifactCode } from "./automation-artifact-workspace.js";
import {
  automationArtifactService,
  automationArtifactVersionContentHash,
  type AutomationArtifactMutationActor,
} from "./automation-artifact-service.js";

function validateValueAgainstSchema(
  direction: "input" | "output",
  schema: Record<string, unknown>,
  value: unknown,
) {
  try {
    validateWorkflowOutput(schema, value);
  } catch (error) {
    if (error instanceof WorkflowOutputSchemaError) {
      throw unprocessable(
        `Automation Artifact ${direction} failed schema validation`,
        {
          code:
            error.code === "workflow_output_schema_invalid"
              ? `automation_artifact_${direction}_schema_invalid`
              : `automation_artifact_${direction}_schema_mismatch`,
          validationErrors: error.validationErrors,
        },
      );
    }
    throw error;
  }
}

/**
 * PR 40 runtime boundary.
 *
 * It resolves an immutable active version and executes only the existing safe
 * expression/transform language. There is no host JavaScript/Python execution,
 * dependency install, network access, filesystem access, or secret access here.
 * PR 41 owns sandbox execution for generated code and the gates required before
 * any artifact may enter active/shadow state.
 */
export function automationArtifactRuntimeService(db: Db) {
  const artifacts = automationArtifactService(db);
  const settings = instanceSettingsService(db);

  function qualifiedBinding(artifact: AutomationArtifact, latestVersion: AutomationArtifactVersion): AutomationArtifactRuntimeBinding {
    const validation = automationArtifactGateReportSchema.safeParse(
      latestVersion.validationReport,
    );
    const security = automationArtifactGateReportSchema.safeParse(
      latestVersion.securityReport,
    );
    const gates = [
      { expectedKind: "validation" as const, parsed: validation },
      { expectedKind: "security" as const, parsed: security },
    ];
    for (const gate of gates) {
      if (
        !gate.parsed.success ||
        gate.parsed.data.kind !== gate.expectedKind ||
        gate.parsed.data.status !== "passed" ||
        gate.parsed.data.contentHash !== latestVersion.contentHash
      ) {
        throw conflict(
          "Automation Artifact version has not completed validation and security gates",
          {
            code: "automation_artifact_validation_required",
            artifactVersionId: latestVersion.id,
            gate: gate.expectedKind,
          },
        );
      }
    }

    const recomputedHash = automationArtifactVersionContentHash({
      kind: artifact.kind,
      language: artifact.language,
      sourceCode: latestVersion.sourceCode,
      inputSchema: latestVersion.inputSchema,
      outputSchema: latestVersion.outputSchema,
      dependencyManifest: latestVersion.dependencyManifest,
      testSpec: latestVersion.testSpec,
    });
    if (recomputedHash !== latestVersion.contentHash) {
      throw conflict("Automation Artifact version integrity check failed", {
        code: "automation_artifact_integrity_mismatch",
        artifactVersionId: latestVersion.id,
      });
    }

    return {
      artifactId: artifact.id,
      artifactVersionId: latestVersion.id,
      companyId: artifact.companyId,
      kind: artifact.kind,
      language: artifact.language,
      inputSchema: latestVersion.inputSchema,
      outputSchema: latestVersion.outputSchema,
      riskClass: artifact.riskClass,
      sideEffectClass: artifact.sideEffectClass,
      contentHash: latestVersion.contentHash,
      sourceCode: latestVersion.sourceCode,
      dependencyManifest: latestVersion.dependencyManifest,
    };
  }


  /** Immutable consumer inspection. Historical bindings are never executed;
   * every current execution still requires the exact active-version pointer. */
  async function inspectPinnedBinding(
    companyId: string,
    artifactId: string,
    versionId: string | null,
    actor: AutomationArtifactMutationActor,
    requireCurrent = true,
  ): Promise<{ binding: AutomationArtifactRuntimeBinding; current: boolean; optimizerDerived: boolean }> {
    if ((await settings.getExperimental()).enableAutomationArtifactsV1 !== true) {
      throw notFound("Automation Artifacts are not enabled", { code: "automation_artifacts_disabled" });
    }
    await lockAnalyticalCompany(db,companyId);await lockMemoryPrivacy(db,companyId);
    // Lock the native root before its version, as the canonical mutation owner
    // does. A consumer transaction cannot race revocation or pointer changes.
    const [root] = await db.select().from(automationArtifacts).where(and(
      eq(automationArtifacts.companyId, companyId), eq(automationArtifacts.id, artifactId),
    )).for("share");
    const detail = await artifacts.getDetail(companyId, artifactId, actor);
    if (!root || !detail) throw notFound("Automation Artifact not found");
    const selected = versionId ?? root.latestVersionId;
    const [version] = selected ? await db.select().from(automationArtifactVersions).where(and(
      eq(automationArtifactVersions.companyId, companyId), eq(automationArtifactVersions.artifactId, artifactId),
      eq(automationArtifactVersions.id, selected),
    )).for("share") : [];
    if (!version) throw notFound("Automation Artifact version is unavailable");
    const current = !detail.artifact.archivedAt && detail.artifact.status === "active" && root.latestVersionId === version.id;
    if (requireCurrent && !current) {
      throw conflict("Automation Artifact is inactive or its active version changed", {
        code: root.latestVersionId !== version.id ? "revision_conflict" : "automation_artifact_not_active",
        expectedVersionId: versionId, currentVersionId: root.latestVersionId, status: detail.artifact.status,
      });
    }
    // Source-derived execution requires its native retention bridge. An
    // in-process read principal alone cannot retain the resulting runtime copy.
    await assertLearnedAssetAnalyticalSources(db,companyId,"automation_artifact_version",version.id);
    // getDetail applies the existing optimizer privacy admission. Do not expose
    // a historical unredacted binding when that owner has erased its source.
    if (root.createdByOptimizerSuggestionId && detail.latestVersion?.sourceCode === "") {
      throw notFound("Automation Artifact source was erased");
    }
    return { binding: qualifiedBinding(detail.artifact, version), current, optimizerDerived: root.createdByOptimizerSuggestionId !== null };
  }

  async function resolveActiveBinding(
    companyId: string,
    artifactId: string,
    expectedVersionId: string | null,
    actor: AutomationArtifactMutationActor,
  ): Promise<AutomationArtifactRuntimeBinding> {
    const experimental = await settings.getExperimental();
    if (experimental.enableAutomationArtifactsV1 !== true) {
      throw notFound("Automation Artifacts are not enabled", {
        code: "automation_artifacts_disabled",
      });
    }

    const detail = await artifacts.getDetail(companyId, artifactId, actor);
    if (!detail) throw notFound("Automation Artifact not found");

    const { artifact, latestVersion } = detail;
    if(latestVersion)await assertLearnedAssetAnalyticalSources(db,companyId,"automation_artifact_version",latestVersion.id);
    if (
      artifact.archivedAt ||
      artifact.status !== "active" ||
      !latestVersion
    ) {
      throw conflict("Automation Artifact is not active", {
        code: "automation_artifact_not_active",
        status: artifact.status,
        archived: artifact.archivedAt !== null,
      });
    }
    if (
      expectedVersionId !== null &&
      latestVersion.id !== expectedVersionId
    ) {
      throw conflict("Automation Artifact active version changed", {
        code: "revision_conflict",
        expectedVersionId,
        currentVersionId: latestVersion.id,
      });
    }

    return qualifiedBinding(artifact, latestVersion);
  }

  return {
    resolveActiveBinding,
    inspectPinnedBinding,

    execute: async (
      companyId: string,
      artifactId: string,
      expectedVersionId: string,
      input: unknown,
      actor: AutomationArtifactMutationActor,
      options: { timeoutMs?: number; deterministic?: boolean } = {},
    ) => {
      const binding = await resolveActiveBinding(
        companyId,
        artifactId,
        expectedVersionId,
        actor,
      );

      validateValueAgainstSchema("input", binding.inputSchema, input);

      if (binding.kind === "expression" || binding.kind === "transform") {
        if (binding.sideEffectClass !== "pure") {
          throw conflict(
            "Declarative Automation Artifacts must remain pure",
            {
              code: "automation_artifact_side_effect_denied",
              sideEffectClass: binding.sideEffectClass,
            },
          );
        }
        let output: unknown;
        try {
          output = executeAutomationArtifactDeclarativeSource(
            binding.kind,
            binding.sourceCode,
            input,
          );
        } catch (error) {
          if (error instanceof AutomationArtifactDeclarativeError) {
            throw unprocessable(error.message, { code: error.code });
          }
          throw error;
        }
        validateValueAgainstSchema("output", binding.outputSchema, output);
        return { binding, output };
      }

      if (binding.kind !== "typescript") {
        throw conflict(
          "Automation Artifact runtime is not qualified for this artifact kind",
          {
            code: "automation_artifact_runtime_not_qualified",
            artifactKind: binding.kind,
          },
        );
      }

      const experimental = await settings.getExperimental();
      if (experimental.enableAutomationArtifactCodeExecutionV1 !== true) {
        throw notFound("Generated-code Automation Artifact execution is disabled", {
          code: "automation_artifact_code_execution_disabled",
        });
      }
      if (
        binding.sideEffectClass !== "pure" ||
        (binding.riskClass !== "C0" && binding.riskClass !== "C1")
      ) {
        throw conflict(
          "Generated-code pilot is restricted to pure C0/C1 artifacts",
          {
            code: "automation_artifact_code_execution_risk_denied",
            riskClass: binding.riskClass,
            sideEffectClass: binding.sideEffectClass,
          },
        );
      }

      let output: unknown;
      try {
        output = await executeNativeArtifactCode(db, { companyId, versionId: binding.artifactVersionId }, actor, {
          sourceCode: binding.sourceCode,
          dependencyManifest: binding.dependencyManifest,
          value: input,
          timeoutMs: options.timeoutMs,
          deterministic: options.deterministic,
        });
      } catch (error) {
        if (error instanceof AutomationArtifactCodeRuntimeError) {
          throw unprocessable(
            "Automation Artifact generated-code execution failed",
            { code: error.code },
          );
        }
        throw error;
      }

      validateValueAgainstSchema("output", binding.outputSchema, output);
      return { binding, output };
    },

    executeDeclarative: async (
      companyId: string,
      artifactId: string,
      expectedVersionId: string,
      input: unknown,
      actor: AutomationArtifactMutationActor,
    ) => {
      const binding = await resolveActiveBinding(
        companyId,
        artifactId,
        expectedVersionId,
        actor,
      );
      if (
        (binding.kind !== "expression" && binding.kind !== "transform") ||
        binding.sideEffectClass !== "pure"
      ) {
        throw conflict(
          "Automation Artifact kind requires the PR 41 governed execution runtime",
          {
            code: "automation_artifact_runtime_not_available",
            artifactKind: binding.kind,
            sideEffectClass: binding.sideEffectClass,
          },
        );
      }

      validateValueAgainstSchema("input", binding.inputSchema, input);

      let output: unknown;
      try {
        output = executeAutomationArtifactDeclarativeSource(
          binding.kind,
          binding.sourceCode,
          input,
        );
      } catch (error) {
        if (error instanceof AutomationArtifactDeclarativeError) {
          throw unprocessable(error.message, { code: error.code });
        }
        throw error;
      }

      validateValueAgainstSchema("output", binding.outputSchema, output);
      return { binding, output };
    },
  };
}
