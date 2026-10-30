import { describe, expect, it } from "vitest";
import type { WorkerModelProfile } from "../orchestration/worker-model-profiles.js";
import { projectCurrentModelRetirementNotice, projectOperatorModelRetirementNotice } from "./model-retirement-notices.js";

const companyId = "00000000-0000-4000-8000-000000000001";
const agentId = "00000000-0000-4000-8000-000000000002";
const profileId = "00000000-0000-4000-8000-000000000003";
const agent = { id: agentId, adapterConfig: { provider: "aw_text_only", model: "model-a", workerModelProfileId: profileId, maxOutputTokens: 2048 } };
function profile(overrides: Record<string, unknown> = {}) {
  return { id: profileId, companyId, workerAgentId: agentId, tariff: { model: "model-a" },
    binding: { apiKey: "never-expose" }, providerProfileRef: "/private/model-profile.json",
    lifecycle: { status: "migration_required", owner: "model owner", retirementAt: "2026-11-01T00:00:00Z",
      replacementProfileId: "private-replacement-ref", regionOrRoutingProfile: "private-region", dataUseProfile: "private-data-use",
      supportedInputOutput: ["text"], toolUseCapability: false, rateLimits: { requestsPerMinute: 2, tokensPerMinute: 3 } }, ...overrides,
  } as unknown as WorkerModelProfile;
}

describe("canonical model retirement notice projection", () => {
  it("projects only the sanitized current Agent action and owner-declared date", () => {
    const notice = projectCurrentModelRetirementNotice(companyId, agent, [profile()], Date.parse("2026-10-28T00:00:00Z"));
    expect(notice).toEqual({
      id: agentId, category: "action_required", title: "A current Agent model needs migration",
      summary: "Review the affected Agent and publish a currently qualified replacement model.",
      affectedCompanyId: companyId, affectedAgentId: agentId, effectiveAt: "2026-11-01T00:00:00Z",
      actionRequired: true, mandatoryVisibility: true, completionOwner: "current_agent_model_selection", actionPath: `/agents/${agentId}`,
    });
    expect(JSON.stringify(notice)).not.toContain("private");
    expect(JSON.stringify(notice)).not.toContain("model-a");
  });

  it("does not invent dates or project an unrelated or untracked dependency", () => {
    expect(projectCurrentModelRetirementNotice(companyId, agent, [profile({ lifecycle: undefined })])).toBeNull();
    expect(projectCurrentModelRetirementNotice(companyId, agent, [profile({ companyId: "00000000-0000-4000-8000-000000000099" })])).toBeNull();
    expect(projectCurrentModelRetirementNotice(companyId, agent, [profile({ tariff: { model: "different-model" } })])).toBeNull();
  });

  it("projects a blocked lifecycle for the currently selected Agent model", () => {
    expect(projectCurrentModelRetirementNotice(companyId, agent, [profile({ lifecycle: {
      ...profile().lifecycle!, status: "blocked", retirementAt: null,
    } })])).toMatchObject({
      affectedCompanyId: companyId, affectedAgentId: agentId, effectiveAt: null,
      completionOwner: "current_agent_model_selection",
    });
  });

  it("projects only the selected tenant dependency as a sanitized Human operator action", () => {
    const lifecycle = { status: "migration_required", owner: "private owner", retirementAt: "2026-11-01T00:00:00Z",
      replacementProfileId: "private replacement", regionOrRoutingProfile: "private region", dataUseProfile: "private terms",
      supportedInputOutput: ["text"] as ("text" | "image" | "audio" | "video")[], toolUseCapability: false,
      rateLimits: { requestsPerMinute: 10, tokensPerMinute: 1000 } };
    const notice = projectOperatorModelRetirementNotice(companyId, "jev_skill_suggestion", lifecycle, Date.parse("2026-10-28T00:00:00Z"));
    expect(notice).toEqual({
      id: expect.any(String), category: "action_required",
      title: "A company model dependency needs operator review",
      summary: "An enabled model dependency is blocked or nearing retirement. Contact support to review its migration.",
      affectedCompanyId: companyId, dependency: "jev_skill_suggestion", effectiveAt: lifecycle.retirementAt,
      actionRequired: true, mandatoryVisibility: true, completionOwner: "operator_model_dependency", actionPath: "/company/help",
    });
    expect(JSON.stringify(notice)).not.toContain("private");
    expect(projectOperatorModelRetirementNotice(companyId, "read_only_verifier", undefined)).toBeNull();
    expect(projectOperatorModelRetirementNotice("00000000-0000-4000-8000-000000000099", "read_only_verifier", lifecycle)).not.toMatchObject({
      affectedCompanyId: companyId,
    });
    expect(projectOperatorModelRetirementNotice(companyId, "jev_skill_suggestion", { ...lifecycle, status: "blocked" }))
      .toMatchObject({ affectedCompanyId: companyId, completionOwner: "operator_model_dependency", actionPath: "/company/help" });
  });
});
