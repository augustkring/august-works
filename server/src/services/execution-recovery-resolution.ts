import { hasWorkspaceRestoreFailure, nativePayloadSourceSnapshotSchema } from "@paperclipai/shared";
import { randomUUID } from "node:crypto";
import { conversationRecoveryActionPredicate, getConversationOwnershipBlocker } from "./conversation-continuation.js";
import { persistActivity } from "./activity-log.js";
import { appendHeartbeatRunEvent } from "./heartbeat-run-events.js";
import { logger } from "../middleware/logger.js";
import { and, eq, inArray, isNull, not, or, sql } from "drizzle-orm";
import {
  chatActions,
  environmentLeases,
  heartbeatRuns,
  agentExecutionManifests,
  assets,
  issueAttachments,
  issueRecoveryActions,
  issues,
  nativeRunFinalizations,
  runtimeCells,
  runtimeHostCommands,
  runtimeHosts,
  runtimeOperations,
  runtimePolicySnapshots,
  runtimeSandboxBindings,
  type Db,
} from "@paperclipai/db";
import { conflict } from "../errors.js";
import { buildExecutionContinuation } from "./execution-continuation.js";
import {
  EXECUTION_RECONCILIATION_CAUSES,
  type ExecutionReconciliation,
} from "@paperclipai/shared";
import { parseIssueExecutionState } from "./issue-execution-policy.js";
import { isSupersededConversationRun } from "./agent-conversations.js";
import { SANDBOX_HOST_COMMAND } from "@paperclipai/shared";
import { nativeSha256 } from "./native-runtime/canonical.js";

