// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WorkflowExperience } from "@paperclipai/shared";
import { workflowsApi } from "../api/workflows";
import { WorkflowReview } from "./WorkflowReview";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import "../i18n";

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
  useCompany: () => ({
    selectedCompanyId: "10000000-0000-4000-8000-000000000001",
    selectedCompany: { issuePrefix: "AW" },
  }),
}));
vi.mock("./WorkflowBuilder", () => ({ WorkflowBuilder: () => null }));
const data: WorkflowExperience = {
  companyId: "10000000-0000-4000-8000-000000000001",
  id: "10000000-0000-4000-8000-000000000002",
  name: "Review opportunities",
  description: null,
  status: "active",
  canEdit: true,
  canOperate: false,
  canRequestTest: false,
  testAvailability: "review_required",
  testDeadlineSeconds: null,
  testReceipt: null,
  canRequestRun: false,
  runAvailability: "review_required",
  updatedAt: "2026-10-09T10:00:00.000Z",
  comparison: {
    state: "available",
    steps: [{ number: 1, change: "changed" }],
    removedSteps: 1,
    connectionsChanged: true,
    dataDefinitionChanged: true,
    settingsChanged: false,
  },
  active: {
    id: "10000000-0000-4000-8000-000000000003",
    version: 2,
    state: "published",
    coverage: "complete",
    steps: [
      {
        number: 1,
        name: "Ask owner",
        operation: "Human Approval",
        effect: "write",
        testMode: "safe",
        approval: "checkpoint",
        retry: "none",
        next: [],
      },
    ],
  },
  draft: {
    id: "10000000-0000-4000-8000-000000000004",
    version: 3,
    state: "draft",
    coverage: "complete",
    steps: [
      {
        number: 1,
        name: "Proposed step",
        operation: "Unknown operation",
        effect: "unknown",
        testMode: "unavailable",
        approval: "not_verified",
        retry: "unknown",
        next: [],
      },
    ],
  },
};
let root: Root, container: HTMLDivElement, client: QueryClient;
beforeEach(() => {
  vi.spyOn(workflowsApi, "operations").mockResolvedValue({
    companyId: data.companyId,
    workflowId: data.id,
    updatedAt: data.updatedAt,
    publishedRevisionId: data.active!.id,
    status: "active",
    nextTrigger: { state: "request_or_event" },
    recent: { runs: [], hasMore: false },
    blockers: { runs: [], hasMore: false },
  });
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  client?.clear();
  container?.remove();
  vi.restoreAllMocks();
});
async function mount(principal = "member", entry = "/") {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.auth.session, v9SessionFixture(principal));
  vi.spyOn(authApi, "getSession").mockResolvedValue(v9SessionFixture(principal));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[entry]}>
          <WorkflowReview
            company={data.companyId}
            principal={principal}
            id={data.id}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
}
it("keeps active and draft views separate, names unverified policy and only links native actions", async () => {
  const get = vi.spyOn(workflowsApi, "experience").mockResolvedValue(data);
  const publish = vi.spyOn(workflowsApi, "publish");
  const run = vi.spyOn(workflowsApi, "startRun");
  await mount();
  await vi.waitFor(() => expect(container.textContent).toContain("Ask owner"));
  expect(get).toHaveBeenCalledWith(
    data.companyId,
    "member",
    data.id,
    expect.any(AbortSignal),
  );
  expect(container.textContent).not.toContain("Proposed step");
  expect(container.textContent).not.toContain("Draft changes compared");
  expect(container.textContent).toContain("No approval decision is confirmed");
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Draft version 3")!
      .click(),
  );
  expect(container.textContent).toContain("Proposed step");
  expect(container.textContent).toContain(
    "Draft changes compared with active version 2",
  );
  expect(container.textContent).toContain("Changed step 1");
  expect(container.textContent).toContain("1 step removed");
  expect(container.textContent).toContain(
    "Connections or branch declarations changed",
  );
  expect(container.querySelector('a[href="#workflow-step-1"]')).not.toBeNull();
  expect(container.textContent).not.toContain("Ask owner");
  expect(container.textContent).toContain(
    "Effective approval policy has not been verified",
  );
  expect(container.textContent).toContain(
    "does not change the active workflow",
  );
  expect(
    [...container.querySelectorAll("a")].map((link) =>
      link.getAttribute("href"),
    ),
  ).toEqual([
    "/AW/workflows",
    `/AW/workflows/${data.id}/draft`,
    "#workflow-step-1",
    `/AW/workflows/${data.id}/advanced`,
    `/AW/workflows/${data.id}/runs`,
  ]);
  expect(publish).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
  expect(container.querySelector("h1")?.textContent).toBe(data.name);
  expect(container.querySelector("main")).toBeNull();
});
it("labels an unpublished native active record as a draft and distinguishes incomplete flow", async () => {
  vi.spyOn(workflowsApi, "experience").mockResolvedValue({
    ...data,
    status: "draft",
    active: null,
    comparison: null,
    canEdit: false,
    draft: { ...data.draft!, coverage: "flow_unavailable", steps: [] },
  });
  await mount();
  await vi.waitFor(() =>
    expect(container.textContent).toContain(
      "Draft — no active published revision",
    ),
  );
  expect(container.textContent).toContain("cannot be shown completely");
  expect(container.textContent).not.toContain("has no steps yet");
  expect(container.textContent).not.toContain("Run history");
  expect(container.textContent).not.toContain("Edit draft in Advanced");
});
it("hides retained private prose immediately during a permission recheck and rejects a late old response", async () => {
  let resolveOld!: (value: WorkflowExperience) => void;
  let rejectNew!: (error: Error) => void;
  const get = vi
    .spyOn(workflowsApi, "experience")
    .mockResolvedValueOnce(data)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectNew = reject;
        }),
    );
  await mount();
  await vi.waitFor(() => expect(container.textContent).toContain(data.name));
  await act(async () => {
    live({
      companyId: data.companyId,
      type: "activity.logged",
      payload: { action: "workflow.draft_updated" },
    });
  });
  await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  expect(container.textContent).not.toContain(data.name);
  await act(async () => {
    live({
      companyId: data.companyId,
      type: "activity.logged",
      payload: { action: "permission.revoked" },
    });
  });
  await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(3));
  await act(async () => resolveOld({ ...data, name: "LATE PRIVATE RESULT" }));
  expect(container.textContent).not.toContain("LATE PRIVATE RESULT");
  await act(async () => rejectNew(new Error("permission denied")));
  await vi.waitFor(() =>
    expect(container.querySelector('[role="alert"]')).not.toBeNull(),
  );
  expect(container.textContent).not.toContain(data.name);
  expect(container.textContent).not.toContain("permission denied");
  expect(document.activeElement).toBe(
    container.querySelector('[role="alert"]'),
  );
});

