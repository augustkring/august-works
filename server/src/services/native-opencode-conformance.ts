import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { and, eq, isNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { agents, agentIdentities, environmentLeases, heartbeatRuns, issues, orchestrationModelReservations,
  orchestrationPlans, orchestrationWorkerAttempts, orchestrationWorkers, agentExecutionManifests,
  agentExecutionAuthorizations, nativeRunFinalizations, type Db } from "@paperclipai/db";
import { agentExecutionManifestSchema, orchestrationBudgetSchema, orchestrationCompletionSchema,
  providerConformanceInputSchema } from "@paperclipai/shared";
import { conflict, forbidden } from "../errors.js";
import type { AuthorizationActor } from "./authorization.js";
import { assertV7Authorization, assertV7Enabled, v7HumanActorId } from "./v7-authorization.js";
import { agentProviderBindingService } from "./agent-provider-bindings.js";
import { aiConnectionService } from "./ai-connections.js";
import { providerDiscoveryService } from "./provider-discovery.js";
import { resolvePaperclipRunnerProviderProfile } from "./native-runtime/provider-profile.js";
import { hashContextPolicySnapshot } from "./context/context-manifest.js";
import { selectWorkerModelProfile, type WorkerModelProfile } from "./orchestration/worker-model-profiles.js";
import { writeOrchestrationContract } from "./orchestration/orchestration-contracts.js";
import { withV7ActivityTransaction, logActivity } from "./v7-mutations.js";
import type { guardedRemoteHttpFetch } from "./remote-http-fetch.js";
import { quoteModelReservation } from "./orchestration/model-reservations.js";
import { environmentRunOrchestrator } from "./environment-run-orchestrator.js";
import { environmentService } from "./environments.js";
import { providerConformanceRequirements } from "./provider-capabilities.js";
import { validateNativeOpenCodeConformanceHarness } from "./orchestration/native-opencode-conformance-admission.js";
import { verifyNativeCleanupRuntimeState } from "./execution-sandbox/run-lease-cleanup.js";
import type { NativeExecutionInput, NativeSession, NativeSessionBackend, PersistedNativeSession } from "../vendor/paperclip-runner/index.js";
import { appendHeartbeatRunEvent } from "./heartbeat-run-events.js";
import { PROCESS_START_REQUESTED } from "./native-local-process-stop.js";
import { claimNativeExecutionCoordinator, failUnclaimedNativeOpenCodeConformanceRun,
  releaseNativeOpenCodeConformanceCoordinator, recordNativeModelInputDispatchAcknowledgement,
  recordNativeModelInputDispatchIntent } from "./native-runtime/native-session-executor.js";
import { nativeOpenCodeConformancePrompt, NATIVE_OPENCODE_CONFORMANCE_SYSTEM,
  nativeOpenCodeConformanceSourceDigest, type NativeOpenCodeConformanceSourceAuthority } from "./orchestration/native-opencode-conformance-source.js";
import { nativeSha256 } from "./native-runtime/canonical.js";
import { resolvePaperclipInstanceRoot } from "../home-paths.js";
import { materializeNativeChatTaskRoot, type NativeChatWorkspaceScope } from "./native-runtime/native-chat-workspace.js";
import { prepareNativeWorkspaceSync, assertNativeWorkspaceSyncServerVerifiedNone, type PreparedNativeWorkspaceSync } from "./native-runtime/native-workspace-sync.js";
import { executionSandboxService } from "./execution-sandbox/sandbox-service.js";
import type { RealizedExecutionWorkspace } from "./workspace-runtime.js";
import type { EnvironmentRuntimeService } from "./environment-runtime.js";
import { parseEnvironmentDriverConfig } from "./environment-config.js";
import { contextManifestService } from "./context/context-manifest.js";
import { createNativeOpenCodeConformanceProbeBackend } from "./native-runtime/native-session-executor.js";
import { parseNativeExecutionInput } from "../vendor/paperclip-runner/index.js";

export type NativeOpenCodeRemoteProbeContext = Readonly<{
  createBackend(): Promise<NativeSessionBackend>;
  identity: ManagedOpenCodeProbe["identity"];
  workingDirectory: string;
  leaseId: string;
  workspaceSync: PreparedNativeWorkspaceSync;
  remoteTarget: { kind: "remote"; transport: "sandbox"; leaseId: string; remoteCwd: string };
  /** Exact execution prepared by the registered remote factory and checked
   * against the hidden provider-conformance run. */
  execution: NativeExecutionInput;
  runnerInstanceId: string;
  settle(state?: ManagedOpenCodeProbeResult["state"]): Promise<void>;
}>;
type ConformanceWorkspaceRoot = Readonly<{ cwd: string; taskRoot: string; taskId: string; workspaceId: string; creationReceipt: string; createdEmpty: boolean; groupId: string; companyId: string; agentId: string }>;
type Options = { profiles: readonly WorkerModelProfile[]; sourceSha: string; protectedEvidenceOrigin: string;
  environmentRuntime: EnvironmentRuntimeService; runnerInstanceId: string; modelBrokerOrigin: string;
  prepareSandboxRun?: (actor: AuthorizationActor, input: {
    companyId: string; runId: string; taskId: string; planId: string; groupId: string; manifestId: string;
    manifestHash: string; leaseId: string; workspaceRoot: string; creationReceipt: string;
  }) => Promise<unknown>;
  fetch?: typeof guardedRemoteHttpFetch; runtimeSuspectSeconds?: number;
};

/** Wait for the exact provider ledger row to cross the persisted wire boundary.
 * A turn ID, dispatch claim, or scheduled timer alone cannot authorize cancel. */
export async function waitForNativeOpenCodeConformanceWire(input: {
  db: Db; companyId: string; planId: string; idempotencyKey: string;
  signal: AbortSignal; streamEnded(): boolean; delayMs: number;
  cancel(): void; pollMs?: number;
}): Promise<boolean> {
  while (!input.signal.aborted && !input.streamEnded()) {
    const [reservation] = await input.db.select({ id: orchestrationModelReservations.id,
      planId: orchestrationModelReservations.planId, purpose: orchestrationModelReservations.purpose,
      idempotencyKey: orchestrationModelReservations.idempotencyKey, requestHash: orchestrationModelReservations.requestHash,
      status: orchestrationModelReservations.status, providerWireReceipt: orchestrationModelReservations.providerWireReceipt,
    }).from(orchestrationModelReservations).where(and(
      eq(orchestrationModelReservations.companyId, input.companyId),
      eq(orchestrationModelReservations.planId, input.planId),
      eq(orchestrationModelReservations.purpose, "provider_conformance"),
      eq(orchestrationModelReservations.idempotencyKey, input.idempotencyKey),
    )).limit(1);
    if (reservation) {
      // Reserve and wire receipt are separate persisted steps. A live reserved
      // row without a receipt is the expected pre-wire state; keep waiting so
      // cancellation still follows the actual dispatched POST boundary.
      if (reservation.status === "reserved" && reservation.providerWireReceipt == null) {
        await new Promise<void>(resolveWait => setTimeout(resolveWait, input.pollMs ?? 50));
        continue;
      }
      const wire = reservation.providerWireReceipt;
      const exactWire = wire?.version === 1 && wire.reservationId === reservation.id &&
        wire.requestHash === reservation.requestHash && wire.method === "POST" &&
        wire.endpoint === "https://api.anthropic.com/v1/messages" && /^[a-f0-9]{64}$/.test(wire.bodySha256);
      if (!exactWire || reservation.status === "reserved" || reservation.status === "failed" || reservation.status === "cancelled")
        return false;
      if (reservation.status === "completed") return false;
      if (reservation.status !== "dispatched" && reservation.status !== "unknown") return false;
      const timer = setTimeout(input.cancel, input.delayMs);
      timer.unref?.();
      return true;
    }
    await new Promise<void>(resolveWait => setTimeout(resolveWait, input.pollMs ?? 50));
  }
  return false;
}

/** A turn driven by the actual managed Remote OpenCode session backend. */
export type ManagedOpenCodeProbe = Readonly<{
  identity: { runId: string; sessionId: string; companyId: string; issueId: string; agentId: string };
  workingDirectory: string;
  prompt: string;
  expectedOutput?: string;
  previous?: PersistedNativeSession;
  cancelAfterMs?: number;
  signal: AbortSignal;
  /** Read only after openSession has caused RuntimeControl to issue and persist the start tuple. */
  resolveSource?: () => Promise<NonNullable<ManagedOpenCodeProbe["source"]>>;
  source?: Readonly<{ qualificationGroupId: string; probeId: string; dispatchNonce: string;
    planId: string; profileId: string; probeKind: NativeOpenCodeConformanceSourceAuthority["probeKind"];
    marker: string; historyPrefix: readonly { role: "user" | "assistant"; text: string }[] }>;
}>;
export type ManagedOpenCodeProbeResult = Readonly<{
  identity: ManagedOpenCodeProbe["identity"];
  state: "completed" | "cancelled" | "failed" | "unknown";
  output: string;
  sessionId: string | null;
  snapshot: PersistedNativeSession | null;
  streamObserved: boolean;
  localSessionClosed: boolean;
  coordinatorClaimed: boolean;
  errorCode: string | null;
  releaseCoordinator(terminal: Parameters<typeof releaseNativeOpenCodeConformanceCoordinator>[0]["terminal"]): Promise<void>;
}>;

type ConformanceMemoryProbe = Pick<ManagedOpenCodeProbeResult, "state" | "output" | "sessionId">;

export function nativeOpenCodeConformanceMemoryScopingPassed(input: {
  first: Pick<ConformanceMemoryProbe, "sessionId">;
  peerUnseen: ConformanceMemoryProbe;
  peerWrite: ConformanceMemoryProbe;
  isolated: ConformanceMemoryProbe;
  primaryProfileRef: string;
  peerProfileRef: string;
}): boolean {
  return input.peerUnseen.state === "completed" && input.peerUnseen.output.trim() === "NONE" &&
    input.peerWrite.state === "completed" && input.peerWrite.output.trim() !== "" &&
    input.isolated.state === "completed" && input.isolated.output.trim() !== "" &&
    input.peerUnseen.sessionId !== input.first.sessionId && input.primaryProfileRef !== input.peerProfileRef;
}

/** Persist the exact source receipt only after the canonical Native dispatch
 * owner wrote the intent and before startTurn can send the provider request. */
async function persistOpenCodeProbeSource(input: {
  db: Db; execution: NativeExecutionInput; groupId: string; planId: string; profileId: string;
  source: NonNullable<ManagedOpenCodeProbe["source"]>; dispatchId: string; turnInput: Parameters<NativeSession["startTurn"]>[0];
  eventSeq: number; attempt: number; responsibleUserId: string;
}) {
  const { db } = input;
  await db.transaction(async tx => {
    const [run] = await tx.select().from(heartbeatRuns).where(and(
      eq(heartbeatRuns.companyId, input.execution.binding.companyId),
      eq(heartbeatRuns.id, input.execution.binding.runId), eq(heartbeatRuns.agentId, input.execution.binding.agentId),
    )).for("update").limit(1);
    if (!run || run.status !== "running" || run.triggerDetail !== "provider_conformance" ||
        run.responsibleUserId !== input.responsibleUserId || run.nativeIssueId !== input.execution.binding.issueId)
      throw forbidden("The active Human-owned conformance Native run changed before source sealing");
    const contextSnapshot = run.contextSnapshot && typeof run.contextSnapshot === "object" ? run.contextSnapshot as Record<string, any> : {};
    const context = contextSnapshot.nativeOpenCodeConformanceDispatch;
    if (!context || context.qualificationGroupId !== input.groupId || context.planId !== input.planId ||
        context.profileId !== input.profileId || context.probeId !== input.source.probeId ||
        context.dispatchNonce !== input.source.dispatchNonce)
      throw forbidden("The server-minted one-probe RuntimeControl tuple changed before source sealing");
    if (Object.keys(context).sort().join(",") !== ["authorityHash", "dispatchNonce", "planId", "probeId", "profileId", "qualificationGroupId"].sort().join(",") ||
        typeof context.authorityHash !== "string" || !/^[a-f0-9]{64}$/.test(context.authorityHash))
      throw forbidden("The RuntimeControl issuer tuple has an invalid closed shape");
    const encodedInput = JSON.stringify(input.turnInput);
    const runProfile = run.runnerProfileJson && typeof run.runnerProfileJson === "object" ? run.runnerProfileJson as Record<string, any> : {};
    const [intent] = (Array.isArray(runProfile.nativeModelInputDispatchIntents)
      ? runProfile.nativeModelInputDispatchIntents : []).filter((row: any) => row?.dispatchId === input.dispatchId);
    if (!intent || intent.eventSeq !== input.eventSeq || intent.attempt !== input.attempt ||
        intent.responsibleUserId !== input.responsibleUserId || intent.turnInputDigest !== createHash("sha256").update(encodedInput).digest("hex") ||
        input.turnInput.message?.role !== "user" || input.turnInput.message.text !== nativeOpenCodeConformancePrompt(input.source.probeKind, input.source.marker) ||
        Object.keys(input.turnInput).some(key => !["message", "continuation"].includes(key)) ||
        input.turnInput.continuation !== (input.source.probeKind === "resume" || input.source.probeKind === "isolation_read" || input.source.probeKind === "cancel"))
      throw forbidden("The exact fixed Native synthetic turn and persisted dispatch intent are required");
    const authority: NativeOpenCodeConformanceSourceAuthority = {
      version: 1, scope: "provider_conformance", qualificationGroupId: input.groupId,
      probeId: input.source.probeId, probeRunId: run.id, dispatchNonce: input.source.dispatchNonce,
      responsibleUserId: input.responsibleUserId, probeKind: input.source.probeKind, marker: input.source.marker,
      dispatchId: input.dispatchId, eventSeq: input.eventSeq, attempt: input.attempt,
      continuation: input.turnInput.continuation === true, turnInputDigest: intent.turnInputDigest,
      systemHash: nativeSha256(NATIVE_OPENCODE_CONFORMANCE_SYSTEM),
      promptHash: nativeSha256(nativeOpenCodeConformancePrompt(input.source.probeKind, input.source.marker)),
      historyPrefixHash: nativeSha256(input.source.historyPrefix), sourceDigest: "",
    };
    const sealed = { ...authority, sourceDigest: nativeOpenCodeConformanceSourceDigest(authority) };
    const profile = runProfile;
    await tx.update(heartbeatRuns).set({ runnerProfileJson: { ...profile,
      nativeOpenCodeConformanceSourceAuthority: sealed }, updatedAt: new Date() }).where(eq(heartbeatRuns.id, run.id));
  });
}

async function bindOpenCodeProbeTurnId(db: Db, runId: string, turnId: string, dispatchId: string) {
  await db.transaction(async tx => {
    const [run] = await tx.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)).for("update").limit(1);
    const profile = run?.runnerProfileJson && typeof run.runnerProfileJson === "object" ? run.runnerProfileJson as Record<string, any> : {};
    const source = profile.nativeOpenCodeConformanceSourceAuthority as NativeOpenCodeConformanceSourceAuthority | undefined;
    if (!run || !source || source.dispatchId !== dispatchId || !turnId)
      throw forbidden("The acknowledged Native probe turn does not match its pre-spend source receipt");
    const sealed = { ...source, turnId };
    await tx.update(heartbeatRuns).set({ runnerProfileJson: { ...profile,
      nativeOpenCodeConformanceSourceAuthority: sealed }, updatedAt: new Date() }).where(eq(heartbeatRuns.id, runId));
  });
}

