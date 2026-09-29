# Workflows V1 API contract

**Feature flag:** `enableWorkflowsV1` (default off)
**Scope:** PR 11–27 persistence/API, typed Node Registry, manual executor V1, run-history/live-run API, deterministic branching, checkpoint/replay recovery, durable retries/waits, Human Approval, Routine/Pipeline/Task integration, August Works Agent Task delegation, and governed OpenClaw External Agent execution. Connector-side execution and any future unrestricted direct-agent request/response remain gated.

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
| POST | `/companies/:companyId/issues/:issueId/workflows/:workflowId/run` | workflow run + task mutate | `Idempotency-Key` | task-sourced run with authoritative task context | `workflow.task_invoked` + workflow run/step activity |
| GET | `/companies/:companyId/workflow-runs/:runId` | read | none | run + step attempts + durable waits | none |

## Current publish gate

PR 13 validates every draft node against a typed registry and company-scoped references before persistence.

A registered node may be `ready` or `draft_only`. Publish fails closed with `workflow_node_invalid` / `node_not_publishable_yet` until the node's execution, authorization, retry/idempotency, and policy integration are implemented.

`core.manual_trigger`, `core.condition`, bounded `core.wait`, `human.approval`, `work.create_task`, `agent.task`, and `agent.external` are publish-ready. Transform and Connector Action remain intentionally draft-only until their dependent implementation waves land. Agent Task with a non-null `expectedOutputSchema` remains publish-blocked until Tasks expose an authoritative structured-result channel. External Agent structured output is validated from the authoritative heartbeat/OpenClaw result channel instead.

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
- `workflow_external_agent_config_invalid`
- `workflow_external_agent_binding_invalid`
- `workflow_external_agent_binding_conflict`
- `workflow_external_agent_unavailable`
- `workflow_external_agent_failed`
- `workflow_external_agent_timeout`
- `workflow_external_agent_cancelled`
- `workflow_external_agent_result_missing`
- `workflow_output_schema_invalid`
- `workflow_output_schema_mismatch`
- `workflow_task_config_invalid`
- `workflow_task_responsible_user_required`
- `workflow_task_permission_denied`
- `workflow_task_create_failed`
- `workflow_task_cancelled`
- `workflow_task_missing`
- `workflow_task_not_active`
- `workflow_agent_task_config_invalid`
- `workflow_agent_task_structured_output_not_ready`
- `workflow_agent_task_binding_conflict`
- `workflow_agent_task_assignment_changed`
- `workflow_agent_unavailable`
- `workflow_agent_wakeup_failed`

## Current execution boundary

PR 16 introduced durable run/step records, manual-run idempotency and lease-based ownership. PR 18 adds deterministic `core.condition` execution and explicit true/false branch selection.

Condition expressions intentionally do not execute host JavaScript and never call an LLM. The current grammar supports boolean literals, boolean references, strict equality/inequality and finite numeric ordered comparisons over `trigger`, `variables` and prior `steps` outputs. Missing references or invalid runtime types fail closed into a durable failed step/run.

PR 19 adds checkpoint/replay recovery. Every running workflow carries an execution owner, heartbeat and expiring lease. The server reconciliation loop reclaims expired `RUNNING`/`RECOVERING` runs and abandoned `QUEUED` runs after a grace period. Recovery reloads the immutable published-or-superseded revision bound to the run, reuses `SUCCEEDED` step outputs as checkpoints, preserves a step interrupted by process loss as a failed attempt with `workflow_execution_interrupted`, and resumes that node as attempt `n+1`. A valid live lease is never stolen.

PR 20 makes retry policy executor-owned. Retry modes are `none`, `fixed`, or `exponential`; retry attempts are separate `workflow_step_runs` rows. A retryable failure may transition the current attempt to `retry_scheduled` and the run to `waiting`; reconciliation resumes only after the configured backoff, marks the old attempt `retried`, and executes attempt `n+1`. The retry decision fails closed unless the error is retryable, the side effect is safe to repeat/deduplicated, the retry budget and parent deadline permit it, and provider policy permits retry. A stable `workflow-step:<run>:<node-hash>` identity is derived once per logical step and remains constant across attempts.

