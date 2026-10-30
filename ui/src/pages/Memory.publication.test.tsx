// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { MemoryRecordDetail } from "@paperclipai/shared";
import { Memory } from "./Memory";
import { memoryApi } from "../api/memory";
import { i18n } from "../i18n";
import { v9SessionFixture } from "../hooks/v9-session.test-support";

const mocks = vi.hoisted(() => ({ toast: vi.fn(), breadcrumbs: vi.fn() }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company", selectedCompany: { name: "Review Company", issuePrefix: "MEM" } }) }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: mocks.breadcrumbs }) }));
vi.mock("../context/ToastContext", () => ({ useToastActions: () => ({ pushToast: mocks.toast }) }));
vi.mock("../components/MemoryPrivacyControls", () => ({ MemoryPrivacyControls: () => null }));
vi.mock("../components/MemoryMaintenanceControls", () => ({ MemoryMaintenanceControls: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const detail = {
  record: { id: "shared", companyId: "company", bindingId: "binding", memoryType: "lesson", title: "Reviewed lesson",
    content: "Exact private source copy for review", summary: null, scopeType: "company", scopeId: null,
    reviewState: "pending", verificationState: "unverified", sensitivityLabel: "internal", confidenceScore: 0.8,
    importance: 50, observedAt: new Date(), validFrom: null, validUntil: null, revokedAt: null,
    supersededByRecordId: null, retentionPolicy: "standard", metadata: {} },
  evidence: [],
  privateShareReview: { state: "pending", targetScopeType: "company", targetScopeId: null },
} as unknown as MemoryRecordDetail;
let root: Root | undefined, container: HTMLDivElement | undefined, client: QueryClient;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined; container?.remove(); client?.clear(); vi.restoreAllMocks(); mocks.toast.mockReset();
  await i18n.changeLanguage("en");
});
async function mount(language = "en") {
  await i18n.changeLanguage(language);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["auth", "session"], v9SessionFixture("owner"));
  vi.spyOn(memoryApi, "getRecord").mockResolvedValue(detail);
  vi.spyOn(memoryApi, "listBindings").mockResolvedValue([]);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/memory/shared"]}>
    <Routes><Route path="/memory/:recordId" element={<Memory />} /></Routes>
  </MemoryRouter></QueryClientProvider>));
  await vi.waitFor(() => expect(container!.textContent).toContain(detail.record.content));
}
it.each([
  ["en", "Review private Memory sharing", "Approve and share", "Memory shared"],
  ["da", "Gennemgå deling af privat Memory", "Godkend og del", "Memory er delt"],
])("makes private publication explicit in %s before the original accept call", async (language, title, action, success) => {
  const accept = vi.spyOn(memoryApi, "accept").mockResolvedValue({ ...detail,
    record: { ...detail.record, reviewState: "accepted" }, privateShareReview: { ...detail.privateShareReview!, state: "published" } });
  await mount(language);
  expect(container!.textContent).toContain(title);
  expect(container!.textContent).toContain("Review Company");
  expect(accept).not.toHaveBeenCalled();
  const button = [...container!.querySelectorAll("button")].find(item => item.textContent === action)!;
  expect(button).toBeDefined();
  await act(async () => button.click());
  await vi.waitFor(() => expect(accept).toHaveBeenCalledExactlyOnceWith("company", "shared", undefined, true));
  await vi.waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ title: success, tone: "success" }));
});
it("refuses the same-turn approval after the original account session changes", async () => {
  const accept = vi.spyOn(memoryApi, "accept");
  await mount();
  const button = [...container!.querySelectorAll("button")].find(item => item.textContent === "Approve and share")!;
  await act(async () => {
    client.setQueryData(["auth", "session"], v9SessionFixture("other-owner"));
    button.click();
  });
  expect(accept).not.toHaveBeenCalled();
  expect(mocks.toast).not.toHaveBeenCalled();
});
it("withholds an older publication acknowledgement after the original session changes", async () => {
  let acknowledge!: (value: MemoryRecordDetail) => void;
  const accept = vi.spyOn(memoryApi, "accept").mockImplementation(() => new Promise(resolve => { acknowledge = resolve; }));
  await mount();
  const button = [...container!.querySelectorAll("button")].find(item => item.textContent === "Approve and share")!;
  await act(async () => button.click());
  expect(accept).toHaveBeenCalledExactlyOnceWith("company", "shared", undefined, true);
  await act(async () => {
    client.setQueryData(["auth", "session"], v9SessionFixture("other-owner"));
    acknowledge({ ...detail, record: { ...detail.record, reviewState: "accepted" },
      privateShareReview: { ...detail.privateShareReview!, state: "published" } });
  });
  expect(mocks.toast).not.toHaveBeenCalled();
  expect(accept).toHaveBeenCalledTimes(1);
});
