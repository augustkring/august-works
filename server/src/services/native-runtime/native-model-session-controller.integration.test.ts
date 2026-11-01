import { and, eq, sql } from "drizzle-orm";
import { createDb, runtimeHostCommands } from "@paperclipai/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { configureManagedConversationSandboxHost } from "../../__tests__/helpers/managed-native-conversation-sandbox-host.js";
import { runManagedNativeConversationFrame, makeConversationFixtureTreeWritable } from "../../__tests__/helpers/managed-native-conversation-frame.js";

function qualifiedOpenCodeBinary(): string | null {
  if (process.platform !== "linux") return null;
  const configured = process.env.PAPERCLIP_QUALIFIED_OPENCODE_BINARY?.trim();
  if (configured) return configured;
  try { return execFileSync("which", ["opencode"], { encoding: "utf8" }).trim() || null; }
  catch { return null; }
}

describe.skipIf(!qualifiedOpenCodeBinary())("Native managed model session controller issuer", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let root = "";
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "native-model-session-controller-"));
    vi.stubEnv("PAPERCLIP_HOME", root);
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", `native-model-session-controller-${Date.now()}`);
    database = await startEmbeddedPostgresTestDatabase("native-model-session-controller-");
    db = createDb(database.connectionString);
  }, 60_000);
  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await database?.cleanup();
    vi.unstubAllEnvs();
    if (root) { await makeConversationFixtureTreeWritable(root); await rm(root, { recursive: true, force: true }); }
  }, 30_000);

  it("persists current conversation start, same-authority refresh, and stop receipts through the signed relay owner", async () => {
    const binary = qualifiedOpenCodeBinary();
    if (!binary) throw new Error("qualified_opencode_binary_unavailable");
    let receiptFacts: Record<string, unknown> | null = null;
    let transitionCapabilityHashes: { start: string | null; refresh: string | null; stop: string | null } =
      { start: null, refresh: null, stop: null };
    let observedHostReceipts: Array<{ phase: string; sessionKey: string; capabilityHash: string; expiresAt: string; sessionDeadlineAt: string }> = [];
    let configuredHost: Awaited<ReturnType<typeof configureManagedConversationSandboxHost>> | null = null;
    const result = await runManagedNativeConversationFrame({ db, root, opencodeBinary: binary,
      sandboxRelay: true, timeoutSec: 600,
      sandboxRelayDnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
      configureHeartbeat: async context => {
        configuredHost = await configureManagedConversationSandboxHost({ ...context, root });
        return configuredHost;
      },
      afterRunSettledBeforeTeardown: async facts => {
        if (!facts.run) throw new Error("conversation_run_missing_before_session_receipt_review");
        const rows = await db.select({ id: runtimeHostCommands.id, status: runtimeHostCommands.status,
          payload: runtimeHostCommands.payload, safeResult: runtimeHostCommands.safeResult,
          errorCode: runtimeHostCommands.errorCode }).from(runtimeHostCommands).where(and(
            eq(runtimeHostCommands.companyId, facts.companyId), eq(runtimeHostCommands.commandType, "sandbox_exec"),
            sql`${runtimeHostCommands.payload}->>'runId' = ${facts.run.id}`,
          ));
        const transitions = rows.flatMap(row => {
          const payload = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
            ? row.payload as Record<string, unknown> : {};
          const session = payload.modelBrokerSession && typeof payload.modelBrokerSession === "object" && !Array.isArray(payload.modelBrokerSession)
            ? payload.modelBrokerSession as Record<string, unknown> : null;
          if (!session) return [];
          const safe = row.safeResult && typeof row.safeResult === "object" && !Array.isArray(row.safeResult)
            ? row.safeResult as Record<string, unknown> : {};
          const receipt = safe.modelBrokerSessionReceipt && typeof safe.modelBrokerSessionReceipt === "object" && !Array.isArray(safe.modelBrokerSessionReceipt)
            ? safe.modelBrokerSessionReceipt as Record<string, unknown> : null;
          return [{ id: row.id, status: row.status, errorCode: row.errorCode, phase: session.phase,
            sessionKey: session.sessionKey, capabilityHash: receipt?.capabilityHash, receiptSessionKey: receipt?.sessionKey,
            expiresAt: receipt?.expiresAt }];
        });
        const started = transitions.find(item => item.phase === "start" && item.status === "SUCCEEDED");
        const refreshed = transitions.find(item => item.phase === "refresh" && item.status === "SUCCEEDED");
        const stopped = transitions.find(item => item.phase === "stop" && item.status === "SUCCEEDED");
        const runtimeFacts = facts.sandboxRuntimeFacts && typeof facts.sandboxRuntimeFacts === "object"
          ? facts.sandboxRuntimeFacts as Record<string, unknown> : {};
        const safeHostFailures = Array.isArray(runtimeFacts.sandboxExecutionFailures) ? runtimeFacts.sandboxExecutionFailures.slice(0, 12).map(value => {
          const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
          return { phase: row.phase, action: row.action, errorCode: row.errorCode, probeCaseId: row.probeCaseId,
            issues: row.issues, requestFacts: row.requestFacts, hostCliOperations: row.hostCliOperations };
        }) : [];
        receiptFacts = { runId: facts.run.id, transitions, observedHostReceipts, safeHostFailures,
          runStatus: facts.run.status, runErrorCode: facts.run.errorCode ?? null };
        expect(facts.run.status, JSON.stringify({ runStatus: facts.run.status,
          runErrorCode: facts.run.errorCode ?? null, safeHostFailures })).toBe("succeeded");
        expect(started).toMatchObject({ sessionKey: expect.stringMatching(/^[a-f0-9]{64}$/),
          capabilityHash: expect.stringMatching(/^[a-f0-9]{64}$/), receiptSessionKey: expect.any(String), expiresAt: expect.any(String) });
        expect(refreshed).toMatchObject({ sessionKey: started?.sessionKey,
          capabilityHash: expect.stringMatching(/^[a-f0-9]{64}$/), receiptSessionKey: started?.sessionKey });
        expect(stopped).toMatchObject({ sessionKey: started?.sessionKey,
          capabilityHash: expect.stringMatching(/^[a-f0-9]{64}$/), receiptSessionKey: started?.sessionKey });
        expect(transitions.filter(item => item.phase === "start")).toHaveLength(1);
        transitionCapabilityHashes = { start: started?.capabilityHash as string ?? null,
          refresh: refreshed?.capabilityHash as string ?? null, stop: stopped?.capabilityHash as string ?? null };
      } });
    expect(result.success, JSON.stringify({ runStatus: result.runStatus, error: result.run?.error,
      errorCode: result.run?.errorCode, sandboxRuntimeFacts: result.sandboxRuntimeFacts, receiptFacts })).toBe(true);
    expect(result.sandboxRuntimeFacts).toMatchObject({ mode: "controlled_signed_host_relay",
      nativeSessionStartCredentialNegativeControls: { missingTokenDenied: true, mismatchedTokenDenied: true } });
    const hostSessionReceipts = observedHostReceipts;
    expect(hostSessionReceipts.map(receipt => receipt.phase)).toEqual(expect.arrayContaining(["start", "refresh", "stop"]));
    expect(new Set(hostSessionReceipts.map(receipt => receipt.sessionKey)).size).toBe(1);
    expect(new Set(hostSessionReceipts.map(receipt => receipt.sessionDeadlineAt)).size).toBe(1);
    expect(hostSessionReceipts.every(receipt => Date.parse(receipt.expiresAt) <= Date.parse(receipt.sessionDeadlineAt))).toBe(true);
    expect(hostSessionReceipts[0]?.capabilityHash).toBe(transitionCapabilityHashes.start);
    expect(hostSessionReceipts.filter(receipt => receipt.phase === "refresh").some(receipt => receipt.capabilityHash === transitionCapabilityHashes.refresh)).toBe(true);
    expect(hostSessionReceipts.at(-1)?.phase).toBe("stop");
    expect(hostSessionReceipts.at(-1)?.capabilityHash).toBe(transitionCapabilityHashes.stop);
    expect(result.sandboxRuntimeFacts?.attachedModelBrokerProviderCount).toBe(0);
    expect(configuredHost).not.toBeNull();
    await expect(configuredHost!.modelRequest({}, new AbortController().signal))
      .rejects.toThrow("sandbox_session_provider_not_running");
    expect(receiptFacts).not.toBeNull();
  }, 450_000);
});
