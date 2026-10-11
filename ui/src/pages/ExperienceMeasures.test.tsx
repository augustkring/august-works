// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { ExperienceMeasures as View } from "@paperclipai/shared";
import { experienceMeasuresApi } from "../api/experience-measures";
import { authApi } from "../api/auth";
import { ExperienceMeasures } from "./ExperienceMeasures";
import { i18n } from "../i18n";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let live: (event: { companyId: string; type: string; payload: Record<string, unknown> }) => void;
vi.mock("../context/LiveUpdatesProvider", () => ({ useCompanyLiveEvent: (listener: typeof live) => { live = listener; } }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company", selectedCompany: { issuePrefix: "AW" } }) }));
const data: View = { companyId: "company", observedAt: "2026-10-11T00:00:05Z", contractId: "aw.activation-owner-measures.v1", status: "verified",
  creationToVerificationBucket: "one_to_five_minutes", recordedSetupChangesBucket: "two_to_five", setupWindow: "complete", usableBaseline: "unavailable" };
const withdrawn: View = { ...data, status: "withdrawn", creationToVerificationBucket: null, recordedSetupChangesBucket: null, setupWindow: "not_applicable" };
let root: Root, container: HTMLDivElement, client: QueryClient;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  client?.clear(); container?.remove(); vi.restoreAllMocks(); await i18n.changeLanguage("en");
});
async function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["auth", "session"], v9SessionFixture("owner"));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><main>
    <ExperienceMeasures company="company" principal="owner" />
  </main></MemoryRouter></QueryClientProvider>));
}
it("separates observed onboarding time from unavailable TTFO and localizes without collecting another event", async () => {
  const get = vi.spyOn(experienceMeasuresApi, "get").mockResolvedValue(data);
  await mount(); await vi.waitFor(() => expect(container.textContent).toContain("One to under five minutes"));
  expect(container.textContent).toContain("usable-account start point has not been established");
  expect(container.textContent).toContain("Two to five recorded transitions");
  expect(container.textContent).toContain("do not establish usability targets");
  expect(document.activeElement).toBe(container.querySelector("h1"));
  expect(container.querySelectorAll("button")).toHaveLength(0);
  expect(container.querySelector("a")?.getAttribute("href")).toBe("/saas/activation");
  await act(async () => { await i18n.changeLanguage("da"); });
  expect(container.textContent).toContain("Aktiveringsmålinger");
  expect(container.textContent).toContain("To til fem registrerede overgange"); expect(get).toHaveBeenCalledTimes(1);
});
it("hides old measures during source refresh, suppresses withdrawn values and restores return-link focus", async () => {
  const get = vi.spyOn(experienceMeasuresApi, "get").mockResolvedValue(data);
  await mount(); await vi.waitFor(() => expect(container.querySelector("a")).not.toBeNull());
  container.querySelector<HTMLAnchorElement>("a")!.focus();
  let resolve!: (value: View) => void;
  get.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  await act(async () => live({ companyId: "company", type: "activity.logged", payload: {} }));
  expect(container.textContent).not.toContain("One to under five minutes");
  await act(async () => resolve(withdrawn));
  await vi.waitFor(() => expect(container.textContent).toContain("no longer currently verified"));
  expect(container.textContent).not.toContain("Two to five recorded transitions");
  expect(document.activeElement).toBe(container.querySelector("a"));
});
it("fences late private measurements across an original account-session change", async () => {
  let resolve!: (value: View) => void;
  const get = vi.spyOn(experienceMeasuresApi, "get").mockImplementationOnce(() => new Promise((done) => { resolve = done; })).mockResolvedValue(withdrawn);
  await mount(); await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1));
  await act(async () => client.setQueryData(["auth", "session"], { ...v9SessionFixture("owner"), session: { ...v9SessionFixture("owner").session, id: "new-native-session" } }));
  await act(async () => resolve(data));
  await vi.waitFor(() => expect(container.textContent).toContain("no longer currently verified"));
  expect(container.textContent).not.toContain("One to under five minutes"); expect(get).toHaveBeenCalledTimes(2);
});
it("blocks a same-turn read while the original account recheck is unresolved", async () => {
  const get = vi.spyOn(experienceMeasuresApi, "get").mockResolvedValue(data);
  await mount(); await vi.waitFor(() => expect(container.textContent).toContain("One to under five minutes"));
  let resolve!: (value: ReturnType<typeof v9SessionFixture>) => void;
  vi.spyOn(authApi, "getSession").mockImplementation(() => new Promise((done) => { resolve = done; }));
  let pending!: Promise<unknown>;
  await act(async () => {
    pending = client.fetchQuery({ queryKey: ["auth", "session"], queryFn: authApi.getSession, staleTime: 0 });
    live({ companyId: "company", type: "activity.logged", payload: {} });
  });
  expect(container.textContent).not.toContain("One to under five minutes"); expect(get).toHaveBeenCalledTimes(1);
  await act(async () => { resolve(v9SessionFixture("owner")); await pending; });
  await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
});
it("shows a bounded count as unavailable instead of zero and does not add a write action", async () => {
  vi.spyOn(experienceMeasuresApi, "get").mockResolvedValue({ ...data, setupWindow: "bounded", recordedSetupChangesBucket: null });
  await mount(); await vi.waitFor(() => expect(container.textContent).toContain("A complete count is unavailable"));
  expect(container.textContent).not.toContain("No recorded transitions"); expect(container.querySelectorAll("button")).toHaveLength(0);
});
it("focuses a safe error and retries only the private read", async () => {
  const get = vi.spyOn(experienceMeasuresApi, "get").mockRejectedValueOnce(new Error("PRIVATE provider secret")).mockResolvedValue(data);
  await mount(); await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
  expect(container.textContent).not.toContain("PRIVATE"); expect(document.activeElement).toBe(container.querySelector('[role="alert"]'));
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  await vi.waitFor(() => expect(container.textContent).toContain("One to under five minutes")); expect(get).toHaveBeenCalledTimes(2);
});
