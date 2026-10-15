import { agentProviderBindingService } from "../agent-provider-bindings.js";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { agentConfigRevisions, agentConfigurationTests, agentPackageVersions, companyMemberships, agents, companies, companyAgentPackageInstallations, heartbeatRuns, type Db } from "@paperclipai/db";
import { AUTHORED_AGENT_DEFINITION_KEY, agentDraftPublicationCommandSchema, agentDraftPublicationReviewSchema,
  agentDraftPublicationReceiptSchema, authoredAgentMappingBlockers, authoredAgentDefinitionSchema,
  type AgentDraftPublicationReview } from "@paperclipai/shared";
import type { AuthorizationActor } from "../authorization.js";
import { assertV5Authorization, v5HumanActorId } from "../v5-authorization.js";
import { agentAuthoringService } from "./authoring-drafts.js";
import { agentAuthoringTestService } from "./authoring-tests.js";
import { authoringCandidateHash } from "./authoring-test-candidate.js";
import { compileAuthoredAgentDefinition, readAuthoredAgentDefinition } from "./authored-definition.js";
import { resolveAuthoringProcedures } from "./authoring-procedures.js";
import { installedNativeDraftGateway } from "../orchestration/native-draft-runtime.js";
import { agentService } from "../agents.js";
import { budgetService } from "../budgets.js";
import { agentPackageService } from "../agent-packages/package-service.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { withV7ActivityTransaction, logActivity } from "../v7-mutations.js";
import { conflict, forbidden, HttpError, notFound } from "../../errors.js";

/** A C3 publication swaps one identified, tested configuration through the
 * Original Agent/revision owners. It does not provision runtimes, grant rights,
 * make a model call, queue work or substitute mutable instruction files. */
