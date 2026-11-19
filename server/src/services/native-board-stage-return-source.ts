import { randomUUID } from "node:crypto";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { activityLog, companyMemberships, heartbeatRuns, instanceUserRoles, issues, statusDecisions, type Db } from "@paperclipai/db";
import { nativePayloadSourceSnapshotSchema, type NativePayloadSourceTransform } from "@paperclipai/shared";
import { parseIssueExecutionState } from "./issue-execution-policy.js";

type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Task = typeof issues.$inferSelect;
export type NativeBoardStageReturnTransform = Extract<NativePayloadSourceTransform, { kind: "board_stage_return" }>;

/**
 * MS1f stop 5 (0587). The facts of a board return of a Task from a pending
 * execution stage to the round's executor, read under the Task's write lock:
 * the stage participant and executor from the pending state, the executor's
 * applied stage-pending decision that is still the Task's last decision, and a
 * current non-viewer membership of the returning board user.
 */
export async function nativeBoardStageReturnFacts(tx: Db | Transaction, input: {
  task: Task; userId: string; nextExecutionState: unknown; nextAssigneeAgentId: string | null | undefined;
  nextAssigneeUserId: string | null | undefined; nextStatus: string | undefined; nextLastStatusDecisionId: unknown;
}): Promise<{ stageId: string; participantAgentId: string; executorAgentId: string; decisionId: string } | null> {
  const { task } = input;
  const state = parseIssueExecutionState(task.executionState);
  if (!state || state.status !== "pending" || typeof state.currentStageId !== "string" ||
    state.currentParticipant?.type !== "agent" || !state.currentParticipant.agentId ||
    state.returnAssignee?.type !== "agent" || !state.returnAssignee.agentId ||
    state.currentParticipant.agentId === state.returnAssignee.agentId) return null;
  const participantAgentId = state.currentParticipant.agentId, executorAgentId = state.returnAssignee.agentId;
  if (input.nextExecutionState !== null || task.status !== "in_review" || task.assigneeAgentId !== participantAgentId ||
    task.assigneeUserId !== null || input.nextAssigneeAgentId !== executorAgentId ||
    !(input.nextAssigneeUserId === undefined || input.nextAssigneeUserId === null) ||
    !input.nextStatus || ["in_review", "done", "cancelled"].includes(input.nextStatus) ||
    input.nextLastStatusDecisionId !== undefined || !task.lastStatusDecisionId) return null;
  const [decision] = await tx.select({ id: statusDecisions.id, runAgentId: heartbeatRuns.agentId }).from(statusDecisions)
    .innerJoin(heartbeatRuns, and(eq(heartbeatRuns.companyId, statusDecisions.companyId), eq(heartbeatRuns.id, statusDecisions.runId)))
    .where(and(eq(statusDecisions.companyId, task.companyId), eq(statusDecisions.issueId, task.id),
      eq(statusDecisions.id, task.lastStatusDecisionId), eq(statusDecisions.applicationState, "applied"),
      eq(statusDecisions.reasonCode, "execution_policy_stage_pending"), eq(statusDecisions.toStatus, "in_review"),
      eq(heartbeatRuns.nativeIssueId, task.id), eq(heartbeatRuns.runtimeMode, "native"))).limit(1).for("share");
  if (!decision || decision.runAgentId !== executorAgentId) return null;
  const [member] = await tx.select({ id: companyMemberships.id }).from(companyMemberships).where(and(
    eq(companyMemberships.companyId, task.companyId), eq(companyMemberships.principalType, "user"),
    eq(companyMemberships.principalId, input.userId), eq(companyMemberships.status, "active"),
    sql`${companyMemberships.membershipRole} is distinct from 'viewer'`)).limit(1);
  const [admin] = member ? [] : await tx.select({ id: instanceUserRoles.id }).from(instanceUserRoles).where(and(
    eq(instanceUserRoles.userId, input.userId), eq(instanceUserRoles.role, "instance_admin"))).limit(1);
  if (!member && !admin) return null;
  return { stageId: state.currentStageId, participantAgentId, executorAgentId, decisionId: decision.id };
}

/**
 * The Task source snapshot after a board stage return: the same closure with
 * one appended `board_stage_return` step, or null when anything else changes
 * (the caller then keeps today's null-snapshot behaviour). The step names the
 * board's issue.updated activity id the caller writes in the same transaction.
 */
