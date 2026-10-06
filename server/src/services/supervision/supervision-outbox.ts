import { and, eq } from "drizzle-orm";
import { supervisionSessions, supervisionInterventions, type Db, type orchestrationPlans } from "@paperclipai/db";
import type { SupervisionAction } from "@paperclipai/shared";
import { nativeSha256 } from "../native-runtime/canonical.js";
export type SupervisedPlan = typeof orchestrationPlans.$inferSelect;
/** The caller holds the privacy and plan locks. Stop remains durable with rollout disabled. */
export async function ensureSupervisionSession(tx: Db, plan: SupervisedPlan) {
  const [existing] = await tx.select().from(supervisionSessions).where(and(eq(supervisionSessions.companyId, plan.companyId), eq(supervisionSessions.planId, plan.id), eq(supervisionSessions.status, "active")));
  if (existing) return existing;
  const [created] = await tx.insert(supervisionSessions).values({ companyId: plan.companyId, planId: plan.id, policy: plan.supervisionPolicy, lastProgressAt: plan.startedAt }).returning();
  return created!;
}
export async function enqueueSupervisionStop(tx: Db, plan: SupervisedPlan, input: { actorType: "user" | "system"; actorId: string; rationale: string; action: SupervisionAction; recommendation?: SupervisionAction; reasonCode: string; attemptIds: string[]; signalIds?: string[] }) {
  const session = await ensureSupervisionSession(tx, plan);
  const [row] = await tx.insert(supervisionInterventions).values({ companyId: plan.companyId, planId: plan.id, sessionId: session.id, recommendation: input.recommendation ?? input.action, decisionAction: input.action,
    reasonCode: input.reasonCode, policySnapshotHash: nativeSha256(plan.supervisionPolicy), expectedPlanVersion: plan.version, requestedByType: input.actorType, requestedById: input.actorId, rationale: input.rationale,
    signalIds: input.signalIds ?? [], targetAttemptIds: input.attemptIds, idempotencyKey: `stop:${plan.id}:${plan.version}:${input.reasonCode}`, status: "pending" }).onConflictDoNothing().returning();
  return row ?? null;
}
