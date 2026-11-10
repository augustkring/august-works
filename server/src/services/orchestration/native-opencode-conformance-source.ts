import { createHash } from "node:crypto";
import { forbidden } from "../../errors.js";
import { nativeSha256 } from "../native-runtime/canonical.js";

/** A compact, server-owned receipt written by the Native conformance session
 * owner after onTurnInput persists the dispatch intent and before startTurn can
 * spend. It contains hashes and the fixed template selector, never caller text. */
export type NativeOpenCodeConformanceSourceAuthority = Readonly<{
  version: 1;
  scope: "provider_conformance";
  qualificationGroupId: string;
  probeId: string;
  probeRunId: string;
  dispatchNonce: string;
  responsibleUserId: string;
  probeKind: "start" | "resume" | "peer_unseen" | "peer_write" | "isolation_read" | "cancel";
  marker: string;
  dispatchId: string;
  eventSeq: number;
  attempt: number;
  continuation: boolean;
  turnInputDigest: string;
  systemHash: string;
  promptHash: string;
  historyPrefixHash: string;
  /** Added by onTurnStarted after provider start returns; absent at the
   * pre-spend gateway check by design. */
  turnId?: string;
  sourceDigest: string;
}>;

/** The entire system frame for this probe family. */
export const NATIVE_OPENCODE_CONFORMANCE_SYSTEM =
  "You are in an isolated provider conformance probe. No company, task, repository, customer, or tool context is available. Follow only the user message. Never call tools. Return only the requested text.";

export function nativeOpenCodeConformancePrompt(kind: NativeOpenCodeConformanceSourceAuthority["probeKind"], marker: string) {
  if (!/^AW_PROBE_[A-Fa-f0-9]{32}$/.test(marker)) throw forbidden("The synthetic OpenCode probe marker is invalid");
  const instructions: Record<NativeOpenCodeConformanceSourceAuthority["probeKind"], string> = {
    start: `Retain the marker ${marker} in this test conversation. Output exactly ${marker}. Use no tools.`,
    resume: "Output exactly the AW_PROBE marker retained earlier in this session. Use no tools. If absent, output exactly NONE.",
    peer_unseen: "Output exactly the AW_PROBE marker from the other isolated presence. Use no tools. If absent, output exactly NONE.",
    peer_write: `Retain ${marker} in this test conversation. Output exactly ${marker}. Use no tools.`,
    isolation_read: "Output exactly the last AW_PROBE marker from this session. Use no tools. If absent, output exactly NONE.",
    cancel: "Continue emitting a long sequence of numbers until cancelled. Use no tools.",
  };
  const instruction = instructions[kind];
  if (!instruction) throw forbidden("The synthetic OpenCode probe kind is invalid");
  return JSON.stringify({ schema: "paperclip.native-opencode-conformance-probe.v1", kind, instruction });
}

export function nativeOpenCodeConformanceTurnInputDigest(input: {
  kind: NativeOpenCodeConformanceSourceAuthority["probeKind"];
  marker: string;
  continuation: boolean;
}) {
  return createHash("sha256").update(JSON.stringify({
    message: { role: "user", text: nativeOpenCodeConformancePrompt(input.kind, input.marker) },
    ...(input.continuation ? { continuation: true } : {}),
  })).digest("hex");
}

function textContent(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return null;
  let text = "";
  for (const block of value) {
    if (!block || typeof block !== "object" || Array.isArray(block) ||
        (block as Record<string, unknown>).type !== "text" ||
        typeof (block as Record<string, unknown>).text !== "string") return null;
    text += (block as { text: string }).text;
  }
  return text;
}

export function nativeOpenCodeConformanceSourceDigest(a: NativeOpenCodeConformanceSourceAuthority) {
  return nativeSha256({ version: a.version, scope: a.scope, qualificationGroupId: a.qualificationGroupId,
    probeId: a.probeId, probeRunId: a.probeRunId, dispatchNonce: a.dispatchNonce,
    responsibleUserId: a.responsibleUserId, probeKind: a.probeKind, marker: a.marker,
    dispatchId: a.dispatchId, eventSeq: a.eventSeq, attempt: a.attempt, continuation: a.continuation,
    turnInputDigest: a.turnInputDigest, systemHash: a.systemHash, promptHash: a.promptHash,
    historyPrefixHash: a.historyPrefixHash });
}

