import { and, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { environmentLeases, heartbeatRunEvents, heartbeatRuns, nativeRunFinalizations, type Db } from "@paperclipai/db";
import { claimedAdapterType } from "./conversation-continuation.js";
import { IN_PROCESS_BACKEND_ADMITTED, PROCESS_IDENTITY_RECORDED, PROCESS_START_REQUESTED } from "./native-local-process-stop.js";
import { hasRemoteTerminationReceipt } from "./remote-execution-termination.js";

type Run = typeof heartbeatRuns.$inferSelect;
type Coordinator = typeof nativeRunFinalizations.$inferSelect;

/** Caller holds the coordinator and run locks when using this proof to admit
 * work. Attempt zero is a durable never-claimed receipt: every native executor
 * commits its first claim before it can start or attach a provider. */
export async function isCancelledNativeStartup(db: Db, run: Run, coordinator: Coordinator | undefined) {
  if (run.status !== "cancelled" || !run.finishedAt || run.processPid || run.processGroupId ||
      run.processStartedAt || run.sessionIdAfter) return false;
  const cancellation = run.resultJson?.startupCancellation as Record<string, unknown> | undefined;
  const beforeSelection = run.runtimeMode === "legacy" && !run.runtimeModeResolvedAt &&
    !run.nativeSessionId && !coordinator && claimedAdapterType(run) === "paperclip_runner" &&
    cancellation?.beforeNativeSelection === true;
  const neverClaimed = run.runtimeMode === "native" && coordinator &&
    ["observed", "terminal_failure"].includes(coordinator.phase) && coordinator.attempt === 0 &&
    coordinator.controllerGeneration === 0 && !coordinator.controllerBootId &&
    !coordinator.controllerPid && !coordinator.leaseOwner && !coordinator.leaseExpiresAt &&
    !coordinator.resultId && !coordinator.failureDetail?.successorRunId;
  if (!beforeSelection && !neverClaimed) return false;
  const settled = typeof run.resultJson?.startupPreparationSettledAt === "string";
  // The old preparer can still be unwinding even though the run is terminal.
  if (!settled && run.controllerLeaseExpiresAt && run.controllerLeaseExpiresAt > new Date()) return false;
  const leases = await db.select().from(environmentLeases).where(and(
    eq(environmentLeases.companyId, run.companyId), eq(environmentLeases.heartbeatRunId, run.id),
  ));
  if ((!settled && leases.length === 0) || leases.some(lease =>
    lease.provider === "local"
      ? !lease.releasedAt || lease.status === "pending_cleanup" || lease.cleanupStatus === "failed"
      : !hasRemoteTerminationReceipt(lease))) return false;
  // Reject contradictory retained evidence, including a crash after a launch
  // request but before the PID callback. Provider events never certify a stop.
  const [execution] = await db.select({ id: heartbeatRunEvents.id }).from(heartbeatRunEvents).where(and(
    eq(heartbeatRunEvents.companyId, run.companyId), eq(heartbeatRunEvents.runId, run.id),
    or(isNotNull(heartbeatRunEvents.sourceEventId),
      inArray(heartbeatRunEvents.eventType, [PROCESS_START_REQUESTED, PROCESS_IDENTITY_RECORDED, IN_PROCESS_BACKEND_ADMITTED,
        "harness.ready", "session.started", "session.resumed", "session.updated", "turn.started",
        "provider.event", "provider.rpc_result", "tool.execution.started"])),
  )).limit(1);
  return !execution;
}

/** Settle a never-claimed coordinator after a Stop that landed after Native
 * selection but before the first claim. Without this, its `observed` phase
 * reads as pending cleanup forever and holds the Task owner and Plan creation.
 * Same lock order as the Native claim and explicit continuation (coordinator,
 * then run); the full startup proof is rechecked under both locks, and the
 * update only matches the unclaimed attempt-zero row. Idempotent. */
export async function settleCancelledNativeStartupCoordinator(db: Db, companyId: string, runId: string): Promise<boolean> {
  return await db.transaction(async rawTx => {
    const tx = rawTx as unknown as Db;
    const [coordinator] = await tx.select().from(nativeRunFinalizations).where(and(
      eq(nativeRunFinalizations.companyId, companyId), eq(nativeRunFinalizations.runId, runId),
    )).for("update");
    const [run] = await tx.select().from(heartbeatRuns).where(and(
      eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, runId),
    )).for("update");
    if (!run || run.runtimeMode !== "native" || coordinator?.phase !== "observed" ||
        !await isCancelledNativeStartup(tx, run, coordinator)) return false;
    const now = new Date();
    const settled = await tx.update(nativeRunFinalizations).set({
      phase: "terminal_failure", failureCode: "native_startup_cancelled", nextAttemptAt: null,
      controlDeadlineAt: null, updatedAt: now,
    }).where(and(
      eq(nativeRunFinalizations.companyId, companyId), eq(nativeRunFinalizations.runId, runId),
      eq(nativeRunFinalizations.phase, "observed"), eq(nativeRunFinalizations.attempt, 0),
      eq(nativeRunFinalizations.controllerGeneration, 0), isNull(nativeRunFinalizations.leaseOwner),
    )).returning({ runId: nativeRunFinalizations.runId });
    if (!settled.length) return false;
    await tx.update(heartbeatRuns).set({
      nativePhase: "terminal_failure", nativePhaseUpdatedAt: now, executionControlDeadlineAt: null,
    }).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, runId)));
    return true;
  });
}
