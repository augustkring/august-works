// @vitest-environment jsdom
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import { act, StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import {
  V5_FEATURE_KEYS,
  agentAuthoringContentSchema,
  type AgentAuthoringDraftView,
  type LiveEvent,
} from "@paperclipai/shared";
import { agentAuthoringApi } from "../api/agent-authoring";
import { ApiError } from "../api/client";
import { instanceSettingsApi } from "../api/instanceSettings";
import { HireAgentSetup } from "./HireAgentSetup";
import { i18n } from "../i18n";
import { queryKeys } from "../lib/queryKeys";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const context = vi.hoisted(() => ({
  handlers: new Set<(event: LiveEvent) => void>(),
}));
vi.mock("../api/companies-query", () => ({
  useAccountIdentity: () => ({ userId: "author", settled: true, localImplicit: false, failed: false }),
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
  await i18n.changeLanguage("en");
});
async function mount(step = "hire_access", enabled = true) {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  client.setQueryDefaults(queryKeys.auth.session, { gcTime: Infinity });
  client.setQueryData(queryKeys.auth.session, v9SessionFixture("author"));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.spyOn(instanceSettingsApi, "getExperimental").mockResolvedValue({
    ...Object.fromEntries(V5_FEATURE_KEYS.map((key) => [key, true])),
    enableFoundationV1: true, enableContextEngineV1: true, saas_deployment_profile_v6: true,
    billing_v6: true, agent_packages_v7: true, hire_agent_v9: true,
  } as never);
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
  const flags = client.getQueryData<Record<string, boolean>>(queryKeys.instance.experimentalSettings)!;
  await act(async () => client.setQueryData(queryKeys.instance.experimentalSettings, { ...flags, hire_agent_v9: false }));
  await vi.waitFor(() => expect(container.querySelector("input")).not.toBeNull());
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
    const publish = vi.spyOn(agentAuthoringApi, "publish");
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
    if (step === "hire_review" || step === "hire_receipt") {
      expect(container.textContent).toContain("Prepare an inactive agent");
      expect([...container.querySelectorAll("button")].some(button => button.textContent === "Publish and activate")).toBe(false);
    }
    expect(create).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  },
);
it("hides a private setup through the account recheck and resumes its unsaved name only after a fresh owner read", async () => {
  const get = vi.spyOn(agentAuthoringApi, "get").mockResolvedValue(draft);
  await mount();
  const input = container.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "PRIVATE unsaved setup name");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  let releaseRead: ((row: AgentAuthoringDraftView) => void) | undefined;
  get.mockImplementation(() => new Promise((resolve) => { releaseRead = resolve; }));
  let releaseSession!: () => void;
  await act(async () => { void client.fetchQuery({ queryKey: queryKeys.auth.session,
    queryFn: () => new Promise<ReturnType<typeof v9SessionFixture>>((resolve) => { releaseSession = () => resolve(v9SessionFixture("author")); }) }).catch(() => {}); });
  await vi.waitFor(() => expect(container.querySelector("input,textarea")).toBeNull());
  expect(container.textContent).not.toContain("PRIVATE"); expect(releaseRead).toBeUndefined();
  await act(async () => releaseSession());
  await vi.waitFor(() => expect(releaseRead).toBeDefined());
  expect(container.querySelector("input,textarea")).toBeNull();
  await act(async () => releaseRead!(draft));
  await vi.waitFor(() => expect(container.querySelector("input")?.value).toBe("PRIVATE unsaved setup name"));
});
it("never sends a same-turn discard while the original session query is fetching", async () => {
  vi.spyOn(agentAuthoringApi, "get").mockResolvedValue(draft);
  const discard = vi.spyOn(agentAuthoringApi, "discard").mockResolvedValue(draft);
  await mount();
  const button = Array.from(container.querySelectorAll("button")).find((value) => value.textContent === "Discard setup")!;
  let releaseSession!: () => void;
  await act(async () => {
    void client.fetchQuery({ queryKey: queryKeys.auth.session,
      queryFn: () => new Promise<ReturnType<typeof v9SessionFixture>>((resolve) => { releaseSession = () => resolve(v9SessionFixture("author")); }) }).catch(() => {});
    button.click();
  });
  expect(discard).not.toHaveBeenCalled(); expect(container.querySelector("input")).toBeNull();
  await act(async () => releaseSession());
});

it("changes the setup language while preserving the original unsaved input and making no save or discard request", async () => {
  const get = vi.spyOn(agentAuthoringApi, "get").mockResolvedValue(draft);
  const save = vi.spyOn(agentAuthoringApi, "save");
  const discard = vi.spyOn(agentAuthoringApi, "discard");
  await mount();
  const input = container.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "PRIVATE unchanged native name");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await i18n.changeLanguage("da");
  });
  await vi.waitFor(() => expect(container.querySelector("h1")?.textContent).toBe("Ejer og viden"));
  expect(container.querySelector('nav')?.getAttribute('aria-label')).toBe("Trin i agentopsætningen");
  expect(container.querySelector("input")?.value).toBe("PRIVATE unchanged native name");
  expect(container.querySelector("textarea")?.value).toBe(draft.content!.outcome);
  expect(container.textContent).toContain("Ingen obligatoriske kilder er angivet.");
  expect(container.textContent).toContain("Gemt opsætning v1 · 1.0.0");
  expect(container.textContent).toContain("Gem og afslut");
  expect(container.textContent).not.toContain("Accountable owner");
  expect(get).toHaveBeenCalledOnce(); expect(save).not.toHaveBeenCalled(); expect(discard).not.toHaveBeenCalled();
  await act(async () => { await i18n.changeLanguage("en"); });
  expect(container.querySelector("h1")?.textContent).toBe("Owner & knowledge");
  expect(container.querySelector("input")?.value).toBe("PRIVATE unchanged native name");
});


it("translates current native blockers while keeping representative testing and publication blocked", async () => {
  vi.spyOn(agentAuthoringApi, "get").mockResolvedValue(draft);
  await mount("hire_review");
  await vi.waitFor(() => expect(container.textContent).toContain("independently verified"));
  await act(async () => { await i18n.changeLanguage("da"); });
  expect(container.textContent).toContain("Repræsentativ kørsel og uafhængigt verificerede resultater");
  expect(container.textContent).not.toContain("independently verified");
  expect(container.textContent).toContain("Opret en inaktiv agent");
  expect(Array.from(container.querySelectorAll("button")).some(button => button.textContent === "Publicér og aktivér")).toBe(false);
});
