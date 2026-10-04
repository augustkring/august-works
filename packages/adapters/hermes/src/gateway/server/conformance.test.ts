import { describe, expect, it, vi } from "vitest";
import type { ProviderConformanceContext } from "@paperclipai/adapter-utils";
import { testProviderConformance } from "./conformance.js";

function fixture(leak = false, wrongRouting = false): ProviderConformanceContext {
  const state = new Map<string, string>();
  const primary = { companyId: "a", agentId: "a", providerAgentRef: "a", providerProfileRef: "profile-a", sessionNamespace: "scope-a" }, peer = { companyId: "b", agentId: "b", providerAgentRef: "b", providerProfileRef: "profile-b", sessionNamespace: "scope-b" };
  return { primary, peer, snapshot: { provider: "hermes", version: "fixture", features: { sessions: true, cancellation: true, steering: false, structuredOutput: false, skillsDiscovery: false, skillsSync: false, toolDiscovery: false, memoryScoping: true }, tools: [], skills: [], discoveredAt: new Date().toISOString(), hash: "fixture" }, probe: vi.fn(async (target, input) => {
    const marker = input.prompt.match(/AW_PROBE_[a-f0-9]{32}/)?.[0];
    if (marker) state.set(leak ? "shared" : target.sessionNamespace, marker);
    const output = marker ?? state.get(leak ? "shared" : target.sessionNamespace) ?? "NONE";
    return { streamObserved: true, cancellationRequested: Boolean(input.cancelAfterMs), result: { exitCode: input.cancelAfterMs ? null : 0, signal: null, timedOut: false, costUsd: 0, ...(input.cancelAfterMs ? { errorCode: "cancelled" } : {}), resultJson: { status: input.cancelAfterMs ? "cancelled" : "completed", output, providerReceipt: { agentId: wrongRouting ? "other" : target.providerAgentRef, profileRef: target.providerProfileRef, sessionId: target.sessionNamespace } } } };
  }) };
}
describe("real-probe conformance interpretation (local protocol fixtures)", () => {
  it("requires routing receipts, retained session continuity and negative profile controls", async () => {
    const context = fixture();
    expect(await testProviderConformance(context)).toMatchObject({ identity: true, start: true, stream: true, wait: true, cancel: true, resume: true, memoryScoping: true, steering: false, skillsSync: false });
    expect(context.probe).toHaveBeenCalledTimes(6);
  });
  it("rejects shared memory, misrouting and isolation without a second explicit profile", async () => {
    expect((await testProviderConformance(fixture(true))).memoryScoping).toBe(false);
    expect((await testProviderConformance(fixture(false, true))).identity).toBe(false);
    expect((await testProviderConformance({ ...fixture(), peer: null })).memoryScoping).toBe(false);
  });
  it("a provider-cancelled response is not proof of an operator-requested cancellation", async () => {
    const context = fixture(), probe = context.probe;
    context.probe = async (target, input) => ({ ...await probe(target, input), cancellationRequested: false });
    expect((await testProviderConformance(context)).cancel).toBe(false);
  });
  it("a completed run is not evidence that cancellation works", async () => {
    const context = fixture(), probe = context.probe;
    context.probe = async (target, input) => { const result = await probe(target, input); if (input.cancelAfterMs) result.result.resultJson!.status = "completed"; return result; };
    expect((await testProviderConformance(context)).cancel).toBe(false);
  });
});