Backoff does not hold an HTTP request or worker sleep open. The durable state itself is the source of truth, and the existing reconciliation loop owns wake-up. Connector Action remains draft-only until its execution-time authorization/integration path lands.

PR 21 introduces `workflow_waits` as the authoritative wait state with CAS terminal resolution (`resolved | timed_out | cancelled`) and durable wait kinds for `delay | human_interaction | external_callback | task_completion`. The first executable waitpoint is bounded `core.wait` (Delay): execution persists the active wait, marks the step/run `waiting`, clears the execution lease, and returns without sleeping a worker or holding the HTTP request open. Reconciliation resumes only when `wakeAt` is due, resolves the wait and step atomically, reclaims the run lease, and replays from checkpoints. Delay is rejected if it would extend beyond the remaining workflow deadline.

PR 22 binds Human Approval to the existing company-level `approvals` system. The workflow executor creates a normal `workflow_step_approval` record and stores only its ID in the durable wait. Existing Approve/Reject/Request revision UI and routes remain authoritative; the workflow never introduces a second approval engine. Approval resumes the exact checkpointed run, rejection/cancellation closes the step and run explicitly, and revision-requested approvals remain waiting until resolved. Workflow approval payloads include a human-readable reason, consequence, risk classification, reversibility warning and workflow/run identity. Workflow-requested approvals intentionally do not register a requesting agent, preventing the generic approval route from also waking an agent and creating a second continuation path.

External callback waits remain non-executable until their connector event binding lands. Task-completion waits are executable through Create Task and use task terminal events as the primary continuation signal, with the workflow reconciliation sweep retained as recovery fallback. External callback tokens are stored only as hashes.

PR 23 allows the existing Routine engine to enqueue Workflows without introducing another scheduler or webhook control plane. Routine schedule/webhook/API semantics, replay protection, catch-up and concurrency remain authoritative in Routines. When the execution target is a Workflow, the RoutineRun and queued `workflow_run` are persisted atomically; the child run uses source `routine`, is bound to the then-current published Workflow revision, and receives routine/run/trigger provenance in the trigger payload. After commit, inline execution is best-effort; if the process stops before or during execution, the existing workflow recovery loop owns continuation. A terminal child Workflow settles the originating `workflow_started` RoutineRun to `completed` or `failed` in the same terminal transaction.

PR 24 generalizes Pipeline stage automation without changing Pipeline ownership of persistent business state. Legacy `onEnter.type="run_routine"` remains readable; new stages may use a typed `run_target` with `routine` or `workflow`. The existing `pipeline_automation_executions` ledger keeps its case/stage-event idempotency identity, retry generations, cleanup policy, liveness and audit semantics. Workflow targets are recorded in that same ledger, durably enqueue a child `workflow_run` with source `pipeline`, and link the exact run back to the automation attempt. Pipeline liveness reads the child Workflow state for running/waiting/failure and retry UI creates a fresh pipeline automation generation rather than retrying the same failed child run. Workflow-backed stages intentionally reject existing Pipeline breakdown mechanics until those mechanics have a native Workflow contract; no agent/routine fallback is silently substituted.

PR 25 binds Tasks and Workflows in both directions without introducing a second task system. `work.create_task` creates the existing Issue/Task primitive and performs execution-time `tasks:assign` authorization against the final project/assignee. Its stable workflow-step idempotency key is persisted through the existing Issue-create idempotency receipt, so crash/replay reuses the same Task rather than duplicating the side effect. With `waitForCompletion=false`, the step checkpoints the created task and continues immediately. With `waitForCompletion=true`, the step creates a durable `task_completion` wait, releases the workflow lease, and resumes when the referenced Task becomes `done`; cancellation fails the workflow explicitly. Task terminal events enqueue a post-commit workflow continuation, while reconciliation remains the crash/recovery fallback.

Tasks can also invoke published Workflows through the existing task surface. The caller must hold both `workflows:run` and mutation authority for that specific task; cross-company references and terminal tasks fail closed. The workflow run uses source `task`, binds the published revision at invocation time, and overwrites any caller-supplied `task` object with authoritative server-side task context before idempotency comparison. Create Task intentionally does not wake an assigned agent.

