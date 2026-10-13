# V9 architecture decisions

2026-10-09. Source baseline: merged V8 `b76141d317da78a43e5ab86b6f23ce731aeecc89`.
Implementation authorized by the user's follow-up. V3 §§76–86 specialize the
earlier experience guidance. These decisions do not upgrade hosted readiness.

## ADR-V9-001 — Project canonical state

Experience models are ephemeral, company/principal-scoped read projections.
Existing domain services own Tasks, Attention, Decisions, Approvals, Agents,
Foundation, Memory, Workflows, Notifications, Onboarding and recovery. Native
Customer Feedback is the brief's explicit new canonical domain. No other UI
queue, business object store, authorization engine or scheduler is introduced.

Cards carry canonical IDs, versions, observation time and current-authority
requirements. Typed schemas reject executable HTML, unknown payload fields,
external navigation and foreign tenant sources. The finite 18-kind catalog is
a rendering contract, not a tool capability. C0–C4 consequence levels stay
distinct from maintenance M0–M4 action tiers.

## ADR-V9-002 — Current authority and bounded fan-in

Routes authenticate, validate company selection and resolve current canonical
authorization. Native source permissions remain necessary. A second company
authorization check follows composition to suppress access revoked during work.
No shared cache stores customer card bodies. HTTP responses are private/no-store.

Whole-request admission (including identity, authority and final recheck) admits
at most four concurrent requests. Composition has a 1.5-second total deadline,
at most eight dependencies and eight
process-wide active reads. In-flight admission remains held until underlying
work settles, even when its response times out. Abort propagates to cooperative
readers; late results cannot mutate a returned projection. Source services that
do not support cancellation still consume bounded admission until completion.
This limitation needs fault/performance evidence before a production claim.
Healthy domains can remain visible when another dependency fails. Failure never
becomes a fabricated zero/healthy result. Effectful actions go through native
APIs with current permission, version, approval and precondition checks.

## ADR-V9-003 — Presentation profiles and route compatibility

Member, manager, admin and security-admin are presentation depths, not new
permission roles. The server derives maximum depth from current native grants
and membership. A preference can reduce depth; it cannot expand authority.
Platform operators remain outside customer navigation. Existing `/dashboard`,
`/issues`, `/decisions` and expert deep links remain compatible during migration.
Home, Needs You, Work, Agents and Apps form the ordinary navigation; Insights and
Company appear at authorized depths. Shell utilities remain persistent.

## ADR-V9-004 — Additive, default-off rollout

V9 flags live in the existing instance experimental settings, managed catalog
and transactional update path. Every V9 flag defaults off. Admission validates
the effective graph after native/managed overlays; dependent rollback must be
atomic. A flag is neither authorization nor implementation/release evidence.
Activation inherits effective V6 server-onboarding and V7 Free Core gates; hire and maintenance
inherit native package/steward gates. Privacy, erasure and recovery obligations
must survive flag disablement.

## ADR-V9-005 — Purpose and user-controlled disclosure

Core experience diagnostics carry dependency identifiers, timing/state and
bounded reason codes, not customer prose or exception bodies. Experience
analytics are a separate purpose-bound domain with an allowlist and explicit
retention/access/deletion contract; no new Paperclip telemetry event is implied.
Feedback diagnostics/excerpts/attachments require explicit user action. Old
Paperclip Labs consent cannot be reinterpreted as AW content-sharing consent.

## ADR-V9-006 — Evidence boundaries

`doc/experience/v9/` holds contracts and coverage; `evals/aw-v9/` retains readiness
and evidence. Source implementation, exploratory pilots, confirmatory usability,
manual accessibility and hosted qualification are distinct outcomes. Pending
evidence remains pending. V6 H6-01–18, V7 H7-01–03 and the three named native
runtime obligations remain inherited gates. C4 is not admitted without the
applicable domain standard; V9 does not invent a safety certification.

## ADR-V9-007 — Native feedback and private history ownership

Customer Feedback owns immutable submissions and append-only events. It references
existing work without becoming its scheduler or project backend. Private
`customer_feedback_access` supports account history, idempotency and subject-rights
erasure; product triage never projects that relation. No-name feedback nulls the
submission author, without promising anonymity. Company/technical context and
purpose-separated audit remain disclosed. Viewers can submit/respond to their own
feedback with current company-read membership; this grants no business write
authority. Internal triage requires a verified configured platform operator.
Customer history and follow-up remain available after flag disablement.

## ADR-V9-008 — Output-sharing migration and image admission

V9 feedback activation latches `aw-v9-local-v1` in native general settings. It
survives disabling flags and ordinary setting patches. Local votes skip trace
capture and never infer AW permission from Paperclip Labs consent. Queued exports
are suppressed; rollout must quiesce old export workers before activation. Already
delivered data cannot be recalled by this change. Per-submission AW excerpts need
selection, preview and their own purpose/consent contract before admission.

Images remain unavailable until parser/scanner, protected storage, unknown-write
reconciliation and erasure are qualified. No automatic screenshot or fake clean
scan exists. Retention has no invented duration: privacy/product owners must set
and qualify the policy before launch. Source readiness remains incomplete.

## ADR-V9-009 — Native intent-first activation and legacy-writer fencing

An additive JSON state on `company_onboarding_runs` owns the V9 journey. Typed
commands, native membership/creator checks, row locks, versions and retained
request receipts admit only the current material step. Raw intent remains customer
data. Confirmed company purpose creates or updates only a native Foundation draft,
preserving existing approved content and review. Website/connected ingestion is
not silently inferred from a domain string. Published customer package candidates
must retain current independent qualification and draft-only C1 scope.

Generated migration 0458 fences legacy stage/answer writers whenever V9 state
exists. Default-off rollout does not migrate an existing V6 journey implicitly.
No early plan selection occurs in a new V9 journey. A durable setup draft is not
first value: native task/run binding, enforced safe execution, verified artifacts
and activation remain pending. No synthetic result or activation timestamp is used.

## ADR-V9-010 — Native notification preferences and exact time boundaries

Generated migration 0459 extends native notification preferences with versioned
delivery timing, timezone, quiet hours and a daily digest time. Native encrypted
email outbox `not_before` owns delivery scheduling; its dedupe key groups a daily
company/user/category digest without another scheduler or notification store.
Local-time routing follows actual UTC minutes through DST gaps and folds. Invalid
stored policy fails to in-app-only delivery. Account-safety email bypasses quiet
hours and cannot be disabled. Stored preferences remain honored after flag disable;
only new policy editing depends on the flag. Rollback to an older binary requires
quiescing notification workers because older code cannot honor these preferences.

This source slice does not qualify Slack/Teams delivery, business deadline/severity
routing, responsible-owner selection, or a platform-wide interruption policy.

## ADR-V9-011 — Deterministic commands and governed authoring boundary

The fixed command catalog is a read projection over current native authority.
Cmd/Ctrl+K uses explicit English/Danish grammar for navigation, literal resource
matching and Task draft preparation. Commands never commit effects or invoke an
LLM. Resource results are company/principal-scoped, bounded and independently
filtered by native authorization; no total discloses forbidden records. Account
switch closes the palette; permission/erasure events reset retained results.

Run opens the existing workflow owner with current read/run grants and feature
gates. Create Task opens its editable native dialog. Semantic authoring requires
its own typed proposal/preview/approval/receipt adapter and is currently marked
unqualified. The legacy experimental Conference Room relay is not an Ask August
adapter and has no accepted command destination. Disabling the new flag restores
the legacy palette without dropping canonical work or privacy obligations.

## ADR-V9-012 — Canonical unpublished agent configuration

Existing `agent_config_revisions` are applied historical snapshots, not a draft
owner. The native agent domain now owns `agent_configuration_drafts` for new
configuration and revisions of existing agents. It does not create a second
agent, execution, permission or package owner. Draft create/save/discard have
creator/company/current-resource authorization, verified membership, bounded
content, immutable target/baseline and version/request fences. Account, company
and target hard deletion cascade the draft; discard removes authored content.
Applied configuration and its native revision history remain untouched.

Structured instructions, capabilities and memory settings are proposals. They
cannot grant tools or authority. Existing runtime bindings do not qualify the
new behavior. Representative execution, independent result verification, full
effective-policy diff and native publish mapping remain explicitly unqualified;
HTTP publish rejects and the UI cannot activate a draft. This is partial source,
not delivery of the complete CUSTOM lifecycle. Disabling `hire_agent_v9` stops
new create/save admission but retains private reads and content discard.

Initial native package installation additionally accepts an optional request ID.
The installing principal/company/request identifies one native installation;
its normalized request hash and package-path binding are immutable. Replays
return its current canonical receipt even after withdrawal/update/uninstall,
without another role assignment or audit. Current authority is still required.
No parallel receipt table or synthetic active version is introduced. Nullable
columns preserve legacy installation writers; new clients require the new
server before enabling this admission.

## ADR-V9-013 — Ordinary hiring reads qualified native releases

The Hire Agent catalog/detail is a read projection of the existing V7 package
owner. Its native catalog supports customer-audience selection before the
bounded query, then applies existing publication, expiration and independent
qualification rules. Customer-facing projection omits protected evidence URIs
and implementation components. No duplicated capability owner or client-authored
release qualification is created. Current verified company membership and
agents:create authority apply even to instance administrators.

Catalog/detail are partial HIRE source; missing-access assessment, representative
test, production review/publication and active receipt remain open. Declared
capabilities are conditional on native policy/access and do not grant them.
Withdrawn exact-version links never fall back to another version automatically.

## ADR-V9-014 — Pinned unpublished Hire setups share the native draft owner

