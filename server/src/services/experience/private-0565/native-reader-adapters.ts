/** PRIVATE 0565 candidate: current responsibility readers backed by the
 * existing native domain services and source guards. This module performs no
 * mutations and creates no credential/session/effect actors. */
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  aiUseCases, aiUseCaseVersions, authUsers, businessExperiments, businessMetrics, companies, companyMemberships, decisions,
  agents, approvals, billingAccountCompanies, billingAccounts, companyAgentPackageInstallations,
  companySkillPolicies, humanWorkflowCoverages, issues, supportCases, toolApplications, toolConnections,
  toolPolicies, routines, workflowRuns, workflows,
} from "@paperclipai/db";
import type { AuthorizationAction, AuthorizationActor } from "../../authorization.js";
import { authorizationService, workflowRunReadSqlCondition } from "../../authorization.js";
import { workflowService } from "../../workflows/workflow-service.js";
import { agentService } from "../../agents.js";
import { approvalService } from "../../approvals.js";
import { toolAccessService } from "../../tool-access.js";
import { companySkillPolicyService } from "../../company-skill-policy.js";
import { aiGovernanceService } from "../../ai-governance/governance-service.js";
import { customerSupportCaseService } from "../support-cases.js";
import { assertV7Authorization } from "../../v7-authorization.js";
import { routineService } from "../../routines.js";
import { businessMetricService } from "../../business-metrics/service.js";
import { businessExperimentService } from "../../business-experiments/service.js";
import { canReadDecisionSource } from "../../decision-queues.js";
import { resolveCurrentDefaultResponsibleHuman } from "../../company-responsibility.js";
import { accessService } from "../../access.js";
import { assertV7Enabled } from "../../v7-authorization.js";
import { HttpError } from "../../../errors.js";
import { responsibilitySourceVersion } from "./native-metadata-sources.js";
import { responsibilityPolicySubject, canSubjectPerformNativeRead } from "./native-subject-policy.js";
import type { NativeResponsibilityReadPorts, ResponsibilityReadPort } from "./native-reader-ports.js";
import type { CurrentNativeResponsibility } from "./authorized-subset-reader.js";
import type { ResponsibilityScanKind } from "./responsibility-scan.js";

const hidden: CurrentNativeResponsibility = { state: "hidden" };
const missing: CurrentNativeResponsibility = { state: "missing" };
const stale: CurrentNativeResponsibility = { state: "stale" };
type ResponsibilityClassification = "MUST_REASSIGN" | "CAN_FALL_BACK_TO_AUTHORIZED_GROUP" | "CAN_BE_UNOWNED_TEMPORARILY";
function visible(sourceVersion: string, covered: boolean, classification?: ResponsibilityClassification): CurrentNativeResponsibility {
  return { state: "visible", currentSourceVersion: sourceVersion, coveredByAuthorizedHumanOrNativeGroup: covered,
    ...(classification ? { classification } : covered ? {} : { classification: "MUST_REASSIGN" as const }) };
}
const denied = (error: unknown) => error instanceof HttpError && [403, 404].includes(error.status);
const userActor = (userId: string) => responsibilityPolicySubject(userId);
function isBoardHuman(actor: AuthorizationActor): actor is AuthorizationActor & { type: "board"; userId: string } {
  return actor.type === "board" && Boolean(actor.userId) && actor.source !== "local_implicit";
}
async function currentCompanyAction(db: Db, actor: AuthorizationActor, companyId: string, action: AuthorizationAction) {
  if (actor.type !== "board" || !actor.userId) return false;
  return (await authorizationService(db).decide({ actor, action, resource: { type: "company", companyId } })).allowed;
}
async function subjectCovered(db: Db, companyId: string, ownerUserId: string | null, action: AuthorizationAction,
  sourceRead: (subject: AuthorizationActor) => Promise<boolean>) {
  const fallback = await resolveCurrentDefaultResponsibleHuman(db, companyId);
  for (const userId of [...new Set([ownerUserId, fallback].filter((id): id is string => Boolean(id)))]) {
    if (!await canSubjectPerformNativeRead({ db, companyId, userId, action, resource: { type: "company", companyId } })) continue;
    if (await sourceRead(userActor(userId))) return true;
  }
  return false;
}
function asPort(fn: ResponsibilityReadPort): ResponsibilityReadPort { return fn; }

