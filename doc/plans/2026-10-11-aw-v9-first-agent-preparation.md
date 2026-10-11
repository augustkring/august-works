# V9 original paused first-agent preparation

## Canonical ownership and behavior

This bounded addition supports the first-agent preparation in V9 §78.10.
It does not complete ONB-09/ONB-10, Hire or Custom Agent promotion. The
existing `company_onboarding_runs` owner stores the private original agent
reference and bounded request receipts. The existing Agent writer creates
one paused general-role agent, or an agent awaiting the company's original
hire approval. The extracted helper preserves the legacy onboarding CEO
creation and original hire-approval payload and audit behavior.

`prepare_first_agent` accepts only the original request/version envelope and
an explicit paused-preparation confirmation. The customer cannot supply a
role, agent ID, provider, credentials, permissions or activation receipt.
Current verified account, active initiating company membership, rollout,
original create permission and qualified draft-only customer package are
required. Original company, onboarding and publication locks serialize
the write. Agent, identity, approval, private reference and original audit
commit in the same transaction. Replay reads the same original reference;
a different request cannot create a replacement. Existing legacy onboarding
targets and installed capabilities also suppress creation when their safe-task
option is unavailable. A pre-commit failure rolls
all those records back. The original V5 agent-insert trigger creates one local provider/runtime
placeholder. Its provider remains unqualified, with no capability snapshot,
configuration qualification or conformance report; the original runtime
authorizer rejects it. No new queue, execution, installation, API key, grant
or first-value proof is created.

The private configuration hash and publication pin never enter the public
activation state. The customer view rechecks original agent-read authority,
current publication, configuration and original approval owner. Changed,
approved/active, terminated, withdrawn or inaccessible sources become
`needs_review` or `unavailable`. They cannot become `ready` or `active` in
this projection. An original approval is not a representative safe test.
Advanced original agent controls retain their own behavior and may change
the Native agent; this addition does not claim to qualify those controls as
the V9 safe-test/promotion lifecycle.

## Customer surface and tests

The current activation review shows a localized explicit preparation button
only when the Native view supplies current authority and no existing
first-task preparation. After creation it shows preparation/approval state
and the original agent-monitor link. It exposes no Resume or Publish action.
The existing account/source epoch fence, no-store API, safe errors and
single main landmark remain binding. English/Danish copy states that access,
safe testing and required approval remain to be completed.

Added test coverage includes strict shared commands/projections, current
permission/pending UI controls, escaped names and unavailable sources;
original PostgreSQL concurrent replay, approval, withdrawal, permission and
flag denial, zero added work/keys/grants/installations, exactly one original unqualified
provider placeholder and actual original runtime-authorizer denial, and a real
Native rollback after injected pre-commit failure. A separate built-UI
software transport fixture checks lost-response reload, keyboard activation,
language changes, mobile reflow and axe. Software account/capability/API
responses are not Native authority or live-provider evidence.

## Qualification and remaining scope

The three focused shared/UI/locale files pass all 22 checks, and token and
non-release traceability gates pass (`v9-first-agent-preparation-focused-v1`).
The unchanged before/after Source SHA-256 is
`6daf95c92fffa53b4055a9a348d8d0edbd8929243efc42bdb4052a1e0ed12a0b`.
The later change adds only the existing-original-preparation guard and its
Native cases; it does not change those shared/UI/locale implementations.
Strict types, original PostgreSQL/legacy behavior and built browser checks
remain **unqualified** at this checkpoint.
The earlier integrated full regression is running on its frozen prior
snapshot. Heavy type, Native and built-browser checks for this addition wait
until that qualification releases the shared runtime; original budgets,
assertions and deadlines remain unchanged. No full pass is claimed here.

Required connections, representative safe test, install/runtime policy and
immutable version promotion, funded hosted execution, full first-job/value
journey, remaining V9 source and human/live acceptance are still open.
`sourceComplete` remains false; no launch acceptance row is completed and
this addition supplies no PR-ready or merge-ready claim.

## Review heading correction, 2026-10-11

The review page now says “Review before your first run” / “Gennemgå før din
første opgave”. Paused preparation does not establish safe execution readiness.
The existing built-route fixture now checks this heading explicitly. Queue v1
was stopped after verifying its own process and that no types/Native/browser
Source snapshot had started; its plans/logs and interruption reason are kept.
A new exact-source focused check and v2 heavy queue follow this checkpoint.
Earlier 22-case results do not qualify this changed snapshot. Types, Native,
built UI, full V9 and human/live acceptance remain pending.

## Native qualification correction — 2026-10-11

The complete v5 Native run found three failures in the newly added preparation
cases: two assumed that original agent creation made no provider placeholder,
and one removed the original create grant but restored only membership before
testing publication withdrawal. The V5 database trigger is retained. The tests
now check its exact unqualified metadata and actual runtime denial, and restore
the exact removed fixture grant before the independent withdrawal check. No
original assertion, deadline, permission rule or provider qualification changed.
The earlier 78 passed / 3 failed result remains failed; fresh qualification is
required for this corrected source.
