import { and, eq } from "drizzle-orm";
import { agentConfigurationTests, heartbeatRuns, orchestrationPlans, orchestrationModelReservations, type Db } from "@paperclipai/db";
import { modelReservationService } from "../orchestration/model-reservations.js";
import { withV7ActivityTransaction, logActivity } from "../v7-mutations.js";
import { forbidden } from "../../errors.js";

/** The ordinary process reaper must never retry an in-flight text test. After
 * its persisted deadline no dispatch or publication is admissible. Recovery
 * retains ambiguous model spend and never calls a model. */
export async function reconcileAgentDraftTest(db: Db, run: typeof heartbeatRuns.$inferSelect): Promise<boolean> {
  if (run.triggerDetail !== "agent_safe_test") return false;
  const [test] = await db.select().from(agentConfigurationTests).where(and(eq(agentConfigurationTests.companyId, run.companyId),
    eq(agentConfigurationTests.agentId, run.agentId), eq(agentConfigurationTests.runId, run.id)));
  if (!test || test.id !== run.contextSnapshot?.agentConfigurationTestId || test.createdByUserId !== run.responsibleUserId) return false;
  await withV7ActivityTransaction(db, async (tx, publications) => {
    const [current] = await tx.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run.id)).for("update");
    const [plan] = await tx.select().from(orchestrationPlans).where(and(eq(orchestrationPlans.companyId, run.companyId), eq(orchestrationPlans.id, test.planId))).for("share");
    if (!current || current.status !== "running" || !plan?.startedAt || plan.startedAt.getTime() + plan.budgets.maxWallClockSeconds * 1000 > Date.now()) return;
    let [receipt] = await tx.select().from(orchestrationModelReservations).where(and(eq(orchestrationModelReservations.companyId, run.companyId), eq(orchestrationModelReservations.planId, test.planId)));
    if (receipt?.status === "dispatched") {
      const broker = modelReservationService(tx, { sourceSha: receipt.quote.sourceSha,
        qualifiedTariff: async () => { throw forbidden("Recovery cannot authorize model spend"); },
        currentAuthority: async () => { throw forbidden("Recovery cannot authorize model dispatch"); } });
      await broker.recordOutcome(run.companyId, receipt.id, { status: "unknown", providerResponseHash: null, usage: null });
      [receipt] = await tx.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.id, receipt.id));
    }
    const unknown = receipt?.status === "unknown";
    await tx.update(heartbeatRuns).set({ status: "failed", finishedAt: new Date(), errorCode: unknown ? "agent_test_outcome_unknown" : "agent_test_failed",
      error: "Representative test deadline expired; review its retained outcome", resultJson: { agentSafeTest: true, reservationId: receipt?.id ?? null,
        outcomeUnknown: unknown, toolsGranted: false, activatesAgent: false } }).where(and(eq(heartbeatRuns.id, run.id), eq(heartbeatRuns.status, "running")));
    await logActivity(tx, { companyId: run.companyId, actorType: "system", actorId: "agent-test-recovery", agentId: run.agentId, runId: run.id,
      action: "agent_configuration.test_deadline_reconciled", entityType: "heartbeat_run", entityId: run.id,
      details: { testId: test.id, reservationId: receipt?.id ?? null, outcomeUnknown: unknown, modelDispatched: false } }, publications);
  });
  return true;
}
