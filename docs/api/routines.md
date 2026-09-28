---
title: Routines
summary: Recurring scheduling, reusable triggers, execution targets, and run history
---

Routines own recurring trigger semantics: schedule, webhook, API/manual dispatch, catch-up, concurrency, replay protection, and delivery idempotency. A routine now has one execution target: either the existing agent-task path or a published Workflow. This preserves the existing scheduler instead of creating a second workflow scheduler.

## List Routines

```
GET /api/companies/{companyId}/routines
```

Returns all routines in the company.

## Get Routine

```
GET /api/routines/{routineId}
```

Returns routine details including triggers.

## Create Routine

```
POST /api/companies/{companyId}/routines
{
  "title": "Weekly CEO briefing",
  "description": "Compile the weekly operating brief",
  "executionTarget": {
    "kind": "workflow",
    "workflowId": "{workflowId}"
  },
  "projectId": "{projectId}",
  "priority": "medium",
  "status": "active",
  "concurrencyPolicy": "coalesce_if_active",
  "catchUpPolicy": "skip_missed"
}
```

Existing clients may continue using `assigneeAgentId`; it is dual-read as an `agent_task` execution target. New clients SHOULD use `executionTarget`. Agents can create/manage only their own agent-target routines; changing a routine to a Workflow target requires the existing board/task-assignment authority.

Fields:

| Field | Required | Description |
|-------|----------|-------------|
| `title` | yes | Routine name |
| `description` | no | Human-readable description of the routine |
| `executionTarget` | no | `{kind:"agent_task", agentId}` or `{kind:"workflow", workflowId}`. An active routine requires a valid target; targetless creates are stored paused as drafts. |
| `assigneeAgentId` | no | Backward-compatible agent target field. For agent targets it mirrors the target agent; it must not be combined with a Workflow target. |
| `projectId` | no | Optional project context. Existing agent-task execution may use it for the created task/workspace. |
| `goalId` | no | Goal to link agent-task runs to |
| `parentIssueId` | no | Parent issue for agent-task execution |
| `priority` | no | `critical`, `high`, `medium` (default), `low` |
| `status` | no | `active` (default), `paused`, `archived` |
| `concurrencyPolicy` | no | Behaviour when a run fires while a previous one is still active |
| `catchUpPolicy` | no | Behaviour for missed scheduled runs |

**Concurrency policies:**

| Value | Behaviour |
|-------|-----------|
| `coalesce_if_active` (default) | Incoming run is finalized as `coalesced` against the matching active execution target. Agent targets link to the active Issue/run; Workflow targets link to the active `workflow_run`. |
| `skip_if_active` | Incoming run is finalized as `skipped` while matching work is active. |
| `always_enqueue` | Always create a new target execution regardless of active runs. |

**Catch-up policies:**

| Value | Behaviour |
|-------|-----------|
| `skip_missed` (default) | Missed scheduled runs are dropped |
| `enqueue_missed_with_cap` | Missed runs are enqueued up to an internal cap |

## Update Routine

```
PATCH /api/routines/{routineId}
{
  "status": "paused",
  "baseRevisionId": "{latestRevisionId}"
}
```

All fields from create are updatable. `executionTarget: null` explicitly clears the target; omitting `executionTarget` preserves it. `baseRevisionId` is optional for backward compatibility; when provided, stale values return `409 Conflict` with the current revision id. Agents can only update their own agent-target routines and cannot switch a routine to a Workflow target.

## List Revisions

```
GET /api/routines/{routineId}/revisions
```

Returns append-only routine definition revisions newest first. Snapshots include routine fields and safe trigger metadata only; webhook secret values and `secretId` are never returned.

## Restore Revision

```
POST /api/routines/{routineId}/revisions/{revisionId}/restore
```

Restores a historical routine definition by creating a new latest revision copied from the selected revision. Historical revision rows, routine run history, and activity history are preserved. If restoring a deleted webhook trigger requires recreating it, the response can include one-time replacement secret material for that trigger.

## Add Trigger

```
POST /api/routines/{routineId}/triggers
```

Three trigger kinds:

**Schedule** — fires on a cron expression:

```
{
  "kind": "schedule",
  "cronExpression": "0 9 * * 1",
  "timezone": "Europe/Amsterdam"
}
```

**Webhook** — fires on an inbound HTTP POST to a generated URL:

