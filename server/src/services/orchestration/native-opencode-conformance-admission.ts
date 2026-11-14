import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import {
  companySecrets, companySecretVersions, environmentLeases, type Db,
} from "@paperclipai/db";
import { forbidden } from "../../errors.js";
import type { AuthorizationActor } from "../authorization.js";
import { createRuntimeToolsToken, verifyRuntimeToolsToken, type RuntimeToolsTokenClaims } from "../../runtime-tools-token.js";
import { assertAgentRunWriteAllowed } from "../../agent-run-cancellation.js";
import { assertV7Authorization, assertV7Enabled } from "../v7-authorization.js";
import { agentProviderBindingService } from "../agent-provider-bindings.js";
import { aiConnectionService } from "../ai-connections.js";
import { budgetService } from "../budgets.js";
import { hashContextPolicySnapshot } from "../context/context-manifest.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { resolvePaperclipRunnerProviderProfile } from "../native-runtime/provider-profile.js";
import { executionSandboxService } from "../execution-sandbox/sandbox-service.js";
import { assertWorkerModelProfileCurrent, selectWorkerModelProfile, type WorkerModelProfile } from "./worker-model-profiles.js";
import { quoteModelReservation } from "./model-reservations.js";
import { modelReservationService } from "./model-reservations.js";
import { anthropicManagedMessagesCall, ReadOnlyModelKnownUsageError, validateAnthropicManagedMessagesRequest } from "./read-only-model-transport.js";
import type { guardedRemoteHttpFetch } from "../remote-http-fetch.js";
import { assertNativeOpenCodeConformanceSource, type NativeOpenCodeConformanceSourceAuthority } from "./native-opencode-conformance-source.js";

/** Compact signed RuntimeControl claim. Fields identify one canonical probe;
 * they never stand in for current provider, credential, Host, or lease facts. */
export type NativeOpenCodeConformanceClaim = Readonly<{
  qualificationGroupId: string;
  probeId: string;
  probeRunId: string;
  planId: string;
  profileId?: string;
  dispatchNonce: string;
  authorityHash?: string;
}>;

type Options = { profiles: readonly WorkerModelProfile[]; sourceSha: string; protectedEvidenceOrigin: string;
  runtimeSuspectSeconds?: number;
  fetch?: typeof guardedRemoteHttpFetch };
/**
 * Qualification-only gateway prerequisite for one server-created OpenCode
 * conformance probe. It re-reads the saved Agent selection, installed profile,
 * current Native binding, Human credential grant, hidden Task,
 * paused C0 plan, and running provider-conformance run. It intentionally does
 * not call assertRuntime() and returns no ordinary worker capability. The
 * RuntimeControl signed Host/Sandbox/lease validator and gateway's one-use
 * reservation/wire validator must still accept the same claim before IO.
 */
