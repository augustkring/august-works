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
  if (!lifecycle || !(lifecycle.status === "deprecated" || lifecycle.status === "migration_required" || lifecycle.status === "retired" ||
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
