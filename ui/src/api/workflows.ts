import type {
  CancelWorkflowRun,
  CreateWorkflow,
  PublishWorkflow,
  StartWorkflowRun,
  UpdateWorkflowDraft,
  Workflow,
  WorkflowCapabilities,
  WorkflowCapabilityKind,
  WorkflowCapabilitySearchResult,
  WorkflowDataSelectorModel,
  WorkflowDataSelectorRequest,
  WorkflowDetail,
  WorkflowNodeDefinitionDescriptor,
  WorkflowRun,
  WorkflowRunDetail,
  WorkflowRevision,
} from "@paperclipai/shared";
import { api } from "./client";

export const workflowsApi = {
  dataSelector: (
    companyId: string,
    input: WorkflowDataSelectorRequest,
  ) =>
    api.post<WorkflowDataSelectorModel>(
      `/companies/${companyId}/workflows/data-selector`,
      input,
    ),
  capabilities: (companyId: string) =>
    api.get<WorkflowCapabilities>(`/companies/${companyId}/workflows/capabilities`),

  list: (companyId: string) =>
    api.get<Workflow[]>(`/companies/${companyId}/workflows`),

  get: (companyId: string, workflowId: string) =>
    api.get<WorkflowDetail>(`/companies/${companyId}/workflows/${workflowId}`),

  create: (companyId: string, input: CreateWorkflow) =>
    api.post<WorkflowDetail>(`/companies/${companyId}/workflows`, input),

  updateDraft: (
    companyId: string,
    workflowId: string,
    input: UpdateWorkflowDraft,
  ) =>
    api.patch<WorkflowDetail>(
      `/companies/${companyId}/workflows/${workflowId}/draft`,
      input,
    ),

  publish: (
    companyId: string,
    workflowId: string,
    input: PublishWorkflow,
  ) =>
    api.post<WorkflowDetail>(
      `/companies/${companyId}/workflows/${workflowId}/publish`,
      input,
    ),

  revisions: (companyId: string, workflowId: string) =>
    api.get<WorkflowRevision[]>(
      `/companies/${companyId}/workflows/${workflowId}/revisions`,
    ),

  listRuns: (companyId: string, workflowId: string, limit = 30) =>
    api.get<WorkflowRun[]>(
      `/companies/${companyId}/workflows/${workflowId}/runs?limit=${Math.min(Math.max(limit, 1), 100)}`,
    ),

  startRun: (
    companyId: string,
    workflowId: string,
    input: StartWorkflowRun,
    idempotencyKey: string,
  ) =>
    api.post<WorkflowRunDetail>(
      `/companies/${companyId}/workflows/${workflowId}/run`,
      input,
      { headers: { "Idempotency-Key": idempotencyKey } },
    ),

  startTaskRun: (
    companyId: string,
    issueId: string,
    workflowId: string,
    input: StartWorkflowRun,
    idempotencyKey: string,
  ) =>
    api.post<WorkflowRunDetail>(
      `/companies/${companyId}/issues/${issueId}/workflows/${workflowId}/run`,
      input,
      { headers: { "Idempotency-Key": idempotencyKey } },
    ),

  getRun: (companyId: string, runId: string) =>
    api.get<WorkflowRunDetail>(`/companies/${companyId}/workflow-runs/${runId}`),

  cancelRun: (
    companyId: string,
    runId: string,
    input: CancelWorkflowRun,
  ) =>
    api.post<WorkflowRunDetail>(
      `/companies/${companyId}/workflow-runs/${runId}/cancel`,
      input,
    ),

  nodeRegistry: (companyId: string) =>
    api.get<WorkflowNodeDefinitionDescriptor[]>(
      `/companies/${companyId}/workflows/node-registry`,
    ),

  capabilitySearch: (
    companyId: string,
    input: { q?: string; limit?: number; kind?: WorkflowCapabilityKind } = {},
  ) => {
    const params = new URLSearchParams();
    if (input.q?.trim()) params.set("q", input.q.trim());
    if (input.limit) params.set("limit", String(input.limit));
    if (input.kind) params.set("kind", input.kind);
    const query = params.toString();
    return api.get<WorkflowCapabilitySearchResult>(
      `/companies/${companyId}/workflows/capability-search${query ? `?${query}` : ""}`,
    );
  },
};
