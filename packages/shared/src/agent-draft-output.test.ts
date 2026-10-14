import { describe, expect, it } from "vitest";
import { agentDraftRequestsTaskReview, parseAgentDraftOutput } from "./agent-draft-output.js";

describe("bounded authored Agent task proposal data", () => {
  it("requires the exact per-capability ask-first choice", () => {
    expect(agentDraftRequestsTaskReview({ capabilities: [{ operation: "create_task", autonomy: "ask_first" }] })).toBe(true);
    for (const autonomy of ["automatic", "not_allowed"] as const)
      expect(agentDraftRequestsTaskReview({ capabilities: [{ operation: "create_task", autonomy }] })).toBe(false);
    expect(agentDraftRequestsTaskReview({ capabilities: [{ operation: "external_send", autonomy: "ask_first" }] })).toBe(false);
  });
  it("keeps ordinary draft text and admits a single proposal or explicit absence", () => {
    expect(parseAgentDraftOutput(" A plain draft ", false)).toEqual({ draft: "A plain draft", proposedTask: null });
    expect(parseAgentDraftOutput(JSON.stringify({ draft: "A draft", proposedTask: null }), true)).toEqual({ draft: "A draft", proposedTask: null });
    expect(parseAgentDraftOutput(JSON.stringify({ draft: "A draft", proposedTask: { title: " Follow up ", description: " Review internal evidence " } }), true))
      .toEqual({ draft: "A draft", proposedTask: { title: "Follow up", description: "Review internal evidence" } });
  });
  it.each([
    { draft: "A draft", proposedTask: { title: "Task", description: "Scope", assigneeAgentId: "forged" } },
    { draft: "A draft", proposedTask: { title: "Task", description: "Scope", parentId: "forged" } },
    { draft: "A draft", proposedTask: { title: "Task", description: "Scope", status: "in_progress" } },
    { draft: "A draft", proposedTask: [{ title: "Task", description: "Scope" }] },
    { draft: "A draft", proposedTask: { title: "Task", description: "Scope" }, tool: "create_task" },
    { draft: "A draft" }, { draft: "", proposedTask: null },
    { draft: "A draft", proposedTask: { title: "x".repeat(241), description: "Scope" } },
    { draft: "A draft", proposedTask: { title: "Task", description: "x".repeat(20001) } },
  ])("refuses widening, incomplete and oversized output without private excerpts (%#)", value => {
    expect(() => parseAgentDraftOutput(JSON.stringify(value), true)).toThrow(/^agent_draft_output_invalid$/);
  });
  it("refuses prose, fenced JSON and oversized envelopes", () => {
    for (const text of ["Private source cannot be parsed", '```json\n{"draft":"A draft","proposedTask":null}\n```', "x".repeat(45001)])
      expect(() => parseAgentDraftOutput(text, true)).toThrow(/^agent_draft_output_invalid$/);
  });
});
