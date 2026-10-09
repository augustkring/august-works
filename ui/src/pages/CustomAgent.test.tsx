// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import {
  V5_FEATURE_KEYS,
  agentAuthoringContentSchema,
  type AgentAuthoringDraftView,
  type LiveEvent,
} from "@paperclipai/shared";
import { agentAuthoringApi } from "../api/agent-authoring";
import { instanceSettingsApi } from "../api/instanceSettings";
import { ApiError } from "../api/client";
import { CustomAgent } from "./CustomAgent";

const context = vi.hoisted(() => ({
  company: "10000000-0000-4000-8000-000000000001",
  principal: "author",
  live: null as null | ((event: LiveEvent) => void),
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
    settled: true,
    localImplicit: false,
  }),
}));
vi.mock("../context/LiveUpdatesProvider", () => ({
  useCompanyLiveEvent: (handler: (event: LiveEvent) => void) => {
    context.live = handler;
  },
}));
const id = "10000000-0000-4000-8000-000000000002";
const draft: AgentAuthoringDraftView = {
  id,
  companyId: context.company,
  agentId: null,
  createdByUserId: "author",
  version: 1,
  status: "draft",
  step: "identity",
  baselineHash: null,
  content: agentAuthoringContentSchema.parse({
    name: "Private customer draft",
    description: "Bounded internal work",
    ownerUserId: "author",
  }),
  createdAt: "2026-10-09T00:00:00.000Z",
  updatedAt: "2026-10-09T00:00:00.000Z",
};
let root: Root, container: HTMLDivElement, client: QueryClient;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  client?.clear();
  context.principal = "author";
  context.live = null;
  vi.restoreAllMocks();
});
async function render() {
  await act(async () =>
    root.render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[`/AW/agents/custom/${id}/identity`]}>
            <Routes>
              <Route
                path="/AW/agents/custom/:draftId/:screen?"
                element={<CustomAgent />}
              />
              <Route
                path="/AW/agents/custom"
                element={<p>Saved drafts destination</p>}
              />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </StrictMode>,
    ),
  );
}
async function mount() {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.spyOn(instanceSettingsApi, "getExperimental").mockResolvedValue({
    ...Object.fromEntries(V5_FEATURE_KEYS.map((key) => [key, true])),
    enableFoundationV1: true,
    enableContextEngineV1: true,
    saas_deployment_profile_v6: true,
    billing_v6: true,
    agent_packages_v7: true,
    hire_agent_v9: true,
  } as never);
  vi.spyOn(agentAuthoringApi, "options").mockResolvedValue({
    owners: [{ id: "author", name: "Accountable author" }],
    knowledge: [],
    runtimes: [],
  });
  await render();
  await vi.waitFor(() =>
    expect(document.querySelector("input")?.value).toBe(
      "Private customer draft",
    ),
  );
}
async function enter(value: string) {
  const element = document.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (element) => element.textContent === label,
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}

it("keeps the exact save request after an unknown acknowledgement and background version refresh", async () => {
  const get = vi.spyOn(agentAuthoringApi, "get").mockResolvedValue(draft);
  const save = vi
    .spyOn(agentAuthoringApi, "save")
    .mockRejectedValueOnce(new Error("Disconnected"))
    .mockResolvedValueOnce({
      ...draft,
      version: 3,
      content: { ...draft.content!, name: "Prepared name" },
    });
  await mount();
  await enter("Prepared name");
  await click("Save & exit");
  await vi.waitFor(() =>
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "not acknowledged",
    ),
  );
  const first = structuredClone(save.mock.calls[0]![3]);
  expect(first.expectedVersion).toBe(1);
  expect(first.content.name).toBe("Prepared name");
  expect(document.querySelector("input")!.matches(":disabled")).toBe(true);
  get.mockResolvedValue({ ...draft, version: 2 });
  await act(async () => {
    await client.refetchQueries({
      queryKey: ["agent-authoring", context.company, context.principal, id],
    });
  });
  await click("Retry the same save");
  expect(save.mock.calls[1]![3]).toEqual(first);
  await vi.waitFor(() =>
    expect(container.textContent).toContain("Saved drafts destination"),
  );
});
it("allows correction after a definite validation rejection without changing production", async () => {
  vi.spyOn(agentAuthoringApi, "get").mockResolvedValue(draft);
  const save = vi
    .spyOn(agentAuthoringApi, "save")
    .mockRejectedValueOnce(
      new ApiError("Owner is unavailable", 422, {
        code: "draft_owner_unavailable",
      }),
    )
    .mockResolvedValueOnce({ ...draft, version: 2 });
  await mount();
  await click("Continue");
  await vi.waitFor(() =>
    expect(container.textContent).toContain("draft was not saved"),
  );
  expect(document.querySelector("input")!.matches(":disabled")).toBe(false);
  await enter("Corrected name");
  await click("Continue");
  expect(save.mock.calls[1]![3].requestId).not.toBe(
    save.mock.calls[0]![3].requestId,
  );
  expect(save.mock.calls[1]![3].content.name).toBe("Corrected name");
  await vi.waitFor(() =>
    expect(document.querySelector("h1")?.textContent).toBe("Instructions"),
  );
  expect(document.activeElement).toBe(document.querySelector("h1"));
});
it("hides retained content immediately on access change and does not display it after a revoked read", async () => {
  const get = vi.spyOn(agentAuthoringApi, "get").mockResolvedValue(draft);
  await mount();
  get.mockRejectedValue(new ApiError("Access revoked", 403, {}));
  await act(async () => {
    context.live?.({
      id: 1,
      createdAt: "2026-10-09T00:00:00.000Z",
      companyId: context.company,
      type: "activity.logged",
      payload: {
        entityType: "company_membership",
        action: "company_member.suspended",
      },
    });
  });
  await vi.waitFor(() =>
    expect(container.textContent).toContain("content has been hidden"),
  );
  expect(container.textContent).not.toContain("Private customer draft");
  expect(document.querySelector("input")).toBeNull();
});
it("clears the old editor and scopes the new request when the account changes", async () => {
  const get = vi.spyOn(agentAuthoringApi, "get").mockResolvedValue(draft);
  await mount();
  await enter("Private unsaved work");
  context.principal = "other-member";
  get.mockRejectedValue(new ApiError("Draft not found", 404, {}));
  await render();
  await vi.waitFor(() =>
    expect(container.textContent).toContain("draft could not be loaded"),
  );
  expect(get.mock.calls.at(-1)![1]).toBe("other-member");
  expect(container.textContent).not.toContain("Private unsaved work");
  expect(document.querySelector("input")).toBeNull();
});
