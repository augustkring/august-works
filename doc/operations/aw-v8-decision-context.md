# Native prospective decision context — implementation in progress

The existing `decisions` table, signed options, native human choice and durable
effect executor remain authoritative. This source wave adds immutable prospective
context, declared assumptions, qualitative/measured criteria and option-specific
expectations around those Decisions. It does not complete brief section 16 or V8.

A human saves a proposal with the expected context revision, then separately
prepares its exact version with a rationale. A new proposal clears preparation.
The native choice takes company → Memory → Decision locks, rechecks current
purpose, all source authority and exact prepared evidence, and commits its binding
with the canonical choice. Native effects execute after that commit. No binding
can be added after resolution; a disabled V8 flag allows the canonical choice
without inventing a retrospective analytical binding. Human withdrawal is a
separate operation, including when purpose is suspended or retained copies expire.

The server captures pinned native metric observations, process findings, exact
qualified forecast points and conditional scenario outputs. It
does not accept caller-supplied values, capture dates, hashes or confidence
probabilities. Confidence and expected ranges are explicitly human judgments.
No sum of criterion weights, automated option ranking, causal claim or person
score is produced. Additional provider/evidence kinds require their native owners
to be implemented and qualified before admission.

The immutable typed JSON aggregate is indexed by tenant-scoped
`decision_evidence_links`, `decision_assumptions`, `decision_criteria` and
`decision_expected_outcomes`. SQL guards require exact descendant payloads and
complete collections at commit. Preparations and bindings retain immutable human
receipts; a deferred guard requires the exact canonical choice/option/time/user.
Native effect bookkeeping can evolve while its bound decision specification stays
immutable. The generated tenant unique index is placed before the dependent FK;
the native Drizzle journal and snapshots remain generated.

Historical reads return captured facts with current source authorization. They
never replace the baseline with a later metric observation or recompute old
process interpretations. Current analytical purpose and source ownership still
govern disclosure. Changed, overdue or unavailable owners can make evidence
unavailable; they do not rewrite it. Every canonical origin, target, recorded
cancellation descendant and current privacy ancestry is checked. Bounds: 20
evidence links, 20,065 distinct lineage edges, 1,000 cancellation descendants,
five recent versions plus the frozen binding, 30-second source budgets and
8-second SQL statements. No complete-history claim follows from a bounded page.

Retention is capped by context policy and every source evidence expiry. Copied
native lineage participates in existing Memory/source erasure, expiry and company
purge even when flags are off. The canonical decision/work is retained after
analytical source erasure. A minimal root may retain a stale prepared UUID after
erasure; it cannot recreate erased source facts or acquire a binding.

Local PostgreSQL checks cover native choice/effects/replay, concurrent CAS and
choices, prospective version admission, SQL immutability/atomic binding, frozen
baseline after later measurement, hidden-source/purpose denial, rollback,
withdrawal, source erasure, paused expiry and company purge. Verification logs
live under `/var/tmp/aw-v8-decision-context-*`. The API wave passes 60 native
tests across context, existing Decisions, company purge and OpenAPI; four shared
contract tests; native snapshot drift/migration safety and server type checking.
The native Resolver now mounts an account/company-scoped context panel with
explicit proposal and preparation controls, native evidence pickers and read-only
frozen history. Editing pauses background context refresh so an unsaved human
proposal survives the normal 30-second interval; privacy/account changes still
clear it and mutations reauthorize on the server. Local UI type checking,
22 component checks, token gates and the production Storybook build pass.
The 24 browser presentation/form checks cover five states, two themes and
mobile/desktop widths, keyboard provenance, WCAG axe checks and human
range/evidence form validation. A separate elapsed-time browser regression
passes after 31 seconds of unsaved editing. The initial timing check used an
unstable exact label-text selector; its retained textarea was visible in the
trace, and the corrected accessible-role selector passes without a source change.
These are local source checks, not staging,
pilot, production, maintainer visual baseline or whole-brief acceptance.

Still open: maintainer visual baseline qualification, outcome reviews and assumption validation,
review rules and Learning conversion, templates and AI assistant, DMN,
experiment/causal evidence owners and final integrated regression.


## Exact forecast/scenario evidence checkpoint

