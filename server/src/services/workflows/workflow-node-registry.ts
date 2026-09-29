import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import {
  agents,
  companyMemberships,
  projects,
  toolCatalogEntries,
  toolConnections,
} from "@paperclipai/db";
import {
  workflowGraphV1Schema,
  type WorkflowGraphV1,
  type WorkflowNodeDefinitionDescriptor,
  type WorkflowRetryPolicy,
} from "@paperclipai/shared";
import { unprocessable } from "../../errors.js";
import { parseWorkflowConditionExpression } from "./workflow-condition-expression.js";
import {
  descriptorRetryIsStructurallySafe,
  effectiveWorkflowRetryPolicy,
} from "./workflow-execution-policy.js";

type NodeConfigSchema = z.ZodType;

interface RegisteredWorkflowNode {
  descriptor: WorkflowNodeDefinitionDescriptor;
  configValidator: NodeConfigSchema;
  validateReferences?: (
    db: Db,
    companyId: string,
    nodeId: string,
    config: Record<string, unknown>,
    mode: "draft" | "publish",
  ) => Promise<void>;
}

const NO_RETRY: WorkflowRetryPolicy = {
  mode: "none",
  maxAttempts: 1,
  initialDelayMs: 0,
  maxDelayMs: 0,
};

const STANDARD_RETRY: WorkflowRetryPolicy = {
  mode: "fixed",
  maxAttempts: 3,
  initialDelayMs: 1_000,
  maxDelayMs: 5_000,
};

const emptyObjectSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

const manualTriggerConfig = z.object({}).strict();
const transformConfig = z.object({
  mapping: z.record(z.string(), z.string()).refine(
    (mapping) => Object.keys(mapping).length >= 1 && Object.keys(mapping).length <= 100,
    "Transform mapping must contain between 1 and 100 fields",
  ),
}).strict();
const conditionConfig = z.object({
  expression: z.string().trim().min(1).max(5_000),
}).strict().superRefine((value, ctx) => {
  try {
    parseWorkflowConditionExpression(value.expression);
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["expression"],
      message: error instanceof Error ? error.message : "Invalid condition expression",
    });
  }
});
const waitConfig = z.object({
  durationSeconds: z.number().int().min(1).max(604_800),
}).strict();
const connectorActionConfig = z.object({
  toolCatalogEntryId: z.string().guid(),
  connectionId: z.string().guid(),
  input: z.record(z.string(), z.unknown()).optional().default({}),
}).strict();
const createTaskConfig = z.object({
  title: z.string().trim().min(1).max(500),
  description: z.string().max(20_000).nullable().optional(),
  projectId: z.string().guid().nullable().optional(),
  assigneeAgentId: z.string().guid().nullable().optional(),
  assigneeUserId: z.string().trim().min(1).max(255).nullable().optional(),
  waitForCompletion: z.boolean().optional().default(false),
}).strict().superRefine((value, ctx) => {
  if (value.assigneeAgentId && value.assigneeUserId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Create Task may target either an agent or a user, not both",
    });
  }
});
const agentTaskConfig = z.object({
  agentId: z.string().guid(),
  objective: z.string().trim().min(1).max(10_000),
  waitForCompletion: z.boolean().optional().default(true),
  expectedOutputSchema: z.record(z.string(), z.unknown()).nullable().optional(),
}).strict();
const externalAgentConfig = z.object({
  agentId: z.string().guid(),
  objective: z.string().trim().min(1).max(10_000),
  structuredInput: z.record(z.string(), z.unknown()).optional().default({}),
  expectedOutputSchema: z.record(z.string(), z.unknown()).nullable().optional(),
  timeoutSeconds: z.number().int().min(1).max(3_600).optional().default(120),
  allowedCapabilityScope: z.literal("binding_grants").optional().default("binding_grants"),
  fallbackPolicy: z.literal("fail").optional().default("fail"),
}).strict();
const humanApprovalConfig = z.object({
  summary: z.string().trim().min(1).max(1_000),
  consequence: z.string().trim().min(1).max(2_000),
}).strict();

