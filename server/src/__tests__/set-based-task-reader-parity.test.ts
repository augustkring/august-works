import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, authUsers, companies, companyMemberships, contextManifests, createDb, heartbeatRuns, issueAccessGrants,
  issuePrivacySources, issues, projects } from "@paperclipai/db";
import { issueReadSqlCondition, setBasedIssueReadDecisions, type AuthorizationActor } from "../services/authorization.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

/*
 * PERF2d. The batched Task privacy check of a native population evaluates
 * the canonical Task reader predicate set-based (each graph node once) instead
 * of once per root. It must give exactly the per-root decisions. This compares
 * both over a mixed population, for a Human and an Agent actor: open,
 * private (owner, grant, none), inherited through a private parent, a privacy
 * cycle, a 300-Task parent chain across the 256-node bound, open, private and
 * unqualified Projects, a retired conversation Task, a missing and a malformed
 * origin, a 300-source fan-out, 256 and 257 Context-owned edges to one Task,
 * a valid and a corrupt temporal snapshot, another company's
 * Task and an unknown id. A second case forces the bound fallback.
 */
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("set-based Task reader parity (PERF2d)", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-set-based-task-reader-");
    db = createDb(database.connectionString);
  }, 30_000);
  afterAll(async () => { await database?.cleanup(); }, 60_000);

  async function seed() {
    const now = new Date();
    const company = randomUUID(), foreign = randomUUID();
    for (const id of [company, foreign])
      await db.insert(companies).values({ id, name: `Parity ${id.slice(0, 6)}`, issuePrefix: `P${id.slice(0, 7)}` });
    const owner = `parity-owner-${randomUUID()}`, reader = `parity-reader-${randomUUID()}`;
    for (const userId of [owner, reader]) {
      await db.insert(authUsers).values({ id: userId, name: userId, email: `${userId}@example.test`, createdAt: now, updatedAt: now });
      await db.insert(companyMemberships).values({ companyId: company, principalType: "user", principalId: userId,
        membershipRole: "owner", status: "active" });
    }
    const [agent] = await db.insert(agents).values({ companyId: company, name: "Worker", role: "engineer",
      adapterType: "codex_local" }).returning();
    const task = async (values: Partial<typeof issues.$inferInsert> = {}) => (await db.insert(issues).values({
      companyId: company, title: `Task ${randomUUID().slice(0, 8)}`, status: "todo", ...values }).returning())[0]!;
    const project = async (values: Partial<typeof projects.$inferInsert> = {}) => (await db.insert(projects).values({
      companyId: company, name: `Project ${randomUUID().slice(0, 8)}`, sourceProvenanceQualified: true, ...values }).returning())[0]!;

    const roots: Record<string, string> = {};
    roots.open = (await task()).id;
    const privateOwned = await task({ visibility: "private", responsibleUserId: owner });
    roots.privateOwned = privateOwned.id;
    roots.privateAssigned = (await task({ visibility: "private", assigneeAgentId: agent!.id, responsibleUserId: owner })).id;
    const granted = await task({ visibility: "private" });
    await db.insert(issueAccessGrants).values({ companyId: company, issueId: granted.id, subjectType: "user", subjectId: reader,
      source: "explicit" });
    roots.privateGranted = granted.id;
    roots.privateNone = (await task({ visibility: "private" })).id;
    roots.childOfPrivate = (await task({ privacyParentIssueId: privateOwned.id })).id;
    const cycleA = await task(), cycleB = await task({ privacyParentIssueId: cycleA.id });
    await db.update(issues).set({ privacyParentIssueId: cycleB.id }).where(eq(issues.id, cycleA.id));
    roots.cycleA = cycleA.id; roots.cycleB = cycleB.id;
    // A 300-Task parent chain: chain k reaches k+1 nodes.
    const chain: string[] = [];
    for (let k = 0; k < 300; k += 1) chain.push((await task({ privacyParentIssueId: chain[k - 1] ?? null })).id);
    for (const k of [0, 254, 255, 256, 299]) roots[`chain${k}`] = chain[k]!;
    const openProject = await project();
    for (let k = 0; k < 20; k += 1) roots[`inOpenProject${k}`] = (await task({ projectId: openProject.id })).id;
    const privateProject = await project({ visibility: "private" });
    roots.inPrivateProject = (await task({ projectId: privateProject.id })).id;
    const unqualified = await project({ sourceProvenanceQualified: false });
    roots.inUnqualifiedProject = (await task({ projectId: unqualified.id })).id;
    const sourcedProject = await project({ sourceIssueIds: [roots.open!, roots.privateNone!] });
    roots.inSourcedProject = (await task({ projectId: sourcedProject.id })).id;
    roots.retired = (await task({ status: "cancelled", hiddenAt: now, conversationRetiredAt: now })).id;
    roots.missingOriginRun = (await task({ originRunId: randomUUID() })).id;
    roots.malformedWorkflowOrigin = (await task({ originKind: "workflow_task" })).id;
    const fanOut = await task();
    await db.insert(issuePrivacySources).values(chain.slice(0, 300).map(sourceId => ({ companyId: company, issueId: fanOut.id,
      sourceKind: "issue" as const, sourceId })));
    roots.fanOut = fanOut.id;
    const smallFan = await task();
    await db.insert(issuePrivacySources).values([roots.open!, roots.inOpenProject0!].map(sourceId => ({ companyId: company,
      issueId: smallFan.id, sourceKind: "issue" as const, sourceId })));
    roots.smallFan = smallFan.id;
    // Context-owned edges to one open Task: 256 and 257 enumerated edges, two
    // nodes each, so only the per-node edge bound differs.
    const manifests = await db.insert(contextManifests).values(Array.from({ length: 257 }, () => ({ companyId: company,
      agentId: agent!.id, queryHash: "a".repeat(64), policySnapshotHash: "b".repeat(64) }))).returning({ id: contextManifests.id });
    for (const [name, count] of [["edges256", 256], ["edges257", 257]] as const) {
      const root = await task();
      await db.insert(issuePrivacySources).values(manifests.slice(0, count).map(manifest => ({ companyId: company,
        issueId: root.id, sourceKind: "issue" as const, sourceId: roots.open!, contextManifestId: manifest.id })));
      roots[name] = root.id;
    }
    // A valid temporal snapshot (structural fixture: canonical owner hash and
    // digest, no inputs): such a root goes to the per-root predicate.
    roots.validSnapshot = await db.transaction(async tx => {
      const [row] = await tx.insert(issues).values({ companyId: company, title: "Snapshot Task", payloadSourceProtocolVersion: 1 }).returning();
      await tx.execute(sql`with content as (
        select jsonb_build_object('version',1,'owner',jsonb_build_object('kind','issue','companyId',company_id,'id',id,
          'contentHash',public.aw_native_payload_body_hash('issue',to_jsonb(i))),
          'policy',jsonb_build_object('issueIds','[]'::jsonb,'projectIds','[]'::jsonb,'runIds','[]'::jsonb,
            'memoryIds','[]'::jsonb,'foundationRevisionIds','[]'::jsonb),'inputs','[]'::jsonb) as value from issues i where id=${row!.id}::uuid)
        update issues set payload_source_snapshot=value || jsonb_build_object('digest',encode(sha256(convert_to(value::text,'UTF8')),'hex'))
        from content where id=${row!.id}::uuid`);
      return row!.id;
    });
    // Protocol 1 without a snapshot: the predicate treats it as corrupt.
    roots.corruptSnapshot = (await task({ payloadSourceProtocolVersion: 1 })).id;
    const [foreignTask] = await db.insert(issues).values({ companyId: foreign, title: "Foreign" }).returning();
    roots.foreign = foreignTask!.id;
    roots.unknown = randomUUID();
    const [run] = await db.insert(heartbeatRuns).values({ companyId: company, agentId: agent!.id, responsibleUserId: owner,
      status: "running", startedAt: now }).returning();
    const actors: Record<string, AuthorizationActor> = {
      owner: { type: "board", source: "session", userId: owner },
      reader: { type: "board", source: "session", userId: reader },
      worker: { type: "agent", source: "agent_jwt", companyId: company, agentId: agent!.id, runId: run!.id, onBehalfOfUserId: owner },
    };
    return { company, roots, actors };
  }

  async function perRoot(companyId: string, actor: AuthorizationActor, ids: string[]) {
    const condition = await issueReadSqlCondition(db, actor);
    const rows = await db.execute<{ id: string; allowed: boolean }>(sql`
      select selected.id::text as id, (${condition}) as allowed
      from (values ${sql.join(ids.map(id => sql`(${id}::uuid)`), sql`, `)}) as selected(id)
      join issues on issues.id=selected.id and issues.company_id=${companyId}`);
    return new Map(rows.map(row => [row.id, row.allowed === true]));
  }

  const named = (roots: Record<string, string>, decisions: Map<string, boolean>) =>
    Object.fromEntries(Object.entries(roots).map(([name, id]) => [name, decisions.has(id) ? decisions.get(id) : "absent"]));

  it("gives the per-root decision for every root and actor", async () => {
    const f = await seed();
    const ids = Object.values(f.roots);
    for (const [name, actor] of Object.entries(f.actors)) {
      const expected = named(f.roots, await perRoot(f.company, actor, ids));
      const actual = named(f.roots, await setBasedIssueReadDecisions(db, actor, f.company, ids,
        await issueReadSqlCondition(db, actor)));
      expect(actual, name).toEqual(expected);
    }
    // The population exercises both outcomes and every bound.
    const owner = named(f.roots, await perRoot(f.company, f.actors.owner!, ids));
    expect(owner).toMatchObject({ open: true, privateOwned: true, privateNone: false, childOfPrivate: true, cycleA: false,
      chain0: true, chain255: true, chain256: false, chain299: false, inOpenProject0: true, inPrivateProject: false,
      inUnqualifiedProject: false, inSourcedProject: false, retired: false, missingOriginRun: false,
      malformedWorkflowOrigin: false, fanOut: false, smallFan: true, corruptSnapshot: false, validSnapshot: true, edges256: true, edges257: false, foreign: "absent", unknown: "absent" });
    const reader = named(f.roots, await perRoot(f.company, f.actors.reader!, ids));
    expect(reader).toMatchObject({ open: true, privateOwned: false, privateGranted: true, childOfPrivate: false });
  }, 60_000);

  it("falls back to the per-root predicate when the population exceeds its bounds", async () => {
    const f = await seed();
    const ids = Object.values(f.roots);
    for (const actor of Object.values(f.actors)) {
      const expected = named(f.roots, await perRoot(f.company, actor, ids));
      const condition = await issueReadSqlCondition(db, actor);
      expect(named(f.roots, await setBasedIssueReadDecisions(db, actor, f.company, ids, condition, undefined,
        { nodesPerRoot: 1 }))).toEqual(expected);
      expect(named(f.roots, await setBasedIssueReadDecisions(db, actor, f.company, ids, condition, undefined,
        { closureRows: 1 }))).toEqual(expected);
    }
  }, 60_000);
});
