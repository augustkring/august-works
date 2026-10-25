import { createHash } from "node:crypto";
import { buildNativeContinuationPrompt } from "./native-continuation.js";
import type {
  NativeAcpxAgent,
  NativeAcpxPermissionMode,
  NativeCodexApprovalPolicy,
  NativeExecutionInputV4,
  NativeInteractionResponseEnvelope,
  NativeOpenCodePermissionMode,
  NativePlanningContext,
  NativeRuntimeContextSnapshot,
  StrictCompletionContractInput,
} from "../../vendor/paperclip-runner/index.js";
import {
  nativePayloadSourceInputSchema,
  nativePayloadSourceSnapshotSchema,
  type NativePayloadSourceInput,
  type NativePayloadSourcePolicy,
} from "@paperclipai/shared";
import {
  parseNativeExecutionInput,
  resolveQualifiedAcpxProfile,
} from "../../vendor/paperclip-runner/index.js";
import { readNativeBootstrapContextWitness, type NativeBootstrapContextWitness } from "../context/native-bootstrap-context-witness.js";
import {
  isPaperclipExternalChatContractTurn,
  isPaperclipExternalChatQuestionResponseTurn,
  renderPaperclipWakePrompt,
} from "@paperclipai/adapter-utils/server-utils";

const NATIVE_GITHUB_ATTACHMENT_RECOVERY_GUIDANCE = [
  "## GitHub attachment recovery navigation",
  "Paperclip owns recovery navigation for unavailable GitHub attachments. It may append an authenticated task link after an accepted response, only when the current source remains authorized and a safe configured Board URL is available. The model does not select or authorize that link.",
  "A task URL missing from your prompt or tool results is not evidence that no task link can be provided; do not claim that a link is unavailable merely because you cannot see its URL. Do not invent a URL or promise that a link will appear. Briefly explain the unavailable input and ask the user to attach it directly to this Paperclip task or paste the needed text. Never infer the file's contents or substitute an older file.",
].join("\n");

export type NativeRenderedSourceReference = {
  kind: "task" | "comment" | "document_revision" | "attachment" | "unknown";
  id: string;
  commentId?: string;
  filename?: string;
  contentType?: string;
  byteSize?: number;
};

export type NativePreparedSourceCandidate = {
  kind: "task" | "comment" | "document_revision" | "attachment";
  id: string;
  input: NativePayloadSourceInput;
  payloadSourceSnapshot: unknown;
};

export type NativePayloadSourceSet = {
  policy: NativePayloadSourcePolicy;
  inputs: NativePayloadSourceInput[];
};

export type NativeConsumedSourceComponent =
  | { kind: "bootstrap" }
  | { kind: "dispatch"; executionInputDigest: string; policy: NativePayloadSourcePolicy; inputs: NativePayloadSourceInput[] }
  | { kind: "additional_input"; responsibleUserId: string; policy: NativePayloadSourcePolicy; inputs: NativePayloadSourceInput[] };

export type NativeBootstrapSourceClosure = {
  sourceSet: NativePayloadSourceSet;
  taskEnvelopeDigest: string;
  /** Digest and Context root attached to a later server-prepared turn. */
  turnContext?: { markdownDigest: string; manifestIds: string[] };
};

function exactInteractionSources(input: {
  issueId: string;
  responses: readonly NativeInteractionResponseEnvelope[] | null | undefined;
  sources: readonly Extract<NativePayloadSourceInput, { kind: "interaction" }>[] | null | undefined;
}): Extract<NativePayloadSourceInput, { kind: "interaction" }>[] | null {
  const responses = input.responses ?? [];
  const sources = input.sources ?? [];
  if (responses.length !== sources.length) return null;
  const responseIds = new Set<string>();
  for (const response of responses) {
    if (!response || typeof response.interactionId !== "string" || responseIds.has(response.interactionId)) return null;
    responseIds.add(response.interactionId);
  }
  const sourcesById = new Map<string, Extract<NativePayloadSourceInput, { kind: "interaction" }>>();
  for (const raw of sources) {
    const parsed = nativePayloadSourceInputSchema.safeParse(raw);
    if (!parsed.success || parsed.data.kind !== "interaction" || parsed.data.issueId !== input.issueId ||
      sourcesById.has(parsed.data.interactionId)) return null;
    sourcesById.set(parsed.data.interactionId, parsed.data);
  }
  const ordered: Extract<NativePayloadSourceInput, { kind: "interaction" }>[] = [];
  for (const response of responses) {
    const source = sourcesById.get(response.interactionId);
    if (!source || createHash("sha256").update(JSON.stringify(response), "utf8").digest("hex") !== source.contentHash) return null;
    ordered.push(source);
  }
  return ordered;
}

