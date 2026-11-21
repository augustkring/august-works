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
import { NATIVE_DURABLE_SESSION_SCOPE_KEY, readNativeDurableSessionScopeRecord } from "./native-durable-session-scope.js";

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
 *
 * PRIV-R8. A crash before the runner writes its identity leaves a folder with
 * no identity (it may already hold provider credentials), and a fault can
 * corrupt one. Since PRIV-R8 the executor records each folder's scope digest
 * on its Run before it creates the folder (`native-durable-session-scope.ts`),
 * so a recorded folder belongs to its Run's company whatever its identity
 * files say. A folder whose owner cannot be proven (no record, no readable
 * identity, no derived legacy name) is "unattributed":
 * - it is ignored by a company whose every started Run of the erased
 *   sessions recorded its scope: such a folder cannot be one of theirs;
 * - it is left to its owner when any Run on the instance recorded it;
 * - otherwise (a Run from before PRIV-R8) it might be the company's, so the
 *   erasure removes it as an instance orphan once it has been untouched for
 *   `UNATTRIBUTED_SAFE_AGE_MS` (a link or file only as itself), and stays
 *   pending with `native_durable_session_unattributed_pending` while a
 *   younger one remains and one of the company's unrecorded Runs was active
 *   within that age. Never a false success.
 * One tenant's unreadable folder therefore no longer blocks other tenants.
 */

const STATE_SCHEMA = "paperclip.runner.durable.state.v1";
const CONTROL_PLANE_SCHEMA = "paperclip.runner.durable.control-plane-state.v1";
const RUNNER_STATE_MAX_BYTES = 16 * 1024 * 1024;
const CONTROL_PLANE_STATE_MAX_BYTES = 64 * 1024 * 1024;
const INVENTORY_ENTRY_BOUND = 20_000;
const CONTINUITY_BREAK_BOUND = 256;
const INVENTORY_DEADLINE_MS = 20_000;
const SESSION_RUN_BOUND = 10_000;
const SCOPE_RECORD_BATCH = 1_000;
/** An identity-less folder of a live Run gets its identity within seconds;
 * one untouched for a day has no live owner. */
export const UNATTRIBUTED_SAFE_AGE_MS = 24 * 60 * 60 * 1000;
const AGE_ENTRY_BOUND = 4_096;
export const UNATTRIBUTED_PENDING_CODE = "native_durable_session_unattributed_pending";
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

/** What the target Runs recorded before creating their folders (PRIV-R8). */
export type NativeDurableSessionScopes = {
  /** Scope digest -> the target session whose Run recorded it. */
  recorded: Map<string, string>;
  /** Started target Runs that recorded nothing (from before PRIV-R8). A
   * folder one of them created may have no identity and no record. */
  unrecordedRunCount: number;
  /** Those of them active within `UNATTRIBUTED_SAFE_AGE_MS`: only these can
   * have written a recently modified folder. */
  recentUnrecordedRunCount: number;
};

export type NativeDurableSessionErasureReceipt = {
  schema: "paperclip.native-durable-session-erasure.v1";
  companyId: string;
  /** Erased sessions whose controller folders were found and removed. */
  normalizedSessionIds: string[];
  /** Scope digests whose folders (and digest-named siblings) were removed. */
  removedScopeDigests: string[];
  /** Unattributed scope digests removed as instance orphans (PRIV-R8): no
   * Run recorded them and no identity names an owner; this company might
   * have been the owner. */
  unattributedScopeDigests: string[];
  /** Directory entries removed, counting each sibling and quarantine copy. */
  removedEntryCount: number;
};

type Member = { parent: string; name: string; digest: string; erasingTag: string | null; unsafe: boolean };
type PlannedGroup = { digest: string; sessionId: string | null; members: Member[] };
type Plan = { base: string; companyId: string; groups: PlannedGroup[] };
type Identity = { status: "absent" } | { status: "indeterminate" } | { status: "valid"; sessionId: string; runId: string };

function erasureTag(companyId: string, sessionId: string) {
  return sha256(`paperclip.native-durable-session-erasure.v1\0${companyId}\0${sessionId}`).slice(0, 32);
}

/** Instance-level: an orphan's renamed copy is finished by any later erasure. */
function orphanTag(digest: string) {
  return sha256(`paperclip.native-durable-session-erasure.orphan.v1\0${digest}`).slice(0, 32);
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
    let tokens: string[];
    try {
      tokens = (await fs.readdir(breaks)).sort();
    } catch {
      indeterminate = true;
      continue;
    }
    // One folder's oversized archive makes only that folder unreadable.
    if (tokens.length > CONTINUITY_BREAK_BOUND) { indeterminate = true; continue; }
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
    // The executor refuses a symlinked or non-directory state root as unsafe.
    // Erasure never follows, removes or guesses it: the planner fails closed
    // when it could be this company's, and otherwise leaves it to its owner.
    const unsafe = entry.isSymbolicLink() || !entry.isDirectory();
    const erasing = match[2] ? erasingSuffixPattern.exec(match[2]) : null;
    members.push({ parent: directory, name: entry.name, digest: match[1]!, erasingTag: erasing ? erasing[1]! : null, unsafe });
  }
  return { members, quarantine };
}

