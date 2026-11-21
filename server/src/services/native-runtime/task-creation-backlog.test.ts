import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { activityLog, agents, companies, createDb, heartbeatRuns, issues } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { seedCurrentHumanSourceActor } from "../../__tests__/helpers/current-human-source-fixture.js";
import { documentService } from "../documents.js";
import { issueService } from "../issues.js";
import { preparePlatformSkillAdmission } from "../platform-skill-admission.js";
import { blenteraPlatformContractHashes } from "../tool-gateway.js";
import { PaperclipRunnerToolAuthority } from "./paperclip-runner-tool-authority.js";

describe("runner backlog task creation", () => {
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("runner-backlog-");
    db = createDb(temporary.connectionString);
  });
  afterAll(async () => { await temporary?.cleanup(); });

  async function fixture(conversation: boolean) {
    const companyId = randomUUID(), agentId = randomUUID(), issueId = randomUUID(), runId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Backlog", issuePrefix: `B${companyId.slice(0, 6)}` });
    const human = await seedCurrentHumanSourceActor(db, [companyId], randomUUID());
    const responsibleUserId = human.userId!;
    await db.insert(agents).values({ id: agentId, companyId, name: "Planner", role: "ceo", status: "active", adapterType: "paperclip_runner" });
    await db.insert(issues).values({ id: issueId, companyId, title: "Coordinate", status: "in_progress", assigneeAgentId: agentId,
      responsibleUserId, conversationAgentId: conversation ? agentId : null, conversationUserId: conversation ? responsibleUserId : null,
      conversationState: conversation ? "active" : null });
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, responsibleUserId, status: "running", runtimeMode: "native",
      nativeIssueId: issueId, invocationSource: "assignment", triggerDetail: "system", contextSnapshot: { issueId } });
    await db.update(issues).set({ executionRunId: runId }).where(eq(issues.id, issueId));
    await preparePlatformSkillAdmission(db, { companyId, agentId, runId, responsibleUserId,
      requireExisting: false }, blenteraPlatformContractHashes());
    const enqueueWakeup = vi.fn().mockResolvedValue(null);
    const binding = { companyId, agentId, issueId, runId, enqueueWakeup };
    return { companyId, agentId, issueId, runId, binding, enqueueWakeup, authority: new PaperclipRunnerToolAuthority(db, binding) };
  }

  it.each([false, true])("persists the plan without waking an assigned backlog task (conversation=%s)", async conversation => {
    const f = await fixture(conversation);
    const call = { tool: "create_task", callId: "save-later", arguments: { idempotencyKey: "save-later", title: "Plan for later", status: "backlog", initialPlan: "1. Check status.\n2. Save the plan.\n3. Confirm creation." } };
    const receipt = await f.authority.execute(call) as { task: { id: string } };
    expect(receipt).toMatchObject({ scheduledWakeIds: [], task: { status: "backlog", assigneeActorId: f.agentId, parentId: conversation ? null : f.issueId } });
    const [task] = await db.select().from(issues).where(eq(issues.id, receipt.task.id));
    expect(task).toMatchObject({ status: "backlog", executionRunId: null, startedAt: null });
    expect(await documentService(db).getIssueDocumentByKey(task!.id, "plan")).toMatchObject({ body: call.arguments.initialPlan });
    expect(f.enqueueWakeup).not.toHaveBeenCalled();
    await expect(f.authority.execute({ ...call, callId: "retry" })).resolves.toEqual(receipt);

    const replacement = randomUUID();
    const [currentRun] = await db.select({ responsibleUserId: heartbeatRuns.responsibleUserId })
      .from(heartbeatRuns).where(eq(heartbeatRuns.id, f.runId));
    await db.insert(heartbeatRuns).values({ id: replacement, companyId: f.companyId, agentId: f.agentId,
      responsibleUserId: currentRun!.responsibleUserId, status: "running", runtimeMode: "native", nativeIssueId: f.issueId,
      invocationSource: "assignment", triggerDetail: "system" });
    await db.update(issues).set({ executionRunId: replacement }).where(eq(issues.id, f.issueId));
    await preparePlatformSkillAdmission(db, { companyId: f.companyId, agentId: f.agentId, runId: replacement,
      responsibleUserId: currentRun!.responsibleUserId, requireExisting: false }, blenteraPlatformContractHashes());
    await expect(new PaperclipRunnerToolAuthority(db, { ...f.binding, runId: replacement }).execute(call)).resolves.toMatchObject({ task: { id: task!.id, status: "backlog" }, scheduledWakeIds: [] });
    expect(f.enqueueWakeup).not.toHaveBeenCalled();
    const events = await db.select().from(activityLog).where(and(eq(activityLog.entityId, task!.id), eq(activityLog.action, "issue.created")));
    expect(events).toHaveLength(1);
    expect(events[0]!.details).toMatchObject({ status: "backlog" });
  });

  it.each(["todo", "done"])("keeps an explicit backlog hold with a %s prerequisite", async status => {
    const f = await fixture(true);
    const blockerId = randomUUID();
    await db.insert(issues).values({ id: blockerId, companyId: f.companyId, title: "Prerequisite", status });
    const receipt = await f.authority.execute({ tool: "create_task", callId: "held", arguments: { idempotencyKey: "held", title: "Held task", status: "backlog", blockedByTaskIds: [blockerId] } }) as { task: { id: string } };
    expect(receipt).toMatchObject({ task: { status: "backlog" }, scheduledWakeIds: [] });
    expect(await issueService(db).getRelationSummaries(receipt.task.id)).toMatchObject({ blockedBy: [expect.objectContaining({ id: blockerId })] });
    expect(f.enqueueWakeup).not.toHaveBeenCalled();
  });

  it.each(["in_progress", "done", "blocked", null])("rejects unsupported initial status %s before mutation", async status => {
    const f = await fixture(true);
    await expect(f.authority.execute({ tool: "create_task", callId: "invalid", arguments: { idempotencyKey: "invalid", title: "Invalid", status } })).rejects.toThrow();
    expect(await db.select().from(issues).where(eq(issues.companyId, f.companyId))).toHaveLength(1);
    expect(f.enqueueWakeup).not.toHaveBeenCalled();
  });

  it("refuses a retained Native create command after the conversation generation changes", async () => {
    const f = await fixture(true);
    await db.update(issues).set({ conversationSessionGeneration: 1 }).where(eq(issues.id, f.issueId));
    await expect(f.authority.execute({ tool: "create_task", callId: "old-session", arguments: {
      idempotencyKey: "old-session", title: "Stale session task", status: "backlog",
    } })).rejects.toThrow("paperclip_runner_conversation_generation_changed");
    expect(await db.select().from(issues).where(eq(issues.companyId, f.companyId))).toHaveLength(1);
    expect(f.enqueueWakeup).not.toHaveBeenCalled();
  });

  it("refuses replay of an actual saved receipt after resetting its conversation", async () => {
    const f = await fixture(true), call = { tool: "create_task", callId: "saved", arguments: {
      idempotencyKey: "saved", title: "Saved task", status: "backlog",
    } };
    await f.authority.execute(call);
    await db.update(issues).set({ conversationSessionGeneration: 1 }).where(eq(issues.id, f.issueId));
    await expect(f.authority.execute({ ...call, callId: "replay" })).rejects.toThrow("paperclip_runner_conversation_generation_changed");
    expect(await db.select().from(issues).where(eq(issues.companyId, f.companyId))).toHaveLength(2);
    expect(f.enqueueWakeup).not.toHaveBeenCalled();
  });

  it("rolls back the task and receipt when its conversation resets after the real task insert", async () => {
    const f = await fixture(true);
    await db.execute(sql`create function aw_v9_test_reset_native_task_source() returns trigger language plpgsql as $$
      begin
        if NEW.origin_id like 'paperclip-runner:create-task:%' then
          update issues set conversation_session_generation=conversation_session_generation+1
            where company_id=NEW.company_id and id=(select native_issue_id from heartbeat_runs where id::text=NEW.origin_run_id);
        end if;
        return NEW;
      end $$`);
    await db.execute(sql`create trigger aw_v9_test_native_task_late_reset after insert on issues
      for each row execute function aw_v9_test_reset_native_task_source()`);
    try {
      await expect(f.authority.execute({ tool: "create_task", callId: "late-reset", arguments: {
        idempotencyKey: "late-reset", title: "Late reset task", status: "backlog",
      } })).rejects.toThrow("paperclip_runner_conversation_generation_changed");
      expect(await db.select().from(issues).where(eq(issues.companyId, f.companyId))).toEqual([
        expect.objectContaining({ id: f.issueId, conversationSessionGeneration: 0 }),
      ]);
      expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.runId)))[0]?.resultJson).toBeNull();
      expect(await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.companyId), eq(activityLog.action, "issue.created")))).toEqual([]);
      expect(f.enqueueWakeup).not.toHaveBeenCalled();
    } finally {
      await db.execute(sql`drop trigger aw_v9_test_native_task_late_reset on issues`);
      await db.execute(sql`drop function aw_v9_test_reset_native_task_source()`);
    }
  });
});
