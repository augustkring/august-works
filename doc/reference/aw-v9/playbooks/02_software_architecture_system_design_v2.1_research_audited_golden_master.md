# 02 — Software Architecture & System Design — V2.1 Research-Audited Golden Master

> **Evidence-Based Evergreen Standard for Software Architecture and System Design**
>
> **Golden Master release:** research-reviewed, falsification-weighted, technology-neutral, decision-oriented.

```yaml
document_id: PB-02-ARCH
title: 02 — Software Architecture & System Design
version: 2.1
release_name: Research-Audited Golden Master
status: REVIEWED
created: 2026-09-27
last_updated: 2026-09-27
supersedes: 2.0
deep_research_audit: PB-02-ARCH-AUDIT-2
research_cutoff: 2026-09-27
canonical_language: English
artifact_type: domain_capability_playbook
primary_archetype:
  - decision
  - capability
  - operating
  - execution
inherits:
  - MPS-001 Master Playbook Standard v2.0-RC1
  - Universal Software & AI Engineering Master Playbook v2.0
default_rigor: R3_CONTROLLED_for_material_production_architecture
critical_overlay: R4_CRITICAL
volatility:
  principles: stable
  architecture_methods: moderate
  cloud_platform_guidance: fast
  ai_agent_guidance: fast
owner: UNASSIGNED — must be named before VALIDATED
review_cadence: 6-12_months_plus_event_driven
status_note: >
  Research-Audited Golden Master denotes the canonical research/falsification release for this playbook series.
  It is REVIEWED rather than VALIDATED because representative non-author field execution
  and cross-domain architecture decision trials have not yet been completed.
```

---

# Executive standard

Software architecture is **consequential system design under uncertainty**.

It is not the diagram, framework, cloud provider, service count, deployment platform, pattern catalogue, or title of the person making decisions. It is the set of structures, boundaries, state and authority arrangements, interaction semantics, trust and failure assumptions, deployment choices, and evolutionary constraints that materially determine whether a software-intensive system can satisfy its intended outcomes over time.

The core chain is:

> **Outcome → Stakeholders & concerns → Constraints → Quality scenarios → Invariants & risks → Candidate architectures → Trade-offs → Evidence → Decision → Verification → Production evidence → Evolution**

The Golden Master doctrine is:

> **Design the least complex system that can demonstrably satisfy its current and credibly foreseeable requirements; make state, authority, trust, ordering, failure, ownership and recovery explicit; spend distributed-system and platform complexity only where it buys a named outcome; verify architectural claims with evidence suited to the risk; and evolve through small, observable, reversible steps whenever possible.**

---

# V2 falsification verdict

V2 is the result of a V1 construction pass followed by a deliberate falsification, contradiction, freshness and architecture-assurance audit.

The audit specifically attempted to break claims around:

- microservices vs monoliths;
- DDD and bounded contexts;
- event-driven architecture;
- synchronous vs asynchronous integration;
- consistency/CAP-style slogans;
- queues and backpressure;
- retries;
- multi-region;
- serverless;
- Kubernetes;
- tenancy isolation;
- build vs buy;
- “zero trust”;
- architecture decision records;
- architecture diagrams/documentation;
- fitness functions;
- migration/rewrites;
- formal methods;
- AI/agentic architecture.

### What survived strongly

- architecture must begin from intended outcomes and stakeholder concerns;
- quality requirements must be concrete enough to evaluate;
- architecture is a trade-space, not a style contest;
- information hiding, cohesion, controlled coupling and explicit ownership remain durable;
- state, write authority, consistency, ordering and failure must be explicit;
- distributed boundaries impose real costs and partial failure;
- security/privacy/reliability/operability/evolution are architecture concerns, not late additions;
- risk and irreversibility must determine evidence burden;
- architecture descriptions must remain traceable to the actual system;
- consequential decisions need rationale and revisit triggers;
- architecture must be continuously tested against runtime evidence and change.

### What V2 rejects as universal doctrine

- microservices-first or monolith-first;
- database-per-service as literal law;
- “pick two” CAP as a complete architecture decision model;
- eventual consistency as a scalability badge;
- event-driven as inherently decoupled;
- serverless as inherently cheaper;
- Kubernetes as required for production scale;
- multi-region as automatically more reliable;
- zero trust as a product/topology recipe;
- CQRS/event sourcing as default enterprise architecture;
- “clean architecture” as universally optimal;
- full DDD as necessary for domain correctness;
- architecture boards/ADRs/diagrams as proof of architecture quality.

---


# V2.1 deep research verdict

V2.1 is a second, broader research pass over the full V1—not a cosmetic update to V2.0.

The deep audit:

- re-verified the current ISO/IEC/IEEE architecture standards and their 2026 revision status;
- audited all 70 V1 Golden Architecture Principles individually;
- audited all major V1 sections and all 35 original sources;
- searched for contrary evidence and known failure modes;
- added architecture erosion/conformance research;
- added formal CAP-scope discipline;
- added socio-technical dependency evidence;
- added reference-architecture evaluation evidence;
- added newer ML/GenAI/agentic architecture evidence;
- strengthened architecture→verification traceability;
- rechecked serverless/microservices/DDD claims for over-generalization.

**Result:** V1's central doctrine survives. No BLOCKER error was found in its direction. The main corrections are about **scope, evidence strength, completeness, and avoiding false universality**.

The strongest new rule is:

> **An architecture claim is not trustworthy merely because the intended design, reference architecture, diagram or ADR says so. For material properties, trace the claim through the implemented mechanism to appropriate verification and observed operational evidence.**

Absolute “100% correctness” is not claimed. The Golden Master target is **no known material factual error at the evidence cutoff, explicit uncertainty, current source status, fit-for-question evidence, and bounded contextual claims**.

---
# 1. How to use this playbook

Use this playbook when:

- creating a new material system;
- making a consequential architecture decision;
- reviewing an architecture;
- decomposing or consolidating services;
- selecting data/consistency patterns;
- designing integrations and workflows;
- designing multitenancy;
- designing for failure and recovery;
- choosing deployment/runtime topology;
- planning modernization/migration;
- evaluating a platform/vendor;
- designing AI/agentic systems;
- assessing whether an existing architecture still fits its requirements.

Do not execute every section mechanically.

Use four navigation layers:

1. **Orientation** — doctrine, terminology, principles.
2. **Decision** — frameworks, trade-off tables, decision trees.
3. **Execution** — plays, templates, review procedures.
4. **Assurance** — evidence, audit, testing, source status, change triggers.

---

# 2. Normative language and rule status

This playbook uses:

- **MUST / MUST NOT** — house requirement for production use within this standard; deviations require explicit rationale/risk acceptance where material.
- **SHOULD / SHOULD NOT** — strong default with contextual exceptions.
- **MAY** — optional technique.
- **JUDGMENT REQUIRED** — a competent context-sensitive decision is required.

Rule status:

| Class | Meaning |
|---|---|
| `REQ` | externally binding/applicable requirement |
| `EST` | strongly established mechanism/principle |
| `DEF` | recommended default |
| `CTX` | context-dependent practice |
| `EMG` | emerging practice |
| `HOUSE` | deliberate internal standard |
| `EXP` | hypothesis/experiment |
| `UNK` | unresolved material uncertainty |

Architecture patterns are generally `CTX`, not `EST`.

---

# 3. Scope

## In scope

- software architecture;
- system design;
- system decomposition;
- integration architecture;
- distributed systems design;
- data/state architecture at system level;
- trust/failure/ownership boundaries;
- cloud/on-prem/edge/hybrid topology;
- multitenancy;
- resilience/recovery design;
- architecture decision governance;
- architecture evaluation;
- architecture evolution/migration;
- AI/agent architecture at system level.

## Specialist overlays

Use deeper playbooks for:

- requirements/domain engineering;
- security engineering;
- privacy;
- databases/data engineering;
- distributed systems/protocols;
- performance/capacity;
- SRE/reliability;
- cloud/platform engineering;
- testing/V&V;
- AI/ML/LLM;
- agentic AI;
- embedded/real-time;
- safety/regulatory domains.

This architecture playbook coordinates those concerns; it does not replace their detailed controls.

---

# 4. Evidence architecture

Different sources answer different architecture questions.

| Evidence lane | Strongest use | Misuse to avoid |
|---|---|---|
| Binding requirement | what must be true in scope | calling legal minimum technically optimal |
| International/formal standard | concepts, process/quality/assurance baselines | assuming every control is necessary everywhere |
| Systematic review/meta evidence | aggregate empirical patterns | ignoring heterogeneous implementations |
| Foundational formal/research result | mechanism/property | treating model result as complete implementation recipe |
| Mature operational evidence | demonstrated mechanisms at real scale | copying scale-specific implementation |
| Official protocol/platform docs | exact semantics/capabilities | treating vendor recommendation as universal |
| Practitioner pattern | useful design option | laundering popularity into “best practice” |
| Local evidence | fit in the actual system | generalizing local result universally |

### Source-status discipline

Current standards at cutoff include:

- ISO/IEC/IEEE 42010:2022;
- ISO/IEC/IEEE 42020:2019;
- ISO/IEC/IEEE 42030:2019;
- ISO/IEC/IEEE 15288:2023;
- ISO/IEC/IEEE 12207:2026;
- ISO/IEC 25010:2023.

Watch items:
- ISO/IEC/IEEE AWI 42020 Edition 2 — under development;
- ISO/IEC/IEEE AWI 42030 Edition 2 — under development.

Draft/watch material MAY inform future direction but MUST NOT silently replace current published baselines.

---

# 5. Canonical architecture terminology

## 5.1 Architecture

For this playbook:

> **Architecture is the consequential organization and design of a system—its structures, relationships, boundaries, rules, state/authority arrangements and decisions—that materially influence its qualities, risks, operation and evolution.**

## 5.2 Architecture description

A representation of architecture for a purpose and audience.

Examples:
- diagrams;
- models;
- text;
- ADRs;
- interface/data views;
- deployment views.

An architecture description is not the architecture itself.

## 5.3 Architecture view

A representation addressing a selected set of stakeholder concerns.

## 5.4 Viewpoint

A reusable convention for constructing/interpreting a type of view.

## 5.5 Architecturally significant requirement

A requirement whose satisfaction could materially change structure, state, interfaces, trust/failure boundaries, deployment, technology, ownership or lifecycle economics.

## 5.6 Architecturally significant decision

A decision that materially affects:
- system structure;
- critical quality attributes;
- hard-to-reverse choices;
- cross-team contracts;
- data/authority boundaries;
- failure/operational model;
- major cost/risk.

## 5.7 Architecture evidence

Evidence that a claimed property is true or sufficiently likely:
- tests;
- measurements;
- benchmarks;
- runtime telemetry;
- incident history;
- formal analysis;
- review findings;
- threat models;
- restore/failover exercises;
- cost data;
- user/operator evidence.

---

# 6. Architecture quality model

Architecture quality is multi-dimensional and context-weighted.

Ask at least:

1. **Intent fit** — does it support the real user/business/mission outcome?
2. **Functional correctness** — can required behavior/invariants be preserved?
3. **State integrity** — can data become contradictory/lost/duplicated/reordered?
4. **Security** — can unauthorized behavior occur?
5. **Privacy** — is sensitive data exposure minimized/controlled?
6. **Safety** — can architecture contribute to unacceptable physical/mission harm?
7. **Reliability** — does it meet user-relevant service expectations?
8. **Resilience** — does it contain and recover from plausible failure?
9. **Performance/capacity** — does it meet workload objectives under normal/overload conditions?
10. **Interoperability/compatibility** — can components/versions/partners evolve safely?
11. **Operability** — can the system be understood, controlled and restored?
12. **Observability/diagnosability** — can material internal states/failures be inferred from evidence?
13. **Maintainability** — can changes remain comprehensible and local enough?
14. **Evolvability** — can likely future requirements be adopted at acceptable cost/risk?
15. **Deployability/change safety** — can changes be introduced and contained?
16. **Accessibility/interaction quality** — where human-facing.
17. **Cost/resource efficiency** — lifecycle/unit economics.
18. **Supply-chain/provider risk** — dependency/provenance/exit.
19. **Auditability** — can consequential actions/decisions be reconstructed?
20. **Organizational fit** — can the responsible organization operate the design?

Do not create one “architecture score” unless a domain-specific validated method justifies it.

---

# 7. Constraint, threshold, optimization

Each material quality requirement SHOULD be classified.

### Constraint
Cannot be violated within scope.

Examples:
- cross-tenant data access MUST NOT occur;
- prohibited data MUST NOT leave region;
- unauthorized principal MUST NOT execute privileged action.

### Threshold
Must meet an objective.

Examples:
- RTO ≤ 60 minutes;
- p99 ≤ 300 ms at workload W;
- monthly availability ≥ agreed SLO.

### Optimization
Improve subject to trade-offs.

Examples:
- lower cost;
- lower latency beyond threshold;
- faster developer iteration;
- lower cognitive load.

Do not trade below constraints merely because another quality improves.

---

# 8. Quality-attribute scenarios

Bare words such as “scalable”, “secure” and “highly available” are not adequate architecture requirements.

Use:

```yaml
scenario_id:
stakeholder:
quality_attribute:
source:
stimulus:
environment:
artifact_or_capability:
expected_response:
response_measure:
constraint_or_threshold:
guardrails:
assumptions:
evidence_method:
```

Example:

```yaml
scenario_id: PERF-ORDER-01
stakeholder: checkout user
quality_attribute: performance
source: authenticated customer
stimulus: submits valid order
environment: production, normal peak, 95th percentile expected concurrency
artifact_or_capability: order submission
expected_response: durable acceptance or explicit rejection
response_measure: p99 end-to-end response <= 350 ms
constraint_or_threshold: threshold
guardrails:
  - no duplicate order
  - authorization/inventory/payment invariants preserved
evidence_method:
  - representative load test
  - production latency SLI
```

---

# 9. Criticality and architecture-assurance burden

Architecture assurance scales with:

```text
CONSEQUENCE
× EXPOSURE
× IRREVERSIBILITY
× UNCERTAINTY
× BLAST RADIUS
× AUTONOMY
÷ (RECOVERABILITY × DETECTABILITY)
```

This is a reasoning model, not arithmetic.

## A0 — exploratory
- disposable;
- no material users/data;
- basic boundary/security hygiene.

## A1 — ordinary
- recoverable business impact;
- peer review;
- tests/monitoring.

## A2 — material
- customer/revenue/data dependency;
- explicit quality scenarios;
- architecture review;
- threat/failure/data review;
- staged release/recovery evidence.

## A3 — high assurance
- major financial/privacy/security/societal consequence;
- independent review;
- stronger traceability;
- controlled migration;
- failure/recovery exercises;
- targeted formal analysis where useful.

## A4 — safety/mission/regulatory critical
- specialist domain standards govern;
- qualified assurance;
- independent V&V;
- hazard/safety case/formal controls as required.

---

# 10. Golden architecture standards — V2

These are the root architecture rules.

## Intent and decision quality

1. **MUST** define the real outcome and system boundary before selecting architecture style.
2. **MUST** identify material constraints and architecturally significant requirements.
3. **MUST** distinguish constraints, thresholds and optimizations.
4. **SHOULD** represent material quality concerns as scenarios.
5. **MUST** make consequential assumptions visible.
6. **SHOULD** convert critical assumptions into tests, monitors or experiments where practical.
7. **MUST** scale assurance with consequence and irreversibility.
8. **SHOULD** prefer the least irreversible adequate option when evidence is otherwise comparable.
9. **SHOULD** use evidence to reduce decision-relevant uncertainty rather than to decorate a preferred answer.
10. **MUST** preserve unresolved material uncertainty instead of inventing certainty.

## Complexity and boundaries

11. **SHOULD** minimize unjustified complexity.
12. **MUST NOT** use “simple” to justify omitting required security, failure or data controls.
13. **SHOULD** use information hiding to contain volatile design decisions.
14. **SHOULD** prefer semantic cohesion and controlled coupling.
15. **MUST** make boundary responsibilities and ownership explicit.
16. **MUST** justify process/network/service boundaries by a material benefit.
17. **MUST NOT** treat service count as maturity.
18. **SHOULD** keep logical boundaries separable from physical deployment where useful.
19. **SHOULD** avoid shared mutable state across ownership boundaries.
20. **MUST** define authority where multiple components can change the same logical fact.

## State, data and consistency

21. **MUST** define the authoritative source for material persistent facts.
22. **MUST** define permitted writers for material state.
23. **MUST** identify invariants whose violation is unacceptable.
24. **MUST** choose consistency/coordination from invariants and user semantics, not fashion.
25. **MUST NOT** infer global causal order from wall-clock timestamps without a guaranteed mechanism.
26. **SHOULD** use the weakest coordination model that still preserves required invariants and semantics.
27. **MUST** define conflict semantics where concurrent writes can occur.
28. **MUST** define ordering scope for messages/events where order matters.
29. **SHOULD** make duplicate delivery safe when retry/replay is plausible.
30. **MUST** define reconciliation when multiple representations can diverge.

## Interfaces and interaction

31. **MUST** define interface success **and failure** semantics.
32. **MUST** include authorization semantics at trust boundaries.
33. **SHOULD** define deadline/cancellation semantics for remote work.
34. **MUST** define compatibility/evolution for long-lived contracts.
35. **MUST** define event/message delivery, ordering, retry/replay and poison-message semantics where applicable.
36. **MUST NOT** assume asynchronous interaction removes coupling.
37. **SHOULD** use synchronous interaction for bounded immediate work when it fits the latency/failure budget.
38. **SHOULD** use asynchronous interaction only when buffering/decoupling/durability/fan-out/long-running work buys material value.
39. **MUST** model partial completion across transaction boundaries.
40. **MUST** distinguish compensation from true rollback.

## Failure, load and recovery

41. **MUST** treat remote/dependent work as potentially slow, unavailable or wrong.
42. **MUST** have a finite policy for waiting/cancellation where blocked work consumes material resources.
43. **MUST** retry only plausible transient failures that are safe to repeat.
44. **MUST** bound retry attempts/time/cost.
45. **SHOULD** have one clear retry owner per dependency path.
46. **MUST** bound queues/in-flight work where overload can exhaust resources.
47. **MUST** define overload behavior for capacity-bearing services.
48. **SHOULD** shed/degrade low-priority work before total collapse when domain permits.
49. **MUST NOT** degrade security, authorization, safety or data integrity to preserve superficial availability.
50. **MUST** define recovery objectives where loss/outage is material.
51. **MUST** test restoration for material systems.
52. **SHOULD** design blast-radius isolation around actual failure domains.
53. **SHOULD** test degraded modes that operators rely on.

