import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { modelProviderWireReceiptSchema, OPENAI_RESPONSES_WIRE_ENDPOINT } from "@paperclipai/shared";
import { nativeSha256 } from "../native-runtime/canonical.js";
import {
  OpenAIResponsesKnownUsageError,
  OpenAIResponsesTransportError,
  openAIResponsesCall,
} from "./openai-responses-model-transport.js";

const credential = "sk-test-server-only-credential-0123456789";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function fixture(overrides: Record<string, unknown> = {}) {
  const content = [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }];
  const tools = [{ type: "function", name: "read_issue", parameters: { type: "object", properties: {} }, strict: true }];
  const request = {
    model: "gpt-test-model", input: content, tools, max_output_tokens: 128,
    stream: true, store: false, previous_response_id: "resp-root-1", ...overrides,
  };
  return {
    request,
    raw: Buffer.from(JSON.stringify(request)),
    input: {
      model: "gpt-test-model", maxOutputTokens: 128, maximumInputTokens: 4096,
      maximumEnvelopeBytes: 64 * 1024, sourceDispatchDigest: digest("source-dispatch"),
      expectedContentHash: nativeSha256({ instructions: null, input: content }),
      expectedToolDefinitionsHash: nativeSha256(tools), expectedPreviousResponseId: "resp-root-1",
      allowedFunctionCallIds: ["call-prior-1"],
    },
  };
}
function completedSse(overrides: Record<string, unknown> = {}) {
  const output = (overrides.output as Array<Record<string, unknown>> | undefined) ?? [
    { id: "msg-1", type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] },
  ];
  const responseValue = {
    id: "resp-completed-1", status: "completed", model: "gpt-test-model",
    usage: { input_tokens: 19, output_tokens: 3 }, ...overrides, output,
  };
  const events: string[] = [];
  output.forEach((item, output_index) => {
    if (item.type === "message") {
      events.push(`event: response.output_item.added\ndata: ${JSON.stringify({ type: "response.output_item.added", output_index,
        item: { id: item.id, type: "message", role: "assistant", status: "in_progress", content: [] } })}\n\n`);
      const content = Array.isArray(item.content) ? item.content as Array<Record<string, unknown>> : [];
      content.forEach((part, content_index) => {
        if (part.type === "output_text") {
          events.push(`event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta",
            item_id: item.id, output_index, content_index, delta: part.text })}\n\n`);
        } else if (part.type === "refusal") {
          events.push(`event: response.refusal.delta\ndata: ${JSON.stringify({ type: "response.refusal.delta",
            item_id: item.id, output_index, content_index, delta: part.refusal })}\n\n`);
        }
      });
    } else if (item.type === "function_call") {
      events.push(`event: response.output_item.added\ndata: ${JSON.stringify({ type: "response.output_item.added", output_index,
        item: { ...item, arguments: "" } })}\n\n`);
      if (item.arguments) events.push(`event: response.function_call_arguments.delta\ndata: ${JSON.stringify({
        type: "response.function_call_arguments.delta", item_id: item.id, output_index, delta: item.arguments,
      })}\n\n`);
      events.push(`event: response.function_call_arguments.done\ndata: ${JSON.stringify({ type: "response.function_call_arguments.done",
        item_id: item.id, output_index, arguments: item.arguments })}\n\n`);
      events.push(`event: response.output_item.done\ndata: ${JSON.stringify({ type: "response.output_item.done", output_index, item })}\n\n`);
    }
  });
  events.push(`event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: responseValue })}\n\n`);
  return events.join("");
}
function response(sse: string) {
  return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" } });
}

