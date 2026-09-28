// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowDetail, WorkflowRunDetail, WorkflowRevision } from "@paperclipai/shared";
import { WorkflowRun } from "./WorkflowRun";

const apiMock = vi.hoisted(() => ({
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
});
