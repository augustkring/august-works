// @vitest-environment jsdom
import { Activity, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { CustomerHelpCenter } from "./CustomerHelpCenter";
import { i18n } from "../i18n";

const state = vi.hoisted(() => ({
  companyId: "00000000-0000-4000-8000-000000000001",
  userId: "help-user-a",
  sessionId: "00000000-0000-4000-8000-000000000002",
  epoch: 0,
  authorityReady: true,
}));
const searchMock = vi.hoisted(() => vi.fn());
vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: state.companyId, selectedCompany: { issuePrefix: "PAP" } }),
}));
vi.mock("../api/search", () => ({ searchApi: { search: searchMock } }));
vi.mock("../hooks/useV9CurrentAccount", () => ({
  useV9CurrentAccount: () => ({ userId: state.userId, localImplicit: false, settled: true, failed: false,
    sessionId: state.sessionId, authorityEpoch: state.epoch }),
}));
vi.mock("../hooks/useV9PrivateReadAuthority", () => ({
  useV9PrivateReadAuthority: () => ({
    readReady: state.authorityReady,
    epoch: state.epoch,
    canRead: () => state.authorityReady,
    read: async (operation: () => Promise<unknown>) => {
      const epoch = state.epoch, principal = state.userId, sessionId = state.sessionId;
      if (!state.authorityReady) throw new Error("Current Help search access is unavailable");
      const value = await operation();
      if (!state.authorityReady || epoch !== state.epoch || principal !== state.userId || sessionId !== state.sessionId)
        throw new Error("Help search access changed during the request");
      return value;
    },
  }),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;
let lastPath = "";
let navigate!: ReturnType<typeof useNavigate>;
function ObserveLocation() {
  lastPath = useLocation().pathname;
  navigate = useNavigate();
  return null;
}

const articleResponse = {
  query: "imports", normalizedQuery: "imports", scope: "help", sort: "relevance", limit: 8, offset: 0,
  results: [{
    id: "help:company-import-export", type: "help", score: 2, title: "Importing and exporting companies",
    href: "https://docs.blentera.com/guides/board-operator/importing-and-exporting", matchedFields: ["title"],
    sourceLabel: "Help · Preview", snippet: "Preview and recover a company package.", snippets: [],
    helpArticle: { articleId: "company-import-export", audience: "company-administrators", maturity: "preview",
      applicableProductVersions: ["V10"], locale: "en", lastVerifiedAt: "2026-10-24", source: "mintlify" },
    updatedAt: null, previewImageUrl: null,
  }],
  countsByType: { issue: 0, artifact: 0, agent: 0, project: 0, help: 1, comment: 0, document: 0 },
  filterOptionCounts: { status: {}, priority: {}, assigneeAgentId: {}, assigneeUserId: {}, projectId: {}, labelId: {}, updatedWithin: {} },
  zeroResults: null, hasMore: false,
};
const emptyResponse = { ...articleResponse, results: [], countsByType: { ...articleResponse.countsByType, help: 0 } };

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  client?.clear();
  container?.remove(); container = null;
  searchMock.mockReset();
  state.companyId = "00000000-0000-4000-8000-000000000001";
  state.userId = "help-user-a";
  state.sessionId = "00000000-0000-4000-8000-000000000002";
  state.epoch = 0; state.authorityReady = true;
  await act(async () => { await i18n.changeLanguage("en"); });
});

async function flush() {
  await act(async () => { await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); });
}
async function render(path = "/PAP/company/help") {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}>
    <ObserveLocation /><Activity mode="visible"><CustomerHelpCenter /></Activity>
  </MemoryRouter></QueryClientProvider>));
  await flush();
}
function typeSearch(value: string) {
  const input = container!.querySelector<HTMLInputElement>("#customer-help-search")!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
async function submitSearch() {
  await act(async () => container!.querySelector("form[role=search]")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await flush();
}

it("searches only Help in the current company and shows the genuine article preview without leaving Help", async () => {
  searchMock.mockResolvedValue(articleResponse);
  await render();
  expect(container!.textContent).toContain("How can we help?");
  expect(container!.querySelector('a[href="https://docs.blentera.com"]')).not.toBeNull();
  typeSearch("  imports  "); await submitSearch();
  await vi.waitFor(() => expect(container!.textContent).toContain("Importing and exporting companies"));
  expect(searchMock).toHaveBeenCalledWith(state.companyId, { q: "imports", scope: "help", limit: 8 }, expect.any(AbortSignal));
  expect(container!.querySelector('a[href="https://docs.blentera.com/guides/board-operator/importing-and-exporting"]')?.getAttribute("target")).toBe("_blank");
  expect(container!.textContent).toContain("Preview · V10 · en · last verified 2026-10-24");
  expect(lastPath).toBe("/PAP/company/help");
  expect(window.location.search).toBe("");
  expect(container!.querySelector('a[href="/PAP/company/support"]')).not.toBeNull();
});

it("shows a clear empty result state", async () => {
  searchMock.mockResolvedValue(emptyResponse);
  await render(); typeSearch("nothing"); await submitSearch();
  await vi.waitFor(() => expect(container!.textContent).toContain("No matching Help articles were found"));
});

it("shows loading while a bounded Help search is pending", async () => {
  let release!: (value: unknown) => void;
  searchMock.mockReturnValue(new Promise(resolve => { release = resolve; }));
  await render(); typeSearch("imports"); await submitSearch();
  await vi.waitFor(() => expect(container!.querySelector('[role="status"]')?.textContent).toContain("Searching product guidance"));
  expect(container!.textContent).not.toContain("Importing and exporting companies");
  await act(async () => release(articleResponse)); await flush();
  await vi.waitFor(() => expect(container!.textContent).toContain("Importing and exporting companies"));
});

it("shows an error and lets the reader retry", async () => {
  searchMock.mockRejectedValueOnce(new Error("server detail is not shown")).mockResolvedValueOnce(articleResponse);
  await render(); typeSearch("imports"); await submitSearch();
  await vi.waitFor(() => expect(container!.querySelector('[role="alert"]')?.textContent).toContain("Help search could not be loaded"));
  expect(container!.textContent).not.toContain("server detail");
  const retry = [...container!.querySelectorAll("button")].find(button => button.textContent === "Try search again")!;
  await act(async () => retry.click());
  await vi.waitFor(() => expect(container!.textContent).toContain("Importing and exporting companies"));
  expect(searchMock).toHaveBeenCalledTimes(2);
});

it("does not fetch while the retained Help pane is inactive", async () => {
  await render("/PAP/company/support");
  typeSearch("imports"); await submitSearch();
  expect(searchMock).not.toHaveBeenCalled();
});

it("uses Danish Help search labels and empty state", async () => {
  searchMock.mockResolvedValue(emptyResponse);
  await act(async () => { await i18n.changeLanguage("da"); });
  await render();
  expect(container!.querySelector('form[aria-label="Søg i Hjælp"]')).not.toBeNull();
  typeSearch("ukendt"); await submitSearch();
  await vi.waitFor(() => expect(container!.textContent).toContain("Der blev ikke fundet nogen Hjælp-artikler"));
});

it("drops a late response when the signed-in account changes", async () => {
  let release!: (value: unknown) => void;
  searchMock.mockReturnValue(new Promise(resolve => { release = resolve; }));
  await render(); typeSearch("imports"); await submitSearch();
  await vi.waitFor(() => expect(searchMock).toHaveBeenCalledTimes(1));
  await act(async () => {
    state.userId = "help-user-b"; state.sessionId = "00000000-0000-4000-8000-000000000099"; state.epoch += 1;
    root!.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/PAP/company/help"]}>
      <ObserveLocation /><Activity mode="visible"><CustomerHelpCenter /></Activity>
    </MemoryRouter></QueryClientProvider>);
  });
  await act(async () => release(articleResponse)); await flush();
  expect(container!.textContent).not.toContain("Importing and exporting companies");
  expect(container!.textContent).toContain("Enter a word or phrase");
  expect(lastPath).toBe("/PAP/company/help");
});

it("keeps the hidden Help pane idle after moving to support cases", async () => {
  searchMock.mockResolvedValue(articleResponse);
  await render(); typeSearch("imports"); await submitSearch();
  await vi.waitFor(() => expect(searchMock).toHaveBeenCalledTimes(1));
  await act(async () => navigate("/PAP/company/support")); await flush();
  expect(lastPath).toBe("/PAP/company/support");
  expect(searchMock).toHaveBeenCalledTimes(1);
});
