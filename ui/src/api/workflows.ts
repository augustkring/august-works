import type {
  CancelWorkflowRun,
  CreateWorkflow,
  PublishWorkflow,
  RetryWorkflowRun,
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
  OptimizerSuggestionResponse,
  WorkflowRunReview,
  WorkflowOptimizerCandidateRequest,
  WorkflowOptimizerEvaluationSummary,
  OptimizerPromotionDecision,
  OptimizerReplayEvaluation,
  WorkflowRun,
  WorkflowRunDetail,
  WorkflowRevision,
} from "@paperclipai/shared";
import { api as defaultApi } from "./client";
import {
  workflowExperienceSchema,
  workflowRunExperienceSchema,
  workflowLifecycleCommandSchema,
  workflowLifecycleReceiptSchema,
  workflowOperationsSchema,
  workflowLaunchCommandSchema,
  workflowLaunchReceiptSchema,
  type WorkflowLaunchCommand,
  type WorkflowLifecycleCommand,
} from "@paperclipai/shared";

export const createWorkflowsApi = (api: typeof defaultApi = defaultApi) => ({
  launch: async (
    companyId: string,
    principal: string,
    workflowId: string,
    raw: WorkflowLaunchCommand,
  ) => {
    const command = workflowLaunchCommandSchema.parse(raw);
    const receipt = workflowLaunchReceiptSchema.parse(
      await api.post(
        `/companies/${companyId}/workflows/${workflowId}/experience/launch?expectedUserId=${encodeURIComponent(principal)}`,
        command,
      ),
    );
    if (
      receipt.companyId !== companyId ||
      receipt.workflowId !== workflowId ||
      receipt.requestId !== command.requestId ||
      receipt.revisionId !== command.expectedPublishedRevisionId
    )
      throw new Error("Workflow run request context changed");
    return receipt;
  },
  operations: async (
    companyId: string,
    principal: string,
    workflowId: string,
    signal?: AbortSignal,
  ) => {
    const result = workflowOperationsSchema.parse(
      await api.get(
        `/companies/${companyId}/workflows/${workflowId}/experience/operations?expectedUserId=${encodeURIComponent(principal)}`,
        { signal, cache: "no-store" },
      ),
    );
    if (result.companyId !== companyId || result.workflowId !== workflowId)
      throw new Error("Workflow overview context changed");
    return result;
  },
  lifecycle: async (
    companyId: string,
    principal: string,
    workflowId: string,
    command: WorkflowLifecycleCommand,
  ) => {
    const input = workflowLifecycleCommandSchema.parse(command);
    const receipt = workflowLifecycleReceiptSchema.parse(
      await api.post(
        `/companies/${companyId}/workflows/${workflowId}/experience/lifecycle?expectedUserId=${encodeURIComponent(principal)}`,
        input,
      ),
    );
    if (
      receipt.companyId !== companyId ||
      receipt.workflowId !== workflowId ||
      receipt.requestId !== input.requestId ||
      receipt.action !== input.action ||
      receipt.publishedRevisionId !== input.expectedPublishedRevisionId ||
      (input.action !== "retire" &&
        receipt.draftRevisionId !== input.expectedDraftRevisionId)
    )
      throw new Error("Workflow request context changed");
    return receipt;
  },
  runExperience: async (
    companyId: string,
    principal: string,
    workflowId: string,
    runId: string,
    signal?: AbortSignal,
  ) => {
    const result = workflowRunExperienceSchema.parse(
      await api.get(
        `/companies/${companyId}/workflow-runs/${runId}/experience?expectedUserId=${encodeURIComponent(principal)}`,
        { signal, cache: "no-store" },
      ),
    );
    if (
      result.companyId !== companyId ||
      result.workflowId !== workflowId ||
      result.id !== runId
    )
      throw new Error("Workflow run context changed");
    return result;
  },
  experience: async (
    companyId: string,
    principal: string,
    workflowId: string,
    signal?: AbortSignal,
  ) => {
    const result = workflowExperienceSchema.parse(
      await api.get(
        `/companies/${companyId}/workflows/${workflowId}/experience?expectedUserId=${encodeURIComponent(principal)}`,
        { signal, cache: "no-store" },
      ),
    );
    if (result.companyId !== companyId || result.id !== workflowId)
      throw new Error("Workflow context changed");
    return result;
  },
  optimizerEvaluations: (companyId: string, workflowId: string) =>
    api.get<WorkflowOptimizerEvaluationSummary[]>(
      `/companies/${companyId}/workflows/${workflowId}/optimizer-evaluations`,
    ),
  proposeOptimizerCandidate: (
    companyId: string,
    workflowId: string,
    suggestionId: string,
  ) =>
    api.post<WorkflowOptimizerCandidateRequest>(
      `/companies/${companyId}/workflows/${workflowId}/optimizer-suggestions/${suggestionId}/propose`,
      {},
    ),
  compileOptimizerCandidate: (
    companyId: string,
    workflowId: string,
    suggestionId: string,
    input: WorkflowOptimizerCandidateRequest,
  ) =>
    api.post<{
      evaluationId: string;
      artifactId: string;
      artifactVersionId: string;
      replayEvaluation: OptimizerReplayEvaluation;
      gatesPassed: boolean;
    }>(
      `/companies/${companyId}/workflows/${workflowId}/optimizer-suggestions/${suggestionId}/compile`,
      input,
    ),
  optimizerAction: (
    companyId: string,
    workflowId: string,
    evaluationId: string,
    action:
      | "evaluate"
      | "shadow"
      | "request-approval"
      | "canary"
      | "activate"
      | "retire",
  ) =>
    api.post<{
      evaluationId: string;
      decision?: OptimizerPromotionDecision;
      approvalId?: string;
      gatesPassed?: boolean;
    }>(
      `/companies/${companyId}/workflows/${workflowId}/optimizer-evaluations/${evaluationId}/${action}`,
      {},
    ),
  runReview: (companyId: string, runId: string) =>
    api.get<WorkflowRunReview | null>(
      `/companies/${companyId}/workflow-runs/${runId}/review`,
    ),
  reviewRun: (
    companyId: string,
    runId: string,
    input: {
      humanCorrection: boolean;
      correctedOutputs: Record<string, unknown>;
      reason: string;
    },
  ) =>
    api.post<WorkflowRunReview>(
      `/companies/${companyId}/workflow-runs/${runId}/review`,
      input,
    ),
  toolReviews: (companyId: string, runId: string) =>
    api.get<{
      canReview: boolean;
      reviews: Array<{
        id: string;
        nodeId: string;
        toolName: string;
        status: string;
        risk: string | null;
        preview: string | null;
        argumentsSummary: { summary?: string } | null;
        approvalId: string | null;
        expiresAt: string | null;
      }>;
    }>(`/companies/${companyId}/workflow-runs/${runId}/tool-reviews`),
  resolveToolReview: (
    companyId: string,
    runId: string,
    requestId: string,
    decision: "approve" | "reject",
  ) =>
    api.post<WorkflowRunDetail>(
      `/companies/${companyId}/workflow-runs/${runId}/tool-reviews/${requestId}/${decision}`,
      {},
    ),
  dataSelector: (companyId: string, input: WorkflowDataSelectorRequest) =>
    api.post<WorkflowDataSelectorModel>(
      `/companies/${companyId}/workflows/data-selector`,
      input,
    ),
  capabilities: (companyId: string) =>
    api.get<WorkflowCapabilities>(
      `/companies/${companyId}/workflows/capabilities`,
    ),

  list: (companyId: string) =>
    api.get<Workflow[]>(`/companies/${companyId}/workflows`),

  get: (companyId: string, workflowId: string) =>
    api.get<WorkflowDetail>(`/companies/${companyId}/workflows/${workflowId}`),

  optimizerSuggestions: (companyId: string, workflowId: string) =>
    api.get<OptimizerSuggestionResponse>(
      `/companies/${companyId}/workflows/${workflowId}/optimizer-suggestions`,
    ),

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

  publish: (companyId: string, workflowId: string, input: PublishWorkflow) =>
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
    api.get<WorkflowRunDetail>(
      `/companies/${companyId}/workflow-runs/${runId}`,
    ),

  cancelRun: (companyId: string, runId: string, input: CancelWorkflowRun) =>
    api.post<WorkflowRunDetail>(
      `/companies/${companyId}/workflow-runs/${runId}/cancel`,
      input,
    ),

  retryRun: (
    companyId: string,
    runId: string,
    input: RetryWorkflowRun,
    idempotencyKey: string,
  ) =>
    api.post<WorkflowRunDetail>(
      `/companies/${companyId}/workflow-runs/${runId}/retry`,
      input,
      { headers: { "Idempotency-Key": idempotencyKey } },
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
});

export const workflowsApi = createWorkflowsApi();
