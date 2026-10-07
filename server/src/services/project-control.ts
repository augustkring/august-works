import { lockMemoryPrivacy } from "./memory/memory-privacy.js";
import { lockAnalyticalCompany } from "./analytical-privacy.js";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { agents, approvals, companyMemberships, goals, issues, issueApprovals, issueRelations, projects, projectMilestones, projectRoadmapProposals, projectScheduleBaselines, type Db } from "@paperclipai/db";
import { updateMilestoneSchema, createMilestoneSchema, roadmapPolicySchema, roadmapProposalSchema, taskForecastPatchSchema, type ProjectRoadmap, type RoadmapTask } from "@paperclipai/shared";
import type { z } from "zod";
import { conflict, forbidden, notFound, unprocessable } from "../errors.js";
import { authorizationService, type AuthorizationActor } from "./authorization.js";
import { assertV5Authorization, assertV5Enabled, v5HumanActorId } from "./v5-authorization.js";
import { withV5ActivityTransaction } from "./v5-mutations.js";
import { logActivity, type ActivityPublication } from "./activity-log.js";

import { budgetService } from "./budgets.js";
import { roadmapHealth } from "./project-health.js";
export { roadmapHealth } from "./project-health.js";

const dayMs = 86_400_000;
const iso = (value: Date | null) => value?.toISOString() ?? null;
export function projectControlService(db: Db) {
  async function project(tx: Db, actor: AuthorizationActor, companyId: string, projectId: string, lock = false) {
    await assertV5Enabled(tx, "project_roadmap_v5");
    await assertV5Authorization(tx, actor, companyId, "project:read", { type: "project", companyId, projectId });
    const query = tx.select().from(projects).where(and(eq(projects.companyId, companyId), eq(projects.id, projectId))).limit(1);
    const [row] = await (lock ? query.for("update") : query); if (!row || row.archivedAt) throw notFound("Project not found"); return row;
  }
  async function task(tx: Db, actor: AuthorizationActor, companyId: string, projectId: string, id: string, expectedUpdatedAt: string) {
    const [row] = await tx.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.projectId, projectId), eq(issues.id, id), isNull(issues.hiddenAt))).limit(1).for("update");
    if (!row) throw notFound("Project task not found");
    await assertV5Authorization(tx, actor, companyId, "issue:mutate", { type: "issue", companyId, projectId, issueId: id, parentIssueId: row.parentId, assigneeAgentId: row.assigneeAgentId, assigneeUserId: row.assigneeUserId, status: row.status });
    if (row.updatedAt.toISOString() !== expectedUpdatedAt) throw conflict("Task changed; refresh the plan before applying"); return row;
  }
  async function read(tx: Db, actor: AuthorizationActor, companyId: string, projectId: string): Promise<ProjectRoadmap> {
    const row = await project(tx, actor, companyId, projectId);
    const candidates = await tx.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.projectId, projectId), isNull(issues.hiddenAt))).orderBy(asc(issues.createdAt), asc(issues.id)).limit(501);
    if (candidates.length > 500) throw conflict("Roadmap exceeds 500 tasks; split the project before opening this bounded view");
    const tasks: RoadmapTask[] = [];
    for (const item of candidates) {
      if (item.harnessKind === "conversation") continue;
      const access = await authorizationService(tx).decide({ actor, action: "issue:read", resource: { type: "issue", companyId, projectId, issueId: item.id }, enforceResponsibleUserIntersection: true });
      if (!access.allowed) continue;
      tasks.push({ id: item.id, title: item.title, identifier: item.identifier, status: item.status, priority: item.priority, updatedAt: item.updatedAt.toISOString(), assigneeAgentId: item.assigneeAgentId, assigneeUserId: item.assigneeUserId, milestoneId: item.milestoneId, plannedStartAt: iso(item.plannedStartAt), plannedEndAt: iso(item.plannedEndAt), forecastStartAt: iso(item.forecastStartAt), forecastEndAt: iso(item.forecastEndAt), forecastConfidence: item.forecastConfidence, forecastReason: item.forecastReason, startedAt: iso(item.startedAt), completedAt: iso(item.completedAt), estimatedEffortMinutes: item.estimatedEffortMinutes });
    }
    const ids = tasks.map((t) => t.id), edges = ids.length ? await tx.select().from(issueRelations).where(and(eq(issueRelations.companyId, companyId), inArray(issueRelations.issueId, ids), inArray(issueRelations.relatedIssueId, ids), eq(issueRelations.type, "blocks"))).limit(5001) : [];
    if (edges.length > 5000) throw conflict("Dependency graph exceeds the roadmap edge budget");
    const milestones = (await tx.select().from(projectMilestones).where(and(eq(projectMilestones.companyId, companyId), eq(projectMilestones.projectId, projectId))).orderBy(asc(projectMilestones.sortOrder), asc(projectMilestones.id)).limit(500)).map((m) => ({ id: m.id, name: m.name, description: m.description, status: m.status as ProjectRoadmap["milestones"][number]["status"], targetDate: m.targetDate, plannedStartAt: iso(m.plannedStartAt), plannedEndAt: iso(m.plannedEndAt), completedAt: iso(m.completedAt), updatedAt: m.updatedAt.toISOString() }));
    const allowedIds = new Set(ids);
    const baselines = (await tx.select().from(projectScheduleBaselines).where(and(eq(projectScheduleBaselines.companyId, companyId), eq(projectScheduleBaselines.projectId, projectId))).orderBy(desc(projectScheduleBaselines.createdAt)).limit(50)).map((b) => ({ id: b.id, name: b.name, createdAt: b.createdAt.toISOString(), snapshot: { tasks: b.snapshot.tasks.filter((t) => allowedIds.has(t.id)), milestones: b.snapshot.milestones, dependencies: b.snapshot.dependencies.filter((e) => allowedIds.has(e.issueId) && allowedIds.has(e.relatedIssueId)) } }));
    // Analytical proposals can inherit source authority outside the task list.
    // Their governed owner admits source prose; the V5 view cannot project it.
    const proposals = (await tx.select().from(projectRoadmapProposals).where(and(eq(projectRoadmapProposals.companyId, companyId), eq(projectRoadmapProposals.projectId, projectId), isNull(projectRoadmapProposals.planningManifestId))).orderBy(desc(projectRoadmapProposals.createdAt)).limit(100)).filter((p) => p.patch.changes.every((c) => allowedIds.has(c.issueId))).map((p) => ({ id: p.id, reason: p.reason, risk: p.risk, status: p.status, patch: p.patch, createdAt: p.createdAt.toISOString() }));
    const waitingApprovals = ids.length ? await tx.select({ issueId: issueApprovals.issueId }).from(issueApprovals)
      .innerJoin(approvals, and(eq(approvals.companyId, companyId), eq(approvals.id, issueApprovals.approvalId), eq(approvals.status, "pending")))
      .where(and(eq(issueApprovals.companyId, companyId), inArray(issueApprovals.issueId, ids))).limit(5001) : [];
    if (waitingApprovals.length > 5000) throw conflict("Approval observations exceed the roadmap budget");
    const budgetAccess = await authorizationService(tx).decide({ actor, action: "users:manage_permissions", resource: { type: "company", companyId }, enforceResponsibleUserIntersection: true });
    const budgets = budgetAccess.allowed ? await budgetService(tx).projectSummary(companyId, projectId) : null;
    return { companyId, projectId, projectName: row.name, projectUpdatedAt: row.updatedAt.toISOString(), policy: roadmapPolicySchema.parse(row.roadmapPolicy ?? {}), tasks, milestones, dependencies: edges.map((e) => ({ id: e.id, issueId: e.issueId, relatedIssueId: e.relatedIssueId })), baselines, proposals, health: roadmapHealth(tasks, new Date(), { dependencies: edges, milestones, waitingApprovalTaskIds: waitingApprovals.map((item) => item.issueId), budgets }) };
  }
  async function inspectChanges(tx: Db, actor: AuthorizationActor, companyId: string, projectId: string, input: z.infer<typeof roadmapProposalSchema>, policy: z.infer<typeof roadmapPolicySchema>) {
    if (policy.fieldOwnership.plannedDates !== "internal") throw conflict("Planned dates are owned by the configured external system");
    const prepared = []; let risk = "low";
    for (const change of [...input.changes].sort((a, b) => a.issueId.localeCompare(b.issueId))) {
      const row = await task(tx, actor, companyId, projectId, change.issueId, change.expectedUpdatedAt), patch = change.patch;
      const start = patch.plannedStartAt === undefined ? row.plannedStartAt : patch.plannedStartAt ? new Date(patch.plannedStartAt) : null;
      const end = patch.plannedEndAt === undefined ? row.plannedEndAt : patch.plannedEndAt ? new Date(patch.plannedEndAt) : null;
      if (start && end && end < start) throw unprocessable("Planned end must not precede planned start");
      if (patch.milestoneId && !(await tx.select().from(projectMilestones).where(and(eq(projectMilestones.companyId, companyId), eq(projectMilestones.projectId, projectId), eq(projectMilestones.id, patch.milestoneId))).limit(1))[0]) throw unprocessable("Milestone must belong to this company/project");
      if (patch.milestoneId !== undefined && patch.milestoneId !== row.milestoneId) risk = "high";
      for (const [before, after] of [[row.plannedStartAt, start], [row.plannedEndAt, end]]) if ((before === null) !== (after === null) || before && after && Math.abs(after.getTime() - before.getTime()) > policy.scheduleToleranceDays * dayMs) risk = "high";
      if (row.milestoneId && end && row.plannedEndAt && end > row.plannedEndAt) risk = "high";
      prepared.push({ row, patch: { milestoneId: patch.milestoneId, estimatedEffortMinutes: patch.estimatedEffortMinutes, plannedStartAt: patch.plannedStartAt === undefined ? undefined : start, plannedEndAt: patch.plannedEndAt === undefined ? undefined : end } });
    }
    return { prepared, risk };
  }
  return {
    get: (actor: AuthorizationActor, companyId: string, projectId: string) => read(db, actor, companyId, projectId),
    policy: async (actor: AuthorizationActor, companyId: string, projectId: string, raw: z.infer<typeof roadmapPolicySchema>) => {
      v5HumanActorId(actor); await assertV5Authorization(db, actor, companyId, "users:manage_permissions"); const policy = roadmapPolicySchema.parse(raw);
      return withV5ActivityTransaction(db, async (tx, publications) => { await project(tx, actor, companyId, projectId, true); await tx.update(projects).set({ roadmapPolicy: policy, updatedAt: new Date() }).where(eq(projects.id, projectId)); await logActivity(tx, { companyId, actorType: "user", actorId: v5HumanActorId(actor), action: "project.roadmap_policy_updated", entityType: "project", entityId: projectId }, publications); return policy; });
    },
    createMilestone: async (actor: AuthorizationActor, companyId: string, projectId: string, raw: z.infer<typeof createMilestoneSchema>) => {
      const userId = v5HumanActorId(actor), input = createMilestoneSchema.parse(raw);
      await assertV5Authorization(db, actor, companyId, "tasks:assign", { type: "project", companyId, projectId });
      return withV5ActivityTransaction(db, async (tx, publications) => {
        const currentProject = await project(tx, actor, companyId, projectId, true), ownership = roadmapPolicySchema.parse(currentProject.roadmapPolicy ?? {}).fieldOwnership;
        if (ownership.plannedDates !== "internal" && (input.targetDate || input.plannedStartAt || input.plannedEndAt)) throw conflict("The external source owns milestone planning dates");
        if (input.goalId && !(await tx.select().from(goals).where(and(eq(goals.companyId, companyId), eq(goals.id, input.goalId))).limit(1))[0]) throw unprocessable("Milestone goal must belong to the company");
        if (input.ownerAgentId && !(await tx.select().from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, input.ownerAgentId))).limit(1))[0]) throw unprocessable("Milestone agent owner must belong to the company");
        if (input.ownerUserId && !(await tx.select().from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, input.ownerUserId), eq(companyMemberships.status, "active"))).limit(1))[0]) throw unprocessable("Milestone human owner must be an active company member");
        const [milestone] = await tx.insert(projectMilestones).values({ ...input, companyId, projectId, plannedStartAt: input.plannedStartAt ? new Date(input.plannedStartAt) : null, plannedEndAt: input.plannedEndAt ? new Date(input.plannedEndAt) : null }).returning();
        await tx.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
        await logActivity(tx, { companyId, actorType: "user", actorId: userId, action: "project.milestone_created", entityType: "project", entityId: projectId, details: { milestoneId: milestone!.id } }, publications); return milestone!;
      });
    },
    updateMilestone: async (actor: AuthorizationActor, companyId: string, projectId: string, milestoneId: string, raw: z.infer<typeof updateMilestoneSchema>) => {
      const userId = v5HumanActorId(actor), input = updateMilestoneSchema.parse(raw);
      await assertV5Authorization(db, actor, companyId, "tasks:assign", { type: "project", companyId, projectId });
      return withV5ActivityTransaction(db, async (tx, publications) => {
        const currentProject = await project(tx, actor, companyId, projectId, true), policy = roadmapPolicySchema.parse(currentProject.roadmapPolicy ?? {});
        const [current] = await tx.select().from(projectMilestones).where(and(eq(projectMilestones.companyId, companyId), eq(projectMilestones.projectId, projectId), eq(projectMilestones.id, milestoneId))).limit(1).for("update");
        if (!current) throw notFound("Milestone not found");
        if (current.updatedAt.toISOString() !== input.expectedUpdatedAt) throw conflict("Milestone changed; refresh before saving");
        if (policy.fieldOwnership.plannedDates !== "internal" && ["plannedStartAt", "plannedEndAt", "targetDate"].some((key) => key in input) || policy.fieldOwnership.status !== "internal" && input.status !== undefined && input.status !== current.status) throw conflict("The external source owns these milestone fields");
        const start = input.plannedStartAt === undefined ? current.plannedStartAt : input.plannedStartAt ? new Date(input.plannedStartAt) : null, end = input.plannedEndAt === undefined ? current.plannedEndAt : input.plannedEndAt ? new Date(input.plannedEndAt) : null;
        if (start && end && end < start) throw unprocessable("Milestone end cannot precede start");
        const { expectedUpdatedAt: _expected, ...patch } = input;
        const [updated] = await tx.update(projectMilestones).set({ ...patch, plannedStartAt: start, plannedEndAt: end, ...(input.status !== undefined ? { completedAt: input.status === "completed" ? current.status === "completed" ? current.completedAt : new Date() : null } : {}), updatedAt: new Date() }).where(eq(projectMilestones.id, milestoneId)).returning();
        await tx.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
        await logActivity(tx, { companyId, actorType: "user", actorId: userId, action: "project.milestone_updated", entityType: "project", entityId: projectId, details: { milestoneId, previousStatus: current.status, status: updated!.status, previousUpdatedAt: current.updatedAt.toISOString() } }, publications);
        return updated!;
      });
    },
    baseline: async (actor: AuthorizationActor, companyId: string, projectId: string, name: string) => {
      const userId = v5HumanActorId(actor); if (!name.trim() || name.length > 200) throw unprocessable("Baseline name must contain 1–200 characters");
      await assertV5Authorization(db, actor, companyId, "tasks:assign", { type: "project", companyId, projectId });
      return withV5ActivityTransaction(db, async (tx, publications) => { await project(tx, actor, companyId, projectId, true); const current = await read(tx, actor, companyId, projectId); const [baseline] = await tx.insert(projectScheduleBaselines).values({ companyId, projectId, name: name.trim(), createdByUserId: userId, snapshot: { tasks: current.tasks, milestones: current.milestones, dependencies: current.dependencies } }).returning(); await logActivity(tx, { companyId, actorType: "user", actorId: userId, action: "project.schedule_baseline_created", entityType: "project", entityId: projectId, details: { baselineId: baseline!.id, name: name.trim() } }, publications); return baseline!; });
    },
    propose: async (actor: AuthorizationActor, companyId: string, projectId: string, raw: z.infer<typeof roadmapProposalSchema>, parentPublications?: ActivityPublication[]) => {
      const input = roadmapProposalSchema.parse(raw);
      return withV5ActivityTransaction(db, async (tx, publications) => {
        const row = await project(tx, actor, companyId, projectId, true), policy = roadmapPolicySchema.parse(row.roadmapPolicy ?? {});
        if (row.updatedAt.toISOString() !== input.expectedProjectUpdatedAt) throw conflict("Project changed; refresh before proposing");
        const inspected = await inspectChanges(tx, actor, companyId, projectId, input, policy);
        const autoApply = actor.type === "agent" && policy.allowLowRiskAgentScheduleUpdates && inspected.risk === "low";
        const [proposal] = await tx.insert(projectRoadmapProposals).values({ companyId, projectId, patch: input, reason: input.reason, risk: inspected.risk, status: autoApply ? "accepted" : "pending", createdByAgentId: actor.type === "agent" ? actor.agentId : null, createdByUserId: actor.type === "board" ? v5HumanActorId(actor) : null }).returning();
        if (autoApply) { for (const change of inspected.prepared) await tx.update(issues).set({ ...change.patch, updatedAt: new Date() }).where(eq(issues.id, change.row.id)); await tx.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId)); }
        await logActivity(tx, { companyId, actorType: actor.type === "agent" ? "agent" : "user", actorId: actor.agentId ?? v5HumanActorId(actor), action: autoApply ? "project.low_risk_plan_applied" : "project.roadmap_proposed", entityType: "project", entityId: projectId, details: { proposalId: proposal!.id, risk: inspected.risk, changedTaskIds: input.changes.map((c) => c.issueId) } }, publications); return proposal!;
      }, parentPublications);
    },
    review: async (actor: AuthorizationActor, companyId: string, projectId: string, proposalId: string, accept: boolean, rationale: string) => {
      const userId = v5HumanActorId(actor); if (rationale.trim().length < 10 || rationale.length > 4000) throw unprocessable("Review rationale must contain 10–4000 characters");
      if (accept) {
        const { workSignalService } = await import("./work-signals/work-signal-service.js");
        await workSignalService(db).validateProposal(actor, companyId, proposalId);
      }
      return withV5ActivityTransaction(db, async (tx, publications) => {
        await lockAnalyticalCompany(tx, companyId);
        await lockMemoryPrivacy(tx, companyId);
        if (accept) {
          const { inspectCurrentProjectPlanningProposal } = await import("./adaptive-planning/project-owner.js");
          await inspectCurrentProjectPlanningProposal(tx, actor, companyId, projectId, proposalId);
          const { workSignalService } = await import("./work-signals/work-signal-service.js");
          await workSignalService(db).pinProposalSource(tx, actor, companyId, proposalId);
        }
        // Rejecting or marking a proposal stale also mutates project governance.
        // Require the same planning authority before every decision branch.
        await assertV5Authorization(tx, actor, companyId, "tasks:assign", { type: "project", companyId, projectId });
        const row = await project(tx, actor, companyId, projectId, true), [proposal] = await tx.select().from(projectRoadmapProposals).where(and(eq(projectRoadmapProposals.companyId, companyId), eq(projectRoadmapProposals.projectId, projectId), eq(projectRoadmapProposals.id, proposalId))).limit(1).for("update");
        if (!proposal || proposal.status !== "pending") throw conflict("A pending Roadmap proposal is required");
        let stale = row.updatedAt.toISOString() !== proposal.patch.expectedProjectUpdatedAt;
        for (const change of proposal.patch.changes) { const [task] = await tx.select({ updatedAt: issues.updatedAt }).from(issues).where(and(eq(issues.companyId, companyId), eq(issues.projectId, projectId), eq(issues.id, change.issueId))).limit(1).for("update"); if (!task || task.updatedAt.toISOString() !== change.expectedUpdatedAt) stale = true; }
        const status = stale ? "stale" : accept ? "accepted" : "rejected";
        if (status === "accepted") { const inspected = await inspectChanges(tx, actor, companyId, projectId, proposal.patch, roadmapPolicySchema.parse(row.roadmapPolicy ?? {})); for (const change of inspected.prepared) await tx.update(issues).set({ ...change.patch, updatedAt: new Date() }).where(eq(issues.id, change.row.id)); await tx.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId)); }
        const [reviewed] = await tx.update(projectRoadmapProposals).set({ status, reviewedByUserId: userId, reviewRationale: rationale, updatedAt: new Date() }).where(eq(projectRoadmapProposals.id, proposalId)).returning();
        await logActivity(tx, { companyId, actorType: "user", actorId: userId, action: `project.roadmap_${status}`, entityType: "project", entityId: projectId, details: { proposalId, changedTaskIds: proposal.patch.changes.map((c) => c.issueId) } }, publications); return reviewed!;
      });
    },
    forecast: async (actor: AuthorizationActor, companyId: string, projectId: string, issueId: string, raw: z.infer<typeof taskForecastPatchSchema>) => {
      await assertV5Enabled(db, "project_forecast_v5"); const input = taskForecastPatchSchema.parse(raw);
      return withV5ActivityTransaction(db, async (tx, publications) => {
        const row = await project(tx, actor, companyId, projectId, true), policy = roadmapPolicySchema.parse(row.roadmapPolicy ?? {});
        if (policy.fieldOwnership.forecast !== "internal" || actor.type === "agent" && !policy.allowAgentForecast) throw forbidden("Forecast updates are disabled by the project ownership policy");
        await task(tx, actor, companyId, projectId, issueId, input.expectedUpdatedAt);
        const { expectedUpdatedAt: _expected, ...forecast } = input;
        const [updated] = await tx.update(issues).set({ ...forecast, forecastStartAt: input.forecastStartAt ? new Date(input.forecastStartAt) : null, forecastEndAt: input.forecastEndAt ? new Date(input.forecastEndAt) : null, updatedAt: new Date() }).where(eq(issues.id, issueId)).returning();
        await logActivity(tx, { companyId, actorType: actor.type === "agent" ? "agent" : "user", actorId: actor.agentId ?? v5HumanActorId(actor), action: "project.forecast_updated", entityType: "issue", entityId: issueId, details: { projectId, confidence: input.forecastConfidence } }, publications); return updated!;
      });
    },
  };
}
