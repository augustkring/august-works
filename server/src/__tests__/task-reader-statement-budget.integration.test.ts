import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  companies,
  createDb,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  issueRelations,
  issues,
} from "@paperclipai/db";
import { databaseClientOptionsFromEnv } from "@paperclipai/db/client";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";
import {
  authorizationService,
  canActorReadIssuePrivacy,
  canActorReadIssuePrivacyMany,
  type AuthorizationActor,
} from "../services/authorization.js";
import { experienceService } from "../services/experience/service.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { seedCurrentHumanSourceActor } from "./helpers/current-human-source-fixture.js";

// PERF5 / PERF6. The Task reader predicate is ~220 KB of SQL that PostgreSQL
// needs ~100 ms to plan. Home decided each Task with its own copy of it, and
// the Task list embedded it in a dozen unnamed (never plan-cached) blocker,
// inbox and metrics statements. These checks bound how many statements carry
// the predicate, and keep the batched decisions equal to the one-by-one ones.
const PREDICATE_SQL_LENGTH = 100_000;
const EXACT_READER_PREFIX =
  'select "id" from "issues" where ("issues"."company_id" = $1 and "issues"."id" = any($2::uuid[])';

const support = await getEmbeddedPostgresTestSupport();

function recordStatements(db: ReturnType<typeof createDb>) {
  const statements: string[] = [];
  const logger = { logQuery: (query: string) => { statements.push(query); } };
  const session = (db as unknown as { _: { session: { logger: unknown; options: { logger?: unknown } } } })._.session;
  session.logger = logger;
  session.options.logger = logger;
  return {
    predicate: () => statements.filter((query) => query.length > PREDICATE_SQL_LENGTH),
    reset: () => { statements.length = 0; },
  };
}

