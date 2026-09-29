// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowDetail, WorkflowRunDetail, WorkflowRevision } from "@paperclipai/shared";
import { WorkflowRun } from "./WorkflowRun";

const apiMock = vi.hoisted(() => ({
  cancelRun: vi.fn(),
  get: vi.fn(),
  getRun: vi.fn(),
  revisions: vi.fn(),
}));

vi.mock("@/api/workflows", () => ({ workflowsApi: apiMock }));
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "company-1" }),
}));
vi.mock("@/context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }),
}));

const revision: WorkflowRevision = {
  id: "revision-1",
  companyId: "company-1",
  workflowId: "workflow-1",
  revisionNumber: 3,
  state: "published",
  graph: {
    version: 1,
    nodes: [
      {
        id: "start",
        type: "core.manual_trigger",
        name: "Manual Trigger",
        position: { x: 0, y: 0 },
        config: {},
      },
    ],
    edges: [],
    variables: [],
    settings: {},
  },
  inputSchema: null,
  outputSchema: null,
  changeSummary: null,
  createdByUserId: "user-1",
  createdByAgentId: null,
  createdByRunId: null,
  createdAt: new Date("2026-09-28T12:00:00Z"),
};

const workflow: WorkflowDetail = {
  id: "workflow-1",
  companyId: "company-1",
  projectId: null,
  folderId: null,
  name: "Lead qualification",
  description: null,
  status: "active",
  publishedRevisionId: revision.id,
  draftRevisionId: null,
  createdByUserId: "user-1",
  createdByAgentId: null,
  createdAt: new Date("2026-09-28T11:00:00Z"),
  updatedAt: new Date("2026-09-28T12:00:00Z"),
  archivedAt: null,
  draftRevision: null,
  publishedRevision: revision,
};

const runDetail: WorkflowRunDetail = {
  run: {
    id: "run-12345678",
    companyId: "company-1",
    workflowId: "workflow-1",
    workflowRevisionId: revision.id,
    triggerId: null,
    status: "succeeded",
    source: "manual",
    triggerPayload: { customerId: "acme" },
    responsibleUserId: "user-1",
    idempotencyKey: "run-key",
    correlationId: "correlation-1",
    executionOwnerId: null,
    leaseExpiresAt: null,
    ownerHeartbeatAt: null,
    startedAt: new Date("2026-09-28T12:01:00Z"),
    finishedAt: new Date("2026-09-28T12:01:01Z"),
    failureCode: null,
    failureMessage: null,
    createdAt: new Date("2026-09-28T12:01:00Z"),
    updatedAt: new Date("2026-09-28T12:01:01Z"),
  },
  steps: [
    {
      id: "step-1",
      companyId: "company-1",
      workflowRunId: "run-12345678",
      nodeId: "start",
      attempt: 1,
      status: "succeeded",
      inputJson: { customerId: "acme" },
      outputJson: { accepted: true },
      startedAt: new Date("2026-09-28T12:01:00Z"),
      finishedAt: new Date("2026-09-28T12:01:01Z"),
      durationMs: 1000,
      agentId: null,
      heartbeatRunId: null,
      toolInvocationId: null,
      automationArtifactVersionId: null,
      errorCode: null,
      errorMessage: null,
      createdAt: new Date("2026-09-28T12:01:00Z"),
      updatedAt: new Date("2026-09-28T12:01:01Z"),
    },
  ],
  waits: [],
};

async function flush() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  flushSync(() => {});
}

