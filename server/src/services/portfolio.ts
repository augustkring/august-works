import { assertSaasDomainAdmission } from "./saas/domain-admission.js";
import { and, eq, isNull } from "drizzle-orm";
import { approvals, companies, goals, issues, projects, projectMilestones, type Db } from "@paperclipai/db";
import { portfolioRequestSchema, type PortfolioCompanySummary } from "@paperclipai/shared";
import type { z } from "zod";
import { conflict } from "../errors.js";
import { authorizationService, type AuthorizationActor } from "./authorization.js";
import { dashboardService } from "./dashboard.js";
import { executionIssueCondition } from "./issue-visibility.js";
import { assertV5Authorization, assertV5Enabled, v5HumanActorId } from "./v5-authorization.js";

export function portfolioService(db: Db) {
  return {
    summary: async (actor: AuthorizationActor, raw: z.infer<typeof portfolioRequestSchema>) => {
      await assertV5Enabled(db, "portfolio_view_v5");
      const input = portfolioRequestSchema.parse(raw), userId = v5HumanActorId(actor);
      const visible: PortfolioCompanySummary[] = [], unavailableCompanyIds: string[] = [];
      for (const companyId of input.companyIds) {
        try { await assertV5Authorization(db, actor, companyId, "company_scope:read"); await assertSaasDomainAdmission(db,companyId,"portfolio.use"); }
        catch (error) { if (error instanceof Error && "status" in error && Number(error.status) === 403) { unavailableCompanyIds.push(companyId); continue; } throw error; }
        const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
        if (!company) { unavailableCompanyIds.push(companyId); continue; }
        const [projectRows, goalRows, milestoneRows, taskRows] = await Promise.all([
          db.select().from(projects).where(eq(projects.companyId, companyId)).limit(501),
          db.select({ id: goals.id, title: goals.title, status: goals.status }).from(goals).where(eq(goals.companyId, companyId)).limit(501),
          db.select().from(projectMilestones).where(eq(projectMilestones.companyId, companyId)).limit(501),
          db.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.assigneeUserId, userId), isNull(issues.hiddenAt), executionIssueCondition())).limit(501),
        ]);
        if ([projectRows, goalRows, milestoneRows, taskRows].some((rows) => rows.length > 500)) throw conflict("Portfolio detail exceeds 500 records in a company; use the company views");
        const authorization = authorizationService(db), allowedProjects = [];
        for (const row of projectRows) if ((await authorization.decide({ actor, action: "project:read", resource: { type: "project", companyId, projectId: row.id }, enforceResponsibleUserIntersection: true })).allowed) allowedProjects.push(row);
        const projectIds = new Set(allowedProjects.map((row) => row.id)), myTasks = [];
        for (const row of taskRows) if ((await authorization.decide({ actor, action: "issue:read", resource: { type: "issue", companyId, issueId: row.id, projectId: row.projectId, parentIssueId: row.parentId, assigneeAgentId: row.assigneeAgentId, assigneeUserId: row.assigneeUserId, status: row.status }, enforceResponsibleUserIntersection: true })).allowed) myTasks.push({ id: row.id, identifier: row.identifier, title: row.title, status: row.status, projectId: row.projectId, plannedEndAt: row.plannedEndAt?.toISOString() ?? null });
        const canReview = (await authorization.decide({ actor, action: "decision_queue:read", resource: { type: "company", companyId }, enforceResponsibleUserIntersection: true })).allowed;
        const myApprovals = canReview ? await db.select({ id: approvals.id, type: approvals.type, status: approvals.status }).from(approvals).where(and(eq(approvals.companyId, companyId), eq(approvals.status, "pending"))).limit(501) : [];
        if (myApprovals.length > 500) throw conflict("Portfolio approval queue exceeds 500 records; use the company queue");
        visible.push({ companyId, name: company.name, status: company.status, dashboard: await dashboardService(db).summary(companyId), projects: allowedProjects.map((p) => ({ id: p.id, name: p.name, status: p.status, targetDate: p.targetDate, leadAgentId: p.leadAgentId })), goals: goalRows, milestones: milestoneRows.filter((m) => projectIds.has(m.projectId)).map((m) => ({ id: m.id, name: m.name, projectId: m.projectId, status: m.status, targetDate: m.targetDate })), myTasks, myApprovals, observedAt: new Date().toISOString() });
      }
      return { companies: visible, unavailableCompanyIds };
    },
  };
}
