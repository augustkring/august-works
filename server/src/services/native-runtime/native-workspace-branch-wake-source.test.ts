import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type Db, heartbeatRuns } from "@paperclipai/db";
import { captureNativeTaskWakeSource, buildNativeExecutionInput } from "./native-execution-input.js";
import { assertNativeWorkspaceMetadataSourcesCurrent } from "../native-direct-input.js";
import { nativeRuntimeContextFixture } from "./runtime-context.test-fixture.js";

describe("Native wake branch hint source components", () => {
  const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
  function fixture() {
    const companyId = randomUUID(), issueId = randomUUID(), runId = randomUUID(), agentId = randomUUID(), workspaceId = randomUUID();
    const task = { id: issueId, identifier: "WORK-1", title: "Literal request", description: "Do the task.",
      status: "in_progress", priority: "medium", workMode: "standard" };
    const execution = buildNativeExecutionInput({ companyId, runId, agentId, issue: task, taskPrompt: task.description,
      workspace: { id: workspaceId, cwd: "/workspace/current-task", repoUrl: "https://example.test/current.git",
        repoRef: "main", branchName: "WORK-1-current" }, normalizedSessionId: null,
      completionContract: { id: randomUUID(), sha256: `sha256:${"a".repeat(64)}`, schemaVersion: "paperclip.run-result.v1",
        contract: { revision: "1", objective: "Do the task", criteria: [{ id: "output", requirement: "Do the task" }] } },
      runtimeContext: nativeRuntimeContextFixture() });
    const source = { kind: "workspace_metadata" as const, runId, executionWorkspaceId: workspaceId,
      origin: "execution_workspace" as const, sourceVersion: "2026-11-03T00:00:00.000Z", contentHash: sha(execution.workspace) };
    const payload = { reason: "on_demand", executionContinuation: null, attachmentOmissions: [], externalChatProvider: null,
      recovery: null, issue: { ...task, descriptionTruncated: false }, agentMessage: null, childIssueSummaries: [],
      childIssueSummaryTruncated: false, dispositionRepair: null, livenessContinuation: null, interactionKind: null,
      interactionStatus: null, interactionId: null, sourceRunId: null, externalChatQuestionResponse: null,
      externalInteractionContinuation: false, checkboxSelection: null, checkedOutByHarness: false, externalChatExecutionBound: false,
      simplifiedEnglishInteractions: false, dependencyBlockedInteraction: false, treeHoldInteraction: false, activeTreeHold: {},
      unresolvedBlockerIssueIds: [], unresolvedBlockerSummaries: [], executionStage: null, taskWatchdog: null, skillTest: null,
      continuationSummary: null, commentIds: [], latestCommentId: null, comments: [], annotationDeltas: [], planReviewContext: null,
      documentReviewContext: null, commentWindow: { requestedCount: 0, includedCount: 0, missingCount: 0 },
      truncated: false, fallbackFetchNeeded: false, executionWorkspace: { branchName: execution.workspace.branchName } };
    const input = { companyId, issueId, runId, agentId, sourceVersion: "1", persistedWakeReason: "on_demand", task, payload,
      workspaceCapture: { execution, source } };
    // Narrow DB component carrier: version/current tuple checks execute their
    // real initializer. This is not a PostgreSQL, ACL or Native Run proof.
    const workspaceRow = { id: workspaceId, ...execution.workspace, updatedAt: new Date(source.sourceVersion) };
    const run = { id: runId, runtimeMode: "native", agentId, runnerProfileJson: { nativeExecutionInput: execution } };
    const db = { select: () => ({ from: (table: unknown) => ({ where: () => ({
      for: async () => table === heartbeatRuns ? [run] : [workspaceRow],
    }) }) }) } as unknown as Db;
    return { input, db, workspaceRow };
  }

  it("captures the exact branch hint from the immutable Native workspace and current metadata owner", async () => {
    const f = fixture();
    expect(captureNativeTaskWakeSource(f.input)).toMatchObject({ kind: "native_task_wake", runId: f.input.runId,
      issueId: f.input.issueId, contentHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    await expect(assertNativeWorkspaceMetadataSourcesCurrent(f.db, f.input.companyId,
      [f.input.workspaceCapture.source])).resolves.toBeUndefined();
  });
  it("keeps the absent hint domain unchanged without borrowing a workspace capture", () => {
    const f = fixture(); const { executionWorkspace: _hint, ...payload } = f.input.payload;
    const result = captureNativeTaskWakeSource({ ...f.input, payload, workspaceCapture: undefined });
    expect(result).toMatchObject({ kind: "native_task_wake" });
  });
  it("requires a capture for a present hint and preserves its exact one-field shape", () => {
    const f = fixture(); expect(captureNativeTaskWakeSource({ ...f.input, workspaceCapture: undefined })).toBeNull();
    expect(captureNativeTaskWakeSource({ ...f.input, payload: { ...f.input.payload,
      executionWorkspace: { ...f.input.payload.executionWorkspace, cwd: "/foreign" } } })).toBeNull();
    expect(captureNativeTaskWakeSource({ ...f.input, payload: { ...f.input.payload, executionWorkspace: null } })).toBeNull();
  });
  it("rejects changed branch, tuple hash, origin and missing version", () => {
    let f = fixture(); f.input.payload.executionWorkspace.branchName = "different"; expect(captureNativeTaskWakeSource(f.input)).toBeNull();
    f = fixture(); f.input.workspaceCapture.source.contentHash = "f".repeat(64); expect(captureNativeTaskWakeSource(f.input)).toBeNull();
    f = fixture(); Reflect.set(f.input.workspaceCapture.source, "origin", "agent_home"); expect(captureNativeTaskWakeSource(f.input)).toBeNull();
    f = fixture(); Reflect.deleteProperty(f.input.workspaceCapture.source, "sourceVersion"); expect(captureNativeTaskWakeSource(f.input)).toBeNull();
    f = fixture(); Reflect.set(f.input.workspaceCapture.execution, "schema", "paperclip.native-execution-input.v3");
    expect(captureNativeTaskWakeSource(f.input)).toBeNull();
    const { executionWorkspace: _v3Hint, ...withoutHint } = f.input.payload;
    expect(captureNativeTaskWakeSource({ ...f.input, payload: withoutHint })).toMatchObject({ kind: "native_task_wake" });
  });
  it.each(["companyId", "issueId", "runId", "agentId", "executionWorkspaceId"] as const)("rejects foreign immutable binding %s", key => {
    const f = fixture(); f.input.workspaceCapture.execution.binding[key] = randomUUID();
    expect(captureNativeTaskWakeSource(f.input)).toBeNull();
  });
  it("the current owner rejects a different still-well-formed metadata version or actual changed workspace branch", async () => {
    let f = fixture(); f.input.workspaceCapture.source.sourceVersion = "2026-11-03T00:00:01.000Z";
    await expect(assertNativeWorkspaceMetadataSourcesCurrent(f.db, f.input.companyId,
      [f.input.workspaceCapture.source])).rejects.toBeDefined();
    f = fixture(); f.workspaceRow.branchName = "changed-after-capture";
    await expect(assertNativeWorkspaceMetadataSourcesCurrent(f.db, f.input.companyId,
      [f.input.workspaceCapture.source])).rejects.toBeDefined();
  });
});
