import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { authUsers, companies, companyMemberships, runtimeCells, type Db } from "@paperclipai/db";
import { v6FeatureEnabled, v9FeatureEnabled, type ExperienceCard } from "@paperclipai/shared";
import { performance } from "node:perf_hooks";
import { conflict, forbidden, notFound } from "../../errors.js";
import { authorizationService, type AuthorizationActor } from "../authorization.js";
import { instanceSettingsService } from "../instance-settings.js";
import { assertV5Authorization, v5HumanActorId } from "../v5-authorization.js";
import { nativeSha256 } from "../native-runtime/canonical.js";

/** Current fleet findings, not repair authority or a conformance certificate.
 * Only the existing runtime manager can see these navigation-only cards. */
export async function readRuntimeRecovery(db: Db, actor: AuthorizationActor, companyId: string, signal: AbortSignal): Promise<{
  needsYou: ExperienceCard[]; coverage?: { state: "partial"; reason: "more_items_available" };
}> {
  const principal = v5HumanActorId(actor);
  if (actor.source === "local_implicit") throw forbidden("An authenticated runtime manager is required");
  const current = { ...actor, ignoreInstanceAdmin: true, isInstanceAdmin: false }, started = performance.now();
  const budget = () => {
    signal.throwIfAborted();
    if (performance.now() - started > 1500) throw conflict("Runtime source review expired");
  };
  return db.transaction(async rawTx => {
    const tx = rawTx as unknown as Db;
    await tx.execute(sql`set local statement_timeout='1500ms'`);
    await tx.execute(sql`set local lock_timeout='250ms'`);
    async function access() {
      budget();
      const flags = await instanceSettingsService(tx).getExperimental();
      if (!v9FeatureEnabled(flags, "maintenance_autopilot_v9") || !v6FeatureEnabled(flags, "hosted_openclaw_v6"))
        throw notFound("Runtime recovery projection is unavailable");
      await assertV5Authorization(tx, current, companyId, "company_scope:read");
      const [company] = await tx.select({ status: companies.status }).from(companies)
        .where(eq(companies.id, companyId)).for("share");
      const [membership] = await tx.select({ id: companyMemberships.id }).from(companyMemberships).where(and(
        eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, principal), eq(companyMemberships.status, "active"))).for("share");
      const [user] = await tx.select({ verified: authUsers.emailVerified }).from(authUsers).where(eq(authUsers.id, principal)).for("share");
      if (!company || company.status === "archived" || !membership || !user?.verified)
        throw forbidden("Current verified company membership is required");
      // Use the Original runtime admission with the current locked membership,
      // never an instance-admin bypass or a new V9 permission interpretation.
      if (!(await authorizationService(tx).decide({ actor: current, action: "runtime:manage", resource: { type: "company", companyId } })).allowed)
        throw forbidden("Current runtime permission is required");
      budget();
    }
    await access();
    const rows = await tx.select({ id: runtimeCells.id, generation: runtimeCells.generation, status: runtimeCells.status,
      suspended: runtimeCells.suspendedReason, error: runtimeCells.lastErrorCode, updatedAt: runtimeCells.updatedAt })
      .from(runtimeCells).where(and(eq(runtimeCells.companyId, companyId), isNull(runtimeCells.deletedAt),
        or(sql`${runtimeCells.status} in ('FAILED','DEGRADED')`, sql`${runtimeCells.suspendedReason} is not null`,
          sql`${runtimeCells.lastErrorCode} is not null`)))
      .orderBy(desc(runtimeCells.updatedAt), desc(runtimeCells.id)).limit(6).for("share");
    const observedAt = new Date().toISOString();
    const cards: ExperienceCard[] = rows.slice(0, 5).map(row => {
      const source = { domain: "runtime_cell" as const, companyId, resourceId: row.id,
        version: nativeSha256({ ...row, generation: row.generation.toString(), updatedAt: row.updatedAt.toISOString() }), observedAt };
      const capacity = row.suspended !== null;
      return { id: `runtime-recovery:${row.id}`, kind: "recovery", source, freshness: "fresh",
        title: capacity ? "Review runtime capacity" : "Review runtime recovery",
        whyYou: "You manage this company's runtime.",
        consequence: "Recovery stays with the existing runtime controls; this card does not change configuration or restart work.",
        evidence: [capacity ? "runtime_capacity_review" : "runtime_recovery_review"],
        actions: [{ id: "review-runtime", label: "Review runtime", labelKey: "review", operation: "open",
          href: "/company/settings/runtime", criticality: "C4", source, requiresCurrentAuthorization: true }] };
    });
    await access();
    return { needsYou: cards, ...(rows.length > 5 ? { coverage: { state: "partial" as const, reason: "more_items_available" as const } } : {}) };
  });
}
