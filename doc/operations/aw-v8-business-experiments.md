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

### Native recording and source receipt checkpoint

The first recording mode is explicitly
`recording_only_human_attested_native_process`. It stores experiment records;
starting, assigning or attesting does not dispatch native work, change tasks or
projects, expose a customer or approve a deployment. Exposure provenance is human
attestation, with separate human-asserted applied time and native recorded time.
The registered native outcome semantics are current native status at a common
final capture for units created inside the registered window. Those statuses are
business-object proxies and inherit their metric definition's Goodhart limits.
They are not reconstructed historical endpoint states or verified business utility.

Protocol now explicitly pins this provenance/time contract and the exact Fisher
pretreatment invariant balance method/familywise threshold. Existing proposals
with the earlier incomplete protocol require an explicit amended version and
new review; old hashes or review receipts are not rewritten. Horizon and asserted
exposure times use the native metric's millisecond precision. Analysis continues
to use the registered fixed horizon; public outcome capture/analysis and operator
UI follow the recording checkpoint.

Migration 0404 introduces immutable recording, subject assignment, exposure and
stopping receipts; 0405 strengthens mandatory subject FKs, exact signature-prefix
checks and tenant-composite readiness FKs. Recording binds the exact current human
readiness receipt. Only one recording is admitted per company while running or
paused; this conservative gate does not prove absence of external interference.
Completion records a separate human concurrent-change review. Pause/resume,
explicit emergency stopping, elapsed fixed-horizon completion and cancellation
retain their native lifecycle receipts. No early efficacy stopping is admitted.

The existing protected instance signing owner supplies a domain-separated HMAC
allocation key; the runtime does not add a credential registry or accept public
seeds/arms. Signed receipt hashes bind exact identities, definition, readiness,
source frame and upstream receipts. Every assigned unit is retained, including
not-applied exposure. Retries return the same allocation and identical exposure
receipt; conflicting exposure revisions are rejected. Actual native ratio
calculation captures each unit's pretreatment binary invariant before its label
is produced. These are experiment receipts, not relabeled company-population
`business_metric_observations`. Seventeen independent SciPy Fisher reference
vectors qualify the bounded diagnostic, including empty/constant and n=4000
populations. The diagnostic does not establish that all confounders are observed.

Registry, receipt and downstream consumers reauthorize every enrolled source
before returning protocol or receipt data. Recorded and current project ancestry
are checked separately. Complete version-policy/metric plus enrolled source
lineage is required. Erasing one enrolled source erases its dependent protocol
and all recording descendants; a missing subject cannot silently improve an
intent-to-treat result. This path remains active with rollout disabled and company
paused. Native company purge clears the recording descendants. Signing-owner
rotation fails closed for retained receipt validation.

Recording API adds `/:experimentId/start`, `/assignments`, `/exposures`, `/stop`
and `/versions/:versionId/receipts` under the existing experiment prefix. Human
source authority, strict commands, expected account and no-store are preserved.
Private signing material/source snapshots are withheld from public receipt views.
Applied attestation cannot precede assignment, claim future time or pass registered
stopping/horizon; explicit not-applied receipts keep their assigned subjects.

## One final native analysis and advisory human interpretation

Migration 0406 adds immutable analysis, per-assignment/per-metric outcome and
human interpretation owners. `/analyze` accepts exact version/revision only;
callers cannot submit outcomes, arms, quality booleans or numerical conclusions.
Every enrolled source is authorized and held under native shared row locks before
one actual PostgreSQL capture time. Each primary/guardrail/exploratory outcome is
calculated by the existing native ratio engine on that exact unit. All subjects,
including explicitly not-applied exposure, remain in intention-to-treat.
Emergency stopping retains an inconclusive non-confirmatory analysis with no
invented future outcome receipts. Missing exposure logs or material/unknown human
concurrent-change review invalidate inference.

The explicit registered `finalCaptureMaxDelaySeconds` bounds the final-capture
window after horizon end to 1–86400 seconds. Late capture retains its actual
receipts but produces invalid evidence. A protocol lacking this field requires
an explicit amended version/new readiness review before recording. This does not
rewrite old hashes. Per-unit outcomes have genuine experiment receipt identities;
they are not claimed to be company-population metric observations. Common-time
capture is current native status after the horizon, never reconstructed status
at horizon end. Status proxies, eligibility and human attestation limitations
remain explicit in every result.

Registered Fisher exact pretreatment diagnostics use familywise threshold/K.
Imbalance withholds inference. The result retains exact SRM, sample policy,
conservative primary/guardrail intervals and exploratory distinction. Protected
native signatures bind original capture, completion and output. Every retained
read verifies signatures, complete original material and deterministic numerical
replay; it separately reauthorizes all sources. Current metric-publication changes
produce live revalidation metadata without replacing original result/hash.

