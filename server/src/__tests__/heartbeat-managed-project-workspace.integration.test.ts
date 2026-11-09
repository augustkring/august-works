import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { authSessions, authUsers, createDb, documents, environmentLeases, executionWorkspaces, heartbeatRuns, issueDocuments,
  issueThreadInteractions, issues, nativeRunFinalizations, nativeRunResults, orchestrationModelReservations,
  orchestrationWorkerAttempts, runtimePolicySnapshots, runtimeSandboxBindings, statusDecisions, workAssessments } from "@paperclipai/db";
import { nativeRunInputSourceReceiptSchema } from "@paperclipai/shared";
import { parseNativeExecutionInput } from "../vendor/paperclip-runner/index.js";
import { verifyNativeCleanupRuntimeState } from "../services/execution-sandbox/run-lease-cleanup.js";
import { assertNativeWorkspaceMetadataSourcesCurrent } from "../services/native-direct-input.js";
import { issueService } from "../services/issues.js";
import { issueRoutes } from "../routes/issues.js";
import { errorHandler } from "../middleware/index.js";
import { actorMiddleware } from "../middleware/auth.js";
import express from "express";
import request from "supertest";
import { orchestrationService } from "../services/orchestration/orchestration-service.js";
import { verificationService } from "../services/supervision/verification-service.js";
import { nativeSha256 } from "../services/native-runtime/canonical.js";
import { withManagedNativeHeartbeatFixture } from "./helpers/managed-native-heartbeat-fixture.js";
import { managedNativeProjectWorkspaceFixture } from "./helpers/managed-native-project-workspace-fixture.js";
import { qualifiedOpenCodeBinary, makeFixtureTreeWritable } from "./helpers/managed-native-opencode-e2e-fixture.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof createDb>;
let home: string;
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "heartbeat-managed-project-workspace-"));
  vi.stubEnv("PAPERCLIP_HOME", home);
  database = await startEmbeddedPostgresTestDatabase("heartbeat-managed-project-workspace-");
  db = createDb(database.connectionString);
}, 60_000);
afterAll(async () => {
  await database?.cleanup();
  vi.unstubAllEnvs();
  if (home) { await makeFixtureTreeWritable(home); await rm(home, { recursive: true, force: true }); }
}, 30_000);

