// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { MemoryMaintenanceHistory as View } from "@paperclipai/shared";
import { memoryMaintenanceHistoryApi } from "../api/memory-maintenance-history";
import { authApi } from "../api/auth";
import { MemoryMaintenanceHistory } from "./MemoryMaintenanceHistory";
import { i18n } from "../i18n";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let live: (event: { companyId: string; type: string; payload: Record<string, unknown> }) => void;
vi.mock("../context/LiveUpdatesProvider", () => ({ useCompanyLiveEvent: (listener: typeof live) => { live = listener; } }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company", selectedCompany: { issuePrefix: "AW" } }) }));
const data: View = { companyId: "company", observedAt: "2026-10-11T00:00:05Z", hasMore: true, entries: [
  { jobId: "history-job", maintenanceClass: "M1", attemptNumber: 1, submittedAt: "2026-10-11T00:00:00Z", startedAt: "2026-10-11T00:00:01Z", finishedAt: "2026-10-11T00:00:02Z", leaseExpiresAt: null, outcome: "verified_index_check", receiptId: "history-receipt", indexedRecordCount: 2 },
] };
let root: Root, container: HTMLDivElement, client: QueryClient;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  client?.clear(); container?.remove(); vi.restoreAllMocks();
  await i18n.changeLanguage("en");
});
async function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["auth", "session"], v9SessionFixture("owner"));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><main>
    <MemoryMaintenanceHistory company="company" principal="owner" />
  </main></MemoryRouter></QueryClientProvider>));
}
it("shows historical proof separately from current readiness and changes language without another read", async () => {
  const get = vi.spyOn(memoryMaintenanceHistoryApi, "get").mockResolvedValue(data);
  await mount();
  await vi.waitFor(() => expect(container.textContent).toContain("Index check recorded"));
  expect(container.textContent).toContain("do not establish current readiness");
  expect(container.textContent).toContain("2 shared records checked");
  expect(container.textContent).toContain("ten newest index-check attempts");
  expect(document.activeElement).toBe(container.querySelector("h1"));
  expect(container.querySelectorAll("main")).toHaveLength(1);
  expect(container.querySelectorAll("button")).toHaveLength(0);
  await act(async () => { await i18n.changeLanguage("da"); });
  expect(container.textContent).toContain("Indekskontrol registreret");
  expect(container.textContent).toContain("2 fælles poster kontrolleret");
  expect(get).toHaveBeenCalledTimes(1);
});
it("hides prior references during source refresh and preserves the customer's return-link focus", async () => {
  const get = vi.spyOn(memoryMaintenanceHistoryApi, "get").mockResolvedValue(data);
  await mount(); await vi.waitFor(() => expect(container.querySelector("h1")).not.toBeNull());
  container.querySelector<HTMLAnchorElement>("[data-memory-back]")!.focus();
  let resolve!: (value: View) => void;
  get.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  await act(async () => live({ companyId: "company", type: "activity.logged", payload: {} }));
  expect(container.textContent).not.toContain("history-receipt");
  expect(container.textContent).not.toContain("Index check recorded");
  await act(async () => resolve({ ...data, entries: [] }));
  await vi.waitFor(() => expect(container.textContent).toContain("No shared-memory index checks"));
  expect(document.activeElement).toBe(container.querySelector("[data-memory-back]"));
});
it("fences an older private response across a changed original account session", async () => {
  let resolve!: (value: View) => void;
  const get = vi.spyOn(memoryMaintenanceHistoryApi, "get").mockImplementationOnce(() => new Promise((done) => { resolve = done; })).mockResolvedValue({ ...data, entries: [] });
  await mount(); await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1));
  await act(async () => client.setQueryData(["auth", "session"], { ...v9SessionFixture("owner"), session: { ...v9SessionFixture("owner").session, id: "new-native-session" } }));
  await act(async () => resolve(data));
  await vi.waitFor(() => expect(container.textContent).toContain("No shared-memory index checks"));
  expect(container.textContent).not.toContain("history-receipt");
  expect(get).toHaveBeenCalledTimes(2);
});
it("blocks a same-turn read while the original account recheck remains unresolved", async () => {
  const get = vi.spyOn(memoryMaintenanceHistoryApi, "get").mockResolvedValue(data);
  await mount(); await vi.waitFor(() => expect(container.textContent).toContain("Index check recorded"));
  let resolve!: (value: ReturnType<typeof v9SessionFixture>) => void;
  const session = vi.spyOn(authApi, "getSession").mockImplementation(() => new Promise((done) => { resolve = done; }));
  let pending!: Promise<unknown>;
  await act(async () => {
    pending = client.fetchQuery({ queryKey: ["auth", "session"], queryFn: authApi.getSession, staleTime: 0 });
    live({ companyId: "company", type: "activity.logged", payload: {} });
  });
  expect(container.textContent).not.toContain("history-receipt");
  expect(get).toHaveBeenCalledTimes(1);
  expect(session).toHaveBeenCalledTimes(1);
  await act(async () => { resolve(v9SessionFixture("owner")); await pending; });
  await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
});
it("never turns an unconfirmed or erased source into a successful check or a retry action", async () => {
  vi.spyOn(memoryMaintenanceHistoryApi, "get").mockResolvedValue({ ...data, entries: [
    { ...data.entries[0]!, jobId: "unknown", outcome: "unconfirmed", finishedAt: null, leaseExpiresAt: "2026-10-11T00:00:03Z", receiptId: null, indexedRecordCount: null },
    { ...data.entries[0]!, jobId: "erased", outcome: "source_unavailable", receiptId: null, indexedRecordCount: null },
  ] });
  await mount(); await vi.waitFor(() => expect(container.textContent).toContain("Outcome unconfirmed"));
  expect(container.textContent).toContain("does not establish failure");
  expect(container.textContent).toContain("Source unavailable");
  expect(container.textContent).not.toContain("Index check recorded");
  expect(container.textContent).not.toContain("history-receipt");
  expect(container.querySelectorAll("button")).toHaveLength(0);
});
it("focuses a safe failure and retries only the current private read", async () => {
  const get = vi.spyOn(memoryMaintenanceHistoryApi, "get").mockRejectedValueOnce(new Error("private provider prose")).mockResolvedValue(data);
  await mount(); await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
  expect(container.textContent).not.toContain("private provider prose");
  expect(document.activeElement).toBe(container.querySelector('[role="alert"]'));
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  await vi.waitFor(() => expect(container.textContent).toContain("Index check recorded"));
  expect(get).toHaveBeenCalledTimes(2);
});