## Security, privacy and tenancy

54. **MUST** treat trust as explicit; internal network location alone is insufficient authorization.
55. **MUST** enforce consequential authorization outside client presentation and outside AI model persuasion.
56. **SHOULD** default privileged capability to least privilege.
57. **MUST** model security architecture across lifecycle, not as final testing.
58. **MUST** treat privacy as a separate data-lifecycle concern.
59. **SHOULD** minimize sensitive collection, replication, access and retention.
60. **MUST** enforce tenant isolation in multitenant systems.
61. **MUST** test cross-tenant negative paths where tenant data/actions are material.
62. **SHOULD** treat noisy-neighbor isolation separately from confidentiality isolation.

## Reliability, performance and operations

63. **MUST** define user-relevant reliability rather than infrastructure vanity availability.
64. **SHOULD** define SLOs where ongoing service reliability decisions benefit from them.
65. **MUST** model workload/percentiles where latency/capacity are architecturally significant.
66. **MUST** test overload behavior when scale can exhaust capacity.
67. **SHOULD** measure before optimizing unless a known hard constraint requires design-time action.
68. **MUST** define cache staleness/invalidation before relying on cache correctness.
69. **MUST** design observability around operational and business/state questions.
70. **MUST** make material releases attributable to version/configuration.
71. **SHOULD** provide safe operator controls for stop/drain/replay/repair when relevant.
72. **MUST** assign operational ownership for production architecture.

## Evolution and migration

73. **MUST** treat architecture as lifecycle state, not a one-time phase.
74. **SHOULD** prefer backward-compatible transition paths while active consumers depend on them.
75. **SHOULD** use expand/migrate/contract for live schema/contract changes when suitable.
76. **MUST** co-design rollback/roll-forward with state compatibility.
77. **SHOULD** prefer incremental modernization when it reduces risk.
78. **MAY** use replacement/big-bang migration when coexistence is infeasible and evidence/controls justify it.
79. **MUST** define deprecation/removal ownership for long-lived contracts.
80. **SHOULD** remove obsolete compatibility paths once safe.

## Architecture records and evidence

81. **MUST** record architecturally significant decisions.
82. **MUST NOT** create ADR bureaucracy for trivial choices.
83. **MUST** include alternatives/trade-offs/revisit triggers for consequential ADRs.
84. **SHOULD** keep architecture descriptions close enough to the system that drift is detectable.
85. **MUST NOT** treat diagram conformance as proof of system behavior.
86. **SHOULD** automate architecture fitness checks for enforceable properties.
87. **MUST NOT** treat passing fitness checks as complete architecture assurance.
88. **SHOULD** use prototypes/benchmarks/modeling where they reduce material uncertainty.
89. **SHOULD** use independent review as consequence increases.
90. **MUST** revisit architecture when assumptions, evidence, incidents, scale, regulation or operating context materially change.

## Pattern discipline

91. **MUST NOT** choose microservices, event sourcing, CQRS, serverless, Kubernetes, multi-region, service mesh, zero trust products or any other named pattern solely by popularity.
92. **SHOULD** treat modular monoliths as first-class production architectures.
93. **SHOULD** treat microservices as justified distributed boundaries, not default decomposition.
94. **MUST NOT** map every domain boundary to a service automatically.
95. **MUST NOT** use “database per service” as a literal universal requirement.
96. **MUST NOT** equate event-driven architecture with absence of coupling.
97. **MUST NOT** claim serverless is cheaper without workload economics.
98. **MUST NOT** claim multi-region is more reliable without tested failure semantics.
99. **MUST NOT** use multi-cloud solely as a generic lock-in control.
100. **MUST** judge patterns by demonstrated fit to requirements and total operational consequences.

---

# 11. Architecture lifecycle

Architecture responsibilities recur throughout delivery.

```text
FRAME
→ UNDERSTAND CURRENT SYSTEM / CONTEXT
→ ELICIT ARCHITECTURALLY SIGNIFICANT REQUIREMENTS
→ MODEL QUALITY SCENARIOS + INVARIANTS
→ IDENTIFY RISKS / UNCERTAINTY / IRREVERSIBILITY
→ GENERATE ALTERNATIVES
→ ANALYZE TRADE-OFFS
→ PROTOTYPE / MEASURE / MODEL
→ DECIDE + RECORD
→ IMPLEMENT IN INCREMENTS
→ VERIFY ARCHITECTURE PROPERTIES
→ RELEASE WITH OBSERVABILITY
→ LEARN FROM PRODUCTION
→ REVISIT / EVOLVE / RETIRE
```

No phase implies waterfall sequencing. Activities can be iterative and concurrent.

---

# 12. Stakeholders, concerns, views and viewpoints

Architecture communication SHOULD begin from questions stakeholders need answered.

Common stakeholders:

- users/customers;
- product/business owner;
- developers;
- operators/SRE;
- security/privacy;
- data/analytics;
- finance/FinOps;
- legal/compliance;
- support;
- downstream consumers/partners;
- procurement/vendor management;
- safety/domain specialists;
- AI/model-risk stakeholders where applicable.

Common concerns:

- required behavior;
- performance/capacity;
- resilience/recovery;
- security/privacy;
- data ownership;
- integration;
- cost;
- operability;
- migration;
- change ownership;
- compliance;
- user impact.

Useful views:

1. **Context view** — system and external actors/systems.
2. **Responsibility/logical view** — modules/components/services and responsibilities.
3. **Data/state view** — facts, stores, write authority, flows, classifications.
4. **Interaction view** — critical runtime sequences/messages.
5. **Deployment view** — runtime nodes, regions/zones, infrastructure/failure domains.
6. **Security/trust view** — identities, trust boundaries, privileged paths.
7. **Operational view** — SLOs, telemetry, controls, recovery.
8. **Migration/evolution view** — coexistence, cutover, compatibility.
9. **Cost/capacity view** — dominant resources, scaling units, unit economics.
10. **AI/agent control view** — model, memory, tools, policy, approvals, side effects.

Do not create every view by default.

---

# 13. Architecture documentation rules

A useful architecture description:

- states scope;
- states audience;
- states current/as-is vs proposed/to-be;
- has explicit element/relationship meanings;
- uses consistent names;
- labels trust/failure/ownership boundaries where material;
- identifies source of truth for the model;
- links material decisions to ADRs;
- links quality claims to evidence;
- has owner/version/date;
- can be updated without uncontrolled copy-paste drift.

### C4

C4 is a practical, notation-independent visualization method.

Use:
- system context and container views for many teams;
- component views selectively;
- code views only when they add durable value or can be generated.

Do not treat C4 as a complete architecture method or standard.

### arc42

arc42 is a useful practitioner documentation structure. Use it when its sections improve decision/communication value; omit empty template ceremony.

---

# 14. System context and boundary standard

A material system MUST make these boundaries recoverable:

```yaml
system_of_interest:
users:
external_systems:
data_entering:
data_leaving:
trust_boundaries:
failure_boundaries:
ownership_boundaries:
transaction_boundaries:
tenant_boundaries:
region_or_residency_boundaries:
operational_boundary:
```

Boundary questions:

1. What outcome/responsibility is inside?
2. What state does it own?
3. What policy/decision does it own?
4. What changes independently?
5. What fails independently?
6. What deploys independently?
7. Who operates it?
8. What is hidden?
9. What must callers know?
10. What tax is paid to cross it?

---

# 15. Coupling taxonomy

Coupling is not one number.

Assess:

- **code coupling** — compile/import dependency;
- **data coupling** — shared schema/state assumptions;
- **temporal coupling** — must parties be available at same time?;
- **behavioral coupling** — one party depends on another's business semantics;
- **deployment coupling** — changes must ship together;
- **operational coupling** — one failure/maintenance event affects another;
- **security coupling** — shared credential/trust/policy;
- **organizational coupling** — coordination across owners;
- **release coupling** — feature exposure must align;
- **economic coupling** — cost/limit of one component controls another.

A move from sync API to events may reduce temporal coupling while increasing schema/replay/operational coupling.

---

# 16. Modularity and information hiding

A strong module boundary:

- owns a coherent domain/capability responsibility;
- hides volatile implementation details;
- owns state or policy where appropriate;
- exposes a deliberate interface;
- controls dependencies;
- makes illegal cross-boundary access difficult;
- supports local reasoning and testing.

A weak module boundary:

- exists only to satisfy a folder/layer template;
- proxies another module one-to-one;
- leaks internal schema;
- requires callers to know internals;
- shares most state;
- changes whenever unrelated modules change.

### Module test

```text
If implementation choice X changes:
  which modules should change?
  which modules actually change?
```

If the blast radius is much larger than intended, the boundary is weak.

---

# 17. Domain modeling and socio-technical design

DDD concepts are useful where domain complexity is material.

Use:
- domain language;
- domain concepts/invariants;
- bounded contexts;
- context relationships;
- anti-corruption boundaries.

Do not require:
- entities/value objects/aggregates everywhere;
- repositories for every persistence access;
- microservice per bounded context;
- a particular event model.

Organization matters, but do not use team structure as a deterministic service-decomposition algorithm.

A boundary SHOULD make sense in:
- domain semantics;
- ownership;
- change pattern;
- data authority;
- operational responsibility.

---

# 18. State architecture

For every material state object/fact:

```yaml
state_id:
semantic_definition:
authoritative_source:
authority_owner:
writers:
readers:
invariants:
transaction_boundary:
consistency:
ordering:
conflict_policy:
derived_copies:
reconciliation:
retention:
deletion:
backup:
restore:
classification:
tenant_scope:
region_scope:
migration:
```

### One fact, one authority

A fact may have many copies.

It SHOULD have one clear authority or a well-defined conflict-resolution protocol.

Derived copies:
- caches;
- search indexes;
- analytics stores;
- materialized views;
- replicas.

Derived copies require:
- freshness expectation;
- rebuild/reconciliation;
- failure behavior.

---

# 19. Invariants first

Examples:

```text
payment.captured_total <= order.authorized_total

shipment.status = DISPATCHED
→ order.fulfillment_ready = true

tenant(A) != tenant(B)
→ A cannot read/write B-owned resource

credential.revoked = true
→ privileged_action cannot be authorized

inventory.available >= 0
```

Architecture exists partly to preserve invariants under:
- concurrency;
- failure;
- retry;
- reordering;
- stale state;
- region/network partition;
- migration;
- operator repair.

---

# 20. Consistency taxonomy

Use the business semantics first.

Possible concerns:

- read-your-writes;
- monotonic reads;
- causal consistency;
- session consistency;
- bounded staleness;
- linearizability;
- serializable transactions;
- snapshot semantics;
- eventual convergence.

Do not choose a label without stating:

```yaml
operation:
required_invariant:
what_may_be_stale:
max_acceptable_staleness:
conflict_possible:
conflict_resolution:
availability_requirement_during_partition:
coordination_cost:
user_visible_effect:
```

### CAP discipline

Do not use “pick two” as a global system-design algorithm.

Instead ask:

- what partition/failure is considered?;
- which operation/invariant is involved?;
- may the operation reject/block?;
- may stale/conflicting state be returned?;
- what is the recovery/convergence path?

---

# 21. Coordination decision

Coordination is justified when required to preserve an invariant or semantic guarantee.

Coordination can be expensive because it can:
- add latency;
- reduce availability during failure/partition;
- reduce parallelism;
- create contention hotspots.

Avoiding coordination can:
- increase concurrency;
- improve availability;
- improve scale;
- require conflict/reconciliation semantics.

Use invariant-level reasoning.

---

# 22. Concurrency

For each contended state:

- define concurrency unit;
- define lock/version scope;
- define conflict;
- define retry;
- define side effects;
- define timeout;
- define deadlock/starvation implications where relevant.

Use optimistic concurrency when:
- conflicts are uncommon;
- retry is safe;
- stale overwrite is unacceptable.

Use pessimistic/serialized mechanisms when:
- conflicts are frequent;
- invariant failure is unacceptable;
- work cannot safely retry after side effects.

---

# 23. Ordering and time

Distinguish:

```text
physical time
monotonic local duration
causal order
message broker order
partition/key order
transaction serialization order
commit order
business-effective time
user-visible order
```

Rules:

- use monotonic clocks for local elapsed durations when available;
- do not treat timestamps as conflict resolution unless semantics justify it;
- define clock-skew/time-source assumptions when time affects correctness;
- define ordering scope, not just “ordered”;
- treat “latest write wins” as a business conflict policy, not a free technical default.

---

# 24. Data partitioning and sharding

Partition only when scale/isolation/placement requires it.

Choose key from:

- access locality;
- load distribution;
- tenant isolation;
- transaction boundaries;
- growth;
- region/data residency.

Risks:
- hot keys;
- skew;
- cross-shard queries;
- cross-shard transactions;
- rebalancing;
- tenant movement;
- key changes;
- operational repair.

Partition strategy requires telemetry for distribution and hotspots.

---

# 25. Interface contract standard

A material interface MAY need:

```yaml
purpose:
owner:
consumer:
identity_and_authz:
input:
semantic_validation:
output:
error_model:
idempotency:
deadline:
cancellation:
retry_guidance:
ordering:
consistency:
rate_limits:
pagination_or_streaming:
compatibility:
versioning:
deprecation:
privacy:
observability:
```

### Error contracts

Errors SHOULD distinguish where useful:

- validation/client error;
- authentication;
- authorization;
- conflict;
- rate/resource limit;
- transient dependency failure;
- timeout;
- internal failure;
- unavailable;
- async accepted/in-progress.

Do not expose sensitive internals merely for diagnosability.

---

# 26. Synchronous interaction

Use when:

- caller needs immediate result;
- total latency is bounded;
- dependency failure semantics are acceptable;
- interaction is simple enough to reason about.

Failure tax:
- availability coupling;
- latency accumulation;
- thread/connection/resource accumulation;
- cascading failures;
- nested retries.

For call chains, manage end-to-end deadline rather than independent arbitrary timeouts.

---

# 27. Asynchronous interaction

Use when:

- user does not need immediate completion;
- work is long-running;
- temporary dependency unavailability should be buffered;
- fan-out is natural;
- replay/audit/stream semantics are valuable.

Costs:
- delayed failures;
- duplicates;
- reordering;
- eventual visibility;
- queue operations;
- schema evolution;
- replay hazards;
- harder tracing;
- user-facing progress state.

---

# 28. Event and message architecture

For every durable message/event:

```yaml
name:
type: event | command | reply | notification
business_semantics:
producer:
owner:
consumers:
schema:
schema_compatibility:
delivery_semantics:
ordering_scope:
deduplication:
idempotency:
retry:
backoff:
quarantine_or_dlq:
retention:
replay:
replay_side_effect_policy:
privacy:
authorization:
correlation:
observability:
```

### Event rule

An event states something that happened.

A command asks an authority to do something.

The distinction matters for:
- ownership;
- authorization;
- replay;
- deduplication;
- response semantics.

---

# 29. Orchestration vs choreography

## Orchestration

A coordinator manages workflow state.

Benefits:
- visible process state;
- centralized timeout/retry/compensation;
- easier operational understanding for complex workflows.

Costs:
- coordinator coupling;
- potential bottleneck/central dependency;
- workflow ownership concentration.

## Choreography

Participants react to events.

Benefits:
- local autonomy;
- looser direct availability coupling;
- incremental extension.

Costs:
- emergent workflow;
- difficult global reasoning;
- hidden dependencies;
- event storms;
- harder failure/compensation tracking.

Default:
- use orchestration when one business process needs explicit end-to-end state/ownership;
- use choreography when independent reactions are genuinely autonomous.

---

# 30. Distributed transactions and partial completion

Before adopting a distributed transaction protocol, ask whether the business process can tolerate:

- reservation;
- compensation;
- delayed completion;
- reconciliation;
- exception handling.

Patterns:
- local transaction + outbox;
- inbox/deduplication;
- saga orchestration;
- saga choreography;
- reservation/confirm/cancel;
- reconciliation job;
- human repair queue.

Do not describe a compensating business action as exact rollback.

---

# 31. Outbox/inbox

Use transactional outbox when:
- state update and message publication must not diverge;
- local DB transaction can atomically store domain state + outbox record.

Outbox still requires:
- publisher retry;
- duplicate handling;
- event ordering policy;
- retention/cleanup;
- monitoring stuck records.

Inbox/deduplication can make consumer effects idempotent.

---

# 32. Failure-engineering standard

For each material dependency:

```yaml
dependency:
what_if_slow:
what_if_unavailable:
what_if_partial:
what_if_wrong:
what_if_stale:
what_if_duplicate:
what_if_reordered:
what_if_rate_limited:
what_if_compromised:
what_if_recovery_overlaps:
timeout:
retry:
fallback:
isolation:
recovery:
observability:
owner:
```

Partial failure is normal when work spans independently failing boundaries.

---

# 33. Deadlines, timeouts and cancellation

### Total-deadline rule

```text
user/business deadline
  ≥ local processing
  + dependency budgets
  + retry allowance
  + network variability
```

Do not set independent timeouts whose sum exceeds useful work lifetime.

Cancellation:
- SHOULD propagate when downstream work is expensive and runtime/protocol permits;
- MUST NOT assume timed-out work stopped.

---

# 34. Retry discipline

Retry only when:

- failure is plausibly transient;
- repeat is idempotent/deduplicated/known-not-applied;
- total deadline remains;
- rate/cost budget permits;
- dependency is not overloaded beyond safe retry policy.

Controls:
- max attempts;
- max elapsed time;
- exponential/backoff strategy as appropriate;
- jitter/de-correlation;
- circuit/overload feedback;
- one retry owner.

Avoid multiplicative retry stacks.

---

# 35. Queue/backpressure standard

Every material queue SHOULD define:

```yaml
producer_rate:
consumer_capacity:
burst_assumption:
max_depth:
max_age:
admission:
priority:
fairness:
backpressure:
load_shedding:
dead_letter_or_quarantine:
replay:
recovery_rate:
alerts:
```

A queue can absorb a burst.

A queue cannot make sustained input greater than service capacity disappear.

---

# 36. Load shedding and degradation

Use when permitted by product semantics.

Candidates:
- reject low-priority requests;
- per-tenant throttling;
- disable expensive optional features;
- stale-but-safe read;
- read-only mode;
- reduced precision/quality;
- defer background work.

Never degrade:
- authorization;
- tenant isolation;
- safety constraints;
- financial/data integrity;
- legally required controls.

---

# 37. Failure domains and isolation

Potential domains:
- process;
- host;
- container;
- zone;
- region;
- provider;
- tenant;
- dependency;
- queue/worker pool;
- credential/policy;
- data partition.

