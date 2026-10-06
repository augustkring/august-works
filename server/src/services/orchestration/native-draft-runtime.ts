import { and, eq } from "drizzle-orm";
import {
  heartbeatRuns,
  issues,
  orchestrationPlans,
  orchestrationWorkers,
  orchestrationWorkerAttempts,
  type Db,
} from "@paperclipai/db";
import { orchestrationCompletionSchema } from "@paperclipai/shared";
import type {
  NativeExecutionInput,
  NativeSessionBackend,
} from "../../vendor/paperclip-runner/index.js";
import { conflict, forbidden } from "../../errors.js";
import { assertV7Authorization } from "../v7-authorization.js";
import type { workerModelGateway } from "./worker-model-gateway.js";
import { retainedOrchestrationContract } from "./orchestration-contracts.js";
import { readNativeRuntimeAssetText } from "../native-runtime/runtime-context.js";
import { createAwTextDraftBackend } from "../native-runtime/aw-text-draft-backend.js";

type Gateway = ReturnType<typeof workerModelGateway>;
type Plan = typeof orchestrationPlans.$inferSelect;
type Worker = typeof orchestrationWorkers.$inferSelect;
const installed = new WeakMap<Db, Gateway>();

/** The heartbeat's provider seam cannot substitute an unbounded backend for
 * an internal draft. All other Native providers retain their existing seam. */
export async function selectNativeHeartbeatBackend(
  db: Db,
  execution: NativeExecutionInput,
  otherProviderFactory?: (
    input: NativeExecutionInput,
  ) => NativeSessionBackend | undefined,
) {
  return execution.provider.kind === "aw_text_only"
    ? prepareNativeDraftBackend(db, execution)
    : otherProviderFactory?.(execution);
}

/** Private instance registration, like the existing assigned-MCP gateway. No
 * request body, plan or agent configuration can register a budget authority. */
export function registerNativeDraftGateway(
  db: Db,
  gateway: Gateway | undefined,
) {
  if (gateway) installed.set(db, gateway);
  else installed.delete(db);
}

export async function qualifyNativeDraftWorker(
  rootDb: Db,
  tx: Db,
  plan: Plan,
  worker: Worker,
  responsibleUserId: string,
) {
  const gateway = installed.get(rootDb);
  if (
    !gateway ||
    plan.erasedAt ||
    plan.budgets.maxModelCostMinor === null ||
    plan.actionClass !== "internal_draft" ||
    !["C0", "C1"].includes(plan.riskClass) ||
    plan.mode === "workflow_bound" ||
    !worker.agentId
  )
    throw forbidden(
      "This cost cap requires its installed native internal-draft controller",
    );
  const [task] = await tx
    .select()
    .from(issues)
    .where(
      and(eq(issues.companyId, plan.companyId), eq(issues.id, worker.issueId)),
    );
  const [root] = await tx
    .select()
    .from(issues)
    .where(
      and(eq(issues.companyId, plan.companyId), eq(issues.id, plan.issueId)),
    );
  if (
    !task ||
    task.hiddenAt ||
    task.workMode !== "standard" ||
    !["backlog", "todo", "in_progress"].includes(task.status) ||
    task.assigneeAgentId !== worker.agentId ||
    !root ||
    root.hiddenAt ||
    ["done", "cancelled"].includes(root.status) ||
    task.requestDepth < root.requestDepth ||
    task.requestDepth - root.requestDepth > plan.budgets.maxDelegationDepth ||
    (plan.mode === "single_worker" && task.id !== root.id) ||
    (plan.mode === "planned_parallel" &&
      (task.parentId !== root.id || task.projectId !== root.projectId))
  )
    throw forbidden(
      "Native draft Task assignment, topology or work mode changed",
    );
  const actor = {
    type: "board" as const,
    source: "session" as const,
    userId: responsibleUserId,
  };
  await assertV7Authorization(tx, actor, plan.companyId, "issue:mutate", {
    type: "issue",
    companyId: plan.companyId,
    issueId: task.id,
    projectId: task.projectId,
    parentIssueId: task.parentId,
    assigneeAgentId: task.assigneeAgentId,
    assigneeUserId: task.assigneeUserId,
    status: task.status,
  });
  await assertV7Authorization(tx, actor, plan.companyId, "issue:read", {
    type: "issue",
    companyId: plan.companyId,
    issueId: root.id,
    projectId: root.projectId,
  });
  const contract = await retainedOrchestrationContract(
    tx,
    plan.companyId,
    task.id,
  );
  if (
    !contract ||
    orchestrationCompletionSchema.parse(contract.row.contractJson.v7)
      .requiredOutputs.length !== 1
  )
    throw forbidden(
      "The one-call draft requires one declared canonical output",
    );
  return gateway.qualifyDraft(tx, {
    companyId: plan.companyId,
    agentId: worker.agentId,
    responsibleUserId,
  });
}

/** Called under the original plan lock before start, without spending or
 * issuing a worker token. A private price profile does not qualify a CLI. */
