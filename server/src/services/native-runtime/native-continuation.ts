import { isPaperclipExternalChatContractTurn, normalizePaperclipWakePayload } from "@paperclipai/adapter-utils/server-utils";

/** Only new, authorized events belong in an already retained provider conversation.
 * Full bootstrap input is kept separately for an actual provider resume failure.
 */
export function buildNativeContinuationPrompt(input: {
  wakePayload: unknown;
  previousRunId: string;
  issue: { title: string; description: string | null };
  previousIssue: { title: string; description: string | null };
  /** The constructor opts plain-text chat into the existing resume protocol. */
  allowExternalChat?: boolean;
  /** Only a verified retained resume (the same condition as
   * `qualifyNativeRetainedCompactContinuation`) admits an inert ordinary plan
   * context into the compact events. Every other execution keeps the full
   * framing for any plan context (null). */
  verifiedRetainedResume?: boolean;
}): string | null {
  const wake = normalizePaperclipWakePayload(input.wakePayload);
  const continuation = wake?.executionContinuation;
  const delta = continuation?.resumeDelta;
  if (!wake || !delta || delta.baseRunId !== input.previousRunId) return null;
  const rawWake = input.wakePayload && typeof input.wakePayload === "object"
    ? input.wakePayload as Record<string, unknown> : {};
  // Attachment descriptors are intentionally omitted by the generic normalizer.
  // Retain the complete bootstrap framing whenever current input needs them or
  // an omission notice. The compact path never guesses an unavailable file.
  const hasAttachmentContext =
    (rawWake.attachmentOmissions != null &&
      (!Array.isArray(rawWake.attachmentOmissions) || rawWake.attachmentOmissions.length > 0)) ||
    (Array.isArray(rawWake.comments) && rawWake.comments.some((comment) =>
      comment && typeof comment === "object" &&
      (comment as Record<string, unknown>).attachments != null &&
      (!Array.isArray((comment as Record<string, unknown>).attachments) ||
        ((comment as Record<string, unknown>).attachments as unknown[]).length > 0)));
  const externalChat = input.allowExternalChat === true &&
    wake.externalChatProvider === "slack" &&
    isPaperclipExternalChatContractTurn(input.wakePayload) &&
    !hasAttachmentContext && wake.commentIds.length > 0 &&
    wake.latestCommentId === wake.commentIds.at(-1) &&
    new Set(wake.commentIds).size === wake.commentIds.length &&
    wake.commentIds.every((id) => {
      const comments = wake.comments.filter((entry) => entry.id === id);
      const messages = delta.messages.filter((entry) => entry.id === id);
      return comments.length === 1 && messages.length === 1 &&
        messages[0]!.body === comments[0]!.body &&
        messages[0]!.authorType === comments[0]!.authorType &&
        messages[0]!.authorId === comments[0]!.authorId;
    });
  // CONF15-W9: heartbeat attaches the Task's plan context to every comment
  // wake once a `plan` document exists (`plan-review-context.ts`). With no open
  // annotation thread (included or omitted), annotation comment, plan
  // interaction or truncation it holds no review input, only the plan
  // revision, which the compact events below keep. Any review input keeps the
  // full plan framing. (The builder derives the included and omitted counts
  // from these totals.) Only for a verified retained resume (Step 0).
  const plan = input.verifiedRetainedResume === true ? wake.planReviewContext : null;
  const ordinaryPlan = plan && plan.documentKey === "plan" && plan.interaction === null && plan.threads.length === 0 &&
    plan.totals.openThreadCount === 0 && plan.totals.commentCount === 0 && !plan.truncated ? plan : null;
  // Other provider, attachment, question, approval, and recovery paths keep
  // their specialized framing. A matching prior run still gates every delta.
  if ((wake.externalChatProvider && !externalChat) ||
    (!['issue_commented', 'issue_children_completed'].includes(wake.reason ?? '') &&
      !(externalChat && wake.reason === "External chat message received")) ||
    wake.fallbackFetchNeeded || wake.truncated || wake.recovery || continuation?.interruptedRunId ||
    (wake.externalChatExecutionBound && !externalChat) || wake.externalChatQuestionResponse ||
    wake.taskWatchdog || wake.livenessContinuation || wake.activeTreeHold ||
    wake.skillTest || wake.executionStage || wake.agentMessage ||
    wake.documentReviewContext || (wake.planReviewContext && !ordinaryPlan) || wake.annotationDeltas.length > 0
  ) return null;
  const taskChanges = Object.fromEntries(
    (["title", "description"] as const)
      .filter((key) => input.issue[key] !== input.previousIssue[key])
      .map((key) => [key, input.issue[key]]),
  );
  const humanResponses = (continuation?.humanResponses ?? []).filter((answer) => answer.id === wake.interactionId);
  // Do not substitute an unverified interaction outcome for an authorized answer.
  if (wake.interactionId && humanResponses.length === 0) return null;
  const events = {
    // Only the current authenticated Slack delivery belongs to this turn.
    // The generic delta can also include edited historical comments or an old
    // agent response; neither becomes a new Slack instruction.
    messages: externalChat
      ? wake.commentIds.map((id) => delta.messages.find((message) => message.id === id)!)
      : delta.messages,
    ...(humanResponses.length ? { humanResponses } : {}),
    ...(Object.keys(taskChanges).length ? { taskChanges } : {}),
    ...(wake.childIssueSummaries.length ? { childResults: wake.childIssueSummaries } : {}),
    ...(wake.childIssueSummaryTruncated ? { childResultsTruncated: true } : {}),
    ...(wake.unresolvedBlockerIssueIds.length ? { unresolvedBlockerIssueIds: wake.unresolvedBlockerIssueIds } : {}),
    ...(ordinaryPlan ? { planRevision: { documentKey: "plan", latestRevisionId: ordinaryPlan.latestRevisionId,
      latestRevisionNumber: ordinaryPlan.latestRevisionNumber } } : {}),
  };
  if (!events.messages.length && !humanResponses.length && !wake.childIssueSummaries.length && !Object.keys(taskChanges).length) return null;
  return JSON.stringify(events);
}
