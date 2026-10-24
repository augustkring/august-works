import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agents, authUsers, companyMemberships, companies, createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  heartbeatRuns, issues, issueAccessGrants,
} from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { canActorReadIssuePrivacy, type AuthorizationActor } from "../authorization.js";
import { issueService } from "../issues.js";
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
