// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { SaasCostSnapshot, SaasOperationsSnapshot } from "@paperclipai/shared";
import { saasApi } from "../api/saas";
import { SaasOperationsPage } from "./SaasOperations";

const account = vi.hoisted(() => ({ userId: "operator", sessionId: "session-1", settled: true,
  localImplicit: false, failed: false, authorityEpoch: 0, current: true }));
vi.mock("../hooks/useV9CurrentAccount", () => ({
  useV9CurrentAccount: () => account,
  hasCurrentV9Session: () => account.current,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const snapshot = (model: string): SaasOperationsSnapshot => ({
  environment: "staging", jobs: [], queues: [], hosts: [], profiles: [], versions: [], support: [], deployments: [],
  modelDependencies: {
    observedAt: "2026-10-28T00:00:00.000Z", truncated: false, unresolvedAgentBindings: 0,
    coverage: [{ dependency: "agent_runtime", configuration: "database_inventory", entries: 1, untracked: 1, unresolved: 0 }],
    entries: [{ dependency: "agent_runtime", companyId: "10000000-0000-4000-8000-000000000001",
      agentId: "10000000-0000-4000-8000-000000000002", runtimeAdapter: "opencode_local", provider: "provider",
      model, modelVersionOrReleaseIdentity: null, lifecycleStatus: "untracked", lifecycleOwner: null, retirementAt: null,
      qualificationHash: null, regionOrRoutingProfile: null, dataUseProfile: null, supportedInputOutput: null,
      toolUseCapability: null, contextLimits: null, costProfile: null, rateLimits: null,
      runtimeAvailability: "not_assessed", bindingState: "provider_model_configured" }],
  },
});
const costSnapshot: SaasCostSnapshot = {
  observedAt: "2026-10-28T00:00:00.000Z", month: "2026-10", currency: "EUR", basis: "provider_price_estimate",
  platformMonthlyMinor: "5000", newHostMonthlyMinor: "10000", hostPlan: "fixture", reportSha256: "a".repeat(64),
  estimatedMonthlyCogsMinor: "15000", reportedMrrMinor: "25000", reportedArrMinor: "300000", estimatedGrossMarginMinor: "10000",
  unallocatedHostCostMinor: "0", hosts: [], accounts: [],
  unitEconomics: {
    schemaVersion: 1,
    windowStart: "2026-10-01T00:00:00.000Z", windowEnd: "2026-11-01T00:00:00.000Z", observedAt: "2026-10-28T00:00:00.000Z",
    coverage: "partial_sources_only", platformCost: { amountMinor: "5000", currency: "EUR", basis: "provider_price_estimate", source: "operator_report", allocation: "environment_unallocated" },
    managedRuntimeHostCost: { amountMinor: "10000", currency: "EUR", basis: "provider_price_estimate", source: "operator_report_cpu_reservation_estimate", unallocatedMultiCompanyMinor: "0", unallocatedNoActiveCompanyMinor: "0" },
    providerModelCost: { reportedCents: "125", estimatedCents: null, currency: "unspecified", source: "cost_events", reportedEventCount: 1, estimatedEventCount: 0, unpricedEventCount: 1, unrecognizedEventCount: 0, captureCompleteness: "not_established" },
    runtimeAndStorageUsage: { source: "usage_aggregates", status: "aggregated_rows", companyCount: 1, bucketCount: 1, latestSourceWatermark: "2026-10-28T00:00:00.000Z", quantities: [{ meterKey: "runtime.shared_millisecond", quantity: "60000", unit: "millisecond" }] },
    unavailable: { supportCost: "not_recorded", analyticsCost: "not_recorded", networkAndToolCost: "not_recorded", storageAndRuntimeRates: "not_configured", agentRunClassCost: "not_classified", acceptedOutcomeCost: "no_canonical_cost_attribution" },
    tenants: [{ companyId: "10000000-0000-4000-8000-000000000001", billingAccountId: "10000000-0000-4000-8000-000000000003", activeCompanyCountOnBillingAccount: 1,
      providerReportedCents: "125", providerEstimatedCents: null, providerReportedEventCount: 1, providerEstimatedEventCount: 0, providerUnpricedEventCount: 1, providerUnrecognizedEventCount: 0,
      usage: [{ meterKey: "runtime.shared_millisecond", quantity: "60000", unit: "millisecond" }], estimatedHostRuntimeMinor: "2500", estimatedHostRuntimeCurrency: "EUR", hostAllocation: "single_active_company", totalCost: "unavailable_incomplete_components" }],
  },
};
const costSnapshotWithPlatform = (amountMinor: string): SaasCostSnapshot => ({
  ...costSnapshot,
  platformMonthlyMinor: amountMinor,
  estimatedMonthlyCogsMinor: (BigInt(amountMinor) + BigInt(costSnapshot.newHostMonthlyMinor)).toString(),
  unitEconomics: { ...costSnapshot.unitEconomics!, platformCost: { ...costSnapshot.unitEconomics!.platformCost, amountMinor } },
});

let root: Root | undefined, container: HTMLDivElement | undefined, client: QueryClient | undefined;
async function render() {
  await act(async () => root!.render(<QueryClientProvider client={client!}><SaasOperationsPage /></QueryClientProvider>));
}
async function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await render();
}
function mockOtherReads() {
  vi.spyOn(saasApi, "providerInventory").mockResolvedValue(null);
  vi.spyOn(saasApi, "costs").mockResolvedValue(null);
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove(); client?.clear(); vi.restoreAllMocks();
  Object.assign(account, { userId: "operator", sessionId: "session-1", settled: true,
    localImplicit: false, failed: false, authorityEpoch: 0, current: true });
});

it("withdraws cached operator inventory and cost view while the same principal reauthenticates", async () => {
  mockOtherReads();
  const operations = vi.spyOn(saasApi, "operations").mockResolvedValueOnce(snapshot("previous-release"))
    .mockResolvedValue(snapshot("current-release"));
  const costs = vi.spyOn(saasApi, "costs").mockResolvedValueOnce(costSnapshotWithPlatform("7777"))
    .mockResolvedValue(costSnapshotWithPlatform("8888"));
  await mount();
  await vi.waitFor(() => expect(container!.textContent).toContain("previous-release"));
  await vi.waitFor(() => expect(container!.textContent).toContain("77.77 EUR"));

  await act(async () => {
    Object.assign(account, { settled: false, current: false, authorityEpoch: 1 });
    await render();
  });
  expect(container!.textContent).not.toContain("previous-release");
  expect(container!.textContent).not.toContain("77.77 EUR");

  await act(async () => {
    Object.assign(account, { sessionId: "session-2", settled: true, current: true, authorityEpoch: 2 });
    await render();
  });
  await vi.waitFor(() => expect(container!.textContent).toContain("current-release"));
  await vi.waitFor(() => expect(container!.textContent).toContain("88.88 EUR"));
  expect(container!.textContent).not.toContain("previous-release");
  expect(container!.textContent).not.toContain("77.77 EUR");
  expect(operations).toHaveBeenCalledTimes(2);
  expect(costs).toHaveBeenCalledTimes(2);
});

it("discards a late inventory response from the previous session", async () => {
  mockOtherReads();
  let finishOld!: (value: SaasOperationsSnapshot) => void;
  const operations = vi.spyOn(saasApi, "operations").mockImplementationOnce(() =>
    new Promise(resolve => { finishOld = resolve; })).mockResolvedValue(snapshot("current-release"));
  await mount();
  await vi.waitFor(() => expect(operations).toHaveBeenCalledTimes(1));

  await act(async () => {
    Object.assign(account, { settled: false, current: false, authorityEpoch: 1 });
    await render();
  });
  expect(container!.textContent).not.toContain("previous-release");

  await act(async () => {
    Object.assign(account, { sessionId: "session-2", settled: true, current: true, authorityEpoch: 2 });
    await render();
  });
  await vi.waitFor(() => expect(container!.textContent).toContain("current-release"));
  await act(async () => finishOld(snapshot("previous-release")));
  await vi.waitFor(() => expect(container!.textContent).toContain("current-release"));
  expect(container!.textContent).not.toContain("previous-release");
  expect(operations).toHaveBeenCalledTimes(2);
});

it("renders cost sources as partial and keeps unknown currency and outcome cost unavailable", async () => {
  mockOtherReads();
  vi.spyOn(saasApi, "operations").mockResolvedValue(snapshot("current-release"));
  vi.spyOn(saasApi, "costs").mockResolvedValue(costSnapshot);
  await mount();
  await vi.waitFor(() => expect(container!.textContent).toContain("Partial observed sources only"));
  expect(container!.textContent).toContain("Currency unspecified");
  expect(container!.textContent).toContain("cost per accepted outcome are unavailable");
  expect(container!.textContent).toContain("support, analytics, network and tool costs");
});
