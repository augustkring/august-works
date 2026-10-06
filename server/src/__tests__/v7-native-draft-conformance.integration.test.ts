import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  agents, agentPresenceRuntimeBindings, activityLog, companyMemberships, connectionGrants, createDb, heartbeatRuns, issues,
  orchestrationPlans, orchestrationWorkers, orchestrationWorkerAttempts, orchestrationModelReservations,
} from "@paperclipai/db";
import { nativeDraftConformanceService, registerNativeDraftConformance } from "../services/native-draft-conformance.js";
import { providerConformanceService } from "../services/provider-conformance.js";
import { discoverNativeCapabilities } from "../services/native-provider-conformance.js";
import { makeProviderCapabilitySnapshot } from "../services/provider-capabilities.js";
import { hashContextPolicySnapshot } from "../services/context/context-manifest.js";
import { agentProviderBindingService } from "../services/agent-provider-bindings.js";
import { aiConnectionService } from "../services/ai-connections.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { orchestrationService } from "../services/orchestration/orchestration-service.js";
import { workerModelGateway } from "../services/orchestration/worker-model-gateway.js";
import type { WorkerModelProfile } from "../services/orchestration/worker-model-profiles.js";
import type { guardedRemoteHttpFetch } from "../services/remote-http-fetch.js";
import { seedV5Presences, enableV5ForTest } from "./helpers/v5-fixtures.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport(), sourceSha = "a".repeat(40);
(support.supported ? describe : describe.skip)("Native stateless draft conformance bootstrap", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>, home: string;
  let f: Awaited<ReturnType<typeof seedV5Presences>>, profiles: WorkerModelProfile[], calls: number;
  let duringCall: (() => Promise<void>) | undefined, wrongMarker: boolean, usageExceeds: boolean;
  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), "aw-v7-draft-conformance-"));
    vi.stubEnv("PAPERCLIP_HOME", home);
    database = await startEmbeddedPostgresTestDatabase("aw-v7-draft-conformance-db-");
    db = createDb(database.connectionString);
    await instanceSettingsService(db).getExperimental(); await enableV5ForTest(db);
  }, 60000);
  afterAll(async () => {
    registerNativeDraftConformance(db, undefined);
    await database?.cleanup(); vi.unstubAllEnvs(); await rm(home, { recursive: true, force: true });
  }, 30000);
  beforeEach(async () => {
    await instanceSettingsService(db).updateExperimental({ enableWorkflowsV1: true, readiness_engine_v7: true, orchestration_v7: true });
    f = await seedV5Presences(db); profiles = []; calls = 0; duringCall = undefined; wrongMarker = false; usageExceeds = false;
    for (const presence of [f.presence, f.guestPresence]) {
      const config = { provider: "aw_text_only", model: "fixture-draft-model", workerModelProfileId: randomUUID(), maxOutputTokens: 256 };
      await db.update(agents).set({ adapterType: "paperclip_runner", adapterConfig: config }).where(eq(agents.id, presence.id));
      const bindings = agentProviderBindingService(db);
      const pb = await bindings.create(f.actor, presence.companyId, presence.id, { providerType: "paperclip_native",
        providerAgentRef: presence.id, providerEndpointRef: null, isolationMode: "isolated_per_presence" });
      await bindings.attach(f.actor, presence.companyId, presence.id, { providerBindingId: pb.id, providerProfileRef: `private:${presence.id}` });
      const connection = await aiConnectionService(db).save(presence.companyId, f.userId, { provider: "anthropic", method: "api_key",
        ownership: "shared", name: "Private bootstrap fixture", apiKey: "fixture", allAgents: false, agentIds: [presence.id] }, `private-fixture-credential-${presence.id}`);
      const snapshot = makeProviderCapabilitySnapshot(await discoverNativeCapabilities({ companyId: presence.companyId, adapterType: "paperclip_runner", config }));
      profiles.push({ id: config.workerModelProfileId, companyId: presence.companyId, workerAgentId: presence.id,
        providerBindingId: pb.id, providerSnapshotHash: snapshot.hash, providerProfileRef: `private:${presence.id}`,
        qualifiedConfigurationHash: hashContextPolicySnapshot({ adapterType: "paperclip_runner", adapterConfig: config }),
        binding: { provider: "anthropic", method: "api_key", mode: "shared", ...connection }, transport: "server-text-only-v1",
        contract: "anthropic-text-messages-2023-06-01", maximumEnvelopeBytes: 64000, inputTokensUpperBound: 1000, maxOutputTokens: 256,
        tariff: { provider: "anthropic", model: config.model, currency: "USD", fixedMinor: 3, inputMinorPerMillion: 0, outputMinorPerMillion: 0,
          sourceSha, qualificationHash: "b".repeat(64), testedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 300000).toISOString() },
        qualificationEvidenceRef: "https://protected.test.invalid/qualification/bootstrap-fixture", qualificationArtifactSha256: "c".repeat(64) });
    }
    registerNativeDraftConformance(db, service());
  });
  const input = (maximumCostCents = 12) => ({ acknowledgeProviderRuns: true as const, maximumCostCents,
    isolationPeer: { companyId: f.guest, agentId: f.guestPresence.id } });
  const transport: typeof guardedRemoteHttpFetch = async (url, init) => {
    calls++;
    expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
    expect(init.redirect).toBe("manual");
    const key = new Headers(init.headers).get("x-api-key")!;
    const aid = key.endsWith(f.presence.id) ? f.presence.id : f.guestPresence.id;
    const cid = aid === f.presence.id ? f.home : f.guest;
    const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, cid), eq(heartbeatRuns.agentId, aid), eq(heartbeatRuns.status, "running")));
    expect(run).toBeDefined();
    const [reservation] = await db.select().from(orchestrationModelReservations).where(and(eq(orchestrationModelReservations.companyId, cid), eq(orchestrationModelReservations.planId, String(run!.contextSnapshot?.providerConformancePlanId)), eq(orchestrationModelReservations.status, "dispatched")));
    expect(reservation).toMatchObject({ purpose: "provider_conformance", maximumMinor: 3, workerId: null, workerAttemptId: null });
    const [event] = await db.select().from(activityLog).where(and(eq(activityLog.companyId, cid), eq(activityLog.runId, run!.id),
      eq(activityLog.action, "provider.draft_conformance_dispatch_started")));
    expect(event?.details).toMatchObject({ reservationId: reservation!.id, source: "native-draft-conformance", providerStreaming: false });
    const body = JSON.parse(String(init.body));
    expect(body.messages).toHaveLength(1); expect(body.tools).toBeUndefined(); expect(body.stream).toBe(false);
    expect(String(init.body)).not.toContain(key);
    const prompt: string = body.messages[0].content[0].text;
    if (duringCall) await duringCall();
    if (prompt.includes("cancellation probe")) {
      const signal = init.signal!;
      await new Promise<void>((_resolve, reject) => {
        const abort = () => reject(new Error("Private fixture cancellation"));
        if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
      });
    }
    const marker = prompt.match(/^Output exactly (AW_DRAFT_[a-z0-9]+)\.$/)?.[1];
    return new Response(JSON.stringify({ type: "message", role: "assistant", model: body.model, stop_reason: "end_turn",
      content: [{ type: "text", text: marker ? wrongMarker ? "WRONG" : marker : "NONE" }],
      usage: { input_tokens: usageExceeds ? 1001 : 20, output_tokens: 10 } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const service = () => nativeDraftConformanceService(db, { profiles, sourceSha, protectedEvidenceOrigin: "https://protected.test.invalid", fetch: transport });
  const test = (maximumCostCents = 12) => providerConformanceService(db).test(f.actor, f.home, f.presence.id, input(maximumCostCents));

  it("bootstraps through the actual operator service without fixture conformance and holds cancellation liability", async () => {
    await expect(agentProviderBindingService(db).assertRuntime(f.home, f.presence.id)).rejects.toThrow();
    const result = await test();
    expect(result).toMatchObject({ failure: null, spentCents: null, reservedMinor: 12, unknownCharges: 1,
      checks: { connect: true, identity: true, start: true, stream: true, wait: true, cancel: true, memoryScoping: true } });
    expect(calls).toBe(4);
    const rows = await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId,
      String((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, result.runIds[0]!)))[0]!.contextSnapshot?.providerConformancePlanId)));
    expect(rows.map(r => r.status).sort()).toEqual(["completed", "completed", "unknown"]);
    const qualified = await agentProviderBindingService(db).assertRuntime(f.home, f.presence.id);
    expect(qualified.runtime.conformanceReport).toMatchObject({ accountingComplete: true, accountingBasis: "native_pre_spend_liability_ceiling" });
    await expect(workerModelGateway(db, { profiles, sourceSha, protectedEvidenceOrigin: "https://protected.test.invalid", fetch: transport })
      .qualifyDraft(db, { companyId: f.home, agentId: f.presence.id, responsibleUserId: f.userId }))
      .resolves.toMatchObject({ profileId: profiles[0]!.id, model: "fixture-draft-model", maximumMinor: 3 });
    const [cancelled] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, result.runIds[3]!));
    expect(cancelled!.resultJson).toMatchObject({ localPublicationFenced: true, providerComputeStopConfirmed: false, providerChargeKnown: false, output: "" });
    const plans = await db.select().from(orchestrationPlans).where(eq(orchestrationPlans.companyId, f.home));
    expect(plans[0]).toMatchObject({ status: "cancelled", modelCostReserved: 9, toolActionsUsed: 0 });
    expect(await db.select().from(orchestrationWorkers).where(eq(orchestrationWorkers.planId, plans[0]!.id))).toHaveLength(0);
    expect(await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.planId, plans[0]!.id))).toHaveLength(0);
    expect((await db.select().from(issues).where(eq(issues.id, plans[0]!.issueId)))[0]).toMatchObject({ harnessKind: "provider_conformance", status: "cancelled" });
  });
  it("preserves runtime revocation while settling a dispatched probe", async () => {
    const before = await agentProviderBindingService(db).getForPresence(f.actor, f.home, f.presence.id);
    duringCall = async () => {
      duringCall = undefined;
      await db.update(agentPresenceRuntimeBindings).set({ status: "revoked" })
        .where(eq(agentPresenceRuntimeBindings.id, before!.runtime.id));
    };
    const error = await test().then(() => null, failure => failure);
    expect(calls).toBe(1);
    const [retained] = await db.select().from(agentPresenceRuntimeBindings)
      .where(eq(agentPresenceRuntimeBindings.id, before!.runtime.id));
    expect(retained).toMatchObject({ status: "revoked", conformanceReport: before!.runtime.conformanceReport });
    expect(error).toMatchObject({ status: 404 });
    const [run] = await db.select().from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.companyId, f.home), eq(heartbeatRuns.agentId, f.presence.id)));
    expect(run!.resultJson).toMatchObject({ output: "", providerChargeKnown: false });
    const [reservation] = await db.select().from(orchestrationModelReservations)
      .where(eq(orchestrationModelReservations.id, String(run!.resultJson?.reservationId)));
    expect(reservation).toMatchObject({ status: "unknown", maximumMinor: 3 });
    const [plan] = await db.select().from(orchestrationPlans)
      .where(eq(orchestrationPlans.id, String(run!.contextSnapshot?.providerConformancePlanId)));
    expect(plan).toMatchObject({ status: "cancelled", modelCostReserved: 3 });
    await expect(agentProviderBindingService(db).assertRuntime(f.home, f.presence.id)).rejects.toThrow();
  });
  it("blocks the next dispatch before exceeding the combined two-company ceiling", async () => {
    const result = await test(8);
    expect(result.failure).not.toBeNull(); expect(result).toMatchObject({ reservedMinor: 6 }); expect(calls).toBe(2);
    await expect(agentProviderBindingService(db).assertRuntime(f.home, f.presence.id)).rejects.toThrow();
  });
  it.each(["membership", "credential", "configuration", "flag"])("withholds output and qualification after %s changes during dispatch", async kind => {
    duringCall = async () => {
      duringCall = undefined;
      if (kind === "membership") await db.delete(companyMemberships).where(eq(companyMemberships.companyId, f.home));
      if (kind === "credential") await db.update(connectionGrants).set({ status: "revoked" }).where(eq(connectionGrants.id, profiles[0]!.binding.grantId!));
      if (kind === "configuration") await db.update(agents).set({ adapterConfig: { provider: "codex" } }).where(eq(agents.id, f.presence.id));
      if (kind === "flag") await instanceSettingsService(db).updateExperimental({ orchestration_v7: false });
    };
    if (kind === "configuration") await expect(test()).rejects.toMatchObject({ status: 409 });
    else expect((await test()).failure).not.toBeNull();
    expect(calls).toBe(1);
    const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, f.home), eq(heartbeatRuns.agentId, f.presence.id)));
    expect(run!.resultJson?.output).toBe("");
    await expect(agentProviderBindingService(db).assertRuntime(f.home, f.presence.id)).rejects.toThrow();
  });
  it("rejects provider usage outside the qualified envelope and preserves the entire debit", async () => {
    usageExceeds = true;
    const result = await test(); expect(result.failure).not.toBeNull(); expect(calls).toBe(1);
    const [row] = await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.id, result.reservationIds![0]!));
    expect(row).toMatchObject({ status: "unknown", maximumMinor: 3 });
  });
  it("does not qualify a provider that returns the wrong synthetic response", async () => {
    wrongMarker = true;
    const result = await test(); expect(result.checks.start).toBe(false);
    await expect(agentProviderBindingService(db).assertRuntime(f.home, f.presence.id)).rejects.toThrow();
  });
  it("requires private installed profiles, a real human and a separate isolation peer before model effects", async () => {
    registerNativeDraftConformance(db, undefined);
    await expect(test()).rejects.toMatchObject({ status: 409 });
    await expect(service().test({ type: "board", source: "local_implicit" }, f.home, f.presence.id, input())).rejects.toMatchObject({ status: 403 });
    await expect(service().test(f.actor, f.home, f.presence.id, { ...input(), isolationPeer: null })).rejects.toMatchObject({ status: 409 });
    expect(calls).toBe(0);
  });
  it("blocks direct ledger debits on visible Tasks and harness conversion to ordinary work", async () => {
    const result = await test();
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, result.runIds[0]!));
    const [closed] = await db.select().from(orchestrationPlans).where(eq(orchestrationPlans.id, String(run!.contextSnapshot?.providerConformancePlanId)));
    const [reservation] = await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.id, result.reservationIds![0]!));
    // A fresh private plan exercises the SQL boundary independently of the
    // service guard. Restoring a terminal reservation/plan is never used.
    const [paused] = await db.insert(orchestrationPlans).values({ ...closed!, id: randomUUID(), status: "paused", version: 1,
      completedAt: null, modelCostReserved: 0, verifierCallsUsed: 0 }).returning();
    await db.update(issues).set({ status: "in_progress", completedAt: null }).where(eq(issues.id, closed!.issueId));
    await expect(orchestrationService(db).decide(f.actor, f.home, paused!.id, { action: "start", expectedVersion: 1,
      rationale: "Attempt to turn synthetic qualification into ordinary worker work" })).rejects.toMatchObject({ status: 403 });
    await db.update(issues).set({ hiddenAt: null }).where(eq(issues.id, closed!.issueId));
    await expect(db.insert(orchestrationModelReservations).values({ ...reservation!, id: randomUUID(), planId: paused!.id,
      idempotencyKey: "direct-visible-task-debit", status: "reserved", dispatchedAt: null, completedAt: null,
      providerResponseHash: null, usage: null })).rejects.toMatchObject({ cause: { message: "provider_conformance_harness_closed" } });
    await db.update(issues).set({ hiddenAt: new Date() }).where(eq(issues.id, closed!.issueId));
    const [bound] = await db.insert(orchestrationModelReservations).values({ ...reservation!, id: randomUUID(), planId: paused!.id,
      idempotencyKey: "private-sql-boundary", status: "reserved", dispatchedAt: null, completedAt: null, providerResponseHash: null, usage: null }).returning();
    await db.update(issues).set({ hiddenAt: null }).where(eq(issues.id, closed!.issueId));
    await expect(db.update(orchestrationModelReservations).set({ status: "dispatched", dispatchedAt: new Date() })
      .where(eq(orchestrationModelReservations.id, bound!.id))).rejects.toMatchObject({ cause: { message: "provider_conformance_harness_closed" } });
  });
});
