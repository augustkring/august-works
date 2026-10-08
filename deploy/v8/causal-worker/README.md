# Optional DoWhy numerical runtime

DoWhy 0.14 (MIT), Python 3.12.14 and all 48 binary distribution versions/hashes
are pinned in the original server assets. Preserve the complete license notices
inside those wheels when redistributing. Install a separate interpreter because
DoWhy's pinned SciPy requirements differ from the statistical forecast runtime:

```sh
python3.12 -m venv /opt/aw-causal-runtime
/opt/aw-causal-runtime/bin/pip install --only-binary=:all: --require-hashes \
  -r server/src/services/scripts/dowhy-requirements.lock
export PAPERCLIP_DOWHY_PYTHON=/opt/aw-causal-runtime/bin/python
pnpm exec vitest run server/src/__tests__/causal-dowhy-worker.integration.test.ts --maxWorkers=1
```

Configuration is absent by default. The numerical entry point executes in the
original native Linux sandbox, with a fresh filesystem/PID namespace, denied
network, read-only interpreter dependencies, cleared server environment, bounded
CPU/address space/files/process headroom/output and a maximum 15-second deadline.
Cancellation kills the process group, waits for closure and removes its private
workspace. There is no unsandboxed fallback or arbitrary notebook/graph/model
execution. The original statistical worker reuses this same transport with its
existing DTO, asset bundle hash and numerical validation unchanged.

The sole method identifies and estimates registered individual-randomization
binary assignment ITT using a fixed assignment-to-outcome graph and DoWhy
`backdoor.linear_regression`. Its input contains only anonymous sufficient counts
for the two arms (at least eight units each; at most 4000 total). Expanding these
counts inside the worker represents the binary frequency table; it does not
recover individual identities or imply additional measured covariates. The
point must agree with the native rate difference within 1e-9. The native
registered uncertainty interval remains required; this worker does not replace
it with a library interval or claim calibrated coverage.

Three fixed diagnostics run: random common cause, permuted placebo treatment,
and an 80% data subset. Each uses 16 simulations, one thread and an advancing
RandomState seeded with 1729. This avoids repeating the same subset in every
simulation while reproducing outputs across processes. Finite diagnostic
p-values below 0.05 report failed; other finite p-values report passed. Undefined
p-values on degenerate constant data report unknown. These are bounded library
diagnostics, not sufficient proof of causal truth, interference, external
validity, sensitivity or commercial impact. Sensitivity remains unknown.

Only the original causal owner can admit a registered design, current Source,
Human graph and assumption set, freeze a version, retain the native interval,
and determine conclusion wording. Numerical qualification uses public synthetic
software fixtures. It does not qualify customer trials, hosted availability,
observational adjustment, clustering, heterogeneous treatment effects or a
built container image. Public-owner integration is a separate checkpoint.

The original causal owner now offers the exact current software profile through
its account-bound, no-store operator metadata route when `causal_claims_v8`,
governance evidence and `causal_provider_dowhy_v8` are enabled. The original form
binds an explicit provider choice to the immutable Human model. Only the fixed
two-node assignment-to-outcome graph with an exact interpreted registered
experiment is eligible; observational questions retain the native abstention
path. Profile drift or unavailable runtime prevents new optional use.

Creating a model does not review or analyze it. The original separate Human
review, registered Source/design/assumption gates and exact native interval remain
mandatory. The original owner repeats Source/profile/expiry/cancellation checks
before retaining a signed result. Failed or unknown provider diagnostics retain
the registered numerical interval but withhold causal reliance as inconclusive.
Provider pins, native result hash and diagnostics form part of the original
signed run. Retained replay validates the native calculation plus those frozen
diagnostics without rerunning the tenant analysis. Fixed public profile/health checks
establish current qualification separately. Rollout rollback preserves authorized
historical facts as needing revalidation; Source erasure remains mandatory with
flags disabled and company paused. No Task, Decision choice or commitment is
changed by model creation/review/analysis.
