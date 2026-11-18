import { describe, expect, it } from "vitest";
import type { NativeEvidenceAssessment } from "./evidence-classifier.js";
import { arbitrateNativeStatus, nativeExecutionStageHandoffClaimed } from "./status-arbiter.js";

function assessment(
  overrides: Partial<NativeEvidenceAssessment> = {},
): NativeEvidenceAssessment {
  return {
    objectiveClaimSatisfied: true,
    objectiveSatisfied: true,
    allCriteriaSatisfied: true,
    verificationPassed: true,
    hasFailedVerification: false,
    hasBlockingRemainingWork: false,
    reportedDisposition: "done",
    summary: "Complete",
    contractRevisionMatches: true,
    criterionAssessments: [],
    verificationAssessments: [],
    verificationCaveats: [],
    acceptedEvidenceRefs: ["event:2"],
    missingRequirements: [],
    rejectedEvidence: [],
    unverifiableEvidence: [],
    blocker: null,
    continuation: null,
    attentionRequests: [],
    ignoredAttentionRequests: [],
    ...overrides,
  };
}

function arbitrate(
  overrides: Partial<Parameters<typeof arbitrateNativeStatus>[0]> = {},
) {
  return arbitrateNativeStatus({
    assessment: assessment(),
    terminalState: "succeeded",
    workspaceFinalizeStatus: "succeeded",
    agentId: "agent",
    priorIssueStatus: "in_progress",
    ...overrides,
  });
}

