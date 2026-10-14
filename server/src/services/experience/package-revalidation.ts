import { and, asc, eq, inArray } from "drizzle-orm";
import { companyAgentPackageInstallations, type Db } from "@paperclipai/db";
import { v7FeatureEnabled, type ExperienceCard } from "@paperclipai/shared";
import { HttpError } from "../../errors.js";
import { agentPackageService } from "../agent-packages/package-service.js";
import { authorizationService, type AuthorizationActor } from "../authorization.js";
import { instanceSettingsService } from "../instance-settings.js";
import { nativeSha256 } from "../native-runtime/canonical.js";

/** Original installation metadata only, under Core maintenance's verified
 * account, privacy lock and shared deadline. No component, repair or grant. */
export async function readOwnPackageRevalidation(
  db: Db, actor: AuthorizationActor, companyId: string, principal: string, budget: () => void,
): Promise<{ needsYou: ExperienceCard[]; reason: "source_stale" | "more_items_available" | null }> {
  const flags = await instanceSettingsService(db).getExperimental();
  if (!v7FeatureEnabled(flags, "agent_packages_v7")) return { needsYou: [], reason: null };
  budget();
  const rows = await db.select({ id: companyAgentPackageInstallations.id }).from(companyAgentPackageInstallations)
    .where(and(eq(companyAgentPackageInstallations.companyId, companyId),
      eq(companyAgentPackageInstallations.installedByUserId, principal),
      inArray(companyAgentPackageInstallations.status, ["needs_update", "degraded"])))
    .orderBy(asc(companyAgentPackageInstallations.id)).limit(6).for("share");
  let reason: "source_stale" | "more_items_available" | null = rows.length > 5 ? "more_items_available" : null;
  const cards: ExperienceCard[] = [], auth = authorizationService(db);
  for (const row of rows.slice(0, 5)) {
    budget();
    try {
      const installation = await agentPackageService(db).get(actor, companyId, row.id);
      const resource = { type: "agent" as const, companyId, agentId: installation.agentId };
      for (const action of ["agent:read", "agents:configure"] as const)
        if (!(await auth.decide({ actor, action, resource })).allowed) throw new HttpError(403, "Current installation review is unavailable");
      budget();
      if (installation.installedByUserId !== principal || !["needs_update", "degraded"].includes(installation.status)) continue;
      const source = { domain: "agent_package_installation" as const, companyId, resourceId: row.id,
        version: nativeSha256({ id: installation.id, installedVersionId: installation.installedVersionId,
          version: installation.version, status: installation.status, updatedAt: installation.updatedAt }), observedAt: new Date().toISOString() };
      cards.push({ id: `package-revalidation:${row.id}`, kind: "maintenance", source, freshness: "fresh",
        title: "Review an installed package", whyYou: "You installed this package and can review its current Agent configuration.",
        consequence: "Review its current dependencies and qualification in the existing package controls before relying on it. A review does not update or activate the package.",
        evidence: ["package_revalidation_required"], actions: [{ id: "review-package", label: "Review", labelKey: "review", operation: "open",
          href: "/agents/packages", criticality: "C2", source, requiresCurrentAuthorization: true }] });
    } catch (error) {
      budget();
      if (!(error instanceof HttpError) || ![403, 404, 409].includes(error.status)) throw error;
      reason = "source_stale";
    }
  }
  return { needsYou: cards, reason };
}
