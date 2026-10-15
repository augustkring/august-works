# Local, optional V9 experience observations

## Scope and authority

Implement the missing runtime observation foundation for V9-008 and
V9-085–088. This is an instance-local data purpose, separate from Paperclip's
default outbound Telemetry, Native operational audit and optional OTLP tracing.
It must introduce no third-party endpoint, session replay, model call or business
authority. It remains off under the existing `experience_analytics_v9` feature
until the current verified person explicitly opts in for one company.

The first collector records finite surface/variant/activation-step categories
and coarse visible-view intervals. These are reported UI observations, not
canonical outcomes, actual Human interruptions or support labour. Existing
Native independent first-value verification and the frozen pilot/attention
owners remain the oracles for those claims. Missing observations cannot become
zero usage, a usable-account baseline or grounds for legacy retirement.

## Data contract

- One personal preference per company/user; default false. No administrator can
  opt another person in through this API. Instance-admin status does not replace
  current company membership for collection or measurement reads.
- Strict enum fields, random per-observation request UUID, server timestamps
  and a canonical payload digest. No prompts, output, names, emails, resource
  IDs, URLs, raw errors, arbitrary properties or provider credentials.
- Internal company/user ownership keys exist for authorization, erasure and
  deduplication; this is pseudonymous company-confidential metadata, not anonymous
  data. Summaries contain no user key and never cross companies or principals.
- A 35-day observation window supports a bounded monthly review. No cohort
  targets, extrapolated minutes or population rates are invented. At most 128
  new observations per person/company in a rolling day; duplicate requests do
  not consume the limit. Reports explicitly describe opt-in, incomplete coverage.
- Expiry immediately suppresses reads; a bounded existing background-job lane
  deletes expired observations and one-day preference command receipts even
  after rollout closure. Withdrawal deletes that person's observations in the
  same transaction and remains available after feature or membership withdrawal.
  Original user/company deletion cascades remove the new owned data.
- No new export/backup sink. Existing deployment backup/restore obligations
  remain; the software does not certify physical backup erasure or residency.

## Concurrency and presentation

Lock the original analytical/company privacy boundaries, current user/company
authority and personal preference before collection or mutation. Preference
commands use immutable request keys and expected versions for opt-in; explicit
withdrawal always wins over a stale enable attempt. A lost acknowledgement is
reconciled through an Original read; late replies cannot restore a former
principal or override withdrawal. Preference/audit receipts are distinct from
current collection availability.

Use private no-store APIs with expected-user binding and the existing content-free
private HTTP logging policy. Passive collection never retries a mutation or
interrupts customer work. The account control explains local scope, optional
choice, retention and withdrawal in English/Danish. There is no new required
step in a customer journey. Inactive/background intervals are excluded from
the client observation, without claiming that visibility proves Human effort.

## Verification required before integration

Strict shared leakage/shape tests; actual migrated PostgreSQL ownership,
withdrawal/idempotency/races/rate/expiry/deletion tests; private HTTP canaries;
current-session UI fences and locale tests; built consent/withdrawal journey;
appropriate workspace checks. No real customer collection is enabled by these
tests. Full V9, live/provider, manual AT and representative Human qualification
remain open.

## Implemented software boundary

The shared strict schemas and recoverable processing-purpose metadata, migration
0501, personal service/routes, privacy-purpose HTTP logging, flag-independent
bounded retention sweep, EN/DA account control and passive UI collector are now
implemented. The collector classifies actual company routes locally, records
the shell variant and activation stage, and quantizes only visible intervals.
No URL, source identifier or free-form diagnostic enters its payload. A current
preference-version fence also rejects a late sample after withdrawal/re-enable.
Observation writes are deliberately not copied into the independently retained
Activity Log; preference changes are audited through its Original owner.

The first PostgreSQL run exposed a test that bypassed Native company deletion
and hit its audit FK. The test now uses `companyService.remove`, preserving the
Original deletion workflow. All 87 shared/HTTP/PostgreSQL cases then pass.
Focused settings, collector and activation cases pass 28/28; the settings and
existing account-security group passes 23/23. Workspace server/UI direct types
and token gates pass. Two actual built EN/DA consent/lost-reply/withdrawal cases
pass in 56.6 seconds with controlled personal-session/observation fixtures.
Those fixtures establish UI behavior; actual ownership, expiry and deletion
are covered separately on migrated PostgreSQL. The browser follow-up also
exercises collection from the real company dashboard route.

These observations cover the beginning of V9-008/085–088; they do not measure
actual Human interruptions, canonical successful outcomes, monthly support
labour or a representative legacy-usage window. Full current-source workspace
checks and the final browser follow-up must finish before PR-ready claims.


The first broad UI run stopped at the provider-free routing harness after
63 files / 2,079 cases passed. The global collector had introduced a query
provider requirement into the route table. It now mounts inside each actual
authenticated Layout, where the Original company/session providers already
exist. A closed rollout also prevents personal identity/preference reads.
Activation retains its explicit scoped observer. The routing/Layout/observation
follow-up passes 53 cases before the added rollout-off regression. No full
UI pass is claimed from the stopped run.
