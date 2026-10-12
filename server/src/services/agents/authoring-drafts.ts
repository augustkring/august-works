import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  agentConfigurationDrafts,
  agents,
  approvals,
  companies,
  authUsers,
  companyMemberships,
  agentPresenceRuntimeBindings,
  agentProviderBindings,
  foundationDocuments,
  agentPackageVersions,
  agentPackages,
  type Db,
} from "@paperclipai/db";
import {
  agentAuthoringContentSchema,
  agentAuthoringDraftViewSchema,
  agentDraftCreateSchema,
  agentDraftSaveSchema,
  agentDraftDiscardSchema,
  agentDraftAdmissionSchema,
  agentDraftPreparationReviewSchema,
  agentDraftPrepareSchema,
  agentDraftRuntimeViewSchema,
  agentAuthoringReviewSchema,
  type AgentDraftRuntimeView,
  CUSTOM_AGENT_STEPS,
  HIRE_AGENT_STEPS,
  hireAgentCatalogSchema,
  hireAgentCapabilityStatusSchema,
  projectHireDeclaredAccess,
  v9FeatureEnabled,
  type AgentAuthoringContent,
  type AgentAuthoringReview,
  type AgentAuthoringDraftView,
} from "@paperclipai/shared";
import type { AuthorizationActor } from "../authorization.js";
import { assertV5Authorization, v5HumanActorId } from "../v5-authorization.js";
import { instanceSettingsService } from "../instance-settings.js";
import { assertSaasDomainAdmission } from "../saas/domain-admission.js";
import { readBuiltInAgentMarker } from "../built-in-agent-metadata.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { agentPackageService } from "../agent-packages/package-service.js";
import { packageReleaseBlockers } from "../agent-packages/package-policy.js";
import { withV5ActivityTransaction } from "../v5-mutations.js";
import { logActivity } from "../activity-log.js";
import { createPausedOnboardingAgent } from "../saas/onboarding-agent.js";
import { deduplicateAgentName } from "../agents.js";
import { agentProviderBindingService } from "../agent-provider-bindings.js";
import { agentAuthoringTestService } from "./authoring-tests.js";
import {
  approvedFoundationView,
  foundationService,
} from "../foundation/foundation-service.js";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  tooManyRequests,
  HttpError,
  unprocessable,
} from "../../errors.js";

type Draft = typeof agentConfigurationDrafts.$inferSelect;
/** Draft persistence has no effective authority or publication effects.
 * Actual inactive Agent creation requires the separate explicit preparation C3. */
