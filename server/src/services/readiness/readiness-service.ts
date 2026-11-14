import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agentPackageVersions, companyAgentPackageInstallations, agents, issues, workflows, readinessAssessments, readinessRequirements, knowledgeQualityFindings } from "@paperclipai/db";
import type { AuthorizationActor } from "../authorization.js";
import type { AssessReadiness, CreateReadinessRequirement, EvidenceItem } from "@paperclipai/shared";
import { createReadinessRequirementSchema, resolveReadinessFindingSchema, readinessCriterionSchema } from "@paperclipai/shared";
import type { z } from "zod";
import { conflict, forbidden, notFound, unprocessable } from "../../errors.js";
import { contextEngineService, type AssembleContextInput } from "../context/context-engine.js";
import { accessService } from "../access.js";
import { approvedFoundationView, foundationService } from "../foundation/foundation-service.js";
import type { FoundationDocument } from "@paperclipai/shared";
import { hashEvidenceContent } from "../context/context-manifest.js";
import { logActivity, publishActivity, type ActivityPublication } from "../activity-log.js";
import { logger } from "../../middleware/logger.js";
import { evaluateReadiness, mandatoryReadinessPolicy, readinessHash, READINESS_POLICY_VERSION } from "./readiness-policy.js";

type ReadinessActor = { actor: AuthorizationActor; principalId: string; userId: string | null };
const FOUNDATION_DOMAINS: Record<string, string> = {
  company: "company_profile", business_model: "business_model", market_customer: "market_customer",
  products_services: "products_services", brand: "brand_positioning", strategy: "company_strategy",
  organization_leadership: "organization", operating_model: "operating_model", governance: "governance",
};
const MAX_READINESS_FOUNDATION_DOCUMENTS = 256;
const MAX_READINESS_FOUNDATION_BYTES = 2 * 1024 * 1024;

function readinessFoundationEvidence(companyId: string, documents: FoundationDocument[]) {
  const observedAt = new Date().toISOString();
  const approved = documents.map(approvedFoundationView).filter((item): item is FoundationDocument =>
    !!item && item.authorityLevel === "canonical" && ["public", "internal"].includes(item.sensitivity));
  if (approved.length > MAX_READINESS_FOUNDATION_DOCUMENTS ||
    approved.reduce((total, item) => total + new TextEncoder().encode(item.body).length, 0) > MAX_READINESS_FOUNDATION_BYTES)
    throw forbidden("Approved Foundation readiness evidence exceeds its source budget");
  return approved.map(item => {
    const revision = item.canonicalRevision!;
    return {
      id: `foundation:${item.id}:${revision.id}`, companyId, sourceClass: "foundation" as const,
      sourceProvider: "august_works_foundation", sourceType: "approved_foundation",
      sourceRef: `foundation://${item.id}/${revision.id}`, sourceVersion: revision.id,
      title: item.title, excerpt: item.body,
      sourceUpdatedAt: new Date(item.lastReviewedAt ?? revision.createdAt).toISOString(), observedAt,
      validFrom: item.validFrom ? new Date(item.validFrom).toISOString() : null,
      validUntil: item.validUntil ? new Date(item.validUntil).toISOString() : null,
      authorityDomain: FOUNDATION_DOMAINS[item.category] ?? null,
      trustLevel: "high" as const, sensitivity: item.sensitivity,
      citation: { label: item.foundationKey },
      metadata: { verificationState: "human_verified", conflictState: "none", foundationKey: item.foundationKey,
        nextReviewAt: item.lastReviewedAt && item.reviewFrequencyDays
          ? new Date(new Date(item.lastReviewedAt).getTime() + item.reviewFrequencyDays * 86400000).toISOString() : null },
    } satisfies EvidenceItem;
  });
}

