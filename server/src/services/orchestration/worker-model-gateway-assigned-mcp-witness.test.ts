import { describe, expect, it } from "vitest";
import type { NativePayloadSourceInput, NativeRunInputSourceReceipt } from "@paperclipai/shared";
import { managedAssignedMcpToolResultConsumed } from "./worker-model-gateway.js";

// APR-E2E-28 (a). A managed OpenCode Run's next provider request consumes a
// successful assigned MCP result (a direct app tool or the canonical call
// wrapper) only through the capture's own invocation witness: this provider
// tool use (call id, provider tool name, arguments hash), this invocation (id
// and gateway tool name) and this Run's exact source. A capture without a
// witness keeps the gateway's other owner checks (the helper returns false).

const runId = "00000000-0000-4000-8000-000000000101";
const otherRunId = "00000000-0000-4000-8000-000000000102";
const invocationId = "00000000-0000-4000-8000-0000000000f1";
const otherInvocationId = "00000000-0000-4000-8000-0000000000f2";
const user = "user-1";
const hash = (c: string) => c.repeat(64);
const callId = "toolu_assigned_1";
const argumentsHash = hash("a");
const gatewayToolName = "railway__paperclip-railway-list-projects";

type Input = Parameters<typeof managedAssignedMcpToolResultConsumed>[0];
type AdditionalInput = NativeRunInputSourceReceipt["additionalInputs"][number];

const source = (overrides: Record<string, unknown> = {}) => ({ kind: "tool_result", runId, callId,
  toolName: gatewayToolName, invocationId, contentHash: hash("c"), ...overrides }) as Record<string, unknown>;
const entry = (inputs: Array<Record<string, unknown>>): AdditionalInput => ({ responsibleUserId: user,
  policy: { issueIds: [] }, inputs: inputs as unknown as NativePayloadSourceInput[] }) as unknown as AdditionalInput;

function directAppInput(providerToolName = "app_railway_list_projects"): Input {
  const exact = source();
  return {
    capture: { managedOpenCode: true, callId, tool: providerToolName, argumentsHash, resultDigest: hash("c"), source: exact,
      assignedMcp: { providerToolName, gatewayToolName, invocationId, providerArgumentsHash: argumentsHash } },
    toolName: providerToolName, callId, argumentsHash, assignedProviderTool: true, nativeBuiltin: false,
    invocation: { id: invocationId, toolName: gatewayToolName }, runId, source: exact, consumedInput: { ...exact },
    additionalInputs: [entry([exact])],
  };
}

const witness = (input: Input) => input.capture.assignedMcp as Record<string, unknown>;
const withWitness = (input: Input, overrides: Record<string, unknown>): Input =>
  ({ ...input, capture: { ...input.capture, assignedMcp: { ...witness(input), ...overrides } } });

describe("managedAssignedMcpToolResultConsumed (APR-E2E-28 a)", () => {
  it("consumes an executed direct app tool result through its exact invocation witness", () => {
    expect(managedAssignedMcpToolResultConsumed(directAppInput())).toBe(true);
  });

  it("consumes an executed call-wrapper result through its exact invocation witness", () => {
    expect(managedAssignedMcpToolResultConsumed(directAppInput("call_assigned_tool"))).toBe(true);
  });

  it("consumes the exact source when a later output entry carries the same source as its prefix", () => {
    const input = directAppInput();
    expect(managedAssignedMcpToolResultConsumed({ ...input,
      additionalInputs: [...input.additionalInputs, entry([source(), source({ callId: "later", invocationId: null,
        toolName: "write_document", contentHash: hash("d") })])] })).toBe(true);
  });

  it("leaves a capture without a witness to the gateway's other owner checks", () => {
    const input = directAppInput();
    const { assignedMcp: _witness, ...capture } = input.capture;
    expect(managedAssignedMcpToolResultConsumed({ ...input, capture })).toBe(false);
    expect(managedAssignedMcpToolResultConsumed({ ...input, capture: { ...capture, assignedMcp: null } })).toBe(false);
  });

  const refused: Array<[string, (input: Input) => Input]> = [
    ["a capture of another provider call id", input => ({ ...input, capture: { ...input.capture, callId: "toolu_other" } })],
    ["a result block for another call id", input => ({ ...input, callId: "toolu_other" })],
    ["a capture with other provider arguments", input => ({ ...input, capture: { ...input.capture, argumentsHash: hash("b") } })],
    ["a provider tool use with other arguments", input => ({ ...input, argumentsHash: hash("b") })],
    ["a witness with other provider arguments", input => withWitness(input, { providerArgumentsHash: hash("b") })],
    ["a witness naming another provider tool", input => withWitness(input, { providerToolName: "app_railway_other" })],
    ["a provider tool use of another tool", input => ({ ...input, toolName: "app_railway_other" })],
    ["a witness naming another invocation", input => withWitness(input, { invocationId: otherInvocationId })],
    ["an invocation row other than the witness", input => ({ ...input,
      invocation: { ...input.invocation, id: otherInvocationId } })],
    ["a witness naming another gateway tool", input => withWitness(input, { gatewayToolName: "railway__other" })],
    ["an invocation row of another gateway tool", input => ({ ...input,
      invocation: { ...input.invocation, toolName: "railway__other" } })],
    ["a source of another invocation", input => ({ ...input, source: source({ invocationId: otherInvocationId }),
      consumedInput: source({ invocationId: otherInvocationId }) })],
    ["a source without an invocation", input => ({ ...input, source: source({ invocationId: null }),
      consumedInput: source({ invocationId: null }) })],
    ["a source of another Run", input => ({ ...input, source: source({ runId: otherRunId }),
      consumedInput: source({ runId: otherRunId }) })],
    ["a source of another call", input => ({ ...input, source: source({ callId: "toolu_other" }),
      consumedInput: source({ callId: "toolu_other" }) })],
    ["a receipt entry that is not this exact source", input => ({ ...input,
      consumedInput: source({ contentHash: hash("e") }) })],
    ["a second conflicting receipt copy for the same call", input => ({ ...input,
      additionalInputs: [...input.additionalInputs, entry([source({ contentHash: hash("e") })])] })],
    ["a capture outside the managed OpenCode transcript", input => ({ ...input,
      capture: { ...input.capture, managedOpenCode: false } })],
    ["a provider tool outside the exact assigned schema", input => ({ ...input, assignedProviderTool: false })],
    ["a Native builtin tool carrying a witness", input => ({ ...input, nativeBuiltin: true })],
  ];
  it.each(refused)("refuses %s", (_name, change) => {
    expect(() => managedAssignedMcpToolResultConsumed(change(directAppInput())))
      .toThrow("Managed assigned MCP result has no exact invocation source capture");
  });
});