export function nativeWorkflowResponsibilityReader(db: Db): ResponsibilityReadPort {
  return asPort(async (actor, companyId, id) => {
    if (!isBoardHuman(actor)) return hidden;
    const [row] = await db.select({ id: workflows.id, updatedAt: workflows.updatedAt, archivedAt: workflows.archivedAt })
      .from(workflows).where(and(eq(workflows.companyId, companyId), eq(workflows.id, id))).limit(1);
    if (!row || row.archivedAt) return missing;
    const sourceVersion = responsibilitySourceVersion("workflow", row.id, row.updatedAt);
    if (!await currentCompanyAction(db, actor, companyId, "workflows:read")) return hidden;
    try {
      if (!await workflowService(db).getDetail(companyId, id, actor)) return missing;
    } catch (error) { if (denied(error)) return hidden; throw error; }
    const covered = await subjectCovered(db, companyId, null, "workflows:edit", async subject => {
      try { return Boolean(await workflowService(db).getDetail(companyId, id, subject)); }
      catch (error) { if (denied(error)) return false; throw error; }
    });
    const [current] = await db.select({ updatedAt: workflows.updatedAt }).from(workflows)
      .where(and(eq(workflows.companyId, companyId), eq(workflows.id, id), isNull(workflows.archivedAt))).limit(1);
    if (!current) return missing;
    if (responsibilitySourceVersion("workflow", id, current.updatedAt) !== sourceVersion) return stale;
    return visible(sourceVersion, covered);
  });
}

export function nativeRoutineResponsibilityReader(db: Db): ResponsibilityReadPort {
  return asPort(async (actor, companyId, id) => {
    if (!isBoardHuman(actor) || !await canSubjectPerformNativeRead({ db, companyId, userId: actor.userId,
      action: "company_scope:read", resource: { type: "company", companyId } })) return hidden;
    const [row] = await db.select({ id: routines.id, companyId: routines.companyId, status: routines.status,
      responsibleUserId: routines.responsibleUserId, updatedAt: routines.updatedAt })
      .from(routines).where(and(eq(routines.companyId, companyId), eq(routines.id, id))).limit(1);
    if (!row || !["active", "paused"].includes(row.status)) return missing;
    const sourceVersion = responsibilitySourceVersion("routine", row.id, row.updatedAt);
    const readAs = async (subject: AuthorizationActor) => {
      try { return Boolean(await routineService(db, { sourceActor: subject }).get(id)); }
      catch (error) { if (denied(error)) return false; throw error; }
    };
    if (!await readAs(actor)) return hidden;
    const covered = await subjectCovered(db, companyId, row.responsibleUserId, "company_scope:read", readAs);
    return visible(sourceVersion, covered, !covered && row.status === "paused" ? "CAN_BE_UNOWNED_TEMPORARILY" : undefined);
  });
}

export function nativeMetricResponsibilityReader(db: Db): ResponsibilityReadPort {
  return asPort(async (actor, companyId, id) => {
    if (!isBoardHuman(actor)) return hidden;
    const [row] = await db.select({ id: businessMetrics.id, updatedAt: businessMetrics.updatedAt,
      status: businessMetrics.status, publishedVersionId: businessMetrics.publishedVersionId })
      .from(businessMetrics).where(and(eq(businessMetrics.companyId, companyId), eq(businessMetrics.id, id))).limit(1);
    if (!row || row.status !== "published" || !row.publishedVersionId) return missing;
    const sourceVersion = responsibilitySourceVersion("metric", row.id, row.updatedAt);
    const inspect = async (subject: AuthorizationActor) => {
      try { return await businessMetricService(db).inspectPublishedDefinition(companyId, subject, id, row.publishedVersionId!); }
      catch (error) { if (denied(error)) return null; throw error; }
    };
    const viewer = await inspect(actor);
    if (!viewer) return hidden;
    const canonicalOwner = viewer.version.definition.ownerUserId ?? null;
    const covered = await subjectCovered(db, companyId, canonicalOwner, "company_scope:read", async subject => Boolean(await inspect(subject)));
    const [current] = await db.select({ updatedAt: businessMetrics.updatedAt, publishedVersionId: businessMetrics.publishedVersionId,
      status: businessMetrics.status }).from(businessMetrics)
      .where(and(eq(businessMetrics.companyId, companyId), eq(businessMetrics.id, id))).limit(1);
    if (!current || current.status !== "published" || current.publishedVersionId !== row.publishedVersionId) return stale;
    if (responsibilitySourceVersion("metric", id, current.updatedAt) !== sourceVersion) return stale;
    return visible(sourceVersion, covered);
  });
}

