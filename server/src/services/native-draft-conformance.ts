import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  agents, agentIdentities, companies, companySecrets, companySecretVersions,
  heartbeatRuns, issues, orchestrationPlans, type Db,
} from "@paperclipai/db";
import { orchestrationCompletionSchema, orchestrationBudgetSchema, providerConformanceInputSchema } from "@paperclipai/shared";
import { conflict, forbidden } from "../errors.js";
import type { AuthorizationActor } from "./authorization.js";
import { assertV7Authorization, assertV7Enabled, v7HumanActorId } from "./v7-authorization.js";
import { agentProviderBindingService } from "./agent-provider-bindings.js";
import { providerDiscoveryService } from "./provider-discovery.js";
import { providerConformanceRequirements } from "./provider-capabilities.js";
import { hashContextPolicySnapshot } from "./context/context-manifest.js";
import { resolvePaperclipRunnerProviderProfile } from "./native-runtime/provider-profile.js";
import { nativeSha256 } from "./native-runtime/canonical.js";
import { aiConnectionService } from "./ai-connections.js";
import { budgetService } from "./budgets.js";
import { withV7ActivityTransaction, logActivity } from "./v7-mutations.js";
import { writeOrchestrationContract } from "./orchestration/orchestration-contracts.js";
import { modelReservationService } from "./orchestration/model-reservations.js";
import { assertWorkerModelProfileCurrent, type WorkerModelProfile } from "./orchestration/worker-model-profiles.js";
import { anthropicReadOnlyCall, readOnlyModelEnvelopeBytes } from "./orchestration/read-only-model-transport.js";
import { guardedRemoteHttpFetch } from "./remote-http-fetch.js";

type Options = {
  profiles: readonly WorkerModelProfile[];
  sourceSha: string;
  protectedEvidenceOrigin: string;
  fetch?: typeof guardedRemoteHttpFetch;
};
type Service = ReturnType<typeof nativeDraftConformanceService>;
const installed = new WeakMap<Db, Service>();
export function registerNativeDraftConformance(db: Db, service: Service | undefined) {
  if (service) installed.set(db, service);
  else installed.delete(db);
}
export function installedNativeDraftConformance(db: Db) {
  const service = installed.get(db);
  if (!service) throw conflict("The private draft conformance transport is not installed");
  return service;
}

/** Stateless bootstrap only. It uses the native reservation ledger and actual
 * encrypted grant before qualification exists. No worker, tools, session,
 * company context, provider-selected endpoint or ordinary admission is granted.
 * Cancellation confirms local publication fencing, never provider compute stop.
 * Unknown provider charges retain the entire pre-spend liability ceiling. */
