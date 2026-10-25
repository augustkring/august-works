import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { contextManifestItems, createDb, documents, documentRevisions, issueDocuments, issues, memoryRecords,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS } from "@paperclipai/db";
import { canActorReadIssuePrivacy } from "../services/authorization.js";
import { issueService } from "../services/issues.js";
import { memoryService } from "../services/memory/memory-service.js";
import { assertNativeDocumentRevisionCurrentSourceAccess } from "../services/native-direct-input.js";
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
    const ids = {
      documentA: `temporal-document-a-${randomUUID()}`,
      taskA: `temporal-task-a-${randomUUID()}`,
      memoryA: `temporal-memory-a-${randomUUID()}`,
      privateRoot: `temporal-private-root-${randomUUID()}`,
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
        { tool: "self_remember", id: ids.privateRoot, input: { scope: "private", memoryType: "lesson",
          title: "Private Memory root R", content: privateRootContent, idempotencyKey: randomUUID() } },
        { tool: "read_context", id: ids.contextR, input: { query: privateRootContent } },
        { tool: "create_task", id: ids.taskB, input: { idempotencyKey: randomUUID(), title: taskBTitle,
          description: `Copied body after governed Context read: ${randomUUID()}.` } },
        { tool: "self_remember", id: ids.memoryB, input: { scope: "company", memoryType: "outcome",
          title: "Later shared Memory B", content: "Memory B was produced after private Context selection.",
          idempotencyKey: randomUUID() } },
        { tool: "paperclip_finish", id: `temporal-finish-first-${randomUUID()}` },
      ] });
    expect(first.contextResultConsumers).toContainEqual({ callId: ids.contextR, consumed: true });
    const firstToolResult = (callId: string) => first.toolResults.find(value => value.callId === callId);
    const taskAId = firstToolResult(ids.taskA)?.taskId;
    const memoryAId = firstToolResult(ids.memoryA)?.memoryId;
    const privateRootId = firstToolResult(ids.privateRoot)?.memoryId;
    const taskBId = firstToolResult(ids.taskB)?.taskId;
    const memoryBId = firstToolResult(ids.memoryB)?.memoryId;
    for (const id of [taskAId, memoryAId, privateRootId, taskBId, memoryBId])
      expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    if (!taskAId || !memoryAId || !privateRootId || !taskBId || !memoryBId)
      throw new Error("The managed Native producer omitted a real output ID");

    const memories = memoryService(db);
    for (const memoryId of [memoryAId, memoryBId])
      await memories.reviewCandidate(first.companyId, memoryId, { decision: "accept" }, first.aliceMemoryActor);
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
    return { first, second, documentKey, taskATitle, taskBTitle, taskAId, taskBId, memoryAId, memoryBId,
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

  it("erases exact Task and Memory copies while preserving independent earlier Task, Memory, and document", async () => {
    const { first, documentKey, taskAId, taskBId, memoryAId, memoryBId, privateRootId, memoryCId } = temporal;
    const memories = memoryService(db);
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
    const [retainedMemoryA] = await db.select({ deletedAt: memoryRecords.deletedAt,
      payloadSourceSnapshotInvalidated: memoryRecords.payloadSourceSnapshotInvalidated }).from(memoryRecords)
      .where(and(eq(memoryRecords.companyId, first.companyId), eq(memoryRecords.id, memoryAId)));
    const [scrubbedMemoryB] = await db.select({ deletedAt: memoryRecords.deletedAt,
      payloadSourceSnapshotInvalidated: memoryRecords.payloadSourceSnapshotInvalidated }).from(memoryRecords)
      .where(and(eq(memoryRecords.companyId, first.companyId), eq(memoryRecords.id, memoryBId)));
    const [scrubbedMemoryC] = await db.select({ deletedAt: memoryRecords.deletedAt,
      payloadSourceSnapshotInvalidated: memoryRecords.payloadSourceSnapshotInvalidated }).from(memoryRecords)
      .where(and(eq(memoryRecords.companyId, first.companyId), eq(memoryRecords.id, memoryCId)));
    expect(retainedMemoryA?.deletedAt).toBeNull();
    expect(retainedMemoryA?.payloadSourceSnapshotInvalidated).toBe(false);
    expect(scrubbedMemoryB?.deletedAt).not.toBeNull();
    expect(scrubbedMemoryC?.deletedAt).not.toBeNull();
  });
});
