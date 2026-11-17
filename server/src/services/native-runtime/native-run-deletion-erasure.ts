import path from "node:path";
import fs from "node:fs/promises";
import type { Dir } from "node:fs";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { heartbeatRuns, type Db } from "@paperclipai/db";
import { conflict, HttpError } from "../../errors.js";
import { resolvePaperclipInstanceRoot } from "../../home-paths.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { hasNativeLocalProcessStop } from "../native-local-process-stop.js";
import { assertRuntimeStorageDirectories, removeRuntimeStorageTree } from "../runtime-skill-cache.js";
import { managedOpenCodeRuntimeDirectory, nativeRuntimeAssetsRoot } from "./runtime-asset-retention.js";
import {
  assertNativeDurableSessionRunsStopped,
  executeNativeDurableSessionErasure,
  planNativeDurableSessionErasure,
  type NativeDurableSessionErasureReceipt,
  type NativeDurableSessionTargets,
} from "./native-durable-session-erasure.js";

/**
 * PRIV-R7 (CE-15). Agent deletion and the legacy local company remove delete
 * Run rows directly. The Run row is the only owner that ties a Run's runtime
 * files to its company: the per-Run generated runtime copies and managed
 * OpenCode provider home under `runtime-context-assets/runs/<company>/<run>`,
 * the controller durable session folders (attributed through a Run of this
 * company, PRIV-R5) and a managed remote session tree (its locator lives in the
 * Run profile). Once the row is gone, no erasure owner can find them again.
 *
 * These deletions therefore erase those files in the same transaction, after
 * the same Stop gates the existing erasure owners use, and refuse with 409
 * (deleting nothing) while a Run is live or a file cannot be erased here.
 */

type Owner = "agent" | "company";

const REFUSALS = {
  agent: {
    pending: {
      code: "agent_deletion_runtime_erasure_pending",
      message: "The agent's saved runtime files could not be erased yet, so nothing was deleted. " +
        "Stop the agent's active runs and try again. If this continues, contact support.",
    },
    remote: {
      code: "agent_deletion_remote_runtime_erasure_required",
      message: "The agent has runtime files in a remote sandbox that agent deletion cannot erase, so nothing was deleted. " +
        "Pause the agent instead, or contact support.",
    },
  },
  company: {
    pending: {
      code: "company_removal_runtime_erasure_pending",
      message: "The company's saved runtime files could not be erased yet, so nothing was deleted. " +
        "Stop the company's active runs and try again. If this continues, contact support.",
    },
    remote: {
      code: "company_removal_remote_runtime_erasure_required",
      message: "The company has runtime files in a remote sandbox that this removal cannot erase, so nothing was deleted. " +
        "Contact support.",
    },
  },
} as const;

const RUN_BATCH = 500;
const DELETION_RUN_BOUND = 500_000;
const RUN_ROOT_INVENTORY_BOUND = 100_000;
const RUN_ROOT_INVENTORY_DEADLINE_MS = 20_000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Scope = { companyId: string; agentId?: string };
type DeletedRun = { id: string; nativeSessionId: string | null; native: boolean; remote: boolean };
type RunRoot = { runId: string; root: string; providerHome: boolean };

export type NativeRunDeletionErasureReceipt = {
  schema: "paperclip.native-run-deletion-erasure.v1";
  companyId: string;
  /** Per-Run runtime folders removed (generated copies, provider homes). */
  removedRunRootCount: number;
  durableSessions: NativeDurableSessionErasureReceipt;
};

function refusal(owner: Owner, kind: "pending" | "remote", reason?: string) {
  const { code, message } = REFUSALS[owner][kind];
  return conflict(message, reason ? { code, reason } : { code });
}

function isRefusal(error: unknown) {
  if (!(error instanceof HttpError) || error.status !== 409) return false;
  const code = (error.details as { code?: unknown } | undefined)?.code;
  return Object.values(REFUSALS).some(owner => Object.values(owner).some(entry => entry.code === code));
}

/** A conflict from an erasure owner keeps this deletion pending as a whole. */
async function guarded<T>(owner: Owner, step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (error) {
    if (error instanceof HttpError && error.status === 409 && !isRefusal(error)) throw refusal(owner, "pending", error.message);
    throw error;
  }
}

