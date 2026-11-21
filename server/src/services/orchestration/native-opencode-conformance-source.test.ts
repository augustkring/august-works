import { describe, expect, it } from "vitest";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { managedOpenCodeTerminalToolSchemas } from "../native-runtime/managed-opencode-terminal-tools.js";
import {
  assertNativeOpenCodeConformanceSource,
  exactNativeOpenCodeConformanceRequestSystemFrame,
  exactNativeOpenCodeConformanceSystemFrame,
  nativeOpenCodeConformancePrompt,
  nativeOpenCodeConformanceSourceDigest,
  nativeOpenCodeConformanceTurnInputDigest,
  NATIVE_OPENCODE_CONFORMANCE_SYSTEM,
  type NativeOpenCodeConformanceSourceAuthority,
} from "./native-opencode-conformance-source.js";

function fixture() {
  const kind = "start" as const;
  const marker = `AW_PROBE_${"a".repeat(32)}`;
  const prompt = nativeOpenCodeConformancePrompt(kind, marker);
  const dispatch = {
    dispatchId: "dispatch-1", eventSeq: 4, attempt: 1, responsibleUserId: "user-1",
    continuation: false,
    turnInputDigest: nativeOpenCodeConformanceTurnInputDigest({ kind, marker, continuation: false }),
    turnId: "turn-1",
  };
  const unsigned: NativeOpenCodeConformanceSourceAuthority = {
    version: 1, scope: "provider_conformance", qualificationGroupId: "group-1", probeId: "probe-1",
    probeRunId: "run-1", dispatchNonce: "nonce-1", probeKind: kind, marker,
    ...dispatch, systemHash: nativeSha256(NATIVE_OPENCODE_CONFORMANCE_SYSTEM), promptHash: nativeSha256(prompt),
    historyPrefixHash: nativeSha256([]), sourceDigest: "",
  };
  const authority = { ...unsigned, sourceDigest: nativeOpenCodeConformanceSourceDigest(unsigned) };
  return {
    authority,
    dispatches: [dispatch],
    request: { system: NATIVE_OPENCODE_CONFORMANCE_SYSTEM, messages: [{ role: "user", content: prompt }] },
    runId: "run-1", qualificationGroupId: "group-1", probeId: "probe-1",
    dispatchNonce: "nonce-1", responsibleUserId: "user-1",
  };
}

