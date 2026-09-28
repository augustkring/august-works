# Workflows V1 API contract

**Feature flag:** `enableWorkflowsV1` (default off)
**Scope:** PR 11–13 persistence/API + typed Node Registry. No executor is enabled by this contract.

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

No Workflow endpoint executes external side effects in PR 11.


## Current execution boundary

PR 10–15 expose workflow persistence, draft/publish authoring, the node registry,
capability discovery and the builder. There is intentionally no workflow run
endpoint yet.

The capabilities response therefore reports `run: false` even when a principal
already holds the reserved `workflows:run` permission. The capability becomes
true only when the durable executor and run API from PR 16+ are implemented and
verified. This prevents UI/agent surfaces from promising behavior that does not
exist.
