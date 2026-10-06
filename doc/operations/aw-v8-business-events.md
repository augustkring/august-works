# V8 native Business Events checkpoint

This is a partial source implementation, behind default-off
`business_events_v8`. It does not qualify the complete V8 Business Events wave.

The first projector reuses `activity_log` for `issue.created`, `issue.updated`,
`issue.checked_out`, `issue.released`, `project.created` and `project.updated`.
Existing operational tables remain authoritative. It copies no actor identities,
message bodies, descriptions, credentials or arbitrary details. Status and
priority facts must pass the shared allowlist; absent facts remain absent.
An issue/project relation is included only when present in the historical source.
Current assignments never become invented historical relationships.

## API

- `GET /api/companies/:companyId/business-events?from=<ISO>&until=<ISO>&limit=100`
  returns authorized current projections. Continue with `cursorAt` and
  `cursorId` from `nextCursor`. Empty filtered pages can still have a cursor.
- `POST /api/companies/:companyId/business-events/backfill` accepts
  `{from, until, limit, cursor?}`. Both endpoints require explicit source windows;
  limits are 1–200. Backfill requires board audit authority and rechecks source
  object access. Repeat the exact window while advancing its cursor.
- `DELETE /api/companies/:companyId/business-events/sources/:sourceRef`
  requires instance administration plus board audit authority. It suppresses a
  native activity identity and erases its projections and object relationships;
  it does not delete the authoritative activity record.

All paths use existing company and native object authorization. Reads recheck
the current authoritative source and object access before exposing data. Changed
or deleted sources disappear from reads even before the next backfill. Backfill
and suppression share a PostgreSQL advisory transaction lock per company/source.

The first projection preserves the native activity UUID. Correction appends a new
revision, links its predecessor, and tombstones that predecessor without rewriting
its historical attributes. Returning to an earlier source value creates another
revision. Composite database keys keep event relationships and correction links
inside the company. Stable keyset source pagination preserves PostgreSQL
microseconds; the normalized event representation currently has millisecond
precision. Occurrence and observation times are distinct. Unknown transport and
source-update times remain null.

Each completed batch records its projector version, fixed source window, input
cursor, last source cursor, bounds and accepted counts. A failed batch can replay
already committed individual projections safely. `window_scan_exhausted` records
an observed bounded scan; it does not certify global event completeness or exclude
late-arriving rows. Revisit windows explicitly to capture late data.

## Evidence and open work

Nine migrated-PostgreSQL tests cover concurrent replay, payload minimization,
correction lineage, return-to-earlier-value corrections, suppression/replay races,
retained-register restore exclusion, tenant boundaries, composite foreign keys,
microsecond pagination, persisted checkpoints, source deletion visibility, disabled
admission and invalid bounds. Server and UI typechecks and UI token gates pass.
Together with existing admission checks, 76 targeted tests pass.

The restore test retains the suppression register while reintroducing backed-up
projection rows. Real recovery must retain/reapply a current suppression register
before reopening readers or writers. A backup that predates deletion can lose
that register; independent recovery preservation and executed restore reconciliation
are still required. This local test is not a hosted recovery drill.

Still unfinished: automatic source-owner erasure and retention hooks, governance
purpose/retention admission, other source adapters, incremental dispatch,
general analytical lineage/invalidation, OCEL/JSONL export, quality/readiness,
process analysis, operator UI, independent security review and hosted evidence.
Source references and suppression identities still require an explicit retention
policy. No customer-data processing or production-readiness qualification is
claimed by this checkpoint.
