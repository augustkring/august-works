// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { ExperienceObservationSettings } from "./ExperienceObservationSettings";
import { experienceObservationsApi } from "../api/experience-observations";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import { i18n } from "../i18n";
import type { ExperienceObservationPreference, ExperienceObservationPreferenceReceipt } from "@paperclipai/shared";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const company = "10000000-0000-4000-8000-000000000001";
const preference = (enabled = false, version = 0): ExperienceObservationPreference => ({ companyId: company,
  contractId: "aw.local-experience-observations.v1", enabled, version, collectionAvailable: true, retentionDays: 35, dailyLimit: 128, lastRequestId: null });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
let root: Root, host: HTMLDivElement, client: QueryClient;
async function mount(lang = "en") {
  await i18n.changeLanguage(lang);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  client.setQueryData(queryKeys.auth.session, v9SessionFixture("owner"));
  vi.spyOn(authApi, "getSession").mockResolvedValue(v9SessionFixture("owner"));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<QueryClientProvider client={client}><ExperienceObservationSettings companyId={company} principal="owner" /></QueryClientProvider>));
}
const button = (text: string) => [...host.querySelectorAll("button")].find(item => item.textContent === text)!;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  await client?.cancelQueries(); client?.clear(); host?.remove(); vi.restoreAllMocks(); await i18n.changeLanguage("en");
});
it("requires explicit consent, closes collection immediately on withdrawal, and rejects a late opt-in acknowledgement", async () => {
  let current = preference();
  vi.spyOn(experienceObservationsApi, "get").mockImplementation(async () => current);
  const lost = deferred<ExperienceObservationPreferenceReceipt>();
  const update = vi.spyOn(experienceObservationsApi, "update").mockImplementation(async (_company, _principal, input) => {
    if (input.enabled) return lost.promise;
    current = { ...preference(false, 2), lastRequestId: input.requestId };
    return { companyId: company, requestId: input.requestId, enabled: false, version: 2, observationsErased: true };
  });
  await mount();
  await vi.waitFor(() => expect(button("Allow local observations")).toBeTruthy());
  expect(update).not.toHaveBeenCalled();
  await act(async () => button("Allow local observations").click());
  expect(update).toHaveBeenCalledTimes(1);
  await act(async () => button("Turn off and delete observations").click());
  await vi.waitFor(() => expect(host.textContent).toContain("Your observations were deleted"));
  const original = update.mock.calls[0]![2];
  await act(async () => lost.resolve({ companyId: company, requestId: original.requestId, enabled: true, version: 1, observationsErased: false }));
  expect(host.textContent).toContain("Local observations are off");
  expect(update).toHaveBeenCalledTimes(2);
  expect(update.mock.calls[1]![2]).toMatchObject({ enabled: false, expectedVersion: null });
  expect(update.mock.calls[1]![2].requestId).not.toBe(original.requestId);
});
it("reconciles a lost reply from the current preference without replaying an opt-in", async () => {
  let current = preference();
  vi.spyOn(experienceObservationsApi, "get").mockImplementation(async () => current);
  const update = vi.spyOn(experienceObservationsApi, "update").mockImplementation(async (_company, _principal, input) => {
    current = { ...preference(true, 1), lastRequestId: input.requestId };
    throw new Error("PRIVATE-TRANSPORT-ERROR");
  });
  await mount(); await vi.waitFor(() => expect(button("Allow local observations")).toBeTruthy());
  await act(async () => button("Allow local observations").click());
  await vi.waitFor(() => expect(host.textContent).toContain("result could not be confirmed"));
  expect(host.textContent).not.toContain("PRIVATE-");
  await act(async () => button("Check current choice").click());
  await vi.waitFor(() => expect(host.textContent).toContain("Local observations are on"));
  expect(update).toHaveBeenCalledTimes(1);
  expect(host.textContent).not.toContain("result could not be confirmed");
});
it("keeps withdrawal available when collection is disabled and provides Danish disclosure", async () => {
  vi.spyOn(experienceObservationsApi, "get").mockResolvedValue({ ...preference(true, 1), collectionAvailable: false });
  const update = vi.spyOn(experienceObservationsApi, "update").mockResolvedValue({ companyId: company,
    requestId: "10000000-0000-4000-8000-000000000002", enabled: false, version: 2, observationsErased: true });
  await mount("da");
  await vi.waitFor(() => expect(host.textContent).toContain("højst 35 dage"));
  expect(button("Tillad lokale observationer")).toBeUndefined();
  await act(async () => button("Slå fra og slet observationer").click());
  expect(update).toHaveBeenCalledWith(company, "owner", expect.objectContaining({ enabled: false }));
});
it("withdraws private controls while the original session is unresolved", async () => {
  vi.spyOn(experienceObservationsApi, "get").mockResolvedValue(preference());
  const update = vi.spyOn(experienceObservationsApi, "update");
  await mount(); await vi.waitFor(() => expect(button("Allow local observations")).toBeTruthy());
  const pending = deferred<ReturnType<typeof v9SessionFixture>>(); let request!: Promise<unknown>;
  await act(async () => { request = client.fetchQuery({ queryKey: queryKeys.auth.session, queryFn: () => pending.promise }); });
  await vi.waitFor(() => expect(button("Allow local observations")).toBeUndefined());
  expect(button("Turn off and delete observations").disabled).toBe(true);
  await act(async () => pending.resolve(v9SessionFixture("other"))); await request;
  expect(update).not.toHaveBeenCalled();
});