export async function validateNativeOpenCodeConformanceHarness(input: {
  db: Db; options: Options; actor: AuthorizationActor; companyId: string; agentId: string;
  claim: NativeOpenCodeConformanceClaim;
}) {
  const { db, options, claim } = input;
  if (input.actor.type !== "board" || input.actor.source === "local_implicit" ||
      !claim.qualificationGroupId || !claim.probeId || claim.probeRunId.length === 0 ||
      !claim.dispatchNonce || (claim.authorityHash !== undefined && !/^[a-f0-9]{64}$/.test(claim.authorityHash)))
    throw forbidden("A current one-probe Native OpenCode conformance claim is required");
  await assertV7Enabled(db, "orchestration_v7");
  for (const permission of ["company_scope:read", "agents:configure", "agent:wake"] as const)
    await assertV7Authorization(db, input.actor, input.companyId, permission,
      permission === "company_scope:read" ? undefined : { type: "agent", companyId: input.companyId, agentId: input.agentId });
  const runtime = await db.transaction(async rawTx => {
    const tx = rawTx as unknown as Db, now = new Date();
    const leases = await tx.select().from(environmentLeases).where(and(
      eq(environmentLeases.companyId, input.companyId), eq(environmentLeases.heartbeatRunId, claim.probeRunId),
      eq(environmentLeases.status, "active"), isNull(environmentLeases.releasedAt), gt(environmentLeases.expiresAt, now),
    ));
    if (leases.length !== 1 || !leases[0]?.expiresAt)
      throw forbidden("Exactly one current Native environment lease is required for conformance bootstrap");
    const checked = await executionSandboxService(tx, { runtimeSuspectSeconds: options.runtimeSuspectSeconds })
      .assertTaskExecutionContext(tx, { companyId: input.companyId, runId: claim.probeRunId,
        leaseId: leases[0].id, now });
    if (!checked?.providerConformanceBootstrap || checked.qualificationGroupId !== claim.qualificationGroupId ||
        checked.conformancePlan?.id !== claim.planId)
      throw forbidden("The Sandbox owner did not admit this exact hidden conformance run");
    return checked;
  });
  await assertAgentRunWriteAllowed(db, input.companyId, { agentId: input.agentId, runId: runtime.run.id });
  if (runtime.source.task.executionRunId !== runtime.run.id || input.actor.userId !== runtime.run.responsibleUserId)
    throw forbidden("The exact hidden Task/run and initiating Human bindings are required");
  const selected = resolvePaperclipRunnerProviderProfile(runtime.source.agent.adapterConfig);
  const configurationHash = hashContextPolicySnapshot({ adapterType: runtime.source.agent.adapterType,
    adapterConfig: runtime.source.agent.adapterConfig });
  if (selected.provider !== "opencode" || runtime.conformanceConfigurationHash !== configurationHash)
    throw forbidden("The saved Native OpenCode configuration changed during Sandbox validation");
  const profile = assertWorkerModelProfileCurrent(selectWorkerModelProfile(options.profiles, { companyId: input.companyId, agentId: input.agentId,
    ...(claim.profileId ? { profileId: claim.profileId } : {}), configurationHash,
    sourceSha: options.sourceSha, protectedEvidenceOrigin: options.protectedEvidenceOrigin }),
  options.sourceSha, options.protectedEvidenceOrigin);
  if ((claim.profileId && profile.id !== claim.profileId) || profile.transport !== "server-anthropic-messages-v1" ||
      selected.model !== `anthropic/${profile.tariff.model}`)
    throw forbidden("The exact installed OpenCode model profile or saved configuration changed");

  let binding = await agentProviderBindingService(db).getForPresence(input.actor, input.companyId, input.agentId);
  if (!binding || binding.provider.id !== profile.providerBindingId ||
      binding.runtime.providerProfileRef !== profile.providerProfileRef ||
      binding.provider.providerType !== "paperclip_native" ||
      ["revoked", "retired"].includes(binding.provider.status) || binding.runtime.status === "revoked" ||
      binding.provider.capabilitySnapshotHash !== profile.providerSnapshotHash)
    throw forbidden("The exact current saved Native binding and advertised profile are required for conformance");
  const currentBinding = await agentProviderBindingService(db).getForPresence(input.actor, input.companyId, input.agentId);
  if (!currentBinding || currentBinding.provider.id !== profile.providerBindingId ||
      currentBinding.runtime.providerProfileRef !== profile.providerProfileRef ||
      currentBinding.provider.providerType !== "paperclip_native" ||
      ["revoked", "retired"].includes(currentBinding.provider.status) || currentBinding.runtime.status === "revoked" ||
      currentBinding.provider.capabilitySnapshotHash !== profile.providerSnapshotHash)
    throw forbidden("The current saved Native binding changed during conformance admission");
  binding = currentBinding;

  const userId = runtime.run.responsibleUserId!;
  const connection = await aiConnectionService(db).select({ companyId: input.companyId, userId,
    agentId: input.agentId, adapterType: "claude_local", binding: profile.binding, model: profile.tariff.model });
  const credentialRef = connection.grant.credentialSecretRefs.find(ref => ref.configPath === "ai.credential");
  const [credential] = credentialRef ? await db.select({ secret: companySecrets, version: companySecretVersions })
    .from(companySecrets).innerJoin(companySecretVersions, and(
      eq(companySecretVersions.secretId, companySecrets.id),
      eq(companySecretVersions.version, companySecrets.latestVersion),
    )).where(and(eq(companySecrets.companyId, input.companyId), eq(companySecrets.id, credentialRef.secretId))) : [];
  if (!credential || connection.attribution.method !== "api_key" || credential.secret.status !== "active" ||
      credential.version.revokedAt || ["disabled", "destroyed"].includes(credential.version.status))
    throw forbidden("The current Human-approved OpenCode credential grant is unavailable");

  if (await budgetService(db).getInvocationBlock(input.companyId, input.agentId))
    throw forbidden("The current company or Native Agent budget blocks provider conformance");
  const quote = quoteModelReservation({ tariff: profile.tariff, sourceSha: options.sourceSha,
    inputTokensUpperBound: profile.inputTokensUpperBound, maxOutputTokens: profile.maxOutputTokens });
  if (runtime.conformancePlan!.budgets.maxModelCostMinor === null || quote.maximumMinor > runtime.conformancePlan!.budgets.maxModelCostMinor)
    throw forbidden("The paused C0 plan's reviewed model-cost ceiling cannot cover this bounded probe");
  const harnessAuthorityHash = nativeSha256({ groupId: claim.qualificationGroupId, probeId: claim.probeId,
    runId: runtime.run.id, planId: runtime.conformancePlan!.id, taskId: runtime.source.task.id, userId, profileId: profile.id, profileHash: nativeSha256(profile),
    configurationHash, providerBindingId: binding.provider.id, providerProfileRef: binding.runtime.providerProfileRef,
    providerSnapshotHash: binding.provider.capabilitySnapshotHash, credentialGrantId: connection.grant.id,
    credentialSecretVersionId: credential.version.id, environmentLeaseId: runtime.lease.id,
    leaseExpiresAt: runtime.lease.expiresAt!.toISOString() });
  const authorityHash = nativeSha256({ runtime: runtime.authorityHash, harness: harnessAuthorityHash,
    profileId: profile.id, probeId: claim.probeId, dispatchNonce: claim.dispatchNonce });
  if (claim.authorityHash !== undefined && authorityHash !== claim.authorityHash)
    throw forbidden("The signed bootstrap claim no longer matches the canonical Native run authority");
  return Object.freeze({ qualificationGroupId: claim.qualificationGroupId, probeId: claim.probeId,
    run: runtime.run, runId: runtime.run.id, planId: runtime.conformancePlan!.id, taskId: runtime.source.task.id, planVersion: runtime.conformancePlan!.version,
    initiatingHumanId: userId, profile,
    profileHash: nativeSha256(profile), selected, configurationHash, providerBindingId: binding.provider.id,
    providerProfileRef: binding.runtime.providerProfileRef, providerSnapshotHash: binding.provider.capabilitySnapshotHash!,
    credentialGrantId: connection.grant.id, credentialSecretVersionId: credential.version.id,
    credentialSha256: credential.version.valueSha256,
    environmentLeaseId: runtime.lease.id, leaseExpiresAt: runtime.lease.expiresAt!, dispatchNonce: claim.dispatchNonce,
    selection: connection, runtimeAuthorityHash: runtime.authorityHash, harnessAuthorityHash, authorityHash, quote,
    expiresAt: new Date(Math.min(runtime.deadlineAt.getTime(), quote.expiresAt ? Date.parse(quote.expiresAt) : Infinity,
      Date.now() + 60_000)) });
}

