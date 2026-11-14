import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { agents, agentWakeupRequests, nativeRunFinalizations, orchestrationPlans, companyMemberships, completionContracts, contextManifestItems, createDb, documents, documentRevisions,
  heartbeatRuns, issueComments, issueDocuments, issues, memoryJobs, memoryRecords, toolInvocations, orchestrationModelReservations, orchestrationWorkerAttempts, issuePrivacySources } from "@paperclipai/db";
import { nativePayloadSourceSnapshotSchema, nativeRunInputSourceReceiptSchema, type NativePayloadSourceInput } from "@paperclipai/shared";
import { activeMemoryTemporalContexts, canActorReadIssuePrivacy, withReadMemoryTemporalSources,
  withReadPinnedNativeTaskSnapshot, type MemoryPageStructuralProofMemoStore } from "../services/authorization.js";
import * as authorizationChecks from "../services/authorization.js";
import { heartbeatService } from "../services/heartbeat.js";
import { verificationService } from "../services/supervision/verification-service.js";
import { issueService } from "../services/issues.js";
import { memoryService } from "../services/memory/memory-service.js";
import { memoryJobService } from "../services/memory/memory-jobs.js";
import { assertNativeDocumentRevisionCurrentSourceAccess, assertNativeMemoryOutputSnapshotCurrent,
  assertNativePayloadSourceSetCurrent, withNativeMemoryOutputSnapshotCurrent,
  addNativeFrozenTaskDescendantClosure, nativeFrozenTaskMemoWouldIntersectActiveAncestry, nativeSourceMemoDiagnosticsForTest,
  assertNativeModelOutputCaptureCurrent, assertNativeManagedConsumedSourceSetCurrent, nativeConsumedSourceComponentsContainCycle,
  resetNativeSourceMemoDiagnosticsForTest } from "../services/native-direct-input.js";
import { nativeCommentProjectionHash, nativeSha256 } from "../services/native-runtime/canonical.js";
import { lockAnalyticalCompany } from "../services/analytical-privacy.js";
import { canActorReadMemorySourceSet, canActorReadMemorySources, lockMemoryPrivacy } from "../services/memory/memory-privacy.js";
import { managedOpenCodeRuntimeDirectory } from "../services/native-runtime/runtime-asset-retention.js";
import { assertScopedNativeMemoryReplayReceiptCurrent } from "../services/tool-gateway.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { configureManagedConversationSandboxHost } from "./helpers/managed-native-conversation-sandbox-host.js";
import { makeFixtureTreeWritable, runManagedNativeOpenCodeFixture, type ManagedWorkerSandboxHost } from "./helpers/managed-native-opencode-e2e-fixture.js";

function hasPinnedOpenCodeProfile(): boolean {
  if (process.platform !== "linux") return false;
  if (process.env.PAPERCLIP_QUALIFIED_OPENCODE_BINARY?.trim()) return true;
  try { return Boolean(execFileSync("which", ["opencode"], { encoding: "utf8" }).trim()); }
  catch { return false; }
}

const nativeOpenCodeTemporalDescribe = describe.skipIf(!hasPinnedOpenCodeProfile());

describe("Native consumed-source component graph", () => {
  it("allows prefix back-references and rejects self or mutual cycles", () => {
    expect(nativeConsumedSourceComponentsContainCycle([[1], []])).toBe(false);
    expect(nativeConsumedSourceComponentsContainCycle([[1], [0]])).toBe(true);
    expect(nativeConsumedSourceComponentsContainCycle([[0]])).toBe(true);
  });
});

