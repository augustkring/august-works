import { hkdfSync, randomUUID } from "node:crypto";
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
import { equalDigest, randomToken, sha256, seal, open as unseal } from "../saas/crypto.js";
import { runtimeHostAuth } from "../runtime/host-auth.js";
import { hostVersionMeetsMinimum } from "../runtime/catalog.js";
import { verifySandboxQualificationCredentialJwt } from "../../agent-auth-jwt.js";
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
type SandboxProvisioningInput = Omit<NonNullable<SandboxHostRequest["provisioning"]>, "idleUntilUnixSeconds" | "requestId" | "provisioningHash">;
function provisioningRequestId(provisioningHash: string) {
  const bytes = Buffer.from(provisioningHash.slice(0, 32), "hex");
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
import { conflict, forbidden } from "../../errors.js";
import type { OpenShellHostBridge } from "./openshell-backend.js";
import type { SandboxIdentity } from "./backend.js";

const SEALED_QUALIFICATION_CREDENTIAL = "__sealedQualificationCredential";
function qualificationCredentialSealKey() {
  const master = process.env.PAPERCLIP_AGENT_JWT_SECRET?.trim() || process.env.BETTER_AUTH_SECRET?.trim();
  if (!master) throw conflict("Qualification credential sealing is unavailable");
  return Buffer.from(hkdfSync("sha256", Buffer.from(master, "utf8"), Buffer.from("paperclip:v10:sandbox-qualification-capability:v1"), Buffer.from("runtime-host-command-at-rest"), 32)).toString("hex");
}
function storedSandboxHostRequest(request: SandboxHostRequest, expectedCommandId?: string): Record<string, unknown> {
  const token = request.probe?.qualificationCredentialCapability;
  if (!token) return request as unknown as Record<string, unknown>;
  const credential = verifySandboxQualificationCredentialJwt(token)?.qualification_credential;
  if (!credential || (expectedCommandId && credential.commandId !== expectedCommandId)) {
    throw conflict("Qualification credential cannot be sealed");
  }
  const sealContext = `sandbox-qualification-capability:v1:${request.scope.companyId}:${request.scope.bindingId}:${credential.commandId}:${request.hostEpoch}`;
  const encrypted = seal({ token, nonce: request.probe?.qualificationCredentialNonce }, qualificationCredentialSealKey(), sealContext);
  const probe = { ...request.probe };
  delete probe.qualificationCredentialCapability;
  delete probe.qualificationCredentialNonce;
  return { ...request, probe, [SEALED_QUALIFICATION_CREDENTIAL]: {
    version: 1, commandId: credential.commandId, tokenSha256: sha256(token),
    nonceSha256: sha256(request.probe?.qualificationCredentialNonce ?? ""), sealed: encrypted,
  } };
}
function storedQualificationCredentialHashes(value: unknown): { commandId: string; tokenSha256: string; nonceSha256: string } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw conflict("Native sandbox command payload is invalid");
  const sealed = (value as Record<string, unknown>)[SEALED_QUALIFICATION_CREDENTIAL];
  if (sealed === undefined) return undefined;
  if (!sealed || typeof sealed !== "object" || Array.isArray(sealed)) throw conflict("Qualification credential envelope is invalid");
  const envelope = sealed as Record<string, unknown>;
  if (envelope.version !== 1 || typeof envelope.commandId !== "string" ||
    typeof envelope.sealed !== "string" || typeof envelope.tokenSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(envelope.tokenSha256) || typeof envelope.nonceSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(envelope.nonceSha256))
    throw conflict("Qualification credential envelope is invalid");
  return { commandId: envelope.commandId, tokenSha256: envelope.tokenSha256, nonceSha256: envelope.nonceSha256 };
}
function requestWithoutQualificationCredential(request: SandboxHostRequest): SandboxHostRequest {
  const copy = structuredClone(request);
  if (copy.probe) {
    delete copy.probe.qualificationCredentialCapability;
    delete copy.probe.qualificationCredentialNonce;
  }
  return copy;
}
function parseStoredSandboxHostRequest(value: unknown, hydrateCredential = false): SandboxHostRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw conflict("Native sandbox command payload is invalid");
  const stored = structuredClone(value) as Record<string, unknown>;
  const sealed = stored[SEALED_QUALIFICATION_CREDENTIAL];
  const hashes = storedQualificationCredentialHashes(stored);
  delete stored[SEALED_QUALIFICATION_CREDENTIAL];
  const parsed = sandboxHostRequestSchema.parse(stored);
  if (sealed === undefined || !hydrateCredential) return parsed;
  if (!hashes || typeof (sealed as Record<string, unknown>).sealed !== "string") throw conflict("Qualification credential envelope is invalid");
  try {
    const context = `sandbox-qualification-capability:v1:${parsed.scope.companyId}:${parsed.scope.bindingId}:${hashes.commandId}:${parsed.hostEpoch}`;
    const credential = unseal<{ token?: unknown; nonce?: unknown }>((sealed as Record<string, unknown>).sealed as string, qualificationCredentialSealKey(), context);
    const claim = typeof credential.token === "string" ? verifySandboxQualificationCredentialJwt(credential.token)?.qualification_credential : null;
    if (!claim || claim.commandId !== hashes.commandId || claim.scope.companyId !== parsed.scope.companyId || claim.scope.bindingId !== parsed.scope.bindingId ||
      credential.nonce !== claim.nonce || !parsed.probe || sha256(credential.token as string) !== hashes.tokenSha256 ||
      sha256(String(credential.nonce ?? "")) !== hashes.nonceSha256) throw new Error("sealed qualification token binding changed");
    return sandboxHostRequestSchema.parse({ ...parsed, probe: { ...parsed.probe,
      qualificationCredentialCapability: credential.token, qualificationCredentialNonce: credential.nonce } });
  } catch {
    throw conflict("Qualification credential envelope cannot be opened");
  }
}

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
    commandId?: string,
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
      (binding.sandboxRef ?? `aw-v7-${binding.id}`) !== request.scope.sandboxRef ||
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
    // Provisioning is a privileged create effect. Recheck the immutable
    // operator claim against the live binding and cell at every queue,
    // worker claim, completion, and receipt read. The initial service check
    // alone cannot close a concurrent admission or cell transition.
    if (request.action === "prepare" && request.provisioning) {
      const setup = request.provisioning;
      const validPurposeState = setup.purpose === "admission"
        ? binding.status === "admitting"
        : ["requested", "ready", "failed"].includes(binding.status);
      if (
        cell.status !== "STOPPED" ||
        binding.version !== setup.bindingVersion ||
        !validPurposeState ||
        Date.parse(setup.expiresAt) <= now.getTime()
      )
        throw conflict("Native sandbox provisioning claim is stale, expired, or outside its stopped purpose state", {
          code: "sandbox_scope_changed",
        });
    }
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
    if (request.probe?.qualificationCredentialCapability) {
      const claims = verifySandboxQualificationCredentialJwt(request.probe.qualificationCredentialCapability);
      const fixture = claims?.qualification_credential;
      if (request.action !== "probe" || !fixture || fixture.commandId !== commandId ||
        fixture.caseId !== request.probe.caseId || fixture.scope.companyId !== request.scope.companyId ||
        fixture.nonce !== request.probe.qualificationCredentialNonce ||
        fixture.scope.bindingId !== request.scope.bindingId || fixture.scope.cellId !== request.scope.cellId ||
        fixture.scope.generation !== request.scope.cellGeneration || fixture.scope.sandboxRef !== request.scope.sandboxRef ||
        fixture.hostEpoch !== request.hostEpoch || fixture.bindingVersion !== binding.version ||
        Date.parse(fixture.expiresAt) <= now.getTime() || cell.status !== "STOPPED" ||
        !["requested", "ready", "failed"].includes(binding.status))
        throw conflict("Qualification credential token is expired or outside its current host probe claim", {
          code: "sandbox_scope_changed",
        });
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
    provisioning?: SandboxProvisioningInput,
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
      action === "apply" ? admission?.expiresAt : action === "start" ? start?.expiresAt : action === "prepare" ? provisioning?.expiresAt : undefined;
    if (
      (action === "apply" || action === "start" || (action === "prepare" && provisioning)) &&
      (!originalExpiry || !Number.isFinite(Date.parse(originalExpiry)) || Date.parse(originalExpiry) <= now.getTime())
    )
      throw conflict("Original execution deadline expired before host admission");
    const qualificationCredential = action === "probe" && probe?.qualificationCredentialCapability
      ? verifySandboxQualificationCredentialJwt(probe.qualificationCredentialCapability)?.qualification_credential
      : undefined;
    if (probe?.qualificationCredentialCapability && (!qualificationCredential ||
      qualificationCredential.commandId !== idempotencyKey || qualificationCredential.caseId !== probe.caseId ||
      qualificationCredential.nonce !== probe.qualificationCredentialNonce ||
      qualificationCredential.scope.companyId !== scope.companyId || qualificationCredential.scope.bindingId !== scope.bindingId ||
      qualificationCredential.scope.cellId !== scope.cellId || qualificationCredential.scope.generation !== scope.cellGeneration ||
      qualificationCredential.scope.sandboxRef !== scope.sandboxRef || Date.parse(qualificationCredential.expiresAt) <= now.getTime()))
      throw conflict("Qualification credential token does not match this probe command");
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
        let request = sandboxHostRequestSchema.parse({
          version: 1,
          scope,
          action,
          ...(probe ? { probe } : {}),
          ...(admission ? { admission } : {}),
          ...(start ? { start } : {}),
          hostEpoch: host.credentialVersion,
          imageDigest: cell.activeImageDigest ?? cell.desiredImageDigest,
          requesterUserId: userId,
          ...(provisioning ? (() => {
            const idleUntilUnixSeconds = Math.floor(Date.parse(provisioning.expiresAt) / 1000);
            const envelope = {
              scope, hostEpoch: host.credentialVersion, imageDigest: cell.activeImageDigest ?? cell.desiredImageDigest,
              purpose: provisioning.purpose, operationKey: provisioning.operationKey, bindingVersion: provisioning.bindingVersion,
              expiresAt: provisioning.expiresAt,
              idleUntilUnixSeconds, policyHash: provisioning.policyHash, document: provisioning.document,
              resourceLimits: provisioning.resourceLimits,
            };
            const provisioningHash = nativeSha256(envelope);
            return { provisioning: { ...provisioning, idleUntilUnixSeconds, provisioningHash,
              requestId: provisioningRequestId(provisioningHash) } };
          })() : {}),
        });
        const key = `v7-openshell:${nativeSha256({ scope, action, idempotencyKey })}`;
        const [existing] = await tx
          .select()
          .from(runtimeHostCommands)
          .where(eq(runtimeHostCommands.idempotencyKey, key));
        if (existing) {
          const previous = parseStoredSandboxHostRequest(existing.payload, false);
          await current(tx, request, host.id, now, existing.id);
          if (action === "prepare" && provisioning && previous.provisioning?.operationKey === provisioning.operationKey) {
            const comparable = (value: SandboxHostRequest) => ({ ...value, provisioning: value.provisioning && {
              ...value.provisioning, expiresAt: null, idleUntilUnixSeconds: null, requestId: null,
              provisioningHash: null,
            } });
            if (nativeSha256(comparable(previous)) !== nativeSha256(comparable(request)) ||
              !previous.provisioning || Date.parse(previous.provisioning.expiresAt) <= now.getTime())
              throw conflict("Sandbox provisioning replay is changed or expired");
            // Keep the exact first persisted deadline and request bytes on
            // retries; never renew the bootstrap helper's absolute expiry.
            request = previous;
          } else {
            const previousHashes = storedQualificationCredentialHashes(existing.payload);
            const incomingCredential = request.probe?.qualificationCredentialCapability;
            const incomingNonce = request.probe?.qualificationCredentialNonce;
            const credentialMatches = previousHashes
              ? !!incomingCredential && !!incomingNonce && sha256(incomingCredential) === previousHashes.tokenSha256 &&
                sha256(incomingNonce) === previousHashes.nonceSha256
              : !incomingCredential && !incomingNonce;
            if (nativeSha256(requestWithoutQualificationCredential(previous)) !==
              nativeSha256(requestWithoutQualificationCredential(request)) || !credentialMatches)
              throw conflict("Sandbox operation key belongs to different immutable inputs");
          }
          await assertOperator(actor, action, tx, scope.companyId, scope.bindingId);
          return existing;
        }
        await current(tx, request, host.id, now, qualificationCredential?.commandId);
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
            ...(qualificationCredential ? { id: qualificationCredential.commandId } : {}),
            runtimeHostId: host.id,
            companyId: scope.companyId,
            runtimeCellId: scope.cellId,
            cellGeneration: BigInt(scope.cellGeneration),
            commandType: SANDBOX_HOST_COMMAND,
            idempotencyKey: key,
            payload: storedSandboxHostRequest(request, qualificationCredential?.commandId),
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
          const storedRequest = parseStoredSandboxHostRequest(record.payload, false);
          await current(
            tx as unknown as Db,
            storedRequest,
            record.runtimeHostId,
            new Date(),
            record.id,
          );
          if (qualificationCredential && Date.parse(qualificationCredential.expiresAt) <= Date.now())
            throw conflict("Qualification credential expired before receipt reconciliation");
          const reply = sandboxHostReplySchema.parse(record.safeResult);
          if (reply.action !== action)
            throw conflict("Native sandbox reply action changed");
          await assertOperator(actor, action, tx as unknown as Db, scope.companyId, scope.bindingId);
          return { commandId: record.id, reply, request: storedRequest };
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
            await current(tx, parseStoredSandboxHostRequest(record.payload), record.runtimeHostId, new Date(), record.id);
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
        prepare: async (scope, provisioning) => {
          const { reply, request } = await invoke(actor, scope, "prepare", undefined, undefined, undefined,
            provisioning?.operationKey ?? randomUUID(), provisioning);
          if (reply.action !== "prepare")
            throw conflict("Native sandbox reply action changed");
          if (provisioning && (reply.provisioningHash !== request.provisioning?.provisioningHash ||
            reply.hostEpoch !== request.hostEpoch || reply.imageDigest !== request.imageDigest ||
            (!reply.requiresRecreate && (!reply.sandboxId || !reply.containerId)) ||
            (reply.requiresRecreate && (provisioning.purpose !== "admission" || reply.sandboxId || reply.containerId)) ||
            reply.bindingVersion !== request.provisioning?.bindingVersion ||
            reply.policyHash !== request.provisioning?.policyHash ||
            !/^[a-f0-9]{64}$/.test(reply.probePolicyHash ?? "") ||
            nativeSha256(reply.resourceLimits ?? null) !== nativeSha256(request.provisioning?.resourceLimits ?? null)))
            throw conflict("OpenShell did not return the exact journaled provisioning target");
          return {
            ...scope,
            backendVersion: reply.backendVersion,
            imageDigest: reply.imageDigest,
            ...(reply.hostEpoch ? { hostEpoch: reply.hostEpoch } : {}),
            ...(reply.sandboxId ? { sandboxId: reply.sandboxId } : {}),
            ...(reply.containerId ? { containerId: reply.containerId } : {}),
            ...(reply.provisioningHash ? { provisioningHash: reply.provisioningHash } : {}),
            ...(reply.bindingVersion ? { bindingVersion: reply.bindingVersion } : {}),
            ...(reply.policyHash ? { policyHash: reply.policyHash } : {}),
            ...(reply.probePolicyHash ? { probePolicyHash: reply.probePolicyHash } : {}),
            ...(reply.resourceLimits ? { resourceLimits: reply.resourceLimits } : {}),
            ...(reply.requiresRecreate ? { requiresRecreate: true } : {}),
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
          const { qualificationCommandId, ...wireTest } = scope.test;
          const commandKey = qualificationCommandId ?? randomUUID();
          const { reply } = await invoke(actor, scope, "probe", wireTest, undefined, undefined, commandKey);
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
        const request = parseStoredSandboxHostRequest(command.payload, false);
        let host;
        try {
          ({ host } = await current(tx, request, hostId, now, command.id));
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
        const hydratedRequest = parseStoredSandboxHostRequest(command.payload, true);
        await current(tx, hydratedRequest, hostId, now, command.id);
        return {
          id: command.id,
          deadlineAt: command.deadlineAt,
          envelope: auth.protectCommand(host, command.id, {
            ...hydratedRequest,
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
        const request = parseStoredSandboxHostRequest(command.payload, false);
        await current(tx, request, hostId, now, command.id);
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
        // The sealed bearer token is opened only while this exact durable
        // command still owns a live CLAIMED lease and current host scope.
        const hydratedRequest = parseStoredSandboxHostRequest(command.payload, true);
        await current(tx, hydratedRequest, hostId, now, command.id);
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
