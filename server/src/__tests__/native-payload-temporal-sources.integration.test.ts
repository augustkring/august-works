import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { companyMemberships, contextManifestItems, createDb, documents, documentRevisions, issueDocuments, issues, memoryJobs, memoryRecords, toolInvocations } from "@paperclipai/db";
import { nativePayloadSourceSnapshotSchema } from "@paperclipai/shared";
import { canActorReadIssuePrivacy } from "../services/authorization.js";
import { issueService } from "../services/issues.js";
import { memoryService } from "../services/memory/memory-service.js";
import { memoryJobService } from "../services/memory/memory-jobs.js";
import { assertNativeDocumentRevisionCurrentSourceAccess, assertNativeMemoryOutputSnapshotCurrent } from "../services/native-direct-input.js";
import { lockAnalyticalCompany } from "../services/analytical-privacy.js";
import { lockMemoryPrivacy } from "../services/memory/memory-privacy.js";
import { managedOpenCodeRuntimeDirectory } from "../services/native-runtime/runtime-asset-retention.js";
import { assertScopedNativeMemoryReplayReceiptCurrent } from "../services/tool-gateway.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { makeFixtureTreeWritable, runManagedNativeOpenCodeFixture } from "./helpers/managed-native-opencode-e2e-fixture.js";

function hasPinnedOpenCodeProfile(): boolean {
  if (process.platform !== "linux") return false;
  if (process.env.PAPERCLIP_QUALIFIED_OPENCODE_BINARY?.trim()) return true;
  try { return Boolean(execFileSync("which", ["opencode"], { encoding: "utf8" }).trim()); }
  catch { return false; }
}

const nativeOpenCodeTemporalDescribe = describe.skipIf(!hasPinnedOpenCodeProfile());

