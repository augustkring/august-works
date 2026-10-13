import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { agents, authUsers, companies, companyMemberships, issues, orchestrationPlans, type Db } from "@paperclipai/db";
import { orchestrationExperienceSchema, orchestrationBudgetSchema, v9FeatureEnabled, type OrchestrationExperience } from "@paperclipai/shared";
import type { AuthorizationActor } from "../authorization.js";
import { authorizationService } from "../authorization.js";
import { assertV7Authorization, assertV7Enabled, v7HumanActorId } from "../v7-authorization.js";
import { instanceSettingsService } from "../instance-settings.js";
import { assertDerivedManager } from "../memory/derived-memory.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { orchestrationService } from "../orchestration/orchestration-service.js";
import { withExperienceAdmission } from "./admission.js";
import { ExperienceOverloadError } from "./projection.js";
import { conflict, forbidden, notFound, HttpError } from "../../errors.js";
import { nativeSha256 } from "../native-runtime/canonical.js";

/** Current Native work status. There is no second planner, tree, scheduler,
 * control owner, dataset, verification decision or mutation in this read. */
export function readOrchestrationExperience(db: Db, actor: AuthorizationActor, companyId: string, signal?: AbortSignal) {
  const userId = v7HumanActorId(actor), current = { ...actor, ignoreInstanceAdmin: true, isInstanceAdmin: false };
  if (actor.source === "local_implicit") throw forbidden("A verified account is required for work status");
  return withExperienceAdmission(async (currentSignal, remainingMs) => db.transaction(async raw => {
    const tx = raw as unknown as Db;
    await tx.execute(sql`select set_config('statement_timeout',${`${remainingMs()}ms`},true),set_config('lock_timeout','250ms',true)`);
    await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
    async function account() {
      currentSignal.throwIfAborted();
      await assertV7Enabled(tx, "orchestration_v7");
      if (!v9FeatureEnabled(await instanceSettingsService(tx).getExperimental(), "progressive_shell_v9"))
        throw notFound("Work status is not enabled");
      await assertV7Authorization(tx, current, companyId, "company_scope:read");
      const [company] = await tx.select({ status: companies.status }).from(companies).where(eq(companies.id, companyId)).for("share");
      const [membership] = await tx.select({ id: companyMemberships.id }).from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId),
        eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, userId), eq(companyMemberships.status, "active"))).for("share");
      const [user] = await tx.select({ verified: authUsers.emailVerified }).from(authUsers).where(eq(authUsers.id, userId)).for("share");
      if (!company || company.status === "archived" || !membership || !user?.verified) throw forbidden("Current verified company membership is required");
    }
    async function inspector() {
      try { await assertDerivedManager(tx, current, companyId); return true; }
      catch (error) { if (error instanceof HttpError && error.status === 403) return false; throw error; }
    }
    await account(); const canInspect = await inspector();
    const ids = await tx.select({ id: orchestrationPlans.id }).from(orchestrationPlans).where(and(
      eq(orchestrationPlans.companyId, companyId), isNull(orchestrationPlans.erasedAt))).orderBy(desc(orchestrationPlans.createdAt), desc(orchestrationPlans.id)).limit(21);
    const owner = orchestrationService(tx), auth = authorizationService(tx);
    async function agent(id: string | null) {
      if (!id) return null;
      currentSignal.throwIfAborted();
      if (!(await auth.decide({ actor: current, action: "agent:read", resource: { type: "agent", companyId, agentId: id } })).allowed) return null;
      const [row] = await tx.select({ id: agents.id, name: agents.name }).from(agents)
        .where(and(eq(agents.companyId, companyId), eq(agents.id, id))).for("share");
      return row ? { id: row.id, name: row.name.trim().slice(0, 200) || "Agent" } : null;
    }
    async function read(id: string) {
      currentSignal.throwIfAborted();
      // The Original owner checks all bound Tasks/attempts and Source erasure.
      // Control-mode reads are deliberately excluded from this presentation.
      const plan = await owner.get(current, companyId, id);
      if (plan.workers.length > 32 || plan.attempts.length > 256) throw conflict("The complete work status exceeds its bounds");
      const [task] = await tx.select({ agentId: issues.assigneeAgentId, title: issues.title }).from(issues)
        .where(and(eq(issues.companyId, companyId), eq(issues.id, plan.issueId))).for("share");
      if (!task) throw conflict("The Original task is unavailable");
      const responsible = await agent(task.agentId), helpers: Array<{ id: string; name: string }> = [];
      let assignmentsUnavailable = !!task.agentId && !responsible;
      const ordered = [...plan.workers].sort((a, b) => a.workerKey.localeCompare(b.workerKey));
      const numbers = new Map(ordered.map((worker, index) => [worker.workerKey, index + 1]));
      const workers = [];
      for (const worker of ordered) {
        const assigned = await agent(worker.agentId);
        assignmentsUnavailable ||= !!worker.agentId && !assigned;
        if (assigned && assigned.id !== responsible?.id && !helpers.some(helper => helper.id === assigned.id)) helpers.push(assigned);
        workers.push({ number: numbers.get(worker.workerKey)!, taskId: worker.issueId, agent: assigned, status: worker.status,
          dependsOn: worker.dependsOn.map(key => { const number = numbers.get(key); if (!number) throw conflict("The Original dependency is unavailable"); return number; }),
          attemptsRecorded: worker.attemptCount });
      }
      const budget = orchestrationBudgetSchema.parse(plan.budgets);
      const title = Array.from(task.title.trim());
      return { id: plan.id, taskId: plan.issueId, taskTitle: title.slice(0, 200).join("") || "Task", taskTitleTruncated: title.length > 200,
        version: plan.version, status: plan.status, owner: responsible, helpers,
        assignmentsUnavailable, taskHref: `/issues/${plan.issueId}`, inspection: canInspect ? {
          mode: plan.mode, workers, budgets: { maxWorkers: budget.maxWorkerCount, maxParallel: budget.maxParallelWorkers,
            maxDepth: budget.maxDelegationDepth, maxSeconds: budget.maxWallClockSeconds, maxRetries: budget.maxRetries,
            maxToolActions: budget.maxToolActions, modelCostCapConfigured: budget.maxModelCostMinor !== null },
          controlHref: "/orchestration?view=advanced" as const,
        } : null };
    }
    const rows: OrchestrationExperience["rows"] = [];
    for (const candidate of ids) {
      try { rows.push(orchestrationExperienceSchema.shape.rows.element.parse(await read(candidate.id))); }
      catch (error) { if (error instanceof HttpError && [403, 404].includes(error.status)) continue; throw error; }
    }
    await account(); if (canInspect !== await inspector()) throw conflict("Current inspection authority changed");
    for (const row of rows) if (nativeSha256(row) !== nativeSha256(await read(row.id))) throw conflict("Current work status changed; refresh");
    currentSignal.throwIfAborted();
    return orchestrationExperienceSchema.parse({ companyId, observedAt: new Date().toISOString(), coverage: "bounded",
      hasMore: rows.length > 20, canInspect, rows: rows.slice(0, 20), modelCalled: false });
  }).catch(error => {
    let cause: unknown = error;
    for (let depth = 0; depth < 4 && cause && typeof cause === "object"; depth++) {
      const failure = cause as { code?: unknown; cause?: unknown };
      if (failure.code === "55P03" || failure.code === "57014") throw new ExperienceOverloadError("Current work status could not complete within its budget");
      cause = failure.cause;
    }
    throw error;
  }), { signal });
}
