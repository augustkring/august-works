import type { SaasModelDependencyInventory } from "@paperclipai/shared";
import type { WorkerModelProfile } from "../orchestration/worker-model-profiles.js";
import type { ReadOnlyModelProfile } from "../orchestration/read-only-model-profiles.js";
import type { FirstPartySupportModelProfile } from "../orchestration/first-party-support-model-profiles.js";
import { resolvePaperclipRunnerProviderProfile } from "../native-runtime/provider-profile.js";

type AgentModelBinding = { id: string; companyId: string; adapterType: string; adapterConfig: unknown; runtimeConfig: unknown };

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeModelValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const model = value.trim();
  if (!/^[a-zA-Z0-9_./:-]{1,200}$/.test(model) ||
    /^(?:sk-(?:ant-)?|xox[baprs]-|gh[pousr]_|bearer[-_])/i.test(model)) return null;
  return model;
}

function safeProviderValue(value: unknown): string | null {
  return typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,100}$/.test(value.trim()) ? value.trim() : null;
}

/** Build the operator-only model dependency view from existing runtime owners.
 * This is a projection, not a new registry: pinned qualification profiles and
 * currently configured Agent bindings remain authoritative. */
export function projectSaasModelDependencyInventory(input: {
  agents: readonly AgentModelBinding[];
  workerProfiles: readonly WorkerModelProfile[];
  readOnlyProfiles: readonly ReadOnlyModelProfile[];
  supportProfiles: readonly FirstPartySupportModelProfile[];
  workerProfilesConfigured: boolean;
  readOnlyProfilesConfigured: boolean;
  supportProfilesConfigured: boolean;
}): SaasModelDependencyInventory {
  const entries: SaasModelDependencyInventory["entries"] = [];
  const workerProfileUse = new Set<string>();
  let unresolvedAgentBindings = 0;

  for (const agent of input.agents) {
    const config = asRecord(agent.adapterConfig);
    const runtime = asRecord(agent.runtimeConfig);
    const configuredProvider = safeProviderValue(config.provider) ?? safeProviderValue(runtime.provider);
    const model = safeModelValue(config.model) ?? safeModelValue(runtime.model);
    if (agent.adapterType !== "paperclip_runner" || configuredProvider !== "aw_text_only") {
      const providerFromModel = model && ["opencode_local", "pi_local"].includes(agent.adapterType)
        ? safeProviderValue(model.split("/", 1)[0]) : null;
      const provider = configuredProvider ?? providerFromModel;
      const bindingState = model ? "provider_model_configured" : "adapter_model_not_reported";
      if (!model) unresolvedAgentBindings += 1;
      entries.push({
        dependency: "agent_runtime",
        companyId: agent.companyId,
        agentId: agent.id,
        runtimeAdapter: agent.adapterType,
        provider,
        model,
        modelVersionOrReleaseIdentity: null,
        lifecycleStatus: "untracked",
        lifecycleOwner: null,
        retirementAt: null,
        qualificationHash: null,
        regionOrRoutingProfile: null,
        dataUseProfile: null,
        supportedInputOutput: null,
        toolUseCapability: null,
        contextLimits: null,
        costProfile: null,
        rateLimits: null,
        runtimeAvailability: "not_assessed",
        bindingState,
      });
      continue;
    }
    let selected: ReturnType<typeof resolvePaperclipRunnerProviderProfile>;
    try {
      selected = resolvePaperclipRunnerProviderProfile(agent.adapterConfig);
    } catch {
      unresolvedAgentBindings += 1;
      entries.push({
        dependency: "agent_runtime",
        companyId: agent.companyId,
        agentId: agent.id,
        runtimeAdapter: agent.adapterType,
        provider: null,
        model: null,
        modelVersionOrReleaseIdentity: null,
        lifecycleStatus: "untracked",
        lifecycleOwner: null,
        retirementAt: null,
        qualificationHash: null,
        regionOrRoutingProfile: null,
        dataUseProfile: null,
        supportedInputOutput: null,
        toolUseCapability: null,
        contextLimits: null,
        costProfile: null,
        rateLimits: null,
        runtimeAvailability: "not_assessed",
        bindingState: "unresolved",
      });
      continue;
    }

    if (selected.provider === "aw_text_only") {
      const profile = input.workerProfiles.find(value => value.companyId === agent.companyId &&
        value.workerAgentId === agent.id && value.id === selected.workerModelProfileId && value.tariff.model === selected.model);
      if (profile) workerProfileUse.add(profile.id);
      else unresolvedAgentBindings += 1;
      const lifecycle = profile?.lifecycle;
      entries.push({
        dependency: "agent_runtime",
        companyId: agent.companyId,
        agentId: agent.id,
        runtimeAdapter: agent.adapterType,
        provider: "anthropic",
        model: selected.model,
        modelVersionOrReleaseIdentity: selected.model,
        lifecycleStatus: lifecycle?.status ?? "untracked",
        lifecycleOwner: lifecycle?.owner ?? null,
        retirementAt: lifecycle?.retirementAt ?? null,
        qualificationHash: profile?.tariff.qualificationHash ?? null,
        regionOrRoutingProfile: lifecycle?.regionOrRoutingProfile ?? null,
        dataUseProfile: lifecycle?.dataUseProfile ?? null,
        supportedInputOutput: lifecycle?.supportedInputOutput ?? null,
        toolUseCapability: lifecycle?.toolUseCapability ?? null,
        contextLimits: profile ? { inputTokensUpperBound: profile.inputTokensUpperBound,
          maxOutputTokens: profile.maxOutputTokens, maximumEnvelopeBytes: profile.maximumEnvelopeBytes } : null,
        costProfile: profile ? { currency: profile.tariff.currency, model: profile.tariff.model,
          inputMinorPerMillion: profile.tariff.inputMinorPerMillion,
          outputMinorPerMillion: profile.tariff.outputMinorPerMillion, fixedMinor: profile.tariff.fixedMinor,
          expiresAt: profile.tariff.expiresAt } : null,
        rateLimits: lifecycle?.rateLimits ?? null,
        runtimeAvailability: "not_assessed",
        bindingState: profile ? "qualified_profile_bound" : "qualification_profile_unresolved",
      });
      continue;
    }

    entries.push({
      dependency: "agent_runtime",
      companyId: agent.companyId,
      agentId: agent.id,
      runtimeAdapter: agent.adapterType,
      provider: selected.provider,
      model: selected.model,
      modelVersionOrReleaseIdentity: null,
      lifecycleStatus: "untracked",
      lifecycleOwner: null,
      retirementAt: null,
      qualificationHash: null,
      regionOrRoutingProfile: null,
      dataUseProfile: null,
      supportedInputOutput: null,
      toolUseCapability: null,
      contextLimits: null,
      costProfile: null,
      rateLimits: null,
      runtimeAvailability: "not_assessed",
      bindingState: selected.model ? "provider_model_configured" : "provider_model_unresolved",
    });
    if (!selected.model) unresolvedAgentBindings += 1;
  }

  for (const profile of input.readOnlyProfiles) {
    const lifecycle = profile.lifecycle;
    entries.push({
      dependency: "read_only_verifier",
      companyId: profile.companyId,
      agentId: profile.reviewerAgentId,
      runtimeAdapter: null,
      provider: profile.binding.provider,
      model: profile.tariff.model,
      modelVersionOrReleaseIdentity: profile.tariff.model,
      lifecycleStatus: lifecycle?.status ?? "untracked",
      lifecycleOwner: lifecycle?.owner ?? null,
      retirementAt: lifecycle?.retirementAt ?? null,
      qualificationHash: profile.tariff.qualificationHash,
      regionOrRoutingProfile: lifecycle?.regionOrRoutingProfile ?? null,
      dataUseProfile: lifecycle?.dataUseProfile ?? null,
      supportedInputOutput: lifecycle?.supportedInputOutput ?? null,
      toolUseCapability: lifecycle?.toolUseCapability ?? null,
      contextLimits: { inputTokensUpperBound: profile.inputTokensUpperBound,
        maxOutputTokens: profile.maxOutputTokens, maximumEnvelopeBytes: profile.maximumEnvelopeBytes },
      costProfile: { currency: profile.tariff.currency, model: profile.tariff.model,
        inputMinorPerMillion: profile.tariff.inputMinorPerMillion,
        outputMinorPerMillion: profile.tariff.outputMinorPerMillion, fixedMinor: profile.tariff.fixedMinor,
        expiresAt: profile.tariff.expiresAt },
      rateLimits: lifecycle?.rateLimits ?? null,
      runtimeAvailability: "not_assessed",
      bindingState: "configured_profile",
    });
  }

  for (const profile of input.supportProfiles) {
    const lifecycle = profile.lifecycle;
    entries.push({
      dependency: "first_party_support",
      companyId: profile.companyId,
      agentId: null,
      runtimeAdapter: null,
      provider: profile.tariff.provider,
      model: profile.tariff.model,
      modelVersionOrReleaseIdentity: profile.tariff.model,
      lifecycleStatus: lifecycle?.status ?? "untracked",
      lifecycleOwner: lifecycle?.owner ?? null,
      retirementAt: lifecycle?.retirementAt ?? null,
      qualificationHash: profile.tariff.qualificationHash,
      regionOrRoutingProfile: lifecycle?.regionOrRoutingProfile ?? null,
      dataUseProfile: lifecycle?.dataUseProfile ?? null,
      supportedInputOutput: lifecycle?.supportedInputOutput ?? null,
      toolUseCapability: lifecycle?.toolUseCapability ?? null,
      contextLimits: { inputTokensUpperBound: profile.inputTokensUpperBound,
        maxOutputTokens: profile.maxOutputTokens, maximumEnvelopeBytes: profile.maximumEnvelopeBytes },
      costProfile: { currency: profile.tariff.currency, model: profile.tariff.model,
        inputMinorPerMillion: profile.tariff.inputMinorPerMillion,
        outputMinorPerMillion: profile.tariff.outputMinorPerMillion, fixedMinor: profile.tariff.fixedMinor,
        expiresAt: profile.tariff.expiresAt },
      rateLimits: lifecycle?.rateLimits ?? null,
      runtimeAvailability: "not_assessed",
      bindingState: "configured_profile",
    });
  }

  for (const profile of input.workerProfiles) {
    if (workerProfileUse.has(profile.id)) continue;
    const lifecycle = profile.lifecycle;
    entries.push({
      dependency: "worker_qualification_profile",
      companyId: profile.companyId,
      agentId: profile.workerAgentId,
      runtimeAdapter: null,
      provider: profile.binding.provider,
      model: profile.tariff.model,
      modelVersionOrReleaseIdentity: profile.tariff.model,
      lifecycleStatus: lifecycle?.status ?? "untracked",
      lifecycleOwner: lifecycle?.owner ?? null,
      retirementAt: lifecycle?.retirementAt ?? null,
      qualificationHash: profile.tariff.qualificationHash,
      regionOrRoutingProfile: lifecycle?.regionOrRoutingProfile ?? null,
      dataUseProfile: lifecycle?.dataUseProfile ?? null,
      supportedInputOutput: lifecycle?.supportedInputOutput ?? null,
      toolUseCapability: lifecycle?.toolUseCapability ?? null,
      contextLimits: { inputTokensUpperBound: profile.inputTokensUpperBound,
        maxOutputTokens: profile.maxOutputTokens, maximumEnvelopeBytes: profile.maximumEnvelopeBytes },
      costProfile: { currency: profile.tariff.currency, model: profile.tariff.model,
        inputMinorPerMillion: profile.tariff.inputMinorPerMillion,
        outputMinorPerMillion: profile.tariff.outputMinorPerMillion, fixedMinor: profile.tariff.fixedMinor,
        expiresAt: profile.tariff.expiresAt },
      rateLimits: lifecycle?.rateLimits ?? null,
      runtimeAvailability: "not_assessed",
      bindingState: "configured_not_current_agent_runtime",
    });
  }

  const byDependency = (dependency: SaasModelDependencyInventory["coverage"][number]["dependency"]) => {
    const relevant = entries.filter(entry => entry.dependency === dependency);
    return {
      dependency,
      configuration: dependency === "agent_runtime" ? "database_inventory" as const :
        dependency === "worker_qualification_profile" ? input.workerProfilesConfigured ? "configured" as const : "unconfigured" as const :
          dependency === "read_only_verifier" ? input.readOnlyProfilesConfigured ? "configured" as const : "unconfigured" as const :
            input.supportProfilesConfigured ? "configured" as const : "unconfigured" as const,
      entries: relevant.length,
      untracked: relevant.filter(entry => entry.lifecycleStatus === "untracked").length,
      unresolved: relevant.filter(entry => entry.bindingState === "unresolved" ||
        entry.bindingState === "adapter_model_not_reported" || entry.bindingState.endsWith("unresolved")).length,
    };
  };
  const dependencies: SaasModelDependencyInventory["coverage"][number]["dependency"][] =
    ["agent_runtime", "worker_qualification_profile", "read_only_verifier", "first_party_support"];
  entries.sort((left, right) =>
    left.dependency.localeCompare(right.dependency) ||
    left.companyId.localeCompare(right.companyId) ||
    (left.agentId ?? "").localeCompare(right.agentId ?? "") ||
    (left.provider ?? "").localeCompare(right.provider ?? "") ||
    (left.model ?? "").localeCompare(right.model ?? ""));
  return {
    observedAt: new Date().toISOString(),
    coverage: dependencies.map(byDependency),
    entries: entries.slice(0, 2000),
    truncated: entries.length > 2000,
    unresolvedAgentBindings,
  };
}
