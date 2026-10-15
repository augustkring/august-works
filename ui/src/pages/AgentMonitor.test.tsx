// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentMonitor as View } from "@paperclipai/shared";
import { agentMonitorApi } from "../api/agent-monitor";
import { agentPauseApi } from "../api/agent-pause";
import { AgentMonitor } from "./AgentMonitor";
import "../i18n";
import { queryKeys } from "../lib/queryKeys";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
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
  sessionStorage.clear();
});
async function mount(principal = "owner") {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryDefaults(queryKeys.auth.session, { gcTime: Infinity });
  client.setQueryData(queryKeys.auth.session, v9SessionFixture(principal));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <main>
            <AgentMonitor
              key={principal}
              company="company"
              principal={principal}
              agentId="agent"
            />
          </main>
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
  expect(container.querySelectorAll("main")).toHaveLength(1);
  expect(container.textContent).toContain("does not confirm");
  expect(container.textContent).toContain("six most recent");
  expect(container.querySelector("h1")).toBe(document.activeElement);
  expect(container.querySelector("a")?.getAttribute("href")).toContain(
    "/agents/agent/runs/run",
  );
});
it("preserves the accepted pause receipt through a private monitor recheck", async () => {
  let release!: (view: View) => void;
  const current: View = { ...data, nativeStatus: "idle", lifecycle: "active", pauseReason: null };
  vi.spyOn(agentMonitorApi, "get").mockResolvedValueOnce(current).mockImplementationOnce(() => new Promise(done => { release = done; }));
  vi.spyOn(agentPauseApi, "review").mockResolvedValue({ companyId: "company", agentId: "agent", name: data.name, nativeStatus: "idle", sourceToken: "a".repeat(64), canPause: true });
  const pause = vi.spyOn(agentPauseApi, "pause").mockImplementation(async (_company, _principal, _agent, command) => ({
    companyId: "company", agentId: "agent", requestId: command.requestId, pendingWork: command.pendingWork, acceptedAt: "2026-10-12T00:00:00Z", admissionClosedAtAcceptance: true, workSettled: false }));
  await mount();
  const button = (scope: Element, label: string) => [...scope.querySelectorAll("button")].find(item => item.textContent === label)!;
  await vi.waitFor(() => expect(button(container, "Pause agent")).toBeTruthy()); await act(async () => button(container, "Pause agent").click());
  const dialog = document.querySelector('[role="alertdialog"]')!;
  await act(async () => dialog.querySelector<HTMLInputElement>('input[value="drain"]')!.click()); await act(async () => button(dialog, "Pause agent").click());
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  expect(container.textContent).not.toContain("Monitor Native agent"); expect(container.textContent).not.toContain("The pause is recorded");
  await act(async () => release({ ...data, pauseReason: "manual" }));
  await vi.waitFor(() => expect(container.textContent).toContain("The pause is recorded"));
  expect(container.textContent).toContain("Paused — new autonomous work is blocked"); expect(pause).toHaveBeenCalledTimes(1);
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

it("hides private agent metadata through a session recheck and waits for a fresh original owner read", async () => {
  const get = vi.spyOn(agentMonitorApi, "get").mockResolvedValue(data);
  await mount();
  await vi.waitFor(() => expect(container.textContent).toContain("Monitor Native agent"));
  let releaseOwner!: (view: View) => void;
  get.mockImplementation(() => new Promise((resolve) => { releaseOwner = resolve; }));
  let releaseSession!: () => void;
  await act(async () => { void client.fetchQuery({ queryKey: queryKeys.auth.session,
    queryFn: () => new Promise<ReturnType<typeof v9SessionFixture>>((resolve) => { releaseSession = () => resolve(v9SessionFixture("owner")); }) }).catch(() => {}); });
  expect(container.textContent).not.toContain("Native agent");
  expect(container.querySelector('a[href*="/runs/"]')).toBeNull();
  expect(get).toHaveBeenCalledOnce();
  await act(async () => releaseSession());
  await vi.waitFor(() => expect(releaseOwner).toBeDefined());
  expect(container.textContent).not.toContain("Native agent");
  await act(async () => releaseOwner({ ...data, name: "Fresh current agent" }));
  await vi.waitFor(() => expect(container.textContent).toContain("Monitor Fresh current agent"));
  expect(container.textContent).not.toContain("Monitor Native agent");
});

it("refuses a same-turn private transport and its late response after the original session starts fetching", async () => {
  const get = vi.spyOn(agentMonitorApi, "get").mockResolvedValue(data);
  await mount();
  await vi.waitFor(() => expect(container.textContent).toContain("Monitor Native agent"));
  let releaseSession!: () => void;
  await act(async () => {
    void client.fetchQuery({ queryKey: queryKeys.auth.session,
      queryFn: () => new Promise<ReturnType<typeof v9SessionFixture>>((resolve) => { releaseSession = () => resolve(v9SessionFixture("owner")); }) }).catch(() => {});
    void client.refetchQueries({ queryKey: ["agent-monitor"], type: "active" }).catch(() => {});
  });
  expect(get).toHaveBeenCalledOnce();
  expect(container.textContent).not.toContain("Native agent");
  await act(async () => releaseSession());
  await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(container.textContent).toContain("Monitor Native agent"));
});

it("never restores a late agent result for an older session with the same person", async () => {
  let releaseOld!: (view: View) => void, releaseCurrent!: (view: View) => void;
  const get = vi.spyOn(agentMonitorApi, "get").mockImplementationOnce(() => new Promise((resolve) => { releaseOld = resolve; }))
    .mockImplementationOnce(() => new Promise((resolve) => { releaseCurrent = resolve; }));
  await mount();
  await vi.waitFor(() => expect(releaseOld).toBeDefined());
  const next = v9SessionFixture("owner");next.session.id = "another-native-session-for-owner";
  await act(async () => client.setQueryData(queryKeys.auth.session, next));
  await vi.waitFor(() => expect(releaseCurrent).toBeDefined());
  await act(async () => releaseOld(data));
  expect(container.textContent).not.toContain("Native agent");
  await act(async () => releaseCurrent({ ...data, name: "Current session agent" }));
  await vi.waitFor(() => expect(container.textContent).toContain("Monitor Current session agent"));
  expect(get).toHaveBeenCalledTimes(2);
});

it.each([
  [{ status: "pending", pendingRuns: 1 }, "1 pending native run remains"],
  [{ status: "pending", pendingRuns: 2 }, "2 pending native runs remain"],
  [{ status: "none", pendingRuns: 0 }, "No pending native runs were recorded"],
  [undefined, "Pending work could not be fully checked"],
] as const)("keeps paused scheduling separate from current work observation %j", async (pausedWork, message) => {
  vi.spyOn(agentMonitorApi, "get").mockResolvedValue({ ...data, pausedWork });
  await mount();
  await vi.waitFor(() => expect(container.textContent).toContain(message));
  expect(container.textContent).toContain("Choose whether admitted work may finish or cancellation is requested.");
  expect(container.textContent).toContain("does not confirm that a remote process stopped");
});
