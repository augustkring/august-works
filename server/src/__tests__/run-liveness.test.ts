import { describe, expect, it } from "vitest";
import { classifyRunLiveness, countRunLivenessActivityEvidence, isRunLivenessPlatformActivity } from "../services/run-liveness.ts";

const baseInput = {
  runStatus: "succeeded",
  issue: {
    status: "in_progress",
    title: "Implement feature",
    description: "Add the requested behavior.",
  },
  resultJson: null,
  stdoutExcerpt: null,
  stderrExcerpt: null,
  error: null,
  errorCode: null,
  continuationAttempt: 0,
  evidence: null,
};

describe("run liveness classifier", () => {
  it("classifies text-only future work as plan_only", () => {
    const classification = classifyRunLiveness({
      ...baseInput,
      resultJson: {
        summary: "I will inspect the repo next and then implement the fix.",
      },
    });

    expect(classification.livenessState).toBe("plan_only");
    expect(classification.actionability).toBe("runnable");
    expect(classification.nextAction).toContain("inspect the repo");
  });

  it("classifies empty successful output as empty_response", () => {
    const classification = classifyRunLiveness(baseInput);

    expect(classification.livenessState).toBe("empty_response");
    expect(classification.actionability).toBe("unknown");
  });

  it("treats issue comments, documents, products, and actions as progress", () => {
    const latestEvidenceAt = new Date("2026-04-18T12:00:00Z");
    const classification = classifyRunLiveness({
      ...baseInput,
      resultJson: {
        summary: "Updated implementation.",
      },
      evidence: {
        issueCommentsCreated: 1,
        documentRevisionsCreated: 1,
        workProductsCreated: 1,
        toolOrActionEventsCreated: 1,
        latestEvidenceAt,
      },
    });

    expect(classification.livenessState).toBe("advanced");
    expect(classification.lastUsefulActionAt).toBe(latestEvidenceAt);
  });

  it("does not treat workspace operations alone as concrete progress", () => {
    const classification = classifyRunLiveness({
      ...baseInput,
      resultJson: {
        summary: "I will inspect the repo next.",
      },
      evidence: {
        workspaceOperationsCreated: 1,
        latestEvidenceAt: new Date("2026-04-18T12:00:00Z"),
      },
    });

    expect(classification.livenessState).toBe("plan_only");
    expect(classification.lastUsefulActionAt).toBeNull();
  });

  it("uses explicit planning mode for the planning diagnostic exemption", () => {
    const classification = classifyRunLiveness({
      ...baseInput,
      issue: {
        status: "in_progress",
        title: "Draft implementation plan",
        description: "Create a plan for the work.",
        workMode: "planning",
      },
      resultJson: {
        summary: "Plan:\n- Inspect files\n- Implement after approval",
      },
    });

    expect(classification.livenessState).toBe("advanced");
  });

  it.each([undefined, null, "standard", "ask", "skill_test", "planning"])(
    "title and description cannot change liveness in explicit mode %s",
    (workMode) => {
      const input = {
        ...baseInput,
        issue: { ...baseInput.issue, workMode },
        resultJson: { summary: "I will inspect the repo next." },
      };
      const expected = classifyRunLiveness(input);
      expect(expected.livenessState).toBe(workMode === "planning" ? "advanced" : "plan_only");
      for (const text of ["plan", "planning", "analysis", "investigation", "research", "report", "proposal", "design doc", "write-up", "making a plan", "No plan requested", "Preparar un plan"]) {
        for (const prose of [{ title: `Implement ${text} export` }, { description: `Create a ${text} exporter.` }]) {
          expect(classifyRunLiveness({ ...input, issue: { ...input.issue, ...prose } })).toEqual(expected);
        }
      }
    },
  );

  it("a standard-mode task can deliver a plan and complete without entering planning mode", () => {
    const input = {
      ...baseInput,
      issue: { ...baseInput.issue, workMode: "standard", title: "Write a plan" },
      resultJson: { summary: "Plan:\n1. Inspect files.\n2. Implement the service." },
      evidence: { documentRevisionsCreated: 1, planDocumentRevisionsCreated: 1 },
    };
    expect(classifyRunLiveness(input).livenessState).toBe("advanced");
    expect(classifyRunLiveness({ ...input, issue: { ...input.issue, status: "done" } }).livenessState).toBe("completed");
  });

  it("exempts runs that update the plan document from plan-only classification", () => {
    const classification = classifyRunLiveness({
      ...baseInput,
      resultJson: {
        summary: "Next steps:\n- inspect files\n- implement the service",
      },
      evidence: {
        documentRevisionsCreated: 1,
        planDocumentRevisionsCreated: 1,
        latestEvidenceAt: new Date("2026-04-18T12:00:00Z"),
      },
    });

    expect(classification.livenessState).toBe("advanced");
  });

  it("classifies done issues as completed", () => {
    const classification = classifyRunLiveness({
      ...baseInput,
      issue: {
        ...baseInput.issue,
        status: "done",
      },
      resultJson: {
        summary: "Finished the implementation.",
      },
    });

    expect(classification.livenessState).toBe("completed");
  });

  it("classifies declared blockers as blocked", () => {
    const classification = classifyRunLiveness({
      ...baseInput,
      resultJson: {
        summary: "I cannot proceed because I need access credentials.",
      },
    });

    expect(classification.livenessState).toBe("blocked");
    expect(classification.actionability).toBe("blocked_external");
  });

  it("treats PAP-2000-style validation output as runnable follow-up, not an external blocker", () => {
    const classification = classifyRunLiveness({
      ...baseInput,
      resultJson: {
        summary: "PAP-1949 remains blocked until PAP-2000 is resolved.",
      },
      issueCommentBodies: [
        [
          "Validation is ready for the next pass.",
          "",
          "- Blocked chain context: PAP-1949 -> PAP-1999 -> PAP-2000",
          "- Next action: run npm test and report the row counts.",
        ].join("\n"),
      ],
    });

    expect(classification.livenessState).toBe("plan_only");
    expect(classification.actionability).toBe("runnable");
    expect(classification.nextAction).toBe("run npm test and report the row counts.");
  });

  it("prefers durable comments over raw transcript next-action noise", () => {
    const classification = classifyRunLiveness({
      ...baseInput,
      issueCommentBodies: ["Next action: run pnpm test -- --runInBand."],
      stdoutExcerpt: [
        "tool_call: write",
        "command: rm -rf production-data",
        "Next action: deploy to production",
      ].join("\n"),
    });

    expect(classification.actionability).toBe("runnable");
    expect(classification.nextAction).toBe("run pnpm test -- --runInBand.");
  });

  it("keeps approval requests out of automatic continuation", () => {
    const classification = classifyRunLiveness({
      ...baseInput,
      resultJson: {
        summary: "Next action: wait for board approval before continuing.",
      },
    });

    expect(classification.livenessState).toBe("blocked");
    expect(classification.actionability).toBe("approval_required");
    expect(classification.nextAction).toBe("wait for board approval before continuing.");
  });

  it("routes production-sensitive next actions to manager review", () => {
    const classification = classifyRunLiveness({
      ...baseInput,
      resultJson: {
        summary: "Next action: deploy to production and verify live traffic.",
      },
    });

    expect(classification.livenessState).toBe("needs_followup");
    expect(classification.actionability).toBe("manager_review");
    expect(classification.nextAction).toBe("deploy to production and verify live traffic.");
  });


  it("uses killed background-task evidence instead of a generic failed-run reason", () => {
    const classification = classifyRunLiveness({
      ...baseInput,
      runStatus: "failed",
      errorCode: "process_lost",
      resultJson: {
        stopReason: "unmanaged_background_task_stopped",
        unmanagedBackgroundTask: {
          kind: "orphaned_process_group_cleanup",
          stopped: true,
          stopReason: "unmanaged_background_task_stopped",
          reason: "unmanaged background task stopped; no durable live path",
        },
      },
    });

    expect(classification.livenessState).toBe("failed");
    expect(classification.livenessReason).toBe("unmanaged background task stopped; no durable live path");
  });

  it("marks unclear useful output as unknown actionability", () => {
    const classification = classifyRunLiveness({
      ...baseInput,
      resultJson: {
        summary: "Observed mixed output and left notes for a later pass.",
      },
    });

    expect(classification.livenessState).toBe("needs_followup");
    expect(classification.actionability).toBe("unknown");
    expect(classification.nextAction).toBeNull();
  });
});

