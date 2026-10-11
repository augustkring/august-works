# V9 current-owner activation measures

## Purpose and canonical source

V9 §§46.1–46.2 allow a privacy-minimized shared schema over canonical records.
This scope adds a private current-owner view at `/company/measures` and
`GET /api/companies/:companyId/experience/analytics?expectedUserId=…`.
It reads the existing onboarding owner, current independent verification and
bounded original Activity Log metadata. It creates no event store, new ledger,
provider export, background event collector or session replay.

The recoverable processing contract is `ACTIVATION_MEASUREMENT_CONTRACT` in
`packages/shared/src/experience-measures.ts`. It records purpose, accountable
product/privacy ownership, exact permitted/prohibited fields, granularity,
company scope, classification, sources/sink, region boundary, admission,
sampling, retention/rights/export behavior, tests and review triggers. The
strict shared wire schema rejects extra/private fields. This scope does not
change Paperclip's separate first-party opt-out Telemetry path, its default
Paperclip endpoint, or the operator-gated OpenTelemetry path. It makes no
whole-application telemetry-disabled or residency/compliance claim.

## Measurement definitions and unavailable evidence

The supporting duration is native onboarding creation to the currently
independently verified result. It is **not** Time to First Useful Outcome:
creation alone does not establish V9's usable-account/org start point. The
response and UI explicitly keep that baseline unavailable. No pilot baseline,
human effort, arbitrary UX target or successful activation rate is invented.

The setup measure counts existing `activation.step_completed` metadata for the
same original onboarding, initiating user, company and creation-to-verification
window. It measures recorded transitions, not all customer actions, required
setup actions, correction effort or support contact. Original `from`, `to` and
version bindings are validated; duplicate/malformed version receipts fail
closed. A 129-row query distinguishes a complete bounded inspection of up to
128 stored receipts from an unavailable total; excess rows never become zero.
Count/duration buckets have defined edges and invalid inputs are rejected.
Those quantization thresholds are measurement definitions, not UX targets.

Current verified account, active original membership, onboarding owner,
company/source authority and effective activation/analytics flags are required.
Instance-admin status cannot replace company authority. Original analytical
and Memory privacy serialization, native share locks, and the original
five-second source/SQL bound protect the read. Original independent result
validation repeats under its own owner. Changed documents, revoked packages,
erased sources or lost authority suppress prior measures. The response exposes
no user/task/run/document/result/receipt identity or private source/error prose.
The company UUID serves only the current-client response binding.

## Customer view and qualification

The original current-session read fence suppresses older replies and hides
measures during account/source refresh. Native activity triggers a fresh read;
foreground-only periodic checks do not write events. The activation owner links
to the feature-gated view. English/Danish fixed copy, single layout main
landmark, heading/error focus, restored return-link focus, semantic observation
time, safe errors and token touch targets support the view.

Scoped checks completed on 2026-10-11:

- `v9-experience-measures-focused-v2`: 32 checks in five files, token gate and
  non-release traceability gate pass. Source SHA-256
  `fbb8ced7956ae1d272959a2f9071b770fdb30e5ee0fb15ed233956dd65d50ce4`
  is unchanged before/after.
- `v9-experience-measures-native-v5`: all 60 original and new checks in the two
  complete migrated PostgreSQL activation/package suites pass. Current owner,
  email/membership/rollout denial, original reviewed output, no new Activity
  writes, private no-store route/account/company boundaries, bounded receipts,
  changed output and package revocation are exercised. Source SHA-256
  `643aaf514fcfb1419def3a8cfa8b1383d44d504fd9e2a4cdd3cf62d014085f10`
  is unchanged before/after. The difference from focused v2 is solely the new
  Native account fixture honoring the original database flow fence.
- `v9-experience-measures-browser-v4`: one built-route case passes on that
  same unchanged Native snapshot. The account and measurement HTTP responses
  are explicitly software fixtures; Native authority is qualified separately
  above. English/Danish without extra locale reads, withdrawn values, keyboard
  return link, 390-pixel reflow and axe on the main landmark pass. This does not
  qualify hosted identity, human UX, real outcomes or a usable-account baseline.
- `v9-experience-measures-types-v1`: shared build and strict server/UI types
  pass at Source SHA-256
  `15a9567d283341a87cd1558afbb61beaefbad22d795f9d6bbabd5339be4c02fa`.
  The later changes are the permitted-field metadata list/test and Native
  fixture above; production server/UI bodies are identical. Shared v2 compiles
  the current contract metadata. The combined current full types/tests/build
  still need verification; this document does not claim an old snapshot typed
  every later test/doc change.

Prior failures are retained: Native v1 stopped before its Source snapshot on
an unnecessary assumption about an optional adapter dist; v2 could not read
its owned prerequisite script; v3 could not read the compiled public SDK entry.
Only those owned public launcher/build accesses were corrected. Native v4
passed 59 cases and failed the new fixture's out-of-flow owner rewrite; the
fixture now uses a real other account/membership and also asserts the original
SQL flow fence. No original assertion, test, permission gate, budget or deadline
was removed or weakened. Browser v1–v3 prerequisites failed before their own
Source snapshots; they do not establish browser qualification.

The other §46 metrics, actual TTFO/action baseline, complete provisioning and
agent promotion, general M0–M4 maintenance, live channels, support operations,
human/assistive-technology/pilot acceptance and full V9 release readiness remain
open. `sourceComplete` remains false; the 70 launch surfaces remain unaccepted.
