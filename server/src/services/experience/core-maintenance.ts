import { and, eq, sql } from "drizzle-orm";
import { authUsers, companies, companyMemberships, type Db } from "@paperclipai/db";
import { v7FeatureEnabled, v9FeatureEnabled, type ExperienceCard } from "@paperclipai/shared";
import { performance } from "node:perf_hooks";
import { conflict, forbidden, notFound } from "../../errors.js";
import type { AuthorizationActor } from "../authorization.js";
import { instanceSettingsService } from "../instance-settings.js";
import { assertV7Authorization, v7HumanActorId } from "../v7-authorization.js";
import { readinessService } from "../readiness/readiness-service.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { readOwnProcedureRevalidation } from "./procedure-revalidation.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { readOwnPackageRevalidation } from "./package-revalidation.js";

/** M0 current own findings and assigned procedure review. No assessment or repair. */
export async function readCoreMaintenance(db: Db, actor: AuthorizationActor, companyId: string, signal: AbortSignal): Promise<{
  needsYou: ExperienceCard[]; coverage?: { state: "partial"; reason: "more_items_available" | "source_stale" };
}> {
  const principal = v7HumanActorId(actor);
  if (actor.source === "local_implicit") throw forbidden("An authenticated current principal is required");
  const current = { ...actor, ignoreInstanceAdmin: true, isInstanceAdmin: false }, started = performance.now();
  const budget = () => { signal.throwIfAborted(); if (performance.now() - started > 1500) throw conflict("Current findings review expired"); };
  return db.transaction(async rawTx => {
    const tx = rawTx as unknown as Db;
    await tx.execute(sql`set local statement_timeout='1500ms'`);
    await tx.execute(sql`set local lock_timeout='250ms'`);
    await lockMemoryPrivacy(tx, companyId);
    async function access() {
      budget();
      const flags = await instanceSettingsService(tx).getExperimental();
      if (!v9FeatureEnabled(flags, "maintenance_autopilot_v9") || !v7FeatureEnabled(flags, "core_stewards_v7") ||
        !v7FeatureEnabled(flags, "readiness_engine_v7")) throw notFound("Current findings projection is unavailable");
      await assertV7Authorization(tx, current, companyId, "company_scope:read");
      const [company] = await tx.select({ status: companies.status }).from(companies).where(eq(companies.id, companyId)).for("share");
      const [membership] = await tx.select({ id: companyMemberships.id }).from(companyMemberships).where(and(
        eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, principal), eq(companyMemberships.status, "active"))).for("share");
      const [user] = await tx.select({ verified: authUsers.emailVerified }).from(authUsers).where(eq(authUsers.id, principal)).for("share");
      if (!company || company.status === "archived" || !membership || !user?.verified)
        throw forbidden("Current verified company membership is required");
      budget();
    }
    await access();
    const findings = await readinessService(tx).maintenanceFindings(companyId, `user:${principal}`);
    budget();
    const source = { domain: "readiness" as const, companyId, resourceId: "own-findings",
      version: nativeSha256({ principal, findings: findings.map(row => ({ ...row,
        createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString() })) }), observedAt: new Date().toISOString() };
    const cards: ExperienceCard[] = findings.length ? [{ id: "core-maintenance:own-findings", kind: "maintenance", source, freshness: "fresh",
      title: "Review your work checks", whyYou: "These open findings belong to your own checks.",
      consequence: "Review the current source before relying on the result. Existing controls retain assessment and approval.",
      evidence: ["own_open_checks"], actions: [{ id: "review-own-checks", label: "Review your checks", labelKey: "review",
        operation: "open", href: "/readiness", criticality: "C2", source, requiresCurrentAuthorization: true }] }] : [];
    const procedures = await readOwnProcedureRevalidation(tx, current, companyId, principal, budget);
    const packages = await readOwnPackageRevalidation(tx, current, companyId, principal, budget);
    const reasons = [procedures.reason, packages.reason];
    const reason = reasons.includes("source_stale") ? "source_stale" as const
      : reasons.includes("more_items_available") || findings.length > 5 ? "more_items_available" as const : null;
    await access();
    return { needsYou: [...cards, ...procedures.needsYou, ...packages.needsYou], ...(reason
      ? { coverage: { state: "partial" as const, reason } } : {}) };
  });
}
