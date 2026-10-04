import { and, eq, inArray } from "drizzle-orm";
import { agentExecutionManifests, companySkillUsageEvents, type Db } from "@paperclipai/db";

/** Run success is not proof of a procedure's outcome: preserve unknown. */
export async function recordEagerSkillLoading(db: Db, companyId: string, runId: string, agentId: string) {
  const [record] = await db.select().from(agentExecutionManifests).where(and(eq(agentExecutionManifests.companyId, companyId), eq(agentExecutionManifests.runId, runId), eq(agentExecutionManifests.agentId, agentId))).limit(1);
  if (!record) return;
  const pins = record.manifest.skills.filter((pin) => pin.loadPoint !== "on_demand");
  if (pins.length) await db.insert(companySkillUsageEvents).values(pins.map((pin) => ({ companyId, runId, agentId, skillId: pin.skillId, skillVersionId: pin.versionId, selectionReason: pin.selection, stage: "loaded" }))).onConflictDoNothing();
}
export async function recordSkillExecutionCompletion(db: Db, companyId: string, runId: string, agentId: string) {
  const loaded = await db.select().from(companySkillUsageEvents).where(and(eq(companySkillUsageEvents.companyId, companyId), eq(companySkillUsageEvents.runId, runId), eq(companySkillUsageEvents.agentId, agentId), inArray(companySkillUsageEvents.stage, ["loaded", "used"])));
  const pins = [...new Map(loaded.map((event) => [event.skillVersionId, event])).values()];
  if (pins.length) await db.insert(companySkillUsageEvents).values(pins.map((pin) => ({ companyId, runId, agentId, skillId: pin.skillId, skillVersionId: pin.skillVersionId, selectionReason: pin.selectionReason, stage: "completed", outcome: "unknown" }))).onConflictDoNothing();
}
