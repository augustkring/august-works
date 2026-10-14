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

## ADR-V9-035 — Retained workflow run safety is separate from private payload reads

2026-10-13. An exact run-control entry remains mounted when workflow/builder/
progressive rollout closes. Its read selects only Native retained IDs, status,
purpose and update stamp. The Original workflow read/run permissions and actual
write-role fence still apply. Opaque control additionally requires the responsible
Human or the existing Native company administrative owner; a generic runtime
action decision on a company object is not an administration attestation.
Request-snapshot admin flags cannot replace current Native role admission.

The explicit Stop freezes workflow/revision/run/update identity and acknowledgement
that completed effects remain. A private internal safety context admits it through
the unchanged Original cancellation engine, with no replacement queue, lease or
cleanup driver. Rollout closure and private payload withdrawal cannot restore
inputs/results or create new run authority. The Original cancellation-only
reconciler already runs with workflow rollout disabled. Historical receipt replay
does not initiate another safety continuation; the Original recovery owner retains
pending physical cancellation. Receipt admission never proves all child/provider
work stopped or reverses completed effects.

Stop and its Original journal commit in the same transaction; retained authority
is repeated after the journal so late role withdrawal rolls back both. The browser
retains only a bounded per-tab original request locator before one POST. In-flight
submission, lost acknowledgement and confirmed history are distinct states. A
fresh current scoped control read is required before confirming/clearing a receipt;
unknown/missing/foreign results remain unconfirmed and permit exact GET recovery.
Navigation/language remain available on that safety entry after rollout closure.

Native queued/waiting cancellation, scoped non-manager/viewer denial, actual copied
payload erasure and late-role rollback are software fixtures. Immutable publication
provenance and Native permission checks were preserved when correcting fixture
setup. Temporary diagnostics used only in the disposable browser fixture were
removed. The browser failure came from premature fixture cleanup before its POST
finished; the corrected test waits for the actual Native response. Private run
history also checks current account/Source before and after reads and preserves
utility focus. Exact-source validation remains in the continuation plan; live
process/provider, manual assistive technology and Human qualification stay open.

## ADR-V9-036 — Native workflow authoring retains its private conversation sources

2026-10-13. The Original workflow owner retains actual private authoring run IDs
on the Native workflow itself. Discarding a revision, editing as a Human or
publishing cannot remove those sources. Native revision creation captures the
company/Agent/run/conversation relationship at the database boundary; existing
private revisions are backfilled without truncation. New captures are bounded
to 32 sources and readers refuse incomplete/excessive provenance. Source IDs
remain internal and supply no current read, runtime, approval or sharing grant.

Private reads require the current verified source-owning Human, current Native
workflow/issue/Agent reading authority and Original analytical source admission.
Internal Agent authors resolve their active run's actual responsible Human rather
than trusting a supplied claim. Missing, withdrawn, foreign, unverified or cyclic
sources remain unavailable. Source review repeats current account/run/permission
checks and uses bounded recursion. SQL materializes actual descendant relationships
before evaluating their copy owner; boolean evaluation order is not provenance.
Resource selection, list/detail/revision reads, package component selection and
Original execution reuse the same source owner. Cross-user sharing requires an
explicit Original source-sharing contract, which is not inferred from membership.

The Original memory privacy transaction admits cancellation for affected live
runs through the existing workflow cancellation owner, then erases private root,
revision, run, step, wait, review, activity and actual descendant task payloads.
Immutable publication is changed only to the existing empty/unavailable erasure
shape. Permanent content-free markers survive deletion and fence late/restore
writers. Wait cleanup retains only the Original exact-wait parent-cancellation
marker; private reasons/results cannot return. Nonterminal runs remain cancelling
until the Original cancellation-only reconciler completes software cleanup, even
with workflow rollout closed. Its heartbeat cancellation suppresses immediate
task recovery so stopping a queued child cannot promote a replacement run.

PostgreSQL cases exercise actual authoring, Human revision/publication, real
Native task creation, erasure/restore, source/account/permission denial and the
actual Native queued heartbeat cancellation service. Queue admission is controlled
by the software fixture; this does not qualify host/provider process termination,
external-effect compensation, complete sharing semantics or representative Human
usability. Exact checkpoint results remain in the dated continuation plan.

## ADR-V9-037 — Private child output retains its copy owner on actual ancestor runs

2026-10-14. A public parent workflow can hold a private child's result. The Native
run retains private workflow source IDs captured through actual child creation
and propagated through the existing parent chain. Capture is atomic, scoped to
the company, bounded to 32 private roots and sixteen ancestors; existing relations
are backfilled without truncation. Child removal cannot drop retained sources.
These IDs are internal and omitted from public run DTOs; they grant no access.

Run, task and heartbeat readers follow the Original copy owner and current
source-owning authority. Inspection shares one bounded deadline. Subworkflow
result recovery keeps the stored execution principal and repeats current source
admission. Native package component resolution also reads the exact Original
workflow revision through current source authority before accepting its pin.

The existing privacy transaction admits cancellation of affected live ancestors
through the Original owner and erases copied run/step/wait/review/activity and
downstream task/heartbeat payloads. Public ancestor configurations remain separate.
Permanent run markers and monotonic provenance fence late results and restored
payloads, even when a restore omits its source list. Retained control is a separate
purpose from private result reading.

PostgreSQL cases exercise actual private child execution, two public ancestors,
foreign-reader denial, child deletion, copied-result erasure, late writes and
restored Native rows. Checkpoint results and broader artifact/package/knowledge
copy closure remain in the continuation plan. There is no inference of host or
provider termination, external compensation or representative Human acceptance.

## ADR-V9-038 — Guided selected-step edits compose the Original draft and receipt owners

2026-10-14. A guided step editor changes the selected Native draft's name and
fully supported wait/approval configuration. It preserves all other nodes,
branches, inputs, retries and failure policy. Unsupported configuration stays
in the existing Advanced editor, with the selected actual node retained in its
deep link. The active revision remains immutable and test/publication/execution
keep their separate Original admission. Full graph/trigger/condition/tool/access
editing and richer test qualification remain open.

Verified current account, current Native read/edit grants, write role, rollout
and private source ownership remain necessary. Save freezes workflow/draft/
publication/update/node/type identity. Original updateDraft and a body-free
own-request Activity receipt commit together, with late authority checks. Exact
replay returns its receipt after rollout withdrawal without another revision;
changed content or a stale source is refused. The read-only request history
adds draft_edit to the existing Original receipt union.