function invalidNode(
  message: string,
  details: Record<string, unknown>,
): never {
  throw unprocessable(message, {
    code: "workflow_node_invalid",
    ...details,
  });
}

function invalidGraph(
  message: string,
  details: Record<string, unknown>,
): never {
  throw unprocessable(message, {
    code: "workflow_graph_invalid",
    ...details,
  });
}

async function requireProject(db: Db, companyId: string, nodeId: string, projectId: string) {
  const project = await db.select({ id: projects.id }).from(projects)
    .where(and(eq(projects.companyId, companyId), eq(projects.id, projectId)))
    .then((rows) => rows[0] ?? null);
  if (!project) {
    invalidNode("Workflow node references a project outside the company", {
      reason: "cross_company_reference",
      nodeId,
      referenceType: "project",
      referenceId: projectId,
    });
  }
}

async function requireAgent(db: Db, companyId: string, nodeId: string, agentId: string) {
  const agent = await db.select({ id: agents.id }).from(agents)
    .where(and(eq(agents.companyId, companyId), eq(agents.id, agentId)))
    .then((rows) => rows[0] ?? null);
  if (!agent) {
    invalidNode("Workflow node references an agent outside the company", {
      reason: "cross_company_reference",
      nodeId,
      referenceType: "agent",
      referenceId: agentId,
    });
  }
}

async function requireOpenClawAgent(
  db: Db,
  companyId: string,
  nodeId: string,
  agentId: string,
) {
  const agent = await db
    .select({
      id: agents.id,
      adapterType: agents.adapterType,
      status: agents.status,
    })
    .from(agents)
    .where(and(eq(agents.companyId, companyId), eq(agents.id, agentId)))
    .then((rows) => rows[0] ?? null);
  if (!agent) {
    invalidNode("External Agent node references an agent outside the company", {
      reason: "cross_company_reference",
      nodeId,
      referenceType: "agent",
      referenceId: agentId,
    });
  }
  if (agent.adapterType !== "openclaw_gateway") {
    invalidNode("External Agent must reference an OpenClaw Gateway agent", {
      reason: "external_agent_binding_invalid",
      nodeId,
      referenceType: "agent",
      referenceId: agentId,
      adapterType: agent.adapterType,
    });
  }
  if (agent.status === "terminated") {
    invalidNode("External Agent binding is terminated", {
      reason: "external_agent_binding_unavailable",
      nodeId,
      referenceType: "agent",
      referenceId: agentId,
      status: agent.status,
    });
  }
  return agent;
}

async function requireUser(db: Db, companyId: string, nodeId: string, userId: string) {
  const member = await db.select({ id: companyMemberships.id }).from(companyMemberships)
    .where(and(
      eq(companyMemberships.companyId, companyId),
      eq(companyMemberships.principalType, "user"),
      eq(companyMemberships.principalId, userId),
      eq(companyMemberships.status, "active"),
    ))
    .then((rows) => rows[0] ?? null);
  if (!member) {
    invalidNode("Workflow node references a user outside active company membership", {
      reason: "cross_company_reference",
      nodeId,
      referenceType: "user",
      referenceId: userId,
    });
  }
}

function descriptor(
  value: WorkflowNodeDefinitionDescriptor,
): WorkflowNodeDefinitionDescriptor {
  return value;
}