export function nativeExperimentResponsibilityReader(db: Db): ResponsibilityReadPort {
  return asPort(async (actor, companyId, id) => {
    if (!isBoardHuman(actor)) return hidden;
    const [row] = await db.select({ id: businessExperiments.id, updatedAt: businessExperiments.updatedAt, state: businessExperiments.state })
      .from(businessExperiments).where(and(eq(businessExperiments.companyId, companyId), eq(businessExperiments.id, id))).limit(1);
    if (!row || !["in_review", "ready", "running", "paused", "analyzing"].includes(row.state)) return missing;
    const sourceVersion = responsibilitySourceVersion("experiment", row.id, row.updatedAt);
    const inspect = async (subject: AuthorizationActor) => {
      try { return await businessExperimentService(db).detail(companyId, subject, id); }
      catch (error) { if (denied(error)) return null; throw error; }
    };
    const viewer = await inspect(actor);
    if (!viewer) return hidden;
    const latest = viewer.versions[0];
    const ownerUserId = latest?.definition.ownerUserId ?? null;
    const covered = Boolean(latest && latest.currentQualification === "current") && await subjectCovered(db, companyId,
      ownerUserId, "company_scope:read", async subject => {
        const current = await inspect(subject);
        return Boolean(current?.versions[0]?.currentQualification === "current");
      });
    const [current] = await db.select({ updatedAt: businessExperiments.updatedAt, state: businessExperiments.state })
      .from(businessExperiments).where(and(eq(businessExperiments.companyId, companyId), eq(businessExperiments.id, id))).limit(1);
    if (!current || current.state !== row.state || responsibilitySourceVersion("experiment", id, current.updatedAt) !== sourceVersion) return stale;
    return visible(sourceVersion, covered, !covered && current.state === "paused" ? "CAN_BE_UNOWNED_TEMPORARILY" : undefined);
  });
}

export function nativeDecisionResponsibilityReader(db: Db): ResponsibilityReadPort {
  return asPort(async (actor, companyId, id) => {
    if (!isBoardHuman(actor) || !await currentCompanyAction(db, actor, companyId, "decision_queue:read")) return hidden;
    const [row] = await db.select({ id: decisions.id, updatedAt: decisions.updatedAt,
      status: decisions.status, expiresAt: decisions.expiresAt, responsibleUserId: issues.responsibleUserId })
      .from(decisions).innerJoin(issues, and(eq(issues.companyId, decisions.companyId), eq(issues.id, decisions.originIssueId)))
      .where(and(eq(decisions.companyId, companyId), eq(decisions.id, id))).limit(1);
    if (!row || row.status !== "open" || row.expiresAt <= new Date()) return missing;
    const sourceVersion = responsibilitySourceVersion("decision", row.id, row.updatedAt);
    if (!await canReadDecisionSource(db, actor, companyId, "decision", id)) return hidden;
    const canOwn = async (subject: AuthorizationActor) => await currentCompanyAction(db, subject, companyId, "decision_queue:read") &&
      await canReadDecisionSource(db, subject, companyId, "decision", id);
    const covered = await subjectCovered(db, companyId, row.responsibleUserId, "decision_queue:read", canOwn);
    const [current] = await db.select({ updatedAt: decisions.updatedAt, status: decisions.status, expiresAt: decisions.expiresAt })
      .from(decisions).where(and(eq(decisions.companyId, companyId), eq(decisions.id, id))).limit(1);
    if (!current || current.status !== "open" || current.expiresAt <= new Date() ||
      responsibilitySourceVersion("decision", id, current.updatedAt) !== sourceVersion) return stale;
    return visible(sourceVersion, covered);
  });
}

