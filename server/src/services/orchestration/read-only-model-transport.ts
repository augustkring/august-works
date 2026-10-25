import { z } from "zod";
import { createHash } from "node:crypto";
import { guardedRemoteHttpFetch } from "../remote-http-fetch.js";

const requestSchema = z
  .object({
    model: z.string().regex(/^[a-zA-Z0-9_.:-]{1,200}$/),
    system: z.string().min(1).max(16000),
    evidence: z.string().min(1).max(256000),
    maxOutputTokens: z.number().int().min(1).max(8192),
  })
  .strict();
export type ReadOnlyModelRequest = z.infer<typeof requestSchema>;
/** Hash-only receipt for the exact provider wire body. This records dispatch
 * bytes; it does not assert source completeness or provider consumption. */
export type ReadOnlyModelWireReceipt = {
  method: "POST";
  endpoint: "https://api.anthropic.com/v1/messages";
  bodySha256: string;
};
export class ReadOnlyModelTransportError extends Error {
  constructor(
    readonly code:
      | "provider_unavailable"
      | "invalid_response"
      | "response_limit"
      | "credential_boundary",
  ) {
    super(`Read-only model call: ${code}`);
  }
}

function boundedRecord(max: number) {
  return z.record(z.string(), z.unknown()).superRefine((value, context) => {
    if (Object.keys(value).length > max) context.addIssue({ code: "custom", message: "too_many_fields" });
  });
}

const managedMessagesSchema = z.object({
  model: z.string().max(200).optional(),
  max_tokens: z.number().int().positive().max(8192),
  stream: z.boolean().optional(),
  system: z.union([z.string().max(65536), z.array(boundedRecord(32)).max(128)]).optional(),
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.union([z.string().max(262144), z.array(boundedRecord(32)).max(512)]),
  }).strict()).min(1).max(256),
  tools: z.array(z.object({
    name: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
    description: z.string().max(8192).optional(),
    input_schema: boundedRecord(128),
  }).strict()).max(128).optional(),
  tool_choice: boundedRecord(16).optional(),
  temperature: z.number().min(0).max(1).optional(),
  top_p: z.number().min(0).max(1).optional(),
  top_k: z.number().int().positive().max(1000).optional(),
  stop_sequences: z.array(z.string().max(1024)).max(16).optional(),
  metadata: boundedRecord(16).optional(),
}).strict();

export function validateAnthropicManagedMessagesRequest(
  raw: unknown,
  input: { model: string; maxOutputTokens: number; maximumEnvelopeBytes: number },
) {
  const request = managedMessagesSchema.parse(raw);
  if (
    !/^[a-zA-Z0-9_.:-]{1,200}$/.test(input.model) ||
    !Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens < 1 ||
    !Number.isSafeInteger(input.maximumEnvelopeBytes) || input.maximumEnvelopeBytes < 1024 ||
    request.max_tokens > input.maxOutputTokens ||
    (request.model !== undefined && request.model !== input.model)
  ) throw new ReadOnlyModelTransportError("invalid_response");
  const providerRequest = { ...request, model: input.model, stream: false, service_tier: "standard_only" };
  const body = JSON.stringify(providerRequest);
  if (Buffer.byteLength(body, "utf8") > input.maximumEnvelopeBytes)
    throw new ReadOnlyModelTransportError("response_limit");
  const containsUnqualifiedCostControl = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(containsUnqualifiedCostControl);
    if (!value || typeof value !== "object") return false;
    return Object.entries(value as Record<string, unknown>).some(([key, nested]) =>
      ["cache_control", "thinking", "service_tier"].includes(key) || containsUnqualifiedCostControl(nested));
  };
  const containsImage = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(containsImage);
    if (!value || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    return record.type === "image" || Object.values(record).some(containsImage);
  };
  if (containsUnqualifiedCostControl(request) || containsImage(request))
    throw new ReadOnlyModelTransportError("invalid_response");
  return { request, providerRequest, body };
}

/** Exactly one non-streaming text-only Messages call. No user endpoint,
 * redirect, tools, attachments, provider cache, thinking, or retry channel.
 * The credential is an internal server argument, never returned to a worker.
 * The caller owns the durable reservation and current native authorization. */