/** Server-only Native output capture. The model-call identity and hashes are
 * observations; source authority still comes from sourceSet and its owners. */
export type NativeModelOutputCapture = {
  runId: string;
  sourceSet: NativePayloadSourceSet;
  /** Exact receipt components that compose the source set consumed by this request. */
  consumedSourceComponents?: NativeConsumedSourceComponent[];
  dispatch: Extract<NativePayloadSourceInput, { kind: "worker_model_dispatch" }>;
  /** Present only when the output came from the pinned managed OpenCode tool boundary. */
  managedOpenCodeToolUse?: { callId: string; toolName: string; argumentsHash: string; responseContentHash: string };
};
export type NativeAwModelOutputCapture = NativeModelOutputCapture;

function isClosedEmptyTaskContinuation(value: unknown, input: {
  companyId: string;
  issueId: string;
  wakeReason: string | null;
  task: { title: string; description: string | null };
}): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const continuation = value as Record<string, unknown>;
  const keys = ["version", "companyId", "issueId", "trigger", "originCommentIds", "objective", "messages",
    "humanResponses", "interactionOutcomes", "completedWork", "recoveryOutcomes", "unresolvedInteractionIds", "coverage",
    "completedActions", "interruptedRunId"];
  if (Object.keys(continuation).some(key => !keys.includes(key)) ||
    continuation.version !== 1 || continuation.issueId !== input.issueId ||
    continuation.companyId !== input.companyId ||
    continuation.objective !== (input.task.description ?? input.task.title) ||
    !Array.isArray(continuation.originCommentIds) || continuation.originCommentIds.length !== 0 ||
    !Array.isArray(continuation.messages) || continuation.messages.length !== 0 ||
    (continuation.humanResponses !== undefined && (!Array.isArray(continuation.humanResponses) || continuation.humanResponses.length !== 0)) ||
    !Array.isArray(continuation.interactionOutcomes) || continuation.interactionOutcomes.length !== 0 ||
    (continuation.recoveryOutcomes !== undefined && (!Array.isArray(continuation.recoveryOutcomes) || continuation.recoveryOutcomes.length !== 0)) ||
    continuation.completedWork !== null ||
    (continuation.completedActions !== undefined && (!Array.isArray(continuation.completedActions) || continuation.completedActions.length !== 0)) ||
    continuation.interruptedRunId !== undefined || !Array.isArray(continuation.unresolvedInteractionIds) || continuation.unresolvedInteractionIds.length !== 0)
    return false;
  const trigger = continuation.trigger;
  if (!trigger || typeof trigger !== "object" || Array.isArray(trigger)) return false;
  const triggerRecord = trigger as Record<string, unknown>;
  const triggerKeys = ["reason", "interactionId", "sourceRunId"];
  if (Object.keys(triggerRecord).some(key => !triggerKeys.includes(key)) || typeof triggerRecord.reason !== "string" ||
    (triggerRecord.reason !== input.wakeReason && !(input.wakeReason === null && triggerRecord.reason === "task_execution")) ||
    triggerRecord.interactionId !== null || triggerRecord.sourceRunId !== null) return false;
  const coverage = continuation.coverage;
  if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)) return false;
  const coverageRecord = coverage as Record<string, unknown>;
  return Object.keys(coverageRecord).every(key => ["kind", "throughCommentId", "summaryThroughCommentId"].includes(key)) &&
    coverageRecord.kind === "full_task_history" && coverageRecord.throughCommentId === null && coverageRecord.summaryThroughCommentId === null;
}

/** Capture only the closed no-comment Task wake profile. Any additional wake
 * source, annotation, interaction, continuation or unclassified key stays
 * unknown and prevents the bootstrap source set from closing. */
