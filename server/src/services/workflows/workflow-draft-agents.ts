import { and, eq } from "drizzle-orm";
import { agents, type Db } from "@paperclipai/db";
import { workflowDraftAgentSelectionSchema } from "@paperclipai/shared";
import { z } from "zod";
import { authorizationService, type AuthorizationActor } from "../authorization.js";
import type { HttpError } from "../../errors.js";
import { workflowCapabilityResolverService } from "./workflow-capability-resolver.js";
import { workflowCapabilityVisibility } from "./workflow-capability-visibility.js";

/** Reuse Original inventory visibility for a bounded draft choice list. Native
 * read/status is never a runtime qualification, grant or Task admission. */
export async function reviewDraftAgentSelection(tx: Db, companyId: string, rawActor: AuthorizationActor, selectedId?: string) {
  const actor = { ...rawActor, ignoreInstanceAdmin: true }, visible = workflowCapabilityVisibility(tx, companyId, actor);
  const catalog = await workflowCapabilityResolverService(tx).search(companyId, { q: "", kind: "agent", limit: 32 }, async candidate =>
    candidate.nodeType === "agent.task" && candidate.availability.status === "available" && await visible(candidate));
  const choices = [];
  for (const candidate of catalog.candidates) {
    const id = z.uuid().parse(candidate.source.agentId);
    const [row] = await tx.select({ name: agents.name }).from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, id))).for("share");
    if (row) choices.push({ agentId: id, name: row.name.trim().slice(0, 200) });
  }
  const canRead = selectedId && (await authorizationService(tx).decide({ actor, action: "agent:read", resource: { type: "agent", companyId, agentId: selectedId }, enforceResponsibleUserIntersection: true })).allowed;
  const [selected] = canRead ? await tx.select({ name: agents.name }).from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, selectedId!))).for("share") : [];
  return workflowDraftAgentSelectionSchema.parse({ coverage: "bounded", selectedName: selected?.name.trim().slice(0, 200) || null, choices });
}

export async function assertDraftAgentSelection(tx: Db, companyId: string, actor: AuthorizationActor, agentId: string, refuse: () => HttpError) {
  const permitted = await authorizationService(tx).decide({ actor: { ...actor, ignoreInstanceAdmin: true }, action: "agent:read",
    resource: { type: "agent", companyId, agentId }, enforceResponsibleUserIntersection: true });
  const [selected] = permitted.allowed ? await tx.select({ status: agents.status, adapter: agents.adapterType }).from(agents)
    .where(and(eq(agents.companyId, companyId), eq(agents.id, agentId))).for("share") : [];
  if (!selected || !["active", "idle", "running"].includes(selected.status) || selected.adapter === "openclaw_gateway") throw refuse();
}
