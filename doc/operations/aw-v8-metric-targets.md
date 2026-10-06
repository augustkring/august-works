# V8 native metric commitments

Status: implemented native source slice; full V8 source and hosted promotion remain
open. Runtime admission shares `business_metrics_v8`, `analytical_lineage_v8` and the
existing V7 analytical-purpose register. Flags remain default-off.

A commitment belongs to one company and one existing accountability context: Company,
Goal, Project or the company's unit in the existing Portfolio view. It pins an exact
published metric version, a half-open UTC period, a unit-compatible criterion,
assumptions, rationale and human owner. Scope does **not** implicitly filter the
measurement population. Portfolio commitments do not add foreign-company values or
establish a common currency, denominator or aggregation authority.

Native roots, immutable versions and approval receipts use same-company foreign keys,
expected revisions, human native permission admission and atomic activity audit.
A revised draft preserves the approved pointer; human approval explicitly changes
that pointer. Scope and metric identity remain fixed within a commitment. Approval
never changes a Goal, Project, Foundation, observation or forecast. Retirement remains
available after rollout rollback. PostgreSQL independently rejects altered version and
approval bytes, mismatched pins, moved ownership and missing approval evidence.

Each create/revise/approve rechecks current metric publication, version review,
analytical purpose, native scope access and current human owner. A new published
metric definition or unavailable approval context makes the old approved commitment
require review in its detail view; it does not rewrite the historical definition.
The metric operator includes company/account-scoped target history, native scope
selection, draft revision, explicit approval/retirement and observation comparison.

Comparison observes through the existing metric owner using the pinned population,
period and source-authority boundary. Before returning it, the service rechecks the
commitment revision, current publication/purpose, observation expiry, retained source
lineage and each contributing source's current access. Changes during observation
produce a conflict rather than a comparison attributed to another commitment.
Zero remains observed; an empty denominator remains unknown. Open or future periods
remain provisional even if a reversible ratio already reaches its threshold. A closed
period compares the metric's defined observation-time semantics; it does not reconstruct
historical status or establish causal impact. No forecast or final business outcome is
inferred from a current task-count measurement. External boolean observations remain
unavailable until their provider is implemented and qualified.

Native Goal deletion now serializes with analytical publication and erases associated
target roots, versions and approval history. Project deletion uses the same existing
owner boundary. Minimal goal/project suppression references reject later target
insertion from restored native source payloads. The independently authenticated native
restore ledger accepts goal guards and quarantine reapplies target erasure with flags
off. A failed canonical Goal deletion rolls back analytical erasure and its guard.
Source content in restored Goals/Projects still belongs to canonical restore reconciliation.

Generated migrations 0387/0388 retain the latest five Drizzle snapshots. The generated
Goal uniqueness constraint was moved before its referencing foreign key after real
PostgreSQL exposed the generator's ordering error. No snapshot was edited by hand.

Local verification: eight PostgreSQL commitment tests; eighteen metric, thirteen event,
fifteen OpenAPI and three comparison regression tests; nine shared contract/flag tests;
four UI scope/unknown tests; signed-ledger tests; generated schema drift, migration
safety, server/UI types and token gates. The full Storybook build and 36 component/operator browser checks pass;
whole-monorepo typecheck passes. Representative screenshots were inspected.
Official baseline publication and full application journeys remain open. These are local checks, not independent hosted R1/R2 or pilot acceptance.

Remaining metric wave work includes explicit bindings, target views in canonical
Goals/Projects/Portfolio, retention/export owner integration, qualified external
semantic providers and consumer invalidation through later analytical domains. Strategy
links, process, Decisions, forecasting, experiments, planning and management reviews
remain separate unfinished V8 source waves. Whole-repository and actual protected
archive/remote hosting recovery qualification are still open.
