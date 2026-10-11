// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
} from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authApi } from "../api/auth";
import { activationApi } from "../api/activation";
import { i18n } from "../i18n";
import { queryKeys } from "../lib/queryKeys";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import {
  initialActivationState,
  type ActivationView,
} from "@paperclipai/shared";
import { ActivationPage } from "./Activation";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let capabilitiesFetching = false;
const companyId = "10000000-0000-4000-8000-000000000001";
vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: companyId,
    reloadCompanies: vi.fn(),
    setSelectedCompanyId: vi.fn(),
  }),
}));
vi.mock("../hooks/useSaasCapabilities", () => ({
  useSaasCapabilities: () => ({
    data: { activationV9: true },
    isFetching: capabilitiesFetching,
    isPending: false,
    isError: false,
  }),
}));
vi.mock("../components/CustomerFeedbackDialog", () => ({
  CustomerFeedbackDialog: () => null,
}));
let root: Root, container: HTMLDivElement, client: QueryClient;
beforeEach(() => {
  capabilitiesFetching = false;
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  client?.clear();
  focusManager.setFocused(undefined);
  vi.restoreAllMocks();
  await i18n.changeLanguage("en");
});
function view(
  step: ActivationView["state"]["step"] = "intent",
): ActivationView {
  const { receipts: _, ...state } = initialActivationState();
  return {
    runId: "10000000-0000-4000-8000-000000000002",
    companyId,
    companyName: "Customer company",
    version: 1,
    status: "in_progress",
    state: { ...state, step },
    sources: [
      { id: "customer_context", status: "available" },
      { id: "website", status: "not_requested" },
      { id: "connections", status: "not_connected" },
    ],
    capabilities: [],
    blockers: ["no_qualified_capability"],
  };
}
async function mount(data: ActivationView, route = "/saas/activation/3") {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  // The capability observer is mocked; seed its original cache owner as well
  // so transport/acknowledgement checks see the same successful Native read.
  client.setQueryDefaults(["saas-capabilities"], { gcTime: Infinity });
  client.setQueryData(["saas-capabilities"], { activationV9: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.spyOn(authApi, "getSession").mockResolvedValue({
    user: {
      id: "activation-owner",
      email: "owner@example.test",
      name: "Owner",
      image: null,
    },
    session: { id: "session", userId: "activation-owner" },
    sentryDsn: null,
  });
  vi.spyOn(activationApi, "get").mockResolvedValue(data);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route
              path="/saas/activation/:screen?"
              element={<ActivationPage />}
            />
            <Route path="/" element={<p>Saved exit destination</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  await vi.waitFor(() => expect(document.querySelector("h1")).toBeTruthy());
}
async function render(route = "/saas/activation/3") {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route
              path="/saas/activation/:screen?"
              element={<ActivationPage />}
            />
            <Route path="/" element={<p>Saved exit destination</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
}
async function click(text: string) {
  const button = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === text,
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
async function enter(text: string) {
  await act(async () => {
    const input = document.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
describe("Native V9 onboarding UI", () => {
  it("allows current capability choice after the previous publication became unavailable without claiming connections are unnecessary", async () => {
    const data = view("access"); data.state.packageVersionId = "10000000-0000-4000-8000-000000000003";
    data.requiredAccess = [];
    const mutate = vi.spyOn(activationApi, "command").mockResolvedValue({ ...data, version: 2, state: { ...data.state, step: "capability", packageVersionId: null } });
    await mount(data, "/saas/activation/8");
    await vi.waitFor(() => expect(container.textContent).toContain("The selected capability is no longer available"));
    expect(container.textContent).not.toContain("No additional connections requested");
    expect([...container.querySelectorAll("button")].find(button => button.textContent === "Continue")?.disabled).toBe(true);
    await click("Not now — choose another agent");
    expect(mutate).toHaveBeenCalledExactlyOnceWith(companyId, "activation-owner", { operation: "reselect_capability", expectedVersion: 1, requestId: expect.any(String) });
  });
  it("returns from Not now to current capability choice while preserving the saved outcome and granting no access", async () => {
    const data = view("access"), versionId = "10000000-0000-4000-8000-000000000003";
    data.state.intent = "My saved outcome"; data.state.packageVersionId = versionId;
    data.capabilities = [{ versionId, name: "Draft agent", purpose: "Draft a proposal", requiredConnections: ["linear"], knownLimitations: [] }];
    data.requiredAccess = [{ key: "linear", status: "not_connected", checkedAt: null }];
    const alternative = { ...data, version: 2, state: { ...data.state, step: "capability" as const, packageVersionId: null } };
    const mutate = vi.spyOn(activationApi, "command").mockResolvedValue(alternative);
    await mount(data, "/saas/activation/8");
    await vi.waitFor(() => expect(container.textContent).toContain("Draft a proposal. Without them"));
    await click("Not now — choose another agent");
    await vi.waitFor(() => expect(container.textContent).toContain("Use this agent"));
    expect(mutate).toHaveBeenCalledExactlyOnceWith(companyId, "activation-owner", {
      operation: "reselect_capability", expectedVersion: 1, requestId: expect.any(String),
    });
    expect(client.getQueriesData<ActivationView>({ queryKey: ["activation", companyId, "activation-owner"] })
      .some(([, result]) => result?.version === 2 && result.state.intent === "My saved outcome")).toBe(true);
    expect(container.textContent).not.toContain("Run first task");
  });
  it("continues to review from recorded connection setup without claiming agent access or starting work", async () => {
    const data = view("access"), versionId = "10000000-0000-4000-8000-000000000003";
    data.state.packageVersionId = versionId;
    data.capabilities = [{ versionId, name: "Draft agent", purpose: "Prepare an internal draft", requiredConnections: ["linear"], knownLimitations: [] }];
    data.requiredAccess = [{ key: "linear", status: "recorded", checkedAt: new Date().toISOString() }];
    data.blockers = [];
    const reviewed = { ...data, version: 2, state: { ...data.state, step: "review" as const } };
    const mutate = vi.spyOn(activationApi, "command").mockResolvedValue(reviewed);
    await mount(data, "/saas/activation/8");
    await vi.waitFor(() => expect(container.textContent).toContain("Connection setup recorded"));
    expect(container.textContent).toContain("Review the agent's access and safe test");
    expect(container.querySelector('a[href$="/apps"]')).toBeTruthy();
    await click("Continue");
    await vi.waitFor(() => expect(container.textContent).toContain("Review before your first run"));
    expect(mutate).toHaveBeenCalledExactlyOnceWith(companyId, "activation-owner", {
      operation: "continue_access", expectedVersion: 1, requestId: expect.any(String),
    });
    expect(container.textContent).not.toContain("Your agent is ready");
  });
  it.each(["not_connected", "needs_review", "unavailable", "missing"] as const)("keeps %s connection setup blocked even when other requested connections are recorded", async status => {
    const data = view("access"), versionId = "10000000-0000-4000-8000-000000000003";
    data.state.packageVersionId = versionId;
    data.capabilities = [{ versionId, name: "Draft agent", purpose: "Draft", requiredConnections: ["linear", "notion"], knownLimitations: [] }];
    data.requiredAccess = [{ key: "linear", status: "recorded", checkedAt: new Date().toISOString() },
      ...(status === "missing" ? [] : [{ key: "notion", status, checkedAt: null }])];
    const mutate = vi.spyOn(activationApi, "command");
    await mount(data, "/saas/activation/8");
    await vi.waitFor(() => expect(container.textContent).toContain("Required access is not ready"));
    const button = [...container.querySelectorAll("button")].find(item => item.textContent === "Continue")!;
    expect(button.disabled).toBe(true);
    await act(async () => button.click());
    expect(mutate).not.toHaveBeenCalled();
    expect(container.querySelector('a[href$="/apps"]')).toBeTruthy();
  });
  it("does not submit retained onboarding fields after the original session cache changes account", async () => {
    const mutate = vi.spyOn(activationApi, "command");
    await mount(view());
    await vi.waitFor(() => expect(container.querySelector("textarea")).toBeTruthy());
    await enter("Private retained intent");
    const button = [...container.querySelectorAll("button")].find(item => item.textContent === "Save & exit")!;
    await act(async () => {
      client.setQueryData(queryKeys.auth.session, v9SessionFixture("other-current-owner"));
      button.click();
    });
    expect(mutate).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Saved exit destination");
  });
  it("does not submit retained onboarding fields after rollout was withdrawn in the original cache", async () => {
    const mutate = vi.spyOn(activationApi, "command");
    await mount(view());
    await vi.waitFor(() => expect(container.querySelector("textarea")).toBeTruthy());
    await enter("Private retained intent");
    const button = [...container.querySelectorAll("button")].find(item => item.textContent === "Save & exit")!;
    await act(async () => {
      client.setQueryData(["saas-capabilities"], { activationV9: false });
      button.click();
    });
    expect(mutate).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Saved exit destination");
  });
  it("returns to editable preserved answers only after the original setup-correction receipt", async () => {
    const ready = view("review");
    ready.state.intent = "Private first goal";ready.state.companyPurpose = "Private company answers";
    ready.state.packageVersionId = "10000000-0000-4000-8000-000000000003";
    const changed = { ...ready, version: 2, state: { ...ready.state, step: "intent" as const, packageVersionId: null } };
    let acknowledge!: (value: ActivationView) => void;
    const mutate = vi.spyOn(activationApi, "command").mockImplementation(() => new Promise(resolve => { acknowledge = resolve; }));
    await mount(ready, "/saas/activation/9");
    await vi.waitFor(() => expect(container.textContent).toContain("Change setup"));
    await click("Change setup");
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]).toEqual([companyId, "activation-owner", { operation: "change_setup", expectedVersion: 1, requestId: expect.any(String) }]);
    expect([...container.querySelectorAll("button")].find(button => button.textContent === "Change setup")!.disabled).toBe(true);
    expect(container.querySelector("textarea")).toBeNull();
    await act(async () => acknowledge(changed));
    await vi.waitFor(() => expect(container.querySelector("textarea")?.value).toBe("Private first goal"));
    expect(container.querySelector("textarea")?.disabled).toBe(false);
    expect(container.textContent).not.toContain("Run first task");
    expect(mutate).toHaveBeenCalledTimes(1);
  });
  it("resolves a stale step, preserves intent through Back, and does not expose an early plan purchase", async () => {
    await mount(view(), "/saas/activation/9");
    await vi.waitFor(() =>
      expect(document.querySelector("textarea")).toBeTruthy(),
    );
    await enter("Prepare a private sales proposal");
    await click("Back");
    await click("Resume current step");
    expect(document.querySelector("textarea")!.value).toBe(
      "Prepare a private sales proposal",
    );
    expect(document.body.textContent).not.toMatch(
      /choose a plan|model provider|role pack|runtime/i,
    );
  });
  it("saves an entered draft on the native owner before exit and retains the same request through an unknown acknowledgement", async () => {
    const saved = {
      ...view(),
      version: 2,
      state: { ...view().state, intent: "Private unfinished goal" },
    };
    const save = vi
      .spyOn(activationApi, "command")
      .mockRejectedValueOnce(new Error("Lost acknowledgement"))
      .mockResolvedValueOnce(saved);
    await mount(view());
    await vi.waitFor(() =>
      expect(document.querySelector("textarea")).toBeTruthy(),
    );
    await enter(saved.state.intent);
    await click("Save & exit");
    await vi.waitFor(() =>
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        "not confirmed",
      ),
    );
    expect(document.body.textContent).not.toContain("Saved exit destination");
    const first = save.mock.calls[0]![2];
    expect(first.operation).toBe("save_draft");
    expect(first).toMatchObject({
      intent: saved.state.intent,
      expectedVersion: 1,
    });
    await click("Try again");
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]![2]).toEqual(first);
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("Saved exit destination"),
    );
    expect(document.body.textContent).not.toMatch(
      /You're ready|Your first result is ready/,
    );
  });
  it("keeps unavailable capability qualification separate from a successful first result", async () => {
    await mount(view("capability"), "/saas/activation/7");
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(
        "No qualified first capability is available yet",
      ),
    );
    expect(document.body.textContent).not.toContain("Use this agent");
    expect(document.body.textContent).not.toContain("Run first task");
  });
});

describe("Activation current account authority", () => {
  it("withdraws private fields during an account recheck, then requires a fresh read while preserving a same-account unsaved draft", async () => {
    await mount({
      ...view(),
      state: { ...view().state, intent: "PRIVATE-SAVED-INTENT" },
    });
    await vi.waitFor(() =>
      expect(container.querySelector("textarea")?.value).toBe(
        "PRIVATE-SAVED-INTENT",
      ),
    );
    await enter("PRIVATE-UNSAVED-INTENT");
    const priorReads = vi.mocked(activationApi.get).mock.calls.length;
    let resolveSession!: (
      value: Awaited<ReturnType<typeof authApi.getSession>>,
    ) => void;
    const session = client.getQueryData(queryKeys.auth.session) as Awaited<
      ReturnType<typeof authApi.getSession>
    >;
    vi.mocked(authApi.getSession).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSession = resolve;
        }),
    );
    await act(async () => {
      void client.invalidateQueries({ queryKey: queryKeys.auth.session });
    });
    await vi.waitFor(() =>
      expect(container.querySelector("textarea")).toBeNull(),
    );
    expect(container.textContent).not.toMatch(/PRIVATE-|Customer company/);
    expect(container.querySelector("form,button")).toBeNull();
    expect(activationApi.get).toHaveBeenCalledTimes(priorReads);
    let resolveRead!: (value: ActivationView) => void;
    vi.mocked(activationApi.get).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
    );
    await act(async () => resolveSession(session));
    await vi.waitFor(() =>
      expect(activationApi.get).toHaveBeenCalledTimes(priorReads + 1),
    );
    expect(container.querySelector("textarea")).toBeNull();
    await act(async () => resolveRead(view()));
    await vi.waitFor(() =>
      expect(container.querySelector("textarea")?.value).toBe(
        "PRIVATE-UNSAVED-INTENT",
      ),
    );
  });

  it("withdraws private fields while capabilities are rechecked and cannot reuse the prior read", async () => {
    await mount({
      ...view(),
      state: { ...view().state, intent: "PRIVATE-CAPABILITY-INTENT" },
    });
    await vi.waitFor(() =>
      expect(container.querySelector("textarea")?.value).toBe(
        "PRIVATE-CAPABILITY-INTENT",
      ),
    );
    const priorReads = vi.mocked(activationApi.get).mock.calls.length;
    capabilitiesFetching = true;
    await render();
    expect(container.querySelector("textarea,form,button")).toBeNull();
    expect(container.textContent).not.toContain("PRIVATE-CAPABILITY-INTENT");
    let resolveRead!: (value: ActivationView) => void;
    vi.mocked(activationApi.get).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
    );
    capabilitiesFetching = false;
    await render();
    await vi.waitFor(() =>
      expect(activationApi.get).toHaveBeenCalledTimes(priorReads + 1),
    );
    expect(container.querySelector("textarea")).toBeNull();
    await act(async () => resolveRead(view()));
    await vi.waitFor(() =>
      expect(container.querySelector("textarea")).not.toBeNull(),
    );
  });

  it("fences a late save acknowledgement across an account recheck and retries only the original request after fresh authority", async () => {
    let resolveSave!: (value: ActivationView) => void;
    const saved = {
      ...view(),
      version: 2,
      state: { ...view().state, intent: "PRIVATE-UNCONFIRMED-DRAFT" },
    };
    const save = vi
      .spyOn(activationApi, "command")
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSave = resolve;
          }),
      )
      .mockResolvedValueOnce(saved);
    await mount(view());
    await vi.waitFor(() =>
      expect(container.querySelector("textarea")).not.toBeNull(),
    );
    await enter(saved.state.intent);
    await click("Save & exit");
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const original = save.mock.calls[0]![2];
    let resolveSession!: (
      value: Awaited<ReturnType<typeof authApi.getSession>>,
    ) => void;
    const session = client.getQueryData(queryKeys.auth.session) as Awaited<
      ReturnType<typeof authApi.getSession>
    >;
    vi.mocked(authApi.getSession).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSession = resolve;
        }),
    );
    await act(async () => {
      void client.invalidateQueries({ queryKey: queryKeys.auth.session });
    });
    await vi.waitFor(() =>
      expect(container.querySelector("textarea")).toBeNull(),
    );
    await act(async () => resolveSave(saved));
    expect(container.textContent).not.toContain("Saved exit destination");
    expect(container.textContent).not.toContain(saved.state.intent);
    await act(async () => resolveSession(session));
    await vi.waitFor(() =>
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "not confirmed",
      ),
    );
    expect(container.textContent).not.toContain("Saved exit destination");
    await click("Try again");
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]![2]).toEqual(original);
    await vi.waitFor(() =>
      expect(container.textContent).toContain("Saved exit destination"),
    );
  });

  it("never transfers the previous account's unsaved intent to a newly resolved principal", async () => {
    await mount(view());
    await vi.waitFor(() =>
      expect(container.querySelector("textarea")).not.toBeNull(),
    );
    await enter("PRIVATE-PREVIOUS-ACCOUNT-DRAFT");
    const session = client.getQueryData(queryKeys.auth.session) as NonNullable<
      Awaited<ReturnType<typeof authApi.getSession>>
    >;
    vi.mocked(authApi.getSession).mockResolvedValue({
      ...session,
      user: { ...session.user, id: "different-owner" },
      session: { ...session.session, userId: "different-owner" },
    });
    vi.mocked(activationApi.get).mockResolvedValue({
      ...view(),
      state: { ...view().state, intent: "NEW-ACCOUNT-INTENT" },
    });
    await act(async () => {
      await client.invalidateQueries({ queryKey: queryKeys.auth.session });
    });
    await vi.waitFor(() =>
      expect(container.querySelector("textarea")?.value).toBe(
        "NEW-ACCOUNT-INTENT",
      ),
    );
    expect(container.textContent).not.toContain(
      "PRIVATE-PREVIOUS-ACCOUNT-DRAFT",
    );
    expect(activationApi.get).toHaveBeenLastCalledWith(
      companyId,
      "different-owner",
      expect.any(AbortSignal),
    );
  });
});

