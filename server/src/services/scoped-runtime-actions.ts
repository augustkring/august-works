import { and, eq, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { heartbeatRuns, issues, projects, playbookDocuments, toolCatalogEntries, type Db } from "@paperclipai/db";
import { scopedRuntimeActionSchema } from "@paperclipai/shared";
import type { z } from "zod";
import { conflict, forbidden, HttpError, notFound, unprocessable } from "../errors.js";
import type { AuthorizationActor } from "./authorization.js";
import { agentRuntimeFabricService } from "./agent-runtime-fabric.js";
import { agentProviderBindingService } from "./agent-provider-bindings.js";
import { crossCompanyContextService } from "./cross-company-context.js";
import { playbookService } from "./playbooks.js";
import { logActivity } from "./activity-log.js";
import { budgetService } from "./budgets.js";
import { projectControlService } from "./project-control.js";
import { assertV5Authorization } from "./v5-authorization.js";
import { ToolGatewayHttpError, type ToolGatewayService, type ScopedToolGatewayContext } from "./tool-gateway.js";
import { hasOrchestrationPlan } from "./orchestration/orchestration-admission.js";

export { scopedRuntimeActionSchema };

export function scopedRuntimeActionService(db: Db, toolGateway?: ToolGatewayService) {
  return {
    execute: async (actor: AuthorizationActor, companyId: string, runId: string, raw: z.infer<typeof scopedRuntimeActionSchema>) => {
      if (actor.type !== "agent" || actor.companyId !== companyId || actor.runId !== runId) throw forbidden("Scoped actions require this authenticated primary execution");
      const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.agentId, actor.agentId!), eq(heartbeatRuns.id, runId), eq(heartbeatRuns.status, "running"))).limit(1);
      if (!run || actor.onBehalfOfUserId !== run.responsibleUserId) throw forbidden("Current primary execution authority is unavailable");
      const input = scopedRuntimeActionSchema.parse(raw), record = await agentRuntimeFabricService(db).getManifest(actor, companyId, runId), scope = record.manifest.executionScope;
      await agentProviderBindingService(db).assertRuntime(companyId, run.agentId);
      const cross = crossCompanyContextService(db), resolved = await cross.resolve(actor, scope), local = resolved.scopes.find((s) => s.companyId === input.companyId);
      if (!local) throw forbidden("Target company is outside this pinned execution scope");
      const runContext = run.contextSnapshot && typeof run.contextSnapshot === "object" ? run.contextSnapshot : null;
      const executionIssueId = run.issueId ?? (typeof runContext?.issueId === "string" ? runContext.issueId : null);
      let gatewayIssueId: string | null = null, gatewayProjectId: string | null = null;
      if (input.companyId === companyId) {
        const issueReferences = [run.nativeIssueId, run.issueId,
          typeof runContext?.issueId === "string" ? runContext.issueId : null]
          .filter((value): value is string => typeof value === "string" && value.length > 0);
        const issueId = new Set(issueReferences).size === 1 ? issueReferences[0] : null;
        if (issueId) {
          const [task] = await db.select({ id: issues.id, projectId: issues.projectId,
            responsibleUserId: issues.responsibleUserId, executionRunId: issues.executionRunId,
            checkoutRunId: issues.checkoutRunId }).from(issues).where(and(
              eq(issues.companyId, companyId), eq(issues.id, issueId), isNull(issues.hiddenAt), isNull(issues.harnessKind),
            )).limit(1);
          const runBound = task && (run.nativeIssueId === task.id || task.executionRunId === run.id || task.checkoutRunId === run.id);
          if (runBound && task.responsibleUserId === run.responsibleUserId) {
            gatewayIssueId = task.id;
            if (task.projectId) {
              const [project] = await db.select({ id: projects.id }).from(projects).where(and(
                eq(projects.companyId, companyId), eq(projects.id, task.projectId),
              )).limit(1);
              gatewayProjectId = project?.id ?? null;
            }
          }
        } else if (issueReferences.length === 0 && typeof runContext?.projectId === "string") {
          const [project] = await db.select({ id: projects.id }).from(projects).where(and(
            eq(projects.companyId, companyId), eq(projects.id, runContext.projectId),
          )).limit(1);
          gatewayProjectId = project?.id ?? null;
        }
      }
      const assertBoundedGuestAct = async (accessMode: "read" | "contribute" | "act") => {
        if (input.companyId !== companyId && accessMode === "act" && await hasOrchestrationPlan(db, companyId, executionIssueId))
          throw forbidden("Bounded plans cannot dispatch delegated act scope until delegated side-effect and budget receipts are qualified");
      };
      await assertBoundedGuestAct(local.accessMode);
      const budgets = budgetService(db);
      if (await budgets.getInvocationBlock(companyId, run.agentId) || await budgets.getInvocationBlock(input.companyId, local.presence.id)) throw forbidden("Current company or agent budget blocks this scoped action");
      let result: unknown, classification = "internal";
      if (input.action === "tool.list" || input.action === "tool.invoke") {
        if (!toolGateway) throw conflict("Scoped connected tools require the configured gateway");
        // Connection output has no general sensitivity contract. Treat it as
        // confidential rather than relabeling an arbitrary upstream response.
        classification = "confidential";
        const discoveryCatalogEntryIds = input.action === "tool.list"
          ? record.manifest.capabilities.filter((capability) => capability.type === "tool" &&
            /^tool:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(capability.ref))
            .map((capability) => capability.ref.slice("tool:".length))
          : undefined;
        const context: ScopedToolGatewayContext = {
          ...(discoveryCatalogEntryIds ? { discoveryCatalogEntryIds } : {}),
          session: { id: randomUUID(), token: "", companyId: input.companyId, agentId: local.presence.id,
            runId: input.companyId === companyId ? runId : null,
            issueId: input.companyId === companyId ? gatewayIssueId : null,
            projectId: input.companyId === companyId ? gatewayProjectId : null,
            actorType: "agent", actorId: local.presence.id, responsibleUserId: run.responsibleUserId,
            createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000) },
          assertCurrent: async (tool) => {
            if (context.session.expiresAt.getTime() <= Date.now()) throw forbidden("Scoped tool request expired");
            const [current] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.id, runId), eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.agentId, run.agentId), eq(heartbeatRuns.status, "running"))).limit(1);
            if (!current || current.responsibleUserId !== actor.onBehalfOfUserId) throw forbidden("Primary execution authority changed");
            const fresh = (await cross.resolve(actor, scope)).scopes.find(entry => entry.companyId === input.companyId);
            if (!fresh) throw forbidden("Target company left this execution scope");
            await assertBoundedGuestAct(fresh.accessMode);
            if (input.companyId !== companyId && !fresh.policy.allowedSensitivities.includes("confidential")) throw forbidden("Guest policy excludes confidential connection output");
            if (tool && tool.risk !== "read") {
              if (input.companyId !== companyId && fresh.accessMode !== "act") throw forbidden("Guest tool mutations require act scope");
              if (input.action === "tool.invoke" && !input.idempotencyKey) throw unprocessable("Tool mutations require an idempotency key");
            }
            await assertV5Authorization(db, fresh.localActor, input.companyId, "tools:use");
            if (await budgets.getInvocationBlock(companyId, run.agentId) || await budgets.getInvocationBlock(input.companyId, fresh.presence.id)) throw forbidden("Current budget blocks this scoped tool");
          },
          assertManifestCurrent: async (tool) => {
            if (!["mcp_remote_http", "mcp_local_stdio"].includes(tool.providerType)) return;
            if (!tool.catalogEntryId || !tool.connectionId)
              throw forbidden("Connected tool has no pinned catalog identity", { code: "tool_catalog_identity_missing" });
            const pinned = record.manifest.capabilities.find(capability => capability.type === "tool" && capability.ref === `tool:${tool.catalogEntryId}`);
            if (!pinned) throw forbidden("Connected tool is outside the pinned execution manifest", { code: "tool_outside_execution_manifest" });
            const [currentCatalog] = await db.select({ versionHash: toolCatalogEntries.versionHash })
              .from(toolCatalogEntries).where(and(eq(toolCatalogEntries.companyId, input.companyId),
                eq(toolCatalogEntries.id, tool.catalogEntryId), eq(toolCatalogEntries.entryKind, "tool"),
                eq(toolCatalogEntries.status, "active"))).limit(1);
            if (!currentCatalog || currentCatalog.versionHash !== pinned.versionHash)
              throw conflict("Pinned tool catalog changed; reconcile and start a newly admitted execution", { code: "tool_catalog_manifest_drift" });
          },
        };
        try {
          result = input.action === "tool.list"
            ? await toolGateway.listScopedTools(context)
            : await toolGateway.executeTool({ sessionToken: "", tool: input.tool, parameters: input.parameters, idempotencyKey: input.idempotencyKey ? `scope:${runId}:${input.idempotencyKey}` : undefined, timeoutMs: 30_000 }, undefined, context);
        } catch (error) {
          if (error instanceof ToolGatewayHttpError) throw new HttpError(error.status, error.message, { code: error.reasonCode });
          throw error;
        }
      } else if (input.action === "task.read") {
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
      return input.action === "task.read" ? result : { sourceCompanyId: input.companyId, resultOwnerCompanyId: companyId, classification, // Guest tool replies require the source company's explicit confidential
      // sharing policy above. Preserve their classification; no persona grants it.
      crossCompanyUsePolicy: input.companyId !== companyId && (input.action === "tool.list" || input.action === "tool.invoke") ? "allow" : ["confidential", "restricted"].includes(classification) ? "no_export" : "allow", result };
    },
  };
}