Prospective context can bind an exact retained native forecast run/version/point
or scenario run/version/case/output. Capture invokes the existing source owner
inside the same company/Memory transaction, preserves its current authorization,
purpose, sensitivity, retention and publication/qualification, and copies only
the selected admitted facts and explicit limitations. Source code, caller result
JSON/hashes and unqualified calculations are not admitted. Confidential
calculations cannot be downgraded into an internal context.

Forecast points retain null intervals and explicit unassessed calibration.
Scenario values remain nominal conditional outputs with declared uncertainty,
constraints and base differences; empirical quantiles remain conditional samples.
Neither can become a measured criterion or actual baseline in expected metric
outcomes. The human rationale may support/contradict an option without selecting
it. New preparation/choice rechecks the exact current reviewed source publication.
A draft alone preserves the earlier publication; replacing its human publication
or source qualification blocks a stale prepared choice atomically before effects.

Historical contexts keep their original facts/hash after source retirement or
replacement, with current revalidation status presented separately from saved
bytes. Reads still reauthorize the exact source owner. A retained basis does not
establish current qualification or authorize a new choice. A native pinned
scenario consumer inspects retained arithmetic without rerunning it.

Migration 0402 adds exact immutable tenant-scoped calculation pins to native
forecast/scenario runs. Hash, selected identity/value, publication, chronology
and expiry are checked against the context/source; deferred material completeness
requires every declared calculation descendant. Source-owner erasure deletes
the entire dependent context manifest, version, human prose and binding with
rollout off and paused companies, while preserving the original canonical
Decision and unrelated work. An otherwise complete restored context without its
calculation pin rolls back at deferred COMMIT.

The integrated PostgreSQL owner/OpenAPI selection passes 63 checks, including
actual canonical choices, new source pins/retirement/replacement, confidential
denial, immutable pin tampering, source-FK erasure and missing-pin restoration.
Shared context/review contracts pass eight checks; UI source/panel/review checks
pass 13. All 66 actual Chromium checks pass across light/dark and 390/1200 pixels,
including exact calculation selection, historical revalidation, existing outcome
review states, keyboard provenance, WCAG and both 31-second unsaved-draft
regressions. Server/UI type checks, Storybook, native token/migration gates and
snapshot drift pass; the separate artifact/purge selection passes ten checks.
Presentation qualification is recorded with exact source,
log and screenshot hashes in `aw-v8-evidence/decision-calculation-checkpoint.json`.
Synthetic mathematical history and UI fixtures exercise software contracts,
not collected business evidence, causal identification, official maintainer
visual baselines or hosted release readiness. Whole V8 work remains in progress.

## Exact interpreted experiment evidence

Decision context can bind the native `experiment_analysis` ID, experiment/version
and separate human interpretation ID. The private experiment owner verifies its
signed receipts, complete intention-to-treat final outcomes, current authority,
retention and original numerical replay inside the native company/Memory
transaction. The capture retains the original primary/guardrail/exploratory
results, intervals, registered thresholds, quality gates, human conclusion and
limitations. The UI renders the existing native result cards rather than exposing
serialized calculation data. No copied result, source hash or caller qualification
is accepted as proposal input. Invalid/inconclusive evidence remains visibly so.

Every source manifest from the protocol, enrolled assignments and final outcomes
is inherited without dropping subjects. Native source budgets bound admission;
large populations beyond demonstrated performance are not qualified by this
checkpoint. Recorded and current project ancestry remain independently admitted.
An exact tenant-scoped analysis/interpretation FK pin plus a deferred completeness
proof prevents incomplete context material from committing. Erasure of an
experiment or any inherited native source removes the whole dependent context,
preparation/binding and captured human prose with rollout off/company paused.
The original canonical Decision, choice and already dispatched effects survive.

Changing a metric publication requires review for new preparation/reliance and
keeps the historical capture/hash unchanged. A native status proxy, human exposure
or concurrent-change report does not become a verified business/task outcome.
The causal interpretation remains conditional; experiment evidence cannot supply
a measured criterion or actual metric expectation baseline. A positive experiment
or human ship candidate never chooses a Decision or dispatches an intervention.
Causal, Learning and Planning consumers and full V8 qualification continue.
