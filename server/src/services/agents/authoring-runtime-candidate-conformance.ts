import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { agentConfigurationRuntimeCandidates, agentRuntimeCandidateConformanceRequests, agents, companies,
  heartbeatRuns, type Db } from "@paperclipai/db";
import { agentRuntimeCandidateConformanceCommandSchema, agentRuntimeCandidateConformanceReviewSchema,
  agentRuntimeCandidateConformanceReceiptSchema, providerConformanceInputSchema } from "@paperclipai/shared";
import type { AuthorizationActor } from "../authorization.js";
import { assertV7Authorization, assertV7Enabled, v7HumanActorId } from "../v7-authorization.js";
import { agentRuntimeCandidateService } from "./authoring-runtime-candidates.js";
import { agentAuthoringService } from "./authoring-drafts.js";
import { authoringCandidateHash } from "./authoring-test-candidate.js";
import { agentProviderBindingService } from "../agent-provider-bindings.js";
import { resolvePaperclipRunnerProviderProfile } from "../native-runtime/provider-profile.js";
import { selectWorkerModelProfile, type WorkerModelProfile } from "../orchestration/worker-model-profiles.js";
import { quoteModelReservation } from "../orchestration/model-reservations.js";
import { aiConnectionService } from "../ai-connections.js";
import { budgetService } from "../budgets.js";
import { installedNativeDraftConformance } from "../native-draft-conformance.js";
import { hashContextPolicySnapshot } from "../context/context-manifest.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { withV7ActivityTransaction, logActivity } from "../v7-mutations.js";
import { conflict, forbidden, HttpError, notFound } from "../../errors.js";

type Options = { profiles: readonly WorkerModelProfile[]; sourceSha: string; protectedEvidenceOrigin: string };
type Request = typeof agentRuntimeCandidateConformanceRequests.$inferSelect;

/** C4 admission/recovery around the Original four-probe controller. This owner
 * never supplies an endpoint, credential, transport or claimed passing checks. */
