import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  authUsers,
  companies,
  companyMemberships,
  createDb,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  instanceUserRoles,
  issueCreateIdempotencyKeys,
  issues,
} from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { seedNativePasskeySession } from "./helpers/native-authentication-fixtures.js";
import type { AuthorizationActor } from "../services/authorization.js";
import { issueService, lockIssuePrivacyTree } from "../services/issues.js";

describe("manual Task idempotent replay keeps its original credential deadline", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("manual-task-replay-deadline-");
    db = createDb(database.connectionString, { maxConnections: 8 });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  afterAll(async () => { await database?.cleanup(); }, 30_000);

  async function companyAndUser(withMembership: boolean) {
    const companyId = randomUUID(), userId = randomUUID(), now = new Date();
    await db.insert(companies).values({ id: companyId, name: "Replay deadline company", issuePrefix: `RD${companyId.slice(0, 5)}` });
    await db.insert(authUsers).values({ id: userId, name: "Replay deadline Human", email: `${userId}@example.test`, createdAt: now, updatedAt: now });
    if (withMembership) await db.insert(companyMemberships).values({
      companyId, principalType: "user", principalId: userId, membershipRole: "member", status: "active",
    });
    return { companyId, userId };
  }

  function actorFor(companyId: string, userId: string, sessionId: string, hasMembership: boolean): AuthorizationActor {
    return {
      type: "board", source: "session", userId, sessionId,
      companyIds: [companyId],
      memberships: hasMembership ? [{ companyId, membershipRole: "member", status: "active" }] : [],
    };
  }

  async function seedUnknownIdempotentTask(companyId: string, userId: string, idempotencyKey: string) {
    const title = `Replay ${randomUUID()}`;
    const original = await issueService(db).create(companyId, {
      title,
      description: "Existing unqualified request",
      createdByUserId: userId,
      idempotencyKey,
    });
    const [stored] = await db.execute<{ protocol: number; snapshot: unknown }>(sql`
      select payload_source_protocol_version as protocol, payload_source_snapshot as snapshot
      from issues where id=${original.id}::uuid and company_id=${companyId}::uuid
    `);
    expect(stored).toMatchObject({ protocol: 0, snapshot: null });
    return { title, issueId: original.id };
  }

  async function waitForPrivacyLockWait() {
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      const [waiter] = await db.execute<{ count: number }>(sql`
        select count(*)::int as count from pg_stat_activity
        where datname=current_database() and pid<>pg_backend_pid()
          and wait_event_type='Lock' and query ilike '%pg_advisory_xact_lock%'
      `);
      if ((waiter?.count ?? 0) > 0) return true;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    return false;
  }

  async function assertReplayStayedUnknown(companyId: string, issueId: string, idempotencyKey: string, title: string) {
    const rows = await db.select({ id: issues.id }).from(issues).where(and(
      eq(issues.companyId, companyId), eq(issues.title, title),
    ));
    expect(rows).toEqual([{ id: issueId }]);
    const [owner] = await db.execute<{ protocol: number; snapshot: unknown }>(sql`
      select payload_source_protocol_version as protocol, payload_source_snapshot as snapshot
      from issues where id=${issueId}::uuid and company_id=${companyId}::uuid
    `);
    expect(owner).toMatchObject({ protocol: 0, snapshot: null });
    expect(await db.select({ id: issueCreateIdempotencyKeys.id }).from(issueCreateIdempotencyKeys).where(and(
      eq(issueCreateIdempotencyKeys.companyId, companyId), eq(issueCreateIdempotencyKeys.idempotencyKey, idempotencyKey),
      eq(issueCreateIdempotencyKeys.issueId, issueId),
    ))).toHaveLength(1);
    expect(await db.select({ id: activityLog.id }).from(activityLog).where(and(
      eq(activityLog.companyId, companyId), eq(activityLog.entityId, issueId),
      eq(activityLog.action, "issue.payload_source_captured"),
    ))).toHaveLength(0);
  }

  it("denies an active member's old Task replay when the native session expires during the actual privacy-lock wait", async () => {
    const f = await companyAndUser(true), key = randomUUID();
    const original = await seedUnknownIdempotentTask(f.companyId, f.userId, key);
    const sessionId = await seedNativePasskeySession(db, f.userId);
    const actor = actorFor(f.companyId, f.userId, sessionId, true);
    await db.execute(sql`update "session" set expires_at=clock_timestamp()+interval '1500 milliseconds' where id=${sessionId}`);
    const [liveAtStart] = await db.execute<{ live: boolean }>(sql`
      select expires_at>clock_timestamp() as live from "session" where id=${sessionId}
    `);
    expect(liveAtStart?.live).toBe(true);

    let release!: () => void, locked!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    const lockReady = new Promise<void>(resolve => { locked = resolve; });
    const holder = db.transaction(async tx => {
      await lockIssuePrivacyTree(tx, f.companyId);
      locked();
      await released;
    });
    await lockReady;
    const replay = issueService(db).create(f.companyId, {
      title: original.title, description: "retry payload", createdByUserId: f.userId, idempotencyKey: key,
    }, db, undefined, { manualInputActor: actor });
    let blocked = false;
    try {
      blocked = await waitForPrivacyLockWait();
      if (blocked) await db.execute(sql`select pg_sleep(1.8)`);
    } finally {
      release();
    }
    await holder;
    expect(blocked).toBe(true);
    await expect(replay).rejects.toMatchObject({ status: 403 });
    await assertReplayStayedUnknown(f.companyId, original.issueId, key, original.title);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  it("denies an operator's old Task replay after recent passkey proof ages out during the actual privacy-lock wait", async () => {
    const f = await companyAndUser(false), key = randomUUID();
    await db.insert(instanceUserRoles).values({ userId: f.userId, role: "instance_admin" });
    const original = await seedUnknownIdempotentTask(f.companyId, f.userId, key);
    // This is structural native DB evidence for the domain test, not a WebAuthn ceremony.
    const sessionId = await seedNativePasskeySession(db, f.userId);
    const actor = actorFor(f.companyId, f.userId, sessionId, false);
    await db.execute(sql`update "session" set authenticated_at=clock_timestamp()-interval '295 seconds'
      where id=${sessionId}`);
    const [freshAtStart] = await db.execute<{ ageSeconds: number; live: boolean }>(sql`
      select extract(epoch from clock_timestamp()-authenticated_at)::float8 as "ageSeconds",
        expires_at>clock_timestamp() as live from "session" where id=${sessionId}
    `);
    expect(freshAtStart?.live).toBe(true);
    expect(freshAtStart?.ageSeconds).toBeLessThan(300);

    let release!: () => void, locked!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    const lockReady = new Promise<void>(resolve => { locked = resolve; });
    const holder = db.transaction(async tx => {
      await lockIssuePrivacyTree(tx, f.companyId);
      locked();
      await released;
    });
    await lockReady;
    const replay = issueService(db).create(f.companyId, {
      title: original.title, description: "retry payload", createdByUserId: f.userId, idempotencyKey: key,
    }, db, undefined, { manualInputActor: actor });
    let blocked = false;
    try {
      blocked = await waitForPrivacyLockWait();
      if (blocked) await db.execute(sql`select pg_sleep(5.3)`);
    } finally {
      release();
    }
    await holder;
    expect(blocked).toBe(true);
    await expect(replay).rejects.toMatchObject({ status: 403 });
    await assertReplayStayedUnknown(f.companyId, original.issueId, key, original.title);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