```
{
  "kind": "webhook",
  "signingMode": "hmac_sha256",
  "replayWindowSec": 300
}
```

Signing modes: `bearer` (default), `hmac_sha256`, `github_hmac`, and `none`.
The replay window applies to `hmac_sha256` only: 30–86400 seconds (default 300).
Creating a webhook returns `trigger` and one-time `secretMaterial` containing
`webhookUrl` and `webhookSecret`. Save the secret before closing the dialog.
Routine details retain the URL; rotate the secret if its value is lost.

**API** — fires only when called explicitly via [Manual Run](#manual-run):

```
{
  "kind": "api"
}
```

A routine can have multiple triggers of different kinds.

## Update Trigger

```
PATCH /api/routine-triggers/{triggerId}
{
  "enabled": false,
  "cronExpression": "0 10 * * 1"
}
```

## Delete Trigger

```
DELETE /api/routine-triggers/{triggerId}
```

## Rotate Trigger Secret

```
POST /api/routine-triggers/{triggerId}/rotate-secret
```

Generates a new signing secret for webhook triggers. The previous secret is immediately invalidated.

## Manual Run

```
POST /api/routines/{routineId}/run
{
  "source": "manual",
  "triggerId": "{triggerId}",
  "payload": { "context": "..." },
  "idempotencyKey": "my-unique-key"
}
```

Fires a run immediately through the routine's configured execution target. Concurrency policy still applies. Agent-target routines may accept the existing one-run agent/project/workspace overrides. Workflow-target routines do not accept an agent override; the published Workflow target is fixed for that run.

`triggerId` is optional. When supplied, the server validates the trigger belongs to this routine (`403`) and is enabled (`409`), then records the run against that trigger and updates its `lastFiredAt`. Omit it for a generic manual run with no trigger attribution.

## Fire Public Trigger

```
POST /api/routine-triggers/public/{publicId}/fire
```

Fires a webhook trigger from an external system without a Paperclip login. Send
`Content-Type: application/json` and a JSON object. The trigger authenticates the
request using its own secret; an agent or board API key is not a substitute.

| Mode | Headers and signature |
|------|-----------------------|
| `bearer` | `Authorization: Bearer <webhookSecret>` |
| `hmac_sha256` | `X-Paperclip-Timestamp` (Unix seconds or milliseconds) and `X-Paperclip-Signature: sha256=<hex>`; HMAC-SHA256 over the timestamp string, a dot, and the exact body bytes |
| `github_hmac` | `X-Hub-Signature-256: sha256=<hex>`; HMAC-SHA256 over the exact body bytes, without a timestamp. `X-Paperclip-Signature` is also accepted. Configure GitHub to send JSON. |
| `none` | No signature. Anyone with the generated URL can fire the trigger; keep it private. |

For a bearer trigger:

```sh
curl --fail-with-body "$WEBHOOK_URL" \
  -H "Authorization: Bearer $WEBHOOK_SECRET" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: deployment-123' \
  --data-binary '{"event":"deployment","variables":{"environment":"staging"}}'
```

For a timestamped HMAC trigger, sign and send the same bytes:

```js
import { createHmac } from "node:crypto";
const body = JSON.stringify({ variables: { environment: "staging" } });
const timestamp = String(Math.floor(Date.now() / 1000));
const signature = createHmac("sha256", process.env.WEBHOOK_SECRET)
  .update(`${timestamp}.`).update(body).digest("hex");
const response = await fetch(process.env.WEBHOOK_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Paperclip-Timestamp": timestamp,
    "X-Paperclip-Signature": `sha256=${signature}`,
  },
  body,
});
console.log(response.status, await response.json());
```

`202` returns the routine run. Agent targets expose `linkedIssueId`; Workflow
targets expose `linkedWorkflowRunId`. Target execution may continue
asynchronously, so acceptance does not imply completion. Workflow dispatch
durably creates the RoutineRun and queued Workflow run in one transaction; the
existing workflow recovery loop can continue a queued run after process loss.
Concurrency policy can coalesce or skip a delivery while matching work is active.
Payload fields or a nested `variables` object supply declared routine variables;
nested values take precedence. The full payload is retained in run history.

For bearer, GitHub HMAC, and unsigned triggers, send a stable `Idempotency-Key`
when retrying a delivery to receive the original run without creating another
task. Timestamped HMAC rejects an identical signed delivery with `409`, even
inside the replay window; stale timestamps and invalid secrets/signatures return
`401`. Disabled triggers and paused/archived routines return `409`. Missing
required variables return `422`; non-JSON media types return `415` and invalid
JSON objects return `400`. Rotating a secret immediately invalidates the old one.

Cloud installations use their canonical public origin for generated URLs.
Self-hosted installations should set `PAPERCLIP_PUBLIC_URL` to their HTTPS
origin. The reverse proxy must forward this POST endpoint and its authorization,
signature, timestamp, and idempotency headers without requiring a browser login.
For local HTTPS testing, proxy an isolated test instance through Tailscale Serve;
use Funnel only if the sender is outside the tailnet. Existing routine and agent
execution controls still apply, including the isolated-worktree execution gate.

## List Runs

```
GET /api/routines/{routineId}/runs?limit=50
```

Returns recent run history for the routine. Defaults to 50 most recent runs. Workflow-backed rows include the linked Workflow run id plus the derived Workflow id/status used by the UI for navigation and live state.

## Agent Access Rules

Agents can read all routines in their company. Mutation authority remains attenuated by execution target:

| Operation | Agent | Board |
|-----------|-------|-------|
| List / Get | ✅ any routine | ✅ |
| Create agent-target routine | ✅ own only | ✅ |
| Create Workflow-target routine | ❌ | ✅ |
| Update / activate own agent-target routine | ✅ | ✅ |
| Change execution target to Workflow | ❌ | ✅ |
| Add / update / delete triggers | ✅ own agent-target routine | ✅ |
| Rotate trigger secret | ✅ own agent-target routine | ✅ |
| Manual run | ✅ own agent-target routine | ✅ |
| Reassign to another agent | ❌ | ✅ |

## Routine Lifecycle

```
active -> paused -> active
       -> archived
```

Archived routines do not fire and cannot be reactivated.

## Routine detail navigation

The routine detail page keeps **Runs** and **Activity** in the routine sidebar. Agent-target Runs reuse the shared Issue list. Workflow-target Runs show linked Workflow runs and navigate to the existing Workflow run detail; no second run-history model is created. Activity remains the routine/trigger/run event timeline. Revision history records execution-target changes and preserves legacy snapshots that predate the target fields.


## Webhook setup and connection checks

Create a webhook trigger with `setupPending: true` to configure it safely. While setup is pending, authenticated deliveries return `202` with `{ "status": "test_received", "test": true, "routineStarted": false, "linkedIssueId": null }`. They never create a routine run, task, or agent wakeup. This state survives refreshes and server restarts, and connection checks also work while the routine is paused. Invalid authentication still returns `401`.

Routine detail exposes `setupPending` and `lastWebhookDelivery` (`status`, `receivedAt`, and `test`) so the wizard can show live connection feedback. The secret is only returned at creation or rotation; it is never stored in browser draft storage or included in routine detail.

Finish setup with `PATCH /api/routine-triggers/{id}` and `{ "setupPending": false }`. Future deliveries use normal routine dispatch and still respect the routine's enabled state. Test events are not dispatched on activation. Retries with the same `Idempotency-Key`, GitHub `X-GitHub-Delivery`, or timestamp-HMAC replay key remain test receipts after activation. Send a unique delivery ID per event so a sender's retries can be recognized. Requests without a delivery ID are new events after activation.

For compatibility, API-created triggers without `setupPending: true` are immediately live. Completed triggers cannot be returned to setup mode. Checking a previously enabled webhook observes real deliveries and can start the routine; the management UI explains this difference.

Trigger cards support removal with Undo. `PATCH` with `{ "archived": true }` excludes a trigger from routine detail and scheduling, and rejects its webhook deliveries. Setting `archived` back to `false` restores the same URL and credentials. `DELETE` remains the permanent deletion API.

The webhook wizard and saved trigger editor warn about localhost, private-network addresses, Tailscale hostnames, and HTTP URLs without blocking setup. HTTPS does not imply public access: Tailscale Serve is private, while Funnel can expose the same hostname publicly. These warnings inspect the URL only; they do not resolve DNS or test internet reachability. Use [the HTTPS setup guide](https://docs.paperclip.ing/reference/deploy/https/) to configure public access when the sender is outside your network.
