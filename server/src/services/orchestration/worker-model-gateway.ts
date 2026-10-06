import { createHash } from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import {
  agents,
  agentIdentities,
  companies,
  agentExecutionManifests,
  companyMemberships,
  principalPermissionGrants,
  companySecrets,
  companySecretVersions,
  heartbeatRuns,
  issues,
  orchestrationPlans,
  orchestrationWorkers,
  orchestrationWorkerAttempts,
  type Db,
} from "@paperclipai/db";
import {
  workerModelBindingSchema,
  workerModelCallSchema,
  workerModelResultSchema,
  type WorkerModelBinding,
  type WorkerModelCall,
} from "@paperclipai/shared";
import {
  createRuntimeToolsToken,
  verifyRuntimeToolsToken,
  type RuntimeToolsTokenClaims,
} from "../../runtime-tools-token.js";
import { conflict, forbidden } from "../../errors.js";
import { assertAgentRunWriteAllowed } from "../../agent-run-cancellation.js";
import { aiConnectionService } from "../ai-connections.js";
import { agentProviderBindingService } from "../agent-provider-bindings.js";
import { assertV7Authorization, assertV7Enabled } from "../v7-authorization.js";
import type { AuthorizationActor } from "../authorization.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import {
  lockMemoryPrivacy,
  heartbeatMemoryPayloadRetained,
} from "../memory/memory-privacy.js";
import { withV7ActivityTransaction, logActivity } from "../v7-mutations.js";
import { enqueueSupervisionStop } from "../supervision/supervision-outbox.js";
import { modelReservationService, quoteModelReservation } from "./model-reservations.js";
import { resolvePaperclipRunnerProviderProfile } from "../native-runtime/provider-profile.js";
import {
  anthropicReadOnlyCall,
  readOnlyModelEnvelopeBytes,
} from "./read-only-model-transport.js";
import {
  assertWorkerModelProfileCurrent,
  type WorkerModelProfile,
} from "./worker-model-profiles.js";
import type { guardedRemoteHttpFetch } from "../remote-http-fetch.js";

type BoundClaims = RuntimeToolsTokenClaims & {
  worker_model: WorkerModelBinding;
};
type Options = {
  profiles: readonly WorkerModelProfile[];
  sourceSha: string;
  protectedEvidenceOrigin: string;
  fetch?: typeof guardedRemoteHttpFetch;
};

/** A Native worker's single inference boundary. It never supplies a provider
 * key, session URL or tariff to the worker. Unsupported managed/CLI transports
 * remain closed at orchestration admission: exposing this consumer does not
 * qualify their undisclosed model calls or their physical sandbox. */
