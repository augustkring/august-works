import { createHash } from "node:crypto";
import { forbidden } from "../../errors.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { managedOpenCodeConformanceToolSurfaceAllowed } from "../native-runtime/managed-opencode-terminal-tools.js";

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

/** CONF9. The provider-visible system frame of a probe request: exactly the
 * fixed conformance system string, or exactly one text block carrying exactly
 * that string (pinned OpenCode 1.18.32 sends the array form). Two or more
 * blocks are refused even when their texts join into the frame, and so are a
 * non-text block, any other block member and an empty array. The shared
 * Messages validator has already removed `cache_control` from system blocks
 * before this check, so the block must be exactly `{ type, text }`. */
export function exactNativeOpenCodeConformanceSystemFrame(value: unknown): boolean {
  if (value === NATIVE_OPENCODE_CONFORMANCE_SYSTEM) return true;
  if (!Array.isArray(value) || value.length !== 1) return false;
  const block = value[0];
  return !!block && typeof block === "object" && !Array.isArray(block) && Object.getPrototypeOf(block) === Object.prototype &&
    Object.keys(block).sort().join(",") === "text,type" && (block as Record<string, unknown>).type === "text" &&
    (block as Record<string, unknown>).text === NATIVE_OPENCODE_CONFORMANCE_SYSTEM;
}

/** CONF9. The same frame as the probe request arrives, before the shared
 * Messages validator strips cache hints: pinned OpenCode 1.18.32 sends exactly
 * one text block with `cache_control: { type: "ephemeral" }` (observed
 * locally 2026-11-15). That one member, with exactly that value, is the only
 * addition to `exactNativeOpenCodeConformanceSystemFrame`. */
export function exactNativeOpenCodeConformanceRequestSystemFrame(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 1) return exactNativeOpenCodeConformanceSystemFrame(value);
  const block = value[0];
  if (!block || typeof block !== "object" || Array.isArray(block) || Object.getPrototypeOf(block) !== Object.prototype)
    return false;
  const { cache_control: cacheControl, ...rest } = block as Record<string, unknown>;
  if (Object.hasOwn(block, "cache_control") && (!cacheControl || typeof cacheControl !== "object" || Array.isArray(cacheControl) ||
      Object.keys(cacheControl).join(",") !== "type" || (cacheControl as Record<string, unknown>).type !== "ephemeral"))
    return false;
  return exactNativeOpenCodeConformanceSystemFrame([rest]);
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

type NativeOpenCodeConformanceProbeKind = NativeOpenCodeConformanceSourceAuthority["probeKind"];
const NATIVE_OPENCODE_CONFORMANCE_PROBE_KINDS: ReadonlySet<string> =
  new Set(["start", "resume", "peer_unseen", "peer_write", "isolation_read", "cancel"]);

/** Probe kinds whose turn continues the presence's earlier session
 * (`continuation: true` and a non-empty history prefix). The probe owner
 * resumes a presence's session whenever it holds a completed snapshot for it,
 * so `peer_write` continues the peer session opened by `peer_unseen` (CONF5b).
 * `start` and `peer_unseen` are the first turns of fresh sessions. */
export const NATIVE_OPENCODE_CONFORMANCE_CONTINUATION_KINDS: ReadonlySet<NativeOpenCodeConformanceProbeKind> =
  new Set(["resume", "isolation_read", "cancel", "peer_write"]);

/** The presence's own earlier turns, in order, that a probe's history prefix
 * must replay: the primary runs start, resume, isolation_read and cancel in
 * one session; the peer runs peer_unseen and peer_write in another. A history
 * from the other presence's session never matches. */
const NATIVE_OPENCODE_CONFORMANCE_PRIOR_TURNS: Readonly<Record<NativeOpenCodeConformanceProbeKind, readonly NativeOpenCodeConformanceProbeKind[]>> = {
  start: [], resume: ["start"], isolation_read: ["start", "resume"], cancel: ["start", "resume", "isolation_read"],
  peer_unseen: [], peer_write: ["peer_unseen"],
};

/** Typed conformance source handed to the Native dispatch-intent recorder in
 * place of a generic bootstrap source closure. Every member is server-owned:
 * the issuer tuple RuntimeControl persisted at session start, the fixed probe
 * template selector, and the server-tracked history of this presence. */
export type NativeOpenCodeConformanceDispatchSource = Readonly<{
  kind: "provider_conformance";
  qualificationGroupId: string;
  planId: string;
  profileId: string;
  probeId: string;
  dispatchNonce: string;
  responsibleUserId: string;
  probeKind: NativeOpenCodeConformanceProbeKind;
  marker: string;
  historyPrefix: readonly Readonly<{ role: "user" | "assistant"; text: string }>[];
}>;

