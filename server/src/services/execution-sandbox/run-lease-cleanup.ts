import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { environmentLeases, heartbeatRuns, runtimeHostCommands, runtimeCells, runtimeSandboxBindings, runtimeHosts, activityLog, runtimeOperations, runtimePolicySnapshots, type Db } from "@paperclipai/db";
import { SANDBOX_HOST_COMMAND, sandboxHostReplySchema, sandboxHostRequestSchema } from "@paperclipai/shared";
import { conflict } from "../../errors.js";
import { readNativeRemoteWorkloadIntent } from "../remote-execution-termination.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { readRemoteRuntimeAssetLocator, readRemoteNativeSessionStartBinding } from "../native-runtime/runtime-asset-retention.js";

/** Private durable cleanup authority. Never included in a Host wire request. */
export type RunLeaseCleanup = {
  companyId: string; runId: string; leaseId: string;
  startCommandId: string; startBindingDigest: string; containerId: string; sandboxId: string;
  intent: Awaited<ReturnType<typeof readNativeRemoteWorkloadIntent>>;
};

export async function readRunLeaseCleanup(db: Db, input: {
  companyId: string; runId: string; leaseId: string;
}, expected?: RunLeaseCleanup) {
  const [run] = await db.select().from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, input.runId),
  ));
  const [lease] = await db.select().from(environmentLeases).where(and(
    eq(environmentLeases.companyId, input.companyId), eq(environmentLeases.id, input.leaseId),
    eq(environmentLeases.heartbeatRunId, input.runId),
  ));
  const locator = run ? await readRemoteRuntimeAssetLocator(db, run) : null;
  const session = locator ? await readRemoteNativeSessionStartBinding(db, locator) : null;
  if (!lease || !locator || !session || locator.environmentLeaseId !== lease.id ||
    locator.provider !== lease.provider || locator.providerLeaseId !== lease.providerLeaseId)
    throw conflict("Sandbox cleanup has no exact original signed run lease");
  const [cell] = await db.select().from(runtimeCells).where(and(
    eq(runtimeCells.companyId, input.companyId), eq(runtimeCells.id, session.cellId),
    eq(runtimeCells.generation, BigInt(session.cellGeneration)), eq(runtimeCells.runtimeHostId, session.hostId),
  ));
  const [binding] = await db.select().from(runtimeSandboxBindings).where(and(
    eq(runtimeSandboxBindings.companyId, input.companyId), eq(runtimeSandboxBindings.id, session.bindingId),
    eq(runtimeSandboxBindings.runtimeCellId, session.cellId), eq(runtimeSandboxBindings.cellGeneration, session.cellGeneration),
  ));
  const [host] = await db.select().from(runtimeHosts).where(eq(runtimeHosts.id, session.hostId));
  if (!cell || cell.deletedAt || !binding || binding.backend !== "openshell" || binding.status === "deleted" ||
    !host || host.credentialVersion !== session.hostEpoch || host.credentialRevokedAt || host.fencedAt || host.retiredAt)
    throw conflict("Sandbox cleanup original Host or generation is no longer current");
  const [start] = await db.select().from(runtimeHostCommands).where(and(
    eq(runtimeHostCommands.companyId, input.companyId), eq(runtimeHostCommands.runtimeHostId, session.hostId),
    eq(runtimeHostCommands.runtimeCellId, session.cellId),
    eq(runtimeHostCommands.cellGeneration, BigInt(session.cellGeneration)),
    eq(runtimeHostCommands.commandType, SANDBOX_HOST_COMMAND),
    sql`${runtimeHostCommands.payload}->'scope'->>'bindingId' = ${session.bindingId}`,
    eq(runtimeHostCommands.status, "SUCCEEDED"), sql`${runtimeHostCommands.payload}->>'action' = 'start'`,
  )).orderBy(desc(runtimeHostCommands.createdAt)).limit(1);
  if (!start || !start.completedAt) throw conflict("Sandbox cleanup has no successful original workload start");
  const request = sandboxHostRequestSchema.parse(start.payload);
  const reply = sandboxHostReplySchema.parse(start.safeResult);
  if (request.action !== "start" || reply.action !== "start" || !reply.containerId ||
    request.hostEpoch !== session.hostEpoch || request.start?.policyHash !== session.policyHash ||
    reply.policyHash !== session.policyHash || reply.imageDigest !== request.imageDigest ||
    request.imageDigest !== (cell.activeImageDigest ?? cell.desiredImageDigest) ||
    request.scope.sandboxRef !== (binding.sandboxRef ?? `aw-v7-${binding.id}`))
    throw conflict("Sandbox cleanup original container was superseded or recreated");
  const [claim] = await db.select().from(activityLog).where(and(
    eq(activityLog.companyId, input.companyId), eq(activityLog.entityType, "runtime_sandbox"),
    eq(activityLog.entityId, session.bindingId), eq(activityLog.action, "sandbox.admission_claimed"),
    sql`${activityLog.details}->>'generation' = ${session.cellGeneration}`,
    sql`${activityLog.details}->>'policySnapshotId' = ${session.policySnapshotId}`,
    sql`${activityLog.details}->>'executionManifestId' = ${session.manifestId}`,
    sql`${activityLog.details}->>'executionManifestHash' = ${session.manifestHash}`,
    sql`${activityLog.details}->>'policyHash' = ${session.policyHash}`,
  )).orderBy(desc(activityLog.createdAt)).limit(1);
  const claimKey = claim?.details?.claimKey;
  const claimVersion = Number(claim?.details?.claimVersion);
  const expectedVersion = Number(claim?.details?.expectedVersion);
  if (typeof claimKey !== "string" || !Number.isSafeInteger(claimVersion) || claimVersion < 1 || !Number.isSafeInteger(expectedVersion) || claimVersion !== expectedVersion + 1 ||
    claimKey !== `v7-sandbox-admission:${session.bindingId}:${session.cellGeneration}:${expectedVersion}:${session.policySnapshotId}` ||
    request.start?.idempotencyKey !== `v7-sandbox-start:${session.bindingId}:${session.cellGeneration}:${claimVersion}:${session.policySnapshotId}`)
    throw conflict("Sandbox cleanup lost its original canonical admission claim");
  const intent = run?.agentId ? await readNativeRemoteWorkloadIntent(db,
    { companyId: input.companyId, runId: input.runId, agentId: run.agentId }) : null;
  // A signed session launch must belong to this exact workload generation.
  const [launch] = await db.select({ id: runtimeHostCommands.id }).from(runtimeHostCommands).where(and(
    eq(runtimeHostCommands.companyId, input.companyId), eq(runtimeHostCommands.commandType, "sandbox_exec"),
    eq(runtimeHostCommands.status, "SUCCEEDED"),
    sql`${runtimeHostCommands.payload}->>'runId' = ${input.runId}`,
    sql`${runtimeHostCommands.payload}->>'leaseId' = ${input.leaseId}`,
    sql`${runtimeHostCommands.payload}->>'nativePreparationPurpose' = 'native_session_start'`,
    sql`${runtimeHostCommands.payload}->'remoteNativeSessionStartBinding' = ${JSON.stringify(session)}::jsonb`,
    sql`${runtimeHostCommands.createdAt} >= (select original.completed_at from runtime_host_commands original where original.id = ${start.id})`,
  )).limit(1);
  const [successor] = await db.select({ id: runtimeHostCommands.id }).from(runtimeHostCommands).where(and(
    eq(runtimeHostCommands.companyId, input.companyId), eq(runtimeHostCommands.commandType, "sandbox_exec"),
    eq(runtimeHostCommands.runtimeCellId, session.cellId),
    eq(runtimeHostCommands.cellGeneration, BigInt(session.cellGeneration)),
    sql`${runtimeHostCommands.payload}->>'bindingId' = ${session.bindingId}`,
    sql`${runtimeHostCommands.payload}->>'runId' IS DISTINCT FROM ${input.runId}`,
    sql`not coalesce(${runtimeHostCommands.status} = 'SUCCEEDED' and ${runtimeHostCommands.completedAt} <
      (select original.created_at from runtime_host_commands original where original.id = ${start.id}), false)`,
  )).limit(1);
  const [recreated] = await db.select({ id: runtimeHostCommands.id }).from(runtimeHostCommands).where(and(
    eq(runtimeHostCommands.companyId, input.companyId), eq(runtimeHostCommands.runtimeCellId, session.cellId),
    eq(runtimeHostCommands.cellGeneration, BigInt(session.cellGeneration)),
    eq(runtimeHostCommands.commandType, SANDBOX_HOST_COMMAND),
    sql`${runtimeHostCommands.payload}->'scope'->>'bindingId' = ${session.bindingId}`,
    sql`${runtimeHostCommands.payload}->>'action' in ('prepare', 'apply', 'start', 'destroy')`,
    sql`${runtimeHostCommands.id} <> ${start.id}`,
    sql`not coalesce(${runtimeHostCommands.status} = 'SUCCEEDED' and ${runtimeHostCommands.completedAt} <
      (select original.created_at from runtime_host_commands original where original.id = ${start.id}), false)`,
  )).limit(1);
  const proof: RunLeaseCleanup = { companyId: input.companyId, runId: input.runId, leaseId: input.leaseId, startCommandId: start.id,
    startBindingDigest: nativeSha256(session), containerId: reply.containerId, sandboxId: reply.sandboxId, intent };
  if (!launch || successor || recreated || (expected && nativeSha256(expected) !== nativeSha256(proof)))
    throw conflict("Sandbox cleanup lost its exclusive original signed workload binding");
  return { proof, lease, session, binding, claimKey, scope: request.scope, startRequest: request, imageDigest: request.imageDigest };
}

