# V9 agent change and workflow review completion

Baseline: master `515cc1015df8fe18e633d01575a5559a3727d09d`, merged PR 39.
This work addresses the user's request to finish the reported coding and journey
checks. It does not infer missing implementation from an `in_progress` label.
The retained V3 brief and relevant requirements, construction, verification,
security/privacy, frontend, migration and writing playbooks govern the changes.

## Source findings and resulting behavior

| Reported area | Actual existing owner | Correction and verification scope |
| --- | --- | --- |
| Existing-Agent changes | `AgentRevisionEntry`, `CustomAgent`, Native authoring drafts, safe tests, publication and retirement | The entry already exists. It now uses the current-session authority before private admission, at click and after the asynchronous unsaved-change decision. A consolidated migrated-PG test traverses every pre-monitor builder stage, tests and independently reviews a candidate, publishes it, creates/tests a later draft without changing the active version, then pauses and retires the original presence. |
| Workflow access editing | Native Apps permissions editor and current workflow-step read owner | Existing permission writes stay with that owner. The link now focuses the exact catalog entry. The shared contract permits only that UUID focus and rejects extra query/redirect material. A link or saved draft is never a grant. |
| Workflow approval | Native workflow waits, action requests, tool gateway and Original board approvals | The ordinary customer run now exposes an exact active tool review and the exact active Human approval; Advanced is unnecessary for those entries. Pointers are omitted for closed, ambiguous or erased waits. The tool UI uses current account/source fences, private cache keys and EN/DA copy. The API rejects a changed expected account before reads or effects and the client rejects a foreign run acknowledgement. |

The original named blockers were broader than the source facts supported. In
particular, a separate new workflow permission writer and another Agent-change
entry would duplicate existing Native ownership. The corrected implementation
extends those owners rather than adding either duplicate.

## Unknown decision recovery and local processing purpose

An opaque Native action request remains the sole decision identity. Before an
explicit POST, the tab retains only that request ID, approve/reject choice and
local expiry, scoped by company, principal, run and opaque step-attempt ID. No action preview,
arguments, credential, provider prose or result is stored. This is a necessary
unknown-outcome recovery locator, separate from optional observation collection.
Failure to retain it prevents dispatch. It is never interpreted as a grant or
an effect receipt.

A lost reply stays unconfirmed through read refresh, remount and reload. A
status check performs GET only. Current pending requests cannot be approved
again or reversed from this retained attempt. An absent row does not establish
success. A different current Native request requires a new explicit decision.
The locator is removed on a confirmed acknowledgement, ignored/removed when
accessed after its one-day local validity, or destroyed with the tab session.
No background browser-erasure guarantee is claimed for an unopened expired key.
There is no new external data path or provider send in this recovery mechanism.

## Decision material and concurrency

Human checkpoint reads carry an opaque Native material hash. The current
customer control validates company, workflow, run, revision, node and approval
identity, and submits that reviewed hash to the existing Original decision
owner. The UPDATE compares the exact previously read material atomically.
A changed review returns an explicit no-effect conflict, refreshes the current
read and requires another explicit decision. An unknown reply stays locked.
Original same-target terminal retries remain no-op responses. Engine-owned
workflow checkpoint payloads cannot be rewritten by the generic resubmit API;
ordinary caller-authored approval revisions retain their existing behavior.
Revision and resubmit writes also refuse concurrent material replacement.

## Verification record

- All 68 current focused UI cases pass in six files. These cover account and
  source changes, exact checkpoint scope, known changed-review refusal, unknown
  decisions across remount, storage refusal and Native acknowledgement scope.
- All 19 current shared contract cases pass in three files. Exact permission
  focus accepts no extra query, hash or redirect. The engine-only approval type
  remains outside the public create allowlist. Review hashes have a strict shape.
- All 125 current server cases pass in five files. They include a real migrated
  PostgreSQL row-lock race, stale material, unchanged terminal retries, immutable
  engine checkpoints, ordinary resubmission compatibility, account binding,
  private generic HTTP logs and the OpenAPI contract.
- The broader Native run passes 217 cases in ten files, including the combined
  Agent lifecycle and active/paused monitor reads, admission and maintenance
  policy, workflow review and routes. This preceded the final material-binding
  change, which has the separate current 125-case record above.
- Four selected Native/SDK channel cases pass: question continuation, Slack and
  Teams binary one-use confirmation, and durable signed Slack Stop retry. The
  other 1,044 cases were excluded by that filter, not credited as executed.
- Built-browser checks already pass the combined Agent publication/retirement,
  safe-test, focused workflow review, and EN/DA approval/recovery journeys. The
  final material-binding source still requires its final browser check below.
- Full current workspace types and token/coverage gates pass. Complete build
  and final built-browser results are recorded in the branch PR verification
  section. Configured full CI and independent review control merge readiness.

The first current UI run failed because its test constructed ApiError with
reversed message/status arguments. The corrected test preserves the actual
409 refusal assertion. Earlier failed setup/build/fixture commands remain
failed records; only their successful corrected scope is credited. These are
software checks, not representative Human trials or provider delivery proof.

## Closure boundaries

- Slack/Teams software journeys use the actual Native/SDK contracts with local
  fixtures. Real workspace delivery requires a configured provider connection.
- A combined failure/recovery pilot requires representative operation and Human
  evidence in addition to the executable admission/maintenance regressions.
- Local and authenticated SaaS onboarding are distinct supported workflows.
  Classic-mode retirement and old-flag deletion require the brief's actual
  migration/parity and usage/support window; deleting them now would skip it.
- MCP tool forwarding, PostHog export and starter compute remain explicitly
  conditional, closed experiments. They are not silently enabled or declared
  mandatory launch features.
- No available live test installation, provider identity or Slack/Teams test
  connection has been discovered through the supported configuration. No new
  accounts, live messages, purchases or production deployment occur here.
- `R0_SPECIFIED`, `sourceComplete: false`, the 70-surface release manifest and
  outstanding Native predecessor gates remain unchanged. This plan records
  specific implementation closure, not whole-V9 acceptance.
