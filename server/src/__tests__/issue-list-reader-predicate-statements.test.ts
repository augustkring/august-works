import { randomUUID } from "node:crypto";
import express from "express";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  companies,
  companyMemberships,
  issueRelations,
  issues,
  type Db,
} from "@paperclipai/db";
import * as schema from "@paperclipai/db/schema/index";
import { installDatabaseWorkSignals } from "@paperclipai/db/work-signals";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";
import { ensureHumanRoleDefaultGrants } from "../services/principal-access-compatibility.js";
import { withCurrentTaskSourceRead } from "../services/task-source-read-scope.js";

// The Task reader predicate (`issueReadSqlCondition`) is about 200 KB of SQL
// with about 3,800 bind parameters. PostgreSQL spends about 100 ms planning
// each unnamed statement that embeds it, so the number of such statements is
// what makes a two-Task company list take seconds. These bounds are statement
// counts, not timings: they hold on any machine, and a change that adds a
// predicate-bearing statement to the list path has to raise them on purpose.
// Measured before the 2026-11-20 fix: 18 (plain) and 22 (UI query).
const READER_PREDICATE_MARKER = "with recursive privacy_nodes(kind,id)";
const PLAIN_LIST_PREDICATE_STATEMENT_LIMIT = 11;
const UI_LIST_PREDICATE_STATEMENT_LIMIT = 13;
const UI_LIST_QUERY = {
  excludeRoutineExecutions: "true",
  includeBlockedBy: "true",
  includeBlockedInboxAttention: "true",
  includeLiveDescendantSummary: "true",
  includePluginOperations: "true",
  limit: "200",
  offset: "0",
};

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres issue list predicate tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("company issue list Task reader predicate statements", () => {
  let db!: Db;
  let client!: ReturnType<typeof postgres>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let predicateStatements = 0;
  let companyId = "";
  let blockerId = "";
  let blockedId = "";
  const userId = "cloud-user-1";

  const actorFor = (company: string) => ({
    type: "board" as const,
    userId,
    companyIds: [company],
    memberships: [{ companyId: company, membershipRole: "owner", status: "active" }],
    source: "cloud_tenant" as const,
    isInstanceAdmin: false,
  });

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-issue-list-predicate-");
    client = postgres(tempDb.connectionString, {
      debug: (_connection, query) => {
        if (query.includes(READER_PREDICATE_MARKER)) predicateStatements += 1;
      },
    });
    db = installDatabaseWorkSignals(drizzle(client, { schema })) as unknown as Db;
  }, 20_000);

  afterAll(async () => {
    await client?.end();
    await tempDb?.cleanup();
  });

  beforeEach(async () => {
    companyId = randomUUID();
    blockerId = randomUUID();
    blockedId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `P${randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "owner",
      updatedAt: new Date(),
    });
    await ensureHumanRoleDefaultGrants(db, {
      companyId,
      principalId: userId,
      membershipRole: "owner",
      grantedByUserId: null,
    });
    await db.insert(issues).values([
      { id: blockerId, companyId, title: "Draft the launch announcement", status: "todo", priority: "high" },
      { id: blockedId, companyId, title: "Publish pricing page", status: "blocked", priority: "medium" },
    ]);
    await db.insert(issueRelations).values({
      companyId,
      issueId: blockerId,
      relatedIssueId: blockedId,
      type: "blocks",
    });
  });

  function createApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).actor = actorFor(companyId);
      next();
    });
    app.use("/api", issueRoutes(db, {} as any));
    app.use(errorHandler);
    return app;
  }

  async function countPredicateStatements(query: Record<string, string>) {
    predicateStatements = 0;
    const res = await request(createApp()).get(`/api/companies/${companyId}/issues`).query(query);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return { body: res.body as Array<Record<string, any>>, statements: predicateStatements };
  }

  it("keeps the plain list within its reader-predicate statement budget", async () => {
    const { body, statements } = await countPredicateStatements({});

    expect(body.map((issue) => issue.id).sort()).toEqual([blockerId, blockedId].sort());
    const blocked = body.find((issue) => issue.id === blockedId)!;
    expect(blocked.blockerAttention).toMatchObject({ unresolvedBlockerCount: 1, directBlockerIssueId: blockerId });
    expect(body.find((issue) => issue.id === blockerId)!.blockerAttention).toMatchObject({ state: "none" });
    expect(statements).toBeGreaterThan(0);
    expect(statements).toBeLessThanOrEqual(PLAIN_LIST_PREDICATE_STATEMENT_LIMIT);
  });

  it("keeps the Tasks page query within its reader-predicate statement budget", async () => {
    const { body, statements } = await countPredicateStatements(UI_LIST_QUERY);

    const blocked = body.find((issue) => issue.id === blockedId)!;
    expect(blocked.blockerAttention).toMatchObject({ unresolvedBlockerCount: 1, directBlockerIssueId: blockerId });
    expect(blocked.blockedBy.map((issue: { id: string }) => issue.id)).toEqual([blockerId]);
    expect(blocked).toHaveProperty("blockedInboxAttention");
    expect(blocked.liveDescendantCount).toBe(0);
    expect(statements).toBeGreaterThan(0);
    expect(statements).toBeLessThanOrEqual(UI_LIST_PREDICATE_STATEMENT_LIMIT);
  });

  it("plans the read scope with generic plans and restores a caller's settings", async () => {
    const settings = async (executor: Db) => (await executor.execute<{ plan: string; jit: string }>(
      sql`select current_setting('plan_cache_mode') as plan, current_setting('jit') as jit`,
    ))[0];

    const inside = await withCurrentTaskSourceRead(db, companyId, actorFor(companyId), (queryDb) => settings(queryDb), true, false);
    expect(inside).toEqual({ plan: "force_generic_plan", jit: "off" });

    const nested = await db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as Db;
      await tx.execute(sql`set local plan_cache_mode = force_custom_plan`);
      await tx.execute(sql`set local jit = on`);
      const during = await withCurrentTaskSourceRead(tx, companyId, actorFor(companyId), (queryDb) => settings(queryDb), true, false);
      return { during, after: await settings(tx) };
    });
    expect(nested.during).toEqual({ plan: "force_generic_plan", jit: "off" });
    expect(nested.after).toEqual({ plan: "force_custom_plan", jit: "on" });

    expect(await settings(db)).toEqual({ plan: "auto", jit: expect.any(String) });
  });
});