export async function prepareNativeBoardStageReturnSnapshot(tx: Transaction, input: {
  task: Task; activityId: string; facts: NonNullable<Awaited<ReturnType<typeof nativeBoardStageReturnFacts>>>;
  actualBodyPatch: SQL;
}): Promise<SQL | null> {
  const parsed = nativePayloadSourceSnapshotSchema.safeParse(input.task.payloadSourceSnapshot);
  if (!parsed.success || input.task.payloadSourceProtocolVersion !== 1 || input.task.payloadSourceSnapshotInvalidated ||
    input.task.conversationAgentId !== null) return null;
  const snapshot = parsed.data;
  if (snapshot.owner.kind !== "issue" || snapshot.owner.companyId !== input.task.companyId || snapshot.owner.id !== input.task.id ||
    (snapshot.transforms?.length ?? 0) >= 32 ||
    snapshot.transforms?.some(step => "activityId" in step && step.activityId === input.activityId)) return null;
  const [hashes] = await tx.execute<{ oldHash: string; newHash: string; stateOnlyHash: string; validDigest: boolean }>(sql`select
    public.aw_native_payload_body_hash('issue',to_jsonb(${issues})) as "oldHash",
    public.aw_native_payload_body_hash('issue',to_jsonb(jsonb_populate_record(${issues},to_jsonb(${issues}) || ${input.actualBodyPatch}))) as "newHash",
    public.aw_native_payload_body_hash('issue',to_jsonb(${issues}) || jsonb_build_object('execution_state',null::jsonb)) as "stateOnlyHash",
    ${JSON.stringify(snapshot)}::jsonb->>'digest'=encode(sha256(convert_to((${JSON.stringify(snapshot)}::jsonb-'digest')::text,'UTF8')),'hex') as "validDigest"
    from ${issues} where ${issues.companyId}=${input.task.companyId} and ${issues.id}=${input.task.id}`);
  if (!hashes || !hashes.validDigest || hashes.oldHash !== snapshot.owner.contentHash || hashes.newHash !== hashes.stateOnlyHash ||
    hashes.oldHash === hashes.newHash) return null;
  const transform: NativeBoardStageReturnTransform = { kind: "board_stage_return", transitionId: randomUUID(),
    activityId: input.activityId, stageId: input.facts.stageId, participantAgentId: input.facts.participantAgentId,
    executorAgentId: input.facts.executorAgentId, decisionId: input.facts.decisionId,
    taskStatusVersion: input.task.statusVersion + 1, previousSnapshotDigest: snapshot.digest,
    previousOwnerContentHash: hashes.oldHash, nextOwnerContentHash: hashes.newHash };
  const value = { version: 1, owner: { ...snapshot.owner, contentHash: hashes.newHash }, policy: snapshot.policy,
    inputs: snapshot.inputs, transforms: [...(snapshot.transforms ?? []), transform] };
  return sql`(with payload as (select ${JSON.stringify(value)}::jsonb as value)
    select value || jsonb_build_object('digest',encode(sha256(convert_to(value::text,'UTF8')),'hex')) from payload)`;
}

/**
 * Read side: a recorded `board_stage_return` step is current only while the
 * board's issue.updated activity it names still records exactly that return,
 * and its round decision is the executor's applied stage-pending decision.
 */
export async function readNativeBoardStageReturnStep(db: Db | Transaction, input: {
  companyId: string; issueId: string; step: NativeBoardStageReturnTransform;
}): Promise<{ fromExecutionState: unknown } | null> {
  const { step } = input;
  const [activity] = await db.select().from(activityLog).where(and(eq(activityLog.companyId, input.companyId),
    eq(activityLog.id, step.activityId), eq(activityLog.entityType, "issue"), eq(activityLog.entityId, input.issueId),
    eq(activityLog.action, "issue.updated"), eq(activityLog.actorType, "user"))).limit(1);
  const changes = activity?.details && typeof activity.details === "object" ? (activity.details as Record<string, unknown>).changes : null;
  const record = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const c = record(changes), state = record(c?.executionState), assignee = record(c?.assigneeAgentId), version = record(c?.statusVersion);
  const from = parseIssueExecutionState(state?.from);
  if (!activity || activity.agentId !== null || activity.runId !== null || !c || state?.to !== null || !from ||
    from.status !== "pending" || from.currentStageId !== step.stageId || from.currentParticipant?.agentId !== step.participantAgentId ||
    from.returnAssignee?.agentId !== step.executorAgentId || assignee?.from !== step.participantAgentId ||
    assignee.to !== step.executorAgentId || version?.to !== step.taskStatusVersion || Object.hasOwn(c, "lastStatusDecisionId")) return null;
  const [decision] = await db.select({ id: statusDecisions.id }).from(statusDecisions)
    .innerJoin(heartbeatRuns, and(eq(heartbeatRuns.companyId, statusDecisions.companyId), eq(heartbeatRuns.id, statusDecisions.runId)))
    .where(and(eq(statusDecisions.companyId, input.companyId), eq(statusDecisions.issueId, input.issueId),
      eq(statusDecisions.id, step.decisionId), eq(statusDecisions.applicationState, "applied"),
      eq(statusDecisions.reasonCode, "execution_policy_stage_pending"), eq(heartbeatRuns.nativeIssueId, input.issueId),
      eq(heartbeatRuns.agentId, step.executorAgentId), eq(heartbeatRuns.runtimeMode, "native"))).limit(1);
  return decision ? { fromExecutionState: state!.from } : null;
}

