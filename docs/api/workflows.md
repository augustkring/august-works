# Workflows V1 API contract

**Feature flag:** `enableWorkflowsV1` (default off)
**Scope:** PR 11–17 persistence/API, typed Node Registry, manual executor V1 and run-history/live-run API. Advanced durability nodes remain gated.

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

`core.manual_trigger` is currently publish-ready. Transform, Condition, Connector Action, Create Task, Agent Task, and Human Approval are intentionally draft-only until their dependent implementation waves land.

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

## Current execution boundary

PR 16 introduced the durable run/step records, manual-run idempotency contract,
lease-based claim and the first executable node: `core.manual_trigger`.

Live execution remains deliberately fail-closed for every other node type until
its executor, authorization, retry/idempotency and recovery semantics land in
the ordered durability PRs. A run always binds to the published revision it
started with; later draft edits or publishes do not rewrite that run.

The run-history endpoint reads the existing authoritative `workflow_runs` state;
it does not create a second history store. Cancellation/retry endpoints are not
advertised until their durability semantics are implemented.
