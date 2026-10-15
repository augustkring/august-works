import { isDeepStrictEqual } from "node:util";
import { and, eq, sql } from "drizzle-orm";
import { agents, toolConnections, toolCatalogEntries, principalPermissionGrants, companyMemberships, type Db } from "@paperclipai/db";
import type { WorkflowCapabilityCandidate, WorkflowCapabilitySearchQuery } from "@paperclipai/shared";
import { z } from "zod";
import { HttpError } from "../../errors.js";
import { accessService } from "../access.js";
import { authorizationService, type AuthorizationActor } from "../authorization.js";
import { automationArtifactService } from "../automation-artifacts/automation-artifact-service.js";
import { filterVisibleToolConnections } from "../tool-connection-visibility.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { assertV5Authorization } from "../v5-authorization.js";
import { workflowCapabilityResolverService } from "./workflow-capability-resolver.js";
import { withExperienceAdmission } from "../experience/admission.js";
import { ExperienceOverloadError } from "../experience/projection.js";

/** One Native privacy transaction covers collection, resource filtering and
 * final admission. Retained Source owners remain responsible for their data. */
export function readWorkflowCapabilityCatalog(db: Db, companyId: string, rawActor: AuthorizationActor, query: WorkflowCapabilitySearchQuery) {
  return withExperienceAdmission(async (signal, remainingMs) => db.transaction(async raw => {
    const tx = raw as unknown as Db, actor = { ...rawActor, isInstanceAdmin: false, ignoreInstanceAdmin: true };
    await tx.execute(sql`select set_config('statement_timeout',${`${remainingMs()}ms`},true),set_config('lock_timeout','250ms',true)`);
    await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
    const principalId = actor.type === "board" ? actor.userId : actor.agentId;
    if (principalId && actor.source !== "local_implicit") {
      const principalType = actor.type === "board" ? "user" : "agent";
      await tx.select({ id: companyMemberships.id }).from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId),
        eq(companyMemberships.principalType, principalType), eq(companyMemberships.principalId, principalId))).for("share");
      await tx.select({ id: principalPermissionGrants.id }).from(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, companyId),
        eq(principalPermissionGrants.principalType, principalType), eq(principalPermissionGrants.principalId, principalId))).for("share");
    }
    const admit = async () => {
      await assertV5Authorization(tx, actor, companyId, "company_scope:read");
      await assertV5Authorization(tx, actor, companyId, "workflows:read");
    };
    await admit();
    const originalVisible = workflowCapabilityVisibility(tx, companyId, actor);
    const visible = async (candidate: WorkflowCapabilityCandidate) => {
      signal.throwIfAborted(); const value = await originalVisible(candidate); signal.throwIfAborted(); return value;
    };
    const result = await workflowCapabilityResolverService(tx).search(companyId, query, visible), candidates = [];
    for (const candidate of result.candidates) if (await visible(candidate)) candidates.push(candidate);
    await admit();
    signal.throwIfAborted();
    return { ...result, candidates };
  })).catch(error => {
    let cause: unknown = error;
    for (let depth = 0; depth < 4 && cause && typeof cause === "object"; depth++) {
      const failure = cause as { code?: unknown; cause?: unknown };
      if (failure.code === "55P03" || failure.code === "57014") throw new HttpError(503, "The current capability catalog is unavailable; try again");
      cause = failure.cause;
    }
    if (error instanceof ExperienceOverloadError) throw new HttpError(503, "The current capability catalog is unavailable; try again");
    throw error;
  });
}

/** Native resource/Source reads before catalog ranking or disclosure. A
 * workflow read, inventory entry or model suggestion never grants this access. */
