import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { expect } from "vitest";
import {
  activityLog, agents, heartbeatRuns, issues, orchestrationModelReservations,
  orchestrationPlans, orchestrationWorkerAttempts, orchestrationWorkers, type Db,
} from "@paperclipai/db";
import { aiConnectionService } from "../../services/ai-connections.js";
import { agentProviderBindingService } from "../../services/agent-provider-bindings.js";
import { nativeDraftConformanceService } from "../../services/native-draft-conformance.js";
import { discoverNativeCapabilities } from "../../services/native-provider-conformance.js";
import { makeProviderCapabilitySnapshot } from "../../services/provider-capabilities.js";
import { hashContextPolicySnapshot } from "../../services/context/context-manifest.js";
import type { WorkerModelProfile } from "../../services/orchestration/worker-model-profiles.js";
import type { guardedRemoteHttpFetch } from "../../services/remote-http-fetch.js";
import { seedCurrentHumanSourceActor } from "./current-human-source-fixture.js";
import type { seedV5Presences } from "./v5-fixtures.js";

type PresenceFixture = Awaited<ReturnType<typeof seedV5Presences>>;
type Options = {
  db: Db;
  f: PresenceFixture;
  sourceSha: string;
  credential?: string;
  model?: string;
};
type ProbeCall = {
  runId: string;
  companyId: string;
  agentId: string;
  reservationId: string;
  bodySha256: string;
  output: "marker" | "none" | "cancelled";
};

/**
 * Establishes genuine V7 Native text transport conformance through the native
 * conformance service. The Anthropic endpoint is replaced by a strict local
 * HTTP fixture: no external provider is called and no live/physical-host
 * qualification is claimed.
 */
