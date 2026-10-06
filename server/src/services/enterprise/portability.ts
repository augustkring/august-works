import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  foundationDocuments,
  foundationSections,
  documents,
  documentRevisions,
  memoryObservations,
  memoryModels,
  memoryRetentionPolicies,
  cognitiveMemoryBindings,
  rolePacks,
  rolePackVersions,
  rolePackItems,
  agentRolePackAssignments,
  playbookDocuments,
  playbookSkillLinks,
  companyAgentPackageInstallations,
  agentPackages,
  agentPackageVersions,
  aiUseCases,
  aiUseCaseVersions,
  aiUseCaseAssessments,
  aiUseCaseDeployments,
  humanOversightProfiles,
  governanceObligations,
  workflows,
  workflowRevisions,
  activityLog,
  learningRetainedAssets,
  type Db,
} from "@paperclipai/db";
import type { CompanyStateExport } from "@paperclipai/shared";
import type { AuthorizationActor } from "../authorization.js";
import { enterpriseOwner } from "./authority.js";
import { assertV7Authorization } from "../v7-authorization.js";
import { memoryService } from "../memory/memory-service.js";
import { cognitiveMemoryActor } from "../memory/cognitive-memory.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { observationLineage, modelLineage } from "../memory/derived-memory.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { sanitizeRecord } from "../../redaction.js";
/** Rollout and commercial gates deliberately do not restrict owner portability.
 * Existing company bundles carry agents, Skills, Projects, Tasks and artifacts;
 * this native extension carries the customer-created V7 state and references. */
