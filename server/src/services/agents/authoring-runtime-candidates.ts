import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { normalizePaperclipRunnerAdapterConfig } from "@paperclipai/adapter-utils/server-utils";
import { agentConfigurationRuntimeCandidates, agentRuntimeCandidateConformanceRequests, agentPresenceRuntimeBindings,
  agents, heartbeatRuns, orchestrationModelReservations, workflowRevisions, workflows, type Db } from "@paperclipai/db";
import { agentRuntimeCandidateCatalogSchema, agentRuntimeCandidateCreateSchema, agentRuntimeCandidateViewSchema, type ModelLifecycleMetadata } from "@paperclipai/shared";
import type { AuthorizationActor } from "../authorization.js";
import { assertV5Authorization, v5HumanActorId } from "../v5-authorization.js";
import { agentAuthoringService } from "./authoring-drafts.js";
import { agentProviderBindingService } from "../agent-provider-bindings.js";
import { hashContextPolicySnapshot } from "../context/context-manifest.js";
import { resolvePaperclipRunnerProviderProfile } from "../native-runtime/provider-profile.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { discoverNativeCapabilities } from "../native-provider-conformance.js";
import { makeProviderCapabilitySnapshot, providerConformanceRequirements } from "../provider-capabilities.js";
import { assertWorkerModelProfileCurrent, selectWorkerModelProfile, type WorkerModelProfile } from "../orchestration/worker-model-profiles.js";
import { assertModelMigrationCompatible } from "../orchestration/read-only-model-profiles.js";
import { quoteModelReservation } from "../orchestration/model-reservations.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { withV7ActivityTransaction, logActivity } from "../v7-mutations.js";
import { conflict, forbidden, notFound } from "../../errors.js";

type Options = { profiles: readonly WorkerModelProfile[]; sourceSha: string; protectedEvidenceOrigin: string };
type Candidate = typeof agentConfigurationRuntimeCandidates.$inferSelect;
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const qualifiedEvidenceSchema = z.object({
  runIds: z.array(z.uuid()).length(4).refine(ids => new Set(ids).size === 4),
  reservationIds: z.array(z.uuid()).length(4).refine(ids => new Set(ids).size === 4),
  groupId: z.uuid(), checks: z.record(z.string().max(40), z.boolean()),
  reservedMinor: z.number().int().nonnegative(), unknownCharges: z.number().int().min(0).max(4),
  proof: z.object({ sourceSha: z.string().regex(/^[a-f0-9]{40}$/), configurationHash: sha, profileHash: sha,
    profileRef: z.string().min(1).max(200), runtimeId: z.uuid(), providerBindingId: z.uuid(),
    providerSnapshot: z.object({ hash: sha }).passthrough(), testedAt: z.iso.datetime(), accountingComplete: z.literal(true),
    isolationPeer: z.strictObject({ companyId: z.uuid(), agentId: z.uuid(), runtimeId: z.uuid(), bindingId: z.uuid(),
      profileRef: z.string().min(1).max(200), configurationHash: sha }),
  }).strict(), accountingBasis: z.literal("native_pre_spend_liability_ceiling"),
}).strict();

/** Private deterministic configuration construction. It never writes the Agent,
 * attaches a runtime or returns configuration/credentials as a customer DTO. */
export function deriveRuntimeCandidateConfiguration(agent: typeof agents.$inferSelect, p: WorkerModelProfile) {
  if (agent.adapterType !== "paperclip_runner" || p.companyId !== agent.companyId || p.workerAgentId !== agent.id)
    throw forbidden("A candidate must use its own Native Agent's installed text qualification");
  const configuration = { ...normalizePaperclipRunnerAdapterConfig(agent.adapterType, structuredClone(agent.adapterConfig)), provider: "aw_text_only",
    model: p.tariff.model, workerModelProfileId: p.id, maxOutputTokens: Math.min(8192, p.maxOutputTokens) };
  try { resolvePaperclipRunnerProviderProfile(configuration); }
  catch { throw conflict("The proposed text transport needs a supported per-turn configuration without inline credentials"); }
  const baselineConfigurationHash = hashContextPolicySnapshot({ adapterType: agent.adapterType, adapterConfig: agent.adapterConfig });
  const configurationHash = hashContextPolicySnapshot({ adapterType: agent.adapterType, adapterConfig: configuration });
  if (configurationHash !== p.qualifiedConfigurationHash)
    throw conflict("The installed qualification does not match the exact proposed configuration");
  return { configuration, configurationHash, baselineConfigurationHash };
}

