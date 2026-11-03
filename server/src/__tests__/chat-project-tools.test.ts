import { callProjectTool } from "../services/project-tools.js";
import { createLocalAgentJwt } from "../agent-auth-jwt.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { authSessions, authUsers, issues, heartbeatRuns, projects, companyMemberships } from "@paperclipai/db";
import express from "express";
import request from "supertest";
import { startRunnerApiTestServer } from "./helpers/runner-api-server.js";
import { issueService } from "../services/issues.js";
import { documentService } from "../services/documents.js";
import { getEmbeddedPostgresTestSupport } from "./helpers/embedded-postgres.js";
import { actorMiddleware } from "../middleware/auth.js";
import type { BetterAuthSessionResult } from "../auth/better-auth.js";
import { projectRoutes } from "../routes/projects.js";
import { errorHandler } from "../middleware/error-handler.js";

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("chat project tool handoff", () => {
  let server: Awaited<ReturnType<typeof startRunnerApiTestServer>>;
  const originalSecret = process.env.PAPERCLIP_AGENT_JWT_SECRET;
  beforeAll(async () => { process.env.PAPERCLIP_AGENT_JWT_SECRET = randomUUID(); server = await startRunnerApiTestServer(); }, 60_000);
  afterAll(async () => { await server?.close(); if (originalSecret === undefined) delete process.env.PAPERCLIP_AGENT_JWT_SECRET; else process.env.PAPERCLIP_AGENT_JWT_SECRET = originalSecret; });
  const call = (fixture: Awaited<ReturnType<typeof server.fixture>>, tool: string, args: Record<string, unknown>) => fixture.authority.execute({ tool, arguments: args, callId: randomUUID() });
  const humanProjectRequest = async (fixture: Awaited<ReturnType<typeof server.fixture>>, body: Record<string, unknown>) => {
    const app = express();
    app.use(express.json());
    app.use(actorMiddleware(server.db, { deploymentMode: "authenticated", resolveSession: async req => {
      const token=(req.header("cookie")??"").split(";").map(value=>value.trim())
        .map(value=>value.slice(value.indexOf("=")+1)).map(decodeURIComponent).find(value=>value===fixture.humanSessionToken);
      if(!token)return null;
      const [session]=await server.db.select({id:authSessions.id,userId:authSessions.userId,expiresAt:authSessions.expiresAt})
        .from(authSessions).where(and(eq(authSessions.token,token),eq(authSessions.userId,fixture.responsibleUserId!))).limit(1);
      if(!session||session.expiresAt.getTime()<=Date.now())return null;
      const [user]=await server.db.select({id:authUsers.id,name:authUsers.name,email:authUsers.email})
        .from(authUsers).where(eq(authUsers.id,session.userId)).limit(1);
      if(!user)return null;
      const result:BetterAuthSessionResult={session:{id:session.id,userId:session.userId,expiresAt:session.expiresAt},user};
      return result;
    }}));
    app.use("/api",projectRoutes(server.db));
    app.use(errorHandler);
    return request(app).post(`/api/companies/${fixture.companyId}/projects`)
      .set("cookie",`session_token=${encodeURIComponent(fixture.humanSessionToken!)}`).send(body);
  };
  const createHumanProject = async (fixture: Awaited<ReturnType<typeof server.fixture>>, body: Record<string, unknown>) => {
    const response = await humanProjectRequest(fixture, body);
    const result = response.body;
    expect(response.status, JSON.stringify(result)).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(300);
    return result;
  };

  it("does not let an unqualified Agent API call mutate its private conversation", async () => {
    const f = await server.fixture({ conversation: true });
    const token = createLocalAgentJwt(f.agentId, f.companyId, "paperclip_runner", f.runId, f.responsibleUserId)!;
    const response = await fetch(`${server.apiUrl}/api/issues/${f.issueId}`, {
      method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "in_review", comment: "The plan is ready for our next discussion." }),
    });
    const result = await response.json();
    expect(response.status, JSON.stringify(result)).toBe(422);
    expect(result.error).toMatch(/Private tasks are not available/);
    const [current] = await server.db.select().from(issues).where(eq(issues.id, f.issueId));
    expect(current?.status).toBe("in_progress");
  });

  it("does not let an unqualified Agent direct-tool call create a private conversation Task", async () => {
    const f = await server.fixture({ conversation: true });
    await documentService(server.db).upsertIssueDocument({ issueId: f.issueId, key: "plan", format: "markdown", body: "Full discussion plan" });
    const input = { title: "Implement the clarified outcome", projectId: f.projectId, initialPlan: "# Execution plan\n\nBuild and verify the outcome.", idempotencyKey: "handoff" };
    const before = await f.snapshot();
    await expect(call(f, "create_task", input)).rejects.toThrow(/Private tasks are not available|Task privacy source is unavailable/);
    const after = await f.snapshot();
    expect(after.issues).toEqual(before.issues);
    expect(after.issueDocuments).toEqual(before.issueDocuments);
    expect((await documentService(server.db).getIssueDocumentByKey(f.issueId, "plan"))?.body).toBe("Full discussion plan");
  });

  it("rejects creation, child helpers, and reparenting under a chat, while retaining legacy children", async () => {
    const f = await server.fixture({ conversation: true });
    const svc = issueService(server.db);
    await expect(svc.create(f.companyId, { title: "Invalid", parentId: f.issueId })).rejects.toThrow(/cannot have new subtasks/);
    await expect(svc.createChild(f.issueId, { title: "Invalid" })).rejects.toThrow(/cannot have new subtasks/);
    await expect(svc.importIssues(f.companyId, [{
      id: randomUUID(), ref: "imported", title: "Imported child", parentId: f.issueId,
      projectId: null, projectWorkspaceId: null, description: null, assigneeAgentId: null,
      status: "backlog", priority: "medium", billingCode: null, assigneeAdapterOverrides: null,
      executionWorkspaceSettings: null, labelIds: [], monitorNotes: null, monitorScheduledBy: null,
      visibility: "open", privacyRootIssueId: null, privacyParentIssueId: null, privacySources: [],
      responsibleUserId: null, createdByUserId: null,
    }])).rejects.toThrow(/cannot have new subtasks/);
    const ordinary = await svc.create(f.companyId, { title: "Ordinary" });
    await expect(svc.update(ordinary.id, { parentId: f.issueId })).rejects.toThrow(/cannot have new subtasks/);
    await server.db.update(issues).set({ parentId: f.issueId }).where(eq(issues.id, ordinary.id));
    expect(await svc.update(ordinary.id, { title: "Legacy edited", parentId: f.issueId })).toMatchObject({ title: "Legacy edited" });
    expect(await svc.update(ordinary.id, { parentId: null })).toMatchObject({ parentId: null });
  });

  it("rejects an unqualified MCP Agent handoff while preserving the plan document", async () => {
    const f = await server.fixture({ conversation: true });
    const before = await f.snapshot();
    await expect(callProjectTool({ name: "create_task", arguments: { title: "MCP handoff", projectId: f.projectId, initialPlan: "# Plan\nImplement in the execution task.", idempotencyKey: "mcp" },
      apiUrl: server.apiUrl, token: createLocalAgentJwt(f.agentId, f.companyId, "paperclip_runner", f.runId, f.responsibleUserId)!,
      companyId: f.companyId, issueId: f.issueId, agentId: f.agentId, conversation: true })).rejects.toThrow(/Private tasks are not available/);
    expect((await f.snapshot()).issues).toEqual(before.issues);
  });

  it("retains ordinary child delegation and projectless task creation", async () => {
    const f = await server.fixture();
    const result = await call(f, "create_task", { title: "Delegate ordinary work", idempotencyKey: "child" }) as any;
    expect(result.task.parentId).toBe(f.issueId);
    expect(await issueService(server.db).create(f.companyId, { title: "No project needed" })).toMatchObject({ projectId: null });
  });

  it("creates one Project through the authenticated Human API when an idempotency request is replayed", async () => {
    const f = await server.fixture({ projectReadSource: true });
    const input = { name: "New non-code project", description: "A well-scoped outcome", idempotencyKey: "project" };
    const requestBody = { ...input, idempotencyKey: randomUUID() };
    const project = await createHumanProject(f, requestBody);
    const replay = await createHumanProject(f, requestBody);
    expect(replay.id).toBe(project.id);
    expect((await server.db.select().from(projects).where(eq(projects.companyId, f.companyId))).filter(row => row.name === requestBody.name)).toHaveLength(1);
    const changed = await humanProjectRequest(f, { ...requestBody, name: "Changed" });
    expect(changed.status).toBe(409);
    await server.db.update(companyMemberships).set({ status: "inactive" }).where(eq(companyMemberships.principalId, f.responsibleUserId!));
    const revokedReplay = await humanProjectRequest(f, requestBody);
    expect(revokedReplay.status).toBeGreaterThanOrEqual(400);
    const afterRevocation = await humanProjectRequest(f, { ...requestBody, name: "No current membership", idempotencyKey: randomUUID() });
    expect(afterRevocation.status).toBeGreaterThanOrEqual(400);
    expect((await server.db.select().from(projects).where(eq(projects.companyId, f.companyId))).filter(row => row.name === requestBody.name)).toHaveLength(1);
  });

  it("includes an explicitly selected repository in a Human-created Project workspace", async () => {
    const f = await server.fixture({ projectReadSource: true });
    const project = await createHumanProject(f, { name: "Workspace repo", workspace: { repoUrl: "https://github.com/example/web" } });
    expect(project.workspaces).toEqual([expect.objectContaining({ repoUrl: "https://github.com/example/web", isPrimary: true })]);
  });

  it("registers and deduplicates repositories through the authenticated Human Project API", async () => {
    const f = await server.fixture({ projectReadSource: true });
    const project = await createHumanProject(f, { name: "Across repos", repositoryUrls: ["https://github.com/example/web.git", "https://github.com/example/api", "https://github.com/example/web/"] });
    expect(project.workspaces.map((w: any) => w.repoUrl).sort()).toEqual(["https://github.com/example/api", "https://github.com/example/web"]);
    expect(project.workspaces.filter((w: any) => w.isPrimary)).toHaveLength(1);
    const conflicting = await humanProjectRequest(f, { name: "Invalid", repositoryUrls: ["https://github.com/example/api"], workspace: { repoUrl: "https://github.com/example/web" } });
    expect(conflicting.status).toBe(422);
    const credentials = await humanProjectRequest(f, { name: "Invalid", repositoryUrls: ["https://user:password@github.com/example/api"] });
    expect(credentials.status).toBe(422);
    expect(JSON.stringify(credentials.body)).toMatch(/without credentials/i);
  });

  it("allows planning documents while denying project/task creation in Plan and Ask mode", async () => {
    for (const mode of ["planning", "ask"] as const) {
      const f = await server.fixture({ conversation: true, mode });
      await expect(call(f, "create_project", { name: "No", idempotencyKey: "no" })).rejects.toThrow(/mode_denied/);
      await expect(call(f, "create_task", { title: "No", idempotencyKey: "no" })).rejects.toThrow(/mode_denied/);
      if (mode === "planning") await call(f, "write_document", { key: "plan", title: "Plan", body: "Clarify and plan here", idempotencyKey: "plan" });
    }
  });

  it("rejects invented repository IDs through Human admission and rejects a cancelled Agent run", async () => {
    const f = await server.fixture({ projectReadSource: true });
    const projectsBefore = (await server.db.select().from(projects).where(eq(projects.companyId, f.companyId))).length;
    const missing = await humanProjectRequest(f, { name: "Missing repo", repositoryIds: ["999999"] });
    expect(missing.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(missing.body)).toMatch(/repository.*available/i);
    await server.db.update(heartbeatRuns).set({ status: "cancelled" }).where(eq(heartbeatRuns.id, f.runId));
    await expect(call(f, "create_project", { name: "Cancelled", idempotencyKey: "cancelled" })).rejects.toThrow();
    expect((await server.db.select().from(projects).where(eq(projects.companyId, f.companyId))).length).toBe(projectsBefore);
  });
});
