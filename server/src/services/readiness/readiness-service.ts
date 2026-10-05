import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, issues, workflows, readinessAssessments, readinessRequirements, knowledgeQualityFindings } from "@paperclipai/db";
import type { Request } from "express";
import type { AssessReadiness, CreateReadinessRequirement, EvidenceItem } from "@paperclipai/shared";
import { createReadinessRequirementSchema, resolveReadinessFindingSchema } from "@paperclipai/shared";
import type { z } from "zod";
import { conflict, forbidden, notFound, unprocessable } from "../../errors.js";
import { accessService } from "../access.js";
import { contextEngineService } from "../context/context-engine.js";
import { approvedFoundationView, foundationService } from "../foundation/foundation-service.js";
import { logActivity, publishActivity, type ActivityPublication } from "../activity-log.js";
import { logger } from "../../middleware/logger.js";
import { evaluateReadiness, mandatoryReadinessPolicy, readinessHash, READINESS_POLICY_VERSION } from "./readiness-policy.js";

type ReadinessActor = { actor: Request["actor"]; principalId: string; userId: string | null };
const FOUNDATION_DOMAINS: Record<string, string> = {
  company: "company_profile", business_model: "business_model", market_customer: "market_customer",
  products_services: "products_services", brand: "brand_positioning", strategy: "company_strategy",
  organization_leadership: "organization", operating_model: "operating_model", governance: "governance",
};
function publish(publications: ActivityPublication[]) {
  for (const item of publications) {
    try { publishActivity(item); } catch (error) { logger.error({ err: error }, "Readiness audit publication failed"); }
  }
}

