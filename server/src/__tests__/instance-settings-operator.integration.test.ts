import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  activityLog,
  authAccounts,
  authSessions,
  authUsers,
  createDb,
  type Db,
} from "@paperclipai/db";
import { errorHandler } from "../middleware/error-handler.js";
import { instanceSettingsRoutes } from "../routes/instance-settings.js";
import { heartbeatService, instanceSettingsService } from "../services/index.js";
import type { AuthorizationActor } from "../services/authorization.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { seedV5Companies } from "./helpers/v5-fixtures.js";
import { seedNativePasskeySession } from "./helpers/native-authentication-fixtures.js";

// Domain route evidence: the trusted actor carrier and structural proof rows
// do not qualify cookie authentication or a real WebAuthn ceremony.
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("SaaS instance settings operator authentication fence", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  let fixture: Awaited<ReturnType<typeof seedV5Companies>>;
  const actions = ["instance.settings.general_updated", "instance.task_drain.started", "instance.task_drain.stopped"];

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("v10-instance-operator-");
    db = createDb(database.connectionString);
    await instanceSettingsService(db).get();
  }, 60000);

  afterAll(async () => { await database?.cleanup(); }, 30000);
  afterEach(() => { heartbeatService(db).stopTaskDrain(); });

  beforeEach(async () => {
    fixture = await seedV5Companies(db);
    await instanceSettingsService(db).updateGeneral({ keyboardShortcuts: false });
    heartbeatService(db).stopTaskDrain();
  });

  function actor(sessionId?: string): AuthorizationActor {
    return {
      type: "board",
      source: "session",
      userId: fixture.userId,
      companyIds: [fixture.home, fixture.guest],
      ...(sessionId ? { sessionId } : {}),
    };
  }

  function app(forActor: AuthorizationActor) {
    const server = express();
    server.use(express.json());
    server.use((req, _res, next) => { req.actor = forActor; next(); });
    server.use("/api", instanceSettingsRoutes(db, {
      deploymentProfile: "saas",
      operatorUserIds: [fixture.userId],
    }));
    server.use(errorHandler);
    return server;
  }

  async function activityCount() {
    return (await db.select({ id: activityLog.id }).from(activityLog)
      .where(inArray(activityLog.action, actions))).length;
  }

  async function expectAllWritesDenied(forActor: AuthorizationActor) {
    const server = app(forActor);
    expect((await request(server).get("/api/instance/settings/general")).status).toBe(403);
    expect((await request(server).get("/api/instance/task-drain")).status).toBe(403);
    expect((await request(server).patch("/api/instance/settings/general").send({ keyboardShortcuts: true })).status).toBe(403);
    expect((await request(server).post("/api/instance/task-drain").send({})).status).toBe(403);
    expect((await request(server).delete("/api/instance/task-drain")).status).toBe(403);
  }

  it("denies a bare configured actor and a password-proof session before settings, audit, or drain effects", async () => {
    const beforeSettings = await instanceSettingsService(db).getGeneral();
    const beforeActivity = await activityCount();
    await expectAllWritesDenied(actor());

    const now = new Date();
    await db.insert(authAccounts).values({
      id: randomUUID(), issuer: "local:credential", accountId: fixture.userId,
      providerId: "credential", userId: fixture.userId,
      password: "structural-fixture-not-a-password-hash", createdAt: now, updatedAt: now,
    });
    const [user] = await db.select({ version: authUsers.authenticatorVersion })
      .from(authUsers).where(eq(authUsers.id, fixture.userId));
    const passwordSessionId = randomUUID();
    await db.insert(authSessions).values({
      id: passwordSessionId, userId: fixture.userId, token: randomUUID(),
      createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + 3600000),
      authenticationMethod: "password", authenticatedAt: now,
      authenticatorVersion: user!.version,
    });
    await expectAllWritesDenied(actor(passwordSessionId));

    expect(await instanceSettingsService(db).getGeneral()).toEqual(beforeSettings);
    expect(await activityCount()).toBe(beforeActivity);
    expect(heartbeatService(db).getTaskDrainStatus().draining).toBe(false);
  });

  it("accepts a current passkey proof and rejects the same actor after its session is deleted", async () => {
    const sessionId = await seedNativePasskeySession(db, fixture.userId);
    const server = app(actor(sessionId));
    const updated = await request(server)
      .patch("/api/instance/settings/general")
      .send({ keyboardShortcuts: true });
    expect(updated.status).toBe(200);
    expect(await instanceSettingsService(db).getGeneral()).toMatchObject({ keyboardShortcuts: true });

    const started = await request(server).post("/api/instance/task-drain").send({});
    expect(started.status).toBe(200);
    expect(heartbeatService(db).getTaskDrainStatus().draining).toBe(true);
    expect((await request(server).delete("/api/instance/task-drain")).status).toBe(200);
    expect(heartbeatService(db).getTaskDrainStatus().draining).toBe(false);

    await db.update(authSessions).set({ authenticatedAt: new Date(Date.now() - 301000) })
      .where(eq(authSessions.id, sessionId));
    expect((await request(server).get("/api/instance/settings/general")).status).toBe(200);
    expect((await request(server).patch("/api/instance/settings/general").send({ keyboardShortcuts: false })).status).toBe(403);

    await db.delete(authSessions).where(eq(authSessions.id, sessionId));
    const beforeActivity = await activityCount();
    expect((await request(server).patch("/api/instance/settings/general").send({ keyboardShortcuts: false })).status).toBe(403);
    expect((await request(server).post("/api/instance/task-drain").send({})).status).toBe(403);
    expect((await request(server).delete("/api/instance/task-drain")).status).toBe(403);
    expect(await instanceSettingsService(db).getGeneral()).toMatchObject({ keyboardShortcuts: true });
    expect(await activityCount()).toBe(beforeActivity);
    expect(heartbeatService(db).getTaskDrainStatus().draining).toBe(false);
  });
});
