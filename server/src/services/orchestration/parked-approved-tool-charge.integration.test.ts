import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agents, companies, completionContracts, createDb, heartbeatRuns, issues, orchestrationPlans, orchestrationWorkerAttempts,
  orchestrationWorkers, toolActionRequests, toolInvocations,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { instanceSettingsService } from "../instance-settings.js";
import { parkedApprovedToolChargeAllowed, type ParkedApprovedToolChargeFacts } from "./parked-approved-tool-charge.js";

// APR-E2E-17 (option A). Migration 0588 lets aw_v7_orchestration_tool_charge
// charge a server-executed, Human-approved parked call to its original plan
// after the requesting Run's attempt ended. These scenarios drive the real
// trigger and check that the TypeScript mirror agrees with it on each one.
const support = await getEmbeddedPostgresTestSupport();
const describeDb = support.supported ? describe : describe.skip;
type Db = ReturnType<typeof createDb>;

describeDb("parked approved tool charge (APR-E2E-17)", () => {
  let db!: Db;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("parked-approved-tool-charge-");
    db = createDb(temporary.connectionString);
    await instanceSettingsService(db as never).getExperimental();
    await db.execute(sql`update instance_settings set experimental = coalesce(experimental, '{}'::jsonb) ||
      '{"orchestration_v7":true,"readiness_engine_v7":true,"enableWorkflowsV1":true,"enableFoundationV1":true,"enableContextEngineV1":true,"agent_runtime_fabric_v5":true,"agent_identities_v5":true,"agent_provider_bindings_v5":true}'::jsonb
      where singleton_key = 'default'`);
  }, 120_000);
  afterAll(async () => { await temporary?.cleanup(); });

  /** One Task under a running single-worker plan. The Worker's Run parked a
   * write call (awaiting approval) and has ended; its attempt succeeded. */
  async function seed(options: { requestedStatus?: string; decidedBy?: "user" | "agent" | "both" | "none"; decidedAt?: Date;
    noRequest?: boolean; twoRequests?: boolean; foreignPlan?: boolean; invocationStatus?: string } = {}) {
    const ids = { company: randomUUID(), agent: randomUUID(), other: randomUUID(), issue: randomUUID(), otherIssue: randomUUID(),
      run: randomUUID(), contract: randomUUID(), otherContract: randomUUID(), plan: randomUUID(), otherPlan: randomUUID(),
      worker: randomUUID(), otherWorker: randomUUID(), attempt: randomUUID(), invocation: randomUUID(), user: `user-${randomUUID()}` };
    await db.insert(companies).values({ id: ids.company, name: "Parked charge", issuePrefix: `P${ids.company.replace(/-/g, "").slice(0, 7).toUpperCase()}` });
    await db.insert(agents).values([
      { id: ids.agent, companyId: ids.company, name: "Worker", adapterType: "paperclip_runner", status: "idle", adapterConfig: {} },
      { id: ids.other, companyId: ids.company, name: "Approver agent", adapterType: "paperclip_runner", status: "idle", adapterConfig: {} },
    ]);
    await db.insert(issues).values([
      { id: ids.issue, companyId: ids.company, title: "Parked Task", status: "in_review", assigneeAgentId: ids.agent },
      { id: ids.otherIssue, companyId: ids.company, title: "Other Task", status: "in_progress", assigneeAgentId: ids.agent },
    ]);
    const contract = (id: string, issueId: string) => ({ id, companyId: ids.company, issueId, revision: 1,
      schemaVersion: "aw.completion-contract.v7", policyVersion: "test", risk: "low", completionAuthority: "server_arbiter",
      incompleteCriteriaPolicy: "block", contractJson: { objective: "Do the work", criteria: [{ id: "done", requirement: "Done" }] },
      canonicalSha256: "c".repeat(64), createdByActorType: "agent", createdByActorId: ids.agent });
    await db.insert(completionContracts).values([contract(ids.contract, ids.issue), contract(ids.otherContract, ids.otherIssue)]);
    await db.insert(heartbeatRuns).values({ id: ids.run, companyId: ids.company, agentId: ids.agent, status: "succeeded",
      issueId: ids.issue, finishedAt: new Date() });
    const plan = (id: string, issueId: string, contractId: string) => ({ id, companyId: ids.company, issueId,
      completionContractId: contractId, mode: "single_worker", actionClass: "internal_draft", riskClass: "C0",
      supervisionMode: "none", verificationMode: "deterministic", humanOversightMode: "human_review", createdBy: ids.user,
      budgets: { maxWorkerCount: 1, maxParallelWorkers: 1, maxDelegationDepth: 1, maxRetries: 0, maxWallClockSeconds: 3600,
        maxToolActions: 2, maxModelCostMinor: 1000 } });
    await db.insert(orchestrationPlans).values([plan(ids.plan, ids.issue, ids.contract), plan(ids.otherPlan, ids.otherIssue, ids.otherContract)]);
    await db.insert(orchestrationWorkers).values([
      { id: ids.worker, companyId: ids.company, planId: ids.plan, issueId: ids.issue, agentId: ids.agent,
        completionContractId: ids.contract, workerKey: "writer", dependsOn: [], status: "waiting", attemptCount: 1 },
      { id: ids.otherWorker, companyId: ids.company, planId: ids.otherPlan, issueId: ids.otherIssue, agentId: ids.agent,
        completionContractId: ids.otherContract, workerKey: "writer", dependsOn: [], status: "waiting", attemptCount: 1 },
    ]);
    for (const id of [ids.plan, ids.otherPlan]) await db.update(orchestrationPlans).set({ status: "running", startedAt: new Date(),
      version: 2, executionPrincipal: { type: "user", userId: ids.user } }).where(eq(orchestrationPlans.id, id));
    // The Run's attempt: on this Task's plan, or (foreignPlan) on another Task's plan.
    await db.insert(orchestrationWorkerAttempts).values({ id: ids.attempt, companyId: ids.company,
      planId: options.foreignPlan ? ids.otherPlan : ids.plan, workerId: options.foreignPlan ? ids.otherWorker : ids.worker,
      agentId: ids.agent, runId: ids.run, attempt: 1, status: "succeeded", finishedAt: new Date() });
    await db.insert(toolInvocations).values({ id: ids.invocation, companyId: ids.company, runId: ids.run, issueId: ids.issue,
      agentId: ids.agent, actorType: "agent", actorId: ids.agent, toolName: "railway_update_variable", argumentsHash: "a".repeat(64),
      riskLevel: "write", policyDecision: "require_approval", approvalState: "pending",
      status: (options.invocationStatus ?? "awaiting_approval") as never });
    const request = () => ({ companyId: ids.company, issueId: ids.issue, invocationId: ids.invocation,
      status: (options.requestedStatus ?? "executing") as never, canonicalArgumentsHash: "a".repeat(64),
      canonicalArgumentsSummary: { summary: "Update one variable" } as never, requestedByAgentId: ids.agent,
      expiresAt: new Date(Date.now() + 600_000),
      decidedByUserId: ["user", "both"].includes(options.decidedBy ?? "user") ? ids.user : null,
      decidedByAgentId: ["agent", "both"].includes(options.decidedBy ?? "user") ? ids.other : null,
      decidedAt: options.decidedBy === "none" ? null : options.decidedAt ?? new Date(Date.now() - 1_000) });
    if (!options.noRequest) await db.insert(toolActionRequests).values(request());
    if (options.twoRequests) await db.insert(toolActionRequests).values(request());
    return ids;
  }
  type Ids = Awaited<ReturnType<typeof seed>>;

  /** The facts the mirror reads, taken from the same rows the trigger reads. */
  async function facts(ids: Ids, transition: ParkedApprovedToolChargeFacts["transition"]): Promise<ParkedApprovedToolChargeFacts> {
    const [invocation] = await db.select().from(toolInvocations).where(eq(toolInvocations.id, ids.invocation));
    const requests = await db.select().from(toolActionRequests).where(eq(toolActionRequests.invocationId, ids.invocation));
    const attempts = await db.execute<{ company_id: string; run_id: string; plan_id: string; status: string; run_status: string;
      run_agent_id: string; worker_issue_id: string; worker_agent_id: string | null; task_status: string;
      task_assignee_agent_id: string | null; cancellation: string | null }>(sql`
      select a.company_id, a.run_id, a.plan_id, a.status, r.status as run_status, r.agent_id as run_agent_id,
        w.issue_id as worker_issue_id, w.agent_id as worker_agent_id, t.status as task_status,
        t.assignee_agent_id as task_assignee_agent_id, r.result_json->'executionCancellation'->>'state' as cancellation
      from orchestration_worker_attempts a join heartbeat_runs r on r.company_id=a.company_id and r.id=a.run_id
        join orchestration_workers w on w.company_id=a.company_id and w.id=a.worker_id
        join issues t on t.company_id=w.company_id and t.id=w.issue_id
      where a.company_id=${ids.company} and a.run_id=${ids.run}`);
    const attemptRows = attempts as unknown as Array<{ company_id: string; run_id: string; plan_id: string; status: string;
      run_status: string; run_agent_id: string; worker_issue_id: string; worker_agent_id: string | null; task_status: string;
      task_assignee_agent_id: string | null; cancellation: string | null }>;
    const planId = attemptRows[0]!.plan_id;
    const [plan] = await db.select().from(orchestrationPlans).where(eq(orchestrationPlans.id, planId));
    const charged = await db.execute(sql`select 1 from orchestration_tool_charges where invocation_id=${ids.invocation}`);
    const budgets = plan!.budgets as { maxWallClockSeconds: number; maxToolActions: number };
    return {
      transition,
      invocation: { id: invocation!.id, companyId: invocation!.companyId, runId: invocation!.runId, issueId: invocation!.issueId,
        agentId: invocation!.agentId },
      requests: requests.map(value => ({ companyId: value.companyId, invocationId: value.invocationId, status: value.status,
        decidedByUserId: value.decidedByUserId, decidedByAgentId: value.decidedByAgentId, decidedAt: value.decidedAt })),
      attempts: attemptRows.map(value => ({ companyId: value.company_id, runId: value.run_id, planId: value.plan_id,
        status: value.status, runStatus: value.run_status, runAgentId: value.run_agent_id, workerIssueId: value.worker_issue_id,
        workerAgentId: value.worker_agent_id, taskStatus: value.task_status, taskAssigneeAgentId: value.task_assignee_agent_id,
        cancellationRequested: value.cancellation === "requested" })),
      plan: { id: plan!.id, status: plan!.status, erased: plan!.erasedAt !== null, started: plan!.startedAt !== null,
        wallClockExceeded: plan!.startedAt !== null && Date.now() >= plan!.startedAt.getTime() + budgets.maxWallClockSeconds * 1000,
        featureGatesOn: true, toolActionsUsed: plan!.toolActionsUsed, maxToolActions: budgets.maxToolActions,
        alreadyChargedForInvocation: (charged as unknown as unknown[]).length > 0 },
      now: new Date(),
    };
  }

  /** The gateway's executing transition for the parked call. */
  async function execute(ids: Ids) {
    try {
      await db.update(toolInvocations).set({ status: "executing", approvalState: "approved", startedAt: new Date(), updatedAt: new Date() })
        .where(eq(toolInvocations.id, ids.invocation));
      return { accepted: true as const };
    } catch (error) {
      const cause = (error as { cause?: { code?: string; message?: string } }).cause;
      return { accepted: false as const, code: cause?.code, message: cause?.message };
    }
  }
  async function ledger(planId: string) {
    const [plan] = await db.select({ used: orchestrationPlans.toolActionsUsed }).from(orchestrationPlans).where(eq(orchestrationPlans.id, planId));
    const charges = await db.execute(sql`select invocation_id from orchestration_tool_charges where plan_id=${planId}`);
    return { used: plan!.used, charges: (charges as unknown as Array<{ invocation_id: string }>).map(value => value.invocation_id) };
  }
  /** Fixture-only: reach a completed plan or a done Task without the
   * verification flow their own guards require (replica role skips triggers
   * for this one statement's transaction). The charge trigger still runs on
   * the transition under test. */
  const withoutOtherGuards = (write: (tx: Parameters<Parameters<Db["transaction"]>[0]>[0]) => Promise<unknown>) =>
    db.transaction(async tx => { await tx.execute(sql`set local session_replication_role = replica`); await write(tx); });
  const parked = { operation: "UPDATE", oldStatus: "awaiting_approval", newStatus: "executing", approvalState: "approved" } as const;

  it("charges a Human-approved parked call once to its original plan after the requesting Run ended", async () => {
    const ids = await seed();
    const mirror = parkedApprovedToolChargeAllowed(await facts(ids, parked));
    expect(await execute(ids)).toEqual({ accepted: true });
    expect(mirror).toBe(true);
    expect(await ledger(ids.plan)).toEqual({ used: 1, charges: [ids.invocation] });
    // An idempotent repeat of the transition charges nothing more.
    await db.update(toolInvocations).set({ updatedAt: new Date() }).where(eq(toolInvocations.id, ids.invocation));
    expect(await ledger(ids.plan)).toEqual({ used: 1, charges: [ids.invocation] });
  });

  const refusals: Array<[string, Parameters<typeof seed>[0], ((ids: Ids) => Promise<unknown>) | null, string]> = [
    ["the plan is paused", {}, ids => db.update(orchestrationPlans).set({ status: "paused" }).where(eq(orchestrationPlans.id, ids.plan)), "orchestration_execution_not_authorized"],
    ["the plan is cancelled", {}, ids => db.update(orchestrationPlans).set({ status: "cancelled" }).where(eq(orchestrationPlans.id, ids.plan)), "orchestration_execution_not_authorized"],
    ["the plan is completed", {}, ids => withoutOtherGuards(tx => tx.update(orchestrationPlans).set({ status: "completed" }).where(eq(orchestrationPlans.id, ids.plan))), "orchestration_execution_not_authorized"],
    ["the plan's tool-action budget is exhausted", {}, ids => db.update(orchestrationPlans).set({ toolActionsUsed: 2 }).where(eq(orchestrationPlans.id, ids.plan)), "orchestration_tool_budget_exhausted"],
    ["an Agent decided the request", { decidedBy: "agent" }, null, "orchestration_attempt_stopped"],
    ["an Agent is recorded on the Human's decision", { decidedBy: "both" }, null, "orchestration_attempt_stopped"],
    ["the request was never decided", { decidedBy: "none" }, null, "orchestration_attempt_stopped"],
    ["the decision is recorded after the transition", { decidedAt: new Date(Date.now() + 600_000) }, null, "orchestration_attempt_stopped"],
    ["there is no action request", { noRequest: true }, null, "orchestration_attempt_stopped"],
    ["there are two action requests", { twoRequests: true }, null, "orchestration_attempt_stopped"],
    ["the request is approved but not claimed for execution", { requestedStatus: "approved" }, null, "orchestration_attempt_stopped"],
    ["the Run's attempt is on another Task's plan", { foreignPlan: true }, null, "orchestration_attempt_stopped"],
    ["the invocation is not parked", { invocationStatus: "pending" }, null, "orchestration_attempt_stopped"],
    ["a second execution after a failed one", { invocationStatus: "failed" }, null, "orchestration_attempt_stopped"],
    ["the requesting Run's attempt failed", {}, ids => db.update(orchestrationWorkerAttempts).set({ status: "failed" }).where(eq(orchestrationWorkerAttempts.id, ids.attempt)), "orchestration_attempt_stopped"],
    ["the Task is done", {}, ids => withoutOtherGuards(tx => tx.update(issues).set({ status: "done" }).where(eq(issues.id, ids.issue))), "orchestration_attempt_stopped"],
    ["the Task was reassigned", {}, ids => db.update(issues).set({ assigneeAgentId: ids.other }).where(eq(issues.id, ids.issue)), "orchestration_attempt_stopped"],
    ["the Run's cancellation was requested", {}, ids => db.update(heartbeatRuns).set({ resultJson: { executionCancellation: { state: "requested" } } }).where(eq(heartbeatRuns.id, ids.run)), "orchestration_attempt_stopped"],
  ];
  it.each(refusals)("keeps the refusal when %s, and the mirror agrees", async (_name, options, mutate, code) => {
    const ids = await seed(options);
    if (mutate) await mutate(ids);
    const [before] = await db.select({ status: toolInvocations.status }).from(toolInvocations).where(eq(toolInvocations.id, ids.invocation));
    const mirror = parkedApprovedToolChargeAllowed(await facts(ids, { ...parked, oldStatus: before!.status }));
    const result = await execute(ids);
    expect(result).toMatchObject({ accepted: false, code: "23514", message: code });
    expect(mirror).toBe(false);
    for (const planId of [ids.plan, ids.otherPlan]) expect((await ledger(planId)).charges).not.toContain(ids.invocation);
  });

  it("does not admit a parked call through an INSERT that starts as executing", async () => {
    const ids = await seed({ noRequest: true });
    const mirror = parkedApprovedToolChargeAllowed(await facts(ids, { operation: "INSERT", oldStatus: null, newStatus: "executing", approvalState: "approved" }));
    const inserted = await db.insert(toolInvocations).values({ companyId: ids.company, runId: ids.run, issueId: ids.issue,
      agentId: ids.agent, actorType: "agent", actorId: ids.agent, toolName: "railway_update_variable", argumentsHash: "b".repeat(64),
      riskLevel: "write", policyDecision: "require_approval", approvalState: "approved", status: "executing", startedAt: new Date() })
      .then(() => "accepted", (error: { cause?: { message?: string } }) => error.cause?.message);
    expect(inserted).toBe("orchestration_attempt_stopped");
    expect(mirror).toBe(false);
  });
});
