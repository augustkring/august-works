import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { NativePayloadSourceInput } from "@paperclipai/shared";
import type { NativeTaskContinuationCapture } from "../execution-continuation.js";
import { parseNativeExecutionInput } from "../../vendor/paperclip-runner/index.js";
import { buildNativeExecutionInput, type NativeOrdinaryPlanReadCapture } from "./native-execution-input.js";
import { nativeCompactContinuationSourceSetAdmits, nativeVerifiedRetainedResumeApplies, qualifyNativeRetainedCompactContinuation,
  type NativeCompactContinuationRetainedRun } from "./native-compact-continuation-source.js";
import { nativeRuntimeContextFixture } from "./runtime-context.test-fixture.js";

// CONF15-W9: the only compact OpenCode continuation a bootstrap source closure
// qualifies is a verified retained resume whose every compact field is
// re-derived from this Task's and the one retained Run's server records.
const companyId = randomUUID(), issueId = randomUUID(), agentId = randomUUID(), userId = randomUUID();
const runId = randomUUID(), retainedRunId = randomUUID(), wakeupRequestId = randomUUID();
const otherRunId = randomUUID(), otherIssueId = randomUUID();
const planRevisionId = randomUUID(), planDocumentId = randomUUID();
const task = { id: issueId, identifier: "W9-1", title: "Continue one retained Native Task",
  description: "Save a plan, then continue after the Human's comment.", workMode: "standard" };
const trust = { kind: "human", authenticated: true };
const projection = (id: string, body: string, updatedAt = "2026-11-16T10:00:00.000Z") => ({ id, authorType: "user",
  authorId: userId, createdByRunId: null, body, createdAt: "2026-11-16T10:00:00.000Z", updatedAt, deleted: false, sourceTrust: trust });
const oldMessage = projection(randomUUID(), "Earlier delivered request.");
const newMessage = projection(randomUUID(), "Continue with this current request.");
const inertPlan = (revisionId = planRevisionId, revisionNumber = 1) => ({ documentKey: "plan", issueId,
  latestRevisionId: revisionId, latestRevisionNumber: revisionNumber, threads: [], interaction: null,
  totals: { openThreadCount: 0, includedThreadCount: 0, omittedThreadCount: 0, commentCount: 0, includedCommentCount: 0, omittedCommentCount: 0 },
  limits: { maxThreads: 20, maxComments: 80, maxBodyChars: 1200, maxTotalBodyChars: 12000, maxAnchorTextChars: 500 }, truncated: false });
const thread = { id: randomUUID(), documentKey: "plan", documentId: planDocumentId, status: "open", revisionId: planRevisionId,
  revisionNumber: 1, anchorState: "active", anchorConfidence: "exact", selectedText: "Inspect", selectedTextTruncated: false,
  prefixText: "", prefixTextTruncated: false, suffixText: "", suffixTextTruncated: false, author: { type: "user", id: userId },
  commentCount: 1, comments: [{ id: randomUUID(), threadId: "thread", body: "PLAN_FEEDBACK", bodyTruncated: false,
    author: { type: "user", id: userId }, createdAt: "2026-11-16T00:00:00.000Z", updatedAt: "2026-11-16T00:00:00.000Z" }],
  commentsTruncated: false, createdAt: "2026-11-16T00:00:00.000Z", updatedAt: "2026-11-16T00:00:00.000Z" };
const planInteraction = { id: randomUUID(), kind: "request_confirmation", status: "rejected", continuationPolicy: "wake_assignee",
  sourceCommentId: null, sourceRunId: null, target: { issueId, documentId: planDocumentId, key: "plan", revisionId: planRevisionId,
    revisionNumber: 1 }, acceptedTargetRevision: null, result: { outcome: "rejected", reason: "PLAN_FEEDBACK", commentId: null },
  resolvedAt: "2026-11-16T00:00:00.000Z" };
const retainedSource: Extract<NativePayloadSourceInput, { kind: "retained_run" }> = { kind: "retained_run", runId: retainedRunId,
  inputDigest: "a".repeat(64), dispatchDigest: "b".repeat(64) };
const wakeSource: Extract<NativePayloadSourceInput, { kind: "native_task_wake" }> = { kind: "native_task_wake", runId, issueId,
  sourceVersion: "2026-11-16T10:00:00.000Z", contentHash: "c".repeat(64) };
const planRead: NativeOrdinaryPlanReadCapture = { companyId, issueId, runId, agentId, responsibleUserId: userId, wakeupRequestId,
  source: { kind: "document_revision", issueId, documentId: planDocumentId, revisionId: planRevisionId,
    contentHash: "d".repeat(64) }, revisionNumber: 1 };
