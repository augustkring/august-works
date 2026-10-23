import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, authUsers, companies, companyMemberships, contextManifests, contextManifestMemoryRoots,
  createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, heartbeatRuns, issues, memoryBindings, memoryRecords,
  memoryObservations, memoryObservationEvidence, memoryModels, memoryModelVersions, memoryModelEvidence, type Db } from "@paperclipai/db";
import { assertAnalyticalContextPayloadAccess } from "../services/analytical-context-authority.js";
import { modelLineage } from "../services/memory/derived-memory.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

describe("Source deletion preserves Context and model restrictions", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("v10-context-source-tombstones-");
    db = createDb(database.connectionString, { maxConnections: 3 });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await database?.cleanup(); }, 30000);

  // Direct native rows qualify persisted lineage/erasure, not producer capture
  // or historical completeness. Current private ACL has positive/negative proof.
  async function fixture() {
    const companyId = randomUUID(), ownerId = randomUUID(), readerId = randomUUID(), privateIssueId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Retained source identities", issuePrefix: randomUUID() });
    await db.insert(authUsers).values([ownerId, readerId].map(id => ({ id, name: "Current Human", email: `${id}@example.test`, createdAt: new Date(), updatedAt: new Date() })));
    await db.insert(companyMemberships).values([ownerId, readerId].map(principalId => ({ companyId, principalType: "user", principalId, status: "active", membershipRole: "admin" })));
    await db.insert(issues).values({ id: privateIssueId, companyId, title: "Private source", visibility: "private", createdByUserId: ownerId, responsibleUserId: ownerId });
    const [binding] = await db.insert(memoryBindings).values({ companyId, key: randomUUID(), name: "Source binding", providerKey: "local" }).returning();
    const roots = await db.insert(memoryRecords).values([true, false].map(privateSource => ({ companyId, bindingId: binding!.id, providerKey: "local", memoryType: "outcome", scopeType: "company",
      content: privateSource ? "Private payload" : "Independent public payload", observedAt: new Date(), createdByActorType: "user", createdByActorId: ownerId,
      reviewState: "accepted", verificationState: "human_verified", sourceProvenanceQualified: true, sourceIssueIds: privateSource ? [privateIssueId] : [] }))).returning();
    return { companyId, ownerId, roots, owner: { type: "board" as const, source: "session" as const, userId: ownerId }, reader: { type: "board" as const, source: "session" as const, userId: readerId } };
  }

  it("denies retained conversation payload when one of its two Memory roots is physically deleted", async () => {
    const f = await fixture(), agentId = randomUUID(), taskId = randomUUID(), runId = randomUUID();
    await db.insert(agents).values({ id: agentId, companyId: f.companyId, name: "Native source", role: "engineer", status: "idle", adapterType: "paperclip_runner" });
    await db.insert(issues).values({ id: taskId, companyId: f.companyId, title: "Conversation payload", visibility: "open", responsibleUserId: f.ownerId, createdByUserId: f.ownerId });
    await db.insert(heartbeatRuns).values({ id: runId, companyId: f.companyId, agentId, responsibleUserId: f.ownerId, nativeIssueId: taskId, issueId: taskId,
      contextSnapshot: { issueId: taskId }, runtimeMode: "native", status: "running" });
    const [context] = await db.insert(contextManifests).values({ companyId: f.companyId, agentId, runId, issueId: taskId, queryHash: "a".repeat(64), policySnapshotHash: "b".repeat(64) }).returning();
    await db.insert(contextManifestMemoryRoots).values(f.roots.map(root => ({ companyId: f.companyId, manifestId: context!.id, memoryRecordId: root.id, sourceVersion: root.updatedAt.toISOString() })));
    await assertAnalyticalContextPayloadAccess(db, f.companyId, f.owner, { runId });
    await expect(assertAnalyticalContextPayloadAccess(db, f.companyId, f.reader, { runId })).rejects.toMatchObject({ status: 403 });
    await db.delete(memoryRecords).where(eq(memoryRecords.id, f.roots[0]!.id));
    const retained = await db.select().from(contextManifestMemoryRoots).where(and(eq(contextManifestMemoryRoots.companyId, f.companyId), eq(contextManifestMemoryRoots.manifestId, context!.id)));
    expect.soft(retained.map(root => root.memoryRecordId).sort()).toEqual(f.roots.map(root => root.id).sort());
    await expect.soft(assertAnalyticalContextPayloadAccess(db, f.companyId, f.reader, { runId })).rejects.toMatchObject({ status: 403 });
    await expect.soft(assertAnalyticalContextPayloadAccess(db, f.companyId, f.owner, { runId })).rejects.toMatchObject({ status: 403 });
  });

  it("denies model payload when deleting an observation would remove only its private evidence", async () => {
    const f = await fixture();
    const [observation] = await db.insert(memoryObservations).values({ companyId: f.companyId, observationKey: randomUUID(), scopeType: "company", purpose: "native_task_execution",
      content: "Private observation payload", status: "accepted", confidence: 0.8, sensitivity: "internal", supportCount: 1, contradictionCount: 0, independentSourceCount: 1 }).returning();
    await db.insert(memoryObservationEvidence).values({ companyId: f.companyId, observationId: observation!.id, memoryRecordId: f.roots[0]!.id, sourceVersion: f.roots[0]!.updatedAt.toISOString(), relationship: "supports", rootFingerprint: f.roots[0]!.id });
    const [model] = await db.insert(memoryModels).values({ companyId: f.companyId, modelKey: randomUUID(), name: "Derived model", scopeType: "company", purpose: "native_task_execution", sourceQuery: "Two native roots",
      content: "Private derived payload", status: "active", confidence: 0.8, sensitivity: "internal", sourceWatermark: "fixture" }).returning();
    await db.insert(memoryModelVersions).values({ companyId: f.companyId, modelId: model!.id, version: 1, content: model!.content, sourceWatermark: model!.sourceWatermark });
    await db.insert(memoryModelEvidence).values(f.roots.map((root, index) => ({ companyId: f.companyId, modelId: model!.id, modelVersion: 1, memoryRecordId: root.id,
      sourceVersion: root.updatedAt.toISOString(), relationship: "derived_from", observationId: index === 0 ? observation!.id : null, observationVersion: index === 0 ? observation!.version : null })));
    await modelLineage(db, f.owner, model!);
    await expect(modelLineage(db, f.reader, model!)).rejects.toMatchObject({ status: 403 });
    await db.delete(memoryObservations).where(eq(memoryObservations.id, observation!.id));
    const retained = await db.select().from(memoryModelEvidence).where(and(eq(memoryModelEvidence.companyId, f.companyId), eq(memoryModelEvidence.modelId, model!.id)));
    expect.soft(retained.map(root => root.memoryRecordId).sort()).toEqual(f.roots.map(root => root.id).sort());
    await expect.soft(modelLineage(db, f.reader, model!)).rejects.toMatchObject({ status: 403 });
    await expect.soft(modelLineage(db, f.owner, model!)).rejects.toMatchObject({ status: 409 });
  });

  async function referenceFixture(kind: "context" | "observation") {
    const f = await fixture();
    if (kind === "context") {
      const [context] = await db.insert(contextManifests).values({ companyId: f.companyId, agentId: randomUUID(), queryHash: "c".repeat(64), policySnapshotHash: "d".repeat(64) }).returning();
      return { companyId: f.companyId, sourceId: f.roots[0]!.id,
        insert: (tx: Db, id: string) => tx.insert(contextManifestMemoryRoots).values({ companyId: f.companyId, manifestId: context!.id, memoryRecordId: id, sourceVersion: f.roots[0]!.updatedAt.toISOString() }),
        remove: (tx: Db) => tx.delete(memoryRecords).where(eq(memoryRecords.id, f.roots[0]!.id)),
        read: () => db.select({ id: contextManifestMemoryRoots.memoryRecordId }).from(contextManifestMemoryRoots).where(eq(contextManifestMemoryRoots.manifestId, context!.id)) };
    }
    const [source] = await db.insert(memoryObservations).values({ companyId: f.companyId, observationKey: randomUUID(), scopeType: "company", purpose: "native_task_execution",
      content: "Reference existence fixture", confidence: 0.5, sensitivity: "internal", supportCount: 0, contradictionCount: 0, independentSourceCount: 0 }).returning();
    const [model] = await db.insert(memoryModels).values({ companyId: f.companyId, modelKey: randomUUID(), name: "Reference fixture", scopeType: "company", purpose: "native_task_execution",
      sourceQuery: "Reference integrity", content: "Reference integrity", confidence: 0.5, sensitivity: "internal", sourceWatermark: "fixture" }).returning();
    await db.insert(memoryModelVersions).values({ companyId: f.companyId, modelId: model!.id, version: 1, content: model!.content, sourceWatermark: model!.sourceWatermark });
    return { companyId: f.companyId, sourceId: source!.id,
      insert: (tx: Db, id: string) => tx.insert(memoryModelEvidence).values({ companyId: f.companyId, modelId: model!.id, modelVersion: 1, memoryRecordId: f.roots[0]!.id,
        sourceVersion: f.roots[0]!.updatedAt.toISOString(), observationId: id, observationVersion: 1, relationship: "derived_from" }),
      remove: (tx: Db) => tx.delete(memoryObservations).where(eq(memoryObservations.id, source!.id)),
      read: () => db.select({ id: memoryModelEvidence.observationId }).from(memoryModelEvidence).where(eq(memoryModelEvidence.modelId, model!.id)) };
  }
  function errorCode(error: unknown): unknown {
    for (let depth = 0; depth < 4 && error && typeof error === "object"; depth++) {
      const value = error as { code?: unknown; cause?: unknown };
      if (value.code) return value.code;
      error = value.cause;
    }
  }
  async function blockedBy(pid: number) {
    const deadline = performance.now() + 5000;
    while (performance.now() < deadline) {
      const [row] = await db.execute<{ count: number }>(sql`select count(*)::int as count from pg_stat_activity where ${pid}=any(pg_blocking_pids(pid)) and wait_event_type='Lock'`);
      if (row?.count) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error("Source reference did not reach its actual PostgreSQL blocker");
  }
  const kinds = ["context", "observation"] as const;
  it.each(kinds)("retains native company/existence integrity for %s sources", async kind => {
    const local = await referenceFixture(kind), foreign = await referenceFixture(kind);
    for (const id of [randomUUID(), foreign.sourceId]) {
      expect(errorCode(await local.insert(db, id).then(() => null, error => error))).toBe("23503");
    }
    await local.insert(db, local.sourceId);
    expect(await local.read()).toEqual([{ id: local.sourceId }]);
  });
  it.each(kinds)("rejects %s insertion after a concurrent source deletion commits", async kind => {
    const f = await referenceFixture(kind);
    let pending!: Promise<unknown>;
    await db.transaction(async holder => {
      const [identity] = await holder.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      await f.remove(holder);
      pending = f.insert(db, f.sourceId).then(() => null, error => error);
      await blockedBy(identity!.pid);
    });
    expect(errorCode(await pending)).toBe("23503");
    expect(await f.read()).toEqual([]);
  });
  it.each(kinds)("retains the %s source UUID when insertion commits before concurrent deletion", async kind => {
    const f = await referenceFixture(kind);
    let pending!: Promise<unknown>;
    await db.transaction(async holder => {
      const [identity] = await holder.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      await f.insert(holder, f.sourceId);
      pending = f.remove(db).then(() => null, error => error);
      await blockedBy(identity!.pid);
    });
    expect(await pending).toBeNull();
    expect(await f.read()).toEqual([{ id: f.sourceId }]);
    // This fixture also owns an unrelated Task. Its original company FK
    // correctly blocks deletion until that prerequisite is removed.
    await db.delete(issues).where(eq(issues.companyId, f.companyId));
    await db.delete(companyMemberships).where(eq(companyMemberships.companyId, f.companyId));
    await db.delete(companies).where(eq(companies.id, f.companyId));
    expect(await f.read()).toEqual([]);
  });
});
