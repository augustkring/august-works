import { describe, expect, it } from "vitest";
import { nativeSha256 } from "../native-runtime/canonical.js";
import {
  assertNativeOpenCodeConformanceSource,
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
});
