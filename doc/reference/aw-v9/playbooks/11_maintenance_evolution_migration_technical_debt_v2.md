# 11 — Maintenance, Evolution, Migration & Technical Debt
## V2.0 — Research-Reviewed Golden Master

```yaml
document_id: SE-11
title: Maintenance, Evolution, Migration & Technical Debt
version: 2.0
status: REVIEWED
created: 2026-09-27
last_updated: 2026-09-27
last_reviewed: 2026-09-27
evidence_cutoff: 2026-09-27
canonical_language: English
artifact_type: domain_playbook
primary_archetype:
  - Operating
  - Execution
  - Decision
inherits:
  - Master Playbook Standard 2.0-RC1
  - Universal Software & AI Engineering Master Playbook 2.0
default_rigor: R3-CONTROLLED for material production change
critical_overlay: R4-CRITICAL for safety, severe security/privacy, irreversible state, regulated/high-financial-impact change
volatility: MODERATE
fast_moving_subdomains:
  - dependency security
  - vendor/platform support
  - public API ecosystems
  - AI-assisted maintenance tooling
review_triggers:
  - new ISO/IEEE maintenance/lifecycle edition
  - material platform/API deprecation practice change
  - major security/vulnerability-management guidance change
  - new evidence materially changing technical-debt or modernization guidance
  - field failure exposing a missing migration control
status_note: >
  V2 incorporates a dedicated falsification/freshness audit of V1. It is research-reviewed,
  but it has not yet completed representative non-author field execution and therefore is not VALIDATED.
```

---

# Executive standard

Software that matters will change.

The engineering objective is not to avoid change, maximize backward compatibility, eliminate all technical debt, or keep every system on the latest version. The objective is to **move a live socio-technical system from one acceptable state to another without losing required behavior, data integrity, security, privacy, operability, or future change capacity**.

The durable maintenance chain is:

```text
UNDERSTAND WHY CHANGE IS NEEDED
→ DISCOVER CURRENT REALITY
→ DEFINE PROTECTED INVARIANTS + CONTRACTS
→ CLASSIFY CONSEQUENCE / REVERSIBILITY
→ DESIGN VALID INTERMEDIATE STATES
→ ESTABLISH COMPATIBILITY / COEXISTENCE WHERE NEEDED
→ REHEARSE WITH REPRESENTATIVE STATE
→ MIGRATE IN BOUNDED, OBSERVABLE STEPS
→ VERIFY + RECONCILE
→ CUT OVER AUTHORITY
→ REMOVE TRANSITIONAL COMPLEXITY
→ DEPRECATE / RETIRE DELIBERATELY
→ LEARN AND UPDATE THE SYSTEM
```

The core rule is:

> **A safe change is a sequence of valid states, not a successful before/after diff.**

For every material phase, engineers should be able to answer:

- What must remain true?
- Which version/component is authoritative?
- Which consumers and writers may coexist?
- How do we detect divergence or harm?
- What action is safe if this phase fails?
- What becomes irreversible here?
- What evidence permits us to continue?
- What temporary mechanism must later be removed?

The standard deliberately rejects several popular absolutes:

- “zero downtime is always better”;
- “rollback is always safest”;
- “rewrites are always bad”;
- “rewrites remove technical debt”;
- “microservices are modernization”;
- “Semantic Versioning guarantees compatibility”;
- “always update dependencies immediately”;
- “never touch stable dependencies”;
- “technical debt is bad code”;
- “one score can rank all technical debt”;
- “green CI means a migration is safe”;
- “deprecation means removal”;
- “retirement means shutting down compute.”

---

# V2 research and falsification verdict

V1’s architecture survived, but the audit required material strengthening in four areas.

## 1. State and authority

V1 was too easy to read as “make the new version compatible, then switch.” V2 models:

- mixed-version coexistence;
- source-of-truth transitions;
- old/new writer combinations;
- partial migration;
- duplicate execution;
- late writes;
- interruption/restart;
- multiple irreversible boundaries.

## 2. Compatibility

V1 treated compatibility broadly but still too much like a property of a schema/API. V2 treats compatibility as a **relationship between specific producer/consumer/state versions under a stated use set**.

## 3. Recovery

V1 correctly warned that rollback can fail, but V2 makes this structural. Every material phase selects among:

- revert code/config;
- roll forward;
- restore/reconstruct state;
- compensate external effects;
- pause/drain while preserving the current valid state.

## 4. Evidence and false precision

V2 rejects:

- one technical-debt priority formula;
- universal deprecation windows;
- universal N/N-1 support rules;
- modernization-by-architecture-label;
- protocol-specific compatibility rules generalized to every system;
- tool success as migration correctness.

The result is stricter about **what must be protected** and more contextual about **how change is performed**.

---

# 1. Purpose, users and outcomes

## 1.1 Purpose

This playbook defines the engineering standard for long-lived software change.

It exists to make maintenance and evolution:

- correct enough for consequence;
- reversible where feasible;
- recoverable where reversal is impossible;
- compatible for the period compatibility has value;
- observable enough to detect harmful change;
- explicit about state and authority;
- economical over the lifecycle;
- capable of removing obsolete complexity rather than accumulating it forever.

## 1.2 Intended users

- software engineers;
- maintainers;
- architects;
- SRE/platform engineers;
- database/data engineers;
- security engineers;
- engineering/product leads;
- AI coding/maintenance agents under human/governance control;
- reviewers/auditors of material migrations.

## 1.3 Intended outcomes

A mature organization should be able to:

1. make routine change cheaply;
2. make high-risk change with proportionate assurance;
3. evolve interfaces without accidental consumer breakage;
4. migrate persistent state without silent loss/corruption;
5. modernize legacy systems without assuming a fashionable destination architecture;
6. update dependencies before support/security debt becomes unacceptable;
7. identify and manage technical debt by consequence;
8. remove deprecated paths rather than maintain them indefinitely;
9. retire systems without leaving data, identities, routes, jobs or attack surface behind.

---

# 2. How to use this playbook

Use this standard for a change when any of the following is true:

- production behavior changes;
- persistent state changes;
- an interface/contract changes;
- two software versions may coexist;
- a dependency/runtime/platform changes;
- a system is being refactored or modernized;
- a capability is deprecated or retired;
- technical debt is being accepted, prioritized or remediated.

For trivial M0/M1 work, use the principles and compact checklist.

For M2+ work, use the Safe Change Record and relevant Play.

For M3/M4 work, also use:

- Mixed-Version Safety Matrix;
- Irreversibility Ledger;
- migration/reconciliation specification;
- independent review;
- representative rehearsal;
- release/cutover gates;
- retained evidence.

This playbook does not override applicable law, contract, safety standards, security policy or specialist domain standards.

---

# 3. Scope and non-scope

## 3.1 In scope

### Maintenance
- corrective;
- adaptive;
- perfective;
- preventive.

### Evolution
- internal refactoring;
- architectural restructuring;
- data/storage evolution;
- contract/API evolution;
- event/schema evolution;
- configuration/policy change;
- dependency/runtime/platform evolution.

### Modernization
- stabilization;
- modularization;
- rehosting;
- replatforming;
- incremental displacement;
- commodity replacement;
- selective extraction;
- full replacement where justified.

### Migration
- database schema;
- data/backfill;
- storage/provider;
- API/SDK;
- messaging/events;
- auth/policy;
- infrastructure/configuration;
- runtime/language;
- vendor/service;
- model/provider where AI systems depend on versioned model behavior.

### Lifecycle closure
- deprecation;
- sunset;
- removal;
- archival;
- retirement;
- deletion/retention.

### Debt
- architectural;
- implementation;
- dependency;
- test;
- data;
- infrastructure;
- security/privacy;
- observability;
- operational;
- compatibility/deprecation;
- documentation/knowledge;
- AI/model/policy where applicable.

## 3.2 Out of scope

Detailed mechanics belong to specialist playbooks for:

- databases/data engineering;
- APIs/distributed systems;
- CI/CD/supply chain;
- security;
- privacy;
- SRE/reliability;
- cloud/IaC;
- language/runtime profiles;
- AI/agentic systems;
- safety/regulated overlays.

This playbook owns the cross-cutting evolution logic.

---

# 4. Normative language and evidence status

`MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` follow the house meanings inherited from the Master Playbook Standard.

A requirement word is not an evidence-strength label.

This playbook uses the engineering master’s evidence lanes:

- `E0` binding law/contract;
- `E1` formal technical standard;
- `E2` systematic/meta research;
- `E3` primary empirical research;
- `E4` government/open consensus framework/specification;
- `E5` mature operational evidence;
- `E6` official technology semantics;
- `E7` repeated practitioner pattern;
- `E8` folklore/opinion.

Practitioner patterns such as Strangler Fig and Parallel Change are useful mechanisms, not universal mandates.

---

# 5. Terminology

## 5.1 Maintenance

Modification of a software product/system to correct, adapt, improve or prevent future problems. ISO/IEC/IEEE 14764:2022 is the primary formal maintenance reference in this playbook [MNT01].

## 5.2 Evolution

Change to software, interfaces, state, architecture, dependencies or environment across its useful life.

## 5.3 Refactoring

A change to internal structure intended to preserve the **protected external contract**.

Protected behavior is not identical to every historically observed behavior. Existing behavior should be classified as:

- specified/required;
- intentionally supported;
- tolerated legacy behavior;
- known defect;
- undefined;
- unknown.

A refactor SHOULD preserve the first two categories and explicitly decide the rest.

## 5.4 Legacy system

A system whose technical, operational or organizational constraints materially impede required outcomes or create material lifecycle risk.

Age, programming language or deployment topology alone do not make a system “legacy.”

## 5.5 Modernization

Deliberate change intended to improve current/future fitness for purpose.

Modernization does **not** mean:

- microservices;
- cloud;
- Kubernetes;
- serverless;
- a rewrite;
- a new programming language.

Those can be implementation choices.

## 5.6 Migration

Controlled movement between representations, versions, owners, environments or technologies.

A migration includes the intermediate states—not only source and target.

## 5.7 Compatibility

Ability of specific versions/actors to interact without unacceptable breakage under a stated contract and context.

## 5.8 Deprecation

Lifecycle signal that new use should stop and existing consumers should migrate away.

For HTTP, RFC 9745 explicitly separates deprecation from behavior change [API01].

## 5.9 Sunset

Planned point or criteria at which support/service ends or an interface is expected to become unavailable.

## 5.10 Removal

Technical deletion/disablement of a capability.

## 5.11 Retirement

Controlled closure of a system/component and its operational, identity, data, integration, support and evidence obligations.

## 5.12 Technical debt

A future cost/risk/option constraint created by a technical choice or unresolved condition.

Debt is not synonymous with:
- defect;
- bad style;
- old code;
- missing feature;
- unsupported vulnerability;
- any disliked design.

A condition can be both debt and defect/risk, but the concepts should remain distinguishable.

## 5.13 Transitional architecture

Temporary machinery required only to make a change safe, such as:

- adapters;
- compatibility shims;
- duplicate fields;
- old/new endpoints;
- migration routes;
- feature flags;
- dual readers;
- backfill jobs;
- shadow infrastructure.

Transitional architecture without an exit is permanent complexity by accident.

---

# 6. Evidence basis and source-status discipline

## 6.1 Formal anchors

### ISO/IEC/IEEE 14764:2022
Current published maintenance standard at cutoff. It details software maintenance and maintenance types [MNT01].

**Important edition note:** its published abstract grounds its maintenance detail in ISO/IEC/IEEE 12207:2017. ISO/IEC/IEEE 12207:2026 is now the current lifecycle standard. V2 therefore uses:
- `14764:2022` for detailed maintenance concepts;
- `12207:2026` for the current whole-lifecycle baseline.

It does not claim the two editions are textually synchronized.

### ISO/IEC/IEEE 12207:2026
Current published lifecycle standard. It includes development, operation, maintenance/support and retirement and explicitly does not require one lifecycle methodology [LIFE01].

### ISO/IEC 25010:2023
Current product-quality model used as a reference for maintainability and related quality impacts [QUAL01].

### IEEE 1012-2024
Active V&V standard; applies to developed, maintained and reused/legacy systems and scales V&V by integrity level [VV01].

## 6.2 Protocol/API anchors

- RFC 9745 — HTTP `Deprecation` response header, Standards Track [API01].
- RFC 8594 — HTTP `Sunset` response header, Informational [API02].
- Google AIP-180 — applied source/wire/semantic compatibility model [API03].
- OpenAPI 3.2.1 — current OAS at audit cutoff; supports deprecation metadata [API04].
- Protocol Buffers official compatibility rules — format-specific wire evolution [SCH01].
- Kubernetes deprecation policy — mature applied example of version overlap and deprecation [API05].
- SemVer 2.0.0 — version-signaling specification requiring a declared public API [VER01].