Hire and Custom authoring use the same canonical `agent_configuration_drafts`
owner. Migration 0462 adds a default-custom journey kind and immutable native
package version/key/content-hash pins for Hire. Existing Custom rows retain
null pins; old Custom creation request hashes remain unchanged. Database guards
validate source pins on insertion, journey-specific steps and immutable scope.
They do not require current release availability to discard content, so withdrawal
cannot prevent erasure or rollback recovery.

Use this agent creates one private proposal, not an installation or active agent.
Owner and approved knowledge selection remain current native references. Hire
capability declarations cannot be broadened through save. New writes require a
currently qualified customer release; reads and exact creation reconciliation
retain the original pin after withdrawal. Frozen request/body/version retries,
explicit conflict reload and current-principal query keys govern recovery. Current
membership checks precede and follow private read assembly. Late save responses
cannot restore a UI after authority revocation.

Missing connected-app scope, representative execution/independent verification,
effective policy mapping, publication and active receipt remain open. HIRE-03–07
contracts describe partial source states and confer no release acceptance. Install
the new migration/server/UI before enabling the flag. Old binaries cannot render
Hire steps or pins; flag rollback with the new server retains reads/discard, while
binary downgrade requires draining new clients and retaining the recovery-capable
server until those setups have been reconciled or discarded.

## ADR-V9-015 — Needs You preserves native resolver ownership and page boundaries

The ordinary gated `/needs-you` entry renders the existing principal/company
experience projection. Exact decision/attention deep links use the existing
native resolver. `/decisions` retains the complete native queue and history.
Cards distinguish approval, question/confirmation, permission, recovery and
warning states. Consequences describe only known native pending state or an
explicit native blocked count; no future business impact is invented. The view
performs no approval, retry, grant or other mutation.

A native next-page cursor becomes typed partial coverage without exposing counts
or raw cursors. Neither Home nor Needs You may treat that partial page as a
complete empty queue. Existing admission, resource checks, private no-store
queries and authority invalidation remain applicable. Full card types/adapters,
inline native actions and human accessibility/usability acceptance remain open.

The strict shared dependency reason adds `more_items_available`; update native
server and V9 clients together before flag enablement. An older V9 client rejects
this new reason rather than misreading a partial queue as fully observed. No
persisted format changes; flag rollback restores the native queue.

## ADR-V9-016 — Workflow review projects native revisions without creating authority

The gated ordinary workflow detail shows a plain-language step review before
the existing Advanced graph editor. A new human-only private read reuses native
workflow permissions, revision reads and learned-asset privacy checks. A required
expected principal prevents account-switch reads; native workflow admission and
read permission are rechecked after assembly. No additional workflow store,
revision, action or test result is created.

The immutable published revision and mutable draft pointer are displayed
separately. A native workflow created with status active but no publication is
called Draft. Step numbers identify declarations; actual native connections and
branch labels/output keys remain visible; dependency order is not presented as
an execution trace.
Projection excludes graph configuration, prompts, schemas, variables, credentials,
actor assignments and results. Unknown operations retain unknown effect/policy.
Registry effects, test modes and retry defaults are declarations, never verified
safety, effective permission or a passed test. Oversized or incomplete topology
is unavailable rather than silently truncated, including cycles/duplicate edges
(100 nodes / 200 edges per revision).

Company/principal/record query keys, no-store/gc=0 and new observer epochs hide
private data during authority/privacy/version invalidation and reject late old
responses. The endpoint has a purpose-separated HTTP logging policy. Advanced
edit links use current native edit permission; reads cannot publish, run, retry,
pause or retire. The new server/shared schema precede the enabled client. Flag
rollback restores the native graph route; /advanced retains a direct graph link.
Full actor/input/effect/access review, governed chat authoring, representative
testing and the remaining lifecycle are open. WORKFLOW-REVIEW remains in progress;
source tests confer no release or human usability qualification.

2026-10-13 continuation: the client additionally checks the current Original
session cache before and after each private read, including invalidation and
account changes before React settles. Private controls are withheld during that
recheck. A Source epoch rejects late old responses; the utility-aware heading
owner preserves an ongoing keyboard/input/navigation gesture. Eight focused
review cases pass; full actor/input/access review and guided lifecycle completion
remain open.

## ADR-V9-017 — Agent revision entry uses native metadata-only admission

Agent detail may offer a revised private setup after a bound, private/no-store
read of the existing agent authoring owner. This read returns only company ID,
target ID and eligibility. Current verified membership, native create/configure
and target read, SaaS admission and the same creation flag apply, with a final
authority recheck. Instance administration does not substitute for membership.
The target lookup reads identity/status/built-in metadata rather than runtime
configuration. No proposal, audit mutation, active agent or grant is created.

The existing unsaved-change guard precedes navigation to the exact target's
Custom draft flow. Company/principal/target query keys and live invalidation
remove stale admission; late confirmation cannot navigate after unmount or a
context change. Flag rollback hides the entry while the new native service
retains private draft reads/discard. New server/shared contracts precede enabled
clients. No migration or additional business owner is introduced. Testing,
publication, active receipts and fencing all expert active writers remain open.

## ADR-V9-018 — Workflow change comparison reveals indicators, not private values

The existing private workflow read compares bound native published and draft
revisions in-process. Native step identities and validated dependency numbering
identify additions/changes; removed-step counts and connection/data-definition/
settings indicators explain other changes. Layout and insertion order are not
material. Raw values and fingerprints never leave the projection. Both revisions
must be completely projected and comparison is bounded by entry, character and
depth budgets. Incomplete comparison is unavailable, never unchanged or approved.

The same native read/privacy and final admission checks govern this result. No
new owner, write, grant or test result is created. New strict server/shared/client
contracts deploy together before enabling the existing shell flag; rollback
restores the native graph route. Complete access/test/publish lifecycle review and
representative human qualification remain open.

## ADR-V9-019 — Private native workflow attempt metadata

2026-10-09. A read-only customer run view uses the existing executor's company,
learned-source and private-payload admission and the exact historical revision
owner. Superseded/discarded revision state remains distinct from current active
publication. Current human principal, native workflows:read and final admission
checks remain required. No new workflow, trace record, approval, retry, execution
or publication owner is introduced.

The strict projection allows run/revision identity, recorded statuses/attempt
numbers, registry operation labels, execution-kind presence, declared checkpoint
and current wait kinds on waiting attempts. It excludes actor IDs, raw errors,
inputs/outputs, token/reference values, resolutions and hidden reasoning. Native
payload deletion remains explicit. Bounds are 100 nodes, 200 graph edges, 500
attempts and 200 waits; invalid/unbound or oversized history is wholly unavailable,
not truncated or successful. Empty means no recorded attempts. Native read-owner
query latency and private-payload checks remain inherited. Full selected-actor,
verified outcome/error and executed-branch inspection remains open.

A private/no-store namespace also minimizes generic logs for rejected requests.
Company/principal/workflow/run query identity, authority epochs and native source
access-loss invalidation suppress retained/late private metadata. English/Danish
copy distinguishes recorded completion from independent verification. The
existing shell flag is default-off; rollback restores native run controls and an
explicit /advanced route remains available. No migration is needed. Deploy the
new shared/server/client contract before enabling this customer view.

## ADR-V9-020 — Current Company controls and private settings search

2026-10-09. The existing Company navigation owner rechecks each effective native
permission and administrative eligibility after assembling its bounded metadata.
Loss of the administrative profile rejects the response; loss of one entry's
permission suppresses that entry. Native role-default grants remain authoritative;
removing an explicit grant row alone does not necessarily revoke effective access.
The existing 1500 ms admission/deadline and feature rollback remain unchanged.

The UI binds response company identity, resets search on company/account changes,
hides retained controls during rechecks and advances its query epoch on native
permission/membership/privacy/source-loss events. Search stays in browser memory
and only filters native-authorized labels/purposes/old aliases; no search text is
sent to the API. Results retain the ten categories, show restricted-access context
and announce matching counts. Navigation conveys no grant. Native destination
owners still check current authority for every effect.

The private Company namespace minimizes generic success/rejected-request logs.
No API/schema/database migration or new settings owner is introduced. Legacy
clients retain the same response shape; the new UI can use the existing server
contract, with the updated server needed for final admission rechecks. Feature
rollback preserves the native Company settings routes. Full settings catalogue,
native form lifecycle and representative accessibility/usability qualification
remain open.

## ADR-V9-021 — Current native work projections and read recovery

2026-10-09. Home, Needs You and Work remain read-only projections over native
Tasks, Attention, authorization and settings. The existing owner repeats bounded
source checks after fan-out: changed/hidden Tasks are suppressed, current Task
reads are authorized, Attention is re-read without queue materialization and
resolved/changed items are suppressed. Suppression marks the relevant dependency
partial rather than claiming a complete empty queue. Current expert grants and
profile eligibility are rechecked; a changed native experimental context rejects
the receipt. All checks stay inside the original four-request admission and
1500 ms deadline. They establish a checked read snapshot, not a durable grant
or an atomic lock against future source changes. Effectful destinations continue
to reauthorize through their canonical owners.

The client binds the validated receipt to its requested company, hides retained
cards during identity resolution or rechecks, and advances a principal/company
query epoch on native permission/membership/privacy/source-loss events. Late old
transports cannot restore a superseded receipt. Loading and safe errors use
semantic status/alert recovery, with heading/error focus and English/Danish copy.
Ordinary background refreshes preserve utility focus; open dialogs keep their focus.
No customer payload or raw error is stored, logged or sent to a new destination.
There is no new API shape, owner, migration, permission or business mutation.
Ship the updated server before enabling V9; flag rollback retains the native
routes. Full source composition, hosted multi-user/assistive-technology and
representative usability qualification remain open.

## ADR-V9-022 — Private feedback reads and original-request recovery

