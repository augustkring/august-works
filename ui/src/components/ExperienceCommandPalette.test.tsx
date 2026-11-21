// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { ExperienceCommandPalette } from "./ExperienceCommandPalette";
import { api } from "../api/client";
import type { CompanySearchResponse } from "@paperclipai/shared";
import { i18n } from "../i18n";
import { queryKeys } from "../lib/queryKeys";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
const state = vi.hoisted(() => ({
  principal: "first-member",
  companyId: "10000000-0000-4000-8000-000000000001",
  openNewIssue: vi.fn(),
  openNewProject: vi.fn(),
  navigate: vi.fn(),
  setSidebarOpen: vi.fn(),
  utilityOpen: false,
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
vi.mock("../api/companies-query", () => ({
  useAccountIdentity: () => ({
    userId: state.principal,
    settled: true,
    failed: false,
    localImplicit: false,
  }),
}));
vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: state.companyId }),
}));
vi.mock("../context/DialogContext", () => ({
  useDialogActions: () => ({
    openNewIssue: state.openNewIssue,
    openNewProject: state.openNewProject,
  }),
}));
vi.mock("../context/SidebarContext", () => ({
  useSidebar: () => ({ isMobile: true, setSidebarOpen: state.setSidebarOpen }),
}));
vi.mock("../lib/router", () => ({ useNavigate: () => state.navigate }));
vi.mock("./ui/command", () => ({
  Command: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandGroup: ({
    children,
    heading,
  }: {
    children: ReactNode;
    heading: string;
  }) => <section aria-label={heading}>{children}</section>,
  CommandList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandInput: ({
    value,
    onValueChange,
    ...props
  }: {
    value: string;
    onValueChange: (text: string) => void;
  }) => (
    <input
      {...props}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    />
  ),
  CommandItem: ({
    children,
    onSelect,
  }: {
    children: ReactNode;
    onSelect: () => void;
  }) => <button onClick={onSelect}>{children}</button>,
}));
const id = "10000000-0000-4000-8000-000000000002",
  at = "2026-10-09T00:00:00.000Z";