export async function prepareGenuineNativeDraftConformanceFixture({ db, f, sourceSha,
  credential = randomUUID(), model = "fixture-draft-model" }: Options) {
  const human = await seedCurrentHumanSourceActor(db, [f.home, f.guest], f.userId);
  const profiles: WorkerModelProfile[] = [];

  for (const presence of [f.presence, f.guestPresence]) {
    const config = {
      provider: "aw_text_only",
      workerModelProfileId: randomUUID(),
      model,
      maxOutputTokens: 256,
      lifecycleMode: "per_turn",
    };
    await db.update(agents).set({ adapterType: "paperclip_runner", adapterConfig: config }).where(eq(agents.id, presence.id));
    const providers = agentProviderBindingService(db);
    const provider = await providers.create(human, presence.companyId, presence.id, {
      providerType: "paperclip_native", providerAgentRef: presence.id,
      providerEndpointRef: null, isolationMode: "isolated_per_presence",
    });
    await providers.attach(human, presence.companyId, presence.id, {
      providerBindingId: provider.id, providerProfileRef: presence.id,
    });
    const connection = await aiConnectionService(db).save(presence.companyId, f.userId, {
      provider: "anthropic", method: "api_key", ownership: "shared",
      name: "Controlled Native draft conformance fixture", apiKey: "fixture",
      allAgents: false, agentIds: [presence.id],
    }, presence.id === f.presence.id ? credential : `${credential}-peer-${presence.id}`);
    const advertisement = makeProviderCapabilitySnapshot(await discoverNativeCapabilities({
      companyId: presence.companyId, adapterType: "paperclip_runner", config,
    }));
    const testedAt = new Date();
    profiles.push({
      id: config.workerModelProfileId,
      companyId: presence.companyId,
      workerAgentId: presence.id,
      providerBindingId: provider.id,
      providerSnapshotHash: advertisement.hash,
      // The primary ref matches the existing native text fixtures' profile
      // ownership convention; the peer ref is distinct for isolation proof.
      providerProfileRef: presence.id,
      qualifiedConfigurationHash: hashContextPolicySnapshot({ adapterType: "paperclip_runner", adapterConfig: config }),
      binding: { provider: "anthropic", method: "api_key", mode: "shared", ...connection },
      transport: "server-text-only-v1",
      contract: "anthropic-text-messages-2023-06-01",
      maximumEnvelopeBytes: 64000,
      inputTokensUpperBound: 100000,
      maxOutputTokens: 1024,
      // Test-only reservation ceiling and tariff metadata. The controlled
      // fetch never reaches Anthropic and this is not price qualification.
      tariff: {
        provider: "anthropic", model, currency: "USD", fixedMinor: 3,
        inputMinorPerMillion: 0, outputMinorPerMillion: 0,
        sourceSha, qualificationHash: "b".repeat(64), testedAt: testedAt.toISOString(),
        expiresAt: new Date(testedAt.getTime() + 5 * 60_000).toISOString(),
      },
      qualificationEvidenceRef: "https://protected.test.invalid/qualification/native-draft-fixture.json",
      qualificationArtifactSha256: "c".repeat(64),
    });
  }

  const probeCalls: ProbeCall[] = [];
  let calls = 0;
  const transport: typeof guardedRemoteHttpFetch = async (url, init) => {
    calls += 1;
    expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    const key = new Headers(init.headers).get("x-api-key");
    const activeRuns = await db.select().from(heartbeatRuns).where(and(
      inArray(heartbeatRuns.companyId, [f.home, f.guest]),
      inArray(heartbeatRuns.agentId, [f.presence.id, f.guestPresence.id]),
      eq(heartbeatRuns.status, "running"), eq(heartbeatRuns.triggerDetail, "provider_conformance"),
    ));
    expect(activeRuns).toHaveLength(1);
    const run = activeRuns[0];
    expect(run).toBeDefined();
    const selected = [f.presence, f.guestPresence].find(presence => presence.id === run!.agentId);
    expect(selected).toBeDefined();
    expect(run!.companyId).toBe(selected!.companyId);
    expect(key).toBe(selected!.id === f.presence.id ? credential : `${credential}-peer-${selected!.id}`);
    expect(run!.contextSnapshot).toMatchObject({ containsCompanyContext: false, platformToolsGranted: false });
    expect(run!.contextSnapshot?.providerConformancePlanId).toEqual(expect.any(String));
    expect(run!.contextSnapshot?.providerConformanceGroupId).toEqual(expect.any(String));
    const [plan] = await db.select().from(orchestrationPlans).where(and(
      eq(orchestrationPlans.companyId, selected!.companyId),
      eq(orchestrationPlans.id, String(run!.contextSnapshot?.providerConformancePlanId)),
    ));
    expect(plan).toMatchObject({ status: "paused", actionClass: "internal_draft", riskClass: "C0" });

    const [reservation] = await db.select().from(orchestrationModelReservations).where(and(
      eq(orchestrationModelReservations.companyId, selected!.companyId),
      eq(orchestrationModelReservations.planId, plan!.id),
      eq(orchestrationModelReservations.status, "dispatched"),
    ));
    expect(reservation).toMatchObject({ purpose: "provider_conformance", maximumMinor: 3,
      workerId: null, workerAttemptId: null });
    const bodyText = String(init.body);
    const bodySha256 = createHash("sha256").update(bodyText, "utf8").digest("hex");
    expect(reservation!.providerWireReceipt).toEqual({ version: 1, reservationId: reservation!.id,
      requestHash: reservation!.requestHash, method: "POST", endpoint: "https://api.anthropic.com/v1/messages",
      bodySha256, callId: null });
    expect(reservation!.requestHash).toMatch(/^[a-f0-9]{64}$/);
    const [event] = await db.select().from(activityLog).where(and(
      eq(activityLog.companyId, selected!.companyId), eq(activityLog.runId, run!.id),
      eq(activityLog.action, "provider.draft_conformance_dispatch_started"),
    ));
    expect(event?.details).toMatchObject({ reservationId: reservation!.id,
      source: "native-draft-conformance", providerStreaming: false });

    const body = JSON.parse(bodyText);
    expect(body).toMatchObject({ model, stream: false });
    expect(body.messages).toHaveLength(1);
    expect(body.tools).toBeUndefined();
    expect(body.max_tokens).toBe(256);
    expect(bodyText).not.toContain(key);
    const prompt = String(body.messages[0].content[0].text);
    if (prompt.includes("cancellation probe")) {
      probeCalls.push({ runId: run!.id, companyId: selected!.companyId, agentId: selected!.id,
        reservationId: reservation!.id, bodySha256, output: "cancelled" });
      const signal = init.signal;
      expect(signal).toBeDefined();
      await new Promise<void>((_resolve, reject) => {
        const abort = () => {
          signal!.removeEventListener("abort", abort);
          reject(new Error("Controlled conformance fixture observed local cancellation"));
        };
        if (signal!.aborted) abort(); else signal!.addEventListener("abort", abort, { once: true });
      });
      throw new Error("Cancellation unexpectedly returned a response");
    }
    const marker = prompt.match(/^Output exactly (AW_DRAFT_[a-z0-9]+)\.$/)?.[1];
    if (!marker) expect(prompt).toBe("Output the AW_DRAFT marker from earlier messages. If no earlier messages exist, output exactly NONE.");
    const output = marker ? marker : "NONE";
    probeCalls.push({ runId: run!.id, companyId: selected!.companyId, agentId: selected!.id,
      reservationId: reservation!.id, bodySha256, output: marker ? "marker" : "none" });
    return new Response(JSON.stringify({ type: "message", role: "assistant", model: body.model,
      stop_reason: "end_turn", content: [{ type: "text", text: output }],
      usage: { input_tokens: 20, output_tokens: 10 } }),
    { status: 200, headers: { "content-type": "application/json" } });
  };

  const service = nativeDraftConformanceService(db, {
    profiles,
    sourceSha,
    protectedEvidenceOrigin: "https://protected.test.invalid",
    fetch: transport,
  });
  const result = await service.test(human, f.home, f.presence.id, {
    acknowledgeProviderRuns: true,
    maximumCostCents: 12,
    isolationPeer: { companyId: f.guest, agentId: f.guestPresence.id },
  });

  expect(result.failure).toBeNull();
  expect(result.reservedMinor).toBe(12);
  expect(result.unknownCharges).toBe(1);
  expect(result.checks).toEqual({ connect: true, identity: true, start: true,
    stream: true, wait: true, cancel: true, memoryScoping: true });
  expect(result.runIds).toHaveLength(4);
  expect(result.reservationIds).toHaveLength(4);
  expect(calls).toBe(4);
  expect(probeCalls).toHaveLength(4);
  expect(probeCalls.map(call => [call.companyId, call.agentId])).toEqual([
    [f.home, f.presence.id], [f.home, f.presence.id], [f.guest, f.guestPresence.id], [f.home, f.presence.id],
  ]);
  expect(probeCalls.map(call => call.output)).toEqual(["marker", "none", "none", "cancelled"]);
  expect(probeCalls.map(call => call.reservationId)).toEqual(result.reservationIds);

  const runs = await db.select().from(heartbeatRuns).where(inArray(heartbeatRuns.id, result.runIds));
  expect(runs).toHaveLength(4);
  expect(runs.every(run => run.triggerDetail === "provider_conformance" &&
    run.contextSnapshot?.containsCompanyContext === false && run.contextSnapshot?.platformToolsGranted === false)).toBe(true);
  const runById = new Map(runs.map(run => [run.id, run]));
  expect(result.runIds.slice(0, 3).map(id => runById.get(id)?.status)).toEqual(["succeeded", "succeeded", "succeeded"]);
  expect(runById.get(result.runIds[0]!)?.resultJson?.output).toMatch(/^AW_DRAFT_[a-z0-9]+$/);
  expect(runById.get(result.runIds[1]!)?.resultJson?.output).toBe("NONE");
  expect(runById.get(result.runIds[2]!)?.resultJson?.output).toBe("NONE");
  expect(runById.get(result.runIds[3]!)?.resultJson).toMatchObject({ status: "cancelled",
    localPublicationFenced: true, providerComputeStopConfirmed: false,
    providerChargeKnown: false, output: "" });
  const planIds = [...new Set(runs.map(run => String(run.contextSnapshot?.providerConformancePlanId)))];
  expect(planIds).toHaveLength(2);
  const reservations = await db.select().from(orchestrationModelReservations).where(inArray(orchestrationModelReservations.id, result.reservationIds));
  expect(reservations).toHaveLength(4);
  expect(reservations.every(row => row.purpose === "provider_conformance" && row.maximumMinor === 3 &&
    row.workerId === null && row.workerAttemptId === null)).toBe(true);
  expect(reservations.filter(row => row.status === "completed")).toHaveLength(3);
  expect(reservations.filter(row => row.status === "unknown")).toHaveLength(1);
  const unknownReservation = reservations.find(row => row.status === "unknown");
  expect(unknownReservation?.maximumMinor).toBe(3);
  expect(probeCalls.every(call => runById.has(call.runId) &&
    reservations.some(row => row.id === call.reservationId && row.providerWireReceipt?.bodySha256 === call.bodySha256))).toBe(true);

  const plans = await db.select().from(orchestrationPlans).where(inArray(orchestrationPlans.id, planIds));
  expect(plans).toHaveLength(2);
  expect(plans.every(plan => plan.status === "cancelled" && plan.toolActionsUsed === 0)).toBe(true);
  expect(plans.reduce((sum, plan) => sum + plan.modelCostReserved, 0)).toBe(12);
  expect(plans.find(plan => plan.companyId === f.home)?.modelCostReserved).toBe(9);
  expect(plans.find(plan => plan.companyId === f.guest)?.modelCostReserved).toBe(3);
  expect(await db.select().from(orchestrationWorkers).where(inArray(orchestrationWorkers.planId, planIds))).toEqual([]);
  expect(await db.select().from(orchestrationWorkerAttempts).where(inArray(orchestrationWorkerAttempts.planId, planIds))).toEqual([]);
  const harnessIssues = await db.select().from(issues).where(inArray(issues.id, plans.map(plan => plan.issueId)));
  expect(harnessIssues).toHaveLength(2);
  expect(harnessIssues.every(issue => issue.harnessKind === "provider_conformance" && issue.status === "cancelled" && issue.hiddenAt)).toBe(true);

  const bindings = agentProviderBindingService(db);
  if (result.binding.status === "degraded") await bindings.revalidate(human, f.home, f.presence.id,
    result.binding.capabilitySnapshotHash!, "Review the actual retained stateless conformance probes and their current accounting and isolation receipts");
  const qualified = await bindings.assertRuntime(f.home, f.presence.id);
  expect([qualified.provider.status, qualified.runtime.status]).toEqual(["active", "active"]);
  expect(qualified.runtime.providerProfileRef).toBe(f.presence.id);
  expect(qualified.runtime.qualifiedConfigurationHash).toBe(profiles[0]!.qualifiedConfigurationHash);
  expect(qualified.runtime.conformanceReport).toMatchObject({ accountingComplete: true,
    accountingBasis: "native_pre_spend_liability_ceiling", reservationIds: result.reservationIds,
    isolationPeer: { companyId: f.guest, agentId: f.guestPresence.id, profileRef: f.guestPresence.id } });
  // Serving the peer's one isolation probe does not qualify it for ordinary work.
  await expect(bindings.assertRuntime(f.guest, f.guestPresence.id)).rejects.toMatchObject({ status: 409 });

  const conformanceRunIds = [...result.runIds];
  const conformanceReservationIds = [...result.reservationIds];
  const conformancePlanIds = [...planIds];
  return {
    f,
    currentHuman: human,
    primaryProfile: profiles[0]!,
    profiles,
    model,
    credential,
    result,
    conformanceRunIds,
    conformanceReservationIds,
    conformancePlanIds,
  };
}
