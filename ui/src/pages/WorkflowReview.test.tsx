// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WorkflowExperience } from "@paperclipai/shared";
import { workflowsApi } from "../api/workflows";
import { WorkflowReview } from "./WorkflowReview";
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
async function mount(principal = "member") {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
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
