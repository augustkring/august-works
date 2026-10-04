import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { agents, companyMemberships, agentExecutionManifests, heartbeatRuns, instanceSettings, issues, projects, toolApplications, toolConnections, connectionGrants, toolCatalogEntries, toolProfiles, toolProfileBindings, toolInvocations, principalPermissionGrants, createDb } from "@paperclipai/db";
import { PROVIDER_CAPABILITY_FEATURES } from "@paperclipai/shared";
import { startEmbeddedPostgresTestDatabase, getEmbeddedPostgresTestSupport } from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { agentProviderBindingService } from "../services/agent-provider-bindings.js";
import { agentRuntimeFabricService } from "../services/agent-runtime-fabric.js";
import { skillTaskMatches } from "../services/skill-resolver.js";
import { crossCompanyContextService } from "../services/cross-company-context.js";
import { createToolGatewayService } from "../services/tool-gateway.js";
import { scopedRuntimeActionService } from "../services/scoped-runtime-actions.js";
import { projectControlService } from "../services/project-control.js";
import { roadmapPolicySchema, crossCompanyPolicySchema } from "@paperclipai/shared";

it("negative triggers veto selection and empty trigger sets do not match every task", () => {
  expect(skillTaskMatches("review database migration", ["database"], [])).toBe(true);
  expect(skillTaskMatches("explain database without migration", ["database"], ["without migration"])).toBe(false);
  expect(skillTaskMatches("anything", [], [])).toBe(false);
  expect(skillTaskMatches("build the Linux service", ["ui", "ux"], [])).toBe(false);
  expect(skillTaskMatches("Build the UI: keyboard flow", ["ui"], [])).toBe(true);
  expect(skillTaskMatches("migration on PostgreSQL", ["migration"], ["sql"])).toBe(true);
  expect(skillTaskMatches("Review DATABASE   MIGRATION", ["database migration"], [])).toBe(true);
  expect(skillTaskMatches("Ret tilgængelighed i grænsefladen", ["tilgængelighed"], [])).toBe(true);
});
const support = await getEmbeddedPostgresTestSupport();
describe.skipIf(!support.supported)("V5 execution authority", () => {
  let db!: ReturnType<typeof createDb>, database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-v5-runtime-"); db = createDb(database.connectionString); await enableV5ForTest(db); const [settings] = await db.select().from(instanceSettings); await db.update(instanceSettings).set({ experimental: { ...settings!.experimental, role_packs_v5: false, skill_resolver_v5: false } }).where(eq(instanceSettings.singletonKey, "default")); });
  afterAll(async () => { await database?.cleanup(); });
  it("allows explicitly authorized guest act forecasts, denies read/contribute mutations and rechecks revoked humans", async () => {
    const f = await seedV5Presences(db), providers = agentProviderBindingService(db), fabric = agentRuntimeFabricService(db), cross = crossCompanyContextService(db), actions = scopedRuntimeActionService(db);
    const features = Object.fromEntries(PROVIDER_CAPABILITY_FEATURES.map((key) => [key, false])) as Record<(typeof PROVIDER_CAPABILITY_FEATURES)[number], boolean>;
    for (const [companyId, agentId] of [[f.home, f.presence.id], [f.guest, f.guestPresence.id]] as const) {
      const binding = await providers.create(f.actor, companyId, agentId, { providerType: "paperclip_native", providerAgentRef: agentId, providerEndpointRef: null, isolationMode: "isolated_per_presence" });
      await providers.attach(f.actor, companyId, agentId, { providerBindingId: binding.id, providerProfileRef: agentId });
      await providers.recordDiscovery(companyId, agentId, { provider: "paperclip_native", version: "internal-fixture", features, skills: [], tools: [], discoveredAt: new Date().toISOString() }, { connect: true, identity: true, start: true, stream: true, wait: true, cancel: true, memoryScoping: true });
    }
    await cross.setPolicy(f.actor, f.guest, crossCompanyPolicySchema.parse({ allowRead: true, allowContribute: true, allowAct: true }));
    const [project] = await db.insert(projects).values({ companyId: f.guest, name: "Guest delivery" }).returning();
    await projectControlService(db).policy(f.actor, f.guest, project!.id, roadmapPolicySchema.parse({ allowAgentForecast: true }));
    const [task] = await db.insert(issues).values({ companyId: f.guest, projectId: project!.id, title: "Guest task", assigneeAgentId: f.guestPresence.id }).returning();
    for (const accessMode of ["read", "contribute", "act"] as const) {
      const query = "Forecast the explicitly delegated guest delivery";
      const request = await fabric.requestScope(f.actor, f.home, f.presence.id, { executionScope: { primaryCompanyId: f.home, primaryAgentPresenceId: f.presence.id, delegatedScopes: [{ companyId: f.guest, agentPresenceId: f.guestPresence.id, accessMode, purpose: query }] }, query, issueId: null });
      const [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, responsibleUserId: f.userId, status: "running" }).returning();
      await fabric.prepare({ companyId: f.home, agentId: f.presence.id, runId: run!.id, responsibleUserId: f.userId, issueId: null, query, scopeRequestId: request.id });
      const actor = { type: "agent" as const, source: "agent_jwt" as const, companyId: f.home, agentId: f.presence.id, runId: run!.id, onBehalfOfUserId: f.userId };
      const command = { action: "task.forecast" as const, companyId: f.guest, projectId: project!.id, taskId: task!.id, forecast: { expectedUpdatedAt: task!.updatedAt.toISOString(), forecastStartAt: null, forecastEndAt: "2026-10-12T00:00:00Z", forecastConfidence: 0.5, forecastReason: "Current evidence supports a guest delivery estimate" } };
      if (accessMode !== "act") await expect(actions.execute(actor, f.home, run!.id, command)).rejects.toMatchObject({ status: 403 });
      else {
        await expect(actions.execute(actor, f.home, run!.id, command)).resolves.toMatchObject({ sourceCompanyId: f.guest, resultOwnerCompanyId: f.home, classification: "internal" });
        const [updated] = await db.select().from(issues).where(eq(issues.id, task!.id));
        expect(updated!.forecastEndAt?.toISOString()).toBe("2026-10-12T00:00:00.000Z"); expect(updated!.plannedEndAt).toBeNull();
        await db.delete(companyMemberships).where(and(eq(companyMemberships.companyId, f.guest), eq(companyMemberships.principalId, f.userId)));
        await expect(actions.execute(actor, f.home, run!.id, { ...command, forecast: { ...command.forecast, expectedUpdatedAt: updated!.updatedAt.toISOString() } })).rejects.toMatchObject({ status: 403 });
      }
    }
  });
  it("pins immutable provenance, rechecks resumed runs and rejects revoked human membership", async () => {
    const f = await seedV5Presences(db), providers = agentProviderBindingService(db), svc = agentRuntimeFabricService(db);
    const binding = await providers.create(f.actor, f.home, f.presence.id, { providerType: "paperclip_native", providerAgentRef: f.presence.id, providerEndpointRef: null, isolationMode: "isolated_per_presence" });
    await providers.attach(f.actor, f.home, f.presence.id, { providerBindingId: binding.id, providerProfileRef: f.presence.id });
    // This is an internal fixture contract, not proof of an external provider.
    await providers.recordDiscovery(f.home, f.presence.id, { provider: "paperclip_native", version: "test-only", features: Object.fromEntries(PROVIDER_CAPABILITY_FEATURES.map((key) => [key, false])) as Record<(typeof PROVIDER_CAPABILITY_FEATURES)[number], boolean>, skills: [], tools: [], discoveredAt: new Date().toISOString() }, { connect: true, identity: true, start: true, stream: true, wait: true, cancel: true, memoryScoping: true });
    const [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, responsibleUserId: f.userId, status: "running" }).returning();
    const input = { companyId: f.home, agentId: f.presence.id, runId: run!.id, responsibleUserId: f.userId, issueId: null, query: "Review the approved company context" };
    const first = await svc.prepare(input); expect(first?.manifest.agentIdentityId).toBe(f.identity.id);
    expect(first?.manifest.executionScope.delegatedScopes).toEqual([]);
    const resumed = await svc.prepare(input); expect(resumed?.record.id).toBe(first?.record.id);
    await expect(db.update(agentExecutionManifests).set({ hash: "rewrite" }).where(eq(agentExecutionManifests.id, first!.record.id))).rejects.toThrow();
    await db.delete(companyMemberships).where(and(eq(companyMemberships.companyId, f.home), eq(companyMemberships.principalId, f.userId)));
    await expect(svc.prepare(input)).rejects.toMatchObject({ status: 403 });
  });
  it("routes guest connected tools through current local authority and denies writes/revoked result disclosure", async () => {
    const f = await seedV5Presences(db), providers = agentProviderBindingService(db), fabric = agentRuntimeFabricService(db), cross = crossCompanyContextService(db);
    for (const [companyId, agentId] of [[f.home, f.presence.id], [f.guest, f.guestPresence.id]] as const) {
      const binding = await providers.create(f.actor, companyId, agentId, { providerType: "paperclip_native", providerAgentRef: agentId, providerEndpointRef: null, isolationMode: "isolated_per_presence" });
      await providers.attach(f.actor, companyId, agentId, { providerBindingId: binding.id, providerProfileRef: agentId });
      await providers.recordDiscovery(companyId, agentId, { provider: "paperclip_native", version: "internal-fixture", features: Object.fromEntries(PROVIDER_CAPABILITY_FEATURES.map(key => [key, false])) as Record<(typeof PROVIDER_CAPABILITY_FEATURES)[number], boolean>, skills: [], tools: [], discoveredAt: new Date().toISOString() }, { connect: true, identity: true, start: true, stream: true, wait: true, cancel: true, memoryScoping: true });
    }
    await cross.setPolicy(f.actor, f.guest, crossCompanyPolicySchema.parse({ allowRead: true, allowContribute: true, allowAct: true, allowedSensitivities: ["internal", "confidential"] }));
    await db.insert(companyMemberships).values({ companyId: f.guest, principalType: "agent", principalId: f.guestPresence.id, status: "active", membershipRole: "member" });
    await db.insert(principalPermissionGrants).values({ companyId: f.guest, principalType: "agent", principalId: f.guestPresence.id, permissionKey: "tools:use" });
    const [application] = await db.insert(toolApplications).values({ companyId: f.guest, applicationKey: randomUUID(), name: "Guest protocol fixture", type: "mcp_http", status: "active" }).returning();
    const [connection] = await db.insert(toolConnections).values({ companyId: f.guest, applicationId: application!.id, name: "Guest fixture", uid: `fixture/${randomUUID()}`, transport: "mcp_remote", status: "active", enabled: true, healthStatus: "ok", config: { url: "https://guest.example.test/mcp" }, transportConfig: { url: "https://guest.example.test/mcp" }, credentialRefs: [], credentialSecretRefs: [] }).returning();
    await db.insert(connectionGrants).values({ companyId: f.guest, connectionId: connection!.id, kind: "organization", status: "active", isDefault: true, credentialSecretRefs: [] });
    const [profile] = await db.insert(toolProfiles).values({ companyId: f.guest, profileKey: randomUUID(), name: "Guest fixture allowlist", defaultAction: "allow" }).returning();
    await db.insert(toolProfileBindings).values({ companyId: f.guest, profileId: profile!.id, targetType: "agent", targetId: f.guestPresence.id });
    const catalog = await db.insert(toolCatalogEntries).values((["read", "write"] as const).map(risk => ({ companyId: f.guest, applicationId: application!.id, connectionId: connection!.id, entryKind: "tool", name: `guest_${risk}`, toolName: `guest_${risk}`, title: `Guest ${risk}`, description: "Synthetic fixture only", inputSchema: { type: "object", additionalProperties: false }, annotations: { readOnlyHint: risk === "read" }, riskLevel: risk, isReadOnly: risk === "read", isWrite: risk === "write", isDestructive: false, status: "active", versionHash: randomUUID() }))).returning();
    let revokeDuringResponse = false;
    const remote = vi.fn(async (url, init) => {
      expect(String(url)).toBe("https://guest.example.test/mcp");
      if (revokeDuringResponse) await db.delete(companyMemberships).where(and(eq(companyMemberships.companyId, f.guest), eq(companyMemberships.principalId, f.userId)));
      const request = JSON.parse(String(init.body));
      return Response.json({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: "synthetic guest response" }] } });
    });
    const gateway = createToolGatewayService(db, { remoteHttpRequest: remote, toolActionSigningSecret: "synthetic-fixture-signing-key-only" }), actions = scopedRuntimeActionService(db, gateway);
    async function primary(accessMode: "read" | "act") {
      const query = "Use explicitly delegated guest tools";
      const request = await fabric.requestScope(f.actor, f.home, f.presence.id, { executionScope: { primaryCompanyId: f.home, primaryAgentPresenceId: f.presence.id, delegatedScopes: [{ companyId: f.guest, agentPresenceId: f.guestPresence.id, accessMode, purpose: query }] }, query, issueId: null });
      const [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, responsibleUserId: f.userId, status: "running" }).returning();
      await fabric.prepare({ companyId: f.home, agentId: f.presence.id, runId: run!.id, responsibleUserId: f.userId, issueId: null, query, scopeRequestId: request.id });
      return { run: run!, actor: { type: "agent" as const, source: "agent_jwt" as const, companyId: f.home, agentId: f.presence.id, runId: run!.id, onBehalfOfUserId: f.userId } };
    }
    const reader = await primary("read");
    const list = await actions.execute(reader.actor, f.home, reader.run.id, { action: "tool.list", companyId: f.guest }) as { result: { name: string; risk: string }[] };
    expect(list.result).toHaveLength(1); expect(list.result[0]!.risk).toBe("read");
    const readName = list.result[0]!.name;
    await expect(actions.execute(reader.actor, f.home, reader.run.id, { action: "tool.invoke", companyId: f.guest, tool: readName, parameters: {} })).resolves.toMatchObject({ sourceCompanyId: f.guest, resultOwnerCompanyId: f.home, classification: "confidential", crossCompanyUsePolicy: "allow" });
    const [invocation] = await db.select().from(toolInvocations).where(eq(toolInvocations.companyId, f.guest));
    expect(invocation).toMatchObject({ companyId: f.guest, agentId: f.guestPresence.id, runId: null });
    await expect(actions.execute(reader.actor, f.home, reader.run.id, { action: "tool.invoke", companyId: f.guest, tool: "search_tools", parameters: {} })).rejects.toMatchObject({ status: 404 });
    const writer = await primary("act"), available = await actions.execute(writer.actor, f.home, writer.run.id, { action: "tool.list", companyId: f.guest }) as typeof list;
    const writeName = available.result.find(tool => tool.risk === "write")!.name;
    await expect(actions.execute(reader.actor, f.home, reader.run.id, { action: "tool.invoke", companyId: f.guest, tool: writeName, parameters: {}, idempotencyKey: "read-scope-write" })).rejects.toMatchObject({ status: 403 });
    await expect(actions.execute(writer.actor, f.home, writer.run.id, { action: "tool.invoke", companyId: f.guest, tool: writeName, parameters: {} })).rejects.toMatchObject({ status: 422 });
    expect(remote).toHaveBeenCalledTimes(1);
    const command = { action: "tool.invoke" as const, companyId: f.guest, tool: writeName, parameters: {}, idempotencyKey: "guest-write-once" };
    const written = await actions.execute(writer.actor, f.home, writer.run.id, command) as { result: { result: unknown } };
    const replayed = await actions.execute(writer.actor, f.home, writer.run.id, command) as typeof written;
    expect(replayed.result.result).toEqual(written.result.result);
    expect(remote).toHaveBeenCalledTimes(2);
    revokeDuringResponse = true;
    await expect(actions.execute(writer.actor, f.home, writer.run.id, { action: "tool.invoke", companyId: f.guest, tool: readName, parameters: {} })).rejects.toMatchObject({ status: 403 });
    await db.insert(companyMemberships).values({ companyId: f.guest, principalType: "user", principalId: f.userId, status: "active", membershipRole: "owner" });
    revokeDuringResponse = false;
    // A failed result disclosure cannot be replayed as a completed operation.
    const failedCommand = { action: "tool.invoke" as const, companyId: f.guest, tool: readName, parameters: {}, idempotencyKey: "failed-disclosure" };
    revokeDuringResponse = true;
    await expect(actions.execute(writer.actor, f.home, writer.run.id, failedCommand)).rejects.toMatchObject({ status: 403 });
    await db.insert(companyMemberships).values({ companyId: f.guest, principalType: "user", principalId: f.userId, status: "active", membershipRole: "owner" });
    revokeDuringResponse = false;
    await expect(actions.execute(writer.actor, f.home, writer.run.id, failedCommand)).rejects.toMatchObject({ status: 409 });
    expect(remote).toHaveBeenCalledTimes(4); expect(catalog).toHaveLength(2);
  });

});