const REGISTRY: RegisteredWorkflowNode[] = [
  {
    descriptor: descriptor({
      type: "core.manual_trigger",
      version: 1,
      category: "trigger",
      displayName: "Manual Trigger",
      description: "Starts a workflow explicitly from an authenticated manual invocation.",
      inputSchema: { type: "object", additionalProperties: true },
      outputSchema: { type: "object", additionalProperties: true },
      configSchema: emptyObjectSchema,
      sideEffectClass: "pure",
      riskDefault: "C0",
      authorizationRequirements: [],
      timeoutDefaultSeconds: null,
      retryPolicyDefault: NO_RETRY,
      idempotencyStrategy: "not_required",
      cancellationSupport: "none",
      testMode: "safe",
      failureOutputs: [],
      auditEvents: [],
      uiComponent: "manual_trigger",
      accessibilityContract: {
        label: "Manual trigger",
        description: "Start point for a manually invoked workflow.",
        supportsKeyboardInsert: true,
        supportsOutlineEdit: true,
      },
      publishState: "ready",
      publishBlockedReason: null,
    }),
    configValidator: manualTriggerConfig,
  },
  {
    descriptor: descriptor({
      type: "core.transform",
      version: 1,
      category: "transform",
      displayName: "Transform",
      description: "Maps prior typed values into a deterministic output shape.",
      inputSchema: { type: "object", additionalProperties: true },
      outputSchema: { type: "object", additionalProperties: true },
      configSchema: {
        type: "object",
        required: ["mapping"],
        properties: {
          mapping: {
            type: "object",
            minProperties: 1,
            additionalProperties: { type: "string" },
          },
        },
        additionalProperties: false,
      },
      sideEffectClass: "pure",
      riskDefault: "C0",
      authorizationRequirements: [],
      timeoutDefaultSeconds: 10,
      retryPolicyDefault: NO_RETRY,
      idempotencyStrategy: "not_required",
      cancellationSupport: "none",
      testMode: "safe",
      failureOutputs: ["expression_invalid"],
      auditEvents: [],
      uiComponent: "transform",
      accessibilityContract: {
        label: "Transform",
        description: "Deterministically map prior outputs or variables.",
        supportsKeyboardInsert: true,
        supportsOutlineEdit: true,
      },
      publishState: "draft_only",
      publishBlockedReason: "expression_engine_not_ready",
    }),
    configValidator: transformConfig,
  },
  {
    descriptor: descriptor({
      type: "core.condition",
      version: 1,
      category: "control",
      displayName: "Condition",
      description: "Evaluates a deterministic boolean expression.",
      inputSchema: { type: "object", additionalProperties: true },
      outputSchema: {
        type: "object",
        required: ["result"],
        properties: { result: { type: "boolean" } },
        additionalProperties: false,
      },
      configSchema: {
        type: "object",
        required: ["expression"],
        properties: { expression: { type: "string", minLength: 1, maxLength: 5_000 } },
        additionalProperties: false,
      },
      sideEffectClass: "pure",
      riskDefault: "C0",
      authorizationRequirements: [],
      timeoutDefaultSeconds: 5,
      retryPolicyDefault: NO_RETRY,
      idempotencyStrategy: "not_required",
      cancellationSupport: "none",
      testMode: "safe",
      failureOutputs: ["expression_invalid"],
      auditEvents: [],
      uiComponent: "condition",
      accessibilityContract: {
        label: "Condition",
        description: "Branch from a deterministic true or false result.",
        supportsKeyboardInsert: true,
        supportsOutlineEdit: true,
      },
      publishState: "ready",
      publishBlockedReason: null,
    }),
    configValidator: conditionConfig,
  },
  {
    descriptor: descriptor({
      type: "core.wait",
      version: 1,
      category: "control",
      displayName: "Wait",
      description: "Pauses execution durably for a bounded amount of time without keeping a worker or request open.",
      inputSchema: { type: "object", additionalProperties: true },
      outputSchema: {
        type: "object",
        required: ["reason", "resumedAt"],
        properties: {
          reason: { type: "string", enum: ["delay_elapsed"] },
          resumedAt: { type: "string" },
        },
        additionalProperties: false,
      },
      configSchema: {
        type: "object",
        required: ["durationSeconds"],
        properties: {
          durationSeconds: { type: "integer", minimum: 1, maximum: 604_800 },
        },
        additionalProperties: false,
      },
      sideEffectClass: "pure",
      riskDefault: "C0",
      authorizationRequirements: [],
      timeoutDefaultSeconds: null,
      retryPolicyDefault: NO_RETRY,
      idempotencyStrategy: "workflow_step_key",
      cancellationSupport: "durable_wait",
      testMode: "safe",
      failureOutputs: ["workflow_wait_timeout", "cancelled"],
      auditEvents: ["workflow.wait_created", "workflow.wait_resolved"],
      uiComponent: "wait",
      accessibilityContract: {
        label: "Wait",
        description: "Pause this workflow durably before continuing.",
        supportsKeyboardInsert: true,
        supportsOutlineEdit: true,
      },
      publishState: "ready",
      publishBlockedReason: null,
    }),
    configValidator: waitConfig,
  },
  {
    descriptor: descriptor({
      type: "connector.action",
      version: 1,
      category: "connector",
      displayName: "Connector Action",
      description: "Invokes one existing governed Tool Catalogue entry through a selected connection.",
      inputSchema: { type: "object", additionalProperties: true },
      outputSchema: null,
      configSchema: {
        type: "object",
        required: ["toolCatalogEntryId", "connectionId"],
        properties: {
          toolCatalogEntryId: { type: "string", format: "uuid" },
          connectionId: { type: "string", format: "uuid" },
          input: { type: "object", additionalProperties: true },
        },
        additionalProperties: false,
      },
      sideEffectClass: "write",
      riskDefault: "C2",
      authorizationRequirements: [{
        permission: "tools:use",
        timing: "execution",
        description: "Resolved again at execution time against the selected connection and grant.",
      }],
      timeoutDefaultSeconds: 30,
      retryPolicyDefault: STANDARD_RETRY,
      idempotencyStrategy: "provider_passthrough",
      cancellationSupport: "cooperative",
      testMode: "dry_run",
      failureOutputs: ["tool_unavailable", "permission_denied", "tool_failed"],
      auditEvents: ["tool.invoked", "tool.denied"],
      uiComponent: "connector_action",
      accessibilityContract: {
        label: "Connector action",
        description: "Invoke a governed connected-tool action.",
        supportsKeyboardInsert: true,
        supportsOutlineEdit: true,
      },
      publishState: "draft_only",
      publishBlockedReason: "connector_execution_policy_not_ready",
    }),
    configValidator: connectorActionConfig,
    validateReferences: async (db, companyId, nodeId, config) => {
      const parsed = connectorActionConfig.parse(config);
      const [entry, connection] = await Promise.all([
        db.select({
          id: toolCatalogEntries.id,
          connectionId: toolCatalogEntries.connectionId,
        }).from(toolCatalogEntries)
          .where(and(
            eq(toolCatalogEntries.companyId, companyId),
            eq(toolCatalogEntries.id, parsed.toolCatalogEntryId),
          ))
          .then((rows) => rows[0] ?? null),
        db.select({ id: toolConnections.id }).from(toolConnections)
          .where(and(
            eq(toolConnections.companyId, companyId),
            eq(toolConnections.id, parsed.connectionId),
          ))
          .then((rows) => rows[0] ?? null),
      ]);
      if (!entry || !connection || entry.connectionId !== connection.id) {
        invalidNode("Connector Action references an invalid company-scoped tool/connection pair", {
          reason: "cross_company_reference",
          nodeId,
          referenceType: "connector",
        });
      }
    },
  },
  {
    descriptor: descriptor({
      type: "work.create_task",
      version: 1,
      category: "work",
      displayName: "Create Task",
      description: "Creates accountable work using the existing task/issue primitive.",
      inputSchema: { type: "object", additionalProperties: true },
      outputSchema: {
        type: "object",
        properties: {
          issueId: { type: "string", format: "uuid" },
          identifier: { type: ["string", "null"] },
          status: { type: "string" },
        },
        required: ["issueId", "status"],
        additionalProperties: false,
      },
      configSchema: {
        type: "object",
        required: ["title"],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 500 },
          description: { type: ["string", "null"] },
          projectId: { type: ["string", "null"], format: "uuid" },
          assigneeAgentId: { type: ["string", "null"], format: "uuid" },
          assigneeUserId: { type: ["string", "null"] },
          waitForCompletion: { type: "boolean", default: false },
        },
        additionalProperties: false,
      },
      sideEffectClass: "write",
      riskDefault: "C1",
      authorizationRequirements: [{
        permission: "tasks:assign",
        timing: "execution",
        description: "Task assignment is authorized against the final target at execution time.",
      }],
      timeoutDefaultSeconds: 15,
      retryPolicyDefault: STANDARD_RETRY,
      idempotencyStrategy: "workflow_step_key",
      cancellationSupport: "none",
      testMode: "dry_run",
      failureOutputs: [
        "workflow_task_permission_denied",
        "workflow_task_create_failed",
        "workflow_task_cancelled",
        "workflow_task_missing",
      ],
      auditEvents: [
        "workflow.task_created",
        "workflow.task_waiting",
        "workflow.task_completed",
      ],
      uiComponent: "create_task",
      accessibilityContract: {
        label: "Create task",
        description: "Create accountable work for a person or agent.",
        supportsKeyboardInsert: true,
        supportsOutlineEdit: true,
      },
      publishState: "ready",
      publishBlockedReason: null,
    }),
    configValidator: createTaskConfig,
    validateReferences: async (db, companyId, nodeId, config) => {
      const parsed = createTaskConfig.parse(config);
      if (parsed.projectId) await requireProject(db, companyId, nodeId, parsed.projectId);
      if (parsed.assigneeAgentId) await requireAgent(db, companyId, nodeId, parsed.assigneeAgentId);
      if (parsed.assigneeUserId) await requireUser(db, companyId, nodeId, parsed.assigneeUserId);
    },
  },
  {
    descriptor: descriptor({
      type: "agent.task",
      version: 1,
      category: "agent",
      displayName: "Agent Task",
      description: "Delegates substantive accountable work to an August Works agent.",
      inputSchema: { type: "object", additionalProperties: true },
      outputSchema: {
        type: "object",
        properties: {
          issueId: { type: "string", format: "uuid" },
          identifier: { type: ["string", "null"] },
          status: { type: "string" },
          agentId: { type: "string", format: "uuid" },
          heartbeatRunId: { type: ["string", "null"], format: "uuid" },
        },
        required: ["issueId", "status", "agentId", "heartbeatRunId"],
        additionalProperties: false,
      },
      configSchema: {
        type: "object",
        required: ["agentId", "objective"],
        properties: {
          agentId: { type: "string", format: "uuid" },
          objective: { type: "string", minLength: 1, maxLength: 10_000 },
          waitForCompletion: { type: "boolean" },
          expectedOutputSchema: { type: ["object", "null"], additionalProperties: true },
        },
        additionalProperties: false,
      },
      sideEffectClass: "write",
      riskDefault: "C2",
      authorizationRequirements: [{
        permission: "tasks:assign",
        timing: "execution",
        description: "The target agent and delegated work scope are authorized at execution time.",
      }],
      timeoutDefaultSeconds: 900,
      retryPolicyDefault: STANDARD_RETRY,
      idempotencyStrategy: "workflow_step_key",
      cancellationSupport: "cooperative",
      testMode: "sandbox",
      failureOutputs: [
        "workflow_agent_task_config_invalid",
        "workflow_agent_task_structured_output_not_ready",
        "workflow_agent_unavailable",
        "workflow_agent_wakeup_failed",
        "workflow_task_permission_denied",
        "workflow_task_cancelled",
        "workflow_task_missing",
      ],
      auditEvents: [
        "workflow.agent_task_created",
        "workflow.agent_task_delegated",
        "workflow.agent_task_completed",
      ],
      uiComponent: "agent_task",
      accessibilityContract: {
        label: "Agent task",
        description: "Delegate accountable work to an August Works agent.",
        supportsKeyboardInsert: true,
        supportsOutlineEdit: true,
      },
      publishState: "ready",
      publishBlockedReason: null,
    }),
    configValidator: agentTaskConfig,
    validateReferences: async (db, companyId, nodeId, config, mode) => {
      const parsed = agentTaskConfig.parse(config);
      await requireAgent(db, companyId, nodeId, parsed.agentId);
      if (mode === "publish" && parsed.expectedOutputSchema != null) {
        invalidNode(
          "Structured Agent Task output is not publishable until the task runtime exposes an authoritative structured-result channel",
          {
            reason: "workflow_agent_task_structured_output_not_ready",
            nodeId,
            nodeType: "agent.task",
          },
        );
      }
    },
  },
  {
    descriptor: descriptor({
      type: "agent.external",
      version: 1,
      category: "agent",
      displayName: "External Agent",
      description: "Runs a bounded task through an existing governed OpenClaw Gateway agent binding.",
      inputSchema: { type: "object", additionalProperties: true },
      outputSchema: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["succeeded"] },
          output: {},
          artifacts: { type: "array", items: { type: "object", additionalProperties: true } },
          usage: { type: "object", additionalProperties: true },
          externalRunId: { type: "string" },
          issueId: { type: "string", format: "uuid" },
          agentId: { type: "string", format: "uuid" },
          heartbeatRunId: { type: "string", format: "uuid" },
        },
        required: [
          "status",
          "output",
          "artifacts",
          "usage",
          "externalRunId",
          "issueId",
          "agentId",
          "heartbeatRunId",
        ],
        additionalProperties: false,
      },
      configSchema: {
        type: "object",
        required: ["agentId", "objective"],
        properties: {
          agentId: { type: "string", format: "uuid" },
          objective: { type: "string", minLength: 1, maxLength: 10_000 },
          structuredInput: { type: "object", additionalProperties: true },
          expectedOutputSchema: { type: ["object", "null"], additionalProperties: true },
          timeoutSeconds: { type: "integer", minimum: 1, maximum: 3_600 },
          allowedCapabilityScope: { type: "string", enum: ["binding_grants"] },
          fallbackPolicy: { type: "string", enum: ["fail"] },
        },
        additionalProperties: false,
      },
      sideEffectClass: "write",
      riskDefault: "C3",
      authorizationRequirements: [{
        permission: "tasks:assign",
        timing: "execution",
        description: "External work is delegated only through an accountable company task assigned to the selected OpenClaw agent.",
      }],
      timeoutDefaultSeconds: 120,
      retryPolicyDefault: STANDARD_RETRY,
      idempotencyStrategy: "workflow_step_key",
      cancellationSupport: "cooperative",
      testMode: "sandbox",
      failureOutputs: [
        "workflow_external_agent_config_invalid",
        "workflow_external_agent_binding_invalid",
        "workflow_external_agent_unavailable",
        "workflow_external_agent_failed",
        "workflow_external_agent_timeout",
        "workflow_external_agent_cancelled",
        "workflow_external_agent_result_missing",
        "workflow_output_schema_invalid",
        "workflow_output_schema_mismatch",
      ],
      auditEvents: [
        "workflow.external_agent_requested",
        "workflow.external_agent_dispatched",
        "workflow.external_agent_completed",
      ],
      uiComponent: "external_agent",
      accessibilityContract: {
        label: "External agent",
        description: "Run accountable work through a governed OpenClaw Gateway agent.",
        supportsKeyboardInsert: true,
        supportsOutlineEdit: true,
      },
      publishState: "draft_only",
      publishBlockedReason: "external_agent_executor_not_ready",
    }),
    configValidator: externalAgentConfig,
    validateReferences: async (db, companyId, nodeId, config) => {
      const parsed = externalAgentConfig.parse(config);
      await requireOpenClawAgent(db, companyId, nodeId, parsed.agentId);
    },
  },
  {
    descriptor: descriptor({
      type: "human.approval",
      version: 1,
      category: "human",
      displayName: "Human Approval",
      description: "Creates a durable human approval checkpoint with an explicit consequence summary.",
      inputSchema: { type: "object", additionalProperties: true },
      outputSchema: {
        type: "object",
        properties: {
          decision: { type: "string", enum: ["approved", "rejected"] },
        },
        required: ["decision"],
        additionalProperties: false,
      },
      configSchema: {
        type: "object",
        required: ["summary", "consequence"],
        properties: {
          summary: { type: "string", minLength: 1, maxLength: 1_000 },
          consequence: { type: "string", minLength: 1, maxLength: 2_000 },
        },
        additionalProperties: false,
      },
      sideEffectClass: "privileged",
      riskDefault: "C3",
      authorizationRequirements: [],
      timeoutDefaultSeconds: null,
      retryPolicyDefault: NO_RETRY,
      idempotencyStrategy: "workflow_step_key",
      cancellationSupport: "durable_wait",
      testMode: "safe",
      failureOutputs: ["rejected", "cancelled"],
      auditEvents: ["tool.approval_requested"],
      uiComponent: "human_approval",
      accessibilityContract: {
        label: "Human approval",
        description: "Pause until a person approves or rejects a clearly stated consequence.",
        supportsKeyboardInsert: true,
        supportsOutlineEdit: true,
      },
      publishState: "ready",
      publishBlockedReason: null,
    }),
    configValidator: humanApprovalConfig,
  },
];

