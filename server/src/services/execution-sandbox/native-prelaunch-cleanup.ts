import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { agentExecutionManifests, environmentLeases, heartbeatRunEvents, heartbeatRuns,
  nativeRunFinalizations, nativeRunResults, orchestrationModelReservations, orchestrationWorkerAttempts,
  runtimeCells, runtimeHostCommands, runtimeHosts, runtimeOperations, runtimePolicySnapshots, runtimeSandboxBindings,
  activityLog, toolInvocations, type Db } from "@paperclipai/db";
import { SANDBOX_HOST_COMMAND, nativePayloadSourceInputSchema, sandboxHostReplySchema, sandboxHostRequestSchema } from "@paperclipai/shared";
import { parseNativeExecutionInput } from "../../vendor/paperclip-runner/index.js";
import { conflict } from "../../errors.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { readRemoteRuntimeAssetLocator, type RemoteRuntimeAssetLocator } from "../native-runtime/runtime-asset-retention.js";

const PRELAUNCH_PURPOSES = new Set(["provider_artifact", "native_workspace_prepare", "native_runtime_context_prepare",
  "native_harness_state", "native_attachment_stage", "native_attachment_cleanup"]);
const PRELAUNCH_FORBIDDEN_EVENTS = ["native.process_start_requested", "native.process_identity_recorded", "native.local_process_stopped",
  "native.in_process_backend_admitted", "native.in_process_backend_settled", "native.remote_workload_stopped",
  "native.session_start_intent", "native.process_start_intent", "native.model_dispatch_started", "native.tool_invocation_started",
  "session.started", "session.resumed", "session.updated", "harness.ready", "provider.event", "provider.rpc_result",
  "turn.started", "native.model_input_dispatch_intent", "session.reconciled", "tool.execution.started"];

export type NativeBootstrapPrelaunchCleanupOwner = Readonly<{
  version: 1; companyId: string; runId: string; leaseId: string; executionInputHash: string; locatorDigest: string;
  attempt: 3; bindingId: string; cellId: string; generation: string; hostId: string; hostEpoch: number;
  claimKey: string; claimVersion: number; policySnapshotId: string; policyHash: string;
  manifestId: string; manifestHash: string; requesterUserId: string; imageDigest: string;
  sandboxId: string; containerId: string; prepareCommandId: string; applyCommandId: string; startCommandId: string;
}>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function isNativeBootstrapPrelaunchCleanupCandidate(db: Db, input: { companyId: string; runId: string }) {
  const [run] = await db.select({ runtimeMode: heartbeatRuns.runtimeMode, status: heartbeatRuns.status,
    nativePhase: heartbeatRuns.nativePhase, errorCode: heartbeatRuns.errorCode, nativeInputSourceProtocolVersion: heartbeatRuns.nativeInputSourceProtocolVersion })
    .from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, input.runId))).limit(1);
  const [coordinator] = await db.select({ attempt: nativeRunFinalizations.attempt, phase: nativeRunFinalizations.phase,
    failureCode: nativeRunFinalizations.failureCode, recoveryState: nativeRunFinalizations.recoveryState,
    leaseOwner: nativeRunFinalizations.leaseOwner }).from(nativeRunFinalizations).where(and(
      eq(nativeRunFinalizations.companyId, input.companyId), eq(nativeRunFinalizations.runId, input.runId))).limit(1);
  return run?.runtimeMode === "native" && run.status === "failed" && run.nativePhase === "terminal_failure" &&
    run.errorCode === "provider_initialize_protocol_error" && run.nativeInputSourceProtocolVersion === 0 &&
    coordinator?.attempt === 3 && coordinator.phase === "terminal_failure" && coordinator.failureCode === "native_session_retry_exhausted" &&
    coordinator.recoveryState === "blocked" && coordinator.leaseOwner === null;
}

export function nativeBootstrapPrelaunchStopClaimKey(owner: NativeBootstrapPrelaunchCleanupOwner) {
  return `native-bootstrap-prelaunch-stop-claim:v1:${nativeSha256(owner)}`;
}

export async function assertNativeBootstrapPrelaunchStopClaim(db: Db, owner: NativeBootstrapPrelaunchCleanupOwner) {
  const expectedVersion = owner.claimVersion + 2;
  const [binding] = await db.select({ status: runtimeSandboxBindings.status, version: runtimeSandboxBindings.version })
    .from(runtimeSandboxBindings).where(and(eq(runtimeSandboxBindings.companyId, owner.companyId),
      eq(runtimeSandboxBindings.id, owner.bindingId), eq(runtimeSandboxBindings.runtimeCellId, owner.cellId),
      eq(runtimeSandboxBindings.cellGeneration, owner.generation))).limit(1);
  const stopClaimKey = nativeBootstrapPrelaunchStopClaimKey(owner);
  const rows = await db.select({ id: activityLog.id, details: activityLog.details,
    actorType: activityLog.actorType, actorId: activityLog.actorId }).from(activityLog).where(and(
    eq(activityLog.companyId, owner.companyId), eq(activityLog.entityType, "runtime_sandbox"),
    eq(activityLog.entityId, owner.bindingId), eq(activityLog.action, "sandbox.workload_stop_claimed"),
    sql`${activityLog.details}->>'generation' = ${owner.generation}`,
    sql`${activityLog.details}->>'claimKey' = ${owner.claimKey}`,
    sql`${activityLog.details}->>'stopClaimKey' = ${stopClaimKey}`,
    sql`${activityLog.details}->>'idempotencyKey' = ${stopClaimKey}`,
    sql`${activityLog.details}->>'runId' = ${owner.runId}`,
    sql`${activityLog.details}->>'leaseId' = ${owner.leaseId}`,
    sql`${activityLog.details}->>'originalRequesterUserId' = ${owner.requesterUserId}`,
  ));
  if (!binding || !((binding.status === "stopping" && binding.version === expectedVersion) ||
      (binding.status === "stopped" && binding.version === expectedVersion + 1)) || rows.length !== 1 ||
      rows[0]!.actorType !== "system" || rows[0]!.actorId !== "native-bootstrap-cleanup")
    throw conflict("Native prelaunch Stop has no current locked binding claim");
  return rows[0]!;
}

