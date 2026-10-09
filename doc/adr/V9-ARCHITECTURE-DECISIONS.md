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
