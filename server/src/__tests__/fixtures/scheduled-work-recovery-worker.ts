import { eq, sql } from "drizzle-orm";
import { createDb, routineRuns } from "@paperclipai/db";
import type { AuthorizationActor } from "../../services/authorization.js";
import { heartbeatService } from "../../services/heartbeat.js";
import { routineService } from "../../services/routines.js";
import { createDeliveryWorkCoordinator } from "../../services/delivery-work-coordinator.js";
import { registerScheduledWork } from "../../services/scheduled-work.js";

async function main() {
  const connectionString = process.env.PAPERCLIP_TEST_DATABASE_URL;
  const companyId = process.env.PAPERCLIP_TEST_COMPANY_ID;
  const routineId = process.env.PAPERCLIP_TEST_ROUTINE_ID;
  const actorJson = process.env.PAPERCLIP_TEST_ROUTINE_ACTOR;
  if (!connectionString || !companyId || !routineId || !actorJson) throw new Error("Scheduled recovery worker configuration is incomplete");
  const db = createDb(connectionString, { maxConnections: 8 });
  const actor = JSON.parse(actorJson) as AuthorizationActor;
  const routines = routineService(db, { sourceActor: actor });
  const heartbeat = heartbeatService(db);
  const coordinator = createDeliveryWorkCoordinator({ owner: db, canRun: () => true,
    onError: error => { throw error; } });
  let recoveryAck = false;
  const workers = registerScheduledWork(coordinator, db, {
    retryMs: 60_000,
    tickTimers: signal => heartbeat.tickIssueMonitors(new Date(), signal),
    tickRoutines: async signal => {
      await routines.tickScheduledTriggers(new Date(), signal);
      const [run] = await db.select({ id: routineRuns.id, status: routineRuns.status,
        linkedIssueId: routineRuns.linkedIssueId }).from(routineRuns)
        .where(eq(routineRuns.routineId, routineId)).orderBy(routineRuns.triggeredAt).limit(1);
      if (recoveryAck) {
        recoveryAck = false;
        const [trigger] = await db.execute<{ next_run_at: Date | string | null }>(sql`select next_run_at from routine_triggers
          where company_id = ${companyId}::uuid and routine_id = ${routineId}::uuid and kind = 'schedule' limit 1`);
        process.send?.({ type: "reconciled", nextRunAt: trigger?.next_run_at == null
          ? null : new Date(trigger.next_run_at).toISOString() });
      }
      if (run?.status === "issue_created" && run.linkedIssueId)
        process.send?.({ type: "occurrence_finished", runId: run.id, issueId: run.linkedIssueId });
    },
  });
  try {
    await Promise.all([workers.routines.ready, workers.timers.ready]);
    process.send?.({ type: "ready", nextWakeAt: coordinator.nextWakeAt() });
    process.on("message", async message => {
      if (!message || typeof message !== "object") return;
      const value = message as Record<string, unknown>;
      if (value.type === "wake") {
        recoveryAck = true;
        workers.routines.wake();
      } else if (value.type === "stop") {
        await coordinator.stop();
        await db.$client.end({ timeout: 1 }).catch(() => undefined);
        process.send?.({ type: "stopped" }, () => process.exit(0));
      }
    });
  } catch (error) {
    const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
    process.send?.({ type: "worker_error", message: typeof value.message === "string" ? value.message : "Scheduled recovery worker failed" });
    await coordinator.stop().catch(() => undefined);
    await db.$client.end({ timeout: 1 }).catch(() => undefined);
    process.exitCode = 1;
  }
}

void main();