describe("native status authority", () => {
  it("a reviewer finishes its decision without completing rejected or still-reviewed work", () => {
    for (const priorIssueStatus of ["in_progress", "in_review"] as const) {
      const decision = arbitrate({ priorIssueStatus, nativeReviewOutcome: "resolved" });
      expect(decision).toMatchObject({ statusAction: "preserve", toStatus: priorIssueStatus });
      expect(decision.effects).not.toContainEqual(expect.objectContaining({ kind: "enqueue_continuation" }));
    }
  });

  it("routes an unfinished reviewer action to bounded recovery instead of retrying the worker task", () => {
    const decision = arbitrate({ priorIssueStatus: "in_review", nativeReviewOutcome: "pending" });
    expect(decision).toMatchObject({ statusAction: "preserve", toStatus: "in_review" });
    expect(decision.effects).toContainEqual(expect.objectContaining({
      kind: "record_recovery", cause: "native_review_unresolved", agentId: "agent",
    }));
    expect(decision.effects.some((effect) => ["enqueue_continuation", "schedule_retry"].includes(effect.kind))).toBe(false);
  });

  it("treats only the authorized Board response_wake as passive and preserves governance", () => {
    const passive = assessment({
      reportedDisposition: "yielded",
      continuation: {
        kind: "response_wake",
        summary: "Wait for the next request",
        idempotencyKey: "board-wait",
      },
    });
    expect(
      arbitrate({ assessment: passive, boardResponseWaitAuthorized: true }),
    ).toMatchObject({
      reasonCode: "board_response_waiting",
      toStatus: "in_progress",
      effects: [],
    });
    expect(arbitrate({ assessment: passive })).toMatchObject({
      reasonCode: "live_continuation_registered",
      effects: [expect.objectContaining({ kind: "enqueue_continuation" })],
    });
    expect(
      arbitrate({ assessment: passive, boardResponseWaitOrigin: true }),
    ).toMatchObject({
      reasonCode: "board_response_wait_superseded",
      statusAction: "preserve",
      effects: [],
    });
    expect(
      arbitrate({
        assessment: passive,
        boardResponseWaitAuthorized: true,
        governanceGate: { kind: "approval", id: "approval" },
      }),
    ).toMatchObject({
      reasonCode: "governed_response_waiting",
      toStatus: "in_review",
      effects: [expect.objectContaining({ kind: "create_interaction" })],
    });
    for (const kind of ["same_agent", "retry", "monitor"] as const) {
      expect(
        arbitrate({
          assessment: {
            ...passive,
            continuation: { ...passive.continuation!, kind },
          },
          boardResponseWaitAuthorized: true,
        }),
      ).toMatchObject({
        reasonCode: "live_continuation_registered",
        effects: [expect.objectContaining({ continuationKind: kind })],
      });
    }
  });
  it("marks done only from successful finalization and complete durable evidence", () => {
    expect(arbitrate()).toEqual(
      expect.objectContaining({
        statusAction: "done",
        toStatus: "done",
        reasonCode: "completion_contract_satisfied",
        effects: [{ kind: "release_checkout" }],
      }),
    );
    expect(arbitrate({ completionClaimPolicyAccepted: true })).toEqual(
      expect.objectContaining({
        statusAction: "done",
        reasonCode: "completion_claim_policy_accepted",
      }),
    );
    expect(
      arbitrate({
        assessment: assessment({
          verificationPassed: false,
          missingRequirements: ["test"],
        }),
      }),
    ).toEqual(
      expect.objectContaining({
        statusAction: "in_progress",
        toStatus: "in_progress",
        reasonCode: "completion_evidence_incomplete",
        effects: [expect.objectContaining({ kind: "enqueue_continuation" })],
      }),
    );
    const claimOnly = assessment({
      objectiveSatisfied: false,
      allCriteriaSatisfied: false,
      verificationPassed: false,
      criterionAssessments: [
        {
          criterionId: "objective",
          claimStatus: "satisfied",
          outcome: "missing",
          evidenceRefs: [],
          reasonCode: "criterion_evidence_missing",
        },
      ],
      verificationAssessments: [
        {
          commandOrCheck: "Answered the question",
          claimStatus: "passed",
          outcome: "unverifiable",
          evidenceRef: null,
          reasonCode: "verification_has_no_durable_reference",
          reportedReasonCode: null,
          detail: null,
        },
      ],
      acceptedEvidenceRefs: [],
      missingRequirements: ["objective"],
    });
    expect(arbitrate({ assessment: claimOnly })).toEqual(
      expect.objectContaining({
        toStatus: "in_progress",
        reasonCode: "completion_evidence_incomplete",
      }),
    );
    expect(
      arbitrate({ assessment: claimOnly, completionClaimPolicyAccepted: true }),
    ).toEqual(
      expect.objectContaining({
        toStatus: "done",
        reasonCode: "completion_claim_policy_accepted",
      }),
    );
  });

  it("creates explicit liveness paths for review, continuation, cancellation, and governance", () => {
    expect(
      arbitrate({
        assessment: assessment({ reportedDisposition: "needs_review" }),
      }),
    ).toEqual(
      expect.objectContaining({
        toStatus: "in_progress",
        effects: [expect.objectContaining({ kind: "enqueue_continuation" })],
      }),
    );
    expect(
      arbitrate({
        assessment: assessment({
          reportedDisposition: "yielded",
          continuation: {
            kind: "retry",
            summary: "Retry the task",
            idempotencyKey: "retry-task",
          },
        }),
      }),
    ).toEqual(
      expect.objectContaining({
        toStatus: "in_progress",
        effects: [
          expect.objectContaining({
            kind: "enqueue_continuation",
            continuationKind: "retry",
          }),
        ],
      }),
    );
    const externalChatWait = assessment({
      reportedDisposition: "yielded",
      continuation: {
        kind: "response_wake",
        summary: "Wait for the next authorized provider message",
        idempotencyKey: "external-chat-wait",
      },
    });
    expect(
      arbitrate({
        assessment: externalChatWait,
        externalChatResponseWaitAuthorization: "authorized",
      }),
    ).toEqual(
      expect.objectContaining({
        statusAction: "in_progress",
        toStatus: "in_progress",
        reasonCode: "external_chat_response_waiting",
        effects: [],
      }),
    );
    expect(
      arbitrate({
        assessment: externalChatWait,
        externalChatResponseWaitAuthorization: "revoked",
      }),
    ).toEqual(
      expect.objectContaining({
        statusAction: "preserve",
        toStatus: "in_progress",
        reasonCode: "external_chat_response_wait_authorization_lost",
        effects: [],
      }),
    );
    expect(
      arbitrate({
        assessment: externalChatWait,
        externalChatResponseWaitAuthorization: "not_applicable",
      }),
    ).toEqual(
      expect.objectContaining({
        reasonCode: "live_continuation_registered",
        effects: [
          expect.objectContaining({
            kind: "enqueue_continuation",
            continuationKind: "response_wake",
          }),
        ],
      }),
    );
    expect(arbitrate({ terminalState: "cancelled" })).toEqual(
      expect.objectContaining({
        toStatus: "in_progress",
        effects: [expect.objectContaining({ kind: "release_run_resources" })],
      }),
    );
    expect(
      arbitrate({ governanceGate: { kind: "interaction", id: "interaction" } }),
    ).toEqual(
      expect.objectContaining({
        toStatus: "in_review",
        reasonCode: "governed_gate_pending",
        effects: [
          {
            kind: "create_interaction",
            gate: { kind: "interaction", id: "interaction" },
          },
          {
            kind: "notify_owner",
            agentId: "agent",
            reason: "governed_gate_pending",
          },
        ],
      }),
    );
    expect(
      arbitrate({
        governanceGate: { kind: "interaction", id: "interaction" },
        assessment: assessment({
          reportedDisposition: "yielded",
          continuation: {
            kind: "response_wake",
            summary: "Resume from the response",
            idempotencyKey: "interaction-response:interaction",
          },
        }),
      }),
    ).toEqual(
      expect.objectContaining({
        toStatus: "in_review",
        reasonCode: "governed_response_waiting",
        effects: [
          {
            kind: "create_interaction",
            gate: { kind: "interaction", id: "interaction" },
          },
        ],
      }),
    );
  });

  it("accepts low-risk completion claims with unrun verification caveats", () => {
    const withCaveat = assessment({
      verificationPassed: false,
      criterionAssessments: [
        {
          criterionId: "objective",
          claimStatus: "satisfied",
          outcome: "missing",
          evidenceRefs: [],
          reasonCode: "criterion_evidence_missing",
        },
      ],
      verificationAssessments: [
        {
          commandOrCheck: "Run npm test",
          claimStatus: "not_run",
          outcome: "missing",
          evidenceRef: null,
          reasonCode: "verification_not_run",
          reportedReasonCode: "tool_unavailable",
          detail: "Node and npm are unavailable in this environment.",
        },
      ],
      verificationCaveats: [
        {
          commandOrCheck: "Run npm test",
          reasonCode: "tool_unavailable",
          detail: "Node and npm are unavailable in this environment.",
        },
      ],
    });

    expect(
      arbitrate({
        assessment: withCaveat,
        completionClaimPolicyAccepted: true,
      }),
    ).toEqual(
      expect.objectContaining({
        toStatus: "done",
        reasonCode: "completion_claim_policy_accepted",
      }),
    );
  });

  it("keeps failed verification with the agent and routes explicit attention to its owner", () => {
    const failed = assessment({
      verificationPassed: false,
      hasFailedVerification: true,
      verificationAssessments: [
        {
          commandOrCheck: "Run npm test",
          claimStatus: "failed",
          outcome: "rejected",
          evidenceRef: null,
          reasonCode: "verification_reported_failed",
          reportedReasonCode: null,
          detail: "One test failed.",
        },
      ],
    });
    expect(
      arbitrate({
        assessment: failed,
        completionClaimPolicyAccepted: true,
        reviewOwnerUserId: "user-1",
      }),
    ).toEqual(
      expect.objectContaining({
        toStatus: "in_progress",
        reasonCode: "completion_evidence_incomplete",
        effects: [
          expect.objectContaining({
            kind: "enqueue_continuation",
            agentId: "agent",
          }),
        ],
      }),
    );

    const withAttention = assessment({
      attentionRequests: [
        {
          kind: "approval",
          summary: "Approve publication",
          ownerClass: "human",
          targetAgentId: null,
          sourceIndex: 0,
          sourceKind: "approval",
          legacy: false,
        },
      ],
    });
    expect(
      arbitrate({
        assessment: withAttention,
        completionClaimPolicyAccepted: true,
      }),
    ).toEqual(
      expect.objectContaining({
        toStatus: "in_review",
        reasonCode: "actionable_attention_pending",
      }),
    );
  });

  it("blocks only for a task-wide blocker with a named owner and action", () => {
    expect(
      arbitrate({
        assessment: assessment({
          reportedDisposition: "blocked",
          blocker: {
            boardOwned: true,
            scope: "task_wide",
            unblockAction: "Approve access",
          },
        }),
      }),
    ).toEqual(
      expect.objectContaining({
        toStatus: "blocked",
        unblockDescriptor: { owner: "board", action: "Approve access" },
        effects: [
          { kind: "bind_blocker", owner: "board", action: "Approve access" },
          {
            kind: "notify_owner",
            agentId: "agent",
            reason: "task_wide_blocker_bound",
          },
        ],
      }),
    );
  });

  it("waits for an explicit unblock instead of inventing another productive track", () => {
    expect(
      arbitrate({
        assessment: assessment({
          reportedDisposition: "blocked",
          objectiveClaimSatisfied: false,
          objectiveSatisfied: false,
          allCriteriaSatisfied: false,
          verificationPassed: false,
          hasBlockingRemainingWork: true,
          blocker: {
            boardOwned: false,
            scope: "current_track",
            unblockAction:
              "Grant access to the current Board comment attachment, then explicitly retry.",
          },
        }),
      }),
    ).toEqual(
      expect.objectContaining({
        statusAction: "blocked",
        toStatus: "blocked",
        policyVersion: "phase6-v6",
        reasonCode: "current_track_blocker_waiting",
        unblockDescriptor: {
          owner: "board",
          action:
            "Grant access to the current Board comment attachment, then explicitly retry.",
        },
        effects: [
          {
            kind: "bind_blocker",
            owner: "board",
            action:
              "Grant access to the current Board comment attachment, then explicitly retry.",
          },
        ],
      }),
    );
  });

  it("blocks a current-track result when a durable dependency already gates the issue", () => {
    expect(
      arbitrate({
        assessment: assessment({
          reportedDisposition: "blocked",
          blocker: {
            boardOwned: false,
            scope: "current_track",
            unblockAction: "Wait for child task DOT-52",
          },
        }),
        hasUnresolvedIssueBlockers: true,
      }),
    ).toEqual(
      expect.objectContaining({
        statusAction: "blocked",
        toStatus: "blocked",
        reasonCode: "durable_dependency_blocker_bound",
        unblockDescriptor: {
          owner: { agentId: "agent" },
          action: "Wait for child task DOT-52",
        },
        effects: [],
      }),
    );
  });

  it("lets a durable dependency override an optimistic done result", () => {
    expect(
      arbitrate({
        assessment: assessment({ reportedDisposition: "done", blocker: null }),
        completionClaimPolicyAccepted: true,
        hasUnresolvedIssueBlockers: true,
      }),
    ).toEqual(
      expect.objectContaining({
        statusAction: "blocked",
        toStatus: "blocked",
        reasonCode: "durable_dependency_blocker_bound",
        effects: [],
      }),
    );
  });

  it("does not create a duplicate review after this run's review was already accepted", () => {
    expect(
      arbitrate({
        assessment: assessment({
          reportedDisposition: "needs_review",
          attentionRequests: [
            {
              kind: "review",
              summary: "Accept the plan",
              ownerClass: "human",
              targetAgentId: null,
              sourceIndex: 0,
              sourceKind: "review",
              legacy: false,
            },
          ],
        }),
        governanceResolvedForRun: true,
      }),
    ).toEqual(
      expect.objectContaining({
        statusAction: "in_review",
        reasonCode: "governance_response_continuation_queued",
        effects: [],
      }),
    );
  });

  it("does not create a duplicate review after this run's planning confirmation was already accepted", () => {
    expect(
      arbitrate({
        assessment: assessment({
          reportedDisposition: "blocked",
          attentionRequests: [
            {
              kind: "approval",
              summary: "Accept the pinned plan revision.",
              ownerClass: "human",
              targetAgentId: null,
              sourceIndex: 0,
              sourceKind: "approval",
              legacy: false,
            },
          ],
        }),
        governanceResolvedForRun: true,
      }),
    ).toEqual(
      expect.objectContaining({
        statusAction: "in_review",
        reasonCode: "governance_response_continuation_queued",
        effects: [],
      }),
    );
  });

  it("preserves authoritative terminal statuses", () => {
    expect(arbitrate({ priorIssueStatus: "done" })).toEqual(
      expect.objectContaining({
        toStatus: "done",
        reasonCode: "terminal_status_preserved",
        effects: [],
      }),
    );
  });
  it("routes each explicit request to its own reviewer", () => {
    const decision = arbitrate({ assessment: assessment({ attentionRequests: [
      { kind: "approval", summary: "Approve release", ownerClass: "human", targetAgentId: null, sourceIndex: 0, sourceKind: "approval", legacy: false },
      { kind: "review", summary: "Review code", ownerClass: "agent", targetAgentId: "review-agent", sourceIndex: 1, sourceKind: "review", legacy: false },
    ] }), reviewOwnerUserId: "release-owner" });
    expect(decision.effects).toEqual([
      expect.objectContaining({ kind: "bind_reviewer", requestKey: "attention-0", prompt: "Approve release", ownerUserId: "release-owner", ownerAgentId: null }),
      expect.objectContaining({ kind: "bind_reviewer", requestKey: "attention-1", prompt: "Review code", ownerUserId: null, ownerAgentId: "review-agent" }),
    ]);
  });

});


