import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, authUsers, companies, companyMemberships, createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  heartbeatRuns, issues } from "@paperclipai/db";
import type { ContextAuthorityDecision } from "@paperclipai/shared";
import { canActorReadIssuePrivacy } from "../services/authorization.js";
import { contextManifestService } from "../services/context/context-manifest.js";
import { issueService } from "../services/issues.js";
import { memoryService, type MemoryMutationActor } from "../services/memory/memory-service.js";
import { initializeRunIdentity } from "../services/run-identity.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

describe("Native payload inputs retain their creation-time source closure", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("v10-native-payload-temporal-");
    db = createDb(database.connectionString, { maxConnections: 3 });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await database?.cleanup(); }, 30000);

  async function seed() {
    const companyId = randomUUID(), aliceId = randomUUID(), bobId = randomUUID(), agentId = randomUUID(), runId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Actual temporal native input", issuePrefix: randomUUID() });
    await db.insert(authUsers).values([aliceId, bobId].map(id => ({ id, name: "Current Human", email: `${id}@example.test`, createdAt: new Date(), updatedAt: new Date() })));
    await db.insert(companyMemberships).values([aliceId, bobId].map(principalId => ({ companyId, principalType: "user", principalId, status: "active", membershipRole: "admin" })));
    await db.insert(agents).values({ id: agentId, companyId, name: "Native input owner", role: "engineer", status: "idle", adapterType: "paperclip_runner" });
    await db.insert(companyMemberships).values({ companyId, principalType: "agent", principalId: agentId, status: "active" });
    const [task] = await db.insert(issues).values({ companyId, title: "Original public producer Task", visibility: "open", responsibleUserId: aliceId, createdByUserId: aliceId, assigneeAgentId: agentId }).returning();
    const [privateTask] = await db.insert(issues).values({ companyId, title: "Later private input", description: "Actual private source body", visibility: "private", responsibleUserId: aliceId, createdByUserId: aliceId, assigneeAgentId: agentId }).returning();
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, responsibleUserId: aliceId, nativeIssueId: task!.id, contextSnapshot: { issueId: task!.id }, runtimeMode: "native", status: "running" });
    await initializeRunIdentity(db, { companyId, runId, issueId: task!.id, responsibleUserId: aliceId, cause: "dispatch" });
    const actor: MemoryMutationActor = { principal: { type: "agent", agentId, responsibleUserId: aliceId }, runId };
    const alice = { type: "board" as const, source: "session" as const, userId: aliceId };
    const bob = { type: "board" as const, source: "session" as const, userId: bobId };
    expect(await canActorReadIssuePrivacy(db, alice, privateTask!)).toBe(true);
    expect(await canActorReadIssuePrivacy(db, bob, privateTask!)).toBe(false);
    const selectPrivateInput = async () => {
      const decision: ContextAuthorityDecision = { authorityRank: 0, primaryForDomain: true, reason: "preferred_authority", evidence: {
        id: `task:${privateTask!.id}`, companyId, sourceClass: "task", sourceProvider: "august_works_tasks", sourceType: "issue",
        sourceRef: `issue://${privateTask!.id}`, sourceVersion: privateTask!.updatedAt.toISOString(), sourceUpdatedAt: privateTask!.updatedAt.toISOString(),
        title: privateTask!.title, excerpt: privateTask!.description!, observedAt: new Date().toISOString(), validFrom: null, validUntil: null,
        authorityDomain: "task_state", trustLevel: "high", sensitivity: "internal", citation: { label: "Actual later private source" }, metadata: {},
      } };
      const manifest = await contextManifestService(db).create({ companyId, agentId, runId, issueId: task!.id, responsibleUserId: aliceId,
        query: "Read this newly selected private input", policySnapshot: {}, selected: [{ decision }] });
      expect(manifest.items).toHaveLength(1);
    };
    return { companyId, aliceId, agentId, runId, task: task!, privateTask: privateTask!, actor, alice, bob, selectPrivateInput };
  }

  it("keeps earlier shared Memory readable after its producer later reads a private Task, while narrowing new Memory", async () => {
    const s = await seed(), memory = memoryService(db);
    const human = { principal: { type: "user" as const, userId: s.aliceId } };
    const binding = await memory.createCompanyBinding(s.companyId, { key: randomUUID(), name: "Native source binding", providerKey: "local" }, human);
    await memory.addBindingTarget(s.companyId, binding.id, { targetType: "agent", targetId: s.agentId }, human);
    const create = async (content: string) => {
      const candidate = await memory.createCandidate(s.companyId, { bindingId: binding.id, memoryType: "lesson", scope: { type: "company", id: null }, ownerAgentId: null,
        title: content, content, summary: null, createdByOperationId: null, sensitivity: "internal", observedAt: new Date().toISOString(), validFrom: null, validUntil: null, expiresAt: null,
        evidence: [{ sourceClass: "task", sourceProvider: "native_temporal_fixture", sourceType: "actual_source", sourceRef: `issue://${s.task.id}`,
          sourceVersion: "1", sourceUpdatedAt: null, observedAt: new Date().toISOString(), excerptHash: createHash("sha256").update(content).digest("hex"),
          citation: { label: "Current original input" }, trustLevel: "low", relation: "supports" }] }, s.actor);
      return memory.reviewCandidate(s.companyId, candidate.record.id, { decision: "accept" }, human);
    };
    const earlier = await create(`Earlier public outcome ${randomUUID()}`);
    const bobActor = { principal: { type: "user" as const, userId: s.bob.userId } };
    expect((await memory.get(s.companyId, earlier.record.id, bobActor))?.record.id).toBe(earlier.record.id);
    await s.selectPrivateInput();
    const later = await create(`Later copied private outcome ${randomUUID()}`);
    expect(later.record.sourceIssueIds).toContain(s.privateTask.id);
    expect((await memory.get(s.companyId, later.record.id, human))?.record.id).toBe(later.record.id);
    expect(await memory.get(s.companyId, later.record.id, bobActor)).toBeNull();
    // Current private policy still narrows later copies. A future input cannot
    // become an input to an already committed earlier Memory body.
    expect((await memory.get(s.companyId, earlier.record.id, bobActor))?.record.id).toBe(earlier.record.id);
  });

  it("keeps an earlier derived Task readable while a new Task retains a later private input", async () => {
    const s = await seed(), tasks = issueService(db);
    const create = (title: string) => tasks.create(s.companyId, { title, createdByAgentId: s.agentId, actorRunId: s.runId, actorResponsibleUserId: s.aliceId });
    const earlier = await create("Earlier public native output");
    expect(await canActorReadIssuePrivacy(db, s.bob, earlier)).toBe(true);
    await s.selectPrivateInput();
    const later = await create("Later native output after actual private selection");
    expect(await canActorReadIssuePrivacy(db, s.alice, later)).toBe(true);
    expect(await canActorReadIssuePrivacy(db, s.bob, later)).toBe(false);
    expect(await canActorReadIssuePrivacy(db, s.bob, earlier)).toBe(true);
  });
});
