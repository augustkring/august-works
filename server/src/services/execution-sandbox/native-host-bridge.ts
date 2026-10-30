import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import {
  runtimeCells,
  runtimeHosts,
  runtimeHostCommands,
  runtimeSandboxBindings,
  agentExecutionManifests,
  runtimePolicySnapshots,
  memoryJobs,
  heartbeatRuns,
  type Db,
} from "@paperclipai/db";
import {
  SANDBOX_HOST_COMMAND,
  sandboxCapabilitySnapshotSchema,
  sandboxHostRequestSchema,
  sandboxHostReplySchema,
  sandboxHostCompletionSchema,
  type SandboxHostRequest,
} from "@paperclipai/shared";
import type { AuthorizationActor } from "../authorization.js";
import { assertConfiguredOperatorAuthentication, assertHumanAuthentication } from "../../auth/authenticator-assurance.js";
import {
  assertV7Authorization,
  assertV7Enabled,
  v7HumanActorId,
} from "../v7-authorization.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { logActivity, withV7ActivityTransaction } from "../v7-mutations.js";
import { equalDigest, randomToken, sha256 } from "../saas/crypto.js";
import { runtimeHostAuth } from "../runtime/host-auth.js";
import { hostVersionMeetsMinimum } from "../runtime/catalog.js";
import {
  assertRemoteRuntimeAssetErasureReady,
  isRemoteRuntimeAssetLocator,
  readRemoteNativeSessionStartBinding,
  remoteRuntimeAssetLocatorDigest,
  runtimeAssetJobKey,
  type RemoteRuntimeAssetLocator,
} from "../native-runtime/runtime-asset-retention.js";
import { sandboxProbeCases } from "./backend.js";

export type RemoteRuntimeCleanupAttestation = {
  schema: "paperclip.remote-runtime-cleanup-attestation.v1";
  jobId: string;
  jobKey: string;
  attemptNumber: number;
  executionOwnerId: string;
  locatorDigest: string;
  companyPurgeOperationId: string | null;
  startBindingDigest: string;
  capabilityCommandId: string;
  capabilities: import("@paperclipai/shared").SandboxCapabilitySnapshot;
  probes: Array<{ commandId: string; caseId: string; control: string; contractHash: string;
    verdict: "pass"; observationHash: string; targetQualificationHash: string }>;
  completedAt: string;
  expiresAt: string;
};
import { conflict, forbidden } from "../../errors.js";
import type { OpenShellHostBridge } from "./openshell-backend.js";
import type { SandboxIdentity } from "./backend.js";

const safety = (action: string) =>
  ["stop", "destroy", "revoke_providers"].includes(action);
/** Reuses the native durable host-command lane and host signature/epoch. No
 * browser, Task body or model response can provide a transport or attestation. */
