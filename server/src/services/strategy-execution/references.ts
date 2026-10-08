import { and, eq, isNull } from "drizzle-orm";
import { businessMetrics, businessMetricVersions, businessMetricTargets, businessMetricTargetVersions, businessMetricObservations, decisions, decisionTargetIssues, documentRevisions, foundationDocuments, foundationSections, goals, issues, projects, projectMilestones, type Db } from "@paperclipai/db";
import { v5FeatureEnabled, type BusinessMetricResult, type StrategyExecutionReference } from "@paperclipai/shared";
import { conflict, forbidden, notFound } from "../../errors.js";
import type { AuthorizationActor } from "../authorization.js";
import { assertV7Authorization } from "../v7-authorization.js";
import { instanceSettingsService } from "../instance-settings.js";
import { canReadDecisionSource } from "../decision-queues.js";
import { extractFoundationSections } from "../foundation/foundation-index.js";
import { businessMetricService } from "../business-metrics/service.js";
import { businessMetricTargetService } from "../business-metrics/targets.js";
import {assertLearnedAssetAnalyticalSources} from "../learning/learning-analytical-sources.js";

export function strategyReferenceId(ref: StrategyExecutionReference) {
  return ref.type === "foundation_section" ? ref.foundationDocumentId : ref.id;
}
/** Current authority is checked separately from current version validity, so a
 * stale pin never makes a denied source visible through a review response. */
export async function authorizeStrategyReference(tx: Db, companyId: string, actor: AuthorizationActor, ref: StrategyExecutionReference, sensitivity: "internal" | "confidential") {
  const issueIds = new Set<string>(), projectIds = new Set<string>();
  let metricObservation: BusinessMetricResult | undefined;
  async function project(id: string) {
    const [row] = await tx.select().from(projects).where(and(eq(projects.companyId, companyId), eq(projects.id, id))).for("share");
    if (!row) throw notFound("Strategy project source is unavailable");
    await assertV7Authorization(tx, actor, companyId, "project:read", { type: "project", companyId, projectId: id });
    projectIds.add(id);
    return row;
  }
  async function issue(id: string) {
    const [row] = await tx.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, id), isNull(issues.hiddenAt))).for("share");
    if (!row) throw notFound("Strategy task source is unavailable");
    issueIds.add(id);
    await assertV7Authorization(tx, actor, companyId, "issue:read", { type: "issue", companyId, issueId: row.id, projectId: row.projectId, parentIssueId: row.parentId, assigneeAgentId: row.assigneeAgentId, assigneeUserId: row.assigneeUserId, status: row.status, originKind: row.originKind, originId: row.originId });
    if (row.projectId) await project(row.projectId);
  }
  async function metric(id: string, versionId: string) {
    const [row] = await tx.select().from(businessMetricVersions).where(and(eq(businessMetricVersions.companyId, companyId), eq(businessMetricVersions.metricId, id), eq(businessMetricVersions.id, versionId))).for("share");
    if (!row) throw notFound("Strategy measurement source is unavailable");
    if (row.definition.sensitivity === "confidential" && sensitivity !== "confidential") throw forbidden("Strategy sensitivity cannot downgrade its measurement source");
    const calculation = row.definition.calculation;
    if (calculation.kind !== "external_metric") for (const population of calculation.kind === "native_count" ? [calculation.population] : [calculation.denominator, calculation.numerator]) if (population.entity === "issue" && population.projectId) await project(population.projectId);
  }
  switch (ref.type) {
    case "foundation_section": {
      await assertV7Authorization(tx, actor, companyId, "foundation:read");
      const [row] = await tx.select().from(foundationDocuments).where(and(eq(foundationDocuments.companyId, companyId), eq(foundationDocuments.id, ref.foundationDocumentId))).for("share");
      if (!row) throw notFound("Strategy Foundation source is unavailable");
      if (row.sensitivity === "restricted" || row.sensitivity === "confidential" && sensitivity !== "confidential") throw forbidden("Strategy sensitivity cannot downgrade its Foundation source");
      const [revision] = await tx.select({ id: documentRevisions.id }).from(documentRevisions).where(and(eq(documentRevisions.companyId, companyId), eq(documentRevisions.documentId, row.documentId), eq(documentRevisions.id, ref.approvedRevisionId))).for("share");
      if (!revision) throw notFound("Strategy Foundation revision is unavailable");
      const learned=await assertLearnedAssetAnalyticalSources(tx,companyId,"document_revision",revision.id,actor);
      if(learned.sourceSensitivity==="confidential"&&sensitivity!=="confidential")throw forbidden("Strategy sensitivity cannot downgrade original analytical Learning sources");
      break;
    }
    case "goal": {
      const [row] = await tx.select({ id: goals.id }).from(goals).where(and(eq(goals.companyId, companyId), eq(goals.id, ref.id))).for("share");
      if (!row) throw notFound("Strategy goal source is unavailable");
      break;
    }
    case "project": await project(ref.id); break;
    case "issue": await issue(ref.id); break;
    case "milestone": {
      if (!v5FeatureEnabled(await instanceSettingsService(tx).getExperimental(), "project_roadmap_v5")) throw notFound("Native milestones are not enabled");
      const [row] = await tx.select().from(projectMilestones).where(and(eq(projectMilestones.companyId, companyId), eq(projectMilestones.id, ref.id), eq(projectMilestones.projectId, ref.projectId))).for("share");
      if (!row) throw notFound("Strategy milestone source is unavailable");
      await project(row.projectId); break;
    }
    case "decision": {
      if (!(await canReadDecisionSource(tx, actor, companyId, "decision", ref.id))) throw forbidden("Strategy decision is outside current authority");
      const [row] = await tx.select().from(decisions).where(and(eq(decisions.companyId, companyId), eq(decisions.id, ref.id))).for("share");
      if (!row) throw notFound("Strategy decision source is unavailable");
      await issue(row.originIssueId);
      const targets = await tx.select({ id: decisionTargetIssues.issueId }).from(decisionTargetIssues).where(and(eq(decisionTargetIssues.companyId, companyId), eq(decisionTargetIssues.decisionId, ref.id))).limit(101);
      if (targets.length > 100) throw conflict("Decision target authority exceeds this bounded strategy view");
      for (const target of targets) await issue(target.id);
      break;
    }
    case "metric": await metric(ref.id, ref.versionId); break;
    case "metric_target": {
      const [target] = await tx.select().from(businessMetricTargets).where(and(eq(businessMetricTargets.companyId, companyId), eq(businessMetricTargets.id, ref.id))).for("share");
      const [version] = await tx.select().from(businessMetricTargetVersions).where(and(eq(businessMetricTargetVersions.companyId, companyId), eq(businessMetricTargetVersions.targetId, ref.id), eq(businessMetricTargetVersions.id, ref.versionId))).for("share");
      if (!target || !version) throw notFound("Strategy commitment source is unavailable");
      if (target.projectId) await project(target.projectId);
      await metric(version.metricId, version.metricVersionId); break;
    }
    case "metric_observation": {
      const [row] = await tx.select().from(businessMetricObservations).where(and(eq(businessMetricObservations.companyId, companyId), eq(businessMetricObservations.id, ref.id), eq(businessMetricObservations.metricId, ref.metricId), eq(businessMetricObservations.versionId, ref.metricVersionId))).for("share");
      if (!row) throw notFound("Strategy observation source is unavailable");
      await metric(ref.metricId, ref.metricVersionId);
      // The measurement owner reauthorizes every retained lineage source, not
      // only the selected project or a copied aggregate.
      metricObservation = await businessMetricService(tx).inspectCurrentObservation(companyId, actor, ref.id); break;
    }
  }
  return { issueIds: [...issueIds], projectIds: [...projectIds], ...(metricObservation ? { metricObservation } : {}) };
}