/** Canonical saved proposal owner. Qualification and promotion are distinct
 * commands; creating/saving a selector grants no runtime proof or live effect. */
export function agentRuntimeCandidateService(db: Db, options: Options) {
  async function owner(tx: Db, actor: AuthorizationActor, companyId: string, draftId: string, write = true) {
    const current = { ...actor, ignoreInstanceAdmin: true, isInstanceAdmin: false };
    const draft = await agentAuthoringService(tx).runtimeCandidateSnapshot(current, companyId, draftId, write);
    if (write && (draft.status !== "draft" || !draft.content)) throw conflict("The saved authoring draft is unavailable");
    const agentId = draft.agentId ?? draft.preparedAgentId;
    if (!agentId) return { draft, agent: null, binding: null };
    await assertV5Authorization(tx, current, companyId, "agents:configure", { type: "agent", companyId, agentId });
    const [agent] = await tx.select().from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, agentId))).for("share");
    if (!agent || agent.status === "terminated") throw notFound("The draft's actual Agent is unavailable");
    const binding = await agentProviderBindingService(tx).getForPresence(current, companyId, agentId);
    return { draft, agent, binding };
  }
  async function configured(tx: Db, actor: AuthorizationActor, companyId: string, draftId: string, modelProfileId: string) {
    const state = await owner(tx, actor, companyId, draftId);
    if (!state.agent || !state.binding || state.binding.runtime.status === "revoked" || state.binding.provider.status === "revoked" ||
      state.binding.provider.providerType !== "paperclip_native" || state.binding.provider.providerAgentRef !== state.agent.id ||
      state.binding.provider.isolationMode !== "isolated_per_presence" || state.binding.runtime.providerProfileRef.startsWith("aw:cell:"))
      throw conflict("This candidate requires its own Original isolated text runtime setup");
    const p = selectWorkerModelProfile(options.profiles, { companyId, agentId: state.agent.id, profileId: modelProfileId,
      sourceSha: options.sourceSha, protectedEvidenceOrigin: options.protectedEvidenceOrigin, purpose: "candidate_evaluation" });
    const incumbentSelection = resolvePaperclipRunnerProviderProfile(state.agent.adapterConfig);
    let incumbentProfile: WorkerModelProfile | null = null;
    if (incumbentSelection.provider === "aw_text_only" && incumbentSelection.workerModelProfileId !== p.id && (p.lifecycle || options.profiles.some(profile =>
      profile.id === incumbentSelection.workerModelProfileId && profile.companyId === companyId && profile.workerAgentId === state.agent!.id && profile.lifecycle))) {
      const incumbent = options.profiles.find(profile => profile.id === incumbentSelection.workerModelProfileId &&
        profile.companyId === companyId && profile.workerAgentId === state.agent!.id);
      if (!incumbent || incumbent.tariff.model !== incumbentSelection.model ||
        incumbent.lifecycle?.status === "migration_required" && incumbent.lifecycle.replacementProfileId !== p.id)
        throw conflict("The incumbent model lifecycle or selected replacement is unavailable");
      try { assertModelMigrationCompatible(incumbent, p); }
      catch { throw conflict("Model migration needs matching owner-declared region, data-use, capabilities, rate limits, budget, and context limits"); }
      incumbentProfile = incumbent;
    }
    if (p.providerBindingId !== state.binding.provider.id || p.providerProfileRef !== state.binding.runtime.providerProfileRef)
      throw forbidden("The candidate qualification belongs to another runtime");
    const proposed = deriveRuntimeCandidateConfiguration(state.agent, p);
    const snapshot = makeProviderCapabilitySnapshot(await discoverNativeCapabilities({ companyId,
      adapterType: state.agent.adapterType, config: proposed.configuration }));
    if (snapshot.hash !== p.providerSnapshotHash) throw conflict("The candidate's fixed transport capability contract changed");
    return { ...state, p, incumbentProfile, ...proposed, snapshot };
  }
  function view(row: Candidate, qualificationCurrent = false) {
    return agentRuntimeCandidateViewSchema.parse({ id: row.id, companyId: row.companyId, draftId: row.draftId,
      agentId: row.agentId, modelProfileId: row.modelProfileId, configurationHash: row.configurationHash,
      recordedStatus: row.status, qualificationRequestId: row.qualificationRequestId, qualificationCurrent,
      createdAt: row.createdAt.toISOString(), changesLive: false });
  }
  async function qualified(tx: Db, actor: AuthorizationActor, companyId: string, draftId: string, candidateId: string) {
    const [row] = await tx.select().from(agentConfigurationRuntimeCandidates).where(and(eq(agentConfigurationRuntimeCandidates.companyId, companyId),
      eq(agentConfigurationRuntimeCandidates.draftId, draftId), eq(agentConfigurationRuntimeCandidates.id, candidateId),
      eq(agentConfigurationRuntimeCandidates.createdByUserId, v5HumanActorId(actor)))).for("share");
    if (!row || row.status !== "qualified" || !row.qualificationRequestId) throw conflict("The saved runtime candidate needs current Native conformance");
    const state = await configured(tx, actor, companyId, draftId, row.modelProfileId);
    if (row.configurationHash !== state.configurationHash || row.baselineConfigurationHash !== state.baselineConfigurationHash ||
      row.sourceSha !== options.sourceSha || row.profileHash !== nativeSha256(state.p) || state.draft.content?.runtimeCandidateId !== row.id)
      throw conflict("The saved candidate or its installed qualification changed");
    const [request] = await tx.select().from(agentRuntimeCandidateConformanceRequests).where(and(
      eq(agentRuntimeCandidateConformanceRequests.companyId, companyId), eq(agentRuntimeCandidateConformanceRequests.candidateId, row.id),
      eq(agentRuntimeCandidateConformanceRequests.id, row.qualificationRequestId), eq(agentRuntimeCandidateConformanceRequests.status, "qualified"),
      eq(agentRuntimeCandidateConformanceRequests.createdByUserId, row.createdByUserId))).for("share");
    const parsed = qualifiedEvidenceSchema.safeParse(request?.evidence);
    if (!request?.finishedAt || !parsed.success) throw conflict("The original qualified probe evidence is unavailable");
    const evidence = parsed.data, proof = evidence.proof;
    if (evidence.groupId !== request.id || proof.sourceSha !== options.sourceSha || proof.configurationHash !== row.configurationHash ||
      proof.profileHash !== row.profileHash || proof.providerSnapshot.hash !== state.snapshot.hash || proof.runtimeId !== state.binding!.runtime.id ||
      proof.providerBindingId !== state.binding!.provider.id || proof.profileRef !== state.p.providerProfileRef ||
      !providerConformanceRequirements(state.snapshot, "isolated_per_presence").every(key => evidence.checks[key] === true))
      throw conflict("The original probe qualification does not match this exact configuration");
    // Passing flags cannot replace the Original four execution/dispatch/debit
    // records. Keep cancelled compute liability distinct from local fencing.
    const runs = await tx.select().from(heartbeatRuns).where(inArray(heartbeatRuns.id, evidence.runIds)).for("share");
    const reservations = await tx.select().from(orchestrationModelReservations)
      .where(inArray(orchestrationModelReservations.id, evidence.reservationIds)).for("share");
    if (runs.length !== 4 || reservations.length !== 4) throw conflict("Original probe runs or liabilities are unavailable");
    const peer = proof.isolationPeer;
    let primaryCount = 0, peerCount = 0, cancelled = 0;
    for (const run of runs) {
      const primary = run.companyId === companyId && run.agentId === row.agentId;
      const isolated = run.companyId === peer.companyId && run.agentId === peer.agentId;
      const reservation = reservations.find(value => value.id === run.resultJson?.reservationId);
      if ((!primary && !isolated) || run.responsibleUserId !== row.createdByUserId || run.triggerDetail !== "provider_conformance" ||
        run.contextSnapshot?.runtimeCandidateConformanceRequestId !== request.id || run.contextSnapshot?.providerConformanceGroupId !== request.id ||
        !["succeeded", "cancelled"].includes(run.status) || !reservation || reservation.companyId !== run.companyId ||
        reservation.planId !== run.contextSnapshot?.providerConformancePlanId || reservation.purpose !== "provider_conformance" ||
        reservation.principalUserId !== row.createdByUserId || !reservation.dispatchedAt ||
        (run.status === "succeeded" ? reservation.status !== "completed" : reservation.status !== "unknown" || run.resultJson?.localPublicationFenced !== true))
        throw conflict("The retained probe execution or debit does not match its original request");
      if (primary) primaryCount++; if (isolated) peerCount++; if (run.status === "cancelled") cancelled++;
    }
    if (primaryCount !== 3 || peerCount !== 1 || cancelled !== 1 || evidence.unknownCharges !== reservations.filter(value => value.status === "unknown").length ||
      reservations.reduce((sum, value) => sum + value.maximumMinor, 0) !== evidence.reservedMinor)
      throw conflict("The bounded original probe group is incomplete");
    const [peerCurrent] = await tx.select({ agent: agents, runtime: agentPresenceRuntimeBindings }).from(agents)
      .innerJoin(agentPresenceRuntimeBindings, and(eq(agentPresenceRuntimeBindings.companyId, agents.companyId), eq(agentPresenceRuntimeBindings.agentId, agents.id)))
      .where(and(eq(agents.companyId, peer.companyId), eq(agents.id, peer.agentId))).for("share");
    if (!peerCurrent || peerCurrent.agent.status === "terminated" || peerCurrent.runtime.status === "revoked" ||
      peerCurrent.runtime.id !== peer.runtimeId || peerCurrent.runtime.providerBindingId !== peer.bindingId ||
      peerCurrent.runtime.providerProfileRef !== peer.profileRef ||
      hashContextPolicySnapshot({ adapterType: peerCurrent.agent.adapterType, adapterConfig: peerCurrent.agent.adapterConfig }) !== peer.configurationHash)
      throw conflict("The original isolation peer changed; repeat qualified conformance");
    return { ...state, row, request, evidence, provider: {
      provider: { ...state.binding!.provider, status: "active", capabilitySnapshot: state.snapshot, capabilitySnapshotHash: state.snapshot.hash },
      runtime: { ...state.binding!.runtime, status: "active", qualifiedConfigurationHash: state.configurationHash, conformanceSnapshotHash: state.snapshot.hash,
        conformanceReport: { adapterContractVersion: "aw-provider-conformance-v5.2", providerVersion: state.snapshot.version,
          testedAt: proof.testedAt, profileRef: proof.profileRef, checks: evidence.checks, accountingComplete: true,
          isolationPeer: peer, accountingBasis: "native_pre_spend_liability_ceiling", reservationIds: evidence.reservationIds } },
    } };
  }
  return {
    /** Internal access for the installed conformance/test/promotion controllers.
     * It is not an HTTP response and never installs a model transport. */
    configured,
    qualified,
    catalog: async (actor: AuthorizationActor, companyId: string, draftId: string) => db.transaction(async rawTx => {
      const tx = rawTx as unknown as Db; await lockMemoryPrivacy(tx, companyId);
      const initial = await owner(tx, actor, companyId, draftId);
      const choices = [];
      let lifecycleInventory = { profileId: null as string | null, model: null as string | null,
        status: "untracked" as "untracked" | ModelLifecycleMetadata["status"], owner: null as string | null,
        retirementAt: null as string | null, replacementProfileId: null as string | null,
        regionOrRoutingProfile: null as string | null, dataUseProfile: null as string | null,
        unresolvedProfileReference: false, publishedWorkflows: [] as Array<{ workflowId: string; revisionId: string; name: string }> };
      if (initial.agent) {
        const adapterConfig = initial.agent.adapterConfig as Record<string, unknown>;
        if (adapterConfig.provider === "aw_text_only") {
          const profileId = typeof adapterConfig.workerModelProfileId === "string" ? adapterConfig.workerModelProfileId : null;
          const installed = profileId ? options.profiles.find(p => p.id === profileId && p.companyId === companyId && p.workerAgentId === initial.agent!.id) : undefined;
          lifecycleInventory = { profileId, model: typeof adapterConfig.model === "string" ? adapterConfig.model : null,
            status: installed?.lifecycle?.status ?? "untracked", owner: installed?.lifecycle?.owner ?? null,
            retirementAt: installed?.lifecycle?.retirementAt ?? null, replacementProfileId: installed?.lifecycle?.replacementProfileId ?? null,
            regionOrRoutingProfile: installed?.lifecycle?.regionOrRoutingProfile ?? null,
            dataUseProfile: installed?.lifecycle?.dataUseProfile ?? null, unresolvedProfileReference: !installed, publishedWorkflows: [] };
        }
        const graphBinding = sql`${workflowRevisions.graph}->'nodes' @> jsonb_build_array(jsonb_build_object('config', jsonb_build_object('agentId', ${initial.agent.id}::text)))`;
        lifecycleInventory.publishedWorkflows = await tx.select({ workflowId: workflows.id, revisionId: workflowRevisions.id, name: workflows.name })
          .from(workflows).innerJoin(workflowRevisions, and(eq(workflowRevisions.companyId, workflows.companyId),
            eq(workflowRevisions.workflowId, workflows.id), eq(workflowRevisions.id, workflows.publishedRevisionId)))
          .where(and(eq(workflows.companyId, companyId), isNull(workflows.archivedAt), eq(workflowRevisions.state, "published"), graphBinding))
          .limit(500);
      }
      if (initial.agent) for (const p of options.profiles.filter(p => p.companyId === companyId && p.workerAgentId === initial.agent!.id)) {
        // Expired/source-mismatched price metadata is not a selectable quote.
        try { assertWorkerModelProfileCurrent(p, options.sourceSha, options.protectedEvidenceOrigin, "candidate_evaluation"); }
        catch { continue; }
        let candidate: Awaited<ReturnType<typeof configured>>;
        try { candidate = await configured(tx, actor, companyId, draftId, p.id); }
        catch (error) { if (error instanceof Error && "status" in error && [403, 409].includes(Number(error.status))) continue; throw error; }
        const quote = quoteModelReservation({ tariff: p.tariff, sourceSha: options.sourceSha,
          inputTokensUpperBound: p.inputTokensUpperBound, maxOutputTokens: candidate.configuration.maxOutputTokens });
        choices.push({ modelProfileId: p.id, model: p.tariff.model, configurationHash: candidate.configurationHash,
          maxOutputTokens: candidate.configuration.maxOutputTokens, maximumMinorPerCall: quote.maximumMinor,
          currency: "USD" as const, requiresConformance: true as const, changesLive: false as const });
      }
      const current = await owner(tx, actor, companyId, draftId);
      if (current.draft.version !== initial.draft.version || current.agent?.id !== initial.agent?.id ||
        nativeSha256(current.agent?.adapterConfig ?? null) !== nativeSha256(initial.agent?.adapterConfig ?? null))
        throw conflict("The candidate context changed; reload");
      return agentRuntimeCandidateCatalogSchema.parse({ companyId, draftId, version: initial.draft.version,
        agentId: initial.agent?.id ?? null, identityId: initial.agent?.agentIdentityId ?? null, lifecycleInventory, choices });
    }),
    create: async (actor: AuthorizationActor, companyId: string, draftId: string, raw: z.infer<typeof agentRuntimeCandidateCreateSchema>) => {
      const input = agentRuntimeCandidateCreateSchema.parse(raw), userId = v5HumanActorId(actor);
      const requestHash = nativeSha256({ draftId, ...input });
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await lockMemoryPrivacy(tx, companyId); await owner(tx, actor, companyId, draftId, false);
        // Serialize the exact principal/request slot before lookup or allocation.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`runtime-candidate:${companyId}:${userId}:${input.requestId}`},0))`);
        const [prior] = await tx.select().from(agentConfigurationRuntimeCandidates).where(and(
          eq(agentConfigurationRuntimeCandidates.companyId, companyId), eq(agentConfigurationRuntimeCandidates.createdByUserId, userId),
          eq(agentConfigurationRuntimeCandidates.creationRequestId, input.requestId))).for("share");
        if (prior) {
          if (prior.draftId !== draftId || prior.creationRequestHash !== requestHash) throw conflict("This candidate request belongs to its original inputs");
          return view(prior);
        }
        const state = await configured(tx, actor, companyId, draftId, input.modelProfileId);
        if (state.draft.version !== input.expectedVersion) throw conflict("The saved draft changed; review its current version");
        const [row] = await tx.insert(agentConfigurationRuntimeCandidates).values({ companyId, draftId, agentId: state.agent!.id,
          createdByUserId: userId, creationRequestId: input.requestId, creationRequestHash: requestHash,
          modelProfileId: state.p.id, profileHash: nativeSha256(state.p), configurationHash: state.configurationHash,
          baselineConfigurationHash: state.baselineConfigurationHash, sourceSha: options.sourceSha }).returning();
        await logActivity(tx, { companyId, actorType: "user", actorId: userId, action: "agent_configuration.runtime_candidate_created",
          entityType: "agent_configuration_draft", entityId: draftId, details: { candidateId: row!.id,
            changesLiveConfiguration: false, runtimeQualified: false, modelCalled: false } }, publications);
        const current = await configured(tx, actor, companyId, draftId, input.modelProfileId);
        if (current.draft.version !== state.draft.version || current.configurationHash !== state.configurationHash ||
          current.baselineConfigurationHash !== state.baselineConfigurationHash || nativeSha256(current.p) !== nativeSha256(state.p))
          throw conflict("Candidate authority changed before saving");
        return view(row!);
      });
    },
    get: async (actor: AuthorizationActor, companyId: string, draftId: string, id: string) => db.transaction(async rawTx => {
      const tx = rawTx as unknown as Db; await lockMemoryPrivacy(tx, companyId); await owner(tx, actor, companyId, draftId, false);
      const [row] = await tx.select().from(agentConfigurationRuntimeCandidates).where(and(eq(agentConfigurationRuntimeCandidates.companyId, companyId),
        eq(agentConfigurationRuntimeCandidates.draftId, draftId), eq(agentConfigurationRuntimeCandidates.id, id),
        eq(agentConfigurationRuntimeCandidates.createdByUserId, v5HumanActorId(actor)))).for("share");
      if (!row) throw notFound("The saved runtime candidate is unavailable");
      await owner(tx, actor, companyId, draftId, false);
      return view(row);
    }),
    creationReceipt: async (actor: AuthorizationActor, companyId: string, draftId: string, requestId: string) => db.transaction(async rawTx => {
      const tx = rawTx as unknown as Db; await lockMemoryPrivacy(tx, companyId); await owner(tx, actor, companyId, draftId, false);
      const [row] = await tx.select().from(agentConfigurationRuntimeCandidates).where(and(
        eq(agentConfigurationRuntimeCandidates.companyId, companyId), eq(agentConfigurationRuntimeCandidates.draftId, draftId),
        eq(agentConfigurationRuntimeCandidates.createdByUserId, v5HumanActorId(actor)),
        eq(agentConfigurationRuntimeCandidates.creationRequestId, requestId))).for("share");
      await owner(tx, actor, companyId, draftId, false);
      // Absence is an observation, not rejection or permission to replace an
      // in-flight request. No creation, test, model call or activity is performed.
      return row ? view(row) : null;
    }),
  };
}
