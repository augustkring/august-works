import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { agentIdentities, agents, companies, companyMemberships, createDb, principalPermissionGrants, readinessAssessments, readinessRequirements } from "@paperclipai/db";
import { assessReadinessSchema, createReadinessRequirementSchema } from "@paperclipai/shared";
import { readinessService } from "../services/readiness/readiness-service.js";
import { readinessHash } from "../services/readiness/readiness-policy.js";
import { readinessRoutes } from "../routes/readiness.js";
import { errorHandler } from "../middleware/error-handler.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { foundationService } from "../services/foundation/foundation-service.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("V7 readiness on migrated PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let companyId: string, agentId: string;
  const owner = { actor: { type: "board" as const, source: "local_implicit" as const }, principalId: "local-board", userId: null };
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-v7-readiness-"); db = createDb(database.connectionString); });
  afterAll(async () => { await database?.cleanup(); });
  beforeEach(async () => {
    companyId = randomUUID(); agentId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Readiness fixture", issuePrefix: `R${companyId.slice(0, 7)}` });
    const [identity] = await db.insert(agentIdentities).values({ name: "Assessor", homeCompanyId: companyId }).returning();
    await db.insert(agents).values({ id: agentId, companyId, agentIdentityId: identity!.id, name: "Assessor" });
    await db.insert(companyMemberships).values({ companyId, principalType: "agent", principalId: agentId, status: "active" });
    await db.insert(principalPermissionGrants).values(["company_scope:read", "foundation:read"].map((permissionKey) => ({ companyId, principalType: "agent", principalId: agentId, permissionKey })));
  });
  const input = (actionClass: "internal_draft" | "external_communication") => assessReadinessSchema.parse({ agentId, actionClass, query: "Prepare company work" });
  const requirement = () => createReadinessRequirementSchema.parse({ requirementKey: "company.extra", name: "Extra evidence", actionClass: "internal_draft", expectedVersion: 0,
    criteria: [{ key: "knowledge", domain: "market_customer", sourceClasses: ["foundation"], allowedPurposes: ["internal_draft"] }] });
  function app(actor: Express.Request["actor"]) {
    const application = express(); application.use(express.json());
    application.use((req, _res, next) => { req.actor = actor; next(); });
    application.use("/api", readinessRoutes(db)); application.use(errorHandler);
    return application;
  }

  it("enforces the feature gate and principal boundary through the HTTP API", async () => {
    const http = request(app(owner.actor));
    await http.get(`/api/companies/${companyId}/readiness/overview`).expect(404);
    await instanceSettingsService(db).updateExperimental({ enableFoundationV1: true, enableContextEngineV1: true, readiness_engine_v7: true });
    const created = await http.post(`/api/companies/${companyId}/readiness/assess`).send(input("internal_draft")).expect(201);
    await request(app({ type: "agent", companyId, agentId, source: "agent_key" }))
      .get(`/api/companies/${companyId}/readiness/assessments/${created.body.id}`).expect(404);
    await request(app({ type: "agent", companyId: randomUUID(), agentId, source: "agent_key" }))
      .get(`/api/companies/${companyId}/readiness/overview`).expect(403);
    await instanceSettingsService(db).updateExperimental({ readiness_engine_v7: false });
  });

  it("persists immutable action-specific assessments and scoped findings without a company score", async () => {
    const svc = readinessService(db);
    const draft = await svc.assess(companyId, input("internal_draft"), owner);
    const send = await svc.assess(companyId, input("external_communication"), owner);
    expect(draft.status).toBe("ready_with_warnings"); expect(send.status).toBe("blocked");
    expect(send.requirementSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(readinessHash(send.requirementSnapshot)).toBe(send.requirementSnapshotHash);
    const details = await svc.get(companyId, send.id, owner.principalId);
    expect(details.findings.length).toBeGreaterThan(0);
    await expect(svc.get(companyId, send.id, "user:another")).rejects.toMatchObject({ status: 404 });
    expect((await db.select().from(readinessAssessments).where(eq(readinessAssessments.id, draft.id)))[0]!.status).toBe("ready_with_warnings");
  });
  it("uses approved Foundation revisions and closes on permission revocation", async () => {
    const foundation = foundationService(db);
    for (const category of ["company", "governance"] as const) {
      const draft = await foundation.createDraft(companyId, { foundationKey: category, category, documentType: category, body: `# ${category}\nReviewed policy and company facts.`, authorityLevel: "canonical", sensitivity: "internal" }, { principal: { type: "system", service: "fixture" } });
      await foundation.submitForReview(companyId, draft.id, draft.latestRevisionId!, { principal: { type: "system", service: "fixture" } });
      await foundation.approve(companyId, draft.id, draft.latestRevisionId!, { principal: { type: "system", service: "fixture" } });
    }
    const svc = readinessService(db);
    const ready = await svc.assess(companyId, input("external_communication"), owner);
    expect(ready.status).toBe("ready");
    await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, companyId), eq(principalPermissionGrants.permissionKey, "foundation:read")));
    expect((await svc.assess(companyId, input("external_communication"), owner)).status).toBe("blocked");
    expect((await svc.get(companyId, ready.id, owner.principalId)).status).toBe("ready");
  });
  it("serializes concurrent requirement publication and cannot replace mandatory system policy", async () => {
    const svc = readinessService(db);
    await expect(svc.publishRequirement(companyId, { ...requirement(), requirementKey: "system.internal_draft" }, owner)).rejects.toMatchObject({ status: 403 });
    const outcomes = await Promise.allSettled([svc.publishRequirement(companyId, requirement(), owner), svc.publishRequirement(companyId, requirement(), owner)]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await svc.requirements(companyId)).toHaveLength(1);
    await svc.publishRequirement(companyId, { ...requirement(), expectedVersion: 1 }, owner);
    expect(await db.select().from(readinessRequirements).where(eq(readinessRequirements.companyId, companyId))).toHaveLength(2);
    expect((await svc.assess(companyId, input("internal_draft"), owner)).status).toBe("blocked");
  });
  it("rejects a foreign-company agent and foreign subject before source retrieval", async () => {
    const foreign = randomUUID();
    await expect(readinessService(db).assess(foreign, input("internal_draft"), owner)).rejects.toMatchObject({ status: 404 });
    await expect(readinessService(db).assess(companyId, { ...input("internal_draft"), subjectType: "task", subjectId: randomUUID() }, owner)).rejects.toMatchObject({ status: 404 });
  });
});
