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

The server captures pinned native metric observations and process findings. It
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
forecast/scenario/experiment/causal evidence owners and final integrated regression.
