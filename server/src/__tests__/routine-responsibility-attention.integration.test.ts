import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authUsers, companies, companyMemberships, createDb, routines, principalPermissionGrants, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS } from "@paperclipai/db";
import { enableV5ForTest } from "./helpers/v5-fixtures.js";
import { grantsForHumanRole } from "../services/company-member-roles.js";
import { experienceCardSchema } from "@paperclipai/shared";
import { readRoutineResponsibilityAttention } from "../services/experience/routine-responsibility-attention.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

describe("current native routine responsibility attention", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("routine-owner-attention-");
    db = createDb(database.connectionString, { maxConnections: 4 });
    await enableV5ForTest(db);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await database?.cleanup(); }, 30_000);

  it("shows a source-safe owner action only to a current manager and removes it after native responsibility recovery", async () => {
    const companyId = randomUUID(), foreignId = randomUUID(), now = new Date();
    for (const id of [companyId, foreignId]) await db.insert(companies).values({ id, name: "Ownership fixture", issuePrefix: `RA${id.slice(0, 6)}` });
    const owner = `owner-${randomUUID()}`, viewer = `viewer-${randomUUID()}`, departed = `departed-${randomUUID()}`, foreignOwner = `foreign-${randomUUID()}`;
    for (const id of [owner, viewer, departed, foreignOwner]) await db.insert(authUsers).values({ id, name: "Native owner fixture",
      email: `${id}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values([
      { companyId, principalType: "user", principalId: owner, status: "active", membershipRole: "owner" },
      { companyId, principalType: "user", principalId: viewer, status: "active", membershipRole: "viewer" },
      { companyId, principalType: "user", principalId: departed, status: "archived", membershipRole: "operator" },
      { companyId: foreignId, principalType: "user", principalId: foreignOwner, status: "active", membershipRole: "owner" },
    ]);
    for (const [principalId, scope, role] of [[owner, companyId, "owner"], [viewer, companyId, "viewer"], [foreignOwner, foreignId, "owner"]] as const)
      await db.insert(principalPermissionGrants).values(grantsForHumanRole(role).map(grant => ({ companyId: scope,
        principalType: "user" as const, principalId, ...grant })));
    const canary = `PRIVATE routine name and body ${randomUUID()}`;
    const [routine] = await db.insert(routines).values({ companyId, title: canary, description: canary,
      status: "paused", responsibleUserId: departed }).returning();
    const read = (userId: string) => readRoutineResponsibilityAttention(db,
      { type: "board", source: "session", userId }, companyId, new AbortController().signal);
    const attention = await read(owner);
    expect(attention.needsYou).toHaveLength(1);
    expect(experienceCardSchema.safeParse(attention.needsYou[0]).success).toBe(true);
    expect(JSON.stringify(attention)).not.toContain(canary);
    expect(JSON.stringify(attention)).not.toContain(departed);
    expect(JSON.stringify(attention)).not.toContain(routine!.id);
    expect((await read(viewer)).needsYou).toEqual([]);
    expect((await read(foreignOwner)).needsYou).toEqual([]);
    await db.update(routines).set({ responsibleUserId: owner }).where(eq(routines.id, routine!.id));
    expect((await read(owner)).needsYou).toEqual([]);
    await db.update(routines).set({ responsibleUserId: departed }).where(eq(routines.id, routine!.id));
    await db.update(companyMemberships).set({ status: "suspended" }).where(eq(companyMemberships.principalId, owner));
    expect((await read(owner)).needsYou).toEqual([]);
  });
});
