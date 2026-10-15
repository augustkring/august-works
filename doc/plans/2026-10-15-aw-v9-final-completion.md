# V9 remaining implementation after PR 38

Baseline: merged master `e5124bd126c5d53ad2de7924687b5a06ed290048`.
PR 38's configured CI passed on source `4a12891d61e3fe1462a6f079091b7110d9cffecd`;
the merge has the same tree. That is software verification, not V9 release
acceptance. This follow-up does not change the R0 declaration.

## Implemented corrections

- **V9-070:** The shared stylesheet applies reduced-motion duration, delay and
  loop limits to shared utilities and pseudo-elements, retaining a finite
  animation lifecycle for presence teardown. Existing static alternatives stay
  in place. The autofill color-flash workaround is exempt from the transition
  override. JavaScript scrolling reads the current preference at dispatch,
  including explicit smooth requests and virtualizer defaults. Existing
  lifecycle-aware TaskMessageScroller and SidePanelTabs guards remain owners.
  The committed codemod is repeatable and preserves already-adapted files.
- **V9-077:** Toast presentation keeps at most five timers and 512 deduplication
  keys, including bursts in one React batch. Eviction may forget an old display
  duplicate; it never changes an Original operation or delivery receipt. The
  virtualized thread retains measurements only for rows in the current
  snapshot, including current offscreen rows; replacement snapshots no longer
  grow its lifetime cache. Returning removed IDs remeasures their content.
- **V9-045–047:** A semantic chat card's plain-text fallback now includes its
  sanitized title and body as well as why/consequence/evidence. Exact duplicate
  sections are collapsed. Original callbacks, authorizers and source bindings
  remain unchanged. All 18 semantic kinds are exercised through both installed
  Slack and Teams renderers. This is transport/software evidence, not a live
  Slack-only journey or provider delivery qualification.

## Verification record

The first broad UI attempt was interrupted after eight IssueChatThread failures:
the new helper had selected static scrolling when `matchMedia` was absent.
The helper now preserves the caller's requested behavior when that API is
unavailable and honors the live preference when it exists. No scrolling assertion
was weakened. The corrected focused UI run passes 92 cases, including the
10,000-event toast burst and row-removal/reintroduction regression.

The first complete card-vocabulary test exposed the missing body in text
fallbacks (36 failures, eight previous cases passed). The production fallback
was corrected; the following adapter/projection run passes 56 cases. An
additional title/body leakage and exact-duplicate regression is included in
the final verification scope.

The standalone Chromium check reads the actual token stylesheet and exercises
normal → reduced → normal preference changes, loops, delays, pseudo-elements,
transitions and finite animation completion. It passes. It does not claim a
built-component or manual assistive-technology audit. CI runs it in the existing
V9 component job with its installed Chromium. Token gates pass.

Final broad verification results must be recorded before PR-ready hand-off.

### Broad source check and Native browser follow-up

Full workspace types and build pass on `d12d71b35f420c44a1e701f15237311bd8f9cd5a`.
The full UI run has 807 passing files / 7,959 passing cases and one failing
motion-catalog case. The new fixed accessibility lifecycle token had used the
`--motion-*` namespace, whose existing contract requires membership in the
customer animation-tuning catalog. It now uses the explicit
`--a11y-reduced-motion-lifecycle` namespace; the policy value is unchanged and
the catalog assertion is preserved. All four affected UI files / 94 cases pass
after that correction. This is scoped follow-up evidence, not a claim that the
first full run passed.

The new Native browser soak creates 500 synthetic comments through the actual
API on an unassigned backlog task. A zero-budget process fixture is paused
through the Original API with heartbeat disabled, so this existing-company
workload does not accidentally enter the correct agentless onboarding flow.
It explicitly selects the retained classic interface and restores the flag.
The final prototype passes in 50.8 seconds: two warmup cycles and 24 measured
cycles navigate to Overview and Back inside one browser document, load the
actual paginated history, preserve more than 450 source rows with a bounded
rendered window, and measure heap/DOM/listeners after explicit Chromium GC.
This is a short synthetic retention probe, not hourly, mobile, current/default
Task Chat, hosted or customer performance qualification. No memory/latency
acceptance target is invented. The committed test persists its observations
as a private JSON file rather than relying on an in-memory reporter attachment.

Earlier harness failures are retained outside the repository: the dev-only
fixture route is absent from production, history loading needed source-count
postconditions, a response waiter omitted the Original identifier alias, a
cleanup error masked an initial timeout, the agentless onboarding overlay
correctly blocked navigation, and the pause command required its normal empty
JSON body. No production guard was disabled to pass the soak.

### Existing live-target discovery

Read-only discovery found no GitHub environments or deployments. Repository
variables cannot be read with the current integration (403); Pages reports
404. `doc/operations/aw-v6-runtime.md:105` names
`https://ai.augustworks.dk` as the initial origin, but its health request is
refused by the CONNECT proxy (403, no target HTTP response) and the current
resolver returns no address. The documented future `.ai` origin is explicitly
deferred. These observations do not prove that no external installation exists.
The managed environment exposes no configured provider identities, runtime
variables or secret bindings. No secret-file discovery, account creation,
provider send, deployment or purchase was performed.