2026-10-09. The existing feedback owner, immutable submission/event tables,
current author/operator admission and version/idempotency checks remain the only
write authority. The UI keeps an unacknowledged creation, customer follow-up or
triage tuple immutable: text and material inputs cannot replace its request key.
Retry uses that exact tuple. Only canonical validation or the exact native
version/status refusal releases it for correction; transport, authorization,
malformed/foreign receipt and unknown failures do not establish non-application.
Successful feedback receipts must match the requested company and, for an
existing report, its resource ID. Invalid deep-link IDs fail before transport.

My Feedback hides retained history and response text while identity or reads
are being checked, and rejects late prior epochs after native access loss.
Its selected response component retains its private in-memory original request
while rendering no private content during a read recheck. Replay remains possible
if a refreshed native status has moved to REVIEWING after an accepted-but-unheard
follow-up. Current operator reads also suppress retained private details while
rechecking and validate detail bindings. Query identity remains principal/company
scoped; private mutations have zero inactive cache retention. No browser persistent
storage, analytics or new data destination is introduced.

There is no API shape, database, permission or server change. Native transactional
replay precedes the version/status check; no second customer message or triage
event is inferred from a retry. Existing default-off rollout, native authorization,
private logs, account erasure and immutable original text remain authoritative.
The recovery tuple is scoped to the current UI session: full page exit, another
selected report or context/flag teardown may discard it; durable cross-navigation
recovery, complete triage/retention/attachments and hosted/human qualification
remain open. This source does not claim those pending requirements complete.

## ADR-V9-023 — Native workflow pause, resume and drained retirement

The existing workflow owner now accepts explicit current-human lifecycle commands.
The original request UUID, expected status/timestamp and active/draft pointers,
and `finish_existing` policy are immutable until acknowledged or canonically
refused. Native company/source/read/publication admission is repeated under the
transaction; membership/grants and rollout configuration remain locked through
commit. The workflow row is the status/version fence and the activity receipt
commits with the change. Replays repeat current admission, bind principal and full
command, and return the original historical receipt without undoing later state.
There is no new authoritative lifecycle table or secondary execution engine.

Every native enqueue, including routines, pipelines and child workflows, repeats
status admission under that same row lock. An earlier status read cannot admit
new work after Pause. Already admitted work retains its own approvals, recovery
and cancellation policy. An already admitted enqueue receipt can be returned
without creating more work; this does not add a new legacy manual-run replay API.
Resume requires a published version and current SaaS workflow admission. Active
and draft revisions remain unchanged by pause/resume and no new grant is issued.

Retirement requires Pause first. Nonterminal runs, steps, active waits, bound
queued/running provider children, and pending/executing/failed/timed-out tools
refuse retirement; uncertainty is not a completed drain. Existing routine,
pipeline and current parent-workflow references require deliberate removal.
Accepted retirement discards the draft pointer/version deliberately, preserves
the immutable published pointer and run history, and permanently blocks native
new admission. Shared connections/grants/schedules are not automatically deleted.
A reference concurrently introduced by an inherited owner still cannot enqueue
into the archived workflow; full dependency-authoring fencing and automated
owned-resource cleanup/reconciliation remain open. No external effect is retried.

The customer controls disclose consequences before each effect. Pending private
reads suppress all controls/receipts but preserve the scoped original tuple;
ordinary dialog close/reopen retains retry. Only explicit pre-effect native
conflicts release it for a newly reviewed version. Foreign/malformed receipts
cannot establish success. Confirmations describe the original receipt; they do
not promise the workflow's current state after someone else changes it. No new
browser persistent storage, telemetry or external data destination is introduced.
Full route/account/company/flag teardown durable recovery remains open.

Strict shared/server/UI versions must be deployed together before enabling the
existing default-off progressive shell: older strict clients reject the new
canOperate/updatedAt fields. Flag rollback keeps native paused/archived state;
it never silently resumes or un-retires work. Full operation overview, safe Run
now, representative test/publish, independently verified external outcomes,
inherited runtime gates and hosted/human qualification remain open. These two
partial Screen Contracts do not upgrade V9 source or release readiness.

## ADR-V9-024 — Native workflow operation observations

The native workflow owner assembles the overview under existing company/memory
privacy locks and workflow/run share locks. It reads eleven recent and six
waiting/recovering candidates, exposes at most ten/five and explicitly marks
additional history. Every candidate uses current native revision and copied
payload-source admission; a source failure suppresses the whole view. The routine
owner returns only the earliest enabled, configured schedule for an active
workflow target. That configured time is not guaranteed execution and does not
exclude an earlier API, routine, pipeline or parent-workflow request.

Private/no-store reads bind current human/company/resource and recheck native
permission and rollout after asynchronous work. The UI additionally binds the
parent's status/update timestamp/published pointer and hides all retained metadata
while reads run. Recorded execution success does not establish independently
verified business value. Failed historical runs are separate from current
waiting/recovering work. No inputs, outputs, errors, prompts, routine labels,
credentials or execution principals are exposed, and reads create no receipt or
effect. This direct native view retains native source budgets; cooperative SQL
cancellation, full orchestration performance qualification, safe Run now,
independent outcomes and the complete lifecycle remain open.

## ADR-V9-025 — Reviewed bounded internal workflow admission

The customer Run now command uses the existing native workflow executor and
activity ledger, under the same company/privacy/configuration/workflow fence as
Pause. Current human read/run authority and source admission are required on
every attempt, including original-receipt reconciliation. New requests also
require an active exact published/draft/timestamp tuple, native graph validation
and SaaS workflow admission. No new queue, scheduler, policy engine, grant or
persistent schema is introduced.

The first customer admission subset is closed to built-in pure C0 manual,
condition, switch, merge and parallel nodes, with at most 20 nodes,
40 edges and 65,536 serialized characters. Input/output schemas and variables
are absent; a configured total deadline of 1–60 seconds is required. Registry
metadata cannot substitute caller-defined purity. Child workflows, provider/model
work, network/tools and approvals require their existing Advanced review. This
eligibility rule is not representative execution qualification or independent
business verification.

The atomic existing activity record stores the immutable original command and
strict admitted receipt. Same-principal exact replay returns the original native
run even after Pause or later publication, after current authority/source checks;
a changed UUID payload is refused. Native execution/lease/recovery owns that run.
Inline execution is best effort, and the response never upgrades admission to
completion. Native run inspection remains the source for recorded results.

Run and lifecycle dialogs capture version pointers at opening. Confirmation and
unknown retries cannot substitute a newer publication or retirement draft. UI
receipts bind company/workflow/request/revision; private rechecks hide retained
controls without losing the mounted original tuple. Durable recovery after full
route/principal/flag teardown remains open. Compatible strict shared/server/UI
versions must deploy together before the existing default-off rollout; old
strict clients reject canRequestRun/runAvailability. Rollback never resumes work.

CI pulls the same digest-pinned PostgreSQL manifest from the official Docker
image ECR public mirror. Manifest bytes hash to the unchanged reviewed SHA-256;
Docker Hub's unauthenticated quota had blocked tests before execution. No mutable
image tag, test omission or increased budget is introduced.


## ADR-V9-026 — Bound native control checkpoint projection

2026-10-09. Customer run inspection projects a completed condition boolean or
switch checkpoint only onto the next-step name in the exact bound historical
revision. Native edge-handle normalization is preserved. Private switch keys,
raw outputs and expressions are excluded. A selected next step is not evidence
that it executed; no branch is inferred from target attempts, parallel paths or
merge activity. Missing, deleted, incomplete, recovered and ambiguous checkpoints
remain explicitly unrecorded. Recovery-policy branches remain unqualified.

Graph edges must have unique identities and bound source/target nodes, in
addition to the inherited whole-trace limits and company/run/attempt binding.
Current native privacy and learned-source admission still precede projection.
The shared/server/client contract adds a strict branchChoice union, deployed
together behind the default-off shell flag. No migration, checkpoint writer,
approval or executor owner is introduced. Complete selected-actor inspection,
executed paths and independent verification remain open.

## ADR-V9-027 — Complete native experiment transport within original bounds

2026-10-09. The existing strategy source owner transports current issue/project
rows in bounded batches, then performs its original authorization independently
for each resource and project ancestor. Minimal private row maps come only from
same-tenant, share-locked native rows in the enclosing company → Memory
transaction. They accept no caller material and retain no authorization decision.
Other strategy reference reads continue through the original point-read path.

The experiment owner reads lineage in groups of 1,000 receipts and inserts the
complete signed capture in groups of 4,000 outcomes. Native tables, triggers,
tenant/identity filters, limits, signatures and transactional atomicity are
unchanged. Tenant, protocol and capture-time constants are bound once per insert
statement. Every original per-row snapshot, hash, pin, signature and identity is
retained. No sampling, partial result, increased deadline or migration is used.

Replay reuses only immutable lineage calculations inside that inspection. Exact
assignment manifest and outcome project identify expected comparisons. Each
outcome still validates its actual retained edges, original signed facts, expiry,
metric arithmetic and current source authority. Legacy fully copied lineage
remains supported. No cache survives the transaction or actor boundary.

All 49 native cases in the three affected suites pass. The maximum case captures
all 68,000 outcomes and replays them within each original 30-second bound; replay
takes 15.7 seconds in this local fixture. This single software fixture is not a
hosted percentile, sustained-load or business-outcome claim. Full final-source
types/build, complete regression and current remote CI remain required.

## ADR-V9-028 — Reviewed customer stop through native cancellation

