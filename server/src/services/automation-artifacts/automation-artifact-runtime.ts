import type { Db } from "@paperclipai/db";
import {
  automationArtifactGateReportSchema,
  type AutomationArtifactRuntimeBinding,
} from "@paperclipai/shared";
import { conflict, notFound } from "../../errors.js";
import { instanceSettingsService } from "../instance-settings.js";
import {
  automationArtifactService,
  automationArtifactVersionContentHash,
  type AutomationArtifactMutationActor,
} from "./automation-artifact-service.js";

/**
 * PR 40 runtime boundary.
 *
 * This resolves one immutable, explicitly active artifact version. It does not
 * execute generated code. PR 41 owns sandbox execution and the validation /
 * security reports required before any artifact may enter active/shadow state.
 */
export function automationArtifactRuntimeService(db: Db) {
  const artifacts = automationArtifactService(db);
  const settings = instanceSettingsService(db);

  return {
    resolveActiveBinding: async (
      companyId: string,
      artifactId: string,
      expectedVersionId: string | null,
      actor: AutomationArtifactMutationActor,
    ): Promise<AutomationArtifactRuntimeBinding> => {
      const experimental = await settings.getExperimental();
      if (experimental.enableAutomationArtifactsV1 !== true) {
        throw notFound("Automation Artifacts are not enabled", {
          code: "automation_artifacts_disabled",
        });
      }

      const detail = await artifacts.getDetail(companyId, artifactId, actor);
      if (!detail) throw notFound("Automation Artifact not found");

      const { artifact, latestVersion } = detail;
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
    },
  };
}
