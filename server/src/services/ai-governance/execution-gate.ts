import { and, eq, sql } from "drizzle-orm";
import {
  aiUseCaseDeployments,
  aiUseCaseVersions,
  heartbeatRuns,
  type Db,
} from "@paperclipai/db";
import type { ToolRiskLevel } from "@paperclipai/shared";
import { forbidden } from "../../errors.js";
/** Add provenance only to Tasks that have entered governance. Existing native
 * wakeup/checkout authorization remains the admission authority. */
export async function governedNativeTaskRunFields(
  db: Db,
  companyId: string,
  agentId: string,
  issueId: string | null,
) {
  if (!issueId) return {};
  const [row] = await db.execute(
    sql`select i.id from issues i where i.company_id=${companyId}::uuid and i.id=${issueId}::uuid and i.assignee_agent_id=${agentId}::uuid and exists(select 1 from ai_use_case_deployments d where d.company_id=i.company_id and d.issue_id=i.id)`,
  );
  return typeof row?.id === "string" ? { nativeIssueId: row.id } : {};
}
/** Enforcement is independent of feature admission once a Task has a recorded
 * deployment. Historical bindings prevent rollback or retirement as a bypass. */
export async function assertExecutionGovernance(
  tx: Db,
  companyId: string,
  agentId: string,
  runId: string,
  expectedIssueId?: string,
) {
  const [run] = await tx
    .select({
      issueId: heartbeatRuns.nativeIssueId,
      snapshot: heartbeatRuns.contextSnapshot,
      status: heartbeatRuns.status,
    })
    .from(heartbeatRuns)
    .where(
      and(
        eq(heartbeatRuns.companyId, companyId),
        eq(heartbeatRuns.agentId, agentId),
        eq(heartbeatRuns.id, runId),
      ),
    );
  if (expectedIssueId && (!run || run.issueId !== expectedIssueId))
    throw forbidden("Governed tool context must match its actual native Task", {
      code: "governance_run_context_mismatch",
    });
  if (!run) return;
  const issueId =
    run.issueId ??
    (typeof run.snapshot?.issueId === "string" ? run.snapshot.issueId : null);
  if (!issueId) return;
  const rows = await tx
    .select()
    .from(aiUseCaseDeployments)
    .where(
      and(
        eq(aiUseCaseDeployments.companyId, companyId),
        eq(aiUseCaseDeployments.issueId, issueId),
      ),
    );
  if (!rows.length) return;
  if (run.status !== "running")
    throw forbidden("Governed execution requires its actual running Task", {
      code: "governance_run_not_running",
    });
  const [current] = await tx.execute(
    sql`select exists(select 1 from ai_use_case_deployments d where d.company_id=${companyId}::uuid and d.issue_id=${issueId}::uuid and d.agent_id=${agentId}::uuid and aw_v7_governance_deployment_current(d)) as allowed`,
  );
  const active = rows.find(
    (row) => row.status === "active" && row.agentId === agentId,
  );
  if (!active || run.snapshot?.governanceDeploymentId !== active.id)
    throw forbidden("A new deployment cannot revive an earlier run", {
      code: "governance_run_purpose_changed",
    });
  const [purpose] = active
    ? await tx
        .select()
        .from(aiUseCaseVersions)
        .where(
          and(
            eq(aiUseCaseVersions.companyId, companyId),
            eq(aiUseCaseVersions.useCaseId, active.useCaseId),
            eq(aiUseCaseVersions.purposeVersion, active.purposeVersion),
          ),
        )
    : [];
  if (purpose && Number(purpose.purpose.riskClass.slice(1)) >= 2) {
    const [attempt] = await tx.execute(
      sql`select exists(select 1 from orchestration_worker_attempts a join orchestration_plans p on p.company_id=a.company_id and p.id=a.plan_id where a.company_id=${companyId}::uuid and a.run_id=${runId}::uuid and a.agent_id=${agentId}::uuid and a.status='running' and p.status='running' and p.verification_mode='independent_required' and substring(p.risk_class from 2)::int>=${Number(purpose.purpose.riskClass.slice(1))}) as allowed`,
    );
    if (attempt?.allowed !== true)
      throw forbidden(
        "This use case requires its actual independently verified orchestration attempt",
        { code: "governance_orchestration_required" },
      );
  }
  if (current?.allowed !== true)
    throw forbidden(
      "This intended-purpose deployment needs current governance review",
      { code: "governance_execution_closed" },
    );
}

/** Catalog risk is server-resolved before this gate. Unknown classification
 * cannot be converted into a low-risk use by a model-supplied request field. */
export async function governanceToolRestriction(
  db: Db,
  input: {
    companyId: string;
    issueId: string | null;
    agentId: string | null;
    riskLevel: ToolRiskLevel | null;
    heartbeatRunId?: string | null;
  },
) {
  if (!input.agentId) return { denyReason: null, requireHumanApproval: false };
  if (!input.issueId) {
    const [bound] = await db
      .select({ id: aiUseCaseDeployments.id })
      .from(aiUseCaseDeployments)
      .where(
        and(
          eq(aiUseCaseDeployments.companyId, input.companyId),
          eq(aiUseCaseDeployments.agentId, input.agentId),
        ),
      )
      .limit(1);
    return {
      denyReason: bound
        ? "An explicit governed Task context is required"
        : null,
      requireHumanApproval: false,
    };
  }
  const rows = await db
    .select()
    .from(aiUseCaseDeployments)
    .where(
      and(
        eq(aiUseCaseDeployments.companyId, input.companyId),
        eq(aiUseCaseDeployments.issueId, input.issueId),
      ),
    );
  if (!rows.length) return { denyReason: null, requireHumanApproval: false };
  if (!input.heartbeatRunId)
    return {
      denyReason: "A governed tool call requires its actual run context",
      requireHumanApproval: false,
    };
  try {
    await assertExecutionGovernance(
      db,
      input.companyId,
      input.agentId,
      input.heartbeatRunId,
      input.issueId,
    );
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "status" in error &&
      error.status === 403
    )
      return {
        denyReason: "The run's reviewed purpose is no longer current",
        requireHumanApproval: false,
      };
    throw error;
  }
  const active = rows.find(
    (row) => row.status === "active" && row.agentId === input.agentId,
  );
  if (!active)
    return {
      denyReason: "Intended-purpose deployment is inactive",
      requireHumanApproval: false,
    };
  const [current] = await db.execute(
    sql`select aw_v7_governance_deployment_current(d) as allowed from ai_use_case_deployments d where d.id=${active.id}::uuid`,
  );
  if (current?.allowed !== true)
    return {
      denyReason: "Current governance review is required",
      requireHumanApproval: false,
    };
  const [revision] = await db
    .select()
    .from(aiUseCaseVersions)
    .where(
      and(
        eq(aiUseCaseVersions.companyId, input.companyId),
        eq(aiUseCaseVersions.useCaseId, active.useCaseId),
        eq(aiUseCaseVersions.purposeVersion, active.purposeVersion),
      ),
    );
  if (!revision || !input.riskLevel)
    return {
      denyReason: "Tool classification is not qualified for this use case",
      requireHumanApproval: false,
    };
  const actionRisk = ["read", "low"].includes(input.riskLevel)
    ? 0
    : ["write", "medium"].includes(input.riskLevel)
      ? 2
      : 3;
  if (actionRisk > Number(revision.purpose.riskClass.slice(1)))
    return {
      denyReason:
        "Tool action exceeds the reviewed intended-purpose risk envelope",
      requireHumanApproval: false,
    };
  return { denyReason: null, requireHumanApproval: actionRisk >= 2 };
}
