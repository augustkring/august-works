import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { makeConversationFixtureTreeWritable, runManagedNativeConversationFrame } from "../../__tests__/helpers/managed-native-conversation-frame.js";

function qualifiedOpenCodeBinary(): string | null {
  if (process.platform !== "linux") return null;
  const configured = process.env.PAPERCLIP_QUALIFIED_OPENCODE_BINARY?.trim();
  if (configured) return configured;
  try { return execFileSync("which", ["opencode"], { encoding: "utf8" }).trim() || null; }
  catch { return null; }
}

describe.skipIf(!qualifiedOpenCodeBinary())("managed Native conversation OpenCode frame", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let root = "";
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "managed-native-conversation-frame-"));
    vi.stubEnv("PAPERCLIP_HOME", root);
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", `conversation-frame-${Date.now()}`);
    database = await startEmbeddedPostgresTestDatabase("managed-native-conversation-frame-");
    db = createDb(database.connectionString);
  }, 60_000);
  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await database?.cleanup();
    vi.unstubAllEnvs();
    if (root) { await makeConversationFixtureTreeWritable(root); await rm(root, { recursive: true, force: true }); }
  }, 30_000);

  it("uses the authenticated chat route and actual heartbeat to dispatch a pinned OpenCode turn under a conversation issuer token, without worker-plan rows", async () => {
    const binary = qualifiedOpenCodeBinary();
    if (!binary) throw new Error("qualified_opencode_binary_unavailable");
    vi.stubEnv("PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS", "1");
    let liveBoundary: { runId: string; issueId: string; manifestId: string; reservationId: string;
      requestHash: string; wireBodyHash: string; sourceReceiptHash: string; inputTokens: number; outputTokens: number } | null = null;
    const result = await runManagedNativeConversationFrame({ db, root, opencodeBinary: binary,
      beforeProviderResponse: async facts => {
        expect(facts.run.status).toBe("running");
        expect(facts.run.nativeIssueId).toBe(facts.issueId);
        expect(facts.reservation).toMatchObject({ purpose: "conversation_model", status: "dispatched",
          conversationRunId: facts.run.id, conversationIssueId: facts.issueId,
          executionManifestId: facts.manifest.id, executionManifestHash: expect.any(String) });
        expect(facts.sourceReceipt).toMatchObject({ version: 1, binding: { runId: facts.run.id,
          issueId: facts.issueId, responsibleUserId: facts.run.responsibleUserId } });
        expect(facts.tariffSnapshot).toEqual(expect.any(Object));
        expect(facts.quote).toEqual(expect.any(Object));
        expect(facts.budget.companyMonthlyCents).toBeGreaterThan(0);
        expect(facts.budget.agentMonthlyCents).toBeGreaterThan(0);
        expect(facts.profileBinding).toMatchObject({ model: "fixture-managed-conversation-v1",
          providerBindingId: expect.any(String), providerSnapshotHash: expect.any(String),
          qualifiedConfigurationHash: expect.any(String) });
        liveBoundary = { runId: facts.run.id, issueId: facts.issueId, manifestId: facts.manifest.id,
          reservationId: facts.reservation.id, requestHash: facts.request.bodySha256,
          wireBodyHash: facts.request.wireBodySha256, sourceReceiptHash: JSON.stringify(facts.sourceReceipt),
          inputTokens: facts.usage.inputTokens, outputTokens: facts.usage.outputTokens };
      } });
    expect(result.success, JSON.stringify({ runStatus: result.runStatus, runError: result.run?.error,
      errorCode: result.run?.errorCode, stdoutExcerpt: result.run?.stdoutExcerpt,
      stderrExcerpt: result.run?.stderrExcerpt, providerCallCount: result.providerCallCount })).toBe(true);
    expect(result.providerCallCount).toBeGreaterThan(0);
    expect(result.providerKeyMatched).toBe(true);
    expect(liveBoundary).toMatchObject({ runId: result.run?.id, issueId: result.issueId,
      manifestId: result.manifest?.id, reservationId: result.reservation?.id, inputTokens: 100, outputTokens: 32 });
    expect(result.issuerFacts).toHaveLength(1);
    const issuer = result.issuerFacts[0];
    if (!issuer) throw new Error("conversation_frame_issuer_fact_missing");
    expect(issuer).toMatchObject({ scope: "conversation_model", runId: result.run?.id,
      issueId: result.issueId, generation: 0, manifestId: result.manifest?.id });
    expect(issuer.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.run).toMatchObject({ runtimeMode: "native", scopeKind: "issue", nativeIssueId: result.issueId,
      responsibleUserId: expect.any(String), status: "succeeded" });
    expect(result.manifest).toMatchObject({ runId: result.run?.id, agentId: result.run?.agentId });
    expect(result.reservation).toMatchObject({ purpose: "conversation_model", conversationRunId: result.run?.id,
      conversationIssueId: result.issueId, status: "completed" });
    expect(result.workerPlan).toBeNull();
    expect(result.workerAttempts).toHaveLength(0);
    const sourceReceipt = result.nativeInputSourceReceipt as Record<string, unknown> | null;
    expect(sourceReceipt).toMatchObject({ version: 1, binding: { runId: result.run?.id,
      issueId: result.issueId, responsibleUserId: result.run?.responsibleUserId } });
  }, 240_000);
});
