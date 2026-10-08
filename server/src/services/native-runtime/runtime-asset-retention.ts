import path from "node:path";
import fs from "node:fs/promises";
import type { Dir } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { heartbeatRuns, memoryJobs, type Db } from "@paperclipai/db";
import { resolvePaperclipInstanceRoot } from "../../home-paths.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { assertRuntimeStorageDirectories, removeRuntimeStorageTree } from "../runtime-skill-cache.js";

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

export async function enqueueCompanyRuntimeAssetErasure(tx: Db, companyId: string) {
  const runs = await tx.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(eq(heartbeatRuns.companyId, companyId));
  for (const run of runs) {
    // The native DELETE trigger captures legacy global references before profile deletion.
    await tx.insert(memoryJobs).values({ companyId, operationType: "retention", jobKey: `runtime-asset-erasure:v1:${run.id}`,
      sourceRefJson: { kind: "runtime_asset_erasure", runId: run.id, legacyDigests: [] } }).onConflictDoNothing();
  }
}

/** Actual persisted runs and their existing outbox own generated copies, never user-supplied paths. */
export async function eraseNativeRuntimeAssets(db: Db, owner: NativeRuntimeAssetOwner, legacyDigests: string[]) {
  if (![owner.companyId, owner.runId].every(id => uuidPattern.test(id)) || legacyDigests.length > 256 ||
    legacyDigests.some(digest => !digestPattern.test(digest))) throw new Error("Invalid native runtime asset erasure binding");
  await db.transaction(async rawTx => {
    const tx = rawTx as unknown as Db;
    await lockAnalyticalCompany(tx, owner.companyId); await lockMemoryPrivacy(tx, owner.companyId);
    const [run] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, owner.companyId), eq(heartbeatRuns.id, owner.runId)));
    if (run) {
      const [source] = await tx.execute<{ erased: boolean }>(sql`select aw_workflow_memory_erased(${owner.companyId}::uuid,${owner.runId}::uuid,NULL) as erased`);
      if (!source?.erased) throw new Error("Native runtime assets have no Source erasure receipt");
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