it("does not start an old-owner transport when focus starts session and Native observers in the same turn", async () => {
  const saved = {
    ...view(),
    state: { ...view().state, intent: "PRIVATE-FOCUS-DRAFT" },
  };
  await mount(saved);
  await vi.waitFor(() =>
    expect(container.querySelector("textarea")?.value).toBe(saved.state.intent),
  );
  const priorReads = vi.mocked(activationApi.get).mock.calls.length;
  const session = client.getQueryData(queryKeys.auth.session) as Awaited<
    ReturnType<typeof authApi.getSession>
  >;
  let releaseSession!: (value: typeof session) => void;
  vi.mocked(authApi.getSession).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        releaseSession = resolve;
      }),
  );
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  await vi.waitFor(() => expect(releaseSession).toBeTypeOf("function"));
  await vi.waitFor(() =>
    expect(container.querySelector("textarea")).toBeNull(),
  );
  expect(container.textContent).not.toContain("PRIVATE-");
  expect(activationApi.get).toHaveBeenCalledTimes(priorReads);
  let releaseRead!: (value: ActivationView) => void;
  vi.mocked(activationApi.get).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        releaseRead = resolve;
      }),
  );
  await act(async () => releaseSession(session));
  await vi.waitFor(() =>
    expect(activationApi.get).toHaveBeenCalledTimes(priorReads + 1),
  );
  expect(container.querySelector("textarea")).toBeNull();
  await act(async () => releaseRead(saved));
  await vi.waitFor(() =>
    expect(container.querySelector("textarea")?.value).toBe(saved.state.intent),
  );
});

