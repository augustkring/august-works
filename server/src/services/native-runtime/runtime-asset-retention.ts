import path from "node:path";
import fs from "node:fs/promises";
import type { Dir } from "node:fs";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { companies, companyDeletionOperations, environmentLeases, heartbeatRuns, memoryJobs, nativeRunFinalizations, type Db } from "@paperclipai/db";
import { resolvePaperclipInstanceRoot } from "../../home-paths.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy, purgeDerivedWorkflowMemory } from "../memory/memory-privacy.js";
import { hasNativeLocalProcessStop } from "../native-local-process-stop.js";
import { assertRuntimeStorageDirectories, removeRuntimeStorageTree } from "../runtime-skill-cache.js";
import { conflict } from "../../errors.js";

export type NativeRuntimeAssetOwner = { companyId: string; runId: string };
const digestPattern = /^[a-f0-9]{64}$/;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Exact remote run-session tree owned by one Native OpenCode run. It includes
 * provider home, staged runtime context, runner state, and diagnostics. The job
 * stores this content-free locator; RuntimeControl resolves and authenticates
 * the host/cell/binding at dispatch time. Never persist remote absolute paths. */
export type RemoteRuntimeAssetLocator = {
  schema: "paperclip.remote-runtime-asset-locator.v1";
  companyId: string;
  runId: string;
  runtimeKind: "native_opencode_server";
  environmentId: string;
  environmentLeaseId: string;
  provider: string;
  providerLeaseId: string;
  runnerInstanceId: string;
  normalizedSessionIdDigest: string;
  remoteCwdDigest: string;
  relativePath: string;
  pathDigest: string;
};

/** Server-authored from the authenticated RuntimeControl dispatch and its
 * stop-before-remove result. Child stdout alone is never a receipt. */
export type RemoteRuntimeAssetRemovalReceipt = {
  schema: "paperclip.remote-runtime-asset-removal.v1";
  locatorDigest: string;
  commandRequestId: string;
  purpose: "native_provider_data_erasure";
  target: { hostId: string; cellId: string; cellGeneration: string; bindingId: string };
  relativePath: string;
  pathDigest: string;
  stopProof: {
    schema: "paperclip.native-remote-process-stop.v1";
    runId: string;
    normalizedSessionIdDigest: string;
    runnerInstanceId: string;
    environmentLeaseId: string;
    providerLeaseId: string;
    pid: number;
    startedAt: string;
    processIdentityDigest: string;
    processStartFingerprintDigest: string;
    stoppedAt: string;
  };
  stopProofBeforeDelete: true;
  exitCode: 0;
  timedOut: false;
  postDeleteAbsent: true;
};

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export function remoteRuntimeAssetRelativePath(normalizedSessionIdDigest: string) {
  if (!digestPattern.test(normalizedSessionIdDigest)) throw new Error("Invalid remote Native session digest");
  return `sessions/${normalizedSessionIdDigest}`;
}

export function remoteRuntimeAssetPathDigest(relativePath: string) {
  return sha256(relativePath);
}

export function remoteRuntimeAssetLocatorDigest(locator: RemoteRuntimeAssetLocator) {
  return sha256([
    locator.schema, locator.companyId, locator.runId, locator.runtimeKind, locator.environmentId,
    locator.environmentLeaseId, locator.provider, locator.providerLeaseId, locator.runnerInstanceId,
    locator.normalizedSessionIdDigest, locator.remoteCwdDigest, locator.relativePath, locator.pathDigest,
  ].join("\0"));
}

export function createRemoteRuntimeAssetLocator(input: {
  companyId: string;
  runId: string;
  environmentId: string;
  environmentLeaseId: string;
  provider: string;
  providerLeaseId: string;
  runnerInstanceId: string;
  normalizedSessionId: string;
  remoteCwd: string;
}): RemoteRuntimeAssetLocator {
  const normalizedSessionIdDigest = sha256(input.normalizedSessionId);
  const relativePath = remoteRuntimeAssetRelativePath(normalizedSessionIdDigest);
  if (![input.companyId, input.runId, input.environmentId, input.environmentLeaseId].every(id => uuidPattern.test(id)) ||
    !input.provider.trim() || !input.providerLeaseId.trim() || !input.runnerInstanceId.trim() ||
    !input.normalizedSessionId.trim() || !input.remoteCwd.trim() ||
    input.normalizedSessionId !== input.normalizedSessionId.trim() || input.remoteCwd !== input.remoteCwd.trim())
    throw new Error("Invalid remote Native runtime asset owner");
  return {
    schema: "paperclip.remote-runtime-asset-locator.v1",
    companyId: input.companyId,
    runId: input.runId,
    runtimeKind: "native_opencode_server",
    environmentId: input.environmentId,
    environmentLeaseId: input.environmentLeaseId,
    provider: input.provider,
    providerLeaseId: input.providerLeaseId,
    runnerInstanceId: input.runnerInstanceId,
    normalizedSessionIdDigest,
    remoteCwdDigest: sha256(input.remoteCwd),
    relativePath,
    pathDigest: remoteRuntimeAssetPathDigest(relativePath),
  };
}

export function isRemoteRuntimeAssetLocator(value: unknown, owner?: NativeRuntimeAssetOwner): value is RemoteRuntimeAssetLocator {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const locator = value as Partial<RemoteRuntimeAssetLocator>;
  const expectedKeys = ["schema", "companyId", "runId", "runtimeKind", "environmentId", "environmentLeaseId", "provider",
    "providerLeaseId", "runnerInstanceId", "normalizedSessionIdDigest", "remoteCwdDigest", "relativePath", "pathDigest"];
  if (Object.keys(locator).length !== expectedKeys.length || Object.keys(locator).some(key => !expectedKeys.includes(key)) ||
    locator.schema !== "paperclip.remote-runtime-asset-locator.v1" ||
    ![locator.companyId, locator.runId, locator.environmentId, locator.environmentLeaseId].every(id => typeof id === "string" && uuidPattern.test(id)) ||
    locator.runtimeKind !== "native_opencode_server" || typeof locator.provider !== "string" || !locator.provider.trim() ||
    typeof locator.providerLeaseId !== "string" || !locator.providerLeaseId.trim() ||
    typeof locator.runnerInstanceId !== "string" || !locator.runnerInstanceId.trim() ||
    typeof locator.normalizedSessionIdDigest !== "string" || !digestPattern.test(locator.normalizedSessionIdDigest) ||
    typeof locator.remoteCwdDigest !== "string" || !digestPattern.test(locator.remoteCwdDigest) ||
    typeof locator.relativePath !== "string" || locator.relativePath !== remoteRuntimeAssetRelativePath(locator.normalizedSessionIdDigest) ||
    typeof locator.pathDigest !== "string" || locator.pathDigest !== remoteRuntimeAssetPathDigest(locator.relativePath)) return false;
  return !owner || (locator.companyId === owner.companyId && locator.runId === owner.runId);
}

