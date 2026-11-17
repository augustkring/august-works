import path from "node:path";
import fs, { type FileHandle } from "node:fs/promises";
import { constants as fsConstants, type Dir } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { heartbeatRuns, nativeRunFinalizations, type Db } from "@paperclipai/db";
import { resolvePaperclipInstanceRoot } from "../../home-paths.js";
import { assertRuntimeStorageDirectories, removeRuntimeStorageTree } from "../runtime-skill-cache.js";
import { conflict } from "../../errors.js";
import { remoteExecutionHasStopped } from "../remote-execution-termination.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";

/**
 * PRIV-R5. The controller keeps one durable folder per Native session scope:
 * `<durable-sessions>/<sha256(scope key)>`. It holds the committed PRP
 * control-plane events, runner and provider state (`codex-home`, `opencode`,
 * `acpx`), failover backups and every `continuity-breaks/<token>` archive.
 * The executor also derives sibling names from the same digest
 * (`<digest>.cleanup-*`, `<digest>.empty-before-cleanup.*`) and quarantines
 * whole folders as `quarantine/<digest>.*`.
 *
 * The scope key embeds companyId, agentId, workspace, provider identity and
 * the normalized session id. Source erasure clears the Run profile that holds
 * the workspace and provider inputs, so an erasure job cannot recompute the
 * digest. The normalized session id is the Run's `native_session_id` (a
 * server-generated UUID that survives payload erasure) and every folder of a
 * scope records it in its runner/control-plane identity together with a Run
 * id. A folder is therefore attributed to an erased session only when that
 * identity names the session and a Run of this company in it. The two legacy
 * layouts are derived exactly from company and session ids.
 */

const STATE_SCHEMA = "paperclip.runner.durable.state.v1";
const CONTROL_PLANE_SCHEMA = "paperclip.runner.durable.control-plane-state.v1";
const RUNNER_STATE_MAX_BYTES = 16 * 1024 * 1024;
const CONTROL_PLANE_STATE_MAX_BYTES = 64 * 1024 * 1024;
const INVENTORY_ENTRY_BOUND = 20_000;
const CONTINUITY_BREAK_BOUND = 256;
const INVENTORY_DEADLINE_MS = 20_000;
const SESSION_RUN_BOUND = 10_000;
const COMPANY_RUN_BOUND = 500_000;
const TERMINAL_RUN_STATUSES = ["succeeded", "interrupted", "failed", "cancelled", "timed_out"];
const memberPattern = /^([a-f0-9]{64})(?:\.(.+))?$/;
const erasingSuffixPattern = /^erasing-([a-f0-9]{32})-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Same location as the executor's runnerd state base and the failover backup stamp. */
export function nativeDurableSessionsRoot(): string {
  return path.resolve(process.env.PAPERCLIP_RUNNER_STATE_DIR ??
    path.resolve(resolvePaperclipInstanceRoot(), "runtime", "paperclip-runner", "durable-sessions"));
}

/** Normalized session id -> ids of this company's Runs in that session. */
export type NativeDurableSessionTargets = Map<string, Set<string>>;

export type NativeDurableSessionErasureReceipt = {
  schema: "paperclip.native-durable-session-erasure.v1";
  companyId: string;
  /** Erased sessions whose controller folders were found and removed. */
  normalizedSessionIds: string[];
  /** Scope digests whose folders (and digest-named siblings) were removed. */
  removedScopeDigests: string[];
  /** Directory entries removed, counting each sibling and quarantine copy. */
  removedEntryCount: number;
};

type Member = { parent: string; name: string; digest: string; erasingTag: string | null };
type PlannedGroup = { digest: string; sessionId: string; members: Member[] };
type Plan = { base: string; companyId: string; groups: PlannedGroup[] };
type Identity = { status: "absent" } | { status: "indeterminate" } | { status: "valid"; sessionId: string; runId: string };

function erasureTag(companyId: string, sessionId: string) {
  return sha256(`paperclip.native-durable-session-erasure.v1\0${companyId}\0${sessionId}`).slice(0, 32);
}

