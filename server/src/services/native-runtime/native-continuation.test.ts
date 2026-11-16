import { describe, expect, it } from "vitest";
import { buildNativeContinuationPrompt } from "./native-continuation.js";

const issue = { title: "Original task", description: "Retain my long task brief." };
const message = { id: "new", body: "Yes, please proceed.", authorType: "user", authorId: "board", sourceTrust: "user", createdByRunId: null };
const wake = {
  reason: "issue_commented",
  executionContinuation: {
    version: 1,
    objective: message.body,
    messages: [{ ...message, id: "old", body: "OLD_HISTORY" }, message],
    resumeDelta: { baseRunId: "prior", messages: [message] },
    completedWork: { summary: "OLD_SUMMARY" },
    humanResponses: [{ id: "old-question", result: { answer: "OLD_ANSWER" } }],
  },
  comments: [message], continuationSummary: { markdown: "OLD_SUMMARY" },
};
const build = (value: unknown = wake, previousIssue = issue) => buildNativeContinuationPrompt({ wakePayload: value, previousRunId: "prior", issue, previousIssue });

describe("native continuation event projection", () => {
  it("sends a new comment once without the unchanged brief, objective, history or summary", () => {
    const text = build()!;
    expect(text.split(message.body)).toHaveLength(2);
    for (const old of [issue.description, issue.title, "OLD_HISTORY", "OLD_SUMMARY", "OLD_ANSWER"]) expect(text).not.toContain(old);
    expect(JSON.parse(text).messages[0]).toMatchObject({ authorType: "user", body: message.body });
    expect(text.length).toBeLessThan(600);
  });
  it("only uses a delta whose base matches the actual previous run", () => {
    expect(build({ ...wake, executionContinuation: { ...wake.executionContinuation, resumeDelta: { baseRunId: "different", messages: [message] } } })).toBeNull();
    expect(build({ ...wake, executionContinuation: null })).toBeNull();
  });
  it("delivers the current authenticated answer once, not all prior answers", () => {
    const text = build({ ...wake, interactionId: "new-question", executionContinuation: { ...wake.executionContinuation, resumeDelta: { baseRunId: "prior", messages: [] }, humanResponses: [...wake.executionContinuation.humanResponses, { id: "new-question", kind: "ask_user_questions", status: "answered", resolvedByUserId: "board", result: { answer: "NEW_ANSWER" } }] } })!;
    expect(text.split("NEW_ANSWER")).toHaveLength(2);
    expect(text).not.toContain("OLD_ANSWER");
    expect(JSON.parse(text).humanResponses[0].resolvedByUserId).toBe("board");
  });
  it("includes external child completion and actual brief edits", () => {
    const text = build({ ...wake, reason: "issue_children_completed", childIssueSummaries: [{ id: "child", status: "done", summary: "CHILD_RESULT" }] }, { ...issue, description: "old brief" })!;
    expect(JSON.parse(text).taskChanges).toEqual({ description: issue.description });
    expect(text).toContain("CHILD_RESULT");
  });
  it.each([{ fallbackFetchNeeded: true }, { recovery: { cause: "interrupted" } }, { externalChatExecutionBound: true }, { reason: "issue_assigned" }])("retains bootstrap framing for special wakes: %j", (extra) => {
    expect(build({ ...wake, ...extra })).toBeNull();
  });
});

