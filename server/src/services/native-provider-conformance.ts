import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { AdapterExecutionContext, AdapterExecutionResult, ServerAdapterModule } from "@paperclipai/adapter-utils";
import { PROVIDER_CAPABILITY_FEATURES } from "@paperclipai/shared";
import { createNativeSessionBackend, PAPERCLIP_EXECUTION_PROMPT, PAPERCLIP_EXECUTION_PROMPT_REVISION, canonicalNativeRuntimeContextDigest, nativeRuntimePromptDigest, type NativeSession, type PersistedNativeSession } from "../vendor/paperclip-runner/index.js";
import { resolvePaperclipInstanceRoot } from "../home-paths.js";
import { resolvePaperclipRunnerProviderProfile } from "./native-runtime/provider-profile.js";
import { buildNativeExecutionInput } from "./native-runtime/native-execution-input.js";
import { materializeAsset } from "./native-runtime/runtime-context.js";
import { makeProviderCapabilitySnapshot } from "./provider-capabilities.js";
import { nativeToolContractFingerprintForTarget } from "./native-runtime/native-session-resume.js";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Static contract for the included local backend. Only retained probes qualify it. */
export const discoverNativeCapabilities: NonNullable<ServerAdapterModule["discoverCapabilities"]> = async (ctx) => {
  const profile = resolvePaperclipRunnerProviderProfile(ctx.config);
  if (ctx.adapterType !== "paperclip_runner" || !["codex", "opencode", "acpx", "aw_text_only"].includes(profile.provider)) throw new Error("This native provider needs its own conformance transport");
  const features = Object.fromEntries(PROVIDER_CAPABILITY_FEATURES.map(key => [key, false])) as Record<(typeof PROVIDER_CAPABILITY_FEATURES)[number], boolean>;
  features.sessions = profile.provider !== "aw_text_only"; features.cancellation = true; features.memoryScoping = true;
  // Advertising this fixed contract never runs a probe or fabricates retained
  // conformance. Internal drafts have no persistent provider-session transport.
  if (profile.provider === "aw_text_only") return { provider: "paperclip_native", version: `aw-text-draft-v1:${profile.backend}:${nativeToolContractFingerprintForTarget("local")}`, features, skills: [], tools: [], discoveredAt: new Date().toISOString() };
  return { provider: "paperclip_native", version: `local-v1:${profile.backend}:${nativeToolContractFingerprintForTarget("local")}`, features, skills: [], tools: [], discoveredAt: new Date().toISOString() };
};

