import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { companySkills, playbookDocuments, type Db } from "@paperclipai/db";
import { v5FeatureEnabled, type ExperienceCard } from "@paperclipai/shared";
import { HttpError } from "../../errors.js";
import type { AuthorizationActor } from "../authorization.js";
import { instanceSettingsService } from "../instance-settings.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { playbookService } from "../playbooks.js";
import { skillLifecycleService } from "../skill-lifecycle.js";

/** Runs inside the Core maintenance reader's verified-account transaction and
 * shared deadline. The Native owners check Sources; no catalog refresh/writes. */
export async function readOwnProcedureRevalidation(
  db: Db, actor: AuthorizationActor, companyId: string, principal: string, budget: () => void,
): Promise<{ needsYou: ExperienceCard[]; reason: "source_stale" | "more_items_available" | null }> {
  const flags = await instanceSettingsService(db).getExperimental();
  const cards: ExperienceCard[] = [];
  let reason: "source_stale" | "more_items_available" | null = null;
  const kinds = ["company_skill", "playbook"] as const;
  for (const kind of kinds) {
    budget();
    if (!v5FeatureEnabled(flags, kind === "company_skill" ? "skill_lifecycle_v5" : "playbooks_v5")) continue;
    const rows = kind === "company_skill"
      ? await db.select({ id: companySkills.id }).from(companySkills).where(and(
        eq(companySkills.companyId, companyId), sql`${companySkills.reviewPolicy}->>'stewardUserId'=${principal}`,
        inArray(companySkills.lifecycleState, ["active", "needs_revalidation", "degraded"])))
        .orderBy(asc(companySkills.id)).limit(6).for("share")
      : await db.select({ id: playbookDocuments.id }).from(playbookDocuments).where(and(
        eq(playbookDocuments.companyId, companyId), eq(playbookDocuments.ownerUserId, principal),
        inArray(playbookDocuments.status, ["approved", "in_review"]), sql`${playbookDocuments.nextReviewAt}<=clock_timestamp()`))
        .orderBy(asc(playbookDocuments.id)).limit(6).for("share");
    if (rows.length > 5 && !reason) reason = "more_items_available";
    for (const row of rows.slice(0, 5)) {
      budget();
      try {
        const review = kind === "company_skill"
          ? await skillLifecycleService(db).maintenanceReview(actor, companyId, row.id)
          : await playbookService(db).maintenanceReview(actor, companyId, row.id);
        budget();
        if (!review?.needsReview || ("stewardUserId" in review ? review.stewardUserId : review.ownerUserId) !== principal) continue;
        const source = { domain: kind, companyId, resourceId: row.id, version: nativeSha256(review), observedAt: new Date().toISOString() };
        cards.push({ id: `procedure-revalidation:${kind}:${row.id}`, kind: "maintenance", source, freshness: "fresh",
          title: kind === "company_skill" ? "Review an assigned Skill" : "Review an assigned Playbook",
          whyYou: "You are the assigned reviewer for this procedure.",
          consequence: "Review the current source and dependencies using the existing procedure controls before relying on the work.",
          evidence: ["procedure_revalidation_required"], actions: [{ id: "review-procedure", label: "Review", labelKey: "review",
            operation: "open", href: kind === "company_skill" ? `/skills/studio/${row.id}` : `/playbooks/${row.id}`,
            criticality: "C2", source, requiresCurrentAuthorization: true }] });
      } catch (error) {
        budget();
        if (!(error instanceof HttpError) || ![403, 404, 409].includes(error.status)) throw error;
        reason = "source_stale";
      }
    }
  }
  return { needsYou: cards, reason };
}