export function captureNativeTaskWakeSource(input: {
  companyId: string;
  runId: string;
  issueId: string;
  sourceVersion: string;
  task: { id: string; identifier: string | null; title: string; description: string | null; status: string;
    priority: string; workMode: string };
  /** Read from the persisted heartbeat run, independently of the rendered
   * wake payload. */
  persistedWakeReason: string | null;
  payload: unknown;
}): Extract<NativePayloadSourceInput, { kind: "native_task_wake" }> | null {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(input.runId) || !uuid.test(input.issueId) || !/^\d+(?:\.\d+)?$/.test(input.sourceVersion) ||
    input.task.id !== input.issueId || !input.payload || typeof input.payload !== "object" || Array.isArray(input.payload))
    return null;
  const payload = input.payload as Record<string, unknown>;
  const keys = ["reason", "executionContinuation", "attachmentOmissions", "externalChatProvider", "recovery", "issue",
    "agentMessage", "childIssueSummaries", "childIssueSummaryTruncated", "dispositionRepair", "livenessContinuation",
    "interactionKind", "interactionStatus", "interactionId", "sourceRunId", "externalChatQuestionResponse",
    "externalInteractionContinuation", "checkboxSelection", "checkedOutByHarness", "externalChatExecutionBound",
    "simplifiedEnglishInteractions", "dependencyBlockedInteraction", "treeHoldInteraction", "activeTreeHold",
    "unresolvedBlockerIssueIds", "unresolvedBlockerSummaries", "executionStage", "taskWatchdog", "skillTest",
    "continuationSummary", "commentIds", "latestCommentId", "comments", "annotationDeltas", "planReviewContext",
    "documentReviewContext", "commentWindow", "truncated", "fallbackFetchNeeded"].sort();
  const actualKeys = Object.keys(payload).sort();
  const expectedKeys = payload.connectorSkillInstructions === undefined ? keys : [...keys, "connectorSkillInstructions"].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) return null;
  const issue = payload.issue;
  if (!issue || typeof issue !== "object" || Array.isArray(issue)) return null;
  const wakeIssue = issue as Record<string, unknown>;
  const issueKeys = ["id", "identifier", "title", "description", "descriptionTruncated", "status", "priority", "workMode"].sort();
  if (JSON.stringify(Object.keys(wakeIssue).sort()) !== JSON.stringify(issueKeys) ||
    JSON.stringify({ id: wakeIssue.id, identifier: wakeIssue.identifier, title: wakeIssue.title,
      description: wakeIssue.description, status: wakeIssue.status, priority: wakeIssue.priority, workMode: wakeIssue.workMode }) !==
    JSON.stringify(input.task) || wakeIssue.descriptionTruncated !== false) return null;
  const emptyObject = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0;
  const checks: Record<string, boolean> = {
    reason: payload.reason === input.persistedWakeReason,
    continuation: payload.executionContinuation === null || isClosedEmptyTaskContinuation(payload.executionContinuation, {
      companyId: input.companyId, issueId: input.issueId, wakeReason: input.persistedWakeReason, task: input.task,
    }),
    attachmentOmissions: Array.isArray(payload.attachmentOmissions) && payload.attachmentOmissions.length === 0,
    externalChatProvider: payload.externalChatProvider === null, recovery: payload.recovery === null, agentMessage: payload.agentMessage === null,
    childIssueSummaries: Array.isArray(payload.childIssueSummaries) && payload.childIssueSummaries.length === 0,
    childIssueSummaryTruncated: payload.childIssueSummaryTruncated === false,
    dispositionRepair: payload.dispositionRepair === null, livenessContinuation: payload.livenessContinuation === null,
    interactionKind: payload.interactionKind === null, interactionStatus: payload.interactionStatus === null,
    interactionId: payload.interactionId === null, sourceRunId: payload.sourceRunId === null,
    externalChatQuestionResponse: payload.externalChatQuestionResponse === null,
    externalInteractionContinuation: payload.externalInteractionContinuation === false, checkboxSelection: payload.checkboxSelection === null,
    checkedOutByHarness: payload.checkedOutByHarness === false, externalChatExecutionBound: payload.externalChatExecutionBound === false,
    simplifiedEnglishInteractions: payload.simplifiedEnglishInteractions === false, dependencyBlockedInteraction: payload.dependencyBlockedInteraction === false,
    treeHoldInteraction: payload.treeHoldInteraction === false, activeTreeHold: Boolean(emptyObject(payload.activeTreeHold)),
    unresolvedBlockerIssueIds: Array.isArray(payload.unresolvedBlockerIssueIds) && payload.unresolvedBlockerIssueIds.length === 0,
    unresolvedBlockerSummaries: Array.isArray(payload.unresolvedBlockerSummaries) && payload.unresolvedBlockerSummaries.length === 0,
    executionStage: payload.executionStage === null, taskWatchdog: payload.taskWatchdog === null, skillTest: payload.skillTest === null,
    continuationSummary: payload.continuationSummary === null,
    connectorSkillInstructions: payload.connectorSkillInstructions === undefined || payload.connectorSkillInstructions === null || payload.connectorSkillInstructions === "",
    commentIds: Array.isArray(payload.commentIds) && payload.commentIds.length === 0, latestCommentId: payload.latestCommentId === null,
    comments: Array.isArray(payload.comments) && payload.comments.length === 0,
    annotationDeltas: Array.isArray(payload.annotationDeltas) && payload.annotationDeltas.length === 0,
    planReviewContext: payload.planReviewContext === null, documentReviewContext: payload.documentReviewContext === null,
    truncated: payload.truncated === false, fallbackFetchNeeded: payload.fallbackFetchNeeded === false,
  };
  const failedChecks = Object.keys(checks).filter(key => !checks[key]);
  if (failedChecks.length) return null;
  const commentWindow = payload.commentWindow;
  if (!commentWindow || typeof commentWindow !== "object" || Array.isArray(commentWindow) ||
    JSON.stringify(commentWindow) !== JSON.stringify({ requestedCount: 0, includedCount: 0, missingCount: 0 })) return null;
  return { kind: "native_task_wake", runId: input.runId, issueId: input.issueId,
    sourceVersion: input.sourceVersion, contentHash: createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex") };
}

