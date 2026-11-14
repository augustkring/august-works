import { and, desc, eq, or, sql } from "drizzle-orm";
import { agentConfigRevisions, agentConfigurationDrafts, agentConfigurationRuntimeCandidates, agentRuntimeCandidateConformanceRequests,
  agentConfigurationTests, agentModelMigrationMonitorReceipts,
  agents, companies, heartbeatRuns, verificationRuns, type Db } from "@paperclipai/db";
import { agentModelMigrationMonitorCommandSchema, agentModelMigrationMonitorReceiptSchema,
  agentModelMigrationMonitorReviewSchema, authoredAgentDefinitionSchema, AUTHORED_AGENT_DEFINITION_KEY,
  type AgentModelMigrationMonitorCommand, type AgentModelMigrationMonitorReview } from "@paperclipai/shared";
import type { AuthorizationActor } from "../authorization.js";
import { assertV5Authorization, v5HumanActorId } from "../v5-authorization.js";
import { agentAuthoringService } from "./authoring-drafts.js";
import { agentAuthoringTestService } from "./authoring-tests.js";
import { installedNativeDraftGateway } from "../orchestration/native-draft-runtime.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { modelLifecycleHash, modelRoutingSnapshotHash } from "./model-routing-snapshots.js";
import { withV7ActivityTransaction, logActivity } from "../v7-mutations.js";
import { conflict, notFound } from "../../errors.js";

type TestEvidence = AgentModelMigrationMonitorReview["tests"][number];

/** Durable post-publication checkpoint for a one-Agent model migration.
 * It reuses AgentAuthoring's saved scenario, provider and independent review
 * owners; the receipt records hashes and Native IDs only. */