## 6.3 Operational anchors

- Google SRE Canarying Releases [OPS01];
- Google SRE configuration/on-call guidance on rollback limitations [OPS02];
- DORA current five software delivery performance metrics [OPS03];
- Google Cloud migration/data-transfer guidance as an applied example of copy/validate/sync/cutover/retire [DATA01].

## 6.4 Debt/modernization evidence

- SEI technical-debt practice [DEBT01];
- Lenarduzzi et al. systematic review of technical-debt prioritization [DEBT02];
- 2025 systematic literature review of software-to-microservices reengineering [MOD01];
- legacy service-identification systematic review [MOD02].

These sources support caution: modernization evidence is heterogeneous, and technical-debt prioritization lacks one validated universal formula.

## 6.5 Security/support anchors

- NIST SSDF 1.1 final baseline [SEC01];
- NIST SSDF 1.2 Initial Public Draft as a watch item, not final [SEC02];
- CISA Known Exploited Vulnerabilities catalog [SEC03];
- GitHub dependency review/Dependabot as tooling examples [DEP01].

## 6.6 Regulatory overlay example

The EU Cyber Resilience Act can make lifecycle support, vulnerability handling and support-period communication legally significant for in-scope products. Reporting obligations began 11 September 2026; broader CRA application is phased [REG01][REG02].

This is a **conditional jurisdictional overlay**, not a universal software-maintenance rule.

---

# 7. The Golden Maintenance & Evolution Standards

1. **Treat every material change as a sequence of states, not a before/after diff.**
2. **Define the intended outcome and the unacceptable failure before selecting a migration technique.**
3. **Identify protected invariants before modifying implementation or state.**
4. **Make source-of-truth and write authority explicit in every migration phase.**
5. **Classify consequence, exposure, irreversibility, uncertainty and blast radius before choosing assurance depth.**
6. **Prefer the smallest coherent change that preserves the relevant invariant.**
7. **Do not split one atomic correctness property into independently unsafe partial releases.**
8. **Establish observability before changing an opaque high-risk system.**
9. **Discover actual consumers and dependencies; documentation alone is not evidence of absence.**
10. **Define compatibility by consumer/version/dimension, not by a generic “backward compatible” label.**
11. **Design and test mixed-version states when rolling coexistence can occur.**
12. **Prefer additive/compatible expansion while consumers still require the old contract.**
13. **Use expand → migrate → contract as a strong default when coexistence reduces risk—not as a universal ritual.**
14. **Allow bounded planned downtime when it produces lower total risk than complex online coexistence.**
15. **Treat transitional architecture as temporary inventory with owner and removal criteria.**
16. **Never assume rollback; prove that old code can safely interpret current state and effects.**
17. **Prepare roll-forward, restore/reconstruction or compensation when rollback can become invalid.**
18. **Record irreversible boundaries before crossing them.**
19. **A migration is not complete until state is reconciled and old authority is intentionally removed.**
20. **A backfill process exiting successfully is not evidence that data is correct.**
21. **Avoid independent dual writes where one authoritative path or transactional propagation can satisfy the requirement.**
22. **If dual writes are unavoidable, define partial-failure, divergence, replay and reconciliation semantics.**
23. **Refactoring preserves protected behavior, not every historical accident.**
24. **Characterization tests describe current behavior; they do not automatically define desired behavior.**
25. **Modernization begins with a hard outcome/constraint, not an architecture label.**
26. **Microservices, cloud, serverless and rewrites are implementation options, not modernization success criteria.**
27. **Prefer incremental displacement when safe seams/state ownership exist and incremental value matters.**
28. **A rewrite is legitimate only when its migration and semantic-recovery risk are justified against incremental alternatives.**
29. **Compatibility may be intentionally broken when indefinite compatibility creates unacceptable security, safety, cost or complexity.**
30. **Version numbers communicate compatibility intent only when a public contract is defined and enforced.**
31. **Follow the actual serialization/protocol compatibility semantics; do not generalize Protobuf/JSON/SQL rules across formats.**
32. **Dependencies create future security, support, upgrade and exit obligations.**
33. **Pin/lock for reproducibility where appropriate, then monitor and deliberately update.**
34. **Do not make “latest” or “never update” the dependency policy.**
35. **Known exploitation, exposure and support state can justify accelerated upgrade action.**
36. **Automation may propose or execute low-risk upgrades under policy; green CI alone does not authorize high-impact upgrades.**
37. **Technical debt must be expressed as future consequence or option loss, not aesthetic dislike.**
38. **Do not pretend one universal numeric technical-debt score is evidence-based.**
39. **Intentional debt needs an owner, consequence, trigger/revisit condition and protected invariants.**
40. **Deprecation is a lifecycle program: replacement, migration, communication, support, telemetry/evidence and removal.**
41. **Deprecation does not itself mean a behavior change or shutdown.**
42. **A deprecation window has no universal correct duration; use consumer control, commitments, risk and migration cost.**
43. **Security/safety/legal constraints may justify an emergency compatibility break with explicit authority and communication.**
44. **Retirement includes data, identities, credentials, integrations, routes, jobs, monitoring, billing, archives and support obligations.**
45. **Retirement is incomplete while zombie resources or legitimate dependents remain.**
46. **Retention and deletion obligations must be resolved before data is archived or destroyed.**
47. **Measure maintenance by change outcomes and lifecycle health, not number of refactors/upgrades/tickets.**
48. **AI-generated refactors, migrations, SQL, configs and dependency advice are untrusted until independently verified.**
49. **Authorization for agentic maintenance actions must live outside model persuasion.**
50. **The final success criterion is a simpler, supported, correctly owned system—not a successful migration project ceremony.**

---

# 8. Change risk and assurance model

## 8.1 House change classes

This classification is a `HOUSE` routing model.

| Class | Typical condition | Examples | Default assurance |
|---|---|---|---|
| **M0 — Experimental** | no material users/state; disposable | prototype migration spike | local verification |
| **M1 — Reversible local** | internal, no material persistent-state incompatibility | refactor, additive internal API | automated tests + review |
| **M2 — Live compatible** | production, persistent state or mixed versions, but additive/recoverable | new optional field, runtime patch | compatibility + staged evidence |
| **M3 — Material migration** | breaking contract, large state move, multiple systems/teams | major API migration, DB rewrite, platform move | controlled plan, independent review, rehearsal, recovery |
| **M4 — Critical / irreversible** | destructive, safety/security/privacy/financial/regulatory high consequence | irreversible ledger/key/state migration | specialist assurance, formal approval, strong traceability |

## 8.2 Risk dimensions

Assess:

```yaml
user_business_impact:
data_integrity:
security:
privacy:
safety:
financial:
regulatory_contractual:
consumer_count_and_control:
state_volume:
mixed_version_duration:
reversibility:
external_side_effects:
blast_radius:
detectability:
novelty:
operational_complexity:
dependency_uncertainty:
automation_autonomy:
```

## 8.3 Escalation rule

When a change appears “simple” but:

- persistent state is irreversibly transformed;
- consumers are unknown;
- rollback is uncertain;
- authorization/security semantics change;
- the blast radius is large;

escalate the assurance class.

---

# 9. Safe-change invariants

Every M2+ change SHOULD define protected invariants.

Examples:

```text
No valid order loses its payment linkage.
No user loses authorization they should retain.
No unauthorized principal gains a capability.
Every migrated record has exactly one authoritative representation after cutover.
Old and new supported clients receive semantically equivalent outcomes within the stated compatibility window.
No destructive contraction occurs while supported readers/writers still depend on the old representation.
```

## 9.1 Phase invariant test

For each phase ask:

1. Is the state valid?
2. Is exactly one authoritative truth known?
3. Are allowed readers/writers known?
4. Can failure be detected?
5. Is there a safe stop state?
6. Is the chosen recovery mode still valid?
7. Has a new irreversible boundary been crossed?

If the answer is unknown for a high-consequence invariant, the phase is not ready.

---

# 10. The Safe Change Control Plane

For M2+ changes, create a `Safe Change Record`.

```yaml
change_id:
owner:
decision_owner:
systems:
change_class: M0 | M1 | M2 | M3 | M4

outcome:
reason_now:
non_goals:

protected_invariants:
  - ...

current_state:
target_state:

consumers:
writers:
readers:
dependencies:

compatibility_dimensions:
mixed_version_states:

data_scope:
source_of_truth_by_phase:

migration_phases:
  - phase:
    preconditions:
    authority:
    allowed_versions:
    actions:
    expected_state:
    verification:
    stop_conditions:
    recovery_modes:
    irreversible_events:

reconciliation:
cleanup:
deprecation:
retirement:

monitoring:
approvals:
exceptions:
evidence:
```

The record MAY be split across ADR, deployment manifest, migration plan and runbook. The information must be recoverable.

---

# 11. Current-state discovery and software archaeology

Do not transform what you do not understand enough to bound.

## 11.1 Discover

For material legacy/change work:

- business capabilities;
- user journeys;
- current owners;
- runtime topology;
- data stores;
- sources of truth;
- all writers;
- all readers;
- APIs/SDKs;
- events/queues/topics;
- scheduled jobs;
- webhooks;
- file exchanges;
- manual operator actions;
- auth identities/policies;
- external vendors;
- build/release path;
- backups/recovery;
- telemetry;
- cost drivers;
- support/EOL state;
- known incident history.

## 11.2 Evidence sources

Use:

- source/config repositories;
- runtime inventory;
- service catalog;
- logs/traces/metrics;
- network/API traffic;
- schema registries;
- database query/access logs where safe;
- dependency graph/SBOM;
- CI/CD config;
- cloud/IAM inventory;
- customer/partner contracts;
- operators and domain experts.

## 11.3 Unknown consumer rule

Absence from source search is not proof that no consumer exists.

For externally reachable/long-lived interfaces, combine documentation with runtime/contract evidence where feasible.

If consumers cannot be enumerated, the breaking-change risk remains visible and the decision owner must accept it.

---

# 12. Behavior and contract archaeology

Before refactoring/replacing poorly specified software, classify observed behavior:

| Category | Meaning | Default action |
|---|---|---|
| Required | stated business/system invariant | preserve/test |
| Supported | intentional public/operational contract | preserve or formally migrate |
| Tolerated | relied upon but not desired | decide migration/deprecation |
| Defect | wrong/harmful behavior | do not preserve by accident |
| Undefined | no guarantee | avoid creating new reliance |
| Unknown | cannot classify yet | investigate if consequential |

Characterization tests are especially useful for finding what the system actually does, but they MUST NOT silently elevate every output to “required.”

---

# 13. Refactoring standard

## 13.1 Objective

Improve internal structure/changeability while preserving the protected contract.

## 13.2 Good triggers

- recurring change friction;
- duplicated domain knowledge;
- unsafe coupling;
- architecture boundary erosion;
- testability blockage;
- security/privacy boundary weakness;
- repeated incidents caused by structure;
- difficult dependency replacement;
- high-cost onboarding/comprehension.

“Code looks ugly” is not enough for high-cost refactoring.

## 13.3 Safety preconditions

For a material refactor:

- protected behavior/invariants identified;
- baseline tests or alternate evidence exist;
- externally observable behavior changes are separated or declared;
- architecture/security constraints are known;
- performance/resource behavior included if contract-relevant;
- change can be integrated in bounded steps where feasible.

## 13.4 Execution rules

Prefer:

- automated compiler/IDE refactors for mechanical changes;
- small semantics-preserving steps;
- narrow seams around volatile dependencies;
- high-cohesion boundaries;
- stable contract tests;
- static architecture rules where dependency direction matters;
- differential tests where old/new implementations can be compared;
- temporary branch-by-abstraction only when it reduces change surface.

## 13.5 Long-running refactor

For a multi-release refactor:

```yaml
target_constraint:
protected_contract:
migration_seam:
old_path:
new_path:
routing_or_selection:
progress_metric:
compatibility:
cleanup_trigger:
owner:
```

Do not leave both implementations active indefinitely without a reason.

## 13.6 Completion

Refactoring is complete when:

- protected behavior passes;
- obsolete structure/path is removed or intentionally retained;
- temporary adapters/flags are cleaned;
- operational/docs/ownership model matches reality;
- future change friction or risk is measurably/credibly improved.

---

# 14. Legacy modernization standard

## 14.1 Modernization is a portfolio decision

Possible actions:

1. **retain** — current system remains fit;
2. **stabilize** — reduce incidents/observability/backup/security gaps first;
3. **remediate** — fix bounded hotspots/debt;
4. **refactor/modularize** — improve internal boundaries;
5. **upgrade** — runtime/platform/dependency;
6. **rehost** — move environment with minimal application change;
7. **replatform** — move to a different managed/runtime platform;
8. **replace commodity capability** — buy/managed/OSS;
9. **extract a capability** — separate one justified boundary;
10. **incrementally displace** — route slices to new implementation;
11. **full replacement/rewrite** — build a new system and migrate;
12. **retire** — remove capability entirely.

