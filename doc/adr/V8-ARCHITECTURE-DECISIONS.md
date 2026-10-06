# V8 architecture decisions

Date: 2026-10-06. Base: master `d550aa7ea5ad38b5209d79135cabaa227ab3f902`.
Scope: supplied Organizational Decision Intelligence, Process Intelligence and
Adaptive Management V8 V2 brief. Implementation and acceptance remain in progress.

## V8-001 — Analytical evidence does not authorize action

Foundation, Goals, Projects, Issues, Decisions, approvals, budgets, Workflows,
Memory and Learning keep their current owners. V8 stores definitions and derived
evidence; application of a recommendation uses the canonical owner and rechecks
current authority. No second Decision, project, learning, scheduler or auth store.

## V8-002 — PostgreSQL and native deterministic analysis first

Use the existing database and job infrastructure. No warehouse, broker, graph DB
or compulsory analytics dependency. Native bounded arithmetic, process analysis,
forecast baselines, scenario equations and constraint validation precede optional
providers. LLM explanation cannot invent numeric, statistical or causal results.

## V8-003 — Versioned semantics and lineage

Published definitions and analytical results retain exact versions, input hashes,
source watermarks and algorithm identities. Targets, observations, forecasts and
scenarios remain distinct. Definition or source changes require explicit
revalidation. Lineage never grants access. Privacy erasure is the controlled
exception to payload retention and must prevent resurrection after restore.

## V8-004 — Fail closed on data and methodology

Materially incomplete process evidence yields DATA_NOT_READY. Undefined ratios
remain null. Forecast qualification uses rolling-origin evaluation and baseline
comparison. Experiment SRM, exposure loss and guardrail harm invalidate a winner
claim. Causal support requires identification and relevant robustness evidence;
association and non-identification remain legitimate results.

## V8-005 — Reuse governance and protect people

Extend V7's obligation/control register and quality/readiness infrastructure when
its semantics fit. Existing Readiness assessments require an agent and mandatory
action-class semantics; inspect that boundary before reusing it for analytical
data readiness. No worker ranking, emotion/trait inference, inferred productivity
allocation or person-level sensitive segmentation in default V8.

## V8-006 — Configuration, qualification and release evidence are separate

Twenty-one V8 flags are reserved default-off in the existing settings/catalog.
Dependencies are checked after managed overlays and inside the existing atomic
settings-write transaction. Enabling a flag does not qualify a provider, prove
implementation, clear a predecessor blocker or authorize an action.

R0 specified, R1 source verified, R2 staging qualified, R3 protected pilot,
R4 limited GA and R5 enterprise GA must remain separate. R2+ evidence is bound to
release/config/environment and cannot be earned by fixtures. Existing V6 hosting
gaps and V7 OpenShell, credential-broker and general pre-spend blockers remain open.

## V8-007 — Optional providers and interchange

Ossie, OCEL, CloudEvents and OpenLineage are versioned interchange boundaries.
MetricFlow/Cube, StatsForecast and DoWhy require explicit provider admission and
conformance before use. OR-Tools, EconML and organizational simulation remain
demand/evidence-triggered. Public PM4Py AGPL code is not embedded. Python workers
receive bounded immutable input, no ambient database credential, no arbitrary
network and explicit resource/cancellation policy.