// CONF15-W9: heartbeat attaches the Task's plan context to every comment wake
// once a `plan` document exists (`plan-review-context.ts`). With no open
// annotation, comment or interaction it carries only the plan revision, which
// a verified retained resume's compact events keep; any actual review input,
// and every other execution (Step 0), keeps the full framing.
describe("ordinary plan context on a retained comment wake", () => {
  const plan = {
    documentKey: "plan", issueId: "task", latestRevisionId: "plan-revision-1", latestRevisionNumber: 1,
    threads: [], interaction: null,
    totals: { openThreadCount: 0, includedThreadCount: 0, omittedThreadCount: 0, commentCount: 0, includedCommentCount: 0, omittedCommentCount: 0 },
    limits: { maxThreads: 20, maxComments: 80, maxBodyChars: 1200, maxTotalBodyChars: 12000, maxAnchorTextChars: 500 },
    truncated: false,
  };
  const thread = { id: "thread", documentKey: "plan", documentId: "doc", status: "open", revisionId: "plan-revision-1", revisionNumber: 1,
    anchorState: "active", anchorConfidence: "exact", selectedText: "Inspect", selectedTextTruncated: false, prefixText: "",
    prefixTextTruncated: false, suffixText: "", suffixTextTruncated: false, author: { type: "user", id: "board" }, commentCount: 1,
    comments: [{ id: "plan-comment", threadId: "thread", body: "PLAN_FEEDBACK", bodyTruncated: false, author: { type: "user", id: "board" },
      createdAt: "2026-11-16T00:00:00.000Z", updatedAt: "2026-11-16T00:00:00.000Z" }], commentsTruncated: false,
    createdAt: "2026-11-16T00:00:00.000Z", updatedAt: "2026-11-16T00:00:00.000Z" };
  // Only a verified retained resume (the condition of
  // qualifyNativeRetainedCompactContinuation) admits the inert plan context.
  const buildRetained = (value: unknown) => buildNativeContinuationPrompt({ wakePayload: value, previousRunId: "prior",
    issue, previousIssue: issue, verifiedRetainedResume: true });
  it("keeps the full framing (null) for any plan context outside a verified retained resume (Step 0)", () => {
    expect(build({ ...wake, planReviewContext: plan })).toBeNull();
    expect(buildNativeContinuationPrompt({ wakePayload: { ...wake, planReviewContext: plan }, previousRunId: "prior",
      issue, previousIssue: issue, verifiedRetainedResume: false })).toBeNull();
    // Without a plan context the compact events are unchanged either way.
    expect(build()).toBe(buildRetained(wake));
  });
  it("keeps the compact events and the plan revision for a plan context with no review input", () => {
    const text = buildRetained({ ...wake, planReviewContext: plan })!;
    expect(JSON.parse(text)).toEqual({ messages: [message],
      planRevision: { documentKey: "plan", latestRevisionId: "plan-revision-1", latestRevisionNumber: 1 } });
    // The plan revision alone is not new input.
    expect(buildRetained({ ...wake, planReviewContext: plan, executionContinuation: { ...wake.executionContinuation,
      resumeDelta: { baseRunId: "prior", messages: [] } } })).toBeNull();
  });
  // Each row changes exactly one condition of the ordinary plan context.
  it.each([
    ["an open annotation thread", { threads: [thread] }],
    ["an omitted open thread", { totals: { ...plan.totals, openThreadCount: 1, omittedThreadCount: 1 } }],
    ["an omitted annotation comment", { totals: { ...plan.totals, commentCount: 1, omittedCommentCount: 1 } }],
    ["another document key", { documentKey: "notes" }],
    ["a plan interaction", { interaction: { id: "interaction", kind: "request_confirmation", status: "rejected", continuationPolicy: "wake_assignee",
      sourceCommentId: null, sourceRunId: null, target: { issueId: "task", documentId: "doc", key: "plan", revisionId: "plan-revision-1", revisionNumber: 1 },
      acceptedTargetRevision: null, result: { outcome: "rejected", reason: "PLAN_FEEDBACK", commentId: null }, resolvedAt: "2026-11-16T00:00:00.000Z" } }],
    ["a truncated plan context", { truncated: true }],
  ])("retains the full framing for %s", (_label, change) => {
    expect(buildRetained({ ...wake, planReviewContext: { ...plan, ...change } })).toBeNull();
  });
  it("still declines a plan context without a resume delta or with another base Run", () => {
    const { resumeDelta: _delta, ...withoutDelta } = wake.executionContinuation;
    expect(buildRetained({ ...wake, planReviewContext: plan, executionContinuation: withoutDelta })).toBeNull();
    expect(buildRetained({ ...wake, planReviewContext: plan, executionContinuation: { ...wake.executionContinuation,
      resumeDelta: { baseRunId: "different", messages: [message] } } })).toBeNull();
  });
});