const CONFORMANCE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONFORMANCE_TUPLE_KEYS = ["authorityHash", "dispatchNonce", "planId", "probeId", "profileId", "qualificationGroupId"].join(",");

function conformanceRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** The history prefix is exactly this presence's earlier turns in its own
 * session: for each prior probe kind its fixed user prompt (the primary's
 * start prompt carries this marker) followed by that probe's answer. The
 * owner records an answer only for a completed probe, and an incomplete probe
 * ends the group, so every prior turn has one. */
function conformanceHistoryMatchesPresence(kind: NativeOpenCodeConformanceProbeKind, marker: string,
  history: readonly unknown[]): boolean {
  const prior = NATIVE_OPENCODE_CONFORMANCE_PRIOR_TURNS[kind];
  if (!prior || (prior.length !== 0) !== NATIVE_OPENCODE_CONFORMANCE_CONTINUATION_KINDS.has(kind) ||
    history.length !== prior.length * 2) return false;
  return history.every((entry, index) => {
    const row = conformanceRecord(entry);
    if (!row || Object.keys(row).sort().join(",") !== "role,text" || typeof row.text !== "string") return false;
    return index % 2 === 0
      ? row.role === "user" && row.text === nativeOpenCodeConformancePrompt(prior[index / 2]!, marker)
      : row.role === "assistant";
  });
}

/** Bind the typed conformance source to the dispatch intent being recorded
 * and return the sealed source receipt (CONF5). Called by the recorder inside
 * the intent transaction, against the locked Run row: the hidden
 * provider-conformance Run and its Human, the issuer-persisted dispatch tuple,
 * the conformance-shaped managed OpenCode source authority (no tools, the
 * fixed system frame, no generic prompt binding or input receipt), the one
 * turn of this Run, and the fixed template (prompt text, continuation flag
 * and the presence's own earlier turns as history for the probe kind). Anything else is refused; there is
 * no generic exemption. */