const REGISTRY_BY_TYPE = new Map(REGISTRY.map((entry) => [entry.descriptor.type, entry]));

const EXPLICIT_SPLIT_NODE_TYPES = new Set([
  "core.condition",
  "core.switch",
  "core.parallel",
]);

const EXPLICIT_MERGE_NODE_TYPES = new Set([
  "core.merge",
]);

export function validateWorkflowPublishTopology(graph: WorkflowGraphV1): void {
  const triggerNodes = graph.nodes.filter(
    (node) => REGISTRY_BY_TYPE.get(node.type)?.descriptor.category === "trigger",
  );
  if (triggerNodes.length !== 1) {
    invalidGraph("Published workflow must have exactly one effective entry trigger", {
      reason: "entry_trigger_count",
      triggerCount: triggerNodes.length,
    });
  }

  const incoming = new Map(graph.nodes.map((node) => [node.id, 0] as const));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, [] as string[]] as const));

  for (const edge of graph.edges) {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  }

  // Arbitrary graph cycles are forbidden in V1. Loops must later be represented
  // by an explicit bounded Loop/Map node with its own execution contract.
  const indegree = new Map(incoming);
  const queue = graph.nodes
    .filter((node) => (indegree.get(node.id) ?? 0) === 0)
    .map((node) => node.id);
  let visitedCount = 0;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const nodeId = queue[cursor]!;
    visitedCount += 1;
    for (const target of outgoing.get(nodeId) ?? []) {
      const next = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, next);
      if (next === 0) queue.push(target);
    }
  }
  if (visitedCount !== graph.nodes.length) {
    invalidGraph("Published workflow cannot contain an arbitrary graph cycle", {
      reason: "cycle_requires_explicit_loop",
    });
  }

  const trigger = triggerNodes[0]!;
  if ((incoming.get(trigger.id) ?? 0) !== 0) {
    invalidGraph("Workflow entry trigger cannot have incoming edges", {
      reason: "trigger_has_incoming_edge",
      nodeId: trigger.id,
    });
  }

  const reachable = new Set<string>();
  const stack = [trigger.id];
  while (stack.length > 0) {
    const nodeId = stack.pop()!;
    if (reachable.has(nodeId)) continue;
    reachable.add(nodeId);
    for (const target of outgoing.get(nodeId) ?? []) stack.push(target);
  }

  const unreachable = graph.nodes
    .filter((node) => !reachable.has(node.id))
    .map((node) => node.id)
    .sort();
  if (unreachable.length > 0) {
    invalidGraph("Published workflow contains unreachable executable nodes", {
      reason: "unreachable_nodes",
      nodeIds: unreachable,
    });
  }

  for (const node of graph.nodes) {
    const outgoingCount = outgoing.get(node.id)?.length ?? 0;
    const nodeOutgoingEdges = graph.edges.filter((edge) => edge.source === node.id);

    if (node.type === "core.condition" && nodeOutgoingEdges.length > 0) {
      const branchKeys = nodeOutgoingEdges.map((edge) =>
        (edge.sourceHandle ?? edge.label ?? "").trim().toLowerCase(),
      );
      if (
        nodeOutgoingEdges.length !== 2 ||
        new Set(branchKeys).size !== 2 ||
        !branchKeys.includes("true") ||
        !branchKeys.includes("false")
      ) {
        invalidGraph("Condition branches must define exactly one true and one false path", {
          reason: "condition_branches_invalid",
          nodeId: node.id,
          branchKeys,
        });
      }
    }

    if (outgoingCount > 1 && !EXPLICIT_SPLIT_NODE_TYPES.has(node.type)) {
      invalidGraph("Published workflow requires an explicit branch/split node for parallel outgoing paths", {
        reason: "implicit_parallel_split",
        nodeId: node.id,
        nodeType: node.type,
        outgoingCount,
      });
    }

    const incomingCount = incoming.get(node.id) ?? 0;
    if (incomingCount > 1 && !EXPLICIT_MERGE_NODE_TYPES.has(node.type)) {
      invalidGraph("Published workflow requires an explicit merge node for multiple incoming paths", {
        reason: "implicit_merge",
        nodeId: node.id,
        nodeType: node.type,
        incomingCount,
      });
    }
  }
}

