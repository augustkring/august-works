import path from "node:path";
import fs from "node:fs/promises";
import type { Dir } from "node:fs";
import { and, desc, eq, sql } from "drizzle-orm";
import { companies, companyDeletionOperations, heartbeatRuns, memoryJobs, nativeRunFinalizations, type Db } from "@paperclipai/db";
import { resolvePaperclipInstanceRoot } from "../../home-paths.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { hasNativeLocalProcessStop } from "../native-local-process-stop.js";
import { assertRuntimeStorageDirectories, removeRuntimeStorageTree } from "../runtime-skill-cache.js";
import { conflict } from "../../errors.js";

export type NativeRuntimeAssetOwner = { companyId: string; runId: string };
const digestPattern = /^[a-f0-9]{64}$/;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

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
export async function assertCompanyManagedOpenCodeRuntimeDataErased(db: Db, companyId: string) {
  if ((await companyManagedOpenCodeRuntimeRunIds(companyId)).length)
    throw conflict("Managed OpenCode runtime data must be erased before company content purge");
  const attempts = await db.select({ jobKey: memoryJobs.jobKey, attemptNumber: memoryJobs.attemptNumber, status: memoryJobs.status })
    .from(memoryJobs).where(and(eq(memoryJobs.companyId, companyId), sql`${memoryJobs.sourceRefJson}->>'companyPurgeOperationId' is not null`))
    .orderBy(memoryJobs.jobKey, desc(memoryJobs.attemptNumber));
  const latest = new Map<string, typeof attempts[number]>();
  for (const job of attempts) if (!latest.has(job.jobKey)) latest.set(job.jobKey, job);
  if ([...latest.values()].some(job => job.status !== "succeeded"))
    throw conflict("Managed OpenCode runtime erasure outbox has not succeeded");
}

/** Durable first phase for canonical company offboarding; Run rows remain until these jobs finish. */
export async function enqueueCompanyManagedOpenCodeRuntimeErasure(db: Db, companyId: string, operationId: string) {
  if (!uuidPattern.test(operationId)) throw new Error("Invalid company offboarding erasure binding");
  return db.transaction(async rawTx => {
    const tx = rawTx as unknown as Db;
    await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).for("update");
    await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
    const [operation] = await tx.select({ stage: companyDeletionOperations.stage, status: companyDeletionOperations.status,
      evidence: companyDeletionOperations.evidence }).from(companyDeletionOperations).where(and(
      eq(companyDeletionOperations.id, operationId), eq(companyDeletionOperations.companyId, companyId))).for("update");
    if (!operation || operation.stage !== "purge" || operation.status !== "processing" ||
      typeof operation.evidence.runtimesErasedAt !== "string")
      throw conflict("Managed OpenCode erasure requires the current canonical company purge operation");
    const runs = await tx.select({ id: heartbeatRuns.id, status: heartbeatRuns.status,
      processPid: heartbeatRuns.processPid, processGroupId: heartbeatRuns.processGroupId,
      controllerLeaseExpiresAt: heartbeatRuns.controllerLeaseExpiresAt }).from(heartbeatRuns)
      .where(eq(heartbeatRuns.companyId, companyId)).for("update");
    const ownedRunIds = new Set(runs.map(run => run.id));
    const providerHomeRunIds = await companyManagedOpenCodeRuntimeRunIds(companyId);
    if (providerHomeRunIds.some(runId => !ownedRunIds.has(runId)))
      throw conflict("Managed OpenCode runtime data has no current Run Stop owner");
    const scheduled: string[] = [];
    const providerHomes = new Set(providerHomeRunIds);
    for (const run of runs) {
      const jobKey = `runtime-asset-erasure:v1:${run.id}`;
      const sourceRefJson = { kind: "runtime_asset_erasure", runId: run.id, legacyDigests: [], companyPurgeOperationId: operationId };
      const [existing] = await tx.select({ id: memoryJobs.id, status: memoryJobs.status,
        operationType: memoryJobs.operationType, sourceRefJson: memoryJobs.sourceRefJson }).from(memoryJobs)
        .where(and(eq(memoryJobs.companyId, companyId), eq(memoryJobs.jobKey, jobKey)))
        .orderBy(desc(memoryJobs.attemptNumber)).for("update").limit(1);
      const authorizedPending = existing?.sourceRefJson.companyPurgeOperationId === operationId && existing.status !== "succeeded";
      if (!providerHomes.has(run.id) && !authorizedPending) continue;
      if (existing && existing.operationType !== "retention")
        throw conflict("Managed OpenCode erasure found a conflicting outbox owner");
      if (existing?.status === "running") {
        scheduled.push(run.id);
        continue;
      }
      if (existing && existing.status !== "queued" &&
        (run.processPid !== null || run.processGroupId !== null || run.controllerLeaseExpiresAt !== null ||
          !["succeeded", "interrupted", "failed", "cancelled", "timed_out"].includes(run.status) ||
          !await hasNativeLocalProcessStop(tx, companyId, run.id))) {
        scheduled.push(run.id);
        continue;
      }
      if (existing) {
        await tx.update(memoryJobs).set({ status: "queued", executionOwnerId: null, leaseExpiresAt: null,
          finishedAt: null, resultJson: null, resultSummary: null, error: null, errorCode: null, sourceRefJson, updatedAt: new Date() })
          .where(eq(memoryJobs.id, existing.id));
      } else {
        await tx.insert(memoryJobs).values({ companyId, operationType: "retention", jobKey, sourceRefJson });
      }
      scheduled.push(run.id);
    }
    return scheduled;
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
  authorization?: { companyPurgeOperationId?: string }) {
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
          !await hasNativeLocalProcessStop(tx, owner.companyId, owner.runId)) {
          throw new Error("Managed OpenCode data erasure awaits Native Stop receipt");
        }
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
      await eraseUnreferencedLegacyAsset(tx, digest);
    }
  });
}

async function eraseUnreferencedLegacyAsset(tx: Db, digest: string) {
  const storageRoot = resolvePaperclipInstanceRoot();
  const root = nativeRuntimeAssetsRoot(), bundle = path.join(root, "bundles", digest), manifest = path.join(root, "manifests", `${digest}.json`);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'native-runtime-asset:'+digest},0))`);
  const [retained] = await tx.execute<{ present: boolean }>(sql`select exists(select 1 from heartbeat_runs h where
    (h.runner_profile_json #> '{nativeExecutionInput,runtimeContext,instructions,bundle}') @> ${JSON.stringify({ digest, rootPath: bundle })}::jsonb
    or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(h.runner_profile_json #> '{nativeExecutionInput,runtimeContext,skills}')='array'
      then h.runner_profile_json #> '{nativeExecutionInput,runtimeContext,skills}' else '[]'::jsonb end) s
      where (s->'bundle') @> ${JSON.stringify({ digest, rootPath: bundle })}::jsonb)) as present`);
  if (retained?.present) return false;
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
