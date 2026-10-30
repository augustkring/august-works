import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  anthropicManagedMessagesCall,
  ReadOnlyModelKnownUsageError,
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
  it("reports only a hash of the exact body sent at the fixed wire boundary", async () => {
    const onWireDispatch = vi.fn();
    const fetch = vi.fn(async () => json(body()));
    await anthropicReadOnlyCall(request, key, new AbortController().signal, {
      fetch,
      onWireDispatch,
    });
    const [, init] = fetch.mock.calls[0]! as unknown as [string, RequestInit];
    const wireBody = String(init.body);
    expect(onWireDispatch).toHaveBeenCalledExactlyOnceWith({
      method: "POST",
      endpoint: "https://api.anthropic.com/v1/messages",
      bodySha256: createHash("sha256").update(wireBody, "utf8").digest("hex"),
    });
    expect(JSON.stringify(onWireDispatch.mock.calls[0])).not.toContain(key);
  });
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

describe("managed Anthropic Messages broker transport", () => {
  const managedRequest = {
    model: "fixture-exact-model-20261005",
    max_tokens: 256,
    stream: true,
    system: "Use only the declared tools for the assigned task.",
    messages: [{ role: "user", content: "Please inspect the task." }],
    tools: [{ name: "paperclip__task_read", description: "Read the assigned task", input_schema: { type: "object", properties: {} } }],
    tool_choice: { type: "auto" },
  };
  const toolResponse = {
    id: "msg_fixture",
    type: "message",
    role: "assistant",
    model: "fixture-exact-model-20261005",
    content: [{ type: "tool_use", id: "tool_fixture", name: "paperclip__task_read", input: {} }],
    stop_reason: "tool_use",
    usage: { input_tokens: 20, output_tokens: 10 },
  };
  it("pins the exact request to one fixed provider call and returns validated tool-use SSE only after complete usage", async () => {
    const onWireDispatch = vi.fn();
    const fetch = vi.fn(async () => json(toolResponse));
    const result = await anthropicManagedMessagesCall(managedRequest, {
      model: request.model, maxOutputTokens: 256, maximumEnvelopeBytes: 4096, maximumInputTokens: 1000,
    }, key, new AbortController().signal, { fetch, onWireDispatch });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init, options] = fetch.mock.calls[0]! as unknown as [string, RequestInit, Record<string, unknown>];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init).toMatchObject({ method: "POST", redirect: "manual", headers: { "x-api-key": key } });
    expect(options).toMatchObject({ allowPrivateNetwork: false, connectTimeoutMs: 5000, responseTimeoutMs: 15000 });
    expect(JSON.parse(String(init.body))).toMatchObject({ model: request.model, max_tokens: 256, stream: false, service_tier: "standard_only", tools: managedRequest.tools });
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 10 });
    expect(result.responseContent).toEqual(toolResponse.content);
    expect(result.sse).toContain('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{}"}}');
    expect(result.sse).toContain("event: message_stop");
    expect(JSON.stringify(onWireDispatch.mock.calls)).not.toContain(key);
  });
  it("fails closed on wrong model, envelope overflow, provider redirects and output usage over the reservation", async () => {
    const fetch = vi.fn(async () => json(toolResponse));
    await expect(anthropicManagedMessagesCall({ ...managedRequest, model: "other" }, {
      model: request.model, maxOutputTokens: 256, maximumEnvelopeBytes: 4096, maximumInputTokens: 1000,
    }, key, new AbortController().signal, { fetch })).rejects.toThrow();
    await expect(anthropicManagedMessagesCall({ ...managedRequest, stream: false }, {
      model: request.model, maxOutputTokens: 256, maximumEnvelopeBytes: 4096, maximumInputTokens: 1000,
    }, key, new AbortController().signal, { fetch })).rejects.toThrow("invalid_response");
    expect(fetch).not.toHaveBeenCalled();
    await expect(anthropicManagedMessagesCall({ ...managedRequest, messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AA==" } }] }] }, {
      model: request.model, maxOutputTokens: 256, maximumEnvelopeBytes: 4096, maximumInputTokens: 1000,
    }, key, new AbortController().signal, { fetch })).rejects.toThrow("invalid_response");
    await expect(anthropicManagedMessagesCall({ ...managedRequest, messages: [{ role: "user", content: [{ type: "document", source: { type: "url", url: "https://example.test/file.pdf" } }] }] }, {
      model: request.model, maxOutputTokens: 256, maximumEnvelopeBytes: 4096, maximumInputTokens: 1000,
    }, key, new AbortController().signal, { fetch })).rejects.toThrow("invalid_response");
    expect(fetch).not.toHaveBeenCalled();
    await expect(anthropicManagedMessagesCall({ ...managedRequest, messages: [{ role: "user", content: "x".repeat(2000) }] }, {
      model: request.model, maxOutputTokens: 256, maximumEnvelopeBytes: 1024, maximumInputTokens: 1000,
    }, key, new AbortController().signal, { fetch })).rejects.toThrow("response_limit");
    await expect(anthropicManagedMessagesCall(managedRequest, {
      model: request.model, maxOutputTokens: 256, maximumEnvelopeBytes: 4096, maximumInputTokens: 1000,
    }, key, new AbortController().signal, { fetch: async () => new Response("", { status: 307, headers: { location: "https://attacker.invalid" } }) })).rejects.toThrow("provider_unavailable");
    await expect(anthropicManagedMessagesCall(managedRequest, {
      model: request.model, maxOutputTokens: 256, maximumEnvelopeBytes: 4096, maximumInputTokens: 1000,
    }, key, new AbortController().signal, { fetch: async () => json({ ...toolResponse, usage: { input_tokens: 1001, output_tokens: 10 } }) })).rejects.toThrow("invalid_response");
    await expect(anthropicManagedMessagesCall(managedRequest, {
      model: request.model, maxOutputTokens: 256, maximumEnvelopeBytes: 4096, maximumInputTokens: 1000,
    }, key, new AbortController().signal, { fetch: async () => json({ ...toolResponse, content: [{ ...toolResponse.content[0], name: "undeclared_tool" }] }) })).rejects.toThrow("invalid_response");
    for (const usage of [
      { ...toolResponse.usage, cache_creation_input_tokens: 1 },
      { ...toolResponse.usage, server_tool_use: { web_search_requests: 1 } },
      { ...toolResponse.usage, service_tier: "priority" },
      { ...toolResponse.usage, unqualified_counter: 0 },
    ]) await expect(anthropicManagedMessagesCall(managedRequest, {
      model: request.model, maxOutputTokens: 256, maximumEnvelopeBytes: 4096, maximumInputTokens: 1000,
    }, key, new AbortController().signal, { fetch: async () => json({ ...toolResponse, usage }) })).rejects.toThrow("invalid_response");
  });
  it("retains bounded authenticated usage when provider content names an unadvertised tool", async () => {
    const fetch = vi.fn(async () => json({ ...toolResponse,
      content: [{ type: "tool_use", id: "tool_fixture", name: "unlisted_tool", input: { private: "never persist" } }],
    }));
    const error = await anthropicManagedMessagesCall(managedRequest, {
      model: request.model, maxOutputTokens: 256, maximumEnvelopeBytes: 4096, maximumInputTokens: 1000,
    }, key, new AbortController().signal, { fetch }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ReadOnlyModelKnownUsageError);
    expect(error).toMatchObject({ knownUsage: { usage: { inputTokens: 20, outputTokens: 10 } } });
    expect(JSON.stringify(error)).not.toContain("never persist");
  });
  it("does not price malformed content with unqualified provider usage", async () => {
    const error = await anthropicManagedMessagesCall(managedRequest, {
      model: request.model, maxOutputTokens: 256, maximumEnvelopeBytes: 4096, maximumInputTokens: 1000,
    }, key, new AbortController().signal, { fetch: async () => json({ ...toolResponse, service_tier: "priority",
      content: [{ type: "tool_use", id: "tool_fixture", name: "unlisted_tool", input: {} }],
    }) }).catch((value: unknown) => value);
    expect(error).not.toBeInstanceOf(ReadOnlyModelKnownUsageError);
  });
  it("accepts documented standard-tier and zero-only ancillary usage counters", async () => {
    const fetch = vi.fn(async () => json({
      ...toolResponse,
      service_tier: "standard",
      usage: { ...toolResponse.usage, cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
        server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 }, service_tier: "standard" },
    }));
    await expect(anthropicManagedMessagesCall(managedRequest, {
      model: request.model, maxOutputTokens: 256, maximumEnvelopeBytes: 4096, maximumInputTokens: 1000,
    }, key, new AbortController().signal, { fetch })).resolves.toMatchObject({ usage: { inputTokens: 20, outputTokens: 10 } });
  });
  it("strips only the pinned SDK ephemeral cache hint while preserving block text and rejects other cache features", async () => {
    const requestWithHint = { ...managedRequest,
      messages: [{ role: "user", content: [{ type: "text", text: "Please inspect the task.", cache_control: { type: "ephemeral" } }] }],
      system: [{ type: "text", text: "Use the assigned sources.", cache_control: { type: "ephemeral" } }],
    };
    const fetch = vi.fn(async () => json(toolResponse));
    await anthropicManagedMessagesCall(requestWithHint, {
      model: request.model, maxOutputTokens: 256, maximumEnvelopeBytes: 4096, maximumInputTokens: 1000,
    }, key, new AbortController().signal, { fetch });
    const [, init] = fetch.mock.calls[0]! as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.messages).toEqual([{ role: "user", content: [{ type: "text", text: "Please inspect the task." }] }]);
    expect(body.system).toEqual([{ type: "text", text: "Use the assigned sources." }]);
    await expect(anthropicManagedMessagesCall({ ...requestWithHint,
      messages: [{ role: "user", content: [{ type: "text", text: "x", cache_control: { type: "ephemeral", ttl: "5m" } }] }],
    }, { model: request.model, maxOutputTokens: 256, maximumEnvelopeBytes: 4096, maximumInputTokens: 1000 },
    key, new AbortController().signal, { fetch })).rejects.toThrow("invalid_response");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("strips only block-level ephemeral hints from tool history and leaves tool arguments untouched", async () => {
    const requestWithToolHints = { ...managedRequest,
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "tool_fixture", name: "paperclip__task_read",
          input: { cache_control: { type: "ephemeral" } }, cache_control: { type: "ephemeral" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "tool_fixture",
          content: [{ type: "text", text: "done", cache_control: { type: "ephemeral" } }],
          cache_control: { type: "ephemeral" } }] },
      ],
    };
    const fetch = vi.fn(async () => json(toolResponse));
    await anthropicManagedMessagesCall(requestWithToolHints, {
      model: request.model, maxOutputTokens: 256, maximumEnvelopeBytes: 4096, maximumInputTokens: 1000,
    }, key, new AbortController().signal, { fetch });
    const [, init] = fetch.mock.calls[0]! as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.messages).toEqual([
      { role: "assistant", content: [{ type: "tool_use", id: "tool_fixture", name: "paperclip__task_read",
        input: { cache_control: { type: "ephemeral" } } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tool_fixture",
        content: [{ type: "text", text: "done" }] }] },
    ]);
    await expect(anthropicManagedMessagesCall({ ...requestWithToolHints,
      messages: [{ role: "assistant", content: [{ type: "tool_use", id: "tool_fixture", name: "paperclip__task_read",
        input: {}, cache_control: { type: "ephemeral", ttl: "5m" } }] }],
    }, { model: request.model, maxOutputTokens: 256, maximumEnvelopeBytes: 4096, maximumInputTokens: 1000 },
    key, new AbortController().signal, { fetch })).rejects.toThrow("invalid_response");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