export function workflowNodeDefinitions(): WorkflowNodeDefinitionDescriptor[] {
  return REGISTRY
    .map((entry) => entry.descriptor)
    .sort((left, right) =>
      left.category.localeCompare(right.category) ||
      left.displayName.localeCompare(right.displayName),
    );
}

export function workflowNodeRegistryService(db: Db) {
  async function validateNode(
    companyId: string,
    node: WorkflowGraphV1["nodes"][number],
    mode: "draft" | "publish",
  ) {
    const entry = REGISTRY_BY_TYPE.get(node.type);
    if (!entry) {
      invalidNode("Workflow contains an unregistered node type", {
        reason: "node_type_unregistered",
        nodeId: node.id,
        nodeType: node.type,
      });
    }

    const parsed = entry.configValidator.safeParse(node.config);
    if (!parsed.success) {
      invalidNode("Workflow node configuration is invalid", {
        reason: "node_config_invalid",
        nodeId: node.id,
        nodeType: node.type,
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          code: issue.code,
          message: issue.message,
        })),
      });
    }

    if (entry.validateReferences) {
      await entry.validateReferences(
        db,
        companyId,
        node.id,
        parsed.data as Record<string, unknown>,
        mode,
      );
    }

    if (mode === "publish" && entry.descriptor.publishState !== "ready") {
      invalidNode("Workflow node is not publishable in the current implementation phase", {
        reason: "node_not_publishable_yet",
        nodeId: node.id,
        nodeType: node.type,
        blockedReason: entry.descriptor.publishBlockedReason,
      });
    }

    if (mode === "publish") {
      const retryPolicy = effectiveWorkflowRetryPolicy(
        node.retryPolicy,
        entry.descriptor,
      );
      if (!descriptorRetryIsStructurallySafe(entry.descriptor, retryPolicy)) {
        invalidNode("Workflow node retry policy is unsafe for its side effects", {
          reason: "workflow_step_retry_unsafe",
          nodeId: node.id,
          nodeType: node.type,
          sideEffectClass: entry.descriptor.sideEffectClass,
          idempotencyStrategy: entry.descriptor.idempotencyStrategy,
        });
      }
      if (node.continueOnFailure === true) {
        invalidNode("Continue-on-failure is not implemented for published workflows yet", {
          reason: "workflow_failure_policy_not_ready",
          nodeId: node.id,
          nodeType: node.type,
        });
      }
    }
  }

  async function validate(
    companyId: string,
    graphInput: WorkflowGraphV1,
    mode: "draft" | "publish",
  ) {
    const graph = workflowGraphV1Schema.parse(graphInput);
    for (const node of graph.nodes) {
      await validateNode(companyId, node, mode);
    }
    return graph;
  }

  return {
    list: workflowNodeDefinitions,
    validateDraftGraph: (companyId: string, graph: WorkflowGraphV1) =>
      validate(companyId, graph, "draft"),
    validatePublishGraph: async (companyId: string, graph: WorkflowGraphV1) => {
      const validated = await validate(companyId, graph, "publish");
      validateWorkflowPublishTopology(validated);
      return validated;
    },
  };
}
