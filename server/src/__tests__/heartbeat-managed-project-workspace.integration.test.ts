import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createDb, documents, environmentLeases, executionWorkspaces, heartbeatRuns, issueDocuments,
  issues, nativeRunFinalizations, nativeRunResults, orchestrationModelReservations,
  orchestrationWorkerAttempts, runtimePolicySnapshots, runtimeSandboxBindings, statusDecisions, workAssessments } from "@paperclipai/db";
import { nativeRunInputSourceReceiptSchema } from "@paperclipai/shared";
import { parseNativeExecutionInput } from "../vendor/paperclip-runner/index.js";
import { verifyNativeCleanupRuntimeState } from "../services/execution-sandbox/run-lease-cleanup.js";
import { assertNativeWorkspaceMetadataSourcesCurrent } from "../services/native-direct-input.js";
import { issueService } from "../services/issues.js";
import { orchestrationService } from "../services/orchestration/orchestration-service.js";
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
      const [completedTask] = await db.select().from(issues).where(eq(issues.id, task.id));
      expect(completedTask).toMatchObject({ status: "done", projectId: selected.projectId,
        projectWorkspaceId: selected.projectWorkspaceId, executionWorkspaceId: realized?.id });
      const [finalization] = await db.select().from(nativeRunFinalizations).where(eq(nativeRunFinalizations.runId, wake!.id));
      expect(finalization).toMatchObject({ phase: "committed", leaseOwner: null, failureCode: null });
      const [result] = await db.select().from(nativeRunResults).where(eq(nativeRunResults.id, finalization!.resultId!));
      const [assessment] = await db.select().from(workAssessments).where(eq(workAssessments.id, finalization!.assessmentId!));
      const [decision] = await db.select().from(statusDecisions).where(eq(statusDecisions.id, finalization!.decisionId!));
      expect(result).toMatchObject({ runId: wake!.id, issueId: task.id, schemaStatus: "accepted" });
      expect(assessment).toMatchObject({ runId: wake!.id, issueId: task.id, resultId: result!.id });
      expect(decision).toMatchObject({ assessmentId: assessment!.id, applicationState: "applied", toStatus: "done" });
      expect(completedTask?.lastStatusDecisionId).toBe(decision!.id);
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
