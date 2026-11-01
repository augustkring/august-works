import { describe, it, expect, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import { workflowNodeRegistryService } from "../services/workflows/workflow-node-registry.js";
import { executeWorkflowHttpRequest, workflowHttpNode } from "../services/workflows/workflow-http-request.js";

describe("editable workflow HTTP model-effect admission", () => {
 it("keeps the node draft-only until its remote effect has a qualified contract", () => {
  expect(workflowHttpNode.descriptor.publishState).toBe("draft_only");
  expect(workflowHttpNode.descriptor.publishBlockedReason).toContain("available connector");
 });
 it("rejects publication through the actual registry while retaining draft editing", async () => {
  const registry = workflowNodeRegistryService({} as Db);
  const graph = {version:1 as const,nodes:[{id:"http",type:"core.http_request",name:"HTTP",position:{x:0,y:0},config:{url:"https://example.com/infer?prompt=work"}}],edges:[],variables:[],settings:{}};
  await expect(registry.validateDraftGraph("22222222-2222-4222-8222-222222222222",graph)).resolves.toMatchObject({nodes:[{type:"core.http_request"}]});
  await expect(registry.validatePublishGraph("22222222-2222-4222-8222-222222222222",graph)).rejects.toMatchObject({details:{reason:"node_not_publishable_yet",nodeType:"core.http_request"}});
 });
 it("rejects the actual request entry before fetch even for a read-shaped model endpoint", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("must not invoke"));
  try {
   await expect(executeWorkflowHttpRequest({url:"https://example.com/infer?prompt=work",method:"GET"},1000,new AbortController().signal))
    .rejects.toMatchObject({status:422,details:{code:"configuration_incomplete",configurationIncomplete:{reason:"tool_model_effect_unqualified",actionUrl:"/apps"}}});
   expect(fetch).not.toHaveBeenCalled();
  } finally { fetch.mockRestore(); }
 });
});
