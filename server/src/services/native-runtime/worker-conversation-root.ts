import type { NativeChannelConversationScope } from "./native-channel-conversation-owner.js";
import {
  nativePayloadSourceSnapshotSchema,
  type ConversationModelBinding,
} from "@paperclipai/shared";

type WorkerConversationRoot = {
  conversationAgentId: string | null;
  conversationUserId: string | null;
  conversationState: string | null;
  conversationSessionGeneration: number | null;
  conversationRetiredAt: Date | string | null;
  parentId: string | null;
  assigneeAgentId: string | null;
  executionRunId: string | null;
  payloadSourceProtocolVersion: number | null;
  payloadSourceSnapshot: unknown;
  payloadSourceSnapshotInvalidated: boolean | null;
};

/**
 * Recognize only a current, Human-sealed conversation root used as the source
 * of a Worker run. Worker-created Tasks remain detached from conversation
 * roots; this predicate does not authorize ordinary conversation-model use.
 */
export function isCurrentWorkerConversationRoot(input: {
  scope: string;
  root: WorkerConversationRoot | null | undefined;
  contextSnapshot: unknown;
  companyId: string;
  issueId: string;
  agentId: string;
  responsibleUserId: string | null;
  runId: string;
}): boolean {
  const root = input.root;
  if (!root || input.scope !== "worker_model") return false;

  const context = input.contextSnapshot && typeof input.contextSnapshot === "object" && !Array.isArray(input.contextSnapshot)
    ? input.contextSnapshot as Record<string, unknown>
    : {};
  const snapshot = nativePayloadSourceSnapshotSchema.safeParse(root.payloadSourceSnapshot);
  if (!snapshot.success) return false;

  const sourceInputs = snapshot.data.inputs;
  return root.conversationAgentId === input.agentId &&
    root.conversationUserId === input.responsibleUserId &&
    (root.conversationState === "active" || root.conversationState === "waiting") &&
    root.conversationRetiredAt === null && root.parentId === null &&
    root.assigneeAgentId === input.agentId && root.executionRunId === input.runId &&
    root.payloadSourceProtocolVersion === 1 && root.payloadSourceSnapshotInvalidated === false &&
    typeof context.conversationSessionGeneration === "number" &&
    root.conversationSessionGeneration === context.conversationSessionGeneration &&
    snapshot.data.owner.kind === "issue" && snapshot.data.owner.companyId === input.companyId &&
    snapshot.data.owner.id === input.issueId &&
    sourceInputs.length === 1 && sourceInputs[0]?.kind === "comment" &&
    sourceInputs[0].issueId === input.issueId &&
    Object.values(snapshot.data.policy).every(values => values.length === 0);
}

/** Recognize the current Human-sealed root for an ordinary conversation-model
 * turn. This is intentionally distinct from the Worker-only predicate above:
 * the signed conversation binding must name this exact issue/session/manifest,
 * and the current issue must still be the protocol-1, single-comment root. */
export function isCurrentConversationModelRoot(input: {
  root: WorkerConversationRoot | null | undefined;
  contextSnapshot: unknown;
  companyId: string;
  agentId: string;
  responsibleUserId: string | null;
  runId: string;
  binding: ConversationModelBinding;
  channelScope?: NativeChannelConversationScope | null;
}): boolean {
  const root = input.root;
  if (!root || input.responsibleUserId === null || input.binding.issueId.length === 0 ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(input.binding.issueId) ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(input.binding.executionManifestId) ||
    !/^[a-f0-9]{64}$/.test(input.binding.executionManifestHash)) return false;

  const context = input.contextSnapshot && typeof input.contextSnapshot === "object" && !Array.isArray(input.contextSnapshot)
    ? input.contextSnapshot as Record<string, unknown>
    : {};
  const channelRetainedScope = input.channelScope?.kind === "chat_channel_conversation" && input.channelScope.consumer === "retained_source"
    ? input.channelScope : null;
  // Retained Native sources are already checked against the exact persisted
  // inbound action, source comment, conversation generation, and current
  // linked Human by the channel source owner. Historical cleanup may retire
  // the conversation root or invalidate its operational payload snapshot;
  // those fields cannot revoke an already captured source. Keep only the
  // immutable issue/root identity and dispatch binding here. Live admissions
  // continue through the full current-root snapshot checks below.
  if (channelRetainedScope) return channelRetainedScope.companyId === input.companyId &&
    channelRetainedScope.issueId === input.binding.issueId && channelRetainedScope.agentId === input.agentId &&
    channelRetainedScope.responsibleUserId === input.responsibleUserId && channelRetainedScope.runId === input.runId &&
    channelRetainedScope.sessionGeneration === input.binding.conversationSessionGeneration &&
    root.parentId === null && input.binding.conversationSessionGeneration === context.conversationSessionGeneration;
  const snapshot = nativePayloadSourceSnapshotSchema.safeParse(root.payloadSourceSnapshot);
  if (!snapshot.success) return false;

  const sourceInputs = snapshot.data.inputs;
  const nativeConversationOwnerCurrent = input.channelScope
    ? input.channelScope.kind === "chat_channel_conversation" &&
      input.channelScope.companyId === input.companyId && input.channelScope.issueId === input.binding.issueId &&
      input.channelScope.agentId === input.agentId && input.channelScope.responsibleUserId === input.responsibleUserId &&
      input.channelScope.runId === input.runId && input.channelScope.sessionGeneration === input.binding.conversationSessionGeneration
    : root.conversationAgentId === input.agentId && root.conversationUserId === input.responsibleUserId &&
      (root.conversationState === "active" || root.conversationState === "waiting") && root.conversationRetiredAt === null &&
      root.conversationSessionGeneration === context.conversationSessionGeneration;
  return nativeConversationOwnerCurrent && root.conversationRetiredAt === null && root.parentId === null &&
    root.assigneeAgentId === input.agentId && root.executionRunId === input.runId &&
    root.payloadSourceProtocolVersion === 1 && root.payloadSourceSnapshotInvalidated === false &&
    typeof context.conversationSessionGeneration === "number" &&
    input.binding.conversationSessionGeneration === context.conversationSessionGeneration &&
    snapshot.data.owner.kind === "issue" && snapshot.data.owner.companyId === input.companyId &&
    snapshot.data.owner.id === input.binding.issueId &&
    sourceInputs.length === 1 && sourceInputs[0]?.kind === "comment" &&
    sourceInputs[0].issueId === input.binding.issueId &&
    Object.values(snapshot.data.policy).every(values => values.length === 0);
}