/** Validate raw provider-visible source before any ledger reservation. The
 * authority must be loaded from the canonical run's server-owned profile, and
 * dispatches from that same run's Native input intent array. */
export function assertNativeOpenCodeConformanceSource(input: {
  providerRequest: Record<string, unknown>;
  authority: NativeOpenCodeConformanceSourceAuthority;
  dispatches: readonly Record<string, unknown>[];
  runId: string;
  qualificationGroupId: string;
  probeId: string;
  dispatchNonce: string;
  responsibleUserId: string;
}) {
  const { authority: a, providerRequest: request } = input;
  if (a.version !== 1 || a.scope !== "provider_conformance" || a.probeRunId !== input.runId ||
      a.qualificationGroupId !== input.qualificationGroupId || a.probeId !== input.probeId ||
      a.dispatchNonce !== input.dispatchNonce || a.responsibleUserId !== input.responsibleUserId ||
      !a.dispatchId || !Number.isSafeInteger(a.eventSeq) || !Number.isSafeInteger(a.attempt) ||
      !/^[a-f0-9]{64}$/.test(a.turnInputDigest) || !/^[a-f0-9]{64}$/.test(a.systemHash) ||
      !/^[a-f0-9]{64}$/.test(a.promptHash) || !/^[a-f0-9]{64}$/.test(a.historyPrefixHash) ||
      !/^AW_PROBE_[A-Fa-f0-9]{32}$/.test(a.marker) || a.sourceDigest !== nativeOpenCodeConformanceSourceDigest(a))
    throw forbidden("The server-owned Native OpenCode probe source receipt is invalid");

  const matching = input.dispatches.filter(d => d.dispatchId === a.dispatchId && d.eventSeq === a.eventSeq &&
    d.attempt === a.attempt && d.responsibleUserId === a.responsibleUserId &&
    d.continuation === a.continuation && d.turnInputDigest === a.turnInputDigest &&
    (a.turnId === undefined || d.turnId === a.turnId));
  if (matching.length !== 1) throw forbidden("The exact Native model-input dispatch intent is required");

  const system = textContent(request.system);
  const messages = Array.isArray(request.messages) ? request.messages.map((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const row = entry as Record<string, unknown>, text = textContent(row.content);
    return text === null || (row.role !== "user" && row.role !== "assistant") ? null : { role: row.role, text };
  }) : null;
  const last = messages?.at(-1);
  const prompt = nativeOpenCodeConformancePrompt(a.probeKind, a.marker);
  if (system !== NATIVE_OPENCODE_CONFORMANCE_SYSTEM || request.system !== NATIVE_OPENCODE_CONFORMANCE_SYSTEM ||
      nativeSha256(system) !== a.systemHash || !messages || !last || last.role !== "user" ||
      last.text !== prompt || nativeSha256(last.text) !== a.promptHash ||
      nativeSha256(messages.slice(0, -1)) !== a.historyPrefixHash || messages.length > 32 ||
      request.tools !== undefined || request.tool_choice !== undefined)
    throw forbidden("The provider-visible OpenCode request differs from the sealed tool-free synthetic probe source");

  const inputDigest = nativeOpenCodeConformanceTurnInputDigest({ kind: a.probeKind, marker: a.marker,
    continuation: a.continuation });
  if (inputDigest !== a.turnInputDigest)
    throw forbidden("The current synthetic prompt does not match the Native input dispatch intent");
  return Object.freeze({ sourceDigest: a.sourceDigest, historyPrefixHash: a.historyPrefixHash,
    dispatchId: a.dispatchId, turnId: a.turnId ?? null, turnInputDigest: a.turnInputDigest });
}
