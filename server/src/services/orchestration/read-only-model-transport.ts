import { z } from "zod";
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

/** Exactly one non-streaming text-only Messages call. No user endpoint,
 * redirect, tools, attachments, provider cache, thinking, or retry channel.
 * The credential is an internal server argument, never returned to a worker.
 * The caller owns the durable reservation and current native authorization. */
export async function anthropicReadOnlyCall(
  raw: ReadOnlyModelRequest,
  credential: string,
  signal: AbortSignal,
  options: { fetch?: typeof guardedRemoteHttpFetch } = {},
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