function normalizedSessionIdOf(run: { id: string; nativeSessionId: string | null }) {
  return run.nativeSessionId ?? `session-${run.id}`;
}

async function directoryKind(target: string): Promise<"absent" | "directory" | "unsafe"> {
  try {
    const stat = await fs.lstat(target);
    return stat.isDirectory() && !stat.isSymbolicLink() ? "directory" : "unsafe";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "absent";
    throw error;
  }
}

async function readIdentity(file: string, kind: "runner" | "control", maxBytes: number): Promise<Identity> {
  const parent = await directoryKind(path.dirname(file));
  if (parent === "absent") return { status: "absent" };
  if (parent === "unsafe") return { status: "indeterminate" };
  let handle: FileHandle;
  try {
    handle = await fs.open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? { status: "absent" } : { status: "indeterminate" };
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) return { status: "indeterminate" };
    const state = JSON.parse((await handle.readFile()).toString("utf8")) as Record<string, unknown>;
    const identity = kind === "control" ? state.identity as Record<string, unknown> | undefined : state;
    if (state.schema !== (kind === "control" ? CONTROL_PLANE_SCHEMA : STATE_SCHEMA) || !identity ||
      typeof identity !== "object" || Array.isArray(identity) ||
      typeof identity.normalizedSessionId !== "string" || !identity.normalizedSessionId ||
      typeof identity.runId !== "string" || !identity.runId) return { status: "indeterminate" };
    return { status: "valid", sessionId: identity.normalizedSessionId, runId: identity.runId };
  } catch {
    return { status: "indeterminate" };
  } finally {
    await handle.close();
  }
}

/** The first readable runner/control-plane identity among a scope's folders.
 * The scope digest binds one session, so every identity inside it names it. */
async function resolveGroupIdentity(members: Member[], deadline: number): Promise<Identity> {
  let indeterminate = false;
  const consider = (identity: Identity) => {
    if (identity.status === "indeterminate") indeterminate = true;
    return identity.status === "valid" ? identity : null;
  };
  for (const member of members) {
    const root = path.join(member.parent, member.name);
    const found = consider(await readIdentity(path.join(root, "runner", "runner-state.json"), "runner", RUNNER_STATE_MAX_BYTES)) ??
      consider(await readIdentity(path.join(root, "control-plane", "control-plane-state.json"), "control", CONTROL_PLANE_STATE_MAX_BYTES));
    if (found) return found;
    const breaks = path.join(root, "continuity-breaks");
    const breaksKind = await directoryKind(breaks);
    if (breaksKind === "unsafe") { indeterminate = true; continue; }
    if (breaksKind === "absent") continue;
    const tokens = (await fs.readdir(breaks)).sort();
    if (tokens.length > CONTINUITY_BREAK_BOUND) throw conflict("Native durable session archive inventory exceeded its erasure bound");
    for (const token of tokens) {
      if (Date.now() >= deadline) throw conflict("Native durable session inventory exceeded its erasure bound");
      const archive = path.join(breaks, token);
      const archiveKind = await directoryKind(archive);
      if (archiveKind !== "directory") { indeterminate = true; continue; }
      const found = consider(await readIdentity(path.join(archive, "runner", "runner-state.json"), "runner", RUNNER_STATE_MAX_BYTES)) ??
        consider(await readIdentity(path.join(archive, "control-plane", "control-plane-state.json"), "control", CONTROL_PLANE_STATE_MAX_BYTES));
      if (found) return found;
    }
  }
  return indeterminate ? { status: "indeterminate" } : { status: "absent" };
}