Isolation mechanisms:
- separate pools;
- quotas;
- rate limits;
- partitioning;
- bulkheads;
- circuit breaking;
- deployment stamps;
- separate credentials;
- separate data planes.

Isolation costs money and complexity; use it around credible shared failure.

---

# 38. Reliability architecture

Reliability MUST be defined through user/system outcomes.

Candidate objects:
- availability;
- successful completion;
- latency;
- freshness;
- correctness;
- durability.

SLOs are useful when:
- service operation is ongoing;
- teams need explicit change/reliability decisions;
- measurement is credible.

Do not use 100% by prestige.

---

# 39. Recovery and disaster architecture

For material data/service:

```yaml
rto:
rpo:
failure_scope:
backup:
backup_immutability_if_needed:
restore:
restore_credentials:
restore_dependencies:
failover:
failback:
reconciliation:
validation:
authority:
exercise_cadence:
```

Backups without demonstrated restoration are hypotheses.

---

# 40. Performance architecture

Specify workload.

```yaml
workload:
  requests_per_second:
  concurrent_users_or_jobs:
  payload_distribution:
  data_size:
  key_skew:
  read_write_mix:
  geographic_distribution:
latency:
  p50:
  p95:
  p99:
throughput:
resource_limits:
dependency_budget:
overload_behavior:
growth:
```

Average latency alone is rarely enough for user-critical online paths.

---

# 41. Capacity model

Capacity planning asks:

1. what is the scaling unit?
2. what becomes saturated first?
3. what is the safe operating limit?
4. how quickly can capacity expand?
5. what if auto-scaling lags?
6. what if dependency quota is lower?
7. what happens beyond limit?

Load test:
- expected peak;
- burst;
- sustained overload;
- dependency slowdown;
- recovery after overload.

---

# 42. Caching decision

Use cache only after defining:

- source of truth;
- staleness tolerance;
- key/cardinality;
- invalidation;
- eviction;
- stampede protection;
- tenant/privacy isolation;
- failure mode;
- rebuild/warmup.

Cache failure should not silently create incorrect authority.

---

# 43. Security architecture

Architecture-level security MUST include:

- assets;
- actors;
- identities;
- trust boundaries;
- privileged operations;
- authorization points;
- credential paths;
- data flows;
- supply-chain/build trust;
- admin/repair paths;
- logging;
- compromise/revocation;
- recovery.

Security is an emergent system property; it is not created by adding a gateway or final penetration test.

---

# 44. Zero Trust

Use NIST-style principles:

- no implicit trust solely because of network location/ownership;
- authenticate/authorize subjects and devices/resources as appropriate;
- make access policy explicit;
- continuously evaluate relevant context where required;
- minimize privilege.

Zero Trust is not:
- a VPN replacement product;
- a service mesh requirement;
- “trust nobody” as a literal operational model;
- one universal network diagram.

---

# 45. Privacy architecture

Architectural privacy controls:

- minimize collection;
- separate identity where possible;
- reduce replication;
- scope access;
- isolate tenants;
- redact telemetry;
- automate retention/deletion;
- control backups;
- control cross-region transfer;
- classify AI prompts/embeddings/memory/tool traces as data stores when applicable.

---

# 46. Multitenancy architecture

Tenant isolation is mandatory; topology is contextual.

Isolation dimensions:

| Dimension | Shared | Partial | Isolated |
|---|---|---|---|
| identity | shared IdP context | tenant policy | dedicated identity plane |
| compute | pooled | tenant group/stamp | dedicated |
| data | shared schema/table | separate schema/database | dedicated stack |
| network | shared | segmented | dedicated |
| keys/secrets | shared service with tenant scoping | per-tenant key | dedicated vault/stack |
| deployment | shared | stamp/ring | tenant-specific |
| operations | unified | tiered | isolated with unified control plane |

Trade-offs:
- security/compliance;
- cost;
- noisy neighbor;
- blast radius;
- performance;
- customization;
- quota;
- fleet operations.

Required tests:
- cross-tenant authorization;
- data isolation;
- cache/index isolation;
- queue/event isolation;
- observability redaction;
- noisy-neighbor load;
- tenant deletion/export where required.

---

# 47. Control plane vs data plane

Separate when doing so clarifies privilege and failure.

**Control plane** may manage:
- configuration;
- identity/policy;
- deployment;
- tenant lifecycle;
- orchestration;
- metadata.

**Data plane** performs:
- user workload;
- request processing;
- business/data operations.

Benefits:
- privilege separation;
- operational isolation;
- clearer blast radius.

Risk:
- control-plane outage can prevent recovery or configuration;
- stale configuration/policy synchronization;
- additional architecture complexity.

---

# 48. Observability architecture

Observability exists to support decisions.

Design around questions:

- Is the user outcome working?
- Which cohort/tenant/region/version is affected?
- Which dependency contributes latency?
- Is state stale/divergent?
- Is a queue falling behind?
- Are invariants being violated?
- Did a release/config change trigger failure?
- Is an agent/model action anomalous?
- Can we reconstruct a consequential side effect?

Signals:
- metrics;
- logs;
- traces;
- events;
- audit records;
- domain correctness/reconciliation measures.

---

# 49. Operability

A production architecture SHOULD define safe mechanisms for:

- start/stop;
- drain;
- maintenance;
- feature/capability disable;
- rate limit;
- replay;
- reprocess;
- reconcile;
- repair;
- revoke credentials;
- rotate secrets;
- failover;
- restore;
- inspect configuration/state.

Manual repair paths are privileged production interfaces and MUST be controlled/audited proportionately.

---

# 50. Deployment architecture

Separate:

- logical module;
- process;
- deployment unit;
- scaling unit;
- failure unit;
- ownership unit.

They may align, but do not assume they must.

Deployment view SHOULD show:
- compute/runtime;
- zones/regions;
- network/trust boundaries;
- data stores;
- queues;
- control planes;
- external dependencies;
- scaling/failure domains.

---

# 51. Single region vs multi-region

## Single region is often preferable when

- recovery objective can be met with backups/passive strategy;
- latency is acceptable;
- regulatory placement allows;
- complexity budget is limited.

## Multi-region can be justified by

- disaster objective;
- user latency/geography;
- regulatory/data-residency;
- major business continuity.

Before active-active:
- define write authority;
- consistency;
- conflicts;
- replication lag;
- routing;
- failover/failback;
- regional dependency behavior;
- region isolation;
- operator controls;
- cost.

A second region adds failure modes as well as redundancy.

---

# 52. Cloud, on-prem, edge and hybrid

Choose from requirements.

## Cloud
Buys:
- elasticity;
- managed services;
- fast provisioning;
- broad service ecosystem.

Costs:
- provider semantics;
- variable cost;
- quotas;
- service concentration;
- egress/data location;
- exit complexity.

## On-prem/self-host
Buys:
- direct infrastructure control;
- specialized hardware/locality;
- some regulatory/latency benefits.

Costs:
- capacity ownership;
- hardware lifecycle;
- patching/operations;
- slower provisioning unless platform capability is strong.

## Edge
Use when:
- latency;
- offline operation;
- bandwidth;
- local data/control;
- physical proximity matter.

Adds:
- fleet updates;
- intermittent connectivity;
- data synchronization;
- physical compromise;
- heterogeneous hardware.

## Hybrid/multi-cloud
Only when concrete requirements outweigh duplicate platform complexity.

---

# 53. Platform engineering boundary

Build internal platform capability when repeated product teams need:

- standardized deployment;
- identity/policy;
- observability;
- secrets;
- networking;
- runtime;
- data services;
- developer self-service.

Avoid creating a platform as an architecture vanity project.

Platform interface SHOULD:
- reduce cognitive load;
- offer safe defaults;
- expose escape hatches for legitimate needs;
- have product ownership;
- measure adoption/outcome;
- avoid forcing lowest-common-denominator abstractions.

---

# 54. Architecture economics

Every material design SHOULD consider lifetime economics.

Cost dimensions:

```yaml
build_cost:
migration_cost:
cloud_infrastructure:
managed_service_premium:
storage:
network_egress:
observability:
licenses:
ai_inference:
security_compliance:
operator_labor:
incident_cost:
on_call_burden:
support:
upgrade:
exit_cost:
opportunity_cost:
```

### Unit economics

Where scale matters define:
- cost per request;
- cost per active tenant;
- cost per workflow;
- cost per GB/month;
- cost per model task;
- cost per region.

A cheaper infrastructure choice can be false economy if it raises incident or engineering burden.

---

# 55. Build vs buy vs managed vs open source

Use:

```yaml
capability:
strategic_differentiation:
requirements_fit:
security:
privacy:
reliability:
performance:
integration:
operability:
supplier_health:
license:
roadmap_control:
data_portability:
customization:
skills:
total_cost:
exit_cost:
concentration_risk:
fallback:
```

### Default
Commodity capability SHOULD be bought/managed/adopted when a mature option meets requirements and lifecycle risk is acceptable.

Core differentiation MAY justify build.

### Lock-in discipline

Track:
- provider lock-in;
- data lock-in;
- API/protocol lock-in;
- internal platform lock-in;
- skill lock-in;
- contractual lock-in;
- operational lock-in.

“Build it ourselves” is not lock-in-free.

---

# 56. Architecture style catalogue — rule

A style is a **candidate bundle of trade-offs**.

For every style ask:

1. What requirement does it satisfy?
2. What complexity does it introduce?
3. What failure modes appear?
4. What organizational capability is required?
5. How is success verified?
6. How can we migrate away?

No style below is a maturity level.

---

# 57. Modular monolith

## Use when
- one deployment unit is acceptable;
- local transactions/calls simplify correctness;
- independent service scaling/release is not material;
- strong internal modularity can contain change.

## Buys
- simpler deployment;
- easier local transactions;
- fewer network failures;
- simpler observability;
- lower operational burden.

## Risks
- weak module boundaries;
- shared database coupling;
- long build/test/deploy if large;
- synchronized release;
- organizational contention.

## Controls
- enforced internal dependencies;
- module ownership;
- local APIs;
- architecture tests;
- explicit data ownership.

---

# 58. Microservices

## Use when independent value exists in
- deployment;
- scaling;
- failure isolation;
- security isolation;
- lifecycle;
- technology;
- team ownership.

## Costs
- distributed state;
- network failure/latency;
- service discovery/routing;
- API/event compatibility;
- observability;
- security surface;
- fleet operations;
- duplicated infrastructure;
- data migration;
- end-to-end testing.

## Service extraction test

```yaml
candidate_service:
business_capability:
owned_state:
owned_invariants:
independent_scaling_need:
independent_release_need:
failure_isolation_value:
security_isolation_value:
ownership:
sync_dependencies_created:
async_dependencies_created:
cross_service_transactions:
operational_cost:
migration_plan:
evidence:
```

If the boundary has no meaningful ownership/state/capability and mostly chatters with its parent, do not extract.

---

# 59. Layered architecture

Useful for dependency/order of responsibility.

Risk:
- pass-through layers;
- anemic domain;
- horizontal change touching every layer;
- hidden runtime coupling.

Use layers to encode real separation, not folder convention.

---

# 60. Ports and adapters / hexagonal style

Useful when:
- core rules need insulation from volatile IO/framework/vendor details;
- testing the core independently has value.

Risk:
- interface/adapter explosion;
- abstracting stable/simple dependencies;
- ceremony hiding straightforward code.

---

# 61. Service-oriented architecture

SOA is a broad family rather than one modern recipe.

Use service boundaries when business/integration/ownership needs justify them.

Avoid arguing “SOA vs microservices” by labels; compare:
- deployment independence;
- governance;
- state;
- protocols;
- service granularity;
- team ownership;
- operational model.

---

# 62. Event-driven architecture

Use when:
- reactions are naturally asynchronous;
- multiple consumers;
- streaming;
- replay;
- loose temporal availability coupling.

Costs:
- event schema evolution;
- duplicates/reorder;
- workflow visibility;
- eventual state;
- debugging;
- replay safety;
- consumer lag.

Do not use events to hide unclear ownership.

---

# 63. Serverless / FaaS

Use when:
- execution model fits event/request-driven work;
- burst/idle profile benefits;
- managed operations have value;
- platform constraints are acceptable.

Consider:
- cold/warm latency;
- max duration/runtime;
- state/external storage;
- concurrency;
- cost curve;
- observability;
- local/test parity;
- vendor event/IAM semantics;
- exit.

Do not assume cheaper or simpler at every workload.

---

# 64. CQRS

Separate command/write model from query/read model when their requirements materially diverge.

Candidate drivers:
- complex write invariants;
- radically different read shape/scale;
- independent read projections;
- event-driven integration.

Costs:
- duplicate models;
- synchronization;
- eventual visibility;
- operational complexity.

Do not use CQRS as synonym for “separate endpoint folders”.

---

# 65. Event sourcing

Use when event history itself is first-class domain state.

Potential benefits:
- temporal history;
- replay/reconstruction;
- audit;
- derived projections.

Costs:
- event immutability/evolution;
- privacy deletion;
- projection rebuild;
- replay side effects;
- debugging current state;
- migration;
- storage growth.

Event sourcing is not required for an audit log.

---

# 66. Microkernel/plugin

Use when:
- stable core;
- independently installable extensions;
- product ecosystem/customization.

Define:
- plugin API;
- version compatibility;
- permissions/sandbox;
- lifecycle;
- failure isolation;
- signing/supply chain where relevant.

---

# 67. Pipe/filter/dataflow

Use when:
- transformations form clear stages;
- independent processing/reuse;
- streaming/batch dataflow.

Costs:
- serialization;
- state between stages;
- error/retry semantics;
- lineage;
- backpressure.

---

# 68. Actor model

Useful when:
- many stateful concurrent entities;
- serialized per-actor state;
- message-based interaction.

Costs:
- distribution/location semantics;
- mailbox overload;
- delivery/order;
- cross-actor transactions;
- debugging.

Use only if the runtime/mental model reduces actual concurrency complexity.

---

# 69. Cell / stamp architecture

Use when:
- tenant/cohort isolation;
- blast-radius reduction;
- scale-out by repeated unit.

Requires:
- routing;
- tenant/cell placement;
- capacity/rebalancing;
- control plane;
- fleet deployment;
- cross-cell data/analytics plan.

---

# 70. Edge/offline-first architecture

Use when connectivity cannot be assumed.

Requires:
- local authority model;
- sync/conflict rules;
- identity offline;
- clock/time assumptions;
- queued side effects;
- data encryption;
- fleet update;
- reconciliation.

---

# 71. Architecture pattern anti-composition rule

Patterns interact.

Example:

```text
microservices
+ event-driven
+ per-service database
+ multi-region
+ Kubernetes
+ service mesh
+ event sourcing
```

is not “more architectural”.

It compounds:
- state count;
- operational surfaces;
- failure combinations;
- security boundaries;
- deployment artifacts;
- cognitive load.

Add one mechanism only when its incremental value exceeds its incremental system tax.


# 72. Core architecture decision framework

Use this sequence for consequential decisions before debating products/patterns.

## Step 1 — State the decision

```yaml
decision:
decision_owner:
deadline:
why_now:
current_state:
```

## Step 2 — State the outcome

What real user/business/system outcome must improve or remain protected?

## Step 3 — Identify constraints

- law/regulation;
- safety;
- security/privacy;
- latency;
- availability;
- consistency;
- data residency;
- budget;
- schedule;
- existing platform;
- team skills;
- contract/partner;
- migration.

## Step 4 — State invariants

What MUST remain true?

## Step 5 — State uncertainty

Which assumptions, unknowns or future scenarios could change the decision?

## Step 6 — Generate alternatives

Include where legitimate:
- current state/do nothing;
- simplest incremental change;
- build;
- buy/managed;
- hybrid;
- alternative style.

## Step 7 — Map failure modes

For each option:
- how does it fail?;
- what is blast radius?;
- how detectable?;
- how reversible?;
- what is recovery burden?

## Step 8 — Map quality trade-offs

```yaml
correctness:
security:
privacy:
reliability:
resilience:
performance:
operability:
maintainability:
compatibility:
cost:
organizational_fit:
reversibility:
```

## Step 9 — Gather evidence

Select only methods that could change the decision.

## Step 10 — Prefer least-complex adequate option

If multiple options satisfy constraints with comparable evidence, prefer:
- fewer distributed boundaries;
- lower cognitive burden;
- clearer authority;
- smaller blast radius;
- easier observability;
- easier migration/exit.

## Step 11 — Record rationale

## Step 12 — Define verification

## Step 13 — Define revisit triggers

---

# 73. Architecture evidence selection

| Uncertainty | Useful evidence |
|---|---|
| latency/capacity | representative benchmark/load/soak/overload test |
| provider feature semantics | current official documentation + prototype |
| failure recovery | failure injection/game day/restore test |
| service decomposition | change-history/domain/ownership analysis + migration spike |
| DB consistency | invariant analysis + concurrency/transaction test |
| cost | workload model + bill simulation/pilot |
| user workflow | prototype/user test |
| security boundary | threat model + authorization tests + review |
| tenant isolation | cross-tenant negative tests + load isolation test |
| migration | representative rehearsal + reconciliation |
| AI behavior | representative evals + red team + user test + production monitoring |
| high-consequence state machine | formal model/model checking + implementation tests |

Do not use a proof-of-concept that omits the hardest property as evidence for that property.

---

# 74. Reversibility and option value

Classify consequential decisions:

### R0 — easy reversible
- config;
- small internal implementation detail.

### R1 — reversible with bounded migration
- library;
- service interface;
- data representation with conversion.

### R2 — expensive reversible
- database family;
- cloud service deep integration;
- deployment topology;
- public API.

### R3 — highly irreversible
- externally embedded protocol;
- customer data model with huge footprint;
- critical vendor/platform contract;
- physical/safety interface;
- destructive migration.

As reversibility decreases:
- increase evidence;
- preserve migration path;
- reduce simultaneous novelty;
- use staged commitment.

---

# 75. Service decomposition framework

A service boundary is justified by one or more strong drivers, not by code size.

Evaluate:

| Driver | Question |
|---|---|
| capability | is there a coherent capability with stable responsibility? |
| state | can it own meaningful state/invariants? |
| ownership | can one team own operation and change? |
| release | is independent deployment materially valuable? |
| scaling | does workload need independent scaling? |
| failure | does isolation reduce meaningful blast radius? |
| security | does isolation improve protection materially? |
| lifecycle | does it evolve on a meaningfully different cadence? |

Then subtract the distributed tax:

- network latency;
- partial failure;
- auth/service identity;
- contract compatibility;
- observability;
- data duplication;
- cross-service transactions;
- deployment/fleet management;
- local development/testing;
- incident coordination.

Extract only if net value remains material.

