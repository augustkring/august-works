import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { agents, heartbeatRuns, companies, companyMemberships, createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, issues } from "@paperclipai/db";
import { databaseClientOptionsFromEnv } from "@paperclipai/db/client";
import { canActorReadHeartbeatRunPrivacy, canActorReadHeartbeatRunPrivacyBatch, canActorReadIssuePrivacy, canActorReadIssuePrivacyBatch } from "../services/authorization.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { seedCurrentHumanSourceActor } from "./helpers/current-human-source-fixture.js";

let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("v10-task-reader-plans-"); }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
afterAll(async () => { await database?.cleanup(); }, 30_000);

for (const prepare of [true, false]) {
  it(`keeps current Task readers and nested transaction visibility with prepared statements ${prepare}`, async () => {
    const db = createDb(database.connectionString, databaseClientOptionsFromEnv({
      DATABASE_PREPARED_STATEMENTS: String(prepare), DATABASE_POOL_MAX: "1",
    }));
    const companyId = randomUUID(), aliceId = randomUUID(), bobId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Current reader plans", issuePrefix: randomUUID() });
    const alice = await seedCurrentHumanSourceActor(db, [companyId], aliceId);
    const bob = await seedCurrentHumanSourceActor(db, [companyId], bobId);
    const [task] = await db.insert(issues).values({ companyId, title: "Private Task", visibility: "private",
      responsibleUserId: aliceId, createdByUserId: aliceId }).returning();
    const [agent] = await db.insert(agents).values({ companyId, name: "Source Run agent", role: "engineer", adapterType: "process" }).returning();
    const [run] = await db.insert(heartbeatRuns).values({ companyId, agentId: agent!.id, scopeKind: "issue",
      issueId: task!.id, nativeIssueId: task!.id, contextSnapshot: { issueId: task!.id },
      responsibleUserId: aliceId, status: "succeeded" }).returning();
    const [otherTask] = await db.insert(issues).values({ companyId, title: "Bob private Task", visibility: "private",
      responsibleUserId: bobId, createdByUserId: bobId }).returning();
    const [otherRun] = await db.insert(heartbeatRuns).values({ companyId, agentId: agent!.id, scopeKind: "issue",
      issueId: otherTask!.id, nativeIssueId: otherTask!.id, contextSnapshot: { issueId: otherTask!.id },
      responsibleUserId: bobId, status: "succeeded" }).returning();
    const missingId = randomUUID();
    const runIds = [run!.id, otherRun!.id, missingId];
    async function expectRunParity(tx: Parameters<typeof canActorReadHeartbeatRunPrivacy>[0]) {
      for (const actor of [alice, bob]) {
        const batch = await canActorReadHeartbeatRunPrivacyBatch(tx, actor, companyId, [...runIds, run!.id]);
        for (const id of runIds)
          expect(batch.get(id)).toBe(await canActorReadHeartbeatRunPrivacy(tx, actor, {companyId, id}));
      }
    }
    await db.transaction(async tx => {
      for (let round = 0; round < 7; round++) {
        expect(await canActorReadIssuePrivacy(tx, alice, task!)).toBe(true);
        expect(await canActorReadIssuePrivacy(tx, bob, task!)).toBe(false);
        expect(await canActorReadHeartbeatRunPrivacy(tx, alice, run!)).toBe(true);
        expect(await canActorReadHeartbeatRunPrivacy(tx, bob, run!)).toBe(false);
      }
      const plans = await tx.execute<{ generic: number; custom: number }>(sql`
        select generic_plans::int as generic, custom_plans::int as custom
        from pg_prepared_statements where length(statement)>50000
      `);
      if (prepare) {
        expect(plans).toHaveLength(2);
        // PERF5/PERF6: each reader is planned once (generic) from its first
        // execution, instead of custom-planning ~220 KB of SQL five times per
        // pooled connection.
        expect(plans.every(plan => plan.generic > 0 && plan.custom === 0)).toBe(true);
      }
      else expect(plans).toHaveLength(0);
      // The forced plan mode is scoped to each reader statement; the caller's
      // transaction keeps its own mode afterwards.
      const [mode] = await tx.execute<{ mode: string }>(sql`select current_setting('plan_cache_mode') as mode`);
      expect(mode?.mode).toBe("auto");
      await expectRunParity(tx);
      expect((await canActorReadIssuePrivacyBatch(tx, alice, companyId, [task!.id])).get(task!.id)).toBe(true);
      expect((await canActorReadIssuePrivacyBatch(tx, bob, companyId, [task!.id])).get(task!.id)).toBe(false);
      // F10c: single and batched Task reader probes of any size share one
      // statement, so the large predicate is planned once per connection. The
      // decisions stay per Task and per reader.
      for (const actor of [alice, bob]) {
        const pair = await canActorReadIssuePrivacyBatch(tx, actor, companyId, [task!.id, otherTask!.id, missingId]);
        for (const row of [task!, otherTask!, { id: missingId, companyId }])
          expect(pair.get(row.id)).toBe(await canActorReadIssuePrivacy(tx, actor, row));
      }
      expect([...(await canActorReadIssuePrivacyBatch(tx, alice, companyId, [task!.id, otherTask!.id])).values()]).toEqual([true, false]);
      expect([...(await canActorReadIssuePrivacyBatch(tx, bob, companyId, [task!.id, otherTask!.id])).values()]).toEqual([false, true]);
      const issueReaderPlans = await tx.execute<{ count: number }>(sql`
        select count(*)::int as count from pg_prepared_statements
        where length(statement)>50000 and statement like 'select "id" from "issues" %'
      `);
      expect(issueReaderPlans[0]?.count).toBe(prepare ? 1 : 0);
      await expect(tx.transaction(async nested => {
        await nested.update(companyMemberships).set({ status: "suspended" }).where(and(
          eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, aliceId)));
        expect(await canActorReadIssuePrivacy(nested, alice, task!)).toBe(false);
        expect(await canActorReadHeartbeatRunPrivacy(nested, alice, run!)).toBe(false);
        expect([...(await canActorReadHeartbeatRunPrivacyBatch(nested, alice, companyId, runIds)).values()]).toEqual([false, false, false]);
        await expectRunParity(nested);
        expect((await canActorReadIssuePrivacyBatch(nested, alice, companyId, [task!.id])).get(task!.id)).toBe(false);
        throw new Error("rollback membership suspension");
      })).rejects.toThrow("rollback membership suspension");
      await expectRunParity(tx);
      expect(await canActorReadIssuePrivacy(tx, alice, task!)).toBe(true);
      expect(await canActorReadIssuePrivacy(tx, bob, task!)).toBe(false);
      expect(await canActorReadHeartbeatRunPrivacy(tx, alice, run!)).toBe(true);
      expect(await canActorReadHeartbeatRunPrivacy(tx, bob, run!)).toBe(false);
    });
  });
}
