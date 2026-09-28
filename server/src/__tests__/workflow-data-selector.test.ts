import { describe, expect, it } from "vitest";
import type { Db } from "@paperclipai/db";
import type { WorkflowGraphV1 } from "@paperclipai/shared";
import { workflowDataSelectorService } from "../services/workflows/workflow-data-selector.js";

const noDb = {} as Db;

const graph: WorkflowGraphV1 = {
  version: 1,
  nodes: [
    {
      id: "start",
      type: "core.manual_trigger",
      name: "Manual start",
      position: { x: 0, y: 0 },
      config: {},
    },
    {
      id: "check",
      type: "core.condition",
      name: "Check deal",
      position: { x: 100, y: 0 },
      config: { expression: "true" },
    },
    {
      id: "target",
      type: "core.transform",
      name: "Build output",
      position: { x: 200, y: 0 },
      config: { mapping: { value: "{{variables.threshold}}" } },
    },
    {
      id: "future",
      type: "core.condition",
      name: "Future step",
      position: { x: 300, y: 0 },
      config: { expression: "true" },
    },
  ],
  edges: [
    { id: "e1", source: "start", target: "check" },
    { id: "e2", source: "check", target: "target" },
    { id: "e3", source: "target", target: "future" },
  ],
  variables: [
    {
      name: "threshold",
      description: "Minimum score",
      required: true,
      defaultValue: 50,
    },
  ],
  settings: {},
};

describe("workflow Data Selector", () => {
  it("exposes variables and upstream nodes but never downstream nodes", async () => {
    const model = await workflowDataSelectorService(noDb).build(
      "22222222-2222-4222-8222-222222222222",
      {
        graph,
        targetNodeId: "target",
        inputSchema: {
          type: "object",
          required: ["customer"],
          properties: {
            customer: {
              type: "object",
              properties: {
                email: { type: "string", example: "a@example.com" },
              },
            },
          },
        },
      },
    );

    expect(model.sources.map((source) => source.id)).toEqual([
      "variables",
      "trigger:start",
      "step:check",
    ]);
    expect(model.sources.some((source) => source.id === "step:future")).toBe(false);
    expect(model.sources[0]?.fields[0]).toMatchObject({
      label: "threshold",
      expression: "{{variables.threshold}}",
      valueType: "integer",
      required: true,
      sampleValue: 50,
    });
    expect(model.sources[1]?.fields[0]?.children[0]).toMatchObject({
      label: "email",
      expression: "{{trigger.customer.email}}",
      valueType: "string",
      sampleValue: "a@example.com",
    });
    expect(model.sources[2]?.fields).toEqual([
      expect.objectContaining({
        label: "result",
        expression: '{{steps["check"].result}}',
        valueType: "boolean",
      }),
    ]);
  });

  it("rejects a target node that is not present", async () => {
    await expect(
      workflowDataSelectorService(noDb).build(
        "22222222-2222-4222-8222-222222222222",
        { graph, targetNodeId: "missing", inputSchema: null },
      ),
    ).rejects.toMatchObject({
      status: 422,
      details: expect.objectContaining({
        code: "workflow_data_selector_invalid_target",
      }),
    });
  });

  it("derives transform output keys deterministically", async () => {
    const derived: WorkflowGraphV1 = {
      ...graph,
      nodes: [
        graph.nodes[0]!,
        {
          id: "normalize",
          type: "core.transform",
          name: "Normalize",
          position: { x: 100, y: 0 },
          config: { mapping: { companyName: "{{trigger.name}}", score: "1" } },
        },
        graph.nodes[2]!,
      ],
      edges: [
        { id: "t1", source: "start", target: "normalize" },
        { id: "t2", source: "normalize", target: "target" },
      ],
    };
    const model = await workflowDataSelectorService(noDb).build(
      "22222222-2222-4222-8222-222222222222",
      { graph: derived, targetNodeId: "target", inputSchema: null },
    );
    const transform = model.sources.find((source) => source.id === "step:normalize");
    expect(transform?.fields.map((field) => field.label)).toEqual(["companyName", "score"]);
    expect(transform?.fields[0]?.expression).toBe('{{steps["normalize"].companyName}}');
  });
});
