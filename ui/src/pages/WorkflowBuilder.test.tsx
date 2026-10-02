// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  WorkflowCapabilityCandidate,
  WorkflowDetail,
  WorkflowNodeDefinitionDescriptor,
  WorkflowRunDetail,
} from "@paperclipai/shared";
import { ApiError } from "@/api/client";
import { WorkflowBuilder } from "./WorkflowBuilder";

const agentsApiMock = vi.hoisted(() => ({
  list: vi.fn(),
}));

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  list: vi.fn(),
  optimizerSuggestions: vi.fn(),
  optimizerEvaluations: vi.fn(),
  capabilities: vi.fn(),
  nodeRegistry: vi.fn(),
  capabilitySearch: vi.fn(),
  updateDraft: vi.fn(),
  publish: vi.fn(),
  startRun: vi.fn(),
}));

vi.mock("@/api/workflows", () => ({ workflowsApi: apiMock }));
vi.mock("@/api/agents", () => ({ agentsApi: agentsApiMock }));
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "company-1" }),
}));
vi.mock("@/context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }),
}));
vi.mock("@/context/ToastContext", () => ({
  useToastActions: () => ({ pushToast: vi.fn() }),
}));

vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ children }: { children?: React.ReactNode }) => <div data-testid="xyflow">{children}</div>,
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  Handle: () => null,
  Position: { Left: "left", Right: "right" },
  applyNodeChanges: (_changes: unknown, nodes: unknown) => nodes,
  applyEdgeChanges: (_changes: unknown, edges: unknown) => edges,
}));

const registry: WorkflowNodeDefinitionDescriptor[] = [
  {
    type: "core.manual_trigger",
    version: 1,
    category: "trigger",
    displayName: "Manual Trigger",
    description: "Start manually",
    inputSchema: null,
    outputSchema: null,
    configSchema: {},
    sideEffectClass: "pure",
    riskDefault: "C0",
    authorizationRequirements: [],
    timeoutDefaultSeconds: null,
    retryPolicyDefault: { mode: "none", maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0 },
    idempotencyStrategy: "not_required",
    cancellationSupport: "none",
    testMode: "safe",
    failureOutputs: [],
    auditEvents: [],
    uiComponent: "manual_trigger",
    accessibilityContract: {
      label: "Manual trigger",
      description: "Start",
      supportsKeyboardInsert: true,
      supportsOutlineEdit: true,
    },
    publishState: "ready",
    publishBlockedReason: null,
  },
];

const manualCapability: WorkflowCapabilityCandidate = {
  id: "core:core.manual_trigger",
  kind: "core_node",
  title: "Manual Trigger",
  description: "Start manually",
  nodeType: "core.manual_trigger",
  configTemplate: {},
  executionMode: "deterministic",
  sideEffectClass: "pure",
  riskClass: "C0",
  inputSchema: null,
  outputSchema: null,
  requiredPermissions: [],
  availability: { status: "available", reason: null },
  operationalProfile: {
    reliabilityBasis: "static_contract",
    reliabilitySignal: "ready",
    latencyProfile: null,
    costProfile: "no_model_inference",
  },
  publishState: "ready",
  publishBlockedReason: null,
  source: { registryNodeType: "core.manual_trigger" },
};

const baseDetail: WorkflowDetail = {
  id: "workflow-1",
  companyId: "company-1",
  projectId: null,
  folderId: null,
  name: "Lead qualification",
  description: null,
  status: "active",
  publishedRevisionId: null,
  draftRevisionId: "revision-1",
  createdByUserId: "user-1",
  createdByAgentId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  archivedAt: null,
  draftRevision: {
    id: "revision-1",
    companyId: "company-1",
    workflowId: "workflow-1",
    revisionNumber: 1,
    state: "draft",
    graph: { version: 1, nodes: [], edges: [], variables: [], settings: {} },
    inputSchema: null,
    outputSchema: null,
    changeSummary: null,
    createdByUserId: "user-1",
    createdByAgentId: null,
    createdByRunId: null,
    createdAt: new Date(),
  },
  publishedRevision: null,
};

async function flush() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  flushSync(() => {});
}

