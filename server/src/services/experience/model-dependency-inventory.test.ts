import { describe, expect, it } from "vitest";
import type { WorkerModelProfile } from "../orchestration/worker-model-profiles.js";
import type { ReadOnlyModelProfile } from "../orchestration/read-only-model-profiles.js";
import type { FirstPartySupportModelProfile } from "../orchestration/first-party-support-model-profiles.js";
import { projectSaasModelDependencyInventory } from "./model-dependency-inventory.js";

const companyId = "00000000-0000-4000-8000-000000000001";
const agentId = "00000000-0000-4000-8000-000000000002";
const profileId = "00000000-0000-4000-8000-000000000003";
const model = {
  contract: "anthropic-text-messages-2023-06-01",
  tariff: { provider: "anthropic", model: "claude-exact-release", currency: "USD", inputMinorPerMillion: 10,
    outputMinorPerMillion: 20, fixedMinor: 0, qualificationHash: "a".repeat(64), sourceSha: "b".repeat(40),
    testedAt: "2026-10-27T00:00:00.000Z", expiresAt: "2026-10-29T00:00:00.000Z" },
  maximumEnvelopeBytes: 4096, inputTokensUpperBound: 10000, maxOutputTokens: 1024,
  qualificationEvidenceRef: "https://evidence.example.test/qualification/private-record",
  qualificationArtifactSha256: "c".repeat(64),
};
const worker = (lifecycle?: WorkerModelProfile["lifecycle"]) => ({
  ...model, id: profileId, companyId, workerAgentId: agentId,
  transport: "server-text-only-v1", providerBindingId: "00000000-0000-4000-8000-000000000004",
  providerSnapshotHash: "d".repeat(64), providerProfileRef: "/private/model-profile.json",
  qualifiedConfigurationHash: "e".repeat(64), binding: { provider: "anthropic", method: "api_key", apiKey: "never-return-this" },
  ...(lifecycle ? { lifecycle } : {}),
}) as unknown as WorkerModelProfile;
const readOnly = () => ({
  ...model, id: "00000000-0000-4000-8000-000000000005", companyId, reviewerAgentId: agentId,
  purposes: ["read_only_verification"], calibrationHash: "f".repeat(64),
  binding: { provider: "anthropic", method: "api_key", secretRef: "operator-private-secret" },
}) as unknown as ReadOnlyModelProfile;
const support = () => ({
  ...model, companyId, packageVersionId: "00000000-0000-4000-8000-000000000006",
  purpose: "first_party_support", funder: "blentera_platform", profileId: "support-primary",
  providerAccountId: "support-account", credentialBindingHash: "1".repeat(64),
  privacyNoticeUrl: "https://example.test/privacy", periodKey: "2026-10",
  periodStartsAt: "2026-10-01T00:00:00.000Z", periodEndsAt: "2026-11-01T00:00:00.000Z",
  maxCostMinor: 1000, maxCalls: 100,
}) as unknown as FirstPartySupportModelProfile;
const empty = () => ({
  agents: [], workerProfiles: [], readOnlyProfiles: [], supportProfiles: [],
  jevProfiles: [], jevSettings: [],
  workerProfilesConfigured: false, readOnlyProfilesConfigured: false, supportProfilesConfigured: false,
  jevProfilesConfigured: false,
});

