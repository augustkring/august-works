import { describe, expect, it } from "vitest";
import { validatePrpStructuredRunResult } from "../../vendor/paperclip-runner/index.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { MANAGED_OPENCODE_ABORTED_TOOL_RESULT_TEXT } from "../native-runtime/managed-opencode-terminal-tools.js";
import { managedOpenCodeRequestOwnMessages, managedOpenCodeTerminalPlaceholderResult } from "./worker-model-gateway.js";

// CONF15-W7. A resumed same-Task Worker Run replays the retained Run's
// transcript. The retained Run's turn was interrupted at semantic completion,
// so OpenCode replays its final terminal call with its own placeholder
// (`is_error`, "Tool execution aborted") instead of the server acknowledgement
// the retained Run recorded. The gateway admits that placeholder only for a
// terminal tool, with exactly the pinned text, for the retained Run's final
// response's sole terminal call whose acceptance the retained Run's own events
// prove, and only inside the verified retained prefix.

const company = "00000000-0000-4000-8000-0000000000c1";
const agent = "00000000-0000-4000-8000-0000000000a1";
const retainedRunId = "00000000-0000-4000-8000-000000000101";
const currentRunId = "00000000-0000-4000-8000-000000000102";
const runner = "runner-1";
const session = "session-a";
const user = "user-1";
const hash = (c: string) => c.repeat(64);
const sourceSetHash = hash("5");
const dispatchDigest = hash("d");
const retainedPrompt = "retained task prompt";
const currentPrompt = "current task prompt";
const callId = "call-terminal";

const doneResult = { reportedWorkDisposition: "done", summary: "Done.", completionClaim: { contractRevision: "1",
  objectiveSatisfied: true, criteria: [{ criterionId: "objective", status: "satisfied", evidenceRefs: [] }], remainingWork: [] },
  evidence: [], verification: [] };
const blockedResult = { reportedWorkDisposition: "blocked", summary: "Blocked.", completionClaim: { contractRevision: "1",
  objectiveSatisfied: false, criteria: [{ criterionId: "objective", status: "not_satisfied", evidenceRefs: [] }],
  remainingWork: [{ description: "Wait for input.", blocksCompletion: true }] }, evidence: [], verification: [],
  blocker: { reasonCode: "external_input_required", owner: { kind: "external", name: "External input" },
    unblockAction: "Provide the input.", scope: "current_track" } };

const text = (value: string) => ({ type: "text", text: value });
const placeholder = (id = callId) => ({ type: "tool_result", tool_use_id: id, is_error: true,
  content: MANAGED_OPENCODE_ABORTED_TOOL_RESULT_TEXT });

type Scenario = {
  tool: "paperclip_finish" | "paperclip_block" | "write_document" | "read_document";
  result: Record<string, unknown>;
};

function fixture(scenario: Partial<Scenario> = {}) {
  const tool = scenario.tool ?? "paperclip_finish";
  // A terminal call's input is the provider's complete result, which the
  // runner accepts unchanged (normalization adds nothing).
  const raw = scenario.result ?? (tool === "paperclip_block" ? blockedResult : doneResult);
  const result = tool.startsWith("paperclip_")
    ? validatePrpStructuredRunResult(raw).result as unknown as Record<string, unknown> : raw;
  const argumentsHash = nativeSha256(result);
  const terminalResponse = [{ type: "tool_use", id: callId, name: `paperclip_${tool}`, input: result }];
  const terminalIntent = { responseContentHash: nativeSha256(terminalResponse), sourceSetHash,
    sourceDispatchDigest: dispatchDigest,
    responseToolUses: [{ id: callId, name: `paperclip_${tool}`, argumentsHash }] };
  const dispatch = { turnInputDigest: dispatchDigest, responsibleUserId: user, continuation: false,
    dispatchId: "dispatch-1", turnId: "turn-1", eventSeq: 4, attempt: 1 };
  // A non-terminal tool has no semantic result; its events are irrelevant.
  const proposed = validatePrpStructuredRunResult(tool.startsWith("paperclip_") ? result : doneResult);
  if (!proposed.ok) throw new Error("fixture result is invalid");
  const event = (seq: number, eventType: string, payload: Record<string, unknown>, overrides: Record<string, unknown> = {}) => ({
    schema: "paperclip.prp.event.v1", sourceEventId: `${runner}:${retainedRunId}:${seq}`, sourceSeq: seq,
    sourceInstanceId: runner, sourceKind: "runner", runId: retainedRunId, normalizedSessionId: session, turnId: "turn-1",
    itemId: callId, eventType, schemaVersion: 1, priority: 1, emittedAt: "2026-11-16T00:00:00.000Z", payload, ...overrides });
  // The retained Run's persisted runner events for its terminal call, as the
  // managed runner records them: the provider tool call (the provider's call
  // id), the accepted semantic result (its own item id) and the completed
  // provider tool result, all in the dispatched turn.
  const providerItem = (type: "tool_call" | "tool_result", status: string) => ({ kind: type, channel: "detail", text: "",
    item: { type, id: callId, status, channel: "detail", text: null } });
  const events = [
    event(1, "item.started", providerItem("tool_call", "running")),
    event(2, "run.result.proposed", proposed.result as unknown as Record<string, unknown>, { itemId: "semantic-item-1" }),
    event(3, "item.completed", providerItem("tool_result", "completed")),
  ];
  return { tool, result, argumentsHash, terminalResponse, terminalIntent, dispatch, events, event, providerItem };
}