const model = () => ({
  companyId: state.companyId,
  profile: "member",
  observedAt: at,
  commands: [
    {
      id: "create_task",
      href: null,
      group: "create",
      canonicalAuthorizationRequired: true,
    },
    {
      id: "search",
      href: "/search",
      group: "navigate",
      canonicalAuthorizationRequired: true,
    },
  ],
  resources: [
    {
      id,
      kind: "agent",
      title: "Private agent title",
      href: `/agents/${id}`,
      companyId: state.companyId,
      version: at,
    },
  ],
  semanticDrafting: "unqualified",
});
function helpResponse(title: string, snippet: string): CompanySearchResponse {
  return {
    query: "recover", normalizedQuery: "recover", scope: "help", sort: "relevance", limit: 6, offset: 0,
    results: [{ id: "recovering-work", type: "help", score: 2, title, href: "https://docs.blentera.com/help/recovering-work",
      matchedFields: ["title"], sourceLabel: "Help · Preview", snippet, snippets: [],
      helpArticle: { articleId: "recovering-work", audience: "company-members", maturity: "preview", applicableProductVersions: ["V10"], locale: "en", lastVerifiedAt: "2026-10-24", source: "mintlify" },
      updatedAt: null, previewImageUrl: null }],
    countsByType: { issue: 0, artifact: 0, agent: 0, project: 0, help: 1, comment: 0, document: 0 },
    filterOptionCounts: { status: {}, priority: {}, assigneeAgentId: {}, assigneeUserId: {}, projectId: {}, labelId: {}, updatedWithin: {} },
    zeroResults: null, hasMore: false,
  };
}
let root: Root, container: HTMLDivElement, client: QueryClient, testInvoker: HTMLButtonElement | null;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  testInvoker?.remove();
  testInvoker = null;
  client?.clear();
  vi.restoreAllMocks();
  state.principal = "first-member";
  state.openNewIssue.mockReset();
  state.openNewProject.mockReset();
  state.navigate.mockReset();
  state.utilityOpen = false;
});
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <ExperienceCommandPalette />
        {state.utilityOpen && (
          <Dialog open>
            <DialogContent>
              <DialogTitle>Utility question</DialogTitle>
              <DialogDescription>
                Keep this input active during private background checks.
              </DialogDescription>
              <input aria-label="Utility clarification" />
            </DialogContent>
          </Dialog>
        )}
      </QueryClientProvider>,
    ),
  );
}
async function mount(authenticated = false, withInvoker = false) {
  await i18n.changeLanguage("en");
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (authenticated) {
    client.setQueryDefaults(queryKeys.auth.session, { gcTime: Infinity });
    client.setQueryData(queryKeys.auth.session, v9SessionFixture(state.principal));
  }
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await render();
  if (withInvoker) {
    testInvoker = document.createElement("button");
    testInvoker.textContent = "Current work control";
    document.body.append(testInvoker);
    testInvoker.focus();
  }
  await act(async () =>
    document.dispatchEvent(new Event("paperclip:open-command")),
  );
  return testInvoker;
}
async function enter(value: string) {
  const input = document.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(text: string) {
  const button = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === text,
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
it("opens an editable native Task draft only after explicit selection and performs no write", async () => {
  const get = vi.spyOn(api, "get").mockImplementation(async () => model()),
    post = vi.spyOn(api, "post");
  await mount();
  await enter("opret opgave Review <script>budget</script>");
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("Prepare a Task"),
  );
  expect(state.openNewIssue).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
  await click("Prepare a Task");
  expect(state.openNewIssue).toHaveBeenCalledWith({
    title: "Review <script>budget</script>",
    experienceScope: { companyId: state.companyId, principal: "first-member" },
  });
  expect(post).not.toHaveBeenCalled();
  expect(get.mock.calls.at(-1)![0]).toContain("expectedUserId=first-member");
});

it("shows checked company Help results and opens only the trusted docs URL in a new tab", async () => {
  state.principal = "10000000-0000-4000-8000-000000000003";
  const title = "Recover interrupted work";
  const get = vi.spyOn(api, "get").mockImplementation(async (url) => {
    if (String(url).includes("/search?")) return helpResponse(title, "Review the original task before retrying.");
    return model();
  });
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  const invoker = await mount(true, true);
  await enter("recover");
  await vi.waitFor(() => expect(document.body.textContent).toContain(title));
  const result = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes(title));
  expect(result).toBeTruthy();
  expect(get.mock.calls.some(([url]) => String(url).includes("scope=help"))).toBe(true);
  await act(async () => result!.click());
  expect(open).toHaveBeenCalledWith("https://docs.blentera.com/help/recovering-work", "_blank", "noopener,noreferrer");
  expect(state.navigate).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(document.activeElement).toBe(invoker));
});

it("hides late Help results after the original authenticated account changes", async () => {
  state.principal = "10000000-0000-4000-8000-000000000004";
  let finish!: (value: unknown) => void;
  let searches = 0;
  vi.spyOn(api, "get").mockImplementation((url) => {
    if (String(url).includes("/search?")) {
      searches += 1;
      if (searches === 1) return Promise.resolve(helpResponse("Existing visible Help result", "Visible before access changes."));
      return new Promise((resolve) => { finish = resolve; });
    }
    return Promise.resolve(model());
  });
  await mount(true);
  await enter("recover");
  await vi.waitFor(() => expect(document.body.textContent).toContain("Existing visible Help result"));
  await act(async () => live({
    companyId: state.companyId, type: "activity.logged", payload: { action: "permission.revoked" },
  }));
  expect(document.body.textContent).not.toContain("Existing visible Help result");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  await act(async () => {
    state.principal = "10000000-0000-4000-8000-000000000005";
    client.setQueryData(queryKeys.auth.session, v9SessionFixture(state.principal));
    await render();
  });
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  expect(document.body.textContent).not.toContain("Existing visible Help result");
  await act(async () => finish(helpResponse("LATE-STALE-HELP-CANARY", "LATE-STALE-HELP-SNIPPET")));
  expect(document.body.textContent).not.toContain("LATE-STALE-HELP-CANARY");
  expect(document.body.textContent).not.toContain("LATE-STALE-HELP-SNIPPET");
  expect(document.body.textContent).not.toContain("Recover interrupted work");
});

