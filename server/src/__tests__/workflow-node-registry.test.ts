import { describe, expect, it } from "vitest";
import type { Db } from "@paperclipai/db";
import {
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
});
