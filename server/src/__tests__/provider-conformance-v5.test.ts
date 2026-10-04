import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { agents, heartbeatRuns, costEvents, createDb } from "@paperclipai/db";
import type { ServerAdapterModule } from "@paperclipai/adapter-utils";
import { PROVIDER_CAPABILITY_FEATURES } from "@paperclipai/shared";
import { registerServerAdapter, unregisterServerAdapter } from "../adapters/registry.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { agentProviderBindingService } from "../services/agent-provider-bindings.js";
import { providerConformanceService } from "../services/provider-conformance.js";
import { providerDiscoveryService } from "../services/provider-discovery.js";

const support = await getEmbeddedPostgresTestSupport(), adapterType = "aw_v5_conformance_fixture";
describe.skipIf(!support.supported)("operator conformance accounting and authority (internal adapter fixtures)", () => {
  let db!: ReturnType<typeof createDb>, database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let reportedCost: number | undefined = 0, changeConfiguration = false, discoveryFails = false, terminationUnconfirmed = false;
  const adapter: ServerAdapterModule = {
    type: adapterType,
    testEnvironment: async () => ({ adapterType, status: "pass", checks: [], testedAt: new Date().toISOString() }),
    discoverCapabilities: async () => {
      if (discoveryFails) throw new Error("Private provider diagnostic must not enter the response");
      return { provider: "custom", version: "internal-fixture", features: Object.fromEntries(PROVIDER_CAPABILITY_FEATURES.map((key) => [key, false])) as Record<(typeof PROVIDER_CAPABILITY_FEATURES)[number], boolean>, skills: [], tools: [], discoveredAt: new Date().toISOString() };
    },
    execute: async (ctx) => {
      expect(ctx.authToken).toBeUndefined(); expect(ctx.runtimeTools).toBeUndefined(); expect(ctx.runtimeMcp).toBeUndefined();
      if (changeConfiguration) await db.update(agents).set({ adapterConfig: { changed: true } }).where(eq(agents.id, ctx.agent.id));
      await ctx.onLog("stdout", "Local fixture transport event\n");
      if (terminationUnconfirmed) return { exitCode: null, signal: null, timedOut: false, errorCode: "cancellation_unconfirmed", costUsd: 0, resultJson: { status: "unknown" } };
      return { exitCode: 0, signal: null, timedOut: false, ...(reportedCost !== undefined ? { costUsd: reportedCost } : {}), resultJson: { status: "completed" } };
    },
    testProviderConformance: async (ctx) => {
      await ctx.probe(ctx.primary, { prompt: "Synthetic protocol fixture" });
      await ctx.probe(ctx.primary, { prompt: "Second synthetic protocol fixture" });
      // Fixture-owned contract: this is never cited as a live provider pilot.
      return { connect: true, identity: true, start: true, stream: true, wait: true, cancel: true, memoryScoping: true };
    },
  };
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-v5-provider-conformance-"); db = createDb(database.connectionString); await enableV5ForTest(db); registerServerAdapter(adapter); });
  afterAll(async () => { unregisterServerAdapter(adapterType); await database?.cleanup(); });
  async function fixture() {
    reportedCost = 0; changeConfiguration = false; discoveryFails = false; terminationUnconfirmed = false;
    const f = await seedV5Presences(db), bindings = agentProviderBindingService(db);
    await db.update(agents).set({ adapterType, adapterConfig: {} }).where(eq(agents.id, f.presence.id));
    const binding = await bindings.create(f.actor, f.home, f.presence.id, { providerType: "custom", providerAgentRef: f.presence.id, providerEndpointRef: null, isolationMode: "isolated_per_presence" });
    await bindings.attach(f.actor, f.home, f.presence.id, { providerBindingId: binding.id, providerProfileRef: f.presence.id }); return f;
  }
  const input = { acknowledgeProviderRuns: true as const, maximumCostCents: 100, isolationPeer: null };
  it("pauses a presence when its provider termination cannot be confirmed", async () => {
    const f = await fixture(); terminationUnconfirmed = true;
    const result = await providerConformanceService(db).test(f.actor, f.home, f.presence.id, input);
    expect(result.runIds).toHaveLength(1); expect(result.failure).toBeTruthy();
    expect((await db.select().from(agents).where(eq(agents.id, f.presence.id)))[0]?.status).toBe("paused");
    await expect(agentProviderBindingService(db).assertRuntime(f.home, f.presence.id)).rejects.toMatchObject({ status: 409 });
  });
  it("retains each real adapter invocation, charges its source company and pins tested configuration", async () => {
    const f = await fixture(), result = await providerConformanceService(db).test(f.actor, f.home, f.presence.id, input);
    expect(result.failure).toBeNull(); expect(result.binding.status).toBe("active"); expect(result.runIds).toHaveLength(2);
    const runs = await db.select().from(heartbeatRuns).where(inArray(heartbeatRuns.id, result.runIds));
    expect(runs.every((run) => run.companyId === f.home && run.responsibleUserId === f.userId && run.status === "succeeded" && run.contextSnapshot?.platformToolsGranted === false)).toBe(true);
    const costs = await db.select().from(costEvents).where(and(eq(costEvents.companyId, f.home), inArray(costEvents.heartbeatRunId, result.runIds))); expect(costs).toHaveLength(2);
    await expect(agentProviderBindingService(db).assertRuntime(f.home, f.presence.id)).resolves.toBeDefined();
  });
  it("unknown cost stops further probes and cannot fabricate passing conformance", async () => {
    const f = await fixture(); reportedCost = undefined;
    const result = await providerConformanceService(db).test(f.actor, f.home, f.presence.id, input);
    expect(result.runIds).toHaveLength(1); expect(result.spentCents).toBeNull(); expect(result.binding.status).toBe("unqualified"); expect(result.failure).toBeTruthy();
  });
  it("pins the isolation peer and rejects later changes to its tested physical profile", async () => {
    const f = await fixture(), bindings = agentProviderBindingService(db);
    await db.update(agents).set({ adapterType, adapterConfig: {} }).where(eq(agents.id, f.guestPresence.id));
    const peerBinding = await bindings.create(f.actor, f.guest, f.guestPresence.id, { providerType: "custom", providerAgentRef: f.guestPresence.id, providerEndpointRef: null, isolationMode: "isolated_per_presence" });
    await bindings.attach(f.actor, f.guest, f.guestPresence.id, { providerBindingId: peerBinding.id, providerProfileRef: f.guestPresence.id });
    const tested = await providerConformanceService(db).test(f.actor, f.home, f.presence.id, { ...input, isolationPeer: { companyId: f.guest, agentId: f.guestPresence.id } });
    const record = await bindings.assertRuntime(f.home, f.presence.id);
    expect(record.runtime.conformanceReport?.isolationPeer).toMatchObject({ companyId: f.guest, agentId: f.guestPresence.id, bindingId: peerBinding.id });
    await db.update(agents).set({ adapterConfig: { changedPeerProfile: true } }).where(eq(agents.id, f.guestPresence.id));
    await expect(bindings.assertRuntime(f.home, f.presence.id)).rejects.toMatchObject({ status: 409 });
    await expect(bindings.revalidate(f.actor, f.home, f.presence.id, tested.binding.capabilitySnapshot!.hash, "Review after changing the previously tested peer")).rejects.toMatchObject({ status: 409 });
  });
  it("denies agent self-qualification and invalidates concurrent configuration changes", async () => {
    const f = await fixture(), service = providerConformanceService(db);
    await expect(service.test({ type: "agent", companyId: f.home, agentId: f.presence.id, source: "agent_jwt", onBehalfOfUserId: f.userId }, f.home, f.presence.id, input)).rejects.toMatchObject({ status: 403 });
    changeConfiguration = true;
    await expect(service.test(f.actor, f.home, f.presence.id, input)).rejects.toMatchObject({ status: 409 });
    await expect(agentProviderBindingService(db).assertRuntime(f.home, f.presence.id)).rejects.toMatchObject({ status: 409 });
  });
  it("lost provider discovery invalidates previously passing proof", async () => {
    const f = await fixture(); await providerConformanceService(db).test(f.actor, f.home, f.presence.id, input);
    discoveryFails = true;
    await expect(providerDiscoveryService(db).discover(f.actor, f.home, f.presence.id)).rejects.toMatchObject({ status: 409, message: "Provider capability discovery failed; repeat conformance after restoring the configured connection" });
    const record = await agentProviderBindingService(db).getForPresence(f.actor, f.home, f.presence.id);
    expect(record).toMatchObject({ provider: { status: "degraded" }, runtime: { status: "degraded", qualifiedConfigurationHash: null } });
    await expect(agentProviderBindingService(db).assertRuntime(f.home, f.presence.id)).rejects.toMatchObject({ status: 409 });
  });
  it("charges a settled probe in full and stops further calls at the declared ceiling", async () => {
    const f = await fixture(); reportedCost = 2;
    const result = await providerConformanceService(db).test(f.actor, f.home, f.presence.id, { ...input, maximumCostCents: 1 });
    expect(result.runIds).toHaveLength(1); expect(result.spentCents).toBe(200); expect(result.binding.status).toBe("unqualified");
    const costs = await db.select().from(costEvents).where(eq(costEvents.heartbeatRunId, result.runIds[0]!));
    expect(costs[0]).toMatchObject({ companyId: f.home, costCents: 200, costStatus: "reported" });
  });
});
