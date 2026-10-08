# Optional StatsForecast numerical runtime

The existing native forecast owner remains the authority for current company,
Human grants, metric/purpose/observation pins, retention, qualification and
publication. This worker receives only bounded numeric training prefixes,
rolling origins, explicitly declared gap/horizon and a fixed model choice. It
cannot query August Works, receive credentials or execute user Python/SQL.

StatsForecast 2.1.1 (Apache-2.0), Python 3.12.14 and 26 binary distributions are
pinned in the original server runtime assets. The lock admits only the recorded
Linux amd64 wheels and their SHA-256 hashes. Full transitive license notices
remain in those pinned distributions and must accompany redistribution. The
worker source, dependency manifest and their bundle hash are retained as
provider provenance. A version/shape/nonfinite/interval-integrity mismatch is a
closed provider, without diagnostic Source values in application logs.

For the original qualified Linux sandbox lane, install an isolated interpreter:

```sh
python3.12 -m venv /opt/aw-statistical-runtime
/opt/aw-statistical-runtime/bin/pip install --only-binary=:all: --require-hashes \
  -r server/src/services/scripts/statsforecast-requirements.lock
export PAPERCLIP_STATSFORECAST_PYTHON=/opt/aw-statistical-runtime/bin/python
pnpm exec vitest run server/src/__tests__/business-forecasting-statistical-worker.integration.test.ts --maxWorkers=1
```

Configuration is server-side and absent by default. The shared native sandbox
mounts the interpreter/dependencies read-only, starts a fresh filesystem and PID
namespace with network denied, clears inherited environment, and supplies only
fixed locale/thread limits. Native resource limits bound CPU, address space,
files, process headroom and output. Deadline/cancellation kills the process tree,
waits for closure and removes the private workspace. There is no unsandboxed
fallback. The default maximum worker wall time is 15 seconds; models that cannot
finish in the declared envelope remain unavailable/inconclusive.

The Dockerfile pins the published Python image index and installs the same
hashed wheels. Build from the repository root for Linux amd64. Running that image
uses explicit read-only asset modes, so a restrictive checkout/build umask cannot
make the fixed worker or dependency manifest unreadable by UID 65532. Running it
requires a read-only root, no network or credentials, an ephemeral private tmpfs,
a non-root identity and explicit memory/CPU/PID/output/deadline limits. The image
is an optional packaging path, not a runtime qualification claim. Record and
qualify the **built** image digest before deployment; the published Python base
index alone does not prove that image was built, run or hosted.

AutoETS and AutoARIMA complete the current numerical conformance fixtures.
AutoTheta is evaluated but remains unqualified: pinned 2.1.1 reports an interval
that excludes its own point on the declared trend case. The native boundary
rejects that result and preserves the original values; it does not widen/round
intervals or substitute a model to manufacture conformance.

The numerical suite uses declared synthetic software fixtures. Baseline parity,
a synthetic trend improvement and time-safe folds do not establish performance
on a customer's real data, business impact, interval calibration or hosted
availability. Promotion through the original forecast owner requires explicit
backtesting, current Source admission and a separate Human publication.

The original operator route now exposes the current optional runtime profile only
when both governed forecasting and `forecast_provider_statsforecast_v8` are
explicitly enabled. The form binds that profile to the immutable forecast
version. Creating a version does not backtest, publish or run it. Select exact
retained native observations, inspect the rolling-origin baseline comparison,
then separately publish the exact qualified backtest before requesting a run.
Changed runtime pins require a new reviewed version. Disabling the optional
provider preserves authorized retained facts with needs-revalidation status;
new statistical use remains closed. Source erasure, expiry and Human retirement
remain with the original native owners. No external endpoint or credentials are
accepted by this numerical provider.