export function workerModelGateway(db: Db, options: Options) {
  function profile(companyId: string, agentId: string) {
    const matches = options.profiles.filter(
      (p) => p.companyId === companyId && p.workerAgentId === agentId,
    );
    if (matches.length !== 1)
      throw forbidden(
        "No unique worker model transport qualification is configured",
      );
    return assertWorkerModelProfileCurrent(
      matches[0]!,
      options.sourceSha,
      options.protectedEvidenceOrigin,
    );
  }
  async function current(tx: Db, claims: BoundClaims) {
    const now = new Date(),
      b = claims.worker_model;
    if (claims.scope !== "worker_model" || claims.exp * 1000 <= now.getTime())
      throw forbidden("Current run-scoped worker model capability required");
    await assertV7Enabled(tx, "orchestration_v7");
    const p = profile(claims.company_id, claims.sub);
    const actor: AuthorizationActor = {
      type: "board",
      source: "session",
      userId: claims.responsible_user_id,
    };
    await assertV7Authorization(
      tx,
      actor,
      claims.company_id,
      "company_scope:read",
    );
    const [plan] = await tx
      .select()
      .from(orchestrationPlans)
      .where(
        and(
          eq(orchestrationPlans.companyId, claims.company_id),
          eq(orchestrationPlans.id, b.planId),
        ),
      );
    const [worker] = await tx
      .select()
      .from(orchestrationWorkers)
      .where(
        and(
          eq(orchestrationWorkers.companyId, claims.company_id),
          eq(orchestrationWorkers.id, b.workerId),
          eq(orchestrationWorkers.planId, b.planId),
        ),
      );
    const [attempt] = await tx
      .select()
      .from(orchestrationWorkerAttempts)
      .where(
        and(
          eq(orchestrationWorkerAttempts.companyId, claims.company_id),
          eq(orchestrationWorkerAttempts.id, b.workerAttemptId),
          eq(orchestrationWorkerAttempts.planId, b.planId),
          eq(orchestrationWorkerAttempts.workerId, b.workerId),
        ),
      );
    const [run] = await tx
      .select()
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.companyId, claims.company_id),
          eq(heartbeatRuns.agentId, claims.sub),
          eq(heartbeatRuns.id, claims.run_id),
        ),
      );
    const [manifest] = await tx
      .select()
      .from(agentExecutionManifests)
      .where(
        and(
          eq(agentExecutionManifests.companyId, claims.company_id),
          eq(agentExecutionManifests.id, b.executionManifestId),
          eq(agentExecutionManifests.agentId, claims.sub),
          eq(agentExecutionManifests.runId, claims.run_id),
        ),
      );
    if (
      !plan ||
      plan.erasedAt ||
      plan.status !== "running" ||
      !plan.startedAt ||
      plan.version !== b.expectedPlanVersion ||
      plan.executionPrincipal?.type !== "user" ||
      plan.executionPrincipal.userId !== claims.responsible_user_id ||
      plan.budgets.maxModelCostMinor === null ||
      plan.actionClass !== "internal_draft" ||
      !["C0", "C1"].includes(plan.riskClass) ||
      now.getTime() >=
        plan.startedAt.getTime() + plan.budgets.maxWallClockSeconds * 1000 ||
      !worker ||
      worker.status !== "running" ||
      worker.agentId !== claims.sub ||
      !attempt ||
      attempt.status !== "running" ||
      attempt.agentId !== claims.sub ||
      attempt.runId !== claims.run_id ||
      attempt.executionManifestId !== b.executionManifestId ||
      !run ||
      run.status !== "running" ||
      run.runtimeMode !== "native" ||
      run.nativeIssueId !== worker.issueId ||
      run.responsibleUserId !== claims.responsible_user_id ||
      !manifest ||
      manifest.manifest.responsibleUserId !== claims.responsible_user_id ||
      manifest.manifest.executionScope.delegatedScopes.some(
        (s) => s.companyId !== claims.company_id,
      )
    )
      throw forbidden(
        "Current Native human, internal draft Task, worker attempt and manifest required",
      );
    const [task] = await tx
      .select()
      .from(issues)
      .where(
        and(
          eq(issues.companyId, claims.company_id),
          eq(issues.id, worker.issueId),
        ),
      );
    const [root] = await tx
      .select()
      .from(issues)
      .where(
        and(
          eq(issues.companyId, claims.company_id),
          eq(issues.id, plan.issueId),
        ),
      );
    const [agent] = await tx
      .select()
      .from(agents)
      .where(
        and(eq(agents.companyId, claims.company_id), eq(agents.id, claims.sub)),
      );
    const [company] = await tx
      .select({ status: companies.status })
      .from(companies)
      .where(eq(companies.id, claims.company_id));
    const [identity] = agent?.agentIdentityId
      ? await tx
          .select({ status: agentIdentities.status })
          .from(agentIdentities)
          .where(eq(agentIdentities.id, agent.agentIdentityId))
      : [];
    if (
      !task ||
      task.hiddenAt ||
      ["done", "cancelled"].includes(task.status) ||
      task.assigneeAgentId !== claims.sub ||
      task.executionRunId !== claims.run_id ||
      (task.checkoutRunId && task.checkoutRunId !== claims.run_id) ||
      !root ||
      root.hiddenAt ||
      ["done", "cancelled"].includes(root.status) ||
      (plan.mode === "planned_parallel" &&
        (task.parentId !== root.id || task.projectId !== root.projectId)) ||
      task.requestDepth - root.requestDepth > plan.budgets.maxDelegationDepth ||
      !agent ||
      !["idle", "running"].includes(agent.status) ||
      company?.status !== "active" ||
      identity?.status !== "active" ||
      !(await heartbeatMemoryPayloadRetained(
        tx,
        claims.company_id,
        claims.run_id,
      ))
    )
      throw forbidden("Worker execution ownership changed");
    const taskScope = {
      type: "issue" as const,
      companyId: claims.company_id,
      issueId: task.id,
      projectId: task.projectId,
      parentIssueId: task.parentId,
      assigneeAgentId: task.assigneeAgentId,
      assigneeUserId: task.assigneeUserId,
      status: task.status,
    };
    await assertV7Authorization(
      tx,
      actor,
      claims.company_id,
      "issue:mutate",
      taskScope,
    );
    await assertV7Authorization(tx, actor, claims.company_id, "issue:read", {
      type: "issue",
      companyId: claims.company_id,
      issueId: root.id,
      projectId: root.projectId,
    });
    await assertV7Authorization(
      tx,
      {
        type: "agent",
        source: "agent_jwt",
        companyId: claims.company_id,
        agentId: claims.sub,
        runId: claims.run_id,
        onBehalfOfUserId: claims.responsible_user_id,
      },
      claims.company_id,
      "issue:read",
      taskScope,
    );
    await assertAgentRunWriteAllowed(tx, claims.company_id, {
      agentId: claims.sub,
      runId: claims.run_id,
    });
    const provider = await agentProviderBindingService(tx).assertRuntime(
      claims.company_id,
      claims.sub,
    );
    const providerPin = manifest.manifest.providers.find(
      (pin) =>
        pin.companyId === claims.company_id && pin.agentId === claims.sub,
    );
    if (
      !providerPin ||
      provider.runtime.providerBindingId !== p.providerBindingId ||
      provider.provider.capabilitySnapshotHash !== p.providerSnapshotHash ||
      provider.runtime.conformanceSnapshotHash !== p.providerSnapshotHash ||
      provider.runtime.qualifiedConfigurationHash !==
        p.qualifiedConfigurationHash ||
      provider.runtime.providerProfileRef !== p.providerProfileRef ||
      providerPin.providerBindingId !== p.providerBindingId ||
      providerPin.snapshotHash !== p.providerSnapshotHash ||
      providerPin.profileRef !== p.providerProfileRef
    )
      throw forbidden(
        "Worker provider qualification or immutable manifest pin changed",
      );
    // No existing managed cell is converted to a text-only qualification.
    // Its model boundary must be integrated with physical workload admission.
    if (provider.runtime.providerProfileRef.startsWith("aw:cell:"))
      throw forbidden(
        "Managed sandbox model calls require the physical workload broker",
      );
    const selection = await aiConnectionService(tx).select({
      companyId: claims.company_id,
      userId: claims.responsible_user_id,
      agentId: claims.sub,
      adapterType: "claude_local",
      binding: p.binding,
      model: p.tariff.model,
    });
    if (selection.attribution.method !== "api_key")
      throw forbidden("Only a current installed API-key grant is supported");
    const ref = selection.grant.credentialSecretRefs.find(
      (r) => r.configPath === "ai.credential",
    );
    const [secret] = ref
      ? await tx
          .select()
          .from(companySecrets)
          .where(
            and(
              eq(companySecrets.companyId, claims.company_id),
              eq(companySecrets.id, ref.secretId),
            ),
          )
      : [];
    const [version] = secret
      ? await tx
          .select()
          .from(companySecretVersions)
          .where(
            and(
              eq(companySecretVersions.secretId, secret.id),
              eq(companySecretVersions.version, secret.latestVersion),
            ),
          )
      : [];
    if (
      !secret ||
      secret.status !== "active" ||
      !version ||
      version.revokedAt ||
      ["disabled", "destroyed"].includes(version.status)
    )
      throw forbidden("Worker provider credential is no longer current");
    const memberships = await tx
      .select()
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.companyId, claims.company_id),
          eq(companyMemberships.principalId, claims.responsible_user_id),
          eq(companyMemberships.principalType, "user"),
        ),
      )
      .orderBy(companyMemberships.id);
    const grants = await tx
      .select()
      .from(principalPermissionGrants)
      .where(
        and(
          eq(principalPermissionGrants.companyId, claims.company_id),
          or(
            and(
              eq(principalPermissionGrants.principalType, "user"),
              eq(
                principalPermissionGrants.principalId,
                claims.responsible_user_id,
              ),
            ),
            and(
              eq(principalPermissionGrants.principalType, "agent"),
              eq(principalPermissionGrants.principalId, claims.sub),
            ),
          ),
        ),
      )
      .orderBy(principalPermissionGrants.id)
      .limit(2001);
    if (grants.length > 2000)
      throw forbidden("Worker authority exceeds the bounded grant envelope");
    const authorityHash = nativeSha256(
      JSON.parse(
        JSON.stringify({
          profile: p,
          binding: b,
          companyId: claims.company_id,
          runId: run.id,
          userId: claims.responsible_user_id,
          manifest: manifest.hash,
          manifestPolicy: manifest.policySnapshotHash,
          task: {
            id: task.id,
            title: task.title,
            description: task.description,
            updatedAt: task.updatedAt,
            projectId: task.projectId,
            parentId: task.parentId,
            assigneeAgentId: task.assigneeAgentId,
            assigneeUserId: task.assigneeUserId,
            status: task.status,
            executionRunId: task.executionRunId,
          },
          root: {
            id: root.id,
            title: root.title,
            description: root.description,
            updatedAt: root.updatedAt,
            projectId: root.projectId,
            parentId: root.parentId,
            status: root.status,
          },
          agent: {
            identity: agent.agentIdentityId,
            permissions: agent.permissions,
            adapter: agent.adapterType,
            config: agent.adapterConfig,
            runtime: agent.runtimeConfig,
          },
          provider: {
            id: provider.provider.id,
            snapshot: provider.provider.capabilitySnapshotHash,
            profile: provider.runtime.providerProfileRef,
            configuration: provider.runtime.qualifiedConfigurationHash,
          },
          memberships,
          grants,
          connection: {
            id: selection.connection.id,
            config: selection.connection.config,
            updatedAt: selection.connection.updatedAt,
          },
          grant: {
            id: selection.grant.id,
            updatedAt: selection.grant.updatedAt,
            refs: selection.grant.credentialSecretRefs,
          },
          secret: {
            id: secret.id,
            scope: secret.scope,
            owner: secret.ownerUserId,
            versionId: version.id,
            version: version.version,
            valueSha256: version.valueSha256,
          },
        }),
      ),
    );
    return {
      actor,
      profile: p,
      plan,
      selection,
      authorityHash,
      credentialSha256: version.valueSha256,
    };
  }
  async function fence(
    companyId: string,
    planId: string,
    reasonCode = "worker_model_unsettled",
  ) {
    await withV7ActivityTransaction(db, async (tx, publications) => {
      await lockMemoryPrivacy(tx, companyId);
      const [plan] = await tx
        .select()
        .from(orchestrationPlans)
        .where(
          and(
            eq(orchestrationPlans.companyId, companyId),
            eq(orchestrationPlans.id, planId),
          ),
        )
        .for("update");
      if (
        !plan ||
        plan.erasedAt ||
        ["completed", "cancelled", "failed"].includes(plan.status)
      )
        return;
      const [paused] = await tx
        .update(orchestrationPlans)
        .set({
          status: "paused",
          version: plan.version + Number(plan.status !== "paused"),
          updatedAt: new Date(),
        })
        .where(eq(orchestrationPlans.id, plan.id))
        .returning();
      const live = await tx
        .select({ id: orchestrationWorkerAttempts.id })
        .from(orchestrationWorkerAttempts)
        .where(
          and(
            eq(orchestrationWorkerAttempts.companyId, companyId),
            eq(orchestrationWorkerAttempts.planId, planId),
            eq(orchestrationWorkerAttempts.status, "running"),
          ),
        );
      const stop = await enqueueSupervisionStop(tx, paused!, {
        actorType: "system",
        actorId: "worker-model-gateway",
        action: "ESCALATE_HUMAN",
        reasonCode,
        rationale:
          "The bounded worker model call requires accountable human resolution",
        attemptIds: live.map((a) => a.id),
      });
      await logActivity(
        tx,
        {
          companyId,
          actorType: "system",
          actorId: "worker-model-gateway",
          action: "orchestration.worker_model_fenced",
          entityType: "orchestration_plan",
          entityId: planId,
          details: { reasonCode, interventionId: stop?.id ?? null },
        },
        publications,
      );
    });
  }
  return {
    /** Private pre-start qualification. Editable provider configuration is a
     * selector; only the installed operator profile supplies prices/authority. */
    async qualifyDraft(tx: Db, input: { companyId: string; agentId: string; responsibleUserId: string }) {
      await assertV7Enabled(tx, "orchestration_v7");
      const p = profile(input.companyId, input.agentId);
      await assertV7Authorization(tx, { type: "board", source: "session", userId: input.responsibleUserId }, input.companyId, "company_scope:read");
      const [presence] = await tx.select({ agent: agents, identity: agentIdentities, company: companies }).from(agents)
        .innerJoin(agentIdentities, eq(agentIdentities.id, agents.agentIdentityId))
        .innerJoin(companies, eq(companies.id, agents.companyId))
        .where(and(eq(agents.companyId, input.companyId), eq(agents.id, input.agentId)));
      if (!presence || presence.company.status !== "active" || presence.identity.status !== "active" ||
          !["idle", "running"].includes(presence.agent.status) || presence.agent.adapterType !== "paperclip_runner" ||
          presence.agent.runtimeConfig?.aiConnection)
        throw forbidden("Internal drafts require their current native presence");
      const selected = resolvePaperclipRunnerProviderProfile(presence.agent.adapterConfig);
      if (selected.provider !== "aw_text_only" || selected.workerModelProfileId !== p.id ||
          selected.model !== p.tariff.model || selected.maxOutputTokens > p.maxOutputTokens)
        throw forbidden("The draft presence does not select its exact qualified transport");
      const provider = await agentProviderBindingService(tx).assertRuntime(input.companyId, input.agentId);
      if (provider.provider.id !== p.providerBindingId || provider.provider.capabilitySnapshotHash !== p.providerSnapshotHash ||
          provider.runtime.conformanceSnapshotHash !== p.providerSnapshotHash ||
          provider.runtime.qualifiedConfigurationHash !== p.qualifiedConfigurationHash ||
          provider.runtime.providerProfileRef !== p.providerProfileRef || provider.runtime.providerProfileRef.startsWith("aw:cell:"))
        throw forbidden("Draft provider qualification changed or requires physical workload admission");
      const selection = await aiConnectionService(tx).select({ ...input, userId: input.responsibleUserId,
        adapterType: "claude_local", binding: p.binding, model: p.tariff.model });
      const secretRef = selection.grant.credentialSecretRefs.find(ref => ref.configPath === "ai.credential");
      const [credentialVersion] = secretRef ? await tx.select({ secret: companySecrets, version: companySecretVersions }).from(companySecrets)
        .innerJoin(companySecretVersions, and(eq(companySecretVersions.secretId, companySecrets.id), eq(companySecretVersions.version, companySecrets.latestVersion)))
        .where(and(eq(companySecrets.companyId, input.companyId), eq(companySecrets.id, secretRef.secretId))) : [];
      if (selection.attribution.method !== "api_key" || !credentialVersion || credentialVersion.secret.status !== "active" ||
          credentialVersion.version.revokedAt || ["disabled", "destroyed"].includes(credentialVersion.version.status))
        throw forbidden("Draft credential grant is no longer current");
      const quote = quoteModelReservation({ tariff: p.tariff, sourceSha: options.sourceSha,
        inputTokensUpperBound: p.inputTokensUpperBound, maxOutputTokens: selected.maxOutputTokens });
      return { profileId: p.id, model: selected.model, maxOutputTokens: selected.maxOutputTokens,
        maximumEnvelopeBytes: p.maximumEnvelopeBytes, maximumMinor: quote.maximumMinor };
    },
    /** Private controller failure path. Safety fencing does not require the
     * original human still to have access or the capability still to be live. */
    async abandon(claims: RuntimeToolsTokenClaims) {
      const binding = claims.worker_model;
      if (claims.scope !== "worker_model" || !binding)
        throw forbidden("Bound worker model failure receipt required");
      const [attempt] = await db
        .select({ id: orchestrationWorkerAttempts.id })
        .from(orchestrationWorkerAttempts)
        .where(
          and(
            eq(orchestrationWorkerAttempts.companyId, claims.company_id),
            eq(orchestrationWorkerAttempts.planId, binding.planId),
            eq(orchestrationWorkerAttempts.workerId, binding.workerId),
            eq(orchestrationWorkerAttempts.id, binding.workerAttemptId),
            eq(
              orchestrationWorkerAttempts.executionManifestId,
              binding.executionManifestId,
            ),
            eq(orchestrationWorkerAttempts.agentId, claims.sub),
            eq(orchestrationWorkerAttempts.runId, claims.run_id),
          ),
        );
      if (!attempt) throw forbidden("Worker failure receipt binding changed");
      await fence(claims.company_id, binding.planId);
    },
    /** Private controller helper; there is no customer token-issuance route. */
    async issue(input: {
      companyId: string;
      agentId: string;
      runId: string;
      responsibleUserId: string;
      binding: WorkerModelBinding;
    }) {
      const binding = workerModelBindingSchema.parse(input.binding);
      const minted = createRuntimeToolsToken({
        ...input,
        workerModelBinding: binding,
        scope: "worker_model",
      });
      const claims =
        minted && verifyRuntimeToolsToken(minted.token, "worker_model");
      if (!claims?.worker_model)
        throw forbidden("Worker capability signing is unavailable");
      await current(db, claims as BoundClaims);
      return minted!;
    },
    async call(
      claims: RuntimeToolsTokenClaims,
      raw: WorkerModelCall,
      callerSignal?: AbortSignal,
    ) {
      callerSignal?.throwIfAborted();
      if (!claims.worker_model || claims.scope !== "worker_model")
        throw forbidden("Bound worker model capability required");
      const bound = claims as BoundClaims,
        input = workerModelCallSchema.parse(raw);
      const state = await current(db, bound);
      if (input.maxOutputTokens > state.profile.maxOutputTokens)
        throw forbidden(
          "Requested output exceeds the qualified worker envelope",
        );
      const request = {
        model: state.profile.tariff.model,
        system: input.system,
        evidence: input.prompt,
        maxOutputTokens: input.maxOutputTokens,
      };
      if (
        readOnlyModelEnvelopeBytes(request) > state.profile.maximumEnvelopeBytes
      )
        throw forbidden(
          "Worker input exceeds the qualified complete wire envelope",
        );
      const reservations = modelReservationService(db, {
        sourceSha: options.sourceSha,
        qualifiedTariff: async (i) =>
          i.purpose === "worker_model" &&
          i.companyId === claims.company_id &&
          i.planId === bound.worker_model.planId
            ? profile(claims.company_id, claims.sub).tariff
            : null,
        currentAuthority: async (tx) =>
          (await current(tx, bound)).authorityHash,
      });
      const reservation = await reservations
        .reserve(state.actor, {
          companyId: claims.company_id,
          planId: bound.worker_model.planId,
          workerId: bound.worker_model.workerId,
          workerAttemptId: bound.worker_model.workerAttemptId,
          expectedPlanVersion: bound.worker_model.expectedPlanVersion,
          purpose: "worker_model",
          idempotencyKey: `worker-model:${claims.run_id}:${input.callId}`,
          inputHash: nativeSha256(request),
          authorityHash: state.authorityHash,
          inputTokensUpperBound: state.profile.inputTokensUpperBound,
          maxOutputTokens: input.maxOutputTokens,
        })
        .catch(async (error) => {
          if (
            error instanceof Error &&
            error.message === "Cumulative model reservation budget exhausted"
          )
            await fence(
              claims.company_id,
              bound.worker_model.planId,
              "worker_model_budget_exhausted",
            );
          throw error;
        });
      // Never resend an ambiguous/completed model call or store its prompt/body
      // merely to replay it. A lost response needs a new reviewed continuation.
      if (reservation.status !== "reserved")
        throw conflict("Worker model call cannot be dispatched again");
      await reservations.claimForDispatch(
        state.actor,
        claims.company_id,
        reservation.id,
      );
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        Math.min(
          30000,
          reservation.expiresAt.getTime() - Date.now(),
          claims.exp * 1000 - Date.now(),
        ),
      );
      const cancel = () => controller.abort();
      callerSignal?.addEventListener("abort", cancel, { once: true });
      let checking = false;
      const assertCurrent = async () => {
        controller.signal.throwIfAborted();
        const fresh = await current(db, bound);
        if (fresh.authorityHash !== state.authorityHash)
          throw forbidden("Worker source authority changed during dispatch");
        return fresh;
      };
      const watch = setInterval(() => {
        if (checking) return;
        checking = true;
        void assertCurrent()
          .catch(cancel)
          .finally(() => {
            checking = false;
          });
      }, 1000);
      let financiallySettled = false;
      try {
        if (callerSignal?.aborted) controller.abort();
        await assertCurrent();
        const credential = await aiConnectionService(db).credential(
          state.selection,
        );
        const fresh = await assertCurrent();
        if (
          createHash("sha256").update(credential).digest("hex") !==
          fresh.credentialSha256
        )
          throw forbidden("Worker credential changed before provider dispatch");
        const result = await anthropicReadOnlyCall(
          request,
          credential,
          controller.signal,
          { fetch: options.fetch },
        );
        await assertCurrent();
        if (
          result.usage.inputTokens > reservation.quote.inputTokensUpperBound ||
          result.text.length > 256000
        )
          throw conflict(
            "The qualified worker inference envelope was exceeded",
          );
        const outcome = await reservations.recordOutcome(
          claims.company_id,
          reservation.id,
          {
            status: "completed",
            providerResponseHash: nativeSha256(result),
            usage: result.usage,
          },
        );
        financiallySettled = true;
        if (outcome.status !== "completed")
          throw conflict("Worker model charge could not be confirmed");
        await assertCurrent();
        return workerModelResultSchema.parse({
          reservationId: reservation.id,
          ...result,
        });
      } catch {
        if (!financiallySettled)
          await reservations
            .recordOutcome(claims.company_id, reservation.id, {
              status: "unknown",
              providerResponseHash: null,
              usage: null,
            })
            .catch(() => {});
        await fence(claims.company_id, bound.worker_model.planId);
        throw conflict("Worker model result requires human resolution", {
          code: "worker_model_unsettled",
        });
      } finally {
        clearTimeout(timeout);
        clearInterval(watch);
        callerSignal?.removeEventListener("abort", cancel);
      }
    },
  };
}
