// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentMonitor as View } from "@paperclipai/shared";
import { agentMonitorApi } from "../api/agent-monitor";
import { AgentMonitor } from "./AgentMonitor";
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
  agentId: "agent",
  name: "Native agent",
  nativeStatus: "paused",
  lifecycle: "paused",
  pauseReason: "budget",
  updatedAt: "2026-10-10T00:00:00Z",
  observedAt: "2026-10-10T00:00:00Z",
  lastHeartbeatAt: null,
  recent: {
    runs: [
      {
        id: "run",
        status: "succeeded",
        createdAt: "2026-10-10T00:00:00Z",
        startedAt: null,
        finishedAt: null,
      },
    ],
    hasMore: true,
  },
};
let root: Root, container: HTMLDivElement, client: QueryClient;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  client?.clear();
  container?.remove();
  vi.restoreAllMocks();
});
async function mount(principal = "owner") {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AgentMonitor
            key={principal}
            company="company"
            principal={principal}
            agentId="agent"
          />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
}
it("shows native status and bounded history without treating success as business verification", async () => {
  vi.spyOn(agentMonitorApi, "get").mockResolvedValue(data);
  await mount();
  await vi.waitFor(() =>
    expect(container.textContent).toContain("Monitor Native agent"),
  );
  expect(container.textContent).toContain("budget limit");
  expect(container.textContent).toContain("does not confirm");
  expect(container.textContent).toContain("six most recent");
  expect(container.querySelector("h1")).toBe(document.activeElement);
  expect(container.querySelector("a")?.getAttribute("href")).toContain(
    "/agents/agent/runs/run",
  );
});
it("hides prior private metadata during source-loss rechecking and rejects late old responses", async () => {
  let release!: (data: View) => void;
  vi.spyOn(agentMonitorApi, "get")
    .mockResolvedValueOnce(data)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    )
    .mockRejectedValueOnce(new Error("private-grant-loss"));
  await mount();
  await vi.waitFor(() =>
    expect(container.textContent).toContain("Monitor Native agent"),
  );
  await act(async () =>
    live({
      companyId: "company",
      type: "activity.logged",
      payload: { action: "permission.revoked" },
    }),
  );
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  expect(container.textContent).not.toContain("Native agent");
  await act(async () =>
    live({
      companyId: "company",
      type: "activity.logged",
      payload: { action: "membership.revoked" },
    }),
  );
  await vi.waitFor(() =>
    expect(
      container.getAttribute("role") ??
        container.querySelector('[role="alert"]'),
    ).toBeTruthy(),
  );
  await act(async () => release(data));
  expect(container.textContent).not.toContain("Native agent");
  expect(container.textContent).not.toContain("private-grant-loss");
});
it("preserves customer focus on successful background refresh", async () => {
  vi.spyOn(agentMonitorApi, "get").mockResolvedValue(data);
  await mount();
  await vi.waitFor(() => expect(container.querySelector("a")).not.toBeNull());
  const link = container.querySelector("a")!;
  link.focus();
  await act(async () => {
    await client.refetchQueries({ queryKey: ["agent-monitor"] });
  });
  expect(document.activeElement?.getAttribute("href")).toBe(
    link.getAttribute("href"),
  );
});
