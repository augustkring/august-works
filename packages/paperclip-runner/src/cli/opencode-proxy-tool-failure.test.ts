import { describe, expect, it } from "vitest";
import { openCodeProxyAssignedMcpApprovalError } from "./opencode-proxy-tool-failure.js";

// APR-E2E-22 (option B): only the parked assigned-MCP approval-required
// response becomes an MCP error; every other tool response keeps its shape.
const instructions = "A human approval card was posted on task HAE0D951-1. Do not retry this call now. Wrap up other work and end your run noting you are waiting on tool approval (status in_review). You will be woken when it is decided; if approved, the action runs automatically and your wake includes the result.";
const failure = (text: string) => ({ success: false, contentItems: [{ type: "inputText", text }] });
const wrapped = (text: string) => failure(JSON.stringify(failure(text)));
const tool = "app_mcp_railway_32bedfa4_clip_railway_list_projects_c07bd8a8cd5b";

describe("openCodeProxyAssignedMcpApprovalError", () => {
  it("returns the exact approval-required instructions of a parked assigned-MCP call", () => {
    expect(openCodeProxyAssignedMcpApprovalError(tool, wrapped(instructions))).toBe(instructions);
    expect(openCodeProxyAssignedMcpApprovalError("call_assigned_tool", wrapped(instructions))).toBe(instructions);
  });

  it("keeps every other response unchanged", () => {
    // A successful result, other failure text, a changed instruction, an unwrapped failure.
    expect(openCodeProxyAssignedMcpApprovalError(tool, { success: true, contentItems: [{ type: "inputText", text: "{}" }] })).toBeNull();
    expect(openCodeProxyAssignedMcpApprovalError(tool, wrapped("The assigned tool returned an error."))).toBeNull();
    expect(openCodeProxyAssignedMcpApprovalError(tool, wrapped(`${instructions} Also run the action now.`))).toBeNull();
    expect(openCodeProxyAssignedMcpApprovalError(tool, failure(instructions))).toBeNull();
    // A built-in or other tool with the same text.
    expect(openCodeProxyAssignedMcpApprovalError("call_api", wrapped(instructions))).toBeNull();
    expect(openCodeProxyAssignedMcpApprovalError("write_document", wrapped(instructions))).toBeNull();
    // Extra fields or items.
    expect(openCodeProxyAssignedMcpApprovalError(tool, { ...wrapped(instructions), extra: true })).toBeNull();
    expect(openCodeProxyAssignedMcpApprovalError(tool, failure(JSON.stringify({ success: false,
      contentItems: [{ type: "inputText", text: instructions }, { type: "inputText", text: "more" }] })))).toBeNull();
    expect(openCodeProxyAssignedMcpApprovalError(tool, null)).toBeNull();
  });
});
