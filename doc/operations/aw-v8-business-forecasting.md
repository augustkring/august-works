# Native business forecasting — kernel and governed owner checkpoint

This source checkpoint implements the deterministic native kernel, strict shared
specification, governed company API/storage owner and native operator UI. It does not complete brief
section 22: provider/run lifecycle extensions, advanced providers, downstream evidence pins and hosted
acceptance remain open. The native metric owner authorizes every captured
observation; public forecast inputs cannot supply copied measurement facts.

Native models are last-value, explicitly periodic seasonal naive, a fixed moving
average and simple drift. Daily/weekly UTC series must have consecutive exact
windows, consistent pinned metric versions/units, unique observation identities,
finite observed values and capture within the human-declared latency. Late,
missing, reordered, stale or unavailable history abstains without imputation.
Older observations must still be retained and admitted by their metric owner;
a short metric freshness policy cannot silently become long-lived forecast data.

Rolling-origin folds retain their exact training/test observation identities.
Training availability is checked against the test window, with an explicit gap
and no random shuffle. Drift/seasonal offsets account for that gap. Production
points begin at a whole future window after the cutoff; the partially elapsed
window is not disguised as future. Fold MASE scales use training differences
only. MAE, bias, WAPE, MASE and per-horizon errors stay separate. Zero actual and
naive-scale denominators are explicit nulls, not fabricated perfect scores.

The declared candidate must meet the human loss limit; a more complex candidate
must improve on last-value even when the human minimum improvement is zero.
Every baseline comparison remains available. Kernel `qualified` means only that
these mathematical policies passed for its internal input; it cannot certify
source authorization, provider execution, API selection, deployment or V8 release.
Points carry `interval: null` and uncertainty explicitly unavailable. No 95% band,
causal effect, automatic target/budget/roadmap mutation or employee score follows.

The eight pure-kernel checks cover deterministic models, genuine temporal
splits, future-value noninterference, fold scale safety, missing/late/invalid data,
zero denominators, complexity ties, overflow and cutoff/freshness abstention.
Server/UI type checking passed for the initial source; verification logs are
under `/var/tmp/aw-v8-business-forecast-*`.

Still open: asynchronous provider/run lifecycle extensions, advanced provider seams/qualification,
Decision/Scenario evidence and integrated/hosted acceptance. StatsForecast has
not been installed or qualified; no external runtime or provider claim is made.
V5 task/project schedule forecasts retain their native authority.

## Native owner storage and public API checkpoint

The native owner now implements `business-forecasts` company routes for draft
creation, immutable revision, inline bounded backtest, separate human publication,
run, artifact reads and retirement. These are business metric forecasts; the V5
schedule forecast owner remains separate. Shared inputs accept native observation
UUIDs, an expected revision and cutoff; values, source hashes, timestamps copied
from measurements, result JSON and claimed qualification are not caller inputs.

Migration 0399 stores specifications, immutable versions, source-owned backtests,
human publication receipts and immutable runs. PostgreSQL rejects bare publication
pointers, version/result changes, unsupported root revisions, inconsistent native
measurement pins and qualified artifacts outside chronology/value-domain policy.
The service reauthorizes every retained measurement through the metric owner,
requires publication of its exact definition before measurement capture, preserves
source lineage and sensitivity, and uses the explicit `forecast` company-purpose
capability. Ordinary metric permission does not approve forecasting. Predictions
outside the native count/ratio domain abstain rather than silently clipping.

A retained result preserves its historical arithmetic. New observations,
corrections, a changed published metric definition, retirement or a superseded
run publication expose a revalidation status. Publishing requires the current
exact proposed version and a surviving qualified backtest; a changed series
requires a new human-reviewed version/backtest/publication. A run does not update
a target, budget, roadmap or Decision. No asynchronous worker or second scheduler
has been introduced in this bounded native wave.

Definition and artifact lineage inherit native source erasure and retention;
expired or forgotten source manifests cascade through publications and published
roots even with rollout disabled or the company paused. Company purge explicitly
deletes the forecast aggregate through its native owner before the generic FK
planner. Human retirement remains available after rollout rollback under current
native permissions. Audit details retain identities, hashes, revisions and status;
publication rationale lives in its source-owned immutable receipt.

Positive PostgreSQL histories are explicitly synthetic, chronologically coherent
fixtures for contract/ownership tests. Real native queries captured today for old
windows abstain as late history. These tests do not qualify an operational dataset,
external provider, hosted runtime or release. Advanced provider/lifecycle
qualification, Decision/Scenario pins and hosted acceptance remain open.

Checkpoint validation: 57 integrated server checks passed across forecast ownership,
native forecasting arithmetic, the existing Metric owner and mounted OpenAPI
coverage; 11 forecast PostgreSQL checks passed again after final lineage/domain
and bounded-memory changes. Three strict public-contract checks, native migration
numbering/safety and generated-snapshot drift checks passed. Server type checking
passed for the final checkpoint. Logs are in `/var/tmp/aw-v8-business-forecast-*`.
Earlier test runs found an illegal async default parameter, a PL/pgSQL name
collision and a wrong test-only erasure call; all were corrected and rerun. An
initial server package-script invocation stopped because its inherited Rust PATH
was missing; the final direct native compiler check passed. This checkpoint does
not qualify the later UI or still-open providers/downstream/hosted work.

## Native operator UI checkpoint

The `/business-forecasts` native route and sidebar entry use default-off V8/V7
prerequisites and current account/company boundaries. Proposal editing selects a
current native metric and separately approved forecast purpose, records model and
history/loss policy, and saves without publication or execution. Observation
selection loads bounded currently authorized native pages and sends UUID pins in
chronological order, with explicit UTC cutoff and expected revision. Copying
measurement values, hashes or claimed qualification through the form is impossible.

Backtests and runs reload through bounded native artifact lists after current
source reauthorization. Reads hide retained facts while pending, denied or expired.
Native Memory events and account changes clear unsaved proposals and selected
results. Human editing pauses parent refresh/focus replacement; background flag
polling does not discard drafts. A separate human rationale and exact qualified
backtest enable publication; stale math remains visibly historical. Runs and
retirement remain distinct controls. Presentation keeps uncertainty unavailable,
null scaled denominators explicit and all numeric comparisons separate.

Six actual React Query UI checks passed for proposal/publication separation, exact
pins and minute-precision UTC cutoff, stale qualification denial, pending/denied
fact hiding and Memory/account changes. Twenty-six backend/OpenAPI checks passed
for retained artifact lists and their owner boundaries. Server/UI type checking,
native token gates and the current Storybook build passed. Thirty-seven Chromium
checks passed across light/dark and 390/1200 px, including WCAG 2/2.1 AA, keyboard
provenance, page overflow, form constraints/history selection and an actual
31-second draft-preservation check. Mobile form and desktop result screenshots
were inspected. Synthetic stories are presentation evidence only; the official
maintainer visual baseline and hosted qualification remain unestablished. Logs
are under `/var/tmp/aw-v8-business-forecast-*`.

An initial pending-state test omitted React Query's render notification wait, and
one overloaded setup clicked before its control became ready. Bounded waits for
the actual controls corrected those test races; the final six checks passed.
