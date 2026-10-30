import { createHash } from "node:crypto";
import type { ModelRetirementNoticeProjection } from "@paperclipai/shared";
import type { WorkerModelProfile } from "../orchestration/worker-model-profiles.js";
import { resolvePaperclipRunnerProviderProfile } from "../native-runtime/provider-profile.js";

/** Sanitize the model owner projection. The caller must first prove current
 * Human company membership and agent:read + agents:configure for this exact
 * Agent. Profile references, provider labels, workflow names and config stay
 * inside their canonical owners. */
export function projectCurrentModelRetirementNotice(companyId: string, agent: {
  id: string; adapterConfig: unknown;
}, profiles: readonly WorkerModelProfile[], now = Date.now()): ModelRetirementNoticeProjection | null {
  let selected: ReturnType<typeof resolvePaperclipRunnerProviderProfile>;
  try { selected = resolvePaperclipRunnerProviderProfile(agent.adapterConfig); }
  catch { return null; }
  if (selected.provider !== "aw_text_only") return null;
  const profile = profiles.find(value => value.companyId === companyId && value.workerAgentId === agent.id && value.id === selected.workerModelProfileId &&
    value.tariff.model === selected.model);
  const lifecycle = profile?.lifecycle;
  if (!lifecycle || !(lifecycle.status === "blocked" || lifecycle.status === "deprecated" || lifecycle.status === "migration_required" || lifecycle.status === "retired" ||
    lifecycle.retirementAt !== null && Date.parse(lifecycle.retirementAt) <= now)) return null;
  return {
    id: agent.id,
    category: "action_required",
    title: "A current Agent model needs migration",
    summary: "Review the affected Agent and publish a currently qualified replacement model.",
    affectedCompanyId: companyId,
    affectedAgentId: agent.id,
    effectiveAt: lifecycle.retirementAt,
    actionRequired: true,
    mandatoryVisibility: true,
    completionOwner: "current_agent_model_selection",
    actionPath: `/agents/${agent.id}`,
  };
}

export type OperatorManagedModelDependency = "read_only_verifier" | "first_party_support" | "jev_skill_suggestion";
type Lifecycle = { status: string; retirementAt: string | null };

function stableNoticeId(companyId: string, dependency: OperatorManagedModelDependency) {
  const chars = createHash("sha256").update(`model-retirement:${companyId}:${dependency}`).digest("hex").slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((parseInt(chars[16]!, 16) & 3) | 8).toString(16);
  const hex = chars.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Company-visible pointer for an enabled, operator-owned dependency. It
 * carries no provider, profile, credential, or cross-company identity. */
export function projectOperatorModelRetirementNotice(companyId: string, dependency: OperatorManagedModelDependency,
  lifecycle: Lifecycle | undefined, now = Date.now()): ModelRetirementNoticeProjection | null {
  if (!lifecycle || !(lifecycle.status === "blocked" || lifecycle.status === "deprecated" || lifecycle.status === "migration_required" || lifecycle.status === "retired" ||
    lifecycle.retirementAt !== null && Date.parse(lifecycle.retirementAt) <= now)) return null;
  return {
    id: stableNoticeId(companyId, dependency), category: "action_required",
    title: "A company model dependency needs operator review",
    summary: "An enabled model dependency is blocked or nearing retirement. Contact support to review its migration.",
    affectedCompanyId: companyId, dependency, effectiveAt: lifecycle.retirementAt,
    actionRequired: true, mandatoryVisibility: true, completionOwner: "operator_model_dependency", actionPath: "/company/help",
  };
}