export async function exportCompanyStateV7(
  db: Db,
  actor: AuthorizationActor,
  companyId: string,
): Promise<CompanyStateExport> {
  return db.transaction(async (tx) => {
    const nativeDb = tx as unknown as Db;
    await enterpriseOwner(nativeDb, actor, companyId);
    await lockMemoryPrivacy(nativeDb, companyId);
    const files: Record<string, string> = {};
    const write = (path: string, value: Record<string, unknown>) => {
      // Normalize dates before the existing recursive credential redactor.
      files[path] =
        JSON.stringify(
          sanitizeRecord(JSON.parse(JSON.stringify(value))),
          null,
          2,
        ) + "\n";
    };
    const memory = await memoryService(nativeDb).export(
      companyId,
      cognitiveMemoryActor(actor),
    );
    write("memory/records.json", memory);
    write("memory/retention.json", {
      policies: await tx
        .select()
        .from(memoryRetentionPolicies)
        .where(eq(memoryRetentionPolicies.companyId, companyId)),
    });
    write("memory/provider-bindings.json", {
      bindings: await tx
        .select({
          id: cognitiveMemoryBindings.id,
          scopeType: cognitiveMemoryBindings.scopeType,
          scopeId: cognitiveMemoryBindings.scopeId,
          purpose: cognitiveMemoryBindings.purpose,
          providerKey: cognitiveMemoryBindings.providerKey,
          status: cognitiveMemoryBindings.status,
        })
        .from(cognitiveMemoryBindings)
        .where(eq(cognitiveMemoryBindings.companyId, companyId)),
    });
    const observationRows = await tx
      .select()
      .from(memoryObservations)
      .where(
        and(
          eq(memoryObservations.companyId, companyId),
          isNull(memoryObservations.erasedAt),
        ),
      );
    const observationExports: unknown[] = [];
    for (const row of observationRows) {
      try {
        const lineage = await observationLineage(nativeDb, actor, row);
        observationExports.push({ ...row, evidence: lineage.evidence });
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "status" in error &&
          [403, 404, 409].includes(Number(error.status))
        ) {
          if (Number(error.status) === 409)
            observationExports.push({
              id: row.id,
              version: row.version,
              status: row.status,
              payloadOmitted: "source_baseline_changed",
            });
        } else throw error;
      }
    }
    write("memory/observations.json", { observations: observationExports });
    const modelRows = await tx
      .select()
      .from(memoryModels)
      .where(
        and(
          eq(memoryModels.companyId, companyId),
          isNull(memoryModels.erasedAt),
        ),
      );
    const modelExports: unknown[] = [];
    for (const row of modelRows) {
      try {
        const lineage = await modelLineage(nativeDb, actor, row);
        modelExports.push({ ...row, evidence: lineage.evidence });
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "status" in error &&
          [403, 404, 409].includes(Number(error.status))
        ) {
          if (Number(error.status) === 409)
            modelExports.push({
              id: row.id,
              version: row.version,
              status: row.status,
              payloadOmitted: "source_baseline_changed",
            });
        } else throw error;
      }
    }
    write("memory/models.json", { models: modelExports });
    const foundation = await tx
      .select()
      .from(foundationDocuments)
      .where(eq(foundationDocuments.companyId, companyId));
    const playbooks = await tx
      .select()
      .from(playbookDocuments)
      .where(eq(playbookDocuments.companyId, companyId));
    const documentIds = [
      ...new Set([...foundation, ...playbooks].map((d) => d.documentId)),
    ];
    const erasedRevisions = await tx
      .select({
        id: learningRetainedAssets.assetId,
        type: learningRetainedAssets.assetType,
      })
      .from(learningRetainedAssets)
      .where(
        and(
          eq(learningRetainedAssets.companyId, companyId),
          sql`${learningRetainedAssets.erasedAt} is not null`,
        ),
      );
    const erased = new Set(
      erasedRevisions
        .filter((r) => r.type === "document_revision")
        .map((r) => r.id),
    );
    const erasedRoles = new Set(
      erasedRevisions
        .filter((r) => r.type === "role_pack_version")
        .map((r) => r.id),
    );
    const erasedWorkflows = new Set(
      erasedRevisions
        .filter((r) => r.type === "workflow_revision")
        .map((r) => r.id),
    );
    const revisions = documentIds.length
      ? await tx
          .select()
          .from(documentRevisions)
          .where(
            and(
              eq(documentRevisions.companyId, companyId),
              inArray(documentRevisions.documentId, documentIds),
            ),
          )
      : [];
    const currentDocuments = documentIds.length
      ? await tx
          .select()
          .from(documents)
          .where(
            and(
              eq(documents.companyId, companyId),
              inArray(documents.id, documentIds),
            ),
          )
      : [];
    write("foundation/documents.json", {
      foundation,
      sections: await tx
        .select()
        .from(foundationSections)
        .where(eq(foundationSections.companyId, companyId)),
    });
    write("playbooks/documents.json", {
      playbooks,
      links: await tx
        .select()
        .from(playbookSkillLinks)
        .where(eq(playbookSkillLinks.companyId, companyId)),
    });
    write("knowledge/revisions.json", {
      documents: currentDocuments.map((d) =>
        erased.has(d.latestRevisionId ?? "")
          ? { id: d.id, payloadOmitted: "erased" }
          : d,
      ),
      revisions: revisions.filter((r) => !erased.has(r.id)),
    });
    write("role-packs/roles.json", {
      packs: await tx
        .select()
        .from(rolePacks)
        .where(eq(rolePacks.companyId, companyId)),
      versions: (
        await tx
          .select()
          .from(rolePackVersions)
          .where(eq(rolePackVersions.companyId, companyId))
      ).map((r) =>
        erasedRoles.has(r.id)
          ? {
              id: r.id,
              rolePackId: r.rolePackId,
              revisionNumber: r.revisionNumber,
              payloadOmitted: "erased",
            }
          : r,
      ),
      items: (
        await tx
          .select()
          .from(rolePackItems)
          .where(eq(rolePackItems.companyId, companyId))
      ).filter((r) => !erasedRoles.has(r.versionId)),
      assignments: await tx
        .select()
        .from(agentRolePackAssignments)
        .where(eq(agentRolePackAssignments.companyId, companyId)),
    });
    const installations = await tx
      .select()
      .from(companyAgentPackageInstallations)
      .where(eq(companyAgentPackageInstallations.companyId, companyId));
    const versions = installations.length
      ? await tx
          .select({
            id: agentPackageVersions.id,
            packageId: agentPackageVersions.packageId,
            version: agentPackageVersions.version,
            release: agentPackageVersions.release,
          })
          .from(agentPackageVersions)
          .where(
            inArray(
              agentPackageVersions.id,
              installations.map((i) => i.installedVersionId),
            ),
          )
      : [];
    write("agent-packages/deployments.json", {
      installations,
      versions: versions.map((v) => ({
        id: v.id,
        packageId: v.packageId,
        version: v.version,
        manifest: v.release.manifest,
        license: v.release.manifest.license,
        componentRefs: v.release.components,
      })),
      packages: installations.length
        ? await tx
            .select()
            .from(agentPackages)
            .where(
              inArray(
                agentPackages.id,
                installations.map((i) => i.packageId),
              ),
            )
        : [],
    });
    write("governance/use-cases.json", {
      useCases: await tx
        .select()
        .from(aiUseCases)
        .where(eq(aiUseCases.companyId, companyId)),
      versions: await tx
        .select()
        .from(aiUseCaseVersions)
        .where(eq(aiUseCaseVersions.companyId, companyId)),
      assessments: await tx
        .select()
        .from(aiUseCaseAssessments)
        .where(eq(aiUseCaseAssessments.companyId, companyId)),
      deployments: await tx
        .select()
        .from(aiUseCaseDeployments)
        .where(eq(aiUseCaseDeployments.companyId, companyId)),
      oversight: await tx
        .select()
        .from(humanOversightProfiles)
        .where(eq(humanOversightProfiles.companyId, companyId)),
      obligations: await tx
        .select()
        .from(governanceObligations)
        .where(eq(governanceObligations.companyId, companyId)),
    });
    const workflowRows = await tx
        .select()
        .from(workflows)
        .where(eq(workflows.companyId, companyId)),
      visibleWorkflowIds: string[] = [];
    for (const row of workflowRows) {
      if (row.projectId)
        await assertV7Authorization(
          nativeDb,
          actor,
          companyId,
          "project:read",
          { type: "project", companyId, projectId: row.projectId },
        );
      visibleWorkflowIds.push(row.id);
    }
    const workflowVersions = visibleWorkflowIds.length
      ? await tx
          .select()
          .from(workflowRevisions)
          .where(
            and(
              eq(workflowRevisions.companyId, companyId),
              inArray(workflowRevisions.workflowId, visibleWorkflowIds),
            ),
          )
      : [];
    write("workflows/definitions.json", {
      workflows: workflowRows,
      revisions: workflowVersions.map((r) =>
        erasedWorkflows.has(r.id)
          ? {
              id: r.id,
              workflowId: r.workflowId,
              revisionNumber: r.revisionNumber,
              payloadOmitted: "erased",
            }
          : r,
      ),
    });
    const audit = await tx
      .select({
        action: activityLog.action,
        count: sql<number>`count(*)::int`,
        firstAt: sql<string>`min(${activityLog.createdAt})::text`,
        lastAt: sql<string>`max(${activityLog.createdAt})::text`,
      })
      .from(activityLog)
      .where(eq(activityLog.companyId, companyId))
      .groupBy(activityLog.action);
    write("audit/summary.json", {
      actions: audit.filter((r) => /^[a-z][a-z0-9_.:-]{0,119}$/.test(r.action)),
    });
    return {
      schema: "aw.company-state.v7",
      companyId,
      exportedAt: new Date().toISOString(),
      files,
      sha256: nativeSha256(files),
      limitations: [
        "Use together with the native company bundle for agents, Skills, Projects, Tasks and policy-authorized artifacts.",
        "Private agent Memory, erased payloads, source-ineligible derived content and credential values are excluded.",
        "Package deployment references and license metadata are exported; third-party package redistribution remains subject to its license.",
        "Import never reinstates credentials, approvals, running work, active deployment authority or prior sandbox qualification.",
      ],
    };
  });
}
