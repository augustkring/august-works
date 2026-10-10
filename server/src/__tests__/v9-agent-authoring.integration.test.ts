import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  createDb,
  agents,
  agentConfigurationDrafts,
  authUsers,
  activityLog,
  companyMemberships,
  principalPermissionGrants,
} from "@paperclipai/db";
import { agentAuthoringContentSchema } from "@paperclipai/shared";
import { agentAuthoringService } from "../services/agents/authoring-drafts.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)(
  "V9 canonical unpublished agent authoring",
  () => {
    let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,
      db: ReturnType<typeof createDb>,
      f: Awaited<ReturnType<typeof seedV5Presences>>,
      service: ReturnType<typeof agentAuthoringService>;
    beforeAll(async () => {
      database = await startEmbeddedPostgresTestDatabase(
        "aw-v9-agent-authoring-",
      );
      db = createDb(database.connectionString);
      await instanceSettingsService(db).getExperimental();
      await enableV5ForTest(db);
    }, 60000);
    afterAll(async () => database?.cleanup(), 30000);
    beforeEach(async () => {
      await instanceSettingsService(db).updateExperimental({
        saas_deployment_profile_v6: true,
        billing_v6: true,
        agent_packages_v7: true,
        hire_agent_v9: true,
      });
      f = await seedV5Presences(db);
      service = agentAuthoringService(db);
    });
    it("checks current revision admission without returning configuration or writing proposals, grants or audits", async () => {
      const drafts = await db.select().from(agentConfigurationDrafts);
      const activity = await db.select().from(activityLog);
      expect(await service.admission(f.actor, f.home, f.presence.id)).toEqual({
        companyId: f.home,
        agentId: f.presence.id,
        canCreateDraft: true,
      });
      expect(await db.select().from(agentConfigurationDrafts)).toEqual(drafts);
      expect(await db.select().from(activityLog)).toEqual(activity);
      await instanceSettingsService(db).updateExperimental({
        hire_agent_v9: false,
      });
      await expect(
        service.admission(f.actor, f.home, f.presence.id),
      ).rejects.toMatchObject({ status: 404 });
    });
    it("does not treat instance-admin or stale membership as current verified revision authority", async () => {
      await db
        .update(authUsers)
        .set({ emailVerified: false })
        .where(eq(authUsers.id, f.actor.userId!));
      await expect(
        service.admission(
          { ...f.actor, isInstanceAdmin: true },
          f.home,
          f.presence.id,
        ),
      ).rejects.toMatchObject({ status: 403 });
      await db
        .update(authUsers)
        .set({ emailVerified: true })
        .where(eq(authUsers.id, f.actor.userId!));
      await db
        .delete(companyMemberships)
        .where(eq(companyMemberships.principalId, f.actor.userId!));
      await expect(
        service.admission(
          { ...f.actor, isInstanceAdmin: true },
          f.home,
          f.presence.id,
        ),
      ).rejects.toMatchObject({ status: 403 });
    });
    it("reconciles concurrent new-draft creation without creating agents, effective revisions or duplicate audits", async () => {
      const body = { requestId: randomUUID(), agentId: null };
      const agentCount = (await db.select().from(agents)).length;
      const [first, second] = await Promise.all([
        service.create(f.actor, f.home, body),
        service.create(f.actor, f.home, body),
      ]);
      expect(first.id).toBe(second.id);
      expect(first.status).toBe("draft");
      expect(first.agentId).toBeNull();
      expect(await db.select().from(agents)).toHaveLength(agentCount);
      expect(
        (
          await db
            .select()
            .from(activityLog)
            .where(eq(activityLog.entityId, first.id))
        ).filter((e) => e.action === "agent_configuration.draft_created"),
      ).toHaveLength(1);
      await expect(
        service.create(f.actor, f.home, { ...body, agentId: f.presence.id }),
      ).rejects.toMatchObject({ status: 409 });
    });
    it("saves an active agent revision atomically without changing its configuration or authority", async () => {
      const [before] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, f.presence.id));
      const grants = await db
        .select()
        .from(principalPermissionGrants)
        .where(eq(principalPermissionGrants.companyId, f.home));
      const first = await service.create(f.actor, f.home, {
        requestId: randomUUID(),
        agentId: f.presence.id,
      });
      const body = {
        requestId: randomUUID(),
        expectedVersion: 1,
        step: "instructions",
        content: {
          ...first.content!,
          outcome: "Prepare a source-bound draft",
          instructions: {
            ...first.content!.instructions,
            purpose: "Private draft text canary",
          },
        },
      };
      const [saved, replay] = await Promise.all([
        service.save(f.actor, f.home, first.id, body),
        service.save(f.actor, f.home, first.id, body),
      ]);
      expect(saved.version).toBe(2);
      expect(saved).toEqual(replay);
      expect(
        (await db.select().from(agents).where(eq(agents.id, f.presence.id)))[0],
      ).toEqual(before);
      expect(
        await db
          .select()
          .from(principalPermissionGrants)
          .where(eq(principalPermissionGrants.companyId, f.home)),
      ).toEqual(grants);
      const audit = await db
        .select()
        .from(activityLog)
        .where(eq(activityLog.entityId, first.id));
      expect(
        audit.filter((e) => e.action === "agent_configuration.draft_saved"),
      ).toHaveLength(1);
      expect(JSON.stringify(audit)).not.toContain("Private draft text canary");
      await expect(
        service.save(f.actor, f.home, first.id, {
          ...body,
          content: { ...body.content, name: "Different" },
        }),
      ).rejects.toMatchObject({
        status: 409,
        details: { code: "draft_request_conflict" },
      });
      await expect(
        service.save(f.actor, f.home, first.id, {
          ...body,
          requestId: randomUUID(),
        }),
      ).rejects.toMatchObject({
        status: 409,
        details: { code: "draft_version_conflict" },
      });
    });
    it("keeps creator drafts private and denies revoked membership even to an instance administrator", async () => {
      const first = await service.create(f.actor, f.home, {
        requestId: randomUUID(),
      });
      const other = await seedV5Presences(db);
      await expect(
        service.get(other.actor, other.home, first.id),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.get(f.actor, f.guest, first.id),
      ).rejects.toMatchObject({ status: 404 });
      await db
        .update(companyMemberships)
        .set({ status: "suspended" })
        .where(sql`company_id=${f.home}::uuid and principal_id=${f.userId}`);
      await expect(
        service.get({ ...f.actor, isInstanceAdmin: true }, f.home, first.id),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        service.save(f.actor, f.home, first.id, {
          requestId: randomUUID(),
          expectedVersion: 1,
          step: "outcome",
          content: first.content,
        }),
      ).rejects.toMatchObject({ status: 403 });
    });
    it("keeps existing drafts readable and discardable on rollout rollback, with the payload erased", async () => {
      const first = await service.create(f.actor, f.home, {
        requestId: randomUUID(),
      });
      await instanceSettingsService(db).updateExperimental({
        hire_agent_v9: false,
      });
      expect((await service.get(f.actor, f.home, first.id)).id).toBe(first.id);
      expect((await service.list(f.actor, f.home)).items).toHaveLength(1);
      await expect(
        service.save(f.actor, f.home, first.id, {
          requestId: randomUUID(),
          expectedVersion: 1,
          step: "identity",
          content: first.content,
        }),
      ).rejects.toMatchObject({ status: 404 });
      const body = { requestId: randomUUID(), expectedVersion: 1 };
      const removed = await service.discard(f.actor, f.home, first.id, body);
      expect(removed.status).toBe("discarded");
      expect(removed.content).toBeNull();
      expect(await service.discard(f.actor, f.home, first.id, body)).toEqual(
        removed,
      );
      expect((await service.list(f.actor, f.home)).items).toHaveLength(0);
    });
    it("rejects foreign knowledge, owner and runtime references rather than treating draft text as a grant", async () => {
      const first = await service.create(f.actor, f.home, {
        requestId: randomUUID(),
      });
      for (const patch of [
        { knowledgeDocumentIds: [randomUUID()] },
        { runtimeBindingId: randomUUID() },
        { ownerUserId: "foreign-user" },
      ]) {
        await expect(
          service.save(f.actor, f.home, first.id, {
            requestId: randomUUID(),
            expectedVersion: 1,
            step: "knowledge",
            content: { ...first.content!, ...patch },
          }),
        ).rejects.toMatchObject({ status: 422 });
      }
      expect(
        agentAuthoringContentSchema.safeParse({
          ...first.content!,
          capabilities: [
            { operation: "change_permissions", autonomy: "automatic" },
          ],
        }).success,
      ).toBe(false);
      expect(
        agentAuthoringContentSchema.safeParse({
          ...first.content!,
          capabilities: [{ operation: "external_send", autonomy: "automatic" }],
        }).success,
      ).toBe(false);
    });
    it("detects a changed production baseline and reports unqualified tests without manufacturing execution evidence", async () => {
      const first = await service.create(f.actor, f.home, {
        requestId: randomUUID(),
        agentId: f.presence.id,
      });
      expect(
        (await service.review(f.actor, f.home, first.id)).baselineCurrent,
      ).toBe(true);
      await db
        .update(agents)
        .set({ capabilities: "Changed by an authorized native editor" })
        .where(eq(agents.id, f.presence.id));
      const review = await service.review(f.actor, f.home, first.id);
      expect(review.baselineCurrent).toBe(false);
      expect(review.publishAllowed).toBe(false);
      expect(review.test.status).toBe("unqualified");
      expect(review.productionChanged).toBe(false);
      expect(review.blockers.map((b) => b.code)).toContain(
        "production_baseline_changed",
      );
    });
    it("enforces native draft scope and version fences and account erasure without retaining authored content", async () => {
      const first = await service.create(f.actor, f.home, {
        requestId: randomUUID(),
      });
      await expect(
        db
          .update(agentConfigurationDrafts)
          .set({ companyId: f.guest, version: 2 })
          .where(eq(agentConfigurationDrafts.id, first.id)),
      ).rejects.toMatchObject({
        cause: {
          code: "23514",
          message: "agent_configuration_draft_scope_immutable",
        },
      });
      await expect(
        db
          .update(agentConfigurationDrafts)
          .set({ step: "identity" })
          .where(eq(agentConfigurationDrafts.id, first.id)),
      ).rejects.toMatchObject({
        cause: {
          code: "23514",
          message: "agent_configuration_draft_version_conflict",
        },
      });
      await db.delete(authUsers).where(eq(authUsers.id, f.userId));
      expect(
        await db
          .select()
          .from(agentConfigurationDrafts)
          .where(eq(agentConfigurationDrafts.id, first.id)),
      ).toHaveLength(0);
    });
    it("reads earlier accepted native drafts above the new write budget without permitting another oversized write", async () => {
      const content = agentAuthoringContentSchema.parse({
        ownerUserId: f.userId,
        scenarios: Array.from({ length: 10 }, () => "界".repeat(1800)),
      });
      content.instructions.responsibilities = "界".repeat(3200);
      const [row] = await db
        .insert(agentConfigurationDrafts)
        .values({
          companyId: f.home,
          createdByUserId: f.userId,
          creationRequestId: randomUUID(),
          creationRequestHash: "a".repeat(64),
          content,
        })
        .returning();
      expect((await service.get(f.actor, f.home, row!.id)).content).toEqual(
        content,
      );
      await expect(
        service.save(f.actor, f.home, row!.id, {
          requestId: randomUUID(),
          expectedVersion: 1,
          step: "instructions",
          content,
        }),
      ).rejects.toThrow("complete draft is too large");
      expect((await service.get(f.actor, f.home, row!.id)).version).toBe(1);
    });
    it("pages private draft history across native timestamp ties and rejects foreign cursors", async () => {
      const rows = await db
        .insert(agentConfigurationDrafts)
        .values(
          Array.from({ length: 30 }, () => ({
            companyId: f.home,
            createdByUserId: f.userId,
            creationRequestId: randomUUID(),
            creationRequestHash: "a".repeat(64),
            content: agentAuthoringContentSchema.parse({
              ownerUserId: f.userId,
            }),
            updatedAt: new Date("2026-10-09T00:00:00Z"),
          })),
        )
        .returning();
      await db.execute(
        sql`update agent_configuration_drafts set updated_at='2026-10-09T00:00:00.000456Z'::timestamptz,version=version+1 where company_id=${f.home}::uuid`,
      );
      const first = await service.list(f.actor, f.home);
      expect(first.items).toHaveLength(25);
      expect(first.items[0]).not.toHaveProperty("content");
      expect(first.items[0]).not.toHaveProperty("createdByUserId");
      expect(first.nextCursor).not.toBeNull();
      const second = await service.list(f.actor, f.home, first.nextCursor!);
      expect(second.items).toHaveLength(5);
      expect(second.nextCursor).toBeNull();
      expect(
        new Set([...first.items, ...second.items].map((item) => item.id)).size,
      ).toBe(rows.length);
      await expect(
        service.list(f.actor, f.guest, first.nextCursor!),
      ).rejects.toMatchObject({ status: 400 });
    });
  },
);