it("rejects late operation metadata after native access loss hides the current parent", async () => {
  vi.spyOn(workflowsApi, "experience")
    .mockResolvedValueOnce(data)
    .mockRejectedValueOnce(new Error("PRIVATE ACCESS LOSS"));
  let finish!: (
    value: Awaited<ReturnType<typeof workflowsApi.operations>>,
  ) => void;
  const operations = vi
    .spyOn(workflowsApi, "operations")
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  await mount();
  await vi.waitFor(() => expect(operations).toHaveBeenCalledOnce());
  await act(async () =>
    live({
      companyId: data.companyId,
      type: "analytical.context.access_lost",
      payload: {},
    }),
  );
  await vi.waitFor(() =>
    expect(container.querySelector("[role=alert]")).not.toBeNull(),
  );
  await act(async () =>
    finish({
      companyId: data.companyId,
      workflowId: data.id,
      updatedAt: data.updatedAt,
      publishedRevisionId: data.active!.id,
      status: "active",
      nextTrigger: { state: "scheduled", at: "2026-10-10T08:00:00.000Z" },
      recent: { runs: [], hasMore: false },
      blockers: { runs: [], hasMore: false },
    }),
  );
  expect(container.textContent).not.toContain("Operation overview");
  expect(container.textContent).not.toContain("Next scheduled request");
  expect(container.textContent).not.toContain("PRIVATE ACCESS LOSS");
});

it("withholds current workflow prose when the original session cache is invalidated", async () => {
  vi.spyOn(workflowsApi, "experience").mockResolvedValue(data);
  await mount();
  await vi.waitFor(() => expect(container.textContent).toContain(data.name));
  await act(async () => { await client.invalidateQueries({ queryKey: queryKeys.auth.session, exact: true, refetchType: "none" }); });
  expect(container.textContent).not.toContain(data.name);
  expect(container.textContent).not.toContain("Operation overview");
});

it("rejects a private workflow response completed after the current account changes", async () => {
  let finish!: (value: WorkflowExperience) => void;
  const get = vi.spyOn(workflowsApi, "experience").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount();
  await vi.waitFor(() => expect(get).toHaveBeenCalledOnce());
  await act(async () => {
    client.setQueryData(queryKeys.auth.session, v9SessionFixture("another-account"));
    finish({ ...data, name: "LATE PRIVATE WORKFLOW" });
  });
  expect(container.textContent).not.toContain("LATE PRIVATE WORKFLOW");
  expect(container.textContent).not.toContain("Operation overview");
  expect(get).toHaveBeenCalledOnce();
});