The browser stores only the bounded scoped request locator before one POST.
Lost/late/foreign responses cannot clear it or permit a replacement save after
reload. Account/source changes hide prior values; fresh current reads distinguish
saved historical versions from current state. Draft prose stays in component
memory and its Native revision. Whole workflow HTTP logging is private, and
background issue diagnostics also mask editor referer paths with customer node
IDs. This is local log minimization, not a new telemetry event or contract.

Native concurrent replay, immutable active separation, stale/type/foreign/viewer
denial and late-verification rollback are tested. Built recovery exercises the
actual migrated Native HTTP/revision/journal owners via a controlled verified
actor bridge and controlled UI session, with one POST, rollout-closed receipt
GET, Danish 390px layout and zero automated main-region axe violations. These
software fixtures do not qualify real authentication, Human usability, manual
assistive technology or hosted provider/process behavior.

## ADR-V9-039 — Guided comparisons preserve Original condition semantics

2026-10-14. The selected-step editor now supports a fully representable Native
condition: one current trigger/variable/step field path compared to an explicit
text, finite number, boolean or null literal. Customer controls show data source,
field levels, operator and typed value, without requiring expression syntax.
The server converts the closed command into the Original condition language
using JSON string keys/literals. Original parsing/evaluation and updateDraft
validation remain authoritative; no alternate evaluator is added.

Review uses the Original parsed operands and exact round-trip equality. Extra
configuration, reference-to-reference comparisons, boolean-only expressions,
unrepresentable field names and invalid ordering remain Advanced. Literal
whitespace is preserved. An unchanged comparison keeps its exact Native config,
so merely reviewing/saving it does not manufacture a revision. All branches,
other nodes, immutable active revision, retries and governance are retained.

Visible fields have specific inline errors and a linked, focused summary before
a request locator or POST is created. Existing actor/source/CAS/receipt/lost-ack
controls apply unchanged. Native tests cover both Original evaluated outcomes,
quoted injection-shaped names, exact literals, immutable branch/revision
separation, no-op save, replay and body-free journals. Built wait and condition
recovery fixtures pass; they do not qualify real Human or hosted execution.

Full trigger/tool/access editing, flow composition, natural-language graph
proposals and all remaining V9 qualification stay open in the dated plan.

## ADR-V9-040 — Explicit bounded flow composition uses Native revisions

2026-10-14. An empty described draft can now receive an explicit manual start,
then waits or Human approval checkpoints through a guided customer page. A
complete single-path Native graph can append those steps or remove its exact
last non-trigger node. Conditional/parallel, cyclic, duplicate, dangling and
oversized shapes keep Advanced, without flattening/truncating the graph.
Existing nodes/configuration, graph data/settings and active revision remain
Native-owned. A checkpoint does not grant authority to a subsequent action.

The bounded current review and closed command require actual verified account,
Native read/edit grants, write role, rollout and current private authoring
sources. Workflow/draft/publication/update/tail identity is frozen. Original
updateDraft and its body-free own-request Activity receipt commit together,
with final source/account checks. No workflow, graph, actor, tool or runtime
shadow store is introduced. Exact replay survives rollout closure, but Source
erasure can make its Original journal history unavailable without proving that
no prior write occurred. Native current-source denial still blocks recreation.

The existing receipt union adds draft_build. Content-free locators are retained
before the single POST; both draft_build and draft_edit block any further draft
command while either save is unknown. A same frozen explicit request can still
replay its Native idempotency key. Foreign/late responses cannot clear it.
Current source rechecks suppress private DOM; changed draft input requires an
explicit fresh review. Per-step editing and original test/publication/run
controls remain their owners. Native workflow HTTP privacy and background
referer minimization cover the new page.

Migrated Native tests exercise concurrent creation, immutable active separation,
wait/approval addition, exact tail removal, stale/foreign/viewer denial, rollback
and private Source erasure. Built actor/session fixtures exercise explicit
composition and lost acknowledgement, Danish mobile form accessibility and
rollout-closed original receipt recovery. These are software evidence, not
real Human, authentication, provider or physical execution qualification.
Automatic intent-to-graph proposals, actor/tool/access selection, arbitrary
branch composition, estimates and the remaining V3 implementation stay open.

The initial manual start requires an explicitly chosen 1–60 second Native
stop limit. It is not silently defaulted or described as a completion estimate.
The closed customer C0 profile also admits literal Native waits up to 60 seconds
only when their conservative summed delay is strictly below that limit. Extra
fields, dynamic durations, delayed retries, child work, models, tools, network,
Optimizer transforms and privileged checkpoints remain excluded. Original
timer execution/recovery is used, never a simulation or alternate scheduler.
A migrated verified-account case observes an actual one-second wait, Original
recovery to succeeded, the Native delay_elapsed output and an unchanged
unpublished draft. The Original deadline remains the stop criterion.

## ADR-V9-041 — Representative internal test data stays Native-owned

2026-10-14. The closed customer C0 test command optionally supplies up to 20
explicit synthetic field paths and typed literals, at most eight levels and
8 KiB. Overlapping/duplicate paths, malformed Unicode and non-finite values
are refused. Construction uses own JSON properties: prototype-looking names
are data, not code or authority. No graph, approval, actor, model, grant or
side-effect profile is widened by these fields.

Original enqueue verifies that the actual trigger payload exactly equals the
validated command’s data. The actual Native run/steps retain that input. The
Activity receipt stores only the exact command hash and body-free command
metadata; it omits raw synthetic values. New replay compares the hash; old
retained command-only journals keep their exact backward-compatible semantics.
The optional field has no default which would mutate old command hashes.

The dialog holds inputs only in memory, requires acknowledgement after edits,
validates and focuses linked errors before any locator/POST, and freezes the
original full command for an explicit lost-ack retry. Reload recovers Original
history with no new command; browser storage retains scoped identity only.
The dialog scrolls inside the viewport and newly added fields receive focus.
Native source/account/role/current-revision fences remain authoritative.

Native tests exercise both actual conditional paths with chosen data, unchanged
unpublished revision, changed-input request refusal and journals without raw
values. Built mobile testing exercises actual Native admission/execution, input
selection, deliberate lost response and single-command reload recovery. These
software fixtures do not qualify real Human fitness or hosted/provider behavior.
Broader sandbox/live effects and production outcome verification remain open.

## ADR-42 — Current workflow step semantics and selected Agent reads (2026-10-14)