---

# 76. Consolidation framework

Consider consolidating services when:

- boundaries mostly proxy each other;
- changes/releases are tightly coupled;
- cross-service transactions dominate;
- separate ownership does not exist;
- independent scaling/failure value is absent;
- network/operational tax dominates;
- service granularity prevents local reasoning.

Consolidation is not architectural regression if it reduces unjustified distribution while preserving modular boundaries.

---

# 77. API style decision

## HTTP/REST-style resource interface
Good when:
- broad ecosystem/interoperability;
- cacheable/resource semantics;
- web/client compatibility.

## RPC
Good when:
- action-oriented internal APIs;
- strongly typed contracts;
- low overhead/streaming via suitable protocols.

## GraphQL
Good when:
- client-driven composition reduces multiple tailored endpoints;
- frontend data-shape diversity is high.

Costs:
- authorization/query complexity;
- cost control;
- caching/observability;
- schema governance.

## Events/messages
Good when:
- asynchronous facts/workflow;
- fan-out;
- buffering;
- replay.

Do not choose interface style by ideology. Define semantics first.

---

# 78. API gateway decision

Add gateway when it materially centralizes:
- external ingress;
- authentication integration;
- rate limiting;
- routing;
- API policy;
- observability;
- protocol adaptation.

Do not place domain authorization/business logic indiscriminately in the gateway.

Gateway failure can become a system-wide dependency; design scaling/recovery accordingly.

---

# 79. Backend-for-Frontend (BFF)

Use when:
- materially different client experiences need tailored aggregation/policies;
- it reduces client coupling/chattiness.

Costs:
- duplicated orchestration;
- extra deployment;
- authorization consistency.

Do not create a BFF per screen by habit.

---

# 80. Service mesh decision

Use when many service-to-service interactions need consistently managed:
- mTLS;
- identity;
- routing;
- telemetry;
- policy;
- retries/timeouts where safely centralized.

Costs:
- control/data plane complexity;
- opaque behavior;
- resource overhead;
- debugging;
- duplicated application-level policies.

A mesh cannot determine business idempotency, authorization semantics or safe retries for you.

---

# 81. Queue decision

Add a queue when at least one is material:
- caller should not wait;
- burst absorption;
- durable work handoff;
- consumer independence;
- controlled concurrency;
- replay.

Before adoption define:
- delivery semantics;
- max age/depth;
- duplicate policy;
- ordering;
- retry;
- poison-message strategy;
- backpressure;
- monitoring.

Do not add a queue merely to “decouple services”.

---

# 82. Database decision

Start with required semantics.

## Relational default is strong when
- transactions/invariants matter;
- relationships/query flexibility matter;
- constraints are useful.

## Document/key-value/column/time-series/graph/search systems
are justified when their model/access pattern materially fits.

Decision dimensions:
- transaction/consistency;
- query model;
- data volume;
- latency;
- write pattern;
- indexing;
- partitioning;
- operations;
- ecosystem;
- backup/restore;
- cost;
- portability.

Avoid “polyglot persistence” without a reason; each datastore creates operational and knowledge cost.

---

# 83. Shared database vs separate data stores

The fundamental rule is ownership/write authority.

### Shared physical DB MAY be acceptable when
- schemas/permissions isolate ownership;
- transaction needs benefit;
- scale/operations simpler;
- teams can preserve boundaries.

### Separate DB/storage is useful when
- lifecycle/failure/security/isolation needs justify it;
- independent scaling;
- independent backup/residency.

Do not let a shared database become unrestricted cross-service table coupling.

---

# 84. Search/index decision

Use dedicated search/index when:
- ranking/full-text/aggregation requirements exceed primary DB fit;
- derived index can tolerate/reconcile lag.

Define:
- source of truth;
- indexing pipeline;
- freshness;
- rebuild;
- deletion/privacy;
- consistency;
- fallback.

Search index SHOULD NOT silently become authoritative business state.

---

# 85. Cache decision tree

```text
Measured latency/load/cost problem?
 ├─ NO → do not cache yet
 └─ YES
     Can authoritative query/computation be improved economically?
       ├─ YES → improve source first
       └─ NO
           Can acceptable staleness be stated?
             ├─ NO → cache may be incompatible with semantics
             └─ YES
                 Can invalidation/failure/isolation be defined and tested?
                   ├─ NO → redesign
                   └─ YES → pilot and measure
```

---

# 86. Sync vs async decision tree

```text
Must caller know result now?
 ├─ YES
 │   Can total dependency path meet deadline/reliability?
 │     ├─ YES → synchronous candidate
 │     └─ NO → redesign user/workflow boundary
 └─ NO
     Does async materially buy buffering, durability, fan-out or decoupled availability?
       ├─ NO → simpler sync/local path may be better
       └─ YES → async candidate; define delivery/order/retry/replay/progress
```

---

# 87. Orchestration vs choreography decision tree

```text
Is there one end-to-end business process with owned state and deadlines?
 ├─ YES → orchestration is strong candidate
 └─ NO
     Are reactions genuinely autonomous and extensible?
       ├─ YES → choreography candidate
       └─ NO → avoid emergent event workflow; clarify ownership
```

---

# 88. Stronger consistency decision tree

```text
Can stale/concurrent results violate a material invariant?
 ├─ YES → use sufficient coordination/transaction/serialization
 └─ NO
     Does weaker consistency buy material latency/availability/scale?
       ├─ YES → define explicit stale/conflict semantics and use it
       └─ NO → prefer simpler stronger semantics
```

---

# 89. Multi-region decision tree

```text
Concrete regional latency / recovery / residency requirement?
 ├─ NO → do not add region complexity
 └─ YES
     Can passive/backup simpler design meet it?
       ├─ YES → prefer simpler recovery topology
       └─ NO
           Define write topology, consistency, conflict, failover and tests
```

---

# 90. Build vs buy decision tree

```text
Is capability differentiating/core to strategy?
 ├─ NO → mature external/managed/OSS option meets constraints?
 │        ├─ YES → prefer external option; manage dependency/exit
 │        └─ NO → build missing minimum
 └─ YES
     Does owning implementation create value/control worth lifetime cost?
       ├─ YES → build candidate
       └─ NO → external/hybrid candidate
```

---

# 91. Kubernetes decision tree

```text
Do we have many workloads needing orchestration/platform controls beyond simpler runtime?
 ├─ NO → use simpler PaaS/managed runtime/VM/container service
 └─ YES
     Do we have capability to operate platform safely?
       ├─ NO → managed platform or simpler option
       └─ YES → Kubernetes may be justified
```

Kubernetes is not a synonym for cloud-native architecture.

---

# 92. Serverless decision tree

```text
Is workload request/event oriented and compatible with platform limits?
 ├─ NO → other runtime
 └─ YES
     Does managed elasticity/operations create material value?
       ├─ NO → compare simpler persistent runtime
       └─ YES
           model latency, cost, state, observability, IAM and exit
```

---

# 93. Multi-cloud decision framework

Strong reasons:
- binding customer/regulatory requirement;
- acquisition/portfolio reality;
- disaster model that truly requires provider diversity;
- product itself must run across providers;
- strategic procurement constraint.

Weak generic reason:
- “avoid lock-in”.

Multi-cloud creates:
- lowest-common-denominator pressure;
- duplicate IAM/network/observability;
- operational skill burden;
- data transfer/consistency problems;
- test matrix growth.

Prefer portable **interfaces/data and exit plans** over full active portability when that meets the real requirement.

---

# 94. Multi-tenancy decision framework

For each architecture layer choose:

```yaml
layer:
tenant_identity_propagation:
isolation_requirement:
pool_silo_bridge:
noisy_neighbor_limit:
data_residency:
encryption_key_scope:
quota:
failure_blast_radius:
cost:
operations:
test:
```

Use hybrid isolation when high-value tenants/data need stronger boundaries without fully duplicating the entire product.

---

# 95. Feature flag architecture

Flags are runtime state.

For material flags:

```yaml
flag:
owner:
purpose:
default:
targeting:
dependencies:
security_impact:
data_schema_impact:
rollback_behavior:
expiry:
cleanup:
observability:
```

Risks:
- combinatorial state;
- hidden production variants;
- authorization misuse;
- stale flags;
- test explosion.

Feature flags are not a substitute for safe schema/state migration.

---

# 96. Configuration architecture

Configuration SHOULD be:

- typed/validated;
- versioned where material;
- observable;
- scoped;
- secret-separated;
- safely defaulted;
- owned;
- change-audited.

Avoid:
- untyped “string maps” for critical policy;
- hidden environment drift;
- configuration that silently changes invariant semantics without review.

---

# 97. Secrets and credential architecture

Design:
- identity source;
- credential issuance;
- scope;
- lifetime;
- rotation;
- revocation;
- storage;
- audit;
- break-glass.

Prefer short-lived identity/federation where supported over duplicated long-lived secrets.

---

# 98. Authorization architecture

Authorization question:

> May principal P perform action A on resource R in context C now?

Architecture MUST define:
- enforcement point;
- policy source;
- tenant/resource scope;
- privileged/admin bypass rules;
- audit;
- revocation propagation;
- fail behavior.

Role names alone are not complete authorization semantics.

---

# 99. Data privacy / residency decision

For each sensitive class:

```yaml
data_class:
purpose:
regions_allowed:
storage:
processing:
replication:
backup:
third_parties:
ai_use:
retention:
deletion:
access:
audit:
```

Do not claim regional compliance solely because the primary database is regional if logs/backups/analytics/model traces leave the boundary.

---

# 100. Architecture for AI/LLM systems

AI does not replace ordinary architecture.

Model subsystem introduces:
- probabilistic outputs;
- version drift;
- prompt/context state;
- model/provider dependency;
- evaluation datasets;
- cost/latency variability;
- safety/security failure modes.

Architecture SHOULD separate:
- deterministic system state;
- model-generated proposals;
- policy/authorization;
- tools/side effects;
- memory/retrieval;
- evaluation/monitoring.

---

# 101. Agentic architecture

Treat an agent as a probabilistic decision component connected to deterministic capabilities.

Canonical control model:

```text
USER / SYSTEM INTENT
        ↓
AGENT / PLANNER
        ↓ proposals
POLICY + AUTHORIZATION GATE
        ↓ allowed actions
TOOL / CAPABILITY LAYER
        ↓
STATE / EXTERNAL SIDE EFFECTS
        ↓
AUDIT + OBSERVABILITY + RECOVERY
```

The model MUST NOT be the final authorization authority for consequential actions.

---

# 102. Agent capability classes

### C0 — read-only public
Low side effect.

### C1 — read private / internal
Privacy and access controls.

### C2 — reversible internal write
Idempotency/audit/recovery.

### C3 — external consequential action
Messages, bookings, purchases, business updates.

### C4 — high-impact/irreversible/privileged
Production changes, deletion, credential grants, large financial actions.

Control burden increases with class.

---

# 103. Agent runtime controls

For C2+ as relevant:

- explicit agent identity;
- tool allowlist;
- resource/action policy;
- tenant scope;
- transaction/value limits;
- time/cost limits;
- bounded tool-call/loop count;
- idempotency;
- concurrency guards;
- approval thresholds;
- provenance;
- audit log;
- kill/revoke;
- partial-chain recovery.

A prompt saying “do not do X” is not an enforcement mechanism when bypass matters.

---

# 104. Agent memory architecture

Memory is persistent state.

Define:

```yaml
memory_type:
source:
provenance:
owner:
sensitivity:
tenant_scope:
write_rules:
conflict_rules:
freshness:
poisoning_defense:
retention:
deletion:
correction:
use_in_authorization: prohibited_or_controlled
```

Retrieved content MUST NOT silently redefine tool authorization.

---

# 105. AI evaluation architecture

For material AI applications combine evidence modes proportionately:

- model/task tests;
- representative scenarios;
- adversarial/red-team;
- user/human-in-loop tests;
- integration tests;
- production monitoring.

Pre-deployment evaluation cannot establish all real-world behavior.

Design:
- eval owner;
- version/model tracking;
- production feedback;
- incident taxonomy;
- drift/change triggers;
- rollback/provider fallback where feasible.

---

# 106. AI fallback/degradation

Define what happens when:
- model unavailable;
- timeout;
- safety/policy rejects;
- output schema invalid;
- confidence/evidence insufficient;
- provider quota reached;
- cost threshold exceeded;
- tool action fails halfway.

Fallback may be:
- deterministic path;
- human review;
- reduced capability;
- alternate provider;
- safe refusal.

Do not silently lower policy controls to preserve AI availability.

---

# 107. Architecture evolution strategy

Every long-lived system will face:
- changing requirements;
- schema/API evolution;
- dependency EOL;
- scale shifts;
- team changes;
- incidents;
- regulations;
- vendor changes.

Architect for migration seams where change is credible, not for every imaginable future.

---

# 108. Expand / migrate / contract

General live-change pattern:

```text
1. EXPAND — add compatible new capability/schema
2. DUAL SUPPORT — old and new coexist
3. MIGRATE — backfill/convert/shift traffic
4. VERIFY — reconcile and measure
5. STOP OLD USE
6. CONTRACT — remove old capability
```

Use for:
- DB schema;
- APIs;
- event contracts;
- configuration;
- service extraction.

---

# 109. Strangler Fig modernization

Useful when:
- legacy system must continue delivering;
- functionality can move incrementally;
- traffic/events can be intercepted/routed.

Requires:
- routing seam;
- source-of-truth plan;
- coexistence;
- data sync/reconciliation;
- migration observability;
- final retirement.

The value is risk reduction through incremental replacement, not the name of the pattern.

---

# 110. Parallel run / shadowing

Use to compare:
- old vs new output;
- performance;
- data reconciliation;
- model behavior.

Risks:
- duplicate external side effects;
- cost;
- privacy;
- misleading comparisons if inputs differ.

Shadow path SHOULD suppress or safely isolate irreversible effects.

---

# 111. Big-bang replacement

Higher burden of proof.

May be justified when:
- coexistence impossible;
- current platform cannot meet hard requirement;
- security/compliance makes continued use unacceptable;
- bounded scope;
- strong rehearsal/cutover/recovery possible.

Required:
- data migration rehearsal;
- compatibility;
- cutover plan;
- backout/forward plan;
- operator staffing;
- post-cutover validation.

---

# 112. Backward compatibility

Compatibility cost grows.

Maintain while:
- active consumers depend on behavior;
- migration window is valid.

Retire when:
- telemetry shows no legitimate use;
- support window closes;
- risk/complexity exceeds value.

A version number alone does not create compatibility.

---

# 113. Architecture debt

Architecture debt = a choice/constraint that increases future change, risk or operational cost.

Record:

```yaml
debt:
reason:
current_cost:
future_risk:
option_loss:
trigger:
remediation:
owner:
```

Do not call every disliked pattern “debt”.

---

# 114. Architecture Decision Record standard

Use ADR when decision is:
- structurally consequential;
- quality-affecting;
- cross-team;
- difficult/expensive to reverse;
- surprising enough that future teams will ask why.

Template:

```yaml
adr_id:
title:
status: proposed | accepted | superseded | deprecated | rejected
date:
decision_owner:
stakeholders:
context:
decision_question:
drivers:
constraints:
quality_scenarios:
invariants:
alternatives:
evidence:
decision:
rationale:
tradeoffs:
risks:
operational_effect:
security_privacy_effect:
cost_effect:
migration:
reversal_cost:
verification:
revisit_triggers:
supersedes:
```

---

# 115. ADR anti-patterns

Avoid:
- one ADR per package;
- rationale “best practice”;
- no alternatives;
- no negative consequences;
- accepted forever despite changed assumptions;
- ADR not linked to affected architecture;
- multiple contradictory active ADRs;
- ADR with no decision owner.

---

# 116. Architecture fitness functions

A fitness function is any repeatable check that protects an architecture property.

Examples:
- no dependency from domain to UI/framework package;
- no direct cross-tenant query without tenant predicate/policy;
- p99 under budget;
- API backward compatibility;
- no cyclic module dependency;
- all privileged tools pass policy gate;
- recovery RTO test;
- max queue age threshold;
- data residency test.

Each fitness check SHOULD map to:
- requirement/scenario;
- owner;
- failure response.

Do not optimize a fitness metric when it ceases to represent the requirement.

---

# 117. Architecture review levels

## Review L1 — Lean
- author + peer;
- top 3–5 drivers;
- obvious risks;
- key ADR.

## Review L2 — Standard
- product/engineering/operations;
- quality scenarios;
- alternatives;
- data/failure/security review;
- evidence.

## Review L3 — Controlled
- independent challenger;
- architecture utility tree;
- top scenarios;
- sensitivity/trade-off points;
- threat/data/reliability/operations/cost;
- migration/recovery;
- assurance record.

## Review L4 — Critical
- domain-qualified independent reviewers;
- traceability;
- formal V&V/safety/security assurance as applicable;
- retained evidence package;
- formal risk acceptance for unresolved material risk.

---

# 118. ATAM-lite play

Use when L2/L3 and full ATAM is disproportionate.

## Inputs
- architecture scope;
- business drivers;
- stakeholders;
- candidate architecture;
- quality scenarios.

## Procedure
1. State business/mission drivers.
2. Present architecture at relevant abstraction.
3. Collect quality scenarios.
4. Prioritize scenarios by importance/risk.
5. Walk scenarios through architecture.
6. Identify:
   - risk;
   - non-risk;
   - sensitivity point;
   - trade-off point;
   - assumption.
7. Define evidence/action for top risks.
8. Record ADRs/changes.
9. Define revisit triggers.

## Output
- top scenario list;
- risk register;
- trade-off record;
- evidence plan;
- decisions.

---

# 119. Full ATAM use

Consider full structured ATAM when:
- architecture is a major business/mission asset;
- many stakeholders;
- competing qualities;
- high cost of wrong decision;
- system is large/complex;
- independent facilitated evaluation adds value.

Do not run formal ATAM simply to claim maturity.

---

# 120. Architecture review questions

## Business/context
- What outcome does this architecture protect?
- Which constraint is actually binding?
- What changes are expected?

## State
- Where is truth?
- Who may write?
- What can conflict?
- What if messages repeat/reorder?

## Failure
- What fails together?
- What happens when dependency slows?
- What happens under overload?
- How is recovery demonstrated?

## Security/privacy
- Where does trust change?
- Who can authorize privileged action?
- What sensitive data is replicated unnecessarily?

## Operations
- How do we detect?
- How do we stop/drain/replay/repair?
- Who owns 03:00 failure?

## Economics
- dominant unit cost?
- operational labor?
- exit cost?

## Evolution
- hardest migration?
- irreversible choice?
- compatibility path?
- revisit trigger?

