import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  authUsers, companies, companyMemberships, createDb, documents, documentRevisions,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, issues, learningCycles, learningDomainCandidates,
  learningEvaluations, learningEvidence, learningHypotheses, learningRetainedAssets,
  memoryBindings, memoryRecords, principalPermissionGrants,
} from "@paperclipai/db";
import { authorizationService, type AuthorizationActor } from "../services/authorization.js";
import {
  assertLearningAnalyticalSources, assertLearnedAssetAnalyticalSources,
  assertLearningCandidateAnalyticalSources,
} from "../services/learning/learning-analytical-sources.js";
import { canActorReadMemorySources } from "../services/memory/memory-privacy.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

describe("Learning retains ordinary private Memory authority without analytical signals", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let companyId: string, ownerId: string, otherId: string, issueId: string, bindingId: string;
  const human = (userId: string): AuthorizationActor => ({ type: "board", source: "session", userId });
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("v10-learning-private-sources-");
    db = createDb(database.connectionString, { maxConnections: 3 });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await database?.cleanup(); }, 30000);
  beforeEach(async () => {
    companyId = randomUUID(); ownerId = randomUUID(); otherId = randomUUID(); issueId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Learning source fixture", issuePrefix: randomUUID() });
    await db.insert(authUsers).values([ownerId, otherId].map(id => ({
      id, name: "Learning reader", email: `${id}@example.test`, emailVerified: true,
      createdAt: new Date(), updatedAt: new Date(),
    })));
    await db.insert(companyMemberships).values([ownerId, otherId].map(principalId => ({
      companyId, principalType: "user", principalId, status: "active", membershipRole: "admin",
    })));
    await db.insert(principalPermissionGrants).values([ownerId, otherId].map(principalId => ({
      companyId, principalType: "user", principalId, permissionKey: "foundation:read",
    })));
    await db.insert(issues).values({ id: issueId, companyId, title: "PRIVATE source outcome",
      visibility: "private", responsibleUserId: ownerId, createdByUserId: ownerId });
    const [binding] = await db.insert(memoryBindings).values({ companyId, key: "learning", name: "Learning", providerKey: "local" }).returning();
    bindingId = binding!.id;
  });
  async function memory(input: Partial<typeof memoryRecords.$inferInsert> = {}) {
    const [row] = await db.insert(memoryRecords).values({
      companyId, bindingId, providerKey: "local", memoryType: "outcome", scopeType: "company",
      content: "PRIVATE learned outcome", observedAt: new Date(), createdByActorType: "user", createdByActorId: ownerId,
      sourceProvenanceQualified: true, sourceIssueIds: [issueId], ...input,
    }).returning();
    return row!;
  }
  async function cycle(rootIds: string[]) {
    const [row] = await db.insert(learningCycles).values({ companyId, scopeType: "company", purpose: "native_task_execution",
      trigger: "Verified outcomes", maxHypotheses: 2, maxEvaluations: 2, outcomeVersions: {}, createdBy: ownerId }).returning();
    for (const id of rootIds) {
      const [root] = await db.select().from(memoryRecords).where(eq(memoryRecords.id, id));
      await db.insert(learningEvidence).values({ companyId, cycleId: row!.id, memoryRecordId: id, sourceVersion: root!.updatedAt.toISOString() });
    }
    return row!;
  }
  async function asset(cycleId: string, type = "skill_version", assetId = randomUUID()) {
    const [hypothesis] = await db.insert(learningHypotheses).values({ companyId, cycleId, claim: "Learned claim",
      predictedEffect: "Earlier review", targetDomain: "skill", targetId: randomUUID(), riskClass: "low" }).returning();
    const [evaluation] = await db.insert(learningEvaluations).values({ companyId, hypothesisId: hypothesis!.id,
      method: "manual_review", result: "inconclusive", cases: [], outcomeVersions: {}, metrics: {}, limitations: [], reviewedBy: ownerId }).returning();
    const [candidate] = await db.insert(learningDomainCandidates).values({ companyId, hypothesisId: hypothesis!.id,
      evaluationId: evaluation!.id, targetDomain: "skill", targetId: hypothesis!.targetId,
      candidateId: type === "skill_version" ? assetId : randomUUID(), candidateHash: "fixture" }).returning();
    await db.insert(learningRetainedAssets).values({ companyId, candidateLinkId: candidate!.id, assetType: type, assetId });
    return { id: assetId, candidate: candidate! };
  }
  async function revision(id = randomUUID()) {
    const [document] = await db.insert(documents).values({ companyId, latestBody: "Learned Foundation payload" }).returning();
    await db.insert(documentRevisions).values({ id, companyId, documentId: document!.id, revisionNumber: 1, body: "Learned Foundation payload" });
    return id;
  }

  it("requires the current Memory reader before the zero-analytical cycle return", async () => {
    const source = await memory(), parent = await cycle([source.id]);
    await expect(assertLearningAnalyticalSources(db, human(ownerId), parent)).resolves.toBeNull();
    await expect(assertLearningAnalyticalSources(db, human(otherId), parent)).rejects.toMatchObject({ status: 403 });
  });
  it("discovers ordinary retained Skill and Foundation cycles and checks candidate review", async () => {
    const parent = await cycle([(await memory()).id]);
    const skill = await asset(parent.id), foundation = await asset(parent.id, "document_revision", await revision());
    for (const [type, id] of [["skill_version", skill.id], ["document_revision", foundation.id]]) {
      const admitted = await assertLearnedAssetAnalyticalSources(db, companyId, type!, id!, human(ownerId));
      expect(admitted.cycles).toEqual([]); // Ordinary roots do not become expiring analytical pins.
      await expect(assertLearnedAssetAnalyticalSources(db, companyId, type!, id!, human(otherId))).rejects.toMatchObject({ status: 403 });
    }
    await expect(assertLearningCandidateAnalyticalSources(db, companyId, "skill", skill.candidate.candidateId, human(otherId)))
      .rejects.toMatchObject({ status: 403 });
  });
  it("rejects missing readers, missing evidence and erased cycles", async () => {
    const parent = await cycle([(await memory()).id]);
    await expect(assertLearningAnalyticalSources(db, undefined, parent)).rejects.toMatchObject({ status: 403 });
    await expect(assertLearningAnalyticalSources(db, human(ownerId), await cycle([]))).rejects.toMatchObject({ status: 403 });
    await db.update(learningCycles).set({ erasedAt: new Date() }).where(eq(learningCycles.id, parent.id));
    await expect(assertLearningAnalyticalSources(db, human(ownerId), { ...parent, erasedAt: new Date() })).rejects.toMatchObject({ status: 403 });
  });
  it("does not retain a successful read after membership withdrawal or Memory revision", async () => {
    const source = await memory(), parent = await cycle([source.id]), actor = human(ownerId);
    await assertLearningAnalyticalSources(db, actor, parent);
    await db.update(companyMemberships).set({ status: "suspended" }).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalId, ownerId)));
    await expect(assertLearningAnalyticalSources(db, actor, parent)).rejects.toMatchObject({ status: 403 });
    await db.update(companyMemberships).set({ status: "active" }).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalId, ownerId)));
    await db.update(memoryRecords).set({ updatedAt: new Date(source.updatedAt.getTime() + 1000) }).where(eq(memoryRecords.id, source.id));
    await expect(assertLearningAnalyticalSources(db, actor, parent)).rejects.toMatchObject({ status: 403 });
  });
  it("denies an actual Memory to Foundation to Learning to Memory cycle", async () => {
    const revisionId = await revision(), source = await memory({ sourceFoundationRevisionIds: [revisionId] });
    await asset((await cycle([source.id])).id, "document_revision", revisionId);
    expect((await authorizationService(db).decide({ actor: human(ownerId), action: "foundation:read",
      resource: { type: "company", companyId }, enforceResponsibleUserIntersection: true })).allowed).toBe(true);
    expect(await canActorReadMemorySources(db, companyId, human(ownerId), source.id)).toBe(false);
  });
  it("allows a completed diamond through the same ordinary learned Memory source", async () => {
    const leaf = await memory(), revisionId = await revision();
    await asset((await cycle([leaf.id])).id, "document_revision", revisionId);
    const top = await memory({ sourceMemoryIds: [leaf.id], sourceFoundationRevisionIds: [revisionId] });
    expect(await canActorReadMemorySources(db, companyId, human(ownerId), top.id)).toBe(true);
  });
});