export function isRemoteRuntimeAssetRemovalReceipt(value: unknown, locator: RemoteRuntimeAssetLocator): value is RemoteRuntimeAssetRemovalReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value as Partial<RemoteRuntimeAssetRemovalReceipt>;
  return receipt.schema === "paperclip.remote-runtime-asset-removal.v1" &&
    receipt.locatorDigest === remoteRuntimeAssetLocatorDigest(locator) &&
    typeof receipt.commandRequestId === "string" && uuidPattern.test(receipt.commandRequestId) &&
    receipt.purpose === "native_provider_data_erasure" &&
    Boolean(receipt.target && typeof receipt.target.hostId === "string" && receipt.target.hostId.trim() &&
      typeof receipt.target.cellId === "string" && uuidPattern.test(receipt.target.cellId) &&
      typeof receipt.target.cellGeneration === "string" && /^[1-9][0-9]*$/.test(receipt.target.cellGeneration) &&
      typeof receipt.target.bindingId === "string" && uuidPattern.test(receipt.target.bindingId)) &&
    receipt.relativePath === locator.relativePath && receipt.pathDigest === locator.pathDigest &&
    Boolean(receipt.stopProof && receipt.stopProof.schema === "paperclip.native-remote-process-stop.v1" &&
      receipt.stopProof.runId === locator.runId &&
      receipt.stopProof.normalizedSessionIdDigest === locator.normalizedSessionIdDigest &&
      receipt.stopProof.runnerInstanceId === locator.runnerInstanceId &&
      receipt.stopProof.environmentLeaseId === locator.environmentLeaseId &&
      receipt.stopProof.providerLeaseId === locator.providerLeaseId &&
      Number.isSafeInteger(receipt.stopProof.pid) && receipt.stopProof.pid > 1 &&
      typeof receipt.stopProof.startedAt === "string" && !Number.isNaN(Date.parse(receipt.stopProof.startedAt)) &&
      typeof receipt.stopProof.stoppedAt === "string" && !Number.isNaN(Date.parse(receipt.stopProof.stoppedAt)) &&
      typeof receipt.stopProof.processIdentityDigest === "string" && digestPattern.test(receipt.stopProof.processIdentityDigest) &&
      typeof receipt.stopProof.processStartFingerprintDigest === "string" && digestPattern.test(receipt.stopProof.processStartFingerprintDigest)) &&
    receipt.stopProofBeforeDelete === true && receipt.exitCode === 0 && receipt.timedOut === false &&
    receipt.postDeleteAbsent === true;
}

export async function readRemoteRuntimeAssetLocator(db: Db, run: {
  id: string; companyId: string; runnerProfileJson: unknown; nativeSessionId: string | null; runnerInstanceId: string | null;
}): Promise<RemoteRuntimeAssetLocator | null> {
  const profile = run.runnerProfileJson && typeof run.runnerProfileJson === "object" && !Array.isArray(run.runnerProfileJson)
    ? run.runnerProfileJson as Record<string, unknown> : null;
  const candidate = profile?.nativeRemoteRuntimeAssetLocator;
  if (candidate === undefined || candidate === null) return null;
  if (!isRemoteRuntimeAssetLocator(candidate, run)) throw conflict("Native remote provider-data locator is invalid");
  const locator = candidate;
  if (!run.nativeSessionId || !run.runnerInstanceId ||
    sha256(run.nativeSessionId) !== locator.normalizedSessionIdDigest || run.runnerInstanceId !== locator.runnerInstanceId)
    throw conflict("Native remote provider-data locator does not match the durable Run identity");
  const [lease] = await db.select({ id: environmentLeases.id, environmentId: environmentLeases.environmentId,
    heartbeatRunId: environmentLeases.heartbeatRunId, provider: environmentLeases.provider,
    providerLeaseId: environmentLeases.providerLeaseId, metadata: environmentLeases.metadata })
    .from(environmentLeases).where(and(eq(environmentLeases.companyId, run.companyId),
      eq(environmentLeases.id, locator.environmentLeaseId)));
  const metadata = lease?.metadata;
  const remoteCwd = metadata && typeof metadata.remoteCwd === "string" ? metadata.remoteCwd.trim() : "";
  if (!lease || lease.heartbeatRunId !== run.id || lease.environmentId !== locator.environmentId ||
    lease.provider !== locator.provider || lease.provider === "local" || lease.providerLeaseId !== locator.providerLeaseId ||
    !remoteCwd || sha256(remoteCwd) !== locator.remoteCwdDigest)
    throw conflict("Native remote provider-data locator no longer matches its exact environment lease");
  return locator;
}

/** The remote tree can be reused by a later Run that resumes the same native
 * session. A single-run source erasure must therefore wait while any other
 * persisted Run may still own that exact session. Company purge may retire the
 * shared tree only when all co-owners are included in that same purge. */