---

# 121. Architecture assurance package

For L3/L4 retain:

- scope/system context;
- criticality;
- architecturally significant requirements;
- quality scenarios;
- invariant/state authority record;
- threat/failure model;
- alternatives/trade-offs;
- ADRs;
- prototype/benchmark evidence;
- migration/recovery plan;
- architecture review findings;
- fitness/test evidence;
- unresolved risks;
- approvals;
- production monitoring/review triggers.

The package may live across version-controlled systems.

---

# 122. Architecture testing portfolio

Architecture can be tested.

### Static
- dependency rules;
- schema compatibility;
- policy/config linting;
- architecture constraints.

### Integration
- real dependency semantics;
- contract tests;
- authorization/tenant isolation.

### Dynamic
- load;
- overload;
- failover;
- restore;
- chaos/failure injection;
- region/dependency outage.

### Migration
- backfill;
- dual-version coexistence;
- rollback/roll-forward;
- reconciliation.

### Formal
- model checking;
- state-machine properties;
- concurrency invariants.

### Production
- canary;
- SLO/SLI;
- invariant/reconciliation monitors;
- incident learning.

---

# 123. Architecture failure-mode catalogue

## Boundary failures
1. wrong boundary;
2. boundary too fine;
3. boundary too coarse;
4. cyclic dependencies;
5. leaky abstraction;
6. shared mutable state;
7. unowned capability;
8. ownership crossing every change.

## State failures
9. dual source of truth;
10. lost update;
11. stale overwrite;
12. duplicate side effect;
13. out-of-order transition;
14. orphaned state;
15. irreversible schema incompatibility;
16. incomplete backfill;
17. stale derived index/cache.

## Distributed failures
18. timeout without cancellation;
19. retry storm;
20. queue saturation;
21. thundering herd;
22. split-brain/conflicting authority;
23. partial workflow;
24. poison message loop;
25. replay repeats side effect;
26. dependency latency cascade.

## Tenancy/security failures
27. cross-tenant read;
28. cross-tenant write;
29. tenant context lost in async job;
30. shared cache key collision;
31. admin path bypasses policy;
32. overprivileged service identity;
33. control plane compromise;
34. secret/log leakage.

## Reliability/operations failures
35. failover never tested;
36. backup cannot restore;
37. fallback itself fails;
38. monitoring sees infrastructure but not user failure;
39. alert noise masks incident;
40. manual repair corrupts state;
41. multi-region dependency is actually single-region.

## Change failures
42. rollback incompatible with new schema;
43. old consumer breaks after producer release;
44. event contract change breaks replay;
45. feature flag combination untested;
46. migration cutover misses hidden consumer;
47. architecture doc/ADR stale.

## Cost/scale failures
48. hot shard;
49. noisy neighbor;
50. unbounded egress;
51. observability bill explosion;
52. serverless high-volume cost inversion;
53. overprovisioned isolation;
54. platform team becomes bottleneck.

## AI/agent failures
55. prompt injection becomes tool authority;
56. stale/poisoned memory;
57. agent repeats expensive action;
58. tool chain loops;
59. human approval becomes rubber stamp;
60. model/provider drift changes behavior;
61. post-deployment anomaly unobserved;
62. partial agent action chain unrecoverable.

---

# 124. Architecture smell catalogue

Smells are prompts for investigation, not automatic defects.

- many services share one schema and deploy together;
- a service has no meaningful state/capability;
- most requests traverse many services synchronously;
- event consumers depend on event timing not contract;
- “shared” library changes force coordinated fleet release;
- one team owns dozens of unrelated services;
- one database table has many independent writers;
- most ADRs say “industry best practice”;
- diagrams use vendor icons but omit responsibilities/contracts;
- every cache has different ad hoc semantics;
- retries exist at every layer;
- queues are monitored only by depth, not age/service rate;
- no one knows recovery ordering;
- “multi-region” but control plane or identity is single-region;
- tenant context is passed as untrusted client value;
- privileged repair scripts lack audit;
- platform abstraction has more configuration than underlying service;
- AI agent has broad credentials because tool filtering is “in the prompt”.

---

# 125. Anti-patterns — Golden Master

## 125.1 Architecture astronautics
Abstract framework/platform built ahead of real requirements.

**Fix:** prove repeated need; keep escape path; measure cognitive cost.

## 125.2 Distributed monolith
Many services but synchronized deploys, shared state and chatty calls.

**Fix:** consolidate or create real autonomous boundaries.

## 125.3 Big ball of mud
Responsibilities and state ownership are implicit.

**Fix:** discover cohesive modules and authoritative state incrementally.

## 125.4 Nanoservices
Service boundaries smaller than independent business/operational value.

**Fix:** merge until boundary pays for distribution.

## 125.5 Shared database free-for-all
Everyone writes everyone else's tables.

**Fix:** explicit write authority; module/API/data-contract boundary.

## 125.6 Golden hammer
One pattern/platform used for every problem.

**Fix:** decision framework + alternatives.

## 125.7 Resume-driven architecture
Novel stack chosen for prestige/learning.

**Fix:** novelty must buy requirement value.

## 125.8 Vendor diagram architecture
Reference architecture copied without local constraints.

**Fix:** use provider guidance as implementation evidence, not conclusion.

## 125.9 Event soup
Large set of events with no ownership/semantics/workflow visibility.

**Fix:** event catalogue, contracts, process ownership, observability.

## 125.10 CQRS everywhere
Read/write separation where needs do not diverge.

**Fix:** unify until independent model value is demonstrated.

## 125.11 Event sourcing for audit logging
Full event-sourced state model adopted for compliance history only.

**Fix:** use dedicated audit log unless replay/history is domain state.

## 125.12 Retry until green
Failures hidden by unlimited reruns.

**Fix:** classify failure; bound retry; surface persistent error.

## 125.13 Infinite queue
Backlog masks capacity deficit.

**Fix:** bounds, max age, admission, shedding, capacity.

## 125.14 Cache as truth
Downstream behavior depends on stale cache with no source reconciliation.

**Fix:** authoritative source + explicit staleness.

## 125.15 Five-nines theatre
Reliability target selected by prestige.

**Fix:** consequence/user SLO/cost.

## 125.16 Active-active by default
Multi-region writes adopted without conflict semantics.

**Fix:** justify and model consistency/failover.

## 125.17 Multi-cloud insurance fantasy
Duplicate stacks with no tested failover or portable data.

**Fix:** define real risk and test exit/recovery.

## 125.18 Kubernetes cargo cult
Orchestrator added before workload/platform need.

**Fix:** simpler runtime until orchestration benefit is real.

## 125.19 DDD cargo cult
Every noun becomes aggregate/service.

**Fix:** use domain modeling only where semantic complexity warrants it.

## 125.20 ADR bureaucracy
Decision log grows while decisions remain unchallenged.

**Fix:** significance threshold and review triggers.

## 125.21 Diagram-driven assurance
Architecture “passes” because diagrams look complete.

**Fix:** runtime/evidence/field validation.

## 125.22 Availability over correctness
System serves known-corrupt/unauthorized result to stay “up”.

**Fix:** preserve invariants/security first.

## 125.23 Manual repair without architecture
Operations depend on undocumented database edits.

**Fix:** controlled, audited repair interfaces/runbooks.

## 125.24 Platform as empire
Internal platform optimizes platform team goals rather than product outcomes.

**Fix:** treat platform as product; measure reduced cognitive/lead time/risk.

## 125.25 Zero-trust productization
One product/mesh declared to “implement zero trust”.

**Fix:** resource/action/context authorization architecture.

## 125.26 Agent-as-policy-engine
LLM decides whether its own requested action is allowed.

**Fix:** deterministic external authorization/policy.

---

# 126. Contradiction ledger

| Tension | Evidence-weighted V2 rule |
|---|---|
| up-front architecture vs evolutionary design | make high-consequence/hard-to-reverse constraints explicit early; learn/revise reversible detail |
| simplicity vs future flexibility | preserve simplicity; invest in extension points only for credible variability |
| monolith vs microservices | minimum distributed topology that satisfies independent scaling/release/ownership/failure needs |
| domain boundary vs service boundary | domain semantics informs; deployment is separate decision |
| sync vs async | sync is simpler for immediate bounded work; async earns cost through buffering/durability/fan-out/availability decoupling |
| orchestration vs choreography | explicit process ownership favors orchestration; genuinely independent reactions favor choreography |
| strong vs weak consistency | preserve invariants/user semantics; weaken only for material value |
| coordination vs availability/latency | coordinate only where correctness needs it |
| shared DB vs DB-per-service | protect ownership/write authority; physical topology contextual |
| normalized vs denormalized | authoritative normalized state where useful; derived denormalization for measured read/performance needs |
| cache vs source optimization | fix source first when economical; cache with explicit staleness semantics |
| queue vs reject | bounded queue absorbs burst; shedding/backpressure protects sustained overload |
| retry vs fail fast | retry safe transient work within deadline/budget; otherwise fail/repair |
| circuit breaker vs direct failure | use only when repeated dependency calls materially worsen failure and state complexity is justified |
| serverless vs persistent runtime | choose from workload/state/cost/latency/operations |
| Kubernetes vs PaaS | choose least operationally complex runtime meeting platform needs |
| single region vs multi-region | add regions only for named latency/recovery/residency requirements |
| shared tenancy vs isolation | share for economics; isolate for security/performance/reliability/compliance as required |
| build vs buy | lifecycle economics/control/differentiation; neither is inherently safer |
| managed vs self-hosted | managed transfers operations, not product accountability |
| cloud vs on-prem | requirements and lifecycle economics, not ideology |
| multi-cloud vs single provider | provider diversity only when concrete risk outweighs duplicate complexity |
| API gateway vs direct services | gateway for shared ingress policy; avoid domain logic concentration |
| service mesh vs library/platform | mesh for consistent network capabilities at fleet scale; avoid if simpler controls suffice |
| abstraction vs duplication | abstract stable shared knowledge; tolerate code duplication while concepts diverge |
| DRY vs autonomy | shared libraries reduce duplication but can create release coupling |
| feature flags vs branches | flags control runtime exposure; branches control code divergence; both create state/debt |
| rollback vs roll-forward | choose based on state/external-effect compatibility |
| rewrite vs incremental migration | incremental default; rewrite when constraints/coexistence make it safer |
| formal methods vs testing | formal analysis proves scoped modeled properties; tests observe implementation; combine by risk |
| automation vs human review | automate deterministic properties; humans handle ambiguity/consequence; avoid rubber stamps |
| architecture board vs team autonomy | centralized guardrails for systemic risk; local decisions where blast radius stays local |
| standardization vs innovation | standardize repeated undifferentiated capabilities; permit experiments behind bounded interfaces |
| observability vs privacy | collect enough operational evidence; minimize/redact sensitive content |
| AI autonomy vs control | scale runtime authority with consequence, auditability, reversibility and policy enforcement |

---

# 127. What is universal vs contextual

## Strong near-universal architecture requirements

- outcome and boundary;
- architecturally significant requirements;
- state/write authority;
- important invariants;
- interface/failure semantics;
- trust/authorization boundaries;
- ownership;
- risk-proportionate assurance;
- recovery where failure is material;
- migration/evolution for long-lived systems;
- decision rationale for consequential choices;
- evidence rather than architecture slogans.

## Contextual mechanisms

- microservices;
- modular monolith;
- event-driven;
- serverless;
- Kubernetes;
- service mesh;
- CQRS;
- event sourcing;
- DDD;
- hexagonal/clean architecture;
- circuit breakers;
- specific cache;
- specific queue;
- multi-region;
- multi-cloud;
- C4;
- arc42;
- ATAM;
- formal methods;
- any particular cloud/vendor database.

---

# 128. Architecture review gate

A material architecture decision SHOULD NOT pass when:

- outcome/constraint unclear;
- key quality claims are adjectives only;
- state ownership ambiguous;
- cross-boundary failure not modeled;
- authz/trust boundary omitted;
- proposed distributed boundary has no reason;
- migration/recovery absent for irreversible change;
- cost/operability owner absent;
- high-impact uncertainty has no evidence plan;
- architecture depends on a draft/non-current standard misrepresented as final.

---

# 129. Architecture Definition of Ready

- [ ] decision/system outcome explicit
- [ ] stakeholders and concerns identified
- [ ] system boundary identified
- [ ] constraints known enough
- [ ] criticality assigned
- [ ] architecturally significant requirements identified
- [ ] important quality scenarios drafted
- [ ] important invariants identified
- [ ] current system/baseline understood for evolution work
- [ ] decision owner named
- [ ] major uncertainty and evidence plan known

---

# 130. Architecture Definition of Done

## Decision
- [ ] alternatives considered
- [ ] rationale/trade-offs recorded
- [ ] constraints preserved
- [ ] unresolved uncertainty visible
- [ ] revisit trigger defined

## Structure/state
- [ ] boundaries/ownership clear
- [ ] source-of-truth/write authority clear
- [ ] consistency/ordering clear where material
- [ ] cross-boundary contracts clear

## Failure
- [ ] slow/unavailable/partial/duplicate/reorder/overload considered
- [ ] recovery objectives and path defined where material
- [ ] retries/queues bounded

## Security/privacy
- [ ] trust/authz boundaries clear
- [ ] sensitive data lifecycle appropriate
- [ ] tenancy isolation tested where applicable

## Operations
- [ ] observability answers critical questions
- [ ] owner/runbook/control paths exist
- [ ] capacity/cost considered

## Evolution
- [ ] compatibility/migration defined
- [ ] rollback/roll-forward compatible with state
- [ ] deprecation/retirement path where relevant

## Assurance
- [ ] evidence matches risk
- [ ] architecture review completed
- [ ] no unresolved BLOCKER
- [ ] L3/L4 assurance package retained

---

# 131. Architecture-change review checklist

For each material change:

- [ ] What architecture assumption changes?
- [ ] Does system boundary change?
- [ ] Does state/write authority change?
- [ ] Does transaction/consistency change?
- [ ] Does a new remote dependency appear?
- [ ] Does trust/authorization change?
- [ ] Does tenant isolation change?
- [ ] Does failure/blast radius change?
- [ ] Does recovery change?
- [ ] Does deployment/region topology change?
- [ ] Does capacity/cost shape change?
- [ ] Does compatibility/migration need sequencing?
- [ ] Is ADR/documentation updated?
- [ ] Is production evidence sufficient after release?

---

# 132. Scenario test set for architecture reviews

At minimum for L2+ test mentally or experimentally:

1. normal operation;
2. dependency slowdown;
3. dependency outage;
4. overload;
5. duplicate request/message;
6. out-of-order message where relevant;
7. partial transaction/workflow;
8. stale/lagged replica/index/cache;
9. deployment/version coexistence;
10. rollback after state change;
11. tenant A attempting tenant B resource;
12. credential revocation;
13. backup/restore;
14. operator mistake;
15. unexpected traffic/data skew;
16. region loss if multi-region;
17. AI model/tool failure if AI-enabled;
18. agent repeated/unauthorized tool action if agentic.

---

# 133. Architecture metrics

Metrics are decision signals, not architecture scores.

Possible signals:

## Change
- lead time;
- change failure;
- blast radius;
- coordinated-service releases;
- rollback/roll-forward success.

## Reliability
- SLO performance;
- recurrence;
- failover/restore success;
- queue age;
- saturation.

## Architecture health
- dependency cycles;
- unauthorized cross-module data writes;
- API compatibility defects;
- stale ADRs;
- orphan services;
- unknown owners;
- architecture-fitness failures.

## Economics
- cost per unit;
- unused capacity;
- egress;
- operational labor;
- incident burden.

## Cognitive/organizational
- onboarding time;
- cross-team dependency count;
- ownership gaps;
- services per owning team only as context—not a target.

Do not optimize metrics disconnected from outcome.

---

# 134. Event-triggered architecture review

Review architecture when:

- material incident;
- repeated SLO failure;
- scale inflection;
- major customer/tenant requirement;
- regulation/security change;
- vendor/platform EOL;
- sustained cost anomaly;
- ownership/team model change;
- large migration;
- core assumption invalidated;
- AI model/provider/runtime control changes materially;
- draft standard becomes final.

---

# 135. Architecture retirement

Retirement includes:

- consumers/dependencies discovered;
- traffic stopped;
- data retained/exported/deleted appropriately;
- credentials revoked;
- DNS/routes removed;
- queues/jobs disabled;
- monitors/alerts removed;
- licenses/cost stopped;
- evidence archived;
- architecture maps/catalog updated.

Zombie systems are cost and attack surface.


# 136. Canonical architecture Plays

The following Plays translate the standard into repeatable decision/action units.

---

## PLAY-ARCH-001 — Frame a material architecture decision

### Objective
Create an evidence-ready decision frame before selecting technologies.

### Use when
- new system;
- material architecture change;
- contested pattern/platform choice;
- major migration.

### Inputs
- business/user objective;
- current system if any;
- constraints;
- stakeholders.

### Execution
1. Name decision and owner.
2. Define intended outcome.
3. Define system/change boundary.
4. Identify non-negotiable constraints.
5. Identify architecturally significant requirements.
6. Write top quality scenarios.
7. Identify invariants.
8. Classify criticality.
9. List alternatives including current state where legitimate.
10. List unknowns/evidence needed.
11. Define decision deadline and review level.

### Acceptance
- decision is not expressed as “which technology is best?”;
- material constraints/unknowns visible;
- at least one non-preferred alternative exists where feasible.

---

## PLAY-ARCH-002 — Evaluate a candidate architecture

### Objective
Identify risks, sensitivities, trade-offs and missing evidence.

### Method
ATAM-lite by default; full ATAM or domain method when justified.

### Execution
1. Review drivers and scenarios.
2. Walk top scenarios through components/state/deployment.
3. Identify decisions that materially affect each scenario.
4. Mark sensitivity points.
5. Mark trade-off points.
6. Run failure/trust/state questions.
7. Check operations/economics/migration.
8. Define evidence required.
9. Record findings by severity.
10. Approve, revise, prototype or reject.

### Output
- review record;
- risks;
- evidence plan;
- ADR updates.

---

## PLAY-ARCH-003 — Decide whether to extract a service

### Objective
Prevent unjustified distribution.

### Trigger
A module/capability is proposed as independent service.

### Decision logic
Extract only when one or more independent values are material:
- deployment;
- scale;
- failure isolation;
- security isolation;
- ownership;
- lifecycle.

Then prove the distributed tax is acceptable.

### Acceptance
- service has coherent purpose/owner;
- state/write authority explicit;
- synchronous dependencies bounded;
- cross-service transactions handled;
- operations/observability owned;
- migration path exists.

---