/** An operator records observed outcomes; this is not permission to blindly retry. */
export async function validateExecutionReconciliation(input: {
  db: Db;
  companyId: string;
  issueId: string;
  agentId: string | null;
  sourceRunId: unknown;
  decision: ExecutionReconciliation | undefined;
}) {
  const { db, companyId, issueId, agentId, decision } = input;
  if (!decision || decision.runId !== input.sourceRunId || !agentId) {
    throw conflict(
      "Reconcile the recorded execution and its action outcomes before continuing this task.",
    );
  }
  const [run] = await db
    .select()
    .from(heartbeatRuns)
    .where(
      and(
        eq(heartbeatRuns.companyId, companyId),
        eq(heartbeatRuns.id, decision.runId),
      ),
    );
  const [task] = await db
    .select()
    .from(issues)
    .where(and(eq(issues.companyId, companyId), eq(issues.id, issueId)));
  const review =
    task?.status === "in_review"
      ? parseIssueExecutionState(task.executionState)
      : null;
  const isCurrentReviewer =
    review?.status === "pending" &&
    review.currentParticipant?.type === "agent" &&
    review.currentParticipant.agentId === run?.agentId;
  if (
    !run ||
    !task ||
    task.assigneeAgentId !== agentId ||
    (run.agentId !== agentId && !isCurrentReviewer) ||
    (run.nativeIssueId ?? run.contextSnapshot?.issueId) !== issueId ||
    !["failed", "interrupted", "timed_out", "cancelled"].includes(run.status)
  ) {
    throw conflict(
      "The recovery source or task owner changed. Inspect the current execution before continuing.",
    );
  }
  if (hasWorkspaceRestoreFailure(run.resultJson) &&
      (!decision.workspaceRepairEvidence || decision.workspaceRepairEvidence.trim().length < 20)) {
    if (!decision.workspaceReconstruction) {
      throw conflict("Verify safe workspace staging or repair and record workspaceRepairEvidence before continuing this run.");
    }
  }
  if (decision.workspaceReconstruction) {
    if (!hasWorkspaceRestoreFailure(run.resultJson) || !decision.workspaceReconstruction.confirmed) {
      throw conflict("Saved-file reconstruction is available only for a failed run with a lost workspace.");
    }
    const destruction = await verifyNativeWorkspaceDestructionReceipt({ db, companyId, runId: run.id });
    if (!destruction || destruction.receiptHash !== decision.workspaceReconstruction.destructionReceiptHash) {
      throw conflict("The original native workspace destruction receipt is not current or verifiable.");
    }
    const selected = decision.workspaceReconstruction.selectedSources;
    const selectedIds = selected.map(source => source.attachmentId);
    if (new Set(selectedIds).size !== selectedIds.length) throw conflict("Selected reconstruction sources contain duplicates.");
    const attachmentRows = await db.select().from(issueAttachments).where(and(
      eq(issueAttachments.companyId, companyId), eq(issueAttachments.issueId, issueId),
      inArray(issueAttachments.id, selectedIds),
    ));
    if (attachmentRows.length !== selectedIds.length) throw conflict("A selected saved file is no longer available on this task.");
    const assetIds = attachmentRows.map(row => row.assetId);
    const assetRows = await db.select().from(assets).where(and(
      eq(assets.companyId, companyId), inArray(assets.id, assetIds),
    ));
    if (assetRows.length !== selectedIds.length) throw conflict("A selected saved file belongs to another source or company.");
    const assetById = new Map(assetRows.map(asset => [asset.id, asset]));
    for (const attachment of attachmentRows) {
      const snapshot = nativePayloadSourceSnapshotSchema.safeParse(attachment.payloadSourceSnapshot);
      const asset = assetById.get(attachment.assetId);
      const selectedSource = selected.find(source => source.attachmentId === attachment.id);
      const captured = snapshot.success ? snapshot.data.inputs.find(input => input.kind === "attachment" && input.attachmentId === attachment.id) : null;
      if (!asset || !selectedSource || attachment.payloadSourceProtocolVersion !== 1 || attachment.payloadSourceSnapshotInvalidated
        || !snapshot.success || snapshot.data.owner.kind !== "attachment" || snapshot.data.owner.companyId !== companyId
        || snapshot.data.owner.id !== attachment.id || captured?.kind !== "attachment" || captured.disposition !== "delivered"
        || captured.assetId !== asset.id || captured.sha256 !== asset.sha256 || captured.byteSize !== asset.byteSize
        || selectedSource.sha256 !== asset.sha256) {
        throw conflict("A selected saved file no longer matches its captured source hash and access snapshot.");
      }
    }
  }
  for (const pid of [
    run.processPid,
    run.processGroupId ? -run.processGroupId : null,
  ]) {
    if (!pid) continue;
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") continue;
      throw conflict(
        "The previous provider's process ownership cannot be verified.",
      );
    }
    throw conflict(
      "The previous provider is still running. Stop it before continuing.",
    );
  }
  const [coordinator] = await db
    .select()
    .from(nativeRunFinalizations)
    .where(
      and(
        eq(nativeRunFinalizations.companyId, companyId),
        eq(nativeRunFinalizations.runId, run.id),
      ),
    );
  if (coordinator?.leaseOwner || coordinator?.failureDetail?.successorRunId)
    throw conflict(
      "This execution still has a coordinator or a linked continuation. Inspect that run first.",
    );
  const leases = await db
    .select({ id: environmentLeases.id })
    .from(environmentLeases)
    .where(
      and(
        eq(environmentLeases.companyId, companyId),
        eq(environmentLeases.heartbeatRunId, run.id),
        isNull(environmentLeases.releasedAt),
      ),
    )
    .limit(1);
  if (leases.length)
    throw conflict(
      "The previous execution environment has not finished releasing its authority.",
    );
  await buildExecutionContinuation({
    db,
    companyId,
    issueId,
    agentId,
    context: { previousRunId: run.id },
    summary: null,
    exposeLowTrustRaw: false,
  });
  return run;
}

/** Return a receipt only when the failed run's exact native sandbox generation
 * has a durable completed Stop operation and a successful signed-host Destroy
 * completion. Host command replies are stored only after the native host
 * signature/epoch verifier accepts them. */
