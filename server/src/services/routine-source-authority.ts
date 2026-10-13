import { and, eq, sql } from "drizzle-orm";
import { heartbeatRuns, type Db } from "@paperclipai/db";
import { z } from "zod";
import type { AuthorizationActor } from "./authorization.js";
import { assertAnalyticalContextPayloadAccess } from "./analytical-context-authority.js";
import { assertV5Authorization } from "./v5-authorization.js";
import { forbidden } from "../errors.js";

export type RoutineSource = { id: string; companyId: string; originKind: string; originId: string | null;
  createdByAgentId: string | null; responsibleUserId: string | null };

/** New conversation drafts retain the actual Original run as their source.
 * A trusted scheduler uses the saved responsible user; HTTP readers supply
 * their current authenticated actor through the routine service. */
export async function assertRoutineSourceAccess(db: Db, routine: RoutineSource, reader?: AuthorizationActor) {
  if (routine.originKind !== "conversation_draft") return;
  if (!routine.responsibleUserId || !z.uuid().safeParse(routine.originId).success)
    throw forbidden("The saved routine source is unavailable");
  const actor = reader ?? { type: "board", source: "session", userId: routine.responsibleUserId, ignoreInstanceAdmin: true };
  await assertV5Authorization(db, { ...actor, ignoreInstanceAdmin: true, isInstanceAdmin: false }, routine.companyId, "company_scope:read");
  const [origin] = await db.select({ id: heartbeatRuns.id, agentId: heartbeatRuns.agentId, userId: heartbeatRuns.responsibleUserId })
    .from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, routine.companyId), eq(heartbeatRuns.id, routine.originId!)));
  if (!origin || origin.agentId !== routine.createdByAgentId || origin.userId !== routine.responsibleUserId)
    throw forbidden("The actual routine authoring source changed");
  const [source] = await db.execute<{ erased: boolean }>(sql`select aw_conversation_routine_source_erased(${routine.companyId}::uuid,${routine.id}::uuid) as erased`);
  if (source?.erased) throw forbidden("The saved routine source was erased or withdrawn");
  await assertAnalyticalContextPayloadAccess(db, routine.companyId, actor, { runId: origin.id });
}