nativeOpenCodeTemporalDescribe("Native model outputs retain only the source closure consumed at creation", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let root = "";
  let instanceId = "";
  let preserveDebugArtifacts = false;
  let preserveDatabaseFailure = false;
  let fixtureStage = "initializing";
  let fixtureDeadlineAt: Date | null = null;
  let fixtureCheckpoint: Record<string, unknown> = {};
  const stage = (value: string) => {
    fixtureStage = value;
    console.info("native_temporal_setup_stage", JSON.stringify({ stage: value }));
  };
  let temporal: Awaited<ReturnType<typeof buildTemporalFixture>>;

  async function buildTemporalFixture() {
    const privateRootContent = `private-root-${randomUUID()}`;
    const taskATitle = `Independent task A ${randomUUID()}`;
    const taskBTitle = `Task B copied after Context ${randomUUID()}`;
    const documentKey = `temporal-a-${randomUUID()}`;
    const documentKeyB = `temporal-b-${randomUUID()}`;
    const ids = {
      documentA: `temporal-document-a-${randomUUID()}`,
      documentB: `temporal-document-b-${randomUUID()}`,
      taskA: `temporal-task-a-${randomUUID()}`,
      memoryA: `temporal-memory-a-${randomUUID()}`,
      contextR: `temporal-context-r-${randomUUID()}`,
      taskB: `temporal-task-b-${randomUUID()}`,
      memoryB: `temporal-memory-b-${randomUUID()}`,
    };
    if (!fixtureDeadlineAt) throw new Error("native_temporal_fixture_deadline_missing");
    const sandboxOptions = {
      fixtureDeadlineAt,
      sandboxRelay: true,
      configureSandboxHost: async (context: Parameters<typeof configureManagedConversationSandboxHost>[0]) => {
        const host = await configureManagedConversationSandboxHost(context);
        if (typeof host.modelRequest !== "function") throw new Error("native_temporal_host_provider_bridge_missing");
        return host as ManagedWorkerSandboxHost;
      },
      beforeProviderResponse: async (context: { companyId: string; runId: string }) => {
        const [attempt] = await db.select().from(orchestrationWorkerAttempts).where(and(
          eq(orchestrationWorkerAttempts.companyId, context.companyId), eq(orchestrationWorkerAttempts.runId, context.runId)));
        expect(attempt?.status).toBe("running");
        const reservations = await db.select().from(orchestrationModelReservations).where(and(
          eq(orchestrationModelReservations.companyId, context.companyId), eq(orchestrationModelReservations.workerAttemptId, attempt!.id)));
        expect(reservations.some(row => row.purpose === "worker_model" && row.status === "dispatched")).toBe(true);
      },
    };
    stage("first_journey");
    const first = await runManagedNativeOpenCodeFixture({ ...sandboxOptions, db, connectionString: database.connectionString,
      root, instanceId, onPreserveDebugArtifacts: () => { preserveDebugArtifacts = true; },
      steps: [
        { tool: "write_document", id: ids.documentA, input: { idempotencyKey: randomUUID(), key: documentKey,
          title: "Independent document A", body: "A predates the private Context read.", baseRevisionId: null } },
        { tool: "create_task", id: ids.taskA, input: { idempotencyKey: randomUUID(), title: taskATitle,
          description: "Independent model-created Task A before the private Context read.", status: "backlog" } },
        { tool: "self_remember", id: ids.memoryA, input: { scope: "company", memoryType: "outcome",
          title: "Earlier shared Memory A", content: "Memory A predates the private Context read.", idempotencyKey: randomUUID() } },
        { tool: "read_context", id: ids.contextR, input: { query: privateRootContent } },
        { tool: "write_document", id: ids.documentB, input: { idempotencyKey: randomUUID(), key: documentKeyB,
          title: "Private-context document B", body: "B follows the private Context read.", baseRevisionId: null } },
        { tool: "create_task", id: ids.taskB, input: { idempotencyKey: randomUUID(), title: taskBTitle,
          description: `Copied body after governed Context read: ${randomUUID()}.`, status: "backlog" } },
        { tool: "self_remember", id: ids.memoryB, input: { scope: "company", memoryType: "outcome",
          title: "Later shared Memory B", content: "Memory B was produced after private Context selection.",
          idempotencyKey: randomUUID() } },
        { tool: "paperclip_finish", id: `temporal-finish-first-${randomUUID()}` },
      ],
      privateContextContent: privateRootContent,
      humanActions: [
        { afterModelToolCallId: ids.memoryA, action: "accept_memory_candidate" },
        { afterModelToolCallId: ids.memoryA, action: "create_private_context_root" },
      ],
    });
    expect(first.sandbox?.brokerTokenSubstitutionCount).toBe(0);
    expect(first.sandbox?.facts.relayAuthenticated).toBe(true);
    stage("first_journey_returned");
    fixtureCheckpoint = { companyId: first.companyId, aliceActor: first.aliceActor,
      aliceMemoryActor: first.aliceMemoryActor, bobMemoryActor: first.bobMemoryActor,
      bobUserId: first.bobUserId, aliceUserId: first.aliceUserId };
    expect(first.contextResultConsumers).toContainEqual({ callId: ids.contextR, consumed: true });
    const firstToolResult = (callId: string) => first.toolResults.find(value => value.callId === callId);
    const capturedTaskId = (callId: string) => {
      const captures = Array.isArray(first.toolResultSourceCaptures)
        ? first.toolResultSourceCaptures as Array<Record<string, unknown>> : [];
      const matching = captures.filter(value => value.callId === callId && value.tool === "create_task" &&
        value.managedOpenCode === true);
      const taskRef = matching.length === 1 && matching[0]!.taskRef && typeof matching[0]!.taskRef === "object"
        ? matching[0]!.taskRef as Record<string, unknown> : null;
      return typeof taskRef?.issueId === "string" ? taskRef.issueId : undefined;
    };
    const taskAId = capturedTaskId(ids.taskA);
    const memoryAId = firstToolResult(ids.memoryA)?.memoryId;
    const privateRootId = first.privateRoot?.memoryId;
    const taskBId = capturedTaskId(ids.taskB);
    const memoryBId = firstToolResult(ids.memoryB)?.memoryId;
    const missingOutputs = { taskA: !taskAId, memoryA: !memoryAId, privateRoot: !privateRootId,
      taskB: !taskBId, memoryB: !memoryBId };
    for (const id of [taskAId, memoryAId, privateRootId, taskBId, memoryBId])
      if (id !== undefined) expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    if (Object.values(missingOutputs).some(Boolean))
      throw new Error(`The managed Native producer omitted an output ID: ${JSON.stringify(missingOutputs)}`);

    const memories = memoryService(db);
    fixtureCheckpoint = { ...fixtureCheckpoint, taskAId, taskBId, memoryAId, memoryBId, privateRootId };
    stage("review_memory_b");
    await memories.reviewCandidate(first.companyId, memoryBId, { decision: "accept" }, first.aliceMemoryActor);
    const [taskA] = await db.select().from(issues).where(and(eq(issues.companyId, first.companyId), eq(issues.id, taskAId)));
    const [taskB] = await db.select().from(issues).where(and(eq(issues.companyId, first.companyId), eq(issues.id, taskBId)));
    if (!taskA || !taskB) throw new Error("The managed Native Task outputs disappeared");
    if (!taskB) throw new Error("The Native Task B disappeared");

    // Independently settle the first retained product through its real Human
    // verification owner before this same Agent admits another Task.
    stage("verify_first_journey");
    const {runId:firstRunId,issueId:firstIssueId,planId:firstPlanId} = first;
    if (!firstRunId || !firstIssueId || !firstPlanId) throw new Error("temporal_verified_predecessor_owner_missing");
    const verifier = verificationService(db);
    const packet = await verifier.packet(first.aliceActor,first.companyId,firstPlanId);
    expect(packet.deterministicFailures).toEqual([]);
    expect(packet.policy.workerSelfCertification).toBe(false);
    const reviewedDocuments = packet.evidence.filter(item=>item.type==="task_document" && item.hash!==null &&
      [nativeSha256("A predates the private Context read."),nativeSha256("B follows the private Context read.")].includes(item.hash));
    expect(reviewedDocuments).toHaveLength(2);
    const evidenceRefs = reviewedDocuments.map(item=>item.ref);
    const judgement = (_:unknown,index:number)=>({index,satisfied:true,evidenceRefs});
    const review = await verifier.review(first.aliceActor,first.companyId,firstPlanId,{
      expectedPlanVersion:packet.planVersion,expectedResultHash:packet.resultHash,workerId:packet.workerId,
      result:"pass",objectiveSatisfied:true,rationale:"The initiating Human checked both exact retained temporal journey documents.",
      businessInvariants:packet.contract.businessInvariants.map(judgement),
      evidenceRequirements:packet.contract.evidenceRequirements.map(judgement),
      prohibitedOutcomes:packet.contract.prohibitedOutcomes.map(judgement),
    });
    expect(review).toMatchObject({result:"pass",reviewerType:"human",reviewerId:first.aliceUserId,recommendation:"FINISH",resultHash:packet.resultHash});
    if (!review.workerAttemptId) throw new Error("temporal_verified_predecessor_attempt_missing");
    const [reviewedAttempt] = await db.select().from(orchestrationWorkerAttempts).where(and(
      eq(orchestrationWorkerAttempts.companyId,first.companyId),eq(orchestrationWorkerAttempts.id,review.workerAttemptId)));
    expect(reviewedAttempt).toMatchObject({planId:firstPlanId,runId:firstRunId,agentId:first.agentId,status:"succeeded"});
    const [reviewedPlan] = await db.select().from(orchestrationPlans).where(eq(orchestrationPlans.id,firstPlanId));
    const [reviewedTask] = await db.select().from(issues).where(eq(issues.id,firstIssueId));
    expect(reviewedPlan).toMatchObject({status:"completed"});
    expect(reviewedTask).toMatchObject({status:"done",assigneeAgentId:first.agentId,responsibleUserId:first.aliceUserId});
    const [firstFinalizer] = await db.select().from(nativeRunFinalizations).where(and(
      eq(nativeRunFinalizations.companyId,first.companyId),eq(nativeRunFinalizations.runId,firstRunId)));
    if (!firstFinalizer?.decisionId) throw new Error("temporal_verified_predecessor_decision_missing");
    const firstHeartbeat = heartbeatService(db);
    await firstHeartbeat.dispatchPendingNativeStatusWakeups({companyId:first.companyId});
    const [skippedContinuation] = await db.select().from(agentWakeupRequests).where(and(
      eq(agentWakeupRequests.companyId,first.companyId),eq(agentWakeupRequests.agentId,first.agentId),
      eq(agentWakeupRequests.idempotencyKey,`native-status:${firstFinalizer.decisionId}:continuation`)));
    expect(skippedContinuation).toMatchObject({status:"skipped",runId:null});
    expect(skippedContinuation?.finishedAt).toBeTruthy();
    const [claimGeneration] = await db.select({value:sql<string>`${agents.updatedAt}::text`}).from(agents).where(and(
      eq(agents.companyId,first.companyId),eq(agents.id,first.agentId)));
    if (!claimGeneration?.value) throw new Error("temporal_verified_predecessor_generation_missing");
    const verifiedPredecessor = {runId:firstRunId,issueId:firstIssueId,planId:firstPlanId,workerAttemptId:review.workerAttemptId,
      verificationRunId:review.id,resultHash:packet.resultHash,agentUpdatedAtGeneration:claimGeneration.value};

    stage("second_journey");
    const second = await runManagedNativeOpenCodeFixture({ ...sandboxOptions, db, connectionString: database.connectionString,
      root, instanceId, reuseIdentity: first.reuseIdentity, existingTaskId: taskBId, verifiedPredecessor,
      onPreserveDebugArtifacts: () => { preserveDebugArtifacts = true; },
      taskTitle: `Temporal follow-up ${randomUUID()}`,
      steps: [
        { tool: "read_context", id: `temporal-context-b-${randomUUID()}`, input: { query: `${taskBTitle} ${taskB.description ?? ""}` } },
        { tool: "self_remember", id: `temporal-memory-c-${randomUUID()}`, input: { scope: "company", memoryType: "outcome",
          title: "Memory C inherited from Task B", content: "Memory C consumed the fresh Context selected from Task B.",
          idempotencyKey: randomUUID() } },
        { tool: "write_document", id: `temporal-document-c-${randomUUID()}`, input: { idempotencyKey: randomUUID(),
          key: `temporal-c-${randomUUID()}`, title: "Fresh-context follow-up", body: "A valid completed output after fresh Context.", baseRevisionId: null } },
        { tool: "paperclip_finish", id: `temporal-finish-second-${randomUUID()}` },
      ] });
    expect(second.sandbox?.brokerTokenSubstitutionCount).toBe(0);
    expect(second.sandbox?.facts.relayAuthenticated).toBe(true);
    expect(second.issueId).toBe(taskBId);
    stage("second_journey_returned");
    await writeFile(join(root, "native-source-checkpoint.json"), JSON.stringify({ ...fixtureCheckpoint,
      dataDir: database.dataDir, instanceId, stage: fixtureStage,
      secondAliceActor: second.aliceActor, secondAliceMemoryActor: second.aliceMemoryActor }, null, 2), { mode: 0o600 });
    const firstContextCapture = first.contextReadCaptures.find(value => value.callId === ids.contextR)?.contextRead as {
      manifestIds?: Array<{ contextManifestId: string }>;
      sourceSet?: { policy?: { memoryIds?: string[]; issueIds?: string[] }; inputs?: Array<{ kind?: string; memoryId?: string }> };
    } | undefined;
    const firstManifestId = firstContextCapture?.manifestIds?.[0]?.contextManifestId;
    if (!firstContextCapture || !firstManifestId) throw new Error("The first managed run has no actual private Context manifest");
    const firstSelectedItems = await db.select().from(contextManifestItems).where(and(
      eq(contextManifestItems.companyId, first.companyId), eq(contextManifestItems.manifestId, firstManifestId)));
    expect(firstSelectedItems.some(item => item.sourceProvider === "august_works_memory" &&
      item.sourceRef === `memory://record/${privateRootId}`)).toBe(true);
    expect(firstContextCapture.sourceSet?.policy?.memoryIds).toContain(privateRootId);
    expect(firstContextCapture.sourceSet?.policy?.issueIds).toContain(first.privateRoot?.issueId);
    // Reusing the existing Human credential preserves its current authority;
    // the first and second run actors are the same reader for this private
    // owner, so both reads must follow the same live membership decision.
    stage("private_root_first_alice");
    expect((await memories.get(first.companyId, privateRootId!, first.aliceMemoryActor))?.record.id).toBe(privateRootId);
    stage("private_root_second_alice");
    expect((await memories.get(first.companyId, privateRootId!, second.aliceMemoryActor))?.record.id).toBe(privateRootId);
    stage("private_root_second_bob");
    expect(await memories.get(first.companyId, privateRootId!, second.bobMemoryActor)).toBeNull();

    const contextCapture = second.contextReadCaptures[0]?.contextRead as {
      manifestIds?: Array<{ contextManifestId: string }>;
      sourceSet?: { policy?: { memoryIds?: string[] }; inputs?: Array<{ kind?: string; memoryId?: string }> };
    } | undefined;
    const manifestId = contextCapture?.manifestIds?.[0]?.contextManifestId;
    if (!contextCapture || !manifestId) throw new Error("The second managed run has no actual Context manifest");
    const selectedItems = await db.select().from(contextManifestItems).where(and(
      eq(contextManifestItems.companyId, first.companyId), eq(contextManifestItems.manifestId, manifestId)));
    const memoryCId = second.toolResults.find(value => value.toolName === "paperclip-self:remember")?.memoryId;
    if (!memoryCId) throw new Error("The second managed run omitted Memory C");
    fixtureCheckpoint = { ...fixtureCheckpoint, memoryCId };
    stage("review_memory_c");
    await memories.reviewCandidate(first.companyId, memoryCId, { decision: "accept" }, second.aliceMemoryActor);
    stage("assign_task_b_to_bob");
    await issueService(db).update(taskBId, { assigneeAgentId: null, assigneeUserId: first.bobUserId,
      actorUserId: first.aliceUserId, privacyActor: second.aliceActor });
    stage("assignment_returned");
    const [assignedTaskB] = await db.select().from(issues).where(and(eq(issues.companyId, first.companyId), eq(issues.id, taskBId)));
    if (!assignedTaskB || assignedTaskB.assigneeUserId !== first.bobUserId)
      throw new Error("The Native Task B assignee transfer was not persisted");
    return { first, second, documentKey, documentKeyB, taskATitle, taskBTitle, taskAId, taskBId, memoryAId, memoryBId,
      privateRootId, memoryCId, contextCapture, selectedItems, manifestId, assignedTaskB };
  }

  beforeAll(async () => {
    fixtureDeadlineAt = new Date(Date.now() + 900_000);
    root = await mkdtemp(join(tmpdir(), "native-payload-temporal-"));
    await chmod(root, 0o700);
    vi.stubEnv("PAPERCLIP_HOME", root);
    instanceId = `native-payload-temporal-${randomUUID()}`;
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", instanceId);
    vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET", `native-payload-temporal-${randomUUID()}-${randomUUID()}`);
    vi.stubEnv("PAPERCLIP_NATIVE_SOURCE_MEMO_DIAGNOSTICS", "1");
    resetNativeSourceMemoDiagnosticsForTest();
    database = await startEmbeddedPostgresTestDatabase("v10-native-payload-temporal-", {
      preserveDataOnFailure: () => preserveDatabaseFailure,
    });
    db = createDb(database.connectionString);
    try { temporal = await buildTemporalFixture(); }
    catch (error) {
      preserveDatabaseFailure = true;
      preserveDebugArtifacts = true;
      await writeFile(join(root, "native-source-failure-checkpoint.json"), JSON.stringify({
        ...fixtureCheckpoint, stage: fixtureStage, dataDir: database.dataDir, instanceId,
        runs: await db.select({ id: heartbeatRuns.id, agentId: heartbeatRuns.agentId,
          companyId: heartbeatRuns.companyId, responsibleUserId: heartbeatRuns.responsibleUserId,
          status: heartbeatRuns.status }).from(heartbeatRuns),
      }, null, 2), { mode: 0o600 });
      console.info("native_temporal_checkpoint_retained", JSON.stringify({ stage: fixtureStage, root, dataDir: database.dataDir }));
      throw error;
    }
  }, 900_000);

  afterEach(async context => {
    if (context.task.result?.state !== "fail") return;
    preserveDatabaseFailure = true;
    preserveDebugArtifacts = true;
    await writeFile(join(root, "native-source-test-failure-checkpoint.json"), JSON.stringify({
      ...fixtureCheckpoint, stage: fixtureStage, testName: context.task.name,
      dataDir: database.dataDir, instanceId,
    }, null, 2), { mode: 0o600 });
  });

  afterAll(async () => {
    await database?.cleanup();
    vi.unstubAllEnvs();
    if (root && !preserveDebugArtifacts) {
      await makeFixtureTreeWritable(root);
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("keeps earlier shared Memory A readable after the same run later reads private Context, while narrowing Memory B", async () => {
    expect(nativeSourceMemoDiagnosticsForTest().siblingToolSourceProofHits).toBeGreaterThan(0);
    expect(nativeSourceMemoDiagnosticsForTest().documentNodeHits).toBeGreaterThan(0);
    expect(nativeSourceMemoDiagnosticsForTest().uncheckedTaskReplays).toBeGreaterThan(0);
    console.info("native_valid_journey_capacity", JSON.stringify({
      maxValidationWork: nativeSourceMemoDiagnosticsForTest().maxValidationWork }));
    expect(nativeSourceMemoDiagnosticsForTest().maxValidationWork).toBeLessThanOrEqual(2048);
    const { first, second, memoryAId, memoryBId } = temporal;
    const memories = memoryService(db);
    const [legacyPrivateRoot] = await db.select({ payloadSourceSnapshot: memoryRecords.payloadSourceSnapshot,
      sourceIssueIds: memoryRecords.sourceIssueIds }).from(memoryRecords).where(and(
      eq(memoryRecords.companyId, first.companyId), eq(memoryRecords.id, first.privateRootId!)));
    expect(legacyPrivateRoot?.payloadSourceSnapshot).toBeNull();
    expect(legacyPrivateRoot?.sourceIssueIds).toContain(first.privateRoot!.issueId);
    const consumerScope = await db.transaction(async rawTx => {
      const sourceDb = rawTx as unknown as typeof db;
      return withReadPinnedNativeTaskSnapshot(sourceDb, second.aliceActor, first.companyId, temporal.taskBId,
        async () => {
          const inherited = activeMemoryTemporalContexts(sourceDb, second.aliceActor, "run", first.runId);
          expect(inherited?.length).toBeGreaterThan(0);
          expect(await canActorReadMemorySources(sourceDb, first.companyId, second.aliceActor, first.privateRootId!)).toBe(true);
          expect(await canActorReadMemorySources(sourceDb, first.companyId, second.bobActor, first.privateRootId!)).toBe(false);
          expect(activeMemoryTemporalContexts(sourceDb, second.aliceActor, "run", first.runId)).toEqual(inherited);
          return true;
        });
    });
    expect(consumerScope).toBe(true);
    expect((await memories.get(first.companyId, memoryAId, second.aliceMemoryActor))?.record.id).toBe(memoryAId);
    expect((await memories.get(first.companyId, memoryAId, second.bobMemoryActor))?.record.id).toBe(memoryAId);
    const [memoryA] = await db.select({ payloadSourceSnapshot: memoryRecords.payloadSourceSnapshot }).from(memoryRecords)
      .where(and(eq(memoryRecords.companyId, first.companyId), eq(memoryRecords.id, memoryAId)));
    const snapshot = nativePayloadSourceSnapshotSchema.parse(memoryA?.payloadSourceSnapshot);
    await expect(assertNativeMemoryOutputSnapshotCurrent(db, { companyId: first.companyId, recordId: memoryAId,
      snapshot, actor: second.bobMemoryActor.authorizationActor })).resolves.toBeUndefined();
    const bobMembershipFilter = and(eq(companyMemberships.companyId, first.companyId),
      eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, first.bobUserId));
    try {
      await db.update(companyMemberships).set({ status: "suspended" }).where(bobMembershipFilter);
      await expect(memories.get(first.companyId, memoryAId, second.bobMemoryActor)).rejects.toMatchObject({ status: 403 });
      await expect(assertNativeMemoryOutputSnapshotCurrent(db, { companyId: first.companyId, recordId: memoryAId,
        snapshot, actor: second.bobMemoryActor.authorizationActor })).rejects.toMatchObject({ status: 403 });
    } finally {
      await db.update(companyMemberships).set({ status: "active" }).where(bobMembershipFilter);
    }
    expect((await memories.get(first.companyId, memoryAId, second.bobMemoryActor))?.record.id).toBe(memoryAId);
    await expect(assertNativeMemoryOutputSnapshotCurrent(db, { companyId: first.companyId, recordId: memoryAId,
      snapshot, actor: second.bobMemoryActor.authorizationActor })).resolves.toBeUndefined();
    expect((await memories.get(first.companyId, memoryBId, second.aliceMemoryActor))?.record.id).toBe(memoryBId);
    expect(await memories.get(first.companyId, memoryBId, second.bobMemoryActor)).toBeNull();
  });

  it("reuses frozen Task structure only inside the same Memory owner prefix and transaction", async () => {
    vi.stubEnv("PAPERCLIP_NATIVE_SOURCE_MEMO_DIAGNOSTICS", "1");
    resetNativeSourceMemoDiagnosticsForTest();
    const { first, second, memoryAId, memoryCId, privateRootId } = temporal;
    let pageProofStore: { transaction: object; proofsByOwnerPrefix: Map<string, Map<string, Set<string>>> } | undefined;
    await db.transaction(async rawTx => {
      const tx = rawTx as unknown as typeof db;
      const ancestorVisit = `frozen-task-snapshot:${first.companyId}:${temporal.taskBId}:snapshot-digest`;
      expect(nativeFrozenTaskMemoWouldIntersectActiveAncestry(new Set([ancestorVisit]), new Set([ancestorVisit]))).toBe(true);
      expect(nativeFrozenTaskMemoWouldIntersectActiveAncestry(new Set([ancestorVisit]), new Set([`${ancestorVisit}:other`]))).toBe(false);
      const parentDescendants = new Set<string>();
      const warmedChildDescendants = new Set([ancestorVisit]);
      addNativeFrozenTaskDescendantClosure(parentDescendants, "frozen-task-snapshot:warmed-child", warmedChildDescendants);
      expect(parentDescendants).toEqual(new Set(["frozen-task-snapshot:warmed-child", ancestorVisit]));
      expect(nativeFrozenTaskMemoWouldIntersectActiveAncestry(new Set([ancestorVisit]), parentDescendants)).toBe(true);
      const store = pageProofStore = { transaction: tx as object,
        proofsByOwnerPrefix: new Map<string, Map<string, Set<string>>>() };
      expect(await canActorReadMemorySources(tx, first.companyId, second.aliceActor, memoryAId!,
        { structuralProofMemoStore: store })).toBe(true);
      const firstPrefix = [...store.proofsByOwnerPrefix.entries()][0];
      expect(firstPrefix).toBeDefined();
      expect(firstPrefix![1].size).toBeGreaterThan(0);

      // The repeated read may reuse only this exact owner’s immutable Task
      // structure; the memory/source owners and live actor ACL are checked
      // again by the existing reader path.
      expect(await canActorReadMemorySources(tx, first.companyId, second.aliceActor, memoryAId!,
        { structuralProofMemoStore: store })).toBe(true);
      expect(store.proofsByOwnerPrefix.size).toBe(1);
      expect([...store.proofsByOwnerPrefix.values()][0]).toBe(firstPrefix![1]);
      expect(nativeSourceMemoDiagnosticsForTest().frozenTaskMemoByKind.task?.hits ?? 0).toBeGreaterThan(0);

      // A different Memory owner in the same physical transaction has a
      // different temporal prefix and must receive an isolated proof set.
      expect(await canActorReadMemorySources(tx, first.companyId, second.aliceActor, memoryCId!,
        { structuralProofMemoStore: store })).toBe(true);
      expect(store.proofsByOwnerPrefix.size).toBe(2);
      expect([...store.proofsByOwnerPrefix.values()][1]).not.toBe(firstPrefix![1]);

      // Completed top-level Memory owner checks share only immutable Task
      // structure. They start independent bounded Native source traversals;
      // the same physical transaction does not accumulate their work budget.
      for (let pass = 0; pass < 3; pass += 1) {
        expect(await canActorReadMemorySources(tx, first.companyId, second.aliceActor, memoryAId!,
          { structuralProofMemoStore: store })).toBe(true);
        expect(await canActorReadMemorySources(tx, first.companyId, second.aliceActor, memoryCId!,
          { structuralProofMemoStore: store })).toBe(true);
      }
      // A completed Alice structural proof must not become an allow result for
      // Bob, even when the same exact Memory owner is checked in this physical
      // transaction. Owner/current-reader ACL evaluation still runs per actor.
      expect(await canActorReadMemorySources(tx, first.companyId, second.bobActor, memoryCId!,
        { structuralProofMemoStore: store })).toBe(false);
      expect(await canActorReadMemorySources(tx, first.companyId, second.bobActor, privateRootId!,
        { structuralProofMemoStore: store })).toBe(false);
      // The sealed union revisits earlier Memory through C's inherited Task.
      // Carried structural pins must retain the nested private owner restriction.
      expect(await canActorReadMemorySourceSet(tx, first.companyId, second.aliceActor,
        [memoryAId!, memoryCId!], undefined, store)).toBe(true);
      expect(await canActorReadMemorySourceSet(tx, first.companyId, second.bobActor,
        [memoryAId!, memoryCId!], undefined, store)).toBe(false);
      // A warm child Task-prefix obligation is a current-owner witness, not
      // an allow result. Editing that retained Task in this same transaction
      // must invalidate the Memory reader, while rollback restores its prefix.
      await tx.execute(sql`savepoint native_scoped_task_owner_mutation`);
      try {
        await tx.update(issues).set({ description: sql`coalesce(${issues.description},'') || ${" Scoped Task owner changed"}` })
          .where(and(eq(issues.companyId, first.companyId), eq(issues.id, temporal.taskBId!)));
        expect(await canActorReadMemorySources(tx, first.companyId, second.aliceActor, memoryCId!,
          { structuralProofMemoStore: store })).toBe(false);
      } finally {
        await tx.execute(sql`rollback to savepoint native_scoped_task_owner_mutation`);
        await tx.execute(sql`release savepoint native_scoped_task_owner_mutation`);
      }
      expect(await canActorReadMemorySources(tx, first.companyId, second.aliceActor, memoryCId!,
        { structuralProofMemoStore: store })).toBe(true);
      expect(await canActorReadMemorySources(tx, first.companyId, second.bobActor, memoryCId!,
        { structuralProofMemoStore: store })).toBe(false);
      expect(await canActorReadMemorySources(tx, first.companyId, second.bobActor, memoryAId!,
        { structuralProofMemoStore: store })).toBe(true);
    });
    const exactTaskHits = nativeSourceMemoDiagnosticsForTest().frozenTaskMemoByKind.task?.hits ?? 0;
    await db.transaction(async rawTx => {
      const tx = rawTx as unknown as typeof db;
      expect(await canActorReadMemorySources(tx, first.companyId, second.aliceActor, memoryAId!,
        { structuralProofMemoStore: pageProofStore })).toBe(true);
    });
    expect(nativeSourceMemoDiagnosticsForTest().frozenTaskMemoByKind.task?.hits ?? 0).toBe(exactTaskHits);
  });

  it("keeps repeated Native output proofs scoped to their exact actor and Memory prefix", async () => {
    const { first, second, memoryAId } = temporal;
    const [run] = await db.select({ runnerProfileJson: heartbeatRuns.runnerProfileJson }).from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.companyId, first.companyId), eq(heartbeatRuns.id, first.runId)));
    const profile = run?.runnerProfileJson && typeof run.runnerProfileJson === "object"
      ? run.runnerProfileJson as Record<string, unknown> : {};
    const receipt = nativeRunInputSourceReceiptSchema.parse(profile.nativeInputSourceReceipt);
    const records = (value: unknown) => Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> =>
      entry !== null && typeof entry === "object" && !Array.isArray(entry)) : [];
    const captures = records(profile.nativeToolResultSourceCaptures);
    const memoryACallId = first.toolResults.find(value => value.memoryId === memoryAId)?.callId;
    if (!memoryACallId) throw new Error("The first Native Memory output has no provider call identity");
    const associations = records(profile.nativeToolCallDispatchAssociations);
    const intents = records(profile.nativeAwModelWireIntents);
    const selected = receipt.dispatches.flatMap(prefix => prefix.inputs.flatMap(source => {
      if (source.kind !== "worker_model_dispatch" && source.kind !== "conversation_model_dispatch") return [];
      const intent = intents.find(value => value.reservationId === source.reservationId &&
        Array.isArray(value.responseToolUses) && (value.responseToolUses as unknown[]).some(use =>
          use && typeof use === "object" && (use as Record<string, unknown>).id === memoryACallId));
      const use = intent && (intent.responseToolUses as Array<Record<string, unknown>>)
        .find(value => value.id === memoryACallId && captures.some(entry => entry.callId === value.id && typeof entry.tool === "string" &&
          (entry.source as Record<string, unknown> | undefined)?.kind === "tool_result" &&
          (entry.source as Record<string, unknown>).invocationId));
      const result = use && captures.find(entry => entry.callId === memoryACallId && entry.callId === use.id && typeof entry.tool === "string" &&
        (entry.source as Record<string, unknown> | undefined)?.kind === "tool_result" &&
        (entry.source as Record<string, unknown>).invocationId);
      const association = result && associations.find(value => value.callId === result.callId && value.tool === result.tool);
      const consumed = intent?.consumedSourceSet && typeof intent.consumedSourceSet === "object"
        ? intent.consumedSourceSet as Record<string, unknown> : null;
      if (!intent || !result || !association || !consumed || !Array.isArray(consumed.inputs) ||
        !consumed.policy || typeof consumed.policy !== "object" || !Array.isArray(intent.consumedSourceComponents)) return [];
      return [{ dispatch: source, result, intent, association, consumed }];
    })).at(-1);
    if (!selected) throw new Error("The first Native run has no invocation-bound output capture");
    const capture = { runId: first.runId,
      sourceSet: { policy: selected.consumed.policy, inputs: selected.consumed.inputs },
      consumedSourceComponents: selected.intent.consumedSourceComponents,
      dispatch: selected.dispatch,
      managedOpenCodeToolUse: { callId: selected.result.callId, toolName: selected.result.tool,
        argumentsHash: selected.association.argumentsHash,
        responseContentHash: selected.intent.responseContentHash } } as Parameters<typeof assertNativeModelOutputCaptureCurrent>[3];
    const documentSource = capture.sourceSet.inputs.find((source): source is Extract<(typeof capture.sourceSet.inputs)[number],
      { kind: "document_revision" }> => source.kind === "document_revision");
    if (!documentSource?.issueId) throw new Error("The Memory A capture has no document-backed source owner");
    const [documentRevision] = await db.select({ payloadSourceSnapshot: documentRevisions.payloadSourceSnapshot })
      .from(documentRevisions).where(and(eq(documentRevisions.companyId, first.companyId),
        eq(documentRevisions.id, documentSource.revisionId)));
    const documentSnapshot = nativePayloadSourceSnapshotSchema.parse(documentRevision?.payloadSourceSnapshot);
    const invocationSource = documentSnapshot.inputs.find((source): source is Extract<typeof source, { kind: "tool_result" }> =>
      source.kind === "tool_result" && typeof source.invocationId === "string" &&
      capture.sourceSet.inputs.some(candidate => JSON.stringify(candidate) === JSON.stringify(source)));
    if (!invocationSource || typeof invocationSource.invocationId !== "string")
      throw new Error("The captured document does not bind a prior invocation in the Native output source prefix");
    const invocationId = invocationSource.invocationId;
    const contractSource = capture.sourceSet.inputs.find((source): source is Extract<typeof source, { kind: "completion_contract" }> =>
      source.kind === "completion_contract");
    if (!contractSource) throw new Error("The real Memory A capture has no completion contract dependency");
    const [contract] = await db.select().from(completionContracts).where(and(
      eq(completionContracts.companyId, first.companyId), eq(completionContracts.id, contractSource.contractId)));
    if (!contract) throw new Error("The captured Native completion contract disappeared");
     const aliceMembershipFilter = and(eq(companyMemberships.companyId, first.companyId),
      eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, first.aliceUserId));
    await db.transaction(async rawTx => {
      const tx = rawTx as unknown as typeof db;
      const memoryARead = await withReadMemoryTemporalSources(tx, second.aliceActor, first.companyId, memoryAId!,
        async sourceDb => {
        await assertNativeModelOutputCaptureCurrent(sourceDb, first.companyId, first.issueId, capture,
          selected.result.tool as string, second.aliceActor, "settled");

        // Removing one exact nested owner from the live cover cannot borrow
        // the warmed structural proof for a different or incomplete closure.
        const incompleteCapture = { ...capture, sourceSet: { ...capture.sourceSet,
          inputs: capture.sourceSet.inputs.filter(value => JSON.stringify(value) !== JSON.stringify(invocationSource)) } };
        await expect(assertNativeModelOutputCaptureCurrent(sourceDb, first.companyId, first.issueId, incompleteCapture,
          selected.result.tool as string, second.aliceActor, "settled")).rejects.toMatchObject({ status: 403 });

        // The exact proof is warm in this same Native scope and physical
        // transaction. A changed current invocation must still deny the hit.
        await sourceDb.update(toolInvocations).set({ status: "failed" }).where(and(
          eq(toolInvocations.companyId, first.companyId), eq(toolInvocations.id, invocationId)));
        await expect(assertNativeModelOutputCaptureCurrent(sourceDb, first.companyId, first.issueId, capture,
          selected.result.tool as string, second.aliceActor, "settled")).rejects.toMatchObject({ status: 403 });
        await sourceDb.update(toolInvocations).set({ status: "succeeded" }).where(and(
          eq(toolInvocations.companyId, first.companyId), eq(toolInvocations.id, invocationId)));
        await expect(assertNativeModelOutputCaptureCurrent(sourceDb, first.companyId, first.issueId, capture,
          selected.result.tool as string, second.aliceActor, "settled")).resolves.toBeUndefined();

        // A completed Task proof must also recheck its exact contract owner.
        try {
          await sourceDb.update(completionContracts).set({ revision: contract.revision + 1 }).where(and(
            eq(completionContracts.companyId, first.companyId), eq(completionContracts.id, contract.id)));
          await expect(assertNativeModelOutputCaptureCurrent(sourceDb, first.companyId, first.issueId, capture,
            selected.result.tool as string, second.aliceActor, "settled")).rejects.toMatchObject({ status: 403 });
        } finally {
          await sourceDb.update(completionContracts).set({ revision: contract.revision }).where(and(
            eq(completionContracts.companyId, first.companyId), eq(completionContracts.id, contract.id)));
        }
        await expect(assertNativeModelOutputCaptureCurrent(sourceDb, first.companyId, first.issueId, capture,
          selected.result.tool as string, second.aliceActor, "settled")).resolves.toBeUndefined();

        // A producer receipt can also change inside this transaction. A
        // warmed proof must reload the exact current run before it is reused.
        await sourceDb.update(heartbeatRuns).set({ runnerProfileJson: {
          ...profile, nativeInputSourceReceipt: null,
        } }).where(and(eq(heartbeatRuns.companyId, first.companyId), eq(heartbeatRuns.id, first.runId)));
        await expect(assertNativeModelOutputCaptureCurrent(sourceDb, first.companyId, first.issueId, capture,
          selected.result.tool as string, second.aliceActor, "settled")).rejects.toMatchObject({ status: 403 });
        await sourceDb.update(heartbeatRuns).set({ runnerProfileJson: profile }).where(and(
          eq(heartbeatRuns.companyId, first.companyId), eq(heartbeatRuns.id, first.runId)));

        // Revoking Alice inside the same transaction cannot reuse her warmed
        // output proof; the live reader check must reject before it is returned.
        await sourceDb.update(companyMemberships).set({ status: "suspended" }).where(aliceMembershipFilter);
        await expect(assertNativeModelOutputCaptureCurrent(sourceDb, first.companyId, first.issueId, capture,
          selected.result.tool as string, second.aliceActor, "settled")).rejects.toMatchObject({ status: 403 });
        await sourceDb.update(companyMemberships).set({ status: "active" }).where(aliceMembershipFilter);
      });
      expect(memoryARead).not.toBe(false);
      // A different persisted Memory owner prefix in this physical transaction
      // receives an independent scope and cannot reuse Memory A's proof.
      const memoryBRead = await withReadMemoryTemporalSources(tx, second.aliceActor, first.companyId, temporal.memoryBId!,
        async sourceDb => assertNativeModelOutputCaptureCurrent(sourceDb, first.companyId, first.issueId, capture,
          selected.result.tool as string, second.aliceActor, "settled"));
      expect(memoryBRead).not.toBe(false);
    });
    // Timestamp-only owner changes must invalidate private structural row
    // fingerprints even though the canonical contract revision/hash is stable.
    await db.transaction(async rawTx => {
      const tx = rawTx as unknown as typeof db;
      const store: MemoryPageStructuralProofMemoStore = { transaction: tx as object, proofsByOwnerPrefix: new Map() };
      const contractDigests = () => {
        const digests = new Map<string, string>();
        for (const [owner, proofs] of store.mutableSourceProofsByOwnerPrefix ?? []) for (const [key, proof] of proofs) {
          const dependency = proof.rows.get(`contract:${first.companyId}:${contract.id}`);
          if (dependency) digests.set(`${owner}:${key}`, dependency.digest);
        }
        return digests;
      };
      expect(await withReadMemoryTemporalSources(tx, second.aliceActor, first.companyId, memoryAId!, async sourceDb => {
        await assertNativeModelOutputCaptureCurrent(sourceDb, first.companyId, first.issueId, capture,
          selected.result.tool as string, second.aliceActor, "settled");
        const before = contractDigests();
        expect(before.size).toBeGreaterThan(0);
        let changedProof: string | undefined;
        try {
          await sourceDb.update(completionContracts).set({ createdAt: new Date(contract.createdAt.getTime() + 1_000) })
            .where(and(eq(completionContracts.companyId, first.companyId), eq(completionContracts.id, contract.id)));
          await expect(assertNativeModelOutputCaptureCurrent(sourceDb, first.companyId, first.issueId, capture,
            selected.result.tool as string, second.aliceActor, "settled")).resolves.toBeUndefined();
          changedProof = [...contractDigests()].find(([key, digest]) => before.has(key) && before.get(key) !== digest)?.[0];
          expect(changedProof).toBeDefined();
        } finally {
          await sourceDb.update(completionContracts).set({ createdAt: contract.createdAt })
            .where(and(eq(completionContracts.companyId, first.companyId), eq(completionContracts.id, contract.id)));
        }
        await expect(assertNativeModelOutputCaptureCurrent(sourceDb, first.companyId, first.issueId, capture,
          selected.result.tool as string, second.aliceActor, "settled")).resolves.toBeUndefined();
        if (!changedProof) throw new Error("The timestamp-only contract fingerprint did not change");
        expect(contractDigests().get(changedProof)).toBe(before.get(changedProof));
      }, undefined, store)).not.toBe(false);
    });
    // A private pending Task reader must finish before an external callback
    // can perform an effect. Revoke the real represented Human immediately at
    // its actual deferred Task ACL query, then run the original SQL checker.
    await db.transaction(async rawTx => {
      const tx = rawTx as unknown as typeof db;
      const [memory] = await tx.select({ snapshot: memoryRecords.payloadSourceSnapshot }).from(memoryRecords)
        .where(and(eq(memoryRecords.companyId, first.companyId), eq(memoryRecords.id, memoryAId!)));
      const snapshot = nativePayloadSourceSnapshotSchema.parse(memory?.snapshot);
      const actualTaskReader = authorizationChecks.canActorReadPinnedIssuePrivacyBatch;
      let revoked = false;
      let callbackRan = false;
      let foreignProbeEntered = false;
      let foreignCallbackRan = false;
      const adoptions = nativeSourceMemoDiagnosticsForTest().pendingTaskAdoptions;
      const taskReader = vi.spyOn(authorizationChecks, "canActorReadPinnedIssuePrivacyBatch")
        .mockImplementation(async (...args) => {
          const actor = args[1];
          const representedAlice = actor.userId === first.aliceUserId || actor.onBehalfOfUserId === first.aliceUserId;
          if (!revoked && !foreignProbeEntered && representedAlice && args[2] === first.companyId &&
              args[3].some(task => task.issueId === temporal.taskAId)) {
            expect(args[0]).toBe(tx);
            if (!foreignProbeEntered) {
              foreignProbeEntered = true;
              await rawTx.transaction(async foreignTx => {
                expect(foreignTx).not.toBe(rawTx);
                await expect(withNativeMemoryOutputSnapshotCurrent(foreignTx as unknown as typeof db,
                  { companyId: first.companyId, recordId: memoryAId!, snapshot, actor: second.aliceActor },
                  async sourceDb => {
                    expect(sourceDb).toBe(foreignTx);
                    foreignCallbackRan = true;
                  })).rejects.toMatchObject({ status: 403,
                    message: "The Native pending Task check cannot enter an effect" });
              });
            }
            revoked = true;
            await tx.update(companyMemberships).set({ status: "suspended" }).where(aliceMembershipFilter);
          }
          return actualTaskReader(...args);
        });
      try {
        await expect(withNativeMemoryOutputSnapshotCurrent(tx, { companyId: first.companyId,
          recordId: memoryAId!, snapshot, actor: second.aliceActor }, async sourceDb => {
          expect(sourceDb).toBe(tx);
          callbackRan = true;
        })).rejects.toMatchObject({ status: 403 });
        expect(revoked).toBe(true);
        expect(foreignProbeEntered).toBe(true);
        expect(foreignCallbackRan).toBe(false);
        expect(callbackRan).toBe(false);
        expect(nativeSourceMemoDiagnosticsForTest().pendingTaskAdoptions).toBeGreaterThan(adoptions);
      } finally {
        taskReader.mockRestore();
        await tx.update(companyMemberships).set({ status: "active" }).where(aliceMembershipFilter);
      }
      await expect(withNativeMemoryOutputSnapshotCurrent(tx, { companyId: first.companyId,
        recordId: memoryAId!, snapshot, actor: second.aliceActor }, async sourceDb => {
        expect(sourceDb).toBe(tx);
        callbackRan = true;
      })).resolves.toBeUndefined();
      expect(callbackRan).toBe(true);
    });

    // An external callback can write owner families outside the four receipt
    // dependencies. Warm a real Comment prefix, edit it in this same physical
    // transaction, and require the original rendition to be rejected.
    await db.transaction(async rawTx => {
      const tx = rawTx as unknown as typeof db;
      const [memory] = await tx.select().from(memoryRecords).where(and(
        eq(memoryRecords.companyId, first.companyId), eq(memoryRecords.id, memoryAId!)));
      const snapshot = nativePayloadSourceSnapshotSchema.parse(memory?.payloadSourceSnapshot);
      await withNativeMemoryOutputSnapshotCurrent(tx, { companyId: first.companyId, recordId: memoryAId!,
        snapshot, actor: second.aliceActor }, async sourceDb => {
        const comment = await issueService(sourceDb as typeof db).addComment(first.issueId, "Callback owner before edit",
          { userId: first.aliceUserId }, { manualInputActor: first.aliceActor });
        const [stored] = await sourceDb.select({ sourceVersion: sql<string>`extract(epoch from ${issueComments.updatedAt})::text` })
          .from(issueComments).where(eq(issueComments.id, comment.id));
        if (!stored) throw new Error("The callback Comment owner disappeared");
        const source = { kind: "comment" as const, issueId: first.issueId, commentId: comment.id,
          sourceVersion: stored.sourceVersion, contentHash: nativeCommentProjectionHash(comment) };
        const policy = { issueIds: [first.issueId], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] };
        const augmented = { ...receipt, additionalInputs: [...receipt.additionalInputs,
          { policy, inputs: [source], responsibleUserId: first.aliceUserId }] };
        const { digest: _digest, ...receiptBody } = augmented;
        const updatedProfile = { ...profile, nativeInputSourceReceipt: { ...receiptBody, digest: nativeSha256(receiptBody) } };
        await sourceDb.update(heartbeatRuns).set({ runnerProfileJson: updatedProfile }).where(and(
          eq(heartbeatRuns.companyId, first.companyId), eq(heartbeatRuns.id, first.runId)));
        const validate = () => assertNativePayloadSourceSetCurrent(sourceDb, { companyId: first.companyId,
          issueId: first.issueId, runId: first.runId, actor: second.aliceActor, policy, inputs: [source] });
        try {
          await expect(validate()).resolves.toBeUndefined();
          // Entering a callback-free nested reviewer cannot revive checkpoints
          // disabled by this outer effect-capable callback.
          expect(await canActorReadMemorySourceSet(sourceDb as typeof db, first.companyId,
            second.aliceActor, [memoryAId!])).toBe(true);
          await expect(validate()).resolves.toBeUndefined();
          await sourceDb.execute(sql`savepoint native_callback_comment_mutation`);
          try {
            await sourceDb.update(issueComments).set({ body: "Callback owner after edit" }).where(eq(issueComments.id, comment.id));
            await expect(validate()).rejects.toMatchObject({ status: 403 });
          } finally {
            await sourceDb.execute(sql`rollback to savepoint native_callback_comment_mutation`);
            await sourceDb.execute(sql`release savepoint native_callback_comment_mutation`);
          }
          await expect(validate()).resolves.toBeUndefined();
        } finally {
          await sourceDb.update(heartbeatRuns).set({ runnerProfileJson: profile }).where(and(
            eq(heartbeatRuns.companyId, first.companyId), eq(heartbeatRuns.id, first.runId)));
        }
      });
    });
    // Memory C inherited Task B's earlier producer. A fresh public validation
    // in this same physical transaction must reload that historical receipt.
    const [followupRun] = await db.select({ runnerProfileJson: heartbeatRuns.runnerProfileJson }).from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.companyId, first.companyId), eq(heartbeatRuns.id, second.runId)));
    const followupProfile = followupRun?.runnerProfileJson as Record<string, unknown>;
    const followupReceipt = nativeRunInputSourceReceiptSchema.parse(followupProfile.nativeInputSourceReceipt);
    const memoryCCallId = second.toolResults.find(value => value.memoryId === temporal.memoryCId)?.callId;
    const followupResult = records(followupProfile.nativeToolResultSourceCaptures).find(value => value.callId === memoryCCallId);
    const followupAssociation = records(followupProfile.nativeToolCallDispatchAssociations).find(value => value.callId === memoryCCallId);
    const followupIntent = records(followupProfile.nativeAwModelWireIntents).find(value =>
      records(value.responseToolUses).some(use => use.id === memoryCCallId));
    const followupDispatch = followupReceipt.dispatches.flatMap(prefix => prefix.inputs).find(source =>
      (source.kind === "worker_model_dispatch" || source.kind === "conversation_model_dispatch") &&
      source.reservationId === followupIntent?.reservationId);
    if (!followupResult || !followupAssociation || !followupIntent || !followupDispatch)
      throw new Error("The real Memory C output lacks its settled follow-up producer capture");
    const followupCapture = { runId: second.runId, dispatch: followupDispatch,
      sourceSet: followupIntent.consumedSourceSet, consumedSourceComponents: followupIntent.consumedSourceComponents,
      managedOpenCodeToolUse: { callId: memoryCCallId, toolName: followupResult.tool,
        argumentsHash: followupAssociation.argumentsHash, responseContentHash: followupIntent.responseContentHash } } as Parameters<typeof assertNativeModelOutputCaptureCurrent>[3];
    await db.transaction(async rawTx => {
      const tx = rawTx as unknown as typeof db;
      expect(await withReadMemoryTemporalSources(tx, second.aliceActor, first.companyId, temporal.memoryCId!, async sourceDb => {
        await assertNativeModelOutputCaptureCurrent(sourceDb, first.companyId, second.issueId, followupCapture,
          followupResult.tool as string, second.aliceActor, "settled");
        try {
          await sourceDb.update(heartbeatRuns).set({ runnerProfileJson: { ...profile, nativeInputSourceReceipt: null } })
            .where(and(eq(heartbeatRuns.companyId, first.companyId), eq(heartbeatRuns.id, first.runId)));
          await expect(assertNativeModelOutputCaptureCurrent(sourceDb, first.companyId, second.issueId, followupCapture,
            followupResult.tool as string, second.aliceActor, "settled")).rejects.toMatchObject({ status: 403 });
        } finally {
          await sourceDb.update(heartbeatRuns).set({ runnerProfileJson: profile })
            .where(and(eq(heartbeatRuns.companyId, first.companyId), eq(heartbeatRuns.id, first.runId)));
        }
        await expect(assertNativeModelOutputCaptureCurrent(sourceDb, first.companyId, second.issueId, followupCapture,
          followupResult.tool as string, second.aliceActor, "settled")).resolves.toBeUndefined();
      })).not.toBe(false);
    });
  });

  it("keeps earlier Task A readable while later Task B retains the private source", async () => {
    const { first, second, taskAId, taskBId, assignedTaskB } = temporal;
    const [run] = await db.select({ runnerProfileJson: heartbeatRuns.runnerProfileJson }).from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.companyId, first.companyId), eq(heartbeatRuns.id, first.runId)));
    const profile = run?.runnerProfileJson && typeof run.runnerProfileJson === "object"
      ? run.runnerProfileJson as Record<string, unknown> : {};
    const modelCalls = Array.isArray(profile.nativeAwModelWireIntents)
      ? profile.nativeAwModelWireIntents.filter(value => value && typeof value === "object") as Array<Record<string, unknown>> : [];
    expect(modelCalls.length).toBeGreaterThan(0);
    expect(modelCalls.every(value => value.modelPurpose === "worker_model")).toBe(true);
    const [taskA] = await db.select().from(issues).where(and(eq(issues.companyId, first.companyId), eq(issues.id, taskAId)));
    const [taskB] = await db.select().from(issues).where(and(eq(issues.companyId, first.companyId), eq(issues.id, taskBId)));
    expect(taskA).toBeDefined();
    expect(taskB).toBeDefined();
    expect(taskA).toMatchObject({ status: "backlog", parentId: null });
    expect(taskB).toMatchObject({ status: "backlog", parentId: null });
    expect(await canActorReadIssuePrivacy(db, second.bobActor, taskA!)).toBe(true);
    expect(await canActorReadIssuePrivacy(db, second.aliceActor, taskB!)).toBe(true);
    expect(assignedTaskB.assigneeUserId).toBe(first.bobUserId);
    expect(await canActorReadIssuePrivacy(db, second.bobActor, assignedTaskB)).toBe(false);

    // This trusted fixture copies a real retained Task closure; every clone
    // still binds its own actual SQL owner hash and canonical snapshot digest.
    // One copy must work before a finite, otherwise-valid graph hits the work
    // envelope. Neither input cardinality nor component/depth limits mask it.
    const rollback = new Error("rollback Native capacity fixture");
    await expect(db.transaction(async rawTx => {
      const tx = rawTx as unknown as typeof db;
      const sourceSnapshot = nativePayloadSourceSnapshotSchema.parse(taskB!.payloadSourceSnapshot);
      const copies = await tx.insert(issues).values(Array.from({ length: 64 }, () => ({
        ...taskB!, id: randomUUID(), identifier: null, issueNumber: null,
        checkoutRunId: null, executionRunId: null,
        payloadSourceSnapshot: null,
      }))).returning({ id: issues.id });
      const originalEdges = await tx.select().from(issuePrivacySources).where(and(
        eq(issuePrivacySources.companyId, first.companyId), eq(issuePrivacySources.issueId, taskB!.id)));
      expect(originalEdges.length).toBeGreaterThan(0);
      for (const copy of copies) await tx.insert(issuePrivacySources).values(originalEdges.map(edge => ({
        ...edge, id: randomUUID(), issueId: copy.id,
      }))).onConflictDoNothing();
      const sources: Extract<NativePayloadSourceInput, { kind: "task" }>[] = [];
      for (const copy of copies) {
        const { digest: _digest, ...body } = sourceSnapshot;
        const snapshot = { ...body, owner: { ...body.owner, id: copy.id } };
        const [sealed] = await tx.update(issues).set({ payloadSourceSnapshot: sql`(select value || jsonb_build_object(
          'digest',encode(sha256(convert_to(value::text,'UTF8')),'hex'))
          from (select ${JSON.stringify(snapshot)}::jsonb as value) supplied)` }).where(eq(issues.id, copy.id))
          .returning({ sourceVersion: issues.updatedAt });
        expect(sealed).toBeDefined();
        sources.push({ kind: "task", issueId: copy.id, sourceVersion: sealed!.sourceVersion.toISOString(),
          contentHash: sourceSnapshot.owner.contentHash });
      }
      const components = sources.map(source => ({ kind: "additional_input" as const,
        responsibleUserId: first.aliceUserId,
        policy: { issueIds: [source.issueId], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] },
        inputs: [source],
      }));
      const receipt = nativeRunInputSourceReceiptSchema.parse(profile.nativeInputSourceReceipt);
      const { digest: _digest, ...receiptBody } = { ...receipt,
        additionalInputs: [...receipt.additionalInputs, ...components.map(({ kind: _kind, ...set }) => set)] };
      expect(receiptBody.additionalInputs.length).toBeLessThanOrEqual(256);
      const [sealedReceipt] = await tx.execute<{ receipt: unknown }>(sql`select value || jsonb_build_object(
        'digest',encode(sha256(convert_to(value::text,'UTF8')),'hex')) as receipt
        from (select ${JSON.stringify(receiptBody)}::jsonb as value) supplied`);
      const augmentedReceipt = nativeRunInputSourceReceiptSchema.parse(sealedReceipt!.receipt);
      await tx.update(heartbeatRuns).set({ runnerProfileJson: { ...profile,
        nativeInputSourceReceipt: augmentedReceipt } })
        .where(and(eq(heartbeatRuns.companyId, first.companyId), eq(heartbeatRuns.id, first.runId)));
      const validate = (selected: typeof components) => assertNativeManagedConsumedSourceSetCurrent(tx, {
        companyId: first.companyId, issueId: first.issueId, runId: first.runId, actor: second.aliceActor,
        components: selected,
        sourceSet: { policy: { issueIds: selected.map(value => value.inputs[0]!.issueId).sort(),
          projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] },
          inputs: selected.flatMap(value => value.inputs) },
      });
      await expect(validate(components.slice(0, 1))).resolves.toBeUndefined();
      expect(components).toHaveLength(64);
      expect(components.flatMap(value => value.inputs)).toHaveLength(64);
      await expect(validate(components)).rejects.toMatchObject({ status: 403,
        message: "The Native source graph exceeds its total-work bound" });
      throw rollback;
    })).rejects.toBe(rollback);
  }, 120_000);

  it("keeps document A independent while document B carries the later private Context source", async () => {
    const { first, second, documentKey, documentKeyB, privateRootId } = temporal;
    expect(first.documents).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: documentKey, aliceHttpStatus: 200, bobHttpStatus: 200 }),
      expect.objectContaining({ key: documentKeyB, aliceHttpStatus: 200, bobHttpStatus: 403 }),
    ]));
    const [documentA] = await db.select().from(issueDocuments).where(and(
      eq(issueDocuments.companyId, first.companyId), eq(issueDocuments.issueId, first.issueId), eq(issueDocuments.key, documentKey)));
    const [documentB] = await db.select().from(issueDocuments).where(and(
      eq(issueDocuments.companyId, first.companyId), eq(issueDocuments.issueId, first.issueId), eq(issueDocuments.key, documentKeyB)));
    if (!documentA || !documentB) throw new Error("The managed Native document outputs disappeared");
    const [revisionA] = await db.select().from(documentRevisions).where(and(
      eq(documentRevisions.companyId, first.companyId), eq(documentRevisions.documentId, documentA.documentId)));
    const [revisionB] = await db.select().from(documentRevisions).where(and(
      eq(documentRevisions.companyId, first.companyId), eq(documentRevisions.documentId, documentB.documentId)));
    if (!revisionA || !revisionB) throw new Error("The managed Native document revisions disappeared");
    expect(nativePayloadSourceSnapshotSchema.parse(revisionA.payloadSourceSnapshot).policy.memoryIds).not.toContain(privateRootId);
    expect(nativePayloadSourceSnapshotSchema.parse(revisionB.payloadSourceSnapshot).policy.memoryIds).toContain(privateRootId);
    await expect(assertNativeDocumentRevisionCurrentSourceAccess(db, { companyId: first.companyId,
      issueId: first.issueId, revisionId: revisionA.id, actor: second.bobActor, requireLatest: true })).resolves.toBeUndefined();
    await expect(assertNativeDocumentRevisionCurrentSourceAccess(db, { companyId: first.companyId,
      issueId: first.issueId, revisionId: revisionB.id, actor: second.bobActor, requireLatest: true })).rejects.toMatchObject({ status: 403 });

    // A later Run's document retains earlier dispatches while its exact
    // constructor-appended marker and revision writer identify one producer.
    const followupCapture = (second.toolResultSourceCaptures as Array<Record<string, unknown>>).find(value =>
      value.tool === "write_document" && value.documentRevision && typeof value.documentRevision === "object");
    const documentC = followupCapture?.documentRevision as { revisionId: string; issueId: string } | undefined;
    if (!documentC) throw new Error("The follow-up Run has no actual document capture");
    const [revisionC] = await db.select().from(documentRevisions).where(and(
      eq(documentRevisions.companyId, first.companyId), eq(documentRevisions.id, documentC.revisionId)));
    if (!revisionC) throw new Error("The follow-up Native document revision disappeared");
    const snapshotC = nativePayloadSourceSnapshotSchema.parse(revisionC.payloadSourceSnapshot);
    const dispatches = snapshotC.inputs.filter(source =>
      source.kind === "worker_model_dispatch" || source.kind === "conversation_model_dispatch");
    expect(new Set(dispatches.map(source => source.runId))).toEqual(new Set([first.runId, second.runId]));
    expect(snapshotC.inputs.at(-1)).toMatchObject({ runId: second.runId });
    expect(revisionC.createdByRunId).toBe(second.runId);
    const validateC = (sourceDb: typeof db) => assertNativeDocumentRevisionCurrentSourceAccess(sourceDb,
      { companyId: first.companyId, issueId: documentC.issueId, revisionId: revisionC.id, actor: second.aliceActor });
    await expect(validateC(db)).resolves.toBeUndefined();
    await expect(assertNativeDocumentRevisionCurrentSourceAccess(db, { companyId: first.companyId,
      issueId: documentC.issueId, revisionId: revisionC.id, actor: second.bobActor })).rejects.toMatchObject({ status: 403 });
    await db.transaction(async rawTx => {
      const tx = rawTx as unknown as typeof db;
      await tx.execute(sql`savepoint native_document_wrong_writer`);
      try {
        const earlier = nativeRunInputSourceReceiptSchema.parse(first.sourceReceipt).dispatches
          .flatMap(prefix => prefix.inputs).find(source =>
            (source.kind === "worker_model_dispatch" || source.kind === "conversation_model_dispatch") &&
            source.runId === first.runId && !snapshotC.inputs.some(value => nativeSha256(value) === nativeSha256(source)));
        expect(earlier).toBeDefined();
        const { digest: _digest, ...body } = snapshotC;
        const wrongFinalWriter = { ...body, inputs: [...snapshotC.inputs, earlier!] };
        expect(nativePayloadSourceSnapshotSchema.safeParse({ ...wrongFinalWriter, digest: snapshotC.digest }).success).toBe(true);
        await tx.update(documentRevisions).set({ payloadSourceSnapshot: sql`(select value || jsonb_build_object(
          'digest',encode(sha256(convert_to(value::text,'UTF8')),'hex'))
          from (select ${JSON.stringify(wrongFinalWriter)}::jsonb as value) supplied)` }).where(eq(documentRevisions.id, revisionC.id));
        await expect(validateC(tx)).rejects.toMatchObject({ status: 403,
          message: "The Native document source has ambiguous model dispatches" });
      } finally {
        await tx.execute(sql`rollback to savepoint native_document_wrong_writer`);
        await tx.execute(sql`release savepoint native_document_wrong_writer`);
      }
      await expect(validateC(tx)).resolves.toBeUndefined();
      const [run] = await tx.select({ profile: heartbeatRuns.runnerProfileJson }).from(heartbeatRuns)
        .where(and(eq(heartbeatRuns.companyId, first.companyId), eq(heartbeatRuns.id, second.runId)));
      const profile = run?.profile as Record<string, unknown>;
      const captures = profile.nativeToolResultSourceCaptures as Array<Record<string, unknown>>;
      try {
        await tx.update(heartbeatRuns).set({ runnerProfileJson: { ...profile,
          nativeToolResultSourceCaptures: [...captures, followupCapture] } }).where(eq(heartbeatRuns.id, second.runId));
        await expect(validateC(tx)).rejects.toMatchObject({ status: 403 });
      } finally {
        await tx.update(heartbeatRuns).set({ runnerProfileJson: profile }).where(eq(heartbeatRuns.id, second.runId));
      }
      await expect(validateC(tx)).resolves.toBeUndefined();
    });
  });

  it("carries private Context lineage into fresh Context and Memory C without a direct root Memory item", async () => {
    const { first, second, privateRootId, taskBId, memoryCId, contextCapture, selectedItems } = temporal;
    expect(second.issueId).toBe(taskBId);
    expect(selectedItems).toEqual(expect.arrayContaining([expect.objectContaining({
      sourceProvider: "august_works_tasks", sourceRef: `issue://${taskBId}`,
    })]));
    expect(selectedItems.some(item => item.sourceProvider === "august_works_memory" && item.sourceRef === `memory://record/${privateRootId}`))
      .toBe(false);
    expect(contextCapture.sourceSet?.policy?.memoryIds).toContain(privateRootId);
    expect(contextCapture.sourceSet?.inputs?.some(source => source.kind === "context")).toBe(true);
    expect(contextCapture.manifestIds?.[0]?.contextManifestId).toMatch(/^[0-9a-f-]{36}$/i);
    const memories = memoryService(db);
    expect((await memories.get(first.companyId, memoryCId, second.aliceMemoryActor))?.record.id).toBe(memoryCId);
    expect(await memories.get(first.companyId, memoryCId, second.bobMemoryActor)).toBeNull();
  });

  it("replays only a current Native Memory output when its input roots remain readable", async () => {
    const { first, second, memoryBId, memoryCId, privateRootId, taskBId } = temporal;
    const memories = memoryService(db);
    const verifyReceipt = async (producer: typeof first, callId: string, recordId: string, expectStoredResult = true) => {
      const [invocation] = await db.select().from(toolInvocations).where(and(
        eq(toolInvocations.companyId, producer.companyId), eq(toolInvocations.runId, producer.runId),
        eq(toolInvocations.idempotencyKey, `aw-native-tool:${producer.runId}:${callId}`),
        eq(toolInvocations.toolName, "paperclip-self:remember")));
      expect(invocation).toBeDefined();
      const result = invocation?.workflowResultJson;
      if (expectStoredResult) {
        expect(result).toMatchObject({ data: { record: { id: recordId } } });
        const [output] = await db.select({ payloadSourceSnapshot: memoryRecords.payloadSourceSnapshot }).from(memoryRecords)
          .where(and(eq(memoryRecords.companyId, producer.companyId), eq(memoryRecords.id, recordId)));
        const snapshot = nativePayloadSourceSnapshotSchema.parse(output?.payloadSourceSnapshot);
        await expect(assertNativeMemoryOutputSnapshotCurrent(db, { companyId: producer.companyId, recordId,
          snapshot, actor: second.aliceMemoryActor.authorizationActor })).resolves.toBeUndefined();
      }
      await db.transaction(async rawTx => {
        const tx = rawTx as unknown as typeof db;
        await lockAnalyticalCompany(tx, producer.companyId);
        await lockMemoryPrivacy(tx, producer.companyId);
        await assertScopedNativeMemoryReplayReceiptCurrent(tx, { companyId: producer.companyId,
          runId: producer.runId, agentId: producer.agentId, issueId: producer.issueId, callId,
          invocationId: invocation!.id, argumentsHash: invocation!.argumentsHash!, result });
      });
      return invocation!;
    };

    const memoryBCallId = first.toolResults.find(value => value.memoryId === memoryBId)?.callId;
    if (!memoryBCallId) throw new Error("The Native Memory B call receipt is unavailable");
    await verifyReceipt(first, memoryBCallId, memoryBId);
    expect((await memories.get(first.companyId, privateRootId, second.aliceMemoryActor))?.record.id).toBe(privateRootId);
    await memories.revoke(first.companyId, memoryBId, { reason: "The Human revoked this output." }, second.aliceMemoryActor);
    expect((await memories.get(first.companyId, privateRootId, second.aliceMemoryActor))?.record.id).toBe(privateRootId);
    await expect(verifyReceipt(first, memoryBCallId, memoryBId, false)).rejects.toMatchObject({
      reasonCode: "native_memory_capture_invalid",
    });

    await verifyReceipt(second, second.toolResults.find(value => value.memoryId === memoryCId)!.callId, memoryCId);
    expect(await canActorReadIssuePrivacy(db, second.aliceActor, { companyId: first.companyId, id: taskBId })).toBe(true);
    await memories.forget(first.companyId, memoryCId, second.aliceMemoryActor);
    expect(await canActorReadIssuePrivacy(db, second.aliceActor, { companyId: first.companyId, id: taskBId })).toBe(true);
    await expect(verifyReceipt(second, second.toolResults.find(value => value.memoryId === memoryCId)!.callId, memoryCId, false))
      .rejects.toMatchObject({ reasonCode: "native_memory_capture_invalid" });
  });

  it("erases exact Task and Memory copies while preserving independent earlier Task, Memory, and document", async () => {
    const { first, second, documentKey, documentKeyB, taskAId, taskBId, memoryAId, memoryBId, privateRootId, memoryCId } = temporal;
    const providerDb = join(managedOpenCodeRuntimeDirectory({ companyId: first.companyId, runId: first.runId }),
      first.nativeFinalization.normalizedSessionId, "data", "opencode", "opencode.db");
    const laterProviderDb = join(managedOpenCodeRuntimeDirectory({ companyId: second.companyId, runId: second.runId }),
      second.nativeFinalization.normalizedSessionId, "data", "opencode", "opencode.db");
    expect((await readFile(providerDb)).byteLength).toBeGreaterThan(0);
    expect((await readFile(laterProviderDb)).byteLength).toBeGreaterThan(0);
    const memories = memoryService(db);
    if (!first.privateRoot || first.privateRoot.memoryId !== privateRootId) throw new Error("The actual private Memory root is unavailable");
    const erased = await memories.forget(first.companyId, privateRootId, second.aliceMemoryActor);
    expect(erased.deletedRecordCount).toBeGreaterThan(1);
    expect((await memories.get(first.companyId, memoryAId, second.aliceMemoryActor))?.record.id).toBe(memoryAId);
    expect((await memories.get(first.companyId, memoryAId, second.bobMemoryActor))?.record.id).toBe(memoryAId);
    expect(await memories.get(first.companyId, memoryBId, second.aliceMemoryActor)).toBeNull();
    expect(await memories.get(first.companyId, memoryBId, second.bobMemoryActor)).toBeNull();
    expect(await memories.get(first.companyId, memoryCId, second.aliceMemoryActor)).toBeNull();
    expect(await memories.get(first.companyId, memoryCId, second.bobMemoryActor)).toBeNull();
    const erasedOutputCalls = [
      { producer: first, callId: first.toolResults.find(value => value.memoryId === memoryBId)?.callId },
      { producer: second, callId: second.toolResults.find(value => value.memoryId === memoryCId)?.callId },
    ];
    for (const call of erasedOutputCalls) {
      if (!call.callId) throw new Error("An erased Native Memory output lost its original call identity");
      const [invocation] = await db.select({ argumentsHash: toolInvocations.argumentsHash,
        argumentsSummary: toolInvocations.argumentsSummary, resultHash: toolInvocations.resultHash,
        resultSummary: toolInvocations.resultSummary, resultSizeBytes: toolInvocations.resultSizeBytes,
        workflowResultJson: toolInvocations.workflowResultJson }).from(toolInvocations).where(and(
        eq(toolInvocations.companyId, first.companyId), eq(toolInvocations.runId, call.producer.runId),
        eq(toolInvocations.idempotencyKey, `aw-native-tool:${call.producer.runId}:${call.callId}`),
        eq(toolInvocations.toolName, "paperclip-self:remember")));
      expect(invocation).toMatchObject({ argumentsHash: null, argumentsSummary: null, resultHash: null,
        resultSummary: null, resultSizeBytes: null, workflowResultJson: null });
    }

    const [retainedTaskA] = await db.select().from(issues).where(and(eq(issues.companyId, first.companyId), eq(issues.id, taskAId)));
    const [erasedTaskB] = await db.select().from(issues).where(and(eq(issues.companyId, first.companyId), eq(issues.id, taskBId)));
    expect(retainedTaskA?.payloadSourceSnapshotInvalidated).toBe(false);
    expect(await canActorReadIssuePrivacy(db, second.bobActor, retainedTaskA!)).toBe(true);
    expect(erasedTaskB?.payloadSourceSnapshotInvalidated).toBe(true);
    expect(await canActorReadIssuePrivacy(db, second.aliceActor, erasedTaskB!)).toBe(false);
    const [documentLink] = await db.select().from(issueDocuments).where(and(
      eq(issueDocuments.companyId, first.companyId), eq(issueDocuments.issueId, first.issueId), eq(issueDocuments.key, documentKey)));
    expect(documentLink).toBeDefined();
    const [document] = await db.select({ latestRevisionId: documents.latestRevisionId }).from(documents).where(and(
      eq(documents.companyId, first.companyId), eq(documents.id, documentLink!.documentId)));
    const [documentRevision] = await db.select().from(documentRevisions).where(and(
      eq(documentRevisions.companyId, first.companyId), eq(documentRevisions.documentId, documentLink!.documentId),
      eq(documentRevisions.id, document!.latestRevisionId!)));
    expect(documentRevision?.payloadSourceSnapshotInvalidated).toBe(false);
    await expect(assertNativeDocumentRevisionCurrentSourceAccess(db, { companyId: first.companyId,
      issueId: first.issueId, revisionId: documentRevision!.id, actor: second.bobActor, requireLatest: true })).resolves.toBeUndefined();
    const [documentLinkB] = await db.select().from(issueDocuments).where(and(
      eq(issueDocuments.companyId, first.companyId), eq(issueDocuments.issueId, first.issueId), eq(issueDocuments.key, documentKeyB)));
    expect(documentLinkB).toBeDefined();
    const [documentB] = await db.select({ latestRevisionId: documents.latestRevisionId }).from(documents).where(and(
      eq(documents.companyId, first.companyId), eq(documents.id, documentLinkB!.documentId)));
    const [documentRevisionB] = await db.select().from(documentRevisions).where(and(
      eq(documentRevisions.companyId, first.companyId), eq(documentRevisions.documentId, documentLinkB!.documentId),
      eq(documentRevisions.id, documentB!.latestRevisionId!)));
    expect(documentRevisionB?.payloadSourceSnapshotInvalidated).toBe(true);
    await expect(assertNativeDocumentRevisionCurrentSourceAccess(db, { companyId: first.companyId,
      issueId: first.issueId, revisionId: documentRevisionB!.id, actor: second.aliceActor, requireLatest: true })).rejects.toMatchObject({ status: 403 });
    const [retainedMemoryA] = await db.select({ deletedAt: memoryRecords.deletedAt,
      payloadSourceSnapshotInvalidated: memoryRecords.payloadSourceSnapshotInvalidated }).from(memoryRecords)
      .where(and(eq(memoryRecords.companyId, first.companyId), eq(memoryRecords.id, memoryAId)));
    const [scrubbedRoot] = await db.select({ content: memoryRecords.content, title: memoryRecords.title,
      deletedAt: memoryRecords.deletedAt }).from(memoryRecords)
      .where(and(eq(memoryRecords.companyId, first.companyId), eq(memoryRecords.id, privateRootId)));
    const [scrubbedMemoryB] = await db.select({ content: memoryRecords.content, title: memoryRecords.title,
      deletedAt: memoryRecords.deletedAt,
      payloadSourceSnapshotInvalidated: memoryRecords.payloadSourceSnapshotInvalidated }).from(memoryRecords)
      .where(and(eq(memoryRecords.companyId, first.companyId), eq(memoryRecords.id, memoryBId)));
    const [scrubbedMemoryC] = await db.select({ content: memoryRecords.content, title: memoryRecords.title,
      deletedAt: memoryRecords.deletedAt,
      payloadSourceSnapshotInvalidated: memoryRecords.payloadSourceSnapshotInvalidated }).from(memoryRecords)
      .where(and(eq(memoryRecords.companyId, first.companyId), eq(memoryRecords.id, memoryCId)));
    expect(retainedMemoryA?.deletedAt).toBeNull();
    expect(retainedMemoryA?.payloadSourceSnapshotInvalidated).toBe(false);
    expect(scrubbedRoot).toMatchObject({ content: "", title: null, deletedAt: expect.any(Date) });
    expect(scrubbedMemoryB).toMatchObject({ content: "", title: null, deletedAt: expect.any(Date),
      payloadSourceSnapshotInvalidated: true });
    expect(scrubbedMemoryC).toMatchObject({ content: "", title: null, deletedAt: expect.any(Date),
      payloadSourceSnapshotInvalidated: true });

    await memoryJobService(db).tick({ limit: 10, companyId: first.companyId });
    const [providerEraseJob] = await db.select().from(memoryJobs).where(and(eq(memoryJobs.companyId, first.companyId),
      eq(memoryJobs.jobKey, `runtime-asset-erasure:v1:${first.runId}`)));
    const [laterProviderEraseJob] = await db.select().from(memoryJobs).where(and(eq(memoryJobs.companyId, first.companyId),
      eq(memoryJobs.jobKey, `runtime-asset-erasure:v1:${second.runId}`)));
    expect(providerEraseJob?.status).toBe("succeeded");
    expect(laterProviderEraseJob?.status).toBe("succeeded");
    await expect(stat(providerDb)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(laterProviderDb)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