export async function verifyNativeWorkspaceDestructionReceipt(input: {
  db: Db;
  companyId: string;
  runId: string;
}): Promise<{ receiptHash: string; bindingId: string; cellId: string; generation: string } | null> {
  const [manifest] = await input.db.select().from(agentExecutionManifests).where(and(
    eq(agentExecutionManifests.companyId, input.companyId), eq(agentExecutionManifests.runId, input.runId),
  )).limit(1);
  if (!manifest) return null;
  const policies = await input.db.select().from(runtimePolicySnapshots).where(and(
    eq(runtimePolicySnapshots.companyId, input.companyId),
    eq(runtimePolicySnapshots.executionManifestId, manifest.id),
  ));
  for (const policy of policies) {
    if (policy.agentId !== manifest.agentId) continue;
    const [binding] = await input.db.select().from(runtimeSandboxBindings).where(and(
      eq(runtimeSandboxBindings.companyId, input.companyId), eq(runtimeSandboxBindings.id, policy.bindingId),
      eq(runtimeSandboxBindings.runtimeCellId, policy.runtimeCellId),
    )).limit(1);
    if (!binding) continue;
    const generation = binding.cellGeneration;
    const [cell] = await input.db.select().from(runtimeCells).where(and(
      eq(runtimeCells.companyId, input.companyId), eq(runtimeCells.id, policy.runtimeCellId),
    )).limit(1);
    if (!cell || cell.deletedAt || cell.generation.toString() !== generation) continue;
    const [host] = cell.runtimeHostId ? await input.db.select().from(runtimeHosts).where(eq(runtimeHosts.id, cell.runtimeHostId)).limit(1) : [];
    if (!host || host.credentialRevokedAt || host.fencedAt || host.retiredAt) continue;
    const operations = await input.db.select().from(runtimeOperations).where(and(
      eq(runtimeOperations.companyId, input.companyId), eq(runtimeOperations.runtimeCellId, cell.id),
      eq(runtimeOperations.operationType, "stop"), eq(runtimeOperations.status, "SUCCEEDED"),
      sql`${runtimeOperations.desiredState}->>'sandboxBindingId' = ${policy.bindingId}`,
      sql`${runtimeOperations.desiredState}->>'generation' = ${generation}`,
      sql`${runtimeOperations.desiredState}->>'executionManifestId' = ${manifest.id}`,
    ));
    for (const operation of operations) {
      const stopCommandId = (operation.desiredState as Record<string, unknown>).sandboxHostCommandId;
      if (typeof stopCommandId !== "string" || !operation.completedAt) continue;
      const [stopCommand] = await input.db.select().from(runtimeHostCommands).where(and(
        eq(runtimeHostCommands.id, stopCommandId), eq(runtimeHostCommands.runtimeHostId, host.id),
        eq(runtimeHostCommands.companyId, input.companyId), eq(runtimeHostCommands.runtimeCellId, cell.id),
        eq(runtimeHostCommands.cellGeneration, BigInt(generation)),
        eq(runtimeHostCommands.commandType, SANDBOX_HOST_COMMAND), eq(runtimeHostCommands.status, "SUCCEEDED"),
      )).limit(1);
      if (!stopCommand) continue;
      const stopRequest = stopCommand.payload as Record<string, any>;
      const stopResult = stopCommand.safeResult as Record<string, unknown> | null;
      if (stopRequest.action !== "stop" || stopRequest.hostEpoch !== host.credentialVersion
        || stopRequest.scope?.bindingId !== policy.bindingId || stopRequest.scope?.cellId !== cell.id
        || stopRequest.scope?.cellGeneration !== generation
        || stopResult?.action !== "stop" || stopResult.stopped !== true) continue;

      const destroyCommands = await input.db.select().from(runtimeHostCommands).where(and(
        eq(runtimeHostCommands.runtimeHostId, host.id), eq(runtimeHostCommands.companyId, input.companyId),
        eq(runtimeHostCommands.runtimeCellId, cell.id), eq(runtimeHostCommands.cellGeneration, BigInt(generation)),
        eq(runtimeHostCommands.commandType, SANDBOX_HOST_COMMAND), eq(runtimeHostCommands.status, "SUCCEEDED"),
        sql`${runtimeHostCommands.payload}->>'action' = 'destroy'`,
      ));
      const destroyCommand = destroyCommands.find(command => {
        const request = command.payload as Record<string, any>;
        const result = command.safeResult as Record<string, unknown> | null;
        return request.hostEpoch === host.credentialVersion
          && request.scope?.bindingId === policy.bindingId
          && request.scope?.cellId === cell.id
          && request.scope?.cellGeneration === generation
          && result?.action === "destroy" && result.destroyed === true && command.completedAt !== null;
      });
      if (!destroyCommand) continue;
      return {
        receiptHash: nativeSha256({ runId: input.runId, manifestId: manifest.id, policySnapshotId: policy.id,
          bindingId: policy.bindingId, cellId: cell.id, generation,
          hostId: host.id, hostEpoch: host.credentialVersion, stopOperationId: operation.id,
          stopCommandId: stopCommand.id, destroyCommandId: destroyCommand.id,
          stopCompletedAt: stopCommand.completedAt?.toISOString(), destroyCompletedAt: destroyCommand.completedAt?.toISOString() }),
        bindingId: policy.bindingId, cellId: cell.id, generation,
      };
    }
  }
  return null;
}

