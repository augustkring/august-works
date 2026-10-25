import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, authUsers, companies, companyMemberships, createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  contextManifests, heartbeatRuns, issues } from "@paperclipai/db";
import { canActorReadIssuePrivacy } from "../services/authorization.js";
import { contextEngineService } from "../services/context/context-engine.js";
import { issueService } from "../services/issues.js";
import { memoryService, type MemoryMutationActor } from "../services/memory/memory-service.js";
import { initializeRunIdentity } from "../services/run-identity.js";
import { seedCurrentHumanSourceActor } from "./helpers/current-human-source-fixture.js";
import { createNativePrivateMemoryThroughHeartbeat } from "./helpers/native-private-memory-producer.js";
import { buildNativeBootstrapSourceSet, buildNativeExecutionInput, prepareNativeTurnWithContext } from "../services/native-runtime/native-execution-input.js";
import { buildNativeModelEnvelope } from "@paperclipai/paperclip-runner";
import { buildRetainedNativeRuntimeContext, type NativeRuntimeAuthoredSourceCapture } from "../services/native-runtime/runtime-context.js";
import { ensureNativeCompletionContract } from "../services/native-runtime/completion-contracts.js";
import { getIssueExecutionContext, buildPaperclipTaskMarkdown } from "../services/heartbeat.js";
import type { NativeTaskSourceCapture } from "../services/issues.js";
import { resolveDefaultAgentWorkspaceDir } from "../home-paths.js";
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
    const human = await seedCurrentHumanSourceActor(db, [companyId], aliceId);
    const task = await issueService(db).create(companyId, { title: "Original public producer Task", visibility: "open",
      responsibleUserId: aliceId, createdByUserId: aliceId }, db, undefined,
      { manualInputActor: human, privacyActor: human, sourceAccessActor: human });
    const privateTask = await issueService(db).create(companyId, { title: "Later private input", description: "Actual private source body",
      visibility: "private", responsibleUserId: aliceId, createdByUserId: aliceId, assigneeAgentId: agentId }, db, undefined,
      { manualInputActor: human, privacyActor: human, sourceAccessActor: human });
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, responsibleUserId: aliceId, nativeIssueId: task!.id, contextSnapshot: { issueId: task!.id }, runtimeMode: "native", status: "running" });
    await db.update(issues).set({ status: "in_progress", assigneeAgentId: agentId, executionRunId: runId })
      .where(and(eq(issues.companyId, companyId), eq(issues.id, task.id)));
    await initializeRunIdentity(db, { companyId, runId, issueId: task!.id, responsibleUserId: aliceId, cause: "dispatch" });
    const actor: MemoryMutationActor = { principal: { type: "agent", agentId, responsibleUserId: aliceId }, runId };
    const alice = { type: "board" as const, source: "session" as const, userId: aliceId };
    const bob = { type: "board" as const, source: "session" as const, userId: bobId };
    expect(await canActorReadIssuePrivacy(db, alice, privateTask)).toBe(true);
    expect(await canActorReadIssuePrivacy(db, bob, privateTask)).toBe(false);
    const selectPrivateInput = async () => {
      const content = `Actual private Memory selected later ${randomUUID()}`;
      await createNativePrivateMemoryThroughHeartbeat({ db, companyId, agentId, userId: aliceId,
        issueId: privateTask.id, content, bindingKey: `temporal-${randomUUID()}` });
      const assembled = await contextEngineService(db).assembleNativeBootstrap({ companyId, agentId,
        authorizationActor: { type: "agent", source: "none", companyId, agentId, runId, onBehalfOfUserId: aliceId },
        responsibleUserId: aliceId, runId, issueId: task.id, projectId: null, query: content,
        intent: "native_task_execution", includeFoundation: false, sensitivityCeiling: "internal" });
      expect(assembled.nativeBootstrapWitness).toBeDefined();
      expect(assembled.packet.privateMemory).toEqual(expect.arrayContaining([expect.objectContaining({ excerpt: content })]));
      expect(assembled.markdown).toContain(content);
      const taskCapture: { value: NativeTaskSourceCapture | null } = { value: null };
      const selectedTask = await getIssueExecutionContext(db, companyId, task.id, capture => { taskCapture.value = capture; });
      if (!selectedTask || !taskCapture.value) throw new Error("The original Task producer did not retain its source capture");
      const references: Array<{ kind: "task" | "comment" | "document_revision" | "attachment" | "unknown"; id: string }> = [];
      const taskPrompt = buildPaperclipTaskMarkdown({ issue: { id: task.id, identifier: selectedTask.identifier,
        title: selectedTask.title, description: selectedTask.description, workMode: selectedTask.workMode } },
      { onRenderedSource: source => references.push(source) });
      if (!taskPrompt) throw new Error("Native temporal Task renderer returned no prompt");
      const runtimeAgent = (await db.select().from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, agentId))))[0];
      if (!runtimeAgent) throw new Error("Native temporal runtime agent disappeared");
      const runtimeCapture: { value: NativeRuntimeAuthoredSourceCapture | null } = { value: null };
      const runtimeContext = await buildRetainedNativeRuntimeContext({ db, agent: runtimeAgent, runId,
        runtimeConfig: {}, runtimeSkillEntries: [], onAuthoredSourceCapture: capture => { runtimeCapture.value = capture; } });
      const completion = await ensureNativeCompletionContract({ db, companyId,
        issue: { id: task.id, title: selectedTask.title, description: selectedTask.description }, actorId: agentId });
      await db.update(heartbeatRuns).set({ completionContractId: completion.row.id,
        completionContractSha256: completion.row.canonicalSha256 }).where(eq(heartbeatRuns.id, runId));
      const cwd = resolveDefaultAgentWorkspaceDir(agentId);
      const execution = buildNativeExecutionInput({ companyId, runId, agentId,
        issue: { id: task.id, identifier: selectedTask.identifier, title: selectedTask.title,
          description: selectedTask.description, workMode: selectedTask.workMode }, taskPrompt,
        workspace: { id: runId, cwd, repoUrl: null, repoRef: null, branchName: null },
        normalizedSessionId: null, provider: "opencode", model: "anthropic/native-temporal-test",
        completionContract: { id: completion.row.id, sha256: completion.row.canonicalSha256,
          schemaVersion: completion.row.schemaVersion, contract: completion.contract }, runtimeContext });
      const sourceSet = buildNativeBootstrapSourceSet({ companyId, runId, agentId, issueId: task.id,
        renderedMarkdown: taskPrompt, renderedMarkdownDigest: createHash("sha256").update(taskPrompt, "utf8").digest("hex"),
        references, candidates: [{ kind: "task", id: task.id, input: taskCapture.value.input,
          payloadSourceSnapshot: taskCapture.value.payloadSourceSnapshot }], runtimeInputs: runtimeCapture.value?.inputs ?? [],
        additionalInputs: [
          { kind: "completion_contract", issueId: task.id, contractId: completion.row.id,
            revision: String(completion.row.revision), contentHash: completion.row.canonicalSha256 },
          { kind: "workspace_metadata", runId, executionWorkspaceId: runId, origin: "agent_home",
            sourceVersion: `agent-home:${agentId}:v1`, contentHash: createHash("sha256").update(JSON.stringify({
              cwd, repoUrl: null, repoRef: null, branchName: null }), "utf8").digest("hex") },
        ], contextManifestIds: [], rolePackInputs: [], unsupportedInputPresent: false });
      if (!sourceSet) throw new Error("The actual Native task/runtime bootstrap did not qualify");
      const envelope = buildNativeModelEnvelope(execution);
      const turnInput = { message: { role: "user" as const, text: JSON.stringify(envelope) }, requestedCollaborationMode: "default" as const };
      const prepared = prepareNativeTurnWithContext({ turnInput,
        baseClosure: { sourceSet, taskEnvelopeDigest: createHash("sha256").update(JSON.stringify(execution.task), "utf8").digest("hex") },
        companyId, runId, agentId, issueId: task.id, contextMarkdown: assembled.markdown,
        contextWitness: assembled.nativeBootstrapWitness!, manifestIds: [{ companyId,
          contextManifestId: assembled.packet.manifest!.id }] });
      expect(prepared?.sourceClosure.sourceSet.inputs).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "context", manifestId: assembled.packet.manifest!.id }),
      ]));
      return { assembled, prepared, content };
    };
    return { companyId, aliceId, agentId, runId, task, privateTask, actor, alice, bob, selectPrivateInput };
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
    await db.delete(contextManifests).where(and(eq(contextManifests.companyId,s.companyId),eq(contextManifests.runId,s.runId)));
    expect(await memory.get(s.companyId,later.record.id,human)).toBeNull();
    expect((await memory.get(s.companyId,earlier.record.id,bobActor))?.record.id).toBe(earlier.record.id);
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
    await db.delete(contextManifests).where(and(eq(contextManifests.companyId,s.companyId),eq(contextManifests.runId,s.runId)));
    expect(await canActorReadIssuePrivacy(db,s.alice,later)).toBe(false);
  });

  it("does not release an earlier private body source when a later producer Task is assigned to another Human", async () => {
    const s = await seed(), tasks = issueService(db), memory = memoryService(db);
    await s.selectPrivateInput();
    // The original Task owner creates Bob's assignment grant. That grant does
    // not publish the private input retained from the preceding producer run.
    const derivative = await tasks.create(s.companyId, {
      title: "Retained private result assigned to Bob", createdByAgentId: s.agentId,
      actorRunId: s.runId, actorResponsibleUserId: s.aliceId, assigneeUserId: s.bob.userId,
    });
    expect(await canActorReadIssuePrivacy(db, s.alice, derivative)).toBe(true);
    expect(await canActorReadIssuePrivacy(db, s.bob, derivative)).toBe(false);
    const nextRunId = randomUUID();
    await db.insert(heartbeatRuns).values({ id: nextRunId, companyId: s.companyId,
      agentId: s.agentId, responsibleUserId: s.aliceId, nativeIssueId: derivative.id,
      contextSnapshot: { issueId: derivative.id }, runtimeMode: "native", status: "running" });
    await initializeRunIdentity(db, { companyId: s.companyId, runId: nextRunId,
      issueId: derivative.id, responsibleUserId: s.aliceId, cause: "dispatch" });
    const human = { principal: { type: "user" as const, userId: s.aliceId } };
    const binding = await memory.createCompanyBinding(s.companyId,
      { key: randomUUID(), name: "Inherited body restriction", providerKey: "local" }, human);
    await memory.addBindingTarget(s.companyId, binding.id, { targetType: "agent", targetId: s.agentId }, human);
    const content = "Private result inherited through the actual earlier Task";
    const candidate = await memory.createCandidate(s.companyId, {
      bindingId: binding.id, memoryType: "lesson", scope: { type: "company", id: null }, ownerAgentId: null,
      title: content, content, summary: null, createdByOperationId: null, sensitivity: "internal",
      observedAt: new Date().toISOString(), validFrom: null, validUntil: null, expiresAt: null,
      evidence: [{ sourceClass: "task", sourceProvider: "native_temporal_fixture", sourceType: "actual_source",
        sourceRef: `issue://${derivative.id}`, sourceVersion: derivative.updatedAt.toISOString(), sourceUpdatedAt: null,
        observedAt: new Date().toISOString(), excerptHash: createHash("sha256").update(content).digest("hex"),
        citation: { label: "Retained prior body" }, trustLevel: "low", relation: "supports" }],
    }, { principal: { type: "agent", agentId: s.agentId, responsibleUserId: s.aliceId }, runId: nextRunId });
    const retained = await memory.reviewCandidate(s.companyId, candidate.record.id, { decision: "accept" }, human);
    expect((await memory.get(s.companyId, retained.record.id, human))?.record.content).toBe(content);
    expect(await memory.get(s.companyId, retained.record.id,
      { principal: { type: "user", userId: s.bob.userId } })).toBeNull();
  });
});
