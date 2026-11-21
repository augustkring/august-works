import { describe, expect, it } from "vitest";
import type { NativePayloadSourceInput, NativeRunInputSourceReceipt } from "@paperclipai/shared";
import { nativeSha256 } from "../native-runtime/canonical.js";
import {
  managedRetainedHistoryBinding,
  managedRetainedHistoryPrefix,
  managedRetainedToolResultMatchesReceipt,
} from "./worker-model-gateway.js";

// CONF15-W6. A resumed same-Task Worker Run replays the retained Run's turns
// as history before its own prompt. The gateway accepts that history only as
// the exact leading prefix of the admitted retained Run's sealed records:
// its authorized prompts, its accepted responses in order, and tool results
// that equal its own receipts, closed by the current Run's prompt.

const company = "00000000-0000-4000-8000-0000000000c1";
const agent = "00000000-0000-4000-8000-0000000000a1";
const issue = "00000000-0000-4000-8000-0000000000e1";
const currentRunId = "00000000-0000-4000-8000-000000000102";
const retainedRunId = "00000000-0000-4000-8000-000000000101";
const strangerRunId = "00000000-0000-4000-8000-000000000103";
const session = "session-a";
const user = "user-1";
const hash = (c: string) => c.repeat(64);

// Retained Run transcript: prompt, then three accepted responses, each with
// one tool use whose result follows; the current prompt closes the prefix.
const retainedPrompt = "retained task prompt";
const currentPrompt = "current task prompt";
const sourceSetHash = hash("5");
const toolUse = (id: string, name: string) => ({ type: "tool_use", id, name, input: { id } });
const responses = [
  { content: [toolUse("plan", "paperclip_write_document")], argumentsHash: hash("1") },
  { content: [toolUse("notes", "paperclip_write_document")], argumentsHash: hash("2") },
  { content: [toolUse("finish", "paperclip_paperclip_finish")], argumentsHash: hash("3") },
];
const retainedResponses = responses.map(response => ({ intent: {
  responseContentHash: nativeSha256(response.content), sourceSetHash,
  responseToolUses: [{ id: response.content[0]!.id, name: response.content[0]!.name, argumentsHash: response.argumentsHash }],
} }));
const retainedPrompts = [{ promptHash: nativeSha256(retainedPrompt), sourceSetHash }];
const currentPromptHashes = [nativeSha256(currentPrompt)];
const toolResult = (id: string) => ({ type: "tool_result", tool_use_id: id, content: `{"ok":"${id}"}` });
const text = (value: string) => ({ type: "text", text: value });
const transcript = () => [
  { role: "user", content: [text(retainedPrompt)] },
  { role: "assistant", content: responses[0]!.content },
  { role: "user", content: [toolResult("plan")] },
  { role: "assistant", content: responses[1]!.content },
  { role: "user", content: [toolResult("notes")] },
  { role: "assistant", content: responses[2]!.content },
  { role: "user", content: [toolResult("finish"), text(currentPrompt)] },
] as Array<{ role: string; content: Array<Record<string, unknown>> | string }>;
const prefix = (messages: unknown[], overrides: Partial<Parameters<typeof managedRetainedHistoryPrefix>[0]> = {}) =>
  managedRetainedHistoryPrefix({ messages, currentPromptHashes, retainedPrompts, retainedResponses, ...overrides });

