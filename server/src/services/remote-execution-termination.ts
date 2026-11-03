import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { environmentLeases, heartbeatRunEvents, heartbeatRuns, runtimeHostCommands, type Db } from "@paperclipai/db";

import { appendHeartbeatRunEvent } from "./heartbeat-run-events.js";
import { nativeSha256 } from "./native-runtime/canonical.js";

export const NATIVE_REMOTE_WORKLOAD_STOPPED = "native.remote_workload_stopped";

type LeaseIdentity = {
  id: string; companyId: string; heartbeatRunId: string | null;
  provider: string | null; providerLeaseId: string | null;
};

/** Bind a provider receipt to the exact host-owned lease and run. Old plugins
 * return void; that remains supported but grants no continuation authority. */
export function remoteTerminationReceipt(lease: LeaseIdentity, value: unknown) {
  const receipt = value as { providerLeaseId?: unknown; state?: unknown } | null;
  if (!lease.heartbeatRunId || !lease.provider || lease.provider === "local" ||
      !lease.providerLeaseId || receipt?.providerLeaseId !== lease.providerLeaseId ||
      !["stopped", "destroyed"].includes(String(receipt?.state))) return undefined;
  return {
    schema: "paperclip.remote-termination.v1", companyId: lease.companyId,
    runId: lease.heartbeatRunId, leaseId: lease.id, provider: lease.provider,
    providerLeaseId: lease.providerLeaseId, state: receipt!.state,
    confirmedAt: new Date().toISOString(),
  };
}

/** Preserve a Native Sandbox receipt only after the original signed physical
 * Stop/observation ledger is rechecked; provider void cannot settle cleanup. */
export async function currentRemoteTerminationReceipt(db: Db, lease: LeaseIdentity, value: unknown) {
  const [run] = lease.heartbeatRunId ? await db.select().from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, lease.companyId), eq(heartbeatRuns.id, lease.heartbeatRunId),
  )) : [];
  if (run?.runnerProfileJson && typeof run.runnerProfileJson === "object" && !Array.isArray(run.runnerProfileJson) &&
    run.runnerProfileJson.nativeRemoteRuntimeAssetLocator !== undefined) {
    const { verifyNativeCleanupRuntimeState } = await import("./execution-sandbox/run-lease-cleanup.js");
    return await verifyNativeCleanupRuntimeState(db, { companyId: run.companyId, runId: run.id, leaseId: lease.id }, value);
  }
  return remoteTerminationReceipt(lease, value);
}

export function hasRemoteTerminationReceipt(lease: LeaseIdentity & {
  releasedAt: unknown; cleanupStatus: string | null; status: string;
  metadata: Record<string, unknown> | null;
}): boolean {
  const receipt = lease.metadata?.remoteExecutionTermination as Record<string, unknown> | undefined;
  return Boolean(lease.releasedAt && lease.cleanupStatus === "success" &&
    ["released", "expired", "failed"].includes(lease.status) && receipt &&
    receipt.schema === "paperclip.remote-termination.v1" &&
    receipt.companyId === lease.companyId && receipt.runId === lease.heartbeatRunId &&
    receipt.leaseId === lease.id && receipt.provider === lease.provider &&
    remoteTerminationReceipt(lease, receipt));
}

export function remoteLeaseCleanupScope(lease: Pick<LeaseIdentity, "provider" | "providerLeaseId">) {
  return lease.provider && lease.provider !== "local" && lease.providerLeaseId
    ? JSON.stringify([lease.provider, lease.providerLeaseId]) : undefined;
}

export async function stoppedRemoteCleanupScopes(db: Db, companyId: string, runId: string) {
  const leases = await db.select().from(environmentLeases).where(and(
    eq(environmentLeases.companyId, companyId), eq(environmentLeases.heartbeatRunId, runId),
  ));
  if (leases.length === 0 || !leases.every(hasRemoteTerminationReceipt)) return null;
  const [run] = await db.select().from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, runId),
  ));
  if (run?.runnerProfileJson && typeof run.runnerProfileJson === "object" && !Array.isArray(run.runnerProfileJson) &&
    run.runnerProfileJson.nativeRemoteRuntimeAssetLocator !== undefined) {
    if (!await verifiedNativeRemoteStopProofs(db, { companyId, runId }, run, leases)) return null;
  }
  return [...new Set(leases.map(lease => remoteLeaseCleanupScope(lease)!))];
}

export async function remoteExecutionHasStopped(db: Db, companyId: string, runId: string) {
  return await stoppedRemoteCleanupScopes(db, companyId, runId) !== null;
}

/** Current server-original intent, shared with private cleanup idempotency. */
export async function readNativeRemoteWorkloadIntent(db: Db, input: {
  companyId: string; runId: string; agentId: string;
}): Promise<{ eventId: string; seq: string; createdAt: string } | null> {
  const [launch] = await db.select({ id: heartbeatRunEvents.id, seq: heartbeatRunEvents.seq,
    createdAt: heartbeatRunEvents.createdAt }).from(heartbeatRunEvents).where(and(
    eq(heartbeatRunEvents.companyId, input.companyId), eq(heartbeatRunEvents.runId, input.runId),
    eq(heartbeatRunEvents.agentId, input.agentId), isNull(heartbeatRunEvents.sourceEventId),
    inArray(heartbeatRunEvents.eventType, ["native.process_start_requested", "native.process_identity_recorded"]),
  )).orderBy(desc(heartbeatRunEvents.seq)).limit(1);
  if (!launch || !Number.isSafeInteger(launch.id) || launch.id < 1 ||
    !Number.isSafeInteger(launch.seq) || launch.seq < 1) return null;
  return { eventId: String(launch.id), seq: String(launch.seq), createdAt: launch.createdAt.toISOString() };
}