export async function qualifyNativeDraftPlan(
  rootDb: Db,
  tx: Db,
  plan: Plan,
  responsibleUserId: string,
) {
  if (!installed.has(rootDb))
    throw conflict(
      "A plan cost cap requires its installed qualified native draft controller",
    );
  const workers = await tx
    .select()
    .from(orchestrationWorkers)
    .where(
      and(
        eq(orchestrationWorkers.companyId, plan.companyId),
        eq(orchestrationWorkers.planId, plan.id),
      ),
    );
  const pending = workers.filter(
    (worker) => !["completed", "cancelled", "failed"].includes(worker.status),
  );
  if (!pending.length || workers.length > plan.budgets.maxWorkerCount)
    throw forbidden("No bounded draft workers remain");
  let maximum = 0;
  for (const worker of pending)
    maximum += (
      await qualifyNativeDraftWorker(
        rootDb,
        tx,
        plan,
        worker,
        responsibleUserId,
      )
    ).maximumMinor;
  if (
    plan.budgets.maxModelCostMinor === null ||
    plan.modelCostReserved + maximum > plan.budgets.maxModelCostMinor ||
    plan.toolActionsUsed + pending.length * 2 > plan.budgets.maxToolActions
  )
    throw conflict(
      "The remaining model/tool budget cannot produce each declared draft",
    );
}

/** Exact persisted Native heartbeat selection. Unconfigured controllers and
 * foreign, delegated, MCP or recoverable sessions fail before provider spend. */
export async function prepareNativeDraftBackend(
  db: Db,
  execution: NativeExecutionInput,
) {
  const gateway = installed.get(db);
  if (
    !gateway ||
    execution.provider.kind !== "aw_text_only" ||
    !("runtimeContext" in execution) ||
    execution.session.lifecyclePolicy.mode !== "per_turn" ||
    ("continuationPrompt" in execution && execution.continuationPrompt) ||
    execution.runtimeContext.mcp.bindingId !== null
  )
    throw forbidden(
      "The native draft has no current qualified controller or requires unsupported session/tools",
    );
  const [bound] = await db
    .select({
      attempt: orchestrationWorkerAttempts,
      worker: orchestrationWorkers,
      plan: orchestrationPlans,
      run: heartbeatRuns,
    })
    .from(orchestrationWorkerAttempts)
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
    .innerJoin(
      orchestrationPlans,
      and(
        eq(orchestrationPlans.companyId, orchestrationWorkerAttempts.companyId),
        eq(orchestrationPlans.id, orchestrationWorkerAttempts.planId),
      ),
    )
    .innerJoin(
      heartbeatRuns,
      and(
        eq(heartbeatRuns.companyId, orchestrationWorkerAttempts.companyId),
        eq(heartbeatRuns.id, orchestrationWorkerAttempts.runId),
      ),
    )
    .where(
      and(
        eq(orchestrationWorkerAttempts.companyId, execution.binding.companyId),
        eq(orchestrationWorkerAttempts.agentId, execution.binding.agentId),
        eq(orchestrationWorkerAttempts.runId, execution.binding.runId),
        eq(orchestrationWorkerAttempts.status, "running"),
      ),
    );
  if (
    !bound ||
    bound.worker.issueId !== execution.binding.issueId ||
    !bound.attempt.executionManifestId ||
    bound.run.runtimeMode !== "native" ||
    bound.run.status !== "running" ||
    bound.run.nativeSessionId !== execution.session.normalizedSessionId ||
    bound.run.nativeIssueId !== execution.binding.issueId ||
    bound.plan.executionPrincipal?.type !== "user" ||
    bound.run.responsibleUserId !== bound.plan.executionPrincipal.userId
  )
    throw forbidden(
      "The native draft lacks its exact admitted worker and initiating human",
    );
  const qualified = await qualifyNativeDraftWorker(
    db,
    db,
    bound.plan,
    bound.worker,
    bound.run.responsibleUserId!,
  );
  if (
    execution.provider.profileId !== qualified.profileId ||
    execution.provider.model !== qualified.model ||
    execution.provider.maxOutputTokens !== qualified.maxOutputTokens
  )
    throw forbidden(
      "The persisted native draft provider qualification changed",
    );
  const contract = await retainedOrchestrationContract(
    db,
    execution.binding.companyId,
    execution.binding.issueId,
  );
  if (
    !contract ||
    execution.completionContract.id !== contract.row.id ||
    execution.completionContract.sha256 !== contract.row.canonicalSha256 ||
    bound.run.completionContractId !== contract.row.id ||
    bound.run.completionContractSha256 !== contract.row.canonicalSha256
  )
    throw forbidden("The persisted native draft completion contract changed");
  const completion = orchestrationCompletionSchema.parse(
    contract.row.contractJson.v7,
  );
  let remaining = Math.min(256000, qualified.maximumEnvelopeBytes);
  const read = async (
    reference: typeof execution.runtimeContext.instructions.bundle,
  ) => {
    const files = await readNativeRuntimeAssetText(reference, remaining);
    remaining -= reference.totalBytes;
    return files;
  };
  const instructionFiles = await read(
    execution.runtimeContext.instructions.bundle,
  );
  const skills = [];
  for (const skill of execution.runtimeContext.skills)
    skills.push({ key: skill.key, files: await read(skill.bundle) });
  return createAwTextDraftBackend(db, gateway, {
    companyId: execution.binding.companyId,
    agentId: execution.binding.agentId,
    runId: execution.binding.runId,
    responsibleUserId: bound.run.responsibleUserId!,
    binding: {
      planId: bound.plan.id,
      workerId: bound.worker.id,
      workerAttemptId: bound.attempt.id,
      executionManifestId: bound.attempt.executionManifestId,
      expectedPlanVersion: bound.plan.version,
    },
    outputKey: completion.requiredOutputs[0]!.key,
    maxOutputTokens: qualified.maxOutputTokens,
    runtimeContextText: {
      aggregateDigest: execution.runtimeContext.aggregateDigest,
      instructionFiles,
      skills,
    },
  });
}