it("does not take utility focus when the first current workflow read completes", async () => {
  let finish!: (value: WorkflowExperience) => void;
  vi.spyOn(workflowsApi, "experience").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount();
  const utility = document.createElement("select"); document.body.append(utility); utility.focus();
  try {
    await act(async () => finish(data));
    await vi.waitFor(() => expect(container.textContent).toContain(data.name));
    expect(document.activeElement).toBe(utility);
  } finally { utility.remove(); }
});

it("keeps an unavailable comparison separate from an unchanged-flow result", async () => {
  vi.spyOn(workflowsApi, "experience").mockResolvedValue({
    ...data,
    comparison: { state: "unavailable" },
  });
  await mount();
  await vi.waitFor(() => expect(container.textContent).toContain(data.name));
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Draft version 3")!
      .click(),
  );
  expect(container.textContent).toContain("cannot be compared completely");
  expect(container.textContent).not.toContain("No changes found");
  expect(container.querySelector('a[href="#workflow-step-1"]')).toBeNull();
});

vi.mock("../components/WorkflowPublicationControls", () => ({ WorkflowPublicationControls: () => null }));

it("returns from editing to the current draft review while preserving the active version as a separate choice", async () => {
  vi.spyOn(workflowsApi, "experience").mockResolvedValue(data);
  await mount("member", `/workflows/${data.id}?revision=draft`);
  await vi.waitFor(() => expect(container.textContent).toContain("Proposed step"));
  expect(container.textContent).not.toContain("Ask owner");
  expect(container.querySelector(`a[href$="/workflows/${data.id}/draft"]`)).toBeTruthy();
  const active = [...container.querySelectorAll("button")].find(button => button.textContent?.includes("Active version 2"))!;
  expect(active).toBeTruthy(); await act(async () => active.click());
  expect(container.textContent).toContain("Ask owner");
});

it("explains selected actors, input, approval and duplicate protection while current Source changes withhold the complete private review", async () => {
  const view = structuredClone(data), step = view.active!.steps[0];
  step.semantics = { actor: "selected_agent", input: "task_brief", durationSeconds: null,
    approvalPolicy: "execution_review", access: "execution_check", maxAttempts: 3, idempotency: "workflow_step_key" };
  step.assignment = { state: "current", name: "PRIVATE selected analyst" };
  vi.spyOn(workflowsApi, "experience").mockResolvedValue(view);
  await mount();
  await vi.waitFor(() => expect(container.textContent).toContain("PRIVATE selected analyst"));
  expect(container.textContent).toContain("configured task brief");
  expect(container.textContent).toContain("Current access has not been verified here");
  expect(container.textContent).toContain("At most 3 attempts, including the first attempt");
  expect(container.textContent).toContain("Retries reuse the original workflow-step operation key");
  await act(async () => live({ companyId: data.companyId, type: "activity.logged",
    payload: { action: "agent.updated", entityType: "agent", entityId: "changed-agent" } }));
  expect(container.textContent).not.toContain("PRIVATE selected analyst");
});

it("puts missing current connection permission and its Original preview at the exact step without offering a grant or execution", async () => {
  const view = structuredClone(data), step = view.active!.steps[0];
  step.semantics = { actor: "connected_tool", input: "tool_arguments", durationSeconds: null,
    approvalPolicy: "execution_review", access: "execution_check", maxAttempts: 1, idempotency: "provider_passthrough" };
  const previewHref = "/apps/10000000-0000-4000-8000-000000000009/permissions";
  step.toolAccess = { state: "permission_required", connectionName: "PRIVATE Contact system", operationName: "Find contacts", previewHref };
  const post = vi.spyOn(workflowsApi, "startRun");
  vi.spyOn(workflowsApi, "experience").mockResolvedValue(view);
  await mount();
  await vi.waitFor(() => expect(container.textContent).toContain("PRIVATE Contact system"));
  const item = container.querySelector("#workflow-step-1")!;
  expect(item.textContent).toContain("Find contacts");
  expect(item.textContent).toContain("Your current account lacks permission");
  expect(item.querySelector(`a[href$="${previewHref}"]`)?.textContent).toBe("Review PRIVATE Contact system permissions");
  expect(post).not.toHaveBeenCalled();
  await act(async () => live({ companyId: data.companyId, type: "activity.logged",
    payload: { action: "tool_connection.updated", entityType: "tool_connection", entityId: "changed-connection" } }));
  expect(container.textContent).not.toContain("PRIVATE Contact system");
});