/** Resolve only references emitted by the real Markdown renderer. Missing,
 * ambiguous, unsupported, or source-history-unknown references stay unknown. */
export function buildNativeBootstrapSourceSet(input: {
  companyId: string;
  runId: string;
  agentId: string;
  issueId: string;
  renderedMarkdown: string;
  renderedMarkdownDigest: string | null;
  references: readonly NativeRenderedSourceReference[] | null;
  candidates: readonly NativePreparedSourceCandidate[];
  runtimeInputs: readonly NativePayloadSourceInput[] | null;
  additionalInputs?: readonly NativePayloadSourceInput[] | null;
  interactionResponses?: readonly NativeInteractionResponseEnvelope[] | null;
  interactionSources?: readonly Extract<NativePayloadSourceInput, { kind: "interaction" }>[] | null;
  contextManifestIds: readonly { companyId: string; contextManifestId: string }[] | null;
  governedContextMarkdown?: string | null;
  contextWitnessMarkdown?: string | null;
  contextWitness?: NativeBootstrapContextWitness | null;
  rolePackInputs: readonly NativePayloadSourceInput[] | null;
  unsupportedInputPresent: boolean;
}): NativePayloadSourceSet | null {
  const interactionSources = exactInteractionSources({ issueId: input.issueId,
    responses: input.interactionResponses, sources: input.interactionSources });
  if (!interactionSources) return null;
  const contextMarkdown = input.contextWitnessMarkdown ?? input.governedContextMarkdown;
  const context = input.contextWitness && contextMarkdown
    ? readNativeBootstrapContextWitness(input.contextWitness, { companyId: input.companyId, runId: input.runId,
      agentId: input.agentId, issueId: input.issueId, renderedMarkdown: contextMarkdown,
      manifestIds: input.contextManifestIds ?? [] }) : null;
  if (input.unsupportedInputPresent || !input.references || input.references.length === 0 ||
    !input.references.some(reference => reference.kind === "task") || !input.renderedMarkdownDigest ||
    createHash("sha256").update(input.renderedMarkdown, "utf8").digest("hex") !== input.renderedMarkdownDigest ||
    !input.runtimeInputs || !input.contextManifestIds || input.contextManifestIds.length > 0 && !context ||
    input.governedContextMarkdown?.trim() && !context ||
    !input.rolePackInputs || input.rolePackInputs.length !== 0 ||
    input.references.some(reference => reference.kind === "unknown")) return null;
  const policy: NativePayloadSourcePolicy = { issueIds: [], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] };
  const inputs: NativePayloadSourceInput[] = [];
  const append = (source: NativePayloadSourceInput) => {
    const parsed = nativePayloadSourceInputSchema.parse(source);
    if (!inputs.some(existing => JSON.stringify(existing) === JSON.stringify(parsed))) inputs.push(parsed);
  };
  const addSnapshotPolicy = (raw: unknown, expected: { kind: string; id: string }) => {
    if (raw === null || raw === undefined) return false;
    const parsed = nativePayloadSourceSnapshotSchema.safeParse(raw);
    if (!parsed.success || parsed.data.owner.kind !== expected.kind || parsed.data.owner.id !== expected.id ||
      parsed.data.owner.companyId !== input.companyId) return false;
    for (const key of Object.keys(policy) as Array<keyof NativePayloadSourcePolicy>) {
      policy[key].push(...parsed.data.policy[key]);
      policy[key] = [...new Set(policy[key])].sort();
    }
    for (const source of parsed.data.inputs) append(source);
    return true;
  };
  const mergePolicy = (incoming: NativePayloadSourcePolicy) => {
    for (const key of Object.keys(policy) as Array<keyof NativePayloadSourcePolicy>)
      policy[key] = [...new Set([...policy[key], ...incoming[key]])].sort();
  };
  for (const reference of input.references) {
    const matches = input.candidates.filter(candidate => candidate.kind === reference.kind && candidate.id === reference.id);
    const uniqueMatches = [...new Map(matches.map(candidate => [JSON.stringify(candidate), candidate])).values()];
    if (uniqueMatches.length !== 1) return null;
    const candidate = uniqueMatches[0]!;
    const expectedOwner = reference.kind === "task" ? "issue" : reference.kind;
    const sourceMatchesReference = reference.kind === "task"
      ? candidate.input.kind === "task" && candidate.input.issueId === reference.id
      : reference.kind === "document_revision"
        ? candidate.input.kind === "document_revision" && candidate.input.revisionId === reference.id
        : reference.kind === "comment"
          ? candidate.input.kind === "comment" && candidate.input.commentId === reference.id
          : reference.kind === "attachment"
            ? candidate.input.kind === "attachment" && candidate.input.attachmentId === reference.id &&
              typeof reference.commentId === "string" && typeof reference.filename === "string" &&
              typeof reference.contentType === "string" && Number.isSafeInteger(reference.byteSize) &&
              candidate.input.commentId === reference.commentId && candidate.input.byteSize === reference.byteSize &&
              candidate.input.disposition === "delivered" && candidate.input.assetId !== null && candidate.input.sha256 !== null
            : false;
    if (!sourceMatchesReference) return null;
    if (!addSnapshotPolicy(candidate.payloadSourceSnapshot, { kind: expectedOwner, id: reference.id })) return null;
    append(candidate.input);
  }
  for (const source of input.runtimeInputs) append(source);
  if (input.additionalInputs === null) return null;
  for (const source of input.additionalInputs ?? []) append(source);
  for (const source of interactionSources) append(source);
  if (context) {
    mergePolicy(context.policy);
    append(context.contextInput);
    for (const source of context.inputs) append(source);
  }
  for (const source of input.rolePackInputs) append(source);
  const references = inputs.length + Object.values(policy).reduce((sum, values) => sum + values.length, 0);
  if (references > 256) return null;
  return { policy, inputs };
}

