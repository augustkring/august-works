import { afterEach, describe, expect, it, vi } from "vitest";
import { executeWorkflowHttpRequest, workflowHttpConfig, workflowHttpNode } from "./workflow-http-request.js";

afterEach(() => vi.unstubAllGlobals());

describe("workflow HTTP request admission", () => {
  it.each(["http://8.8.8.8", "https://user:password@8.8.8.8", "https://8.8.8.8?access_token=secret"])("retains unsafe configuration rejection %s", value => {
    expect(workflowHttpConfig.safeParse({url:value}).success).toBe(false);
  });
  it("retains valid legacy drafts while withholding publish eligibility", () => {
    expect(workflowHttpConfig.safeParse({url:"https://8.8.8.8/data",responseSchema:{type:"object"}}).success).toBe(true);
    expect(workflowHttpNode.descriptor.publishState).toBe("draft_only");
    expect(workflowHttpNode.descriptor.publishBlockedReason).toContain("available connector");
  });
  it.each([
    {url:"https://8.8.8.8/data",responseSchema:{type:"object",required:["value"],properties:{value:{type:"integer"}}}},
    {url:"https://example.com/infer?prompt=work"},
    {url:"https://example.com/status",method:"HEAD"},
    {url:"https://127.0.0.1"},
    {url:"https://169.254.169.254"},
    {url:"https://[::1]"},
  ])("refuses an editable endpoint before network until a real remote-effect contract exists: $url", async config => {
    const request=vi.fn();vi.stubGlobal("fetch",request);
    await expect(executeWorkflowHttpRequest(config,1000,new AbortController().signal)).rejects.toMatchObject({
      status:422,details:{code:"configuration_incomplete",configurationIncomplete:{reason:"tool_model_effect_unqualified",actionUrl:"/apps"}},
    });
    expect(request).not.toHaveBeenCalled();
  });
});
