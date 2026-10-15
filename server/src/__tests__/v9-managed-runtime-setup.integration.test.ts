import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { activityLog, agents, billingAccounts, billingAccountCompanies, billingSubscriptions, companySecrets,
  authUsers, instanceUserRoles, companyMemberships, principalPermissionGrants, createDb, runtimeCells, runtimeOperations, runtimeCapacityProfiles, runtimeVersionCatalog } from "@paperclipai/db";
import { agentAuthoringManagedRuntimeSetupService } from "../services/agents/authoring-managed-runtime-setup.js";
import { agentAuthoringService } from "../services/agents/authoring-drafts.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import type { SaasPlatformConfig } from "../saas-platform-config.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { prepareHirePublicationFixture } from "./helpers/hire-publication.js";

describe("Guided managed setup composes the Original provisioning operation", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let f: Awaited<ReturnType<typeof seedV5Presences>>, draft: Awaited<ReturnType<ReturnType<typeof agentAuthoringService>["create"]>>;
  let profile: string, digest: string;
  const config = { deployment: { sourceSha: "a".repeat(40) }, objects: { endpoint: "https://protected.test.invalid" },
    runtime: { relayPort: 3102, hostPlan: "software-fixture" }, operatorUserIds: [] } as unknown as SaasPlatformConfig;
  const service = () => agentAuthoringManagedRuntimeSetupService(db, config);
  beforeAll(async () => {
    vi.stubEnv("PAPERCLIP_SECRETS_MASTER_KEY", "a".repeat(64));
    database = await startEmbeddedPostgresTestDatabase("aw-v9-managed-setup-"); db = createDb(database.connectionString);
    await instanceSettingsService(db).getExperimental(); await enableV5ForTest(db);
  }, 60000);
  afterAll(async () => { await database?.cleanup(); vi.unstubAllEnvs(); }, 30000);
  beforeEach(async () => {
    await instanceSettingsService(db).updateExperimental({ saas_deployment_profile_v6: true, billing_v6: true,
      billing_entitlements_v6: true, billing_usage_v6: true, hosted_openclaw_v6: true, runtime_host_agent_v6: true,
      agent_packages_v7: true, hire_agent_v9: true, free_core_commercial_v7: true });
    f = await seedV5Presences(db);
    const [account] = await db.insert(billingAccounts).values({ displayName: "Software managed setup fixture", payerUserId: f.userId }).returning();
    await db.insert(billingAccountCompanies).values({ companyId: f.home, billingAccountId: account!.id });
    await db.insert(billingSubscriptions).values({ billingAccountId: account!.id, providerSubscriptionId: `fixture-${randomUUID()}`,
      status: "active", productKeys: ["runtime_standard"], currentPeriodEnd: new Date(Date.now() + 3600000),
      providerUpdatedAt: new Date(), sourceHash: "software-only-no-provider-charge" });
    await db.update(agents).set({ status: "paused", pauseReason: "manual" }).where(eq(agents.id, f.presence.id));
    draft = await agentAuthoringService(db).create(f.actor, f.home, { requestId: randomUUID(), agentId: f.presence.id });
    profile = `fixture-${randomUUID()}`; digest = `fixture.invalid/runtime@sha256:${randomUUID().replaceAll("-", "").repeat(2)}`;
    // Scoped software qualification inputs. No actual capacity benchmark,
    // hosted provider or runtime execution is claimed by these fixtures.
    const evidence = { reportUri: "https://protected.test.invalid/qualification/software.json", reportSha256: "b".repeat(64),
      qualifiedAt: new Date().toISOString(), qualificationSourceSha: config.deployment.sourceSha, hostPlan: config.runtime.hostPlan };
    await db.insert(runtimeCapacityProfiles).values({ key: profile, commercialProductKey: "runtime_standard", cpuMillis: 1000,
      memoryBytes: 1000000000n, diskBytes: 10000000000n, pidsLimit: 128, qualified: true, benchmarkEvidence: evidence });
    await db.insert(runtimeVersionCatalog).values({ imageDigest: digest, providerVersion: "software-only", stateFormat: "fixture", hostAgentMinimumVersion: "6.0.0",
      conformance: evidence, status: "approved", approvedAt: new Date(), approvedByUserId: f.userId });
  });
  async function command() {
    const selection = { capacityProfile: profile, imageDigest: digest };
    const review = await service().review(f.actor, f.home, draft.id, selection);
    expect(review).toMatchObject({ canProvision: true, modelCalled: false, activatesAgent: false, grantsAuthority: false });
    return { ...selection, requestId: randomUUID(), expectedVersion: draft.version, expectedReviewHash: review.reviewHash,
      confirmManagedCapacity: true as const, confirmInactiveProvisioning: true as const };
  }
  it("retains one actual provisioning request and encrypted Gateway secret without altering or activating the Agent", async () => {
    const [before] = await db.select().from(agents).where(eq(agents.id, f.presence.id)), input = await command();
    const result = await service().confirm(f.actor, f.home, draft.id, input);
    expect(result).toMatchObject({ operationStatus: "REQUESTED", runtimeStatus: "REQUESTED", modelConfigured: false,
      runtimeQualified: false, activatesAgent: false, grantsAuthority: false });
    expect((await db.select().from(agents).where(eq(agents.id, f.presence.id)))[0]).toEqual(before);
    expect(await service().confirm(f.actor, f.home, draft.id, input)).toEqual(result);
    expect(await service().receipt(f.actor, f.home, draft.id, input.requestId)).toEqual(result);
    expect(await service().latestReceipt(f.actor, f.home, draft.id)).toEqual(result);
    expect(await db.select().from(runtimeOperations).where(eq(runtimeOperations.companyId, f.home))).toHaveLength(1);
    expect(await db.select().from(runtimeCells).where(eq(runtimeCells.companyId, f.home))).toHaveLength(1);
    expect(await db.select().from(companySecrets).where(eq(companySecrets.companyId, f.home))).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(/Gateway|credential|secret|reportUri/);
    await expect(service().confirm(f.actor, f.home, draft.id, { ...input, capacityProfile: "different" })).rejects.toMatchObject({ status: 409 });
  });
  it("reads its Original receipt after feature rollback and never treats an absent slot as a refusal", async () => {
    const input = await command(), result = await service().confirm(f.actor, f.home, draft.id, input);
    await instanceSettingsService(db).updateExperimental({ hire_agent_v9: false, hosted_openclaw_v6: false });
    const metadata = agentAuthoringManagedRuntimeSetupService(db);
    expect(await metadata.receipt(f.actor, f.home, draft.id, input.requestId)).toEqual(result);
    expect(await metadata.latestReceipt(f.actor, f.home, draft.id)).toEqual(result);
    expect(await metadata.confirm(f.actor, f.home, draft.id, input)).toEqual(result);
    expect(await metadata.receipt(f.actor, f.home, draft.id, randomUUID())).toBeNull();
    await expect(service().catalog(f.actor, f.home, draft.id)).rejects.toMatchObject({ status: 404 });
  });
  it("refuses changed qualification and version before creating a cell or operation", async () => {
    const input = await command();
    await expect(service().confirm(f.actor, f.home, draft.id, { ...input, expectedVersion: input.expectedVersion + 1 })).rejects.toMatchObject({ status: 409 });
    await db.update(runtimeVersionCatalog).set({ status: "halted" }).where(eq(runtimeVersionCatalog.imageDigest, digest));
    await expect(service().confirm(f.actor, f.home, draft.id, input)).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(runtimeOperations).where(eq(runtimeOperations.companyId, f.home))).toEqual([]);
  });
  it("rolls back the Original cell, Gateway secret, operation and receipt when the final audit fails", async () => {
    const input = await command();
    await db.execute(sql`create function aw_v9_managed_setup_failure() returns trigger language plpgsql as $body$
      begin if new.action='agent_configuration.managed_runtime_requested' then raise exception 'Synthetic final audit failure'; end if;
      return new; end $body$`);
    await db.execute(sql`create trigger aw_v9_managed_setup_failure after insert on activity_log for each row execute function aw_v9_managed_setup_failure()`);
    try { await expect(service().confirm(f.actor, f.home, draft.id, input)).rejects.toThrow(); }
    finally { await db.execute(sql`drop trigger aw_v9_managed_setup_failure on activity_log`); await db.execute(sql`drop function aw_v9_managed_setup_failure()`); }
    expect(await db.select().from(runtimeCells).where(eq(runtimeCells.companyId, f.home))).toEqual([]);
    expect(await db.select().from(runtimeOperations).where(eq(runtimeOperations.companyId, f.home))).toEqual([]);
    expect(await db.select().from(companySecrets).where(eq(companySecrets.companyId, f.home))).toEqual([]);
    expect(await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.home), eq(activityLog.action, "agent_configuration.managed_runtime_requested")))).toEqual([]);
    expect(await service().receipt(f.actor, f.home, draft.id, input.requestId)).toBeNull();
    expect(await service().confirm(f.actor, f.home, draft.id, input)).toMatchObject({ operationStatus: "REQUESTED" });
  });
  it("rolls back a late qualification withdrawal after the Original provisioning write", async () => {
    const input = await command();
    await db.execute(sql`create function aw_v9_managed_setup_withdrawal() returns trigger language plpgsql as $body$
      begin if new.action='agent_configuration.managed_runtime_requested' then update runtime_version_catalog set status='halted'; end if;
      return new; end $body$`);
    await db.execute(sql`create trigger aw_v9_managed_setup_withdrawal after insert on activity_log for each row execute function aw_v9_managed_setup_withdrawal()`);
    try { await expect(service().confirm(f.actor, f.home, draft.id, input)).rejects.toMatchObject({ status: 409 }); }
    finally { await db.execute(sql`drop trigger aw_v9_managed_setup_withdrawal on activity_log`); await db.execute(sql`drop function aw_v9_managed_setup_withdrawal()`); }
    expect(await db.select().from(runtimeOperations).where(eq(runtimeOperations.companyId, f.home))).toEqual([]);
    expect(await db.select().from(runtimeCells).where(eq(runtimeCells.companyId, f.home))).toEqual([]);
    expect(await db.select().from(companySecrets).where(eq(companySecrets.companyId, f.home))).toEqual([]);
    expect((await db.select().from(runtimeVersionCatalog).where(eq(runtimeVersionCatalog.imageDigest, digest)))[0]!.status).toBe("approved");
  });
  it("rejects foreign drafts and current account withdrawal without an instance-admin bypass", async () => {
    const input = await command(), result = await service().confirm(f.actor, f.home, draft.id, input);
    await expect(service().receipt(f.actor, f.guest, draft.id, input.requestId)).rejects.toMatchObject({ status: 404 });
    expect(result.cellId).toBeDefined();
    await db.update(authUsers).set({ emailVerified: false }).where(eq(authUsers.id, f.userId));
    await expect(service().latestReceipt({ ...f.actor, isInstanceAdmin: true }, f.home, draft.id)).rejects.toMatchObject({ status: 403 });
  });
  it("provisions for the actual prepared Hire package Agent without activating its installation", async () => {
    f = await seedV5Presences(db);
    const hire = await prepareHirePublicationFixture(db, f); draft = hire.draft;
    const [association] = await db.select().from(billingAccountCompanies).where(eq(billingAccountCompanies.companyId, f.home));
    await db.update(billingSubscriptions).set({ productKeys: ["agent_package_research", "runtime_standard"] })
      .where(eq(billingSubscriptions.billingAccountId, association!.billingAccountId));
    const [before] = await db.select().from(agents).where(eq(agents.id, hire.agent.id));
    const result = await service().confirm(f.actor, f.home, draft.id, await command());
    expect(result.agentId).toBe(hire.agent.id);
    expect((await db.select().from(agents).where(eq(agents.id, hire.agent.id)))[0]).toEqual(before);
    expect(await hire.packages.get(f.actor, f.home, hire.installation.id)).toMatchObject({ status: hire.installation.status });
    expect((await db.select().from(runtimeCells).where(eq(runtimeCells.id, result.cellId)))[0]!.dedicatedAgentId).toBe(hire.agent.id);
  });
  it("does not elevate a company viewer's runtime authority through instance administrator status", async () => {
    await db.update(companyMemberships).set({ membershipRole: "viewer" }).where(and(eq(companyMemberships.companyId, f.home), eq(companyMemberships.principalId, f.userId)));
    await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, f.home), eq(principalPermissionGrants.principalId, f.userId),
      eq(principalPermissionGrants.permissionKey, "runtime:manage")));
    await db.insert(instanceUserRoles).values({ userId: f.userId, role: "instance_admin" });
    await expect(service().catalog({ ...f.actor, isInstanceAdmin: true }, f.home, draft.id)).rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(runtimeOperations).where(eq(runtimeOperations.companyId, f.home))).toEqual([]);
  });
});