async function deletedRuns(tx: Db, scope: Scope): Promise<DeletedRun[]> {
  const rows = await tx.select({
    id: heartbeatRuns.id,
    nativeSessionId: heartbeatRuns.nativeSessionId,
    native: sql<boolean>`(${heartbeatRuns.runtimeMode} = 'native' or ${heartbeatRuns.nativeSessionId} is not null)`,
    remote: sql<boolean>`(${heartbeatRuns.runnerProfileJson}->'nativeRemoteRuntimeAssetLocator') is not null`,
  }).from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, scope.companyId),
    scope.agentId ? eq(heartbeatRuns.agentId, scope.agentId) : undefined)).limit(DELETION_RUN_BOUND + 1);
  if (rows.length > DELETION_RUN_BOUND) throw conflict("Native runtime inventory exceeds its deletion bound");
  return rows.map(row => ({ ...row, native: row.native === true, remote: row.remote === true }));
}

/** Every Run of this company bound to a session of a deleted native Run. */
async function sessionTargets(tx: Db, companyId: string, runs: DeletedRun[]): Promise<NativeDurableSessionTargets> {
  const targets: NativeDurableSessionTargets = new Map();
  const sessionIds = new Set<string>();
  for (const run of runs.filter(candidate => candidate.native)) {
    if (run.nativeSessionId) sessionIds.add(run.nativeSessionId);
    else targets.set(`session-${run.id}`, new Set([run.id]));
  }
  const ids = [...sessionIds];
  let total = 0;
  for (let offset = 0; offset < ids.length; offset += RUN_BATCH) {
    const rows = await tx.select({ id: heartbeatRuns.id, nativeSessionId: heartbeatRuns.nativeSessionId }).from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.companyId, companyId), isNotNull(heartbeatRuns.nativeSessionId),
        inArray(heartbeatRuns.nativeSessionId, ids.slice(offset, offset + RUN_BATCH))));
    total += rows.length;
    if (total > DELETION_RUN_BOUND) throw conflict("Native durable session inventory exceeds its deletion bound");
    for (const row of rows) targets.set(row.nativeSessionId!, (targets.get(row.nativeSessionId!) ?? new Set()).add(row.id));
  }
  return targets;
}

async function directoryKind(target: string): Promise<"absent" | "directory"> {
  try {
    const stat = await fs.lstat(target);
    if (stat.isDirectory() && !stat.isSymbolicLink()) return "directory";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "absent";
  }
  throw conflict("Unsafe Native runtime asset storage blocks deletion");
}

/** The company's per-Run runtime folders. The agent scope checks only its own
 * Runs; the company scope takes every folder, including one whose Run row an
 * earlier deletion already removed, because nothing else will ever erase it. */