export function workflowCapabilityVisibility(db: Db, companyId: string, actor: AuthorizationActor) {
  const auth = authorizationService(db);
  return async (candidate: WorkflowCapabilityCandidate): Promise<boolean> => {
    try {
      if (candidate.kind === "agent") {
        const id = z.uuid().safeParse(candidate.source.agentId);
        if (!id.success || !(await auth.decide({ actor, action: "agent:read",
          resource: { type: "agent", companyId, agentId: id.data }, enforceResponsibleUserIntersection: true })).allowed) return false;
        const [row] = await db.select({ name: agents.name, title: agents.title, role: agents.role, capabilities: agents.capabilities,
          adapter: agents.adapterType, status: agents.status }).from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, id.data))).for("share");
        return !!row && row.status !== "terminated" && (row.title?.trim() || row.name) === candidate.title &&
          ([row.role, row.capabilities?.trim()].filter(Boolean).join(" · ") || null) === candidate.description &&
          row.adapter === candidate.source.adapterType && row.status === candidate.operationalProfile.reliabilitySignal;
      }
      if (candidate.kind === "connected_tool") {
        const connection = z.uuid().safeParse(candidate.source.connectionId), entry = z.uuid().safeParse(candidate.source.catalogEntryId);
        if (!connection.success || !entry.success) return false;
        const [row] = await db.select({ status: toolConnections.status, createdByUserId: toolConnections.createdByUserId, name: toolConnections.name,
          entryVersion: toolCatalogEntries.versionHash, entrySchema: toolCatalogEntries.schemaHash, entryName: toolCatalogEntries.name,
          entryTitle: toolCatalogEntries.title, toolName: toolCatalogEntries.toolName })
          .from(toolConnections).innerJoin(toolCatalogEntries, and(eq(toolCatalogEntries.companyId, companyId),
            eq(toolCatalogEntries.connectionId, toolConnections.id), eq(toolCatalogEntries.id, entry.data)))
          .where(and(eq(toolConnections.companyId, companyId), eq(toolConnections.id, connection.data), eq(toolCatalogEntries.status, "active"))).for("share");
        // A claimed administrator or represented user cannot borrow creator
        // visibility. Agents also retain their Original tool API admission.
        const userId = actor.type === "board" && actor.source !== "local_implicit" ? actor.userId : null;
        const canManageConnections = !!userId && await accessService(db).hasPermission(companyId, "user", userId, "tools:manage_connections");
        if (!row || row.status === "archived" || !filterVisibleToolConnections([row], { userId, canManageConnections }).length ||
          row.entryVersion !== candidate.configTemplate.catalogVersionHash || row.entrySchema !== candidate.configTemplate.catalogSchemaHash ||
          row.name !== candidate.source.connectionName || (row.entryTitle?.trim() || row.entryName || row.toolName) !== candidate.title) return false;
        return actor.type !== "agent" || (await auth.decide({ actor, action: "tools:use", resource: { type: "company", companyId },
          enforceResponsibleUserIntersection: true })).allowed;
      }
      if (candidate.nodeType === "automation.artifact") {
        const id = z.uuid().safeParse(candidate.configTemplate.artifactId), version = z.uuid().safeParse(candidate.configTemplate.artifactVersionId);
        if (!id.success || !version.success) return false;
        const principal = actor.type === "board" && actor.source === "local_implicit" ? { type: "system" as const, service: "local-board" }
          : actor.type === "board" && actor.userId ? { type: "user" as const, userId: actor.userId }
            : actor.type === "agent" && actor.agentId ? { type: "agent" as const, agentId: actor.agentId, responsibleUserId: actor.onBehalfOfUserId ?? null } : null;
        if (!principal) return false;
        const current = await automationArtifactService(db).getDetail(companyId, id.data, { principal, sourceActor: actor, runId: actor.runId });
        return !!current && current.artifact.status === "active" && current.latestVersion?.id === version.data &&
          current.artifact.name === candidate.title && current.artifact.description === candidate.description &&
          isDeepStrictEqual(current.latestVersion.inputSchema, candidate.inputSchema) && isDeepStrictEqual(current.latestVersion.outputSchema, candidate.outputSchema);
      }
      return candidate.kind === "core_node" && candidate.id === `core:${candidate.nodeType}`;
    } catch (error) {
      if (error instanceof HttpError && [403, 404].includes(error.status)) return false;
      throw error;
    }
  };
}
