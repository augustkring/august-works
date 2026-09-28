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

type NodeConfigSchema = z.ZodTypeAny;

interface RegisteredWorkflowNode {
  descriptor: WorkflowNodeDefinitionDescriptor;
  configValidator: NodeConfigSchema;
  validateReferences?: (
    db: Db,
    companyId: string,
    nodeId: string,
    config: Record<string, unknown>,
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
      publishState: "draft_only",
      publishBlockedReason: "branch_executor_not_ready",
    }),
    configValidator: conditionConfig,
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
        properties: { issueId: { type: "string", format: "uuid" } },
        required: ["issueId"],
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
      failureOutputs: ["permission_denied", "task_create_failed"],
      auditEvents: [],
      uiComponent: "create_task",
      accessibilityContract: {
        label: "Create task",
        description: "Create accountable work for a person or agent.",
        supportsKeyboardInsert: true,
        supportsOutlineEdit: true,
      },
      publishState: "draft_only",
      publishBlockedReason: "task_workflow_integration_not_ready",
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
      outputSchema: null,
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
      retryPolicyDefault: NO_RETRY,
      idempotencyStrategy: "workflow_step_key",
      cancellationSupport: "cooperative",
      testMode: "sandbox",
      failureOutputs: ["permission_denied", "agent_unavailable", "agent_failed"],
      auditEvents: ["agent.task_delegated"],
      uiComponent: "agent_task",
      accessibilityContract: {
        label: "Agent task",
        description: "Delegate accountable work to an August Works agent.",
        supportsKeyboardInsert: true,
        supportsOutlineEdit: true,
      },
      publishState: "draft_only",
      publishBlockedReason: "agent_workflow_integration_not_ready",
    }),
    configValidator: agentTaskConfig,
    validateReferences: async (db, companyId, nodeId, config) => {
      const parsed = agentTaskConfig.parse(config);
      await requireAgent(db, companyId, nodeId, parsed.agentId);
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
      publishState: "draft_only",
      publishBlockedReason: "human_wait_integration_not_ready",
    }),
    configValidator: humanApprovalConfig,
  },
];

const REGISTRY_BY_TYPE = new Map(REGISTRY.map((entry) => [entry.descriptor.type, entry]));

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
        issues: parsed.error.issues.map((issue: z.ZodIssue) => ({
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
    validatePublishGraph: (companyId: string, graph: WorkflowGraphV1) =>
      validate(companyId, graph, "publish"),
  };
}
