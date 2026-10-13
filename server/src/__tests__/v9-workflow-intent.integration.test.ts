import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog, authUsers, companies, companyMemberships, createDb, instanceSettings,
  principalPermissionGrants, workflowRevisions, workflows,
} from "@paperclipai/db";
import { workflowIntentDraftCommandSchema } from "@paperclipai/shared";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { workflowDraftIntentService } from "../services/experience/workflow-draft-intent.js";
import { workflowService } from "../services/workflows/workflow-service.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import * as activity from "../services/v7-mutations.js";
import { workflowRoutes } from "../routes/workflows.js";
import { errorHandler } from "../middleware/error-handler.js";
import type { AuthorizationActor } from "../services/authorization.js";

const support = await getEmbeddedPostgresTestSupport();
const describePg = support.supported ? describe.sequential : describe.skip;
describePg("V9 Original workflow intent drafts", () => {
  let db!: ReturnType<typeof createDb>, fixture: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  const actor: AuthorizationActor = { type: "board", source: "session", userId: "intent-owner", ignoreInstanceAdmin: true };
  beforeAll(async () => {
    fixture = await startEmbeddedPostgresTestDatabase("v9-intent-"); db = createDb(fixture.connectionString);
  }, 120_000);
  afterEach(async () => {
    vi.restoreAllMocks();
    await db.delete(activityLog); await db.delete(workflows); await db.delete(principalPermissionGrants);
    await db.delete(companyMemberships); await db.delete(companies); await db.delete(authUsers); await db.delete(instanceSettings);
  });
  afterAll(async () => { await fixture?.cleanup(); });
  async function seed() {
    const now = new Date();
    await db.insert(authUsers).values({ id: actor.userId!, name: "Owner", email: "intent-owner@example.test", emailVerified: true, createdAt: now, updatedAt: now });
    const [company] = await db.insert(companies).values({ name: "Intent", issuePrefix: `I${randomUUID().slice(0, 6)}` }).returning();
    await db.insert(companyMemberships).values({ companyId: company!.id, principalType: "user", principalId: actor.userId!, membershipRole: "owner", status: "active" });
    await db.insert(principalPermissionGrants).values(["workflows:read", "workflows:edit"].map(permissionKey => ({
      companyId: company!.id, principalType: "user", principalId: actor.userId!, permissionKey,
    })));
    await instanceSettingsService(db).updateExperimental({ enableWorkflowsV1: true, experience_projection_v9: true, progressive_shell_v9: true });
    return company!.id;
  }
  function command() {
    return workflowIntentDraftCommandSchema.parse({ requestId: randomUUID(), name: "Review new enquiries", outcome: "Prepare an enquiry summary",
      trigger: "On request", sources: "Approved enquiries", conditions: "Only new enquiries", finalEffect: "An internal draft", humanJudgment: "Review before any external reply" });
  }
  function http(current = actor) {
    const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.actor = current; next(); });
    app.use("/api", workflowRoutes(db)); app.use(errorHandler); return request(app);
  }
  const route = (companyId: string, path: string, principal = actor.userId!) => `/api/companies/${companyId}/experience/${path}?expectedUserId=${principal}`;

  it("creates one Original unpublished draft, exact private receipt and no execution", async () => {
    const companyId = await seed(), input = command(), response = await http().post(route(companyId, "workflow-drafts")).send(input);
    expect(response.status).toBe(201); expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toMatchObject({ companyId, requestId: input.requestId, executionStarted: false, published: false });
    const [row] = await db.select().from(workflows);
    expect(row?.id).toBe(response.body.workflowId); expect(row?.publishedRevisionId).toBeNull();
    const [revision] = await db.select().from(workflowRevisions);
    expect(revision?.graph.nodes).toEqual([]); expect(revision?.state).toBe("draft");
    expect(row?.description).toContain(input.humanJudgment);
    const [event] = await db.select().from(activityLog);
    expect(event?.details).toMatchObject({ receipt: response.body });
    expect(JSON.stringify(event?.details)).not.toContain(input.outcome);
    const recovered = await http().get(route(companyId, `workflow-draft-requests/${input.requestId}`));
    expect(recovered.status).toBe(200); expect(recovered.body).toEqual(response.body);
  });
  it("serializes concurrent exact requests and refuses changed intent on the same identity", async () => {
    const companyId = await seed(), input = command(), svc = workflowDraftIntentService(db);
    const [first, repeated] = await Promise.all([svc.create(actor, companyId, input), svc.create(actor, companyId, input)]);
    expect(repeated).toEqual(first); expect(await db.select().from(workflows)).toHaveLength(1);
    expect(await db.select().from(activityLog)).toHaveLength(1);
    await expect(svc.create(actor, companyId, { ...input, outcome: "Different intent" })).rejects.toMatchObject({ status: 409 });
  });
  it("preserves Danish intent and its section labels without inventing unresolved choices", async () => {
    const companyId = await seed(), input = { ...command(), locale: "da" as const, outcome: "Udarbejd en oversigt", trigger: "", conditions: "" };
    await workflowDraftIntentService(db).create(actor, companyId, input);
    const [row] = await db.select().from(workflows);
    expect(row?.description).toContain("Ønsket resultat: Udarbejd en oversigt");
    expect(row?.description).not.toContain("Betingelser:"); expect(row?.description).not.toContain("Start eller gentagelse:");
  });
  it("retains the creation receipt after Native revision changes and rollout withdrawal", async () => {
    const companyId = await seed(), input = command(), svc = workflowDraftIntentService(db), receipt = await svc.create(actor, companyId, input);
    await workflowService(db).updateDraft(companyId, receipt.workflowId, { expectedRevisionId: receipt.draftRevisionId,
      graph: { version: 1, nodes: [], edges: [], variables: [], settings: { totalDeadlineSeconds: 30 } } },
      { principal: { type: "user", userId: actor.userId! } });
    await instanceSettingsService(db).updateExperimental({ progressive_shell_v9: false });
    expect(await svc.receipt(actor, companyId, input.requestId)).toEqual(receipt);
    expect(await svc.create(actor, companyId, input)).toEqual(receipt);
    await expect(svc.create(actor, companyId, command())).rejects.toMatchObject({ status: 404 });
    await expect(svc.index(actor, companyId)).rejects.toMatchObject({ status: 404 });
  });
  it("does not recreate a missing Native row from a retained request journal", async () => {
    const companyId = await seed(), input = command(), svc = workflowDraftIntentService(db), receipt = await svc.create(actor, companyId, input);
    await db.delete(workflows).where(eq(workflows.id, receipt.workflowId));
    await expect(svc.receipt(actor, companyId, input.requestId)).rejects.toMatchObject({ status: 404 });
    await expect(svc.create(actor, companyId, input)).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(workflows)).toHaveLength(0);
  });
  it("binds receipt reads to the verified creator, company and current account", async () => {
    const companyId = await seed(), input = command(), svc = workflowDraftIntentService(db);
    await svc.create(actor, companyId, input);
    const now = new Date(), other = { ...actor, userId: "intent-other" };
    await db.insert(authUsers).values({ id: other.userId, name: "Other", email: "intent-other@example.test", emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: other.userId, membershipRole: "owner", status: "active" });
    await db.insert(principalPermissionGrants).values({ companyId, principalType: "user", principalId: other.userId, permissionKey: "workflows:read" });
    await expect(svc.receipt(other, companyId, input.requestId)).rejects.toMatchObject({ status: 404 });
    expect((await http().get(route(companyId, `workflow-draft-requests/${input.requestId}`, other.userId))).status).toBe(409);
    await db.update(authUsers).set({ emailVerified: false }).where(eq(authUsers.id, actor.userId!));
    await expect(svc.receipt(actor, companyId, input.requestId)).rejects.toMatchObject({ status: 403 });
  });
  it("projects unpublished records as drafts and refuses viewer creation without an admin bypass", async () => {
    const companyId = await seed(), svc = workflowDraftIntentService(db);
    await svc.create(actor, companyId, command());
    expect(await svc.index(actor, companyId)).toMatchObject({ companyId, coverage: "bounded", canCreateDraft: true, workflows: [{ status: "draft" }] });
    await db.update(companyMemberships).set({ membershipRole: "viewer" }).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalId, actor.userId!)));
    await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, companyId), eq(principalPermissionGrants.permissionKey, "workflows:edit")));
    const elevated = { ...actor, isInstanceAdmin: true, ignoreInstanceAdmin: false };
    expect((await svc.index(elevated, companyId)).canCreateDraft).toBe(false);
    await expect(svc.create(elevated, companyId, command())).rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(workflows)).toHaveLength(1);
  });
  it("rolls back the Native draft, revision and receipt after late membership withdrawal", async () => {
    const companyId = await seed(), original = activity.logActivity;
    vi.spyOn(activity, "logActivity").mockImplementation(async (tx, input, publications) => {
      const result = await original(tx, input, publications);
      if (input.action === "workflow.experience_draft_created")
        await tx.delete(companyMemberships).where(eq(companyMemberships.companyId, companyId));
      return result;
    });
    await expect(workflowDraftIntentService(db).create(actor, companyId, command())).rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(workflows)).toHaveLength(0);
    expect(await db.select().from(workflowRevisions)).toHaveLength(0);
    expect(await db.select().from(activityLog)).toHaveLength(0);
    expect(await db.select().from(companyMemberships)).toHaveLength(1);
  });
  it("rejects supplied authority/graph fields and an unbound request lookup", async () => {
    const companyId = await seed(), input = command();
    expect((await http().post(route(companyId, "workflow-drafts")).send({ ...input, graph: { nodes: [] }, approval: true })).status).toBe(400);
    expect(await db.select().from(workflows)).toHaveLength(0);
    expect((await http().get(route(companyId, `workflow-draft-requests/${input.requestId}`))).status).toBe(404);
  });
});
