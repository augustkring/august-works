import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { enableV5ForTest } from "../../__tests__/helpers/v5-fixtures.js";
import { instanceSettingsService } from "../instance-settings.js";
import { makeFixtureTreeWritable, runManagedNativeOpenCodeFixture } from "../../__tests__/helpers/managed-native-opencode-e2e-fixture.js";
import { memoryService } from "../memory/memory-service.js";

describe("managed OpenCode source-closure binary integration", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let root = "";
  let instanceId = "";
  let preserveDebugArtifacts = false;

  beforeAll(async () => {
    if (process.platform !== "linux") throw new Error("This fixture pins the installed Linux OpenCode binary.");
    root = await mkdtemp(join(tmpdir(), "managed-opencode-source-e2e-"));
    await chmod(root, 0o700);
    vi.stubEnv("PAPERCLIP_HOME", root);
    instanceId = `managed-opencode-${randomUUID()}`;
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", instanceId);
    vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET", `managed-opencode-e2e-${randomUUID()}-${randomUUID()}`);
    database = await startEmbeddedPostgresTestDatabase("managed-opencode-source-e2e-");
    db = createDb(database.connectionString);
    await instanceSettingsService(db).getExperimental();
    await enableV5ForTest(db);
    await instanceSettingsService(db).updateExperimental({ enableWorkflowsV1: true,
      role_packs_v5: false, skill_resolver_v5: false, readiness_engine_v7: true, orchestration_v7: true });
  }, 60_000);

  afterAll(async () => {
    await database?.cleanup();
    vi.unstubAllEnvs();
    if (root && !preserveDebugArtifacts) {
      await makeFixtureTreeWritable(root);
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("executes same-run Memory and Context outputs through the real managed OpenCode Messages route", async () => {
    const privateRootContent = `private_context_root_${randomUUID()}`;
    const documentAId = "managed-e2e-document-a";
    const memoryAId = "managed-e2e-memory-a";
    const privateMemoryId = "managed-e2e-private-root";
    const contextReadId = "managed-e2e-read-context";
    const memoryBId = "managed-e2e-memory-b";
    const result = await runManagedNativeOpenCodeFixture({ db, connectionString: database.connectionString,
      root, instanceId,
      steps: [
        { tool: "write_document", id: documentAId, input: {
          idempotencyKey: randomUUID(), key: "managed-source-a", title: "Public-prefix document A",
          body: "Document A was produced before private Context was selected.", baseRevisionId: null,
        } },
        { tool: "self_remember", id: memoryAId, input: { scope: "company", memoryType: "outcome",
          title: "Earlier shared managed output A", content: "Public managed output A, before private Context.",
          idempotencyKey: randomUUID() } },
        { tool: "self_remember", id: privateMemoryId, input: { scope: "private", memoryType: "lesson",
          title: "Actual private Context root", content: privateRootContent, idempotencyKey: randomUUID() } },
        { tool: "read_context", id: contextReadId, input: { query: privateRootContent } },
        { tool: "self_remember", id: memoryBId, input: { scope: "company", memoryType: "outcome",
          title: "Later shared managed output B", content: "Managed output B derived after private Context selection.",
          idempotencyKey: randomUUID() } },
        { tool: "write_document", id: "managed-e2e-document-b", input: {
          idempotencyKey: randomUUID(), key: "managed-source-b", title: "Private-context document B",
          body: "Document B was produced after private Context was selected.", baseRevisionId: null,
        } },
        { tool: "paperclip_finish", id: "managed-e2e-finish-1" },
      ],
      // A shared Memory is born as a pending proposal. Accept it through the
      // normal Human review service after its real Gateway call and before
      // the next model request consumes that tool_result in Context.
      humanActions: [{ afterModelToolCallId: memoryAId, action: "accept_memory_candidate" }],
      onPreserveDebugArtifacts: () => { preserveDebugArtifacts = true; } });
    expect(result.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.sourceReceipt).toBeDefined();
    expect(result.contextResultConsumers).toContainEqual({ callId: contextReadId, consumed: true });
    expect(result.documents).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "managed-source-a", aliceHttpStatus: 200, bobHttpStatus: 200,
        snapshot: expect.objectContaining({ schema: "paperclip.native_payload_source_snapshot.v1" }) }),
      expect.objectContaining({ key: "managed-source-b", aliceHttpStatus: 200, bobHttpStatus: 403,
        snapshot: expect.objectContaining({ schema: "paperclip.native_payload_source_snapshot.v1" }) }),
    ]));
    const toolResult = (callId: string) => result.toolResults.find(value => value.callId === callId);
    const memoryA = toolResult(memoryAId);
    const privateRoot = toolResult(privateMemoryId);
    const memoryB = toolResult(memoryBId);
    expect(memoryA?.memoryId).toMatch(/^[0-9a-f-]{36}$/);
    expect(privateRoot?.memoryId).toMatch(/^[0-9a-f-]{36}$/);
    expect(memoryB?.memoryId).toMatch(/^[0-9a-f-]{36}$/);
    const memories = memoryService(db);
    for (const item of [memoryA, memoryB]) {
      await memories.reviewCandidate(result.companyId, item!.memoryId!, { decision: "accept" }, result.aliceMemoryActor);
    }
    expect((await memories.get(result.companyId, memoryA!.memoryId!, result.aliceMemoryActor))?.record.id)
      .toBe(memoryA!.memoryId);
    expect((await memories.get(result.companyId, memoryA!.memoryId!, result.bobMemoryActor))?.record.id)
      .toBe(memoryA!.memoryId);
    expect((await memories.get(result.companyId, memoryB!.memoryId!, result.aliceMemoryActor))?.record.id)
      .toBe(memoryB!.memoryId);
    expect(await memories.get(result.companyId, memoryB!.memoryId!, result.bobMemoryActor)).toBeNull();
    expect(await memories.get(result.companyId, privateRoot!.memoryId!, result.bobMemoryActor)).toBeNull();
    const contextCapture = result.contextReadCaptures[0]?.contextRead as {
      sourceSet?: { policy?: { memoryIds?: string[] }; inputs?: Array<{ kind?: string }> };
    } | undefined;
    expect(contextCapture?.sourceSet?.policy?.memoryIds).toContain(privateRoot!.memoryId);
    expect(contextCapture?.sourceSet?.inputs?.some(source => source.kind === "context")).toBe(true);
  }, 180_000);
});
