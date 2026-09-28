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


export const WORKFLOW_NODE_CATEGORIES = [
  "trigger",
  "control",
  "transform",
  "connector",
  "work",
  "agent",
  "human",
  "native",
] as const;
export type WorkflowNodeCategory = (typeof WORKFLOW_NODE_CATEGORIES)[number];

export const WORKFLOW_SIDE_EFFECT_CLASSES = [
  "pure",
  "read",
  "write",
  "destructive",
  "external_communication",
  "financial",
  "privileged",
] as const;
export type WorkflowSideEffectClass = (typeof WORKFLOW_SIDE_EFFECT_CLASSES)[number];

export const WORKFLOW_RISK_CLASSES = ["C0", "C1", "C2", "C3", "C4"] as const;
export type WorkflowRiskClass = (typeof WORKFLOW_RISK_CLASSES)[number];

export const WORKFLOW_NODE_PUBLISH_STATES = ["ready", "draft_only"] as const;
export type WorkflowNodePublishState = (typeof WORKFLOW_NODE_PUBLISH_STATES)[number];

export const WORKFLOW_NODE_TEST_MODES = [
  "safe",
  "dry_run",
  "sandbox",
  "live_only",
  "unavailable",
] as const;
export type WorkflowNodeTestMode = (typeof WORKFLOW_NODE_TEST_MODES)[number];

export const WORKFLOW_NODE_CANCELLATION_MODES = [
  "none",
  "cooperative",
  "durable_wait",
] as const;
export type WorkflowNodeCancellationMode =
  (typeof WORKFLOW_NODE_CANCELLATION_MODES)[number];

export const WORKFLOW_NODE_IDEMPOTENCY_STRATEGIES = [
  "not_required",
  "workflow_step_key",
  "provider_passthrough",
  "durable_receipt",
] as const;
export type WorkflowNodeIdempotencyStrategy =
  (typeof WORKFLOW_NODE_IDEMPOTENCY_STRATEGIES)[number];

export interface WorkflowNodeAuthorizationRequirement {
  permission: string;
  timing: "publish" | "execution";
  description: string;
}

export interface WorkflowNodeAccessibilityContract {
  label: string;
  description: string;
  supportsKeyboardInsert: boolean;
  supportsOutlineEdit: boolean;
}

export interface WorkflowNodeDefinitionDescriptor {
  type: string;
  version: number;
  category: WorkflowNodeCategory;
  displayName: string;
  description: string;
  inputSchema: WorkflowJsonSchema | null;
  outputSchema: WorkflowJsonSchema | null;
  configSchema: WorkflowJsonSchema;
  sideEffectClass: WorkflowSideEffectClass;
  riskDefault: WorkflowRiskClass;
  authorizationRequirements: WorkflowNodeAuthorizationRequirement[];
  timeoutDefaultSeconds: number | null;
  retryPolicyDefault: WorkflowRetryPolicy;
  idempotencyStrategy: WorkflowNodeIdempotencyStrategy;
  cancellationSupport: WorkflowNodeCancellationMode;
  testMode: WorkflowNodeTestMode;
  failureOutputs: string[];
  auditEvents: string[];
  uiComponent: string;
  accessibilityContract: WorkflowNodeAccessibilityContract;
  publishState: WorkflowNodePublishState;
  publishBlockedReason: string | null;
}