export function nativeAiUseCaseResponsibilityReader(db: Db): ResponsibilityReadPort {
  return asPort(async (actor, companyId, id) => {
    if (!isBoardHuman(actor)) return hidden;
    await assertV7Enabled(db, "ai_use_cases_v7");
    const [row] = await db.select({ id: aiUseCases.id, updatedAt: aiUseCases.updatedAt, ownerUserId: aiUseCases.ownerUserId,
      purposeVersion: aiUseCases.purposeVersion, status: aiUseCases.status })
      .from(aiUseCases).where(and(eq(aiUseCases.companyId, companyId), eq(aiUseCases.id, id))).limit(1);
    if (!row || row.status === "retired") return missing;
    const [version] = await db.select({ id: aiUseCaseVersions.id, createdAt: aiUseCaseVersions.createdAt })
      .from(aiUseCaseVersions).where(and(eq(aiUseCaseVersions.companyId, companyId), eq(aiUseCaseVersions.useCaseId, id),
        eq(aiUseCaseVersions.purposeVersion, row.purposeVersion))).limit(1);
    if (!version) return missing;
    const sourceVersion = responsibilitySourceVersion("ai_use_case", row.id, row.updatedAt);
    const inspect = async (subject: AuthorizationActor) => {
      try { return await aiGovernanceService(db).get(subject, companyId, id); }
      catch (error) { if (denied(error)) return null; throw error; }
    };
    const viewer = await inspect(actor);
    if (!viewer || viewer.useCase.id !== id) return hidden;
    const covered = await subjectCovered(db, companyId, row.ownerUserId, "company_scope:read", async subject => {
      const current = await inspect(subject);
      return Boolean(current?.useCase.id === id && current.useCase.purposeVersion === row.purposeVersion);
    });
    const [current] = await db.select({ updatedAt: aiUseCases.updatedAt, purposeVersion: aiUseCases.purposeVersion,
      status: aiUseCases.status }).from(aiUseCases).where(and(eq(aiUseCases.companyId, companyId), eq(aiUseCases.id, id))).limit(1);
    if (!current || current.purposeVersion !== row.purposeVersion || current.status === "retired" ||
      responsibilitySourceVersion("ai_use_case", id, current.updatedAt) !== sourceVersion) return stale;
    return visible(sourceVersion, covered);
  });
}

export function nativeWorkflowRunResponsibilityReader(db: Db): ResponsibilityReadPort {
  return asPort(async (actor, companyId, id) => {
    if (!isBoardHuman(actor) || !await currentCompanyAction(db, actor, companyId, "workflows:read")) return hidden;
    const [row] = await db.select({ id: workflowRuns.id, updatedAt: workflowRuns.updatedAt, status: workflowRuns.status,
      responsibleUserId: workflowRuns.responsibleUserId, workflowId: workflowRuns.workflowId,
      workflowRevisionId: workflowRuns.workflowRevisionId, humanCoverageId: workflowRuns.humanCoverageId,
      companyId: workflowRuns.companyId, sourceWorkflows: workflowRuns.authoringSourceWorkflowIds })
      .from(workflowRuns).where(and(eq(workflowRuns.companyId, companyId), eq(workflowRuns.id, id),
        inArray(workflowRuns.status, ["queued", "running", "waiting", "recovering", "cancelling"]))).limit(1);
    if (!row) return missing;
    const sourceVersion = responsibilitySourceVersion("workflow_run", row.id, row.updatedAt);
    const readRunAs = async (subject: AuthorizationActor) => {
      const [permitted] = await db.select({ id: workflowRuns.id }).from(workflowRuns).where(and(
        eq(workflowRuns.companyId, companyId), eq(workflowRuns.id, id), await workflowRunReadSqlCondition(db, subject),
      )).limit(1);
      if (!permitted) return false;
      const sourceWorkflowIds = [...new Set(row.sourceWorkflows ?? [])];
      if (sourceWorkflowIds.length > 32) throw new Error("workflow_run_source_budget_exceeded");
      try {
        if (!await workflowService(db).getDetail(companyId, row.workflowId, subject)) return false;
        if (!await workflowService(db).getRevision(companyId, row.workflowId, row.workflowRevisionId, subject)) return false;
        for (const sourceWorkflowId of sourceWorkflowIds) {
          if (!await workflowService(db).getDetail(companyId, sourceWorkflowId, subject)) return false;
        }
      } catch (error) { if (denied(error)) return false; throw error; }
      if (row.humanCoverageId && row.responsibleUserId === subject.userId) {
        const coverageId = row.humanCoverageId;
        try {
          const valid = await db.transaction(async raw => {
            const tx = raw as unknown as Db;
            const [coverage] = await tx.select({ scopeType: humanWorkflowCoverages.scopeType,
              taskId: humanWorkflowCoverages.taskId }).from(humanWorkflowCoverages)
              .where(and(eq(humanWorkflowCoverages.companyId, companyId),
                eq(humanWorkflowCoverages.id, coverageId))).limit(1);
            if (!coverage) return false;
            await accessService(tx).authorizeWorkflowCoverage({ tx: raw, companyId, coverageId,
              delegateeUserId: subject.userId!, workflowId: row.workflowId, workflowRevisionId: row.workflowRevisionId,
              scopeType: coverage.scopeType as "manual" | "task", taskId: coverage.taskId });
            return true;
          });
          if (!valid) return false;
        } catch (error) { if (denied(error)) return false; throw error; }
      }
      return true;
    };
    if (!await readRunAs(actor)) return hidden;
    const covered = await subjectCovered(db, companyId, row.responsibleUserId, "workflows:run", readRunAs);
    const [current] = await db.select({ updatedAt: workflowRuns.updatedAt, status: workflowRuns.status })
      .from(workflowRuns).where(and(eq(workflowRuns.companyId, companyId), eq(workflowRuns.id, id))).limit(1);
    if (!current || !["queued", "running", "waiting", "recovering", "cancelling"].includes(current.status) ||
      responsibilitySourceVersion("workflow_run", id, current.updatedAt) !== sourceVersion) return stale;
    return visible(sourceVersion, covered);
  });
}