## Remaining closure boundaries

The 120-row backlog and 70-surface manifest remain authoritative working
inventories. Passing a new focused regression does not complete an entire row.
The outstanding analytics/funnel and legacy convergence work is not reclassified
as external qualification. The brief's §37 requires semantic/accessibility
parity and an observed support/usage window before legacy deletion. §64 explicitly
separates hosted/provider/compute/physical credential qualification from source
work. Optional MCP Apps tool forwarding, PostHog and starter compute cannot be
made launch requirements by enabling their closed capabilities.

No live installation or Slack/Teams qualification targets are configured in the
current managed environment. The user has been asked for existing test-target
URLs/connection names while local implementation continues. No provider send,
customer contact, purchase or production deployment is implied by local tests.

## Checkpoint 94 — integrated software verification and retained observations

All 92 V9 built-browser cases pass on `b1c4350e4`, including the committed
classic retention probe and its persisted JSON. The full Storybook build and
both component-browser cases pass, covering the existing EN/DA recovery states
and the 12 card stories in both narrow themes. The first browser selection
matched the worktree directory name and selected 331 cases; it was interrupted
after 21 passing cases. The corrected run enumerates the V9 spec filenames.
That interrupted run is not credited as a complete suite.

Five actual migrated-PostgreSQL channel cases pass on that source: the closed
Slack question/continuation, durable signed Stop, guest/stale Stop denial and
both V9 Slack/Teams binary confirmation cases. The other 1,043 cases were
excluded by the name filter, not executed. These tests reuse Native identity,
membership, Original interaction, publication and provider-effect owners with
explicit synthetic provider transports; they do not establish live delivery.

The subsequent two-interface soak passes on `270dec8f7`; its only difference
from `b1c4350e4` is the parameterized test file. Both the current and classic
interfaces complete 26 same-document navigation cycles, with 24 measured
samples each, on an actual 500-comment Native task. Retained observation JSON
and exact hashes are in
[`evidence/2026-10-15-native-chat-soak`](../experience/v9/evidence/2026-10-15-native-chat-soak/manifest.json).
Current-mode heap samples range from 48.4 to 52.6 MiB, with 500 rendered rows;
classic samples range from 62.2 to 66.3 MiB, with a 14–20-row virtual window.
These are observed ranges under concurrent verification, not performance
targets, proof of no leak or a valid before/after comparison. The two UI builds
have different exact artifact hashes because build-commit metadata changes;
they are not described as byte-identical artifacts.

The pilot/attention validators pass all 49 cases after adding a reviewed
first-outcome funnel and per-critical-slice timing. This collects no real
participant data and does not turn the product's unavailable usable baseline
into a measured one. The one failing full-UI token-catalog assertion is resolved
by the separately passing 94-case focused follow-up described above. No whole
current-head workspace test-catalog pass or configured remote CI pass is claimed
for these follow-up commits yet.

Normal CLI context discovery found one default profile without a configured
API origin. The user asked the agent to find targets rather than supply
technical setup details; discovery continued through repo operations docs,
GitHub metadata and the normal CLI. The access limitations above remain.

Local runtime measurement collection and the complete legacy parity/retirement
conditions remain open. The next implementation must preserve explicit
purpose, individual choice, minimal fields, erasure, bounded ingestion and
retention, and must not send new experience data to Paperclip's existing
default telemetry endpoint. Optional interoperability/provider adoption and
qualified hosted/Human acceptance remain distinct from that software work.


### Optional instance-local runtime observations

The missing collection foundation for V9-008/085–088 now has strict shared
contracts, recoverable processing-purpose metadata, migration 0501, own-person
Native services/routes, bounded flag-independent retention, EN/DA account
controls and a passive collector. Rollout and explicit individual opt-in are
both required. No outbound Paperclip telemetry client, analytics provider,
session replay, business writer or model is introduced. Current consent versions
fence late samples after withdrawal/re-enable. Withdrawal erases own samples in
its transaction even after company/rollout access loss; Original final account
and company deletion cascade the new data. Preference writes are audited;
passive samples are not duplicated into the independently retained Activity Log.

See [the scoped implementation and verification record](2026-10-15-aw-v9-local-experience-observations.md).
The corrected migrated PostgreSQL/shared/private-HTTP group passes 87 cases;
the final targeted UI/shared group passes 53 cases. Direct server/UI types and
token gates pass. The first built EN/DA account control run passes both cases;
a dashboard-collection follow-up and broader current-source checks remain to
finish. V9-008/087/088 move only to in_progress. This measures finite interface
categories and coarse visible intervals, not Human interruptions, successful
outcomes, support labour or a representative legacy-usage window. Release
readiness and the outstanding qualification requirements remain unchanged.


