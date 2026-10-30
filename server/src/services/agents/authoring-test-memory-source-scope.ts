import { AsyncLocalStorage } from "node:async_hooks";
import { and, eq, sql } from "drizzle-orm";
import { agentConfigurationDrafts, agentConfigurationTests, agents, authUsers,
  companyMemberships, heartbeatRuns, issues, orchestrationPlans, type Db } from "@paperclipai/db";
import type { AuthorizationActor } from "../authorization.js";
import { pinCurrentBoardActor } from "../authorization.js";
import { forbidden } from "../../errors.js";
import { authoringCandidateHash } from "./authoring-test-candidate.js";

type Permit = {
  active: boolean; deadline: number; companyId: string; testId: string; draftId: string; agentId: string; runId: string;
  userId: string; candidateHash: string; configurationHash: string; authorityHash: string;
  humanActor: AuthorizationActor; memoryRecordIds: string[];
};
const permits = new AsyncLocalStorage<Permit>();

/** Read-only predicate consumed by the Memory source owner. The exact root is
 * part of the capability; a selected memory edge cannot authorize a sibling. */
export function agentAuthoringTestMemorySourceReadActive(companyId: string, actor: AuthorizationActor | undefined,
  recordId: string | undefined): boolean {
  const permit = permits.getStore();
  return !!permit?.active && performance.now() <= permit.deadline && !!recordId && permit.memoryRecordIds.includes(recordId) && actor?.type === "agent" &&
    actor.source === "agent_jwt" && !actor.keyId && !actor.keyScope && actor.companyId === permit.companyId &&
    companyId === permit.companyId && actor.agentId === permit.agentId && actor.runId === permit.runId &&
    actor.onBehalfOfUserId === permit.userId;
}

