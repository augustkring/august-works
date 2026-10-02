import { and, eq } from "drizzle-orm";
import { agents, companyMemberships, type Db } from "@paperclipai/db";
import type { ExecutionPrincipal } from "@paperclipai/shared";
import { forbidden } from "../../errors.js";
import { accessService } from "../access.js";

/** Server-assigned configuration authority; never consumes a supplied principal. */
export async function workflowDelegationForActor(db: Db, companyId: string, actor: { userId?: string | null; agentId?: string | null }): Promise<ExecutionPrincipal | null> {
  if (actor.userId) {
    const [membership] = await db.select().from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId),
      eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, actor.userId), eq(companyMemberships.status, "active")));
    if (!membership || !await accessService(db).canUser(companyId, actor.userId, "workflows:run")) throw forbidden("Workflow delegation requires current workflows:run permission");
    return { type: "user", userId: actor.userId };
  }
  if (actor.agentId) {
    const [agent] = await db.select().from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, actor.agentId)));
    if (!agent || !["active", "running", "idle"].includes(agent.status) || !await accessService(db).hasPermission(companyId, "agent", actor.agentId, "workflows:run")) throw forbidden("Workflow delegation requires an active permitted agent");
    return { type: "agent", agentId: actor.agentId };
  }
  return null;
}