2026-10-09. Stop is a run-scoped command to the existing native cancellation
owner, not a second executor, provider kill mechanism or reversal. Its strict
command binds request, workflow, historical revision and reviewed run timestamp,
and explicitly acknowledges retained completed effects. Company → Memory →
configuration → current membership/grants → workflow → run locks protect native
admission. Current human read/run authority, retained revision sources and copied
run payload access precede receipt replay as well as a new effect.
The existing native cancellation route's viewer write fence is preserved.
Current membership role is checked under the native transaction lock, so a
stale operator snapshot cannot survive a current viewer downgrade. Read views
also hide Stop for the current viewer role, even with a retained run grant.
The native authorization owner exposes its existing current admin-role lookup
with an optional transaction share lock. Both the cancellation fence and view
use actual role evidence; retained actor admin flags cannot restore revoked
administration. Run-view read grants are repeated through the same native owner.

The existing activity ledger records the exact command and cancellation-requested
receipt in the same transaction as the native cancellation fence. Identical
same-principal requests serialize on the native run row. A reused UUID with a
different command is refused; a new request for changed or terminal work requires
a new review. A historical receipt remains distinguishable from current run
status, including after Pause or later publication. No model or migration changes.

The native owner cancels waits, pending steps and approval requests, and drains
its existing child workflow, issue and heartbeat cleanup. Failure to finish child
cleanup retains the durable cancelling status. Recovery continues cancellation
after workflow rollout is disabled, selecting only cancelling runs and never
advancing queued, running or waiting work in that mode. Admission does not claim
that remote providers stopped or that unknown outcomes have been reconciled.

The confirmation captures the reviewed tuple at dialog opening. Unknown replies
retain the identical command across ordinary private-read checks; current denied
or checking views hide controls. Only a canonical pre-effect conflict permits a
fresh UUID. Account/company/run teardown still loses in-memory reconciliation
state and remains an open requirement. The new updatedAt/canRequestStop fields
and strict command/receipt require compatible shared/server/UI deployment behind
the default-off shell flag. Hosted, provider, full-graph and human qualification
remain separate from source tests; V9 source completion is not promoted.

## ADR-V9-029 — Recover stop admission from its native private ledger

2026-10-09. A fresh run view projects only the current human's latest native
`workflow.customer_stop_admitted` event for this company and run. Its strict
original command and receipt must bind the actual historical workflow/revision,
run and request. Existing native entity indexes bound the lookup. No browser
storage, second receipt table or effect is introduced by this read.

Current read/run authority, rollout and actual membership/admin role gate the
receipt. The run's private copied-source admission is repeated after assembling
it; final read/run/rollout/role checks precede release. Another authorized human
may read the run but cannot recover the original submitter's admission. A denied
or checking view hides retained receipt data. Malformed or foreign retained
bindings fail closed without exposing their private fields.

The strict shared run-view schema rejects cross-company/workflow/run/revision
receipts and receipts accompanying absent stop authority. A fresh UI displays
admission separately from current cancellation status. An in-memory unknown
attempt reconciles only its matching request; an unrelated historical admission
cannot acknowledge it. This closes recovery after navigation/reload for admitted
customer stops. A command that never reached native admission still has no
canonical receipt; transport loss alone never proves application or reversal.
Provider termination, unresolved external effects and human usability remain
separate qualification gates. Deploy compatible shared/server/UI versions
behind default-off rollout; R0/sourceComplete=false remains unchanged.

## ADR-V9-030 — Recheck command sources and availability before release

2026-10-09. Deterministic command search remains a bounded read projection. A
final company context check cannot replace resource-specific admission. Each
retained agent/project/task name is reread in its current company, visibility,
status and version, then admitted again through the actual native authorization
owner. A changed source refuses the whole result; it never releases a stale
private name or treats an unavailable source as an empty successful search.
Command availability decisions are also repeated before release without reusing
the initial permission cache. Profile or rollout-context changes refuse the
reply within the inherited 1.5-second admission budget.

The mounted palette cancels and removes current private query data on relevant
native source/authority events, advances its query epoch, and hides retained
names and selectable actions while checking. A response from an older epoch
cannot restore them. Account/company teardown retains the existing close/reset
boundary; a failed read uses safe copy and focuses the error. No model, effect,
permission, storage, migration, notification or new destination is added.
Native tests inject actual hidden/changed tasks, terminated agents, archived
projects and a revoked real command grant after their first native decision.
UI tests cover current-company invalidation and a late old response. Full source
qualification remains required; semantic authoring/channel parity and human
usability are not promoted by these read-only fixes.

## ADR-V9-031 — Test unpublished immutable revisions in the native executor

2026-10-10. A reviewed draft test uses canonical native run source `test`.
It binds the actual immutable draft ID, workflow timestamp, request UUID and
expected Succeeded result. Native queue admission and the original activity
receipt commit together under current company/privacy/settings/authority and
workflow locks. Test admission publishes no revision and creates no hidden live
clone, executor, scheduler or result store. Existing leases, cancellation,
deadline enforcement and recovery own the run. Draft replacement changes the
native pointer while the recorded run stays on its original immutable revision.

Only manual/condition/switch/merge/parallel internal C0 graphs qualify: empty
synthetic input, no input/output contracts or variables, no agent/model/tool/
network/child/approval/Optimizer execution, no delayed retries/human recovery,
20 nodes/40 edges/64 KiB UTF-8 and an explicit 1–60 second execution deadline.
The UI discloses input, expected result and deadline and requires fresh explicit
acknowledgement. This is a software control-flow test. Representative customer
inputs, material test modes and full section 81.8 remain open.

Admission, replay and private receipt recovery require current native human
read/edit/run grants and actual non-viewer membership/current admin role. Queued
execution and each internal step recheck the original initiating human; recovery
cannot replace that principal with a system actor. The original receipt is
recovered for its submitter after reload with actual revision/run/private source
admission and strict bindings. Admission is separate from current run status.
Unknown transport outcomes retain the same reviewed command; an unrelated older
receipt cannot acknowledge a pending request.

Test purpose derives from native source in private run/operation DTOs and stays
explicit after publication. Native Optimizer trace/correction ingestion, sample/
terminal-run/live-drift queries and production transform bindings reject or
exclude tests. Privacy/erasure, history and pending-work cancellation/retirement
continue to include them. Legacy manual requests cannot select this source and
legacy retry cannot convert a test to live work.

Generated migration 0463 changes only the run-source constraint. Preserve test
history on rollback; disable customer admission and drain existing work. Deploy
compatible shared/server/UI and quiesce old workers before enabling this path:
older executors do not execute unpublished revisions and older Optimizer readers
lack the test evidence exclusions. Mixed-version qualification remains required.
Hosted/provider/human evidence and V9 source completion are not promoted;
R0/sourceComplete=false remains unchanged.

## V9-032 — Agent monitoring projects native scheduling, not readiness

The customer monitor is a bounded private read of existing agent and heartbeat
status metadata. Current resource/source/rollout admission and a second native
row/history read fence stale projections. No prompt, active configuration, error
prose, result payload or secret is copied. Native idle/running/active map to
scheduling Active; this does not imply qualified readiness. Succeeded remains
recorded execution status, not independent business verification. Controls remain
with native owners; retirement cleanup and active draft publication require their
own complete mutation contracts. No shadow lifecycle, run table or scheduler is
added. Rollback hides this surface and preserves native history and controls.

## V9-033 — Maintenance reviews fence the existing installation owner

The existing Core Steward scanner provides a version/time/installed-source/
candidate-content review; the native installation owner checks it under its
existing current-authority/source/row locks. With V9 bounded maintenance enabled,
company/resource configured-change budgets and a native daily loop-blocked audit
event prevent repeated successful configuration churn. Company Memory privacy
advisory locking serializes these counts across installations. A deadline and
native postcondition verify configuration only; activation remains human owned.
The native Core Steward disable flag retains the kill path. The additive V9 flag
is not represented as disabling separately authorized inherited V7 stewardship.
Unknown/external/failed-attempt repair contracts and customer escalation remain
unqualified; M3/M4 changes are not admitted through this unchanged-content path.
No parallel maintenance scheduler, broad retry permission or new grants are added.

## V9-034 — Publish the exact reviewed internal test through the native owner

Customer publication is restricted to the immutable current closed C0 draft with
its same-human successful native Test run and an explicitly acknowledged tuple.
Read/Edit/Run/Publish, current role/source/rollout and native admission are required.
The existing workflowService.publish owns revision transition/next draft and drift;
an enclosing native transaction owns the original publication receipt. Replay and
reload use retained native history with current private admission, never a browser
receipt or new publication request. Publication proves its original revision fact,
not current active status or qualified material/business work. Test purpose remains
Test after publication. The former published revision is retained historically.

## V9-035 — Maintenance history reads original native receipts

A bounded, private installation-specific customer view reads existing Core Steward
M2 configuration and loop-breaker activity. Native company/agent read admission,
actual installation and historical version/content-hash bindings remain necessary;
current authority and rollout repeat before returning. The original recorded
configuration required activation; a recorded budget exhaustion required human
review. Neither receipt establishes current activation, resolved escalation or
business verification. Current installation status is displayed separately.
No history table, new maintenance engine, grant, notification or repair is added.

## V9-036 — Escalate current maintenance findings through Needs You

Only original native M2 budget exhaustion with still-current installation, reviewed
candidate qualification, unchanged execution content and exhausted actual counts
may project a human-review card. Current native company/agent read and configure
authority are required, without stale instance-admin shortcuts. Source/authority
and rollout repeat within the existing Experience admission deadline. Historical
receipts alone are insufficient; candidate withdrawal or owner changes suppress
the card. Missing review bindings degrade coverage rather than claim all clear.
The 25-card projection retains critical native approval priority and marks each
truncated owner's actual coverage partial. The existing package owner retains
every effect; no alternate escalation queue, repair, grant or notification is added.