## PLAY-ARCH-004 — Select consistency and coordination semantics

### Objective
Preserve invariants without unnecessary coordination.

### Execution
1. Identify operation.
2. Identify invariant.
3. Identify concurrent actors.
4. Define acceptable stale state.
5. Define partition/failure behavior.
6. Identify conflict resolution.
7. Evaluate stronger transaction/coordination.
8. Evaluate weaker model.
9. Measure latency/availability value if decision-sensitive.
10. Record semantics in contract/state model.

### Guardrail
Do not choose consistency model from database marketing category.

---

## PLAY-ARCH-005 — Design an asynchronous workflow

### Objective
Make async state/failure/replay explicit.

### Required
- message semantics;
- producer/consumer ownership;
- delivery;
- ordering;
- idempotency;
- retry;
- poison handling;
- progress state;
- partial completion;
- observability;
- replay policy.

### Acceptance
A consumer can receive duplicate/out-of-order/replayed input without undefined business behavior.

---

## PLAY-ARCH-006 — Design multitenancy isolation

### Objective
Prevent cross-tenant access and unacceptable noisy-neighbor/blast-radius effects.

### Execution
1. Define tenant.
2. Propagate tenant identity from trusted source.
3. Classify isolation by layer.
4. Define data/write/keys/compute/network boundaries.
5. Define quotas/throttling.
6. Define tier differences.
7. Threat-model cross-tenant paths.
8. Test negative access.
9. Load-test noisy neighbor.
10. Define tenant deletion/export/migration.

---

## PLAY-ARCH-007 — Decide multi-region topology

### Objective
Meet real recovery/latency/residency needs without unjustified complexity.

### Execution
1. Name requirement.
2. Compare single-region + restore/passive.
3. Define region failure model.
4. Define read/write topology.
5. Define consistency/conflict.
6. Define routing.
7. Define dependency region behavior.
8. Define failover/failback.
9. Cost model.
10. Exercise region loss.

### Acceptance
No claim of region resilience without representative exercise/evidence.

---

## PLAY-ARCH-008 — Modernize a legacy system

### Objective
Reduce risk while changing architecture.

### Execution
1. Establish current behavior/dependencies.
2. Identify migration seams.
3. Define target outcomes rather than target fashion.
4. Select incremental vs replacement strategy.
5. Define source-of-truth/coexistence.
6. Migrate bounded capability/data.
7. Shadow/reconcile.
8. Shift traffic.
9. verify.
10. retire old path.

### Guardrail
Do not recreate undocumented legacy behavior accidentally; classify which behavior is required, defect, or obsolete.

---

## PLAY-ARCH-009 — Design an AI/agent architecture

### Objective
Separate probabilistic reasoning from authority and system integrity.

### Execution
1. Define model/agent role.
2. Classify tool side effects.
3. Define external policy/authorization.
4. Define memory/RAG trust boundaries.
5. Define structured validation.
6. Define loop/time/cost/concurrency bounds.
7. Define human approval thresholds.
8. Define audit/provenance.
9. Define kill/revoke/recovery.
10. Define pre-deployment eval + production monitoring.

### Acceptance
No consequential tool action relies solely on prompt compliance.

---

# 137. Canonical templates

## 137.1 Architecture brief

```yaml
system:
decision_owner:
architecture_owner:
date:
criticality:

problem:
intended_users:
outcomes:

system_boundary:
external_systems:

constraints:
  legal_regulatory:
  security_privacy:
  data_residency:
  budget:
  schedule:
  platform:
  migration:

architecturally_significant_requirements:

quality_scenarios:

invariants:

state:
  authoritative_sources:
  writers:
  consistency:
  ordering:

trust_boundaries:

failure_model:

scale_workload:

operational_model:

candidate_architectures:

known_unknowns:

evidence_plan:

review_level:
```

---

## 137.2 Quality scenario

```yaml
scenario_id:
stakeholder:
quality:
source:
stimulus:
environment:
artifact:
response:
measure:
classification: constraint | threshold | optimization
guardrails:
evidence:
```

---

## 137.3 State authority matrix

```markdown
| State/fact | Meaning | Authority | Writers | Readers | Invariant | Consistency | Conflict | Derived copies | Reconciliation |
|---|---|---|---|---|---|---|---|---|---|
```

---

## 137.4 Boundary record

```yaml
boundary:
responsibility:
owner:
owned_state:
owned_policy:
interface:
deployment:
scaling:
failure_domain:
trust_boundary:
dependencies:
what_it_hides:
independent_value:
distributed_tax:
```

---

## 137.5 Service extraction record

```yaml
candidate:
business_capability:
owner:
owned_state:
owned_invariants:

drivers:
  independent_deployment:
  independent_scale:
  failure_isolation:
  security_isolation:
  lifecycle:
  technology:

new_costs:
  latency:
  partial_failure:
  api_events:
  identity:
  data_distribution:
  transactions:
  observability:
  deployment:
  testing:
  on_call:

alternative_modular_monolith:

migration:

evidence:

decision:
```

---

## 137.6 Event/message contract

```yaml
name:
semantic_type: event | command | reply | notification
owner:
producer:
consumers:
schema:
compatibility:
delivery:
ordering:
deduplication:
idempotency:
retry:
quarantine:
retention:
replay:
side_effect_on_replay:
privacy:
authorization:
correlation:
monitoring:
```

---

## 137.7 Failure model

```yaml
component_or_dependency:
slow:
unavailable:
wrong:
stale:
duplicate:
reordered:
partial:
overloaded:
rate_limited:
compromised:
recovery_overlap:

deadline:
retry:
isolation:
fallback:
degraded_mode:
recovery:
monitor:
owner:
```

---

## 137.8 Multi-region record

```yaml
requirement:
regions:
topology: active_active | active_passive | passive_restore | other
read_path:
write_path:
replication:
consistency:
conflict:
routing:
failover_trigger:
failover_authority:
failback:
dependencies:
identity_secrets:
data_residency:
rto:
rpo:
cost:
test:
```

---

## 137.9 Tenancy isolation record

```yaml
tenant_definition:
trusted_tenant_context_source:

layers:
  identity:
  compute:
  data:
  network:
  keys:
  queues:
  cache:
  search:
  ai_memory:
  observability:

isolation_model:
noisy_neighbor:
quota:
tiering:
residency:
cross_tenant_tests:
deletion_export:
migration:
```

---

## 137.10 Build/buy record

```yaml
capability:
strategic_value:
options:

requirements_fit:
security_privacy:
reliability:
performance:
integration:
operability:
supplier:
license:
skills:
cost:
exit:
concentration:
migration:

decision:
revisit:
```

---

## 137.11 ADR

```markdown
# ADR-[ID] — [Decision]

Status:
Date:
Decision owner:

## Context
## Decision question
## Drivers and constraints
## Quality scenarios / invariants
## Alternatives
## Evidence
## Decision
## Rationale
## Trade-offs
## Risks
## Operational consequences
## Security/privacy consequences
## Cost consequences
## Migration / reversibility
## Verification
## Revisit triggers
## Supersedes / superseded by
```

---

## 137.12 Architecture review report

```yaml
review:
system:
version:
date:
review_level:
reviewers:
independence:

scope:
top_drivers:
top_scenarios:

risks:
sensitivity_points:
tradeoff_points:
assumptions:
unknowns:

findings:
  blockers:
  major:
  minor:

evidence_required:
decisions_changed:
adrs_required:
approval:
revisit:
```

---

# 138. High-assurance overlay

This playbook is not a safety certification standard.

Escalate to relevant domain standards when software affects:
- life/health;
- vehicle/transport control;
- industrial hazards;
- critical infrastructure;
- high-consequence finance;
- defense/mission;
- medical devices;
- aviation;
- regulated control systems.

Expect stronger:
- hazard analysis;
- requirements traceability;
- segregation/independence;
- deterministic controls;
- configuration management;
- tool qualification where required;
- formal verification;
- assurance cases;
- retained evidence.

Do not copy safety-critical paperwork into ordinary SaaS without risk value.

---

# 139. Architecture governance

Architecture governance exists to preserve system-wide invariants and decision quality without making a central committee the bottleneck.

## Centralize when
- security/privacy baseline;
- identity;
- tenant isolation;
- critical data standards;
- compliance;
- shared platform;
- system-wide compatibility;
- enterprise-wide cost/risk.

## Delegate when
- blast radius local;
- decision reversible;
- no cross-team/system invariant;
- team owns operation/outcome.

Use guardrails and automated controls where possible.

---

# 140. Decision rights

For consequential architecture decisions identify:

- recommend;
- contributors;
- decision owner;
- implementers;
- reviewers;
- risk acceptor;
- escalation.

Avoid architecture by anonymous consensus.

One accountable decision owner is the default unless governance requires another model.

---

# 141. Exception standard

```yaml
rule_or_guardrail:
exception:
reason:
risk:
compensating_control:
owner:
approved_by:
expires:
review_trigger:
```

Permanent exceptions should either become an explicit supported variant or be removed.

---

# 142. Architecture repository and canonical source

Production architecture knowledge SHOULD have:

- canonical location;
- version control/history;
- system/service IDs;
- ownership;
- ADR links;
- diagrams/models;
- dependencies;
- operational links;
- source/evidence links;
- supersession/deprecation.

Avoid duplicate uncontrolled architecture decks.

---

# 143. Architecture discoverability

At scale support:

- system/service catalogue;
- owner;
- tier/criticality;
- dependencies;
- APIs/events;
- data classification;
- runbooks;
- SLOs;
- repository;
- ADRs;
- dashboards.

A catalogue is only valuable if ownership and data remain current.

---

# 144. Architecture as code / model as data

Architecture models MAY be stored as structured data/code when it enables:

- versioning;
- diff/review;
- query;
- automated diagrams;
- dependency checks;
- consistency with source/infrastructure.

Do not force every architecture discussion into a DSL if whiteboards/text are faster and the result need not live long.

---

# 145. Runtime-to-model reconciliation

For material distributed systems, consider comparing intended architecture with runtime evidence:

- service call graph;
- OpenTelemetry traces;
- network flow;
- infrastructure-as-code;
- deployment inventory;
- API gateway catalog;
- DB access;
- event topics.

Differences are signals:
- undocumented dependency;
- stale model;
- unexpected coupling;
- orphan system.

Runtime discovery is not automatically truth about intended ownership/semantics; reconcile both.

---

# 146. Architecture incident learning

After architecture-significant incident ask:

1. Which architecture assumption was false?
2. Which boundary failed to contain?
3. Which invariant/control failed?
4. Was failure observable?
5. Did retry/queue/fallback amplify?
6. Did ownership/decision rights slow recovery?
7. Did documentation/runbook match reality?
8. Does architecture or requirement need change?
9. Which fitness/evidence check can detect recurrence?

Do not end with “be more careful”.

---

# 147. Research and evidence sanity check

## High-confidence principles

### Architecture description is not architecture
**Confidence: HIGH** — directly supported by ISO 42010.

### Architecture should be evaluated against stakeholder concerns and intended qualities
**Confidence: HIGH** — ISO 42030 + SEI ATAM.

### Architecture lifecycle/process does not require one development methodology
**Confidence: HIGH** — ISO 42020/15288/12207.

### Quality is multi-dimensional
**Confidence: HIGH** — ISO 25010 + architecture evaluation practice.

### Information hiding and controlled boundaries are durable
**Confidence: HIGH** — foundational software-engineering theory + modern practice.

### Distributed ordering must be explicit
**Confidence: HIGH** — Lamport and subsequent distributed-systems foundations.

### Coordination/consistency is an invariant-level trade-off
**Confidence: HIGH** for mechanism; specific database choice contextual.

### Microservices are not a universal improvement
**Confidence: HIGH** — systematic reviews/mapping + distributed-system mechanisms.

### DDD is useful but contextual and expertise-dependent
**Confidence: MODERATE-HIGH** — 2025 SLR; implementations/evaluations heterogeneous.

### Queues/retries can worsen overload
**Confidence: HIGH** — mature SRE/operational evidence and protocol semantics.

### Tenant isolation strategy is contextual but isolation itself is essential in SaaS
**Confidence: HIGH** — convergent AWS/Azure guidance; exact topology contextual.

### AI pre-deployment tests are insufficient alone
**Confidence: HIGH** — NIST 2026 evaluation + monitoring work; exact monitoring methodology still emerging.

---

# 148. What is HOUSE synthesis

The following are intentional PB-02 design choices, not claimed external standards:

- the exact 100 Golden Architecture Standards;
- A0–A4 architecture-assurance levels;
- constraint/threshold/optimization triad;
- exact decision-tree forms;
- coupling taxonomy combination;
- exact architecture Plays;
- exact failure-mode catalogue;
- exact smell catalogue;
- exact Definition of Ready/Done;
- architecture assurance package;
- agent capability classes;
- exact multi-tenancy record;
- exact source status labels.

They synthesize external evidence but remain house constructs.

---

# 149. Known limitations

1. Architecture literature contains less controlled causal evidence than many management/architecture books imply.
2. Large-scale operational patterns can be overfit to large organizations.
3. Cloud implementation details change quickly.
4. Some formal standards are paywalled; this playbook relies on public abstracts/descriptions and does not reproduce copyrighted text.
5. Microservices/DDD/serverless research is heterogeneous.
6. High-assurance/safety domains require specialized standards.
7. AI/agent control practice is rapidly evolving.
8. Organizational design effects are context-dependent.
9. No architecture template can eliminate need for competent judgment.

---

# 150. Source register and annotated evidence map

> Inclusion does not imply equal authority. Final/draft status matters.

## Core architecture standards

### S01 — ISO/IEC/IEEE 42010:2022 — Architecture description
**Class:** N1 — International Standard  
**URL:** https://www.iso.org/standard/74393.html  
**Use:** architecture descriptions, viewpoints, model kinds, conformance; distinction between architecture and its description.  
**Status:** current published edition.  
**Limitation:** explicitly does not prescribe an architecting method, notation, technique or tool.

### S02 — ISO/IEC/IEEE 42020:2019 — Architecture processes
**Class:** N1  
**URL:** https://www.iso.org/standard/68982.html  
**Use:** governance, management and architecting process descriptions.  
**Status:** current; reviewed/confirmed 2025.  
**Watch:** Edition 2 AWI opened May 2026: https://committee.iso.org/standard/93813.html  
**Rule:** AWI MUST NOT be represented as final.

### S03 — ISO/IEC/IEEE 42030:2019 — Architecture evaluation framework
**Class:** N1  
**URL:** https://www.iso.org/standard/73436.html  
**Use:** organize/record architecture evaluations; stakeholder concerns; intended purpose/quality.  
**Status:** current; confirmed 2025.  
**Watch:** Edition 2 AWI: https://www.iso.org/standard/93814.html  
**Rule:** AWI is not final.

### S04 — ISO/IEC/IEEE 15288:2023 — System life cycle processes
**Class:** N1  
**URL:** https://www.iso.org/standard/81702.html  
**Use:** full-system lifecycle, iterative/concurrent/recursive process model.  
**Limitation:** does not prescribe one lifecycle method/model.

### S05 — ISO/IEC/IEEE 12207:2026 — Software life cycle processes
**Class:** N1  
**URL:** https://www.iso.org/standard/90219.html  
**Use:** current software lifecycle process framework through retirement.  
**Status:** published April 2026.  
**Limitation:** method-agnostic.

### S06 — ISO/IEC 25010:2023 — Product quality model
**Class:** N1  
**URL:** https://www.iso.org/standard/78176.html  
**Use:** nine-characteristic product-quality reference model.  
**Limitation:** not a universal weighting or single quality score.

### S07 — IEEE 1012-2024 — Verification & Validation
**Class:** N1  
**URL:** https://standards.ieee.org/ieee/1012/7324/  
**Use:** V&V and integrity/risk-scaled assurance.  
**Limitation:** high-assurance orientation; depth must be proportional.

### S08 — SWEBOK v4.0a
**Class:** N1/consensus body of knowledge  
**URL:** https://www.computer.org/education/bodies-of-knowledge/software-engineering  
**Use:** software architecture as a first-class knowledge area and discipline coverage map.  
**Limitation:** body of knowledge, not proof every practice is optimal.

## Architecture evaluation and modularity

### S09 — CMU SEI — Architecture Tradeoff Analysis Method (ATAM)
**Class:** O1/R2 — research/practice method  
**URL:** https://www.sei.cmu.edu/library/atam-method-for-architecture-evaluation/  
**Use:** quality scenarios, risks, sensitivity/trade-off points.  
**Limitation:** full process can be disproportionate for small/low-risk systems.

### S10 — CMU SEI — Architecture Tradeoff Analysis Method collection / 2026 information sheet
**Class:** O1  
**URL:** https://www.sei.cmu.edu/library/architecture-tradeoff-analysis-method-atam/  
**Use:** current SEI positioning of ATAM.  
**Limitation:** method-level evidence, not mandatory architecture governance.

### S11 — Parnas (1972) — On the Criteria To Be Used in Decomposing Systems into Modules
**Class:** R2 — foundational peer-reviewed research  
**URL:** https://doi.org/10.1145/361598.361623  
**Use:** information hiding/design decisions likely to change.  
**Limitation:** foundational modularity result, not complete modern system architecture.

## Distributed systems and data

### S12 — Lamport (1978) — Time, Clocks, and the Ordering of Events in a Distributed System
**Class:** R2  
**URL:** https://www.microsoft.com/en-us/research/publication/time-clocks-ordering-events-distributed-system/  
**Use:** causal partial ordering/logical clocks.  
**Limitation:** foundational; modern systems can provide stronger scoped guarantees.

### S13 — Herlihy & Wing (1990) — Linearizability
**Class:** R2  
**URL:** https://doi.org/10.1145/78969.78972  
**Use:** concurrent-object correctness condition.  
**Limitation:** specific correctness model; not required for every state.

### S14 — Bailis et al. (2014) — Highly Available Transactions
**Class:** R2  
**URL:** https://www.vldb.org/2014/program/lib/FullProgram.html  
**Use:** transaction/availability guarantee trade-space.  
**Limitation:** distributed datastore context.

### S15 — Bailis et al. (2015) — Coordination Avoidance in Database Systems
**Class:** R2  
**URL:** https://www.vldb.org/pvldb/vol8/p185-bailis.pdf  
**Use:** invariant-confluence framing; coordination only where invariants require it.  
**Limitation:** formal/data-system framework; application analysis still required.

### S16 — Corbett et al. — Spanner
**Class:** O1/R2 — peer-reviewed large-scale system evidence  
**URL:** https://research.google/pubs/spanner-googles-globally-distributed-database-2/  
**Use:** demonstrates globally distributed externally consistent transactions can be engineered with specialized mechanisms.  
**Limitation:** Google-specific system/cost/clock infrastructure; not a default architecture.

