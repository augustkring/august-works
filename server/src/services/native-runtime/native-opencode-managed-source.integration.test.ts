import { createHash, randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { authSessions, authUsers, companyMemberships, createDb, documentRevisions, heartbeatRuns, issues, memoryRecords,
  principalPermissionGrants, toolInvocations } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Companies } from "../../__tests__/helpers/v5-fixtures.js";
import { seedNativePasskeyActor } from "../../__tests__/helpers/native-authentication-fixtures.js";
import { withManagedNativeHeartbeatFixture } from "../../__tests__/helpers/managed-native-heartbeat-fixture.js";
import { managedNativeProjectWorkspaceFixture } from "../../__tests__/helpers/managed-native-project-workspace-fixture.js";
import { qualifiedOpenCodeBinary, makeFixtureTreeWritable, runManagedNativeOpenCodeFixture } from "../../__tests__/helpers/managed-native-opencode-e2e-fixture.js";
import { memoryService, type MemoryMutationActor } from "../memory/memory-service.js";
import { issueService } from "../issues.js";
import { orchestrationService } from "../orchestration/orchestration-service.js";
import { actorMiddleware } from "../../middleware/auth.js";
import type { BetterAuthSessionResult } from "../../auth/better-auth.js";
import { errorHandler } from "../../middleware/error-handler.js";
import { projectRoutes } from "../../routes/projects.js";
import { issueRoutes } from "../../routes/issues.js";
import { documentService } from "../documents.js";
import { instanceSettingsService } from "../instance-settings.js";
import { nativePayloadSourceSnapshotSchema, nativeRunInputSourceReceiptSchema, type NativePayloadSourceInput } from "@paperclipai/shared";
import type { NativeExecutionInput } from "../../vendor/paperclip-runner/index.js";
import { assertNativePayloadSourceSetCurrent } from "../native-direct-input.js";
import { grantsForHumanRole } from "../company-member-roles.js";

let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof createDb>;
let root = "";
let instanceId = "";
const projectApiServers: Array<ReturnType<typeof createServer>> = [];
beforeAll(async () => {
  if (!hasPinnedOpenCodeProfile()) return;
  root = await mkdtemp(join(tmpdir(), "managed-opencode-source-scheduler-")); await chmod(root, 0o700);
  vi.stubEnv("PAPERCLIP_HOME", root);
  database = await startEmbeddedPostgresTestDatabase("managed-opencode-source-scheduler-"); db = createDb(database.connectionString);
  await enableV5ForTest(db);
  await instanceSettingsService(db).updateExperimental({ enableWorkflowsV1: true, readiness_engine_v7: true,
    orchestration_v7: true, role_packs_v5: false, skill_resolver_v5: false });
  instanceId = `managed-opencode-scheduler-${randomUUID()}`;
  vi.stubEnv("PAPERCLIP_INSTANCE_ID", instanceId);
  vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET", `managed-opencode-scheduler-${randomUUID()}-${randomUUID()}`);
}, 60_000);
afterAll(async () => { for (const server of projectApiServers) {
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  }
  await database?.cleanup(); vi.unstubAllEnvs();
  if (root) { await makeFixtureTreeWritable(root); await rm(root, { recursive: true, force: true }); }
}, 30_000);

function tool(body: Record<string, unknown>, name: string): string {
  const tools = Array.isArray(body.tools) ? body.tools as Array<Record<string, unknown>> : [];
  const aliases = name === "self_remember" ? ["paperclip-self:remember"] : [];
  const found = tools.find(value => value.name === name || aliases.includes(String(value.name)) || ["paperclip__", "paperclip_", "paperclip."]
    .some(prefix => typeof value.name === "string" && value.name === `${prefix}${name}`));
  if (typeof found?.name !== "string") throw new Error(`managed_source_scheduler_tool_missing_${name}`);
  return found.name;
}
function toolUse(body: Record<string, unknown>, name: string, id: string, input: Record<string, unknown>) {
  return { stop_reason: "tool_use" as const,
    content: [{ type: "tool_use", id, name: tool(body, name), input }] };
}
function finish(body: Record<string, unknown>, execution: Pick<NativeExecutionInput, "completionContract">, id: string) {
  const contract = execution.completionContract.contract;
  return toolUse(body, "paperclip_finish", id, { schema: "paperclip.run_result.v1", reportedWorkDisposition: "done",
    summary: "Completed the actual scheduler-owned source-bound task.", completionClaim: {
      contractRevision: contract.revision, objectiveSatisfied: true,
      criteria: contract.criteria.map(criterion => ({ criterionId: criterion.id, status: "satisfied", evidenceRefs: [] })),
      remainingWork: [],
    }, evidence: [], verification: [], attentionRequests: [], artifacts: [] });
}
async function startTask(context: { actor: import("../../services/authorization.js").AuthorizationActor;
  companyId: string; agentId: string; heartbeat: ReturnType<typeof import("../heartbeat.js").heartbeatService> }, input: {
  title: string; description: string; objective: string; requiredOutputs: Array<{ kind: "task_document"; key: string }>;
  project?: { projectId: string; projectWorkspaceId: string };
}) {
  const { actor, companyId, agentId, heartbeat } = context;
  if (!actor.userId) throw new Error("managed_source_current_human_missing");
  const task = await issueService(db).create(companyId, { title: input.title, description: input.description, status: "todo",
    responsibleUserId: actor.userId, createdByUserId: actor.userId, assigneeAgentId: agentId,
    ...(input.project ? { projectId: input.project.projectId, projectWorkspaceId: input.project.projectWorkspaceId } : {}) },
    db, undefined, { manualInputActor: actor, privacyActor: actor, sourceAccessActor: actor });
  const plan = await orchestrationService(db).create(actor, companyId, { issueId: task.id,
    expectedIssueUpdatedAt: task.updatedAt.toISOString(), workload: "semantic", riskClass: "C0",
    completionContract: { objective: input.objective, requiredOutputs: input.requiredOutputs,
      businessInvariants: ["Use only current authorized Task, Project, Context and Memory sources"] },
    budgets: { maxModelCostMinor: 20, maxToolActions: 10 }, workers: [{ key: "writer", issueId: task.id }] });
  await orchestrationService(db).decide(actor, companyId, plan.id,
    { expectedVersion: plan.version, action: "start", rationale: "Run the actual admitted Native Worker through the scheduler" });
  const wake = await heartbeat.wakeup(agentId, { source: "assignment", triggerDetail: "system", reason: "issue_assigned",
    requestedByActorType: "user", requestedByActorId: actor.userId, payload: { issueId: task.id },
    contextSnapshot: { issueId: task.id, ...(input.project ? { projectId: input.project.projectId } : {}) } });
  if (!wake) throw new Error("managed_source_scheduler_wakeup_missing");
  await heartbeat.drainActiveRunExecutions();
  const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, wake.id));
  return { task, plan, wake, run };
}

