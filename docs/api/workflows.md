# Workflows V1 API contract

**Feature flag:** `enableWorkflowsV1` (default off)
**Scope:** PR 11–24 persistence/API, typed Node Registry, manual executor V1, run-history/live-run API, deterministic branching, checkpoint/replay recovery, durable retries/waits, Human Approval, Routine → Workflow execution targets, and Pipeline → Workflow automation targets through the existing pipeline automation ledger. Task integration, callback/task waits, and side-effect node execution remain gated.

## Authorization

- owner/admin: read, edit, publish, run
- operator/member: read, edit, run
- viewer: read
- agents: no implicit Workflow grant
- HTTP create/edit/publish remains human-only until typed AI authoring/tool contracts are introduced

Permissions use the existing principal grant system:

- `workflows:read`
- `workflows:edit`
- `workflows:publish`
- `workflows:run`

## Revision model

Every draft save creates a new immutable draft snapshot. The previous draft becomes `discarded`.

Publish is compare-and-set over both current pointers: `expectedDraftRevisionId` and `expectedPublishedRevisionId`.

A successful publish supersedes the previous published revision, publishes the expected draft, and creates a new draft clone. A competing editor or publisher receives `revision_conflict`.

## Endpoints

| Method | Path | Authz | Concurrency | Side effect | Audit |
|---|---|---|---|---|---|
| GET | `/companies/:companyId/workflows/capabilities` | company access | none | read | none |
| GET | `/companies/:companyId/workflows` | read | none | read | none |
| GET | `/companies/:companyId/workflows/node-registry` | read | none | typed registry metadata | none |
| POST | `/companies/:companyId/workflows` | human + edit | transaction | workflow + draft rev 1 | `workflow.created` |
| GET | `/companies/:companyId/workflows/:id` | read | none | read | none |
| GET | `/companies/:companyId/workflows/:id/revisions` | read | none | read | none |
| PATCH | `/companies/:companyId/workflows/:id/draft` | human + edit | `expectedRevisionId` | new immutable draft | `workflow.draft_updated` |
| POST | `/companies/:companyId/workflows/:id/publish` | human + publish | expected draft + expected published | immutable publish + new draft clone | `workflow.revision_published` |
| GET | `/companies/:companyId/workflows/:id/runs?limit=30` | read | none | newest run summaries | none |
| POST | `/companies/:companyId/workflows/:id/run` | run | `Idempotency-Key` | durable manual run bound to published revision | workflow run/step activity |
| GET | `/companies/:companyId/workflow-runs/:runId` | read | none | run + step attempts + durable waits | none |

## Current publish gate

PR 13 validates every draft node against a typed registry and company-scoped references before persistence.

A registered node may be `ready` or `draft_only`. Publish fails closed with `workflow_node_invalid` / `node_not_publishable_yet` until the node's execution, authorization, retry/idempotency, and policy integration are implemented.

`core.manual_trigger`, `core.condition`, bounded `core.wait`, and `human.approval` are publish-ready. Transform, Connector Action, Create Task, and Agent Task remain intentionally draft-only until their dependent implementation waves land.

A Condition may be terminal or may expose exactly one `true` and one `false` branch. Branch labels/source handles are part of the published graph contract; ambiguous or duplicate condition branches fail publish.

## Stable errors

- `workflows_disabled`
- `permission_denied`
- `cross_company_reference`
- `revision_conflict`
- `workflow_invalid_transition`
- `workflow_node_invalid`
- `workflow_publish_approval_unsupported`
- `workflow_revision_not_published`
- `workflow_executor_capability_not_ready`
- `workflow_run_claim_conflict`
- `idempotency_key_invalid`
- `idempotency_key_reused`
- `workflow_condition_expression_invalid`
- `workflow_condition_reference_missing`
- `workflow_condition_type_invalid`
- `workflow_condition_branch_missing`
- `workflow_checkpoint_invalid`
- `workflow_checkpoint_path_conflict`
- `workflow_checkpoint_state_invalid`
- `workflow_execution_interrupted`
- `workflow_revision_unavailable_for_recovery`
- `workflow_step_retry_conflict`
- `workflow_step_retry_unsafe`
- `workflow_wait_config_invalid`
- `workflow_wait_deadline_exceeded`
- `workflow_wait_create_conflict`
- `workflow_wait_key_conflict`
- `workflow_wait_signal_conflict`
- `workflow_wait_resolution_conflict`
- `workflow_human_approval_config_invalid`
- `workflow_human_approval_create_conflict`
- `workflow_human_approval_rejected`
- `workflow_human_approval_cancelled`

## Current execution boundary

PR 16 introduced durable run/step records, manual-run idempotency and lease-based ownership. PR 18 adds deterministic `core.condition` execution and explicit true/false branch selection.

Condition expressions intentionally do not execute host JavaScript and never call an LLM. The current grammar supports boolean literals, boolean references, strict equality/inequality and finite numeric ordered comparisons over `trigger`, `variables` and prior `steps` outputs. Missing references or invalid runtime types fail closed into a durable failed step/run.