/** Attach one real, freshly assembled Context render to the exact next Native
 * user frame and carry its witness-derived owners into that dispatch closure.
 * This is a server-only preparation helper; caller prose cannot mint the
 * witness or source references. */
export function prepareNativeTurnWithContext<T extends { message: { role: string; text: string } }>(input: {
  turnInput: T;
  baseClosure: NativeBootstrapSourceClosure;
  companyId: string;
  runId: string;
  agentId: string;
  issueId: string;
  contextMarkdown: string;
  contextWitness: NativeBootstrapContextWitness | null;
  manifestIds: readonly { companyId: string; contextManifestId: string }[];
}): { turnInput: T; sourceClosure: NativeBootstrapSourceClosure } | null {
  if (input.turnInput.message.role !== "user" || input.turnInput.message.text.length > 2_000_000) return null;
  const context = input.contextWitness && readNativeBootstrapContextWitness(input.contextWitness, {
    companyId: input.companyId, runId: input.runId, agentId: input.agentId, issueId: input.issueId,
    renderedMarkdown: input.contextMarkdown, manifestIds: input.manifestIds,
  });
  if (!context || input.manifestIds.length !== 1) return null;
  let frame: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(input.turnInput.message.text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    frame = parsed as Record<string, unknown>;
  } catch { return null; }
  if (frame.schema !== "paperclip.native-model-envelope.v2" || Object.hasOwn(frame, "turnContext")) return null;
  const markdownDigest = createHash("sha256").update(input.contextMarkdown, "utf8").digest("hex");
  const manifestIds = [...new Set([context.contextInput.manifestId])].sort();
  frame.turnContext = { schema: "paperclip.native-turn-context.v1", markdown: input.contextMarkdown,
    digest: markdownDigest, manifestIds };
  const policy: NativePayloadSourcePolicy = { ...input.baseClosure.sourceSet.policy };
  for (const key of Object.keys(policy) as Array<keyof NativePayloadSourcePolicy>)
    policy[key] = [...new Set([...policy[key], ...context.policy[key]])].sort();
  const inputs = [...input.baseClosure.sourceSet.inputs];
  for (const source of [context.contextInput, ...context.inputs]) {
    const encoded = JSON.stringify(source);
    if (!inputs.some(existing => JSON.stringify(existing) === encoded)) inputs.push(source);
  }
  if (inputs.length + Object.values(policy).reduce((sum, values) => sum + values.length, 0) > 256) return null;
  return { turnInput: { ...input.turnInput,
    message: { ...input.turnInput.message, text: JSON.stringify(frame) } },
    sourceClosure: { sourceSet: { policy, inputs }, taskEnvelopeDigest: input.baseClosure.taskEnvelopeDigest,
      turnContext: { markdownDigest, manifestIds } } };
}