nativeOpenCodeTemporalDescribe("Native model outputs retain only the source closure consumed at creation", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let root = "";
  let instanceId = "";
  let preserveDebugArtifacts = false;
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
    const first = await runManagedNativeOpenCodeFixture({ db, connectionString: database.connectionString,
      root, instanceId, onPreserveDebugArtifacts: () => { preserveDebugArtifacts = true; },
      steps: [
        { tool: "write_document", id: ids.documentA, input: { idempotencyKey: randomUUID(), key: documentKey,
          title: "Independent document A", body: "A predates the private Context read.", baseRevisionId: null } },
        { tool: "create_task", id: ids.taskA, input: { idempotencyKey: randomUUID(), title: taskATitle,
          description: "Independent model-created Task A before the private Context read." } },
        { tool: "self_remember", id: ids.memoryA, input: { scope: "company", memoryType: "outcome",
          title: "Earlier shared Memory A", content: "Memory A predates the private Context read.", idempotencyKey: randomUUID() } },
        { tool: "read_context", id: ids.contextR, input: { query: privateRootContent } },
        { tool: "write_document", id: ids.documentB, input: { idempotencyKey: randomUUID(), key: documentKeyB,
          title: "Private-context document B", body: "B follows the private Context read.", baseRevisionId: null } },
        { tool: "create_task", id: ids.taskB, input: { idempotencyKey: randomUUID(), title: taskBTitle,
          description: `Copied body after governed Context read: ${randomUUID()}.` } },
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
    expect(first.contextResultConsumers).toContainEqual({ callId: ids.contextR, consumed: true });
    const firstToolResult = (callId: string) => first.toolResults.find(value => value.callId === callId);
    const taskAId = firstToolResult(ids.taskA)?.taskId;
    const memoryAId = firstToolResult(ids.memoryA)?.memoryId;
    const privateRootId = first.privateRoot?.memoryId;
    const taskBId = firstToolResult(ids.taskB)?.taskId;
    const memoryBId = firstToolResult(ids.memoryB)?.memoryId;
    for (const id of [taskAId, memoryAId, privateRootId, taskBId, memoryBId])
      expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    if (!taskAId || !memoryAId || !privateRootId || !taskBId || !memoryBId)
      throw new Error("The managed Native producer omitted a real output ID");

    const memories = memoryService(db);
    await memories.reviewCandidate(first.companyId, memoryBId, { decision: "accept" }, first.aliceMemoryActor);
    const [taskA] = await db.select().from(issues).where(and(eq(issues.companyId, first.companyId), eq(issues.id, taskAId)));
    const [taskB] = await db.select().from(issues).where(and(eq(issues.companyId, first.companyId), eq(issues.id, taskBId)));
    if (!taskA || !taskB) throw new Error("The managed Native Task outputs disappeared");
    await issueService(db).update(taskBId, { assigneeUserId: first.bobUserId,
      actorUserId: first.aliceUserId, privacyActor: first.aliceActor });
    const [assignedTaskB] = await db.select().from(issues).where(and(eq(issues.companyId, first.companyId), eq(issues.id, taskBId)));
    if (!assignedTaskB) throw new Error("The assigned Native Task B disappeared");
    expect(assignedTaskB.assigneeUserId).toBe(first.bobUserId);

    const second = await runManagedNativeOpenCodeFixture({ db, connectionString: database.connectionString,
      root, instanceId, reuseIdentity: first.reuseIdentity,
      steps: [
        { tool: "read_context", id: `temporal-context-b-${randomUUID()}`, input: { query: `${taskBTitle} ${assignedTaskB.description ?? ""}` } },
        { tool: "self_remember", id: `temporal-memory-c-${randomUUID()}`, input: { scope: "company", memoryType: "outcome",
          title: "Memory C inherited from Task B", content: "Memory C consumed the fresh Context selected from Task B.",
          idempotencyKey: randomUUID() } },
        { tool: "paperclip_finish", id: `temporal-finish-second-${randomUUID()}` },
      ] });
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
    expect((await memories.get(first.companyId, privateRootId!, first.aliceMemoryActor))?.record.id).toBe(privateRootId);
    expect(await memories.get(first.companyId, privateRootId!, first.bobMemoryActor)).toBeNull();

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
    await memories.reviewCandidate(first.companyId, memoryCId, { decision: "accept" }, first.aliceMemoryActor);
    return { first, second, documentKey, documentKeyB, taskATitle, taskBTitle, taskAId, taskBId, memoryAId, memoryBId,
      privateRootId, memoryCId, contextCapture, selectedItems, manifestId, assignedTaskB };
  }

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "native-payload-temporal-"));
    await chmod(root, 0o700);
    vi.stubEnv("PAPERCLIP_HOME", root);
    instanceId = `native-payload-temporal-${randomUUID()}`;
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", instanceId);
    vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET", `native-payload-temporal-${randomUUID()}-${randomUUID()}`);
    database = await startEmbeddedPostgresTestDatabase("v10-native-payload-temporal-");
    db = createDb(database.connectionString);
    temporal = await buildTemporalFixture();
  }, 600_000);

  afterAll(async () => {
    await database?.cleanup();
    vi.unstubAllEnvs();
    if (root && !preserveDebugArtifacts) {
      await makeFixtureTreeWritable(root);
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("keeps earlier shared Memory A readable after the same run later reads private Context, while narrowing Memory B", async () => {
    const { first, memoryAId, memoryBId } = temporal;
    const memories = memoryService(db);
    expect((await memories.get(first.companyId, memoryAId, first.aliceMemoryActor))?.record.id).toBe(memoryAId);
    expect((await memories.get(first.companyId, memoryAId, first.bobMemoryActor))?.record.id).toBe(memoryAId);
    const [memoryA] = await db.select({ payloadSourceSnapshot: memoryRecords.payloadSourceSnapshot }).from(memoryRecords)
      .where(and(eq(memoryRecords.companyId, first.companyId), eq(memoryRecords.id, memoryAId)));
    const snapshot = nativePayloadSourceSnapshotSchema.parse(memoryA?.payloadSourceSnapshot);
    await expect(assertNativeMemoryOutputSnapshotCurrent(db, { companyId: first.companyId, recordId: memoryAId,
      snapshot, actor: first.bobMemoryActor.authorizationActor })).resolves.toBeUndefined();
    const bobMembershipFilter = and(eq(companyMemberships.companyId, first.companyId),
      eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, first.bobUserId));
    try {
      await db.update(companyMemberships).set({ status: "suspended" }).where(bobMembershipFilter);
      await expect(memories.get(first.companyId, memoryAId, first.bobMemoryActor)).rejects.toMatchObject({ status: 403 });
      await expect(assertNativeMemoryOutputSnapshotCurrent(db, { companyId: first.companyId, recordId: memoryAId,
        snapshot, actor: first.bobMemoryActor.authorizationActor })).rejects.toMatchObject({ status: 403 });
    } finally {
      await db.update(companyMemberships).set({ status: "active" }).where(bobMembershipFilter);
    }
    expect((await memories.get(first.companyId, memoryAId, first.bobMemoryActor))?.record.id).toBe(memoryAId);
    await expect(assertNativeMemoryOutputSnapshotCurrent(db, { companyId: first.companyId, recordId: memoryAId,
      snapshot, actor: first.bobMemoryActor.authorizationActor })).resolves.toBeUndefined();
    expect((await memories.get(first.companyId, memoryBId, first.aliceMemoryActor))?.record.id).toBe(memoryBId);
    expect(await memories.get(first.companyId, memoryBId, first.bobMemoryActor)).toBeNull();
  });

  it("keeps earlier Task A readable while later Task B retains the private source", async () => {
    const { first, taskAId, taskBId, assignedTaskB } = temporal;
    const [taskA] = await db.select().from(issues).where(and(eq(issues.companyId, first.companyId), eq(issues.id, taskAId)));
    const [taskB] = await db.select().from(issues).where(and(eq(issues.companyId, first.companyId), eq(issues.id, taskBId)));
    expect(taskA).toBeDefined();
    expect(taskB).toBeDefined();
    expect(await canActorReadIssuePrivacy(db, first.bobActor, taskA!)).toBe(true);
    expect(await canActorReadIssuePrivacy(db, first.aliceActor, taskB!)).toBe(true);
    expect(assignedTaskB.assigneeUserId).toBe(first.bobUserId);
    expect(await canActorReadIssuePrivacy(db, first.bobActor, assignedTaskB)).toBe(false);
  });

  it("keeps document A independent while document B carries the later private Context source", async () => {
    const { first, documentKey, documentKeyB, privateRootId } = temporal;
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
      issueId: first.issueId, revisionId: revisionA.id, actor: first.bobActor, requireLatest: true })).resolves.toBeUndefined();
    await expect(assertNativeDocumentRevisionCurrentSourceAccess(db, { companyId: first.companyId,
      issueId: first.issueId, revisionId: revisionB.id, actor: first.bobActor, requireLatest: true })).rejects.toMatchObject({ status: 403 });
  });

  it("carries inherited Task B privacy into fresh Context and Memory C without a direct root Memory item", async () => {
    const { first, privateRootId, taskBId, memoryCId, contextCapture, selectedItems } = temporal;
    expect(selectedItems).toEqual(expect.arrayContaining([expect.objectContaining({
      sourceProvider: "august_works_tasks", sourceRef: `issue://${taskBId}`,
    })]));
    expect(selectedItems.some(item => item.sourceProvider === "august_works_memory" && item.sourceRef === `memory://record/${privateRootId}`))
      .toBe(false);
    expect(contextCapture.sourceSet?.policy?.memoryIds).toContain(privateRootId);
    expect(contextCapture.sourceSet?.inputs?.some(source => source.kind === "context")).toBe(true);
    expect(contextCapture.manifestIds?.[0]?.contextManifestId).toMatch(/^[0-9a-f-]{36}$/i);
    const memories = memoryService(db);
    expect((await memories.get(first.companyId, memoryCId, first.aliceMemoryActor))?.record.id).toBe(memoryCId);
    expect(await memories.get(first.companyId, memoryCId, first.bobMemoryActor)).toBeNull();
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
          snapshot, actor: producer.aliceMemoryActor.authorizationActor })).resolves.toBeUndefined();
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
    expect((await memories.get(first.companyId, privateRootId, first.aliceMemoryActor))?.record.id).toBe(privateRootId);
    await memories.revoke(first.companyId, memoryBId, { reason: "The Human revoked this output." }, first.aliceMemoryActor);
    expect((await memories.get(first.companyId, privateRootId, first.aliceMemoryActor))?.record.id).toBe(privateRootId);
    await expect(verifyReceipt(first, memoryBCallId, memoryBId)).rejects.toMatchObject({
      reasonCode: "native_memory_capture_invalid",
    });

    await verifyReceipt(second, second.toolResults.find(value => value.memoryId === memoryCId)!.callId, memoryCId);
    expect(await memories.get(first.companyId, taskBId, first.aliceMemoryActor)).not.toBeNull();
    await memories.forget(first.companyId, memoryCId, second.aliceMemoryActor);
    expect(await memories.get(first.companyId, taskBId, first.aliceMemoryActor)).not.toBeNull();
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
    const erased = await memories.forget(first.companyId, privateRootId, first.aliceMemoryActor);
    expect(erased.deletedRecordCount).toBeGreaterThan(1);
    expect((await memories.get(first.companyId, memoryAId, first.aliceMemoryActor))?.record.id).toBe(memoryAId);
    expect((await memories.get(first.companyId, memoryAId, first.bobMemoryActor))?.record.id).toBe(memoryAId);
    expect(await memories.get(first.companyId, memoryBId, first.aliceMemoryActor)).toBeNull();
    expect(await memories.get(first.companyId, memoryBId, first.bobMemoryActor)).toBeNull();
    expect(await memories.get(first.companyId, memoryCId, first.aliceMemoryActor)).toBeNull();
    expect(await memories.get(first.companyId, memoryCId, first.bobMemoryActor)).toBeNull();

    const [retainedTaskA] = await db.select().from(issues).where(and(eq(issues.companyId, first.companyId), eq(issues.id, taskAId)));
    const [erasedTaskB] = await db.select().from(issues).where(and(eq(issues.companyId, first.companyId), eq(issues.id, taskBId)));
    expect(retainedTaskA?.payloadSourceSnapshotInvalidated).toBe(false);
    expect(await canActorReadIssuePrivacy(db, first.bobActor, retainedTaskA!)).toBe(true);
    expect(erasedTaskB?.payloadSourceSnapshotInvalidated).toBe(true);
    expect(await canActorReadIssuePrivacy(db, first.aliceActor, erasedTaskB!)).toBe(false);
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
      issueId: first.issueId, revisionId: documentRevision!.id, actor: first.bobActor, requireLatest: true })).resolves.toBeUndefined();
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
      issueId: first.issueId, revisionId: documentRevisionB!.id, actor: first.aliceActor, requireLatest: true })).rejects.toMatchObject({ status: 403 });
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
