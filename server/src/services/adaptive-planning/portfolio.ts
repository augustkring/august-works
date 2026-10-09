import { and, asc, eq, inArray } from "drizzle-orm";
import { analyticalSourceSuppressions, goals, projectGoals, projects, type Db } from "@paperclipai/db";
import { portfolioPlanningProfileSchema, type PortfolioPlanningProfile, type PortfolioPlanningSources } from "@paperclipai/shared";
import { conflict, notFound, unprocessable } from "../../errors.js";
import type { AuthorizationActor } from "../authorization.js";
import { authorizeStrategyReference } from "../strategy-execution/references.js";
import { budgetService } from "../budgets.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { admitCrossProjectPlanning, captureCrossProjectPlanning } from "./cross-project.js";
import { solveNativePortfolioPlanning } from "./portfolio-kernel.js";

/** Current native capture under the same company -> Memory privacy fence as
 * joint planning. Preview is transient: it creates no second project ledger. */
export async function capturePortfolioPlanning(tx: Db, companyId: string, actor: AuthorizationActor, profile: PortfolioPlanningProfile, checkVersions = true) {
  const deadline = performance.now() + 30000;
  const { initiatives: _initiatives, initiativePolicy: _initiativePolicy, ...jointProfile } = profile;
  const joint = await captureCrossProjectPlanning(tx, companyId, actor, jointProfile, checkVersions), ids = profile.projects.map(project => project.id);
  const rows = await tx.select().from(projects).where(and(eq(projects.companyId, companyId), inArray(projects.id, ids))).orderBy(asc(projects.id)).for("share");
  const associations = await tx.select().from(projectGoals).where(and(eq(projectGoals.companyId, companyId), inArray(projectGoals.projectId, ids))).orderBy(asc(projectGoals.projectId), asc(projectGoals.goalId)).limit(321).for("share");
  if (associations.length > 320) throw unprocessable("Selected initiative Goal coverage exceeds its bounded budget");
  const goalIds = [...new Set([...associations.map(link => link.goalId), ...rows.flatMap(project => project.goalId ? [project.goalId] : [])])].sort();
  if (goalIds.length > 320) throw unprocessable("Selected initiative Goal coverage exceeds its bounded budget");
  const goalRows = goalIds.length ? await tx.select({ id: goals.id, status: goals.status, updatedAt: goals.updatedAt }).from(goals).where(and(eq(goals.companyId, companyId), inArray(goals.id, goalIds))).orderBy(asc(goals.id)).for("share") : [];
  if (goalRows.length !== goalIds.length) throw notFound("Current initiative Goal sources are unavailable");
  for (const id of goalIds) {
    if (performance.now() > deadline) throw unprocessable("Native initiative source inspection exceeded its bounded budget");
    await authorizeStrategyReference(tx, companyId, actor, { type: "goal", id }, profile.sensitivity);
  }
  if (goalIds.length && (await tx.select({ id: analyticalSourceSuppressions.inputRef }).from(analyticalSourceSuppressions).where(and(eq(analyticalSourceSuppressions.companyId, companyId), eq(analyticalSourceSuppressions.inputType, "goal"), inArray(analyticalSourceSuppressions.inputRef, goalIds))).limit(1)).length) throw notFound("Current initiative Goal sources are unavailable");
  const budgets = budgetService(tx), accounting = [{ scopeId: companyId, policies: await budgets.planningSummary(companyId, "company", companyId) }];
  for (const project of rows) {
    if (performance.now() > deadline) throw unprocessable("Native initiative source inspection exceeded its bounded budget");
    accounting.push({ scopeId: project.id, policies: await budgets.planningSummary(companyId, "project", project.id) });
  }
  const activeGoals = new Set(goalRows.filter(goal => ["planned", "active"].includes(goal.status)).map(goal => goal.id));
  const sources: PortfolioPlanningSources = {
    projects: rows.map(project => ({ id: project.id, status: project.status, paused: project.pausedAt !== null || project.pauseReason !== null,
      taskKeys: joint.snapshots.find(snapshot => snapshot.projectId === project.id)!.tasks.map(task => task.id),
      activeGoalIds: [...new Set([...associations.filter(link => link.projectId === project.id).map(link => link.goalId), ...(project.goalId ? [project.goalId] : [])])].filter(id => activeGoals.has(id)).sort(),
    })),
    budgets: accounting.flatMap(scope => scope.policies.map(({ policy, summary, window }) => ({ policyId: policy.id, projectId: policy.scopeType === "project" ? policy.scopeId : null,
      remainingCents: summary?.remainingAmount ?? null, windowKind: policy.windowKind as "calendar_month_utc" | "lifetime",
      windowEnd: window.end.toISOString(),
    }))).sort((a, b) => a.policyId.localeCompare(b.policyId)),
  };
  const result = await solveNativePortfolioPlanning(profile, sources, joint.snapshots.flatMap(snapshot => snapshot.dependencies));
  if (performance.now() > deadline) throw unprocessable("Native initiative source inspection exceeded its bounded budget");
  if (joint.expiresAt <= new Date()) throw conflict("Initiative Sources expired during calculation");
  // The original canonical hash accepts JSON data, not Date objects. Native
  // version and UTC window timestamps must be pinned as their wire strings.
  const sourcePins = { goalIds, goalsHash: nativeSha256(JSON.parse(JSON.stringify(goalRows))), associationsHash: nativeSha256(JSON.parse(JSON.stringify(associations))), accountingHash: nativeSha256(JSON.parse(JSON.stringify(accounting))) };
  return { joint, sources, sourcePins, goalRows, associations, accounting, result,
    snapshotHash: nativeSha256({ profile, jointSnapshotHash: joint.snapshotHash, sources, sourcePins }),
  };
}

export function portfolioPlanningService(db: Db) {
  return {
    async preview(companyId: string, actor: AuthorizationActor, raw: unknown) {
      const profile = portfolioPlanningProfileSchema.parse(raw);
      return db.transaction(async rawTx => {
        const tx = rawTx as unknown as Db; await admitCrossProjectPlanning(tx, companyId, actor);
        if (Date.parse(`${profile.horizon.start}T00:00:00Z`) < Math.floor(Date.now() / 86400000) * 86400000) throw conflict("A prospective initiative horizon cannot begin in the past");
        const captured = await capturePortfolioPlanning(tx, companyId, actor, profile);
        return { snapshotHash: captured.snapshotHash, result: captured.result, currentSources: captured.sources, capturedAt: captured.joint.now.toISOString(), expiresAt: captured.joint.expiresAt.toISOString(), authority: "human_initiative_review_required" as const };
      });
    },
  };
}
