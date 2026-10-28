import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  activityLog,
  accountDeletionOperations,
  authUsers,
  cases,
  companies,
  companyMemberships,
  createDb,
  instanceUserRoles,
  issues,
  principalPermissionGrants,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { cloudActorHeaderSourceFromHeaders, resolveCloudTenantActor } from "../middleware/auth.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres tenant provisioning tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

const SERVER_TOKEN = "test-server-token";

function tenantHeaders(input: { stackId: string; userId: string; companyName?: string; role?: "owner" | "admin" | "member" | "support" }) {
  const headers: Record<string, string> = {
    "x-paperclip-cloud-tenant-token": SERVER_TOKEN,
    "x-paperclip-cloud-user-id": input.userId,
    "x-paperclip-cloud-user-email": `${input.userId}@example.com`,
    "x-paperclip-cloud-stack-id": input.stackId,
    "x-paperclip-cloud-stack-role": input.role ?? "owner",
  };
  if (input.companyName) headers["x-paperclip-cloud-paperclip-company-name"] = input.companyName;
  return cloudActorHeaderSourceFromHeaders(headers);
}

/**
 * The prefix a pre-name-derivation build wrote. Pinned here on purpose: the
 * repair detects legacy rows by this exact value, so it must keep matching
 * what those builds produced.
 */
function legacyProvisionedPrefix(stackId: string) {
  return `PC${createHash("sha256").update(stackId).digest("hex").slice(0, 4).toUpperCase()}`;
}

function legacyProvisionedDescription(stackId: string) {
  return `Provisioned by Paperclip Cloud for stack ${stackId}.`;
}