## Microservices, DDD, serverless

### S17 — Challenges and Solution Directions of Microservice Architectures: SLR (2022)
**Class:** R1  
**URL:** https://doi.org/10.3390/app12115507  
**Use:** 85 primary studies; challenge taxonomy.  
**Limitation:** heterogeneous study quality/context; does not produce universal architecture winner.

### S18 — Migration of monolithic systems to microservices: systematic mapping study (2025)
**Class:** R1  
**URL:** https://doi.org/10.1016/j.infsof.2024.107590  
**Use:** 114 selected studies; migration drivers, techniques, benefits/challenges.  
**Key limitation:** scalability/maintenance are common drivers but relatively few studies directly assess them.

### S19 — Domain-Driven Design in software development: systematic literature review (2025)
**Class:** R1  
**URL:** https://doi.org/10.1016/j.jss.2025.112537  
**Use:** 36 peer-reviewed studies; benefits, stakeholder/domain-expert role, microservices decomposition use, implementation challenges.  
**Limitation:** inconsistent DDD application/evaluation and expertise/onboarding challenges.

### S20 — The State of Serverless Applications (IEEE TSE)
**Class:** R2/R1-style empirical synthesis  
**URL:** https://doi.org/10.1109/TSE.2021.3113940  
**Use:** 89 serverless applications plus comparison with other datasets; why/when/how adopters use serverless.  
**Limitation:** does not establish universal cost/performance superiority.

## Failure, reliability and operations

### S21 — Google SRE — Addressing Cascading Failures
**Class:** O1  
**URL:** https://sre.google/sre-book/addressing-cascading-failures/  
**Use:** overload, queue growth, load shedding, retry amplification, backoff/jitter, capacity testing.  
**Limitation:** large-scale online-service context; exact mechanisms contextual.

### S22 — Google SRE — Implementing SLOs
**Class:** O1  
**URL:** https://sre.google/workbook/implementing-slos/  
**Use:** user-relevant reliability objectives/error budgets.  
**Limitation:** adapt outside online service operations.

### S23 — Google SRE — Canarying Releases
**Class:** O1  
**URL:** https://sre.google/workbook/canarying-releases/  
**Use:** progressive production exposure to reduce blast radius.  
**Limitation:** needs representative traffic and useful health signals.

### S24 — AWS Builders' Library — Timeouts, retries and backoff with jitter
**Class:** O1  
**URL:** https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/  
**Use:** practical distributed-call failure controls.  
**Limitation:** AWS operating context; business idempotency remains application-specific.

### S25 — OpenTelemetry — Observability Primer
**Class:** T1/O1  
**URL:** https://opentelemetry.io/docs/concepts/observability-primer/  
**Use:** observability vs telemetry; traces/metrics/logs.  
**Limitation:** instrumentation does not itself prove diagnosability.

## Protocols/interfaces

### S26 — IETF RFC 9110 — HTTP Semantics
**Class:** N1/T1 — Internet Standard  
**URL:** https://www.rfc-editor.org/rfc/rfc9110.html  
**Use:** HTTP semantics, safe/idempotent methods, retry-related semantics.  
**Limitation:** application/business idempotency can require stronger controls.

### S27 — IETF RFC 9457 — Problem Details for HTTP APIs
**Class:** N1/T1  
**URL:** https://www.rfc-editor.org/rfc/rfc9457.html  
**Use:** standardized machine-readable HTTP API problem details.  
**Limitation:** optional error representation, not complete API design.

## Security/privacy architecture

### S28 — NIST SP 800-160 Vol.1 Rev.1 — Engineering Trustworthy Secure Systems
**Class:** N1/government engineering guidance  
**URL:** https://csrc.nist.gov/pubs/sp/800/160/v1/r1/final  
**Use:** security as systems-engineering property across lifecycle, trustworthiness, assurance/trades.  
**Status:** final/current.

### S29 — NIST SP 800-207 — Zero Trust Architecture
**Class:** N1/government architecture guidance  
**URL:** https://csrc.nist.gov/pubs/sp/800/207/final  
**Use:** no implicit trust based solely on network location; resource/access-centric policy.  
**Limitation:** security architecture model, not a mandatory product/topology.

### S30 — NIST SP 800-218 — SSDF v1.1
**Class:** government secure development framework  
**URL:** https://csrc.nist.gov/pubs/sp/800/218/final  
**Use:** secure-development lifecycle context affecting architecture.  
**Status note:** v1.1 final at cutoff; Rev.1/v1.2 remains draft in the parent engineering standard's 2026 audit.

## Cloud and multitenancy

### S31 — AWS Well-Architected Framework
**Class:** O1/T1 vendor operations architecture guidance  
**URL:** https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html  
**Use:** operational excellence/security/reliability/performance/cost/sustainability trade-offs.  
**Limitation:** AWS-specific implementations.

### S32 — Azure Well-Architected Framework
**Class:** O1/T1  
**URL:** https://learn.microsoft.com/azure/well-architected/  
**Use:** reliability/security/cost/operations/performance trade-space.  
**Limitation:** Azure context.

### S33 — AWS SaaS Lens — Tenant Isolation
**Class:** O1/T1  
**URL:** https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/tenant-isolation.html  
**Use:** tenant isolation foundation; implementation strategy is not universal.  
**Limitation:** AWS SaaS context.

### S34 — Azure Architecture Center — Multitenant architectural approaches
**Class:** O1/T1  
**URL:** https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/approaches/overview  
**Use:** isolation/cost/performance/complexity/management trade-offs.  
**Limitation:** Azure examples; principles generalize more than products.

### S35 — Azure Architecture Center — Tenancy models
**Class:** O1/T1  
**URL:** https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/considerations/tenancy-models  
**Use:** isolation spectrum and trade-offs.  
**Limitation:** cloud/SaaS focus.

## Decision records and documentation

### S36 — Microsoft — Maintain an Architecture Decision Record
**Class:** P1/O1 applied guidance  
**URL:** https://learn.microsoft.com/en-us/azure/well-architected/architect-role/architecture-decision-record  
**Use:** ADR significance, alternatives, context/implications.  
**Limitation:** Azure WAF context; ADR is a practice, not formal architecture proof.

### S37 — C4 Model
**Class:** P1  
**URL:** https://c4model.com/  
**Use:** context/container/component/code hierarchy, supporting dynamic/deployment views.  
**Limitation:** visualization method; not complete architecture process or standard.

### S38 — arc42
**Class:** P1  
**URL:** https://arc42.org/  
**Use:** practical architecture documentation structure.  
**Limitation:** practitioner template; use selectively.

### S39 — Fowler — Strangler Fig
**Class:** P1  
**URL:** https://martinfowler.com/bliki/StranglerFigApplication.html  
**Use:** incremental modernization/migration metaphor/pattern.  
**Limitation:** practitioner pattern; not universal migration requirement.

### S40 — Fowler/Lewis — Microservices Guide
**Class:** P1  
**URL:** https://martinfowler.com/microservices/  
**Use:** practitioner definition/trade-offs/prerequisites.  
**Limitation:** practitioner evidence; V2 relies on systematic research for stronger microservices claims.

## AI/agent architecture

### S41 — NIST AI 200-3 — ARIA Evaluation Planning Manual
**Class:** government AI evaluation guidance  
**URL:** https://www.nist.gov/publications/aria-evaluation-planning-manual-elements-aria-style-ai-evaluations  
**Published:** 2026-09-18.  
**Use:** model testing + red teaming + user testing as complementary evaluation evidence.  
**Limitation:** AI-specific and newly published.

### S42 — NIST AI 800-4 — Challenges to Monitoring Deployed AI Systems
**Class:** government research/guidance  
**URL:** https://www.nist.gov/publications/challenges-monitoring-deployed-ai-systems-center-ai-standards-and-innovation  
**Published:** 2026-03-06.  
**Use:** post-deployment monitoring need; unforeseen behavior/dynamic inputs; monitoring categories/challenges.  
**Limitation:** explicitly notes best practices/methodologies are still nascent.

### S43 — NIST AI RMF Generative AI Profile (NIST AI 600-1)
**Class:** government AI risk framework  
**URL:** https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence  
**Use:** AI TEVV/governance/provenance/adversarial risk controls.  
**Limitation:** voluntary profile; not one architecture.

### S44 — OWASP Agent Control Standard
**Class:** open emerging control standard  
**URL:** https://genai.owasp.org/resource/agent-control-standard-acs/  
**Use:** inspectability, traceability, instrumentation and runtime policy hooks for agents.  
**Status:** new 2026; emerging operational maturity.  
**Limitation:** must not be treated as empirically complete.

---

# 151. Source-status watchlist

Review immediately when:

- ISO publishes replacement 42020 Edition 2;
- ISO publishes replacement 42030 Edition 2;
- ISO/IEC/IEEE 29148 new edition replaces 2018 requirements standard;
- NIST finalizes major relevant security/privacy/AI revisions;
- OWASP agent standards materially change;
- cloud platform semantics used by a specific implementation change;
- new high-quality synthesis materially changes microservices/DDD/serverless evidence;
- regulation changes architecture constraints.

---

# 152. V1 → V2 material changes

V2 adds or strengthens:

1. architecture vs architecture-description distinction;
2. current/watch standard status;
3. stakeholder concern/viewpoint model;
4. constraint/threshold/optimization classification;
5. scenario-first quality architecture;
6. reversibility/option-value reasoning;
7. coupling taxonomy;
8. service-extraction decision record;
9. explicit data/write-authority standard;
10. consistency/coordination decision framework;
11. ordering/time discipline;
12. data partition/sharding guidance;
13. orchestration vs choreography;
14. cross-boundary transaction patterns;
15. queue/backpressure/load-shedding root controls;
16. multi-tenancy isolation matrix;
17. control-plane/data-plane reasoning;
18. platform-engineering boundary;
19. unit economics/lifecycle cost;
20. pattern catalogue with costs/failure modes;
21. API gateway/BFF/service mesh decisions;
22. multi-cloud falsification;
23. AI/agent policy-control architecture;
24. architecture testing portfolio;
25. architecture failure-mode catalogue;
26. architecture smells;
27. ATAM-lite Play;
28. assurance package;
29. architecture governance/delegation;
30. runtime-to-model reconciliation.

V2 also removes or narrows:
- implied monolith-first universality;
- database-per-service literalism;
- simplistic consistency slogans;
- architecture-document conformance as assurance;
- pattern-as-best-practice language.

---

# 153. Golden Master quality gates

## Gate 0 — Scope
- [x] purpose/scope/outcome explicit
- [x] primary users defined
- [x] specialist overlay boundaries explicit

## Gate 1 — Evidence
- [x] current ISO architecture standards checked
- [x] current lifecycle/quality standards checked
- [x] systematic research used for microservices/DDD
- [x] foundational distributed-systems research used
- [x] mature operational evidence used for failure engineering
- [x] current 2026 AI evidence included
- [x] draft/current status separated
- [x] contradiction search performed

## Gate 2 — Architecture of playbook
- [x] principles separated from patterns
- [x] decision layer separate from execution/templates
- [x] pattern catalogue is contextual
- [x] one canonical decision logic per major topic

## Gate 3 — Construction verification
- [x] Plays have objectives/triggers/methods/acceptance
- [x] failure paths included
- [x] templates align with decisions
- [x] source register included
- [x] audit findings integrated

## Gate 4 — User/scenario validation
- [ ] representative non-author architecture teams execute Golden Master
- [ ] at least one greenfield SaaS scenario
- [ ] at least one legacy modernization scenario
- [ ] at least one distributed/high-scale scenario
- [ ] at least one AI/agentic scenario
- [ ] at least one high-assurance/regulated overlay challenge

**Status implication:** remains `REVIEWED`.

## Gate 5 — Release
- [x] version/status/research cutoff
- [x] review triggers
- [x] source status/watchlist
- [x] known limitations
- [ ] named accountable owner

## Gate 6 — Learning
Starts after field use.

---

# 154. Required field-validation plan before `VALIDATED`

Run at least five trials:

### Trial A — greenfield B2B SaaS
Decisions:
- modular monolith vs services;
- multitenancy;
- DB/cache;
- region topology.

### Trial B — legacy modernization
Decisions:
- service extraction;
- Strangler Fig;
- data coexistence;
- rollback.

### Trial C — distributed high-scale workflow
Decisions:
- sync/async;
- queues;
- idempotency;
- consistency;
- overload.

### Trial D — AI/agentic system
Decisions:
- model/tool boundary;
- policy gate;
- memory;
- approval/kill;
- monitoring.

### Trial E — high-assurance overlay
Check whether:
- architecture playbook escalates correctly;
- it does not substitute for domain standard;
- traceability/independent review increase appropriately.

For each:
- non-author user;
- realistic constraints;
- observe ambiguity;
- record defects;
- retest after changes.

---

# 155. One-page Golden Standard

If only this section is used:

1. Start from outcome, not stack.
2. Define the system boundary.
3. Identify architecturally significant requirements.
4. Turn quality adjectives into scenarios.
5. Separate constraints, thresholds and optimizations.
6. Classify criticality and reversibility.
7. Prefer the least complex adequate system.
8. Make hard assumptions visible.
9. Keep state authority explicit.
10. Define who may write each material fact.
11. Protect invariants before optimizing scale.
12. Choose consistency from invariants/user semantics.
13. Never infer global causal order from wall-clock time alone.
14. Define conflict and ordering semantics where concurrency exists.
15. Treat remote calls as failure-bearing.
16. Define end-to-end deadlines/cancellation.
17. Retry only safe transient work within a budget.
18. Design idempotency for duplicate-prone work.
19. Bound queues and in-flight work.
20. Design overload behavior before overload happens.
21. Treat partial completion as normal across independent transactions.
22. Use explicit compensation/reconciliation.
23. Define trust and authorization boundaries.
24. Do not use network location or an AI model as authority.
25. Minimize sensitive data lifecycle.
26. Treat tenant isolation as a system invariant.
27. Set reliability from user consequence, not prestige.
28. Design restore/failover and test them.
29. Model workload using distributions and bottlenecks.
30. Do not cache without staleness/invalidation semantics.
31. Instrument architecture assumptions and critical state.
32. Separate logical modules from deployment units.
33. Earn every service/network boundary.
34. Microservices are an option, not maturity.
35. A modular monolith is a first-class production architecture.
36. Async reduces some coupling and adds other coupling.
37. Event-driven requires explicit delivery/order/replay semantics.
38. CQRS/event sourcing are contextual.
39. Serverless/Kubernetes are runtime/platform choices, not architecture goals.
40. Multi-region adds failure modes as well as redundancy.
41. Multi-cloud is not a generic lock-in cure.
42. Build/buy on lifecycle economics and strategic control.
43. Treat operator cognition and cost as architecture constraints.
44. Record significant decisions, not every choice.
45. Link architecture decisions to evidence and revisit triggers.
46. Treat diagrams as views, not proof.
47. Automate enforceable architecture properties, but do not mistake passing checks for full assurance.
48. Migrate through compatible, observable stages when feasible.
49. Co-design rollback/roll-forward with state.
50. Treat AI/agents as probabilistic decision components behind deterministic policy/authorization.
51. Bound agent tools, loops, cost, concurrency and side effects.
52. Monitor AI after deployment.
53. Revisit architecture after incidents, scale shifts, new evidence and changed constraints.
54. Retire systems and compatibility paths deliberately.
55. Architecture is good only when the running system demonstrates the properties that matter.
56. Reconcile intended, implemented and observed architecture where drift matters.
57. Evaluate reference architectures in the target context rather than copying them.
58. Treat organizational coordination as an architecture input, not a deterministic service map.
59. For ML/AI systems, model data/model uncertainty and preserve provenance.
60. Trace material architecture claims from requirement/invariant through mechanism to test and production evidence.

---


# 156. Architecture erosion, drift and conformance

A production architecture can diverge from its intended design over time.

Use four separate concepts:

```text
INTENDED ARCHITECTURE
  what the current architecture decisions/constraints say should be true

IMPLEMENTED ARCHITECTURE
  structures and dependencies encoded in source/config/infrastructure

OBSERVED ARCHITECTURE
  runtime calls, deployments, data flows, queues, policies and side effects actually seen

ARCHITECTURE DESCRIPTION
  the human/machine-readable representations of the architecture
```

A 2022 systematic mapping of 73 studies found architecture erosion manifests through more than structural violations: it also affects software quality and evolution, and non-technical causes deserve attention alongside technical causes.

## 156.1 Conformance rules

A conformance rule SHOULD protect something consequential:

- dependency direction;
- trust boundary;
- tenant isolation;
- data ownership;
- API compatibility;
- deployment/failure isolation;
- performance budget;
- privacy/residency;
- privileged capability.

Do not enforce style for its own sake.

## 156.2 Conformance evidence

Possible evidence:

- static dependency checks;
- code/module graph;
- database access policies;
- API/schema compatibility;
- IaC/deployment inventory;
- runtime traces;
- service call graph;
- queue/topic inventory;
- network policy;
- authorization tests;
- architecture review.

Empirical practice research shows formal architecture-consistency approaches face adoption cost and modeling limitations. Therefore V2.1 uses **risk-proportionate conformance**, not universal heavy architecture tooling.

## 156.3 Intentional deviation

A deviation MAY be correct.

Record material deviation as:

```yaml
constraint:
observed_deviation:
reason:
risk:
compensating_control:
owner:
approved_by:
expiry_or_review:
```

Unrecorded divergence is risk. Recorded, justified adaptation is not automatically erosion.

---

# 157. Architecture-to-verification traceability

For material architecture claims, trace:

```text
STAKEHOLDER CONCERN
→ ASR / QUALITY SCENARIO / INVARIANT
→ ARCHITECTURE DECISION
→ IMPLEMENTED MECHANISM
→ VERIFICATION / TEST
→ PRODUCTION SIGNAL
→ REVISIT TRIGGER
```

Example:

```text
Cross-tenant access must never occur
→ tenant-isolation constraint
→ tenant context propagated from trusted identity + DB authorization policy
→ policy implementation + tenant-scoped data access
→ negative authorization tests + cross-tenant integration tests
→ security audit events / anomaly monitor
→ any isolation defect or policy bypass triggers architecture review
```

## 157.1 Architecture-based testing

Architecture views can inform testing by exposing:

- component interactions;
- critical paths;
- trust boundaries;
- dependency failure paths;
- deployment/failure topology;
- state-machine transitions;
- architectural tactics.

Very recent 2026 systematic review evidence indicates architecture views are commonly used to derive/select tests, but architecture-driven coverage criteria remain methodologically immature.