## V9-037 — Privacy declarations do not qualify feedback GA

All six §85.22 policy references are startup-owned, strict, bounded configuration.
Unset preview remains explicit; partial/malformed declarations fail without private
input in errors. Policy keys carry no invented retention period or legal decision.
Public policy state exposes no policy references or owner identity. Configured
references remain execution-unqualified and GA admission refuses even when all
keys exist. Native retention/DSR/legal holds and protected attachment qualification
remain necessary. Customer/admin/triage/model input cannot set these policies.

## V9-038 — Customer-reviewed diagnostics reuse the private native run view

The existing account/company/workflow/run-authorized native experience read owns
source authority. A strict local projection produces only UUID references,
recorded version/state/time/purpose and consistent bounded attempt status counts.
No source object spread, step name, branch name, error, actor identity, prompt,
credential or stop receipt enters the report. Unavailable history differs from
empty history and recorded execution remains distinct from business verification.
An explicit preview precedes a local browser download; no automatic network send,
clipboard, telemetry, server store or browser persistence is added. Native read
rechecks unmount the preview and export controls. Blob URLs are released after the
explicit action, including failures. The fixed support mailto contains no report
data. Download initiation is not proof of saved file or external delivery; exported
snapshots confer no grant and V6 scoped support access remains independently owned.
General support/recovery and human accessibility/usability qualification remain open.

## V9-039 — Native durable maintenance attempts precede bounded effects

The existing package installation, company privacy serialization and native
activity transaction own admission. A source/owner/release-validated transaction
records an attempt before the unchanged-content M2 effect. The effect separately
repeats flags, original human authority, exact reviewed source and native pins.
A reserved V9 attempt cannot downgrade to inherited V7 authority. Three resource
or ten company starts per day, including known no-effect attempts and legacy
unlinked configured receipts, bound recurrence without double-counting linked
configuration receipts. Atomic native outcome and configuration records retain
activation-required; no execution or business verification is inferred.

A five-second native reservation lease is checked against database wall time
before effect and before its transaction can return successfully. Source version
guards and the durable original attempt additionally fence stale workers. A live
reservation blocks duplicate scans without premature escalation. An expired
unconfirmed original source remains blocked without time expiry; only an explicit
native owner source transition supersedes its tuple, retaining the audit.
Unknown outcomes are not relabelled as failed, closed or safe to retry. Native
history/Needs You disclose owner review without creating a grant, notification,
new scheduler, secondary ledger, automatic rollback or harmful retry.
General external/material reconciliation and M0–M4 recovery remain open.

## V9-040 — Customer support history reuses original V6 owner authority

The original active native user/owner membership predicate is shared unchanged
with V6 approve/revoke/operator admission. The V9 read repeats company scope,
owner, original V6 and V9 rollout under privacy and share locks with a five-second
bound. Ten newest original support records plus a has-more boundary form a strict
DTO. Reasons, approving-owner identity, operator configuration, private work and
raw errors are omitted. Record/operator references, fixed scopes and original
times remain inspectable by the actual company owner. Recorded/expired/revoked
are facts at observation, not current authorization; V6 independently rechecks
configured operator, approving owner, exact scope and expiry at use.

The private no-store customer query is keyed by account/company/epoch, unmounted
during checking and erased on relevant native events; late old-owner results
cannot return. Company navigation offers the new history link only to the actual
V6 owner. An explicit link opens original separate native controls; the read itself
creates no approval, grant, privileged action, outbox message, alternate ledger,
telemetry, browser persistence or automatic support transmission. Full V9
immutable approval review/unknown-command recovery and human acceptance remain
open; this view does not qualify those original material actions.


## V9-041 — Attempt history reads original native evidence without recovery authority

The existing authorized maintenance history transaction now reads the ten newest
original Core Steward starts, separately from its ten receipt rows. Each start
binds the actual package versions/content hash and exact source review. A terminal
must be unique and match its original start; configured outcomes additionally
require the uniquely linked original configuration receipt. Inconsistent Native
evidence refuses the projection rather than selecting a favorable outcome. Native
database wall time distinguishes awaiting receipt from unconfirmed after the
unchanged five-second lease. Missing evidence never establishes no effect.

Only attempt references, times, fixed outcomes and current/historical source
relation leave the read owner. No source tuple, actor, repair control, grant,
activation, alternate ledger or new audit is created. Absence of the optional
projection on an older response is unavailable, not an observed empty history.
Foreground polling and Native events reread current authority while hiding old
private state. General M0–M4/external recovery and human acceptance remain open.


## V9-042 — Original Native support command recovery

The original V6 support owner now accepts an optional explicit original-session
UUID. New customer controls first freeze that reference and review input, then
reserve a hash in the existing scoped Native activity log. No private reason,
operator payload, new permission, notification or browser persistence is created
by preparation. A current owner may retain one unresolved original review. Reload
recovers that reference before another review can be prepared. The original
Native owner remains the only grant writer; old callers without a reference keep
their original behavior and are not certified as using the new customer protocol.

An exact reviewed grant serializes on the original reference and binds company,
original approving owner, operator, reason, normalized scopes and duration.
Replaying returns the original Native row and uniquely linked audit without
renewing expiry, undoing revocation or creating another grant/notification.
Missing, duplicate or inconsistent Native evidence refuses reconciliation.
Preparation/approval/receipt reads hold current rollout, privacy and owner locks.
Cancellation is independent of rollout: it records the original hash terminal
before a later grant can commit, or returns recorded when the grant already
committed. Cancellation never silently revokes recorded access. Concurrent
cancel/grant has one Native outcome. A current-use operator still independently
rechecks original owner, configuration, scope, expiry and revocation.

The current customer form uses explicit frozen review and unchecked approval,
content-free Native pending recovery after navigation/reload, exact original
receipt reads and explicit original cancellation/revocation. Private state is
hidden on current source checks/loss. Source implementation does not establish
migrated/browser/human/hosted qualification; legacy callers, general external
recovery, support assistant and full launch acceptance remain separate/open.

## V9-043 — Optional protocol seams preserve current Native presentation authority

AG-UI spec 1.0 CUSTOM and A2UI v0.9 custom-root mappings are pure offline adapters
over the existing strict experience DTOs. Pinned official schemas/licenses are
retained for actual upstream validation. The client experiment renders the same
typed ExperienceCard. Neither helper is mounted as a production host or grants
authority from protocol content. Decoding requires complete equality with a
separately admitted current Native snapshot, company and expected surface;
returns that Native copy; refuses all material actions, dynamic functions,
handlers, metadata, extra components and unknown versions. UTF-8 payloads are
bounded to 64 KiB without truncation; refusal copy contains no raw payload.

The caller must still obtain current authorization and invalidate stale/denied
epochs. Structural protocol compatibility proves no execution, provider,
production adoption or human acceptance. All 25 focused tests pass, including
official AJV schemas, Native identity adversaries and DOM escaped/read-only
behavior. Strict workspace types/build and the built Storybook mobile checks in both
themes pass. Combined full regression remains pending. General protocol streaming/rendering and MCP Apps are separate/open.

## V9-044 — Hire access declarations are separate from effective authority

The original Native customer catalog and pinned Hire capability owner project a
strict optional declaration of the original package manifest: maximum consequence,
optional apps, memory, material approval, supervision, independent verification,
environment responsibility and supported runtimes. Scope assessment stays
unavailable and authority effect stays none. Older owner responses without the
field remain readable and show unavailable, rather than an empty assessment.

The actual guided Authority screen displays customer wording and withdraws the
declaration while checking its current source. A declared managed environment is
a requirement, not proof of availability or qualification. The read creates no
installation, grants, execution, output or Native readiness receipt. Twenty-seven
focused checks pass, including forged-authority schema negatives and existing
Hire recovery tests. Exact Native catalog assertions pass in the actual migrated package suite.
Strict workspace types/build and current built app checks pass; full regression
and hosted/human acceptance remain pending.
Per-app effective scopes, representative execution and activation stay open.

## V9-045 — First value references original independent verification

The existing onboarding JSON may retain original installation, verification,
Task, heartbeat-run and result-hash references. Only the original verified creator
can record them. Current C1 customer-package qualification and the exact licensed,
purpose-approved Native installation are required. A successful run alone never
qualifies: the original single-worker contract must match the saved first goal,
the creator/responsible user and package agent must match, and the exact retained
human worker review must pass against current artifact/source pins. The existing
verification service performs that read; the new projection does not reconcile
attempts, certify completion, change a Task or write another evidence store.

Analytical/privacy, current company/member, settings and original resource locks
cover reads and metadata writes. Native clock/read bounds refuse stale or oversized
complete reads. The original immutable request hash/version fence records the
first-value time from the database clock. Replay cannot renew it or create work.
Explicit use-result completion checks the same evidence again before completing
only the original onboarding owner. Revoked/deleted/changed evidence withdraws
result titles, links, use-result controls and success headings. The historical
first-value timestamp does not establish current authority or business impact.

The client binds every response to the requested company, aborts late private
reads and hides source data while rechecking. Initial resume follows current
Native state, while explicit Back can inspect previous steps. Same-version
rechecks preserve unsaved input within the same account/company scope. Actual
onboarding/activation HTTP namespaces have content-free failure logging.

Two actual migrated Native cases pass for exact binding/completion/replay and
revocation withdrawal. The tests use explicit Native license, approved-purpose,
Foundation and provider fixtures; they establish no real customer output or live
billing/provider qualification. Full current focused/types/build/browser and
aggregate checks remain required. General first-task creation/execution, Core
capability delivery, connection/access flow, artifact correction, privacy-approved
analytics and complete hosted/human onboarding acceptance remain open.