The default ordered flow exposes closed Original registry declarations for the
executor kind, input source, approval checkpoint, step-access requirement,
maximum attempts and duplicate-effect strategy. It shows only a valid literal
Native wait duration from configuration. Objectives, arguments, recipients,
credentials, raw schemas and arbitrary configuration stay out of derived flow
payloads. No declaration is an effective grant or a passed test.

The current review enriches selected Agent steps through a separate bounded
Native agent:read operation. Actual verified account, active company membership,
current grants, Original workflow/revision/learned/private Source owners and
selected Agent rows are rechecked under privacy locks. Reader identity is never
borrowed from local fixtures, copied administrator flags or a run principal.
Missing and unreadable assignments remain unavailable. No model, transport,
catalog refresh, installation, execution session or mutation is performed.

The complete Native detail binding is capped at 256 KiB and includes JSON
normalized timestamps. A generic Native canonical hash treats Date objects as
ordinary objects, so this read normalizes Dates locally without changing other
domains' retained command hashes. Before returning the review the route reads
the Original Source and current detail again; changed material is refused.
Agent/tool/connection updates withdraw private client data immediately, as do
existing permission, membership, privacy and Source events.

This supplies structural disclosure and current Agent visibility, not the full
connection permission-preview contract, exact configured input presentation,
effective actor policy, external test qualification or Human fitness. Those
whole-brief requirements remain open.

## ADR-43 — Current closed inputs and per-step connection access (2026-10-14)

Current ordered review may show a closed Native condition's exact field levels,
operator and typed literal, or a Human checkpoint's exact summary/consequence.
It reuses the Original condition parser; there is no evaluator, model or guessed
expression. Waits stay literal. Unknown/complex input remains Advanced. Guided
editing uses the same complete-shape guard; padding, extra fields or a supplied
kind cannot silently transform approval material. Shared response schemas bind
input/assignment/tool metadata to their declared executor/input kind.

Only the current Source-authorized review receives these bodies. Conversation
and historical flow projection remains body-free. All non-local current review
readers require an actual verified account and active company membership, even
when the graph has no selected Agent or connector. Native local-operator
compatibility supplies no verified Human or named selected-actor proof.

Connector steps use bounded company-scoped Native connection/catalog SELECTs,
not listCatalog: passive review must not refresh a provider or open transport.
The Original inventory draft-visibility rule is extracted into one shared Native
helper; another creator's draft remains hidden unless actual manager permission
allows it. Reader-supplied administrator flags do not confer that permission.
Visible exact connection/tool names and the Original permission route are shown
at the step. Disabled, missing/hidden, catalog drift, missing current company
tools:use and execution-check-required states are distinct. Having tools:use
never establishes the future execution principal's exact connection/resource/
approval grant. Current reader, Source, binding and metadata checks repeat under
privacy locks; no invocation, install, grant or run is created.

The full inline resource-specific permission decision, complex task/tool/artifact
input presentation, effective Agent/runtime policy and external test qualification
remain open; this checkpoint does not close the full V9 acceptance contract.

## ADR-44 — Private routine ownership includes derived schedule metadata (2026-10-14)

The Original conversation-routine Source owner must bind the actual current
responsible verified Human and its Agent×Human conversation even when the run
has no analytical context pins. Company membership and a claimed administrator
flag are not that private reader. Current Agent JWT reads resolve the actual
active responsible run; Agent keys and caller-supplied Human hints cannot borrow
it. Native company/Agent/issue access, Source erasure and account checks repeat.
Trusted scheduler composition remains explicit and is excluded from passive
private schedule reads, which require a real caller.

A next-run time is derived private metadata. nextWorkflowSchedule checks the
selected routine's Original Source, and workflow operations supply their current
Native actor. Refused private metadata produces unavailable status, never a false
assertion that no enabled schedule exists. Routine collections filter private
unavailable owners before enriching their triggers/runs; public rows remain
visible. Routine changes withdraw cached workflow review and operation data.
No schedule, trigger, dispatch, grant, queue or Source store is created by this
read composition. Broader copied workflow/routine artifact provenance and full
schedule authoring remain separate open requirements.

## ADR-45 — Explicit bounded conditional draft composition (2026-10-14)

The customer can append a closed exact comparison and two named literal waiting
branches to a complete current single path. Original updateDraft owns all three
new nodes and true/false edges, with request-derived IDs and existing exact
workflow/revision/publication/update/tail CAS. No second graph or evaluator is
created. The Original condition renderer/parser, timer, executor and test owners
retain their meaning and admission rules; this command grants no execution.

All three names, both delays, exact reference/operator and typed literal are
chosen explicitly. Earlier-step input uses current Native step identity selected
by readable name, not a required raw-ID field; the server refuses references
outside the exact earlier path. Three added nodes must fit the 100-step bound.
Names/material are ephemeral; browser storage and Native Activity retain only
original scoped request identity/body-free receipt and command hash.

A branched result is never flattened into the linear composer. Its steps remain
editable from current review; branch extension and more complex graph structure
use Advanced. The customer reviews/tests both outcomes before publication, with
Original C0 test limits unchanged. Full natural-language proposal, arbitrary
actor/tool/trigger/branch design and hosted/Human qualification remain open.

## ADR-46 — Edit a selected Agent task brief through Original draft admission

Date: 2026-10-14. Status: implemented; full-V9 acceptance remains open.

The default step editor now exposes a closed Agent task objective and its actual
completion setting. Only a bounded, exact Original agent.task configuration with
no complex output schema is representable. Unknown fields, invalid assignment
IDs, transformed historical text and complex output requirements remain Advanced.
The selected Agent ID is not copied into the input-review DTO or accepted by the
objective-edit command. Current private workflow/account/read/edit ownership,
revision/update/type CAS and Original updateDraft remain authoritative. The
objective edit preserves configuration defaults, explicit false completion,
null/omitted output requirements, input schema, retry policy and graph edges.
The Original Activity receipt retains a digest and identities, never task prose.

Only current workflow review receives private task material. Historical and
conversation flow projections retain closed structural semantics without copying
objectives. New task work, grants, publication, model dispatch and execution are
separate Native operations. The existing selected-step authority fence withdraws
material on Agent/account/Source changes. This adds ordinary task-brief editing;
full Agent selection, model proposals and C2/C3 qualified tests remain open.

## ADR-47 — Authorize catalog resources before ranking and disclosure

Date: 2026-10-14. Status: implemented; broader copy provenance remains open.

The workflow capability HTTP reader previously invoked the trusted inventory
resolver without its resource-authorization callback. Workflow read access could
therefore reveal another creator's draft connection metadata. The runtime catalog
also copied published workflow names from rows without the private workflow owner.

