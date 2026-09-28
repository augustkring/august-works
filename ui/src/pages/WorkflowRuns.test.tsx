// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowDetail, WorkflowRun } from "@paperclipai/shared";
import { WorkflowRuns } from "./WorkflowRuns";

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  listRuns: vi.fn(),
}));

vi.mock("@/api/workflows", () => ({ workflowsApi: apiMock }));
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "company-1" }),
}));
vi.mock("@/context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }),
}));

const workflow: WorkflowDetail = {
  id: "workflow-1",
  companyId: "company-1",
  projectId: null,
  folderId: null,
  name: "Lead qualification",
  description: null,
  status: "active",
  publishedRevisionId: "revision-1",
  draftRevisionId: null,
  createdByUserId: "user-1",
  createdByAgentId: null,
  createdAt: new Date("2026-09-28T11:00:00Z"),
  updatedAt: new Date("2026-09-28T12:00:00Z"),
  archivedAt: null,
  draftRevision: null,
  publishedRevision: null,
};

const run: WorkflowRun = {
  id: "run-12345678",
  companyId: "company-1",
  workflowId: "workflow-1",
  workflowRevisionId: "revision-1",
  triggerId: null,
  status: "succeeded",
  source: "manual",
  triggerPayload: {},
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
};

async function flush() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  flushSync(() => {});
}

describe("WorkflowRuns", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    apiMock.get.mockResolvedValue(workflow);
    apiMock.listRuns.mockResolvedValue([run]);
  });

  afterEach(() => {
    container.remove();
    vi.clearAllMocks();
  });

  it("renders durable run history with visible outcome and revision identity", async () => {
    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    flushSync(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/workflows/workflow-1/runs"]}>
            <Routes>
              <Route path="/workflows/:workflowId/runs" element={<WorkflowRuns />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await flush();

    expect(container.textContent).toContain("Runs");
    expect(container.textContent).toContain("Lead qualification");
    expect(container.textContent).toContain("Completed");
    expect(container.textContent).toContain("manual");
    expect(container.textContent).toContain("run-1234");
    expect(container.textContent).toContain("revision");

    flushSync(() => root.unmount());
  });
});
