import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, heartbeatRuns, issues, memoryDeletionMarkers } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { issueService } from "../services/issues.js";
import { PaperclipRunnerToolAuthority } from "../services/native-runtime/paperclip-runner-tool-authority.js";
import { assertAnalyticalContextPayloadAccess } from "../services/analytical-context-authority.js";
import { lockMemoryPrivacy, purgeDerivedWorkflowMemory } from "../services/memory/memory-privacy.js";
import { documentService } from "../services/documents.js";

describe("Native saved tasks inherit their actual originating source erasure", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let f: Awaited<ReturnType<typeof seedV5Presences>>, conversationId: string, runId: string, taskId: string;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("aw-v9-native-task-source-"); db = createDb(database.connectionString);
    await instanceSettingsService(db).getExperimental(); await enableV5ForTest(db);
  }, 60000);
  afterAll(async () => { await database?.cleanup(); }, 30000);
  beforeEach(async () => {
    f = await seedV5Presences(db);
    const conversation = await issueService(db).create(f.home, { title: "Source conversation", assigneeAgentId: f.presence.id,
      conversationAgentId: f.presence.id, conversationUserId: f.userId, conversationState: "active", status: "in_progress" });
    conversationId = conversation.id;
    const [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, responsibleUserId: f.userId,
      status: "running", runtimeMode: "native", nativeIssueId: conversationId, contextSnapshot: { conversationSessionGeneration: 0 } }).returning();
    runId = run!.id;
    await db.update(issues).set({ executionRunId: runId }).where(eq(issues.id, conversationId));
    const receipt = await new PaperclipRunnerToolAuthority(db, { companyId: f.home, agentId: f.presence.id, runId, issueId: conversationId })
      .execute({ tool: "create_task", callId: "derived", arguments: { idempotencyKey: randomUUID(), status: "backlog",
        title: "PRIVATE derived task", description: "PRIVATE derived task body", initialPlan: "PRIVATE derived plan" } }) as { task: { id: string } };
    taskId = receipt.task.id;
  });
  const markSource = () => db.insert(memoryDeletionMarkers).values({ companyId: f.home, kind: "source", key: `memory-run-source-erasure:v1:${runId}` });
  async function nextTask(parentId: string) {
    const [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, responsibleUserId: f.userId,
      status: "running", runtimeMode: "native", nativeIssueId: parentId }).returning();
    await db.update(issues).set({ executionRunId: run!.id }).where(eq(issues.id, parentId));
    const receipt = await new PaperclipRunnerToolAuthority(db, { companyId: f.home, agentId: f.presence.id, runId: run!.id, issueId: parentId })
      .execute({ tool: "create_task", callId: "descendant", arguments: { idempotencyKey: randomUUID(), status: "backlog",
        title: "PRIVATE second task", description: "PRIVATE descendant body", initialPlan: "PRIVATE descendant plan" } }) as { task: { id: string } };
    return { runId: run!.id, taskId: receipt.task.id };
  }
  it("denies the ordinary task payload after erasing its originating run", async () => {
    await expect(assertAnalyticalContextPayloadAccess(db, f.home, f.actor, { issueId: taskId })).resolves.toBeUndefined();
    await markSource();
    await expect(assertAnalyticalContextPayloadAccess(db, f.home, f.actor, { issueId: taskId }))
      .rejects.toMatchObject({ status: 403, details: { code: "analytical_source_access_lost" } });
    const [source] = await db.execute<{ erased: boolean }>(sql`select aw_workflow_memory_erased(${f.home}::uuid,null,${taskId}::uuid) as erased`);
    expect(source?.erased).toBe(true);
  });
  it("scrubs the actual derived task through the Original transactional erasure owner", async () => {
    await db.transaction(async rawTx => {
      const tx = rawTx as unknown as typeof db; await lockMemoryPrivacy(tx, f.home);
      await tx.insert(memoryDeletionMarkers).values({ companyId: f.home, kind: "source", key: `memory-run-source-erasure:v1:${runId}` });
      await purgeDerivedWorkflowMemory(tx, f.home, [], new Date(), { workflowRevisionIds: [], artifactVersionIds: [], runIds: [runId] });
    });
    const [task] = await db.select().from(issues).where(and(eq(issues.companyId, f.home), eq(issues.id, taskId)));
    expect(task?.description).toBeNull(); expect(task?.title).not.toContain("PRIVATE");
    expect((await documentService(db).getIssueDocumentByKey(taskId, "plan"))?.body).not.toContain("PRIVATE");
    expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)))[0]?.resultJson).toBeNull();
    await expect(assertAnalyticalContextPayloadAccess(db, f.home, f.actor, { issueId: taskId }))
      .rejects.toMatchObject({ status: 403 });
  });
  it("inherits erasure through a second actual Native task and scrubs both saved results", async () => {
    const descendant = await nextTask(taskId);
    const unrelated = await issueService(db).create(f.home, { title: "Unrelated work", description: "Keep this body" });
    await markSource();
    await expect(assertAnalyticalContextPayloadAccess(db, f.home, f.actor, { issueId: descendant.taskId })).rejects.toMatchObject({ status: 403 });
    await expect(assertAnalyticalContextPayloadAccess(db, f.home, f.actor, { runId: descendant.runId })).rejects.toMatchObject({ status: 403 });
    await db.transaction(async rawTx => {
      const tx = rawTx as unknown as typeof db; await lockMemoryPrivacy(tx, f.home);
      await purgeDerivedWorkflowMemory(tx, f.home, [], new Date(), { workflowRevisionIds: [], artifactVersionIds: [], runIds: [runId] });
    });
    for (const id of [taskId, descendant.taskId]) {
      const current = await issueService(db).getById(id);
      expect(current?.title).not.toContain("PRIVATE"); expect(current?.description).toBeNull();
      expect((await documentService(db).getIssueDocumentByKey(id, "plan"))?.body).not.toContain("PRIVATE");
    }
    expect(await issueService(db).getById(unrelated.id)).toMatchObject({ title: "Unrelated work", description: "Keep this body" });
  });
  it.each(["missing", "malformed", "foreign", "mismatched", "cycle"])("withholds invalid Native task provenance: %s", async failure => {
    let originRunId = randomUUID(), originIssueId = conversationId;
    if (failure === "malformed") originRunId = "untrusted malformed origin";
    else if (failure === "foreign") {
      const [foreignRun] = await db.insert(heartbeatRuns).values({ companyId: f.guest, agentId: f.guestPresence.id,
        status: "running", runtimeMode: "native" }).returning(); originRunId = foreignRun!.id;
    } else if (failure === "mismatched") { originRunId = runId; originIssueId = randomUUID(); }
    else if (failure === "cycle") {
      const [cyclicRun] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id,
        status: "running", runtimeMode: "native", nativeIssueId: taskId }).returning();
      originRunId = cyclicRun!.id; originIssueId = taskId;
    }
    await db.update(issues).set({ originRunId, originId: `paperclip-runner:create-task:${originIssueId}:invalid` }).where(eq(issues.id, taskId));
    await expect(assertAnalyticalContextPayloadAccess(db, f.home, f.actor, { issueId: taskId })).rejects.toMatchObject({ status: 403 });
  });
  it("withholds an over-budget ancestry rather than approving a partial source chain", async () => {
    let parent = taskId;
    // Adversarial persisted graph, not claimed model/runtime qualification.
    for (let depth = 0; depth < 16; depth++) {
      const [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id,
        runtimeMode: "native", nativeIssueId: parent, status: "queued" }).returning();
      const [child] = await db.insert(issues).values({ companyId: f.home, title: "Bounded ancestor fixture", status: "backlog",
        createdByAgentId: f.presence.id, originKind: "manual", originRunId: run!.id,
        originId: `paperclip-runner:create-task:${parent}:depth-${depth}` }).returning();
      parent = child!.id;
      if (depth === 14) await expect(assertAnalyticalContextPayloadAccess(db, f.home, f.actor, { issueId: parent })).resolves.toBeUndefined();
    }
    await expect(assertAnalyticalContextPayloadAccess(db, f.home, f.actor, { issueId: parent })).rejects.toMatchObject({ status: 403 });
  });
  it("scrubs a NEW Native run binding to an erased task before its row exists", async () => {
    await markSource();
    const [retained] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id,
      runtimeMode: "native", nativeIssueId: taskId, status: "queued", contextSnapshot: { prompt: "PRIVATE" },
      resultJson: { prose: "PRIVATE" }, stdoutExcerpt: "PRIVATE", stderrExcerpt: "PRIVATE" }).returning();
    expect(retained).toMatchObject({ contextSnapshot: {}, resultJson: null, stdoutExcerpt: null, stderrExcerpt: null });
    await expect(assertAnalyticalContextPayloadAccess(db, f.home, f.actor, { runId: retained!.id })).rejects.toMatchObject({ status: 403 });
  });
  it("rolls back a Native mutation when source erasure occurs after the task insert", async () => {
    await db.execute(sql`create function aw_v9_test_erase_native_task_source() returns trigger language plpgsql as $$
      begin
        if NEW.origin_id like 'paperclip-runner:create-task:%' then
          insert into memory_deletion_markers(company_id,kind,key)
            values(NEW.company_id,'source','memory-run-source-erasure:v1:'||NEW.origin_run_id) on conflict do nothing;
        end if;
        return NEW;
      end $$`);
    await db.execute(sql`create trigger aw_v9_test_native_task_late_erasure after insert on issues
      for each row execute function aw_v9_test_erase_native_task_source()`);
    try {
      await expect(nextTask(taskId)).rejects.toMatchObject({ status: 403, details: { code: "analytical_source_access_lost" } });
      expect(await db.select().from(issues).where(eq(issues.companyId, f.home))).toHaveLength(2);
      expect(await db.select().from(memoryDeletionMarkers).where(eq(memoryDeletionMarkers.companyId, f.home))).toEqual([]);
    } finally {
      await db.execute(sql`drop trigger aw_v9_test_native_task_late_erasure on issues`);
      await db.execute(sql`drop function aw_v9_test_erase_native_task_source()`);
    }
  });
});