describe("strict OpenAI Responses transport boundary", () => {
  it("rejects a credential reflected through JSON Unicode escapes", async () => {
    const { raw, input } = fixture();
    const stream = completedSse({ output: [{ id: "msg-1", type: "message", role: "assistant",
      content: [{ type: "output_text", text: credential }] }] })
      .replaceAll(credential, [...credential].map(character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`).join(""));
    expect(stream).not.toContain(credential);
    await expect(openAIResponsesCall(raw, input, credential, new AbortController().signal, {
      onWireDispatch: vi.fn(), fetch: async () => response(stream),
    })).rejects.toMatchObject({ code: "credential_boundary" });
  });

  it("rejects an intermediate tool call omitted from the completed response", async () => {
    const { raw, input } = fixture();
    const forged = `event: response.output_item.added\ndata: ${JSON.stringify({ type: "response.output_item.added",
      output_index: 1, item: { id: "forged-item", type: "function_call", call_id: "forged-call",
        name: "read_issue", arguments: "{}" } })}\n\n`;
    await expect(openAIResponsesCall(raw, input, credential, new AbortController().signal, {
      onWireDispatch: vi.fn(), fetch: async () => response(forged + completedSse()),
    })).rejects.toMatchObject({ knownUsage: { providerResponseId: "resp-completed-1" } });
  });

  it("hashes the exact serialized request and records reservation before one fixed-endpoint wire call", async () => {
    const { raw, input } = fixture();
    const order: string[] = [];
    let sentBody = "";
    let sentAuthorization = "";
    let receipt: unknown;
    const result = await openAIResponsesCall(raw, input, credential, new AbortController().signal, {
      onWireDispatch: async (value) => { order.push("receipt"); receipt = value; },
      fetch: async (url, init) => {
        order.push("fetch");
        expect(url).toBe(OPENAI_RESPONSES_WIRE_ENDPOINT);
        expect(init?.method).toBe("POST");
        expect(init?.redirect).toBe("manual");
        sentBody = String(init?.body);
        sentAuthorization = new Headers(init?.headers).get("authorization") ?? "";
        return response(completedSse());
      },
    });
    expect(order).toEqual(["receipt", "fetch"]);
    expect(sentAuthorization).toBe(`Bearer ${credential}`);
    expect(sentBody).not.toContain(credential);
    const parsed = modelProviderWireReceiptSchema.parse({
      version: 1, reservationId: randomUUID(), requestHash: digest("request"), method: "POST",
      endpoint: OPENAI_RESPONSES_WIRE_ENDPOINT, bodySha256: digest(sentBody), callId: "call-1",
    });
    expect(parsed.endpoint).toBe(OPENAI_RESPONSES_WIRE_ENDPOINT);
    expect(receipt).toEqual({ method: "POST", endpoint: OPENAI_RESPONSES_WIRE_ENDPOINT,
      bodySha256: digest(sentBody), sourceDispatchDigest: input.sourceDispatchDigest });
    expect(result.usage).toEqual({ inputTokens: 19, outputTokens: 3 });
    expect(result.providerResponseId).toBe("resp-completed-1");
    expect(result.responseHash).toBe(digest(completedSse()));
    expect(result.requestBodySha256).toBe(digest(sentBody));
    expect(modelProviderWireReceiptSchema.safeParse({ ...parsed,
      endpoint: "https://api.openai.com/v1/chat/completions" }).success).toBe(false);
  });

  it("requires the exact verified previous response and content/tool intent hashes before dispatch", async () => {
    const fixtureValue = fixture();
    const fetch = vi.fn(async () => response(completedSse()));
    const onWireDispatch = vi.fn();
    await expect(openAIResponsesCall(fixtureValue.raw,
      { ...fixtureValue.input, expectedPreviousResponseId: "resp-other-root" }, credential,
      new AbortController().signal, { fetch, onWireDispatch })).rejects.toBeInstanceOf(OpenAIResponsesTransportError);
    await expect(openAIResponsesCall(fixtureValue.raw,
      { ...fixtureValue.input, expectedContentHash: digest("unverified-history") }, credential,
      new AbortController().signal, { fetch, onWireDispatch })).rejects.toBeInstanceOf(OpenAIResponsesTransportError);
    expect(onWireDispatch).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects an input envelope that could exceed its reserved token ceiling before dispatch", async () => {
    const fixtureValue = fixture({ input: "x".repeat(5000), previous_response_id: undefined });
    const input = { ...fixtureValue.input, maximumEnvelopeBytes: 64 * 1024, maximumInputTokens: 4096,
      expectedPreviousResponseId: null,
      expectedContentHash: nativeSha256({ instructions: null, input: fixtureValue.request.input }) };
    const fetch = vi.fn(async () => response(completedSse()));
    const onWireDispatch = vi.fn();
    await expect(openAIResponsesCall(fixtureValue.raw, input, credential,
      new AbortController().signal, { fetch, onWireDispatch })).rejects.toBeInstanceOf(OpenAIResponsesTransportError);
    expect(onWireDispatch).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects function outputs whose call IDs are not in the persisted prior-call allowlist", async () => {
    const fixtureValue = fixture({ input: [{ type: "function_call_output", call_id: "call-unknown", output: "{}" }] });
    // This case is intentionally rejected at the source-boundary check, before any provider request.
    const fetch = vi.fn(async () => response(completedSse()));
    await expect(openAIResponsesCall(fixtureValue.raw, { ...fixtureValue.input,
      expectedContentHash: nativeSha256({ instructions: null, input: fixtureValue.request.input }) }, credential,
      new AbortController().signal, { fetch, onWireDispatch: vi.fn() }))
      .rejects.toBeInstanceOf(OpenAIResponsesTransportError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves known usage when a completed response invents a function tool", async () => {
    const { raw, input } = fixture();
    const sse = completedSse({ output: [{ id: "fc-new", type: "function_call", name: "not_offered", call_id: "call-new", arguments: "{}" }] });
    await expect(openAIResponsesCall(raw, input, credential, new AbortController().signal, {
      onWireDispatch: vi.fn(), fetch: async () => response(sse),
    })).rejects.toMatchObject({
      name: "OpenAIResponsesKnownUsageError",
      knownUsage: { usage: { inputTokens: 19, outputTokens: 3 }, providerResponseId: "resp-completed-1", responseHash: digest(sse) },
    } satisfies Partial<OpenAIResponsesKnownUsageError>);
  });

  it("preserves actual usage when a completed response exceeds the reserved token ceiling", async () => {
    const { raw, input } = fixture();
    await expect(openAIResponsesCall(raw, input, credential,
      new AbortController().signal, {
        onWireDispatch: vi.fn(), fetch: async () => response(completedSse({ usage: { input_tokens: 19, output_tokens: 129 } })),
      })).rejects.toMatchObject({
        name: "OpenAIResponsesKnownUsageError",
        knownUsage: { usage: { inputTokens: 19, outputTokens: 129 }, providerResponseId: "resp-completed-1" },
      });
  });

  it("does not treat an incomplete event stream as a successful billable completion", async () => {
    const { raw, input } = fixture();
    await expect(openAIResponsesCall(raw, input, credential, new AbortController().signal, {
      onWireDispatch: vi.fn(), fetch: async () => response("event: response.in_progress\ndata: {}\n\n"),
    })).rejects.toBeInstanceOf(OpenAIResponsesTransportError);
  });
});