export async function assertRemoteRuntimeAssetErasureReady(db: Db, locator: RemoteRuntimeAssetLocator,
  companyPurgeOperationId?: string) {
  const [run] = await db.select().from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, locator.companyId), eq(heartbeatRuns.id, locator.runId)));
  if (!run || run.runtimeMode !== "native" || run.driverKind !== "opencode_server" ||
    !["succeeded", "interrupted", "failed", "cancelled", "timed_out"].includes(run.status) ||
    run.processPid !== null || run.processGroupId !== null || run.controllerLeaseExpiresAt !== null)
    throw conflict("Managed remote OpenCode data erasure awaits confirmed Native Stop");
  const currentLocator = await readRemoteRuntimeAssetLocator(db, run);
  if (!currentLocator || remoteRuntimeAssetLocatorDigest(currentLocator) !== remoteRuntimeAssetLocatorDigest(locator))
    throw conflict("Managed remote OpenCode erasure locator is no longer current");
  const [job] = await db.select({ status: memoryJobs.status, operationType: memoryJobs.operationType,
    sourceRefJson: memoryJobs.sourceRefJson }).from(memoryJobs).where(and(
    eq(memoryJobs.companyId, locator.companyId), eq(memoryJobs.jobKey, runtimeAssetJobKey(locator.runId, []))))
    .orderBy(desc(memoryJobs.attemptNumber)).limit(1);
  const jobSource = job?.sourceRefJson as Record<string, unknown> | undefined;
  if (!job || job.operationType !== "retention" || !["queued", "running"].includes(job.status) ||
    jobSource?.kind !== "runtime_asset_erasure" || jobSource.runId !== locator.runId ||
    jobSource.companyPurgeOperationId !== companyPurgeOperationId ||
    !isRemoteRuntimeAssetLocator(jobSource.remoteAssetLocator, locator) ||
    remoteRuntimeAssetLocatorDigest(jobSource.remoteAssetLocator as RemoteRuntimeAssetLocator) !== remoteRuntimeAssetLocatorDigest(locator))
    throw conflict("Managed remote OpenCode erasure has no current exact MemoryJob authority");
  const [finalization] = await db.select({ phase: nativeRunFinalizations.phase, leaseOwner: nativeRunFinalizations.leaseOwner,
    leaseExpiresAt: nativeRunFinalizations.leaseExpiresAt }).from(nativeRunFinalizations).where(and(
    eq(nativeRunFinalizations.companyId, locator.companyId), eq(nativeRunFinalizations.runId, locator.runId)));
  if (!finalization || !["committed", "terminal_failure"].includes(finalization.phase) ||
    finalization.leaseOwner !== null || finalization.leaseExpiresAt !== null)
    throw conflict("Managed remote OpenCode data erasure awaits Native finalization");
  const remoteLeases = await db.select().from(environmentLeases).where(and(
    eq(environmentLeases.companyId, locator.companyId), eq(environmentLeases.id, locator.environmentLeaseId),
    eq(environmentLeases.heartbeatRunId, locator.runId)));
  if (remoteLeases.length !== 1 || remoteLeases.some(lease => lease.provider === "local" ||
    !["active", "pending_cleanup"].includes(lease.status) || lease.releasedAt !== null || lease.cleanupStatus === "success"))
    throw conflict("Managed remote OpenCode data erasure awaits its exact current cleanup lease");
  const coOwners = await db.select({ id: heartbeatRuns.id, companyId: heartbeatRuns.companyId,
    nativeSessionId: heartbeatRuns.nativeSessionId, runtimeMode: heartbeatRuns.runtimeMode,
    driverKind: heartbeatRuns.driverKind, status: heartbeatRuns.status, processPid: heartbeatRuns.processPid,
    processGroupId: heartbeatRuns.processGroupId, controllerLeaseExpiresAt: heartbeatRuns.controllerLeaseExpiresAt,
    runnerProfileJson: heartbeatRuns.runnerProfileJson }).from(heartbeatRuns).where(and(
    eq(heartbeatRuns.nativeSessionId, run.nativeSessionId ?? ""), eq(heartbeatRuns.runtimeMode, "native"),
    eq(heartbeatRuns.driverKind, "opencode_server")));
  const otherOwners = coOwners.filter(owner => owner.id !== run.id);
  if (!otherOwners.length) return { run, finalization, remoteLeases, coOwnerRunIds: [run.id] };
  if (!companyPurgeOperationId || !uuidPattern.test(companyPurgeOperationId))
    throw conflict("Managed remote OpenCode session still has another retained Run owner");
  const [operation] = await db.select({ companyId: companyDeletionOperations.companyId,
    stage: companyDeletionOperations.stage, status: companyDeletionOperations.status,
    evidence: companyDeletionOperations.evidence }).from(companyDeletionOperations).where(and(
    eq(companyDeletionOperations.companyId, locator.companyId), eq(companyDeletionOperations.id, companyPurgeOperationId)));
  if (!operation || operation.stage !== "purge" || operation.status !== "processing" ||
    typeof operation.evidence.runtimesErasedAt !== "string" || otherOwners.some(owner => owner.companyId !== locator.companyId))
    throw conflict("Managed remote OpenCode session has another Run outside the current company purge");
  for (const owner of otherOwners) {
    if (!owner.nativeSessionId || owner.status === "queued" || owner.status === "running" || owner.status === "scheduled_retry" ||
      owner.processPid !== null || owner.processGroupId !== null || owner.controllerLeaseExpiresAt !== null)
      throw conflict("Managed remote OpenCode session has an unsettled Run owner");
    const profile = owner.runnerProfileJson && typeof owner.runnerProfileJson === "object" && !Array.isArray(owner.runnerProfileJson)
      ? owner.runnerProfileJson as Record<string, unknown> : null;
    const otherLocator = profile?.nativeRemoteRuntimeAssetLocator;
    if (!isRemoteRuntimeAssetLocator(otherLocator, owner) ||
      otherLocator.normalizedSessionIdDigest !== locator.normalizedSessionIdDigest ||
      otherLocator.runnerInstanceId !== locator.runnerInstanceId || otherLocator.environmentId !== locator.environmentId ||
      otherLocator.provider !== locator.provider || otherLocator.providerLeaseId !== locator.providerLeaseId ||
      otherLocator.remoteCwdDigest !== locator.remoteCwdDigest)
      throw conflict("Managed remote OpenCode session co-owner does not have an exact matching erasure locator");
    const [otherFinalization] = await db.select({ phase: nativeRunFinalizations.phase, leaseOwner: nativeRunFinalizations.leaseOwner,
      leaseExpiresAt: nativeRunFinalizations.leaseExpiresAt }).from(nativeRunFinalizations).where(and(
      eq(nativeRunFinalizations.companyId, owner.companyId), eq(nativeRunFinalizations.runId, owner.id)));
    const leases = await db.select().from(environmentLeases).where(and(
      eq(environmentLeases.companyId, owner.companyId), eq(environmentLeases.id, otherLocator.environmentLeaseId),
      eq(environmentLeases.heartbeatRunId, owner.id)));
    const [job] = await db.select({ status: memoryJobs.status, sourceRefJson: memoryJobs.sourceRefJson,
      resultJson: memoryJobs.resultJson }).from(memoryJobs).where(and(
      eq(memoryJobs.companyId, owner.companyId), eq(memoryJobs.jobKey, runtimeAssetJobKey(owner.id, []))))
      .orderBy(desc(memoryJobs.attemptNumber)).limit(1);
    const jobSource = job?.sourceRefJson as Record<string, unknown> | undefined;
    if (!otherFinalization || !["committed", "terminal_failure"].includes(otherFinalization.phase) ||
      otherFinalization.leaseOwner !== null || otherFinalization.leaseExpiresAt !== null ||
      leases.length !== 1 || leases.some(lease => lease.provider === "local" ||
        !["active", "pending_cleanup"].includes(lease.status) || lease.releasedAt !== null || lease.cleanupStatus === "success") ||
      job?.status !== "queued" && job?.status !== "running" && job?.status !== "succeeded" ||
      jobSource?.companyPurgeOperationId !== companyPurgeOperationId ||
      !isRemoteRuntimeAssetLocator(jobSource.remoteAssetLocator, owner) ||
      remoteRuntimeAssetLocatorDigest(jobSource.remoteAssetLocator as RemoteRuntimeAssetLocator) !== remoteRuntimeAssetLocatorDigest(otherLocator) ||
      (job?.status === "succeeded" && !isRemoteRuntimeAssetRemovalReceipt(
        (job.resultJson as Record<string, unknown> | null)?.remoteRuntimeAssetRemovalReceipt, otherLocator)))
      throw conflict("Managed remote OpenCode session co-owner has not joined the current erasure operation");
  }
  return { run, finalization, remoteLeases, coOwnerRunIds: [run.id, ...otherOwners.map(owner => owner.id)] };
}

async function hasNativeRuntimeAssetStop(db: Db, companyId: string, runId: string) {
  const leases = await db.select().from(environmentLeases).where(and(
    eq(environmentLeases.companyId, companyId), eq(environmentLeases.heartbeatRunId, runId)));
  if (leases.some(lease => lease.provider !== "local")) {
    if (!leases.length || leases.some(lease => lease.provider === "local" ||
      !["active", "pending_cleanup"].includes(lease.status) || lease.releasedAt !== null)) return false;
    const [run] = await db.select({ id: heartbeatRuns.id, status: heartbeatRuns.status,
      processPid: heartbeatRuns.processPid, processGroupId: heartbeatRuns.processGroupId,
      controllerLeaseExpiresAt: heartbeatRuns.controllerLeaseExpiresAt }).from(heartbeatRuns).where(and(
      eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, runId)));
    const [finalization] = await db.select({ phase: nativeRunFinalizations.phase, leaseOwner: nativeRunFinalizations.leaseOwner,
      leaseExpiresAt: nativeRunFinalizations.leaseExpiresAt }).from(nativeRunFinalizations).where(and(
      eq(nativeRunFinalizations.companyId, companyId), eq(nativeRunFinalizations.runId, runId)));
    return Boolean(run && ["succeeded", "interrupted", "failed", "cancelled", "timed_out"].includes(run.status) &&
      run.processPid === null && run.processGroupId === null && run.controllerLeaseExpiresAt === null && finalization &&
      ["committed", "terminal_failure"].includes(finalization.phase) && finalization.leaseOwner === null && finalization.leaseExpiresAt === null);
  }
  return await hasNativeLocalProcessStop(db, companyId, runId);
}