/** Agent ownership has no Human owner column. Only the explicitly configured
 * company default can satisfy continuity, and only while it can configure this
 * exact Agent. The creator/installer/reporting manager are provenance. */
export function nativeAgentResponsibilityReader(db: Db): ResponsibilityReadPort {
  return asPort(async (actor, companyId, id) => {
    if (!isBoardHuman(actor)) return hidden;
    const row = await agentService(db).getById(id);
    if (!row || row.companyId !== companyId || ["terminated", "archived", "deleted"].includes(row.status)) return missing;
    if (!await currentCompanyAction(db, actor, companyId, "agent:read") ||
        !(await authorizationService(db).decide({ actor, action: "agents:configure", resource: { type: "agent", companyId, agentId: id } })).allowed)
      return hidden;
    const sourceVersion = responsibilitySourceVersion("agent", id, row.updatedAt);
    const covered = await subjectCovered(db, companyId, null, "agents:configure", async subject =>
      (await authorizationService(db).decide({ actor: subject, action: "agents:configure", resource: { type: "agent", companyId, agentId: id } })).allowed);
    const current = await agentService(db).getById(id);
    if (!current || current.companyId !== companyId || responsibilitySourceVersion("agent", id, current.updatedAt) !== sourceVersion) return stale;
    return visible(sourceVersion, covered, !covered && current.status === "paused" ? "CAN_BE_UNOWNED_TEMPORARILY" : undefined);
  });
}

/** Deployment reads are bounded by the native Agent Package owner, then the
 * referenced AI Use Case's canonical owner or explicit company default. */
export function nativeDeploymentResponsibilityReader(db: Db): ResponsibilityReadPort {
  return asPort(async (actor, companyId, id) => {
    if (!isBoardHuman(actor)) return hidden;
    const [row] = await db.select({ id: companyAgentPackageInstallations.id, agentId: companyAgentPackageInstallations.agentId,
      aiUseCaseId: companyAgentPackageInstallations.aiUseCaseId, status: companyAgentPackageInstallations.status,
      updatedAt: companyAgentPackageInstallations.updatedAt }).from(companyAgentPackageInstallations)
      .where(and(eq(companyAgentPackageInstallations.companyId, companyId), eq(companyAgentPackageInstallations.id, id))).limit(1);
    if (!row || !["active", "readiness_blocked", "degraded", "needs_update"].includes(row.status)) return missing;
    const readAs = async (subject: AuthorizationActor) => {
      try {
        await assertV7Authorization(db, subject, companyId, "company_scope:read");
        await assertV7Authorization(db, subject, companyId, "agents:configure", { type: "agent", companyId, agentId: row.agentId });
        if (row.aiUseCaseId) await aiGovernanceService(db).get(subject, companyId, row.aiUseCaseId);
        const agent = await agentService(db).getById(row.agentId);
        return Boolean(agent && agent.companyId === companyId && agent.status !== "terminated");
      } catch (error) { if (denied(error)) return false; throw error; }
    };
    if (!await readAs(actor)) return hidden;
    const [useCase] = row.aiUseCaseId ? await db.select({ ownerUserId: aiUseCases.ownerUserId, status: aiUseCases.status })
      .from(aiUseCases).where(and(eq(aiUseCases.companyId, companyId), eq(aiUseCases.id, row.aiUseCaseId))).limit(1) : [];
    const sourceVersion = responsibilitySourceVersion("deployment", id, row.updatedAt);
    const covered = useCase?.status !== "retired" && await subjectCovered(db, companyId, useCase?.ownerUserId ?? null,
      "agents:configure", readAs);
    const [current] = await db.select({ updatedAt: companyAgentPackageInstallations.updatedAt, status: companyAgentPackageInstallations.status,
      aiUseCaseId: companyAgentPackageInstallations.aiUseCaseId }).from(companyAgentPackageInstallations)
      .where(and(eq(companyAgentPackageInstallations.companyId, companyId), eq(companyAgentPackageInstallations.id, id))).limit(1);
    if (!current || current.status !== row.status || current.aiUseCaseId !== row.aiUseCaseId ||
        responsibilitySourceVersion("deployment", id, current.updatedAt) !== sourceVersion) return stale;
    return visible(sourceVersion, Boolean(covered));
  });
}

