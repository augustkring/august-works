import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, authAccounts, authUsers, companies, createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, heartbeatRuns, issues,
  orchestrationPlans } from "@paperclipai/db";
import { orchestrationBudgetSchema, orchestrationCompletionSchema } from "@paperclipai/shared";
import { assertNativeConformanceHumanAuthentication } from "../services/execution-sandbox/native-conformance-authentication.js";
import { writeOrchestrationContract } from "../services/orchestration/orchestration-contracts.js";
import type { AuthorizationActor } from "../services/authorization.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

// CONF15-P4. One Human request runs every probe of a provider-conformance
// qualification group (`native-opencode-conformance.ts` `test()`). A later
// probe may rely on the authentication that was recent when its group started.
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("hidden conformance probe Human authentication", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db!: ReturnType<typeof createDb>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("conformance-group-authentication-");
    db = createDb(database.connectionString);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await database?.cleanup(); }, 30_000);

  async function makeHuman() {
    const id = randomUUID(), now = new Date();
    await db.insert(authUsers).values({ id, name: "Conformance Human", email: `${id}@example.test`, createdAt: now, updatedAt: now });
    await db.insert(authAccounts).values({ id: randomUUID(), issuer: "local:credential", accountId: `${id}@example.test`,
      providerId: "credential", userId: id, password: "fixture-password-hash-v1", createdAt: now, updatedAt: now });
    return id;
  }
  /** A password session authenticated `ageSeconds` ago on the database clock. */
  async function makeSession(userId: string, options: { ageSeconds: number; expiresInSeconds?: number; versionOffset?: number }) {
    const [user] = await db.select({ version: authUsers.authenticatorVersion }).from(authUsers).where(eq(authUsers.id, userId));
    const rows = await db.execute<{ id: string }>(sql`
      insert into "session" (id, user_id, token, created_at, updated_at, expires_at,
        authentication_method, authenticated_at, authenticator_version)
      values (${randomUUID()}, ${userId}, ${randomUUID()},
        clock_timestamp() - ${options.ageSeconds} * interval '1 second', clock_timestamp() - ${options.ageSeconds} * interval '1 second',
        clock_timestamp() + ${options.expiresInSeconds ?? 3600} * interval '1 second', 'password',
        clock_timestamp() - ${options.ageSeconds} * interval '1 second', ${user!.version + (options.versionOffset ?? 0)})
      returning id`);
    return rows[0]!.id;
  }
  const actorFor = (userId: string, sessionId: string): AuthorizationActor =>
    ({ type: "board", source: "session", userId, sessionId });

  /** One hidden harness: Task, paused C0 plan started `planAgeSeconds` ago,
   * and the running probe Run bound to it, as `test()` writes them. */
  async function makeGroup(userId: string, planAgeSeconds: number) {
    const companyId = randomUUID(), agentId = randomUUID(), groupId = randomUUID(), runId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Conformance", issuePrefix: `C${companyId.slice(0, 4).toUpperCase()}` });
    await db.insert(agents).values({ id: agentId, companyId, name: "OpenCode", role: "engineer", adapterType: "paperclip_runner" });
    const [task] = await db.insert(issues).values({ companyId, title: "Synthetic managed OpenCode qualification",
      status: "in_progress", assigneeAgentId: agentId, hiddenAt: new Date(), harnessKind: "provider_conformance",
      responsibleUserId: userId }).returning();
    const contract = await writeOrchestrationContract(db, companyId, task!.id, orchestrationCompletionSchema.parse({
      objective: "Retain actual managed OpenCode conformance evidence", requiredOutputs: [{ key: "probe-evidence" }],
      businessInvariants: ["Qualification grants no ordinary execution authority"] }), userId);
    const [plan] = await db.insert(orchestrationPlans).values({ companyId, issueId: task!.id, completionContractId: contract.id,
      mode: "single_worker", actionClass: "internal_draft", riskClass: "C0", supervisionMode: "none",
      verificationMode: "deterministic", humanOversightMode: "human_review", status: "paused",
      startedAt: sql`clock_timestamp() - ${planAgeSeconds} * interval '1 second'` as unknown as Date,
      createdBy: userId, executionPrincipal: { type: "user", userId }, budgets: orchestrationBudgetSchema.parse({
        maxModelCostMinor: 10, maxToolActions: 0, maxWallClockSeconds: 300, maxRetries: 0, maxDelegationDepth: 0 }) }).returning();
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, scopeKind: "issue", issueId: task!.id,
      nativeIssueId: task!.id, responsibleUserId: userId, invocationSource: "on_demand", triggerDetail: "provider_conformance",
      status: "running", startedAt: new Date(), runtimeMode: "native",
      contextSnapshot: { providerConformanceGroupId: groupId, providerConformancePlanId: plan!.id,
        containsCompanyContext: false, platformToolsGranted: false } });
    await db.update(issues).set({ executionRunId: runId }).where(eq(issues.id, task!.id));
    return { companyId, groupId, planId: plan!.id, runId, taskId: task!.id };
  }
  type Scope = Awaited<ReturnType<typeof makeGroup>>;
  const denied = { status: 403, details: { code: "recent_authentication_required" } };

  it("admits a later probe whose session was recent when its group started, and keeps the per-probe rule", async () => {
    const human = await makeHuman();
    // Authenticated 400 s ago; the group started 200 s ago.
    const group = await makeGroup(human, 200);
    const stale = await makeSession(human, { ageSeconds: 400 });
    const proof = await assertNativeConformanceHumanAuthentication(db, actorFor(human, stale), group);
    expect(Date.now() - proof.authenticatedAt.getTime()).toBeGreaterThan(300_000);
    // A recently authenticated session passes as before.
    const recent = await makeSession(human, { ageSeconds: 10 });
    await expect(assertNativeConformanceHumanAuthentication(db, actorFor(human, recent), group)).resolves.toBeTruthy();
  });

  it("refuses another group, plan, Run or Task", async () => {
    const human = await makeHuman();
    const group = await makeGroup(human, 200), other = await makeGroup(human, 200);
    const session = await makeSession(human, { ageSeconds: 400 });
    for (const scope of [{ ...group, groupId: other.groupId }, { ...group, groupId: randomUUID() },
      { ...group, planId: other.planId }, { ...group, runId: other.runId }, { ...group, taskId: other.taskId },
      { ...group, companyId: other.companyId }] satisfies Scope[])
      await expect(assertNativeConformanceHumanAuthentication(db, actorFor(human, session), scope)).rejects.toMatchObject(denied);
  });

  it("refuses a Run of the group bound to another Task, and a Task bound to another Run", async () => {
    const human = await makeHuman();
    const session = await makeSession(human, { ageSeconds: 400 });
    const group = await makeGroup(human, 200);
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, group.runId));
    const [otherTask] = await db.insert(issues).values({ companyId: group.companyId, title: "Another hidden Task",
      status: "in_progress", assigneeAgentId: run!.agentId, hiddenAt: new Date(), harnessKind: "provider_conformance",
      responsibleUserId: human }).returning();
    // A second Run with this group's context but another Task; this Task's
    // executing Run is moved to it, so only the Run's Task differs.
    const strayRunId = randomUUID();
    await db.insert(heartbeatRuns).values({ id: strayRunId, companyId: group.companyId, agentId: run!.agentId, scopeKind: "issue",
      issueId: otherTask!.id, nativeIssueId: otherTask!.id, responsibleUserId: human, invocationSource: "on_demand",
      triggerDetail: "provider_conformance", status: "running", runtimeMode: "native", contextSnapshot: run!.contextSnapshot });
    const movedRun = await db.update(issues).set({ executionRunId: strayRunId }).where(eq(issues.id, group.taskId)).returning();
    expect(movedRun).toHaveLength(1);
    await expect(assertNativeConformanceHumanAuthentication(db, actorFor(human, session), { ...group, runId: strayRunId }))
      .rejects.toMatchObject(denied);
    // A second Run of this group and Task, while the Task executes the first.
    await db.update(issues).set({ executionRunId: group.runId }).where(eq(issues.id, group.taskId));
    const shadowRunId = randomUUID();
    await db.insert(heartbeatRuns).values({ id: shadowRunId, companyId: group.companyId, agentId: run!.agentId, scopeKind: "issue",
      issueId: group.taskId, nativeIssueId: group.taskId, responsibleUserId: human, invocationSource: "on_demand",
      triggerDetail: "provider_conformance", status: "running", runtimeMode: "native", contextSnapshot: run!.contextSnapshot });
    await expect(assertNativeConformanceHumanAuthentication(db, actorFor(human, session), { ...group, runId: shadowRunId }))
      .rejects.toMatchObject(denied);
    // The original binding still admits.
    await expect(assertNativeConformanceHumanAuthentication(db, actorFor(human, session), group)).resolves.toBeTruthy();
  });

  it("refuses another Human, even with a session recent at the group's start", async () => {
    const human = await makeHuman(), other = await makeHuman();
    const group = await makeGroup(human, 200);
    const otherSession = await makeSession(other, { ageSeconds: 400 });
    await expect(assertNativeConformanceHumanAuthentication(db, actorFor(other, otherSession), group)).rejects.toMatchObject(denied);
    // The session must belong to the actor's own user.
    const own = await makeSession(human, { ageSeconds: 400 });
    await expect(assertNativeConformanceHumanAuthentication(db, actorFor(other, own), group)).rejects.toMatchObject(denied);
  });

  it("refuses an expired, revoked or missing session", async () => {
    const human = await makeHuman();
    const group = await makeGroup(human, 200);
    const expired = await makeSession(human, { ageSeconds: 400, expiresInSeconds: -1 });
    const revoked = await makeSession(human, { ageSeconds: 400, versionOffset: 1 });
    for (const sessionId of [expired, revoked, randomUUID()])
      await expect(assertNativeConformanceHumanAuthentication(db, actorFor(human, sessionId), group)).rejects.toMatchObject(denied);
    await expect(assertNativeConformanceHumanAuthentication(db, { type: "board", source: "local_implicit", userId: human },
      group)).rejects.toMatchObject(denied);
  });

  it("refuses a session whose authentication predates the group's recent window", async () => {
    const human = await makeHuman();
    const group = await makeGroup(human, 200);
    // 520 s ago is 320 s before the group started.
    const older = await makeSession(human, { ageSeconds: 520 });
    await expect(assertNativeConformanceHumanAuthentication(db, actorFor(human, older), group)).rejects.toMatchObject(denied);
  });

  it("refuses a cancelled, finished or erased group", async () => {
    const human = await makeHuman();
    const session = await makeSession(human, { ageSeconds: 400 });
    // A completed plan or done Task needs server verification (the
    // `aw_v7_verified_completion_guard` and `aw_v7_orchestration_task_guard`
    // triggers); the unit test covers those statuses.
    for (const change of [{ plan: { status: "cancelled" } }, { plan: { status: "failed" } }, { plan: { status: "running" } },
      { plan: { erasedAt: new Date() } }, { task: { status: "cancelled" } }, { task: { status: "blocked" } },
      { run: { status: "succeeded" } }]) {
      const group = await makeGroup(human, 200);
      if ("plan" in change) await db.update(orchestrationPlans).set(change.plan).where(eq(orchestrationPlans.id, group.planId));
      if ("task" in change) await db.update(issues).set(change.task).where(eq(issues.id, group.taskId));
      if ("run" in change) await db.update(heartbeatRuns).set(change.run).where(eq(heartbeatRuns.id, group.runId));
      await expect(assertNativeConformanceHumanAuthentication(db, actorFor(human, session), group), JSON.stringify(change))
        .rejects.toMatchObject(denied);
    }
  });

  it("refuses a group past its own deadline", async () => {
    const human = await makeHuman();
    // The group started 310 s ago with a 300 s wall clock; the session was
    // authenticated 20 s before it started.
    const group = await makeGroup(human, 310);
    const session = await makeSession(human, { ageSeconds: 330 });
    await expect(assertNativeConformanceHumanAuthentication(db, actorFor(human, session), group)).rejects.toMatchObject(denied);
  });
});
