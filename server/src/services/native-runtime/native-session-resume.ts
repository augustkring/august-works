import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { heartbeatRunEvents, heartbeatRuns, type Db } from "@paperclipai/db";
import type {
  NativeExecutionInput,
  PersistedNativeSession,
} from "../../vendor/paperclip-runner/index.js";
import { parseNativeExecutionInput } from "../../vendor/paperclip-runner/index.js";
import { nativePayloadSourceInputSchema, nativeRunInputSourceReceiptSchema,
  type NativePayloadSourceInput } from "@paperclipai/shared";
import { nativeSha256 } from "./canonical.js";

export type NativeToolExecutionTargetKind = "local" | "remote";

/**
 * Persisted provider threads retain their dynamic-tool declarations. This
 * fingerprint is part of checkpoint compatibility and must change whenever
 * the server-authorized native tool definitions or advertisement policy
 * changes. The execution target remains part of compatibility because local and
 * remote files use different server-bound readers.
 */
export function nativeToolContractFingerprintForTarget(
  executionTargetKind: NativeToolExecutionTargetKind,
): string {
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        schema: "paperclip.native-tool-contract.v13",
        executionTargetKind,
        advertisementPolicy: {
          // Direct provider threads retain declarations from thread/start.
          // Keep this explicit so changing a tool from conditional to stable
          // advertisement rotates checkpoints even when its schema is unchanged.
          readCurrentWakeComments: "always_advertised_binding_gated.v1",
          historicalChatAttachments:
            "always_advertised_conversation_binding_gated.v1",
          registerDeliverable: "verified_local_or_remote_workspace.v2",
          readChatAttachment: "always_advertised_run_scope_local_staging.v1",
          structuredHumanInput:
            "always_advertised_run_issue_agent_binding_gated_current_task_description.v2",
          semanticCompletion: "finish_accessible_deliverable_evidence.v4",
          connectorTools: "assigned_resources_and_pinned_skill_bundle.v1",
          ...(executionTargetKind === "remote"
            ? { assignedMcpTools: "codex_server_gateway_prp_relay.v1" }
            : {}),
        },
        tools: [
          { name: "register_deliverable", version: 2 },
          {
            name: "read_current_wake_comments",
            semanticContract: "paperclip.server-current-wake-comments.v1",
            version: 1,
          },
          {
            name: "list_chat_attachments",
            semanticContract: "paperclip.server-chat-attachment-reuse.v1",
            version: 1,
          },
          {
            name: "reuse_chat_attachment",
            semanticContract: "paperclip.server-chat-attachment-reuse.v1",
            version: 1,
          },
          {
            name: "read_chat_attachment",
            semanticContract: "paperclip.server-chat-attachment-read.v1",
            version: 1,
          },
          { name: "request_human_input", version: 1 },
        ],
      }),
    )
    .digest("hex")}`;
}

/** Default local-target fingerprint retained for callers and test fixtures. */
export const NATIVE_TOOL_CONTRACT_FINGERPRINT =
  nativeToolContractFingerprintForTarget("local");

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function isNativeSessionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

const LEGACY_RETRY_SOURCE_TERMINAL_STATUSES = new Set([
  "succeeded",
  "interrupted",
  "failed",
  "cancelled",
  "timed_out",
]);

export type NativeSessionBootstrapState = {
  processPid: number | null;
  processGroupId: number | null;
  processStartedAt: Date | null;
  runnerProfileJson: unknown;
};

export function isUnusedNativeSessionBootstrap(
  run: NativeSessionBootstrapState,
  hasProviderEvents: boolean,
): boolean {
  return (
    run.processPid === null &&
    run.processGroupId === null &&
    run.processStartedAt === null &&
    record(run.runnerProfileJson).sessionCheckpoint == null &&
    !hasProviderEvents
  );
}

/** Newest-first rows for one exact task/session; never skip provider progress. */
export function selectNativeSessionResumeRun<
  T extends NativeSessionBootstrapState & {
    id: string;
    companyId: string;
    agentId: string;
    nativeIssueId: string | null;
    nativeSessionId: string | null;
    runtimeMode: string | null;
    status: string;
    createdAt: Date;
  },
>(input: {
  runs: readonly T[];
  companyId: string;
  agentId: string;
  issueId: string;
  normalizedSessionId: string;
  currentRunId: string;
  beforeCreatedAt: Date;
  providerEvidenceRunIds: ReadonlySet<string>;
}): T | null {
  for (const run of input.runs) {
    if (
      run.id === input.currentRunId ||
      run.companyId !== input.companyId ||
      run.agentId !== input.agentId ||
      run.nativeIssueId !== input.issueId ||
      run.nativeSessionId !== input.normalizedSessionId
    )
      continue;
    if (
      run.runtimeMode !== "native" ||
      !LEGACY_RETRY_SOURCE_TERMINAL_STATUSES.has(run.status)
    )
      return null;
    // Even an incompatible checkpoint is a progress barrier. The caller must
    // reject it or start a fresh session, not fall back to an older checkpoint.
    if (record(run.runnerProfileJson).sessionCheckpoint != null)
      return run.createdAt > input.beforeCreatedAt ? null : run;
    if (
      !isUnusedNativeSessionBootstrap(
        run,
        input.providerEvidenceRunIds.has(run.id),
      )
    )
      return null;
  }
  return null;
}

export async function nativeSessionProviderEvidence(
  db: Pick<Db, "select">,
  runIds: string[],
): Promise<Set<string>> {
  if (!runIds.length) return new Set();
  const rows = await db
    .select({ runId: heartbeatRunEvents.runId })
    .from(heartbeatRunEvents)
    .where(
      and(
        inArray(heartbeatRunEvents.runId, runIds),
        inArray(heartbeatRunEvents.eventType, [
          "harness.ready",
          "session.started",
          "session.resumed",
          "session.updated",
          "turn.started",
          "provider.event",
          "provider.rpc_result",
        ]),
      ),
    )
    .groupBy(heartbeatRunEvents.runId);
  return new Set(rows.map((row) => row.runId));
}

export async function findNativeSessionResumeRun(
  db: Db,
  input: {
    companyId: string;
    agentId: string;
    issueId: string;
    normalizedSessionId: string;
    currentRunId: string;
    beforeCreatedAt: Date;
  },
) {
  if (!isNativeSessionId(input.normalizedSessionId)) return null;
  const runs = await db
    .select({
      id: heartbeatRuns.id,
      companyId: heartbeatRuns.companyId,
      agentId: heartbeatRuns.agentId,
      runnerInstanceId: heartbeatRuns.runnerInstanceId,
      nativeSessionId: heartbeatRuns.nativeSessionId,
      nativeIssueId: heartbeatRuns.nativeIssueId,
      runtimeMode: heartbeatRuns.runtimeMode,
      status: heartbeatRuns.status,
      nativeInputSourceProtocolVersion: heartbeatRuns.nativeInputSourceProtocolVersion,
      createdAt: heartbeatRuns.createdAt,
      processPid: heartbeatRuns.processPid,
      processGroupId: heartbeatRuns.processGroupId,
      processStartedAt: heartbeatRuns.processStartedAt,
      runnerProfileJson: heartbeatRuns.runnerProfileJson,
      contextSnapshot: heartbeatRuns.contextSnapshot,
      responsibleUserId: heartbeatRuns.responsibleUserId,
    })
    .from(heartbeatRuns)
    .where(
      and(
        ne(heartbeatRuns.id, input.currentRunId),
        eq(heartbeatRuns.companyId, input.companyId),
        eq(heartbeatRuns.agentId, input.agentId),
        eq(heartbeatRuns.nativeIssueId, input.issueId),
        eq(heartbeatRuns.nativeSessionId, input.normalizedSessionId),
      ),
    )
    .orderBy(desc(heartbeatRuns.createdAt), desc(heartbeatRuns.id))
    .limit(32);
  return selectNativeSessionResumeRun({
    ...input,
    runs,
    providerEvidenceRunIds: await nativeSessionProviderEvidence(
      db,
      runs.map((run) => run.id),
    ),
  });
}

/** A retained provider thread is source-qualified only when its exact prior
 * checkpoint and every acknowledged input component remain bound to the same
 * Human, conversation generation, provider session, and workspace. This is a
 * structural witness; callers still revalidate the receipt's owners and ACLs
 * under the Native source privacy lock before dispatch. */
export function nativeRetainedRunResumeWitness(input: {
  previousRun: {
    id: string; companyId: string; agentId: string; nativeIssueId: string | null;
    nativeSessionId: string | null; runtimeMode: string | null; status: string;
    responsibleUserId: string | null; nativeInputSourceProtocolVersion: number | null;
    contextSnapshot: unknown; runnerProfileJson: unknown;
  };
  currentExecution: NativeExecutionInput;
  currentResponsibleUserId: string | null;
  currentConversationSessionGeneration: number | null;
  requireConversationGeneration?: boolean;
  executionTargetKind?: NativeToolExecutionTargetKind;
}): { source: Extract<NativePayloadSourceInput, { kind: "retained_run" }>; components: import("./native-execution-input.js").NativeConsumedSourceComponent[];
  sets: Array<{ policy: import("@paperclipai/shared").NativePayloadSourcePolicy; inputs: NativePayloadSourceInput[] }> } | null {
  const previous = input.previousRun;
  const profile = record(previous.runnerProfileJson);
  const generation = record(previous.contextSnapshot).conversationSessionGeneration;
  const previousGeneration = Number.isSafeInteger(generation) && (generation as number) >= 0 ? generation as number : null;
  if (previous.runtimeMode !== "native" || !LEGACY_RETRY_SOURCE_TERMINAL_STATUSES.has(previous.status) ||
    previous.companyId !== input.currentExecution.binding.companyId || previous.agentId !== input.currentExecution.binding.agentId ||
    previous.nativeIssueId !== input.currentExecution.binding.issueId || previous.nativeSessionId !== input.currentExecution.session.normalizedSessionId ||
    !previous.responsibleUserId || previous.responsibleUserId !== input.currentResponsibleUserId ||
    previousGeneration !== input.currentConversationSessionGeneration ||
    input.requireConversationGeneration === true && previousGeneration === null) return null;
  const targetKind = input.executionTargetKind ?? "local";
  const expectedFingerprint = nativeToolContractFingerprintForTarget(targetKind);
  if (profile.nativeToolContractFingerprint !== expectedFingerprint) return null;
  const checkpoint = record(profile.sessionCheckpoint);
  const checkpointIdentity = record(checkpoint.identity);
  if (!Object.keys(checkpoint).length || typeof checkpoint.sessionId !== "string" || !checkpoint.sessionId.trim() ||
    checkpointIdentity.runId !== previous.id || checkpointIdentity.companyId !== previous.companyId ||
    checkpointIdentity.issueId !== previous.nativeIssueId || checkpointIdentity.agentId !== previous.agentId ||
    checkpointIdentity.sessionId !== previous.nativeSessionId) return null;
  let previousExecution: NativeExecutionInput;
  try { previousExecution = parseNativeExecutionInput(profile.nativeExecutionInput); } catch { return null; }
  if (previousExecution.binding.runId !== previous.id || previousExecution.binding.companyId !== previous.companyId ||
    previousExecution.binding.issueId !== previous.nativeIssueId || previousExecution.binding.agentId !== previous.agentId ||
    previousExecution.session.normalizedSessionId !== previous.nativeSessionId ||
    !sameProvider(previousExecution.provider, input.currentExecution.provider) ||
    previousExecution.session.driverKind !== input.currentExecution.session.driverKind ||
    !sameWorkspaceScope({ previousExecution, previousRunId: previous.id, currentExecution: input.currentExecution }) ||
    previousExecution.task.workMode !== input.currentExecution.task.workMode ||
    ("executionMode" in previousExecution ? previousExecution.executionMode : "default") !==
      ("executionMode" in input.currentExecution ? input.currentExecution.executionMode : "default") ||
    rebindNativeSessionCheckpoint({ previousRun: previous as Parameters<typeof rebindNativeSessionCheckpoint>[0]["previousRun"],
      currentExecution: input.currentExecution, executionTargetKind: targetKind }) === null) return null;
  const parsedReceipt = nativeRunInputSourceReceiptSchema.safeParse(profile.nativeInputSourceReceipt);
  const rawIntents = profile.nativeModelInputDispatchIntents;
  if (!parsedReceipt.success || previous.nativeInputSourceProtocolVersion !== 1 || !Array.isArray(rawIntents) ||
    rawIntents.length < 1 || rawIntents.length > 64 || parsedReceipt.data.binding.companyId !== previous.companyId ||
    parsedReceipt.data.binding.runId !== previous.id || parsedReceipt.data.binding.agentId !== previous.agentId ||
    parsedReceipt.data.binding.issueId !== previous.nativeIssueId || parsedReceipt.data.binding.responsibleUserId !== previous.responsibleUserId)
    return null;
  const intents = rawIntents.map(record);
  const dispatches = parsedReceipt.data.dispatches;
  if (dispatches.length !== intents.length || intents.some(intent => typeof intent.turnId !== "string" ||
    !/^[\x21-\x7e]{1,240}$/.test(intent.turnId) || intent.responsibleUserId !== previous.responsibleUserId ||
    typeof intent.turnInputDigest !== "string" || !/^[0-9a-f]{64}$/.test(intent.turnInputDigest)) ||
    new Set(intents.map(intent => intent.turnInputDigest)).size !== intents.length ||
    dispatches.some(dispatch => !intents.some(intent => intent.turnInputDigest === dispatch.executionInputDigest &&
      intent.responsibleUserId === dispatch.responsibleUserId))) return null;
  const retainedArray = (key: string, max: number): unknown[] | null => {
    const value = profile[key];
    return value === undefined ? [] : Array.isArray(value) && value.length <= max ? value : null;
  };
  const toolAssociations = retainedArray("nativeToolCallDispatchAssociations", 512);
  const toolResultCaptures = retainedArray("nativeToolResultSourceCaptures", 256);
  const wireIntents = retainedArray("nativeAwModelWireIntents", 256);
  if (!toolAssociations || !toolResultCaptures || !wireIntents ||
    Buffer.byteLength(JSON.stringify({ intents, toolAssociations, toolResultCaptures, wireIntents })) > 2 * 1024 * 1024) return null;
  const components: import("./native-execution-input.js").NativeConsumedSourceComponent[] = [
    { kind: "bootstrap" },
    ...dispatches.map(dispatch => ({ kind: "dispatch" as const, executionInputDigest: dispatch.executionInputDigest,
      policy: dispatch.policy, inputs: dispatch.inputs })),
    ...parsedReceipt.data.additionalInputs.map(entry => ({ kind: "additional_input" as const,
      responsibleUserId: entry.responsibleUserId, policy: entry.policy, inputs: entry.inputs })),
  ];
  if (components.length > 64 || components.some((component, index) => components.slice(0, index).some(prior =>
    JSON.stringify(prior) === JSON.stringify(component)))) return null;
  const sets = [{ policy: parsedReceipt.data.bootstrap.policy, inputs: parsedReceipt.data.bootstrap.inputs },
    ...dispatches.map(dispatch => ({ policy: dispatch.policy, inputs: dispatch.inputs })),
    ...parsedReceipt.data.additionalInputs.map(entry => ({ policy: entry.policy, inputs: entry.inputs }))];
  if (sets.reduce((count, set) => count + set.inputs.length, 0) > 512) return null;
  const source = nativePayloadSourceInputSchema.parse({ kind: "retained_run", runId: previous.id,
    inputDigest: nativeSha256({ schema: "paperclip.native-retained-run-input.v1", companyId: previous.companyId,
      runId: previous.id, agentId: previous.agentId, issueId: previous.nativeIssueId,
      responsibleUserId: previous.responsibleUserId, conversationSessionGeneration: previousGeneration,
      nativeSessionId: previous.nativeSessionId, checkpointDigest: nativeSha256(checkpoint),
      executionDigest: nativeSha256(previousExecution), workspaceScope: nativeCheckpointWorkspaceScope(previousExecution, previous.id),
      provider: previousExecution.provider, toolContractFingerprint: expectedFingerprint }),
    dispatchDigest: nativeSha256({ schema: "paperclip.native-retained-run-dispatch.v1", receiptDigest: parsedReceipt.data.digest,
      receipt: parsedReceipt.data, acknowledgedDispatches: intents,
      toolAssociations, toolResultCaptures, wireIntents }) });
  return source.kind === "retained_run" ? { source, components, sets } : null;
}

/** A preassigned session id may rotate only before immutable native admission. */
export function nativeSessionIdForBootstrapPersistence(input: {
  run: NativeSessionBootstrapState & { nativeSessionId: string | null };
  selectedSessionId: string;
  hasProviderEvents: boolean;
}): string {
  if (input.run.nativeSessionId === input.selectedSessionId)
    return input.selectedSessionId;
  if (
    record(input.run.runnerProfileJson).nativeExecutionInput !== undefined ||
    !isUnusedNativeSessionBootstrap(input.run, input.hasProviderEvents)
  ) {
    throw new Error("native_session_bootstrap_identity_conflict");
  }
  return input.selectedSessionId;
}

/** Caller holds the run row lock; recheck authority after waiting for that lock. */
export async function prepareNativeSessionBootstrapPersistence(
  db: Pick<Db, "select">,
  input: {
    run: NativeSessionBootstrapState & {
      id: string;
      nativeSessionId: string | null;
    };
    selectedSessionId: string;
    execution: NativeExecutionInput;
    restoringCheckpoint: boolean;
  },
) {
  const hasProviderEvents = (
    await nativeSessionProviderEvidence(db, [input.run.id])
  ).has(input.run.id);
  const profile = record(input.run.runnerProfileJson);
  if (
    profile.nativeExecutionInput !== undefined &&
    !isDeepStrictEqual(
      parseNativeExecutionInput(profile.nativeExecutionInput),
      input.execution,
    )
  ) {
    throw new Error("native_execution_input_persisted_binding_mismatch");
  }
  if (
    input.restoringCheckpoint &&
    !isUnusedNativeSessionBootstrap(input.run, hasProviderEvents)
  ) {
    throw new Error("native_session_bootstrap_identity_conflict");
  }
  return nativeSessionIdForBootstrapPersistence({
    ...input,
    hasProviderEvents,
  });
}

/**
 * Legacy compatibility is deliberately narrower than ordinary task-session
 * continuation: only a replacement row that never acquired any native process
 * or provider authority may be rebound to a terminal native source. The exact
 * checkpoint/session/workspace/provider binding is validated separately by
 * rebindNativeSessionCheckpoint.
 */
export function isUnusedLegacyNativeRetryReplacement(input: {
  replacement: {
    processPid: number | null;
    processGroupId: number | null;
    processStartedAt: Date | null;
    runnerProfileJson: unknown;
  };
  source: {
    runtimeMode: string | null;
    status: string;
    nativeSessionId: string | null;
  } | null;
  hasProviderEvents: boolean;
}): boolean {
  return Boolean(
    input.source?.runtimeMode === "native" &&
    LEGACY_RETRY_SOURCE_TERMINAL_STATUSES.has(input.source.status) &&
    isNativeSessionId(input.source.nativeSessionId) &&
    isUnusedNativeSessionBootstrap(input.replacement, input.hasProviderEvents),
  );
}

function sameProvider(
  previous: NativeExecutionInput["provider"],
  current: NativeExecutionInput["provider"],
): boolean {
  return JSON.stringify(previous) === JSON.stringify(current);
}

function nativeCheckpointWorkspaceScope(
  execution: NativeExecutionInput,
  owningRunId: string,
) {
  // Projectless work uses each heartbeat run id as a placeholder workspace id.
  // Continuity is safe only when both sides independently prove that shape and
  // their complete immutable workspace descriptors match. A real managed
  // workspace instead binds continuity to its durable workspace row id.
  return execution.binding.executionWorkspaceId === owningRunId
    ? {
        kind: "transient" as const,
        cwd: execution.workspace.cwd,
        repoUrl: execution.workspace.repoUrl,
        repoRef: execution.workspace.repoRef,
        branchName: execution.workspace.branchName,
      }
    : {
        kind: "managed" as const,
        id: execution.binding.executionWorkspaceId,
      };
}

function sameWorkspaceScope(input: {
  previousExecution: NativeExecutionInput;
  previousRunId: string;
  currentExecution: NativeExecutionInput;
}): boolean {
  return (
    JSON.stringify(
      nativeCheckpointWorkspaceScope(
        input.previousExecution,
        input.previousRunId,
      ),
    ) ===
    JSON.stringify(
      nativeCheckpointWorkspaceScope(
        input.currentExecution,
        input.currentExecution.binding.runId,
      ),
    )
  );
}

/** A resume delta is valid only if the provider checkpoint really can be used. */
export function buildNativeExecutionWithCheckpoint(input: {
  previousRun:
    Parameters<typeof rebindNativeSessionCheckpoint>[0]["previousRun"] | null;
  normalizedSessionId: string;
  executionTargetKind?: NativeToolExecutionTargetKind;
  buildExecution: (options: {
    normalizedSessionId: string;
    resumedSession: boolean;
  }) => NativeExecutionInput;
}): {
  execution: NativeExecutionInput;
  checkpoint: PersistedNativeSession | null;
  normalizedSessionId: string;
} {
  const execution = input.buildExecution({
    normalizedSessionId: input.normalizedSessionId,
    resumedSession: input.previousRun !== null,
  });
  const checkpoint = input.previousRun
    ? rebindNativeSessionCheckpoint({
        previousRun: input.previousRun,
        currentExecution: execution,
        executionTargetKind: input.executionTargetKind,
      })
    : null;
  if (checkpoint)
    return {
      execution,
      checkpoint,
      normalizedSessionId: input.normalizedSessionId,
    };
  // Rebuild both task context and wake instructions. Merely rotating the ID
  // leaves a fresh provider with a compact delta and missing task context.
  const normalizedSessionId = randomUUID();
  return {
    execution: input.buildExecution({
      normalizedSessionId,
      resumedSession: false,
    }),
    checkpoint: null,
    normalizedSessionId,
  };
}

/**
 * Rebind a completed prior run's provider checkpoint to a new heartbeat run.
 * The provider/driver session identity is retained, while every per-turn and
 * per-event field is reset so the new run starts one clean turn via resume.
 */
export function rebindNativeSessionCheckpoint(input: {
  previousRun: {
    id: string;
    companyId: string;
    agentId: string;
    nativeSessionId: string | null;
    runnerProfileJson: unknown;
  };
  currentExecution: NativeExecutionInput;
  executionTargetKind?: NativeToolExecutionTargetKind;
}): PersistedNativeSession | null {
  const previousProfile = record(input.previousRun.runnerProfileJson);
  if (
    previousProfile.nativeToolContractFingerprint !==
    nativeToolContractFingerprintForTarget(input.executionTargetKind ?? "local")
  ) {
    return null;
  }
  const rawCheckpoint = record(previousProfile.sessionCheckpoint);
  const checkpointIdentity = record(rawCheckpoint.identity);
  const current = input.currentExecution;
  const normalizedSessionId = current.session.normalizedSessionId;
  if (
    !isNativeSessionId(normalizedSessionId) ||
    input.previousRun.companyId !== current.binding.companyId ||
    input.previousRun.agentId !== current.binding.agentId ||
    input.previousRun.nativeSessionId !== normalizedSessionId ||
    typeof rawCheckpoint.sessionId !== "string" ||
    checkpointIdentity.runId !== input.previousRun.id ||
    checkpointIdentity.companyId !== current.binding.companyId ||
    checkpointIdentity.issueId !== current.binding.issueId ||
    checkpointIdentity.agentId !== current.binding.agentId ||
    checkpointIdentity.sessionId !== normalizedSessionId
  )
    return null;

  let previousExecution: NativeExecutionInput;
  try {
    previousExecution = parseNativeExecutionInput(
      previousProfile.nativeExecutionInput,
    );
  } catch {
    return null;
  }
  if (
    previousExecution.binding.runId !== input.previousRun.id ||
    previousExecution.binding.companyId !== current.binding.companyId ||
    previousExecution.binding.issueId !== current.binding.issueId ||
    previousExecution.binding.agentId !== current.binding.agentId ||
    previousExecution.session.normalizedSessionId !== normalizedSessionId ||
    previousExecution.session.driverKind !== current.session.driverKind ||
    !sameWorkspaceScope({
      previousExecution,
      previousRunId: input.previousRun.id,
      currentExecution: current,
    }) ||
    previousExecution.task.workMode !== current.task.workMode ||
    ("executionMode" in previousExecution
      ? previousExecution.executionMode
      : "default") !==
      ("executionMode" in current ? current.executionMode : "default") ||
    !sameProvider(previousExecution.provider, current.provider) ||
    previousExecution.schema !== current.schema ||
    ("runtimeContext" in previousExecution &&
      "runtimeContext" in current &&
      previousExecution.runtimeContext.aggregateDigest !==
        current.runtimeContext.aggregateDigest)
  )
    return null;

  const priorSemanticResult = record(rawCheckpoint.semanticResult);
  const priorContinuation = record(priorSemanticResult.continuation);
  const rawGoal = rawCheckpoint.goal;
  const hasUnfinishedGoal =
    rawGoal !== null &&
    rawGoal !== undefined &&
    record(rawGoal).status !== "complete";
  const providerRecoveryPolicy = hasUnfinishedGoal
    ? ("same_session_only" as const)
    : priorSemanticResult.reportedWorkDisposition === "yielded" &&
        priorContinuation.kind === "response_wake"
      ? ("allow_replacement_after_governed_wait" as const)
      : ("allow_replacement_after_resume_failure" as const);

  return {
    ...(structuredClone(rawCheckpoint) as unknown as PersistedNativeSession),
    identity: {
      runId: current.binding.runId,
      sessionId: normalizedSessionId,
      companyId: current.binding.companyId,
      issueId: current.binding.issueId,
      agentId: current.binding.agentId,
    },
    cursor: null,
    semanticResult: null,
    terminal: null,
    activeTurnId: null,
    terminalTurns: [],
    pendingRuntimeRequests: [],
    providerRecoveryPolicy,
  };
}
