# V8 source ownership and analytical data surfaces

Date: 2026-10-06. Reconciliation base: master
`d550aa7ea5ad38b5209d79135cabaa227ab3f902`.
Status: partial native Events, governed Metrics, analytical lineage and metric
commitments are implemented. The corresponding owner/lifecycle boundaries and
remaining work are recorded in `doc/operations/aw-v8-business-events.md`,
`doc/operations/aw-v8-business-metrics.md` and
`doc/operations/aw-v8-metric-targets.md`. This register grants neither access nor
processing authority. Other V8 analytical domains and full lifecycle/release
qualification remain open.

## Canonical owners

| Domain | Existing owner | V8 boundary |
| --- | --- | --- |
| Foundation | documents/revisions and Foundation approval pointers | Read approved versions; links and evidence never approve truth |
| Goals | `server/src/routes/goals.ts`, canonical `goals` | Link metrics/targets; do not introduce another goal tree |
| Projects and Roadmap | `server/src/routes/projects.ts`, planning services | Typed strategic links and proposals; current owner applies commitments |
| Tasks | issues, native execution and work timeline | Project facts; preserve checkout, pause, status and source visibility |
| Decisions | `server/src/routes/decisions.ts`, `decisions` | Context/assumptions/reviews are sidecars; existing decide action remains authoritative |
| Events | activity log and domain receipts | Append-oriented analytical projection; never rewrite producers |
| Metrics from external systems | existing Connections and customer semantic source | Explicit authority mode; no fallback that replaces external truth |
| Readiness | `server/src/routes/readiness.ts` | Existing assessments require agent/action semantics; analytical data readiness needs an explicit compatible boundary |
| Learning | `server/src/routes/learning.ts`, native domain candidates | Analytical outcomes contribute evidence; existing reviewed proposals apply change |
| Governance | existing V7 use-case/obligation/control/evidence register | Extend purposes and sources; no parallel compliance store |
| Recurrence and communication | Routines and existing channel/task publication | Reuse schedules and current publication authority |
| Identity, access and privacy | existing memberships/action authorization/privacy services | Every read, aggregation, export and effect rechecks current access |

## Data-surface contract

Each implemented surface must bind company, purpose, accountable owner,
classification, authorized source versions, retention trigger/expiry, export
policy, source correction/deletion and restore suppression. References and stable
pseudonyms can remain personal data. No surface may inherit raw source access
because it is labelled analytical. No real customer data is used in local tests.

| Planned surface | Necessary data | Lifecycle and evidence required before admission |
| --- | --- | --- |
| Business events/object links | Source identity, activity, separate event/observation time, bounded typed attributes | Source reauthorization; correction lineage; source deletion, expiry, replay/restore denial; no message bodies or credentials |
| Metric definitions/versions/bindings | Explicit semantics, authority, grain, dimensions, unit/currency, provider pins | Published immutability; explicit new version and source-policy revalidation |
| Observations/query snapshots | Authorized aggregates and exact definition/input watermarks | Undefined value remains null; input invalidation, source erasure and bounded expiry |
| Targets/strategic links | Canonical goal/project references, commitments and review dates | Same-company integrity; owner authorization and source lifecycle |
| Analytical lineage | Source/transformation IDs, versions/hashes and consumer edges | Lineage grants no access; content-free erasure receipt; restored descendants remain suppressed |
| Process datasets/findings/exports | Authorized events, object relationships and readiness dimensions | No person scoring; incomplete data abstains; bounded retention/export with source erasure |
| Decision context/outcome reviews | Authorized evidence, frozen assumptions/criteria/expectations | Freeze at decision; separate process quality/outcome; correction and erasure across sidecars |
| Forecasts/backtests | Versioned aggregate series, cutoffs, folds, algorithm and baseline | No future leakage; reproducible input; invalidated inputs and expiring qualification |
| Scenario assumptions/results | Explicit typed equations, units, seed and input evidence | Conditional results; no implicit commitment; source-policy propagation |
| Experiment protocol/assignment/exposure/results | Preregistered metrics/population/rules, minimal assignment IDs | Purpose/people impact approval where applicable; scoped exposure; withdrawal, retention and source deletion |
| Causal analyses | Estimand, population, graph, identification/assumptions and diagnostics | Sensitive segment exclusion; non-identification/abstention; restricted export and source lifecycle |
| Planning proposals | Constraints, input versions, feasibility and Pareto alternatives | Proposal only; stale/current owner check before canonical application |
| Executive review packets | As-of snapshot, cited claims, concise agenda and canonical action links | Snapshot access recheck, source invalidation, bounded expiry; no automatic external publication |
| Optional provider operations | Minimal immutable input, pinned artifact and resource/region policy | Qualification before dispatch; no ambient DB/network; deletion receipts and vendor exit tests |

Implementation must make these policies executable. A checked document, schema or
fixture is insufficient evidence of deployed deletion, provider isolation or legal
applicability. Material processing is registered through existing V7 governance.

The supplied Privacy playbook has been read in full. It treats secondary use,
derived data, exports, telemetry, backups and restore as separate lifecycle
surfaces. All 36 supplied playbooks and the full build brief have been read; individual
source hashes and reading completion are retained in the corpus inventory.

## Predecessor limits

V6's evidence matrix retains live cloud, PostgreSQL roles/CA, S3, billing, email,
host isolation, recovery, cost, domain and customer-journey acceptance gaps.
V7's pilot-readiness register retains physical native OpenShell enforcement,
per-use workload credential/executable/secret-version enforcement and forced
pre-spend transport for general managed sessions. Local text-only fixtures do
not qualify those broader boundaries. All H6/H7 gates start open for V8 hosted
promotion until current environment-specific evidence establishes otherwise.