/**
 * Drives a real NativeSessionBackend turn and retains actual event/session
 * evidence. The caller must supply the backend constructed by the normal
 * `native-session-executor` remote target owner; local OpenCode backends are
 * explicitly rejected by that caller before this function is used.
 */
export async function runManagedOpenCodeProbe(input: { db: Db; createBackend(): Promise<NativeSessionBackend>; execution: NativeExecutionInput;
  runnerInstanceId: string; responsibleUserId: string; groupId: string; planId: string; profileId: string;
  probe: ManagedOpenCodeProbe }): Promise<ManagedOpenCodeProbeResult> {
  const { probe } = input;
  const signal = probe.signal;
  let session: NativeSession | undefined, snapshot: PersistedNativeSession | null = null;
  let state: ManagedOpenCodeProbeResult["state"] = "failed", output = "", streamObserved = false, localSessionClosed = false;
  let cancellationRequested = false, cancellationObserved = false;
  let coordinator: Awaited<ReturnType<typeof claimNativeExecutionCoordinator>> | null = null;
  let coordinatorReleased = false;
  const releaseCoordinator = async (terminal: Parameters<typeof releaseNativeOpenCodeConformanceCoordinator>[0]["terminal"]) => {
    if (!coordinator || coordinatorReleased) return;
    await releaseNativeOpenCodeConformanceCoordinator({ db: input.db, companyId: probe.identity.companyId,
      issueId: probe.identity.issueId, runId: probe.identity.runId, attempt: coordinator.attempt,
      leaseOwner: coordinator.leaseOwner, controller: coordinator.controller, terminal });
    coordinatorReleased = true;
  };
  let cancellationCleanup: Promise<unknown> | undefined;
  let turnStreamEnded = false;
  let cancelAfterObservedWire: Promise<boolean> | null = null;
  const abort = () => {
    if (!session?.cancel) return;
    cancellationRequested = true;
    try { cancellationCleanup = session.cancel({ reason: "provider_conformance_cancelled", signal: AbortSignal.timeout(5_000) }).cleanup; }
    catch { /* close below must still confirm local settlement */ }
  };
  const previous = probe.previous;
  try {
    coordinator = await claimNativeExecutionCoordinator({ db: input.db, execution: input.execution,
      runnerInstanceId: input.runnerInstanceId });
    const backend = await input.createBackend();
    const launchIntent = await appendHeartbeatRunEvent(input.db, { companyId: probe.identity.companyId,
      runId: probe.identity.runId, agentId: probe.identity.agentId, eventType: PROCESS_START_REQUESTED,
      stream: "system", level: "info", message: "Native conformance session launch requested." });
    if (previous) {
      if (previous.identity.companyId !== probe.identity.companyId || previous.identity.agentId !== probe.identity.agentId ||
          previous.identity.issueId !== probe.identity.issueId || previous.identity.sessionId !== probe.identity.sessionId ||
          !backend.recoverSession) throw new Error("managed_opencode_resume_identity_changed");
      const recovered = await backend.recoverSession(previous, { signal });
      if (!recovered.recovered || !recovered.session?.attachRun) throw new Error("managed_opencode_resume_not_confirmed");
      session = recovered.session; await recovered.session.attachRun({ identity: probe.identity });
    } else session = await backend.openSession({ identity: probe.identity, workingDirectory: probe.workingDirectory, signal });
    const actualIdentity = session.identity();
    for (const [key, value] of Object.entries(probe.identity))
      if (actualIdentity[key as keyof typeof actualIdentity] !== value) throw new Error("managed_opencode_session_identity_changed");
    signal.addEventListener("abort", abort, { once: true }); signal.throwIfAborted();
    snapshot = await session.snapshot({ signal });
    const source = probe.resolveSource ? await probe.resolveSource() : probe.source;
    if (!source) throw forbidden("The server-owned Native conformance source descriptor is required");
    const turnInput: Parameters<NativeSession["startTurn"]>[0] = {
      message: { role: "user", text: probe.prompt }, ...(previous ? { continuation: true as const } : {}) };
    const dispatchId = await recordNativeModelInputDispatchIntent({ db: input.db, runId: probe.identity.runId,
      companyId: probe.identity.companyId, issueId: probe.identity.issueId, agentId: probe.identity.agentId,
      leaseOwner: coordinator.leaseOwner, attempt: coordinator.attempt, controller: coordinator.controller,
      eventSeq: launchIntent.row.seq, turnInput });
    await persistOpenCodeProbeSource({ db: input.db, execution: input.execution, groupId: input.groupId,
      planId: input.planId, profileId: input.profileId, source, dispatchId, turnInput,
      eventSeq: launchIntent.row.seq, attempt: coordinator.attempt, responsibleUserId: input.responsibleUserId });
    const { turnId } = await session.startTurn(turnInput);
    await recordNativeModelInputDispatchAcknowledgement({ db: input.db, runId: probe.identity.runId,
      companyId: probe.identity.companyId, issueId: probe.identity.issueId, agentId: probe.identity.agentId,
      leaseOwner: coordinator.leaseOwner, attempt: coordinator.attempt, controller: coordinator.controller,
      eventSeq: launchIntent.row.seq, dispatchId, turnInput, turnId });
    await bindOpenCodeProbeTurnId(input.db, probe.identity.runId, turnId, dispatchId);
    cancelAfterObservedWire = probe.cancelAfterMs === undefined ? null : waitForNativeOpenCodeConformanceWire({
      db: input.db, companyId: probe.identity.companyId, planId: input.planId,
      idempotencyKey: `opencode-conformance:${probe.identity.runId}:${source.probeId}:${source.dispatchNonce}`,
      signal, streamEnded: () => turnStreamEnded, delayMs: probe.cancelAfterMs, cancel: abort,
    });
    for await (const event of session.events()) {
      signal.throwIfAborted();
      if (event.runId !== probe.identity.runId || event.normalizedSessionId !== probe.identity.sessionId ||
          (event.turnId && event.turnId !== turnId)) throw new Error("managed_opencode_event_identity_changed");
      if (["item.delta", "item.completed", "turn.completed", "turn.cancelled", "turn.interrupted", "turn.failed"].includes(event.eventType)) streamObserved = true;
      if (event.payload.kind === "agentMessage" && typeof event.payload.text === "string") {
        const candidate = event.eventType === "item.delta" ? output + event.payload.text : event.payload.text;
        if (Buffer.byteLength(candidate) > 65536) throw new Error("managed_opencode_probe_output_exceeded");
        output = candidate;
      }
      if (event.eventType === "turn.completed") { state = "completed"; break; }
      if (event.eventType === "turn.cancelled") { cancellationObserved = true; state = "cancelled"; break; }
      if (["turn.interrupted", "turn.failed"].includes(event.eventType)) { state = "failed"; break; }
    }
    turnStreamEnded = true;
    if (cancelAfterObservedWire) await cancelAfterObservedWire;
    if (probe.cancelAfterMs !== undefined && (!cancellationRequested || !cancellationObserved || state !== "cancelled"))
      throw new Error("managed_opencode_cancel_not_observed");
    if (probe.expectedOutput !== undefined && (state !== "completed" || output.trim() !== probe.expectedOutput))
      throw new Error("managed_opencode_probe_output_mismatch");
    if (state === "completed") snapshot = await session.snapshot({ signal });
  } catch {
    state = cancellationObserved ? "cancelled" : signal.aborted || cancellationRequested ? "unknown" : "failed";
  } finally {
    turnStreamEnded = true;
    signal.removeEventListener("abort", abort);
    if (cancelAfterObservedWire) await cancelAfterObservedWire.catch(() => false);
    if (cancellationCleanup) { try { await cancellationCleanup; } catch { state = "unknown"; } }
    if (session) {
      try { await session.close({ reason: "provider_conformance_settled" }); localSessionClosed = true; }
      catch { localSessionClosed = false; state = "unknown"; }
    }
  }
  if (state === "completed" && !localSessionClosed) state = "unknown";
  return { identity: probe.identity, state, output, sessionId: snapshot?.providerSessionId ?? snapshot?.identity.sessionId ?? null, snapshot,
    streamObserved, localSessionClosed, coordinatorClaimed: coordinator !== null, releaseCoordinator, errorCode: state === "completed" ? null : state === "cancelled" && localSessionClosed ? "cancelled" :
      state === "unknown" ? "cancellation_unconfirmed" : "native_opencode_conformance_failed" };
}
type Service = ReturnType<typeof nativeOpenCodeConformanceService>;
const installed = new WeakMap<Db, Service>();
export function registerNativeOpenCodeConformance(db: Db, service: Service | undefined) {
  if (service) installed.set(db, service); else installed.delete(db);
}
export function installedNativeOpenCodeConformance(db: Db) {
  const service = installed.get(db);
  if (!service) throw conflict("The managed Native OpenCode conformance owner is not installed");
  return service;
}