(support.supported ? describe : describe.skip)("Task reader statement budget (PERF5/PERF6)", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let seedDb: ReturnType<typeof createDb>;
  let companyId: string;
  let alice: AuthorizationActor;
  let bob: AuthorizationActor;
  const aliceId = `perf-alice-${randomUUID()}`;
  const bobId = `perf-bob-${randomUUID()}`;
  const ids = {} as Record<"open" | "alicePrivate" | "bobPrivate" | "blocked" | "openBlocker" | "bobBlocker", string>;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("v10-task-reader-budget-");
    seedDb = createDb(database.connectionString);
    companyId = randomUUID();
    await seedDb.insert(companies).values({ id: companyId, name: "Reader budget", issuePrefix: `RB${companyId.slice(0, 6)}` });
    alice = await seedCurrentHumanSourceActor(seedDb, [companyId], aliceId);
    bob = await seedCurrentHumanSourceActor(seedDb, [companyId], bobId);
    await instanceSettingsService(seedDb).updateExperimental({ experience_projection_v9: true });
    const insert = async (values: Partial<typeof issues.$inferInsert>) =>
      (await seedDb.insert(issues).values({ companyId, title: "Task", status: "todo", ...values }).returning())[0]!.id;
    for (let index = 0; index < 6; index++) {
      await insert({ title: `Open active ${index}`, status: "in_progress" });
      await insert({ title: `Open done ${index}`, status: "done" });
    }
    ids.open = await insert({ title: "Open active extra", status: "in_progress" });
    ids.alicePrivate = await insert({ title: "Alice private active", status: "in_progress", visibility: "private",
      responsibleUserId: aliceId, createdByUserId: aliceId });
    ids.bobPrivate = await insert({ title: "BOB-PRIVATE active", status: "in_progress", visibility: "private",
      responsibleUserId: bobId, createdByUserId: bobId });
    ids.blocked = await insert({ title: "Publish pricing page", status: "blocked" });
    ids.openBlocker = await insert({ title: "Draft pricing copy", status: "todo" });
    ids.bobBlocker = await insert({ title: "BOB-PRIVATE blocker", status: "todo", visibility: "private",
      responsibleUserId: bobId, createdByUserId: bobId });
    await seedDb.insert(issueRelations).values([
      { companyId, issueId: ids.openBlocker, relatedIssueId: ids.blocked, type: "blocks" },
      { companyId, issueId: ids.bobBlocker, relatedIssueId: ids.blocked, type: "blocks" },
    ]);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  afterAll(async () => {
    await database?.cleanup();
  }, 30_000);

  it("decides a set of Task reads exactly as one decision per Task", async () => {
    const missingId = randomUUID();
    const rows = await seedDb.select().from(issues).where(sql`${issues.id} = any(${`{${[ids.open, ids.alicePrivate, ids.bobPrivate].join(",")}}`}::uuid[])`);
    const resources = [
      ...rows.map((row) => ({ type: "issue" as const, companyId, issueId: row.id, projectId: row.projectId,
        assigneeAgentId: row.assigneeAgentId, assigneeUserId: row.assigneeUserId })),
      { type: "issue" as const, companyId, issueId: missingId },
    ];
    for (const actor of [alice, bob]) {
      const auth = authorizationService(seedDb);
      const one: Awaited<ReturnType<typeof auth.decide>>[] = [];
      for (const resource of resources) one.push(await auth.decide({ actor, action: "issue:read", resource }));
      expect(await auth.decideIssueReads(actor, resources)).toEqual(one);
      expect(one.map((decision) => decision.reason)).toContain("deny_issue_private");

      const candidates = [ids.open, ids.alicePrivate, ids.bobPrivate, missingId, ids.bobPrivate.toUpperCase()];
      const many = await canActorReadIssuePrivacyMany(seedDb, actor, companyId, candidates);
      for (const id of candidates)
        expect(many.get(id), id).toBe(await canActorReadIssuePrivacy(seedDb, actor, { id, companyId }));
    }
  });

  it("plans the exact-id Task reader generically outside a transaction and leaves the session mode", async () => {
    const single = createDb(database.connectionString, databaseClientOptionsFromEnv({ DATABASE_POOL_MAX: "1" }));
    for (let round = 0; round < 3; round++) {
      expect(await canActorReadIssuePrivacy(single, alice, { id: ids.alicePrivate, companyId })).toBe(true);
      expect(await canActorReadIssuePrivacy(single, bob, { id: ids.alicePrivate, companyId })).toBe(false);
    }
    const plans = await single.execute<{ generic: number; custom: number }>(sql`
      select generic_plans::int as generic, custom_plans::int as custom
      from pg_prepared_statements where length(statement) > ${PREDICATE_SQL_LENGTH}
    `);
    expect(plans.length).toBeGreaterThan(0);
    expect(plans.every((plan) => plan.generic > 0 && plan.custom === 0)).toBe(true);
    const [mode] = await single.execute<{ mode: string }>(sql`select current_setting('plan_cache_mode') as mode`);
    expect(mode?.mode).toBe("auto");
  });

  it("serves a cold first Home with one Task reader statement per phase instead of one per Task", async () => {
    const db = createDb(database.connectionString);
    const statements = recordStatements(db);
    const home = await experienceService(db).home(alice, companyId);
    const inProgress = home.inProgress.map((card) => card.id);
    expect(inProgress).toContain(ids.alicePrivate);
    expect(inProgress).toContain(ids.open);
    expect(inProgress).not.toContain(ids.bobPrivate);
    expect(home.done).toHaveLength(6);
    expect(JSON.stringify(home)).not.toContain("BOB-PRIVATE");
    // At most one per phase (Task reader, post-fan-out recheck, attention and
    // its recheck). One decision per Task used about 30 here.
    const predicate = statements.predicate();
    expect(predicate.length).toBeLessThanOrEqual(4);
    expect(predicate.every((query) => query.startsWith(EXACT_READER_PREFIX))).toBe(true);
  });

  it("lists Tasks without re-planning the reader in blocker, inbox and metrics reads", async () => {
    const db = createDb(database.connectionString);
    const statements = recordStatements(db);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = { ...alice, userId: aliceId, sessionId: alice.sessionId ?? undefined, companyIds: [companyId] } as Express.Request["actor"];
      next();
    });
    app.use("/api", issueRoutes(db, {} as never));
    app.use(errorHandler);
    const response = await request(app).get(`/api/companies/${companyId}/issues`).expect(200);
    const listed = (response.body as Array<{ id: string }>).map((row) => row.id);
    expect(listed).toEqual(expect.arrayContaining([ids.blocked, ids.openBlocker, ids.alicePrivate]));
    expect(listed).not.toContain(ids.bobPrivate);
    expect(listed).not.toContain(ids.bobBlocker);
    expect(JSON.stringify(response.body)).not.toContain("BOB-PRIVATE");
    // Only the paged list query itself embeds the predicate (SQL before the
    // limit). Everything else uses the shared, plan-cached exact-id reader.
    const embedded = statements.predicate().filter((query) => !query.startsWith(EXACT_READER_PREFIX));
    expect(embedded.length).toBeLessThanOrEqual(1);
  });
});