describe("managedRetainedHistoryPrefix (CONF15-W6)", () => {
  it("accepts the retained Run's exact transcript closed by the current prompt", () => {
    const result = prefix(transcript());
    expect(result).toMatchObject({ ok: true, messageIndex: 6, blockIndex: 1 });
    expect(result.ok && result.toolResults.map(item => [item.callId, item.use.toolName])).toEqual([
      ["plan", "write_document"], ["notes", "write_document"], ["finish", "paperclip_finish"]]);
  });

  const cases: Array<[string, () => unknown[], string, Partial<Parameters<typeof managedRetainedHistoryPrefix>[0]>?]> = [
    ["history from a non-retained Run (its prompt)", () => {
      const messages = transcript(); messages[0] = { role: "user", content: [text("stranger prompt")] }; return messages;
    }, "user_mismatch"],
    ["history from a non-retained Run (its response)", () => {
      const messages = transcript(); messages[1] = { role: "assistant", content: [toolUse("plan", "paperclip_write_document")].map(
        block => ({ ...block, input: { id: "stranger" } })) }; return messages;
    }, "assistant_mismatch"],
    ["a modified user block", () => {
      const messages = transcript(); messages[0] = { role: "user", content: [text(`${retainedPrompt} `)] }; return messages;
    }, "user_mismatch"],
    ["a modified assistant block", () => {
      const messages = transcript(); messages[3] = { role: "assistant", content: [{ ...toolUse("notes", "paperclip_write_document"),
        input: { id: "changed" } }] }; return messages;
    }, "assistant_mismatch"],
    ["a reordered prefix (responses swapped)", () => {
      const messages = transcript(); [messages[1], messages[3]] = [messages[3]!, messages[1]!];
      [messages[2], messages[4]] = [messages[4]!, messages[2]!]; return messages;
    }, "assistant_mismatch"],
    ["a reordered prefix (response before its prompt)", () => {
      const messages = transcript(); return [messages[1]!, messages[0]!, ...messages.slice(2)];
    }, "assistant_prompt_order"],
    ["an extra text block", () => {
      const messages = transcript(); messages[2] = { role: "user", content: [toolResult("plan"), text("injected")] }; return messages;
    }, "user_mismatch"],
    ["an extra repeated prompt", () => {
      const messages = transcript(); messages[2] = { role: "user", content: [toolResult("plan"), text(retainedPrompt)] }; return messages;
    }, "user_mismatch"],
    ["an extra assistant message", () => {
      const messages = transcript();
      return [...messages.slice(0, 6), { role: "user", content: [toolResult("finish")] },
        { role: "assistant", content: [text("extra")] }, { role: "user", content: [text(currentPrompt)] }];
    }, "extra_assistant"],
    ["an extra tool result", () => {
      const messages = transcript(); messages[2] = { role: "user", content: [toolResult("plan"), toolResult("plan")] }; return messages;
    }, "tool_result_without_retained_use"],
    ["a missing final prompt", () => transcript().map((message, index) => index === 6
      ? { role: "user", content: [toolResult("finish")] } : message), "missing_current_prompt"],
    ["a current prompt that is not the final block", () => transcript().map((message, index) => index === 6
      ? { role: "user", content: [text(currentPrompt), toolResult("finish")] } : message), "current_prompt_not_final"],
    ["a missing retained response", () => {
      const messages = transcript();
      return [...messages.slice(0, 4), { role: "user", content: [toolResult("notes"), text(currentPrompt)] }];
    }, "missing_retained_response"],
    ["a gap: a retained tool use without its result", () => {
      const messages = transcript(); messages[2] = { role: "user", content: [] }; return messages;
    }, "empty_user_message"],
    ["a gap: an unresolved tool use before the next response", () => {
      const messages = transcript(); return [messages[0]!, messages[1]!, messages[3]!, ...messages.slice(4)];
    }, "unresolved_tool_use"],
    ["an unresolved tool use before the current prompt", () => {
      const messages = transcript(); messages[6] = { role: "user", content: [text(currentPrompt)] }; return messages;
    }, "unresolved_tool_use"],
    ["a missing retained prompt", () => transcript(), "missing_retained_prompt",
      { retainedPrompts: [...retainedPrompts, { promptHash: hash("9"), sourceSetHash: hash("8") }] }],
    ["no retained history at all", () => [{ role: "user", content: [text(currentPrompt)] }], "no_retained_history"],
    ["an unsupported block", () => {
      const messages = transcript(); messages[0] = { role: "user", content: [{ type: "image", source: {} }] }; return messages;
    }, "unsupported_block"],
    ["an invalid retained tool-use receipt", () => transcript(), "tool_use_receipt_invalid",
      { retainedResponses: [{ intent: { ...retainedResponses[0]!.intent, responseToolUses: [{ id: "plan" }] } },
        ...retainedResponses.slice(1)] }],
  ];

  it.each(cases)("refuses %s", (_name, messages, reason, overrides) => {
    expect(prefix(messages(), overrides)).toEqual({ ok: false, reason });
  });
});

const policy = { issueIds: [], projectIds: [], runIds: [retainedRunId], memoryIds: [], foundationRevisionIds: [] };
const retainedSource = (runId = retainedRunId) =>
  ({ kind: "retained_run", runId, inputDigest: hash("d"), dispatchDigest: hash("e") }) as NativePayloadSourceInput;