const contract = { id: randomUUID(), sha256: `sha256:${"e".repeat(64)}`, schemaVersion: "paperclip.run-result.v1",
  contract: { revision: "1", objective: "Complete the current request", criteria: [{ id: "output", requirement: "Complete it" }] } };

// Heartbeat rebuilds a verified retained resume's input with the W9 forms
// (`verifiedRetainedResume`); every other execution is built without them.
function executionFor(input: { id: string; issue?: typeof task; wakePayload?: unknown; previousTurn?: { runId: string;
  task: { title: string; description: string | null } } | null; provider?: "opencode" | "codex"; verifiedRetainedResume?: boolean }) {
  const issue = input.issue ?? task;
  return parseNativeExecutionInput(buildNativeExecutionInput({ companyId, runId: input.id, agentId, issue,
    taskPrompt: "Full current task prompt", wakePayload: input.wakePayload, resumedSession: input.previousTurn !== undefined,
    previousTurn: input.previousTurn ?? null, verifiedRetainedResume: input.verifiedRetainedResume ?? true, conversationMode: false,
    workspace: { id: input.id, cwd: "/tmp/w9-task", repoUrl: null, repoRef: null, branchName: null },
    normalizedSessionId: "opencode-retained-session", provider: input.provider ?? "opencode", opencodePermissionMode: "allow",
    model: "openrouter/test/model", completionContract: contract, runtimeContext: nativeRuntimeContextFixture() }));
}

type Scenario = {
  delivered?: unknown[];
  current?: ReturnType<typeof projection>[];
  delta?: ReturnType<typeof projection>[];
  deltaBase?: string;
  plan?: Record<string, unknown> | null;
  retainedIssue?: typeof task;
  wakeExtra?: Record<string, unknown>;
  provider?: "opencode" | "codex";
};

type QualifyInput = Parameters<typeof qualifyNativeRetainedCompactContinuation>[0];
type ScenarioInput = QualifyInput & { retainedRun: NativeCompactContinuationRetainedRun;
  capture: NativeTaskContinuationCapture; wakePayload: Record<string, any> };

/** One retained resume: Run 1 (retained) delivered `delivered`; Run 2's comment
 * wake carries the current messages, the resume delta and the plan context. */
function scenario(s: Scenario = {}): ScenarioInput {
  const delivered = s.delivered ?? [];
  const current = s.current ?? [newMessage];
  const deliveredIds = new Set(delivered.map(message => (message as { id: string }).id));
  const delta = s.delta ?? current.filter(message => message.id === newMessage.id || !deliveredIds.has(message.id));
  const envelope: Record<string, any> = { version: 1 as const, companyId, issueId,
    trigger: { reason: "issue_commented", interactionId: null, sourceRunId: null }, originCommentIds: [newMessage.id],
    objective: newMessage.body, messages: current, interactionOutcomes: [], resumeDelta: { baseRunId: s.deltaBase ?? retainedRunId,
      messages: delta }, completedWork: null, unresolvedInteractionIds: [],
    coverage: { kind: "full_task_history" as const, throughCommentId: newMessage.id, summaryThroughCommentId: null } };
  const wakePayload = { reason: "issue_commented", issue: task, commentIds: [newMessage.id], latestCommentId: newMessage.id,
    comments: [{ ...newMessage, author: { type: "user", id: userId } }],
    commentWindow: { requestedCount: 1, includedCount: 1, missingCount: 0 }, executionContinuation: envelope,
    planReviewContext: s.plan === undefined ? inertPlan() : s.plan, externalChatProvider: null, ...s.wakeExtra };
  const retainedIssue = s.retainedIssue ?? task;
  const retainedExecution = executionFor({ id: retainedRunId, issue: retainedIssue, wakePayload: { reason: "issue_assigned", issue: retainedIssue } });
  const execution = executionFor({ id: runId, wakePayload, provider: s.provider,
    previousTurn: { runId: s.deltaBase ?? retainedRunId,
      task: { title: retainedExecution.task.title, description: retainedExecution.task.description } } });
  const retainedRun = { id: retainedRunId, companyId, agentId, nativeIssueId: issueId,
    contextSnapshot: { issueId, executionContinuation: { ...envelope, messages: delivered, resumeDelta: undefined } },
    runnerProfileJson: { nativeExecutionInput: retainedExecution } };
  const capture = { companyId, issueId, agentId, runId, responsibleUserId: userId, wakeupRequestId, envelope,
    commentSources: [], previousContext: { runId: retainedRunId, messages: delivered }, retainedSource,
    wake: { requestedByActorType: "user", requestedByActorId: userId, reason: "issue_commented", originCommentIds: [newMessage.id] },
  } as unknown as NativeTaskContinuationCapture;
  return { execution, retainedSource, retainedRun, capture, wakeSource, wakePayload, ordinaryPlanRead: planRead };
}
const qualify = (input: QualifyInput) => qualifyNativeRetainedCompactContinuation(input);

