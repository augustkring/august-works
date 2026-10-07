# Native business scenarios — numerical kernel checkpoint

This checkpoint supplies strict shared proposal/run contracts and a pure native
numerical kernel for brief section 23. It does not complete scenario planning:
the governed PostgreSQL owner, native API/UI, validated Automation Artifact
integration and current source-owner capture remain open. The kernel is not
mounted as a public endpoint and cannot authorize a source or execute a Decision.

Formula programs have at most 96 typed nodes and may reference only declared
inputs or earlier nodes. There is no JavaScript evaluation, LLM simulation,
network, filesystem, recursive program or ambient random source. Native Workflow
transform expressions were inspected: their runtime resolves/interpolates input
values, but does not provide numerical arithmetic. Existing canonical JSON/hash
utilities are reused. Future validated Automation Artifact calculations must use
their existing active-version, validation/security and execution runtime gates;
an unchecked artifact reference is deliberately not admitted in this checkpoint.

Dimensional inference preserves issue/project counts, people/customers, seconds
and distinct currencies. Addition, subtraction, minimum and maximum require
matching units. Multiplication/division combine dimensions and enforce a bounded
exponent budget. An output must declare the inferred unit. Unit declarations are
not source authority: the future owner must derive observed units from the exact
native metric definition and reject a relabeled issue count or currency mismatch.

Every human assumption declares a nominal value, ordered range, numeric type,
unit, owner, controllability, evidence, qualitative confidence and uncertainty
rationale. An evidence-supported label requires an actual declared input pin;
it remains a human assertion, not inferred calibration. One unchanged base case
is required. Other cases change assumptions inside their declared range, with
each change explicitly an intervention or hypothetical condition. Interventions
require controllability; external stress may vary an uncontrollable assumption
as a hypothetical condition. Neither kind overwrites an observed fact. Results
compare nominal outputs against the base, retain changed assumptions and show
human numerical constraint satisfaction separately from organizational feasibility.

Deterministic calculations do not silently propagate assumption ranges. Monte
Carlo requires justified named uniform, triangular or discrete distributions,
explicit independence rationale, 1,000–10,000 samples, and a unit-specific absolute
stability tolerance for every output. Support must stay inside the assumption
range; discrete probabilities must sum to one without silent normalization. Work
is capped at two million node evaluations. A retained unsigned 32-bit seed,
including zero, uses the versioned SHA-256 counter draw algorithm. Common draws
across cases preserve comparisons, while explicit changed assumptions are fixed.

Reported p10/median/p90 are conditional empirical model quantiles, not confidence
or prediction intervals. Coverage remains null and calibration is not asserted.
First/second half-sample differences in all three reported quantiles must satisfy
the human tolerance. Any instability marks the result inconclusive and withholds
all simulated ranges while retaining nominal arithmetic and stability diagnostics.
Any division by zero, overflow or unsafe simulated draw invalidates the whole
calculation; failed draws are not discarded and replaced with a biased success.
Non-modeled effects remain explicit. Results cannot adopt a target, authorize a
budget, select a Decision option or dispatch work.

Public run contracts accept only expected revision, exact version UUID and seed.
Copied values, hashes, output JSON, provider claims and execution instructions are
rejected. The internal capture contract checks exact identities, selected forecast
point, units, finite values, hashes and complete input coverage, but this is a
numerical integrity check rather than source permission or retention admission.

Nine native kernel checks and four strict shared-contract checks passed. They
exercise base/intervention/stress arithmetic, unit mismatch/cycles, capture pins,
legitimate zero/seed replay, case-order invariance, distribution behavior,
stability abstention, failed sample retention policy, overflow and numerical work
bounds. Tests use explicit synthetic assumptions and internal captures; they do
not qualify an operational dataset, source-owner integration or hosted release.
The earlier integrated production build passed at `6426631f2827c82213341d037a9aa1b67d7f91df`;
it does not qualify this subsequent scenario source. Its log-hashed record is in
`aw-v8-evidence/native-build-6426631.json`. The whole V8 build remains in progress.
