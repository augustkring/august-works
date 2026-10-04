import { beforeEach, expect, it, vi } from "vitest";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";
const mocked = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../adapters/http/remote-fetch.js", () => ({ guardedHttpAdapterFetch: mocked.fetch }));
import { executeA2A } from "../services/a2a-execution.js";
import { mapA2AAgentCard } from "../services/a2a-capabilities.js";
import { makeProviderCapabilitySnapshot } from "../services/provider-capabilities.js";

const card = { name: "Protocol fixture", version: "1", protocolVersion: "0.3.0", url: "https://provider.example/a2a", capabilities: { streaming: true }, skills: [] };
function context(controller = new AbortController()): AdapterExecutionContext {
  return { runId: "retained-run", agent: { id: "presence", companyId: "company", name: "Fixture", adapterType: "http", adapterConfig: {} }, config: { url: card.url, timeoutSec: 3, payloadTemplate: { input: "Synthetic protocol probe" } }, runtime: { sessionId: null, sessionDisplayId: null, sessionParams: null, taskKey: null }, context: {}, providerRuntime: { providerType: "a2a", providerBindingId: "binding", providerAgentRef: card.name, providerProfileRef: card.url, sessionNamespace: "scope", isolationMode: "shared_trusted_runtime", capabilitySnapshotHash: makeProviderCapabilitySnapshot(mapA2AAgentCard(card)).hash }, signal: controller.signal, onLog: vi.fn() };
}
const task = (state: string, extra = {}) => ({ kind: "task", id: "owned-task", contextId: "owned-context", status: { state }, ...extra });
const json = (request: Record<string, unknown>, result: unknown) => Response.json({ jsonrpc: "2.0", id: request.id, result });
beforeEach(() => { mocked.fetch.mockReset(); });
it("consumes fragmented SSE, retains provider context and reports only received cost", async () => {
  mocked.fetch.mockImplementation(async (_url, init) => {
    if (init.method === "GET") return Response.json(card);
    const request = JSON.parse(init.body); expect(request.method).toBe("message/stream");
    const frames = [task("working"), { kind: "artifact-update", taskId: "owned-task", contextId: "owned-context", artifact: { artifactId: "a", parts: [{ kind: "text", text: "æ" }] } }, task("completed", { metadata: { costUsd: 0.0123 } })];
    const bytes = new TextEncoder().encode(frames.map(result => `data: ${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\r\n\r\n`).join(""));
    return new Response(new ReadableStream({ start(stream) { for (let i = 0; i < bytes.length; i++) stream.enqueue(bytes.slice(i, i + 1)); stream.close(); } }), { headers: { "content-type": "text/event-stream" } });
  });
  const ctx = context(), result = await executeA2A(ctx);
  expect(result).toMatchObject({ exitCode: 0, costUsd: 0.0123, sessionId: "owned-context", resultJson: { output: "æ", stopConfirmed: true, providerReceipt: { agentId: card.name, profileRef: card.url } } });
  expect(ctx.onLog).toHaveBeenCalledTimes(3);
});
it("uses message/send when streaming is absent, then observes the retained task", async () => {
  const plain = { ...card, capabilities: { streaming: false } }, ctx = context();
  ctx.providerRuntime!.capabilitySnapshotHash = makeProviderCapabilitySnapshot(mapA2AAgentCard(plain)).hash;
  ctx.runtime.sessionId = "owned-context";
  mocked.fetch.mockImplementation(async (_url, init) => {
    if (init.method === "GET") return Response.json(plain);
    const request = JSON.parse(init.body);
    if (request.method === "message/send") { expect(request.params.message.contextId).toBe("owned-context"); return json(request, task("working")); }
    expect(request).toMatchObject({ method: "tasks/get", params: { id: "owned-task" } });
    return json(request, task("completed"));
  });
  const result = await executeA2A(ctx); expect(result.exitCode).toBe(0); expect(result.costUsd).toBeUndefined(); expect(ctx.onLog).not.toHaveBeenCalled();
});
it.each([true, false])("cancellation needs an actual stop receipt (confirmed=%s)", async (confirmed) => {
  const controller = new AbortController(); const signals: AbortSignal[] = [];
  mocked.fetch.mockImplementation(async (_url, init) => {
    if (init.method === "GET") return Response.json(card);
    const request = JSON.parse(init.body);
    if (request.method === "message/stream") { controller.abort(); return json(request, task("working")); }
    expect(request.method).toBe("tasks/cancel"); signals.push(init.signal);
    if (!confirmed) throw new Error("Lost provider connection");
    return json(request, task("canceled"));
  });
  const result = await executeA2A(context(controller));
  expect(result.errorCode).toBe(confirmed ? "cancelled" : "cancellation_unconfirmed");
  expect(result.resultJson?.stopConfirmed).toBe(confirmed); expect(signals[0]!.aborted).toBe(false);
});
it.each(["identity", "profile", "version", "hash"])("rejects %s drift before provider dispatch", async (kind) => {
  const ctx = context(); let advertised = card;
  if (kind === "identity") ctx.providerRuntime!.providerAgentRef = "another-agent";
  if (kind === "profile") ctx.providerRuntime!.providerProfileRef = "arbitrary-profile-label";
  if (kind === "hash") ctx.providerRuntime!.capabilitySnapshotHash = "changed";
  if (kind === "version") advertised = { ...card, protocolVersion: "future" };
  mocked.fetch.mockResolvedValue(Response.json(advertised));
  expect((await executeA2A(ctx)).errorCode).toBe("provider_capability_drift");
  expect(mocked.fetch).toHaveBeenCalledTimes(1);
});
it("rejects a foreign task/session and cannot accept its success as a stop receipt", async () => {
  mocked.fetch.mockImplementation(async (_url, init) => {
    if (init.method === "GET") return Response.json(card);
    const request = JSON.parse(init.body);
    if (request.method === "message/stream") return json(request, task("working"));
    return json(request, task("completed", { id: "foreign-task", contextId: "foreign-context" }));
  });
  const result = await executeA2A(context()); expect(result.errorCode).toBe("cancellation_unconfirmed"); expect(result.resultJson?.stopConfirmed).toBe(false);
});
it("cannot accept an oversized terminal stream result as success", async () => {
  mocked.fetch.mockImplementation(async (_url, init) => {
    if (init.method === "GET") return Response.json(card);
    const request = JSON.parse(init.body);
    if (request.method === "tasks/cancel") return json(request, task("canceled"));
    const artifact = (id: string) => ({ kind: "artifact-update", taskId: "owned-task", contextId: "owned-context", artifact: { artifactId: id, parts: [{ kind: "text", text: "a".repeat(600_000) }] } });
    const frames = [task("working"), artifact("a"), artifact("b"), task("completed")];
    return new Response(frames.map(result => `data: ${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
  });
  const result = await executeA2A(context());
  expect(result.exitCode).toBe(1); expect(result.errorCode).toBe("a2a_failed"); expect(result.resultJson?.stopConfirmed).toBe(true);
  expect(Buffer.byteLength(String(result.resultJson?.output))).toBeLessThanOrEqual(1_048_576);
});

it("registers host cancellation before metadata or provider dispatch", async () => {
  const controller = new AbortController(), ctx = context(controller); ctx.onCancellationReady = async () => { controller.abort(); };
  const result = await executeA2A(ctx); expect(result.errorCode).toBe("cancelled"); expect(result.resultJson?.stopConfirmed).toBe(true); expect(mocked.fetch).not.toHaveBeenCalled();
});
it("cannot substitute a message for an owned task stop receipt", async () => {
  const controller = new AbortController();
  mocked.fetch.mockImplementation(async (_url, init) => {
    if (init.method === "GET") return Response.json(card);
    const request = JSON.parse(init.body);
    if (request.method === "message/stream") { controller.abort(); return json(request, task("working")); }
    return json(request, { kind: "message", role: "agent", contextId: "owned-context", parts: [{ kind: "text", text: "Stopped, trust me" }] });
  });
  const result = await executeA2A(context(controller)); expect(result.errorCode).toBe("cancellation_unconfirmed"); expect(result.resultJson?.stopConfirmed).toBe(false);
});
