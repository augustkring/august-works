import { afterEach, describe, expect, it, vi } from "vitest";
import { executeWorkflowHttpRequest, workflowHttpConfig } from "./workflow-http-request.js";

afterEach(() => vi.unstubAllGlobals());
const url = "https://8.8.8.8/data";
const signal = () => new AbortController().signal;

describe("workflow HTTP request", () => {
  it.each(["http://8.8.8.8", "https://user:password@8.8.8.8", "https://8.8.8.8?access_token=secret"])("rejects unsafe published configuration %s", (value) => {
    expect(workflowHttpConfig.safeParse({ url: value }).success).toBe(false);
  });
  it.each(["https://127.0.0.1", "https://169.254.169.254", "https://[::1]"])("blocks private or metadata targets before dispatch %s", async (value) => {
    const request = vi.fn(); vi.stubGlobal("fetch", request);
    await expect(executeWorkflowHttpRequest({ url: value }, 1_000, signal())).rejects.toMatchObject({ details: { code: "workflow_http_egress_denied" } });
    expect(request).not.toHaveBeenCalled();
  });
  it("validates JSON and never forwards application credentials or follows redirects", async () => {
    const request = vi.fn(async (_url: string | URL, _init: RequestInit) => new Response('{"value":42}', { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", request);
    expect(await executeWorkflowHttpRequest({ url, responseSchema: { type: "object", required: ["value"],
      properties: { value: { type: "integer" } }, additionalProperties: false } }, 1_000, signal())).toEqual({ status: 200, body: { value: 42 }, sizeBytes: 12 });
    expect(request.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual", credentials: "omit", headers: { accept: "application/json" } });
    request.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "http://127.0.0.1" } }));
    await expect(executeWorkflowHttpRequest({ url }, 1_000, signal())).rejects.toMatchObject({ details: { code: "workflow_http_failed" } });
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("bounds streamed responses without trusting Content-Length", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(10)); controller.enqueue(new Uint8Array(10)); controller.close();
    } }))));
    await expect(executeWorkflowHttpRequest({ url, maxResponseBytes: 15 }, 1_000, signal())).rejects.toMatchObject({ details: { code: "workflow_http_response_too_large" } });
  });
  it("propagates cancellation and the absolute request timeout", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url, init: RequestInit) => new Promise((_resolve, reject) => {
      if (init.signal?.aborted) reject(init.signal.reason);
      else init.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
    })));
    await expect(executeWorkflowHttpRequest({ url }, 10, signal())).rejects.toMatchObject({ details: { code: "workflow_http_timeout" } });
    const controller = new AbortController();
    const request = executeWorkflowHttpRequest({ url }, 1_000, controller.signal);
    controller.abort(new Error("Parent cancelled"));
    await expect(request).rejects.toThrow("Parent cancelled");
  });
  it("rejects malformed JSON and structured schema mismatch", async () => {
    const request = vi.fn(async () => new Response("not-json")); vi.stubGlobal("fetch", request);
    await expect(executeWorkflowHttpRequest({ url }, 1_000, signal())).rejects.toMatchObject({ details: { code: "workflow_http_response_invalid" } });
    request.mockResolvedValueOnce(new Response('{"value":"wrong"}'));
    await expect(executeWorkflowHttpRequest({ url, responseSchema: { type: "object", properties: { value: { type: "integer" } } } },
      1_000, signal())).rejects.toMatchObject({ code: "workflow_output_schema_mismatch" });
  });
});