export function agentAuthoringService(db: Db) {
  async function access(
    tx: Db,
    actor: AuthorizationActor,
    companyId: string,
    agentId: string | null = null,
    write = false,
    requireFlag = write,
  ) {
    const userId = v5HumanActorId(actor);
    if (actor.source === "local_implicit")
      throw forbidden("A verified account is required to save agent drafts");
    const current = { ...actor, ignoreInstanceAdmin: true };
    await assertV5Authorization(tx, current, companyId, "company_scope:read");
    await assertV5Authorization(
      tx,
      current,
      companyId,
      agentId ? "agents:configure" : "agents:create",
      { type: "agent", companyId, agentId },
    );
    const membership = tx
      .select({ id: companyMemberships.id })
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, userId),
          eq(companyMemberships.status, "active"),
        ),
      );
    const user = tx
      .select({ verified: authUsers.emailVerified })
      .from(authUsers)
      .where(eq(authUsers.id, userId));
    const [[member], [account]] = await Promise.all([
      write ? membership.for("share") : membership,
      write ? user.for("share") : user,
    ]);
    if (!member || !account?.verified)
      throw forbidden("Current verified membership is required");
    if (write) await assertSaasDomainAdmission(tx, companyId);
    if (
      requireFlag &&
      !v9FeatureEnabled(
        await instanceSettingsService(tx).getExperimental(),
        "hire_agent_v9",
      )
    )
      throw notFound("Agent authoring is not enabled", {
        code: "v9_feature_disabled",
      });
    if (agentId) {
      const [target] = await tx
        .select({
          id: agents.id,
          status: agents.status,
          metadata: agents.metadata,
        })
        .from(agents)
        .where(and(eq(agents.companyId, companyId), eq(agents.id, agentId)));
      if (
        !target ||
        target.status === "terminated" ||
        readBuiltInAgentMarker(target.metadata)
      )
        throw notFound("Agent unavailable for authoring");
      await assertV5Authorization(tx, current, companyId, "agent:read", {
        type: "agent",
        companyId,
        agentId,
      });
    }
    return userId;
  }
  async function targetHash(tx: Db, companyId: string, agentId: string | null) {
    if (!agentId) return null;
    const [target] = await tx
      .select({
        name: agents.name,
        role: agents.role,
        title: agents.title,
        capabilities: agents.capabilities,
        adapterType: agents.adapterType,
        adapterConfig: agents.adapterConfig,
        runtimeConfig: agents.runtimeConfig,
        permissions: agents.permissions,
      })
      .from(agents)
      .where(and(eq(agents.companyId, companyId), eq(agents.id, agentId)));
    if (!target) throw notFound("Agent not found");
    // No effective instructions or credentials are copied to the draft/read response.
    return nativeSha256(target);
  }
  async function view(row: Draft, tx: Db = db) {
    const [pinned] = row.packageVersionId
      ? await tx
          .select({ version: agentPackageVersions.version })
          .from(agentPackageVersions)
          .where(eq(agentPackageVersions.id, row.packageVersionId))
          .limit(1)
      : [];
    let preparation: AgentAuthoringDraftView["preparation"] = null;
    if (row.preparedAgentId) {
      const [agent] = await tx.select({ id: agents.id, name: agents.name, status: agents.status }).from(agents)
        .where(and(eq(agents.companyId, row.companyId), eq(agents.id, row.preparedAgentId)));
      let status: "prepared" | "pending_approval" | "needs_review" | "unavailable" = "unavailable";
      if (agent && agent.status !== "terminated") {
        status = "needs_review";
        if (row.preparationConfigurationHash === await targetHash(tx, row.companyId, agent.id)) {
          if (agent.status === "paused") status = "prepared";
          if (agent.status === "pending_approval" && row.preparationApprovalId) {
            const [approval] = await tx.select().from(approvals).where(and(eq(approvals.companyId, row.companyId), eq(approvals.id, row.preparationApprovalId)));
            if (approval?.type === "hire_agent" && approval.status === "pending" && approval.requestedByUserId === row.createdByUserId && approval.payload.agentId === agent.id)
              status = "pending_approval";
          }
        }
      }
      preparation = { agentId: row.preparedAgentId, name: agent?.name ?? "Prepared agent", approvalId: row.preparationApprovalId, status,
        runtimeQualified: false as const, authorityGranted: false as const, executionStarted: false as const };
    }
    return agentAuthoringDraftViewSchema.parse({
      id: row.id,
      companyId: row.companyId,
      agentId: row.agentId,
      createdByUserId: row.createdByUserId,
      preparation,
      version: row.version,
      status: row.status,
      kind: row.kind,
      package: row.packageVersionId
        ? {
            key: row.packageKey,
            versionId: row.packageVersionId,
            version: pinned?.version,
            contentHash: row.packageContentHash,
          }
        : null,
      step: row.step,
      content: row.content,
      baselineHash: row.baselineHash,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }
  async function hireRelease(
    tx: Db,
    actor: AuthorizationActor,
    versionId: string,
  ) {
    const release = (
      await agentPackageService(tx).catalog(
        { ...actor, ignoreInstanceAdmin: true },
        "customer",
      )
    ).find((item) => item.versionId === versionId);
    if (!release)
      throw unprocessable(
        "This capability version is unavailable; choose a current capability",
        { code: "hire_release_unavailable" },
      );
    return release;
  }
  async function read(
    tx: Db,
    actor: AuthorizationActor,
    companyId: string,
    id: string,
    lock = false,
    requireFlag = lock,
  ) {
    const userId = v5HumanActorId(actor);
    await assertV5Authorization(
      tx,
      { ...actor, ignoreInstanceAdmin: true },
      companyId,
      "company_scope:read",
    );
    const query = tx
      .select()
      .from(agentConfigurationDrafts)
      .where(
        and(
          eq(agentConfigurationDrafts.companyId, companyId),
          eq(agentConfigurationDrafts.createdByUserId, userId),
          eq(agentConfigurationDrafts.id, id),
        ),
      )
      .limit(1);
    const [row] = await (lock ? query.for("update") : query);
    if (!row) throw notFound("Agent draft not found");
    await access(tx, actor, companyId, row.agentId, lock, requireFlag);
    if (row.preparedAgentId) await access(tx, actor, companyId, row.preparedAgentId, lock, requireFlag);
    return row;
  }
  async function preparationReview(tx: Db, actor: AuthorizationActor, row: Draft) {
    if (row.status !== "draft" || row.agentId || row.preparedAgentId || !row.content)
      throw conflict("Continue the existing draft or Agent through its original controls");
    // Original company-wide Apps bindings also apply to future Agents. Retain
    // them untouched, and do not promise zero added authority for this C3.
    const inherited = await tx.execute(sql`select 1 where exists (
      select 1 from tool_connection_installs where company_id=${row.companyId}::uuid and target_type='company' and target_id=${row.companyId}
    ) or exists (
      select 1 from tool_profile_bindings where company_id=${row.companyId}::uuid and target_type='company' and target_id=${row.companyId}
    )`);
    if (inherited.length) throw unprocessable("Existing company-wide tool access needs a separate reviewed Agent setup", { code: "draft_inherited_access_requires_review" });
    const requestedName = Array.from(row.content.name.trim()).slice(0, 80).join(""), outcome = row.content.outcome.trim();
    if (!requestedName || !outcome || !row.content.ownerUserId)
      throw unprocessable("Confirm the saved name, responsibility and initiating accountable owner before preparing an Agent");
    await validateReferences(tx, actor, row.companyId, null, row.content);
    const [accountable] = await tx.select({ userId: authUsers.id, name: authUsers.name }).from(authUsers)
      .innerJoin(companyMemberships, and(eq(companyMemberships.principalId, authUsers.id), eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.companyId, row.companyId), eq(companyMemberships.status, "active")))
      .where(eq(authUsers.id, row.content.ownerUserId)).for("share");
    if (!accountable) throw conflict("The accountable owner is no longer available");
    if (row.kind === "hire") {
      const capability = await hireRelease(tx, actor, row.packageVersionId!);
      if (capability.contentHash !== row.packageContentHash || capability.key !== row.packageKey)
        throw conflict("The selected capability pin changed");
    }
    const [company] = await tx.select({ requiresBoardApproval: companies.requireBoardApprovalForNewAgents }).from(companies)
      .where(eq(companies.id, row.companyId)).for("share");
    if (!company) throw notFound("Company unavailable");
    const existingAgents = await tx.select({ id: agents.id, name: agents.name, status: agents.status }).from(agents)
      .where(eq(agents.companyId, row.companyId)).for("share");
    const name = deduplicateAgentName(requestedName, existingAgents);
    if (name.startsWith(`${requestedName} `) && /^\d{13}$/.test(name.slice(requestedName.length + 1)))
      throw conflict("Choose a distinct saved Agent name before reviewing preparation");
    const fields = { draftId: row.id, companyId: row.companyId, version: row.version, name, outcome,
      accountableOwner: { userId: accountable.userId, name: accountable.name.trim().slice(0, 200) || "Company member" },
      requiresBoardApproval: company.requiresBoardApproval, createsInactiveAgent: true as const,
      runtimeQualified: false as const, authorityGranted: false as const, executionStarted: false as const };
    return agentDraftPreparationReviewSchema.parse({ ...fields, reviewHash: nativeSha256({ ...fields,
      createdByUserId: row.createdByUserId, content: row.content, packageVersionId: row.packageVersionId, packageContentHash: row.packageContentHash }) });
  }
  async function validateReferences(
    tx: Db,
    actor: AuthorizationActor,
    companyId: string,
    agentId: string | null,
    content: AgentAuthoringContent,
  ) {
    if (content.ownerUserId) {
      const [owner] = await tx
        .select({ id: companyMemberships.id })
        .from(companyMemberships)
        .where(
          and(
            eq(companyMemberships.companyId, companyId),
            eq(companyMemberships.principalType, "user"),
            eq(companyMemberships.principalId, content.ownerUserId),
            eq(companyMemberships.status, "active"),
          ),
        )
        .limit(1);
      if (!owner)
        throw unprocessable(
          "Choose a current company member as accountable owner",
          { code: "draft_owner_unavailable" },
        );
    }
    for (const id of content.knowledgeDocumentIds) {
      const document = await foundationService(tx).get(companyId, id, {
        ...actor,
        ignoreInstanceAdmin: true,
      });
      const approved = document && approvedFoundationView(document);
      if (
        !approved ||
        (approved.validUntil &&
          new Date(approved.validUntil).getTime() <= Date.now())
      )
        throw unprocessable(
          "Selected approved knowledge is unavailable; review its source",
          { code: "draft_knowledge_unavailable" },
        );
    }
    if (content.runtimeBindingId) {
      const [binding] = await tx
        .select({ id: agentPresenceRuntimeBindings.id })
        .from(agentPresenceRuntimeBindings)
        .where(
          and(
            eq(agentPresenceRuntimeBindings.companyId, companyId),
            eq(agentPresenceRuntimeBindings.id, content.runtimeBindingId),
            eq(
              agentPresenceRuntimeBindings.agentId,
              agentId ?? "00000000-0000-0000-0000-000000000000",
            ),
            eq(agentPresenceRuntimeBindings.status, "active"),
          ),
        )
        .limit(1);
      if (!binding)
        throw unprocessable("Choose a current runtime binding for this agent", {
          code: "draft_runtime_unavailable",
        });
    }
  }
  const service = {
    runtime: async (actor: AuthorizationActor, companyId: string, id: string) => db.transaction(async rawTx => {
      const tx = rawTx as unknown as Db;
      v5HumanActorId(actor);
      await assertV5Authorization(tx, { ...actor, ignoreInstanceAdmin: true }, companyId, "company_scope:read");
      await tx.select({ id: agentConfigurationDrafts.id }).from(agentConfigurationDrafts)
        .where(and(eq(agentConfigurationDrafts.companyId, companyId), eq(agentConfigurationDrafts.id, id))).for("share");
      const row = await read(tx, actor, companyId, id), agentId = row.agentId ?? row.preparedAgentId;
      let status: AgentDraftRuntimeView["status"] = "not_prepared", runtimeBindingId: string | null = null, configurationHash: string | null = null;
      if (agentId) {
        const [agent] = await tx.select({ status: agents.status }).from(agents)
          .where(and(eq(agents.companyId, companyId), eq(agents.id, agentId))).for("share");
        status = !agent || agent.status === "terminated" ? "unavailable" : agent.status === "pending_approval" ? "awaiting_approval" : "needs_setup";
        configurationHash = agent ? await targetHash(tx, companyId, agentId) : null;
        if (agent && status !== "unavailable") {
          const bindings = agentProviderBindingService(tx);
          await tx.select({ id: agentPresenceRuntimeBindings.id }).from(agentPresenceRuntimeBindings)
            .where(and(eq(agentPresenceRuntimeBindings.companyId, companyId), eq(agentPresenceRuntimeBindings.agentId, agentId))).for("share");
          const binding = await bindings.getForPresence({ ...actor, ignoreInstanceAdmin: true }, companyId, agentId);
          if (binding) {
            await tx.select({ id: agentProviderBindings.id }).from(agentProviderBindings)
              .where(eq(agentProviderBindings.id, binding.provider.id)).for("share");
            runtimeBindingId = binding.runtime.id;
            if (status !== "awaiting_approval") {
              try { await bindings.assertRuntime(companyId, agentId); status = "qualified"; }
              catch (error) { if (!(error instanceof HttpError) || error.status !== 409) throw error; }
            }
          }
        }
      }
      await access(tx, actor, companyId, row.agentId);
      if (row.preparedAgentId) await access(tx, actor, companyId, row.preparedAgentId);
      return agentDraftRuntimeViewSchema.parse({ draftId: id, companyId, version: row.version, agentId, runtimeBindingId, configurationHash, status,
        runtimeQualified: status === "qualified", safeTestQualified: false, executionStarted: false });
    }),
    preparationReview: async (actor: AuthorizationActor, companyId: string, id: string) => db.transaction(async tx => {
      const current = tx as unknown as Db, row = await read(current, actor, companyId, id, false, true);
      await assertSaasDomainAdmission(current, companyId);
      const result = await preparationReview(current, actor, row);
      await access(current, actor, companyId, null, false, true);
      return result;
    }),
    prepare: async (actor: AuthorizationActor, companyId: string, id: string, raw: unknown) => {
      const input = agentDraftPrepareSchema.parse(raw);
      return withV5ActivityTransaction(db, async (tx, publications) => {
        await lockMemoryPrivacy(tx, companyId);
        const row = await read(tx, actor, companyId, id, true), hash = nativeSha256({ action: "prepare_inactive_agent", input });
        if (row.preparationRequestId === input.requestId) {
          if (row.preparationRequestHash !== hash) throw conflict("Preparation command has different content", { code: "draft_request_conflict" });
          return view(row, tx);
        }
        if (row.creationRequestId === input.requestId || row.requestReceipts.some(receipt => receipt.requestId === input.requestId))
          throw conflict("This request identity belongs to an earlier draft command", { code: "draft_request_conflict" });
        if (row.version !== input.expectedVersion) throw conflict("The saved draft changed; review current preparation again", { code: "draft_version_conflict" });
        const reviewed = await preparationReview(tx, actor, row);
        if (reviewed.reviewHash !== input.expectedReviewHash) throw conflict("The reviewed Agent preparation changed");
        await access(tx, actor, companyId, null, true);
        const { agent, approvalId } = await createPausedOnboardingAgent(tx, companyId, row.createdByUserId, reviewed.name, "general",
          { canCreateAgents: false, canCreateSkills: false });
        if (agent.name !== reviewed.name) throw conflict("The reviewed Agent name is no longer available; review again");
        await access(tx, actor, companyId, agent.id, true);
        const [updated] = await tx.update(agentConfigurationDrafts).set({ preparedAgentId: agent.id, preparationApprovalId: approvalId,
          preparationConfigurationHash: await targetHash(tx, companyId, agent.id), preparationRequestId: input.requestId,
          preparationRequestHash: hash, preparationReviewHash: reviewed.reviewHash, version: row.version + 1, updatedAt: new Date() })
          .where(and(eq(agentConfigurationDrafts.id, id), eq(agentConfigurationDrafts.version, input.expectedVersion))).returning();
        if (!updated) throw conflict("The saved draft changed before preparation completed");
        await logActivity(tx, { companyId, actorType: "user", actorId: row.createdByUserId, action: "agent.hire_created",
          entityType: "agent", entityId: agent.id, details: { draftId: id, approvalId, preparationOnly: true } }, publications);
        await logActivity(tx, { companyId, actorType: "user", actorId: row.createdByUserId, action: "agent_configuration.draft_agent_prepared",
          entityType: "agent_configuration_draft", entityId: id, details: { agentId: agent.id, version: updated.version, productionChanged: false } }, publications);
        return view(updated, tx);
      });
    },
    hireCapability: async (
      actor: AuthorizationActor,
      companyId: string,
      id: string,
    ) => {
      const draft = await read(db, actor, companyId, id);
      if (draft.kind !== "hire" || !draft.packageVersionId)
        throw notFound("Hire setup not found");
      const [row] = await db
        .select({ version: agentPackageVersions, package: agentPackages })
        .from(agentPackageVersions)
        .innerJoin(
          agentPackages,
          eq(agentPackages.id, agentPackageVersions.packageId),
        )
        .where(eq(agentPackageVersions.id, draft.packageVersionId))
        .limit(1);
      if (
        !row ||
        row.version.contentHash !== draft.packageContentHash ||
        row.package.key !== draft.packageKey
      )
        throw conflict("Capability pin changed");
      const release = row.version.release;
      const available =
        row.version.state === "published" &&
        row.package.status === "active" &&
        packageReleaseBlockers(release).length === 0;
      await access(db, actor, companyId);
      return hireAgentCapabilityStatusSchema.parse({
        key: row.package.key,
        versionId: row.version.id,
        version: row.version.version,
        name: row.package.name,
        category: row.package.category,
        outcome: release.manifest.purpose,
        requiredKnowledge: release.manifest.requiredKnowledge,
        requiredConnections: release.manifest.requiredConnections,
        limits: release.manifest.knownLimitations,
        actionClasses: release.manifest.actionClasses,
        declaredAccess: projectHireDeclaredAccess(release.manifest),
        available,
      });
    },
    hireCatalog: async (actor: AuthorizationActor, companyId: string) => {
      await access(db, actor, companyId, null, false, true);
      const releases = await agentPackageService(db).catalog(
        {
          ...actor,
          ignoreInstanceAdmin: true,
        },
        "customer",
      );
      const seen = new Set<string>();
      const capabilities = releases
        .filter((release) => {
          if (release.manifest.audience !== "customer" || seen.has(release.key))
            return false;
          seen.add(release.key);
          return true;
        })
        .slice(0, 50)
        .map((release) => ({
          key: release.key,
          versionId: release.versionId,
          version: release.version,
          name: release.name,
          category: release.category,
          outcome: release.manifest.purpose,
          requiredKnowledge: release.manifest.requiredKnowledge,
          requiredConnections: release.manifest.requiredConnections,
          limits: release.manifest.knownLimitations,
          actionClasses: release.manifest.actionClasses,
          declaredAccess: projectHireDeclaredAccess(release.manifest),
        }));
      await access(db, actor, companyId, null, false, true);
      return hireAgentCatalogSchema.parse(capabilities);
    },
    admission: async (
      actor: AuthorizationActor,
      companyId: string,
      agentId: string | null,
    ) => {
      await access(db, actor, companyId, agentId, false, true);
      await assertSaasDomainAdmission(db, companyId);
      const result = agentDraftAdmissionSchema.parse({
        companyId,
        agentId,
        canCreateDraft: true,
      });
      await access(db, actor, companyId, agentId, false, true);
      return result;
    },
    options: async (
      actor: AuthorizationActor,
      companyId: string,
      agentId: string | null,
    ) => {
      await access(db, actor, companyId, agentId);
      const owners = await db
        .select({ id: authUsers.id, name: authUsers.name })
        .from(companyMemberships)
        .innerJoin(authUsers, eq(companyMemberships.principalId, authUsers.id))
        .where(
          and(
            eq(companyMemberships.companyId, companyId),
            eq(companyMemberships.principalType, "user"),
            eq(companyMemberships.status, "active"),
          ),
        )
        .orderBy(authUsers.name)
        .limit(100);
      const ids = await db
        .select({ id: foundationDocuments.id })
        .from(foundationDocuments)
        .where(
          and(
            eq(foundationDocuments.companyId, companyId),
            eq(foundationDocuments.status, "approved"),
          ),
        )
        .orderBy(desc(foundationDocuments.updatedAt))
        .limit(30);
      const knowledge: Array<{
        id: string;
        title: string;
        sensitivity: string;
      }> = [];
      for (const { id } of ids) {
        try {
          const document = await foundationService(db).get(companyId, id, {
              ...actor,
              ignoreInstanceAdmin: true,
            }),
            approved = document && approvedFoundationView(document);
          if (
            approved &&
            (!approved.validUntil ||
              new Date(approved.validUntil).getTime() > Date.now())
          )
            knowledge.push({
              id,
              title: approved.title ?? "Approved company source",
              sensitivity: approved.sensitivity,
            });
        } catch (error) {
          if (
            (error as { status?: number }).status !== 403 &&
            (error as { status?: number }).status !== 404
          )
            throw error;
        }
      }
      const runtimes = agentId
        ? await db
            .select({ id: agentPresenceRuntimeBindings.id })
            .from(agentPresenceRuntimeBindings)
            .where(
              and(
                eq(agentPresenceRuntimeBindings.companyId, companyId),
                eq(agentPresenceRuntimeBindings.agentId, agentId),
                eq(agentPresenceRuntimeBindings.status, "active"),
              ),
            )
            .limit(1)
        : [];
      await access(db, actor, companyId, agentId);
      return { owners, knowledge, runtimes };
    },
    create: async (
      actor: AuthorizationActor,
      companyId: string,
      raw: unknown,
    ) => {
      const input = agentDraftCreateSchema.parse(raw);
      if (input.packageVersionId && input.agentId)
        throw badRequest("Hire setup starts an unpublished new agent");
      await access(db, actor, companyId, input.agentId, true);
      return withV5ActivityTransaction(db, async (tx, publications) => {
        await lockMemoryPrivacy(tx, companyId);
        const userId = await access(tx, actor, companyId, input.agentId, true),
          // Preserve the fingerprint of earlier custom-draft creation requests.
          hash = nativeSha256(
            input.packageVersionId
              ? input
              : { requestId: input.requestId, agentId: input.agentId },
          );
        const [previous] = await tx
          .select()
          .from(agentConfigurationDrafts)
          .where(
            and(
              eq(agentConfigurationDrafts.companyId, companyId),
              eq(agentConfigurationDrafts.createdByUserId, userId),
              eq(agentConfigurationDrafts.creationRequestId, input.requestId),
            ),
          )
          .limit(1);
        if (previous) {
          if (previous.creationRequestHash !== hash)
            throw conflict("Draft creation request has different content", {
              code: "draft_request_conflict",
            });
          return view(previous, tx);
        }
        const [{ count }] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(agentConfigurationDrafts)
          .where(
            and(
              eq(agentConfigurationDrafts.companyId, companyId),
              eq(agentConfigurationDrafts.createdByUserId, userId),
              gte(
                agentConfigurationDrafts.createdAt,
                new Date(Date.now() - 86400000),
              ),
            ),
          );
        if (count >= 100)
          throw tooManyRequests("Daily agent draft creation limit reached");
        let identity = { name: "", description: "" };
        const capability = input.packageVersionId
          ? await hireRelease(tx, actor, input.packageVersionId)
          : null;
        if (input.agentId) {
          const [target] = await tx
            .select({ name: agents.name, description: agents.capabilities })
            .from(agents)
            .where(
              and(
                eq(agents.companyId, companyId),
                eq(agents.id, input.agentId),
              ),
            );
          identity = {
            name: target?.name ?? "",
            description: target?.description?.slice(0, 1000) ?? "",
          };
        }
        const [row] = await tx
          .insert(agentConfigurationDrafts)
          .values({
            companyId,
            agentId: input.agentId,
            kind: capability ? "hire" : "custom",
            packageVersionId: capability?.versionId ?? null,
            packageKey: capability?.key ?? null,
            packageContentHash: capability?.contentHash ?? null,
            step: capability ? "hire_access" : "outcome",
            createdByUserId: userId,
            creationRequestId: input.requestId,
            creationRequestHash: hash,
            baselineHash: await targetHash(tx, companyId, input.agentId),
            content: agentAuthoringContentSchema.parse({
              ...identity,
              ownerUserId: userId,
              ...(capability
                ? {
                    name: capability.name,
                    description: capability.description.slice(0, 1000),
                    outcome: capability.manifest.purpose,
                    instructions: {
                      purpose: capability.manifest.purpose,
                      responsibilities: capability.manifest.purpose,
                      prohibited: capability.manifest.prohibitedUses
                        .join("\n")
                        .slice(0, 3000),
                      missingInformation:
                        "Ask the accountable owner when required information is missing.",
                      escalation:
                        "Ask the accountable owner before any material action.",
                    },
                    capabilities: [
                      ...(capability.manifest.actionClasses.includes(
                        "internal_draft",
                      )
                        ? [
                            {
                              operation: "create_internal_draft",
                              autonomy: "automatic",
                            },
                          ]
                        : []),
                      ...(capability.manifest.actionClasses.includes(
                        "external_communication",
                      )
                        ? [
                            {
                              operation: "external_send",
                              autonomy: "ask_first",
                            },
                          ]
                        : []),
                      ...(capability.manifest.actionClasses.includes(
                        "financial_commitment",
                      )
                        ? [{ operation: "spend", autonomy: "ask_first" }]
                        : []),
                      {
                        operation: "change_permissions",
                        autonomy: "not_allowed",
                      },
                    ],
                  }
                : {}),
            }),
          })
          .returning();
        await logActivity(
          tx,
          {
            companyId,
            actorType: "user",
            actorId: userId,
            action: "agent_configuration.draft_created",
            entityType: "agent_configuration_draft",
            entityId: row!.id,
            details: { version: 1, productionChanged: false },
          },
          publications,
        );
        return view(row!, tx);
      });
    },
    get: async (actor: AuthorizationActor, companyId: string, id: string) => {
      const row = await read(db, actor, companyId, id);
      const result = await view(row);
      await access(db, actor, companyId, row.agentId);
      if (row.preparedAgentId) await access(db, actor, companyId, row.preparedAgentId);
      return result;
    },
    list: async (
      actor: AuthorizationActor,
      companyId: string,
      before?: string,
    ) => {
      const userId = v5HumanActorId(actor);
      // Existing drafts remain recoverable when the rollout flag is disabled.
      await assertV5Authorization(
        db,
        { ...actor, ignoreInstanceAdmin: true },
        companyId,
        "company_scope:read",
      );
      if (before) {
        const [cursor] = await db
          .select({ id: agentConfigurationDrafts.id })
          .from(agentConfigurationDrafts)
          .where(
            and(
              eq(agentConfigurationDrafts.companyId, companyId),
              eq(agentConfigurationDrafts.createdByUserId, userId),
              eq(agentConfigurationDrafts.id, before),
            ),
          )
          .limit(1);
        if (!cursor) throw badRequest("Unknown agent draft cursor");
      }
      const rows = await db
        .select()
        .from(agentConfigurationDrafts)
        .where(
          and(
            eq(agentConfigurationDrafts.companyId, companyId),
            eq(agentConfigurationDrafts.createdByUserId, userId),
            eq(agentConfigurationDrafts.status, "draft"),
            before
              ? sql`(${agentConfigurationDrafts.updatedAt},${agentConfigurationDrafts.id}) < (select updated_at,id from agent_configuration_drafts where company_id=${companyId}::uuid and created_by_user_id=${userId} and id=${before}::uuid)`
              : undefined,
          ),
        )
        .orderBy(
          desc(agentConfigurationDrafts.updatedAt),
          desc(agentConfigurationDrafts.id),
        )
        .limit(26);
      const visible = [];
      for (const row of rows.slice(0, 25)) {
        try {
          await access(db, actor, companyId, row.agentId);
          if (row.preparedAgentId) await access(db, actor, companyId, row.preparedAgentId);
          visible.push({
            id: row.id,
            companyId: row.companyId,
            agentId: row.agentId,
            kind: row.kind,
            version: row.version,
            name: row.content?.name ?? "",
            step: row.step,
            updatedAt: row.updatedAt.toISOString(),
          });
        } catch (error) {
          if (
            (error as { status?: number }).status !== 403 &&
            (error as { status?: number }).status !== 404
          )
            throw error;
        }
      }
      await assertV5Authorization(
        db,
        { ...actor, ignoreInstanceAdmin: true },
        companyId,
        "company_scope:read",
      );
      return {
        items: visible,
        nextCursor: rows.length > 25 ? rows[24]!.id : null,
      };
    },
    save: async (
      actor: AuthorizationActor,
      companyId: string,
      id: string,
      raw: unknown,
    ) => {
      const input = agentDraftSaveSchema.parse(raw);
      return withV5ActivityTransaction(db, async (tx, publications) => {
        await lockMemoryPrivacy(tx, companyId);
        const row = await read(tx, actor, companyId, id, true),
          hash = nativeSha256({ action: "save", input });
        if (row.preparationRequestId === input.requestId) throw conflict("This identity belongs to the inactive Agent preparation", { code: "draft_request_conflict" });
        const receipt = row.requestReceipts.find(
          (r) => r.requestId === input.requestId,
        );
        if (receipt) {
          if (receipt.hash !== hash)
            throw conflict("Draft save request has different content", {
              code: "draft_request_conflict",
            });
          return view(row, tx);
        }
        if (row.status !== "draft" || row.version !== input.expectedVersion)
          throw conflict(
            "The saved draft changed; reload before making a new change",
            { code: "draft_version_conflict" },
          );
        const allowedSteps: readonly string[] =
          row.kind === "hire" ? HIRE_AGENT_STEPS : CUSTOM_AGENT_STEPS;
        if (!allowedSteps.includes(input.step))
          throw unprocessable("Choose a section from this agent setup", {
            code: "draft_journey_mismatch",
          });
        if (row.kind === "hire") {
          await hireRelease(tx, actor, row.packageVersionId!);
          if (
            nativeSha256(input.content.capabilities) !==
            nativeSha256(row.content!.capabilities)
          )
            throw unprocessable(
              "The capability's declared authority cannot be expanded in Hire Agent",
              { code: "hire_authority_not_editable" },
            );
        }
        await validateReferences(
          tx,
          actor,
          companyId,
          row.agentId ?? row.preparedAgentId,
          input.content,
        );
        await access(tx, actor, companyId, row.agentId, true);
        const contentChanged = nativeSha256(input.content) !== nativeSha256(row.content);
        const nextVersion = row.version + 1;
        const [updated] = await tx
          .update(agentConfigurationDrafts)
          .set({
            content: input.content,
            step: input.step,
            version: nextVersion,
            candidateRevision: row.candidateRevision + (contentChanged ? 1 : 0),
            updatedAt: new Date(),
            requestReceipts: [
              ...row.requestReceipts,
              { requestId: input.requestId, hash, version: nextVersion },
            ].slice(-32),
          })
          .where(eq(agentConfigurationDrafts.id, id))
          .returning();
        await logActivity(
          tx,
          {
            companyId,
            actorType: "user",
            actorId: row.createdByUserId,
            action: "agent_configuration.draft_saved",
            entityType: "agent_configuration_draft",
            entityId: id,
            details: {
              version: updated!.version,
              step: input.step,
              productionChanged: false,
            },
          },
          publications,
        );
        return view(updated!, tx);
      });
    },
    discard: async (
      actor: AuthorizationActor,
      companyId: string,
      id: string,
      raw: unknown,
    ) => {
      const input = agentDraftDiscardSchema.parse(raw);
      return withV5ActivityTransaction(db, async (tx, publications) => {
        await lockMemoryPrivacy(tx, companyId);
        const row = await read(tx, actor, companyId, id, true, false),
          hash = nativeSha256({ action: "discard", input });
        if (row.preparationRequestId === input.requestId) throw conflict("This identity belongs to the inactive Agent preparation", { code: "draft_request_conflict" });
        const receipt = row.requestReceipts.find(
          (r) => r.requestId === input.requestId,
        );
        if (receipt) {
          if (receipt.hash !== hash)
            throw conflict("Draft discard request has different content", {
              code: "draft_request_conflict",
            });
          return view(row, tx);
        }
        if (row.status !== "draft" || row.version !== input.expectedVersion)
          throw conflict("Draft baseline changed", {
            code: "draft_version_conflict",
          });
        const [updated] = await tx
          .update(agentConfigurationDrafts)
          .set({
            content: null,
            status: "discarded",
            version: row.version + 1,
            candidateRevision: row.candidateRevision + (row.content === null ? 0 : 1),
            updatedAt: new Date(),
            requestReceipts: [
              ...row.requestReceipts,
              { requestId: input.requestId, hash, version: row.version + 1 },
            ].slice(-32),
          })
          .where(eq(agentConfigurationDrafts.id, id))
          .returning();
        await logActivity(
          tx,
          {
            companyId,
            actorType: "user",
            actorId: row.createdByUserId,
            action: "agent_configuration.draft_discarded",
            entityType: "agent_configuration_draft",
            entityId: id,
            details: { version: updated!.version, productionChanged: false },
          },
          publications,
        );
        return view(updated!, tx);
      });
    },
    // Content readiness is also used by test admission. It must never read test
    // qualification through that admission path or recurse into model authority.
    reviewContent: async (
      actor: AuthorizationActor,
      companyId: string,
      id: string,
    ): Promise<AgentAuthoringReview> => {
      const row = await read(db, actor, companyId, id),
        content = row.content;
      if (!content) throw conflict("This draft was discarded");
      const blockers: AgentAuthoringReview["blockers"] = [];
      if (row.kind === "hire") {
        try {
          const capability = await hireRelease(
            db,
            actor,
            row.packageVersionId!,
          );
          if (
            capability.contentHash !== row.packageContentHash ||
            capability.key !== row.packageKey
          )
            throw unprocessable("Capability pin changed");
        } catch (error) {
          if (
            ![404, 409, 422].includes(
              (error as { status?: number }).status ?? 0,
            )
          )
            throw error;
          blockers.push({
            code: "hire_release_unavailable",
            message:
              "The selected capability version is unavailable; choose a currently qualified capability",
            step: "review",
          });
        }
      }
      if (!content.outcome.trim() || !content.ownerUserId)
        blockers.push({
          code: "outcome_required",
          message: "Confirm a responsibility and accountable owner",
          step: "outcome",
        });
      if (!content.name.trim() || !content.description.trim())
        blockers.push({
          code: "identity_required",
          message: "Add a name and customer-facing description",
          step: "identity",
        });
      if (
        !content.instructions.purpose.trim() ||
        !content.instructions.responsibilities.trim() ||
        !content.instructions.prohibited.trim() ||
        !content.instructions.missingInformation.trim() ||
        !content.instructions.escalation.trim()
      )
        blockers.push({
          code: "instructions_required",
          message: "Complete purpose, responsibilities, limits and escalation",
          step: "instructions",
        });
      try {
        await validateReferences(db, actor, companyId, row.agentId ?? row.preparedAgentId, content);
      } catch (error) {
        if ((error as { status?: number }).status !== 422) throw error;
        blockers.push({
          code: "references_changed",
          message:
            "Review the owner, knowledge and runtime selections; a selected resource is no longer available",
          step: "knowledge",
        });
      }
      const baselineCurrent =
        row.baselineHash === (await targetHash(db, companyId, row.agentId));
      if (!baselineCurrent)
        blockers.push({
          code: "production_baseline_changed",
          message:
            "The active configuration changed after this draft was created; review a fresh revision before publishing",
          step: "review",
        });
      if (!content.runtimeBindingId)
        blockers.push({
          code: "runtime_required",
          message: "A currently qualified runtime is required before testing",
          step: "runtime",
        });
      // A presence binding does not prove this new behavior has passed independent evaluation.
      blockers.push({
        code: "representative_test_unqualified",
        message:
          "Representative execution and independent verification for this draft are not qualified yet",
        step: "test",
      });
      blockers.push({
        code: "native_promotion_unqualified",
        message:
          "Publishing this structured configuration through a qualified native policy mapping is not available yet",
        step: "publish",
      });
      await access(db, actor, companyId, row.agentId);
      return {
        draftId: id,
        version: row.version,
        productionChanged: false,
        baselineCurrent,
        blockers,
        test: {
          status: "unqualified",
          message: "No test run or result has been created",
        },
        publishAllowed: false,
      };
    },
    review: async (actor: AuthorizationActor, companyId: string, id: string): Promise<AgentAuthoringReview> => db.transaction(async raw => {
      const tx = raw as unknown as Db;
      await lockMemoryPrivacy(tx, companyId);
      await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).for("update");
      const base = await agentAuthoringService(tx).reviewContent(actor, companyId, id);
      const qualified = await agentAuthoringTestService(db).readinessInTransaction(tx, actor, companyId, id, base.version);
      return agentAuthoringReviewSchema.parse(qualified ? { ...base,
        blockers: base.blockers.filter(blocker => blocker.code !== "representative_test_unqualified"),
        test: { status: "qualified", message: "Every saved representative scenario has current independent human verification", scenariosVerified: qualified.scenariosVerified },
      } : base);
    }),
  };
  return service;
}
