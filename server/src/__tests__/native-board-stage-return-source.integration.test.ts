import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, agents, authUsers, companies, companyMemberships, completionContracts, createDb, heartbeatRuns, issues,
  nativeRunResults, statusDecisions, workAssessments } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { issueService } from "../services/issues.js";
import { nativeParentReceiptRunId, verifyNativeParentTaskCaptureLineage, verifyNativeRetainedTaskRoundSuffix } from "../services/native-board-stage-return-source.js";
import { assertNativeContextTaskSourceCurrent } from "../services/native-direct-input.js";
import { nativeStageReviewerRoundTurnState } from "../services/native-stage-reviewer-round-turn.js";
import { nativeContextTaskEvidence, nativeContextTaskEvidenceHash } from "../services/context/context-task-evidence.js";

// MS1f stop 5 (migration 0587). The board's PATCH override that returns a Task
// from a pending execution stage to the round's executor clears
// execution_state, a Task body field. The board_stage_return transform keeps
// the Task source for exactly that change, under the real triggers.
const support = await getEmbeddedPostgresTestSupport();
const describeDb = support.supported ? describe : describe.skip;
type Db = ReturnType<typeof createDb>;

const migrationsDir = fileURLToPath(new URL("../../../packages/db/src/migrations/", import.meta.url));
const cause = (error: unknown): { code?: string; message?: string } => {
  let current = error as { code?: string; message?: string; cause?: unknown } | undefined;
  while (current && typeof current === "object") {
    if (typeof current.code === "string" && /^[0-9A-Z]{5}$/.test(current.code)) return current;
    current = current.cause as typeof current;
  }
  return {};
};

