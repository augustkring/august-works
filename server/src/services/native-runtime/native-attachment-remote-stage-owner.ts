import { and, eq, gt, isNull } from "drizzle-orm";
import {
  agentWakeupRequests,
  agents,
  assets,
  heartbeatRuns,
  environmentLeases,
  issueAttachments,
  issueComments,
  issues,
  type Db,
} from "@paperclipai/db";
import {
  nativePayloadSourceSnapshotSchema,
  nativePayloadSourceInputSchema,
  type NativePayloadSourceInput,
  type NativePayloadSourcePolicy,
} from "@paperclipai/shared";
import { forbidden } from "../../errors.js";
import { assertNativePreDispatchTaskCommentAttachmentCurrent, assertNativeTaskSourceOwnerCurrent } from "../native-direct-input.js";
import { parseNativeExecutionInput } from "../../vendor/paperclip-runner/index.js";
import { nativeSha256 } from "./canonical.js";
import { readNativeAttachmentStageCleanupReceipts, type NativeRemoteAttachmentStageOperation,
  type NativeRemoteAttachmentStageRelayOperation } from "./native-attachment-remote-stage.js";
import { findNativeChatWorkspaceScope, nativeChatWorkspaceCwd } from "./native-chat-workspace.js";

type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function uuid(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value); }
function denied(): never { throw forbidden("Native remote attachment staging source changed"); }

export type NativeRemoteAttachmentStageOwner = {
  runId: string;
  companyId: string;
  issueId: string;
  agentId: string;
  responsibleUserId: string;
  attachmentInput: Extract<NativePayloadSourceInput, { kind: "attachment" }>;
  attachmentPolicy: NativePayloadSourcePolicy;
  attachmentSnapshot: Record<string, unknown>;
  sourceHash: string;
  byteSize: number;
  filename: string;
  contentType: string;
  stageNonce: string;
  executionInputHash: string;
} | { cleanupOnly: true; runId: string; companyId: string; issueId: string; agentId: string; stageNonce: string };

/** Independently reconstruct the current Human wake, exact rendered attachment,
 * attachment/asset owner, and ACL for each remote write command. This source
 * check is deliberately separate from the command syntax predicate. */
