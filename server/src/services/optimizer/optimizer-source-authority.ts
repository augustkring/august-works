import { and, eq } from "drizzle-orm";
import { workflowRuns, type Db } from "@paperclipai/db";
import type { AuthorizationActor } from "../authorization.js";
import { notFound } from "../../errors.js";
import { assertLearningAssetCurrent } from "../learning/learning-assets.js";
import { assertLearnedWorkflowPayloadAccess } from "../analytical-context-authority.js";

/** Workflow-run identity is distinct from a heartbeat/Agent run. The Original
 * revision and complete copied-payload owners remain final, including when a
 * private child run was deleted. No stored initiating principal grants a read. */
export async function assertOptimizerRunSources(db: Db, companyId: string, runId: string, actor?: AuthorizationActor) {
  const [run] = await db.select({ revisionId: workflowRuns.workflowRevisionId }).from(workflowRuns)
    .where(and(eq(workflowRuns.companyId, companyId), eq(workflowRuns.id, runId))).for("share");
  if (!run) throw notFound("Workflow run not found");
  await assertLearningAssetCurrent(db, companyId, "workflow_revision", run.revisionId, actor);
  await assertLearnedWorkflowPayloadAccess(db, companyId, actor, { workflowRunId: runId });
}
