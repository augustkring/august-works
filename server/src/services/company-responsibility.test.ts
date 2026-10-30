import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { authUsers, companies, companyMemberships, createDb } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../__tests__/helpers/embedded-postgres.js";
import { resolveCurrentDefaultResponsibleHuman } from "./company-responsibility.js";
import { accessService } from "./access.js";
import { eraseAccountAccess } from "./saas/account-deletion.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describePg = embeddedPostgresSupport.supported ? describe : describe.skip;

describePg("current company responsible Human", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const ids: Array<{ companyId: string; userId: string }> = [];

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-company-responsibility-");
    db = createDb(tempDb.connectionString);
  }, 20_000);
  afterEach(async () => {
    for (const { companyId, userId } of ids.splice(0)) {
      await db.delete(companyMemberships).where(eq(companyMemberships.companyId, companyId));
      await db.delete(authUsers).where(eq(authUsers.id, userId));
      await db.delete(companies).where(eq(companies.id, companyId));
    }
  });
  afterAll(async () => { await tempDb?.cleanup(); });

  it("never selects a successor when the configured Human is unavailable", async () => {
    const companyId = randomUUID(), userId = randomUUID();
    ids.push({ companyId, userId });
    const now = new Date();
    await db.insert(companies).values({ id: companyId, name: "Responsible Human", issuePrefix: `RH${companyId.slice(0, 6)}`, defaultResponsibleUserId: userId });
    await db.insert(authUsers).values({ id: userId, name: "Configured Human", email: `${userId}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, membershipRole: "owner", status: "active" });
    await expect(resolveCurrentDefaultResponsibleHuman(db, companyId)).resolves.toBe(userId);

    await db.transaction(tx => accessService(db).prepareMemberForOffboardingInTransaction(tx, userId, null, now));
    await expect(resolveCurrentDefaultResponsibleHuman(db, companyId)).resolves.toBeNull();
    const [cleared] = await db.select({ defaultResponsibleUserId: companies.defaultResponsibleUserId }).from(companies).where(eq(companies.id, companyId));
    expect(cleared?.defaultResponsibleUserId).toBeNull();

    await db.update(companies).set({ defaultResponsibleUserId: userId }).where(eq(companies.id, companyId));
    await db.update(companyMemberships).set({ status: "suspended" }).where(eq(companyMemberships.principalId, userId));
    await expect(resolveCurrentDefaultResponsibleHuman(db, companyId)).resolves.toBeNull();
    await db.update(companies).set({ defaultResponsibleUserId: null }).where(eq(companies.id, companyId));
    await expect(resolveCurrentDefaultResponsibleHuman(db, companyId)).resolves.toBeNull();

    await db.update(companies).set({ defaultResponsibleUserId: userId }).where(eq(companies.id, companyId));
    await db.transaction(tx => eraseAccountAccess(tx, userId, undefined, now));
    await expect(resolveCurrentDefaultResponsibleHuman(db, companyId)).resolves.toBeNull();
    expect(await db.select().from(companyMemberships).where(eq(companyMemberships.companyId, companyId))).toHaveLength(0);
  });
});