PR 19 adds checkpoint/replay recovery. Every running workflow carries an execution owner, heartbeat and expiring lease. The server reconciliation loop reclaims expired `RUNNING`/`RECOVERING` runs and abandoned `QUEUED` runs after a grace period. Recovery reloads the immutable published-or-superseded revision bound to the run, reuses `SUCCEEDED` step outputs as checkpoints, preserves a step interrupted by process loss as a failed attempt with `workflow_execution_interrupted`, and resumes that node as attempt `n+1`. A valid live lease is never stolen.

PR 20 makes retry policy executor-owned. Retry modes are `none`, `fixed`, or `exponential`; retry attempts are separate `workflow_step_runs` rows. A retryable failure may transition the current attempt to `retry_scheduled` and the run to `waiting`; reconciliation resumes only after the configured backoff, marks the old attempt `retried`, and executes attempt `n+1`. The retry decision fails closed unless the error is retryable, the side effect is safe to repeat/deduplicated, the retry budget and parent deadline permit it, and provider policy permits retry. A stable `workflow-step:<run>:<node-hash>` identity is derived once per logical step and remains constant across attempts.

Backoff does not hold an HTTP request or worker sleep open. The durable state itself is the source of truth, and the existing reconciliation loop owns wake-up. Current executable nodes are still pure/deterministic; Connector Action, Create Task and Agent Task remain draft-only until their execution-time authorization and real dedupe/idempotency path are implemented.

PR 21 introduces `workflow_waits` as the authoritative wait state with CAS terminal resolution (`resolved | timed_out | cancelled`) and durable wait kinds for `delay | human_interaction | external_callback | task_completion`. The first executable waitpoint is bounded `core.wait` (Delay): execution persists the active wait, marks the step/run `waiting`, clears the execution lease, and returns without sleeping a worker or holding the HTTP request open. Reconciliation resumes only when `wakeAt` is due, resolves the wait and step atomically, reclaims the run lease, and replays from checkpoints. Delay is rejected if it would extend beyond the remaining workflow deadline.

PR 22 binds Human Approval to the existing company-level `approvals` system. The workflow executor creates a normal `workflow_step_approval` record and stores only its ID in the durable wait. Existing Approve/Reject/Request revision UI and routes remain authoritative; the workflow never introduces a second approval engine. Approval resumes the exact checkpointed run, rejection/cancellation closes the step and run explicitly, and revision-requested approvals remain waiting until resolved. Workflow approval payloads include a human-readable reason, consequence, risk classification, reversibility warning and workflow/run identity. Workflow-requested approvals intentionally do not register a requesting agent, preventing the generic approval route from also waking an agent and creating a second continuation path.

External callback and task-completion waits share the same durable storage/lifecycle but remain non-executable until their existing connector/task event systems are bound in the ordered PRs. External callback tokens are stored only as hashes.

PR 23 allows the existing Routine engine to enqueue Workflows without introducing another scheduler or webhook control plane. Routine schedule/webhook/API semantics, replay protection, catch-up and concurrency remain authoritative in Routines. When the execution target is a Workflow, the RoutineRun and queued `workflow_run` are persisted atomically; the child run uses source `routine`, is bound to the then-current published Workflow revision, and receives routine/run/trigger provenance in the trigger payload. After commit, inline execution is best-effort; if the process stops before or during execution, the existing workflow recovery loop owns continuation. A terminal child Workflow settles the originating `workflow_started` RoutineRun to `completed` or `failed` in the same terminal transaction.

PR 24 generalizes Pipeline stage automation without changing Pipeline ownership of persistent business state. Legacy `onEnter.type="run_routine"` remains readable; new stages may use a typed `run_target` with `routine` or `workflow`. The existing `pipeline_automation_executions` ledger keeps its case/stage-event idempotency identity, retry generations, cleanup policy, liveness and audit semantics. Workflow targets are recorded in that same ledger, durably enqueue a child `workflow_run` with source `pipeline`, and link the exact run back to the automation attempt. Pipeline liveness reads the child Workflow state for running/waiting/failure and retry UI creates a fresh pipeline automation generation rather than retrying the same failed child run. Workflow-backed stages intentionally reject existing Pipeline breakdown mechanics until those mechanics have a native Workflow contract; no agent/routine fallback is silently substituted.

A run always binds to the published revision it started with; later draft edits or publishes do not rewrite that run.

The run-history endpoint reads the existing authoritative `workflow_runs` state;
it does not create a second history store. Cancellation and user-initiated whole-run retry endpoints are not advertised yet. Automatic node retry durability is implemented; wait/cancel semantics land in the next ordered gates.

## Recovery assurance boundary

The recovery service has integration coverage for expired-lease takeover, successful-step checkpoint reuse, interrupted-attempt preservation and abandoned queued-run recovery. A real process-kill run remains a required release-gate verification before Wave 3–4 can be called fully durable; test code and static review are not represented as executed process-kill evidence.