export function nativeSandboxHostTransport(
  db: Db,
  options: {
    suspectSeconds?: number;
    timeoutMs?: number;
    operatorUserIds?: readonly string[];
  } = {},
) {
  const auth = runtimeHostAuth(db);
  const operatorUserIds = options.operatorUserIds ?? [];
  const requireRecent = (action: SandboxHostRequest["action"]) =>
    ["prepare", "apply", "start", "probe", "revoke_providers", "stop", "destroy"].includes(
      action,
    );
  const assertOperator = async (actor: AuthorizationActor, action: SandboxHostRequest["action"], tx?: Db, companyId?: string, bindingId?: string) => {
    if (action === "stop" || action === "revoke_providers") {
      const reader = tx ?? db;
      await assertHumanAuthentication(reader, actor, { requireRecent: true, phishingResistant: false });
      if (companyId) await assertV7Authorization(reader, actor, companyId, "runtime:manage");
      return;
    }
    if ((action === "inspect" || action === "capabilities") && companyId && bindingId) {
      const [binding] = await (tx ?? db).select({ status: runtimeSandboxBindings.status }).from(runtimeSandboxBindings).where(and(
        eq(runtimeSandboxBindings.companyId, companyId), eq(runtimeSandboxBindings.id, bindingId),
      )).limit(1);
      if (["stopping", "quarantined"].includes(binding?.status ?? ""))
        return assertV7Authorization(tx ?? db, actor, companyId, "runtime:manage");
    }
    return assertConfiguredOperatorAuthentication(tx ?? db, actor, operatorUserIds, {
      requireRecent: requireRecent(action),
    });
  };
  async function current(
    tx: Db,
    request: SandboxHostRequest,
    hostId: string,
    now: Date,
  ) {
    const [host] = await tx
      .select()
      .from(runtimeHosts)
      .where(eq(runtimeHosts.id, hostId))
      .for("no key update");
    // Use the native cell before binding lock order used by invalidation.
    const [cell] = await tx
      .select()
      .from(runtimeCells)
      .where(
        and(
          eq(runtimeCells.companyId, request.scope.companyId),
          eq(runtimeCells.id, request.scope.cellId),
        ),
      )
      .for("share");
    const [binding] = await tx
      .select()
      .from(runtimeSandboxBindings)
      .where(
        and(
          eq(runtimeSandboxBindings.companyId, request.scope.companyId),
          eq(runtimeSandboxBindings.id, request.scope.bindingId),
        ),
      )
      .for("share");
    if (
      !cell ||
      cell.deletedAt ||
      cell.runtimeHostId !== hostId ||
      cell.generation.toString() !== request.scope.cellGeneration ||
      (cell.activeImageDigest ?? cell.desiredImageDigest) !==
        request.imageDigest ||
      !binding ||
      binding.runtimeCellId !== cell.id ||
      binding.cellGeneration !== request.scope.cellGeneration ||
      binding.backend !== "openshell" ||
      (["apply", "start"].includes(request.action) && binding.status !== "admitting") ||
      ["deleted"].includes(binding.status) ||
      (!safety(request.action) && binding.status === "quarantined") ||
      !host ||
      host.credentialVersion !== request.hostEpoch ||
      !host.publicKeyPem ||
      !hostVersionMeetsMinimum(host.hostAgentVersion, "6.0.2") ||
      host.credentialRevokedAt ||
      host.fencedAt ||
      host.retiredAt ||
      !["READY", "DRAINING"].includes(host.status) ||
      !host.lastHeartbeatAt ||
      host.lastHeartbeatAt.getTime() <
        now.getTime() - (options.suspectSeconds ?? 90) * 1000
    )
      throw conflict("Native sandbox host scope changed", {
        code: "sandbox_scope_changed",
      });
    const safetyObservation = ["inspect", "capabilities"].includes(request.action) && ["stopping", "quarantined"].includes(binding.status);
    if (request.cleanupAttestation) {
      // Cleanup is a privacy/revocation obligation for a previously admitted
      // exact target. Feature rollback closes new execution but cannot disable
      // this narrowly scoped, job-claimed capabilities/probes/erase path.
      await assertCleanupAttestationCurrent(tx, request, hostId, now);
    } else {
      const requesterUserId = request.requesterUserId;
      if (!requesterUserId) throw conflict("Native sandbox request has no authenticated operator");
      if (!safety(request.action) && !safetyObservation) {
        await assertV7Enabled(tx, "sandbox_abstraction_v7");
        await assertV7Enabled(tx, "openshell_v7");
        const actor: AuthorizationActor = {
          type: "board",
          source: "session",
          userId: requesterUserId,
        };
        await assertV7Authorization(
          tx,
          actor,
          request.scope.companyId,
          "runtime:manage",
        );
      } else if (request.action === "stop" || request.action === "inspect" || request.action === "capabilities" || request.action === "revoke_providers") {
        const actor: AuthorizationActor = {
          type: "board",
          source: "session",
          userId: requesterUserId,
        };
        await assertV7Authorization(tx, actor, request.scope.companyId, "runtime:manage");
      }
    }
    return { cell, binding, host };
  }
  async function assertCleanupAttestationCurrent(
    tx: Db,
    request: SandboxHostRequest,
    hostId: string,
    now: Date,
  ) {
    const proof = request.cleanupAttestation;
    if (!proof || !["capabilities", "probe"].includes(request.action) ||
      request.requesterUserId !== undefined)
      throw conflict("Native cleanup attestation scope is invalid");
    const [job] = await tx.select().from(memoryJobs).where(and(
      eq(memoryJobs.companyId, request.scope.companyId), eq(memoryJobs.id, proof.jobId),
      eq(memoryJobs.jobKey, proof.jobKey), eq(memoryJobs.attemptNumber, proof.attemptNumber),
      eq(memoryJobs.executionOwnerId, proof.executionOwnerId), eq(memoryJobs.status, "running"),
      gt(memoryJobs.leaseExpiresAt, now),
    )).limit(1).for("share");
    const source = job?.sourceRefJson && typeof job.sourceRefJson === "object" && !Array.isArray(job.sourceRefJson)
      ? job.sourceRefJson as Record<string, unknown> : {};
    const rawLocator = source.remoteAssetLocator;
    if (!job || job.operationType !== "retention" || source.kind !== "runtime_asset_erasure" ||
      !isRemoteRuntimeAssetLocator(rawLocator) || rawLocator.companyId !== request.scope.companyId ||
      source.runId !== rawLocator.runId || proof.jobKey !== runtimeAssetJobKey(rawLocator.runId, []) ||
      (source.companyPurgeOperationId ?? null) !== proof.companyPurgeOperationId ||
      remoteRuntimeAssetLocatorDigest(rawLocator) !== proof.locatorDigest)
      throw conflict("Native cleanup attestation has no current exact MemoryJob claim");
    const locator = rawLocator;
    const ready = await assertRemoteRuntimeAssetErasureReady(tx, locator, proof.companyPurgeOperationId ?? undefined);
    const startBinding = await readRemoteNativeSessionStartBinding(tx, locator);
    if (!startBinding || nativeSha256(startBinding) !== proof.startBindingDigest ||
      ready.startBinding.runnerInstanceId !== startBinding.runnerInstanceId ||
      startBinding.hostId !== hostId || startBinding.hostEpoch !== request.hostEpoch ||
      startBinding.cellId !== request.scope.cellId || startBinding.cellGeneration !== request.scope.cellGeneration ||
      startBinding.bindingId !== request.scope.bindingId)
      throw conflict("Native cleanup attestation does not match the signed original session start");
    if (request.action === "probe") {
      const [binding] = await tx.select().from(runtimeSandboxBindings).where(and(
        eq(runtimeSandboxBindings.companyId, locator.companyId), eq(runtimeSandboxBindings.id, startBinding.bindingId),
        eq(runtimeSandboxBindings.runtimeCellId, startBinding.cellId),
        eq(runtimeSandboxBindings.cellGeneration, startBinding.cellGeneration), eq(runtimeSandboxBindings.status, "running"),
      )).limit(1);
      const test = request.probe;
      const canonical = binding ? sandboxProbeCases(binding.boundaryPolicyHash, binding.boundaryPolicy.requiredControls)
        .find(candidate => candidate.caseId === test?.caseId) : undefined;
      if (!canonical || !test || nativeSha256(canonical) !== nativeSha256(test))
        throw conflict("Native cleanup attestation probe is outside the fixed current boundary suite");
    }
    const [run] = await tx.select().from(heartbeatRuns).where(and(
      eq(heartbeatRuns.companyId, locator.companyId), eq(heartbeatRuns.id, locator.runId),
    )).limit(1);
    const [manifest] = run?.agentId ? await tx.select().from(agentExecutionManifests).where(and(
      eq(agentExecutionManifests.companyId, locator.companyId), eq(agentExecutionManifests.id, startBinding.manifestId),
      eq(agentExecutionManifests.runId, locator.runId), eq(agentExecutionManifests.agentId, run.agentId),
    )).limit(1) : [];
    const [policy] = manifest ? await tx.select().from(runtimePolicySnapshots).where(and(
      eq(runtimePolicySnapshots.companyId, locator.companyId), eq(runtimePolicySnapshots.id, startBinding.policySnapshotId),
      eq(runtimePolicySnapshots.bindingId, startBinding.bindingId),
      eq(runtimePolicySnapshots.executionManifestId, manifest.id), eq(runtimePolicySnapshots.status, "qualified"),
    )).limit(1) : [];
    if (!manifest || manifest.hash !== startBinding.manifestHash || !policy || policy.policyHash !== startBinding.policyHash)
      throw conflict("Native cleanup attestation lost its original manifest or policy binding");
  }
  async function invoke(
    actor: AuthorizationActor,
    scope: SandboxIdentity,
    action: SandboxHostRequest["action"],
    probe?: SandboxHostRequest["probe"],
    admission?: SandboxHostRequest["admission"],
    start?: SandboxHostRequest["start"],
    idempotencyKey: string = randomUUID(),
  ) {
    scope = {
      companyId: scope.companyId,
      bindingId: scope.bindingId,
      cellId: scope.cellId,
      cellGeneration: scope.cellGeneration,
      sandboxRef: scope.sandboxRef,
    };
    const userId = v7HumanActorId(actor),
      now = new Date();
    // Fail closed before revealing host/capability state to an unconfigured
    // or weakly authenticated operator.
    await assertOperator(actor, action, undefined, scope.companyId, scope.bindingId);
    const originalExpiry =
      action === "apply" ? admission?.expiresAt : action === "start" ? start?.expiresAt : undefined;
    if (
      (action === "apply" || action === "start") &&
      (!originalExpiry || !Number.isFinite(Date.parse(originalExpiry)) || Date.parse(originalExpiry) <= now.getTime())
    )
      throw conflict("Original execution deadline expired before host admission");
    const commandDeadlineAt = new Date(
      Math.min(
        now.getTime() + Math.min(30000, options.timeoutMs ?? 20000),
        originalExpiry ? Date.parse(originalExpiry) : Number.POSITIVE_INFINITY,
      ),
    );
    const queued = await withV7ActivityTransaction(
      db,
      async (tx, publications) => {
        await assertOperator(actor, action, tx, scope.companyId, scope.bindingId);
        await assertV7Authorization(
          tx,
          actor,
          scope.companyId,
          "runtime:manage",
        );
        const [cell] = await tx
          .select()
          .from(runtimeCells)
          .where(
            and(
              eq(runtimeCells.companyId, scope.companyId),
              eq(runtimeCells.id, scope.cellId),
            ),
          )
          .for("share");
        const [host] = cell?.runtimeHostId
          ? await tx
              .select()
              .from(runtimeHosts)
              .where(eq(runtimeHosts.id, cell.runtimeHostId))
          : [];
        if (!cell || !host)
          throw conflict("An enrolled native host is required");
        const request = sandboxHostRequestSchema.parse({
          version: 1,
          scope,
          action,
          ...(probe ? { probe } : {}),
          ...(admission ? { admission } : {}),
          ...(start ? { start } : {}),
          hostEpoch: host.credentialVersion,
          imageDigest: cell.activeImageDigest ?? cell.desiredImageDigest,
          requesterUserId: userId,
        });
        await current(tx, request, host.id, now);
        const key = `v7-openshell:${nativeSha256({ scope, action, idempotencyKey })}`;
        const [existing] = await tx
          .select()
          .from(runtimeHostCommands)
          .where(eq(runtimeHostCommands.idempotencyKey, key));
        if (existing) {
          if (nativeSha256(existing.payload) !== nativeSha256(request))
            throw conflict(
              "Sandbox operation key belongs to different immutable inputs",
            );
          await assertOperator(actor, action, tx, scope.companyId, scope.bindingId);
          return existing;
        }
        const active = await tx
          .select({ id: runtimeHostCommands.id })
          .from(runtimeHostCommands)
          .where(
            and(
              eq(runtimeHostCommands.runtimeHostId, host.id),
              eq(runtimeHostCommands.commandType, SANDBOX_HOST_COMMAND),
              inArray(runtimeHostCommands.status, ["PENDING", "CLAIMED"]),
              gt(runtimeHostCommands.deadlineAt, now),
            ),
          )
          .limit(100);
        if (active.length >= 100)
          throw conflict("Native sandbox command capacity is occupied");
        const [command] = await tx
          .insert(runtimeHostCommands)
          .values({
            runtimeHostId: host.id,
            companyId: scope.companyId,
            runtimeCellId: scope.cellId,
            cellGeneration: BigInt(scope.cellGeneration),
            commandType: SANDBOX_HOST_COMMAND,
            idempotencyKey: key,
            payload: request,
            deadlineAt: commandDeadlineAt,
          })
          .onConflictDoNothing()
          .returning();
        if (!command)
          throw conflict(
            "Concurrent sandbox request; retry the same operation key",
          );
        await logActivity(
          tx,
          {
            companyId: scope.companyId,
            actorType: "user",
            actorId: userId,
            action: "sandbox.host_command_requested",
            entityType: "runtime_sandbox",
            entityId: scope.bindingId,
            details: {
              commandId: command.id,
              action,
              generation: scope.cellGeneration,
            },
          },
          publications,
        );
        await assertOperator(actor, action, tx, scope.companyId, scope.bindingId);
        return command;
      },
    );
    while (true) {
      const [record] = await db
        .select()
        .from(runtimeHostCommands)
        .where(eq(runtimeHostCommands.id, queued.id));
      if (!record) throw conflict("Native sandbox receipt unavailable");
      if (record.status === "SUCCEEDED") {
        return db.transaction(async (tx) => {
          await assertOperator(actor, action, tx as unknown as Db, scope.companyId, scope.bindingId);
          await current(
            tx as unknown as Db,
            sandboxHostRequestSchema.parse(record.payload),
            record.runtimeHostId,
            new Date(),
          );
          const reply = sandboxHostReplySchema.parse(record.safeResult);
          if (reply.action !== action)
            throw conflict("Native sandbox reply action changed");
          await assertOperator(actor, action, tx as unknown as Db, scope.companyId, scope.bindingId);
          return { commandId: record.id, reply };
        });
      }
      if (
        ["FAILED", "CANCELED", "EXPIRED"].includes(record.status) ||
        record.deadlineAt <= new Date()
      )
        throw conflict("Native sandbox operation requires reconciliation", {
          code: record.errorCode ?? "sandbox_host_unavailable",
          commandId: record.id,
        });
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  async function refreshRemoteRuntimeCleanupAttestation(input: {
    locator: RemoteRuntimeAssetLocator;
    jobId: string;
    jobKey: string;
    companyPurgeOperationId?: string;
  }): Promise<RemoteRuntimeCleanupAttestation> {
    if (!isRemoteRuntimeAssetLocator(input.locator) || !/^[0-9a-f-]{36}$/i.test(input.jobId) ||
      input.jobKey !== runtimeAssetJobKey(input.locator.runId, []))
      throw conflict("Native cleanup attestation locator or job identity is invalid");
    await assertRemoteRuntimeAssetErasureReady(db, input.locator, input.companyPurgeOperationId);
    const [job] = await db.select().from(memoryJobs).where(and(
      eq(memoryJobs.companyId, input.locator.companyId), eq(memoryJobs.id, input.jobId),
      eq(memoryJobs.jobKey, input.jobKey), eq(memoryJobs.status, "running"), gt(memoryJobs.leaseExpiresAt, new Date()),
    )).limit(1);
    const [run] = await db.select().from(heartbeatRuns).where(and(
      eq(heartbeatRuns.companyId, input.locator.companyId), eq(heartbeatRuns.id, input.locator.runId),
    )).limit(1);
    const source = job?.sourceRefJson && typeof job.sourceRefJson === "object" && !Array.isArray(job.sourceRefJson)
      ? job.sourceRefJson as Record<string, unknown> : {};
    const locator = source.remoteAssetLocator;
    const startBinding = await readRemoteNativeSessionStartBinding(db, input.locator);
    if (!job?.executionOwnerId || !startBinding || !run || !isRemoteRuntimeAssetLocator(locator, input.locator) ||
      remoteRuntimeAssetLocatorDigest(locator) !== remoteRuntimeAssetLocatorDigest(input.locator) ||
      (source.companyPurgeOperationId ?? null) !== (input.companyPurgeOperationId ?? null))
      throw conflict("Native cleanup attestation lacks its current claimed job and original signed target");
    const [cell] = await db.select().from(runtimeCells).where(and(
      eq(runtimeCells.companyId, input.locator.companyId), eq(runtimeCells.id, startBinding.cellId),
      eq(runtimeCells.generation, BigInt(startBinding.cellGeneration)), eq(runtimeCells.status, "HEALTHY"),
      isNull(runtimeCells.deletedAt), isNull(runtimeCells.suspendedReason),
    )).limit(1);
    const [host] = cell?.runtimeHostId ? await db.select().from(runtimeHosts).where(and(
      eq(runtimeHosts.id, cell.runtimeHostId), eq(runtimeHosts.id, startBinding.hostId),
      eq(runtimeHosts.credentialVersion, startBinding.hostEpoch), isNull(runtimeHosts.credentialRevokedAt),
      isNull(runtimeHosts.fencedAt), isNull(runtimeHosts.retiredAt), inArray(runtimeHosts.status, ["READY", "DRAINING"]),
      gt(runtimeHosts.lastHeartbeatAt, new Date(Date.now() - (options.suspectSeconds ?? 90) * 1000)),
    )).limit(1) : [];
    const [binding] = cell ? await db.select().from(runtimeSandboxBindings).where(and(
      eq(runtimeSandboxBindings.companyId, input.locator.companyId), eq(runtimeSandboxBindings.id, startBinding.bindingId),
      eq(runtimeSandboxBindings.runtimeCellId, cell.id), eq(runtimeSandboxBindings.cellGeneration, startBinding.cellGeneration),
      eq(runtimeSandboxBindings.status, "running"),
    )).limit(1) : [];
    const imageDigest = cell?.activeImageDigest ?? cell?.desiredImageDigest;
    if (!cell || !host || !binding || binding.backend !== "openshell" || !imageDigest)
      throw conflict("Native cleanup attestation target is no longer current");
    const scope: SandboxIdentity = { companyId: input.locator.companyId, bindingId: binding.id, cellId: cell.id,
      cellGeneration: cell.generation.toString(), sandboxRef: binding.sandboxRef ?? `aw-v7-${binding.id}` };
    const cleanupAttestation = {
      version: 1 as const, jobId: job.id, jobKey: job.jobKey, attemptNumber: job.attemptNumber,
      executionOwnerId: job.executionOwnerId, locatorDigest: remoteRuntimeAssetLocatorDigest(input.locator),
      companyPurgeOperationId: input.companyPurgeOperationId ?? null,
      startBindingDigest: nativeSha256(startBinding),
    };
    const invokeCleanup = async (action: "capabilities" | "probe", probe?: SandboxHostRequest["probe"],
      freshnessDeadlineMs = Number.POSITIVE_INFINITY) => {
      const now = new Date();
      if (action === "probe" && !probe) throw conflict("Native cleanup probe is missing its fixed case");
      const request = sandboxHostRequestSchema.parse({ version: 1, scope, action, ...(probe ? { probe } : {}),
        cleanupAttestation, hostEpoch: host.credentialVersion, imageDigest });
      const deadlineAt = new Date(Math.min(now.getTime() + Math.min(30000, options.timeoutMs ?? 20000),
        now.getTime() + 60_000, freshnessDeadlineMs));
      if (deadlineAt <= now) throw conflict("Native cleanup attestation expired before command admission");
      const idempotencyKey = `paperclip-cleanup-attestation:v1:${nativeSha256({ cleanupAttestation, action, probe: probe ?? null })}`;
      const key = `v7-openshell:${nativeSha256({ scope, action, idempotencyKey })}`;
      const queued = await db.transaction(async transaction => {
        const tx = transaction as unknown as Db;
        const currentScope = await current(tx, request, host.id, now);
        if (currentScope.cell.generation !== cell.generation || currentScope.binding.id !== binding.id ||
          currentScope.host.credentialVersion !== host.credentialVersion ||
          (currentScope.cell.activeImageDigest ?? currentScope.cell.desiredImageDigest) !== imageDigest)
          throw conflict("Native cleanup attestation target changed before command admission");
        const [existing] = await tx.select().from(runtimeHostCommands).where(eq(runtimeHostCommands.idempotencyKey, key)).limit(1);
        if (existing) {
          if (nativeSha256(existing.payload) !== nativeSha256(request))
            throw conflict("Native cleanup attestation command key was reused with different inputs");
          return existing;
        }
        const [command] = await tx.insert(runtimeHostCommands).values({ runtimeHostId: host.id,
          companyId: input.locator.companyId, runtimeCellId: cell.id, cellGeneration: cell.generation,
          commandType: SANDBOX_HOST_COMMAND, idempotencyKey: key, payload: request, deadlineAt }).returning();
        if (!command) throw conflict("Native cleanup attestation command could not be persisted");
        return command;
      });
      while (true) {
        const [record] = await db.select().from(runtimeHostCommands).where(eq(runtimeHostCommands.id, queued.id)).limit(1);
        if (!record) throw conflict("Native cleanup attestation receipt is unavailable");
        if (record.status === "SUCCEEDED") {
          return db.transaction(async transaction => {
            const tx = transaction as unknown as Db;
            await current(tx, sandboxHostRequestSchema.parse(record.payload), record.runtimeHostId, new Date());
            const reply = sandboxHostReplySchema.parse(record.safeResult);
            if (reply.action !== action) throw conflict("Native cleanup attestation action changed");
            return { commandId: record.id, reply };
          });
        }
        if (["FAILED", "CANCELED", "EXPIRED"].includes(record.status) || record.deadlineAt <= new Date())
          throw conflict("Native cleanup attestation requires host reconciliation", {
            code: record.errorCode ?? "sandbox_host_unavailable", commandId: record.id,
          });
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    };
    const capabilityResult = await invokeCleanup("capabilities");
    if (capabilityResult.reply.action !== "capabilities" || !capabilityResult.reply.capabilities)
      throw conflict("Native cleanup attestation did not receive a protected host report");
    const capabilities = sandboxCapabilitySnapshotSchema.parse(capabilityResult.reply.capabilities);
    const now = new Date();
    const expiresAtMs = Date.parse(capabilities.expiresAt);
    if (capabilities.evidenceKind !== "protected_host_report" || capabilities.backend !== "openshell" ||
      capabilities.sandboxImageDigest !== imageDigest || Date.parse(capabilities.testedAt) > now.getTime() ||
      expiresAtMs <= now.getTime() || expiresAtMs <= Date.parse(capabilities.testedAt))
      throw conflict("Native cleanup protected host report is stale or outside its current target");
    const attestationDeadlineMs = Math.min(expiresAtMs, Date.now() + 60_000);
    const probeCases = sandboxProbeCases(binding.boundaryPolicyHash, binding.boundaryPolicy.requiredControls);
    if (!probeCases.length || binding.boundaryPolicy.requiredControls.some(control =>
      !capabilities[control as keyof typeof capabilities]))
      throw conflict("Native cleanup protected report does not declare every required boundary control");
    const probeReceipts: RemoteRuntimeCleanupAttestation["probes"] = [];
    for (const test of probeCases) {
      if (Date.now() >= attestationDeadlineMs) throw conflict("Native cleanup attestation deadline elapsed before fixed boundary probes completed");
      const result = await invokeCleanup("probe", test, attestationDeadlineMs);
      if (result.reply.action !== "probe" || result.reply.verdict !== "pass" ||
        result.reply.contractHash !== test.contractHash || !/^[a-f0-9]{64}$/.test(result.reply.observationHash ?? ""))
        throw conflict("Native cleanup fixed boundary probe did not pass");
      if (result.reply.targetQualificationHash !== capabilities.qualificationHash)
        throw conflict("Native cleanup boundary probe observed a different sandbox, container, or policy generation");
      probeReceipts.push({ commandId: result.commandId, caseId: test.caseId, control: test.control,
        contractHash: test.contractHash, verdict: "pass", observationHash: result.reply.observationHash!,
        targetQualificationHash: result.reply.targetQualificationHash! });
    }
    const finalExpiry = attestationDeadlineMs;
    if (Date.now() >= finalExpiry) throw conflict("Native cleanup attestation expired before completion");
    await assertRemoteRuntimeAssetErasureReady(db, input.locator, input.companyPurgeOperationId);
    return {
      schema: "paperclip.remote-runtime-cleanup-attestation.v1",
      jobId: job.id, jobKey: job.jobKey, attemptNumber: job.attemptNumber, executionOwnerId: job.executionOwnerId,
      locatorDigest: remoteRuntimeAssetLocatorDigest(input.locator),
      companyPurgeOperationId: input.companyPurgeOperationId ?? null,
      startBindingDigest: nativeSha256(startBinding), capabilityCommandId: capabilityResult.commandId,
      capabilities, probes: probeReceipts, completedAt: new Date().toISOString(), expiresAt: new Date(finalExpiry).toISOString(),
    };
  }
  return {
    refreshRemoteRuntimeCleanupAttestation,
    bridge(actor: AuthorizationActor): OpenShellHostBridge {
      return {
        capabilities: async (scope) => {
          const { reply } = await invoke(actor, scope, "capabilities");
          if (reply.action !== "capabilities")
            throw conflict("Native sandbox reply action changed");
          return reply.capabilities;
        },
        prepare: async (scope) => {
          const { reply } = await invoke(actor, scope, "prepare");
          if (reply.action !== "prepare")
            throw conflict("Native sandbox reply action changed");
          return {
            ...scope,
            backendVersion: reply.backendVersion,
            imageDigest: reply.imageDigest,
          };
        },
        inspect: async (scope) => {
          const { reply } = await invoke(actor, scope, "inspect");
          if (reply.action !== "inspect")
            throw conflict("Native sandbox reply action changed");
          const { action: _, ...observation } = reply;
          return observation;
        },
        effectivePolicy: async (scope) => {
          const { reply } = await invoke(actor, scope, "effective_policy");
          if (reply.action !== "effective_policy")
            throw conflict("Native sandbox reply action changed");
          return reply.document;
        },
        apply: async (input) => {
          const { reply } = await invoke(
            actor,
            input,
            "apply",
            undefined,
            {
              policyHash: input.policyHash,
              expiresAt: input.expiresAt,
              idempotencyKey: input.idempotencyKey,
              document: input.document,
              resourceLimits: input.resourceLimits,
              ...(input.credentialProviderProfile ? { credentialProviderProfile: input.credentialProviderProfile } : {}),
            },
            undefined,
            input.idempotencyKey,
          );
          if (reply.action !== "apply")
            throw conflict("Native sandbox reply action changed");
          return {
            applied: reply.applied,
            policyHash: reply.policyHash,
            requiresRecreate: reply.requiresRecreate,
          };
        },
        start: async (input) => {
          const { reply, commandId } = await invoke(
            actor,
            input,
            "start",
            undefined,
            undefined,
            {
              policyHash: input.policyHash,
              expiresAt: input.expiresAt,
              idempotencyKey: input.idempotencyKey,
            },
            input.idempotencyKey,
          );
          if (reply.action !== "start")
            throw conflict("Native sandbox reply action changed");
          return { operationId: commandId };
        },
        revokeProviders: async (scope) => {
          await invoke(actor, scope, "revoke_providers");
        },
        stop: async (scope) => ({
          operationId: (
            await invoke(actor, scope, "stop", undefined, undefined, undefined, scope.idempotencyKey)
          ).commandId,
        }),
        destroy: async (scope) => ({
          operationId: (
            await invoke(
              actor,
              scope,
              "destroy",
              undefined,
              undefined,
              undefined,
              scope.idempotencyKey,
            )
          ).commandId,
        }),
        probe: async (scope) => {
          const { reply } = await invoke(actor, scope, "probe", scope.test);
          if (reply.action !== "probe")
            throw conflict("Native sandbox reply action changed");
          if (reply.contractHash !== scope.test.contractHash)
            throw conflict("Native sandbox probe contract changed");
          return {
            verdict: reply.verdict,
            observationHash: reply.observationHash,
            contractHash: reply.contractHash,
            targetQualificationHash: reply.targetQualificationHash,
          };
        },
      };
    },
    async claim(hostId: string, now = new Date()) {
      return db.transaction(async (transaction) => {
        const tx = transaction as unknown as Db;
        const [command] = await tx
          .select()
          .from(runtimeHostCommands)
          .where(
            and(
              eq(runtimeHostCommands.runtimeHostId, hostId),
              eq(runtimeHostCommands.commandType, SANDBOX_HOST_COMMAND),
              or(
                eq(runtimeHostCommands.status, "PENDING"),
                and(
                  eq(runtimeHostCommands.status, "CLAIMED"),
                  lte(runtimeHostCommands.leaseUntil, now),
                ),
              ),
              gt(runtimeHostCommands.deadlineAt, now),
              lt(runtimeHostCommands.attempt, 3),
            ),
          )
          .orderBy(runtimeHostCommands.createdAt)
          .limit(1)
          .for("update", { skipLocked: true });
        if (!command) return null;
        const request = sandboxHostRequestSchema.parse(command.payload);
        let host;
        try {
          ({ host } = await current(tx, request, hostId, now));
        } catch {
          await tx
            .update(runtimeHostCommands)
            .set({
              status: "CANCELED",
              errorCode: "sandbox_scope_changed",
              completedAt: now,
            })
            .where(eq(runtimeHostCommands.id, command.id));
          return null;
        }
        const claimToken = randomToken();
        await tx
          .update(runtimeHostCommands)
          .set({
            status: "CLAIMED",
            claimTokenHash: sha256(claimToken),
            attempt: command.attempt + 1,
            leaseUntil: new Date(
              Math.min(command.deadlineAt.getTime(), now.getTime() + 15000),
            ),
          })
          .where(eq(runtimeHostCommands.id, command.id));
        return {
          id: command.id,
          deadlineAt: command.deadlineAt,
          envelope: auth.protectCommand(host, command.id, {
            ...request,
            claimToken,
          }),
        };
      });
    },
    async complete(
      hostId: string,
      commandId: string,
      raw: unknown,
      now = new Date(),
    ) {
      const input = sandboxHostCompletionSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        const [command] = await tx
          .select()
          .from(runtimeHostCommands)
          .where(
            and(
              eq(runtimeHostCommands.id, commandId),
              eq(runtimeHostCommands.runtimeHostId, hostId),
              eq(runtimeHostCommands.commandType, SANDBOX_HOST_COMMAND),
            ),
          )
          .for("update");
        if (
          !command ||
          !command.claimTokenHash ||
          !equalDigest(command.claimTokenHash, sha256(input.claimToken)) ||
          command.cellGeneration?.toString() !== input.generation
        )
          throw forbidden("Native sandbox claim mismatch");
        const request = sandboxHostRequestSchema.parse(command.payload);
        await current(tx, request, hostId, now);
        if (input.reply && input.reply.action !== request.action)
          throw forbidden("Native sandbox action mismatch");
        if (["SUCCEEDED", "FAILED"].includes(command.status)) {
          if (
            nativeSha256(command.safeResult) !== nativeSha256(input.reply) ||
            command.errorCode !== input.errorCode
          )
            throw conflict("Native sandbox receipt is immutable");
          return { recorded: true };
        }
        if (
          command.status !== "CLAIMED" ||
          command.deadlineAt <= now ||
          !command.leaseUntil ||
          command.leaseUntil <= now
        )
          throw conflict("Native sandbox lease expired");
        await tx
          .update(runtimeHostCommands)
          .set({
            status: input.success ? "SUCCEEDED" : "FAILED",
            safeResult: input.reply,
            errorCode: input.errorCode,
            completedAt: now,
            leaseUntil: null,
          })
          .where(eq(runtimeHostCommands.id, command.id));
        await logActivity(
          tx,
          {
            companyId: request.scope.companyId,
            actorType: "system",
            actorId: `runtime-host:${hostId}`,
            action: "sandbox.host_command_recorded",
            entityType: "runtime_sandbox",
            entityId: request.scope.bindingId,
            details: {
              commandId,
              action: request.action,
              generation: input.generation,
              success: input.success,
              errorCode: input.errorCode,
            },
          },
          publications,
        );
        return { recorded: true };
      });
    },
    async reconcile(now = new Date()) {
      const rows = await db
        .update(runtimeHostCommands)
        .set({
          status: "EXPIRED",
          errorCode: "sandbox_host_unavailable",
          completedAt: now,
        })
        .where(
          and(
            eq(runtimeHostCommands.commandType, SANDBOX_HOST_COMMAND),
            inArray(runtimeHostCommands.status, ["PENDING", "CLAIMED"]),
            or(
              lte(runtimeHostCommands.deadlineAt, now),
              and(
                sql`${runtimeHostCommands.attempt} >= 3`,
                lte(runtimeHostCommands.leaseUntil, now),
              ),
            ),
          ),
        )
        .returning({ id: runtimeHostCommands.id });
      return rows.length;
    },
  };
}