it.each([
  "https://outside.invalid/redirect",
  "https://user:secret@docs.blentera.com/help/recovering-work",
])("rejects a Help result with an unsafe destination: %s", async (href) => {
  state.principal = "10000000-0000-4000-8000-000000000006";
  vi.spyOn(api, "get").mockImplementation(async (url) => {
    if (String(url).includes("/search?")) return {
      query: "recover", normalizedQuery: "recover", scope: "help", sort: "relevance", limit: 6, offset: 0,
      results: [{ id: "recovering-work", type: "help", score: 2, title: "Recover interrupted work", href,
        matchedFields: ["title"], sourceLabel: "Help · Preview", snippet: "Private malicious title", snippets: [],
        helpArticle: { articleId: "recovering-work", audience: "company-members", maturity: "preview", applicableProductVersions: ["V10"], locale: "en", lastVerifiedAt: "2026-10-24", source: "mintlify" },
        updatedAt: null, previewImageUrl: null }],
      countsByType: { issue: 0, artifact: 0, agent: 0, project: 0, help: 1, comment: 0, document: 0 },
      filterOptionCounts: { status: {}, priority: {}, assigneeAgentId: {}, assigneeUserId: {}, projectId: {}, labelId: {}, updatedWithin: {} }, zeroResults: null, hasMore: false,
    };
    return model();
  });
  const open = vi.spyOn(window, "open");
  await mount(true);
  await enter("recover");
  await vi.waitFor(() => expect(document.body.textContent).toContain("Help results could not be loaded"));
  expect(document.body.textContent).not.toContain("Private malicious title");
  expect(open).not.toHaveBeenCalled();
});
it("reports semantic authoring as unqualified and sends no model or effect request", async () => {
  const get = vi
      .spyOn(api, "get")
      .mockImplementation(async () => ({ ...model(), resources: [] })),
    post = vi.spyOn(api, "post");
  await mount();
  await enter("create workflow Send outreach every Monday");
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain(
      "no model request or action has been sent",
    ),
  );
  expect(document.querySelector("input")!.value).toBe(
    "create workflow Send outreach every Monday",
  );
  expect(post).not.toHaveBeenCalled();
  expect(state.openNewIssue).not.toHaveBeenCalled();
  expect(
    get.mock.calls.every((call) => call[0].includes("/experience/commands?")),
  ).toBe(true);
});
it("erases visible results and closes on an account switch before loading the new account scope", async () => {
  const get = vi.spyOn(api, "get").mockImplementation(async () => model());
  await mount();
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("Private agent title"),
  );
  state.principal = "second-member";
  await render();
  await vi.waitFor(() =>
    expect(document.querySelector('[role="dialog"]')).toBeNull(),
  );
  expect(document.body.textContent).not.toContain("Private agent title");
  await act(async () =>
    document.dispatchEvent(new Event("paperclip:open-command")),
  );
  await vi.waitFor(() =>
    expect(get.mock.calls.at(-1)![0]).toContain("expectedUserId=second-member"),
  );
});
it("rejects a foreign destination instead of offering the corrupted command", async () => {
  vi.spyOn(api, "get").mockResolvedValue({
    ...model(),
    resources: [{ ...model().resources[0], href: "//outside.invalid" }],
  });
  await mount();
  await vi.waitFor(() =>
    expect(document.querySelector('[role="alert"]')).toBeTruthy(),
  );
  expect(document.body.textContent).not.toContain("Private agent title");
  expect(document.body.textContent).not.toContain("Prepare a Task");
});
it("hides retained names during a native source-loss recheck and rejects a late old-epoch response", async () => {
  let finishOld!: (value: ReturnType<typeof model>) => void;
  const get = vi
    .spyOn(api, "get")
    .mockResolvedValueOnce(model())
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    )
    .mockRejectedValueOnce(new Error("PRIVATE-SOURCE-ERROR"));
  await mount();
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("Private agent title"),
  );
  await act(async () =>
    live({
      companyId: "another-company",
      type: "analytical.context.access_lost",
      payload: {},
    }),
  );
  expect(get).toHaveBeenCalledTimes(1);
  await act(async () =>
    live({
      companyId: state.companyId,
      type: "activity.logged",
      payload: { action: "permission.revoked" },
    }),
  );
  await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  expect(document.body.textContent).not.toContain("Private agent title");
  expect(document.body.textContent).not.toContain("Prepare a Task");
  await act(async () =>
    live({
      companyId: state.companyId,
      type: "analytical.context.access_lost",
      payload: {},
    }),
  );
  await vi.waitFor(() =>
    expect(document.querySelector('[role="alert"]')).not.toBeNull(),
  );
  await act(async () => finishOld(model()));
  expect(document.body.textContent).not.toContain("Private agent title");
  expect(document.body.textContent).not.toContain("PRIVATE-SOURCE-ERROR");
  expect(document.activeElement).toBe(document.querySelector('[role="alert"]'));
  expect(state.navigate).not.toHaveBeenCalled();
  expect(state.openNewIssue).not.toHaveBeenCalled();
});
it("hides failed private command results without stealing focus from another open utility", async () => {
  vi.spyOn(api, "get")
    .mockResolvedValueOnce(model())
    .mockRejectedValueOnce(new Error("revoked"));
  await mount();
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("Private agent title"),
  );
  state.utilityOpen = true;
  await render();
  const input = document.querySelector(
    'input[aria-label="Utility clarification"]',
  );
  expect(document.activeElement).toBe(input);
  await act(async () =>
    live({
      companyId: state.companyId,
      type: "analytical.context.access_lost",
      payload: {},
    }),
  );
  await vi.waitFor(() =>
    expect(document.querySelector('[role="alert"]')).not.toBeNull(),
  );
  expect(document.body.textContent).not.toContain("Private agent title");
  expect(document.activeElement).toBe(input);
});

