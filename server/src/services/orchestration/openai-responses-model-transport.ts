import { createHash } from "node:crypto";
import { z } from "zod";
import { guardedRemoteHttpFetch } from "../remote-http-fetch.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { OPENAI_RESPONSES_WIRE_ENDPOINT } from "@paperclipai/shared";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_SSE_EVENTS = 16_384;
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);

const functionToolSchema = z.object({
  type: z.literal("function"),
  name: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  description: z.string().max(8192).optional(),
  parameters: z.record(z.string(), z.unknown()),
  strict: z.boolean().optional(),
}).strict();

const textInputPartSchema = z.object({
  type: z.enum(["input_text", "output_text"]),
  text: z.string().max(262_144),
}).strict();
const inputMessageSchema = z.object({
  type: z.literal("message"),
  role: z.enum(["user", "assistant"]),
  content: z.union([z.string().max(262_144), z.array(textInputPartSchema).min(1).max(512)]),
}).strict();
const functionCallInputSchema = z.object({
  type: z.literal("function_call"),
  call_id: z.string().min(1).max(200),
  name: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  arguments: z.string().max(262_144),
}).strict();
const functionCallOutputInputSchema = z.object({
  type: z.literal("function_call_output"),
  call_id: z.string().min(1).max(200),
  output: z.string().max(262_144),
}).strict();
const responseRequestSchema = z.object({
  model: z.string().regex(/^[a-zA-Z0-9_.:-]{1,200}$/),
  input: z.union([z.string().max(1_048_576), z.array(z.discriminatedUnion("type", [
    inputMessageSchema, functionCallInputSchema, functionCallOutputInputSchema,
  ])).min(1).max(2048)]),
  instructions: z.string().max(262_144).optional(),
  tools: z.array(functionToolSchema).max(128).optional(),
  tool_choice: z.union([
    z.enum(["auto", "none", "required"]),
    z.object({ type: z.literal("function"), name: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/) }).strict(),
  ]).optional(),
  max_output_tokens: z.number().int().min(1).max(65_536),
  stream: z.literal(true),
  store: z.literal(false),
  previous_response_id: z.string().min(1).max(200).optional(),
  parallel_tool_calls: z.boolean().optional(),
  reasoning: z.object({
    effort: z.enum(["minimal", "low", "medium", "high", "xhigh"] ).optional(),
    summary: z.enum(["auto", "concise", "detailed"] ).optional(),
  }).strict().optional(),
  text: z.object({
    verbosity: z.enum(["low", "medium", "high"]).optional(),
    format: z.record(z.string(), z.unknown()).optional(),
  }).strict().optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  truncation: z.enum(["auto", "disabled"]).optional(),
  include: z.array(z.string().min(1).max(120)).max(32).optional(),
  service_tier: z.literal("default").optional(),
  prompt_cache_key: z.string().min(1).max(128).optional(),
}).strict();

type ResponsesRequest = z.infer<typeof responseRequestSchema>;
export type OpenAIResponsesWireReceipt = {
  method: "POST";
  endpoint: typeof OPENAI_RESPONSES_WIRE_ENDPOINT;
  bodySha256: string;
  sourceDispatchDigest: string;
};
export type OpenAIResponsesUsage = { inputTokens: number; outputTokens: number };

export class OpenAIResponsesTransportError extends Error {
  constructor(readonly code: "invalid_request" | "provider_unavailable" | "response_limit" | "credential_boundary") {
    super(`OpenAI Responses transport: ${code}`);
    this.name = new.target.name;
  }
}
export class OpenAIResponsesKnownUsageError extends OpenAIResponsesTransportError {
  constructor(code: "invalid_request" | "response_limit", readonly knownUsage: {
    responseHash: string;
    usage: OpenAIResponsesUsage;
    providerResponseId: string;
  }) { super(code); }
}

function assertBoundedJson(value: unknown) {
  let nodes = 0;
  const visit = (current: unknown, depth: number): boolean => {
    if (++nodes > 50_000 || depth > 40) return false;
    if (Array.isArray(current)) return current.every((item) => visit(item, depth + 1));
    if (!current || typeof current !== "object") return true;
    return Object.entries(current as Record<string, unknown>).every(([key, child]) =>
      key !== "__proto__" && visit(child, depth + 1));
  };
  if (!visit(value, 0)) throw new OpenAIResponsesTransportError("response_limit");
}

