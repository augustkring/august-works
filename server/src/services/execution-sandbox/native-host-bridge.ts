import path from "node:path";
import { hkdfSync, randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import {
  runtimeCells,
  runtimeHosts,
  runtimeHostCommands,
  runtimeSandboxBindings,
  activityLog,
  agents,
  agentPresenceRuntimeBindings,
  agentProviderBindings,
  agentExecutionManifests,
  runtimePolicySnapshots,
  environmentLeases,
  memoryJobs,
  heartbeatRuns,
  issues,
  orchestrationPlans,
  orchestrationWorkerAttempts,
  type Db,
} from "@paperclipai/db";
import {
  SANDBOX_HOST_COMMAND, SANDBOX_CONTROLS,
  NATIVE_RUNTIME_CLEANUP_PURPOSE, NATIVE_RUNTIME_CLEANUP_PROFILE,
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
import { assertNativeOpenCodeConformanceWorkspaceRootReceipt } from "../native-runtime/native-workspace-sync.js";
import { resolvePaperclipRunnerProviderProfile } from "../native-runtime/provider-profile.js";

/** Server-minted exact-run authority for the private Native conformance
 * admission lane. It is never accepted from an HTTP request or Host reply. */
export type NativeOpenCodeConformanceHostAuthority = Readonly<{
  runId: string; taskId: string; planId: string; groupId: string; manifestId: string; manifestHash: string;
  leaseId: string; workspaceRoot: string; creationReceipt: string; policySnapshotId: string; policyHash: string;
}>;
import {
  assertRemoteRuntimeAssetErasureReady,
  assertRemoteRuntimeAssetErasureClaimCurrent,
  isRemoteRuntimeAssetLocator,
  readRemoteNativeSessionStartBinding,
  remoteRuntimeAssetLocatorDigest,
  runtimeAssetJobKey,
  type RemoteRuntimeAssetLocator,
} from "../native-runtime/runtime-asset-retention.js";
import { nativeRuntimeCleanupProbeCases, SANDBOX_QUALIFICATION_BINDING_STATES, type SandboxAdmissionCleanup } from "./backend.js";
import { readRunLeaseCleanup, verifyRunLeaseCleanupReceipt, verifyNativeCleanupRuntimeState, type RunLeaseCleanup } from "./run-lease-cleanup.js";
import { assertNativeBootstrapPrelaunchStopClaim, readNativeBootstrapPrelaunchCleanup,
  type NativeBootstrapPrelaunchCleanupOwner } from "./native-prelaunch-cleanup.js";
import { fenceSandboxAdmissionOutcome } from "./sandbox-guardian.js";
const RUN_LEASE_CLEANUP = "__runLeaseCleanup";
const NATIVE_BOOTSTRAP_PRELAUNCH_CLEANUP = "__nativeBootstrapPrelaunchCleanup";
const STOPPED_NATIVE_ERASURE = "__stoppedNativeErasure";
const NATIVE_CONFORMANCE_ADMISSION_CLEANUP = "__nativeConformanceAdmissionCleanup";
const NATIVE_CONFORMANCE_POLICY_PROOF = "__nativeConformancePolicyProof";
type NativeBootstrapPrelaunchCleanupClaim = Readonly<{ version: 1; owner: NativeBootstrapPrelaunchCleanupOwner }>;
function storedNativeBootstrapPrelaunchCleanup(value: unknown): NativeBootstrapPrelaunchCleanupClaim | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw conflict("Native sandbox command payload is invalid");
  const claim = (value as Record<string, unknown>)[NATIVE_BOOTSTRAP_PRELAUNCH_CLEANUP];
  if (claim === undefined) return undefined;
  if (!claim || typeof claim !== "object" || Array.isArray(claim)) throw conflict("Native prelaunch cleanup claim is invalid");
  const row = claim as Record<string, unknown>;
  if (row.version !== 1 || !row.owner || typeof row.owner !== "object" || Array.isArray(row.owner))
    throw conflict("Native prelaunch cleanup claim is invalid");
  return structuredClone(row) as unknown as NativeBootstrapPrelaunchCleanupClaim;
}

type NativeConformanceAdmissionCleanupClaim = Readonly<{
  version: 1;
  conformance: NativeOpenCodeConformanceHostAuthority;
  cleanup: SandboxAdmissionCleanup;
  idempotencyKey: string;
}>;
type NativeConformancePolicyProofClaim = Readonly<{
  version: 1;
  conformance: NativeOpenCodeConformanceHostAuthority;
  requesterSessionId: string;
  verifiedCredentialExpiresAtMs: number;
}>;
export type StoppedNativeErasureClaim = {
  locatorDigest: string; jobId: string; jobKey: string; jobAttemptNumber: number;
  executionOwnerId: string; companyPurgeOperationId: string | null;
  stopReceiptDigest: string; descriptorDigest: string;
};
import { executionSandboxService, sandboxCapabilityFacts } from "./sandbox-service.js";
import { deriveNativeConformanceProofMaximum, projectOpenShellPolicy } from "./openshell-policy.js";
import { REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_PROFILE_HASH, nativeRuntimeErasurePolicyIsolated } from "../native-runtime/remote-runner-identity.js";

export type RemoteRuntimeCleanupAttestation = {
  schema: "paperclip.remote-runtime-cleanup-attestation.v2";
  purpose: typeof NATIVE_RUNTIME_CLEANUP_PURPOSE;
  executionProfile: typeof NATIVE_RUNTIME_CLEANUP_PROFILE;
  executionProfileHash: string;
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
function storedNativeConformanceAdmissionCleanup(value: unknown): NativeConformanceAdmissionCleanupClaim | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw conflict("Native sandbox command payload is invalid");
  const claim = (value as Record<string, unknown>)[NATIVE_CONFORMANCE_ADMISSION_CLEANUP];
  if (claim === undefined) return undefined;
  if (!claim || typeof claim !== "object" || Array.isArray(claim)) throw conflict("Admission cleanup claim is invalid");
  const row = claim as Record<string, unknown>;
  if (row.version !== 1 || !row.conformance || typeof row.conformance !== "object" || Array.isArray(row.conformance) ||
      !row.cleanup || typeof row.cleanup !== "object" || Array.isArray(row.cleanup) ||
      typeof row.idempotencyKey !== "string" || row.idempotencyKey.length < 1 || row.idempotencyKey.length > 300)
    throw conflict("Admission cleanup claim is invalid");
  return structuredClone(row) as unknown as NativeConformanceAdmissionCleanupClaim;
}
function storedNativeConformancePolicyProof(value: unknown): NativeConformancePolicyProofClaim | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw conflict("Native sandbox command payload is invalid");
  const claim = (value as Record<string, unknown>)[NATIVE_CONFORMANCE_POLICY_PROOF];
  if (claim === undefined) return undefined;
  if (!claim || typeof claim !== "object" || Array.isArray(claim)) throw conflict("Conformance policy proof claim is invalid");
  const row = claim as Record<string, unknown>, authority = row.conformance;
  const expected = ["conformance", "requesterSessionId", "verifiedCredentialExpiresAtMs", "version"].join(",");
  const authorityKeys = ["creationReceipt", "groupId", "leaseId", "manifestHash", "manifestId", "planId", "policyHash",
    "policySnapshotId", "runId", "taskId", "workspaceRoot"].sort().join(",");
  if (Object.keys(row).sort().join(",") !== expected || row.version !== 1 || !authority || typeof authority !== "object" || Array.isArray(authority) ||
      typeof row.requesterSessionId !== "string" || row.requesterSessionId.length < 1 || row.requesterSessionId.length > 200 ||
      /[\r\n\0]/.test(row.requesterSessionId) ||
      typeof row.verifiedCredentialExpiresAtMs !== "number" || !Number.isSafeInteger(row.verifiedCredentialExpiresAtMs) ||
      row.verifiedCredentialExpiresAtMs <= 0)
    throw conflict("Conformance policy proof claim is invalid");
  const input = authority as Record<string, unknown>;
  if (Object.keys(input).sort().join(",") !== authorityKeys || Object.values(input).some(value => typeof value !== "string") ||
      !/^[a-f0-9]{64}$/.test(String(input.creationReceipt)) || !/^[a-f0-9]{64}$/.test(String(input.manifestHash)) ||
      !/^[a-f0-9]{64}$/.test(String(input.policyHash)) || !/^[0-9a-f-]{36}$/i.test(String(input.policySnapshotId)) ||
      !path.isAbsolute(String(input.workspaceRoot)) || path.resolve(String(input.workspaceRoot)) !== input.workspaceRoot)
    throw conflict("Conformance policy proof authority is invalid");
  return structuredClone(row) as unknown as NativeConformancePolicyProofClaim;
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
  delete stored[RUN_LEASE_CLEANUP];
  delete stored[STOPPED_NATIVE_ERASURE];
  delete stored[NATIVE_CONFORMANCE_ADMISSION_CLEANUP];
  delete stored[NATIVE_CONFORMANCE_POLICY_PROOF];
  delete stored[NATIVE_BOOTSTRAP_PRELAUNCH_CLEANUP];
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
    ["prepare", "apply", "start", "prove_policy", "probe", "revoke_providers", "stop", "destroy"].includes(
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
    cleanup?: RunLeaseCleanup,
    erasure?: StoppedNativeErasureClaim,
    nativeAdmissionCleanup?: NativeConformanceAdmissionCleanupClaim,
    nativeConformanceProof?: NativeConformancePolicyProofClaim,
    nativePrelaunchCleanup?: NativeBootstrapPrelaunchCleanupClaim,
  ) {
    let conformanceProofOwner: { sourceAuthorityHash: string; runId: string; taskId: string; manifestId: string;
      manifestHash: string; leaseId: string; workspaceRoot: string } | null = null;
    if (request.action === "prove_policy" && nativeConformanceProof) {
      if (!request.requesterUserId) throw forbidden("A Human requester is required for conformance policy proof");
      if (!Number.isSafeInteger(nativeConformanceProof.verifiedCredentialExpiresAtMs))
        throw forbidden("The retained Human authentication proof is invalid");
      const conformanceActor: AuthorizationActor = { type: "board", source: "session", userId: request.requesterUserId,
        sessionId: nativeConformanceProof.requesterSessionId,
        authenticatedCredentialExpiresAt: nativeConformanceProof.verifiedCredentialExpiresAtMs };
      conformanceProofOwner = await executionSandboxService(tx).assertNativeConformanceProofOwner(
        tx, conformanceActor, request.scope.companyId, nativeConformanceProof.conformance);
    }
    if (erasure) await stoppedErasureCurrent(tx, request, hostId, erasure);
    if (nativeAdmissionCleanup) {
      const { cleanup: original, conformance, idempotencyKey } = nativeAdmissionCleanup;
      const cleanupActor: AuthorizationActor = { type: "board", source: "session", userId: original.requesterUserId };
      if (cleanup || erasure || request.requesterUserId !== original.requesterUserId)
        throw conflict("Native conformance cleanup owner changed");
      await assertNativeConformanceAdmissionCleanup(tx, cleanupActor, request.scope, conformance, original,
        request.action, idempotencyKey, request.expectedTarget);
      if (commandId) {
        const [command] = await tx.select({ idempotencyKey: runtimeHostCommands.idempotencyKey, payload: runtimeHostCommands.payload })
          .from(runtimeHostCommands).where(eq(runtimeHostCommands.id, commandId)).limit(1);
        const expectedStoredKey = `v7-openshell:${nativeSha256({ scope: request.scope, action: request.action, idempotencyKey })}`;
        const persistedClaim = storedNativeConformanceAdmissionCleanup(command?.payload);
        if (!command || command.idempotencyKey !== expectedStoredKey || !persistedClaim ||
            nativeSha256(persistedClaim) !== nativeSha256(nativeAdmissionCleanup))
          throw conflict("Native conformance cleanup command lost its immutable server claim");
      }
    }
    let prelaunchScope: Awaited<ReturnType<typeof readNativeBootstrapPrelaunchCleanup>> | null = null;
    if (nativePrelaunchCleanup) {
      if (cleanup || erasure || nativeAdmissionCleanup || nativeConformanceProof ||
          !["stop", "inspect"].includes(request.action) ||
          request.requesterUserId !== nativePrelaunchCleanup.owner.requesterUserId)
        throw conflict("Native prelaunch cleanup owner changed");
      prelaunchScope = await readNativeBootstrapPrelaunchCleanup(tx, {
        companyId: nativePrelaunchCleanup.owner.companyId, runId: nativePrelaunchCleanup.owner.runId,
        leaseId: nativePrelaunchCleanup.owner.leaseId,
      }, nativePrelaunchCleanup.owner);
      await assertNativeBootstrapPrelaunchStopClaim(tx, prelaunchScope.owner);
      if (nativeSha256(request.scope) !== nativeSha256(prelaunchScope.scope) ||
          request.hostEpoch !== nativePrelaunchCleanup.owner.hostEpoch ||
          request.imageDigest !== nativePrelaunchCleanup.owner.imageDigest ||
          request.expectedTarget?.sandboxId !== nativePrelaunchCleanup.owner.sandboxId ||
          request.expectedTarget.containerId !== nativePrelaunchCleanup.owner.containerId)
        throw conflict("Native prelaunch Stop escaped the exact original setup target");
      if (commandId) {
        const [command] = await tx.select({ idempotencyKey: runtimeHostCommands.idempotencyKey, payload: runtimeHostCommands.payload })
          .from(runtimeHostCommands).where(eq(runtimeHostCommands.id, commandId)).limit(1);
        const persisted = storedNativeBootstrapPrelaunchCleanup(command?.payload);
        if (!command || !persisted || nativeSha256(persisted) !== nativeSha256(nativePrelaunchCleanup))
          throw conflict("Native prelaunch cleanup command lost its immutable owner");
      }
    }
    const cleanupScope = cleanup ? await readRunLeaseCleanup(tx, cleanup, cleanup) : null;
    if (cleanupScope && (!["stop", "inspect"].includes(request.action) || request.requesterUserId !== cleanupScope.startRequest.requesterUserId ||
      nativeSha256(cleanupScope.scope) !== nativeSha256(request.scope) ||
      cleanupScope.session.hostId !== hostId || cleanupScope.session.hostEpoch !== request.hostEpoch ||
      cleanupScope.imageDigest !== request.imageDigest ||
      request.expectedTarget?.sandboxId !== cleanupScope.proof.sandboxId ||
      request.expectedTarget.containerId !== cleanupScope.proof.containerId))
      throw conflict("Sandbox cleanup command is outside its exact original workload");
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
      (["apply", "start", "prove_policy"].includes(request.action) && binding.status !== "admitting") ||
      ["deleted"].includes(binding.status) ||
      (!cleanupScope && !prelaunchScope && !erasure && !safety(request.action) && binding.status === "quarantined") ||
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
        : SANDBOX_QUALIFICATION_BINDING_STATES.includes(binding.status);
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
    if (erasure) {
      if (cell.status !== "STOPPED" || binding.status !== "stopped")
        throw conflict("Stopped Native erasure target resumed before dispatch");
      await stoppedErasureCurrent(tx, request, hostId, erasure);
      // Exact claimed privacy job and canonical stopped workload; no Human grant or business renewal.
    } else if (nativePrelaunchCleanup) {
      // The terminal Native bootstrap owner binds this Stop to the exact original
      // setup admission; it does not assert that a Native process ever launched.
    } else if (nativeAdmissionCleanup) {
      // The original server admission claim and prepared Host target authorize
      // only this exact Stop/inspection lifecycle, even after Human rights fall.
    } else if (cleanupScope) {
      // Cleanup authority is the original signed run/lease, never a renewed business grant.
    } else if (request.cleanupAttestation) {
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
    if (request.action === "prove_policy") await assertPolicyProofRequestCurrent(tx, request, hostId, cell, binding, now,
      nativeConformanceProof, conformanceProofOwner);
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
        !SANDBOX_QUALIFICATION_BINDING_STATES.includes(binding.status))
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
    if(proof.version!==2 || proof.purpose!==NATIVE_RUNTIME_CLEANUP_PURPOSE || proof.executionProfile!==NATIVE_RUNTIME_CLEANUP_PROFILE ||
      proof.executionProfileHash!==REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_PROFILE_HASH)throw conflict("Native cleanup execution profile changed");
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
      const canonical = binding ? nativeRuntimeCleanupProbeCases(binding.boundaryPolicyHash, binding.boundaryPolicy.requiredControls)
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
    if (!manifest || manifest.hash !== startBinding.manifestHash || !policy || policy.policyHash !== startBinding.policyHash ||
      !nativeRuntimeErasurePolicyIsolated(policy.compilation.compiledPolicy))
      throw conflict("Native cleanup attestation lost its original isolated manifest or policy binding");
  }
  async function assertNativeConformanceAdmissionCleanup(tx: Db, actor: AuthorizationActor, scope: SandboxIdentity,
    conformance: NativeOpenCodeConformanceHostAuthority, cleanup: SandboxAdmissionCleanup, action: SandboxHostRequest["action"],
    idempotencyKey: string, expectedTarget?: SandboxHostRequest["expectedTarget"]) {
    if (!["stop", "inspect"].includes(action) || cleanup.requesterUserId !== v7HumanActorId(actor) ||
        cleanup.policySnapshotId !== conformance.policySnapshotId || cleanup.policyHash !== conformance.policyHash ||
        cleanup.manifestId !== conformance.manifestId || cleanup.manifestHash !== conformance.manifestHash ||
        expectedTarget?.sandboxId !== cleanup.sandboxId || expectedTarget.containerId !== cleanup.containerId ||
        (action === "stop" && idempotencyKey !== `v7-sandbox-admission-contain:${scope.bindingId}:${scope.cellGeneration}:${cleanup.claimVersion}:${cleanup.policySnapshotId}`))
      throw forbidden("Exact original Sandbox admission cleanup authority is required");
    const [claim] = await tx.select().from(activityLog).where(and(
      eq(activityLog.companyId, scope.companyId), eq(activityLog.entityType, "runtime_sandbox"),
      eq(activityLog.entityId, scope.bindingId), eq(activityLog.action, "sandbox.admission_claimed"),
      sql`${activityLog.details}->>'claimKey' = ${cleanup.claimKey}`,
    )).limit(1);
    const details = claim?.details && typeof claim.details === "object" && !Array.isArray(claim.details)
      ? claim.details as Record<string, unknown> : {};
    const [binding] = await tx.select().from(runtimeSandboxBindings).where(and(
      eq(runtimeSandboxBindings.companyId, scope.companyId), eq(runtimeSandboxBindings.id, scope.bindingId),
      eq(runtimeSandboxBindings.runtimeCellId, scope.cellId), eq(runtimeSandboxBindings.cellGeneration, scope.cellGeneration),
      eq(runtimeSandboxBindings.version, cleanup.claimVersion), eq(runtimeSandboxBindings.status, "admitting"),
    )).limit(1);
    const [cell] = await tx.select().from(runtimeCells).where(and(
      eq(runtimeCells.companyId, scope.companyId), eq(runtimeCells.id, scope.cellId),
      eq(runtimeCells.generation, BigInt(scope.cellGeneration)), isNull(runtimeCells.deletedAt), isNull(runtimeCells.suspendedReason),
    )).limit(1);
    const [host] = cell?.runtimeHostId ? await tx.select().from(runtimeHosts).where(and(
      eq(runtimeHosts.id, cell.runtimeHostId), eq(runtimeHosts.credentialVersion, cleanup.hostEpoch),
      isNull(runtimeHosts.fencedAt), isNull(runtimeHosts.credentialRevokedAt), isNull(runtimeHosts.retiredAt),
      inArray(runtimeHosts.status, ["READY", "DRAINING"]),
    )).limit(1) : [];
    const admissionCommands = host ? await tx.select().from(runtimeHostCommands).where(and(
      eq(runtimeHostCommands.companyId, scope.companyId), eq(runtimeHostCommands.runtimeHostId, host.id),
      eq(runtimeHostCommands.runtimeCellId, scope.cellId), eq(runtimeHostCommands.cellGeneration, BigInt(scope.cellGeneration)),
      eq(runtimeHostCommands.commandType, SANDBOX_HOST_COMMAND), eq(runtimeHostCommands.status, "SUCCEEDED"),
      sql`${runtimeHostCommands.payload}->'provisioning'->>'purpose' = 'admission'`,
      sql`${runtimeHostCommands.payload}->'provisioning'->>'operationKey' = ${cleanup.claimKey}`,
    )) : [];
    const preparedTargets = admissionCommands.flatMap(command => {
      try {
        const request = parseStoredSandboxHostRequest(command.payload, false);
        const reply = sandboxHostReplySchema.parse(command.safeResult);
        if (request.action !== "prepare" || request.scope.companyId !== scope.companyId ||
          request.scope.bindingId !== scope.bindingId || request.scope.cellId !== scope.cellId ||
          request.scope.cellGeneration !== scope.cellGeneration || request.hostEpoch !== cleanup.hostEpoch ||
          request.imageDigest !== cleanup.imageDigest || !request.provisioning ||
          request.provisioning.operationKey !== cleanup.claimKey || request.provisioning.bindingVersion !== cleanup.claimVersion ||
          reply.action !== "prepare" ||
          reply.hostEpoch !== cleanup.hostEpoch || reply.imageDigest !== cleanup.imageDigest || reply.requiresRecreate ||
          reply.bindingVersion !== cleanup.claimVersion || reply.sandboxId !== cleanup.sandboxId ||
          reply.containerId !== cleanup.containerId) return [];
        return [{ commandId: command.id }];
      } catch {
        return [];
      }
    });
    const [snapshot] = await tx.select().from(runtimePolicySnapshots).where(and(
      eq(runtimePolicySnapshots.companyId, scope.companyId), eq(runtimePolicySnapshots.id, cleanup.policySnapshotId),
      eq(runtimePolicySnapshots.bindingId, scope.bindingId), eq(runtimePolicySnapshots.executionManifestId, cleanup.manifestId),
      eq(runtimePolicySnapshots.status, "qualified"),
    )).limit(1);
    const [manifest] = await tx.select().from(agentExecutionManifests).where(and(
      eq(agentExecutionManifests.companyId, scope.companyId), eq(agentExecutionManifests.id, cleanup.manifestId),
      eq(agentExecutionManifests.runId, conformance.runId), eq(agentExecutionManifests.hash, cleanup.manifestHash),
    )).limit(1);
    if (!claim || claim.actorType !== "user" || claim.actorId !== cleanup.requesterUserId ||
        details.claimVersion !== cleanup.claimVersion || details.generation !== scope.cellGeneration ||
        details.policySnapshotId !== cleanup.policySnapshotId || details.policyHash !== cleanup.policyHash ||
        details.executionManifestId !== cleanup.manifestId || details.executionManifestHash !== cleanup.manifestHash ||
        !binding || binding.backend !== "openshell" || binding.capabilitySnapshotHash === null ||
        !cell?.runtimeHostId || cell.generation.toString() !== scope.cellGeneration ||
        (cell.activeImageDigest ?? cell.desiredImageDigest) !== cleanup.imageDigest || !host || !snapshot || !manifest ||
        cleanup.claimVersion < 1 || !Number.isSafeInteger(cleanup.claimVersion) || preparedTargets.length !== 1)
      throw forbidden("The original exact Sandbox admission claim is no longer the current Host workload");
  }

  async function assertPolicyProofRequestCurrent(tx: Db, request: SandboxHostRequest, hostId: string,
    cell: typeof runtimeCells.$inferSelect, binding: typeof runtimeSandboxBindings.$inferSelect, now: Date,
    conformanceProof?: NativeConformancePolicyProofClaim,
    conformanceProofOwner?: { sourceAuthorityHash: string; runId: string; taskId: string; manifestId: string;
      manifestHash: string; leaseId: string; workspaceRoot: string } | null) {
    const proof = request.policyProof;
    if (request.action !== "prove_policy" || !proof || cell.status !== "STOPPED" ||
        binding.status !== "admitting" || binding.version !== proof.bindingVersion ||
        proof.proverSha256.length !== 64 || !/^[a-f0-9]{64}$/.test(proof.proverSha256) ||
        proof.candidateDocumentHash !== nativeSha256(proof.candidateDocument) ||
        proof.boundaryDocumentHash !== nativeSha256(proof.boundaryDocument))
      throw conflict("Protected policy proof is outside the current stopped admission target", { code: "sandbox_policy_proof_scope_changed" });
    const [snapshot, ...extraSnapshots] = await tx.select().from(runtimePolicySnapshots).where(and(
      eq(runtimePolicySnapshots.companyId, request.scope.companyId),
      eq(runtimePolicySnapshots.bindingId, request.scope.bindingId),
      eq(runtimePolicySnapshots.policyHash, proof.policyHash),
      eq(runtimePolicySnapshots.status, "qualified"),
    )).limit(2);
    if (!snapshot || extraSnapshots.length || snapshot.expiresAt <= now ||
        snapshot.compilation.proverResult !== "pass" ||
        nativeSha256(snapshot.compilation) !== proof.policyHash)
      throw conflict("Protected policy proof has no unique current qualified compilation", { code: "sandbox_policy_proof_compilation_changed" });
    const projectedCandidate = projectOpenShellPolicy(snapshot.compilation.compiledPolicy,
      snapshot.compilation.modelBrokerEndpoint, snapshot.compilation.credentialBrokerEndpoints);
    const sourceBoundary = binding.boundaryPolicy.credentials.mode === "brokered" &&
      binding.boundaryPolicy.credentials.bindings.length === 0
      ? { ...binding.boundaryPolicy, credentials: { mode: "none" as const, bindings: [] } }
      : binding.boundaryPolicy;
    const projectedBoundary = projectOpenShellPolicy(sourceBoundary,
      snapshot.compilation.modelBrokerEndpoint, snapshot.compilation.credentialBrokerEndpoints);
    let expectedProofMaximum = projectedBoundary.document;
    if (conformanceProof) {
      const conformance = conformanceProof.conformance;
      const capability = binding.capabilitySnapshot ? sandboxCapabilitySnapshotSchema.safeParse(binding.capabilitySnapshot) : null;
      const modelBinaries = capability?.success ? capability.data.modelBrokerProviderProfile?.binaries ?? [] : [];
      const authorityRef = snapshot.compilation.sourcePolicyRefs.find(ref => ref.startsWith("authority:"));
      const expectedReads = [...new Set([conformance.workspaceRoot, "/.openshell/runtime/openshell-sandbox", ...modelBinaries])].sort();
      const narrowed = conformanceProofOwner && deriveNativeConformanceProofMaximum({ operatorMaximum: projectedBoundary.document,
        candidate: projectedCandidate.document, taskRoot: conformance.workspaceRoot, modelBinaries });
      if (!conformanceProofOwner || !capability?.success || conformance.policySnapshotId !== snapshot.id ||
          conformance.policyHash !== proof.policyHash || conformance.runId !== conformanceProofOwner.runId ||
          conformance.taskId !== conformanceProofOwner.taskId || conformance.manifestId !== conformanceProofOwner.manifestId ||
          conformance.manifestHash !== conformanceProofOwner.manifestHash || conformance.leaseId !== conformanceProofOwner.leaseId ||
          conformance.workspaceRoot !== conformanceProofOwner.workspaceRoot || snapshot.authorityHash !== conformanceProofOwner.sourceAuthorityHash ||
          snapshot.compilation.boundaryPolicyHash !== binding.boundaryPolicyHash ||
          !snapshot.compilation.sourcePolicyRefs.includes(`boundary:${binding.boundaryPolicyHash}`) ||
          authorityRef !== `authority:${conformanceProofOwner.sourceAuthorityHash}` ||
          nativeSha256(snapshot.compilation.compiledPolicy.filesystem.readPaths) !== nativeSha256(expectedReads) ||
          nativeSha256(snapshot.compilation.compiledPolicy.filesystem.writePaths) !== nativeSha256([conformance.workspaceRoot]) ||
          nativeSha256(snapshot.compilation.modelBrokerEndpoint?.binaries ?? []) !== nativeSha256(modelBinaries) || !narrowed)
        throw conflict("Current exact Task authority cannot narrow the retained operator maximum", { code: "sandbox_conformance_proof_attenuation_changed" });
      expectedProofMaximum = narrowed;
    }
    if (projectedCandidate.unsupportedFeatures.length || projectedBoundary.unsupportedFeatures.length ||
        nativeSha256(projectedCandidate.document) !== proof.candidateDocumentHash ||
        nativeSha256(expectedProofMaximum) !== proof.boundaryDocumentHash)
      throw conflict("Protected proof documents differ from the persisted compilation and exact maximum", { code: "sandbox_policy_proof_document_changed" });
    const prepareCommands = await tx.select().from(runtimeHostCommands).where(and(
      eq(runtimeHostCommands.companyId, request.scope.companyId),
      eq(runtimeHostCommands.runtimeHostId, hostId),
      eq(runtimeHostCommands.runtimeCellId, request.scope.cellId),
      eq(runtimeHostCommands.cellGeneration, BigInt(request.scope.cellGeneration)),
      eq(runtimeHostCommands.commandType, SANDBOX_HOST_COMMAND),
      eq(runtimeHostCommands.status, "SUCCEEDED"),
      sql`${runtimeHostCommands.payload}->>'action' = 'prepare'`,
      sql`${runtimeHostCommands.payload}->'provisioning'->>'purpose' = 'admission'`,
      sql`${runtimeHostCommands.payload}->'provisioning'->>'operationKey' = ${proof.operationKey}`,
      sql`${runtimeHostCommands.payload}->'provisioning'->>'bindingVersion' = ${String(proof.bindingVersion)}`,
      sql`${runtimeHostCommands.payload}->'provisioning'->>'provisioningHash' = ${proof.provisioningHash}`,
      sql`${runtimeHostCommands.payload}->'provisioning'->>'policyHash' = ${proof.policyHash}`,
    )).limit(2);
    const preparedTargets = prepareCommands.flatMap(command => {
      try {
        const preparedRequest = parseStoredSandboxHostRequest(command.payload, false);
        const preparedReply = sandboxHostReplySchema.parse(command.safeResult);
        const provisioning = preparedRequest.provisioning;
        if (preparedRequest.action !== "prepare" || preparedRequest.scope.companyId !== request.scope.companyId ||
            preparedRequest.scope.bindingId !== request.scope.bindingId || preparedRequest.scope.cellId !== request.scope.cellId ||
            preparedRequest.scope.cellGeneration !== request.scope.cellGeneration || preparedRequest.scope.sandboxRef !== request.scope.sandboxRef ||
            preparedRequest.requesterUserId !== request.requesterUserId || preparedRequest.hostEpoch !== request.hostEpoch ||
            preparedRequest.imageDigest !== request.imageDigest || !provisioning || provisioning.purpose !== "admission" ||
            provisioning.operationKey !== proof.operationKey || provisioning.bindingVersion !== proof.bindingVersion ||
            provisioning.provisioningHash !== proof.provisioningHash || provisioning.policyHash !== proof.policyHash ||
            nativeSha256(provisioning.document) !== proof.candidateDocumentHash ||
            nativeSha256(provisioning.document) !== nativeSha256(proof.candidateDocument) ||
            preparedReply.action !== "prepare" || preparedReply.requiresRecreate ||
            preparedReply.hostEpoch !== request.hostEpoch || preparedReply.imageDigest !== request.imageDigest ||
            preparedReply.bindingVersion !== proof.bindingVersion || preparedReply.provisioningHash !== proof.provisioningHash ||
            preparedReply.policyHash !== proof.policyHash || preparedReply.sandboxId !== proof.sandboxId ||
            preparedReply.containerId !== proof.containerId ||
            preparedReply.probePolicyHash !== nativeSha256(provisioning.document)) return [];
        return [{ id: command.id }];
      } catch {
        return [];
      }
    });
    if (prepareCommands.length !== 1 || preparedTargets.length !== 1)
      throw conflict("Protected policy proof lost its exact durable Host prepare receipt", { code: "sandbox_policy_proof_prepare_receipt_missing" });
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
    conformance?: NativeOpenCodeConformanceHostAuthority,
    safetyCleanup?: SandboxAdmissionCleanup,
    policyProof?: SandboxHostRequest["policyProof"],
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
    if (safetyCleanup && (!conformance || !["stop", "inspect"].includes(action)))
      throw forbidden("Admission cleanup authority is restricted to its exact conformance Stop and inspection commands");
    const admissionCleanupClaim: NativeConformanceAdmissionCleanupClaim | undefined = conformance && safetyCleanup
      ? { version: 1, conformance: structuredClone(conformance), cleanup: structuredClone(safetyCleanup), idempotencyKey }
      : undefined;
    let conformanceAuthentication: { requesterSessionId: string; verifiedCredentialExpiresAtMs: number } | undefined;
    const authorize = async (tx?: Db, cleanup?: SandboxAdmissionCleanup) => {
      if (!conformance) return assertOperator(actor, action, tx, scope.companyId, scope.bindingId);
      const reader = tx ?? db;
      if (cleanup) return assertNativeConformanceAdmissionCleanup(reader, actor, scope, conformance, cleanup, action, idempotencyKey,
        safetyCleanup ? { sandboxId: safetyCleanup.sandboxId, containerId: safetyCleanup.containerId } : undefined);
      if (safetyCleanup) throw forbidden("Admission cleanup authority is restricted to its exact stop and inspect commands");
      const humanProof = await assertHumanAuthentication(reader, actor, { requireRecent: true, phishingResistant: false });
      if (actor.type !== "board" || actor.source !== "session" || !actor.sessionId || !Number.isSafeInteger(humanProof.credentialExpiresAt.getTime()))
        throw forbidden("The authenticated Human session is required for conformance policy proof");
      const authenticatedSource = { requesterSessionId: actor.sessionId,
        verifiedCredentialExpiresAtMs: humanProof.credentialExpiresAt.getTime() };
      if (conformanceAuthentication && nativeSha256(conformanceAuthentication) !== nativeSha256(authenticatedSource))
        throw forbidden("The original Human authentication proof changed during conformance admission");
      conformanceAuthentication = authenticatedSource;
      await assertV7Authorization(reader, actor, scope.companyId, "runtime:manage");
      const [run] = await reader.select().from(heartbeatRuns).where(and(
        eq(heartbeatRuns.companyId, scope.companyId), eq(heartbeatRuns.id, conformance.runId),
        eq(heartbeatRuns.status, "running"), eq(heartbeatRuns.responsibleUserId, v7HumanActorId(actor)),
      )).limit(1);
      const context = run?.contextSnapshot && typeof run.contextSnapshot === "object" && !Array.isArray(run.contextSnapshot)
        ? run.contextSnapshot as Record<string, unknown> : {};
      const [task] = await reader.select().from(issues).where(and(
        eq(issues.companyId, scope.companyId), eq(issues.id, conformance.taskId), eq(issues.executionRunId, conformance.runId),
      )).limit(1);
      const [plan] = await reader.select().from(orchestrationPlans).where(and(
        eq(orchestrationPlans.companyId, scope.companyId), eq(orchestrationPlans.id, conformance.planId), eq(orchestrationPlans.issueId, conformance.taskId),
      )).limit(1);
      const [manifest] = await reader.select().from(agentExecutionManifests).where(and(
        eq(agentExecutionManifests.companyId, scope.companyId), eq(agentExecutionManifests.id, conformance.manifestId),
        eq(agentExecutionManifests.runId, conformance.runId), eq(agentExecutionManifests.hash, conformance.manifestHash),
      )).limit(1);
      const [lease] = await reader.select().from(environmentLeases).where(and(
        eq(environmentLeases.companyId, scope.companyId), eq(environmentLeases.id, conformance.leaseId),
        eq(environmentLeases.heartbeatRunId, conformance.runId), eq(environmentLeases.status, "active"),
      )).limit(1);
      const [agent] = run?.agentId ? await reader.select().from(agents).where(and(
        eq(agents.companyId, scope.companyId), eq(agents.id, run.agentId),
      )).limit(1) : [];
      const [presence] = run?.agentId ? await reader.select().from(agentPresenceRuntimeBindings).where(and(
        eq(agentPresenceRuntimeBindings.companyId, scope.companyId), eq(agentPresenceRuntimeBindings.agentId, run.agentId),
      )).limit(1) : [];
      const [provider] = presence ? await reader.select().from(agentProviderBindings).where(eq(agentProviderBindings.id, presence.providerBindingId)).limit(1) : [];
      const providerPin = manifest?.manifest.providers.find(pin => pin.companyId === scope.companyId && pin.agentId === run?.agentId);
      const currentProviderProfile = agent?.adapterType === "paperclip_runner"
        ? resolvePaperclipRunnerProviderProfile(agent.adapterConfig) : null;
      if (task) {
        await assertV7Authorization(reader, actor, scope.companyId, "issue:read",
          { type: "issue", companyId: scope.companyId, issueId: task.id, projectId: task.projectId });
        if (run?.agentId) await assertV7Authorization(reader,
          { type: "agent", companyId: scope.companyId, agentId: run.agentId, runId: run.id,
            onBehalfOfUserId: run.responsibleUserId }, scope.companyId, "issue:read",
          { type: "issue", companyId: scope.companyId, issueId: task.id, projectId: task.projectId });
      }
      const [binding] = await reader.select().from(runtimeSandboxBindings).where(and(
        eq(runtimeSandboxBindings.companyId, scope.companyId), eq(runtimeSandboxBindings.id, scope.bindingId),
        eq(runtimeSandboxBindings.runtimeCellId, scope.cellId), eq(runtimeSandboxBindings.cellGeneration, scope.cellGeneration),
        inArray(runtimeSandboxBindings.status, ["ready", "stopped", "admitting", "running"]),
      )).limit(1);
      const [policy] = await reader.select().from(runtimePolicySnapshots).where(and(
        eq(runtimePolicySnapshots.companyId, scope.companyId), eq(runtimePolicySnapshots.id, conformance.policySnapshotId),
        eq(runtimePolicySnapshots.bindingId, scope.bindingId), eq(runtimePolicySnapshots.executionManifestId, conformance.manifestId),
        eq(runtimePolicySnapshots.status, "qualified"),
      )).limit(1);
      const profile = run?.runnerProfileJson && typeof run.runnerProfileJson === "object" && !Array.isArray(run.runnerProfileJson)
        ? run.runnerProfileJson as Record<string, unknown> : {};
      const workspace = profile.nativeOpenCodeConformanceWorkspace && typeof profile.nativeOpenCodeConformanceWorkspace === "object" &&
        !Array.isArray(profile.nativeOpenCodeConformanceWorkspace) ? profile.nativeOpenCodeConformanceWorkspace as Record<string, unknown> : {};
      const [attempt] = await reader.select({ id: orchestrationWorkerAttempts.id }).from(orchestrationWorkerAttempts).where(and(
        eq(orchestrationWorkerAttempts.companyId, scope.companyId), eq(orchestrationWorkerAttempts.runId, conformance.runId),
      )).limit(1);
      const compiled = policy?.compilation.compiledPolicy;
      const destinations = compiled?.network.destinations ?? [];
      const capability = binding?.capabilitySnapshot ? sandboxCapabilitySnapshotSchema.safeParse(binding.capabilitySnapshot) : null;
      const modelOrigin = capability?.success ? capability.data.modelBrokerProviderProfile?.origin : undefined;
      let modelUrl: URL | null = null;
      try { modelUrl = modelOrigin ? new URL(modelOrigin) : null; } catch { modelUrl = null; }
      const expectedReadPaths = [...new Set([conformance.workspaceRoot, "/.openshell/runtime/openshell-sandbox",
        ...(capability?.success ? capability.data.modelBrokerProviderProfile?.binaries ?? [] : [])])].sort();
      const expectedAuthorityRef = policy?.compilation.sourcePolicyRefs.find(ref => ref.startsWith("authority:"));
      const expectedManifestRef = policy?.compilation.sourcePolicyRefs.find(ref => ref.startsWith("manifest:"));
      if (!run || run.triggerDetail !== "provider_conformance" || run.nativeIssueId !== conformance.taskId ||
          context.providerConformanceGroupId !== conformance.groupId || context.providerConformancePlanId !== conformance.planId ||
          context.containsCompanyContext !== false || context.platformToolsGranted !== false ||
          !task || task.hiddenAt === null || task.harnessKind !== "provider_conformance" || task.responsibleUserId !== run.responsibleUserId ||
          task.assigneeAgentId !== run.agentId || task.conversationAgentId !== null || task.conversationUserId !== null ||
          plan?.status !== "paused" || plan.mode !== "single_worker" || plan.actionClass !== "internal_draft" || plan.riskClass !== "C0" ||
          plan.createdBy !== run.responsibleUserId || plan.executionPrincipal?.type !== "user" || plan.executionPrincipal.userId !== run.responsibleUserId ||
          plan.budgets.maxToolActions !== 0 || plan.budgets.maxRetries !== 0 || plan.toolActionsUsed !== 0 || attempt ||
          !manifest || manifest.manifest.capabilities.length !== 0 || !lease?.expiresAt || lease.expiresAt <= new Date() ||
          !agent || agent.adapterType !== "paperclip_runner" || currentProviderProfile?.provider !== "opencode" ||
          !presence || presence.companyId !== scope.companyId || presence.status === "revoked" ||
          !provider || ["revoked", "retired"].includes(provider.status) || !providerPin ||
          provider.id !== providerPin.providerBindingId || provider.capabilitySnapshotHash !== providerPin.snapshotHash ||
          presence.providerProfileRef !== providerPin.profileRef ||
          !binding || binding.backend !== "openshell" || !binding.capabilitySnapshot || !binding.capabilitySnapshotHash ||
          !policy || policy.policyHash !== conformance.policyHash || policy.authorityHash !== expectedAuthorityRef?.slice("authority:".length) ||
          expectedManifestRef !== `manifest:${manifest.id}:${manifest.hash}` || policy.expiresAt <= new Date() ||
          !compiled || compiled.credentials.mode !== "none" || compiled.credentials.bindings.length !== 0 ||
          nativeSha256(compiled.filesystem.readPaths) !== nativeSha256(expectedReadPaths) ||
          compiled.filesystem.writePaths.length !== 1 || compiled.filesystem.writePaths[0] !== conformance.workspaceRoot ||
          destinations.length !== 1 || destinations[0]?.methods.length !== 1 || destinations[0]?.methods[0] !== "POST" ||
          destinations[0]?.pathPrefixes.length !== 1 || destinations[0]?.pathPrefixes[0] !== "/runtime-tools/model/v1/messages" ||
          !modelUrl || modelUrl.protocol !== "https:" || destinations[0]?.hostname !== modelUrl.hostname ||
          destinations[0]?.port !== Number(modelUrl.port || 443) ||
          policy?.compilation.modelBrokerEndpoint?.hostname !== modelUrl.hostname ||
          policy?.compilation.modelBrokerEndpoint?.port !== Number(modelUrl.port || 443) ||
          !capability?.success || capability.data.expiresAt <= new Date().toISOString() ||
          workspace.taskRoot !== conformance.workspaceRoot || workspace.creationReceipt !== conformance.creationReceipt ||
          lease.metadata?.remoteCwd !== conformance.workspaceRoot ||
          workspace.authorityHash !== null || !await assertNativeOpenCodeConformanceWorkspaceRootReceipt({
            groupId: conformance.groupId, companyId: scope.companyId, agentId: run.agentId!, taskId: conformance.taskId,
            taskRoot: conformance.workspaceRoot, workspaceId: String(workspace.workspaceId), cwd: conformance.workspaceRoot,
            creationReceipt: conformance.creationReceipt,
          }))
        throw forbidden("Current exact Human-owned conformance Host admission authority is required");
    };
    // The private bootstrap lane keeps the current Human and runtime:manage
    // gates while bounding Host control to this zero-tool Run and qualified policy.
    await authorize(undefined, safetyCleanup);
    const conformancePolicyProofClaim: NativeConformancePolicyProofClaim | undefined =
      conformance && action === "prove_policy" && policyProof && conformanceAuthentication
        ? { version: 1, conformance: structuredClone(conformance), ...conformanceAuthentication }
        : undefined;
    if (conformance && action === "prove_policy" && policyProof && !conformancePolicyProofClaim)
      throw forbidden("The original Human authentication proof is required for conformance policy proof");
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
        await authorize(tx as unknown as Db, safetyCleanup);
        // This preliminary lookup only locates the Host. Do not lock the cell
        // before current() acquires the canonical host → cell → binding locks;
        // host heartbeat owns that same order while inventorying its cells.
        const [cell] = await tx
          .select()
          .from(runtimeCells)
          .where(
            and(
              eq(runtimeCells.companyId, scope.companyId),
              eq(runtimeCells.id, scope.cellId),
            ),
          );
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
          ...(policyProof ? { policyProof } : {}),
          ...(safetyCleanup ? { expectedTarget: { sandboxId: safetyCleanup.sandboxId, containerId: safetyCleanup.containerId } } : {}),
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
              ...(provisioning.purpose === "qualification" && provisioning.probeFixtureHash && provisioning.qualificationProbeFixture
                ? { qualificationProbeFixture: provisioning.qualificationProbeFixture, probeFixtureHash: provisioning.probeFixtureHash }
                : {}),
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
          const previousAdmissionCleanup = storedNativeConformanceAdmissionCleanup(existing.payload);
          const previousConformanceProof = storedNativeConformancePolicyProof(existing.payload);
          if (admissionCleanupClaim && nativeSha256(previousAdmissionCleanup ?? null) !== nativeSha256(admissionCleanupClaim))
            throw conflict("Admission cleanup operation key belongs to another exact Host claim");
          if (nativeSha256(previousConformanceProof ?? null) !== nativeSha256(conformancePolicyProofClaim ?? null))
            throw conflict("Conformance proof operation key belongs to another exact Run authority");
          await current(tx, request, host.id, now, existing.id, undefined, undefined, previousAdmissionCleanup, previousConformanceProof);
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
          await authorize(tx as unknown as Db, safetyCleanup);
          return existing;
        }
        await current(tx, request, host.id, now, qualificationCredential?.commandId, undefined, undefined,
          admissionCleanupClaim, conformancePolicyProofClaim);
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
            payload: { ...storedSandboxHostRequest(request, qualificationCredential?.commandId),
              ...(admissionCleanupClaim ? { [NATIVE_CONFORMANCE_ADMISSION_CLEANUP]: admissionCleanupClaim } : {}),
              ...(conformancePolicyProofClaim ? { [NATIVE_CONFORMANCE_POLICY_PROOF]: conformancePolicyProofClaim } : {}) },
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
        await authorize(tx as unknown as Db, safetyCleanup);
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
          await authorize(tx as unknown as Db, safetyCleanup);
          const storedRequest = parseStoredSandboxHostRequest(record.payload, false);
          await current(
            tx as unknown as Db,
            storedRequest,
            record.runtimeHostId,
            new Date(),
            record.id,
            undefined,
            undefined,
            storedNativeConformanceAdmissionCleanup(record.payload),
            storedNativeConformancePolicyProof(record.payload),
          );
          if (qualificationCredential && Date.parse(qualificationCredential.expiresAt) <= Date.now())
            throw conflict("Qualification credential expired before receipt reconciliation");
          const reply = sandboxHostReplySchema.parse(record.safeResult);
          if (reply.action !== action)
            throw conflict("Native sandbox reply action changed");
          await authorize(tx as unknown as Db, safetyCleanup);
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
      version: 2 as const, purpose: NATIVE_RUNTIME_CLEANUP_PURPOSE, executionProfile: NATIVE_RUNTIME_CLEANUP_PROFILE,
      executionProfileHash: REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_PROFILE_HASH,
      jobId: job.id, jobKey: job.jobKey, attemptNumber: job.attemptNumber,
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
      const idempotencyKey = `paperclip-cleanup-attestation:v2:${nativeSha256({ cleanupAttestation, action, probe: probe ?? null })}`;
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
    const originalCapabilities=sandboxCapabilitySnapshotSchema.safeParse(binding.capabilitySnapshot);
    if(!originalCapabilities.success || nativeSha256(sandboxCapabilityFacts(capabilities))!==
      nativeSha256(sandboxCapabilityFacts(originalCapabilities.data)))
      throw conflict("Native cleanup protected mechanism or execution profile changed");
    const now = new Date();
    const expiresAtMs = Date.parse(capabilities.expiresAt);
    if (capabilities.evidenceKind !== "protected_host_report" || capabilities.backend !== "openshell" ||
      capabilities.sandboxImageDigest !== imageDigest || Date.parse(capabilities.testedAt) > now.getTime() ||
      expiresAtMs <= now.getTime() || expiresAtMs <= Date.parse(capabilities.testedAt))
      throw conflict("Native cleanup protected host report is stale or outside its current target");
    const attestationDeadlineMs = Math.min(expiresAtMs, Date.now() + 60_000);
    const probeCases = nativeRuntimeCleanupProbeCases(binding.boundaryPolicyHash, binding.boundaryPolicy.requiredControls);
    if (probeCases.length !== 9 || SANDBOX_CONTROLS.some(control =>
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
      schema: "paperclip.remote-runtime-cleanup-attestation.v2", purpose: NATIVE_RUNTIME_CLEANUP_PURPOSE,
      executionProfile: NATIVE_RUNTIME_CLEANUP_PROFILE, executionProfileHash: REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_PROFILE_HASH,
      jobId: job.id, jobKey: job.jobKey, attemptNumber: job.attemptNumber, executionOwnerId: job.executionOwnerId,
      locatorDigest: remoteRuntimeAssetLocatorDigest(input.locator),
      companyPurgeOperationId: input.companyPurgeOperationId ?? null,
      startBindingDigest: nativeSha256(startBinding), capabilityCommandId: capabilityResult.commandId,
      capabilities, probes: probeReceipts, completedAt: new Date().toISOString(), expiresAt: new Date(finalExpiry).toISOString(),
    };
  }
  async function stoppedErasureCurrent(tx: Db, request: SandboxHostRequest, hostId: string,
    claim: StoppedNativeErasureClaim) {
    const descriptor = request.nativeSessionErasure;
    const [job] = await tx.select().from(memoryJobs).where(and(eq(memoryJobs.companyId, request.scope.companyId),
      eq(memoryJobs.id, claim.jobId), eq(memoryJobs.jobKey, claim.jobKey), eq(memoryJobs.status, "running"),
      eq(memoryJobs.attemptNumber, claim.jobAttemptNumber), eq(memoryJobs.executionOwnerId, claim.executionOwnerId),
      gt(memoryJobs.leaseExpiresAt, new Date()))).limit(1);
    const source = job?.sourceRefJson as Record<string, unknown> | undefined;
    const locator = source?.remoteAssetLocator;
    if (!job || request.action !== "erase_native_session" || !descriptor || request.requesterUserId !== undefined ||
      request.cleanupAttestation !== undefined || !isRemoteRuntimeAssetLocator(locator) ||
      locator.companyId !== request.scope.companyId || source?.runId !== locator.runId ||
      (source.companyPurgeOperationId ?? null) !== claim.companyPurgeOperationId ||
      remoteRuntimeAssetLocatorDigest(locator) !== claim.locatorDigest || nativeSha256(descriptor) !== claim.descriptorDigest)
      throw conflict("Stopped Native erasure lost its exact current job claim");
    await assertRemoteRuntimeAssetErasureClaimCurrent(tx, locator, claim.companyPurgeOperationId ?? undefined);
    await assertRemoteRuntimeAssetErasureReady(tx, locator, claim.companyPurgeOperationId ?? undefined);
    const original = await readRunLeaseCleanup(tx, { companyId: locator.companyId, runId: locator.runId, leaseId: locator.environmentLeaseId });
    const retainedStageNonces = original.attachmentStageReceipts.map(stage => stage.stageNonce).sort();
    if (nativeSha256(descriptor.attachmentStageNonces ?? []) !== nativeSha256(retainedStageNonces))
      throw conflict("Stopped Native erasure attachment-stage receipts changed");
    const receipt = await verifyNativeCleanupRuntimeState(tx, original.proof, original.lease.metadata?.remoteExecutionTermination);
    const metadata = original.lease.metadata as Record<string, unknown> | null;
    const taskRoot = typeof metadata?.remoteCwd === "string" ? metadata.remoteCwd.trim() : "";
    const [policy] = await tx.select().from(runtimePolicySnapshots).where(and(
      eq(runtimePolicySnapshots.companyId, locator.companyId), eq(runtimePolicySnapshots.id, original.session.policySnapshotId),
      eq(runtimePolicySnapshots.bindingId, original.scope.bindingId)));
    const capability = sandboxCapabilitySnapshotSchema.safeParse(original.binding.capabilitySnapshot);
    const target = capability.success ? capability.data.qualificationTarget : undefined;
    const starts = await tx.select({ payload: runtimeHostCommands.payload }).from(runtimeHostCommands).where(and(
      eq(runtimeHostCommands.companyId, locator.companyId), eq(runtimeHostCommands.commandType, "sandbox_exec"),
      eq(runtimeHostCommands.status, "SUCCEEDED"), eq(runtimeHostCommands.runtimeHostId, original.session.hostId),
      eq(runtimeHostCommands.runtimeCellId, original.session.cellId),
      eq(runtimeHostCommands.cellGeneration, BigInt(original.session.cellGeneration)),
      sql`${runtimeHostCommands.payload}->>'nativePreparationPurpose' = 'native_session_start'`,
      sql`${runtimeHostCommands.payload}->>'runId' = ${locator.runId}`,
      sql`${runtimeHostCommands.payload}->>'leaseId' = ${locator.environmentLeaseId}`));
    const matchingStarts = starts.filter(row => {
      const payload = row.payload as Record<string, unknown>;
      const session = payload.modelBrokerSession as Record<string, unknown> | undefined;
      return nativeSha256(payload.remoteNativeSessionStartBinding ?? null) === nativeSha256(original.session) &&
        session?.phase === "start" && session.startBindingDigest === original.proof.startBindingDigest &&
        session.sessionKey === descriptor.sessionKey;
    });
    if (matchingStarts.length !== 1 || !policy || !target || !taskRoot || sha256(taskRoot) !== locator.remoteCwdDigest ||
      policy.policyHash !== original.session.policyHash || policy.capabilitySnapshotHash !== original.binding.capabilitySnapshotHash ||
      nativeSha256(receipt) !== claim.stopReceiptDigest || request.hostEpoch !== original.session.hostEpoch ||
      hostId !== original.session.hostId || request.imageDigest !== original.imageDigest ||
      nativeSha256(request.scope) !== nativeSha256(original.scope) ||
      descriptor.startBindingDigest !== original.proof.startBindingDigest || descriptor.leaseId !== locator.environmentLeaseId ||
      descriptor.taskRoot !== taskRoot || descriptor.sessionDigest !== locator.normalizedSessionIdDigest ||
      descriptor.policyHash !== original.session.policyHash || descriptor.sandboxId !== original.proof.sandboxId ||
      descriptor.containerId !== original.proof.containerId || descriptor.imageDigest !== original.imageDigest ||
      descriptor.dockerEngineIdHash !== target.dockerEngineIdHash || descriptor.cellGeneration !== original.session.cellGeneration ||
      descriptor.runId !== locator.runId || descriptor.runnerInstanceId !== locator.runnerInstanceId)
      throw conflict("Stopped Native erasure no longer matches its original signed physical session");
    return { original, receipt, job };
  }
  async function eraseStoppedNativeSession(input: { locator: RemoteRuntimeAssetLocator; jobId: string; jobKey: string;
    jobAttemptNumber: number; executionOwnerId: string; companyPurgeOperationId?: string; descriptor: NonNullable<SandboxHostRequest["nativeSessionErasure"]> }) {
    const job = await assertRemoteRuntimeAssetErasureClaimCurrent(db, input.locator, input.companyPurgeOperationId);
    const original = await readRunLeaseCleanup(db, { companyId: input.locator.companyId,
      runId: input.locator.runId, leaseId: input.locator.environmentLeaseId });
    const receipt = await verifyNativeCleanupRuntimeState(db, original.proof, original.lease.metadata?.remoteExecutionTermination);
    if (job.id !== input.jobId || job.jobKey !== input.jobKey || job.attemptNumber !== input.jobAttemptNumber ||
      job.executionOwnerId !== input.executionOwnerId || !job.executionOwnerId || !job.leaseExpiresAt)
      throw conflict("Stopped Native erasure job identity changed");
    const claim: StoppedNativeErasureClaim = { locatorDigest: remoteRuntimeAssetLocatorDigest(input.locator),
      jobId: job.id, jobKey: job.jobKey, jobAttemptNumber: job.attemptNumber, executionOwnerId: job.executionOwnerId,
      companyPurgeOperationId: input.companyPurgeOperationId ?? null, stopReceiptDigest: nativeSha256(receipt),
      descriptorDigest: nativeSha256(input.descriptor) };
    const request = sandboxHostRequestSchema.parse({ version: 1, scope: original.scope, action: "erase_native_session",
      hostEpoch: original.session.hostEpoch, imageDigest: original.imageDigest, nativeSessionErasure: input.descriptor });
    const payload = { ...request, [STOPPED_NATIVE_ERASURE]: claim };
    const key = `native-stopped-erasure:v1:${nativeSha256(claim)}`;
    const queued = await withV7ActivityTransaction(db, async (tx, publications) => {
      await current(tx, request, original.session.hostId, new Date(), undefined, undefined, claim);
      const [prior] = await tx.select().from(runtimeHostCommands).where(eq(runtimeHostCommands.idempotencyKey, key));
      if (prior) {
        if (nativeSha256(prior.payload) !== nativeSha256(payload)) throw conflict("Stopped Native erasure retry binding changed");
        return prior;
      }
      const [row] = await tx.insert(runtimeHostCommands).values({ companyId: input.locator.companyId,
        runtimeHostId: original.session.hostId, runtimeCellId: original.session.cellId,
        cellGeneration: BigInt(original.session.cellGeneration), commandType: SANDBOX_HOST_COMMAND, payload,
        idempotencyKey: key, deadlineAt: new Date(Math.min(job.leaseExpiresAt!.getTime(), Date.now() + 60_000)) }).returning();
      if (!row) throw conflict("Stopped Native erasure command unavailable");
      await logActivity(tx, { companyId: input.locator.companyId, actorType: "system", actorId: "native-runtime-erasure",
        action: "sandbox.native_session_erasure_queued", entityType: "runtime_sandbox", entityId: original.scope.bindingId,
        details: { runId: input.locator.runId, jobId: job.id, attemptNumber: job.attemptNumber, commandId: row.id } }, publications);
      return row;
    });
    for (;;) {
      const [row] = await db.select().from(runtimeHostCommands).where(eq(runtimeHostCommands.id, queued.id));
      if (!row) throw conflict("Stopped Native erasure receipt unavailable");
      if (row.status === "SUCCEEDED") {
        await current(db, request, original.session.hostId, new Date(), row.id, undefined, claim);
        const reply = sandboxHostReplySchema.parse(row.safeResult);
        const { taskRoot: _taskRoot, ...expected } = input.descriptor;
        if (reply.action !== "erase_native_session" || nativeSha256(reply) !== nativeSha256({ ...expected,
          action: "erase_native_session", erased: true,
          ...(input.descriptor.attachmentStageNonces?.length ? { attachmentStageNoncesAbsent: input.descriptor.attachmentStageNonces } : {}),
          upperLayerAbsent: true, mergedViewAbsent: true, stoppedBefore: true, stoppedAfter: true }))
          throw conflict("Stopped Native erasure did not prove exact stored-layer absence");
        return { command: row, reply, receipt, claim };
      }
      if (["FAILED", "CANCELED", "EXPIRED"].includes(row.status) || row.deadlineAt <= new Date())
        throw conflict("Stopped Native erasure outcome remains unknown", { commandId: row.id });
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  /** Internal cleanup composition only: no Human grant, execution capability, or business deadline renewal. */
  async function stopNativeBootstrapPrelaunchLease(input: { companyId: string; runId: string; leaseId: string }) {
    const original = await readNativeBootstrapPrelaunchCleanup(db, input);
    const claim: NativeBootstrapPrelaunchCleanupClaim = { version: 1, owner: original.owner };
    const command = async (action: "stop" | "inspect") => {
      const now = new Date();
      const request = sandboxHostRequestSchema.parse({ version: 1, scope: original.scope, action,
        hostEpoch: original.owner.hostEpoch, imageDigest: original.owner.imageDigest,
        requesterUserId: original.owner.requesterUserId,
        expectedTarget: { sandboxId: original.owner.sandboxId, containerId: original.owner.containerId } });
      const payload = { ...request, [NATIVE_BOOTSTRAP_PRELAUNCH_CLEANUP]: claim };
      const key = `native-bootstrap-prelaunch-cleanup:v1:${nativeSha256({ owner: original.owner, action })}`;
      const queued = await withV7ActivityTransaction(db, async (tx, publications) => {
        await current(tx, request, original.owner.hostId, now, undefined, undefined, undefined, undefined, undefined, claim);
        const [existing] = await tx.select().from(runtimeHostCommands).where(eq(runtimeHostCommands.idempotencyKey, key)).limit(1);
        if (existing) {
          if (nativeSha256(existing.payload) !== nativeSha256(payload)) throw conflict("Native prelaunch cleanup key changed");
          return existing;
        }
        const [row] = await tx.insert(runtimeHostCommands).values({ companyId: input.companyId,
          runtimeHostId: original.owner.hostId, runtimeCellId: original.owner.cellId,
          cellGeneration: BigInt(original.owner.generation), commandType: SANDBOX_HOST_COMMAND,
          payload, idempotencyKey: key, deadlineAt: new Date(now.getTime() + Math.min(30000, options.timeoutMs ?? 20000)) }).returning();
        if (!row) throw conflict("Native prelaunch cleanup command was not persisted");
        await logActivity(tx, { companyId: input.companyId, actorType: "system", actorId: "native-bootstrap-cleanup",
          action: "sandbox.native_prelaunch_cleanup_queued", entityType: "runtime_sandbox", entityId: original.owner.bindingId,
          details: { runId: input.runId, leaseId: input.leaseId, commandId: row.id, action } }, publications);
        return row;
      });
      while (true) {
        const [row] = await db.select().from(runtimeHostCommands).where(eq(runtimeHostCommands.id, queued.id)).limit(1);
        if (!row) throw conflict("Native prelaunch cleanup receipt unavailable");
        if (row.status === "SUCCEEDED") return db.transaction(async transaction => {
          const tx = transaction as unknown as Db;
          await current(tx, request, row.runtimeHostId, new Date(), row.id, undefined, undefined, undefined, undefined, claim);
          const reply = sandboxHostReplySchema.parse(row.safeResult);
          if (reply.action !== action) throw conflict("Native prelaunch cleanup receipt action changed");
          return { id: row.id, reply, completedAt: row.completedAt! };
        });
        if (["FAILED", "CANCELED", "EXPIRED"].includes(row.status) || row.deadlineAt <= new Date())
          throw conflict("Native prelaunch physical outcome is unknown", { commandId: row.id });
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    };
    const stop = await command("stop");
    const inspect = await command("inspect");
    if (stop.reply.action !== "stop" || stop.reply.stopped !== true || stop.reply.sandboxId !== original.owner.sandboxId ||
        stop.reply.containerId !== original.owner.containerId || inspect.reply.action !== "inspect" ||
        inspect.reply.sandboxId !== original.owner.sandboxId || inspect.reply.containerId !== original.owner.containerId ||
        inspect.reply.state !== "stopped" || inspect.reply.generation !== original.owner.generation ||
        inspect.reply.imageDigest !== original.owner.imageDigest || inspect.reply.policyHash !== original.owner.policyHash)
      throw conflict("Native prelaunch cleanup lacks independent signed stopped observation");
    await readNativeBootstrapPrelaunchCleanup(db, input, original.owner);
    return { schema: "paperclip.remote-termination.v1", executionKind: "native_bootstrap_prelaunch" as const,
      companyId: input.companyId, runId: input.runId, leaseId: input.leaseId, provider: original.lease.provider!,
      providerLeaseId: original.lease.providerLeaseId!, state: "stopped" as const, confirmedAt: inspect.completedAt.toISOString(),
      prelaunchStop: { owner: original.owner, scope: original.scope, stopCommandId: stop.id, inspectCommandId: inspect.id } };
  }

  async function stopRunLeaseForCleanup(input: { companyId: string; runId: string; leaseId: string }) {
    const original = await readRunLeaseCleanup(db, input);
    if (original.binding.status !== "stopped") await fenceSandboxAdmissionOutcome(db, {
      companyId: input.companyId, bindingId: original.scope.bindingId, cellId: original.scope.cellId,
      generation: original.scope.cellGeneration, policySnapshotId: original.session.policySnapshotId,
      claimKey: original.claimKey, operationKeys: [original.proof.startCommandId], stopConfirmed: false,
    });
    const command = async (action: "stop" | "inspect") => {
      const now = new Date();
      const request = sandboxHostRequestSchema.parse({ version: 1, scope: original.scope, action,
        hostEpoch: original.session.hostEpoch, imageDigest: original.imageDigest,
        requesterUserId: original.startRequest.requesterUserId,
        expectedTarget: { sandboxId: original.proof.sandboxId, containerId: original.proof.containerId } });
      const payload = { ...request, [RUN_LEASE_CLEANUP]: original.proof };
      const key = `sandbox-run-cleanup:v1:${nativeSha256({ proof: original.proof, action })}`;
      const queued = await withV7ActivityTransaction(db, async (tx, publications) => {
        await current(tx, request, original.session.hostId, now, undefined, original.proof);
        const [existing] = await tx.select().from(runtimeHostCommands).where(eq(runtimeHostCommands.idempotencyKey, key));
        if (existing) {
          if (nativeSha256(existing.payload) !== nativeSha256(payload)) throw conflict("Sandbox cleanup key changed");
          return existing;
        }
        const [row] = await tx.insert(runtimeHostCommands).values({ companyId: input.companyId,
          runtimeHostId: original.session.hostId, runtimeCellId: original.scope.cellId,
          cellGeneration: BigInt(original.scope.cellGeneration), commandType: SANDBOX_HOST_COMMAND,
          payload, idempotencyKey: key, deadlineAt: new Date(now.getTime() + Math.min(30000, options.timeoutMs ?? 20000)) }).returning();
        if (!row) throw conflict("Sandbox cleanup command was not persisted");
        await logActivity(tx, { companyId: input.companyId, actorType: "system", actorId: "native-run-cleanup",
          action: "sandbox.run_cleanup_queued", entityType: "runtime_sandbox", entityId: original.scope.bindingId,
          details: { runId: input.runId, leaseId: input.leaseId, commandId: row.id, action,
            originalRequesterUserId: original.startRequest.requesterUserId } }, publications);
        return row;
      });
      while (true) {
        const [row] = await db.select().from(runtimeHostCommands).where(eq(runtimeHostCommands.id, queued.id));
        if (!row) throw conflict("Sandbox cleanup receipt unavailable");
        if (row.status === "SUCCEEDED") return db.transaction(async transaction => {
          const tx = transaction as unknown as Db;
          await current(tx, request, row.runtimeHostId, new Date(), row.id, original.proof);
          const reply = sandboxHostReplySchema.parse(row.safeResult);
          if (reply.action !== action) throw conflict("Sandbox cleanup receipt action changed");
          return { id: row.id, reply, completedAt: row.completedAt! };
        });
        if (["FAILED", "CANCELED", "EXPIRED"].includes(row.status) || row.deadlineAt <= new Date())
          throw conflict("Sandbox cleanup physical outcome is unknown", { commandId: row.id });
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    };
    const stop = await command("stop");
    const inspect = await command("inspect");
    if (stop.reply.action !== "stop" || stop.reply.stopped !== true ||
      stop.reply.sandboxId !== original.proof.sandboxId || stop.reply.containerId !== original.proof.containerId ||
      inspect.reply.action !== "inspect" || inspect.reply.sandboxId !== original.proof.sandboxId ||
      inspect.reply.containerId !== original.proof.containerId ||
      inspect.reply.state !== "stopped" || inspect.reply.generation !== original.scope.cellGeneration ||
      inspect.reply.imageDigest !== original.imageDigest || inspect.reply.policyHash !== original.session.policyHash)
      throw conflict("Sandbox cleanup did not independently observe the original workload stopped");
    await readRunLeaseCleanup(db, input, original.proof);
    const receipt = { schema: "paperclip.remote-termination.v1" as const, companyId: input.companyId, runId: input.runId, leaseId: input.leaseId, provider: original.lease.provider!,
      providerLeaseId: original.lease.providerLeaseId!, state: "stopped" as const,
      confirmedAt: inspect.completedAt.toISOString(), sandboxStop: { ...original.proof,
        hostId: original.session.hostId, hostEpoch: original.session.hostEpoch, ...original.scope,
        imageDigest: original.imageDigest, stopCommandId: stop.id, inspectCommandId: inspect.id } };
    return await verifyRunLeaseCleanupReceipt(db, input, receipt);
  }
  return {
    stopRunLeaseForCleanup,
    stopNativeBootstrapPrelaunchLease,
    eraseStoppedNativeSession,
    refreshRemoteRuntimeCleanupAttestation,
    bridge(actor: AuthorizationActor, conformance?: NativeOpenCodeConformanceHostAuthority): OpenShellHostBridge {
      const call = (scope: SandboxIdentity, action: SandboxHostRequest["action"], probe?: SandboxHostRequest["probe"],
        admission?: SandboxHostRequest["admission"], start?: SandboxHostRequest["start"], idempotencyKey?: string,
        provisioning?: SandboxProvisioningInput, safetyCleanup?: SandboxAdmissionCleanup,
        policyProof?: SandboxHostRequest["policyProof"]) => invoke(actor, scope, action, probe, admission, start,
          idempotencyKey, provisioning, conformance, safetyCleanup, policyProof);
      return {
        capabilities: async (scope) => {
          const { reply } = await call(scope, "capabilities");
          if (reply.action !== "capabilities")
            throw conflict("Native sandbox reply action changed");
          return reply.capabilities;
        },
        prepare: async (scope, provisioning) => {
          const { reply, request } = await call(scope, "prepare", undefined, undefined, undefined,
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
          const { reply } = await call(scope, "inspect", undefined, undefined, undefined, undefined, undefined,
            scope.nativeAdmissionCleanup);
          if (reply.action !== "inspect")
            throw conflict("Native sandbox reply action changed");
          const { action: _, ...observation } = reply;
          return observation;
        },
        effectivePolicy: async (scope) => {
          const { reply } = await call(scope, "effective_policy");
          if (reply.action !== "effective_policy")
            throw conflict("Native sandbox reply action changed");
          return reply.document;
        },
        provePolicy: async (scope, policyProof, idempotencyKey) => {
          // Each invocation needs a fresh observation; retries of that one
          // invocation retain the generated command key.
          const proofInvocationKey = `policy-proof:${nativeSha256({
            requestedIdempotencyKey: idempotencyKey, policyProof, nonce: randomUUID(),
          })}`;
          const { reply, request } = await call(scope, "prove_policy", undefined, undefined, undefined,
            proofInvocationKey, undefined, undefined, policyProof);
          if (reply.action !== "prove_policy" || request.action !== "prove_policy" || !request.policyProof ||
              nativeSha256(request.policyProof) !== nativeSha256(policyProof) ||
              reply.stage !== policyProof.stage || reply.candidateDocumentHash !== policyProof.candidateDocumentHash ||
              reply.boundaryDocumentHash !== policyProof.boundaryDocumentHash ||
              reply.proverSha256 !== policyProof.proverSha256 ||
              reply.target.hostEpoch !== request.hostEpoch || reply.target.imageDigest !== request.imageDigest ||
              reply.target.sandboxId !== policyProof.sandboxId || reply.target.containerId !== policyProof.containerId ||
              reply.target.bindingVersion !== policyProof.bindingVersion ||
              reply.target.provisioningHash !== policyProof.provisioningHash || reply.target.policyHash !== policyProof.policyHash)
            throw conflict("Protected Host policy proof does not match its exact signed request and target", {
              code: "sandbox_host_policy_proof_target_mismatch",
            });
          return reply;
        },
        apply: async (input) => {
          const { reply } = await call(
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
          const { reply, commandId } = await call(
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
          await call(scope, "revoke_providers");
        },
        stop: async (scope) => ({
          operationId: (
            await call(scope, "stop", undefined, undefined, undefined, scope.idempotencyKey, undefined,
              scope.nativeAdmissionCleanup)
          ).commandId,
        }),
        destroy: async (scope) => ({
          operationId: (
            await call(
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
          const { reply } = await call(scope, "probe", wireTest, undefined, undefined, commandKey);
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
          ({ host } = await current(tx, request, hostId, now, command.id,
            command.payload?.[RUN_LEASE_CLEANUP] as RunLeaseCleanup | undefined,
            command.payload?.[STOPPED_NATIVE_ERASURE] as StoppedNativeErasureClaim | undefined,
            storedNativeConformanceAdmissionCleanup(command.payload),
          storedNativeConformancePolicyProof(command.payload),
            storedNativeBootstrapPrelaunchCleanup(command.payload)));
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
        await current(tx, hydratedRequest, hostId, now, command.id,
          command.payload?.[RUN_LEASE_CLEANUP] as RunLeaseCleanup | undefined,
          command.payload?.[STOPPED_NATIVE_ERASURE] as StoppedNativeErasureClaim | undefined,
          storedNativeConformanceAdmissionCleanup(command.payload),
          storedNativeConformancePolicyProof(command.payload),
          storedNativeBootstrapPrelaunchCleanup(command.payload));
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
        await current(tx, request, hostId, now, command.id,
          command.payload?.[RUN_LEASE_CLEANUP] as RunLeaseCleanup | undefined,
          command.payload?.[STOPPED_NATIVE_ERASURE] as StoppedNativeErasureClaim | undefined,
          storedNativeConformanceAdmissionCleanup(command.payload),
          storedNativeConformancePolicyProof(command.payload),
          storedNativeBootstrapPrelaunchCleanup(command.payload));
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
        await current(tx, hydratedRequest, hostId, now, command.id,
          command.payload?.[RUN_LEASE_CLEANUP] as RunLeaseCleanup | undefined,
          command.payload?.[STOPPED_NATIVE_ERASURE] as StoppedNativeErasureClaim | undefined,
          storedNativeConformanceAdmissionCleanup(command.payload),
          storedNativeConformancePolicyProof(command.payload),
          storedNativeBootstrapPrelaunchCleanup(command.payload));
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
              ...(command.payload?.[RUN_LEASE_CLEANUP] ? { systemCleanup: "native-run-lease",
                originalRequesterUserId: request.requesterUserId } : {}),
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