None is inherently more modern.

## 14.2 Modernization brief

```yaml
business_or_system_outcome:
hard_constraints:
current_failure_modes:
change_friction:
support_risk:
security_privacy_risk:
cost:
current_semantics_known:
state_migration_complexity:
consumer_control:
coexistence_feasible:
organizational_constraints:
options:
decision:
evidence:
revisit_trigger:
```

## 14.3 Anti-target rule

The objective MUST NOT be phrased only as:

- “move to microservices”;
- “move to cloud”;
- “rewrite in Rust/Go/Java/...”;
- “move to Kubernetes”;
- “be serverless”;
- “be event-driven.”

State which material quality/outcome the option is expected to improve.

## 14.4 Incremental displacement / Strangler-Fig-style change

Useful when:

- a routing/seam boundary exists;
- capability slices can be isolated;
- old/new can coexist;
- source-of-truth can remain explicit;
- value can ship incrementally;
- traffic/work can be shifted and observed.

Risky when:

- transactions require atomic behavior across old/new;
- one fact has ambiguous ownership;
- event ordering becomes uncontrolled;
- side effects cannot be isolated;
- migration lasts so long that transitional complexity becomes permanent.

## 14.5 Rewrite gate

A rewrite becomes more defensible when:

- hard requirements cannot be met incrementally;
- foundational platform assumptions are invalid;
- security/safety constraints require replacement;
- data/contracts can be migrated with bounded risk;
- behavior can be rediscovered/validated;
- duplicate operation is affordable enough;
- organization can maintain the new system after launch.

A rewrite does not erase risk. It exchanges known constraints for:

- semantic rediscovery;
- migration risk;
- hidden consumer risk;
- new defects;
- duplicate operations;
- cutover risk;
- new architecture debt.

## 14.6 Organizational modernization

If the old system became difficult because:

- ownership is fragmented;
- deployment is unsafe;
- tests are absent;
- teams cannot observe production;
- incentives favor local patches;
- knowledge is concentrated;

changing the technology alone may reproduce the same failure pattern.

---

# 15. Compatibility engineering

## 15.1 Compatibility is a matrix

For a material interface, define:

| Dimension | Examples of breakage |
|---|---|
| Source | old callsites no longer compile |
| Binary/ABI | linked binary fails with new library/runtime |
| Wire/protocol | parser/serializer incompatibility |
| Schema | field/type/constraint incompatibility |
| Stored state | old version cannot read new persisted form |
| Semantic | same field/status now means something different |
| Error | retry/error classification changes |
| Authorization | old assumption grants/denies wrong capability |
| Ordering | event/order guarantees change |
| Idempotency | duplicate behavior changes |
| Temporal | timeout/TTL/freshness timing changes |
| Performance/capacity | previously valid workloads now breach material limits |
| Operational | mixed versions cannot deploy/recover safely |
| Privacy/data lifecycle | new collection/retention semantics break expectations |
| Workflow/automation | scripts/agents rely on changed behavior |

Not every contract needs every row. Ask which dimensions matter.

## 15.2 Compatibility claim format

Bad:

> v2 is backwards compatible.

Better:

> Old v1 clients can call the v2 server using the documented v1 operation set; request/response wire shapes and semantic success/error behavior are preserved for supported operations. v2-only fields are optional to v1 clients. Performance is not guaranteed to match v1 beyond the published SLO.

## 15.3 Consumer-relative rule

Compatibility is evaluated against:

- supported consumer versions;
- supported usage;
- documented/accepted behavior;
- relevant time window.

A new server can be compatible with supported consumers while deliberately breaking unsupported/undefined use.

---

# 16. Mixed-Version Safety Matrix

Required for M3/M4 when mixed versions can exist; recommended for M2.

Example:

| Actor/state | Old server | New server | Allowed? | Evidence | Notes |
|---|---|---|---|---|---|
| Old client | yes | yes | required | contract tests | until sunset |
| New client | maybe | yes | explicit | compatibility tests | feature gate until all servers new |
| Old writer | old schema | expanded schema | required during phase 1 | integration test | no new-only state |
| New writer | old schema | expanded schema | conditional | state test | must write compat form until phase 3 |

Also test:

- retry after version change;
- stale cache;
- queued old messages delivered to new consumers;
- new events replayed to old consumers;
- rolling restarts;
- failed partial deployment.

Unsupported combinations MUST be explicit rather than accidental.

---

# 17. Change strategy selection

## 17.1 Online compatible migration

Use when:
- downtime cost is material;
- coexistence semantics are controllable;
- gradual evidence is valuable.

Costs:
- transitional complexity;
- mixed-version testing;
- longer migration period.

## 17.2 Planned maintenance / bounded offline cutover

Use when:
- downtime is acceptable;
- state must be quiescent;
- dual writes/coexistence would create more risk;
- cutover can be rehearsed and completed in a bounded window.

Costs:
- user unavailability;
- coordination;
- strict duration/recovery requirement.

**Zero downtime is a requirement only when the outcome requires it.**

## 17.3 Blue/green

Useful when environment-level cutover is easy and state remains compatible.

Not safe by itself when:
- database/schema is one-way;
- both environments mutate shared state incompatibly;
- external side effects cannot be reversed.

## 17.4 Canary/progressive exposure

Useful when:
- production traffic provides meaningful evidence;
- the canary population is representative enough;
- health signals can detect the failure;
- blast radius benefits from gradual exposure [OPS01].

Weak when:
- failures are rare/long-latency;
- data side effects affect everyone;
- canary/control share state in a contaminating way;
- signals cannot attribute problems.

## 17.5 Shadow / traffic mirroring

Useful for comparing old/new behavior without user-visible response changes.

Must:
- isolate or disable destructive side effects;
- protect sensitive data;
- account for doubled load/cost;
- define comparison oracle;
- avoid treating close output equality as proof of semantic equivalence.

---

# 18. Schema and API evolution

## 18.1 Strong default

Where consumers cannot update atomically:

```text
EXPAND
→ DEPLOY COMPATIBLE PRODUCERS/CONSUMERS
→ MIGRATE USAGE / DATA
→ OBSERVE
→ FREEZE OLD USE
→ CONTRACT
```

Parallel Change is a useful practitioner pattern for this purpose [PAT01].

## 18.2 When not to use a long compatibility phase

A long compatibility phase may be worse when:

- security requires removal;
- consumer set is fully controlled and deploys atomically;
- planned downtime is cheaper/safer;
- supporting both semantics creates dangerous ambiguity;
- temporary path materially increases integrity risk.

## 18.3 Versioning

Version only where it helps manage compatibility.

Semantic Versioning MAY be used where a public API is explicitly defined. SemVer’s own specification requires a declared public API [VER01].

Do not infer:

```text
PATCH → safe
MINOR → safe
MAJOR → necessarily breaking for every consumer
```

without verifying the actual dependency and contract.

## 18.4 HTTP deprecation

For HTTP resources, RFC 9745 MAY be used:

- `Deprecation` — communicates deprecation date/status;
- `Link` with deprecation relation — points to migration/deprecation documentation.

RFC 9745 explicitly says deprecation does not itself change resource behavior [API01].

RFC 8594 `Sunset` MAY communicate expected future unavailability [API02].

Product communication, migration tooling and support policy remain necessary.

## 18.5 OpenAPI metadata

OpenAPI’s `deprecated` metadata can make deprecation machine-discoverable [API04].

It does not define:
- consumer communication;
- support window;
- replacement quality;
- removal criteria;
- business contract.

---

# 19. Event and message schema evolution

## 19.1 Define producer/consumer horizon

For each schema:

```yaml
producer_versions:
consumer_versions:
stored_message_retention:
replay_horizon:
forward_compatibility_required:
backward_compatibility_required:
unknown_field_behavior:
defaults:
field_reuse_policy:
ordering:
deduplication:
```

## 19.2 Additive is not automatically semantic-compatible

Adding an optional field can still break consumers when:

- “unknown” and default value have different meaning;
- consumers reject unknown fields;
- message size exceeds limits;
- downstream logic assumes exhaustive enums;
- new state changes ordering/authorization semantics.

## 19.3 Format-specific rules

Use the official schema/wire rules of the actual technology.

Protocol Buffers documents safe/unsafe wire evolution and warns against tag/field misuse [SCH01].

Those rules MUST NOT be generalized to JSON, Avro, database rows or custom binary formats.

## 19.4 Replay compatibility

If events are retained/replayed:

- new consumers must handle historical messages;
- migration must consider old schema versions for the full relevant retention horizon;
- deleting a field definition does not delete historical data;
- privacy/retention obligations may affect immutable/event stores.

---

# 20. Database schema evolution

## 20.1 Default live pattern

```text
1. EXPAND SCHEMA
2. DEPLOY TOLERANT READERS/WRITERS
3. MIGRATE/BACKFILL
4. VERIFY / RECONCILE
5. SWITCH AUTHORITY
6. STOP OLD READERS/WRITERS
7. CONTRACT LATER
```

This is a default, not a mandate.

## 20.2 Database change preflight

Before material DDL/data change:

- enumerate application and non-application consumers;
- understand actual database/version semantics;
- estimate/measure lock and rewrite behavior;
- assess storage/temp-space/I/O impact;
- test representative data volume/skew;
- verify backup/restore or alternate recovery;
- define transaction/batch strategy;
- define timeout/cancellation;
- define stop threshold;
- confirm mixed-version application behavior;
- identify irreversible operation.

## 20.3 Destructive contraction

Before dropping/renaming/removing:

- old reads are absent or contractually unsupported;
- old writes are absent;
- relevant queues/jobs cannot reintroduce old form;
- backups/restore path are understood;
- rollback semantics are re-evaluated;
- final data reconciliation passed;
- deprecation/consumer obligations are satisfied.

## 20.4 Database migration tool rule

Migration frameworks provide execution/order tracking.

They do not prove:
- DDL is safe at production scale;
- data transformation is correct;
- rollback works;
- external consumers are migrated;
- no lock/capacity incident will occur.

---

# 21. Data migration and backfill engineering

## 21.1 Backfill contract

Every material backfill should define:

```yaml
population:
source:
target:
selection_query_or_rule:
transformation:
expected_count_or_range:
business_invariants:
checkpointing:
idempotency_or_deduplication:
batching:
rate_limit:
concurrency:
error_classification:
retry:
quarantine:
late_writes:
restart_behavior:
stop_conditions:
reconciliation:
cleanup:
```

## 21.2 Resumability

A restart after interruption MUST NOT:

- double-apply a non-idempotent effect;
- skip unknown work;
- silently reset progress;
- corrupt checkpoint ordering.

For very large migrations, checkpoint by durable monotonic/cursor semantics appropriate to the data model.

## 21.3 Rate control

Backfill load competes with production.

Monitor:
- DB/queue/storage saturation;
- lock duration;
- latency/error SLOs;
- replication lag;
- cache pressure;
- provider quotas;
- downstream side effects.

Rate limits SHOULD be adjustable without restarting the whole migration where practical.

## 21.4 Reconciliation

Completion is defined by reconciliation, not job status.

Use relevant evidence:

- expected vs actual population counts;
- per-segment counts;
- null/missing/duplicate counts;
- domain totals;
- referential integrity;
- checksums/hashes where meaningful;
- sampled record comparison;
- invariant queries;
- financial/ledger reconciliation;
- cross-system consistency;
- quarantine inventory = 0 or explicitly resolved.

## 21.5 Late writes and moving source

If the source continues changing:

Choose a strategy such as:
- stop writes for cutover;
- delta synchronization;
- change-data capture;
- authoritative write-through path;
- event replay;
- time-bounded dual-write with reconciliation.

The mechanism is contextual. The invariant is that no committed source change is silently lost.

---

# 22. Source-of-truth and authority migration

## 22.1 One fact, explicit authority

For every persistent fact during migration:

```yaml
fact_or_domain:
phase:
authoritative_store:
authoritative_writer:
secondary_copy:
read_priority:
conflict_rule:
repair_path:
```

## 22.2 Dual write

Default preference: avoid two independent authoritative writes.

If dual writes are required, define the failure matrix:

| Primary write | Secondary write | Required action |
|---|---|---|
| success | success | proceed |
| success | fail | queue/retry/repair; source remains explicit |
| fail | success | compensate/reject/repair according to authority |
| unknown | unknown | idempotent reconciliation before retry |

Never assume two network writes form one atomic transaction unless the actual system provides that guarantee.

## 22.3 Authority cutover

A cutover should have:

- preconditions;
- freeze/drain condition if required;
- exact authority switch;
- verification;
- rollback/roll-forward status after switch;
- communication;
- timestamp/version for audit.

---