describe("WorkflowBuilder", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    apiMock.get.mockResolvedValue(baseDetail);
    apiMock.list.mockResolvedValue([]);
    apiMock.optimizerEvaluations.mockResolvedValue([]);
    apiMock.optimizerSuggestions.mockResolvedValue({
      state: "disabled",
      workflowId: "workflow-1",
      workflowRevisionId: null,
      terminalRunCount: 0,
      correctionEvidenceCount: 0,
      minimumObservationCount: 3,
      suggestions: [],
    });
    apiMock.capabilities.mockResolvedValue({ read: true, edit: true, publish: true, run: false });
    apiMock.nodeRegistry.mockResolvedValue(registry);
    apiMock.capabilitySearch.mockResolvedValue({
      query: "",
      candidates: [manualCapability],
    });
    agentsApiMock.list.mockResolvedValue([
      {
        id: "openclaw-agent-1",
        companyId: "company-1",
        name: "OpenClaw Research",
        role: "research",
        title: "External Research",
        status: "idle",
        adapterType: "openclaw_gateway",
      },
      {
        id: "native-agent-1",
        companyId: "company-1",
        name: "Native Agent",
        role: "research",
        title: "Native Research",
        status: "idle",
        adapterType: "paperclip_runner",
      },
    ]);
  });

  afterEach(() => {
    container.remove();
    vi.clearAllMocks();
  });

  it("provides a non-drag outline editor and adds a registered node", async () => {
    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    flushSync(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/workflows/workflow-1"]}>
            <Routes>
              <Route path="/workflows/:workflowId" element={<WorkflowBuilder />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await flush();

    expect(container.textContent).toContain("Outline editor");
    const addButton = container.querySelector(
      'button[aria-label="Add Manual Trigger"]',
    ) as HTMLButtonElement | null;
    expect(addButton).toBeTruthy();
    flushSync(() => addButton!.click());
    await flush();
    expect(container.textContent).toContain("1. Manual Trigger");
    expect(container.textContent).toContain("Unsaved");

    flushSync(() => root.unmount());
  });

  it("shows optimizer evidence separately from executed workflow state", async () => {
    apiMock.optimizerSuggestions.mockResolvedValue({
      state: "ready",
      workflowId: "workflow-1",
      workflowRevisionId: "revision-published",
      terminalRunCount: 3,
      correctionEvidenceCount: 3,
      minimumObservationCount: 3,
      suggestions: [
        {
          id: "suggestion-1",
          companyId: "company-1",
          workflowId: "workflow-1",
          workflowRevisionId: "revision-published",
          signatureHash: "f".repeat(64),
          candidateType: "transform",
          stepOrdinals: [1],
          operationTypes: ["core.transform"],
          capabilityRefs: [null],
          sideEffectRisk: "low",
          observationCount: 3,
          successRate: 1,
          humanCorrectionRate: 0,
          humanCorrectionEvidenceCount: 3,
          humanCorrectionEvidenceCoverage: 1,
          inputShapeStability: 1,
          outputShapeStability: 1,
          averageDurationMs: 120,
          averageCost: 4,
          estimatedLatencySavingsMs: 120,
          estimatedCostSavings: 4,
          observedRunIds: ["run-1", "run-2", "run-3"],
        },
      ],
    });

    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    flushSync(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/workflows/workflow-1"]}>
            <Routes>
              <Route path="/workflows/:workflowId" element={<WorkflowBuilder />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await flush();

    expect(container.textContent).toContain("Optimizer");
    expect(container.textContent).toContain("Governed qualification");
    expect(container.textContent).toContain("Optimization available");
    expect(
      container.querySelector(
        '[aria-label="Optimizer suggestion: Deterministic transform"]',
      ),
    ).toBeTruthy();
    expect(container.textContent).toContain("Current workflow remains authoritative");
    expect(container.textContent).toContain("Qualification does not activate it");
    expect(container.textContent).toContain("Generate from reviewed runs");
    const promote = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Promote",
    ) as HTMLButtonElement | undefined;
    expect(promote).toBeUndefined();
    expect(apiMock.publish).not.toHaveBeenCalled();
    expect(apiMock.startRun).not.toHaveBeenCalled();

    flushSync(() => root.unmount());
  });

  it("preserves the local graph when save hits a revision conflict", async () => {
    const newer: WorkflowDetail = {
      ...baseDetail,
      draftRevisionId: "revision-2",
      draftRevision: {
        ...baseDetail.draftRevision!,
        id: "revision-2",
        revisionNumber: 2,
      },
    };
    apiMock.get.mockResolvedValueOnce(baseDetail).mockResolvedValue(newer);
    apiMock.updateDraft.mockRejectedValueOnce(
      new ApiError("Workflow draft was updated by someone else", 409, {
        code: "revision_conflict",
        currentDraftRevisionId: "revision-2",
      }),
    );

    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    flushSync(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/workflows/workflow-1"]}>
            <Routes>
              <Route path="/workflows/:workflowId" element={<WorkflowBuilder />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await flush();

    const addButton = container.querySelector(
      'button[aria-label="Add Manual Trigger"]',
    ) as HTMLButtonElement | null;
    flushSync(() => addButton!.click());
    await flush();

    const saveButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Save draft"));
    flushSync(() => saveButton!.click());
    await flush();

    expect(apiMock.updateDraft).toHaveBeenCalledWith(
      "company-1",
      "workflow-1",
      expect.objectContaining({ expectedRevisionId: "revision-1" }),
    );
    expect(container.textContent).toContain("A newer workflow revision exists");
    expect(container.textContent).toContain("1. Manual Trigger");
    const staleSave = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Save draft")) as HTMLButtonElement | undefined;
    expect(staleSave?.disabled).toBe(true);

    flushSync(() => root.unmount());
  });
  it("runs the published revision through the explicit live-run action", async () => {
    const publishedRevision = {
      ...baseDetail.draftRevision!,
      id: "revision-published",
      revisionNumber: 2,
      state: "published" as const,
      graph: {
        version: 1 as const,
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
    };
    const publishedDetail: WorkflowDetail = {
      ...baseDetail,
      publishedRevisionId: publishedRevision.id,
      publishedRevision,
    };
    const runDetail: WorkflowRunDetail = {
      run: {
        id: "run-1",
        companyId: "company-1",
        workflowId: "workflow-1",
        workflowRevisionId: publishedRevision.id,
        triggerId: null,
        status: "succeeded",
        source: "manual",
        triggerPayload: {},
        responsibleUserId: "user-1",
        idempotencyKey: "ui-run-test",
        correlationId: "correlation-1",
        executionOwnerId: null,
        leaseExpiresAt: null,
        ownerHeartbeatAt: null,
        startedAt: new Date(),
        finishedAt: new Date(),
        failureCode: null,
        failureMessage: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      steps: [],
      waits: [],
    };
    apiMock.get.mockResolvedValue(publishedDetail);
    apiMock.capabilities.mockResolvedValue({
      read: true,
      edit: true,
      publish: true,
      run: true,
    });
    apiMock.startRun.mockResolvedValue(runDetail);

    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    flushSync(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/workflows/workflow-1"]}>
            <Routes>
              <Route path="/workflows/:workflowId" element={<WorkflowBuilder />} />
              <Route
                path="/workflows/:workflowId/runs/:runId"
                element={<div>Run destination</div>}
              />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await flush();

    const runButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Run published"));
    expect(runButton).toBeTruthy();
    flushSync(() => runButton!.click());
    await flush();

    expect(apiMock.startRun).toHaveBeenCalledWith(
      "company-1",
      "workflow-1",
      { input: {}, revisionId: null },
      expect.stringMatching(/^ui-run-/),
    );
    expect(container.textContent).toContain("Run destination");

    flushSync(() => root.unmount());
  });

  it("configures External Agent only through governed OpenClaw bindings", async () => {
    const externalDefinition: WorkflowNodeDefinitionDescriptor = {
      type: "agent.external",
      version: 1,
      category: "agent",
      displayName: "External Agent",
      description: "Run bounded work through OpenClaw",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      configSchema: { type: "object" },
      sideEffectClass: "write",
      riskDefault: "C3",
      authorizationRequirements: [
        { permission: "tasks:assign", timing: "execution", description: "Assign work to the selected agent at execution." },
      ],
      timeoutDefaultSeconds: 120,
      retryPolicyDefault: {
        mode: "exponential",
        maxAttempts: 3,
        initialDelayMs: 1000,
        maxDelayMs: 5000,
      },
      idempotencyStrategy: "workflow_step_key",
      cancellationSupport: "cooperative",
      testMode: "sandbox",
      failureOutputs: [],
      auditEvents: [
        "workflow.external_agent_requested",
        "workflow.external_agent_dispatched",
        "workflow.external_agent_completed",
      ],
      uiComponent: "external_agent",
      accessibilityContract: {
        label: "External Agent",
        description: "Run bounded work through OpenClaw",
        supportsKeyboardInsert: true,
        supportsOutlineEdit: true,
      },
      publishState: "ready",
      publishBlockedReason: null,
    };
    const externalCapability: WorkflowCapabilityCandidate = {
      id: "agent:openclaw-agent-1",
      kind: "agent",
      title: "OpenClaw Research",
      description: "research",
      nodeType: "agent.external",
      configTemplate: {
        agentId: "openclaw-agent-1",
        objective: "Research the account",
        structuredInput: { accountId: "acme" },
        expectedOutputSchema: null,
        timeoutSeconds: 120,
        allowedCapabilityScope: "binding_grants",
        fallbackPolicy: "fail",
      },
      executionMode: "agent",
      sideEffectClass: "write",
      riskClass: "C3",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      requiredPermissions: ["tasks:assign"],
      availability: { status: "available", reason: null },
      operationalProfile: {
        reliabilityBasis: "agent_status",
        reliabilitySignal: "idle",
        latencyProfile: null,
        costProfile: "model_or_agent_runtime",
      },
      publishState: "ready",
      publishBlockedReason: null,
      source: {
        agentId: "openclaw-agent-1",
        adapterType: "openclaw_gateway",
      },
    };

    apiMock.nodeRegistry.mockResolvedValue([...registry, externalDefinition]);
    apiMock.capabilitySearch.mockResolvedValue({
      query: "",
      candidates: [manualCapability, externalCapability],
    });

    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    flushSync(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/workflows/workflow-1"]}>
            <Routes>
              <Route
                path="/workflows/:workflowId"
                element={<WorkflowBuilder />}
              />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await flush();

    const addButton = container.querySelector(
      'button[aria-label="Add OpenClaw Research"]',
    ) as HTMLButtonElement | null;
    expect(addButton).toBeTruthy();
    flushSync(() => addButton!.click());
    await flush();

    expect(container.textContent).toContain("OpenClaw agent binding");
    expect(container.textContent).toContain("OpenClaw Research");
    expect(container.textContent).not.toContain("Native Agent");
    expect(container.textContent).toContain("Objective");
    expect(
      container.querySelector(
        'textarea[aria-label="External Agent structured input JSON"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        'textarea[aria-label="External Agent expected output schema JSON"]',
      ),
    ).not.toBeNull();
    expect(container.textContent).toContain("Timeout (seconds)");
    expect(container.textContent).toContain(
      "Parent-agent credentials, hidden runtime state, Foundation",
    );
    expect(container.textContent).not.toContain("ws://127.0.0.1:18789");

    flushSync(() => root.unmount());
  });

  it("renders governed capability availability without exposing raw IDs", async () => {
    apiMock.capabilitySearch.mockResolvedValue({
      query: "",
      candidates: [
        manualCapability,
        {
          ...manualCapability,
          id: "tool:catalog-secret-id",
          kind: "connected_tool",
          title: "Send email",
          description: "Send a customer email",
          nodeType: "connector.action",
          configTemplate: {
            toolCatalogEntryId: "catalog-secret-id",
            connectionId: "connection-secret-id",
            input: {},
          },
          sideEffectClass: "write",
          riskClass: "C2",
          requiredPermissions: ["tools:use"],
          availability: { status: "unavailable", reason: "connection_missing_secret" },
          operationalProfile: {
            reliabilityBasis: "connection_health",
            reliabilitySignal: "missing_secret",
            latencyProfile: null,
            costProfile: null,
          },
          publishState: "draft_only",
          publishBlockedReason: "connector_runtime_not_ready",
          source: {
            applicationName: "Mail",
            connectionName: "Customer mail",
            toolName: "send_email",
          },
        } satisfies WorkflowCapabilityCandidate,
      ],
    });

    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    flushSync(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/workflows/workflow-1"]}>
            <Routes>
              <Route path="/workflows/:workflowId" element={<WorkflowBuilder />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await flush();

    expect(container.textContent).toContain("Send email");
    expect(container.textContent).toContain("unavailable");
    expect(container.textContent).toContain("draft only");
    expect(container.textContent).not.toContain("catalog-secret-id");
    expect(container.textContent).not.toContain("connection-secret-id");
    expect(
      (container.querySelector(
        'button[aria-label="Send email unavailable"]',
      ) as HTMLButtonElement | null)?.disabled,
    ).toBe(true);

    flushSync(() => root.unmount());
  });

});