## V9-046 — Activation account revalidation and late acknowledgements

2026-10-10. Retain the same account/company React scope for unsaved draft recovery,
but conceal its private body and actions while the current session or SaaS
capabilities are being rechecked. Each transition uses a new read-query epoch, so
restored account authority cannot present the cached old Native view before a new
owner read. A new principal/company remounts the scope and cannot inherit drafts.

Mutation requests remain frozen under their original idempotency key. An
acknowledgement that crosses any authority epoch cannot populate current query
data or navigate; it becomes an unconfirmed outcome. After a fresh account and
Native read, explicit retry reconciles exactly the original request. No browser
persistent storage, authority grant or additional domain writer is introduced.

Focus may start session and Native query observers before React commits pending
state. Activation therefore checks the original session/capability query cache
at every read/write/acknowledgement boundary as well as its retained scope epoch.
A focused actual QueryClient regression proves no old-owner transport starts in
that race. Five built browser cases and the 173-case focused group pass on the
unchanged production source; eight final activation component cases pass.

## V9-047 — Current-session boundary for V9 private read surfaces

2026-10-10. `useV9CurrentAccount` observes the exact original auth-session query in
addition to cached account identity. Each unresolved/revalidated transition gets
a distinct source-read epoch. Home, Needs You and Work withhold cards/actions
until the current session and a new original-owner read resolve. The command
palette preserves same-account entered text while withholding input/results and
requires a new current command read. Actual native permissions and effects remain
independent; a selected command does not become an authorization grant.

My Feedback uses the same boundary and fresh list/detail epochs; its existing
scoped reply component retains an unsaved reply without placing it in the DOM.
Readonly support, maintenance-history and monitor entry points unmount private
reads during session revalidation, requiring a fresh read on return. These changes
do not replace the original V7 authoring boundary or claim that every legacy
surface has been migrated. No account cache schema, domain writer, telemetry or
browser persistent storage is introduced.


## V9-048 — Editable project drafts through the original project owner

2026-10-10. The existing explicit EN/DA task-command grammar also recognizes
create-project commands. It preserves user text without inferring dates, owners,
access, tools or executable steps. A current command choice opens a lazy scoped
project form. General semantic/model drafting stays unqualified.

The original Create Project controller stores only transient scoped defaults.
The form explicitly submits name/description/planned status and a frozen request
UUID through the original account-bound project API. That API already serializes
and fingerprints its Native actor-scoped idempotency receipt; no new backend
writer/store is added. A crossed account epoch cannot present the acknowledgement.
Current original-owner reads qualify the retained receipt and withdraw its name/
link on access loss. Legacy project-dialog callers keep their original form.

Generic HTTP logging for the original project namespace becomes content-free,
including rejected methods, invalid tenant paths and private query strings. The
original Native project audit remains unchanged and purpose-separated. Drafts are
kept in React memory. Bounded per-tab recovery now retains only the original
nonce/company/principal and reconciles through the creator-bound Native audit
receipt and current read authorization (ADR-V9-052). This does not qualify
general semantic authoring, LLM interpretation or live/human release.


Feature admission and original auth/settings fetch state are rechecked at the
project transport/ack boundary, as well as its account scope epoch. A rollback
hides private draft and controls. The original 23-case Native projection group
passes with real PostgreSQL/sandbox prerequisites; five final component cases
pass. Built Native project/browser and integrated aggregate verification remain
pending; no project/source acceptance is inferred from pending checks.

## V9-049 — Chat Tool UI selects current Native views, never supplied authority

2026-10-10. The optional `aw_experience_card` display renderer accepts a strict,
8 KiB-bounded, schema-versioned reference from the fixed 18-name catalog. The
current account/selected company and uncached original Native Experience owner
must independently resolve one fresh matching card ID/domain/resource/version.
Tool output cannot supply titles, links, HTML, component code or effects. Model
prose stays data and is excluded from this renderer and its transcript details.
A streamed update cannot replace an accepted reference. Loading, errors, feature
rechecks, current-session rechecks, access loss and version changes hide the card.

The installed assistant-ui 0.15.16 renderer registration is a display-only
compatibility seam; its supported legacy Tool UI factory is deprecated upstream.
The original custom task transcript and classic assistant-ui thread call the same
Native-bound display component. The factory is loaded only for an actual display
tool message. No tool executor, approval decision, result submission, gateway,
writer, dependency upgrade or evidence store is introduced. Native open actions
navigate to original resource owners; effectful cards refuse display here.

The fixed names describe a bounded registration vocabulary, not qualification
of 18 complete domain forms, provider tool delivery or channel parity. Specialized
Question/Approval/Foundation/Hire/V8 edit and action semantics, the corresponding
Native tool definition, real provider/hosted delivery, full browser/manual state
coverage and Slack/Teams adapters remain open. Existing Native mutations retain
all original gates; this renderer supplies no grant or success certification.


### ADR-V9-050 — task draft unknown outcomes use original Native receipt reads

The existing Native Issue create-key owner is company-scoped and has legacy
seven-day cleanup; it does not promise actor/body-immutable replay. V9 Task draft
therefore sends a single explicit original POST, then reads the original key and
reuses original Issue authorization and analytical privacy guards. Missing keys
remain unconfirmed. Refresh never writes, renews a key or creates a substitute.
No new mutation owner, table, schema or legacy replay semantics are introduced.

The command supplies literal title and captured principal/company only. The
customer reviews title/description. Backlog/medium/null-assignee fields are
explicit requested defaults, not assertions about downstream configured
business automation. No agent, runtime, repository, date or access is inferred.
GET receipts contain only current ID/company/title and use no-store. The original
key-read endpoint and purpose-marked create request suppress private HTTP prose;
ordinary Native Issue diagnostics retain their existing policy.

This qualifies only this source increment after its recorded checks pass.
Cross-reload key recovery, general semantic authoring, full effect reconciliation
and launch/human acceptance remain pending. R0 and all 70 acceptance rows remain
unchanged.


### ADR-V9-051 — installed MCP card display tool retains Native client authority

The original MCP server registers a strict, bounded display-reference tool through
the installed SDK. It performs no API fetch or effect and never supplies card
content or authority. Only the two exact Native names select the existing current-
account renderer. Full schema registration retains company refinement and rejects
unknown UI fields; SDK annotations remain hints. The dated MCP display plan records
actual SDK and assistant-ui checks. General provider/channel delivery, MCP Apps
hosting and full interactive domain forms remain open.


### ADR-V9-052 — reload recovery uses a bounded per-tab locator, not a replay body

Task recovery stores only version/company/principal/original UUID in tab session
storage, before the first Native POST. Sixteen entries and 8KiB are the maximum;
unknown entries are not overwritten or evicted to make room. No title, goal,
result, credential, write payload, tracking event or Source of Truth is stored.
The existing company account observation removes other principals' locators only
on a settled successful identity change/logout. Failed or unresolved identity
checks withhold views and preserve uncertainty. Corrupt inventories become a
content-free refusal; missing storage blocks creation before any Native POST.

Reload restores only the UUID and performs current original-owner GET. The Native
route also checks original board creator and refuses agent-created/other-creator
records even if the viewer can read them separately in Work. A current authorized
receipt clears only its exact locator. Failure/erasure never renews keys, infers
no effect, or repeats creation. The locator ends with the tab; cross-device and
cross-browser unknown recovery still require original-owner work and are open.
This is core functional recovery metadata, not a telemetry policy approval.


### ADR-V9-053 — explicit display language uses the existing translation owner

The V9 global utilities offer the already registered English/Danish translations.
A person explicitly selects the language; no model, browser-language inference,
company edit or authorization change is involved. Only `en` or `da` is stored in
the device's functional display preference. The existing English fallback stays
in place. Unrecognized values and inaccessible storage fall back safely without
rendering or logging the stored bytes. Changing language updates the document's
language for assistive technology. Failed persistence leaves the current session
usable with a translated status; a failed change keeps the prior selection.

The preference is independent of account/company authority, like a local display
choice. It contains no identity, content, credentials or tracking IDs. The picker
is visible only with the progressive shell; existing Native controls and queries
retain their owners. Software checks do not imply human translation review,
screen-reader usability, the full 70-screen state matrix or launch acceptance.


### ADR-V9-053 — Feedback follows current account epochs and original receipts

2026-10-10. The existing dialog hides private fields and references while the
current session/rollout is unresolved, preserves the same mounted draft and
unmounts it on a different settled account. Exact QueryClient fetching checks
fence same-turn writes and disclosures. A late POST acknowledgement cannot prove
current visibility: the dialog reads the original ID with current Native access,
no-store, abort signal and no retained query cache. Read denial leaves a generic
unconfirmed state with an explicit GET-only recovery control.

The bounded EN/DA Share feedback command opens this existing blank dialog. It
requires the original current command catalog and feedback rollout and carries
only a focus-return token; no model, draft text, submission or work is created.

Actual browser qualification passed the Native one-POST/two-read late-ACK path
on the separate source. Its unchecked cleanup exposed a real local company
delete failure. The original company owner now deletes the feedback root, its
FK-owned access/events and company notifications in the same transaction before
removing the company. Sixteen migrated PostgreSQL feedback checks pass, including
rollout rollback and preservation of foreign-company feedback. The browser now
asserts its cleanup response. Forty integrated Native checks across two suites
and both browser account cases pass on source SHA-256
`32c04efda2bd61059128950d1fcb54f3e45791f978e0730f1bd800ce90393b11`;
the complete aggregate remains pending.
Forty-nine checks in five focused files plus token/coverage gates pass on the
integrated source SHA-256
`bca52fe0a321b4833456329076b92068b6fc464e1c87e863672d6ed8b3535171`.
No hosted identity, manual assistive technology or release acceptance is claimed.


