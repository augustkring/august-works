import * as cloudIdentity from "../cloud-runtime-identity.js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  activityLog,
  authUsers,
  companyMemberships,
  agents,
  approvals,
  companies,
  completionContracts,
  contextManifests,
  contextManifestItems,
  createDb,
  documents,
  documentRevisions,
  heartbeatRuns,
  heartbeatRunEvents,
  nativeRunFinalizations,
  nativeRunResults,
  issueApprovals,
  issueComments,
  issueDocuments,
  issueThreadInteractions,
  issues,
  issuePrivacySources,
  statusDecisions,
  workAssessments,
} from "@paperclipai/db";
import { seedCurrentHumanSourceActor } from "../../__tests__/helpers/current-human-source-fixture.js";
import { startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { initializeRunIdentity, reserveSteeredIdentity, reconcileSteeredIdentity } from "../run-identity.js";
import { documentService } from "../documents.js";
import type { DocumentRevisionSourceCapture } from "../documents.js";
import { assertNativeDocumentRevisionCurrentSourceAccess } from "../native-direct-input.js";
import { issueService } from "../issues.js";
import type { NativeTaskSourceCapture } from "../issues.js";
import { issueThreadInteractionService } from "../issue-thread-interactions.js";
import { PaperclipRunnerToolAuthority } from "./paperclip-runner-tool-authority.js";
import type { NativeInputToolResultSource } from "./paperclip-runner-tool-authority.js";
import { nativeSha256 } from "./canonical.js";
import { assertNativeRunReadSourceHistoryQualified, recordNativeModelInputDispatchIntent, recordNativeModelInputDispatchAcknowledgement, recordNativeToolCallDispatchAssociation,
  recordNativeDocumentToolResultIntent, recordNativeInputToolResultIntent } from "./native-session-executor.js";
import { PROCESS_START_REQUESTED } from "../native-local-process-stop.js";
import { currentNativeControllerIdentity } from "./native-restart-recovery.js";
import { nativeRunInputSourceReceiptSchema } from "@paperclipai/shared";
import { createAssignedMcpTools } from "./assigned-mcp-tools.js";
import type { ToolGatewayService } from "../tool-gateway.js";
import { READ_CURRENT_WAKE_COMMENTS_TOOL_NAME } from "./current-wake-comments.js";
import { CAPABILITY_SEMANTIC_TOOL_CATALOG, runnerCodexDynamicToolsFit } from "../../vendor/paperclip-runner/index.js";
import { buildNativeExecutionInput, buildNativeBootstrapSourceSet } from "./native-execution-input.js";
import { buildNativeModelEnvelope } from "../../vendor/paperclip-runner/index.js";
import { nativeRuntimeContextFixture } from "./runtime-context.test-fixture.js";
import { getIssueExecutionContext, buildPaperclipTaskMarkdown } from "../heartbeat.js";
import { ensureNativeCompletionContract } from "./completion-contracts.js";
import { getNativeReviewAssignment } from "./native-review-participant.js";

describe("PaperclipRunnerToolAuthority", () => {
  let temporary: Awaited<
    ReturnType<typeof startEmbeddedPostgresTestDatabase>
  > | null = null;
  let db: ReturnType<typeof createDb>;
  const companyId = "00000000-0000-4000-8000-000000000101";
  const agentId = "00000000-0000-4000-8000-000000000102";
  const issueId = "00000000-0000-4000-8000-000000000103";
  const runId = "00000000-0000-4000-8000-000000000104";
  const userId = randomUUID();

  async function seedDocumentReader(payloadSourceProtocolVersion = 0) {
    const companyId = randomUUID(), agentId = randomUUID(), runId = randomUUID();
    let issueId: string = randomUUID();
    const issuePrefix = `RDR${companyId.slice(0, 4).toUpperCase()}`;
    await db.insert(companies).values({ id: companyId, name: "Document source reader", issuePrefix });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId,
      membershipRole: "admin", status: "active" });
    await db.insert(agents).values({ id: agentId, companyId, name: "Document source reader", adapterType: "paperclip_runner", status: "active" });
    const human = payloadSourceProtocolVersion === 1
      ? await seedCurrentHumanSourceActor(db, [companyId], userId) : null;
    if (human) {
      const task = await issueService(db).create(companyId, {
        title: "Read document source", status: "todo", workMode: "standard",
        assigneeAgentId: agentId, createdByUserId: userId, responsibleUserId: userId, visibility: "private",
      }, db, undefined, { manualInputActor: human, privacyActor: human, sourceAccessActor: human });
      expect(task.payloadSourceProtocolVersion).toBe(1);
      expect(task.payloadSourceSnapshot).not.toBeNull();
      expect(task.payloadSourceSnapshotInvalidated).toBe(false);
      issueId = task.id;
    } else {
      await db.insert(issues).values({ id: issueId, companyId, issueNumber: 1, identifier: `${issuePrefix}-1`,
        title: "Read document source", status: "in_progress", workMode: "standard", assigneeAgentId: agentId,
        responsibleUserId: userId, visibility: "private", payloadSourceProtocolVersion,
        payloadSourceSnapshot: null, payloadSourceSnapshotInvalidated: false });
    }
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, status: "running", runtimeMode: "native",
      nativeIssueId: issueId, responsibleUserId: userId, invocationSource: "assignment", triggerDetail: "system", contextSnapshot: { issueId } });
    await db.insert(contextManifests).values({ id: randomUUID(), companyId, runId, agentId, issueId,
      projectId: null, queryHash: "a".repeat(64), policySnapshotHash: "b".repeat(64), createdAt: new Date() });
    await db.update(issues).set({ status: "in_progress", executionRunId: runId }).where(eq(issues.id, issueId));
    return { companyId, agentId, issueId, runId, human,
      authority: new PaperclipRunnerToolAuthority(db, { companyId, agentId, issueId, runId }) };
  }

  async function seedDispatchBoundAuthority(payloadSourceProtocolVersion = 0) {
    const fixture = await seedDocumentReader(payloadSourceProtocolVersion);
    const controller = await currentNativeControllerIdentity();
    const leaseOwner = `tool-receipt-owner-${randomUUID()}`;
    const attempt = 3, eventSeq = 7;
    await db.insert(nativeRunFinalizations).values({
      runId: fixture.runId, companyId: fixture.companyId, issueId: fixture.issueId,
      phase: "running", attempt, leaseOwner, leaseExpiresAt: new Date(Date.now() + 60_000),
      controllerBootId: controller.bootId, controllerPid: controller.pid,
      controllerProcessStartedAt: controller.processStartedAt,
    });
    await db.insert(heartbeatRunEvents).values({ companyId: fixture.companyId, runId: fixture.runId,
      agentId: fixture.agentId, seq: eventSeq, eventType: PROCESS_START_REQUESTED,
      payload: { fixture: "actual native launch event" } });
    let qualifiedTurnInput: { message: { role: "user"; text: string }; requestedCollaborationMode: "default" | "plan" } | null = null;
    let bootstrapSourceClosure: { sourceSet: NonNullable<ReturnType<typeof buildNativeBootstrapSourceSet>>;
      taskEnvelopeDigest: string } | null = null;
    const prepareQualifiedDispatch = async () => {
      if (payloadSourceProtocolVersion !== 1 || qualifiedTurnInput) return;
      // Exercise the same fail-closed prompt-closure path that a managed
      // OpenCode run uses. This marker grants no prompt; recordNative... must
      // bind every actual turn to the source set before it can persist one.
      vi.stubEnv("PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS", "1");
      if (!fixture.human) throw new Error("dispatch_fixture_current_human_unavailable");
      const taskCaptureHolder: { value: NativeTaskSourceCapture | null } = { value: null };
      const task = await getIssueExecutionContext(db, fixture.companyId, fixture.issueId,
        capture => { taskCaptureHolder.value = capture; });
      const taskCapture = taskCaptureHolder.value;
      if (!task || !taskCapture?.payloadSourceSnapshot)
        throw new Error("dispatch_fixture_task_source_snapshot_unavailable");
      const references: Array<{ kind: "task" | "comment" | "document_revision" | "attachment" | "unknown"; id: string }> = [];
      const rendered = buildPaperclipTaskMarkdown({ issue: { id: fixture.issueId, identifier: task.identifier,
        title: task.title, description: task.description, workMode: task.workMode } },
      { onRenderedSource: source => references.push(source) });
      if (!rendered) throw new Error("dispatch_fixture_task_prompt_unavailable");
      const completion = await ensureNativeCompletionContract({ db, companyId: fixture.companyId,
        issue: { id: fixture.issueId, title: task.title, description: task.description }, actorId: fixture.agentId });
      await db.update(heartbeatRuns).set({ completionContractId: completion.row.id,
        completionContractSha256: completion.row.canonicalSha256 }).where(eq(heartbeatRuns.id, fixture.runId));
      await initializeRunIdentity(db, { companyId: fixture.companyId, runId: fixture.runId,
        issueId: fixture.issueId, responsibleUserId: userId, cause: "dispatch" });
      const workspace = { id: fixture.runId, cwd: "/native", repoUrl: null, repoRef: null, branchName: null };
      const execution = buildNativeExecutionInput({ companyId: fixture.companyId, runId: fixture.runId,
        agentId: fixture.agentId, issue: { id: fixture.issueId, identifier: task.identifier, title: task.title,
          description: task.description, workMode: task.workMode }, taskPrompt: rendered, workspace,
        normalizedSessionId: null, provider: "opencode", model: "openrouter/deepseek/deepseek-v4-flash-0731",
        completionContract: { id: completion.row.id, sha256: completion.row.canonicalSha256,
          schemaVersion: completion.row.schemaVersion, contract: completion.contract },
        runtimeContext: nativeRuntimeContextFixture() });
      const sourceSet = buildNativeBootstrapSourceSet({ companyId: fixture.companyId, runId: fixture.runId,
        agentId: fixture.agentId, issueId: fixture.issueId, renderedMarkdown: rendered,
        renderedMarkdownDigest: createHash("sha256").update(rendered, "utf8").digest("hex"), references,
        candidates: [{ kind: "task", id: fixture.issueId, input: taskCapture.input,
          payloadSourceSnapshot: taskCapture.payloadSourceSnapshot }], runtimeInputs: [], contextManifestIds: [],
        rolePackInputs: [], unsupportedInputPresent: false,
        additionalInputs: [{ kind: "completion_contract", issueId: fixture.issueId, contractId: completion.row.id,
          revision: String(completion.row.revision), contentHash: completion.row.canonicalSha256 },
        { kind: "workspace_metadata", runId: fixture.runId, executionWorkspaceId: fixture.runId, origin: "task_session",
          sourceVersion: `task-session:${fixture.runId}`, contentHash: createHash("sha256").update(JSON.stringify({
            cwd: workspace.cwd, repoUrl: workspace.repoUrl, repoRef: workspace.repoRef, branchName: workspace.branchName,
          }), "utf8").digest("hex") }] });
      if (!sourceSet) throw new Error("dispatch_fixture_bootstrap_source_set_unavailable");
      await db.update(heartbeatRuns).set({ runnerProfileJson: { nativeExecutionInput: execution,
        nativeOpenCodeSourceAuthority: { authorizedPromptHashes: [], promptSourceBindings: [] } } })
        .where(eq(heartbeatRuns.id, fixture.runId));
      qualifiedTurnInput = { message: { role: "user", text: JSON.stringify(buildNativeModelEnvelope(execution)) },
        requestedCollaborationMode: "default" };
      bootstrapSourceClosure = { sourceSet, taskEnvelopeDigest: nativeSha256(execution.task) };
    };
    const bindCall = async (tool: string, callId: string, turnId: string, expectAssociation = true,
      argumentsHash?: string, requestedCollaborationMode?: "default" | "plan") => {
      await prepareQualifiedDispatch();
      const turnInput = qualifiedTurnInput
        ? { ...qualifiedTurnInput, ...(requestedCollaborationMode ? { requestedCollaborationMode } : {}) }
        : { message: { role: "user" as const, text: `actual native input ${turnId}` },
            ...(requestedCollaborationMode ? { requestedCollaborationMode } : {}) };
      const binding = { db, runId: fixture.runId, companyId: fixture.companyId, issueId: fixture.issueId,
        agentId: fixture.agentId, leaseOwner, attempt, controller, eventSeq };
      const dispatchId = await recordNativeModelInputDispatchIntent({ ...binding, turnInput,
        ...(bootstrapSourceClosure ? { bootstrapSourceClosure } : {}) });
      await recordNativeModelInputDispatchAcknowledgement({ ...binding, dispatchId, turnInput, turnId,
        ...(bootstrapSourceClosure ? { sourceClosure: bootstrapSourceClosure } : {}) });
      const associationRecorded = await recordNativeToolCallDispatchAssociation({ ...binding, turnId, callId, tool, argumentsHash });
      if (expectAssociation) expect(associationRecorded).toBe(true);
      return { tool, callId, turnId, dispatchId, eventSeq, attempt };
    };
    return { ...fixture, bindCall, prepareQualifiedDispatch, bootstrapSourceClosure: () => bootstrapSourceClosure,
      documentCaptureBinding: { db, runId: fixture.runId, companyId: fixture.companyId,
      issueId: fixture.issueId, agentId: fixture.agentId, leaseOwner, attempt, controller, eventSeq } };
  }

  beforeEach(() => {
    vi.stubEnv("PAPERCLIP_RUNNER_API_TOOLS_ENABLED", undefined);
    vi.stubEnv("PAPERCLIP_RUNNER_API_TOOLS_COMPANY_IDS", undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase(
      "paperclip-runner-tools-",
    );
    db = createDb(temporary.connectionString);
    await db.insert(companies).values({
      id: companyId,
      name: "Runner tools",
      issuePrefix: "RNT",
      issueCounter: 1,
    });
    await db.insert(authUsers).values({ id: userId, name: "Actual tool Human", email: `${userId}@test.invalid`,
      createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId,
      membershipRole: "admin", status: "active" });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Runner agent",
      adapterType: "paperclip_runner",
      adapterConfig: { provider: "codex", apiKey: "must-not-leak" },
      runtimeConfig: { token: "must-not-leak" },
      status: "active",
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      issueNumber: 1,
      identifier: "RNT-1",
      title: "Exercise real runner tools",
      status: "in_progress",
      workMode: "standard",
      assigneeAgentId: agentId,
    });
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      responsibleUserId: userId,
      status: "running",
      runtimeMode: "native",
      nativeIssueId: issueId,
      invocationSource: "assignment",
      triggerDetail: "system",
      contextSnapshot: { issueId },
    });
    await db
      .update(issues)
      .set({ executionRunId: runId })
      .where(eq(issues.id, issueId));
  });

  afterAll(async () => {
    await temporary?.cleanup();
  });

  it("retains a Human-only backlog proposal through Native tool replay without granting Agent approval", async () => {
    const binding = { companyId: randomUUID(), agentId: randomUUID(), issueId: randomUUID(), runId: randomUUID() };
    await db.insert(companies).values({ id: binding.companyId, name: "Task proposal", issuePrefix: "TPR" });
    await db.insert(agents).values({ id: binding.agentId, companyId: binding.companyId, name: "Proposer", status: "active", adapterType: "paperclip_runner" });
    await db.insert(issues).values({ id: binding.issueId, companyId: binding.companyId, title: "Original scope", status: "in_progress", assigneeAgentId: binding.agentId });
    await db.insert(heartbeatRuns).values({ id: binding.runId, companyId: binding.companyId, agentId: binding.agentId,
      status: "running", runtimeMode: "native", nativeIssueId: binding.issueId, invocationSource: "assignment", triggerDetail: "system" });
    await db.update(issues).set({ executionRunId: binding.runId }).where(eq(issues.id, binding.issueId));
    const authority = new PaperclipRunnerToolAuthority(db, binding);
    const definition = authority.definitions().find(tool => tool.name === "request_human_input")!;
    expect((definition.inputSchema as { properties: { resolverPolicy: unknown } }).properties.resolverPolicy)
      .toMatchObject({ enum: ["human_only"] });
    const args = { idempotencyKey: "one-reviewed-proposal", interactionKind: "suggest_tasks", title: "Review one internal task",
      prompt: "Create this unassigned backlog task?", continuationPolicy: "none", resolverPolicy: "human_only",
      payload: { version: 1, tasks: [{ clientKey: "one", title: "A bounded follow-up", description: "Only the original scope", status: "backlog" }] } };
    for (const resolverPolicy of ["anyone", "board_only", null])
      await expect(authority.execute({ tool: "request_human_input", callId: randomUUID(), arguments: { ...args, resolverPolicy } }))
        .rejects.toThrow("paperclip_runner_interaction_resolver_policy_invalid");
    const first = await authority.execute({ tool: "request_human_input", callId: "proposal", arguments: args }) as { interaction: { id: string } };
    await expect(authority.execute({ tool: "request_human_input", callId: "proposal-replay", arguments: args })).resolves.toEqual(first);
    expect(await db.select().from(issues).where(eq(issues.companyId, binding.companyId))).toHaveLength(1);
    const service = issueThreadInteractionService(db);
    const issue = { id: binding.issueId, companyId: binding.companyId, projectId: null, goalId: null };
    await expect(service.acceptInteraction(issue, first.interaction.id, {}, { agentId: binding.agentId,
      runId: binding.runId, suggestedTaskEffectsAuthorized: true })).rejects.toThrow();
    expect((await service.getById(first.interaction.id))?.status).toBe("pending");
    const accepted = await service.acceptInteraction(issue, first.interaction.id, {}, { userId: "local-board" });
    expect(accepted.createdIssues).toEqual([expect.objectContaining({ status: "backlog", assigneeAgentId: null })]);
    const [created] = await db.select().from(issues).where(eq(issues.id, accepted.createdIssues[0]!.id));
    expect(created).toMatchObject({ companyId: binding.companyId, parentId: binding.issueId, originRunId: binding.runId,
      createdByUserId: "local-board", createdByAgentId: null, assigneeAgentId: null, assigneeUserId: null, status: "backlog" });
  });

  it("advertises only real bindings and reads the bound task", async () => {
    const authority = new PaperclipRunnerToolAuthority(db, {
      companyId,
      agentId,
      issueId,
      runId,
    });
    expect(authority.definitions()).toHaveLength(32);
    const questions = authority.definitions().find(tool => tool.name === "request_human_input")!;
    expect(questions.description).toContain("ask only the next unanswered question");
    expect(questions.description).toContain("Never infer answers");
    expect(questions.description).toContain("Do not fabricate answer links");
    expect(JSON.stringify(questions.inputSchema)).toContain("at least two distinct meaningful options");
    expect(JSON.stringify(questions.inputSchema)).toContain("answerMode:'text'");

    expect(authority.definitions().map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "connections_search",
        "connection_request", "create_project", "list_project_repositories", "list_projects",
        "search_api", "call_api", "hire_agent",
        "get_task_context",
        "get_task_history",
        "search_tasks",
        "report_progress",
        "update_task",
        "propose_completion",
        "request_human_input",
        "create_task",
        "set_dependencies",
        "list_documents",
        "read_document",
        "list_document_revisions",
        "write_document",
        "create_skill",
        "list_agents",
        "get_agent",
        "list_approvals",
        "get_approval",
        "get_approval_context",
        READ_CURRENT_WAKE_COMMENTS_TOOL_NAME,
        "list_chat_attachments",
        "reuse_chat_attachment",
        "read_chat_attachment",
      ]),
    );
    const context = await authority.execute({
      tool: "get_task_context",
      callId: "context",
      arguments: {},
    });
    expect(context).toMatchObject({
      activeTask: { id: issueId, identifier: "RNT-1" },
      actor: { id: agentId },
    });
    expect(JSON.stringify(context)).not.toContain("must-not-leak");
    await expect(
      authority.execute({
        tool: "finish_task",
        callId: "hidden",
        arguments: {},
      }),
    ).rejects.toThrow("paperclip_runner_tool_not_advertised");
    await expect(
      authority.execute({
        tool: "list_chat_attachments",
        callId: "historical-list-without-chat-binding",
        arguments: {},
      }),
    ).rejects.toThrow("paperclip_runner_chat_attachment_binding_denied");
    await expect(
      authority.execute({
        tool: READ_CURRENT_WAKE_COMMENTS_TOOL_NAME,
        callId: "reader-without-bound-wake",
        arguments: {},
      }),
    ).rejects.toThrow("paperclip_runner_tool_not_advertised");
  });

  it("captures the exact read_document revision and digest of the returned result", async () => {
    const fixture = await seedDocumentReader();
    const key = `source-${randomUUID()}`;
    const body = "Exact document bytes delivered by read_document.";
    const created = await documentService(db).upsertIssueDocument({
      issueId: fixture.issueId, key, title: "Read source", format: "markdown", body,
    });
    const captures: Array<{
      callId: string;
      tool: "read_document";
      resultDigest: string;
      source: DocumentRevisionSourceCapture | null;
    }> = [];
    const result = await fixture.authority.execute({ tool: "read_document", callId: "read-exact-source", arguments: { key } }, {
      onDocumentRead: async capture => { captures.push(capture); },
    }) as { document: { id: string; latestRevisionId: string; body: string } };
    expect(result.document).toMatchObject({ id: created.document.id, latestRevisionId: created.document.latestRevisionId, body });
    expect(captures).toHaveLength(1);
    expect(captures[0]).toMatchObject({ callId: "read-exact-source", tool: "read_document",
      resultDigest: createHash("sha256").update(JSON.stringify(result)).digest("hex"),
      source: { input: { kind: "document_revision", documentId: created.document.id,
        revisionId: created.document.latestRevisionId, issueId: fixture.issueId,
        contentHash: createHash("sha256").update(body, "utf8").digest("hex") }, payloadSourceSnapshot: null } });
    await fixture.authority.execute({ tool: "get_task_context", callId: "non-document-read", arguments: {} }, {
      onDocumentRead: async capture => { captures.push(capture); },
    });
    expect(captures).toHaveLength(1);
  });

  it("qualifies a pure task-context read from its exact retained Task owner", async () => {
    const fixture = await seedDocumentReader(1);
    const captures: NativeInputToolResultSource[] = [];
    const result = await fixture.authority.execute({ tool: "get_task_context", callId: "task-context-pure",
      arguments: {} }, { onNativeInputToolResult: async capture => { captures.push(capture); } });
    expect(result).toMatchObject({ activeTask: { id: fixture.issueId } });
    expect(captures).toHaveLength(1);
    expect(captures[0]).toMatchObject({ sourceSet: { policy: { issueIds: [fixture.issueId] },
      inputs: [expect.objectContaining({ kind: "task", issueId: fixture.issueId })] },
      observedSourceInputs: [expect.objectContaining({ kind: "task", issueId: fixture.issueId })] });
  });

  it("binds an accepted-plan task-context result to its exact revision and accepted interaction", async () => {
    const fixture = await seedDocumentReader(1);
    const plan = await documentService(db).upsertIssueDocument({ issueId: fixture.issueId, key: "plan",
      title: "Owned source plan", format: "markdown", body: "This exact approved plan is part of task context.",
      createdByUserId: userId, manualInputActor: fixture.human! });
    const interactionId = randomUUID();
    await db.insert(issueThreadInteractions).values({ id: interactionId, companyId: fixture.companyId,
      issueId: fixture.issueId, kind: "request_confirmation", status: "accepted", resolvedByUserId: userId,
      resolvedAt: new Date(), payload: { version: 1, prompt: "Approved exact plan",
        target: { type: "issue_document", issueId: fixture.issueId, documentId: plan.document.id, key: "plan",
          revisionId: plan.document.latestRevisionId, revisionNumber: plan.document.latestRevisionNumber } },
      result: { version: 1, outcome: "accepted" } });
    await db.update(heartbeatRuns).set({ contextSnapshot: { issueId: fixture.issueId,
      planReviewInteraction: { acceptedTargetRevision: { issueId: fixture.issueId,
        documentId: plan.document.id, key: "plan", revisionId: plan.document.latestRevisionId,
        revisionNumber: plan.document.latestRevisionNumber } } } }).where(eq(heartbeatRuns.id, fixture.runId));
    const captures: NativeInputToolResultSource[] = [];
    const result = await fixture.authority.execute({ tool: "get_task_context", callId: "task-context-plan",
      arguments: {} }, { onNativeInputToolResult: async capture => { captures.push(capture); } });
    expect(result).toMatchObject({ acceptedPlan: { revisionId: plan.document.latestRevisionId,
      markdown: "This exact approved plan is part of task context." } });
    expect(captures).toHaveLength(1);
    expect(captures[0]!.sourceSet?.inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "task", issueId: fixture.issueId }),
      expect.objectContaining({ kind: "document_revision", revisionId: plan.document.latestRevisionId,
        issueId: fixture.issueId }),
      expect.objectContaining({ kind: "interaction", interactionId, issueId: fixture.issueId }),
    ]));
  });

  it("captures actual get_task_history comments but leaves missing retained roots unknown", async () => {
    const fixture = await seedDocumentReader();
    const [comment] = await db.insert(issueComments).values({ companyId: fixture.companyId,
      issueId: fixture.issueId, body: "A real retained history body", authorUserId: userId }).returning();
    const captures: Array<{
      turnId: string | null; callId: string; tool: string; resultDigest: string;
      sourceSet: { policy: unknown; inputs: unknown[] } | null; observedSourceInputs: unknown[];
    }> = [];
    const result = await fixture.authority.execute({ tool: "get_task_history", callId: "history-read-real",
      arguments: {} }, { nativeToolCallIdentity: { tool: "get_task_history", callId: "history-read-real", turnId: "history-turn" },
      onNativeInputToolResult: async capture => { captures.push(capture); } }) as { comments: Array<{ id: string; body: string }> };
    expect(result.comments).toEqual([expect.objectContaining({ id: comment!.id, body: "A real retained history body" })]);
    expect(captures).toHaveLength(1);
    expect(captures[0]).toMatchObject({ turnId: "history-turn", callId: "history-read-real", tool: "get_task_history",
      resultDigest: nativeSha256(result), sourceSet: null,
      observedSourceInputs: [expect.objectContaining({ kind: "comment", issueId: fixture.issueId,
        commentId: comment!.id, contentHash: nativeSha256({ body: "A real retained history body", presentation: null, metadata: null }) })] });
    await db.update(issueComments).set({ body: "Changed after capture", updatedAt: new Date(Date.now() + 1_000) })
      .where(eq(issueComments.id, comment!.id));
    const [changed] = await db.select({ sourceVersion: sql<string>`extract(epoch from ${issueComments.updatedAt})::text` })
      .from(issueComments).where(eq(issueComments.id, comment!.id));
    expect(changed!.sourceVersion).not.toBe(captures[0]!.observedSourceInputs[0] &&
      (captures[0]!.observedSourceInputs[0] as { sourceVersion?: string }).sourceVersion);
  });

  it("marks only an actually empty bounded task-history read as a complete source-free result", async () => {
    const fixture = await seedDocumentReader();
    const captures: Array<{ sourceSet: { policy: { issueIds: string[] }; inputs: unknown[] } | null;
      resultDigest: string }> = [];
    const result = await fixture.authority.execute({ tool: "get_task_history", callId: "empty-history-read", arguments: {} }, {
      nativeToolCallIdentity: { tool: "get_task_history", callId: "empty-history-read", turnId: "empty-history-turn" },
      onNativeInputToolResult: async capture => { captures.push(capture); },
    });
    expect(result).toEqual({ comments: [] });
    expect(captures).toEqual([{ turnId: "empty-history-turn", callId: "empty-history-read",
      tool: "get_task_history", argumentsHash: nativeSha256({}), result,
      sourceSet: { policy: { issueIds: [fixture.issueId], projectIds: [], runIds: [],
        memoryIds: [], foundationRevisionIds: [] }, inputs: [] },
      observedSourceInputs: [], resultDigest: nativeSha256(result) }]);
  });

  it("persists a complete Native history read only against its acknowledged dispatch and exact result bytes", async () => {
    const fixture = await seedDispatchBoundAuthority(1);
    const args = {}, argumentsHash = nativeSha256(args);
    const call = await fixture.bindCall("get_task_history", "native-empty-history", "native-empty-history-turn", true, argumentsHash);
    const [runBefore] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, fixture.runId));
    expect(runBefore?.nativeInputSourceProtocolVersion).toBe(1);
    expect(runBefore?.runnerProfileJson).toHaveProperty("nativeInputSourceReceipt");
    let captured: Parameters<typeof recordNativeInputToolResultIntent>[0]["capture"] | null = null;
    const result = await fixture.authority.execute({ tool: call.tool, callId: call.callId, arguments: args }, {
      nativeToolCallIdentity: call,
      onNativeInputToolResult: async capture => {
        captured = capture;
        await recordNativeInputToolResultIntent({ ...fixture.documentCaptureBinding, capture });
      },
    });
    expect(result).toEqual({ comments: [] });
    expect(captured).toMatchObject({ turnId: call.turnId, callId: call.callId, tool: call.tool,
      argumentsHash, resultDigest: nativeSha256(result), sourceSet: { policy: {
        issueIds: [fixture.issueId], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [],
      }, inputs: [] } });
    const [stored] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, fixture.runId));
    const profile = stored!.runnerProfileJson!;
    expect(profile.nativeToolResultSourceCaptures).toEqual([expect.objectContaining({
      callId: call.callId, turnId: call.turnId, tool: call.tool, argumentsHash,
      resultDigest: nativeSha256(result), nativeReadResult: true,
      source: { kind: "tool_result", runId: fixture.runId, callId: call.callId,
        toolName: call.tool, invocationId: null, contentHash: nativeSha256(result) },
    })]);
    const updatedReceipt = nativeRunInputSourceReceiptSchema.parse(profile.nativeInputSourceReceipt);
    expect(updatedReceipt.additionalInputs).toContainEqual({ responsibleUserId: runBefore!.responsibleUserId,
      policy: captured!.sourceSet!.policy, inputs: [expect.objectContaining({ kind: "tool_result", callId: call.callId,
        invocationId: null }),] });
    const forged = { ...captured!, result: { comments: [{ id: "forged", body: "not returned" }] } };
    await expect(recordNativeInputToolResultIntent({ ...fixture.documentCaptureBinding, capture: forged }))
      .rejects.toThrow("native_tool_result_capture_binding_invalid");
  });

  it("keeps assigned-review context unknown and prevents a later read from repairing its output history", async () => {
    const fixture = await seedDispatchBoundAuthority(1);
    const sourceAgentId = randomUUID(), sourceRunId = randomUUID(), contractId = randomUUID();
    const resultId = randomUUID(), assessmentId = randomUUID(), decisionId = randomUUID(), interactionId = randomUUID();
    await db.insert(agents).values({ id: sourceAgentId, companyId: fixture.companyId, name: "Assigned worker",
      adapterType: "paperclip_runner", status: "active" });
    await db.insert(completionContracts).values({ id: contractId, companyId: fixture.companyId, issueId: fixture.issueId,
      revision: 1, schemaVersion: "paperclip.completion-contract.v1", policyVersion: "test-context-review",
      risk: "standard", completionAuthority: "server_arbiter", incompleteCriteriaPolicy: "preserve_non_terminal",
      contractJson: {}, canonicalSha256: randomUUID().replaceAll("-", "").padEnd(64, "a").slice(0, 64),
      createdByActorType: "system", createdByActorId: "context-test" });
    await db.insert(heartbeatRuns).values({ id: sourceRunId, companyId: fixture.companyId, agentId: sourceAgentId,
      status: "succeeded", runtimeMode: "native", nativeIssueId: fixture.issueId,
      completionContractId: contractId, completionContractSha256: "c".repeat(64) });
    await db.insert(nativeRunResults).values({ id: resultId, companyId: fixture.companyId, issueId: fixture.issueId,
      runId: sourceRunId, completionContractId: contractId, serverFingerprint: `context-review-${resultId}`,
      schemaStatus: "accepted", resultJson: {}, canonicalSha256: "d".repeat(64) });
    await db.insert(workAssessments).values({ id: assessmentId, companyId: fixture.companyId, issueId: fixture.issueId,
      runId: sourceRunId, contractId, resultId, triggerKind: "turn_finished", triggerActorCompanyId: fixture.companyId,
      priorIssueStatus: "in_progress", priorStatusVersion: 0, policyVersion: "test-context-review",
      assessmentJson: {}, inputDigest: "e".repeat(64) });
    await db.insert(statusDecisions).values({ id: decisionId, companyId: fixture.companyId, issueId: fixture.issueId,
      runId: sourceRunId, assessmentId, decisionVersion: 1, policyVersion: "test-context-review",
      fromStatus: "in_review", toStatus: "in_review", reasonCode: "review_required",
      decisionJson: { projectedStatusVersion: 1 }, decisionDigest: "f".repeat(64), applicationState: "applied" });
    await db.update(issues).set({ status: "in_review", statusVersion: 1, lastStatusDecisionId: decisionId,
      assigneeAgentId: sourceAgentId }).where(eq(issues.id, fixture.issueId));
    const [reviewTaskAfterTransition] = await db.select({ statusVersion: issues.statusVersion })
      .from(issues).where(and(eq(issues.companyId, fixture.companyId), eq(issues.id, fixture.issueId)));
    if (!reviewTaskAfterTransition) throw new Error("assigned_review_task_projection_missing");
    await db.update(statusDecisions).set({ decisionJson: { projectedStatusVersion: reviewTaskAfterTransition.statusVersion } })
      .where(and(eq(statusDecisions.companyId, fixture.companyId), eq(statusDecisions.id, decisionId)));
    await db.insert(issueThreadInteractions).values({ id: interactionId, companyId: fixture.companyId,
      issueId: fixture.issueId, kind: "request_confirmation", status: "pending", sourceRunId,
      addresseeAgentId: fixture.agentId, payload: { version: 1, prompt: "Review the work",
        target: { type: "custom", key: "native_completion_review", revisionId: decisionId } } });
    await db.update(heartbeatRuns).set({ contextSnapshot: { issueId: fixture.issueId,
      nativeReviewInteractionId: interactionId, nativeReviewDecisionId: decisionId,
      sourceRunId, revisionId: decisionId } }).where(eq(heartbeatRuns.id, fixture.runId));
    await fixture.prepareQualifiedDispatch();
    const preparedClosure = fixture.bootstrapSourceClosure();
    expect(preparedClosure?.sourceSet.inputs.filter(value => value.kind === "workspace_metadata"))
      .toEqual([expect.objectContaining({ runId: fixture.runId, origin: "task_session",
        executionWorkspaceId: fixture.runId, sourceVersion: `task-session:${fixture.runId}` })]);
    const [reviewTaskOwner] = await db.select({ assigneeAgentId: issues.assigneeAgentId,
      executionRunId: issues.executionRunId, projectId: issues.projectId,
      executionWorkspaceId: issues.executionWorkspaceId, status: issues.status,
      statusVersion: issues.statusVersion, lastStatusDecisionId: issues.lastStatusDecisionId })
      .from(issues).where(and(eq(issues.companyId, fixture.companyId), eq(issues.id, fixture.issueId)));
    expect(reviewTaskOwner).toMatchObject({ assigneeAgentId: sourceAgentId, executionRunId: fixture.runId,
      projectId: null, executionWorkspaceId: null, status: "in_review",
      statusVersion: reviewTaskAfterTransition.statusVersion,
      lastStatusDecisionId: decisionId });
    await expect(getNativeReviewAssignment(db, { companyId: fixture.companyId, issueId: fixture.issueId,
      agentId: fixture.agentId, contextSnapshot: { issueId: fixture.issueId,
        nativeReviewInteractionId: interactionId, nativeReviewDecisionId: decisionId,
        sourceRunId, revisionId: decisionId }, actingRunId: fixture.runId,
      issueExecutionRunId: fixture.runId })).resolves.toMatchObject({ interaction: { id: interactionId },
        sourceRun: { id: sourceRunId, agentId: sourceAgentId } });
    const nativeReview = { nativeReviewInteractionId: interactionId, nativeReviewDecisionId: decisionId };
    const authority = new PaperclipRunnerToolAuthority(db, { companyId: fixture.companyId, agentId: fixture.agentId,
      issueId: fixture.issueId, runId: fixture.runId, nativeReview });
    const contextArgs = {}, contextCallId = "assigned-review-context", contextTurnId = "assigned-review-turn";
    const contextCall = await fixture.bindCall("get_task_context", contextCallId, contextTurnId, true, nativeSha256(contextArgs));
    const historyArgs = {}, historyCallId = "later-empty-history", historyTurnId = "later-history-turn";
    // A real second provider request may repeat the same source envelope while
    // choosing a different supported collaboration mode. Keep its source bytes
    // exact but give the acknowledged dispatch a distinct full-input digest.
    const historyCall = await fixture.bindCall("get_task_history", historyCallId, historyTurnId, true,
      nativeSha256(historyArgs), "plan");

    const [runBefore] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, fixture.runId));
    expect(runBefore?.nativeInputSourceProtocolVersion).toBe(1);
    expect(runBefore?.runnerProfileJson).toHaveProperty("nativeInputSourceReceipt");
    let contextCapture: Parameters<typeof recordNativeInputToolResultIntent>[0]["capture"] | null = null;
    const contextResult = await authority.execute({ tool: "get_task_context", callId: contextCallId, arguments: contextArgs }, {
      nativeToolCallIdentity: contextCall, onNativeInputToolResult: async capture => {
        contextCapture = capture;
        await recordNativeInputToolResultIntent({ ...fixture.documentCaptureBinding, capture });
      },
    });
    expect(contextResult).toMatchObject({ assignedReview: { id: interactionId, status: "pending" } });
    expect(contextCapture).toMatchObject({ sourceSet: null, tool: "get_task_context",
      observedSourceInputs: [expect.objectContaining({ kind: "task", issueId: fixture.issueId })] });

    const historyResult = await authority.execute({ tool: "get_task_history", callId: historyCallId, arguments: historyArgs }, {
      nativeToolCallIdentity: historyCall, onNativeInputToolResult: async capture => {
        await recordNativeInputToolResultIntent({ ...fixture.documentCaptureBinding, capture });
      },
    });
    expect(historyResult).toEqual({ comments: [] });
    const [stored] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, fixture.runId));
    expect(() => assertNativeRunReadSourceHistoryQualified(stored!.runnerProfileJson as Record<string, unknown>, {
      runId: fixture.runId, responsibleUserId: userId,
    })).toThrow("native_read_result_source_history_unavailable");
  });

  it("does not let a legacy document revision bypass its parent Task privacy check", async () => {
    const fixture = await seedDocumentReader();
    const created = await documentService(db).upsertIssueDocument({ issueId: fixture.issueId,
      key: `legacy-private-${randomUUID()}`, title: "Legacy private parent", format: "markdown", body: "Private body" });
    await expect(assertNativeDocumentRevisionCurrentSourceAccess(db, {
      companyId: fixture.companyId, issueId: fixture.issueId, revisionId: created.document.latestRevisionId,
      actor: { type: "none", source: "none" },
    })).rejects.toThrow();
  });

  it("rechecks a protocol-v1 document parent reader after its revision row wait", async () => {
    const fixture = await seedDocumentReader(1);
    await db.update(companyMemberships).set({ membershipRole: "member" }).where(and(
      eq(companyMemberships.companyId, fixture.companyId), eq(companyMemberships.principalId, userId)));
    const documentKey = `v1-parent-acl-${randomUUID()}`;
    const created = await documentService(db).upsertIssueDocument({ issueId: fixture.issueId,
      key: documentKey, title: "Frozen document source", format: "markdown", body: "Exact body",
      createdByUserId: userId, manualInputActor: fixture.human! });
    const documentId = created.document.id, revisionId = created.document.latestRevisionId;
    if (!revisionId) throw new Error("Canonical Human document revision is unavailable");
    const actor = fixture.human!;
    const read = () => assertNativeDocumentRevisionCurrentSourceAccess(db, { companyId: fixture.companyId,
      issueId: fixture.issueId, revisionId, actor });
    await expect(read()).resolves.toBeUndefined();

    let releaseLock!: () => void;
    let announceLock!: (pid: number) => void;
    const release = new Promise<void>(resolve => { releaseLock = resolve; });
    const locked = new Promise<number>(resolve => { announceLock = resolve; });
    const lockHolder = db.transaction(async tx => {
      const [backend] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      await tx.execute(sql`select id from document_revisions where company_id=${fixture.companyId}::uuid
        and id=${revisionId}::uuid for update`);
      announceLock(backend!.pid);
      await release;
    });
    const holderPid = await locked;
    const pendingRead = read();
    let observedWait = false;
    for (let attempt = 0; attempt < 100 && !observedWait; attempt++) {
      const [row] = await db.execute<{ waiting: boolean }>(sql`select exists(
        select 1 from pg_stat_activity a where ${holderPid}=any(pg_blocking_pids(a.pid))
          and a.wait_event_type='Lock') as waiting`);
      observedWait = row?.waiting === true;
      if (!observedWait) await new Promise(resolve => setTimeout(resolve, 10));
    }
    try {
      expect(observedWait, "the exact document source reader must wait on the pinned revision row").toBe(true);
      // Revoke actual current company access. Changing the responsible Human
      // alone does not revoke this independent Human author's retained rights.
      await db.delete(companyMemberships).where(and(eq(companyMemberships.companyId, fixture.companyId),
        eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, userId)));
    } finally {
      releaseLock();
      await lockHolder;
    }
    await expect(pendingRead).rejects.toThrow();
  });

  it("binds a returned document to its authenticated dispatch and never to model arguments", async () => {
    const fixture = await seedDispatchBoundAuthority(), key = `dispatch-read-${randomUUID()}`;
    const created = await documentService(db).upsertIssueDocument({ issueId: fixture.issueId, key,
      title: "Native dispatch document", format: "markdown", body: "Exact selected document" });
    const nativeCall = await fixture.bindCall("read_document", "native-read-call", "native-read-turn");
    const result = await fixture.authority.execute({ tool: "read_document", callId: nativeCall.callId,
      arguments: { key, turnId: "model-supplied-turn", dispatchId: randomUUID() } }, {
      nativeToolCallIdentity: nativeCall,
      onDocumentRead: capture => recordNativeDocumentToolResultIntent({ ...fixture.documentCaptureBinding, capture }),
    });
    await fixture.authority.execute({ tool: "read_document", callId: "read-without-native-identity",
      arguments: { key, turnId: nativeCall.turnId, dispatchId: nativeCall.dispatchId } }, {
      onDocumentRead: capture => recordNativeDocumentToolResultIntent({ ...fixture.documentCaptureBinding, capture }),
    });
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, fixture.runId));
    expect(run!.runnerProfileJson!.nativeToolResultSourceCaptures).toEqual([
      expect.objectContaining({ callId: nativeCall.callId, turnId: nativeCall.turnId,
        resultDigest: createHash("sha256").update(JSON.stringify(result)).digest("hex"),
        nativeInputDispatch: { dispatchId: nativeCall.dispatchId, eventSeq: nativeCall.eventSeq,
          attempt: nativeCall.attempt, turnId: nativeCall.turnId, callId: nativeCall.callId },
        source: expect.objectContaining({ input: expect.objectContaining({ revisionId: created.document.latestRevisionId }) }) }),
      expect.objectContaining({ callId: "read-without-native-identity", turnId: null, nativeInputDispatch: null }),
    ]);
    expect(run!.nativeInputSourceProtocolVersion).toBe(0);
  });

  it("keeps concurrent read_document source captures local to their calls", async () => {
    const fixture = await seedDocumentReader();
    const docs = await Promise.all(["first", "second"].map(async label => {
      const key = `${label}-${randomUUID()}`;
      const body = `Actual ${label} document body.`;
      const created = await documentService(db).upsertIssueDocument({ issueId: fixture.issueId, key, title: label, format: "markdown", body });
      return { label, key, body, documentId: created.document.id, revisionId: created.document.latestRevisionId };
    }));
    const captures = new Map<string, DocumentRevisionSourceCapture | null>();
    const results = await Promise.all(docs.map(({ label, key }) => fixture.authority.execute({
      tool: "read_document", callId: `read-${label}`, arguments: { key },
    }, { onDocumentRead: async capture => {
      await new Promise(resolve => setTimeout(resolve, label === "first" ? 10 : 0));
      captures.set(capture.callId, capture.source);
    } }) as Promise<{ document: { body: string } }>));
    for (let i = 0; i < docs.length; i += 1) {
      const doc = docs[i]!;
      expect(results[i]!.document.body).toBe(doc.body);
      expect(captures.get(`read-${doc.label}`)).toMatchObject({ input: {
        kind: "document_revision", documentId: doc.documentId, revisionId: doc.revisionId, issueId: fixture.issueId,
        contentHash: createHash("sha256").update(doc.body, "utf8").digest("hex"),
      }, payloadSourceSnapshot: null });
    }
  });

  it("withholds the read_document result when its source capture callback fails", async () => {
    const fixture = await seedDocumentReader();
    const key = `callback-failure-${randomUUID()}`;
    await documentService(db).upsertIssueDocument({ issueId: fixture.issueId, key, title: "Callback failure", format: "markdown", body: "Do not deliver." });
    await expect(fixture.authority.execute({ tool: "read_document", callId: "read-callback-failure", arguments: { key } }, {
      onDocumentRead: async () => { throw new Error("capture persistence rejected"); },
    })).rejects.toThrow("capture persistence rejected");
  });

  it("rechecks the accountable reader after document capture and withholds on access revocation", async () => {
    const fixture = await seedDocumentReader();
    const [manifest] = await db.select().from(contextManifests).where(and(eq(contextManifests.companyId, fixture.companyId),
      eq(contextManifests.issueId, fixture.issueId)));
    if (!manifest) throw new Error("fixture_context_manifest_missing");
    await db.insert(contextManifestItems).values({ companyId: fixture.companyId, manifestId: manifest.id,
      sourceClass: "task", sourceProvider: "august_works_tasks", sourceRef: `issue://${fixture.issueId}`,
      sourceVersion: new Date().toISOString(), contentHash: "c".repeat(64), trustLevel: "high", sensitivity: "internal",
      rank: 0, selectionReason: "test" });
    await db.insert(issuePrivacySources).values({ companyId: fixture.companyId, issueId: fixture.issueId,
      sourceKind: "issue", sourceId: issueId, contextManifestId: manifest.id });
    const key = `access-revoked-${randomUUID()}`;
    await documentService(db).upsertIssueDocument({ issueId: fixture.issueId, key, title: "Revoked reader", format: "markdown", body: "Must not escape." });
    await expect(fixture.authority.execute({ tool: "read_document", callId: "read-after-revocation", arguments: { key } }, {
      onDocumentRead: async () => {
        await db.delete(companyMemberships).where(and(eq(companyMemberships.companyId, fixture.companyId),
          eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, userId)));
      },
    })).rejects.toThrow();
  });

  it("withholds a document result when its selected revision is replaced before delivery", async () => {
    const fixture = await seedDocumentReader();
    const key = `revision-replaced-${randomUUID()}`;
    const original = await documentService(db).upsertIssueDocument({ issueId: fixture.issueId, key,
      title: "Original", format: "markdown", body: "Original source body." });
    await expect(fixture.authority.execute({ tool: "read_document", callId: "read-replaced-revision", arguments: { key } }, {
      onDocumentRead: async () => {
        await documentService(db).upsertIssueDocument({ issueId: fixture.issueId, key, title: "Replacement", format: "markdown",
          body: "Replacement source body.", baseRevisionId: original.document.latestRevisionId });
      },
    })).rejects.toThrow("The selected document revision changed or was erased before delivery");
  });

  it("returns public task URLs from the current claimed origin in context and search results", async () => {
    const origin = vi.spyOn(cloudIdentity, "runtimeCanonicalOrigin").mockReturnValue("https://board.example");
    const authority = new PaperclipRunnerToolAuthority(db, { companyId, agentId, issueId, runId });
    try {
      expect(await authority.execute({ tool: "get_task_context", callId: "public-task-url", arguments: {} }))
        .toMatchObject({ activeTask: { id: issueId, url: `https://board.example/issues/${issueId}` } });
      expect(await authority.execute({ tool: "search_tasks", callId: "search-public-task-url", arguments: { query: "Exercise real runner tools" } }))
        .toMatchObject({ tasks: expect.arrayContaining([expect.objectContaining({ id: issueId, url: `https://board.example/issues/${issueId}` })]) });
      origin.mockReturnValue("https://renamed.example");
      expect(await authority.execute({ tool: "get_task_context", callId: "renamed-task-url", arguments: {} }))
        .toMatchObject({ activeTask: { url: `https://renamed.example/issues/${issueId}` } });
      origin.mockReturnValue("https://localhost");
      expect(await authority.execute({ tool: "get_task_context", callId: "unsafe-task-url", arguments: {} }))
        .toMatchObject({ activeTask: { url: null } });
    } finally {
      origin.mockRestore();
    }
  });

  it("exposes existing child tasks on continuation without crossing company boundaries", async () => {
    const completedChildId = randomUUID();
    const activeChildId = randomUUID();
    const unrelatedId = randomUUID();
    const otherCompanyId = randomUUID();
    const foreignChildId = randomUUID();
    const hiddenChildIds = Array.from({ length: 101 }, () => randomUUID());
    await db.insert(companies).values({ id: otherCompanyId, name: "Other company", issuePrefix: "OTHER" });
    await db.insert(issues).values([
      { id: completedChildId, companyId, parentId: issueId, title: "Existing completed draft", status: "done", assigneeAgentId: agentId },
      { id: activeChildId, companyId, parentId: issueId, title: "Existing active review", status: "in_progress", assigneeAgentId: agentId },
      { id: unrelatedId, companyId, title: "Unrelated task", status: "todo" },
      // Even inconsistent imported data cannot expose another company's task.
      { id: foreignChildId, companyId: otherCompanyId, parentId: issueId, title: "Foreign child", status: "todo" },
      // Hidden rows must neither enter context nor consume the visible child limit.
      ...hiddenChildIds.map((id) => ({ id, companyId, parentId: issueId, title: "Hidden child",
        hiddenAt: new Date(), createdAt: new Date(Date.now() + 1000) })),
    ]);
    try {
      const authority = new PaperclipRunnerToolAuthority(db, { companyId, agentId, issueId, runId });
      const context = await authority.execute({ tool: "get_task_context", callId: "context-existing-children", arguments: {} });
      expect(context).toMatchObject({
        childTasks: expect.arrayContaining([
          expect.objectContaining({ id: completedChildId, status: "done", parentId: issueId }),
          expect.objectContaining({ id: activeChildId, status: "in_progress", assigneeAgentId: agentId }),
        ]),
        childTasksTruncated: false,
        delegationGuidance: expect.stringContaining("Reuse existing child tasks"),
      });
      expect(JSON.stringify(context)).not.toContain(foreignChildId);
      expect(JSON.stringify(context)).not.toContain(unrelatedId);
      for (const id of hiddenChildIds) expect(JSON.stringify(context)).not.toContain(id);
    } finally {
      await db.delete(issues).where(inArray(issues.id, [completedChildId, activeChildId, unrelatedId, foreignChildId, ...hiddenChildIds]));
      await db.delete(companies).where(eq(companies.id, otherCompanyId));
    }
  });

  it("advertises API tools by default and preserves direct-chat file tools when disabled", () => {
    const previousEnabled = process.env.PAPERCLIP_RUNNER_API_TOOLS_ENABLED;
    const previousCompanies =
      process.env.PAPERCLIP_RUNNER_API_TOOLS_COMPANY_IDS;
    const createAuthority = () =>
      new PaperclipRunnerToolAuthority(db, {
        companyId,
        agentId,
        issueId,
        runId,
        workspaceRoot: "/tmp/paperclip-runner-tools",
        executionTargetKind: "local",
      });
    const requiredChatFileTools = [
      READ_CURRENT_WAKE_COMMENTS_TOOL_NAME,
      "list_chat_attachments",
      "reuse_chat_attachment",
      "read_chat_attachment",
      "register_deliverable",
    ];

    try {
      delete process.env.PAPERCLIP_RUNNER_API_TOOLS_ENABLED;
      delete process.env.PAPERCLIP_RUNNER_API_TOOLS_COMPANY_IDS;
      const defaultNames = createAuthority()
        .definitions()
        .map((tool) => tool.name);
      expect(defaultNames).toEqual(
        expect.arrayContaining(requiredChatFileTools),
      );
      expect(defaultNames).toContain("search_api");
      expect(defaultNames).toContain("call_api");
      expect(defaultNames).toContain("hire_agent");

      process.env.PAPERCLIP_RUNNER_API_TOOLS_ENABLED = "true";
      process.env.PAPERCLIP_RUNNER_API_TOOLS_COMPANY_IDS = companyId;
      const enabledNames = createAuthority()
        .definitions()
        .map((tool) => tool.name);
      expect(enabledNames).toEqual(
        expect.arrayContaining([
          ...requiredChatFileTools,
          "search_api",
          "call_api",
          "hire_agent",
        ]),
      );
      const hire = createAuthority().definitions().find((tool) => tool.name === "hire_agent")!;
      const hireSchema = hire.inputSchema as { properties: Record<string, unknown> };
      expect(hireSchema.properties).toEqual(expect.objectContaining({ name: expect.any(Object), role: expect.any(Object) }));
      expect(hireSchema.properties).not.toHaveProperty("adapterConfig");
      expect(hireSchema.properties).not.toHaveProperty("env");

      process.env.PAPERCLIP_RUNNER_API_TOOLS_ENABLED = "false";
      const disabledNames = createAuthority().definitions().map((tool) => tool.name);
      expect(disabledNames).toEqual(expect.arrayContaining(requiredChatFileTools));
      for (const name of ["search_api", "call_api", "hire_agent"]) {
        expect(disabledNames).not.toContain(name);
      }
    } finally {
      if (previousEnabled === undefined) {
        delete process.env.PAPERCLIP_RUNNER_API_TOOLS_ENABLED;
      } else {
        process.env.PAPERCLIP_RUNNER_API_TOOLS_ENABLED = previousEnabled;
      }
      if (previousCompanies === undefined) {
        delete process.env.PAPERCLIP_RUNNER_API_TOOLS_COMPANY_IDS;
      } else {
        process.env.PAPERCLIP_RUNNER_API_TOOLS_COMPANY_IDS = previousCompanies;
      }
    }
  });

  it("dispatches hire_agent with fixed caller context and replays its API receipt", async () => {
    const previousEnabled = process.env.PAPERCLIP_RUNNER_API_TOOLS_ENABLED;
    const previousCompanies = process.env.PAPERCLIP_RUNNER_API_TOOLS_COMPANY_IDS;
    const previousSecret = process.env.PAPERCLIP_AGENT_JWT_SECRET;
    process.env.PAPERCLIP_AGENT_JWT_SECRET = "hire-agent-test-secret";
    process.env.PAPERCLIP_RUNNER_API_TOOLS_ENABLED = "true";
    process.env.PAPERCLIP_RUNNER_API_TOOLS_COMPANY_IDS = companyId;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: randomUUID(), status: "active" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    try {
      const authority = new PaperclipRunnerToolAuthority(db, {
        companyId,
        agentId,
        issueId,
        runId,
        apiUrl: "http://runner-test.invalid",
      });
      const call = {
        tool: "hire_agent",
        callId: "hire-agent-receipt",
        arguments: {
          name: "QA teammate",
          role: "qa",
          title: "Quality lead",
          capabilities: "Test native workflows",
          instructions: "Use the assigned workspace and report findings.",
        },
      } as const;
      const first = await authority.execute(call);
      expect(first).toMatchObject({ ok: true, status: 201, apiOperationId: "POST /api/companies/{companyId}/agent-hires" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(String(url)).toBe(`http://runner-test.invalid/api/companies/${companyId}/agent-hires`);
      const body = JSON.parse(String(request.body));
      expect(body).toMatchObject({
        name: "QA teammate",
        role: "qa",
        title: "Quality lead",
        capabilities: "Test native workflows",
        adapterType: "paperclip_runner",
        inheritRuntimeFrom: "caller",
        reportsTo: agentId,
        sourceIssueId: issueId,
        instructionsBundle: { entryFile: "AGENTS.md", files: { "AGENTS.md": "Use the assigned workspace and report findings." } },
      });
      expect(body).not.toHaveProperty("adapterConfig");
      expect(body).not.toHaveProperty("runtimeConfig");
      expect(body).not.toHaveProperty("env");
      await expect(authority.execute(call)).resolves.toEqual(first);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      fetchMock.mockRestore();
      if (previousEnabled === undefined) delete process.env.PAPERCLIP_RUNNER_API_TOOLS_ENABLED;
      else process.env.PAPERCLIP_RUNNER_API_TOOLS_ENABLED = previousEnabled;
      if (previousCompanies === undefined) delete process.env.PAPERCLIP_RUNNER_API_TOOLS_COMPANY_IDS;
      else process.env.PAPERCLIP_RUNNER_API_TOOLS_COMPANY_IDS = previousCompanies;
      if (previousSecret === undefined) delete process.env.PAPERCLIP_AGENT_JWT_SECRET;
      else process.env.PAPERCLIP_AGENT_JWT_SECRET = previousSecret;
    }
  });

  it("advertises structured human input in ask mode", () => {
    const authority = new PaperclipRunnerToolAuthority(db, {
      companyId,
      agentId,
      issueId,
      runId,
      workMode: "ask",
    });
    expect(authority.definitions().map((tool) => tool.name)).toContain(
      "request_human_input",
    );
    expect(authority.definitions().map((tool) => tool.name)).not.toContain(
      "create_task",
    );
    expect(authority.definitions().map((tool) => tool.name)).not.toContain(
      "set_dependencies",
    );
  });

  it.each(["standard", "ask"] as const)(
    "advertises real task-bound questions and provider-dependent controls in %s mode",
    (workMode) => {
      const original = CAPABILITY_SEMANTIC_TOOL_CATALOG.find(
        (tool) => tool.operationId === "request_human_input",
      )!;
      const originalSnapshot = structuredClone(original);
      const authority = new PaperclipRunnerToolAuthority(db, {
        companyId,
        agentId,
        issueId,
        runId,
        workMode,
      });
      const advertised = JSON.parse(
        JSON.stringify(authority.definitions()),
      ).find((tool: { name: string }) => tool.name === "request_human_input");
      expect(advertised.description).toContain(
        "current Paperclip task bound to this run",
      );
      expect(advertised.description).toContain(
        "payload.questions for choices",
      );
      expect(advertised.description).toContain(
        "Paperclip renders it and authenticates the response",
      );
      expect(advertised.description).toContain(
        "Preserve existing review gates",
      );
      expect(advertised.description).not.toContain("mock");
      expect(advertised.description).not.toContain("questionSpec");
      const { resolverPolicy, ...properties } = advertised.inputSchema.properties;
      expect(resolverPolicy).toMatchObject({ type: "string", enum: ["human_only"] });
      expect({ ...advertised.inputSchema, properties }).toEqual(original.inputSchema);
      expect(advertised.inputSchema.properties).toHaveProperty("payload");
      expect(advertised.inputSchema.properties).not.toHaveProperty(
        "questionSpec",
      );
      expect(original).toEqual(originalSnapshot);
    },
  );

  it.each(["choice", "text"] as const)("executes the advertised %s question once on the bound reviewed task", async (answerMode) => {
    const binding = {
      companyId: randomUUID(),
      agentId: randomUUID(),
      issueId: randomUUID(),
      runId: randomUUID(),
    };
    await db.insert(companies).values({
      id: binding.companyId,
      name: "Question invocation",
      issuePrefix: answerMode === "choice" ? "RQA" : "RQT",
    });
    await db.insert(agents).values({
      id: binding.agentId,
      companyId: binding.companyId,
      name: "Question agent",
      adapterType: "paperclip_runner",
      status: "active",
    });
    await db.insert(issues).values({
      id: binding.issueId,
      companyId: binding.companyId,
      title: "Question on reviewed task",
      status: "in_review",
      workMode: "standard",
      reviewPolicy: "human_only",
      assigneeAgentId: binding.agentId,
    });
    await db.insert(heartbeatRuns).values({
      id: binding.runId,
      companyId: binding.companyId,
      agentId: binding.agentId,
      status: "running",
      runtimeMode: "native",
      nativeIssueId: binding.issueId,
      invocationSource: "assignment",
      triggerDetail: "system",
      contextSnapshot: { issueId: binding.issueId },
    });
    await db
      .update(issues)
      .set({ executionRunId: binding.runId })
      .where(eq(issues.id, binding.issueId));
    const authority = new PaperclipRunnerToolAuthority(db, binding);
    const advertised = authority
      .definitions()
      .find((tool) => tool.name === "request_human_input")!;
    expect(advertised.description).toContain("payload.questions");
    const questions = [
      {
        id: "color",
        prompt: "Choose one color",
        selectionMode: "single",
        required: true,
        options: [
          { id: "amber", label: "Amber" },
          { id: "cobalt", label: "Cobalt" },
        ],
      },
    ];
    const payloadDescription = (advertised.inputSchema as {
      properties: { payload: { description: string } };
    }).properties.payload.description;
    expect(payloadDescription).toContain("at least two distinct meaningful options");
    expect(payloadDescription).toContain("questionSet");
    expect(payloadDescription).not.toContain("use exactly");
    const payload = answerMode === "choice"
      ? { version: 1, questions }
      : {
          version: 1,
          questions: [{
            id: "goal",
            prompt: "What should we accomplish?",
            selectionMode: "single",
            required: true,
            options: [{ id: "describe", label: "Your answer", freeText: true }],
          }],
          questionSet: {
            schema: "paperclip.question_set.v1",
            questions: [{
              id: "goal",
              prompt: "What should we accomplish?",
              answerMode: "text",
              required: true,
            }],
          },
        };
    const call = {
      tool: "request_human_input",
      callId: "advertised-question",
      arguments: {
        idempotencyKey: "advertised-question",
        interactionKind: "questions",
        title: "Choose one color",
        prompt: "Choose one color",
        continuationPolicy: "wake_assignee",
        payload,
      },
    };
    const first = await authority.execute(call);
    expect(first).toMatchObject({
      disposition: "applied",
      interaction: {
        companyId: binding.companyId,
        issueId: binding.issueId,
        sourceRunId: binding.runId,
        kind: "ask_user_questions",
        status: "pending",
        continuationPolicy: "wake_assignee",
        payload,
      },
    });
    await expect(
      authority.execute({ ...call, callId: "advertised-question-replay" }),
    ).resolves.toEqual(first);
    const rows = await db
      .select()
      .from(issueThreadInteractions)
      .where(eq(issueThreadInteractions.issueId, binding.issueId));
    expect(rows).toHaveLength(1);
    const [task] = await db
      .select()
      .from(issues)
      .where(eq(issues.id, binding.issueId));
    expect(task).toMatchObject({
      status: "in_review",
      reviewPolicy: "human_only",
      assigneeAgentId: binding.agentId,
      executionRunId: binding.runId,
    });
    const entries = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.entityId, binding.issueId));
    expect(
      entries.filter(
        (entry) => entry.action === "issue.thread_interaction_created",
      ),
    ).toHaveLength(1);
  });

  it("does not project a foreign-company task through approval context", async () => {
    const foreignCompanyId = "00000000-0000-4000-8000-000000000211";
    const foreignIssueId = "00000000-0000-4000-8000-000000000212";
    const approvalId = "00000000-0000-4000-8000-000000000213";
    await db.insert(companies).values({
      id: foreignCompanyId,
      name: "Foreign approval company",
      issuePrefix: "FAC",
      issueCounter: 1,
    });
    await db.insert(issues).values({
      id: foreignIssueId,
      companyId: foreignCompanyId,
      issueNumber: 1,
      identifier: "FAC-1",
      title: "Must not cross the approval boundary",
      status: "todo",
    });
    await db.insert(approvals).values({
      id: approvalId,
      companyId,
      type: "runner_review",
      status: "pending",
      payload: {},
    });
    // The schema deliberately stores companyId independently on the link. A
    // corrupt or historical cross-tenant link must still fail closed at read.
    await db.insert(issueApprovals).values({
      companyId,
      approvalId,
      issueId: foreignIssueId,
      linkedByAgentId: agentId,
    });

    const authority = new PaperclipRunnerToolAuthority(db, {
      companyId,
      agentId,
      issueId,
      runId,
    });
    await expect(
      authority.execute({
        tool: "get_approval_context",
        callId: "foreign-approval-context",
        arguments: { approvalId },
      }),
    ).resolves.toMatchObject({ approval: { id: approvalId }, tasks: [] });
  });

  it("fits large assigned catalogs alongside workspace and completion tools without dropping task tools", async () => {
    const listToolsForNamedGateway = vi.fn().mockResolvedValue(Array.from({ length: 224 }, (_, i) => ({
      name: `app.action_${i}`, displayName: `Action ${i}`, description: "Read a fixture",
      parametersSchema: { type: "object", properties: {} }, risk: "read",
    })));
    const assignedMcpTools = await createAssignedMcpTools({
      gateway: { listToolsForNamedGateway } as unknown as ToolGatewayService,
      gatewayPublicId: "fixture", bearerToken: "fixture-token",
    });
    const binding = { companyId, agentId, issueId, runId, workspaceRoot: "/tmp/fixture-workspace" };
    const baseline = new PaperclipRunnerToolAuthority(db, binding).definitions();
    expect(runnerCodexDynamicToolsFit([...baseline, ...assignedMcpTools.definitions()])).toBe(false);
    const authority = new PaperclipRunnerToolAuthority(db, { ...binding, assignedMcpTools });
    const tools = authority.definitions();
    expect(runnerCodexDynamicToolsFit(tools)).toBe(true);
    expect(tools).toEqual(expect.arrayContaining(baseline));
    expect(tools.filter(tool => String(tool.name).startsWith("app_"))).toEqual([]);
    expect(tools.map(tool => tool.name)).toEqual(expect.arrayContaining([
      "paperclip_search_assigned_tools", "paperclip_call_assigned_tool", "register_deliverable",
    ]));
    const call = { tool: "paperclip_search_assigned_tools", callId: "discover", arguments: { query: "Action 223" } };
    await expect(authority.execute(call)).resolves.toMatchObject({ tools: [expect.objectContaining({ description: "Action 223: Read a fixture" })] });
    listToolsForNamedGateway.mockClear();
    await db.update(heartbeatRuns).set({ status: "succeeded" }).where(eq(heartbeatRuns.id, runId));
    try {
      await expect(authority.execute(call)).rejects.toThrow("paperclip_runner_tool_binding_not_authorized");
      expect(listToolsForNamedGateway).not.toHaveBeenCalled();
    } finally {
      await db.update(heartbeatRuns).set({ status: "running" }).where(eq(heartbeatRuns.id, runId));
    }
  });

  it("relays assigned MCP calls only while the native run still owns its task", async () => {
    const tool = { name: "app_mem0_recall", description: "Recall memory", inputSchema: { type: "object" } };
    const execute = vi.fn().mockResolvedValue({ content: "synthetic memory" });
    const authority = new PaperclipRunnerToolAuthority(db, {
      companyId, agentId, issueId, runId,
      assignedMcpTools: { definitions: () => [tool], has: (name) => name === tool.name, execute },
    });
    expect(authority.definitions()).toContainEqual(tool);
    const call = { tool: tool.name, callId: "assigned-mcp", arguments: { query: "compass" } };
    await expect(authority.execute(call)).resolves.toEqual({ content: "synthetic memory" });
    expect(execute).toHaveBeenCalledWith(call, "standard");
    await db.update(issues).set({ workMode: "ask" }).where(eq(issues.id, issueId));
    try {
      await authority.execute(call);
      expect(execute).toHaveBeenLastCalledWith(call, "ask");
    } finally {
      await db.update(issues).set({ workMode: "standard" }).where(eq(issues.id, issueId));
    }
    execute.mockClear();
    await db.update(heartbeatRuns).set({ status: "succeeded" }).where(eq(heartbeatRuns.id, runId));
    try {
      await expect(authority.execute(call)).rejects.toThrow("paperclip_runner_tool_binding_not_authorized");
      expect(execute).not.toHaveBeenCalled();
    } finally {
      await db.update(heartbeatRuns).set({ status: "running" }).where(eq(heartbeatRuns.id, runId));
    }
  });

  it("does not advertise delegation tools during pre-acceptance planning", () => {
    const authority = new PaperclipRunnerToolAuthority(db, {
      companyId,
      agentId,
      issueId,
      runId,
      workMode: "planning",
    });
    expect(authority.definitions().map((tool) => tool.name)).not.toContain(
      "create_task",
    );
    expect(authority.definitions().map((tool) => tool.name)).not.toContain(
      "set_dependencies",
    );
  });

  it("writes progress through the real issue service and replays idempotently", async () => {
    const authority = new PaperclipRunnerToolAuthority(db, {
      companyId,
      agentId,
      issueId,
      runId,
    });
    const call = {
      tool: "report_progress",
      callId: "progress",
      arguments: { body: "Runner progress", idempotencyKey: "progress-1" },
    };
    const first = await authority.execute(call);
    const replay = await authority.execute({
      ...call,
      callId: "progress-replay",
    });
    expect(replay).toEqual(first);
    expect(
      await db
        .select()
        .from(issueComments)
        .where(eq(issueComments.issueId, issueId)),
    ).toHaveLength(1);
    const progressActivity = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entityId, issueId), eq(activityLog.action, "issue.comment_added")));
    expect(progressActivity).toHaveLength(1);
    expect(progressActivity[0]).toMatchObject({
      action: "issue.comment_added",
      actorType: "agent",
      actorId: agentId,
      agentId,
      runId,
      entityType: "issue",
      entityId: issueId,
      details: expect.objectContaining({
        bodySnippet: "Runner progress",
        identifier: "RNT-1",
        issueTitle: "Exercise real runner tools",
        source: "paperclip_runner_protocol",
      }),
    });
    await expect(
      authority.execute({
        ...call,
        arguments: { body: "Changed", idempotencyKey: "progress-1" },
      }),
    ).rejects.toThrow("paperclip_runner_tool_idempotency_conflict");
  });

  it("creates checkbox interactions through the real interaction service", async () => {
    const authority = new PaperclipRunnerToolAuthority(db, {
      companyId,
      agentId,
      issueId,
      runId,
    });
    const call = {
      tool: "request_human_input",
      callId: "ask-checkbox",
      arguments: {
        idempotencyKey: "favorite-animals",
        interactionKind: "checkbox",
        title: "Favorite zoo animals",
        prompt: "Which zoo animals are your favorites?",
        continuationPolicy: "wake_assignee",
        payload: {
          options: [
            { id: "giraffes", label: "Giraffes" },
            { id: "lions", label: "Lions" },
          ],
        },
      },
    };
    const first = await authority.execute(call);
    await expect(
      authority.execute({ ...call, callId: "ask-checkbox-replay" }),
    ).resolves.toEqual(first);
    expect(first).toMatchObject({
      interaction: { kind: "request_checkbox_confirmation", status: "pending" },
    });
    expect(
      await db
        .select()
        .from(issueThreadInteractions)
        .where(eq(issueThreadInteractions.issueId, issueId)),
    ).toHaveLength(1);
    expect(
      (
        await db
          .select()
          .from(activityLog)
          .where(eq(activityLog.entityId, issueId))
      ).filter((entry) => entry.action === "issue.thread_interaction_created"),
    ).toHaveLength(1);
    await expect(
      authority.execute({
        ...call,
        callId: "ask-checkbox-conflict",
        arguments: {
          ...call.arguments,
          prompt: "Use the same key for a different prompt.",
        },
      }),
    ).rejects.toThrow("paperclip_runner_tool_idempotency_conflict");
  });

  it("writes a real revisioned document and replays the mutation receipt", async () => {
    const authority = new PaperclipRunnerToolAuthority(db, {
      companyId,
      agentId,
      issueId,
      runId,
    });
    const call = {
      tool: "write_document",
      callId: "write-plan",
      arguments: {
        idempotencyKey: "write-plan-1",
        key: "plan",
        title: "Execution plan",
        body: "Use the real document service.",
        // Provider bridges may serialize nullable string inputs as the literal
        // "null". The protocol boundary treats that as document creation.
        baseRevisionId: "null",
        changeSummary: "Initial plan",
      },
    };
    const first = await authority.execute(call);
    const replay = await authority.execute({
      ...call,
      callId: "write-plan-replay",
    });
    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      disposition: "applied",
      created: true,
      document: { key: "plan", body: "Use the real document service." },
    });
    expect(
      await db
        .select()
        .from(documents)
        .where(eq(documents.companyId, companyId)),
    ).toHaveLength(1);
    const documentActivity = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.entityId, issueId));
    expect(
      documentActivity.filter(
        (entry) => entry.action === "issue.document_created",
      ),
    ).toEqual([
      expect.objectContaining({
        actorType: "agent",
        actorId: agentId,
        agentId,
        runId,
        entityType: "issue",
        details: expect.objectContaining({
          key: "plan",
          source: "paperclip_runner_protocol",
        }),
      }),
    ]);
    await expect(
      authority.execute({
        ...call,
        arguments: { ...call.arguments, body: "Conflicting retry." },
      }),
    ).rejects.toThrow("paperclip_runner_tool_idempotency_conflict");
  });

  it("returns the exact accepted plan revision in task context", async () => {
    const plan = await documentService(db).getIssueDocumentByKey(
      issueId,
      "plan",
    );
    expect(plan).not.toBeNull();
    const authority = new PaperclipRunnerToolAuthority(db, {
      companyId,
      agentId,
      issueId,
      runId,
    });
    const requested = await authority.execute({
      tool: "request_human_input",
      callId: "approve-plan",
      arguments: {
        idempotencyKey: `confirmation:${issueId}:plan:${plan!.latestRevisionId}`,
        interactionKind: "confirmation",
        title: "Approve the plan",
        prompt: "Approve this exact plan revision?",
        payload: {
          target: {
            type: "issue_document",
            issueId,
            documentId: plan!.id,
            key: "plan",
            revisionId: plan!.latestRevisionId,
            revisionNumber: plan!.latestRevisionNumber,
          },
        },
        targetRevisionId: plan!.latestRevisionId,
        continuationPolicy: "wake_assignee_on_accept",
      },
    });
    expect(requested).toMatchObject({
      interaction: {
        kind: "request_confirmation",
        status: "pending",
        payload: {
          target: {
            type: "issue_document",
            issueId,
            key: "plan",
            revisionId: plan!.latestRevisionId,
          },
        },
      },
    });
    await db
      .update(issueThreadInteractions)
      .set({
        status: "accepted",
        resolvedByUserId: "test-user",
        resolvedAt: new Date(),
        result: { outcome: "accepted" } as never,
      })
      .where(
        eq(
          issueThreadInteractions.id,
          (requested as { interaction: { id: string } }).interaction.id,
        ),
      );
    await db
      .update(heartbeatRuns)
      .set({
        contextSnapshot: {
          issueId,
          workspaceRefreshReason: "accepted_plan_confirmation",
          planReviewInteraction: {
            acceptedTargetRevision: {
              issueId,
              documentId: plan!.id,
              key: "plan",
              revisionId: plan!.latestRevisionId,
              revisionNumber: plan!.latestRevisionNumber,
            },
          },
        },
      })
      .where(eq(heartbeatRuns.id, runId));

    await expect(
      authority.execute({
        tool: "get_task_context",
        callId: "accepted-context",
        arguments: {},
      }),
    ).resolves.toMatchObject({
      acceptedPlan: {
        documentId: plan!.id,
        revisionId: plan!.latestRevisionId,
        revisionNumber: plan!.latestRevisionNumber,
        markdown: "Use the real document service.",
      },
    });
  });

  it("creates ordinary children, preserves blockers, and deduplicates across runs", async () => {
    const wakes: Array<{ agentId: string; options: Record<string, unknown> }> =
      [];
    const authority = new PaperclipRunnerToolAuthority(db, {
      companyId,
      agentId,
      issueId,
      runId,
      workMode: "standard",
      enqueueWakeup: async (wakeAgentId, options) => {
        wakes.push({ agentId: wakeAgentId, options });
        return null;
      },
    });
    expect(authority.definitions().map((tool) => tool.name)).toContain(
      "create_task",
    );

    const prerequisite = await authority.execute({
      tool: "create_task",
      callId: "create-prerequisite",
      arguments: {
        idempotencyKey: "ordinary-prerequisite",
        title: "Prepare delegated input",
        description:
          "A self-contained prerequisite delegated from the active task.",
      },
    });

    expect(prerequisite).toMatchObject({
      disposition: "applied",
      task: {
        parentId: issueId,
        status: "todo",
        assigneeActorId: agentId,
      },
    });
    expect(wakes).toHaveLength(1);
    expect(wakes[0]).toMatchObject({
      agentId,
      options: {
        reason: "issue_assigned",
        payload: { parentIssueId: issueId },
      },
    });
    const prerequisiteId = (prerequisite as { task: { id: string } }).task.id;
    expect(await db.select().from(activityLog).where(eq(activityLog.entityId, prerequisiteId)))
      .toEqual(expect.arrayContaining([expect.objectContaining({ action: "issue.created", agentId, runId, companyId })]));
    const dependent = await authority.execute({
      tool: "create_task",
      callId: "create-dependent",
      arguments: {
        idempotencyKey: "ordinary-dependent",
        title: "Use delegated input",
        blockedByTaskIds: [prerequisiteId],
      },
    });
    expect(dependent).toMatchObject({
      disposition: "applied",
      scheduledWakeIds: [],
      task: { parentId: issueId, status: "blocked", assigneeActorId: agentId },
    });
    expect(wakes).toHaveLength(1);
    await expect(
      issueService(db).getRelationSummaries(issueId),
    ).resolves.toMatchObject({
      blockedBy: [],
    });

    await authority.execute({
      tool: "set_dependencies",
      callId: "wait-for-prerequisite",
      arguments: {
        idempotencyKey: "source-waits-for-prerequisite",
        blockedByTaskIds: [prerequisiteId],
      },
    });
    await expect(
      issueService(db).getRelationSummaries(issueId),
    ).resolves.toMatchObject({
      blockedBy: [expect.objectContaining({ id: prerequisiteId })],
    });

    await issueService(db).update(prerequisiteId, {
      status: "done",
      actorAgentId: agentId,
      actorRunId: runId,
    });
    await expect(
      authority.execute({
        tool: "create_task",
        callId: "create-dependency-ready-child",
        arguments: {
          idempotencyKey: "ordinary-ready-dependent",
          title: "Start after completed delegated input",
          blockedByTaskIds: [prerequisiteId],
        },
      }),
    ).resolves.toMatchObject({
      disposition: "applied",
      task: { parentId: issueId, status: "todo", assigneeActorId: agentId },
      scheduledWakeIds: [expect.any(String)],
    });
    expect(wakes).toHaveLength(2);

    const nextRunId = "00000000-0000-4000-8000-000000000106";
    await db
      .update(heartbeatRuns)
      .set({ status: "succeeded" })
      .where(eq(heartbeatRuns.id, runId));
    await db.insert(heartbeatRuns).values({
      id: nextRunId,
      companyId,
      agentId,
      responsibleUserId: userId,
      status: "running",
      runtimeMode: "native",
      nativeIssueId: issueId,
      invocationSource: "automation",
      triggerDetail: "system",
      contextSnapshot: { issueId },
    });
    await db
      .update(issues)
      .set({ executionRunId: nextRunId })
      .where(eq(issues.id, issueId));
    const retryWakes: Array<unknown> = [];
    const retryAuthority = new PaperclipRunnerToolAuthority(db, {
      companyId,
      agentId,
      issueId,
      runId: nextRunId,
      workMode: "standard",
      enqueueWakeup: async (_wakeAgentId, options) => {
        retryWakes.push(options);
        return null;
      },
    });
    await expect(
      retryAuthority.execute({
        tool: "create_task",
        callId: "cross-run-retry",
        arguments: {
          idempotencyKey: "ordinary-prerequisite",
          title: "Prepare delegated input",
          description:
            "A self-contained prerequisite delegated from the active task.",
        },
      }),
    ).resolves.toMatchObject({
      disposition: "duplicate",
      task: { id: prerequisiteId },
    });
    await expect(
      retryAuthority.execute({
        tool: "create_task",
        callId: "cross-run-conflicting-retry",
        arguments: {
          idempotencyKey: "ordinary-prerequisite",
          title: "Conflicting title for the same caller key",
        },
      }),
    ).rejects.toThrow("paperclip_runner_tool_idempotency_conflict");

    const creationEvents = (await db.select().from(activityLog).where(eq(activityLog.entityId, prerequisiteId)))
      .filter(event => event.action === "issue.created");
    expect(creationEvents).toHaveLength(1);

    const foreignCompanyId = "00000000-0000-4000-8000-000000000201";
    const foreignAgentId = "00000000-0000-4000-8000-000000000202";
    const foreignIssueId = "00000000-0000-4000-8000-000000000203";
    await db.insert(companies).values({
      id: foreignCompanyId,
      name: "Foreign company",
      issuePrefix: "FGN",
      issueCounter: 1,
    });
    await db.insert(agents).values({
      id: foreignAgentId,
      companyId: foreignCompanyId,
      name: "Foreign agent",
      adapterType: "paperclip_runner",
      adapterConfig: { provider: "codex" },
      runtimeConfig: {},
      status: "active",
    });
    await db.insert(issues).values({
      id: foreignIssueId,
      companyId: foreignCompanyId,
      issueNumber: 1,
      identifier: "FGN-1",
      title: "Foreign blocker",
      status: "todo",
    });
    await expect(
      retryAuthority.execute({
        tool: "create_task",
        callId: "foreign-assignee",
        arguments: {
          idempotencyKey: "foreign-assignee",
          title: "Invalid foreign assignment",
          assigneeActorId: foreignAgentId,
        },
      }),
    ).rejects.toThrow("paperclip_runner_agent_not_found");
    await expect(
      retryAuthority.execute({
        tool: "create_task",
        callId: "foreign-blocker",
        arguments: {
          idempotencyKey: "foreign-blocker",
          title: "Invalid foreign blocker",
          blockedByTaskIds: [foreignIssueId],
        },
      }),
    ).rejects.toThrow();
    expect(retryWakes).toHaveLength(0);
    expect(
      await db.select().from(issues).where(eq(issues.parentId, issueId)),
    ).toHaveLength(3);
  });

  it("binds a private Agent-created Task to the locked run Human and denies stale Human access", async () => {
    const f = await seedDocumentReader();
    const receipt = await f.authority.execute({ tool: "create_task", callId: "private-bound-task", arguments: {
      idempotencyKey: "private-bound-task", title: "Private follow-up", status: "backlog",
      responsibleUserId: "model-selected-human",
    } }) as { task: { id: string } };
    const [created] = await db.select().from(issues).where(eq(issues.id, receipt.task.id));
    expect(created).toMatchObject({ visibility: "private", responsibleUserId: userId,
      createdByAgentId: f.agentId, originRunId: f.runId });

    const stale = await seedDocumentReader();
    const wrongHumanId = randomUUID(), now = new Date();
    await db.insert(authUsers).values({ id: wrongHumanId, name: "Different active Human",
      email: `${wrongHumanId}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId: stale.companyId, principalType: "user",
      principalId: wrongHumanId, membershipRole: "admin", status: "active" });
    await db.update(heartbeatRuns).set({ responsibleUserId: wrongHumanId }).where(eq(heartbeatRuns.id, stale.runId));
    await expect(stale.authority.execute({ tool: "create_task", callId: "stale-human-task", arguments: {
      idempotencyKey: "stale-human-task", title: "Stale Human follow-up", status: "backlog",
    } })).rejects.toThrow();
    expect(await db.select().from(issues).where(and(
      eq(issues.companyId, stale.companyId), eq(issues.originRunId, stale.runId),
    ))).toEqual([]);
  });

  it("commits exact acknowledged dispatch identity with the native Task mutation receipt", async () => {
    const fixture = await seedDispatchBoundAuthority();
    const nativeCall = await fixture.bindCall("create_task", "receipt-call-exact", "provider-turn-receipt-exact");
    const idempotencyKey = `receipt-${randomUUID()}`;
    const result = await fixture.authority.execute({ tool: "create_task", callId: nativeCall.callId, arguments: {
      idempotencyKey, title: "Receipt-bound child", description: "The actual Task mutation.",
    } }, { nativeToolCallIdentity: { tool: nativeCall.tool, callId: nativeCall.callId, turnId: nativeCall.turnId } }) as { task: { id: string } };
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, fixture.runId));
    const receipts = (run!.resultJson as Record<string, unknown>).semanticToolReceipts as Record<string, Record<string, unknown>>;
    expect(receipts[idempotencyKey]).toMatchObject({ operationId: "create_task",
      nativeInputDispatch: { dispatchId: nativeCall.dispatchId, eventSeq: nativeCall.eventSeq,
        attempt: nativeCall.attempt, turnId: nativeCall.turnId, callId: nativeCall.callId } });
    const [child] = await db.select().from(issues).where(eq(issues.id, result.task.id));
    expect(child).toMatchObject({ parentId: fixture.issueId, originRunId: fixture.runId });
  });

  it("stores explicit unknown dispatch identity when no acknowledged association exists", async () => {
    const fixture = await seedDocumentReader();
    const idempotencyKey = `receipt-unknown-${randomUUID()}`;
    await fixture.authority.execute({ tool: "create_task", callId: "unassociated-tool-call", arguments: {
      idempotencyKey, title: "Unknown dispatch child",
      nativeInputDispatch: { dispatchId: randomUUID(), turnId: "model-claim", callId: "unassociated-tool-call" },
    } }, { nativeToolCallIdentity: { tool: "create_task", callId: "unassociated-tool-call", turnId: "unsupported-backend-turn" } });
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, fixture.runId));
    const receipts = (run!.resultJson as Record<string, unknown>).semanticToolReceipts as Record<string, Record<string, unknown>>;
    expect(receipts[idempotencyKey]).toMatchObject({ operationId: "create_task", nativeInputDispatch: null });
    const mismatchedKey = `receipt-mismatched-call-${randomUUID()}`;
    await fixture.authority.execute({ tool: "create_task", callId: "actual-tool-call-id", arguments: {
      idempotencyKey: mismatchedKey, title: "Mismatched server metadata stays unknown",
    } }, { nativeToolCallIdentity: { tool: "create_task", callId: "different-server-call-id", turnId: "unsupported-backend-turn" } });
    const [afterMismatch] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, fixture.runId));
    const afterReceipts = (afterMismatch!.resultJson as Record<string, unknown>).semanticToolReceipts as Record<string, Record<string, unknown>>;
    expect(afterReceipts[mismatchedKey]!.nativeInputDispatch).toBeNull();
  });

  it("stores unknown when association history has a contradictory tool for the same call tuple", async () => {
    const fixture = await seedDispatchBoundAuthority();
    const nativeCall = await fixture.bindCall("create_task", "contradictory-tool-call", "provider-turn-contradictory-tool");
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, fixture.runId));
    const profile = run!.runnerProfileJson as Record<string, unknown>;
    const associations = profile.nativeToolCallDispatchAssociations as Array<Record<string, unknown>>;
    await db.update(heartbeatRuns).set({ runnerProfileJson: { ...profile,
      nativeToolCallDispatchAssociations: [...associations, { ...associations[0], tool: "write_document" }],
    } }).where(eq(heartbeatRuns.id, fixture.runId));
    const idempotencyKey = `contradictory-tool-${randomUUID()}`;
    await fixture.authority.execute({ tool: "create_task", callId: nativeCall.callId, arguments: {
      idempotencyKey, title: "Ambiguous association stays unknown",
    } }, { nativeToolCallIdentity: { tool: nativeCall.tool, callId: nativeCall.callId, turnId: nativeCall.turnId } });
    const [after] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, fixture.runId));
    const receipts = (after!.resultJson as Record<string, unknown>).semanticToolReceipts as Record<string, Record<string, unknown>>;
    expect(receipts[idempotencyKey]!.nativeInputDispatch).toBeNull();
  });

  it("stores unknown when a later acknowledged intent makes a previously associated turn ambiguous", async () => {
    const fixture = await seedDispatchBoundAuthority();
    const turnId = "provider-turn-later-duplicate-ack";
    const first = await fixture.bindCall("create_task", "earlier-turn-call", turnId);
    const second = await fixture.bindCall("create_task", "later-turn-call", turnId, false);
    expect(second.dispatchId).not.toBe(first.dispatchId);
    const idempotencyKey = `ambiguous-turn-${randomUUID()}`;
    await fixture.authority.execute({ tool: "create_task", callId: first.callId, arguments: {
      idempotencyKey, title: "Ambiguous turn stays unknown",
    } }, { nativeToolCallIdentity: { tool: first.tool, callId: first.callId, turnId } });
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, fixture.runId));
    const receipts = (run!.resultJson as Record<string, unknown>).semanticToolReceipts as Record<string, Record<string, unknown>>;
    expect(receipts[idempotencyKey]!.nativeInputDispatch).toBeNull();
  });

  it("keeps concurrent mutation receipts bound to their own backend calls", async () => {
    const fixture = await seedDispatchBoundAuthority();
    const first = await fixture.bindCall("create_task", "concurrent-receipt-first", "provider-turn-receipt-first");
    const second = await fixture.bindCall("create_task", "concurrent-receipt-second", "provider-turn-receipt-second");
    const firstKey = `concurrent-first-${randomUUID()}`;
    const secondKey = `concurrent-second-${randomUUID()}`;
    await Promise.all([
      fixture.authority.execute({ tool: first.tool, callId: first.callId, arguments: { idempotencyKey: firstKey, title: "First concurrent Task" } },
        { nativeToolCallIdentity: { tool: first.tool, callId: first.callId, turnId: first.turnId } }),
      fixture.authority.execute({ tool: second.tool, callId: second.callId, arguments: { idempotencyKey: secondKey, title: "Second concurrent Task" } },
        { nativeToolCallIdentity: { tool: second.tool, callId: second.callId, turnId: second.turnId } }),
    ]);
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, fixture.runId));
    const receipts = (run!.resultJson as Record<string, unknown>).semanticToolReceipts as Record<string, Record<string, unknown>>;
    expect(receipts[firstKey]!.nativeInputDispatch).toEqual({ dispatchId: first.dispatchId, eventSeq: first.eventSeq,
      attempt: first.attempt, turnId: first.turnId, callId: first.callId });
    expect(receipts[secondKey]!.nativeInputDispatch).toEqual({ dispatchId: second.dispatchId, eventSeq: second.eventSeq,
      attempt: second.attempt, turnId: second.turnId, callId: second.callId });
  });

  it("preserves original dispatch identity when a semantic mutation receipt is replayed", async () => {
    const fixture = await seedDispatchBoundAuthority();
    const first = await fixture.bindCall("create_task", "receipt-replay-first", "provider-turn-replay-first");
    const second = await fixture.bindCall("create_task", "receipt-replay-second", "provider-turn-replay-second");
    const idempotencyKey = `receipt-replay-${randomUUID()}`;
    const arguments_ = { idempotencyKey, title: "Replay retains original association" };
    const initial = await fixture.authority.execute({ tool: "create_task", callId: first.callId, arguments: arguments_ },
      { nativeToolCallIdentity: { tool: first.tool, callId: first.callId, turnId: first.turnId } });
    await expect(fixture.authority.execute({ tool: "create_task", callId: second.callId, arguments: arguments_ },
      { nativeToolCallIdentity: { tool: second.tool, callId: second.callId, turnId: second.turnId } })).resolves.toEqual(initial);
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, fixture.runId));
    const receipts = (run!.resultJson as Record<string, unknown>).semanticToolReceipts as Record<string, Record<string, unknown>>;
    expect(receipts[idempotencyKey]!.nativeInputDispatch).toEqual({ dispatchId: first.dispatchId,
      eventSeq: first.eventSeq, attempt: first.attempt, turnId: first.turnId, callId: first.callId });
  });

  it("rolls back Task effects when the atomic mutation receipt cannot commit", async () => {
    const fixture = await seedDispatchBoundAuthority();
    const nativeCall = await fixture.bindCall("create_task", "receipt-rollback-call", "provider-turn-receipt-rollback");
    const idempotencyKey = `receipt-rollback-${randomUUID()}`;
    const originId = `paperclip-runner:create-task:${fixture.issueId}:${idempotencyKey}`;
    const constraintName = `reject_semantic_receipt_${fixture.runId.replaceAll("-", "")}`;
    await db.execute(sql`alter table heartbeat_runs add constraint ${sql.identifier(constraintName)}
      check (id <> ${sql.raw(`'${fixture.runId}'::uuid`)} or not coalesce(result_json ? 'semanticToolReceipts', false))`);
    try {
      await expect(fixture.authority.execute({ tool: "create_task", callId: nativeCall.callId, arguments: {
        idempotencyKey, title: "Must roll back with receipt",
      } }, { nativeToolCallIdentity: { tool: nativeCall.tool, callId: nativeCall.callId, turnId: nativeCall.turnId } })).rejects.toThrow();
      expect(await db.select().from(issues).where(eq(issues.originId, originId))).toHaveLength(0);
      const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, fixture.runId));
      expect(run!.resultJson ?? {}).not.toHaveProperty("semanticToolReceipts");
    } finally {
      await db.execute(sql`alter table heartbeat_runs drop constraint if exists ${sql.identifier(constraintName)}`);
    }
  });

  it("rejects mutations after reassignment, run replacement, or terminalization", async () => {
    const guardedIssueId = "00000000-0000-4000-8000-000000000107";
    const guardedRunId = "00000000-0000-4000-8000-000000000108";
    const guardedReplacementRunId = "00000000-0000-4000-8000-000000000109";
    await db.insert(issues).values({
      id: guardedIssueId,
      companyId,
      issueNumber: 999,
      identifier: "RNT-999",
      title: "Guard mutation authorization",
      status: "in_progress",
      workMode: "standard",
      assigneeAgentId: agentId,
    });
    await db.insert(heartbeatRuns).values({
      id: guardedRunId,
      companyId,
      agentId,
      status: "running",
      runtimeMode: "native",
      nativeIssueId: guardedIssueId,
      invocationSource: "assignment",
      triggerDetail: "system",
      contextSnapshot: { issueId: guardedIssueId },
    });
    await db.insert(heartbeatRuns).values({
      id: guardedReplacementRunId,
      companyId,
      agentId,
      status: "running",
      runtimeMode: "native",
      nativeIssueId: guardedIssueId,
      invocationSource: "assignment",
      triggerDetail: "system",
      contextSnapshot: { issueId: guardedIssueId },
    });
    await db
      .update(issues)
      .set({ executionRunId: guardedRunId })
      .where(eq(issues.id, guardedIssueId));
    const authority = new PaperclipRunnerToolAuthority(db, {
      companyId,
      agentId,
      issueId: guardedIssueId,
      runId: guardedRunId,
    });
    const mutation = {
      tool: "report_progress",
      callId: "guarded-progress",
      arguments: {
        body: "Must remain authorized",
        idempotencyKey: "guarded-progress",
      },
    };

    await db
      .update(issues)
      .set({ assigneeAgentId: null })
      .where(eq(issues.id, guardedIssueId));
    await expect(authority.execute(mutation)).rejects.toThrow(
      "paperclip_runner_tool_binding_not_authorized",
    );

    await db
      .update(issues)
      .set({
        assigneeAgentId: agentId,
        executionRunId: guardedReplacementRunId,
      })
      .where(eq(issues.id, guardedIssueId));
    await expect(
      authority.execute({ ...mutation, callId: "replaced-run" }),
    ).rejects.toThrow("paperclip_runner_tool_binding_not_authorized");

    await db
      .update(issues)
      .set({ executionRunId: guardedRunId })
      .where(eq(issues.id, guardedIssueId));
    await db
      .update(heartbeatRuns)
      .set({ status: "succeeded" })
      .where(eq(heartbeatRuns.id, guardedRunId));
    await expect(
      authority.execute({ ...mutation, callId: "terminal-run" }),
    ).rejects.toThrow("paperclip_runner_tool_binding_not_authorized");

    expect(
      await db
        .select()
        .from(issueComments)
        .where(eq(issueComments.issueId, guardedIssueId)),
    ).toHaveLength(0);
  });

  it("captures delegation and approval origins before steering and preserves replay identity", async () => {
    const issueId = "00000000-0000-4000-8000-000000000120";
    const runId = "00000000-0000-4000-8000-000000000121";
    await db.insert(issues).values({ id: issueId, companyId, title: "Identity delegation",
      status: "in_progress", assigneeAgentId: agentId });
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId,
      status: "running", runtimeMode: "native", nativeIssueId: issueId,
      invocationSource: "assignment", triggerDetail: "system", contextSnapshot: { issueId } });
    await db.update(issues).set({ executionRunId: runId }).where(eq(issues.id, issueId));
    const origin = await initializeRunIdentity(db, {
      companyId, runId, issueId, responsibleUserId: "person-a", cause: "instruction",
    });
    const [message] = await db.insert(issueComments).values({
      companyId, issueId, body: "New instruction", authorUserId: "person-b",
    }).returning();
    const authority = new PaperclipRunnerToolAuthority(db, { companyId, agentId, issueId, runId });
    const call = { tool: "create_task", callId: "identity-child", arguments: {
      idempotencyKey: "identity-child", title: "Keep the initiating identity",
      responsibleUserId: "forged-user", originIdentityContextId: "forged-context",
    } };
    const first = await authority.execute(call) as { task: { id: string } };
    const pending = await reserveSteeredIdentity(db, { companyId, runId, issueId, messageId: message.id });
    await reconcileSteeredIdentity(db, pending!);
    await expect(authority.execute({ ...call, callId: "identity-child-replay" })).resolves.toEqual(first);
    const [child] = await db.select().from(issues).where(eq(issues.id, first.task.id));
    expect(child).toMatchObject({ originRunId: runId, originIdentityContextId: origin.id,
      continuationIdentityContextId: origin.id });
    const second = await authority.execute({ ...call, callId: "identity-child-b", arguments: {
      idempotencyKey: "identity-child-b", title: "Use the next instruction identity",
    } }) as { task: { id: string } };
    const [nextChild] = await db.select().from(issues).where(eq(issues.id, second.task.id));
    expect(nextChild.originIdentityContextId).toBe(pending!.id);
    await authority.execute({ tool: "request_human_input", callId: "identity-approval", arguments: {
      idempotencyKey: "identity-approval", interactionKind: "confirmation", title: "Approve continuation",
      prompt: "Continue?", continuationPolicy: "wake_assignee", payload: {},
    } });
    const interactions = await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.issueId, issueId));
    expect(interactions.find((row) => row.title === "Approve continuation")?.sourceIdentityContextId).toBe(pending!.id);
  });

  it("fails closed once the run is no longer active", async () => {
    await db
      .update(heartbeatRuns)
      .set({ status: "succeeded" })
      .where(eq(heartbeatRuns.id, runId));
    const authority = new PaperclipRunnerToolAuthority(db, {
      companyId,
      agentId,
      issueId,
      runId,
    });
    await expect(
      authority.execute({
        tool: "get_task_context",
        callId: "late",
        arguments: {},
      }),
    ).rejects.toThrow("paperclip_runner_tool_binding_not_authorized");
  });
});
