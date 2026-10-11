// @vitest-environment jsdom
import { v9SessionFixture } from "../hooks/v9-session.test-support";
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
import { queryKeys } from "../lib/queryKeys";
import { i18n } from "../i18n";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

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
  await i18n.changeLanguage("en");
  vi.restoreAllMocks();
});
async function render(start = false) {
  await act(async () =>
    root.render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <MemoryRouter
            initialEntries={[
              start ? "/AW/agents/custom" : `/AW/agents/custom/${id}/identity`,
            ]}
          >
            <Routes>
              <Route
                path="/AW/agents/custom/:draftId/:screen?"
                element={<CustomAgent />}
              />
              <Route
                path="/AW/agents/custom"
                element={
                  start ? <CustomAgent /> : <p>Saved drafts destination</p>
                }
              />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </StrictMode>,
    ),
  );
}
async function mount(start = false) {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  client.setQueryDefaults(queryKeys.auth.session, { gcTime: Infinity });
  client.setQueryData(queryKeys.auth.session, v9SessionFixture(context.principal));
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
  await render(start);
  if (start) {
    await vi.waitFor(() =>
      expect(container.textContent).toContain("Your saved drafts"),
    );
    return;
  }
  await vi.waitFor(() =>
    expect(document.querySelector("input")?.value).toBe(
      "Private customer draft",
    ),
  );
}
it("immediately hides private history titles while access is rechecked", async () => {
  const list = vi.spyOn(agentAuthoringApi, "list").mockResolvedValue({
    items: [
      {
        id,
        companyId: context.company,
        agentId: null,
        name: "Private saved title",
        version: 1,
        step: "identity",
        updatedAt: draft.updatedAt,
      },
    ],
    nextCursor: null,
  });
  await mount(true);
  await vi.waitFor(() =>
    expect(container.textContent).toContain("Private saved title"),
  );
  list.mockImplementation(() => new Promise(() => {}));
  await act(async () =>
    context.live?.({
      id: 1,
      createdAt: draft.updatedAt,
      type: "activity.logged",
      companyId: context.company,
      payload: {
        action: "company_membership.permission_changed",
        entityType: "company_membership",
      },
    } as LiveEvent),
  );
  expect(container.textContent).not.toContain("Private saved title");
  expect(container.textContent).toContain("Loading saved drafts");
});
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
  client.setQueryData(queryKeys.auth.session, v9SessionFixture(context.principal));
  get.mockRejectedValue(new ApiError("Draft not found", 404, {}));
  await render();
  await vi.waitFor(() =>
    expect(container.textContent).toContain("draft could not be loaded"),
  );
  expect(get.mock.calls.at(-1)![1]).toBe("other-member");
  expect(container.textContent).not.toContain("Private unsaved work");
  expect(document.querySelector("input")).toBeNull();
});
it("hides a same-account unsaved draft until both the session and a fresh native owner read resolve", async () => {
  const get = vi.spyOn(agentAuthoringApi, "get").mockResolvedValue(draft);
  await mount(); await enter("PRIVATE unsaved same-account draft");
  let releaseRead: ((row: AgentAuthoringDraftView) => void) | undefined;
  get.mockImplementation(() => new Promise((resolve) => { releaseRead = resolve; }));
  let releaseSession!: () => void;
  await act(async () => { void client.fetchQuery({ queryKey: queryKeys.auth.session,
    queryFn: () => new Promise<ReturnType<typeof v9SessionFixture>>((resolve) => { releaseSession = () => resolve(v9SessionFixture(context.principal)); }) }).catch(() => {}); });
  await vi.waitFor(() => expect(container.querySelector("input,textarea")).toBeNull());
  expect(container.textContent).not.toContain("PRIVATE"); expect(releaseRead).toBeUndefined();
  await act(async () => releaseSession());
  await vi.waitFor(() => expect(releaseRead).toBeDefined());
  expect(container.querySelector("input,textarea")).toBeNull();
  await act(async () => releaseRead!(draft));
  await vi.waitFor(() => expect(container.querySelector("input")?.value).toBe("PRIVATE unsaved same-account draft"));
});
it("fences a same-turn save and never sends it while the original session query is fetching", async () => {
  vi.spyOn(agentAuthoringApi, "get").mockResolvedValue(draft);
  const save = vi.spyOn(agentAuthoringApi, "save").mockResolvedValue(draft);
  await mount();
  const button = Array.from(container.querySelectorAll("button")).find((value) => value.textContent === "Continue")!;
  let releaseSession!: () => void;
  await act(async () => {
    void client.fetchQuery({ queryKey: queryKeys.auth.session,
      queryFn: () => new Promise<ReturnType<typeof v9SessionFixture>>((resolve) => { releaseSession = () => resolve(v9SessionFixture(context.principal)); }) }).catch(() => {});
    button.click();
  });
  expect(save).not.toHaveBeenCalled(); await vi.waitFor(() => expect(container.querySelector("input")).toBeNull());
  await act(async () => releaseSession());
});