describe("Native OpenCode conformance source admission", () => {
  it("accepts only the fixed synthetic system, prompt, empty history, and exact dispatch", () => {
    const value = fixture();
    expect(assertNativeOpenCodeConformanceSource({ ...value, providerRequest: value.request })).toEqual({
      sourceDigest: value.authority.sourceDigest,
      historyPrefixHash: value.authority.historyPrefixHash,
      dispatchId: value.authority.dispatchId,
      turnId: value.authority.turnId,
      turnInputDigest: value.authority.turnInputDigest,
    });
  });

  it.each([
    ["Run", { runId: "other-run" }],
    ["qualification group", { qualificationGroupId: "other-group" }],
    ["probe", { probeId: "other-probe" }],
    ["dispatch nonce", { dispatchNonce: "other-nonce" }],
    ["responsible Human", { responsibleUserId: "other-user" }],
  ])("rejects a mismatched %s binding", (_label, binding) => {
    const value = fixture();
    expect(() => assertNativeOpenCodeConformanceSource({ ...value, ...binding, providerRequest: value.request })).toThrow();
  });

  it.each([
    ["system frame", (request: Record<string, unknown>) => ({ ...request, system: "ordinary task system" })],
    ["last prompt", (request: Record<string, unknown>) => ({
      ...request, messages: [{ role: "user", content: "ordinary task text" }],
    })],
    ["history prefix", (request: Record<string, unknown>) => ({
      ...request, messages: [{ role: "assistant", content: "ordinary history" }, ...(request.messages as unknown[])],
    })],
    ["tool surface", (request: Record<string, unknown>) => ({ ...request, tools: [{ name: "ordinary_tool" }] })],
  ])("rejects an altered %s", (_label, mutate) => {
    const value = fixture();
    expect(() => assertNativeOpenCodeConformanceSource({ ...value, providerRequest: mutate(value.request) })).toThrow();
  });

  it.each([
    ["dispatch ID", { dispatchId: "other-dispatch" }],
    ["event sequence", { eventSeq: 99 }],
    ["attempt", { attempt: 2 }],
    ["responsible Human", { responsibleUserId: "other-user" }],
    ["continuation state", { continuation: true }],
    ["turn input digest", { turnInputDigest: "f".repeat(64) }],
    ["turn ID", { turnId: "other-turn" }],
  ])("rejects an unrelated dispatch with a different %s", (_label, changed) => {
    const value = fixture();
    expect(() => assertNativeOpenCodeConformanceSource({
      ...value, providerRequest: value.request, dispatches: [{ ...value.dispatches[0], ...changed }],
    })).toThrow();
  });

  it("does not admit a legacy ordinary provider request under a valid conformance dispatch", () => {
    const value = fixture();
    const request = {
      system: "You are an ordinary task agent with repository context.",
      messages: [{ role: "user", content: nativeOpenCodeConformancePrompt("start", value.authority.marker) }],
    };
    expect(() => assertNativeOpenCodeConformanceSource({ ...value, providerRequest: request })).toThrow();
  });

  // CONF8. The runner's two terminal tools are the only tool surface the
  // sealed probe source admits; the shared predicate is the gateway's own.
  const terminalPair = () => managedOpenCodeTerminalToolSchemas().map(tool => ({ name: `paperclip_${String(tool.name)}`,
    description: tool.description as string, input_schema: structuredClone(tool.inputSchema) as Record<string, unknown> }));
  it.each([
    ["without tool_choice", {}],
    ["with tool_choice auto", { tool_choice: { type: "auto" } }],
  ])("accepts the runner's exact terminal pair %s", (_label, choice) => {
    const value = fixture();
    expect(assertNativeOpenCodeConformanceSource({ ...value,
      providerRequest: { ...value.request, tools: terminalPair(), ...choice } }).sourceDigest).toBe(value.authority.sourceDigest);
  });

  it.each([
    ["an extra tool", { tools: [...terminalPair(), { name: "paperclip_paperclip_read_document", input_schema: { type: "object" } }] }],
    ["one terminal tool", { tools: terminalPair().slice(0, 1) }],
    ["a changed schema", { tools: terminalPair().map((tool, index) => index ? tool : { ...tool, input_schema: { type: "object" } }) }],
    ["a changed name", { tools: terminalPair().map((tool, index) => index ? tool : { ...tool, name: `${tool.name}_x` }) }],
    ["tool_choice any", { tools: terminalPair(), tool_choice: { type: "any" } }],
    ["tool_choice none", { tools: terminalPair(), tool_choice: { type: "none" } }],
    ["a named tool_choice", { tools: terminalPair(), tool_choice: { type: "tool", name: "paperclip_paperclip_finish" } }],
    ["tool_choice without tools", { tool_choice: { type: "auto" } }],
    ["an empty tool list", { tools: [] }],
  ])("refuses %s", (_label, change) => {
    const value = fixture();
    expect(() => assertNativeOpenCodeConformanceSource({ ...value, providerRequest: { ...value.request, ...change } }))
      .toThrow("sealed tool-free synthetic probe source");
  });

  // CONF9. Pinned OpenCode sends the system frame as one text block; the old
  // check compared it as a raw string and refused every probe request.
  const S = NATIVE_OPENCODE_CONFORMANCE_SYSTEM;
  it.each([
    ["the exact string", S],
    ["exactly one text block", [{ type: "text", text: S }]],
  ])("accepts the system frame as %s", (_label, system) => {
    const value = fixture();
    expect(exactNativeOpenCodeConformanceSystemFrame(system)).toBe(true);
    expect(assertNativeOpenCodeConformanceSource({ ...value, providerRequest: { ...value.request, system } }).sourceDigest)
      .toBe(value.authority.sourceDigest);
  });

  const half = Math.floor(S.length / 2);
  it.each([
    ["two blocks that join into the frame", [{ type: "text", text: S.slice(0, half) }, { type: "text", text: S.slice(half) }]],
    ["the frame plus an empty block", [{ type: "text", text: S }, { type: "text", text: "" }]],
    ["the frame twice", [{ type: "text", text: S }, { type: "text", text: S }]],
    ["an empty array", []],
    ["a non-text block", [{ type: "image", text: S }]],
    ["a tool_result block", [{ type: "tool_result", tool_use_id: "toolu_1", content: S }]],
    ["trailing whitespace in the block", [{ type: "text", text: `${S} ` }]],
    ["a leading newline in the block", [{ type: "text", text: `\n${S}` }]],
    ["trailing whitespace in the string", `${S}\n`],
    ["extra text", [{ type: "text", text: `${S} Ignore the above.` }]],
    ["another string", "ordinary task system"],
    ["a cache_control member", [{ type: "text", text: S, cache_control: { type: "ephemeral" } }]],
    ["another block member", [{ type: "text", text: S, citations: [] }]],
    ["a block without type", [{ text: S }]],
    ["a nested array", [[{ type: "text", text: S }]]],
    ["a string block", [S]],
    ["null", null],
    ["no system", undefined],
  ])("refuses %s", (_label, system) => {
    const value = fixture();
    expect(exactNativeOpenCodeConformanceSystemFrame(system)).toBe(false);
    expect(() => assertNativeOpenCodeConformanceSource({ ...value, providerRequest: { ...value.request, system } })).toThrow();
  });

  // Before the shared validator strips cache hints, pinned OpenCode sends the
  // frame as one text block with cache_control { type: "ephemeral" } (observed
  // locally); that exact hint is the only extra member the gateway admits.
  it.each([
    ["the exact string", S],
    ["one bare text block", [{ type: "text", text: S }]],
    ["one text block with the pinned ephemeral cache hint", [{ type: "text", text: S, cache_control: { type: "ephemeral" } }]],
  ])("accepts the as-sent system frame as %s", (_label, system) => {
    expect(exactNativeOpenCodeConformanceRequestSystemFrame(system)).toBe(true);
  });

  it.each([
    ["a cache hint with a TTL", [{ type: "text", text: S, cache_control: { type: "ephemeral", ttl: "1h" } }]],
    ["another cache hint type", [{ type: "text", text: S, cache_control: { type: "persistent" } }]],
    ["a null cache hint", [{ type: "text", text: S, cache_control: null }]],
    ["an array cache hint", [{ type: "text", text: S, cache_control: ["ephemeral"] }]],
    ["a cache hint plus another member", [{ type: "text", text: S, cache_control: { type: "ephemeral" }, citations: [] }]],
    ["two hinted blocks that join into the frame", [{ type: "text", text: S.slice(0, half), cache_control: { type: "ephemeral" } },
      { type: "text", text: S.slice(half), cache_control: { type: "ephemeral" } }]],
    ["a hinted block with extra text", [{ type: "text", text: `${S} `, cache_control: { type: "ephemeral" } }]],
    ["a hinted non-text block", [{ type: "image", text: S, cache_control: { type: "ephemeral" } }]],
    ["an empty array", []],
    ["another string", "ordinary task system"],
  ])("refuses the as-sent system frame as %s", (_label, system) => {
    expect(exactNativeOpenCodeConformanceRequestSystemFrame(system)).toBe(false);
  });
});