type Fixture = ReturnType<typeof fixture>;

function rowsFor(events: Array<Record<string, unknown>>) {
  return events.map(prpEvent => ({ eventType: prpEvent.eventType, sourceInstanceId: prpEvent.sourceInstanceId,
    sourceEventId: `${runner}:${retainedRunId}:${String(prpEvent.sourceSeq)}`, sourceSeq: prpEvent.sourceSeq,
    sourcePayloadSha256: nativeSha256(prpEvent), payload: { prpEvent } }));
}

function fakeDb(events: Array<Record<string, unknown>>, tamper?: (rows: Array<Record<string, unknown>>) => void) {
  const rows = rowsFor(events) as Array<Record<string, unknown>>;
  tamper?.(rows);
  return { select: () => ({ from: () => ({ where: () => ({ limit: async () => rows }) }) }) };
}

const claims = { scope: "worker_model", company_id: company, run_id: currentRunId, sub: agent,
  responsible_user_id: user } as never;

function retainedHistory(f: Fixture, overrides: { responses?: Array<{ intent: Record<string, unknown> }>;
  profile?: Record<string, unknown> } = {}) {
  return {
    run: { id: retainedRunId, companyId: company, agentId: agent, runnerInstanceId: runner, nativeSessionId: session,
      responsibleUserId: user },
    profile: overrides.profile ?? { nativeModelInputDispatchIntents: [f.dispatch] },
    retainedPrompts: [{ promptHash: nativeSha256(retainedPrompt), sourceSetHash }],
    retainedResponses: overrides.responses ?? [{ intent: f.terminalIntent }],
  } as never;
}

function transcript(f: Fixture, closing: Array<Record<string, unknown>> = [placeholder(), text(currentPrompt)]) {
  return [
    { role: "user", content: [text(retainedPrompt)] },
    { role: "assistant", content: f.terminalResponse },
    { role: "user", content: closing },
  ];
}

async function own(f: Fixture, options: { messages?: unknown[]; events?: Array<Record<string, unknown>>;
  history?: unknown; currentPromptHashes?: string[]; tamper?: (rows: Array<Record<string, unknown>>) => void } = {}) {
  return managedOpenCodeRequestOwnMessages({ db: fakeDb(options.events ?? f.events, options.tamper) as never, claims,
    messages: options.messages ?? transcript(f), currentPromptHashes: options.currentPromptHashes ?? [nativeSha256(currentPrompt)],
    retainedHistory: (options.history === undefined ? retainedHistory(f) : options.history) as never });
}