/** Durable delivery marker lives on the existing source-scoped recovery action. */
export async function markExecutionReconciliation(
  db: Db,
  action: Pick<
    typeof issueRecoveryActions.$inferSelect,
    "companyId" | "id" | "evidence" | "sourceIssueId"
  >,
  decision: ExecutionReconciliation,
  actorId: string,
  deliveryOwner?: { kind: "chat_failed_run_retry"; actionId: string },
  requestHash?: string,
) {
  if (deliveryOwner) {
    const [retry] = await db
      .select()
      .from(chatActions)
      .where(
        and(
          eq(chatActions.companyId, action.companyId),
          eq(chatActions.id, deliveryOwner.actionId),
        ),
      );
    if (
      deliveryOwner.kind !== "chat_failed_run_retry" ||
      !retry ||
      retry.kind !== "failed_run_retry" ||
      !["issued", "processing", "processed"].includes(retry.status) ||
      retry.payload.version !== 1 ||
      retry.payload.failedRunId !== decision.runId ||
      retry.payload.issueId !== action.sourceIssueId
    ) {
      throw conflict("The authorized chat retry owner is no longer valid.");
    }
  }
  await db
    .update(nativeRunFinalizations)
    .set({
      failureDetail: sql`coalesce(${nativeRunFinalizations.failureDetail}, '{}'::jsonb) || ${JSON.stringify({ replacementDenied: "operator_reconciled" })}::jsonb`,
    })
    .where(
      and(
        eq(nativeRunFinalizations.companyId, action.companyId),
        eq(nativeRunFinalizations.runId, decision.runId),
      ),
    );
  await db
    .update(issueRecoveryActions)
    .set({
      evidence: {
        ...action.evidence,
        automaticRecovery: undefined,
        executionReconciliation: {
          ...decision,
          actorId,
          recordedAt: new Date().toISOString(),
        },
        ...(decision.workspaceReconstruction && requestHash ? { workspaceReconstructionRequestHash: requestHash } : {}),
        continuationDelivery: deliveryOwner ? "delegated" : "pending",
        ...(deliveryOwner ? { continuationDeliveryOwner: deliveryOwner } : {}),
      },
    })
    .where(
      and(
        eq(issueRecoveryActions.companyId, action.companyId),
        eq(issueRecoveryActions.id, action.id),
      ),
    );
}