export function nativeDraftConformanceService(db: Db, options: Options) {
  return {
    async test(actor: AuthorizationActor, companyId: string, agentId: string, raw: z.infer<typeof providerConformanceInputSchema>) {
      const input = providerConformanceInputSchema.parse(raw), userId = v7HumanActorId(actor);
      if (actor.source === "local_implicit") throw forbidden("Draft conformance requires an authenticated initiating human");
      await assertV7Enabled(db, "orchestration_v7");
      const bindings = agentProviderBindingService(db), groupId = randomUUID();
      const runIds: string[] = [], reservationIds: string[] = [];
      let reservedMinor = 0, failure: string | null = null;

      async function target(cid: string, aid: string) {
        const profiles = options.profiles.filter(p => p.companyId === cid && p.workerAgentId === aid);
        if (profiles.length !== 1) throw forbidden("A unique installed draft qualification profile is required");
        const p = assertWorkerModelProfileCurrent(profiles[0]!, options.sourceSha, options.protectedEvidenceOrigin);
        await assertV7Authorization(db, actor, cid, "agents:configure", { type: "agent", companyId: cid, agentId: aid });
        await assertV7Authorization(db, actor, cid, "agent:wake", { type: "agent", companyId: cid, agentId: aid });
        const advertised = await providerDiscoveryService(db).discover(actor, cid, aid);
        if (advertised.capabilitySnapshotHash !== p.providerSnapshotHash) throw conflict("Draft capability profile changed before qualification");
        const initial = await bindings.getForPresence(actor, cid, aid);
        if (!initial) throw conflict("Draft provider binding is missing");
        let plan: typeof orchestrationPlans.$inferSelect | undefined;

        async function current(tx: Db, runId?: string) {
          await assertV7Enabled(tx, "orchestration_v7");
          const fresh = assertWorkerModelProfileCurrent(p, options.sourceSha, options.protectedEvidenceOrigin);
          for (const action of ["agents:configure", "agent:wake"] as const)
            await assertV7Authorization(tx, actor, cid, action, { type: "agent", companyId: cid, agentId: aid });
          const [presence] = await tx.select({ agent: agents, identity: agentIdentities, company: companies }).from(agents)
            .innerJoin(agentIdentities, eq(agentIdentities.id, agents.agentIdentityId))
            .innerJoin(companies, eq(companies.id, agents.companyId))
            .where(and(eq(agents.companyId, cid), eq(agents.id, aid)));
          if (!presence || presence.company.status !== "active" || presence.identity.status !== "active" ||
              !["idle", "error", ...(runId ? ["running"] : [])].includes(presence.agent.status) ||
              presence.agent.adapterType !== "paperclip_runner" || presence.agent.runtimeConfig?.aiConnection ||
              await budgetService(tx).getInvocationBlock(cid, aid))
            throw forbidden("Current idle Native presence and company budget required");
          const selected = resolvePaperclipRunnerProviderProfile(presence.agent.adapterConfig);
          if (selected.provider !== "aw_text_only" || selected.workerModelProfileId !== p.id || selected.model !== p.tariff.model ||
              selected.maxOutputTokens > p.maxOutputTokens ||
              hashContextPolicySnapshot({ adapterType: presence.agent.adapterType, adapterConfig: presence.agent.adapterConfig }) !== p.qualifiedConfigurationHash)
            throw forbidden("The presence does not select its exact installed draft profile");
          const bound = await agentProviderBindingService(tx).getForPresence(actor, cid, aid);
          if (!bound || bound.provider.status === "revoked" || bound.runtime.status === "revoked" ||
              bound.provider.providerType !== "paperclip_native" || bound.provider.providerAgentRef !== aid ||
              bound.provider.isolationMode !== "isolated_per_presence" ||
              bound.provider.id !== p.providerBindingId || bound.runtime.id !== initial!.runtime.id ||
              bound.provider.capabilitySnapshotHash !== p.providerSnapshotHash || bound.runtime.providerProfileRef !== p.providerProfileRef ||
              bound.runtime.providerProfileRef.startsWith("aw:cell:")) throw forbidden("Draft bootstrap binding changed or requires physical admission");
          if (runId) {
            const [run] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, cid), eq(heartbeatRuns.agentId, aid), eq(heartbeatRuns.id, runId)));
            if (!run || run.status !== "running" || run.responsibleUserId !== userId || run.triggerDetail !== "provider_conformance" ||
                run.contextSnapshot?.providerConformanceGroupId !== groupId || run.contextSnapshot?.providerConformancePlanId !== plan?.id)
              throw forbidden("Synthetic conformance run ownership changed");
          }
          const connection = await aiConnectionService(tx).select({ companyId: cid, userId, agentId: aid,
            adapterType: "claude_local", binding: fresh.binding, model: fresh.tariff.model });
          const ref = connection.grant.credentialSecretRefs.find(r => r.configPath === "ai.credential");
          const [secret] = ref ? await tx.select({ secret: companySecrets, version: companySecretVersions }).from(companySecrets)
            .innerJoin(companySecretVersions, and(eq(companySecretVersions.secretId, companySecrets.id), eq(companySecretVersions.version, companySecrets.latestVersion)))
            .where(and(eq(companySecrets.companyId, cid), eq(companySecrets.id, ref.secretId))) : [];
          if (connection.attribution.method !== "api_key" || !secret || secret.secret.status !== "active" || secret.version.revokedAt ||
              ["disabled", "destroyed"].includes(secret.version.status)) throw forbidden("Current encrypted draft grant required");
          const authorityHash = nativeSha256(JSON.parse(JSON.stringify({ profile: fresh, runId, groupId, userId,
            agent: { id: aid, config: presence.agent.adapterConfig, permissions: presence.agent.permissions },
            provider: { id: bound.provider.id, snapshot: bound.provider.capabilitySnapshotHash, runtime: bound.runtime.id, profile: bound.runtime.providerProfileRef },
            connection: { id: connection.connection.id, config: connection.connection.config, updatedAt: connection.connection.updatedAt },
            grant: { id: connection.grant.id, updatedAt: connection.grant.updatedAt, refs: connection.grant.credentialSecretRefs },
            secret: { id: secret.secret.id, version: secret.version.id, hash: secret.version.valueSha256 } })));
          return { connection, authorityHash, credentialHash: secret.version.valueSha256, agent: presence.agent, selected };
        }
        const state = await current(db);
        return { cid, aid, p, initial, snapshot: advertised.capabilitySnapshot!, state, current,
          get plan() { return plan; },
          async prepare() {
            plan = await withV7ActivityTransaction(db, async (tx, publications) => {
              await current(tx);
              const [task] = await tx.insert(issues).values({ companyId: cid, title: "Synthetic stateless draft qualification",
                description: "Private operator qualification. No company context, worker or tools are granted.",
                hiddenAt: new Date(), harnessKind: "provider_conformance", status: "in_progress", assigneeAgentId: aid }).returning();
              const contract = await writeOrchestrationContract(tx, cid, task!.id, orchestrationCompletionSchema.parse({
                objective: "Retain actual synthetic draft transport probes", requiredOutputs: [{ key: "probe-evidence" }],
                businessInvariants: ["Qualification grants no ordinary execution authority"] }), userId);
              const [created] = await tx.insert(orchestrationPlans).values({ companyId: cid, issueId: task!.id, completionContractId: contract.id,
                mode: "single_worker", actionClass: "internal_draft", riskClass: "C0", supervisionMode: "none", verificationMode: "deterministic",
                humanOversightMode: "human_review", status: "paused", startedAt: new Date(), createdBy: userId, executionPrincipal: { type: "user", userId },
                budgets: orchestrationBudgetSchema.parse({ maxModelCostMinor: input.maximumCostCents, maxToolActions: 0, maxWallClockSeconds: 300, maxRetries: 0, maxDelegationDepth: 0 }) }).returning();
              await logActivity(tx, { companyId: cid, actorType: "user", actorId: userId, action: "provider.draft_conformance_harness_created",
                entityType: "orchestration_plan", entityId: created!.id, details: { groupId, agentId: aid, maximumMinor: input.maximumCostCents, toolsGranted: false } }, publications);
              return created!;
            });
          },
        };
      }

      const primary = await target(companyId, agentId);
      const peer = input.isolationPeer ? await target(input.isolationPeer.companyId, input.isolationPeer.agentId) : null;
      if (!peer || peer.aid === agentId || peer.state.agent.agentIdentityId !== primary.state.agent.agentIdentityId ||
          peer.initial.runtime.providerProfileRef === primary.initial.runtime.providerProfileRef ||
          peer.initial.provider.providerEndpointRef !== primary.initial.provider.providerEndpointRef)
        throw conflict("Stateless isolation requires another explicit presence of the same identity and endpoint");
      const entries = [primary, peer];
      const checks: Record<string, boolean> = { connect: false, identity: false, start: false, stream: false, wait: false, cancel: false, memoryScoping: false };
      let unknownCharges = 0;
      type Probe = { output: string; completed: boolean; cancelled: boolean; dispatched: boolean; eventRetained: boolean; reservationId: string };
      async function probe(entry: typeof primary, prompt: string, cancel = false): Promise<Probe> {
        if (runIds.length >= 4) throw conflict("The bounded draft probe count is exhausted");
        const request = { model: entry.p.tariff.model, maxOutputTokens: Math.min(256, entry.state.selected.maxOutputTokens),
          system: "Synthetic qualification only. Follow the requested response exactly. Use no tools, files, other conversations, or external resources.", evidence: prompt };
        if (readOnlyModelEnvelopeBytes(request) > entry.p.maximumEnvelopeBytes) throw forbidden("Draft probe envelope exceeds qualification");
        const now = new Date();
        const run = await db.transaction(async (transaction) => {
          const tx = transaction as unknown as Db;
          const [agent] = await tx.select().from(agents).where(and(eq(agents.companyId, entry.cid), eq(agents.id, entry.aid))).for("update");
          if (!agent || !["idle", "error"].includes(agent.status)) throw conflict("Wait for existing work to settle before probing");
          const active = await tx.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, entry.cid), eq(heartbeatRuns.agentId, entry.aid), inArray(heartbeatRuns.status, ["queued", "running"]))).limit(1);
          if (active.length) throw conflict("Existing work owns this presence");
          await entry.current(tx);
          const [created] = await tx.insert(heartbeatRuns).values({ companyId: entry.cid, agentId: entry.aid, responsibleUserId: userId,
            status: "running", invocationSource: "on_demand", triggerDetail: "provider_conformance", startedAt: now,
            contextSnapshot: { providerConformanceGroupId: groupId, providerConformancePlanId: entry.plan!.id, containsCompanyContext: false, platformToolsGranted: false } }).returning();
          await tx.update(agents).set({ status: "running" }).where(eq(agents.id, entry.aid));
          return created!;
        });
        runIds.push(run.id);
        let dispatched = false, eventRetained = false, cancellationRequested = false, output = "", completed = false;
        let reservationId = "", authorityHash = "", checking: Promise<void> | undefined;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        let cancelTimer: ReturnType<typeof setTimeout> | undefined;
        const broker = modelReservationService(db, { sourceSha: options.sourceSha,
          qualifiedTariff: async () => assertWorkerModelProfileCurrent(entry.p, options.sourceSha, options.protectedEvidenceOrigin).tariff,
          currentAuthority: async (tx) => (await entry.current(tx, run.id)).authorityHash });
        const guard = setInterval(() => {
          if (checking || !authorityHash) return;
          checking = (async () => { if ((await entry.current(db, run.id)).authorityHash !== authorityHash) controller.abort(); })()
            .catch(() => controller.abort()).finally(() => { checking = undefined; });
        }, 200);
        try {
          const state = await entry.current(db, run.id); authorityHash = state.authorityHash;
          const { quoteModelReservation } = await import("./orchestration/model-reservations.js");
          const quote = quoteModelReservation({ tariff: entry.p.tariff, sourceSha: options.sourceSha,
            inputTokensUpperBound: entry.p.inputTokensUpperBound, maxOutputTokens: request.maxOutputTokens });
          if (reservedMinor + quote.maximumMinor > input.maximumCostCents) throw forbidden("Combined draft qualification liability exceeds the operator ceiling");
          const reservation = await broker.reserve(actor, { companyId: entry.cid, planId: entry.plan!.id, expectedPlanVersion: entry.plan!.version,
            purpose: "provider_conformance", idempotencyKey: `draft-conformance:${run.id}`, inputHash: nativeSha256(request), authorityHash,
            inputTokensUpperBound: entry.p.inputTokensUpperBound, maxOutputTokens: request.maxOutputTokens });
          reservationId = reservation.id; reservationIds.push(reservation.id); reservedMinor += reservation.maximumMinor;
          await broker.claimForDispatch(actor, entry.cid, reservation.id);
          const fresh = await entry.current(db, run.id);
          if (fresh.authorityHash !== authorityHash) throw forbidden("Draft authority changed before credential resolution");
          const credential = await aiConnectionService(db).credential(fresh.connection);
          if (createHash("sha256").update(credential).digest("hex") !== fresh.credentialHash) throw forbidden("Draft credential changed before dispatch");
          if ((await entry.current(db, run.id)).authorityHash !== authorityHash) throw forbidden("Draft authority changed during credential resolution");
          const result = await anthropicReadOnlyCall(request, credential, controller.signal, { fetch: async (...args) => {
            controller.signal.throwIfAborted();
            await logActivity(db, { companyId: entry.cid, actorType: "user", actorId: userId, runId: run.id, agentId: entry.aid,
              action: "provider.draft_conformance_dispatch_started", entityType: "heartbeat_run", entityId: run.id,
              details: { groupId, reservationId, source: "native-draft-conformance", providerStreaming: false } });
            eventRetained = true;
            if ((await entry.current(db, run.id)).authorityHash !== authorityHash) throw forbidden("Draft authority changed at the actual dispatch boundary");
            controller.signal.throwIfAborted();
            dispatched = true;
            if (cancel) cancelTimer = setTimeout(() => { cancellationRequested = true; controller.abort(); }, 100);
            return (options.fetch ?? guardedRemoteHttpFetch)(...args);
          } });
          controller.signal.throwIfAborted();
          if ((await entry.current(db, run.id)).authorityHash !== authorityHash) throw forbidden("Draft authority changed before publication");
          const outcome = await broker.recordOutcome(entry.cid, reservation.id, { status: "completed", providerResponseHash: nativeSha256(result), usage: result.usage });
          if (outcome.status !== "completed") throw forbidden("Provider usage exceeded its reserved envelope");
          output = result.text.trim(); completed = true;
        } catch {
          if (reservationId) {
            // The native transition is immutable; a completed/unknown receipt
            // is never overwritten. An absent provider receipt holds full cost.
            await broker.recordOutcome(entry.cid, reservationId, { status: "unknown", providerResponseHash: null, usage: null }).catch(() => {});
            if (dispatched) unknownCharges++;
          }
        } finally {
          clearTimeout(timeout); clearInterval(guard); clearTimeout(cancelTimer);
          if (checking) await checking;
          const cancelled = cancellationRequested && dispatched && !completed;
          let current = false;
          try { current = (await entry.current(db, run.id)).authorityHash === authorityHash; } catch { /* no authority means no passing receipt */ }
          await db.update(heartbeatRuns).set({ status: completed ? "succeeded" : cancelled ? "cancelled" : "failed", finishedAt: new Date(),
            exitCode: completed ? 0 : 1, errorCode: completed ? null : cancelled ? "cancelled" : "draft_conformance_failed",
            stdoutExcerpt: dispatched ? "[native-conformance:event] bounded_text_dispatch\n" : "",
            resultJson: { status: completed ? "completed" : cancelled ? "cancelled" : "failed",
              // Keep only the requested synthetic marker. Unexpected provider
              // prose is represented by the native response hash, not a log.
              output: completed && (output === "NONE" || output === prompt.match(/^Output exactly (AW_DRAFT_[a-z0-9]+)\.$/)?.[1]) ? output : "",
              localPublicationFenced: cancelled, providerComputeStopConfirmed: false, providerChargeKnown: completed,
              reservationId: reservationId || null, accountingBasis: "native_pre_spend_liability_ceiling", profileRef: entry.p.providerProfileRef } }).where(eq(heartbeatRuns.id, run.id));
          await db.update(agents).set({ status: entry.state.agent.status, updatedAt: new Date() }).where(and(eq(agents.id, entry.aid), eq(agents.status, "running")));
          if (!completed && !(cancelled && current)) throw conflict("Draft probe failed or current authority was lost; retained debits require review");
        }
        return { output, completed, cancelled: cancellationRequested && !completed, dispatched, eventRetained, reservationId };
      }

      try {
        for (const entry of entries) await entry.prepare();
        const nonce = `AW_DRAFT_${randomUUID().replaceAll("-", "")}`;
        const first = await probe(primary, `Output exactly ${nonce}.`);
        checks.connect = first.completed;
        checks.identity = first.completed; // Routing is controller-owned and checked before/after dispatch.
        checks.start = first.completed && first.output === nonce;
        checks.stream = first.dispatched && first.eventRetained; // Actual local event path; no provider-streaming claim.
        checks.wait = first.completed;
        if (!checks.start) throw conflict("The provider did not return the requested synthetic marker");
        const fresh = await probe(primary, "Output the AW_DRAFT marker from earlier messages. If no earlier messages exist, output exactly NONE.");
        const isolated = await probe(peer, "Output the AW_DRAFT marker from earlier messages. If no earlier messages exist, output exactly NONE.");
        checks.memoryScoping = fresh.completed && fresh.output === "NONE" && isolated.completed && isolated.output === "NONE";
        const cancelled = await probe(primary, "Output a long sequence of numbers for this local cancellation probe.", true);
        checks.cancel = cancelled.cancelled && cancelled.dispatched;
        for (const entry of entries) await entry.current(db);
        if (!providerConformanceRequirements(primary.snapshot, primary.initial.provider.isolationMode).every(key => checks[key]))
          failure = "Draft conformance did not pass every required transport check.";
      } catch { failure = "Draft conformance stopped: probe, authority, source, budget or retained accounting failed."; }
      finally {
        for (const entry of entries) if (entry.plan) await withV7ActivityTransaction(db, async (tx, publications) => {
          await tx.update(orchestrationPlans).set({ status: "cancelled", version: entry.plan!.version + 1, completedAt: new Date(), updatedAt: new Date() }).where(eq(orchestrationPlans.id, entry.plan!.id));
          // Close the synthetic harness without certifying a worker objective
          // or inventing the contract's declared Task document.
          await tx.update(issues).set({ status: "cancelled", completedAt: new Date() }).where(eq(issues.id, entry.plan!.issueId));
          await logActivity(tx, { companyId: entry.cid, actorType: "user", actorId: userId, action: "provider.draft_conformance_harness_settled",
            entityType: "orchestration_plan", entityId: entry.plan!.id, details: { groupId, synthetic: true, failure: Boolean(failure), unknownCharges, debitRetained: true } }, publications);
        });
      }
      try { for (const entry of entries) await entry.current(db); }
      catch { failure = "Draft conformance authority changed before retaining qualification."; }
      const { hash: _hash, ...snapshot } = primary.snapshot;
      const binding = await bindings.recordDiscovery(companyId, agentId, snapshot, checks, {
        accountingComplete: !failure && reservationIds.length === runIds.length, configurationHash: primary.p.qualifiedConfigurationHash,
        runtimeId: primary.initial.runtime.id, profileRef: primary.p.providerProfileRef, bindingId: primary.p.providerBindingId,
        isolationPeer: { companyId: peer.cid, agentId: peer.aid, runtimeId: peer.initial.runtime.id, bindingId: peer.initial.provider.id,
          profileRef: peer.p.providerProfileRef, configurationHash: peer.p.qualifiedConfigurationHash },
        accountingBasis: "native_pre_spend_liability_ceiling", reservationIds,
      });
      return { binding, checks, requiredChecks: providerConformanceRequirements(primary.snapshot, binding.isolationMode), runIds, groupId,
        spentCents: null, reservedMinor, reservationIds, unknownCharges, accountingBasis: "native_pre_spend_liability_ceiling", failure };
    },
  };
}