/** A caller-supplied object or provider void never proves physical termination. */
export async function verifyRunLeaseCleanupReceipt(db: Db, input: {
  companyId: string; runId: string; leaseId: string;
}, value: unknown) {
  const receipt = value as Record<string, unknown> | null;
  const proof = receipt?.sandboxStop as RunLeaseCleanup & Record<string, unknown> | undefined;
  if (!proof) throw conflict("Sandbox release has no signed physical Stop receipt");
  const original = await readRunLeaseCleanup(db, input, {
    companyId: proof.companyId, runId: proof.runId, leaseId: proof.leaseId,
    startCommandId: proof.startCommandId, startBindingDigest: proof.startBindingDigest,
    containerId: proof.containerId, sandboxId: proof.sandboxId, intent: proof.intent,
  });
  const expectedScope = { ...original.proof, ...original.scope, hostId: original.session.hostId,
    hostEpoch: original.session.hostEpoch, imageDigest: original.imageDigest };
  if (receipt?.schema !== "paperclip.remote-termination.v1" || receipt.companyId !== input.companyId ||
    receipt.runId !== input.runId || receipt.leaseId !== input.leaseId ||
    receipt.provider !== original.lease.provider || receipt.providerLeaseId !== original.lease.providerLeaseId ||
    receipt.state !== "stopped" || typeof receipt.confirmedAt !== "string" ||
    !Number.isFinite(Date.parse(receipt.confirmedAt)) || Date.parse(receipt.confirmedAt) > Date.now() ||
    Object.entries(expectedScope).some(([key, expected]) => !Object.hasOwn(proof, key) || nativeSha256(proof[key]) !== nativeSha256(expected)))
    throw conflict("Sandbox Stop receipt lost its exact run/provider/container binding");
  const rows = await db.select().from(runtimeHostCommands).where(and(
    eq(runtimeHostCommands.companyId, input.companyId), eq(runtimeHostCommands.runtimeHostId, original.session.hostId),
    eq(runtimeHostCommands.runtimeCellId, original.scope.cellId),
    eq(runtimeHostCommands.cellGeneration, BigInt(original.scope.cellGeneration)),
    eq(runtimeHostCommands.commandType, SANDBOX_HOST_COMMAND), eq(runtimeHostCommands.status, "SUCCEEDED"),
    inArray(runtimeHostCommands.id, [String(proof.stopCommandId), String(proof.inspectCommandId)]),
  ));
  const stop = rows.find(row => row.id === proof.stopCommandId);
  const inspect = rows.find(row => row.id === proof.inspectCommandId);
  for (const [row, action] of [[stop, "stop"], [inspect, "inspect"]] as const) {
    const raw = row?.payload as Record<string, unknown> | undefined;
    const request = raw ? { ...raw } : null;
    if (request) delete request.__runLeaseCleanup;
    const parsed = sandboxHostRequestSchema.safeParse(request);
    if (!row?.completedAt || !parsed.success || parsed.data.action !== action ||
      parsed.data.hostEpoch !== original.session.hostEpoch || parsed.data.imageDigest !== original.imageDigest ||
      parsed.data.requesterUserId !== original.startRequest.requesterUserId ||
      parsed.data.expectedTarget?.sandboxId !== original.proof.sandboxId ||
      parsed.data.expectedTarget.containerId !== original.proof.containerId ||
      nativeSha256(parsed.data.scope) !== nativeSha256(original.scope) ||
      nativeSha256(raw?.__runLeaseCleanup) !== nativeSha256(original.proof))
      throw conflict("Sandbox Stop receipt is not an exact completed signed cleanup command");
  }
  const [ordered] = stop && inspect ? await db.select({ id: runtimeHostCommands.id }).from(runtimeHostCommands).where(and(
    eq(runtimeHostCommands.id, inspect.id),
    sql`${runtimeHostCommands.createdAt} >= (select original.completed_at from runtime_host_commands original where original.id = ${stop.id})`,
  )) : [];
  const stopResult = sandboxHostReplySchema.parse(stop!.safeResult);
  const observation = sandboxHostReplySchema.parse(inspect!.safeResult);
  if (!ordered || stopResult.action !== "stop" || stopResult.stopped !== true ||
    stopResult.sandboxId !== original.proof.sandboxId || stopResult.containerId !== original.proof.containerId ||
    observation.action !== "inspect" || observation.sandboxId !== original.proof.sandboxId ||
    observation.containerId !== original.proof.containerId ||
    observation.state !== "stopped" || observation.imageDigest !== original.imageDigest ||
    observation.generation !== original.scope.cellGeneration || observation.policyHash !== original.session.policyHash || !stop!.completedAt ||
    inspect!.createdAt < stop!.completedAt || !inspect!.completedAt ||
    Date.parse(receipt.confirmedAt as string) < inspect!.completedAt.getTime())
    throw conflict("Sandbox Stop has no subsequent independent physical stopped observation");
  return { schema: "paperclip.remote-termination.v1", companyId: input.companyId, runId: input.runId, leaseId: input.leaseId, provider: original.lease.provider,
    providerLeaseId: original.lease.providerLeaseId, state: "stopped", confirmedAt: receipt.confirmedAt,
    sandboxStop: { ...expectedScope, stopCommandId: stop!.id, inspectCommandId: inspect!.id } };
}

