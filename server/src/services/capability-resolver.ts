import { and, asc, eq } from "drizzle-orm";
import { workflows, type Db } from "@paperclipai/db";
import type { ExecutionManifestCapability } from "@paperclipai/shared";
import { authorizationService, type AuthorizationActor, type AuthorizationAction } from "./authorization.js";
import { assertV5Authorization } from "./v5-authorization.js";
import { workflowCapabilityResolverService } from "./workflows/workflow-capability-resolver.js";
import { toolAccessPolicyService } from "./tool-access-policy.js";

/** Reuses the workflow catalog and actual tool policy. Inventory is never a grant. */
export function capabilityResolverService(db: Db) {
  return {
    search: async (actor: AuthorizationActor, companyId: string, query: string) => {
      await assertV5Authorization(db, actor, companyId, "company_scope:read");
      const auth = authorizationService(db), accessByRef = new Map<string, "allowed" | "requires_approval">();
      const result = await workflowCapabilityResolverService(db).search(companyId, { q: query.slice(0, 200), limit: 50 }, async (candidate) => {
        if (candidate.publishState !== "ready" || candidate.availability.status !== "available") return false;
        for (const permission of candidate.requiredPermissions) {
          const decision = await auth.decide({ actor, action: permission as AuthorizationAction, resource: candidate.source.agentId ? { type: "agent", companyId, agentId: candidate.source.agentId } : { type: "company", companyId }, enforceResponsibleUserIntersection: true });
          if (!decision.allowed) return false;
        }
        if (candidate.kind === "connected_tool") {
          const decision = await toolAccessPolicyService(db).decide({ companyId, actor: { actorType: actor.type === "agent" ? "agent" : "user", actorId: actor.agentId ?? actor.userId ?? "local-board", agentId: actor.agentId, userId: actor.onBehalfOfUserId ?? actor.userId }, runContext: actor.runId ? { heartbeatRunId: actor.runId } : null, request: { catalogEntryId: candidate.source.catalogEntryId, connectionId: candidate.source.connectionId, toolName: candidate.source.toolName ?? candidate.title, arguments: {} }, consumeRateLimit: false, writeAuditEvent: false });
          if (!decision.allowed && decision.decision !== "require_approval") return false;
          accessByRef.set(candidate.id, decision.allowed ? "allowed" : "requires_approval");
        }
        return true;
      });
      const capabilities: ExecutionManifestCapability[] = result.candidates.map((c) => ({ type: c.id.startsWith("artifact:") ? "automation_artifact" : c.kind === "connected_tool" ? "tool" : c.kind === "agent" ? c.nodeType === "agent.external" ? "external_agent" : "agent" : "native_action", ref: c.id, title: c.title.slice(0, 200), risk: c.riskClass, access: accessByRef.get(c.id) ?? (["C2", "C3", "C4"].includes(c.riskClass) ? "requires_approval" : "allowed"), versionHash: typeof c.configTemplate.catalogVersionHash === "string" ? c.configTemplate.catalogVersionHash : typeof c.configTemplate.artifactVersionId === "string" ? c.configTemplate.artifactVersionId : null, deterministic: c.executionMode === "deterministic" }));
      const allowed = await auth.decide({ actor, action: "workflows:run", resource: { type: "company", companyId }, enforceResponsibleUserIntersection: true });
      if (allowed.allowed) {
        const rows = await db.select().from(workflows).where(and(eq(workflows.companyId, companyId), eq(workflows.status, "active"))).orderBy(asc(workflows.name)).limit(100);
        for (const row of rows) if (row.publishedRevisionId && (!query || `${row.name} ${row.description ?? ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))) capabilities.push({ type: "workflow", ref: row.id, title: row.name.slice(0, 200), risk: "C3", access: "requires_approval", versionHash: row.publishedRevisionId, deterministic: true });
      }
      // Prefer deterministic, lower-risk implementations after filtering.
      capabilities.sort((a, b) => Number(!a.deterministic) - Number(!b.deterministic) || a.risk.localeCompare(b.risk) || a.ref.localeCompare(b.ref));
      return capabilities.slice(0, 128);
    },
  };
}
