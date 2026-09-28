export const WORKFLOW_STATUSES = ["active", "paused", "archived"] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export const WORKFLOW_REVISION_STATES = [
  "draft",
  "published",
  "superseded",
  "discarded",
] as const;
export type WorkflowRevisionState = (typeof WORKFLOW_REVISION_STATES)[number];

export const WORKFLOW_RETRY_MODES = ["none", "fixed", "exponential"] as const;
export type WorkflowRetryMode = (typeof WORKFLOW_RETRY_MODES)[number];

export interface WorkflowRetryPolicy {
  mode: WorkflowRetryMode;
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
}

export interface WorkflowNodePosition {
  x: number;
  y: number;
}

export interface WorkflowNodeV1 {
  id: string;
  type: string;
  name: string;
  position: WorkflowNodePosition;
  config: unknown;
  retryPolicy?: WorkflowRetryPolicy;
  timeoutSeconds?: number;
  continueOnFailure?: boolean;
}

export interface WorkflowEdgeV1 {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: string | null;
}

export interface WorkflowVariableV1 {
  name: string;
  description?: string | null;
  required?: boolean;
  defaultValue?: unknown;
}

export interface WorkflowSettingsV1 {
  totalDeadlineSeconds?: number | null;
}

export interface WorkflowGraphV1 {
  version: 1;
  nodes: WorkflowNodeV1[];
  edges: WorkflowEdgeV1[];
  variables: WorkflowVariableV1[];
  settings: WorkflowSettingsV1;
}

export type WorkflowJsonSchema = Record<string, unknown>;

export interface Workflow {
  id: string;
  companyId: string;
  projectId: string | null;
  folderId: string | null;
  name: string;
  description: string | null;
  status: WorkflowStatus;
  publishedRevisionId: string | null;
  draftRevisionId: string | null;
  createdByUserId: string | null;
  createdByAgentId: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface WorkflowRevision {
  id: string;
  companyId: string;
  workflowId: string;
  revisionNumber: number;
  state: WorkflowRevisionState;
  graph: WorkflowGraphV1;
  inputSchema: WorkflowJsonSchema | null;
  outputSchema: WorkflowJsonSchema | null;
  changeSummary: string | null;
  createdByUserId: string | null;
  createdByAgentId: string | null;
  createdByRunId: string | null;
  createdAt: Date;
}

export interface WorkflowDetail extends Workflow {
  draftRevision: WorkflowRevision | null;
  publishedRevision: WorkflowRevision | null;
}

export interface WorkflowCapabilities {
  read: boolean;
  edit: boolean;
  publish: boolean;
  run: boolean;
}
