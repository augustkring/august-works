import { describe, expect, it } from "vitest";
import { executeWorkflowMap, workflowMapConfig } from "./workflow-map.js";
const base = { collection: "{{input.items}}", mapping: { value: "{{input.item.value}}", index: "{{input.index}}" }, maxItems: 2 };
const context = (items: unknown) => ({ input: { items }, trigger: {}, variables: {}, steps: {} });
describe("bounded workflow map", () => {
  it("maps in order without host code or model calls", async () => {
    expect(await executeWorkflowMap(base, context([{ value: 7 }, { value: 9 }]), 1000, new AbortController().signal))
      .toEqual({ results: [{ value: 7, index: 0 }, { value: 9, index: 1 }], errors: [] });
  });
  it("rejects expansion beyond the published bound before processing", async () => {
    await expect(executeWorkflowMap(base, context([{}, {}, {}]), 1000, new AbortController().signal))
      .rejects.toMatchObject({ details: { code: "workflow_map_limit_exceeded" } });
    await expect(executeWorkflowMap(base, context("not an array"), 1000, new AbortController().signal))
      .rejects.toMatchObject({ details: { code: "workflow_map_collection_invalid" } });
  });
  it("fails explicitly or returns null according to the published item policy", async () => {
    await expect(executeWorkflowMap(base, context([{}]), 1000, new AbortController().signal))
      .rejects.toMatchObject({ details: { code: "workflow_map_item_failed", index: 0 } });
    expect(await executeWorkflowMap({ ...base, failurePolicy: "continue_with_null" }, context([{}, { value: 9 }]), 1000, new AbortController().signal))
      .toEqual({ results: [null, { value: 9, index: 1 }], errors: [{ index: 0, code: "workflow_map_item_failed" }] });
    expect(workflowMapConfig.safeParse({ ...base, failurePolicy: "continue_with_null", outputSchema: { type: "object" } }).success).toBe(false);
  });
  it("observes cancellation between pure items and does not permit unbounded concurrency", async () => {
    const abort = new AbortController();
    setImmediate(() => abort.abort(new Error("Cancelled")));
    await expect(executeWorkflowMap(base, context([{ value: 7 }, { value: 9 }]), 1000, abort.signal)).rejects.toThrow("Cancelled");
    expect(workflowMapConfig.safeParse({ ...base, concurrency: 2 }).success).toBe(false);
  });
});
