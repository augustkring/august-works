import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { toolCatalogEntries, toolConnections } from "@paperclipai/db";
import {
  workflowDataSelectorRequestSchema,
  type WorkflowDataSelectorField,
  type WorkflowDataSelectorModel,
  type WorkflowDataSelectorRequest,
  type WorkflowDataSelectorSource,
  type WorkflowDataValueType,
  type WorkflowGraphV1,
  type WorkflowJsonSchema,
  type WorkflowNodeDefinitionDescriptor,
} from "@paperclipai/shared";
import { unprocessable } from "../../errors.js";
import { workflowNodeDefinitions } from "./workflow-node-registry.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function schemaType(schema: WorkflowJsonSchema | null | undefined): WorkflowDataValueType {
  if (!schema) return "unknown";
  const raw = schema.type;
  if (typeof raw === "string") {
    if (["object", "array", "string", "number", "integer", "boolean", "null"].includes(raw)) {
      return raw as WorkflowDataValueType;
    }
  }
  if (Array.isArray(raw)) {
    const nonNull = raw.filter(
      (value): value is string => typeof value === "string" && value !== "null",
    );
    if (
      nonNull.length === 1 &&
      ["object", "array", "string", "number", "integer", "boolean"].includes(nonNull[0]!)
    ) {
      return nonNull[0] as WorkflowDataValueType;
    }
  }
  if (isRecord(schema.properties)) return "object";
  return "unknown";
}

function schemaSample(schema: WorkflowJsonSchema): unknown | null {
  if (Object.prototype.hasOwnProperty.call(schema, "default")) {
    return schema.default ?? null;
  }
  if (Array.isArray(schema.examples) && schema.examples.length > 0) {
    return schema.examples[0] ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(schema, "example")) {
    return schema.example ?? null;
  }
  return null;
}

function quotedStepRoot(nodeId: string) {
  return `steps[${JSON.stringify(nodeId)}]`;
}

function fieldExpression(root: string, path: string[]) {
  const suffix = path.map((part) =>
    /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(part)
      ? `.${part}`
      : `[${JSON.stringify(part)}]`
  ).join("");
  return `{{${root}${suffix}}}`;
}

function fieldsFromSchema(
  schema: WorkflowJsonSchema | null,
  root: string,
  parentPath: string[] = [],
  depth = 0,
): WorkflowDataSelectorField[] {
  if (!schema || depth > 8 || !isRecord(schema.properties)) return [];
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((value): value is string => typeof value === "string")
      : [],
  );

  return Object.entries(schema.properties)
    .filter(([, value]) => isRecord(value))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, raw]) => {
      const childSchema = raw as WorkflowJsonSchema;
      const path = [...parentPath, key];
      const valueType = schemaType(childSchema);
      return {
        key,
        label:
          typeof childSchema.title === "string" && childSchema.title.trim()
            ? childSchema.title.trim()
            : key,
        path: path.join("."),
        expression: fieldExpression(root, path),
        valueType,
        required: required.has(key),
        sampleValue: schemaSample(childSchema),
        // Arrays are selectable as a whole until the expression runtime defines
        // explicit index/wildcard semantics. Do not invent array traversal here.
        children:
          valueType === "object"
            ? fieldsFromSchema(childSchema, root, path, depth + 1)
            : [],
      };
    });
}

function variableSchema(value: unknown): WorkflowJsonSchema {
  if (value === null) return { type: "null" };
  if (Array.isArray(value)) return { type: "array" };
  switch (typeof value) {
    case "string": return { type: "string" };
    case "number": return { type: Number.isInteger(value) ? "integer" : "number" };
    case "boolean": return { type: "boolean" };
    case "object": return { type: "object", additionalProperties: true };
    default: return {};
  }
}

function variableSource(graph: WorkflowGraphV1): WorkflowDataSelectorSource {
  const properties: Record<string, WorkflowJsonSchema> = {};
  const required: string[] = [];
  for (const variable of graph.variables) {
    properties[variable.name] = {
      ...variableSchema(variable.defaultValue),
      ...(variable.description ? { description: variable.description } : {}),
      ...(variable.defaultValue !== undefined ? { default: variable.defaultValue } : {}),
    };
    if (variable.required) required.push(variable.name);
  }
  const schema: WorkflowJsonSchema = {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
  return {
    id: "variables",
    kind: "variables",
    label: "Workflow variables",
    expression: "{{variables}}",
    nodeId: null,
    nodeType: null,
    schema,
    fields: fieldsFromSchema(schema, "variables"),
    sampleData: Object.fromEntries(
      graph.variables
        .filter((variable) => variable.defaultValue !== undefined)
        .map((variable) => [variable.name, variable.defaultValue]),
    ),
  };
}

function upstreamNodeIds(graph: WorkflowGraphV1, targetNodeId: string) {
  const incoming = new Map<string, string[]>();
  for (const edge of graph.edges) {
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]);
  }

  const upstream = new Set<string>();
  const stack = [...(incoming.get(targetNodeId) ?? [])];
  while (stack.length > 0) {
    const nodeId = stack.pop()!;
    if (nodeId === targetNodeId || upstream.has(nodeId)) continue;
    upstream.add(nodeId);
    stack.push(...(incoming.get(nodeId) ?? []));
  }
  return upstream;
}