### ADR-V9-052 — reload recovery uses a bounded per-tab locator, not a replay body

Task recovery stores only version/company/principal/original UUID in tab session
storage, before the first Native POST. Sixteen entries and 8KiB are the maximum;
unknown entries are not overwritten or evicted to make room. No title, goal,
result, credential, write payload, tracking event or Source of Truth is stored.
The existing company account observation removes other principals' locators only
on a settled successful identity change/logout. Failed or unresolved identity
checks withhold views and preserve uncertainty. Corrupt inventories become a
content-free refusal; missing storage blocks creation before any Native POST.

Reload restores only the UUID and performs current original-owner GET. The Native
route also checks original board creator and refuses agent-created/other-creator
records even if the viewer can read them separately in Work. A current authorized
receipt clears only its exact locator. Failure/erasure never renews keys, infers
no effect, or repeats creation. The locator ends with the tab; cross-device and
cross-browser unknown recovery still require original-owner work and are open.
This is core functional recovery metadata, not a telemetry policy approval.


### ADR-V9-052 — Project reload recovery reads the original creator-bound receipt

2026-10-10. Before its single explicit original POST, the Project draft retains
only the version/company/principal/original UUID in a separate bounded per-tab
locator inventory. React draft text, project name, IDs/results and credentials
are never persisted there. Unknown or corrupt inventory blocks a new write.
Account changes remove other-principal locators through the original Company
context; failed cleanup leaves a content-free refusal marker.

The added read route uses the original `project.created` actor-bound audit key,
then current Native Project authorization and company checks. It does not create
a new receipt owner, write, renew a nonce or restore erased evidence. Reload and
manual reconciliation issue GET only. A missing or erased original key remains
unconfirmed; the UI offers the original Projects view. A current successful read
clears the exact locator and presents only the current Native project name/link.

The first focused qualification passed 46 checks in five files; eight migrated
PostgreSQL cases passed on source SHA-256
`27d5af42be66195cd948835bbe18ceb2054d6efb138866de6212ad5b92b478e2`.
Those cases cover current names, creator/tenant isolation, audit erasure, membership
revocation and rollout rollback without another project or execution. At that first checkpoint, the browser
reload case and aggregate qualification remained pending; these are software checks,
not manual accessibility, hosted login or representative-user release acceptance.

The first browser reload run exposed an incorrectly unscoped Project locator
cleanup during an unresolved cold-boot session. Both Task and Project cleanup
now wait for a settled, successful account answer. Two added provider lifecycle
checks cover pending/failed sessions, pruning only another principal and logout.
The unchanged Project reload browser case then passes, including one POST, two
GETs, current Native name, cleared locator, narrow focus/axe and zero work runs.
Its separate source SHA-256 is
`fd96eb9a91be83e3638302bbee1f1634f7402a8255c5f3ef59c2b0666a2b3715`.
The integrated route sets no-store before refusals and rejects a malformed
company before a source read. Integrated focused checks pass 48 cases in five
files and token gates; 24 migrated PostgreSQL cases in three files pass,
including all original Task deduplication cases and nine Project receipt cases.
Current aggregate qualification remains pending.


### ADR-V9-054 — Fresh authority inside bounded native Source reads

2026-10-10. Native Source reads compile their repeated membership and current
instance-role SQL inside the existing company-scoped callback. Each execution
still reads current rows. Agent and current-run policy evidence is read together
for each Source. No actor, grants, authorization result or policy cache survives
a decision. Strategy populations use that private scope for their original
issue/project decisions and drain bounded concurrent reads before refusal.

Strict server types pass. All 171 original checks in five suites pass together
on the unchanged source fingerprint, including 72 authorization checks, current
human/instance-role and Agent-policy revocation, 10,000-Task populations, full
68,000-outcome capture/replay and forecasting within their original limits.
Earlier incomplete and failed waves remain recorded; no deadline, data-volume,
assertion or runtime prerequisite was relaxed. The complete integrated suite,
hosted performance and release acceptance remain pending.


### ADR-V9-055 — Setup correction and current original output navigation

2026-10-10. Change setup is a strict, versioned original onboarding command
available only in review before a first result. It retains literal customer
answers, clears the selected capability and returns to intent. Existing work,
Foundation drafts, installations and access retain their owners. Current creator
membership, rollout, Native locks, request hash and version fences precede the
change; capability selection later requires fresh Native admission.

Nine actual migrated PostgreSQL activation checks pass on the separate source
SHA-256 `baeea87151098e1f93896a104ba7045596053dfd8f1ca8dd12f340b6fdf9953e`,
including identical concurrent commands, changed-content refusal, stale versions,
rollout rollback, current membership revocation and unchanged work/access counts.
Twenty-one focused checks pass. Early verifier launches failed before tests
because the unprivileged runtime could not read public installed modules or
write its public bundler caches; their logs are retained. No product assertion,
loader or runtime prerequisite was changed. Integrated qualification is pending.

First-result views resolve bounded current Native document keys under the same
Task/company and share-lock those links. They retain exact reviewed revision and
hash references and navigate through the original document-pane hash builder.
The link opens current saved content under Native access; editing remains owned
by that Task and invalidates old verification. Older responses without a key
retain only the original Task link. A disclosure explains the completed Task,
successful run and independent human review without exposing private rationale.
Twenty-one focused checks and token/coverage gates pass for the separate output
change; current combined Native and browser qualification remain pending.
Neither change supplies safe first-task execution or human release acceptance.

The combined source now passes 23 focused checks, shared build and token/coverage
gates, 51 actual migrated PostgreSQL checks across activation/package suites, and
all three built-browser first-result/account/setup-correction cases. Native tests
withdraw links after an output revision changes and block completion without a
new review. Browser cases recover an uncertain correction through a current GET,
preserve the saved goal, verify the document destination and explanation, and
check narrow focus/axe/reflow and absence of extra work. The matching Native and
browser source SHA-256 is `9c1235bb326c0fbe3b0442474c64fc70f843f5ae08b3a923b80d918bf9ab45e3`. Complete integrated workspace
qualification and manual/hosted/usability acceptance remain pending.


### ADR-V9-056 — Authoring follows current account epochs and fresh original reads

2026-10-10. Custom drafts, Hire catalog/setup and saved setups hide private
content while the current account/settings or original draft read is unresolved.
A same-account editor remains mounted; a new source epoch requires fresh Native
reads before it shows the retained unsaved input. Current source fetch states
fence same-turn requests. Late acknowledgements carry only private epoch tags,
so they cannot navigate, expose a receipt or confirm a save across a recheck.
Original immutable request bodies and IDs remain available for their original
Native replay; no key is renewed by uncertainty.

Existing reads and content discard keep their original rollback allowance.
New creates/saves require the current rollout. Native membership, purpose,
permissions, versions and draft owners remain authoritative; no new executor,
permission owner, publication or representative-test claim is introduced.

The built browser found that the global 30-second freshness window prevented a
quick return from rechecking the session. V9 now observes the original session
with zero stale time and no nested mount refetch. The original account helper
keeps its defaults for other callers. An actual-query regression covers both the
freshness window and nested observation. Saved setups use their parent's scope
instead of remounting session/settings readers through their loading view.

Seventy-two checks in eight files, strict UI types and tokens pass, including
original account-client, company-context and feedback regressions. Both actual
built-browser Custom/Hire cases pass on matching source SHA-256
`3d38334ac4ab1e27857ba299598bded9234cb4bd6c819e7eb401c5d9f2e91b69`: hidden fields during pending account/source reads,
retained unsaved input, correct heading focus, narrow axe/reflow and zero draft
writes, Tasks, Agents or runs. Earlier failed browser/focused/type waves remain
recorded. Current integrated workspace/regression and human/hosted acceptance
remain pending.


### ADR-V9-057 — Notification delivery rechecks current recipients and reconciles unknown acceptance

2026-10-10. The existing encrypted transactional-email owner distinguishes an
explicit provider refusal from an unknown acknowledgement. Transport exceptions,
ambiguous server replies, missing acceptance IDs and expired sending leases
require lookup by the same original logical message ID. An empty lookup cannot
admit another send. Bounded retries are read-only; exhaustion quarantines the
payload. A later authenticated exact-recipient receipt can record delivery even
after quarantine/expiry without recreating a message. Provider event lookup
filters the exact logical ID rather than trusting the first returned event.

Before a new company notice, the owner freshly reads current verified recipient
email, active company membership/required role, nonarchived company and personal
delivery preference. Withdrawal suppresses and erases the queued payload. Newly
applicable quiet hours defer the original row without renewing its dedupe key or
consuming transport attempts. A due digest retains its original grouping date.
Company account-safety notices remain immediate, with current recipient authority
still required. Identity lifecycle email retains its original purpose owner.
The existing lease is checked again at the transport boundary; this does not
promise cancellation of an already accepted external effect.

All 28 checks pass across the original 15-case SaaS regression, eleven new actual
migrated PostgreSQL delivery cases and two provider-adapter fixtures on matching
source SHA-256 `2dd0ca3ae62630f3921324830cb8682fb67895ae12fe1130e674c6efdbfa4601`. Native prerequisites prove actual PostgreSQL and artifact sandbox support. The
first launcher failed before tests because its public prerequisite file lacked
group-read access; only that runtime permission was corrected. No original
assertion, loader, budget or test prerequisite changed. Strict current server
types/integration remain pending. Injected transport fixtures do not qualify live
Mailgun delivery, Slack/Teams routing or global human release acceptance.


### ADR-V9-059 — Personal account recovery keeps original Native ownership

