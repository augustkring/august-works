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
import { commitNativeStatusDecision } from "./status-decision-committer.js";
import { NATIVE_STATUS_ARBITER_POLICY_VERSION, type NativeStatusDecision } from "./status-arbiter.js";
import { activePlanCoveringTask } from "../orchestration/plan-coverage.js";

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
  const userId = `user-${randomUUID()}`;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-committer-plan-coverage-");
    db = createDb(tempDb.connectionString);
    await db.insert(companies).values({ id: companyId, name: "Plan coverage", issuePrefix: "PLC" });
    await db.insert(agents).values({ id: agentId, companyId, name: "Plan Worker", adapterType: "codex_local", status: "running" });
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
});