Catalog disclosure now composes the Original Agent resource read, connection
creator/manager visibility and Automation Artifact current-version/Source read
before ranking. Actual Native company/membership/grants and final admission are
checked; copied administrator/represented-user hints cannot borrow draft visibility.
Current Agent/catalog identity and version metadata are re-bound under row locks.
The HTTP catalog uses one Native analytical/memory privacy transaction and the
existing four-request/1500ms admission budget, returns no-store and fails unavailable
on deadline/lock pressure. The runtime catalog retains its Original execution
permission/tool-policy checks and reads each published workflow through getDetail
with its actual actor, under Native privacy locks. Inventory is never an execution
or approval grant and performs no provider discovery, refresh, invocation or write.

Canonical Source owners currently implemented remain authoritative. This does not
claim complete workflow-to-Artifact/package/knowledge copy provenance, host
qualification or complete workflow Agent/tool selection in the default editor.

## ADR-48 — Bind an explicit Agent choice to the current Native draft

Date: 2026-10-14. Status: implemented for supported selected task steps.

A supported selected Agent task now includes up to 32 actual readable Native
choices and its separately authorized saved Agent name. Keeping the saved Agent
is the default; an explicit UUID selects a new target in the draft command. No
raw-ID text entry is required. Names/choices remain in the current private read
and component memory. Duplicate IDs or a choice DTO attached to another node
kind are refused by the shared contract. Other Agents remain with Advanced.

The Original revision owner repeats actual resource admission and locks the
same-company Agent row before accepting an explicit target: current Agent read,
active/idle/running status and a task-compatible adapter are necessary. A foreign,
missing, paused or external-adapter target cannot be admitted through the task
selector, including with copied administrator context. This is draft composition,
not Task assignment, a grant, runtime qualification or permission to execute.
All Native execution/Source/approval/budget checks remain necessary later.

Objective-only edits retain the previous ADR-46 behavior. Explicit changes retain
input schema, completion defaults, output contract, retries, branches and published
revision. The digest/receipt contains no Agent name or task material. Real host
qualification, full inline resource-policy preview and complete C2/C3 test modes
remain open.

## ADR-49 — Withdraw derived workflow views on Original Source activity

Date: 2026-10-14. Status: implemented for workflow customer views.

The private workflow owner can depend on an Agent×Human conversation issue. Its
ordinary issue.updated event previously did not invalidate the draft-step editor,
flow composer or review. Three client regressions reproduce retained fields/names
while a changed Original Source should be rechecked. Server authorization was
not bypassed; this was a client withholding gap.

A shared Native event predicate now includes conversation/issue, account/grant,
Agent/tool, memory/learning/document/artifact and project/team Source families.
Company scoping, immediate read-epoch withdrawal, cache cancellation and existing
late-response fences are retained across index, Describe, draft, review, receipt
and run surfaces. Exact own-save Activity exceptions stay narrowly scoped.
Publication also rechecks on analytical access loss, retaining its existing broad
activity invalidation. No new event, telemetry, permission, Source-ID projection
or automatic write is introduced. Every refreshed read still uses the Original
server owner; event reception itself is not a grant or complete revocation proof.

## ADR-50 — Keep an Artifact's actual origin workflow as a private copy owner

Date: 2026-10-14. Status: implemented; current integration/types verification.

A Native regression reproduces another same-company Human reading a private
workflow-derived Artifact's name, schema and code despite refusal by the workflow
owner. The existing originWorkflowId FK now retains its actual Source authority
through reads, lists, versions, gates, lifecycle and canonical asset consumers.
This reuses Original workflow authoring Sources and actual reader identity;
company membership, an Artifact status or administrator hint supplies no grant.
Origin references cannot be removed/retargeted. Actual optimizer relationships
backfill missing origin pointers. No second provenance store is introduced.

Migration 0495 extends the Original current/erased-asset and payload guards.
The existing workflow Source eraser now clears affected Artifact metadata and all
versions, optimizer reports/observations, and local activity payloads. Native
workspace/copy outboxes retain exact version identities for downstream cleanup.
Permanent deletion markers and before-insert parent checks keep raw restoration
from rehydrating code/schema. Original version digests remain provenance, not
verification of erased content. The canonical Source helper also protects direct
internal asset consumers before code can be used. Private mutations repeat the
actual Source check after journal insertion inside their Native transaction.

The regression verifies creator/foreign-reader separation, canonical consumer
refusal, unchanged Source pointer, two-version erasure, original digest retention,
update/new-version restoration scrubbing and body-free workspace cleanup queue.
A database-triggered late account withdrawal rolls back both version and journal.
It does not claim physical filesystem cleanup until the Native worker completes.
Additional copied run-result provenance, direct conversation-derived artifacts
without an origin workflow, packages/knowledge and host/Human qualification remain
separate whole-brief work; this is the actual persisted origin relationship.

## ADR-51 — Compose an Agent task through the ordinary Native flow builder

Date: 2026-10-14. Status: implemented; whole-V9 qualification remains open.

The default linear composer can now append one explicitly named Agent task with
a current named Agent choice and explicit task brief. The selected-step editor
and composer reuse the same Native read/status/adapter checks and bounded choice
projection. Source/account ownership, exact revision/publication/update/tail CAS,
Original updateDraft and body-free own-request receipt remain authoritative.
The operation appends one registered agent.task and edge, waits for completion
and keeps the active revision and all prior nodes/settings. It creates no Task,
run, heartbeat, grant, model dispatch or publication. Source lists are bounded,
not claims that no other Agent exists; Advanced retains other composition.

The default internal wait/condition test still refuses Agent tasks through its
Original qualified-mode gate. Customer copy exposes that limitation before save.
Private form material stays in memory; unknown response recovery keeps only the
exact request locator and reads its Original receipt through rollout closure.
Both form variants own a same-row back/primary footer. Full model-generated
proposals, connected-tool composition, inline policy preview, C2/C3 tests and
managed host/Human qualification remain open.


## ADR-52 — Guided connected operations bind the current effective input definition

The linear draft composer offers only current visible stored Native tool catalog
entries with enabled active connections and a wholly representable scalar object
schema. It does not discover, refresh, invoke, grant access or qualify a connection.
Existing visibility filters execute before bounded ranking. Names, field metadata
and explicit input values remain behind current workflow/connection Sources; only
the existing body-free own-request locator is retained for recovery.

