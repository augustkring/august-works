import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agents, authUsers, companyMemberships, companies, createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  heartbeatRuns, issues, issueAccessGrants, issueComments,
} from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { canActorReadIssuePrivacy, type AuthorizationActor } from "../authorization.js";
import { issueService } from "../issues.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { PaperclipRunnerToolAuthority } from "./paperclip-runner-tool-authority.js";

describe("native task tools respect canonical task privacy", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("native-tool-task-privacy-");
    db = createDb(database.connectionString);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  afterAll(async () => { await database?.cleanup(); }, 30_000);

  async function fixture() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const runId = randomUUID();
    const aliceId = randomUUID();
    const bobId = randomUUID();
    const parentId = randomUUID();
    const issuePrefix = `NTP${companyId.slice(0, 5).toUpperCase()}`;
    const now = new Date();
    await db.insert(companies).values({ id: companyId, name: "Native task privacy", issuePrefix });
    await db.insert(authUsers).values([
      { id: aliceId, name: "Alice", email: `${aliceId}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now },
      { id: bobId, name: "Bob", email: `${bobId}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now },
    ]);
    await db.insert(companyMemberships).values([aliceId, bobId].map(principalId => ({
      companyId, principalType: "user" as const, principalId, membershipRole: "member", status: "active",
    })));
    await db.insert(agents).values({ id: agentId, companyId, name: "Native privacy agent", adapterType: "paperclip_runner", status: "active" });
    await db.insert(issues).values({ id: parentId, companyId, issueNumber: 1, identifier: `${issuePrefix}-1`,
      title: "Open assigned parent", status: "in_progress", assigneeAgentId: agentId });
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, responsibleUserId: bobId,
      status: "running", runtimeMode: "native", nativeIssueId: parentId, invocationSource: "assignment", triggerDetail: "system" });
    await db.update(issues).set({ executionRunId: runId }).where(eq(issues.id, parentId));
    const authority = new PaperclipRunnerToolAuthority(db, { companyId, agentId, issueId: parentId, runId });
    const actor: AuthorizationActor = { type: "agent", source: "agent_jwt", companyId, agentId, runId, onBehalfOfUserId: bobId };

    async function child(title: string, description: string, visibility: "open" | "private" = "open", createdAt?: Date) {
      const id = randomUUID();
      const [row] = await db.insert(issues).values({ id, companyId, parentId, title, description, visibility,
        ...(visibility === "private" ? { privacyRootIssueId: id, privacyParentIssueId: parentId,
          responsibleUserId: aliceId, createdByUserId: aliceId } : {}),
        ...(createdAt ? { createdAt, updatedAt: createdAt } : {}),
      }).returning();
      return row!;
    }

    const openChild = await child(`shared-needle OPEN_CHILD_${randomUUID()}`, "open child description");
    const privateChild = await issueService(db).create(companyId, {
      title: `shared-needle PRIVATE_CHILD_${randomUUID()}`, description: "PRIVATE_BODY_CANARY", parentId,
      visibility: "private", createdByUserId: aliceId, responsibleUserId: aliceId,
      actorResponsibleUserId: aliceId, trustExplicitResponsibleUserId: true,
    });
    return { companyId, agentId, runId, aliceId, bobId, parentId, authority, actor, openChild, privateChild, child };
  }

  it("filters private children before get_task_context truncation", async () => {
    const f = await fixture();
    const baseTime = new Date(Date.now() - 120_000);
    const olderOpen = await f.child(`older-open-${randomUUID()}`, "visible after private filtering", "open", baseTime);
    const privateRows = Array.from({ length: 102 }, (_, index) => {
      const id = randomUUID();
      return { id, companyId: f.companyId, parentId: f.parentId,
        title: `new-private-${index}-${randomUUID()}`, description: "PRIVATE_PRELIMIT_CANARY", visibility: "private",
        privacyRootIssueId: id, privacyParentIssueId: f.parentId, responsibleUserId: f.aliceId, createdByUserId: f.aliceId,
        createdAt: new Date(baseTime.getTime() + 60_000), updatedAt: new Date(baseTime.getTime() + 60_000) };
    });
    await db.insert(issues).values(privateRows);

    expect(await canActorReadIssuePrivacy(db, f.actor, f.privateChild)).toBe(false);
    expect(await canActorReadIssuePrivacy(db, { type: "board", source: "session", userId: f.aliceId }, f.privateChild)).toBe(true);
    expect(await canActorReadIssuePrivacy(db, f.actor, olderOpen)).toBe(true);
    expect(await canActorReadIssuePrivacy(db, f.actor, f.openChild)).toBe(true);

    const result = await f.authority.execute({ tool: "get_task_context", callId: randomUUID(), arguments: {} }) as {
      childTasks: Array<{ id: string; title: string; description: string | null }>; childTasksTruncated: boolean;
    };
    expect(result.childTasks.some(task => task.id === f.openChild.id)).toBe(true);
    expect(result.childTasks.some(task => task.id === olderOpen.id)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_CHILD_");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_PRELIMIT_CANARY");
    expect(result.childTasksTruncated).toBe(false);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  it("keeps the bound current Task ACL for foreign private owners and revoked Humans", async () => {
    const f = await fixture();
    const bindPrivateOwner = async (userId: string) => db.update(issues).set({
      visibility: "private", privacyRootIssueId: f.parentId, privacyParentIssueId: null,
      responsibleUserId: userId, createdByUserId: userId,
    }).where(and(eq(issues.companyId, f.companyId), eq(issues.id, f.parentId)));
    const context = () => f.authority.execute({ tool: "get_task_context", callId: randomUUID(), arguments: {} });

    await bindPrivateOwner(f.aliceId);
    expect(await canActorReadIssuePrivacy(db, f.actor, { companyId: f.companyId, id: f.parentId })).toBe(false);
    await expect(context()).rejects.toThrow();

    await bindPrivateOwner(f.bobId);
    expect(await canActorReadIssuePrivacy(db, f.actor, { companyId: f.companyId, id: f.parentId })).toBe(true);
    await context();
    await db.update(companyMemberships).set({ status: "inactive" }).where(and(
      eq(companyMemberships.companyId, f.companyId), eq(companyMemberships.principalType, "user"),
      eq(companyMemberships.principalId, f.bobId),
    ));
    expect(await canActorReadIssuePrivacy(db, f.actor, { companyId: f.companyId, id: f.parentId })).toBe(false);
    await expect(context()).rejects.toThrow();
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  it("searches only task rows Bob can canonically read", async () => {
    const f = await fixture();
    expect(await canActorReadIssuePrivacy(db, f.actor, f.privateChild)).toBe(false);
    expect(await canActorReadIssuePrivacy(db, { type: "board", source: "session", userId: f.aliceId }, f.privateChild)).toBe(true);
    expect(await canActorReadIssuePrivacy(db, f.actor, f.openChild)).toBe(true);

    const query = "shared-needle";
    const result = await f.authority.execute({ tool: "search_tasks", callId: randomUUID(), arguments: { query } }) as {
      tasks: Array<{ id: string; title: string; description: string | null }>;
    };
    expect(result.tasks.some(task => task.id === f.openChild.id)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_CHILD_");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_BODY_CANARY");
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  it("keeps the mutation writer fence and rejects reassignment after its wait", async () => {
    const f = await fixture();
    let releaseRead!: () => void, announceRead!: (pid: number) => void;
    const release = new Promise<void>(resolve => { releaseRead = resolve; });
    const locked = new Promise<number>(resolve => { announceRead = resolve; });
    const heldRead = db.transaction(async tx => {
      await lockAnalyticalCompany(tx, f.companyId, "read");
      await lockMemoryPrivacy(tx as unknown as typeof db, f.companyId, "read");
      const [backend] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      announceRead(backend!.pid); await release;
    });
    const readerPid = await locked;
    const body = `Blocked mutation ${randomUUID()}`;
    const effect = f.authority.execute({ tool: "report_progress", callId: randomUUID(),
      arguments: { body, idempotencyKey: randomUUID() } }).then(() => null, error => error);
    try {
      let observedWriterWait = false;
      for (let attempt = 0; attempt < 150 && !observedWriterWait; attempt++) {
        const [row] = await db.execute<{ waiting: boolean }>(sql`select exists(select 1 from pg_stat_activity a
          where ${readerPid}=any(pg_blocking_pids(a.pid)) and a.wait_event_type='Lock') as waiting`);
        observedWriterWait = row?.waiting === true;
        if (!observedWriterWait) await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(observedWriterWait, "a Native effect must retain its exclusive privacy writer fence").toBe(true);
      await db.update(issues).set({ assigneeAgentId: null }).where(and(eq(issues.companyId, f.companyId), eq(issues.id, f.parentId)));
    } finally { releaseRead(); await heldRead; }
    const rejected = await effect;
    expect(rejected).toBeInstanceOf(Error);
    expect((await db.select().from(issueComments).where(and(eq(issueComments.companyId, f.companyId),
      eq(issueComments.issueId, f.parentId), eq(issueComments.body, body))))).toHaveLength(0);
  });

  it("uses current explicit sharing on both tools after revocation", async () => {
    const f = await fixture();
    const [grant] = await db.insert(issueAccessGrants).values({ companyId: f.companyId, issueId: f.privateChild.id,
      subjectType: "user", subjectId: f.bobId, source: "explicit", grantedByUserId: f.aliceId }).returning();
    const read = async () => {
      const context = await f.authority.execute({ tool: "get_task_context", callId: randomUUID(), arguments: {} }) as { childTasks: Array<{ id: string }> };
      const search = await f.authority.execute({ tool: "search_tasks", callId: randomUUID(), arguments: { query: "shared-needle" } }) as { tasks: Array<{ id: string }> };
      return [context.childTasks, search.tasks];
    };
    expect(await canActorReadIssuePrivacy(db, f.actor, f.privateChild)).toBe(true);
    for (const tasks of await read()) expect(tasks.some(task => task.id === f.privateChild.id)).toBe(true);
    await db.update(issueAccessGrants).set({ revokedAt: new Date() }).where(eq(issueAccessGrants.id, grant!.id));
    expect(await canActorReadIssuePrivacy(db, f.actor, f.privateChild)).toBe(false);
    for (const tasks of await read()) {
      expect(tasks.some(task => task.id === f.privateChild.id)).toBe(false);
      expect(tasks.some(task => task.id === f.openChild.id)).toBe(true);
    }
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

});
