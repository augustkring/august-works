import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { activityLog, agents, authUsers, companies, companyMemberships, createDb, heartbeatRuns, projects, projectWorkspaces } from "@paperclipai/db";
import { actorMiddleware } from "../middleware/auth.js";
import { errorHandler } from "../middleware/index.js";
import { projectRoutes } from "../routes/projects.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("V9 creator-bound Native project recovery", () => {
  let db: ReturnType<typeof createDb>;
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-v9-project-recovery-");
    db = createDb(database.connectionString);
    await instanceSettingsService(db).updateExperimental({ experience_projection_v9: true, ambient_commands_v9: true });
  }, 20_000);
  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(projectWorkspaces);
    await db.delete(projects);
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(companyMemberships);
    await db.delete(authUsers);
    await db.delete(companies);
  });
  afterAll(async () => database?.cleanup());
  async function company() {
    const id = randomUUID();
    await db.insert(companies).values({ id, name: "Project recovery fixture", issuePrefix: `P${id.replace(/-/g, "").slice(0, 5).toUpperCase()}` });
    return id;
  }
  async function user(companyId: string) {
    const id = randomUUID();
    await db.insert(authUsers).values({ id, name: id, email: `${id}@example.com`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: id, status: "active", membershipRole: "member" });
    return id;
  }
  function app(userId?: string, companyId?: string) {
    const app = express();
    app.use(express.json());
    if (userId) app.use((req, _res, next) => {
      req.actor = { type: "board", source: "session", userId, companyIds: [companyId!] };
      next();
    });
    else app.use(actorMiddleware(db, { deploymentMode: "local_trusted" }));
    app.use("/api", projectRoutes(db));
    app.use(errorHandler);
    return app;
  }
  const path = (companyId: string, key: string) => `/api/companies/${companyId}/projects/create-receipts/${key}`;

  it("reads only current Native project fields with no second create or runtime effect", async () => {
    const id = await company(), key = randomUUID(), server = app();
    const created = await request(server).post(`/api/companies/${id}/projects`).send({ name: "Private project", description: "PRIVATE-DESCRIPTION", status: "planned", idempotencyKey: key }).expect(201);
    await db.update(projects).set({ name: "Current project name" }).where(eq(projects.id, created.body.id));
    const read = await request(server).get(path(id, key)).expect(200);
    expect(read.body).toEqual({ id: created.body.id, companyId: id, name: "Current project name" });
    expect(read.headers["cache-control"]).toBe("no-store");
    expect(await db.select().from(projects)).toHaveLength(1);
    expect(await db.select().from(activityLog)).toHaveLength(1);
    expect(await db.select().from(projectWorkspaces)).toEqual([]);
    expect(await db.select().from(agents)).toEqual([]);
    expect(await db.select().from(heartbeatRuns)).toEqual([]);
  });
  it("does not fabricate a missing key or project", async () => {
    const id = await company();
    await request(app()).get(path(id, randomUUID())).expect(404);
    expect(await db.select().from(projects)).toEqual([]);
    expect(await db.select().from(activityLog)).toEqual([]);
  });
  it("refuses another company without leaking its current project name", async () => {
    const owner = await company(), foreign = await company(), key = randomUUID(), server = app();
    await request(server).post(`/api/companies/${owner}/projects`).send({ name: "FOREIGN-PRIVATE-PROJECT", idempotencyKey: key }).expect(201);
    const response = await request(server).get(path(foreign, key)).expect(404).expect("Cache-Control", "no-store");
    expect(JSON.stringify(response.body)).not.toContain("FOREIGN-PRIVATE-PROJECT");
  });
  it("does not turn company-visible project access into another creator's receipt", async () => {
    const id = await company(), alice = await user(id), bob = await user(id), key = randomUUID();
    const created = await request(app(alice, id)).post(`/api/companies/${id}/projects`).send({ name: "Creator-private project", idempotencyKey: key }).expect(201);
    await request(app(alice, id)).get(path(id, key)).expect(200);
    await request(app(bob, id)).get(`/api/projects/${created.body.id}`).expect(200);
    const denied = await request(app(bob, id)).get(path(id, key)).expect(404).expect("Cache-Control", "no-store");
    expect(JSON.stringify(denied.body)).not.toContain("Creator-private project");
    expect(await db.select().from(projects)).toHaveLength(1);
  });
  it("keeps an erased original receipt unconfirmed without renewing it", async () => {
    const id = await company(), key = randomUUID(), server = app();
    await request(server).post(`/api/companies/${id}/projects`).send({ name: "Receipt-erased project", idempotencyKey: key }).expect(201);
    await db.delete(activityLog).where(eq(activityLog.companyId, id));
    await request(server).get(path(id, key)).expect(404).expect("Cache-Control", "no-store");
    expect(await db.select().from(projects)).toHaveLength(1);
    expect(await db.select().from(activityLog)).toEqual([]);
  });
  it("withdraws recovery when the creator's current membership is revoked", async () => {
    const id = await company(), creator = await user(id), key = randomUUID(), server = app(creator, id);
    await request(server).post(`/api/companies/${id}/projects`).send({ name: "REVOKED-PRIVATE-PROJECT", idempotencyKey: key }).expect(201);
    await db.update(companyMemberships).set({ status: "suspended" }).where(and(eq(companyMemberships.companyId, id), eq(companyMemberships.principalId, creator)));
    // The canonical Project reader hides objects after current membership is withdrawn.
    const denied = await request(server).get(path(id, key)).expect(404).expect("Cache-Control", "no-store");
    expect(JSON.stringify(denied.body)).not.toContain("REVOKED-PRIVATE-PROJECT");
  });
  it("rejects malformed keys without creating any receipt", async () => {
    const id = await company();
    await request(app()).get(path(id, "not-a-key")).expect(400).expect("Cache-Control", "no-store");
    expect(await db.select().from(projects)).toEqual([]);
    expect(await db.select().from(activityLog)).toEqual([]);
  });
  it("rejects a malformed company before a receipt read and keeps the refusal uncached", async () => {
    await request(app()).get(path("not-a-company", randomUUID())).expect(400).expect("Cache-Control", "no-store");
    expect(await db.select().from(projects)).toEqual([]);
    expect(await db.select().from(activityLog)).toEqual([]);
  });
  it("respects a current feature rollback without disclosing prior project fields", async () => {
    const id = await company(), key = randomUUID(), server = app();
    await request(server).post(`/api/companies/${id}/projects`).send({ name: "ROLLED-BACK-PRIVATE-PROJECT", idempotencyKey: key }).expect(201);
    await instanceSettingsService(db).updateExperimental({ ambient_commands_v9: false });
    try {
      const denied = await request(server).get(path(id, key)).expect(404).expect("Cache-Control", "no-store");
      expect(JSON.stringify(denied.body)).not.toContain("ROLLED-BACK-PRIVATE-PROJECT");
      expect(await db.select().from(projects)).toHaveLength(1);
    } finally { await instanceSettingsService(db).updateExperimental({ ambient_commands_v9: true }); }
  });
});