describe("run liveness platform activity (T3)", () => {
  const agentId = "agent-1";
  // The rows the platform writes for every managed Native Run.
  const platformRows = [
    { action: "context.assembled", actorType: "agent", actorId: agentId, entityType: "context_manifest", details: { issueId: "issue-1" } },
    { action: "context.assembled", actorType: "agent", actorId: agentId, entityType: "context_manifest", details: null },
    { action: "environment.lease_acquired", actorType: "system", actorId: "heartbeat", entityType: "environment_lease", details: null },
    { action: "tool_gateway.discovery", actorType: "agent", actorId: agentId, entityType: "tool_gateway", details: null },
    { action: "issue.updated", actorType: "system", actorId: "native-status-committer", entityType: "issue",
      details: { source: "native_status_decision", fromStatus: "todo", toStatus: "in_progress" } },
    { action: "issue.comment_added", actorType: "agent", actorId: agentId, entityType: "issue",
      details: { commentId: "comment-1", source: "run_presentation_resolver" } },
    { action: "environment.lease_released", actorType: "system", actorId: "heartbeat", entityType: "environment_lease", details: null },
  ];
  // The incomplete `done` report a managed OpenCode Run sends for plan-only output.
  const incompleteDone = { summary: "I will inspect the repository next and implement the requested fix.",
    nativeResult: { schema: "paperclip.run_result.v1", reportedWorkDisposition: "done",
      summary: "I will inspect the repository next and implement the requested fix." } };
  const evidence = (activityEventsCreated: number, toolOrActionEventsCreated = 0) => ({ issueCommentsCreated: 0,
    documentRevisionsCreated: 0, planDocumentRevisionsCreated: 0, workProductsCreated: 0, workspaceOperationsCreated: 1,
    activityEventsCreated, toolOrActionEventsCreated, latestEvidenceAt: null });
  const classify = (rows: Parameters<typeof countRunLivenessActivityEvidence>[0]) => classifyRunLiveness({
    ...baseInput, resultJson: incompleteDone, evidence: evidence(countRunLivenessActivityEvidence(rows)) });

  it("classifies only platform rows plus an incomplete done report as plan_only", () => {
    expect(countRunLivenessActivityEvidence(platformRows)).toBe(0);
    expect(classify(platformRows).livenessState).toBe("plan_only");
  });

  it("keeps an agent-authored comment or update as concrete evidence", () => {
    // The Run's own tool writes carry the tool transport details, not a platform source.
    const toolComment = { action: "issue.comment_added", actorType: "agent", actorId: agentId, entityType: "issue",
      details: { commentId: "comment-2", authorizationReason: "native_tool", transport: "paperclip_runner" } };
    const toolUpdate = { action: "issue.updated", actorType: "agent", actorId: agentId, entityType: "issue",
      details: { changedFields: ["title"], status: "in_progress", transport: "paperclip_runner" } };
    for (const row of [toolComment, toolUpdate]) {
      expect(isRunLivenessPlatformActivity(row)).toBe(false);
      expect(classify([...platformRows, row]).livenessState).toBe("advanced");
    }
    // A platform source claimed by another actor, action or entity is not platform activity.
    expect(isRunLivenessPlatformActivity({ ...platformRows[4]!, actorType: "agent", actorId: agentId })).toBe(false);
    expect(isRunLivenessPlatformActivity({ ...platformRows[5]!, action: "issue.updated" })).toBe(false);
    expect(isRunLivenessPlatformActivity({ ...platformRows[0]!, entityType: "issue" })).toBe(false);
  });

  it("keeps an agent tool effect as concrete evidence", () => {
    expect(classifyRunLiveness({ ...baseInput, resultJson: incompleteDone,
      evidence: evidence(countRunLivenessActivityEvidence(platformRows), 1) }).livenessState).toBe("advanced");
    const documentWrite = { action: "issue.document_upserted", actorType: "agent", actorId: agentId, entityType: "issue",
      details: { key: "result" } };
    expect(classify([...platformRows, documentWrite]).livenessState).toBe("advanced");
  });
});