describe("WorkflowRun", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    apiMock.get.mockResolvedValue(workflow);
    apiMock.getRun.mockResolvedValue(runDetail);
    apiMock.revisions.mockResolvedValue([revision]);
  });

  afterEach(() => {
    container.remove();
    vi.clearAllMocks();
  });

  it("shows a linear attempt-level execution log for the immutable revision", async () => {
    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    flushSync(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/workflows/workflow-1/runs/run-12345678"]}>
            <Routes>
              <Route
                path="/workflows/:workflowId/runs/:runId"
                element={<WorkflowRun />}
              />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await flush();

    expect(container.textContent).toContain("Completed");
    expect(container.textContent).toContain("1 / 1 steps completed");
    expect(container.textContent).toContain("Revision 3");
    expect(container.textContent).toContain("Manual Trigger");
    expect(container.textContent).toContain("Attempt 1 · Workflow engine");
    expect(container.textContent).toContain("Execution log");
    expect(container.textContent).toContain("Input");
    expect(container.textContent).toContain("Output");

    flushSync(() => root.unmount());
  });
  it("distinguishes a durable system wait and shows when a delay resumes", async () => {
    const wakeAt = new Date("2026-09-28T12:05:00Z");
    apiMock.getRun.mockResolvedValue({
      ...runDetail,
      run: {
        ...runDetail.run,
        status: "waiting",
        finishedAt: null,
      },
      steps: [
        ...runDetail.steps,
        {
          ...runDetail.steps[0]!,
          id: "step-wait",
          nodeId: "delay",
          status: "waiting",
          outputJson: null,
          finishedAt: null,
          durationMs: null,
        },
      ],
      waits: [
        {
          id: "wait-1",
          companyId: "company-1",
          workflowRunId: runDetail.run.id,
          nodeId: "delay",
          waitKey: "primary",
          kind: "delay",
          status: "active",
          wakeAt,
          timeoutAt: null,
          referenceType: null,
          referenceId: null,
          signalTokenHash: null,
          resolutionJson: null,
          resolvedByType: null,
          resolvedById: null,
          resolvedAt: null,
          createdAt: new Date("2026-09-28T12:01:01Z"),
          updatedAt: new Date("2026-09-28T12:01:01Z"),
        },
      ],
    });

    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    flushSync(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/workflows/workflow-1/runs/run-12345678"]}>
            <Routes>
              <Route
                path="/workflows/:workflowId/runs/:runId"
                element={<WorkflowRun />}
              />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await flush();

    expect(container.textContent).toContain("Waiting on system");
    expect(container.textContent).toContain("Resumes automatically after");
    expect(container.textContent).not.toContain("Human waitpoints are not enabled");

    flushSync(() => root.unmount());
  });

  it("labels an External Agent wait as governed OpenClaw system work", async () => {
    apiMock.getRun.mockResolvedValue({
      ...runDetail,
      run: {
        ...runDetail.run,
        status: "waiting",
        finishedAt: null,
      },
      steps: [
        {
          ...runDetail.steps[0]!,
          id: "step-external",
          nodeId: "external",
          status: "waiting",
          agentId: "openclaw-agent-1",
          heartbeatRunId: "heartbeat-1",
          outputJson: {
            status: "waiting",
            issueId: "issue-1",
            agentId: "openclaw-agent-1",
            heartbeatRunId: "heartbeat-1",
          },
          finishedAt: null,
          durationMs: null,
        },
      ],
      waits: [
        {
          id: "wait-external",
          companyId: "company-1",
          workflowRunId: runDetail.run.id,
          nodeId: "external",
          waitKey: "primary",
          kind: "external_agent_run",
          status: "active",
          wakeAt: null,
          timeoutAt: new Date("2026-09-28T12:05:00Z"),
          referenceType: "issue",
          referenceId: "issue-1",
          signalTokenHash: null,
          resolutionJson: null,
          resolvedByType: null,
          resolvedById: null,
          resolvedAt: null,
          createdAt: new Date("2026-09-28T12:01:01Z"),
          updatedAt: new Date("2026-09-28T12:01:01Z"),
        },
      ],
    });

    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    flushSync(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter
            initialEntries={[
              "/workflows/workflow-1/runs/run-12345678",
            ]}
          >
            <Routes>
              <Route
                path="/workflows/:workflowId/runs/:runId"
                element={<WorkflowRun />}
              />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await flush();

    expect(container.textContent).toContain("Waiting on system");
    expect(container.textContent).toContain(
      "Waiting for the external OpenClaw agent run to finish.",
    );
    expect(container.textContent).toContain("Attempt 1 · Agent");

    flushSync(() => root.unmount());
  });

  it("requests governed cancellation for a live run and renders the returned state", async () => {
    const waitingDetail: WorkflowRunDetail = {
      ...runDetail,
      run: {
        ...runDetail.run,
        status: "waiting",
        finishedAt: null,
      },
      steps: [
        {
          ...runDetail.steps[0]!,
          id: "step-waiting",
          nodeId: "delay",
          status: "waiting",
          finishedAt: null,
          durationMs: null,
        },
      ],
      waits: [
        {
          id: "wait-cancel",
          companyId: "company-1",
          workflowRunId: runDetail.run.id,
          nodeId: "delay",
          waitKey: "primary",
          kind: "delay",
          status: "active",
          wakeAt: new Date("2026-09-28T13:00:00Z"),
          timeoutAt: null,
          referenceType: null,
          referenceId: null,
          signalTokenHash: null,
          resolutionJson: null,
          resolvedByType: null,
          resolvedById: null,
          resolvedAt: null,
          createdAt: new Date("2026-09-28T12:01:01Z"),
          updatedAt: new Date("2026-09-28T12:01:01Z"),
        },
      ],
    };
    const cancelledDetail: WorkflowRunDetail = {
      ...waitingDetail,
      run: {
        ...waitingDetail.run,
        status: "cancelled",
        finishedAt: new Date("2026-09-28T12:02:00Z"),
      },
      steps: waitingDetail.steps.map((step) => ({
        ...step,
        status: "cancelled" as const,
        finishedAt: new Date("2026-09-28T12:02:00Z"),
        errorCode: "workflow_parent_cancelled",
        errorMessage: "Cancelled by operator from workflow run view",
      })),
      waits: waitingDetail.waits.map((wait) => ({
        ...wait,
        status: "cancelled" as const,
        resolutionJson: {
          status: "cancelled",
          errorCode: "workflow_parent_cancelled",
          reason: "Cancelled by operator from workflow run view",
          parentCancellation: true,
        },
        resolvedByType: "user",
        resolvedById: "user-1",
        resolvedAt: new Date("2026-09-28T12:02:00Z"),
      })),
    };
    apiMock.getRun.mockResolvedValue(waitingDetail);
    apiMock.cancelRun.mockResolvedValue(cancelledDetail);

    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    flushSync(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter
            initialEntries={["/workflows/workflow-1/runs/run-12345678"]}
          >
            <Routes>
              <Route
                path="/workflows/:workflowId/runs/:runId"
                element={<WorkflowRun />}
              />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await flush();

    const cancelTrigger = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Cancel run"),
    );
    expect(cancelTrigger).toBeDefined();
    cancelTrigger!.click();
    await flush();

    expect(document.body.textContent).toContain("Cancel this workflow run?");
    expect(document.body.textContent).toContain(
      "Completed side effects are preserved rather than rolled back.",
    );

    const confirmButton = Array.from(document.querySelectorAll("button")).find(
      (button) =>
        button.textContent?.trim() === "Cancel run" &&
        button !== cancelTrigger,
    );
    expect(confirmButton).toBeDefined();
    confirmButton!.click();
    await flush();

    expect(apiMock.cancelRun).toHaveBeenCalledWith(
      "company-1",
      "run-12345678",
      { reason: "Cancelled by operator from workflow run view" },
    );
    expect(container.textContent).toContain("Cancelled");
    expect(container.textContent).toContain(
      "Completed step history remains visible for audit and recovery.",
    );

    flushSync(() => root.unmount());
  });


});