# 23. Irreversibility Ledger

M3/M4 changes MUST record material irreversible events.

```markdown
| Event | Phase | Why irreversible | Consequence | Evidence before crossing | Recovery if wrong | Approver |
|---|---|---|---|---|---|---|
```

Examples:

- dropping old column/table;
- deleting source data;
- allowing new-only state;
- rotating/revoking a key old system requires;
- irreversible external transfer/message;
- destructive re-encryption;
- changing a public semantic contract;
- deleting customer export;
- canceling a vendor account with no recovery.

An irreversible step does not mean “do not do it.” It means assurance moves earlier.

---

# 24. Recovery architecture: rollback, roll-forward, restore, compensate

## 24.1 Revert code/config

Use when:
- state remains compatible;
- old artifact/config can safely resume;
- external side effects do not violate invariants.

## 24.2 Roll forward

Use when:
- state has crossed a new-only boundary;
- old code is unsafe;
- small corrective change is lower risk;
- rollback would recreate corruption.

## 24.3 Restore/reconstruct

Use when:
- persistent state must return to an earlier known-good state;
- backup/log/event replay supports it;
- RPO/RTO and downstream consistency are acceptable.

Restoring one database may not restore external side effects or dependent systems.

## 24.4 Compensate

Use when external side effects cannot literally be undone, but an explicit compensating action exists.

Examples:
- reverse/refund transaction;
- send corrective event;
- revoke permission;
- restore derived record.

Compensation is business logic, not equivalent to transactional rollback.

## 24.5 Pause/drain

Sometimes the safest failure response is:
- stop new work;
- drain current work;
- preserve current state;
- investigate;
- then decide forward/backward recovery.

---

# 25. Dependency and platform lifecycle

## 25.1 Dependency inventory

Treat as dependencies:

- direct libraries/packages;
- transitive packages;
- OS/base images;
- language/runtime;
- compiler/toolchain;
- database/queue/cache/search engines;
- CI actions/plugins;
- container images;
- cloud managed-service API versions;
- SDKs;
- SaaS integrations;
- auth/identity providers;
- model/provider versions in AI systems.

## 25.2 Lifecycle status

Track, where material:

```yaml
dependency:
owner:
current_version:
support_state:
eol_date:
security_advisories:
known_exploitation:
replacement_or_upgrade_path:
compatibility_constraints:
last_reviewed:
```

## 25.3 Update decision

Evaluate:

- current support/EOL;
- active exploitation;
- vulnerability severity;
- exploitability/reachability/exposure;
- privilege/data impact;
- compensating mitigations;
- vendor fix quality;
- release maturity;
- breaking-change size;
- test strength;
- rollback/recovery;
- regulatory/contractual requirement.

CISA’s KEV catalog is a strong input for known exploitation where applicable [SEC03]. Absence from KEV is not evidence that a vulnerability is unexploitable.

## 25.4 Routine upgrades

For low/moderate-risk supported dependencies:

- automate discovery;
- batch only where review remains clear;
- read relevant changelog/release notes;
- run risk-relevant tests;
- stage deployment;
- observe.

## 25.5 Major upgrades

A major version bump is a migration project when it changes:
- semantics;
- persistence;
- APIs;
- build/runtime;
- platform support;
- security model.

Treat it accordingly.

## 25.6 Emergency security upgrade

When exploitation/exposure is material:

1. establish authoritative advisory/fix;
2. determine affected/reachable assets;
3. apply mitigation if needed;
4. shorten ordinary release cadence without deleting necessary checks;
5. test highest-risk behavior first;
6. stage as much as consequence/time allows;
7. monitor aggressively;
8. verify remediation;
9. remove temporary mitigation/workaround;
10. perform follow-up root-cause/dependency lifecycle review.

## 25.7 Pin + monitor + deliberately update

Pinning/locking can improve reproducibility.

Never convert pinning into indefinite stagnation:

```text
PIN / LOCK
+ INVENTORY
+ MONITOR
+ UPDATE INTENTIONALLY
+ VERIFY
```

---

# 26. Dependency automation policy

Automation tools such as Dependabot can discover/version/security updates and dependency-review tooling can inspect changes [DEP01].

Automation MAY:
- create PRs;
- group compatible low-risk updates;
- run deterministic tests;
- apply policy gates;
- merge pre-approved low-risk changes when evidence is sufficient.

Automation SHOULD NOT autonomously merge high-consequence changes solely because:
- version is patch/minor;
- CI is green;
- vendor calls it backward compatible.

Project semantics decide.

---

# 27. Technical debt standard

## 27.1 Definition test

Before creating a technical-debt item, answer:

> **What future work becomes more expensive, risky, slow or constrained because this condition exists?**

If no consequence can be described, it may be:
- preference;
- cleanup;
- potential improvement;
- unknown;
rather than meaningful debt.

## 27.2 Debt record

```yaml
debt_id:
system:
owner:

choice_or_condition:
origin:
intentional: true | false | unknown

evidence:
future_consequence:
interest_signals:
  - repeated rework
  - incident contribution
  - change delay
  - manual toil
  - support/security exposure
  - option blockage

affected_change_paths:
blast_radius:
security_privacy_safety_effect:
support_eol_effect:
strategic_option_loss:

remediation_options:
estimated_cost_range:
risk_if_deferred:
trigger_for_action:
accepted_until:
review_date:
decision:
```

## 27.3 Debt families

- architecture/dependency structure;
- implementation/design;
- data/schema;
- test/evaluation;
- build/release;
- dependency/runtime/support;
- infrastructure/configuration;
- security;
- privacy/data lifecycle;
- observability;
- operational/runbook;
- performance/capacity;
- compatibility/deprecation;
- documentation/knowledge;
- migration/transitional architecture;
- AI/model-evaluation;
- agent/policy/control.

## 27.4 Debt vs other work

### Defect
Required behavior is wrong.

### Risk
Possible harmful future event.

### Obsolescence
Technology/support no longer meets lifecycle needs.

### Technical debt
Current choice/condition creates future cost/risk/option loss.

A single issue may be all four. Track the decision-relevant classification.

## 27.5 Prioritization

The systematic technical-debt literature does not establish one universally validated prioritization method [DEBT02].

V2 therefore uses decision dimensions, not one score:

- consequence if unchanged;
- frequency with which the affected area changes;
- recurring measurable friction;
- incident/defect contribution;
- support/security exposure;
- coupling/blast radius;
- strategic roadmap blockage;
- option value lost;
- remediation cost;
- timing/window;
- opportunity cost.

Use ranges and explicit judgment.

## 27.6 Disposition

Every material debt item should eventually be one of:

- **REMEDIATE NOW** — current consequence/exposure justifies action;
- **PLAN** — action is justified at a known trigger/window;
- **MONITOR** — evidence insufficient or consequence currently low;
- **ACCEPT** — carrying the debt is currently rational;
- **RETIRE WITH SYSTEM** — remediation has no lifecycle value before retirement;
- **RECLASSIFY** — defect/risk/feature instead.

These are house dispositions, not an external standard.

## 27.7 Intentional debt

Intentional debt is allowed when:
- short-term benefit is explicit;
- critical invariants stay protected;
- risk is understood enough;
- owner exists;
- trigger/expiry/review exists.

“Temporary” without removal evidence is not a plan.

## 27.8 Debt interest

“Interest” is a useful metaphor only when connected to evidence such as:
- extra review time;
- repeated manual work;
- slower changes;
- production incidents;
- duplicate infrastructure;
- support cost;
- vulnerability exposure.

Do not invent a precise interest rate without credible data.

---

# 28. Deprecation lifecycle

## 28.1 House state model

```text
ACTIVE
→ DEPRECATED
→ MIGRATION_ACTIVE
→ FROZEN_FOR_NEW_USE
→ SUNSET_SCHEDULED
→ REMOVED
→ RETIRED
```

Simple systems MAY collapse states.

## 28.2 State meanings

### ACTIVE
Supported for new and existing use.

### DEPRECATED
Existing behavior remains available under support policy, but new adoption SHOULD stop.

### MIGRATION_ACTIVE
Replacement/tooling/support is actively moving consumers.

### FROZEN_FOR_NEW_USE
Policy/technical controls prevent new consumers where feasible.

### SUNSET_SCHEDULED
Removal date or criteria is committed and communicated.

### REMOVED
Capability no longer serves normal use.

### RETIRED
Supporting code/state/identities/infrastructure/evidence obligations have been closed as intended.

## 28.3 Deprecation contract

```yaml
artifact:
owner:
deprecated_at:
reason:
replacement:
replacement_readiness:
migration_guide:
migration_tooling:
consumer_inventory:
usage_telemetry:
new_adoption_block:
support_scope:
security_support:
sunset_date_or_criteria:
contractual_constraints:
exception_process:
emergency_break_policy:
communications:
removal_validation:
retirement_tasks:
```

## 28.4 Sunset date vs criteria

A date is useful when consumers need planning certainty.

Criteria can be safer when removal depends on:
- zero/threshold legitimate usage;
- migration of named strategic consumers;
- contractual milestone;
- replacement readiness;
- regulatory approval.

Avoid an arbitrary date that nobody enforces.

## 28.5 Exception policy

Every exception should have:
- consumer;
- reason;
- owner;
- compensating control;
- expiry;
- next action.

No permanent invisible exceptions.

## 28.6 Emergency compatibility break

A normal deprecation window MAY be shortened when:
- active exploitation;
- severe safety/security issue;
- legal prohibition;
- data integrity risk;
- vendor/service forced removal.

Require:
- decision authority;
- impact assessment;
- strongest feasible communication;
- migration/mitigation;
- recovery/support path;
- post-event review.

---

# 29. Retirement and decommissioning

## 29.1 Retirement inventory

Before removal identify:

### Consumers
- users;
- services;
- SDK clients;
- partners;
- scripts;
- agents;
- scheduled/annual jobs.

### Data
- primary data;
- replicas;
- backups;
- caches;
- exports;
- logs;
- analytics copies;
- vector stores/AI memory where relevant.

### Identity
- service accounts;
- API keys;
- OAuth clients;
- certificates;
- signing keys;
- roles/policies.

### Integration
- DNS;
- load balancers/routes;
- webhooks;
- queues/topics;
- file drops;
- cron/schedulers;
- firewall rules;
- service discovery.

### Operations
- monitoring;
- alerts;
- dashboards;
- on-call;
- runbooks;
- status page;
- support process.

### Economics
- cloud resources;
- licenses;
- vendor contracts;
- domains/certificates;
- data egress/storage.

## 29.2 Data disposition

For each data class:

```yaml
data:
purpose:
owner:
retention_requirement:
deletion_requirement:
legal_hold:
customer_export:
backup_retention:
archive:
deletion_method:
verification:
```

Do not archive personal/customer data “just in case” when deletion is required.

Do not delete evidence/data subject to a valid retention/legal obligation.

## 29.3 Retirement sequence

A typical sequence:

```text
DISCOVER DEPENDENTS
→ STOP NEW ADOPTION
→ MIGRATE / EXPORT
→ FREEZE OR DRAIN WRITES
→ VERIFY NO LEGITIMATE USE
→ DISABLE NORMAL SERVING
→ OBSERVE / TOMBSTONE WHERE USEFUL
→ DISPOSE DATA CORRECTLY
→ REVOKE IDENTITIES / SECRETS
→ REMOVE ROUTES / JOBS / INTEGRATIONS
→ TERMINATE RESOURCES / CONTRACTS
→ ARCHIVE REQUIRED EVIDENCE
→ VERIFY ZERO ZOMBIE SURFACE
```

## 29.4 Post-retirement observation

Where hidden/periodic clients are plausible, keep a bounded observation mechanism:

- tombstone endpoint;
- rejected-call telemetry;
- DNS/query monitoring;
- queue dead-letter observation;
- IAM credential-use alerts.

The observation duration should reflect plausible usage periodicity, not an arbitrary universal number.

## 29.5 Retirement completion

Retirement is complete when:

- legitimate dependents are migrated or explicitly closed;
- user/customer commitments are satisfied;
- data disposition is verified;
- credentials/identities are revoked;
- routes/integrations/jobs are removed;
- monitoring/on-call is intentionally closed;
- billable resources/contracts are closed;
- required source/build/provenance/evidence is archived;
- residual risks are accepted.

---

# 30. Configuration, policy and infrastructure migration

Configuration is executable behavior.

Treat material config/policy/IaC changes with the same principles:

- versioned intent;
- validation/schema;
- explicit defaults;
- review;
- canary/progressive application where useful;
- rollback only if external state remains compatible;
- detection of operator lockout/loss of control;
- post-change verification.

Examples of irreversible or dangerous configuration change:

- firewall rule locking out operators;
- IAM policy removing break-glass access;
- DNS cutover with long caching behavior;
- stateful infrastructure destruction;
- credential rotation without all consumers migrated.