export async function captureNativeRemoteAttachmentStageOwner(db: Db | Transaction, input: {
  companyId: string; issueId: string; runId: string; agentId: string; taskRoot: string;
  operation: NativeRemoteAttachmentStageOperation; leaseId?: string; expectedExecutionInputHash?: string;
  requirePersistedStageIntent?: boolean;
}): Promise<NativeRemoteAttachmentStageOwner> {
  if (!uuid(input.companyId) || !uuid(input.issueId) || !uuid(input.runId) || !uuid(input.agentId) ||
      !uuid(input.operation.runId) || input.operation.runId !== input.runId ||
      !uuid(input.operation.attachmentId) || !uuid(input.operation.stageNonce)) return denied();
  const [run] = await db.select().from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, input.runId),
    eq(heartbeatRuns.agentId, input.agentId), eq(heartbeatRuns.nativeIssueId, input.issueId),
    eq(heartbeatRuns.runtimeMode, "native"),
  )).for("share").limit(1);
  const [task] = await db.select().from(issues).where(and(
    eq(issues.companyId, input.companyId), eq(issues.id, input.issueId),
  )).for("share").limit(1);
  const profile = record(run?.runnerProfileJson);
  if (run && task && input.operation.phase === "cleanup") {
    let cleanupExecution: ReturnType<typeof parseNativeExecutionInput> | null = null;
    try { cleanupExecution = parseNativeExecutionInput(profile.nativeExecutionInput); } catch { cleanupExecution = null; }
    let retained = false;
    try {
      retained = readNativeAttachmentStageCleanupReceipts(profile, input.runId).some(receipt =>
        receipt.attachmentId === input.operation.attachmentId && receipt.stageNonce === input.operation.stageNonce);
    } catch { retained = false; }
    if (cleanupExecution && retained && ["running", "succeeded", "failed", "cancelled"].includes(run.status) &&
      run.nativeIssueId === input.issueId && run.agentId === input.agentId &&
      cleanupExecution.binding.companyId === input.companyId && cleanupExecution.binding.runId === input.runId &&
      cleanupExecution.binding.issueId === input.issueId && cleanupExecution.binding.agentId === input.agentId &&
      cleanupExecution.workspace.cwd === input.taskRoot && task.companyId === input.companyId && task.id === input.issueId) {
      return { cleanupOnly: true, runId: input.runId, companyId: input.companyId, issueId: input.issueId,
        agentId: input.agentId, stageNonce: input.operation.stageNonce };
    }
  }
  const executionValue = profile.nativeExecutionInput;
  let execution: ReturnType<typeof parseNativeExecutionInput>;
  try { execution = parseNativeExecutionInput(executionValue); } catch { return denied(); }
  const executionInputHash = nativeSha256(executionValue);
  const activeLease = input.leaseId ? (await db.select({ id: environmentLeases.id,
    executionWorkspaceId: environmentLeases.executionWorkspaceId, metadata: environmentLeases.metadata })
    .from(environmentLeases).where(and(
      eq(environmentLeases.companyId, input.companyId), eq(environmentLeases.id, input.leaseId),
      eq(environmentLeases.heartbeatRunId, input.runId), eq(environmentLeases.issueId, input.issueId),
      eq(environmentLeases.status, "active"), isNull(environmentLeases.releasedAt), gt(environmentLeases.expiresAt, new Date()),
    )).for("share").limit(1))[0] : undefined;
  let persistedStageIntent: Record<string, unknown> | null = null;
  if (input.requirePersistedStageIntent) {
    try {
      readNativeAttachmentStageCleanupReceipts(profile, input.runId, input.leaseId);
      const intents = Array.isArray(profile.nativeAttachmentStageIntents) ? profile.nativeAttachmentStageIntents : [];
      persistedStageIntent = intents.map(record).find(intent => intent.stageNonce === input.operation.stageNonce &&
        intent.attachmentId === input.operation.attachmentId) ?? null;
    } catch { persistedStageIntent = null; }
  }
  const expectedInputHashMatches = (typeof input.expectedExecutionInputHash === "string" &&
    /^[a-f0-9]{64}$/.test(input.expectedExecutionInputHash) && executionInputHash === input.expectedExecutionInputHash) ||
    Boolean(input.requirePersistedStageIntent && persistedStageIntent?.executionInputHash === executionInputHash);
  let ephemeralConversationWorkspaceMatches = false;
  if (activeLease?.executionWorkspaceId === null && execution.binding.executionWorkspaceId === input.runId &&
      run?.responsibleUserId && task) {
    const [agent] = await db.select({ adapterType: agents.adapterType }).from(agents).where(and(
      eq(agents.companyId, input.companyId), eq(agents.id, input.agentId),
    )).limit(1);
    const runContext = record(run.contextSnapshot);
    const generation = typeof runContext.conversationSessionGeneration === "number"
      ? runContext.conversationSessionGeneration : null;
    const scope = agent ? await findNativeChatWorkspaceScope(db as Db, {
      adapterType: agent.adapterType ?? "", environmentDriver: "sandbox", companyId: input.companyId,
      agentId: input.agentId, issueId: input.issueId, runId: input.runId,
      responsibleUserId: run.responsibleUserId, conversationSessionGeneration: generation,
    }) : null;
    const ephemeralTaskRoot = scope?.projectId === null ? nativeChatWorkspaceCwd(scope, null, false) : null;
    const leaseMetadata = record(activeLease.metadata);
    ephemeralConversationWorkspaceMatches = Boolean(scope && scope.projectId === null &&
      ephemeralTaskRoot === input.taskRoot && execution.workspace.cwd === input.taskRoot &&
      leaseMetadata.remoteCwd === input.taskRoot);
  }
  const leaseWorkspaceMatches = activeLease?.executionWorkspaceId === execution.binding.executionWorkspaceId ||
    ephemeralConversationWorkspaceMatches;
  const context = record(run?.contextSnapshot);
  const taskCapture = record(profile.nativeBootstrapTaskSource);
  const taskInput = nativePayloadSourceInputSchema.safeParse(taskCapture.input);
  const taskSnapshot = nativePayloadSourceSnapshotSchema.safeParse(taskCapture.payloadSourceSnapshot);
  const refs = record(profile.nativeBootstrapTaskMarkdownSourceMap).references;
  const attachmentRefs = Array.isArray(refs) ? refs.filter(value => {
    const ref = record(value);
    return ref.kind === "attachment" && ref.id === input.operation.attachmentId;
  }).map(record) : [];
  const wakeSources = record(profile.nativeBootstrapWakeCommentSources);
  const wakeRequest = record(wakeSources.request);
  const commentInput = nativePayloadSourceInputSchema.safeParse(wakeRequest.input);
  const commentSnapshot = nativePayloadSourceSnapshotSchema.safeParse(wakeRequest.payloadSourceSnapshot);
  const request = run?.wakeupRequestId ? (await db.select().from(agentWakeupRequests).where(and(
    eq(agentWakeupRequests.companyId, input.companyId), eq(agentWakeupRequests.id, run.wakeupRequestId),
    eq(agentWakeupRequests.runId, input.runId), eq(agentWakeupRequests.agentId, input.agentId),
  )).for("share").limit(1))[0] : undefined;
  const requestPayload = record(request?.payload);
  if (!run || run.status !== "running" || !task || !run.startedAt || !run.responsibleUserId || task.hiddenAt ||
      task.assigneeAgentId !== input.agentId || task.responsibleUserId !== run.responsibleUserId || task.executionRunId !== input.runId ||
      task.status === "done" || task.status === "cancelled" ||
      execution.provider.kind !== "opencode" || execution.session.driverKind !== "opencode_server" ||
      execution.binding.companyId !== input.companyId || execution.binding.runId !== input.runId ||
      execution.binding.issueId !== input.issueId || execution.binding.agentId !== input.agentId ||
      execution.workspace.cwd !== input.taskRoot ||
      !expectedInputHashMatches || !activeLease || activeLease.id !== input.leaseId ||
      !leaseWorkspaceMatches ||
      (input.requirePersistedStageIntent && (!persistedStageIntent || persistedStageIntent.phase !== "staging" ||
        persistedStageIntent.executionInputHash !== executionInputHash || persistedStageIntent.leaseId !== input.leaseId)) ||
      !taskInput.success || taskInput.data.kind !== "task" || taskInput.data.issueId !== input.issueId || !taskSnapshot.success ||
      taskSnapshot.data.owner.kind !== "issue" || taskSnapshot.data.owner.companyId !== input.companyId ||
      taskSnapshot.data.owner.id !== input.issueId ||
      !request || request.reason !== "issue_commented" || request.requestedByActorType !== "user" ||
      request.requestedByActorId !== run.responsibleUserId || requestPayload.issueId !== input.issueId ||
      requestPayload.commentId !== context.wakeCommentId) return denied();
  // Keep the comment ID equality explicit outside the combined structural guard
  // so malformed source values cannot be coerced through a conditional.
  if (!commentInput.success || commentInput.data.kind !== "comment" || commentInput.data.issueId !== input.issueId ||
      commentInput.data.commentId !== context.wakeCommentId || requestPayload.commentId !== commentInput.data.commentId ||
      attachmentRefs.length !== 1 || attachmentRefs[0]?.commentId !== commentInput.data.commentId ||
      !commentSnapshot.success || commentSnapshot.data.owner.kind !== "comment" ||
      commentSnapshot.data.owner.companyId !== input.companyId || commentSnapshot.data.owner.id !== commentInput.data.commentId)
    return denied();
  const [comment] = await db.select({ id: issueComments.id }).from(issueComments).where(and(
    eq(issueComments.companyId, input.companyId), eq(issueComments.issueId, input.issueId),
    eq(issueComments.id, commentInput.data.commentId), isNull(issueComments.deletedAt),
  )).for("share").limit(1);
  if (!comment) return denied();
  const [row] = await db.select({ attachment: issueAttachments, asset: assets }).from(issueAttachments)
    .innerJoin(assets, and(eq(assets.companyId, issueAttachments.companyId), eq(assets.id, issueAttachments.assetId)))
    .where(and(eq(issueAttachments.companyId, input.companyId), eq(issueAttachments.issueId, input.issueId),
      eq(issueAttachments.id, input.operation.attachmentId))).for("share").limit(1);
  const snapshot = nativePayloadSourceSnapshotSchema.safeParse(row?.attachment.payloadSourceSnapshot);
  const reference = attachmentRefs[0]!;
  if (!row || !snapshot.success || row.attachment.payloadSourceSnapshotInvalidated ||
      row.attachment.issueCommentId !== commentInput.data.commentId || row.attachment.payloadSourceProtocolVersion !== 1 ||
      reference.byteSize !== row.asset.byteSize || typeof reference.filename !== "string" ||
      reference.contentType !== row.asset.contentType || snapshot.data.owner.kind !== "attachment" ||
      snapshot.data.owner.companyId !== input.companyId || snapshot.data.owner.id !== input.operation.attachmentId ||
      (input.requirePersistedStageIntent && (!persistedStageIntent || persistedStageIntent.sha256 !== row.asset.sha256 ||
        persistedStageIntent.byteSize !== row.asset.byteSize || persistedStageIntent.sourceSnapshotHash !== nativeSha256(snapshot.data) ||
        nativeSha256(persistedStageIntent.sourceBinding) !== nativeSha256({ kind: "attachment", issueId: input.issueId,
          attachmentId: row.attachment.id, commentId: row.attachment.issueCommentId, assetId: row.asset.id,
          sha256: row.asset.sha256, byteSize: row.asset.byteSize }))))
    return denied();
  const attachmentInput = nativePayloadSourceInputSchema.safeParse({ kind: "attachment", issueId: input.issueId,
    attachmentId: row.attachment.id, commentId: row.attachment.issueCommentId, assetId: row.asset.id,
    sha256: row.asset.sha256, byteSize: row.asset.byteSize, disposition: "delivered" });
  if (!attachmentInput.success || attachmentInput.data.kind !== "attachment" || (input.operation.phase === "commit" &&
      (input.operation.totalBytes !== row.asset.byteSize || input.operation.sha256 !== row.asset.sha256)) ||
      (input.operation.phase === "append" && input.operation.totalBytes !== row.asset.byteSize)) return denied();
  const actor = { type: "agent" as const, source: "none" as const, companyId: input.companyId,
    agentId: input.agentId, runId: input.runId, onBehalfOfUserId: run.responsibleUserId };
  await assertNativeTaskSourceOwnerCurrent(db, { companyId: input.companyId, actor: { type: "board", source: "session", userId: run.responsibleUserId }, source: taskInput.data });
  // This is a pre-dispatch source owner, before nativeInputSourceReceipt is
  // sealed. Reuse the exact Task, comment, and attachment current-owner checks;
  // the continuation-set API is intentionally reserved for receipt-bound prefixes.
  await assertNativePreDispatchTaskCommentAttachmentCurrent(db, { companyId: input.companyId,
    issueId: input.issueId, runId: input.runId, agentId: input.agentId,
    responsibleUserId: run.responsibleUserId, actor, taskSource: taskInput.data,
    commentSource: commentInput.data, commentSnapshot: commentSnapshot.data,
    attachmentSource: attachmentInput.data, attachmentSnapshot: snapshot.data });
  return { runId: input.runId, companyId: input.companyId, issueId: input.issueId, agentId: input.agentId,
    responsibleUserId: run.responsibleUserId, attachmentInput: attachmentInput.data, attachmentPolicy: snapshot.data.policy,
    attachmentSnapshot: snapshot.data as unknown as Record<string, unknown>,
    sourceHash: row.asset.sha256, byteSize: row.asset.byteSize, filename: reference.filename,
    contentType: row.asset.contentType, stageNonce: input.operation.stageNonce, executionInputHash };
}

