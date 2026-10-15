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

## Current review follow-up

The available independent review found one valid Agent-entry issue: a cached
admission could outlive the Human unsaved-change decision without receiving a
revocation event. The entry now fetches Native admission after that decision.
It checks the current session and requested scope again after the read. A
withdrawn admission or a late answer across a session check cannot hand off.
Concurrent clicks do not open multiple pending handoffs.

Tool reviews, Human approval reads and Agent admission detach an older in-flight
GET before starting a new private read. A current source generation cannot join
the transport started before that generation, including for the same account
and URL. Existing callers can settle under their own authority fence; detachment
neither cancels their operation nor creates a write.

All 84 current cases pass in seven UI files, including real fetch-coalescing
regressions and the revoked/late admission checks. Full affected UI types and
token gates pass. The earlier follow-up fixture incorrectly supplied a false
admission even though the Native contract returns an authorization error; its
corrected case uses that refusal and flushes the query notification. The first
fixture/type failures remain failed records. The final built-browser result and
complete configured current-head CI are recorded in the PR verification section.

### Native account refusal withdraws the private review

Two new failing regressions demonstrated that an explicit Native
`ACCOUNT_CHANGED` refusal left the old tool or Human checkpoint preview visible.
The server emits this refusal before reads or effects. The control now removes
that refused attempt's locator, withdraws its private query generation and
invalidates the disproved Original session. It never replays a decision.
Unknown transport replies retain their existing recovery fence.

All 86 current cases pass in the seven affected UI files, including both
previously failing regressions. Full affected UI types and token gates pass.
The final browser rebuild/result and complete configured CI remain exact-head
PR verification records. Superseded CI runs are not credited to this source.


### Restore orientation after a private heading remount

Current CI on `38be08a85` found a Home heading-focus failure at the first entry.
Its retained browser artifact is `12003061383`, SHA-256
`b834ff3d0e71cd84124f66aca25ba6a86b709d5be4f9f2bd95202d832b5306cc`.
The log records two successful Home reads before the failed focus assertion.
Cleanup then restores flags, so the later error screenshot is not proof of an
initial read failure. No trace was present in that artifact.

A deterministic regression reproduces one concrete defect: a private recheck
unmounts the focused heading, but its scope-only marker suppresses focus on the
new DOM element. The shared heading owner now records the actual element as
well as the scope. A remounted current heading receives orientation; an active
utility still keeps its keyboard gesture. The failing first-entry artifact is
consistent with this defect but does not independently establish that entire
sequence. The assertion and five-second focus deadline remain unchanged.
Future failures in the affected browser file retain traces.

The first deterministic regression fails before the correction. All 114 current
cases in twelve affected UI/focus files pass afterward. Full affected UI types
and token gates pass. The exact built Home/feedback/rollback journey is repeated
three times; its result and final configured CI are recorded in the PR.

The separate Docker-context failure on that head occurs before the check:
public ECR returns HTTP 429 while resolving the pinned Node image manifest.
The image pin and gate remain unchanged. A current successful check is still
required; the external refusal is not credited as a pass.


### Preserve the more specific Native support focus owner

The broad UI shard on `ccb0314ac` finds a regression from the generic heading
remount correction: its layout focus consumes the body-focus condition used by
Native support's existing control-restoration owner. The existing operator-field
restoration test fails locally as well. The shared heading hook now permits a
page to defer orientation while its own control restoration is pending. Native
support uses that explicit deferral. Its saved field, error, fallback-heading
and open-dialog rules remain with the existing owner.

All 177 cases in nineteen current journey/focus files pass after this correction,
including every available page test for shared-heading callers and the original
support restoration test. Full affected UI types and token gates pass. A full
local UI catalog and combined built Home/support/workflow browser verification
also run; their final results and current-head CI are recorded in the PR. The
support browser file retains traces on failure. No focus assertion or deadline
is changed.
