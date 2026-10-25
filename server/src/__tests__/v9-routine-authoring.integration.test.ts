import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { activityLog, authUsers, companyMemberships, createDb, documents, heartbeatRuns, issues, memoryDeletionMarkers, principalPermissionGrants, routineDocuments, routineRevisions, routineRuns, routines, routineTriggers, toolPolicies } from "@paperclipai/db";
import { createToolGatewayService } from "../services/tool-gateway.js";
import { conversationAuthoringService } from "../services/experience/conversation-authoring.js";
import { createRoutineTriggerSchema, createRoutineSchema } from "@paperclipai/shared";
import { assertAnalyticalContextPayloadAccess } from "../services/analytical-context-authority.js";
import { routineService } from "../services/routines.js";
import { lockMemoryPrivacy, purgeDerivedWorkflowMemory } from "../services/memory/memory-privacy.js";
import { routineAuthoringToolsService } from "../services/routine-authoring-tools.js";
import { issueService } from "../services/issues.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { workflowService } from "../services/workflows/workflow-service.js";
import { assertRoutineSourceAccess } from "../services/routine-source-authority.js";
import { companyPortabilityService } from "../services/company-portability.js";

describe("Conversation routine drafts use the Original owner without execution authority", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let f: Awaited<ReturnType<typeof seedV5Presences>>, conversationId: string, runId: string;
  const input = () => ({ idempotencyKey: "weekly-review", title: "Weekly reviewed research", description: "PRIVATE saved intent", priority: "medium" });
  const context = () => ({ companyId: f.home, agentId: f.presence.id, runId });
  const create = (value: unknown = input()) => routineAuthoringToolsService(db).create(context(), value);
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("aw-v9-routine-authoring-"); db = createDb(database.connectionString);
    await instanceSettingsService(db).getExperimental(); await enableV5ForTest(db);
  }, 60000);
  afterAll(async () => { await database?.cleanup(); }, 30000);
  beforeEach(async () => {
    await instanceSettingsService(db).updateExperimental({ experience_projection_v9: true, ambient_commands_v9: true });
    f = await seedV5Presences(db);
    await db.insert(principalPermissionGrants).values({ companyId: f.home, principalType: "agent", principalId: f.presence.id,
      permissionKey: "tasks:assign" }).onConflictDoNothing();
    const conversation = await issueService(db).create(f.home, { title: "Owned routine authoring conversation", assigneeAgentId: f.presence.id,
      conversationAgentId: f.presence.id, conversationUserId: f.userId, conversationState: "active", status: "in_progress", createdByUserId: f.userId });
    conversationId = conversation.id;
    const [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, responsibleUserId: f.userId,
      nativeIssueId: conversationId, runtimeMode: "native", status: "running", contextSnapshot: { conversationSessionGeneration: 0 } }).returning();
    runId = run!.id; await db.update(issues).set({ executionRunId: runId }).where(eq(issues.id, conversationId));
  });
  it("creates one owned inactive unconfigured draft and replays its Original identity", async () => {
    const first = await create();
    expect(first).toMatchObject({ status: "created", enabled: false, executionConfigured: false, requiresHumanReview: true,
      href: `/routines/${first.routineId}`, currentRevisionNumber: 1 });
    const [saved] = await db.select().from(routines).where(eq(routines.id, first.routineId));
    expect(saved).toMatchObject({ title: input().title, description: input().description, status: "paused", executionTargetKind: null,
      executionTargetRef: null, assigneeAgentId: null, responsibleUserId: f.userId, originKind: "conversation_draft", originId: runId });
    expect(await create()).toEqual({ ...first, status: "replayed" });
    expect(await db.select().from(routineRevisions).where(eq(routineRevisions.routineId, first.routineId))).toHaveLength(1);
    expect(await db.select().from(routineTriggers).where(eq(routineTriggers.routineId, first.routineId))).toEqual([]);
    expect(await db.select().from(routineRuns).where(eq(routineRuns.routineId, first.routineId))).toEqual([]);
    expect(JSON.stringify(first)).not.toMatch(/PRIVATE|description|credential/);
  });
  it("refuses changed request content instead of overwriting the existing draft", async () => {
    const saved = await create();
    await expect(create({ ...input(), title: "Different intent" })).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(routines).where(eq(routines.id, saved.routineId))).toHaveLength(1);
  });
  it.each(["status", "executionTarget", "env", "responsibleUserId"])("refuses model-supplied authority field %s", async field => {
    await expect(create({ ...input(), [field]: field === "status" ? "active" : randomUUID() })).rejects.toThrow();
    expect(await db.select().from(routines).where(eq(routines.companyId, f.home))).toEqual([]);
  });
  it("refuses an earlier conversation generation and actual responsible-user membership withdrawal", async () => {
    await db.update(issues).set({ conversationSessionGeneration: 1 }).where(eq(issues.id, conversationId));
    await expect(create()).rejects.toMatchObject({ status: 403 });
    await db.update(issues).set({ conversationSessionGeneration: 0 }).where(eq(issues.id, conversationId));
    await db.delete(companyMemberships).where(and(eq(companyMemberships.companyId, f.home),
      eq(companyMemberships.principalId, f.userId), eq(companyMemberships.principalType, "user")));
    await expect(create()).rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(routines).where(eq(routines.companyId, f.home))).toEqual([]);
  });
  it("exports ordinary routines and only releases a private draft to its current source owner", async () => {
    await create();
    await routineService(db, { sourceActor: f.actor }).create(f.home,
      createRoutineSchema.parse({ title: "Ordinary paused schedule", status: "paused" }), { userId: f.userId });

    const ownerExport = await companyPortabilityService(db).exportBundle(f.home,
      { include: { company: true, agents: false, projects: false, issues: true } }, { actor: f.actor });
    expect(ownerExport.manifest.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ recurring: true, title: input().title, description: input().description }),
      expect.objectContaining({ recurring: true, title: "Ordinary paused schedule" }),
    ]));
    expect(ownerExport.files["tasks/weekly-reviewed-research/TASK.md"]).toContain(input().description);
    expect(ownerExport.files["tasks/ordinary-paused-schedule/TASK.md"]).toContain("Ordinary paused schedule");

    const otherId = `routine-export-${randomUUID()}`;
    const now = new Date();
    await db.insert(authUsers).values({ id: otherId, name: "Other Human", email: `${otherId}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId: f.home, principalType: "user", principalId: otherId,
      membershipRole: "viewer", status: "active" });
    const otherActor = { type: "board" as const, source: "session" as const, userId: otherId, isInstanceAdmin: true };
    const otherExport = await companyPortabilityService(db).exportBundle(f.home,
      { include: { company: true, agents: false, projects: false, issues: true } }, { actor: otherActor });
    expect(otherExport.manifest.issues.some(issue => issue.title === input().title)).toBe(false);
    expect(otherExport.manifest.issues.some(issue => issue.title === "Ordinary paused schedule")).toBe(true);

    const retiredAt = new Date();
    await db.update(issues).set({ conversationAgentId: null, conversationUserId: null, conversationState: null,
      conversationRetiredAt: retiredAt, status: "cancelled", cancelledAt: retiredAt, hiddenAt: retiredAt,
      assigneeAgentId: null, assigneeUserId: null, executionRunId: null, checkoutRunId: null })
      .where(eq(issues.id, conversationId));
    const afterWithdrawal = await companyPortabilityService(db).exportBundle(f.home,
      { include: { company: true, agents: false, projects: false, issues: true } }, { actor: f.actor });
    expect(afterWithdrawal.manifest.issues.some(issue => issue.title === input().title)).toBe(false);
    expect(afterWithdrawal.manifest.issues.some(issue => issue.title === "Ordinary paused schedule")).toBe(true);
  });
  it("rejects reclassifying the actual private conversation source as manual or another origin", async () => {
    const saved = await create();
    for (const patch of [{ originKind: "manual" }, { originId: randomUUID() },
      { originKind: "manual", originId: null }]) {
      await expect(db.update(routines).set(patch).where(eq(routines.id, saved.routineId)))
        .rejects.toMatchObject({ cause: { code: "23514" } });
    }
    expect(await db.select().from(routines).where(eq(routines.id, saved.routineId))).toEqual([
      expect.objectContaining({ originKind: "conversation_draft", originId: runId, description: input().description }),
    ]);
  });
  it("withdraws ordinary reads, list entries and execution after erasing the actual authoring source", async () => {
    const saved = await create(), owner = routineService(db, { sourceActor: f.actor });
    expect(await owner.get(saved.routineId)).toMatchObject({ id: saved.routineId, title: input().title });
    await db.insert(memoryDeletionMarkers).values({ companyId: f.home, kind: "source", key: `memory-run-source-erasure:v1:${runId}` });
    await expect(owner.get(saved.routineId)).rejects.toMatchObject({ status: 403 });
    expect(await owner.list(f.home)).toEqual([]);
    await expect(owner.runRoutine(saved.routineId, { source: "manual" }, { userId: f.userId })).rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(routineRuns).where(eq(routineRuns.routineId, saved.routineId))).toEqual([]);
  });
  it("uses the Original erasure owner to scrub the saved routine, revisions and linked description", async () => {
    const saved = await create();
    await db.transaction(async rawTx => {
      const tx = rawTx as unknown as typeof db; await lockMemoryPrivacy(tx, f.home);
      await tx.insert(memoryDeletionMarkers).values({ companyId: f.home, kind: "source", key: `memory-run-source-erasure:v1:${runId}` });
      await purgeDerivedWorkflowMemory(tx, f.home, [], new Date(), { workflowRevisionIds: [], artifactVersionIds: [], runIds: [runId] });
    });
    const [current] = await db.select().from(routines).where(eq(routines.id, saved.routineId));
    expect(current).toMatchObject({ status: "paused", description: null, env: null, variables: [], originKind: "conversation_draft", originId: runId });
    expect(current?.title).not.toContain(input().title);
    const history = await db.select().from(routineRevisions).where(eq(routineRevisions.routineId, saved.routineId));
    expect(JSON.stringify(history)).not.toMatch(/PRIVATE|Weekly reviewed research/);
    const body = await db.select({ body: documents.latestBody }).from(routineDocuments)
      .innerJoin(documents, eq(documents.id, routineDocuments.documentId)).where(eq(routineDocuments.routineId, saved.routineId));
    expect(JSON.stringify(body)).not.toContain("PRIVATE");
    await expect(routineService(db).getDescriptionDocument(saved.routineId)).rejects.toMatchObject({ status: 403 });
  });
  it("discovers and invokes the actual SDK tool while preserving its current feature and policy gates", async () => {
    const name = "paperclip-self:create_routine_draft";
    await db.insert(toolPolicies).values({ companyId: f.home, name: "Explicit routine draft software fixture", policyType: "allow", selectors: { toolName: name } });
    const gateway = createToolGatewayService(db, { toolActionSigningSecret: "routine-draft-test-only-signing-secret" });
    const session = await gateway.createSession({ companyId: f.home, agentId: f.presence.id, runId, issueId: conversationId });
    expect((await gateway.listToolsForSession(session.token)).map(tool => tool.name)).toContain(name);
    const result = await gateway.executeTool({ sessionToken: session.token, tool: name, parameters: input() });
    expect(result).toMatchObject({ status: "completed", result: { data: { status: "created", enabled: false, executionConfigured: false } } });
    expect(await db.select().from(routines).where(eq(routines.companyId, f.home))).toHaveLength(1);
    await instanceSettingsService(db).updateExperimental({ ambient_commands_v9: false });
    expect((await gateway.listToolsForSession(session.token)).map(tool => tool.name)).not.toContain(name);
  });
  it("previews only the actual saved routine and distinguishes a later Human revision", async () => {
    const saved = await create();
    const read = () => conversationAuthoringService(db).get(f.actor, f.home, conversationId);
    expect((await read()).savedRoutines).toEqual([expect.objectContaining({ id: saved.routineId,
      authoredRevisionId: saved.currentRevisionId, currentRevisionId: saved.currentRevisionId,
      status: "paused", executionConfigured: false, triggerCount: 0, enabledTriggerCount: 0, href: `/routines/${saved.routineId}` })]);
    const edited = await routineService(db, { sourceActor: f.actor }).update(saved.routineId,
      { title: "Human-reviewed routine title", baseRevisionId: saved.currentRevisionId! }, { userId: f.userId });
    const current = await read();
    expect(current.savedRoutines).toEqual([expect.objectContaining({ title: "Human-reviewed routine title",
      authoredRevisionId: saved.currentRevisionId, currentRevisionId: edited!.latestRevisionId, currentRevisionNumber: edited!.latestRevisionNumber })]);
    expect(JSON.stringify(current)).not.toContain("PRIVATE");
    await db.update(issues).set({ conversationSessionGeneration: 1 }).where(eq(issues.id, conversationId));
    expect((await read()).savedRoutines).toEqual([]);
  });
  it("requires the actual private routine reader before exposing a next workflow schedule, including through operations", async () => {
    await instanceSettingsService(db).updateExperimental({ enableWorkflowsV1: true, enableWorkflowBuilderV1: true, progressive_shell_v9: true });
    const workflowOwner = workflowService(db), human = { principal: { type: "user" as const, userId: f.userId } };
    const workflow = await workflowOwner.create(f.home, { name: "Public schedule target" }, human);
    const draft = await workflowOwner.updateDraft(f.home, workflow.id, { expectedRevisionId: workflow.draftRevisionId!, graph: {
      version: 1, nodes: [{ id: "start", type: "core.manual_trigger", name: "Start", position: { x: 0, y: 0 }, config: {} }],
      edges: [], variables: [], settings: { totalDeadlineSeconds: 30 },
    } }, human);
    await workflowOwner.publish(f.home, workflow.id, { expectedDraftRevisionId: draft.draftRevisionId!, expectedPublishedRevisionId: null }, human);
    const saved = await create(), owner = routineService(db, { sourceActor: f.actor });
    await owner.update(saved.routineId, { baseRevisionId: saved.currentRevisionId!, status: "active",
      executionTarget: { kind: "workflow", workflowId: workflow.id } }, { userId: f.userId });
    const created = await owner.createTrigger(saved.routineId, createRoutineTriggerSchema.parse({ kind: "schedule", enabled: true,
      cronExpression: "0 8 * * *", timezone: "UTC" }), { userId: f.userId });
    const at = new Date("2099-01-01T08:00:00Z");
    await db.update(routineTriggers).set({ nextRunAt: at }).where(eq(routineTriggers.id, created.trigger.id));
    expect(await owner.nextWorkflowSchedule(f.home, workflow.id)).toEqual(at);
    const otherId = `other-${randomUUID()}`, now = new Date();
    await db.insert(authUsers).values({ id: otherId, name: "Other company viewer", email: `${otherId}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId: f.home, principalType: "user", principalId: otherId, membershipRole: "viewer", status: "active" });
    await db.insert(principalPermissionGrants).values({ companyId: f.home, principalType: "user", principalId: otherId, permissionKey: "workflows:read" });
    const other = { type: "board" as const, source: "session" as const, userId: otherId, isInstanceAdmin: true };
    await expect(routineService(db, { sourceActor: other }).getDetail(saved.routineId)).rejects.toMatchObject({ status: 403 });
    const publicRoutine = await routineService(db, { sourceActor: f.actor }).create(f.home,
      createRoutineSchema.parse({ title: "Public paused routine", status: "paused" }), { userId: f.userId });
    expect((await routineService(db, { sourceActor: other }).list(f.home)).map(row => row.id)).toEqual([publicRoutine.id]);
    await expect(routineService(db, { sourceActor: other }).nextWorkflowSchedule(f.home, workflow.id)).rejects.toMatchObject({ status: 403 });
    await expect(routineService(db).nextWorkflowSchedule(f.home, workflow.id)).rejects.toMatchObject({ status: 403 });
    await expect(workflowOwner.operations(f.home, workflow.id, other)).rejects.toMatchObject({ status: 403 });
    expect((await workflowOwner.operations(f.home, workflow.id, f.actor)).nextTrigger).toEqual({ state: "scheduled", at: at.toISOString() });
  });
  it("binds private routine readers to actual verified Human and active Agent run without borrowing a claimed responsible user", async () => {
    const saved = await create(), [routine] = await db.select().from(routines).where(eq(routines.id, saved.routineId));
    const agent = { type: "agent" as const, source: "agent_jwt" as const, agentId: f.presence.id, companyId: f.home, runId };
    await assertRoutineSourceAccess(db, routine!, agent);
    await expect(assertRoutineSourceAccess(db, routine!, { ...agent, onBehalfOfUserId: "another-user" })).rejects.toMatchObject({ status: 403 });
    await expect(assertRoutineSourceAccess(db, routine!, { ...agent, source: "agent_key", onBehalfOfUserId: f.userId })).rejects.toMatchObject({ status: 403 });
    await expect(assertRoutineSourceAccess(db, routine!, { type: "board", source: "local_implicit", userId: f.userId, isInstanceAdmin: true })).rejects.toMatchObject({ status: 403 });
    await db.update(heartbeatRuns).set({ status: "succeeded" }).where(eq(heartbeatRuns.id, runId));
    await expect(assertRoutineSourceAccess(db, routine!, agent)).rejects.toMatchObject({ status: 403 });
    await assertRoutineSourceAccess(db, routine!, f.actor);
    await db.update(authUsers).set({ emailVerified: false }).where(eq(authUsers.id, f.userId));
    await expect(assertRoutineSourceAccess(db, routine!, f.actor)).rejects.toMatchObject({ status: 403 });
  });
  it("rolls back the real routine and revision if current membership is withdrawn after insertion", async () => {
    await db.execute(sql`create function aw_v9_test_withdraw_routine_author() returns trigger language plpgsql as $$
      begin delete from company_memberships where company_id=NEW.company_id and principal_type='user'
        and principal_id=NEW.responsible_user_id; return NEW; end $$`);
    await db.execute(sql`create trigger aw_v9_test_late_routine_author after insert on routine_revisions
      for each row execute function aw_v9_test_withdraw_routine_author()`);
    try {
      await expect(create()).rejects.toMatchObject({ status: 403 });
      expect(await db.select().from(routines).where(eq(routines.companyId, f.home))).toEqual([]);
      expect(await db.select().from(routineRevisions).where(eq(routineRevisions.companyId, f.home))).toEqual([]);
      expect(await db.select().from(companyMemberships).where(and(eq(companyMemberships.companyId, f.home), eq(companyMemberships.principalId, f.userId)))).toHaveLength(1);
    } finally {
      await db.execute(sql`drop trigger aw_v9_test_late_routine_author on routine_revisions`);
      await db.execute(sql`drop function aw_v9_test_withdraw_routine_author()`);
    }
  });
  it("prevents a direct late writer from restoring source-erased routine and document text", async () => {
    const saved = await create();
    const [document] = await db.select({ id: routineDocuments.documentId }).from(routineDocuments).where(eq(routineDocuments.routineId, saved.routineId));
    await db.insert(memoryDeletionMarkers).values({ companyId: f.home, kind: "source", key: `memory-run-source-erasure:v1:${runId}` });
    await db.update(routines).set({ title: "PRIVATE restored title", description: "PRIVATE restored body", variables: [], status: "active" })
      .where(eq(routines.id, saved.routineId));
    await db.update(documents).set({ latestBody: "PRIVATE restored document" }).where(eq(documents.id, document!.id));
    const [row] = await db.select().from(routines).where(eq(routines.id, saved.routineId));
    expect(row).toMatchObject({ status: "paused", description: null }); expect(row!.title).not.toContain("PRIVATE");
    expect((await db.select().from(documents).where(eq(documents.id, document!.id)))[0]!.latestBody).toBe("");
    await expect(routineService(db, { sourceActor: f.actor }).restoreRevision(saved.routineId, saved.currentRevisionId!, { userId: f.userId }))
      .rejects.toMatchObject({ status: 403 });
  });
  it("rejects the generic conversational Agent create path instead of silently enabling an automation", async () => {
    await expect(routineService(db).create(f.home, createRoutineSchema.parse({ title: "Bypassed review", status: "active",
      assigneeAgentId: f.presence.id, parentIssueId: conversationId }), { agentId: f.presence.id, runId }))
      .rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(routines).where(eq(routines.companyId, f.home))).toEqual([]);
    expect((await create()).enabled).toBe(false);
  });
  it("keeps current Human configuration separate from conversational Agent changes and run commands", async () => {
    const saved = await create(), owner = routineService(db, { sourceActor: f.actor });
    await expect(owner.update(saved.routineId, { title: "Silent Agent change", baseRevisionId: saved.currentRevisionId! },
      { agentId: f.presence.id, runId })).rejects.toMatchObject({ status: 403 });
    await expect(owner.runRoutine(saved.routineId, { source: "manual" }, { agentId: f.presence.id, runId })).rejects.toMatchObject({ status: 403 });
    const current = await owner.update(saved.routineId, { title: "Explicit Human revision", baseRevisionId: saved.currentRevisionId! }, { userId: f.userId });
    expect(current?.title).toBe("Explicit Human revision");
    expect(await db.select().from(routineRuns).where(eq(routineRuns.routineId, saved.routineId))).toEqual([]);
  });
  it("guards direct trigger/history reads and conversational trigger mutations", async () => {
    const saved = await create(), owner = routineService(db, { sourceActor: f.actor });
    const triggerInput = createRoutineTriggerSchema.parse({ kind: "api", enabled: false });
    const actor = { agentId: f.presence.id, runId };
    await expect(owner.createTrigger(saved.routineId, triggerInput, actor)).rejects.toMatchObject({ status: 403 });
    const result = await owner.createTrigger(saved.routineId, triggerInput, { userId: f.userId });
    await expect(owner.updateTrigger(result.trigger.id, { enabled: true }, actor)).rejects.toMatchObject({ status: 403 });
    await expect(owner.deleteTrigger(result.trigger.id, actor)).rejects.toMatchObject({ status: 403 });
    await expect(owner.rotateTriggerSecret(result.trigger.id, actor)).rejects.toMatchObject({ status: 403 });
    await db.insert(memoryDeletionMarkers).values({ companyId: f.home, kind: "source", key: `memory-run-source-erasure:v1:${runId}` });
    for (const read of [() => owner.getTrigger(result.trigger.id), () => owner.listRuns(saved.routineId),
      () => owner.listRevisions(saved.routineId), () => owner.getDetail(saved.routineId)])
      await expect(read()).rejects.toMatchObject({ status: 403 });
  });
  it.each(["native", "legacy"] as const)("inherits source erasure in actual %s routine execution tasks and runs", async mode => {
    const saved = await create();
    const task = await issueService(db).create(f.home, { title: "PRIVATE execution title", description: "PRIVATE execution body",
      originKind: "routine_execution", originId: saved.routineId, assigneeAgentId: f.presence.id });
    const [execution] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id,
      responsibleUserId: f.userId, status: "queued", runtimeMode: mode, nativeIssueId: mode === "native" ? task.id : null,
      contextSnapshot: { issueId: task.id, prompt: "PRIVATE execution context" }, resultJson: { body: "PRIVATE execution result" } }).returning();
    await db.insert(memoryDeletionMarkers).values({ companyId: f.home, kind: "source", key: `memory-run-source-erasure:v1:${runId}` });
    await expect(assertAnalyticalContextPayloadAccess(db, f.home, f.actor, { issueId: task.id })).rejects.toMatchObject({ status: 403 });
    await expect(assertAnalyticalContextPayloadAccess(db, f.home, f.actor, { runId: execution!.id })).rejects.toMatchObject({ status: 403 });
    await db.transaction(async rawTx => {
      const tx = rawTx as unknown as typeof db; await lockMemoryPrivacy(tx, f.home);
      await purgeDerivedWorkflowMemory(tx, f.home, [], new Date(), { workflowRevisionIds: [], artifactVersionIds: [], runIds: [runId] });
    });
    const current = await issueService(db).getById(task.id);
    expect(current?.description).toBeNull(); expect(current?.title).not.toContain("PRIVATE");
    expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, execution!.id)))[0]!.resultJson).toBeNull();
  });
  it("scrubs the routine execution task before any heartbeat has been created", async () => {
    const saved = await create();
    const task = await issueService(db).create(f.home, { title: "PRIVATE no-run execution", description: "PRIVATE copied routine",
      originKind: "routine_execution", originId: saved.routineId });
    await db.transaction(async rawTx => {
      const tx = rawTx as unknown as typeof db; await lockMemoryPrivacy(tx, f.home);
      await tx.insert(memoryDeletionMarkers).values({ companyId: f.home, kind: "source", key: `memory-run-source-erasure:v1:${runId}` });
      await purgeDerivedWorkflowMemory(tx, f.home, [], new Date(), { workflowRevisionIds: [], artifactVersionIds: [], runIds: [runId] });
    });
    const current = await issueService(db).getById(task.id);
    expect(current?.description).toBeNull(); expect(current?.title).not.toContain("PRIVATE");
  });

  it("scrubs Human-authored routine activity and refuses late activity payload restoration", async () => {
    const saved = await create();
    const [event] = await db.insert(activityLog).values({ companyId: f.home, actorType: "user", actorId: f.userId,
      action: "routine.updated", entityType: "routine", entityId: saved.routineId, details: { title: "PRIVATE Human update" } }).returning();
    await db.transaction(async rawTx => {
      const tx = rawTx as unknown as typeof db; await lockMemoryPrivacy(tx, f.home);
      await tx.insert(memoryDeletionMarkers).values({ companyId: f.home, kind: "source", key: `memory-run-source-erasure:v1:${runId}` });
      await purgeDerivedWorkflowMemory(tx, f.home, [], new Date(), { workflowRevisionIds: [], artifactVersionIds: [], runIds: [runId] });
    });
    expect((await db.select().from(activityLog).where(eq(activityLog.id, event!.id)))[0]!.details).toEqual({ payloadDeleted: true });
    await db.update(activityLog).set({ details: { title: "PRIVATE restored Human update" } }).where(eq(activityLog.id, event!.id));
    expect((await db.select().from(activityLog).where(eq(activityLog.id, event!.id)))[0]!.details).toEqual({ payloadDeleted: true });
  });
  it("replays the saved identity from a later current run without creating another routine", async () => {
    const saved = await create();
    await db.update(heartbeatRuns).set({ status: "succeeded" }).where(eq(heartbeatRuns.id, runId));
    const [next] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, responsibleUserId: f.userId,
      nativeIssueId: conversationId, runtimeMode: "native", status: "running", contextSnapshot: { conversationSessionGeneration: 0 } }).returning();
    runId = next!.id; await db.update(issues).set({ executionRunId: runId }).where(eq(issues.id, conversationId));
    expect(await create()).toMatchObject({ status: "replayed", routineId: saved.routineId, currentRevisionId: saved.currentRevisionId });
    expect(await db.select().from(routines).where(eq(routines.companyId, f.home))).toHaveLength(1);
  });

});