/** Exact owner for a terminal Native bootstrap failure before native_session_start.
 * This is a distinct cleanup branch; a missing/malformed start receipt never
 * falls back from readRunLeaseCleanup into this proof. */
export async function readNativeBootstrapPrelaunchCleanup(db: Db, input: {
  companyId: string; runId: string; leaseId: string;
}, expected?: NativeBootstrapPrelaunchCleanupOwner) {
  const [run] = await db.select().from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, input.runId), eq(heartbeatRuns.runtimeMode, "native")));
  const [lease] = await db.select().from(environmentLeases).where(and(
    eq(environmentLeases.companyId, input.companyId), eq(environmentLeases.id, input.leaseId),
    eq(environmentLeases.heartbeatRunId, input.runId)));
  const leaseSiblings = lease ? await db.select({ id: environmentLeases.id }).from(environmentLeases).where(and(
    eq(environmentLeases.companyId, input.companyId), eq(environmentLeases.heartbeatRunId, input.runId),
    lease.environmentId === null ? isNull(environmentLeases.environmentId) : eq(environmentLeases.environmentId, lease.environmentId))) : [];
  const remoteCwd = typeof lease?.metadata?.remoteCwd === "string" ? lease.metadata.remoteCwd : null;
  const providerLeaseScope = lease?.providerLeaseId ? eq(environmentLeases.providerLeaseId, lease.providerLeaseId) : undefined;
  const providerPathScope = remoteCwd ? sql`${environmentLeases.metadata}->>'remoteCwd' = ${remoteCwd}` : undefined;
  const foreignProviderLeases = lease?.provider && (providerLeaseScope || providerPathScope) ? await db.select({ id: environmentLeases.id })
    .from(environmentLeases).where(and(eq(environmentLeases.companyId, input.companyId),
      eq(environmentLeases.provider, lease.provider), or(providerLeaseScope, providerPathScope),
      inArray(environmentLeases.status, ["active", "pending_cleanup"]))) : [];
  if (leaseSiblings.some(candidate => candidate.id !== input.leaseId) ||
      foreignProviderLeases.some(candidate => candidate.id !== input.leaseId))
    throw conflict("Native prelaunch cleanup has a foreign or recreated provider lease");
  const [coordinator] = run?.nativeIssueId ? await db.select().from(nativeRunFinalizations).where(and(
    eq(nativeRunFinalizations.companyId, input.companyId), eq(nativeRunFinalizations.issueId, run.nativeIssueId),
    eq(nativeRunFinalizations.runId, input.runId))).limit(1) : [];
  const profile = record(run?.runnerProfileJson);
  let execution: ReturnType<typeof parseNativeExecutionInput> | null = null;
  try { execution = parseNativeExecutionInput(profile.nativeExecutionInput); } catch { /* Fail closed. */ }
  const failure = record(coordinator?.failureDetail);
  const context = record(run?.contextSnapshot);
  let locator: RemoteRuntimeAssetLocator | null = null;
  if (run) { try { locator = await readRemoteRuntimeAssetLocator(db, run); } catch { /* Fail closed. */ } }
  const events = run ? await db.select({ eventType: heartbeatRunEvents.eventType, sourceEventId: heartbeatRunEvents.sourceEventId }).from(heartbeatRunEvents).where(and(
    eq(heartbeatRunEvents.companyId, input.companyId), eq(heartbeatRunEvents.runId, input.runId))) : [];
  const forbiddenEvents = events.some(event => PRELAUNCH_FORBIDDEN_EVENTS.includes(event.eventType) ||
    (event.sourceEventId !== null && ["session.started", "session.resumed", "session.reconciled"].includes(event.eventType)));
  const dispatchIntents = profile.nativeModelInputDispatchIntents;
  const noDispatch = run?.nativeInputSourceProtocolVersion === 0 &&
    (dispatchIntents === undefined || Array.isArray(dispatchIntents) && dispatchIntents.length === 0) &&
    profile.nativeInputSourceReceipt == null && profile.sessionCheckpoint == null && profile.nativeProviderSessionReceipt == null &&
    (profile.nativeToolCallDispatchAssociations === undefined ||
      Array.isArray(profile.nativeToolCallDispatchAssociations) && profile.nativeToolCallDispatchAssociations.length === 0) &&
    (profile.nativeToolResultSourceCaptures === undefined ||
      Array.isArray(profile.nativeToolResultSourceCaptures) && profile.nativeToolResultSourceCaptures.length === 0) &&
    (profile.nativeDocumentToolResultSources === undefined ||
      Array.isArray(profile.nativeDocumentToolResultSources) && profile.nativeDocumentToolResultSources.length === 0) &&
    (profile.nativeAwModelWireIntents === undefined ||
      Array.isArray(profile.nativeAwModelWireIntents) && profile.nativeAwModelWireIntents.length === 0) &&
    (profile.nativeRuntimeProcedureReadObservations === undefined ||
      Array.isArray(profile.nativeRuntimeProcedureReadObservations) && profile.nativeRuntimeProcedureReadObservations.length === 0);
  const [reservation] = run ? await db.select({ id: orchestrationModelReservations.id }).from(orchestrationModelReservations)
    .where(and(eq(orchestrationModelReservations.companyId, input.companyId), or(
      eq(orchestrationModelReservations.conversationRunId, input.runId),
      inArray(orchestrationModelReservations.workerAttemptId, db.select({ id: orchestrationWorkerAttempts.id })
        .from(orchestrationWorkerAttempts).where(and(eq(orchestrationWorkerAttempts.companyId, input.companyId),
          eq(orchestrationWorkerAttempts.runId, input.runId))))))).limit(1) : [];
  const [result] = run ? await db.select({ id: nativeRunResults.id }).from(nativeRunResults).where(and(
    eq(nativeRunResults.companyId, input.companyId), eq(nativeRunResults.runId, input.runId))).limit(1) : [];
  const [toolInvocation] = run ? await db.select({ id: toolInvocations.id }).from(toolInvocations).where(and(
    eq(toolInvocations.companyId, input.companyId), eq(toolInvocations.runId, input.runId))).limit(1) : [];
  const inputHash = execution ? nativeSha256(profile.nativeExecutionInput) : "";
  const executionBinding = execution?.binding;
  if (!run || !lease || !coordinator || !execution || !executionBinding || !locator ||
    coordinator.attempt !== 3 || coordinator.phase !== "terminal_failure" || coordinator.failureCode !== "native_session_retry_exhausted" ||
    coordinator.recoveryState !== "blocked" || coordinator.leaseOwner !== null || coordinator.leaseExpiresAt !== null ||
    coordinator.nextAttemptAt !== null || coordinator.resultId !== null || coordinator.assessmentId !== null || coordinator.decisionId !== null ||
    failure.originalFailureCode !== "provider_initialize_protocol_error" || failure.recoveryMode !== "bootstrap_retry" ||
    failure.providerSessionEstablished !== false || failure.providerEventsExist !== false || failure.checkpointExists !== false ||
    run.status !== "failed" || run.nativePhase !== "terminal_failure" || run.errorCode !== "provider_initialize_protocol_error" ||
    run.finishedAt === null || run.nativeInputSourceProtocolVersion !== 0 || run.processPid !== null || run.processGroupId !== null ||
    run.processStartedAt !== null || run.sessionIdAfter !== null || !noDispatch || forbiddenEvents || reservation || result || toolInvocation ||
    executionBinding.companyId !== input.companyId || executionBinding.runId !== input.runId || executionBinding.agentId !== run.agentId ||
    executionBinding.issueId !== run.nativeIssueId || typeof run.responsibleUserId !== "string" ||
    execution.session.normalizedSessionId === null || locator.normalizedSessionIdDigest !== createHash("sha256").update(execution.session.normalizedSessionId).digest("hex") || locator.environmentLeaseId !== lease.id || locator.environmentId !== lease.environmentId ||
    locator.provider !== lease.provider || locator.providerLeaseId !== lease.providerLeaseId || locator.runnerInstanceId !== run.runnerInstanceId ||
    typeof lease.metadata?.remoteCwd !== "string" || lease.metadata.remoteCwd !== lease.metadata.remoteCwd.trim() ||
    !lease.metadata.remoteCwd.startsWith("/") ||
    locator.remoteCwdDigest !== createHash("sha256").update(lease.metadata.remoteCwd).digest("hex"))
    throw conflict("Native prelaunch cleanup has no exact exhausted bootstrap owner");
  if (typeof context.issueId !== "string" || context.issueId !== run.nativeIssueId ||
      execution.session.normalizedSessionId !== run.nativeSessionId)
    throw conflict("Native prelaunch cleanup Task binding changed");

  const hostCommands = await db.select().from(runtimeHostCommands).where(and(
    eq(runtimeHostCommands.companyId, input.companyId), eq(runtimeHostCommands.commandType, "sandbox_exec"),
    sql`${runtimeHostCommands.payload}->>'runId' = ${input.runId}`, sql`${runtimeHostCommands.payload}->>'leaseId' = ${input.leaseId}`));
  if (hostCommands.length === 0 || hostCommands.length > 64) throw conflict("Native prelaunch cleanup command inventory is unavailable");
  const commandScopes = new Map<string, Record<string, unknown>>();
  for (const command of hostCommands) {
    const payload = record(command.payload), safeResult = record(command.safeResult);
    const purpose = payload.nativePreparationPurpose;
    if (command.runtimeHostId !== payload.hostId || command.runtimeCellId !== payload.cellId ||
      command.cellGeneration?.toString() !== String(payload.generation) ||
      typeof payload.commandDigest !== "string" || !/^[a-f0-9]{64}$/.test(payload.commandDigest) || command.status !== "SUCCEEDED" || payload.kind !== "sandbox_exec_v1" || payload.requestId !== command.idempotencyKey ||
      payload.runId !== input.runId || payload.leaseId !== input.leaseId || typeof purpose !== "string" || !PRELAUNCH_PURPOSES.has(purpose) ||
      !command.completedAt || !Number.isSafeInteger(safeResult.exitCode) || safeResult.modelBrokerSessionReceipt !== undefined ||
      payload.modelBrokerSession !== undefined || payload.modelBrokerSessionPhase !== undefined || payload.modelBrokerCredential !== undefined ||
      safeResult.timedOut !== false)
      throw conflict("Native prelaunch cleanup found a failed, paid, or unowned Host command");
    const scopeKey = nativeSha256({ bindingId: payload.bindingId, cellId: payload.cellId, generation: payload.generation,
      hostId: payload.hostId, hostEpoch: payload.hostEpoch,
      manifestId: payload.manifestId, manifestHash: payload.manifestHash, policySnapshotId: payload.policySnapshotId, policyHash: payload.policyHash });
    commandScopes.set(scopeKey, payload);
  }
  if (commandScopes.size !== 1) throw conflict("Native prelaunch cleanup has ambiguous setup Host scope");
  const payload = [...commandScopes.values()][0]!;
  const bindingId = payload.bindingId, cellId = payload.cellId, generation = String(payload.generation), hostId = payload.hostId;
  const manifestId = payload.manifestId, manifestHash = payload.manifestHash, policySnapshotId = payload.policySnapshotId,
    policyHash = payload.policyHash, hostEpoch = payload.hostEpoch;
  if (typeof bindingId !== "string" || typeof cellId !== "string" || typeof hostId !== "string" ||
    typeof manifestId !== "string" || typeof manifestHash !== "string" || typeof policySnapshotId !== "string" ||
    typeof policyHash !== "string" || typeof hostEpoch !== "number" || !Number.isSafeInteger(hostEpoch))
    throw conflict("Native prelaunch cleanup setup scope is malformed");
  const [binding] = await db.select().from(runtimeSandboxBindings).where(and(
    eq(runtimeSandboxBindings.companyId, input.companyId), eq(runtimeSandboxBindings.id, bindingId),
    eq(runtimeSandboxBindings.runtimeCellId, cellId), eq(runtimeSandboxBindings.cellGeneration, generation)));
  const [cell] = await db.select().from(runtimeCells).where(and(eq(runtimeCells.companyId, input.companyId),
    eq(runtimeCells.id, cellId), eq(runtimeCells.generation, BigInt(generation)), eq(runtimeCells.runtimeHostId, hostId), isNull(runtimeCells.deletedAt)));
  const [host] = await db.select().from(runtimeHosts).where(and(eq(runtimeHosts.id, hostId), eq(runtimeHosts.credentialVersion, hostEpoch),
    isNull(runtimeHosts.credentialRevokedAt), isNull(runtimeHosts.fencedAt), isNull(runtimeHosts.retiredAt)));
  const [manifest] = await db.select().from(agentExecutionManifests).where(and(eq(agentExecutionManifests.companyId, input.companyId),
    eq(agentExecutionManifests.id, manifestId), eq(agentExecutionManifests.runId, input.runId),
    eq(agentExecutionManifests.agentId, run.agentId), eq(agentExecutionManifests.hash, manifestHash)));
  const [policy] = await db.select().from(runtimePolicySnapshots).where(and(eq(runtimePolicySnapshots.companyId, input.companyId),
    eq(runtimePolicySnapshots.id, policySnapshotId), eq(runtimePolicySnapshots.bindingId, bindingId),
    eq(runtimePolicySnapshots.executionManifestId, manifestId), eq(runtimePolicySnapshots.policyHash, policyHash)));
  const claims = await db.select().from(activityLog).where(and(eq(activityLog.companyId, input.companyId),
    eq(activityLog.entityType, "runtime_sandbox"), eq(activityLog.entityId, bindingId), eq(activityLog.action, "sandbox.admission_claimed"),
    sql`${activityLog.details}->>'generation' = ${generation}`, sql`${activityLog.details}->>'policySnapshotId' = ${policySnapshotId}`,
    sql`${activityLog.details}->>'executionManifestId' = ${manifestId}`, sql`${activityLog.details}->>'executionManifestHash' = ${manifestHash}`,
    sql`${activityLog.details}->>'policyHash' = ${policyHash}`));
  const claimRow = claims.length === 1 ? claims[0]! : null;
  const claim = record(claimRow?.details);
  const claimKey = claim.claimKey, claimVersion = claim.claimVersion;
  if (!claimRow || claimRow.actorType !== "user" || typeof claimRow.actorId !== "string" ||
      typeof claimKey !== "string" || typeof claimVersion !== "number" || !Number.isSafeInteger(claimVersion))
    throw conflict("Native prelaunch cleanup has no exact original admission claim");
  const setupCommands = await db.select().from(runtimeHostCommands).where(and(
    eq(runtimeHostCommands.companyId, input.companyId), eq(runtimeHostCommands.runtimeHostId, hostId),
    eq(runtimeHostCommands.runtimeCellId, cellId), eq(runtimeHostCommands.cellGeneration, BigInt(generation)),
    eq(runtimeHostCommands.commandType, SANDBOX_HOST_COMMAND),
    sql`${runtimeHostCommands.payload}->'provisioning'->>'purpose' = 'admission'`,
    sql`${runtimeHostCommands.payload}->'provisioning'->>'operationKey' = ${claimKey}`));
  const targets = setupCommands.flatMap(command => {
    try {
      const req = sandboxHostRequestSchema.parse(command.payload), rep = sandboxHostReplySchema.parse(command.safeResult);
      const provisioning = req.provisioning;
      return command.status === "SUCCEEDED" && command.runtimeHostId === hostId && command.runtimeCellId === cellId &&
        command.cellGeneration?.toString() === generation && req.action === "prepare" && provisioning?.purpose === "admission" && provisioning.operationKey === claimKey &&
        provisioning.bindingVersion === claimVersion && req.scope.companyId === input.companyId && req.scope.bindingId === bindingId &&
        req.scope.cellId === cellId && req.scope.cellGeneration === generation &&
        req.scope.sandboxRef === (binding?.sandboxRef ?? `aw-v7-${binding?.id}`) && req.requesterUserId === claimRow?.actorId &&
        req.hostEpoch === hostEpoch && req.imageDigest === (cell.activeImageDigest ?? cell.desiredImageDigest) && rep.action === "prepare" && rep.sandboxId && rep.containerId &&
        rep.hostEpoch === hostEpoch && rep.imageDigest === req.imageDigest && rep.bindingVersion === claimVersion
        ? [{ command, req, rep }] : [];
    } catch { return []; }
  });
  const starts = await db.select().from(runtimeHostCommands).where(and(eq(runtimeHostCommands.companyId, input.companyId),
    eq(runtimeHostCommands.runtimeHostId, hostId), eq(runtimeHostCommands.runtimeCellId, cellId),
    eq(runtimeHostCommands.cellGeneration, BigInt(generation)), eq(runtimeHostCommands.commandType, SANDBOX_HOST_COMMAND),
    sql`${runtimeHostCommands.payload}->>'action' = 'start'`,
    sql`${runtimeHostCommands.payload}->'scope'->>'bindingId' = ${bindingId}`));
  const applyPolicyKey = `v7-sandbox-policy:${bindingId}:${generation}:${claimVersion}:${policyHash}`;
  const applies = await db.select().from(runtimeHostCommands).where(and(eq(runtimeHostCommands.companyId, input.companyId),
    eq(runtimeHostCommands.runtimeHostId, hostId), eq(runtimeHostCommands.runtimeCellId, cellId),
    eq(runtimeHostCommands.cellGeneration, BigInt(generation)), eq(runtimeHostCommands.commandType, SANDBOX_HOST_COMMAND),
    sql`${runtimeHostCommands.payload}->>'action' = 'apply'`,
    sql`${runtimeHostCommands.payload}->'scope'->>'bindingId' = ${bindingId}`));
  const matchingApplies = applies.flatMap(command => {
    try {
      const req = sandboxHostRequestSchema.parse(command.payload), rep = sandboxHostReplySchema.parse(command.safeResult);
      return command.status === "SUCCEEDED" && command.runtimeHostId === hostId && command.runtimeCellId === cellId &&
        command.cellGeneration?.toString() === generation && req.scope.companyId === input.companyId && req.scope.bindingId === bindingId &&
        req.scope.cellId === cellId && req.scope.cellGeneration === generation &&
        req.scope.sandboxRef === (binding?.sandboxRef ?? `aw-v7-${binding?.id}`) && req.hostEpoch === hostEpoch &&
        req.imageDigest === targets[0]?.req.imageDigest && req.requesterUserId === claimRow.actorId &&
        req.admission?.idempotencyKey === applyPolicyKey && req.admission.policyHash === policyHash &&
        rep.action === "apply" && rep.applied === true && rep.requiresRecreate === false && rep.policyHash === policyHash
        ? [{ command, req, rep }] : [];
    } catch { return []; }
  });
  const matchingStarts = starts.flatMap(command => {
    try {
      const req = sandboxHostRequestSchema.parse(command.payload), rep = sandboxHostReplySchema.parse(command.safeResult);
      return command.status === "SUCCEEDED" && command.runtimeHostId === hostId && command.runtimeCellId === cellId &&
        command.cellGeneration?.toString() === generation && req.start?.policyHash === policyHash && req.scope.companyId === input.companyId && req.scope.bindingId === bindingId &&
        req.scope.cellId === cellId && req.scope.cellGeneration === generation &&
        req.scope.sandboxRef === (binding?.sandboxRef ?? `aw-v7-${binding?.id}`) && req.hostEpoch === hostEpoch &&
        req.imageDigest === targets[0]?.req.imageDigest && rep.action === "start" && rep.started === true &&
        rep.sandboxId === targets[0]?.rep.sandboxId && rep.containerId === targets[0]?.rep.containerId &&
        rep.policyHash === policyHash && rep.imageDigest === targets[0]?.req.imageDigest ? [{ command, req, rep }] : [];
    } catch { return []; }
  });
  if (!binding || !["admitting", "running", "stopping", "stopped"].includes(binding.status) || binding.backend !== "openshell" ||
    !((binding.status === "admitting" && binding.version === claimVersion) ||
      (binding.status === "running" && binding.version === claimVersion + 1) ||
      (binding.status === "stopping" && binding.version === claimVersion + 2) ||
      (binding.status === "stopped" && binding.version === claimVersion + 3)) || !cell || !host || !manifest || manifest.agentId !== run.agentId ||
    payload.bindingId !== bindingId || payload.cellId !== cellId || payload.hostId !== hostId ||
    record(manifest.manifest).responsibleUserId !== run.responsibleUserId || !policy || !claimRow || claimRow.actorType !== "user" ||
    typeof claimRow.actorId !== "string" || typeof claimKey !== "string" || typeof claimVersion !== "number" || !Number.isSafeInteger(claimVersion) ||
    claimKey !== `v7-sandbox-admission:${bindingId}:${generation}:${claimVersion - 1}:${policySnapshotId}` ||
    claim.expectedVersion !== claimVersion - 1 || targets.length !== 1 || matchingApplies.length !== 1 || matchingStarts.length !== 1 ||
    matchingStarts[0]!.req.requesterUserId !== claimRow.actorId || matchingStarts[0]!.req.requesterUserId !== run.responsibleUserId ||
    matchingStarts[0]!.req.start?.idempotencyKey !== `v7-sandbox-start:${bindingId}:${generation}:${claimVersion}:${policySnapshotId}`)
    throw conflict("Native prelaunch cleanup lost exact current admission owner");
  const originalStart = matchingStarts[0]!;
  const owner: NativeBootstrapPrelaunchCleanupOwner = { version: 1, companyId: input.companyId, runId: input.runId, leaseId: input.leaseId,
    executionInputHash: inputHash, locatorDigest: nativeSha256(locator), attempt: 3, bindingId, cellId, generation, hostId, hostEpoch,
    claimKey, claimVersion, policySnapshotId, policyHash, manifestId, manifestHash, requesterUserId: matchingStarts[0]!.req.requesterUserId!,
    imageDigest: targets[0]!.rep.imageDigest, sandboxId: matchingStarts[0]!.rep.sandboxId!, containerId: matchingStarts[0]!.rep.containerId!,
    prepareCommandId: targets[0]!.command.id, applyCommandId: matchingApplies[0]!.command.id, startCommandId: matchingStarts[0]!.command.id };
  if (expected && nativeSha256(expected) !== nativeSha256(owner)) throw conflict("Native prelaunch cleanup owner changed");
  const hostScopeCommands = await db.select().from(runtimeHostCommands).where(and(
    eq(runtimeHostCommands.companyId, input.companyId), eq(runtimeHostCommands.runtimeHostId, hostId),
    eq(runtimeHostCommands.runtimeCellId, cellId), eq(runtimeHostCommands.cellGeneration, BigInt(generation)),
    eq(runtimeHostCommands.commandType, SANDBOX_HOST_COMMAND)));
  if (hostScopeCommands.length > 256) throw conflict("Native prelaunch cleanup Host command inventory is too large");
  const originalCommandIds = new Set([targets[0]!.command.id, matchingApplies[0]!.command.id, originalStart.command.id]);
  for (const command of hostScopeCommands) {
    if (originalCommandIds.has(command.id)) continue;
    const prelaunchClaim = storedPrelaunch(command.payload);
    if (prelaunchClaim && nativeSha256(prelaunchClaim) === nativeSha256({ version: 1, owner })) {
      const request = parsePrelaunchRequest(command.payload);
      if (request.success && ["stop", "inspect"].includes(request.data.action)) continue;
    }
    if (command.createdAt < targets[0]!.command.createdAt && command.status === "SUCCEEDED" && command.completedAt) continue;
    const request = parsePrelaunchRequest(command.payload);
    if (!request.success || command.status !== "SUCCEEDED" || !command.completedAt ||
        request.data.scope.companyId !== input.companyId || request.data.scope.bindingId !== bindingId ||
        request.data.scope.cellId !== cellId || request.data.scope.cellGeneration !== generation ||
        request.data.scope.sandboxRef !== (binding.sandboxRef ?? `aw-v7-${binding.id}`) || request.data.hostEpoch !== hostEpoch || request.data.imageDigest !== owner.imageDigest ||
        request.data.requesterUserId !== owner.requesterUserId ||
        !["capabilities", "inspect", "effective_policy", "prove_policy"].includes(request.data.action))
      throw conflict("Native prelaunch cleanup found a pending, failed, or mutating Host successor");
    const reply = sandboxHostReplySchema.safeParse(command.safeResult);
    if (!reply.success || reply.data.action !== request.data.action ||
        // Ordinary Inspect omits target IDs. Only expectedTarget attenuates an
        // observation to a container; cleanup below always requires that form.
        (request.data.action === "inspect" && (reply.data.action !== "inspect" ||
          reply.data.generation !== owner.generation ||
          reply.data.imageDigest !== null && reply.data.imageDigest !== owner.imageDigest ||
          request.data.expectedTarget !== undefined &&
            (request.data.expectedTarget.sandboxId !== owner.sandboxId || request.data.expectedTarget.containerId !== owner.containerId ||
              reply.data.sandboxId !== owner.sandboxId || reply.data.containerId !== owner.containerId))) ||
        (request.data.action === "prove_policy" && (request.data.policyProof?.sandboxId !== owner.sandboxId ||
          request.data.policyProof?.containerId !== owner.containerId || reply.data.action !== "prove_policy" ||
          reply.data.target.sandboxId !== owner.sandboxId || reply.data.target.containerId !== owner.containerId)))
      throw conflict("Native prelaunch cleanup read-only Host command escaped its exact target", {
        action: request.data.action,
        replyValid: reply.success,
        replyAction: reply.success ? reply.data.action : null,
        beforeOriginalStart: command.completedAt < originalStart.command.createdAt,
        inspectTargetMatches: reply.success && reply.data.action === "inspect" &&
          reply.data.sandboxId === owner.sandboxId && reply.data.containerId === owner.containerId,
        proofRequestTargetMatches: request.data.action === "prove_policy" &&
          request.data.policyProof?.sandboxId === owner.sandboxId && request.data.policyProof?.containerId === owner.containerId,
        proofReplyTargetMatches: reply.success && reply.data.action === "prove_policy" &&
          reply.data.target.sandboxId === owner.sandboxId && reply.data.target.containerId === owner.containerId,
      });
  }
  const [successorPreparation] = await db.select({ id: runtimeHostCommands.id }).from(runtimeHostCommands).where(and(
    eq(runtimeHostCommands.companyId, input.companyId), eq(runtimeHostCommands.commandType, "sandbox_exec"),
    eq(runtimeHostCommands.runtimeHostId, hostId), eq(runtimeHostCommands.runtimeCellId, cellId),
    eq(runtimeHostCommands.cellGeneration, BigInt(generation)),
    sql`(${runtimeHostCommands.payload}->>'runId' IS DISTINCT FROM ${input.runId} OR ${runtimeHostCommands.payload}->>'leaseId' IS DISTINCT FROM ${input.leaseId})`,
    sql`not coalesce(${runtimeHostCommands.status} = 'SUCCEEDED' and ${runtimeHostCommands.completedAt} <
      (select original.created_at from runtime_host_commands original where original.id = ${targets[0]!.command.id}), false)`,
  )).limit(1);
  const [successorClaim] = await db.select({ id: activityLog.id }).from(activityLog).where(and(
    eq(activityLog.companyId, input.companyId), eq(activityLog.entityType, "runtime_sandbox"),
    eq(activityLog.entityId, bindingId), eq(activityLog.action, "sandbox.admission_claimed"),
    sql`${activityLog.details}->>'generation' = ${generation}`,
    sql`${activityLog.id} <> ${claimRow.id}`,
  )).limit(1);
  if (successorPreparation || successorClaim)
    throw conflict("Native prelaunch cleanup found a successor or recreated Host owner");
  const scope = matchingStarts[0]!.req.scope;
  return { owner, run, lease, locator, execution, binding, cell, host, manifest, policy, scope,
    startRequest: matchingStarts[0]!.req, startReply: matchingStarts[0]!.rep };
}