function parseSse(text: string) {
  const events: Array<{ name: string; data: string }> = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    if (!block) continue;
    let name = "message";
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "event") {
        if (name !== "message" || !value || value.length > 128) throw new OpenAIResponsesTransportError("invalid_request");
        name = value;
      } else if (field === "data") data.push(value);
      else if (field !== "id" && field !== "retry") throw new OpenAIResponsesTransportError("invalid_request");
    }
    if (data.length) events.push({ name, data: data.join("\n") });
    if (events.length > MAX_SSE_EVENTS) throw new OpenAIResponsesTransportError("response_limit");
  }
  return events;
}

function validateFunctionCallEvents(
  events: ReturnType<typeof parseSse>,
  finalCalls: Map<string, { itemId: string; name: string; arguments: string }>,
  finalOutput: Array<Record<string, unknown>>,
) {
  const seen = new Map<number, { itemId: string; name: string; callId: string; args: string; sawDelta: boolean }>();
  const textDeltas = new Map<string, string>();
  const textDone = new Map<string, string>();
  const allowed = new Set(["response.created", "response.in_progress", "response.output_item.added",
    "response.output_item.done", "response.content_part.added", "response.output_text.delta",
    "response.output_text.done", "response.refusal.delta", "response.refusal.done",
    "response.function_call_arguments.delta", "response.function_call_arguments.done", "response.completed"]);
  for (const event of events) {
    if (event.data === "[DONE]") continue;
    if (!allowed.has(event.name)) throw new OpenAIResponsesTransportError("invalid_request");
    let data: unknown;
    try { data = JSON.parse(event.data); } catch { throw new OpenAIResponsesTransportError("invalid_request"); }
    if (!data || typeof data !== "object" || Array.isArray(data) || (data as { type?: unknown }).type !== event.name)
      throw new OpenAIResponsesTransportError("invalid_request");
    const record = data as Record<string, unknown>;
    if (event.name === "response.output_item.added" || event.name === "response.output_item.done") {
      if (!Number.isSafeInteger(record.output_index) || (record.output_index as number) < 0 ||
        !record.item || typeof record.item !== "object" || Array.isArray(record.item))
        throw new OpenAIResponsesTransportError("invalid_request");
      const item = record.item as Record<string, unknown>;
      const finalAtIndex = finalOutput[record.output_index as number];
      if (!finalAtIndex || finalAtIndex.type !== item.type || finalAtIndex.id !== item.id)
        throw new OpenAIResponsesTransportError("invalid_request");
      if (item.type !== "function_call") {
        if (item.type !== "message") throw new OpenAIResponsesTransportError("invalid_request");
        continue;
      }
      const index = record.output_index as number;
      const state = seen.get(index);
      if (event.name === "response.output_item.added") {
        if (state || typeof item.id !== "string" || typeof item.call_id !== "string" ||
          typeof item.name !== "string" || typeof item.arguments !== "string")
          throw new OpenAIResponsesTransportError("invalid_request");
        seen.set(index, { itemId: item.id, callId: item.call_id, name: item.name, args: item.arguments, sawDelta: false });
      } else {
        if (!state || item.id !== state.itemId || item.call_id !== state.callId ||
          item.name !== state.name || item.arguments !== state.args)
          throw new OpenAIResponsesTransportError("invalid_request");
      }
      continue;
    }
    if (event.name === "response.content_part.added") {
      if (!Number.isSafeInteger(record.output_index) || (record.output_index as number) < 0 ||
        !Number.isSafeInteger(record.content_index) || (record.content_index as number) < 0 ||
        typeof record.item_id !== "string" || !record.part || typeof record.part !== "object" || Array.isArray(record.part))
        throw new OpenAIResponsesTransportError("invalid_request");
      const item = finalOutput[record.output_index as number];
      const part = (record.part as Record<string, unknown>);
      const content = item && item.type === "message" && Array.isArray(item.content)
        ? item.content[record.content_index as number] as Record<string, unknown> | undefined : undefined;
      if (!item || item.id !== record.item_id || !content || content.type !== part.type)
        throw new OpenAIResponsesTransportError("invalid_request");
      continue;
    }
    if (event.name === "response.output_text.delta" || event.name === "response.output_text.done" ||
      event.name === "response.refusal.delta" || event.name === "response.refusal.done") {
      if (!Number.isSafeInteger(record.output_index) || (record.output_index as number) < 0 ||
        !Number.isSafeInteger(record.content_index) || (record.content_index as number) < 0 ||
        typeof record.item_id !== "string") throw new OpenAIResponsesTransportError("invalid_request");
      const key = `${record.output_index}:${record.content_index}`;
      const item = finalOutput[record.output_index as number];
      const content = item && item.type === "message" && Array.isArray(item.content)
        ? item.content[record.content_index as number] as Record<string, unknown> | undefined : undefined;
      const isText = event.name.startsWith("response.output_text.");
      const expectedType = isText ? "output_text" : "refusal";
      const valueField = isText ? "text" : "refusal";
      if (!item || item.id !== record.item_id || !content || content.type !== expectedType)
        throw new OpenAIResponsesTransportError("invalid_request");
      if (event.name.endsWith(".delta")) {
        const delta = record.delta;
        const before = textDeltas.get(key) ?? "";
        if (typeof delta !== "string" || before.length + delta.length > 262_144)
          throw new OpenAIResponsesTransportError("invalid_request");
        textDeltas.set(key, before + delta);
      } else {
        const finalText = record[valueField];
        const accumulated = textDeltas.get(key) ?? "";
        if (typeof finalText !== "string" || finalText !== accumulated || finalText !== content[valueField])
          throw new OpenAIResponsesTransportError("invalid_request");
        textDone.set(key, finalText);
      }
      continue;
    }
    if (event.name === "response.function_call_arguments.delta" || event.name === "response.function_call_arguments.done") {
      if (!Number.isSafeInteger(record.output_index) || (record.output_index as number) < 0 ||
        typeof record.item_id !== "string") throw new OpenAIResponsesTransportError("invalid_request");
      const state = seen.get(record.output_index as number);
      if (!state || record.item_id !== state.itemId) throw new OpenAIResponsesTransportError("invalid_request");
      if (event.name === "response.function_call_arguments.delta") {
        if (typeof record.delta !== "string" || state.args.length + record.delta.length > 262_144)
          throw new OpenAIResponsesTransportError("invalid_request");
        state.args += record.delta;
        state.sawDelta = true;
      } else if (typeof record.arguments !== "string" || record.arguments !== state.args) {
        throw new OpenAIResponsesTransportError("invalid_request");
      }
    }
  }
  for (const state of seen.values()) {
    const final = finalCalls.get(state.itemId);
    if (!final || final.name !== state.name || final.arguments !== state.args)
      throw new OpenAIResponsesTransportError("invalid_request");
  }
  for (const [key, text] of textDeltas) {
    const [outputIndex, contentIndex] = key.split(":").map(Number);
    const item = finalOutput[outputIndex];
    const content = item && item.type === "message" && Array.isArray(item.content)
      ? item.content[contentIndex] as Record<string, unknown> | undefined : undefined;
    const field = content?.type === "refusal" ? "refusal" : "text";
    if (!content || text !== content[field] || (textDone.has(key) && textDone.get(key) !== text))
      throw new OpenAIResponsesTransportError("invalid_request");
  }
}