async function inventory(directory: string, base: string, counter: { entries: number }, deadline: number) {
  const members: Member[] = [];
  let quarantine = false;
  let entries: Dir;
  try {
    entries = await fs.opendir(directory);
  } catch (error) {
    throw conflict("Unsafe native durable session storage blocks erasure", { cause: (error as NodeJS.ErrnoException).code });
  }
  for await (const entry of entries) {
    if (++counter.entries > INVENTORY_ENTRY_BOUND || Date.now() >= deadline)
      throw conflict("Native durable session inventory exceeded its erasure bound");
    if (directory === base && entry.name === "quarantine") {
      if (entry.isSymbolicLink() || !entry.isDirectory()) throw conflict("Unsafe native durable session quarantine blocks erasure");
      quarantine = true;
      continue;
    }
    const match = memberPattern.exec(entry.name);
    if (!match) continue;
    // The executor refuses a symlinked or non-directory state root as unsafe;
    // erasure fails closed rather than following, skipping or guessing it.
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw conflict("Unsafe native durable session entry blocks erasure");
    const erasing = match[2] ? erasingSuffixPattern.exec(match[2]) : null;
    members.push({ parent: directory, name: entry.name, digest: match[1]!, erasingTag: erasing ? erasing[1]! : null });
  }
  return { members, quarantine };
}

/** Read-only: find every controller folder of the target sessions. Throws
 * instead of returning a partial plan when ownership cannot be decided. */
export async function planNativeDurableSessionErasure(input: { companyId: string; targets: NativeDurableSessionTargets }): Promise<Plan> {
  const base = nativeDurableSessionsRoot();
  const plan: Plan = { base, companyId: input.companyId, groups: [] };
  if (!input.targets.size) return plan;
  const baseKind = await directoryKind(base);
  if (baseKind === "absent") return plan;
  if (baseKind === "unsafe") throw conflict("Unsafe native durable session storage blocks erasure");
  const tags = new Map<string, string>();
  const derived = new Map<string, string>();
  for (const sessionId of input.targets.keys()) {
    tags.set(erasureTag(input.companyId, sessionId), sessionId);
    // Pre-v2 executor layouts, derived from DB ids alone.
    derived.set(sha256(JSON.stringify([input.companyId, sessionId])), sessionId);
    derived.set(sha256(sessionId), sessionId);
  }
  const deadline = Date.now() + INVENTORY_DEADLINE_MS, counter = { entries: 0 };
  const top = await inventory(base, base, counter, deadline);
  const members = [...top.members];
  if (top.quarantine) members.push(...(await inventory(path.join(base, "quarantine"), base, counter, deadline)).members);
  const byDigest = new Map<string, Member[]>();
  for (const member of members) byDigest.set(member.digest, [...(byDigest.get(member.digest) ?? []), member]);
  for (const [digest, group] of [...byDigest].sort(([left], [right]) => left.localeCompare(right))) {
    const live = group.filter(member => member.erasingTag === null);
    // An interrupted erasure of a target session left these renamed copies.
    const interrupted = group.filter(member => member.erasingTag !== null && tags.has(member.erasingTag));
    const exact = derived.get(digest) ?? null;
    let sessionId: string | null = null;
    if (live.length) {
      const identity = await resolveGroupIdentity(live, deadline);
      if (identity.status === "valid" && input.targets.has(identity.sessionId)) {
        if (!input.targets.get(identity.sessionId)!.has(identity.runId))
          throw conflict("Native durable session state names the erased session without a Run of this company");
        if (exact && exact !== identity.sessionId)
          throw conflict("Native durable session state contradicts its derived session scope");
        sessionId = identity.sessionId;
      } else if (identity.status === "valid") {
        if (exact) throw conflict("Native durable session state contradicts its derived session scope");
      } else if (exact) {
        sessionId = exact;
      } else if (identity.status === "indeterminate") {
        throw conflict("Unreadable native durable session state blocks erasure");
      }
    }
    if (sessionId) plan.groups.push({ digest, sessionId, members: [...live, ...interrupted] });
    else if (interrupted.length)
      plan.groups.push({ digest, sessionId: tags.get(interrupted[0]!.erasingTag!)!, members: interrupted });
  }
  return plan;
}

/** Rename each folder out of its canonical name, then remove it. A crash
 * leaves only `<digest>.erasing-<session tag>-*`, which the next attempt
 * for the same company session removes by that DB-derived tag. */