export function readinessService(db: Db) {
  const context = contextEngineService(db);
  const access = accessService(db);
  const foundation = foundationService(db);
  async function requirements(companyId: string, actionClass?: string) {
    // Select the latest immutable version of each key, then match its current action.
    const rows = await db.selectDistinctOn([readinessRequirements.requirementKey]).from(readinessRequirements)
      .where(eq(readinessRequirements.companyId, companyId))
      .orderBy(readinessRequirements.requirementKey, desc(readinessRequirements.version));
    return actionClass ? rows.filter((row) => row.actionClass === actionClass) : rows;
  }
  return {
    requirements,
    findings: (companyId: string, principalId: string) => db.select({ finding: knowledgeQualityFindings }).from(knowledgeQualityFindings)
      .innerJoin(readinessAssessments, and(eq(knowledgeQualityFindings.companyId, readinessAssessments.companyId), eq(knowledgeQualityFindings.assessmentId, readinessAssessments.id)))
      .where(and(eq(knowledgeQualityFindings.companyId, companyId), eq(readinessAssessments.principalId, principalId)))
      .orderBy(desc(knowledgeQualityFindings.createdAt)).limit(100).then((rows) => rows.map((row) => row.finding)),
    resolveFinding: async (companyId: string, id: string, input: z.infer<typeof resolveReadinessFindingSchema>, owner: ReadinessActor) => {
      const publications: ActivityPublication[] = [];
      const resolved = await db.transaction(async (tx) => {
        const [record] = await tx.select({ finding: knowledgeQualityFindings, assessment: readinessAssessments }).from(knowledgeQualityFindings)
          .innerJoin(readinessAssessments, and(eq(knowledgeQualityFindings.companyId, readinessAssessments.companyId), eq(knowledgeQualityFindings.assessmentId, readinessAssessments.id)))
          .where(and(eq(knowledgeQualityFindings.companyId, companyId), eq(knowledgeQualityFindings.id, id), eq(readinessAssessments.principalId, owner.principalId)));
        if (!record) throw notFound("Quality finding not found");
        const [resolution] = await tx.select().from(readinessAssessments)
          .where(and(eq(readinessAssessments.companyId, companyId), eq(readinessAssessments.id, input.resolutionAssessmentId), eq(readinessAssessments.principalId, owner.principalId)));
        const matching = resolution?.assessment.requirements.filter((item) => item.requirementKey === record.finding.requirementKey) ?? [];
        if (!resolution || resolution.agentId !== record.assessment.agentId || resolution.actionClass !== record.assessment.actionClass
          || resolution.subjectId !== record.assessment.subjectId || resolution.expiresAt.getTime() <= Date.now()
          || !matching.length || matching.some((item) => !item.satisfied)) throw conflict("Current successful assessment evidence is required to resolve this finding");
        const [updated] = await tx.update(knowledgeQualityFindings).set({ status: "resolved", resolutionRef: resolution.id, resolutionReason: input.reason, resolvedAt: new Date() })
          .where(and(eq(knowledgeQualityFindings.companyId, companyId), eq(knowledgeQualityFindings.id, id), eq(knowledgeQualityFindings.status, input.expectedStatus))).returning();
        if (!updated) throw conflict("Quality finding changed", { code: "revision_conflict" });
        await logActivity(tx as unknown as Db, { companyId, actorType: "user", actorId: owner.principalId,
          action: "readiness.finding_resolved", entityType: "knowledge_quality_finding", entityId: id,
          details: { resolutionAssessmentId: resolution.id },
        }, publications);
        return updated;
      });
      publish(publications);
      return resolved;
    },
    publishRequirement: async (companyId: string, input: CreateReadinessRequirement, owner: ReadinessActor) => {
      const parsed = createReadinessRequirementSchema.parse(input);
      if (parsed.requirementKey.startsWith("system.")) throw forbidden("System requirements cannot be replaced");
      const publications: ActivityPublication[] = [];
      const row = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${companyId}:${parsed.requirementKey}`}, 0))`);
        const [current] = await tx.select().from(readinessRequirements)
          .where(and(eq(readinessRequirements.companyId, companyId), eq(readinessRequirements.requirementKey, parsed.requirementKey)))
          .orderBy(desc(readinessRequirements.version)).limit(1);
        if ((current?.version ?? 0) !== parsed.expectedVersion) throw conflict("Readiness requirement changed", { code: "revision_conflict" });
        const [created] = await tx.insert(readinessRequirements).values({
          companyId, requirementKey: parsed.requirementKey, name: parsed.name,
          actionClass: parsed.actionClass, version: parsed.expectedVersion + 1,
          criteria: parsed.criteria, createdBy: owner.principalId,
        }).returning();
        await logActivity(tx as unknown as Db, {
          companyId, actorType: owner.actor.type === "agent" ? "agent" : "user", actorId: owner.principalId,
          action: "readiness.requirement_published", entityType: "readiness_requirement", entityId: created!.id,
          details: { requirementKey: parsed.requirementKey, version: created!.version },
        }, publications);
        return created!;
      });
      publish(publications);
      return row;
    },
    assess: async (companyId: string, input: AssessReadiness, owner: ReadinessActor, parentPublications?: ActivityPublication[]) => {
      const [agent] = await db.select({ id: agents.id }).from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, input.agentId)));
      if (!agent) throw notFound("Agent not found");
      if (owner.actor.type === "agent" && owner.actor.agentId !== input.agentId) throw forbidden("Agents can assess only their own readiness");
      const subjectId = input.subjectId ?? input.agentId;
      if (input.subjectType === "task") {
        const [subject] = await db.select({ id: issues.id }).from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, subjectId)));
        if (!subject) throw notFound("Task not found");
      } else if (input.subjectType === "workflow") {
        const [subject] = await db.select({ id: workflows.id }).from(workflows).where(and(eq(workflows.companyId, companyId), eq(workflows.id, subjectId)));
        if (!subject) throw notFound("Workflow not found");
      } else if (input.subjectType !== "agent" || subjectId !== input.agentId) {
        throw unprocessable("This subject is not supported until its owning domain is available");
      }
      const responsibleUserId = owner.userId;
      const enforceResponsibleUserIntersection = owner.actor.source !== "local_implicit";
      const assembled = await context.assemble({
        companyId, agentId: input.agentId, responsibleUserId, enforceResponsibleUserIntersection,
        query: input.query, intent: input.actionClass, includeFoundation: false,
        issueId: input.subjectType === "task" ? subjectId : null,
        sensitivityCeiling: "internal",
      });
      const evidence = assembled.decisions.map((decision) => decision.evidence);
      const foundationPermission = await access.decide({
        actor: { type: "agent", agentId: input.agentId, companyId, onBehalfOfUserId: responsibleUserId, source: "agent_jwt" },
        enforceResponsibleUserIntersection, action: "foundation:read", resource: { type: "company", companyId },
      });
      if (foundationPermission.allowed) {
        // Exact approved revisions are inspected, not a search-result sample. Working
        // governance fields cannot lend authority to an older approved revision.
        for (const item of (await foundation.list(companyId)).map(approvedFoundationView)) {
          if (!item || item.authorityLevel !== "canonical" || !["public", "internal"].includes(item.sensitivity)) continue;
          const revision = item.canonicalRevision!;
          evidence.push({
            id: `foundation:${item.id}:${revision.id}`, companyId, sourceClass: "foundation",
            sourceProvider: "august_works_foundation", sourceType: "approved_foundation",
            sourceRef: `foundation://${item.id}/${revision.id}`, sourceVersion: revision.id,
            title: item.title, excerpt: item.body,
            sourceUpdatedAt: new Date(item.lastReviewedAt ?? revision.createdAt).toISOString(), observedAt: new Date().toISOString(),
            validFrom: item.validFrom ? new Date(item.validFrom).toISOString() : null,
            validUntil: item.validUntil ? new Date(item.validUntil).toISOString() : null,
            authorityDomain: FOUNDATION_DOMAINS[item.category] ?? null,
            trustLevel: item.authorityLevel === "canonical" ? "high" : "medium", sensitivity: item.sensitivity,
            citation: { label: item.foundationKey },
            metadata: { verificationState: "human_verified", conflictState: "none", foundationKey: item.foundationKey,
              nextReviewAt: item.lastReviewedAt && item.reviewFrequencyDays
                ? new Date(new Date(item.lastReviewedAt).getTime() + item.reviewFrequencyDays * 86400000).toISOString() : null },
          } satisfies EvidenceItem);
        }
      }
      const custom = await requirements(companyId, input.actionClass);
      const policies = [...mandatoryReadinessPolicy(input.actionClass), ...custom.map((row) => ({ key: row.requirementKey, version: row.version, criteria: row.criteria }))];
      const evaluation = evaluateReadiness({ action: input.actionClass, requirements: policies, evidence });
      const publications: ActivityPublication[] = parentPublications ?? [];
      const row = await db.transaction(async (tx) => {
        const [created] = await tx.insert(readinessAssessments).values({
          companyId, agentId: input.agentId, principalId: owner.principalId, subjectType: input.subjectType, subjectId,
          actionClass: input.actionClass, riskClass: evaluation.riskClass, status: evaluation.status,
          requirementSnapshotHash: readinessHash(policies), policySnapshotHash: readinessHash({ version: READINESS_POLICY_VERSION, context: assembled.packet.manifest?.policySnapshotHash, principal: owner.principalId }),
          contextManifestId: assembled.packet.manifest?.id ?? null, requirementSnapshot: policies,
          assessment: evaluation, assessedAt: new Date(evaluation.assessedAt), expiresAt: new Date(evaluation.expiresAt),
        }).returning();
        const findings = evaluation.requirements.filter((criterion) => !criterion.satisfied).flatMap((criterion) => {
          const failed = criterion.dimensions.filter((dimension) => !["satisfied", "not_applicable"].includes(dimension.state));
          // A conjunction can fail even if different sources satisfy its dimensions separately.
          const dimensions = failed.length ? failed : [{ dimension: "completeness", state: "failed", reason: "No single source satisfies all required dimensions" }];
          return dimensions.map((dimension) => ({
            companyId, assessmentId: created!.id,
            findingHash: readinessHash([criterion.requirementKey, criterion.criterionKey, dimension.dimension]),
            qualityDimension: dimension.dimension, requirementKey: criterion.requirementKey,
            severity: criterion.mandatory ? "blocking" : "warning", summary: `${criterion.domain}: ${dimension.reason}`,
            evidenceRefs: criterion.evidenceRefs, ruleVersion: READINESS_POLICY_VERSION,
          }));
        });
        if (findings.length) await tx.insert(knowledgeQualityFindings).values(findings);
        await logActivity(tx as unknown as Db, { companyId, actorType: owner.actor.type === "agent" ? "agent" : "user",
          actorId: owner.principalId, agentId: input.agentId, action: "readiness.assessed", entityType: "readiness_assessment", entityId: created!.id,
          details: { actionClass: input.actionClass, status: evaluation.status, requirementSnapshotHash: created!.requirementSnapshotHash },
        }, publications);
        return created!;
      });
      if (!parentPublications) publish(publications);
      return row;
    },
    list: (companyId: string, principalId: string) => db.select().from(readinessAssessments)
      .where(and(eq(readinessAssessments.companyId, companyId), eq(readinessAssessments.principalId, principalId)))
      .orderBy(desc(readinessAssessments.assessedAt)).limit(50),
    get: async (companyId: string, id: string, principalId: string) => {
      const [row] = await db.select().from(readinessAssessments)
        .where(and(eq(readinessAssessments.companyId, companyId), eq(readinessAssessments.id, id), eq(readinessAssessments.principalId, principalId)));
      if (!row) throw notFound("Readiness assessment not found");
      const findings = await db.select().from(knowledgeQualityFindings)
        .where(and(eq(knowledgeQualityFindings.companyId, companyId), eq(knowledgeQualityFindings.assessmentId, id)));
      return { ...row, findings, expired: row.expiresAt.getTime() <= Date.now() };
    },
  };
}