export async function anthropicReadOnlyCall(
  raw: ReadOnlyModelRequest,
  credential: string,
  signal: AbortSignal,
  options: {
    fetch?: typeof guardedRemoteHttpFetch;
    onWireDispatch?: (receipt: ReadOnlyModelWireReceipt) => void | Promise<void>;
  } = {},
) {
  const input = requestSchema.parse(raw);
  if (
    credential.length < 16 ||
    credential.length > 16384 ||
    /[\r\n\u0000]/.test(credential)
  )
    throw new ReadOnlyModelTransportError("credential_boundary");
  const body = JSON.stringify({
    model: input.model,
    max_tokens: input.maxOutputTokens,
    stream: false,
    service_tier: "standard_only",
    system: input.system,
    messages: [
      { role: "user", content: [{ type: "text", text: input.evidence }] },
    ],
  });
  if (body.includes(credential))
    throw new ReadOnlyModelTransportError("credential_boundary");
  // Report only a digest of the exact canonical body. Callers cannot use this
  // as source authority; the transport still sends the same immutable string.
  signal.throwIfAborted();
  await options.onWireDispatch?.({
    method: "POST",
    endpoint: "https://api.anthropic.com/v1/messages",
    bodySha256: createHash("sha256").update(body, "utf8").digest("hex"),
  });
  let response: Response;
  try {
    signal.throwIfAborted();
    response = await (options.fetch ?? guardedRemoteHttpFetch)(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        redirect: "manual",
        signal,
        headers: {
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": credential,
        },
        body,
      },
      {
        allowPrivateNetwork: false,
        connectTimeoutMs: 5000,
        responseTimeoutMs: 15000,
        error: () => new ReadOnlyModelTransportError("provider_unavailable"),
      },
    );
  } catch {
    // No provider, socket, SDK or abort error body can become an ordinary log.
    throw new ReadOnlyModelTransportError("provider_unavailable");
  }
  if (
    response.status !== 200 ||
    !response.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    await response.body?.cancel().catch(() => {});
    throw new ReadOnlyModelTransportError("provider_unavailable");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ReadOnlyModelTransportError("invalid_response");
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 524288)
        throw new ReadOnlyModelTransportError("response_limit");
      chunks.push(chunk.value);
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks),
    );
    if (text.includes(credential))
      throw new ReadOnlyModelTransportError("credential_boundary");
    const parsed = z
      .object({
        type: z.literal("message"),
        role: z.literal("assistant"),
        model: z.literal(input.model),
        stop_reason: z.literal("end_turn"),
        content: z
          .array(
            z
              .object({ type: z.literal("text"), text: z.string().max(256000) })
              .strict(),
          )
          .min(1)
          .max(16),
        usage: z
          .object({
            input_tokens: z.number().int().nonnegative(),
            output_tokens: z.number().int().nonnegative(),
            cache_creation_input_tokens: z.literal(0).optional(),
            cache_read_input_tokens: z.literal(0).optional(),
            service_tier: z.literal("standard").optional(),
            server_tool_use: z
              .object({
                web_search_requests: z.literal(0),
                web_fetch_requests: z.literal(0).optional(),
              })
              .optional(),
          })
          .passthrough(),
      })
      .passthrough()
      .parse(JSON.parse(text));
    if (parsed.usage.output_tokens > input.maxOutputTokens)
      throw new ReadOnlyModelTransportError("invalid_response");
    return {
      text: parsed.content.map((part) => part.text).join("\n"),
      usage: {
        inputTokens: parsed.usage.input_tokens,
        outputTokens: parsed.usage.output_tokens,
      },
    };
  } catch (error) {
    if (error instanceof ReadOnlyModelTransportError) throw error;
    throw new ReadOnlyModelTransportError("invalid_response");
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Same serialization used by transport. Token qualification must cover this
 * whole envelope, including provider framing; bytes alone are not a tokenizer. */
export function readOnlyModelEnvelopeBytes(raw: ReadOnlyModelRequest) {
  const input = requestSchema.parse(raw);
  return Buffer.byteLength(
    JSON.stringify({
      model: input.model,
      max_tokens: input.maxOutputTokens,
      stream: false,
      service_tier: "standard_only",
      system: input.system,
      messages: [
        { role: "user", content: [{ type: "text", text: input.evidence }] },
      ],
    }),
    "utf8",
  );
}

/**
 * A bounded, tool-capable Anthropic Messages transport for a managed native
 * worker. Unlike `anthropicReadOnlyCall`, this accepts the serialized message
 * history and declared tools produced by the pinned native driver. It still
 * sends exactly one non-streaming request to the fixed Anthropic endpoint;
 * the caller must hold the durable model reservation before calling it.
 *
 * The provider response is converted to Anthropic SSE only after the complete
 * response and usage have been validated. This lets an SDK that requested a
 * stream consume the response without letting partial output escape before
 * accounting and current-authority checks finish.
 */
export async function anthropicManagedMessagesCall(
  raw: unknown,
  input: {
    model: string;
    maxOutputTokens: number;
    maximumEnvelopeBytes: number;
    maximumInputTokens: number;
  },
  credential: string,
  signal: AbortSignal,
  options: {
    fetch?: typeof guardedRemoteHttpFetch;
    onWireDispatch?: (receipt: ReadOnlyModelWireReceipt) => void | Promise<void>;
  } = {},
) {
  if (
    credential.length < 16 || credential.length > 16384 ||
    /[\r\n\u0000]/.test(credential) ||
    !/^[a-zA-Z0-9_.:-]{1,200}$/.test(input.model) ||
    !Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens < 1 ||
    !Number.isSafeInteger(input.maximumEnvelopeBytes) || input.maximumEnvelopeBytes < 1024 ||
    !Number.isSafeInteger(input.maximumInputTokens) || input.maximumInputTokens < 1
  ) throw new ReadOnlyModelTransportError("invalid_response");
  const { request, body } = validateAnthropicManagedMessagesRequest(raw, input);
  if (body.includes(credential))
    throw new ReadOnlyModelTransportError(body.includes(credential) ? "credential_boundary" : "response_limit");
  signal.throwIfAborted();
  await options.onWireDispatch?.({
    method: "POST",
    endpoint: "https://api.anthropic.com/v1/messages",
    bodySha256: createHash("sha256").update(body, "utf8").digest("hex"),
  });
  let response: Response;
  try {
    signal.throwIfAborted();
    response = await (options.fetch ?? guardedRemoteHttpFetch)(
      "https://api.anthropic.com/v1/messages",
      { method: "POST", redirect: "manual", signal, headers: {
        "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": credential,
      }, body },
      { allowPrivateNetwork: false, connectTimeoutMs: 5000, responseTimeoutMs: 15000,
        error: () => new ReadOnlyModelTransportError("provider_unavailable") },
    );
  } catch {
    throw new ReadOnlyModelTransportError("provider_unavailable");
  }
  if (response.status !== 200 || !response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    await response.body?.cancel().catch(() => {});
    throw new ReadOnlyModelTransportError("provider_unavailable");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ReadOnlyModelTransportError("invalid_response");
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 524288) throw new ReadOnlyModelTransportError("response_limit");
      chunks.push(chunk.value);
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    if (text.includes(credential)) throw new ReadOnlyModelTransportError("credential_boundary");
    const parsed = z.object({
      id: z.string().min(1).max(200),
      type: z.literal("message"), role: z.literal("assistant"),
      model: z.literal(input.model),
      content: z.array(z.discriminatedUnion("type", [
        z.object({ type: z.literal("text"), text: z.string().max(262144) }).strict(),
        z.object({ type: z.literal("tool_use"), id: z.string().min(1).max(200), name: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/), input: boundedRecord(128) }).strict(),
      ])).min(1).max(128),
      stop_reason: z.enum(["end_turn", "max_tokens", "stop_sequence", "tool_use"]),
      stop_sequence: z.string().max(1024).nullable().optional(),
      usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }).passthrough(),
    }).passthrough().parse(JSON.parse(text));
    if (parsed.usage.output_tokens > request.max_tokens || parsed.usage.input_tokens > input.maximumInputTokens)
      throw new ReadOnlyModelTransportError("invalid_response");
    const events: Array<[string, unknown]> = [["message_start", { type: "message_start", message: {
      id: parsed.id, type: "message", role: "assistant", model: parsed.model, content: [],
      stop_reason: null, stop_sequence: null, usage: { input_tokens: parsed.usage.input_tokens, output_tokens: 0 },
    } }]];
    parsed.content.forEach((block, index) => {
      if (block.type === "text") {
        events.push(["content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } }]);
        events.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } }]);
      } else {
        events.push(["content_block_start", { type: "content_block_start", index, content_block: { type: "tool_use", id: block.id, name: block.name, input: {} } }]);
        events.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } }]);
      }
      events.push(["content_block_stop", { type: "content_block_stop", index }]);
    });
    events.push(["message_delta", { type: "message_delta", delta: { stop_reason: parsed.stop_reason, stop_sequence: parsed.stop_sequence ?? null }, usage: { output_tokens: parsed.usage.output_tokens } }]);
    events.push(["message_stop", { type: "message_stop" }]);
    return {
      usage: { inputTokens: parsed.usage.input_tokens, outputTokens: parsed.usage.output_tokens },
      responseHash: createHash("sha256").update(text, "utf8").digest("hex"),
      sse: events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(""),
    };
  } catch (error) {
    if (error instanceof ReadOnlyModelTransportError) throw error;
    throw new ReadOnlyModelTransportError("invalid_response");
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
