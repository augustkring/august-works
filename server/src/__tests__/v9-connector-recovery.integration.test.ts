import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { activityLog, authUsers, companyMemberships, connectionGrants, createDb, instanceSettings,
  principalPermissionGrants, toolApplications, toolConnections } from "@paperclipai/db";
import { V5_FEATURE_KEYS, V6_FEATURE_KEYS, V7_FEATURE_KEYS, V9_FEATURE_KEYS } from "@paperclipai/shared";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { seedV5Companies } from "./helpers/v5-fixtures.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { readConnectorRecovery } from "../services/experience/connector-recovery.js";
import { experienceService } from "../services/experience/service.js";
import * as recovery from "../services/experience/connector-recovery.js";

describe("V9 Original connector recovery projection", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let fixture: Awaited<ReturnType<typeof seedV5Companies>>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("aw-v9-connector-recovery-"); db = createDb(database.connectionString);
    await instanceSettingsService(db).getExperimental();
  }, 60000);
  afterAll(async () => { await database?.cleanup(); }, 30000);
  beforeEach(async () => {
    vi.restoreAllMocks(); fixture = await seedV5Companies(db);
    await db.update(instanceSettings).set({ experimental: { ...Object.fromEntries(
      [...V5_FEATURE_KEYS, ...V6_FEATURE_KEYS, ...V7_FEATURE_KEYS, ...V9_FEATURE_KEYS].map(key => [key, true])),
      enableFoundationV1: true, enableContextEngineV1: true, enableCollectiveMemoryV1: true,
      enableWorkflowsV1: true, enableChatConnectors: true } }).where(eq(instanceSettings.singletonKey, "default"));
  });
  const read = () => readConnectorRecovery(db, fixture.actor, fixture.home, new AbortController().signal);
  async function connection(companyId = fixture.home, extras: Partial<typeof toolConnections.$inferInsert> = {}) {
    const [app] = await db.insert(toolApplications).values({ companyId, name: `PRIVATE-APP-${randomUUID()}`, type: "mcp_http" }).returning();
    const [row] = await db.insert(toolConnections).values({ companyId, applicationId: app!.id, name: "PRIVATE-CONNECTION", uid: randomUUID(),
      transport: "mcp_remote", status: "active", enabled: true, healthStatus: "error", healthMessage: "PRIVATE-HEALTH-MESSAGE",
      lastError: "PRIVATE-ERROR", config: { private: "PRIVATE-CONFIGURATION" }, ...extras }).returning();
    return row!;
  }
  it("projects owned active Native health without errors, configuration or recovery effects", async () => {
    const row = await connection(); await connection(fixture.guest); await connection(fixture.home, { enabled: false });
    await connection(fixture.home, { healthStatus: "ok" }); await connection(fixture.home, { status: "draft" });
    const archived = await connection(); await db.update(toolApplications).set({ status: "archived" }).where(eq(toolApplications.id, archived.applicationId));
    const before = await db.select().from(toolConnections).where(eq(toolConnections.companyId, fixture.home));
    const log = await db.select().from(activityLog).where(eq(activityLog.companyId, fixture.home));
    const result = await read(); expect(result.needsYou.map(card => card.source.resourceId)).toEqual([row.id]);
    expect(JSON.stringify(result)).not.toContain("PRIVATE-");
    expect(result.needsYou[0]!.actions[0]).toMatchObject({ operation: "open", criticality: "C4", href: `/apps/${row.id}/permissions` });
    expect(await db.select().from(toolConnections).where(eq(toolConnections.companyId, fixture.home))).toEqual(before);
    expect(await db.select().from(activityLog).where(eq(activityLog.companyId, fixture.home))).toEqual(log);
  });
  it("uses Original AI revoked-credential enrichment and withdraws the finding when its grant recovers", async () => {
    const row = await connection(fixture.home, { connectionPurpose: "ai", transport: "runtime_auth", authKind: "api_key", healthStatus: "ok" });
    const [grant] = await db.insert(connectionGrants).values({ companyId: fixture.home, connectionId: row.id,
      kind: "user", subjectUserId: fixture.userId, status: "revoked", revokedAt: new Date() }).returning();
    expect((await read()).needsYou[0]?.evidence).toEqual(["connector_access_review"]);
    await db.update(connectionGrants).set({ status: "active", revokedAt: null }).where(eq(connectionGrants.id, grant!.id));
    expect((await read()).needsYou).toEqual([]);
  });
  it("uses the current native user for GitHub per-user reauthorization rather than another user's active grant", async () => {
    const row = await connection(fixture.home, { healthStatus: "ok", credentialPolicy: "per_user", config: { sourceTemplateKey: "github" } });
    await db.insert(connectionGrants).values({ companyId: fixture.home, connectionId: row.id, kind: "user", subjectUserId: "other-native-user", status: "active" });
    expect((await read()).needsYou[0]?.evidence).toEqual(["connector_access_review"]);
    await db.insert(connectionGrants).values({ companyId: fixture.home, connectionId: row.id, kind: "user", subjectUserId: fixture.userId, status: "active" });
    expect((await read()).needsYou).toEqual([]);
  });
  it("uses the Original manager role/grant policy and denies viewer/admin bypass", async () => {
    await connection();
    await db.update(companyMemberships).set({ membershipRole: "member" }).where(and(eq(companyMemberships.companyId, fixture.home), eq(companyMemberships.principalId, fixture.userId)));
    await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, fixture.home),
      eq(principalPermissionGrants.principalId, fixture.userId), eq(principalPermissionGrants.permissionKey, "tools:manage_connections")));
    await expect(read()).rejects.toMatchObject({ status: 403 });
    await expect(readConnectorRecovery(db, { ...fixture.actor, isInstanceAdmin: true }, fixture.home, new AbortController().signal)).rejects.toMatchObject({ status: 403 });
    await db.insert(principalPermissionGrants).values({ companyId: fixture.home, principalType: "user", principalId: fixture.userId,
      permissionKey: "tools:manage_connections", scope: null });
    expect((await read()).needsYou).toHaveLength(1);
    await db.update(companyMemberships).set({ membershipRole: "viewer" }).where(and(eq(companyMemberships.companyId, fixture.home), eq(companyMemberships.principalId, fixture.userId)));
    await expect(read()).rejects.toMatchObject({ status: 403 });
  });
  it("requires a verified account/current rollout and bounds the findings", async () => {
    for (let index = 0; index < 6; index++) await connection();
    const value = await read(); expect(value.needsYou).toHaveLength(5); expect(value.coverage?.reason).toBe("more_items_available");
    await db.update(authUsers).set({ emailVerified: false }).where(eq(authUsers.id, fixture.userId));
    await expect(read()).rejects.toMatchObject({ status: 403 });
    await db.update(authUsers).set({ emailVerified: true }).where(eq(authUsers.id, fixture.userId));
    await db.update(instanceSettings).set({ experimental: { maintenance_autopilot_v9: false } }).where(eq(instanceSettings.singletonKey, "default"));
    await expect(read()).rejects.toMatchObject({ status: 404 });
  });
  it("withdraws a repaired connection after dashboard fan-out", async () => {
    const row = await connection(), real = recovery.readConnectorRecovery; let calls = 0;
    vi.spyOn(recovery, "readConnectorRecovery").mockImplementation(async (...args) => {
      const result = await real(...args);
      if (++calls === 1) await db.update(toolConnections).set({ healthStatus: "ok", updatedAt: new Date() }).where(eq(toolConnections.id, row.id));
      return result;
    });
    const value = await experienceService(db).home(fixture.actor, fixture.home);
    expect(value.needsYou.filter(card => card.source.domain === "connection" && card.kind === "recovery")).toEqual([]);
    expect(value.dependencies.find(entry => entry.domain === "connector-recovery")).toMatchObject({ state: "partial", reason: "source_stale" });
  });
  it("withdraws findings when the native manager role is revoked after its first read", async () => {
    await connection(); const real = recovery.readConnectorRecovery; let calls = 0;
    vi.spyOn(recovery, "readConnectorRecovery").mockImplementation(async (...args) => {
      const result = await real(...args);
      if (++calls === 1) await db.update(companyMemberships).set({ membershipRole: "viewer" }).where(and(
        eq(companyMemberships.companyId, fixture.home), eq(companyMemberships.principalId, fixture.userId)));
      return result;
    });
    const value = await experienceService(db).home(fixture.actor, fixture.home);
    expect(value.needsYou.filter(card => card.source.domain === "connection" && card.kind === "recovery")).toEqual([]);
    expect(value.dependencies.find(entry => entry.domain === "connector-recovery")).toMatchObject({ state: "partial", reason: "denied" });
  });
});
