import { expect, it, vi } from "vitest";
import { api } from "./client";
import { agentRetirementApi } from "./agent-retirement";
import type { AgentRetirementCommand, AgentRetirementView } from "@paperclipai/shared";

const company = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", agent = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const view: AgentRetirementView = { companyId: company, agentId: agent, name: "Reviewed agent", observedAt: "2026-10-11T00:00:00Z",
  sourceToken: "a".repeat(64), state: "ready", alreadyStopped: false, canRetire: true, blockers: [], retiredAt: null,
  policyVersion: "aw.agent-retirement.v1", affectedAccess: { apiKeys: 1, permissions: 2, agentPermissionSettings: 1, connectedApps: 0, credentialBindings: 0, runtimeBindings: 0, toolTokens: 0, toolProfiles: 0 } };
it("binds private original reads to the account and canonical agent, rejects context substitution and respects cancellation", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue(view), controller = new AbortController();
  try {
    expect(await agentRetirementApi.get(company.toUpperCase(), agent.toUpperCase(), "owner + account", controller.signal)).toEqual(view);
    expect(get).toHaveBeenCalledWith(`/companies/${company}/agents/${agent}/retirement?expectedUserId=owner%20%2B%20account`, { signal: controller.signal, cache: "no-store" });
    for (const change of [{ companyId: agent }, { agentId: company }, { credentials: "PRIVATE" }]) {
      get.mockResolvedValue({ ...view, ...change }); await expect(agentRetirementApi.get(company, agent, "owner")).rejects.toThrow();
    }
    get.mockResolvedValue(view); controller.abort();
    await expect(agentRetirementApi.get(company, agent, "owner", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  } finally { get.mockRestore(); }
});
it("sends only the strict reviewed request and rejects a foreign or malformed acknowledgement", async () => {
  const command: AgentRetirementCommand = { requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", expectedSourceToken: view.sourceToken,
    confirmRetirement: true, pendingWorkPolicy: "require_settled", accessPolicy: "detach_agent_only", retentionPolicy: "existing_company_policy" };
  const retired = { ...view, state: "retired", alreadyStopped: true, canRetire: false, retiredAt: view.observedAt };
  const post = vi.spyOn(api, "post").mockResolvedValue(retired);
  try {
    expect(await agentRetirementApi.retire(company, agent, "owner", command)).toEqual(retired);
    expect(post).toHaveBeenCalledWith(`/companies/${company}/agents/${agent}/retirement?expectedUserId=owner`, command);
    await expect(agentRetirementApi.retire(company, agent, "owner", { ...command, run: true } as AgentRetirementCommand)).rejects.toThrow();
    expect(post).toHaveBeenCalledTimes(1);
    post.mockResolvedValue({ ...retired, agentId: company });
    await expect(agentRetirementApi.retire(company, agent, "owner", command)).rejects.toThrow("Retirement context changed");
  } finally { post.mockRestore(); }
});