export async function verifyNativeBootstrapPrelaunchStopReceipt(db: Db, input: { companyId: string; runId: string; leaseId: string }, value: unknown) {
  const receipt = record(value), stopOwner = record(receipt.prelaunchStop);
  const owner = await readNativeBootstrapPrelaunchCleanup(db, input);
  if (receipt.schema !== "paperclip.remote-termination.v1" || receipt.executionKind !== "native_bootstrap_prelaunch" ||
    receipt.companyId !== input.companyId || receipt.runId !== input.runId || receipt.leaseId !== input.leaseId ||
    receipt.provider !== owner.lease.provider || receipt.providerLeaseId !== owner.lease.providerLeaseId || receipt.state !== "stopped" ||
    typeof receipt.confirmedAt !== "string" || !Number.isFinite(Date.parse(receipt.confirmedAt)) ||
    nativeSha256(stopOwner.owner) !== nativeSha256(owner.owner) || nativeSha256(stopOwner.scope) !== nativeSha256(owner.scope))
    throw conflict("Native prelaunch Stop receipt lost its exact Run owner");
  const rows = await db.select().from(runtimeHostCommands).where(and(eq(runtimeHostCommands.companyId, input.companyId),
    eq(runtimeHostCommands.runtimeHostId, owner.owner.hostId), eq(runtimeHostCommands.runtimeCellId, owner.owner.cellId),
    eq(runtimeHostCommands.cellGeneration, BigInt(owner.owner.generation)), eq(runtimeHostCommands.commandType, SANDBOX_HOST_COMMAND),
    eq(runtimeHostCommands.status, "SUCCEEDED"), inArray(runtimeHostCommands.id,
      [String(stopOwner.stopCommandId), String(stopOwner.inspectCommandId)])));
  const stop = rows.find(row => row.id === stopOwner.stopCommandId), inspect = rows.find(row => row.id === stopOwner.inspectCommandId);
  for (const [row, action] of [[stop, "stop"], [inspect, "inspect"]] as const) {
    const request = parsePrelaunchRequest(row?.payload);
    const claim = storedPrelaunch(row?.payload);
    if (!row?.completedAt || !request.success || request.data.action !== action ||
      request.data.hostEpoch !== owner.owner.hostEpoch || request.data.imageDigest !== owner.owner.imageDigest ||
      request.data.requesterUserId !== owner.owner.requesterUserId || nativeSha256(request.data.scope) !== nativeSha256(owner.scope) ||
      request.data.expectedTarget?.sandboxId !== owner.owner.sandboxId || request.data.expectedTarget.containerId !== owner.owner.containerId ||
      !claim || nativeSha256(claim) !== nativeSha256({ version: 1, owner: owner.owner }))
      throw conflict("Native prelaunch Stop receipt is not an exact completed signed command");
  }
  const stopReply = sandboxHostReplySchema.parse(stop!.safeResult), inspectReply = sandboxHostReplySchema.parse(inspect!.safeResult);
  if (inspect!.createdAt < stop!.completedAt! || Date.parse(receipt.confirmedAt) < inspect!.completedAt!.getTime() ||
    stopReply.action !== "stop" || stopReply.stopped !== true || stopReply.sandboxId !== owner.owner.sandboxId ||
    stopReply.containerId !== owner.owner.containerId || inspectReply.action !== "inspect" ||
    inspectReply.sandboxId !== owner.owner.sandboxId || inspectReply.containerId !== owner.owner.containerId ||
    inspectReply.state !== "stopped" || inspectReply.generation !== owner.owner.generation ||
    inspectReply.imageDigest !== owner.owner.imageDigest || inspectReply.policyHash !== owner.owner.policyHash)
    throw conflict("Native prelaunch Stop lacks an independent stopped observation");
  return { ...receipt, prelaunchStop: { owner: owner.owner, scope: owner.scope,
    stopCommandId: stop!.id, inspectCommandId: inspect!.id } };
}

