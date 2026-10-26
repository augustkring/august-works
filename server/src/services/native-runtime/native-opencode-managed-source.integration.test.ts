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
import * as analyticalContextAuthority from "../analytical-context-authority.js";
import { nativePayloadSourceSnapshotSchema } from "@paperclipai/shared";
import { PaperclipRunnerToolAuthority } from "./paperclip-runner-tool-authority.js";

const managedContextReadFailures: Array<{ name: string; code: string | null; causeCode: string | null; frames: string[] }> = [];
const managedMemoryToolFailures: Array<{ tool: string; callId: string; name: string; code: string | null; causeCode: string | null; frames: string[] }> = [];
const managedContextSourceCheckTimings: Array<{ phase: string; caller: string; elapsedMs: number; outcome: "ok" | "throw";
  failure?: { name: string; code: string | null; causeCode: string | null; frames: string[] } }> = [];
const managedContextSourceCheckCounts: Record<string, number> = {};
const managedContextSourceCheckCallerCounts: Record<string, number> = {};

function managedContextSourceCheckCaller(): string {
  const frames = new Error().stack?.split("\n").slice(1) ?? [];
  for (const frame of frames) {
    if (frame.includes("native-opencode-managed-source.integration.test.ts")) continue;
    const match = /server\/src\/services\/([^\s():]+\.ts):(\d+):\d+/.exec(frame);
    if (match) return `${match[1]}:${match[2]}`;
  }
  return "unknown";
}

function recordManagedContextSourceCheckTiming(phase: string, caller: string, startedAt: number, outcome: "ok" | "throw",
  failure?: unknown) {
  managedContextSourceCheckCounts[phase] = (managedContextSourceCheckCounts[phase] ?? 0) + 1;
  managedContextSourceCheckCallerCounts[`${phase}@${caller}`] = (managedContextSourceCheckCallerCounts[`${phase}@${caller}`] ?? 0) + 1;
  if (managedContextSourceCheckTimings.length >= 64) managedContextSourceCheckTimings.shift();
  managedContextSourceCheckTimings.push({ phase, caller, elapsedMs: Math.max(0, Date.now() - startedAt), outcome,
    ...(outcome === "throw" ? { failure: managedContextFailureFacts(failure) } : {}) });
}