it("blocks a same-turn save when the completed original session already belongs to another account", async () => {
  vi.spyOn(agentAuthoringApi, "get").mockResolvedValue(draft);
  const save = vi.spyOn(agentAuthoringApi, "save").mockResolvedValue(draft);
  await mount();
  const button = Array.from(container.querySelectorAll("button")).find((value) => value.textContent === "Continue")!;
  await act(async () => {
    client.setQueryData(queryKeys.auth.session, v9SessionFixture("different-current-account"));
    button.click();
  });
  expect(save).not.toHaveBeenCalled();
});

it("blocks a same-turn save after completed rollout withdrawal instead of using the previous rendered flag", async () => {
  vi.spyOn(agentAuthoringApi, "get").mockResolvedValue(draft);
  const save = vi.spyOn(agentAuthoringApi, "save").mockResolvedValue(draft);
  await mount();
  const button = Array.from(container.querySelectorAll("button")).find((value) => value.textContent === "Continue")!;
  const flags = client.getQueryData(queryKeys.instance.experimentalSettings) as Record<string, unknown>;
  await act(async () => {
    client.setQueryData(queryKeys.instance.experimentalSettings, { ...flags, hire_agent_v9: false });
    button.click();
  });
  expect(save).not.toHaveBeenCalled();
});
it("keeps a late save unconfirmed after a completed account recheck and retries only its original body", async () => {
  vi.spyOn(agentAuthoringApi, "get").mockResolvedValue(draft);
  let releaseSave!: (row: AgentAuthoringDraftView) => void;
  const save = vi.spyOn(agentAuthoringApi, "save")
    .mockImplementationOnce(() => new Promise((resolve) => { releaseSave = resolve; }))
    .mockResolvedValueOnce({ ...draft, version: 2 });
  await mount(); await enter("PRIVATE original save body"); await click("Save & exit");
  await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
  const input = structuredClone(save.mock.calls[0]![3]);
  let releaseSession!: () => void;
  await act(async () => { void client.fetchQuery({ queryKey: queryKeys.auth.session,
    queryFn: () => new Promise<ReturnType<typeof v9SessionFixture>>((resolve) => { releaseSession = () => resolve(v9SessionFixture(context.principal)); }) }).catch(() => {}); });
  await vi.waitFor(() => expect(container.querySelector("input")).toBeNull());
  await act(async () => releaseSession());
  await vi.waitFor(() => expect(container.querySelector("input")).not.toBeNull());
  await act(async () => releaseSave({ ...draft, version: 2 }));
  await vi.waitFor(() => expect(container.textContent).toContain("save was not acknowledged"));
  expect(container.textContent).not.toContain("Saved drafts destination");
  await click("Retry the same save");
  expect(save.mock.calls[1]![3]).toEqual(input);
  await vi.waitFor(() => expect(container.textContent).toContain("Saved drafts destination"));
});


it("changes Custom Agent language while preserving unsaved native fields without sending a command", async () => {
  const get = vi.spyOn(agentAuthoringApi, "get").mockResolvedValue(draft);
  const save = vi.spyOn(agentAuthoringApi, "save");
  const discard = vi.spyOn(agentAuthoringApi, "discard");
  await mount();
  const input = container.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "PRIVATE unchanged custom name");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await i18n.changeLanguage("da");
  });
  await vi.waitFor(() => expect(container.querySelector("h1")?.textContent).toBe("Identitet"));
  expect(container.querySelector("nav")?.getAttribute("aria-label")).toBe("Trin i agentredigeringen");
  expect(container.querySelector("input")?.value).toBe("PRIVATE unchanged custom name");
  expect(container.textContent).toContain("Beskrivelse til kunder");
  expect(container.textContent).toContain("Tilpasset agent · Udkast v1 · 2 af 13");
  expect(container.textContent).toContain("Gem og afslut");
  expect(container.textContent).not.toContain("Customer-facing description");
  expect(get).toHaveBeenCalledOnce(); expect(save).not.toHaveBeenCalled(); expect(discard).not.toHaveBeenCalled();
  await act(async () => { await i18n.changeLanguage("en"); });
  expect(container.querySelector("h1")?.textContent).toBe("Identity");
  expect(container.querySelector("input")?.value).toBe("PRIVATE unchanged custom name");
});


it("announces invalid draft fields in the selected language and allows correction without freezing or sending an invalid command", async () => {
  vi.spyOn(agentAuthoringApi, "get").mockResolvedValue(draft);
  const save = vi.spyOn(agentAuthoringApi, "save").mockResolvedValue({ ...draft, version: 2 });
  await mount();
  await act(async () => { await i18n.changeLanguage("da"); });
  const input = container.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Invalid" + String.fromCharCode(0));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const saveButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Gem og afslut")!;
  await act(async () => saveButton.click());
  expect(save).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Gennemgå Agentnavn, før du gemmer");
  expect(input.disabled).toBe(false);
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(input.getAttribute("aria-describedby")).toBe("custom-agent-validation");
  expect(document.activeElement).toBe(container.querySelector("#custom-agent-validation"));
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Corrected native name");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => saveButton.click());
  await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0]![3].content.name).toBe("Corrected native name");
});
