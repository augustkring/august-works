import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  agentConfigurationDrafts,
  agents,
  authUsers,
  companyMemberships,
  agentPresenceRuntimeBindings,
  foundationDocuments,
  type Db,
} from "@paperclipai/db";
import {
  agentAuthoringContentSchema,
  agentAuthoringDraftViewSchema,
  agentDraftCreateSchema,
  agentDraftSaveSchema,
  agentDraftDiscardSchema,
  hireAgentCatalogSchema,
  v9FeatureEnabled,
  type AgentAuthoringContent,
  type AgentAuthoringReview,
} from "@paperclipai/shared";
import type { AuthorizationActor } from "../authorization.js";
import { assertV5Authorization, v5HumanActorId } from "../v5-authorization.js";
import { instanceSettingsService } from "../instance-settings.js";
import { assertSaasDomainAdmission } from "../saas/domain-admission.js";
import { readBuiltInAgentMarker } from "../built-in-agent-metadata.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { agentPackageService } from "../agent-packages/package-service.js";
import { withV5ActivityTransaction } from "../v5-mutations.js";
import { logActivity } from "../activity-log.js";
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
  unprocessable,
} from "../../errors.js";

type Draft = typeof agentConfigurationDrafts.$inferSelect;
/** Draft persistence has no tool, grant, runtime, agent-update or publication effects. */
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
        .select()
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
  function view(row: Draft) {
    return agentAuthoringDraftViewSchema.parse({
      id: row.id,
      companyId: row.companyId,
      agentId: row.agentId,
      createdByUserId: row.createdByUserId,
      version: row.version,
      status: row.status,
      step: row.step,
      content: row.content,
      baselineHash: row.baselineHash,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
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
    return row;
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
  return {
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
        }));
      await access(db, actor, companyId, null, false, true);
      return hireAgentCatalogSchema.parse(capabilities);
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
      await access(db, actor, companyId, input.agentId, true);
      return withV5ActivityTransaction(db, async (tx, publications) => {
        await lockMemoryPrivacy(tx, companyId);
        const userId = await access(tx, actor, companyId, input.agentId, true),
          hash = nativeSha256(input);
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
          return view(previous);
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
            createdByUserId: userId,
            creationRequestId: input.requestId,
            creationRequestHash: hash,
            baselineHash: await targetHash(tx, companyId, input.agentId),
            content: agentAuthoringContentSchema.parse({
              ...identity,
              ownerUserId: userId,
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
        return view(row!);
      });
    },
    get: async (actor: AuthorizationActor, companyId: string, id: string) => {
      const row = await read(db, actor, companyId, id);
      await access(db, actor, companyId, row.agentId);
      return view(row);
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
          visible.push({
            id: row.id,
            companyId: row.companyId,
            agentId: row.agentId,
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
        const receipt = row.requestReceipts.find(
          (r) => r.requestId === input.requestId,
        );
        if (receipt) {
          if (receipt.hash !== hash)
            throw conflict("Draft save request has different content", {
              code: "draft_request_conflict",
            });
          return view(row);
        }
        if (row.status !== "draft" || row.version !== input.expectedVersion)
          throw conflict(
            "The saved draft changed; reload before making a new change",
            { code: "draft_version_conflict" },
          );
        await validateReferences(
          tx,
          actor,
          companyId,
          row.agentId,
          input.content,
        );
        await access(tx, actor, companyId, row.agentId, true);
        const [updated] = await tx
          .update(agentConfigurationDrafts)
          .set({
            content: input.content,
            step: input.step,
            version: row.version + 1,
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
        return view(updated!);
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
        const receipt = row.requestReceipts.find(
          (r) => r.requestId === input.requestId,
        );
        if (receipt) {
          if (receipt.hash !== hash)
            throw conflict("Draft discard request has different content", {
              code: "draft_request_conflict",
            });
          return view(row);
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
        return view(updated!);
      });
    },
    review: async (
      actor: AuthorizationActor,
      companyId: string,
      id: string,
    ): Promise<AgentAuthoringReview> => {
      const row = await read(db, actor, companyId, id),
        content = row.content;
      if (!content) throw conflict("This draft was discarded");
      const blockers: AgentAuthoringReview["blockers"] = [];
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
        await validateReferences(db, actor, companyId, row.agentId, content);
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
  };
}