async function timeManagedContextSourceCheck<T>(phase: string, check: () => Promise<T>): Promise<T> {
  const caller = managedContextSourceCheckCaller();
  const startedAt = Date.now();
  let outcome: "ok" | "throw" = "ok";
  try { return await check(); }
  catch (error) { outcome = "throw"; recordManagedContextSourceCheckTiming(phase, caller, startedAt, outcome, error); throw error; }
  finally { if (outcome === "ok") recordManagedContextSourceCheckTiming(phase, caller, startedAt, outcome); }
}

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
    const assertContextSourceSetCurrent = nativeDirectInput.assertNativeContextReadSourceSetCurrent;
    vi.spyOn(nativeDirectInput, "assertNativeContextReadSourceSetCurrent").mockImplementation(async (...args) =>
      timeManagedContextSourceCheck("assertNativeContextReadSourceSetCurrent", () => assertContextSourceSetCurrent(...args)));
    const assertManagedConsumedSourceSetCurrent = nativeDirectInput.assertNativeManagedConsumedSourceSetCurrent;
    vi.spyOn(nativeDirectInput, "assertNativeManagedConsumedSourceSetCurrent").mockImplementation(async function (
      this: unknown, ...args) {
      return timeManagedContextSourceCheck("assertNativeManagedConsumedSourceSetCurrent", () => assertManagedConsumedSourceSetCurrent(...args));
    });
    const assertAnalyticalContextPayloadAccess = analyticalContextAuthority.assertAnalyticalContextPayloadAccess;
    vi.spyOn(analyticalContextAuthority, "assertAnalyticalContextPayloadAccess").mockImplementation(async (...args) =>
      timeManagedContextSourceCheck("assertAnalyticalContextPayloadAccess", () => assertAnalyticalContextPayloadAccess(...args)));
    const executeTool = PaperclipRunnerToolAuthority.prototype.execute;
    vi.spyOn(PaperclipRunnerToolAuthority.prototype, "execute").mockImplementation(async function (
      this: PaperclipRunnerToolAuthority, call, ...args) {
      try { return await executeTool.call(this, call, ...args); }
      catch (error) {
        if (call.tool === "self_remember") {
          const facts = managedContextFailureFacts(error);
          managedMemoryToolFailures.push({ tool: call.tool, callId: call.callId, ...facts });
        }
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
        if (managedContextReadFailures.length || managedContextSourceCheckTimings.length) {
          const message = error instanceof Error ? error.message : "managed_opencode_fixture_failed";
          throw new Error(`${message}\nmanaged Context read failure facts: ${JSON.stringify({
            failures: managedContextReadFailures, sourceCheckCounts: managedContextSourceCheckCounts,
            sourceCheckCallerCounts: managedContextSourceCheckCallerCounts,
            managedMemoryToolFailures,
            recentSourceCheckTimings: managedContextSourceCheckTimings,
          })}`);
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
    if (!("runId" in result) || !("toolResults" in result) || !Array.isArray(result.toolResults) ||
      !("contextReadCaptures" in result) || !Array.isArray(result.contextReadCaptures) ||
      !("memoryOutputs" in result) || !Array.isArray(result.memoryOutputs) || !result.privateRoot)
      throw new Error("managed_opencode_success_result_shape_invalid");
    const toolResults = result.toolResults;
    const contextReadCaptures = result.contextReadCaptures;
    const memoryOutputs = result.memoryOutputs;
    const privateRootOutput = result.privateRoot;
    const toolResult = (callId: string) => toolResults.find(value => value.callId === callId);
    const memoryA = toolResult(memoryAId);
    const privateRoot = privateRootOutput;
    const memoryB = toolResult(memoryBId);
    if (!memoryA?.memoryId || !privateRoot.memoryId || !privateRoot.issueId || !memoryB?.memoryId)
      throw new Error("managed_opencode_required_memory_outputs_missing");
    expect(memoryA.memoryId).toMatch(/^[0-9a-f-]{36}$/);
    expect(privateRoot.memoryId).toMatch(/^[0-9a-f-]{36}$/);
    expect(privateRoot.issueId).toMatch(/^[0-9a-f-]{36}$/);
    expect(memoryB.memoryId).toMatch(/^[0-9a-f-]{36}$/);
    const memories = memoryService(db);
    await memories.reviewCandidate(result.companyId, memoryB.memoryId, { decision: "accept" }, result.aliceMemoryActor);
    expect((await memories.get(result.companyId, memoryA.memoryId, result.aliceMemoryActor))?.record.id)
      .toBe(memoryA.memoryId);
    expect((await memories.get(result.companyId, memoryA.memoryId, result.bobMemoryActor))?.record.id)
      .toBe(memoryA.memoryId);
    expect((await memories.get(result.companyId, memoryB.memoryId, result.aliceMemoryActor))?.record.id)
      .toBe(memoryB.memoryId);
    expect(await memories.get(result.companyId, memoryB.memoryId, result.bobMemoryActor)).toBeNull();
    expect(await memories.get(result.companyId, privateRoot.memoryId, result.bobMemoryActor)).toBeNull();
    const contextCapture = contextReadCaptures[0]?.contextRead as {
      manifestIds?: Array<{ contextManifestId?: string }>;
      sourceSet?: { policy?: { memoryIds?: string[] }; inputs?: Array<{ kind?: string; manifestId?: string }> };
    } | undefined;
    expect(contextCapture?.sourceSet?.policy?.memoryIds).toContain(privateRoot.memoryId);
    expect(contextCapture?.sourceSet?.inputs?.some(source => source.kind === "context")).toBe(true);
    const outputSnapshot = (callId: string) => nativePayloadSourceSnapshotSchema.parse(
      memoryOutputs.find(output => output.callId === callId)?.currentForAlice?.record.payloadSourceSnapshot);
    const snapshotA = outputSnapshot(memoryAId);
    const snapshotB = outputSnapshot(memoryBId);
    const contextManifestId = contextCapture?.manifestIds?.[0]?.contextManifestId;
    expect(contextManifestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.contextManifestSelectionFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ contextManifestId, selectedPrivateRootItem: true, retainedPrivateRoot: true }),
    ]));
    expect(snapshotA.inputs.some(source => source.kind === "context")).toBe(false);
    expect(snapshotA.policy.memoryIds).not.toContain(privateRoot.memoryId);
    expect(snapshotB.policy.memoryIds).toContain(privateRoot.memoryId);
    expect(snapshotB.inputs).toContainEqual(expect.objectContaining({ kind: "context", manifestId: contextManifestId }));
  }, 180_000);

  it("binds a managed Project GET result to the exact current public Project projection", async () => {
    const callId = "managed-e2e-project-read";
    const result = await runManagedNativeOpenCodeFixture({ db, connectionString: database.connectionString,
      root, instanceId, steps: [
        { tool: "call_api", id: callId, input: { operationId: "GET /api/projects/{id}", pathParams: { id: "fixture-project" } } },
        { tool: "paperclip_finish", id: "managed-e2e-project-finish" },
      ] });
    if (!("runId" in result) || !result.projectApiReadEvidence)
      throw new Error("managed_opencode_project_read_success_evidence_missing");
    expect(result.completedRun?.status).toBe("succeeded");
    expect(result.projectApiReadEvidence).toMatchObject({ providerContinued: true, toolSchemaPinned: true,
      providerConsumedExactNonErrorToolResult: true, projectSourceMatchedCurrentExpandedProjection: true,
      hasPrimaryWorkspaceInProjection: true, matchingOriginalAndManagedCaptures: true,
      matchingAssociation: true, exactAdditionalInputClosure: true });
    expect(result.projectApiResultConsumers).toHaveLength(1);
    expect(result.projectApiResultConsumers[0]).toMatchObject({ callId, consumed: true });
    expect(result.projectApiResultConsumers[0]?.contentDigest).toMatch(/^[0-9a-f]{64}$/);
  }, 180_000);

  it("refuses the next managed request after the captured Project workspace changes", async () => {
    const callId = "managed-e2e-project-stale-read";
    const result = await runManagedNativeOpenCodeFixture({ db, connectionString: database.connectionString,
      root, instanceId, steps: [
        { tool: "call_api", id: callId, input: { operationId: "GET /api/projects/{id}", pathParams: { id: "fixture-project" } } },
        { tool: "paperclip_finish", id: "managed-e2e-project-stale-finish" },
      ], humanActions: [{ afterModelToolCallId: callId, action: "edit_project_workspace" }],
      expectProjectWorkspaceSourceDenial: true });
    if (!("projectWorkspaceSourceDenial" in result))
      throw new Error("managed_opencode_project_workspace_denial_evidence_missing");
    expect(result.projectWorkspaceSourceDenial).toMatchObject({ status: 403, providerResponsesBeforeDenial: 1,
      originalCaptureRetained: true, managedToolResultRetained: true });
  }, 180_000);
});