function storedPrelaunch(value: unknown): unknown {
  const payload = record(value);
  return payload.__nativeBootstrapPrelaunchCleanup;
}
function parsePrelaunchRequest(value: unknown) {
  const payload = record(value), copy = { ...payload };
  delete copy.__nativeBootstrapPrelaunchCleanup;
  return sandboxHostRequestSchema.safeParse(copy);
}

export async function verifyNativeBootstrapPrelaunchRuntimeState(db: Db,
  input: { companyId: string; runId: string; leaseId: string }, value: unknown) {
  const physical = await verifyNativeBootstrapPrelaunchStopReceipt(db, input, value);
  const raw = record(value), stop = record(raw.prelaunchStop), operationId = stop.runtimeOperationId;
  if (typeof operationId !== "string") throw conflict("Native prelaunch cleanup has no canonical runtime state receipt");
  const owner = await readNativeBootstrapPrelaunchCleanup(db, input);
  const [operation] = await db.select().from(runtimeOperations).where(and(
    eq(runtimeOperations.companyId, input.companyId), eq(runtimeOperations.id, operationId),
    eq(runtimeOperations.runtimeCellId, owner.owner.cellId), eq(runtimeOperations.operationType, "stop"),
    eq(runtimeOperations.status, "SUCCEEDED"), eq(runtimeOperations.requestedByType, "system"),
    eq(runtimeOperations.requestedById, "native-bootstrap-cleanup")));
  const desired = record(operation?.desiredState), cleanup = record(desired.nativeBootstrapPrelaunchCleanup);
  const [cell] = await db.select().from(runtimeCells).where(and(eq(runtimeCells.companyId, input.companyId),
    eq(runtimeCells.id, owner.owner.cellId), eq(runtimeCells.generation, BigInt(owner.owner.generation)),
    eq(runtimeCells.status, "STOPPED")));
  const [binding] = await db.select().from(runtimeSandboxBindings).where(and(eq(runtimeSandboxBindings.companyId, input.companyId),
    eq(runtimeSandboxBindings.id, owner.owner.bindingId), eq(runtimeSandboxBindings.runtimeCellId, owner.owner.cellId),
    eq(runtimeSandboxBindings.cellGeneration, owner.owner.generation), eq(runtimeSandboxBindings.status, "stopped")));
  const [unrevoked] = await db.select({ id: runtimePolicySnapshots.id }).from(runtimePolicySnapshots).where(and(
    eq(runtimePolicySnapshots.companyId, input.companyId), eq(runtimePolicySnapshots.bindingId, owner.owner.bindingId),
    inArray(runtimePolicySnapshots.status, ["draft", "qualified"]))).limit(1);
  if (!operation?.completedAt || !cell || !binding || unrevoked ||
    desired.sandboxBindingId !== owner.owner.bindingId || desired.generation !== owner.owner.generation ||
    desired.sandboxHostCommandId !== physical.prelaunchStop.stopCommandId || desired.claimKey !== owner.owner.claimKey ||
    desired.policySnapshotId !== owner.owner.policySnapshotId || desired.executionManifestId !== owner.owner.manifestId ||
    desired.executionManifestHash !== owner.owner.manifestHash || desired.policyHash !== owner.owner.policyHash ||
    cleanup.companyId !== input.companyId || cleanup.runId !== input.runId || cleanup.leaseId !== input.leaseId ||
    cleanup.ownerDigest !== nativeSha256(owner.owner) || cleanup.physicalReceiptDigest !== nativeSha256(physical) ||
    nativeSha256(cleanup.physicalReceipt) !== nativeSha256(physical) || cleanup.stopCommandId !== physical.prelaunchStop.stopCommandId ||
    cleanup.inspectCommandId !== physical.prelaunchStop.inspectCommandId)
    throw conflict("Native prelaunch cleanup runtime state is not bound to its actual signed Stop");
  return { ...physical, prelaunchStop: { ...physical.prelaunchStop, runtimeOperationId: operation.id } };
}