it("preserves the already blocked Task only for a verified read-only Human dependency response", () => {
  const bounded = { priorIssueStatus: "blocked" as const, hasUnresolvedIssueBlockers: true,
    assessment: assessment({ reportedDisposition: "blocked", objectiveClaimSatisfied: false, objectiveSatisfied: false,
      allCriteriaSatisfied: false, hasBlockingRemainingWork: true }) };
  expect(arbitrate({ ...bounded, readonlyDependencyInteraction: true })).toMatchObject({
    statusAction: "preserve", toStatus: "blocked", reasonCode: "durable_dependency_blocker_bound", unblockDescriptor: null, effects: [] });
  // Ordinary blocked work still uses its existing durable blocker projection.
  expect(arbitrate(bounded)).toMatchObject({ statusAction: "blocked", toStatus: "blocked", reasonCode: "durable_dependency_blocker_bound" });
  expect(arbitrate({ ...bounded, readonlyDependencyInteraction: true, priorIssueStatus: "in_progress" }))
    .toMatchObject({ statusAction: "blocked", toStatus: "blocked" });
  expect(arbitrate({ ...bounded, readonlyDependencyInteraction: true,
    assessment: assessment({ reportedDisposition: "done" }) })).toMatchObject({ statusAction: "blocked", toStatus: "blocked" });
});

