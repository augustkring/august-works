import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { enableV5ForTest } from "../../__tests__/helpers/v5-fixtures.js";
import { instanceSettingsService } from "../instance-settings.js";
import { makeFixtureTreeWritable, runManagedNativeOpenCodeFixture } from "../../__tests__/helpers/managed-native-opencode-e2e-fixture.js";
import { memoryService } from "../memory/memory-service.js";
import * as nativeDirectInput from "../native-direct-input.js";
import { nativePayloadSourceSnapshotSchema } from "@paperclipai/shared";

const managedContextReadFailures: Array<{ name: string; code: string | null; causeCode: string | null; frames: string[] }> = [];

function safeErrorCode(value: unknown): string | null {
  return typeof value === "string" && /^[A-Z0-9_:-]{1,80}$/i.test(value) ? value : null;
}

function managedContextFailureFacts(error: unknown) {
  const value = error instanceof Error ? error as Error & { code?: unknown; cause?: { code?: unknown } } : null;
  const frames = value?.stack?.split("\n").slice(1).filter(line => /^\s*at /.test(line))
    .slice(0, 4).map(line => line.trim().replace(/\s+/g, " ").slice(0, 180)) ?? [];
  return { name: value?.name ?? "UnknownError", code: safeErrorCode(value?.code),
    causeCode: safeErrorCode(value?.cause?.code), frames };
}

function hasPinnedOpenCodeProfile(): boolean {
  if (process.platform !== "linux") return false;
  if (process.env.PAPERCLIP_QUALIFIED_OPENCODE_BINARY?.trim()) return true;
  try { return Boolean(execFileSync("which", ["opencode"], { encoding: "utf8" }).trim()); }
  catch { return false; }
}

describe.skipIf(!hasPinnedOpenCodeProfile())("managed OpenCode source-closure binary integration", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let root = "";
  let instanceId = "";
  let preserveDebugArtifacts = false;

  beforeAll(async () => {
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
    const assemble = nativeDirectInput.assembleNativeContextRead;
    vi.spyOn(nativeDirectInput, "assembleNativeContextRead").mockImplementation(async (...args) => {
      try { return await assemble(...args); }
      catch (error) {
        managedContextReadFailures.push(managedContextFailureFacts(error));
        throw error;
      }
    });
  }, 60_000);

  afterAll(async () => {
    await database?.cleanup();
    vi.restoreAllMocks();
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
      privateContextContent: privateRootContent,
      humanActions: [
        { afterModelToolCallId: memoryAId, action: "accept_memory_candidate" },
        { afterModelToolCallId: memoryAId, action: "create_private_context_root" },
      ],
      onPreserveDebugArtifacts: () => { preserveDebugArtifacts = true; } }).catch(error => {
        if (managedContextReadFailures.length) {
          const message = error instanceof Error ? error.message : "managed_opencode_fixture_failed";
          throw new Error(`${message}\nmanaged Context read failure facts: ${JSON.stringify(managedContextReadFailures)}`);
        }
        throw error;
      });
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
    const privateRoot = result.privateRoot;
    const memoryB = toolResult(memoryBId);
    expect(memoryA?.memoryId).toMatch(/^[0-9a-f-]{36}$/);
    expect(privateRoot?.memoryId).toMatch(/^[0-9a-f-]{36}$/);
    expect(privateRoot?.issueId).toMatch(/^[0-9a-f-]{36}$/);
    expect(memoryB?.memoryId).toMatch(/^[0-9a-f-]{36}$/);
    const memories = memoryService(db);
    await memories.reviewCandidate(result.companyId, memoryB!.memoryId!, { decision: "accept" }, result.aliceMemoryActor);
    expect((await memories.get(result.companyId, memoryA!.memoryId!, result.aliceMemoryActor))?.record.id)
      .toBe(memoryA!.memoryId);
    expect((await memories.get(result.companyId, memoryA!.memoryId!, result.bobMemoryActor))?.record.id)
      .toBe(memoryA!.memoryId);
    expect((await memories.get(result.companyId, memoryB!.memoryId!, result.aliceMemoryActor))?.record.id)
      .toBe(memoryB!.memoryId);
    expect(await memories.get(result.companyId, memoryB!.memoryId!, result.bobMemoryActor)).toBeNull();
    expect(await memories.get(result.companyId, privateRoot!.memoryId!, result.bobMemoryActor)).toBeNull();
    const contextCapture = result.contextReadCaptures[0]?.contextRead as {
      manifestIds?: Array<{ contextManifestId?: string }>;
      sourceSet?: { policy?: { memoryIds?: string[] }; inputs?: Array<{ kind?: string; manifestId?: string }> };
    } | undefined;
    expect(contextCapture?.sourceSet?.policy?.memoryIds).toContain(privateRoot!.memoryId);
    expect(contextCapture?.sourceSet?.inputs?.some(source => source.kind === "context")).toBe(true);
    const outputSnapshot = (callId: string) => nativePayloadSourceSnapshotSchema.parse(
      result.memoryOutputs.find(output => output.callId === callId)?.currentForAlice?.record.payloadSourceSnapshot);
    const snapshotA = outputSnapshot(memoryAId);
    const snapshotB = outputSnapshot(memoryBId);
    const contextManifestId = contextCapture?.manifestIds?.[0]?.contextManifestId;
    expect(contextManifestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.contextManifestSelectionFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ contextManifestId, selectedPrivateRootItem: true, retainedPrivateRoot: true }),
    ]));
    expect(snapshotA.inputs.some(source => source.kind === "context")).toBe(false);
    expect(snapshotA.policy.memoryIds).not.toContain(privateRoot!.memoryId);
    expect(snapshotB.policy.memoryIds).toContain(privateRoot!.memoryId);
    expect(snapshotB.inputs).toContainEqual(expect.objectContaining({ kind: "context", manifestId: contextManifestId }));
  }, 180_000);
});
