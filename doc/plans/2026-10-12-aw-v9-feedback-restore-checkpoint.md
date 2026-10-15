# V9 feedback restore checkpoint

Full V9 and PR #38 remain incomplete. This checkpoint covers feedback erasure
replay and private local storage copies. It does not qualify a hosted recovery
operation, a complete independent deletion horizon or unknown remote PUTs.

At parent `7143bc8e3c5ba446cd861eb5da33a04ca8b82cf9`, the executable change
set has SHA-256 `41bb3dd6f607d7c29c5b0638f604f9d1ddac2d377b38c1f2d84eae83590b662b`.
The digest binds the sorted changed non-document paths and their bytes, separated
by null bytes. The final qualification checks use that frozen change set.

## Behavior

Migration 0485 adds immutable minimal feedback erasure identities. They survive
case, image and company content deletion. The migration backfills actual earlier
erasure requests and native deleting/deleted image states. The identities contain
only subject/company/feedback UUIDs, kind and the erasure-obligation timestamp.
They contain no body, contact, operator identity, object key or request token.

The existing operator backup worker exports these identities into the existing
independently signed ledger. Authentication requires a fresh bounded same-environment
feedback section, including when the archive predates V9. It rejects malformed
identities, future timestamps and missing sections. Export time uses the snapshot's
wall clock so a marker visible at the snapshot cannot fall after its transaction-start
timestamp merely because the exporter waited for the first query.

The existing quarantine owner imports the latest ledger before replaying erasure.
It removes erased case bodies and closes individual image reads. Images retain
their exact Original allocated keys in private deletion receipts until the existing
worker verifies transport settlement, provider namespace and physical absence.
Conflicting identities or allocation receipts stop replay. Native holds and recovery
admission remain in force. The application stays quarantined after replay.

An older snapshot without a PUT acknowledgement remains pending even when its
image is already absent from the current filesystem. There is no second PUT,
time-based quiescence inference or fabricated physical completion. Unrelated cases
and images remain intact. Ordinary reinsertion, including reassignment to another
company, cannot revive erased identities.

Company purge now retains Original feedback erasure receipts as well as the new
identities. This also fixes a purge failure caused by attempting to delete an
immutable Original erasure receipt.

Storage commit `db876c9ba` removes its exclusively allocated private temporary file
after write or rename failure. Deletion includes interrupted and legacy copies for
the exact allocated filename. It preserves neighboring objects and refuses completion
when a temporary copy cannot be removed. It does not qualify a crashed or unknown
remote writer.

## Verification

- 77 actual PostgreSQL/disk/dump cases pass across feedback, images, explicit
  retention erasure, account deletion, application storage and database quarantine.
- Eight title-filtered upgrade/restore/ledger cases pass. The actual pre-0485
  upgrade is also run alone and passes. The historical experiment's actual archive
  restore case, omitted by that filter, passes separately.
- Four signed-ledger authentication cases pass, including missing, malformed,
  future and over-bound feedback sections.
- Sixteen local storage/scope/reservation cases pass at the storage commit.
- The final changed-server type check and DB build pass. The generated schema,
  journal and migration checks pass. Historical snapshots
  pruned by the generator are restored.

The broader 35-workspace type check passes at `fc68a6bf5`, before the restore
change. The changed-server type check and DB build above qualify the restore change.
Current CI, remaining V9 implementation and full integrated tests/build/review
remain required. The normal 70-surface coverage checker still reports every
surface pending implementation/evidence; this checkpoint does not promote release.
