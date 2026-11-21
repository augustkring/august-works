import { describe, expect, it } from "vitest";
import type { NativePayloadSourceInput } from "@paperclipai/shared";
import { selectNativeOutputToolResultCapture } from "./native-direct-input.js";

// APR-E2E-28 (a). A Native output (for example a later write_document) whose
// source set holds a historical tool_result finds its single producer capture.
// An assigned MCP result's source names the gateway tool while its capture
// names the provider alias, so it matches only through the capture's own
// invocation witness. A capture without a witness keeps the provider-name rule.

type ToolResult = Extract<NativePayloadSourceInput, { kind: "tool_result" }>;

const runId = "00000000-0000-4000-8000-000000000101";
const invocationId = "00000000-0000-4000-8000-0000000000f1";
const otherInvocationId = "00000000-0000-4000-8000-0000000000f2";
const hash = (c: string) => c.repeat(64);
const gatewayToolName = "railway__paperclip-railway-list-projects";
const providerToolName = "app_railway_list_projects";

const assignedSource: ToolResult = { kind: "tool_result", runId, callId: "toolu_assigned", toolName: gatewayToolName,
  invocationId, contentHash: hash("c") };
const assignedCapture = (overrides: Record<string, unknown> = {}, witness: Record<string, unknown> = {}) => ({
  managedOpenCode: true, callId: assignedSource.callId, tool: providerToolName, resultDigest: assignedSource.contentHash,
  source: { ...assignedSource }, assignedMcp: { providerToolName, gatewayToolName, invocationId,
    providerArgumentsHash: hash("a"), ...witness }, ...overrides });

const documentSource: ToolResult = { kind: "tool_result", runId, callId: "toolu_document", toolName: "write_document",
  invocationId: otherInvocationId, contentHash: hash("d") };
const documentCapture = (overrides: Record<string, unknown> = {}) => ({ managedOpenCode: true,
  callId: documentSource.callId, tool: "paperclip_write_document", resultDigest: documentSource.contentHash,
  source: { ...documentSource }, ...overrides });

const unavailable = "A Native output tool result source is unavailable";

describe("selectNativeOutputToolResultCapture (APR-E2E-28 a)", () => {
  it("matches an assigned MCP capture through its exact invocation witness", () => {
    const capture = assignedCapture();
    expect(selectNativeOutputToolResultCapture([documentCapture(), capture], assignedSource)).toBe(capture);
  });

  it("matches an assigned call-wrapper capture through its exact invocation witness", () => {
    const capture = assignedCapture({ tool: "call_assigned_tool" }, { providerToolName: "call_assigned_tool" });
    expect(selectNativeOutputToolResultCapture([capture], assignedSource)).toBe(capture);
  });

  it.each([
    ["names another gateway tool", assignedCapture({}, { gatewayToolName: "railway__other" })],
    ["names another provider tool", assignedCapture({}, { providerToolName: "app_railway_other" })],
    ["names another invocation", assignedCapture({}, { invocationId: otherInvocationId })],
    ["has an empty witness", assignedCapture({}, { providerToolName: undefined, gatewayToolName: undefined,
      invocationId: undefined })],
    ["is on another call", assignedCapture({ callId: "toolu_other" })],
    ["records another result digest", assignedCapture({ resultDigest: hash("e") })],
    ["carries another source", assignedCapture({ source: { ...assignedSource, contentHash: hash("e") } })],
  ])("refuses an assigned capture that %s", (_name, capture) => {
    expect(() => selectNativeOutputToolResultCapture([capture], assignedSource)).toThrow(unavailable);
  });

  it("refuses an assigned source without an invocation even when the witness names none", () => {
    const source = { ...assignedSource, invocationId: null };
    const capture = assignedCapture({ source: { ...source } }, { invocationId: null });
    expect(() => selectNativeOutputToolResultCapture([capture], source)).toThrow(unavailable);
  });

  it("refuses a witness-bearing capture matched only by the provider-name rule", () => {
    // The old rule (provider name stripped of its prefix) would have matched this capture.
    const capture = documentCapture({ assignedMcp: { providerToolName: "paperclip_write_document",
      gatewayToolName: "railway__other", invocationId: otherInvocationId } });
    expect(() => selectNativeOutputToolResultCapture([capture], documentSource)).toThrow(unavailable);
  });

  it("refuses a second copy of the same assigned capture", () => {
    expect(() => selectNativeOutputToolResultCapture([assignedCapture(), assignedCapture()], assignedSource))
      .toThrow(unavailable);
  });

  it("keeps the provider-name rule for a capture without a witness", () => {
    const capture = documentCapture();
    expect(selectNativeOutputToolResultCapture([capture, assignedCapture()], documentSource)).toBe(capture);
    expect(() => selectNativeOutputToolResultCapture([documentCapture({ tool: "paperclip_read_document" })],
      documentSource)).toThrow(unavailable);
    // Without a witness, the gateway tool name of an assigned source cannot be reached by a provider alias.
    expect(() => selectNativeOutputToolResultCapture([assignedCapture({ assignedMcp: undefined })], assignedSource))
      .toThrow(unavailable);
    expect(() => selectNativeOutputToolResultCapture([documentCapture(), documentCapture()], documentSource))
      .toThrow(unavailable);
  });
});
