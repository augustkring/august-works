import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { agentConfigurationDrafts, agentConfigurationTests, agents, companies, heartbeatRuns, issues, orchestrationPlans, orchestrationModelReservations, issueDocuments, documents, verificationRuns, type Db } from "@paperclipai/db";
import { agentDraftTestReviewSchema, agentDraftTestCommandSchema, agentDraftTestViewSchema, agentDraftTestPacketSchema, orchestrationBudgetSchema, verificationReviewSchema } from "@paperclipai/shared";
import type { AuthorizationActor } from "../authorization.js";
import { v7HumanActorId } from "../v7-authorization.js";
import { agentAuthoringService } from "./authoring-drafts.js";
import { authoringCandidateHash, representativeCompletionContract } from "./authoring-test-candidate.js";
import { retainAuthoringProcedureSources } from "./authoring-procedure-retention.js";
import { installedNativeDraftGateway } from "../orchestration/native-draft-runtime.js";
import { writeOrchestrationContract } from "../orchestration/orchestration-contracts.js";
import { verificationService } from "../supervision/verification-service.js";
import { withV7ActivityTransaction, logActivity } from "../v7-mutations.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { conflict, notFound, HttpError } from "../../errors.js";

type Test = typeof agentConfigurationTests.$inferSelect;