it("runs a real capped Project Worker in its realized worktree without changing the base repository", async () => {
  vi.stubEnv("PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS", "1");
  const projectFixture = managedNativeProjectWorkspaceFixture({ root: home });
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, {
    cwd, encoding: "utf8", timeout: 5_000, maxBuffer: 64 * 1024, stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  let baseMain: string | null = null;
  let realized: { id: string; cwd: string; branchName: string } | null = null;
  let providerSourceChecks = 0;
  await withManagedNativeHeartbeatFixture({ db, root: home, opencodeBinary: qualifiedOpenCodeBinary(), timeoutSec: 300,
    prepareNativeRuntimeContext: projectFixture.prepareNativeRuntimeContext,
    configureHeartbeat: projectFixture.configureHeartbeat,
    providerReply: ({ body, callIndex, execution }) => {
      const tools = body.tools as Array<{ name: string }>;
      const tool = (name: string) => {
        const found = tools.find(value => value.name === name || ["paperclip__", "paperclip_", "paperclip."]
          .some(prefix => value.name === `${prefix}${name}`));
        if (!found) throw new Error(`managed_project_fixture_tool_missing_${name}`);
        return found.name;
      };
      if (callIndex === 1) return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "project-worktree-write",
        name: tool("write_document"), input: { idempotencyKey: "managed-project-worktree-output", key: "result",
          title: "Project worktree result", body: "A real managed Project worktree result.", baseRevisionId: null } }] };
      if (callIndex === 2) return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "project-worktree-finish",
        name: tool("paperclip_finish"), input: { schema: "paperclip.run_result.v1", reportedWorkDisposition: "done",
          summary: "Retained the Project result without modifying the base repository.", completionClaim: {
            contractRevision: execution.completionContract.contract.revision, objectiveSatisfied: true,
            criteria: execution.completionContract.contract.criteria.map(criterion => ({ criterionId: criterion.id,
              status: "satisfied", evidenceRefs: [] })), remainingWork: [] },
          evidence: [], verification: [], attentionRequests: [], artifacts: [] } }] };
      return { stop_reason: "end_turn", content: [{ type: "text", text: "The Project result is complete." }] };
    },
    beforeProviderResponse: async ({ actor, companyId, run, manifest, reservation, request, sourceReceipt }) => {
      const selected = projectFixture.project();
      const execution = parseNativeExecutionInput(run.runnerProfileJson?.nativeExecutionInput);
      const receipt = nativeRunInputSourceReceiptSchema.parse(sourceReceipt);
      const workspaceSources = receipt.bootstrap.inputs.filter(source => source.kind === "workspace_metadata");
      expect(workspaceSources).toHaveLength(1);
      expect(workspaceSources[0]).toMatchObject({ origin: "execution_workspace", runId: run.id,
        executionWorkspaceId: execution.binding.executionWorkspaceId });
      expect(receipt.bootstrap.inputs).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "project", projectId: selected.projectId }),
        expect.objectContaining({ kind: "project_workspace", projectId: selected.projectId,
          workspaceId: selected.projectWorkspaceId }),
      ]));
      await db.transaction(tx => assertNativeWorkspaceMetadataSourcesCurrent(tx, companyId, workspaceSources));
      const [workspace] = await db.select().from(executionWorkspaces).where(and(
        eq(executionWorkspaces.companyId, companyId), eq(executionWorkspaces.id, execution.binding.executionWorkspaceId)));
      expect(workspace).toMatchObject({ projectId: selected.projectId, projectWorkspaceId: selected.projectWorkspaceId,
        sourceIssueId: run.nativeIssueId, mode: "isolated_workspace", strategyType: "git_worktree",
        cwd: execution.workspace.cwd, repoUrl: execution.workspace.repoUrl, baseRef: execution.workspace.repoRef,
        branchName: execution.workspace.branchName });
      if (!workspace?.cwd || !workspace.branchName) throw new Error("managed_project_fixture_realized_workspace_missing");
      expect(workspace.cwd).not.toBe(selected.repositoryRoot);
      expect(git(workspace.cwd, "rev-parse", "--show-toplevel")).toBe(workspace.cwd);
      expect(git(workspace.cwd, "branch", "--show-current")).toBe(workspace.branchName);
      expect(git(selected.repositoryRoot, "branch", "--show-current")).toBe("main");
      expect(git(selected.repositoryRoot, "rev-parse", "refs/heads/main")).toBe(baseMain);
      const [lease] = await db.select().from(environmentLeases).where(and(eq(environmentLeases.companyId, companyId),
        eq(environmentLeases.heartbeatRunId, run.id), eq(environmentLeases.status, "active")));
      expect(lease?.metadata?.remoteCwd).toBe(workspace.cwd);
      expect(lease?.expiresAt?.getTime()).toBeGreaterThan(Date.now());
      expect(reservation).toMatchObject({ status: "dispatched", purpose: "worker_model",
        providerWireReceipt: expect.objectContaining({ bodySha256: request.wireBodySha256 }) });
      expect(manifest.runId).toBe(run.id);
      const policies = await db.select().from(runtimePolicySnapshots).where(and(
        eq(runtimePolicySnapshots.companyId, companyId), eq(runtimePolicySnapshots.executionManifestId, manifest.id),
        eq(runtimePolicySnapshots.status, "qualified")));
      expect(policies).toHaveLength(1);
      const [binding] = await db.select().from(runtimeSandboxBindings).where(and(
        eq(runtimeSandboxBindings.companyId, companyId), eq(runtimeSandboxBindings.id, policies[0]!.bindingId)));
      expect(binding?.boundaryPolicy.filesystem.writePaths).toEqual([workspace.cwd]);
      expect(policies[0]!.compilation.compiledPolicy.filesystem.writePaths).toEqual([workspace.cwd]);
      expect(policies[0]!.compilation.compiledPolicy.filesystem.readPaths).toContain(workspace.cwd);
      expect(policies[0]!.compilation.compiledPolicy.filesystem.readPaths).not.toContain(selected.repositoryRoot);
      expect(policies[0]!.compilation.compiledPolicy.filesystem.readPaths).not.toContain(dirname(workspace.cwd));
      expect(actor.userId).toBe(run.responsibleUserId);
      if (realized) expect({ id: workspace.id, cwd: workspace.cwd, branchName: workspace.branchName }).toEqual(realized);
      realized = { id: workspace.id, cwd: workspace.cwd, branchName: workspace.branchName };
      providerSourceChecks++;
    },
    driveScheduler: async ({ actor, companyId, agentId, heartbeat, facts }) => {
      const selected = projectFixture.project();
      baseMain = git(selected.repositoryRoot, "rev-parse", "refs/heads/main");
      const task = await issueService(db).create(companyId, { projectId: selected.projectId,
        projectWorkspaceId: selected.projectWorkspaceId, title: "Managed Project worktree result", status: "todo",
        description: "Retain one result document using the Project workspace. Do not modify the base repository.",
        responsibleUserId: actor.userId!, createdByUserId: actor.userId!, assigneeAgentId: agentId },
        db, undefined, { manualInputActor: actor, privacyActor: actor, sourceAccessActor: actor });
      const plan = await orchestrationService(db).create(actor, companyId, { issueId: task.id,
        expectedIssueUpdatedAt: task.updatedAt.toISOString(), workload: "semantic", riskClass: "C0",
        completionContract: { objective: "Retain the Project result without changing the base repository",
          requiredOutputs: [{ kind: "task_document", key: "result" }],
          businessInvariants: ["The base repository main branch remains unchanged"] },
        budgets: { maxModelCostMinor: 10, maxToolActions: 3 }, workers: [{ key: "writer", issueId: task.id }] });
      expect(facts().providerCallCount).toBe(0);
      expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, companyId))).toEqual([]);
      await orchestrationService(db).decide(actor, companyId, plan.id, { expectedVersion: plan.version,
        action: "start", rationale: "Execute the actual Project-bound managed scheduler path" });
      const wake = await heartbeat.wakeup(agentId, { source: "assignment", triggerDetail: "system", reason: "issue_assigned",
        requestedByActorType: "user", requestedByActorId: actor.userId!, payload: { issueId: task.id },
        contextSnapshot: { issueId: task.id, projectId: selected.projectId } });
      expect(wake).not.toBeNull();
      await heartbeat.drainActiveRunExecutions();
      const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, wake!.id));
      expect(run).toMatchObject({ status: "succeeded", runtimeMode: "native", nativeIssueId: task.id,
        responsibleUserId: actor.userId, nativeProcessCleanupPending: false });
      const [preReviewTask] = await db.select().from(issues).where(eq(issues.id, task.id));
      expect(preReviewTask).toMatchObject({ projectId: selected.projectId,
        projectWorkspaceId: selected.projectWorkspaceId, executionWorkspaceId: realized?.id });
      expect(preReviewTask?.status).not.toBe("done");
      const [finalization] = await db.select().from(nativeRunFinalizations).where(eq(nativeRunFinalizations.runId, wake!.id));
      expect(finalization).toMatchObject({ phase: "committed", leaseOwner: null, failureCode: null });
      const [result] = await db.select().from(nativeRunResults).where(eq(nativeRunResults.id, finalization!.resultId!));
      const [assessment] = await db.select().from(workAssessments).where(eq(workAssessments.id, finalization!.assessmentId!));
      const [decision] = await db.select().from(statusDecisions).where(eq(statusDecisions.id, finalization!.decisionId!));
      expect(result).toMatchObject({ runId: wake!.id, issueId: task.id, schemaStatus: "accepted" });
      expect(assessment).toMatchObject({ runId: wake!.id, issueId: task.id, resultId: result!.id });
      expect(decision).toMatchObject({ assessmentId: assessment!.id, applicationState: "applied", toStatus: preReviewTask!.status });
      expect(preReviewTask?.lastStatusDecisionId).toBe(decision!.id);
      expect(run!.resultJson).toMatchObject({ finalizationPhase: "committed",
        assessmentId: assessment!.id, decisionId: decision!.id });
      const attempts = await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.runId, wake!.id));
      expect(attempts).toHaveLength(1);
      expect(attempts[0]).toMatchObject({ planId: plan.id, agentId, attempt: 1 });
      const reservations = await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, plan.id));
      expect(reservations.length).toBeGreaterThanOrEqual(2);
      expect(reservations.every(row => row.status === "completed" && row.purpose === "worker_model" &&
        row.workerAttemptId === attempts[0]!.id)).toBe(true);
      const outputs = await db.select({ body: documents.latestBody }).from(issueDocuments).innerJoin(documents,
        and(eq(documents.companyId, issueDocuments.companyId), eq(documents.id, issueDocuments.documentId)))
        .where(and(eq(issueDocuments.companyId, companyId), eq(issueDocuments.issueId, task.id), eq(issueDocuments.key, "result")));
      expect(outputs).toEqual([{ body: "A real managed Project worktree result." }]);
      expect(git(selected.repositoryRoot, "branch", "--show-current")).toBe("main");
      expect(git(selected.repositoryRoot, "rev-parse", "refs/heads/main")).toBe(baseMain);
      const verifier = verificationService(db);
      const packet = await verifier.packet(actor, companyId, plan.id);
      expect(packet.planId).toBe(plan.id);
      expect(packet.deterministicFailures).toEqual([]);
      expect(packet.policy.workerSelfCertification).toBe(false);
      const exactOutput = packet.evidence.filter(item => item.type === "task_document" &&
        item.hash === nativeSha256("A real managed Project worktree result."));
      expect(exactOutput).toHaveLength(1);
      const evidenceRefs = exactOutput.map(item => item.ref);
      const judgement = (_: unknown, index: number) => ({ index, satisfied: true, evidenceRefs });
      const review = await verifier.review(actor, companyId, plan.id, {
        expectedPlanVersion: packet.planVersion, expectedResultHash: packet.resultHash,
        workerId: packet.workerId, result: "pass", objectiveSatisfied: true,
        rationale: "The Human checked the exact retained Project workspace result and repository invariant.",
        businessInvariants: packet.contract.businessInvariants.map(judgement),
        evidenceRequirements: packet.contract.evidenceRequirements.map(judgement),
        prohibitedOutcomes: packet.contract.prohibitedOutcomes.map(judgement),
      });
      expect(review).toMatchObject({ reviewerType: "human", reviewerId: actor.userId, result: "pass" });
      expect(review.workerAttemptId).toBe(attempts[0]!.id);
      const [completedTask] = await db.select().from(issues).where(eq(issues.id, task.id));
      expect(completedTask).toMatchObject({ status: "done", projectId: selected.projectId,
        projectWorkspaceId: selected.projectWorkspaceId, executionWorkspaceId: realized?.id });
      const leases = await db.select().from(environmentLeases).where(and(eq(environmentLeases.companyId, companyId),
        eq(environmentLeases.heartbeatRunId, wake!.id)));
      expect(leases).toHaveLength(1);
      expect(leases[0]).toMatchObject({ status: "expired", leasePolicy: "ephemeral", cleanupStatus: "success", failureReason: "paperclip_runner_destroy_after_turn" });
      expect(leases[0]!.releasedAt).toBeInstanceOf(Date);
      expect(await verifyNativeCleanupRuntimeState(db, { companyId, runId: wake!.id, leaseId: leases[0]!.id },
        leases[0]!.metadata?.remoteExecutionTermination)).toMatchObject({ state: "stopped", runId: wake!.id });
      expect(providerSourceChecks).toBe(reservations.length);
      expect(facts().providerCallCount).toBe(reservations.length);
      expect(facts().issuerFacts).toEqual([{ scope: "worker_model", runId: wake!.id, manifestId: attempts[0]!.executionManifestId }]);
      expect(facts().sandboxRuntimeFacts?.relayAuthenticated).toBe(true);
      expect(facts().sandboxRuntimeFacts?.brokerTokenSubstitutionCount).toBe(0);
      expect(facts().sandboxRuntimeFacts?.attachedModelBrokerProviderCount).toBe(0);
      expect((facts().sandboxRuntimeFacts?.modelBrokerSessionReceipts as Array<{ phase: string }>).at(-1)?.phase).toBe("stop");
      expect(git(selected.repositoryRoot, "branch", "--show-current")).toBe("main");
      expect(git(selected.repositoryRoot, "rev-parse", "refs/heads/main")).toBe(baseMain);
    },
  });
}, 600_000);