/** Started target Runs' scope records (PRIV-R8). A malformed or contradictory
 * record of this company's own Run fails closed for this company only. */
export async function loadNativeDurableSessionScopes(tx: Db, companyId: string,
  targets: NativeDurableSessionTargets): Promise<NativeDurableSessionScopes> {
  const scopes: NativeDurableSessionScopes = { recorded: new Map(), unrecordedRunCount: 0, recentUnrecordedRunCount: 0 };
  const recentSince = Date.now() - UNATTRIBUTED_SAFE_AGE_MS;
  const ids = [...new Set([...targets.values()].flatMap(runIds => [...runIds]))];
  for (let offset = 0; offset < ids.length; offset += SCOPE_RECORD_BATCH) {
    const rows = await tx.select({ id: heartbeatRuns.id, nativeSessionId: heartbeatRuns.nativeSessionId,
      startedAt: heartbeatRuns.startedAt, finishedAt: heartbeatRuns.finishedAt,
      scope: sql<unknown>`${heartbeatRuns.runnerProfileJson}->${NATIVE_DURABLE_SESSION_SCOPE_KEY}` })
      .from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId),
        inArray(heartbeatRuns.id, ids.slice(offset, offset + SCOPE_RECORD_BATCH))));
    for (const row of rows) {
      let scope: ReturnType<typeof readNativeDurableSessionScopeRecord>;
      try {
        scope = readNativeDurableSessionScopeRecord({ [NATIVE_DURABLE_SESSION_SCOPE_KEY]: row.scope });
      } catch {
        throw conflict("A Run's native durable session record is unreadable");
      }
      if (!scope) {
        // A Run that never started never launched a runner.
        if (row.startedAt === null) continue;
        scopes.unrecordedRunCount++;
        if (row.finishedAt === null || row.finishedAt.getTime() > recentSince) scopes.recentUnrecordedRunCount++;
        continue;
      }
      const sessionId = normalizedSessionIdOf(row);
      if (scope.normalizedSessionId !== sessionId || !targets.has(sessionId))
        throw conflict("A Run's native durable session record contradicts its session");
      for (const digest of scope.scopeSha256) {
        const owner = scopes.recorded.get(digest);
        if (owner !== undefined && owner !== sessionId) throw conflict("Two sessions recorded the same native durable session folder");
        scopes.recorded.set(digest, sessionId);
      }
    }
  }
  return scopes;
}

/** Scope digests that any Run on the instance recorded (any company). Used
 * only to leave another owner's folder alone; it reveals nothing else. */
async function digestsRecordedOnInstance(tx: Db, digests: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let offset = 0; offset < digests.length; offset += SCOPE_RECORD_BATCH) {
    const batch = digests.slice(offset, offset + SCOPE_RECORD_BATCH);
    const list = sql.join(batch.map(digest => sql`${digest}`), sql`, `);
    const scopes = sql`(${heartbeatRuns.runnerProfileJson}->${NATIVE_DURABLE_SESSION_SCOPE_KEY}->'scopeSha256')`;
    const rows = await tx.execute(sql`select distinct d.value as digest from ${heartbeatRuns}
      cross join lateral jsonb_array_elements_text(case when jsonb_typeof(${scopes}) = 'array' then ${scopes} else '[]'::jsonb end) as d(value)
      where ${scopes} ?| array[${list}]::text[] and d.value in (${list})`);
    for (const row of rows as unknown as Iterable<{ digest: unknown }>) if (typeof row.digest === "string") found.add(row.digest);
  }
  return found;
}

/** Newest modification under a folder (itself, its entries and theirs),
 * without following links. Too many entries counts as recent. */