Analysis advances completed → analyzing; it does not automatically produce a
human decision. `/interpret` binds the exact analysis/revision, explicit rationale,
limitations acknowledgment and advisory-only authority. Invalid evidence requires
abstention; a ship candidate requires the registered positive result and all
safety bounds. Interpretation advances to decided/inconclusive/invalid and
retains its own immutable human receipt. It dispatches no work, policy or native
Decision choice. Final-capture project ancestry inherits complete source lineage;
erasing it removes the whole dependent protocol, outcomes/result and human prose,
including with rollout off/company paused. Native company purge includes all
three owners. Deferred SQL proof prevents analysis-only lifecycle advances and
incomplete final outcome sets; ordinary receipt deletion/update is rejected.

Software qualification uses explicitly synthetic fixtures. A deliberately
balanced synthetic allocation frame tests the positive numerical path and a
parallel pretreatment-imbalanced frame tests abstention. Neither frame is a
collected business trial or evidence of actual intervention benefit. Operator UI,
Decision/Causal/Learning/Planning bridges and remaining V8 qualification follow.

## Native operator workbench and independent stopping access

`/business-experiments` uses native company/account context, experimental settings,
source APIs and controls. It exposes reasoned typed preregistration, exact current
native metric pickers, pretreatment invariants, explicit unstarted amendments,
human readiness, stable allocations, human applied/not-applied exposure, registered
pause/stop, one final capture and separate human interpretation. It accepts no
pasted measurement/result JSON or claimed source/causal qualification. Existing
native issue/project APIs supply authorized units; the owner independently proves
admission. Metric publication changes cannot silently rebind a retained proposal.

Hypothesis, primary benefit, every guardrail, exposed population and lifecycle stay
visible. Result cards show exact registered directions, meaningful/safety bounds,
arm populations/rates, differences in percentage points, conservative intervals
and explicit uncertainty. Human interpretation follows result inspection.
Quality gates/balance and source traceability are separately inspectable by
keyboard. Unknown counts after a numerical integrity gate are withheld rather
than displayed as measured zeros. Small diagnostic probabilities use scientific
notation instead of being rounded to zero.

Account verification, native retention expiry, source-read failure, receipt
identity mismatch or Memory access changes withhold dependent facts/control
surfaces. Memory changes clear unsaved source-dependent proposals and source
query namespaces. Native expected-user guards and CAS remain on every command.
Reviewing input pauses automatic root/receipt polling, preventing silent draft
replacement. Live source selectors still recheck their own authority.

Human stop authority remains available independently of rollout/source disclosure:
`GET /companies/:companyId/experiments/recording-controls` returns only bounded
active native control IDs, version, revision, company and state to the same human
administration authority that can stop them. It exposes no protocol, units,
measurements or exposure contents. Paused companies and disabled rollout can
still cancel an exact recording. The workbench route preserves this minimal
stopping surface when ordinary experiment functionality is disabled. Normal
sidebar discovery follows the feature flags.

Qualification includes 46 actual native owner/OpenAPI/contract checks, 29 operator
and forecast/scenario regression checks, type/token checks, compiled Storybook
and 52 Chromium keyboard/WCAG 2.2 AA/no-overflow checks across light/dark and 390/1200px.
Browser evidence uses cached explicitly synthetic presentation fixtures with API
access blocked; it does not qualify real source execution or collected trials.
The browser suite waits only for the native addon's explicit concurrent axe scan;
real violations fail. DOM selector helpers wait for the exact admitted option
before dispatch, preserving assertions under concurrent compilation. Screenshots
were visually inspected and record source/log hashes; no official visual baseline
is claimed. The `446349209` preceding analysis checkpoint production build passes.
Downstream Decision/Causal/Learning/Planning bridges and remaining V8 waves continue.


## Local complete-population volume qualification

Checkpoint `native-experiment-volume-checkpoint.json` qualifies the original reader on 4,000 enrolled native Task Sources and actual final analysis/replay on 8,000 outcome receipts (one primary and one guardrail metric). All enrolled units remain in intention-to-treat, including the explicit not-applied exposure fixtures. Actual preregistration/start, elapsed fixed horizon, current native final capture, original signed receipt checks, full kernel replay and migrated SQL completeness/immutability guards run. Each measured reader/capture/replay command satisfies its local less-than-30-second assertion, including transaction completion.

Bulk original-owner-signed assignments and not-applied reports are explicit software prerequisites; they do not constitute 4,000 performed enrollment commands, Human attestations in an operational trial, external provider execution, verified exposure, causal business impact or authenticated/hosted acceptance. The remaining seventeen-metric maximum family, cold-start/concurrent/hosted p95 and cross-provider conformance are unqualified. Batching changes transport and equivalent database comparisons only; every original Source and receipt is still checked, and no sampling/dropout or public result fallback exists.