/** Resolve a readback nonce only through its unique persisted staging intent,
 * then re-run the ordinary current source/lease owner against its committed
 * bytes. The verifier still proves the actual remote file and hash. */
export async function captureNativeRemoteAttachmentReadbackOwner(db: Db | Transaction, input: {
  companyId: string; issueId: string; runId: string; agentId: string; taskRoot: string; leaseId: string;
  operation: Extract<NativeRemoteAttachmentStageRelayOperation, { phase: "readback" }>;
}): Promise<Exclude<Awaited<ReturnType<typeof captureNativeRemoteAttachmentStageOwner>>, { cleanupOnly: true }> | null> {
  if (!uuid(input.companyId) || !uuid(input.issueId) || !uuid(input.runId) || !uuid(input.agentId) ||
      !uuid(input.leaseId) || input.operation.runId !== input.runId || !uuid(input.operation.stageNonce) ||
      !Number.isSafeInteger(input.operation.byteSize) || input.operation.byteSize < 1 ||
      !/^[a-f0-9]{64}$/.test(input.operation.sha256)) return null;
  const [run] = await db.select({ runnerProfileJson: heartbeatRuns.runnerProfileJson }).from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, input.runId), eq(heartbeatRuns.agentId, input.agentId),
    eq(heartbeatRuns.nativeIssueId, input.issueId), eq(heartbeatRuns.runtimeMode, "native"), eq(heartbeatRuns.status, "running"),
  )).for("share").limit(1);
  if (!run) return null;
  const profile = record(run.runnerProfileJson);
  let receipts: ReturnType<typeof readNativeAttachmentStageCleanupReceipts>;
  try { receipts = readNativeAttachmentStageCleanupReceipts(profile, input.runId, input.leaseId); }
  catch { return null; }
  const intents = Array.isArray(profile.nativeAttachmentStageIntents) ? profile.nativeAttachmentStageIntents.map(record) : [];
  const matches = intents.filter(intent => intent.stageNonce === input.operation.stageNonce && intent.phase === "staging");
  if (matches.length !== 1) return null;
  const intent = matches[0]!;
  if (intent.leaseId !== input.leaseId || intent.relativePath !== input.operation.relativePath ||
      intent.sha256 !== input.operation.sha256 || intent.byteSize !== input.operation.byteSize ||
      typeof intent.attachmentId !== "string" || !uuid(intent.attachmentId) ||
      typeof intent.executionInputHash !== "string" || !/^[a-f0-9]{64}$/.test(intent.executionInputHash) ||
      !receipts.some(receipt => receipt.stageNonce === input.operation.stageNonce &&
        receipt.attachmentId === intent.attachmentId && receipt.sha256 === input.operation.sha256 &&
        receipt.byteSize === input.operation.byteSize)) return null;
  const owner = await captureNativeRemoteAttachmentStageOwner(db, { companyId: input.companyId, issueId: input.issueId,
    runId: input.runId, agentId: input.agentId, taskRoot: input.taskRoot, leaseId: input.leaseId,
    expectedExecutionInputHash: intent.executionInputHash,
    requirePersistedStageIntent: true,
    operation: { phase: "commit", runId: input.runId, stageNonce: input.operation.stageNonce,
      attachmentId: intent.attachmentId, totalBytes: input.operation.byteSize, sha256: input.operation.sha256 } });
  if ("cleanupOnly" in owner || owner.sourceHash.toLowerCase() !== input.operation.sha256 ||
      owner.byteSize !== input.operation.byteSize || owner.executionInputHash !== intent.executionInputHash) return null;
  return owner;
}
