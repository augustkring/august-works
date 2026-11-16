import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { agentWakeupRequests, agents, companies, createDb, heartbeatRuns, issues } from "@paperclipai/db";
import { decideRunLivenessContinuation } from "../services/run-continuations.js";
import {
  captureNativeRunLivenessContinuationTrigger,
  type NativeRunLivenessContinuationDiagnostic,
} from "../services/native-runtime/native-liveness-continuation-source.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

// The bounded run-liveness continuation record is read from persisted rows
// only. Each binding below is refused on its own (ledger T3).
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("Native run-liveness continuation source record", () => {
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("paperclip-native-liveness-continuation-");
    db = createDb(temporary.connectionString);
  }, 30_000);
  afterAll(async () => { await temporary?.cleanup(); });

  async function fixture(sourceIssue?: "other", receiver: "native" | "pending" = "native") {
    const companyId = randomUUID(), agentId = randomUUID(), issueId = randomUUID();
    const sourceRunId = randomUUID(), runId = randomUUID(), wakeId = randomUUID();
    const humanId = "human-liveness-owner", session = `session-${randomUUID()}`;
    await db.insert(companies).values({ id: companyId, name: "Liveness", issuePrefix: `L${companyId.slice(0, 6)}` });
    await db.insert(agents).values({ id: agentId, companyId, name: "Worker", adapterType: "paperclip_runner" });
    await db.insert(issues).values({ id: issueId, companyId, title: "Continue a plan", status: "todo", assigneeAgentId: agentId });
    // A Run's source binding is immutable in the database, so another Task is set at insert.
    const sourceIssueId = sourceIssue ? randomUUID() : issueId;
    if (sourceIssue) await db.insert(issues).values({ id: sourceIssueId, companyId, title: "Other" });
    const source = { id: sourceRunId, companyId, agentId, runtimeMode: "native", nativeIssueId: sourceIssueId, status: "succeeded",
      responsibleUserId: humanId, livenessState: "plan_only", livenessReason: "Run described a plan without acting",
      nextAction: "Inspect the repository and implement the fix.", continuationAttempt: 0, sessionIdAfter: session,
      contextSnapshot: { issueId, taskId: issueId }, createdAt: new Date(Date.now() - 60_000) };
    await db.insert(heartbeatRuns).values(source);
    const [issue] = await db.select().from(issues).where(eq(issues.id, issueId));
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    const [sourceRow] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, sourceRunId));
    // The real producer decides the payload, context and idempotency key.
    const decision = decideRunLivenessContinuation({ run: sourceRow!, issue: issue!, agent: agent!, livenessState: "plan_only",
      livenessReason: sourceRow!.livenessReason, nextAction: sourceRow!.nextAction, budgetBlocked: false, idempotentWakeExists: false });
    if (decision.kind !== "enqueue") throw new Error("liveness_fixture_not_enqueued");
    await db.insert(agentWakeupRequests).values({ id: wakeId, companyId, agentId, source: "automation", triggerDetail: "system",
      reason: "run_liveness_continuation", payload: decision.payload, status: "claimed", requestedByActorType: "system",
      requestedByActorId: "heartbeat", idempotencyKey: decision.idempotencyKey });
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId,
      ...(receiver === "native" ? { runtimeMode: "native", nativeIssueId: issueId } : { runtimeMode: "legacy" }),
      status: "running", responsibleUserId: humanId, wakeupRequestId: wakeId, sessionIdBefore: session,
      invocationSource: "automation", triggerDetail: "system",
      contextSnapshot: { ...decision.contextSnapshot, originIdentityContextId: null, parentRunId: sourceRunId,
        wakeSource: "automation", wakeTriggerDetail: "system" } });
    await db.update(agentWakeupRequests).set({ runId }).where(eq(agentWakeupRequests.id, wakeId));
    await db.update(heartbeatRuns).set({ continuationAttempt: decision.nextAttempt }).where(eq(heartbeatRuns.id, sourceRunId));
    return { companyId, agentId, issueId, sourceRunId, runId, wakeId, humanId, session };
  }

  async function capture(f: Awaited<ReturnType<typeof fixture>>, issueId = f.issueId) {
    const diagnostics: NativeRunLivenessContinuationDiagnostic[] = [];
    const value = await captureNativeRunLivenessContinuationTrigger(db, { companyId: f.companyId, issueId, runId: f.runId,
      onDiagnostic: reason => diagnostics.push(reason) });
    return { value, diagnostics };
  }

  it("captures the exact record of a heartbeat-written continuation", async () => {
    const f = await fixture();
    const { value } = await capture(f);
    // The same record before the Run is resolved to Native (unresolved legacy row).
    const pending = await fixture(undefined, "pending");
    expect((await capture(pending)).value).toMatchObject({ runId: pending.runId, sourceRunId: pending.sourceRunId });
    expect(value).toEqual({ version: 1, companyId: f.companyId, issueId: f.issueId, runId: f.runId, agentId: f.agentId,
      responsibleUserId: f.humanId, wakeupRequestId: f.wakeId, sourceRunId: f.sourceRunId, sourceSessionId: f.session,
      state: "plan_only", reason: "Run described a plan without acting",
      instruction: "Inspect the repository and implement the fix.", attempt: 1, maxAttempts: 2,
      idempotencyKey: `run_liveness_continuation:${f.issueId}:${f.sourceRunId}:plan_only:1` });
  });

  const refusals: Array<[string, NativeRunLivenessContinuationDiagnostic,
    (f: Awaited<ReturnType<typeof fixture>>) => Promise<unknown>]> = [
    ["another Task", "receiver_unavailable", async () => undefined],
    ["a continuation Run resolved to legacy", "receiver_unavailable", f => db.update(heartbeatRuns).set({ runtimeModeResolvedAt: new Date() }).where(eq(heartbeatRuns.id, f.runId))],
    ["another wake reason", "receiver_context_invalid", async f => {
      const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.runId));
      await db.update(heartbeatRuns).set({ contextSnapshot: { ...run!.contextSnapshot, wakeReason: "issue_commented" } }).where(eq(heartbeatRuns.id, f.runId));
    }],
    ["another parent Run", "receiver_context_invalid", async f => {
      const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.runId));
      await db.update(heartbeatRuns).set({ contextSnapshot: { ...run!.contextSnapshot, parentRunId: randomUUID() } }).where(eq(heartbeatRuns.id, f.runId));
    }],
    ["a Human-requested wake", "wake_invalid", f => db.update(agentWakeupRequests).set({ requestedByActorType: "user", requestedByActorId: f.humanId }).where(eq(agentWakeupRequests.id, f.wakeId))],
    ["another idempotency key", "wake_invalid", f => db.update(agentWakeupRequests).set({ idempotencyKey: `run_liveness_continuation:${f.issueId}:${f.sourceRunId}:plan_only:2` }).where(eq(agentWakeupRequests.id, f.wakeId))],
    ["a changed wake payload", "wake_invalid", async f => {
      const [wake] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, f.wakeId));
      await db.update(agentWakeupRequests).set({ payload: { ...wake!.payload, instruction: "Do something else." } }).where(eq(agentWakeupRequests.id, f.wakeId));
    }],
    ["a wake of another Run", "wake_unavailable", f => db.update(agentWakeupRequests).set({ runId: f.sourceRunId }).where(eq(agentWakeupRequests.id, f.wakeId))],
    ["a source Run of another Agent", "source_binding_invalid", async f => {
      const otherAgentId = randomUUID();
      await db.insert(agents).values({ id: otherAgentId, companyId: f.companyId, name: "Other", adapterType: "paperclip_runner" });
      await db.update(heartbeatRuns).set({ agentId: otherAgentId }).where(eq(heartbeatRuns.id, f.sourceRunId));
    }],
    ["a source Run of another Task", "source_binding_invalid", async () => undefined],
    ["a source Run of another responsible Human", "source_binding_invalid", f => db.update(heartbeatRuns).set({ responsibleUserId: "another-human" }).where(eq(heartbeatRuns.id, f.sourceRunId))],
    ["a failed source Run", "source_state_invalid", f => db.update(heartbeatRuns).set({ status: "failed" }).where(eq(heartbeatRuns.id, f.sourceRunId))],
    ["an advanced source Run", "source_state_invalid", f => db.update(heartbeatRuns).set({ livenessState: "advanced" }).where(eq(heartbeatRuns.id, f.sourceRunId))],
    ["another attempt counter", "source_state_invalid", f => db.update(heartbeatRuns).set({ continuationAttempt: 2 }).where(eq(heartbeatRuns.id, f.sourceRunId))],
    ["a changed next action", "source_state_invalid", f => db.update(heartbeatRuns).set({ nextAction: "Changed." }).where(eq(heartbeatRuns.id, f.sourceRunId))],
    ["another session", "session_binding_invalid", f => db.update(heartbeatRuns).set({ sessionIdBefore: "session-other" }).where(eq(heartbeatRuns.id, f.runId))],
    ["a source Run without a session", "session_binding_invalid", async f => {
      await db.update(heartbeatRuns).set({ sessionIdAfter: null }).where(eq(heartbeatRuns.id, f.sourceRunId));
      await db.update(heartbeatRuns).set({ sessionIdBefore: null }).where(eq(heartbeatRuns.id, f.runId));
    }],
    ["a source Run created after the continuation", "source_binding_invalid", f => db.update(heartbeatRuns).set({ createdAt: new Date(Date.now() + 60_000) }).where(eq(heartbeatRuns.id, f.sourceRunId))],
  ];
  it.each(refusals)("refuses %s", async (label, expected, mutate) => {
    const f = await fixture(label === "a source Run of another Task" ? "other" : undefined,
      label === "a continuation Run resolved to legacy" ? "pending" : "native");
    await mutate(f);
    const { value, diagnostics } = await capture(f, label === "another Task" ? randomUUID() : f.issueId);
    expect(value).toBeNull();
    expect(diagnostics).toEqual([expected]);
  });

  it("refuses another company", async () => {
    const f = await fixture(), other = await fixture(), diagnostics: NativeRunLivenessContinuationDiagnostic[] = [];
    expect(await captureNativeRunLivenessContinuationTrigger(db, { companyId: other.companyId, issueId: f.issueId, runId: f.runId,
      onDiagnostic: reason => diagnostics.push(reason) })).toBeNull();
    expect(diagnostics).toEqual(["receiver_unavailable"]);
  });
});
