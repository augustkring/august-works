// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { CustomerFeedback } from "@paperclipai/shared";
import { i18n } from "../i18n";
import { api, ApiError } from "../api/client";
import { authApi } from "../api/auth";
import { customerFeedbackApi } from "../api/customer-feedback";
import { FeedbackTriage } from "./FeedbackTriage";
import { MyFeedback } from "./MyFeedback";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
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
  // Keep the full original session response alive through mounting; the real
  // identity observer owns subsequent cache changes and revalidation.
  client.setQueryDefaults(["auth", "session"], { gcTime: Infinity });
  client.setQueryData(["auth", "session"], v9SessionFixture(context.principal));
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
it("shows the submitter's consented ratings in their detail and reflects withdrawal without values", async () => {
  const rated: CustomerFeedback = { ...item, status: "RECEIVED", version: 0, experienceMeasureStatus: "granted",
    experienceMeasure: { satisfaction: "satisfied", effort: "difficult" } };
  const withdrawn: CustomerFeedback = { ...rated, experienceMeasureStatus: "withdrawn", experienceMeasure: undefined };
  vi.spyOn(customerFeedbackApi, "list").mockResolvedValue([rated]);
  vi.spyOn(customerFeedbackApi, "get").mockResolvedValueOnce(rated).mockResolvedValue(withdrawn);
  const withdraw = vi.spyOn(customerFeedbackApi, "withdrawExperienceMeasure").mockResolvedValue(withdrawn);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await mount("customer");
  await vi.waitFor(() => expect(container.textContent).toContain("Satisfied"));
  expect(container.textContent).toContain("Difficult");
  await click("Withdraw optional ratings");
  await vi.waitFor(() => expect(withdraw).toHaveBeenCalledWith(companyId, context.principal, id, expect.any(String)));
  await vi.waitFor(() => expect(container.textContent).toContain("Your optional ratings were withdrawn and removed."));
  expect(container.textContent).not.toContain("Satisfied");
  expect(container.textContent).not.toContain("Difficult");
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
    let pendingIdentity: Promise<unknown> | undefined, resolveIdentity!: (value: object) => void;
    await act(async () => {
      if (kind === "account")
        client.setQueryData(["auth", "session"], v9SessionFixture(context.principal));
      else if (kind === "identity")
        pendingIdentity = client.fetchQuery({ queryKey: ["auth", "session"], queryFn: () => new Promise<object>(resolve => { resolveIdentity = resolve; }) });
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[`/AW/my-feedback?feedbackId=${id}`]}>
            <MyFeedback />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    expect(container.textContent).not.toContain(item.body);
    expect(container.textContent).not.toContain(item.feedbackId);
    expect(container.querySelector("textarea")).toBeNull();
    if (pendingIdentity) await act(async () => { resolveIdentity(v9SessionFixture(context.principal)); await pendingIdentity; });
  },
);
it("recovers a failed Native session from operator entry without reading a queue or replaying a write", async () => {
  const get = vi.spyOn(api, "get");
  const send = vi.spyOn(api, "post");
  await mount("operator");
  await vi.waitFor(() => expect(container.querySelector("input")).not.toBeNull());
  const session = vi.spyOn(authApi, "getSession").mockRejectedValueOnce(new Error("Private session transport failed"));
  await act(async () => { await client.refetchQueries({ queryKey: ["auth", "session"], exact: true }); });
  await vi.waitFor(() => expect(container.querySelector("input")).toBeNull());
  expect(container.textContent).not.toContain("Private session transport failed");
  let restore!: (value: ReturnType<typeof v9SessionFixture>) => void;
  session.mockImplementation(() => new Promise(resolve => { restore = resolve; }));
  await click("Try again");
  expect(get).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
  expect(container.querySelector("input")).toBeNull();
  await act(async () => { restore(v9SessionFixture(context.principal)); });
  await vi.waitFor(() => expect(container.querySelector("input")).not.toBeNull());
  expect(get).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

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
    expect(document.body.textContent).toContain("Triage has not been confirmed. Inputs are locked; retry sends the original update."),
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

it("hides private feedback and an unsaved reply during session revalidation, preserving the reply only after fresh Native reads", async () => {
  const list = vi.spyOn(customerFeedbackApi, "list").mockResolvedValue([item]);
  const get = vi.spyOn(customerFeedbackApi, "get").mockResolvedValue(item);
  const send = vi.spyOn(customerFeedbackApi, "followUp");
  await mount("customer");
  await vi.waitFor(() =>
    expect(document.querySelector("textarea")).toBeTruthy(),
  );
  await enter(document.querySelector("textarea")!, "PRIVATE-UNSAVED-REPLY");
  const priorList = list.mock.calls.length,
    priorDetail = get.mock.calls.length;
  let resolveSession!: (value: object) => void;
  let pendingSession!: Promise<unknown>;
  await act(async () => {
    pendingSession = client.fetchQuery({
      queryKey: ["auth", "session"],
      queryFn: () =>
        new Promise<object>((resolve) => {
          resolveSession = resolve;
        }),
    });
  });
  await vi.waitFor(() => expect(document.querySelector("textarea")).toBeNull());
  expect(container.textContent).not.toContain(item.body);
  expect(container.textContent).not.toContain("PRIVATE-UNSAVED-REPLY");
  expect(list).toHaveBeenCalledTimes(priorList);
  expect(get).toHaveBeenCalledTimes(priorDetail);
  let resolveRead!: (value: CustomerFeedback) => void;
  get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
  );
  await act(async () => {
    resolveSession(v9SessionFixture(context.principal));
    await pendingSession;
  });
  await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(priorDetail + 1));
  expect(list).toHaveBeenCalledTimes(priorList + 1);
  expect(document.querySelector("textarea")).toBeNull();
  expect(container.textContent).not.toContain(item.body);
  await act(async () => resolveRead(item));
  await vi.waitFor(() =>
    expect(document.querySelector("textarea")?.value).toBe(
      "PRIVATE-UNSAVED-REPLY",
    ),
  );
  expect(container.textContent).toContain(item.body);
  expect(send).not.toHaveBeenCalled();
});

it("blocks a reply after the original session cache changes in the same turn", async () => {
  const list = vi.spyOn(customerFeedbackApi, "list").mockResolvedValue([item]);
  const get = vi.spyOn(customerFeedbackApi, "get").mockResolvedValue(item);
  const send = vi.spyOn(customerFeedbackApi, "followUp");
  await mount("customer");
  await vi.waitFor(() => expect(document.querySelector("textarea")).toBeTruthy());
  await enter(document.querySelector("textarea")!, "PRIVATE-REPLY");
  // A different principal needs an independent Native owner read. Do not give
  // that new principal the first person's owned receipt in the IO fixture.
  list.mockImplementation(() => new Promise(() => {}));
  get.mockImplementation(() => new Promise(() => {}));
  const form = document.querySelector("form")!;
  await act(async () => {
    client.setQueryData(["auth", "session"], v9SessionFixture("different-member"));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(send).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(container.textContent).not.toContain(item.body));
  expect(document.querySelector("textarea")).toBeNull();
});

it("keeps the exact unknown reply after a late acknowledgement crosses current-session revalidation", async () => {
  vi.spyOn(customerFeedbackApi, "list").mockResolvedValue([item]);
  vi.spyOn(customerFeedbackApi, "get").mockResolvedValue(item);
  let resolveReply!: (value: CustomerFeedback) => void;
  const send = vi.spyOn(customerFeedbackApi, "followUp")
    .mockImplementationOnce(() => new Promise(resolve => { resolveReply = resolve; }))
    .mockResolvedValueOnce({ ...item, version: 2 });
  await mount("customer");
  await vi.waitFor(() => expect(document.querySelector("textarea")).toBeTruthy());
  await enter(document.querySelector("textarea")!, "PRIVATE-FROZEN-REPLY");
  await click("Send feedback");
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  const original = send.mock.calls[0]![3];
  let resolveSession!: (value: object) => void, session!: Promise<unknown>;
  await act(async () => {
    session = client.fetchQuery({ queryKey: ["auth", "session"], queryFn: () => new Promise<object>(resolve => { resolveSession = resolve; }) });
  });
  await vi.waitFor(() => expect(document.querySelector("textarea")).toBeNull());
  await act(async () => resolveReply({ ...item, version: 2 }));
  expect(container.textContent).not.toContain("PRIVATE-FROZEN-REPLY");
  await act(async () => { resolveSession(v9SessionFixture(context.principal)); await session; });
  await vi.waitFor(() => expect(document.querySelector("textarea")?.value).toBe("PRIVATE-FROZEN-REPLY"));
  expect(document.querySelector("textarea")!.disabled).toBe(true);
  expect(container.querySelector('[role="alert"]')).toBeTruthy();
  expect(send).toHaveBeenCalledTimes(1);
  await click("Send feedback");
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(send.mock.calls[1]![3]).toEqual(original);
});

it("blocks operator triage after the original session changes before React renders it", async () => {
  vi.spyOn(api, "get").mockImplementation(async path => path.includes(`/${id}?`) ? detail : [summary]);
  const send = vi.spyOn(api, "post");
  await mount("operator");
  await enter(document.querySelector("input")!, companyId);
  await click("Open queue");
  await vi.waitFor(() => expect(container.textContent).toContain(item.feedbackId));
  await click(item.feedbackId + " · NEEDS_INFO");
  await vi.waitFor(() => expect(container.querySelector("textarea")).toBeTruthy());
  await enter(container.querySelector("textarea")!, "PRIVATE-OPERATOR-QUESTION");
  const form = container.querySelectorAll("form")[1]!;
  await act(async () => {
    client.setQueryData(["auth", "session"], v9SessionFixture("different-operator"));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(send).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("Confidential operator note");
  expect(container.querySelector("textarea")).toBeNull();
  expect(container.querySelector("input")?.value).toBe("");
});

it("hides private history when the original session is invalidated without starting a request", async () => {
  const list = vi.spyOn(customerFeedbackApi, "list").mockResolvedValue([item]);
  const get = vi.spyOn(customerFeedbackApi, "get").mockResolvedValue(item);
  const send = vi.spyOn(customerFeedbackApi, "followUp");
  await mount("customer");
  await vi.waitFor(() => expect(container.textContent).toContain(item.body));
  const previousList = list.mock.calls.length, previousDetail = get.mock.calls.length;
  await enter(document.querySelector("textarea")!, "PRIVATE-UNSAVED-REPLY");
  await act(async () => { await client.invalidateQueries({ queryKey: ["auth", "session"], exact: true, refetchType: "none" }); });
  expect(client.getQueryState(["auth", "session"])?.fetchStatus).toBe("idle");
  expect(container.textContent).not.toContain(item.body);
  expect(document.querySelector("textarea")).toBeNull();
  expect(list).toHaveBeenCalledTimes(previousList);
  expect(get).toHaveBeenCalledTimes(previousDetail);
  await act(async () => { client.setQueryData(["auth", "session"], v9SessionFixture(context.principal)); });
  await vi.waitFor(() => expect(document.querySelector("textarea")?.value).toBe("PRIVATE-UNSAVED-REPLY"));
  expect(list).toHaveBeenCalledTimes(previousList + 1);
  expect(get).toHaveBeenCalledTimes(previousDetail + 1);
  expect(send).not.toHaveBeenCalled();
});

it("retains an unknown reply's body and UUID when a later retry receives a validation refusal", async () => {
  vi.spyOn(customerFeedbackApi, "list").mockResolvedValue([item]);
  vi.spyOn(customerFeedbackApi, "get").mockResolvedValue(item);
  const send = vi.spyOn(customerFeedbackApi, "followUp")
    .mockRejectedValueOnce(new Error("Lost acknowledgement"))
    .mockRejectedValueOnce(new ApiError("Validation refused", 422, {}))
    .mockResolvedValueOnce({ ...item, version: 2 });
  await mount("customer");
  await vi.waitFor(() => expect(document.querySelector("textarea")).toBeTruthy());
  await enter(document.querySelector("textarea")!, "ORIGINAL-UNKNOWN-REPLY");
  await click("Send feedback");
  await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
  const original = send.mock.calls[0]![3];
  await click("Send feedback");
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false));
  expect(document.querySelector("textarea")!.disabled).toBe(true);
  expect(document.querySelector("textarea")!.value).toBe("ORIGINAL-UNKNOWN-REPLY");
  expect(send.mock.calls[1]![3]).toEqual(original);
  await click("Send feedback");
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(3));
  expect(send.mock.calls[2]![3]).toEqual(original);
});

it("retains unknown operator triage through a later validation refusal", async () => {
  vi.spyOn(api, "get").mockImplementation(async path => path.includes(`/${id}?`) ? detail : [summary]);
  const send = vi.spyOn(api, "post")
    .mockRejectedValueOnce(new Error("Lost acknowledgement"))
    .mockRejectedValueOnce(new ApiError("Validation refused", 422, {}))
    .mockResolvedValueOnce(item);
  await mount("operator");
  await enter(document.querySelector("input")!, companyId);
  await click("Open queue");
  await vi.waitFor(() => expect(container.textContent).toContain(item.feedbackId));
  await click(item.feedbackId + " · NEEDS_INFO");
  await vi.waitFor(() => expect(container.querySelector("textarea")).toBeTruthy());
  await enter(container.querySelector("textarea")!, "ORIGINAL-UNKNOWN-TRIAGE");
  await click("Apply triage");
  await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
  const original = send.mock.calls[0]![1];
  await click("Apply triage");
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect([...container.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "Apply triage")?.disabled).toBe(false));
  expect(container.querySelector("textarea")!.disabled).toBe(true);
  expect(container.querySelector("textarea")!.value).toBe("ORIGINAL-UNKNOWN-TRIAGE");
  expect(send.mock.calls[1]![1]).toEqual(original);
  await click("Apply triage");
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(3));
  expect(send.mock.calls[2]![1]).toEqual(original);
});
