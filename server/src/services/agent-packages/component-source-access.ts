import { and, eq } from "drizzle-orm";
import { routineRevisions, routines, type Db } from "@paperclipai/db";
import { routineRevisionSnapshotV1Schema } from "@paperclipai/shared";
import type { AuthorizationActor } from "../authorization.js";
import { assertV7Authorization } from "../v7-authorization.js";
import { assertRoutineSourceAccess } from "../routine-source-authority.js";
import { workflowService } from "../workflows/workflow-service.js";
import { conflict } from "../../errors.js";

/** A matching digest is not authority to copy a private automation. Reuse the
 * Original readers for both the selected revision and its retained owner. */
export async function assertPackageAutomationSource(
  db: Db,
  reader: AuthorizationActor,
  companyId: string,
  type: "workflow_template" | "routine_template",
  resourceId: string,
  versionId: string,
) {
  const actor = { ...reader, ignoreInstanceAdmin: true, isInstanceAdmin: false };
  await assertV7Authorization(db, actor, companyId, "workflows:read");
  const workflows = workflowService(db);
  if (type === "workflow_template") {
    if (!await workflows.getRevision(companyId, resourceId, versionId, actor))
      throw conflict("The Original workflow component source is unavailable");
    return;
  }
  const [source] = await db.select({ routine: routines, revision: routineRevisions })
    .from(routines).innerJoin(routineRevisions, and(
      eq(routineRevisions.companyId, routines.companyId), eq(routineRevisions.routineId, routines.id),
      eq(routineRevisions.id, versionId),
    )).where(and(eq(routines.companyId, companyId), eq(routines.id, resourceId)));
  if (!source) throw conflict("The Original routine component source is unavailable");
  await assertRoutineSourceAccess(db, source.routine, actor);
  const snapshot = routineRevisionSnapshotV1Schema.safeParse(source.revision.snapshot);
  if (!snapshot.success || snapshot.data.routine.id !== resourceId || snapshot.data.routine.companyId !== companyId)
    throw conflict("The Original routine component revision is unavailable");
  const targets = new Set<string>();
  for (const routine of [source.routine, snapshot.data.routine]) {
    if (routine.executionTargetKind !== "workflow") continue;
    if (!routine.executionTargetRef) throw conflict("The Original routine workflow source is unavailable");
    targets.add(routine.executionTargetRef);
  }
  for (const id of targets) {
    const workflow = await workflows.get(companyId, id, actor);
    if (!workflow?.publishedRevisionId || !await workflows.getRevision(companyId, id, workflow.publishedRevisionId, actor))
      throw conflict("The Original routine workflow source is unavailable");
  }
}