export function agentAuthoringModelMigrationMonitorService(db: Db) {
  async function currentReview(tx: Db, actor: AuthorizationActor, companyId: string, draftId: string,
    migrationRevisionId: string): Promise<AgentModelMigrationMonitorReview> {
    const userId = v5HumanActorId(actor);
    const currentActor = { ...actor, ignoreInstanceAdmin: true, isInstanceAdmin: false };
    await agentAuthoringService(tx).get(currentActor, companyId, draftId);
    const [draft] = await tx.select().from(agentConfigurationDrafts).where(and(eq(agentConfigurationDrafts.companyId, companyId),
      eq(agentConfigurationDrafts.id, draftId), eq(agentConfigurationDrafts.createdByUserId, userId)));
    const agentId = draft?.agentId ?? draft?.preparedAgentId;
    if (!draft || !agentId || !draft.content || draft.status !== "draft") throw notFound("Current authored Agent draft is unavailable");
    const [agent] = await tx.select().from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, agentId)));
    if (!agent) throw notFound("Current authored Agent is unavailable");
    await assertV5Authorization(tx, currentActor, companyId, "agents:configure", { type: "agent", companyId, agentId });
    await assertV5Authorization(tx, currentActor, companyId, "agent:wake", { type: "agent", companyId, agentId });
    const [migration] = await tx.select().from(agentConfigRevisions).where(and(eq(agentConfigRevisions.companyId, companyId),
      eq(agentConfigRevisions.agentId, agentId), eq(agentConfigRevisions.id, migrationRevisionId), eq(agentConfigRevisions.source, "agent_authoring_publish")));
    if (!migration) throw notFound("Published model migration is unavailable");
    const rawDefinition = (migration.afterConfig.runtimeConfig as Record<string, unknown> | undefined)?.[AUTHORED_AGENT_DEFINITION_KEY];
    const parsed = authoredAgentDefinitionSchema.safeParse(rawDefinition);
    const migrationDefinition = parsed.success ? parsed.data : null;
    const modelMigration = migrationDefinition?.publication?.modelMigration;
    const modelRuntime = migrationDefinition?.publication?.modelRuntime;
    if (!migrationDefinition?.publication || migrationDefinition.version === undefined || !modelMigration ||
      !["migration", "rollback"].includes(modelMigration.action) || !modelRuntime)
      throw conflict("This publication has no qualified model-migration stage to monitor");
    const activeDefinition = (agent.runtimeConfig as Record<string, unknown> | null)?.[AUTHORED_AGENT_DEFINITION_KEY];
    const active = authoredAgentDefinitionSchema.safeParse(activeDefinition);
    const blockers: string[] = [];
    if (!active.success || active.data.revisionId !== migration.id || active.data.version !== migrationDefinition.version)
      blockers.push("migration_version_is_not_current");
    const candidateProfileHash = modelMigration.candidate.profileHash;
    const candidateConfigurationHash = modelMigration.candidate.configurationHash;
    const targetLifecycleHash = modelRuntime.lifecycleHash;
    const tests: TestEvidence[] = [];
    if (modelRuntime.profileHash !== candidateProfileHash)
      blockers.push("published_model_migration_profile_pins_are_inconsistent");
    const currentDraftReview = await agentAuthoringService(tx).reviewContent(currentActor, companyId, draftId);
    if (!currentDraftReview.baselineCurrent) blockers.push("monitor_requires_a_fresh_draft_from_the_current_published_agent");
    // Runtime-candidate selectors are draft-local and intentionally omitted
    // when the canonical draft creator copies a published version forward.
    const { runtimeCandidateId: _publishedCandidate, ...publishedContent } = migrationDefinition.content;
    if (nativeSha256(draft.content) !== nativeSha256(publishedContent))
      blockers.push("monitor_draft_does_not_match_published_migration_content");
    if (migrationDefinition.publication.requestedByUserId !== userId)
      blockers.push("monitor_requires_the_publishing_human");
    if (modelRoutingSnapshotHash(agent) !== modelRuntime.adapterConfigurationHash)
      blockers.push("published_model_routing_changed");
    // The candidate was selected in the original publication draft. Its exact
    // immutable qualification receipt remains the authority for the new,
    // current-baseline monitoring draft, which intentionally has no old
    // runtimeCandidateId selector.
    const [publicationDraft] = await tx.select().from(agentConfigurationDrafts).where(and(
      eq(agentConfigurationDrafts.companyId, companyId),
      eq(agentConfigurationDrafts.id, migrationDefinition.publication.draftId),
      eq(agentConfigurationDrafts.createdByUserId, migrationDefinition.publication.requestedByUserId),
      or(eq(agentConfigurationDrafts.agentId, agentId), eq(agentConfigurationDrafts.preparedAgentId, agentId))));
    const publicationCandidateId = publicationDraft?.content?.runtimeCandidateId;
    const [publicationCandidate] = publicationCandidateId ? await tx.select().from(agentConfigurationRuntimeCandidates).where(and(
      eq(agentConfigurationRuntimeCandidates.companyId, companyId),
      eq(agentConfigurationRuntimeCandidates.draftId, migrationDefinition.publication.draftId),
      eq(agentConfigurationRuntimeCandidates.id, publicationCandidateId),
      eq(agentConfigurationRuntimeCandidates.agentId, agentId),
      eq(agentConfigurationRuntimeCandidates.createdByUserId, migrationDefinition.publication.requestedByUserId),
      eq(agentConfigurationRuntimeCandidates.status, "qualified"),
      eq(agentConfigurationRuntimeCandidates.qualificationRequestId, modelMigration.candidate.conformanceRequestId))).for("share") : [];
    const [publicationConformance] = publicationCandidate ? await tx.select().from(agentRuntimeCandidateConformanceRequests).where(and(
      eq(agentRuntimeCandidateConformanceRequests.companyId, companyId),
      eq(agentRuntimeCandidateConformanceRequests.candidateId, publicationCandidate.id),
      eq(agentRuntimeCandidateConformanceRequests.id, modelMigration.candidate.conformanceRequestId),
      eq(agentRuntimeCandidateConformanceRequests.createdByUserId, migrationDefinition.publication.requestedByUserId),
      eq(agentRuntimeCandidateConformanceRequests.status, "qualified"))).for("share") : [];
    if (!publicationDraft || !publicationCandidate || !publicationConformance?.evidence || !publicationConformance.finishedAt ||
      publicationCandidate.profileHash !== candidateProfileHash || publicationCandidate.configurationHash !== candidateConfigurationHash ||
      nativeSha256(publicationConformance.evidence) !== modelMigration.candidate.conformanceEvidenceHash)
      blockers.push("original_model_candidate_qualification_changed");
    // Keep the live test evidence reads on the caller's transaction. In
    // particular, `record()` owns the exclusive memory-privacy advisory lock;
    // opening a root transaction here would wait for the shared lock taken by
    // verification packet reads while the root transaction waits for this
    // projection to return.
    const testViews = await agentAuthoringTestService(db).listInTransaction(tx, currentActor, companyId, draftId);
    if (!blockers.length) for (let scenarioIndex = 0; scenarioIndex < draft.content.scenarios.length; scenarioIndex++) {
      const view = testViews.filter(value => value.scenarioIndex === scenarioIndex && Date.parse(value.createdAt) > migration.createdAt.getTime())
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
      if (!view) { blockers.push("test_must_run_after_model_publication"); continue; }
      if (view.execution === "running") { blockers.push("post_publication_test_is_still_running"); continue; }
      const [test] = await tx.select().from(agentConfigurationTests).where(and(eq(agentConfigurationTests.companyId, companyId),
        eq(agentConfigurationTests.draftId, draftId), eq(agentConfigurationTests.id, view.id), eq(agentConfigurationTests.createdByUserId, userId)));
      if (!test || !view.candidateCurrent || !view.runtimeCurrent || !view.resultCurrent) {
        blockers.push("post_publication_test_must_match_current_candidate_and_runtime"); continue;
      }
        const qualified = await installedNativeDraftGateway(db).qualifyAuthoringTest(tx, { companyId, draftId,
          responsibleUserId: userId, scenarioIndex: test.scenarioIndex, retainedTestId: test.id });
        if (nativeSha256(qualified.p) !== candidateProfileHash || modelLifecycleHash(qualified.p) !== targetLifecycleHash ||
          qualified.provider.runtime.qualifiedConfigurationHash !== candidateConfigurationHash ||
          qualified.provider.runtime.conformanceSnapshotHash !== qualified.p.providerSnapshotHash ||
          qualified.provider.runtime.providerProfileRef !== qualified.p.providerProfileRef) {
          blockers.push("current_candidate_does_not_match_published_model_migration"); continue;
        }
      const [run] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId),
          eq(heartbeatRuns.agentId, agentId), eq(heartbeatRuns.id, test.runId)));
      const execution = run?.status === "succeeded" ? "succeeded"
        : run?.status === "failed" ? "failed"
        : run?.status === "cancelled" ? "cancelled"
        : null;
        const [verification] = await tx.select().from(verificationRuns).where(and(eq(verificationRuns.companyId, companyId),
          eq(verificationRuns.planId, test.planId))).orderBy(desc(verificationRuns.createdAt), desc(verificationRuns.id)).limit(1);
        const outputHash = typeof run?.resultJson?.outputHash === "string" && /^[a-f0-9]{64}$/.test(run.resultJson.outputHash)
          ? run.resultJson.outputHash : null;
      if (!run || !execution || view.execution !== execution || !run.startedAt || run.startedAt <= migration.createdAt || !verification ||
          verification.reviewerType !== "human" || !["pass", "fail", "inconclusive", "needs_human"].includes(verification.result) || verification.erasedAt ||
          verification.createdAt <= migration.createdAt || !verification.resultHash || !outputHash) {
        blockers.push("post_publication_test_needs_current_independent_review"); continue;
      }
      tests.push({ testId: test.id, runId: run.id, scenarioIndex: test.scenarioIndex, testCreatedAt: test.createdAt.toISOString(),
          runStartedAt: run.startedAt.toISOString(), verificationId: verification.id, verificationCreatedAt: verification.createdAt.toISOString(),
          execution, verificationResult: verification.result, testQualified: view.testQualified,
          outputHash, resultHash: verification.resultHash });
    }
    const uniqueBlockers = [...new Set(blockers)].slice(0, 20);
    const orderedTests = tests.sort((a, b) => a.scenarioIndex - b.scenarioIndex);
    const evidence = { companyId, draftId, agentId, migrationRevisionId, publishedVersion: migrationDefinition.version,
      publishedAt: migration.createdAt.toISOString(), targetProfileHash: candidateProfileHash,
      targetConfigurationHash: candidateConfigurationHash, targetLifecycleHash, canRecord: uniqueBlockers.length === 0 && tests.length > 0,
      blockers: uniqueBlockers, tests: orderedTests,
      recommendation: orderedTests.length > 0 && orderedTests.every(test => test.testQualified) ? "healthy" as const : "hold" as const };
    return agentModelMigrationMonitorReviewSchema.parse({ ...evidence, reviewHash: nativeSha256(evidence) });
  }

  function receipt(row: typeof agentModelMigrationMonitorReceipts.$inferSelect) {
    return agentModelMigrationMonitorReceiptSchema.parse({ companyId: row.companyId, draftId: row.draftId, agentId: row.agentId,
      migrationRevisionId: row.migrationRevisionId, publishedVersion: row.publishedVersion,
      publishedAt: row.publishedAt.toISOString(),
      targetProfileHash: row.targetProfileHash, targetConfigurationHash: row.targetConfigurationHash,
      targetLifecycleHash: row.targetLifecycleHash, canRecord: true, blockers: [], tests: row.evidence,
      recommendation: row.decision, reviewHash: row.reviewHash, requestId: row.requestId, reviewedByUserId: row.reviewedByUserId,
      recordedAt: row.createdAt.toISOString(), decision: row.decision });
  }

  return {
    current: async (actor: AuthorizationActor, companyId: string, draftId: string): Promise<AgentModelMigrationMonitorReview | null> => {
      const currentActor = { ...actor, ignoreInstanceAdmin: true, isInstanceAdmin: false };
      const draft = await agentAuthoringService(db).get(currentActor, companyId, draftId);
      const agentId = draft.agentId ?? draft.preparation?.agentId;
      if (!agentId) return null;
      const [agent] = await db.select().from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, agentId)));
      if (!agent) return null;
      const active = authoredAgentDefinitionSchema.safeParse((agent.runtimeConfig as Record<string, unknown> | null)?.[AUTHORED_AGENT_DEFINITION_KEY]);
      if (!active.success || !active.data.publication?.modelMigration || !active.data.version) return null;
      return db.transaction(async raw => currentReview(raw as unknown as Db, currentActor, companyId, draftId, active.data.revisionId));
    },
    review: async (actor: AuthorizationActor, companyId: string, draftId: string, migrationRevisionId: string) =>
      db.transaction(async raw => currentReview(raw as unknown as Db, actor, companyId, draftId, migrationRevisionId)),
    receipt: async (actor: AuthorizationActor, companyId: string, draftId: string, migrationRevisionId: string) => {
      const review = await agentAuthoringService(db).get(actor, companyId, draftId);
      const agentId = review.agentId ?? review.preparation?.agentId;
      if (!agentId) return null;
      const [saved] = await db.select().from(agentModelMigrationMonitorReceipts).where(and(eq(agentModelMigrationMonitorReceipts.companyId, companyId),
        eq(agentModelMigrationMonitorReceipts.agentId, agentId), eq(agentModelMigrationMonitorReceipts.draftId, draftId),
        eq(agentModelMigrationMonitorReceipts.migrationRevisionId, migrationRevisionId)))
        .orderBy(desc(agentModelMigrationMonitorReceipts.createdAt), desc(agentModelMigrationMonitorReceipts.id)).limit(1);
      if (!saved) return null;
      // A receipt remains historical. Currentness is separately reported by the review route.
      return receipt(saved);
    },
    record: async (actor: AuthorizationActor, companyId: string, draftId: string, migrationRevisionId: string, raw: unknown) => {
      const input: AgentModelMigrationMonitorCommand = agentModelMigrationMonitorCommandSchema.parse(raw);
      const userId = v5HumanActorId(actor), requestHash = nativeSha256({ companyId, draftId, migrationRevisionId, userId, input });
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await lockMemoryPrivacy(tx, companyId);
        await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).for("update");
        // Replays disclose retained evidence too. Revalidate the current
        // Human and draft authority before looking up a prior command.
        const currentActor = { ...actor, ignoreInstanceAdmin: true, isInstanceAdmin: false };
        await agentAuthoringService(tx).get(currentActor, companyId, draftId);
        const identity = `agent-model-migration-monitor:${companyId}:${userId}:${input.requestId}`;
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${identity}, 0))`);
        const [existing] = await tx.select().from(agentModelMigrationMonitorReceipts).where(and(
          eq(agentModelMigrationMonitorReceipts.companyId, companyId), eq(agentModelMigrationMonitorReceipts.reviewedByUserId, userId),
          eq(agentModelMigrationMonitorReceipts.requestId, input.requestId)));
        if (existing) {
          if (existing.requestHash !== requestHash || existing.migrationRevisionId !== migrationRevisionId || existing.draftId !== draftId)
            throw conflict("Monitoring request identity has different content or scope");
          return receipt(existing);
        }
        const [draft] = await tx.select().from(agentConfigurationDrafts).where(and(eq(agentConfigurationDrafts.companyId, companyId),
          eq(agentConfigurationDrafts.id, draftId), eq(agentConfigurationDrafts.createdByUserId, userId))).for("update");
        const agentId = draft?.agentId ?? draft?.preparedAgentId;
        if (!agentId) throw notFound("Current authored Agent draft is unavailable");
        const [lockedAgent] = await tx.select({ id: agents.id }).from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, agentId))).for("update");
        if (!lockedAgent) throw notFound("Current authored Agent is unavailable");
        const review = await currentReview(tx, currentActor, companyId, draftId, migrationRevisionId);
        if (!review.canRecord || review.reviewHash !== input.expectedReviewHash)
          throw conflict("The current post-publication model evidence changed or is incomplete", { blockers: review.blockers });
        const [saved] = await tx.insert(agentModelMigrationMonitorReceipts).values({ companyId, agentId: review.agentId,
          migrationRevisionId, draftId, reviewedByUserId: userId, requestId: input.requestId, requestHash,
          reviewHash: review.reviewHash, publishedVersion: review.publishedVersion, publishedAt: new Date(review.publishedAt), targetProfileHash: review.targetProfileHash,
          targetConfigurationHash: review.targetConfigurationHash, targetLifecycleHash: review.targetLifecycleHash,
          evidence: review.tests, decision: review.recommendation }).returning();
        if (!saved) throw conflict("Model migration monitoring receipt was not recorded");
        await logActivity(tx, { companyId, actorType: "user", actorId: userId, action: "agent_configuration.model_migration_monitored",
          entityType: "agent", entityId: review.agentId, details: { migrationRevisionId, publishedVersion: review.publishedVersion,
            reviewHash: review.reviewHash, testCount: review.tests.length, decision: review.recommendation } }, publications);
        return receipt(saved);
      });
    },
  };
}