PR 26 makes `agent.task` the accountable August Works delegation node by composing existing primitives rather than creating another agent execution queue. Execution-time `tasks:assign` authorization runs against the selected company-scoped agent. The node creates/reuses one existing Task using the stable workflow-step idempotency key, assigns that Task to the selected agent, and invokes the existing assignment wakeup/heartbeat runtime with a second stable idempotency identity. The Workflow step persists both `agentId` and the real `heartbeatRunId`, so the run log links to the accountable Task and the concrete agent runtime. A transient wakeup failure never creates another Task: the attempt is durably retried or a waiting Agent Task is re-woken by reconciliation using the same identities.

With `waitForCompletion=true`, Agent Task reuses the same durable `task_completion` wait from PR 25. The Workflow releases its execution lease while the agent works, Task terminal events are the primary continuation signal, and reconciliation remains the crash/recovery fallback. If assignment changes before a deferred wakeup is bound, execution fails closed instead of silently delegating to a different agent. Task cancellation fails the waiting Workflow explicitly. The node's declared cooperative cancellation reflects the underlying Task/agent runtime, but Workflow-level user cancellation is still not exposed as a public endpoint.

Agent Task currently returns Task/runtime provenance (`issueId`, `status`, `agentId`, `heartbeatRunId`). A configured `expectedOutputSchema` is intentionally publish-blocked: the existing Task system does not yet expose an authoritative structured-result channel that could safely satisfy such a schema. Likewise, a separate bounded Direct Agent Call node is not advertised yet. The existing heartbeat wake API has durable admission/idempotency, but arbitrary wake payload is not itself a documented request/response instruction contract; Workflow does not pretend otherwise.

PR 27 adds `agent.external` as the dedicated OpenClaw/external-agent boundary. The node may reference only a same-company, non-terminated `openclaw_gateway` agent binding and performs execution-time `tasks:assign` authorization. It creates/reuses one accountable Task, then dispatches through the existing heartbeat/OpenClaw adapter with a stable workflow-step idempotency identity. The wake contract carries only `company_id`, `external_agent_binding_id`, objective, structured input, expected output schema, bounded timeout, `binding_grants` capability scope, correlation id, responsible user and workflow run/node identity. It does not automatically inherit Foundation, Shared Memory, parent-agent credentials, hidden runtime state, all connections, or unrelated task history.

The workflow persists a durable `external_agent_run` wait and releases its execution lease while OpenClaw runs. Recovery can re-dispatch a lost runtime binding with the same idempotency key without duplicating the accountable Task. A successful heartbeat result is normalized into `{status, output, artifacts, usage, externalRunId, issueId, agentId, heartbeatRunId}`; any configured JSON Schema is validated before downstream use. Missing external run identity or schema mismatch fails closed.

Timeout attempts cancellation through the existing heartbeat control plane. The durable wait records whether cancellation was requested and whether remote termination could actually be confirmed; an unconfirmed cancellation is never represented as successful termination. Provider failure, interruption, cancellation and timeout become explicit workflow failure states. Capability Resolver labels OpenClaw candidates as `agent.external`; it never silently substitutes an external agent for a deterministic native connector in an already-published workflow.

A run always binds to the published revision it started with; later draft edits or publishes do not rewrite that run.

The run-history endpoint reads the existing authoritative `workflow_runs` state;
it does not create a second history store. Cancellation and user-initiated whole-run retry endpoints are not advertised yet. Automatic node retry durability is implemented; wait/cancel semantics land in the next ordered gates.

## Recovery assurance boundary

The recovery service has integration coverage for expired-lease takeover, successful-step checkpoint reuse, interrupted-attempt preservation and abandoned queued-run recovery. A real process-kill run remains a required release-gate verification before Wave 3–4 can be called fully durable; test code and static review are not represented as executed process-kill evidence.

External Agent has code-level integration coverage for scoped wake context, stable replay identity, heartbeat result normalization, output-schema rejection and timeout/cancellation truthfulness. A live OpenClaw Gateway end-to-end run and cancellation/process-loss exercise remain release-gate evidence; they are not represented here as already executed merely because the automated test paths exist.
