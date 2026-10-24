import { and, eq, sql } from "drizzle-orm";
import { authUsers, companies, companyMemberships, routines, type Db } from "@paperclipai/db";
import type { ExperienceCard } from "@paperclipai/shared";
import { authorizationService, type AuthorizationActor } from "../authorization.js";
import { nativeSha256 } from "../native-runtime/canonical.js";

/** Projection only. A missing responsible member grants no access to a routine
 * or its private authoring sources, and this card cannot transfer ownership. */
export async function readRoutineResponsibilityAttention(db: Db, actor: AuthorizationActor, companyId: string,
  signal: AbortSignal): Promise<{ needsYou: ExperienceCard[] }> {
  const empty = { needsYou: [] as ExperienceCard[] };
  if (actor.type !== "board" || !actor.userId || actor.source === "local_implicit") return empty;
  const currentActor = { ...actor, isInstanceAdmin: false, ignoreInstanceAdmin: true };
  return db.transaction(async tx => {
    await tx.execute(sql`set local statement_timeout='1000ms'`);
    await tx.execute(sql`set local lock_timeout='200ms'`);
    const current = async () => {
      signal.throwIfAborted();
      const [member] = await tx.select({ id: companyMemberships.id }).from(companyMemberships)
        .innerJoin(authUsers, and(eq(authUsers.id, companyMemberships.principalId), eq(authUsers.emailVerified, true)))
        .innerJoin(companies, and(eq(companies.id, companyMemberships.companyId), eq(companies.status, "active")))
        .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, actor.userId!), eq(companyMemberships.status, "active"))).limit(1);
      if (!member) return false;
      const auth = authorizationService(tx as unknown as Db);
      for (const action of ["company_scope:read", "users:manage_permissions"] as const)
        if (!(await auth.decide({ actor: currentActor, action, resource: { type: "company", companyId },
          enforceResponsibleUserIntersection: true })).allowed) return false;
      return true;
    };
    if (!await current()) return empty;
    const [summary] = await tx.select({ count: sql<number>`count(*)::integer`, changedAt: sql<string | null>`max(${routines.updatedAt})::text` })
      .from(routines).where(and(eq(routines.companyId, companyId), sql`${routines.status} in ('active','paused')`, sql`(
        ${routines.responsibleUserId} is null or not exists (
          select 1 from company_memberships m join "user" u on u.id=m.principal_id
          where m.company_id=${routines.companyId} and m.principal_type='user'
            and m.principal_id=${routines.responsibleUserId} and m.status='active'))`));
    if (!summary?.count || !await current()) return empty;
    const source = { domain: "routine" as const, companyId, resourceId: "responsibility",
      version: nativeSha256({ companyId, count: summary.count, changedAt: summary.changedAt }), observedAt: new Date().toISOString() };
    return { needsYou: [{ id: `routine-responsibility:${companyId}`, kind: "recovery", source, freshness: "fresh",
      title: "Review routine responsibility", whyYou: "You manage this company's people and access.",
      consequence: "A retained routine has no active responsible member. Keep affected work paused until an authorized owner resolves responsibility and access.",
      evidence: ["routine_responsibility_review"], actions: [{ id: "review-members", label: "Review company members", labelKey: "review",
        operation: "open", href: "/company/settings/members", criticality: "C3", source, requiresCurrentAuthorization: true }] }] };
  });
}
