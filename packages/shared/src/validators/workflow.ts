import { z } from "zod";
import {
  WORKFLOW_CAPABILITY_KINDS,
  WORKFLOW_RETRY_MODES,
  WORKFLOW_REVISION_STATES,
  WORKFLOW_STATUSES,
} from "../types/workflow.js";

export const workflowStatusSchema = z.enum(WORKFLOW_STATUSES);
export const workflowRevisionStateSchema = z.enum(WORKFLOW_REVISION_STATES);

export const workflowRetryPolicySchema = z
  .object({
    mode: z.enum(WORKFLOW_RETRY_MODES),
    maxAttempts: z.number().int().min(1).max(20),
    initialDelayMs: z.number().int().min(0).max(86_400_000),
    maxDelayMs: z.number().int().min(0).max(86_400_000),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.maxDelayMs < value.initialDelayMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxDelayMs"],
        message: "maxDelayMs must be greater than or equal to initialDelayMs",
      });
    }
    if (value.mode === "none" && value.maxAttempts !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxAttempts"],
        message: "Retry mode none requires maxAttempts = 1",
      });
    }
    if (
      value.mode === "none" &&
      (value.initialDelayMs !== 0 || value.maxDelayMs !== 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["initialDelayMs"],
        message: "Retry mode none requires zero retry delays",
      });
    }
    if (value.mode !== "none" && value.maxAttempts < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxAttempts"],
        message: "Retry mode fixed or exponential requires at least two attempts",
      });
    }
  });

const workflowIdSchema = z.string().trim().min(1).max(160);
const workflowNodeTypeSchema = z.string().trim().min(1).max(160);
const workflowVariableNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/, "Variable name must be identifier-like");

export const workflowNodeV1Schema = z
  .object({
    id: workflowIdSchema,
    type: workflowNodeTypeSchema,
    name: z.string().trim().min(1).max(200),
    position: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
      })
      .strict(),
    config: z.unknown(),
    retryPolicy: workflowRetryPolicySchema.optional(),
    timeoutSeconds: z.number().int().min(1).max(86_400).optional(),
    continueOnFailure: z.boolean().optional(),
  })
  .strict();

export const workflowEdgeV1Schema = z
  .object({
    id: workflowIdSchema,
    source: workflowIdSchema,
    target: workflowIdSchema,
    sourceHandle: z.string().trim().min(1).max(160).nullable().optional(),
    targetHandle: z.string().trim().min(1).max(160).nullable().optional(),
    label: z.string().trim().max(200).nullable().optional(),
  })
  .strict();

export const workflowVariableV1Schema = z
  .object({
    name: workflowVariableNameSchema,
    description: z.string().trim().max(500).nullable().optional(),
    required: z.boolean().optional(),
    defaultValue: z.unknown().optional(),
  })
  .strict();

export const workflowSettingsV1Schema = z
  .object({
    totalDeadlineSeconds: z.number().int().min(1).max(604_800).nullable().optional(),
  })
  .strict();

export const workflowGraphV1Schema = z
  .object({
    version: z.literal(1),
    nodes: z.array(workflowNodeV1Schema).max(1_000),
    edges: z.array(workflowEdgeV1Schema).max(5_000),
    variables: z.array(workflowVariableV1Schema).max(200),
    settings: workflowSettingsV1Schema,
  })
  .strict()
  .superRefine((graph, ctx) => {
    const nodeIds = new Set<string>();
    for (const [index, node] of graph.nodes.entries()) {
      if (nodeIds.has(node.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["nodes", index, "id"],
          message: `Duplicate workflow node id: ${node.id}`,
        });
      }
      nodeIds.add(node.id);
    }

    const edgeIds = new Set<string>();
    for (const [index, edge] of graph.edges.entries()) {
      if (edgeIds.has(edge.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edges", index, "id"],
          message: `Duplicate workflow edge id: ${edge.id}`,
        });
      }
      edgeIds.add(edge.id);
      if (!nodeIds.has(edge.source)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edges", index, "source"],
          message: `Unknown source node: ${edge.source}`,
        });
      }
      if (!nodeIds.has(edge.target)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edges", index, "target"],
          message: `Unknown target node: ${edge.target}`,
        });
      }
    }

    const variableNames = new Set<string>();
    for (const [index, variable] of graph.variables.entries()) {
      if (variableNames.has(variable.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["variables", index, "name"],
          message: `Duplicate workflow variable: ${variable.name}`,
        });
      }
      variableNames.add(variable.name);
    }
  });

export const workflowJsonSchemaSchema = z.record(z.string(), z.unknown());

export const emptyWorkflowGraphV1 = {
  version: 1,
  nodes: [],
  edges: [],
  variables: [],
  settings: {},
} as const;

export const createWorkflowSchema = z
  .object({
    projectId: z.string().guid().nullable().optional(),
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2_000).nullable().optional(),
  })
  .strict();

export const updateWorkflowDraftSchema = z
  .object({
    expectedRevisionId: z.string().guid(),
    graph: workflowGraphV1Schema,
    inputSchema: workflowJsonSchemaSchema.nullable().optional(),
    outputSchema: workflowJsonSchemaSchema.nullable().optional(),
    changeSummary: z.string().trim().max(1_000).nullable().optional(),
  })
  .strict();

export const publishWorkflowSchema = z
  .object({
    expectedDraftRevisionId: z.string().guid(),
    expectedPublishedRevisionId: z.string().guid().nullable(),
    approvalId: z.string().guid().nullable().optional(),
  })
  .strict();

export type CreateWorkflow = z.infer<typeof createWorkflowSchema>;
export type UpdateWorkflowDraft = z.infer<typeof updateWorkflowDraftSchema>;
export type PublishWorkflow = z.infer<typeof publishWorkflowSchema>;

export const workflowCapabilitySearchQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional().default(""),
    limit: z.coerce.number().int().min(1).max(50).optional().default(30),
    kind: z.enum(WORKFLOW_CAPABILITY_KINDS).optional(),
  })
  .strict();

export type WorkflowCapabilitySearchQuery =
  z.infer<typeof workflowCapabilitySearchQuerySchema>;

export const workflowDataSelectorRequestSchema = z
  .object({
    graph: workflowGraphV1Schema,
    targetNodeId: workflowIdSchema,
    inputSchema: workflowJsonSchemaSchema.nullable().optional(),
  })
  .strict();

export type WorkflowDataSelectorRequest =
  z.infer<typeof workflowDataSelectorRequestSchema>;

export const workflowRunListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional().default(30),
  })
  .strict();

export type WorkflowRunListQuery = z.infer<typeof workflowRunListQuerySchema>;

export const startWorkflowRunSchema = z
  .object({
    input: z.record(z.string(), z.unknown()).optional().default({}),
    revisionId: z.string().guid().nullable().optional().default(null),
  })
  .strict();

export type StartWorkflowRun = z.input<typeof startWorkflowRunSchema>;

export const cancelWorkflowRunSchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export type CancelWorkflowRun = z.input<typeof cancelWorkflowRunSchema>;