The command binds entry, connection, catalog version/schema and a SHA-256 of the
Original effective projected input schema. Required fields and complete scalar
constraints are checked by shared input validation and Original schema validation.
The hash is retained on connector.action and rechecked by the Original publication
registry and connector authority before invocation, including drift without a
catalog hash update. Legacy nodes without the optional pin retain existing behavior.
The Original projection is dynamically imported at validation time to avoid an
initialization cycle through tool-access and the executor's static node registry.

The metadata access indicator is not a grant, effective resource policy preview,
provider health qualification or permission to bypass approval. Complex schemas,
credential-like fields, full tool-step editing, meaningful connected-action tests,
resource-policy preview and automatic natural-language graph proposals remain open.


## ADR-53 — Saved tool inputs are current Source-bound review material

The Original workflow step-context read now supplies closed scalar input review
only for a current visible connection, active matching catalog entry and the
retained effective input-schema pin. It reuses the Native account, company,
workflow Source, connection visibility, row locks, final checks and deadline.
Arbitrary config, connection credentials, defaults, mappings and complex or
unpinned legacy configurations are never copied to this projection. Current
account tools:use is shown separately and is not required to pretend execution
is authorized. Input-definition drift also appears as catalog_changed.

The complete private input projection is bounded to 64 KiB and refuses overload
rather than silently truncating. The Original endpoint attaches it only to the
matching current revision/node; historical conversation projections stay body-free.
The UI preserves distinctions between false, empty text and omitted optional
fields and withdraws the fields on existing Source events. Input editing remains
with Advanced until the selected-step editor has equivalent current binding.


## ADR-54 — Selected tool input edits reuse the current Source read and Original draft owner

The selected-step review requests exactly one current revision/node from the
Original context owner while retaining full workflow/account/Source binding.
Its current scalar fields, values, input hash and Native connection access DTO
are required together. The full workflow review retains its complete 64 KiB
bound; asking explicitly for one step does not silently truncate that whole view.
Original schema validation material remains internal and is never serialized.

A strict connected_tool command carries only the retained input-definition hash
and explicit primitive values. It cannot select a new connection/tool, add a
mapping or grant, change Native defaults, run a test or publish. The current read
owner and Original schema validator check the proposed input; unknown fields are
refused even when the upstream schema permits arbitrary extra fields. Original
updateDraft and its body-free own-request journal own revision/CAS/recovery.

Composition and editing share one accessible scalar field component. The editor
binds retained form state to configuration kind and current definition hash as
well as revision/node. Shared response validation refuses private connected input
material without the matching visible current connection/actor/input semantics.
Complex schemas, legacy unpinned inputs, definition drift and input mappings stay
Advanced. Connection changes, full effective resource/approval-policy preview,
connected-action tests and automatic graph proposals remain separate open work.

The selected-step HTTP review passes its existing admission signal/remaining
budget into the inner Source read. It consumes one global request slot; Native
authority, cancellation/deadline and the four-request bound are unchanged. A
baseline of four actual concurrent reads rejects one because the inner owner
previously counted the same request again. All four pass after sharing admission.
The same-row mobile footer allows long translated labels to wrap within their
respective columns. Excluding an optional field also removes its obsolete error.

## ADR-55 — Optimizer reads use actual workflow-run Source identity

An Optimizer workflow run is not a heartbeat/Agent run. Candidate/replay input
reads now compose the Original current revision and complete copied Workflow
payload owners using workflowRunId. Trace normalization and correction reads/
mutations also require those Sources, including the actual persisted private
child references after child-run removal. A stored initiating principal and a
claimed administrator do not supply current Source access.

Current actor identity flows from the Original route to suggestions/normalization
and correction reads. Complete Source admission precedes counts, shapes, ranking,
compilation and stored evaluation reuse. Suggestion materialization and trace/
review operations keep Original analytical-then-memory privacy transaction order;
final reads and mutating journal paths repeat Source checks. No new Source store,
permission engine, graph/runtime or qualification flag is introduced.

The existing Native run/review copy erasure and restore guards remain authoritative.
Broader Artifact copies of private descendant results still need durable provenance
capture on their own canonical owner; guarding current replay reads alone does not
complete that closure. No host/provider or representative Human qualification is
inferred from these software regressions.


## ADR-56 — Native copy ownership cannot be retargeted during restore

A real PostgreSQL baseline moves an erased private step to an unrelated public
execution without error. Native run Sources are attached to their actual owner;
changing that FK would lose the boundary. Custom generated migration 0496 keeps
company/identity and saved workflow, revision, execution, step, wait, review and
Artifact-version parent ownership stable. New children verify an actual scoped
parent; existing same-owner updates avoid new parent locks and preserve lease/
cleanup ordering. Existing Source erasure/payload guards still run after this
identity guard. Parent-run ancestry fields that use legitimate ON DELETE SET
NULL behavior are not made immutable by this guard.

The actual restore regression refuses step/wait/review/run/revision and Artifact
version reparenting, while a clean public execution remains free of private
payload. No graph/runtime, permission, Source-completeness or qualification store
is introduced. This closes the demonstrated owner-retargeting path; it does not
attest every backup/host restore or complete broader copied Artifact provenance.

## ADR-57 — Replay Artifacts retain copied descendant Workflow owners

An actual Original compiler baseline exposes private replay values through an
Artifact whose direct origin is a public parent workflow. The parent run retains
the private child owner, but origin_workflow_id alone does not describe that copy.
The canonical Artifact now retains the bounded union of actual observation/replay
run workflow owners. Native database capture derives it from persisted same-company
relationships; copied IDs grant no read. Root references cannot be removed or
retargeted, and Optimizer evaluation ownership cannot be moved to another artifact.

The Original Artifact service and canonical learned-asset consumer recheck direct
and retained workflow Sources using the current actor, under the existing bounded
Source-review owner. Internal references are excluded from the public Artifact
DTO. Compiler/system writes retain their system principal and pass the actual
requester's current read context, rather than borrowing a saved initiating actor.

Generated 0497 adds nullable provenance and reconstructs exact historical Native
relationships. null means that required history could not be reconstructed: reads,
qualification and new version copies are unavailable. Retained unknown bodies are
not falsely described as erased, and the unknown state cannot become an invented
empty source list. Fresh incomplete observation/replay references fail closed.
Generated 0498 indexes retained source lookups. Known Source erasure reuses the
Original all-version/report/compiler erasure and downstream cleanup owners, with
permanent markers and restore guards; retained digests are provenance, not passes.

