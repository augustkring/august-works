import { createHash, randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import {
  agents,
  chatActions,
  chatConversations,
  chatDeliveries,
  chatEndpoints,
  chatExternalPrincipals,
  chatIdentityLinks,
  chatMessageLinks,
  toolApplications,
  toolConnections,
  companies,
  createDb,
  heartbeatRuns,
  issues,
} from "@paperclipai/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { seedCurrentHumanSourceActor } from "../../__tests__/helpers/current-human-source-fixture.js";
import { issueService } from "../issues.js";
import { credentialFingerprint, runtimeGeneration } from "../chat-runtime-fence.js";
import { preparePlatformSkillAdmission } from "../platform-skill-admission.js";
import { blenteraPlatformContractHashes } from "../tool-gateway.js";
import { PaperclipRunnerToolAuthority } from "./paperclip-runner-tool-authority.js";
import { stageNativeRunnerAttachmentBytes } from "./native-runner-file-handoff.js";
import {
  findNativeChatWorkspaceScope,
  materializeNativeChatTaskRoot,
  nativeChatWorkspaceCwd,
  nativeChatWorkspaceMatches,
  type NativeChatWorkspaceScope,
} from "./native-chat-workspace.js";

describe("native external chat workspace boundary", () => {
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let instanceRoot: string;
  const companyId = "01000000-0000-4000-8000-000000000001";
  const agentId = "01000000-0000-4000-8000-000000000002";
  const issueA = "01000000-0000-4000-8000-000000000003";
  const issueB = "01000000-0000-4000-8000-000000000004";
  const boardIssue = "01000000-0000-4000-8000-000000000005";
  const runA = "01000000-0000-4000-8000-000000000009";
  const runB = "01000000-0000-4000-8000-000000000006";
  const conversationIssue = "01000000-0000-4000-8000-000000000007";
  const conversationRun = "01000000-0000-4000-8000-000000000008";
  const conversationUserId = "user-native-chat-owner";
  const taskOwnerUserId = "user-native-task-owner";
  const channelInputs = new Map<string, { runId: string; responsibleUserId: string;
    conversationSessionGeneration: number; sourceCommentId: string }>();
  const scopeInput = (issueId: string) => ({
    adapterType: "paperclip_runner",
    environmentDriver: "local",
    companyId,
    agentId,
    issueId,
    instanceRoot,
    ...channelInputs.get(issueId),
  });
  let scopeA: NativeChatWorkspaceScope;
  let scopeB: NativeChatWorkspaceScope;

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase(
      "native-chat-workspace-",
    );
    db = createDb(temporary.connectionString);
    instanceRoot = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "native-chat-workspace-")),
    );
    await db.insert(companies).values({
      id: companyId,
      name: "Chat workspaces",
      issuePrefix: "NCW",
      issueCounter: 3,
    });
    const conversationActor = await seedCurrentHumanSourceActor(db, [companyId], conversationUserId);
    const taskActor = await seedCurrentHumanSourceActor(db, [companyId], taskOwnerUserId);
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Native agent",
      adapterType: "paperclip_runner",
      status: "active",
    });
    await db.insert(issues).values(
      [issueA, issueB, boardIssue].map((id, index) => ({
        id,
        companyId,
        issueNumber: index + 1,
        identifier: `NCW-${index + 1}`,
        title: "Workspace boundary",
        status: "in_progress",
        assigneeAgentId: agentId,
        originKind: id === boardIssue ? "manual" : "chat_channel",
      })),
    );
    await db.insert(heartbeatRuns).values({
      id: runB,
      companyId,
      agentId,
      responsibleUserId: taskOwnerUserId,
      nativeIssueId: issueB,
      runtimeMode: "native",
      status: "running",
      invocationSource: "assignment",
      triggerDetail: "system",
      contextSnapshot: { issueId: issueB },
    });
    await db
      .update(issues)
      .set({ executionRunId: runB })
      .where(eq(issues.id, issueB));
    await preparePlatformSkillAdmission(db, { companyId, agentId, runId: runB,
      responsibleUserId: taskOwnerUserId, requireExisting: false }, blenteraPlatformContractHashes());
    await db.insert(issues).values({
      id: conversationIssue,
      companyId,
      issueNumber: 4,
      identifier: "NCW-4",
      title: "Authenticated native conversation",
      status: "in_progress",
      assigneeAgentId: agentId,
      conversationAgentId: agentId,
      conversationUserId,
      conversationState: "active",
      conversationSessionGeneration: 3,
      originKind: "manual",
    });
    await db.insert(heartbeatRuns).values({
      id: conversationRun,
      companyId,
      agentId,
      nativeIssueId: conversationIssue,
      responsibleUserId: conversationUserId,
      runtimeMode: "native",
      status: "running",
      invocationSource: "assignment",
      triggerDetail: "system",
      contextSnapshot: { issueId: conversationIssue, conversationSessionGeneration: 3 },
    });
    await db.update(issues).set({ executionRunId: conversationRun }).where(eq(issues.id, conversationIssue));
    // Component DB source graph only: no Host/SDK/process/accepted-result proof.
    // Match the original current channel owner, including its linked Human,
    // canonical comment writer, processed input and exact runtime fingerprint.
    const applicationId = randomUUID(), connectionId = randomUUID(), endpointId = randomUUID();
    const providerAccountId = "workspace-component-account";
    const endpointSetup = { step: "complete" } as const;
    await db.insert(toolApplications).values({ id: applicationId, companyId,
      applicationKey: `chat:discord:${endpointId}`, name: "Workspace component", type: "chat", status: "active" });
    await db.insert(toolConnections).values({ id: connectionId, companyId, applicationId,
      name: "Workspace component", uid: `workspace-${connectionId}`, connectionPurpose: "channel",
      transport: "chat_sdk", status: "active", enabled: true, healthStatus: "healthy", credentialSecretRefs: [] });
    await db.insert(chatEndpoints).values({ id: endpointId, companyId, connectionId,
      provider: "discord", publicId: randomUUID(), assignedAgentId: agentId,
      providerAccountId, externalExecutionPolicy: "agent", status: "active",
      allowDirectMessages: true, allowUnlinkedPeople: false, setup: endpointSetup });
    for (const input of [
      { issueId: issueA, runId: runA, userId: conversationUserId, actor: conversationActor },
      { issueId: issueB, runId: runB, userId: taskOwnerUserId, actor: taskActor },
    ]) {
      const conversationId = randomUUID(), deliveryId = randomUUID(), principalId = randomUUID();
      const threadId = `workspace-thread-${input.issueId}`;
      const sessionGeneration = 1;
      if (input.runId === runA) await db.insert(heartbeatRuns).values({ id: runA, companyId, agentId,
        responsibleUserId: input.userId, nativeIssueId: input.issueId, runtimeMode: "native",
        status: "running", invocationSource: "assignment", triggerDetail: "system",
        contextSnapshot: { issueId: input.issueId } });
      await db.update(issues).set({ executionRunId: input.runId, responsibleUserId: input.userId,
        originId: `${endpointId}:${threadId}:${sessionGeneration}` }).where(eq(issues.id, input.issueId));
      const comment = await issueService(db).addComment(input.issueId, "Current linked Human workspace input",
        { userId: input.userId }, { manualInputActor: input.actor });
      await db.insert(chatConversations).values({ id: conversationId, companyId, endpointId,
        issueId: input.issueId, externalConversationId: threadId, externalThreadId: threadId,
        externalLabel: "Current workspace Human", isDirectMessage: true, state: "active", sessionGeneration });
      await db.insert(chatExternalPrincipals).values({ id: principalId, companyId, provider: "discord",
        providerAccountId, externalId: input.userId, kind: "user", isBot: false });
      await db.insert(chatIdentityLinks).values({ companyId, endpointId, principalId,
        paperclipUserId: input.userId, status: "linked" });
      const providerMessageId = `workspace-message-${input.issueId}`;
      await db.insert(chatDeliveries).values({ id: deliveryId, companyId, endpointId, conversationId, principalId,
        providerEventId: providerMessageId, deduplicationKey: providerMessageId, eventKind: "message",
        state: "processed", processedAt: new Date(), attempts: 1,
        normalizedEvent: { runtimeContext: { generation: runtimeGeneration(endpointSetup), credentialFingerprint: credentialFingerprint([]) },
          conversation: { externalThreadId: threadId }, message: { providerMessageId } } });
      await db.insert(chatMessageLinks).values({ companyId, endpointId, conversationId, deliveryId,
        commentId: comment.id, providerMessageId, direction: "inbound" });
      await db.insert(chatActions).values({ companyId, endpointId, conversationId, deliveryId, principalId,
        kind: "inbound_wakeup", providerActionId: `workspace-wake-${input.issueId}`, status: "processed",
        payload: { version: 1, issueId: input.issueId, agentId, commentId: comment.id,
          sessionGeneration, requestedByActorType: "user", requestedByActorId: input.userId } });
      await db.update(heartbeatRuns).set({ contextSnapshot: { issueId: input.issueId,
        conversationSessionGeneration: sessionGeneration, wakeCommentId: comment.id } })
        .where(eq(heartbeatRuns.id, input.runId));
      channelInputs.set(input.issueId, { runId: input.runId, responsibleUserId: input.userId,
        conversationSessionGeneration: sessionGeneration, sourceCommentId: comment.id });
    }
    const currentA = await findNativeChatWorkspaceScope(db, scopeInput(issueA));
    const currentB = await findNativeChatWorkspaceScope(db, scopeInput(issueB));
    expect(currentA).not.toBeNull(); expect(currentB).not.toBeNull();
    scopeA = currentA!;
    scopeB = currentB!;
  });

  afterAll(async () => {
    try {
      await temporary?.cleanup();
    } finally {
      if (instanceRoot)
        await rm(instanceRoot, { recursive: true, force: true });
    }
  });

  it("uses distinct sibling task roots for one agent, stable across turns, outside the legacy agent home", async () => {
    const legacy = path.join(instanceRoot, "workspaces", agentId);
    await mkdir(legacy, { recursive: true });
    await writeFile(
      path.join(legacy, "old-private.txt"),
      "legacy task fixture",
    );
    const [rootA, rootB] = await Promise.all([
      materializeNativeChatTaskRoot(scopeA),
      materializeNativeChatTaskRoot(scopeB),
    ]);
    expect(rootA).not.toBe(rootB);
    expect(path.relative(rootA, rootB)).toBe(`../${issueB}`);
    expect(path.relative(legacy, rootA).startsWith("..")).toBe(true);
    expect(await readdir(rootA)).toEqual([]);
    expect(await readdir(rootB)).toEqual([]);
    await writeFile(
      path.join(rootA, "same-task.txt"),
      "same task continuation",
    );
    const resumedScope = (await findNativeChatWorkspaceScope(
      db,
      scopeInput(issueA),
    ))!;
    expect(await materializeNativeChatTaskRoot(resumedScope)).toBe(rootA);
    expect(await readFile(path.join(rootA, "same-task.txt"), "utf8")).toBe(
      "same task continuation",
    );
    expect(await readFile(path.join(legacy, "old-private.txt"), "utf8")).toBe(
      "legacy task fixture",
    );
  });

  it("keeps ordinary Board tasks and legacy adapters out while resolving chat scope for sandbox execution", async () => {
    expect(
      await findNativeChatWorkspaceScope(db, scopeInput(boardIssue)),
    ).toBeNull();
    expect(
      await findNativeChatWorkspaceScope(db, {
        ...scopeInput(issueA),
        adapterType: "codex_local",
      }),
    ).toBeNull();
    expect(await findNativeChatWorkspaceScope(db, {
      ...scopeInput(issueA),
      environmentDriver: "sandbox",
    })).toMatchObject({ companyId, agentId, issueId: issueA });
    await expect(
      findNativeChatWorkspaceScope(db, {
        ...scopeInput(issueA),
        companyId: "01000000-0000-4000-8000-000000000099",
      }),
    ).rejects.toThrow("native_chat_workspace_issue_unavailable");
    // Complete component rows never authorize a different caller/run/session or
    // another Task's comment, and absence of input identity stays closed.
    for (const changed of [
      { runId: runB }, { responsibleUserId: taskOwnerUserId },
      { conversationSessionGeneration: 2 },
      { sourceCommentId: channelInputs.get(issueB)!.sourceCommentId },
      { sourceCommentId: null }, { runId: null },
    ]) expect(await findNativeChatWorkspaceScope(db, { ...scopeInput(issueA), ...changed })).toBeNull();
  });

  it("selects a canonical projectless conversation only for its exact current Human, generation, and Run", async () => {
    const input = {
      ...scopeInput(conversationIssue),
      runId: conversationRun,
      responsibleUserId: conversationUserId,
      conversationSessionGeneration: 3,
    };
    const scope = await findNativeChatWorkspaceScope(db, input);
    expect(scope).toMatchObject({ companyId, agentId, issueId: conversationIssue, projectId: null });
    expect(await findNativeChatWorkspaceScope(db, { ...input, responsibleUserId: "foreign-human" })).toBeNull();
    expect(await findNativeChatWorkspaceScope(db, { ...input, conversationSessionGeneration: 4 })).toBeNull();
    expect(await findNativeChatWorkspaceScope(db, { ...input, runId: runB })).toBeNull();
    expect(await findNativeChatWorkspaceScope(db, scopeInput(conversationIssue))).toBeNull();
  });

  it("does not expose another active task's staged inbound files or register its generated file", async () => {
    const [rootA, rootB] = await Promise.all([
      materializeNativeChatTaskRoot(scopeA),
      materializeNativeChatTaskRoot(scopeB),
    ]);
    const body = Buffer.from("only task A fixture bytes");
    const stages = await Promise.all([
      stageNativeRunnerAttachmentBytes({ workspaceRoot: rootA, body }),
      stageNativeRunnerAttachmentBytes({
        workspaceRoot: rootB,
        body: Buffer.from("only task B fixture bytes"),
      }),
    ]);
    try {
      await expect(
        readFile(path.join(rootB, stages[0]!.workspaceRelativePath)),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await writeFile(path.join(rootA, "private-output.txt"), body);
      const authority = new PaperclipRunnerToolAuthority(db, {
        companyId,
        agentId,
        issueId: issueB,
        runId: runB,
        workspaceRoot: rootB,
        executionTargetKind: "local",
      });
      await expect(
        authority.execute({
          tool: "register_deliverable",
          callId: "foreign-generated-file",
          arguments: {
            idempotencyKey: "foreign-generated-file",
            filename: "private-output.txt",
            contentType: "text/plain",
            byteSize: body.length,
            sha256: createHash("sha256").update(body).digest("hex"),
            contentRef: path.relative(
              rootB,
              path.join(rootA, "private-output.txt"),
            ),
            title: "Foreign output",
          },
        }),
      ).rejects.toThrow("paperclip_runner_file_handoff_path_denied");
    } finally {
      await Promise.all(stages.map((stage) => stage.cleanup()));
    }
  });

  it("rejects shared or foreign project workspaces and honors only existing task-owned isolated worktrees", () => {
    const scope = { ...scopeA, projectId: "project-1" };
    const workspace = {
      companyId,
      projectId: "project-1",
      sourceIssueId: issueA,
      mode: "isolated_workspace",
      strategyType: "git_worktree",
      status: "active",
      cwd: "/task-owned-worktree",
      providerRef: "/task-owned-worktree",
    };
    expect(nativeChatWorkspaceCwd(scope, workspace, true)).toBe(workspace.cwd);
    expect(nativeChatWorkspaceCwd(scope, null, false)).toBeNull();
    for (const override of [
      { sourceIssueId: issueB },
      { companyId: "foreign" },
      { projectId: "foreign" },
      { mode: "shared_workspace" },
      { strategyType: "project_primary" },
      { status: "archived" },
      { providerRef: "/other" },
    ]) {
      expect(
        nativeChatWorkspaceCwd(scope, { ...workspace, ...override }, true),
      ).toBeNull();
    }
    expect(nativeChatWorkspaceCwd(scope, workspace, false)).toBeNull();
  });

  it("rejects an admitted legacy or other-task root without changing the immutable execution input", () => {
    const execution = {
      binding: { companyId, agentId, issueId: issueA },
      workspace: { cwd: scopeA.taskRoot },
    };
    expect(
      nativeChatWorkspaceMatches({
        scope: scopeA,
        expectedCwd: scopeA.taskRoot,
        execution,
      }),
    ).toBe(true);
    for (const cwd of [
      scopeB.taskRoot,
      path.join(instanceRoot, "workspaces", agentId),
    ]) {
      const oldInput = { ...execution, workspace: { cwd } };
      expect(
        nativeChatWorkspaceMatches({
          scope: scopeA,
          expectedCwd: scopeA.taskRoot,
          execution: oldInput,
        }),
      ).toBe(false);
      expect(oldInput.workspace.cwd).toBe(cwd);
    }
  });

  it("fails closed if an existing task directory is a symlink to another task", async () => {
    const target = {
      ...scopeA,
      issueId: "symlink-task",
      taskRoot: path.join(path.dirname(scopeA.taskRoot), "symlink-task"),
    };
    await symlink(scopeB.taskRoot, target.taskRoot);
    await expect(materializeNativeChatTaskRoot(target)).rejects.toThrow(
      "native_chat_workspace_path_not_isolated",
    );
  });
});
