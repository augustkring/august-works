import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  createDb,
  agents,
  agentConfigurationDrafts,
  authUsers,
  activityLog,
  companyMemberships,
  principalPermissionGrants,
  billingAccounts,
  billingAccountCompanies,
  companies,
  approvals,
  toolApplications,
  toolConnections,
  toolConnectionInstalls,
  agentPresenceRuntimeBindings,
} from "@paperclipai/db";
import { PROVIDER_CAPABILITY_FEATURES, agentAuthoringContentSchema, type ProviderCapabilitySnapshot } from "@paperclipai/shared";
import { agentAuthoringService } from "../services/agents/authoring-drafts.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { agentProviderBindingService } from "../services/agent-provider-bindings.js";
import { providerConformanceRequirements, makeProviderCapabilitySnapshot } from "../services/provider-capabilities.js";
import { hashContextPolicySnapshot } from "../services/context/context-manifest.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)(
  "V9 canonical unpublished agent authoring",
  () => {
    let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,
      db: ReturnType<typeof createDb>,
      f: Awaited<ReturnType<typeof seedV5Presences>>,
      service: ReturnType<typeof agentAuthoringService>;
    beforeAll(async () => {
      database = await startEmbeddedPostgresTestDatabase(
        "aw-v9-agent-authoring-",
      );
      db = createDb(database.connectionString);
      await instanceSettingsService(db).getExperimental();
      await enableV5ForTest(db);
    }, 60000);
    afterAll(async () => database?.cleanup(), 30000);
    beforeEach(async () => {
      await instanceSettingsService(db).updateExperimental({
        saas_deployment_profile_v6: true,
        billing_v6: true,
        agent_packages_v7: true,
        hire_agent_v9: true,
      });
      f = await seedV5Presences(db);
      service = agentAuthoringService(db);
    });
    async function preparationFixture() {
      await instanceSettingsService(db).updateExperimental({ free_core_commercial_v7: true, billing_entitlements_v6: true, billing_usage_v6: true });
      const [account] = await db.insert(billingAccounts).values({ displayName: "Unfunded Free Core preparation", payerUserId: f.userId }).returning();
      await db.insert(billingAccountCompanies).values({ companyId: f.home, billingAccountId: account!.id });
      const initial = await service.create(f.actor, f.home, { requestId: randomUUID() });
      const draft = await service.save(f.actor, f.home, initial.id, { requestId: randomUUID(), expectedVersion: initial.version, step: "runtime",
        content: { ...initial.content!, name: "Prepared specialist", outcome: "Prepare a private internal draft" } });
      const review = await service.preparationReview(f.actor, f.home, draft.id);
      const command = { requestId: randomUUID(), expectedVersion: draft.version, expectedReviewHash: review.reviewHash, confirmInactiveAgentPreparation: true as const };
      return { draft, review, command };
    }
    async function effectCounts() {
      return db.execute(sql`select
        (select count(*) from heartbeat_runs where company_id=${f.home}::uuid) as runs,
        (select count(*) from tool_connection_installs where company_id=${f.home}::uuid) as installs,
        (select count(*) from tool_profile_bindings where company_id=${f.home}::uuid) as bindings,
        (select count(*) from connection_grants where company_id=${f.home}::uuid) as grants,
        (select count(*) from connection_grant_delegations where company_id=${f.home}::uuid) as delegations,
        (select count(*) from company_agent_package_installations where company_id=${f.home}::uuid) as packages,
        (select count(*) from billing_subscriptions s join billing_account_companies c on c.billing_account_id=s.billing_account_id where c.company_id=${f.home}::uuid) as subscriptions`);
    }
    it("prepares one actual inactive Agent only after explicit C3 and reconciles concurrent replay without runtime or business authority", async () => {
      const before = (await db.select().from(agents)).length, effects = await effectCounts();
      const { draft, review, command } = await preparationFixture();
      expect(await db.select().from(agents)).toHaveLength(before);
      expect(review).toMatchObject({ createsInactiveAgent: true, runtimeQualified: false, authorityGranted: false, executionStarted: false });
      const [prepared, replay] = await Promise.all([service.prepare(f.actor, f.home, draft.id, command), service.prepare(f.actor, f.home, draft.id, command)]);
      expect(prepared).toEqual(replay);
      expect(prepared.agentId).toBeNull();
      expect(prepared.preparation).toMatchObject({ status: "prepared", runtimeQualified: false, authorityGranted: false, executionStarted: false });
      expect(await db.select().from(agents)).toHaveLength(before + 1);
      const [agent] = await db.select().from(agents).where(eq(agents.id, prepared.preparation!.agentId));
      expect(agent).toMatchObject({ companyId: f.home, name: review.name, status: "paused", adapterType: "openclaw_gateway", adapterConfig: {}, budgetMonthlyCents: 0,
        permissions: { canCreateAgents: false, canCreateSkills: false }, runtimeConfig: { heartbeat: { enabled: false } } });
      expect(await effectCounts()).toEqual(effects);
      expect((await service.review(f.actor, f.home, draft.id)).publishAllowed).toBe(false);
      const audits = await db.select().from(activityLog).where(eq(activityLog.entityId, draft.id));
      expect(audits.filter(a => a.action === "agent_configuration.draft_agent_prepared")).toHaveLength(1);
      await expect(service.prepare(f.actor, f.home, draft.id, { ...command, expectedReviewHash: "b".repeat(64) })).rejects.toMatchObject({ status: 409 });
      await expect(db.update(agentConfigurationDrafts).set({ preparedAgentId: f.presence.id }).where(eq(agentConfigurationDrafts.id, draft.id))).rejects.toMatchObject({ cause: { code: "23514" } });
      await instanceSettingsService(db).updateExperimental({ hire_agent_v9: false });
      expect((await service.get(f.actor, f.home, draft.id)).preparation!.agentId).toBe(agent!.id);
      await expect(service.prepare(f.actor, f.home, draft.id, command)).rejects.toMatchObject({ status: 404 });
    });
    it("rechecks board approval, saved version, verified creator and ownership before creating the prepared Agent", async () => {
      const { draft, command } = await preparationFixture(), before = (await db.select().from(agents)).length;
      await db.update(companies).set({ requireBoardApprovalForNewAgents: true }).where(eq(companies.id, f.home));
      await expect(service.prepare(f.actor, f.home, draft.id, command)).rejects.toMatchObject({ status: 409 });
      const review = await service.preparationReview(f.actor, f.home, draft.id), current = { ...command, expectedReviewHash: review.reviewHash };
      await db.update(authUsers).set({ emailVerified: false }).where(eq(authUsers.id, f.userId));
      await expect(service.prepare({ ...f.actor, isInstanceAdmin: true }, f.home, draft.id, current)).rejects.toMatchObject({ status: 403 });
      await db.update(authUsers).set({ emailVerified: true }).where(eq(authUsers.id, f.userId));
      await expect(service.prepare(f.actor, f.guest, draft.id, current)).rejects.toMatchObject({ status: 404 });
      await expect(service.prepare(f.actor, f.home, draft.id, { ...current, expectedVersion: 1 })).rejects.toMatchObject({ status: 409 });
      expect(await db.select().from(agents)).toHaveLength(before);
      const prepared = await service.prepare(f.actor, f.home, draft.id, current);
      expect(prepared.preparation!.status).toBe("pending_approval");
      const [approval] = await db.select().from(approvals).where(eq(approvals.id, prepared.preparation!.approvalId!));
      expect(approval).toMatchObject({ companyId: f.home, type: "hire_agent", status: "pending", requestedByUserId: f.userId, payload: { agentId: prepared.preparation!.agentId } });
      expect((await service.review(f.actor, f.home, draft.id)).publishAllowed).toBe(false);
    });
    it("keeps inherited company-wide access unchanged and refuses to call it zero-authority preparation", async () => {
      const { draft, command } = await preparationFixture(), before = (await db.select().from(agents)).length;
      const [application] = await db.insert(toolApplications).values({ companyId: f.home, applicationKey: "linear", name: "Existing company app", type: "mcp_http" }).returning();
      const [connection] = await db.insert(toolConnections).values({ companyId: f.home, applicationId: application!.id, name: "Existing organization connection", uid: randomUUID(), transport: "rest_api", authKind: "none" }).returning();
      const [install] = await db.insert(toolConnectionInstalls).values({ companyId: f.home, connectionId: connection!.id, targetType: "company", targetId: f.home }).returning();
      await expect(service.preparationReview(f.actor, f.home, draft.id)).rejects.toMatchObject({ status: 422, details: { code: "draft_inherited_access_requires_review" } });
      await expect(service.prepare(f.actor, f.home, draft.id, command)).rejects.toMatchObject({ status: 422 });
      expect(await db.select().from(agents)).toHaveLength(before);
      expect((await db.select().from(toolConnectionInstalls).where(eq(toolConnectionInstalls.id, install!.id)))[0]).toEqual(install);
    });
    it("only admits the prepared Agent's own runtime reference and preserves the unqualified test boundary after configuration changes", async () => {
      const { draft, command } = await preparationFixture();
      const prepared = await service.prepare(f.actor, f.home, draft.id, command);
      const [foreign] = await db.select().from(agentPresenceRuntimeBindings).where(eq(agentPresenceRuntimeBindings.agentId, f.presence.id));
      await expect(service.save(f.actor, f.home, draft.id, { requestId: randomUUID(), expectedVersion: prepared.version, step: "runtime",
        content: { ...prepared.content!, runtimeBindingId: foreign!.id } })).rejects.toMatchObject({ status: 422 });
      const [own] = await db.select().from(agentPresenceRuntimeBindings).where(eq(agentPresenceRuntimeBindings.agentId, prepared.preparation!.agentId));
      expect(own).toBeDefined();
      const saved = await service.save(f.actor, f.home, draft.id, { requestId: randomUUID(), expectedVersion: prepared.version, step: "runtime",
        content: { ...prepared.content!, runtimeBindingId: own!.id } });
      expect(saved.content!.runtimeBindingId).toBe(own!.id);
      expect((await service.review(f.actor, f.home, draft.id)).test.status).toBe("unqualified");
      await db.update(agents).set({ name: "Changed original configuration" }).where(eq(agents.id, prepared.preparation!.agentId));
      expect((await service.get(f.actor, f.home, draft.id)).preparation!.status).toBe("needs_review");
      expect((await service.review(f.actor, f.home, draft.id)).publishAllowed).toBe(false);
      await expect(service.prepare(f.actor, f.home, draft.id, { ...command, requestId: randomUUID(), expectedVersion: saved.version })).rejects.toMatchObject({ status: 409 });
    });
    it("reads only the actual prepared runtime and never qualifies an unconfigured or different Agent's placeholder", async () => {
      const { draft, command } = await preparationFixture();
      expect(await service.runtime(f.actor, f.home, draft.id)).toMatchObject({ agentId: null, runtimeBindingId: null, configurationHash: null,
        status: "not_prepared", runtimeQualified: false, safeTestQualified: false, executionStarted: false });
      const prepared = await service.prepare(f.actor, f.home, draft.id, command);
      const [owned] = await db.select().from(agentPresenceRuntimeBindings).where(eq(agentPresenceRuntimeBindings.agentId, prepared.preparation!.agentId));
      const before = await db.select().from(activityLog), effects = await effectCounts();
      const observed = await service.runtime(f.actor, f.home, draft.id);
      expect(observed).toMatchObject({ draftId: draft.id, companyId: f.home, version: prepared.version, agentId: prepared.preparation!.agentId,
        runtimeBindingId: owned!.id, status: "needs_setup", runtimeQualified: false, safeTestQualified: false, executionStarted: false });
      const [row] = await db.select().from(agentConfigurationDrafts).where(eq(agentConfigurationDrafts.id, draft.id));
      expect(observed.configurationHash).toBe(row!.preparationConfigurationHash);
      expect(await db.select().from(activityLog)).toEqual(before); expect(await effectCounts()).toEqual(effects);
      expect(Object.keys(observed)).not.toContain("adapterConfig"); expect(Object.keys(observed)).not.toContain("providerProfileRef");
      await instanceSettingsService(db).updateExperimental({ hire_agent_v9: false });
      expect((await service.runtime(f.actor, f.home, draft.id)).status).toBe("needs_setup");
      await db.update(authUsers).set({ emailVerified: false }).where(eq(authUsers.id, f.userId));
      await expect(service.runtime({ ...f.actor, isInstanceAdmin: true }, f.home, draft.id)).rejects.toMatchObject({ status: 403 });
    });
    it("keeps board approval separate from runtime proof and preserves the existing revision's actual identity", async () => {
      const { draft, command } = await preparationFixture();
      await db.update(companies).set({ requireBoardApprovalForNewAgents: true }).where(eq(companies.id, f.home));
      const review = await service.preparationReview(f.actor, f.home, draft.id);
      await service.prepare(f.actor, f.home, draft.id, { ...command, expectedReviewHash: review.reviewHash });
      expect(await service.runtime(f.actor, f.home, draft.id)).toMatchObject({ status: "awaiting_approval", runtimeQualified: false, safeTestQualified: false });
      const revision = await service.create(f.actor, f.home, { requestId: randomUUID(), agentId: f.presence.id });
      const [binding] = await db.select().from(agentPresenceRuntimeBindings).where(eq(agentPresenceRuntimeBindings.agentId, f.presence.id));
      expect(await service.runtime(f.actor, f.home, revision.id)).toMatchObject({ agentId: f.presence.id, runtimeBindingId: binding!.id,
        status: "needs_setup", safeTestQualified: false, executionStarted: false });
      await expect(service.runtime(f.actor, f.guest, draft.id)).rejects.toMatchObject({ status: 404 });
    });
    it("projects exact retained Original runtime pins and withdraws the projection on configuration or profile drift", async () => {
      const { draft, command } = await preparationFixture(), prepared = await service.prepare(f.actor, f.home, draft.id, command), agentId = prepared.preparation!.agentId;
      const bindingService = agentProviderBindingService(db), binding = (await bindingService.getForPresence(f.actor, f.home, agentId))!;
      const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
      // Explicit metadata fixture through the Original internal owner. These
      // retained rows test projection; no provider probes or GA proof is claimed.
      const snapshot: Omit<ProviderCapabilitySnapshot, "hash"> = { provider: binding.provider.providerType, version: "software-contract-fixture-v1",
        features: Object.fromEntries(PROVIDER_CAPABILITY_FEATURES.map(key => [key, false])) as ProviderCapabilitySnapshot["features"],
        skills: [], tools: [], discoveredAt: new Date().toISOString() };
      const retain = () => bindingService.recordDiscovery(f.home, agentId, snapshot,
        Object.fromEntries(providerConformanceRequirements(makeProviderCapabilitySnapshot(snapshot), binding.provider.isolationMode).map(check => [check, true])),
        { configurationHash: hashContextPolicySnapshot({ adapterType: agent!.adapterType, adapterConfig: agent!.adapterConfig }), runtimeId: binding.runtime.id,
          profileRef: binding.runtime.providerProfileRef, bindingId: binding.provider.id, accountingComplete: true });
      await retain();
      const before = await db.select().from(activityLog), effects = await effectCounts();
      const observed = await service.runtime(f.actor, f.home, draft.id);
      expect(observed).toMatchObject({ status: "qualified", agentId, runtimeBindingId: binding.runtime.id, runtimeQualified: true, safeTestQualified: false, executionStarted: false });
      expect(await db.select().from(activityLog)).toEqual(before); expect(await effectCounts()).toEqual(effects);
      await db.update(agentPresenceRuntimeBindings).set({ providerProfileRef: "changed-profile" }).where(eq(agentPresenceRuntimeBindings.id, binding.runtime.id));
      expect((await service.runtime(f.actor, f.home, draft.id)).runtimeQualified).toBe(false);
      await db.update(agentPresenceRuntimeBindings).set({ providerProfileRef: binding.runtime.providerProfileRef }).where(eq(agentPresenceRuntimeBindings.id, binding.runtime.id));
      expect((await service.runtime(f.actor, f.home, draft.id)).runtimeQualified).toBe(true);
      await db.update(agents).set({ adapterConfig: { changed: "PRIVATE runtime configuration" } }).where(eq(agents.id, agentId));
      const drifted = await service.runtime(f.actor, f.home, draft.id);
      expect(drifted.status).toBe("needs_setup"); expect(drifted.runtimeQualified).toBe(false);
      expect(drifted.configurationHash).not.toBe(observed.configurationHash); expect(JSON.stringify(drifted)).not.toContain("PRIVATE runtime configuration");
    });
    it("checks current revision admission without returning configuration or writing proposals, grants or audits", async () => {
      const drafts = await db.select().from(agentConfigurationDrafts);
      const activity = await db.select().from(activityLog);
      expect(await service.admission(f.actor, f.home, f.presence.id)).toEqual({
        companyId: f.home,
        agentId: f.presence.id,
        canCreateDraft: true,
      });
      expect(await db.select().from(agentConfigurationDrafts)).toEqual(drafts);
      expect(await db.select().from(activityLog)).toEqual(activity);
      await instanceSettingsService(db).updateExperimental({
        hire_agent_v9: false,
      });
      await expect(
        service.admission(f.actor, f.home, f.presence.id),
      ).rejects.toMatchObject({ status: 404 });
    });
    it("does not treat instance-admin or stale membership as current verified revision authority", async () => {
      await db
        .update(authUsers)
        .set({ emailVerified: false })
        .where(eq(authUsers.id, f.actor.userId!));
      await expect(
        service.admission(
          { ...f.actor, isInstanceAdmin: true },
          f.home,
          f.presence.id,
        ),
      ).rejects.toMatchObject({ status: 403 });
      await db
        .update(authUsers)
        .set({ emailVerified: true })
        .where(eq(authUsers.id, f.actor.userId!));
      await db
        .delete(companyMemberships)
        .where(eq(companyMemberships.principalId, f.actor.userId!));
      await expect(
        service.admission(
          { ...f.actor, isInstanceAdmin: true },
          f.home,
          f.presence.id,
        ),
      ).rejects.toMatchObject({ status: 403 });
    });
    it("reconciles concurrent new-draft creation without creating agents, effective revisions or duplicate audits", async () => {
      const body = { requestId: randomUUID(), agentId: null };
      const agentCount = (await db.select().from(agents)).length;
      const [first, second] = await Promise.all([
        service.create(f.actor, f.home, body),
        service.create(f.actor, f.home, body),
      ]);
      expect(first.id).toBe(second.id);
      expect(first.status).toBe("draft");
      expect(first.agentId).toBeNull();
      expect(await db.select().from(agents)).toHaveLength(agentCount);
      expect(
        (
          await db
            .select()
            .from(activityLog)
            .where(eq(activityLog.entityId, first.id))
        ).filter((e) => e.action === "agent_configuration.draft_created"),
      ).toHaveLength(1);
      await expect(
        service.create(f.actor, f.home, { ...body, agentId: f.presence.id }),
      ).rejects.toMatchObject({ status: 409 });
    });
    it("saves an active agent revision atomically without changing its configuration or authority", async () => {
      const [before] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, f.presence.id));
      const grants = await db
        .select()
        .from(principalPermissionGrants)
        .where(eq(principalPermissionGrants.companyId, f.home));
      const first = await service.create(f.actor, f.home, {
        requestId: randomUUID(),
        agentId: f.presence.id,
      });
      const body = {
        requestId: randomUUID(),
        expectedVersion: 1,
        step: "instructions",
        content: {
          ...first.content!,
          outcome: "Prepare a source-bound draft",
          instructions: {
            ...first.content!.instructions,
            purpose: "Private draft text canary",
          },
        },
      };
      const [saved, replay] = await Promise.all([
        service.save(f.actor, f.home, first.id, body),
        service.save(f.actor, f.home, first.id, body),
      ]);
      expect(saved.version).toBe(2);
      expect(saved).toEqual(replay);
      expect(
        (await db.select().from(agents).where(eq(agents.id, f.presence.id)))[0],
      ).toEqual(before);
      expect(
        await db
          .select()
          .from(principalPermissionGrants)
          .where(eq(principalPermissionGrants.companyId, f.home)),
      ).toEqual(grants);
      const audit = await db
        .select()
        .from(activityLog)
        .where(eq(activityLog.entityId, first.id));
      expect(
        audit.filter((e) => e.action === "agent_configuration.draft_saved"),
      ).toHaveLength(1);
      expect(JSON.stringify(audit)).not.toContain("Private draft text canary");
      await expect(
        service.save(f.actor, f.home, first.id, {
          ...body,
          content: { ...body.content, name: "Different" },
        }),
      ).rejects.toMatchObject({
        status: 409,
        details: { code: "draft_request_conflict" },
      });
      await expect(
        service.save(f.actor, f.home, first.id, {
          ...body,
          requestId: randomUUID(),
        }),
      ).rejects.toMatchObject({
        status: 409,
        details: { code: "draft_version_conflict" },
      });
    });
    it("keeps creator drafts private and denies revoked membership even to an instance administrator", async () => {
      const first = await service.create(f.actor, f.home, {
        requestId: randomUUID(),
      });
      const other = await seedV5Presences(db);
      await expect(
        service.get(other.actor, other.home, first.id),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.get(f.actor, f.guest, first.id),
      ).rejects.toMatchObject({ status: 404 });
      await db
        .update(companyMemberships)
        .set({ status: "suspended" })
        .where(sql`company_id=${f.home}::uuid and principal_id=${f.userId}`);
      await expect(
        service.get({ ...f.actor, isInstanceAdmin: true }, f.home, first.id),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        service.save(f.actor, f.home, first.id, {
          requestId: randomUUID(),
          expectedVersion: 1,
          step: "outcome",
          content: first.content,
        }),
      ).rejects.toMatchObject({ status: 403 });
    });
    it("keeps existing drafts readable and discardable on rollout rollback, with the payload erased", async () => {
      const first = await service.create(f.actor, f.home, {
        requestId: randomUUID(),
      });
      await instanceSettingsService(db).updateExperimental({
        hire_agent_v9: false,
      });
      expect((await service.get(f.actor, f.home, first.id)).id).toBe(first.id);
      expect((await service.list(f.actor, f.home)).items).toHaveLength(1);
      await expect(
        service.save(f.actor, f.home, first.id, {
          requestId: randomUUID(),
          expectedVersion: 1,
          step: "identity",
          content: first.content,
        }),
      ).rejects.toMatchObject({ status: 404 });
      const body = { requestId: randomUUID(), expectedVersion: 1 };
      const removed = await service.discard(f.actor, f.home, first.id, body);
      expect(removed.status).toBe("discarded");
      expect(removed.content).toBeNull();
      expect(await service.discard(f.actor, f.home, first.id, body)).toEqual(
        removed,
      );
      expect((await service.list(f.actor, f.home)).items).toHaveLength(0);
    });
    it("rejects foreign knowledge, owner and runtime references rather than treating draft text as a grant", async () => {
      const first = await service.create(f.actor, f.home, {
        requestId: randomUUID(),
      });
      for (const patch of [
        { knowledgeDocumentIds: [randomUUID()] },
        { runtimeBindingId: randomUUID() },
        { ownerUserId: "foreign-user" },
      ]) {
        await expect(
          service.save(f.actor, f.home, first.id, {
            requestId: randomUUID(),
            expectedVersion: 1,
            step: "knowledge",
            content: { ...first.content!, ...patch },
          }),
        ).rejects.toMatchObject({ status: 422 });
      }
      expect(
        agentAuthoringContentSchema.safeParse({
          ...first.content!,
          capabilities: [
            { operation: "change_permissions", autonomy: "automatic" },
          ],
        }).success,
      ).toBe(false);
      expect(
        agentAuthoringContentSchema.safeParse({
          ...first.content!,
          capabilities: [{ operation: "external_send", autonomy: "automatic" }],
        }).success,
      ).toBe(false);
    });
    it("detects a changed production baseline and reports unqualified tests without manufacturing execution evidence", async () => {
      const first = await service.create(f.actor, f.home, {
        requestId: randomUUID(),
        agentId: f.presence.id,
      });
      expect(
        (await service.review(f.actor, f.home, first.id)).baselineCurrent,
      ).toBe(true);
      await db
        .update(agents)
        .set({ capabilities: "Changed by an authorized native editor" })
        .where(eq(agents.id, f.presence.id));
      const review = await service.review(f.actor, f.home, first.id);
      expect(review.baselineCurrent).toBe(false);
      expect(review.publishAllowed).toBe(false);
      expect(review.test.status).toBe("unqualified");
      expect(review.productionChanged).toBe(false);
      expect(review.blockers.map((b) => b.code)).toContain(
        "production_baseline_changed",
      );
    });
    it("enforces native draft scope and version fences and account erasure without retaining authored content", async () => {
      const first = await service.create(f.actor, f.home, {
        requestId: randomUUID(),
      });
      await expect(
        db
          .update(agentConfigurationDrafts)
          .set({ companyId: f.guest, version: 2 })
          .where(eq(agentConfigurationDrafts.id, first.id)),
      ).rejects.toMatchObject({
        cause: {
          code: "23514",
          message: "agent_configuration_draft_scope_immutable",
        },
      });
      await expect(
        db
          .update(agentConfigurationDrafts)
          .set({ step: "identity" })
          .where(eq(agentConfigurationDrafts.id, first.id)),
      ).rejects.toMatchObject({
        cause: {
          code: "23514",
          message: "agent_configuration_draft_version_conflict",
        },
      });
      await db.delete(authUsers).where(eq(authUsers.id, f.userId));
      expect(
        await db
          .select()
          .from(agentConfigurationDrafts)
          .where(eq(agentConfigurationDrafts.id, first.id)),
      ).toHaveLength(0);
    });
    it("reads earlier accepted native drafts above the new write budget without permitting another oversized write", async () => {
      const content = agentAuthoringContentSchema.parse({
        ownerUserId: f.userId,
        scenarios: Array.from({ length: 10 }, () => "界".repeat(1800)),
      });
      content.instructions.responsibilities = "界".repeat(3200);
      const [row] = await db
        .insert(agentConfigurationDrafts)
        .values({
          companyId: f.home,
          createdByUserId: f.userId,
          creationRequestId: randomUUID(),
          creationRequestHash: "a".repeat(64),
          content,
        })
        .returning();
      expect((await service.get(f.actor, f.home, row!.id)).content).toEqual(
        content,
      );
      await expect(
        service.save(f.actor, f.home, row!.id, {
          requestId: randomUUID(),
          expectedVersion: 1,
          step: "instructions",
          content,
        }),
      ).rejects.toThrow("complete draft is too large");
      expect((await service.get(f.actor, f.home, row!.id)).version).toBe(1);
    });
    it("pages private draft history across native timestamp ties and rejects foreign cursors", async () => {
      const rows = await db
        .insert(agentConfigurationDrafts)
        .values(
          Array.from({ length: 30 }, () => ({
            companyId: f.home,
            createdByUserId: f.userId,
            creationRequestId: randomUUID(),
            creationRequestHash: "a".repeat(64),
            content: agentAuthoringContentSchema.parse({
              ownerUserId: f.userId,
            }),
            updatedAt: new Date("2026-10-09T00:00:00Z"),
          })),
        )
        .returning();
      await db.execute(
        sql`update agent_configuration_drafts set updated_at='2026-10-09T00:00:00.000456Z'::timestamptz,version=version+1 where company_id=${f.home}::uuid`,
      );
      const first = await service.list(f.actor, f.home);
      expect(first.items).toHaveLength(25);
      expect(first.items[0]).not.toHaveProperty("content");
      expect(first.items[0]).not.toHaveProperty("createdByUserId");
      expect(first.nextCursor).not.toBeNull();
      const second = await service.list(f.actor, f.home, first.nextCursor!);
      expect(second.items).toHaveLength(5);
      expect(second.nextCursor).toBeNull();
      expect(
        new Set([...first.items, ...second.items].map((item) => item.id)).size,
      ).toBe(rows.length);
      await expect(
        service.list(f.actor, f.guest, first.nextCursor!),
      ).rejects.toMatchObject({ status: 400 });
    });
  },
);
