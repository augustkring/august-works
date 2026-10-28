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
const trustMock = vi.hoisted(() => ({ list: vi.fn(), content: vi.fn(), grant: vi.fn(), revoke: vi.fn(), granted: false }));
vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: state.companyId, selectedCompany: { issuePrefix: "PAP" } }),
}));
vi.mock("../api/search", async importOriginal => ({
  ...await importOriginal<typeof import("../api/search")>(), searchApi: { search: searchMock },
}));
vi.mock("../api/trust-gated-documents", () => ({ trustGatedDocumentsApi: {
  list: (...args: unknown[]) => trustMock.list(...args),
  content: (...args: unknown[]) => trustMock.content(...args),
  grant: (...args: unknown[]) => trustMock.grant(...args),
  revoke: (...args: unknown[]) => trustMock.revoke(...args),
} }));
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
    write: async (operation: () => Promise<object>) => {
      const epoch = state.epoch, principal = state.userId, sessionId = state.sessionId;
      if (!state.authorityReady) throw new Error("Current Help access is unavailable");
      const value = await operation();
      if (!state.authorityReady || epoch !== state.epoch || principal !== state.userId || sessionId !== state.sessionId)
        throw new Error("Help access changed during the request");
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
    id: "company-import-export", type: "help", score: 2, title: "Importing and exporting companies",
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
const gatedGrantId = "00000000-0000-4000-8000-000000000006";
const gatedDocument = {
  id: "00000000-0000-4000-8000-000000000007",
  documentId: "00000000-0000-4000-8000-000000000008",
  documentRevisionId: "00000000-0000-4000-8000-000000000009",
  title: "Penetration test summary", version: "4", owner: "trust-owner",
  effectiveAt: "2026-10-01T00:00:00.000Z", evidenceRefs: ["assurance-record"],
  customerVisibility: "gated" as const, ndaRequired: false, lastReviewedAt: "2026-10-01T00:00:00.000Z",
  nextReviewOrTrigger: "annual review", expiresAt: "2027-10-01T00:00:00.000Z", supersededBy: null,
  materialChangeAction: "no_action" as const, acceptanceRequired: false,
};
function configureTrustMocks() {
  trustMock.granted = false;
  trustMock.list.mockImplementation(async () => ({ configured: trustMock.granted, canGrant: true,
    documents: trustMock.granted ? [{ document: gatedDocument, access: { state: "granted",
      grantReceiptId: gatedGrantId, expiresAt: "2030-01-01T00:00:00.000Z" } }] : [] }));
  trustMock.content.mockResolvedValue({ document: gatedDocument, grantReceiptId: gatedGrantId,
    format: "markdown", body: "Restricted report body." });
  trustMock.grant.mockImplementation(async (_companyId: string, input: { expiresAt: string; requestId: string }) => {
    trustMock.granted = true;
    return { id: gatedGrantId, companyId: state.companyId, registryEntryId: gatedDocument.id,
      documentRevisionId: gatedDocument.documentRevisionId, documentVersion: gatedDocument.version,
      granteeUserId: state.userId, grantedByUserId: state.userId, grantedAt: "2026-10-28T00:00:00.000Z",
      expiresAt: input.expiresAt, requestId: input.requestId, surface: "trust_center_gated_evidence" };
  });
  trustMock.revoke.mockImplementation(async (_companyId: string, grantReceiptId: string, input: { requestId: string }) => {
    trustMock.granted = false;
    return { id: "00000000-0000-4000-8000-000000000004", companyId: state.companyId,
      grantReceiptId, revokedByUserId: state.userId, revokedAt: "2026-10-28T00:00:00.000Z",
      requestId: input.requestId, surface: "trust_center_gated_evidence" };
  });
}
configureTrustMocks();

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  client?.clear();
  container?.remove(); container = null;
  searchMock.mockReset();
  trustMock.list.mockReset(); trustMock.content.mockReset(); trustMock.grant.mockReset(); trustMock.revoke.mockReset();
  state.companyId = "00000000-0000-4000-8000-000000000001";
  state.userId = "help-user-a";
  state.sessionId = "00000000-0000-4000-8000-000000000002";
  state.epoch = 0; state.authorityReady = true;
  configureTrustMocks();
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
  expect(searchMock).toHaveBeenCalledWith(state.companyId, { q: "imports", scope: "help", limit: 8, locale: "en" }, expect.any(AbortSignal));
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

it("requires an expiring admin grant before showing or downloading gated evidence", async () => {
  trustMock.granted = false;
  trustMock.list.mockImplementation(async () => ({ configured: true, canGrant: true,
    documents: trustMock.granted ? [{ document: gatedDocument, access: { state: "granted",
      grantReceiptId: gatedGrantId, expiresAt: "2030-01-01T00:00:00.000Z" } }]
      : [{ document: gatedDocument, access: { state: "grant_required" } }] }));
  await render();
  await vi.waitFor(() => expect(container!.textContent).toContain("Penetration test summary"));
  expect(container!.textContent).not.toContain("Restricted report body.");
  expect(trustMock.content).not.toHaveBeenCalled();
  const expiry = container!.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(expiry, "2026-10-29T12:00");
    expiry.dispatchEvent(new Event("input", { bubbles: true }));
    expiry.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const grantButton = [...container!.querySelectorAll("button")].find(button => button.textContent === "Grant me access")!;
  await act(async () => grantButton.click());
  await vi.waitFor(() => expect(trustMock.grant).toHaveBeenCalledWith(state.companyId, expect.objectContaining({
    expectedUserId: state.userId, registryEntryId: gatedDocument.id, version: gatedDocument.version,
    granteeUserId: state.userId, expiresAt: new Date("2026-10-29T12:00").toISOString(), surface: "trust_center_gated_evidence",
  })));
  await vi.waitFor(() => expect([...container!.querySelectorAll("button")]
    .some(button => button.textContent === "Review current document")).toBe(true));
  const reviewButton = [...container!.querySelectorAll("button")]
    .find(button => button.textContent === "Review current document")!;
  await act(async () => reviewButton.click());
  await vi.waitFor(() => expect(container!.textContent).toContain("Restricted report body."));
  expect(trustMock.content).toHaveBeenCalledWith(state.companyId, gatedDocument.id, state.userId, gatedGrantId, expect.any(AbortSignal));
  expect([...container!.querySelectorAll("button")].some(button => button.textContent === "Download current document")).toBe(true);
  const revokeButton = [...container!.querySelectorAll("button")].find(button => button.textContent === "Revoke grant")!;
  await act(async () => revokeButton.click());
  await vi.waitFor(() => expect(container!.textContent).not.toContain("Restricted report body."));
  expect(trustMock.revoke).toHaveBeenCalledWith(state.companyId, gatedGrantId,
    expect.objectContaining({ expectedUserId: state.userId, surface: "trust_center_gated_evidence" }));
});

it("shows NDA-required metadata as unconfigured without offering a checkbox or body access", async () => {
  trustMock.list.mockResolvedValue({ configured: true, canGrant: true, documents: [{
    document: { ...gatedDocument, ndaRequired: true },
    access: { state: "nda_binding_unconfigured", registryEntryId: gatedDocument.id,
      documentRevisionId: gatedDocument.documentRevisionId, version: gatedDocument.version,
      requiredBindingOwner: "canonical_nda_agreement", receiptReference: null },
  }] });
  await render();
  await vi.waitFor(() => expect(container!.textContent).toContain("canonical NDA agreement"));
  expect(container!.querySelector('input[type="checkbox"]')).toBeNull();
  expect(container!.textContent).not.toContain("Restricted report body.");
  expect(trustMock.content).not.toHaveBeenCalled();
  expect(trustMock.grant).not.toHaveBeenCalled();
});


it("uses the selected Help locale and withholds a late response from the previous language", async () => {
  let finishEnglish!: (value: unknown) => void;
  const danish = { ...articleResponse, results: [{ ...articleResponse.results[0],
    id: "company-import-export-da", title: "Import og eksport af virksomheder",
    href: "https://docs.blentera.com/da/guides/board-operator/importing-and-exporting",
    helpArticle: { ...articleResponse.results[0].helpArticle, articleId: "company-import-export-da", locale: "da" },
  }] };
  searchMock.mockImplementation((_company, params) => params.locale === "da"
    ? Promise.resolve(danish) : new Promise(resolve => { finishEnglish = resolve; }));
  await render(); typeSearch("imports"); await submitSearch();
  await vi.waitFor(() => expect(finishEnglish).toBeTypeOf("function"));
  await act(async () => { await i18n.changeLanguage("da"); });
  await vi.waitFor(() => expect(container!.textContent).toContain("Import og eksport af virksomheder"));
  expect(searchMock).toHaveBeenLastCalledWith(state.companyId,
    { q: "imports", scope: "help", limit: 8, locale: "da" }, expect.any(AbortSignal));
  await act(async () => finishEnglish(articleResponse)); await flush();
  expect(container!.textContent).not.toContain("Importing and exporting companies");
  expect(container!.textContent).toContain("Import og eksport af virksomheder");
});