### Canonical owner and visual/accessibility follow-up

Agents, Skills and Costs now share their existing Native implementations across
classic/current route boundaries. Compatibility shims retain classic behavior,
old paths and the instance preference, while removing over 7,500 duplicated
implementation lines. Real browser verification exposed and corrected missing
tab/panel bindings and status-label contrast failures. Costs groups unchanged
metric values in definition lists instead of nested metric cards. Its labels
and machine-value typography use the existing token system. Default status
hues and fills remain; separate text tones pass the actual CSS contrast probe
for all 11 hues on three surfaces in both themes. Personal observation-choice
state is excluded from the company audit publication.

The [scoped record](2026-10-15-aw-v9-canonical-surface-completion.md) records
63 passing focused cases, the failed browser observations and their corrections,
the subsequently passing Native classic/current browser checks, and the final
follow-up still required. V9-066/068/069/071/073 move only to in_progress.
Classic retirement, host/provider access and representative Human qualification
remain separate, open requirements.


### Corrected-source broad browser verification and review

Source `898eebe833985483a5892f9422880a6f4c25d965` passes the updated server/UI
typechecks and complete workspace build. Its complete local default catalog
is running in the unchanged primary worktree. The independent built V9 browser
run completes all 97 cases in 13.7 minutes: 95 pass and two fail. Both long-thread
modes pass (classic 52.4 seconds; current 2.2 minutes). No current heap-range or
no-leak claim is inferred from those pass results.

The account-deletion test selected every alert in the main region, including
the new independent observation-choice failure. Its assertion is now scoped to
the named account-deletion region; the deletion outcome and immutable request
body assertions remain. The notification test establishes that the browser tab
is visible before driving its foreground session check. CI separately found a
Company ID edit racing the operator form's deliberate withdrawal during session
revalidation. Only that local edit is retried against the current form; erasure
and other Native writes are never replayed by the test helper. All four affected
browser cases pass in the focused follow-up with failure traces enabled.

CodeRabbit completed its review of 80 selected files on `898eebe83` with no
actionable comments and no code-change request. Its optional docstring coverage
check is inconclusive (22.81% of supported touched functions; some files skipped
by that check). This is not described as Greptile 5/5 or Human acceptance. PR 39
is ready for review; current-head CI and the catalog check must finish before a
merge-ready claim. The follow-up changes only these test fixtures and this
record, preserving the production source verified on `898eebe83`.

### Dispatch-time observation choice after a fast read

CI on `7142c8b5b` exposed an additional observation collector failure: the
cross-tab withdrawal case saw a second attempted sample. An old effect checked
query freshness but not the newly resolved preference value. A fast read could
therefore finish before React committed the new render, reopening that old
effect's dispatch check. The Native owner already rejects withdrawn or stale
consent versions; the client must also drop the attempt.

Every dispatch now checks the current cached personal choice, collection
availability, exact consent version, effective rollout and shell variant, in
addition to current identity and non-invalidated idle reads. Three deterministic
regressions change the cache before a visibility event and React commit. They
cover withdrawal, a newer consent version and rollout closure. The first new
regression fails on the uncorrected production source; all 52 cases across the
collector, choice controls, account and activation suites pass with the fix.
The complete UI typecheck passes. Current-source broad verification and CI must
still complete; the earlier failed UI job is not credited as a passing run.

### Await the private monitor's actual pending view

The other CI UI shard on `05b7d0654` reports the existing accepted-pause
monitor test reading the old DOM after its held replacement request starts.
Request invocation precedes React Query's batched notification. The fixture
now waits for both the held request and the required hidden private view,
before releasing the replacement result. The same assertions still require
the accepted receipt to return with the fresh paused state and exactly one
pause write. No production monitor or pause behavior changes. Both complete
monitor/pause suites pass all 17 cases with this correction. Broader current
CI and catalog results remain pending.

### Remaining browser admission and local consent fixtures

CI on `2c3bd8b5d` exposes two further fixture errors. The advanced lazy-loading
case creates an agentless company, then its global H1 locator races the correct
first-agent onboarding overlay. It now seeds one Native process agent with
heartbeat disabled and zero budget, pauses it through the Original API, checks
the named Dashboard heading and absence of that overlay, and retains every
advanced chunk/data loading assertion. The built browser case passes in 59.8
seconds; production admission and the test deadline are unchanged.

The managed-runtime component test could click a disabled action while a newly
read review's consent-reset effect committed. Its helper now selects only
unchecked local confirmations, verifies both remain checked and waits for the
enabled action. The Native provisioning request is dispatched once, never
retried by the helper, and the unknown-response case explicitly checks that one
dispatch before receipt recovery. All 21 monitor/pause/runtime cases pass. These
follow-ups change tests and this record only, not the production source whose
811 UI files / 7,974 cases, complete build and both built EN/DA observation
journeys pass on `05b7d0654`. Current-head CI and the remaining local default
catalog groups still control the final software-verification statement.
