// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { MaintenanceHistory as View } from "@paperclipai/shared";
import { maintenanceHistoryApi } from "../api/maintenance-history";
import { authApi } from "../api/auth";
import { MaintenanceHistory } from "./MaintenanceHistory";
import "../i18n";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
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
  client.setQueryData(["auth", "session"], v9SessionFixture(principal));
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
it("shows unconfirmed and closed native attempt records without granting retry or claiming activation", async () => {
  const get = vi.spyOn(maintenanceHistoryApi, "get").mockResolvedValue({
    ...data,
    attemptHistory: {
      observedAt: data.observedAt,
      hasMore: true,
      entries: [
        {
          attemptId: "unconfirmed",
          startedAt: "2026-10-09T23:59:00Z",
          leaseExpiresAt: "2026-10-09T23:59:05Z",
          finishedAt: null,
          outcome: "unconfirmed",
          sourceMatchesCurrent: true,
        },
        {
          attemptId: "no-effect",
          startedAt: "2026-10-09T23:58:00Z",
          leaseExpiresAt: "2026-10-09T23:58:05Z",
          finishedAt: "2026-10-09T23:58:02Z",
          outcome: "no_effect",
          sourceMatchesCurrent: false,
        },
        {
          attemptId: "configured",
          startedAt: "2026-10-09T23:57:00Z",
          leaseExpiresAt: "2026-10-09T23:57:05Z",
          finishedAt: "2026-10-09T23:57:02Z",
          outcome: "configuration_recorded",
          sourceMatchesCurrent: false,
        },
      ],
    },
  });
  await mount();
  await vi.waitFor(() =>
    expect(container.textContent).toContain("Outcome unconfirmed"),
  );
  expect(container.textContent).toContain(
    "did not apply a configuration change",
  );
  expect(container.textContent).toContain(
    "Activation and verification are separate",
  );
  expect(container.textContent).toContain("Matches the installation state");
  expect(container.textContent).toContain("different installation state");
  expect(container.textContent).toContain("ten newest attempts");
  expect(container.querySelectorAll("main")).toHaveLength(1);
  expect(
    Array.from(container.querySelectorAll("button")).some((button) =>
      /retry|run|approve|activate/i.test(button.textContent ?? ""),
    ),
  ).toBe(false);
  let resolve!: (value: View) => void;
  get.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await act(async () =>
    live({ companyId: "company", type: "activity.logged", payload: {} }),
  );
  expect(container.textContent).not.toContain("Outcome unconfirmed");
  await act(async () => resolve({ ...data, entries: [] }));
  await vi.waitFor(() =>
    expect(container.textContent).toContain("Attempt history is unavailable"),
  );
  expect(container.textContent).not.toContain(
    "No maintenance attempts are recorded",
  );
});
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

it("hides receipts on Native session invalidation without requesting private history", async () => {
  const get = vi.spyOn(maintenanceHistoryApi, "get").mockResolvedValue(data);
  await mount();
  await vi.waitFor(() => expect(container.querySelector("li")).not.toBeNull());
  await act(async () => { await client.invalidateQueries({ queryKey: ["auth", "session"], exact: true, refetchType: "none" }); });
  expect(client.getQueryState(["auth", "session"])?.fetchStatus).toBe("idle");
  expect(container.querySelector("li")).toBeNull();
  expect(get).toHaveBeenCalledTimes(1);
  await act(async () => { client.setQueryData(["auth", "session"], v9SessionFixture("owner")); });
  await vi.waitFor(() => expect(container.querySelector("li")).not.toBeNull());
  expect(get).toHaveBeenCalledTimes(2);
});

it("retries failed Native identity before reading private maintenance history again", async () => {
  const get = vi.spyOn(maintenanceHistoryApi, "get").mockResolvedValue(data);
  await mount();
  await vi.waitFor(() => expect(container.querySelector("li")).not.toBeNull());
  const session = vi.spyOn(authApi, "getSession").mockRejectedValueOnce(new Error("Private session transport failed"));
  await act(async () => { await client.refetchQueries({ queryKey: ["auth", "session"], exact: true }); });
  await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
  expect(container.querySelector("li")).toBeNull();
  expect(container.textContent).not.toContain("Private session transport failed");
  let restoreSession!: (value: ReturnType<typeof v9SessionFixture>) => void;
  let restoreHistory!: (value: View) => void;
  session.mockImplementation(() => new Promise(resolve => { restoreSession = resolve; }));
  get.mockImplementation(() => new Promise(resolve => { restoreHistory = resolve; }));
  const button = container.querySelector("button")!;
  await act(async () => { button.click(); button.click(); });
  expect(session).toHaveBeenCalledTimes(2);
  expect(get).toHaveBeenCalledTimes(1);
  expect(container.querySelector("li")).toBeNull();
  await act(async () => { restoreSession(v9SessionFixture("owner")); });
  await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  expect(container.querySelector("li")).toBeNull();
  await act(async () => { restoreHistory(data); });
  await vi.waitFor(() => expect(container.querySelector("li")).not.toBeNull());
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

it("preserves an existing native dialog at initial load without a later focus jump", async () => {
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  const button = document.createElement("button");
  dialog.append(button);
  document.body.append(dialog);
  button.focus();
  const get = vi.spyOn(maintenanceHistoryApi, "get").mockResolvedValue(data);
  try {
    await mount();
    await vi.waitFor(() =>
      expect(container.querySelector("h1")).not.toBeNull(),
    );
    expect(document.activeElement).toBe(button);
    dialog.remove();
    let resolve!: (view: View) => void;
    get.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await act(async () =>
      live({ companyId: "company", type: "activity.logged", payload: {} }),
    );
    await act(async () => resolve(data));
    await vi.waitFor(() =>
      expect(container.querySelector("h1")).not.toBeNull(),
    );
    expect(document.activeElement).toBe(document.body);
  } finally {
    dialog.remove();
  }
});

it("restores a previously focused own heading after foreground checking", async () => {
  const get = vi.spyOn(maintenanceHistoryApi, "get").mockResolvedValue(data);
  await mount();
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(container.querySelector("h1")),
  );
  let resolve!: (view: View) => void;
  get.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await act(async () =>
    live({ companyId: "company", type: "activity.logged", payload: {} }),
  );
  expect(container.querySelector("h1")).toBeNull();
  await act(async () => resolve(data));
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(container.querySelector("h1")),
  );
});

it("discards a stale focus target when a native dialog owns the completed recheck", async () => {
  const get = vi.spyOn(maintenanceHistoryApi, "get").mockResolvedValue(data);
  await mount();
  await vi.waitFor(() => expect(container.querySelector("a")).not.toBeNull());
  container.querySelector("a")!.focus();
  let resolve!: (view: View) => void;
  get.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await act(async () =>
    live({ companyId: "company", type: "activity.logged", payload: {} }),
  );
  const dialog = document.createElement("div"),
    button = document.createElement("button");
  dialog.setAttribute("role", "dialog");
  dialog.append(button);
  document.body.append(dialog);
  button.focus();
  try {
    await act(async () => resolve(data));
    await vi.waitFor(() => expect(container.querySelector("a")).not.toBeNull());
    expect(document.activeElement).toBe(button);
    dialog.remove();
    await act(async () =>
      live({ companyId: "company", type: "activity.logged", payload: {} }),
    );
    await vi.waitFor(() => expect(container.querySelector("a")).not.toBeNull());
    expect(document.activeElement).toBe(document.body);
  } finally {
    dialog.remove();
  }
});