export function agentAuthoringTestService(db: Db) {
  async function read(tx: Db, actor: AuthorizationActor, companyId: string, draftId: string) {
    await agentAuthoringService(tx).get(actor, companyId, draftId);
    const [draft] = await tx.select().from(agentConfigurationDrafts).where(and(eq(agentConfigurationDrafts.companyId, companyId), eq(agentConfigurationDrafts.id, draftId)));
    if (!draft || draft.createdByUserId !== v7HumanActorId(actor)) throw notFound("Representative candidate not found");
    return draft;
  }
  async function decision(tx: Db, actor: AuthorizationActor, companyId: string, draftId: string, scenarioIndex: number) {
    const responsibleUserId = v7HumanActorId(actor);
    const current = await installedNativeDraftGateway(db).qualifyAuthoringTest(tx, { companyId, draftId, responsibleUserId, scenarioIndex });
    const review = { companyId, draftId, version: current.draft.version, agentId: current.agentId, scenarioIndex, scenario: current.scenario,
      runtimeBindingId: current.provider.runtime.id, configurationHash: current.configurationHash, candidateHash: current.candidateHash,
      procedureSnapshotHash: current.procedures.hash, requiredProcedures: current.procedures.skills.map(pin => ({
        skillId: pin.skillId, versionId: pin.versionId, name: pin.name, bodyHash: pin.bodyHash })),
      ...(current.procedures.memory.length ? { selectedMemory: current.procedures.memory.map(({ body, ...pin }) => pin) } : {}),
      ...(current.procedures.knowledge.length ? { selectedKnowledge: current.procedures.knowledge.map(({ body, ...pin }) => pin) } : {}),
      ...(current.procedures.playbooks.length ? { requiredPlaybooks: current.procedures.playbooks.map(({ body, key, ...pin }) => pin) } : {}),
      maximumCostMinor: current.quote.maximumMinor, currency: "USD" as const, provider: current.p.tariff.provider, model: current.p.tariff.model, transport: "server-text-only-v1" as const,
      toolsGranted: false as const, activatesAgent: false as const, companyVisibleResult: true as const };
    return { current, review: agentDraftTestReviewSchema.parse({ ...review, reviewHash: nativeSha256({ ...review, authorityHash: current.authorityHash }) }) };
  }
  async function view(tx: Db, actor: AuthorizationActor, row: Test) {
    const draft = await read(tx, actor, row.companyId, row.draftId);
    const [run] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, row.companyId), eq(heartbeatRuns.agentId, row.agentId), eq(heartbeatRuns.id, row.runId)));
    const [plan] = await tx.select().from(orchestrationPlans).where(and(eq(orchestrationPlans.companyId, row.companyId), eq(orchestrationPlans.id, row.planId)));
    if (!run || !plan || plan.erasedAt || run.responsibleUserId !== row.createdByUserId || run.contextSnapshot?.agentConfigurationTestId !== row.id)
      throw notFound("Original representative test is unavailable");
    const candidateCurrent = draft.status === "draft" && draft.candidateRevision === (row.candidateRevision ?? row.draftVersion) && authoringCandidateHash(draft) === row.candidateHash;
    let runtimeCurrent = false;
    if (candidateCurrent) {
      try {
        const current = await installedNativeDraftGateway(db).qualifyAuthoringTest(tx, { companyId: row.companyId, draftId: row.draftId,
          responsibleUserId: row.createdByUserId, scenarioIndex: row.scenarioIndex, retainedTestId: row.id });
        runtimeCurrent = current.configurationHash === row.configurationHash && current.authorityHash === row.authorityHash;
      } catch (error) { if (!(error instanceof HttpError) || ![403, 404, 409].includes(error.status)) throw error; }
    }
    const packet = await verificationService(tx).currentPacket(actor, row.companyId, row.planId);
    const [verification] = await tx.select().from(verificationRuns).where(and(eq(verificationRuns.companyId, row.companyId), eq(verificationRuns.planId, row.planId)))
      .orderBy(desc(verificationRuns.createdAt), desc(verificationRuns.id)).limit(1);
    const [output] = await tx.select({ body: documents.latestBody }).from(issueDocuments).innerJoin(documents, and(eq(documents.companyId, issueDocuments.companyId), eq(documents.id, issueDocuments.documentId)))
      .where(and(eq(issueDocuments.companyId, row.companyId), eq(issueDocuments.issueId, plan.issueId), eq(issueDocuments.key, "representative-draft")));
    const [reservation] = await tx.select().from(orchestrationModelReservations).where(and(eq(orchestrationModelReservations.companyId, row.companyId), eq(orchestrationModelReservations.planId, row.planId)))
      .orderBy(desc(orchestrationModelReservations.createdAt)).limit(1);
    const execution = run.status === "succeeded" ? "succeeded" : run.status === "cancelled" ? "cancelled" :
      run.errorCode === "agent_test_outcome_unknown" || reservation?.status === "unknown" ? "unknown" : run.status === "failed" ? "failed" : "running";
    const verificationCurrent = verification && verification.reviewerType === "human" && !verification.erasedAt && verification.resultHash === packet.resultHash && verification.completionContractHash === packet.contractHash;
    const [task] = await tx.select().from(issues).where(and(eq(issues.companyId, row.companyId), eq(issues.id, plan.issueId)));
    const scenario = draft.content?.scenarios[row.scenarioIndex]?.trim();
    const harnessCurrent = task?.harnessKind === "agent_safe_test" && !!task.hiddenAt && task.assigneeUserId === row.createdByUserId && !task.assigneeAgentId &&
      plan.mode === "single_worker" && plan.actionClass === "internal_draft" && plan.riskClass === "C0" && plan.toolActionsUsed === 0 &&
      plan.verificationMode === "independent_required" && plan.humanOversightMode === "required" && plan.budgets.maxToolActions === 0 &&
      plan.budgets.maxModelCostMinor === row.maximumCostMinor && plan.createdBy === row.createdByUserId &&
      plan.executionPrincipal?.type === "user" && plan.executionPrincipal.userId === row.createdByUserId &&
      !!scenario && scenario.length >= 10 && nativeSha256(packet.contract) === nativeSha256(representativeCompletionContract(scenario));
    const resultCurrent = harnessCurrent && packet.evidence.some(evidence => evidence.type === "task_document" &&
      evidence.sourceId === run.resultJson?.outputDocumentId && evidence.sourceVersion === run.resultJson?.outputDocumentRevisionId && evidence.hash === run.resultJson?.outputHash);
    const result = verificationCurrent ? verification.result : "not_reviewed";
    await read(tx, actor, row.companyId, row.draftId);
    return agentDraftTestViewSchema.parse({ id: row.id, companyId: row.companyId, draftId: row.draftId, version: row.draftVersion,
      requestId: row.requestId, scenarioIndex: row.scenarioIndex, scenario: packet.contract.objective, agentId: row.agentId, runId: row.runId, planId: row.planId,
      candidateCurrent, runtimeCurrent, resultCurrent, execution, verification: result,
      testQualified: candidateCurrent && runtimeCurrent && resultCurrent && execution === "succeeded" && result === "pass" && reservation?.status === "completed" && packet.deterministicFailures.length === 0,
      toolsGranted: false, activatesAgent: false, result: output?.body ?? null, maximumCostMinor: row.maximumCostMinor, currency: "USD", createdAt: row.createdAt.toISOString() });
  }
  async function exactTest(actor: AuthorizationActor, companyId: string, draftId: string, requestId: string) {
    await read(db, actor, companyId, draftId);
    const [row] = await db.select().from(agentConfigurationTests).where(and(eq(agentConfigurationTests.companyId, companyId), eq(agentConfigurationTests.draftId, draftId),
      eq(agentConfigurationTests.createdByUserId, v7HumanActorId(actor)), eq(agentConfigurationTests.requestId, requestId)));
    if (!row) throw notFound("Representative test not found");
    return row;
  }
  return {
    /** Internal read projection. The caller retains the privacy/company locks;
     * the installed model controller is still resolved through the root Db.
     * Latest evidence for every saved scenario must pass; an older success
     * cannot hide a later failed or unresolved test. This grants no authority. */
    readinessInTransaction: async (tx: Db, actor: AuthorizationActor, companyId: string, draftId: string, expectedVersion: number) => {
      const draft = await read(tx, actor, companyId, draftId);
      await tx.select({ id: agentConfigurationDrafts.id }).from(agentConfigurationDrafts)
        .where(and(eq(agentConfigurationDrafts.companyId, companyId), eq(agentConfigurationDrafts.id, draftId))).for("share");
      if (draft.status !== "draft" || draft.version !== expectedVersion || !draft.content?.scenarios.length) return null;
      const rows = await tx.selectDistinctOn([agentConfigurationTests.scenarioIndex]).from(agentConfigurationTests)
        .where(and(eq(agentConfigurationTests.companyId, companyId), eq(agentConfigurationTests.draftId, draftId),
          eq(agentConfigurationTests.createdByUserId, v7HumanActorId(actor)), eq(agentConfigurationTests.candidateHash, authoringCandidateHash(draft))))
        .orderBy(agentConfigurationTests.scenarioIndex, desc(agentConfigurationTests.createdAt), desc(agentConfigurationTests.id));
      if (rows.length !== draft.content.scenarios.length) return null;
      for (let index = 0; index < draft.content.scenarios.length; index++) {
        const row = rows.find(value => value.scenarioIndex === index);
        if (!row) return null;
        try {
          if (!(await view(tx, actor, row)).testQualified) return null;
        } catch (error) {
          // A closed Original test is missing evidence for this still-owned
          // saved candidate. Current principal/access failures remain errors.
          if (error instanceof HttpError && error.status === 404) return null;
          throw error;
        }
      }
      return { scenariosVerified: rows.length, testIds: rows.map(row => row.id),
        candidateHash: authoringCandidateHash(draft), configurationHash: rows[0]!.configurationHash };
    },
    packet: async (actor: AuthorizationActor, companyId: string, draftId: string, requestId: string) => {
      const row = await exactTest(actor, companyId, draftId, requestId);
      const value = await view(db, actor, row);
      if (value.execution !== "succeeded" || !value.resultCurrent || !value.candidateCurrent || !value.runtimeCurrent)
        throw conflict("Review requires the current candidate and its unchanged successful result");
      return agentDraftTestPacketSchema.parse(await verificationService(db).packet(actor, companyId, row.planId));
    },
    verify: async (actor: AuthorizationActor, companyId: string, draftId: string, requestId: string, raw: unknown) => {
      const row = await exactTest(actor, companyId, draftId, requestId), input = verificationReviewSchema.parse(raw);
      if (input.workerId) throw conflict("Review the exact representative result, not another worker");
      const value = await view(db, actor, row);
      if (value.execution !== "succeeded" || !value.resultCurrent || !value.candidateCurrent || !value.runtimeCurrent)
        throw conflict("Candidate, runtime or actual generated result changed before review");
      await verificationService(db).review(actor, companyId, row.planId, input);
      return view(db, actor, row);
    },
    review: (actor: AuthorizationActor, companyId: string, draftId: string, scenarioIndex: number) => db.transaction(async raw =>
      (await decision(raw as unknown as Db, actor, companyId, draftId, scenarioIndex)).review),
    get: async (actor: AuthorizationActor, companyId: string, draftId: string, requestId: string) => db.transaction(async raw => {
      const tx = raw as unknown as Db; await read(tx, actor, companyId, draftId);
      const [row] = await tx.select().from(agentConfigurationTests).where(and(eq(agentConfigurationTests.companyId, companyId), eq(agentConfigurationTests.draftId, draftId),
        eq(agentConfigurationTests.createdByUserId, v7HumanActorId(actor)), eq(agentConfigurationTests.requestId, requestId)));
      return row ? view(tx, actor, row) : null;
    }),
    list: async (actor: AuthorizationActor, companyId: string, draftId: string) => db.transaction(async raw => {
      const tx = raw as unknown as Db; await read(tx, actor, companyId, draftId);
      const rows = await tx.select().from(agentConfigurationTests).where(and(eq(agentConfigurationTests.companyId, companyId), eq(agentConfigurationTests.draftId, draftId),
        eq(agentConfigurationTests.createdByUserId, v7HumanActorId(actor)))).orderBy(desc(agentConfigurationTests.createdAt), desc(agentConfigurationTests.id)).limit(31);
      if (rows.length > 30) throw conflict("The complete test history exceeds its current review budget");
      const result = []; for (const row of rows) result.push(await view(tx, actor, row)); return result;
    }),
    start: async (actor: AuthorizationActor, companyId: string, draftId: string, raw: unknown) => {
      const input = agentDraftTestCommandSchema.parse(raw), userId = v7HumanActorId(actor), requestHash = nativeSha256({ companyId, draftId, input });
      const saved = await withV7ActivityTransaction(db, async (tx, publications) => {
        await lockMemoryPrivacy(tx, companyId);
        await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).for("update");
        const draft = await read(tx, actor, companyId, draftId);
        await tx.select().from(agentConfigurationDrafts).where(eq(agentConfigurationDrafts.id, draftId)).for("update");
        const [existing] = await tx.select().from(agentConfigurationTests).where(and(eq(agentConfigurationTests.companyId, companyId),
          eq(agentConfigurationTests.createdByUserId, userId), eq(agentConfigurationTests.requestId, input.requestId)));
        if (existing) {
          if (existing.draftId !== draftId || existing.requestHash !== requestHash) throw conflict("Test request ID has different content");
          return { row: existing, created: false };
        }
        const agentId = draft.agentId ?? draft.preparedAgentId;
        if (!agentId) throw conflict("Prepare an inactive Agent before testing");
        await tx.select().from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, agentId))).for("update");
        const { current, review } = await decision(tx, actor, companyId, draftId, input.scenarioIndex);
        if (review.version !== input.expectedVersion || review.reviewHash !== input.expectedReviewHash) throw conflict("The candidate, runtime or model ceiling changed; review again");
        const testId = randomUUID(), now = new Date();
        const [task] = await tx.insert(issues).values({ companyId, title: "Representative agent draft test", description: "Explicitly approved representative test. No tools or ordinary agent activation are granted.",
          assigneeUserId: userId, status: "in_progress", hiddenAt: now, harnessKind: "agent_safe_test" }).returning();
        const contract = await writeOrchestrationContract(tx, companyId, task!.id, representativeCompletionContract(current.scenario), userId);
        const [plan] = await tx.insert(orchestrationPlans).values({ companyId, issueId: task!.id, completionContractId: contract.id, mode: "single_worker",
          actionClass: "internal_draft", riskClass: "C0", supervisionMode: "none", verificationMode: "independent_required", humanOversightMode: "required",
          status: "paused", startedAt: now, createdBy: userId, executionPrincipal: { type: "user", userId },
          budgets: orchestrationBudgetSchema.parse({ maxModelCostMinor: current.quote.maximumMinor, maxToolActions: 0, maxWallClockSeconds: 300, maxRetries: 0, maxDelegationDepth: 0 }) }).returning();
        const [run] = await tx.insert(heartbeatRuns).values({ companyId, agentId, responsibleUserId: userId, status: "running", startedAt: now,
          invocationSource: "on_demand", triggerDetail: "agent_safe_test", contextSnapshot: { agentConfigurationTestId: testId, draftId, candidateHash: current.candidateHash,
            toolsGranted: false, activatesAgent: false } }).returning();
        const [row] = await tx.insert(agentConfigurationTests).values({ id: testId, companyId, draftId, createdByUserId: userId,
          requestId: input.requestId, requestHash, draftVersion: current.draft.version, candidateRevision: current.draft.candidateRevision, scenarioIndex: input.scenarioIndex,
          agentId, runId: run!.id, planId: plan!.id, runtimeBindingId: current.provider.runtime.id, providerBindingId: current.provider.provider.id,
          candidateHash: current.candidateHash, configurationHash: current.configurationHash, authorityHash: current.authorityHash,
          reviewHash: review.reviewHash, maximumCostMinor: review.maximumCostMinor }).returning();
        await retainAuthoringProcedureSources(tx, row!.id, current, actor);
        await logActivity(tx, { companyId, actorType: "user", actorId: userId, agentId, runId: run!.id,
          action: "agent_configuration.test_requested", entityType: "agent_configuration_test", entityId: testId,
          details: { draftId, version: current.draft.version, scenarioIndex: input.scenarioIndex, maximumCostMinor: current.quote.maximumMinor,
            companyVisibleResult: true, toolsGranted: false, activatesAgent: false } }, publications);
        return { row: row!, created: true };
      });
      if (saved.created) {
        try { await installedNativeDraftGateway(db).executeAuthoringTest(saved.row.id); }
        catch (error) {
          // Read the retained actual outcome; never automatically dispatch again.
          const [run] = await db.select({ status: heartbeatRuns.status }).from(heartbeatRuns).where(eq(heartbeatRuns.id, saved.row.runId));
          if (run?.status === "running") throw error;
        }
      }
      return db.transaction(async rawTx => view(rawTx as unknown as Db, actor, saved.row));
    },
  };
}
