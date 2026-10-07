import { and, asc, eq, ilike, isNull, ne, or } from "drizzle-orm";
import { analyticalSourceSuppressions, businessMetrics, businessMetricTargets, businessMetricObservations, decisions, foundationDocuments, goals, issues, learningCycles, projects, projectMilestones, type Db } from "@paperclipai/db";
import type { ManagementReviewSource, ManagementSourceOptions, ManagementSourceOptionsQuery, StrategyExecutionReference } from "@paperclipai/shared";
import type { AuthorizationActor } from "../authorization.js";
import { HttpError, unprocessable } from "../../errors.js";
import { authorizeStrategyReference, validateCurrentStrategyReference } from "../strategy-execution/references.js";
import { assertV7Authorization } from "../v7-authorization.js";
import { foundationIndexService } from "../foundation/foundation-index.js";
import { decisionOutcomeReviewService } from "../decision-outcome-reviews.js";
import { learningService } from "../learning/learning-service.js";
import { inspectAnalyticalEvidenceAuthority } from "../analytical-evidence.js";
import { nativeSha256 } from "../native-runtime/canonical.js";

/** Private candidate lookup only. Every disclosed pin/title passes its native
 * owner's current authority and lifecycle checks in the caller's locked TX. */
export async function managementSourceOptions(tx: Db, companyId: string, actor: AuthorizationActor, query: ManagementSourceOptionsQuery): Promise<ManagementSourceOptions> {
  const candidates: ManagementSourceOptions["items"] = [], items: ManagementSourceOptions["items"] = [], deadline = performance.now() + 30000;
  const pattern = `%${(query.q ?? "").replace(/[\\%_]/g, "\\$&")}%`;
  const canonical = (reference: StrategyExecutionReference, title: string) => candidates.push({ source: { kind: "canonical", reference }, title });
  switch (query.kind) {
    case "goal": for (const row of await tx.select().from(goals).where(and(eq(goals.companyId, companyId), ilike(goals.title, pattern))).orderBy(asc(goals.id)).limit(20)) canonical({ type: "goal", id: row.id }, row.title); break;
    case "project": for (const row of await tx.select().from(projects).where(and(eq(projects.companyId, companyId), isNull(projects.archivedAt), ilike(projects.name, pattern))).orderBy(asc(projects.id)).limit(20)) canonical({ type: "project", id: row.id }, row.name); break;
    case "issue": for (const row of await tx.select().from(issues).where(and(eq(issues.companyId, companyId), isNull(issues.hiddenAt), or(isNull(issues.harnessKind), ne(issues.harnessKind, "conversation")), ilike(issues.title, pattern))).orderBy(asc(issues.id)).limit(20)) canonical({ type: "issue", id: row.id }, `${row.identifier ?? "Task"} · ${row.title}`); break;
    case "decision": for (const row of await tx.select().from(decisions).where(and(eq(decisions.companyId, companyId), ilike(decisions.title, pattern))).orderBy(asc(decisions.id)).limit(20)) canonical({ type: "decision", id: row.id }, `${row.title} · ${row.status}`); break;
    case "milestone": if (query.parentId) for (const row of await tx.select().from(projectMilestones).where(and(eq(projectMilestones.companyId, companyId), eq(projectMilestones.projectId, query.parentId))).orderBy(asc(projectMilestones.id)).limit(20)) canonical({ type: "milestone", id: row.id, projectId: row.projectId }, row.name); break;
    case "metric": for (const row of await tx.select().from(businessMetrics).where(and(eq(businessMetrics.companyId, companyId), eq(businessMetrics.status, "published"), ilike(businessMetrics.key, pattern))).orderBy(asc(businessMetrics.id)).limit(20)) if (row.publishedVersionId) canonical({ type: "metric", id: row.id, versionId: row.publishedVersionId }, row.key); break;
    case "metric_target": for (const row of await tx.select().from(businessMetricTargets).where(and(eq(businessMetricTargets.companyId, companyId), eq(businessMetricTargets.status, "approved"), ilike(businessMetricTargets.key, pattern))).orderBy(asc(businessMetricTargets.id)).limit(20)) if (row.approvedVersionId) canonical({ type: "metric_target", id: row.id, versionId: row.approvedVersionId }, row.key); break;
    case "metric_observation": if (query.parentId) for (const row of await tx.select().from(businessMetricObservations).where(and(eq(businessMetricObservations.companyId, companyId), eq(businessMetricObservations.metricId, query.parentId))).orderBy(asc(businessMetricObservations.id)).limit(20)) canonical({ type: "metric_observation", id: row.id, metricId: row.metricId, metricVersionId: row.versionId }, `${row.result.from} to ${row.result.until}`); break;
    case "foundation_section": {
      await assertV7Authorization(tx, actor, companyId, "foundation:read");
      if (query.q) for (const row of await foundationIndexService(tx).search(companyId, { query: query.q, scope: "approved", limit: 20 })) if (row.sectionId && row.authorityLevel === "canonical" && row.sensitivity !== "restricted") canonical({ type: "foundation_section", foundationDocumentId: row.foundationDocumentId, approvedRevisionId: row.documentRevisionId, sectionId: row.sectionId, headingPath: row.headingPath, contentHash: row.contentHash }, `${row.title ?? row.foundationKey} / ${row.headingPath.join(" / ") || "Introduction"}`);
      break;
    }
    case "decision_outcome": if (query.parentId) {
      const reference = { type: "decision" as const, id: query.parentId }; await authorizeStrategyReference(tx, companyId, actor, reference, "confidential");
      const row = await decisionOutcomeReviewService(tx).detail(companyId, actor, query.parentId);
      if (row) candidates.push({ source: { kind: "decision_outcome", decisionId: query.parentId, reviewId: row.id, revision: row.revision }, title: `${row.status} · revision ${row.revision} · due ${row.reviewDueAt}` });
      break;
    }
    case "learning_cycle": for (const row of await tx.select().from(learningCycles).where(and(eq(learningCycles.companyId, companyId), isNull(learningCycles.erasedAt))).orderBy(asc(learningCycles.id)).limit(20)) if (!["invalidated", "cancelled"].includes(row.status)) candidates.push({ source: { kind: "learning_cycle", id: row.id, expectedVersion: row.version }, title: `${row.trigger} · ${row.status} · version ${row.version}` }); break;
  }
  for (const candidate of candidates) {
    if (performance.now() > deadline) throw unprocessable("Native source menu exceeded its bounded authority budget");
    try {
      const source: ManagementReviewSource = candidate.source;
      if (source.kind === "canonical") {
        const scope = await authorizeStrategyReference(tx, companyId, actor, source.reference, "confidential");
        await validateCurrentStrategyReference(tx, companyId, actor, source.reference);
        await inspectAnalyticalEvidenceAuthority(tx, companyId, actor, [...scope.issueIds.map(inputRef => ({ inputType: "issue" as const, inputRef, inputHash: nativeSha256({ type: "issue", id: inputRef }), relationship: "source" as const })), ...scope.projectIds.map(inputRef => ({ inputType: "project" as const, inputRef, inputHash: nativeSha256({ type: "project", id: inputRef }), relationship: "source" as const }))], deadline);
        const ref = source.reference, primitives: Array<{ type: "goal" | "document" | "document_revision"; id: string }> = ref.type === "goal" ? [{ type: "goal", id: ref.id }] : [];
        if (ref.type === "foundation_section") { const [document] = await tx.select().from(foundationDocuments).where(and(eq(foundationDocuments.companyId, companyId), eq(foundationDocuments.id, ref.foundationDocumentId))); if (document) primitives.push({ type: "document", id: document.documentId }, { type: "document_revision", id: ref.approvedRevisionId }); }
        for (const primitive of primitives) if ((await tx.select({ id: analyticalSourceSuppressions.inputRef }).from(analyticalSourceSuppressions).where(and(eq(analyticalSourceSuppressions.companyId, companyId), eq(analyticalSourceSuppressions.inputType, primitive.type), eq(analyticalSourceSuppressions.inputRef, primitive.id))).limit(1)).length) throw new HttpError(409, "Source was erased");
      } else if (source.kind === "learning_cycle") await learningService(tx).get(actor, companyId, source.id);
      items.push(candidate);
    } catch (error) { if (!(error instanceof HttpError && [403, 404, 409].includes(error.status))) throw error; }
  }
  return { items, coverage: "bounded_authorized_native_choices" };
}
