import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { companies, agents, agentIdentities, companyMemberships, principalPermissionGrants, createDb, memoryBindings, memoryRecords, memoryEvidence, memoryModels, memoryModelVersions, memoryObservations, issues, heartbeatRuns, heartbeatRunEvents, contextManifestMemoryRoots } from "@paperclipai/db";
import { derivedMemoryService } from "../services/memory/derived-memory.js";
import { derivedMemoryContextProvider } from "../services/memory/derived-context.js";
import { memoryJobService } from "../services/memory/memory-jobs.js";
import { memoryService } from "../services/memory/memory-service.js";
import { purgeMemoryRecords, reapplyMemoryDeletionMarkers } from "../services/memory/memory-privacy.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { contextEngineService } from "../services/context/context-engine.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("V7 evidence-rooted derived Memory", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let companyId: string, agentId: string, first: string, second: string;
  const owner = { type: "board" as const, source: "local_implicit" as const };
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-v7-derived-"); db = createDb(database.connectionString);
    await instanceSettingsService(db).updateExperimental({ enableCollectiveMemoryV1: true, enableContextEngineV1: true, cognitive_memory_v7: true, memory_observations_v7: true, memory_models_v7: true }); });
  afterAll(async () => { await database?.cleanup(); });
  beforeEach(async () => {
    companyId = randomUUID(); agentId = randomUUID(); first = randomUUID(); second = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Derived fixture", issuePrefix: `O${companyId.slice(0, 7)}` });
    const [identity] = await db.insert(agentIdentities).values({ name: "Derived reader", homeCompanyId: companyId }).returning();
    await db.insert(agents).values({ id: agentId, companyId, agentIdentityId: identity!.id, name: "Derived reader" });
    await db.insert(companyMemberships).values({ companyId, principalType: "agent", principalId: agentId, status: "active" });
    await db.insert(principalPermissionGrants).values({ companyId, principalType: "agent", principalId: agentId, permissionKey: "company_scope:read" });
    const [binding] = await db.insert(memoryBindings).values({ companyId, key: "fixture", name: "Governed", providerKey: "local" }).returning();
    for (const [id, text] of [[first, "Customer onboarding repeated an evidence gap"], [second, "Customer onboarding delayed because evidence was missing"]]) {
      await db.insert(memoryRecords).values({ id: id!, companyId, bindingId: binding!.id, providerKey: "local", memoryType: "outcome", scopeType: "company", content: text!, reviewState: "accepted", verificationState: "human_verified", observedAt: new Date(), createdByActorType: "system", createdByActorId: "fixture" });
      await db.insert(memoryEvidence).values({ companyId, memoryRecordId: id!, sourceClass: "task", sourceProvider: "august_works_tasks", sourceType: "issue", sourceRef: `issue://${id}`, sourceVersion: "1", observedAt: new Date(), excerptHash: id === first ? "a".repeat(64) : "b".repeat(64), citationJson: { label: "Reviewed outcome" }, trustLevel: "high", supportsOrContradicts: "supports" });
    }
  });
  const observationInput = () => ({ observationKey: "customer.onboarding", scope: { type: "company" as const, id: null }, purpose: "general_work", content: "Customer onboarding repeatedly needs evidence review", sensitivity: "internal" as const,
    evidence: [{ memoryRecordId: first, relation: "supports" as const }, { memoryRecordId: second, relation: "supports" as const }] });
  const modelInput = () => ({ modelKey: "customer.onboarding", name: "Onboarding evidence model", scope: { type: "company" as const, id: null }, purpose: "general_work", sourceQuery: "customer onboarding", memoryRecordIds: [first, second], observationIds: [] as string[] });
  const review = (version: number) => ({ expectedVersion: version, reason: "Reviewed root evidence and scope" });
  const context = () => ({ request: { companyId, agentId, query: "customer onboarding", intent: "general_work" }, signal: new AbortController().signal, deadlineAt: Date.now() + 1000 });
  it("requires independent reviewed roots and keeps candidates out of Context until human review", async () => {
    const svc = derivedMemoryService(db), observation = await svc.createObservation(owner, companyId, observationInput());
    expect(observation.status).toBe("candidate"); expect(observation.independentSourceCount).toBe(2);
    expect((await derivedMemoryContextProvider(db).retrieve(context())).evidence).toHaveLength(0);
    const accepted = await svc.reviewObservation(owner, companyId, observation.id, "accept", review(1));
    expect(accepted.status).toBe("accepted");
    const model = await svc.createModel(owner, companyId, { ...modelInput(), memoryRecordIds: [], observationIds: [observation.id] });
    await svc.reviewModel(owner, companyId, model.id, "accept", review(1));
    const packet = await derivedMemoryContextProvider(db).retrieve(context());
    expect(packet.evidence).toHaveLength(2); expect(packet.evidence.every((item) => item.authorityDomain === null && item.metadata.derived === true)).toBe(true);
    expect((await derivedMemoryContextProvider(db).retrieve({ ...context(), request: { ...context().request, intent: "person_decision" } })).evidence).toHaveLength(0);
  });
  it("does not inflate independence from duplicated claims or repeated same-source evidence", async () => {
    await db.update(memoryRecords).set({ content: "Customer onboarding repeated an evidence gap" }).where(eq(memoryRecords.id, second));
    await db.update(memoryEvidence).set({ sourceRef: `issue://${first}`, excerptHash: "a".repeat(64) }).where(eq(memoryEvidence.memoryRecordId, second));
    const svc = derivedMemoryService(db), candidate = await svc.createObservation(owner, companyId, observationInput());
    expect(candidate.status).toBe("needs_review"); expect(candidate.independentSourceCount).toBe(1);
    await expect(svc.reviewObservation(owner, companyId, candidate.id, "accept", review(1))).rejects.toMatchObject({ status: 409 });
  });
  it("does not treat a reviewed record with wholly untrusted source evidence as independent trusted support", async () => {
    await db.update(memoryEvidence).set({ sourceClass: "external_untrusted", trustLevel: "untrusted" }).where(eq(memoryEvidence.memoryRecordId, second));
    const svc = derivedMemoryService(db), candidate = await svc.createObservation(owner, companyId, observationInput());
    expect(candidate.status).toBe("needs_review"); expect(candidate.independentSourceCount).toBe(1);
    await expect(svc.reviewObservation(owner, companyId, candidate.id, "accept", review(1))).rejects.toMatchObject({ status: 409 });
  });
  it("immediately withholds derived influence after a source revocation with V7 switched off", async () => {
    const svc = derivedMemoryService(db), observation = await svc.createObservation(owner, companyId, observationInput());
    await svc.reviewObservation(owner, companyId, observation.id, "accept", review(1));
    const model = await svc.createModel(owner, companyId, { ...modelInput(), observationIds: [observation.id] });
    await svc.reviewModel(owner, companyId, model.id, "accept", review(1));
    await instanceSettingsService(db).updateExperimental({ memory_models_v7: false, memory_observations_v7: false });
    await memoryService(db).revoke(companyId, first, { reason: "Wrong outcome" }, { principal: { type: "system", service: "fixture" } });
    expect((await db.select().from(memoryModels).where(eq(memoryModels.id, model.id)))[0]!.status).toBe("needs_rebuild");
    expect((await db.select().from(memoryObservations).where(eq(memoryObservations.id, observation.id)))[0]!.status).toBe("needs_review");
    await instanceSettingsService(db).updateExperimental({ memory_observations_v7: true, memory_models_v7: true });
    expect((await derivedMemoryContextProvider(db).retrieve(context())).evidence).toHaveLength(0);
    expect((await svc.getModel(owner, companyId, model.id)).content).toBe("");
  });
  it("rebuilds through the existing leased Memory worker, retains versions and requires new review", async () => {
    const svc = derivedMemoryService(db), model = await svc.createModel(owner, companyId, modelInput());
    await svc.reviewModel(owner, companyId, model.id, "accept", review(1));
    const job = await svc.rebuildModel(owner, companyId, model.id, { expectedVersion: 1, memoryRecordIds: [second], observationIds: [] });
    expect(job.operationType).toBe("model_rebuild");
    const jobs = memoryJobService(db), claimed = await jobs.claimNext(); expect(claimed!.id).toBe(job.id); await jobs.executeClaimed(claimed!);
    const rebuilt = await svc.getModel(owner, companyId, model.id); expect(rebuilt.version).toBe(2); expect(rebuilt.status).toBe("candidate");
    expect(await db.select().from(memoryModelVersions).where(eq(memoryModelVersions.modelId, model.id))).toHaveLength(2);
    expect((await derivedMemoryContextProvider(db).retrieve(context())).evidence).toHaveLength(0);
    await svc.reviewModel(owner, companyId, model.id, "accept", review(2));
    expect((await derivedMemoryContextProvider(db).retrieve(context())).evidence).toHaveLength(1);
  });
  it("erases all derived versions and re-applies source deletion tombstones after restore", async () => {
    const svc = derivedMemoryService(db), observation = await svc.createObservation(owner, companyId, observationInput()), model = await svc.createModel(owner, companyId, modelInput());
    await db.transaction(async (tx) => { await purgeMemoryRecords(tx as unknown as typeof db, companyId, [first]); });
    expect((await db.select().from(memoryObservations).where(eq(memoryObservations.id, observation.id)))[0]!.content).toBe("");
    expect((await db.select().from(memoryModelVersions).where(eq(memoryModelVersions.modelId, model.id))).every((row) => row.content === "" && row.erasedAt !== null)).toBe(true);
    await db.update(memoryRecords).set({ content: "Restored deleted customer facts", deletedAt: null }).where(eq(memoryRecords.id, first));
    await db.update(memoryModels).set({ content: "Restored deleted synthesis", erasedAt: null }).where(eq(memoryModels.id, model.id));
    await reapplyMemoryDeletionMarkers(db, companyId);
    expect((await db.select().from(memoryModels).where(eq(memoryModels.id, model.id)))[0]!.content).toBe("");
    await expect(svc.getModel(owner, companyId, model.id)).rejects.toMatchObject({ status: 404 });
  });
  it("rejects foreign roots, private-to-company promotion, lower sensitivity and agent self-approval", async () => {
    const svc = derivedMemoryService(db);
    await expect(svc.createObservation(owner, companyId, { ...observationInput(), evidence: [{ memoryRecordId: randomUUID(), relation: "supports" }, { memoryRecordId: second, relation: "supports" }] })).rejects.toMatchObject({ status: 404 });
    await db.update(memoryRecords).set({ sensitivityLabel: "restricted" }).where(eq(memoryRecords.id, first));
    await expect(svc.createObservation(owner, companyId, observationInput())).rejects.toMatchObject({ status: 403 });
    await db.update(memoryRecords).set({ sensitivityLabel: "internal", scopeType: "agent", scopeId: agentId, ownerAgentId: agentId }).where(eq(memoryRecords.id, first));
    await expect(svc.createObservation(owner, companyId, observationInput())).rejects.toMatchObject({ status: 409 });
    await expect(svc.reviewObservation({ type: "agent", agentId, companyId, source: "agent_key" }, companyId, randomUUID(), "accept", review(1))).rejects.toMatchObject({ status: 403 });
  });
  it("propagates Context root erasure into run/Task payloads and blocks late restored writes", async () => {
    const svc = derivedMemoryService(db), model = await svc.createModel(owner, companyId, modelInput());
    await svc.reviewModel(owner, companyId, model.id, "accept", review(1));
    const taskId = randomUUID(), runId = randomUUID();
    await db.insert(issues).values({ id: taskId, companyId, title: "Derived customer outcome", description: "Sensitive source synthesis", assigneeAgentId: agentId });
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, status: "running", contextSnapshot: { issueId: taskId, memoryText: "Derived customer content" }, resultJson: { body: "Derived customer result" } });
    const assembled = await contextEngineService(db).assemble({ companyId, agentId, runId, issueId: taskId, query: "customer onboarding", intent: "general_work", includeFoundation: false });
    expect(await db.select().from(contextManifestMemoryRoots).where(eq(contextManifestMemoryRoots.manifestId, assembled.packet.manifest!.id))).toHaveLength(2);
    await db.transaction(async (tx) => { await purgeMemoryRecords(tx as unknown as typeof db, companyId, [first]); });
    const [erased] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
    expect(erased!.contextSnapshot).toEqual({}); expect(erased!.resultJson).toBeNull();
    expect((await db.select().from(issues).where(eq(issues.id, taskId)))[0]!.description).toBeNull();
    await db.update(heartbeatRuns).set({ contextSnapshot: { restored: "Sensitive synthesis" }, resultJson: { leaked: "late worker output" } }).where(eq(heartbeatRuns.id, runId));
    await db.insert(heartbeatRunEvents).values({ companyId, agentId, runId, seq: 1, eventType: "stdout", message: "late worker output", payload: { leak: "Sensitive synthesis" } });
    expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)))[0]!.resultJson).toBeNull();
    expect((await db.select().from(heartbeatRunEvents).where(eq(heartbeatRunEvents.runId, runId)))[0]!.payload).toBeNull();
  });
});
