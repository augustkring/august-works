import { and, eq, sql } from "drizzle-orm";
import {
  agents,
  agentIdentities,
  companies,
  agentExecutionManifests,
  heartbeatRuns,
  issues,
  orchestrationPlans,
  issuePlanDecompositions,
  issueDocuments,
  documents,
  issueThreadInteractions,
  orchestrationWorkers,
  orchestrationWorkerAttempts,
  toolInvocations,
  type Db,
} from "@paperclipai/db";
import { orchestrationCompletionSchema } from "@paperclipai/shared";
import { badRequest, conflict, forbidden } from "../../errors.js";
import {
  assertAgentRunWriteAllowed,
  agentRunWritesRevoked,
} from "../../agent-run-cancellation.js";
import { assertV7Authorization, assertV7Enabled } from "../v7-authorization.js";
import {
  heartbeatMemoryPayloadRetained,
  lockMemoryPrivacy,
} from "../memory/memory-privacy.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { retainedOrchestrationContract } from "./orchestration-contracts.js";
import { agentProviderBindingService } from "../agent-provider-bindings.js";
import { enqueueSupervisionStop } from "../supervision/supervision-outbox.js";
import { withV7ActivityTransaction, logActivity } from "../v7-mutations.js";

type Binding = {
  companyId: string;
  issueId: string;
  agentId: string;
  runId: string;
};
type Call = { tool: string; callId: string; arguments: unknown };
const reads = new Set([
  "get_task_context",
  "get_task_history",
  "list_documents",
  "read_document",
  "list_document_revisions",
  "paperclip_search_assigned_tools",
]);
const draftWrites = new Set([
  "write_document",
  "report_progress",
  "request_human_input",
]);

async function scope(db: Db, b: Binding) {
  const [attempt] = await db
    .select({
      plan: orchestrationPlans,
      attempt: orchestrationWorkerAttempts,
      worker: orchestrationWorkers,
    })
    .from(orchestrationWorkerAttempts)
    .innerJoin(
      orchestrationPlans,
      and(
        eq(orchestrationPlans.companyId, orchestrationWorkerAttempts.companyId),
        eq(orchestrationPlans.id, orchestrationWorkerAttempts.planId),
      ),
    )
    .innerJoin(
      orchestrationWorkers,
      and(
        eq(
          orchestrationWorkers.companyId,
          orchestrationWorkerAttempts.companyId,
        ),
        eq(orchestrationWorkers.id, orchestrationWorkerAttempts.workerId),
      ),
    )
    .where(
      and(
        eq(orchestrationWorkerAttempts.companyId, b.companyId),
        eq(orchestrationWorkerAttempts.runId, b.runId),
      ),
    )
    .limit(1);
  if (attempt) return attempt;
  const [unadmitted] = await db
    .select({ id: orchestrationPlans.id })
    .from(orchestrationPlans)
    .leftJoin(
      orchestrationWorkers,
      and(
        eq(orchestrationWorkers.companyId, orchestrationPlans.companyId),
        eq(orchestrationWorkers.planId, orchestrationPlans.id),
      ),
    )
    .where(
      and(
        eq(orchestrationPlans.companyId, b.companyId),
        sql`(${orchestrationWorkers.issueId} = ${b.issueId} or ${orchestrationPlans.issueId} = ${b.issueId})`,
        sql`${orchestrationPlans.status} not in ('completed','cancelled','failed')`,
      ),
    )
    .limit(1);
  if (unadmitted)
    throw forbidden("Native tools require the plan's admitted worker attempt");
  return null;
}

/** Called before Task/run mutation locks, preserving Memory -> plan -> Task -> run order. */
export async function lockNativeToolPlan(db: Db, b: Binding) {
  const bound = await scope(db, b);
  if (!bound) return null;
  await lockMemoryPrivacy(db, b.companyId);
  const [plan] = await db
    .select()
    .from(orchestrationPlans)
    .where(
      and(
        eq(orchestrationPlans.companyId, b.companyId),
        eq(orchestrationPlans.id, bound.plan.id),
      ),
    )
    .for("update");
  return { ...bound, plan: plan! };
}

