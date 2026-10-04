import { and, eq, inArray } from "drizzle-orm";
import { agentExecutionManifests, companySkillUsageEvents, heartbeatRuns, type Db } from "@paperclipai/db";

/** Run success is not proof of a procedure's outcome: preserve unknown. */
export async function recordEagerSkillLoading(db: Db, companyId: string, runId: string, agentId: string) {
  const [record] = await db.select().from(agentExecutionManifests).where(and(eq(agentExecutionManifests.companyId, companyId), eq(agentExecutionManifests.runId, runId), eq(agentExecutionManifests.agentId, agentId))).limit(1);
  if (!record) return;
  const pins = record.manifest.skills.filter((pin) => pin.loadPoint !== "on_demand");
  if (pins.length) await db.insert(companySkillUsageEvents).values(pins.map((pin) => ({ companyId, runId, agentId, skillId: pin.skillId, skillVersionId: pin.versionId, selectionReason: pin.selection, stage: "loaded" }))).onConflictDoNothing();
}
export async function recordSkillExecutionCompletion(db: Db, companyId: string, runId: string, agentId: string) {
  const [run] = await db.select({ status: heartbeatRuns.status }).from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, runId), eq(heartbeatRuns.agentId, agentId))).limit(1);
  // A retry, detached controller or unconfirmed Stop may retain ownership.
  // Only the committed terminal execution can settle its loaded observations.
  if (!run || !["succeeded", "interrupted", "failed", "cancelled", "timed_out"].includes(run.status)) return;
  const loaded = await db.select().from(companySkillUsageEvents).where(and(eq(companySkillUsageEvents.companyId, companyId), eq(companySkillUsageEvents.runId, runId), eq(companySkillUsageEvents.agentId, agentId), inArray(companySkillUsageEvents.stage, ["loaded", "used"])));
  const pins = [...new Map(loaded.map((event) => [event.skillVersionId, event])).values()];
  if (pins.length) await db.insert(companySkillUsageEvents).values(pins.map((pin) => ({ companyId, runId, agentId, skillId: pin.skillId, skillVersionId: pin.skillVersionId, selectionReason: pin.selectionReason, stage: "completed", outcome: "unknown" }))).onConflictDoNothing();
}