---

# 31. Runtime, language and platform migrations

A runtime/language/platform upgrade can alter:

- memory model;
- concurrency;
- serialization;
- time/date behavior;
- TLS/crypto defaults;
- dependency resolution;
- filesystem/network semantics;
- performance/resource use;
- build outputs;
- supported OS/architectures.

Treat the upgrade as more than “code compiles.”

For material upgrades verify:

- official migration/support notes;
- all native/binary dependencies;
- production-like build/runtime;
- boundary formats;
- perf/capacity;
- security policy;
- rollback state compatibility;
- monitoring/runtime telemetry.

---

# 32. Security, privacy and compliance overlays

Maintenance changes can accidentally:

- widen privilege;
- re-enable deprecated auth;
- leak data in migration logs;
- copy production data to unsafe test environments;
- retain data beyond purpose;
- expose secrets in scripts;
- bypass supply-chain controls under emergency pressure;
- preserve vulnerable compatibility forever.

## 32.1 Security maintenance

For security-triggered change:
- use current authoritative advisory;
- assess reachability/exposure;
- identify workaround/mitigation;
- patch/upgrade;
- verify vulnerability no longer applies;
- monitor exploitation signals;
- remove temporary mitigation;
- update asset/dependency inventory.

## 32.2 Privacy migration

When moving data:
- minimize copied fields;
- preserve classification;
- enforce destination access;
- protect transit/staging;
- set temporary-copy deletion;
- redact logs;
- update retention/deletion behavior;
- verify tenant isolation.

## 32.3 Regulatory overlay

Projects subject to legal support/vulnerability obligations MUST translate them into:
- support period;
- update policy;
- vulnerability handling;
- user communication;
- retirement conditions;
- evidence.

The core playbook does not invent legal obligations outside applicable scope.

---

# 33. AI-assisted maintenance and agentic change

AI can make large changes cheap to generate. That increases the importance of verification and comprehension.

## 33.1 Appropriate AI assistance

AI MAY assist with:
- code archaeology;
- dependency maps;
- dead-code candidates;
- codemods;
- refactoring proposals;
- test generation;
- migration SQL drafts;
- release-note comparison;
- consumer discovery hypotheses;
- documentation;
- anomaly triage.

## 33.2 Trust rule

Treat as untrusted until independently validated:
- generated migration SQL;
- destructive shell commands;
- dependency/version claims;
- compatibility claims;
- data transforms;
- rollback scripts;
- IaC;
- security changes;
- tests/oracles generated by the same model.

## 33.3 Proposal is not authorization

For agentic maintenance:

```text
MODEL / AGENT PROPOSES
→ POLICY / CHANGE SYSTEM AUTHORIZES
→ TOOL EXECUTES WITH SCOPED IDENTITY
→ SYSTEM OBSERVES + RECORDS EFFECT
→ INDEPENDENT EVIDENCE VERIFIES
```

The model MUST NOT grant itself production/delete/spend/credential authority through prompt text.

## 33.4 High-impact controls

For M3/M4 agent-executable work:

- least-privilege identity;
- explicit target scope;
- dry-run/preflight;
- row/resource bounds;
- idempotency where relevant;
- concurrency limit;
- timeout;
- approval boundary;
- audit/provenance;
- stop/kill path;
- reconciliation;
- independent human/domain review as required.

## 33.5 Comprehension

Do not merge an opaque AI-generated modernization diff merely because tests pass.

A responsible owner/reviewer should understand:
- invariants;
- state transition;
- failure modes;
- recovery;
- new dependencies;
- why the change is better.

---

# 34. Verification and validation strategy

## 34.1 Evidence portfolio

Select from:

- static/type/schema validation;
- unit/domain tests;
- characterization tests;
- contract tests;
- compatibility tests;
- integration tests;
- end-to-end tests;
- architecture fitness tests;
- property/invariant tests;
- migration rehearsal;
- restore test;
- performance/load/lock tests;
- security/privacy tests;
- shadow/differential validation;
- canary/progressive evidence;
- reconciliation queries;
- operator tabletop/dry run;
- independent review.

## 34.2 Compatibility test matrix

Where required test:

```text
OLD CLIENT → OLD SERVER
OLD CLIENT → NEW SERVER
NEW CLIENT → OLD SERVER   (if promised)
NEW CLIENT → NEW SERVER

OLD CODE → OLD STATE
OLD CODE → NEW/EXPANDED STATE
NEW CODE → OLD STATE
NEW CODE → NEW STATE
```

Also include queued/stored historical messages when relevant.

## 34.3 Migration failure tests

Test relevant cases:

- crash mid-batch;
- restart from checkpoint;
- same batch executed twice;
- lock timeout;
- provider rate limit;
- network partition;
- one dual-write side fails;
- stale consumer writes;
- rollback requested after partial transform;
- storage capacity runs low;
- source changes during copy;
- invalid legacy row;
- unknown enum/field;
- new deployment partially rolled out;
- operator loses access;
- canary signal is ambiguous.

## 34.4 Rehearsal data

Use representative:
- volume;
- skew;
- nulls/invalid legacy cases;
- long-tail values;
- large objects;
- tenant distribution;
- timing;
- concurrency.

Synthetic data may miss historical anomalies. Production data use must obey security/privacy constraints.

## 34.5 Post-release verification

Verify:
- user/business correctness;
- data invariants;
- error/latency/saturation;
- migration progress;
- mismatch/divergence;
- old usage;
- security signals;
- resource/cost anomalies.

Do not stop monitoring immediately after technical cutover when delayed failures are plausible.

---

# 35. Quality gates

## Gate 0 — Change Intent

Pass if:
- outcome is explicit;
- reason-now is explicit;
- non-goals known;
- class M0–M4 assigned;
- owner/decision owner named.

Block if:
- architecture/tool chosen before problem;
- “modernize” has no observable outcome;
- breaking change has no consumer model.

## Gate 1 — Current Reality

Pass if:
- protected invariants identified;
- consumers/readers/writers mapped proportionately;
- source-of-truth known;
- data/dependencies/support state known;
- baseline behavior/health captured;
- major unknowns visible.

Block if:
- high-impact state owner unknown;
- no way to detect correctness.

## Gate 2 — Transition Design

Pass if:
- phases/intermediate states defined;
- compatibility matrix defined where needed;
- mixed-version matrix defined where needed;
- online/offline choice justified;
- recovery modes by phase defined;
- irreversibility ledger defined;
- cleanup/retirement designed.

Block if:
- rollback assumed without state proof;
- dual write has ambiguous authority;
- destructive contraction precedes migration evidence.

## Gate 3 — Verification / Rehearsal

Pass if:
- risk-relevant tests pass;
- representative data/scale tested where material;
- interruption/restart tested where material;
- reconciliation queries validated;
- recovery rehearsal completed for M3/M4 where practical;
- independent review complete where required.

## Gate 4 — Expand / Deployment

Pass if:
- new compatible structures deployed;
- monitoring works;
- current users remain safe;
- no new-only state is created before allowed.

## Gate 5 — Migration / Progressive Evidence

Pass if:
- migration progresses within bounds;
- no unacceptable SLO/integrity/security regression;
- divergence/reconciliation acceptable;
- stop/continue criteria applied.

## Gate 6 — Cutover

Pass if:
- target authority explicit;
- supported consumers ready;
- data reconciliation complete;
- recovery mode re-evaluated after cutover;
- communication complete.

## Gate 7 — Contract / Cleanup

Pass if:
- old write/read path no longer required;
- old schema/interface removed when justified;
- feature flags/shims/jobs removed;
- temporary credentials/resources removed;
- docs/ownership updated.

## Gate 8 — Retirement / Learning

Pass if:
- data disposition done;
- identities/integrations/resources removed;
- zombie surface checked;
- lessons and debt records updated;
- final evidence retained.

---

# 36. Decision framework — refactor, modernize, replace or retire

```text
Does the capability still provide required value?
│
├─ NO
│  └─ RETIRE
│
└─ YES
   │
   ├─ Is the main problem an operational/security/support gap
   │  that can be corrected without architecture replacement?
   │    ├─ YES → STABILIZE / UPGRADE / REMEDIATE
   │    └─ NO
   │
   ├─ Can bounded internal change meet the hard requirement?
   │    ├─ YES → REFACTOR / MODULARIZE
   │    └─ NO
   │
   ├─ Is the constraint primarily hosting/platform?
   │    ├─ YES → REHOST / REPLATFORM decision
   │    └─ NO
   │
   ├─ Is a commodity replacement acceptable?
   │    ├─ YES → BUY / MANAGED / OSS replacement + exit analysis
   │    └─ NO
   │
   ├─ Can capability/state be safely partitioned?
   │    ├─ YES → INCREMENTAL DISPLACEMENT / EXTRACTION
   │    └─ NO
   │
   └─ Can full replacement be validated and migrated
      with acceptable duplicate-system + cutover risk?
        ├─ YES → BOUNDED REWRITE / REPLACEMENT
        └─ NO  → revisit requirement, scope, or risk acceptance
```

---

# 37. Decision framework — online vs planned downtime

Choose online/rolling migration when:
- availability requirement justifies it;
- mixed-state semantics are safe;
- transition can be observed;
- engineering/operational complexity is acceptable.

Choose planned downtime when:
- a bounded outage is acceptable;
- quiescent state materially simplifies correctness;
- dual write/coexistence is high risk;
- recovery can be rehearsed;
- user impact is less than online-migration risk/cost.

Never choose “zero downtime” for prestige.

---

# 38. Decision framework — preserve compatibility or break

```text
Are supported legitimate consumers dependent on old behavior?
│
├─ NO → remove/contract if lifecycle value > compatibility value
│
└─ YES
   │
   ├─ Can compatible evolution satisfy the requirement?
   │    ├─ YES → expand + migrate + contract
   │    └─ NO
   │
   ├─ Does security/safety/legal integrity require break?
   │    ├─ YES → accelerated breaking-change process
   │    └─ NO
   │
   └─ version/deprecate + migration path + support window/criteria
```

---

# 39. Decision framework — upgrade urgency

### Act immediately / emergency path when
- confirmed active exploitation plus material exposure;
- current dependency is unsupported and vulnerable with unacceptable exposure;
- vendor/platform forces imminent removal;
- material integrity/safety issue;
- binding requirement.

### Prioritize normal controlled upgrade when
- support/EOL approaching;
- important security fixes;
- recurring defects/performance issues;
- required compatibility;
- significant operational cost.

### Monitor / schedule when
- supported;
- low exposure;
- update adds no material value;
- regression risk is currently higher than deferral risk;
- compensating controls are credible.

“Delay” should be a decision, not inertia.

---

# 40. Decision framework — technical debt

For each item:

1. What future consequence does it create?
2. Which changes/events pay the “interest”?
3. How often does that path occur?
4. What risk/option is blocked?
5. Is evidence current?
6. What happens if we defer?
7. Is there a natural remediation window?
8. Is the system likely to retire before remediation pays back?
9. What is the opportunity cost?
10. What evidence would change the disposition?

Do not multiply arbitrary 1–5 scores and call the result truth.

---

# 41. Standard Plays

## PLAY-MNT-01 — Safe production change

### Objective
Move production from one valid state to another with bounded blast radius and verified outcome.

### Trigger
Any M2+ change.

### Steps
1. define outcome/non-goals;
2. classify M-level;
3. identify protected invariants;
4. map consumers/readers/writers/state;
5. choose transition strategy;
6. define phases/authority;
7. build verification/reconciliation;
8. rehearse risk-relevant failure;
9. deploy/expand;
10. migrate progressively;
11. apply stop/continue criteria;
12. cut over authority;
13. reconcile;
14. contract/cleanup;
15. update evidence/learning.

### Acceptance
- invariant evidence passes;
- target authority clear;
- residual transitional complexity has owner/expiry or is removed.

---

## PLAY-MNT-02 — Refactor a high-change area

### Objective
Reduce change risk/friction without unintended contract change.

### Preconditions
- behavior classification exists;
- tests/observability adequate.

### Steps
1. identify concrete change friction/risk;
2. state protected contract;
3. create characterization evidence where spec weak;
4. separate defect/behavior change from pure refactor;
5. choose seam;
6. make small structural changes;
7. run regression/fitness evidence continuously;
8. remove obsolete path;
9. observe later change cost/defect outcomes.

---

## PLAY-MNT-03 — Long-running interface evolution

### Objective
Replace a contract without lockstep consumer deployment.

### Steps
1. inventory consumers;
2. define old/new compatibility dimensions;
3. expand interface;
4. deploy supplier that supports both;
5. publish migration docs/tooling;
6. migrate internal consumers first where useful;
7. mark old path deprecated;
8. prevent new adoption;
9. monitor remaining use;
10. schedule/trigger sunset;
11. remove old path;
12. verify no supported use;
13. retire compatibility code.

