// @vitest-environment jsdom
import { act, StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import {
  agentAuthoringContentSchema,
  type AgentAuthoringDraftView,
  type LiveEvent,
} from "@paperclipai/shared";
import { agentAuthoringApi } from "../api/agent-authoring";
import { ApiError } from "../api/client";
import { HireAgentSetup } from "./HireAgentSetup";
const context = vi.hoisted(() => ({
  handlers: new Set<(event: LiveEvent) => void>(),
}));
vi.mock("../context/LiveUpdatesProvider", () => ({
  useCompanyLiveEvent: (handler: (event: LiveEvent) => void) => {
    useEffect(() => {
      context.handlers.add(handler);
      return () => {
        context.handlers.delete(handler);
      };
    }, [handler]);
  },
}));
vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "10000000-0000-4000-8000-000000000001",
    selectedCompany: { issuePrefix: "AW" },
  }),
}));
const company = "10000000-0000-4000-8000-000000000001",
  id = "10000000-0000-4000-8000-000000000002";
const draft: AgentAuthoringDraftView = {
  id,
  companyId: company,
  agentId: null,
  createdByUserId: "author",
  version: 1,
  kind: "hire",
  status: "draft",
  step: "hire_access",
  baselineHash: null,
  package: {
    key: "research",
    versionId: "10000000-0000-4000-8000-000000000003",
    version: "1.0.0",
    contentHash: "a".repeat(64),
  },
  content: agentAuthoringContentSchema.parse({
    name: "Private research setup",
    outcome: "Prepare approved research",
    ownerUserId: "author",
  }),
  createdAt: "2026-10-09T00:00:00.000Z",
  updatedAt: "2026-10-09T00:00:00.000Z",
};
let root: Root, container: HTMLDivElement, client: QueryClient;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  client?.clear();
  container?.remove();
  context.handlers.clear();
  vi.restoreAllMocks();
});
async function mount(step = "hire_access", enabled = true) {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.spyOn(agentAuthoringApi, "options").mockResolvedValue({
    owners: [{ id: "author", name: "Accountable author" }],
    knowledge: [],
    runtimes: [],
  });
  vi.spyOn(agentAuthoringApi, "hireCapability").mockResolvedValue({
    key: "research",
    versionId: draft.package!.versionId,
    version: "1.0.0",
    name: "Research",
    category: "Research",
    outcome: "Prepare research",
    requiredKnowledge: [],
    requiredConnections: [],
    limits: [],
    actionClasses: ["internal_draft"],
    available: true,
  });
  vi.spyOn(agentAuthoringApi, "review").mockResolvedValue({
    draftId: id,
    version: 1,
    productionChanged: false,
    baselineCurrent: true,
    blockers: [
      {
        code: "representative_test_unqualified",
        message: "A representative result must be independently verified.",
        step: "test",
      },
    ],
    test: { status: "unqualified", message: "Unavailable" },
    publishAllowed: false,
  });
  await act(async () =>
    root.render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <MemoryRouter
            initialEntries={[`/AW/agents/hire/drafts/${id}/${step}`]}
          >
            <Routes>
              <Route
                path="/AW/agents/hire/drafts/:draftId/:screen?"
                element={
                  <HireAgentSetup
                    company={company}
                    principal="author"
                    id={id}
                    enabled={enabled}
                  />
                }
              />
              <Route
                path="/AW/agents/hire"
                element={<p>Saved Hire setups destination</p>}
              />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </StrictMode>,
    ),
  );
  await vi.waitFor(() =>
    expect(container.textContent).toContain(draft.content!.name),
  );
}
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (value) => value.textContent === label,
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
async function enter(value: string) {
  const input = container.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function accessEvent(): LiveEvent {
  return {
    id: 1,
    createdAt: draft.updatedAt,
    companyId: company,
    type: "activity.logged",
    payload: {
      entityType: "company_membership",
      action: "company_membership.permission_changed",
    },
  };
}
it("freezes and retries the exact save after a lost reply and a background version refresh", async () => {
  const get = vi.spyOn(agentAuthoringApi, "get").mockResolvedValue(draft);
  const save = vi
    .spyOn(agentAuthoringApi, "save")
    .mockRejectedValueOnce(new Error("Disconnected"))
    .mockResolvedValueOnce({ ...draft, version: 3 });
  await mount();
  await enter("Prepared name");
  await click("Save & exit");
  await vi.waitFor(() =>
    expect(container.textContent).toContain("not acknowledged"),
  );
  const first = structuredClone(save.mock.calls[0]![3]);
  expect(first.expectedVersion).toBe(1);
  expect(first.content.name).toBe("Prepared name");
  expect(container.querySelector("input")!.matches(":disabled")).toBe(true);
  get.mockResolvedValue({ ...draft, version: 2 });
  await act(async () => {
    await client.refetchQueries({
      queryKey: ["agent-authoring", company, "author", id],
    });
  });
  await click("Retry the same save");
  expect(save.mock.calls[1]![3]).toEqual(first);
  await vi.waitFor(() =>
    expect(container.textContent).toContain("Saved Hire setups destination"),
  );
});
it("permits correction after definite rejection and requires explicit reload after a conflict", async () => {
  const get = vi.spyOn(agentAuthoringApi, "get").mockResolvedValue(draft);
  const save = vi
    .spyOn(agentAuthoringApi, "save")
    .mockRejectedValueOnce(new ApiError("Unavailable owner", 422, {}))
    .mockRejectedValueOnce(new ApiError("Changed version", 409, {}));
  await mount();
  await click("Save & exit");
  await vi.waitFor(() =>
    expect(container.textContent).toContain("could not be saved"),
  );
  expect(container.querySelector("input")!.matches(":disabled")).toBe(false);
  await enter("Corrected name");
  await click("Save & exit");
  await vi.waitFor(() =>
    expect(container.textContent).toContain("Reload it before making"),
  );
  expect(save.mock.calls[1]![3].requestId).not.toBe(
    save.mock.calls[0]![3].requestId,
  );
  get.mockResolvedValue({
    ...draft,
    version: 2,
    content: { ...draft.content!, name: "Current saved name" },
  });
  await click("Reload saved setup — replaces unsaved edits");
  await vi.waitFor(() =>
    expect(container.querySelector("input")!.value).toBe("Current saved name"),
  );
  expect(container.querySelector("input")!.matches(":disabled")).toBe(false);
});
it("hides private content immediately and ignores a late save reply after access is revoked", async () => {
  const get = vi.spyOn(agentAuthoringApi, "get").mockResolvedValue(draft);
  let acknowledge!: (value: AgentAuthoringDraftView) => void;
  vi.spyOn(agentAuthoringApi, "save").mockImplementation(
    () =>
      new Promise((resolve) => {
        acknowledge = resolve;
      }),
  );
  await mount();
  await enter("Private unsaved proposal");
  await click("Save & exit");
  let rejectRead!: (error: Error) => void;
  get.mockImplementation(
    () =>
      new Promise((_, reject) => {
        rejectRead = reject;
      }),
  );
  await act(async () =>
    [...context.handlers].forEach((handler) => handler(accessEvent())),
  );
  expect(container.textContent).toContain("Checking current access");
  expect(container.textContent).not.toContain("Private unsaved proposal");
  expect(container.querySelector("input")).toBeNull();
  await act(async () => {
    rejectRead(new ApiError("Revoked", 403, {}));
  });
  await vi.waitFor(() =>
    expect(container.textContent).toContain(
      "no longer available to your current account",
    ),
  );
  await act(async () => acknowledge({ ...draft, version: 2 }));
  expect(container.textContent).not.toContain("Saved Hire setups destination");
  expect(container.textContent).not.toContain(draft.content!.name);
});
it("keeps rollback reads and discard available while disabling new setup writes", async () => {
  vi.spyOn(agentAuthoringApi, "get").mockResolvedValue(draft);
  const save = vi.spyOn(agentAuthoringApi, "save");
  const discard = vi
    .spyOn(agentAuthoringApi, "discard")
    .mockResolvedValue({
      ...draft,
      version: 2,
      status: "discarded",
      content: null,
    });
  await mount("hire_access", false);
  expect(container.textContent).toContain("New setup changes are unavailable");
  expect(container.querySelector("input")!.matches(":disabled")).toBe(true);
  await click("Discard setup");
  await vi.waitFor(() =>
    expect(container.textContent).toContain("Saved Hire setups destination"),
  );
  expect(discard).toHaveBeenCalledOnce();
  expect(save).not.toHaveBeenCalled();
});
it.each(["hire_test", "hire_review", "hire_receipt"])(
  "shows truthful unqualified %s without activation",
  async (step) => {
    vi.spyOn(agentAuthoringApi, "get").mockResolvedValue(draft);
    const create = vi.spyOn(agentAuthoringApi, "create");
    await mount(step);
    await vi.waitFor(() =>
      expect(container.textContent).toContain("independently verified"),
    );
    if (step === "hire_test") {
      expect(container.textContent).toContain("No representative result");
      expect(
        [...container.querySelectorAll("button")].find(
          (button) => button.textContent === "Continue",
        )!.disabled,
      ).toBe(true);
    }
    if (step === "hire_review")
      expect(
        [...container.querySelectorAll("button")].find(
          (button) => button.textContent === "Hire agent",
        )!.disabled,
      ).toBe(true);
    if (step === "hire_receipt")
      expect(container.textContent).toContain("No agent has been activated");
    expect(create).not.toHaveBeenCalled();
  },
);
