import { and, eq } from "drizzle-orm";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { companySecretBindings, connectionGrantMembers, connectionGrants, createDb, heartbeatRuns, issueComments, issues,
  toolApplications, toolConnections, toolInvocations } from "@paperclipai/db";
import { nativePayloadSourceInputSchema, nativePayloadSourceSnapshotSchema, unionNativePayloadSourceInputs } from "@paperclipai/shared";
import { randomUUID } from "node:crypto";
import { secretService } from "../secrets.js";
import { issueThreadInteractionService } from "../issue-thread-interactions.js";
import { assertNativeManagedConsumedSourceSetCurrent, assertNativeModelOutputCaptureCurrent,
  nativeManagedProgressCommentSourceSet } from "../native-direct-input.js";
import type { NativeConsumedSourceComponent, NativeModelOutputCapture, NativePayloadSourceSet } from "./native-execution-input.js";
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
  afterEach(() => vi.unstubAllGlobals());
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
    const wireIntents = Array.isArray(profile.nativeAwModelWireIntents)
      ? profile.nativeAwModelWireIntents as Array<Record<string, unknown>> : [];
    const historyIntent = wireIntents.find(intent => intent.modelPurpose === "conversation_model" &&
      Array.isArray(intent.responseToolUses) && (intent.responseToolUses as Array<Record<string, unknown>>)
        .some(use => use.id === historyCallId));
    expect(historyIntent).toBeDefined();
    const historyConsumed = historyIntent!.consumedSourceSet as NativePayloadSourceSet;
    const historyComponents = historyIntent!.consumedSourceComponents as NativeConsumedSourceComponent[];
    const consumedProgressMarkers = historyConsumed.inputs.filter(source => source.kind === "tool_result" &&
      source.callId === progressCallId && source.toolName === "report_progress");
    expect(consumedProgressMarkers).toHaveLength(1);
    await expect(assertNativeManagedConsumedSourceSetCurrent(db, { companyId, issueId: result.issueId, runId,
      actor: { type: "agent", source: "agent_jwt", companyId, agentId, runId,
        onBehalfOfUserId: storedRun!.responsibleUserId ?? undefined },
      components: historyComponents, sourceSet: historyConsumed })).resolves.toBeUndefined();
    const tamperedHistoryConsumed = { ...historyConsumed, inputs: historyConsumed.inputs.map(source =>
      source.kind === "tool_result" && source.callId === progressCallId
        ? { ...source, contentHash: "0".repeat(64) } : source) };
    await expect(assertNativeManagedConsumedSourceSetCurrent(db, { companyId, issueId: result.issueId, runId,
      actor: { type: "agent", source: "agent_jwt", companyId, agentId, runId,
        onBehalfOfUserId: storedRun!.responsibleUserId ?? undefined },
      components: historyComponents, sourceSet: tamperedHistoryConsumed })).rejects.toThrow();
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

  it("continues no-plan Conversation through current Human-authorized repository discovery", async () => {
    const binary = qualifiedOpenCodeBinary();
    if (!binary) throw new Error("qualified_opencode_binary_unavailable");
    const listCallId = `conversation-repositories-${Date.now()}`;
    let allowedRepositoryIds: string[] = [];
    let githubRequests = 0;
    const originalFetch = globalThis.fetch;
    const result = await runManagedNativeConversationFrame({ db, root, opencodeBinary: binary,
      conversationWorkMode: "standard", timeoutSec: 240,
      conversationPrompt: "Check which GitHub repositories I can use, then confirm their IDs.",
      prepareNativeRuntimeContext: async context => {
        if (!context.actor.userId) throw new Error("repository_fixture_current_human_missing");
        const secret = await secretService(context.db).create(context.companyId, {
          name: `Repository discovery ${randomUUID()}`, key: `github.discovery.${randomUUID()}`,
          provider: "local_encrypted", value: "managed-conversation-github-token",
        }, { userId: context.actor.userId });
        const [application] = await context.db.insert(toolApplications).values({ companyId: context.companyId,
          applicationKey: `repo-discovery-${randomUUID()}`, name: `Repository discovery ${randomUUID()}`,
          type: "mcp_http", status: "active" }).returning();
        const [connection] = await context.db.insert(toolConnections).values({ companyId: context.companyId,
          applicationId: application!.id, name: `Repository discovery ${randomUUID()}`, uid: `repo-discovery-${randomUUID()}`,
          transport: "mcp_remote", authKind: "api_key", credentialPolicy: "shared", status: "active", enabled: true,
          config: { sourceTemplateKey: "github" }, credentialRefs: [], credentialSecretRefs: [] }).returning();
        const credentialRef = { secretId: secret.id, configPath: "credentials.authorization", versionSelector: "latest" as const };
        const [grant] = await context.db.insert(connectionGrants).values({ companyId: context.companyId,
          connectionId: connection!.id, kind: "organization", credentialSecretRefs: [credentialRef], status: "active" }).returning();
        await context.db.insert(connectionGrantMembers).values({ companyId: context.companyId, grantId: grant!.id,
          subjectType: "user", subjectId: context.actor.userId });
        await context.db.insert(companySecretBindings).values({ companyId: context.companyId, secretId: secret.id,
          targetType: "tool_connection", targetId: connection!.id, configPath: credentialRef.configPath });
        vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
          if (String(input) === "https://api.github.com/user/repos?per_page=100&page=1") {
            githubRequests += 1;
            expect(new Headers(init?.headers).get("authorization")).toBe("Bearer managed-conversation-github-token");
            return Response.json([{ id: 88001, full_name: "paperclip/authorized-source", private: true }]);
          }
          return originalFetch(input, init);
        });
      },
      providerReply: ({ body, callIndex }) => {
        if (callIndex === 1) return { stop_reason: "tool_use", content: [{ type: "tool_use", id: listCallId,
          name: toolName(body, "list_project_repositories"), input: {} }] };
        if (callIndex === 2) {
          const block = toolResultBlock(body, listCallId);
          const listed = block ? toolResultJson(block) : null;
          allowedRepositoryIds = Array.isArray(listed?.repositories)
            ? (listed.repositories as Array<Record<string, unknown>>).map(repository => String(repository.id)) : [];
          if (!block || block.is_error === true || allowedRepositoryIds.join(",") !== "88001")
            throw new Error("managed_conversation_repository_result_not_resumed");
          return { stop_reason: "end_turn", content: [{ type: "text", text: "The current authorized repository is 88001." }] };
        }
        throw new Error(`managed_conversation_repository_unexpected_provider_call_${callIndex}`);
      },
    });
    expect(result.success, JSON.stringify({ runStatus: result.runStatus, providerCallCount: result.providerCallCount,
      providerStubFailure: result.providerStubFailure, providerHookFailure: result.providerHookFailure })).toBe(true);
    expect(result.providerCallCount).toBe(2);
    expect(allowedRepositoryIds).toEqual(["88001"]);
    expect(githubRequests).toBe(2); // initial listing plus the result owner's current-credential recheck
    expect(result.workerPlan).toBeNull();
    expect(result.workerAttempts).toHaveLength(0);
    expect(result.reservation).toMatchObject({ purpose: "conversation_model", status: "completed" });
    const [storedRun] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, result.run!.id));
    const profile = storedRun!.runnerProfileJson as Record<string, unknown>;
    const captures = Array.isArray(profile.nativeToolResultSourceCaptures)
      ? profile.nativeToolResultSourceCaptures as Array<Record<string, unknown>> : [];
    const capture = captures.find(value => value.managedOpenCode === true && value.tool === "list_project_repositories" &&
      value.callId === listCallId);
    expect(capture).toBeDefined();
    expect(capture!.outputCapture).toMatchObject({ runId: result.run!.id,
      dispatch: { kind: "conversation_model_dispatch", issueId: result.issueId, agentId: result.run!.agentId },
      managedOpenCodeToolUse: { callId: listCallId, toolName: "list_project_repositories" } });
    expect(capture!.source).toMatchObject({ kind: "tool_result", invocationId: null, callId: listCallId });
    const receipt = profile.nativeInputSourceReceipt as Record<string, unknown>;
    const additionalInputs = Array.isArray(receipt.additionalInputs) ? receipt.additionalInputs as Array<Record<string, unknown>> : [];
    const repositorySource = nativePayloadSourceInputSchema.parse(capture!.source);
    const outputCapture = capture!.outputCapture as unknown as NativeModelOutputCapture;
    const repositoryReadClosure = nativeManagedProgressCommentSourceSet(outputCapture);
    expect(additionalInputs).toContainEqual({ responsibleUserId: result.run!.responsibleUserId,
      policy: outputCapture.sourceSet.policy,
      inputs: unionNativePayloadSourceInputs([[repositorySource], repositoryReadClosure.inputs]) });
    expect((capture!.projectRepositories as Record<string, unknown>).result).toMatchObject({
      repositories: [{ id: "88001", fullName: "paperclip/authorized-source" }],
    });
    expect(JSON.stringify(capture)).not.toContain("managed-conversation-github-token");
    expect(await db.select().from(toolInvocations).where(and(eq(toolInvocations.companyId, result.run!.companyId),
      eq(toolInvocations.runId, result.run!.id), eq(toolInvocations.idempotencyKey,
        `aw-native-tool:${result.run!.id}:${listCallId}`)))).toEqual([]);
    expect(repositorySource.kind).toBe("tool_result");
    expect(repositorySource.kind === "tool_result" ? repositorySource.invocationId : undefined).toBeNull();
    const wireIntents = Array.isArray(profile.nativeAwModelWireIntents)
      ? profile.nativeAwModelWireIntents as Array<Record<string, unknown>> : [];
    const nextIntent = wireIntents.find(intent => intent.modelPurpose === "conversation_model" &&
      Array.isArray((intent.consumedSourceSet as NativePayloadSourceSet | undefined)?.inputs) &&
      ((intent.consumedSourceSet as Record<string, unknown>).inputs as Array<Record<string, unknown>>)
        .some(source => source.kind === "tool_result" && source.callId === listCallId));
    expect(nextIntent).toBeDefined();
    await expect(assertNativeManagedConsumedSourceSetCurrent(db, { companyId: result.run!.companyId,
      issueId: result.issueId, runId: result.run!.id,
      actor: { type: "agent", source: "agent_jwt", companyId: result.run!.companyId,
        agentId: result.run!.agentId, runId: result.run!.id,
        onBehalfOfUserId: result.run!.responsibleUserId ?? undefined },
      components: nextIntent!.consumedSourceComponents as NativeConsumedSourceComponent[],
      sourceSet: nextIntent!.consumedSourceSet as NativePayloadSourceSet })).resolves.toBeUndefined();
  }, 240_000);

  it("rejects a no-plan repository result after its accountable Human grant rotates", async () => {
    const binary = qualifiedOpenCodeBinary();
    if (!binary) throw new Error("qualified_opencode_binary_unavailable");
    const listCallId = `conversation-repositories-rotated-${Date.now()}`;
    let secretId: string | null = null;
    let grantId: string | null = null;
    let responsibleUserId: string | null = null;
    let ingressMutationObserved = false;
    let providerReceivedSecondRequest = false;
    const result = await runManagedNativeConversationFrame({ db, root, opencodeBinary: binary,
      conversationWorkMode: "standard", timeoutSec: 240,
      conversationPrompt: "Check which GitHub repositories I can use.",
      prepareNativeRuntimeContext: async context => {
        if (!context.actor.userId) throw new Error("repository_fixture_current_human_missing");
        responsibleUserId = context.actor.userId;
        const secrets = secretService(context.db);
        const firstSecret = await secrets.create(context.companyId, { name: `Repo rotation ${randomUUID()}`,
          key: `github.repo.initial.${randomUUID()}`, provider: "local_encrypted", value: "initial-fixture-token" },
          { userId: context.actor.userId });
        secretId = firstSecret.id;
        const [application] = await context.db.insert(toolApplications).values({ companyId: context.companyId,
          applicationKey: `repo-rotation-${randomUUID()}`, name: `Repository rotation ${randomUUID()}`,
          type: "mcp_http", status: "active" }).returning();
        const [connection] = await context.db.insert(toolConnections).values({ companyId: context.companyId,
          applicationId: application!.id, name: `Repository rotation ${randomUUID()}`, uid: `repo-rotation-${randomUUID()}`,
          transport: "mcp_remote", authKind: "api_key", credentialPolicy: "shared", status: "active", enabled: true,
          config: { sourceTemplateKey: "github" }, credentialRefs: [], credentialSecretRefs: [] }).returning();
        const firstRef = { secretId: firstSecret.id, configPath: "credentials.authorization", versionSelector: "latest" as const };
        const [grant] = await context.db.insert(connectionGrants).values({ companyId: context.companyId,
          connectionId: connection!.id, kind: "organization", credentialSecretRefs: [firstRef], status: "active" }).returning();
        grantId = grant!.id;
        await context.db.insert(connectionGrantMembers).values({ companyId: context.companyId, grantId: grant!.id,
          subjectType: "user", subjectId: context.actor.userId });
        await context.db.insert(companySecretBindings).values({ companyId: context.companyId,
          secretId: firstSecret.id, targetType: "tool_connection", targetId: connection!.id,
          configPath: firstRef.configPath });
        const originalFetch = globalThis.fetch;
        vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
          if (String(input) === "https://api.github.com/user/repos?per_page=100&page=1") {
            expect(new Headers(init?.headers).get("authorization")).toMatch(/^Bearer (initial|rotated)-fixture-token$/);
            return Response.json([{ id: 88002, full_name: "paperclip/rotatable-source", private: true }]);
          }
          return originalFetch(input, init);
        });
      },
      beforeManagedConversationModelRequest: async ({ db: fixtureDb, requestNumber }) => {
        if (requestNumber !== 2) return;
        if (!secretId || !grantId || !responsibleUserId) throw new Error("repository_rotation_owner_missing");
        const [grant] = await fixtureDb.select().from(connectionGrants).where(eq(connectionGrants.id, grantId));
        expect(grant?.credentialSecretRefs).toMatchObject([{ secretId, versionSelector: "latest" }]);
        await secretService(fixtureDb).rotate(secretId, { value: "rotated-fixture-token", expectedLatestVersion: 1 },
          { userId: responsibleUserId });
        ingressMutationObserved = true;
      },
      providerReply: ({ body, callIndex }) => {
        if (callIndex === 1) return { stop_reason: "tool_use", content: [{ type: "tool_use", id: listCallId,
          name: toolName(body, "list_project_repositories"), input: {} }] };
        providerReceivedSecondRequest = true;
        return { stop_reason: "end_turn", content: [{ type: "text", text: "This request must be rejected before the provider sees it." }] };
      },
    });
    expect(ingressMutationObserved).toBe(true);
    expect(providerReceivedSecondRequest).toBe(false);
    expect(result.success).toBe(false);
    expect(result.providerCallCount).toBe(1);
    expect(result.run?.id).toBeTruthy();
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

  it("validates a Human-resolved no-plan question marker through the shared consumed-source owner", async () => {
    const binary = qualifiedOpenCodeBinary();
    if (!binary) throw new Error("qualified_opencode_binary_unavailable");
    const questionCallId = `conversation-question-${Date.now()}`;
    let questionInteractionId: string | null = null;
    let questionToolResultSeen = false;
    const result = await runManagedNativeConversationFrame({ db, root, opencodeBinary: binary,
      conversationWorkMode: "standard", timeoutSec: 240,
      conversationPrompt: "Ask me one question, then answer briefly.",
      providerReply: ({ body, callIndex }) => {
        if (callIndex === 1) return { stop_reason: "tool_use", content: [{ type: "tool_use", id: questionCallId,
          name: toolName(body, "request_human_input"), input: { idempotencyKey: `conversation:${questionCallId}`,
            interactionKind: "questions", title: "Choose a color", prompt: "Which color should I use?",
            payload: { version: 1, questions: [{ id: "color", prompt: "Choose a color", selectionMode: "single",
              required: true, allowOther: false, options: [{ id: "blue", label: "Blue" }, { id: "amber", label: "Amber" }] }] },
            continuationPolicy: "none" } }] };
        if (callIndex === 2) {
          const questionBlock = toolResultBlock(body, questionCallId);
          const questionResult = questionBlock ? toolResultJson(questionBlock) : null;
          const interaction = questionResult && typeof questionResult.interaction === "object" && questionResult.interaction !== null
            ? questionResult.interaction as Record<string, unknown> : null;
          questionInteractionId = typeof interaction?.id === "string" ? interaction.id : null;
          questionToolResultSeen = Boolean(questionInteractionId && questionResult?.issueId);
          if (!questionToolResultSeen) throw new Error("managed_conversation_question_result_not_resumed");
          return { stop_reason: "end_turn", content: [{ type: "text", text: "I asked and recorded the answer." }] };
        }
        throw new Error(`managed_conversation_question_unexpected_provider_call_${callIndex}`);
      },
    });
    expect(result.success).toBe(true);
    expect(questionToolResultSeen).toBe(true);
    expect(result.workerPlan).toBeNull();
    const [storedRun] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, result.run!.id));
    const [conversation] = await db.select({ userId: issues.conversationUserId }).from(issues)
      .where(and(eq(issues.companyId, result.run!.companyId), eq(issues.id, result.issueId)));
    expect(conversation?.userId).toBeTruthy();
    const answered = await issueThreadInteractionService(db).answerQuestions({ id: result.issueId,
      companyId: result.run!.companyId }, questionInteractionId!, { answers: [{ questionId: "color", optionIds: ["blue"] }] },
      { userId: conversation!.userId! });
    expect(answered.status).toBe("answered");
    const profile = storedRun!.runnerProfileJson as Record<string, unknown>;
    const wireIntents = Array.isArray(profile.nativeAwModelWireIntents)
      ? profile.nativeAwModelWireIntents as Array<Record<string, unknown>> : [];
    const questionConsumedIntent = wireIntents.find(intent => intent.modelPurpose === "conversation_model" &&
      (intent.consumedSourceSet as NativePayloadSourceSet | undefined)?.inputs.some(source =>
        source.kind === "tool_result" && source.callId === questionCallId && source.toolName === "request_human_input"));
    expect(questionConsumedIntent).toBeDefined();
    const consumedSet = questionConsumedIntent!.consumedSourceSet as NativePayloadSourceSet;
    const consumedComponents = questionConsumedIntent!.consumedSourceComponents as NativeConsumedSourceComponent[];
    await expect(assertNativeManagedConsumedSourceSetCurrent(db, { companyId: result.run!.companyId,
      issueId: result.issueId, runId: result.run!.id,
      actor: { type: "agent", source: "agent_jwt", companyId: result.run!.companyId, agentId: result.run!.agentId,
        runId: result.run!.id, onBehalfOfUserId: conversation!.userId! },
      components: consumedComponents, sourceSet: consumedSet })).resolves.toBeUndefined();
  }, 240_000);

});