/** One empty, private projectless root per qualification-group/presence. The
 * root is created once, never removed by the harness, and reused only by that
 * presence in this group so the primary can prove resume while the peer remains
 * isolated. The server-side creation receipt lives outside the provider cwd. */
async function createOrReadConformanceWorkspaceRoot(input: { groupId: string; companyId: string; agentId: string; taskId: string }): Promise<ConformanceWorkspaceRoot> {
  const instanceRoot = await fs.realpath(resolvePaperclipInstanceRoot());
  const taskRoot = path.join(instanceRoot, "chat-workspaces", input.companyId, input.agentId, input.taskId);
  const scope: NativeChatWorkspaceScope = { companyId: input.companyId, agentId: input.agentId, issueId: input.taskId,
    projectId: null, instanceRoot, taskRoot };
  const rootParent = path.join(instanceRoot, "chat-workspace-proofs");
  await fs.mkdir(rootParent, { recursive: true, mode: 0o700 });
  const proofRoot = await fs.lstat(rootParent), proofReal = await fs.realpath(rootParent);
  if (proofRoot.isSymbolicLink() || !proofRoot.isDirectory() || proofReal !== rootParent)
    throw new Error("native_conformance_workspace_receipt_root_invalid");
  const key = createHash("sha256").update(`${input.groupId}\0${input.companyId}\0${input.agentId}\0${input.taskId}`).digest("hex");
  const receiptPath = path.join(rootParent, `${key}.json`), cwd = taskRoot;
  let receipt: { schema: string; groupId: string; companyId: string; agentId: string; taskId: string; taskRoot: string; workspaceId: string; cwd: string; dev: number; ino: number } | null = null;
  let createdEmpty = false;
  try {
    const receiptStat = await fs.lstat(receiptPath);
    if (receiptStat.isSymbolicLink() || !receiptStat.isFile()) throw new Error("native_conformance_workspace_receipt_invalid");
    receipt = JSON.parse(await fs.readFile(receiptPath, "utf8")) as typeof receipt;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await materializeNativeChatTaskRoot(scope);
  if (!receipt) {
    if ((await fs.readdir(cwd)).length) throw new Error("native_conformance_workspace_unowned_existing_root");
    const stat = await fs.lstat(cwd), real = await fs.realpath(cwd);
    if (stat.isSymbolicLink() || !stat.isDirectory() || real !== cwd) throw new Error("native_conformance_workspace_initial_root_invalid");
    receipt = { schema: "paperclip.native-opencode-conformance-workspace/v1", ...input, taskRoot, workspaceId: randomUUID(), cwd, dev: stat.dev, ino: stat.ino };
    const handle = await fs.open(receiptPath, "wx", 0o600);
    try { await handle.writeFile(`${JSON.stringify(receipt)}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
    createdEmpty = true;
  }
  const stat = await fs.lstat(cwd), real = await fs.realpath(cwd);
  if (receipt.schema !== "paperclip.native-opencode-conformance-workspace/v1" || receipt.groupId !== input.groupId ||
      receipt.companyId !== input.companyId || receipt.agentId !== input.agentId || receipt.taskId !== input.taskId ||
      receipt.taskRoot !== taskRoot || receipt.cwd !== cwd || stat.isSymbolicLink() || !stat.isDirectory() ||
      stat.dev !== receipt.dev || stat.ino !== receipt.ino || real !== cwd)
    throw new Error("native_conformance_workspace_creation_receipt_changed");
  return { cwd, taskRoot, workspaceId: receipt.workspaceId, creationReceipt: nativeSha256(receipt), createdEmpty, ...input };
}

/** Obtain the run's current managed lease through the existing EnvironmentRun
 * owner. A normal heartbeat may already have acquired it; that exact live lease
 * is reused. This helper never inserts or edits lease rows directly. */
export async function acquireNativeOpenCodeProbeLease(input: {
  db: Db; companyId: string; agentId: string; taskId: string; planId: string; runId: string;
  qualificationGroupId: string; responsibleUserId: string; environmentRuntime: EnvironmentRuntimeService;
  workspaceRoot: ConformanceWorkspaceRoot;
}) {
  const { db } = input, now = new Date();
  const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, input.companyId),
    eq(heartbeatRuns.id, input.runId), eq(heartbeatRuns.agentId, input.agentId))).limit(1);
  const [task] = await db.select().from(issues).where(and(eq(issues.companyId, input.companyId), eq(issues.id, input.taskId))).limit(1);
  const [plan] = await db.select().from(orchestrationPlans).where(and(eq(orchestrationPlans.companyId, input.companyId),
    eq(orchestrationPlans.id, input.planId), eq(orchestrationPlans.issueId, input.taskId))).limit(1);
  if (!run || run.status !== "running" || run.triggerDetail !== "provider_conformance" || run.nativeIssueId !== input.taskId ||
      run.responsibleUserId !== input.responsibleUserId || task?.executionRunId !== run.id || task.hiddenAt === null ||
      task.harnessKind !== "provider_conformance" || task.assigneeAgentId !== input.agentId || plan?.status !== "paused" ||
      plan.actionClass !== "internal_draft" || plan.riskClass !== "C0" || plan.budgets.maxToolActions !== 0 ||
      plan.budgets.maxRetries !== 0 || run.contextSnapshot?.providerConformanceGroupId !== input.qualificationGroupId ||
      run.contextSnapshot?.providerConformancePlanId !== plan.id || run.contextSnapshot?.containsCompanyContext !== false ||
      run.contextSnapshot?.platformToolsGranted !== false)
    throw forbidden("The current Human-owned hidden Task, paused zero-tool plan, and provider-conformance Run are required");
  const workers = await db.select().from(orchestrationWorkers).where(eq(orchestrationWorkers.planId, plan.id));
  const attempts = await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.planId, plan.id));
  if (workers.length || attempts.length) throw forbidden("A conformance lease cannot inherit ordinary workers or attempts");
  const active = await db.select().from(environmentLeases).where(and(eq(environmentLeases.companyId, input.companyId),
    eq(environmentLeases.heartbeatRunId, run.id), eq(environmentLeases.status, "active")));
  if (active.length > 1) throw conflict("The provider-conformance Run has multiple active environment leases");
  async function realizeWorkspace(lease: typeof environmentLeases.$inferSelect, environment: Awaited<ReturnType<ReturnType<typeof environmentService>["getById"]>>, adapterType: string) {
    if (!environment || environment.driver !== "sandbox") throw forbidden("The conformance lease is not attached to its selected Sandbox environment");
    const environmentConfig = parseEnvironmentDriverConfig(environment);
    if (environmentConfig.driver !== "sandbox" || lease.environmentId !== environment.id || lease.provider !== environmentConfig.config.provider)
      throw forbidden("The conformance lease provider differs from its selected Sandbox environment");
    const metadata = lease.metadata && typeof lease.metadata === "object" ? lease.metadata as Record<string, unknown> : {};
    if (typeof metadata.remoteCwd === "string" && path.resolve(metadata.remoteCwd) !== input.workspaceRoot.cwd)
      throw forbidden("The retained Sandbox lease is bound to another qualification-group workspace");
    const pinnedLease = await environmentService(db).updateLeaseMetadata(lease.id, { ...metadata, remoteCwd: input.workspaceRoot.cwd });
    if (!pinnedLease) throw conflict("The conformance Sandbox lease could not pin its private workspace");
    const executionWorkspace: RealizedExecutionWorkspace = { baseCwd: input.workspaceRoot.cwd, cwd: input.workspaceRoot.cwd,
      source: "task_session", projectId: null, workspaceId: null, repoUrl: null, repoRef: null,
      strategy: "project_primary", branchName: null, worktreePath: null, warnings: [], created: false, branchCreatedByRuntime: false,
      additionalWorkspaces: [] };
    const realized = await environmentRunOrchestrator(db, { environmentRuntime: input.environmentRuntime }).realizeForRun({
      environment, lease: pinnedLease, adapterType, companyId: input.companyId, issueId: input.taskId,
      heartbeatRunId: input.runId, executionWorkspace, effectiveExecutionWorkspaceMode: null, persistedExecutionWorkspace: null,
    });
    const executionTarget = realized.executionTarget;
    if (executionTarget?.kind !== "remote" || executionTarget.transport !== "sandbox" || executionTarget.leaseId !== lease.id ||
        executionTarget.providerKey !== lease.provider ||
        path.resolve(executionTarget.remoteCwd) !== input.workspaceRoot.cwd || !executionTarget.runner)
      throw forbidden("EnvironmentRun did not realize the exact private group and presence workspace on its current Sandbox lease");
    return { lease: realized.lease, executionTarget };
  }
  if (active.length === 1) {
    if (active[0]!.releasedAt || !active[0]!.expiresAt || active[0]!.expiresAt <= now || !active[0]!.environmentId)
      throw forbidden("The current provider-conformance Sandbox lease is expired or has the wrong provider");
    const [agent] = await db.select().from(agents).where(and(eq(agents.companyId, input.companyId), eq(agents.id, input.agentId))).limit(1);
    const environment = await environmentService(db).getById(active[0]!.environmentId);
    if (!agent || !environment) throw forbidden("The retained conformance lease lost its selected Sandbox environment");
    return await realizeWorkspace(active[0]!, environment, agent.adapterType ?? "paperclip_runner");
  }
  const [agent] = await db.select().from(agents).where(and(eq(agents.companyId, input.companyId), eq(agents.id, input.agentId))).limit(1);
  if (!agent?.defaultEnvironmentId) throw conflict("The saved OpenCode presence has no selected managed Sandbox environment");
  const environments = environmentService(db), environment = await environments.getById(agent.defaultEnvironmentId);
  if (!environment || environment.driver !== "sandbox") throw conflict("OpenCode qualification requires the selected Remote Sandbox environment");
  const local = await environments.ensureLocalEnvironment(input.companyId);
  const acquired = await environmentRunOrchestrator(db).acquireForRun({ companyId: input.companyId,
    selectedEnvironmentId: environment.id, localEnvironmentId: local.id, adapterType: agent.adapterType ?? "paperclip_runner",
    adapterConfig: agent.adapterConfig, issueId: task.id, heartbeatRunId: run.id, agentId: agent.id,
    persistedExecutionWorkspace: null, executionWorkspaceSettings: null,
    requestedExpiresAt: new Date(Math.min(now.getTime() + plan.budgets.maxWallClockSeconds * 1000, now.getTime() + 5 * 60_000)) });
  if (acquired.environment.driver !== "sandbox" || acquired.lease.status !== "active" || !acquired.lease.expiresAt ||
      acquired.lease.expiresAt <= now) throw conflict("EnvironmentRun did not acquire a current Remote Sandbox lease");
  return await realizeWorkspace(acquired.lease, acquired.environment, agent.adapterType ?? "paperclip_runner");
}

/**
 * Managed OpenCode qualification is intentionally separate from the generic
 * local-provider test. This owner prepares only the canonical hidden Task and
 * paused C0 plan. Runtime execution, probe accounting and qualification must
 * come from the configured remote Sandbox/controller owners; missing owners
 * fail closed. It never converts a test receipt into ordinary model authority.
 */
export function nativeOpenCodeConformanceService(db: Db, options: Options) {
  return {
    async test(actor: AuthorizationActor, companyId: string, agentId: string,
      raw: z.infer<typeof providerConformanceInputSchema>) {
      const input = providerConformanceInputSchema.parse(raw), userId = v7HumanActorId(actor);
      if (actor.type !== "board" || actor.source === "local_implicit")
        throw forbidden("Managed OpenCode bootstrap requires the authenticated current Human");
      await assertV7Enabled(db, "orchestration_v7");
      for (const action of ["agents:configure", "agent:wake"] as const)
        await assertV7Authorization(db, actor, companyId, action, { type: "agent", companyId, agentId });

      const groupId = randomUUID(), bindings = agentProviderBindingService(db);
      async function selectTarget(cid: string, aid: string) {
        for (const action of ["agents:configure", "agent:wake"] as const)
          await assertV7Authorization(db, actor, cid, action, { type: "agent", companyId: cid, agentId: aid });
        const [agent] = await db.select().from(agents).where(and(eq(agents.companyId, cid), eq(agents.id, aid))).limit(1);
        if (!agent || agent.adapterType !== "paperclip_runner") throw conflict("The saved Native OpenCode presence is unavailable");
        const [identity] = await db.select().from(agentIdentities).where(eq(agentIdentities.id, agent.agentIdentityId)).limit(1);
        if (!identity || identity.status !== "active") throw forbidden("The logical identity must remain active during OpenCode qualification");
        const selected = resolvePaperclipRunnerProviderProfile(agent.adapterConfig);
        if (selected.provider !== "opencode" || !selected.model.startsWith("anthropic/")) throw forbidden("The exact saved OpenCode model route is required");
        const configurationHash = hashContextPolicySnapshot({ adapterType: agent.adapterType, adapterConfig: agent.adapterConfig });
        const profile = selectWorkerModelProfile(options.profiles, { companyId: cid, agentId: aid, configurationHash,
          sourceSha: options.sourceSha, protectedEvidenceOrigin: options.protectedEvidenceOrigin });
        if (profile.transport !== "server-anthropic-messages-v1" || selected.model !== `anthropic/${profile.tariff.model}`)
          throw forbidden("The selected OpenCode profile does not use the exact installed managed Messages route");
        const discovered = await providerDiscoveryService(db).discover(actor, cid, aid);
        if (discovered.capabilitySnapshotHash !== profile.providerSnapshotHash) throw conflict("The saved OpenCode capability snapshot changed");
        const binding = await bindings.getForPresence(actor, cid, aid);
        if (!binding || binding.provider.providerType !== "paperclip_native" || binding.provider.id !== profile.providerBindingId ||
            binding.runtime.providerProfileRef !== profile.providerProfileRef || ["revoked", "retired"].includes(binding.provider.status) ||
            binding.runtime.status === "revoked" || binding.provider.capabilitySnapshotHash !== profile.providerSnapshotHash)
          throw forbidden("Bootstrap requires the current Native OpenCode binding");
        const currentBinding = await bindings.getForPresence(actor, cid, aid);
        if (!currentBinding || currentBinding.provider.providerType !== "paperclip_native" ||
            currentBinding.provider.id !== profile.providerBindingId || currentBinding.runtime.providerProfileRef !== profile.providerProfileRef ||
            ["revoked", "retired"].includes(currentBinding.provider.status) || currentBinding.runtime.status === "revoked" ||
            currentBinding.provider.capabilitySnapshotHash !== profile.providerSnapshotHash)
          throw conflict("The current Native OpenCode provider profile changed during qualification admission");
        const grant = await aiConnectionService(db).select({ companyId: cid, userId, agentId: aid,
          adapterType: "claude_local", binding: profile.binding, model: profile.tariff.model });
        if (grant.attribution.method !== "api_key" || grant.grant.status !== "active") throw forbidden("An active Human-approved encrypted provider grant is required");
        return { agent, identity, selected, configurationHash, profile, binding: currentBinding, grant, discovered };
      }
      const primary = await selectTarget(companyId, agentId);
      if (!input.isolationPeer) throw conflict("Managed OpenCode requires an explicit second presence for isolation proof");
      const peer = await selectTarget(input.isolationPeer.companyId, input.isolationPeer.agentId);
      if (peer.agent.id === primary.agent.id || peer.agent.agentIdentityId !== primary.agent.agentIdentityId ||
          peer.profile.providerProfileRef === primary.profile.providerProfileRef ||
          peer.binding.provider.providerEndpointRef !== primary.binding.provider.providerEndpointRef)
        throw conflict("Isolation requires a second Native presence of the same identity and provider endpoint");

      const quote = (target: typeof primary) => quoteModelReservation({ tariff: target.profile.tariff, sourceSha: options.sourceSha,
        inputTokensUpperBound: target.profile.inputTokensUpperBound, maxOutputTokens: target.profile.maxOutputTokens });
      const primaryQuote = quote(primary), peerQuote = quote(peer), totalCeiling = primaryQuote.maximumMinor * 4 + peerQuote.maximumMinor * 2;
      if (totalCeiling > input.maximumCostCents) throw forbidden("The requested cost ceiling cannot cover all six bounded OpenCode probes");
      async function prepare(target: typeof primary, maximumMinor: number) {
        const { cid, aid } = { cid: target.agent.companyId, aid: target.agent.id };
        const harness = await withV7ActivityTransaction(db, async (tx, publications) => {
          const [current] = await tx.select({ agent: agents, identity: agentIdentities }).from(agents)
            .innerJoin(agentIdentities, eq(agentIdentities.id, agents.agentIdentityId))
            .where(and(eq(agents.companyId, cid), eq(agents.id, aid))).for("update");
          if (!current || current.agent.adapterType !== "paperclip_runner" || current.identity.status !== "active" ||
              hashContextPolicySnapshot({ adapterType: current.agent.adapterType, adapterConfig: current.agent.adapterConfig }) !== target.configurationHash ||
              !["idle", "error"].includes(current.agent.status)) throw conflict("The current idle OpenCode Agent or identity changed");
          const [task] = await tx.insert(issues).values({ companyId: cid, title: "Synthetic managed OpenCode qualification",
            description: "Operator-created probe only. No customer source, company context, or platform tools are admitted.",
            status: "in_progress", assigneeAgentId: aid, hiddenAt: new Date(), harnessKind: "provider_conformance", responsibleUserId: userId }).returning();
          const contract = await writeOrchestrationContract(tx, cid, task!.id, orchestrationCompletionSchema.parse({
            objective: "Retain actual managed OpenCode conformance evidence", requiredOutputs: [{ key: "probe-evidence" }],
            businessInvariants: ["Qualification grants no ordinary execution authority"] }), userId);
          const [plan] = await tx.insert(orchestrationPlans).values({ companyId: cid, issueId: task!.id, completionContractId: contract.id,
            mode: "single_worker", actionClass: "internal_draft", riskClass: "C0", supervisionMode: "none",
            verificationMode: "deterministic", humanOversightMode: "human_review", status: "paused", startedAt: new Date(),
            createdBy: userId, executionPrincipal: { type: "user", userId }, budgets: orchestrationBudgetSchema.parse({
              maxModelCostMinor: maximumMinor, maxToolActions: 0, maxWallClockSeconds: 300, maxRetries: 0, maxDelegationDepth: 0 }) }).returning();
          await logActivity(tx, { companyId: cid, actorType: "user", actorId: userId,
            action: "provider.opencode_conformance_harness_created", entityType: "orchestration_plan", entityId: plan!.id,
            details: { qualificationGroupId: groupId, agentId: aid, maximumMinor, toolsGranted: false } }, publications);
          return { task: task!, plan: plan!, contract };
        });
        const workspaceRoot = await createOrReadConformanceWorkspaceRoot({ groupId, companyId: cid, agentId: aid, taskId: harness.task.id });
        return { ...harness, workspaceRoot };
      }
      const primaryHarness = await prepare(primary, primaryQuote.maximumMinor * 4), peerHarness = await prepare(peer, peerQuote.maximumMinor * 2);
      const marker = `AW_PROBE_${randomUUID().replaceAll("-", "")}`;
      const requiredChecks = providerConformanceRequirements(primary.discovered.capabilitySnapshot!, primary.binding.provider.isolationMode);
      const snapshots = new Map<string, PersistedNativeSession>();
      const probeHistory = new Map<string, Array<{ role: "user" | "assistant"; text: string }>>();
      const ledgerIds: string[] = [], runs: string[] = [];
      let coordinatorOwnershipUnverified = false;
      async function openNativeOpenCodeRemoteProbe(input: {
        actor: AuthorizationActor; companyId: string; agentId: string; taskId: string; planId: string;
        qualificationGroupId: string; profileId: string; probeId: string;
        probeKind: NativeOpenCodeConformanceSourceAuthority["probeKind"]; marker: string;
        sessionId: string; prompt: string; previous?: PersistedNativeSession;
        target: typeof primary; harness: typeof primaryHarness; options: Options; userId: string;
      }): Promise<NativeOpenCodeRemoteProbeContext> {
        const retainedWorkspaceRoot = await createOrReadConformanceWorkspaceRoot({ groupId: input.qualificationGroupId,
          companyId: input.companyId, agentId: input.agentId, taskId: input.taskId });
        const preparedWorkspaceRoot = input.harness.workspaceRoot;
        if (retainedWorkspaceRoot.groupId !== preparedWorkspaceRoot.groupId ||
            retainedWorkspaceRoot.companyId !== preparedWorkspaceRoot.companyId ||
            retainedWorkspaceRoot.agentId !== preparedWorkspaceRoot.agentId || retainedWorkspaceRoot.taskId !== preparedWorkspaceRoot.taskId ||
            retainedWorkspaceRoot.taskRoot !== preparedWorkspaceRoot.taskRoot || retainedWorkspaceRoot.cwd !== preparedWorkspaceRoot.cwd ||
            retainedWorkspaceRoot.workspaceId !== preparedWorkspaceRoot.workspaceId ||
            retainedWorkspaceRoot.creationReceipt !== preparedWorkspaceRoot.creationReceipt)
          throw forbidden("The retained server-created conformance workspace root changed between probe Runs");
        // The receipt's createdEmpty bit records its one-time group-root
        // creation. Consume that fact only for this presence's first actual
        // probe; subsequent Runs must adopt the same retained receipt.
        const createdEmptyForRun = preparedWorkspaceRoot.createdEmpty && input.previous === undefined;
        const now = new Date(), runId = randomUUID(), runnerInstanceId =
          /^[0-9a-f-]{36}$/i.test(input.options.runnerInstanceId) ? input.options.runnerInstanceId : randomUUID();
        const contextSnapshot = { providerConformanceGroupId: input.qualificationGroupId,
          providerConformancePlanId: input.planId, nativeOpenCodeConformanceProbeId: input.probeId,
          nativeOpenCodeConformanceProfileId: input.profileId,
          containsCompanyContext: false, platformToolsGranted: false };
        await db.transaction(async tx => {
          const [agent] = await tx.select().from(agents).where(and(eq(agents.companyId, input.companyId), eq(agents.id, input.agentId))).for("update").limit(1);
          if (!agent || !["idle", "error"].includes(agent.status) || agent.adapterType !== "paperclip_runner" ||
              hashContextPolicySnapshot({ adapterType: agent.adapterType, adapterConfig: agent.adapterConfig }) !== input.target.configurationHash)
            throw conflict("The exact idle saved Native OpenCode presence is required for a probe Run");
          const [taskBeforeRun] = await tx.select().from(issues).where(and(eq(issues.companyId, input.companyId),
            eq(issues.id, input.taskId), eq(issues.harnessKind, "provider_conformance"),
            eq(issues.assigneeAgentId, input.agentId), eq(issues.status, "in_progress"))).for("update").limit(1);
          if (!taskBeforeRun?.hiddenAt || taskBeforeRun.conversationAgentId !== null || taskBeforeRun.conversationUserId !== null ||
              taskBeforeRun.projectId !== null || taskBeforeRun.parentId !== null)
            throw conflict("The hidden zero-context conformance Task changed before its probe Run");
          if (taskBeforeRun.executionRunId) {
            const [previousRun] = await tx.select({ status: heartbeatRuns.status }).from(heartbeatRuns).where(and(
              eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, taskBeforeRun.executionRunId),
              eq(heartbeatRuns.agentId, input.agentId), eq(heartbeatRuns.nativeIssueId, input.taskId))).for("share").limit(1);
            if (!previousRun || ["queued", "running"].includes(previousRun.status))
              throw conflict("The prior conformance Run must settle before this presence receives another probe");
          }
          const active = await tx.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(
            eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.agentId, input.agentId),
            inArray(heartbeatRuns.status, ["queued", "running"]))).limit(1);
          if (active.length) throw conflict("An existing run owns this Native presence");
          await tx.insert(heartbeatRuns).values({ id: runId, companyId: input.companyId, agentId: input.agentId,
            scopeKind: "issue", issueId: input.taskId, nativeIssueId: input.taskId, responsibleUserId: input.userId,
            invocationSource: "on_demand", triggerDetail: "provider_conformance", status: "running", startedAt: now,
            runtimeMode: "native", runtimeModeResolverVersion: "native-opencode-conformance-v1",
            runtimeModeReason: "server_owned_provider_conformance_bootstrap", runtimeModeResolvedAt: now,
            runnerInstanceId, nativeSessionId: input.sessionId, driverKind: "opencode_server", driverVersion: "paperclip-runner",
            completionContractId: input.harness.contract.id, completionContractSha256: input.harness.contract.canonicalSha256,
            nativePhase: "observed", nativePhaseUpdatedAt: now, contextSnapshot });
          await tx.insert(nativeRunFinalizations).values({ runId, companyId: input.companyId, issueId: input.taskId, phase: "observed" });
          const [task] = await tx.update(issues).set({ executionRunId: runId, status: "in_progress" }).where(and(
            eq(issues.companyId, input.companyId), eq(issues.id, input.taskId), eq(issues.harnessKind, "provider_conformance"),
            eq(issues.assigneeAgentId, input.agentId), taskBeforeRun.executionRunId
              ? eq(issues.executionRunId, taskBeforeRun.executionRunId) : isNull(issues.executionRunId),
            eq(issues.status, "in_progress"))).returning({ id: issues.id });
          if (!task) throw conflict("The hidden conformance Task changed before its probe Run was bound");
          await tx.update(agents).set({ status: "running", updatedAt: now }).where(eq(agents.id, input.agentId));
        });
        runs.push(runId);

        let settled = false;
        const ownerActor: AuthorizationActor = { type: "agent", source: "none", companyId: input.companyId,
          agentId: input.agentId, runId, onBehalfOfUserId: input.userId };
        try {
          const emptyContext = await contextManifestService(db).create({ companyId: input.companyId, agentId: input.agentId,
            runId, issueId: input.taskId, responsibleUserId: input.userId, authorizationActor: ownerActor,
            query: "Server-owned empty Native OpenCode conformance context",
            policySnapshot: { intent: "native_opencode_provider_conformance", containsCompanyContext: false, grantsAuthority: false }, selected: [] });
          const acquired = await acquireNativeOpenCodeProbeLease({ db, companyId: input.companyId, agentId: input.agentId,
            taskId: input.taskId, planId: input.planId, runId, qualificationGroupId: input.qualificationGroupId,
            responsibleUserId: input.userId, environmentRuntime: input.options.environmentRuntime,
            workspaceRoot: input.harness.workspaceRoot });
          if (acquired.executionTarget.kind !== "remote" || acquired.executionTarget.transport !== "sandbox" ||
              acquired.executionTarget.leaseId !== acquired.lease.id || !acquired.executionTarget.remoteCwd)
            throw forbidden("The actual Remote Sandbox lease and runner target are required");
          const contractJson = input.harness.contract.contractJson as Record<string, unknown>;
          const criteria = Array.isArray(contractJson.criteria) ? contractJson.criteria as Array<{ id: string; requirement: string }> : null;
          if (!criteria || !contractJson.objective) throw forbidden("The persisted conformance completion contract is malformed");
          const execution = parseNativeExecutionInput({ schema: "paperclip.native-execution-input.v2",
            binding: { companyId: input.companyId, runId, issueId: input.taskId, agentId: input.agentId, executionWorkspaceId: input.harness.workspaceRoot.workspaceId },
            task: { identifier: input.taskId, title: input.harness.task.title, description: input.harness.task.description,
              prompt: "Server-controlled synthetic provider conformance. No company context or platform tools are provided.", workMode: "standard" },
            workspace: { cwd: acquired.executionTarget.remoteCwd, repoUrl: null, repoRef: null, branchName: null },
            session: { normalizedSessionId: input.sessionId, driverKind: "opencode_server", protocolVersion: 1,
              lifecyclePolicy: { mode: "per_turn", idleTimeoutMs: null } },
            provider: { kind: "opencode", model: `anthropic/${input.target.profile.tariff.model}` },
            completionContract: { id: input.harness.contract.id, sha256: input.harness.contract.canonicalSha256,
              schemaVersion: input.harness.contract.schemaVersion,
              contract: { revision: String(input.harness.contract.revision), objective: String(contractJson.objective), criteria } },
            interactionResponses: [], credentialBindings: [], executionMode: "default", planningContext: null });
          const manifestValue = agentExecutionManifestSchema.parse({ schemaVersion: 5, runId, companyId: input.companyId,
            agentId: input.agentId, agentIdentityId: input.target.agent.agentIdentityId,
            homeCompanyId: input.target.identity.homeCompanyId, responsibleUserId: input.userId,
            executionScope: { primaryCompanyId: input.companyId, primaryAgentPresenceId: input.agentId, delegatedScopes: [] },
            rolePack: null, contextManifests: [{ companyId: input.companyId, contextManifestId: emptyContext.manifest.id }],
            skills: [], playbooks: [], capabilities: [], providers: [{ companyId: input.companyId, agentId: input.agentId,
              providerBindingId: input.target.binding.provider.id, profileRef: input.target.binding.runtime.providerProfileRef,
              snapshotHash: input.target.binding.provider.capabilitySnapshotHash, isolationMode: input.target.binding.provider.isolationMode }],
            executionPolicy: { deterministicPreference: true, policies: [], approvalRefs: [],
              restrictions: ["Synthetic conformance only", "No company context", "No tools or delegated scope"],
              policySnapshotHash: hashContextPolicySnapshot({ runId, groupId: input.qualificationGroupId, noTools: true }) },
            inventoryEstimatedTokens: 0, warnings: [] });
          const manifestHash = hashContextPolicySnapshot(manifestValue), manifestPolicyHash = manifestValue.executionPolicy.policySnapshotHash;
          await db.transaction(async tx => {
            const [currentRun] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, input.companyId),
              eq(heartbeatRuns.id, runId), eq(heartbeatRuns.status, "running"))).for("update").limit(1);
            if (!currentRun || currentRun.responsibleUserId !== input.userId || currentRun.nativeIssueId !== input.taskId ||
                currentRun.contextSnapshot?.providerConformanceGroupId !== input.qualificationGroupId ||
                currentRun.contextSnapshot?.providerConformancePlanId !== input.planId)
              throw forbidden("The newly initialized conformance Run changed before manifest sealing");
            const [manifest] = await tx.insert(agentExecutionManifests).values({ companyId: input.companyId, runId,
              agentId: input.agentId, agentIdentityId: input.target.agent.agentIdentityId,
              contextManifestId: emptyContext.manifest.id, manifest: manifestValue,
              policySnapshotHash: manifestPolicyHash, hash: manifestHash }).returning();
            await tx.insert(agentExecutionAuthorizations).values({ companyId: input.companyId, manifestId: manifest!.id,
              contextManifestRefs: [{ companyId: input.companyId, contextManifestId: emptyContext.manifest.id }], authorityHash: manifestPolicyHash });
            await tx.update(heartbeatRuns).set({ runnerProfileJson: { nativeExecutionInput: execution,
              nativeOpenCodeConformanceWorkspace: { schema: "paperclip.native-opencode-conformance-workspace/v1",
                groupId: input.qualificationGroupId, companyId: input.companyId, agentId: input.agentId,
                workspaceId: input.harness.workspaceRoot.workspaceId, taskId: input.harness.workspaceRoot.taskId,
                taskRoot: input.harness.workspaceRoot.taskRoot, localCwd: input.harness.workspaceRoot.cwd,
                remoteCwd: acquired.executionTarget.remoteCwd, creationReceipt: input.harness.workspaceRoot.creationReceipt,
                createdEmpty: createdEmptyForRun, leaseId: acquired.lease.id,
                providerLeaseId: acquired.executionTarget.sandboxLeaseAcquisition?.providerLeaseId ?? acquired.lease.providerLeaseId,
                authorityHash: null } }, updatedAt: new Date() })
              .where(and(eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, runId), eq(heartbeatRuns.status, "running")));
          });
          async function sealWorkspaceAuthorityHash() {
            await db.transaction(async tx => {
              const current = await executionSandboxService(tx).assertTaskExecutionContext(tx, { companyId: input.companyId,
                runId, leaseId: acquired.lease.id });
              if (!current) throw forbidden("The current Sandbox authority is required for the conformance workspace");
              const [row] = await tx.select({ runnerProfileJson: heartbeatRuns.runnerProfileJson }).from(heartbeatRuns)
                .where(and(eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, runId), eq(heartbeatRuns.status, "running")))
                .for("update").limit(1);
              const profile = row?.runnerProfileJson && typeof row.runnerProfileJson === "object" ? row.runnerProfileJson as Record<string, unknown> : {};
              const proof = profile.nativeOpenCodeConformanceWorkspace && typeof profile.nativeOpenCodeConformanceWorkspace === "object"
                ? profile.nativeOpenCodeConformanceWorkspace as Record<string, unknown> : {};
              if (!row || proof.groupId !== input.qualificationGroupId || proof.workspaceId !== input.harness.workspaceRoot.workspaceId ||
                  proof.leaseId !== acquired.lease.id)
                throw forbidden("The current conformance workspace owner changed while sealing Sandbox authority");
              await tx.update(heartbeatRuns).set({ runnerProfileJson: { ...profile,
                nativeOpenCodeConformanceWorkspace: { ...proof, authorityHash: current.authorityHash } }, updatedAt: new Date() })
                .where(and(eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, runId), eq(heartbeatRuns.status, "running")));
            });
          }
          if (!input.options.prepareSandboxRun)
            throw forbidden("The production Sandbox admission owner is unavailable for this conformance Run");
          const [sealedManifest] = await db.select({ id: agentExecutionManifests.id, hash: agentExecutionManifests.hash })
            .from(agentExecutionManifests).where(and(eq(agentExecutionManifests.companyId, input.companyId),
              eq(agentExecutionManifests.runId, runId))).limit(1);
          if (!sealedManifest || sealedManifest.hash !== manifestHash)
            throw forbidden("The current hidden conformance manifest changed before Sandbox admission");
          await input.options.prepareSandboxRun(actor, { companyId: input.companyId, runId,
            taskId: input.taskId, planId: input.planId, groupId: input.qualificationGroupId,
            manifestId: sealedManifest.id, manifestHash, leaseId: acquired.lease.id,
            workspaceRoot: input.harness.workspaceRoot.taskRoot,
            creationReceipt: input.harness.workspaceRoot.creationReceipt });
          await sealWorkspaceAuthorityHash();
          const workspaceSync = await prepareNativeWorkspaceSync({ db, runId, companyId: input.companyId,
            workspaceId: input.harness.workspaceRoot.workspaceId, workspaceLocalDir: input.harness.workspaceRoot.cwd,
            target: acquired.executionTarget, lease: acquired.lease, resourceDisposition: "stop_and_retain",
            workspaceRepositoryMode: "server_verified_none", nativeWorkspacePreparation: true, requireCleanRemoteAdoption: true });
          if (!workspaceSync?.reference || !await assertNativeWorkspaceSyncServerVerifiedNone({ runId, reference: workspaceSync.reference,
            companyId: input.companyId, workspaceId: input.harness.workspaceRoot.workspaceId,
            leaseId: acquired.lease.id, providerLeaseId: acquired.executionTarget.sandboxLeaseAcquisition?.providerLeaseId ?? acquired.lease.providerLeaseId ?? "",
            localCwd: input.harness.workspaceRoot.cwd, remoteCwd: acquired.executionTarget.remoteCwd,
            requireEmptyBaseline: createdEmptyForRun }))
            throw forbidden("The exact server-owned conformance workspace receipt is required");
          await db.transaction(async tx => {
            const [currentRun] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, input.companyId),
              eq(heartbeatRuns.id, runId), eq(heartbeatRuns.status, "running"))).for("update").limit(1);
            const profile = currentRun?.runnerProfileJson && typeof currentRun.runnerProfileJson === "object"
              ? currentRun.runnerProfileJson as Record<string, unknown> : {};
            const proof = profile.nativeOpenCodeConformanceWorkspace && typeof profile.nativeOpenCodeConformanceWorkspace === "object"
              ? profile.nativeOpenCodeConformanceWorkspace as Record<string, unknown> : {};
            if (!currentRun || proof.groupId !== input.qualificationGroupId || proof.workspaceId !== input.harness.workspaceRoot.workspaceId ||
                proof.authorityHash !== (await executionSandboxService(tx).assertTaskExecutionContext(tx, { companyId: input.companyId,
                  runId, leaseId: acquired.lease.id }))?.authorityHash)
              throw forbidden("Current Sandbox authority changed while sealing the private conformance workspace");
            await tx.update(heartbeatRuns).set({ runnerProfileJson: { ...profile,
              nativeOpenCodeConformanceWorkspace: { ...proof, descriptorSha256: workspaceSync!.reference.descriptorSha256,
                baselineSha256: workspaceSync!.reference.baselineSha256, workspaceRepositoryMode: "server_verified_none", authorityHash: null } }, updatedAt: new Date() })
              .where(and(eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, runId), eq(heartbeatRuns.status, "running")));
          });
          await sealWorkspaceAuthorityHash();
          const remoteTarget = { kind: "remote" as const, transport: "sandbox" as const, leaseId: acquired.lease.id,
            remoteCwd: acquired.executionTarget.remoteCwd };
          const runnerEnvironment = { PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN: input.options.modelBrokerOrigin,
            ANTHROPIC_API_KEY: "paperclip-managed-model-broker",
            PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND: String(input.target.profile.inputTokensUpperBound),
            PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS: String(input.target.profile.maxOutputTokens) };
          return { execution, runnerInstanceId, identity: { runId, sessionId: input.sessionId,
              companyId: input.companyId, issueId: input.taskId, agentId: input.agentId },
            workingDirectory: acquired.executionTarget.remoteCwd, leaseId: acquired.lease.id, workspaceSync, remoteTarget,
            createBackend: async () => (await createNativeOpenCodeConformanceProbeBackend({ db, execution,
              runnerInstanceId, runnerExecutionTarget: acquired.executionTarget,
              durableEnvironmentLeaseId: acquired.lease.id, runnerEnvironment,
              runnerRemoteProviderPackPath: process.env.PAPERCLIP_RUNNER_REMOTE_PROVIDER_PACK_PATH?.trim() })).backend,
            settle: async (state: ManagedOpenCodeProbeResult["state"] = "unknown") => {
              if (settled) return;
              await workspaceSync.restoreWorkspace();
              const release = await environmentRunOrchestrator(db, { environmentRuntime: input.options.environmentRuntime }).releaseForRun({
                heartbeatRunId: runId, companyId: input.companyId, agentId: input.agentId,
                status: state === "cancelled" ? "expired" : state === "failed" || state === "unknown" ? "failed" : "released",
                cancelActiveWork: state !== "completed", providerResourceDisposition: "stop_and_retain" });
              if (release.errors.length) throw new Error("native_opencode_conformance_environment_release_failed");
              settled = true;
            } };
        } catch (error) {
          const terminalized = await failUnclaimedNativeOpenCodeConformanceRun({ db, companyId: input.companyId,
            issueId: input.taskId, runId, agentId: input.agentId,
            qualificationGroupId: input.qualificationGroupId, planId: input.planId, profileId: input.profileId,
            probeId: input.probeId, restoreAgentStatus: input.target.agent.status, bootstrapFailure: true });
          if (!terminalized) coordinatorOwnershipUnverified = true;
          if (terminalized) {
            await environmentRunOrchestrator(db, { environmentRuntime: input.options.environmentRuntime }).releaseForRun({
              heartbeatRunId: runId, companyId: input.companyId, agentId: input.agentId,
              status: "failed", cancelActiveWork: true, providerResourceDisposition: "stop_and_retain" }).catch(() => undefined);
          }
          throw error;
        }
      }
      async function probe(target: typeof primary, harness: typeof primaryHarness,
        probeKind: NativeOpenCodeConformanceSourceAuthority["probeKind"], probeMarker: string, expectedOutput?: string, cancel = false) {
        const targetQuote = quote(target);
        const oldReservations = await db.select({ id: orchestrationModelReservations.id }).from(orchestrationModelReservations)
          .where(eq(orchestrationModelReservations.planId, harness.plan.id));
        const sessionId = snapshots.get(target.agent.id)?.identity.sessionId ?? randomUUID();
        const probeId = randomUUID();
        const prompt = nativeOpenCodeConformancePrompt(probeKind, probeMarker);
        const historyPrefix = [...(probeHistory.get(target.agent.id) ?? [])];
        const remote = await openNativeOpenCodeRemoteProbe({ actor, companyId: target.agent.companyId, agentId: target.agent.id,
          taskId: harness.task.id, planId: harness.plan.id, qualificationGroupId: groupId, profileId: target.profile.id, probeId, probeKind, marker: probeMarker,
          sessionId, prompt, previous: snapshots.get(target.agent.id), target, harness, options, userId });
        let settled = false, maySettleLease = true;
        let releaseCoordinator: ((terminal: Parameters<typeof releaseNativeOpenCodeConformanceCoordinator>[0]["terminal"]) => Promise<void>) | null = null;
        try {
        if (remote.remoteTarget.kind !== "remote" || remote.remoteTarget.transport !== "sandbox" ||
            !remote.remoteTarget.remoteCwd || remote.workingDirectory !== remote.remoteTarget.remoteCwd ||
            remote.identity.companyId !== target.agent.companyId || remote.identity.agentId !== target.agent.id ||
            remote.identity.issueId !== harness.task.id || remote.identity.sessionId !== sessionId)
          throw forbidden("The exact managed Remote Sandbox probe target is required");
        const canonicalLease = await acquireNativeOpenCodeProbeLease({ db, companyId: target.agent.companyId,
          agentId: target.agent.id, taskId: harness.task.id, planId: harness.plan.id, runId: remote.identity.runId,
          qualificationGroupId: groupId, responsibleUserId: userId, environmentRuntime: options.environmentRuntime,
          workspaceRoot: harness.workspaceRoot });
        if (canonicalLease.lease.id !== remote.leaseId || canonicalLease.executionTarget.kind !== remote.remoteTarget.kind ||
            canonicalLease.executionTarget.leaseId !== remote.remoteTarget.leaseId ||
            (canonicalLease.executionTarget.kind === "remote" && remote.remoteTarget.kind === "remote" &&
              canonicalLease.executionTarget.remoteCwd !== remote.remoteTarget.remoteCwd))
          throw forbidden("The session controller did not use the canonical EnvironmentRun lease");
        const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, target.agent.companyId),
          eq(heartbeatRuns.id, remote.identity.runId), eq(heartbeatRuns.agentId, target.agent.id))).limit(1);
        const [task] = await db.select().from(issues).where(and(eq(issues.companyId, target.agent.companyId), eq(issues.id, harness.task.id))).limit(1);
        const [plan] = await db.select().from(orchestrationPlans).where(and(eq(orchestrationPlans.companyId, target.agent.companyId),
          eq(orchestrationPlans.id, harness.plan.id), eq(orchestrationPlans.issueId, harness.task.id))).limit(1);
        const [lease] = await db.select().from(environmentLeases).where(and(eq(environmentLeases.companyId, target.agent.companyId),
          eq(environmentLeases.id, remote.leaseId), eq(environmentLeases.heartbeatRunId, remote.identity.runId), eq(environmentLeases.status, "active"))).limit(1);
        if (!run || run.status !== "running" || run.triggerDetail !== "provider_conformance" || run.nativeIssueId !== task?.id ||
            run.responsibleUserId !== userId || task?.hiddenAt === null || task?.harnessKind !== "provider_conformance" ||
            task?.executionRunId !== run.id || plan?.status !== "paused" || plan.actionClass !== "internal_draft" || plan.riskClass !== "C0" ||
            plan.budgets.maxToolActions !== 0 || plan.budgets.maxRetries !== 0 ||
            run.contextSnapshot?.providerConformanceGroupId !== groupId || run.contextSnapshot?.providerConformancePlanId !== plan.id ||
            run.contextSnapshot?.containsCompanyContext !== false || run.contextSnapshot?.platformToolsGranted !== false ||
            !lease?.expiresAt || lease.expiresAt <= new Date())
          throw forbidden("The exact current Human-owned hidden probe Run, paused C0 plan, and active EnvironmentRun lease are required");
        const workers = await db.select().from(orchestrationWorkers).where(eq(orchestrationWorkers.planId, plan.id));
        const attempts = await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.planId, plan.id));
        if (workers.length || attempts.length) throw forbidden("Conformance cannot inherit ordinary workers or attempts");
        const preflightAuthority = await executionSandboxService(db).assertTaskExecutionContext(db, {
          companyId: target.agent.companyId, runId: run.id, leaseId: lease!.id,
        });
        if (!preflightAuthority) throw forbidden("Current Sandbox Host and lease authority are required before Native session start");
        const result = await runManagedOpenCodeProbe({ db, createBackend: remote.createBackend, execution: remote.execution,
          runnerInstanceId: remote.runnerInstanceId, responsibleUserId: userId, groupId, planId: harness.plan.id, profileId: target.profile.id,
          probe: { identity: remote.identity,
          workingDirectory: remote.workingDirectory, prompt, expectedOutput, previous: snapshots.get(target.agent.id),
          signal: AbortSignal.timeout(Math.max(1, Math.min(harness.plan.budgets.maxWallClockSeconds * 1000,
            lease!.expiresAt!.getTime() - Date.now(), preflightAuthority.deadlineAt.getTime() - Date.now()))),
          resolveSource: async () => {
            const [startedRun] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, target.agent.companyId),
              eq(heartbeatRuns.id, remote.identity.runId), eq(heartbeatRuns.agentId, target.agent.id))).limit(1);
            const rawTuple = startedRun?.contextSnapshot?.nativeOpenCodeConformanceDispatch;
            const tuple = rawTuple && typeof rawTuple === "object" && !Array.isArray(rawTuple)
              ? rawTuple as Record<string, unknown> : null;
            if (!startedRun || startedRun.status !== "running" || startedRun.triggerDetail !== "provider_conformance" ||
                startedRun.responsibleUserId !== userId || startedRun.nativeIssueId !== harness.task.id ||
                startedRun.nativeSessionId !== sessionId || !tuple || tuple.qualificationGroupId !== groupId ||
                tuple.planId !== harness.plan.id || tuple.profileId !== target.profile.id || tuple.probeId !== probeId ||
                typeof tuple.dispatchNonce !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tuple.dispatchNonce) ||
                typeof tuple.authorityHash !== "string" || !/^[a-f0-9]{64}$/.test(tuple.authorityHash) ||
                Object.keys(tuple).sort().join(",") !== ["authorityHash", "dispatchNonce", "planId", "probeId", "profileId", "qualificationGroupId"].sort().join(","))
              throw forbidden("The RuntimeControl issuer did not persist this exact one-probe dispatch tuple after session start");
            const currentAdmission = await validateNativeOpenCodeConformanceHarness({ db, options, actor, companyId: target.agent.companyId,
              agentId: target.agent.id, claim: { qualificationGroupId: groupId, probeId, probeRunId: startedRun.id,
                planId: harness.plan.id, profileId: target.profile.id, dispatchNonce: tuple.dispatchNonce,
                authorityHash: tuple.authorityHash } });
            if (currentAdmission.authorityHash !== tuple.authorityHash)
              throw forbidden("Current Host, model, grant, lease, or conformance authority changed after Native session start");
            return { qualificationGroupId: groupId, probeId, dispatchNonce: tuple.dispatchNonce,
              planId: harness.plan.id, profileId: target.profile.id, probeKind, marker: probeMarker, historyPrefix };
          },
          ...(cancel ? { cancelAfterMs: 500 } : {}) } });
        releaseCoordinator = result.releaseCoordinator;
        if (!result.coordinatorClaimed) {
          const terminalized = await failUnclaimedNativeOpenCodeConformanceRun({ db, companyId: target.agent.companyId,
            issueId: harness.task.id, runId: remote.identity.runId, agentId: target.agent.id,
            qualificationGroupId: groupId, planId: harness.plan.id, profileId: target.profile.id, probeId,
            restoreAgentStatus: target.agent.status });
          if (!terminalized) {
            // A different coordinator/result owns this Run; leave its lease to that owner or recovery.
            maySettleLease = false;
            coordinatorOwnershipUnverified = true;
            throw forbidden("The unclaimed conformance Run is owned by another Native finalization path");
          }
        }
        await remote.settle(result.state);
        const terminal = { status: result.state === "completed" ? "succeeded" as const : result.state === "cancelled" ? "cancelled" as const : "failed" as const,
          errorCode: result.state === "completed" ? null : result.state === "cancelled" ? "provider_conformance_cancelled" : "provider_conformance_unsettled",
          error: result.state === "completed" ? null : "The actual Native OpenCode probe did not complete cleanly.",
          resultJson: { nativeOpenCodeConformanceProbe: true, observedState: result.state } };
        await releaseCoordinator(terminal);
        await db.update(agents).set({ status: target.agent.status, updatedAt: new Date() })
          .where(and(eq(agents.companyId, target.agent.companyId), eq(agents.id, target.agent.id), eq(agents.status, "running")));
        settled = true;
        if (result.state === "completed" && result.snapshot) snapshots.set(target.agent.id, result.snapshot);
        probeHistory.set(target.agent.id, [...historyPrefix, { role: "user", text: prompt },
          ...(result.state === "completed" ? [{ role: "assistant" as const, text: result.output }] : [])]);
        const after = await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, plan.id));
        const newRows = after.filter(row => !oldReservations.some(old => old.id === row.id));
        const reservation = newRows[0];
        const wire = reservation?.providerWireReceipt;
        if (newRows.length !== 1 || reservation!.purpose !== "provider_conformance" ||
            reservation!.maximumMinor !== targetQuote.maximumMinor || !wire || wire.version !== 1 ||
            wire.reservationId !== reservation!.id || wire.endpoint !== "https://api.anthropic.com/v1/messages" ||
            wire.method !== "POST" || wire.requestHash !== reservation!.requestHash || !/^[a-f0-9]{64}$/.test(wire.bodySha256) ||
            !(reservation!.status === "completed" && reservation!.providerResponseHash && reservation!.usage ||
              cancel && reservation!.status === "unknown" && reservation!.maximumMinor === targetQuote.maximumMinor))
          throw forbidden("The actual one-probe managed model wire receipt and reservation are required");
        ledgerIds.push(reservation!.id);
        const [finalRun] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run.id)).limit(1);
        const [finalLease] = await db.select().from(environmentLeases).where(eq(environmentLeases.id, lease.id)).limit(1);
        // Reusable Sandbox leases use the canonical release owner’s
        // stop-and-retain status (`released`) for every turn outcome. Other
        // policies retain the requested terminal reason, so cancellation is
        // `expired` and failed/unknown remains `failed`. Never rewrite an
        // uncertain result into a successful lease/run outcome here.
        const expectedLeaseStatus = finalLease?.leasePolicy === "reuse_by_environment" ? "released" :
          result.state === "cancelled" ? "expired" : result.state === "completed" ? "released" : "failed";
        if (!finalRun || ["queued", "running"].includes(finalRun.status) || finalLease?.status !== expectedLeaseStatus ||
            !finalLease.releasedAt || finalLease.cleanupStatus !== "success" || !result.localSessionClosed)
          throw forbidden("The local session and EnvironmentRun lease did not settle cleanly");
        let remoteStopConfirmed = false;
        try {
          await verifyNativeCleanupRuntimeState(db, { companyId: target.agent.companyId, runId: run.id, leaseId: lease.id },
            finalLease.metadata?.remoteExecutionTermination);
          remoteStopConfirmed = true;
        } catch { /* local handle closure and database cleanup labels are not remote Stop evidence */ }
        return { result, reservation: reservation!, remoteStopConfirmed };
        } finally {
          if (!settled) {
            if (!releaseCoordinator) {
              const terminalized = await failUnclaimedNativeOpenCodeConformanceRun({ db,
                companyId: target.agent.companyId, issueId: harness.task.id, runId: remote.identity.runId,
                agentId: target.agent.id, qualificationGroupId: groupId, planId: harness.plan.id,
                profileId: target.profile.id, probeId, restoreAgentStatus: target.agent.status });
              if (!terminalized) {
                maySettleLease = false;
                coordinatorOwnershipUnverified = true;
              }
            }
            if (maySettleLease) await remote.settle("unknown");
          }
          if (releaseCoordinator) await releaseCoordinator({ status: "failed", errorCode: "provider_conformance_unsettled",
            error: "The actual Native OpenCode probe did not complete cleanly.",
            resultJson: { nativeOpenCodeConformanceProbe: true, observedState: "unknown" } });
        }
      }
      let failedChecks: Record<string, boolean> = { connect: false, identity: false, start: false, stream: false,
        wait: false, resume: false, memoryScoping: false, cancel: false };
      try {
      const first = await probe(primary, primaryHarness, "start", marker, marker);
      const resumed = await probe(primary, primaryHarness, "resume", marker, marker);
      const peerUnseen = await probe(peer, peerHarness, "peer_unseen", marker, "NONE");
      const peerWriteMarker = `AW_PROBE_${randomUUID().replaceAll("-", "")}`;
      const peerWrite = await probe(peer, peerHarness, "peer_write", peerWriteMarker, peerWriteMarker);
      const isolated = await probe(primary, primaryHarness, "isolation_read", marker, marker);
      const cancellation = await probe(primary, primaryHarness, "cancel", marker, undefined, true);
      const checks = { connect: [first, resumed, peerUnseen, peerWrite, isolated, cancellation].every(item => item.result.streamObserved),
        identity: [first, resumed, peerUnseen, peerWrite, isolated, cancellation].every((item, index) => item.result.identity.agentId === (index === 2 || index === 3 ? peer.agent.id : agentId)),
        start: first.result.state === "completed" && first.result.output.trim() === marker,
        stream: first.result.streamObserved, wait: first.result.state === "completed",
        resume: resumed.result.state === "completed" && resumed.result.output.trim() === marker && resumed.result.sessionId === first.result.sessionId,
        memoryScoping: nativeOpenCodeConformanceMemoryScopingPassed({
          first: first.result, peerUnseen: peerUnseen.result, peerWrite: peerWrite.result, isolated: isolated.result,
          primaryProfileRef: primary.profile.providerProfileRef, peerProfileRef: peer.profile.providerProfileRef,
        }) && peerWrite.result.output.trim() === peerWriteMarker && isolated.result.output.trim() === marker,
        cancel: cancellation.result.state === "cancelled" && cancellation.result.errorCode === "cancelled" &&
          cancellation.result.localSessionClosed && cancellation.remoteStopConfirmed };
      failedChecks = checks;
      if (requiredChecks.some(key => checks[key as keyof typeof checks] !== true) ||
          [first, resumed, peerUnseen, peerWrite, isolated].some(item => item.reservation.status !== "completed") ||
          !["completed", "unknown"].includes(cancellation.reservation.status))
        throw forbidden("Actual managed OpenCode lifecycle, wire settlement, isolation, or cancellation proof was incomplete");
      const { hash: _hash, ...snapshotInput } = primary.discovered.capabilitySnapshot!;
      const binding = await bindings.recordDiscovery(companyId, agentId, snapshotInput, checks, { accountingComplete: true,
        configurationHash: primary.configurationHash, runtimeId: primary.binding.runtime.id,
        profileRef: primary.binding.runtime.providerProfileRef, bindingId: primary.binding.provider.id,
        isolationPeer: { companyId: peer.agent.companyId, agentId: peer.agent.id, runtimeId: peer.binding.runtime.id,
          bindingId: peer.binding.provider.id, profileRef: peer.binding.runtime.providerProfileRef, configurationHash: peer.configurationHash },
        accountingBasis: "native_pre_spend_liability_ceiling", reservationIds: ledgerIds });
      return { binding, checks, requiredChecks,
        runIds: runs, groupId, reservationIds: ledgerIds, unknownChargeReservationIds: cancellation.reservation.status === "unknown" ? [cancellation.reservation.id] : [],
        failure: null };
      } catch {
        if (!runs.length) throw forbidden("The managed OpenCode probe did not start; no current qualification evidence was changed");
        const reservationRows = await db.select({ id: orchestrationModelReservations.id, status: orchestrationModelReservations.status })
          .from(orchestrationModelReservations).where(inArray(orchestrationModelReservations.planId,
            [primaryHarness.plan.id, peerHarness.plan.id]));
        const reservationIds = [...new Set([...ledgerIds, ...reservationRows.map(row => row.id)])];
        const unknownChargeReservationIds = reservationRows.filter(row => row.status === "unknown").map(row => row.id);
        try {
          if (coordinatorOwnershipUnverified)
            throw conflict("The unclaimed conformance Run is owned by another Native finalization path");
          const current = await selectTarget(companyId, agentId);
          const currentPeer = await selectTarget(peer.agent.companyId, peer.agent.id);
          if (current.binding.runtime.id !== primary.binding.runtime.id ||
              current.binding.provider.id !== primary.binding.provider.id ||
              current.binding.runtime.providerProfileRef !== primary.binding.runtime.providerProfileRef ||
              current.binding.runtime.status !== primary.binding.runtime.status ||
              current.binding.provider.status !== primary.binding.provider.status ||
              current.binding.provider.isolationMode !== primary.binding.provider.isolationMode ||
              current.configurationHash !== primary.configurationHash ||
              current.profile.providerSnapshotHash !== primary.profile.providerSnapshotHash ||
              current.grant.grant.id !== primary.grant.grant.id || current.grant.connection.id !== primary.grant.connection.id ||
              currentPeer.binding.runtime.id !== peer.binding.runtime.id || currentPeer.binding.provider.id !== peer.binding.provider.id ||
              currentPeer.binding.runtime.providerProfileRef !== peer.binding.runtime.providerProfileRef ||
              currentPeer.binding.runtime.status !== peer.binding.runtime.status ||
              currentPeer.binding.provider.status !== peer.binding.provider.status ||
              currentPeer.binding.provider.isolationMode !== peer.binding.provider.isolationMode ||
              currentPeer.configurationHash !== peer.configurationHash ||
              currentPeer.profile.providerSnapshotHash !== peer.profile.providerSnapshotHash ||
              currentPeer.grant.grant.id !== peer.grant.grant.id || currentPeer.grant.connection.id !== peer.grant.connection.id)
            throw conflict("The current provider profile or grant changed before failed retest evidence was retained");
          const { hash: _hash, ...snapshotInput } = current.discovered.capabilitySnapshot!;
          const binding = await bindings.recordDiscovery(companyId, agentId, snapshotInput, failedChecks, { accountingComplete: false,
            configurationHash: current.configurationHash, runtimeId: current.binding.runtime.id,
            profileRef: current.binding.runtime.providerProfileRef, bindingId: current.binding.provider.id,
            isolationPeer: { companyId: currentPeer.agent.companyId, agentId: currentPeer.agent.id,
              runtimeId: currentPeer.binding.runtime.id, bindingId: currentPeer.binding.provider.id,
              profileRef: currentPeer.binding.runtime.providerProfileRef, configurationHash: currentPeer.configurationHash },
            accountingBasis: "native_pre_spend_liability_ceiling", reservationIds });
          const requiredChecks = providerConformanceRequirements(current.discovered.capabilitySnapshot!, binding.isolationMode);
          return { binding, checks: failedChecks, requiredChecks, runIds: runs, groupId, reservationIds,
            unknownChargeReservationIds,
            failure: "Actual managed OpenCode lifecycle, wire settlement, isolation, or cancellation proof was incomplete." };
        } catch {
          return { binding: null, checks: failedChecks, requiredChecks, runIds: runs, groupId,
            reservationIds, unknownChargeReservationIds,
            failure: "Actual managed OpenCode lifecycle or current-authority proof was incomplete." };
        }
      }
    },
  };
}
