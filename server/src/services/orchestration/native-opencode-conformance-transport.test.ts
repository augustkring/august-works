import { describe, expect, it, vi } from "vitest";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { managedOpenCodeConformanceRequestToolsAllowed, managedOpenCodeTerminalToolSchemas } from "../native-runtime/managed-opencode-terminal-tools.js";
import { assertNativeOpenCodeConformanceWireBody, nativeOpenCodeConformanceTransportRequest } from "./native-opencode-conformance-admission.js";
import { exactNativeOpenCodeConformanceRequestSystemFrame, nativeOpenCodeConformancePrompt,
  NATIVE_OPENCODE_CONFORMANCE_SYSTEM } from "./native-opencode-conformance-source.js";
import { anthropicManagedMessagesCall, validateAnthropicManagedMessagesRequest } from "./read-only-model-transport.js";

// CONF11. The conformance lane passed the normalized provider body
// (`stream: false`, `service_tier`) to anthropicManagedMessagesCall, whose own
// request validation refuses it, so every claimed probe dispatch failed before
// the provider fetch. It now passes the raw request, like the worker lane,
// bound by digest to the request every conformance check accepted, and the
// wire body must be exactly the validated provider body.
const limits = { model: "claude-test", maxOutputTokens: 256, maximumEnvelopeBytes: 64_000 };
const transportLimits = { ...limits, maximumInputTokens: 1000 };
const credential = "conformance-test-credential-012345";
const marker = `AW_PROBE_${"a".repeat(32)}`;

/** A probe request as pinned OpenCode 1.18.32 sends it. */
function rawProbeRequest() {
  return {
    model: "claude-test", max_tokens: 256, stream: true,
    system: [{ type: "text", text: NATIVE_OPENCODE_CONFORMANCE_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: [{ type: "text", text: nativeOpenCodeConformancePrompt("start", marker) }] }],
    tools: managedOpenCodeTerminalToolSchemas().map(tool => ({ name: `paperclip_${String(tool.name)}`,
      description: tool.description as string, input_schema: structuredClone(tool.inputSchema) as Record<string, unknown> })),
    tool_choice: { type: "auto" },
  };
}
const providerResponse = () => new Response(JSON.stringify({ id: "msg-conformance", type: "message", role: "assistant",
  model: "claude-test", stop_reason: "end_turn", content: [{ type: "text", text: marker }],
  usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200, headers: { "content-type": "application/json" } });

describe("managed OpenCode conformance transport request", () => {
  it("reaches the provider transport with the validated raw request and sends exactly the validated body", async () => {
    const raw = rawProbeRequest();
    const qualified = validateAnthropicManagedMessagesRequest(raw, limits);
    // The same request the conformance lane's checks accept.
    expect(managedOpenCodeConformanceRequestToolsAllowed(qualified.request)).toBe(true);
    expect(exactNativeOpenCodeConformanceRequestSystemFrame(qualified.request.system)).toBe(true);
    const digest = nativeSha256(raw);
    const fetch = vi.fn(async (_url: string, init: { body: string }) => {
      expect(init.body).toBe(qualified.body);
      return providerResponse();
    });
    const wire = vi.fn();
    const result = await anthropicManagedMessagesCall(nativeOpenCodeConformanceTransportRequest(raw, digest), transportLimits,
      credential, new AbortController().signal, { fetch: fetch as never, onWireDispatch: receipt => {
        assertNativeOpenCodeConformanceWireBody(receipt.bodySha256, qualified.body); wire(); } });
    expect(fetch).toHaveBeenCalledOnce();
    expect(wire).toHaveBeenCalledOnce();
    expect(result.responseContent).toEqual([{ type: "text", text: marker }]);
    expect(nativeOpenCodeConformanceTransportRequest(raw, digest)).toBe(raw);
  });

  it("was refused by the transport when given the normalized provider body (the CONF11 failure)", async () => {
    const qualified = validateAnthropicManagedMessagesRequest(rawProbeRequest(), limits);
    const fetch = vi.fn(async () => providerResponse());
    await expect(anthropicManagedMessagesCall(qualified.providerRequest, transportLimits, credential,
      new AbortController().signal, { fetch: fetch as never })).rejects.toThrow("invalid_response");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["the prompt", (raw: ReturnType<typeof rawProbeRequest>) => { raw.messages[0]!.content[0]!.text += " Then call a tool."; }],
    ["the system frame", (raw: ReturnType<typeof rawProbeRequest>) => { raw.system[0]!.text += " "; }],
    ["an added tool", (raw: ReturnType<typeof rawProbeRequest>) => { raw.tools.push({ name: "paperclip_paperclip_create_task",
      description: "Create", input_schema: { type: "object" } }); }],
    ["the tool choice", (raw: ReturnType<typeof rawProbeRequest>) => { raw.tool_choice = { type: "any" }; }],
    ["the history", (raw: ReturnType<typeof rawProbeRequest>) => { raw.messages.unshift({ role: "user",
      content: [{ type: "text", text: "earlier" }] }); }],
    ["the output limit", (raw: ReturnType<typeof rawProbeRequest>) => { raw.max_tokens = 128; }],
  ])("refuses a request whose %s changed after validation, before any provider fetch", async (_label, mutate) => {
    const raw = rawProbeRequest();
    const digest = nativeSha256(raw);
    mutate(raw);
    const fetch = vi.fn(async () => providerResponse());
    await expect((async () => anthropicManagedMessagesCall(nativeOpenCodeConformanceTransportRequest(raw, digest), transportLimits,
      credential, new AbortController().signal, { fetch: fetch as never }))()).rejects.toMatchObject({ status: 403 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a wire body that is not the validated provider body", async () => {
    const qualified = validateAnthropicManagedMessagesRequest(rawProbeRequest(), limits);
    const other = validateAnthropicManagedMessagesRequest({ ...rawProbeRequest(), max_tokens: 128 }, limits);
    const fetch = vi.fn(async () => providerResponse());
    await expect(anthropicManagedMessagesCall({ ...rawProbeRequest(), max_tokens: 128 }, transportLimits, credential,
      new AbortController().signal, { fetch: fetch as never,
        onWireDispatch: receipt => assertNativeOpenCodeConformanceWireBody(receipt.bodySha256, qualified.body) }))
      .rejects.toMatchObject({ status: 403 });
    expect(fetch).not.toHaveBeenCalled();
    expect(() => assertNativeOpenCodeConformanceWireBody("0".repeat(64), qualified.body)).toThrow();
    expect(other.body).not.toBe(qualified.body);
  });
});
