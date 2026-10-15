import { and, eq } from "drizzle-orm";
import { heartbeatRuns, type Db } from "@paperclipai/db";
import { workflowAuthoringApiCommandSchema } from "@paperclipai/shared";
import { forbidden } from "../../errors.js";
import type { AuthorizationActor } from "../authorization.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { withV7ActivityTransaction, logActivity } from "../v7-mutations.js";
import { workflowAuthoringToolsService } from "./workflow-authoring-tools.js";
import { assertWorkflowAuthoringAuthority } from "./workflow-authoring-authority.js";
import { withOrchestrationNativeTool } from "../orchestration/native-tool-boundary.js";

/** Native call_api retains its run JWT and intersects the Original authoring
 * policy with the run's actual responsible user. No board authority is lent. */
export async function applyWorkflowAuthoringApi(db: Db, actor: AuthorizationActor, companyId: string, raw: unknown) {
  if (actor.type !== "agent" || actor.source !== "agent_jwt" || actor.keyId || actor.keyScope ||
    actor.companyId !== companyId || !actor.agentId || !actor.runId)
    throw forbidden("Workflow authoring requires the current Native run identity");
  const input = workflowAuthoringApiCommandSchema.parse(raw);
  return withV7ActivityTransaction(db, async (tx, publications) => {
    await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
    const [run] = await tx.select({ id: heartbeatRuns.id, issueId: heartbeatRuns.nativeIssueId, userId: heartbeatRuns.responsibleUserId }).from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.agentId, actor.agentId!),
        eq(heartbeatRuns.id, actor.runId!), eq(heartbeatRuns.runtimeMode, "native"), eq(heartbeatRuns.status, "running"))).for("share");
    if (!run?.issueId || actor.onBehalfOfUserId && actor.onBehalfOfUserId !== run.userId)
      throw forbidden("The current Native authoring run changed");
    const context = { companyId, agentId: actor.agentId!, runId: run.id };
    // Generic API actions have no bounded-plan qualification. Reuse its
    // Original refusal even if a run calls this HTTP route directly.
    return withOrchestrationNativeTool(tx, { ...context, issueId: run.issueId },
      { tool: "call_api", callId: "workflow-authoring", arguments: input }, async () => {
        const sdk = workflowAuthoringToolsService(tx);
        const result = await (async () => {
          switch (input.operation) {
            case "create_workflow": return sdk.create(context, input.input);
            case "add_trigger": return sdk.addTrigger(context, input.input);
            case "add_step": return sdk.addStep(context, input.input);
            case "update_step": return sdk.updateStep(context, input.input);
            case "connect_steps": return sdk.connectSteps(context, input.input);
            case "remove_step": return sdk.removeStep(context, input.input);
            case "test_step": return sdk.testStep(context, input.input);
            case "prepare_publish": return sdk.preparePublish(context, input.input);
          }
        })();
        if ("workflow" in result && result.status !== "replayed") {
          await logActivity(tx, { companyId, actorType: "agent", actorId: actor.agentId!, agentId: actor.agentId!, runId: run.id,
            action: result.status === "created" ? "workflow.created" : "workflow.draft_updated",
            entityType: "workflow", entityId: result.workflow.id,
            details: { operation: input.operation, draftRevisionId: result.workflow.draftRevisionId } }, publications);
        }
        await assertWorkflowAuthoringAuthority(tx, context, input.operation === "prepare_publish" ? "workflows:publish" : "workflows:edit");
        return result;
    });
  });
}
