import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { activityLog, agents, authUsers, companyMemberships, createDb, heartbeatRuns, issues, principalPermissionGrants, workflows } from "@paperclipai/db";
import { workflowRoutes } from "../routes/workflows.js";
import { errorHandler } from "../middleware/error-handler.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { workflowService } from "../services/workflows/workflow-service.js";
import { issueService } from "../services/issues.js";
import { applyWorkflowAuthoringApi } from "../services/workflows/workflow-authoring-api.js";
import { seedV5Presences, enableV5ForTest } from "./helpers/v5-fixtures.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

describe.sequential("Current Native workflow author selection", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let f: Awaited<ReturnType<typeof seedV5Presences>>, workflowId: string, actor: Express.Request["actor"];
  const app = () => { const instance = express(); instance.use(express.json()); instance.use((req, _res, next) => { req.actor = actor; next(); });
    instance.use("/api", workflowRoutes(db)); instance.use(errorHandler); return instance; };
  const read = (principal = f.userId, company = f.home) => request(app()).get(`/api/companies/${company}/workflows/${workflowId}/experience/authors`).query({ expectedUserId: principal });
  const counts = async () => Promise.all([workflows, issues, heartbeatRuns, activityLog].map(table => db.select({ id: table.id }).from(table).where(eq(table.companyId, f.home))));
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("aw-v9-workflow-authors-"); db = createDb(database.connectionString);
    await instanceSettingsService(db).getExperimental(); await enableV5ForTest(db);
  }, 120_000);
  afterAll(async () => { vi.unstubAllEnvs(); await database?.cleanup(); }, 30_000);
  beforeEach(async () => {
    vi.unstubAllEnvs();
    f = await seedV5Presences(db); actor = f.actor as Express.Request["actor"];
    await instanceSettingsService(db).updateExperimental({ enableWorkflowsV1: true, enableWorkflowBuilderV1: true,
      enableAiWorkflowAuthoring: true, enableAgentChat: true, experience_projection_v9: true, progressive_shell_v9: true, ambient_commands_v9: true });
    await db.update(agents).set({ adapterType: "paperclip_runner" }).where(eq(agents.id, f.presence.id));
    await db.insert(companyMemberships).values({ companyId: f.home, principalType: "agent", principalId: f.presence.id, status: "active" }).onConflictDoNothing();
    await db.insert(principalPermissionGrants).values(["workflows:read", "workflows:edit"].flatMap(permissionKey => [
      { companyId: f.home, principalType: "agent", principalId: f.presence.id, permissionKey },
      { companyId: f.home, principalType: "user", principalId: f.userId, permissionKey },
    ])).onConflictDoNothing();
    workflowId = (await workflowService(db).create(f.home, { name: "PRIVATE described workflow", description: "PRIVATE outcome" }, { principal: { type: "user", userId: f.userId } })).id;
  });
  it("returns bounded current named policy choices without starting work or returning private configuration", async () => {
    const before = await counts(), response = await read();
    expect(response.status, JSON.stringify(response.body)).toBe(200); expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toMatchObject({ companyId: f.home, workflowId, enabled: true, coverage: "bounded",
      choices: [{ agentId: f.presence.id, name: f.presence.name }] });
    expect(JSON.stringify(response.body)).not.toMatch(/PRIVATE|adapterConfig|permission|runtimeConfig|responsibleUser|sourceActor/);
    expect(await counts()).toEqual(before);
  });
  it("withdraws choices after Agent permission, runtime selection or status changes", async () => {
    await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, f.home), eq(principalPermissionGrants.principalId, f.presence.id), eq(principalPermissionGrants.permissionKey, "workflows:edit")));
    expect((await read()).body.choices).toEqual([]);
    await db.insert(principalPermissionGrants).values({ companyId: f.home, principalType: "agent", principalId: f.presence.id, permissionKey: "workflows:edit" });
    await db.update(agents).set({ adapterType: "process" }).where(eq(agents.id, f.presence.id));
    expect((await read()).body.choices).toEqual([]);
    await db.update(agents).set({ adapterType: "paperclip_runner", status: "paused" }).where(eq(agents.id, f.presence.id));
    expect((await read()).body.choices).toEqual([]);
  });
  it("does not offer a text-only controller that cannot execute workflow authoring tools", async () => {
    await db.update(agents).set({ adapterConfig: { provider: "aw_text_only", workerModelProfileId: randomUUID(), model: "fixture-text-model" } })
      .where(eq(agents.id, f.presence.id));
    const response = await read(); expect(response.status).toBe(200); expect(response.body.choices).toEqual([]);
  });
  it("omits an invalid provider and preserves the Original authored-definition restore guard", async () => {
    await db.update(agents).set({ adapterConfig: { provider: "unsupported-fixture" } }).where(eq(agents.id, f.presence.id));
    expect((await read()).body.choices).toEqual([]);
    await expect(db.update(agents).set({ adapterConfig: {}, runtimeConfig: { agentDefinitionVersion: {} } }).where(eq(agents.id, f.presence.id)))
      .rejects.toMatchObject({ cause: { code: "23514" } });
  });
  it("retains current account, company and feature admission without inventing a replacement Agent", async () => {
    expect((await read("another-account")).status).toBe(409);
    expect((await read(f.userId, f.guest)).status).toBe(404);
    await instanceSettingsService(db).updateExperimental({ enableAiWorkflowAuthoring: false });
    expect((await read()).body).toMatchObject({ enabled: false, choices: [] });
    await instanceSettingsService(db).updateExperimental({ enableAiWorkflowAuthoring: true });
    vi.stubEnv("PAPERCLIP_RUNNER_API_TOOLS_ENABLED", "false");
    expect((await read()).body).toMatchObject({ enabled: false, choices: [] });
    vi.unstubAllEnvs(); await db.update(authUsers).set({ emailVerified: false }).where(eq(authUsers.id, f.userId));
    expect((await read()).status).toBe(403);
  });
  it("cannot use a claimed administrator to read another conversation's private draft", async () => {
    const conversation = await issueService(db).create(f.home, { title: "PRIVATE source", assigneeAgentId: f.presence.id,
      conversationAgentId: f.presence.id, conversationUserId: f.userId, conversationState: "waiting", status: "in_review", createdByUserId: f.userId });
    const [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, responsibleUserId: f.userId,
      runtimeMode: "native", nativeIssueId: conversation.id, status: "running", contextSnapshot: { issueId: conversation.id, conversationSessionGeneration: 0 } }).returning();
    await db.update(issues).set({ executionRunId: run!.id }).where(eq(issues.id, conversation.id));
    const result = await applyWorkflowAuthoringApi(db, { type: "agent", source: "agent_jwt", companyId: f.home,
      agentId: f.presence.id, runId: run!.id }, f.home, { operation: "create_workflow", input: { name: "PRIVATE proposal", idempotencyKey: randomUUID() } });
    if (!("workflow" in result)) throw new Error("Expected saved workflow"); workflowId = result.workflow.id;
    expect((await read()).status).toBe(200);
    const other = randomUUID(), now = new Date();
    await db.insert(authUsers).values({ id: other, name: "Other reader", email: `${other}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId: f.home, principalType: "user", principalId: other, status: "active", membershipRole: "owner" });
    await db.insert(principalPermissionGrants).values(["workflows:read", "workflows:edit"].map(permissionKey => ({ companyId: f.home, principalType: "user", principalId: other, permissionKey })));
    actor = { type: "board", source: "session", userId: other, companyIds: [f.home], isInstanceAdmin: true };
    const denied = await read(other); expect(denied.status).toBe(403); expect(JSON.stringify(denied.body)).not.toContain("PRIVATE");
  });
});
