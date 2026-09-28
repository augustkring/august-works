# Workflows V1 API contract

**Feature flag:** `enableWorkflowsV1` (default off)
**Scope:** PR 11–19 persistence/API, typed Node Registry, manual executor V1, run-history/live-run API, deterministic Condition branching and lease-based checkpoint/replay recovery. Advanced side-effect retry and waitpoint nodes remain gated.

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
| GET | `/companies/:companyId/workflow-runs/:runId` | read | none | run + step attempts | none |

## Current publish gate

PR 13 validates every draft node against a typed registry and company-scoped references before persistence.

A registered node may be `ready` or `draft_only`. Publish fails closed with `workflow_node_invalid` / `node_not_publishable_yet` until the node's execution, authorization, retry/idempotency, and policy integration are implemented.

`core.manual_trigger` and `core.condition` are publish-ready. Transform, Connector Action, Create Task, Agent Task, and Human Approval remain intentionally draft-only until their dependent implementation waves land.

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

## Current execution boundary

PR 16 introduced durable run/step records, manual-run idempotency and lease-based ownership. PR 18 adds deterministic `core.condition` execution and explicit true/false branch selection.

Condition expressions intentionally do not execute host JavaScript and never call an LLM. The current grammar supports boolean literals, boolean references, strict equality/inequality and finite numeric ordered comparisons over `trigger`, `variables` and prior `steps` outputs. Missing references or invalid runtime types fail closed into a durable failed step/run.

PR 19 adds checkpoint/replay recovery. Every running workflow carries an execution owner, heartbeat and expiring lease. The server reconciliation loop reclaims expired `RUNNING`/`RECOVERING` runs and abandoned `QUEUED` runs after a grace period. Recovery reloads the immutable published-or-superseded revision bound to the run, reuses `SUCCEEDED` step outputs as checkpoints, preserves a step interrupted by process loss as a failed attempt with `workflow_execution_interrupted`, and resumes that node as attempt `n+1`. A valid live lease is never stolen.

Live execution remains deliberately fail-closed for every other node type until its executor, authorization and side-effect retry/idempotency semantics land in the ordered durability PRs. A run always binds to the published revision it started with; later draft edits or publishes do not rewrite that run.

The run-history endpoint reads the existing authoritative `workflow_runs` state;
it does not create a second history store. Cancellation/retry endpoints are not
advertised until their durability semantics are implemented.

## Recovery assurance boundary

The recovery service has integration coverage for expired-lease takeover, successful-step checkpoint reuse, interrupted-attempt preservation and abandoned queued-run recovery. A real process-kill run remains a required release-gate verification before Wave 3–4 can be called fully durable; test code and static review are not represented as executed process-kill evidence.
