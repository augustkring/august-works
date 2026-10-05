import { entitlementService } from "../billing/entitlements.js";
import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import type { ToolRiskLevel } from "@paperclipai/shared";
import { forbidden } from "../../errors.js";
import { agentProviderBindingService } from "../agent-provider-bindings.js";
export async function assertPackageExecution(
  db: Db,
  companyId: string,
  agentId: string,
  runId?: string | null,
) {
  const [record] = await db.execute(
    sql`select i.id,i.activation_hash,aw_v7_package_installation_current(i) as current,v.release from company_agent_package_installations i join agent_package_versions v on v.id=i.installed_version_id where i.company_id=${companyId}::uuid and i.agent_id=${agentId}::uuid order by (i.status<>'uninstalled') desc,i.created_at desc limit 1`,
  );
  if (!record) return null;
  if (record.current !== true || !runId)
    throw forbidden(
      "Package execution requires current activation and its owned native run",
      { code: "package_execution_closed" },
    );
  const [run] = await db.execute(
    sql`select status,context_snapshot,native_issue_id from heartbeat_runs where company_id=${companyId}::uuid and agent_id=${agentId}::uuid and id=${runId}::uuid`,
  );
  const context = run?.context_snapshot as Record<string, unknown> | undefined;
  if (
    run?.status !== "running" ||
    context?.agentPackageInstallationId !== record.id ||
    context?.agentPackageActivationHash !== record.activation_hash
  )
    throw forbidden(
      "Package activation cannot revive an earlier or substituted run",
      { code: "package_run_pin_changed" },
    );
  await agentProviderBindingService(db).assertRuntime(companyId, agentId);
  const release = record.release as {
    manifest: {
      audience: string;
      maximumRisk: string;
      purpose: string;
      commercialProductKey:
        | "agent_package_chief_of_staff"
        | "agent_package_growth"
        | "agent_package_research"
        | null;
    };
  };
  if (release.manifest.audience === "customer") {
    const entitlement = (
      {
        agent_package_chief_of_staff: "packages.chief_of_staff.use",
        agent_package_growth: "packages.growth.use",
        agent_package_research: "packages.research.use",
      } as const
    )[release.manifest.commercialProductKey!];
    await entitlementService(db).require(companyId, entitlement);
    const [governed] = await db.execute(
      sql`select exists(select 1 from ai_use_case_deployments d join company_agent_package_installations i on i.company_id=d.company_id and i.ai_use_case_id=d.use_case_id where i.id=${record.id}::uuid and d.issue_id=${run!.native_issue_id}::uuid and d.agent_id=${agentId}::uuid and aw_v7_governance_deployment_current(d) and d.id::text=${String(context?.governanceDeploymentId ?? "")}) as current`,
    );
    if (governed?.current !== true)
      throw forbidden(
        "Customer package work requires its current intended-purpose deployment",
        { code: "package_purpose_binding_required" },
      );
  }
  return release.manifest;
}
export async function packageToolRestriction(
  db: Db,
  ctx: {
    companyId: string;
    agentId?: string | null;
    heartbeatRunId?: string | null;
    riskLevel?: ToolRiskLevel | null;
  },
) {
  if (!ctx.agentId) return {};
  try {
    const manifest = await assertPackageExecution(
      db,
      ctx.companyId,
      ctx.agentId,
      ctx.heartbeatRunId,
    );
    if (!manifest) return {};
    const risk = ctx.riskLevel;
    if (manifest.audience === "internal_test" && risk !== "read")
      return {
        denyReason:
          "Internal evaluation packages may read only; side effects remain closed.",
      };
    if (!risk)
      return {
        denyReason:
          "Package actions require a classified native catalog capability.",
      };
    const ranks: Record<string, number> = {
      read: 0,
      low: 1,
      write: 2,
      medium: 2,
      admin: 3,
      destructive: 3,
      high: 3,
      critical: 4,
      unknown: 4,
    };
    if ((ranks[risk] ?? 4) > Number(manifest.maximumRisk.slice(1)))
      return { denyReason: "This action exceeds the package risk envelope." };
    return { requireHumanApproval: (ranks[risk] ?? 4) >= 2 };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "status" in error &&
      [403, 404, 409].includes(Number(error.status))
    )
      return {
        denyReason:
          "Current package activation, authority and runtime are required.",
      };
    throw error;
  }
}