describeEmbeddedPostgres("cloud tenant company provisioning", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-tenant-provisioning-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  beforeEach(() => {
    process.env.PAPERCLIP_CLOUD_TENANT_SERVER_TOKEN = SERVER_TOKEN;
  });

  afterEach(async () => {
    delete process.env.PAPERCLIP_CLOUD_TENANT_SERVER_TOKEN;
    await db.delete(activityLog);
    await db.delete(principalPermissionGrants);
    await db.delete(companyMemberships);
    await db.delete(accountDeletionOperations);
    await db.delete(cases);
    await db.delete(issues);
    await db.delete(companies);
    await db.delete(instanceUserRoles);
    await db.delete(authUsers);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function readCompany(companyId: string) {
    return db
      .select({
        name: companies.name,
        issuePrefix: companies.issuePrefix,
        description: companies.description,
      })
      .from(companies)
      .where(eq(companies.id, companyId))
      .then((rows) => rows[0] ?? null);
  }

  async function readIdentifiers(companyId: string) {
    const issueRows = await db
      .select({ identifier: issues.identifier })
      .from(issues)
      .where(eq(issues.companyId, companyId));
    const caseRows = await db
      .select({ identifier: cases.identifier })
      .from(cases)
      .where(eq(cases.companyId, companyId));
    return {
      issues: issueRows.map((row) => row.identifier).sort(),
      cases: caseRows.map((row) => row.identifier).sort(),
    };
  }

  describe("claim time", () => {
    it("derives the issue prefix from the company name and writes no placeholder description", async () => {
      const actor = await resolveCloudTenantActor(
        db,
        tenantHeaders({ stackId: "stack-claim-1", userId: "user-claim-1", companyName: "Acme Robotics" }),
      );

      const companyId = actor!.companyIds![0]!;
      await expect(readCompany(companyId)).resolves.toEqual({
        name: "Acme Robotics",
        issuePrefix: "ACM",
        description: null,
      });
    });

    it("derives the prefix from the humanized stack slug when no company name header is sent", async () => {
      const actor = await resolveCloudTenantActor(
        db,
        tenantHeaders({ stackId: "paperclip-stack-borealis", userId: "user-claim-2" }),
      );

      const companyId = actor!.companyIds![0]!;
      await expect(readCompany(companyId)).resolves.toMatchObject({
        name: "Borealis",
        issuePrefix: "BOR",
        description: null,
      });
    });

    it("suffixes the derived prefix when another company already holds it", async () => {
      await db.insert(companies).values({ name: "Acme Holdings", issuePrefix: "ACM" });

      const actor = await resolveCloudTenantActor(
        db,
        tenantHeaders({ stackId: "stack-claim-3", userId: "user-claim-3", companyName: "Acme Robotics" }),
      );

      const companyId = actor!.companyIds![0]!;
      await expect(readCompany(companyId)).resolves.toMatchObject({
        name: "Acme Robotics",
        issuePrefix: "ACMA",
      });
    });
  });

  describe("authoritative local membership state", () => {
    it.each(["suspended", "archived"] as const)(
      "does not revive a %s membership in the debounce window or on a later sync",
      async status => {
        const stackId = `stack-${status}-auth`;
        const userId = `user-${status}-auth`;
        const headers = tenantHeaders({ stackId, userId });
        const provisioned = await resolveCloudTenantActor(db, headers);
        const companyId = provisioned!.companyIds![0]!;

        await db.delete(principalPermissionGrants).where(and(
          eq(principalPermissionGrants.companyId, companyId),
          eq(principalPermissionGrants.principalId, userId),
        ));
        await db.update(companyMemberships).set({ status, permissionsInitializedAt: null })
          .where(and(
            eq(companyMemberships.companyId, companyId),
            eq(companyMemberships.principalType, "user"),
            eq(companyMemberships.principalId, userId),
          ));

        const debounced = await resolveCloudTenantActor(db, headers);
        expect(debounced?.companyIds).not.toContain(companyId);
        expect(debounced?.memberships).not.toContainEqual(expect.objectContaining({ companyId, status: "active" }));
        expect(await db.select({ status: companyMemberships.status }).from(companyMemberships)
          .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalId, userId))))
          .toMatchObject([{ status }]);
        expect(await db.select({ id: principalPermissionGrants.id }).from(principalPermissionGrants)
          .where(and(eq(principalPermissionGrants.companyId, companyId), eq(principalPermissionGrants.principalId, userId))))
          .toEqual([]);

        // A changed header role bypasses the write debounce. The conditional
        // conflict update still refuses to activate the locally denied row.
        const resynced = await resolveCloudTenantActor(db, tenantHeaders({ stackId, userId, role: "member" }));
        expect(resynced?.companyIds).not.toContain(companyId);
        expect(await db.select({ status: companyMemberships.status, membershipRole: companyMemberships.membershipRole })
          .from(companyMemberships).where(and(
            eq(companyMemberships.companyId, companyId),
            eq(companyMemberships.principalType, "user"),
            eq(companyMemberships.principalId, userId),
          ))).toMatchObject([{ status, membershipRole: "owner" }]);
        expect(await db.select({ id: principalPermissionGrants.id }).from(principalPermissionGrants)
          .where(and(eq(principalPermissionGrants.companyId, companyId), eq(principalPermissionGrants.principalId, userId))))
          .toEqual([]);
      },
    );

    it("refreshes an active membership without resetting initialized grants", async () => {
      const stackId = "stack-active-refresh";
      const userId = "user-active-refresh";
      const first = await resolveCloudTenantActor(db, tenantHeaders({ stackId, userId }));
      const companyId = first!.companyIds![0]!;
      const markerBefore = await db.select({ value: companyMemberships.permissionsInitializedAt })
        .from(companyMemberships).where(and(
          eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, userId),
        ));
      await db.insert(principalPermissionGrants).values({
        companyId,
        principalType: "user",
        principalId: userId,
        permissionKey: "tasks:assign_scope",
        grantedByUserId: null,
      }).onConflictDoNothing();

      const refreshed = await resolveCloudTenantActor(db, tenantHeaders({ stackId, userId, role: "member" }));
      expect(refreshed?.companyIds).toContain(companyId);
      const [membership] = await db.select({ status: companyMemberships.status, membershipRole: companyMemberships.membershipRole,
        permissionsInitializedAt: companyMemberships.permissionsInitializedAt })
        .from(companyMemberships).where(and(
          eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, userId),
        ));
      expect(membership).toMatchObject({ status: "active", membershipRole: "member" });
      expect(membership.permissionsInitializedAt?.getTime()).toBe(markerBefore[0]!.value?.getTime());
      expect(await db.select({ permissionKey: principalPermissionGrants.permissionKey }).from(principalPermissionGrants)
        .where(and(eq(principalPermissionGrants.companyId, companyId), eq(principalPermissionGrants.principalId, userId))))
        .toContainEqual({ permissionKey: "tasks:assign_scope" });
    });

    it("does not recreate a user or membership after account deletion is recorded", async () => {
      const stackId = "stack-deleted-account";
      const userId = "user-deleted-account";
      const first = await resolveCloudTenantActor(db, tenantHeaders({ stackId, userId }));
      const companyId = first!.companyIds![0]!;
      await db.delete(authUsers).where(eq(authUsers.id, userId));
      await db.delete(principalPermissionGrants).where(and(
        eq(principalPermissionGrants.companyId, companyId), eq(principalPermissionGrants.principalId, userId),
      ));
      await db.delete(companyMemberships).where(and(
        eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalId, userId),
      ));
      await db.insert(accountDeletionOperations).values({ userId, idempotencyKey: "deleted-account-test" });

      expect(await resolveCloudTenantActor(db, tenantHeaders({ stackId, userId }))).toBeNull();
      expect(await db.select({ id: authUsers.id }).from(authUsers).where(eq(authUsers.id, userId))).toEqual([]);
      expect(await db.select({ id: companyMemberships.id }).from(companyMemberships)
        .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalId, userId)))).toEqual([]);
    });

    it("keeps a concurrent local revocation authoritative over a Cloud refresh", async () => {
      const stackId = "stack-revocation-race";
      const userId = "user-revocation-race";
      const first = await resolveCloudTenantActor(db, tenantHeaders({ stackId, userId }));
      const companyId = first!.companyIds![0]!;
      let startRefresh!: () => void;
      let finishRevocation!: () => void;
      const refreshStarted = new Promise<void>(resolve => { startRefresh = resolve; });
      const revocationLocked = new Promise<void>(resolve => { finishRevocation = resolve; });
      let refresh!: ReturnType<typeof resolveCloudTenantActor>;
      const revocation = db.transaction(async tx => {
        await tx.select({ id: companyMemberships.id }).from(companyMemberships).where(and(
          eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, userId),
        )).for("update");
        finishRevocation();
        await refreshStarted;
        // The Cloud writer has started while this transaction owns the row
        // lock. Its status predicate must be checked after this commit.
        await new Promise(resolve => setTimeout(resolve, 30));
        await tx.update(companyMemberships).set({ status: "suspended" }).where(and(
          eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, userId),
        ));
        await tx.delete(principalPermissionGrants).where(and(
          eq(principalPermissionGrants.companyId, companyId), eq(principalPermissionGrants.principalId, userId),
        ));
      });
      await revocationLocked;
      refresh = resolveCloudTenantActor(db, tenantHeaders({ stackId, userId, role: "member" })).then(value => {
        startRefresh();
        return value;
      });
      await revocation;
      const refreshed = await refresh;
      expect(refreshed?.companyIds).not.toContain(companyId);
      expect(await db.select({ status: companyMemberships.status }).from(companyMemberships).where(and(
        eq(companyMemberships.companyId, companyId),
        eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, userId),
      ))).toMatchObject([{ status: "suspended" }]);
      expect(await db.select({ id: principalPermissionGrants.id }).from(principalPermissionGrants)
        .where(and(eq(principalPermissionGrants.companyId, companyId), eq(principalPermissionGrants.principalId, userId))))
        .toEqual([]);
    });
  });

  describe("legacy provisioning repair", () => {
    /**
     * Claims the company through the normal path, then rewrites it into the
     * shape a pre-name-derivation build left behind.
     */
    async function seedLegacyCompany(input: {
      stackId: string;
      claimUserId: string;
      companyName: string;
      issuePrefix?: string;
      description?: string | null;
    }) {
      const actor = await resolveCloudTenantActor(
        db,
        tenantHeaders({
          stackId: input.stackId,
          userId: input.claimUserId,
          companyName: input.companyName,
        }),
      );
      const companyId = actor!.companyIds![0]!;
      const issuePrefix = input.issuePrefix ?? legacyProvisionedPrefix(input.stackId);
      await db
        .update(companies)
        .set({
          issuePrefix,
          description: input.description === undefined
            ? legacyProvisionedDescription(input.stackId)
            : input.description,
        })
        .where(eq(companies.id, companyId));
      await db.insert(issues).values([
        { companyId, title: "First", issueNumber: 1, identifier: `${issuePrefix}-1` },
        { companyId, title: "Second", issueNumber: 20, identifier: `${issuePrefix}-20` },
      ]);
      await db.insert(cases).values({
        companyId,
        caseNumber: 4,
        identifier: `${issuePrefix}-C4`,
        caseType: "decision",
        title: "A case",
      });
      return { companyId, issuePrefix };
    }

    it("re-derives the prefix, clears the placeholder, and re-keys both identifier tables", async () => {
      const stackId = "stack-repair-1";
      const { companyId, issuePrefix: legacyPrefix } = await seedLegacyCompany({
        stackId,
        claimUserId: "user-repair-seed-1",
        companyName: "Acme Robotics",
      });

      await resolveCloudTenantActor(
        db,
        tenantHeaders({ stackId, userId: "user-repair-1", companyName: "Acme Robotics" }),
      );

      await expect(readCompany(companyId)).resolves.toEqual({
        name: "Acme Robotics",
        issuePrefix: "ACM",
        description: null,
      });
      await expect(readIdentifiers(companyId)).resolves.toEqual({
        issues: ["ACM-1", "ACM-20"],
        cases: ["ACM-C4"],
      });

      const logged = await db
        .select({ details: activityLog.details })
        .from(activityLog)
        .where(and(
          eq(activityLog.companyId, companyId),
          eq(activityLog.action, "company.updated"),
        ));
      expect(logged).toHaveLength(1);
      expect(logged[0]).toMatchObject({
        details: {
          source: "cloud_tenant_auth",
          reason: "legacy_provision_defaults_repair",
          previousIssuePrefix: legacyPrefix,
          issuePrefix: "ACM",
          descriptionCleared: true,
          issuesRekeyed: 2,
          casesRekeyed: 1,
        },
      });
    });

    it("is a no-op on a second pass", async () => {
      const stackId = "stack-repair-2";
      const { companyId } = await seedLegacyCompany({
        stackId,
        claimUserId: "user-repair-seed-2",
        companyName: "Acme Robotics",
      });

      await resolveCloudTenantActor(
        db,
        tenantHeaders({ stackId, userId: "user-repair-2a", companyName: "Acme Robotics" }),
      );
      const afterFirstPass = await readCompany(companyId);

      await resolveCloudTenantActor(
        db,
        tenantHeaders({ stackId, userId: "user-repair-2b", companyName: "Acme Robotics" }),
      );

      await expect(readCompany(companyId)).resolves.toEqual(afterFirstPass);
      await expect(readIdentifiers(companyId)).resolves.toEqual({
        issues: ["ACM-1", "ACM-20"],
        cases: ["ACM-C4"],
      });
      // The repair logged once, on the pass that actually changed the row.
      const logged = await db
        .select({ id: activityLog.id })
        .from(activityLog)
        .where(and(
          eq(activityLog.companyId, companyId),
          eq(activityLog.action, "company.updated"),
        ));
      expect(logged).toHaveLength(1);
    });

    it("clears only the placeholder description when the prefix is not the legacy hash", async () => {
      const stackId = "stack-repair-3";
      const { companyId } = await seedLegacyCompany({
        stackId,
        claimUserId: "user-repair-seed-3",
        companyName: "Acme Robotics",
        // A prefix the operator already re-derived or chose.
        issuePrefix: "ZEN",
      });

      await resolveCloudTenantActor(
        db,
        tenantHeaders({ stackId, userId: "user-repair-3", companyName: "Acme Robotics" }),
      );

      await expect(readCompany(companyId)).resolves.toEqual({
        name: "Acme Robotics",
        issuePrefix: "ZEN",
        description: null,
      });
      // Nothing was re-keyed, so the identifiers keep the prefix they had.
      await expect(readIdentifiers(companyId)).resolves.toEqual({
        issues: ["ZEN-1", "ZEN-20"],
        cases: ["ZEN-C4"],
      });
      const logged = await db
        .select({ id: activityLog.id })
        .from(activityLog)
        .where(eq(activityLog.companyId, companyId));
      expect(logged).toHaveLength(0);
    });

    it("leaves an operator-written description alone while it re-derives the prefix", async () => {
      const stackId = "stack-repair-4";
      const { companyId } = await seedLegacyCompany({
        stackId,
        claimUserId: "user-repair-seed-4",
        companyName: "Acme Robotics",
        description: "We build robots.",
      });

      await resolveCloudTenantActor(
        db,
        tenantHeaders({ stackId, userId: "user-repair-4", companyName: "Acme Robotics" }),
      );

      await expect(readCompany(companyId)).resolves.toEqual({
        name: "Acme Robotics",
        issuePrefix: "ACM",
        description: "We build robots.",
      });
    });
  });
});
