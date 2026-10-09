import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";
import type { NativeSession, PersistedNativeSession, PrpEvent } from "../vendor/paperclip-runner/index.js";
const mocked = vi.hoisted(() => ({ factory: vi.fn(), money: vi.fn(() => 0.02) }));
vi.mock("../vendor/paperclip-runner/index.js", async (original) => ({ ...await original<Record<string, unknown>>(), createNativeSessionBackend: mocked.factory }));
vi.mock("../services/native-runtime/native-session-executor.js", () => ({ buildNativeProviderEnvironment: (configured: unknown) => configured, nativeUsageCostUsd: mocked.money, normalizeNativeUsage: () => ({ inputTokens: 2, outputTokens: 3 }) }));
import { makeProviderCapabilitySnapshot } from "../services/provider-capabilities.js";
import { discoverNativeCapabilities, executeNativeProviderConformance } from "../services/native-provider-conformance.js";
import { nativeRuntimeAssetsRoot } from "../services/native-runtime/runtime-asset-retention.js";
let root = ""; const originalHome = process.env.PAPERCLIP_HOME;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "aw-native-conformance-")); process.env.PAPERCLIP_HOME = root; mocked.factory.mockReset(); });
afterEach(async () => { if (originalHome === undefined) delete process.env.PAPERCLIP_HOME; else process.env.PAPERCLIP_HOME = originalHome; for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (entry.isDirectory()) await fs.chmod(path.join(entry.parentPath, entry.name), 0o700); await fs.rm(root, { recursive: true, force: true }); });
async function context(controller = new AbortController()): Promise<AdapterExecutionContext> {
  const home = path.join(root, "provider-home"); await fs.mkdir(home, { mode: 0o700 });
  return { runId: "run-1", agent: { id: "presence", companyId: "company", name: "Fixture", adapterType: "paperclip_runner", adapterConfig: {} }, config: { env: { CODEX_HOME: home }, payloadTemplate: { input: "Synthetic probe" } }, runtime: { sessionId: null, sessionDisplayId: null, sessionParams: null, taskKey: null }, context: { providerConformanceIssueId: "retained-harness-task" }, providerRuntime: { providerType: "paperclip_native", providerBindingId: "binding", providerAgentRef: "presence", providerProfileRef: "explicit-profile", sessionNamespace: "company:presence:qualification", isolationMode: "isolated_per_presence", capabilitySnapshotHash: makeProviderCapabilitySnapshot(await discoverNativeCapabilities({ companyId: "company", adapterType: "paperclip_runner", config: {} })).hash }, signal: controller.signal, onLog: vi.fn() };
}
function backendFixture(input: Record<string, any>, options: Record<string, any>, controller?: AbortController, foreign = false, brokenClose = false) {
  expect(input.credentialBindings).toEqual([]); expect(input.runtimeContext.skills).toEqual([]); expect(options.dynamicTools).toEqual([]);
  expect(input.runtimeContext.instructions.bundle.rootPath.startsWith(nativeRuntimeAssetsRoot({ companyId: input.binding.companyId, runId: input.binding.runId }) + path.sep)).toBe(true);
  let identity = { ...input.binding, sessionId: input.session.normalizedSessionId }; delete identity.executionWorkspaceId;
  const snapshot = (): PersistedNativeSession => ({ backendKind: "runner", sessionId: identity.sessionId, providerSessionId: "actual-provider-session", identity: { ...identity } } as PersistedNativeSession);
  const session: NativeSession = {
    identity: () => ({ ...identity, ...(foreign ? { agentId: "foreign-presence" } : {}) }), capabilities: async () => ({ resume: true, typedEvents: true, steering: false, interruption: true, structuredResult: false }),
    attachRun: async ({ identity: next }) => { identity = { ...next }; },
    startTurn: async () => { if (controller) controller.abort(); return { turnId: "turn" }; },
    events: async function* () { yield { runId: identity.runId, normalizedSessionId: identity.sessionId, turnId: "turn", eventType: "item.delta", payload: { kind: "agentMessage", text: "synthetic response" } } as PrpEvent; yield { runId: identity.runId, normalizedSessionId: identity.sessionId, turnId: "turn", eventType: "turn.completed", payload: {} } as PrpEvent; },
    result: async () => null, usage: async () => ({ providerCostUsd: 0.02 }), snapshot: async () => snapshot(),
    cancel: vi.fn(() => ({ cleanup: Promise.resolve() })), close: vi.fn(async () => { if (brokenClose) throw new Error("Missing stop acknowledgement"); }),
  };
  return { openSession: vi.fn(async () => session), recoverSession: vi.fn(async () => ({ recovered: true, session })), session };
}
it("uses the retained native backend, keeps synthetic tools empty and resumes its actual session", async () => {
  const ctx = await context(); let last!: ReturnType<typeof backendFixture>;
  mocked.factory.mockImplementation((input, options) => last = backendFixture(input, options));
  const first = await executeNativeProviderConformance(ctx);
  expect(first).toMatchObject({ exitCode: 0, costUsd: 0.02, sessionId: "actual-provider-session", resultJson: { output: "synthetic response", stopConfirmed: true, providerReceipt: { agentId: "presence", profileRef: "explicit-profile" } } });
  ctx.runId = "run-2"; ctx.runtime.sessionParams = first.sessionParams!; ctx.runtime.sessionId = first.sessionId!;
  const resumed = await executeNativeProviderConformance(ctx);
  expect(resumed.exitCode).toBe(0); expect(last.recoverSession).toHaveBeenCalledTimes(1); expect(last.openSession).not.toHaveBeenCalled(); expect(last.session.identity().runId).toBe("run-2");
  expect(mocked.factory.mock.calls[1][0].runtimeContext.aggregateDigest).toBe(mocked.factory.mock.calls[0][0].runtimeContext.aggregateDigest);
  await expect(fs.stat(path.join(nativeRuntimeAssetsRoot(), "bundles"))).rejects.toMatchObject({ code: "ENOENT" });
});
it.each([true, false])("requires provider close acknowledgement on cancel (confirmed=%s)", async (confirmed) => {
  const controller = new AbortController(), ctx = await context(controller); let last!: ReturnType<typeof backendFixture>;
  mocked.factory.mockImplementation((input, options) => last = backendFixture(input, options, controller, false, !confirmed));
  const result = await executeNativeProviderConformance(ctx);
  expect(result.errorCode).toBe(confirmed ? "cancelled" : "cancellation_unconfirmed"); expect(result.resultJson?.stopConfirmed).toBe(confirmed);
  expect(last.session.cancel).toHaveBeenCalled(); expect(last.session.close).toHaveBeenCalled(); expect(result.sessionParams).toBeNull();
});
it("rejects a foreign native identity before starting a turn", async () => {
  const ctx = await context(); mocked.factory.mockImplementation((input, options) => backendFixture(input, options, undefined, true));
  const result = await executeNativeProviderConformance(ctx); expect(result.errorCode).toBe("native_conformance_failed"); expect(ctx.onLog).not.toHaveBeenCalled();
});
it("rejects shared permissions, mutable home aliases and unavailable native transports before dispatch", async () => {
  const ctx = await context(); await fs.chmod((ctx.config.env as any).CODEX_HOME, 0o755);
  await expect(executeNativeProviderConformance(ctx)).rejects.toThrow("private"); expect(mocked.factory).not.toHaveBeenCalled();
  await fs.chmod((ctx.config.env as any).CODEX_HOME, 0o700);
  const alias = path.join(root, "home-alias"); await fs.symlink((ctx.config.env as any).CODEX_HOME, alias); ctx.config.env = { CODEX_HOME: alias };
  await expect(executeNativeProviderConformance(ctx)).rejects.toThrow("private");
  await expect(discoverNativeCapabilities({ companyId: "company", adapterType: "paperclip_runner", config: { provider: "claude_managed", model: "claude-sonnet-5", managedProfileId: "profile", managedAgentsRetentionAcknowledged: true } })).rejects.toThrow();
});