/** Closed constructor: callers cannot spread legacy context or environment data. */
export function buildNativeExecutionInput(input: {
  companyId: string;
  runId: string;
  issue: {
    id: string;
    identifier: string | null;
    title: string;
    description: string | null;
    workMode: string;
  };
  taskPrompt: string;
  /**
   * Server-assembled, authorized and budgeted August Works context. This is
   * injected only after Context Engine policy resolution; it must never carry
   * credentials or grant authority by itself.
   */
  governedContextMarkdown?: string | null;
  initialCommunicationGuidance?: string | null;
  /**
   * The already-sanitized Paperclip wake envelope for this run. Native drivers
   * receive a closed execution input rather than the legacy adapter context,
   * so the constructor must deliberately project the same bounded wake delta
   * that legacy adapters place in their provider prompt.
   */
  wakePayload?: unknown;
  resumedSession?: boolean;
  previousTurn?: { runId: string; task: { title: string; description: string | null } } | null;
  conversationMode?: boolean;
  agentId: string;
  workspace: {
    id: string;
    cwd: string;
    repoUrl: string | null;
    repoRef: string | null;
    branchName: string | null;
  };
  normalizedSessionId: string | null;
  provider?: "codex" | "opencode" | "claude_managed" | "aws_agentcore" | "acpx" | "aw_text_only";
  workerModelProfileId?: string;
  maxOutputTokens?: number;
  acpxAgent?: NativeAcpxAgent;
  codexApprovalPolicy?: NativeCodexApprovalPolicy;
  opencodePermissionMode?: NativeOpenCodePermissionMode;
  acpxPermissionMode?: NativeAcpxPermissionMode;
  model?: string | null;
  managedProfile?: Extract<
    NativeExecutionInputV4["provider"],
    { kind: "claude_managed" }
  >["managedProfile"];
  maxSessionListCostUsd?: number;
  agentCoreProfile?: Extract<
    NativeExecutionInputV4["provider"],
    { kind: "aws_agentcore" }
  >["agentCoreProfile"];
  maxEstimatedSessionCostUsd?: number;
  invocationLimits?: Extract<
    NativeExecutionInputV4["provider"],
    { kind: "aws_agentcore" }
  >["invocationLimits"];
  lifecyclePolicy?: NativeExecutionInputV4["session"]["lifecyclePolicy"];
  executionMode?: "default" | "plan";
  planningContext?: NativePlanningContext | null;
  interactionResponses?: NativeInteractionResponseEnvelope[];
  completionContract: {
    id: string;
    sha256: string;
    schemaVersion: string;
    contract: StrictCompletionContractInput;
  };
  runtimeContext: NativeRuntimeContextSnapshot;
}): NativeExecutionInputV4 {
  if (input.issue.workMode !== "standard" && input.issue.workMode !== "planning" && input.issue.workMode !== "ask") {
    throw new Error("native_execution_input_invalid: issue work mode must be standard, planning, or ask");
  }
  const executionMode = input.executionMode
    ?? (input.issue.workMode === "planning" ? "plan" : "default");
  const acpxProfile = input.provider === "acpx"
    ? resolveQualifiedAcpxProfile(
        input.acpxAgent ?? "codex",
        input.model ?? "",
      )
    : null;
  // Answers are materialized from the authoritative interaction only for this
  // invocation; do not persist a duplicate answer in the durable wake snapshot.
  const wake =
    input.wakePayload &&
    typeof input.wakePayload === "object" &&
    !Array.isArray(input.wakePayload)
      ? (input.wakePayload as Record<string, unknown>)
      : null;
  const question = wake?.externalChatQuestionResponse
    ? input.interactionResponses?.find(
        (response) =>
          response.interactionId === wake.interactionId &&
          response.kind === "ask_user_questions" &&
          response.response.status === "answered",
      )
    : null;
  const answerResult = question?.response.result as
    Record<string, unknown> | undefined;
  // The server supplies only the revalidated answer chain, in source order.
  // Keep prior choices available even when this continuation starts a fresh
  // provider session; never recover them from model prose or a transcript.
  const answerChain = question
    ? input.interactionResponses?.filter((response) =>
        response.kind === "ask_user_questions" &&
        response.response.status === "answered" &&
        typeof (response.response.result as Record<string, unknown> | undefined)
          ?.summaryMarkdown === "string")
    : null;
  const answerSummary =
    answerChain && answerChain.length > 1 &&
    answerChain.at(-1)?.interactionId === question?.interactionId
      ? answerChain.map((response, index) => {
          const label = index === answerChain.length - 1
            ? "Latest answered question" : `Earlier answer ${index + 1}`;
          return `${label}:\n${(response.response.result as Record<string, unknown>).summaryMarkdown}`;
        }).join("\n\n")
      : answerResult?.summaryMarkdown;
  const wakePayload =
    question && typeof answerSummary === "string"
      ? {
          ...wake,
          questionResponse: {
            interactionId: question.interactionId,
            summaryMarkdown: answerSummary,
          },
        }
      : input.wakePayload;
  const wakePrompt = renderPaperclipWakePrompt(wakePayload, {
    resumedSession: false,
    conversationMode: input.conversationMode === true,
    suppressIssueDescription: input.taskPrompt.trim().length > 0,
    nativeWakeReaderAvailable: true,
  });
  const externalChatTurn =
    isPaperclipExternalChatContractTurn(wakePayload) ||
    isPaperclipExternalChatQuestionResponseTurn(wakePayload);
  const taskPrompt = [
    wakePrompt,
    // Durable task questions must survive the current provider turn.
    // Keep routing visible before deferred tool discovery; usage belongs in the tool schema.
    "Use Paperclip's request_human_input for durable task questions.",
    externalChatTurn && wake?.externalChatProvider === "github"
      ? NATIVE_GITHUB_ATTACHMENT_RECOVERY_GUIDANCE
      : "",
    input.governedContextMarkdown?.trim() ?? "",
    input.taskPrompt.trim(),
  ]
    .filter((section) => section.length > 0)
    .join("\n\n");
  return parseNativeExecutionInput({
    schema: "paperclip.native-execution-input.v4",
    ...(input.initialCommunicationGuidance ? { initialCommunicationGuidance: input.initialCommunicationGuidance } : {}),
    ...(input.resumedSession && input.previousTurn && !input.conversationMode ? {
      continuationPrompt: buildNativeContinuationPrompt({
        wakePayload: input.wakePayload,
        previousRunId: input.previousTurn.runId,
        previousIssue: input.previousTurn.task,
        allowExternalChat: true,
        issue: input.issue,
      }),
    } : {}),
    executionMode,
    planningContext: input.planningContext ?? null,
    binding: {
      companyId: input.companyId,
      runId: input.runId,
      issueId: input.issue.id,
      agentId: input.agentId,
      executionWorkspaceId: input.workspace.id,
    },
    task: {
      identifier: input.issue.identifier ?? input.issue.id,
      // The issue title is durable background context and may itself contain an
      // exact-output instruction from the thread's first message. Repeating it
      // as the native turn title can override a newer provider message in small
      // models. Keep the canonical title and description in task.prompt as
      // explicitly labeled background, but give authenticated external-chat
      // turns neutral structured fields.
      title: externalChatTurn ? "External chat follow-up" : input.issue.title,
      description: externalChatTurn ? null : input.issue.description,
      prompt: taskPrompt,
      workMode: input.issue.workMode,
    },
    workspace: {
      cwd: input.workspace.cwd,
      repoUrl: input.workspace.repoUrl,
      repoRef: input.workspace.repoRef,
      branchName: input.workspace.branchName,
    },
    session: {
      normalizedSessionId: input.normalizedSessionId,
      driverKind: input.provider === "aw_text_only" ? "aw_text_messages" : input.provider === "opencode"
        ? "opencode_server"
        : input.provider === "claude_managed"
          ? "claude_managed_agents_api"
          : input.provider === "aws_agentcore"
            ? "aws_agentcore_harness_api"
        : input.provider === "acpx"
            ? "acpx_runtime"
            : "codex_app_server",
      protocolVersion: 1,
      lifecyclePolicy: input.lifecyclePolicy ?? { mode: "per_turn", idleTimeoutMs: null },
    },
    provider: input.provider === "aw_text_only"
      ? { kind: "aw_text_only", model: input.model, profileId: input.workerModelProfileId, maxOutputTokens: input.maxOutputTokens }
      : input.provider === "claude_managed"
      ? {
          kind: "claude_managed",
          model: input.model,
          managedProfile: input.managedProfile,
          maxSessionListCostUsd: input.maxSessionListCostUsd,
        }
      : input.provider === "aws_agentcore"
        ? {
            kind: "aws_agentcore",
            model: input.model,
            agentCoreProfile: input.agentCoreProfile,
            maxEstimatedSessionCostUsd: input.maxEstimatedSessionCostUsd,
            invocationLimits: input.invocationLimits,
          }
      : input.provider === "acpx"
      ? {
          kind: "acpx",
          agent: acpxProfile!.agent,
          model: input.model,
          permissionMode: input.acpxPermissionMode ?? "approve-all",
          profile: {
            driverKind: acpxProfile!.driverKind,
            protocolVersion: acpxProfile!.protocolVersion,
            acpxVersion: acpxProfile!.acpxVersion,
            agent: acpxProfile!.agent,
            agentProfileVersion: acpxProfile!.agentProfileVersion,
            agentServerPackage: acpxProfile!.agentServerPackage,
            agentServerVersion: acpxProfile!.agentServerVersion,
            agentRuntimePackage: acpxProfile!.agentRuntimePackage,
            agentRuntimeVersion: acpxProfile!.agentRuntimeVersion,
            commandDigest: acpxProfile!.commandDigest,
          },
        }
      : input.provider === "opencode"
        ? {
            kind: "opencode",
            model: input.model,
            permissionMode: input.opencodePermissionMode ?? "allow",
          }
        : {
            kind: "codex",
            model: input.model ?? null,
            approvalPolicy: input.codexApprovalPolicy ?? "never",
          },
    completionContract: input.completionContract,
    interactionResponses: input.interactionResponses ?? [],
    credentialBindings: [],
    runtimeContext: input.runtimeContext,
  }) as NativeExecutionInputV4;
}