/** Pure currentness shared by the scoped reader and explicit write owner. */
async function verifiedNativeRemoteStopProofs(db: Db, input: { companyId: string; runId: string },
  run: typeof heartbeatRuns.$inferSelect, leases: Array<typeof environmentLeases.$inferSelect>) {
  if (run.runtimeMode !== "native" || !run.runnerProfileJson?.nativeRemoteRuntimeAssetLocator || !leases.length ||
    leases.some(lease => !lease.provider || lease.provider === "local" || !hasRemoteTerminationReceipt(lease))) return null;
  const launch = await readNativeRemoteWorkloadIntent(db, { companyId: input.companyId, runId: input.runId, agentId: run.agentId });
  if (!launch) return null;
  const { verifyNativeCleanupRuntimeState } = await import("./execution-sandbox/run-lease-cleanup.js");
  const proofs: Array<{ leaseId: string; stopCommandId: string; inspectCommandId: string; receiptDigest: string }> = [];
  try {
    for (const lease of leases) {
      const verified = await verifyNativeCleanupRuntimeState(db, { companyId: input.companyId, runId: input.runId, leaseId: lease.id },
        lease.metadata?.remoteExecutionTermination);
      // The existing verifier returns these canonical, validated ledger refs.
      const proof = verified.sandboxStop as { stopCommandId: string; inspectCommandId: string };
      // PostgreSQL keeps the event/command chronology finer than JS Date.
      const afterIntent = sql`(select e.created_at from heartbeat_run_events e where e.id=${launch.eventId}::bigint
        and e.company_id=${input.companyId}::uuid and e.run_id=${input.runId}::uuid
        and e.agent_id=${run.agentId}::uuid and e.source_event_id is null)`;
      const currentProofs = await db.select({ id: runtimeHostCommands.id }).from(runtimeHostCommands).where(and(
        eq(runtimeHostCommands.companyId, input.companyId), eq(runtimeHostCommands.status, "SUCCEEDED"),
        inArray(runtimeHostCommands.id, [proof.stopCommandId, proof.inspectCommandId]),
        sql`${runtimeHostCommands.createdAt} > ${afterIntent}`,
        sql`${runtimeHostCommands.completedAt} > ${afterIntent}`,
      ));
      if (currentProofs.length !== 2) return null;
      proofs.push({ leaseId: lease.id, stopCommandId: proof.stopCommandId,
        inspectCommandId: proof.inspectCommandId, receiptDigest: nativeSha256(verified) });
    }
  } catch { return null; }
  const currentIntent = await readNativeRemoteWorkloadIntent(db, {
    companyId: input.companyId, runId: input.runId, agentId: run.agentId,
  });
  if (!currentIntent || currentIntent.eventId !== launch.eventId || currentIntent.seq !== launch.seq ||
    currentIntent.createdAt !== launch.createdAt) return null;
  return { launch, proofs };
}

/** Explicit write owner after remote lease release. Read predicates never
 * append process evidence or repair resource projections. */
export async function recordNativeRemoteWorkloadStopped(db: Db, input: {
  companyId: string; runId: string;
}): Promise<boolean> {
  return await db.transaction(async rawTx => {
    const tx = rawTx as unknown as Db;
    const [run] = await tx.select().from(heartbeatRuns).where(and(
      eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, input.runId),
    )).for("update");
    const locator = run?.runnerProfileJson?.nativeRemoteRuntimeAssetLocator;
    if (!run || run.runtimeMode !== "native" || !locator) return false;
    const leases = await tx.select().from(environmentLeases).where(and(
      eq(environmentLeases.companyId, input.companyId), eq(environmentLeases.heartbeatRunId, input.runId),
    )).orderBy(asc(environmentLeases.id)).for("update");
    const current = await verifiedNativeRemoteStopProofs(tx, input, run, leases);
    if (!current) return false;
    const { launch, proofs } = current;
    const [latest] = await tx.select({ eventType: heartbeatRunEvents.eventType }).from(heartbeatRunEvents).where(and(
      eq(heartbeatRunEvents.companyId, input.companyId), eq(heartbeatRunEvents.runId, input.runId),
      eq(heartbeatRunEvents.agentId, run.agentId), isNull(heartbeatRunEvents.sourceEventId),
      inArray(heartbeatRunEvents.eventType, ["native.process_start_requested", "native.process_identity_recorded",
        "native.local_process_stopped", NATIVE_REMOTE_WORKLOAD_STOPPED]),
    )).orderBy(desc(heartbeatRunEvents.seq)).limit(1);
    if (latest?.eventType === NATIVE_REMOTE_WORKLOAD_STOPPED && run.nativeProcessCleanupPending === false) return true;
    await appendHeartbeatRunEvent(tx, {
      companyId: input.companyId, runId: input.runId, agentId: run.agentId, eventType: NATIVE_REMOTE_WORKLOAD_STOPPED,
      stream: "system", level: "info", message: "Native verified the remote workload stopped.",
      payload: { locatorDigest: nativeSha256(locator), leases: proofs,
        launchIntent: launch },
    });
    return true;
  });
}