/** Reused inside the existing Native mutation transaction, after its locks. */
export async function assertNativeToolPlanCurrent(
  db: Db,
  b: Binding,
  mutation = false,
) {
  const bound = await scope(db, b);
  if (!bound) return null;
  const { plan, attempt, worker } = bound;
  const principal = plan.executionPrincipal;
  const userId = principal?.type === "user" ? principal.userId : null;
  const localBoard =
    principal?.type === "system" && principal.service === "local-board";
  await assertV7Enabled(db, "orchestration_v7");
  if (
    plan.status !== "running" ||
    plan.erasedAt ||
    !plan.startedAt ||
    (!userId && !localBoard) ||
    Date.now() >=
      plan.startedAt.getTime() + plan.budgets.maxWallClockSeconds * 1000 ||
    attempt.status !== "running" ||
    worker.status !== "running" ||
    worker.issueId !== b.issueId ||
    worker.agentId !== b.agentId ||
    attempt.agentId !== b.agentId ||
    !attempt.executionManifestId
  )
    throw forbidden("Native plan tool authority is no longer current");
  const [run] = await db
    .select()
    .from(heartbeatRuns)
    .where(
      and(
        eq(heartbeatRuns.companyId, b.companyId),
        eq(heartbeatRuns.id, b.runId),
        eq(heartbeatRuns.agentId, b.agentId),
      ),
    );
  const [task] = await db
    .select()
    .from(issues)
    .where(and(eq(issues.companyId, b.companyId), eq(issues.id, b.issueId)));
  const [manifest] = await db
    .select()
    .from(agentExecutionManifests)
    .where(
      and(
        eq(agentExecutionManifests.companyId, b.companyId),
        eq(agentExecutionManifests.id, attempt.executionManifestId),
        eq(agentExecutionManifests.runId, b.runId),
        eq(agentExecutionManifests.agentId, b.agentId),
      ),
    );
  const [presence] = await db
    .select({ agent: agents, identity: agentIdentities, company: companies })
    .from(agents)
    .innerJoin(agentIdentities, eq(agentIdentities.id, agents.agentIdentityId))
    .innerJoin(companies, eq(companies.id, agents.companyId))
    .where(and(eq(agents.companyId, b.companyId), eq(agents.id, b.agentId)));
  if (
    !run ||
    run.status !== "running" ||
    run.runtimeMode !== "native" ||
    run.nativeIssueId !== b.issueId ||
    agentRunWritesRevoked(run) ||
    run.responsibleUserId !== userId ||
    !task ||
    task.assigneeAgentId !== b.agentId ||
    task.executionRunId !== b.runId ||
    (task.checkoutRunId && task.checkoutRunId !== b.runId) ||
    task.hiddenAt ||
    ["done", "cancelled"].includes(task.status) ||
    !manifest ||
    manifest.manifest.responsibleUserId !== run.responsibleUserId ||
    manifest.manifest.executionScope.delegatedScopes.length ||
    !presence ||
    presence.identity.status !== "active" ||
    presence.company.status !== "active" ||
    !["idle", "running", "active"].includes(presence.agent.status) ||
    !(await heartbeatMemoryPayloadRetained(db, b.companyId, b.runId))
  )
    throw forbidden("Native tool Task/run/source ownership changed");
  const resource = {
    type: "issue" as const,
    companyId: b.companyId,
    issueId: task.id,
    projectId: task.projectId,
    parentIssueId: task.parentId,
    assigneeAgentId: task.assigneeAgentId,
    assigneeUserId: task.assigneeUserId,
    status: task.status,
  };
  const initiatingActor = localBoard
    ? { type: "board" as const, source: "local_implicit" as const }
    : { type: "board" as const, source: "session" as const, userId: userId! };
  await assertV7Authorization(
    db,
    initiatingActor,
    b.companyId,
    "issue:mutate",
    resource,
  );
  await assertV7Authorization(
    db,
    {
      type: "agent",
      source: "agent_jwt",
      companyId: b.companyId,
      agentId: b.agentId,
      runId: b.runId,
      onBehalfOfUserId: run.responsibleUserId,
    },
    b.companyId,
    mutation ? "issue:mutate" : "issue:read",
    resource,
  );
  await assertAgentRunWriteAllowed(db, b.companyId, b);
  const provider = await agentProviderBindingService(db).assertRuntime(
    b.companyId,
    b.agentId,
  );
  const pin = manifest.manifest.providers.find(
    (p) => p.companyId === b.companyId && p.agentId === b.agentId,
  );
  if (
    !pin ||
    pin.providerBindingId !== provider.provider.id ||
    pin.profileRef !== provider.runtime.providerProfileRef ||
    pin.snapshotHash !== provider.provider.capabilitySnapshot?.hash
  )
    throw forbidden("Native tool provider configuration changed");
  const [root] = await db
    .select()
    .from(issues)
    .where(and(eq(issues.companyId, b.companyId), eq(issues.id, plan.issueId)));
  if (
    !root ||
    root.hiddenAt ||
    ["done", "cancelled"].includes(root.status) ||
    task.requestDepth < root.requestDepth ||
    task.requestDepth - root.requestDepth > plan.budgets.maxDelegationDepth ||
    (plan.mode === "planned_parallel" &&
      (task.parentId !== root.id || task.projectId !== root.projectId))
  )
    throw forbidden("Native tool canonical plan topology changed");
  await assertV7Authorization(db, initiatingActor, b.companyId, "issue:read", {
    type: "issue",
    companyId: b.companyId,
    issueId: root.id,
  });
  if (plan.mode === "planned_parallel") {
    const [accepted] = await db
      .select()
      .from(issuePlanDecompositions)
      .where(
        and(
          eq(issuePlanDecompositions.companyId, b.companyId),
          eq(issuePlanDecompositions.sourceIssueId, root.id),
          eq(
            issuePlanDecompositions.acceptedPlanRevisionId,
            plan.acceptedPlanRevisionId!,
          ),
        ),
      );
    const [revision] = await db
      .select({ id: documents.latestRevisionId })
      .from(issueDocuments)
      .innerJoin(
        documents,
        and(
          eq(documents.companyId, issueDocuments.companyId),
          eq(documents.id, issueDocuments.documentId),
        ),
      )
      .where(
        and(
          eq(issueDocuments.companyId, b.companyId),
          eq(issueDocuments.issueId, root.id),
          eq(issueDocuments.key, "plan"),
        ),
      );
    const [confirmation] = accepted?.acceptedInteractionId
      ? await db
          .select()
          .from(issueThreadInteractions)
          .where(
            and(
              eq(issueThreadInteractions.companyId, b.companyId),
              eq(issueThreadInteractions.id, accepted.acceptedInteractionId),
            ),
          )
      : [];
    if (
      !accepted ||
      accepted.status !== "completed" ||
      revision?.id !== plan.acceptedPlanRevisionId ||
      confirmation?.status !== "accepted"
    )
      throw forbidden("Native tool accepted decomposition changed");
  }
  await retainedOrchestrationContract(db, b.companyId, b.issueId);
  return bound;
}

