import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  createDb,
  agentIdentities,
  agents,
  authUsers,
  companies,
  billingAccountCompanies,
  companyMemberships,
  companyOnboardingRuns,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { saasOnboardingService } from "../services/saas/onboarding.js";
import { purgeCompanyContent } from "../services/saas/company-purge.js";
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)(
  "V6 scoped content purge",
  () => {
    let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,
      db: ReturnType<typeof createDb>;
    beforeAll(async () => {
      database = await startEmbeddedPostgresTestDatabase("aw-v6-purge-");
      db = createDb(database.connectionString);
      await db
        .insert(authUsers)
        .values({
          id: "owner",
          name: "Owner",
          email: "owner@example.test",
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
    }, 60000);
    afterAll(async () => {
      await database?.cleanup();
    }, 30000);
    it("erases owned content and orphan persona metadata while preserving other companies and billing tombstones", async () => {
      const onboarding = saasOnboardingService(db),
        first = await onboarding.create("owner", {
          name: "Deleted fixture",
          idempotencyKey: "deleted-fixture-001",
        }),
        second = await onboarding.create("owner", {
          name: "Retained fixture",
          idempotencyKey: "retained-fixture-001",
        });
      const [shared, orphan] = await db
        .insert(agentIdentities)
        .values([
          { name: "Shared persona", homeCompanyId: first.companyId },
          {
            name: "Private persona",
            homeCompanyId: first.companyId,
            description: "Erase private profile",
          },
        ])
        .returning();
      await db.insert(agents).values([
        {
          companyId: first.companyId,
          agentIdentityId: shared!.id,
          name: "Deleted presence",
        },
        {
          companyId: first.companyId,
          agentIdentityId: orphan!.id,
          name: "Private presence",
        },
        {
          companyId: second.companyId,
          agentIdentityId: shared!.id,
          name: "Retained presence",
        },
      ]);
      const before = await db
        .select()
        .from(companyMemberships)
        .where(eq(companyMemberships.companyId, second.companyId));
      await expect(
        purgeCompanyContent(db, first.companyId),
      ).rejects.toBeTruthy();
      await db
        .update(agentIdentities)
        .set({ homeCompanyId: second.companyId })
        .where(eq(agentIdentities.id, shared!.id));
      const result = await purgeCompanyContent(db, first.companyId);
      expect(result.companyTombstoneRetained).toBe(true);
      expect(
        await db
          .select()
          .from(agents)
          .where(eq(agents.companyId, first.companyId)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(companyOnboardingRuns)
          .where(eq(companyOnboardingRuns.companyId, first.companyId)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(billingAccountCompanies)
          .where(eq(billingAccountCompanies.companyId, first.companyId)),
      ).toHaveLength(1);
      const [tombstone] = await db
        .select()
        .from(companies)
        .where(eq(companies.id, first.companyId));
      expect(tombstone!.name).toBe("Deleted company");
      const [retained] = await db
        .select()
        .from(agents)
        .where(eq(agents.companyId, second.companyId));
      expect(retained!.name).toBe("Retained presence");
      expect(
        await db
          .select()
          .from(companyMemberships)
          .where(eq(companyMemberships.companyId, second.companyId)),
      ).toEqual(before);
      const [persona] = await db
        .select()
        .from(agentIdentities)
        .where(eq(agentIdentities.id, orphan!.id));
      expect(persona).toMatchObject({
        name: "Deleted agent",
        description: null,
        status: "archived",
      });
      const [active] = await db
        .select()
        .from(agentIdentities)
        .where(eq(agentIdentities.id, shared!.id));
      expect(active!.name).toBe("Shared persona");
      expect(
        (await db.select().from(authUsers).where(eq(authUsers.id, "owner")))[0]!
          .email,
      ).toBe("owner@example.test");
    });
  },
);
