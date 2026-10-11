import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activityLog, agentApiKeys, agentRetirements, agents, approvals, authUsers,
  closeRegisteredClients, companies, companyMemberships, companySecretBindings, companySecrets,
  connectionGrants, connectionTokenIssuances, createDb, heartbeatRuns, issues, principalPermissionGrants, routines, toolGatewaySessions,
  toolApplications, toolConnections, toolConnectionInstalls, toolInvocations, toolOauthStates,
} from "@paperclipai/db";
import type { AgentRetirementCommand } from "@paperclipai/shared";
import { agentRetirementService } from "../services/agents/retirement.js";
import { agentService } from "../services/agents.js";
import { agentIdentityService } from "../services/agent-identities.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { agentRetirementRoutes } from "../routes/agent-retirement.js";
import { errorHandler } from "../middleware/error-handler.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { subscribeCompanyLiveEvents } from "../services/live-events.js";

describe("V9 retirement on the original migrated Agent owner", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let f: Awaited<ReturnType<typeof seedV5Presences>>, owner: ReturnType<typeof agentRetirementService>;
  beforeAll(async () => {
    const support = await getEmbeddedPostgresTestSupport();
    expect(support.supported, "Retirement qualification requires actual migrated PostgreSQL; it cannot silently skip").toBe(true);
    database = await startEmbeddedPostgresTestDatabase("aw-v9-agent-retirement-"); db = createDb(database.connectionString);
    await instanceSettingsService(db).getExperimental(); await enableV5ForTest(db); owner = agentRetirementService(db);
  }, 60000);
  afterAll(async () => {
    if (database) { await closeRegisteredClients(database.connectionString); await database.cleanup(); }
  }, 30000);
  beforeEach(async () => {
    await instanceSettingsService(db).updateExperimental({ saas_deployment_profile_v6: true, billing_v6: true, agent_packages_v7: true, hire_agent_v9: true });
    f = await seedV5Presences(db);
    // The original shared-identity fixture has an active guest. Use the native
    // rehome owner explicitly so ordinary cases can retire only this presence
    // while preserving the other company's active presence and global identity.
    await agentIdentityService(db).rehome(f.actor, f.home, f.identity.id, f.guest);
    await db.update(agents).set({ status: "paused" }).where(eq(agents.id, f.presence.id));
  });
  async function command(): Promise<AgentRetirementCommand> {
    const current = await owner.get(f.actor, f.home, f.presence.id);
    return { requestId: randomUUID(), expectedSourceToken: current.sourceToken, confirmRetirement: true,
      pendingWorkPolicy: "require_settled", accessPolicy: "detach_agent_only", retentionPolicy: "existing_company_policy" };
  }
  const readAgent = async () => (await db.select().from(agents).where(eq(agents.id, f.presence.id)))[0]!;
  const receipts = async () => db.select().from(agentRetirements).where(eq(agentRetirements.companyId, f.home));
  const retirementAudits = async () => db.select().from(activityLog).where(and(eq(activityLog.companyId, f.home), eq(activityLog.action, "agent.retired")));

  it("requires the original identity owner to rehome a shared home presence and rejects stale review after that change", async () => {
    const ready = await command();
    await agentService(db).resume(f.presence.id);
    await agentIdentityService(db).rehome(f.actor, f.guest, f.identity.id, f.home);
    await agentService(db).pause(f.presence.id);
    const blocked = await owner.get(f.actor, f.home, f.presence.id);
    expect(blocked).toMatchObject({ state: "blocked", canRetire: false, blockers: ["identity_lifecycle"] });
    await expect(owner.retire(f.actor, f.home, f.presence.id, ready)).rejects.toMatchObject({ status: 409 });
    expect((await readAgent()).status).toBe("paused");
    expect((await agentService(db).getById(f.guestPresence.id))!.status).not.toBe("terminated");
    expect(await receipts()).toEqual([]);
    await agentIdentityService(db).rehome(f.actor, f.home, f.identity.id, f.guest);
    const current = await command();
    expect(current.expectedSourceToken).not.toBe(ready.expectedSourceToken);
    await expect(owner.retire(f.actor, f.home, f.presence.id, ready)).rejects.toMatchObject({ status: 409 });
    expect((await owner.retire(f.actor, f.home, f.presence.id, current)).state).toBe("retired");
  });

  it("atomically detaches only the reviewed agent's local access and preserves shared credentials, history and prior revocation times", async () => {
    const old = new Date("2020-01-01T00:00:00Z");
    const [activeKey, previousKey, otherKey] = await db.insert(agentApiKeys).values([
      { companyId: f.home, agentId: f.presence.id, name: "Current", keyHash: randomUUID() },
      { companyId: f.home, agentId: f.presence.id, name: "Previously revoked", keyHash: randomUUID(), revokedAt: old },
      { companyId: f.guest, agentId: f.guestPresence.id, name: "Other presence", keyHash: randomUUID() },
    ]).returning();
    await db.insert(principalPermissionGrants).values({ companyId: f.home, principalType: "agent", principalId: f.presence.id.toUpperCase(), permissionKey: "tools:use" });
    const [agentMembership] = await db.insert(companyMemberships).values({ companyId: f.home, principalType: "agent", principalId: f.presence.id,
      status: "active", membershipRole: "operator" }).returning();
    const [secret] = await db.insert(companySecrets).values({ companyId: f.home, key: randomUUID(), name: "Shared definition" }).returning();
    await db.insert(companySecretBindings).values([
      { companyId: f.home, secretId: secret!.id, targetType: "agent", targetId: f.presence.id.toUpperCase(), configPath: "env.KEY" },
      { companyId: f.home, secretId: secret!.id, targetType: "company", targetId: f.home, configPath: "env.SHARED" },
    ]);
    const [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, status: "succeeded", finishedAt: new Date() }).returning();
    const [session] = await db.insert(toolGatewaySessions).values({ companyId: f.home, agentId: f.presence.id, runId: run!.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now()+60000) }).returning();
    const [history] = await db.insert(issues).values({ companyId: f.home, title: "Completed original work", assigneeAgentId: f.presence.id, status: "done" }).returning();
    const beforeAgent = await readAgent(), beforeUserGrants = await db.select().from(principalPermissionGrants).where(eq(principalPermissionGrants.principalId, f.userId));
    const input = await command(), first = await owner.retire(f.actor, f.home, f.presence.id, input);
    expect(first).toMatchObject({ state: "retired", canRetire: false, alreadyStopped: true, blockers: [],
      affectedAccess: { apiKeys: 1, permissions: 2, agentPermissionSettings: 1, credentialBindings: 1, toolTokens: 1 } });
    expect(await readAgent()).toMatchObject({ status: "terminated", adapterConfig: beforeAgent.adapterConfig, runtimeConfig: beforeAgent.runtimeConfig, permissions: {} });
    const keys = await db.select().from(agentApiKeys).where(eq(agentApiKeys.companyId, f.home));
    expect(keys.find(key=>key.id===activeKey!.id)!.revokedAt).not.toBeNull(); expect(keys.find(key=>key.id===previousKey!.id)!.revokedAt).toEqual(old);
    expect((await db.select().from(agentApiKeys).where(eq(agentApiKeys.id, otherKey!.id)))[0]!.revokedAt).toBeNull();
    expect(await db.select().from(companySecrets).where(eq(companySecrets.id, secret!.id))).toEqual([secret]);
    expect(await db.select().from(companySecretBindings).where(eq(companySecretBindings.secretId, secret!.id))).toHaveLength(1);
    expect(await db.select().from(principalPermissionGrants).where(eq(principalPermissionGrants.principalId, f.userId))).toEqual(beforeUserGrants);
    expect((await db.select().from(companyMemberships).where(eq(companyMemberships.id, agentMembership!.id)))[0]!.status).toBe("inactive");
    expect((await db.select().from(toolGatewaySessions).where(eq(toolGatewaySessions.id, session!.id)))[0]!.revokedAt).not.toBeNull();
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run!.id))).toEqual([run]);
    expect(await db.select().from(issues).where(eq(issues.id, history!.id))).toEqual([history]);
    expect(await receipts()).toHaveLength(1); expect(await retirementAudits()).toHaveLength(1);
    expect(JSON.stringify(first)).not.toContain(f.userId); expect(JSON.stringify(first)).not.toContain(activeKey!.keyHash);
  });
  it("preserves the original sole-presence identity archival rule without affecting a shared identity", async () => {
    const solo = await agentIdentityService(db).create(f.actor, { name: "Solo", homeCompanyId: f.home });
    await agentService(db).pause(solo.presence.id);
    const current = await owner.get(f.actor, f.home, solo.presence.id);
    expect(current.canRetire).toBe(true);
    await owner.retire(f.actor, f.home, solo.presence.id, { ...await command(), expectedSourceToken: current.sourceToken });
    const result = await db.execute<{ status: string }>(sql`select status from agent_identities where id=${solo.identity.id}::uuid`);
    expect(result[0]!.status).toBe("archived");
    await expect(agentIdentityService(db).addPresence(f.actor, f.home, solo.identity.id, { companyId: f.guest, role: "general" }))
      .rejects.toMatchObject({ status: 409 });
    expect((await agentService(db).getById(f.guestPresence.id))!.status).not.toBe("terminated");
  });
  it("serializes concurrent requests and reads the one original receipt after an unknown acknowledgement", async () => {
    const input = await command();
    const [first, repeated] = await Promise.all([owner.retire(f.actor, f.home, f.presence.id, input), owner.retire(f.actor, f.home, f.presence.id, input)]);
    expect(first.retiredAt).toBe(repeated.retiredAt); expect(await receipts()).toHaveLength(1); expect(await retirementAudits()).toHaveLength(1);
    expect((await owner.get(f.actor, f.home, f.presence.id)).retiredAt).toBe(first.retiredAt);
    expect((await owner.retire(f.actor, f.home.toUpperCase(), f.presence.id.toUpperCase(), { ...input, requestId: input.requestId.toUpperCase() })).retiredAt).toBe(first.retiredAt);
    await expect(owner.retire(f.actor, f.home, f.presence.id, { ...input, requestId: randomUUID() })).rejects.toMatchObject({ status: 409 });
    await expect(owner.retire(f.actor, f.home, f.presence.id, { ...input, expectedSourceToken: "f".repeat(64) })).rejects.toMatchObject({ status: 409 });
    expect(await retirementAudits()).toHaveLength(1);
  });
  it("latches a real concurrent legacy key writer until retirement commits, then rejects its active binding", async () => {
    const input = await command(), competing = createDb(database.connectionString);
    let entered!: () => void, release!: () => void;
    const inside = new Promise<void>(resolve => { entered = resolve; }), commit = new Promise<void>(resolve => { release = resolve; });
    const transact = db.transaction.bind(db), gate = vi.spyOn(db, "transaction").mockImplementationOnce((callback, config) => transact(async tx => {
      const result = await callback(tx); entered(); await commit; return result;
    }, config));
    const retirement = owner.retire(f.actor, f.home, f.presence.id, input);
    let writerPid: number | undefined;
    try {
      await inside;
      const writer = competing.transaction(async tx => {
        await tx.execute(sql`select set_config('statement_timeout','5000',true), set_config('lock_timeout','1000',true)`);
        const [process] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`); writerPid = process!.pid;
        await tx.insert(agentApiKeys).values({ companyId: f.home, agentId: f.presence.id, name: "Concurrent legacy key", keyHash: randomUUID() });
      }).then(() => ({ succeeded: true, error: null }), error => ({ succeeded: false, error }));
      await vi.waitFor(async () => {
        expect(writerPid).toBeDefined();
        const [lock] = await db.execute<{ waiting: boolean }>(sql`select exists(select 1 from pg_locks where pid=${writerPid!} and not granted) as waiting`);
        expect(lock!.waiting).toBe(true);
      }, { timeout: 900, interval: 10 });
      release(); expect((await retirement).state).toBe("retired");
      expect(await writer).toMatchObject({ succeeded: false, error: { cause: { message: "AW_V9_AGENT_RETIRED" } } });
      expect(await db.select().from(agentApiKeys).where(and(eq(agentApiKeys.agentId, f.presence.id), isNull(agentApiKeys.revokedAt)))).toEqual([]);
      expect(await receipts()).toHaveLength(1);
    } finally { release(); gate.mockRestore(); await retirement; }
  });
  it("requires a renewed review if the native agent or reviewed bindings change", async () => {
    const first = await command(); await agentService(db).update(f.presence.id, { title: "Changed original configuration" });
    await expect(owner.retire(f.actor, f.home, f.presence.id, first)).rejects.toMatchObject({ status: 409 });
    const second = await command(); await db.insert(agentApiKeys).values({ companyId: f.home, agentId: f.presence.id, name: "New access", keyHash: randomUUID() });
    await expect(owner.retire(f.actor, f.home, f.presence.id, second)).rejects.toMatchObject({ status: 409 });
    expect((await readAgent()).status).toBe("paused"); expect(await receipts()).toEqual([]); expect(await retirementAudits()).toEqual([]);
  });
  it("requires explicit reconciliation of a legacy stopped agent and preserves earlier key revocation", async () => {
    const [key] = await db.insert(agentApiKeys).values({ companyId: f.home, agentId: f.presence.id, name: "Legacy access", keyHash: randomUUID() }).returning();
    await agentService(db).terminate(f.presence.id); const [revoked] = await db.select().from(agentApiKeys).where(eq(agentApiKeys.id, key!.id));
    expect(await owner.get(f.actor, f.home, f.presence.id)).toMatchObject({ state: "ready", alreadyStopped: true, retiredAt: null });
    expect(await receipts()).toEqual([]); await owner.retire(f.actor, f.home, f.presence.id, await command());
    expect((await db.select().from(agentApiKeys).where(eq(agentApiKeys.id, key!.id)))[0]!.revokedAt).toEqual(revoked!.revokedAt);
  });
  it.each(["users:manage_permissions", "tools:admin"] as const)("does not infer missing %s cleanup authority from configure or instance admin", async permission => {
    const input = await command();
    await db.update(companyMemberships).set({ membershipRole: "operator" }).where(and(eq(companyMemberships.companyId, f.home), eq(companyMemberships.principalId, f.userId)));
    await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, f.home), eq(principalPermissionGrants.principalId, f.userId), eq(principalPermissionGrants.permissionKey, permission)));
    await expect(owner.get({ ...f.actor, isInstanceAdmin: true }, f.home, f.presence.id)).rejects.toMatchObject({ status: 403 });
    await expect(owner.retire({ ...f.actor, isInstanceAdmin: true }, f.home, f.presence.id, input)).rejects.toMatchObject({ status: 403 });
    expect(await receipts()).toEqual([]); expect((await readAgent()).status).toBe("paused");
  });
  it("checks current verified membership and rejects local implicit, foreign company and role withdrawal", async () => {
    const input = await command();
    await expect(owner.get({ ...f.actor, source: "local_implicit" }, f.home, f.presence.id)).rejects.toMatchObject({ status: 403 });
    await expect(owner.get(f.actor, f.guest, f.presence.id)).rejects.toMatchObject({ status: 404 });
    await db.update(authUsers).set({ emailVerified: false }).where(eq(authUsers.id, f.userId));
    await expect(owner.retire(f.actor, f.home, f.presence.id, input)).rejects.toMatchObject({ status: 403 });
    await db.update(authUsers).set({ emailVerified: true }).where(eq(authUsers.id, f.userId));
    await db.update(companyMemberships).set({ status: "inactive" }).where(and(eq(companyMemberships.companyId, f.home), eq(companyMemberships.principalId, f.userId)));
    await expect(owner.retire(f.actor, f.home, f.presence.id, input)).rejects.toMatchObject({ status: 403 }); expect(await receipts()).toEqual([]);
  });
  it.each(["issue", "run", "approval", "routine", "report"] as const)("blocks unsettled original %s ownership without deleting or cancelling it", async kind => {
    if (kind === "issue") await db.insert(issues).values({ companyId: f.home, title: "Outstanding work", assigneeAgentId: f.presence.id, status: "todo" });
    if (kind === "run") await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, status: "queued" });
    if (kind === "approval") await db.insert(approvals).values({ companyId: f.home, type: "hire_agent", payload: { agentId: f.presence.id.toUpperCase() } });
    if (kind === "routine") await db.insert(routines).values({ companyId: f.home, title: "Original routine", workflowExecutionPrincipal: { type: "agent", agentId: f.presence.id.toUpperCase() } });
    if (kind === "report") await agentService(db).create(f.home, { name: "Dependent agent", reportsTo: f.presence.id, status: "paused", adapterType: "openclaw_gateway", adapterConfig: {} });
    const input = await command(), expected = kind === "routine" ? "automation_connected" : kind === "report" ? "reports_pending" : "work_pending";
    expect((await owner.get(f.actor, f.home, f.presence.id)).blockers).toContain(expected);
    await expect(owner.retire(f.actor, f.home, f.presence.id, input)).rejects.toMatchObject({ status: 409 });
    expect((await readAgent()).status).toBe("paused"); expect(await receipts()).toEqual([]); expect(await retirementAudits()).toEqual([]);
  });
  it("blocks oversized access inspection instead of reporting zero or partially revoking access", async () => {
    await db.insert(agentApiKeys).values(Array.from({ length: 257 }, (_, index) => ({ companyId: f.home, agentId: f.presence.id, name: `Access ${index}`, keyHash: randomUUID() })));
    const current = await owner.get(f.actor, f.home, f.presence.id); expect(current).toMatchObject({ affectedAccess: null, canRetire: false, blockers: ["source_limit"] });
    await expect(owner.retire(f.actor, f.home, f.presence.id, await command())).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(agentApiKeys).where(and(eq(agentApiKeys.agentId, f.presence.id), isNull(agentApiKeys.revokedAt)))).toHaveLength(257);
  });
  it("protects running and built-in agents", async () => {
    await db.update(agents).set({ status: "idle" }).where(eq(agents.id, f.presence.id));
    expect((await owner.get(f.actor, f.home, f.presence.id)).blockers).toContain("pause_required");
    await db.update(agents).set({ status: "paused", metadata: { paperclipBuiltInAgent: { key: "original-core", featureKeys: ["core_stewards_v7"] } } }).where(eq(agents.id, f.presence.id));
    expect((await owner.get(f.actor, f.home, f.presence.id)).blockers).toContain("protected_agent");
    await expect(owner.retire(f.actor, f.home, f.presence.id, await command())).rejects.toMatchObject({ status: 409 });
  });
  it("rolls back all Native effects before commit and permits the original request to be explicitly retried", async () => {
    await db.insert(agentApiKeys).values({ companyId: f.home, agentId: f.presence.id, name: "Rollback access", keyHash: randomUUID() });
    const input = await command(), beforeAgent = await readAgent(), beforeKeys = await db.select().from(agentApiKeys).where(eq(agentApiKeys.agentId, f.presence.id));
    const events: string[] = [], unsubscribe = subscribeCompanyLiveEvents(f.home, event => { if (event.type === "activity.logged") events.push(event.type); });
    const transact = db.transaction.bind(db), fault = vi.spyOn(db, "transaction").mockImplementationOnce((callback, config) => transact(async tx => {
      await callback(tx); throw new Error("Owned retirement fixture failure before Native commit");
    }, config));
    try { await expect(owner.retire(f.actor, f.home, f.presence.id, input)).rejects.toThrow("Owned retirement fixture failure before Native commit"); }
    finally { fault.mockRestore(); unsubscribe(); }
    expect(await readAgent()).toEqual(beforeAgent); expect(await db.select().from(agentApiKeys).where(eq(agentApiKeys.agentId, f.presence.id))).toEqual(beforeKeys);
    expect(await receipts()).toEqual([]); expect(await retirementAudits()).toEqual([]); expect(events).toEqual([]);
    expect((await owner.retire(f.actor, f.home, f.presence.id, input)).state).toBe("retired"); expect(await retirementAudits()).toHaveLength(1);
  });
  async function connection() {
    const [application] = await db.insert(toolApplications).values({ companyId: f.home, name: "Owned connection fixture", type: "mcp_http", applicationKey: `retire-${randomUUID()}` }).returning();
    const [connected] = await db.insert(toolConnections).values({ companyId: f.home, applicationId: application!.id,
      name: "Original shared connection", uid: randomUUID(), transport: "rest_api", authKind: "none" }).returning();
    return connected!;
  }
  it("requires the original OAuth owner to settle an outstanding attempt and fences late initiation", async () => {
    const connected = await connection(), state = randomUUID();
    const [pending] = await db.insert(toolOauthStates).values({ state, companyId: f.home, connectionId: connected.id,
      codeVerifier: "owned-software-oauth-fixture", subjectAgentId: f.presence.id, expiresAt: new Date(Date.now()+60000) }).returning();
    expect((await owner.get(f.actor, f.home, f.presence.id)).blockers).toContain("disconnect_required");
    await expect(owner.retire(f.actor, f.home, f.presence.id, await command())).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(toolOauthStates).where(eq(toolOauthStates.state, state))).toEqual([pending]);
    await db.update(toolOauthStates).set({ expiresAt: new Date("2020-01-01T00:00:00Z") }).where(eq(toolOauthStates.state, state));
    await owner.retire(f.actor, f.home, f.presence.id, await command());
    await expect(db.insert(toolOauthStates).values({ state: randomUUID(), companyId: f.home, connectionId: connected.id,
      codeVerifier: "owned-late-fixture", subjectAgentId: f.presence.id, expiresAt: new Date(Date.now()+60000) }))
      .rejects.toMatchObject({ cause: { message: "AW_V9_AGENT_RETIRED" } });
  });
  it.each(["active", "expired", "needs_reauthorization"] as const)("keeps original %s provider grants with their original owner instead of declaring them revoked", async status => {
    const connected = await connection();
    const [grant] = await db.insert(connectionGrants).values({ companyId: f.home, connectionId: connected.id, kind: "agent", subjectAgentId: f.presence.id, status }).returning();
    expect((await owner.get(f.actor, f.home, f.presence.id)).blockers).toContain("disconnect_required");
    await expect(owner.retire(f.actor, f.home, f.presence.id, await command())).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(connectionGrants).where(eq(connectionGrants.id, grant!.id))).toEqual([grant]);
  });
  it.each(["success", "upstream_error", "failure"] as const)("requires credential-owner reconciliation for unexpired or ambiguous %s issuance", async outcome => {
    const connected = await connection();
    const [issuance] = await db.insert(connectionTokenIssuances).values({ companyId: f.home, connectionId: connected.id, agentId: f.presence.id,
      path: "exchange", outcome, expiresAt: null }).returning();
    expect((await owner.get(f.actor, f.home, f.presence.id)).blockers).toContain("disconnect_required");
    await expect(owner.retire(f.actor, f.home, f.presence.id, await command())).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(connectionTokenIssuances).where(eq(connectionTokenIssuances.id, issuance!.id))).toEqual([issuance]);
  });
  it("removes only the local Agent app link after original credentials have settled, preserving the shared connection and historical issuance", async () => {
    const connected = await connection();
    const [issuance] = await db.insert(connectionTokenIssuances).values({ companyId: f.home, connectionId: connected.id, agentId: f.presence.id,
      path: "exchange", outcome: "success", expiresAt: new Date("2020-01-01T00:00:00Z") }).returning();
    await db.insert(toolConnectionInstalls).values({ companyId: f.home, connectionId: connected.id, targetType: "agent", targetId: f.presence.id.toUpperCase() });
    const retired = await owner.retire(f.actor, f.home, f.presence.id, await command()); expect(retired.affectedAccess!.connectedApps).toBe(1);
    expect(await db.select().from(toolConnections).where(eq(toolConnections.id, connected.id))).toEqual([connected]);
    expect(await db.select().from(connectionTokenIssuances).where(eq(connectionTokenIssuances.id, issuance!.id))).toEqual([issuance]);
    await expect(db.insert(toolConnectionInstalls).values({ companyId: f.home, connectionId: connected.id, targetType: "agent", targetId: f.presence.id.toUpperCase() }))
      .rejects.toMatchObject({ cause: { message: "AW_V9_AGENT_RETIRED" } });
  });
  it.each(["executing", "failed", "timed_out"] as const)("blocks original %s tool effects instead of cancelling or forgetting ambiguous external work", async status => {
    const [invocation] = await db.insert(toolInvocations).values({ companyId: f.home, agentId: f.presence.id, status,
      toolName: "fixture.unknown-effect" }).returning();
    expect((await owner.get(f.actor, f.home, f.presence.id)).blockers).toContain("work_pending");
    await expect(owner.retire(f.actor, f.home, f.presence.id, await command())).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(toolInvocations).where(eq(toolInvocations.id, invocation!.id))).toEqual([invocation]);
  });
  it("keeps recorded retirement readable through admission rollback and fences legacy resume, new keys, new work and late approval", async () => {
    const input = await command(); await owner.retire(f.actor, f.home, f.presence.id, input);
    await instanceSettingsService(db).updateExperimental({ hire_agent_v9: false });
    expect((await owner.get(f.actor, f.home, f.presence.id)).state).toBe("retired");
    expect((await owner.retire(f.actor, f.home, f.presence.id, input)).state).toBe("retired");
    await expect(agentService(db).update(f.presence.id, { status: "idle" })).rejects.toMatchObject({ status: 409, message: "Terminated agents cannot be resumed" });
    await expect(db.update(agents).set({ status: "idle" }).where(eq(agents.id, f.presence.id)))
      .rejects.toMatchObject({ cause: { message: "AW_V9_AGENT_RETIRED" } });
    await expect(db.update(agents).set({ permissions: { canCreateAgents: true } }).where(eq(agents.id, f.presence.id))).rejects.toMatchObject({ cause: { message: "AW_V9_AGENT_RETIRED" } });
    await expect(db.insert(agentApiKeys).values({ companyId: f.home, agentId: f.presence.id, name: "Late access", keyHash: randomUUID() })).rejects.toMatchObject({ cause: { message: "AW_V9_AGENT_RETIRED" } });
    await expect(db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, status: "queued" })).rejects.toMatchObject({ cause: { message: "AW_V9_AGENT_RETIRED" } });
    await expect(db.insert(issues).values({ companyId: f.home, assigneeAgentId: f.presence.id, title: "Late work" })).rejects.toMatchObject({ cause: { message: "AW_V9_AGENT_RETIRED" } });
    await expect(db.insert(approvals).values({ companyId: f.home, type: "hire_agent", payload: { agentId: f.presence.id.toUpperCase() } })).rejects.toMatchObject({ cause: { message: "AW_V9_AGENT_RETIRED" } });
    await expect(db.insert(routines).values({ companyId: f.home, title: "Late routine", assigneeAgentId: f.presence.id })).rejects.toMatchObject({ cause: { message: "AW_V9_AGENT_RETIRED" } });
    await expect(db.insert(companyMemberships).values({ companyId: f.home, principalType: "agent", principalId: f.presence.id, status: "active", membershipRole: "operator" }))
      .rejects.toMatchObject({ cause: { message: "AW_V9_AGENT_RETIRED" } });
    await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, status: "succeeded" });
    await db.insert(issues).values({ companyId: f.home, assigneeAgentId: f.presence.id, title: "Historical work", status: "done" });
    await expect(db.delete(agentRetirements).where(eq(agentRetirements.agentId, f.presence.id))).rejects.toMatchObject({ cause: { message: "AW_V9_AGENT_RETIREMENT_IMMUTABLE" } });
    await expect(db.update(agentRetirements).set({ retiredAt: new Date() }).where(eq(agentRetirements.agentId, f.presence.id))).rejects.toMatchObject({ cause: { message: "AW_V9_AGENT_RETIREMENT_IMMUTABLE" } });
    expect(await receipts()).toHaveLength(1); expect(await retirementAudits()).toHaveLength(1);
  });
  it("requires the original owner for receipts and rejects cross-company binding of the original Agent", async () => {
    const input = await command();
    await expect(db.insert(agentRetirements).values({ companyId: f.home, agentId: f.presence.id, requestId: input.requestId, requestHash: "a".repeat(64),
      sourceToken: input.expectedSourceToken, policyVersion: "aw.agent-retirement.v1", detachedAccess: { apiKeys: 0, permissions: 0, agentPermissionSettings: 0, connectedApps: 0, credentialBindings: 0, runtimeBindings: 0, toolTokens: 0, toolProfiles: 0 } }))
      .rejects.toMatchObject({ cause: { message: "AW_V9_AGENT_RETIREMENT_OWNER_REQUIRED" } });
    await expect(db.transaction(async tx => {
      await tx.execute(sql`select set_config('aw_v9.agent_retirement_intent', ${`${f.guest}:${f.presence.id}:${input.requestId}`}, true)`);
      await tx.insert(agentRetirements).values({ companyId: f.guest, agentId: f.presence.id, requestId: input.requestId, requestHash: "a".repeat(64),
        sourceToken: input.expectedSourceToken, policyVersion: "aw.agent-retirement.v1", detachedAccess: { apiKeys: 0, permissions: 0, agentPermissionSettings: 0, connectedApps: 0, credentialBindings: 0, runtimeBindings: 0, toolTokens: 0, toolProfiles: 0 } });
    })).rejects.toMatchObject({ cause: { code: "23514" } });
    expect(await receipts()).toEqual([]);
  });
  it("keeps receipt deletion under the original Agent erasure owner and preserves the other company presence", async () => {
    await owner.retire(f.actor, f.home, f.presence.id, await command());
    expect(await receipts()).toHaveLength(1);
    const other = await agentService(db).getById(f.guestPresence.id);
    await agentService(db).remove(f.presence.id);
    expect(await receipts()).toEqual([]); expect(await agentService(db).getById(f.presence.id)).toBeNull();
    expect(await agentService(db).getById(f.guestPresence.id)).toEqual(other);
    expect(await retirementAudits()).toHaveLength(1); // The original Activity owner retains its own audit.
  });
  it("sets no-store before route denial and validates current account and strict review without changing the Native Agent", async () => {
    const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.actor = f.actor; next(); }); app.use("/api", agentRetirementRoutes(db)); app.use(errorHandler);
    const route = `/api/companies/${f.home}/agents/${f.presence.id}/retirement`, input = await command();
    const current = await request(app).get(`${route}?expectedUserId=${encodeURIComponent(f.userId)}`); expect(current.status).toBe(200); expect(current.headers["cache-control"]).toBe("private, no-store");
    for (const method of ["get", "post"] as const) {
      const denied = await request(app)[method](`${route}?expectedUserId=another-account`).send(method === "post" ? input : undefined);
      expect(denied.status).toBe(409); expect(denied.headers["cache-control"]).toBe("private, no-store");
    }
    const rejected = await request(app).post(`${route}?expectedUserId=${encodeURIComponent(f.userId)}`).send({ ...input, confirmRetirement: false });
    expect(rejected.status).toBe(400); expect(rejected.headers["cache-control"]).toBe("private, no-store");
    expect((await readAgent()).status).toBe("paused"); expect(await receipts()).toEqual([]);
  });
});
