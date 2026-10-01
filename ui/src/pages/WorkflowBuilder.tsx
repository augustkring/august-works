import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  GitBranch,
  History,
  Play,
  Save,
  Trash2,
} from "lucide-react";
import type {
  WorkflowCapabilityCandidate,
  WorkflowDetail,
  WorkflowEdgeV1,
  WorkflowGraphV1,
  WorkflowNodeDefinitionDescriptor,
  WorkflowNodeV1,
  WorkflowRetryPolicy,
} from "@paperclipai/shared";
import { workflowsApi } from "@/api/workflows";
import { agentsApi } from "@/api/agents";
import { projectsApi } from "@/api/projects";
import { accessApi } from "@/api/access";
import { ApiError } from "@/api/client";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useToastActions } from "@/context/ToastContext";
import { useNavigate, useParams } from "@/lib/router";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/PageSkeleton";
import { WorkflowDataSelector } from "@/components/workflows/WorkflowDataSelector";
import { WorkflowOptimizerSuggestions } from "@/components/workflows/WorkflowOptimizerSuggestions";

type BuilderNodeData = {
  workflowNode: WorkflowNodeV1;
  definition: WorkflowNodeDefinitionDescriptor | null;
};
type BuilderNode = Node<BuilderNodeData, "workflow-node">;
type BuilderEdgeData = { workflowEdge: WorkflowEdgeV1 };
type BuilderEdge = Edge<BuilderEdgeData>;