/** Connector access follows the current connection manager policy and native
 * getter. Creator and credential subjects are never treated as owners. */
export function nativeConnectorResponsibilityReader(db: Db): ResponsibilityReadPort {
  return asPort(async (actor, companyId, id) => {
    if (!isBoardHuman(actor)) return hidden;
    const [row] = await db.select({ id: toolConnections.id, applicationId: toolConnections.applicationId, status: toolConnections.status,
      enabled: toolConnections.enabled, updatedAt: toolConnections.updatedAt, ownerUserId: toolApplications.ownerUserId })
      .from(toolConnections).innerJoin(toolApplications, and(eq(toolApplications.companyId, toolConnections.companyId),
        eq(toolApplications.id, toolConnections.applicationId)))
      .where(and(eq(toolConnections.companyId, companyId), eq(toolConnections.id, id))).limit(1);
    if (!row || row.status !== "active" || !row.enabled) return missing;
    const readAs = async (subject: AuthorizationActor) => {
      try {
        if (!(await authorizationService(db).decide({ actor: subject, action: "tools:manage_connections", resource: { type: "company", companyId } })).allowed) return false;
        await toolAccessService(db).getConnection(id, companyId, subject.userId ?? undefined);
        return true;
      } catch (error) { if (denied(error)) return false; throw error; }
    };
    if (!await readAs(actor)) return hidden;
    const sourceVersion = responsibilitySourceVersion("connector", id, row.updatedAt);
    const covered = await subjectCovered(db, companyId, row.ownerUserId, "tools:manage_connections", readAs);
    const [current] = await db.select({ updatedAt: toolConnections.updatedAt, status: toolConnections.status,
      enabled: toolConnections.enabled }).from(toolConnections).where(and(eq(toolConnections.companyId, companyId), eq(toolConnections.id, id))).limit(1);
    if (!current || current.status !== "active" || !current.enabled || responsibilitySourceVersion("connector", id, current.updatedAt) !== sourceVersion) return stale;
    return visible(sourceVersion, covered);
  });
}

/** Pending approvals have no assigned reviewer column. Requester and decider
 * are provenance; only the current company's explicit default can provide the
 * general review path. The native route admits current company readers. */
export function nativeApprovalResponsibilityReader(db: Db): ResponsibilityReadPort {
  return asPort(async (actor, companyId, id) => {
    if (!isBoardHuman(actor)) return hidden;
    const row = await approvalService(db).getById(id);
    if (!row || row.companyId !== companyId || !["pending", "revision_requested"].includes(row.status)) return missing;
    if (!await currentCompanyAction(db, actor, companyId, "company_scope:read")) return hidden;
    const sourceVersion = responsibilitySourceVersion("approval", id, row.updatedAt);
    const covered = await subjectCovered(db, companyId, null, "company_scope:read", async subject =>
      currentCompanyAction(db, subject, companyId, "company_scope:read"));
    const current = await approvalService(db).getById(id);
    if (!current || current.companyId !== companyId || current.status !== row.status ||
        responsibilitySourceVersion("approval", id, current.updatedAt) !== sourceVersion) return stale;
    return visible(sourceVersion, covered);
  });
}

export function nativeToolPolicyResponsibilityReader(db: Db): ResponsibilityReadPort {
  return asPort(async (actor, companyId, id) => {
    if (!isBoardHuman(actor)) return hidden;
    const [row] = await db.select({ id: toolPolicies.id, enabled: toolPolicies.enabled, updatedAt: toolPolicies.updatedAt })
      .from(toolPolicies).where(and(eq(toolPolicies.companyId, companyId), eq(toolPolicies.id, id))).limit(1);
    if (!row || !row.enabled) return missing;
    const readAs = (subject: AuthorizationActor) => currentCompanyAction(db, subject, companyId, "tools:manage_profiles");
    if (!await readAs(actor)) return hidden;
    const sourceVersion = responsibilitySourceVersion("tool_policy", id, row.updatedAt);
    const covered = await subjectCovered(db, companyId, null, "tools:manage_profiles", readAs);
    const [current] = await db.select({ updatedAt: toolPolicies.updatedAt, enabled: toolPolicies.enabled }).from(toolPolicies)
      .where(and(eq(toolPolicies.companyId, companyId), eq(toolPolicies.id, id))).limit(1);
    if (!current || !current.enabled || responsibilitySourceVersion("tool_policy", id, current.updatedAt) !== sourceVersion) return stale;
    return visible(sourceVersion, covered);
  });
}

