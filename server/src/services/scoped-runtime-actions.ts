import { and, eq, isNull } from "drizzle-orm";
import { heartbeatRuns, issues, playbookDocuments, type Db } from "@paperclipai/db";
import { scopedRuntimeActionSchema } from "@paperclipai/shared";
import type { z } from "zod";
import { forbidden, notFound } from "../errors.js";
import type { AuthorizationActor } from "./authorization.js";
import { agentRuntimeFabricService } from "./agent-runtime-fabric.js";
import { agentProviderBindingService } from "./agent-provider-bindings.js";
import { crossCompanyContextService } from "./cross-company-context.js";
import { playbookService } from "./playbooks.js";
import { logActivity } from "./activity-log.js";
import { budgetService } from "./budgets.js";
import { projectControlService } from "./project-control.js";

export { scopedRuntimeActionSchema };

export function scopedRuntimeActionService(db: Db) {
  return {
    execute: async (actor: AuthorizationActor, companyId: string, runId: string, raw: z.infer<typeof scopedRuntimeActionSchema>) => {
      if (actor.type !== "agent" || actor.companyId !== companyId || actor.runId !== runId) throw forbidden("Scoped actions require this authenticated primary execution");
      const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.agentId, actor.agentId!), eq(heartbeatRuns.id, runId), eq(heartbeatRuns.status, "running"))).limit(1);
      if (!run || actor.onBehalfOfUserId !== run.responsibleUserId) throw forbidden("Current primary execution authority is unavailable");
      const input = scopedRuntimeActionSchema.parse(raw), record = await agentRuntimeFabricService(db).getManifest(actor, companyId, runId), scope = record.manifest.executionScope;
      await agentProviderBindingService(db).assertRuntime(companyId, run.agentId);
      const cross = crossCompanyContextService(db), resolved = await cross.resolve(actor, scope), local = resolved.scopes.find((s) => s.companyId === input.companyId);
      if (!local) throw forbidden("Target company is outside this pinned execution scope");
      const budgets = budgetService(db);
      if (await budgets.getInvocationBlock(companyId, run.agentId) || await budgets.getInvocationBlock(input.companyId, local.presence.id)) throw forbidden("Current company or agent budget blocks this scoped action");
      let result: unknown, classification = "internal";
      if (input.action === "task.read") {
        const [task] = await db.select().from(issues).where(and(eq(issues.companyId, input.companyId), eq(issues.id, input.taskId), isNull(issues.hiddenAt), isNull(issues.harnessKind))).limit(1);
        if (!task) throw notFound("Scoped task not found");
        if (input.companyId !== companyId && !local.policy.allowedSensitivities.includes("internal")) throw forbidden("Source-company classification policy excludes this task");
        await cross.assertAction(actor, scope, input.companyId, "issue:read", { type: "issue", companyId: input.companyId, issueId: task.id, projectId: task.projectId, parentIssueId: task.parentId, status: task.status, assigneeAgentId: task.assigneeAgentId, assigneeUserId: task.assigneeUserId });
        result = { sourceCompanyId: input.companyId, classification: "internal", crossCompanyUsePolicy: "allow", task: { id: task.id, identifier: task.identifier, title: task.title, description: task.description, status: task.status, projectId: task.projectId, updatedAt: task.updatedAt }, citation: `company:${input.companyId}/task:${task.id}` };
      } else if (input.action === "task.forecast" || input.action === "task.propose_plan") {
        if (input.companyId !== companyId && !local.policy.allowedSensitivities.includes("internal")) throw forbidden("Source-company classification policy excludes project tasks");
        const localActor = { ...local.localActor, runId: input.companyId === companyId ? runId : null };
        const controls = projectControlService(db);
        const taskIds = input.action === "task.forecast" ? [input.taskId] : input.proposal.changes.map((change) => change.issueId);
        for (const id of taskIds) {
          const [task] = await db.select().from(issues).where(and(eq(issues.companyId, input.companyId), eq(issues.projectId, input.projectId), eq(issues.id, id), isNull(issues.hiddenAt), isNull(issues.harnessKind))).limit(1);
          if (!task) throw notFound("Scoped project task not found");
          await cross.assertAction(actor, scope, input.companyId, "issue:mutate", { type: "issue", companyId: input.companyId, issueId: task.id, projectId: task.projectId, parentIssueId: task.parentId, status: task.status, assigneeAgentId: task.assigneeAgentId, assigneeUserId: task.assigneeUserId });
        }
        // Reuse local forecast/commitment ownership and review gates. An act
        // scope itself never permits bypassing human schedule review.
        result = input.action === "task.forecast"
          ? await controls.forecast(localActor, input.companyId, input.projectId, input.taskId, input.forecast)
          : await controls.propose(localActor, input.companyId, input.projectId, input.proposal);
      } else {
        const [playbook] = await db.select().from(playbookDocuments).where(and(eq(playbookDocuments.companyId, input.companyId), eq(playbookDocuments.id, input.playbookId))).limit(1);
        if (!playbook || input.companyId !== companyId && !["public", "internal"].includes(playbook.sensitivity)) throw notFound("Scoped Playbook not found");
        classification = playbook.sensitivity;
        if (input.companyId !== companyId && !local.policy.allowedSensitivities.includes(playbook.sensitivity as "public" | "internal")) throw forbidden("Source-company classification policy excludes this Playbook");
        const localActor = await cross.assertAction(actor, scope, input.companyId, "foundation:propose", { type: "company", companyId: input.companyId });
        // A guest proposal belongs to its own company. The primary execution
        // provenance is recorded separately instead of fabricating a guest run.
        result = await playbookService(db).propose({ ...localActor, runId: input.companyId === companyId ? runId : null }, input.companyId, input.playbookId, input.proposal);
      }
      await cross.resolve(actor, scope);
      await logActivity(db, { companyId, actorType: "agent", actorId: run.agentId, agentId: run.agentId, runId, action: "runtime.scoped_action", entityType: "execution_manifest", entityId: record.id, details: { targetCompanyId: input.companyId, action: input.action, sourceCompanyId: input.companyId } });
      return input.action === "task.read" ? result : { sourceCompanyId: input.companyId, resultOwnerCompanyId: companyId, classification, crossCompanyUsePolicy: ["confidential", "restricted"].includes(classification) ? "no_export" : "allow", result };
    },
  };
}