describe("plain-text Slack continuation projection", () => {
  const slackComment = { ...message, author: { type: "user", id: "board" } };
  const slackWake = {
    ...wake,
    reason: "External chat message received",
    issue: { id: "task", title: "OLD_EXACT_REPLY", description: "Started from Slack", workMode: "standard" },
    externalChatProvider: "slack", checkedOutByHarness: true,
    comments: [slackComment],
    commentIds: [message.id], latestCommentId: message.id,
    commentWindow: { requestedCount: 1, includedCount: 1, missingCount: 0 },
    attachmentOmissions: [],
  };
  const buildChat = (value: unknown = slackWake) => buildNativeContinuationPrompt({
    wakePayload: value, previousRunId: "prior", issue: slackWake.issue,
    previousIssue: slackWake.issue,
    allowExternalChat: true,
  });
  it("sends the new message once without prior titles, history or instructions", () => {
    const text = buildChat()!;
    expect(text).not.toBeNull();
    expect(JSON.parse(text)).toEqual({ messages: [message] });
    expect(text).not.toContain("OLD_EXACT_REPLY");
    expect(text).not.toContain("OLD_HISTORY");
    expect(text.length).toBeLessThan(600);
  });
  it("excludes edited history and prior agent output outside the current Slack delivery", () => {
    const text = buildChat({ ...slackWake, executionContinuation: {
      ...wake.executionContinuation,
      resumeDelta: { baseRunId: "prior", messages: [
        { ...message, id: "old-edited", body: "STALE_DIRECTION" },
        { ...message, id: "old-reply", authorType: "agent", body: "OLD_AGENT_REPLY" },
        message,
      ] },
    } });
    expect(JSON.parse(text!).messages).toEqual([message]);
    expect(text).not.toContain("STALE_DIRECTION");
    expect(text).not.toContain("OLD_AGENT_REPLY");
  });
  it("preserves an actual task brief edit beside the current message", () => {
    const text = buildNativeContinuationPrompt({
      wakePayload: slackWake, previousRunId: "prior", allowExternalChat: true,
      issue: { ...slackWake.issue, description: "Updated scope" }, previousIssue: slackWake.issue,
    });
    expect(JSON.parse(text!).taskChanges).toEqual({ description: "Updated scope" });
  });
  it("accepts the verified non-assignee chat binding", () => {
    expect(buildChat({ ...slackWake, checkedOutByHarness: false, externalChatExecutionBound: true })).not.toBeNull();
  });
  it.each([
    { comments: [{ ...slackComment, attachments: [{ id: "file" }] }] },
    { comments: [{ ...slackComment, attachments: "malformed" }] },
    { comments: [{ ...slackComment, body: "EDITED_SINCE_DELTA" }] },
    { comments: [{ ...slackComment, author: { type: "user", id: "different-user" } }] },
    { attachmentOmissions: [{ commentId: message.id, notice: "Unavailable input" }] },
    { externalChatProvider: "discord" },
    { checkedOutByHarness: false },
    { truncated: true },
    { fallbackFetchNeeded: true },
    { comments: [{ ...slackComment, bodyTruncated: true }] },
    { interactionId: "approval", interactionKind: "request_confirmation" },
    { recovery: { cause: "interrupted" } },
    { executionContinuation: { ...wake.executionContinuation, resumeDelta: { baseRunId: "wrong", messages: [message] } } },
    { executionContinuation: { ...wake.executionContinuation, resumeDelta: { baseRunId: "prior", messages: [] } } },
    { commentIds: [message.id, "missing"], latestCommentId: "missing" },
    { commentIds: [message.id, message.id], latestCommentId: message.id },
    { executionContinuation: { ...wake.executionContinuation, resumeDelta: { baseRunId: "prior", messages: [message, message] } } },
  ])("keeps specialized or incomplete input on the full path: %j", (extra) => {
    expect(buildChat({ ...slackWake, ...extra })).toBeNull();
  });
  it("requires the constructor to explicitly opt into chat continuation", () => {
    expect(build(slackWake)).toBeNull();
  });
});
