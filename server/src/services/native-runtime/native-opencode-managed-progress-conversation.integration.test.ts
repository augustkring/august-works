import { and, eq } from "drizzle-orm";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, heartbeatRuns, issueComments, toolInvocations } from "@paperclipai/db";
import { nativePayloadSourceSnapshotSchema } from "@paperclipai/shared";
import { assertNativeModelOutputCaptureCurrent, nativeManagedProgressCommentSourceSet } from "../native-direct-input.js";
import type { NativeModelOutputCapture } from "./native-execution-input.js";
import { startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { makeConversationFixtureTreeWritable, runManagedNativeConversationFrame } from "../../__tests__/helpers/managed-native-conversation-frame.js";
import { qualifiedOpenCodeBinary } from "../../__tests__/helpers/managed-native-opencode-e2e-fixture.js";

let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof createDb>;
let root = "";

function toolName(body: Record<string, unknown>, wanted: string): string {
  const tools = Array.isArray(body.tools) ? body.tools as Array<Record<string, unknown>> : [];
  const found = tools.find(value => typeof value.name === "string" && value.name.endsWith(wanted));
  if (typeof found?.name !== "string") throw new Error(`managed_conversation_progress_tool_missing_${wanted}`);
  return found.name;
}

function toolResultBlock(body: Record<string, unknown>, toolUseId: string): Record<string, unknown> | undefined {
  const messages = Array.isArray(body.messages) ? body.messages as Array<Record<string, unknown>> : [];
  return messages.flatMap(message => Array.isArray(message.content)
    ? message.content as Array<Record<string, unknown>> : []).find(block =>
      block.type === "tool_result" && block.tool_use_id === toolUseId);
}

function toolResultJson(block: Record<string, unknown>): Record<string, unknown> {
  if (block.is_error === true) throw new Error("managed_conversation_tool_result_is_error");
  const content = typeof block.content === "string" ? block.content
    : Array.isArray(block.content) ? (block.content as Array<Record<string, unknown>>)
      .map(part => typeof part.text === "string" ? part.text : "").join("") : "";
  const parsed: unknown = JSON.parse(content);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("managed_conversation_tool_result_not_object");
  return parsed as Record<string, unknown>;
}

describe.skipIf(!qualifiedOpenCodeBinary())("managed Native conversation report progress", () => {
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "managed-native-progress-conversation-"));
    database = await startEmbeddedPostgresTestDatabase("managed-native-progress-conversation-");
    db = createDb(database.connectionString);
  }, 60_000);
  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await database?.cleanup();
    if (root) { await makeConversationFixtureTreeWritable(root); await rm(root, { recursive: true, force: true }); }
  }, 30_000);

  it("captures and reads a no-plan semantic progress comment through the actual OpenCode conversation SDK", async () => {
    const binary = qualifiedOpenCodeBinary();
    if (!binary) throw new Error("qualified_opencode_binary_unavailable");
    const progressCallId = `conversation-progress-${Date.now()}`;
    const historyCallId = `conversation-history-${Date.now()}`;
    const progressBody = "I inspected the request and am checking the task history before replying.";
    let progressToolResultSeen = false;
    let progressCommentId: string | null = null;
    let historyToolResultSawComment = false;
    const result = await runManagedNativeConversationFrame({ db, root, opencodeBinary: binary,
      conversationWorkMode: "standard", timeoutSec: 240,
      conversationPrompt: "Please inspect the task, report a brief progress update, read the history, and then reply.",
      providerReply: ({ body, callIndex }) => {
        if (callIndex === 1) return { stop_reason: "tool_use", content: [{ type: "tool_use", id: progressCallId,
          name: toolName(body, "report_progress"), input: { idempotencyKey: `conversation:${progressCallId}`, body: progressBody } }] };
        if (callIndex === 2) {
          const progressResultBlock = toolResultBlock(body, progressCallId);
          const progressResult = progressResultBlock ? toolResultJson(progressResultBlock) : null;
          progressCommentId = typeof progressResult?.commentId === "string" ? progressResult.commentId : null;
          progressToolResultSeen = Boolean(progressCommentId && progressResult?.issueId && progressResult.disposition === "applied");
          if (!progressToolResultSeen) throw new Error("managed_conversation_progress_result_not_resumed");
          return { stop_reason: "tool_use", content: [{ type: "tool_use", id: historyCallId,
            name: toolName(body, "get_task_history"), input: { limit: 20 } }] };
        }
        if (callIndex === 3) {
          const historyResultBlock = toolResultBlock(body, historyCallId);
          const historyResult = historyResultBlock ? toolResultJson(historyResultBlock) : null;
          const comments = Array.isArray(historyResult?.comments) ? historyResult.comments as Array<Record<string, unknown>> : [];
          historyToolResultSawComment = Boolean(progressCommentId && comments.some(comment =>
            comment.id === progressCommentId && comment.body === progressBody));
          if (!historyToolResultSawComment) throw new Error("managed_conversation_history_missing_progress_comment");
          return { stop_reason: "end_turn", content: [{ type: "text", text: "I reported progress and verified the conversation history." }] };
        }
        throw new Error(`managed_conversation_progress_unexpected_provider_call_${callIndex}`);
      },
    });

    expect(result.success, JSON.stringify({ runStatus: result.runStatus, providerCallCount: result.providerCallCount,
      providerStubFailure: result.providerStubFailure, providerHookFailure: result.providerHookFailure })).toBe(true);
    expect(result.providerCallCount).toBe(3);
    expect(progressToolResultSeen).toBe(true);
    expect(historyToolResultSawComment).toBe(true);
    expect(result.workerPlan).toBeNull();
    expect(result.workerAttempts).toHaveLength(0);
    expect(result.reservation).toMatchObject({ purpose: "conversation_model", status: "completed" });
    const runId = result.run!.id, companyId = result.run!.companyId, agentId = result.run!.agentId;
    const [progress] = await db.select().from(issueComments).where(and(eq(issueComments.companyId, companyId),
      eq(issueComments.issueId, result.issueId), eq(issueComments.createdByRunId, runId),
      eq(issueComments.authorAgentId, agentId), eq(issueComments.body, progressBody))).limit(1);
    expect(progress).toBeDefined();
    expect(progress).toMatchObject({ authorType: "agent", payloadSourceProtocolVersion: 1,
      payloadSourceSnapshotInvalidated: false });
    const snapshot = nativePayloadSourceSnapshotSchema.parse(progress!.payloadSourceSnapshot);
    const conversationDispatches = snapshot.inputs.filter(source => source.kind === "conversation_model_dispatch" &&
      source.runId === runId && source.issueId === result.issueId && source.agentId === agentId);
    expect(conversationDispatches).toHaveLength(1);

    const [storedRun] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
    const profile = storedRun!.runnerProfileJson as Record<string, unknown>;
    const captures = Array.isArray(profile.nativeToolResultSourceCaptures)
      ? profile.nativeToolResultSourceCaptures as Array<Record<string, unknown>> : [];
    const capture = captures.find(value => value.managedOpenCode === true && value.tool === "report_progress" &&
      value.callId === progressCallId);
    expect(capture).toBeDefined();
    const progressProof = capture!.progressComment as Record<string, unknown>;
    const outputCapture = progressProof.outputCapture as unknown as NativeModelOutputCapture;
    expect(outputCapture.dispatch).toMatchObject({ kind: "conversation_model_dispatch", runId,
      issueId: result.issueId, agentId });
    expect(outputCapture.sourceSet.inputs).not.toContainEqual(outputCapture.dispatch);
    const commentSourceSet = nativeManagedProgressCommentSourceSet(outputCapture);
    expect(commentSourceSet.inputs).toContainEqual(outputCapture.dispatch);
    expect({ policy: snapshot.policy, inputs: snapshot.inputs }).toEqual(commentSourceSet);
    await expect(assertNativeModelOutputCaptureCurrent(db, companyId, result.issueId, outputCapture,
      "report_progress", undefined, "settled")).resolves.toBeUndefined();
    await expect(assertNativeModelOutputCaptureCurrent(db, companyId, result.issueId, {
      ...outputCapture, dispatch: { ...outputCapture.dispatch, reservationId: `forged-${runId}` } as typeof outputCapture.dispatch,
    }, "report_progress")).rejects.toThrow();
    await expect(assertNativeModelOutputCaptureCurrent(db, companyId, result.issueId, {
      ...outputCapture, sourceSet: { ...outputCapture.sourceSet,
        inputs: outputCapture.sourceSet.inputs.filter(source => source.kind !== "task") },
    }, "report_progress")).rejects.toThrow();
    expect(await db.select().from(toolInvocations).where(and(eq(toolInvocations.companyId, companyId),
      eq(toolInvocations.runId, runId)))).toEqual([]);
    const receipts = (storedRun!.resultJson as Record<string, unknown>).semanticToolReceipts as Record<string, Record<string, unknown>>;
    expect(Object.values(receipts).some(receipt => receipt.operationId === "report_progress" &&
      (receipt.result as Record<string, unknown> | undefined)?.commentId === progress!.id &&
      (receipt.nativeInputDispatch as Record<string, unknown> | undefined)?.callId === progressCallId)).toBe(true);
  }, 240_000);

  it("hides progress in Ask mode and rejects a forged provider call without publishing a comment", async () => {
    const binary = qualifiedOpenCodeBinary();
    if (!binary) throw new Error("qualified_opencode_binary_unavailable");
    const progressBody = "forged ask-mode progress must not be stored";
    let askCatalogExcludedProgress = false;
    const result = await runManagedNativeConversationFrame({ db, root, opencodeBinary: binary,
      conversationWorkMode: "ask", timeoutSec: 240,
      conversationPrompt: "Answer the question without changing task state.",
      providerReply: ({ body, callIndex }) => {
        if (callIndex !== 1) throw new Error(`ask_progress_unexpected_provider_call_${callIndex}`);
        const tools = Array.isArray(body.tools) ? body.tools as Array<Record<string, unknown>> : [];
        askCatalogExcludedProgress = !tools.some(value => typeof value.name === "string" && value.name.endsWith("report_progress"));
        return { stop_reason: "tool_use", content: [{ type: "tool_use", id: `ask-forged-${Date.now()}`,
          name: "report_progress", input: { idempotencyKey: "forged-ask-progress", body: progressBody } }] };
      },
    });
    expect(askCatalogExcludedProgress).toBe(true);
    expect(result.success).toBe(false);
    expect(result.run?.id).toBeTruthy();
    expect(await db.select().from(issueComments).where(and(eq(issueComments.companyId, result.run!.companyId),
      eq(issueComments.issueId, result.issueId), eq(issueComments.createdByRunId, result.run!.id),
      eq(issueComments.body, progressBody)))).toEqual([]);
  }, 240_000);

});
