# MS1f: execution-policy review stage on a planned Task

Date: 2026-11-18. Owner of the decisions: Claude (delegated by the owner). Ledger rows: MS1b, MS1f, MS1i, MS1h12b in `doc/plans/2026-11-12-claude-v10-verification.md`.

## Problem

On a Task covered by an orchestration plan, a declared execution-policy review stage can never run.

- The plan's completion contract is `server_arbiter`. `done` needs accepted durable evidence for every criterion and a passed verification.
- No evidence type exists for a Task document, so a document output can never be evidenced.
- Criteria about the Reviewer's later decision cannot be evidenced by the executor.
- The stage starts only from a `done` decision.
- The stage Reviewer is refused at admission ("Worker no longer has the plan's canonical assignment") and has no model authority.
- **Defect (high):** plan verification never reads the Task's execution state, so a Human can verify while a stage is still pending.

## What the brief requires

- **RT-03 (L8481-8493):** one charge identity and one accounting lineage under the root plan. No dummy Task and no bypassed reservation.
- **§57.1 (L8426-8428):** an independent verifier where consequence requires one. No second permission engine, and no competing state machine.
- **§50.4 (L7831):** a reviewer who did not author the change.
- **ONB-11 (L6011-6021):** "ready for review" is its own state. Only a passing canonical human review, with all deterministic evidence, can complete the plan or Task.

## Decisions

1. **Executor terminal claim: stage handoff.**
   - The arbiter gets a branch that yields `in_review` with reason `execution_policy_stage_handoff`. It applies only when all of these hold:
     - a V7 contract and a covering plan;
     - a dry-run stage transition that would enter a pending stage;
     - the objective is claimed and no criterion is `not_satisfied`;
     - every `output_*` criterion is accepted (decision 2);
     - no failed verification, no attention request and no blocking work.
   - The committer turns a pending handoff into the existing `execution_policy_stage_pending` decision. A handoff never becomes `done`; if no stage is pending, it falls back to `completion_evidence_incomplete`.
2. **Task document evidence.** A new evidence kind, `document:<docId>:<revisionId>`, is accepted only if all of these hold:
   - the document is linked to this Task under a declared required-output key;
   - it is the latest revision and its body matches;
   - its schema validates (if declared);
   - the revision was created by this Run;
   - there is a succeeded, charged `write_document` invocation on this Run with the same key.

   One helper, extracted from the verification service, serves both the classifier and verification. No migration.
3. **Criteria about the Reviewer's decision:**
   - The executor reports them as `unknown`.
   - Human verification gets `stage_decision:<decisionId>` packet evidence and a deterministic failure, `execution_stage_incomplete:<stageId>`. Verification refuses a pending stage, which closes the defect above.
4. **Stage Reviewer admission: a stage kind of the existing reviewer lane** (`NativeReviewAssignment.kind = "execution_stage"`).
   - The kind requires all of these:
     - the stage wake origin and a current status-wake intent;
     - a pending stage whose participant is the assignee and this Run;
     - a return assignee equal to the source plan Worker, who is not the Reviewer;
     - the executor's applied stage-pending decision;
     - a committed source Run with exactly one plan attempt.
   - It is read by admission, the review binding and qualification, the RuntimeControl session lane and the reviewer-lane predicates.
   - The `review_model` binding gets a `kind`, and a stage binding names `stageId`.
   - **Migration:**
     - add a `review_stage_id` column; a `review_model` reservation must name exactly one of the interaction or the stage;
     - the immutability trigger covers the new column;
     - the tool-charge trigger charges a stage Reviewer's stage-comment `call_api` once to the plan.
   - The gateway gets a stage-comment receipt branch, mirroring MS1h16. The finalizer passes the Reviewer outcome so the Reviewer's own result keeps its status.
5. **Stage approval under a plan.**
   - Both approval routes (comment auto-approve, PATCH) and the committer use one shared plan-coverage helper, moved from `issue-thread-interactions.ts`.
   - On the final approval the Task stays `in_review`, is reassigned to the plan Worker without a wake, the stage is completed, and the activity records `taskCompletion: "awaiting_plan_verification"`.
   - The 0360 guard stays as the backstop.
6. **MS1h12b, decided with this work.** A Reviewer must be able to read what it reviews. The stage Reviewer, and the completion Reviewer, may call `read_document` only for the Task's declared output documents. Each read is charged to the root plan. Every other read stays refused.
7. **Signoff cases 1 and 2 move to real-runner executors.** The test-seam executor backend can never produce a cleanup proof, and no production cleanup path is added for a test seam (MS1b, case 1). The e2e fixtures `managed-signoff-comment.ts` and `managed-pipeline-producer.ts` follow later.

## Phases (one PR each)

1. Verification refuses a pending stage (`execution_stage_incomplete`, `stage_decision` evidence), and stage approval under a plan holds the Task (decision 5).
2. Document evidence (decision 2) and the stage handoff (decision 1).
3. Stage Reviewer lane, migration, tool boundary, gateway and finalizer (decision 4), and output-document reads (decision 6).
4. Signoff cases 1 and 2 on real-runner executors, asserting root-plan charging, no Reviewer attempt, the Task held for verification, then Human verification gives `done`.

## Must stay unchanged

- The 0360 trigger.
- The MS1h14 accept path.
- Plan-less and `agent_claim_policy` behaviour.
- The purpose lists in the Host agent, the gateway and 0584.
- The stage-wake checks keyed on `execution_policy_stage_pending`.
- `selectStageParticipant`.
- The Reviewer's discarded workspace (MS1h17/MS1h18).
