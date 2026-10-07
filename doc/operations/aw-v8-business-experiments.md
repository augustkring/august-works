# Native business experiments — protocol and registry checkpoints

The source supplies strict pre-registration/command contracts, a bounded internal
assignment label helper, conditional exact binary experiment arithmetic and a
source-owned preregistration registry for brief section 24. Native assignment,
exposure/outcome receipts, execution/analysis lifecycle, UI and downstream evidence
remain in progress. The registry grants no live exposure or deployment authority.
V7 Learning/Skill evaluation is unchanged; business experiments do not duplicate
software/agent correctness infrastructure.

The supported numerical design is an individually randomized, two-arm, binary
intention-to-treat experiment with one fixed-horizon confirmatory analysis. Primary
metric/version, distinct guardrails, eligibility/trigger, allocation ratio,
diagnostics, sample/duration/power rationale, effect thresholds, interference,
missing-outcome policy, stop/ship/rollback rules, external validity and ethics are
explicit. Required consent/material AI changes need existing governance/use-case
identities; hidden employment manipulation and dark patterns are rejected. Human
power rationale/minimum detectable effect is recorded, not asserted as validated
sample power. Cluster/switchback, sequential efficacy peeking and other methods
are not silently mapped to this method.

The HMAC-SHA256 48-bit label is deterministic for a secret key, company, exact
version and opaque canonical unit identity. Retry/order cannot change an arm.
The key is an internal owner input, never a public protocol field; this helper
does not store credentials, dispatch work or authorize exposure. The later owner
must retain immutable assignment and exposure receipts before using this label.

Capture checks exact definition identity, prior review/registration, assigned
unit independence, finite binary outcomes, exact metric versions and horizon,
unique receipt/observation identities, complete assignment/exposure/telemetry/join
integrity and interference/invariant admission. Every assigned unit must retain
all primary/guardrail/exploratory outcomes, including unexposed units. Missing
outcomes are not dropped. Failed integrity and material sample-ratio mismatch
invalidate analysis and withhold all effect estimates. Incomplete sample policy,
emergency safety stop and cancellation withhold confirmatory inference. No early
efficacy stop is supported.

SRM uses the exact two-sided binomial probability-ordering test at the registered
allocation ratio. Clopper-Pearson arm bounds invert exact binomial tails using a
mode-centered recurrence and bounded bisection; zero/all-success endpoints remain
honest. Primary and guardrails share a conservative Bonferroni family. Differencing
treatment/control arm bounds yields simultaneous conservative effect intervals;
this is not a normal approximation or an asserted causal identification result.
PASS requires the registered meaningful primary benefit and exclusion of harm for
every guardrail. Detected harm or a primary threshold ruled out yields FAIL;
uncertain primary/guardrail bounds yield INCONCLUSIVE. Secondary metrics remain
exploratory rates/effects without confirmatory intervals. The numerical output's
`numericallyQualified` field states conditional arithmetic validity, never native
source authorization, ethical approval, causal confidence or Decision authority.

Eleven experiment tests and the existing scenario/forecast kernels pass together
(29 checks). Four experiment contract tests and existing scenario/forecast
contracts pass together (12). Server/shared TypeScript checks pass. Independent
SciPy 1.17.0 `stats.binomtest` / `stats.beta.ppf` vectors cover exact SRM and
Clopper-Pearson including n=4000 and zero/all-success tails; Python stdlib HMAC
vectors independently verify assignment labels. Sources and exact log/reference
hashes are recorded in `aw-v8-evidence/experiment-kernel-checkpoint.json`.
Fixtures are synthetic mathematical/software evidence, not collected operational
outcomes or hosted qualification. The entire V8 build remains in progress.

The native registry reuses company authorization, governance obligations,
company→Memory locking, analytical lineage and native metric ownership. Four
tenant-scoped tables retain the experiment root, immutable reasoned versions,
exact metric FK pins and separate human lifecycle receipts. CAS guards creation,
amendment, review, readiness and cancellation; an amendment before execution
resets review and leaves the prior version unchanged. Invariant definitions are
resolved to their exact published version at registration, not silently repinned
when a later version is published. Outcomes and pretreatment invariants are
distinct, with reserved invariant receipt keys.

Binary individual native protocols admit native ratios on the registered issue
or project unit. Denominators must cover every canonical status and match the
registered company/project scope. A filtered denominator could remove failures
or unexposed units and therefore is rejected. Native metrics retain their actual
`created_in_window_current_state` semantics; a registry pin neither reconstructs
historical status nor proves that a future outcome was measured. Readiness must
precede the registered horizon, and that horizon must end before current source
and governance review expiry. Human power rationale remains a declaration.

The existing analytical purpose authorizes advisory business objects with no
personal impact. Live customer experiments, consent-dependent exposure and
material AI deployment changes therefore fail closed at registry admission;
ordinary analytical approval cannot substitute for their canonical governance
owners. Dark patterns and hidden employment manipulation are rejected by the
strict protocol. The receipt owner will separately admit execution: a READY
protocol alone cannot transition to RUNNING at this checkpoint.

API routes are `/companies/:companyId/experiments`, `/:experimentId`,
`/:experimentId/versions` and `/:experimentId/transition`. Responses use no-store;
current account checks, strict query/body contracts and human authority precede
source access. Lists expose bounded current-authorized pages; detail returns five
recent authorized versions and at most 100 associated lifecycle receipts.
Source replacement retains historical protocol hashes with separate revalidation
metadata. New review requires current metric publication. Cancellation remains
available to an authorized human when rollout is disabled.

Migration 0403 requires immutable exact metric pins, native manifests and deferred
complete protocol/lifecycle ownership. Restore cannot omit source descendants or
append a lifecycle receipt without advancing its canonical owner. Native source
erasure, retention and company purge cascade through complete protocol prose and
lifecycle history, including rollout-off and paused-company erasure. Canonical
Decision source access and its issue/project lineage are inherited when declared.
No parallel governance, authorization, credential store or scheduler is added.

Registry qualification passes 76 native owner/kernel/OpenAPI/metric/scenario checks,
five strict public-contract checks, server/shared type checking, migration safety
and the native generated-schema snapshot assertion. Exact source/log hashes and
resolved failed attempts accompany `aw-v8-evidence/experiment-registry-checkpoint.json`.
The preceding integrated production build passes at exact commit `5927fe1`.
These local source qualifications do not qualify live exposure or the entire V8
release; the requested full build continues.
