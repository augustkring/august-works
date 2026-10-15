import { and, eq } from "drizzle-orm";
import { agents, approvals, agentPackages, agentPackageVersions, companyAgentPackageInstallations, type Db } from "@paperclipai/db";
import { activationFirstAgentViewSchema, packageReleaseSchema, type ActivationState } from "@paperclipai/shared";
import { authorizationService, type AuthorizationActor } from "../authorization.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { packageReleaseBlockers } from "../agent-packages/package-policy.js";
import { notFound } from "../../errors.js";

/** A hidden/unqualified preparation option does not mean no original owner
 * exists. Never replace a legacy onboarding target or installed capability. */
export async function hasOriginalFirstAgentPreparation(tx: Db, companyId: string, versionId: string, answers: Record<string, unknown>) {
  if (typeof answers.createdFirstAgentId === "string" || typeof answers.agentId === "string") return true;
  const [existing] = await tx.select({ id: companyAgentPackageInstallations.id }).from(companyAgentPackageInstallations)
    .innerJoin(agentPackageVersions, eq(agentPackageVersions.packageId, companyAgentPackageInstallations.packageId))
    .where(and(eq(companyAgentPackageInstallations.companyId, companyId), eq(agentPackageVersions.id, versionId)))
    .limit(1).for("share");
  return !!existing;
}

/** Latch both original publication owners before relying on qualification. */
export async function readFirstAgentCapabilityPin(tx: Db, versionId: string) {
  const [row] = await tx.select({ version: agentPackageVersions, package: agentPackages }).from(agentPackageVersions)
    .innerJoin(agentPackages, eq(agentPackages.id, agentPackageVersions.packageId))
    .where(eq(agentPackageVersions.id, versionId)).for("share");
  if (!row || row.version.state !== "published" || row.package.status !== "active") return null;
  const parsed = packageReleaseSchema.safeParse(row.version.release);
  if (!parsed.success || parsed.data.manifest.audience !== "customer" || parsed.data.manifest.maximumRisk !== "C1" ||
      parsed.data.manifest.actionClasses.some(action => action !== "internal_draft") || packageReleaseBlockers(parsed.data).length) return null;
  return { versionId: row.version.id, hash: row.version.contentHash, name: row.package.name };
}

const configurationFields = {
  id: agents.id, agentIdentityId: agents.agentIdentityId, name: agents.name, role: agents.role,
  title: agents.title, capabilities: agents.capabilities, adapterType: agents.adapterType,
  adapterConfig: agents.adapterConfig, runtimeConfig: agents.runtimeConfig,
  permissions: agents.permissions, budgetMonthlyCents: agents.budgetMonthlyCents, reportsTo: agents.reportsTo,
};
/** The hash stays inside the original onboarding reference; no configuration,
 * credentials or hash of private fields enter the customer view. */
export async function firstAgentConfigurationHash(tx: Db, companyId: string, agentId: string) {
  const [row] = await tx.select(configurationFields).from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, agentId))).for("share");
  if (!row) throw notFound("Original agent preparation source is unavailable");
  return nativeSha256(row);
}

export async function activationFirstAgentView(
  tx: Db, actor: AuthorizationActor, companyId: string, state: ActivationState,
  eligible: boolean, currentPackageHash: string | null,
) {
  const current = { ...actor, isInstanceAdmin: false, ignoreInstanceAdmin: true };
  const owner = authorizationService(tx);
  if (!state.firstAgent) {
    const decision = eligible ? await owner.decide({ actor: current, action: "agents:create",
      resource: { type: "company", companyId }, enforceResponsibleUserIntersection: true }) : null;
    return activationFirstAgentViewSchema.parse({ status: "not_created", agentId: null, name: null, canPrepare: decision?.allowed === true });
  }
  const unavailable = () => activationFirstAgentViewSchema.parse({ status: "unavailable", agentId: null, name: null, canPrepare: false });
  const decision = await owner.decide({ actor: current, action: "agent:read", resource: {
    type: "agent", companyId, agentId: state.firstAgent.agentId }, enforceResponsibleUserIntersection: true });
  if (!decision.allowed) return unavailable();
  const [agent] = await tx.select({ id: agents.id, name: agents.name, status: agents.status }).from(agents)
    .where(and(eq(agents.companyId, companyId), eq(agents.id, state.firstAgent.agentId))).for("share");
  if (!agent || agent.status === "terminated") return unavailable();
  const sameConfiguration = state.firstAgent.configurationHash === await firstAgentConfigurationHash(tx, companyId, agent.id);
  const samePackage = state.packageVersionId === state.firstAgent.packageVersionId && currentPackageHash === state.firstAgent.packageContentHash;
  let status: "prepared" | "pending_approval" | "needs_review" = "needs_review";
  if (sameConfiguration && samePackage && agent.status === "paused") status = "prepared";
  if (sameConfiguration && samePackage && agent.status === "pending_approval" && state.firstAgent.approvalId) {
    const [approval] = await tx.select().from(approvals).where(and(eq(approvals.companyId, companyId), eq(approvals.id, state.firstAgent.approvalId))).for("share");
    if (approval?.type === "hire_agent" && approval.status === "pending" && approval.requestedByUserId === actor.userId && approval.payload?.agentId === agent.id)
      status = "pending_approval";
  }
  const repeated = await owner.decide({ actor: current, action: "agent:read", resource: {
    type: "agent", companyId, agentId: agent.id }, enforceResponsibleUserIntersection: true });
  if (!repeated.allowed) return unavailable();
  return activationFirstAgentViewSchema.parse({ status, agentId: agent.id, name: agent.name, canPrepare: false });
}