export async function deliverReconciledExecutions(
  db: Db,
  wake: ReturnType<typeof import("./heartbeat.js").heartbeatService>["wakeup"],
) {
  const pending = await db
    .select()
    .from(issueRecoveryActions)
    .where(
      and(
        eq(issueRecoveryActions.status, "resolved"),
        sql`${issueRecoveryActions.evidence}->>'continuationDelivery' = 'pending'`,
      ),
    )
    .limit(25);
  for (const action of pending) {
    try {
      const decision = action.evidence.executionReconciliation as
        ExecutionReconciliation | undefined;
      if (!decision || !action.returnOwnerAgentId) continue;
      const pendingDecision = and(
        eq(issueRecoveryActions.companyId, action.companyId),
        eq(issueRecoveryActions.id, action.id),
        eq(issueRecoveryActions.status, "resolved"),
        sql`${issueRecoveryActions.evidence}->>'continuationDelivery' = 'pending'`,
        sql`${issueRecoveryActions.evidence}->'executionReconciliation' = ${JSON.stringify(decision)}::jsonb`,
      );
      const [task] = await db
        .select()
        .from(issues)
        .where(
          and(
            eq(issues.companyId, action.companyId),
            eq(issues.id, action.sourceIssueId),
          ),
        );
      if (
        !task ||
        task.assigneeAgentId !== action.returnOwnerAgentId ||
        ["done", "cancelled"].includes(task.status)
      ) {
        await db
          .update(issueRecoveryActions)
          .set({
            evidence: sql`${issueRecoveryActions.evidence} || '{"continuationDelivery":"invalidated"}'::jsonb`,
          })
          .where(pendingDecision);
        continue;
      }
      try {
        await validateExecutionReconciliation({
          db,
          companyId: action.companyId,
          issueId: task.id,
          agentId: task.assigneeAgentId,
          sourceRunId: decision.runId,
          decision,
        });
      } catch {
        await db.update(issueRecoveryActions).set({
          evidence: sql`${issueRecoveryActions.evidence} || '{"continuationDelivery":"invalidated"}'::jsonb`,
        }).where(pendingDecision);
        continue;
      }
      const run = await wake(action.returnOwnerAgentId, {
        source: "automation",
        triggerDetail: "system",
        reason: "issue_recovery_action_restored",
        idempotencyKey: `execution-reconciliation:${action.id}`,
        payload: { issueId: task.id, recoveryActionId: action.id },
        requestedByActorType: "system",
        requestedByActorId: "execution-recovery",
        contextSnapshot: {
          issueId: task.id,
          taskId: task.id,
          recoveryActionId: action.id,
          previousRunId: decision.runId,
          retryOfRunId: decision.runId,
          forceFreshSession: true,
          wakeReason: "issue_recovery_action_restored",
          source: "execution.reconciled",
          ...(decision.workspaceReconstruction ? { selectedSavedSources: decision.workspaceReconstruction.selectedSources } : {}),
        },
      });
      if (run)
        await db.transaction(async (tx) => {
          await tx
            .update(heartbeatRuns)
            .set({ retryOfRunId: decision.runId })
            .where(
              and(
                eq(heartbeatRuns.companyId, action.companyId),
                eq(heartbeatRuns.id, run.id),
                eq(heartbeatRuns.agentId, action.returnOwnerAgentId!),
                sql`${heartbeatRuns.contextSnapshot}->>'recoveryActionId' = ${action.id}`,
                sql`${heartbeatRuns.contextSnapshot}->>'previousRunId' = ${decision.runId}`,
              ),
            );
          await tx
            .update(issueRecoveryActions)
            .set({
              evidence: sql`${issueRecoveryActions.evidence} || ${JSON.stringify(
                {
                  continuationDelivery: "delivered",
                  continuationRunId: run.id,
                },
              )}::jsonb`,
            })
            .where(pendingDecision);
        });
    } catch {
      logger.warn(
        { recoveryActionId: action.id },
        "Reconciled execution continuation remains pending for retry",
      );
    }
  }
}

/**
 * Failed execution is a system responsibility, not a user questionnaire. After
 * automatic recovery is ruled out, preserve evidence and stop without replay.
 * This is NOT evidence that an external action succeeded or never happened.
 * The resolved record retains a dispatch hold until actual evidence clears it.
 */
