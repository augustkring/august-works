# Extend the Original owner with bound notification channels

Status: implementation in progress; not PR-ready, no live sends or release claim.

V9-016 requires Slack/Teams/email policy adapters. The existing email owner already
has timing, quiet hours, mandatory security rules and unknown-acceptance handling.
Task publications require a Task; generic account notices must not invent one.
The existing chat provider-effect queue does support source-bound non-Task effects.
Extend that owner with a separately admitted notification mode and canonical notice
foreign key. Preserve its credential lease, runtime generation, single-owner claim
and unknown state. Do not create another transport outbox or business-state owner.

Company-bound personal choices extend the Original notification owner without
changing global cadence semantics. Current Native identity/processed private-chat
proof and exact baseline/target hashes gate a Human-confirmed command. Own command
receipts are separate from provider delivery. Missing, revoked, foreign, group,
guest or incompatible Sources fail closed. Keep security mandatory and preserve
in-app notices without silent email substitution. No arbitrary text/destination,
agent grant, work dispatch or task creation is part of a preference update.

Implement strict shared contracts, additive migration 0500 with identity/version
and withdrawal guards, Original read/write/receipt APIs and API metadata, current-
account UI, Native grouped effect staging/admission and independent receipt expiry.
The notice language is an explicit company-bound choice, not inferred server-side
from a browser display preference. See [the purpose/retention contract](../experience/v9/notification-channels-data-processing.md).

Preserve generated migration ordering: parent composite unique indexes must exist
before their foreign keys. Withdrawal uses column-specific SET NULL so company
scope and monotonic versions remain. Preserve older unrelated Drizzle snapshots.
No production database was migrated. Synthetic PostgreSQL and transport fixtures
must prove access, replay, race, no-payload-leakage, no duplicate effects, quiet/
digest scheduling, rollback/expiry and unchanged Native behavior before commit.

Targeted qualification now passes 15 real PostgreSQL/Native queue cases, including
both providers, HTTP identity/company isolation, immutable receipt guards, exact
replay, metadata expiry after rollback, destination withdrawal, reconfirmed source
hashes, completed Task independence, email suppression and mandatory security,
digest membership and due scheduling, queue fairness and unknown acceptance with
one transport attempt. The 1,044 excluded C7 cases are filtered, not passed.

The actual queue test first reproduced a future digest starving an independently
due notice. Received-effect selection now respects the durable retry instant.
The new private HTTP family was independently red before joining the existing
all-method/rejected-route log policy. Notification queue failures retain only a
fixed diagnostic; raw provider failure text and recipient/endpoint IDs are omitted.
Neither change weakens Native authorization, leases or unknown-state handling.

Thirty-eight shared/API/UI tests and the production-built account browser case
passed before the final privacy/fairness correction and notification-heading copy.
The browser checks exact lost-acknowledgement retry, reload, 320px, both themes and
unchanged WCAG rules. Its first dark measurement ran mid-transition; waiting on
actual finite theme transitions fixes the measurement, without changing styling
or suppressing an axe rule. The older Danish account-label assertion is updated
for the now broader notification settings. All 61 renewed shared/API/UI/log-policy cases and all 15 Native/PG queue cases
now pass after the final corrections. Token and source-coverage checks pass; the
release gate deliberately still fails. Complete final checkpoint type/build and
regression remain pending.

Drizzle reports no schema drift; all 500 migrations run in disposable PostgreSQL.
The full workspace typecheck passed before the final server privacy/fairness delta.
Initial fixture dependency/timestamp failures, red privacy/fairness cases and the
browser measurement failure remain inspectable. No production database, external
provider, PR, push, deployment or release acceptance is claimed. All 70 release
rows, source completion and R0 remain open.