export function agentRuntimeCandidateConformanceService(db: Db, options: Options) {
  const candidates = agentRuntimeCandidateService(db, options);
  async function owned(tx: Db, actor: AuthorizationActor, companyId: string, draftId: string, candidateId: string, write: boolean) {
    await agentAuthoringService(tx).runtimeCandidateSnapshot(actor, companyId, draftId);
    const [row] = await tx.select().from(agentConfigurationRuntimeCandidates).where(and(
      eq(agentConfigurationRuntimeCandidates.companyId, companyId), eq(agentConfigurationRuntimeCandidates.draftId, draftId),
      eq(agentConfigurationRuntimeCandidates.id, candidateId), eq(agentConfigurationRuntimeCandidates.createdByUserId, v7HumanActorId(actor))));
    if (!row) throw notFound("The original candidate is unavailable");
    if (!write) return { row, state: null };
    const state = await candidates.configured(tx, actor, companyId, draftId, row.modelProfileId);
    if (row.status === "retired" || row.configurationHash !== state.configurationHash || row.baselineConfigurationHash !== state.baselineConfigurationHash ||
      row.profileHash !== nativeSha256(state.p) || row.sourceSha !== options.sourceSha || state.draft.content?.runtimeCandidateId !== row.id)
      throw conflict("Save and review the current candidate selection before qualification");
    return { row, state };
  }
  async function decision(tx: Db, actor: AuthorizationActor, companyId: string, draftId: string, candidateId: string,
    raw: z.infer<typeof providerConformanceInputSchema>) {
    const input = providerConformanceInputSchema.parse({ acknowledgeProviderRuns: raw.acknowledgeProviderRuns,
      maximumCostCents: raw.maximumCostCents, isolationPeer: raw.isolationPeer }), current = { ...actor, ignoreInstanceAdmin: true, isInstanceAdmin: false };
    await assertV7Enabled(tx, "orchestration_v7");
    const { row, state } = await owned(tx, current, companyId, draftId, candidateId, true);
    const primary = state!, blockers: string[] = [];
    await assertV7Authorization(tx, current, companyId, "agent:wake", { type: "agent", companyId, agentId: row.agentId });
    const [pending] = await tx.select({ id: agentRuntimeCandidateConformanceRequests.id }).from(agentRuntimeCandidateConformanceRequests)
      .where(and(eq(agentRuntimeCandidateConformanceRequests.companyId, companyId), eq(agentRuntimeCandidateConformanceRequests.candidateId, candidateId),
        eq(agentRuntimeCandidateConformanceRequests.status, "pending"))).limit(1);
    if (pending) blockers.push("original_qualification_pending");
    const [work] = await tx.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId),
      eq(heartbeatRuns.agentId, row.agentId), inArray(heartbeatRuns.status, ["queued", "scheduled_retry", "running"]))).limit(1);
    if (work) blockers.push("work_in_flight");
    if (!primary.agent || !["idle", "error", ...(primary.agent.pauseReason === "manual" ? ["paused"] : [])].includes(primary.agent.status))
      blockers.push("agent_not_available_for_probes");
    let maximumMinor: number | null = null, peerHash: string | null = null, connectionHash: string | null = null;
    if (!input.isolationPeer) blockers.push("explicit_isolation_peer_required");
    else {
      const peer = input.isolationPeer;
      for (const action of ["company_scope:read", "agents:configure", "agent:wake"] as const)
        await assertV7Authorization(tx, current, peer.companyId, action, { type: "agent", companyId: peer.companyId, agentId: peer.agentId });
      const [presence] = await tx.select({ agent: agents, company: companies }).from(agents)
        .innerJoin(companies, eq(companies.id, agents.companyId)).where(and(eq(agents.companyId, peer.companyId), eq(agents.id, peer.agentId)));
      if (!presence || presence.company.status !== "active" || presence.agent.adapterType !== "paperclip_runner" ||
        !["idle", "error"].includes(presence.agent.status) || presence.agent.id === row.agentId || presence.agent.agentIdentityId !== primary.agent?.agentIdentityId)
        blockers.push("isolation_peer_unavailable");
      else {
        const selected = resolvePaperclipRunnerProviderProfile(presence.agent.adapterConfig);
        if (selected.provider !== "aw_text_only") throw forbidden("The explicit peer needs its own installed text-only profile");
        const p = selectWorkerModelProfile(options.profiles, { companyId: peer.companyId, agentId: peer.agentId,
          profileId: selected.workerModelProfileId, sourceSha: options.sourceSha, protectedEvidenceOrigin: options.protectedEvidenceOrigin });
        const binding = await agentProviderBindingService(tx).getForPresence(current, peer.companyId, peer.agentId);
        if (!binding || binding.runtime.status === "revoked" || binding.provider.status === "revoked" ||
          binding.provider.providerAgentRef !== peer.agentId || binding.provider.isolationMode !== "isolated_per_presence" ||
          binding.provider.id !== p.providerBindingId || binding.runtime.providerProfileRef !== p.providerProfileRef ||
          binding.runtime.providerProfileRef === primary.binding?.runtime.providerProfileRef ||
          binding.provider.providerEndpointRef !== primary.binding?.provider.providerEndpointRef ||
          hashContextPolicySnapshot({ adapterType: presence.agent.adapterType, adapterConfig: presence.agent.adapterConfig }) !== p.qualifiedConfigurationHash)
          blockers.push("isolation_peer_changed");
        if (await budgetService(tx).getInvocationBlock(peer.companyId, peer.agentId)) blockers.push("isolation_peer_budget_blocked");
        const quote = (profile: WorkerModelProfile, output: number) => quoteModelReservation({ tariff: profile.tariff,
          sourceSha: options.sourceSha, inputTokensUpperBound: profile.inputTokensUpperBound, maxOutputTokens: Math.min(256, output) }).maximumMinor;
        maximumMinor = 3 * quote(primary.p, primary.configuration.maxOutputTokens) + quote(p, selected.maxOutputTokens);
        if (maximumMinor > input.maximumCostCents) blockers.push("reviewed_liability_ceiling_too_small");
        const userId = v7HumanActorId(actor);
        const first = await aiConnectionService(tx).select({ companyId, agentId: row.agentId, userId,
          adapterType: "claude_local", binding: primary.p.binding, model: primary.p.tariff.model });
        const second = await aiConnectionService(tx).select({ companyId: peer.companyId, agentId: peer.agentId, userId,
          adapterType: "claude_local", binding: p.binding, model: p.tariff.model });
        connectionHash = nativeSha256(JSON.parse(JSON.stringify([first, second])));
        peerHash = nativeSha256(JSON.parse(JSON.stringify({ peer, p, binding, config: presence.agent.adapterConfig,
          permissions: presence.agent.permissions, identityId: presence.agent.agentIdentityId })));
      }
    }
    if (await budgetService(tx).getInvocationBlock(companyId, row.agentId)) blockers.push("current_budget_blocked");
    const values = { companyId, draftId, candidateId, version: primary.draft.version, canTest: blockers.length === 0,
      blockers, maximumMinor, currency: "USD" as const, probeCount: 4 as const, toolsGranted: false as const,
      changesLiveConfiguration: false as const, providerComputeStopConfirmed: false as const };
    const reviewHash = nativeSha256({ values, input, profileHash: nativeSha256(primary.p), baseline: primary.baselineConfigurationHash,
      candidateHash: authoringCandidateHash(primary.draft), peerHash, connectionHash });
    return { row, state: primary, input, review: agentRuntimeCandidateConformanceReviewSchema.parse({ ...values, reviewHash }) };
  }
  function receipt(draftId: string, row: Request) {
    const metadata = row.evidence ?? {};
    return agentRuntimeCandidateConformanceReceiptSchema.parse({ companyId: row.companyId, draftId, candidateId: row.candidateId,
      requestId: row.requestId, status: row.status, createdAt: row.createdAt.toISOString(), finishedAt: row.finishedAt?.toISOString() ?? null,
      runIds: metadata.runIds ?? [], reservationIds: metadata.reservationIds ?? [], reservedMinor: metadata.reservedMinor ?? 0,
      unknownCharges: metadata.unknownCharges ?? 0, changesLiveConfiguration: false, providerComputeStopConfirmed: false });
  }
  return {
    review: async (actor: AuthorizationActor, companyId: string, draftId: string, candidateId: string,
      input: z.infer<typeof providerConformanceInputSchema>) => db.transaction(async rawTx => {
        const tx = rawTx as unknown as Db; await lockMemoryPrivacy(tx, companyId);
        return (await decision(tx, actor, companyId, draftId, candidateId, input)).review;
      }),
    receipt: async (actor: AuthorizationActor, companyId: string, draftId: string, candidateId: string, requestId: string) => db.transaction(async rawTx => {
      const tx = rawTx as unknown as Db; await lockMemoryPrivacy(tx, companyId); await owned(tx, actor, companyId, draftId, candidateId, false);
      const [row] = await tx.select().from(agentRuntimeCandidateConformanceRequests).where(and(eq(agentRuntimeCandidateConformanceRequests.companyId, companyId),
        eq(agentRuntimeCandidateConformanceRequests.candidateId, candidateId), eq(agentRuntimeCandidateConformanceRequests.requestId, requestId),
        eq(agentRuntimeCandidateConformanceRequests.createdByUserId, v7HumanActorId(actor)))).for("share");
      await owned(tx, actor, companyId, draftId, candidateId, false);
      return row ? receipt(draftId, row) : null;
    }),
    start: async (actor: AuthorizationActor, companyId: string, draftId: string, candidateId: string,
      raw: z.infer<typeof agentRuntimeCandidateConformanceCommandSchema>) => {
      const input = agentRuntimeCandidateConformanceCommandSchema.parse(raw), userId = v7HumanActorId(actor);
      const requestHash = nativeSha256({ draftId, candidateId, ...input });
      const accepted = await withV7ActivityTransaction(db, async (tx, publications) => {
        await lockMemoryPrivacy(tx, companyId); await owned(tx, actor, companyId, draftId, candidateId, false);
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`runtime-candidate-test:${companyId}:${userId}:${input.requestId}`},0))`);
        const [prior] = await tx.select().from(agentRuntimeCandidateConformanceRequests).where(and(eq(agentRuntimeCandidateConformanceRequests.companyId, companyId),
          eq(agentRuntimeCandidateConformanceRequests.createdByUserId, userId), eq(agentRuntimeCandidateConformanceRequests.requestId, input.requestId))).for("share");
        if (prior) {
          if (prior.candidateId !== candidateId || prior.requestHash !== requestHash) throw conflict("This qualification request belongs to its original inputs");
          return { row: prior, dispatch: false };
        }
        await tx.select({ id: agentConfigurationRuntimeCandidates.id }).from(agentConfigurationRuntimeCandidates)
          .where(eq(agentConfigurationRuntimeCandidates.id, candidateId)).for("update");
        const state = await decision(tx, actor, companyId, draftId, candidateId, input);
        if (state.review.version !== input.expectedVersion || state.review.reviewHash !== input.expectedReviewHash || !state.review.canTest || !state.input.isolationPeer)
          throw conflict("Review the current bounded qualification and its original blockers");
        const [row] = await tx.insert(agentRuntimeCandidateConformanceRequests).values({ companyId, candidateId, createdByUserId: userId,
          requestId: input.requestId, requestHash, expectedDraftVersion: input.expectedVersion,
          candidateHash: authoringCandidateHash(state.state.draft), input: { ...state.input, isolationPeer: state.input.isolationPeer } }).returning();
        await tx.update(agentConfigurationRuntimeCandidates).set({ status: "testing", qualificationRequestId: null, updatedAt: new Date() })
          .where(eq(agentConfigurationRuntimeCandidates.id, candidateId));
        await logActivity(tx, { companyId, actorType: "user", actorId: userId, action: "agent_configuration.runtime_candidate_test_accepted",
          entityType: "agent_configuration_draft", entityId: draftId, details: { candidateId, requestId: input.requestId,
            maximumMinor: state.review.maximumMinor, toolsGranted: false, changesLiveConfiguration: false } }, publications);
        return { row: row!, dispatch: true };
      });
      if (!accepted.dispatch) return receipt(draftId, accepted.row);
      let evidence: Record<string, unknown> | null = null, status: Exclude<Request["status"], "pending"> = "unknown";
      try {
        const candidate = await candidates.get(actor, companyId, draftId, candidateId);
        const result = await installedNativeDraftConformance(db).test(actor, companyId, candidate.agentId, accepted.row.input, accepted.row.id);
        const proof = "candidateProof" in result ? result.candidateProof : undefined;
        status = proof && !result.failure && proof.accountingComplete && result.requiredChecks.every(key => result.checks[key] === true) ? "qualified" : "failed";
        evidence = { runIds: result.runIds, reservationIds: result.reservationIds, reservedMinor: result.reservedMinor,
          unknownCharges: result.unknownCharges, groupId: result.groupId, checks: result.checks,
          ...(proof ? { proof } : {}), accountingBasis: "native_pre_spend_liability_ceiling" };
      } catch { /* An unconfirmed invocation retains its original request; never dispatch again here. */ }
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await lockMemoryPrivacy(tx, companyId);
        const [original] = await tx.select().from(agentRuntimeCandidateConformanceRequests).where(eq(agentRuntimeCandidateConformanceRequests.id, accepted.row.id)).for("update");
        if (!original || original.status !== "pending") throw conflict("The original qualification status changed");
        const [candidate] = await tx.select().from(agentConfigurationRuntimeCandidates).where(eq(agentConfigurationRuntimeCandidates.id, candidateId)).for("update");
        if (status === "qualified") {
          try {
            const current = await candidates.configured(tx, actor, companyId, draftId, candidate!.modelProfileId);
            if (!candidate || candidate.status !== "testing" || current.draft.version !== accepted.row.expectedDraftVersion ||
              authoringCandidateHash(current.draft) !== accepted.row.candidateHash || current.configurationHash !== candidate.configurationHash ||
              current.baselineConfigurationHash !== candidate.baselineConfigurationHash || nativeSha256(current.p) !== candidate.profileHash) status = "failed";
          } catch (error) { if (!(error instanceof HttpError)) throw error; status = "failed"; }
        }
        const [record] = await tx.update(agentRuntimeCandidateConformanceRequests).set({ status, evidence, finishedAt: new Date() })
          .where(eq(agentRuntimeCandidateConformanceRequests.id, original.id)).returning();
        if (candidate?.status === "testing") await tx.update(agentConfigurationRuntimeCandidates)
          .set({ status, qualificationRequestId: status === "qualified" ? original.id : null, updatedAt: new Date() })
          .where(eq(agentConfigurationRuntimeCandidates.id, candidateId));
        await logActivity(tx, { companyId, actorType: "user", actorId: userId, action: "agent_configuration.runtime_candidate_test_recorded",
          entityType: "agent_configuration_draft", entityId: draftId, details: { candidateId, requestId: original.requestId,
            outcome: status, changesLiveConfiguration: false, providerComputeStopConfirmed: false } }, publications);
        return receipt(draftId, record!);
      });
    },
  };
}