it("starts only the reviewed original first task and keeps its native references in recovery", async () => {
  const candidate = { installationId: "10000000-0000-4000-8000-000000000004", installationHash: "a".repeat(64),
    planId: "10000000-0000-4000-8000-000000000005", issueId: "10000000-0000-4000-8000-000000000006",
    planVersion: 3, title: "Original prepared first task", maximumModelCostMinor: 0 as const, currency: "USD" as const };
  const review = { ...view("review"), firstTask: { candidates: [candidate], preparationOptions: [], hasMore: false, current: null } };
  await mount(review, "/saas/activation/9");
  const running: ActivationView = { ...review, version: review.version + 1, state: { ...review.state, step: "running", firstTask: {
    installationId: candidate.installationId, installationHash: candidate.installationHash, planId: candidate.planId, issueId: candidate.issueId } },
    firstTask: { candidates: [], preparationOptions: [], hasMore: false, current: { ...candidate, planVersion: 4, status: "running", dispatched: false } } };
  const write = vi.spyOn(activationApi, "command").mockRejectedValueOnce(new Error("Response lost"));
  await click("Run first task");
  await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
  const original = structuredClone(write.mock.calls[0]![2]);
  expect(original).toMatchObject({ operation: "start_first_task", installationId: candidate.installationId, planId: candidate.planId,
    expectedPlanVersion: 3, expectedInstallationHash: candidate.installationHash, expectedMaximumModelCostMinor: 0 });
  await vi.waitFor(() => expect(container.textContent).toContain("not confirmed"));
  write.mockResolvedValue(running);
  await click("Try again");
  await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));expect(write.mock.calls[1]![2]).toEqual(original);
  await vi.waitFor(() => expect(container.textContent).toContain("queue has not confirmed"));
  expect(write).toHaveBeenCalledTimes(2);
  expect(container.textContent).not.toContain("Safe first-task execution is awaiting qualification");
});

it("fences a stale Run button before transport when the original session changes in the same turn", async () => {
  const candidate = { installationId: "10000000-0000-4000-8000-000000000004", installationHash: "a".repeat(64),
    planId: "10000000-0000-4000-8000-000000000005", issueId: "10000000-0000-4000-8000-000000000006",
    planVersion: 3, title: "Original prepared first task", maximumModelCostMinor: 0 as const, currency: "USD" as const };
  await mount({ ...view("review"), firstTask: { candidates: [candidate], preparationOptions: [], hasMore: false, current: null } }, "/saas/activation/9");
  await vi.waitFor(() => expect([...container.querySelectorAll("button")].some(b => b.textContent === "Run first task")).toBe(true));
  const run = [...container.querySelectorAll("button")].find(b => b.textContent === "Run first task")!;
  const write = vi.spyOn(activationApi, "command");
  await act(async () => { client.setQueryData(queryKeys.auth.session, v9SessionFixture("other-principal"));run.click(); });
  expect(write).not.toHaveBeenCalled();
});
