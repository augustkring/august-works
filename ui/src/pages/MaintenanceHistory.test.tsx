// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { MaintenanceHistory as View } from "@paperclipai/shared";
import { maintenanceHistoryApi } from "../api/maintenance-history";
import { MaintenanceHistory } from "./MaintenanceHistory";
import "../i18n";
let live: (event: {
  companyId: string;
  type: string;
  payload: Record<string, unknown>;
}) => void;
vi.mock("../context/LiveUpdatesProvider", () => ({
  useCompanyLiveEvent: (listener: typeof live) => {
    live = listener;
  },
}));
vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "company",
    selectedCompany: { issuePrefix: "AW" },
  }),
}));
const data: View = {
  companyId: "company",
  installationId: "installation",
  agentId: "agent",
  installationVersion: 3,
  installationStatus: "active",
  observedAt: "2026-10-10T00:00:00Z",
  hasMore: true,
  entries: [
    {
      receiptId: "receipt-review",
      recordedAt: "2026-10-10T00:00:00Z",
      maintenanceClass: "M2",
      outcome: "human_review_required",
    },
    {
      receiptId: "receipt-configured",
      recordedAt: "2026-10-09T00:00:00Z",
      maintenanceClass: "M2",
      outcome: "configured_activation_required",
    },
  ],
};
let root: Root, container: HTMLDivElement, client: QueryClient;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  client?.clear();
  container?.remove();
  vi.restoreAllMocks();
});
async function render(principal = "owner") {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <main>
            <MaintenanceHistory
              key={principal}
              company="company"
              principal={principal}
              installationId="installation"
            />
          </main>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
}
async function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await render();
}
it("distinguishes historical configuration and exhausted limit receipts from the current active installation", async () => {
  vi.spyOn(maintenanceHistoryApi, "get").mockResolvedValue(data);
  await mount();
  await vi.waitFor(() =>
    expect(container.textContent).toContain("human review was required"),
  );
  expect(container.textContent).toContain("activation was required");
  expect(container.querySelectorAll("main")).toHaveLength(1);
  expect(container.textContent).toContain("do not confirm");
  expect(container.textContent).toContain("ten most recent");
  expect(container.querySelector("h1")).toBe(document.activeElement);
  expect(container.querySelector("a")?.getAttribute("href")).toContain(
    "/agents/packages",
  );
});
it("hides existing receipts while rechecking current private source and never echoes a raw error", async () => {
  const get = vi.spyOn(maintenanceHistoryApi, "get").mockResolvedValue(data);
  await mount();
  await vi.waitFor(() => expect(container.querySelector("li")).not.toBeNull());
  let reject!: (reason: Error) => void;
  get.mockImplementation(
    () =>
      new Promise((_resolve, rejecter) => {
        reject = rejecter;
      }),
  );
  await act(async () =>
    live({ companyId: "company", type: "activity.logged", payload: {} }),
  );
  expect(container.querySelector("li")).toBeNull();
  await act(async () => reject(new Error("private-provider-error")));
  await vi.waitFor(() =>
    expect(container.querySelector('[role="alert"]')).not.toBeNull(),
  );
  expect(container.textContent).not.toContain("private-provider-error");
  expect(document.activeElement).toBe(
    container.querySelector('[role="alert"]'),
  );
});
it("drops the previous principal's result while a new account read is pending", async () => {
  const get = vi.spyOn(maintenanceHistoryApi, "get").mockResolvedValue(data);
  await mount();
  await vi.waitFor(() => expect(container.querySelector("li")).not.toBeNull());
  get.mockImplementation(() => new Promise(() => {}));
  await render("changed-account");
  expect(container.querySelector("li")).toBeNull();
  expect(container.querySelector('[role="status"]')).not.toBeNull();
});

it("restores the equivalent navigation link after a private live recheck", async () => {
  const get = vi.spyOn(maintenanceHistoryApi, "get").mockResolvedValue(data);
  await mount();
  await vi.waitFor(() => expect(container.querySelector("a")).not.toBeNull());
  container.querySelector("a")!.focus();
  let resolve!: (view: View) => void;
  get.mockImplementation(
    () =>
      new Promise((resolver) => {
        resolve = resolver;
      }),
  );
  await act(async () =>
    live({ companyId: "company", type: "activity.logged", payload: {} }),
  );
  expect(container.querySelector("a")).toBeNull();
  await act(async () => resolve(data));
  await vi.waitFor(() =>
    expect(container.querySelector("a")).toBe(document.activeElement),
  );
});