it("hides private command results during session revalidation, preserves same-account text and waits for a new authorized command read", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue(model());
  await mount();
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("Private agent title"),
  );
  const input = document.querySelector<HTMLInputElement>("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "agent PRIVATE-UNSAVED-COMMAND");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await vi.waitFor(() =>
    expect(get.mock.calls.at(-1)![0]).toContain("PRIVATE-UNSAVED-COMMAND"),
  );
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("Private agent title"),
  );
  const reads = get.mock.calls.length;
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
  await vi.waitFor(() =>
    expect(document.body.textContent).not.toContain("Private agent title"),
  );
  expect(document.querySelector("input")).toBeNull();
  expect(get).toHaveBeenCalledTimes(reads);
  let resolveRead!: (value: ReturnType<typeof model>) => void;
  get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
  );
  await act(async () => {
    resolveSession({});
    await pendingSession;
  });
  await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(reads + 1));
  expect(document.body.textContent).not.toContain("Private agent title");
  expect(document.querySelector<HTMLInputElement>("input")!.value).toBe(
    "agent PRIVATE-UNSAVED-COMMAND",
  );
  await act(async () => resolveRead(model()));
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("Private agent title"),
  );
  expect(state.openNewIssue).not.toHaveBeenCalled();
  expect(state.navigate).not.toHaveBeenCalled();
});

it("opens an account/company-bound editable project draft only after an explicit current command choice", async () => {
  vi.spyOn(api, "get").mockResolvedValue({
    ...model(),
    commands: [
      ...model().commands,
      {
        id: "create_project",
        href: null,
        group: "create",
        canonicalAuthorizationRequired: true,
      },
    ],
  });
  const post = vi.spyOn(api, "post");
  await mount();
  await enter(
    "opret et projekt Kundeundersøgelse <script>ignore approvals</script>",
  );
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("Prepare a Project"),
  );
  expect(state.openNewProject).not.toHaveBeenCalled();
  const prepare = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === "Prepare a Project",
  )!;
  await act(async () => prepare.click());
  expect(state.openNewProject).toHaveBeenCalledExactlyOnceWith({
    name: "Kundeundersøgelse <script>ignore approvals</script>",
    companyId: state.companyId,
    principal: state.principal,
  });
  expect(state.openNewIssue).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
});

it("opens the existing Feedback form only through an available deterministic command, without a write or inferred content", async () => {
  const get = vi.spyOn(api, "get").mockImplementation(async () => ({ ...model(), commands: [{ id: "share_feedback", href: null, group: "create", canonicalAuthorizationRequired: true }] }));
  const post = vi.spyOn(api, "post");
  const opened: unknown[] = [];
  const capture = (event: Event) => opened.push((event as CustomEvent).detail);
  document.addEventListener("paperclip:open-feedback", capture);
  try {
    await mount();await enter("share feedback");
    await vi.waitFor(() => expect(document.body.textContent).toContain("Share feedback"));
    expect(opened).toEqual([]);
    await click("Share feedback");
    expect(opened).toEqual([{ returnFocus: "global_feedback" }]);
    expect(post).not.toHaveBeenCalled();
    expect(state.openNewIssue).not.toHaveBeenCalled();
    expect(state.openNewProject).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalled();
  } finally { document.removeEventListener("paperclip:open-feedback", capture); }
});