describe("operator model dependency inventory projection", () => {
  it("covers current native Agent bindings and reports lifecycle facts as untracked", () => {
    const result = projectSaasModelDependencyInventory({
      ...empty(),
      agents: [{ id: agentId, companyId, adapterType: "paperclip_runner",
        adapterConfig: { provider: "opencode", model: "provider/model-exact", env: { TOKEN: "secret-value" } }, runtimeConfig: {} }],
    });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      dependency: "agent_runtime", companyId, agentId, provider: "opencode", model: "provider/model-exact",
      modelVersionOrReleaseIdentity: null, lifecycleStatus: "untracked", bindingState: "provider_model_configured",
      regionOrRoutingProfile: null, dataUseProfile: null, costProfile: null,
    });
    expect(JSON.stringify(result)).not.toContain("secret-value");
  });

  it("covers other current Agent adapters without inventing provider/model or lifecycle facts", () => {
    const otherAgentId = "00000000-0000-4000-8000-000000000007";
    const credentialShapedAgentId = "00000000-0000-4000-8000-000000000008";
    const result = projectSaasModelDependencyInventory({
      ...empty(),
      agents: [
        { id: agentId, companyId, adapterType: "opencode_local",
          adapterConfig: { model: "openrouter/deepseek-v4-flash" }, runtimeConfig: {} },
        { id: otherAgentId, companyId, adapterType: "http", adapterConfig: {}, runtimeConfig: {} },
        { id: credentialShapedAgentId, companyId, adapterType: "codex_local",
          adapterConfig: { model: "sk-ant-api03-do-not-return" }, runtimeConfig: {} },
      ],
    });
    expect(result.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ agentId, runtimeAdapter: "opencode_local", provider: "openrouter",
        model: "openrouter/deepseek-v4-flash", lifecycleStatus: "untracked", bindingState: "provider_model_configured" }),
      expect.objectContaining({ agentId: otherAgentId, runtimeAdapter: "http", provider: null,
        model: null, lifecycleStatus: "untracked", bindingState: "adapter_model_not_reported" }),
      expect.objectContaining({ agentId: credentialShapedAgentId, runtimeAdapter: "codex_local", provider: null,
        model: null, lifecycleStatus: "untracked", bindingState: "adapter_model_not_reported" }),
    ]));
    expect(result.unresolvedAgentBindings).toBe(2);
    expect(JSON.stringify(result)).not.toContain("sk-ant-api03-do-not-return");
  });

  it("uses only the exact selected worker qualification and projects its lifecycle without credentials or private refs", () => {
    const lifecycle = { status: "migration_required" as const, owner: "model owner",
      retirementAt: "2026-11-01T00:00:00.000Z", replacementProfileId: "private-candidate",
      regionOrRoutingProfile: "region-a", dataUseProfile: "no-training",
      supportedInputOutput: ["text"] as ("text" | "image" | "audio" | "video")[], toolUseCapability: false,
      rateLimits: { requestsPerMinute: 10, tokensPerMinute: 1000 } };
    const result = projectSaasModelDependencyInventory({
      ...empty(),
      agents: [{ id: agentId, companyId, adapterType: "paperclip_runner",
        adapterConfig: { provider: "aw_text_only", model: "claude-exact-release", workerModelProfileId: profileId }, runtimeConfig: {} }],
      workerProfiles: [worker(lifecycle)],
      workerProfilesConfigured: true,
    });
    expect(result.entries[0]).toMatchObject({ dependency: "agent_runtime", lifecycleStatus: "migration_required",
      lifecycleOwner: "model owner", retirementAt: lifecycle.retirementAt, bindingState: "qualified_profile_bound" });
    expect(result.entries.some(entry => entry.dependency === "worker_qualification_profile")).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private-candidate");
    expect(JSON.stringify(result)).not.toContain("never-return-this");
    expect(JSON.stringify(result)).not.toContain("private/model-profile");
  });

  it("includes operator-owned verifier and Support profiles and states missing lifecycle facts explicitly", () => {
    const result = projectSaasModelDependencyInventory({
      ...empty(), readOnlyProfiles: [readOnly()], supportProfiles: [support()],
      readOnlyProfilesConfigured: true, supportProfilesConfigured: true,
    });
    expect(result.coverage).toEqual(expect.arrayContaining([
      expect.objectContaining({ dependency: "read_only_verifier", configuration: "configured", entries: 1, untracked: 1 }),
      expect.objectContaining({ dependency: "first_party_support", configuration: "configured", entries: 1, untracked: 1 }),
    ]));
    expect(result.entries.map(entry => entry.dependency)).toEqual(["first_party_support", "read_only_verifier"]);
    expect(result.entries.every(entry => entry.lifecycleStatus === "untracked")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("operator-private-secret");
    expect(JSON.stringify(result)).not.toContain("qualification/private-record");
  });

  it("reports a configured provider without a model and makes missing profile config visible", () => {
    const result = projectSaasModelDependencyInventory({
      ...empty(), agents: [{ id: agentId, companyId, adapterType: "paperclip_runner", adapterConfig: { provider: "unsupported" }, runtimeConfig: {} }],
    });
    expect(result.entries[0]).toMatchObject({ lifecycleStatus: "untracked", bindingState: "adapter_model_not_reported",
      provider: "unsupported", model: null });
    expect(result.unresolvedAgentBindings).toBe(1);
    expect(result.coverage).toEqual(expect.arrayContaining([
      expect.objectContaining({ dependency: "read_only_verifier", configuration: "unconfigured", entries: 0 }),
      expect.objectContaining({ dependency: "first_party_support", configuration: "unconfigured", entries: 0 }),
    ]));
  });

  it("projects only each Jev profile under its configured company and never exposes account or profile references", () => {
    const otherCompanyId = "00000000-0000-4000-8000-000000000009";
    const base = {
      connectionId: "private-connection", grantId: "private-grant", profileId: "private-profile",
      credentialBindingHash: "a".repeat(64), sourceSha: "b".repeat(40), qualificationHash: "c".repeat(64),
      processor: "openrouter" as const, processorTermsHash: "d".repeat(64), retentionPolicyHash: "e".repeat(64), retentionDays: 0,
      testedAt: "2026-10-28T00:00:00.000Z", expiresAt: "2026-10-29T00:00:00.000Z", processingRegion: "us" as const,
      setupCostCapMinor: 5, setupMaxCalls: 3, inputTokensUpperBound: 100, maxOutputTokens: 20,
      tariff: { provider: "openrouter" as const, model: "typesafe/jev-1.13", currency: "USD" as const,
        inputMinorPerMillion: 100, outputMinorPerMillion: 200, fixedMinor: 0,
        qualificationHash: "c".repeat(64), sourceSha: "b".repeat(40), testedAt: "2026-10-28T00:00:00.000Z", expiresAt: "2026-10-29T00:00:00.000Z" },
    };
    const lifecycle = { status: "active" as const, owner: "Jev operator", retirementAt: null, replacementProfileId: null,
      regionOrRoutingProfile: "us", dataUseProfile: "terms-hash", supportedInputOutput: ["text"] as ("text" | "image" | "audio" | "video")[],
      toolUseCapability: false, rateLimits: { requestsPerMinute: 10, tokensPerMinute: 1000 } };
    const result = projectSaasModelDependencyInventory({ ...empty(), jevProfilesConfigured: true,
      jevProfiles: [
        { ...base, companyId, lifecycle } as unknown as import("../jev-skill-suggestions.js").JevSkillSuggestionProfile,
        { ...base, companyId: otherCompanyId, connectionId: "other-private-connection", grantId: "other-private-grant", lifecycle: undefined } as unknown as import("../jev-skill-suggestions.js").JevSkillSuggestionProfile,
      ],
      jevSettings: [{ companyId, mode: "shadow", allowBackground: true, connectionId: base.connectionId, grantId: base.grantId }],
    });
    expect(result.entries.filter(entry => entry.dependency === "jev_skill_suggestion")).toEqual(expect.arrayContaining([
      expect.objectContaining({ companyId, provider: "openrouter", model: "typesafe/jev-1.13", lifecycleStatus: "active",
        regionOrRoutingProfile: "us", dataUseProfile: "terms-hash", bindingState: "configured_profile" }),
      expect.objectContaining({ companyId: otherCompanyId, lifecycleStatus: "untracked", bindingState: "configured_not_current_agent_runtime" }),
    ]));
    expect(JSON.stringify(result)).not.toContain("private-connection");
    expect(JSON.stringify(result)).not.toContain("private-grant");
    expect(JSON.stringify(result)).not.toContain("private-profile");
  });
});
