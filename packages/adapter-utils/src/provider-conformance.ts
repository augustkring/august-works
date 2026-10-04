import type { ProviderConformanceContext, ServerAdapterModule } from "./types.js";

type Probe = Awaited<ReturnType<ProviderConformanceContext["probe"]>>;
function receipt(probe: Probe) { return probe.result.resultJson?.providerReceipt as { agentId?: string; profileRef?: string; sessionId?: string; isolationKey?: string } | undefined; }
function output(probe: Probe) { return typeof probe.result.resultJson?.output === "string" ? probe.result.resultJson.output.trim() : ""; }
function succeeded(probe: Probe) { return probe.result.exitCode === 0 && !probe.result.timedOut && !probe.result.errorCode && probe.result.resultJson?.status === "completed"; }
function routed(probe: Probe, target: ProviderConformanceContext["primary"]) { return receipt(probe)?.agentId === target.providerAgentRef && receipt(probe)?.profileRef === target.providerProfileRef; }

export const testGatewayProviderConformance: NonNullable<ServerAdapterModule["testProviderConformance"]> = async (ctx) => {
  // ponytail: exercise each adapter’s retained gateway protocol and retain each real run.
  // Advertisements and model claims never stand in for routing/cancel receipts.
  const nonce = `AW_PROBE_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
  const checks: Record<string, boolean> = { connect: true, identity: false, start: false, stream: false, wait: false, cancel: false, resume: false, memoryScoping: false, structuredOutput: false, steering: false, skillsSync: false, skillsDiscovery: ctx.snapshot.features.skillsDiscovery, toolDiscovery: ctx.snapshot.features.toolDiscovery };
  const first = await ctx.probe(ctx.primary, { prompt: `Retain the marker ${nonce} in this test conversation. Output exactly ${nonce}. Use no tools and change no external resources.` });
  checks.identity = routed(first, ctx.primary);
  checks.start = succeeded(first) && output(first) === nonce;
  checks.stream = first.streamObserved;
  checks.wait = succeeded(first);
  if (ctx.snapshot.features.sessions || ctx.snapshot.features.memoryScoping || ctx.peer) {
    const resumed = await ctx.probe(ctx.primary, { prompt: "Output exactly the AW_PROBE marker retained earlier in this conversation. Use no tools. If none exists, output exactly NONE." });
    checks.resume = succeeded(resumed) && routed(resumed, ctx.primary) && Boolean(receipt(first)?.sessionId) && receipt(first)?.sessionId === receipt(resumed)?.sessionId && output(resumed) === nonce;
    if (ctx.peer && checks.resume) {
      const peerNonce = `AW_PROBE_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
      const unseen = await ctx.probe(ctx.peer, { prompt: "Output exactly the AW_PROBE marker from earlier messages in this conversation. Use no tools or external memory search. If none exists, output exactly NONE." });
      const peerWrite = await ctx.probe(ctx.peer, { prompt: `Retain ${peerNonce} in this test conversation and output exactly ${peerNonce}. Use no tools and change no external resources.` });
      const isolated = await ctx.probe(ctx.primary, { prompt: "Output exactly the most recent AW_PROBE marker from this conversation. Use no tools or external memory search. If none exists, output exactly NONE." });
      checks.memoryScoping = succeeded(unseen) && routed(unseen, ctx.peer) && output(unseen) === "NONE" && receipt(unseen)?.sessionId !== receipt(first)?.sessionId && succeeded(peerWrite) && routed(peerWrite, ctx.peer) && output(peerWrite) === peerNonce && succeeded(isolated) && routed(isolated, ctx.primary) && output(isolated) === nonce && ctx.primary.providerProfileRef !== ctx.peer.providerProfileRef && (ctx.snapshot.provider !== "paperclip_native" || Boolean(receipt(first)?.isolationKey && receipt(unseen)?.isolationKey && receipt(first)?.isolationKey !== receipt(unseen)?.isolationKey));
    }
  }
  if (ctx.snapshot.features.structuredOutput) {
    const structured = await ctx.probe(ctx.primary, { prompt: `Output only a JSON object with one property, marker, whose value is ${nonce}. Use no tools.`, structured: true });
    try { const parsed = JSON.parse(output(structured)); checks.structuredOutput = succeeded(structured) && routed(structured, ctx.primary) && parsed.marker === nonce && Object.keys(parsed).length === 1; } catch { /* absent structured evidence remains false */ }
  }
  const cancelled = await ctx.probe(ctx.primary, { prompt: "This is an operator cancellation probe. Produce a long sequence of numbers until cancelled. Use no tools and change no external resources.", cancelAfterMs: 500 });
  checks.cancel = cancelled.cancellationRequested && cancelled.result.errorCode === "cancelled" && ["cancelled", "canceled", "stopped"].includes(String(cancelled.result.resultJson?.status));
  // No steering/sync contract is implemented in this adapter yet. If advertised,
  // the server requires it and qualification fails instead of guessing support.
  return checks;
};