async function fence(db: Db, b: Binding, planId: string, reasonCode: string) {
  await withV7ActivityTransaction(db, async (tx, publications) => {
    await lockMemoryPrivacy(tx, b.companyId);
    const [plan] = await tx
      .select()
      .from(orchestrationPlans)
      .where(
        and(
          eq(orchestrationPlans.companyId, b.companyId),
          eq(orchestrationPlans.id, planId),
        ),
      )
      .for("update");
    if (
      !plan ||
      plan.erasedAt ||
      ["completed", "cancelled", "failed"].includes(plan.status)
    )
      return;
    const [paused] =
      plan.status === "running"
        ? await tx
            .update(orchestrationPlans)
            .set({
              status: "paused",
              version: plan.version + 1,
              updatedAt: new Date(),
            })
            .where(eq(orchestrationPlans.id, plan.id))
            .returning()
        : [plan];
    const attempts = await tx
      .select({ id: orchestrationWorkerAttempts.id })
      .from(orchestrationWorkerAttempts)
      .where(
        and(
          eq(orchestrationWorkerAttempts.companyId, b.companyId),
          eq(orchestrationWorkerAttempts.planId, plan.id),
          eq(orchestrationWorkerAttempts.status, "running"),
        ),
      );
    const stop = await enqueueSupervisionStop(tx, paused!, {
      actorType: "system",
      actorId: "native-tool-boundary",
      action: "ESCALATE_HUMAN",
      reasonCode,
      rationale: "The bounded native tool call requires human resolution",
      attemptIds: attempts.map((a) => a.id),
    });
    await logActivity(
      tx,
      {
        companyId: b.companyId,
        actorType: "system",
        actorId: "native-tool-boundary",
        action: "orchestration.native_tool_fenced",
        entityType: "orchestration_plan",
        entityId: plan.id,
        details: { reasonCode, interventionId: stop?.id ?? null },
      },
      publications,
    );
  });
}

/** Native Task builtins share tool_invocations and its SQL charge guard with
 * connected tools. No second ledger, result cache, queue or automatic resend. */