export async function executeNativeDurableSessionErasure(plan: Plan): Promise<NativeDurableSessionErasureReceipt> {
  const quarantine = path.join(plan.base, "quarantine");
  const renamed: string[] = [];
  const vacated: string[] = [];
  for (const group of plan.groups) {
    const tag = erasureTag(plan.companyId, group.sessionId);
    for (const member of group.members) {
      const source = path.resolve(member.parent, member.name);
      if ((member.parent !== plan.base && member.parent !== quarantine) || path.dirname(source) !== member.parent ||
        !memberPattern.test(path.basename(source)) || await directoryKind(source) !== "directory")
        throw conflict("Unsafe native durable session entry blocks erasure");
      if (member.erasingTag !== null) { renamed.push(source); continue; }
      const target = path.join(member.parent, `${group.digest}.erasing-${tag}-${randomUUID()}`);
      await fs.rename(source, target);
      vacated.push(source);
      renamed.push(target);
    }
  }
  for (const target of renamed) {
    await assertRuntimeStorageDirectories(target, plan.base);
    await removeRuntimeStorageTree(target);
  }
  for (const target of [...vacated, ...renamed]) {
    if (await directoryKind(target) !== "absent") throw new Error("Native durable session erasure could not confirm removal");
  }
  return {
    schema: "paperclip.native-durable-session-erasure.v1",
    companyId: plan.companyId,
    normalizedSessionIds: [...new Set(plan.groups.map(group => group.sessionId))].sort(),
    removedScopeDigests: [...new Set(plan.groups.map(group => group.digest))].sort(),
    removedEntryCount: renamed.length,
  };
}

/** Live state is never removed: every Run of the session must be terminal,
 * hold no local process or controller lease, and have no leased finalization
 * (retained cleanup maintenance writes into the same folder). */
export async function assertNativeDurableSessionRunsStopped(tx: Db, companyId: string, runIds: Iterable<string>) {
  const ids = [...new Set(runIds)];
  for (let offset = 0; offset < ids.length; offset += 500) {
    const batch = ids.slice(offset, offset + 500);
    const runs = await tx.select({ id: heartbeatRuns.id, status: heartbeatRuns.status, processPid: heartbeatRuns.processPid,
      processGroupId: heartbeatRuns.processGroupId, controllerLeaseExpiresAt: heartbeatRuns.controllerLeaseExpiresAt,
      nativeProcessCleanupPending: heartbeatRuns.nativeProcessCleanupPending,
      remoteLocator: sql<boolean>`(${heartbeatRuns.runnerProfileJson}->'nativeRemoteRuntimeAssetLocator') is not null` })
      .from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), inArray(heartbeatRuns.id, batch)));
    if (runs.length !== batch.length) throw conflict("Native durable session erasure lost a session Run owner");
    for (const run of runs) {
      const remoteStopped = run.processPid !== null && run.nativeProcessCleanupPending === false && run.remoteLocator === true &&
        await remoteExecutionHasStopped(tx, companyId, run.id);
      if (!TERMINAL_RUN_STATUSES.includes(run.status) || (run.processPid !== null && !remoteStopped) ||
        run.processGroupId !== null || run.controllerLeaseExpiresAt !== null)
        throw conflict("Native durable session erasure awaits every session Run's confirmed Native Stop");
    }
    const [leased] = await tx.select({ runId: nativeRunFinalizations.runId }).from(nativeRunFinalizations).where(and(
      eq(nativeRunFinalizations.companyId, companyId), inArray(nativeRunFinalizations.runId, batch),
      or(isNotNull(nativeRunFinalizations.leaseOwner), isNotNull(nativeRunFinalizations.leaseExpiresAt)))).limit(1);
    if (leased) throw conflict("Native durable session erasure awaits a session Run's finalization lease");
  }
}

/** The erased Run's own session: every Run of this company bound to it. */
export async function nativeDurableSessionTargetsForRun(tx: Db, companyId: string, runId: string): Promise<NativeDurableSessionTargets | null> {
  const [run] = await tx.select({ id: heartbeatRuns.id, runtimeMode: heartbeatRuns.runtimeMode, nativeSessionId: heartbeatRuns.nativeSessionId })
    .from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, runId)));
  if (!run || (run.runtimeMode !== "native" && run.nativeSessionId === null)) return null;
  if (run.nativeSessionId === null) return new Map([[normalizedSessionIdOf(run), new Set([run.id])]]);
  const rows = await tx.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.nativeSessionId, run.nativeSessionId))).limit(SESSION_RUN_BOUND + 1);
  if (rows.length > SESSION_RUN_BOUND) throw conflict("Native durable session exceeds its erasure cascade bound");
  return new Map([[run.nativeSessionId, new Set(rows.map(row => row.id))]]);
}

