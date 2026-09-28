import { describe, expect, it } from "vitest";
import type { Db } from "@paperclipai/db";
import {
  validateWorkflowPublishTopology,
  workflowNodeDefinitions,
  workflowNodeRegistryService,
} from "../services/workflows/workflow-node-registry.js";

describe("Workflow Node Registry", () => {
  it("ships complete serializable definitions for the initial V4 node set", () => {
    const definitions = workflowNodeDefinitions();
    expect(definitions.map((definition) => definition.type)).toEqual(
      expect.arrayContaining([
        "core.manual_trigger",
        "core.transform",
        "core.condition",
        "connector.action",
        "work.create_task",
        "agent.task",
        "human.approval",
      ]),
    );
    expect(new Set(definitions.map((definition) => definition.type)).size).toBe(definitions.length);

    for (const definition of definitions) {
      expect(definition.version).toBeGreaterThan(0);
      expect(definition.displayName.trim()).not.toBe("");
      expect(definition.description.trim()).not.toBe("");
      expect(definition.configSchema).toEqual(expect.any(Object));
      expect(definition.retryPolicyDefault.maxAttempts).toBeGreaterThan(0);
      expect(definition.uiComponent.trim()).not.toBe("");
      expect(definition.accessibilityContract.label.trim()).not.toBe("");
      expect(definition.accessibilityContract.supportsKeyboardInsert).toBe(true);
      expect(definition.accessibilityContract.supportsOutlineEdit).toBe(true);
      if (definition.publishState === "draft_only") {
        expect(definition.publishBlockedReason).toEqual(expect.any(String));
      }
    }
  });

  it("allows draft-only nodes during draft validation but rejects them for publish", async () => {
    const registry = workflowNodeRegistryService({} as Db);
    const graph = {
      version: 1 as const,
      nodes: [{
        id: "transform",
        type: "core.transform",
        name: "Transform",
        position: { x: 0, y: 0 },
        config: { mapping: { value: "{{trigger.value}}" } },
      }],
      edges: [],
      variables: [],
      settings: {},
    };

    await expect(
      registry.validateDraftGraph("22222222-2222-4222-8222-222222222222", graph),
    ).resolves.toEqual(graph);

    await expect(
      registry.validatePublishGraph("22222222-2222-4222-8222-222222222222", graph),
    ).rejects.toMatchObject({
      status: 422,
      details: expect.objectContaining({
        code: "workflow_node_invalid",
        reason: "node_not_publishable_yet",
        nodeType: "core.transform",
      }),
    });
  });

  it("rejects invalid configuration without echoing raw config values", async () => {
    const registry = workflowNodeRegistryService({} as Db);
    try {
      await registry.validateDraftGraph(
        "22222222-2222-4222-8222-222222222222",
        {
          version: 1,
          nodes: [{
            id: "condition",
            type: "core.condition",
            name: "Condition",
            position: { x: 0, y: 0 },
            config: { expression: "" },
          }],
          edges: [],
          variables: [],
          settings: {},
        },
      );
      throw new Error("Expected workflow node validation to fail");
    } catch (error) {
      expect(error).toMatchObject({
        status: 422,
        details: expect.objectContaining({
          code: "workflow_node_invalid",
          reason: "node_config_invalid",
          nodeId: "condition",
        }),
      });
      expect(JSON.stringify(error)).not.toContain('"expression":""');
    }
  });
  it("enforces published graph topology independently from node implementation readiness", () => {
    const node = (
      id: string,
      type: string,
      x: number,
      y: number,
    ) => ({
      id,
      type,
      name: id,
      position: { x, y },
      config:
        type === "core.manual_trigger"
          ? {}
          : type === "core.condition"
            ? { expression: "true" }
            : { mapping: { value: "x" } },
    });

    const expectTopologyError = (
      graph: Parameters<typeof validateWorkflowPublishTopology>[0],
      details: Record<string, unknown>,
    ) => {
      try {
        validateWorkflowPublishTopology(graph);
        throw new Error("Expected published workflow topology validation to fail");
      } catch (error) {
        expect(error).toMatchObject({
          status: 422,
          details: expect.objectContaining({
            code: "workflow_graph_invalid",
            ...details,
          }),
        });
      }
    };

    expectTopologyError(
      {
        version: 1,
        nodes: [],
        edges: [],
        variables: [],
        settings: {},
      },
      { reason: "entry_trigger_count", triggerCount: 0 },
    );

    expectTopologyError(
      {
        version: 1,
        nodes: [
          node("start-a", "core.manual_trigger", 0, 0),
          node("start-b", "core.manual_trigger", 200, 0),
        ],
        edges: [],
        variables: [],
        settings: {},
      },
      { reason: "entry_trigger_count", triggerCount: 2 },
    );

    expectTopologyError(
      {
        version: 1,
        nodes: [
          node("start", "core.manual_trigger", 0, 0),
          node("orphan", "core.transform", 200, 0),
        ],
        edges: [],
        variables: [],
        settings: {},
      },
      { reason: "unreachable_nodes", nodeIds: ["orphan"] },
    );

    expectTopologyError(
      {
        version: 1,
        nodes: [
          node("start", "core.manual_trigger", 0, 0),
          node("transform", "core.transform", 200, 0),
        ],
        edges: [
          { id: "e1", source: "start", target: "transform" },
          { id: "e2", source: "transform", target: "start" },
        ],
        variables: [],
        settings: {},
      },
      { reason: "cycle_requires_explicit_loop" },
    );

    expectTopologyError(
      {
        version: 1,
        nodes: [
          node("start", "core.manual_trigger", 0, 0),
          node("left", "core.transform", 200, -50),
          node("right", "core.transform", 200, 50),
        ],
        edges: [
          { id: "e1", source: "start", target: "left" },
          { id: "e2", source: "start", target: "right" },
        ],
        variables: [],
        settings: {},
      },
      { reason: "implicit_parallel_split", nodeId: "start" },
    );

    expectTopologyError(
      {
        version: 1,
        nodes: [
          node("start", "core.manual_trigger", 0, 0),
          node("branch", "core.condition", 160, 0),
          node("left", "core.transform", 320, -80),
          node("right", "core.transform", 320, 80),
          node("join", "core.transform", 480, 0),
        ],
        edges: [
          { id: "e1", source: "start", target: "branch" },
          { id: "e2", source: "branch", target: "left", sourceHandle: "true", label: "true" },
          { id: "e3", source: "branch", target: "right", sourceHandle: "false", label: "false" },
          { id: "e4", source: "left", target: "join" },
          { id: "e5", source: "right", target: "join" },
        ],
        variables: [],
        settings: {},
      },
      { reason: "implicit_merge", nodeId: "join" },
    );

    expectTopologyError(
      {
        version: 1,
        nodes: [
          node("start", "core.manual_trigger", 0, 0),
          node("branch", "core.condition", 160, 0),
          node("left", "core.condition", 320, -80),
          node("right", "core.condition", 320, 80),
        ],
        edges: [
          { id: "e1", source: "start", target: "branch" },
          { id: "e2", source: "branch", target: "left", label: "true" },
          { id: "e3", source: "branch", target: "right", label: "true" },
        ],
        variables: [],
        settings: {},
      },
      { reason: "condition_branches_invalid", nodeId: "branch" },
    );

    expect(() =>
      validateWorkflowPublishTopology({
        version: 1,
        nodes: [node("start", "core.manual_trigger", 0, 0)],
        edges: [],
        variables: [],
        settings: {},
      }),
    ).not.toThrow();
  });

  it("publishes a condition only when its deterministic expression is valid", async () => {
    const registry = workflowNodeRegistryService({} as Db);
    const graph = {
      version: 1 as const,
      nodes: [
        {
          id: "start",
          type: "core.manual_trigger",
          name: "Start",
          position: { x: 0, y: 0 },
          config: {},
        },
        {
          id: "condition",
          type: "core.condition",
          name: "Amount threshold",
          position: { x: 180, y: 0 },
          config: { expression: "{{trigger.amount}} >= 50000" },
        },
      ],
      edges: [{ id: "e1", source: "start", target: "condition" }],
      variables: [],
      settings: {},
    };

    await expect(
      registry.validatePublishGraph("22222222-2222-4222-8222-222222222222", graph),
    ).resolves.toEqual(graph);

    await expect(
      registry.validateDraftGraph("22222222-2222-4222-8222-222222222222", {
        ...graph,
        nodes: graph.nodes.map((node) =>
          node.id === "condition"
            ? { ...node, config: { expression: "process.exit(1)" } }
            : node,
        ),
      }),
    ).rejects.toMatchObject({
      status: 422,
      details: expect.objectContaining({
        code: "workflow_node_invalid",
        reason: "node_config_invalid",
        nodeId: "condition",
      }),
    });
  });

});