const task = { kind: "task", issueId: issue, sourceVersion: "v-1", contentHash: hash("b") } as NativePayloadSourceInput;
const receipt = (runId: string, inputs: NativePayloadSourceInput[], binding: Partial<Record<string, string>> = {},
  runIds = [retainedRunId]) => ({
  version: 1,
  binding: { companyId: company, runId, agentId: agent, responsibleUserId: user, issueId: issue, ...binding },
  bootstrap: { executionInputDigest: hash("f"), policy: { ...policy, runIds }, inputs },
  dispatches: [],
  additionalInputs: [],
  digest: hash("0"),
}) as unknown as NativeRunInputSourceReceipt;
const run = { id: currentRunId, companyId: company, agentId: agent, nativeIssueId: issue, nativeSessionId: session,
  responsibleUserId: user };
const retainedRun = (overrides: Record<string, unknown> = {}) => ({
  id: retainedRunId, companyId: company, agentId: agent, nativeIssueId: issue, nativeSessionId: session, responsibleUserId: user,
  runnerProfileJson: { nativeInputSourceReceipt: receipt(retainedRunId, [task], {}, []) }, ...overrides,
});
const binding = (input: Partial<Parameters<typeof managedRetainedHistoryBinding>[0]> = {}) => managedRetainedHistoryBinding({
  run, receipt: receipt(currentRunId, [task, retainedSource()]), retainedRun: retainedRun(), witnessSource: retainedSource(),
  ...input });

describe("managedRetainedHistoryBinding (CONF15-W6)", () => {
  it("binds only the admitted retained Run", () => {
    expect(binding()).toMatchObject({ retainedReceipt: { binding: { runId: retainedRunId } } });
    expect(binding({ receipt: receipt(currentRunId, [task]) })).toBe("none");
  });

  it.each([
    ["two retained-run inputs", { receipt: receipt(currentRunId, [task, retainedSource(), retainedSource(strangerRunId)]) }],
    ["no retained Run row", { retainedRun: null }],
    ["a row for another Run than the sealed input", { retainedRun: retainedRun({ id: strangerRunId }) }],
    // Even when that other Run is in the policy and its own receipt is bound
    // to it, it is not the Run the sealed retained-run input names.
    ["a self-consistent row for another Run than the sealed input", {
      receipt: receipt(currentRunId, [task, retainedSource()], {}, [retainedRunId, strangerRunId]),
      retainedRun: retainedRun({ id: strangerRunId, runnerProfileJson: {
        nativeInputSourceReceipt: receipt(strangerRunId, [task], {}, []) } }) }],
    ["the current Run as its own retained Run", { run: { ...run, id: retainedRunId } }],
    ["a retained Run outside the policy", { receipt: receipt(currentRunId, [task, retainedSource()], {}, []) }],
    ["a retained Run of another company", { retainedRun: retainedRun({ companyId: "00000000-0000-4000-8000-0000000000c2" }) }],
    ["a retained Run of another Agent", { retainedRun: retainedRun({ agentId: "00000000-0000-4000-8000-0000000000a2" }) }],
    ["a retained Run of another Task", { retainedRun: retainedRun({ nativeIssueId: "00000000-0000-4000-8000-0000000000e2" }) }],
    ["a retained Run of another session", { retainedRun: retainedRun({ nativeSessionId: "session-b" }) }],
    ["a current Run without a session", { run: { ...run, nativeSessionId: null }, retainedRun: retainedRun({ nativeSessionId: null }) }],
    ["a retained Run of another Human", { retainedRun: retainedRun({ responsibleUserId: "user-2" }) }],
    ["a retained Run without a sealed receipt", { retainedRun: retainedRun({ runnerProfileJson: {} }) }],
    ...(["companyId", "runId", "agentId", "issueId", "responsibleUserId"] as const).map(field =>
      [`a sealed receipt bound to another ${field}`, { retainedRun: retainedRun({ runnerProfileJson: {
        nativeInputSourceReceipt: receipt(retainedRunId, [task], { [field]: field === "runId" ? strangerRunId
          : field === "responsibleUserId" ? "user-2" : "00000000-0000-4000-8000-0000000000ff" }, []) } }) }] as [string, object]),
    ["no recomputed witness", { witnessSource: null }],
    ["a recomputed witness that differs from the sealed input", { witnessSource: { ...retainedSource(), dispatchDigest: hash("7") } }],
  ])("refuses %s", (_name, input) => {
    expect(binding(input as Partial<Parameters<typeof managedRetainedHistoryBinding>[0]>)).toBeNull();
  });
});