export function agentAuthoringPublicationService(db: Db) {
  async function locks(tx: Db, companyId: string) {
    await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
    const [company] = await tx.select({ status: companies.status }).from(companies).where(eq(companies.id, companyId)).for("update");
    if (company?.status !== "active") throw forbidden("Publication requires the current active company");
  }
  async function decision(tx: Db, actor: AuthorizationActor, companyId: string, draftId: string) {
    const drafts = agentAuthoringService(tx), row = await drafts.publicationCandidate(actor, companyId, draftId);
    if (row.status !== "draft" || !row.content) throw conflict("The saved candidate is unavailable");
    const agentId = row.agentId ?? row.preparedAgentId;
    if (!agentId) throw conflict("Prepare this candidate's own inactive Agent before publication");
    const [agent] = await tx.select().from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, agentId))).for("update");
    if (!agent) throw notFound("Publication Agent is unavailable");
    const prior = await readAuthoredAgentDefinition(tx, agent);
    const base = await drafts.reviewContent(actor, companyId, draftId);
    const blockers: AgentDraftPublicationReview["blockers"] = base.blockers
      .filter(blocker => !["representative_test_unqualified", "native_promotion_unqualified"].includes(blocker.code))
      .map(({ code, message }) => ({ code, message }));
    const block = (code: string, message: string) => blockers.push({ code, message });
    let packageInstallation: typeof companyAgentPackageInstallations.$inferSelect | null = null;
    if (row.kind === "hire") {
      const [installed] = await tx.select().from(companyAgentPackageInstallations).where(and(
        eq(companyAgentPackageInstallations.companyId, companyId), eq(companyAgentPackageInstallations.agentId, agentId),
        eq(companyAgentPackageInstallations.installedVersionId, row.packageVersionId!))).for("update");
      if (installed) {
        await agentPackageService(tx).get({ ...actor, ignoreInstanceAdmin: true }, companyId, installed.id);
        packageInstallation = installed;
      }
      const [current] = installed ? await tx.execute<{ current: boolean }>(sql`select aw_v7_package_installation_current(i) as current
        from company_agent_package_installations i where company_id=${companyId}::uuid and id=${installed.id}::uuid`) : [];
      if (!current?.current) block("hire_package_activation_required", "Review the selected package's purpose, readiness and activation through its Original controls");
    }
    if (!base.baselineCurrent) block("publication_baseline_changed", "Start a fresh draft from the current active version");
    if (!["idle", "paused"].includes(agent.status) || agent.status === "paused" && agent.pauseReason !== "manual")
      block("publication_agent_not_ready", "Resolve approval, budget, error or suspension through the Agent's existing controls");
    const [running] = await tx.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId),
      eq(heartbeatRuns.agentId, agentId), inArray(heartbeatRuns.status, ["queued", "scheduled_retry", "running"]))).for("share").limit(1);
    if (running) block("publication_work_in_flight", "Let existing work settle before replacing its active version");
    const mappingBlockers = authoredAgentMappingBlockers(row.content);
    for (const code of mappingBlockers) block(code, "This behavior needs its canonical runtime mapping before publication");
    const [guard] = await tx.execute<{ present: boolean }>(sql`select to_regprocedure('aw_agent_authored_version_current()') is not null as present`);
    if (!guard?.present) block("publication_native_guards_missing", "Apply the canonical version safeguards before publication");
    const qualified = await agentAuthoringTestService(db).readinessInTransaction(tx, actor, companyId, draftId, row.version);
    if (!qualified) block("representative_test_unqualified", "Every saved scenario needs current successful execution and independent human verification");
    let current: Awaited<ReturnType<ReturnType<typeof installedNativeDraftGateway>["qualifyAuthoringTest"]>> | null = null;
    let procedures: Awaited<ReturnType<typeof resolveAuthoringProcedures>> | null = null;
    try {
      procedures = await resolveAuthoringProcedures(tx, { companyId, agentId, responsibleUserId: row.createdByUserId, knowledgeContent: row.content });
      if (!mappingBlockers.length) compileAuthoredAgentDefinition(row.content, "00000000-0000-4000-8000-000000000000", authoringCandidateHash(row), procedures.hash);
      if (qualified) current = await installedNativeDraftGateway(db).qualifyAuthoringTest(tx, { companyId, draftId,
        responsibleUserId: row.createdByUserId, scenarioIndex: 0, retainedTestId: qualified.testIds[0]! });
      if (current) await budgetService(tx).assertAgentTestModelCeiling(companyId, agentId, current.quote.maximumMinor);
    } catch (error) {
      if (!(error instanceof HttpError) || ![403, 404, 409, 422].includes(error.status)) throw error;
      block("publication_runtime_changed", "Review the exact runtime, required procedures and remaining budget again");
    }
    await assertV5Authorization(tx, { ...actor, ignoreInstanceAdmin: true }, companyId, "agent:wake", { type: "agent", companyId, agentId });
    const values = { companyId, draftId, version: row.version, agentId,
      previousVersion: prior?.version ?? null, nextVersion: (prior?.version ?? 0) + 1,
      before: prior?.content ?? null, after: row.content, activate: true as const, canPublish: blockers.length === 0,
      blockers, requiredProcedures: procedures?.skills.map(({ name, skillId, versionId }) => ({ name, skillId, versionId })) ?? [],
      ...(procedures?.memory.length ? { selectedMemory: procedures.memory.map(({ body, ...pin }) => pin) } : {}),
      ...(procedures?.knowledge.length ? { selectedKnowledge: procedures.knowledge.map(({ body, ...pin }) => pin) } : {}),
      ...(procedures?.playbooks.length ? { requiredPlaybooks: procedures.playbooks.map(({ body, key, ...pin }) => pin) } : {}),
      maximumPerModelCallMinor: current?.quote.maximumMinor ?? null, currency: "USD" as const,
      provider: current?.p.tariff.provider ?? null, model: current?.p.tariff.model ?? null,
      runtimeBindingId: row.content.runtimeBindingId, modelCalled: false as const, authorityGranted: false as const, executionStarted: false as const };
    const reviewHash = nativeSha256({ values, candidateHash: authoringCandidateHash(row),
      baselineHash: row.baselineHash, priorRevisionId: prior?.revisionId ?? null,
      configurationHash: current?.configurationHash ?? null, stateHash: current?.authorityHash ?? null,
      procedureSnapshotHash: procedures?.hash ?? null, testIds: qualified?.testIds ?? [], packageInstallation });
    return { row, agent, prior, qualified, current, procedures, packageInstallation, review: agentDraftPublicationReviewSchema.parse({ ...values, reviewHash }) };
  }
  function receipt(companyId: string, record: typeof agentConfigRevisions.$inferSelect) {
    const definition = authoredAgentDefinitionSchema.parse((record.afterConfig.runtimeConfig as Record<string, unknown>)[AUTHORED_AGENT_DEFINITION_KEY]);
    if (!definition.publication || !definition.version) throw conflict("The exact publication receipt is unavailable");
    return agentDraftPublicationReceiptSchema.parse({ companyId, draftId: definition.publication.draftId,
      requestId: record.id, agentId: record.agentId, revisionId: record.id, publishedVersion: definition.version,
      publishedAt: record.createdAt.toISOString(), activatedAtPublication: definition.publication.activatedAtPublication,
      publishedContent: definition.content,
      ...(definition.publication.packageInstallation ? { packageInstallation: {
        installationId: definition.publication.packageInstallation.installationId, versionId: definition.publication.packageInstallation.versionId,
        key: "keyParts" in definition.publication.packageInstallation
          ? definition.publication.packageInstallation.keyParts.join(".") : definition.publication.packageInstallation.key,
        contentHash: definition.publication.packageInstallation.contentHash,
        version: definition.publication.packageInstallation.releaseVersion.join("."),
      } } : {}),
      authorityGranted: false, executionStarted: false });
  }
  return {
    reviewInTransaction: async (tx: Db, actor: AuthorizationActor, companyId: string, draftId: string) => {
      await locks(tx, companyId);
      return (await decision(tx, actor, companyId, draftId)).review;
    },
    receipt: async (actor: AuthorizationActor, companyId: string, draftId: string, requestId?: string) => {
      const draft = await agentAuthoringService(db).get(actor, companyId, draftId), userId = v5HumanActorId(actor);
      const agentId = draft.agentId ?? draft.preparation?.agentId;
      if (!agentId) return null;
      const [record] = await db.select().from(agentConfigRevisions).where(and(eq(agentConfigRevisions.companyId, companyId),
        eq(agentConfigRevisions.agentId, agentId), requestId ? eq(agentConfigRevisions.id, requestId) : undefined,
        eq(agentConfigRevisions.source, "agent_authoring_publish"),
        sql`${agentConfigRevisions.afterConfig} #>> '{runtimeConfig,agentDefinitionVersion,publication,draftId}'=${draftId}`,
        sql`${agentConfigRevisions.afterConfig} #>> '{runtimeConfig,agentDefinitionVersion,publication,requestedByUserId}'=${userId}`))
        .orderBy(desc(agentConfigRevisions.createdAt), desc(agentConfigRevisions.id)).limit(1);
      if (!record) return null;
      const definition = authoredAgentDefinitionSchema.safeParse((record.afterConfig.runtimeConfig as Record<string, unknown> | undefined)?.[AUTHORED_AGENT_DEFINITION_KEY]);
      if (!definition.success || definition.data.publication?.draftId !== draftId || definition.data.publication.requestedByUserId !== userId ||
        record.agentId !== (draft.agentId ?? draft.preparation?.agentId)) throw notFound("Publication receipt not found");
      return receipt(companyId, record);
    },
    review: (actor: AuthorizationActor, companyId: string, draftId: string) => db.transaction(async raw => {
      const tx = raw as unknown as Db; await locks(tx, companyId);
      return (await decision(tx, actor, companyId, draftId)).review;
    }),
    publish: async (actor: AuthorizationActor, companyId: string, draftId: string, raw: unknown) => {
      const input = agentDraftPublicationCommandSchema.parse(raw), userId = v5HumanActorId(actor);
      const requestHash = nativeSha256({ action: "publish_and_activate_agent_version", companyId, draftId, userId, input });
      return withV7ActivityTransaction(db, async (tx, publications) => {
        // The Original revision ID is global. Serialize only this command's
        // identity before reading its scope; never parse another tenant's body.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`agent-authoring-publication:${input.requestId}`},0))`);
        await locks(tx, companyId);
        const row = await agentAuthoringService(tx).publicationCandidate(actor, companyId, draftId);
        if (row.creationRequestId === input.requestId || row.preparationRequestId === input.requestId ||
          row.requestReceipts.some(value => value.requestId === input.requestId)) throw conflict("The request identity belongs to another draft command");
        const [testRequest] = await tx.select({ id: agentConfigurationTests.id }).from(agentConfigurationTests)
          .where(and(eq(agentConfigurationTests.companyId, companyId), eq(agentConfigurationTests.createdByUserId, userId),
            eq(agentConfigurationTests.requestId, input.requestId))).limit(1);
        if (testRequest) throw conflict("The request identity belongs to a representative test");
        const [erased] = await tx.execute<{ present: boolean }>(sql`select exists(select 1 from memory_deletion_markers
          where kind='source' and key=${`agent-authored-revision-erasure:v1:${input.requestId}`}) as present`);
        if (erased?.present) throw conflict("The publication request identity was erased", { code: "publication_request_erased" });
        const [scope] = await tx.select({ companyId: agentConfigRevisions.companyId, agentId: agentConfigRevisions.agentId,
          source: agentConfigRevisions.source, createdByUserId: agentConfigRevisions.createdByUserId }).from(agentConfigRevisions)
          .where(eq(agentConfigRevisions.id, input.requestId));
        if (scope && (scope.companyId !== companyId || scope.agentId !== (row.agentId ?? row.preparedAgentId) ||
          scope.source !== "agent_authoring_publish" || scope.createdByUserId !== userId)) throw conflict("The request identity belongs to another scope");
        const [previous] = scope ? await tx.select().from(agentConfigRevisions).where(and(eq(agentConfigRevisions.companyId, companyId),
          eq(agentConfigRevisions.agentId, scope.agentId), eq(agentConfigRevisions.id, input.requestId))) : [];
        if (previous) {
          const definition = authoredAgentDefinitionSchema.safeParse((previous.afterConfig.runtimeConfig as Record<string, unknown> | undefined)?.[AUTHORED_AGENT_DEFINITION_KEY]);
          if (previous.companyId !== companyId || previous.agentId !== (row.agentId ?? row.preparedAgentId) || previous.source !== "agent_authoring_publish" ||
            !definition.success || definition.data.publication?.draftId !== draftId || definition.data.publication.requestedByUserId !== userId ||
            definition.data.publication.requestHash !== requestHash) throw conflict("The publication request identity has different content or scope");
          return receipt(companyId, previous);
        }
        const state = await decision(tx, actor, companyId, draftId);
        if (state.row.version !== input.expectedVersion || state.review.reviewHash !== input.expectedReviewHash)
          throw conflict("The saved candidate or reviewed publication changed; review again");
        if (!state.review.canPublish || !state.current || !state.procedures || !state.qualified)
          throw conflict("Resolve every current publication blocker", { blockers: state.review.blockers });
        const [packageVersion] = state.packageInstallation ? await tx.select().from(agentPackageVersions)
          .where(eq(agentPackageVersions.id, state.packageInstallation.installedVersionId)) : [];
        const definition = compileAuthoredAgentDefinition(state.row.content!, input.requestId, state.qualified.candidateHash,
          state.procedures.hash, { version: state.review.nextVersion, provenance: { draftId, draftVersion: state.row.version,
            candidateRevision: state.row.candidateRevision, requestedByUserId: userId, reviewHash: state.review.reviewHash,
            requestHash, verifiedTestIds: state.qualified.testIds, priorRevisionId: state.prior?.revisionId ?? null, activatedAtPublication: true,
            ...(state.packageInstallation && packageVersion ? { packageInstallation: { installationId: state.packageInstallation.id,
              versionId: packageVersion.id, keyParts: state.row.packageKey!.split("."), releaseVersion: packageVersion.version.split(".") as [string, string, string],
              contentHash: packageVersion.contentHash } } : {}) } });
        await agentService(tx).update(state.agent.id, { name: state.row.content!.name, capabilities: state.row.content!.description,
          ...(state.current.runtimeCandidate ? { adapterConfig: state.current.runtimeCandidate.configuration } : {}),
          runtimeConfig: { ...state.agent.runtimeConfig, [AUTHORED_AGENT_DEFINITION_KEY]: definition }, status: "idle", pauseReason: null },
          { authoredPublication: definition, recordRevision: { id: definition.revisionId, source: "agent_authoring_publish", createdByUserId: userId } });
        if (state.current.runtimeCandidate) {
          const candidate = state.current.runtimeCandidate, bindingOwner = agentProviderBindingService(tx);
          const { hash: _snapshotHash, ...snapshot } = candidate.snapshot;
          await bindingOwner.recordDiscoveryInTransaction(tx, companyId, state.agent.id, snapshot, candidate.evidence.checks, {
            configurationHash: candidate.configurationHash, runtimeId: candidate.provider.runtime.id,
            profileRef: candidate.p.providerProfileRef, bindingId: candidate.p.providerBindingId, accountingComplete: true,
            isolationPeer: candidate.evidence.proof.isolationPeer, accountingBasis: "native_pre_spend_liability_ceiling",
            reservationIds: candidate.evidence.reservationIds,
          }, publications);
          await bindingOwner.revalidateInTransaction(tx, { ...actor, ignoreInstanceAdmin: true }, companyId, state.agent.id,
            candidate.snapshot.hash, "Publish the current independently verified saved runtime candidate", publications);
        }
        if (state.packageInstallation) {
          // The definition participates in the Original package authority hash.
          // Reassess and bind that owner to the exact new version inside this C3.
          const installed = await agentPackageService(tx).decide({ ...actor, ignoreInstanceAdmin: true }, companyId,
            state.packageInstallation.id, "activate", { expectedVersion: state.packageInstallation.version,
              reason: "Publish the independently verified Hire configuration" }, publications);
          if (installed.status !== "active") throw conflict("The Hire package activation changed; review its current readiness");
        }
        const [record] = await tx.select().from(agentConfigRevisions).where(and(eq(agentConfigRevisions.companyId, companyId), eq(agentConfigRevisions.id, input.requestId)));
        if (!record) throw conflict("The Original publication revision was not recorded");
        await logActivity(tx, { companyId, actorType: "user", actorId: userId, action: "agent_configuration.version_published",
          entityType: "agent", entityId: state.agent.id, details: { draftId, revisionId: record.id,
            publishedVersion: definition.version, activated: true, authorityGranted: false, executionStarted: false } }, publications);
        // Recheck current authority after the final write. A trigger or late
        // withdrawal must roll back this activation and its Original receipt.
        const finalDraft = await agentAuthoringService(tx).publicationCandidate(actor, companyId, draftId);
        await assertV5Authorization(tx, { ...actor, ignoreInstanceAdmin: true }, companyId, "agent:wake", { type: "agent", companyId, agentId: state.agent.id });
        const [owner] = await tx.select({ id: companyMemberships.id }).from(companyMemberships).where(and(
          eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, state.row.content!.ownerUserId!), eq(companyMemberships.status, "active")));
        await agentProviderBindingService(tx).assertRuntime(companyId, state.agent.id);
        await budgetService(tx).assertAgentTestModelCeiling(companyId, state.agent.id, state.current.quote.maximumMinor);
        const [finalAgent] = await tx.select().from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, state.agent.id)));
        if (!finalAgent || finalAgent.status !== "idle" || finalAgent.pauseReason ||
          (await readAuthoredAgentDefinition(tx, finalAgent))?.revisionId !== definition.revisionId)
          throw conflict("The published Agent's current admission changed");
        const finalProcedures = await resolveAuthoringProcedures(tx, { companyId, agentId: state.agent.id,
          responsibleUserId: userId, knowledgeContent: state.row.content! });
        if (!owner || finalDraft.version !== state.row.version || nativeSha256(finalDraft.content) !== nativeSha256(state.row.content) ||
          finalProcedures.hash !== state.procedures.hash) throw conflict("The reviewed publication authority or selected sources changed");
        return receipt(companyId, record);
      });
    },
  };
}