it("rejects a changed static native contract before opening a provider session", async () => {
  const ctx = await context(); ctx.providerRuntime!.capabilitySnapshotHash = "former-native-contract";
  await expect(executeNativeProviderConformance(ctx)).rejects.toThrow("capability contract changed"); expect(mocked.factory).not.toHaveBeenCalled();
});

it("advertises the draft's actual fresh contract without qualifying it or falling back to ordinary provider probes", async () => {
  const ctx = await context();
  ctx.config = { provider: "aw_text_only", model: "fixture-worker-model", workerModelProfileId: "10000000-0000-4000-8000-000000000001", maxOutputTokens: 256 };
  const advertised = await discoverNativeCapabilities({ companyId: "company", adapterType: "paperclip_runner", config: ctx.config });
  expect(advertised).toMatchObject({ provider: "paperclip_native", features: { sessions: false, cancellation: true, memoryScoping: true } });
  expect(advertised.version).toContain("aw-text-draft-v1:aw_text_messages");
  ctx.providerRuntime!.capabilitySnapshotHash = makeProviderCapabilitySnapshot(advertised).hash;
  await expect(executeNativeProviderConformance(ctx)).rejects.toThrow("Unsupported native conformance backend");
  expect(mocked.factory).not.toHaveBeenCalled();
});