describe("MS1f execution-policy stage handoff", () => {
  type Criterion = NativeEvidenceAssessment["criterionAssessments"][number];
  const documentRef = (outputKey: string | undefined, outcome: "accepted" | "unverifiable" = "accepted") => ({
    ref: `document:00000000-0000-4000-8000-00000000000a:00000000-0000-4000-8000-00000000000b`,
    kind: "document" as const, outcome, durableRecordId: "00000000-0000-4000-8000-00000000000b",
    reasonCode: outcome === "accepted" ? "task_document_output_current" : "document_evidence_other_criterion",
    ...(outputKey ? { outputKey } : {}),
  });
  const attachmentRef = (outcome: "accepted" | "missing") => ({ ref: "attachment:00000000-0000-4000-8000-00000000000c",
    kind: "attachment" as const, outcome, reasonCode: outcome === "accepted" ? "attachment_persisted" : "attachment_missing",
    durableRecordId: outcome === "accepted" ? "00000000-0000-4000-8000-00000000000c" : null });
  const output: Criterion = { criterionId: "output_result", claimStatus: "satisfied", outcome: "accepted",
    evidenceRefs: [documentRef("result")], reasonCode: "criterion_evidence_accepted" };
  const reviewerDecision: Criterion = { criterionId: "invariant_0", claimStatus: "unknown", outcome: "unverifiable",
    evidenceRefs: [], reasonCode: "criterion_claim_not_satisfied" };
  // The planned executor's claim: its document output is evidenced, the
  // Reviewer's later decision is unknown, nothing is verified yet.
  const claim = (overrides: Partial<NativeEvidenceAssessment> = {}) => assessment({
    objectiveSatisfied: false, allCriteriaSatisfied: false, verificationPassed: false, acceptedEvidenceRefs: [],
    criterionAssessments: [output, reviewerDecision], ...overrides,
  });
  const handoff = { policyVersion: "phase6-v6", statusAction: "in_review", toStatus: "in_review",
    reasonCode: "execution_policy_stage_handoff", unblockDescriptor: null, effects: [{ kind: "release_checkout" }] };

  it("hands a planned executor's evidenced claim to the declared stage", () => {
    expect(arbitrate({ assessment: claim(), executionStageHandoffAvailable: true })).toEqual(handoff);
    // The used incomplete continuation does not prevent a later correct claim from handing off.
    expect(arbitrate({ assessment: claim(), executionStageHandoffAvailable: true, allowIncompleteContinuation: false }))
      .toEqual(handoff);
    expect(arbitrate({ assessment: claim({ criterionAssessments: [output] }), executionStageHandoffAvailable: true }))
      .toEqual(handoff);
  });

  it("keeps an incomplete claim incomplete when no stage would become pending", () => {
    for (const executionStageHandoffAvailable of [false, undefined]) {
      expect(arbitrate({ assessment: claim(), executionStageHandoffAvailable }))
        .toMatchObject({ statusAction: "in_progress", toStatus: "in_progress", reasonCode: "completion_evidence_incomplete" });
    }
  });

  it("refuses the handoff for a not_satisfied criterion or any other unmet condition", () => {
    const notSatisfied: Criterion = { ...reviewerDecision, claimStatus: "not_satisfied", outcome: "rejected",
      reasonCode: "criterion_reported_not_satisfied" };
    const refused: Array<[string, NativeEvidenceAssessment]> = [
      ["a not_satisfied criterion", claim({ criterionAssessments: [output, notSatisfied] })],
      ["a satisfied claim with rejected evidence", claim({ criterionAssessments: [output, { ...reviewerDecision,
        claimStatus: "satisfied", outcome: "rejected", reasonCode: "criterion_evidence_rejected" }] })],
      ["a missing criterion claim", claim({ criterionAssessments: [output, { ...reviewerDecision, claimStatus: null,
        outcome: "missing", reasonCode: "criterion_claim_missing" }] })],
      ["an output without document evidence", claim({ criterionAssessments: [{ ...output, outcome: "unverifiable",
        evidenceRefs: [documentRef(undefined, "unverifiable")], reasonCode: "criterion_evidence_unverifiable" }, reviewerDecision] })],
      ["an output accepted from other evidence", claim({ criterionAssessments: [{ ...output, evidenceRefs: [attachmentRef("accepted")] },
        reviewerDecision] })],
      ["an output accepted from other evidence beside an unaccepted document", claim({ criterionAssessments: [{ ...output,
        evidenceRefs: [attachmentRef("accepted"), documentRef("result", "unverifiable")] }, reviewerDecision] })],
      ["an output document beside missing evidence", claim({ criterionAssessments: [{ ...output, outcome: "missing",
        evidenceRefs: [documentRef("result"), attachmentRef("missing")], reasonCode: "criterion_evidence_missing" }, reviewerDecision] })],
      ["an attachment carrying the output key", claim({ criterionAssessments: [{ ...output,
        evidenceRefs: [{ ...attachmentRef("accepted"), outputKey: "result" }] }, reviewerDecision] })],
      ["another output's document", claim({ criterionAssessments: [{ ...output, evidenceRefs: [documentRef("notes")] }, reviewerDecision] })],
      ["an unknown output", claim({ criterionAssessments: [{ ...output, claimStatus: "unknown", outcome: "unverifiable",
        evidenceRefs: [], reasonCode: "criterion_claim_not_satisfied" }, reviewerDecision] })],
      ["no output criterion", claim({ criterionAssessments: [reviewerDecision] })],
      ["an unclaimed objective", claim({ objectiveClaimSatisfied: false })],
      ["a stale contract revision", claim({ contractRevisionMatches: false })],
      ["a failed verification", claim({ hasFailedVerification: true })],
      ["a rejected verification", claim({ verificationAssessments: [{ commandOrCheck: "test", claimStatus: "passed",
        outcome: "rejected", evidenceRef: null, reasonCode: "work_product_rejected", reportedReasonCode: null, detail: null }] })],
      ["blocking remaining work", claim({ hasBlockingRemainingWork: true })],
    ];
    for (const [name, value] of refused) {
      const decision = arbitrate({ assessment: value, executionStageHandoffAvailable: true });
      expect({ name, reasonCode: decision.reasonCode }).toEqual({ name, reasonCode: "completion_evidence_incomplete" });
    }
    const attention = claim({ attentionRequests: [{ kind: "review", ownerClass: "human", summary: "Check this",
      sourceIndex: 0, sourceKind: "attention_request", targetAgentId: null } as never] });
    expect(nativeExecutionStageHandoffClaimed(claim())).toBe(true);
    expect(nativeExecutionStageHandoffClaimed(attention)).toBe(false);
    expect(arbitrate({ assessment: attention, executionStageHandoffAvailable: true }))
      .toMatchObject({ reasonCode: "actionable_attention_pending" });
    for (const reportedDisposition of ["needs_review", "yielded", "blocked"] as const) {
      expect(arbitrate({ assessment: claim({ reportedDisposition }), executionStageHandoffAvailable: true }).reasonCode)
        .not.toBe("execution_policy_stage_handoff");
    }
  });

  it("never completes the Task through the handoff and leaves agent_claim_policy unchanged", () => {
    const variants = [claim(), claim({ criterionAssessments: [output] }), claim({ verificationPassed: true })];
    for (const value of variants) {
      const decision = arbitrate({ assessment: value, executionStageHandoffAvailable: true });
      expect(decision.statusAction).not.toBe("done");
      expect(decision.toStatus).not.toBe("done");
    }
    // A complete claim keeps the existing done decision; the committer's done
    // path owns its stage transition and the plan-verification hold.
    const complete = assessment({ criterionAssessments: [output] });
    expect(arbitrate({ assessment: complete, executionStageHandoffAvailable: true }).reasonCode).toBe("completion_contract_satisfied");
    expect(arbitrate({ assessment: claim(), executionStageHandoffAvailable: true, completionClaimPolicyAccepted: true }))
      .toEqual(arbitrate({ assessment: claim(), completionClaimPolicyAccepted: true }));
  });
});
