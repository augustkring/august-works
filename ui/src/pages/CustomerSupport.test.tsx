// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { CustomerSupportHistory } from "./CustomerSupport";
import "../i18n";
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
  useCompany: () => ({ selectedCompany: { issuePrefix: "AW" } }),
}));
const company = "00000000-0000-4000-8000-000000000001",
  session = "00000000-0000-4000-8000-000000000002";
const data = {
  companyId: company,
  observedAt: "2026-10-10T04:00:00Z",
  hasMore: true,
  entries: [
    {
      sessionId: session,
      operatorReference: "private-operator-reference",
      approvedAt: "2026-10-10T03:50:00Z",
      expiresAt: "2026-10-10T04:20:00Z",
      revokedAt: null,
      state: "recorded",
      scopes: ["status:read", "backup:restore"],
      origin: "native_v6_approval",
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
async function render(principal = "owner", companyId = company) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <main>
            <CustomerSupportHistory
              key={`${companyId}:${principal}`}
              companyId={companyId}
              principal={principal}
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
it("shows native recorded limits and permissions separately from access admission or support success", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue(data),
    post = vi.spyOn(api, "post");
  await mount();
  await vi.waitFor(() =>
    expect(container.textContent).toContain("private-operator-reference"),
  );
  expect(container.querySelectorAll("main")).toHaveLength(1);
  expect(container.querySelector("h1")).toBe(document.activeElement);
  expect(container.textContent).toContain("does not prove");
  expect(container.textContent).toContain("ten most recent");
  expect(container.textContent).toContain("verified backup");
  expect(container.textContent).not.toContain("backup:restore");
  expect(
    container.querySelector('a[href="mailto:support@blentera.com"]'),
  ).not.toBeNull();
  expect(
    container.querySelector('a[href*="company/settings/support"]'),
  ).not.toBeNull();
  expect(post).not.toHaveBeenCalled();
  expect(get).toHaveBeenCalledWith(
    expect.stringContaining("expectedUserId=owner"),
    { signal: expect.any(AbortSignal), cache: "no-store" },
  );
});
it("erases private history while rechecking support changes and never echoes native errors", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue(data);
  await mount();
  await vi.waitFor(() => expect(container.querySelector("li")).not.toBeNull());
  let reject!: (error: Error) => void;
  get.mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  await act(async () =>
    live({
      companyId: company,
      type: "activity.logged",
      payload: { action: "support.access_revoked" },
    }),
  );
  expect(container.textContent).not.toContain("private-operator-reference");
  await act(async () => reject(new Error("private-support-native-error")));
  await vi.waitFor(() =>
    expect(container.querySelector('[role="alert"]')).not.toBeNull(),
  );
  expect(container.textContent).not.toContain("private-support-native-error");
  expect(document.activeElement).toBe(
    container.querySelector('[role="alert"]'),
  );
});
it("refuses a returned foreign company or raw native fields", async () => {
  vi.spyOn(api, "get").mockResolvedValue({
    ...data,
    companyId: "00000000-0000-4000-8000-000000000003",
    reason: "foreign-private-reason",
  });
  await mount();
  await vi.waitFor(() =>
    expect(container.querySelector('[role="alert"]')).not.toBeNull(),
  );
  expect(container.textContent).not.toContain("private-operator-reference");
  expect(container.textContent).not.toContain("foreign-private-reason");
});
it("refuses a late original account response after the private query owner changes", async () => {
  let resolve!: (value: unknown) => void;
  const get = vi.spyOn(api, "get").mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await mount();
  get.mockRejectedValue(new Error("new-owner-denied"));
  await render("other");
  await act(async () => resolve(data));
  await vi.waitFor(() =>
    expect(container.querySelector('[role="alert"]')).not.toBeNull(),
  );
  expect(container.textContent).not.toContain("private-operator-reference");
  expect(
    client
      .getQueryCache()
      .findAll({ queryKey: ["customer-support-history", company, "owner"] }),
  ).toHaveLength(0);
});
it("distinguishes an empty source from a failed private source and ignores another company's event", async () => {
  const get = vi
    .spyOn(api, "get")
    .mockResolvedValue({ ...data, entries: [], hasMore: false });
  await mount();
  await vi.waitFor(() =>
    expect(container.textContent).toContain("No support approvals"),
  );
  const count = get.mock.calls.length;
  await act(async () =>
    live({
      companyId: "another-company",
      type: "activity.logged",
      payload: { action: "support.access_revoked" },
    }),
  );
  expect(get.mock.calls.length).toBe(count);
});

it("restores the connected equivalent control after an actual private-source recheck", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue(data);
  await mount();
  await vi.waitFor(() =>
    expect(
      container.querySelector('[data-support-focus="native"]'),
    ).not.toBeNull(),
  );
  (
    container.querySelector('[data-support-focus="native"]') as HTMLElement
  ).focus();
  let resolve!: (value: unknown) => void;
  get.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await act(async () =>
    live({
      companyId: company,
      type: "activity.logged",
      payload: { action: "support.access_approved" },
    }),
  );
  expect(container.textContent).not.toContain("private-operator-reference");
  await act(async () => resolve(data));
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(
      container.querySelector('[data-support-focus="native"]'),
    ),
  );
});
it("never steals focus from an open native dialog when support admission fails", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue(data);
  await mount();
  await vi.waitFor(() => expect(container.querySelector("h1")).not.toBeNull());
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  const control = document.createElement("button");
  dialog.append(control);
  document.body.append(dialog);
  control.focus();
  get.mockRejectedValue(new Error("owner-admission-lost"));
  try {
    await act(async () =>
      live({
        companyId: company,
        type: "activity.logged",
        payload: { action: "company_membership.updated" },
      }),
    );
    await vi.waitFor(() =>
      expect(container.querySelector('[role="alert"]')).not.toBeNull(),
    );
    expect(document.activeElement).toBe(control);
    expect(container.textContent).not.toContain("private-operator-reference");
  } finally {
    dialog.remove();
  }
});

it("does not defer an initial focus steal until after a native dialog closes", async () => {
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  const modal = document.createElement("button");
  dialog.append(modal);
  document.body.append(dialog);
  modal.focus();
  const outside = document.createElement("button");
  document.body.append(outside);
  vi.spyOn(api, "get").mockResolvedValue(data);
  try {
    await mount();
    await vi.waitFor(() =>
      expect(container.querySelector("h1")).not.toBeNull(),
    );
    expect(document.activeElement).toBe(modal);
    dialog.remove();
    outside.focus();
    await act(async () =>
      live({
        companyId: company,
        type: "activity.logged",
        payload: { action: "support.access_approved" },
      }),
    );
    await vi.waitFor(() =>
      expect(container.querySelector("h1")).not.toBeNull(),
    );
    expect(document.activeElement).toBe(outside);
  } finally {
    dialog.remove();
    outside.remove();
  }
});
