import { and, eq } from "drizzle-orm";
import { heartbeatRuns, issues, orchestrationPlans, type Db } from "@paperclipai/db";
import { assertHumanAuthentication, RECENT_AUTHENTICATION_SECONDS } from "../../auth/authenticator-assurance.js";
import { forbidden, HttpError } from "../../errors.js";
import type { AuthorizationActor } from "../authorization.js";

/** The server rows of one hidden provider-conformance qualification group
 * that the group-bound authentication rule reads (CONF15-P4). */
export type NativeConformanceGroupAuthenticationFacts = Readonly<{
  /** The group the caller names (the bootstrap or host-command claim). */
  groupId: string;
  planId: string;
  actorUserId: string;
  /** The session's own `authenticated_at`, from a valid, unrevoked session. */
  authenticatedAt: Date;
  now: Date;
  run: Readonly<{ status: string; responsibleUserId: string | null; groupId: unknown; planId: unknown;
    triggerDetail: string | null }> | null;
  plan: Readonly<{ id: string; status: string; erasedAt: Date | null; startedAt: Date | null; createdBy: string;
    executionPrincipal: unknown; maxWallClockSeconds: number }> | null;
  task: Readonly<{ status: string; hiddenAt: Date | null; harnessKind: string | null }> | null;
}>;

/**
 * One Human request starts a qualification and runs all of its probes serially
 * (`native-opencode-conformance.ts` `test()`), so a per-probe recent check makes
 * every qualification longer than `RECENT_AUTHENTICATION_SECONDS` fail. A later
 * probe may instead rely on the authentication that admitted the group's start,
 * read only from server rows: the same group and plan, the same Human on the
 * Run, plan and plan principal, a group that is not cancelled, failed, finished
 * or erased, a session whose own authentication was recent when the group's
 * plan started, and the group's own deadline (`startedAt + maxWallClockSeconds`)
 * not yet reached. The session must still be valid and unrevoked; the caller
 * proves that with `assertHumanAuthentication` before calling this.
 */
export function nativeConformanceGroupAuthenticationAdmits(facts: NativeConformanceGroupAuthenticationFacts): boolean {
  const { run, plan, task } = facts;
  if (!run || !plan || !task || !plan.startedAt) return false;
  const startedAt = plan.startedAt.getTime(), authenticatedAt = facts.authenticatedAt.getTime(), now = facts.now.getTime();
  const principal = plan.executionPrincipal && typeof plan.executionPrincipal === "object" && !Array.isArray(plan.executionPrincipal)
    ? plan.executionPrincipal as Record<string, unknown> : null;
  // Every time comparison below is false for an invalid (NaN) time, and a
  // non-positive window ends before `now`.
  return Number.isSafeInteger(plan.maxWallClockSeconds) &&
    // The same group and its plan.
    run.groupId === facts.groupId && run.planId === facts.planId && plan.id === facts.planId &&
    run.status === "running" && run.triggerDetail === "provider_conformance" &&
    // The same Human.
    run.responsibleUserId === facts.actorUserId && plan.createdBy === facts.actorUserId &&
    principal?.type === "user" && principal.userId === facts.actorUserId &&
    // A group that is neither cancelled nor finished. The harness plan stays
    // paused for the whole qualification (`model-reservations.ts` requires it).
    plan.status === "paused" && plan.erasedAt === null &&
    task.status === "in_progress" && task.hiddenAt !== null && task.harnessKind === "provider_conformance" &&
    // The session's authentication was recent when the group started.
    authenticatedAt <= now && authenticatedAt >= startedAt - RECENT_AUTHENTICATION_SECONDS * 1000 &&
    // The group started inside its own bounded window.
    startedAt <= now && now < startedAt + plan.maxWallClockSeconds * 1000;
}

function recentAuthenticationRequired(error: unknown) {
  return error instanceof HttpError && error.status === 403 && !!error.details && typeof error.details === "object" &&
    (error.details as Record<string, unknown>).code === "recent_authentication_required";
}

/**
 * Human authentication for one hidden conformance probe. A recently
 * authenticated session passes as before. Otherwise the session must still be
 * valid and unrevoked, and the group-bound rule above must hold for the exact
 * company-scoped Run, plan and hidden Task the probe names. Anything else
 * refuses with the original `recent_authentication_required` code.
 */
export async function assertNativeConformanceHumanAuthentication(db: Db, actor: AuthorizationActor,
  scope: Readonly<{ companyId: string; groupId: string; planId: string; runId: string; taskId: string }>,
  now: () => Date = () => new Date()) {
  try {
    return await assertHumanAuthentication(db, actor, { requireRecent: true, phishingResistant: false });
  } catch (error) {
    if (!recentAuthenticationRequired(error)) throw error;
  }
  // Expired, revoked (authenticator version), deleted or otherwise invalid
  // sessions refuse here exactly as before.
  const proof = await assertHumanAuthentication(db, actor, { requireRecent: false, phishingResistant: false });
  const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, scope.companyId),
    eq(heartbeatRuns.id, scope.runId))).limit(1);
  const [plan] = await db.select().from(orchestrationPlans).where(and(eq(orchestrationPlans.companyId, scope.companyId),
    eq(orchestrationPlans.id, scope.planId), eq(orchestrationPlans.issueId, scope.taskId))).limit(1);
  const [task] = await db.select().from(issues).where(and(eq(issues.companyId, scope.companyId),
    eq(issues.id, scope.taskId))).limit(1);
  const context = run?.contextSnapshot && typeof run.contextSnapshot === "object" && !Array.isArray(run.contextSnapshot)
    ? run.contextSnapshot as Record<string, unknown> : {};
  const admitted = nativeConformanceGroupAuthenticationAdmits({ groupId: scope.groupId, planId: scope.planId,
    actorUserId: actor.type === "board" && actor.userId ? actor.userId : "", authenticatedAt: proof.authenticatedAt, now: now(),
    run: run && run.nativeIssueId === scope.taskId ? { status: run.status, responsibleUserId: run.responsibleUserId,
      groupId: context.providerConformanceGroupId, planId: context.providerConformancePlanId, triggerDetail: run.triggerDetail } : null,
    plan: plan ? { id: plan.id, status: plan.status, erasedAt: plan.erasedAt, startedAt: plan.startedAt, createdBy: plan.createdBy,
      executionPrincipal: plan.executionPrincipal, maxWallClockSeconds: plan.budgets.maxWallClockSeconds } : null,
    task: task && task.executionRunId === scope.runId ? { status: task.status, hiddenAt: task.hiddenAt, harnessKind: task.harnessKind } : null });
  if (!admitted) throw forbidden("Authenticate again to continue", { code: "recent_authentication_required" });
  return proof;
}
