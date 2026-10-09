import { learningRoots } from "../learning/learning-service.js";
import { entitlementService } from "../billing/entitlements.js";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  agents,
  agentPackages,
  agentPackageVersions,
  agentPackageComponents,
  companyAgentPackageInstallations,
  agentPackageUpdateProposals,
  learningDomainCandidates,
  learningHypotheses,
  learningCycles,
  learningRetainedAssets,
  agentRolePackAssignments,
  platformAdminAudit,
  aiUseCases,
  aiUseCaseVersions,
  connectionGrants,
  toolConnections,
  toolApplications,
  rolePacks,
  rolePackVersions,
  companySkills,
  playbookDocuments,
  type Db,
} from "@paperclipai/db";
import {
  packageReleaseSchema,
  packageInstallSchema,
  packageUpdateSchema,
  packageDecisionSchema,
  type PackageCatalogView,
  type PackageInstallationView,
  type PackageRelease,
  type PackageInstallOptions,
} from "@paperclipai/shared";
import type { z } from "zod";
import type { AuthorizationActor } from "../authorization.js";
import {
  assertV7Enabled,
  assertV7Authorization,
  v7HumanActorId,
} from "../v7-authorization.js";
import { withV7ActivityTransaction, logActivity } from "../v7-mutations.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { agentProviderBindingService } from "../agent-provider-bindings.js";
import { readinessService } from "../readiness/readiness-service.js";
import { rolePackService } from "../role-packs.js";
import { skillResolverService } from "../skill-resolver.js";
import { playbookService } from "../playbooks.js";
import { playbookResolverService } from "../playbook-resolver.js";
import { assertLearningAssetCurrent } from "../learning/learning-assets.js";
import { assertSaasDomainAdmission } from "../saas/domain-admission.js";
import { conflict, forbidden, notFound } from "../../errors.js";
import {
  packageChangeIsMaterial,
  packageReleaseBlockers,
} from "./package-policy.js";
export interface PackagePublisherOptions {
  operatorUserIds?: readonly string[];
  protectedEvidenceOrigin?: string;
  sourceSha?: string;
}
type Installation = typeof companyAgentPackageInstallations.$inferSelect;
export function agentPackageService(
  db: Db,
  options: PackagePublisherOptions = {},
) {
  async function access(
    tx: Db,
    actor: AuthorizationActor,
    companyId: string,
    agentId?: string,
    write = false,
  ) {
    v7HumanActorId(actor);
    await assertV7Authorization(tx, actor, companyId, "company_scope:read");
    if (write)
      await assertV7Authorization(tx, actor, companyId, "agents:configure", {
        type: "agent",
        companyId,
        agentId,
      });
  }
  async function release(tx: Db, versionId: string, lock = false) {
    const q = tx
      .select({ version: agentPackageVersions, package: agentPackages })
      .from(agentPackageVersions)
      .innerJoin(
        agentPackages,
        eq(agentPackages.id, agentPackageVersions.packageId),
      )
      .where(eq(agentPackageVersions.id, versionId));
    const [row] = await (lock ? q.for("share") : q);
    if (!row) throw notFound("Package version not found");
    return row;
  }
  function available(row: Awaited<ReturnType<typeof release>>) {
    if (
      row.package.status !== "active" ||
      row.version.state !== "published" ||
      packageReleaseBlockers(row.version.release).length
    )
      throw conflict(
        "Package release is unavailable or requires requalification",
      );
  }
  async function installation(
    tx: Db,
    actor: AuthorizationActor,
    companyId: string,
    id: string,
    lock = false,
  ) {
    const q = tx
      .select()
      .from(companyAgentPackageInstallations)
      .where(
        and(
          eq(companyAgentPackageInstallations.companyId, companyId),
          eq(companyAgentPackageInstallations.id, id),
        ),
      );
    const [row] = await (lock ? q.for("update") : q);
    if (!row) throw notFound("Package installation not found");
    await access(tx, actor, companyId, row.agentId);
    return row;
  }
  function view(row: Installation): PackageInstallationView {
    return {
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
  async function sourceAccess(
    tx: Db,
    actor: AuthorizationActor,
    companyId: string,
    proposalId: string,
  ) {
    const [root] = await tx
      .select({ cycle: learningCycles })
      .from(learningDomainCandidates)
      .innerJoin(
        learningHypotheses,
        and(
          eq(learningHypotheses.companyId, learningDomainCandidates.companyId),
          eq(learningHypotheses.id, learningDomainCandidates.hypothesisId),
        ),
      )
      .innerJoin(
        learningCycles,
        and(
          eq(learningCycles.companyId, learningHypotheses.companyId),
          eq(learningCycles.id, learningHypotheses.cycleId),
        ),
      )
      .where(
        and(
          eq(learningDomainCandidates.companyId, companyId),
          eq(learningDomainCandidates.targetDomain, "agent_package"),
          eq(learningDomainCandidates.candidateId, proposalId),
        ),
      );
    if (root) await learningRoots(tx, actor, root.cycle);
  }
  async function pins(
    tx: Db,
    actor: AuthorizationActor,
    companyId: string,
    input: z.infer<typeof packageInstallSchema>,
    published: PackageRelease,
  ) {
    const result: Installation["components"] = [];
    const nativeTypes = [
      "role_pack",
      "skill",
      "playbook",
      "workflow_template",
      "routine_template",
    ];
    for (const pin of input.components) {
      const component = published.components.find((c) => c.key === pin.key);
      if (!component || !nativeTypes.includes(component.type))
        throw conflict("Unknown native package component");
      if (component.type === "role_pack") {
        const pack = await rolePackService(tx).get(
          actor,
          companyId,
          pin.resourceId,
        );
        if (
          !pack.versions.some(
            (v) => v.id === pin.versionId && v.state === "published",
          )
        )
          throw conflict("Published Role Pack version required");
      }
      if (component.type === "skill")
        await skillResolverService(tx).authorizedVersion(
          actor,
          companyId,
          pin.resourceId,
          pin.versionId,
        );
      if (component.type === "playbook")
        await playbookResolverService(tx).validate(actor, companyId, {
          playbookId: pin.resourceId,
          revisionId: pin.versionId,
          required: component.required,
        });
      if (["workflow_template", "routine_template"].includes(component.type))
        await assertV7Authorization(tx, actor, companyId, "workflows:read");
      const [hash] = await tx.execute(
        sql`select aw_v7_package_component_hash(${companyId}::uuid,${component.type},${pin.resourceId}::uuid,${pin.versionId}::uuid) as hash`,
      );
      if (hash?.hash !== component.contentHash)
        throw conflict(
          "Package component is stale or does not match its immutable release digest",
        );
      result.push({
        ...pin,
        type: component.type,
        contentHash: component.contentHash,
      });
    }
    for (const c of published.components)
      if (
        c.required &&
        nativeTypes.includes(c.type) &&
        !result.some((p) => p.key === c.key)
      )
        throw conflict("A required native component is unresolved");
    if (result.filter((p) => p.type === "role_pack").length !== 1)
      throw conflict("Exactly one native Role Pack must be selected");
    return result;
  }
  async function review(
    tx: Db,
    actor: AuthorizationActor,
    row: Installation,
    parentPublications: Parameters<typeof logActivity>[2],
  ) {
    const published = await release(tx, row.installedVersionId, true);
    available(published);
    const reasons: string[] = [],
      warnings: string[] = [],
      assessmentIds: string[] = [];
    const product = published.version.release.manifest.commercialProductKey;
    if (product) {
      const entitlement = (
        {
          agent_package_chief_of_staff: "packages.chief_of_staff.use",
          agent_package_growth: "packages.growth.use",
          agent_package_research: "packages.research.use",
        } as const
      )[product];
      try {
        await entitlementService(tx).require(row.companyId, entitlement);
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "status" in error &&
          [403, 404, 409].includes(Number(error.status))
        )
          reasons.push(
            "Maintained package capacity is unavailable; company data and core remain available",
          );
        else throw error;
      }
    }

    try {
      const runtime = await agentProviderBindingService(tx).assertRuntime(
        row.companyId,
        row.agentId,
      );
      if (
        !published.version.release.manifest.runtimeProviders.includes(
          runtime.provider.providerType as
            | "paperclip_native"
            | "hermes"
            | "openclaw",
        )
      )
        reasons.push("Selected runtime provider is incompatible");
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "status" in error &&
        [403, 404, 409].includes(Number(error.status))
      )
        reasons.push("Current runtime conformance is required");
      else throw error;
    }
    await pins(
      tx,
      actor,
      row.companyId,
      {
        versionId: row.installedVersionId,
        agentId: row.agentId,
        components: row.components.map((p) => ({
          key: p.key,
          resourceId: p.resourceId,
          versionId: p.versionId,
        })),
        aiUseCaseId: row.aiUseCaseId,
        updatePolicy: row.updatePolicy,
        acceptInternalEvaluation: true,
      },
      published.version.release,
    );
    const worker: AuthorizationActor = {
      type: "agent",
      source: "agent_jwt",
      agentId: row.agentId,
      companyId: row.companyId,
      onBehalfOfUserId: row.installedByUserId,
    };
    for (const pin of row.components) {
      if (pin.type === "skill")
        await skillResolverService(tx).authorizedVersion(
          worker,
          row.companyId,
          pin.resourceId,
          pin.versionId,
        );
      if (pin.type === "playbook")
        await playbookResolverService(tx).validate(worker, row.companyId, {
          playbookId: pin.resourceId,
          revisionId: pin.versionId,
          required: true,
        });
    }
    const selectedRole = row.components.find((c) => c.type === "role_pack")!;
    const roles = await rolePackService(tx).resolve(
      worker,
      row.companyId,
      row.agentId,
      {
        rolePackId: selectedRole.resourceId,
        versionId: selectedRole.versionId,
      },
    );
    const requirements = roles.items;
    await skillResolverService(tx).resolve(
      worker,
      row.companyId,
      published.version.release.manifest.purpose,
      requirements,
    );
    await playbookResolverService(tx).resolve(
      worker,
      row.companyId,
      published.version.release.manifest.purpose,
      requirements,
    );
    const connections = await tx
      .select({
        grant: connectionGrants,
        connection: toolConnections,
        applicationKey: toolApplications.applicationKey,
      })
      .from(connectionGrants)
      .innerJoin(
        toolConnections,
        and(
          eq(toolConnections.companyId, connectionGrants.companyId),
          eq(toolConnections.id, connectionGrants.connectionId),
        ),
      )
      .innerJoin(
        toolApplications,
        and(
          eq(toolApplications.companyId, toolConnections.companyId),
          eq(toolApplications.id, toolConnections.applicationId),
        ),
      )
      .where(
        and(
          eq(connectionGrants.companyId, row.companyId),
          eq(connectionGrants.subjectAgentId, row.agentId),
          eq(connectionGrants.status, "active"),
        ),
      );
    for (const key of published.version.release.manifest.requiredConnections)
      if (
        !connections.some(
          (c) =>
            c.applicationKey === key &&
            c.connection.enabled &&
            c.connection.status === "active",
        )
      )
        reasons.push(`Explicit connection access is required: ${key}`);
    for (const key of published.version.release.manifest.optionalConnections)
      if (
        !connections.some(
          (c) =>
            c.applicationKey === key &&
            c.connection.enabled &&
            c.connection.status === "active",
        )
      )
        warnings.push(`Advanced capability is unavailable without ${key}`);
    if (
      published.version.release.manifest.audience === "customer" &&
      !row.aiUseCaseId
    )
      reasons.push("A reviewed intended purpose is required");
    if (row.aiUseCaseId) {
      const [useCase] = await tx
        .select({ u: aiUseCases, v: aiUseCaseVersions })
        .from(aiUseCases)
        .innerJoin(
          aiUseCaseVersions,
          and(
            eq(aiUseCaseVersions.companyId, aiUseCases.companyId),
            eq(aiUseCaseVersions.useCaseId, aiUseCases.id),
            eq(aiUseCaseVersions.purposeVersion, aiUseCases.purposeVersion),
          ),
        )
        .where(
          and(
            eq(aiUseCases.companyId, row.companyId),
            eq(aiUseCases.id, row.aiUseCaseId),
          ),
        );
      if (
        !useCase ||
        useCase.u.status !== "approved" ||
        useCase.u.nextReviewAt <= new Date() ||
        useCase.v.purpose.intendedPurpose !==
          published.version.release.manifest.purpose ||
        Number(useCase.v.purpose.riskClass.slice(1)) >
          Number(published.version.release.manifest.maximumRisk.slice(1))
      )
        reasons.push(
          "Package purpose must match a current approved use case within its risk envelope",
        );
    }
    if (
      published.version.release.manifest.sandboxAssurance ===
      "qualified_managed"
    ) {
      const [qualified] = await tx.execute(
        sql`select exists(select 1 from runtime_sandbox_bindings s join agent_presence_runtime_bindings r on r.company_id=s.company_id join runtime_cells c on c.company_id=s.company_id and c.id=s.runtime_cell_id and c.provider_binding_id=r.provider_binding_id where r.company_id=${row.companyId}::uuid and r.agent_id=${row.agentId}::uuid and s.status='ready' and s.cell_generation=c.generation::text) as current`,
      );
      if (qualified?.current !== true)
        reasons.push("Current managed sandbox qualification is required");
    }
    for (const actionClass of published.version.release.manifest
      .actionClasses) {
      const assessment = await readinessService(tx).assess(
        row.companyId,
        {
          agentId: row.agentId,
          subjectType: "agent",
          actionClass,
          query: published.version.release.manifest.purpose,
        },
        {
          actor: {
            type: "board",
            source:
              actor.source === "local_implicit" ? "local_implicit" : "session",
            userId: row.installedByUserId,
          },
          principalId: row.installedByUserId,
          userId: row.installedByUserId,
        },
        parentPublications,
        row.installedVersionId,
      );
      assessmentIds.push(assessment.id);
      if (!["ready", "ready_with_warnings"].includes(assessment.status))
        reasons.push(
          `Knowledge readiness is ${assessment.status} for ${actionClass}`,
        );
      if (assessment.status === "ready_with_warnings")
        warnings.push(`Knowledge needs attention for ${actionClass}`);
      for (const domain of published.version.release.manifest.requiredKnowledge)
        if (
          !assessment.assessment.requirements.some(
            (r) => r.domain === domain && r.satisfied,
          )
        )
          reasons.push(`Required approved knowledge is missing: ${domain}`);
    }
    await assertLearningAssetCurrent(
      tx,
      row.companyId,
      "agent_package_installation",
      row.id,
      actor,
    );
    return {
      status: reasons.length
        ? "blocked"
        : warnings.length
          ? "ready_with_warnings"
          : "ready",
      reasons: [...new Set(reasons)],
      warnings: [...new Set(warnings)],
      assessmentIds,
    };
  }
  async function audit(
    tx: Db,
    actor: AuthorizationActor,
    row: Installation,
    action: string,
    p: Parameters<typeof logActivity>[2],
    details?: Record<string, unknown>,
  ) {
    await logActivity(
      tx,
      {
        companyId: row.companyId,
        actorType: "user",
        actorId: v7HumanActorId(actor),
        action,
        entityType: "agent_package_installation",
        entityId: row.id,
        details,
      },
      p,
    );
  }
  return {
    /** System consumer of the company's explicitly selected update policy.
     * Reuses the original human's current authority only for authorization; the
     * audit actor remains system. It never activates or approves material work. */
    stewardUpdate: async (
      companyId: string,
      id: string,
      nextVersionId: string,
    ) => {
      await assertV7Enabled(db, "core_stewards_v7");
      await assertV7Enabled(db, "agent_packages_v7");
      return withV7ActivityTransaction(db, async (tx, p) => {
        await tx.execute(
          sql`select singleton_key from instance_settings where singleton_key='default' for share`,
        );
        await assertV7Enabled(tx, "core_stewards_v7");
        await assertV7Enabled(tx, "agent_packages_v7");
        await lockMemoryPrivacy(tx, companyId);
        const [row] = await tx
          .select()
          .from(companyAgentPackageInstallations)
          .where(
            and(
              eq(companyAgentPackageInstallations.companyId, companyId),
              eq(companyAgentPackageInstallations.id, id),
            ),
          )
          .for("update");
        if (
          !row ||
          row.status !== "active" ||
          row.updatePolicy !== "auto_low_risk"
        )
          return { updated: false };
        const actor: AuthorizationActor = {
          type: "board",
          source: "session",
          userId: row.installedByUserId,
          ignoreInstanceAdmin: true,
        };
        await access(tx, actor, companyId, row.agentId, true);
        const before = await release(tx, row.installedVersionId, true),
          after = await release(tx, nextVersionId, true);
        available(after);
        const semver = (v: string) => v.split(".").map(Number);
        const previous = semver(before.version.version),
          next = semver(after.version.version);
        const firstDifference = next.findIndex(
          (part, index) => part !== previous[index],
        );
        if (
          after.package.id !== row.packageId ||
          firstDifference < 0 ||
          next[firstDifference]! <= previous[firstDifference]! ||
          packageChangeIsMaterial(before.version.release, after.version.release)
        )
          return { updated: false };
        const [safe] = await tx.execute(
          sql`select aw_v7_package_installation_current(i) and not exists(select 1 from heartbeat_runs r where r.company_id=i.company_id and r.agent_id=i.agent_id and r.status in ('queued','running','scheduled_retry')) as current from company_agent_package_installations i where i.id=${id}::uuid and i.company_id=${companyId}::uuid`,
        );
        if (safe?.current !== true) return { updated: false };
        await pins(
          tx,
          actor,
          companyId,
          packageInstallSchema.parse({
            versionId: nextVersionId,
            agentId: row.agentId,
            components: row.components.map((c) => ({
              key: c.key,
              resourceId: c.resourceId,
              versionId: c.versionId,
            })),
            aiUseCaseId: row.aiUseCaseId,
            updatePolicy: row.updatePolicy,
          }),
          after.version.release,
        );
        await tx
          .update(companyAgentPackageInstallations)
          .set({
            installedVersionId: nextVersionId,
            status: "configuring",
            version: row.version + 1,
            activationHash: null,
            readiness: null,
            updatedAt: new Date(),
          })
          .where(eq(companyAgentPackageInstallations.id, id));
        await logActivity(
          tx,
          {
            companyId,
            actorType: "system",
            actorId: "core-stewards",
            action: "agent_package.low_risk_update_configured",
            entityType: "agent_package_installation",
            entityId: id,
            details: {
              policy: "auto_low_risk",
              policyOwnerUserId: row.installedByUserId,
              previousVersion: row.installedVersionId,
              nextVersion: nextVersionId,
              activationRequired: true,
            },
          },
          p,
        );
        return { updated: true };
      });
    },
    proposeUpdate: async (
      actor: AuthorizationActor,
      companyId: string,
      id: string,
      raw: unknown,
      parentPublications?: Parameters<typeof logActivity>[2],
    ) => {
      const input = packageUpdateSchema.parse(raw);
      await assertV7Enabled(db, "agent_packages_v7");
      async function write(tx: Db, p: Parameters<typeof logActivity>[2]) {
        await lockMemoryPrivacy(tx, companyId);
        const row = await installation(tx, actor, companyId, id, true);
        await access(tx, actor, companyId, row.agentId, true);
        const next = await release(tx, input.versionId, true);
        available(next);
        if (
          row.version !== input.expectedVersion ||
          row.agentId !== input.agentId ||
          row.packageId !== next.package.id ||
          row.status === "uninstalled"
        )
          throw conflict("Package proposal baseline changed");
        await pins(tx, actor, companyId, input, next.version.release);
        const [proposal] = await tx
          .insert(agentPackageUpdateProposals)
          .values({
            companyId,
            installationId: id,
            proposal: input,
            reason: input.reason,
            createdByUserId: v7HumanActorId(actor),
          })
          .returning();
        await audit(tx, actor, row, "agent_package.update_proposed", p, {
          proposalId: proposal!.id,
        });
        return proposal!;
      }
      return parentPublications
        ? write(db, parentPublications)
        : withV7ActivityTransaction(db, write);
    },
    proposals: async (actor: AuthorizationActor, companyId: string) => {
      await access(db, actor, companyId);
      const proposals = await db
        .select()
        .from(agentPackageUpdateProposals)
        .where(eq(agentPackageUpdateProposals.companyId, companyId))
        .orderBy(desc(agentPackageUpdateProposals.createdAt))
        .limit(100);
      const visible: typeof proposals = [];
      for (const p of proposals) {
        try {
          const i = await installation(db, actor, companyId, p.installationId);
          await access(db, actor, companyId, i.agentId, true);
          if (!p.erasedAt) await sourceAccess(db, actor, companyId, p.id);
          const before = await release(db, i.installedVersionId),
            after = p.proposal ? await release(db, p.proposal.versionId) : null;
          visible.push({
            ...p,
            beforeManifest: before.version.release.manifest,
            afterManifest: after?.version.release.manifest ?? null,
            material: after
              ? packageChangeIsMaterial(
                  before.version.release,
                  after.version.release,
                )
              : false,
          } as typeof p);
        } catch (error) {
          if (
            !(
              error &&
              typeof error === "object" &&
              "status" in error &&
              [403, 404, 409].includes(Number(error.status))
            )
          )
            throw error;
        }
      }
      return visible;
    },
    reviewProposal: async (
      actor: AuthorizationActor,
      companyId: string,
      id: string,
      decision: "accept" | "reject",
    ) => {
      return withV7ActivityTransaction(db, async (tx, p) => {
        await lockMemoryPrivacy(tx, companyId);
        const [proposal] = await tx
          .select()
          .from(agentPackageUpdateProposals)
          .where(
            and(
              eq(agentPackageUpdateProposals.companyId, companyId),
              eq(agentPackageUpdateProposals.id, id),
            ),
          )
          .for("update");
        if (
          !proposal ||
          proposal.status !== "pending" ||
          proposal.erasedAt ||
          !proposal.proposal
        )
          throw conflict("Package proposal changed or was withdrawn");
        await sourceAccess(tx, actor, companyId, id);
        const row = await installation(
          tx,
          actor,
          companyId,
          proposal.installationId,
          true,
        );
        await access(tx, actor, companyId, row.agentId, true);
        const [link] = await tx
          .select()
          .from(learningDomainCandidates)
          .where(
            and(
              eq(learningDomainCandidates.companyId, companyId),
              eq(learningDomainCandidates.targetDomain, "agent_package"),
              eq(learningDomainCandidates.candidateId, id),
            ),
          );
        if (link) {
          if (
            nativeSha256({
              targetDomain: "agent_package",
              update: proposal.proposal,
            }) !== link.candidateHash
          )
            throw conflict(
              "The proposal differs from the evaluated package challenger",
            );
          const [current] = await tx.execute(
            sql`select aw_learning_link_current(${companyId}::uuid,${link.id}::uuid) as current`,
          );
          if (current?.current !== true)
            throw conflict("Package Learning evidence changed");
        }
        let acceptedVersion: number | null = null;
        if (decision === "accept") {
          const input = proposal.proposal;
          const next = await release(tx, input.versionId, true),
            before = await release(tx, row.installedVersionId, true);
          available(next);
          if (
            input.expectedVersion !== row.version ||
            input.agentId !== row.agentId ||
            next.package.id !== row.packageId
          )
            throw conflict("Package proposal baseline changed");
          if (
            packageChangeIsMaterial(
              before.version.release,
              next.version.release,
            ) &&
            !input.approveMaterialChange
          )
            throw conflict("Explicit material update review is required");
          const components = await pins(
              tx,
              actor,
              companyId,
              input,
              next.version.release,
            ),
            role = components.find((c) => c.type === "role_pack")!;
          await tx
            .update(agentRolePackAssignments)
            .set({
              rolePackId: role.resourceId,
              pinnedVersionId: role.versionId,
              versionPolicy: "pinned",
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(agentRolePackAssignments.companyId, companyId),
                eq(agentRolePackAssignments.scopeType, "agent"),
                eq(agentRolePackAssignments.scopeId, row.agentId),
              ),
            );
          acceptedVersion = row.version + 1;
          await tx
            .update(companyAgentPackageInstallations)
            .set({
              installedVersionId: input.versionId,
              components,
              aiUseCaseId: input.aiUseCaseId,
              updatePolicy: input.updatePolicy,
              status: "configuring",
              activationHash: null,
              readiness: null,
              version: acceptedVersion,
              updatedAt: new Date(),
            })
            .where(eq(companyAgentPackageInstallations.id, row.id));
          if (link)
            await tx
              .insert(learningRetainedAssets)
              .values({
                companyId,
                candidateLinkId: link.id,
                assetType: "agent_package_installation",
                assetId: row.id,
              })
              .onConflictDoNothing();
        }
        const [reviewed] = await tx
          .update(agentPackageUpdateProposals)
          .set({
            status: decision === "accept" ? "accepted" : "rejected",
            reviewedByUserId: v7HumanActorId(actor),
            acceptedInstallationVersion: acceptedVersion,
            updatedAt: new Date(),
          })
          .where(eq(agentPackageUpdateProposals.id, id))
          .returning();
        await audit(
          tx,
          actor,
          row,
          "agent_package.update_proposal_reviewed",
          p,
          { proposalId: id, decision },
        );
        return reviewed!;
      });
    },
    options: async (
      actor: AuthorizationActor,
      companyId: string,
    ): Promise<PackageInstallOptions> => {
      await assertV7Enabled(db, "agent_packages_v7");
      await access(db, actor, companyId);
      const result: PackageInstallOptions = { agents: [], components: [] };
      const allAgents = await db
        .select()
        .from(agents)
        .where(eq(agents.companyId, companyId))
        .limit(501);
      if (allAgents.length > 500)
        throw conflict("Narrow the agent inventory before installing packages");
      for (const a of allAgents) {
        if (a.status === "terminated") continue;
        try {
          await assertV7Authorization(db, actor, companyId, "agent:read", {
            type: "agent",
            companyId,
            agentId: a.id,
          });
          result.agents.push({ id: a.id, name: a.name });
        } catch (error) {
          if (
            !(
              error &&
              typeof error === "object" &&
              "status" in error &&
              [403, 404].includes(Number(error.status))
            )
          )
            throw error;
        }
      }
      const roles = await db
        .select({ r: rolePacks, v: rolePackVersions })
        .from(rolePacks)
        .innerJoin(
          rolePackVersions,
          and(
            eq(rolePackVersions.companyId, rolePacks.companyId),
            eq(rolePackVersions.rolePackId, rolePacks.id),
          ),
        )
        .where(
          and(
            eq(rolePacks.companyId, companyId),
            eq(rolePackVersions.state, "published"),
          ),
        )
        .limit(501);
      const skills = await db
        .select()
        .from(companySkills)
        .where(eq(companySkills.companyId, companyId))
        .limit(501);
      const playbooks = await playbookService(db).list(actor, companyId);
      if (roles.length > 500 || skills.length > 500)
        throw conflict(
          "Narrow the component inventory before installing packages",
        );
      const candidates = [
        ...roles.map((r) => ({
          type: "role_pack",
          resourceId: r.r.id,
          versionId: r.v.id,
          name: r.r.name,
        })),
        ...skills.flatMap((s) =>
          s.activeVersionId
            ? [
                {
                  type: "skill",
                  resourceId: s.id,
                  versionId: s.activeVersionId,
                  name: s.name,
                },
              ]
            : [],
        ),
        ...playbooks.flatMap((p) =>
          p.approvedRevisionId
            ? [
                {
                  type: "playbook",
                  resourceId: p.id,
                  versionId: p.approvedRevisionId,
                  name: p.title ?? p.key,
                },
              ]
            : [],
        ),
      ];
      for (const c of candidates) {
        try {
          if (c.type === "skill")
            await skillResolverService(db).authorizedVersion(
              actor,
              companyId,
              c.resourceId,
              c.versionId,
            );
          if (c.type === "playbook")
            await playbookResolverService(db).validate(actor, companyId, {
              playbookId: c.resourceId,
              revisionId: c.versionId,
              required: true,
            });
          const [h] = await db.execute(
            sql`select aw_v7_package_component_hash(${companyId}::uuid,${c.type},${c.resourceId}::uuid,${c.versionId}::uuid) as hash`,
          );
          if (typeof h?.hash === "string")
            result.components.push({ ...c, contentHash: h.hash });
        } catch (error) {
          if (
            !(
              error &&
              typeof error === "object" &&
              "status" in error &&
              [403, 404, 409].includes(Number(error.status))
            )
          )
            throw error;
        }
      }
      return result;
    },
    catalog: async (
      actor: AuthorizationActor,
    ): Promise<PackageCatalogView[]> => {
      v7HumanActorId(actor);
      await assertV7Enabled(db, "agent_packages_v7");
      const rows = await db
        .select({ version: agentPackageVersions, package: agentPackages })
        .from(agentPackageVersions)
        .innerJoin(
          agentPackages,
          eq(agentPackages.id, agentPackageVersions.packageId),
        )
        .where(
          and(
            eq(agentPackages.status, "active"),
            eq(agentPackageVersions.state, "published"),
          ),
        )
        .orderBy(agentPackages.key, desc(agentPackageVersions.createdAt))
        .limit(200);
      return rows
        .filter((r) => packageReleaseBlockers(r.version.release).length === 0)
        .map((r) => ({
          id: r.package.id,
          key: r.package.key,
          name: r.package.name,
          description: r.package.description,
          category: r.package.category,
          versionId: r.version.id,
          version: r.version.version,
          contentHash: r.version.contentHash,
          state: r.version.state,
          manifest: r.version.release.manifest,
          components: r.version.release.components,
          releaseEvidence: r.version.release.releaseEvidence,
        }));
    },
    publish: async (actor: AuthorizationActor, raw: unknown) => {
      const userId = v7HumanActorId(actor);
      if (!options.operatorUserIds?.includes(userId))
        throw forbidden(
          "A configured first-party package publisher is required",
        );
      await assertV7Enabled(db, "agent_packages_v7");
      const input = packageReleaseSchema.parse(raw),
        blockers = packageReleaseBlockers(input);
      if (blockers.length) throw conflict(blockers.join("; "));
      for (const ref of Object.values(input.releaseEvidence).filter(
        (v) => v && typeof v === "object" && "uri" in v,
      ) as Array<{ uri: string }>) {
        const u = new URL(ref.uri);
        if (
          !options.protectedEvidenceOrigin ||
          u.origin !== new URL(options.protectedEvidenceOrigin).origin ||
          !u.pathname.includes("/qualification/") ||
          input.manifest.sourceRevision !== options.sourceSha
        )
          throw forbidden(
            "Release evidence must reference protected qualification artifacts for this build",
          );
      }
      return db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`package:${input.packageKey}`},0))`,
        );
        const [p] = await tx
          .insert(agentPackages)
          .values({
            key: input.packageKey,
            name: input.name,
            description: input.description,
            category: input.category,
          })
          .onConflictDoNothing()
          .returning();
        const existing =
          p ??
          (
            await tx
              .select()
              .from(agentPackages)
              .where(eq(agentPackages.key, input.packageKey))
          )[0]!;
        if (existing.status !== "active") throw conflict("Package is revoked");
        const [v] = await tx
          .insert(agentPackageVersions)
          .values({
            packageId: existing.id,
            version: input.version,
            release: input,
            contentHash: nativeSha256(input),
            createdByUserId: userId,
            state: "testing",
          })
          .returning();
        await tx.insert(agentPackageComponents).values(
          input.components.map((component) => ({
            versionId: v!.id,
            key: component.key,
            component,
          })),
        );
        const [published] = await tx
          .update(agentPackageVersions)
          .set({
            state: "published",
            publishedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(agentPackageVersions.id, v!.id))
          .returning();
        await tx.insert(platformAdminAudit).values({
          operatorUserId: userId,
          action: "agent_package.version_published",
          resourceId: v!.id,
          safeDetails: {
            packageKey: input.packageKey,
            version: input.version,
            contentHash: v!.contentHash,
            audience: input.manifest.audience,
          },
        });
        return published!;
      });
    },
    revoke: async (actor: AuthorizationActor, versionId: string) => {
      const userId = v7HumanActorId(actor);
      if (!options.operatorUserIds?.includes(userId))
        throw forbidden("Configured publisher required");
      return db.transaction(async (tx) => {
        const row = await release(tx as unknown as Db, versionId, true);
        const [v] = await tx
          .update(agentPackageVersions)
          .set({ state: "revoked", updatedAt: new Date() })
          .where(eq(agentPackageVersions.id, row.version.id))
          .returning();
        await tx
          .update(companyAgentPackageInstallations)
          .set({
            status: "degraded",
            version: sql`${companyAgentPackageInstallations.version}+1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(
                companyAgentPackageInstallations.installedVersionId,
                versionId,
              ),
              eq(companyAgentPackageInstallations.status, "active"),
            ),
          );
        await tx.insert(platformAdminAudit).values({
          operatorUserId: userId,
          action: "agent_package.version_revoked",
          resourceId: versionId,
        });
        return v;
      });
    },
    preview: async (
      actor: AuthorizationActor,
      companyId: string,
      raw: unknown,
    ) => {
      const input = packageInstallSchema.parse(raw);
      await assertV7Enabled(db, "agent_packages_v7");
      await access(db, actor, companyId, input.agentId);
      const published = await release(db, input.versionId);
      available(published);
      const resolved = await pins(
        db,
        actor,
        companyId,
        input,
        published.version.release,
      );
      const observed = await review(
        db,
        actor,
        {
          id: randomUUID(),
          companyId,
          packageId: published.package.id,
          installedVersionId: input.versionId,
          agentId: input.agentId,
          aiUseCaseId: input.aiUseCaseId,
          updatePolicy: input.updatePolicy,
          status: "configuring",
          version: 1,
          installedByUserId: v7HumanActorId(actor),
          components: resolved,
          activationHash: null,
          readiness: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        undefined,
      );
      return {
        readiness: observed,
        manifest: published.version.release.manifest,
        components: resolved,
        requiresActivation: true,
        grantsCreated: 0,
      };
    },
    install: async (
      actor: AuthorizationActor,
      companyId: string,
      raw: unknown,
    ) => {
      const input = packageInstallSchema.parse(raw);
      await assertV7Enabled(db, "agent_packages_v7");
      await access(db, actor, companyId, input.agentId, true);
      await assertSaasDomainAdmission(db, companyId);
      return withV7ActivityTransaction(db, async (tx, p) => {
        await lockMemoryPrivacy(tx, companyId);
        await access(tx, actor, companyId, input.agentId, true);
        const published = await release(tx, input.versionId, true);
        available(published);
        if (
          published.version.release.manifest.audience === "internal_test" &&
          !input.acceptInternalEvaluation
        )
          throw conflict(
            "Explicit internal evaluation acknowledgement required",
          );
        const [a] = await tx
          .select()
          .from(agents)
          .where(
            and(eq(agents.companyId, companyId), eq(agents.id, input.agentId)),
          )
          .for("update");
        if (!a || a.status === "terminated")
          throw notFound("Agent presence unavailable");
        const resolved = await pins(
          tx,
          actor,
          companyId,
          input,
          published.version.release,
        );
        const [row] = await tx
          .insert(companyAgentPackageInstallations)
          .values({
            companyId,
            packageId: published.package.id,
            installedVersionId: input.versionId,
            agentId: input.agentId,
            aiUseCaseId: input.aiUseCaseId,
            installedByUserId: v7HumanActorId(actor),
            components: resolved,
            updatePolicy: input.updatePolicy,
          })
          .returning();
        const role = resolved.find((c) => c.type === "role_pack")!;
        const assignment = {
          companyId,
          scopeType: "agent",
          scopeId: input.agentId,
          rolePackId: role.resourceId,
          versionPolicy: "pinned",
          pinnedVersionId: role.versionId,
        };
        await tx
          .insert(agentRolePackAssignments)
          .values(assignment)
          .onConflictDoUpdate({
            target: [
              agentRolePackAssignments.companyId,
              agentRolePackAssignments.scopeType,
              agentRolePackAssignments.scopeId,
            ],
            set: { ...assignment, updatedAt: new Date() },
          });
        await audit(tx, actor, row!, "agent_package.installed", p, {
          versionId: input.versionId,
          grantsCreated: 0,
        });
        return view(row!);
      });
    },
    list: async (actor: AuthorizationActor, companyId: string) => {
      await access(db, actor, companyId);
      const rows = await db
        .select()
        .from(companyAgentPackageInstallations)
        .where(eq(companyAgentPackageInstallations.companyId, companyId))
        .orderBy(desc(companyAgentPackageInstallations.updatedAt))
        .limit(100);
      const visible: PackageInstallationView[] = [];
      for (const r of rows) {
        try {
          await assertV7Authorization(db, actor, companyId, "agent:read", {
            type: "agent",
            companyId,
            agentId: r.agentId,
          });
          visible.push(view(r));
        } catch (error) {
          if (
            !(
              error &&
              typeof error === "object" &&
              "status" in error &&
              [403, 404].includes(Number(error.status))
            )
          )
            throw error;
        }
      }
      return visible;
    },
    get: async (actor: AuthorizationActor, companyId: string, id: string) =>
      view(await installation(db, actor, companyId, id)),
    decide: async (
      actor: AuthorizationActor,
      companyId: string,
      id: string,
      action: "activate" | "suspend" | "uninstall",
      raw: unknown,
    ) => {
      const input = packageDecisionSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, p) => {
        await lockMemoryPrivacy(tx, companyId);
        const row = await installation(tx, actor, companyId, id, true);
        await access(tx, actor, companyId, row.agentId, true);
        if (
          row.version !== input.expectedVersion ||
          row.status === "uninstalled"
        )
          throw conflict("Installation changed; reload before deciding");
        let readiness = row.readiness,
          activationHash: string | null = null,
          status: Installation["status"] =
            action === "uninstall" ? "uninstalled" : "suspended";
        if (action === "activate") {
          await assertV7Enabled(tx, "agent_packages_v7");
          await assertSaasDomainAdmission(tx, companyId);
          readiness = await review(tx, actor, row, p);
          if (readiness.reasons.length) status = "readiness_blocked";
          else {
            const [hash] = await tx.execute(
              sql`select aw_v7_package_authority_hash(jsonb_populate_record(null::company_agent_package_installations,to_jsonb(i)||jsonb_build_object('version',i.version+1))) as hash from company_agent_package_installations i where i.company_id=${companyId}::uuid and i.id=${id}::uuid`,
            );
            activationHash = String(hash!.hash);
            status = "active";
          }
        }
        const [updated] = await tx
          .update(companyAgentPackageInstallations)
          .set({
            status,
            readiness,
            activationHash,
            version: row.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(companyAgentPackageInstallations.id, id))
          .returning();
        await audit(tx, actor, updated!, `agent_package.${status}`, p, {
          reason: input.reason,
        });
        return view(updated!);
      });
    },
    update: async (
      actor: AuthorizationActor,
      companyId: string,
      id: string,
      raw: unknown,
    ) => {
      const input = packageUpdateSchema.parse(raw);
      await assertV7Enabled(db, "agent_packages_v7");
      return withV7ActivityTransaction(db, async (tx, p) => {
        await lockMemoryPrivacy(tx, companyId);
        const row = await installation(tx, actor, companyId, id, true);
        await access(tx, actor, companyId, row.agentId, true);
        if (
          row.version !== input.expectedVersion ||
          row.status === "uninstalled" ||
          input.agentId !== row.agentId
        )
          throw conflict("Installation changed");
        const before = await release(tx, row.installedVersionId, true),
          after = await release(tx, input.versionId, true);
        available(after);
        if (after.package.id !== row.packageId)
          throw conflict("Update must belong to the same package");
        const material = packageChangeIsMaterial(
          before.version.release,
          after.version.release,
        );
        if (material && !input.approveMaterialChange)
          throw conflict("Material package update requires explicit review");
        const components = await pins(
          tx,
          actor,
          companyId,
          input,
          after.version.release,
        );
        const role = components.find((c) => c.type === "role_pack")!;
        await tx
          .update(agentRolePackAssignments)
          .set({
            rolePackId: role.resourceId,
            pinnedVersionId: role.versionId,
            versionPolicy: "pinned",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(agentRolePackAssignments.companyId, companyId),
              eq(agentRolePackAssignments.scopeType, "agent"),
              eq(agentRolePackAssignments.scopeId, row.agentId),
            ),
          );
        const [updated] = await tx
          .update(companyAgentPackageInstallations)
          .set({
            installedVersionId: input.versionId,
            components,
            aiUseCaseId: input.aiUseCaseId,
            updatePolicy: input.updatePolicy,
            status: "configuring",
            activationHash: null,
            readiness: null,
            version: row.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(companyAgentPackageInstallations.id, id))
          .returning();
        await audit(tx, actor, updated!, "agent_package.update_reviewed", p, {
          material,
          previousVersion: row.installedVersionId,
          nextVersion: input.versionId,
          reason: input.reason,
        });
        return view(updated!);
      });
    },
  };
}
