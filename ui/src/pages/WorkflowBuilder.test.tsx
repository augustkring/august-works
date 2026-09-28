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
} from "@paperclipai/shared";
import { ApiError } from "@/api/client";
import { WorkflowBuilder } from "./WorkflowBuilder";

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  capabilities: vi.fn(),
  nodeRegistry: vi.fn(),
  capabilitySearch: vi.fn(),
  updateDraft: vi.fn(),
  publish: vi.fn(),
}));

vi.mock("@/api/workflows", () => ({ workflowsApi: apiMock }));
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
    apiMock.capabilities.mockResolvedValue({ read: true, edit: true, publish: true, run: false });
    apiMock.nodeRegistry.mockResolvedValue(registry);
    apiMock.capabilitySearch.mockResolvedValue({
      query: "",
      candidates: [manualCapability],
    });
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
