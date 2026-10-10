// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authApi } from "../api/auth";
import { activationApi } from "../api/activation";
import { i18n } from "../i18n";
import {
  initialActivationState,
  type ActivationView,
} from "@paperclipai/shared";
import { ActivationPage } from "./Activation";
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
    isPending: false,
    isError: false,
  }),
}));
vi.mock("../components/CustomerFeedbackDialog", () => ({
  CustomerFeedbackDialog: () => null,
}));
let root: Root, container: HTMLDivElement, client: QueryClient;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  client?.clear();
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
    expect(document.body.textContent).toContain(
      "No qualified first capability is available yet",
    );
    expect(document.body.textContent).not.toContain("Use this agent");
    expect(document.body.textContent).not.toContain("Run first task");
  });
});
