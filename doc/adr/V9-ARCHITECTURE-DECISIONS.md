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