export function sealNativeOpenCodeConformanceDispatchSource(input: {
  source: NativeOpenCodeConformanceDispatchSource;
  run: Readonly<{ id: string; responsibleUserId: string | null; triggerDetail: string | null; contextSnapshot: unknown }>;
  profile: Readonly<Record<string, unknown>>;
  turnInput: unknown;
  intent: Readonly<{ dispatchId: string; eventSeq: number; attempt: number; responsibleUserId: string | null;
    turnInputDigest: string; continuation: boolean }>;
  priorIntentCount: number;
}): NativeOpenCodeConformanceSourceAuthority {
  const refuse = (): never => {
    throw forbidden("The exact hidden conformance Run, dispatch tuple, source authority and fixed probe template are required");
  };
  const { source, run, profile, intent } = input;
  const context = conformanceRecord(run.contextSnapshot) ?? {};
  const tuple = conformanceRecord(context.nativeOpenCodeConformanceDispatch);
  const authority = conformanceRecord(profile.nativeOpenCodeSourceAuthority);
  const turn = conformanceRecord(input.turnInput);
  const message = conformanceRecord(turn?.message);
  if (!source || source.kind !== "provider_conformance" || !NATIVE_OPENCODE_CONFORMANCE_PROBE_KINDS.has(source.probeKind) ||
    ![source.qualificationGroupId, source.planId, source.profileId, source.probeId, source.dispatchNonce]
      .every(id => typeof id === "string" && CONFORMANCE_UUID.test(id)) ||
    typeof source.responsibleUserId !== "string" || source.responsibleUserId.length === 0 ||
    typeof source.marker !== "string" || !/^AW_PROBE_[A-Fa-f0-9]{32}$/.test(source.marker))
    return refuse();
  const continuationProbe = NATIVE_OPENCODE_CONFORMANCE_CONTINUATION_KINDS.has(source.probeKind);
  const prompt = nativeOpenCodeConformancePrompt(source.probeKind, source.marker);
  const history = Array.isArray(source.historyPrefix) ? source.historyPrefix : null;
  // The hidden Run, its Human and the issuer tuple RuntimeControl persisted.
  if (run.triggerDetail !== "provider_conformance" || run.responsibleUserId !== source.responsibleUserId ||
    intent.responsibleUserId !== source.responsibleUserId ||
    context.providerConformanceGroupId !== source.qualificationGroupId ||
    context.providerConformancePlanId !== source.planId ||
    context.nativeOpenCodeConformanceProbeId !== source.probeId ||
    context.nativeOpenCodeConformanceProfileId !== source.profileId ||
    context.containsCompanyContext !== false || context.platformToolsGranted !== false ||
    !tuple || Object.keys(tuple).sort().join(",") !== CONFORMANCE_TUPLE_KEYS ||
    tuple.qualificationGroupId !== source.qualificationGroupId || tuple.planId !== source.planId ||
    tuple.profileId !== source.profileId || tuple.probeId !== source.probeId ||
    tuple.dispatchNonce !== source.dispatchNonce ||
    typeof tuple.authorityHash !== "string" || !/^[a-f0-9]{64}$/.test(tuple.authorityHash))
    return refuse();
  // The conformance-shaped managed OpenCode source authority, still unbound:
  // no tools, the fixed system frame, the immutable input, no prompt binding.
  if (!authority || authority.version !== 1 || authority.executionInputHash !== nativeSha256(profile.nativeExecutionInput) ||
    authority.systemInstructionsHash !== nativeSha256(NATIVE_OPENCODE_CONFORMANCE_SYSTEM) ||
    !Array.isArray(authority.toolSchemas) || authority.toolSchemas.length !== 0 ||
    authority.toolSchemasHash !== nativeSha256([]) ||
    !Array.isArray(authority.authorizedPromptHashes) || authority.authorizedPromptHashes.length !== 0 ||
    !Array.isArray(authority.promptSourceBindings) || authority.promptSourceBindings.length !== 0 ||
    Object.hasOwn(authority, "workspaceMetadataSource") || authority.attachmentStageHash !== null)
    return refuse();
  // One model turn per hidden Run, with no other Native input or effect.
  if (input.priorIntentCount !== 0 || profile.nativeInputSourceReceipt !== undefined ||
    profile.nativeOpenCodeConformanceSourceAuthority !== undefined ||
    (Array.isArray(profile.nativeToolCallDispatchAssociations) && profile.nativeToolCallDispatchAssociations.length !== 0) ||
    (Array.isArray(profile.nativeToolResultSourceCaptures) && profile.nativeToolResultSourceCaptures.length !== 0))
    return refuse();
  // The fixed template: prompt, continuation flag and history shape.
  if (!turn || Object.keys(turn).some(key => key !== "message" && key !== "continuation") ||
    !message || Object.keys(message).sort().join(",") !== "role,text" || message.role !== "user" || message.text !== prompt ||
    (continuationProbe ? turn.continuation !== true : Object.hasOwn(turn, "continuation")) ||
    intent.continuation !== continuationProbe ||
    intent.turnInputDigest !== nativeOpenCodeConformanceTurnInputDigest({ kind: source.probeKind, marker: source.marker,
      continuation: continuationProbe }) ||
    !history || !conformanceHistoryMatchesPresence(source.probeKind, source.marker, history))
    return refuse();
  if (typeof intent.dispatchId !== "string" || intent.dispatchId.length === 0 ||
    !Number.isSafeInteger(intent.eventSeq) || !Number.isSafeInteger(intent.attempt))
    return refuse();
  const unsealed: NativeOpenCodeConformanceSourceAuthority = {
    version: 1, scope: "provider_conformance", qualificationGroupId: source.qualificationGroupId,
    probeId: source.probeId, probeRunId: run.id, dispatchNonce: source.dispatchNonce,
    responsibleUserId: source.responsibleUserId, probeKind: source.probeKind, marker: source.marker,
    dispatchId: intent.dispatchId, eventSeq: intent.eventSeq, attempt: intent.attempt,
    continuation: continuationProbe, turnInputDigest: intent.turnInputDigest,
    systemHash: nativeSha256(NATIVE_OPENCODE_CONFORMANCE_SYSTEM), promptHash: nativeSha256(prompt),
    historyPrefixHash: nativeSha256(history.map(entry => ({ role: entry.role, text: entry.text }))), sourceDigest: "",
  };
  return Object.freeze({ ...unsealed, sourceDigest: nativeOpenCodeConformanceSourceDigest(unsealed) });
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
  if (system !== NATIVE_OPENCODE_CONFORMANCE_SYSTEM || !exactNativeOpenCodeConformanceSystemFrame(request.system) ||
      nativeSha256(system) !== a.systemHash || !messages || !last || last.role !== "user" ||
      last.text !== prompt || nativeSha256(last.text) !== a.promptHash ||
      nativeSha256(messages.slice(0, -1)) !== a.historyPrefixHash || messages.length > 32 ||
      !managedOpenCodeConformanceToolSurfaceAllowed(request))
    throw forbidden("The provider-visible OpenCode request differs from the sealed tool-free synthetic probe source");

  const inputDigest = nativeOpenCodeConformanceTurnInputDigest({ kind: a.probeKind, marker: a.marker,
    continuation: a.continuation });
  if (inputDigest !== a.turnInputDigest)
    throw forbidden("The current synthetic prompt does not match the Native input dispatch intent");
  return Object.freeze({ sourceDigest: a.sourceDigest, historyPrefixHash: a.historyPrefixHash,
    dispatchId: a.dispatchId, turnId: a.turnId ?? null, turnInputDigest: a.turnInputDigest });
}
