import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { createDb, companies, authUsers, companyMemberships, experienceObservations as observations,
  experienceObservationPreferences as preferences, experienceObservationCommands as commands, activityLog } from "@paperclipai/db";
import { experienceObservationService, eraseExpiredExperienceObservations } from "../services/experience/observations.js";
import { experienceObservationRoutes } from "../routes/experience-observations.js";
import { companyService } from "../services/companies.js";
import { errorHandler } from "../middleware/error-handler.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("optional local observations on migrated PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>, service: ReturnType<typeof experienceObservationService>;
  let companyId: string, userId: string;
  const actor = () => ({ type: "board" as const, source: "session" as const, userId, companyIds: [companyId] });
  const command = (enabled = true, expectedVersion: number | null = 0) => ({ requestId: randomUUID(), enabled, expectedVersion });
  const event = (preferenceVersion = 1) => ({ requestId: randomUUID(), preferenceVersion,
    kind: "surface_opened", surface: "home", variant: "streamlined", step: null, durationBucket: null });
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("aw-local-observations-");
    db = createDb(database.connectionString); service = experienceObservationService(db);
  });
  afterAll(async () => { await database?.cleanup(); });
  beforeEach(async () => {
    companyId = randomUUID(); userId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Local fixture", issuePrefix: `L${companyId.slice(0, 7)}` });
    await db.insert(authUsers).values({ id: userId, name: "PRIVATE-NAME", email: `${userId}@example.invalid`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, membershipRole: "viewer", status: "active" });
    await instanceSettingsService(db).updateExperimental({ experience_analytics_v9: true });
  });
  it("requires rollout and personal consent; original requests are immutable and duplicate events are free", async () => {
    expect(await service.get(actor(), companyId)).toMatchObject({ enabled: false, version: 0, collectionAvailable: true });
    await expect(service.record(actor(), companyId, event())).rejects.toMatchObject({ status: 409 });
    await instanceSettingsService(db).updateExperimental({ experience_analytics_v9: false });
    await expect(service.update(actor(), companyId, command())).rejects.toMatchObject({ status: 404 });
    await instanceSettingsService(db).updateExperimental({ experience_analytics_v9: true });
    const input = command(), receipt = await service.update(actor(), companyId, input);
    expect(await service.update(actor(), companyId, input)).toEqual(receipt);
    await expect(service.update(actor(), companyId, { ...input, enabled: false })).rejects.toMatchObject({ status: 409 });
    const observation = event();
    expect(await service.record(actor(), companyId, observation)).toMatchObject({ status: "recorded" });
    expect(await service.record(actor(), companyId, observation)).toMatchObject({ status: "duplicate" });
    await expect(service.record(actor(), companyId, { ...observation, surface: "support" })).rejects.toMatchObject({ status: 409 });
    expect((await service.summary(actor(), companyId)).counts).toEqual([{ kind: "surface_opened", surface: "home", variant: "streamlined", step: null, durationBucket: null, count: 1 }]);
    const audit = await db.select().from(activityLog).where(eq(activityLog.companyId, companyId));
    expect(audit.map(row => row.action)).toEqual(["experience_observation_preference.updated"]);
    expect(JSON.stringify(audit)).not.toContain("PRIVATE-NAME");
    expect(audit[0]!.details).toEqual({});
  });
  it("withdraws and erases after membership and rollout withdrawal; historical opt-in cannot re-enable", async () => {
    const original = command(); await service.update(actor(), companyId, original);
    await service.record(actor(), companyId, event());
    await db.update(companyMemberships).set({ status: "suspended" }).where(eq(companyMemberships.companyId, companyId));
    await instanceSettingsService(db).updateExperimental({ experience_analytics_v9: false });
    expect(await service.update(actor(), companyId, command(false, null))).toMatchObject({ enabled: false, observationsErased: true, version: 2 });
    await service.update(actor(), companyId, original);
    expect(await service.get(actor(), companyId)).toMatchObject({ enabled: false, version: 2, collectionAvailable: false });
    expect(await db.select().from(observations).where(eq(observations.companyId, companyId))).toEqual([]);
    await expect(service.record(actor(), companyId, event())).rejects.toMatchObject({ status: 403 });
  });
  it("rejects an old in-flight event after a later re-enable and serializes concurrent opt-ins", async () => {
    const results = await Promise.allSettled([service.update(actor(), companyId, command()), service.update(actor(), companyId, command())]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    await service.update(actor(), companyId, command(false, null));
    await service.update(actor(), companyId, command(true, 2));
    await expect(service.record(actor(), companyId, event(1))).rejects.toMatchObject({ status: 409 });
    await expect(service.record(actor(), companyId, event(3))).resolves.toMatchObject({ status: "recorded" });
  });
  it("bounds ingestion at 128 per rolling day without charging duplicates", async () => {
    await service.update(actor(), companyId, command());
    const first = event(); await service.record(actor(), companyId, first);
    for (let i = 1; i < 128; i++) await service.record(actor(), companyId, event());
    await expect(service.record(actor(), companyId, first)).resolves.toMatchObject({ status: "duplicate" });
    await expect(service.record(actor(), companyId, event())).rejects.toMatchObject({ status: 429 });
  });
  it("hides expired observations immediately and physically erases them with rollout disabled", async () => {
    await service.update(actor(), companyId, command()); await service.record(actor(), companyId, event());
    await db.execute(sql`update experience_observations set created_at=now()-interval '36 days', expires_at=now()-interval '1 day' where company_id=${companyId}`);
    await db.execute(sql`update experience_observation_commands set created_at=now()-interval '2 days', expires_at=now()-interval '1 day' where company_id=${companyId}`);
    await instanceSettingsService(db).updateExperimental({ experience_analytics_v9: false });
    expect((await service.summary(actor(), companyId)).counts).toEqual([]);
    expect(await eraseExpiredExperienceObservations(db)).toEqual({ observationsErased: 1, commandReceiptsErased: 1 });
  });
  it.each(["user", "company"])("cascades observations, choice and command receipts on %s deletion", async kind => {
    await service.update(actor(), companyId, command()); await service.record(actor(), companyId, event());
    if (kind === "user") await db.delete(authUsers).where(eq(authUsers.id, userId));
    else await companyService(db).remove(companyId);
    for (const table of [observations, preferences, commands]) expect(await db.select().from(table).where(eq(table.companyId, companyId))).toEqual([]);
  });
  it("requires current verified membership, including instance administrators", async () => {
    await db.update(authUsers).set({ emailVerified: false }).where(eq(authUsers.id, userId));
    await expect(service.update(actor(), companyId, command())).rejects.toMatchObject({ status: 403 });
    await db.update(authUsers).set({ emailVerified: true }).where(eq(authUsers.id, userId));
    await db.delete(companyMemberships).where(eq(companyMemberships.companyId, companyId));
    await expect(service.update({ ...actor(), isInstanceAdmin: true }, companyId, command())).rejects.toMatchObject({ status: 403 });
    await expect(service.get({ ...actor(), source: "local_implicit" }, companyId)).rejects.toMatchObject({ status: 403 });
  });
  it("binds HTTP identity, rejects private/free fields and applies no-store even on errors", async () => {
    const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.actor = actor(); next(); });
    app.use("/api", experienceObservationRoutes(db)); app.use(errorHandler);
    const path = `/api/companies/${companyId}/experience/observations`;
    const denied = await request(app).get(`${path}/preference?expectedUserId=other`).expect(409);
    expect(denied.headers["cache-control"]).toBe("private, no-store");
    await request(app).post(`${path}/preference?expectedUserId=${userId}`).send(command()).expect(200);
    await request(app).post(`${path}?expectedUserId=${userId}`).send({ ...event(), prompt: "PRIVATE-PROMPT" }).expect(400);
    const response = await request(app).get(`${path}/summary?expectedUserId=${userId}`).expect(200);
    expect(response.body.counts).toEqual([]);
    expect(JSON.stringify(response.body)).not.toContain("PRIVATE-");
  });
});