function validateCompletedEvent(events: ReturnType<typeof parseSse>, rawResponseText: string, input: {
  model: string;
  maximumInputTokens: number;
  maxOutputTokens: number;
  toolNames: Set<string>;
}) {
  const dataEvents = events.filter((event) => event.data !== "[DONE]");
  if (!dataEvents.length || dataEvents.some((event) => event.name === "error"))
    throw new OpenAIResponsesTransportError("provider_unavailable");
  const completed = dataEvents.filter((event) => event.name === "response.completed");
  const last = dataEvents.at(-1);
  if (completed.length !== 1 || last !== completed[0])
    throw new OpenAIResponsesTransportError("provider_unavailable");
  const terminal = z.object({
    type: z.literal("response.completed"),
    response: z.object({
      id: z.string().min(1).max(200),
      status: z.literal("completed"),
      model: z.string().min(1).max(200),
      error: z.null().optional(),
      incomplete_details: z.null().optional(),
      service_tier: z.enum(["default", "flex", "priority"]).optional(),
      output: z.array(z.unknown()).max(1024),
      usage: z.object({
        input_tokens: z.number().int().safe().nonnegative(),
        output_tokens: z.number().int().safe().nonnegative(),
      }).passthrough(),
    }).passthrough(),
  }).passthrough();
  let parsed: z.infer<typeof terminal>;
  try { parsed = terminal.parse(JSON.parse(completed[0]!.data)); }
  catch { throw new OpenAIResponsesTransportError("invalid_request"); }
  const response = parsed.response;
  const usage: OpenAIResponsesUsage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
  const responseHash = createHash("sha256").update(rawResponseText, "utf8").digest("hex");
  if (response.model !== input.model ||
    (response.service_tier !== undefined && response.service_tier !== "default"))
    throw new OpenAIResponsesTransportError("provider_unavailable");
  if (usage.inputTokens > input.maximumInputTokens || usage.outputTokens > input.maxOutputTokens)
    throw new OpenAIResponsesKnownUsageError("response_limit", {
      responseHash, usage, providerResponseId: response.id,
    });
  const outputItemSchema = z.discriminatedUnion("type", [
    z.object({ id: z.string().min(1).max(200), type: z.literal("message"), role: z.literal("assistant"),
      status: z.enum(["in_progress", "completed", "incomplete"]).optional(),
      content: z.array(z.discriminatedUnion("type", [
        z.object({ type: z.literal("output_text"), text: z.string().max(262_144), annotations: z.array(z.unknown()).max(256).optional() }).passthrough(),
        z.object({ type: z.literal("refusal"), refusal: z.string().max(262_144) }).passthrough(),
      ])).max(512),
    }).passthrough(),
    z.object({ id: z.string().min(1).max(200), type: z.literal("function_call"),
      call_id: z.string().min(1).max(200), name: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
      arguments: z.string().max(262_144), status: z.string().max(64).optional(),
    }).passthrough(),
  ]);
  const parsedOutput = z.array(outputItemSchema).max(1024).safeParse(response.output);
  if (!parsedOutput.success) throw new OpenAIResponsesKnownUsageError("invalid_request", {
    responseHash, usage, providerResponseId: response.id,
  });
  const output = parsedOutput.data;
  const callIds = new Set<string>();
  const outputItemIds = new Set<string>();
  const finalCalls = new Map<string, { itemId: string; name: string; arguments: string }>();
  const functionCallIds: string[] = [];
  for (const item of output) {
    if (outputItemIds.has(item.id)) throw new OpenAIResponsesKnownUsageError("invalid_request", {
      responseHash, usage, providerResponseId: response.id,
    });
    outputItemIds.add(item.id);
    if (item.type !== "function_call") continue;
    if (!input.toolNames.has(item.name) || callIds.has(item.call_id))
      throw new OpenAIResponsesKnownUsageError("invalid_request", {
        responseHash, usage, providerResponseId: response.id,
      });
    let args: unknown;
    try { args = JSON.parse(item.arguments); assertBoundedJson(args); }
    catch { throw new OpenAIResponsesKnownUsageError("invalid_request", {
      responseHash, usage, providerResponseId: response.id,
    }); }
    callIds.add(item.call_id);
    finalCalls.set(item.id, { itemId: item.id, name: item.name, arguments: item.arguments });
    functionCallIds.push(item.call_id);
  }
  try { validateFunctionCallEvents(events, finalCalls, output as Array<Record<string, unknown>>); }
  catch { throw new OpenAIResponsesKnownUsageError("invalid_request", {
    responseHash, usage, providerResponseId: response.id,
  }); }
  return { providerResponseId: response.id, usage, responseHash, functionCallIds,
    output };
}