---

## PLAY-MNT-04 — Database schema migration

### Objective
Evolve schema without invalid mixed-version state.

### Steps
1. enumerate readers/writers;
2. assess DDL lock/rewrite semantics;
3. expand schema;
4. deploy tolerant application code;
5. start new writes only when old versions remain safe;
6. backfill;
7. reconcile;
8. switch read/write authority;
9. observe;
10. disable old access;
11. contract schema later;
12. retest recovery after each irreversible step.

---

## PLAY-MNT-05 — Large data backfill

### Objective
Transform data completely, restart-safely and with auditable reconciliation.

### Steps
1. define population/transform/invariants;
2. estimate volume/skew;
3. choose checkpoint/idempotency;
4. test representative data;
5. set resource/rate limits;
6. start small batch;
7. monitor correctness + saturation;
8. scale within bounds;
9. quarantine/repair errors;
10. reconcile per segment;
11. resolve late writes;
12. freeze final population;
13. final reconciliation;
14. close migration job/permissions.

---

## PLAY-MNT-06 — Runtime/dependency major upgrade

### Objective
Move to a supported version without hidden semantic regression.

### Steps
1. document trigger/support urgency;
2. read official compatibility/migration/security notes;
3. map transitive/native dependencies;
4. identify deprecated/removed features;
5. upgrade in safe staging path;
6. run contract/integration/performance/security evidence;
7. canary/progressively release where useful;
8. monitor;
9. remove compatibility flags/workarounds;
10. update lifecycle inventory.

---

## PLAY-MNT-07 — Emergency security dependency upgrade

### Objective
Reduce confirmed material exposure rapidly without discarding correctness controls.

### Steps
1. verify advisory/fix;
2. map affected assets/reachability;
3. apply immediate mitigation if needed;
4. identify minimal safe update;
5. run prioritized critical-path/security tests;
6. obtain required emergency authority;
7. deploy progressively as time/risk permits;
8. verify remediation;
9. monitor exploit/incident indicators;
10. perform follow-up full regression and cleanup.

---

## PLAY-MNT-08 — Legacy modernization slice

### Objective
Deliver one modernization outcome while preserving system integrity.

### Steps
1. define outcome/constraint;
2. map business capability and state ownership;
3. choose bounded slice;
4. introduce seam/routing only if justified;
5. create new implementation;
6. shadow/compare safely if useful;
7. migrate selected users/assets/traffic;
8. verify;
9. move authority;
10. remove old slice;
11. repeat only if evidence supports program direction.

---

## PLAY-MNT-09 — Deprecate and remove an API/capability

### Objective
End support without surprise breakage beyond the approved policy.

### Steps
1. name owner/reason/replacement;
2. discover consumers;
3. stop new adoption;
4. mark deprecation in docs/runtime/spec where useful;
5. publish migration support;
6. monitor migration;
7. handle exceptions;
8. announce sunset date/criteria;
9. freeze old capability;
10. remove;
11. verify no supported consumers;
12. retire implementation/infrastructure.

---

## PLAY-MNT-10 — Retire a service/system

### Objective
Close the full lifecycle without zombie dependencies, data or attack surface.

### Steps
1. inventory dependents/data/identities/integrations;
2. resolve legal/retention/export;
3. stop new adoption;
4. migrate users/dependents;
5. drain writes/work;
6. verify no legitimate use;
7. disable serving;
8. observe tombstone/rejections if useful;
9. dispose/archive data correctly;
10. revoke credentials/identities;
11. remove routes/jobs/webhooks/queues;
12. terminate infrastructure/contracts;
13. archive required source/build/evidence;
14. verify cost/security inventory;
15. close ownership.

---

# 42. Checklists

## 42.1 Safe-change checklist

- [ ] Outcome and non-goals defined
- [ ] Change class M0–M4 assigned
- [ ] Protected invariants explicit
- [ ] Current source-of-truth known
- [ ] Readers/writers/consumers mapped proportionately
- [ ] Compatibility dimensions selected
- [ ] Mixed-version matrix defined if applicable
- [ ] Intermediate states are valid
- [ ] Online vs downtime choice justified
- [ ] Recovery mode defined per phase
- [ ] Irreversible events recorded
- [ ] Stop/continue thresholds defined
- [ ] Representative rehearsal completed where required
- [ ] Reconciliation method validated
- [ ] Monitoring can detect harmful change
- [ ] Cleanup/removal owner defined
- [ ] Post-change evidence recorded

## 42.2 Refactor checklist

- [ ] Concrete friction/risk identified
- [ ] Intended/protected behavior classified
- [ ] Characterization tests not mistaken for desired spec
- [ ] Behavior change separated from structure change where practical
- [ ] Tests/fitness constraints cover risk
- [ ] Change is reviewable
- [ ] External contract unchanged or explicitly migrated
- [ ] Temporary seam/adapter has cleanup path
- [ ] Docs/ADR updated if rationale changed

## 42.3 API/schema evolution checklist

- [ ] Stability/support policy known
- [ ] Consumer versions known or uncertainty recorded
- [ ] Source/wire/schema/semantic/error compatibility assessed
- [ ] Old-client/new-server tested
- [ ] New-client/old-server tested if promised
- [ ] Stored/replayed old messages considered
- [ ] Deprecation metadata/docs ready
- [ ] Migration path exists
- [ ] New adoption of deprecated path controlled
- [ ] Removal criteria/date explicit

## 42.4 Database migration checklist

- [ ] All writers/readers mapped
- [ ] DDL lock/rewrite/resource behavior understood
- [ ] Schema expansion is mixed-version safe
- [ ] Backup/restore or alternate recovery verified
- [ ] Representative volume tested
- [ ] Backfill resumable
- [ ] Idempotency/dedup semantics explicit
- [ ] Production resource limits defined
- [ ] Late writes handled
- [ ] Reconciliation queries validated
- [ ] Old readers/writers stopped before contraction
- [ ] Rollback validity rechecked after each irreversible event

## 42.5 Dependency upgrade checklist

- [ ] Trigger/urgency documented
- [ ] Official support/EOL status checked
- [ ] Security advisories/known exploitation checked where relevant
- [ ] Transitive/native impacts known
- [ ] Release/migration notes reviewed
- [ ] License/provenance change checked if material
- [ ] Compatibility tests pass
- [ ] Performance/resource change checked if material
- [ ] Deployment staged appropriately
- [ ] Rollback/recovery valid
- [ ] Inventory updated
- [ ] Temporary workaround removed

## 42.6 Deprecation checklist

- [ ] Owner
- [ ] Reason
- [ ] Replacement ready enough
- [ ] Consumer inventory
- [ ] Migration guide/tooling
- [ ] Runtime/spec deprecation signal where useful
- [ ] New adoption blocked where feasible
- [ ] Support/security support defined
- [ ] Sunset date/criteria
- [ ] Exception policy
- [ ] Emergency break policy
- [ ] Communications
- [ ] Removal validation
- [ ] Retirement tasks

## 42.7 Retirement checklist

- [ ] Users/services/scripts/agents migrated
- [ ] Periodic clients considered
- [ ] Data export complete where required
- [ ] Retention/legal hold resolved
- [ ] Required deletion verified
- [ ] Backups/archive disposition explicit
- [ ] Service accounts revoked
- [ ] API keys/tokens/certs revoked
- [ ] DNS/routes removed
- [ ] Webhooks/queues/topics/jobs removed
- [ ] Firewall/IAM policies cleaned
- [ ] Monitoring/on-call/status updated
- [ ] Licenses/vendors/cloud resources closed
- [ ] Required source/build/provenance archived
- [ ] Post-retirement zombie check passed

---

# 43. Templates

## 43.1 Mixed-Version Safety Matrix

```markdown
| Consumer/Writer | Provider/State | Supported? | Required behavior | Test evidence | Removal trigger |
|---|---|---|---|---|---|
| old client | new server | | | | |
| new client | old server | | | | |
| old writer | expanded state | | | | |
| new writer | old-compatible state | | | | |
```

## 43.2 Migration Phase Record

```yaml
phase:
objective:
preconditions:
authoritative_state:
authoritative_writer:
allowed_versions:
actions:
expected_post_state:
verification:
monitoring:
stop_conditions:
continue_conditions:
recovery_modes:
irreversible_events:
owner:
approver:
```

## 43.3 Reconciliation Plan

```yaml
population_definition:
source_snapshot_or_window:
target_population:
count_checks:
segment_checks:
domain_invariants:
duplicate_checks:
missing_checks:
financial_or_business_totals:
sample_validation:
quarantine:
allowed_mismatch:
decision_if_mismatch:
final_signoff:
```

## 43.4 Irreversibility Ledger

```markdown
| Event | Phase | Irreversible because | Risk | Evidence required | Recovery/compensation | Approval |
|---|---|---|---|---|---|---|
```

## 43.5 Technical Debt Record

```yaml
debt_id:
owner:
system:
condition:
origin:
intentional:
evidence:
future_consequence:
interest_signals:
affected_change_paths:
risk_if_deferred:
strategic_option_loss:
remediation_options:
cost_range:
natural_window:
trigger:
decision: remediate_now | plan | monitor | accept | retire_with_system | reclassify
accepted_until:
review_date:
```

## 43.6 Deprecation Record

```yaml
artifact:
owner:
status:
deprecated_at:
reason:
replacement:
migration_guide:
migration_tooling:
consumer_inventory:
usage_signal:
new_adoption_block:
support_scope:
security_support:
sunset_date_or_criteria:
exceptions:
emergency_break_policy:
communications:
removal_validation:
retirement:
```

## 43.7 Retirement Record

```yaml
system:
owner:
retirement_reason:
last_supported_date:
dependents:
data_classes:
retention_deletion:
exports:
identities:
integrations:
jobs:
routes_dns:
monitoring:
vendors_costs:
archives:
post_retirement_observation:
verification:
residual_risk:
closed_by:
closed_at:
```

---

# 44. Metrics and operating signals

## 44.1 Change safety

- change fail rate;
- failed deployment recovery time;
- deployment rework rate;
- rollback/fix-forward frequency;
- migration abort rate;
- post-change incident rate.

Use current DORA definitions when using DORA metrics [OPS03].

## 44.2 Migration correctness

- reconciliation mismatch;
- duplicate/missing records;
- quarantined records;
- divergence age;
- backfill error rate;
- restart/replay success;
- time spent in dual-write/transitional state.

## 44.3 Compatibility health

- supported old-version usage;
- deprecated endpoint usage;
- unsupported consumer attempts;
- compatibility-shim age;
- number of active API/schema versions;
- time from deprecation to removal.

## 44.4 Dependency health

- unsupported/EOL dependency exposure;
- known-exploited dependency exposure;
- age of critical security fixes not deployed;
- major-upgrade backlog;
- vendor/platform end-of-support horizon.

## 44.5 Technical-debt health

Do not count debt tickets as the primary metric.

Prefer:
- repeated change friction;
- debt-attributable incidents;
- roadmap work blocked;
- manual toil caused;
- time in transitional architecture;
- support/security exposure;
- remediation outcomes.

## 44.6 Retirement health

- zombie resource findings;
- stale credentials after retirement;
- residual DNS/routes;
- unclosed licenses/vendor costs;
- post-retirement calls from legitimate clients;
- deletion/retention exceptions.

## 44.7 Metric integrity

For each metric define:
- decision it informs;
- population/denominator;
- owner;
- collection method;
- known gaming risk;
- threshold/action.

---

# 45. Anti-patterns and falsified folklore

## 45.1 “Rewrite legacy code to eliminate technical debt.”
**Verdict:** High-risk option, not a rule.

**Better:** Compare incremental evolution against full replacement, including semantic rediscovery and migration risk.

## 45.2 “Never rewrite.”
**Verdict:** False absolute.

**Better:** Rewrite only when hard requirements and bounded migration evidence justify it.

## 45.3 “Microservices are modernization.”
**Verdict:** False.

**Better:** Modernization outcome first; topology second.

## 45.4 “Cloud migration is modernization.”
**Verdict:** False.

**Better:** Rehosting may change operating constraints without improving architecture/changeability.

## 45.5 “Zero downtime is best practice.”
**Verdict:** False as a universal rule.

**Better:** Choose downtime/coexistence from total consequence and complexity.

## 45.6 “Rollback is always safest.”
**Verdict:** False.

**Better:** Roll back only while old version/state compatibility remains valid.

## 45.7 “Every migration must be reversible.”
**Verdict:** Unrealistic.

**Better:** Irreversible steps require stronger pre-change assurance and alternative recovery/compensation.

## 45.8 “Expand/contract is mandatory.”
**Verdict:** Strong contextual pattern.

**Better:** Use when coexistence reduces risk; skip prolonged transition when bounded cutover is safer.

