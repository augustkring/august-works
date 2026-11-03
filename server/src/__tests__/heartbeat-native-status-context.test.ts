import { describe, expect, it } from "vitest";
import { mergeCoalescedContextSnapshot } from "../services/heartbeat.ts";

describe("native status wake context provenance", () => {
  const statusControl = {
    issueId: "issue-1",
    source: "native_status_decision",
    statusDecisionSource: "native_status_decision",
    wakeReason: "issue_status_changed",
  };

  it("preserves a verified chat source when status control flow coalesces into the run", () => {
    const merged = mergeCoalescedContextSnapshot(
      {
        issueId: "issue-1",
        source: "chat:discord",
        wakeCommentId: "comment-1",
        wakeCommentIds: ["comment-1"],
      },
      {
        issueId: "issue-1",
        source: "native_status_decision",
        statusDecisionSource: "native_status_decision",
        wakeReason: "issue_status_changed",
      },
    );

    expect(merged).toMatchObject({
      source: "chat:discord",
      statusDecisionSource: "native_status_decision",
      wakeReason: "issue_status_changed",
      wakeCommentId: "comment-1",
      wakeCommentIds: ["comment-1"],
    });
  });

  it("retains only the exact admitted Task wake and continuation on same-Task status coalescence", () => {
    const continuation = { version: 1, issueId: "issue-1", originCommentIds: ["comment-1"] };
    const originalWake = {
      reason: "issue_commented",
      issue: { id: "issue-1" },
      commentIds: [],
      executionContinuation: continuation,
    };
    const original = {
      issueId: "issue-1",
      source: "heartbeat",
      wakeReason: "issue_commented",
      wakeCommentId: "comment-1",
      wakeCommentIds: ["comment-1"],
      executionContinuation: continuation,
      paperclipWake: originalWake,
    };
    const incoming = { ...statusControl,
      paperclipWake: { reason: "forged_status_wake", issue: { id: "issue-1" } },
      executionContinuation: { version: 1, issueId: "forged-issue" } };
    const merged = mergeCoalescedContextSnapshot(original, incoming);
    expect(merged.paperclipWake).toBe(originalWake);
    expect(merged.executionContinuation).toBe(continuation);
    expect(merged.wakeReason).toBe("issue_status_changed");
    expect(merged.statusDecisionSource).toBe("native_status_decision");
  });

  it("preserves an unchanged zero-comment continuation only through its exact empty-origin closure", () => {
    const continuation = { version: 1, issueId: "issue-1", originCommentIds: [] };
    const original = {
      issueId: "issue-1", source: "heartbeat", wakeReason: "task_execution",
      wakeCommentIds: [], executionContinuation: continuation,
      paperclipWake: { reason: "task_execution", issue: { id: "issue-1" }, commentIds: [], executionContinuation: continuation },
    };
    const merged = mergeCoalescedContextSnapshot(original, statusControl);
    expect(merged.paperclipWake).toBe(original.paperclipWake);
    expect(merged.executionContinuation).toBe(continuation);
  });

  it.each([
    { ...statusControl, existingCommentIds: [] },
    { ...statusControl, payloadCommentIds: ["comment-1", "stale-comment"] },
    { ...statusControl, payloadCommentIds: ["different-comment"] },
    { ...statusControl, payloadContinuation: { version: 1, issueId: "forged-task", originCommentIds: ["comment-1"] } },
  ])("rejects stale Task wake comments or a substituted continuation: %j", rawMutation => {
    const mutation = rawMutation as { existingCommentIds?: string[]; payloadCommentIds?: string[]; payloadContinuation?: unknown };
    const continuation = { version: 1, issueId: "issue-1", originCommentIds: ["comment-1"] };
    const original: Record<string, unknown> = {
      issueId: "issue-1", source: "heartbeat", wakeReason: "issue_commented",
      wakeCommentId: "comment-1", wakeCommentIds: ["comment-1"],
      executionContinuation: continuation,
      paperclipWake: { reason: "issue_commented", issue: { id: "issue-1" },
        commentIds: mutation.payloadCommentIds ?? [], executionContinuation: mutation.payloadContinuation ?? continuation },
    };
    if (mutation.existingCommentIds) {
      original.wakeCommentIds = mutation.existingCommentIds;
      original.wakeCommentId = mutation.existingCommentIds.at(-1) ?? null;
    }
    const merged = mergeCoalescedContextSnapshot(original, statusControl);
    expect(merged.paperclipWake).toBeUndefined();
    expect(merged.executionContinuation).toBeUndefined();
  });

  it.each([
    { ...statusControl, issueId: "unrelated-issue" },
    { ...statusControl, wakeCommentIds: ["new-human-comment"] },
    { ...statusControl, statusDecisionSource: "ordinary-control" },
  ])("does not carry a Task wake across changed or unmarked status scope: %j", incoming => {
    const continuation = { version: 1, issueId: "issue-1", originCommentIds: ["comment-1"] };
    const original = {
      issueId: "issue-1", source: "heartbeat", wakeReason: "issue_commented",
      wakeCommentId: "comment-1", wakeCommentIds: ["comment-1"],
      executionContinuation: continuation,
      paperclipWake: { reason: "issue_commented", issue: { id: "issue-1" },
        commentIds: ["comment-1"], executionContinuation: continuation },
    };
    const merged = mergeCoalescedContextSnapshot(original, incoming);
    expect(merged.paperclipWake).toBeUndefined();
    expect(merged.executionContinuation).toBeUndefined();
  });

  it("does not preserve chat provenance for an unmarked ordinary incoming wake", () => {
    const merged = mergeCoalescedContextSnapshot(
      { source: "chat:discord" },
      { source: "native_status_decision" },
    );

    expect(merged.source).toBe("native_status_decision");
    expect(merged.statusDecisionSource).toBeUndefined();
  });

  const reviewedContext = {
    issueId: "issue-1",
    source: "chat:telegram",
    wakeReason: "External chat message received",
    wakeCommentIds: ["comment-1"],
    paperclipExternalChatExecutionBound: true,
    paperclipWake: {
      issue: { id: "issue-1", status: "in_review" },
      commentIds: ["comment-1"],
      externalChatProvider: "telegram",
      externalChatExecutionBound: true,
      checkedOutByHarness: false,
    },
  };
  it("retains the exact admitted review-chat wake when same-issue status metadata coalesces", () => {
    const merged = mergeCoalescedContextSnapshot(
      reviewedContext,
      statusControl,
    );
    expect(merged).toMatchObject(reviewedContext);
    expect(merged.statusDecisionSource).toBe("native_status_decision");
    expect(merged.paperclipWake).toBe(reviewedContext.paperclipWake);
    expect(merged.paperclipHarnessCheckedOut).toBeUndefined();
  });

  it("also retains the exact legacy checked-out chat wake for pure status control", () => {
    const checkedOut = {
      ...reviewedContext,
      paperclipExternalChatExecutionBound: false,
      paperclipHarnessCheckedOut: true,
      paperclipWake: {
        ...reviewedContext.paperclipWake,
        checkedOutByHarness: true,
        externalChatExecutionBound: false,
      },
    };
    const merged = mergeCoalescedContextSnapshot(checkedOut, statusControl);
    expect(merged.paperclipWake).toBe(checkedOut.paperclipWake);
    expect(merged.paperclipExternalChatExecutionBound).toBeUndefined();
  });

  it.each([
    { ...statusControl, issueId: "unrelated-issue" },
    { ...statusControl, wakeCommentIds: ["new-comment"] },
    { ...statusControl, statusDecisionSource: "ordinary-control" },
    { issueId: "issue-1", source: "chat:discord" },
  ])(
    "invalidates prior review binding when coalescence changes admitted scope: %j",
    (incoming) => {
      const merged = mergeCoalescedContextSnapshot(reviewedContext, incoming);
      expect(merged.paperclipExternalChatExecutionBound).toBeUndefined();
      expect(merged.paperclipWake).toBeUndefined();
    },
  );

  it("does not preserve mismatched provider or payload-comment provenance", () => {
    for (const paperclipWake of [
      { ...reviewedContext.paperclipWake, externalChatProvider: "github" },
      { ...reviewedContext.paperclipWake, commentIds: ["different-comment"] },
      { ...reviewedContext.paperclipWake, externalChatExecutionBound: false },
    ]) {
      const merged = mergeCoalescedContextSnapshot(
        { ...reviewedContext, paperclipWake },
        statusControl,
      );
      expect(merged.paperclipExternalChatExecutionBound).toBeUndefined();
      expect(merged.paperclipWake).toBeUndefined();
    }
  });

  it("never adopts an attestation supplied only by an incoming wake", () => {
    const merged = mergeCoalescedContextSnapshot({}, reviewedContext);
    expect(merged.paperclipExternalChatExecutionBound).toBeUndefined();
    expect(merged.paperclipWake).toBeUndefined();
  });
});
