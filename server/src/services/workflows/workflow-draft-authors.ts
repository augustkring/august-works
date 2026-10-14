import { and, eq, inArray, sql } from "drizzle-orm";
import { agents, companyMemberships, principalPermissionGrants, workflows, type Db } from "@paperclipai/db";
import { workflowDraftAuthorsSchema, v9FeatureEnabled } from "@paperclipai/shared";
import { HttpError, notFound } from "../../errors.js";
import { authorizationService, type AuthorizationActor } from "../authorization.js";
import { instanceSettingsService } from "../instance-settings.js";
import { withExperienceAdmission } from "../experience/admission.js";
import { ExperienceOverloadError } from "../experience/projection.js";
import { runnerApiToolsEnabled } from "../native-runtime/runner-api-rollout.js";
import { resolvePaperclipRunnerProviderProfile, PaperclipRunnerProviderProfileError } from "../native-runtime/provider-profile.js";
import { hasAuthoredAgentDefinition } from "../agents/authored-definition.js";
import { lockWorkflowDraftAccount } from "./workflow-draft-authority.js";
import { workflowService } from "./workflow-service.js";

/** Discover existing standing policy for a named Native conversation. This
 * creates no run, grant, configuration, conversation or provider request. */
export function readWorkflowDraftAuthors(db: Db, actor: AuthorizationActor, companyId: string, workflowId: string,
  signal?: AbortSignal) {
  return withExperienceAdmission((currentSignal, remainingMs) => db.transaction(async raw => {
    const tx = raw as unknown as Db;
    await tx.execute(sql`select set_config('statement_timeout',${`${remainingMs()}ms`},true),set_config('lock_timeout','250ms',true)`);
    const current = await lockWorkflowDraftAccount(tx, actor, companyId);
    await tx.select({ id: workflows.id }).from(workflows).where(and(eq(workflows.companyId, companyId), eq(workflows.id, workflowId))).for("share");
    const detail = await workflowService(tx).getDetail(companyId, workflowId, current.actor);
    if (!detail?.draftRevisionId || detail.status === "archived" || detail.draftRevision?.state !== "draft")
      throw notFound("The current workflow draft is unavailable");
    const flags = await instanceSettingsService(tx).getExperimental();
    const enabled = flags.enableAiWorkflowAuthoring === true && flags.enableAgentChat === true &&
      v9FeatureEnabled(flags, "ambient_commands_v9") && runnerApiToolsEnabled(companyId);
    const auth = authorizationService(tx), choices = [];
    const candidates = enabled ? await tx.select({ id: agents.id }).from(agents).where(and(eq(agents.companyId, companyId),
      eq(agents.adapterType, "paperclip_runner"), inArray(agents.status, ["active", "idle", "running"]))).orderBy(agents.id).limit(32) : [];
    const eligible = async (agentId: string) => {
      currentSignal.throwIfAborted();
      if (!(await auth.decide({ actor: current.actor, action: "agent:read", resource: { type: "agent", companyId, agentId } })).allowed) return false;
      // A policy subject is deliberately not a JWT or saved Human principal.
      // The actual run revalidates its own authority when the user sends.
      const subject = { type: "agent" as const, companyId, agentId, onBehalfOfUserId: current.userId };
      for (const action of ["workflows:read", "workflows:edit"] as const)
        if (!(await auth.decide({ actor: subject, action, resource: { type: "company", companyId }, enforceResponsibleUserIntersection: true })).allowed) return false;
      return true;
    };
    for (const candidate of candidates) {
      if (!await eligible(candidate.id)) continue;
      await tx.select({ id: companyMemberships.id }).from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId),
        eq(companyMemberships.principalType, "agent"), eq(companyMemberships.principalId, candidate.id))).for("share");
      await tx.select({ id: principalPermissionGrants.id }).from(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, companyId),
        eq(principalPermissionGrants.principalType, "agent"), eq(principalPermissionGrants.principalId, candidate.id))).for("share");
      const [agent] = await tx.select({ id: agents.id, companyId: agents.companyId, name: agents.name, adapter: agents.adapterType,
        status: agents.status, adapterConfig: agents.adapterConfig, runtimeConfig: agents.runtimeConfig }).from(agents)
        .where(and(eq(agents.companyId, companyId), eq(agents.id, candidate.id))).for("share");
      if (!agent || hasAuthoredAgentDefinition(agent)) continue;
      try {
        // The Original text-only backend has no model-controlled tools and can
        // save only its declared Task document. Adapter identity alone cannot
        // make it a workflow author. This read is not provider qualification.
        if (resolvePaperclipRunnerProviderProfile(agent.adapterConfig).provider === "aw_text_only") continue;
      } catch (error) {
        if (error instanceof PaperclipRunnerProviderProfileError) continue;
        throw error;
      }
      if (agent?.adapter === "paperclip_runner" && ["active", "idle", "running"].includes(agent.status) && agent.name.trim() && await eligible(candidate.id))
        choices.push({ agentId: candidate.id, name: agent.name.trim().slice(0, 200) });
    }
    await lockWorkflowDraftAccount(tx, actor, companyId);
    await workflowService(tx).getDetail(companyId, workflowId, current.actor);
    for (const choice of choices) if (!await eligible(choice.agentId)) throw new HttpError(503, "Current workflow author selection changed; refresh");
    currentSignal.throwIfAborted();
    return workflowDraftAuthorsSchema.parse({ companyId, workflowId, draftRevisionId: detail.draftRevisionId,
      publishedRevisionId: detail.publishedRevisionId, observedAt: new Date().toISOString(), coverage: "bounded", enabled, choices });
  }), { signal }).catch(error => {
    if (error instanceof ExperienceOverloadError) throw new HttpError(503, "The current workflow author view is unavailable; try again");
    let cause: unknown = error;
    for (let depth = 0; depth < 4 && cause && typeof cause === "object"; depth++) {
      if ("code" in cause && ["55P03", "57014"].includes(String(cause.code))) throw new HttpError(503, "The current workflow author view is unavailable; try again");
      cause = "cause" in cause ? cause.cause : undefined;
    }
    throw error;
  });
}
