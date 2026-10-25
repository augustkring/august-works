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

export type NativeBootstrapSourceClosure = {
  sourceSet: NativePayloadSourceSet;
  taskEnvelopeDigest: string;
};

/** Resolve only references emitted by the real Markdown renderer. Missing,
 * ambiguous, unsupported, or source-history-unknown references stay unknown. */
export function buildNativeBootstrapSourceSet(input: {
  companyId: string;
  renderedMarkdown: string;
  renderedMarkdownDigest: string | null;
  references: readonly NativeRenderedSourceReference[] | null;
  candidates: readonly NativePreparedSourceCandidate[];
  runtimeInputs: readonly NativePayloadSourceInput[] | null;
  contextManifestIds: readonly { companyId: string; contextManifestId: string }[] | null;
  rolePackInputs: readonly NativePayloadSourceInput[] | null;
  unsupportedInputPresent: boolean;
}): NativePayloadSourceSet | null {
  if (input.unsupportedInputPresent || !input.references || input.references.length === 0 ||
    !input.references.some(reference => reference.kind === "task") || !input.renderedMarkdownDigest ||
    createHash("sha256").update(input.renderedMarkdown, "utf8").digest("hex") !== input.renderedMarkdownDigest ||
    !input.runtimeInputs || !input.contextManifestIds || input.contextManifestIds.length !== 0 ||
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
            ? candidate.input.kind === "attachment" && candidate.input.attachmentId === reference.id
            : false;
    if (!sourceMatchesReference) return null;
    if (!addSnapshotPolicy(candidate.payloadSourceSnapshot, { kind: expectedOwner, id: reference.id })) return null;
    append(candidate.input);
  }
  for (const source of input.runtimeInputs) append(source);
  for (const source of input.rolePackInputs) append(source);
  const references = inputs.length + Object.values(policy).reduce((sum, values) => sum + values.length, 0);
  if (references > 256) return null;
  return { policy, inputs };
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