Actual compiled-copy tests cover foreign-reader denial, internal consumer denial,
run-history removal, monotonic references, Source erasure and restored bodies/gates.
Historical SQL/journal upgrade tests cover both reconstructable and unavailable
legacy records. These are software fixtures; synthetic timing/cost values select
a span only and establish no performance, Human or provider qualification. Direct
conversation/Agent-authored Artifact Sources and wider package/knowledge closure
remain separate open work.

## ADR-58 — Native API discovery composes the existing Workflow authoring SDK

The Original typed Workflow SDK was exposed through self-MCP but absent from
the Native Agent API catalog. A current run can now discover and call the closed
workflow-authoring API. It dispatches the same eight SDK operations, with no
whole-graph replacement, caller-selected actor/run, permission grant, execution
or publication. prepare_publish continues to return a Human request only.

The authenticated run JWT must match an actual running Native run and its current
Task/Agent owner. Existing feature admission, current verified responsible account,
Agent/user permission intersection, exact draft CAS, Source privacy and Original
Stop/package/commercial/governance guards remain authoritative. Generic API calls
retain the existing bounded orchestration plan refusal. SDK writes and body-free
Native Activity commit in one transaction; SDK replays emit no duplicate Activity.

A direct HTTP baseline demonstrated that relying on call_api's Ask-mode check
alone was insufficient: the authoring SDK admitted that write. The canonical
authoring authority now checks actual Native standard mode, current execution
ownership and pending Stop, including callers through other SDK transports.
Conversation guidance points to the typed API and actual saved workflow links,
while validation, execution and Human publication stay distinct. UI entry and
real model/provider generation qualification remain open.

## ADR-59 — Saved workflow intent enters the existing Native conversation

Describe receipts and draft review can discover bounded existing Native authors
under current Human account, workflow Source and Agent read authority. A policy
subject preview intersects existing Agent/User workflow grants; it supplies no
JWT, runtime qualification, configuration or new authority. Current Agent status,
Native adapter selection and authoring/chat/API rollout remain required. The
Original provider resolver excludes invalid configurations and the text-only
Task-document controller, which has no executable workflow tools. The currently
supported authored-definition runtime remains that text-only boundary and is
not offered as a workflow author. This classification is not live qualification.

Navigation carries only workflow/draft UUID locators. The destination re-reads
the Original current draft and author choices before an explicit prepare action.
Changed revisions or withdrawn authors cannot silently become another request.
The localized prompt copies neither described intent nor private names/config;
the authorized Agent reads the Original saved description only after normal Send.
Both existing composer implementations share the same optional append handle.
The actual task-chat composer now receives that handle; preparation preserves
unsent text, focuses the editor and refuses disabled, uncertain, queued-edit or
takeover states. It creates no conversation, run, model request or grant.

A private read closes over its surface lifetime, so this widget's query identity
includes the mounted reader. A deterministic two-surface baseline otherwise
loses the remaining view when the first reader unmounts. Current account and
Source epochs still withdraw names/actions and reject late acknowledgements.
A prepared receipt describes insertion historically; it does not assert dispatch
or a current workflow outcome. Model-generated flow and live runtime/Human
qualification remain open.

## ADR-60 — Storage admission can prove an allocated write never started

The Storage service owns the boundary between accounting admission and its first
provider invocation. When admission rejects, it can notify the durable allocation
owner of the exact prevented key. This optional observation is distinct from a
fulfilled PUT and is never emitted for a provider rejection or unknown response.
Feedback uses either proven observation only to settle its own candidate's
transport and invoke its existing fixed-key deletion owner. Neither observation
grants access, creates a ready image, substitutes HEAD absence for quiescence or
resolves a process crash. Original successful-write and unknown-write behavior
remain authoritative. Deletion success still requires the Original delete and
absence receipt; accounting refusal itself is not erasure proof.

## ADR-61 — Assigned procedure review reuses current Native Source readers

An assigned Skill reviewer or Playbook owner can receive a bounded M0 review
finding through the existing Core maintenance reader. Assignment routes a finding;
it never supplies access or promotion authority. Original Skill/private-version,
Playbook/revision and retained Source readers remain required. Required Skill
dependencies are resolved from current Native owners, never a cached status.
The response contains no procedure name, body, dependency reference, private
error or reviewer identity. Existing editor navigation rechecks its own access.

This shares Core maintenance's verified-account transaction, privacy lock and
1500 ms budget, preserving the existing eight-reader admission limit. Only five
assigned records of each kind are examined; a sixth means partial coverage.
Denied Sources remain partial and private. A final owner re-read withdraws
reassigned or changed findings. No revalidation, assessment, candidate generation,
version update, approval, publication, repair or Activity is performed by reading.
Package/runtime recovery and real automation qualification are separate work.

## ADR-62 — Package revalidation is an Original installation metadata finding

The Core maintenance reader can project five own degraded/needs_update Native
installations through the existing package metadata owner. Original installer
assignment routes the finding; current Agent read and configuration permission
are separately required under the verified-account reader. No component content,
pins, readiness prose, private reason or owner identity leaves the card. It opens
the existing package owner without changing versions, grants, qualification or
activation. The Source digest binds current Native installation metadata only;
it is never proof of component qualification or a successful revalidation.

These M0 findings are separate from active-installation M2 budget/unknown-outcome
cards. Each final experience re-read dispatches to its actual owner and withdraws
changed or canonically suspended installations. The existing shared deadline,
private-source partial state, eight-reader bound and global critical-card priority
remain unchanged. Generic unknown-outcome reconciliation, component source closure
and hosted/Human qualification are independent requirements.

## ADR-63 — Native package workspace retains inputs, never a prior read's authority

The existing package workspace now binds its reads, dispatch and acknowledgements
to the Original current session. Same-person unsent setup remains in memory;
a different principal/company remounts it. Mounted-reader query identities and
zero cache lifetime prevent an old surface's request from answering a new one.
Pending/failed session or Source reads withdraw private content. Selection retains
only release locators and resolves its prose from the current Native catalog.
Readiness receipts belong to the current authority epoch and cannot survive a
session recheck. Existing Native permission/version/qualification checks retain
every effect, including explicit local-operator behavior. Reading current state
never retries an installation/update/decision. Unknown installation reconciliation
and complete bilingual form copy remain separate open work.

The shared private authority subscribes only to Original session cache events;
unrelated query construction cannot serve as an authority notification. The
workspace uses the existing Layout main landmark, restores a surviving Agent
control after private rechecks and leaves active Native dialog focus alone.
Secondary readiness checking is outside the cancel/primary footer row.