export function nativeRuntimeAssetsRoot(owner?: NativeRuntimeAssetOwner) {
  const root = path.join(resolvePaperclipInstanceRoot(), "runtime-context-assets");
  if (!owner) return root;
  // Pure constructor fixtures use readable IDs; production admission verifies native UUID rows.
  if (![owner.companyId, owner.runId].every(id => /^[a-zA-Z0-9_-]+$/.test(id))) throw new Error("Invalid native runtime asset owner");
  return path.join(root, "runs", owner.companyId, owner.runId);
}

/** Managed OpenCode provider state is private to one canonical Native run. */
export function managedOpenCodeRuntimeDirectory(owner: NativeRuntimeAssetOwner) {
  return path.join(nativeRuntimeAssetsRoot(owner), "provider-opencode");
}

function legacyProfileDigests(profile: unknown) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return [] as string[];
  const nativeInput = (profile as Record<string, unknown>).nativeExecutionInput;
  if (!nativeInput || typeof nativeInput !== "object" || Array.isArray(nativeInput)) return [] as string[];
  const runtimeContext = (nativeInput as Record<string, unknown>).runtimeContext;
  if (!runtimeContext || typeof runtimeContext !== "object" || Array.isArray(runtimeContext)) return [] as string[];
  const context = runtimeContext as Record<string, unknown>;
  const instructions = context.instructions && typeof context.instructions === "object" && !Array.isArray(context.instructions)
    ? (context.instructions as Record<string, unknown>).bundle : undefined;
  const skills = Array.isArray(context.skills) ? context.skills : [];
  const bundles = [instructions, ...skills.map(skill => skill && typeof skill === "object" && !Array.isArray(skill)
    ? (skill as Record<string, unknown>).bundle : undefined)];
  const legacySuffix = `${path.sep}runtime-context-assets${path.sep}bundles${path.sep}`;
  const digests = new Set<string>();
  for (const candidate of bundles) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const ref = candidate as Record<string, unknown>;
    if (typeof ref.rootPath !== "string" || !ref.rootPath.includes(legacySuffix)) continue;
    if (typeof ref.digest !== "string" || !digestPattern.test(ref.digest) ||
      !ref.rootPath.endsWith(`${legacySuffix}${ref.digest}`))
      throw conflict("Native runtime profile has an invalid legacy asset reference");
    digests.add(ref.digest);
  }
  const result = [...digests].sort();
  if (result.length > 10_000) throw conflict("Native runtime profile exceeds the legacy asset erasure bound");
  return result;
}

function runtimeAssetJobKey(runId: string, digests: string[]) {
  return `runtime-asset-erasure:v1:${runId}${digests.length
    ? `:${createHash("sha256").update([...new Set(digests)].sort().join(",")).digest("hex")}` : ""}`;
}

function runtimeAssetDigestBatches(digests: string[]) {
  const sorted = [...new Set(digests)].sort();
  const batches: string[][] = [];
  for (let offset = 0; offset < sorted.length; offset += 256) batches.push(sorted.slice(offset, offset + 256));
  return batches;
}

