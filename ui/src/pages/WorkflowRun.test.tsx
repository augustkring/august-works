// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowDetail, WorkflowRunDetail, WorkflowRevision } from "@paperclipai/shared";
import { WorkflowRun } from "./WorkflowRun";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import { i18n } from "../i18n";

const apiMock = vi.hoisted(() => ({
  cancelRun: vi.fn(),
  startRun: vi.fn(),
  startTaskRun: vi.fn(),
  retryRun: vi.fn(),
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
  let continuationRoot: ReturnType<typeof createRoot> | null = null;
  let continuationClient: QueryClient | null = null;

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    vi.spyOn(authApi, "getSession").mockResolvedValue(v9SessionFixture("user-1"));
    apiMock.startRun.mockReset(); apiMock.startTaskRun.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    apiMock.get.mockResolvedValue(workflow);
    apiMock.getRun.mockResolvedValue(runDetail);
    apiMock.revisions.mockResolvedValue([revision]);
  });

  afterEach(() => {
    if (continuationRoot) flushSync(() => continuationRoot!.unmount());
    continuationRoot = null;
    continuationClient?.clear(); continuationClient = null;
    container.remove();
    vi.clearAllMocks(); vi.restoreAllMocks();
  });

  function childWait(source: "manual" | "task" = "manual"): WorkflowRunDetail {
    return { ...runDetail, run: { ...runDetail.run, status: "waiting", finishedAt: null, source,
      executionPrincipal: { type: "user", userId: "user-1" }, executionAgentRunId: null,
      humanCoverageId: "10000000-0000-4000-8000-000000000001",
      triggerPayload: { customerId: "acme", ...(source === "task" ? { task: { id: "task-1", title: "Original Task input", status: "backlog" } } : {}) },
    }, steps: [{ ...runDetail.steps[0]!, nodeId: "child", status: "waiting", outputJson: null, finishedAt: null }],
      waits: [{ id: "child-wait", companyId: "company-1", workflowRunId: runDetail.run.id,
        nodeId: "child", waitKey: "child", kind: "subworkflow", status: "active", wakeAt: null, timeoutAt: null,
        referenceType: "workflow_run", referenceId: "original-child", signalTokenHash: null, resolutionJson: null,
        resolvedByType: null, resolvedById: null, resolvedAt: null, createdAt: new Date(), updatedAt: new Date() }] };
  }

  async function showContinuation(detail: WorkflowRunDetail, userId = "user-1", localImplicit = false) {
    apiMock.getRun.mockResolvedValue(detail);
    vi.mocked(authApi.getSession).mockResolvedValue(v9SessionFixture(userId, localImplicit));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    client.setQueryData(queryKeys.auth.session, v9SessionFixture(userId, localImplicit));
    continuationClient = client; continuationRoot = createRoot(container);
    flushSync(() => continuationRoot!.render(<QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/workflows/workflow-1/runs/run-12345678"]}>
        <Routes><Route path="/workflows/:workflowId/runs/:runId" element={<WorkflowRun />} /></Routes>
      </MemoryRouter></QueryClientProvider>));
    await flush(); return client;
  }

  const continueButton = () => Array.from(container.querySelectorAll("button")).find(button =>
    ["Continue existing run", "Fortsæt eksisterende kørsel"].includes(button.textContent?.trim() ?? ""));

  it.each(["manual", "task"] as const)("continues the exact retained %s request after reload without minting another run", async source => {
    const waiting = childWait(source);
    if (source === "manual") waiting.run.triggerPayload.task = { literalManualInput: "Preserve this user field" };
    const completed = { ...waiting, run: { ...waiting.run, status: "succeeded" as const }, waits: [] };
    apiMock.startRun.mockResolvedValue(completed); apiMock.startTaskRun.mockResolvedValue(completed);
    const client = await showContinuation(waiting);
    expect(continueButton()).toBeDefined(); continueButton()!.click(); await flush();
    const args = ["company-1", ...(source === "task" ? ["task-1"] : []), "workflow-1",
      { input: source === "manual" ? waiting.run.triggerPayload : { customerId: "acme" }, revisionId: "revision-1" }, "run-key", waiting.run.humanCoverageId];
    expect(source === "task" ? apiMock.startTaskRun : apiMock.startRun).toHaveBeenCalledExactlyOnceWith(...args);
    expect(source === "task" ? apiMock.startRun : apiMock.startTaskRun).not.toHaveBeenCalled();
    expect(apiMock.retryRun).not.toHaveBeenCalled(); expect(apiMock.cancelRun).not.toHaveBeenCalled();
    expect(client.getQueryData<WorkflowRunDetail>(queryKeys.workflows.run("company-1", waiting.run.id))?.run.id).toBe(waiting.run.id);
    expect(continueButton()).toBeUndefined();
  });

  it("replays only the original genuine Local system request without a fabricated Human coverage", async () => {
    const waiting = childWait(); waiting.run.executionPrincipal = { type: "system", service: "local-board" };
    waiting.run.humanCoverageId = null; waiting.run.responsibleUserId = null;
    apiMock.startRun.mockResolvedValue({ ...waiting, run: { ...waiting.run, status: "succeeded" } });
    await showContinuation(waiting, "local-board", true); expect(continueButton()).toBeDefined();
    continueButton()!.click(); await flush();
    expect(apiMock.startRun).toHaveBeenCalledExactlyOnceWith("company-1", "workflow-1",
      { input: waiting.run.triggerPayload, revisionId: "revision-1" }, "run-key", null);
    expect(apiMock.startTaskRun).not.toHaveBeenCalled(); expect(apiMock.retryRun).not.toHaveBeenCalled();
  });

  it.each(["borrowed_coverage", "other_system"])("does not promote Local identity for %s", async mode => {
    const waiting = childWait(); waiting.run.executionPrincipal = { type: "system", service: mode === "other_system" ? "workflow-subworkflow" : "local-board" };
    if (mode === "other_system") waiting.run.humanCoverageId = null;
    await showContinuation(waiting, "local-board", true);
    expect(continueButton()).toBeUndefined(); expect(apiMock.startRun).not.toHaveBeenCalled();
  });

  it("renders the new continuation action in Danish", async () => {
    await i18n.changeLanguage("da"); await showContinuation(childWait());
    expect(continueButton()?.textContent).toContain("Fortsæt eksisterende kørsel");
    expect(container.textContent).toContain("Personen, der startede kørslen");
  });

  it.each(["wrong_human", "stale_revision", "missing_key", "retry_run", "agent", "malformed_task"])(
    "offers no retained continuation for %s", async mode => {
    const waiting = childWait(mode === "malformed_task" ? "task" : "manual");
    if (mode === "stale_revision") apiMock.get.mockResolvedValue({ ...workflow, publishedRevisionId: "new-revision" });
    if (mode === "missing_key") waiting.run.idempotencyKey = null;
    if (mode === "retry_run") waiting.run.retryOfRunId = "original-parent";
    if (mode === "agent") waiting.run.executionPrincipal = { type: "agent", agentId: "agent-1" };
    if (mode === "malformed_task") waiting.run.triggerPayload.task = { title: "No retained Task ID" };
    await showContinuation(waiting, mode === "wrong_human" ? "other-user" : "user-1");
    expect(continueButton()).toBeUndefined(); expect(apiMock.startRun).not.toHaveBeenCalled(); expect(apiMock.startTaskRun).not.toHaveBeenCalled();
  });

  it.each(["coverage_revoked", "task_input_changed", "different_run"])("keeps the original binding when %s is refused", async mode => {
    const waiting = childWait(mode === "task_input_changed" ? "task" : "manual");
    if (mode === "different_run") apiMock.startRun.mockResolvedValue({ ...waiting, run: { ...waiting.run, id: "replacement-run" } });
    else (mode === "task_input_changed" ? apiMock.startTaskRun : apiMock.startRun).mockRejectedValue(new Error("PRIVATE refusal detail"));
    const client = await showContinuation(waiting); continueButton()!.click(); await flush();
    expect(container.textContent).toContain("This run could not be continued.");
    expect(container.textContent).not.toContain("PRIVATE refusal detail");
    expect(client.getQueryData<WorkflowRunDetail>(queryKeys.workflows.run("company-1", waiting.run.id))?.run.status).toBe("waiting");
    expect(apiMock.retryRun).not.toHaveBeenCalled();
    expect(apiMock.startRun.mock.calls.length + apiMock.startTaskRun.mock.calls.length).toBe(1);
  });

  it("checks the actual current session cache before dispatching a stale visible action", async () => {
    const client = await showContinuation(childWait()), action = continueButton()!;
    client.setQueryData(queryKeys.auth.session, v9SessionFixture("other-user"));
    action.click(); await flush();
    expect(apiMock.startRun).not.toHaveBeenCalled(); expect(apiMock.startTaskRun).not.toHaveBeenCalled();
  });

  it.each(["account", "unmount"])("withholds a late private continuation result after %s changes", async mode => {
    const waiting = childWait(); let answer!: (result: WorkflowRunDetail) => void;
    apiMock.startRun.mockImplementation(() => new Promise(resolve => { answer = resolve; }));
    const client = await showContinuation(waiting); continueButton()!.click(); await flush();
    expect(apiMock.startRun).toHaveBeenCalledTimes(1);
    if (mode === "account") client.setQueryData(queryKeys.auth.session, v9SessionFixture("other-user"));
    else { flushSync(() => continuationRoot!.unmount()); continuationRoot = null; }
    answer({ ...waiting, run: { ...waiting.run, status: "succeeded" },
      steps: [{ ...waiting.steps[0]!, outputJson: { privateValue: "PRIVATE late child result" } }] });
    await flush();
    expect(client.getQueryData<WorkflowRunDetail>(queryKeys.workflows.run("company-1", waiting.run.id))?.run.status).toBe("waiting");
    expect(container.textContent).not.toContain("PRIVATE late child result");
    expect(JSON.stringify(client.getMutationCache().getAll().map(mutation => mutation.state))).not.toContain("PRIVATE late child result");
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


  it("retries a failed run with a stable idempotency key and navigates to the new run", async () => {
    const failedDetail: WorkflowRunDetail = {
      ...runDetail,
      run: {
        ...runDetail.run,
        status: "failed",
        failureCode: "workflow_condition_reference_missing",
        failureMessage: "Missing workflow input",
      },
    };
    const retriedDetail: WorkflowRunDetail = {
      ...runDetail,
      run: {
        ...runDetail.run,
        id: "run-retry-87654321",
        retryOfRunId: failedDetail.run.id,
        idempotencyRootRunId: failedDetail.run.id,
      },
    };
    apiMock.getRun.mockResolvedValue(failedDetail);
    apiMock.retryRun.mockResolvedValue(retriedDetail);

    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
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

    const trigger = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Retry exact run"),
    );
    expect(trigger).toBeDefined();
    trigger!.click();
    await flush();

    expect(document.body.textContent).toContain(
      "Retry this exact workflow revision?",
    );
    const confirm = Array.from(document.querySelectorAll("button")).find(
      (button) =>
        button.textContent?.trim() === "Retry exact run" && button !== trigger,
    );
    expect(confirm).toBeDefined();
    confirm!.click();
    await flush();

    expect(apiMock.retryRun).toHaveBeenCalledWith(
      "company-1",
      "run-12345678",
      { reason: "Retried by operator from workflow run view" },
      expect.stringMatching(/^ui-workflow-retry-/),
    );

    flushSync(() => root.unmount());
  });


});