type SourceStep = NativePayloadSourceTransform;

/**
 * MS1f (retained Context Task lineage). A suffix of Task source steps that the
 * platform recorded after a retained Context Task item was captured qualifies
 * only when every step is a `native_stage_policy` step (re-read by its own
 * owner) or a `board_stage_return` step (re-read by its activity and round
 * decision), in recorded order, with a continuous owner-hash chain from the
 * item's owner hash to the Task's current owner hash, and when every step
 * changed only `execution_state`: the current row with only `execution_state`
 * replaced by the step's recorded from/to states must hash to the step's
 * recorded previous/next owner hashes. Any other body change (title,
 * description, unblock descriptor or any other body field) makes the hashes
 * differ and the suffix is refused.
 */
export async function verifyNativeRetainedTaskRoundSuffix(db: Db | Transaction, input: {
  companyId: string; issueId: string; suffix: readonly SourceStep[]; prefixOwnerHash: string; currentOwnerHash: string;
}): Promise<boolean> {
  if (input.suffix.length === 0 || input.suffix.length > 32) return false;
  const [task] = await db.select().from(issues).where(and(eq(issues.companyId, input.companyId), eq(issues.id, input.issueId)))
    .limit(1).for("share");
  if (!task || task.payloadSourceSnapshotInvalidated) return false;
  const { readNativeStageTaskBodyStep } = await import("./native-stage-task-body-source.js");
  const pairs: Array<{ from: unknown; to: unknown; previous: string; next: string }> = [];
  let chain = input.prefixOwnerHash;
  for (const step of input.suffix) {
    if (step.previousOwnerContentHash !== chain) return false;
    if (step.kind === "native_stage_policy") {
      const receipt = await readNativeStageTaskBodyStep(db, { task, step }).catch(() => null);
      if (!receipt || receipt.previousOwnerContentHash !== step.previousOwnerContentHash ||
        receipt.nextOwnerContentHash !== step.nextOwnerContentHash) return false;
      pairs.push({ from: receipt.fromExecutionState ?? null, to: receipt.toExecutionState ?? null,
        previous: step.previousOwnerContentHash, next: step.nextOwnerContentHash });
    } else if (step.kind === "board_stage_return") {
      const read = await readNativeBoardStageReturnStep(db, { companyId: input.companyId, issueId: input.issueId, step });
      if (!read) return false;
      pairs.push({ from: read.fromExecutionState ?? null, to: null, previous: step.previousOwnerContentHash, next: step.nextOwnerContentHash });
    } else return false;
    chain = step.nextOwnerContentHash;
  }
  if (chain !== input.currentOwnerHash) return false;
  const [hashes] = await db.execute<{ values: Array<{ previous: string; next: string }> }>(sql`select coalesce(jsonb_agg(jsonb_build_object(
      'previous', public.aw_native_payload_body_hash('issue', to_jsonb(i) || jsonb_build_object('execution_state', p.value->'from')),
      'next', public.aw_native_payload_body_hash('issue', to_jsonb(i) || jsonb_build_object('execution_state', p.value->'to')))
      order by p.ordinality), '[]'::jsonb) as values
    from issues i, jsonb_array_elements(${JSON.stringify(pairs)}::jsonb) with ordinality as p(value, ordinality)
    where i.company_id=${input.companyId}::uuid and i.id=${input.issueId}::uuid`);
  const values = hashes?.values ?? [];
  return values.length === pairs.length && pairs.every((pair, index) =>
    values[index]?.previous === pair.previous && values[index]?.next === pair.next);
}
