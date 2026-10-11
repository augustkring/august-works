import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { agentRetirementCommandSchema, agentRetirementViewSchema, AGENT_RETIREMENT_POLICY_VERSION } from "./agent-retirement.js";

it("requires an explicit reviewed retirement and rejects execution, shared deletion or permission expansion", () => {
  const input = { requestId: randomUUID(), expectedSourceToken: "a".repeat(64), confirmRetirement: true,
    pendingWorkPolicy: "require_settled", accessPolicy: "detach_agent_only", retentionPolicy: "existing_company_policy" };
  expect(agentRetirementCommandSchema.parse(input)).toEqual(input);
  expect(agentRetirementCommandSchema.parse({ ...input, requestId: input.requestId.toUpperCase() }).requestId).toBe(input.requestId);
  for (const change of [{ confirmRetirement: false }, { pendingWorkPolicy: "cancel_all" }, { accessPolicy: "delete_shared_provider" },
    { retentionPolicy: "erase_history" }, { expectedSourceToken: "stale" }, { permissions: ["tools:admin"] }, { run: true }])
    expect(agentRetirementCommandSchema.safeParse({ ...input, ...change }).success).toBe(false);
});
it("cannot claim completed retirement or zero affected access from a blocked or unbounded owner", () => {
  const view = { companyId: randomUUID(), agentId: randomUUID(), name: "Original agent", observedAt: new Date().toISOString(),
    sourceToken: "b".repeat(64), state: "ready", alreadyStopped: false, canRetire: true, blockers: [], affectedAccess: {
      apiKeys: 0, permissions: 1, agentPermissionSettings: 1, connectedApps: 0, credentialBindings: 0, runtimeBindings: 0, toolTokens: 0, toolProfiles: 0 },
    retiredAt: null, policyVersion: AGENT_RETIREMENT_POLICY_VERSION };
  expect(agentRetirementViewSchema.parse(view)).toEqual(view);
  for (const change of [{ state: "retired" }, { blockers: ["work_pending"] }, { affectedAccess: null },
    { affectedAccess: { ...view.affectedAccess, apiKeys: 257 } }, { providerCredential: "PRIVATE" }])
    expect(agentRetirementViewSchema.safeParse({ ...view, ...change }).success).toBe(false);
  expect(agentRetirementViewSchema.safeParse({ ...view, state: "blocked", canRetire: false, blockers: ["source_limit"], affectedAccess: null }).success).toBe(true);
});