All Original package HTTP namespaces, including global publication/catalog paths,
use private/no-store responses and the existing private HTTP log purpose. Refused
methods, malformed scopes, input/error prose and identifiers are normalized before
logging. Actual logger canaries demonstrated the prior leak. Native Activity keeps
its own purpose; this changes no Telemetry schema or authorization grant.

Fixed package form and lifecycle labels use EN/DA reference copy. Native Source
prose remains unchanged; translating a label cannot rewrite an approved purpose,
warning or procedure. Proposal acceptance describes a recorded review separately
from activation. Installed action groups wrap on narrow layouts while the form's
cancel/primary footer retains its row. Locale changes create no work or grant.

## ADR-64 — Exact Native installation request read-back owns recovery

New form installations retain one request UUID before dispatch and capture the
exact parsed input in memory. An explicit resend reuses that input/key through
the Original installation owner; it is never automatic or reconstructed from a
stored locator. Even a transport success must be read back through the Original
request binding before pending identity can be cleared. Existing Native immutable
company/installing-principal/Agent/request ID/hash constraints and the exact
company/principal/request index remain the owner; no second installation ledger
or schema migration is introduced.

The new bounded reader returns only current installation status/version, opaque
locators and observation time. It requires the Original installing Human, current
verified membership and Agent read, with existing explicit Native local-operator
behavior. Ignore stale instance-admin claims. It creates no assessment, Activity,
installation, activation, model call or grant, and remains readable after the new
work flag closes. Its status is current metadata, not historical status or proof
of a running Agent/business result. Absence remains unconfirmed.

Per-tab recovery retains only company/principal/request locators, with closed
32-entry/8 KiB bounds. Unknown outcomes have no automatic expiration or new-key
retry. Corrupt/unavailable storage refuses dispatch. Actor/session/reader epochs
and new private transport reads reject late context; package GETs detach earlier
coalescing. Restored locators have no setup/resend capability. The supporting
recovery route and pending-only rollout fallback share the same reader. A visible
unchanged resend is an Original installation operation, not a read.

Safe change: old callers may continue omitting the optional request ID. New
callers require the existing immutable binding and new read endpoint; an older
incompatible server remains unconfirmed rather than launching a new request.
Native updates/uninstall retain initial identity; current read-back can therefore
show a later state explicitly. Keep new-install feature gates and all Native
permission/admission/pin checks. Rollback does not clear unresolved locators or
turn unknown into failure. The private/no-store middleware is restricted to
package-owned paths; unrelated routes retain their own headers. Hosted mixed
version/restore, wider component Source closure and Human qualification remain
open. The supporting contract does not replace any of the 70 launch surfaces.

Package readiness additionally binds the exact parsed setup and the observed
Original catalog/options/purpose/installation source frame captured before the
preview request. Completing any fresh relevant read invalidates the old preview,
even with identical visible JSON. A late acknowledgement retains its original
frame and cannot borrow the new one. This fingerprint stays in memory; Native
installation/update admission remains authoritative.

Package setup additionally requires currently offered Agent/component/purpose
choices and an unchanged current installation version before readiness or a new
dispatch. UI decision reasons use the Original shared validator. These are early
input checks, not a replacement for Native admission. An explicit exact-input
installation resend continues through its retained Original request identity.

## ADR-65 — Slack and Teams binary confirmations use the Original action owner

With effective action_cards_v9, Slack and Teams may use the existing Native
binary-confirmation action ledger and callback resolver, as Telegram already
does. The pinned Chat SDK renders the same accept/reject labels and opaque
action identities. Existing current external principal/link, endpoint, destination,
message, interaction and Native resolution authorization remain required. New
host callbacks additionally share-lock and recheck effective rollout inside the
Original resolution transaction. Disabling rollout refuses uncommitted actions;
already committed responses still settle through their durable Original owner.

The existing exclusion policy remains: required rejection reasons, tool actions,
secret proposals, connection authorization and document review require the full
Native web path. No new approval type, grant, arbitrary tool dispatch, provider
send owner or callback token table is introduced. Repeated callbacks read the
committed original action; they do not create a new confirmation or terminal
publication. Unknown delivery and post-resolution crash recovery keep Native
settlement behavior. The capability flag is rollout admission, never permission
or hosted/provider qualification. Software fixtures do not establish live C7.

## ADR-66 — Native package automation pins require their current Source readers

The specialist package options reader now includes current active published
workflow revisions and current active routine revisions. The existing bounded
500-per-family inventory refuses overflow. Native Source readers authorize each
candidate before emitting its name/opaque locator/hash. Role versions also use
their Source-aware Original reader. The same automation component guard serves
explicit pins and Hire routine resolution, including the routine's conversation
Source and both its immutable saved/current workflow targets. A valid digest
is an identity constraint, never private-source authority.

Options run in one Native company analytical/memory privacy transaction with a
1500 ms total/statement budget, 250 ms lock budget and current account checks at
entry/return. No assessment, Activity, provider call, copied automation, trigger,
run, activation or grant is created by listing. Existing immutable revision
pins, content hashes and Original installation/activation admission remain the
owners. There is no new table, migration or capability map. Incompatible old
clients may ignore the additive component families; flags remain rollout only.
Broader downstream copy erasure, hosted qualification and whole-V9 acceptance
remain open.

## ADR-67 — Attention quality is evaluated against reviewed conditions, not sent alerts

The optional operator-invoked offline evaluator consumes the existing frozen
pilot protocol and bounded private condition/delivery annotations. Required
canonical conditions remain in the denominator when no alert was sent; empty
precision is null. Current authorization/actionability, independent usefulness
and warranted-interruption judgments, actual action windows and repeated
decision value are separate. Unknown delivery, resolution, partial inventory,
open/missing windows and unreviewed data cannot become confirmed misses or
exact latency/age. Uncertain earlier delivery yields latency upper-bound
buckets. Journey/role/surface/assistive/consequence slices are not pooled.

Canonical annotation/protocol and complete frozen source/configuration/policy/
model/tool hashes bind the descriptive receipt without retaining input labels
or raw observation times. Owned regular 0600 input and exclusive/no-follow 0600
output use the existing pilot file reader; no application event collection,
provider call, Native action/authority, database, session replay or export is
introduced. The Data Processing Contract requires the existing approved study
source/retention/rights procedure. The scorer cannot certify those facts or
enforce Native tenant authorization on supplied artifacts. Output always
refuses population/GA claims; synthetic cases are software evidence only.

## ADR-68 — Analytical navigation waits for the current account and rollout reads

