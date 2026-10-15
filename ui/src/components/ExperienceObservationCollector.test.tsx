// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { ExperienceObservationCollector, ObservationScope } from "./ExperienceObservationCollector";
import { experienceObservationsApi } from "../api/experience-observations";
import { instanceSettingsApi } from "../api/instanceSettings";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const company = "10000000-0000-4000-8000-000000000001";
let root: Root, host: HTMLDivElement, client: QueryClient;
async function mount(enabled = true) {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  client.setQueryData(queryKeys.auth.session, v9SessionFixture("owner"));
  vi.spyOn(authApi, "getSession").mockResolvedValue(v9SessionFixture("owner"));
  vi.spyOn(instanceSettingsApi, "getExperimental").mockResolvedValue({ experience_analytics_v9: true, enableStreamlinedUi: false } as never);
  const get = vi.spyOn(experienceObservationsApi, "get").mockResolvedValue({ companyId: company, contractId: "aw.local-experience-observations.v1",
    enabled, version: 3, collectionAvailable: true, retentionDays: 35, dailyLimit: 128, lastRequestId: null });
  const record = vi.spyOn(experienceObservationsApi, "record").mockImplementation(async (_company, _principal, input) => ({ requestId: input.requestId, status: "recorded" }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await render(); await vi.waitFor(() => expect(get).toHaveBeenCalled());
  return record;
}
async function render(navigation = "1") { await act(async () => root.render(<QueryClientProvider client={client}>
  <ObservationScope company={company} principal="owner" surface="activation" step="review" navigation={navigation} />
</QueryClientProvider>)); }
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  await client?.cancelQueries(); client?.clear(); host?.remove(); vi.restoreAllMocks();
});
it("collects only consented finite metadata and excludes hidden intervals", async () => {
  const record = await mount(); await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1));
  expect(record.mock.calls[0]![2]).toEqual({ requestId: expect.any(String), preferenceVersion: 3,
    kind: "activation_step_opened", surface: "activation", variant: "classic", step: "review", durationBucket: null });
  await act(async () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(record).toHaveBeenCalledTimes(2);
  expect(record.mock.calls[1]![2]).toMatchObject({ kind: "active_view_interval", step: null, durationBucket: "under_minute" });
  await render("2"); expect(record).toHaveBeenCalledTimes(2);
});
it("does not observe without personal consent", async () => {
  const record = await mount(false); await render("2"); expect(record).not.toHaveBeenCalled();
});
it("drops samples when the current preference is withdrawn or invalidated before React renders", async () => {
  const record = await mount(); await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1));
  await act(async () => {
    void client.invalidateQueries({ queryKey: ["experience-observation-preference", company, "owner"], refetchType: "none" });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(record).toHaveBeenCalledTimes(1);
});
it("does not retry a failed sample or expose its error in customer UI", async () => {
  const record = vi.spyOn(experienceObservationsApi, "record").mockRejectedValue(new Error("PRIVATE-SAMPLE-ERROR"));
  await mount(false);
  // A fresh opted-in source enables collection, while the C0 failure is dropped.
  vi.mocked(experienceObservationsApi.get).mockResolvedValue({ companyId: company, contractId: "aw.local-experience-observations.v1",
    enabled: true, version: 3, collectionAvailable: true, retentionDays: 35, dailyLimit: 128, lastRequestId: null });
  record.mockRejectedValue(new Error("PRIVATE-SAMPLE-ERROR"));
  await act(async () => { await client.invalidateQueries({ queryKey: ["experience-observation-preference", company, "owner"] }); });
  await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1));
  expect(host.textContent).toBe("");
});

it("does not read personal identity or preferences while rollout is off", async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  vi.spyOn(instanceSettingsApi, "getExperimental").mockResolvedValue({ experience_analytics_v9: false } as never);
  const session = vi.spyOn(authApi, "getSession"), preference = vi.spyOn(experienceObservationsApi, "get"), record = vi.spyOn(experienceObservationsApi, "record");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<QueryClientProvider client={client}><ExperienceObservationCollector /></QueryClientProvider>));
  await vi.waitFor(() => expect(instanceSettingsApi.getExperimental).toHaveBeenCalled());
  expect(session).not.toHaveBeenCalled(); expect(preference).not.toHaveBeenCalled(); expect(record).not.toHaveBeenCalled();
});