async function projectApi(dbValue: ReturnType<typeof createDb>, actor: import("../../services/authorization.js").AuthorizationActor) {
  if (!actor.userId || !actor.sessionId) throw new Error("managed_project_current_human_missing");
  const [session] = await dbValue.select({ id: authSessions.id, userId: authSessions.userId,
    token: authSessions.token, expiresAt: authSessions.expiresAt }).from(authSessions)
    .where(and(eq(authSessions.id, actor.sessionId), eq(authSessions.userId, actor.userId)));
  if (!session) throw new Error("managed_project_human_session_missing");
  const app = express(); app.use(express.json());
  app.use(actorMiddleware(dbValue, { deploymentMode: "authenticated", resolveSession: async req => {
    const tokens = (req.header("cookie") ?? "").split(";").map(value => value.trim())
      .filter(value => value.startsWith("session_token=")).map(value => decodeURIComponent(value.slice("session_token=".length)));
    const token = tokens[0]; if (!token) return null;
    const [current] = await dbValue.select({ id: authSessions.id, userId: authSessions.userId,
      expiresAt: authSessions.expiresAt }).from(authSessions)
      .where(and(eq(authSessions.token, token), sql`${authSessions.expiresAt} > now()`)).limit(1);
    if (!current) return null;
    const [user] = await dbValue.select({ id: authUsers.id, name: authUsers.name, email: authUsers.email })
      .from(authUsers).where(eq(authUsers.id, current.userId)).limit(1);
    if (!user) return null;
    return { session: current, user } as BetterAuthSessionResult;
  } }));
  app.use("/api", projectRoutes(dbValue)); app.use(errorHandler);
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("managed_project_api_listener_missing");
  projectApiServers.push(server);
  return { app, server, origin: `http://127.0.0.1:${address.port}`, humanCookie: `session_token=${encodeURIComponent(session.token)}` };
}

async function assertCurrentDocumentAccess(issueId: string, aliceActor: import("../../services/authorization.js").AuthorizationActor,
  aliceUserId: string, aliceSessionId: string, bobSessionId: string) {
  if (!aliceSessionId || !bobSessionId) throw new Error("managed_source_authenticated_sessions_missing");
  const sessions = await db.select({ id: authSessions.id, userId: authSessions.userId, token: authSessions.token,
    expiresAt: authSessions.expiresAt }).from(authSessions).where(inArray(authSessions.id, [aliceSessionId, bobSessionId]));
  if (sessions.length !== 2 || sessions.some(session => session.expiresAt.getTime() <= Date.now()))
    throw new Error("managed_source_authenticated_sessions_expired");
  const app = express(); app.use(express.json());
  app.use(actorMiddleware(db, { deploymentMode: "authenticated", resolveSession: async req => {
    const values = (req.header("cookie") ?? "").split(";").map(value => value.trim())
      .filter(value => value.startsWith("session_token=")).map(value => decodeURIComponent(value.slice("session_token=".length)));
    const session = sessions.find(value => values.includes(value.token));
    if (!session || session.expiresAt.getTime() <= Date.now()) return null;
    const [user] = await db.select({ id: authUsers.id, name: authUsers.name, email: authUsers.email })
      .from(authUsers).where(eq(authUsers.id, session.userId));
    if (!user) return null;
    const result: BetterAuthSessionResult = { session: { id: session.id, userId: session.userId,
      expiresAt: session.expiresAt }, user };
    return result;
  } }));
  app.use("/api", issueRoutes(db, {} as never)); app.use(errorHandler);
  const alice = sessions.find(value => value.id === aliceSessionId)!;
  const bob = sessions.find(value => value.id === bobSessionId)!;
  const aliceCookie = `session_token=${encodeURIComponent(alice.token)}`;
  const bobCookie = `session_token=${encodeURIComponent(bob.token)}`;
  const aliceDocumentA = await request(app).get(`/api/issues/${issueId}/documents/managed-source-a`).set("cookie", aliceCookie).expect(200);
  const aliceDocumentB = await request(app).get(`/api/issues/${issueId}/documents/managed-source-b`).set("cookie", aliceCookie).expect(200);
  expect(aliceDocumentA.body.body).toBe("Document A was produced before private Context was selected.");
  expect(aliceDocumentB.body.body).toBe("Document B was produced after private Context was selected.");
  const docA = await request(app).get(`/api/issues/${issueId}/documents/managed-source-a`).set("cookie", bobCookie).expect(200);
  expect(docA.body.body).toBe("Document A was produced before private Context was selected.");
  const docB = await request(app).get(`/api/issues/${issueId}/documents/managed-source-b`).set("cookie", bobCookie);
  expect([403, 404]).toContain(docB.status);
  expect(JSON.stringify(docB.body)).not.toContain("Document B was produced after private Context was selected.");
  const selectedA = await documentService(db).getIssueDocumentByKey(issueId, "managed-source-a");
  if (!selectedA?.latestRevisionId) throw new Error("managed_source_document_a_revision_missing");
  const body = "Document A was produced before private Context was selected.";
  const exact = "private Context", start = body.indexOf(exact);
  const thread = await request(app).post(`/api/issues/${issueId}/documents/managed-source-a/annotations`).set("cookie", aliceCookie)
    .send({ baseRevisionId: selectedA.latestRevisionId, baseRevisionNumber: selectedA.latestRevisionNumber,
      selector: { quote: { exact, prefix: body.slice(0, start), suffix: body.slice(start + exact.length) },
        position: { normalizedStart: start, normalizedEnd: start + exact.length, markdownStart: start, markdownEnd: start + exact.length } },
      body: `Private managed annotation ${randomUUID()}` }).expect(201);
  const privateComment = `Private managed annotation comment ${randomUUID()}`;
  await request(app).post(`/api/issues/${issueId}/documents/managed-source-a/annotations/${thread.body.id}/comments`)
    .set("cookie", aliceCookie).send({ body: privateComment }).expect(201);
  const annotated = await request(app).get(`/api/issues/${issueId}/documents/managed-source-a?includeAnnotations=true&includeAnnotationComments=true`)
    .set("cookie", bobCookie);
  expect([403, 404]).toContain(annotated.status);
  expect(JSON.stringify(annotated.body)).not.toContain(privateComment);
  expect(JSON.stringify(annotated.body)).not.toContain("Private managed annotation");
  const legacyBody = `Legacy source-free document body ${randomUUID()}`;
  const legacy = await documentService(db).upsertIssueDocument({ issueId, key: "legacy-context-gated",
    title: "Legacy private-context title", format: "markdown", body: legacyBody, createdByUserId: aliceUserId });
  const [legacyRevision] = await db.select({ protocol: documentRevisions.payloadSourceProtocolVersion,
    snapshot: documentRevisions.payloadSourceSnapshot }).from(documentRevisions)
    .where(eq(documentRevisions.id, legacy.document.latestRevisionId!));
  expect(legacyRevision).toEqual({ protocol: 0, snapshot: null });
  const legacyRead = await request(app).get(`/api/issues/${issueId}/documents/legacy-context-gated`).set("cookie", bobCookie);
  expect([403, 404]).toContain(legacyRead.status);
  expect(JSON.stringify(legacyRead.body)).not.toContain(legacyBody);
  expect(JSON.stringify(legacyRead.body)).not.toContain("Legacy private-context title");
  await issueService(db).update(issueId, { visibility: "private", actorUserId: aliceUserId, privacyActor: aliceActor });
  const withdrawn = await request(app).get(`/api/issues/${issueId}/documents/managed-source-a`).set("cookie", bobCookie);
  expect([403, 404]).toContain(withdrawn.status);
  expect(JSON.stringify(withdrawn.body)).not.toContain(body);
  expect(alice.userId).toBe(aliceUserId);
}