it("keeps exact typed condition fields readable and hides private input material on current Source withdrawal", async () => {
  const view = structuredClone(data), step = view.active!.steps[0];
  step.operation = "Condition"; step.approval = "not_verified"; step.effect = "pure";
  step.semantics = { actor: "workflow", input: "condition_data", durationSeconds: null,
    approvalPolicy: "no_checkpoint", access: "no_step_grant", maxAttempts: 1, idempotency: "not_required" };
  step.inputReview = { kind: "condition", source: "trigger", path: ["customer.name", "answer"], operator: "===", value: "PRIVATE false " };
  vi.spyOn(workflowsApi, "experience").mockResolvedValue(view);
  await mount();
  await vi.waitFor(() => expect(container.textContent).toContain('"PRIVATE false "'));
  const fields = container.querySelector('ol[aria-label="Field names, from outermost to innermost"]')!;
  expect([...fields.querySelectorAll("li")].map(item => item.textContent)).toEqual(['"customer.name"', '"answer"']);
  expect(container.textContent).toContain('Text: "PRIVATE false "');
  await act(async () => live({ companyId: data.companyId, type: "analytical.context.access_lost", payload: {} }));
  expect(container.textContent).not.toContain("PRIVATE false");
  expect(container.textContent).not.toContain("customer.name");
});

it("withdraws derived schedule metadata when its Native routine changes", async () => {
  vi.mocked(workflowsApi.operations).mockResolvedValue({ companyId: data.companyId, workflowId: data.id,
    updatedAt: data.updatedAt, publishedRevisionId: data.active!.id, status: "active",
    nextTrigger: { state: "scheduled", at: "2099-01-01T08:00:00Z" }, recent: { runs: [], hasMore: false }, blockers: { runs: [], hasMore: false } });
  vi.spyOn(workflowsApi, "experience").mockResolvedValue(data);
  await mount();
  await vi.waitFor(() => expect(container.textContent).toContain("2099"));
  await act(async () => live({ companyId: data.companyId, type: "activity.logged",
    payload: { action: "routine.updated", entityType: "routine", entityId: "changed-routine" } }));
  expect(container.textContent).not.toContain("2099");
});
it("withdraws retained private workflow names while an original conversation issue update is rechecked", async () => {
  const get = vi.spyOn(workflowsApi, "experience").mockResolvedValue(data);
  await mount(); await vi.waitFor(() => expect(container.textContent).toContain(data.name));
  get.mockImplementation(() => new Promise(() => {}));
  await act(async () => live({ companyId: data.companyId, type: "activity.logged", payload: { action: "issue.updated", entityType: "issue" } }));
  expect(container.textContent).not.toContain(data.name);
});

it("reviews named saved tool values including false, empty text and omission, withdrawing them with the Native connection Source", async () => {
  const view = structuredClone(data), step = view.active!.steps[0];
  const field = (name: string, type: "string" | "boolean" | "integer") => ({ name, label: `PRIVATE ${name}`, help: null,
    type, required: false, options: null, minLength: null, maxLength: null, minimum: null, maximum: null });
  step.semantics = { actor: "connected_tool", input: "tool_arguments", durationSeconds: null,
    approvalPolicy: "execution_review", access: "execution_check", maxAttempts: 1, idempotency: "provider_passthrough" };
  step.toolAccess = { state: "permission_required", connectionName: "Contact system", operationName: "Find contacts", previewHref: "/apps/10000000-0000-4000-8000-000000000001/permissions" };
  step.inputReview = { kind: "connected_tool", inputSchemaHash: "a".repeat(64), fields: [field("query", "string"), field("enabled", "boolean"), field("empty", "string"), field("count", "integer")],
    values: { query: " PRIVATE literal ", enabled: false, empty: "" } };
  const get = vi.spyOn(workflowsApi, "experience").mockResolvedValue(view), post = vi.spyOn(workflowsApi, "startRun");
  await mount(); await vi.waitFor(() => expect(container.textContent).toContain('" PRIVATE literal "'));
  const item = container.querySelector("#workflow-step-1")!;
  expect(item.textContent).toContain("PRIVATE enabled");
  expect([...item.querySelectorAll("dt")].find(node => node.textContent === "PRIVATE enabled")?.nextElementSibling?.textContent).toBe("No");
  expect(item.textContent).toContain("Not included"); expect(item.textContent).toContain("Empty text");
  expect(item.textContent).toContain("This review does not run the operation or grant access");
  expect(post).not.toHaveBeenCalled(); get.mockImplementation(() => new Promise(() => {}));
  await act(async () => live({ companyId: data.companyId, type: "activity.logged", payload: { action: "tool_connection.updated", entityType: "tool_connection" } }));
  expect(container.textContent).not.toContain("PRIVATE literal"); expect(container.textContent).not.toContain("PRIVATE enabled");
});
