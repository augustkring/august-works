import { eq } from "drizzle-orm";
import { activityLog, approvals, companies, type Db } from "@paperclipai/db";
import { agentService } from "../agents.js";
import { entitlementService } from "../billing/entitlements.js";
import { notFound } from "../../errors.js";

/** Shared original onboarding creation owner. Its callers hold the onboarding
 * lock and current native create authority. The original V5 trigger creates its unqualified local provider placeholder.
 * This creates no qualified runtime, grant or invocation; the original approval requirement remains binding. */
export async function createPausedOnboardingAgent(
  tx: Db, companyId: string, userId: string, name: string, role: "ceo" | "general" = "ceo",
) {
  await entitlementService(tx).require(companyId, "platform.access");
  const [company] = await tx.select().from(companies).where(eq(companies.id, companyId)).for("share");
  if (!company) throw notFound("Company not found");
  const agent = await agentService(tx).create(companyId, {
    name, role, adapterType: "openclaw_gateway", adapterConfig: {},
    runtimeConfig: { heartbeat: { enabled: false } }, budgetMonthlyCents: 0,
    status: company.requireBoardApprovalForNewAgents ? "pending_approval" : "paused",
  });
  let approvalId: string | null = null;
  if (company.requireBoardApprovalForNewAgents) {
    const [approval] = await tx.insert(approvals).values({
      companyId, type: "hire_agent", requestedByUserId: userId, status: "pending",
      payload: { agentId: agent.id, name: agent.name, role: agent.role,
        adapterType: agent.adapterType, adapterConfig: agent.adapterConfig, runtimeConfig: agent.runtimeConfig,
        budgetMonthlyCents: 0, requestedConfigurationSnapshot: {
          adapterType: agent.adapterType, adapterConfig: agent.adapterConfig, runtimeConfig: agent.runtimeConfig, desiredSkills: [],
        },
      },
    }).returning();
    approvalId = approval!.id;
    await tx.insert(activityLog).values({ companyId, actorType: "user", actorId: userId,
      action: "approval.created", entityType: "approval", entityId: approvalId, details: { type: "hire_agent" } });
  }
  return { agent, approvalId };
}