export async function openAIResponsesCall(
  rawBody: Buffer | Uint8Array,
  input: {
    model: string;
    maxOutputTokens: number;
    maximumInputTokens: number;
    maximumEnvelopeBytes: number;
    sourceDispatchDigest: string;
    expectedContentHash: string;
    expectedToolDefinitionsHash: string;
    expectedPreviousResponseId: string | null;
    allowedFunctionCallIds: readonly string[];
  },
  credential: string,
  signal: AbortSignal,
  options: {
    fetch?: typeof guardedRemoteHttpFetch;
    onWireDispatch: (receipt: OpenAIResponsesWireReceipt) => void | Promise<void>;
  },
) {
  if (!Buffer.isBuffer(rawBody) && !(rawBody instanceof Uint8Array) ||
    !/^[a-zA-Z0-9_.:-]{1,200}$/.test(input.model) ||
    !Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens < 1 || input.maxOutputTokens > 65_536 ||
    !Number.isSafeInteger(input.maximumInputTokens) || input.maximumInputTokens < 1 || input.maximumInputTokens > 2_000_000 ||
    !Number.isSafeInteger(input.maximumEnvelopeBytes) || input.maximumEnvelopeBytes < 1024 ||
    !hashSchema.safeParse(input.sourceDispatchDigest).success ||
    !hashSchema.safeParse(input.expectedContentHash).success ||
    !hashSchema.safeParse(input.expectedToolDefinitionsHash).success ||
    credential.length < 16 || credential.length > 16384 || /[\r\n\u0000]/.test(credential) ||
    new Set(input.allowedFunctionCallIds).size !== input.allowedFunctionCallIds.length ||
    input.allowedFunctionCallIds.some((id) => typeof id !== "string" || !id || id.length > 200))
    throw new OpenAIResponsesTransportError("invalid_request");
  const bytes = Buffer.from(rawBody);
  if (bytes.length < 2 || bytes.length > input.maximumEnvelopeBytes)
    throw new OpenAIResponsesTransportError("response_limit");
  let text: string;
  let raw: unknown;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    raw = JSON.parse(text);
  } catch { throw new OpenAIResponsesTransportError("invalid_request"); }
  let request: ResponsesRequest;
  try { request = responseRequestSchema.parse(raw); }
  catch { throw new OpenAIResponsesTransportError("invalid_request"); }
  assertBoundedJson(request);
  if (request.model !== input.model || request.max_output_tokens > input.maxOutputTokens ||
    request.previous_response_id !== (input.expectedPreviousResponseId ?? undefined) ||
    nativeSha256({ instructions: request.instructions ?? null, input: request.input }) !== input.expectedContentHash ||
    nativeSha256(request.tools ?? []) !== input.expectedToolDefinitionsHash)
    throw new OpenAIResponsesTransportError("invalid_request");
  const toolNames = (request.tools ?? []).map((tool) => tool.name);
  if (new Set(toolNames).size !== toolNames.length ||
    (typeof request.tool_choice === "object" && !toolNames.includes(request.tool_choice.name)))
    throw new OpenAIResponsesTransportError("invalid_request");
  const allowedCalls = new Set(input.allowedFunctionCallIds);
  const seenInputCalls = new Set<string>();
  if (Array.isArray(request.input)) for (const item of request.input) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (record.type === "function_call_output" || record.type === "function_call") {
      if (typeof record.call_id !== "string" || !allowedCalls.has(record.call_id) || seenInputCalls.has(record.call_id))
        throw new OpenAIResponsesTransportError("invalid_request");
      seenInputCalls.add(record.call_id);
    }
  }
  if (JSON.stringify(request).includes(credential)) throw new OpenAIResponsesTransportError("credential_boundary");
  // Serialize the validated request once. This exact body is hashed and sent;
  // no SDK, redirect, fallback, or retry path can change the accounted bytes.
  const body = JSON.stringify(request);
  const bodyBytes = Buffer.byteLength(body, "utf8");
  if (bodyBytes > input.maximumEnvelopeBytes || bodyBytes > input.maximumInputTokens)
    throw new OpenAIResponsesTransportError("response_limit");
  const receipt: OpenAIResponsesWireReceipt = {
    method: "POST", endpoint: OPENAI_RESPONSES_WIRE_ENDPOINT,
    bodySha256: createHash("sha256").update(body, "utf8").digest("hex"),
    sourceDispatchDigest: input.sourceDispatchDigest,
  };
  signal.throwIfAborted();
  await options.onWireDispatch(receipt);
  let response: Response;
  try {
    signal.throwIfAborted();
    response = await (options.fetch ?? guardedRemoteHttpFetch)(OPENAI_RESPONSES_WIRE_ENDPOINT, {
      method: "POST", redirect: "manual", signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${credential}` }, body,
    }, { allowPrivateNetwork: false, connectTimeoutMs: 5000, responseTimeoutMs: 30000,
      error: () => new OpenAIResponsesTransportError("provider_unavailable") });
  } catch { throw new OpenAIResponsesTransportError("provider_unavailable"); }
  if (response.status !== 200 || !response.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream")) {
    await response.body?.cancel().catch(() => {});
    throw new OpenAIResponsesTransportError("provider_unavailable");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new OpenAIResponsesTransportError("invalid_request");
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    try {
      for (;;) {
        signal.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_RESPONSE_BYTES) throw new OpenAIResponsesTransportError("response_limit");
        chunks.push(chunk.value);
      }
    } catch (error) {
      if (error instanceof OpenAIResponsesTransportError) throw error;
      throw new OpenAIResponsesTransportError("provider_unavailable");
    }
    let responseText: string;
    try { responseText = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)); }
    catch { throw new OpenAIResponsesTransportError("provider_unavailable"); }
    if (responseText.includes(credential)) throw new OpenAIResponsesTransportError("credential_boundary");
    let events: ReturnType<typeof parseSse>;
    try { events = parseSse(responseText); }
    catch (error) {
      if (error instanceof OpenAIResponsesTransportError) throw error;
      throw new OpenAIResponsesTransportError("provider_unavailable");
    }
    const result = validateCompletedEvent(events, responseText, {
      model: input.model, maximumInputTokens: input.maximumInputTokens,
      maxOutputTokens: request.max_output_tokens, toolNames: new Set(toolNames),
    });
    if (JSON.stringify(result.output).includes(credential))
      throw new OpenAIResponsesTransportError("credential_boundary");
    return { ...result, requestBodySha256: receipt.bodySha256 };
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