describe("managedOpenCodeTerminalPlaceholderResult (CONF15-W7)", () => {
  it("is true only for a terminal tool with exactly the pinned placeholder block", () => {
    expect(MANAGED_OPENCODE_ABORTED_TOOL_RESULT_TEXT).toBe("Tool execution aborted");
    expect(managedOpenCodeTerminalPlaceholderResult({ toolName: "paperclip_finish", block: placeholder() })).toBe(true);
    expect(managedOpenCodeTerminalPlaceholderResult({ toolName: "paperclip_block", block: placeholder() })).toBe(true);
  });

  it.each([
    ["a non-terminal tool", "write_document", placeholder()],
    ["a non-terminal tool named like a terminal one", "paperclip_finish_extra", placeholder()],
    ["an unprefixed provider name", "paperclip_paperclip_finish", placeholder()],
    ["other text", "paperclip_finish", { ...placeholder(), content: "Tool execution aborted." }],
    ["OpenCode's pending-tool text", "paperclip_finish", { ...placeholder(), content: "[Tool execution was interrupted]" }],
    ["the pinned text as a text part", "paperclip_finish", { ...placeholder(), content: [text(MANAGED_OPENCODE_ABORTED_TOOL_RESULT_TEXT)] }],
    ["no error flag", "paperclip_finish", { type: "tool_result", tool_use_id: callId, content: MANAGED_OPENCODE_ABORTED_TOOL_RESULT_TEXT }],
    ["a false error flag", "paperclip_finish", { ...placeholder(), is_error: false }],
    ["an extra key", "paperclip_finish", { ...placeholder(), cache_control: { type: "ephemeral" } }],
    ["another block type", "paperclip_finish", { ...placeholder(), type: "text" }],
  ])("is false for %s", (_name, toolName, block) => {
    expect(managedOpenCodeTerminalPlaceholderResult({ toolName: toolName as string, block: block as Record<string, unknown> })).toBe(false);
  });
});