/** A physical Stop alone cannot settle the original runtime/billing owner. */
export async function verifyNativeCleanupRuntimeState(db: Db, input: {
  companyId: string; runId: string; leaseId: string;
}, value: unknown) {
  const raw = value as Record<string, unknown> | null;
  const state = raw?.sandboxStop as Record<string, unknown> | undefined;
  if (typeof state?.runtimeOperationId !== "string") throw conflict("Native cleanup has no canonical runtime state receipt");
  const physical = await verifyRunLeaseCleanupReceipt(db, input, value);
  const owner = await readRunLeaseCleanup(db, input);
  const [operation] = await db.select().from(runtimeOperations).where(and(
    eq(runtimeOperations.companyId, input.companyId), eq(runtimeOperations.id, state.runtimeOperationId),
    eq(runtimeOperations.runtimeCellId, owner.scope.cellId), eq(runtimeOperations.operationType, "stop"),
    eq(runtimeOperations.status, "SUCCEEDED"), eq(runtimeOperations.requestedByType, "system"),
    eq(runtimeOperations.requestedById, "native-run-cleanup"),
  ));
  const desired = operation?.desiredState as Record<string, unknown> | undefined;
  const cleanup = desired?.nativeCleanup as Record<string, unknown> | undefined;
  const [cell] = await db.select().from(runtimeCells).where(and(
    eq(runtimeCells.companyId, input.companyId), eq(runtimeCells.id, owner.scope.cellId),
    eq(runtimeCells.generation, BigInt(owner.scope.cellGeneration)), eq(runtimeCells.status, "STOPPED"),
  ));
  const [unrevoked] = await db.select({ id: runtimePolicySnapshots.id }).from(runtimePolicySnapshots).where(and(
    eq(runtimePolicySnapshots.companyId, input.companyId), eq(runtimePolicySnapshots.bindingId, owner.scope.bindingId),
    inArray(runtimePolicySnapshots.status, ["draft", "qualified"]),
  )).limit(1);
  if (!operation?.completedAt || !cell || unrevoked || owner.binding.status !== "stopped" ||
    desired?.sandboxBindingId !== owner.scope.bindingId || desired.generation !== owner.scope.cellGeneration ||
    desired.sandboxHostCommandId !== physical.sandboxStop.stopCommandId || desired.claimKey !== owner.claimKey ||
    desired.policySnapshotId !== owner.session.policySnapshotId || desired.executionManifestId !== owner.session.manifestId ||
    desired.executionManifestHash !== owner.session.manifestHash || desired.policyHash !== owner.session.policyHash ||
    cleanup?.companyId !== input.companyId || cleanup.runId !== input.runId || cleanup.leaseId !== input.leaseId ||
    cleanup.physicalReceiptDigest !== nativeSha256(physical) ||
    cleanup.originalRequesterUserId !== owner.startRequest.requesterUserId)
    throw conflict("Native cleanup runtime state is not bound to its actual signed Stop");
  const current = await readRunLeaseCleanup(db, input, owner.proof);
  if (current.binding.status !== "stopped") throw conflict("Native cleanup runtime state changed before settlement");
  return { ...physical, sandboxStop: { ...physical.sandboxStop, runtimeOperationId: operation.id } };
}