export function nativeSkillPolicyResponsibilityReader(db: Db): ResponsibilityReadPort {
  return asPort(async (actor, companyId, id) => {
    if (!isBoardHuman(actor) || id !== companyId) return hidden;
    const [row] = await db.select({ companyId: companySkillPolicies.companyId, updatedAt: companySkillPolicies.updatedAt })
      .from(companySkillPolicies).where(eq(companySkillPolicies.companyId, companyId)).limit(1);
    if (!row) return missing;
    const readAs = async (subject: AuthorizationActor) => {
      try {
        if (!await currentCompanyAction(db, subject, companyId, "skill_config:update")) return false;
        await companySkillPolicyService(db).get(companyId);
        return true;
      } catch (error) { if (denied(error)) return false; throw error; }
    };
    if (!await readAs(actor)) return hidden;
    const sourceVersion = responsibilitySourceVersion("skill_policy", id, row.updatedAt);
    const covered = await subjectCovered(db, companyId, null, "skill_config:update", readAs);
    const [current] = await db.select({ updatedAt: companySkillPolicies.updatedAt }).from(companySkillPolicies)
      .where(eq(companySkillPolicies.companyId, companyId)).limit(1);
    if (!current || responsibilitySourceVersion("skill_policy", id, current.updatedAt) !== sourceVersion) return stale;
    return visible(sourceVersion, covered);
  });
}

export function nativeBillingResponsibilityReader(db: Db): ResponsibilityReadPort {
  return asPort(async (actor, companyId, id) => {
    if (!isBoardHuman(actor)) return hidden;
    const [row] = await db.select({ id: billingAccounts.id, payerUserId: billingAccounts.payerUserId,
      status: billingAccounts.status, closedAt: billingAccounts.closedAt, updatedAt: billingAccounts.updatedAt })
      .from(billingAccountCompanies).innerJoin(billingAccounts, eq(billingAccounts.id, billingAccountCompanies.billingAccountId))
      .where(and(eq(billingAccountCompanies.companyId, companyId), eq(billingAccountCompanies.status, "active"), eq(billingAccounts.id, id))).limit(1);
    if (!row || row.status !== "active" || row.closedAt) return missing;
    const readAs = (subject: AuthorizationActor) => currentCompanyAction(db, subject, companyId, "billing:view");
    if (!await readAs(actor)) return hidden;
    const sourceVersion = responsibilitySourceVersion("billing", id, row.updatedAt);
    const covered = await subjectCovered(db, companyId, row.payerUserId, "billing:manage", async subject =>
      await readAs(subject) && currentCompanyAction(db, subject, companyId, "billing:manage"));
    const [current] = await db.select({ updatedAt: billingAccounts.updatedAt, status: billingAccounts.status,
      closedAt: billingAccounts.closedAt }).from(billingAccounts).innerJoin(billingAccountCompanies,
      and(eq(billingAccountCompanies.billingAccountId, billingAccounts.id), eq(billingAccountCompanies.companyId, companyId),
        eq(billingAccountCompanies.status, "active"))).where(eq(billingAccounts.id, id)).limit(1);
    if (!current || current.status !== "active" || current.closedAt || responsibilitySourceVersion("billing", id, current.updatedAt) !== sourceVersion) return stale;
    return visible(sourceVersion, covered);
  });
}

/** Tenant Support cases are visible only through the native authenticated
 * customer getter. The case opener is never elevated into a Support responder. */
