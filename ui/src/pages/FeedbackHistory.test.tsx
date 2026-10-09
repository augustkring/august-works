// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { CustomerFeedback } from "@paperclipai/shared";
import { i18n } from "../i18n";
import { api } from "../api/client";
import { customerFeedbackApi } from "../api/customer-feedback";
import { FeedbackTriage } from "./FeedbackTriage";
import { MyFeedback } from "./MyFeedback";
const context = vi.hoisted(() => ({
  company: "10000000-0000-4000-8000-000000000001",
  principal: "current-member",
  settled: true,
}));
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
vi.mock("../hooks/useV9FeatureEnabled", () => ({
  useV9FeatureEnabled: () => ({ enabled: true }),
}));
vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: context.company,
    selectedCompany: { issuePrefix: "AW" },
  }),
}));
vi.mock("../api/companies-query", () => ({
  useAccountIdentity: () => ({
    userId: context.principal,
    localImplicit: false,
    settled: context.settled,
    failed: false,
  }),
}));
const companyId = "10000000-0000-4000-8000-000000000001",
  id = "10000000-0000-4000-8000-000000000002";
const item: CustomerFeedback = {
  id,
  feedbackId: "AWF-10000000000040008000000000000002",
  companyId,
  category: "BUG" as const,
  body: "Original report",
  goal: "",
  blocksWork: false,
  omitName: true,
  status: "NEEDS_INFO" as const,
  version: 1,
  createdAt: "2026-10-09T00:00:00.000Z",
  messages: [],
};
const summary = {
  id,
  feedbackId: item.feedbackId,
  category: item.category,
  body: item.body,
  goal: item.goal,
  version: item.version,
  createdAt: item.createdAt,
  internalState: "NEEDS_INFO",
};
const detail = {
  ...item,
  internalState: "NEEDS_INFO",
  context: {
    surfaceKey: "home",
    routeTemplate: "/dashboard",
    releaseBuildId: "unverified:dom-fixture",
    locale: "en",
    timezone: "UTC",
    viewportClass: "wide",
  },
  diagnostics: null,
  nextEventCursor: null,
  events: [
    {
      id: "10000000-0000-4000-8000-000000000003",
      kind: "product_message",
      body: "Which browser?",
      internalNote: "Confidential operator note",
      linkType: null,
      linkId: null,
      createdAt: item.createdAt,
    },
  ],
};
let root: Root, container: HTMLDivElement, client: QueryClient;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  client?.clear();
  vi.restoreAllMocks();
  context.company = companyId;
  context.principal = "current-member";
  context.settled = true;
});
async function mount(page: "customer" | "operator") {
  await i18n.changeLanguage("en");
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/AW/my-feedback?feedbackId=${id}`]}>
          {page === "customer" ? <MyFeedback /> : <FeedbackTriage />}
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
}
async function enter(
  element: HTMLInputElement | HTMLTextAreaElement,
  text: string,
) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      "value",
    )!.set!.call(element, text);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(label: string) {
  const element = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === label,
  );
  expect(element).toBeTruthy();
  await act(async () => element!.click());
}
it("replays the frozen customer reply after a lost acknowledgement despite a refreshed version", async () => {
  vi.spyOn(customerFeedbackApi, "list").mockResolvedValue([item]);
  const get = vi.spyOn(customerFeedbackApi, "get").mockResolvedValue(item);
  const send = vi
    .spyOn(customerFeedbackApi, "followUp")
    .mockRejectedValueOnce(new Error("Lost acknowledgement"))
    .mockResolvedValueOnce({ ...item, version: 2 });
  await mount("customer");
  await vi.waitFor(() =>
    expect(document.querySelector("textarea")).toBeTruthy(),
  );
  await enter(document.querySelector("textarea")!, "Firefox 140");
  await click("Send feedback");
  await vi.waitFor(() =>
    expect(document.querySelector('[role="alert"]')).toBeTruthy(),
  );
  const first = send.mock.calls[0]![3];
  let complete!: (value: typeof item) => void;
  get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  await act(async () => {
    void client.refetchQueries({
      queryKey: ["customer-feedback", companyId, "current-member", "detail"],
    });
  });
  await vi.waitFor(() => expect(document.querySelector("textarea")).toBeNull());
  expect(container.textContent).not.toContain(item.body);
  await act(async () => complete({ ...item, version: 2, status: "REVIEWING" }));
  await vi.waitFor(() =>
    expect(document.querySelector("textarea")).not.toBeNull(),
  );
  expect(document.querySelector("textarea")!.disabled).toBe(true);
  await enter(document.querySelector("textarea")!, "Replacement reply");
  expect(document.querySelector("textarea")!.value).toBe("Firefox 140");
  await click("Send feedback");
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(send.mock.calls[1]![3]).toEqual(first);
  expect(first.expectedVersion).toBe(1);
});
it("rejects late private history after a native access-loss event", async () => {
  vi.spyOn(customerFeedbackApi, "list").mockResolvedValue([item]);
  const get = vi.spyOn(customerFeedbackApi, "get").mockResolvedValue(item);
  await mount("customer");
  await vi.waitFor(() => expect(container.textContent).toContain(item.body));
  let complete!: (value: typeof item) => void;
  get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  await act(async () => {
    void client.refetchQueries({
      queryKey: ["customer-feedback", companyId, "current-member", "detail"],
    });
  });
  await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  get.mockRejectedValue(new Error("revoked"));
  await act(async () =>
    live({ companyId, type: "analytical.context.access_lost", payload: {} }),
  );
  await vi.waitFor(() =>
    expect(container.querySelector('[role="alert"]')).not.toBeNull(),
  );
  await act(async () => complete({ ...item, body: "PRIVATE-LATE-RECEIPT" }));
  expect(container.textContent).not.toContain(item.body);
  expect(container.textContent).not.toContain("PRIVATE-LATE-RECEIPT");
  expect(container.querySelector("textarea")).toBeNull();
});
it.each(["company", "account", "identity"])(
  "hides private customer history when %s changes",
  async (kind) => {
    const list = vi
      .spyOn(customerFeedbackApi, "list")
      .mockResolvedValue([item]);
    const get = vi.spyOn(customerFeedbackApi, "get").mockResolvedValue(item);
    await mount("customer");
    await vi.waitFor(() => expect(container.textContent).toContain(item.body));
    list.mockImplementation(() => new Promise(() => {}));
    get.mockImplementation(() => new Promise(() => {}));
    if (kind === "company")
      context.company = "10000000-0000-4000-8000-000000000004";
    else if (kind === "account") context.principal = "other-member";
    else context.settled = false;
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[`/AW/my-feedback?feedbackId=${id}`]}>
            <MyFeedback />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    );
    expect(container.textContent).not.toContain(item.body);
    expect(container.textContent).not.toContain(item.feedbackId);
    expect(container.querySelector("textarea")).toBeNull();
  },
);
it("loads operator-only history and freezes the complete triage request across an unknown acknowledgement", async () => {
  const get = vi
    .spyOn(api, "get")
    .mockImplementation(async (path) =>
      path.includes(`/${id}?`) ? detail : [summary],
    );
  const send = vi
    .spyOn(api, "post")
    .mockRejectedValueOnce(new Error("Lost acknowledgement"))
    .mockResolvedValueOnce(item);
  await mount("operator");
  await enter(document.querySelector("input")!, companyId);
  await click("Open queue");
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain(item.feedbackId),
  );
  await click(item.feedbackId + " · NEEDS_INFO");
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("Confidential operator note"),
  );
  expect(document.body.textContent).toContain("Which browser?");
  await enter(document.querySelectorAll("textarea")[0]!, "Which version?");
  await enter(
    document.querySelectorAll("textarea")[1]!,
    "Private follow-up note",
  );
  await click("Apply triage");
  await vi.waitFor(() =>
    expect(document.querySelector('[role="alert"]')).toBeTruthy(),
  );
  const first = send.mock.calls[0]![1];
  expect(
    [...container.querySelectorAll<HTMLTextAreaElement>("textarea")].every(
      (input) => input.disabled,
    ),
  ).toBe(true);
  await enter(
    container.querySelectorAll("textarea")[0]!,
    "An edit must not replace uncertain triage",
  );
  expect(container.querySelectorAll("textarea")[0]!.value).toBe(
    "Which version?",
  );
  get.mockImplementation(async (path) =>
    path.includes(`/${id}?`)
      ? { ...detail, version: 2 }
      : [{ ...summary, version: 2 }],
  );
  await act(async () => {
    await client.refetchQueries({
      queryKey: ["feedback-triage", "current-member", companyId],
    });
  });
  await click("Apply triage");
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(send.mock.calls[1]![1]).toEqual(first);
  expect(first).toMatchObject({
    expectedVersion: 1,
    customerMessage: "Which version?",
    internalNote: "Private follow-up note",
  });
});
it("removes operator history and mutation controls when current access revalidation fails", async () => {
  const get = vi
    .spyOn(api, "get")
    .mockImplementation(async (path) =>
      path.includes(`/${id}?`) ? detail : [summary],
    );
  await mount("operator");
  await enter(document.querySelector("input")!, companyId);
  await click("Open queue");
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain(item.feedbackId),
  );
  await click(item.feedbackId + " · NEEDS_INFO");
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("Confidential operator note"),
  );
  get.mockRejectedValue(new Error("Access revoked"));
  await act(async () => {
    await client.refetchQueries({
      queryKey: ["feedback-triage", "current-member", companyId],
    });
  });
  await vi.waitFor(() => {
    expect(document.body.textContent).not.toContain(
      "Confidential operator note",
    );
    expect(document.body.textContent).not.toContain("Apply triage");
    expect(document.querySelector('[role="alert"]')).toBeTruthy();
  });
});