## 45.9 “Dual writes keep systems in sync.”
**Verdict:** Misleading.

**Better:** Dual writes create partial-failure semantics; authority/reconciliation must be designed.

## 45.10 “The migration succeeded because the job completed.”
**Verdict:** False.

**Better:** Reconciliation/invariants define success.

## 45.11 “Backup means rollback.”
**Verdict:** False.

**Better:** Restoration must be tested and may not restore external side effects.

## 45.12 “Schema-compatible means API-compatible.”
**Verdict:** False.

**Better:** Semantic, error, auth, timing and operational compatibility matter.

## 45.13 “Adding an optional field can’t break anyone.”
**Verdict:** False.

**Better:** consumer parsers/defaults/enums/size/semantics can break.

## 45.14 “A major version lets us break anything.”
**Verdict:** False operationally.

**Better:** versioning signals intent; migration/user/business constraints still apply.

## 45.15 “SemVer guarantees compatibility.”
**Verdict:** False.

**Better:** it requires a defined public API and compliant release practice.

## 45.16 “Never break backward compatibility.”
**Verdict:** False.

**Better:** preserve it while valuable/required; remove deliberately when risk/cost outweighs it.

## 45.17 “Deprecation means users must stop now.”
**Verdict:** False.

**Better:** deprecation signals migration away; sunset/removal is separate.

## 45.18 “Deprecated APIs can stay forever.”
**Verdict:** False.

**Better:** compatibility code is maintained attack/change surface.

## 45.19 “A fixed 6/12/24-month deprecation window is best practice.”
**Verdict:** Unsupported universal.

**Better:** consumer control, contract, risk and migration effort determine it.

## 45.20 “Always stay on the latest dependency version.”
**Verdict:** False.

**Better:** monitor continuously and update deliberately.

## 45.21 “Don’t upgrade what isn’t broken.”
**Verdict:** False.

**Better:** unsupported/vulnerable dependencies can be broken from a lifecycle perspective.

## 45.22 “Patch versions are safe to auto-merge.”
**Verdict:** False universal.

**Better:** actual project evidence and consequence decide automation.

## 45.23 “CVSS/severity alone determines patch priority.”
**Verdict:** Incomplete.

**Better:** known exploitation, exposure, reachability, impact, support and mitigations matter.

## 45.24 “Technical debt is code smell.”
**Verdict:** False.

**Better:** debt is future consequence/option loss from a technical condition.

## 45.25 “Debt must always be repaid.”
**Verdict:** False.

**Better:** accept or retire-with-system when repayment has lower value than carrying it.

## 45.26 “We should allocate 20% of every sprint to debt.”
**Verdict:** Unsupported universal quota.

**Better:** invest according to consequence and delivery constraints.

## 45.27 “Debt can be objectively ranked with one score.”
**Verdict:** Not supported by current prioritization evidence.

**Better:** use multi-dimensional decision evidence and explicit judgment.

## 45.28 “Characterization tests define the spec.”
**Verdict:** False.

**Better:** they capture observed behavior, including bugs.

## 45.29 “Refactoring can’t change performance.”
**Verdict:** Misleading.

**Better:** pure functional behavior may remain while performance/resource contract can still regress.

## 45.30 “Staging proves migration safety.”
**Verdict:** False.

**Better:** production scale/data/traffic/dependencies differ; progressive evidence may still be required.

## 45.31 “Canarying is always safer.”
**Verdict:** Conditional.

**Better:** use only with representative exposure, attributable signals and manageable side effects.

## 45.32 “Shadow traffic has no side effects because users don’t see it.”
**Verdict:** False.

**Better:** isolate writes/messages/payments/emails and sensitive data.

## 45.33 “Retirement is turning the service off.”
**Verdict:** False.

**Better:** close data, identity, integration, operational and financial surface.

## 45.34 “No traffic for a week means no consumers.”
**Verdict:** False universal.

**Better:** usage periodicity can be monthly/annual/event-driven.

## 45.35 “Archive everything before retirement.”
**Verdict:** False.

**Better:** retention and deletion/purpose constraints still apply.

## 45.36 “AI can modernize the codebase faster than people can review it.”
**Verdict:** Throughput claim, not assurance.

**Better:** review/comprehension and independent evidence remain bounded by consequence.

## 45.37 “An AI-generated rollback script is safe because the same AI verified it.”
**Verdict:** Weak assurance.

**Better:** generator self-assessment is not independent evidence.

---

# 46. Contradiction ledger

| Tension | Evidence-weighted rule |
|---|---|
| Stability vs upgrades | Avoid needless churn, but unsupported/security-exposed dependencies create lifecycle risk. |
| Compatibility vs cleanup | Preserve compatibility while its value exceeds maintenance/security complexity; then remove deliberately. |
| Online vs downtime | Use online coexistence when availability needs justify complexity; bounded downtime can be safer. |
| Rollback vs roll-forward | Follow current state compatibility and fastest safe restoration. |
| Refactor vs rewrite | Incremental preserves known behavior; rewrite can be justified by hard constraints but increases migration uncertainty. |
| Old behavior vs corrected behavior | Preserve required/supportable semantics, not known defects by default. |
| Dual write vs single authority | Single authority simplifies correctness; dual paths may enable transition but need reconciliation. |
| Automation vs review | Automate deterministic discovery/checks; scale autonomous mutation with consequence. |
| Latest vs pinned | Pin for reproducibility; monitor/update for support/security. |
| Deprecation certainty vs flexibility | Dates aid planning; criteria avoid arbitrary removal when migration evidence matters. |
| Technical debt vs feature delivery | Both consume option value; choose from consequence/opportunity cost rather than quotas. |
| Modernization vs simplicity | “Modern” mechanisms can increase complexity; choose least complex adequate target. |
| Canary speed vs confidence | Small exposure lowers blast radius but can reduce signal; choose population/duration from failure mode. |
| Data archive vs deletion | Preserve required evidence only while respecting purpose/retention/deletion obligations. |

---

# 47. One-page Golden Standard

If only one section is used:

1. Define the outcome and unacceptable failure.
2. Treat the change as a sequence of intermediate states.
3. State protected invariants.
4. Name source-of-truth and write authority in every phase.
5. Classify consequence and irreversibility.
6. Discover actual consumers/readers/writers/dependencies.
7. Define compatibility by dimension and supported version pair.
8. Test mixed-version states where rolling coexistence can occur.
9. Prefer additive expansion before contraction when coexistence reduces risk.
10. Use planned downtime when it is safer than online complexity.
11. Never assume rollback; validate state compatibility.
12. Prepare roll-forward/restore/compensation when reversal can fail.
13. Record irreversible events before crossing them.
14. Make backfills resumable, bounded and restart-safe.
15. Define completion by reconciliation and invariants.
16. Avoid ambiguous dual-write authority.
17. Preserve intended contract during refactoring, not every historical defect.
18. Modernize to solve a constraint, not to adopt an architecture label.
19. Treat rewrites as migrations with semantic and duplicate-system risk.
20. Keep dependencies supported; pin/monitor/update deliberately.
21. Prioritize urgent upgrades from exploitation/exposure/support—not version fashion.
22. Define technical debt by future consequence; do not use one universal score.
23. Deprecate with owner, replacement, migration, evidence and removal criteria.
24. Distinguish deprecation, sunset, removal and retirement.
25. Retire data, identities, routes, jobs, resources and support obligations—not only compute.
26. Resolve retention/deletion before archival/destruction.
27. Remove transitional flags/shims/schemas after migration.
28. Treat AI-generated migration work as untrusted until independently verified.
29. Keep authorization for autonomous change outside the model.
30. Finish with a simpler, supported and correctly owned system.

---

# 48. Source register and evidence review

## [MNT01] ISO/IEC/IEEE 14764:2022 — Software maintenance
**URL:** https://www.iso.org/standard/80710.html  
**Evidence:** `E1 — INTERNATIONAL_STANDARD`  
**Finding:** current published specialist guidance for software maintenance and maintenance types/process.  
**Important limitation:** published abstract references the maintenance process in ISO/IEC/IEEE 12207:2017; pair with current 12207:2026 lifecycle baseline rather than claiming synchronized editions.

## [LIFE01] ISO/IEC/IEEE 12207:2026 — Software life cycle processes
**URL:** https://www.iso.org/standard/90219.html  
**Evidence:** `E1 — INTERNATIONAL_STANDARD`  
**Finding:** current published lifecycle framework covering supply/development/operation/maintenance/support/retirement, applicable iteratively/concurrently; does not prescribe one development method.  
**Status:** published April 2026; 2017 edition withdrawn.

## [QUAL01] ISO/IEC 25010:2023 — Product quality model
**URL:** https://www.iso.org/standard/78176.html  
**Evidence:** `E1 — INTERNATIONAL_STANDARD`  
**Finding:** nine-characteristic product quality model usable across requirements/evaluation lifecycle.  
**Use here:** maintainability and related quality impacts; not a migration method.

## [VV01] IEEE 1012-2024 — System, Software, and Hardware Verification and Validation
**URL:** https://standards.ieee.org/ieee/1012/7324/  
**Evidence:** `E1 — FORMAL_STANDARD`  
**Finding:** active standard; V&V processes and integrity-level scaling; includes maintained/reused/legacy systems.  
**Use here:** risk-proportionate assurance.

## [OPS01] Google SRE Workbook — Canarying Releases
**URL:** https://sre.google/workbook/canarying-releases/  
**Evidence:** `E5 — MATURE_OPERATIONAL_GUIDANCE`  
**Finding:** small, self-contained releases and limited production exposure can reduce blast radius and provide production evidence.  
**Limitation:** canary effectiveness depends on representative traffic, isolation and useful evaluation signals.

## [OPS02] Google SRE — Configuration Design / On-Call
**URLs:**  
- https://sre.google/workbook/configuration-design/  
- https://sre.google/workbook/on-call/  
**Evidence:** `E5 — MATURE_OPERATIONAL_GUIDANCE`  
**Finding:** rollback can speed mitigation when safe; external state/data corruption can invalidate simple rollback.  
**Use here:** recovery conditionality.

## [OPS03] DORA — Software delivery performance metrics
**URL:** https://dora.dev/guides/dora-metrics/  
**Evidence:** `E2/E5 — INDUSTRY_RESEARCH`  
**Finding:** current five-metric throughput/instability model; small changes are a useful improvement mechanism.  
**Status note:** guide updated January 2026.  
**Limitation:** context-specific, not individual productivity targets.

## [API01] RFC 9745 — The Deprecation HTTP Response Header Field
**URL:** https://www.rfc-editor.org/rfc/rfc9745.html  
**Evidence:** `E4 — IETF STANDARDS TRACK`  
**Finding:** standardized HTTP `Deprecation` signal; deprecation does not itself change resource behavior; can link to migration information.  
**Published:** March 2025.

## [API02] RFC 8594 — The Sunset HTTP Header Field
**URL:** https://www.rfc-editor.org/info/rfc8594/  
**Evidence:** `E4 — IETF INFORMATIONAL`  
**Finding:** HTTP `Sunset` field can indicate likely future unavailability.  
**Limitation:** informational and HTTP-specific.

## [API03] Google AIP-180 — Backwards compatibility
**URL:** https://google.aip.dev/180  
**Evidence:** `E6/E7 — OFFICIAL_APPLIED_API_GUIDANCE`  
**Finding:** distinguishes source, wire and semantic compatibility and shows subtle breaking-change examples.  
**Limitation:** Google/protobuf/JSON assumptions; taxonomy generalizes more than exact rules.

## [API04] OpenAPI Specification 3.2.1
**URL:** https://spec.openapis.org/oas/v3.2.1.html  
**Evidence:** `E4 — OPEN_SPECIFICATION`  
**Finding:** current specification at cutoff includes deprecation metadata and specification version/deprecation semantics.  
**Limitation:** OAS metadata does not constitute consumer migration governance.

## [API05] Kubernetes Deprecation Policy
**URL:** https://kubernetes.io/docs/reference/deprecation-policy/  
**Evidence:** `E6/E5 — OFFICIAL_PLATFORM_POLICY`  
**Finding:** mature example of stability levels, version overlap and round-trip concerns.  
**Limitation:** specific support windows/rules are Kubernetes policy, not universal software law.

## [VER01] Semantic Versioning 2.0.0
**URL:** https://semver.org/  
**Evidence:** `E4 — OPEN_SPECIFICATION`  
**Finding:** MAJOR/MINOR/PATCH semantics are tied to a declared public API.  
**Limitation:** version numbers do not prove actual compatibility or good migration.

## [SCH01] Protocol Buffers — Updating message types / version support
**URLs:**  
- https://protobuf.dev/programming-guides/editions/  
- https://protobuf.dev/support/version-support/  
**Evidence:** `E6 — OFFICIAL_TECHNOLOGY_SEMANTICS`  
**Finding:** explicit wire-safe/unsafe changes and version-support behavior.  
**Limitation:** protobuf-specific.

