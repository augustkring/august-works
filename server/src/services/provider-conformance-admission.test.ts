import { describe, expect, it, vi } from "vitest";
const spies = vi.hoisted(() => ({ secrets: vi.fn(), execute: vi.fn(), nativeProbe: vi.fn(),
  discover: vi.fn(), draft: vi.fn(async () => ({ existingReservedDraft: true })),
  opencode: vi.fn(async () => ({ existingReservedOpenCode: true })) }));
vi.mock("@paperclipai/db", () => ({ agents: { companyId: "company", id: "agent", adapterType: "type", adapterConfig: "config" },
  agentIdentities: {}, agentPresenceRuntimeBindings: {}, heartbeatRuns: {}, issues: {} }));
vi.mock("@paperclipai/shared", () => ({ providerConformanceInputSchema: { parse: (value: unknown) => value } }));
vi.mock("@paperclipai/adapter-utils", () => ({ testGatewayProviderConformance: spies.execute }));
vi.mock("./native-provider-conformance.js", () => ({ executeNativeProviderConformance: spies.nativeProbe }));
vi.mock("./a2a-execution.js", () => ({ executeA2A: spies.execute }));
vi.mock("../adapters/index.js", () => ({ getServerAdapter: () => ({ execute: spies.execute }) }));
vi.mock("./v5-authorization.js", () => ({ assertV5Authorization: vi.fn(), assertV5Enabled: vi.fn(), v5HumanActorId: () => "user" }));
vi.mock("./agent-provider-bindings.js", () => ({ agentProviderBindingService: () => ({}) }));
vi.mock("./provider-discovery.js", () => ({ providerDiscoveryService: spies.discover }));
vi.mock("./provider-capabilities.js", () => ({ providerConformanceRequirements: () => [] }));
vi.mock("./context/context-manifest.js", () => ({ hashContextPolicySnapshot: () => "hash" }));
vi.mock("./secrets.js", () => ({ secretService: spies.secrets }));
vi.mock("./budgets.js", () => ({ budgetService: vi.fn() }));
vi.mock("./costs.js", () => ({ costService: vi.fn() }));
vi.mock("./v5-mutations.js", () => ({ withV5ActivityTransaction: vi.fn() }));
vi.mock("./activity-log.js", () => ({ logActivity: vi.fn() }));
vi.mock("./native-draft-conformance.js", () => ({ installedNativeDraftConformance: () => ({ test: spies.draft }) }));
vi.mock("./native-opencode-conformance.js", () => ({ installedNativeOpenCodeConformance: () => ({ test: spies.opencode }) }));
import { providerConformanceService } from "./provider-conformance.js";
function database(adapterType: string, provider?: string) {
  return { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ adapterType, adapterConfig: { provider } }] }) }) }) } as any;
}
describe("actual provider conformance entry admission", () => {
  it.each(["hermes_local", "openclaw_gateway", "claude_local", "paperclip_runner"])(
    "refuses unqualified %s paid probes before secret selection or provider invocation", async adapterType => {
      vi.clearAllMocks();
      await expect(providerConformanceService(database(adapterType, "codex")).test({ type: "board", userId: "user" } as any,
        "company", "agent", { acknowledgeProviderRuns: true, maximumCostCents: 1, isolationPeer: null }))
        .rejects.toMatchObject({ status: 409, details: { code: "configuration_incomplete",
          configurationIncomplete: { reason: "paid_transport_unqualified", actionUrl: "/agents/agent/runtime" } } });
      expect(spies.secrets).not.toHaveBeenCalled();
      expect(spies.execute).not.toHaveBeenCalled();
      expect(spies.nativeProbe).not.toHaveBeenCalled();
      expect(spies.draft).not.toHaveBeenCalled();
      expect(spies.opencode).not.toHaveBeenCalled();
    });
  it("retains the existing installed reserved Native draft owner handoff", async () => {
    vi.clearAllMocks();
    await expect(providerConformanceService(database("paperclip_runner", "aw_text_only")).test(
      { type: "board", userId: "user" } as any, "company", "agent",
      { acknowledgeProviderRuns: true, maximumCostCents: 1, isolationPeer: null })).resolves.toEqual({ existingReservedDraft: true });
    expect(spies.draft).toHaveBeenCalledOnce();
    expect(spies.secrets).not.toHaveBeenCalled();
    expect(spies.execute).not.toHaveBeenCalled();
  });
  it("delegates only the saved OpenCode route to its installed bounded conformance owner", async () => {
    vi.clearAllMocks();
    const actor = { type: "board" as const, userId: "user" };
    const input = { acknowledgeProviderRuns: true as const, maximumCostCents: 1, isolationPeer: null };
    await expect(providerConformanceService(database("paperclip_runner", "opencode")).test(
      actor, "company", "agent", input)).resolves.toEqual({ existingReservedOpenCode: true });
    expect(spies.opencode).toHaveBeenCalledExactlyOnceWith(actor, "company", "agent", input);
    expect(spies.draft).not.toHaveBeenCalled();
    expect(spies.nativeProbe).not.toHaveBeenCalled();
    expect(spies.secrets).not.toHaveBeenCalled();
    expect(spies.execute).not.toHaveBeenCalled();
  });

});