async function legacyAssetDigestSetAbsent(digests: string[]) {
  const root = resolvePaperclipInstanceRoot(), assetsRoot = nativeRuntimeAssetsRoot();
  for (const digest of new Set(digests)) {
    for (const target of [path.join(assetsRoot, "bundles", digest), path.join(assetsRoot, "manifests", `${digest}.json`)]) {
      try {
        await assertRuntimeStorageDirectories(target, root);
        return false;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
  return true;
}

async function companyManagedOpenCodeRuntimeRunIds(companyId: string) {
  const storageRoot = resolvePaperclipInstanceRoot();
  const companyRunsRoot = path.join(nativeRuntimeAssetsRoot(), "runs", companyId);
  let entries: Dir;
  try {
    await assertRuntimeStorageDirectories(companyRunsRoot, storageRoot);
    entries = await fs.opendir(companyRunsRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw conflict("Unsafe Native runtime asset storage blocks company erasure");
  }
  const found: string[] = [];
  const deadline = Date.now() + 5_000;
  let inspected = 0;
  for await (const entry of entries) {
    if (++inspected > 10_000 || Date.now() >= deadline)
      throw conflict("Managed OpenCode runtime inventory exceeded its company erasure bound");
    if (entry.isSymbolicLink() || !entry.isDirectory() || !uuidPattern.test(entry.name))
      throw conflict("Unsafe Native runtime asset storage blocks company erasure");
    try {
      await assertRuntimeStorageDirectories(managedOpenCodeRuntimeDirectory({ companyId, runId: entry.name }), storageRoot);
      found.push(entry.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw conflict("Unsafe managed OpenCode runtime storage blocks company erasure");
    }
  }
  return found;
}

/** Company purge may delete Run owners only after their managed provider homes are gone. */
export async function assertCompanyManagedOpenCodeRuntimeDataErased(db: Db, companyId: string, operationId?: string) {
  if ((await companyManagedOpenCodeRuntimeRunIds(companyId)).length)
    throw conflict("Managed OpenCode runtime data must be erased before company content purge");
  const nativeRuns = await db.select({ id: heartbeatRuns.id, companyId: heartbeatRuns.companyId,
    nativeSessionId: heartbeatRuns.nativeSessionId, runnerInstanceId: heartbeatRuns.runnerInstanceId,
    runnerProfileJson: heartbeatRuns.runnerProfileJson }).from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.runtimeMode, "native"),
    eq(heartbeatRuns.driverKind, "opencode_server"),
  ));
  if (nativeRuns.length) {
    if (!operationId || !uuidPattern.test(operationId))
      throw conflict("Native OpenCode runs require the current company-purge erasure receipt");
    const runIds = nativeRuns.map(run => run.id);
    const jobs = await db.select({ jobKey: memoryJobs.jobKey, attemptNumber: memoryJobs.attemptNumber,
      status: memoryJobs.status, sourceRefJson: memoryJobs.sourceRefJson, resultJson: memoryJobs.resultJson }).from(memoryJobs).where(and(
      eq(memoryJobs.companyId, companyId),
      inArray(sql<string>`${memoryJobs.sourceRefJson}->>'runId'`, runIds),
      sql`${memoryJobs.sourceRefJson}->>'kind'='runtime_asset_erasure'`,
    )).orderBy(memoryJobs.jobKey, desc(memoryJobs.attemptNumber));
    const latest = new Map<string, typeof jobs[number]>();
    for (const job of jobs) if (!latest.has(job.jobKey)) latest.set(job.jobKey, job);
    for (const run of nativeRuns) {
      const remoteLocator = await readRemoteRuntimeAssetLocator(db, run);
      const base = latest.get(runtimeAssetJobKey(run.id, []));
      const baseSource = base?.sourceRefJson as Record<string, unknown> | undefined;
      if (base?.status !== "succeeded" || baseSource?.kind !== "runtime_asset_erasure" || baseSource.runId !== run.id ||
        baseSource.companyPurgeOperationId !== operationId || !Array.isArray(baseSource.legacyDigests) || baseSource.legacyDigests.length !== 0 ||
        (remoteLocator && (!isRemoteRuntimeAssetLocator(baseSource.remoteAssetLocator, run) ||
          remoteRuntimeAssetLocatorDigest(baseSource.remoteAssetLocator as RemoteRuntimeAssetLocator) !== remoteRuntimeAssetLocatorDigest(remoteLocator) ||
          !isRemoteRuntimeAssetRemovalReceipt((base?.resultJson as Record<string, unknown> | null)?.remoteRuntimeAssetRemovalReceipt, remoteLocator))))
        throw conflict("Native OpenCode provider-home erasure has not succeeded for the current purge operation");
      const refs = legacyProfileDigests(run.runnerProfileJson);
      const covered = new Set<string>();
      for (const job of latest.values()) {
        const source = job.sourceRefJson as Record<string, unknown>;
        if (source.runId !== run.id || source.companyPurgeOperationId !== operationId) continue;
        if (job.jobKey === runtimeAssetJobKey(run.id, [])) continue;
        if (job.status !== "succeeded" || source.kind !== "runtime_asset_erasure" || !Array.isArray(source.legacyDigests) ||
          source.legacyDigests.length < 1 || source.legacyDigests.length > 256 ||
          source.legacyDigests.some(digest => typeof digest !== "string" || !digestPattern.test(digest)) ||
          runtimeAssetJobKey(run.id, source.legacyDigests as string[]) !== job.jobKey)
          throw conflict("Native OpenCode legacy asset erasure batch is not an exact succeeded receipt");
        for (const digest of source.legacyDigests as string[]) covered.add(digest);
      }
      if (refs.some(digest => !covered.has(digest)))
        throw conflict("Native OpenCode legacy asset erasure has not covered every current profile digest");
      if (!await legacyAssetDigestSetAbsent(refs))
        throw conflict("Native OpenCode legacy runtime assets remain on disk after their erasure receipt");
    }
  }
  const attempts = await db.select({ jobKey: memoryJobs.jobKey, attemptNumber: memoryJobs.attemptNumber, status: memoryJobs.status,
    sourceRefJson: memoryJobs.sourceRefJson })
    .from(memoryJobs).where(and(eq(memoryJobs.companyId, companyId), sql`${memoryJobs.sourceRefJson}->>'companyPurgeOperationId' is not null`))
    .orderBy(memoryJobs.jobKey, desc(memoryJobs.attemptNumber));
  const latest = new Map<string, typeof attempts[number]>();
  for (const job of attempts) if (!latest.has(job.jobKey)) latest.set(job.jobKey, job);
  const erasedLegacyDigests = new Set<string>();
  if ([...latest.values()].some(job => {
    const source = job.sourceRefJson as Record<string, unknown>;
    const invalid = job.status !== "succeeded" || source.kind !== "runtime_asset_erasure" ||
      typeof source.runId !== "string" || !nativeRuns.some(run => run.id === source.runId) ||
      source.companyPurgeOperationId !== operationId || !Array.isArray(source.legacyDigests) ||
      source.legacyDigests.some(digest => typeof digest !== "string" || !digestPattern.test(digest)) ||
      source.legacyDigests.length > 256 || runtimeAssetJobKey(source.runId as string, source.legacyDigests as string[]) !== job.jobKey;
    if (!invalid && Array.isArray(source.legacyDigests))
      for (const digest of source.legacyDigests as string[]) erasedLegacyDigests.add(digest);
    return invalid;
  }))
    throw conflict("Managed OpenCode runtime erasure outbox has not succeeded");
  if (!await legacyAssetDigestSetAbsent([...erasedLegacyDigests]))
    throw conflict("Native OpenCode legacy runtime assets remain on disk after their erasure receipt");
}

/** Durable first phase for canonical company offboarding; Run rows remain until these jobs finish. */
export async function enqueueCompanyManagedOpenCodeRuntimeErasure(db: Db, companyId: string, operationId: string) {
  if (!uuidPattern.test(operationId)) throw new Error("Invalid company offboarding erasure binding");
  return db.transaction(async rawTx => {
    const tx = rawTx as unknown as Db;
    await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
    // Privacy advisory locks precede Company/Run/Operation row pins throughout
    // the Native source owner graph. Re-read every row only after those waits.
    await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).for("update");
    const [operation] = await tx.select({ stage: companyDeletionOperations.stage, status: companyDeletionOperations.status,
      evidence: companyDeletionOperations.evidence }).from(companyDeletionOperations).where(and(
      eq(companyDeletionOperations.id, operationId), eq(companyDeletionOperations.companyId, companyId))).for("update");
    if (!operation || operation.stage !== "purge" || operation.status !== "processing" ||
      typeof operation.evidence.runtimesErasedAt !== "string")
      throw conflict("Managed OpenCode erasure requires the current canonical company purge operation");
    const runs = await tx.select({ id: heartbeatRuns.id, status: heartbeatRuns.status,
      runtimeMode: heartbeatRuns.runtimeMode, driverKind: heartbeatRuns.driverKind,
      companyId: heartbeatRuns.companyId, nativeSessionId: heartbeatRuns.nativeSessionId,
      runnerInstanceId: heartbeatRuns.runnerInstanceId,
      processPid: heartbeatRuns.processPid, processGroupId: heartbeatRuns.processGroupId,
      controllerLeaseExpiresAt: heartbeatRuns.controllerLeaseExpiresAt,
      runnerProfileJson: heartbeatRuns.runnerProfileJson }).from(heartbeatRuns)
      .where(eq(heartbeatRuns.companyId, companyId)).for("update");
    const ownedRunIds = new Set(runs.map(run => run.id));
    const providerHomeRunIds = await companyManagedOpenCodeRuntimeRunIds(companyId);
    if (providerHomeRunIds.some(runId => !ownedRunIds.has(runId)))
      throw conflict("Managed OpenCode runtime data has no current Run Stop owner");
    const scheduled: string[] = [];
    const providerHomes = new Set(providerHomeRunIds);
    for (const run of runs) {
      const nativeOpenCodeRun = run.runtimeMode === "native" && run.driverKind === "opencode_server";
      const existingJobs = await tx.select({ id: memoryJobs.id, jobKey: memoryJobs.jobKey,
        attemptNumber: memoryJobs.attemptNumber, status: memoryJobs.status, operationType: memoryJobs.operationType,
        sourceRefJson: memoryJobs.sourceRefJson, resultJson: memoryJobs.resultJson }).from(memoryJobs).where(and(
        eq(memoryJobs.companyId, companyId), sql`${memoryJobs.sourceRefJson}->>'runId'=${run.id}`,
        sql`${memoryJobs.sourceRefJson}->>'kind'='runtime_asset_erasure'`))
        .orderBy(memoryJobs.jobKey, desc(memoryJobs.attemptNumber)).for("update");
      const latestByKey = new Map<string, typeof existingJobs[number]>();
      for (const existing of existingJobs) if (!latestByKey.has(existing.jobKey)) latestByKey.set(existing.jobKey, existing);
      const previousDigests: string[] = [];
      for (const existing of latestByKey.values()) {
        const source = existing.sourceRefJson as Record<string, unknown>;
        if (!Array.isArray(source.legacyDigests) || source.legacyDigests.length > 256 ||
          source.legacyDigests.some(value => typeof value !== "string" || !digestPattern.test(value)) ||
          runtimeAssetJobKey(run.id, source.legacyDigests as string[]) !== existing.jobKey)
          throw conflict("Managed OpenCode erasure has an invalid legacy digest receipt");
        previousDigests.push(...source.legacyDigests as string[]);
      }
      const currentDigests = nativeOpenCodeRun ? legacyProfileDigests(run.runnerProfileJson) : [];
      const expectedDigests = [...new Set([...previousDigests, ...currentDigests])].sort();
      if (expectedDigests.length > 10_000) throw conflict("Native runtime profile exceeds the legacy asset erasure bound");
      const jobSpecs = [{ jobKey: runtimeAssetJobKey(run.id, []), digests: [] as string[] },
        ...runtimeAssetDigestBatches(expectedDigests).map(digests => ({ jobKey: runtimeAssetJobKey(run.id, digests), digests }))];
      const remoteLocator = nativeOpenCodeRun ? await readRemoteRuntimeAssetLocator(tx, run) : null;
      const runProfile = run.runnerProfileJson && typeof run.runnerProfileJson === "object" && !Array.isArray(run.runnerProfileJson)
        ? run.runnerProfileJson as Record<string, unknown> : null;
      const runHasManagedOpenCodeAuthority = Boolean(runProfile?.nativeOpenCodeSourceAuthority);
      const [remoteLease] = nativeOpenCodeRun ? await tx.select({ provider: environmentLeases.provider }).from(environmentLeases).where(and(
        eq(environmentLeases.companyId, companyId), eq(environmentLeases.heartbeatRunId, run.id),
        sql`${environmentLeases.provider} is not null and ${environmentLeases.provider}<>'local'`)).limit(1) : [];
      if (runHasManagedOpenCodeAuthority && remoteLease && !remoteLocator)
        throw conflict("Managed remote OpenCode data has no durable run-bound erasure locator");
      const authorizedPending = [...latestByKey.values()].some(existing => {
        const source = existing.sourceRefJson as Record<string, unknown>;
        return source.companyPurgeOperationId === operationId && existing.status !== "succeeded";
      });
      if (!providerHomes.has(run.id) && !authorizedPending && !nativeOpenCodeRun) continue;
      let runNeedsWork = false;
      for (const spec of jobSpecs) {
        const existing = latestByKey.get(spec.jobKey);
        if (existing && existing.operationType !== "retention")
          throw conflict("Managed OpenCode erasure found a conflicting outbox owner");
        const source = existing?.sourceRefJson as Record<string, unknown> | undefined;
        const sameDigestSet = Array.isArray(source?.legacyDigests) && source.legacyDigests.length === spec.digests.length &&
          spec.digests.every(digest => (source.legacyDigests as unknown[]).includes(digest));
        const exactSucceededReceipt = existing?.status === "succeeded" && existing.operationType === "retention" &&
          source?.kind === "runtime_asset_erasure" && source.runId === run.id &&
          source.companyPurgeOperationId === operationId && sameDigestSet &&
          await legacyAssetDigestSetAbsent(spec.digests);
        const isRemoteProviderHomeJob = spec.digests.length === 0 && remoteLocator !== null;
        const remoteReceiptIsCurrent = !isRemoteProviderHomeJob ||
          (isRemoteRuntimeAssetLocator(source?.remoteAssetLocator, run) &&
            remoteRuntimeAssetLocatorDigest(source.remoteAssetLocator as RemoteRuntimeAssetLocator) === remoteRuntimeAssetLocatorDigest(remoteLocator!) &&
            isRemoteRuntimeAssetRemovalReceipt((existing?.resultJson as Record<string, unknown> | null)?.remoteRuntimeAssetRemovalReceipt, remoteLocator!));
        const providerHomeMustRun = spec.digests.length === 0 && (providerHomes.has(run.id) || isRemoteProviderHomeJob) && !remoteReceiptIsCurrent;
        if (exactSucceededReceipt && !providerHomeMustRun) continue;
        if (existing?.status === "running") { runNeedsWork = true; continue; }
        if (existing && existing.status !== "queued" &&
          (run.processPid !== null || run.processGroupId !== null || run.controllerLeaseExpiresAt !== null ||
            !["succeeded", "interrupted", "failed", "cancelled", "timed_out"].includes(run.status) ||
            !await hasNativeRuntimeAssetStop(tx, companyId, run.id))) {
          runNeedsWork = true;
          continue;
        }
      const sourceRefJson = { kind: "runtime_asset_erasure", runId: run.id, legacyDigests: spec.digests,
        ...(spec.digests.length === 0 && remoteLocator ? { remoteAssetLocator: remoteLocator } : {}), companyPurgeOperationId: operationId };
        if (existing) {
          await tx.update(memoryJobs).set({ status: "queued", executionOwnerId: null, leaseExpiresAt: null,
            finishedAt: null, resultJson: null, resultSummary: null, error: null, errorCode: null,
            sourceRefJson, updatedAt: new Date() }).where(eq(memoryJobs.id, existing.id));
        } else {
          await tx.insert(memoryJobs).values({ companyId, operationType: "retention", jobKey: spec.jobKey, sourceRefJson });
        }
        runNeedsWork = true;
      }
      if (runNeedsWork) scheduled.push(run.id);
    }
    return scheduled;
  });
}

/**
 * Retire old global-bundle references only after the canonical company purge
 * has a current Run-owned empty-digest erasure receipt. Run/Stop owners remain
 * present so the existing bounded retention worker can prove physical removal
 * on its next pass.
 */
export async function retireCompanyNativeLegacyRuntimeProfiles(db: Db, companyId: string, operationId: string) {
  if (!uuidPattern.test(companyId) || !uuidPattern.test(operationId))
    throw conflict("Native legacy profile retirement binding is invalid");
  return db.transaction(async rawTx => {
    const tx = rawTx as unknown as Db;
    await lockAnalyticalCompany(tx, companyId);
    await lockMemoryPrivacy(tx, companyId);
    const [company] = await tx.select({ id: companies.id, status: companies.status, pauseReason: companies.pauseReason })
      .from(companies).where(eq(companies.id, companyId)).for("update");
    if (!company) throw conflict("Native legacy profile retirement has no current Company owner");
    const [operation] = await tx.select({ id: companyDeletionOperations.id, stage: companyDeletionOperations.stage,
      status: companyDeletionOperations.status, evidence: companyDeletionOperations.evidence })
      .from(companyDeletionOperations).where(and(eq(companyDeletionOperations.companyId, companyId),
        eq(companyDeletionOperations.id, operationId))).for("update");
    if (company.status !== "archived" || !operation ||
      operation.stage !== "purge" || operation.status !== "processing" ||
      typeof operation.evidence.runtimesErasedAt !== "string")
      throw conflict("Native legacy profile retirement requires the current archived company purge");
    const runs = await tx.select({ id: heartbeatRuns.id, status: heartbeatRuns.status, runtimeMode: heartbeatRuns.runtimeMode,
      driverKind: heartbeatRuns.driverKind, processPid: heartbeatRuns.processPid, processGroupId: heartbeatRuns.processGroupId,
      controllerLeaseExpiresAt: heartbeatRuns.controllerLeaseExpiresAt, runnerProfileJson: heartbeatRuns.runnerProfileJson })
      .from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.runtimeMode, "native"),
        eq(heartbeatRuns.driverKind, "opencode_server"))).for("update");
    const retiring = runs.filter(run => legacyProfileDigests(run.runnerProfileJson).length > 0);
    if (!retiring.length) return [] as string[];
    for (const run of retiring) {
      if (run.runtimeMode !== "native" || run.driverKind !== "opencode_server" ||
        !["succeeded", "interrupted", "failed", "cancelled", "timed_out"].includes(run.status) ||
        run.processPid !== null || run.processGroupId !== null || run.controllerLeaseExpiresAt !== null ||
        !await hasNativeLocalProcessStop(tx, companyId, run.id))
        throw conflict("Native legacy profile retirement awaits the exact Run Stop owner");
      const [finalization] = await tx.select({ phase: nativeRunFinalizations.phase,
        leaseOwner: nativeRunFinalizations.leaseOwner, leaseExpiresAt: nativeRunFinalizations.leaseExpiresAt })
        .from(nativeRunFinalizations).where(and(eq(nativeRunFinalizations.companyId, companyId),
          eq(nativeRunFinalizations.runId, run.id))).for("share");
      if (!finalization || !["committed", "terminal_failure"].includes(finalization.phase) ||
        finalization.leaseOwner !== null || finalization.leaseExpiresAt !== null)
        throw conflict("Native legacy profile retirement awaits the committed Run finalization");
      const [baseJob] = await tx.select({ status: memoryJobs.status, sourceRefJson: memoryJobs.sourceRefJson })
        .from(memoryJobs).where(and(eq(memoryJobs.companyId, companyId),
          eq(memoryJobs.jobKey, runtimeAssetJobKey(run.id, []))))
        .orderBy(desc(memoryJobs.attemptNumber)).limit(1).for("share");
      const source = baseJob?.sourceRefJson as Record<string, unknown> | undefined;
      if (baseJob?.status !== "succeeded" || source?.kind !== "runtime_asset_erasure" || source.runId !== run.id ||
        source.companyPurgeOperationId !== operationId || !Array.isArray(source.legacyDigests) || source.legacyDigests.length !== 0)
        throw conflict("Native legacy profile retirement requires the current provider-home erasure receipt");
    }
    const now = new Date();
    const tombstone = await tx.update(companies).set({
      pauseReason: "company_deleted", contentErasureTransactionId: sql`pg_current_xact_id()::text`, updatedAt: now,
    }).where(and(eq(companies.id, companyId), eq(companies.status, "archived"))).returning({ id: companies.id });
    if (!tombstone.length) throw conflict("Canonical company erasure owner changed before legacy profile retirement");
    const runIds = retiring.map(run => run.id);
    await purgeDerivedWorkflowMemory(tx, companyId, [], now, {
      workflowRevisionIds: [], artifactVersionIds: [], runIds, companyPurgeOperationId: operationId,
    });
    return runIds;
  });
}