async function runRoots(scope: Scope, runs: DeletedRun[]): Promise<RunRoot[]> {
  const storageRoot = resolvePaperclipInstanceRoot();
  const companyRoot = path.join(nativeRuntimeAssetsRoot(), "runs", scope.companyId);
  try {
    await assertRuntimeStorageDirectories(companyRoot, storageRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw conflict("Unsafe Native runtime asset storage blocks deletion");
  }
  const runIds: string[] = [];
  if (scope.agentId) {
    for (const run of runs) if (await directoryKind(path.join(companyRoot, run.id)) === "directory") runIds.push(run.id);
  } else {
    let entries: Dir;
    try {
      entries = await fs.opendir(companyRoot);
    } catch {
      throw conflict("Unsafe Native runtime asset storage blocks deletion");
    }
    const deadline = Date.now() + RUN_ROOT_INVENTORY_DEADLINE_MS;
    let inspected = 0;
    for await (const entry of entries) {
      if (++inspected > RUN_ROOT_INVENTORY_BOUND || Date.now() >= deadline)
        throw conflict("Native runtime asset inventory exceeded its deletion bound");
      if (entry.isSymbolicLink() || !entry.isDirectory() || !uuidPattern.test(entry.name))
        throw conflict("Unsafe Native runtime asset storage blocks deletion");
      runIds.push(entry.name);
    }
  }
  const roots: RunRoot[] = [];
  for (const runId of runIds.sort()) {
    const owner = { companyId: scope.companyId, runId };
    roots.push({ runId, root: nativeRuntimeAssetsRoot(owner),
      providerHome: await directoryKind(managedOpenCodeRuntimeDirectory(owner)) === "directory" });
  }
  return roots;
}

/** Take the company's privacy locks first in the deletion transaction. They
 * precede Company/Agent/Run row pins throughout the Native source owner graph
 * (the Run DELETE trigger takes the same keys). */
export async function lockNativeRunDeletionPrivacy(tx: Db, companyId: string) {
  await lockAnalyticalCompany(tx, companyId);
  await lockMemoryPrivacy(tx, companyId);
}

/**
 * Close this controller's idle warm owners of the deleted Runs' sessions
 * before the deletion transaction, as offboarding does: a warm owner writes
 * into the durable folder the deletion removes. A busy owner keeps the
 * deletion pending.
 */
export async function closeWarmNativeOwnersBeforeRunDeletion(db: Db, scope: Scope) {
  const owner: Owner = scope.agentId ? "agent" : "company";
  await guarded(owner, async () => {
    const targets = await sessionTargets(db, scope.companyId, await deletedRuns(db, scope));
    const runIds = new Set([...targets.values()].flatMap(ids => [...ids]));
    if (!runIds.size) return;
    const { closeWarmNativeSessionsForRun } = await import("./native-session-executor.js");
    for (const runId of runIds) {
      const stop = await closeWarmNativeSessionsForRun({ companyId: scope.companyId, runId,
        reason: owner === "agent" ? "agent deletion" : "company removal" });
      if (stop.busy || stop.failed) throw conflict("Native durable session erasure awaits a warm session Stop");
    }
  });
}

/**
 * Read-only first phase, called in the deletion transaction before any row is
 * deleted. The caller already holds the company's analytical and Memory
 * privacy locks. Throws 409 while any affected Run is live, a deleted Run has
 * a managed remote session tree, or ownership of a folder cannot be decided.
 * The returned `execute` erases the files after the rows are deleted, so a
 * database refusal leaves every file in place and an erasure failure rolls the
 * deletion back.
 */
export async function prepareNativeRunDeletionErasure(tx: Db, scope: Scope) {
  const owner: Owner = scope.agentId ? "agent" : "company";
  const prepared = await guarded(owner, async () => {
    const runs = await deletedRuns(tx, scope);
    // The remote locator names the session tree in the Run's Sandbox. Only
    // the runtime asset erasure job, with a Stop receipt from the Sandbox
    // owner, can remove it; deleting the Run would orphan it.
    if (runs.some(run => run.remote)) throw refusal(owner, "remote");
    const deleted = new Set(runs.map(run => run.id));
    const roots = await runRoots(scope, runs);
    const targets = await sessionTargets(tx, scope.companyId, runs);
    // Live state is never removed: every deleted native Run, every Run with a
    // runtime folder and every Run of an affected session must be stopped.
    const owners = new Set([
      ...runs.filter(run => run.native).map(run => run.id),
      ...roots.filter(root => deleted.has(root.runId)).map(root => root.runId),
      ...[...targets.values()].flatMap(ids => [...ids]),
    ]);
    await assertNativeDurableSessionRunsStopped(tx, scope.companyId, owners);
    // A managed OpenCode provider home is removed only after its Run's
    // recorded local process Stop, as the runtime asset erasure owner requires;
    // one without a current Run has no Stop owner and is refused, as in purge.
    for (const root of roots.filter(candidate => candidate.providerHome)) {
      if (!deleted.has(root.runId)) throw conflict("Managed OpenCode runtime data has no current Run Stop owner");
      if (!await hasNativeLocalProcessStop(tx, scope.companyId, root.runId))
        throw conflict("Managed OpenCode data erasure awaits Native Stop receipt");
    }
    const plan = await planNativeDurableSessionErasure({ companyId: scope.companyId, targets });
    return { deleted, roots, targets, plan };
  });

  return {
    /** Erase after the Run rows are deleted, in the same transaction. Every
     * deleted Run must have passed the gate above. */
    execute: (deletedRunIds: Iterable<string>) => guarded(owner, async (): Promise<NativeRunDeletionErasureReceipt> => {
      for (const runId of deletedRunIds) {
        if (!prepared.deleted.has(runId)) throw conflict("A Run started after the deletion's runtime erasure gate");
      }
      const storageRoot = resolvePaperclipInstanceRoot();
      for (const { root } of prepared.roots) {
        try {
          await assertRuntimeStorageDirectories(root, storageRoot);
          await removeRuntimeStorageTree(root);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      for (const { root } of prepared.roots) {
        if (await directoryKind(root) !== "absent") throw new Error("Native runtime asset deletion could not confirm removal");
      }
      if (!scope.agentId) {
        // A folder created after the inventory blocks the company removal.
        await fs.rmdir(path.join(nativeRuntimeAssetsRoot(), "runs", scope.companyId)).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return;
          if (error.code === "ENOTEMPTY" || error.code === "EEXIST") throw conflict("Native runtime assets appeared during company removal");
          throw error;
        });
      }
      const durableSessions = await executeNativeDurableSessionErasure(prepared.plan);
      if ((await planNativeDurableSessionErasure({ companyId: scope.companyId, targets: prepared.targets })).groups.length)
        throw conflict("Native durable session state remains after deletion");
      return {
        schema: "paperclip.native-run-deletion-erasure.v1",
        companyId: scope.companyId,
        removedRunRootCount: prepared.roots.length,
        durableSessions,
      };
    }),
  };
}
