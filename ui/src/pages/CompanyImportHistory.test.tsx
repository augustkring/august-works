// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CompanyImportHistory } from "./CompanyImportHistory";
import { queryKeys } from "../lib/queryKeys";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import { i18n } from "../i18n";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const state = vi.hoisted(() => ({ userId: "user-1", active: true, importHistory: vi.fn() }));
vi.mock("../api/companies", () => ({ companiesApi: { importHistory: (...args: unknown[]) => state.importHistory(...args) } }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company-1", selectedCompany: { issuePrefix: "PAP" } }) }));
vi.mock("../hooks/useV9CurrentAccount", async original => ({
  ...await original<typeof import("../hooks/useV9CurrentAccount")>(),
  useV9CurrentAccount: () => ({ userId: state.userId, sessionId: `session-${state.userId}`, settled: true,
    failed: false, localImplicit: false, authorityEpoch: 0 }),
}));
let root: Root | null = null, container: HTMLDivElement, client: QueryClient;
beforeEach(() => {
  state.userId = "user-1"; state.importHistory.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const session = v9SessionFixture("user-1");
  session.session.id = "session-user-1";
  client.setQueryData(queryKeys.auth.session, session);
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root?.unmount()); client.clear(); container.remove(); root = null;
  await act(async () => { await i18n.changeLanguage("en"); });
});
async function render(active = true) {
  await act(async () => root!.render(<QueryClientProvider client={client}><MemoryRouter><CompanyImportHistory active={active} /></MemoryRouter></QueryClientProvider>));
}
it("reads a saved unknown receipt without dispatch or retry and binds the current account", async () => {
  state.importHistory.mockResolvedValue({ jobs: [{ job: { id: "saved-import-1", status: "needs_reconciliation",
    createdAt: "2026-10-24T20:00:00.000Z", target: { mode: "new_company", result: "not_confirmed" } },
    operation: { unknownOutcome: true } }], nextCursor: null });
  await render();
  await vi.waitFor(() => expect(container.textContent).toContain("saved-import-1"));
  expect(container.textContent).toContain("Outcome not confirmed");
  expect(container.textContent).toContain("New company, result not yet confirmed");
  expect(container.textContent).toContain("contact support before importing again");
  expect(state.importHistory).toHaveBeenCalledWith("company-1", "user-1", undefined, expect.any(AbortSignal));
  expect(Array.from(container.querySelectorAll("button")).map(button => button.textContent)).toEqual(["Refresh status"]);
});
it("does not infer an unconfirmed new-company target from a terminal or result-bearing DTO", async () => {
  state.importHistory.mockResolvedValue({ jobs: [{ job: { id: "misleading-import", status: "succeeded",
    target: { mode: "new_company", result: "not_confirmed" },
    result: { companyId: "foreign-company", agentCount: 0, warningCount: 0 } }, operation: {} }], nextCursor: null });
  await render();
  await vi.waitFor(() => expect(container.textContent).toContain("Import complete"));
  expect(container.textContent).not.toContain("New company, result not yet confirmed");
  expect(container.textContent).not.toContain("foreign-company");
});
it("labels an unconfirmed new-company receipt in Danish", async () => {
  state.importHistory.mockResolvedValue({ jobs: [{ job: { id: "dansk-import", status: "running",
    target: { mode: "new_company", result: "not_confirmed" } }, operation: {} }], nextCursor: null });
  await act(async () => { await i18n.changeLanguage("da"); });
  await render();
  await vi.waitFor(() => expect(container.textContent).toContain("Ny virksomhed, resultatet er endnu ikke bekræftet"));
});
it("does not read private receipts while hidden inside Help", async () => {
  await render(false);
  expect(state.importHistory).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("saved-import-1");
});
it("discards a late response after the original session changes", async () => {
  let resolve!: (value: unknown) => void;
  state.importHistory.mockImplementation(() => new Promise(done => { resolve = done; }));
  await render();
  await vi.waitFor(() => expect(state.importHistory).toHaveBeenCalledTimes(1));
  client.setQueryData(queryKeys.auth.session, v9SessionFixture("other-user"));
  await act(async () => { resolve({ jobs: [{ job: { id: "LATE-PRIVATE-RECEIPT", status: "needs_reconciliation",
    target: { mode: "new_company", result: "not_confirmed" } } }], nextCursor: null }); });
  await vi.waitFor(() => expect(container.textContent).toContain("could not be loaded"));
  expect(container.textContent).not.toContain("LATE-PRIVATE-RECEIPT");
  expect(container.textContent).not.toContain("New company, result not yet confirmed");
});
