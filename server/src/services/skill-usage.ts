import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { agentExecutionManifests, companySkillUsageEvents, heartbeatRuns, type Db } from "@paperclipai/db";

const settledSkillRun = and(
  inArray(heartbeatRuns.status, ["succeeded", "interrupted", "failed", "cancelled", "timed_out"]),
  or(ne(heartbeatRuns.runtimeMode, "native"), eq(heartbeatRuns.nativePhase, "committed")),
);

/** Run success is not proof of a procedure's outcome: preserve unknown. */
export async function recordEagerSkillLoading(db: Db, companyId: string, runId: string, agentId: string) {
  const [record] = await db.select().from(agentExecutionManifests).where(and(eq(agentExecutionManifests.companyId, companyId), eq(agentExecutionManifests.runId, runId), eq(agentExecutionManifests.agentId, agentId))).limit(1);
  if (!record) return;
  const pins = record.manifest.skills.filter((pin) => pin.loadPoint !== "on_demand");
  if (pins.length) await db.insert(companySkillUsageEvents).values(pins.map((pin) => ({ companyId, runId, agentId, skillId: pin.skillId, skillVersionId: pin.versionId, selectionReason: pin.selection, stage: "loaded" }))).onConflictDoNothing();
}
export async function recordSkillExecutionCompletion(db: Db, companyId: string, runId: string, agentId: string) {
  const [run] = await db.select({ status: heartbeatRuns.status }).from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, runId), eq(heartbeatRuns.agentId, agentId), settledSkillRun)).limit(1);
  // A retry, detached controller or unconfirmed Stop may retain ownership.
  // Only the committed terminal execution can settle its loaded observations.
  if (!run || !["succeeded", "interrupted", "failed", "cancelled", "timed_out"].includes(run.status)) return;
  const loaded = await db.select().from(companySkillUsageEvents).where(and(eq(companySkillUsageEvents.companyId, companyId), eq(companySkillUsageEvents.runId, runId), eq(companySkillUsageEvents.agentId, agentId), inArray(companySkillUsageEvents.stage, ["loaded", "used"])));
  const pins = [...new Map(loaded.map((event) => [event.skillVersionId, event])).values()];
  if (pins.length) await db.insert(companySkillUsageEvents).values(pins.map((pin) => ({ companyId, runId, agentId, skillId: pin.skillId, skillVersionId: pin.skillVersionId, selectionReason: pin.selectionReason, stage: "completed", outcome: "unknown" }))).onConflictDoNothing();
}

/** Recover observations committed before executor loss or durable finalization. */
export async function reconcileSkillExecutionCompletions(db: Db) {
  // ponytail: 500 missing observations per sweep; the periodic reaper drains
  // larger backlogs without loading all company histories into memory.
  const inserted = await db.execute(sql`
    insert into ${companySkillUsageEvents}
      (company_id, run_id, agent_id, skill_id, skill_version_id, selection_reason, stage, outcome)
    select distinct on (loaded.run_id, loaded.skill_version_id)
      loaded.company_id, loaded.run_id, loaded.agent_id, loaded.skill_id,
      loaded.skill_version_id, loaded.selection_reason, 'completed', 'unknown'
    from ${companySkillUsageEvents} loaded
    join ${heartbeatRuns}
      on ${heartbeatRuns.id} = loaded.run_id
      and ${heartbeatRuns.companyId} = loaded.company_id
      and ${heartbeatRuns.agentId} = loaded.agent_id
    where loaded.stage in ('loaded', 'used') and ${settledSkillRun}
      and not exists (
        select 1 from ${companySkillUsageEvents} completed
        where completed.run_id = loaded.run_id
          and completed.skill_version_id = loaded.skill_version_id
          and completed.stage = 'completed'
      )
    order by loaded.run_id, loaded.skill_version_id, loaded.created_at, loaded.id
    limit 500
    on conflict (run_id, skill_version_id, stage) do nothing
    returning id
  `);
  return { completed: inserted.length };
}