function readinessEvidenceSourceHash(evidence: EvidenceItem[]) {
  return readinessHash(evidence.map(item => ({ sourceProvider: item.sourceProvider, sourceRef: item.sourceRef,
    sourceVersion: item.sourceVersion, contentHash: hashEvidenceContent(item) }))
    .sort((a, b) => `${a.sourceProvider}:${a.sourceRef}`.localeCompare(`${b.sourceProvider}:${b.sourceRef}`)));
}
function publish(publications: ActivityPublication[]) {
  for (const item of publications) {
    try { publishActivity(item); } catch (error) { logger.error({ err: error }, "Readiness audit publication failed"); }
  }
}

export function readinessService(db: Db) {
  const context = contextEngineService(db);
  async function requirements(companyId: string, actionClass?: string, sourceDb: Db = db) {
    // Select the latest immutable version of each key, then match its current action.
    const rows = await sourceDb.selectDistinctOn([readinessRequirements.requirementKey]).from(readinessRequirements)
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
    /** Internal body-free open findings using the same Original principal owner.
     * Bound the extra row for a projection; hold current status through assembly. */
    maintenanceFindings: (companyId: string, principalId: string) => db.select({
      id: knowledgeQualityFindings.id, assessmentId: knowledgeQualityFindings.assessmentId,
      status: knowledgeQualityFindings.status, severity: knowledgeQualityFindings.severity,
      findingHash: knowledgeQualityFindings.findingHash, createdAt: knowledgeQualityFindings.createdAt,
      expiresAt: readinessAssessments.expiresAt,
    }).from(knowledgeQualityFindings).innerJoin(readinessAssessments, and(
      eq(knowledgeQualityFindings.companyId, readinessAssessments.companyId), eq(knowledgeQualityFindings.assessmentId, readinessAssessments.id)))
      .where(and(eq(knowledgeQualityFindings.companyId, companyId), eq(readinessAssessments.principalId, principalId),
        inArray(knowledgeQualityFindings.status, ["open", "acknowledged"])))
      .orderBy(desc(knowledgeQualityFindings.createdAt), desc(knowledgeQualityFindings.id)).limit(6).for("share"),
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
    assess: async (companyId: string, input: AssessReadiness, owner: ReadinessActor, parentPublications?: ActivityPublication[], nativePackageVersionId?: string) => {
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
      } else if (input.subjectType === "agent_package") {
        const [subject]=await db.select().from(companyAgentPackageInstallations).where(and(eq(companyAgentPackageInstallations.companyId,companyId),eq(companyAgentPackageInstallations.id,subjectId),eq(companyAgentPackageInstallations.agentId,input.agentId)));
        if(!subject||subject.status==="uninstalled")throw notFound("Package installation not found");nativePackageVersionId=subject.installedVersionId;
      } else if (input.subjectType !== "agent" || subjectId !== input.agentId) {
        throw unprocessable("This subject is not supported until its owning domain is available");
      }
      const responsibleUserId = owner.userId;
      const enforceResponsibleUserIntersection = owner.actor.source !== "local_implicit";
      const assemblyInput: AssembleContextInput = {
        companyId, agentId: input.agentId, responsibleUserId, enforceResponsibleUserIntersection,
        runId: owner.actor.type === "agent" ? owner.actor.runId ?? null : null,
        query: input.query, intent: input.actionClass, includeFoundation: false,
        issueId: input.subjectType === "task" ? subjectId : null,
        sensitivityCeiling: "internal",
      };
      const publications: ActivityPublication[] = parentPublications ?? [];
      const persist = async (assembled: Awaited<ReturnType<typeof context.assemble>>, sourceDb: Db,
        additionalEvidence: EvidenceItem[] = [], additionalSourceHash: string | null = null) => {
        const evidence = [...assembled.decisions.map((decision) => decision.evidence), ...(assembled.inspectionEvidence ?? []), ...additionalEvidence];
        const custom = await requirements(companyId, input.actionClass, sourceDb);
        const packageRules: Parameters<typeof evaluateReadiness>[0]["requirements"] = [];
        if(nativePackageVersionId){
          const [release]=await sourceDb.select().from(agentPackageVersions).where(eq(agentPackageVersions.id,nativePackageVersionId));
          if(!release||release.state!=="published"||!release.release.manifest.actionClasses.includes(input.actionClass))throw conflict("Current package capability qualification is required");
          if(release.release.manifest.requiredKnowledge.length)packageRules.push({key:`system.package.${release.contentHash}`,version:1,criteria:release.release.manifest.requiredKnowledge.map(domain=>readinessCriterionSchema.parse({key:domain,domain,sourceClasses:["foundation"],mandatory:true,failureBehavior:"block",maxAgeSeconds:90*86400,allowedPurposes:[input.actionClass]}))});
        }
        const policies = [...packageRules, ...mandatoryReadinessPolicy(input.actionClass), ...custom.map((row) => ({ key: row.requirementKey, version: row.version, criteria: row.criteria }))];
        const evaluation = evaluateReadiness({ action: input.actionClass, requirements: policies, evidence });
        const write = async (tx: Db) => {
          const [created] = await tx.insert(readinessAssessments).values({
            companyId, agentId: input.agentId, principalId: owner.principalId, subjectType: input.subjectType, subjectId,
            actionClass: input.actionClass, riskClass: evaluation.riskClass, status: evaluation.status,
            requirementSnapshotHash: readinessHash(policies), policySnapshotHash: readinessHash({ version: READINESS_POLICY_VERSION,
              context: assembled.inspection?.policySnapshotHash ?? assembled.packet.manifest?.policySnapshotHash,
              sourceSnapshotHash: assembled.inspection?.sourceSnapshotHash ?? (additionalSourceHash
                ? readinessHash({ contextManifestId: assembled.packet.manifest?.id ?? null, foundation: additionalSourceHash }) : null),
              principal: owner.principalId }),
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
        };
        const row = sourceDb === db ? await sourceDb.transaction(async tx => write(tx as unknown as Db)) : await write(sourceDb);
        if (!parentPublications && sourceDb === db) publish(publications);
        return row;
      };

      if (owner.actor.type === "board") {
        const result = await context.inspectReadOnly(assemblyInput, owner.actor, {
          addEvidence: async (txDb, authority) => {
            const permission = await authority.decide({ actor: owner.actor, action: "foundation:read",
              resource: { type: "company", companyId }, enforceResponsibleUserIntersection: true });
            if (!permission.allowed) return [];
            return readinessFoundationEvidence(companyId, await foundationService(txDb).list(companyId, owner.actor));
          },
          complete: (assembled, txDb) => persist(assembled, txDb),
        });
        if (!parentPublications) publish(publications);
        return result;
      }
      if (owner.actor.type === "agent") {
        const assembled = await context.assemble(assemblyInput);
        const row = await db.transaction(async rawTx => {
          const tx = rawTx as unknown as Db;
          const readFoundation = async () => {
            const permission = await accessService(tx).decide({ actor: owner.actor,
              enforceResponsibleUserIntersection, action: "foundation:read", resource: { type: "company", companyId } });
            const evidence = permission.allowed
              ? readinessFoundationEvidence(companyId, await foundationService(tx).list(companyId, owner.actor)) : [];
            const refs = evidence.map(item => {
              const match = /^foundation:\/\/([a-f0-9-]{36})\/([a-f0-9-]{36})$/i.exec(item.sourceRef);
              if (!match || item.sourceVersion !== match[2]) throw forbidden("Foundation readiness source is unavailable");
              return { documentId: match[1]!, revisionId: match[2]! };
            });
            await foundationService(tx).pinApprovedRevisions(companyId, refs, owner.actor);
            return { evidence, sourceHash: readinessEvidenceSourceHash(evidence) };
          };
          const initial = await readFoundation();
          const result = await persist(assembled, tx, initial.evidence, initial.sourceHash);
          const current = await readFoundation();
          if (current.sourceHash !== initial.sourceHash) throw conflict("Approved Foundation readiness evidence changed during assessment");
          return result;
        });
        if (!parentPublications) publish(publications);
        return row;
      }
      const assembled = await context.assemble(assemblyInput);
      return persist(assembled, db);
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