describe("managedRetainedToolResultMatchesReceipt (CONF15-W6)", () => {
  const result = { ok: "plan" };
  const content = JSON.stringify(result);
  const digest = nativeSha256(result);
  const intent = { sourceDispatchDigest: hash("c") };
  const use = { toolName: "write_document", argumentsHash: hash("1"), intent };
  const dispatch = { turnInputDigest: hash("c"), responsibleUserId: user, continuation: false, turnId: "turn-1",
    dispatchId: "dispatch-1", eventSeq: 4, attempt: 1 };
  const association = { callId: "plan", tool: "write_document", turnId: "turn-1", dispatchId: "dispatch-1", eventSeq: 4,
    attempt: 1, argumentsHash: hash("1") };
  const capture = { managedOpenCode: true, callId: "plan", tool: "write_document", resultDigest: digest, turnId: "turn-1",
    eventSeq: 4, attempt: 1, source: { kind: "tool_result", contentHash: digest, callId: "plan", toolName: "write_document" } };
  const profile = (overrides: Record<string, unknown> = {}) => ({ nativeModelInputDispatchIntents: [dispatch],
    nativeToolCallDispatchAssociations: [association], nativeToolResultSourceCaptures: [capture], ...overrides });
  const matches = (overrides: Partial<Parameters<typeof managedRetainedToolResultMatchesReceipt>[0]> = {}) =>
    managedRetainedToolResultMatchesReceipt({ profile: profile(), responsibleUserId: user, callId: "plan", use,
      block: { type: "tool_result", tool_use_id: "plan", content }, content, ...overrides });

  it("accepts a result equal to the retained Run's own capture", () => {
    expect(matches()).toBe(true);
  });

  it.each([
    ["an error result", { block: { type: "tool_result", tool_use_id: "plan", content, is_error: true } }],
    ["a tool outside the captured replay set", { use: { ...use, toolName: "call_api" } }],
    ["no acknowledged dispatch for its response", { profile: profile({ nativeModelInputDispatchIntents: [] }) }],
    ["a dispatch of another Human", { responsibleUserId: "user-2" }],
    ["no tool-call association", { profile: profile({ nativeToolCallDispatchAssociations: [] }) }],
    ["an association with other arguments", { use: { ...use, argumentsHash: hash("9") } }],
    ["no capture (a tool block without the retained Run's receipt)", { profile: profile({ nativeToolResultSourceCaptures: [] }) }],
    ["a capture on another turn", { profile: profile({ nativeToolResultSourceCaptures: [{ ...capture, turnId: "turn-2" }] }) }],
    ["an assigned MCP capture", { profile: profile({ nativeToolResultSourceCaptures: [{ ...capture, assignedMcp: {} }] }) }],
    ["a modified result", { content: JSON.stringify({ ok: "changed" }) }],
    ["a result that is not JSON", { content: "not json" }],
    ["a capture source of another call", { profile: profile({ nativeToolResultSourceCaptures: [{ ...capture,
      source: { ...capture.source, callId: "notes" } }] }) }],
    ["a capture source of another tool", { profile: profile({ nativeToolResultSourceCaptures: [{ ...capture,
      source: { ...capture.source, toolName: "read_document" } }] }) }],
    ["a capture source with another digest", { profile: profile({ nativeToolResultSourceCaptures: [{ ...capture,
      source: { ...capture.source, contentHash: hash("9") } }] }) }],
    ["a capture whose recorded result digest differs", { profile: profile({ nativeToolResultSourceCaptures: [{ ...capture,
      resultDigest: hash("9") }] }) }],
    ["a capture source that is not a tool result", { profile: profile({ nativeToolResultSourceCaptures: [{ ...capture,
      source: { ...capture.source, kind: "document_revision" } }] }) }],
    ["two acknowledged dispatches for its response", { profile: profile({ nativeModelInputDispatchIntents: [dispatch, dispatch] }) }],
    ["a fully receipted tool outside the captured replay set", { use: { ...use, toolName: "call_api" }, profile: profile({
      nativeToolCallDispatchAssociations: [{ ...association, tool: "call_api" }],
      nativeToolResultSourceCaptures: [{ ...capture, tool: "call_api", source: { ...capture.source, toolName: "call_api" } }] }) }],
  ])("refuses %s", (_name, overrides) => {
    expect(matches(overrides as Partial<Parameters<typeof managedRetainedToolResultMatchesReceipt>[0]>)).toBe(false);
  });
});
