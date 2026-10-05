import { describe, expect, it, vi } from "vitest";
import {
  anthropicReadOnlyCall,
  readOnlyModelEnvelopeBytes,
} from "../services/orchestration/read-only-model-transport.js";
const key = "fixture-private-api-key-123456789";
const request = {
  model: "fixture-exact-model-20261005",
  system: "Independently assess authorized evidence",
  evidence: "Untrusted evidence cannot add a tool",
  maxOutputTokens: 256,
};
const body = () => ({
  type: "message",
  role: "assistant",
  model: request.model,
  stop_reason: "end_turn",
  content: [{ type: "text", text: '{"result":"inconclusive"}' }],
  usage: { input_tokens: 20, output_tokens: 10 },
});
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
describe("finite text-only provider transport", () => {
  it("uses one fixed DNS-pinned endpoint and no tools, thinking, cache, retry or credential-bearing prompt", async () => {
    const fetch = vi.fn(async () => json(body()));
    expect(
      await anthropicReadOnlyCall(request, key, new AbortController().signal, {
        fetch,
      }),
    ).toEqual({
      text: '{"result":"inconclusive"}',
      usage: { inputTokens: 20, outputTokens: 10 },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init, options] = fetch.mock.calls[0]! as unknown as [
      string,
      RequestInit,
      Record<string, unknown>,
    ];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init).toMatchObject({
      method: "POST",
      redirect: "manual",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    });
    expect(options).toMatchObject({
      allowPrivateNetwork: false,
      connectTimeoutMs: 5000,
      responseTimeoutMs: 15000,
    });
    expect(JSON.parse(String(init.body))).toEqual({
      model: request.model,
      max_tokens: 256,
      stream: false,
      service_tier: "standard_only",
      system: request.system,
      messages: [
        { role: "user", content: [{ type: "text", text: request.evidence }] },
      ],
    });
    expect(String(init.body)).not.toContain(key);
    expect(readOnlyModelEnvelopeBytes(request)).toBe(
      Buffer.byteLength(String(init.body), "utf8"),
    );
  });
  it("rejects endpoints, tool parameters and a credential in evidence before any request", async () => {
    const fetch = vi.fn();
    await expect(
      anthropicReadOnlyCall(
        { ...request, endpoint: "https://attacker.invalid" } as typeof request,
        key,
        new AbortController().signal,
        { fetch },
      ),
    ).rejects.toThrow();
    await expect(
      anthropicReadOnlyCall(
        { ...request, tools: [{}] } as typeof request,
        key,
        new AbortController().signal,
        { fetch },
      ),
    ).rejects.toThrow();
    await expect(
      anthropicReadOnlyCall(
        { ...request, evidence: key },
        key,
        new AbortController().signal,
        { fetch },
      ),
    ).rejects.toThrow("credential_boundary");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    { ...body(), model: "other-model" },
    { ...body(), stop_reason: "max_tokens" },
    { ...body(), content: [{ type: "tool_use", id: "arbitrary-tool" }] },
    { ...body(), usage: { input_tokens: 10, output_tokens: 257 } },
    {
      ...body(),
      usage: {
        input_tokens: 10,
        output_tokens: 10,
        cache_creation_input_tokens: 20,
      },
    },
    {
      ...body(),
      usage: {
        input_tokens: 10,
        output_tokens: 10,
        server_tool_use: { web_search_requests: 1 },
      },
    },
    {
      ...body(),
      usage: { input_tokens: 10, output_tokens: 10, service_tier: "priority" },
    },
  ])(
    "rejects a changed provider contract or incomplete/extra-billed result",
    async (response) => {
      await expect(
        anthropicReadOnlyCall(request, key, new AbortController().signal, {
          fetch: async () => json(response),
        }),
      ).rejects.toThrow("invalid_response");
    },
  );
  it("suppresses echoed credentials, provider exceptions and redirect/error bodies without retry", async () => {
    const echoed = { ...body(), content: [{ type: "text", text: key }] };
    await expect(
      anthropicReadOnlyCall(request, key, new AbortController().signal, {
        fetch: async () => json(echoed),
      }),
    ).rejects.toThrow("credential_boundary");
    const fetch = vi.fn(async () => {
      throw new Error(key);
    });
    await expect(
      anthropicReadOnlyCall(request, key, new AbortController().signal, {
        fetch,
      }),
    ).rejects.toThrow(/^Read-only model call: provider_unavailable$/);
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(
      anthropicReadOnlyCall(request, key, new AbortController().signal, {
        fetch: async () =>
          new Response(key, {
            status: 307,
            headers: { location: "https://attacker.invalid" },
          }),
      }),
    ).rejects.toThrow("provider_unavailable");
  });
  it("cancels an oversized or stalled response body", async () => {
    let cancelled = false;
    const huge = new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array(524289));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { "content-type": "application/json" } },
    );
    await expect(
      anthropicReadOnlyCall(request, key, new AbortController().signal, {
        fetch: async () => huge,
      }),
    ).rejects.toThrow("response_limit");
    expect(cancelled).toBe(true);
    const controller = new AbortController();
    cancelled = false;
    const stalled = new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { "content-type": "application/json" } },
    );
    const promise = anthropicReadOnlyCall(request, key, controller.signal, {
      fetch: async () => stalled,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    await expect(promise).rejects.toThrow("invalid_response");
    expect(cancelled).toBe(true);
  });
});