export async function settleUnrecoverableExecutions(
  db: Db,
  now = new Date(),
  options: { failpoint?: (phase: "persisted") => void } = {},
) {
  // Fold obsolete conversation holds without waking historical work on upgrade.
  // Keep their evidence and record the policy change in the task's activity log.
  const obsoleteConversationHold = and(
    conversationRecoveryActionPredicate(),
    or(
      inArray(issueRecoveryActions.status, ["active", "escalated"]),
      sql`${issueRecoveryActions.evidence}->'automaticRecovery'->>'replay' = 'blocked'`,
    ),
  );
  await db.transaction(async tx => {
    const foldable = await tx.select().from(issueRecoveryActions).where(obsoleteConversationHold)
      .limit(25).for("update", { skipLocked: true });
    for (const candidate of foldable) {
      if (await getConversationOwnershipBlocker(tx as unknown as Db, candidate.companyId, candidate.sourceIssueId)) continue;
      const [action] = await tx.update(issueRecoveryActions).set({
        status: "resolved",
        outcome: "cancelled",
        resolvedAt: now,
        updatedAt: now,
        nextAction: "Automatic attempts stopped. Send a new message to continue the conversation.",
        resolutionNote: "Conversation continuation does not replay prior tool calls.",
        wakePolicy: null,
        monitorPolicy: null,
        evidence: sql`case when ${issueRecoveryActions.evidence} ? 'automaticRecovery'
          then jsonb_set(${issueRecoveryActions.evidence}, '{automaticRecovery,replay}', '"conversation_continuation"'::jsonb)
          else ${issueRecoveryActions.evidence} end`,
      }).where(and(obsoleteConversationHold, eq(issueRecoveryActions.id, candidate.id))).returning();
      if (!action) continue;
      await persistActivity(tx as unknown as Db, {
        companyId: action.companyId,
        actorType: "system",
        actorId: "execution-recovery",
        action: "issue.execution_recovery_settled",
        entityType: "issue",
        entityId: action.sourceIssueId,
        details: { recoveryActionId: action.id, outcome: "cancelled", continuation: "conversation" },
      });
    }
  });
  // Filter eligibility before applying the batch limit. A queue of sessions
  // awaiting replacement must not starve settled incidents behind it.
  const candidates = await db
    .select({ action: issueRecoveryActions })
    .from(issueRecoveryActions)
    .innerJoin(
      heartbeatRuns,
      and(
        eq(heartbeatRuns.companyId, issueRecoveryActions.companyId),
        sql`${heartbeatRuns.id}::text = ${issueRecoveryActions.evidence}->>'runId'`,
        sql`coalesce(${heartbeatRuns.nativeIssueId}::text, ${heartbeatRuns.contextSnapshot}->>'issueId') = ${issueRecoveryActions.sourceIssueId}::text`,
      ),
    )
    .leftJoin(
      nativeRunFinalizations,
      and(
        eq(nativeRunFinalizations.companyId, heartbeatRuns.companyId),
        eq(nativeRunFinalizations.runId, heartbeatRuns.id),
      ),
    )
    .where(
      and(
        not(conversationRecoveryActionPredicate()!),
        inArray(issueRecoveryActions.status, ["active", "escalated"]),
        eq(issueRecoveryActions.kind, "active_run_watchdog"),
        inArray(issueRecoveryActions.cause, [
          ...EXECUTION_RECONCILIATION_CAUSES,
        ]),
        inArray(heartbeatRuns.status, [
          "failed",
          "timed_out",
          "interrupted",
          "cancelled",
        ]),
        isNull(nativeRunFinalizations.leaseOwner),
        isNull(nativeRunFinalizations.resultId),
        or(
          isNull(nativeRunFinalizations.runId),
          eq(nativeRunFinalizations.phase, "terminal_failure"),
        ),
        sql`coalesce(${nativeRunFinalizations.failureDetail}->>'successorRunId', '') = ''`,
        sql`(${heartbeatRuns.runtimeMode} <> 'native' or coalesce(${nativeRunFinalizations.failureCode}, '') <> 'native_provider_terminal_failed'
        or coalesce(${nativeRunFinalizations.failureDetail}->>'replacementDenied', '') <> '')`,
      ),
    )
    .limit(25);
  for (const { action: candidate } of candidates) {
    const runId = candidate.evidence.runId;
    if (typeof runId !== "string") continue;
    try {
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`select set_config('statement_timeout', '15000', true), set_config('lock_timeout', '1000', true)`,
        );
        // Same issue -> coordinator -> run ordering as replacement/finalization.
        const [task] = await tx
          .select()
          .from(issues)
          .where(
            and(
              eq(issues.companyId, candidate.companyId),
              eq(issues.id, candidate.sourceIssueId),
            ),
          )
          .for("update");
        const [coordinator] = await tx
          .select()
          .from(nativeRunFinalizations)
          .where(
            and(
              eq(nativeRunFinalizations.companyId, candidate.companyId),
              eq(nativeRunFinalizations.runId, runId),
            ),
          )
          .for("update");
        const [run] = await tx
          .select()
          .from(heartbeatRuns)
          .where(
            and(
              eq(heartbeatRuns.companyId, candidate.companyId),
              eq(heartbeatRuns.id, runId),
            ),
          )
          .for("update");
        const [action] = await tx
          .select()
          .from(issueRecoveryActions)
          .where(eq(issueRecoveryActions.id, candidate.id))
          .for("update");
        if (
          !task ||
          !run ||
          !action ||
          action.evidence.runId !== runId ||
          !EXECUTION_RECONCILIATION_CAUSES.includes(
            action.cause as (typeof EXECUTION_RECONCILIATION_CAUSES)[number],
          ) ||
          !["active", "escalated"].includes(action.status) ||
          (run.nativeIssueId ?? run.contextSnapshot?.issueId) !== task.id ||
          !["failed", "timed_out", "interrupted", "cancelled"].includes(
            run.status,
          )
        )
          return;
        // Give durable native recovery its chance; never preempt a resume,
        // replacement, result finalizer, or still-owned execution.
        if (
          coordinator?.leaseOwner ||
          coordinator?.resultId ||
          coordinator?.failureDetail?.successorRunId ||
          (coordinator && coordinator.phase !== "terminal_failure") ||
          (run.runtimeMode === "native" &&
            coordinator?.failureCode === "native_provider_terminal_failed" &&
            !coordinator.failureDetail?.replacementDenied)
        )
          return;
        const current =
          !isSupersededConversationRun(task, run) &&
          action.returnOwnerAgentId !== null &&
          task.assigneeAgentId === action.returnOwnerAgentId &&
          !["done", "cancelled"].includes(task.status) &&
          (!task.executionRunId || task.executionRunId === run.id) &&
          (!task.checkoutRunId || task.checkoutRunId === run.id);
        const note = current
          ? hasWorkspaceRestoreFailure(run.resultJson)
            ? "Workspace repair required. Verify safe staging or repair before continuing. Saved work and approval decisions remain in force."
            : "Automatic recovery stopped. Recorded work is preserved; actions with unverified outcomes will not be repeated."
          : "Recovery closed because the task's owner, execution, or status changed. No work was replayed.";
        let nativeFailureBlock = action.evidence.nativeFailureBlock;
        if (current) {
          const [projected] = await tx
            .update(issues)
            .set({
              status: "blocked",
              executionRunId: null,
              checkoutRunId: null,
              updatedAt: now,
            })
            .where(eq(issues.id, task.id)).returning();
          // Only a transition owned by this failure grants a recovery receipt.
          // An already-blocked task may have a separate human/dependency hold.
          if (task.status !== "blocked" && run.runtimeMode === "native") {
            nativeFailureBlock = { runId: run.id, statusVersion: projected!.statusVersion };
          }
        }
        await tx
          .update(issueRecoveryActions)
          .set({
            status: "resolved",
            outcome: current ? "blocked" : "cancelled",
            resolvedAt: now,
            updatedAt: now,
            nextAction: note,
            resolutionNote: note,
            wakePolicy: null,
            monitorPolicy: null,
            evidence: {
              ...action.evidence,
              ...(nativeFailureBlock ? { nativeFailureBlock } : {}),
              automaticRecovery: {
                policy: "preserve_without_replay_v1",
                runId: run.id,
                replay: "blocked",
                actionOutcome: "unknown",
                recordedAt: now.toISOString(),
              },
            },
          })
          .where(eq(issueRecoveryActions.id, action.id));
        await persistActivity(tx as unknown as Db, {
          companyId: run.companyId,
          actorType: "system",
          actorId: "execution-recovery",
          action: "issue.execution_recovery_settled",
          entityType: "issue",
          entityId: task.id,
          runId: run.id,
          details: {
            recoveryActionId: action.id,
            outcome: current ? "blocked" : "cancelled",
            replay: "not_authorized",
          },
        });
        await tx
          .update(heartbeatRuns)
          .set({ executionStatusDeliveryId: randomUUID() })
          .where(eq(heartbeatRuns.id, run.id));
        await appendHeartbeatRunEvent(tx as unknown as Db, {
          companyId: run.companyId,
          agentId: run.agentId,
          runId: run.id,
          eventType: "lifecycle",
          stream: "system",
          level: "warn",
          message: note,
          payload: {
            recoveryActionId: action.id,
            cause: action.cause,
            automaticRecovery: "preserve_without_replay_v1",
            replay: "blocked",
          },
        });
        options.failpoint?.("persisted");
      });
    } catch (err) {
      if (options.failpoint) throw err;
      logger.warn(
        { err, recoveryActionId: candidate.id },
        "Automatic recovery disposition remains pending",
      );
    }
  }
}
