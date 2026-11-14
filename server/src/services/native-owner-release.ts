import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  environmentLeases,
  heartbeatRunEvents,
  heartbeatRuns,
  nativeRunFinalizations,
} from "@paperclipai/db";
import { hasPendingRunCleanup } from "./execution-blocker.js";
import {
  hasNativeLocalProcessStop,
  IN_PROCESS_BACKEND_ADMITTED,
  IN_PROCESS_BACKEND_SETTLED,
} from "./native-local-process-stop.js";
import { stoppedRemoteCleanupScopes } from "./remote-execution-termination.js";
import { parseNativeExecutionInput } from "../vendor/paperclip-runner/index.js";

type HeartbeatRunRow = typeof heartbeatRuns.$inferSelect;

async function nativeInProcessControllerSettled(
  db: Db,
  run: HeartbeatRunRow,
  issueId: string,
): Promise<boolean> {
  let execution: ReturnType<typeof parseNativeExecutionInput>;
  try {
    execution = parseNativeExecutionInput(run.runnerProfileJson?.nativeExecutionInput);
  } catch {
    return false;
  }
  const binding = execution.binding;
  if (
    execution.session.driverKind !== "aw_text_messages" ||
    run.nativeIssueId !== issueId ||
    binding.companyId !== run.companyId ||
    binding.runId !== run.id ||
    binding.issueId !== issueId ||
    binding.agentId !== run.agentId
  ) return false;
  const events = await db
    .select({ seq: heartbeatRunEvents.seq, eventType: heartbeatRunEvents.eventType, payload: heartbeatRunEvents.payload })
    .from(heartbeatRunEvents)
    .where(and(
      eq(heartbeatRunEvents.companyId, run.companyId),
      eq(heartbeatRunEvents.runId, run.id),
      eq(heartbeatRunEvents.agentId, run.agentId),
      isNull(heartbeatRunEvents.sourceEventId),
      inArray(heartbeatRunEvents.eventType, [IN_PROCESS_BACKEND_ADMITTED, IN_PROCESS_BACKEND_SETTLED]),
    ))
    .orderBy(desc(heartbeatRunEvents.seq));
  const settled = events.find(event => event.eventType === IN_PROCESS_BACKEND_SETTLED);
  const admission = events.find(event => event.eventType === IN_PROCESS_BACKEND_ADMITTED &&
    String(event.seq) === String(settled?.payload?.admissionEventSeq));
  return events[0]?.eventType === IN_PROCESS_BACKEND_SETTLED && Boolean(settled && admission) &&
    BigInt(String(admission!.seq)) < BigInt(String(settled!.seq));
}

async function nativeOwnerReleaseHasNullableCleanupProof(
  db: Db,
  run: HeartbeatRunRow,
  issueId: string | null,
): Promise<boolean> {
  const leases = await db.select().from(environmentLeases).where(and(
    eq(environmentLeases.companyId, run.companyId),
    eq(environmentLeases.heartbeatRunId, run.id),
  ));
  const allReleasedLocal = leases.length > 0 && leases.every(lease => lease.provider === "local" &&
    ["released", "expired", "failed"].includes(lease.status) && lease.releasedAt !== null && lease.cleanupStatus === "success");
  if (allReleasedLocal && await hasNativeLocalProcessStop(db, run.companyId, run.id)) return true;
  if (issueId && await nativeInProcessControllerSettled(db, run, issueId) && leases.every(lease => lease.provider === "local" &&
      ["released", "expired", "failed"].includes(lease.status) && lease.releasedAt !== null && lease.cleanupStatus === "success")) return true;
  if (!run.runnerProfileJson || typeof run.runnerProfileJson !== "object" || Array.isArray(run.runnerProfileJson) ||
      run.runnerProfileJson.nativeRemoteRuntimeAssetLocator === undefined) return false;
  // This verifies the family-specific signed Stop/Inspect or typed bootstrap
  // prelaunch Stop proof, as well as every exact released remote lease receipt.
  return await stoppedRemoteCleanupScopes(db, run.companyId, run.id) !== null;
}

/** Current shared owner-release proof; nullable process state is unknown until
 * one of its original Native family owners records an exact physical settlement. */
export async function nativeOwnerReleaseHasCleanupProof(
  db: Db,
  run: HeartbeatRunRow,
  issueId: string | null,
): Promise<boolean> {
  if (run.runtimeMode !== "native" || await hasPendingRunCleanup(db, run.companyId, run.id) ||
      !run.finishedAt || !["succeeded", "failed", "cancelled", "timed_out", "interrupted"].includes(run.status) ||
      run.nativeProcessCleanupPending === true) return false;
  if (run.nativeProcessCleanupPending === null) {
    if (!await nativeOwnerReleaseHasNullableCleanupProof(db, run, issueId)) return false;
  }
  if (run.status !== "succeeded") return true;
  if (!issueId || run.nativeIssueId !== issueId) return false;
  const [finalization] = await db.select({ runId: nativeRunFinalizations.runId }).from(nativeRunFinalizations).where(and(
    eq(nativeRunFinalizations.companyId, run.companyId),
    eq(nativeRunFinalizations.runId, run.id),
    eq(nativeRunFinalizations.issueId, issueId),
    eq(nativeRunFinalizations.phase, "committed"),
    isNull(nativeRunFinalizations.leaseOwner),
  )).limit(1);
  if (!finalization) return false;
  const leases = await db.select().from(environmentLeases).where(and(
    eq(environmentLeases.companyId, run.companyId),
    eq(environmentLeases.heartbeatRunId, run.id),
  ));
  const allReleasedLocal = leases.length > 0 && leases.every(lease => lease.provider === "local" &&
    ["released", "expired", "failed"].includes(lease.status) && lease.releasedAt !== null && lease.cleanupStatus === "success");
  if (allReleasedLocal && await hasNativeLocalProcessStop(db, run.companyId, run.id)) return true;
  if (await nativeInProcessControllerSettled(db, run, issueId) && leases.every(lease => lease.provider === "local" &&
      ["released", "expired", "failed"].includes(lease.status) && lease.releasedAt !== null && lease.cleanupStatus === "success")) return true;
  if (!run.runnerProfileJson || typeof run.runnerProfileJson !== "object" || Array.isArray(run.runnerProfileJson) ||
      run.runnerProfileJson.nativeRemoteRuntimeAssetLocator === undefined || !leases.length) return false;
  return await stoppedRemoteCleanupScopes(db, run.companyId, run.id) !== null;
}
