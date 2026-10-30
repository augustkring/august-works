import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, authUsers, companies, companyMemberships, createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  heartbeatRuns, issues, cognitiveProviderOperations, projects, projectAccessMembers, memoryJobs, activityLog } from "@paperclipai/db";
import type { LiveEvent } from "@paperclipai/shared";
import { analyticalLiveEventForReader } from "../services/analytical-live-events.js";
import { subscribeCompanyLiveEvents } from "../services/live-events.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { memoryService, type MemoryMutationActor } from "../services/memory/memory-service.js";
import { memoryJobService, canActorReadMemoryJob } from "../services/memory/memory-jobs.js";
import { canActorReadMemorySources, lockMemoryPrivacy } from "../services/memory/memory-privacy.js";
import { cognitiveMemoryService, cognitiveEligibleRecords } from "../services/memory/cognitive-memory.js";
import { derivedMemoryService, observationLineage, modelLineage } from "../services/memory/derived-memory.js";
import { learningService, learningRoots } from "../services/learning/learning-service.js";
import { initializeRunIdentity } from "../services/run-identity.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

describe("Actual derived Memory and Learning publications retain source authority", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("v10-derived-live-source-");
    db = createDb(database.connectionString, { maxConnections: 3 });
    await instanceSettingsService(db).updateExperimental({ enableCollectiveMemoryV1: true,
      enableContextEngineV1: true, skill_lifecycle_v5: true, playbooks_v5: true,
      memory_observations_v7: true, memory_models_v7: true, learning_engine_v7: true, cognitive_memory_v7: true });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await database?.cleanup(); }, 30000);

  it("keeps authorized delivery and drops actual observation, model and Learning events for another current Human", async () => {
    const companyId = randomUUID(), aliceId = randomUUID(), bobId = randomUUID(), agentId = randomUUID(), runId = randomUUID();
    const taskIds = [randomUUID(), randomUUID()];
    await db.insert(companies).values({ id: companyId, name: "Derived live sources", issuePrefix: randomUUID() });
    await db.insert(authUsers).values([aliceId, bobId].map(id => ({ id, name: "Current Human",
      email: `${id}@example.test`, createdAt: new Date(), updatedAt: new Date() })));
    await db.insert(companyMemberships).values([aliceId, bobId].map(principalId => ({ companyId,
      principalType: "user", principalId, status: "active", membershipRole: "admin" })));
    await db.insert(agents).values({ id: agentId, companyId, name: "Actual Memory producer", role: "engineer", status: "idle", adapterType: "paperclip_runner" });
    await db.insert(companyMemberships).values({ companyId, principalType: "agent", principalId: agentId, status: "active" });
    await db.insert(issues).values(taskIds.map((id, index) => ({ id, companyId, title: `Verified outcome ${index}`,
      visibility: index === 0 ? "private" as const : "open" as const, createdByUserId: aliceId,
      responsibleUserId: aliceId, assigneeAgentId: agentId })));
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, responsibleUserId: aliceId,
      nativeIssueId: taskIds[0], runtimeMode: "native", status: "running", contextSnapshot: { issueId: taskIds[0] } });
    await initializeRunIdentity(db, { companyId, runId, responsibleUserId: aliceId, issueId: taskIds[0]!, cause: "dispatch" });
    const owner = { type: "board" as const, source: "session" as const, userId: aliceId };
    const other = { ...owner, userId: bobId };
    const human = { principal: { type: "user" as const, userId: aliceId } };
    const producer: MemoryMutationActor = { principal: { type: "agent", agentId, responsibleUserId: aliceId }, runId };
    const memory = memoryService(db), events: LiveEvent[] = [];
    const binding = await memory.createCompanyBinding(companyId, { key: randomUUID(), name: "Verified actual sources", providerKey: "local" }, human);
    await memory.addBindingTarget(companyId, binding.id, { targetType: "agent", targetId: agentId }, human);
    const unsubscribe = subscribeCompanyLiveEvents(companyId, event => { if (event.type === "activity.logged") events.push(event); });
    try {
      const roots: string[] = [];
      for (const [index, taskId] of taskIds.entries()) {
        const content = `Independent verified outcome ${index} ${randomUUID()}`;
        const candidate = await memory.createCandidate(companyId, { bindingId: binding.id, memoryType: "outcome",
          scope: { type: "company", id: null }, ownerAgentId: null, title: `Outcome ${index}`, content,
          summary: null, sensitivity: "internal", observedAt: new Date().toISOString(), validFrom: null,
          validUntil: null, expiresAt: null, createdByOperationId: randomUUID(), evidence: [{ sourceClass: "task",
            sourceProvider: "august_works_tasks", sourceType: "issue", sourceRef: `issue://${taskId}`,
            sourceVersion: "1", sourceUpdatedAt: null, observedAt: new Date().toISOString(),
            excerptHash: createHash("sha256").update(content).digest("hex"), citation: { label: "Actual verified task outcome" },
            trustLevel: "high", relation: "supports" }] }, producer);
        const accepted = await memory.reviewCandidate(companyId, candidate.record.id, { decision: "accept", reason: "Reviewed actual completed outcome" }, human);
        roots.push(accepted.record.id);
        expect(await canActorReadMemorySources(db, companyId, owner, accepted.record.id)).toBe(true);
        expect(await canActorReadMemorySources(db, companyId, other, accepted.record.id)).toBe(false);
      }
      for (const id of taskIds) await db.update(issues).set({ status: "done", completedAt: new Date() }).where(eq(issues.id, id));
      const derived = derivedMemoryService(db), scope = { type: "company" as const, id: null }, purpose = "native_task_execution";
      const observation = await derived.createObservation(owner, companyId, { observationKey: randomUUID(), scope, purpose,
        content: "Actual synthesis of both verified sources", sensitivity: "internal",
        evidence: roots.map(memoryRecordId => ({ memoryRecordId, relation: "supports" as const })) });
      const model = await derived.createModel(owner, companyId, { modelKey: randomUUID(), name: "Actual source model", scope, purpose,
        sourceQuery: "Verified source outcomes", memoryRecordIds: roots, observationIds: [] });
      const cycle = await learningService(db).create(owner, companyId, { scope, purpose,
        trigger: "Two verified native outcomes", memoryRecordIds: roots });
      await observationLineage(db, owner, observation);
      await modelLineage(db, owner, model);
      await learningRoots(db, owner, cycle);
      await expect(observationLineage(db, other, observation)).rejects.toMatchObject({ status: 403 });
      await expect(modelLineage(db, other, model)).rejects.toMatchObject({ status: 403 });
      await expect(learningRoots(db, other, cycle)).rejects.toMatchObject({ status: 403 });
      for (const [entityType, id] of [["memory_record", roots[0]!], ["memory_observation", observation.id],
        ["memory_model", model.id], ["learning_cycle", cycle.id]]) {
        const actual = events.find(event => event.payload.entityType === entityType && event.payload.entityId === id);
        expect(actual).toBeDefined();
        expect.soft(await analyticalLiveEventForReader(db, actual!, owner)).toEqual(actual);
        expect.soft(await analyticalLiveEventForReader(db, actual!, other)).toBeNull();
      }
      const jobs = memoryJobService(db);
      const reflected = await jobs.enqueueMaintenance(companyId, { operationType: "reflection", recordIds: roots,
        proposedLesson: { title: "Actual owner-proposed lesson", content: `Retained source lesson ${randomUUID()}` } }, human, randomUUID());
      const claimed = await jobs.claimNext();
      expect(claimed?.id).toBe(reflected.id);
      await jobs.executeClaimed(claimed!);
      const [completed] = await db.select().from(memoryJobs).where(eq(memoryJobs.id, reflected.id));
      expect(completed?.status).toBe("succeeded");
      expect(completed?.sourceRefJson.recordIds).toEqual([...roots].sort());
      expect(completed?.resultJson?.proposedRecordId).toEqual(expect.any(String));
      expect(await canActorReadMemoryJob(db, companyId, owner, reflected.id)).toBe(true);
      expect(await canActorReadMemoryJob(db, companyId, other, reflected.id)).toBe(false);
      const jobEvent = events.find(event => event.payload.action === "memory.reflection_completed" && event.payload.entityId === reflected.id);
      expect(jobEvent).toBeDefined();
      expect.soft(await analyticalLiveEventForReader(db, jobEvent!, owner)).toEqual(jobEvent);
      expect.soft(await analyticalLiveEventForReader(db, jobEvent!, other)).toBeNull();
      await memory.setRetentionPolicy(companyId, { maxAgeDays: 90 }, human);
      const policyEvent = events.find(event => event.payload.action === "memory.retention_policy_updated");
      expect(policyEvent?.payload.entityId).toBe(companyId);
      // This original owner intentionally uses the company UUID, not a Memory record.
      expect.soft(await analyticalLiveEventForReader(db, policyEvent!, owner)).toEqual(policyEvent);
      expect.soft(await analyticalLiveEventForReader(db, policyEvent!, other)).toEqual(policyEvent);
      const cognitive = cognitiveMemoryService(db);
      const privateBinding = await cognitive.createBinding(owner, companyId, { bindingKey: randomUUID(),
        providerKey: "local_baseline", scope: { type: "agent", id: agentId }, purpose, approvedPrivateProjection: true });
      const privateBindingEvent = events.find(event => event.payload.action === "memory.cognitive_binding_created"
        && event.payload.entityId === privateBinding.id);
      expect(privateBindingEvent).toBeDefined();
      const agentReader = { type: "agent" as const, source: "agent_jwt" as const, companyId, agentId, runId, onBehalfOfUserId: aliceId };
      expect.soft(await analyticalLiveEventForReader(db, privateBindingEvent!, agentReader)).toEqual(privateBindingEvent);
      expect.soft(await analyticalLiveEventForReader(db, privateBindingEvent!, other)).toBeNull();
      const privateProjectId = randomUUID();
      // Explicit source-free test prerequisite; unknown historical projects remain unqualified.
      await db.insert(projects).values({ id: privateProjectId, companyId, name: "Private binding scope",
        visibility: "private", privacyOwnerUserId: aliceId, sourceProvenanceQualified: true });
      await db.insert(projectAccessMembers).values({ companyId, projectId: privateProjectId, subjectType: "user", subjectId: aliceId });
      const projectBinding = await cognitive.createBinding(owner, companyId, { bindingKey: randomUUID(),
        providerKey: "local_baseline", scope: { type: "project", id: privateProjectId }, purpose, approvedPrivateProjection: false });
      expect((await cognitive.status(owner, companyId)).bindings.map(row => row.id)).toContain(projectBinding.id);
      expect((await cognitive.status(other, companyId)).bindings.map(row => row.id)).not.toContain(projectBinding.id);
      await expect(cognitive.createBinding(other, companyId, { bindingKey: randomUUID(), providerKey: "local_baseline",
        scope: { type: "project", id: privateProjectId }, purpose, approvedPrivateProjection: false })).rejects.toMatchObject({ status: 404 });
      const projectBindingEvent = events.find(event => event.payload.action === "memory.cognitive_binding_created"
        && event.payload.entityId === projectBinding.id);
      expect(projectBindingEvent).toBeDefined();
      expect.soft(await analyticalLiveEventForReader(db, projectBindingEvent!, owner)).toEqual(projectBindingEvent);
      expect.soft(await analyticalLiveEventForReader(db, projectBindingEvent!, other)).toBeNull();
      const sharedBinding = await cognitive.createBinding(owner, companyId, { bindingKey: randomUUID(),
        providerKey: "local_baseline", scope, purpose, approvedPrivateProjection: false });
      expect((await cognitiveEligibleRecords(db, sharedBinding, owner, purpose, "internal")).map(row => row.id).sort()).toEqual([...roots].sort());
      expect(await cognitiveEligibleRecords(db, sharedBinding, other, purpose, "internal")).toEqual([]);
      const reconciliation = await cognitive.reconcile(owner, companyId, sharedBinding.id);
      const [operation] = await db.select().from(cognitiveProviderOperations).where(eq(cognitiveProviderOperations.id, reconciliation.operationId));
      expect(operation?.bindingId).toBe(sharedBinding.id);
      expect(operation?.recordVersions.map(row => row.id).sort()).toEqual([...roots].sort());
      const reconciliationEvent = events.find(event => event.payload.action === "memory.cognitive_reconciled"
        && event.payload.entityId === sharedBinding.id);
      expect(reconciliationEvent).toBeDefined();
      expect(reconciliationEvent!.payload.details).toMatchObject({ operationId: operation!.id, count: 2 });
      expect.soft(await analyticalLiveEventForReader(db, reconciliationEvent!, owner)).toEqual(reconciliationEvent);
      expect.soft(await analyticalLiveEventForReader(db, reconciliationEvent!, other)).toBeNull();
      const operationsBefore = await db.select({ id: cognitiveProviderOperations.id }).from(cognitiveProviderOperations).where(eq(cognitiveProviderOperations.bindingId, sharedBinding.id));
      const activitiesBefore = await db.select({ id: activityLog.id }).from(activityLog).where(and(eq(activityLog.companyId, companyId), eq(activityLog.entityId, sharedBinding.id)));
      let pending!: Promise<unknown>;
      await db.transaction(async holder => {
        await lockMemoryPrivacy(holder, companyId);
        const [identity] = await holder.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
        pending = cognitive.reconcile(owner, companyId, sharedBinding.id).then(() => null, error => error);
        const deadline = performance.now() + 5000;
        let observed = false;
        while (performance.now() < deadline) {
          const [blocked] = await db.execute<{ count: number }>(sql`select count(*)::int as count from pg_stat_activity
            where ${identity!.pid}=any(pg_blocking_pids(pid)) and wait_event_type='Lock'`);
          if (blocked?.count) { observed = true; break; }
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        expect(observed).toBe(true);
        await holder.update(companyMemberships).set({ membershipRole: "member" }).where(and(
          eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalId, aliceId), eq(companyMemberships.principalType, "user")));
      });
      expect(await pending).toMatchObject({ status: 403 });
      expect(await db.select({ id: cognitiveProviderOperations.id }).from(cognitiveProviderOperations).where(eq(cognitiveProviderOperations.bindingId, sharedBinding.id))).toEqual(operationsBefore);
      expect(await db.select({ id: activityLog.id }).from(activityLog).where(and(eq(activityLog.companyId, companyId), eq(activityLog.entityId, sharedBinding.id)))).toEqual(activitiesBefore);
    } finally { unsubscribe(); }
  });
});