export async function withOrchestrationNativeTool<T>(
  db: Db,
  b: Binding,
  call: Call,
  effect: () => Promise<T>,
  externallyMetered = false,
): Promise<T> {
  const preliminary = await scope(db, b);
  if (!preliminary) return effect();
  if (!/^[\x21-\x7e]{1,240}$/.test(call.callId))
    throw badRequest("Native tool call identity must be bounded");
  // Assigned MCP execution retains its own qualified classification, approval
  // and native invocation charge. Other generic APIs/connectors are not an
  // escape from the plan's current scope or material-action contract.
  if (
    !externallyMetered &&
    !reads.has(call.tool) &&
    !draftWrites.has(call.tool)
  )
    throw forbidden(
      "This native tool has no bounded plan action qualification",
    );
  const bytes = JSON.stringify(call.arguments);
  if (Buffer.byteLength(bytes ?? "", "utf8") > 256000)
    throw badRequest("Native tool arguments exceed the bounded envelope");
  const inputHash = nativeSha256({
    runId: b.runId,
    tool: call.tool,
    arguments: call.arguments,
  });
  const idempotencyKey = `aw-native-tool:${b.runId}:${call.callId}`;
  let exhausted = false;
  const reservation = await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    await lockMemoryPrivacy(t, b.companyId);
    await lockNativeToolPlan(t, b);
    const bound = await assertNativeToolPlanCurrent(
      t,
      b,
      draftWrites.has(call.tool),
    );
    if (!bound) throw forbidden("Native tool plan disappeared during dispatch");
    if (externallyMetered) return null;
    if (draftWrites.has(call.tool)) {
      if (
        bound.plan.actionClass !== "internal_draft" ||
        !["C0", "C1"].includes(bound.plan.riskClass)
      )
        throw forbidden(
          "Native draft writes cannot bypass a material action contract",
        );
      if (call.tool === "write_document") {
        const retained = await retainedOrchestrationContract(
          t,
          b.companyId,
          b.issueId,
        );
        const contract = orchestrationCompletionSchema.parse(
          retained!.row.contractJson.v7,
        );
        const args =
          call.arguments && typeof call.arguments === "object"
            ? (call.arguments as Record<string, unknown>)
            : {};
        if (!contract.requiredOutputs.some((output) => output.key === args.key))
          throw forbidden(
            "Native draft writes must use a declared completion output",
          );
      }
    }
    const [existing] = await t
      .select()
      .from(toolInvocations)
      .where(
        and(
          eq(toolInvocations.companyId, b.companyId),
          eq(toolInvocations.idempotencyKey, idempotencyKey),
        ),
      );
    if (existing) {
      if (existing.idempotencyRequestHash !== inputHash)
        throw conflict("Native tool call identity changed");
      throw conflict(
        "Native tool dispatch is already committed; use retained protocol results",
      );
    }
    if (bound.plan.toolActionsUsed >= bound.plan.budgets.maxToolActions) {
      exhausted = true;
      return null;
    }
    const [receipt] = await t
      .insert(toolInvocations)
      .values({
        companyId: b.companyId,
        runId: b.runId,
        issueId: b.issueId,
        agentId: b.agentId,
        actorType: "agent",
        actorId: b.agentId,
        idempotencyKey,
        idempotencyRequestHash: inputHash,
        toolName: call.tool,
        argumentsHash: nativeSha256(call.arguments),
        // Low-risk canonical draft bookkeeping is distinct from connected-tool
        // write/destructive authority. It never authorizes external side effects.
        riskLevel: reads.has(call.tool) ? "read" : "low",
        policyDecision: "allow",
        approvalState: "not_required",
        status: "executing",
        startedAt: new Date(),
      })
      .returning();
    return receipt!;
  });
  if (exhausted) {
    await fence(db, b, preliminary.plan.id, "native_tool_budget_exhausted");
    throw forbidden("The cumulative native tool budget is exhausted");
  }
  try {
    const result = await effect();
    await db.transaction(async (tx) => {
      const t = tx as unknown as Db;
      await lockMemoryPrivacy(t, b.companyId);
      await lockNativeToolPlan(t, b);
      await assertNativeToolPlanCurrent(t, b, draftWrites.has(call.tool));
    });
    if (reservation)
      await db
        .update(toolInvocations)
        .set({
          status:
            result &&
            typeof result === "object" &&
            "ok" in result &&
            result.ok === false
              ? "failed"
              : "succeeded",
          errorCode:
            result &&
            typeof result === "object" &&
            "ok" in result &&
            result.ok === false
              ? "native_tool_denied"
              : null,
          resultHash: nativeSha256(result),
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(toolInvocations.companyId, b.companyId),
            eq(toolInvocations.id, reservation.id),
          ),
        );
    return result;
  } catch (error) {
    if (reservation)
      await db
        .update(toolInvocations)
        .set({
          status: "failed",
          errorCode: "native_tool_result_unsettled",
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(toolInvocations.companyId, b.companyId),
            eq(toolInvocations.id, reservation.id),
          ),
        );
    await fence(db, b, preliminary.plan.id, "native_tool_result_unsettled");
    throw error;
  }
}
