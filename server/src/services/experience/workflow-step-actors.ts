import { and, eq, sql } from "drizzle-orm";
import { agents, authUsers, companyMemberships, principalPermissionGrants, type Db } from "@paperclipai/db";
import type { WorkflowDetail, WorkflowExperienceRevision } from "@paperclipai/shared";
import { z } from "zod";
import { authorizationService, type AuthorizationActor } from "../authorization.js";
import { assertV5Authorization } from "../v5-authorization.js";
import { workflowService } from "../workflows/workflow-service.js";
import { workflowReviewBinding } from "./workflow-review-binding.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { withExperienceAdmission } from "./admission.js";
import { ExperienceOverloadError } from "./projection.js";
import { conflict, forbidden } from "../../errors.js";

type Assignment = NonNullable<WorkflowExperienceRevision["steps"][number]["assignment"]>;
/** Names are a separate current Native agent read, never authority borrowed
 * from workflow ownership or a stored execution principal. No model/tool call. */
export function readWorkflowStepActors(db: Db, detail: WorkflowDetail, rawActor: AuthorizationActor) {
  return withExperienceAdmission(async (signal, remainingMs) => db.transaction(async raw => {
    const tx = raw as unknown as Db, companyId = detail.companyId;
    await tx.execute(sql`select set_config('statement_timeout',${`${remainingMs()}ms`},true),set_config('lock_timeout','250ms',true)`);
    await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
    const actor = { ...rawActor, isInstanceAdmin: false, ignoreInstanceAdmin: true };
    const references: Array<{ key: string; id: string | null }> = [];
    for (const revision of [detail.draftRevision, detail.publishedRevision]) {
      if (!revision) continue;
      if (revision.graph.nodes.length > 100) continue; // The flow owner marks oversized revisions unavailable.
      for (const node of revision.graph.nodes) if (["agent.task", "agent.external"].includes(node.type)) {
        const config = node.config as Record<string, unknown> | null;
        const id = config && typeof config === "object" && !Array.isArray(config) ? z.uuid().safeParse(config.agentId) : null;
        references.push({ key: `${revision.id}:${node.id}`, id: id?.success ? id.data : null });
      }
    }
    const assignments = new Map<string, Assignment>();
    // Historical/local fixtures may read the original flow, but cannot invent
    // a verified Human identity for selected-agent metadata.
    if (!references.length) return assignments;
    if (actor.type !== "board" || !actor.userId || actor.source === "local_implicit") {
      for (const reference of references) assignments.set(reference.key, { state: "unavailable", name: null });
      return assignments;
    }
    const ids = [...new Set(references.flatMap(reference => reference.id ? [reference.id] : []))];
    if (ids.length > 32) throw new ExperienceOverloadError("Complete workflow assignments exceed the read budget");
    async function account() {
      signal.throwIfAborted();
      const [user] = await tx.select({ verified: authUsers.emailVerified }).from(authUsers).where(eq(authUsers.id, actor.userId!)).for("share");
      const [membership] = await tx.select({ id: companyMemberships.id }).from(companyMemberships).where(and(
        eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, actor.userId!), eq(companyMemberships.status, "active"))).for("share");
      if (!user?.verified || !membership) throw forbidden("A current verified workflow reader is required");
      await tx.select({ id: principalPermissionGrants.id }).from(principalPermissionGrants).where(and(
        eq(principalPermissionGrants.companyId, companyId), eq(principalPermissionGrants.principalType, "user"),
        eq(principalPermissionGrants.principalId, actor.userId!))).for("share");
      await assertV5Authorization(tx, actor, companyId, "workflows:read");
      // Original revision and private Source owners must still bind the same graph.
      const current = await workflowService(tx).getDetail(companyId, detail.id, actor);
      if (!current || workflowReviewBinding(current) !== workflowReviewBinding(detail)) throw conflict("Current workflow changed; refresh");
    }
    const auth = authorizationService(tx), names = new Map<string, string | null>();
    async function name(id: string) {
      signal.throwIfAborted();
      if (!(await auth.decide({ actor, action: "agent:read", resource: { type: "agent", companyId, agentId: id } })).allowed) return null;
      const [row] = await tx.select({ name: agents.name }).from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, id))).for("share");
      return row?.name.trim().slice(0, 200) || null;
    }
    await account();
    for (const id of ids) names.set(id, await name(id));
    await account();
    for (const id of ids) if (names.get(id) !== await name(id)) throw conflict("Current workflow assignment changed; refresh");
    for (const reference of references) {
      const value = reference.id ? names.get(reference.id) : null;
      assignments.set(reference.key, value ? { state: "current", name: value } : { state: "unavailable", name: null });
    }
    signal.throwIfAborted();
    return assignments;
  }).catch(error => {
    let cause: unknown = error;
    for (let depth = 0; depth < 4 && cause && typeof cause === "object"; depth++) {
      const failure = cause as { code?: unknown; cause?: unknown };
      if (failure.code === "55P03" || failure.code === "57014") throw new ExperienceOverloadError("Current workflow assignments exceeded their read budget");
      cause = failure.cause;
    }
    throw error;
  }));
}
