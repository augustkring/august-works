import { randomUUID } from "node:crypto";
import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import { discoverA2ACapabilities, readA2AJsonResponse } from "./a2a-capabilities.js";
import { guardedHttpAdapterFetch } from "../adapters/http/remote-fetch.js";
import { makeProviderCapabilitySnapshot } from "./provider-capabilities.js";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value : "";
const partsText = (value: unknown) => Array.isArray(value) ? value.map(part => text(object(part).text)).join("") : "";
const terminal = (state: string) => ["completed", "canceled", "failed", "rejected"].includes(state);

/** A2A 0.3 JSON-RPC. Unknown versions/transports remain discovery-only. */
export async function executeA2A(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const binding = ctx.providerRuntime;
  if (!binding || binding.providerType !== "a2a") throw new Error("A2A requires an authorized V5 binding");
  await ctx.onCancellationReady?.();
  if (ctx.signal?.aborted) return { exitCode: 1, signal: null, timedOut: false, errorCode: "cancelled", resultJson: { status: "canceled", stopConfirmed: true } };
  const card = await discoverA2ACapabilities({ companyId: ctx.agent.companyId, adapterType: "http", config: ctx.config });
  const url = text(ctx.config.url);
  if (card.protocolVersion !== "0.3.0" || !card.interfaces?.some(entry => entry.protocol.toUpperCase() === "JSONRPC" && entry.url === url) || binding.providerProfileRef !== url || card.providerAgentRef !== binding.providerAgentRef || makeProviderCapabilitySnapshot(card).hash !== binding.capabilitySnapshotHash) return { exitCode: 1, signal: null, timedOut: false, errorCode: "provider_capability_drift", summary: "A2A advertisement changed; repeat discovery and conformance" };
  const headers = { ...object(ctx.config.headers), "content-type": "application/json", Accept: "application/json, text/event-stream" } as Record<string, string>;
  const timeout = AbortSignal.timeout(Math.min(300_000, Math.max(1_000, Number(ctx.config.timeoutSec || 30) * 1000)));
  const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;
  let taskId = "", contextId = ctx.runtime.sessionId ?? "", state = "", output = "", dispatched = false;
  let reportedCost: number | undefined;
  const artifacts = new Map<string, string>();
  function consume(raw: unknown) {
    const value = object(raw);
    if (!["task", "message", "status-update", "artifact-update"].includes(text(value.kind))) throw new Error("Unknown A2A response kind");
    const incomingTask = text(value.kind === "task" ? value.id : value.taskId), incomingContext = text(value.contextId);
    if (incomingTask && taskId && incomingTask !== taskId) throw new Error("A2A response changed task ownership");
    if (incomingContext && contextId && incomingContext !== contextId) throw new Error("A2A response changed session ownership");
    taskId ||= incomingTask; contextId ||= incomingContext;
    const status = object(value.status); let nextState = text(status.state) || state, nextOutput = output;
    const artifact = object(value.artifact);
    if (artifact.artifactId) {
      const id = text(artifact.artifactId), delta = partsText(artifact.parts);
      artifacts.set(id, value.append === true ? (artifacts.get(id) ?? "") + delta : delta);
      nextOutput = [...artifacts.values()].join("\n");
    } else if (Array.isArray(value.artifacts) && value.artifacts.length) nextOutput = value.artifacts.map(item => partsText(object(item).parts)).join("\n");
    else if (value.kind === "message") { if (value.role !== "agent") throw new Error("A2A returned a non-agent message"); nextOutput = partsText(value.parts); nextState = "completed"; }
    else if (object(status.message).parts) nextOutput = partsText(object(status.message).parts);
    else if (Array.isArray(value.history)) {
      const message = value.history.filter(item => object(item).role === "agent").at(-1);
      if (message) nextOutput = partsText(object(message).parts);
    }
    if (Buffer.byteLength(nextOutput, "utf8") > 1_048_576) throw new Error("A2A output exceeds the execution bound");
    output = nextOutput; state = nextState;
    const cost = object(value.metadata).costUsd;
    if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0) reportedCost = cost;
  }
  async function rpc(method: string, params: unknown, requestSignal: AbortSignal, streaming = false) {
    const id = randomUUID();
    const response = await guardedHttpAdapterFetch(url, { method: "POST", headers, redirect: "error", signal: requestSignal, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`A2A request failed (${response.status})`); }
    async function receive(raw: unknown) {
      const envelope = object(raw);
      if (envelope.jsonrpc !== "2.0" || envelope.id !== id || envelope.error || !envelope.result) throw new Error("A2A returned an invalid RPC response");
      if (["tasks/get", "tasks/cancel"].includes(method) && (object(envelope.result).kind !== "task" || object(envelope.result).id !== taskId || object(envelope.result).contextId !== contextId)) throw new Error("A2A observation requires the owned task receipt");
      consume(envelope.result);
      if (streaming) await ctx.onLog("stdout", "[a2a:event] retained provider event\n");
    }
    if (!response.headers.get("content-type")?.includes("text/event-stream")) return receive(await readA2AJsonResponse(response));
    if (!streaming || !response.body) { await response.body?.cancel(); throw new Error("Unexpected A2A stream"); }
    const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = "", bytes = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 8_388_608) throw new Error("A2A stream exceeds the execution bound");
        pending += decoder.decode(chunk.value, { stream: true });
        let match: RegExpExecArray | null;
        while ((match = /\r?\n\r?\n/.exec(pending))) {
          const frame = pending.slice(0, match.index); pending = pending.slice(match.index + match[0].length);
          const data = frame.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
          if (data) await receive(JSON.parse(data));
          if (terminal(state)) { await reader.cancel(); return; }
        }
        if (pending.length > 1_048_576) throw new Error("A2A event exceeds the frame bound");
      }
      if (pending.trim()) throw new Error("A2A stream ended with an incomplete event");
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  function result(unconfirmed = false): AdapterExecutionResult {
    const cancelled = state === "canceled" && signal.aborted, succeeded = state === "completed" && !unconfirmed;
    return { exitCode: succeeded ? 0 : 1, signal: null, timedOut: timeout.aborted && !ctx.signal?.aborted, errorCode: unconfirmed ? "cancellation_unconfirmed" : cancelled ? "cancelled" : succeeded ? null : "a2a_failed", errorMessage: unconfirmed ? "A2A termination is unconfirmed" : null, provider: "a2a", model: null, costUsd: reportedCost, sessionId: contextId || null, resultJson: { status: succeeded ? "completed" : cancelled ? "canceled" : "failed", output, taskId, providerReceipt: { agentId: card.providerAgentRef, profileRef: url, sessionId: contextId }, stopConfirmed: !unconfirmed }, summary: unconfirmed ? "A2A termination is unconfirmed" : `A2A task ${state}` };
  }
  try {
    const prompt = text(object(ctx.config.payloadTemplate).input) || [text(ctx.context.paperclipTaskMarkdown), text(ctx.context.v5GovernedContext)].filter(Boolean).join("\n\n");
    if (!prompt || Buffer.byteLength(prompt, "utf8") > 64_000) throw new Error("A2A execution requires a bounded task prompt");
    signal.throwIfAborted(); ctx.onDispatch?.(); dispatched = true;
    const message = { kind: "message", role: "user", messageId: randomUUID(), parts: [{ kind: "text", text: prompt }], ...(contextId ? { contextId } : {}) };
    await rpc(card.streaming ? "message/stream" : "message/send", { message, configuration: { blocking: false, acceptedOutputModes: ["text/plain", "application/json"] } }, signal, card.streaming === true);
    while (!terminal(state)) {
      if (!taskId) throw new Error("A2A did not return a task to observe");
      await new Promise<void>((resolve, reject) => { const done = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); }; const abort = () => { done(); reject(signal.reason); }; const timer = setTimeout(() => { done(); resolve(); }, 250); signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort(); });
      await rpc("tasks/get", { id: taskId, historyLength: 1 }, signal);
    }
    return result();
  } catch {
    if (dispatched && taskId && !terminal(state)) {
      try { await rpc("tasks/cancel", { id: taskId }, AbortSignal.timeout(5_000)); } catch { /* no stop receipt means unconfirmed */ }
    }
    return result(dispatched && !terminal(state));
  }
}
