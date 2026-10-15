import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { activityLog, authUsers, billingAccounts, billingAccountCompanies, companyMemberships, createDb, instanceSettings,
  principalPermissionGrants, runtimeCapacityProfiles, runtimeCells, runtimeOperations, runtimeVersionCatalog } from "@paperclipai/db";
import { V5_FEATURE_KEYS, V6_FEATURE_KEYS, V7_FEATURE_KEYS, V9_FEATURE_KEYS } from "@paperclipai/shared";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { seedV5Companies } from "./helpers/v5-fixtures.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { readRuntimeRecovery } from "../services/experience/runtime-recovery.js";
import { experienceService } from "../services/experience/service.js";
import * as runtimeRecovery from "../services/experience/runtime-recovery.js";

describe("V9 current Original runtime recovery projection", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let fixture: Awaited<ReturnType<typeof seedV5Companies>>, account: string, capacity: string, image: string;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("aw-v9-runtime-recovery-"); db = createDb(database.connectionString);
    await instanceSettingsService(db).getExperimental();
  }, 60000);
  afterAll(async () => { await database?.cleanup(); }, 30000);
  beforeEach(async () => {
    vi.restoreAllMocks(); fixture = await seedV5Companies(db);
    await db.update(instanceSettings).set({ experimental: { ...Object.fromEntries(
      [...V5_FEATURE_KEYS, ...V6_FEATURE_KEYS, ...V7_FEATURE_KEYS, ...V9_FEATURE_KEYS].map(key => [key, true])),
      enableFoundationV1: true, enableContextEngineV1: true, enableCollectiveMemoryV1: true,
      enableWorkflowsV1: true, enableChatConnectors: true } })
      .where(eq(instanceSettings.singletonKey, "default"));
    const [row] = await db.insert(billingAccounts).values({ displayName: "Owned recovery fixture", payerUserId: fixture.userId }).returning();
    account = row!.id;
    await db.insert(billingAccountCompanies).values([fixture.home, fixture.guest].map(companyId => ({ companyId, billingAccountId: account })));
    capacity = `recovery-${randomUUID()}`; image = `fixture.invalid/recovery@sha256:${randomUUID().replaceAll("-", "").repeat(2)}`;
    await db.insert(runtimeCapacityProfiles).values({ key: capacity, cpuMillis: 1000, memoryBytes: 1073741824n,
      diskBytes: 10737418240n, pidsLimit: 128, qualified: false });
    await db.insert(runtimeVersionCatalog).values({ imageDigest: image, providerVersion: "fixture-only", stateFormat: "v1",
      hostAgentMinimumVersion: "6.0.0", conformance: { fixtureOnly: true }, status: "approved" });
  });
  const read = () => readRuntimeRecovery(db, fixture.actor, fixture.home, new AbortController().signal);
  async function cell(status = "DEGRADED", companyId = fixture.home, extras: Partial<typeof runtimeCells.$inferInsert> = {}) {
    const [row] = await db.insert(runtimeCells).values({ companyId, billingAccountId: account, capacityProfile: capacity,
      desiredImageDigest: image, isolationMode: "company_cell", status, gatewaySecretRef: "PRIVATE-RECOVERY-CREDENTIAL", ...extras }).returning();
    return row!;
  }
  it("projects only current owned findings, exposes no credentials/error text and causes no repair effects", async () => {
    const degraded = await cell("DEGRADED", fixture.home, { lastErrorCode: "PRIVATE-ERROR-DETAILS" });
    const capacityRow = await cell("STOPPED", fixture.home, { suspendedReason: "PRIVATE-BILLING-REASON" });
    await cell("HEALTHY"); await cell("REQUESTED"); await cell("STOPPED"); await cell("DEGRADED", fixture.guest);
    await cell("DELETED", fixture.home, { deletedAt: new Date() });
    const before = await db.select().from(runtimeCells).where(eq(runtimeCells.companyId, fixture.home));
    const logBefore = await db.select().from(activityLog).where(eq(activityLog.companyId, fixture.home));
    const value = await read();
    expect(value.needsYou.map(card => card.source.resourceId).sort()).toEqual([degraded.id, capacityRow.id].sort());
    expect(value.needsYou.every(card => card.kind === "recovery" && card.actions.every(action => action.operation === "open" && action.criticality === "C4"))).toBe(true);
    expect(JSON.stringify(value)).not.toContain("PRIVATE-");
    expect(await db.select().from(runtimeCells).where(eq(runtimeCells.companyId, fixture.home))).toEqual(before);
    expect(await db.select().from(runtimeOperations).where(eq(runtimeOperations.companyId, fixture.home))).toEqual([]);
    expect(await db.select().from(activityLog).where(eq(activityLog.companyId, fixture.home))).toEqual(logBefore);
  });
  it("denies a viewer without the Original runtime grant and does not substitute instance admin", async () => {
    await cell();
    await db.update(companyMemberships).set({ membershipRole: "viewer" }).where(and(eq(companyMemberships.companyId, fixture.home),
      eq(companyMemberships.principalId, fixture.userId)));
    await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, fixture.home),
      eq(principalPermissionGrants.principalId, fixture.userId), eq(principalPermissionGrants.permissionKey, "runtime:manage")));
    await expect(read()).rejects.toMatchObject({ status: 403 });
    await expect(readRuntimeRecovery(db, { ...fixture.actor, isInstanceAdmin: true }, fixture.home, new AbortController().signal))
      .rejects.toMatchObject({ status: 403 });
    await db.insert(principalPermissionGrants).values({ companyId: fixture.home, principalType: "user", principalId: fixture.userId,
      permissionKey: "runtime:manage", scope: null });
    await expect(read()).rejects.toMatchObject({ status: 403 });
    await db.update(companyMemberships).set({ membershipRole: "member" }).where(and(eq(companyMemberships.companyId, fixture.home),
      eq(companyMemberships.principalId, fixture.userId)));
    expect((await read()).needsYou).toHaveLength(1);
  });
  it("withdraws an unverified account, inactive membership and disabled predecessor before returning private findings", async () => {
    await cell();
    await db.update(authUsers).set({ emailVerified: false }).where(eq(authUsers.id, fixture.userId));
    await expect(read()).rejects.toMatchObject({ status: 403 });
    await db.update(authUsers).set({ emailVerified: true }).where(eq(authUsers.id, fixture.userId));
    await db.update(companyMemberships).set({ status: "inactive" }).where(and(eq(companyMemberships.companyId, fixture.home), eq(companyMemberships.principalId, fixture.userId)));
    await expect(read()).rejects.toMatchObject({ status: 403 });
    await db.update(companyMemberships).set({ status: "active" }).where(and(eq(companyMemberships.companyId, fixture.home), eq(companyMemberships.principalId, fixture.userId)));
    await instanceSettingsService(db).updateExperimental({ hosted_openclaw_v6: false, runtime_dedicated_gateway_v6: false,
      runtime_dedicated_vm_v6: false, runtime_auto_host_scale_v6: false, openshell_v7: false });
    await expect(read()).rejects.toMatchObject({ status: 404 });
  });
  it("bounds the result and binds status, generation and update time to the current source version", async () => {
    const row = await cell(), initial = (await read()).needsYou[0]!.source.version;
    await db.update(runtimeCells).set({ generation: 2n, updatedAt: new Date() }).where(eq(runtimeCells.id, row.id));
    expect((await read()).needsYou[0]!.source.version).not.toBe(initial);
    for (let index = 0; index < 6; index++) await cell();
    const value = await read(); expect(value.needsYou).toHaveLength(5); expect(value.coverage?.reason).toBe("more_items_available");
  });
  it("withdraws a changed finding after the experience fan-out instead of returning its stale card", async () => {
    const row = await cell(), real = runtimeRecovery.readRuntimeRecovery;
    let calls = 0;
    vi.spyOn(runtimeRecovery, "readRuntimeRecovery").mockImplementation(async (...args) => {
      const result = await real(...args);
      if (++calls === 1) await db.update(runtimeCells).set({ status: "HEALTHY", updatedAt: new Date() }).where(eq(runtimeCells.id, row.id));
      return result;
    });
    const value = await experienceService(db).home(fixture.actor, fixture.home);
    expect(value.needsYou.filter(card => card.source.domain === "runtime_cell")).toEqual([]);
    expect(value.dependencies.find(entry => entry.domain === "runtime-recovery")).toMatchObject({ state: "partial", reason: "source_stale" });
  });
  it("withdraws runtime findings when the Original manager role is lost after the first read", async () => {
    await cell(); const real = runtimeRecovery.readRuntimeRecovery; let calls = 0;
    vi.spyOn(runtimeRecovery, "readRuntimeRecovery").mockImplementation(async (...args) => {
      const result = await real(...args);
      if (++calls === 1) await db.update(companyMemberships).set({ membershipRole: "viewer" }).where(and(
        eq(companyMemberships.companyId, fixture.home), eq(companyMemberships.principalId, fixture.userId)));
      return result;
    });
    const value = await experienceService(db).home(fixture.actor, fixture.home);
    expect(value.needsYou.filter(card => card.source.domain === "runtime_cell")).toEqual([]);
    expect(value.dependencies.find(entry => entry.domain === "runtime-recovery")).toMatchObject({ state: "partial", reason: "denied" });
  });
});
