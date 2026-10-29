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
import { toolAccessService } from "../services/tool-access.js";
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
  it("projects a shared grant reauthorization as one safe manager recovery action and withdraws it after repair", async () => {
    const row = await connection(fixture.home, { healthStatus: "ok", authKind: "oauth", config: { private: "PRIVATE-CONFIGURATION", oauth: { expiresAt: "2000-01-01T00:00:00.000Z" } } });
    const [grant] = await db.insert(connectionGrants).values({ companyId: fixture.home, connectionId: row.id,
      kind: "organization", status: "needs_reauthorization", providerTenant: { oauth: { scopes: ["read:data"], accessTokenExpiresAt: "2000-01-01T00:00:00.000Z" } } }).returning();
    const beforeConnection = await db.select().from(toolConnections).where(eq(toolConnections.id, row.id));
    const beforeGrant = await db.select().from(connectionGrants).where(eq(connectionGrants.id, grant!.id));
    const finding = await read();
    expect(finding.needsYou.filter(card => card.source.resourceId === row.id)).toHaveLength(1);
    expect(finding.needsYou.find(card => card.source.resourceId === row.id)?.evidence).toEqual(["connector_access_review"]);
    expect(JSON.stringify(finding)).not.toContain("PRIVATE-");
    expect(await db.select().from(toolConnections).where(eq(toolConnections.id, row.id))).toEqual(beforeConnection);
    expect(await db.select().from(connectionGrants).where(eq(connectionGrants.id, grant!.id))).toEqual(beforeGrant);
    await db.update(connectionGrants).set({ status: "active", updatedAt: new Date() }).where(eq(connectionGrants.id, grant!.id));
    expect((await read()).needsYou.some(card => card.source.resourceId === row.id)).toBe(false);
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
    const row = await connection(fixture.home, { healthStatus: "ok", healthCheckedAt: new Date(), credentialPolicy: "per_user", config: { sourceTemplateKey: "github" } });
    await db.insert(connectionGrants).values({ companyId: fixture.home, connectionId: row.id, kind: "user", subjectUserId: "other-native-user", status: "active" });
    expect((await read()).needsYou[0]?.evidence).toEqual(["connector_access_review"]);
    await db.insert(connectionGrants).values({ companyId: fixture.home, connectionId: row.id, kind: "user", subjectUserId: fixture.userId, status: "active",
      providerTenant: { github: { userId: "123", login: "current-user", installationCount: 1, repositoryCount: 1,
        repositorySelection: "selected", installationIds: ["456"], installationOwnerLogins: ["octo"],
        repositories: [{ id: "789", fullName: "octo/project", installationId: "456" }], accessRevision: "verified-version",
        lastAccessRefreshAt: new Date().toISOString(), webhookHealth: "healthy" } } });
    expect((await read()).needsYou).toEqual([]);
  });
  it("projects the current personal grant's active refresh expiry and withdraws it after repair", async () => {
    await ordinaryMember();
    const own = await connection(fixture.home, { healthStatus: "ok", healthCheckedAt: new Date(), credentialPolicy: "per_user", authKind: "oauth",
      createdByUserId: fixture.userId, config: { sourceTemplateKey: "slack" } });
    const [grant] = await db.insert(connectionGrants).values({ companyId: fixture.home, connectionId: own.id,
      kind: "user", subjectUserId: fixture.userId, status: "active",
      providerTenant: { oauth: { scopes: ["read:data"], refreshTokenExpiresAt: "2000-01-01T00:00:00.000Z" } },
      credentialSecretRefs: [{ secretId: "PRIVATE-SECRET-REFERENCE", configPath: "oauth.refreshToken" }] }).returning();
    const other = await connection(fixture.home, { healthStatus: "ok", healthCheckedAt: new Date(), credentialPolicy: "per_user", authKind: "oauth",
      createdByUserId: "other-native-user", config: { sourceTemplateKey: "slack" } });
    await db.insert(connectionGrants).values({ companyId: fixture.home, connectionId: other.id,
      kind: "user", subjectUserId: fixture.userId, status: "active",
      providerTenant: { oauth: { refreshTokenExpiresAt: "2000-01-01T00:00:00.000Z" } } });

    const identity = await toolAccessService(db).personalReconnectIdentity(fixture.home, own.id, fixture.userId);
    expect(identity?.grant?.lifecycle).toMatchObject({
      state: "REQUIRES_REAUTH", reason: "refresh_credential_expired", action: "reauthorize",
      refreshCredentialFreshness: "expired",
    });
    expect(JSON.stringify(identity)).not.toContain("PRIVATE-SECRET-REFERENCE");
    const current = await read();
    expect(current.needsYou.map(card => card.source.resourceId)).toEqual([own.id]);
    expect(JSON.stringify(current)).not.toContain("other-native-user");

    await db.update(connectionGrants).set({ providerTenant: { oauth: { scopes: ["read:data"],
      refreshTokenExpiresAt: "2099-01-01T00:00:00.000Z" } }, updatedAt: new Date() }).where(eq(connectionGrants.id, grant!.id));
    expect((await read()).needsYou).toEqual([]);
  });
  it("projects the current personal grant's GitHub access invalidation until the verified repository snapshot returns", async () => {
    const row = await connection(fixture.home, { healthStatus: "ok", healthCheckedAt: new Date(), credentialPolicy: "per_user", createdByUserId: fixture.userId,
      config: { sourceTemplateKey: "github" } });
    const [grant] = await db.insert(connectionGrants).values({ companyId: fixture.home, connectionId: row.id,
      kind: "user", subjectUserId: fixture.userId, status: "active",
      providerTenant: { github: { userId: "123", login: "octocat", installationCount: 1, repositoryCount: 1,
        repositorySelection: "selected", installationIds: ["456"], installationOwnerLogins: ["octo"],
        accessRevision: "invalidated-version", lastAccessRefreshAt: new Date().toISOString(), webhookHealth: "healthy" } } }).returning();
    expect((await toolAccessService(db).personalReconnectIdentity(fixture.home, row.id, fixture.userId))?.grant?.lifecycle).toMatchObject({
      state: "PERMISSION_CHANGED", action: "refresh_access", accessVersion: "invalidated-version",
      syncReconciliation: {
        state: "required", mode: "github_repository_full_snapshot", accessRevision: "invalidated-version",
        accessRevisionKind: "local_access_revision", lastFullReconciledAt: null, gapDetection: "not_reported",
      },
    });
    const value = await read();
    expect(value.needsYou.filter(card => card.source.resourceId === row.id)).toHaveLength(1);
    expect(value.needsYou.find(card => card.source.resourceId === row.id)?.evidence).toEqual(["connector_access_review"]);
    expect(JSON.stringify(value)).not.toContain("octocat");
    await db.update(connectionGrants).set({ providerTenant: { github: { userId: "123", login: "octocat", installationCount: 1,
      repositoryCount: 1, repositorySelection: "selected", installationIds: ["456"], installationOwnerLogins: ["octo"],
      repositories: [{ id: "789", fullName: "octo/project", installationId: "456" }], accessRevision: "verified-version",
      lastAccessRefreshAt: new Date().toISOString(), webhookHealth: "healthy" } }, updatedAt: new Date() })
      .where(eq(connectionGrants.id, grant!.id));
    expect((await toolAccessService(db).personalReconnectIdentity(fixture.home, row.id, fixture.userId))?.grant?.lifecycle)
      .toMatchObject({ syncReconciliation: { state: "not_reported", mode: "github_repository_full_snapshot",
        accessRevision: "verified-version", accessRevisionKind: "local_access_revision", gapDetection: "not_reported" } });
    expect((await read()).needsYou.some(card => card.source.resourceId === row.id)).toBe(false);
  });
  it("uses the Original manager role/grant policy and denies viewer/admin bypass", async () => {
    await connection();
    await db.update(companyMemberships).set({ membershipRole: "member" }).where(and(eq(companyMemberships.companyId, fixture.home), eq(companyMemberships.principalId, fixture.userId)));
    await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, fixture.home),
      eq(principalPermissionGrants.principalId, fixture.userId), eq(principalPermissionGrants.permissionKey, "tools:manage_connections")));
    expect((await read()).needsYou).toEqual([]);
    expect((await readConnectorRecovery(db, { ...fixture.actor, isInstanceAdmin: true }, fixture.home, new AbortController().signal)).needsYou).toEqual([]);
    await db.insert(principalPermissionGrants).values({ companyId: fixture.home, principalType: "user", principalId: fixture.userId,
      permissionKey: "tools:manage_connections", scope: null });
    expect((await read()).needsYou).toHaveLength(1);
    await db.update(companyMemberships).set({ membershipRole: "viewer" }).where(and(eq(companyMemberships.companyId, fixture.home), eq(companyMemberships.principalId, fixture.userId)));
    await expect(read()).rejects.toMatchObject({ status: 403 });
  });
  async function ordinaryMember() {
    await db.update(companyMemberships).set({ membershipRole: "member" }).where(and(eq(companyMemberships.companyId, fixture.home), eq(companyMemberships.principalId, fixture.userId)));
    await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, fixture.home),
      eq(principalPermissionGrants.principalId, fixture.userId), eq(principalPermissionGrants.permissionKey, "tools:manage_connections")));
  }
  it("lets a regular member review only their own fixed personal identity without gaining management authority", async () => {
    await ordinaryMember();
    const own = await connection(fixture.home, { credentialPolicy: "per_user", createdByUserId: fixture.userId,
      connectionPurpose: "ai", transport: "runtime_auth", authKind: "api_key", healthStatus: "ok" });
    await db.insert(connectionGrants).values({ companyId: fixture.home, connectionId: own.id, kind: "user", subjectUserId: fixture.userId, status: "revoked", revokedAt: new Date() });
    await connection(fixture.home, { credentialPolicy: "per_user", createdByUserId: "other-native-user" });
    await connection();
    const before = await db.select().from(connectionGrants).where(eq(connectionGrants.companyId, fixture.home));
    const permissions = await db.select().from(principalPermissionGrants).where(eq(principalPermissionGrants.companyId, fixture.home));
    const value = await read(); expect(value.needsYou.map(card => card.source.resourceId)).toEqual([own.id]);
    expect(value.needsYou[0]?.evidence).toEqual(["connector_personal_access_review"]);
    expect(JSON.stringify(value)).not.toContain("other-native-user");
    expect(await db.select().from(connectionGrants).where(eq(connectionGrants.companyId, fixture.home))).toEqual(before);
    expect(await db.select().from(principalPermissionGrants).where(eq(principalPermissionGrants.companyId, fixture.home))).toEqual(permissions);
  });
  it("uses the Original fixed subject when a creator-less historical personal connection has retained grants", async () => {
    await ordinaryMember();
    const own = await connection(fixture.home, { credentialPolicy: "per_user" });
    await db.insert(connectionGrants).values({ companyId: fixture.home, connectionId: own.id, kind: "user", subjectUserId: fixture.userId, status: "needs_reauthorization" });
    expect((await read()).needsYou.map(card => card.source.resourceId)).toEqual([own.id]);
    const other = await connection(fixture.home, { credentialPolicy: "per_user", createdByUserId: "other-native-user" });
    await db.insert(connectionGrants).values({ companyId: fixture.home, connectionId: other.id, kind: "user", subjectUserId: fixture.userId, status: "revoked", revokedAt: new Date() });
    expect((await read()).needsYou.map(card => card.source.resourceId)).toEqual([own.id]);
  });
  it("withdraws a personal recovery finding when its actual retained grant is restored", async () => {
    await ordinaryMember();
    const own = await connection(fixture.home, { credentialPolicy: "per_user", createdByUserId: fixture.userId,
      connectionPurpose: "ai", transport: "runtime_auth", authKind: "api_key", healthStatus: "ok" });
    const [grant] = await db.insert(connectionGrants).values({ companyId: fixture.home, connectionId: own.id,
      kind: "user", subjectUserId: fixture.userId, status: "expired" }).returning();
    const real = recovery.readConnectorRecovery; let calls = 0;
    vi.spyOn(recovery, "readConnectorRecovery").mockImplementation(async (...args) => {
      const result = await real(...args);
      if (++calls === 1) await db.update(connectionGrants).set({ status: "active", updatedAt: new Date() }).where(eq(connectionGrants.id, grant!.id));
      return result;
    });
    const value = await experienceService(db).home(fixture.actor, fixture.home);
    expect(value.needsYou.filter(card => card.source.domain === "connection" && card.kind === "recovery")).toEqual([]);
    expect(value.dependencies.find(entry => entry.domain === "connector-recovery")).toMatchObject({ state: "partial", reason: "source_stale" });
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