const NO_RETRY_POLICY: WorkflowRetryPolicy = {
  mode: "none",
  maxAttempts: 1,
  initialDelayMs: 0,
  maxDelayMs: 0,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedInteger(
  raw: string,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function formatJsonObjectValue(value: unknown, allowNull: boolean) {
  if (value === null || value === undefined) return allowNull ? "" : "{}";
  if (!isRecord(value)) return "{}";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "{}";
  }
}

function JsonObjectTextarea({
  value,
  disabled,
  allowNull = false,
  rows = 5,
  ariaLabel,
  onCommit,
}: {
  value: unknown;
  disabled: boolean;
  allowNull?: boolean;
  rows?: number;
  ariaLabel: string;
  onCommit: (value: Record<string, unknown> | null) => void;
}) {
  const serialized = formatJsonObjectValue(value, allowNull);
  const [draft, setDraft] = useState(serialized);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(serialized);
    setError(null);
  }, [serialized]);

  const validate = (raw: string) => {
    if (allowNull && raw.trim().length === 0) {
      setError(null);
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed)) {
        setError("Enter a JSON object.");
        return undefined;
      }
      setError(null);
      return parsed;
    } catch {
      setError("Enter valid JSON.");
      return undefined;
    }
  };

  return (
    <div>
      <textarea
        value={draft}
        disabled={disabled}
        rows={rows}
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        onChange={(event) => {
          setDraft(event.target.value);
          validate(event.target.value);
        }}
        onBlur={() => {
          const parsed = validate(draft);
          if (parsed !== undefined) onCommit(parsed);
        }}
        className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      />
      {error ? (
        <p role="alert" className="mt-1 text-[11px] leading-4 text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function defaultConfig(type: string): Record<string, unknown> | null {
  switch (type) {
    case "core.manual_trigger":
      return {};
    case "core.transform":
      return { mapping: { value: "{{input.value}}" } };
    case "core.condition":
      return { expression: "true" };
    case "core.wait":
      return { durationSeconds: 300 };
    case "work.create_task":
      return {
        title: "New task",
        description: null,
        projectId: null,
        assigneeAgentId: null,
        assigneeUserId: null,
        waitForCompletion: false,
      };
    case "human.approval":
      return {
        summary: "Approval required",
        consequence: "Review this step before the workflow continues.",
      };
    case "agent.external":
      return {
        agentId: "",
        objective: "Delegate this bounded external workflow step",
        structuredInput: {},
        expectedOutputSchema: null,
        timeoutSeconds: 120,
        allowedCapabilityScope: "binding_grants",
        fallbackPolicy: "fail",
      };
    default:
      return null;
  }
}

function randomId(prefix: string) {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function definitionMap(definitions: WorkflowNodeDefinitionDescriptor[]) {
  return new Map(definitions.map((definition) => [definition.type, definition]));
}

function toFlowNodes(
  graph: WorkflowGraphV1,
  definitions: Map<string, WorkflowNodeDefinitionDescriptor>,
): BuilderNode[] {
  return graph.nodes.map((workflowNode) => ({
    id: workflowNode.id,
    type: "workflow-node",
    position: workflowNode.position,
    data: {
      workflowNode,
      definition: definitions.get(workflowNode.type) ?? null,
    },
  }));
}

function toFlowEdges(graph: WorkflowGraphV1): BuilderEdge[] {
  return graph.edges.map((workflowEdge) => ({
    id: workflowEdge.id,
    source: workflowEdge.source,
    target: workflowEdge.target,
    sourceHandle: workflowEdge.sourceHandle ?? undefined,
    targetHandle: workflowEdge.targetHandle ?? undefined,
    label: workflowEdge.label ?? undefined,
    data: { workflowEdge },
  }));
}

function toGraph(
  nodes: BuilderNode[],
  edges: BuilderEdge[],
  base: Pick<WorkflowGraphV1, "variables" | "settings">,
): WorkflowGraphV1 {
  return {
    version: 1,
    nodes: nodes.map((node) => ({
      ...node.data.workflowNode,
      position: { x: node.position.x, y: node.position.y },
    })),
    edges: edges.map((edge) => ({
      ...(edge.data?.workflowEdge ?? {
        id: edge.id,
        source: edge.source,
        target: edge.target,
      }),
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
      label: typeof edge.label === "string"
        ? edge.label
        : edge.data?.workflowEdge.label ?? null,
    })),
    variables: base.variables,
    settings: base.settings,
  };
}

function workflowErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    const body = error.body as {
      code?: string;
      details?: { reason?: string; blockedReason?: string };
      reason?: string;
    } | null;
    if (body?.code === "revision_conflict") {
      return "A newer workflow revision exists. Your local graph is preserved.";
    }
    if (body?.code === "workflow_node_invalid") {
      const reason = body.details?.blockedReason ?? body.details?.reason ?? body.reason;
      return reason
        ? `This draft cannot be published yet: ${reason.replaceAll("_", " ")}.`
        : "A workflow node is not valid for publishing yet.";
    }
    if (body?.code === "workflow_executor_capability_not_ready") {
      return "This published revision contains steps that are not executable in the current durability phase yet.";
    }
    if (body?.code === "workflow_revision_not_published") {
      return "Publish a valid workflow revision before starting a live run.";
    }
  }
  return error instanceof Error ? error.message : "The workflow change could not be completed.";
}

function WorkflowNodeCard({ data, selected }: NodeProps<BuilderNode>) {
  const definition = data.definition;
  return (
    <div
      tabIndex={0}
      aria-label={`${data.workflowNode.name}, ${definition?.displayName ?? data.workflowNode.type}`}
      className={cn(
        "min-w-44 rounded-lg border bg-background px-3 py-2.5 shadow-sm outline-none transition",
        selected ? "border-foreground/50 ring-2 ring-ring/30" : "border-border",
      )}
    >
      <Handle type="target" position={Position.Left} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{data.workflowNode.name}</p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {definition?.displayName ?? data.workflowNode.type}
          </p>
        </div>
        {definition?.publishState === "draft_only" ? (
          <span className="shrink-0 text-[10px] text-muted-foreground">draft</span>
        ) : null}
      </div>
      {data.workflowNode.type === "core.condition" ? (
        <>
          <Handle
            id="true"
            type="source"
            position={Position.Right}
            style={{ top: "38%" }}
          />
          <Handle
            id="false"
            type="source"
            position={Position.Right}
            style={{ top: "72%" }}
          />
          <div className="mt-2 flex justify-end gap-2 text-[10px] text-muted-foreground">
            <span>True</span>
            <span>False</span>
          </div>
        </>
      ) : (
        <Handle type="source" position={Position.Right} />
      )}
    </div>
  );
}

const NODE_TYPES = { "workflow-node": WorkflowNodeCard };

export function WorkflowBuilder() {
  const { selectedCompanyId } = useCompany();
  const { workflowId } = useParams();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToastActions();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [nodes, setNodes] = useState<BuilderNode[]>([]);
  const [edges, setEdges] = useState<BuilderEdge[]>([]);
  const [variables, setVariables] = useState<WorkflowGraphV1["variables"]>([]);
  const [settings, setSettings] = useState<WorkflowGraphV1["settings"]>({});
  const [baseRevisionId, setBaseRevisionId] = useState<string | null>(null);
  const [publishedRevisionId, setPublishedRevisionId] = useState<string | null>(null);
  const [loadedWorkflowId, setLoadedWorkflowId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [conflicted, setConflicted] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [capabilitySearch, setCapabilitySearch] = useState("");
  const deferredCapabilitySearch = useDeferredValue(capabilitySearch);
  const [connectTargetId, setConnectTargetId] = useState("");
  const [connectBranch, setConnectBranch] = useState<"true" | "false">("true");

  useEffect(() => {
    setBreadcrumbs([
      { label: "Workflows", href: "/workflows" },
      { label: "Builder" },
    ]);
  }, [setBreadcrumbs]);

  const detailQuery = useQuery({
    queryKey: queryKeys.workflows.detail(selectedCompanyId!, workflowId ?? ""),
    queryFn: () => workflowsApi.get(selectedCompanyId!, workflowId!),
    enabled: !!selectedCompanyId && !!workflowId,
  });
  const capabilitiesQuery = useQuery({
    queryKey: queryKeys.workflows.capabilities(selectedCompanyId!),
    queryFn: () => workflowsApi.capabilities(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const registryQuery = useQuery({
    queryKey: queryKeys.workflows.nodeRegistry(selectedCompanyId!),
    queryFn: () => workflowsApi.nodeRegistry(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const capabilitySearchQuery = useQuery({
    queryKey: queryKeys.workflows.capabilitySearch(
      selectedCompanyId!,
      deferredCapabilitySearch.trim(),
    ),
    queryFn: () => workflowsApi.capabilitySearch(selectedCompanyId!, {
      q: deferredCapabilitySearch.trim(),
      limit: 24,
    }),
    enabled: !!selectedCompanyId,
    staleTime: 10_000,
  });
  const definitions = useMemo(
    () => definitionMap(registryQuery.data ?? []),
    [registryQuery.data],
  );

  const hydrate = useCallback((detail: WorkflowDetail) => {
    if (!detail.draftRevision || !detail.draftRevisionId) return;
    setNodes(toFlowNodes(detail.draftRevision.graph, definitions));
    setEdges(toFlowEdges(detail.draftRevision.graph));
    setVariables(detail.draftRevision.graph.variables);
    setSettings(detail.draftRevision.graph.settings);
    setBaseRevisionId(detail.draftRevisionId);
    setPublishedRevisionId(detail.publishedRevisionId);
    setLoadedWorkflowId(detail.id);
    setDirty(false);
    setConflicted(false);
    setSelectedNodeId(null);
    setConnectTargetId("");
    setConnectBranch("true");
  }, [definitions]);

  useEffect(() => {
    const detail = detailQuery.data;
    if (!detail?.draftRevision || !detail.draftRevisionId) return;
    if (loadedWorkflowId !== detail.id || baseRevisionId === null) {
      hydrate(detail);
      return;
    }
    if (detail.draftRevisionId !== baseRevisionId) {
      if (dirty) setConflicted(true);
      else hydrate(detail);
    }
  }, [
    baseRevisionId,
    detailQuery.data?.draftRevisionId,
    detailQuery.data?.id,
    dirty,
    hydrate,
    loadedWorkflowId,
  ]);

  useEffect(() => {
    setNodes((current) => current.map((node) => ({
      ...node,
      data: {
        ...node.data,
        definition: definitions.get(node.data.workflowNode.type) ?? null,
      },
    })));
  }, [definitions]);

  const markDirty = () => setDirty(true);

  const onNodesChange = (changes: NodeChange<BuilderNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
    if (changes.some((change) => change.type !== "select" && change.type !== "dimensions")) {
      markDirty();
    }
  };

  const onEdgesChange = (changes: EdgeChange<BuilderEdge>[]) => {
    setEdges((current) => applyEdgeChanges(changes, current));
    if (changes.some((change) => change.type !== "select")) markDirty();
  };

  const onConnect = (connection: Connection) => {
    if (!connection.source || !connection.target) return;
    const sourceNode = nodes.find((node) => node.id === connection.source);
    const isCondition = sourceNode?.data.workflowNode.type === "core.condition";
    const branch = isCondition
      ? connection.sourceHandle === "true" || connection.sourceHandle === "false"
        ? connection.sourceHandle
        : null
      : null;

    if (isCondition && !branch) {
      pushToast({
        title: "Choose a condition branch",
        body: "Connect from either the True or False output.",
        tone: "error",
      });
      return;
    }
    if (
      isCondition &&
      edges.some(
        (edge) =>
          edge.source === connection.source &&
          (edge.sourceHandle ?? edge.data?.workflowEdge.sourceHandle) === branch,
      )
    ) {
      pushToast({
        title: `${branch === "true" ? "True" : "False"} branch already connected`,
        body: "Each condition branch can activate one deterministic path.",
        tone: "error",
      });
      return;
    }

    const workflowEdge: WorkflowEdgeV1 = {
      id: randomId("edge"),
      source: connection.source,
      target: connection.target,
      sourceHandle: branch ?? connection.sourceHandle ?? null,
      targetHandle: connection.targetHandle ?? null,
      label: branch ?? "Next",
    };
    setEdges((current) => [
      ...current,
      {
        id: workflowEdge.id,
        source: workflowEdge.source,
        target: workflowEdge.target,
        sourceHandle: workflowEdge.sourceHandle ?? undefined,
        targetHandle: workflowEdge.targetHandle ?? undefined,
        label: workflowEdge.label ?? undefined,
        data: { workflowEdge },
      },
    ]);
    markDirty();
  };

  const currentGraph = () => toGraph(nodes, edges, { variables, settings });

  const invalidate = async () => {
    if (!selectedCompanyId || !workflowId) return;
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: queryKeys.workflows.detail(selectedCompanyId, workflowId),
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.workflows.list(selectedCompanyId),
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.workflows.revisions(selectedCompanyId, workflowId),
      }),
    ]);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCompanyId || !workflowId || !baseRevisionId) {
        throw new Error("Workflow draft is not ready.");
      }
      if (conflicted) throw new Error("Reload the latest revision before saving.");
      return workflowsApi.updateDraft(selectedCompanyId, workflowId, {
        expectedRevisionId: baseRevisionId,
        graph: currentGraph(),
        changeSummary: "Updated in visual builder",
      });
    },
    onSuccess: async (detail) => {
      hydrate(detail);
      await invalidate();
      pushToast({ title: "Workflow draft saved", tone: "success" });
    },
    onError: async (error) => {
      if (
        error instanceof ApiError &&
        (error.body as { code?: string } | null)?.code === "revision_conflict"
      ) {
        setConflicted(true);
        await detailQuery.refetch();
      }
      pushToast({
        title: "Could not save workflow",
        body: workflowErrorMessage(error),
        tone: "error",
      });
    },
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCompanyId || !workflowId || !baseRevisionId) {
        throw new Error("Workflow draft is not ready.");
      }
      if (dirty) throw new Error("Save the draft before publishing.");
      if (conflicted) throw new Error("Reload the latest revision before publishing.");
      return workflowsApi.publish(selectedCompanyId, workflowId, {
        expectedDraftRevisionId: baseRevisionId,
        expectedPublishedRevisionId: publishedRevisionId,
        approvalId: null,
      });
    },
    onSuccess: async (detail) => {
      hydrate(detail);
      await invalidate();
      pushToast({ title: "Workflow revision published", tone: "success" });
    },
    onError: async (error) => {
      if (
        error instanceof ApiError &&
        (error.body as { code?: string } | null)?.code === "revision_conflict"
      ) {
        setConflicted(true);
        await detailQuery.refetch();
      }
      pushToast({
        title: "Could not publish workflow",
        body: workflowErrorMessage(error),
        tone: "error",
      });
    },
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCompanyId || !workflowId || !detailQuery.data?.publishedRevisionId) {
        throw new Error("Publish a workflow revision before starting a live run.");
      }
      return workflowsApi.startRun(
        selectedCompanyId,
        workflowId,
        { input: {}, revisionId: null },
        randomId("ui-run"),
      );
    },
    onSuccess: async (detail) => {
      if (!selectedCompanyId || !workflowId) return;
      await queryClient.invalidateQueries({
        queryKey: queryKeys.workflows.runs(selectedCompanyId, workflowId),
      });
      pushToast({ title: "Workflow run started", tone: "success" });
      navigate(`/workflows/${workflowId}/runs/${detail.run.id}`);
    },
    onError: (error) => {
      pushToast({
        title: "Could not run workflow",
        body: workflowErrorMessage(error),
        tone: "error",
      });
    },
  });

  const addCapability = (candidate: WorkflowCapabilityCandidate) => {
    if (!capabilities?.edit || candidate.availability.status === "unavailable") return;
    const definition = definitions.get(candidate.nodeType);
    if (!definition) {
      pushToast({
        title: "Capability is not available in this builder",
        body: "Its workflow node contract is not registered in this version.",
        tone: "error",
      });
      return;
    }
    const config =
      typeof structuredClone === "function"
        ? structuredClone(candidate.configTemplate)
        : JSON.parse(JSON.stringify(candidate.configTemplate));
    const workflowNode: WorkflowNodeV1 = {
      id: randomId("node"),
      type: candidate.nodeType,
      name: candidate.title,
      position: {
        x: 100 + (nodes.length % 3) * 220,
        y: 80 + Math.floor(nodes.length / 3) * 140,
      },
      config,
    };
    setNodes((current) => [
      ...current,
      {
        id: workflowNode.id,
        type: "workflow-node",
        position: workflowNode.position,
        data: { workflowNode, definition },
      },
    ]);
    setSelectedNodeId(workflowNode.id);
    markDirty();
  };

  const updateSelectedNode = (patch: Partial<WorkflowNodeV1>) => {
    if (!selectedNodeId) return;
    setNodes((current) => current.map((node) => (
      node.id === selectedNodeId
        ? {
            ...node,
            data: {
              ...node.data,
              workflowNode: { ...node.data.workflowNode, ...patch },
            },
          }
        : node
    )));
    markDirty();
  };

  const removeNode = (nodeId: string) => {
    setNodes((current) => current.filter((node) => node.id !== nodeId));
    setEdges((current) => current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
    markDirty();
  };

  const moveNode = (nodeId: string, dy: number) => {
    setNodes((current) => current.map((node) => (
      node.id === nodeId
        ? { ...node, position: { ...node.position, y: Math.max(0, node.position.y + dy) } }
        : node
    )));
    markDirty();
  };

  const connectSelected = () => {
    if (!selectedNodeId || !connectTargetId || selectedNodeId === connectTargetId) return;
    const selected = nodes.find((node) => node.id === selectedNodeId);
    onConnect({
      source: selectedNodeId,
      target: connectTargetId,
      sourceHandle:
        selected?.data.workflowNode.type === "core.condition" ? connectBranch : null,
      targetHandle: null,
    });
  };

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null;
  const builderGraph = useMemo(
    () => toGraph(nodes, edges, { variables, settings }),
    [nodes, edges, variables, settings],
  );
  const capabilities = capabilitiesQuery.data;
  const capabilityCandidates = capabilitySearchQuery.data?.candidates ?? [];

  if (!selectedCompanyId) {
    return <EmptyState icon={GitBranch} message="Select a company to open this workflow." />;
  }
  if (detailQuery.isLoading || registryQuery.isLoading) return <PageSkeleton />;
  if (detailQuery.error || !detailQuery.data) {
    return (
      <div className="p-6">
        <div className="border-l-2 border-destructive pl-4">
          <p className="font-medium">Workflow could not be loaded</p>
          <Button className="mt-3" variant="outline" onClick={() => detailQuery.refetch()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/workflows")}>
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Workflows
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">{detailQuery.data.name}</h1>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
              <span>Draft rev {detailQuery.data.draftRevision?.revisionNumber ?? "—"}</span>
              {dirty ? <span>Unsaved</span> : <span>Saved</span>}
              {detailQuery.data.publishedRevisionId ? <span>Published</span> : null}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/workflows/${workflowId}/runs`)}
          >
            <History className="mr-1.5 h-3.5 w-3.5" />
            Runs
          </Button>
          {capabilities?.run && detailQuery.data.publishedRevisionId ? (
            <Button
              variant="outline"
              size="sm"
              disabled={runMutation.isPending || detailQuery.data.status !== "active"}
              onClick={() => runMutation.mutate()}
              title="Runs the current published revision. Unsaved draft changes are not included."
            >
              <Play className="mr-1.5 h-3.5 w-3.5" />
              {runMutation.isPending ? "Running…" : "Run published"}
            </Button>
          ) : null}
          {conflicted ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => detailQuery.data && hydrate(detailQuery.data)}
            >
              Reload latest
            </Button>
          ) : null}
          {capabilities?.edit ? (
            <Button
              variant="outline"
              size="sm"
              disabled={!dirty || conflicted || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              <Save className="mr-1.5 h-3.5 w-3.5" />
              {saveMutation.isPending ? "Saving…" : "Save draft"}
            </Button>
          ) : null}
          {capabilities?.publish ? (
            <Button
              size="sm"
              disabled={dirty || conflicted || publishMutation.isPending}
              onClick={() => publishMutation.mutate()}
            >
              <Check className="mr-1.5 h-3.5 w-3.5" />
              {publishMutation.isPending ? "Publishing…" : "Publish"}
            </Button>
          ) : null}
        </div>
      </header>

      {conflicted ? (
        <div role="alert" className="border-b border-amber-500/30 bg-amber-500/5 px-5 py-2 text-sm">
          A newer workflow revision exists. Your local graph is preserved. Reload the latest revision before saving.
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 lg:grid-cols-[220px_minmax(0,1fr)_300px]">
        <aside className="overflow-y-auto border-r border-border p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Add step
          </p>
          <Input
            aria-label="Search workflow capabilities"
            value={capabilitySearch}
            onChange={(event) => setCapabilitySearch(event.target.value)}
            placeholder="What should happen next?"
          />
          <div
            className="mt-2 max-h-72 space-y-1 overflow-y-auto"
            aria-label="Workflow capability results"
          >
            {capabilitySearchQuery.isFetching && capabilityCandidates.length === 0 ? (
              <p aria-live="polite" className="px-2 py-3 text-xs text-muted-foreground">
                Finding capabilities…
              </p>
            ) : capabilitySearchQuery.error ? (
              <div className="px-2 py-3">
                <p className="text-xs font-medium text-destructive">Capabilities could not be loaded.</p>
                <Button
                  className="mt-2"
                  size="sm"
                  variant="outline"
                  onClick={() => capabilitySearchQuery.refetch()}
                >
                  Retry
                </Button>
              </div>
            ) : capabilityCandidates.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                No matching capabilities.
              </p>
            ) : (
              capabilityCandidates.map((candidate) => {
                const unavailable = candidate.availability.status === "unavailable";
                const sourceLabel =
                  candidate.kind === "connected_tool"
                    ? candidate.source.applicationName ?? candidate.source.connectionName ?? "Connected app"
                    : candidate.kind === "agent"
                      ? "Agent"
                      : "Core";
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    disabled={!capabilities?.edit || unavailable}
                    onClick={() => addCapability(candidate)}
                    className="w-full rounded-md border border-border/70 px-2.5 py-2 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label={unavailable
                      ? `${candidate.title} unavailable`
                      : `Add ${candidate.title}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 truncate text-xs font-medium">
                        {candidate.title}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {candidate.riskClass}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                      {sourceLabel}
                      {" · "}
                      {candidate.availability.status.replaceAll("_", " ")}
                      {candidate.publishState === "draft_only" ? " · draft only" : ""}
                    </p>
                    {candidate.description ? (
                      <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-muted-foreground">
                        {candidate.description}
                      </p>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            Search core controls, connected tools and agents. Availability comes from the server; no AI search runs while you type.
          </p>

          <div className="mt-6 border-t border-border pt-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Outline editor
            </p>
            <div className="space-y-1">
              {nodes.map((node, index) => (
                <div
                  key={node.id}
                  className={cn(
                    "rounded-md border px-2 py-2",
                    selectedNodeId === node.id ? "border-foreground/40 bg-accent" : "border-border",
                  )}
                >
                  <button
                    type="button"
                    className="w-full truncate text-left text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => setSelectedNodeId(node.id)}
                  >
                    {index + 1}. {node.data.workflowNode.name}
                  </button>
                  {capabilities?.edit ? (
                    <div className="mt-2 flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Move ${node.data.workflowNode.name} up`}
                        onClick={() => moveNode(node.id, -80)}
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Move ${node.data.workflowNode.name} down`}
                        onClick={() => moveNode(node.id, 80)}
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Delete ${node.data.workflowNode.name}`}
                        onClick={() => removeNode(node.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
              {nodes.length === 0 ? (
                <p className="py-3 text-xs text-muted-foreground">No steps yet.</p>
              ) : null}
            </div>

            {selectedNodeId && nodes.length > 1 && capabilities?.edit ? (
              <div className="mt-4 space-y-2">
                {selectedNode?.data.workflowNode.type === "core.condition" ? (
                  <label className="block text-xs font-medium">
                    Branch
                    <select
                      value={connectBranch}
                      onChange={(event) => {
                        const branch = event.target.value;
                        if (branch === "true" || branch === "false") setConnectBranch(branch);
                      }}
                      className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                    >
                      <option value="true">True</option>
                      <option value="false">False</option>
                    </select>
                  </label>
                ) : null}
                <label className="block text-xs font-medium">
                  Connect selected to
                  <select
                    value={connectTargetId}
                    onChange={(event) => setConnectTargetId(event.target.value)}
                    className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                  >
                    <option value="">Choose step</option>
                    {nodes.filter((node) => node.id !== selectedNodeId).map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.data.workflowNode.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={connectSelected}
                  disabled={!connectTargetId}
                >
                  Connect
                </Button>
              </div>
            ) : null}

            {edges.length > 0 ? (
              <div className="mt-5 space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Connections</p>
                {edges.map((edge) => (
                  <div key={edge.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate">
                      {nodes.find((node) => node.id === edge.source)?.data.workflowNode.name ?? edge.source}
                      {" → "}
                      {nodes.find((node) => node.id === edge.target)?.data.workflowNode.name ?? edge.target}
                      {edge.label && edge.label !== "Next" ? ` [${edge.label}]` : ""}
                    </span>
                    {capabilities?.edit ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Delete connection"
                        onClick={() => {
                          setEdges((current) => current.filter((item) => item.id !== edge.id));
                          markDirty();
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </aside>

        <main className="relative hidden min-h-0 bg-muted/20 md:block">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
            fitView
            minZoom={0.2}
            maxZoom={1.5}
            nodesDraggable={capabilities?.edit === true}
            nodesConnectable={capabilities?.edit === true}
            elementsSelectable
          >
            <Background gap={24} size={1} />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </main>

        <aside className="min-h-0 overflow-y-auto border-l border-border p-4">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Inspector
          </p>
          {selectedNode ? (
            <NodeInspector
              node={selectedNode}
              canEdit={capabilities?.edit === true}
              onUpdate={updateSelectedNode}
              onDelete={() => removeNode(selectedNode.id)}
              companyId={selectedCompanyId}
              graph={builderGraph}
              inputSchema={detailQuery.data.draftRevision?.inputSchema ?? null}
            />
          ) : (
            <div className="py-8 text-sm text-muted-foreground">
              Select a step to inspect its contract and configuration.
            </div>
          )}

          {workflowId ? (
            <div className="mt-6 border-t border-border pt-5">
              <WorkflowOptimizerSuggestions
                companyId={selectedCompanyId}
                workflowId={workflowId}
              />
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function NodeInspector({
  node,
  canEdit,
  onUpdate,
  onDelete,
  companyId,
  graph,
  inputSchema,
}: {
  node: BuilderNode;
  canEdit: boolean;
  onUpdate: (patch: Partial<WorkflowNodeV1>) => void;
  onDelete: () => void;
  companyId: string;
  graph: WorkflowGraphV1;
  inputSchema: Record<string, unknown> | null;
}) {
  const workflowNode = node.data.workflowNode;
  const definition = node.data.definition;
  const config = isRecord(workflowNode.config) ? workflowNode.config : {};
  const retryPolicy =
    workflowNode.retryPolicy ??
    definition?.retryPolicyDefault ??
    NO_RETRY_POLICY;
  const isCreateTaskNode = workflowNode.type === "work.create_task";
  const isAgentTaskNode = workflowNode.type === "agent.task";
  const isExternalAgentNode = workflowNode.type === "agent.external";
  const { data: taskProjects = [] } = useQuery({
    queryKey: queryKeys.projects.list(companyId, { includeArchived: false }),
    queryFn: () => projectsApi.list(companyId, { includeArchived: false }),
    enabled: isCreateTaskNode,
  });
  const { data: taskAgents = [] } = useQuery({
    queryKey: queryKeys.agents.list(companyId),
    queryFn: () => agentsApi.list(companyId),
    enabled: isCreateTaskNode || isAgentTaskNode || isExternalAgentNode,
  });
  const { data: taskUserDirectory } = useQuery({
    queryKey: queryKeys.access.companyUserDirectory(companyId),
    queryFn: () => accessApi.listUserDirectory(companyId),
    enabled: isCreateTaskNode,
  });

  const updateConfig = (patch: Record<string, unknown>) =>
    onUpdate({ config: { ...config, ...patch } });

  const updateRetryPolicy = (patch: Partial<WorkflowRetryPolicy>) =>
    onUpdate({ retryPolicy: { ...retryPolicy, ...patch } });

  const insertDataExpression = (expression: string) => {
    if (!canEdit) return;
    if (workflowNode.type === "core.condition") {
      updateConfig({ expression });
    } else if (workflowNode.type === "core.transform") {
      updateConfig({ mapping: { value: expression } });
    }
  };
  const supportsExpressionInput =
    workflowNode.type === "core.condition" ||
    workflowNode.type === "core.transform";

  return (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline">{definition?.riskDefault ?? "—"}</Badge>
          <Badge variant="outline">{definition?.sideEffectClass ?? "unknown"}</Badge>
          {definition?.publishState === "draft_only" ? (
            <Badge variant="outline">Draft only</Badge>
          ) : (
            <Badge variant="outline">Publish ready</Badge>
          )}
        </div>
        <p className="mt-2 text-sm font-medium">
          {definition?.displayName ?? workflowNode.type}
        </p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {definition?.description ?? "This node type is not present in the current registry."}
        </p>
      </div>

      <label className="block space-y-1 text-xs font-medium">
        Step name
        <Input
          value={workflowNode.name}
          disabled={!canEdit}
          onChange={(event) => onUpdate({ name: event.target.value })}
        />
      </label>

      {workflowNode.type === "core.condition" ? (
        <label className="block space-y-1 text-xs font-medium">
          Condition
          <Input
            value={String(config.expression ?? "")}
            disabled={!canEdit}
            onChange={(event) => updateConfig({ expression: event.target.value })}
          />
          <span className="block text-[11px] font-normal leading-4 text-muted-foreground">
            Supports true/false, boolean data references and strict comparisons such as {"{{trigger.amount}} >= 50000"}.
          </span>
        </label>
      ) : null}

      {workflowNode.type === "core.wait" ? (
        <label className="block space-y-1 text-xs font-medium">
          Wait duration (seconds)
          <Input
            type="number"
            min={1}
            max={604800}
            value={String(config.durationSeconds ?? 300)}
            disabled={!canEdit}
            onChange={(event) =>
              updateConfig({
                durationSeconds: boundedInteger(
                  event.target.value,
                  1,
                  604800,
                  typeof config.durationSeconds === "number"
                    ? config.durationSeconds
                    : 300,
                ),
              })
            }
          />
          <span className="block text-[11px] font-normal leading-4 text-muted-foreground">
            The run is checkpointed and released while waiting; no browser request or worker stays open.
          </span>
        </label>
      ) : null}

      {workflowNode.type === "core.transform" ? (
        <label className="block space-y-1 text-xs font-medium">
          Output value expression
          <Input
            value={String(
              isRecord(config.mapping)
                ? config.mapping.value ?? ""
                : "",
            )}
            disabled={!canEdit}
            onChange={(event) => updateConfig({ mapping: { value: event.target.value } })}
          />
        </label>
      ) : null}

      {workflowNode.type === "work.create_task" ? (
        <>
          <label className="block space-y-1 text-xs font-medium">
            Task title
            <Input
              value={String(config.title ?? "")}
              disabled={!canEdit}
              onChange={(event) => updateConfig({ title: event.target.value })}
            />
          </label>
          <label className="block space-y-1 text-xs font-medium">
            Task description
            <Input
              value={String(config.description ?? "")}
              disabled={!canEdit}
              onChange={(event) =>
                updateConfig({
                  description: event.target.value || null,
                })
              }
            />
          </label>
          <label className="block space-y-1 text-xs font-medium">
            Project
            <select
              value={String(config.projectId ?? "")}
              disabled={!canEdit}
              onChange={(event) =>
                updateConfig({
                  projectId: event.target.value || null,
                })
              }
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">No project</option>
              {taskProjects
                .filter((project) => !project.archivedAt)
                .map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="block space-y-1 text-xs font-medium">
            Assignee
            <select
              value={
                typeof config.assigneeAgentId === "string"
                  ? `agent:${config.assigneeAgentId}`
                  : typeof config.assigneeUserId === "string"
                    ? `user:${config.assigneeUserId}`
                    : ""
              }
              disabled={!canEdit}
              onChange={(event) => {
                const value = event.target.value;
                if (value.startsWith("agent:")) {
                  updateConfig({
                    assigneeAgentId: value.slice("agent:".length),
                    assigneeUserId: null,
                  });
                } else if (value.startsWith("user:")) {
                  updateConfig({
                    assigneeAgentId: null,
                    assigneeUserId: value.slice("user:".length),
                  });
                } else {
                  updateConfig({
                    assigneeAgentId: null,
                    assigneeUserId: null,
                  });
                }
              }}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">Unassigned</option>
              {taskAgents.some((agent) => agent.status !== "terminated") ? (
                <optgroup label="Agents">
                  {taskAgents
                    .filter((agent) => agent.status !== "terminated")
                    .map((agent) => (
                      <option key={agent.id} value={`agent:${agent.id}`}>
                        {agent.name}
                      </option>
                    ))}
                </optgroup>
              ) : null}
              {(taskUserDirectory?.users.length ?? 0) > 0 ? (
                <optgroup label="People">
                  {(taskUserDirectory?.users ?? []).map((member) => (
                    <option
                      key={member.principalId}
                      value={`user:${member.principalId}`}
                    >
                      {member.user?.name ??
                        member.user?.email ??
                        member.principalId}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </label>
          <label className="flex items-start gap-2 rounded-md border border-border px-3 py-2 text-xs">
            <input
              type="checkbox"
              checked={config.waitForCompletion === true}
              disabled={!canEdit}
              onChange={(event) =>
                updateConfig({
                  waitForCompletion: event.target.checked,
                })
              }
              className="mt-0.5 h-4 w-4 rounded border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
            />
            <span>
              <span className="block font-medium">Wait for completion</span>
              <span className="mt-0.5 block font-normal leading-4 text-muted-foreground">
                Checkpoints the workflow and releases the worker until the
                linked task is done. Create Task does not wake an agent; use
                Agent Task when the workflow should actively delegate work.
              </span>
            </span>
          </label>
        </>
      ) : null}

      {workflowNode.type === "human.approval" ? (
        <>
          <label className="block space-y-1 text-xs font-medium">
            Approval summary
            <Input
              value={String(config.summary ?? "")}
              disabled={!canEdit}
              onChange={(event) => updateConfig({ summary: event.target.value })}
            />
          </label>
          <label className="block space-y-1 text-xs font-medium">
            Consequence
            <Input
              value={String(config.consequence ?? "")}
              disabled={!canEdit}
              onChange={(event) => updateConfig({ consequence: event.target.value })}
            />
          </label>
        </>
      ) : null}

      {workflowNode.type === "agent.task" ? (
        <>
          <label className="block space-y-1 text-xs font-medium">
            Agent
            <select
              value={String(config.agentId ?? "")}
              disabled={!canEdit}
              onChange={(event) =>
                updateConfig({ agentId: event.target.value })
              }
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="" disabled>
                Select agent
              </option>
              {taskAgents
                .filter((agent) => agent.status !== "terminated")
                .map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="block space-y-1 text-xs font-medium">
            Agent objective
            <textarea
              value={String(config.objective ?? "")}
              disabled={!canEdit}
              rows={4}
              onChange={(event) =>
                updateConfig({ objective: event.target.value })
              }
              className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm leading-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
            <span className="block text-[11px] font-normal leading-4 text-muted-foreground">
              Only the accountable task and its governed context are delegated.
              The agent does not inherit broader workflow authority.
            </span>
          </label>
          <label className="flex items-start gap-2 rounded-md border border-border px-3 py-2 text-xs">
            <input
              type="checkbox"
              checked={config.waitForCompletion !== false}
              disabled={!canEdit}
              onChange={(event) =>
                updateConfig({
                  waitForCompletion: event.target.checked,
                })
              }
              className="mt-0.5 h-4 w-4 rounded border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
            />
            <span>
              <span className="block font-medium">Wait for task completion</span>
              <span className="mt-0.5 block font-normal leading-4 text-muted-foreground">
                The workflow releases its worker while the assigned agent works
                and resumes from the task&apos;s terminal event.
              </span>
            </span>
          </label>
          {config.expectedOutputSchema != null ? (
            <div className="border-l-2 border-amber-500 pl-3 text-xs leading-5 text-muted-foreground">
              Structured Agent Task output is draft-only until Tasks expose an
              authoritative structured-result channel. Remove the expected
              output schema before publishing.
            </div>
          ) : null}
        </>
      ) : null}

      {workflowNode.type === "agent.external" ? (
        <>
          <label className="block space-y-1 text-xs font-medium">
            OpenClaw agent binding
            <select
              value={String(config.agentId ?? "")}
              disabled={!canEdit}
              onChange={(event) =>
                updateConfig({ agentId: event.target.value })
              }
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="" disabled>
                Select OpenClaw agent
              </option>
              {taskAgents
                .filter(
                  (agent) =>
                    agent.status !== "terminated" &&
                    agent.adapterType === "openclaw_gateway",
                )
                .map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
            </select>
          </label>

          <label className="block space-y-1 text-xs font-medium">
            Objective
            <textarea
              value={String(config.objective ?? "")}
              disabled={!canEdit}
              rows={4}
              onChange={(event) =>
                updateConfig({ objective: event.target.value })
              }
              className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm leading-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>

          <label className="block space-y-1 text-xs font-medium">
            Structured input
            <JsonObjectTextarea
              value={config.structuredInput}
              disabled={!canEdit}
              ariaLabel="External Agent structured input JSON"
              onCommit={(value) =>
                updateConfig({ structuredInput: value ?? {} })
              }
            />
          </label>

          <label className="block space-y-1 text-xs font-medium">
            Expected output schema
            <JsonObjectTextarea
              value={config.expectedOutputSchema}
              disabled={!canEdit}
              allowNull
              rows={6}
              ariaLabel="External Agent expected output schema JSON"
              onCommit={(value) =>
                updateConfig({ expectedOutputSchema: value })
              }
            />
            <span className="block text-[11px] font-normal leading-4 text-muted-foreground">
              Optional JSON Schema. The workflow resumes only after the
              OpenClaw result matches this schema.
            </span>
          </label>

          <label className="block space-y-1 text-xs font-medium">
            Timeout (seconds)
            <Input
              type="number"
              min={1}
              max={3600}
              value={String(config.timeoutSeconds ?? 120)}
              disabled={!canEdit}
              onChange={(event) =>
                updateConfig({
                  timeoutSeconds: boundedInteger(
                    event.target.value,
                    1,
                    3600,
                    typeof config.timeoutSeconds === "number"
                      ? config.timeoutSeconds
                      : 120,
                  ),
                })
              }
            />
          </label>

          <div className="border-l-2 border-border pl-3 text-xs leading-5 text-muted-foreground">
            Capabilities are limited to grants on this OpenClaw binding.
            Parent-agent credentials, hidden runtime state, Foundation,
            Shared Memory and unrelated task history are not inherited.
            V1 fallback is fail-closed; a missing native connector is never
            silently replaced without a workflow revision.
          </div>
        </>
      ) : null}

      {workflowNode.type === "connector.action" ? (
        <div className="border-l-2 border-border pl-3 text-xs leading-5 text-muted-foreground">
          Connected tool selected through the governed capability resolver. Inputs are configured through the Data Selector in the next implementation step; raw connection IDs and credentials are not exposed here.
        </div>
      ) : null}

      {definition?.publishBlockedReason ? (
        <div className="border-l-2 border-amber-500 pl-3 text-xs leading-5 text-muted-foreground">
          Publish gate: {definition.publishBlockedReason.replaceAll("_", " ")}
        </div>
      ) : null}

      {definition ? (
        <details className="border-t border-border pt-4">
          <summary className="cursor-pointer text-xs font-medium">
            Execution policy
          </summary>
          <div className="mt-3 space-y-3">
            <label className="block space-y-1 text-xs font-medium">
              Retry
              <select
                value={retryPolicy.mode}
                disabled={!canEdit}
                onChange={(event) => {
                  const mode = event.target.value;
                  if (mode === "none") {
                    onUpdate({ retryPolicy: NO_RETRY_POLICY });
                  } else if (mode === "fixed" || mode === "exponential") {
                    onUpdate({
                      retryPolicy: {
                        mode,
                        maxAttempts:
                          retryPolicy.maxAttempts > 1 ? retryPolicy.maxAttempts : 3,
                        initialDelayMs:
                          retryPolicy.initialDelayMs > 0
                            ? retryPolicy.initialDelayMs
                            : 1_000,
                        maxDelayMs:
                          retryPolicy.maxDelayMs >=
                          (retryPolicy.initialDelayMs > 0
                            ? retryPolicy.initialDelayMs
                            : 1_000)
                            ? retryPolicy.maxDelayMs
                            : 5_000,
                      },
                    });
                  }
                }}
                className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
              >
                <option value="none">No automatic retry</option>
                <option value="fixed">Fixed delay</option>
                <option value="exponential">Exponential backoff</option>
              </select>
            </label>

            {retryPolicy.mode !== "none" ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="block space-y-1 text-xs font-medium">
                  Max attempts
                  <Input
                    type="number"
                    min={2}
                    max={20}
                    value={retryPolicy.maxAttempts}
                    disabled={!canEdit}
                    onChange={(event) =>
                      updateRetryPolicy({
                        maxAttempts: boundedInteger(
                          event.target.value,
                          2,
                          20,
                          retryPolicy.maxAttempts,
                        ),
                      })
                    }
                  />
                </label>
                <label className="block space-y-1 text-xs font-medium">
                  Initial delay ms
                  <Input
                    type="number"
                    min={0}
                    max={86_400_000}
                    value={retryPolicy.initialDelayMs}
                    disabled={!canEdit}
                    onChange={(event) => {
                      const initialDelayMs = boundedInteger(
                        event.target.value,
                        0,
                        86_400_000,
                        retryPolicy.initialDelayMs,
                      );
                      updateRetryPolicy({
                        initialDelayMs,
                        maxDelayMs: Math.max(
                          initialDelayMs,
                          retryPolicy.maxDelayMs,
                        ),
                      });
                    }}
                  />
                </label>
                <label className="block space-y-1 text-xs font-medium">
                  Max delay ms
                  <Input
                    type="number"
                    min={retryPolicy.initialDelayMs}
                    max={86_400_000}
                    value={retryPolicy.maxDelayMs}
                    disabled={!canEdit}
                    onChange={(event) =>
                      updateRetryPolicy({
                        maxDelayMs: boundedInteger(
                          event.target.value,
                          retryPolicy.initialDelayMs,
                          86_400_000,
                          retryPolicy.maxDelayMs,
                        ),
                      })
                    }
                  />
                </label>
              </div>
            ) : null}

            <div className="text-[11px] leading-4 text-muted-foreground">
              <p>
                Idempotency: {definition.idempotencyStrategy.replaceAll("_", " ")}
              </p>
              <p className="mt-1">
                Retries only occur for errors the executor classifies as retryable and when the action is safe to repeat.
              </p>
            </div>
          </div>
        </details>
      ) : null}

      {supportsExpressionInput ? (
        <WorkflowDataSelector
          companyId={companyId}
          graph={graph}
          targetNodeId={workflowNode.id}
          inputSchema={inputSchema}
          onInsert={insertDataExpression}
        />
      ) : null}

      {canEdit ? (
        <Button variant="outline" size="sm" onClick={onDelete}>
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          Delete step
        </Button>
      ) : null}
    </div>
  );
}