describe("CONF15-W9 compact OpenCode continuation in the bootstrap source closure", () => {
  it("qualifies a retained resume over an empty delivered history with an inert plan revision", () => {
    const input = scenario();
    const prompt = "continuationPrompt" in input.execution ? input.execution.continuationPrompt : null;
    expect(prompt).toBeTruthy();
    expect(qualify(input)).toBe(prompt);
    expect(JSON.parse(prompt!)).toEqual({ messages: [newMessage],
      planRevision: { documentKey: "plan", latestRevisionId: planRevisionId, latestRevisionNumber: 1 } });
  });

  it("qualifies only the undelivered messages over a non-empty delivered history, and a Task change", () => {
    const input = scenario({ delivered: [oldMessage], current: [oldMessage, newMessage], plan: null });
    expect(qualify(input)).toBe((input.execution as { continuationPrompt: string }).continuationPrompt);
    expect(JSON.parse((input.execution as { continuationPrompt: string }).continuationPrompt)).toEqual({ messages: [newMessage] });
    const changed = scenario({ retainedIssue: { ...task, description: "The earlier brief." }, plan: null });
    expect(qualify(changed)).toBeTruthy();
    expect(JSON.parse(qualify(changed)!)).toEqual({ messages: [newMessage], taskChanges: { description: task.description } });
  });

  it("refuses another Task's or another Run's delta", () => {
    // The retained Run of another Task.
    for (const retainedRun of [{ nativeIssueId: otherIssueId }, { contextSnapshot: { issueId: otherIssueId,
      executionContinuation: { messages: [] } } }, { companyId: randomUUID() }, { agentId: randomUUID() }]) {
      const input = scenario();
      expect(qualify({ ...input, retainedRun: { ...input.retainedRun, ...retainedRun } })).toBeNull();
    }
    // A delta (and so a prompt) based on another Run.
    const otherBase = scenario({ deltaBase: otherRunId });
    expect("continuationPrompt" in otherBase.execution && otherBase.execution.continuationPrompt).toBeTruthy();
    expect(qualify(otherBase)).toBeNull();
    // A previous context of another Run.
    const input = scenario();
    expect(qualify({ ...input, capture: { ...input.capture, previousContext: { runId: otherRunId, messages: [] } } })).toBeNull();
    // A retained Run whose persisted input belongs to another Run.
    const foreign = scenario();
    const otherExecution = executionFor({ id: otherRunId, wakePayload: { reason: "issue_assigned", issue: task } });
    expect(qualify({ ...foreign, retainedRun: { ...foreign.retainedRun, runnerProfileJson: { nativeExecutionInput: otherExecution } } })).toBeNull();
    expect(qualify({ ...foreign, retainedRun: { ...foreign.retainedRun, runnerProfileJson: {} } })).toBeNull();
  });

  it("refuses an edited delta", () => {
    // The delta's message body differs from the current message.
    expect(qualify(scenario({ delta: [{ ...newMessage, body: "Forged instruction." }] }))).toBeNull();
    // The delta omits an undelivered message or repeats a delivered one.
    const extra = projection(randomUUID(), "Another undelivered request.");
    expect(qualify(scenario({ current: [extra, newMessage], delta: [newMessage] }))).toBeNull();
    expect(qualify(scenario({ delivered: [oldMessage], current: [oldMessage, newMessage], delta: [oldMessage, newMessage] }))).toBeNull();
    // The capture's previous context is not the retained Run's own envelope.
    const input = scenario({ delivered: [oldMessage], current: [oldMessage, newMessage] });
    expect(qualify({ ...input, capture: { ...input.capture, previousContext: { runId: retainedRunId, messages: [] } } })).toBeNull();
    expect(qualify({ ...input, retainedRun: { ...input.retainedRun, contextSnapshot: { issueId,
      executionContinuation: { messages: [{ ...oldMessage, body: "edited" }] } } } })).toBeNull();
    expect(qualify({ ...input, retainedRun: { ...input.retainedRun, contextSnapshot: { issueId } } })).toBeNull();
    // A prompt whose events differ from the closure records.
    const prompt = scenario();
    const forged = { ...prompt.execution, continuationPrompt: JSON.stringify({ messages: [{ ...newMessage, body: "Forged." }] }) };
    expect(qualify({ ...prompt, execution: forged as typeof prompt.execution })).toBeNull();
    // The wake's continuation is not the closure-verified capture.
    expect(qualify({ ...prompt, wakePayload: { ...prompt.wakePayload, executionContinuation: {
      ...prompt.wakePayload.executionContinuation, objective: "edited" } } })).toBeNull();
  });

  it("refuses a non-inert or unbound plan context", () => {
    const input = scenario();
    for (const change of [{ threads: [thread] }, { interaction: planInteraction },
      { totals: { ...inertPlan().totals, openThreadCount: 1, omittedThreadCount: 1 } }, { truncated: true }, { issueId: otherIssueId }])
      expect(qualify({ ...input, wakePayload: { ...input.wakePayload, planReviewContext: { ...inertPlan(), ...change } } })).toBeNull();
    // No ordinary plan read, or one of another revision, Run or Task.
    expect(qualify({ ...input, ordinaryPlanRead: null })).toBeNull();
    expect(qualify({ ...input, ordinaryPlanRead: { ...planRead, revisionNumber: 2 } })).toBeNull();
    expect(qualify({ ...input, ordinaryPlanRead: { ...planRead, runId: otherRunId } })).toBeNull();
    expect(qualify({ ...input, ordinaryPlanRead: { ...planRead, source: { ...planRead.source, revisionId: randomUUID() } } })).toBeNull();
    // An accepted plan review keeps its full framing.
    expect(qualify({ ...input, capture: { ...input.capture, acceptedPlanReview: {} as never } })).toBeNull();
  });

  it("refuses a closure with two retained Runs", () => {
    const second = { ...retainedSource, runId: otherRunId };
    const base: NativePayloadSourceInput[] = [wakeSource];
    expect(nativeCompactContinuationSourceSetAdmits({ retainedSource, inputs: [...base, retainedSource] })).toBe(true);
    expect(nativeCompactContinuationSourceSetAdmits({ retainedSource, inputs: [...base, retainedSource, second] })).toBe(false);
    expect(nativeCompactContinuationSourceSetAdmits({ retainedSource, inputs: [...base, second] })).toBe(false);
    expect(nativeCompactContinuationSourceSetAdmits({ retainedSource, inputs: base })).toBe(false);
    expect(nativeCompactContinuationSourceSetAdmits({ retainedSource,
      inputs: [...base, { ...retainedSource, dispatchDigest: "f".repeat(64) }] })).toBe(false);
    // The capture bound to a second retained source.
    const input = scenario();
    expect(qualify({ ...input, capture: { ...input.capture, retainedSource: second } })).toBeNull();
    expect(qualify({ ...input, retainedSource: second })).toBeNull();
  });

  it("refuses a non-retained execution carrying a continuationPrompt", () => {
    const input = scenario();
    expect("continuationPrompt" in input.execution && input.execution.continuationPrompt).toBeTruthy();
    expect(qualify({ ...input, retainedSource: null })).toBeNull();
    expect(qualify({ ...input, retainedRun: null })).toBeNull();
    // The current Run named as its own retained Run, every other record agreeing.
    expect(qualify({ ...input, retainedSource: { ...retainedSource, runId }, retainedRun: { ...input.retainedRun, id: runId } })).toBeNull();
    const self = scenario({ deltaBase: runId });
    const selfSource = { ...retainedSource, runId };
    expect(qualify({ ...self, retainedSource: selfSource,
      retainedRun: { ...self.retainedRun, id: runId, runnerProfileJson: { nativeExecutionInput: self.execution } },
      capture: { ...self.capture, retainedSource: selfSource, previousContext: { runId, messages: [] } } })).toBeNull();
    // A retained-run source naming another Run than the retained row.
    const second = { ...retainedSource, runId: otherRunId };
    expect(qualify({ ...input, retainedSource: second, capture: { ...input.capture, retainedSource: second } })).toBeNull();
    // A capture without the retained Run's previous context.
    const { previousContext: _previous, ...withoutPrevious } = input.capture;
    expect(qualify({ ...input, capture: withoutPrevious as NativeTaskContinuationCapture })).toBeNull();
  });

  // Step 0: outside a verified retained resume the input keeps its pre-W9
  // prompt, so the inert plan context keeps the full framing (no compact prompt).
  it("builds no compact prompt for an inert plan context outside a verified retained resume", () => {
    const input = scenario();
    const preW9 = executionFor({ id: runId, wakePayload: input.wakePayload, verifiedRetainedResume: false,
      previousTurn: { runId: retainedRunId, task: { title: task.title, description: task.description } } });
    expect("continuationPrompt" in preW9 ? preW9.continuationPrompt : undefined).toBeNull();
    expect(qualify({ ...input, execution: preW9 })).toBeNull();
    // Without a plan context the delta's compact prompt is the same either way.
    const noPlan = scenario({ plan: null });
    const noPlanPreW9 = executionFor({ id: runId, wakePayload: noPlan.wakePayload, verifiedRetainedResume: false,
      previousTurn: { runId: retainedRunId, task: { title: task.title, description: task.description } } });
    expect((noPlanPreW9 as { continuationPrompt: string }).continuationPrompt)
      .toBe((noPlan.execution as { continuationPrompt: string }).continuationPrompt);
  });

  it("applies the W9 forms only to a verified retained resume of an OpenCode v4 input (Step 0)", () => {
    const { execution } = scenario();
    const applies = (overrides: Partial<Parameters<typeof nativeVerifiedRetainedResumeApplies>[0]> = {}) =>
      nativeVerifiedRetainedResumeApplies({ execution, witnessSource: retainedSource, previousRunId: retainedRunId, ...overrides });
    expect(applies()).toBe(true);
    // No verified witness, or one for another Run than the previous Run.
    expect(applies({ witnessSource: null })).toBe(false);
    expect(applies({ previousRunId: null })).toBe(false);
    expect(applies({ previousRunId: otherRunId })).toBe(false);
    expect(applies({ witnessSource: { ...retainedSource, runId: otherRunId } })).toBe(false);
    // The current Run named as its own retained Run.
    expect(applies({ witnessSource: { ...retainedSource, runId }, previousRunId: runId })).toBe(false);
    // Another provider.
    expect(applies({ execution: scenario({ provider: "codex" }).execution })).toBe(false);
  });

  it("keeps every other continuation unsupported", () => {
    const input = scenario();
    // No qualified wake or closure-verified continuation.
    expect(qualify({ ...input, wakeSource: null })).toBeNull();
    expect(qualify({ ...input, wakeSource: { ...wakeSource, runId: otherRunId } })).toBeNull();
    expect(qualify({ ...input, capture: null })).toBeNull();
    expect(qualify({ ...input, capture: { ...input.capture, runId: otherRunId } })).toBeNull();
    // Another provider, or an execution without a compact prompt.
    expect(qualify(scenario({ provider: "codex" }))).toBeNull();
    const { continuationPrompt: _prompt, ...withoutPrompt } = input.execution as typeof input.execution & { continuationPrompt?: string };
    expect(qualify({ ...input, execution: withoutPrompt as typeof input.execution })).toBeNull();
    // External chat, an interaction answer or child results keep their framing.
    expect(qualify({ ...input, wakePayload: { ...input.wakePayload, externalChatProvider: "slack" } })).toBeNull();
    const answer = { id: randomUUID(), kind: "ask_user_questions", status: "answered", resolvedByUserId: userId,
      resolvedAt: "2026-11-16T10:00:00.000Z", result: { answer: "yes" } };
    const answered = scenario({ wakeExtra: { interactionId: answer.id } });
    const answeredEnvelope = { ...answered.capture.envelope, humanResponses: [answer] };
    const answeredWake = { ...answered.wakePayload, executionContinuation: answeredEnvelope };
    const answeredExecution = executionFor({ id: runId, wakePayload: answeredWake,
      previousTurn: { runId: retainedRunId, task: { title: task.title, description: task.description } } });
    expect(JSON.parse((answeredExecution as { continuationPrompt: string }).continuationPrompt).humanResponses).toHaveLength(1);
    expect(qualify({ ...answered, execution: answeredExecution, wakePayload: answeredWake,
      capture: { ...answered.capture, envelope: answeredEnvelope } })).toBeNull();
    const children = scenario({ wakeExtra: { childIssueSummaries: [{ id: randomUUID(), status: "done", summary: "CHILD" }] } });
    expect(JSON.parse((children.execution as { continuationPrompt: string }).continuationPrompt).childResults).toHaveLength(1);
    expect(qualify(children)).toBeNull();
  });
});
