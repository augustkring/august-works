# V9 native Memory index-check history

## Scope and source owners

V9 §§30–32 and 52.4 require bounded, postcondition-backed maintenance history
over original owners. This change adds `/memory/maintenance` and the private
`GET /api/companies/:companyId/memory/experience/maintenance` projection.
The existing Memory job worker, `memory_jobs`, and Activity Log remain the
execution and receipt owners. The projection performs no repair, enqueue,
retry, permission expansion, or new-ledger write.

Only native `index_refresh` jobs with the original `maintenance:v1:` lineage
are classified M1. Dedupe, compaction, reflection, retention and model rebuilds
are excluded rather than silently classified as deterministic index repair.
The worker already checks the native GIN index, reapplies original deletion
markers, refreshes PostgreSQL statistics, and commits the result and Activity
Log receipt in the same transaction under its current execution lease.
The index check now also requires the original public table, GIN method,
nonpartial single-expression index and PostgreSQL's live/ready/valid flags.
That postcondition repeats after ANALYZE under its original relation lock;
an unusable index cannot produce a successful job/verification receipt.

## Admission, postconditions and historical boundary

The read requires a current human/local-board identity, company read authority,
the original Memory owner/administrator admission, effective V9 maintenance
dependencies and enabled shared Memory. An instance-admin claim does not replace
native company/Memory admission. Original company privacy serialization and
share locks protect job/receipt reads; admission repeats before returning.
The transaction and source read use the existing five-second bound.

The ten newest original index attempts are shown with an explicit has-more
boundary. A successful job is verified only when its source/requester binding,
one native receipt, actor, times and exact strict native result agree. Missing,
duplicate or mismatched receipts remain unverified. An expired running lease
remains unconfirmed; reading never starts reconciliation or another attempt.
An erased source cannot re-emit an old verification receipt or record count.
No record IDs, prompts, names, requester identities, errors, configuration or
raw job/result JSON enter the projection. All admitted facts are historical;
they do not assert current index readiness or the truth of stored knowledge.

The original session owner fences client reads and acknowledgements. Account
rechecks hide prior metadata, including a same-turn raw-cache update and an
older reply from a prior session of the same principal. Source refresh hides
old data while checking. Fixed English/Danish copy, semantic time elements,
keyboard disclosures, safe errors, token touch targets and focus restoration
support the customer view. The actual layout owns the single main landmark.

## Validation and remaining V9 work

Actual scoped checks completed on 2026-10-11:

- `v9-memory-index-history-native-v2`: all 14 original Native PostgreSQL cases
  pass, including the original five maintenance tests, actual live/ready/valid
  catalog faults, receipt loss/duplication/mismatch, current tenant/Memory role,
  source erasure, expired lease and ten-row boundary. Source SHA-256
  `81b2fd4ecd25e4a5e8b4f66504c969b5c6578d0945cfde96df7fe8cbc1c2e967`
  is unchanged before/after.
- `v9-memory-index-history-focused-v2`: all 31 cases across five files pass,
  plus token and non-release coverage gates, on that same unchanged snapshot.
- `v9-memory-index-history-browser-v3`: the actual built route, original API
  and original 15-second worker tick execute a real index check in the owned
  software fixture. English/Danish, private no-store responses, original source
  erasure, rollout closure, 390-pixel reflow and axe on the main landmark pass.
  Source SHA-256
  `91b03f9297106be16f2379478cd56ef0837a242307b01d17c91037091ece19af`
  is unchanged before/after. The difference from the Native/focused snapshot is
  only the browser fixture's required cleanup URL; production code is identical.
- `v9-memory-index-history-types-v2`: shared build and strict server/UI types
  passed at snapshot
  `0c75f8df156c2213a6ffe792be64782c5a8418536d9b4b88ee45efacb9bb580d`.
  Shared/UI production code is unchanged since that check. The later Native
  catalog helper and fixture changes still require the current combined strict
  server/full-workspace typecheck; this document does not claim they were typed
  by that earlier snapshot.

Prior failed attempts remain retained: the first isolated type run was stopped
to replace its owned redundant cold Cargo cache with existing artifacts for
identical Rust Source; the first Native fixture omitted required rollout
prerequisites and then contaminated the global fixture queue. The fixture now
enables the complete dependencies up front and cancels only its own disposable
unexecuted jobs after each case. Every original assertion remains. The initial
browser cleanup omitted the required connection URL; that fixture call was
corrected. No test filter, skip, timeout, budget, authorizer or release waiver
was added to obtain a pass.

The integrated predecessor `29e61e385` passed all 35 workspace typechecks.
Its full-test launch stopped before running tests because a recursive artifact
chmod included files owned by the Native test UID. Only those known public
generated artifacts were corrected by their actual owners. This work can now
be integrated for a fresh full check; it does not reuse the predecessor's type
result as qualification of changed Source.

This adds visibility over an existing deterministic native owner. It does not
qualify a general M0–M4 repair engine, automatic recurrence policy, cross-domain
external reconciliation, M3/M4 approval or operator recovery, hosted operation,
human acceptance, or full V9 launch readiness. Those remain separate work.
