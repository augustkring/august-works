import { describe, expect, it } from "vitest";
import { nativeSha256 } from "../native-runtime/canonical.js";
import {
  MANAGED_TERMINAL_TOOL_CORRECTIONS_PER_RUN,
  assertManagedTerminalToolRejection,
  isManagedTerminalToolRejectionText,
} from "./worker-model-gateway.js";

// APR-E2E-26. A provider may correct a rejected terminal tool call. The
// gateway admits the error result only for a rejection this Run's runner
// recorded for its recorded terminal call, with exactly that text, at most
// twice per Run. Every other error result stays refused.

const company = "00000000-0000-4000-8000-0000000000c1";
const runId = "00000000-0000-4000-8000-000000000102";
const runner = "runner-1";
const session = "session-a";
const args = { reportedWorkDisposition: "done", summary: "Done." };
const invalid = "Invalid semantic result.";
const wrongTool = "paperclip_block requires reportedWorkDisposition=blocked.";

type Item = Record<string, unknown>;
let seq = 0;
function event(eventType: string, itemId: string, item: Item, turnId = "turn-1") {
  seq += 1;
  return { schema: "paperclip.prp.event.v1", sourceEventId: `${runner}:${runId}:${seq}`, sourceSeq: seq,
    sourceInstanceId: runner, sourceKind: "runner", runId, normalizedSessionId: session, turnId, itemId, eventType,
    schemaVersion: 1, priority: 1, emittedAt: "2026-11-21T00:00:00.000Z", payload: { kind: "dynamicToolCall", item } };
}
const started = (id: string, name = "paperclip_finish", input: unknown = args) =>
  event("item.started", id, { type: "tool_call", id, name, arguments: input });
const rejected = (id: string, error = invalid, turnId = "turn-1") =>
  event("item.completed", id, { type: "tool_result", id, tool_use_id: id, is_error: true, error }, turnId);

function fakeDb(events: Array<Record<string, unknown>>) {
  const rows = events.map(prpEvent => ({ eventType: prpEvent.eventType, sourceInstanceId: prpEvent.sourceInstanceId,
    sourceEventId: prpEvent.sourceEventId, sourceSeq: prpEvent.sourceSeq,
    sourcePayloadSha256: `sha256:${nativeSha256(prpEvent)}`, payload: { prpEvent } }));
  return { select: () => ({ from: () => ({ where: () => ({ limit: async () => rows }) }) }) };
}

const claims = { scope: "worker_model", company_id: company, run_id: runId } as never;
const run = { id: runId, companyId: company, runnerInstanceId: runner, nativeSessionId: session } as never;

function check(events: Array<Record<string, unknown>>, input: { callId?: string; toolName?: string; content?: string;
  argumentsHash?: string } = {}) {
  return assertManagedTerminalToolRejection({ db: fakeDb(events) as never, claims, run,
    providerUse: { toolName: input.toolName ?? "paperclip_finish", argumentsHash: input.argumentsHash ?? nativeSha256(args) },
    callId: input.callId ?? "call-1", content: input.content ?? invalid });
}

describe("managed terminal tool self-correction (APR-E2E-26)", () => {
  it("names exactly the runner's terminal rejection texts", () => {
    expect(isManagedTerminalToolRejectionText(invalid)).toBe(true);
    expect(isManagedTerminalToolRejectionText("Invalid semantic result")).toBe(true);
    expect(isManagedTerminalToolRejectionText(wrongTool)).toBe(true);
    expect(isManagedTerminalToolRejectionText(
      'Semantic result criteria must contain exactly these criterionIds, once each: ["objective"]. Keep contractRevision "1".')).toBe(true);
    expect(isManagedTerminalToolRejectionText("Invalid semantic result!")).toBe(false);
    expect(isManagedTerminalToolRejectionText("Tool execution aborted")).toBe(false);
    expect(isManagedTerminalToolRejectionText("Name the reviewer decision or finish the remaining work.")).toBe(false);
    expect(MANAGED_TERMINAL_TOOL_CORRECTIONS_PER_RUN).toBe(2);
  });

  it("admits the first and second recorded rejections and refuses the third", async () => {
    seq = 0;
    const events = [started("call-1"), rejected("call-1"), started("call-2", "paperclip_block"),
      rejected("call-2", wrongTool), started("call-3"), rejected("call-3")];
    await expect(check(events)).resolves.toBeUndefined();
    await expect(check(events, { callId: "call-2", toolName: "paperclip_block", content: wrongTool })).resolves.toBeUndefined();
    await expect(check(events, { callId: "call-3" })).rejects.toThrow("correction limit for this Run is exhausted");
  });

  it.each([
    ["an unrecorded call id", { callId: "call-9" }],
    ["a non-terminal tool", { toolName: "write_document" }],
    ["a different text than recorded", { content: wrongTool }],
    ["text outside the rejection list", { content: "Something else failed." }],
    ["other arguments than recorded", { argumentsHash: nativeSha256({ other: true }) }],
    ["the other terminal tool than recorded", { toolName: "paperclip_block" }],
  ])("refuses %s", async (_label, input) => {
    seq = 0;
    await expect(check([started("call-1"), rejected("call-1")], input)).rejects.toThrow();
  });

  it("refuses a recorded call without a rejection, a rejection in another turn, and a reused call id", async () => {
    seq = 0;
    await expect(check([started("call-1")])).rejects.toThrow("no exact recorded rejection");
    seq = 0;
    await expect(check([started("call-1"), rejected("call-1", invalid, "turn-2")])).rejects.toThrow("no exact recorded rejection");
    seq = 0;
    await expect(check([started("call-1"), rejected("call-1"), started("call-1"), rejected("call-1")]))
      .rejects.toThrow("no exact recorded rejection");
  });

  it("refuses a rejection recorded before its call and an event that is not the persisted runner event", async () => {
    seq = 0;
    const early = rejected("call-1");
    await expect(check([early, started("call-1")])).rejects.toThrow("no exact recorded rejection");
    seq = 0;
    const tampered = rejected("call-1");
    const events = [started("call-1"), tampered];
    const db = fakeDb(events);
    const rows = await db.select().from().where().limit();
    rows[1]!.sourcePayloadSha256 = `sha256:${"0".repeat(64)}`;
    await expect(assertManagedTerminalToolRejection({ db: { select: () => ({ from: () => ({ where: () => ({
      limit: async () => rows }) }) }) } as never, claims, run,
    providerUse: { toolName: "paperclip_finish", argumentsHash: nativeSha256(args) }, callId: "call-1", content: invalid }))
      .rejects.toThrow("no exact recorded rejection");
  });
});