async function newestModificationMs(root: string): Promise<number> {
  let newest = 0, seen = 0;
  const visit = async (target: string, depth: number) => {
    if (++seen > AGE_ENTRY_BOUND) { newest = Number.POSITIVE_INFINITY; return; }
    const stat = await fs.lstat(target);
    newest = Math.max(newest, stat.mtimeMs);
    if (depth >= 2 || !stat.isDirectory()) return;
    for (const name of await fs.readdir(target)) {
      await visit(path.join(target, name), depth + 1);
      if (newest === Number.POSITIVE_INFINITY) return;
    }
  };
  try {
    await visit(root, 0);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
  return newest;
}

/** Read-only: find every controller folder of the target sessions, and the
 * unattributed folders this company might own (see the PRIV-R8 note above).
 * Throws instead of returning a partial plan when ownership of a folder that
 * could be this company's cannot be decided. */
export async function planNativeDurableSessionErasure(tx: Db, input: { companyId: string;
  targets: NativeDurableSessionTargets; scopes: NativeDurableSessionScopes }): Promise<Plan> {
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
  const unattributed: { digest: string; live: Member[]; leftovers: Member[] }[] = [];
  for (const [digest, group] of [...byDigest].sort(([left], [right]) => left.localeCompare(right))) {
    const live = group.filter(member => member.erasingTag === null);
    // An interrupted erasure of a target session (or of this orphan) left these renamed copies.
    const interrupted = group.filter(member => member.erasingTag !== null && !member.unsafe && tags.has(member.erasingTag));
    const leftovers = group.filter(member => member.erasingTag === orphanTag(digest));
    const recorded = input.scopes.recorded.get(digest) ?? null;
    const exact = derived.get(digest) ?? null;
    let sessionId: string | null = null;
    if (live.length) {
      if (recorded) {
        // The record was written before the folder existed: it decides the
        // owner whatever the identity files say (or whether they exist).
        if (exact && exact !== recorded) throw conflict("Native durable session state contradicts its derived session scope");
        if (live.some(member => member.unsafe)) throw conflict("Unsafe native durable session entry blocks erasure");
        sessionId = recorded;
      } else if (exact) {
        if (live.some(member => member.unsafe)) throw conflict("Unsafe native durable session entry blocks erasure");
        const identity = await resolveGroupIdentity(live, deadline);
        if (identity.status === "valid" && identity.sessionId !== exact)
          throw conflict("Native durable session state contradicts its derived session scope");
        sessionId = exact;
      } else if (live.some(member => member.unsafe)) {
        unattributed.push({ digest, live, leftovers });
        if (interrupted.length) plan.groups.push({ digest, sessionId: tags.get(interrupted[0]!.erasingTag!)!, members: interrupted });
        continue;
      } else {
        const identity = await resolveGroupIdentity(live, deadline);
        if (identity.status === "valid" && input.targets.has(identity.sessionId)) {
          if (!input.targets.get(identity.sessionId)!.has(identity.runId))
            throw conflict("Native durable session state names the erased session without a Run of this company");
          sessionId = identity.sessionId;
        } else if (identity.status !== "valid") {
          // No record, no derived name, no readable identity: isolated here
          // rather than blocking every company's erasure.
          unattributed.push({ digest, live, leftovers });
          if (interrupted.length) plan.groups.push({ digest, sessionId: tags.get(interrupted[0]!.erasingTag!)!, members: interrupted });
          continue;
        }
      }
    }
    if (sessionId) plan.groups.push({ digest, sessionId, members: [...live, ...interrupted, ...leftovers] });
    else if (interrupted.length)
      plan.groups.push({ digest, sessionId: tags.get(interrupted[0]!.erasingTag!)!, members: [...interrupted, ...leftovers] });
    else if (leftovers.length) plan.groups.push({ digest, sessionId: null, members: leftovers });
  }
  // Every started Run of these sessions recorded its scope before creating a
  // folder, so an unattributed folder cannot be one of this company's.
  if (!unattributed.length || input.scopes.unrecordedRunCount === 0) return plan;
  const elsewhere = await digestsRecordedOnInstance(tx, unattributed.map(entry => entry.digest));
  let pending = 0;
  for (const entry of unattributed) {
    // Another Run (of any company) recorded it: that owner's erasure finds it.
    if (elsewhere.has(entry.digest)) continue;
    let newest = 0;
    for (const member of entry.live) newest = Math.max(newest, await newestModificationMs(path.join(member.parent, member.name)));
    if (Date.now() - newest >= UNATTRIBUTED_SAFE_AGE_MS) {
      // Untouched for the safe age and recorded by no Run: no live owner. It
      // may be this company's, so it is removed (a link only as a link).
      plan.groups.push({ digest: entry.digest, sessionId: null, members: [...entry.live, ...entry.leftovers] });
    } else if (input.scopes.recentUnrecordedRunCount > 0) {
      // Recently written while one of this company's unrecorded Runs was
      // active: it may be that Run's live or crashed folder. Wait.
      pending++;
    }
    // Otherwise it was written after every unrecorded Run of these sessions
    // had finished, so none of them wrote it; recorded Runs would have
    // recorded it. It is not this company's.
  }
  if (pending) throw conflict("Native durable session erasure awaits unattributed runtime folders that may belong to this company",
    { code: UNATTRIBUTED_PENDING_CODE, unattributedFolderCount: pending });
  return plan;
}

/** Rename each folder out of its canonical name, then remove it. A crash
 * leaves only `<digest>.erasing-<tag>-*`, which the next attempt removes by
 * that DB-derived session tag (or, for an orphan, its digest-derived tag). */
export async function executeNativeDurableSessionErasure(plan: Plan): Promise<NativeDurableSessionErasureReceipt> {
  const quarantine = path.join(plan.base, "quarantine");
  const renamed: string[] = [];
  const unlinked: string[] = [];
  const vacated: string[] = [];
  for (const group of plan.groups) {
    const tag = group.sessionId === null ? orphanTag(group.digest) : erasureTag(plan.companyId, group.sessionId);
    for (const member of group.members) {
      const source = path.resolve(member.parent, member.name);
      if ((member.parent !== plan.base && member.parent !== quarantine) || path.dirname(source) !== member.parent ||
        !memberPattern.test(path.basename(source)))
        throw conflict("Unsafe native durable session entry blocks erasure");
      const kind = await directoryKind(source);
      // Only an unattributed orphan's link or file is removed, as itself.
      if (kind !== "directory" && !(kind === "unsafe" && member.unsafe && group.sessionId === null))
        throw conflict("Unsafe native durable session entry blocks erasure");
      if (member.erasingTag !== null) { (kind === "directory" ? renamed : unlinked).push(source); continue; }
      const target = path.join(member.parent, `${group.digest}.erasing-${tag}-${randomUUID()}`);
      await fs.rename(source, target);
      vacated.push(source);
      (kind === "directory" ? renamed : unlinked).push(target);
    }
  }
  for (const target of unlinked) {
    if (await directoryKind(target) !== "unsafe") throw conflict("Unsafe native durable session entry blocks erasure");
    await fs.unlink(target);
  }
  for (const target of renamed) {
    await assertRuntimeStorageDirectories(target, plan.base);
    await removeRuntimeStorageTree(target);
  }
  for (const target of [...vacated, ...renamed, ...unlinked]) {
    if (await directoryKind(target) !== "absent") throw new Error("Native durable session erasure could not confirm removal");
  }
  const owned = plan.groups.filter(group => group.sessionId !== null);
  return {
    schema: "paperclip.native-durable-session-erasure.v1",
    companyId: plan.companyId,
    normalizedSessionIds: [...new Set(owned.map(group => group.sessionId!))].sort(),
    removedScopeDigests: [...new Set(owned.map(group => group.digest))].sort(),
    unattributedScopeDigests: [...new Set(plan.groups.filter(group => group.sessionId === null).map(group => group.digest))].sort(),
    removedEntryCount: renamed.length + unlinked.length,
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
  const scopes = await loadNativeDurableSessionScopes(tx, companyId, targets);
  const plan = await planNativeDurableSessionErasure(tx, { companyId, targets, scopes });
  if (!bound && plan.groups.length) await assertNativeDurableSessionRunsStopped(tx, companyId, owners);
  return executeNativeDurableSessionErasure(plan);
}

/** The Runs of the sessions whose folders a plan removes. */
export function sessionOwners(plan: Plan, targets: NativeDurableSessionTargets): string[] {
  return plan.groups.flatMap(group => group.sessionId === null ? [] : [...targets.get(group.sessionId) ?? []]);
}

/** Company purge: remove every durable folder of the company's sessions,
 * then prove none remains. The caller already holds the company locks. */
export async function eraseCompanyNativeDurableSessionsInTransaction(tx: Db, companyId: string) {
  const targets = await nativeDurableSessionTargetsForCompany(tx, companyId);
  const scopes = await loadNativeDurableSessionScopes(tx, companyId, targets);
  const plan = await planNativeDurableSessionErasure(tx, { companyId, targets, scopes });
  await assertNativeDurableSessionRunsStopped(tx, companyId, sessionOwners(plan, targets));
  const receipt = await executeNativeDurableSessionErasure(plan);
  if ((await planNativeDurableSessionErasure(tx, { companyId, targets, scopes })).groups.length)
    throw conflict("Native durable session state remains after company erasure");
  return receipt;
}

/** Canonical offboarding: close this controller's idle warm owners of the
 * company's sessions outside the transaction, then erase under the locks. */
export async function eraseCompanyNativeDurableSessions(db: Db, companyId: string) {
  const targets = await nativeDurableSessionTargetsForCompany(db, companyId);
  const scopes = await loadNativeDurableSessionScopes(db, companyId, targets);
  const plan = await planNativeDurableSessionErasure(db, { companyId, targets, scopes });
  if (plan.groups.length) {
    const { closeWarmNativeSessionsForRun } = await import("./native-session-executor.js");
    for (const runId of new Set(sessionOwners(plan, targets))) {
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