export async function enqueueCompanyRuntimeAssetErasure(tx: Db, companyId: string) {
  const runs = await tx.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(eq(heartbeatRuns.companyId, companyId));
  for (const run of runs) {
    // The native DELETE trigger captures legacy global references before profile deletion.
    await tx.insert(memoryJobs).values({ companyId, operationType: "retention", jobKey: `runtime-asset-erasure:v1:${run.id}`,
      sourceRefJson: { kind: "runtime_asset_erasure", runId: run.id, legacyDigests: [] } }).onConflictDoNothing();
  }
}

/** Actual persisted runs and their existing outbox own generated copies, never user-supplied paths. */
export async function eraseNativeRuntimeAssets(db: Db, owner: NativeRuntimeAssetOwner, legacyDigests: string[],
  authorization?: { companyPurgeOperationId?: string; remoteAssetLocator?: RemoteRuntimeAssetLocator;
    remoteAssetReceipt?: RemoteRuntimeAssetRemovalReceipt }) {
  if (![owner.companyId, owner.runId].every(id => uuidPattern.test(id)) || legacyDigests.length > 256 ||
    legacyDigests.some(digest => !digestPattern.test(digest)) ||
    (authorization?.companyPurgeOperationId !== undefined && !uuidPattern.test(authorization.companyPurgeOperationId)))
    throw new Error("Invalid native runtime asset erasure binding");
  await db.transaction(async rawTx => {
    const tx = rawTx as unknown as Db;
    await lockAnalyticalCompany(tx, owner.companyId); await lockMemoryPrivacy(tx, owner.companyId);
    let companyPurgeAuthorized = false;
    if (authorization?.companyPurgeOperationId) {
      const [operation] = await tx.select({ stage: companyDeletionOperations.stage, status: companyDeletionOperations.status,
        evidence: companyDeletionOperations.evidence }).from(companyDeletionOperations).where(and(
        eq(companyDeletionOperations.companyId, owner.companyId),
        eq(companyDeletionOperations.id, authorization.companyPurgeOperationId)));
      companyPurgeAuthorized = operation?.stage === "purge" && operation.status === "processing" &&
        typeof operation.evidence.runtimesErasedAt === "string";
    }
    const [run] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, owner.companyId), eq(heartbeatRuns.id, owner.runId)));
    const providerHome = managedOpenCodeRuntimeDirectory(owner);
    let providerHomeExists = false;
    try {
      await assertRuntimeStorageDirectories(providerHome, resolvePaperclipInstanceRoot());
      providerHomeExists = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (providerHomeExists && !run) throw new Error("Managed OpenCode data erasure has no current Run Stop owner");
    if (run) {
      const [source] = await tx.execute<{ erased: boolean }>(sql`select aw_workflow_memory_erased(${owner.companyId}::uuid,${owner.runId}::uuid,NULL) as erased`);
      if (!source?.erased && !companyPurgeAuthorized) throw new Error("Native runtime assets have no Source erasure receipt");
      if (providerHomeExists || companyPurgeAuthorized) {
        if (run.runtimeMode !== "native" || run.driverKind !== "opencode_server" ||
          !["succeeded", "interrupted", "failed", "cancelled", "timed_out"].includes(run.status) ||
          run.processPid !== null || run.processGroupId !== null || run.controllerLeaseExpiresAt !== null) {
          throw new Error("Managed OpenCode data erasure awaits confirmed Native Stop");
        }
        const [finalization] = await tx.select({ phase: nativeRunFinalizations.phase,
          leaseOwner: nativeRunFinalizations.leaseOwner, leaseExpiresAt: nativeRunFinalizations.leaseExpiresAt })
          .from(nativeRunFinalizations).where(and(eq(nativeRunFinalizations.companyId, owner.companyId),
            eq(nativeRunFinalizations.runId, owner.runId)));
        if (!finalization || !["committed", "terminal_failure"].includes(finalization.phase) ||
          finalization.leaseOwner !== null || finalization.leaseExpiresAt !== null ||
          (!authorization?.remoteAssetLocator && !await hasNativeLocalProcessStop(tx, owner.companyId, owner.runId))) {
          throw new Error("Managed OpenCode data erasure awaits Native Stop receipt");
        }
      }
      const runProfile = run.runnerProfileJson && typeof run.runnerProfileJson === "object" && !Array.isArray(run.runnerProfileJson)
        ? run.runnerProfileJson as Record<string, unknown> : null;
      const persistedRemoteLocator = runProfile?.nativeRemoteRuntimeAssetLocator;
      if (persistedRemoteLocator !== undefined && persistedRemoteLocator !== null) {
        if (!isRemoteRuntimeAssetLocator(persistedRemoteLocator, owner))
          throw conflict("Managed remote OpenCode data erasure has an invalid durable locator");
        if (authorization?.remoteAssetLocator || authorization?.remoteAssetReceipt) {
          if (!authorization.remoteAssetLocator || !authorization.remoteAssetReceipt ||
            !isRemoteRuntimeAssetLocator(authorization.remoteAssetLocator, owner) ||
            remoteRuntimeAssetLocatorDigest(persistedRemoteLocator as RemoteRuntimeAssetLocator) !==
              remoteRuntimeAssetLocatorDigest(authorization.remoteAssetLocator) ||
            !isRemoteRuntimeAssetRemovalReceipt(authorization.remoteAssetReceipt, authorization.remoteAssetLocator))
            throw conflict("Managed remote OpenCode data erasure has no exact removal receipt");
          await assertRemoteRuntimeAssetErasureReady(tx, authorization.remoteAssetLocator, authorization.companyPurgeOperationId);
        } else if (legacyDigests.length > 0 && authorization?.companyPurgeOperationId && companyPurgeAuthorized) {
          const [baseJob] = await tx.select({ status: memoryJobs.status, sourceRefJson: memoryJobs.sourceRefJson,
            resultJson: memoryJobs.resultJson }).from(memoryJobs).where(and(
            eq(memoryJobs.companyId, owner.companyId), eq(memoryJobs.jobKey, runtimeAssetJobKey(owner.runId, []))))
            .orderBy(desc(memoryJobs.attemptNumber)).limit(1);
          const source = baseJob?.sourceRefJson as Record<string, unknown> | undefined;
          if (baseJob?.status !== "succeeded" || !isRemoteRuntimeAssetLocator(source?.remoteAssetLocator, owner) ||
            remoteRuntimeAssetLocatorDigest(source.remoteAssetLocator as RemoteRuntimeAssetLocator) !==
              remoteRuntimeAssetLocatorDigest(persistedRemoteLocator as RemoteRuntimeAssetLocator) ||
            !isRemoteRuntimeAssetRemovalReceipt((baseJob.resultJson as Record<string, unknown> | null)?.remoteRuntimeAssetRemovalReceipt,
              persistedRemoteLocator as RemoteRuntimeAssetLocator))
            throw conflict("Managed remote OpenCode data erasure has no succeeded exact provider-root removal receipt");
        } else throw conflict("Managed remote OpenCode data erasure has no exact removal receipt");
      } else if (authorization?.remoteAssetLocator || authorization?.remoteAssetReceipt) {
        throw conflict("Managed remote OpenCode erasure locator is not present in the durable Run owner");
      } else if (runProfile?.nativeOpenCodeSourceAuthority) {
        const [remoteLease] = await tx.select({ provider: environmentLeases.provider }).from(environmentLeases).where(and(
          eq(environmentLeases.companyId, owner.companyId), eq(environmentLeases.heartbeatRunId, owner.runId),
          sql`${environmentLeases.provider} is not null and ${environmentLeases.provider}<>'local'`)).limit(1);
        if (remoteLease) throw conflict("Managed remote OpenCode data has no durable run-bound erasure locator");
      }
    }
    const storageRoot = resolvePaperclipInstanceRoot(), runRoot = nativeRuntimeAssetsRoot(owner);
    try {
      await assertRuntimeStorageDirectories(runRoot, storageRoot);
      await removeRuntimeStorageTree(runRoot);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    // ponytail: scan original persisted profiles for each of at most 256 legacy digests;
    // use a native expression index if historical profile volume needs it.
    for (const digest of new Set(legacyDigests)) {
      const erased = await eraseUnreferencedLegacyAsset(tx, digest);
      if (erased === null)
        throw conflict("Native legacy runtime asset is still retained by a current Run profile");
    }
  });
}

