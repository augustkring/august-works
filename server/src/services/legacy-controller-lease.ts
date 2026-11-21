import { randomUUID } from "node:crypto";
import { and, eq, gt, lte, sql } from "drizzle-orm";
import { heartbeatRuns, type Db } from "@paperclipai/db";

// A boot UUID has meaning across containers; a numeric PID does not.
export const legacyControllerBootId = randomUUID();
export const LEGACY_CONTROLLER_LEASE_MS = 60_000;
export const LEGACY_CONTROLLER_RENEW_MS = 10_000;

type Run = typeof heartbeatRuns.$inferSelect;

/** Commit these fields in the same UPDATE that claims a queued run. */
export function legacyControllerClaim(runtimeMode: string) {
  if (runtimeMode === "native") return {};
  return {
    controllerBootId: legacyControllerBootId,
    controllerLeaseExpiresAt: sql`clock_timestamp() + interval '60 seconds'`,
    executionStage: "preparing",
  };
}

export async function renewLegacyControllerLease(
  db: Db,
  run: Pick<Run, "id" | "companyId" | "controllerBootId">,
  stage?: "dispatching",
): Promise<boolean> {
  const [renewed] = await db.update(heartbeatRuns).set({
    controllerLeaseExpiresAt: sql`clock_timestamp() + interval '60 seconds'`,
    ...(stage ? { executionStage: stage } : {}),
  }).where(and(
    eq(heartbeatRuns.id, run.id), eq(heartbeatRuns.companyId, run.companyId),
    eq(heartbeatRuns.runtimeMode, "legacy"), eq(heartbeatRuns.status, "running"),
    eq(heartbeatRuns.controllerBootId, legacyControllerBootId),
    gt(heartbeatRuns.controllerLeaseExpiresAt, sql`clock_timestamp()`),
  )).returning({ id: heartbeatRuns.id });
  return Boolean(renewed);
}

export async function hasLiveLegacyController(db: Db, run: Run): Promise<boolean> {
  if (run.runtimeMode === "native" || !run.controllerBootId) return false;
  const [owner] = await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(
    eq(heartbeatRuns.id, run.id), eq(heartbeatRuns.companyId, run.companyId),
    eq(heartbeatRuns.status, "running"),
    gt(heartbeatRuns.controllerLeaseExpiresAt, sql`clock_timestamp()`),
  ));
  return Boolean(owner);
}

/** Atomically revoke an expired controller. Renewal and revocation serialize on
 * the run row. Expiry permits cleanup, never dispatch of a replacement agent. */
export async function revokeExpiredLegacyController(db: Db, run: Run): Promise<boolean> {
  if (run.runtimeMode === "native" || !run.controllerBootId) return true;
  const [revoked] = await db.update(heartbeatRuns).set({
    controllerBootId: randomUUID(),
    controllerLeaseExpiresAt: sql`clock_timestamp() + interval '60 seconds'`,
  }).where(and(
    eq(heartbeatRuns.id, run.id), eq(heartbeatRuns.companyId, run.companyId),
    eq(heartbeatRuns.status, "running"),
    eq(heartbeatRuns.controllerBootId, run.controllerBootId),
    lte(heartbeatRuns.controllerLeaseExpiresAt, sql`clock_timestamp()`),
  )).returning({ id: heartbeatRuns.id });
  return Boolean(revoked);
}

/** Abort the adapter if the controller cannot renew. Bound each check by the
 * lease duration even when the database connection never settles. */
export function watchLegacyControllerLease(db: Db, run: Run, controller: AbortController) {
  if (run.runtimeMode === "native" || !run.controllerBootId) {
    return { stop() {}, async assertOwned(_stage?: "dispatching") {} };
  }
  let stopped = false;
  let pending = false;
  const lost = () => { if (!stopped) controller.abort(new Error("Legacy controller lease lost")); };
  let deadline = setTimeout(lost, Math.max(0,
    (run.controllerLeaseExpiresAt?.getTime() ?? 0) - Date.now()));
  deadline.unref();
  const assertOwned = async (stage?: "dispatching") => {
    if (stopped) return;
    controller.signal.throwIfAborted();
    const startedAt = Date.now();
    let onAbort!: () => void;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    let renewed: boolean;
    try {
      renewed = await Promise.race([renewLegacyControllerLease(db, run, stage), aborted]);
    } finally {
      controller.signal.removeEventListener("abort", onAbort);
    }
    if (stopped) return;
    if (!renewed) {
      lost();
      controller.signal.throwIfAborted();
    }
    controller.signal.throwIfAborted();
    if (!stopped) {
      clearTimeout(deadline);
      deadline = setTimeout(lost, Math.max(0, LEGACY_CONTROLLER_LEASE_MS - (Date.now() - startedAt)));
      deadline.unref();
    }
  };
  const timer = setInterval(() => {
    if (pending || stopped) return;
    pending = true;
    void assertOwned().catch(lost).finally(() => { pending = false; });
  }, LEGACY_CONTROLLER_RENEW_MS);
  timer.unref();
  return { assertOwned, stop() { stopped = true; clearInterval(timer); clearTimeout(deadline); } };
}


/** The bootstrap controller may bind its realized workspace before Native
 * selection. The SQL owner proof is also used by the source-binding trigger;
 * a caller-supplied boot string alone never grants preparation authority. */
export async function assertWorkspacePreparationBindingOwned(db: Db, input: {
  companyId: string; issueId: string; agentId: string; runId: string; workspaceId: string; controllerBootId: string;
}) {
  if (input.controllerBootId !== legacyControllerBootId)
    throw new Error("workspace_preparation_controller_changed");
  const [proof] = await db.execute<{ owned: boolean }>(sql`select public.aw_workspace_preparation_binding_owned(
    ${input.companyId}::uuid,${input.issueId}::uuid,${input.agentId}::uuid,${input.runId}::uuid,
    ${input.workspaceId}::uuid,${legacyControllerBootId}::uuid) as owned`);
  if (proof?.owned !== true) throw new Error("workspace_preparation_binding_owner_changed");
  return { ...input, controllerBootId: legacyControllerBootId };
}