function hasPinnedOpenCodeProfile(): boolean {
  if (process.platform !== "linux") return false;
  if (process.env.PAPERCLIP_QUALIFIED_OPENCODE_BINARY?.trim()) return true;
  try { return Boolean(execFileSync("which", ["opencode"], { encoding: "utf8" }).trim()); }
  catch { return false; }
}

// The unsupported local transport control remains byte-for-byte the existing
// fixture case. These four positives use actual Task/Plan/wakeup admission.
describe.skipIf(!hasPinnedOpenCodeProfile())("managed OpenCode source-closure binary integration", () => {
  it("denies unsupported local Native transport before any model request or process starts", async () => {
    const result = await runManagedNativeOpenCodeFixture({ db, connectionString: database.connectionString,
      root, instanceId, sandboxRelay: false, processProbeOnly: true, steps: [
        { tool: "write_document", id: "managed-e2e-process-probe-write", input: {
          idempotencyKey: randomUUID(), key: "managed-process-probe", title: "Process probe", body: "Not dispatched.",
          baseRevisionId: null,
        } },
        { tool: "paperclip_finish", id: "managed-e2e-process-probe-finish" },
      ] });
    if (!("processProbeOnly" in result)) throw new Error("managed_opencode_process_probe_result_missing");
    expect(result.responseCount).toBe(0);
    expect(result.modelCallCount).toBe(0);
    expect(result.executionFailure).toEqual({ name: "NativePaidTransportAdmissionError", code: "configuration_incomplete" });
    if (!("processFacts" in result) || !Array.isArray(result.processFacts))
      throw new Error("managed_opencode_process_probe_facts_missing");
    expect(result.processFacts).toEqual([]);
  }, 45_000);

  it("executes same-run Memory and Context outputs through the real managed OpenCode Messages route", async () => {
    const privateRootContent = `private_context_root_${randomUUID()}`;
    const memoryAId = `source-memory-a-${randomUUID()}`, memoryBId = `source-memory-b-${randomUUID()}`;
    const memoryAKey = randomUUID(), memoryBKey = randomUUID();
    let bindingId = "", bindingKey = "", privateTaskId = "", privateRootMemoryId = "";
    let memoryARecordId = "", memoryBRecordId = "";
    let humanMemoryActor: MemoryMutationActor | null = null;
    let bobMemoryActor: MemoryMutationActor | null = null;
    let aliceSessionId = "", bobSessionId = "", aliceUserId = "";
    let privateMemoryActor: MemoryMutationActor | null = null;
    let contextResultContent = "";
    let runId = "", issueId = "";
    const result = await withManagedNativeHeartbeatFixture({ db, root, opencodeBinary: qualifiedOpenCodeBinary(), timeoutSec: 240,
      prepareNativeRuntimeContext: async ({ db: currentDb, actor, companyId, agentId }) => {
        if (!actor.userId) throw new Error("managed_source_human_missing");
        aliceUserId = actor.userId;
        aliceSessionId = actor.sessionId ?? "";
        humanMemoryActor = { principal: { type: "user", userId: actor.userId }, authorizationActor: actor };
        const bobFixture = await seedV5Companies(currentDb);
        await currentDb.insert(companyMemberships).values({ companyId, principalType: "user", principalId: bobFixture.userId,
          status: "active", membershipRole: "operator" });
        await currentDb.insert(principalPermissionGrants).values(grantsForHumanRole("operator").map(grant => ({
          companyId, principalType: "user", principalId: bobFixture.userId, ...grant,
        }))).onConflictDoNothing();
        const bobActor = await seedNativePasskeyActor(currentDb, bobFixture.userId, [companyId]);
        bobSessionId = bobActor.sessionId;
        bobMemoryActor = { principal: { type: "user", userId: bobFixture.userId }, authorizationActor: bobActor };
        const memories = memoryService(currentDb);
        bindingKey = `managed-source-${randomUUID()}`;
        const binding = await memories.createCompanyBinding(companyId, { key: bindingKey,
          name: "Managed source integration Memory", providerKey: "local" }, humanMemoryActor);
        bindingId = binding.id;
        await memories.addBindingTarget(companyId, binding.id, { targetType: "company", targetId: companyId }, humanMemoryActor);
        await memories.addBindingTarget(companyId, binding.id, { targetType: "agent", targetId: agentId }, humanMemoryActor);
        const privateTask = await issueService(currentDb).create(companyId, { title: `Private Context root ${randomUUID()}`,
          description: privateRootContent, visibility: "private", status: "todo", assigneeAgentId: agentId,
          responsibleUserId: actor.userId, createdByUserId: actor.userId }, currentDb, undefined,
          { manualInputActor: actor, privacyActor: actor, sourceAccessActor: actor });
        privateTaskId = privateTask.id;
        await currentDb.insert(principalPermissionGrants).values([
          { companyId, principalType: "user", principalId: actor.userId, permissionKey: "company_scope:read" },
          { companyId, principalType: "agent", principalId: agentId, permissionKey: "company_scope:read" },
        ]).onConflictDoNothing();
        privateMemoryActor = humanMemoryActor;
      },
      providerReply: ({ body, callIndex, execution }) => {
        if (callIndex === 1) return toolUse(body, "write_document", "managed-source-document-a", {
          idempotencyKey: randomUUID(), key: "managed-source-a", title: "Public-prefix document A",
          body: "Document A was produced before private Context was selected.", baseRevisionId: null });
        if (callIndex === 2) return toolUse(body, "self_remember", memoryAId, { bindingKey,
          scope: "company", memoryType: "outcome", title: "Earlier shared managed output A",
          content: "Public managed output A, before private Context.", idempotencyKey: memoryAKey });
        if (callIndex === 3) return toolUse(body, "read_context", "managed-source-read-context", { query: privateRootContent });
        if (callIndex === 4) {
          const messages = Array.isArray(body.messages) ? body.messages as Array<Record<string, unknown>> : [];
          const readResult = messages.flatMap(message => Array.isArray(message.content)
            ? message.content as Array<Record<string, unknown>> : []).find(block =>
            block.type === "tool_result" && block.tool_use_id === "managed-source-read-context" && block.is_error !== true);
          contextResultContent = typeof readResult?.content === "string" ? readResult.content
            : Array.isArray(readResult?.content) ? (readResult.content as Array<Record<string, unknown>>)
              .map(part => typeof part.text === "string" ? part.text : "").join("") : "";
          if (!readResult) throw new Error("managed_source_context_result_not_consumed");
          return toolUse(body, "self_remember", memoryBId, { bindingKey, scope: "company", memoryType: "outcome",
            title: "Later shared managed output B", content: "Managed output B derived after private Context selection.",
            idempotencyKey: memoryBKey });
        }
        if (callIndex === 5) return toolUse(body, "write_document", "managed-source-document-b", {
          idempotencyKey: randomUUID(), key: "managed-source-b", title: "Private-context document B",
          body: "Document B was produced after private Context was selected.", baseRevisionId: null });
        if (callIndex === 6) return finish(body, execution, "managed-source-finish");
        throw new Error(`managed_source_unexpected_provider_call_${callIndex}`);
      },
      beforeManagedModelRequest: async ({ body, runId: currentRunId, issueId: currentIssueId }) => {
        if (!currentRunId || !currentIssueId) throw new Error("managed_source_live_request_binding_missing");
        runId = currentRunId; issueId = currentIssueId;
        const messages = body && typeof body === "object" && Array.isArray((body as Record<string, unknown>).messages)
          ? (body as Record<string, unknown>).messages as Array<Record<string, unknown>> : [];
        const blocks = messages.flatMap(message => Array.isArray(message.content) ? message.content as Array<Record<string, unknown>> : []);
        const memoryResult = blocks.find(block => block.type === "tool_result" && block.tool_use_id === memoryAId);
        if (!memoryResult || privateRootMemoryId) return;
        if (!memoryARecordId || !humanMemoryActor || !privateMemoryActor || !bindingId)
          throw new Error("managed_source_memory_output_owner_missing");
        await memoryService(db).reviewCandidate((await db.select({ companyId: issues.companyId }).from(issues)
          .where(eq(issues.id, currentIssueId)))[0]!.companyId, memoryARecordId, { decision: "accept" }, humanMemoryActor);
        const task = await issueService(db).getById(privateTaskId);
        if (!task || task.visibility !== "private" || humanMemoryActor.principal.type !== "user" ||
            task.responsibleUserId !== humanMemoryActor.principal.userId)
          throw new Error("managed_source_private_root_task_changed");
        const observedAt = new Date();
        const excerpt = `Status: ${task.status}\nPriority: ${task.priority}\nDescription: ${task.description}`.slice(0, 60_000);
        const currentCompanyId = (await db.select({ companyId: issues.companyId }).from(issues)
          .where(eq(issues.id, currentIssueId)))[0]!.companyId;
        const candidate = await memoryService(db).createCandidate(currentCompanyId, { bindingId, memoryType: "lesson",
          scope: { type: "company", id: null }, subject: { type: "company", id: currentCompanyId },
          ownerAgentId: null, title: "Human-provided private-context root", content: privateRootContent, summary: null,
          sensitivity: "internal", importance: 50, confidenceScore: 0.8, validFrom: null, validUntil: null,
          observedAt: observedAt.toISOString(), retentionPolicy: "standard", expiresAt: null,
          createdByOperationId: null, metadata: {}, evidence: [{ sourceClass: "task", sourceProvider: "august_works_tasks",
            sourceType: "issue", sourceRef: `issue://${task.id}`, sourceVersion: task.updatedAt.toISOString(),
            sourceUpdatedAt: task.updatedAt.toISOString(), observedAt: observedAt.toISOString(),
            excerptHash: createHash("sha256").update(excerpt).digest("hex"),
            citation: { label: task.title }, trustLevel: "low", relation: "supports" }],
        }, privateMemoryActor);
        const accepted = await memoryService(db).reviewCandidate(currentCompanyId, candidate.record.id, { decision: "accept" }, privateMemoryActor);
        privateRootMemoryId = accepted.record.id;
      },
      afterSuccessfulAssignedToolResult: async ({ call, result: toolResult }) => {
        if (call.tool !== "paperclip-self:remember" || call.parameters === null || typeof call.parameters !== "object") return;
        const parameters = call.parameters as Record<string, unknown>;
        const outer = toolResult && typeof toolResult === "object" ? toolResult as Record<string, unknown> : {};
        const nested = outer.result && typeof outer.result === "object" ? outer.result as Record<string, unknown> : outer;
        const data = nested.data && typeof nested.data === "object" ? nested.data as Record<string, unknown> : nested;
        const record = data.record && typeof data.record === "object" ? data.record as Record<string, unknown> : {};
        if (outer.status !== "completed" || typeof record.id !== "string")
          throw new Error("managed_source_memory_result_not_completed");
        if (parameters.idempotencyKey === memoryAKey) memoryARecordId = record.id;
        if (parameters.idempotencyKey === memoryBKey) memoryBRecordId = record.id;
      },
      driveScheduler: async ({ actor, companyId, agentId, heartbeat }) => {
        if (!actor.userId) throw new Error("managed_source_run_human_missing");
        const { task, plan, wake, run } = await startTask({ actor, companyId, agentId, heartbeat }, {
          title: "Managed source Memory and Context outputs", description: "Read current authorized Task and Context sources.",
          objective: "Retain two source-bound documents and two Human-reviewed Memory outputs",
          requiredOutputs: [{ kind: "task_document", key: "managed-source-a" }, { kind: "task_document", key: "managed-source-b" }],
        });
        expect(run).toMatchObject({ id: wake.id, status: "succeeded", runtimeMode: "native", nativeIssueId: task.id,
          responsibleUserId: actor.userId });
        const [row] = await db.select({ runnerProfileJson: heartbeatRuns.runnerProfileJson })
          .from(heartbeatRuns).where(eq(heartbeatRuns.id, wake.id));
        const profile = row?.runnerProfileJson && typeof row.runnerProfileJson === "object" ? row.runnerProfileJson as Record<string, unknown> : {};
        const receipt = nativeRunInputSourceReceiptSchema.parse(profile.nativeInputSourceReceipt);
        expect(receipt.binding.runId).toBe(wake.id);
        const docA = await documentService(db).getIssueDocumentByKey(task.id, "managed-source-a");
        const docB = await documentService(db).getIssueDocumentByKey(task.id, "managed-source-b");
        if (!docA?.latestRevisionId || !docB?.latestRevisionId) throw new Error("managed_source_documents_missing");
        const [revisionA] = await db.select({ snapshot: documentRevisions.payloadSourceSnapshot }).from(documentRevisions)
          .where(eq(documentRevisions.id, docA.latestRevisionId));
        const [revisionB] = await db.select({ snapshot: documentRevisions.payloadSourceSnapshot }).from(documentRevisions)
          .where(eq(documentRevisions.id, docB.latestRevisionId));
        const snapshotA = nativePayloadSourceSnapshotSchema.parse(revisionA?.snapshot);
        const snapshotB = nativePayloadSourceSnapshotSchema.parse(revisionB?.snapshot);
        expect(snapshotA.inputs.some(source => source.kind === "context")).toBe(false);
        expect(snapshotA.policy.memoryIds).not.toContain(privateRootMemoryId);
        expect(snapshotB.inputs.some(source => source.kind === "context")).toBe(true);
        expect(snapshotB.policy.memoryIds).toContain(privateRootMemoryId);
        expect(snapshotB.inputs.find((source): source is Extract<NativePayloadSourceInput, { kind: "context" }> =>
          source.kind === "context" && Boolean(source.manifestId))?.manifestId)
          .toMatch(/^[0-9a-f-]{36}$/i);
        const [outputA] = await db.select({ payloadSourceSnapshot: memoryRecords.payloadSourceSnapshot })
          .from(memoryRecords).where(eq(memoryRecords.id, memoryARecordId));
        const [outputB] = await db.select({ payloadSourceSnapshot: memoryRecords.payloadSourceSnapshot })
          .from(memoryRecords).where(eq(memoryRecords.id, memoryBRecordId));
        const memorySnapshotA = nativePayloadSourceSnapshotSchema.parse(outputA?.payloadSourceSnapshot);
        const memorySnapshotB = nativePayloadSourceSnapshotSchema.parse(outputB?.payloadSourceSnapshot);
        expect(memorySnapshotA.inputs.some(source => source.kind === "context")).toBe(false);
        expect(memorySnapshotA.policy.memoryIds).not.toContain(privateRootMemoryId);
        expect(memorySnapshotB.policy.memoryIds).toContain(privateRootMemoryId);
        expect(memorySnapshotB.inputs.some(source => source.kind === "context")).toBe(true);
        const invocations = await db.select().from(toolInvocations).where(and(
          eq(toolInvocations.companyId, companyId), eq(toolInvocations.runId, wake.id)));
        expect(invocations.map(value => value.toolName)).toEqual(expect.arrayContaining([
          "paperclip-self:remember", "read_context", "write_document",
        ]));
        const [memoryA] = await db.select().from(memoryRecords).where(eq(memoryRecords.id, memoryARecordId));
        expect(memoryA?.reviewState).toBe("accepted");
        expect(contextResultContent).toContain(privateRootContent);
        if (!memoryBRecordId) throw new Error("managed_source_memory_b_result_missing");
        const [memoryB] = await db.select().from(memoryRecords).where(eq(memoryRecords.id, memoryBRecordId));
        expect(memoryB?.reviewState).toBe("pending");
        const memories = memoryService(db);
        await memories.reviewCandidate(companyId, memoryBRecordId, { decision: "accept" }, humanMemoryActor!);
        expect((await memories.get(companyId, memoryARecordId, humanMemoryActor!))?.record.id).toBe(memoryARecordId);
        expect((await memories.get(companyId, memoryBRecordId, humanMemoryActor!))?.record.id).toBe(memoryBRecordId);
        if (!bobMemoryActor) throw new Error("managed_source_bob_actor_missing");
        expect((await memories.get(companyId, memoryARecordId, bobMemoryActor))?.record.id).toBe(memoryARecordId);
        expect(await memories.get(companyId, memoryBRecordId, bobMemoryActor)).toBeNull();
        expect(await memories.get(companyId, privateRootMemoryId, bobMemoryActor)).toBeNull();
        await assertCurrentDocumentAccess(task.id, actor, actor.userId, aliceSessionId, bobSessionId);
        return { task, plan, run, receipt };
      },
    });
    expect(result.task.id).toBe(issueId);
    expect(result.run.id).toBe(runId);
    expect(privateRootMemoryId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(contextResultContent).toContain(privateRootContent);
  }, 240_000);

  it("replays the exact scoped Gateway Memory call once, then rejects after the Human revokes its output", async () => {
    // This uses the common fixture's actual assignedToolGateway result observer.
    // The original test's exact replay/accept/revoke behavior is implemented here
    // before rewriting the assertions; each replay reuses the captured closure.
    const callId = `source-memory-replay-${randomUUID()}`, idempotencyKey = randomUUID();
    let replay: (() => Promise<unknown>) | null = null, initialResult: unknown = null;
    let memoryId = "", issueId = "", companyId = "", agentId = "", replayDone = false;
    let bindingKey = "";
    let humanMemoryActor: MemoryMutationActor | null = null;
    let providerResponses = 0;
    const outcome = await withManagedNativeHeartbeatFixture({ db, root, opencodeBinary: qualifiedOpenCodeBinary(), timeoutSec: 180,
      prepareNativeRuntimeContext: async ({ db: currentDb, actor, companyId: currentCompanyId, agentId: currentAgentId }) => {
        if (!actor.userId) throw new Error("source_replay_human_missing");
        agentId = currentAgentId;
        companyId = currentCompanyId;
        bindingKey = `managed-replay-${randomUUID()}`;
        humanMemoryActor = { principal: { type: "user", userId: actor.userId }, authorizationActor: actor };
        const binding = await memoryService(currentDb).createCompanyBinding(currentCompanyId, { key: bindingKey,
          name: "Managed replay Memory binding", providerKey: "local" }, humanMemoryActor);
        await memoryService(currentDb).addBindingTarget(currentCompanyId, binding.id,
          { targetType: "company", targetId: currentCompanyId }, humanMemoryActor);
        await memoryService(currentDb).addBindingTarget(currentCompanyId, binding.id,
          { targetType: "agent", targetId: currentAgentId }, humanMemoryActor);
      },
      providerReply: ({ body, callIndex, execution }) => {
        providerResponses++;
        if (callIndex === 1) return toolUse(body, "self_remember", callId, { bindingKey, scope: "company", memoryType: "outcome",
          title: "Scoped replay output", content: "Managed scheduler Memory replay output.", idempotencyKey });
        if (callIndex === 2) return toolUse(body, "write_document", `${callId}-completion`, { idempotencyKey: randomUUID(),
          key: "managed-replay-completion", title: "Replay completion", body: "Completed after the replay probe.", baseRevisionId: null });
        if (callIndex === 3) return finish(body, execution, `${callId}-finish`);
        throw new Error(`managed_source_replay_unexpected_call_${callIndex}`);
      },
      afterSuccessfulAssignedToolResult: async ({ call, result, replay: exactReplay }) => {
        if (call.tool !== "paperclip-self:remember" || call.parameters === null || typeof call.parameters !== "object" ||
          (call.parameters as Record<string, unknown>).idempotencyKey !== idempotencyKey) return;
        initialResult = result; replay = exactReplay;
        const outer = result && typeof result === "object" ? result as Record<string, unknown> : {};
        const nested = outer.result && typeof outer.result === "object" ? outer.result as Record<string, unknown> : outer;
        const data = nested.data && typeof nested.data === "object" ? nested.data as Record<string, unknown> : nested;
        const record = data.record && typeof data.record === "object" ? data.record as Record<string, unknown> : {};
        if (outer.status !== "completed" || typeof record.id !== "string") throw new Error("source_replay_output_missing");
        memoryId = record.id;
      },
      beforeManagedModelRequest: async ({ body, runId, issueId: currentIssueId }) => {
        if (!runId || !currentIssueId) throw new Error("source_replay_run_binding_missing");
        issueId = currentIssueId;
        const current = await db.select({ companyId: issues.companyId }).from(issues).where(eq(issues.id, currentIssueId));
        companyId = current[0]?.companyId ?? "";
        const blocks = (body && typeof body === "object" && Array.isArray((body as Record<string, unknown>).messages)
          ? (body as Record<string, unknown>).messages as Array<Record<string, unknown>> : [])
          .flatMap(message => Array.isArray(message.content) ? message.content as Array<Record<string, unknown>> : []);
        if (!blocks.some(block => block.type === "tool_result" && block.tool_use_id === callId) || replayDone) return;
        if (!replay || !memoryId || !initialResult) throw new Error("source_replay_exact_call_not_captured");
        const [run] = await db.select({ runnerProfileJson: heartbeatRuns.runnerProfileJson,
          responsibleUserId: heartbeatRuns.responsibleUserId }).from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
        const profile = run?.runnerProfileJson && typeof run.runnerProfileJson === "object" ? run.runnerProfileJson as Record<string, unknown> : {};
        const receipt = nativeRunInputSourceReceiptSchema.parse(profile.nativeInputSourceReceipt);
        expect(receipt.binding).toMatchObject({ companyId, issueId: currentIssueId, runId });
        const snapshot = await db.select({ payloadSourceSnapshot: memoryRecords.payloadSourceSnapshot }).from(memoryRecords)
          .where(and(eq(memoryRecords.companyId, companyId), eq(memoryRecords.id, memoryId))).then(rows => rows[0]?.payloadSourceSnapshot);
        const parsed = nativePayloadSourceSnapshotSchema.parse(snapshot);
        const dispatchIndex = parsed.inputs.findIndex(value => value.kind === "worker_model_dispatch");
        if (dispatchIndex < 0 || dispatchIndex !== parsed.inputs.length - 1) throw new Error("source_replay_dispatch_prefix_missing");
        if (!run || !agentId || !humanMemoryActor) throw new Error("source_replay_run_actor_missing");
        const agentActor = { type: "agent" as const, source: "none" as const, companyId,
          agentId, runId, onBehalfOfUserId: run.responsibleUserId ?? "" };
        await assertNativePayloadSourceSetCurrent(db, { companyId, issueId: currentIssueId, runId, actor: agentActor,
          policy: parsed.policy, inputs: parsed.inputs.slice(0, dispatchIndex) });
        const firstReplay = await replay() as Record<string, unknown>;
        expect(firstReplay).toMatchObject({ status: "replayed", result: (initialResult as Record<string, unknown>).result });
        const invocationKey = `aw-native-tool:${runId}:${callId}`;
        const [beforeRevoke] = await db.select().from(toolInvocations).where(and(
          eq(toolInvocations.companyId, companyId), eq(toolInvocations.idempotencyKey, invocationKey)));
        expect(beforeRevoke?.status).toBe("succeeded");
        await memoryService(db).reviewCandidate(companyId, memoryId, { decision: "accept" }, humanMemoryActor!);
        await memoryService(db).revoke(companyId, memoryId,
          { reason: "Human revoked this output during its exact managed replay check." }, humanMemoryActor!);
        await assertNativePayloadSourceSetCurrent(db, { companyId, issueId: currentIssueId, runId, actor: agentActor,
          policy: parsed.policy, inputs: parsed.inputs.slice(0, dispatchIndex) });
        await expect(replay()).rejects.toMatchObject({ reasonCode: "native_memory_capture_invalid" });
        const invocations = await db.select({ id: toolInvocations.id }).from(toolInvocations).where(and(
          eq(toolInvocations.companyId, companyId), eq(toolInvocations.idempotencyKey, invocationKey)));
        expect(invocations).toHaveLength(1);
        const [output] = await db.select({ id: memoryRecords.id, revokedAt: memoryRecords.revokedAt }).from(memoryRecords)
          .where(and(eq(memoryRecords.companyId, companyId), eq(memoryRecords.id, memoryId)));
        expect(output?.revokedAt).toBeInstanceOf(Date);
        replayDone = true;
      },
      driveScheduler: async context => {
        const bound = await startTask(context, { title: "Managed Memory replay task", description: "Exercise exact Gateway replay.",
          objective: "Retain one completed source-bound Memory output", requiredOutputs: [{ kind: "task_document", key: "managed-replay-completion" }] });
        return { ...bound, companyId: context.companyId, providerCallCount: context.factsForRun(bound.wake.id).providerCallCount };
      },
    });
    expect(outcome.run.status).not.toBe("succeeded");
    expect(providerResponses).toBe(1);
    expect(outcome.providerCallCount).toBe(1);
    expect(outcome.companyId).toBe(companyId);
    expect(replayDone).toBe(true);
    expect(issueId).toBe(outcome.task.id);
    expect(memoryId).toMatch(/^[0-9a-f-]{36}$/i);
  }, 240_000);

  it("binds a managed Project GET result to the exact current public Project projection", async () => {
    const projectFixture = managedNativeProjectWorkspaceFixture({ root });
    const callId = `managed-project-read-${randomUUID()}`;
    const oldApiUrl = process.env.PAPERCLIP_API_URL;
    let consumedExactProjectResult = false;
    let projectResultDigest: string | null = null;
    const outcome = await withManagedNativeHeartbeatFixture({ db, root, opencodeBinary: qualifiedOpenCodeBinary(), timeoutSec: 180,
      prepareNativeRuntimeContext: projectFixture.prepareNativeRuntimeContext,
      configureHeartbeat: projectFixture.configureHeartbeat,
      providerReply: ({ body, callIndex, execution }) => {
        if (callIndex === 1) return toolUse(body, "call_api", callId, { operationId: "GET /api/projects/{id}",
          pathParams: { id: projectFixture.project().projectId } });
        if (callIndex === 2) {
          const messages = Array.isArray(body.messages) ? body.messages as Array<Record<string, unknown>> : [];
          const result = messages.flatMap(message => Array.isArray(message.content) ? message.content as Array<Record<string, unknown>> : [])
            .find(block => block.type === "tool_result" && block.tool_use_id === callId && block.is_error !== true);
          if (!result || typeof result.content !== "string") throw new Error("managed_project_get_result_not_consumed");
          const parsed = JSON.parse(result.content) as Record<string, unknown>;
          const serialized = JSON.stringify(parsed);
          expect(serialized).toContain(projectFixture.project().projectId);
          expect(serialized).toContain(projectFixture.project().projectWorkspaceId);
          projectResultDigest = createHash("sha256").update(JSON.stringify(parsed), "utf8").digest("hex");
          consumedExactProjectResult = true;
          return toolUse(body, "write_document", "managed-project-read-summary", { idempotencyKey: randomUUID(),
            key: "managed-project-read", title: "Project read summary", body: "The exact current Project projection was consumed.", baseRevisionId: null });
        }
        if (callIndex === 3) return finish(body, execution, "managed-project-read-finish");
        throw new Error(`managed_project_read_unexpected_call_${callIndex}`);
      },
      beforeProviderResponse: async ({ run, manifest, sourceReceipt }) => {
        expect(manifest.runId).toBe(run.id);
        const receipt = nativeRunInputSourceReceiptSchema.parse(sourceReceipt);
        if (!run.nativeIssueId || !run.responsibleUserId) throw new Error("managed_project_run_identity_missing");
        const project = projectFixture.project();
        await assertNativePayloadSourceSetCurrent(db, { companyId: project.companyId, issueId: run.nativeIssueId,
          runId: run.id, actor: { type: "agent", source: "none", companyId: project.companyId,
            agentId: run.agentId, runId: run.id, onBehalfOfUserId: run.responsibleUserId },
          policy: receipt.bootstrap.policy, inputs: receipt.bootstrap.inputs });
        expect(receipt.bootstrap.inputs).toEqual(expect.arrayContaining([
          expect.objectContaining({ kind: "project", projectId: projectFixture.project().projectId }),
          expect.objectContaining({ kind: "project_workspace", projectId: projectFixture.project().projectId,
            workspaceId: projectFixture.project().projectWorkspaceId }),
        ]));
        if (projectResultDigest) {
          const sets = [receipt.bootstrap, ...receipt.dispatches, ...receipt.additionalInputs];
          const resultSources = sets.flatMap(sourceSet => sourceSet.inputs).filter(source =>
            source.kind === "tool_result" && source.callId === callId);
          expect(resultSources).toHaveLength(1);
          expect(resultSources[0]).toMatchObject({ contentHash: projectResultDigest, toolName: "call_api" });
          const projectSources = receipt.bootstrap.inputs.filter(source => source.kind === "project" &&
            source.projectId === projectFixture.project().projectId);
          expect(projectSources).toHaveLength(1);
          expect(projectSources[0]).toMatchObject({ projectId: projectFixture.project().projectId });
        }
      },
      driveScheduler: async context => {
        const api = await projectApi(db, context.actor);
        process.env.PAPERCLIP_API_URL = api.origin;
        const project = projectFixture.project();
        const result = await startTask(context, { title: "Managed Project source read", description: "Read the current Project once.",
          objective: "Read the public Project and retain a source-bound summary",
          requiredOutputs: [{ kind: "task_document", key: "managed-project-read" }], project });
        expect(result.run).toMatchObject({ status: "succeeded", nativeIssueId: result.task.id });
        const [row] = await db.select({ runnerProfileJson: heartbeatRuns.runnerProfileJson })
          .from(heartbeatRuns).where(eq(heartbeatRuns.id, result.wake.id));
        const profile = row?.runnerProfileJson && typeof row.runnerProfileJson === "object" ? row.runnerProfileJson as Record<string, unknown> : {};
        const receipt = nativeRunInputSourceReceiptSchema.parse(profile.nativeInputSourceReceipt);
        expect(receipt.bootstrap.inputs.some(value => value.kind === "project" && value.projectId === project.projectId)).toBe(true);
        return { ...result, receipt, projectApiServer: api.server };
      },
    });
    expect(consumedExactProjectResult).toBe(true);
    expect(projectResultDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(outcome.receipt.bootstrap.inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "project", projectId: projectFixture.project().projectId }),
      expect.objectContaining({ kind: "project_workspace", workspaceId: projectFixture.project().projectWorkspaceId }),
    ]));
    if (outcome.projectApiServer.listening) await new Promise<void>(resolve => outcome.projectApiServer.close(() => resolve()));
    if (oldApiUrl === undefined) delete process.env.PAPERCLIP_API_URL; else process.env.PAPERCLIP_API_URL = oldApiUrl;
  }, 180_000);

  it("refuses the next managed request after the captured Project workspace changes", async () => {
    const projectFixture = managedNativeProjectWorkspaceFixture({ root });
    const callId = `managed-project-stale-read-${randomUUID()}`;
    let api: Awaited<ReturnType<typeof projectApi>> | null = null;
    let edited = false, providerReplies = 0;
    const oldApiUrl = process.env.PAPERCLIP_API_URL;
    const outcome = await withManagedNativeHeartbeatFixture({ db, root, opencodeBinary: qualifiedOpenCodeBinary(), timeoutSec: 240,
      prepareNativeRuntimeContext: projectFixture.prepareNativeRuntimeContext,
      configureHeartbeat: projectFixture.configureHeartbeat,
      providerReply: ({ body, callIndex }) => {
        providerReplies++;
        if (callIndex === 1) return toolUse(body, "call_api", callId, { operationId: "GET /api/projects/{id}",
          pathParams: { id: projectFixture.project().projectId } });
        throw new Error("managed_project_stale_source_provider_was_reached");
      },
      beforeManagedModelRequest: async ({ body }) => {
        if (edited) return;
        const messages = body && typeof body === "object" && Array.isArray((body as Record<string, unknown>).messages)
          ? (body as Record<string, unknown>).messages as Array<Record<string, unknown>> : [];
        const result = messages.flatMap(message => Array.isArray(message.content) ? message.content as Array<Record<string, unknown>> : [])
          .find(block => block.type === "tool_result" && block.tool_use_id === callId && block.is_error !== true);
        if (!result) return;
        const project = projectFixture.project();
        const editRoot = join(root, "project-workspace-edited"); await mkdir(editRoot, { recursive: true, mode: 0o700 });
        const editedResponse = await request(api!.app).patch(`/api/projects/${project.projectId}/workspaces/${project.projectWorkspaceId}`)
          .set("cookie", api!.humanCookie).send({ cwd: editRoot }).expect(200);
        expect(editedResponse.body.cwd).toBe(editRoot); edited = true;
      },
      driveScheduler: async context => {
        api = await projectApi(db, context.actor); process.env.PAPERCLIP_API_URL = api.origin;
        const project = projectFixture.project();
        const result = await startTask(context, { title: "Managed Project stale-source Task", description: "Detect a current Project change.",
          objective: "Do not consume stale Project evidence", requiredOutputs: [], project });
        expect(result.run.status).not.toBe("succeeded");
        expect(providerReplies).toBe(1);
        const [row] = await db.select({ runnerProfileJson: heartbeatRuns.runnerProfileJson }).from(heartbeatRuns)
          .where(eq(heartbeatRuns.id, result.wake.id));
        const profile = row?.runnerProfileJson && typeof row.runnerProfileJson === "object"
          ? row.runnerProfileJson as Record<string, unknown> : {};
        const receipt = nativeRunInputSourceReceiptSchema.parse(profile.nativeInputSourceReceipt);
        return { ...result, receipt, providerCallCount: context.factsForRun(result.wake.id).providerCallCount };
      },
    });
    expect(edited).toBe(true);
    expect(providerReplies).toBe(1);
    expect(outcome.run.status).not.toBe("succeeded");
    expect(outcome.providerCallCount).toBe(1);
    expect(outcome.receipt.bootstrap.inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "project", projectId: projectFixture.project().projectId }),
      expect.objectContaining({ kind: "project_workspace", projectId: projectFixture.project().projectId,
        workspaceId: projectFixture.project().projectWorkspaceId }),
    ]));
    await new Promise<void>(resolve => api?.server.close(() => resolve()));
    if (oldApiUrl === undefined) delete process.env.PAPERCLIP_API_URL; else process.env.PAPERCLIP_API_URL = oldApiUrl;
  }, 180_000);
});