export async function validateCurrentStrategyReference(tx: Db, companyId: string, actor: AuthorizationActor, ref: StrategyExecutionReference, now = new Date()) {
  switch (ref.type) {
    case "foundation_section": {
      const [row] = await tx.select().from(foundationDocuments).where(and(eq(foundationDocuments.companyId, companyId), eq(foundationDocuments.id, ref.foundationDocumentId)));
      if (!row || row.authorityLevel !== "canonical" || ["archived", "superseded"].includes(row.status) || row.approvedRevisionId !== ref.approvedRevisionId || !row.nextReviewAt || row.nextReviewAt <= now || row.validFrom && row.validFrom > now || row.validUntil && row.validUntil <= now) throw conflict("Approved Foundation strategy changed or requires review");
      const [section] = await tx.select().from(foundationSections).where(and(eq(foundationSections.companyId, companyId), eq(foundationSections.foundationDocumentId, row.id), eq(foundationSections.documentRevisionId, ref.approvedRevisionId), eq(foundationSections.id, ref.sectionId))).for("share");
      const [revision] = await tx.select().from(documentRevisions).where(and(eq(documentRevisions.companyId, companyId), eq(documentRevisions.id, ref.approvedRevisionId)));
      const canonicalSection = revision && section ? extractFoundationSections(revision.body)[section.ordinal] : null;
      if (!section || !canonicalSection || section.contentHash !== ref.contentHash || canonicalSection.contentHash !== ref.contentHash || JSON.stringify(section.headingPath) !== JSON.stringify(ref.headingPath) || JSON.stringify(canonicalSection.headingPath) !== JSON.stringify(ref.headingPath)) throw conflict("Approved Foundation section identity or hash changed");
      break;
    }
    case "metric": {
      const pin = await businessMetricService(tx).inspectPublishedDefinition(companyId, actor, ref.id, ref.versionId);
      if (pin.metric.publishedVersionId !== ref.versionId) throw conflict("Strategy measurement definition changed");
      break;
    }
    case "metric_target": await businessMetricTargetService(tx).inspectApprovedCommitment(companyId, actor, ref.id, ref.versionId); break;
    case "metric_observation": await businessMetricService(tx).inspectCurrentObservation(companyId, actor, ref.id); break;
    case "project": {
      const [row] = await tx.select({ archivedAt: projects.archivedAt }).from(projects).where(and(eq(projects.companyId, companyId), eq(projects.id, ref.id)));
      if (row?.archivedAt) throw conflict("Strategy project was archived"); break;
    }
    default: break;
  }
}