The Insights directory consumes the existing experience owner's complete loading
fence and current account/epoch-scoped flags. Retained navigation is withheld
during session, projection or flags rechecks and on error. A current flags GET
detaches earlier transport coalescing without aborting existing readers; ordinary
settings callers retain their behavior. Late prior-account flags cannot restore
new-account navigation. Fixed read recovery repeats only Original reads.

Existing Native business experiment navigation joins the other five analytical
families. EN/DA descriptions distinguish measurements, process evidence,
forecasts, conditional scenarios, historical reviews and registered experiments.
Disabled views are separate from absence of business evidence. The directory
displays no analytical object/result, performs no analytical write or model call
and grants no authority; each Native destination keeps its current Source,
permission, qualification and effect policy. Actual V8 insight result cards and
conversation authoring remain separate pending work.


## ADR-69 — Reviewed task proposals retain their explicit initial state and atomic hooks

The Original suggest_tasks interaction accepts an optional initial backlog/todo
state. Omitted state keeps the legacy todo behavior; running and terminal states
are rejected by the shared schema. Both existing review surfaces show an explicit
state before acceptance. The Original child-issue creator retains assignee,
parent, company and source-run ownership; no new task or approval ledger exists.

acceptInteraction forwards its existing transaction hooks through suggest_tasks.
Current-authority checks execute before claiming the interaction; receipt hooks
execute after Original child creation/result persistence inside the same database
transaction. Either failure rolls back the verdict and all created tasks. A
terminal interaction cannot create the same proposal again. These are Native
prerequisites, not evidence that Custom Agents can yet propose or create tasks.


## ADR-70 — Agent task proposals are bounded data and Native Human-only interactions

A shared strict parser accepts one draft plus either no task or one task with
only title and description. It refuses model-selected company/parent/assignee/
state, arrays, unknown fields, prose envelopes and oversized content. Fixed
errors contain no Source excerpts. This parser does not confer runtime policy
or task authority, and is not yet connected to authored Agent execution.

The real Native request_human_input projection may tighten resolverPolicy to
human_only. Omission retains the existing Native policy; every other explicit
value fails before interaction creation. The Original owner persists that policy
and the existing semantic receipt handles replay. No vendor mock contract is
changed or presented as production authorization proof. Native integration
exercises the actual Agent-denied/Human-accepted path: only explicit Human
acceptance creates the unassigned backlog child with Original source-run
provenance. create_task runtime mapping remains closed until its full controller
and representative-test paths use these prerequisites.


## ADR-71 — Authored Agents propose one separate backlog task through the Original Human verdict

Only create_task: ask_first joins the mapped internal-draft policy. The model
returns strict bounded text data with at most one title/description proposal,
never executable tools or identifiers. The private Native controller consumes
the exact published Agent version, the current declared output, Source and
Original model/tool budgets. A context read, draft write and Human interaction
consume three Native tool actions; known insufficient capacity refuses before
model dispatch. No reviewed budget is raised and no automatic provider resend
or Agent continuation is added. The representative-test controller uses the
same output grammar but records the proposal solely as review evidence; its
Original run declares zero business tasks, no tools and no activation.

The active bounded-plan SQL guard continues to prohibit arbitrary child tasks.
The proposal therefore uses the Original suggest_tasks owner's new closed
company_backlog placement: one standalone, standard, unassigned backlog task,
linked from the Original interaction and Native source run. The model cannot
choose that placement, assignments, project/goal overrides, permissions or
recipients. Explicit Human-only policy and the exact same-company Native
Task/run binding are mandatory. No worker is added to the original plan and
there is no assignment, wake or automatic execution.

The Human verdict locks the existing company/privacy boundary, current verified
user and active membership, and current Source issue. It reuses Native issue
mutation authorization with the complete current resource, including viewer
denial and no instance-admin membership bypass. Current Source is revalidated
before and after creation. Task UUID preallocation, the pending claim, Original
receipt and Original task factory all share one transaction; failed authority,
Source, identity or receipt checks roll everything back. Concurrent approvals
produce one task. Accepted cards retain their task IDs and cannot recreate them.

Migration 0499 extends the existing 16-hop Source chain with Human-reviewed
origins. It requires the exact accepted Human-only interaction, its actual
created-task receipt ID, Human creator, company and Native source Task/run.
Copied origin strings and unrecorded task IDs fail closed. Mutable task title,
status and assignments do not replace provenance. Existing Agent-created
origins/cycles/bounds remain supported. The Original erasure owner includes
these indexed origins and physically scrubs their task payloads after Source
suppression. Missing new SQL mapping rolls approval back. No new task, approval,
Source, queue or model ledger is introduced.

Both review hosts disclose standalone placement and expose EN/DA creation and
rejection controls. Actual shipped-host contrast failures justify token-based
backlog text, avatar initials and Task metadata/description corrections. Those
checks are bounded software evidence; genuine provider/tool qualification,
manual assistive-technology and representative Human evidence remain open.
Automatic task effects, external send/spend, permission changes and delegation
remain unmapped. The 70 release rows and R0 remain pending.


## ADR-72 — Insights displays bounded retained observations from the Native metric owner

The directory adds a read-only measurement view over the existing Native metric
list/detail/observations endpoints. It never calls the calculation/query writer,
a model or a parallel result store. At most three published metrics and three
observations from each owner's first bounded page are shown. Original ordering
is by Native identity; neither latest-result ranking nor a complete company
inventory is claimed. Definition version/hash, company/metric identity and
current published state must agree; malformed or mixed results fail without
private error excerpts. Existing owner Source/authorization requalification is
authoritative. Opaque model metadata or a frontend profile grants no privilege.

Current session/projection/rollout loading and failure unmount private results.
Company/principal/authority and metric activity revisions have ephemeral query
keys; fresh transport reads detach older requests and pass cancellation through.
During refetch, retained private titles/values are withheld; an earlier account
cannot restore them. Expired observations suppress their numeric value on the
client as well as through the Native reader. Observed zero is distinguished from
undefined, unavailable and restricted values. Native object counts use customer
units, native subset ratios display a rounded percentage, and period/current-
state/as-of/authority semantics remain explicit. No new observation is created
merely by visiting the page.

This implements MetricInsightCard support and a partial manager journey, not
all V8 insight families or semantic conversation authoring. Source/Tenant, host,
manual and representative Human qualification remain open. Browser governance
and business rows are explicit disposable software fixtures, not real-company
or compliance evidence. Legacy local company removal fails on governance
retention references; this discovered separate owner gap is not erased by a
fixture cleanup or represented as a tenant-erasure pass.