/** One-shot, tool-free Messages dispatch for a real managed OpenCode probe.
 * The reservation ledger is the only spend authority; the provider adapter
 * receives the exact already-validated request and server-selected secret. */
export async function callNativeOpenCodeConformanceMessages(input: {
  db: Db; options: Options; claims: RuntimeToolsTokenClaims; raw: unknown;
  callerSignal?: AbortSignal;
}) {
  const claims = input.claims, claim = claims.provider_conformance;
  if (claims.scope !== "provider_conformance" || !claim || !claim.authorityHash || !claim.profileId || claim.probeRunId !== claims.run_id ||
      claim.probeRunId.length === 0 || claims.exp * 1000 <= Date.now())
    throw forbidden("A live one-probe provider-conformance capability is required");
  const actor: AuthorizationActor = { type: "board", source: "session", userId: claims.responsible_user_id };
  const admissionInput = { db: input.db, options: input.options, actor, companyId: claims.company_id,
    agentId: claims.sub, claim };
  const admission = await validateNativeOpenCodeConformanceHarness(admissionInput);
  const qualifiedInput = validateAnthropicManagedMessagesRequest(input.raw, {
    model: admission.profile.tariff.model, maxOutputTokens: admission.profile.maxOutputTokens,
    maximumEnvelopeBytes: admission.profile.maximumEnvelopeBytes,
  });
  if (qualifiedInput.toolNames.length !== 0 || qualifiedInput.request.tool_choice !== undefined ||
      qualifiedInput.request.messages.some(message => Array.isArray(message.content) &&
        message.content.some(block => block.type === "tool_use" || block.type === "tool_result")))
    throw forbidden("Provider conformance probes cannot grant, exercise, or replay platform tools");
  const assertCurrentSource = (current: Awaited<ReturnType<typeof validateNativeOpenCodeConformanceHarness>>) => {
    const runProfile = current.run.runnerProfileJson && typeof current.run.runnerProfileJson === "object" &&
      !Array.isArray(current.run.runnerProfileJson) ? current.run.runnerProfileJson as Record<string, unknown> : {};
    const sourceAuthority = runProfile.nativeOpenCodeConformanceSourceAuthority as NativeOpenCodeConformanceSourceAuthority | undefined;
    const runContext = current.run.contextSnapshot && typeof current.run.contextSnapshot === "object" &&
      !Array.isArray(current.run.contextSnapshot) ? current.run.contextSnapshot as Record<string, unknown> : {};
    const bootstrap = runContext.nativeOpenCodeConformanceDispatch && typeof runContext.nativeOpenCodeConformanceDispatch === "object" &&
      !Array.isArray(runContext.nativeOpenCodeConformanceDispatch)
      ? runContext.nativeOpenCodeConformanceDispatch as Record<string, unknown> : {};
    if (!sourceAuthority || bootstrap.qualificationGroupId !== current.qualificationGroupId ||
        bootstrap.probeId !== current.probeId || bootstrap.dispatchNonce !== claim.dispatchNonce ||
        bootstrap.profileId !== current.profile.id || bootstrap.planId !== current.planId ||
        bootstrap.authorityHash !== current.authorityHash ||
        Object.keys(bootstrap).sort().join(",") !== ["authorityHash", "dispatchNonce", "planId", "probeId", "profileId", "qualificationGroupId"].sort().join(","))
      throw forbidden("The exact issuer-persisted Native OpenCode probe tuple is required");
    const nativeDispatches = Array.isArray(runProfile.nativeModelInputDispatchIntents)
      ? runProfile.nativeModelInputDispatchIntents.filter((item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
    return assertNativeOpenCodeConformanceSource({ providerRequest: qualifiedInput.providerRequest as unknown as Record<string, unknown>,
      authority: sourceAuthority, dispatches: nativeDispatches, runId: current.runId,
      qualificationGroupId: current.qualificationGroupId, probeId: current.probeId,
      dispatchNonce: claim.dispatchNonce, responsibleUserId: current.initiatingHumanId }).sourceDigest;
  };
  const sourceDigest = assertCurrentSource(admission);
  const reservationAuthorityHash = nativeSha256({ runtimeAuthorityHash: admission.authorityHash, sourceDigest });
  input.callerSignal?.throwIfAborted();
  const inputHash = nativeSha256(qualifiedInput.providerRequest);
  const idempotencyKey = `opencode-conformance:${admission.runId}:${claim.probeId}:${claim.dispatchNonce}`;
  const reservations = modelReservationService(input.db, {
    sourceSha: input.options.sourceSha,
    qualifiedTariff: async request => request.purpose === "provider_conformance" &&
      request.companyId === claims.company_id && request.planId === claim.planId
      ? (await validateNativeOpenCodeConformanceHarness(admissionInput)).profile.tariff : null,
    currentAuthority: async tx => {
      const current = await validateNativeOpenCodeConformanceHarness({ ...admissionInput, db: tx });
      const currentSourceDigest = assertCurrentSource(current);
      return nativeSha256({ runtimeAuthorityHash: current.authorityHash, sourceDigest: currentSourceDigest });
    },
  });
  const reservation = await reservations.reserve(actor, {
    companyId: claims.company_id, planId: admission.planId, expectedPlanVersion: admission.planVersion,
    purpose: "provider_conformance", idempotencyKey, inputHash, authorityHash: reservationAuthorityHash,
    inputTokensUpperBound: admission.profile.inputTokensUpperBound,
    maxOutputTokens: qualifiedInput.request.max_tokens,
  });
  if (reservation.status !== "reserved") throw forbidden("This conformance probe dispatch cannot be replayed");
  await reservations.claimForDispatch(actor, claims.company_id, reservation.id);

  const controller = new AbortController();
  const remainingMs = Math.min(reservation.expiresAt.getTime() - Date.now(), claims.exp * 1000 - Date.now(),
    admission.expiresAt.getTime() - Date.now());
  if (remainingMs <= 0) {
    await reservations.recordOutcome(claims.company_id, reservation.id,
      { status: "unknown", providerResponseHash: null, usage: null }).catch(() => {});
    throw forbidden("The one-probe model session deadline expired");
  }
  const timeout = setTimeout(() => controller.abort(), remainingMs);
  const cancel = () => controller.abort();
  input.callerSignal?.addEventListener("abort", cancel, { once: true });
  let checking: Promise<void> | null = null;
  const assertCurrent = async () => {
    controller.signal.throwIfAborted();
    const current = await validateNativeOpenCodeConformanceHarness(admissionInput);
    controller.signal.throwIfAborted();
    const currentSourceDigest = assertCurrentSource(current);
    if (nativeSha256({ runtimeAuthorityHash: current.authorityHash, sourceDigest: currentSourceDigest }) !== reservationAuthorityHash)
      throw forbidden("The current Host, model, or Native probe source authority changed during dispatch");
    return current;
  };
  const watch = setInterval(() => {
    if (checking) return;
    checking = assertCurrent().then(() => {}).catch(cancel).finally(() => { checking = null; });
  }, 1000);
  let settled = false;
  try {
    await assertCurrent();
    const credential = await aiConnectionService(input.db).credential(admission.selection);
    const fresh = await assertCurrent();
    if (createHash("sha256").update(credential).digest("hex") !== fresh.credentialSha256)
      throw forbidden("The current credential changed before provider dispatch");
    const result = await anthropicManagedMessagesCall(qualifiedInput.providerRequest, {
      model: admission.profile.tariff.model, maxOutputTokens: admission.profile.maxOutputTokens,
      maximumEnvelopeBytes: admission.profile.maximumEnvelopeBytes,
      maximumInputTokens: admission.profile.inputTokensUpperBound,
    }, credential, controller.signal, {
      fetch: input.options.fetch,
      onWireDispatch: async wire => {
        await assertCurrent();
        // The reservation API persists the exact provider request hash and
        // wire body before the HTTP transport is allowed to send it.
        await reservations.recordWireDispatch(actor, claims.company_id, reservation.id, {
          method: wire.method, endpoint: wire.endpoint, bodySha256: wire.bodySha256,
        });
      },
    });
    await assertCurrent();
    const outcome = await reservations.recordOutcome(claims.company_id, reservation.id, {
      status: "completed", providerResponseHash: result.responseHash, usage: result.usage,
    });
    settled = outcome.status === "completed";
    if (!settled) throw forbidden("The exact provider response could not be financially settled");
    if (result.responseContent.some(block => block.type === "tool_use"))
      throw forbidden("A tool-bearing provider response is not eligible for a tool-free conformance probe");
    await assertCurrent();
    return { reservationId: reservation.id, sse: result.sse };
  } catch (error) {
    if (!settled && error instanceof ReadOnlyModelKnownUsageError) {
      const outcome = await reservations.recordOutcome(claims.company_id, reservation.id, {
        status: "failed", providerResponseHash: error.knownUsage.responseHash, usage: error.knownUsage.usage,
      }).catch(() => null);
      settled = outcome?.status === "failed";
    }
    if (!settled) await reservations.recordOutcome(claims.company_id, reservation.id,
      { status: "unknown", providerResponseHash: null, usage: null }).catch(() => {});
    throw forbidden(settled
      ? "The conformance provider response was settled but withheld for Human review"
      : "The conformance dispatch outcome is unknown; retain the full reservation liability");
  } finally {
    clearInterval(watch);
    await checking;
    clearTimeout(timeout);
    input.callerSignal?.removeEventListener("abort", cancel);
  }
}

/** RuntimeControl's private issuer callback. The caller supplies only the
 * server-created run/group/plan/profile/probe selectors; this owner generates
 * the fresh nonce, re-reads the shared Sandbox authority, and signs its result. */
export async function issueNativeOpenCodeConformanceRun(input: {
  db: Db; options: Options; companyId: string; agentId: string; runId: string;
  responsibleUserId: string; qualificationGroupId: string; planId: string; profileId?: string; probeId: string;
}) {
  const actor: AuthorizationActor = { type: "board", source: "session", userId: input.responsibleUserId };
  const unsigned: NativeOpenCodeConformanceClaim = {
    qualificationGroupId: input.qualificationGroupId, probeId: input.probeId,
    probeRunId: input.runId, planId: input.planId, ...(input.profileId ? { profileId: input.profileId } : {}),
    dispatchNonce: randomUUID(),
  };
  const admission = await validateNativeOpenCodeConformanceHarness({ db: input.db, options: input.options,
    actor, companyId: input.companyId, agentId: input.agentId, claim: unsigned });
  const claim = { ...unsigned, profileId: admission.profile.id, authorityHash: admission.authorityHash };
  const minted = createRuntimeToolsToken({ agentId: input.agentId, companyId: input.companyId,
    runId: input.runId, responsibleUserId: input.responsibleUserId, scope: "provider_conformance",
    providerConformanceBinding: claim, providerConformanceDeadlineAt: admission.expiresAt });
  const verified = minted && verifyRuntimeToolsToken(minted.token, "provider_conformance");
  if (!minted || !verified?.provider_conformance ||
      nativeSha256(verified.provider_conformance) !== nativeSha256(claim))
    throw forbidden("Native OpenCode conformance capability signing is unavailable");
  return { ...minted, inputTokensUpperBound: admission.profile.inputTokensUpperBound,
    maxOutputTokens: admission.profile.maxOutputTokens, profileId: admission.profile.id,
    qualificationGroupId: admission.qualificationGroupId, probeId: admission.probeId,
    dispatchNonce: claim.dispatchNonce, authorityHash: admission.authorityHash, planId: admission.planId };
}
