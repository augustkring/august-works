import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, agents, authSessions, authUsers, companies, companyMemberships, createDb, documents,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, heartbeatRuns, issueDocuments, issues, principalPermissionGrants } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { activityRoutes } from "../routes/activity.js";
import { errorHandler } from "../middleware/error-handler.js";
import { issueService } from "../services/issues.js";
import { persistActivity } from "../services/activity-log.js";
import type { AuthorizationActor } from "../services/authorization.js";
import { projectRoutes } from "../routes/projects.js";
import { projectService } from "../services/projects.js";

describe("native activity source privacy before pagination and export", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let companyId: string, alice: AuthorizationActor, bob: AuthorizationActor;
  let publicAuditId: string, privateAuditId: string;
  let publicTaskId: string, privateTaskId: string;
  const privateMarker = "PRIVATE_NATIVE_ACTIVITY_RETAINED_BODY";
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("activity-native-source-privacy-");
    db = createDb(database.connectionString);
    companyId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Activity source company", issuePrefix: `AP${companyId.slice(0, 5)}` });
    async function human(name: string): Promise<AuthorizationActor> {
      const userId = randomUUID(), sessionId = randomUUID(), now = new Date();
      await db.insert(authUsers).values({ id: userId, name, email: `${userId}@test.invalid`, emailVerified: true,
        createdAt: now, updatedAt: now });
      await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId,
        status: "active", membershipRole: "member" });
      await db.insert(authSessions).values({ id: sessionId, userId, token: randomUUID(), createdAt: now,
        updatedAt: now, expiresAt: new Date(now.getTime() + 3600000) });
      await db.insert(principalPermissionGrants).values({ companyId, principalType: "user", principalId: userId,
        permissionKey: "audit:view_agent_actions" });
      return { type: "board", source: "session", userId, sessionId, companyIds: [companyId] };
    }
    alice = await human("Private source owner"); bob = await human("Other current audit reader");
    const svc = issueService(db);
    const publicTask = await svc.create(companyId, { title: "Public activity parent", createdByUserId: alice.userId });
    // Historical/domain private state; product HTTP private-work admission is
    // not enabled or bypassed by this source-read fixture.
    const privateTask = await svc.create(companyId, { title: privateMarker, visibility: "private",
      createdByUserId: alice.userId, responsibleUserId: alice.userId, actorResponsibleUserId: alice.userId });
    publicTaskId = publicTask.id; privateTaskId = privateTask.id;
    await persistActivity(db, { companyId, actorType: "user", actorId: alice.userId!, action: "issue.activity_source_control",
      entityType: "issue", entityId: publicTask.id, details: { marker: "public source" } });
    const [publicAudit] = await db.select().from(activityLog).where(and(eq(activityLog.companyId, companyId),
      eq(activityLog.entityId, publicTask.id), eq(activityLog.action, "issue.activity_source_control")));
    publicAuditId = publicAudit!.id;
    // Ensure deterministic newest-private ordering without mocking time.
    await db.update(activityLog).set({ createdAt: new Date(Date.now() - 60000) }).where(eq(activityLog.id, publicAuditId));
    await persistActivity(db, { companyId, actorType: "user", actorId: alice.userId!, action: "issue.activity_source_control",
      entityType: "issue", entityId: privateTask.id, details: { marker: privateMarker } });
    const [privateAudit] = await db.select().from(activityLog).where(and(eq(activityLog.companyId, companyId),
      eq(activityLog.entityId, privateTask.id), eq(activityLog.action, "issue.activity_source_control")));
    privateAuditId = privateAudit!.id;
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await database?.cleanup(); }, 30_000);
  function appFor(actor: AuthorizationActor) {
    const app = express(); app.use(express.json());
    // Native stored identity/membership/session with a structural HTTP carrier.
    app.use((req, _res, next) => { req.actor = actor as typeof req.actor; next(); });
    app.use("/api", activityRoutes(db)); app.use("/api", projectRoutes(db)); app.use(errorHandler);
    return app;
  }
  it("keeps the private owner's company activity while selecting the other reader's first authorized row", async () => {
    const owner = await request(appFor(alice)).get(`/api/companies/${companyId}/activity?limit=1`).expect(200);
    expect(owner.body.map((row: { id: string }) => row.id)).toEqual([privateAuditId]);
    const other = await request(appFor(bob)).get(`/api/companies/${companyId}/activity?limit=1`)
      .query({ reader: JSON.stringify(alice) }).expect(200);
    expect(other.body.map((row: { id: string }) => row.id)).toEqual([publicAuditId]);
    expect(JSON.stringify(other.body)).not.toContain(privateMarker);
  });
  it("filters unified audit rows before its cursor and enrichment", async () => {
    const response = await request(appFor(bob)).get(`/api/companies/${companyId}/audit/agent-actions?actorScope=all&limit=1`).expect(200);
    expect(response.body.items.map((row: { id: string }) => row.id)).toEqual([publicAuditId]);
    expect(response.body.nextCursor).toBeNull();
    expect(JSON.stringify(response.body)).not.toContain(privateMarker);
  });
  it("does not export private Task details or title through a company audit grant", async () => {
    const response = await request(appFor(bob)).get(`/api/companies/${companyId}/audit/agent-actions.csv?actorScope=all`).expect(200);
    expect(response.text).not.toContain(privateMarker);
    expect(response.text).toContain("issue.activity_source_control");
  });
  it.each(["issue_comment", "issue_document", "document_id", "heartbeat_run", "run_reference", "project"] as const)
    ("uses the actual %s owner before audit pagination", async kind => {
      const action = `native.activity_fixture.${kind}`;
      async function source(taskId: string, privateSource: boolean) {
        if (kind === "issue_comment") {
          const comment = await issueService(db).addComment(taskId, privateSource ? privateMarker : "Public comment", { userId: alice.userId! });
          return { entityType: "issue_comment", entityId: comment.id };
        }
        if (kind === "issue_document" || kind === "document_id") {
          const [doc] = await db.insert(documents).values({ companyId, title: privateSource ? privateMarker : "Public document",
            latestBody: "Unknown source fixture, not a qualified payload receipt" }).returning();
          const [link] = await db.insert(issueDocuments).values({ companyId, issueId: taskId, documentId: doc!.id,
            key: `source-${randomUUID()}` }).returning();
          return { entityType: "issue_document", entityId: kind === "document_id" ? doc!.id : link!.id };
        }
        if (kind === "project") {
          const response = await request(appFor(alice)).post(`/api/companies/${companyId}/projects`)
            .send({ name: `${privateSource ? "Private" : "Public"} source ${randomUUID()}` }).expect(201);
          if (privateSource) await projectService(db).update(response.body.id, { visibility: "private" }, alice);
          return { entityType: "project", entityId: response.body.id };
        }
        const [agent] = await db.insert(agents).values({ companyId, name: "Native audit scope fixture", adapterType: "paperclip_runner" }).returning();
        const [run] = await db.insert(heartbeatRuns).values({ companyId, agentId: agent!.id, scopeKind: "issue", issueId: taskId,
          nativeIssueId: taskId, contextSnapshot: { issueId: taskId }, responsibleUserId: alice.userId }).returning();
        return kind === "run_reference" ? { entityType: "company", entityId: companyId, runId: run!.id }
          : { entityType: "heartbeat_run", entityId: run!.id };
      }
      const publicSource = await source(publicTaskId, false), privateSource = await source(privateTaskId, true);
      for (const [owner, marker] of [[publicSource, "public source"], [privateSource, privateMarker]] as const)
        await persistActivity(db, { companyId, actorType: "user", actorId: alice.userId!, action, ...owner, details: { marker } });
      const owner = await request(appFor(alice)).get(`/api/companies/${companyId}/audit/agent-actions`)
        .query({ actorScope: "all", action, limit: 1 }).expect(200);
      expect(owner.body.items).toHaveLength(1);
      expect(owner.body.items[0].entityId).toBe(privateSource.entityId);
      const other = await request(appFor(bob)).get(`/api/companies/${companyId}/audit/agent-actions`)
        .query({ actorScope: "all", action, limit: 1 }).expect(200);
      expect(other.body.items).toHaveLength(1);
      expect(other.body.items[0].entityId).toBe(publicSource.entityId);
      expect(other.body.nextCursor).toBeNull();
      expect(JSON.stringify(other.body)).not.toContain(privateMarker);
    });
  it("denies malformed, missing and foreign native owners without hiding an authorized next row", async () => {
    const foreignCompanyId = randomUUID(), action = "native.activity_fixture.unavailable";
    await db.insert(companies).values({ id: foreignCompanyId, name: "Other source company", issuePrefix: `AF${foreignCompanyId.slice(0, 5)}` });
    const [foreignTask] = await db.insert(issues).values({ companyId: foreignCompanyId, title: "Foreign unknown native source" }).returning();
    await persistActivity(db, { companyId, actorType: "user", actorId: alice.userId!, action,
      entityType: "issue", entityId: publicTaskId });
    for (const entityId of ["malformed-native-uuid", randomUUID(), foreignTask!.id])
      await persistActivity(db, { companyId, actorType: "user", actorId: alice.userId!, action, entityType: "issue", entityId });
    const result = await request(appFor(alice)).get(`/api/companies/${companyId}/audit/agent-actions`)
      .query({ actorScope: "all", action, limit: 1 }).expect(200);
    expect(result.body.items.map((row: { entityId: string }) => row.entityId)).toEqual([publicTaskId]);
    expect(result.body.nextCursor).toBeNull();
  });
});