function transformOutputSchema(config: unknown): WorkflowJsonSchema | null {
  if (!isRecord(config) || !isRecord(config.mapping)) return null;
  const keys = Object.keys(config.mapping).sort();
  return {
    type: "object",
    properties: Object.fromEntries(keys.map((key) => [key, {}])),
    required: keys,
    additionalProperties: false,
  };
}

async function outputSchemaForNode(
  db: Db,
  companyId: string,
  node: WorkflowGraphV1["nodes"][number],
  definition: WorkflowNodeDefinitionDescriptor | undefined,
): Promise<WorkflowJsonSchema | null> {
  if (node.type === "core.transform") {
    return transformOutputSchema(node.config) ?? definition?.outputSchema ?? null;
  }

  if (node.type === "agent.task" && isRecord(node.config)) {
    return isRecord(node.config.expectedOutputSchema)
      ? node.config.expectedOutputSchema
      : definition?.outputSchema ?? null;
  }

  if (node.type === "connector.action" && isRecord(node.config)) {
    const catalogEntryId =
      typeof node.config.toolCatalogEntryId === "string"
        ? node.config.toolCatalogEntryId
        : null;
    const connectionId =
      typeof node.config.connectionId === "string"
        ? node.config.connectionId
        : null;
    if (!catalogEntryId || !connectionId) return null;

    const row = await db
      .select({ outputSchema: toolCatalogEntries.outputSchema })
      .from(toolCatalogEntries)
      .innerJoin(
        toolConnections,
        and(
          eq(toolConnections.companyId, companyId),
          eq(toolConnections.id, connectionId),
          eq(toolCatalogEntries.companyId, companyId),
          eq(toolCatalogEntries.connectionId, toolConnections.id),
          eq(toolCatalogEntries.id, catalogEntryId),
        ),
      )
      .then((rows) => rows[0] ?? null);

    return row?.outputSchema && isRecord(row.outputSchema)
      ? row.outputSchema
      : null;
  }

  return definition?.outputSchema ?? null;
}

export function workflowDataSelectorService(db: Db) {
  const definitions = new Map(
    workflowNodeDefinitions().map((definition) => [definition.type, definition]),
  );

  return {
    build: async (
      companyId: string,
      rawInput: WorkflowDataSelectorRequest,
    ): Promise<WorkflowDataSelectorModel> => {
      const input = workflowDataSelectorRequestSchema.parse(rawInput);
      const target = input.graph.nodes.find(
        (node) => node.id === input.targetNodeId,
      );
      if (!target) {
        throw unprocessable(
          "Data Selector target node is not present in the graph",
          {
            code: "workflow_data_selector_invalid_target",
            targetNodeId: input.targetNodeId,
          },
        );
      }

      const upstream = upstreamNodeIds(input.graph, target.id);
      const sources: WorkflowDataSelectorSource[] = [];

      if (input.graph.variables.length > 0) {
        sources.push(variableSource(input.graph));
      }

      for (const node of input.graph.nodes) {
        if (!upstream.has(node.id)) continue;
        const definition = definitions.get(node.type);
        const schema =
          definition?.category === "trigger" && input.inputSchema
            ? input.inputSchema
            : await outputSchemaForNode(db, companyId, node, definition);
        const root =
          definition?.category === "trigger"
            ? "trigger"
            : quotedStepRoot(node.id);

        sources.push({
          id:
            definition?.category === "trigger"
              ? `trigger:${node.id}`
              : `step:${node.id}`,
          kind: definition?.category === "trigger" ? "trigger" : "step",
          label: node.name,
          expression: `{{${root}}}`,
          nodeId: node.id,
          nodeType: node.type,
          schema,
          fields: fieldsFromSchema(schema, root),
          sampleData: schema ? schemaSample(schema) : null,
        });
      }

      return { targetNodeId: target.id, sources };
    },
  };
}