describeDb("board_stage_return Task source transform (MS1f stop 5, 0587)", () => {
  let db!: Db;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("native-board-stage-return-");
    db = createDb(temporary.connectionString);
  }, 60_000);
  afterAll(async () => { await temporary?.cleanup(); });

  /** One sealed manual Task in its pending review stage after the executor's
   * applied stage-pending decision, with the returning board member. */
  async function seed(variant: { stateStatus?: string } = {}) {
    const ids = { company: randomUUID(), reviewer: randomUUID(), executor: randomUUID(), outsider: randomUUID(), issue: randomUUID(),
      run: randomUUID(), stage: randomUUID(), decision: randomUUID(), contract: randomUUID(), result: randomUUID(),
      assessment: randomUUID(), user: `user-${randomUUID()}`, viewer: `user-${randomUUID()}` };
    await db.insert(companies).values({ id: ids.company, name: "Board return", issuePrefix: `B${ids.company.slice(0, 6).toUpperCase()}` });
    await db.insert(agents).values([ids.reviewer, ids.executor, ids.outsider].map((id, index) => ({ id, companyId: ids.company,
      name: ["Reviewer", "Executor", "Outsider"][index]!, adapterType: "paperclip_runner", status: "idle", adapterConfig: {} })));
    const now = new Date();
    await db.insert(authUsers).values([ids.user, ids.viewer].map(id => ({ id, name: id, email: `${id}@example.test`,
      createdAt: now, updatedAt: now })));
    await db.insert(companyMemberships).values([
      { companyId: ids.company, principalType: "user", principalId: ids.user, status: "active", membershipRole: "owner" },
      { companyId: ids.company, principalType: "user", principalId: ids.viewer, status: "active", membershipRole: "viewer" },
    ]);
    const fromState = { status: variant.stateStatus ?? "pending", currentStageId: ids.stage, currentStageIndex: 0, currentStageType: "review",
      currentParticipant: { type: "agent", agentId: ids.reviewer, userId: null },
      returnAssignee: { type: "agent", agentId: ids.executor, userId: null }, reviewRequest: null,
      completedStageIds: [], lastDecisionId: null, lastDecisionOutcome: null };
    await db.insert(issues).values({ id: ids.issue, companyId: ids.company, title: "Returned task", description: "Rework it",
      status: "in_review", statusVersion: 3, assigneeAgentId: ids.reviewer, payloadSourceProtocolVersion: 1, executionState: fromState,
      responsibleUserId: ids.user, createdByUserId: ids.user,
      executionPolicy: { mode: "normal", commentRequired: true, stages: [{ id: ids.stage, type: "review", approvalsNeeded: 1,
        participants: [{ id: randomUUID(), type: "agent", agentId: ids.reviewer, userId: null }] }] } });
    await db.execute(sql`with s as (select jsonb_build_object('version',1,'owner',jsonb_build_object('kind','issue',
        'companyId',i.company_id::text,'id',i.id::text,'contentHash',public.aw_native_payload_body_hash('issue',to_jsonb(i))),
        'policy',jsonb_build_object('issueIds','[]'::jsonb,'projectIds','[]'::jsonb,'runIds','[]'::jsonb,'memoryIds','[]'::jsonb,
        'foundationRevisionIds','[]'::jsonb),'inputs','[]'::jsonb) as snap from issues i where i.id=${ids.issue}::uuid)
      update issues set payload_source_snapshot = s.snap || jsonb_build_object('digest',encode(sha256(convert_to(s.snap::text,'UTF8')),'hex'))
      from s where issues.id=${ids.issue}::uuid`);
    // The original direct Human capture audit the Task source history roots in.
    const [sealed] = await db.select({ snapshot: issues.payloadSourceSnapshot }).from(issues).where(eq(issues.id, ids.issue));
    const sealedSnapshot = sealed!.snapshot as { digest: string; owner: { contentHash: string } };
    await db.insert(activityLog).values({ companyId: ids.company, actorType: "user", actorId: ids.user,
      action: "issue.payload_source_captured", entityType: "issue", entityId: ids.issue,
      details: { producer: "direct_manual_input", digest: sealedSnapshot.digest, contentHash: sealedSnapshot.owner.contentHash } });
    await db.insert(completionContracts).values({ id: ids.contract, companyId: ids.company, issueId: ids.issue, revision: 1,
      schemaVersion: "aw.completion-contract.v7", policyVersion: "test", risk: "low", completionAuthority: "server_arbiter",
      incompleteCriteriaPolicy: "block", contractJson: { objective: "Rework it", criteria: [] }, canonicalSha256: "c".repeat(64),
      createdByActorType: "agent", createdByActorId: ids.executor });
    await db.insert(heartbeatRuns).values({ id: ids.run, companyId: ids.company, agentId: ids.executor, status: "succeeded",
      runtimeMode: "native", scopeKind: "issue", issueId: ids.issue, nativeIssueId: ids.issue, responsibleUserId: ids.user,
      nativePhase: "committed", completionContractId: ids.contract, finishedAt: new Date() });
    await db.insert(nativeRunResults).values({ id: ids.result, companyId: ids.company, issueId: ids.issue, runId: ids.run,
      completionContractId: ids.contract, serverFingerprint: randomUUID(), schemaStatus: "accepted", resultJson: {},
      canonicalSha256: "d".repeat(64) });
    await db.insert(workAssessments).values({ id: ids.assessment, companyId: ids.company, issueId: ids.issue, runId: ids.run,
      contractId: ids.contract, resultId: ids.result, triggerKind: "test", triggerActorCompanyId: ids.company,
      priorIssueStatus: "in_progress", priorStatusVersion: 2, policyVersion: "test", assessmentJson: {}, inputDigest: randomUUID() });
    await db.insert(statusDecisions).values({ id: ids.decision, companyId: ids.company, issueId: ids.issue, runId: ids.run,
      assessmentId: ids.assessment, decisionVersion: 1, policyVersion: "test", fromStatus: "in_progress", toStatus: "in_review",
      reasonCode: "execution_policy_stage_pending", decisionJson: {}, decisionDigest: "e".repeat(64),
      applicationState: "applied", appliedAt: new Date(Date.now() - 1_000) });
    await db.update(issues).set({ lastStatusDecisionId: ids.decision }).where(eq(issues.id, ids.issue));
    return { ids, fromState };
  }
  type Seeded = Awaited<ReturnType<typeof seed>>;

  /** The board return as raw SQL under the triggers: the board's issue.updated
   * activity and the Task update with one appended step, in one transaction. */
  async function rawReturn({ ids, fromState }: Seeded, variant: { extraField?: true; assignee?: string; version?: number;
    actor?: "agent" | "viewer" | "agent_as_user"; activityId?: string; decisionId?: string; activityFrom?: unknown } = {}) {
    const activityId = variant.activityId ?? randomUUID();
    const assignee = variant.assignee ?? ids.executor;
    const [task] = await db.select().from(issues).where(eq(issues.id, ids.issue));
    const snapshot = task!.payloadSourceSnapshot as Record<string, unknown> & { owner: Record<string, unknown>; digest: string;
      transforms?: unknown[] };
    const [hash] = await db.execute<{ next: string }>(sql`select public.aw_native_payload_body_hash('issue',to_jsonb(i) ||
      jsonb_build_object('execution_state',null::jsonb${variant.extraField ? sql`,'title','Changed title'` : sql``})) as next
      from issues i where i.id=${ids.issue}::uuid`);
    const taskStatusVersion = variant.version ?? task!.statusVersion + 1;
    const step = { kind: "board_stage_return", transitionId: randomUUID(), activityId, stageId: ids.stage,
      participantAgentId: ids.reviewer, executorAgentId: ids.executor, decisionId: variant.decisionId ?? ids.decision, taskStatusVersion,
      previousSnapshotDigest: snapshot.digest, previousOwnerContentHash: snapshot.owner.contentHash, nextOwnerContentHash: hash!.next };
    const { digest: _digest, ...unsealed } = snapshot;
    const next = { ...unsealed, owner: { ...snapshot.owner, contentHash: hash!.next }, transforms: [...(snapshot.transforms ?? []), step] };
    return db.transaction(async tx => {
      if (!variant.activityId) await tx.insert(activityLog).values({ id: activityId, companyId: ids.company,
        actorType: variant.actor === "agent" || variant.actor === "agent_as_user" ? "agent" : "user",
        actorId: variant.actor === "agent" ? ids.executor : variant.actor === "viewer" ? ids.viewer : ids.user,
        agentId: variant.actor === "agent" ? ids.executor : null, action: "issue.updated", entityType: "issue", entityId: ids.issue,
        details: { changes: { status: { from: "in_review", to: "in_progress" }, assigneeAgentId: { from: ids.reviewer, to: assignee },
          statusVersion: { from: task!.statusVersion, to: taskStatusVersion },
          executionState: { from: variant.activityFrom ?? fromState, to: null } } } });
      await tx.execute(sql`with s as (select ${JSON.stringify(next)}::jsonb as snap)
        update issues set status='in_progress', assignee_agent_id=${assignee}::uuid, execution_state=null,
          ${variant.extraField ? sql`title='Changed title',` : sql``}
          payload_source_snapshot = s.snap || jsonb_build_object('digest',encode(sha256(convert_to(s.snap::text,'UTF8')),'hex'))
        from s where issues.id=${ids.issue}::uuid`);
    }).then(() => step);
  }
  const refusal = async (promise: Promise<unknown>) => cause(await promise.then(() => null, (error: unknown) => error));
  const taskSource = async (issueId: string) => (await db.select({ snapshot: issues.payloadSourceSnapshot,
    invalidated: issues.payloadSourceSnapshotInvalidated, statusVersion: issues.statusVersion }).from(issues).where(eq(issues.id, issueId)))[0]!;

  it("keeps the Task source across exactly the board's stage return", async () => {
    const seeded = await seed();
    const step = await rawReturn(seeded);
    const after = await taskSource(seeded.ids.issue);
    expect(after.invalidated).toBe(false);
    expect(after.statusVersion).toBe(4);
    expect((after.snapshot as { transforms: unknown[] }).transforms).toEqual([step]);
  });

  it("refuses an extra body field, another assignee, another Task version, a non-board actor and a replay", async () => {
    expect(await refusal(rawReturn(await seed(), { extraField: true })))
      .toMatchObject({ code: "23514", message: "Board Stage return source must change only the returned stage" });
    const other = await seed();
    expect(await refusal(rawReturn(other, { assignee: other.ids.outsider })))
      .toMatchObject({ code: "23514", message: "Board Stage return source must change only the returned stage" });
    expect(await refusal(rawReturn(await seed(), { version: 7 })))
      .toMatchObject({ code: "23514", message: "Board Stage return source lacks the board's return and its round decision" });
    expect(await refusal(rawReturn(await seed(), { actor: "agent" })))
      .toMatchObject({ code: "23514", message: "Board Stage return source lacks the board's return and its round decision" });
    expect(await refusal(rawReturn(await seed(), { actor: "viewer" })))
      .toMatchObject({ code: "23514", message: "Board Stage return source lacks the board's return and its round decision" });
    // A stage state that is not pending; an agent-typed activity by the board
    // user's id; an activity that records another cleared state.
    expect(await refusal(rawReturn(await seed({ stateStatus: "changes_requested" }))))
      .toMatchObject({ code: "23514", message: "Board Stage return source must change only the returned stage" });
    expect(await refusal(rawReturn(await seed(), { actor: "agent_as_user" })))
      .toMatchObject({ code: "23514", message: "Board Stage return source lacks the board's return and its round decision" });
    const otherFrom = await seed();
    expect(await refusal(rawReturn(otherFrom, { activityFrom: { ...otherFrom.fromState, reviewRequest: { instructions: "Other" } } })))
      .toMatchObject({ code: "23514", message: "Board Stage return source lacks the board's return and its round decision" });
    // A last decision that is not the executor's applied stage-pending decision.
    const undecided = await seed();
    const otherDecision = randomUUID(), otherAssessment = randomUUID();
    await db.insert(workAssessments).values({ id: otherAssessment, companyId: undecided.ids.company, issueId: undecided.ids.issue,
      runId: undecided.ids.run, contractId: undecided.ids.contract, resultId: undecided.ids.result, triggerKind: "test",
      triggerActorCompanyId: undecided.ids.company, priorIssueStatus: "in_review", priorStatusVersion: 3, policyVersion: "test",
      assessmentJson: {}, inputDigest: randomUUID() });
    await db.insert(statusDecisions).values({ id: otherDecision, companyId: undecided.ids.company, issueId: undecided.ids.issue,
      runId: undecided.ids.run, assessmentId: otherAssessment, decisionVersion: 2, policyVersion: "test",
      fromStatus: "in_review", toStatus: "in_review", reasonCode: "native_review_unresolved", decisionJson: {},
      decisionDigest: "f".repeat(64), applicationState: "applied", appliedAt: new Date(Date.now() - 500) });
    await db.update(issues).set({ lastStatusDecisionId: otherDecision }).where(eq(issues.id, undecided.ids.issue));
    expect(await refusal(rawReturn(undecided, { decisionId: otherDecision })))
      .toMatchObject({ code: "23514", message: "Board Stage return source lacks the board's return and its round decision" });
    // Replay: the same step after the Task left the stage, and a second step with the same activity.
    const replayed = await seed();
    const step = await rawReturn(replayed);
    await db.update(issues).set({ status: "in_review", assigneeAgentId: replayed.ids.reviewer }).where(eq(issues.id, replayed.ids.issue))
      .catch(() => undefined);
    expect(await refusal(rawReturn(replayed, { activityId: step.activityId })))
      .toMatchObject({ code: "23514", message: "Board Stage return source must change only the returned stage" });
    expect((await taskSource(replayed.ids.issue)).invalidated).toBe(false);
  });

  it("the service keeps the source only for the board user's exact return, and drops it otherwise as before", async () => {
    const run = async (seeded: Seeded, data: Record<string, unknown>, userId: string) => {
      const activityId = randomUUID();
      await db.transaction(async tx => {
        const updated = await issueService(db).update(seeded.ids.issue, { ...data,
          privacyActor: { type: "board", userId, source: "session" }, actorUserId: userId }, tx, undefined, undefined,
          { boardStageReturnSourceTransform: { userId, activityId } });
        await tx.insert(activityLog).values({ id: activityId, companyId: seeded.ids.company, actorType: "user", actorId: userId,
          action: "issue.updated", entityType: "issue", entityId: seeded.ids.issue, details: { changes: updated!.changes ?? {} } });
      });
      return taskSource(seeded.ids.issue);
    };
    const exact = await seed();
    const kept = await run(exact, { status: "in_progress", assigneeAgentId: exact.ids.executor, executionState: null }, exact.ids.user);
    expect(kept.invalidated).toBe(false);
    expect((kept.snapshot as { transforms: Array<{ kind: string }> }).transforms.map(step => step.kind)).toEqual(["board_stage_return"]);
    const extra = await seed();
    const dropped = await run(extra, { status: "in_progress", assigneeAgentId: extra.ids.executor, executionState: null,
      title: "Changed title" }, extra.ids.user);
    expect(dropped).toMatchObject({ invalidated: true, snapshot: null });
  });

  it("fails the exact return with the 0571 trigger definition and passes again with 0587", async () => {
    const definition = (file: string) => {
      const source = readFileSync(`${migrationsDir}${file}`, "utf8");
      const start = source.indexOf("CREATE OR REPLACE FUNCTION public.aw_issue_workspace_source_transform()");
      return source.slice(start, source.indexOf("$$;", start) + 3);
    };
    const original = definition("0571_issue_native_stage_source_transform.sql");
    const current = definition("0587_board_stage_return_source_transform.sql");
    try {
      await db.execute(sql.raw(original));
      expect(await refusal(rawReturn(await seed()))).toMatchObject({ code: "23514",
        message: "Workspace source transform owner is not a retained manual related Task" });
    } finally {
      await db.execute(sql.raw(current));
    }
    expect((await taskSource((await (async () => { const s = await seed(); await rawReturn(s); return s; })()).ids.issue)).invalidated).toBe(false);
  });
  // MS1f (retained Context Task lineage). A Context Task item captured before
  // the stage round and the board return stays current for a retained consumer
  // only through owner-verified steps that changed only execution_state.
  describe("retained Context Task lineage across the board return", () => {
    async function returned() {
      const seeded = await seed();
      const [before] = await db.select({ snapshot: issues.payloadSourceSnapshot }).from(issues).where(eq(issues.id, seeded.ids.issue));
      const original = before!.snapshot as { owner: { contentHash: string } };
      const step = await rawReturn(seeded);
      const after = await taskSource(seeded.ids.issue);
      const current = after.snapshot as { owner: { contentHash: string } };
      return { seeded, original, step, currentHash: current.owner.contentHash, originalSnapshot: before!.snapshot };
    }
    const verify = (companyId: string, issueId: string, suffix: unknown[], prefixOwnerHash: string, currentOwnerHash: string,
      db_: Db = db) => verifyNativeRetainedTaskRoundSuffix(db_ as never, { companyId, issueId, suffix: suffix as never,
        prefixOwnerHash, currentOwnerHash });

    it("accepts the recorded board return and refuses a changed prefix, an unknown kind, a broken chain and an out-of-order step", async () => {
      const { seeded, original, step, currentHash } = await returned();
      const { company, issue } = seeded.ids;
      expect(await verify(company, issue, [step], original.owner.contentHash, currentHash)).toBe(true);
      expect(await verify(company, issue, [step], "f".repeat(64), currentHash)).toBe(false);
      expect(await verify(company, issue, [{ ...step, kind: "workspace_binding" }], original.owner.contentHash, currentHash)).toBe(false);
      expect(await verify(company, issue, [step, step], original.owner.contentHash, currentHash)).toBe(false);
      expect(await verify(company, issue, [{ ...step, nextOwnerContentHash: "e".repeat(64) }], original.owner.contentHash, currentHash)).toBe(false);
      expect(await verify(company, issue, [step], step.nextOwnerContentHash, currentHash)).toBe(false);
      expect(await verify(company, issue, [], original.owner.contentHash, currentHash)).toBe(false);
      expect(await verify(company, issue, [], currentHash, currentHash)).toBe(false);
      expect(await verify(company, issue, [step], original.owner.contentHash, "d".repeat(64))).toBe(false);
      expect(await verify(company, issue, [{ ...step, kind: "workspace_binding", previousOwnerContentHash: currentHash,
        nextOwnerContentHash: currentHash }], currentHash, currentHash)).toBe(false);
    });

    it("refuses an unverified step and a step whose Task changed a user-authored field", async () => {
      const { seeded, original, step, currentHash } = await returned();
      const { company, issue } = seeded.ids;
      const rollback = new Error("rollback");
      // Unverified: the board's activity no longer records that return.
      await expect(db.transaction(async tx => {
        await tx.update(activityLog).set({ details: { changes: {} } }).where(eq(activityLog.id, step.activityId));
        expect(await verify(company, issue, [step], original.owner.contentHash, currentHash, tx as never)).toBe(false);
        throw rollback;
      })).rejects.toBe(rollback);
      // A user-authored field that differs from what the recorded hashes explain.
      await expect(db.transaction(async tx => {
        await tx.execute(sql`set local session_replication_role = replica`);
        await tx.execute(sql`update issues set title = 'Edited by a person' where id = ${issue}::uuid`);
        expect(await verify(company, issue, [step], original.owner.contentHash, currentHash, tx as never)).toBe(false);
        throw rollback;
      })).rejects.toBe(rollback);
      expect(await verify(company, issue, [step], original.owner.contentHash, currentHash)).toBe(true);
    });

    it("keeps a retained item current and still refuses a live consumer", async () => {
      const { seeded, originalSnapshot } = await returned();
      const { company, issue, executor, run, user } = seeded.ids;
      const manifest = { id: randomUUID(), companyId: company, agentId: executor, runId: run, issueId: issue, createdAt: new Date() };
      // The item's evidence hash matches the current Task, so a live consumer is refused only by the retained-only lineage.
      const [currentTask] = await db.select().from(issues).where(eq(issues.id, issue));
      const evidenceHash = nativeContextTaskEvidenceHash(nativeContextTaskEvidence(currentTask! as never));
      const item = { id: randomUUID(), companyId: company, manifestId: manifest.id, sourceClass: "task", sourceProvider: "august_works_tasks",
        sourceRef: `issue://${issue}`, sourceVersion: "1", payloadSourceSnapshot: originalSnapshot, contentHash: evidenceHash,
        trustLevel: "high", sensitivity: "internal", rank: 0, selectionReason: "test" } as never;
      const human = { type: "board" as const, source: "session" as const, userId: user, companyIds: [company], isInstanceAdmin: false as const };
      await expect(assertNativeContextTaskSourceCurrent(db as never, { actor: human, companyId: company, agentId: executor,
        issueId: issue, manifest, item, consumption: "retained" })).resolves.toBe(true);
      const agent = { type: "agent" as const, source: "agent_jwt" as const, companyId: company, agentId: executor, runId: run,
        onBehalfOfUserId: user };
      await expect(assertNativeContextTaskSourceCurrent(db as never, { actor: agent, companyId: company, agentId: executor,
        issueId: issue, manifest, item, consumption: "bootstrap" })).resolves.toBe(false);
      await expect(assertNativeContextTaskSourceCurrent(db as never, { actor: agent, companyId: company, agentId: executor,
        issueId: issue, manifest, item })).resolves.toBe(false);
      // A recorded step whose hashes were rewritten to hide a user-authored
      // change (the chain and digests stay consistent) is still refused.
      const rollback = new Error("rollback");
      await expect(db.transaction(async tx => {
        await tx.execute(sql`set local session_replication_role = replica`);
        await tx.execute(sql`update issues set title = 'Edited by a person' where id = ${issue}::uuid`);
        await tx.execute(sql`with h as (select public.aw_native_payload_body_hash('issue',to_jsonb(i)) as next from issues i where i.id=${issue}::uuid),
          s as (select ((i.payload_source_snapshot - 'digest') || jsonb_build_object(
            'owner', (i.payload_source_snapshot->'owner') || jsonb_build_object('contentHash', h.next),
            'transforms', jsonb_build_array((i.payload_source_snapshot->'transforms'->0) || jsonb_build_object('nextOwnerContentHash', h.next))))
            as snap from issues i, h where i.id=${issue}::uuid)
          update issues set payload_source_snapshot = s.snap || jsonb_build_object('digest',encode(sha256(convert_to(s.snap::text,'UTF8')),'hex'))
          from s where issues.id=${issue}::uuid`);
        await expect(assertNativeContextTaskSourceCurrent(tx as never, { actor: human, companyId: company, agentId: executor,
          issueId: issue, manifest, item, consumption: "retained" })).resolves.toBe(false);
        throw rollback;
      })).rejects.toBe(rollback);
    });
  });
  // MS1f (option A′). A parent Run's exact saved Task capture across the later
  // verified board return, for parent-receipt walks only.
  describe("parent receipt Task capture lineage across the board return", () => {
    async function returnedWithCapture() {
      const seeded = await seed();
      const [before] = await db.select({ snapshot: issues.payloadSourceSnapshot }).from(issues).where(eq(issues.id, seeded.ids.issue));
      const saved = before!.snapshot as { owner: { contentHash: string } };
      const source = { kind: "task" as const, issueId: seeded.ids.issue, sourceVersion: "1", contentHash: saved.owner.contentHash };
      // A parent Run (distinct from the round's executor Run) that saved this capture.
      const parentRun = randomUUID();
      await db.insert(heartbeatRuns).values({ id: parentRun, companyId: seeded.ids.company, agentId: seeded.ids.reviewer,
        status: "succeeded", runtimeMode: "native", scopeKind: "issue", issueId: seeded.ids.issue, nativeIssueId: seeded.ids.issue,
        responsibleUserId: seeded.ids.user, finishedAt: new Date(),
        runnerProfileJson: { nativeBootstrapTaskSource: { input: source, payloadSourceSnapshot: before!.snapshot } } });
      const step = await rawReturn(seeded);
      return { seeded: { ...seeded, parentRun }, source, saved: before!.snapshot as Record<string, unknown>, step };
    }
    const lineage = (seeded: Seeded & { parentRun: string }, source: { kind: "task"; issueId: string; sourceVersion: string; contentHash: string },
      parentRunId = seeded.parentRun, db_: Db = db) => verifyNativeParentTaskCaptureLineage(db_ as never, {
        companyId: seeded.ids.company, issueId: seeded.ids.issue, parentRunId, source });

    it("accepts the parent's exact saved capture and refuses another source, another Run or a changed prefix", async () => {
      const { seeded, source, saved } = await returnedWithCapture();
      expect(await lineage(seeded, source)).toBe(true);
      // Not that Run's saved capture.
      expect(await lineage(seeded, { ...source, sourceVersion: "2" })).toBe(false);
      expect(await lineage(seeded, source, randomUUID())).toBe(false);
      const rollback = new Error("rollback");
      // A saved capture whose snapshot is not an exact prefix of the current history.
      for (const tampered of [
        { ...saved, policy: { ...(saved.policy as object), runIds: [randomUUID()] } },
        { ...saved, digest: "c".repeat(64) },
        { ...saved, transforms: [{ kind: "board_stage_return", transitionId: randomUUID(), activityId: randomUUID(), stageId: randomUUID(),
          participantAgentId: randomUUID(), executorAgentId: randomUUID(), decisionId: randomUUID(), taskStatusVersion: 2,
          previousSnapshotDigest: "1".repeat(64), previousOwnerContentHash: "2".repeat(64), nextOwnerContentHash: "3".repeat(64) }] },
      ]) {
        await expect(db.transaction(async tx => {
          await tx.update(heartbeatRuns).set({ runnerProfileJson: { nativeBootstrapTaskSource: { input: source, payloadSourceSnapshot: tampered } } })
            .where(eq(heartbeatRuns.id, seeded.parentRun));
          expect(await lineage(seeded, source, seeded.parentRun, tx as never)).toBe(false);
          throw rollback;
        })).rejects.toBe(rollback);
      }
      // A parent Run on another Task.
      await expect(db.transaction(async tx => {
        await tx.execute(sql`set local session_replication_role = replica`);
        await tx.update(heartbeatRuns).set({ nativeIssueId: randomUUID() }).where(eq(heartbeatRuns.id, seeded.parentRun));
        expect(await lineage(seeded, source, seeded.parentRun, tx as never)).toBe(false);
        throw rollback;
      })).rejects.toBe(rollback);
      // A saved capture whose input names a content hash its own snapshot does not have.
      const misnamed = { ...source, contentHash: "9".repeat(64) };
      await expect(db.transaction(async tx => {
        await tx.update(heartbeatRuns).set({ runnerProfileJson: { nativeBootstrapTaskSource: { input: misnamed, payloadSourceSnapshot: saved } } })
          .where(eq(heartbeatRuns.id, seeded.parentRun));
        expect(await lineage(seeded, misnamed, seeded.parentRun, tx as never)).toBe(false);
        throw rollback;
      })).rejects.toBe(rollback);
      expect(await lineage(seeded, source)).toBe(true);
    });

    it("refuses an unverified suffix step and a user-authored change", async () => {
      const { seeded, source, step } = await returnedWithCapture();
      const rollback = new Error("rollback");
      await expect(db.transaction(async tx => {
        await tx.update(activityLog).set({ details: { changes: {} } }).where(eq(activityLog.id, step.activityId));
        expect(await lineage(seeded, source, seeded.parentRun, tx as never)).toBe(false);
        throw rollback;
      })).rejects.toBe(rollback);
      await expect(db.transaction(async tx => {
        await tx.execute(sql`set local session_replication_role = replica`);
        await tx.execute(sql`update issues set description = 'Edited by a person' where id = ${seeded.ids.issue}::uuid`);
        expect(await lineage(seeded, source, seeded.parentRun, tx as never)).toBe(false);
        throw rollback;
      })).rejects.toBe(rollback);
    });

    it("applies only to a parent receipt of the consuming agent Run, never its own sources", () => {
      const consumer = randomUUID(), parent = randomUUID();
      expect(nativeParentReceiptRunId({ type: "agent", runId: consumer }, parent)).toBe(parent);
      expect(nativeParentReceiptRunId({ type: "agent", runId: consumer }, consumer)).toBeUndefined();
      expect(nativeParentReceiptRunId({ type: "agent", runId: null }, parent)).toBeUndefined();
      expect(nativeParentReceiptRunId({ type: "agent", runId: "" }, parent)).toBeUndefined();
      expect(nativeParentReceiptRunId({ type: "board" }, parent)).toBeUndefined();
      expect(nativeParentReceiptRunId({ type: "board", runId: consumer }, parent)).toBeUndefined();
    });
  });
  // MS1f (historical stage-wake owner). The admission rules for a decision-less
  // stage Reviewer turn that the board returned.
  describe("historical stage Reviewer round turn", () => {
    const reviewerRun = randomUUID(), reviewer = randomUUID(), executor = randomUUID(), executorRun = randomUUID();
    const stageId = randomUUID(), decisionId = randomUUID(), h = (c: string) => c.repeat(64);
    const pending = { status: "pending", currentStageId: stageId, currentStageIndex: 0, currentStageType: "review",
      currentParticipant: { type: "agent", agentId: reviewer, userId: null },
      returnAssignee: { type: "agent", agentId: executor, userId: null }, reviewRequest: null,
      completedStageIds: [], lastDecisionId: null, lastDecisionOutcome: null };
    const entry = { kind: "native_stage_policy" as const, transitionId: randomUUID(), runId: executorRun, ownerKind: "native_status_decision" as const,
      decisionId, receiptHash: h("1"), previousSnapshotDigest: h("2"), previousOwnerContentHash: h("3"), nextOwnerContentHash: h("4") };
    const board = { kind: "board_stage_return" as const, transitionId: randomUUID(), activityId: randomUUID(), stageId,
      participantAgentId: reviewer, executorAgentId: executor, decisionId, taskStatusVersion: 4,
      previousSnapshotDigest: h("5"), previousOwnerContentHash: h("4"), nextOwnerContentHash: h("6") };
    const base = { reviewer: { runId: reviewerRun, agentId: reviewer, contextStageId: stageId }, hasRecordedStageDecision: false,
      origin: { decisionId, executorRunId: executorRun, executorAgentId: executor }, roundReviewerRunIds: [reviewerRun],
      boardStep: board, boardFromState: pending, captureSteps: [entry], currentSteps: [entry, board],
      stageEntryReceipt: { toExecutionState: pending } };
    const state = (patch: Record<string, unknown> = {}) => nativeStageReviewerRoundTurnState({ ...base, ...patch } as never);

    it("admits the Reviewer's own pending state when it equals the board return's from-state", () => {
      expect(state()).toMatchObject({ status: "pending", currentStageId: stageId });
    });
    it("refuses a Run not in the round, another stage, another decision and a recorded stage decision", () => {
      expect(state({ roundReviewerRunIds: [randomUUID()] })).toBeNull();
      expect(state({ roundReviewerRunIds: null })).toBeNull();
      expect(state({ reviewer: { ...base.reviewer, contextStageId: randomUUID() } })).toBeNull();
      expect(state({ boardStep: { ...board, stageId: randomUUID() }, currentSteps: [entry, { ...board, stageId: randomUUID() }] })).toBeNull();
      expect(state({ origin: { ...base.origin, decisionId: randomUUID() } })).toBeNull();
      expect(state({ origin: { ...base.origin, executorRunId: randomUUID() } })).toBeNull();
      expect(state({ origin: { ...base.origin, executorAgentId: randomUUID() } })).toBeNull();
      expect(state({ origin: null })).toBeNull();
      expect(state({ boardStep: { ...board, participantAgentId: randomUUID() } })).toBeNull();
      expect(state({ hasRecordedStageDecision: true })).toBeNull();
      // A recorded board step (right after the capture) of another decision, Reviewer or stage.
      for (const patch of [{ decisionId: randomUUID() }, { participantAgentId: randomUUID() }, { stageId: randomUUID() }]) {
        const other = { ...board, ...patch };
        expect(state({ boardStep: other, currentSteps: [entry, other] }), JSON.stringify(Object.keys(patch))).toBeNull();
      }
    });
    it("refuses a Reviewer state different from the board return's from-state and an intervening change", () => {
      expect(state({ stageEntryReceipt: { toExecutionState: { ...pending, reviewRequest: { instructions: "Other" } } } })).toBeNull();
      expect(state({ stageEntryReceipt: null })).toBeNull();
      // Equal recorded states that are not this Reviewer's pending turn on this stage.
      for (const recorded of [{ ...pending, status: "changes_requested" }, { ...pending, currentStageId: randomUUID() },
        { ...pending, currentParticipant: { type: "user", agentId: null, userId: "someone" } }])
        expect(state({ boardFromState: recorded, stageEntryReceipt: { toExecutionState: recorded } })).toBeNull();
      expect(state({ boardFromState: { ...pending, currentParticipant: { type: "agent", agentId: randomUUID(), userId: null } },
        stageEntryReceipt: { toExecutionState: { ...pending, currentParticipant: { type: "agent", agentId: randomUUID(), userId: null } } } })).toBeNull();
      // Another transform between the Reviewer's capture and the board return.
      const other = { ...entry, transitionId: randomUUID() };
      expect(state({ currentSteps: [entry, other, board] })).toBeNull();
      // A capture that is not an exact prefix, or that does not end at this round's stage entry.
      expect(state({ currentSteps: [{ ...entry, receiptHash: h("9") }, board] })).toBeNull();
      const otherEntry = { ...entry, decisionId: randomUUID() };
      expect(state({ captureSteps: [otherEntry], currentSteps: [otherEntry, board] })).toBeNull();
      const otherRunEntry = { ...entry, runId: randomUUID() };
      expect(state({ captureSteps: [otherRunEntry], currentSteps: [otherRunEntry, board] })).toBeNull();
      expect(state({ captureSteps: [], currentSteps: [board] })).toBeNull();
      expect(state({ boardStep: null })).toBeNull();
    });
  });
});