export function nativeSupportCaseResponsibilityReader(db: Db, configuredOperatorUserIds: readonly string[] = []): ResponsibilityReadPort {
  return asPort(async (actor, companyId, id) => {
    if (!isBoardHuman(actor)) return hidden;
    const [row] = await db.select({ id: supportCases.id, openedByUserId: supportCases.openedByUserId,
      updatedAt: supportCases.updatedAt, customerStatus: supportCases.customerStatus })
      .from(supportCases).where(and(eq(supportCases.companyId, companyId), eq(supportCases.id, id))).limit(1);
    if (!row || !["RECEIVED", "INVESTIGATING", "WORKING_ON_IT", "WAITING_FOR_YOU"].includes(row.customerStatus)) return missing;
    try {
      await customerSupportCaseService(db, { dataPolicy: null }).get(actor, companyId, id, { expectedUserId: actor.userId });
    } catch (error) { if (denied(error)) return hidden; throw error; }
    const sourceVersion = responsibilitySourceVersion("support_case", id, row.updatedAt);
    const [current] = await db.select({ updatedAt: supportCases.updatedAt, customerStatus: supportCases.customerStatus })
      .from(supportCases).where(and(eq(supportCases.companyId, companyId), eq(supportCases.id, id))).limit(1);
    if (!current || !["RECEIVED", "INVESTIGATING", "WORKING_ON_IT", "WAITING_FOR_YOU"].includes(current.customerStatus) ||
        responsibilitySourceVersion("support_case", id, current.updatedAt) !== sourceVersion) return stale;
    const activeOperatorIds = [...new Set(configuredOperatorUserIds.filter(Boolean))];
    const [operator] = activeOperatorIds.length ? await db.select({ id: authUsers.id }).from(authUsers)
      .where(and(inArray(authUsers.id, activeOperatorIds), eq(authUsers.emailVerified, true))).limit(1) : [];
    // This is only configured-group continuity. Any operator's current
    // authentication/assurance and exact case effect permission are rechecked
    // by the Support service when an operation is attempted.
    if (!operator) return hidden;
    return visible(sourceVersion, true, "CAN_FALL_BACK_TO_AUTHORIZED_GROUP");
  });
}

/** Contact source is the canonical company settings row. Visibility is limited
 * to current company access managers. Contact labels are valid only while they
 * point to an active, verified same-company Human; no permission is inferred. */
function nativeCompanyContactResponsibilityReader(db: Db, kind: "security_contact" | "support_incident_contact"): ResponsibilityReadPort {
  const column = kind === "security_contact" ? companies.securityContactUserId : companies.supportIncidentContactUserId;
  return asPort(async (actor, companyId, id) => {
    if (!isBoardHuman(actor) || id !== companyId ||
        !await currentCompanyAction(db, actor, companyId, "company_scope:read") ||
        !await currentCompanyAction(db, actor, companyId, "users:manage_permissions")) return hidden;
    const [row] = await db.select({ id: companies.id, updatedAt: companies.updatedAt, contactUserId: column })
      .from(companies).where(eq(companies.id, companyId)).limit(1);
    if (!row) return missing;
    const sourceVersion = responsibilitySourceVersion(kind, row.id, row.updatedAt);
    let covered = false;
    if (row.contactUserId) {
      const [valid] = await db.select({ id: companyMemberships.id }).from(companyMemberships)
        .innerJoin(authUsers, eq(authUsers.id, companyMemberships.principalId))
        .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, row.contactUserId), eq(companyMemberships.status, "active"),
          eq(authUsers.emailVerified, true))).limit(1);
      covered = Boolean(valid);
    }
    const [current] = await db.select({ updatedAt: companies.updatedAt, contactUserId: column })
      .from(companies).where(eq(companies.id, companyId)).limit(1);
    if (!current || current.contactUserId !== row.contactUserId ||
        responsibilitySourceVersion(kind, id, current.updatedAt) !== sourceVersion) return stale;
    return visible(sourceVersion, covered);
  });
}

/** All current reads are supplied by native owners. */
export function bindKnownNativeResponsibilityPorts(db: Db, configuredOperatorUserIds: readonly string[] = []): NativeResponsibilityReadPorts {
  const supportCases = nativeSupportCaseResponsibilityReader(db, configuredOperatorUserIds);
  return { agent: nativeAgentResponsibilityReader(db), deployment: nativeDeploymentResponsibilityReader(db),
    connector: nativeConnectorResponsibilityReader(db), approval: nativeApprovalResponsibilityReader(db),
    tool_policy: nativeToolPolicyResponsibilityReader(db), skill_policy: nativeSkillPolicyResponsibilityReader(db),
    billing: nativeBillingResponsibilityReader(db), security_contact: nativeCompanyContactResponsibilityReader(db, "security_contact"),
    support_incident_contact: nativeCompanyContactResponsibilityReader(db, "support_incident_contact"), support_case: supportCases,
    workflow: nativeWorkflowResponsibilityReader(db), routine: nativeRoutineResponsibilityReader(db),
    metric: nativeMetricResponsibilityReader(db), experiment: nativeExperimentResponsibilityReader(db),
    decision: nativeDecisionResponsibilityReader(db), ai_use_case: nativeAiUseCaseResponsibilityReader(db),
    workflow_run: nativeWorkflowRunResponsibilityReader(db) };
}