it("accepts a real plan confirmation and executes its managed Native workspace refresh", async () => {
  vi.stubEnv("PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS", "1");
  const projectFixture = managedNativeProjectWorkspaceFixture({ root: home });
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, {
    cwd, encoding: "utf8", timeout: 5_000, maxBuffer: 64 * 1024, stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  let baseMain: string | null = null;
  let firstRunId: string | null = null;
  let fixtureCompanyId: string | null = null;
  let fixtureHumanId: string | null = null;
  let fixtureAgentId: string | null = null;
  let targetIssueId: string | null = null;
  let pendingConfirmationId: string | null = null;
  let planDocument: { id: string; revisionId: string; revisionNumber: number } | null = null;
  const providerCallsByRun = new Map<string, number>();
  const realizedByRun = new Map<string, { id: string; cwd: string; branchName: string }>();
  let providerSourceChecks = 0;
  await withManagedNativeHeartbeatFixture({ db, root: home, opencodeBinary: qualifiedOpenCodeBinary(), timeoutSec: 300,
    schedulerMode: "serial", ordinaryWorkerProject: () => projectFixture.project(),
    prepareNativeRuntimeContext: projectFixture.prepareNativeRuntimeContext,
    beforeManagedModelRequest: async ({ runId, issueId }) => {
      if (!firstRunId) firstRunId = runId;
      if (!fixtureCompanyId || !fixtureHumanId || !targetIssueId || issueId !== targetIssueId)
        throw new Error("accepted_plan_native_request_issue_binding_changed");
      if (runId !== firstRunId) {
        if (!pendingConfirmationId) throw new Error("accepted_plan_continuation_interaction_unbound");
        const [continuation] = await db.select({ agentId: heartbeatRuns.agentId, issueId: heartbeatRuns.nativeIssueId,
          responsibleUserId: heartbeatRuns.responsibleUserId, contextSnapshot: heartbeatRuns.contextSnapshot })
          .from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, fixtureCompanyId),
            eq(heartbeatRuns.id, runId))).limit(1);
        const snapshot = continuation?.contextSnapshot && typeof continuation.contextSnapshot === "object"
          ? continuation.contextSnapshot as Record<string, unknown> : {};
        if (!continuation || continuation.agentId !== fixtureAgentId || continuation.issueId !== targetIssueId ||
            continuation.responsibleUserId !== fixtureHumanId || snapshot.issueId !== targetIssueId ||
            snapshot.taskId !== targetIssueId || snapshot.interactionId !== pendingConfirmationId ||
            snapshot.sourceRunId !== firstRunId || snapshot.forceFreshSession !== true ||
            snapshot.workspaceRefreshReason !== "accepted_plan_confirmation")
          throw new Error("accepted_plan_continuation_run_binding_changed");
        return;
      }
      const [savedPlan] = await db.select({ id: documents.id, revisionId: documents.latestRevisionId,
        revisionNumber: documents.latestRevisionNumber }).from(issueDocuments).innerJoin(documents,
        and(eq(documents.companyId, issueDocuments.companyId), eq(documents.id, issueDocuments.documentId)))
        .where(and(eq(issueDocuments.companyId, fixtureCompanyId), eq(issueDocuments.issueId, targetIssueId),
          eq(issueDocuments.key, "plan"))).limit(1);
      if (savedPlan?.revisionId && savedPlan.revisionNumber)
        planDocument = { id: savedPlan.id, revisionId: savedPlan.revisionId, revisionNumber: savedPlan.revisionNumber };
      const [pending] = await db.select({ id: issueThreadInteractions.id, payload: issueThreadInteractions.payload })
        .from(issueThreadInteractions).where(and(eq(issueThreadInteractions.companyId, fixtureCompanyId),
          eq(issueThreadInteractions.issueId, targetIssueId), eq(issueThreadInteractions.sourceRunId, firstRunId),
          eq(issueThreadInteractions.kind, "request_confirmation"), eq(issueThreadInteractions.status, "pending"))).limit(1);
      if (pending) {
        pendingConfirmationId = pending.id;
        const payload = pending.payload && typeof pending.payload === "object" ? pending.payload as Record<string, unknown> : {};
        const target = payload.target && typeof payload.target === "object" ? payload.target as Record<string, unknown> : {};
        expect(target).toMatchObject({ type: "issue_document", issueId: targetIssueId,
          documentId: planDocument?.id, key: "plan", revisionId: planDocument?.revisionId,
          revisionNumber: planDocument?.revisionNumber });
      }
    },
    providerReply: ({ body, execution }) => {
      const tools = body.tools as Array<{ name: string }>;
      const tool = (name: string) => {
        const found = tools.find(value => value.name === name || ["paperclip__", "paperclip_", "paperclip."]
          .some(prefix => value.name === `${prefix}${name}`));
        if (!found) throw new Error(`managed_project_fixture_tool_missing_${name}`);
        return found.name;
      };
      const runId = execution.binding.runId;
      if (!firstRunId) firstRunId = runId;
      const callIndex = (providerCallsByRun.get(runId) ?? 0) + 1;
      providerCallsByRun.set(runId, callIndex);
      if (runId === firstRunId && callIndex === 1)
        return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "accepted-plan-write",
          name: tool("write_document"), input: { idempotencyKey: `accepted-plan:${runId}:plan`, key: "plan",
            title: "Implementation plan", body: "Use a fresh isolated workspace after this plan is accepted.", baseRevisionId: null } }] };
      if (runId === firstRunId && callIndex === 2) {
        if (!planDocument) throw new Error("accepted_plan_native_document_revision_missing_before_confirmation");
        return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "accepted-plan-request-human-input",
          name: tool("request_human_input"), input: { idempotencyKey: `accepted-plan:${runId}:confirmation`,
            interactionKind: "confirmation", title: "Review the implementation plan",
            prompt: "Accept the saved implementation plan before the next Native run?",
            continuationPolicy: "wake_assignee_on_accept", resolverPolicy: "human_only",
            payload: { version: 1, prompt: "Accept the saved implementation plan?", target: {
              type: "issue_document", issueId: execution.binding.issueId, documentId: planDocument.id,
              key: "plan", revisionId: planDocument.revisionId, revisionNumber: planDocument.revisionNumber } } } }] };
      }
      if (runId === firstRunId && callIndex === 3) {
        if (!pendingConfirmationId) throw new Error("accepted_plan_pending_native_interaction_missing_before_yield");
        const contract = execution.completionContract.contract;
        return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "accepted-plan-yield",
          name: tool("paperclip_finish"), input: { schema: "paperclip.run_result.v1", reportedWorkDisposition: "yielded",
            summary: "Waiting for the responsible Human to accept the saved plan.",
            completionClaim: { contractRevision: contract.revision, objectiveSatisfied: false,
              criteria: contract.criteria.map(criterion => ({ criterionId: criterion.id, status: "unknown", evidenceRefs: [] })),
              remainingWork: [{ description: "Wait for the Human to accept the persisted plan before continuing.", blocksCompletion: true }] },
            evidence: [], verification: [], attentionRequests: [], artifacts: [],
            continuation: { kind: "response_wake", summary: "Resume after the Human resolves the plan confirmation.",
              idempotencyKey: `interaction-response:${pendingConfirmationId}` } } }] };
      }
      if (runId !== firstRunId && callIndex === 1)
        return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "accepted-plan-finish",
          name: tool("paperclip_finish"), input: { schema: "paperclip.run_result.v1", reportedWorkDisposition: "done",
            summary: "Continued after the accepted plan in the refreshed Native workspace.", completionClaim: {
              contractRevision: execution.completionContract.contract.revision, objectiveSatisfied: true,
              criteria: execution.completionContract.contract.criteria.map(criterion => ({ criterionId: criterion.id,
                status: "satisfied", evidenceRefs: [] })), remainingWork: [] },
            evidence: [], verification: [], attentionRequests: [], artifacts: [] } }] };
      throw new Error(`accepted_plan_unexpected_provider_turn:${runId}:${callIndex}`);
    },
    beforeProviderResponse: async ({ actor, companyId, run, manifest, reservation, request, sourceReceipt }) => {
      const selected = projectFixture.project();
      const execution = parseNativeExecutionInput(run.runnerProfileJson?.nativeExecutionInput);
      const receipt = nativeRunInputSourceReceiptSchema.parse(sourceReceipt);
      const workspaceSources = receipt.bootstrap.inputs.filter(source => source.kind === "workspace_metadata");
      expect(workspaceSources).toHaveLength(1);
      expect(workspaceSources[0]).toMatchObject({ origin: "execution_workspace", runId: run.id,
        executionWorkspaceId: execution.binding.executionWorkspaceId });
      expect(receipt.bootstrap.inputs).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "project", projectId: selected.projectId }),
        expect.objectContaining({ kind: "project_workspace", projectId: selected.projectId,
          workspaceId: selected.projectWorkspaceId }),
      ]));
      await db.transaction(tx => assertNativeWorkspaceMetadataSourcesCurrent(tx, companyId, workspaceSources));
      const [workspace] = await db.select().from(executionWorkspaces).where(and(
        eq(executionWorkspaces.companyId, companyId), eq(executionWorkspaces.id, execution.binding.executionWorkspaceId)));
      expect(workspace).toMatchObject({ projectId: selected.projectId, projectWorkspaceId: selected.projectWorkspaceId,
        sourceIssueId: run.nativeIssueId, mode: "isolated_workspace", strategyType: "git_worktree",
        cwd: execution.workspace.cwd, repoUrl: execution.workspace.repoUrl, baseRef: execution.workspace.repoRef,
        branchName: execution.workspace.branchName });
      if (!workspace?.cwd || !workspace.branchName) throw new Error("managed_project_fixture_realized_workspace_missing");
      expect(workspace.cwd).not.toBe(selected.repositoryRoot);
      expect(git(workspace.cwd, "rev-parse", "--show-toplevel")).toBe(workspace.cwd);
      expect(git(workspace.cwd, "branch", "--show-current")).toBe(workspace.branchName);
      expect(git(selected.repositoryRoot, "branch", "--show-current")).toBe("main");
      expect(git(selected.repositoryRoot, "rev-parse", "refs/heads/main")).toBe(baseMain);
      const [lease] = await db.select().from(environmentLeases).where(and(eq(environmentLeases.companyId, companyId),
        eq(environmentLeases.heartbeatRunId, run.id), eq(environmentLeases.status, "active")));
      expect(lease?.metadata?.remoteCwd).toBe(workspace.cwd);
      expect(lease?.expiresAt?.getTime()).toBeGreaterThan(Date.now());
      expect(reservation).toMatchObject({ status: "dispatched", purpose: "worker_model",
        providerWireReceipt: expect.objectContaining({ bodySha256: request.wireBodySha256 }) });
      expect(manifest.runId).toBe(run.id);
      if (run.id === firstRunId) {
        expect(run.contextSnapshot).not.toMatchObject({ forceFreshSession: true,
          workspaceRefreshReason: "accepted_plan_confirmation" });
      } else {
        expect(run.contextSnapshot).toMatchObject({ forceFreshSession: true,
          workspaceRefreshReason: "accepted_plan_confirmation" });
      }
      const policies = await db.select().from(runtimePolicySnapshots).where(and(
        eq(runtimePolicySnapshots.companyId, companyId), eq(runtimePolicySnapshots.executionManifestId, manifest.id),
        eq(runtimePolicySnapshots.status, "qualified")));
      expect(policies).toHaveLength(1);
      const [binding] = await db.select().from(runtimeSandboxBindings).where(and(
        eq(runtimeSandboxBindings.companyId, companyId), eq(runtimeSandboxBindings.id, policies[0]!.bindingId)));
      expect(binding?.boundaryPolicy.filesystem.writePaths).toEqual([workspace.cwd]);
      expect(policies[0]!.compilation.compiledPolicy.filesystem.writePaths).toEqual([workspace.cwd]);
      expect(policies[0]!.compilation.compiledPolicy.filesystem.readPaths).toContain(workspace.cwd);
      expect(policies[0]!.compilation.compiledPolicy.filesystem.readPaths).not.toContain(selected.repositoryRoot);
      expect(policies[0]!.compilation.compiledPolicy.filesystem.readPaths).not.toContain(dirname(workspace.cwd));
      expect(actor.userId).toBe(run.responsibleUserId);
      const realized = { id: workspace.id, cwd: workspace.cwd, branchName: workspace.branchName };
      const priorForRun = realizedByRun.get(run.id);
      if (priorForRun) expect(realized).toEqual(priorForRun);
      else realizedByRun.set(run.id, realized);
      providerSourceChecks++;
    },
    driveScheduler: async ({ actor, companyId, agentId, heartbeat, facts, factsForRun }) => {
      const selected = projectFixture.project();
      fixtureCompanyId = companyId;
      fixtureHumanId = actor.userId!;
      fixtureAgentId = agentId;
      baseMain = git(selected.repositoryRoot, "rev-parse", "refs/heads/main");
      const task = await issueService(db).create(companyId, { projectId: selected.projectId,
        projectWorkspaceId: selected.projectWorkspaceId, title: "Managed Project worktree result", status: "todo",
        description: "Retain one result document using the Project workspace. Do not modify the base repository.",
        responsibleUserId: actor.userId!, createdByUserId: actor.userId!, assigneeAgentId: agentId },
        db, undefined, { manualInputActor: actor, privacyActor: actor, sourceAccessActor: actor });
      targetIssueId = task.id;
      const plan = await orchestrationService(db).create(actor, companyId, { issueId: task.id,
        expectedIssueUpdatedAt: task.updatedAt.toISOString(), workload: "semantic", riskClass: "C0",
        completionContract: { objective: "Save an implementation plan, obtain Human acceptance, then continue safely",
          requiredOutputs: [{ kind: "task_document", key: "plan" }],
          businessInvariants: ["The accepted plan remains attached to the Task", "The base repository main branch remains unchanged"] },
        budgets: { maxModelCostMinor: 10, maxToolActions: 6 }, workers: [{ key: "writer", issueId: task.id }] });
      expect(facts().providerCallCount).toBe(0);
      expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, companyId))).toEqual([]);
      await orchestrationService(db).decide(actor, companyId, plan.id, { expectedVersion: plan.version,
        action: "start", rationale: "Execute the actual Project-bound managed scheduler path" });

      const firstWake = await heartbeat.wakeup(agentId, { source: "assignment", triggerDetail: "system", reason: "issue_assigned",
        requestedByActorType: "user", requestedByActorId: actor.userId!, payload: { issueId: task.id },
        contextSnapshot: { issueId: task.id, projectId: selected.projectId } });
      expect(firstWake).not.toBeNull();
      await heartbeat.drainActiveRunExecutions();
      const firstRun = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, firstWake!.id)).then(rows => rows[0]);
      expect(firstRun).toMatchObject({ status: "succeeded", runtimeMode: "native", nativeIssueId: task.id });
      expect(firstRun?.resultJson).toMatchObject({ nativeResult: { schema: "paperclip.run_result.v1",
        reportedWorkDisposition: "yielded" } });
      const [firstNativeResult] = await db.select().from(nativeRunResults).where(and(
        eq(nativeRunResults.companyId, companyId), eq(nativeRunResults.runId, firstRun!.id))).limit(1);
      expect(firstNativeResult).toMatchObject({ schemaStatus: "accepted", resultJson: {
        result: { schema: "paperclip.run_result.v1", reportedWorkDisposition: "yielded" },
        terminal: { runTerminalState: "succeeded", reportedWorkDisposition: "yielded" },
      } });
      expect(planDocument).not.toBeNull();
      const [pendingConfirmation] = await db.select().from(issueThreadInteractions).where(and(
        eq(issueThreadInteractions.companyId, companyId), eq(issueThreadInteractions.issueId, task.id),
        eq(issueThreadInteractions.kind, "request_confirmation"), eq(issueThreadInteractions.status, "pending"))).limit(1);
      expect(pendingConfirmation).toBeDefined();
      pendingConfirmationId = pendingConfirmation!.id;
      expect(pendingConfirmation).toMatchObject({ sourceRunId: firstRun!.id, createdByAgentId: agentId,
        continuationPolicy: "wake_assignee_on_accept", payload: { target: expect.objectContaining({
          type: "issue_document", issueId: task.id, documentId: planDocument!.id,
          key: "plan", revisionId: planDocument!.revisionId, revisionNumber: planDocument!.revisionNumber }) } });
      const [session] = await db.select({ token: authSessions.token }).from(authSessions).where(and(
        eq(authSessions.id, actor.sessionId!), eq(authSessions.userId, actor.userId!),
        sql`${authSessions.expiresAt} > now()`)).limit(1);
      if (!session) throw new Error("accepted_plan_fixture_current_session_missing");
      const app = express(); app.use(express.json());
      app.use(actorMiddleware(db, { deploymentMode: "authenticated", resolveSession: async req => {
        const cookie = (req.header("cookie") ?? "").split(";").map(value => value.trim())
          .find(value => value.startsWith("session_token="));
        const token = cookie ? decodeURIComponent(cookie.slice("session_token=".length)) : null;
        if (!token) return null;
        const [current] = await db.select({ id: authSessions.id, userId: authSessions.userId,
          expiresAt: authSessions.expiresAt }).from(authSessions)
          .where(and(eq(authSessions.token, token), sql`${authSessions.expiresAt} > now()`)).limit(1);
        if (!current) return null;
        const [user] = await db.select({ id: authUsers.id, name: authUsers.name, email: authUsers.email })
          .from(authUsers).where(eq(authUsers.id, current.userId)).limit(1);
        return user ? { session: current, user } : null;
      } }));
      app.use("/api", issueRoutes(db, {} as never, { heartbeat })); app.use(errorHandler);
      const accepted = await request(app).post(`/api/issues/${task.id}/interactions/${pendingConfirmation!.id}/accept`)
        .set("cookie", `session_token=${encodeURIComponent(session.token)}`).send({});
      expect(accepted.status).toBe(200);
      expect(accepted.body).toMatchObject({ id: pendingConfirmation!.id, status: "accepted" });
      await vi.waitFor(async () => {
        const runs = await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(
          eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.nativeIssueId, task.id)));
        expect(runs).toHaveLength(2);
      }, { timeout: 10_000, interval: 25 });
      await heartbeat.drainActiveRunExecutions();
      const runs = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId),
        eq(heartbeatRuns.nativeIssueId, task.id)));
      expect(runs).toHaveLength(2);
      const firstPersistedRun = runs.find(candidate => candidate.id === firstRun!.id);
      const run = runs.find(candidate => candidate.id !== firstRun!.id);
      expect(firstPersistedRun).toBeDefined();
      expect(run).toBeDefined();
      expect(firstPersistedRun).toMatchObject({ status: "succeeded", runtimeMode: "native", nativeIssueId: task.id,
        resultJson: expect.objectContaining({ nativeResult: expect.objectContaining({
          schema: "paperclip.run_result.v1", reportedWorkDisposition: "yielded" }) }) });
      expect(run).toMatchObject({ status: "succeeded", runtimeMode: "native", nativeIssueId: task.id,
        responsibleUserId: actor.userId, nativeProcessCleanupPending: false });
      expect(run!.contextSnapshot).toMatchObject({ issueId: task.id, taskId: task.id,
        interactionId: pendingConfirmation!.id, sourceRunId: firstRun!.id, forceFreshSession: true,
        workspaceRefreshReason: "accepted_plan_confirmation" });
      expect(run!.responsibleUserId).toBe(actor.userId);
      const [completedTask] = await db.select().from(issues).where(eq(issues.id, task.id));
      const firstWorkspace = realizedByRun.get(firstPersistedRun!.id);
      const refreshedWorkspace = realizedByRun.get(run!.id);
      expect(firstWorkspace).toBeDefined(); expect(refreshedWorkspace).toBeDefined();
      expect(refreshedWorkspace!.id).not.toBe(firstWorkspace!.id);
      expect(completedTask).toMatchObject({ status: "done", projectId: selected.projectId,
        projectWorkspaceId: selected.projectWorkspaceId, executionWorkspaceId: refreshedWorkspace!.id });
      const [finalization] = await db.select().from(nativeRunFinalizations).where(eq(nativeRunFinalizations.runId, run!.id));
      expect(finalization).toMatchObject({ phase: "committed", leaseOwner: null, failureCode: null });
      const [result] = await db.select().from(nativeRunResults).where(eq(nativeRunResults.id, finalization!.resultId!));
      const [assessment] = await db.select().from(workAssessments).where(eq(workAssessments.id, finalization!.assessmentId!));
      const [decision] = await db.select().from(statusDecisions).where(eq(statusDecisions.id, finalization!.decisionId!));
      expect(result).toMatchObject({ runId: run!.id, issueId: task.id, schemaStatus: "accepted" });
      expect(assessment).toMatchObject({ runId: run!.id, issueId: task.id, resultId: result!.id });
      expect(decision).toMatchObject({ assessmentId: assessment!.id, applicationState: "applied", toStatus: "done" });
      expect(completedTask?.lastStatusDecisionId).toBe(decision!.id);
      expect(run!.resultJson).toMatchObject({ finalizationPhase: "committed",
        assessmentId: assessment!.id, decisionId: decision!.id });
      const attempts = await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.planId, plan.id));
      expect(attempts.length).toBeGreaterThanOrEqual(2);
      expect(attempts.map(attempt => attempt.runId)).toEqual(expect.arrayContaining([firstPersistedRun!.id, run!.id]));
      const reservations = await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, plan.id));
      expect(reservations.length).toBeGreaterThanOrEqual(2);
      expect(reservations.every(row => row.status === "completed" && row.purpose === "worker_model" &&
        attempts.some(attempt => attempt.id === row.workerAttemptId))).toBe(true);
      expect(attempts.every(attempt => reservations.some(row => row.workerAttemptId === attempt.id))).toBe(true);
      const outputs = await db.select({ body: documents.latestBody }).from(issueDocuments).innerJoin(documents,
        and(eq(documents.companyId, issueDocuments.companyId), eq(documents.id, issueDocuments.documentId)))
        .where(and(eq(issueDocuments.companyId, companyId), eq(issueDocuments.issueId, task.id), eq(issueDocuments.key, "plan")));
      expect(outputs).toEqual([{ body: "Use a fresh isolated workspace after this plan is accepted." }]);
      const leases = await db.select().from(environmentLeases).where(and(eq(environmentLeases.companyId, companyId),
        eq(environmentLeases.heartbeatRunId, run!.id)));
      expect(leases).toHaveLength(1);
      expect(leases[0]).toMatchObject({ status: "expired", leasePolicy: "ephemeral", cleanupStatus: "success", failureReason: "paperclip_runner_destroy_after_turn" });
      expect(leases[0]!.releasedAt).toBeInstanceOf(Date);
      expect(await verifyNativeCleanupRuntimeState(db, { companyId, runId: run!.id, leaseId: leases[0]!.id },
        leases[0]!.metadata?.remoteExecutionTermination)).toMatchObject({ state: "stopped", runId: run!.id });
      expect(providerSourceChecks).toBe(reservations.length);
      expect(facts().providerCallCount).toBe(reservations.length);
      expect(factsForRun(firstPersistedRun!.id).issuerFacts).toEqual([{ scope: "worker_model",
        runId: firstPersistedRun!.id, manifestId: attempts.find(attempt => attempt.runId === firstPersistedRun!.id)!.executionManifestId }]);
      expect(factsForRun(run!.id).issuerFacts).toEqual([{ scope: "worker_model", runId: run!.id,
        manifestId: attempts.find(attempt => attempt.runId === run!.id)!.executionManifestId }]);
      for (const completedRun of [firstPersistedRun!, run!]) {
        const runtime = factsForRun(completedRun.id).sandboxRuntimeFacts;
        expect(runtime?.relayAuthenticated).toBe(true);
        expect(runtime?.brokerTokenSubstitutionCount).toBe(0);
        expect(runtime?.attachedModelBrokerProviderCount).toBe(0);
        expect((runtime?.modelBrokerSessionReceipts as Array<{ phase: string }>).at(-1)?.phase).toBe("stop");
      }
      expect(git(selected.repositoryRoot, "branch", "--show-current")).toBe("main");
      expect(git(selected.repositoryRoot, "rev-parse", "refs/heads/main")).toBe(baseMain);
    },
  });
}, 600_000);