## [PAT01] Martin Fowler / Danilo Sato — Parallel Change
**URL:** https://martinfowler.com/bliki/ParallelChange.html  
**Evidence:** `E7 — PRACTITIONER_PATTERN`  
**Finding:** expand → migrate → contract pattern for incompatible interface evolution.  
**Limitation:** useful pattern, not formal universal requirement.

## [PAT02] Martin Fowler — Strangler Fig
**URL:** https://martinfowler.com/bliki/StranglerFigApplication.html  
**Evidence:** `E7 — PRACTITIONER_PATTERN`  
**Finding:** incremental displacement reduces reliance on a single big cutover and allows incremental value/evidence.  
**Limitation:** safe only with viable seams/state ownership.

## [PAT03] Martin Fowler — Evolutionary Database Design
**URL:** https://martinfowler.com/articles/evodb.html  
**Evidence:** `E7 — PRACTITIONER_PATTERN`  
**Finding:** evolutionary database change and parallel change; explicitly notes transition complexity must be removed.  
**Limitation:** practitioner guidance; exact database mechanics are technology-specific.

## [DATA01] Google Cloud — Transfer large datasets / migration
**URL:** https://docs.cloud.google.com/architecture/migration-to-google-cloud-transferring-your-large-datasets  
**Evidence:** `E6/E7 — OFFICIAL_VENDOR_MIGRATION_GUIDANCE`  
**Finding:** applied sequence using copy, validate/consistency checks, synchronize, cut over and retire; illustrates that migration requires data validation.  
**Limitation:** cloud/vendor context.

## [DEBT01] Carnegie Mellon SEI — Managing Technical Debt: Identify Technical Debt Items
**URL:** https://sei.cmu.edu/library/managing-technical-debt-identify-technical-debt-items/  
**Evidence:** `E4/E7 — RESEARCH/PRACTICE_BODY`  
**Finding:** inventory concrete debt items, consequences and lifecycle cost/impact.  
**Limitation:** applied management guidance, not a universal numeric model.

## [DEBT02] Lenarduzzi et al. — Technical Debt prioritization SLR
**URL:** https://doi.org/10.1016/j.jss.2020.110827  
**Evidence:** `E2 — SYSTEMATIC_LITERATURE_REVIEW`  
**Finding:** 44 primary studies; no conclusive consensus/validated universal prioritization method; limited empirical evidence for principal/interest measurement.  
**Limitation:** literature through 2020; useful primarily for epistemic restraint.

## [MOD01] Reengineering software systems into microservices: state of the art (2025)
**URL:** https://doi.org/10.1016/j.infsof.2025.107732  
**Evidence:** `E2 — SYSTEMATIC_LITERATURE_REVIEW`  
**Finding:** migration/reengineering methods and evaluation are heterogeneous; substantial challenges remain.  
**Use here:** falsifies microservices as a universal modernization destination.

## [MOD02] Taxonomy of service identification approaches for legacy modernization
**URL:** https://www.sciencedirect.com/science/article/abs/pii/S0164121220302582  
**Evidence:** `E2 — SYSTEMATIC_LITERATURE_REVIEW`  
**Finding:** many service-identification approaches with uneven maturity; industrial expert validation reinforces context-dependence.  
**Use here:** modernization decomposition is not solved by one algorithm.

## [DEP01] GitHub Docs — dependency security / Dependabot / dependency review
**URLs:**  
- https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies  
- https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-version-updates  
- https://docs.github.com/en/code-security/concepts/supply-chain-security/dependency-review  
**Evidence:** `E6 — OFFICIAL_PLATFORM_GUIDANCE`  
**Finding:** distinguishes security/version updates and provides configurable automation/review mechanisms.  
**Limitation:** GitHub-specific tooling; does not set universal merge/upgrade policy.

## [SEC01] NIST SP 800-218 — SSDF 1.1
**URL:** https://csrc.nist.gov/pubs/sp/800/218/final  
**Evidence:** `E4 — FINAL_GOVERNMENT_SECURITY_FRAMEWORK`  
**Finding:** secure software development/vulnerability handling is lifecycle work.  
**Status:** final baseline at cutoff.

## [SEC02] NIST SP 800-218 Rev.1 — SSDF 1.2
**URL:** https://csrc.nist.gov/pubs/sp/800/218/r1/ipd  
**Evidence:** `E4 — GOVERNMENT_DRAFT`  
**Status:** Initial Public Draft at cutoff.  
**Rule:** informative watch item only; do not represent as final.

## [SEC03] CISA — Known Exploited Vulnerabilities Catalog
**URL:** https://www.cisa.gov/known-exploited-vulnerabilities-catalog  
**Evidence:** `E4 — GOVERNMENT_EXPLOITATION_CATALOG`  
**Finding:** CISA describes KEV as an authoritative source of vulnerabilities exploited in the wild and recommends using it as an input to prioritization.  
**Limitation:** absence is not proof of safety/non-exploitation.

## [REG01] European Commission — Cyber Resilience Act summary / manufacturers
**URLs:**  
- https://digital-strategy.ec.europa.eu/en/policies/cra-summary  
- https://digital-strategy.ec.europa.eu/en/policies/cra-manufacturers  
**Evidence:** `E0/E4 — BINDING_EU_REGULATION + OFFICIAL_GUIDANCE`  
**Finding:** in-scope manufacturers have lifecycle cybersecurity/support-period and vulnerability-handling obligations under phased applicability.  
**Limitation:** applicability is role/product/jurisdiction-specific; legal analysis required.

## [REG02] European Commission / ENISA — CRA reporting
**URLs:**  
- https://digital-strategy.ec.europa.eu/en/policies/cra-reporting  
- https://www.enisa.europa.eu/topics/product-security/vulnerability-services/eu-incident-response-and-cyber-crisis-management/single-reporting-platform-srp  
**Evidence:** `E0/E4 — OFFICIAL_CURRENT_GUIDANCE`  
**Finding:** reporting obligations for manufacturers began 11 September 2026; ENISA SRP is operational.  
**Use here:** example of why lifecycle/security facts require current review.

---

# 49. Evidence-weighted conclusions

## High confidence

- Maintenance is a distinct lifecycle discipline [MNT01][LIFE01].
- Lifecycle responsibility includes retirement, not only development/operations [LIFE01].
- Assurance should scale with integrity/consequence [VV01].
- Change risk is reduced by smaller, observable, recoverable changes where architecture permits [OPS01][OPS03].
- Compatibility includes more than schema shape; semantics matter [API03].
- HTTP deprecation and sunset are distinct signals [API01][API02].
- Technical-debt prioritization does not have one validated universal formula [DEBT02].
- Active exploitation is a material vulnerability-prioritization input [SEC03].
- Protocol/schema compatibility rules are technology-specific [SCH01].

## Strong contextual defaults

- expand/migrate/contract [PAT01];
- progressive/canary release [OPS01];
- incremental displacement [PAT02];
- automated dependency PRs/review [DEP01];
- shadow/differential migration;
- feature flags.

## House synthesis

- M0–M4 migration classes;
- Safe Change Control Plane;
- Mixed-Version Safety Matrix;
- Irreversibility Ledger;
- technical-debt dispositions;
- deprecation state machine;
- eight quality gates.

These are derived mechanisms, not external standards.

---

# 50. Known uncertainties and review watchlist

1. Future revision/alignment of ISO/IEC/IEEE 14764 with the 2026 lifecycle edition.
2. Finalization of NIST SSDF 1.2.
3. Long-term empirical evidence for AI-assisted large-scale modernization/refactoring.
4. Better validated technical-debt prioritization/economic measurement methods.
5. Emerging schema/API deprecation telemetry standards beyond HTTP.
6. Regulatory guidance/standards supporting the EU CRA through full application in 2027.
7. Empirical comparison of large online migrations vs planned-downtime strategies across contexts.
8. Automated consumer discovery accuracy in polyglot/distributed/agentic systems.
9. Best assurance methods for model/provider migrations in AI systems whose behavior changes without traditional API breakage.

---

# 51. Definition of Ready

A material maintenance/migration initiative is ready when:

- [ ] desired outcome is explicit;
- [ ] current constraint/failure is evidenced;
- [ ] system/capability owner is known;
- [ ] M-level assigned;
- [ ] protected invariants identified;
- [ ] current state/source-of-truth mapped;
- [ ] material consumers/readers/writers known or uncertainty recorded;
- [ ] support/EOL/security constraints checked;
- [ ] compatibility dimensions selected;
- [ ] online/offline migration decision made;
- [ ] verification/reconciliation approach feasible;
- [ ] required specialist/security/privacy/legal input identified.

---

# 52. Definition of Done

A material migration/evolution change is done only when all applicable items pass.

## Outcome
- [ ] target behavior/capability meets acceptance conditions;
- [ ] protected invariants hold;
- [ ] user/business outcome is not materially degraded.

## State
- [ ] target source-of-truth/authority explicit;
- [ ] data reconciliation complete;
- [ ] no unexplained divergence;
- [ ] late/partial migration cases resolved.

## Compatibility
- [ ] supported consumers migrated or remain intentionally supported;
- [ ] mixed-version window ended or is intentionally maintained;
- [ ] obsolete compatibility path removed when no longer justified.

## Recovery
- [ ] post-cutover recovery strategy current;
- [ ] no obsolete rollback claim remains after irreversible state change.

## Security/privacy
- [ ] permissions/secrets/data handling correct;
- [ ] temporary migration access removed;
- [ ] retention/deletion obligations satisfied.

## Cleanup
- [ ] feature flags/shims/adapters/jobs removed or explicitly owned;
- [ ] old schema/state path removed when appropriate;
- [ ] temporary infrastructure closed.

## Governance
- [ ] docs/ADR/runbooks updated;
- [ ] lifecycle/support inventory updated;
- [ ] residual debt/risk recorded;
- [ ] evidence retained proportionate to risk.

## Retirement
- [ ] identities/integrations/resources closed where applicable;
- [ ] post-retirement zombie check complete.

---

# 53. V1 → V2 audit trace

| Audit finding | V2 disposition |
|---|---|
| Compatibility dimensions incomplete | Expanded §15 |
| Mixed-version coexistence under-specified | Added §16 |
| Rollback over-weighted | Added §24 recovery modes |
| One “point of no return” insufficient | Added §23 Irreversibility Ledger |
| Reconciliation too weak | Expanded §21 |
| Dual-write semantics too soft | Expanded §22 |
| Planned downtime missing | Added §17.2 + §37 |
| Refactor semantics too coarse | Expanded §12–13 |
| Modernization too binary | Expanded §14 + decision router |
| Microservices risk of cargo cult | Explicit anti-target §14.3 |
| Technical-debt false precision | Expanded §27 |
| Dependency urgency too generic | Expanded §25 |
| Dependency scope too narrow | §25.1 |
| Deprecation states collapsed | §28 |
| Emergency compatibility-break missing | §28.6 |
| Retirement observation missing | §29.4 |
| Retention/deletion conflict weak | §29.2 + §32 |
| Agentic autonomy under-specified | §33 |
| DORA freshness | §44 + source status |
| ISO maintenance/lifecycle edition nuance | §6 + [MNT01]/[LIFE01] |

---

# 54. Release status

**V2 status: `REVIEWED`.**

The research/falsification gate is complete for this release and all V1 BLOCKER/MAJOR audit findings have been addressed in the V2 text.

The artifact is **not yet `VALIDATED`** because the Master Playbook Standard requires representative real/non-author execution for that status.

Recommended next validation set:

1. zero/low-downtime PostgreSQL-style schema migration;
2. breaking external REST/API deprecation;
3. dependency/runtime major upgrade under security pressure;
4. legacy monolith incremental modernization;
5. multi-terabyte backfill with interruption/restart;
6. full service retirement with personal-data retention/deletion constraints;
7. AI-agent-generated migration with controlled tool execution.

---

# 55. Change log

## 2.0 — 2026-09-27

V2 replaces V1 after a falsification/freshness audit.

Major additions:

- state/authority-first safe-change model;
- Mixed-Version Safety Matrix;
- Irreversibility Ledger;
- online vs planned-downtime decision logic;
- full reconciliation standard;
- dual-write failure semantics;
- richer compatibility dimensions;
- behavior classification for refactoring;
- modernization portfolio and anti-target rule;
- broader dependency lifecycle;
- active-exploitation/support-aware upgrades;
- evidence-disciplined technical-debt management;
- explicit deprecation state machine;
- emergency compatibility-break path;
- full retirement/data/identity teardown;
- agentic maintenance controls;
- eight quality gates;
- updated 2026 source/status checks.

## 1.0-DRAFT — 2026-09-27

Initial research draft. Superseded by V2.