async function assertCurrent(db: Db, permit: Permit) {
  if (performance.now() > permit.deadline || permit.humanActor.type !== "board" || permit.humanActor.userId !== permit.userId || !permit.memoryRecordIds.length ||
    !/^[a-f0-9]{64}$/.test(permit.candidateHash) || !/^[a-f0-9]{64}$/.test(permit.configurationHash) ||
    !/^[a-f0-9]{64}$/.test(permit.authorityHash)) return false;
  const humans = await db.select({ userId: authUsers.id, role: companyMemberships.membershipRole }).from(authUsers)
    .innerJoin(companyMemberships, and(eq(companyMemberships.principalId, authUsers.id),
      eq(companyMemberships.principalType, "user"), eq(companyMemberships.companyId, permit.companyId),
      eq(companyMemberships.status, "active")))
    .where(eq(authUsers.id, permit.userId)).for("share", { noWait: true });
  if (!humans.length || humans.every(row => row.role === "viewer")) return false;
  const hasNativeCredential = permit.humanActor.source === "session" || permit.humanActor.source === "board_key";
  if (hasNativeCredential) {
    if (permit.humanActor.source === "session" && !permit.humanActor.sessionId) return false;
    if (permit.humanActor.source === "board_key" && !permit.humanActor.keyId) return false;
    const pinned = await pinCurrentBoardActor(db, permit.humanActor);
    if (!pinned || pinned.actor.userId !== permit.userId) return false;
    if (pinned.credentialExpiresAt !== null &&
      pinned.credentialExpiresAt <= Date.now()) return false;
  }
  const [test] = await db.select().from(agentConfigurationTests).where(and(eq(agentConfigurationTests.companyId, permit.companyId),
    eq(agentConfigurationTests.id, permit.testId), eq(agentConfigurationTests.draftId, permit.draftId),
    eq(agentConfigurationTests.agentId, permit.agentId), eq(agentConfigurationTests.runId, permit.runId),
    eq(agentConfigurationTests.createdByUserId, permit.userId), eq(agentConfigurationTests.candidateHash, permit.candidateHash),
    eq(agentConfigurationTests.configurationHash, permit.configurationHash), eq(agentConfigurationTests.authorityHash, permit.authorityHash)))
    .for("share", { noWait: true });
  if (!test) return false;
  const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, permit.companyId),
    eq(heartbeatRuns.id, permit.runId), eq(heartbeatRuns.agentId, permit.agentId), eq(heartbeatRuns.responsibleUserId, permit.userId),
    eq(heartbeatRuns.status, "running"), eq(heartbeatRuns.triggerDetail, "agent_safe_test"))).for("share", { noWait: true });
  const context = run?.contextSnapshot;
  if (!run || context?.agentConfigurationTestId !== test.id || context?.draftId !== test.draftId ||
    context?.candidateHash !== test.candidateHash || context?.toolsGranted !== false || context?.activatesAgent !== false) return false;
  const [draft] = await db.select().from(agentConfigurationDrafts).where(and(eq(agentConfigurationDrafts.companyId, permit.companyId),
    eq(agentConfigurationDrafts.id, permit.draftId), eq(agentConfigurationDrafts.createdByUserId, permit.userId),
    eq(agentConfigurationDrafts.status, "draft"))).for("share", { noWait: true });
  if (!draft || test.candidateRevision !== draft.candidateRevision || authoringCandidateHash(draft) !== permit.candidateHash) return false;
  const [agent] = await db.select({ status: agents.status, pauseReason: agents.pauseReason }).from(agents)
    .where(and(eq(agents.companyId, permit.companyId), eq(agents.id, permit.agentId))).for("share", { noWait: true });
  if (!agent || !["idle", "paused"].includes(agent.status) ||
    (agent.status === "paused" && agent.pauseReason !== "manual" && agent.pauseReason !== "budget")) return false;
  // Reuse the persisted safe-test harness contract: this window is opened only
  // by the original current candidate writer, while its locked rows remain in
  // this transaction. The deferred database guards revalidate the full plan.
  const [harness] = await db.select({
    planId: orchestrationPlans.id, planStatus: orchestrationPlans.status, erasedAt: orchestrationPlans.erasedAt,
    mode: orchestrationPlans.mode, actionClass: orchestrationPlans.actionClass, riskClass: orchestrationPlans.riskClass,
    toolActionsUsed: orchestrationPlans.toolActionsUsed, maxToolActions: sql<number>`((${orchestrationPlans.budgets}->>'maxToolActions')::int)`,
    executionPrincipal: orchestrationPlans.executionPrincipal, taskId: issues.id, hiddenAt: issues.hiddenAt,
    harnessKind: issues.harnessKind, assigneeUserId: issues.assigneeUserId, assigneeAgentId: issues.assigneeAgentId,
  }).from(orchestrationPlans).innerJoin(issues, and(eq(issues.companyId, orchestrationPlans.companyId), eq(issues.id, orchestrationPlans.issueId)))
    .where(and(eq(orchestrationPlans.companyId, permit.companyId), eq(orchestrationPlans.id, test.planId)))
    .for("share", { noWait: true });
  return performance.now() <= permit.deadline && !!harness && harness.planStatus === "paused" && harness.erasedAt === null && harness.mode === "single_worker" &&
    harness.actionClass === "internal_draft" && harness.riskClass === "C0" && harness.toolActionsUsed === 0 &&
    harness.maxToolActions === 0 && harness.executionPrincipal?.type === "user" &&
    harness.executionPrincipal.userId === permit.userId && harness.hiddenAt !== null &&
    harness.harnessKind === "agent_safe_test" && harness.assigneeUserId === permit.userId && harness.assigneeAgentId === null;
}

/** Narrow current-source window for selected Memory in the bounded test only.
 * The original candidate/test writer supplies the persisted binding; no request
 * flag or general Agent capability can create this purpose. */
export async function withAgentAuthoringTestMemoryReads<T>(db: Db, input: Omit<Permit, "active" | "deadline">,
  inspect: () => Promise<T>): Promise<T> {
  const permit: Permit = { ...input, humanActor: structuredClone(input.humanActor), memoryRecordIds: [...new Set(input.memoryRecordIds)],
    deadline: performance.now() + 8000, active: true };
  try {
    if (!await assertCurrent(db, permit)) throw forbidden("The exact current Agent safe-test source read is unavailable");
    const result = await permits.run(permit, inspect);
    if (!await assertCurrent(db, permit)) throw forbidden("The Agent safe-test source authority changed during retention");
    return result;
  } finally { permit.active = false; }
}