describe("managedOpenCodeRequestOwnMessages admits the retained terminal placeholder (CONF15-W7)", () => {
  it("admits it for the retained Run's accepted final paperclip_finish and returns the current Run's part", async () => {
    await expect(own(fixture())).resolves.toEqual([{ role: "user", content: [text(currentPrompt)] }]);
  });

  it("admits it for the retained Run's accepted final paperclip_block", async () => {
    const f = fixture({ tool: "paperclip_block" });
    await expect(own(f)).resolves.toEqual([{ role: "user", content: [text(currentPrompt)] }]);
  });

  // (1) Only a terminal tool.
  it.each(["write_document", "read_document"] as const)("refuses the placeholder for %s", async (tool) => {
    const f = fixture({ tool, result: { id: "doc" } });
    await expect(own(f)).rejects.toThrow("Managed OpenCode retained tool result has no exact receipt of the retained Run");
  });

  // (2) Only the pinned text, in the pinned block shape.
  it.each([
    ["other text", { ...placeholder(), content: "Tool execution aborted." }],
    ["OpenCode's pending-tool text", { ...placeholder(), content: "[Tool execution was interrupted]" }],
    ["the pinned text as a text part", { ...placeholder(), content: [text(MANAGED_OPENCODE_ABORTED_TOOL_RESULT_TEXT)] }],
    ["no error flag", { type: "tool_result", tool_use_id: callId, content: MANAGED_OPENCODE_ABORTED_TOOL_RESULT_TEXT }],
    ["an extra key", { ...placeholder(), cache_control: { type: "ephemeral" } }],
  ])("refuses a terminal result with %s", async (_name, block) => {
    const f = fixture();
    await expect(own(f, { messages: transcript(f, [block as Record<string, unknown>, text(currentPrompt)]) }))
      .rejects.toThrow(/Managed OpenCode semantic completion/);
  });

  it("refuses a different text for paperclip_block (no acknowledgement path exists for it)", async () => {
    const f = fixture({ tool: "paperclip_block" });
    await expect(own(f, { messages: transcript(f, [{ ...placeholder(), content: "aborted" }, text(currentPrompt)]) }))
      .rejects.toThrow("Managed OpenCode retained tool result has no exact receipt of the retained Run");
  });

  // (3) The tool use must be the retained Run's recorded, accepted terminal call.
  const eventCases: Array<[string, (f: Fixture) => Array<Record<string, unknown>>, ((rows: Array<Record<string, unknown>>) => void)?]> = [
    ["no persisted provider call", f => f.events.slice(1)],
    ["two persisted provider calls", f => [...f.events, f.event(4, "item.started", f.providerItem("tool_call", "running"))]],
    ["a provider call for another id", f => [f.event(1, "item.started", { ...f.providerItem("tool_call", "running"),
      item: { ...f.providerItem("tool_call", "running").item, id: "call-other" } }, { itemId: "call-other" }), ...f.events.slice(1)]],
    ["a provider call event whose item names another id", f => [f.event(1, "item.started", { ...f.providerItem("tool_call", "running"),
      item: { ...f.providerItem("tool_call", "running").item, id: "call-other" } }), ...f.events.slice(1)]],
    ["a provider call on another turn than its dispatch", f => [f.event(1, "item.started", f.providerItem("tool_call", "running"),
      { turnId: "turn-9" }), ...f.events.slice(1)]],
    ["a provider call of another kind", f => [f.event(1, "item.started", { ...f.providerItem("tool_call", "running"), kind: "dynamicToolCall" }),
      ...f.events.slice(1)]],
    ["no accepted semantic result", f => [f.events[0]!, f.events[2]!]],
    ["a different accepted semantic result", f => [f.events[0]!, f.event(2, "run.result.proposed",
      { ...validatePrpStructuredRunResult(f.result).result!, summary: "Other." } as unknown as Record<string, unknown>), f.events[2]!]],
    ["an accepted semantic result on another turn", f => [f.events[0]!, f.event(2, "run.result.proposed",
      f.events[1]!.payload as Record<string, unknown>, { turnId: "turn-9" }), f.events[2]!]],
    ["two accepted semantic results", f => [...f.events, f.event(4, "run.result.proposed", f.events[1]!.payload as Record<string, unknown>)]],
    ["no provider tool result", f => f.events.slice(0, 2)],
    ["a failed provider tool result", f => [...f.events.slice(0, 2), f.event(3, "item.completed", f.providerItem("tool_result", "failed"))]],
    ["a provider tool result before the accepted result", f => [f.events[0]!, f.event(2, "item.completed", f.providerItem("tool_result", "completed")),
      f.event(3, "run.result.proposed", f.events[1]!.payload as Record<string, unknown>)]],
    ["an accepted result before the provider call", f => [f.event(1, "run.result.proposed", f.events[1]!.payload as Record<string, unknown>),
      f.event(2, "item.started", f.providerItem("tool_call", "running")), f.events[2]!]],
    ["events of the current Run", f => f.events.map(e => ({ ...e, runId: currentRunId }))],
    ["events of another session", f => f.events.map(e => ({ ...e, normalizedSessionId: "session-b" }))],
    ["events of another runner instance", f => f.events.map(e => ({ ...e, sourceInstanceId: "runner-2" }))],
    ["events whose stored digest differs", f => f.events, rows => { rows[0]!.sourcePayloadSha256 = `sha256:${String(rows[0]!.sourcePayloadSha256)}`; }],
    ["events whose source event id names another Run", f => f.events, rows => { rows[1]!.sourceEventId = `${runner}:${currentRunId}:2`; }],
  ];
  it.each(eventCases)("refuses the placeholder when the retained Run's events have %s", async (_name, events, tamper) => {
    const f = fixture();
    await expect(own(f, { events: events(f), tamper })).rejects.toMatchObject({ status: 403 });
  });

  it("refuses when the retained Run row has no runner instance or session", async () => {
    const f = fixture();
    for (const overrides of [{ runnerInstanceId: null }, { nativeSessionId: null }]) {
      const history = retainedHistory(f) as unknown as { run: Record<string, unknown> };
      await expect(own(f, { history: { ...history, run: { ...history.run, ...overrides } } }))
        .rejects.toThrow("Managed OpenCode terminal placeholder is not the retained Run's recorded terminal call");
    }
  });

  it("refuses when the terminal call is not the sole tool use of its response", async () => {
    const f = fixture();
    const second = { type: "tool_use", id: "call-other", name: "paperclip_write_document", input: { id: "x" } };
    const response = [...f.terminalResponse, second];
    const intent = { ...f.terminalIntent, responseContentHash: nativeSha256(response),
      responseToolUses: [...f.terminalIntent.responseToolUses, { id: "call-other", name: "paperclip_write_document",
        argumentsHash: nativeSha256({ id: "x" }) }] };
    const messages = [{ role: "user", content: [text(retainedPrompt)] }, { role: "assistant", content: response },
      { role: "user", content: [placeholder(), { type: "tool_result", tool_use_id: "call-other", content: "{}" }, text(currentPrompt)] }];
    await expect(own(f, { messages, history: retainedHistory(f, { responses: [{ intent }] }) }))
      .rejects.toThrow("Managed OpenCode semantic completion was not the sole exact provider tool use");
  });

  it("refuses when the terminal call is not in the retained Run's final response", async () => {
    const f = fixture();
    const later = [text("later answer")];
    const laterIntent = { responseContentHash: nativeSha256(later), sourceSetHash, sourceDispatchDigest: dispatchDigest,
      responseToolUses: [] };
    const messages = [...transcript(f, [placeholder()]), { role: "assistant", content: later },
      { role: "user", content: [text(currentPrompt)] }];
    await expect(own(f, { messages, history: retainedHistory(f, { responses: [{ intent: f.terminalIntent }, { intent: laterIntent }] }) }))
      .rejects.toThrow("Managed OpenCode terminal placeholder is not for the retained Run's final response");
  });

  it("refuses without the retained Run's acknowledged dispatch, or with another Human's", async () => {
    const f = fixture();
    await expect(own(f, { history: retainedHistory(f, { profile: { nativeModelInputDispatchIntents: [] } }) }))
      .rejects.toThrow("Managed OpenCode semantic completion has no exact acknowledged Native input dispatch");
    await expect(own(f, { history: retainedHistory(f, { profile: { nativeModelInputDispatchIntents: [{
      ...f.dispatch, responsibleUserId: "user-2" }] } }) }))
      .rejects.toThrow("Managed OpenCode semantic completion has no exact acknowledged Native input dispatch");
  });

  // (4) Only inside the verified retained prefix, never in the current Run's turns.
  it("refuses a placeholder for a call the retained prefix does not hold", async () => {
    const f = fixture();
    await expect(own(f, { messages: transcript(f, [placeholder(), placeholder("call-stranger"), text(currentPrompt)]) }))
      .rejects.toThrow("(tool_result_without_retained_use)");
  });

  it("refuses a placeholder after the current prompt in the closing message", async () => {
    const f = fixture();
    await expect(own(f, { messages: transcript(f, [text(currentPrompt), placeholder()]) }))
      .rejects.toThrow("(current_prompt_not_final)");
  });

  it("refuses a placeholder in the current Run's own turns after the retained prefix", async () => {
    const f = fixture();
    const ownUse = [{ type: "tool_use", id: "call-own", name: "paperclip_paperclip_finish", input: doneResult }];
    const messages = [...transcript(f), { role: "assistant", content: ownUse }, { role: "user", content: [placeholder("call-own")] }];
    await expect(own(f, { messages }))
      .rejects.toThrow("Managed OpenCode terminal placeholder is outside the retained Run's verified history");
  });

  it("refuses a placeholder in a request without retained history (the current Run's own turns)", async () => {
    const f = fixture();
    const messages = [{ role: "user", content: [text(currentPrompt)] }, { role: "assistant", content: f.terminalResponse },
      { role: "user", content: [placeholder()] }];
    await expect(own(f, { messages, history: null }))
      .rejects.toThrow("Managed OpenCode terminal placeholder is outside the retained Run's verified history");
    for (const tool of ["paperclip_block"]) {
      const use = [{ type: "tool_use", id: callId, name: `paperclip_${tool}`, input: blockedResult }];
      await expect(own(f, { history: null, messages: [{ role: "user", content: [text(currentPrompt)] },
        { role: "assistant", content: use }, { role: "user", content: [placeholder()] }] }))
        .rejects.toThrow("Managed OpenCode terminal placeholder is outside the retained Run's verified history");
    }
  });

  it("leaves own-turn requests without a terminal placeholder unchanged", async () => {
    const f = fixture();
    const messages = [{ role: "user", content: [text(currentPrompt)] }, { role: "assistant", content: f.terminalResponse },
      { role: "user", content: [{ type: "tool_result", tool_use_id: callId, content: "{}" }] }];
    await expect(own(f, { messages, history: null })).resolves.toEqual(messages);
  });
});
