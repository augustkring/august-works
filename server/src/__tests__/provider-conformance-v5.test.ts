import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { agents, agentPresenceRuntimeBindings, heartbeatRuns, costEvents, issues, createDb } from "@paperclipai/db";
import type { ServerAdapterModule } from "@paperclipai/adapter-utils";
import { PROVIDER_CAPABILITY_FEATURES } from "@paperclipai/shared";
import { registerServerAdapter, unregisterServerAdapter } from "../adapters/registry.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { agentProviderBindingService } from "../services/agent-provider-bindings.js";
import * as nativeBridge from "../services/native-provider-conformance.js";
import { providerConformanceService } from "../services/provider-conformance.js";
import * as secrets from "../services/secrets.js";
import { providerDiscoveryService } from "../services/provider-discovery.js";

const support = await getEmbeddedPostgresTestSupport(), adapterType = "aw_v5_conformance_fixture";
describe.skipIf(!support.supported)("operator conformance accounting and authority (internal adapter fixtures)", () => {
  let db!: ReturnType<typeof createDb>, database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let reportedCost: number | undefined = 0, unknownLastCost = false, callCount = 0, changeConfiguration = false, discoveryFails = false, terminationUnconfirmed = false;
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
      return { exitCode: 0, signal: null, timedOut: false, ...(reportedCost !== undefined && !(unknownLastCost && ++callCount === 2) ? { costUsd: reportedCost } : {}), resultJson: { status: "completed" } };
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
    reportedCost = 0; unknownLastCost = false; callCount = 0; changeConfiguration = false; discoveryFails = false; terminationUnconfirmed = false;
    const f = await seedV5Presences(db), bindings = agentProviderBindingService(db);
    await db.update(agents).set({ adapterType, adapterConfig: {} }).where(eq(agents.id, f.presence.id));
    const binding = await bindings.create(f.actor, f.home, f.presence.id, { providerType: "custom", providerAgentRef: f.presence.id, providerEndpointRef: null, isolationMode: "isolated_per_presence" });
    await bindings.attach(f.actor, f.home, f.presence.id, { providerBindingId: binding.id, providerProfileRef: f.presence.id }); return f;
  }
  const input = { acknowledgeProviderRuns: true as const, maximumCostCents: 100, isolationPeer: null };
  it.each([
    { reportedCost: 0, maximumCostCents: 100, terminationUnconfirmed: false },
    { reportedCost: undefined, maximumCostCents: 100, terminationUnconfirmed: false },
    { reportedCost: 2, maximumCostCents: 1, terminationUnconfirmed: false },
    { reportedCost: 0, maximumCostCents: 100, terminationUnconfirmed: true },
  ])("refuses unreserved paid probes before credential selection and adapter invocation (%j)", async (scenario) => {
    const f = await fixture();
    reportedCost = scenario.reportedCost; terminationUnconfirmed = scenario.terminationUnconfirmed;
    const execute = vi.spyOn(adapter, "execute");
    const secretSelection = vi.spyOn(secrets, "secretService");
    const before = await agentProviderBindingService(db).getForPresence(f.actor, f.home, f.presence.id);
    try {
      await expect(providerConformanceService(db).test(f.actor, f.home, f.presence.id,
        { ...input, maximumCostCents: scenario.maximumCostCents })).rejects.toMatchObject({ status: 409,
        details: { code: "configuration_incomplete", configurationIncomplete: { reason: "paid_transport_unqualified" } } });
      expect(execute).not.toHaveBeenCalled(); expect(secretSelection).not.toHaveBeenCalled();
      expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, f.home))).toEqual([]);
      expect(await db.select().from(costEvents).where(eq(costEvents.companyId, f.home))).toEqual([]);
      expect(await db.select().from(issues).where(eq(issues.companyId, f.home))).toEqual([]);
      expect(await agentProviderBindingService(db).getForPresence(f.actor, f.home, f.presence.id)).toEqual(before);
    } finally { execute.mockRestore(); secretSelection.mockRestore(); }
  });

  it("denies a native paid harness before creating a Task or invoking the provider", async () => {
    const f = await fixture();
    await db.update(agents).set({ adapterType: "paperclip_runner", adapterConfig: { provider: "codex" } })
      .where(eq(agents.id, f.presence.id));
    const probe = vi.spyOn(nativeBridge, "executeNativeProviderConformance");
    const secretSelection = vi.spyOn(secrets, "secretService");
    try {
      await expect(providerConformanceService(db).test(f.actor, f.home, f.presence.id, input))
        .rejects.toMatchObject({ status: 409, details: { configurationIncomplete: { reason: "paid_transport_unqualified" } } });
      expect(probe).not.toHaveBeenCalled(); expect(secretSelection).not.toHaveBeenCalled();
      expect(await db.select().from(issues).where(eq(issues.companyId, f.home))).toEqual([]);
      expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, f.home))).toEqual([]);
    } finally { probe.mockRestore(); secretSelection.mockRestore(); }
  });

  it("does not let an isolation peer or operator ceiling admit unreserved model probes", async () => {
    const f = await fixture(), bindings = agentProviderBindingService(db);
    await db.update(agents).set({ adapterType, adapterConfig: {} }).where(eq(agents.id, f.guestPresence.id));
    const peer = await bindings.create(f.actor, f.guest, f.guestPresence.id, { providerType: "custom",
      providerAgentRef: f.guestPresence.id, providerEndpointRef: null, isolationMode: "isolated_per_presence" });
    await bindings.attach(f.actor, f.guest, f.guestPresence.id,
      { providerBindingId: peer.id, providerProfileRef: f.guestPresence.id });
    const before = await bindings.getForPresence(f.actor, f.guest, f.guestPresence.id);
    const execute = vi.spyOn(adapter, "execute");
    try {
      await expect(providerConformanceService(db).test(f.actor, f.home, f.presence.id,
        { ...input, isolationPeer: { companyId: f.guest, agentId: f.guestPresence.id } }))
        .rejects.toMatchObject({ status: 409, details: { configurationIncomplete: { reason: "paid_transport_unqualified" } } });
      expect(execute).not.toHaveBeenCalled();
      expect(await bindings.getForPresence(f.actor, f.guest, f.guestPresence.id)).toEqual(before);
      expect(await db.select().from(heartbeatRuns).where(inArray(heartbeatRuns.companyId, [f.home, f.guest]))).toEqual([]);
    } finally { execute.mockRestore(); }
  });

  it("keeps non-paid discovery available without earning conformance and rejects revoked late reports", async () => {
    const f = await fixture(), bindings = agentProviderBindingService(db);
    await providerDiscoveryService(db).discover(f.actor, f.home, f.presence.id);
    const before = await bindings.getForPresence(f.actor, f.home, f.presence.id);
    expect(before?.provider.capabilitySnapshot).toBeDefined();
    await expect(bindings.assertRuntime(f.home, f.presence.id)).rejects.toMatchObject({ status: 409 });
    const snapshot = await adapter.discoverCapabilities?.({ companyId: f.home, adapterType, config: {} });
    if (!before || !snapshot) throw new Error("Fixture discovery missing");
    await db.update(agentPresenceRuntimeBindings).set({ status: "revoked" })
      .where(eq(agentPresenceRuntimeBindings.id, before.runtime.id));
    await expect(bindings.recordDiscovery(f.home, f.presence.id, snapshot,
      { connect: true, identity: true, start: true, stream: true, wait: true, cancel: true, memoryScoping: true }))
      .rejects.toMatchObject({ status: 404 });
    const [retained] = await db.select().from(agentPresenceRuntimeBindings)
      .where(eq(agentPresenceRuntimeBindings.id, before.runtime.id));
    expect(retained).toMatchObject({ status: "revoked", conformanceReport: before.runtime.conformanceReport,
      qualifiedConfigurationHash: before.runtime.qualifiedConfigurationHash,
      conformanceSnapshotHash: before.runtime.conformanceSnapshotHash });
  });

  it("invalidates native proof when the included backend contract changes", async () => {
    const f = await seedV5Presences(db), bindings = agentProviderBindingService(db);
    await db.update(agents).set({ adapterType: "paperclip_runner", adapterConfig: { provider: "codex" } }).where(eq(agents.id, f.presence.id));
    const binding = await bindings.create(f.actor, f.home, f.presence.id, { providerType: "paperclip_native", providerAgentRef: f.presence.id, providerEndpointRef: null, isolationMode: "isolated_per_presence" });
    await bindings.attach(f.actor, f.home, f.presence.id, { providerBindingId: binding.id, providerProfileRef: "native-fixture-profile" });
    const snapshot = await nativeBridge.discoverNativeCapabilities({ companyId: f.home, adapterType: "paperclip_runner", config: {} });
    // Injected historic fixture proof, never evidence of a live provider.
    await bindings.recordDiscovery(f.home, f.presence.id, { ...snapshot, version: "former-native-contract" }, { connect: true, identity: true, start: true, stream: true, wait: true, cancel: true, resume: true, memoryScoping: true });
    await expect(bindings.assertRuntime(f.home, f.presence.id)).rejects.toMatchObject({ status: 409 });
    expect((await bindings.getForPresence(f.actor, f.home, f.presence.id))!.runtime.status).toBe("degraded");
  });
  it("denies agent self-qualification before any probe", async () => {
    const f = await fixture(), execute = vi.spyOn(adapter, "execute");
    try {
      await expect(providerConformanceService(db).test({ type: "agent", companyId: f.home,
        agentId: f.presence.id, source: "agent_jwt", onBehalfOfUserId: f.userId }, f.home, f.presence.id, input))
        .rejects.toMatchObject({ status: 403 });
      expect(execute).not.toHaveBeenCalled();
    } finally { execute.mockRestore(); }
  });

  it("lost non-paid discovery degrades retained advertisements without inventing passing proof", async () => {
    const f = await fixture(); await providerDiscoveryService(db).discover(f.actor, f.home, f.presence.id);
    discoveryFails = true;
    await expect(providerDiscoveryService(db).discover(f.actor, f.home, f.presence.id)).rejects.toMatchObject({ status: 409,
      message: "Provider capability discovery failed; repeat conformance after restoring the configured connection" });
    expect(await agentProviderBindingService(db).getForPresence(f.actor, f.home, f.presence.id))
      .toMatchObject({ provider: { status: "degraded" }, runtime: { status: "degraded", qualifiedConfigurationHash: null } });
    await expect(agentProviderBindingService(db).assertRuntime(f.home, f.presence.id)).rejects.toMatchObject({ status: 409 });
  });
});
