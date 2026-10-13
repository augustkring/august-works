import { and, desc, eq, sql } from "drizzle-orm";
import { authUsers, companies, companyMemberships, toolApplications, toolConnections, type Db } from "@paperclipai/db";
import { isToolConnectionAttentionHealth, v9FeatureEnabled, type ExperienceCard } from "@paperclipai/shared";
import { performance } from "node:perf_hooks";
import { conflict, forbidden, notFound } from "../../errors.js";
import type { AuthorizationActor } from "../authorization.js";
import { accessService } from "../access.js";
import { toolAccessService } from "../tool-access.js";
import { instanceSettingsService } from "../instance-settings.js";
import { assertV5Authorization, v5HumanActorId } from "../v5-authorization.js";
import { nativeSha256 } from "../native-runtime/canonical.js";

/** Current Original app health and grant enrichment; no OAuth/probe/write. */
export async function readConnectorRecovery(db: Db, actor: AuthorizationActor, companyId: string, signal: AbortSignal): Promise<{
  needsYou: ExperienceCard[]; coverage?: { state: "partial"; reason: "more_items_available" };
}> {
  const principal = v5HumanActorId(actor);
  if (actor.source === "local_implicit") throw forbidden("An authenticated connection manager is required");
  const current = { ...actor, ignoreInstanceAdmin: true, isInstanceAdmin: false }, started = performance.now();
  const budget = () => { signal.throwIfAborted(); if (performance.now() - started > 1500) throw conflict("Connection recovery review expired"); };
  return db.transaction(async rawTx => {
    const tx = rawTx as unknown as Db;
    await tx.execute(sql`set local statement_timeout='1500ms'`);
    await tx.execute(sql`set local lock_timeout='250ms'`);
    async function access() {
      budget();
      const flags = await instanceSettingsService(tx).getExperimental();
      if (!v9FeatureEnabled(flags, "maintenance_autopilot_v9")) throw notFound("Connection recovery projection is unavailable");
      await assertV5Authorization(tx, current, companyId, "company_scope:read");
      const [company] = await tx.select({ status: companies.status }).from(companies).where(eq(companies.id, companyId)).for("share");
      const [membership] = await tx.select({ role: companyMemberships.membershipRole }).from(companyMemberships).where(and(
        eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, principal), eq(companyMemberships.status, "active"))).for("share");
      const [user] = await tx.select({ verified: authUsers.emailVerified }).from(authUsers).where(eq(authUsers.id, principal)).for("share");
      if (!company || company.status === "archived" || !membership || !user?.verified || membership.role === "viewer")
        throw forbidden("Current verified connection-manager membership is required");
      // Match the Original connection-manager policy: owner/admin, or the
      // explicit native permission for an eligible non-viewer member.
      if (membership.role !== "owner" && membership.role !== "admin" &&
        !await accessService(tx).hasPermission(companyId, "user", principal, "tools:manage_connections"))
        throw forbidden("Current connection-manager permission is required");
      budget();
    }
    await access();
    const rows = await tx.select({ id: toolConnections.id, status: toolConnections.status, enabled: toolConnections.enabled,
      health: toolConnections.healthStatus, lastError: toolConnections.lastError, updatedAt: toolConnections.updatedAt,
      applicationId: toolConnections.applicationId, config: toolConnections.config, credentialPolicy: toolConnections.credentialPolicy,
      applicationUpdatedAt: toolApplications.updatedAt })
      .from(toolConnections).innerJoin(toolApplications, and(eq(toolApplications.companyId, toolConnections.companyId),
        eq(toolApplications.id, toolConnections.applicationId)))
      .where(and(eq(toolConnections.companyId, companyId), eq(toolConnections.status, "active"), eq(toolConnections.enabled, true),
        eq(toolApplications.status, "active"), sql`(
          ${toolConnections.healthStatus} in ('degraded','failed','error','missing_secret')
          or (${toolConnections.connectionPurpose}='ai' and exists(select 1 from connection_grants g where g.company_id=${companyId}::uuid and g.connection_id=${toolConnections.id})
            and not exists(select 1 from connection_grants g where g.company_id=${companyId}::uuid and g.connection_id=${toolConnections.id} and g.status<>'revoked'))
          or (${toolConnections.config}->>'sourceTemplateKey'='github' and not exists(select 1 from connection_grants g
            where g.company_id=${companyId}::uuid and g.connection_id=${toolConnections.id} and g.status='active'
            and (${toolConnections.credentialPolicy}<>'per_user' or (g.kind='user' and g.subject_user_id=${principal}))))
        )`)).orderBy(desc(toolConnections.updatedAt), desc(toolConnections.id)).limit(6).for("share");
    const cards: ExperienceCard[] = [];
    for (const row of rows) {
      budget();
      const connection = await toolAccessService(tx).getConnection(row.id, companyId, principal);
      budget();
      if (!connection.requiresReauthorization && !isToolConnectionAttentionHealth(connection.healthStatus)) continue;
      const source = { domain: "connection" as const, companyId, resourceId: row.id,
        version: nativeSha256({ ...row, updatedAt: row.updatedAt.toISOString(), applicationUpdatedAt: row.applicationUpdatedAt.toISOString(),
          effectiveHealth: connection.healthStatus, reauthorization: Boolean(connection.requiresReauthorization) }), observedAt: new Date().toISOString() };
      cards.push({ id: `connector-recovery:${row.id}`, kind: "recovery", source, freshness: "fresh",
        title: "Review app connection", whyYou: "You manage this company's app connections.",
        consequence: "Review current access in the existing app controls before reconnecting or changing permissions.",
        evidence: [connection.requiresReauthorization || connection.healthStatus === "missing_secret" ? "connector_access_review" : "connector_recovery_review"],
        actions: [{ id: "review-connection", label: "Review app connection", labelKey: "review", operation: "open",
          href: `/apps/${row.id}/permissions`, criticality: "C4", source, requiresCurrentAuthorization: true }] });
    }
    await access();
    return { needsYou: cards.slice(0, 5), ...(rows.length > 5 ? { coverage: { state: "partial" as const, reason: "more_items_available" as const } } : {}) };
  });
}