2026-10-10. Personal sessions, preferences and deletion receipts require the
successful current original session/capability state and fresh no-store reads.
Same-person mounted forms hide private DOM during checking and retain their
input; an account change unmounts it. Completed cache changes, invalidation,
source fetches and account/source/company epochs fence mutations and late
acknowledgements. Original Native endpoints, expected-user bindings, verified
password, sole-owner and billing requirements remain unchanged.

Account deletion uses a personal scope rather than company scope. Same-turn
submissions coalesce. An unknown request retains its original body in mounted
memory and original UUID across company changes. The actual organization
switcher leaves the route, so a bounded per-tab Core locator also retains only
schema version, principal and original UUID before any transport. Reopening
restores no password/consent and requires fresh explicit confirmation. Refusing
a later retry cannot erase an earlier unknown outcome. Malformed/unavailable
recovery refuses transport; no locator becomes a receipt or an access grant.
Only settled successful original session decisions prune account locators.
There is no new Native deletion/receipt owner, scheduler, bearer recovery link,
credential persistence or automatic irreversible replay.

All 63 checks pass in seven focused files on matching source SHA-256
`feb0299b6e6568fe22463d311170e7e165064b267aa1600efa2e7568a7d67a23`.
This is controlled UI/API/storage software evidence; it creates no actual account
deletion and does not qualify hosted identity or account deletion acceptance.
Current strict UI types, token/coverage gates, built browser and integrated
workspace qualification remain pending. The supporting contract does not change
the 70 launch surfaces, sourceComplete=false or human release evidence.


The complete supporting-contract wave also passes 115 checks in eight files,
full UI token gates and normal V9 coverage, on matching source SHA-256
`cd8d48fbb462459f2eb4483fe5f84ca7bdbda81d68333442517767e0d782821a`. The account page now uses a labelled section under the
original Layout main landmark. Strict UI types and both actual browser cases
remain queued behind uncontested integrated qualification. No launch or human
acceptance status is upgraded.
## ADR-060 — First-task start through the original plan owner

2026-10-10. ONB-09 can select an already prepared original single-worker C1
internal draft. It requires current administrative and Task authority, the same
initiating account/goal, current package activation and intended-purpose
assignment, the installed Native draft controller, one output, two original
save/submit tool actions, no retries/delegation, and a current zero-charge quote.
A subscription or BYO key does not qualify starter funding. The original contract
writer's advisory fence preserves the reviewed goal during the start decision.

The original plan owner exposes its unchanged decision inside an existing
transaction. Onboarding CAS, original plan CAS, durable reference and original
activity records commit before the existing heartbeat queue is invoked. Original
PostgreSQL triggers own run provenance. Request-receipt replay never dispatches
or repeats Stop. A new explicit Continue rechecks current original owners and
uses the existing wakeup key; Stop keeps its original safety outbox and rollback
allowance. No competing Task, purpose, grant, executor or queue is introduced.

Progress comes from original plan/attempt metadata with original source checks.
An independent passing worker review must match the exact recorded plan, Task
and installation hash before recording a result. EN/DA controls do not infer
success from a start, model response or saved draft. Source withdrawal hides
private metadata; original Stop controls retain their separate safety boundary.

Twenty-nine shared/UI checks in four files and token/coverage checks pass on
source SHA-256 `c8fce1ea93d071fa31d689c6b31531b571816db37236a96204d85e8b7484ca1b`.
Subsequent source review added administrative preview admission and the original
contract fence; current Native/type/browser and final integration checks remain
pending. Native refusal/historical-reference fixtures and built browser fixtures
are not no-charge provider or starter-funding qualification. Automatic Task
preparation, generic Free Core first delivery and full first-agent provisioning
remain open; see the dated first-task owner-bridge plan.

## ADR-V9-032 — Described workflow intent and conversational setup proposals

2026-10-13. Described Human workflow intent commits through the Original
workflow creator, with one empty unpublished revision and one body-free Activity
receipt. The company/account/request identity binds the exact first revision;
later edits, rollout withdrawal and retained deletion cannot turn receipt
recovery into another creation. English/Danish labels preserve supplied intent.
The browser retains only a per-tab request locator before the single POST.
Unknown acknowledgement permits Original receipt reads, never automatic replay.
Automatic graph proposals and the remaining guided lifecycle are still open.

App connection intents retain the existing Human-only thread interaction and
provider setup controller. Native issue identity takes precedence over context
aliases. Conversation requests additionally require the current verified user,
Agent/run ownership, generation, Native task authority and live Original source.
The Original interaction writer repeats those checks inside its transaction;
replay and final read checks cannot return a prior withdrawn proposal. Ordinary
task connection requests retain their existing authorization and provider choice.
No connection, credential, installation or grant is created by the proposal.

Agent/Package setup proposals use Original `agent_configuration_drafts` and the
initiating Human's existing creator admission. The proposing Agent retains its
own Native `agents:create` authority and responsible-user intersection; the
Human owner is never a substitution for missing Agent authority or low-trust
refusal. The actual Agent/run is the Activity writer. Creation and its journal
commit atomically, with current admission repeated before returning.

The typed proposal accepts only an idempotency key and optional exact customer
catalog version. Custom setup fields are empty; package defaults come from the
Original qualified catalog pin. Conversation names, outcomes, instructions,
knowledge, credentials, runtime selectors and permissions are refused. There is
no private conversation copy to erase from independently retained configuration
or a later published runtime. A Human's subsequent edits remain that Native
owner's independently entered records. Copying conversational prose in a future
extension requires complete Original source/erasure/restore lineage first.

Setup receipts describe historical creation effects, not present Agent status.
The current conversation projection follows the actual Native Activity/run and
draft owners, exposes only ID/kind/version/state/link, checks current sources
again, and excludes earlier generations. Source withdrawal hides that projection
without manufacturing a deletion of independently entered Human configuration.
Preparation, package installation, runtime qualification, approval, publication
and activation remain separate explicit Original decisions. This bounded setup
proposal does not complete the full Custom Agent or natural-language lifecycle.

Verification and whole-scope work remain tracked in the dated continuation plan.
No inherited host/provider qualification or release acceptance is upgraded here.

## ADR-V9-033 — Exact plan safety controls survive rollout withdrawal

2026-10-13. Pause/Stop uses the Original plan CAS decision, current verified
company membership and Native administrative/root-task control authority. A
separate exact-plan entry remains mounted when progressive shell, orchestration
and supervision rollout are disabled. Its minimal read omits withdrawn Source
payloads; retained control authority does not restore private instructions or
execution evidence. Navigation and language remain available on that entry.

The customer explicitly reviews the current plan version, a reason and the fact
that completed effects remain. The Original decision, durable supervision stop
outbox and body-free request receipt commit atomically. Current authority is
rechecked before returning; late withdrawal rolls back all three. Reuse of a
request identity with different content is refused. Receipt replay cannot
dispatch another Stop. Browser persistence contains only a per-tab account,
company, plan and request locator retained before the single POST. Unknown
acknowledgement permits Original GET recovery only, including after reload.

The immutable receipt qualifies admission only. A fresh current Native control
read is required before displaying it or clearing its locator. Physical adapter
or provider termination and reversal of completed effects are never inferred.
The existing stop owner now suppresses ordinary immediate Task recovery when
cancelling a durably fenced plan, preventing Stop from promoting that Task into
a fresh run. The existing heartbeat cancellation option owns this behavior;
there is no replacement queue or side-channel cancellation engine.

Focused migrated PostgreSQL coverage includes concurrent replay, changed-command
refusal, stale-version and member refusal, rollout withdrawal, late-role rollback
and actual Original outbox delivery to a queued run without immediate recovery.
That is software evidence, not live process/provider/channel qualification.
Client/UI coverage preserves private account fences, unknown receipt recovery,
corrupt-storage refusal, English/Danish consequences and React effect remount
behavior. Built browser and final integrated qualification remain tracked in the
dated continuation plan; this decision does not complete takeover, effective
delegation inspection or all kill/revocation propagation requirements.

## ADR-V9-034 — Exact workflow request history survives page and rollout changes

2026-10-13. Test, Publication, Run and Status-change commands retain a bounded
content-free per-tab locator before POST. Current account, company and reviewed
Source remain required for the write and acknowledgement. A late or foreign
reply cannot discard its locator. Explicit known Native pre-effect refusals may
release only their exact tuple; conflict with an already recorded request is
not an absence proof. Existing explicit same-command in-memory retry retains
the Original idempotency owner, never a fresh request identity.

A separate always-mounted GET reads the exact Original own-request Activity
journal and its retained revision/run Sources. The Original current permissions
and actual Native role remain authoritative; request-snapshot instance-admin
flags cannot replace current role admission. Test/publication reuse their
existing receipt validators; Run/status history remains in the Original
workflow owner. All four paths omit customer inputs, prompts, results and
credentials. They create no run, revision, audit, model call or new decision.
Rollout closure affects new work without replaying or hiding an admitted
request's independent history. Source withdrawal still refuses private history.

The workflow entry retains only recovery when it has an unconfirmed request
and the old experimental gate would redirect away. Other work remains behind
that Original gate. The exact receipt entry retains navigation/language after
rollout closure. Current-source confirmation clears only its matched locator;
missing/ambiguous/refused reads stay unconfirmed. Immutable receipts describe
historical admission/publication/status, not current state, completed execution,
physical Stop or independent result verification.

Focused PostgreSQL, strict API, current-account/Source, storage and UI cases are
recorded in the dated continuation plan. The built browser exercises an actual
Native C0 test/journal and exact recovery GET, with its UI account/review frame
explicitly controlled as a software fixture. No real authenticated Human,
host/provider, representative business or release qualification is inferred.
Full retained-run safety, external outcome reconciliation/compensation and the
remaining guided authoring lifecycle remain open.
