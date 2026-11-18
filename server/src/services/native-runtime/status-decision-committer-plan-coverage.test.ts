import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  completionContracts,
  createDb,
  heartbeatRuns,
  issues,
  nativeRunFinalizations,
  nativeRunResults,
  orchestrationPlans,
  orchestrationWorkers,
  statusDecisions,
  workAssessments,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { commitNativeStatusDecision, NativeStatusRaceError } from "./status-decision-committer.js";
import { nativeExecutionStageHandoffAvailable, nativeExecutorDoneTransition } from "./native-stage-handoff.js";
import { NATIVE_STATUS_ARBITER_POLICY_VERSION, type NativeStatusDecision } from "./status-arbiter.js";
import { activePlanCoveringTask } from "../orchestration/plan-coverage.js";
import { normalizeIssueExecutionPolicy } from "../issue-execution-policy.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;
if (!embeddedPostgresSupport.supported) {
  console.warn(`Skipping embedded Postgres committer plan-coverage tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`);
}

/** MS1f. The committer, the stage approval routes and the completion review
 * accept read one plan-coverage fact (the 0360 guard's). An executor `done`
 * under an unfinished plan waits for the plan's server verification. */
describeEmbeddedPostgres("Native status decision committer: plan coverage (MS1f)", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const companyId = randomUUID();
  const agentId = randomUUID();
  const reviewerAgentId = randomUUID();
  const userId = `user-${randomUUID()}`;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-committer-plan-coverage-");
    db = createDb(tempDb.connectionString);
    await db.insert(companies).values({ id: companyId, name: "Plan coverage", issuePrefix: "PLC" });
    await db.insert(agents).values({ id: agentId, companyId, name: "Plan Worker", adapterType: "codex_local", status: "running" });
    await db.insert(agents).values({ id: reviewerAgentId, companyId, name: "Stage Reviewer", adapterType: "codex_local", status: "idle" });
  }, 60_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function contractFor(issueId: string) {
    const id = randomUUID();
    await db.insert(completionContracts).values({ id, companyId, issueId, revision: 1, schemaVersion: "paperclip.completion-contract.v1",
      policyVersion: "plan-coverage-v1", risk: "standard", completionAuthority: "server_arbiter", incompleteCriteriaPolicy: "preserve_non_terminal",
      contractJson: { revision: "plan-coverage-v1", objective: "Finish the work", criteria: [{ id: "objective", requirement: "Complete the task" }] },
      canonicalSha256: `contract-${id}`, createdByActorType: "system", createdByActorId: "test" });
    return id;
  }

  /** A Native executor Run on its Task, with the rows commitNativeStatusDecision requires. */
  async function seedExecutorRun() {
    const issueId = randomUUID(), runId = randomUUID(), resultId = randomUUID(), assessmentId = randomUUID();
    await db.insert(issues).values({ id: issueId, companyId, title: "Planned executor Task", status: "in_progress", assigneeAgentId: agentId, workMode: "standard" });
    const contractId = await contractFor(issueId);
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, status: "running", runtimeMode: "native", nativeIssueId: issueId,
      nativeSessionId: randomUUID(), runnerInstanceId: randomUUID(), completionContractId: contractId, completionContractSha256: `contract-${contractId}`,
      contextSnapshot: { issueId } });
    await db.insert(nativeRunResults).values({ id: resultId, companyId, issueId, runId, completionContractId: contractId,
      serverFingerprint: `fp-${resultId}`, schemaStatus: "accepted", resultJson: {}, canonicalSha256: `sha-${resultId}` });
    await db.insert(workAssessments).values({ id: assessmentId, companyId, issueId, runId, contractId, resultId, triggerKind: "native_result",
      triggerActorCompanyId: companyId, priorIssueStatus: "in_progress", priorStatusVersion: 0, policyVersion: "plan-coverage-v1",
      assessmentJson: {}, inputDigest: `digest-${assessmentId}` });
    await db.insert(nativeRunFinalizations).values({ runId, companyId, issueId, phase: "arbitrating", attempt: 0, resultId });
    return { issueId, runId, assessmentId, contractId };
  }

  /** A running plan on `planIssueId` whose single worker runs `workerIssueId`. */
  async function runningPlan(planIssueId: string, workerIssueId: string, workerContractId: string, workerStatus = "running") {
    const plan = randomUUID();
    const planContract = planIssueId === workerIssueId ? workerContractId : await contractFor(planIssueId);
    await db.insert(orchestrationPlans).values({ id: plan, companyId, issueId: planIssueId, completionContractId: planContract,
      mode: "single_worker", actionClass: "internal_draft", riskClass: "C0", supervisionMode: "none", verificationMode: "deterministic",
      humanOversightMode: "human_review", createdBy: userId, budgets: { maxWorkerCount: 1, maxParallelWorkers: 1, maxDelegationDepth: 1,
        maxRetries: 0, maxWallClockSeconds: 3600, maxToolActions: 5, maxModelCostMinor: 1000 } });
    await db.insert(orchestrationWorkers).values({ companyId, planId: plan, issueId: workerIssueId, agentId, completionContractId: workerContractId,
      workerKey: "writer", dependsOn: [], status: workerStatus, attemptCount: 1 });
    await db.update(orchestrationPlans).set({ status: "running", startedAt: new Date(), version: 2,
      executionPrincipal: { type: "user", userId } }).where(eq(orchestrationPlans.id, plan));
    return plan;
  }

  async function commitDone(fixture: Awaited<ReturnType<typeof seedExecutorRun>>) {
    const decision: NativeStatusDecision = { policyVersion: NATIVE_STATUS_ARBITER_POLICY_VERSION, statusAction: "done", toStatus: "done",
      reasonCode: "completion_contract_satisfied", unblockDescriptor: null, effects: [{ kind: "release_checkout" }] };
    await commitNativeStatusDecision({ db, companyId, issueId: fixture.issueId, runId: fixture.runId, assessmentId: fixture.assessmentId,
      priorStatus: "in_progress", priorStatusVersion: 0, priorDecisionId: null, decision });
    const [task] = await db.select({ status: issues.status }).from(issues).where(eq(issues.id, fixture.issueId));
    const [row] = await db.select({ toStatus: statusDecisions.toStatus, reasonCode: statusDecisions.reasonCode })
      .from(statusDecisions).where(eq(statusDecisions.runId, fixture.runId));
    return { status: task?.status, decision: row };
  }

  it("holds an executor done for the server verification of the Task's own unfinished plan", async () => {
    const fixture = await seedExecutorRun();
    const plan = await runningPlan(fixture.issueId, fixture.issueId, fixture.contractId);
    expect(await activePlanCoveringTask(db, companyId, fixture.issueId)).toBe(plan);
    expect(await commitDone(fixture)).toEqual({ status: "in_review",
      decision: { toStatus: "in_review", reasonCode: "orchestration_verification_required" } });
  });

  it("holds it for a plan on another Task whose unfinished worker runs this Task", async () => {
    const fixture = await seedExecutorRun();
    const [root] = await db.insert(issues).values({ companyId, title: "Plan root", status: "in_progress" }).returning();
    await runningPlan(root!.id, fixture.issueId, fixture.contractId);
    expect(await commitDone(fixture)).toEqual({ status: "in_review",
      decision: { toStatus: "in_review", reasonCode: "orchestration_verification_required" } });
  });

  it.each([
    ["no plan covers the Task", async () => undefined],
    ["its worker on another Task's running plan is completed", async (fixture: Awaited<ReturnType<typeof seedExecutorRun>>) => {
      const [root] = await db.insert(issues).values({ companyId, title: "Plan root", status: "in_progress" }).returning();
      await runningPlan(root!.id, fixture.issueId, fixture.contractId, "completed");
    }],
    ["the Task's only plan is cancelled", async (fixture: Awaited<ReturnType<typeof seedExecutorRun>>) => {
      const plan = await runningPlan(fixture.issueId, fixture.issueId, fixture.contractId);
      await db.update(orchestrationPlans).set({ status: "cancelled", completedAt: new Date(), version: 3 }).where(eq(orchestrationPlans.id, plan));
    }],
  ] as const)("commits done as before when %s", async (_name, arrange) => {
    const fixture = await seedExecutorRun();
    await arrange(fixture);
    expect(await activePlanCoveringTask(db, companyId, fixture.issueId)).toBeNull();
    expect(await commitDone(fixture)).toEqual({ status: "done",
      decision: { toStatus: "done", reasonCode: "completion_contract_satisfied" } });
  });

  /** MS1f decision 1. The committer applies a stage handoff as the executor's
   * `done` stage transition, records the existing stage-pending decision, and
   * otherwise commits the arbiter's fallback; never `done`. */
  describe("execution-policy stage handoff (MS1f)", () => {
    const handoff: NativeStatusDecision = { policyVersion: NATIVE_STATUS_ARBITER_POLICY_VERSION, statusAction: "in_review",
      toStatus: "in_review", reasonCode: "execution_policy_stage_handoff", unblockDescriptor: null, effects: [{ kind: "release_checkout" }] };
    const incomplete = (): NativeStatusDecision => ({ policyVersion: NATIVE_STATUS_ARBITER_POLICY_VERSION, statusAction: "in_progress",
      toStatus: "in_progress", reasonCode: "completion_evidence_incomplete", unblockDescriptor: null,
      effects: [{ kind: "enqueue_continuation", continuationKind: "same_agent", summary: "Finish the remaining work and report done.",
        idempotencyKey: "native-completion-incomplete", agentId }] });

    async function withReviewStage(issueId: string) {
      const policy = normalizeIssueExecutionPolicy({ stages: [{ id: randomUUID(), type: "review",
        participants: [{ id: randomUUID(), type: "agent", agentId: reviewerAgentId }] }] })!;
      await db.update(issues).set({ executionPolicy: policy as unknown as Record<string, unknown> }).where(eq(issues.id, issueId));
      return policy;
    }

    async function commitHandoff(fixture: Awaited<ReturnType<typeof seedExecutorRun>>, fallback: NativeStatusDecision | null = incomplete()) {
      await commitNativeStatusDecision({ db, companyId, issueId: fixture.issueId, runId: fixture.runId, assessmentId: fixture.assessmentId,
        priorStatus: "in_progress", priorStatusVersion: 0, priorDecisionId: null, decision: handoff, stageHandoffFallback: fallback ?? undefined });
      return observe(fixture);
    }

    async function observe(fixture: Awaited<ReturnType<typeof seedExecutorRun>>) {
      const [task] = await db.select().from(issues).where(eq(issues.id, fixture.issueId));
      const decisions = await db.select({ toStatus: statusDecisions.toStatus, reasonCode: statusDecisions.reasonCode })
        .from(statusDecisions).where(eq(statusDecisions.runId, fixture.runId));
      return { task: task!, decisions };
    }

    it("offers the handoff in the finalizer's dry run only under a covering plan with a stage to enter", async () => {
      const available = async (issueId: string) => {
        const [task] = await db.select().from(issues).where(eq(issues.id, issueId));
        return nativeExecutionStageHandoffAvailable(db, { companyId, issue: task!, agentId });
      };
      const planned = await seedExecutorRun();
      await withReviewStage(planned.issueId);
      await runningPlan(planned.issueId, planned.issueId, planned.contractId);
      expect(await available(planned.issueId)).toBe(true);
      const planLess = await seedExecutorRun();
      await withReviewStage(planLess.issueId);
      expect(await available(planLess.issueId)).toBe(false);
      const noStage = await seedExecutorRun();
      await runningPlan(noStage.issueId, noStage.issueId, noStage.contractId);
      expect(await available(noStage.issueId)).toBe(false);
      const invalid = await seedExecutorRun();
      await runningPlan(invalid.issueId, invalid.issueId, invalid.contractId);
      await db.update(issues).set({ executionPolicy: { stages: "not-a-stage-list" } as never }).where(eq(issues.id, invalid.issueId));
      expect(await available(invalid.issueId)).toBe(false);
    });

    it("enters the declared stage under a covering plan as the existing stage-pending decision", async () => {
      const fixture = await seedExecutorRun();
      const policy = await withReviewStage(fixture.issueId);
      await runningPlan(fixture.issueId, fixture.issueId, fixture.contractId);
      const { task, decisions } = await commitHandoff(fixture);
      expect(decisions).toEqual([{ toStatus: "in_review", reasonCode: "execution_policy_stage_pending" }]);
      expect(task).toMatchObject({ status: "in_review", assigneeAgentId: reviewerAgentId, executionRunId: null,
        executionState: expect.objectContaining({ status: "pending", currentStageId: policy.stages[0]!.id, currentStageType: "review",
          currentParticipant: expect.objectContaining({ type: "agent", agentId: reviewerAgentId }),
          returnAssignee: expect.objectContaining({ type: "agent", agentId }) }) });
    });

    it("falls back, never to done, when the policy no longer has a stage to enter", async () => {
      const fixture = await seedExecutorRun();
      await runningPlan(fixture.issueId, fixture.issueId, fixture.contractId);
      const { task, decisions } = await commitHandoff(fixture);
      expect(decisions).toEqual([{ toStatus: "in_progress", reasonCode: "completion_evidence_incomplete" }]);
      expect(task).toMatchObject({ status: "in_progress", executionState: null });

      // A used incomplete continuation falls back to its preserved status.
      const second = await seedExecutorRun();
      await runningPlan(second.issueId, second.issueId, second.contractId);
      const preserved: NativeStatusDecision = { policyVersion: NATIVE_STATUS_ARBITER_POLICY_VERSION, statusAction: "preserve",
        toStatus: "in_progress", reasonCode: "prior_status_preserved_no_live_path", unblockDescriptor: null,
        effects: [{ kind: "record_finalization_error", cause: "completion_evidence_incomplete",
          nextAction: "Bind a durable continuation or a named recovery owner before changing issue status.", agentId }] };
      expect((await commitHandoff(second, preserved)).decisions)
        .toEqual([{ toStatus: "in_progress", reasonCode: "prior_status_preserved_no_live_path" }]);
    });

    it("leaves plan-less execution unchanged: done enters the stage, a handoff is never applied", async () => {
      const planLessDone = await seedExecutorRun();
      await withReviewStage(planLessDone.issueId);
      expect(await commitDone(planLessDone)).toEqual({ status: "in_review",
        decision: { toStatus: "in_review", reasonCode: "execution_policy_stage_pending" } });

      const planLessHandoff = await seedExecutorRun();
      await withReviewStage(planLessHandoff.issueId);
      const { task, decisions } = await commitHandoff(planLessHandoff);
      expect(decisions).toEqual([{ toStatus: "in_progress", reasonCode: "completion_evidence_incomplete" }]);
      expect(task).toMatchObject({ status: "in_progress", assigneeAgentId: agentId, executionState: null });
    });

    it("never applies a handoff to a conversation Task", async () => {
      const fixture = await seedExecutorRun();
      await withReviewStage(fixture.issueId);
      await runningPlan(fixture.issueId, fixture.issueId, fixture.contractId);
      await db.update(issues).set({ conversationAgentId: agentId, conversationUserId: `conversation-${randomUUID()}`,
        conversationState: "active" }).where(eq(issues.id, fixture.issueId));
      const { task, decisions } = await commitHandoff(fixture);
      expect(decisions).toEqual([{ toStatus: "in_progress", reasonCode: "completion_evidence_incomplete" }]);
      expect(task).toMatchObject({ status: "in_progress", assigneeAgentId: agentId, executionState: null });
    });

    it("falls back when the stored policy no longer parses", async () => {
      const fixture = await seedExecutorRun();
      await runningPlan(fixture.issueId, fixture.issueId, fixture.contractId);
      await db.update(issues).set({ executionPolicy: { stages: "not-a-stage-list" } as never }).where(eq(issues.id, fixture.issueId));
      const { task, decisions } = await commitHandoff(fixture);
      expect(decisions).toEqual([{ toStatus: "in_progress", reasonCode: "completion_evidence_incomplete" }]);
      expect(task).toMatchObject({ status: "in_progress", assigneeAgentId: agentId });
    });

    it.each([
      ["a stage became pending after arbitration", async (fixture: Awaited<ReturnType<typeof seedExecutorRun>>) => {
        const [task] = await db.select().from(issues).where(eq(issues.id, fixture.issueId));
        const { transition } = nativeExecutorDoneTransition(task!, agentId);
        await db.update(issues).set({ executionState: transition.patch.executionState as never }).where(eq(issues.id, fixture.issueId));
      }],
      ["another Run executes the Task", async (fixture: Awaited<ReturnType<typeof seedExecutorRun>>) => {
        const other = await seedExecutorRun();
        await db.update(issues).set({ executionRunId: other.runId }).where(eq(issues.id, fixture.issueId));
      }],
    ] as const)("treats a handoff as stale when %s", async (_name, arrange) => {
      const fixture = await seedExecutorRun();
      await withReviewStage(fixture.issueId);
      await runningPlan(fixture.issueId, fixture.issueId, fixture.contractId);
      await arrange(fixture);
      await expect(commitHandoff(fixture)).rejects.toBeInstanceOf(NativeStatusRaceError);
      expect((await observe(fixture)).decisions).toEqual([]);
    });

    it("refuses a handoff without a fallback, or with a fallback that would complete the Task", async () => {
      const done: NativeStatusDecision = { policyVersion: NATIVE_STATUS_ARBITER_POLICY_VERSION, statusAction: "done", toStatus: "done",
        reasonCode: "completion_contract_satisfied", unblockDescriptor: null, effects: [{ kind: "release_checkout" }] };
      for (const fallback of [null, done, { ...incomplete(), toStatus: "done" as const },
        { ...incomplete(), statusAction: "done" as const }, { ...incomplete(), reasonCode: "other" }]) {
        const fixture = await seedExecutorRun();
        await withReviewStage(fixture.issueId);
        await runningPlan(fixture.issueId, fixture.issueId, fixture.contractId);
        await expect(commitHandoff(fixture, fallback)).rejects.toThrow("native_stage_handoff_decision_invalid");
        const { task, decisions } = await observe(fixture);
        expect(decisions).toEqual([]);
        expect(task).toMatchObject({ status: "in_progress", assigneeAgentId: agentId, executionState: null });
      }
    });
  });
});
