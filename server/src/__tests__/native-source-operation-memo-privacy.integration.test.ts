import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { agents, companies, companyMemberships, createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, heartbeatRuns, issues } from "@paperclipai/db";
import { canActorReadHeartbeatRunPrivacy } from "../services/authorization.js";
import { openNativeSourceOperationMemo, retireNativeSourceOperationMemo,
  withNativeSourceOperationMemoSuspended } from "../services/native-source-operation-memo.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { seedCurrentHumanSourceActor } from "./helpers/current-human-source-fixture.js";

// MS1f stop 8. Inside one Native source validation operation an identical Run
// privacy decision is evaluated once. Every memoized decision equals the
// uncached decision for the same actor and Run, refusals included; the memo
// never carries one actor's or Run's decision to another; and a same-transaction
// write is seen once the operation's effect boundary retires the memo.
let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("ms1f-operation-memo-privacy-"); }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
afterAll(async () => { await database?.cleanup(); }, 30_000);

it("returns the uncached Run privacy decision for every actor and Run inside an operation", async () => {
  const db = createDb(database.connectionString);
  const companyId = randomUUID(), aliceId = randomUUID(), bobId = randomUUID();
  await db.insert(companies).values({ id: companyId, name: "Operation memo privacy", issuePrefix: randomUUID() });
  const alice = await seedCurrentHumanSourceActor(db, [companyId], aliceId);
  const bob = await seedCurrentHumanSourceActor(db, [companyId], bobId);
  const [agent] = await db.insert(agents).values({ companyId, name: "Memo agent", role: "engineer", adapterType: "process" }).returning();
  const runFor = async (ownerId: string) => {
    const [task] = await db.insert(issues).values({ companyId, title: "Private Task", visibility: "private",
      responsibleUserId: ownerId, createdByUserId: ownerId }).returning();
    const [run] = await db.insert(heartbeatRuns).values({ companyId, agentId: agent!.id, scopeKind: "issue",
      issueId: task!.id, nativeIssueId: task!.id, contextSnapshot: { issueId: task!.id },
      responsibleUserId: ownerId, status: "succeeded" }).returning();
    return run!;
  };
  const aliceRun = await runFor(aliceId), bobRun = await runFor(bobId);
  const runs = [{ companyId, id: aliceRun.id }, { companyId, id: bobRun.id }, { companyId, id: randomUUID() }];
  const expected = new Map([[`${aliceId}:${aliceRun.id}`, true], [`${aliceId}:${bobRun.id}`, false],
    [`${bobId}:${aliceRun.id}`, false], [`${bobId}:${bobRun.id}`, true]]);
  const rollback = new Error("rollback");
  await expect(db.transaction(async tx => {
    const uncached = new Map<string, boolean>();
    for (const [userId, actor] of [[aliceId, alice], [bobId, bob]] as const)
      for (const run of runs) uncached.set(`${userId}:${run.id}`, await canActorReadHeartbeatRunPrivacy(tx, actor, run));
    for (const [key, value] of uncached) expect(value, key).toBe(expected.get(key) ?? false);
    const close = openNativeSourceOperationMemo(tx);
    try {
      // Alternate actors and Runs so a decision keyed without either would leak.
      for (let round = 0; round < 3; round += 1)
        for (const [userId, actor] of [[aliceId, alice], [bobId, bob]] as const)
          for (const run of runs) expect(await canActorReadHeartbeatRunPrivacy(tx, actor, run), `${userId}:${run.id}`)
            .toBe(uncached.get(`${userId}:${run.id}`));
      // A same-transaction write: the memoized decision stands until the
      // effect boundary retires it, and the final reader pass reads afresh.
      await tx.update(companyMemberships).set({ status: "suspended" }).where(and(eq(companyMemberships.companyId, companyId),
        eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, aliceId)));
      expect(await canActorReadHeartbeatRunPrivacy(tx, alice, runs[0]!)).toBe(true);
      expect(await withNativeSourceOperationMemoSuspended(tx, () => canActorReadHeartbeatRunPrivacy(tx, alice, runs[0]!))).toBe(false);
      retireNativeSourceOperationMemo(tx);
      expect(await canActorReadHeartbeatRunPrivacy(tx, alice, runs[0]!)).toBe(false);
      expect(await canActorReadHeartbeatRunPrivacy(tx, bob, runs[1]!)).toBe(true);
    } finally { close(); }
    throw rollback;
  })).rejects.toBe(rollback);
  // Outside an operation every call reads the current decision.
  expect(await canActorReadHeartbeatRunPrivacy(db, alice, runs[0]!)).toBe(true);
  expect(await canActorReadHeartbeatRunPrivacy(db, bob, runs[0]!)).toBe(false);
});