/** Synthetic, tool-free probes use the existing backend, never the legacy adapter. */
export async function executeNativeProviderConformance(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const binding = ctx.providerRuntime, issueId = ctx.context.providerConformanceIssueId;
  if (binding?.providerType !== "paperclip_native" || typeof issueId !== "string") throw new Error("Native probes require a retained company harness task");
  const capabilities = await discoverNativeCapabilities({ companyId: ctx.agent.companyId, adapterType: ctx.agent.adapterType ?? "", config: ctx.config });
  if (makeProviderCapabilitySnapshot(capabilities).hash !== binding.capabilitySnapshotHash) throw new Error("Native capability contract changed; repeat discovery");
  const profile = resolvePaperclipRunnerProviderProfile(ctx.config);
  if (profile.provider !== "codex" && profile.provider !== "opencode" && profile.provider !== "acpx") throw new Error("Unsupported native conformance backend");
  const prompt = record(ctx.config.payloadTemplate).input;
  if (typeof prompt !== "string" || !prompt.trim() || Buffer.byteLength(prompt) > 64_000) throw new Error("Native probe prompt exceeds its bound");
  const sessionId = digest(binding.sessionNamespace);
  const root = path.join(resolvePaperclipInstanceRoot(), "runtime", "provider-conformance", sessionId);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const cwd = path.join(root, "workspace"); await fs.mkdir(cwd, { recursive: true, mode: 0o700 });
  const configured = Object.fromEntries(Object.entries(record(ctx.config.env)).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  let isolationKey = digest(root);
  if (profile.provider === "codex") {
    // Native Codex reads provider-local state from CODEX_HOME. A display name
    // cannot prove physical separation; require the actual configured home.
    if (!configured.CODEX_HOME || !path.isAbsolute(configured.CODEX_HOME)) throw new Error("Native conformance requires an explicit presence-private CODEX_HOME");
    const home = await fs.realpath(configured.CODEX_HOME), stat = await fs.stat(home);
    if (path.resolve(configured.CODEX_HOME) !== home || !stat.isDirectory() || (stat.mode & 0o077) || stat.uid !== process.getuid?.()) throw new Error("Native profile home must be private and owned by this process");
    configured.CODEX_HOME = home; isolationKey = digest(home);
  }
  const { buildNativeProviderEnvironment, nativeUsageCostUsd, normalizeNativeUsage } = await import("./native-runtime/native-session-executor.js");
  const environment = buildNativeProviderEnvironment(configured, process.env, cwd);
  const bundle = await materializeAsset([{ path: "AGENTS.md", content: Buffer.from("This is a synthetic provider qualification. Use no tools, files, company data or external resources. Reply only to the probe.\n"), mode: 0o444 }], { companyId: ctx.agent.companyId, runId: ctx.runId });
  const context = { prompt: { revision: PAPERCLIP_EXECUTION_PROMPT_REVISION, text: PAPERCLIP_EXECUTION_PROMPT, digest: nativeRuntimePromptDigest() }, instructions: { entryPath: "AGENTS.md", bundle }, skills: [], mcp: { assignmentSetId: "provider-conformance:no-tools", digest: digest("[]"), bindingId: null } };
  const contract = { revision: "1", objective: "Answer this synthetic probe without tools or company context", criteria: [{ id: "synthetic", requirement: "Return only the requested probe response" }] };
  const input = buildNativeExecutionInput({ companyId: ctx.agent.companyId, runId: ctx.runId, agentId: ctx.agent.id, issue: { id: issueId, identifier: null, title: "Synthetic provider conformance", description: null, workMode: "standard" }, taskPrompt: prompt, workspace: { id: sessionId, cwd, repoUrl: null, repoRef: null, branchName: null }, normalizedSessionId: sessionId, provider: profile.provider, model: profile.model, ...(profile.provider === "acpx" ? { acpxAgent: profile.acpxAgent, acpxPermissionMode: "approve-reads" as const } : {}), codexApprovalPolicy: "untrusted", opencodePermissionMode: "deny", completionContract: { id: `conformance:${issueId}`, sha256: digest(JSON.stringify(contract)), schemaVersion: "paperclip.completion-contract.v1", contract }, runtimeContext: { ...context, aggregateDigest: canonicalNativeRuntimeContextDigest(context) } });
  const backend = createNativeSessionBackend(input, { environment, opencodeEnvironment: environment, acpxEnvironment: environment, opencodeRuntimeDirectory: path.join(root, "opencode"), acpxRuntimeDirectory: path.join(root, "acpx"), dynamicTools: [], dynamicToolHandler: async () => { throw new Error("Conformance has no platform tool authority"); } });
  const identity = { runId: ctx.runId, sessionId, companyId: ctx.agent.companyId, issueId, agentId: ctx.agent.id };
  const signal = ctx.signal ?? AbortSignal.timeout(20_000);
  let session: NativeSession | undefined, snapshot: PersistedNativeSession | undefined, output = "", state = "failed", stopped = false;
  let usage: Record<string, unknown> | null = null;
  let rejectAbort: (reason: unknown) => void = () => {};
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  // Observe even an abort during bootstrap, before the event-loop race begins.
  void aborted.catch(() => {});
  // ponytail: reuse the backend close contract; a broken close remains unknown.
  async function bounded<T>(operation: Promise<T>, milliseconds = 5_000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Native cleanup deadline")), milliseconds); })]); }
    finally { clearTimeout(timer); }
  }
  const abort = () => { rejectAbort(signal.reason ?? new Error("Native probe aborted")); if (session?.cancel) { try { void session.cancel({ reason: "provider_conformance_cancelled", signal: AbortSignal.timeout(5_000) }).cleanup.catch(() => {}); } catch { /* close still must prove settlement */ } } };
  try {
    const previous = ctx.runtime.sessionParams?.nativeConformanceSnapshot as PersistedNativeSession | undefined;
    if (previous) {
      if (previous.identity.companyId !== identity.companyId || previous.identity.agentId !== identity.agentId || previous.identity.issueId !== issueId || previous.identity.sessionId !== sessionId || !backend.recoverSession) throw new Error("Native probe checkpoint ownership changed");
      const recovered = await backend.recoverSession(previous, { signal });
      if (!recovered.recovered || !recovered.session?.attachRun) throw new Error("Native probe could not resume the provider session");
      session = recovered.session; await recovered.session.attachRun({ identity });
    } else session = await backend.openSession({ identity, workingDirectory: cwd, signal });
    if (JSON.stringify(session.identity()) !== JSON.stringify(identity)) {
      const actual = session.identity();
      if (Object.entries(identity).some(([key, value]) => actual[key as keyof typeof actual] !== value)) throw new Error("Native backend returned foreign execution identity");
    }
    signal.addEventListener("abort", abort, { once: true }); signal.throwIfAborted();
    snapshot = await session.snapshot({ signal });
    ctx.onDispatch?.();
    await Promise.race([aborted, (async () => {
    const { turnId } = await session!.startTurn({ message: { role: "user", text: prompt }, ...(previous ? { continuation: true as const } : {}) });
    if (snapshot) snapshot = { ...snapshot, activeTurnId: turnId };
    for await (const event of session!.events()) {
      signal.throwIfAborted();
      if (event.runId !== ctx.runId || event.normalizedSessionId !== sessionId || event.turnId && event.turnId !== turnId) throw new Error("Native event ownership changed");
      await ctx.onLog("stdout", `[native-conformance:event] ${event.eventType}\n`);
      if (event.payload.kind === "agentMessage" && typeof event.payload.text === "string") {
        const nextOutput = event.eventType === "item.delta" ? output + event.payload.text : event.payload.text;
        if (Buffer.byteLength(nextOutput) > 1_048_576) throw new Error("Native output exceeds the execution bound");
        output = nextOutput;
      }
      if (event.eventType === "turn.completed") { state = "completed"; break; }
      if (["turn.cancelled", "turn.interrupted", "turn.failed"].includes(event.eventType)) { state = event.eventType === "turn.cancelled" ? "cancelled" : "failed"; break; }
      signal.throwIfAborted();
    }
    signal.throwIfAborted();
    usage = await session!.usage?.() ?? null;
    snapshot = await session!.snapshot({ signal });
    })()]);
  } catch { state = signal.aborted ? "cancelled" : "failed"; }
  finally {
    signal.removeEventListener("abort", abort);
    if (session) {
      try { await bounded(session.close({ reason: "provider_conformance_settled" })); stopped = true; } catch { stopped = false; }
      if (!usage && stopped && session.usage) { try { usage = await bounded(session.usage()); } catch { /* missing accounting remains unknown */ } }
    }
  }
  // No returned session means the backend owns aborted bootstrap cleanup.
  const unknown = Boolean(session) && !stopped;
  return { exitCode: state === "completed" && !unknown ? 0 : 1, signal: null, timedOut: false, provider: "paperclip_native", model: profile.model, costUsd: nativeUsageCostUsd(usage), usage: normalizeNativeUsage(usage), errorCode: unknown ? "cancellation_unconfirmed" : state === "cancelled" && stopped ? "cancelled" : state === "completed" ? null : "native_conformance_failed", sessionId: snapshot?.providerSessionId ?? ctx.runtime.sessionId, sessionParams: snapshot && stopped && state === "completed" ? { nativeConformanceSnapshot: snapshot } : null, resultJson: { status: unknown ? "unknown" : state, output, stopConfirmed: stopped, ...(unknown && snapshot ? { nativeConformanceRecoverySnapshot: snapshot } : {}), providerReceipt: { agentId: identity.agentId, profileRef: binding.providerProfileRef, sessionId: snapshot?.providerSessionId ?? ctx.runtime.sessionId, isolationKey } } };
}
