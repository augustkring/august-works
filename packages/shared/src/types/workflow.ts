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

export const WORKFLOW_CAPABILITY_KINDS = [
  "core_node",
  "connected_tool",
  "agent",
] as const;
export type WorkflowCapabilityKind = (typeof WORKFLOW_CAPABILITY_KINDS)[number];

export const WORKFLOW_CAPABILITY_AVAILABILITY = [
  "available",
  "degraded",
  "unavailable",
] as const;
export type WorkflowCapabilityAvailabilityStatus =
  (typeof WORKFLOW_CAPABILITY_AVAILABILITY)[number];

export type WorkflowCapabilityExecutionMode = "deterministic" | "agent";

export interface WorkflowCapabilityAvailability {
  status: WorkflowCapabilityAvailabilityStatus;
  reason: string | null;
}

export interface WorkflowCapabilityOperationalProfile {
  reliabilityBasis: "static_contract" | "connection_health" | "agent_status";
  reliabilitySignal: string;
  latencyProfile: string | null;
  costProfile: string | null;
}

export interface WorkflowCapabilitySource {
  registryNodeType?: string;
  catalogEntryId?: string;
  connectionId?: string;
  applicationId?: string | null;
  applicationName?: string | null;
  connectionName?: string;
  toolName?: string;
  agentId?: string;
  adapterType?: string;
  agentRole?: string;
}

export interface WorkflowCapabilityCandidate {
  id: string;
  kind: WorkflowCapabilityKind;
  title: string;
  description: string | null;
  nodeType: string;
  configTemplate: Record<string, unknown>;
  executionMode: WorkflowCapabilityExecutionMode;
  sideEffectClass: WorkflowSideEffectClass;
  riskClass: WorkflowRiskClass;
  inputSchema: WorkflowJsonSchema | null;
  outputSchema: WorkflowJsonSchema | null;
  requiredPermissions: string[];
  availability: WorkflowCapabilityAvailability;
  operationalProfile: WorkflowCapabilityOperationalProfile;
  publishState: WorkflowNodePublishState;
  publishBlockedReason: string | null;
  source: WorkflowCapabilitySource;
}

export interface WorkflowCapabilitySearchResult {
  query: string;
  candidates: WorkflowCapabilityCandidate[];
}

export const WORKFLOW_DATA_SELECTOR_SOURCE_KINDS = [
  "variables",
  "trigger",
  "step",
] as const;
export type WorkflowDataSelectorSourceKind =
  (typeof WORKFLOW_DATA_SELECTOR_SOURCE_KINDS)[number];

export const WORKFLOW_DATA_VALUE_TYPES = [
  "object",
  "array",
  "string",
  "number",
  "integer",
  "boolean",
  "null",
  "unknown",
] as const;
export type WorkflowDataValueType = (typeof WORKFLOW_DATA_VALUE_TYPES)[number];

export interface WorkflowDataSelectorField {
  key: string;
  label: string;
  path: string;
  expression: string;
  valueType: WorkflowDataValueType;
  required: boolean;
  sampleValue: unknown | null;
  children: WorkflowDataSelectorField[];
}

export interface WorkflowDataSelectorSource {
  id: string;
  kind: WorkflowDataSelectorSourceKind;
  label: string;
  expression: string;
  nodeId: string | null;
  nodeType: string | null;
  schema: WorkflowJsonSchema | null;
  fields: WorkflowDataSelectorField[];
  sampleData: unknown | null;
}

export interface WorkflowDataSelectorModel {
  targetNodeId: string;
  sources: WorkflowDataSelectorSource[];
}

export const WORKFLOW_RUN_STATUSES = [
  "queued",
  "running",
  "waiting",
  "recovering",
  "cancelling",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];

export const WORKFLOW_RUN_SOURCES = [
  "manual",
  "schedule",
  "webhook",
  "api",
  "connector_event",
  "routine",
  "pipeline",
  "task",
] as const;
export type WorkflowRunSource = (typeof WORKFLOW_RUN_SOURCES)[number];

export const WORKFLOW_STEP_RUN_STATUSES = [
  "pending",
  "running",
  "waiting",
  "retry_scheduled",
  "retried",
  "succeeded",
  "failed",
  "skipped",
  "cancelling",
  "cancelled",
] as const;
export type WorkflowStepRunStatus =
  (typeof WORKFLOW_STEP_RUN_STATUSES)[number];

export interface WorkflowRun {
  id: string;
  companyId: string;
  workflowId: string;
  workflowRevisionId: string;
  triggerId: string | null;
  status: WorkflowRunStatus;
  source: WorkflowRunSource;
  triggerPayload: Record<string, unknown>;
  responsibleUserId: string | null;
  idempotencyKey: string | null;
  correlationId: string | null;
  retryOfRunId?: string | null;
  idempotencyRootRunId?: string | null;
  executionOwnerId: string | null;
  leaseExpiresAt: Date | null;
  ownerHeartbeatAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkflowStepRun {
  id: string;
  companyId: string;
  workflowRunId: string;
  nodeId: string;
  attempt: number;
  status: WorkflowStepRunStatus;
  inputJson: unknown;
  outputJson: unknown;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  agentId: string | null;
  heartbeatRunId: string | null;
  toolInvocationId: string | null;
  automationArtifactVersionId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const WORKFLOW_WAIT_KINDS = [
  "delay",
  "human_interaction",
  "external_callback",
  "task_completion",
  "external_agent_run",
] as const;
export type WorkflowWaitKind = (typeof WORKFLOW_WAIT_KINDS)[number];

export const WORKFLOW_WAIT_STATUSES = [
  "active",
  "resolved",
  "timed_out",
  "cancelled",
] as const;
export type WorkflowWaitStatus = (typeof WORKFLOW_WAIT_STATUSES)[number];

export interface WorkflowWait {
  id: string;
  companyId: string;
  workflowRunId: string;
  nodeId: string;
  waitKey: string;
  kind: WorkflowWaitKind;
  status: WorkflowWaitStatus;
  wakeAt: Date | null;
  timeoutAt: Date | null;
  referenceType: string | null;
  referenceId: string | null;
  signalTokenHash: string | null;
  resolutionJson: unknown;
  resolvedByType: string | null;
  resolvedById: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkflowRunDetail {
  run: WorkflowRun;
  steps: WorkflowStepRun[];
  waits: WorkflowWait[];
}
