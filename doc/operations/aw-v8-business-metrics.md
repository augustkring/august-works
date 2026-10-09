# V8 native Business Metrics — implemented contract

This source slice registers metric drafts, appends immutable definition versions,
publishes pinned versions, queries bounded native populations and preserves
source lineage. It is not a completed metrics/lineage wave or hosted qualification.

Native counts and compatible subset ratios use tasks or projects created in the
half-open UTC interval `[from, until)`, filtered by **current** status at query time.
They do not reconstruct historical status. Task `projectId: null` means no project
restriction; an unassigned task remains a distinct null group in project breakdowns.
Native count uses `objects`; native ratio uses `ratio`, with no currency conversion.
An empty complete count is zero. An empty ratio denominator is explicitly undefined
with a null value, never zero. Query windows have millisecond precision, at most
366 days and at most 10,000 contributing objects. These are current house bounds,
not measured production capacity. Budget overflow produces no partial observation.

Current human/company permission admission and current source/project access precede
aggregation. Any inaccessible contributing source rejects the complete declared
population; the service does not substitute an actor-filtered denominator. Metrics
must have a current company human owner. Mutation requires native permission-management
authority. Account-pinned HTTP requests reject a changed principal. APIs are no-store.
The metrics and lineage flags and the existing governance-evidence gate are required;
lifecycle revocation remains possible after a rollout rollback.

An ordinary legal citation grants no analytical purpose. The existing immutable
`governance_obligations` owner now supports an optional typed analytical purpose:
explicit human approval, management/process purpose, business-object population,
advisory-only decisions, no people impact, allowed capabilities/sensitivity, retention
and prohibited uses. Metrics require a current applicable company-policy approval
for management intelligence and metrics, consistent with their retention/sensitivity.
Native governance registration already requires a human with permission-management
authority and records accountable audit evidence. A new record with the canonical
framework/authority/citation/scope identity supersedes the old approval. Superseded,
suspended, overdue, foreign or missing purpose evidence blocks metric use. This
purpose profile is a product admission policy, not a legal compliance certification.

Published definitions are separate immutable rows and a PostgreSQL trigger rejects
updates. Native CAS governs version/lifecycle/publication changes. Historical published
versions remain selectable while the metric is published and their current purpose
remains valid. Creating a new draft does not silently replace the published version.
External authoritative/projection definitions can be registered with exact pins,
but query execution rejects an unqualified provider; native counts are never a fallback.

Each observation records definition/input hashes, engine version, as-of/freshness,
source watermark and a tenant-bound lineage manifest. Edges record source object IDs
and hashes, selected projects (including empty project populations), metric version
and policy evidence, without copying task titles, descriptions or actor identities
from source rows. Requested-by metadata remains native accountable audit attribution.
Source selection and publication run in one transaction with source/policy share locks
and the company privacy serialization lock. A single bounded PostgreSQL statement
provides both population inputs and observation time, including empty populations;
commit time is not substituted for source read time. Canonical Governance obligation
registration shares the same lock so purpose supersession cannot race publication.
Native query work checks a thirty-second monotonic budget and each SQL statement
has a five-second timeout. These bounds are not production throughput qualification. Native task/project deletion erases
manifests, edges and observations through the same owner transaction with flags off.

## Verified and still open

Migrated local PostgreSQL verifies known populations, immutable versions, stale CAS,
tenant foreign keys, purpose admission/supersession/expiry, budget rejection, explicit
unknown, native erasure, external abstention and rollback-safe revocation. The pure
engine has order-independent known-answer tests. OpenAPI route parity is verified.
Shared/server type checks and generated migration safety checks pass at this checkpoint.

The default-off operator page now supports native definition/revision/publication,
windowed observations, explicit unknown/freshness, source inspection and lifecycle
controls. It preserves account/company boundaries for reads and late mutations.
The existing Governance editor exposes typed analytical purpose reviews. Four UI
regression tests, UI types/token gates, the full Storybook build and sixteen local
Chromium checks (four observation states, two themes, two viewport widths) pass.
Those browser checks cover semantic states, native keyboard source inspection and
document overflow; screenshots were manually inspected. They are not a full app
journey, assistive-technology audit, screenshot-baseline certification or hosted proof.

Targets, bindings, external semantic provider execution,
strategy links, query receipts, generic lineage API, retention scheduling, complete
source-owner adapters and independent operational/performance evidence remain open.
Native owner deletion now persists content-free company/object/type suppression
identities even when no event was ever projected. Queries reject restored suppressed
objects instead of silently removing them from a denominator. PostgreSQL rejects
late/foreign/absent-source lineage edges, mutated manifests/edges/observations/
publication records, and observations with inconsistent definition/manifest identity.
The existing independently signed deletion-ledger export/authentication now requires
a bounded `analyticalSources` section as well as Business Events. Quarantine reapplies
markers with flags off, erases dependent analytical payloads, preserves unrelated
observations and stays blocked for operator qualification. Older ledger formats are
rejected; a fresh current exporter is required even for older backups.

Seventeen metric, thirteen Business Events and eleven native Governance tests pass,
including copied pre-deletion records in a separate migrated quarantine database.
Three independent HMAC-ledger parser tests, schema drift and migration safety checks
and server types pass. This local record-copy test does not execute an actual archive
dump/restore, object-storage drill or protected hosting recovery. Native source rows
from the old backup can still require canonical owner reconciliation; the analytical
guard blocks their use without claiming all native backup content was erased. Direct/raw DB deletion bypasses native service hooks. Current native source
watermarks use explicit millisecond timestamp projections in the native query; they do
not assert a historical event stream's coverage or completeness. Full monorepo,
browser, exact hosted environment and release checks have not yet been qualified.
