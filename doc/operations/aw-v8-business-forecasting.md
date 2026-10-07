# Native business forecasting — mathematical kernel in progress

This first source wave is a deterministic kernel and strict shared specification,
not a selectable API/UI capability or completed brief section 22. The native
metric owner must assemble and authorize every captured observation before a
future owner invokes this kernel. No caller-supplied observation values are
accepted through an application forecast endpoint; that endpoint is not built yet.

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

Still open: native specification/publication/run/backtest ownership and storage,
source/privacy lifecycle, value-domain admission, provider seams/qualification,
operator UI, Decision/Scenario evidence and integrated/hosted acceptance.
StatsForecast has not been installed or qualified; no external runtime or provider
claim is made. V5 task/project schedule forecasts retain their native authority.