async function eraseUnreferencedLegacyAsset(tx: Db, digest: string): Promise<boolean | null> {
  const storageRoot = resolvePaperclipInstanceRoot();
  const root = nativeRuntimeAssetsRoot(), bundle = path.join(root, "bundles", digest), manifest = path.join(root, "manifests", `${digest}.json`);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'native-runtime-asset:'+digest},0))`);
  const [retained] = await tx.execute<{ present: boolean }>(sql`select exists(select 1 from heartbeat_runs h where
    (h.runner_profile_json #> '{nativeExecutionInput,runtimeContext,instructions,bundle}') @> ${JSON.stringify({ digest, rootPath: bundle })}::jsonb
    or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(h.runner_profile_json #> '{nativeExecutionInput,runtimeContext,skills}')='array'
      then h.runner_profile_json #> '{nativeExecutionInput,runtimeContext,skills}' else '[]'::jsonb end) s
      where (s->'bundle') @> ${JSON.stringify({ digest, rootPath: bundle })}::jsonb)) as present`);
  if (retained?.present !== false) return null;
  let removed = false;
  try {
    await assertRuntimeStorageDirectories(bundle, storageRoot);
    await removeRuntimeStorageTree(bundle); removed = true;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  try {
    await assertRuntimeStorageDirectories(path.dirname(manifest), storageRoot);
    const stat = await fs.lstat(manifest);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Unsafe native runtime manifest erasure path");
    await fs.unlink(manifest); removed = true;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return removed;
}

/** Instance-owned cache maintenance; no caller paths, payload reads or tenant authority. */
export async function reconcileLegacyNativeRuntimeAssets(db: Db) {
  const result = { removed: 0, deferredActiveRuns: false, deferredConcurrentSweep: false };
  const deadline = Date.now() + 30_000;
  return db.transaction(async rawTx => {
    const tx = rawTx as unknown as Db;
    await tx.execute(sql`set local statement_timeout='8s'`);
    const [lock] = await tx.execute<{ acquired: boolean }>(sql`select pg_try_advisory_xact_lock(hashtextextended('native-runtime-asset-reconciliation',0)) as acquired`);
    if (!lock?.acquired) return { ...result, deferredConcurrentSweep: true };
    const [active] = await tx.execute<{ present: boolean }>(sql`select exists(select 1 from heartbeat_runs where status in ('queued','running','scheduled_retry')) as present`);
    // ponytail: legacy publication has no owner. Wait for an idle instance;
    // continuous activity requires an operator maintenance window on a single-version fleet.
    if (active?.present) return { ...result, deferredActiveRuns: true };
    const root = nativeRuntimeAssetsRoot(), storageRoot = resolvePaperclipInstanceRoot();
    for (const namespace of ["bundles", "manifests", ".staging"] as const) {
      const directory = path.join(root, namespace);
      let entries: Dir;
      try {
        await assertRuntimeStorageDirectories(directory, storageRoot);
        entries = await fs.opendir(directory);
      } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
      // Streaming directory iteration bounds memory. Retained entries do not consume
      // the removal budget; the next tick can reach remaining orphans without a cursor.
      for await (const entry of entries) {
        if (Date.now() >= deadline) throw new Error("Legacy runtime asset reconciliation exceeded its bound");
        if (entry.isSymbolicLink()) throw new Error("Unsafe legacy runtime asset reconciliation path");
        if (namespace === ".staging") {
          if (!uuidPattern.test(entry.name) || !entry.isDirectory()) throw new Error("Unsafe legacy runtime staging entry");
          const candidate = path.join(directory, entry.name);
          try {
            await assertRuntimeStorageDirectories(candidate, storageRoot);
            await removeRuntimeStorageTree(candidate); result.removed++;
          } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        } else {
          const digest = namespace === "manifests" ? entry.name.replace(/\.json$/, "") : entry.name;
          if (!digestPattern.test(digest) || (namespace === "manifests" ? entry.name !== `${digest}.json` || !entry.isFile() : !entry.isDirectory()))
            throw new Error("Unsafe legacy runtime asset entry");
          if (await eraseUnreferencedLegacyAsset(tx, digest)) result.removed++;
        }
        if (result.removed >= 16) return result;
      }
    }
    return result;
  });
}