export async function nativeDurableSessionTargetsForCompany(tx: Db, companyId: string): Promise<NativeDurableSessionTargets> {
  const rows = await tx.select({ id: heartbeatRuns.id, nativeSessionId: heartbeatRuns.nativeSessionId }).from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, companyId), or(eq(heartbeatRuns.runtimeMode, "native"), isNotNull(heartbeatRuns.nativeSessionId))))
    .limit(COMPANY_RUN_BOUND + 1);
  if (rows.length > COMPANY_RUN_BOUND) throw conflict("Native durable session inventory exceeds its company erasure bound");
  const targets: NativeDurableSessionTargets = new Map();
  for (const row of rows) {
    const sessionId = normalizedSessionIdOf(row);
    targets.set(sessionId, (targets.get(sessionId) ?? new Set()).add(row.id));
  }
  return targets;
}

/** Erase one source-erased Run's session folders. Called under the Memory
 * privacy locks by the runtime asset erasure owner. */
export async function eraseNativeDurableSessionForRun(tx: Db, companyId: string, runId: string) {
  const targets = await nativeDurableSessionTargetsForRun(tx, companyId, runId);
  if (!targets) return null;
  const owners = [...targets.values()].flatMap(ids => [...ids]);
  // A Run bound to a native session gates before inventory: an active Run of
  // the session may not have created its folder yet. A native Run that never
  // received a session id never launched a runner, so it gates only when a
  // folder is actually attributed to its fallback session key.
  const bound = !targets.has(`session-${runId}`);
  if (bound) await assertNativeDurableSessionRunsStopped(tx, companyId, owners);
  const plan = await planNativeDurableSessionErasure({ companyId, targets });
  if (!bound && plan.groups.length) await assertNativeDurableSessionRunsStopped(tx, companyId, owners);
  return executeNativeDurableSessionErasure(plan);
}

/** Company purge: remove every durable folder of the company's sessions,
 * then prove none remains. The caller already holds the company locks. */
export async function eraseCompanyNativeDurableSessionsInTransaction(tx: Db, companyId: string) {
  const targets = await nativeDurableSessionTargetsForCompany(tx, companyId);
  const plan = await planNativeDurableSessionErasure({ companyId, targets });
  const owners = plan.groups.flatMap(group => [...targets.get(group.sessionId) ?? []]);
  await assertNativeDurableSessionRunsStopped(tx, companyId, owners);
  const receipt = await executeNativeDurableSessionErasure(plan);
  if ((await planNativeDurableSessionErasure({ companyId, targets })).groups.length)
    throw conflict("Native durable session state remains after company erasure");
  return receipt;
}

/** Canonical offboarding: close this controller's idle warm owners of the
 * company's sessions outside the transaction, then erase under the locks. */
export async function eraseCompanyNativeDurableSessions(db: Db, companyId: string) {
  const targets = await nativeDurableSessionTargetsForCompany(db, companyId);
  const plan = await planNativeDurableSessionErasure({ companyId, targets });
  if (plan.groups.length) {
    const { closeWarmNativeSessionsForRun } = await import("./native-session-executor.js");
    for (const runId of new Set(plan.groups.flatMap(group => [...targets.get(group.sessionId) ?? []]))) {
      const stop = await closeWarmNativeSessionsForRun({ companyId, runId, reason: "company offboarding" });
      if (stop.busy || stop.failed) throw conflict("Native durable session erasure awaits a warm session Stop");
    }
  }
  return db.transaction(async rawTx => {
    const tx = rawTx as unknown as Db;
    await lockAnalyticalCompany(tx, companyId);
    await lockMemoryPrivacy(tx, companyId);
    return eraseCompanyNativeDurableSessionsInTransaction(tx, companyId);
  });
}