Therefore:

- **SHOULD** use architecture to target risk-relevant tests;
- **MUST NOT** claim a universal architecture-coverage percentage proves architecture correctness;
- **SHOULD** tie architecture tests to explicit scenarios/invariants.

---

# 158. Socio-technical architecture

Software architecture is produced and operated by organizations.

Technical dependencies create coordination needs.

Relevant organizational factors include:

- ownership;
- expertise;
- communication paths;
- on-call responsibility;
- approval boundaries;
- release coordination;
- incentives;
- cognitive load.

Empirical socio-technical research supports the importance of matching coordination to technical/work dependencies.

## 158.1 Anti-determinism rule

Do not infer:

```text
one team = one service
one bounded context = one team
organization chart = architecture
```

Prefer:

> **Use organizational structure and coordination cost as architecture inputs; co-evolve architecture and organization when useful; preserve technical correctness and user outcomes over diagrammatic symmetry.**

## 158.2 Coordination hotspot test

Investigate when:

- one change repeatedly needs many teams;
- ownership is unclear during incidents;
- service boundaries require constant synchronous coordination;
- shared state has many independent writers;
- API changes require fleet-wide release meetings;
- platform governance blocks ordinary local change.

The fix may be:
- architecture;
- organization;
- contract;
- tooling;
- ownership;
- process;
- or a combination.

---

# 159. Reference architectures

A reference architecture is a reusable architecture knowledge asset for a class/domain of systems.

It can provide:

- common terminology;
- recurring structures;
- constraints;
- known patterns;
- domain rules;
- regulatory context;
- reusable decisions.

It is **not** proof that the target system should instantiate it literally.

A 2026 systematic mapping of 139 primary studies on reference-architecture evaluation reinforces the importance of evaluating applicability and instantiated architectures rather than assuming reuse guarantees quality.

## 159.1 Reference-architecture adoption gate

Before adoption:

```yaml
reference_architecture:
source_and_version:
target_system:
target_context_fit:
requirements_fit:
quality_scenarios_fit:
constraints_fit:
assumptions:
elements_reused:
elements_rejected:
local_variations:
evidence:
exit_or_revision_trigger:
```

## 159.2 Anti-pattern — Reference Architecture Cargo Cult

Symptom:
- provider/industry reference diagram copied directly;
- local workload, failure, data and ownership semantics never tested.

Fix:
- treat reference architecture as a source of alternatives and known mechanisms;
- evaluate target fit;
- record deviations;
- verify the instantiated system.

---

# 160. Architecture decision evidence and ADR limits

Architecture decisions are often weakly amenable to clean randomized experiments.

Empirical architecture-decision research is valuable but uneven, and much literature concentrates on decision documentation rather than causal outcome proof.

Therefore:

- an ADR records reasoning; it does not prove the decision was optimal;
- decision quality SHOULD be judged by available evidence and later observed behavior;
- architecture decisions SHOULD have revisit triggers;
- retrospective success does not prove an alternative would have failed;
- a famous company's architecture is operational evidence, not causal optimality.

### V2.1 evidence rule

For consequential decisions:

```text
EXTERNAL EVIDENCE
+ LOCAL CONSTRAINTS
+ LOCAL EXPERIMENT / MEASUREMENT WHERE USEFUL
+ EXPLICIT UNCERTAINTY
+ POST-DECISION OBSERVATION
```

---

# 161. Architecture debt and evolvability

Architecture debt is future cost/risk caused by structural or architectural choices.

Examples:

- shared state that prevents independent change;
- unsupported platform;
- cross-boundary transaction sprawl;
- duplicated authority;
- obsolete compatibility layer;
- insufficient isolation;
- accidental synchronous dependency chain;
- irreversible vendor-specific data model.

Record:

```yaml
debt_id:
decision_or_constraint:
short_term_value:
current_interest:
future_option_loss:
affected_quality:
trigger_for_action:
candidate_remediation:
migration_risk:
owner:
```

Systematic technical-debt prioritization research has not established one validated universal prioritization method.

Therefore:

- **MUST NOT** reduce architecture debt to a single universal numeric score;
- **SHOULD** prioritize by consequence, change friction, strategic option loss, incidents, cost and roadmap relevance.

---

# 162. CAP and distributed-consistency theorem discipline

Gilbert and Lynch formalized Brewer's conjecture in an asynchronous network model: consistency, availability and partition tolerance cannot all be guaranteed simultaneously under the theorem's conditions.

This does **not** mean:

```text
Every database permanently chooses exactly two global properties.
```

V2.1 decision process:

1. Define the operation.
2. Define the consistency/correctness property.
3. Define the partition/failure assumption.
4. Define what “available” means for that operation.
5. Define acceptable stale/conflict behavior.
6. Define invariant consequence.
7. Evaluate coordination/transaction mechanisms.
8. Evaluate recovery/convergence.
9. Measure whether weaker semantics create material value.

Highly Available Transactions and invariant-confluence research further show that specific guarantees/invariants differ in whether they can remain highly available without coordination.

### Rule

> **Use CAP as a scoped impossibility boundary, not a three-letter architecture selection worksheet.**

---

# 163. ML-enabled system architecture

ML-enabled systems add quality concerns because behavior depends on:

- data;
- learned model;
- statistical performance;
- distribution shift;
- training/inference pipeline;
- feedback loops;
- model/version lineage.

A 2025 systematic review of 206 sources identified 11 recurring quality attributes, 16 architecture tactics and 85 possible quality trade-offs for ML-enabled systems.

## 163.1 Architecture decomposition

Separate as appropriate:

```text
DATA SOURCES
→ INGESTION / VALIDATION
→ FEATURE / REPRESENTATION
→ TRAINING
→ MODEL REGISTRY / PROVENANCE
→ DEPLOYMENT
→ INFERENCE
→ DECISION / POLICY
→ FEEDBACK / MONITORING
```

## 163.2 Additional architecture questions

- What data distribution is assumed?
- What happens under drift?
- Which model/version produced the decision?
- Can a model be rolled back independently?
- What deterministic guardrails own correctness?
- What is the fallback?
- How are labels/feedback delayed or biased?
- What is monitored in production?
- Can training data or feedback create poisoning loops?

## 163.3 Rule

Model quality is not equivalent to system quality.

Architecture MUST integrate model behavior with deterministic controls, data lifecycle, operations and user/business consequences.

---

# 164. GenAI and AI-assisted architecting

Recent review work finds GenAI use in software architecture is still comparatively immature, with uses such as architecture decision support and architecture reconstruction.

Therefore:

### AI may assist with
- alternative generation;
- source/evidence synthesis;
- architecture reconstruction;
- ADR drafting;
- threat/failure brainstorming;
- scenario generation;
- code/config dependency analysis.

### AI MUST NOT be treated as independent assurance for
- the architecture it generated;
- current platform semantics it did not verify;
- security/safety claims;
- capacity assumptions;
- legal/compliance applicability;
- target-system fit.

## 164.1 AI architecture-output verification

For consequential AI-generated architecture work:

- verify external facts against current authoritative sources;
- test assumptions locally;
- require deterministic/runtime evidence;
- preserve human/team understanding;
- record provenance;
- treat confident language as no evidence of correctness.

A second model can add diversity; it is not automatically independent assurance.

---

# 165. Agentic architecture evidence maturity

Agentic AI architecture remains fast-moving.

An August 2026 systematic mapping of 37 studies in software quality assurance found:
- fragmented adoption;
- concentration in execution/product-assurance tasks;
- limited long-term industrial validation;
- gaps around transparency, generalizability and accountability.

This supports V2.1's conservative architecture posture:

- autonomy scales with consequence;
- policy/authorization stays outside model persuasion;
- memory is controlled state;
- tool chains are bounded;
- side effects are auditable;
- high-impact actions require stronger approval/verification;
- post-deployment monitoring is required.

Specific agent frameworks, multi-agent topologies and orchestration libraries remain `CTX/EMG`, not universal architecture standards.

---

# 166. Additional V2.1 Architecture Standards

101. **MUST** distinguish intended, implemented, observed and documented architecture where divergence could create material risk.
102. **SHOULD** automate conformance only for properties whose value/requirement is explicit.
103. **MUST** permit governed exceptions rather than confusing all divergence with erosion.
104. **SHOULD** trace material ASRs/invariants through decisions to verification evidence.
105. **MUST NOT** claim a universal architecture test-coverage percentage establishes correctness.
106. **SHOULD** treat organizational coordination needs as architecture inputs, not deterministic service boundaries.
107. **MUST** evaluate a reference architecture against the target system before treating it as a baseline.
108. **MUST NOT** treat an ADR as evidence that a decision was optimal.
109. **MUST NOT** use a universal numeric score as the sole architecture-debt prioritization mechanism.
110. **MUST** use CAP results within their actual operation/network/model assumptions, not as a global “pick two” slogan.
111. **MUST** model data/model uncertainty separately in ML-enabled systems where it can change user/system outcomes.
112. **MUST** preserve model/version/data provenance where AI behavior is consequential.
113. **MUST NOT** treat AI-generated architecture as independent verification of itself.
114. **SHOULD** use post-deployment evidence to validate architecture claims that cannot be established completely before release.
115. **MUST** revisit material architecture when conformance/erosion, incidents, new evidence or changed operating context invalidate an assumption.

---

# 167. V2.1 source-register addendum

### S45 — Gilbert & Lynch — Brewer's conjecture / CAP formalization
**URL:** https://doi.org/10.1145/564585.564601  
**Evidence:** `E3 — FOUNDATIONAL_FORMAL_DISTRIBUTED_SYSTEMS`  
**Finding:** proves the consistency/availability/partition limitation in the stated asynchronous network model and discusses partially synchronous conditions.  
**Limitation:** the popular “pick two” slogan over-generalizes the theorem when used as a global database/system taxonomy.

### S46 — Li, Liang, Soliman & Avgeriou (2022) — Understanding Software Architecture Erosion
**URL:** https://doi.org/10.1002/smr.2423  
**Evidence:** `E2 — SYSTEMATIC_MAPPING_STUDY`  
**Finding:** 73 studies; erosion includes architectural violations, structural issues, quality/evolution consequences and non-technical causes.  
**Limitation:** authors call for more industrial empirical studies.

### S47 — Ali et al. (2018) — Architecture consistency: State of the practice
**URL:** https://doi.org/10.1007/s10664-017-9515-3  
**Evidence:** `E3 — EMPIRICAL_PRACTITIONER_STUDY`  
**Finding:** experienced practitioners commonly use informal consistency approaches; barriers include effort, modeling limits and difficulty quantifying benefit.  
**Limitation:** 19 senior practitioners; does not determine one universal conformance method.

### S48 — Lenarduzzi et al. (2020) — Technical Debt prioritization SLR
**URL:** https://doi.org/10.1016/j.jss.2020.110827  
**Evidence:** `E2 — SYSTEMATIC_LITERATURE_REVIEW`  
**Finding:** 44 primary studies; no conclusive consensus/validated universal factors/tools for TD prioritization; architecture debt is a material subtype.  
**Limitation:** literature cutoff predates newer tools; strengthens caution more than a specific prioritization method.

### S49 — Cataldo, Herbsleb & Carley (2008) — Socio-Technical Congruence
**URL:** https://herbsleb.org/web-pubs/pdfs/cataldo-socio-2008.pdf  
**Evidence:** `E3 — PEER_REVIEWED_EMPIRICAL_SOFTWARE_ENGINEERING`  
**Finding:** technical/work dependencies create coordination needs; congruence between coordination and dependencies relates to development outcomes.  
**Limitation:** organizational/product context matters; does not imply one team topology.

### S50 — Moreira et al. (2026) — How are software reference architectures being evaluated?
**URL:** https://doi.org/10.1016/j.infsof.2026.108116  
**Evidence:** `E2 — SYSTEMATIC_MAPPING_STUDY`  
**Finding:** 139 primary studies; experiments and case studies are common RA evaluation modes; instantiated architectures/prototypes are frequently evaluated.  
**Limitation:** maps evaluation practice; does not prove one evaluation method is universally best.

### S51 — Architectural tactics for ML-enabled systems (2025)
**URL:** https://doi.org/10.1016/j.jss.2025.112373  
**Evidence:** `E2 — SYSTEMATIC_LITERATURE_REVIEW`  
**Finding:** 206 sources; 11 common quality attributes, 16 architectural tactics and 85 potential quality trade-offs.  
**Limitation:** theory-building synthesis; authors call for additional real-world validation.

### S52 — Generative AI for software architecture — applications, challenges and future directions
**URL:** https://doi.org/10.1016/j.jss.2025.112607  
**Evidence:** `E2/E7 — MULTIVOCAL_LITERATURE_REVIEW`  
**Finding:** GenAI is being used for architecture decision support and reconstruction, but the area remains immature.  
**Limitation:** mixes peer-reviewed and gray literature; fast-moving model/tool versions.

### S53 — Ouaarous, Hilal & Mezrioui (2026) — Agentic AI in SQA
**URL:** https://doi.org/10.3389/fcomp.2026.1936730  
**Evidence:** `E2 — SYSTEMATIC_MAPPING_STUDY`  
**Finding:** 37 primary studies; fragmented adoption, execution-heavy coverage and gaps around transparency, scalability/generalizability and long-term industrial validation.  
**Limitation:** SQA-focused and 2023–2025 primary-study window; not a complete agent architecture standard.

### S54 — Lee & Kang (2026) — Architecture-based software testing SLR
**URL:** https://doi.org/10.1016/j.infsof.2026.108206  
**Evidence:** `E2 — VERY_RECENT_SYSTEMATIC_REVIEW`  
**Status at cutoff:** available online; assigned to the October 2026 issue after this playbook's September 27 cutoff.  
**Finding:** 41 primary studies; architecture views often guide test derivation/selection; reusable architecture-driven coverage criteria remain a research direction.  
**Rule:** used as emerging corroboration, not as a mature normative baseline.

### S55 — Jarallah et al. (2026) — Serverless performance optimization SLR
**URL:** https://doi.org/10.1016/j.mlwa.2026.100994  
**Evidence:** `E2 — SYSTEMATIC_LITERATURE_REVIEW`  
**Finding:** 80 studies (2020–2025); serverless performance is multi-objective across latency, cold start, execution time, throughput, resource allocation and cost.  
**Limitation:** focused on AI-driven performance optimization; does not establish serverless superiority.

### S56 — Ghorbian & Ghobaei-Arani (2024) — Cold-start latency survey
**URL:** https://doi.org/10.1007/s00607-024-01335-5  
**Evidence:** `E2 — REVIEW`  
**Finding:** cold start remains a material serverless challenge with multiple mitigation classes and resource trade-offs.  
**Limitation:** cold-start focused.

### S57 — Architecture-based software testing / source-status watch
**Evidence role:** `WATCH`  
The testing review above is deliberately marked as extremely recent because its journal issue is October 2026. Future V2 surveillance should reassess it after the issue date and follow-up citations/replications.

---

# 168. V2.1 deep audit verdict

The second audit changes the confidence model more than the architecture doctrine.

### HIGH confidence
- outcome/constraint-driven architecture;
- quality-scenario reasoning;
- information hiding;
- explicit state/write authority/invariants;
- explicit ordering/consistency semantics;
- bounded failure/retries/queues;
- lifecycle security/privacy;
- tenant isolation requirement;
- migration/recovery as architecture concerns;
- current-vs-draft standard discipline.

### MODERATE / contextual
- exact architecture style;
- exact service granularity;
- DDD tactical implementation;
- ADR format/process;
- organization↔service topology;
- specific architecture-conformance tooling;
- serverless/Kubernetes/service-mesh choices;
- reference architecture reuse method;
- exact architecture debt priority.

### EMERGING
- agent orchestration topology;
- autonomous architecture-generation workflows;
- AI-specific architecture monitoring standards;
- universal architecture-driven testing adequacy measures.

This calibrated confidence is a stronger standard than pretending all recommendations have equal evidence.

---

# 169. Final V2.1 research conclusion

The evidence does **not** support a universal best software architecture.

It supports a stronger and more useful proposition:

> **Good architecture is a disciplined, evidence-aware process for preserving required system properties under change and failure while spending no more complexity than those properties justify.**

The most durable cross-context architecture concerns are therefore not style names. They are:

```text
INTENT
→ STAKEHOLDER CONCERNS
→ QUALITY SCENARIOS
→ INVARIANTS
→ STATE / WRITE AUTHORITY
→ BOUNDARIES / COUPLING
→ TRUST / AUTHORIZATION
→ CONSISTENCY / ORDERING
→ FAILURE / OVERLOAD / RECOVERY
→ OPERABILITY / OBSERVABILITY
→ ECONOMICS
→ EVOLUTION / MIGRATION
→ EVIDENCE / LEARNING
```

This is the canonical V2.1 Research-Audited Golden Master doctrine.

---

# Change log

## 2.1 — 2026-09-27
- completed a second full V1 claim-level, section-level and source-level sanity audit;
- re-verified ISO 42010/42020/42030 status and the 2026 AWI revision watch items;
- added CAP theorem scope discipline;
- added architecture erosion, conformance and intended/implemented/observed architecture;
- added architecture-to-verification traceability and very-recent ABT evidence;
- added socio-technical coordination guidance;
- added reference-architecture evaluation;
- strengthened architecture-debt evidence boundaries;
- added ML-enabled systems architecture evidence from a 206-source SLR;
- strengthened GenAI/AI-assisted architecting and agentic evidence maturity;
- updated serverless evidence with 2024/2026 reviews;
- retained `REVIEWED` because field validation remains outstanding.

## 2.0 — 2026-09-27
- rebuilt V1 through full falsification/freshness/contradiction audit;
- added current ISO architecture-standard status and 2026 watch items;
- integrated systematic evidence on microservices and DDD;
- deepened distributed state/consistency/coordination;
- deepened overload/retry/queue design;
- added multitenancy, control/data plane, economics and platform engineering;
- added AI/agent architecture and 2026 evaluation/monitoring controls;
- added Plays, decision trees, templates, failure catalogue, anti-patterns and assurance package;
- retained `REVIEWED` pending representative field validation.


---

# Mechanical release audit

The exported Golden Master received a final mechanical integrity check after synthesis:

```text
Markdown code fences balanced: YES
Unfinished action markers: 0
Unresolved template markers: 0
Architecture/source headings present: YES
V1 claim-level + deep falsification findings integrated into V2.1: YES
Current-vs-draft architecture standard status separated and reverified 2026-09-27: YES
Release status consistent with Master Playbook Standard: REVIEWED
```

`VALIDATED` is intentionally withheld until representative non-author field execution and the validation trials in §154 are completed.
