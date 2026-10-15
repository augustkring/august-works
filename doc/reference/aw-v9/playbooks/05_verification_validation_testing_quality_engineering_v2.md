# 05 — Verification, Validation, Testing & Quality Engineering — V2 Golden Master

> **Evidence-weighted evergreen standard for risk-proportional software assurance**

```yaml
document_id: SWE-05
title: Verification, Validation, Testing & Quality Engineering
version: 2.0-GOLDEN-MASTER
status: REVIEWED
created: 2026-09-27
last_updated: 2026-09-27
evidence_cutoff: 2026-09-27
canonical_language: English
inherits:
  - MPS-001 Master Playbook Standard v2.0-RC1
  - SWE-00 Universal Software & AI Engineering Master Playbook v2.0
specializes:
  - verification
  - validation
  - software testing
  - software quality assurance
  - quality engineering
  - test automation
  - software assurance
  - AI/ML/LLM/agent evaluation
primary_archetype:
  - Operating
  - Execution
  - Decision
  - Capability
risk_model: C0-C4 inherited from SWE-00
volatility: moderate
fast_watch_areas:
  - AI evaluation and monitoring
  - agent assurance and runtime controls
  - application-security verification
  - quality-engineering standards
  - accessibility conformance standards
next_scheduled_review: 2026-12-27
review_triggers:
  - IEEE 1012 revision or replacement
  - IEEE 730 revision or replacement
  - ISO/IEC/IEEE 29119 family revision
  - ISO/IEC/IEEE 25000-70 publication from DIS
  - ISO/IEC 25059 replacement publication
  - NIST TEVV-Athlon final publication
  - material change to NIST ARIA evaluation guidance
  - material change to OWASP ASVS/WSTG/agent-control guidance
  - field evidence invalidates a core rule
```

## Status note

This V2 is the **research-reviewed Golden Master** produced after a V1 research draft and an explicit falsification/sanity audit. It is intentionally marked `REVIEWED`, not `VALIDATED`: under the governing Master Playbook Standard, validation requires representative non-author execution and field evidence appropriate to the risk level.

The standard is designed to remain useful across ordinary web applications, APIs, distributed systems, data systems, AI-enabled software, agentic systems, embedded/system software, and high-assurance overlays without pretending that one test stack, test pyramid, coverage percentage, or toolchain is universally optimal.

---

# Executive standard

Software assurance is the disciplined production of **decision-relevant evidence** that a system is sufficiently correct and fit for intended use at its actual consequence level.

The durable chain is:

```text
INTENT / REQUIREMENT / HAZARD
→ SYSTEM BOUNDARY + ASSUMPTIONS
→ FAILURE MODE / QUALITY RISK
→ ASSURANCE CLAIM
→ ORACLE / ACCEPTANCE RULE
→ VERIFICATION + VALIDATION METHOD PORTFOLIO
→ EVIDENCE
→ INDEPENDENT CHALLENGE WHERE WARRANTED
→ RELEASE DECISION
→ PRODUCTION VERIFICATION / MONITORING
→ DEFECT + INCIDENT LEARNING
→ REGRESSION / STANDARD UPDATE
```

The governing doctrine is:

> **Do not ask “how many tests do we need?” Ask “which material claims must be true, what can falsify them, what evidence can detect the relevant failures, how independent and representative must that evidence be, and what residual uncertainty is acceptable for this consequence level?”**

Testing is one assurance instrument. Reviews, static analysis, type/schema constraints, formal reasoning, inspections, measurements, simulations, user validation, security assessment, production monitoring, and recovery exercises can all provide assurance evidence when they fit the claim.

No individual signal is proof of overall quality:

- green CI is not production readiness;
- 100% coverage is not correctness;
- a high mutation score is not correctness;
- a pentest is not a secure lifecycle;
- a formal proof of the wrong specification is not a valid product;
- a benchmark score is not real-world AI reliability;
- a passing accessibility scanner is not complete conformance or usability;
- a backup file is not verified recoverability;
- a staging pass is not production equivalence.

Rigor MUST increase with consequence, exposure, irreversibility, uncertainty, blast radius and autonomy, and MAY decrease when failures are readily detectable and recoverable before material harm.

---

# 1. Purpose

This playbook defines how to design, execute, evaluate, govern, and improve software verification, validation, testing, quality assurance, and quality engineering so that assurance is:

- **risk-proportional** rather than ceremonial;
- **claim-driven** rather than test-count-driven;
- **multi-method** rather than tool-monoculture;
- **traceable** from requirement/risk to evidence and released artifact;
- **independent enough** for the consequence level;
- **production-aware** without using users as uncontrolled test subjects;
- **maintainable** as software and evidence evolve;
- **AI-aware** for probabilistic, adaptive and agentic systems;
- **honest about residual uncertainty**.

The outcome is not “more tests.” The outcome is **sufficient justified confidence for the release/operation decision**.

---

# 2. Scope and non-scope

## 2.1 In scope

- verification and validation architecture;
- quality engineering across the software lifecycle;
- assurance planning and evidence selection;
- reviews, inspections and static verification;
- unit/component/domain tests;
- integration, contract and compatibility tests;
- system, end-to-end and acceptance tests;
- regression strategy and test-impact selection;
- exploratory testing;
- property-based, metamorphic and model-based testing;
- fuzzing and robustness testing;
- mutation testing and test-suite adequacy signals;
- concurrency/distributed-state testing;
- formal specification/model checking where justified;
- performance, capacity, stress, soak and overload testing;
- resilience, chaos, failover and recovery testing;
- security verification and adversarial assessment;
- privacy/data-lifecycle verification;
- accessibility conformance and usability validation;
- migration, backup/restore and reconciliation verification;
- test data, environments and test-harness assurance;
- CI/CD quality gates;
- production verification, canaries and synthetic checks;
- AI/ML/LLM/RAG/agent TEVV;
- defect severity, waivers and residual-risk acceptance;
- evidence provenance, traceability and assurance packages;
- metrics and test-suite health;
- checklists, templates and release gates.

## 2.2 Out of scope

This document does not replace:

- domain certification or safety standards;
- legal/regulatory interpretation;
- language/runtime-specific test guides;
- dedicated security, privacy, SRE or AI-safety playbooks;
- a product requirements specification;
- a universal mandate for any named test methodology.

Where a domain-specific standard requires stronger controls, the domain overlay governs.

---

# 3. Canonical terminology

## 3.1 Verification

**Verification** asks whether a product, component, work product, property or control conforms to its specified requirement, constraint, contract or model.

Verification evidence MAY include:

- review and inspection;
- static analysis;
- type/schema checking;
- proof or formal analysis;
- test execution;
- measurement;
- simulation;
- configuration assessment;
- traceability analysis.

Testing is therefore a subset of verification, not its synonym [VV01].

## 3.2 Validation

**Validation** asks whether the system is suitable for its intended users, purpose, environment and operating conditions.

A system can be verified against a wrong or incomplete requirement and still fail validation.

## 3.3 Testing

**Testing** is the planned execution or evaluation of software/system behavior to obtain evidence about specified or discovered properties.

A test is useful only if:

1. its purpose/claim is known;
2. its setup is representative enough for that claim;
3. its oracle can distinguish acceptable from unacceptable behavior;
4. its result is trustworthy;
5. the result changes or supports a decision.

## 3.4 Quality assurance

**Quality assurance (QA)** is the set of activities that provides confidence that appropriate quality processes, controls and evidence exist and are applied.

QA does not “own quality” on behalf of engineering. Product, engineering, security, operations, data and other accountable roles retain ownership of the quality properties they create.

## 3.5 Quality engineering

**Quality engineering (QE)** means designing quality into requirements, architecture, implementation, delivery and operation rather than treating quality as a downstream test phase.

QE includes prevention, detectability, testability, observability, change safety, recovery, evidence architecture and learning [SQA01].

## 3.6 Assurance claim

An **assurance claim** is a proposition whose truth matters to a decision.

Examples:

- `AUTH-01`: a user cannot modify another tenant's invoice.
- `DATA-03`: an accepted payment event is never posted twice.
- `PERF-02`: p99 checkout latency remains below the defined SLO at the expected peak workload.
- `REC-01`: the service can restore within RTO without exceeding RPO and passes post-restore reconciliation.
- `AI-07`: the agent does not execute a high-impact tool action without valid authorization.

## 3.7 Test oracle

A **test oracle** is the rule, reference, model, invariant, comparator or competent judgment used to determine whether an observed result is acceptable.

Weak oracles create false confidence even when test execution is flawless [ORACLE01].

## 3.8 Residual risk

**Residual risk** is the material uncertainty/consequence remaining after controls and evidence are applied.

Residual risk MUST be visible rather than hidden behind a green status.

---

# 4. Evidence and rule architecture

This specialist playbook inherits Playbook 00's evidence lanes and claim-fit rule.

## 4.1 Source fit before prestige

Use the source class that can legitimately answer the question:

| Question | Strong evidence candidates |
|---|---|
| What is mandatory? | applicable law, contract, certification/domain standard |
| What does a formal V&V/testing standard require/define? | IEEE/ISO primary standard |
| What technique detects certain failure classes? | systematic/empirical research + mature operational evidence |
| What does a tool/platform actually do? | current official documentation + direct verification |
| What works in this system? | local experiments, defect/incident data, production evidence |
| Is the product usable/appropriate? | representative users/operators + outcome evidence |
| Is an AI system reliable enough? | multi-method evals + human/domain evidence + post-deployment monitoring |

## 4.2 Rule status

Each major recommendation should be interpretable as:

- **A — Universal principle:** durable default across most software contexts.
- **B — Strong contextual principle:** strong mechanism with explicit boundary conditions.
- **C — Risk/criticality control:** required above a consequence/exposure threshold.
- **D — Heuristic/pattern:** useful starting method, not universal law.
- **E — Implementation choice:** tool/architecture/process option.
- **F — Rejected dogma:** too absolute, misleading or unsupported.

## 4.3 Evidence confidence

Use `HIGH`, `MODERATE`, `LOW`, `INSUFFICIENT` only for a specific claim.

Do not convert confidence into a mandatory action mechanically. A `MUST` can come from an external requirement or deliberate internal control even when causal evidence is not high-certainty.

## 4.4 Version status is evidence

Every fast-moving source MUST be labeled as one of:

- current/final;
- current but replacement under development;
- draft / Initial Public Draft / DIS / FDIS;
- superseded/withdrawn.

Drafts can inform watchlists and design direction but MUST NOT silently become the current normative baseline.

---

# 5. Quality model for assurance

ISO/IEC 25010:2023 provides the current product-quality model; this playbook uses it as a reference rather than a one-number score [QUAL01].

An assurance strategy SHOULD ask which of the following can make the product unacceptable:

1. functional correctness;
2. data/state integrity;
3. safety;
4. security;
5. privacy;
6. reliability/resilience;
7. performance/capacity;
8. compatibility/interoperability;
9. accessibility/interaction quality;
10. operability/observability;
11. maintainability/evolvability;
12. release/change safety;
13. supply-chain/build integrity;
14. resource/cost constraints;
15. AI-specific behavioral quality where applicable.

Not every change needs equal assurance across every dimension. The question is:

> **What becomes unacceptable if this property is wrong, and what evidence would reveal that before the consequence becomes material?**

---

# 6. Criticality and assurance model

This playbook inherits the `C0–C4` criticality model from SWE-00.

| Level | Consequence posture | Default assurance posture |
|---|---|---|
| **C0 — Experimental** | disposable/non-production, no material user/data/value consequence | fast learning, basic hygiene, explicit non-production state |
| **C1 — Ordinary** | limited recoverable inconvenience | normal automated verification, review, monitoring |
| **C2 — Material** | revenue, customer data, important operations | stronger risk analysis, representative integration/system evidence, staged release, recovery proof |
| **C3 — High assurance** | major financial/privacy/security/societal consequence | independent challenge, traceability, deeper failure testing, formalized evidence, stronger release authority |
| **C4 — Safety/mission critical** | serious injury/loss of life/catastrophic or equivalent mission loss | specialist/domain standard, formal safety assurance, independent V&V as required, audit-grade evidence |

[VV01][NASA01]

## 6.1 Criticality is not a test-count multiplier

Higher criticality does **not** mean “run 5× more tests.” It means increase the strength of the assurance system where necessary:

- better-defined claims;
- stronger requirements/oracles;
- more representative environments;
- broader failure-mode coverage;
- increased independence;
- stronger traceability;
- lower tolerated ambiguity;
- more rigorous release/waiver authority;
- stronger recovery evidence;
- production monitoring proportionate to remaining uncertainty.

## 6.2 Assurance-selection dimensions

Classify the change/system using at least:

- failure consequence;
- external exposure/attackability;
- irreversibility/data loss;
- uncertainty/novelty;
- blast radius;
- autonomy/agent capability;
- detectability before harm;
- recoverability;
- user vulnerability;
- regulatory/contractual obligations;
- frequency/repetition;
- complexity/concurrency/distribution;
- dependency criticality.

The decision heuristic is inherited from SWE-00:

```text
FAILURE CONSEQUENCE
× EXPOSURE
× IRREVERSIBILITY
× UNCERTAINTY
× BLAST RADIUS
× AUTONOMY
÷ (RECOVERABILITY × DETECTABILITY)
→ REQUIRED ASSURANCE
```

This is qualitative decision logic, not arithmetic.

## 6.3 Minimum evidence by criticality

| Evidence dimension | C0 | C1 | C2 | C3 | C4 |
|---|---|---|---|---|---|
| explicit acceptance/claim | basic | required | required | formalized | domain-governed |
| automated deterministic checks | basic | expected | expected | required where automatable | domain-governed |
| peer review | optional | expected for material changes | required default | required | independent/domain rule |
| integration/system evidence | as relevant | risk-based | required for material boundaries | required/representative | domain rule |
| failure/recovery evidence | as relevant | basic | required for material failure modes | extensive | domain rule |
| security/privacy evidence | baseline | risk-based | threat-model driven | independent/deep | domain rule |
| production verification | optional | targeted | staged/observed where relevant | controlled progressive evidence | domain rule |
| traceability | lightweight | lightweight | critical claims | required for material claims/controls | audit-grade |
| independent assurance | no default | optional | targeted when consequence warrants | required for critical claims | domain rule / independent V&V |
| waiver authority | owner | owner/lead | named risk owner | segregated/independent approval | formal governance |

This table is `HOUSE` implementation of the risk-proportional principles in IEEE 1012 and NASA guidance; it is not an IEEE certification table.

---

# 7. The Golden Assurance Rules

1. **Start from the assurance claim, not the test tool.**
2. **Verification and validation are different questions; do both where each matters.**
3. **Testing is evidence, not proof.**
4. **Rigor scales with consequence, not organizational prestige or test volume.**
5. **Specify the oracle before trusting the result.**
6. **Trace material evidence to the exact requirement/risk and released artifact/configuration it supports.**
7. **Use the cheapest method that can provide sufficiently strong evidence for the claim.**
8. **Prefer prevention/enforcement over detection where the invariant can be encoded safely.**
9. **Automate stable deterministic verification; reserve human attention for semantics, ambiguity, usability and adversarial reasoning.**
10. **Test where risk lives; do not force a test pyramid when boundaries or system interactions dominate risk.**
11. **Mocks are models, not reality; validate material boundaries against real semantics.**
12. **Coverage is execution evidence, never a correctness certificate.**
13. **Mutation score is a diagnostic of assertion sensitivity, not a universal quality score.**
14. **Regression selection must be measurable and periodically challenged by deeper/full runs.**
15. **Flakiness is a defect in the assurance system, not normal background noise.**
16. **Test infrastructure must itself be tested, versioned and observable.**
17. **A test that never influences a decision should be deleted, redesigned or moved off the critical path.**
18. **Test data must be governed like the data it represents.**
19. **Environment fidelity is semantic, not visual or infrastructural cosplay.**
20. **Failure paths, cancellation, retries, duplicate delivery, concurrency and recovery require explicit evidence where plausible.**
21. **Restoration is not complete until integrity/reconciliation is verified.**
22. **Security verification combines requirements-based and adversarial evidence; scanners and pentests are not standalone proof.**
23. **Accessibility automation is necessary evidence for many criteria but not complete conformance or usability evidence.**
24. **Performance testing must include the workload model, percentiles and overload behavior relevant to users.**
25. **Chaos/failure injection is an experiment with hypotheses, abort criteria and blast-radius controls—not random breakage.**
26. **Formal methods prove scoped properties under assumptions; validate the specification and implementation linkage separately.**
27. **Production gives unique evidence, but production testing must be bounded, observable, reversible and ethical.**
28. **AI evaluation requires distributions, representative tasks, failure taxonomy and multiple evidence modes—not one benchmark score.**
29. **LLM-as-judge is a measurement instrument that requires calibration, independence analysis and human/domain sampling.**
30. **RAG, model, tool, agent-policy and end-to-end failures must be separable enough to diagnose.**
31. **Agent authorization is verified outside model persuasion.**
32. **Model/provider/prompt/data/tool changes can invalidate AI evidence and require targeted re-evaluation.**
33. **Quality gates should block only when timely blocking materially reduces risk; deeper evidence can run post-submit/pre-release when appropriate.**
34. **Waivers are explicit risk decisions with owner, evidence gap, compensating control and expiry.**
35. **Metrics exist to support decisions; do not optimize test counts, pass rates or coverage as ends.**
36. **Escaped defects and incidents feed back into the assurance model, not merely into another regression case.**
37. **Independent assurance increases with consequence and correlation risk.**
38. **The same mechanism should not be sole producer and sole judge of high-consequence output when diverse evidence is practical.**
39. **No release is “fully tested”; release when the residual risk is justified and monitored.**
40. **Retire stale tests and stale assurance claims deliberately.**

---

# 8. Assurance claims and the assurance spine

## 8.1 Claim-first record

For each material assurance claim, record:

```yaml
claim_id:
statement:
requirement_or_risk_id:
quality_attribute:
criticality:
preconditions:
assumptions:
acceptance_or_oracle:
methods:
required_independence:
environment:
evidence_artifacts:
release_artifact_or_config:
result:
residual_uncertainty:
owner:
retest_triggers:
```

## 8.2 Assurance spine

For C2+ material behavior and all C3/C4 critical claims, maintain enough traceability to reconstruct:

```text
REQUIREMENT / HAZARD / RISK
→ ASSURANCE CLAIM
→ DESIGN / CONTROL / IMPLEMENTATION
→ VERIFICATION / VALIDATION METHOD
→ TEST / REVIEW / ANALYSIS EVIDENCE
→ DEFECTS / EXCEPTIONS
→ RELEASE ARTIFACT + CONFIG
→ PRODUCTION SIGNAL
→ CHANGE / REGRESSION IMPACT
```

No unexplained orphan state should remain for a critical claim:

- requirement with no implementation/control;
- critical control with no evidence;
- test with no current claim;
- passed evidence tied to the wrong artifact;
- unresolved defect hidden by aggregate green status.

---

# 9. Quality engineering across the lifecycle

Quality engineering is not a stage after implementation [SQA01].

| Lifecycle responsibility | QE question | Typical evidence |
|---|---|---|
| intent/discovery | are we solving the right problem? | user research, prototypes, validation studies |
| requirements | are behaviors/qualities observable enough to verify? | acceptance conditions, invariants, hazard/threat models |
| architecture | are high-risk properties testable/observable/recoverable? | architecture review, models, fitness functions, failure analysis |
| implementation | can invalid states/unsafe changes be prevented cheaply? | types, schemas, linters, static analysis, unit/domain tests |
| integration | do real boundaries preserve contracts? | contract/integration/compatibility tests |
| system | do journeys and cross-cutting qualities hold together? | E2E/system/performance/security/accessibility evidence |
| release | is the exact artifact safe enough to expose? | immutable build evidence, migration/recovery checks, release gates |
| production | does real behavior remain acceptable? | canary, SLI/SLO, synthetic checks, anomaly/AI monitoring |
| learning | did the assurance model miss something? | defect escape analysis, incident/postmortem, test-gap analysis |
| maintenance | do changes invalidate old evidence? | impact analysis, regression, dependency/version surveillance |

## 9.1 Shift left and shift right

`Shift left` is useful when earlier feedback prevents defects cheaply.

`Shift right` is useful when production realism is necessary for confidence.

Neither slogan is a doctrine. The correct principle is:

> **Put each evidence activity at the earliest and safest point where it can answer the assurance question with sufficient fidelity.**

---

# 10. Test strategy construction

A production test strategy MUST be recoverable from the following questions.

## 10.1 Step 1 — Define decisions

What decisions will the evidence inform?

Examples:

- merge;
- release;
- scale rollout;
- complete migration;
- accept residual risk;
- certify control;
- enable agent capability;
- retire old path.

## 10.2 Step 2 — Identify material claims and failure modes

For each outcome/property ask:

- what must always be true?;
- what must never happen?;
- where can state become invalid?;
- where can authorization fail?;
- what can be duplicated, reordered, lost or partially applied?;
- which dependency or environment assumption can be false?;
- what user behavior/context would invalidate the specification?;
- what failure would be hard to detect?;
- what failure cannot be safely reversed?

## 10.3 Step 3 — Define the oracle

For each material claim define what distinguishes acceptable from unacceptable behavior.

Oracle sources can include:

- explicit requirements;
- domain invariants;
- reference implementation;
- differential comparison;
- mathematical/property relation;
- metamorphic relation;
- approved golden data;
- protocol specification;
- qualified domain expert judgment;
- user task success;
- SLO/threshold;
- security policy;
- statistical acceptance rule.

## 10.4 Step 4 — Choose complementary methods

Select methods by failure mechanism, not habit.

## 10.5 Step 5 — Choose evidence timing

Classify each check as:

- local/pre-commit;
- pre-submit/PR blocking;
- post-submit/mainline;
- pre-release;
- deployment gate;
- post-deploy/canary;
- scheduled/deep assurance;
- event-triggered.

## 10.6 Step 6 — Define independence

For material claims decide whether evidence may be produced by:

- the author/change owner;
- independent reviewer;
- separate tool/implementation;
- domain/security specialist;
- independent V&V/certification function.

## 10.7 Step 7 — Define stop/pass/waiver rules

A test strategy without decision rules is a data-collection plan, not an assurance plan.

---

# 11. Method-selection framework

Choose methods from the claim/failure mode.

| Claim / risk | Strong candidate methods | Common weak substitute |
|---|---|---|
| deterministic business rule | unit/domain examples + property tests | only E2E clicks |
| invariant across broad state/input space | property-based/model-based/formal where justified | many hand-picked examples |
| API/component boundary semantics | contract + integration with representative dependency | mocks only |
| critical user journey | system/E2E + user acceptance | isolated unit coverage |
| malformed/untrusted parser input | fuzzing + semantic validation + security review | happy-path examples |
| authorization boundary | policy tests + negative tests + ASVS/security review | hidden UI controls |
| race/interleaving | deterministic concurrency scheduler/model/stress | repeated normal CI run |
| distributed protocol/state machine | model/state-machine tests; formal spec/model checking when consequence justifies | ad hoc manual testing |
| schema/API evolution | compatibility/consumer-contract/migration rehearsal | compile-only check |
| performance/capacity | workload benchmark/load/stress/soak/overload | average dev-machine latency |
| resilience/recovery | deterministic failure injection, restore/failover drill, reconciliation; chaos where mature | backup existence |
| accessibility | automated criteria + manual keyboard/AT + user validation as warranted | scanner only |
| usability/fitness | representative user task validation | internal sign-off only |
| security posture | requirements verification + threat-model tests + static/dynamic/fuzz/adversarial/pentest as risk warrants | one scanner/pentest |
| AI task quality | representative eval sets + repeated trials + human/domain review | one benchmark |
| AI harmful behavior | adversarial/red-team + misuse cases + policy/control tests | provider safety claim |
| agent tool safety | authorization/side-effect simulation + adversarial tool-chain tests + audit/recovery | prompt instruction |
| RAG factual grounding | retrieval eval + grounding/attribution eval + end-to-end task eval | answer fluency score |

[VV01][TESTSTD04][FUZZ01][FORMAL01][ASVS01][ARIA01]

## 11.1 Selection sequence

```text
What can fail?
→ Is the claim deterministic or probabilistic?
→ Is the failure local, boundary, system, human, operational or adversarial?
→ Can the invariant be prevented/enforced rather than merely tested?
→ What is the strongest affordable oracle?
→ What evidence method exposes the failure mechanism?
→ How representative must environment/data/users be?
→ How independent must the evidence be?
→ What residual uncertainty remains?
```

---

# 12. Test portfolio architecture

There is no universal ideal distribution of unit/integration/E2E tests.

## 12.1 Portfolio goals

A healthy portfolio balances:

- **signal strength** — probability that a failure indicates a real relevant defect;
- **fault sensitivity** — ability to detect the target failure class;
- **fidelity** — similarity to semantics that matter in production;
- **feedback latency** — time to actionable result;
- **determinism** — repeatability;
- **diagnosability** — ability to localize failure;
- **cost** — compute, engineering and maintenance;
- **coverage of material claims** — not line count;
- **independence** — diversity of evidence mechanisms.

## 12.2 Test pyramid status

The test pyramid is `D — heuristic`.

A broad base of fast tests with fewer expensive system tests is often useful, but MUST NOT override the architecture and risk distribution. If most meaningful risk lives at integration boundaries, then integration evidence deserves more weight.

## 12.3 Portfolio anti-correlation

For C3/C4 claims, seek evidence diversity where practical:

```text
IMPLEMENTATION TESTS
+ STATIC / TYPE / SCHEMA EVIDENCE
+ INDEPENDENT REVIEW
+ SYSTEM / RUNTIME EVIDENCE
+ ADVERSARIAL OR FORMAL EVIDENCE WHERE FIT
+ PRODUCTION MONITORING
```

Many tests generated from the same wrong assumption do not provide independent confidence.

---
# 13. Static verification and defect prevention

Dynamic execution is not always the cheapest or strongest way to verify a property.

## 13.1 Static evidence portfolio

Use as appropriate:

- compiler/type checking;
- schema validation;
- database constraints;
- lint/policy checks;
- static application security testing;
- secret scanning;
- dependency/license policy checks;
- configuration validation;
- architecture/dependency rules;
- IaC/policy-as-code checks;
- formal static analysis;
- generated-artifact consistency;
- review/inspection.

## 13.2 Prevent where practical

Prefer making unacceptable states structurally impossible or difficult when the control is reliable and understandable.

Examples:

```text
nullable field that must never be null
→ non-null schema/type + migration verification

cross-tenant write must never occur
→ authorization policy + database/tenant boundary + negative tests

invalid state transition
→ state machine guard + property/model tests
```

## 13.3 Static-analysis limitations

Static tools have false positives, false negatives, configuration gaps and scope limits. Their findings are evidence, not an unconditional security or correctness certificate.

High-consequence static rules SHOULD have:

- versioned configuration;
- rationale;
- baseline/suppression governance;
- ownership;
- failure severity;
- periodic challenge against actual defects.

---

# 14. Reviews, inspections and independent challenge

ISO/IEC 20246:2017 provides a current work-product review framework; IEEE 1012 treats review/inspection as V&V evidence [REVIEWSTD01][VV01].

## 14.1 Review is assurance when it has a claim

Review SHOULD focus on:

- intended behavior and acceptance;
- invariants/state transitions;
- failure handling;
- security/privacy boundaries;
- concurrency/ordering;
- migrations/data effects;
- compatibility;
- operability/recovery;
- test/oracle quality;
- unnecessary complexity;
- evidence gaps.

Do not spend expert review time on formatting a deterministic tool can enforce.

## 14.2 Independence levels

| Independence | Typical use |
|---|---|
| self-check | C0/C1 local hygiene |
| peer review | normal production changes |
| separate specialist review | security/privacy/data/high-risk domains |
| independent internal assurance | C3 critical claims |
| external/domain independent V&V | C4 or governing standard requires |

Independence is valuable when it reduces common-mode reasoning failure. It is not automatically valuable if the reviewer lacks relevant competence.

## 14.3 Review evidence

For C2+ material changes, retain where useful:

- reviewer identity/role;
- scope reviewed;
- material comments/findings;
- disposition;
- unresolved disagreement/risk acceptance.

---

# 15. Test design standard

ISO/IEC/IEEE 29119-4:2021 provides test-design techniques; this playbook uses techniques as tools rather than one mandatory taxonomy [TESTSTD04].

## 15.1 Technique families

Select according to the defect model:

- equivalence partitioning;
- boundary-value analysis;
- decision tables;
- state-transition testing;
- combinatorial/pairwise testing;
- use-case/scenario testing;
- classification trees;
- cause-effect reasoning;
- error guessing based on defect history;
- property-based generation;
- model-based generation;
- metamorphic testing;
- fuzzing;
- exploratory charters.

## 15.2 Boundary-first default

Boundary failures are disproportionately important because software fails where assumptions change:

- trust boundary;
- process/service boundary;
- schema/version boundary;
- ownership boundary;
- time/ordering boundary;
- numeric/range boundary;
- resource/capacity boundary;
- tenant/security boundary;
- human/software handoff.

Test design SHOULD explicitly enumerate material boundaries.

## 15.3 Negative testing

For each critical capability ask:

- who must not be able to do this?;
- what malformed or stale state must be rejected?;
- what happens when a dependency lies, times out or partially succeeds?;
- what if the request repeats?;
- what if events arrive out of order?;
- what if authorization changes mid-operation?;
- what if the system restarts between steps?

---

# 16. Unit, component and domain testing

## 16.1 Purpose

Unit/component/domain tests are strong when they provide fast, deterministic evidence about local behavior and invariants.

Use them for:

- domain rules;
- state transitions;
- calculations;
- pure transformations;
- error handling;
- permissions/policy logic that can be isolated;
- serialization/parsing logic;
- edge/boundary values;
- properties/invariants.

## 16.2 Avoid implementation-coupled tests

A test that asserts private call order or internal structure without behavioral value creates refactoring friction rather than assurance.

Prefer externally meaningful behavior at the narrowest useful boundary.

## 16.3 Do not mock the subject into existence

Excessive mocking can make a test pass against an invented world. If correctness depends on database semantics, queue ordering, auth behavior, framework lifecycle or network protocol, include evidence against representative real semantics elsewhere in the portfolio.

---

# 17. Integration, contract and compatibility testing

## 17.1 Integration claims

Integration tests answer whether components preserve the real semantics of their boundary:

- schema;
- validation;
- auth/authz;
- timeout/cancellation;
- retry/idempotency;
- ordering;
- transaction/consistency;
- version compatibility;
- error mapping;
- quotas/rate limits where material.

## 17.2 Contract tests

Contract testing is strong when independent producers/consumers evolve and a stable contract can be specified.

A contract test MUST NOT be treated as proof that the provider behaves correctly beyond the modeled contract.

## 17.3 Consumer-driven contracts

Use when consumer expectations are an important source of compatibility requirements. Maintain ownership to avoid fossilizing obsolete consumers indefinitely.

## 17.4 Real dependency vs emulator

Use emulators/mocks for speed/isolation when useful, but identify semantic gaps explicitly.

Material external boundaries SHOULD receive periodic or release-critical verification against the real service/protocol/version when feasible.

---

# 18. System, end-to-end and acceptance testing

## 18.1 System/E2E purpose

Use system/E2E tests when assurance depends on composition:

- critical user journeys;
- cross-service data/state propagation;
- authentication/session flow;
- real routing/configuration;
- deployment wiring;
- browser/device behavior;
- integrated observability;
- multi-step side effects.

## 18.2 Keep E2E evidence focused

E2E suites become weak when they are enormous, slow, nondeterministic and hard to diagnose.

Use them for high-value composed behavior; verify lower-level detail at cheaper layers.

## 18.3 Acceptance validation

Acceptance is not merely “all tests pass.” It confirms that the delivered behavior is acceptable to the relevant owner/user under intended conditions.

For C2+ user-critical flows, validation SHOULD include representative task scenarios and relevant user/stakeholder evidence where specification fitness remains uncertain.

---

# 19. Exploratory testing

Exploratory testing is `B/D — strong contextual practice`, not a substitute for regression automation.

Use it where:

- the product/problem space is changing;
- the failure space is poorly modeled;
- human interaction matters;
- new integration behavior is hard to enumerate;
- incident/defect history suggests unknown unknowns.

## 19.1 Charter format

```yaml
charter:
risk_or_question:
scope:
timebox:
environment:
data:
observer:
notes_and_evidence:
defects:
new_test_ideas:
assurance_claims_affected:
```

Exploration SHOULD produce reusable learning rather than disappearing as tacit tester knowledge.

---

# 20. Regression strategy

Regression exists to detect unintended change to behavior that must remain stable.

## 20.1 Regression set categories

Maintain intentional categories such as:

- smoke/critical-path;
- changed-feature;
- impacted-boundary;
- high-risk invariant;
- defect-regression;
- compatibility;
- security control;
- migration/data;
- deep/full scheduled suite.

## 20.2 Test-impact analysis

Selective regression MAY reduce feedback cost when selection is based on evidence such as:

- dependency graph;
- ownership/module mapping;
- changed API/schema;
- historical test-change relation;
- runtime coverage/change mapping;
- risk tags;
- configuration/feature interactions.

[TESTSEL01]

## 20.3 Safety controls for selection

A selection system SHOULD track:

- selected vs omitted tests;
- escaped failures later caught by deeper/full suites;
- false-negative rate where measurable;
- model/rule version;
- change classes where selection is not trusted;
- fallback to deeper suite.

For C2+ systems, periodically run a sufficiently deep reference suite to challenge the selector.

## 20.4 Full regression is not universal

`Run everything on every commit` is a heuristic with potentially poor economics. Use full/deep regression where its additional evidence value justifies latency/cost or where regulation requires it.

---

# 21. Coverage and adequacy

Coverage indicates what was executed, not whether the right assertions or oracles existed [COVER01].

## 21.1 Useful coverage dimensions

Depending on technology:

- statement/line;
- branch/decision;
- condition;
- path subset;
- function/method;
- state transition;
- requirements/claims;
- API/schema compatibility;
- mutation/defect sensitivity;
- user/risk scenario coverage.

## 21.2 Coverage policy

Coverage thresholds MAY be used as guardrails to prevent gross regression, but SHOULD NOT be represented as a universal quality target.

Better use:

> “Critical authorization and ledger packages must not lose branch coverage below the maintained baseline, and material uncovered branches require review.”

Worse use:

> “All repositories must have 90% coverage because 90% means high quality.”

## 21.3 Requirements/claim coverage outranks code prestige

For C3/C4 assurance, trace critical requirements/claims to current evidence rather than relying on code coverage alone.

---

# 22. Mutation testing

Mutation testing changes code deliberately to test whether the suite detects plausible faults. Large-scale Google evidence supports its usefulness as a test-strength signal in appropriate workflows [MUT01].

Use mutation testing when:

- assertion sensitivity matters;
- logic is deterministic;
- mutants represent plausible fault classes;
- cost is manageable;
- surviving mutants can drive action.

Do not:

- maximize mutation score mechanically;
- treat equivalent/unimportant mutants as product defects;
- block all low-value generated code on mutation score;
- confuse mutant detection with end-to-end correctness.

A surviving high-value mutant should trigger either stronger testing, a rationale that the mutant is irrelevant/equivalent, or reevaluation of the claim.

---

# 23. Property-based testing

Property-based testing generates inputs/states and checks properties rather than relying only on manually chosen examples [PBT01].

## 23.1 Strong properties

Examples:

- round trip: `decode(encode(x)) == x`;
- conservation: ledger totals remain balanced;
- monotonicity/bounds;
- idempotency: repeated operation has one business effect;
- authorization: unauthorized principals never reach privileged state;
- state-machine invariants;
- commutativity where domain permits;
- normalization equivalence;
- parser never crashes/hangs within resource bound.

## 23.2 Shrinking/minimization

When tooling supports it, minimized counterexamples materially improve diagnosis and regression quality.

## 23.3 Limits

Weak properties generate many weak tests. Realistic generators are themselves part of the assurance model and require review.

---

# 24. Metamorphic and differential testing

Use when a direct expected-output oracle is difficult or expensive [ORACLE01].

## 24.1 Metamorphic relations

Define transformations where the output relationship is known even if the exact answer is not.

Examples:

- reordering commutative inputs should not change result;
- adding an irrelevant field should not change authorization;
- equivalent unit conversions preserve physical quantity;
- duplicate idempotent requests preserve one logical effect.

## 24.2 Differential testing

Compare implementations/versions/models when one is a useful reference.

Caution: two systems can share the same defect. Differential agreement is evidence, not truth.

---

# 25. Fuzzing and robustness testing

NIST defines fuzzing as a software-assurance technique that feeds invalid/unexpected/generated inputs while monitoring undesirable behavior [FUZZ01].

## 25.1 Strong targets

- parsers/decoders;
- file formats;
- protocols;
- serialization;
- image/media processing;
- CLI/API input boundaries;
- smart contracts/transaction inputs;
- security-sensitive state machines.

## 25.2 Fuzzing requirements

A material fuzz campaign SHOULD define:

```yaml
target:
input_model_or_seed_corpus:
properties_or_crash_oracles:
resource_limits:
sanitizers_or_instrumentation:
duration_or_budget:
corpus_retention:
crash_deduplication:
minimization:
triage_owner:
regression_conversion:
```

## 25.3 Fuzzing limits

Fuzzing is weak for semantic correctness if the oracle only detects crashes. Combine with invariants, sanitizers, assertions, differential/metamorphic oracles and domain checks where appropriate.

---

# 26. Model-based and state-machine testing

Use model-based testing when behavior is naturally described as states, transitions, commands or protocols.

Strong use cases:

- workflow/state engines;
- payment/order lifecycles;
- authentication/session state;
- distributed coordination;
- agent action policies;
- device/control state machines.

## 26.1 Model quality

A generated test suite cannot be stronger than its model/oracle assumptions.

Validate:

- model scope;
- forbidden/terminal states;
- transition preconditions;
- state abstraction;
- mapping from model action to real implementation;
- observed implementation state back to model state.

---

# 27. Concurrency and distributed-systems testing

Concurrency defects can be nondeterministic, schedule-dependent and invisible in normal tests.

## 27.1 Material properties

Test where relevant:

- mutual exclusion/serialization;
- lost updates;
- duplicate effects;
- stale reads;
- out-of-order delivery;
- retry races;
- cancellation races;
- leader/failover transitions;
- idempotency;
- exactly-once claims;
- lock expiry/lease behavior;
- clock/time assumptions;
- split-brain/partition behavior.

## 27.2 Prefer controlled schedule exploration

Tools such as Microsoft Coyote demonstrate the value of systematic/deterministic exploration of asynchronous schedules where applicable [CONC01].

Repeated stress can still be useful, but “run it 1000 times and hope” is weak assurance for a critical concurrency invariant.

## 27.3 Time and ordering

When tests rely on ordering, specify whether the system guarantees:

- local program order;
- causal order;
- per-key/partition order;
- transactional serialization;
- total order;
- user-visible order.

Do not infer causal correctness solely from wall-clock timestamps.

---

# 28. Formal specification and formal verification

Formal methods are `C/B — risk-dependent assurance methods`, not universal requirements [FORMAL01].

## 28.1 Strong use cases

- small critical protocols;
- safety/security invariants;
- distributed coordination;
- key custody/signing state machines;
- concurrency/interleavings;
- high-impact authorization policies;
- irreversible financial/state transitions.

## 28.2 Three links must be justified separately

```text
RIGHT REQUIREMENT?
→ CORRECT FORMAL MODEL?
→ IMPLEMENTATION CONFORMS TO MODEL?
```

A proof of the middle link alone does not establish product correctness.

## 28.3 Evidence package

For material formal assurance retain:

- model/specification version;
- properties checked/proved;
- assumptions/environment model;
- tool/version/configuration;
- counterexamples and disposition;
- requirement-to-property traceability;
- model-to-implementation conformance strategy;
- independent review where consequence warrants.

---

# 29. Performance, capacity, stress, soak and overload testing

Performance is only meaningful relative to a workload and user/system requirement.

## 29.1 Workload model

Define:

- request/event mix;
- arrival pattern;
- concurrency;
- payload/data size;
- dataset/cardinality;
- geographic/network conditions;
- warm/cold state;
- dependency behavior;
- cache hit/miss mix;
- resource limits;
- background work;
- tenant skew;
- model/token distribution for AI systems.

## 29.2 Test types

- **benchmark:** controlled comparison of a scoped operation;
- **load:** expected workload;
- **stress:** above expected/limit-seeking workload;
- **spike:** rapid demand change;
- **soak/endurance:** sustained duration/resource leakage;
- **capacity:** maximum acceptable workload under SLO;
- **overload:** behavior once capacity is exceeded.

## 29.3 Required outputs

Use distributions rather than average alone:

- p50/p95/p99 or domain-relevant tail;
- throughput;
- error/rejection rate;
- saturation/resource;
- queue depth/age;
- dependency impact;
- cost per useful outcome where material.

## 29.4 Overload is a correctness question

Validate bounded queues/concurrency, admission control, load shedding, retry amplification and graceful degradation where relevant [OVERLOAD01].

The goal is not merely to find “max requests/sec”; it is to verify acceptable behavior before, at and beyond capacity.

---

# 30. Resilience and failure-injection testing

Start with known failure modes before broad chaos experimentation.

## 30.1 Deterministic resilience tests

Test material dependencies/operations under:

- timeout/latency;
- unavailable dependency;
- malformed/stale response;
- partial success;
- duplicate/out-of-order delivery;
- resource exhaustion;
- process restart;
- node/zone/provider loss where relevant;
- expired credential/certificate;
- rate-limit/quota exhaustion;
- clock/time anomalies where material.

## 30.2 Chaos engineering status

Chaos engineering is `B/D — contextual resilience experiment`, not a universal release gate [CHAOS01][CHAOS02].

Use when:

- system has mature observability/recovery;
- unknown interactions matter;
- experiment blast radius is bounded;
- steady-state hypothesis is defined;
- rollback/abort is credible;
- responsible operators approve the experiment.

## 30.3 Chaos experiment record

```yaml
hypothesis:
steady_state_signal:
failure_injected:
expected_behavior:
blast_radius:
preconditions:
abort_thresholds:
observers:
rollback_or_recovery:
results:
unexpected_effects:
follow_up:
```

Chaos without an oracle or abort rule is uncontrolled breakage, not quality engineering.

---

# 31. Backup, restore, failover and recovery verification

A backup is a recovery hypothesis until restoration is demonstrated.

## 31.1 Recovery claims

Where material, define:

- RTO;
- RPO;
- restoration dependencies;
- access/credentials during incident;
- recovery ordering;
- application/schema compatibility;
- failback strategy;
- data-integrity/reconciliation rules.

## 31.2 Recovery is not complete at “service is up”

Post-recovery verification MUST check material integrity such as:

- expected record counts;
- ledger/accounting balance;
- object/checksum consistency;
- missing/duplicate events;
- cross-system reconciliation;
- permissions/secret state;
- background job continuity;
- stale cache/search/vector/index rebuild state;
- audit/event continuity.

## 31.3 Representative drills

C2+ critical recovery paths SHOULD be exercised periodically and after material architecture/backup changes.

C3/C4 drills SHOULD test degraded assumptions rather than only the easiest restoration path.

---

# 32. Security verification

Security assurance is threat-model and requirement driven [SEC01][ASVS01].

## 32.1 Layer 1 — security requirements/control verification

Verify explicit controls such as:

- authentication;
- authorization/resource isolation;
- session/token lifecycle;
- input validation/output encoding;
- cryptographic/key use;
- secrets handling;
- logging/audit;
- tenant/data isolation;
- secure configuration;
- dependency/build controls.

OWASP ASVS 5.0 provides a current application-security verification baseline with assurance levels [ASVS01].

## 32.2 Layer 2 — automated security evidence

Use as relevant:

- SAST;
- secret scanning;
- dependency/SCA;
- IaC/config policy;
- DAST;
- fuzzing;
- API/security test automation;
- container/image scanning;
- SBOM/provenance verification.

Automated tools MUST retain scope/limitations and suppression governance.

## 32.3 Layer 3 — adversarial assessment

Use penetration testing, red teaming or specialist review when consequence/threat warrants.

OWASP WSTG stable 4.2 remains a useful web testing guide while v5 is development content at this cutoff [WSTG01].

## 32.4 Security evidence independence

For C3/C4 critical security controls, avoid sole reliance on the implementation author, one scanner, or the same AI that produced the code.

## 32.5 Security release blocker rule

A known exploitable critical control failure MUST NOT be hidden behind aggregate pass rate. Resolve, remove exposure, or obtain explicit risk acceptance under applicable governance.

---

# 33. Privacy and test-data verification

Test environments can create privacy/security risk independently of production.

## 33.1 Data classification before use

For test data define:

```yaml
classification:
source:
purpose:
fields_present:
personal_or_sensitive_data:
masking_or_synthesis:
access:
retention:
deletion:
logging_and_exports:
third_party_tools:
```

## 33.2 Prefer synthetic/minimized data where sufficient

Use production-derived data only when its realism creates material assurance value that cannot reasonably be obtained otherwise and when policy/law allows it.

## 33.3 Verify data lifecycle

Tests SHOULD cover where applicable:

- collection minimization;
- purpose/consent/business-rule constraints;
- access control;
- export;
- retention;
- deletion;
- backup behavior;
- logs/telemetry leakage;
- model/vector/embedding stores.

---

# 34. Accessibility conformance and usability validation

WCAG 2.2 is the current W3C Recommendation and ISO/IEC 40500:2025 reference baseline for web accessibility [ACC01].

## 34.1 Accessibility evidence stack

Depending on product/risk:

1. automated rules/checkers;
2. semantic/manual inspection;
3. keyboard/non-pointer testing;
4. zoom/reflow/text-resize testing;
5. screen-reader/assistive-technology testing;
6. representative user validation.

W3C explicitly notes that tools cannot determine accessibility automatically in full [ACC02].

## 34.2 Separate conformance from usability

A page can pass many WCAG criteria and remain difficult to use. A usable interface can still fail mandatory accessibility criteria.

Track separately:

- conformance evidence;
- assistive-technology interoperability;
- task success/usability;
- defects by severity/user consequence.

---

# 35. Compatibility, schema and migration testing

Live systems often fail during coexistence between old and new versions.

## 35.1 Compatibility matrix

For material evolution define supported combinations:

- old client ↔ new server;
- new client ↔ old server;
- old writer ↔ new schema;
- new writer ↔ old reader;
- rolling deployment mixed versions;
- replay of old events/messages;
- data/config format migration.

## 35.2 Migration verification

Before destructive/stateful migration test:

- representative volume;
- duration/load/locks;
- resumability;
- idempotency;
- partial completion;
- rollback/roll-forward assumptions;
- old/new version coexistence;
- reconciliation;
- stop thresholds;
- backup/recovery.

## 35.3 Backfill verification

Verify not only completion but correctness:

- expected population selected;
- no unintended rows/objects;
- no duplicate side effect;
- rate limits respected;
- errors retriable/visible;
- completion reconciled independently.

---
# 36. Test oracles and the oracle problem

A test with an invalid oracle can systematically certify wrong behavior [ORACLE01].

## 36.1 Oracle hierarchy

Prefer the strongest available source:

1. binding requirement / safety property / policy;
2. mathematically or structurally defined invariant;
3. authoritative protocol/specification;
4. independently validated reference implementation/model;
5. differential/metamorphic relation;
6. trusted historical golden output with controlled provenance;
7. competent human/domain judgment;
8. heuristic proxy.

Lower items are not inherently bad; they carry more uncertainty and SHOULD be labeled accordingly.

## 36.2 Oracle design record

For material tests record:

```yaml
claim:
observed_value:
acceptable_condition:
source_of_truth_or_reference:
tolerance:
statistical_rule_if_any:
known_oracle_limitations:
independence_from_implementation:
```

## 36.3 Circular oracle anti-pattern

Do not calculate the expected result with the same implementation logic being tested unless the claim is specifically about consistency.

## 36.4 Human oracle

Human judgment is appropriate for ambiguous qualities such as usability, semantic relevance, harmfulness or design quality, but should use:

- clear rubric;
- qualified raters;
- representative samples;
- disagreement handling;
- calibration where high consequence;
- blindness/randomization where bias materially matters.

---

# 37. Test data standard

## 37.1 Data representativeness

Test data SHOULD represent the dimensions that can change behavior:

- valid/invalid;
- boundary/extreme;
- missing/null;
- unicode/locale/timezone;
- large/small cardinality;
- skew/hot keys;
- duplicates;
- stale/out-of-order;
- adversarial input;
- user/tenant diversity where relevant;
- historical edge cases;
- rare but high-consequence states.

## 37.2 Data provenance

For C2+ material data-driven tests retain:

- generation/source method;
- version/date;
- schema version;
- sanitization/transformation;
- known sampling gaps;
- refresh trigger.

## 37.3 Golden datasets

Golden sets MUST be versioned and reviewed. A golden dataset that encodes an old bug or stale policy becomes an automated source of false confidence.

## 37.4 AI evaluation data

AI eval sets require additional controls:

- provenance;
- train/test/benchmark leakage risk;
- prompt/context/tool version;
- slice/segment balance;
- hidden holdout where feasible;
- human-label quality;
- contamination watch;
- refresh without erasing longitudinal comparability.

---

# 38. Test environments and fidelity

## 38.1 Semantic parity over cosmetic parity

An environment is representative when it preserves the semantics relevant to the claim.

Material parity may include:

- runtime/database version;
- auth policy;
- queue/delivery semantics;
- schema/data constraints;
- feature/config flags;
- region/network behavior;
- rate limits;
- architecture/OS assumptions;
- dependency API behavior;
- model/provider/tool versions.

A visually identical staging environment with different auth, queue or database semantics can be weaker than a smaller environment that preserves the critical behavior.

## 38.2 Ephemeral environments

Useful for isolation and reproducibility, but verify that ephemeral infrastructure does not remove shared-state/concurrency/production dependencies that are central to the risk.

## 38.3 Test in production

Production evidence MAY include:

- canaries;
- shadow traffic;
- synthetic probes;
- dark launches;
- read-only comparison;
- feature-flag cohorts;
- controlled experiments.

It MUST NOT mean uncontrolled exposure of users to unknown high-consequence failure.

---

# 39. Test harness and test-infrastructure assurance

Broken test infrastructure can invalidate all downstream evidence.

## 39.1 Test the tester

For material harnesses, verify:

- setup/teardown isolation;
- clock/time control;
- random seed handling;
- test data reset;
- environment version;
- result collection;
- assertion failure path;
- timeout/cancellation;
- parallel execution isolation;
- reporting completeness;
- artifact association.

## 39.2 Sentinel tests

Use known-pass and known-fail/synthetic sentinel conditions where they can prove that the harness is actually capable of detecting failure.

Example:

```text
If an authorization suite cannot detect a deliberately disabled policy in a controlled fixture,
its green status is not credible evidence.
```

## 39.3 Framework/tool upgrades

A major test framework/compiler/emulator/model/provider upgrade SHOULD trigger a targeted harness-validity review when semantics may change.

---

# 40. Test automation strategy

Automation is valuable when the check is:

- repeatable;
- sufficiently deterministic;
- frequent enough to justify maintenance;
- decision-relevant;
- machine-observable;
- cheaper/safer than repeated manual execution.

Do not automate merely because a test can be scripted.

## 40.1 Automation ROI

Consider:

```text
expected defect/risk value
+ saved repeated effort
+ feedback speed
+ consistency
- implementation cost
- maintenance cost
- false-failure cost
- environment/harness complexity
```

## 40.2 Human testing remains appropriate

Retain human evidence for:

- exploratory testing;
- novel behavior;
- complex usability;
- assistive technology interaction;
- ambiguous semantic quality;
- adversarial reasoning;
- high-context domain validation.

## 40.3 Automation debt

A test can become technical debt when it is:

- redundant;
- stale;
- slow without unique signal;
- permanently quarantined;
- tied to obsolete behavior;
- asserting implementation detail;
- impossible to diagnose;
- producing ignored failures.

Delete or redesign it deliberately.

---

# 41. CI/CD quality gates and evidence timing

CI should optimize **fast trustworthy feedback**, not maximum work on the critical path.

## 41.1 Gate classes

### Gate A — Local / pre-commit

Typical:

- format/lint;
- compiler/type check;
- focused unit/domain tests;
- lightweight secret/static checks.

### Gate B — Pre-submit / PR blocking

Block on evidence whose delay materially increases integration/release risk:

- build;
- deterministic relevant tests;
- critical static/security/policy checks;
- schema/contract validation;
- high-value regression selection.

### Gate C — Post-submit / mainline

Use for deeper checks that should detect integration problems quickly but need not delay every author:

- larger integration suite;
- broader mutation/property runs;
- platform matrices;
- deeper security scans.

### Gate D — Pre-release / deployment

Typical:

- release artifact provenance;
- full/deep relevant regression;
- migration rehearsal;
- performance/capacity where affected;
- security/quality approval;
- recovery/rollback evidence;
- compliance/domain evidence.

### Gate E — Post-deploy / canary

Typical:

- synthetic critical journey;
- SLI/SLO/guardrail;
- error/latency/capacity;
- data integrity checks;
- AI behavior/agent-action anomalies;
- rollout stop criteria.

## 41.2 Blocker design

A blocking gate SHOULD be:

- reliable enough that engineers do not habitually bypass it;
- fast enough for its operating context;
- clearly owned;
- diagnosable;
- tied to a material claim;
- bypassable only through explicit risk governance.

## 41.3 Green main is not release proof

A main branch can be healthy while:

- migration is unsafe;
- capacity is insufficient;
- secrets/config differ;
- rollback is impossible;
- production dependency behavior differs;
- regulatory approval is missing.

---

# 42. Flaky tests

A flaky test is one whose result changes without a relevant change to the intended behavior or controlled inputs. Flakiness erodes trust and causes rerun culture [FLAKE01][FLAKE02].

## 42.1 Flake policy

Treat as a defect:

1. detect and classify;
2. record owner;
3. isolate/quarantine only when needed to protect signal;
4. set expiry/review date;
5. diagnose root mechanism;
6. repair, replace or delete;
7. verify repair;
8. monitor recurrence.

## 42.2 Common causes

- uncontrolled time;
- shared mutable state;
- race/concurrency;
- external dependency;
- resource starvation;
- random order/seed;
- test pollution;
- environment drift;
- nondeterministic AI/model output;
- fragile UI synchronization.

## 42.3 Never normalize rerun-until-green

Retries MAY be used diagnostically or to classify flakiness, but MUST NOT be the primary method for converting a failing release gate into green.

---

# 43. Test-suite health and lifecycle

A test suite is a production engineering asset with lifecycle cost.

## 43.1 Health signals

Track selectively:

- pass/fail signal quality;
- flake rate;
- median/p95 feedback latency;
- maintenance burden;
- duplicate/redundant coverage;
- quarantine count/age;
- escaped defects by claim area;
- stale test age;
- orphan tests without current claim;
- blocked releases caused by harness defects;
- test selection misses;
- cost per run where material.

## 43.2 Test retirement

Delete or archive a test when:

- requirement/feature is removed;
- another stronger test supersedes it;
- it asserts implementation detail with no remaining assurance value;
- it has no owner and no decision use;
- maintenance cost exceeds unique risk value;
- it is permanently untrustworthy and cannot reasonably be repaired.

Retirement of a C2+ critical test MUST check whether the underlying assurance claim still has sufficient evidence.

## 43.3 Test debt review

Periodically ask:

> If we removed this test today, which material decision would become less justified?

If the answer is “none,” the test is a deletion candidate.

---

# 44. Defects, severity and closure

Use severity tied to consequence, not emotional language.

## 44.1 Canonical severity

**BLOCKER**

- unacceptable safety/security/data/control failure;
- binding requirement violation;
- critical path cannot execute;
- assurance evidence invalid for a critical claim;
- release artifact cannot be trusted.

**MAJOR**

- likely material incorrect behavior;
- important ambiguity/compatibility/recovery gap;
- missing evidence for C2+ material claim;
- significant accessibility/security/privacy defect.

**MINOR**

- non-material defect/friction unlikely to change intended outcome.

**EDITORIAL / TEST-ONLY**

- non-product issue in wording/harness/reporting that does not affect the product claim, but may still require repair to maintain evidence quality.

## 44.2 Closure requires evidence

A defect is closed when:

- root issue or accepted scope is understood;
- corrective change is implemented or risk accepted;
- relevant verification is rerun;
- regression impact is checked;
- production follow-up is defined where necessary.

## 44.3 Escaped defect analysis

For material escaped defects ask:

- was the requirement missing/wrong?;
- was the oracle wrong?;
- was the scenario absent?;
- did selection skip the right test?;
- was environment fidelity insufficient?;
- did the test fail but signal was ignored?;
- did release/config diverge from evidence?;
- did production context invalidate an assumption?

Fix the assurance system, not only the single bug.

---

# 45. Assurance metrics and anti-Goodhart rules

Metrics MUST have decision use.

## 45.1 Metric contract

```yaml
metric:
question_answered:
decision_informed:
definition:
population_denominator:
data_source:
owner:
cadence:
threshold_or_rule:
known_bias_or_gaming_risk:
segments:
retirement_trigger:
```

## 45.2 Useful signal families

### Product quality

- escaped defect rate/severity;
- incident/change failure;
- security/privacy findings;
- task success;
- data-integrity failures.

### Assurance quality

- critical claims with current evidence;
- flaky/quarantined test rate;
- test selection miss rate;
- mean time to diagnose failed gate;
- recovery drill success;
- evidence age/staleness;
- waiver count/age;
- audit findings.

### Delivery economics

- CI feedback latency;
- pre-submit cost;
- deep-suite cost;
- rework/review burden;
- time from defect discovery to verified closure.

## 45.3 Rejected vanity metrics

Never use alone as “quality”:

- number of tests;
- pass percentage;
- coverage percentage;
- mutation score;
- bug count;
- automation percentage;
- benchmark score;
- AI judge score.

## 45.4 Balanced pairs

Prefer pairs that expose gaming:

```text
coverage + mutation/escaped-defect evidence
speed + change failure
pass rate + flaky/quarantine rate
AI task score + harmful-failure/abstention/latency/cost
security findings + exposure/remediation time
recovery time + post-restore integrity
```

---

# 46. Production verification

Production is the only environment with real traffic, data distribution, dependencies and emergent interactions. It is also where mistakes can harm users.

## 46.1 Progressive evidence

Use as justified:

- canary release [CANARY01];
- cohort/feature flag;
- dark launch;
- shadow/read-only comparison;
- synthetic transaction;
- runtime assertion/invariant monitoring;
- data-quality/reconciliation monitor;
- SLI/SLO guardrail;
- error/latency/saturation observation.

## 46.2 Canary decision record

```yaml
change:
cohort:
representativeness:
observation_window:
primary_health_signals:
guardrails:
stop_thresholds:
rollback_or_rollforward:
decision_owner:
```

## 46.3 Production experiment safeguards

MUST consider:

- blast radius;
- consent/ethics where users are affected;
- privacy/security;
- reversibility;
- data side effects;
- observability latency;
- downstream propagation;
- failure containment.

## 46.4 Monitoring is continuing validation

Production monitoring does not replace pre-release assurance. It addresses behavior that only becomes observable in real context or changes over time.

---

# 47. AI/ML/LLM TEVV architecture

NIST's 2026 ARIA Evaluation Planning Manual explicitly treats Model Testing, Red Teaming and User Testing as complementary evidence modes [ARIA01]. NIST AI 800-4 separately emphasizes post-deployment monitoring because pre-deployment evaluation cannot reveal all behavior under dynamic real-world conditions [AIMON01].

## 47.1 AI assurance is statistical and contextual

A single deterministic pass/fail run is generally insufficient for stochastic behavior.

Evaluation SHOULD define as applicable:

- task distribution;
- user/context distribution;
- model/provider/version;
- system prompt/policy;
- temperature/sampling parameters;
- tools/retrieval/memory version;
- repeated trial count;
- random seed where supported;
- confidence intervals/uncertainty;
- failure taxonomy;
- slice/segment performance;
- latency/cost;
- abstention/escalation behavior.

## 47.2 Evaluate the system, not only the base model

Separate evidence for:

```text
MODEL
+ SYSTEM PROMPT / POLICY
+ RETRIEVAL / MEMORY
+ TOOLS / APIS
+ ORCHESTRATION
+ AUTHORIZATION
+ USER INTERACTION
+ PRODUCTION CONTEXT
```

A base-model benchmark does not establish end-to-end system behavior.

## 47.3 Core AI quality questions

Use ISO/IEC 25059:2023 as a current AI-quality reference while its replacement is in final draft stage [AIQUAL01][AIQUAL-DRAFT01]. Ask:

- task effectiveness;
- reliability/robustness;
- harmful/unsafe behavior;
- fairness/segment effects where relevant;
- privacy/security;
- explainability/transparency where required;
- human oversight/appropriate reliance;
- latency/cost/resource;
- drift/change sensitivity.

## 47.4 Repeated trials and distributions

For probabilistic metrics report distributions or uncertainty rather than one cherry-picked result.

Example:

```text
not:   agent passed the scenario
prefer: 197/200 runs completed correctly; 3 unsafe escalation failures; 95% CI ...;
        all three failures occurred on tool-timeout recovery path
```

Use statistical technique appropriate to the decision; do not manufacture precision from tiny samples.

## 47.5 Holdout and contamination

For material AI evals:

- separate development/tuning data from decision-driving holdout where feasible;
- control evaluator access to hidden cases;
- record benchmark/public-data contamination risk;
- refresh cases without making longitudinal comparisons meaningless;
- treat prompt-fitting to a benchmark as potential overfitting.

## 47.6 Adversarial AI testing

Use threat/misuse-driven cases such as:

- prompt/instruction injection;
- jailbreak/goal hijacking;
- poisoned retrieval/memory;
- conflicting instructions;
- malformed tool output;
- privilege escalation;
- social engineering;
- long-context distraction;
- resource/cost exhaustion;
- unsafe action chains;
- high-impact action without authorization.

[NISTAI01][AML01][ACS01]

---

# 48. RAG and retrieval evaluation overlay

RAG systems fail through different mechanisms than standalone generation.

## 48.1 Separate the layers

Evaluate:

1. **corpus/index quality** — relevant authoritative content available/current?;
2. **retrieval quality** — did the system retrieve useful evidence?;
3. **ranking/context construction** — was relevant evidence selected/preserved?;
4. **grounded generation** — does the answer reflect retrieved evidence?;
5. **citation/provenance** — can material claims be traced?;
6. **end-to-end task outcome** — does the user/system achieve the intended result?;
7. **security** — can retrieved content inject instructions or cross trust boundaries?;
8. **freshness** — what invalidates index/eval evidence?

## 48.2 Avoid one aggregate “RAG score”

A poor answer can come from missing corpus, bad retrieval, context truncation, generation hallucination or wrong policy. Preserve diagnostic separation.

---

# 49. Agentic-system evaluation overlay

Agentic systems combine probabilistic planning with software actions and therefore raise assurance with capability × consequence.

## 49.1 Capability classes

At minimum distinguish:

```text
READ PUBLIC
→ READ PRIVATE
→ WRITE REVERSIBLE INTERNAL STATE
→ SEND EXTERNAL COMMUNICATION
→ EXECUTE CODE / MODIFY INFRA
→ SPEND / TRANSFER VALUE
→ DELETE / IRREVERSIBLE ACTION
→ CREATE / GRANT CREDENTIALS
```

## 49.2 Agent assurance claims

Test as relevant:

- correct tool selection;
- authorization outside model prompt;
- least privilege;
- parameter/schema validation;
- preconditions/postconditions;
- duplicate/retry/idempotency;
- concurrent action safety;
- approval boundary;
- transaction/value/rate limits;
- timeout/loop/recursion/cost bounds;
- untrusted-content separation;
- memory provenance/poisoning;
- stop/revoke/kill path;
- partial-action recovery/compensation;
- audit trail completeness.

[ACS01]

## 49.3 Tool mocks are insufficient alone

A mock tool can validate orchestration logic but not real permission, error, rate-limit, transaction or side-effect semantics. Material tool boundaries need representative integration evidence.

## 49.4 Human approval is not a universal safety proof

Validate whether the human receives enough context, time and evidence to make a meaningful decision. Rubber-stamp approval can create delay without assurance.

---

# 50. AI evaluators and LLM-as-judge

LLM-based evaluation MAY improve scale for subjective/semantic tasks, but it is a measurement instrument, not an independent truth source.

## 50.1 Required controls for material use

Define:

- rubric;
- judge model/version/prompt;
- calibration set;
- human/domain reference sample;
- agreement/disagreement analysis;
- positional/style/verbosity biases where relevant;
- sensitivity to adversarial or correlated output;
- threshold/decision use;
- re-calibration trigger.

## 50.2 Correlation risk

A model family judging outputs from a closely related model can share failure modes. For C3/C4 claims, use stronger independent evidence and qualified human/domain review.

## 50.3 Never optimize directly to the judge blindly

Repeated tuning against one evaluator can overfit the measurement system rather than improve the actual user outcome.

---

# 51. Post-deployment AI evaluation and monitoring

NIST AI 800-4 emphasizes that deployed AI operates under changing inputs, users, models and environments, requiring ongoing monitoring [AIMON01].

## 51.1 Monitor what can drift

- input/task distribution;
- output quality/harm;
- refusal/abstention;
- retrieval freshness;
- tool failure/action error;
- human override/escalation;
- latency/cost;
- abuse/adversarial patterns;
- data/model/provider changes;
- policy/config drift.

## 51.2 Re-evaluation triggers

Targeted or full re-evaluation SHOULD trigger on:

- model/provider/version change;
- system prompt/policy change;
- tool addition/removal/permission change;
- retrieval corpus/indexing change;
- memory architecture change;
- major user/task distribution change;
- new failure/incident;
- material regulatory/policy change;
- evaluator/judge change;
- unexplained production metric drift.

## 51.3 Pre-deployment evidence expires

AI evidence MUST record the system version/configuration evaluated. “Model X passed in March” is not assurance for a materially different September system.

## 51.4 TEVV-Athlon status

NIST AI 200-2 TEVV-Athlon is an **Initial Public Draft** at this cutoff and MUST be treated as emerging guidance, not a final normative baseline [TEVV-DRAFT01].

---

# 52. Assurance evidence package

For C2+ material releases, retain proportionate evidence sufficient to reconstruct the decision.

C3/C4 packages SHOULD include as applicable:

- scope/system/change identifier;
- criticality classification;
- requirements/risks/hazards;
- assurance claims;
- test/evaluation strategy;
- traceability matrix;
- test/review/static/formal evidence;
- environment/data/tool versions;
- defects and disposition;
- waivers/residual risks;
- independent reviews;
- migration/recovery evidence;
- security/accessibility/AI evidence as applicable;
- released artifact digest/version;
- configuration/feature/model versions;
- approver/decision record;
- post-deployment monitoring plan.

The package can live across CI, issue tracker, repository, evidence store and monitoring systems. It does not need to be one document.

---

# 53. Evidence provenance to the released artifact

A passing test is only relevant if it applies to the artifact actually released.

## 53.1 Required linkage

For material releases establish as justified:

```text
SOURCE REVISION
→ DEPENDENCIES / BUILD INPUTS
→ BUILD / TEST WORKFLOW
→ TESTED ARTIFACT DIGEST
→ DEPLOYMENT CONFIG / MIGRATION
→ RELEASED ARTIFACT
→ RUNTIME VERSION / COHORT
```

## 53.2 Evidence invalidation

Evidence SHOULD be considered stale or invalid when a material change occurs to:

- code/source revision;
- dependency/build tool;
- compiler/runtime;
- config/feature flag;
- schema/data contract;
- infrastructure semantics;
- security policy;
- model/prompt/retrieval/tool chain;
- environment assumption central to the claim.

Do not reuse evidence solely because the filename or release branch looks similar.

---

# 54. Independence of assurance evidence

Independence reduces common-mode failure but costs time and expertise.

## 54.1 Independence decision rule

Increase independence when:

- consequence is high;
- implementation is novel/complex;
- evidence is subjective;
- one AI/tool produced both artifact and evaluation;
- incentives favor release;
- security/safety/financial control is material;
- assumptions are hard to observe;
- prior escapes show correlated blind spots.

## 54.2 Independence does not mean ignorance

An independent reviewer should be sufficiently competent and have access to necessary context. “Independent” does not justify superficial checkbox review.

## 54.3 C3/C4 default

Critical claims SHOULD receive evidence from at least one sufficiently independent mechanism/reviewer beyond the implementation author unless the governing domain standard specifies stronger requirements.

---

# 55. Waivers, exceptions and residual-risk acceptance

A failed/missing check is not resolved by calling it “known.”

## 55.1 Waiver record

```yaml
waiver_id:
claim_or_gate:
evidence_gap_or_failure:
reason:
consequence_if_wrong:
compensating_controls:
monitoring:
owner:
risk_acceptor:
expires:
retest_or_revisit_trigger:
```

## 55.2 Waiver rules

- C0/C1 low-risk waivers MAY be lightweight.
- C2 material waivers require a named risk owner.
- C3 waivers require segregated/appropriately independent approval.
- C4 follows the governing safety/regulatory assurance process.
- Permanent recurring waivers SHOULD trigger redesign of the rule/system rather than silent normalization.

---
# 56. Quality gates

A release progresses through evidence gates rather than being declared “tested.”

## Gate 0 — Scope and criticality

Pass when:

- intended outcome/system boundary is clear;
- criticality is classified;
- material users/stakeholders are known;
- material quality attributes/risks are identified;
- applicable domain/regulatory overlays are known.

Block if consequence cannot be classified well enough to choose assurance.

## Gate 1 — Requirements and oracle readiness

Pass when:

- material requirements/claims are observable enough to verify;
- unacceptable behavior/invariants are explicit;
- oracles/acceptance rules exist;
- major assumptions/unknowns are visible.

Block when the team cannot distinguish a correct from incorrect result for a critical claim.

## Gate 2 — Strategy and traceability

Pass when:

- methods map to failure modes/claims;
- evidence timing is selected;
- environments/data are adequate;
- independence is selected;
- critical claims are traceable to planned evidence.

## Gate 3 — Construction verification

Pass when applicable:

- build/type/static/policy checks pass;
- unit/domain/property evidence passes;
- code/work-product review passes;
- no unresolved BLOCKER defect exists.

## Gate 4 — Integration/system assurance

Pass when applicable:

- boundary/contract/compatibility evidence passes;
- material E2E/system journeys pass;
- concurrency/state/failure behavior is verified;
- performance/security/accessibility/data evidence meets defined criteria.

## Gate 5 — Recovery/change-safety assurance

Pass when applicable:

- migration/backfill is rehearsed;
- rollback/roll-forward is credible;
- backup/restore/failover evidence is current;
- post-recovery reconciliation passes;
- production rollout/stop signals are defined.

## Gate 6 — AI/agent assurance

When AI applies, pass when:

- representative evals are current;
- stochastic uncertainty is quantified appropriately;
- adversarial/misuse cases are tested;
- judge/evaluator calibration is adequate;
- RAG/tool/agent layers are diagnosed separately where relevant;
- authorization/kill/recovery controls pass;
- re-evaluation triggers and monitoring are defined.

## Gate 7 — Release decision

Pass when:

- exact artifact/configuration is identified;
- required evidence belongs to that artifact;
- defects/waivers/residual risks are visible;
- required independent approvals are complete;
- monitoring/response owner is named.

## Gate 8 — Post-deploy validation

Ongoing:

- canary/guardrails healthy;
- no unexpected integrity/security/user-impact signal;
- AI behavior remains within accepted bounds;
- incidents/escapes feed assurance improvements.

---

# 57. Decision frameworks

## 57.1 Which test level?

```text
Can the claim be verified reliably at a narrow local boundary?
  ├─ YES → start narrow for speed/diagnosis
  └─ NO  → does correctness depend on another real component/semantic boundary?
             ├─ YES → integration/contract evidence
             └─ NO  → does correctness emerge only in composition/user journey?
                        ├─ YES → system/E2E/acceptance evidence
                        └─ NO  → reconsider the claim/oracle
```

The result is usually a portfolio, not one level.

## 57.2 Mock or real dependency?

```text
Is dependency behavior material to the claim?
  ├─ NO → mock/fake can improve speed/isolation
  └─ YES → can a faithful local implementation preserve semantics?
             ├─ YES → use it + periodic real compatibility verification
             └─ NO  → test representative real boundary safely
```

## 57.3 Full regression or test selection?

```text
Is full suite cheap enough for required feedback?
  ├─ YES → run full/deep relevant suite
  └─ NO  → is impact selection measurable and trustworthy for this change class?
             ├─ YES → select + periodic deep reference runs
             └─ NO  → optimize suite/architecture or accept longer evidence window
```

Never select away tests required by regulation or critical control without explicit governance.

## 57.4 Add mutation testing?

Use when deterministic logic + assertion strength matter and survivor triage is actionable. Do not add merely to obtain a score.

## 57.5 Add property-based testing?

Use when invariants can be stated and generated state/input space adds coverage beyond examples.

## 57.6 Add fuzzing?

Use when malformed/unexpected input, parser/protocol robustness or adversarial surface is material.

## 57.7 Add formal methods?

```text
Is there a compact high-consequence property/state machine/protocol?
  ├─ NO → ordinary testing/review likely stronger economics
  └─ YES → are interleavings/state space difficult to cover dynamically?
             ├─ NO → strong dynamic/model tests may suffice
             └─ YES → formal specification/model checking may earn its cost
```

Then validate model correctness and implementation linkage separately.

## 57.8 Add chaos testing?

```text
Are known failure modes already tested deterministically?
  ├─ NO → do that first
  └─ YES → do unknown interactions materially threaten resilience?
             ├─ NO → no chaos requirement
             └─ YES → do observability, abort and blast-radius controls exist?
                        ├─ NO → build controls first
                        └─ YES → run bounded experiment
```

## 57.9 Test in production?

Use production evidence when pre-production cannot reproduce a material property and exposure can be controlled. Prefer canary/shadow/synthetic/read-only mechanisms before uncontrolled live-risk exposure.

## 57.10 Automate this test?

Automate if repetition + determinism + decision value exceed maintenance/noise cost. Keep human judgment where automation would produce a weak proxy.

---

# 58. Definition of Ready for assurance

Before implementation/release testing begins, confirm as applicable:

- [ ] intended behavior/outcome is explicit;
- [ ] system/change boundary is known;
- [ ] C0–C4 criticality is assigned;
- [ ] material quality attributes are identified;
- [ ] material failure modes/risks are identified;
- [ ] critical requirements/invariants are testable/verifiable;
- [ ] oracle/acceptance strategy exists;
- [ ] representative data/environment strategy exists;
- [ ] security/privacy/accessibility/safety overlays are scoped;
- [ ] AI/agent evaluation scope is identified where applicable;
- [ ] required independence is selected;
- [ ] release/production evidence needs are known;
- [ ] traceability depth is selected;
- [ ] waiver authority is identified.

---

# 59. Definition of Done for assurance

A release/change can be considered assurance-complete only when all applicable conditions pass.

## Claims and requirements

- [ ] material claims are explicit;
- [ ] critical requirements/risks map to current evidence;
- [ ] oracle/acceptance criteria are valid enough for decision use;
- [ ] assumptions/limitations are visible.

## Verification

- [ ] relevant static/type/schema/policy checks pass;
- [ ] relevant unit/domain/property tests pass;
- [ ] material boundaries have representative integration/contract evidence;
- [ ] critical composed journeys/system behavior are tested;
- [ ] relevant edge/failure/concurrency cases are exercised;
- [ ] coverage/adequacy metrics are not misrepresented as proof.

## Non-functional assurance

- [ ] security verification is appropriate to threat/criticality;
- [ ] performance/capacity/overload evidence is current where material;
- [ ] resilience/recovery is tested where material;
- [ ] post-recovery reconciliation passes where data/state matter;
- [ ] accessibility evidence is sufficient for applicable interface;
- [ ] privacy/test-data controls are satisfied.

## AI/agent assurance

- [ ] representative task/adversarial evals are current;
- [ ] stochastic results are interpreted with sufficient uncertainty/repetition;
- [ ] eval data leakage/contamination is controlled;
- [ ] LLM judge is calibrated when used materially;
- [ ] RAG/tool/agent layers are separately diagnosable where relevant;
- [ ] agent authorization/limits/kill/recovery controls pass;
- [ ] post-deployment AI monitoring and re-eval triggers exist.

## Test system

- [ ] test harness is trustworthy;
- [ ] blocking tests are sufficiently deterministic;
- [ ] flaky/quarantined tests have owner/expiry;
- [ ] test data is governed;
- [ ] no stale/orphan critical test evidence remains.

## Release

- [ ] evidence maps to exact artifact/config/version;
- [ ] BLOCKER defects are zero;
- [ ] MAJOR defects are zero or explicitly risk-accepted under applicable governance;
- [ ] waivers have owner/expiry/compensating control;
- [ ] rollback/roll-forward and migration state are compatible;
- [ ] post-deploy stop/health signals are defined;
- [ ] required reviewer/approver independence is satisfied.

---

# 60. Core checklists

## 60.1 Test strategy checklist

- [ ] What decision will this evidence support?
- [ ] What are the material assurance claims?
- [ ] What failure modes could falsify each claim?
- [ ] Is the oracle strong and sufficiently independent?
- [ ] Is the environment/data representative for the claim?
- [ ] Is the chosen method sensitive to the failure mechanism?
- [ ] Are negative/error/concurrency/recovery paths covered where relevant?
- [ ] Which checks block PR, release or rollout—and why?
- [ ] What evidence runs later/deeper?
- [ ] What independence is required?
- [ ] What remains uncertain after testing?
- [ ] What triggers re-evaluation?

## 60.2 Pull-request/change assurance checklist

- [ ] intended behavior/acceptance is clear;
- [ ] changed invariants/state considered;
- [ ] security/privacy/trust-boundary change considered;
- [ ] compatibility/schema/migration implications considered;
- [ ] focused tests address actual risk;
- [ ] regression impact assessed;
- [ ] generated/AI code receives independent evidence;
- [ ] no test/control was weakened merely to get green CI;
- [ ] observability/recovery updated where behavior changed.

## 60.3 Release assurance checklist

- [ ] exact artifact/digest/version identified;
- [ ] CI evidence belongs to that artifact;
- [ ] critical claims have current evidence;
- [ ] relevant integration/system/security/performance evidence passes;
- [ ] migration/backfill tested and bounded;
- [ ] restore/rollback/roll-forward path credible;
- [ ] unresolved defects/waivers explicitly accepted;
- [ ] canary/progressive rollout defined where justified;
- [ ] post-release health/stop thresholds defined;
- [ ] owner available for material rollout where required.

## 60.4 Recovery checklist

- [ ] RTO/RPO defined where material;
- [ ] backup exists and is accessible under incident conditions;
- [ ] restore procedure executed successfully;
- [ ] restored app/schema versions compatible;
- [ ] credentials/DNS/network dependencies validated;
- [ ] post-restore data reconciliation passes;
- [ ] background jobs/queues/indexes are healthy;
- [ ] failback/return-to-normal plan exists.

## 60.5 Security verification checklist

- [ ] threat model/current attack surface considered;
- [ ] authentication/authz/resource isolation verified;
- [ ] input/trust boundaries tested;
- [ ] secrets/sensitive data protected;
- [ ] automated security checks appropriate;
- [ ] material parsers/APIs fuzzed where justified;
- [ ] adversarial/pentest evidence used when consequence warrants;
- [ ] critical findings resolved or risk-accepted explicitly;
- [ ] security evidence is sufficiently independent.

## 60.6 Accessibility checklist

- [ ] automated WCAG-relevant checks run;
- [ ] semantic structure manually checked where needed;
- [ ] keyboard/focus behavior verified;
- [ ] zoom/reflow/text resizing verified where applicable;
- [ ] relevant assistive technology tested;
- [ ] errors/status/messages accessible;
- [ ] representative user validation used where consequence/audience warrants;
- [ ] conformance and usability findings are not conflated.

## 60.7 AI/agent evaluation checklist

- [ ] task/use-context and unacceptable failures defined;
- [ ] model/system/prompt/tool/retrieval versions recorded;
- [ ] representative slices/cases defined;
- [ ] repeated trials/statistical uncertainty appropriate;
- [ ] holdout/contamination risk controlled;
- [ ] harmful/adversarial cases included;
- [ ] human/domain reference sample exists where needed;
- [ ] LLM judge calibrated if used;
- [ ] RAG/model/tool/agent failure layers separable;
- [ ] agent authorization and side-effect controls tested;
- [ ] production monitoring/re-evaluation triggers defined.

---

# 61. Canonical templates

## 61.1 Assurance plan

```markdown
# Assurance Plan — [Change/System]

## Decision supported

## Criticality
C0 / C1 / C2 / C3 / C4

## Scope and system boundary

## Material quality risks

## Assurance claims
| Claim ID | Claim | Requirement/risk | Consequence if wrong | Oracle | Method(s) | Independence | Evidence timing |
|---|---|---|---|---|---|---|---|

## Environments and data

## Regression strategy

## Security/privacy/accessibility overlays

## Performance/resilience/recovery overlays

## AI/agent overlay

## Release blockers and waiver authority

## Post-deploy verification

## Evidence retention / provenance
```

## 61.2 Test case / scenario record

```yaml
test_id:
claim_id:
purpose:
preconditions:
inputs:
environment:
steps_or_generator:
oracle:
expected_or_acceptable:
observed:
result: PASS | FAIL | INCONCLUSIVE | BLOCKED
artifacts:
defects:
limitations:
```

## 61.3 Exploratory charter

```yaml
charter:
risk_or_question:
scope:
timebox:
setup:
observations:
defects:
new_unknowns:
new_regression_candidates:
claims_affected:
```

## 61.4 Performance test plan

```yaml
user_or_system_outcome:
workload_model:
data_model:
environment:
dependency_assumptions:
latency_percentiles:
throughput:
error_budget:
resource_limits:
overload_policy:
run_duration:
acceptance_thresholds:
stop_conditions:
```

## 61.5 Resilience/chaos experiment

```yaml
hypothesis:
steady_state:
failure:
blast_radius:
preconditions:
expected_behavior:
abort_threshold:
recovery:
observers:
result:
follow_up:
```

## 61.6 AI evaluation plan

```yaml
intended_use:
prohibited_or_unacceptable_outcomes:
system_version:
model_provider_version:
prompt_policy_version:
retrieval_memory_version:
tools_and_permissions:
segments_slices:
datasets_and_provenance:
holdout_policy:
trial_count_and_sampling:
metrics:
human_rubric:
judge_model_if_used:
adversarial_cases:
security_privacy_tests:
latency_cost:
acceptance_rules:
monitoring:
re_evaluation_triggers:
```

## 61.7 Waiver / residual-risk record

```yaml
waiver_id:
claim_or_gate:
failed_or_missing_evidence:
reason:
consequence:
compensating_control:
monitoring:
owner:
risk_acceptor:
expiry:
revisit_trigger:
```

## 61.8 Traceability matrix

```markdown
| Requirement / risk | Assurance claim | Control / implementation | Test/review/analysis | Evidence | Defect/waiver | Release artifact | Production signal | Status |
|---|---|---|---|---|---|---|---|---|
```

## 61.9 Assurance release record

```yaml
release:
artifact_digest:
source_revision:
configuration_version:
schema_migration_version:
model_prompt_tool_versions:
criticality:
required_gates:
gate_results:
blockers:
majors:
waivers:
independent_reviews:
release_decision:
approved_by:
post_deploy_plan:
```

---

# 62. Anti-patterns — claims to actively resist

## 62.1 “More tests means more quality.”

**Verdict:** `F`.

Better rule: increase evidence where it covers a material claim or failure mode.

## 62.2 “100% coverage means fully tested.”

**Verdict:** `F` [COVER01].

Coverage measures execution, not correctness/oracle quality.

## 62.3 “Every repository should have the same coverage threshold.”

**Verdict:** `F`.

Use risk/claim-based guardrails and local baselines.

## 62.4 “The test pyramid is best practice.”

**Verdict:** `D`.

Use a portfolio matched to architecture and failure distribution.

## 62.5 “Unit tests are more valuable than integration tests.”

**Verdict:** `F`.

They answer different questions.

## 62.6 “Mocks make tests isolated and therefore trustworthy.”

**Verdict:** `F`.

Mocks can create false semantics; validate material real boundaries.

## 62.7 “E2E tests give the strongest confidence.”

**Verdict:** `F`.

They provide composition fidelity but can be slow, flaky and weak at diagnosis/oracle detail.

## 62.8 “A green CI pipeline means releasable.”

**Verdict:** `F`.

Release also depends on artifact identity, migration, capacity, security, configuration, recovery and production evidence.

## 62.9 “Flaky tests are okay if rerun.”

**Verdict:** `F` [FLAKE01][FLAKE02].

Rerun culture destroys signal.

## 62.10 “Mutation testing proves test quality.”

**Verdict:** `F` [MUT01].

It is one sensitivity proxy with cost and mutant-validity limits.

## 62.11 “Property-based testing replaces example tests.”

**Verdict:** `F` [PBT01].

Properties explore broad spaces; examples remain strong for concrete semantics/communication.

## 62.12 “Formal verification proves the system correct.”

**Verdict:** `F` [FORMAL01].

It proves scoped properties under model/assumptions; specification and implementation linkage remain.

## 62.13 “Pentest passed, therefore secure.”

**Verdict:** `F` [ASVS01].

Security requires lifecycle/control evidence and threat-model fit.

## 62.14 “Accessibility scanner passed, therefore accessible.”

**Verdict:** `F` [ACC02].

Many criteria require human/AT evaluation and usability is separate.

## 62.15 “Staging mirrors production, therefore production is safe.”

**Verdict:** `F`.

Production traffic/data/dependencies/emergent interactions remain unique.

## 62.16 “Test in production means ship and watch.”

**Verdict:** `F`.

Production verification requires bounded exposure, observability and recovery.

## 62.17 “Chaos engineering improves resilience.”

**Verdict:** `B/D` [CHAOS01][CHAOS02].

Only when hypothesis, observability, containment and recovery are mature.

## 62.18 “Backups prove disaster recovery.”

**Verdict:** `F`.

Restoration + reconciliation provide evidence.

## 62.19 “Full regression before every merge is safest.”

**Verdict:** `D/F`.

It can create unusable latency; use measured selection + deep runs when appropriate.

## 62.20 “QA owns quality.”

**Verdict:** `F`.

Quality is produced across requirements, architecture, code, data, security, operations and product decisions.

## 62.21 “AI benchmark score equals production quality.”

**Verdict:** `F` [ARIA01][AIMON01].

Benchmarks are scoped evidence; real systems include prompts, tools, retrieval, users and drift.

## 62.22 “LLM-as-judge removes human evaluation cost.”

**Verdict:** `F`.

Judge systems need calibration and can share correlated failure/bias.

## 62.23 “Human-in-the-loop makes an agent safe.”

**Verdict:** `F` [ACS01].

Human approval is one control; authorization, limits, audit and recovery remain.

## 62.24 “More eval cases always means stronger AI assurance.”

**Verdict:** `F`.

Representativeness, independence, failure coverage and oracle quality matter more than raw count.

## 62.25 “One successful recovery drill proves recoverability.”

**Verdict:** `F`.

Architecture/config/data change can stale evidence; periodic/event-triggered retest is needed.

## 62.26 “Never delete tests.”

**Verdict:** `F`.

Stale tests create noise/cost and can encode obsolete requirements.

---

# 63. V1 → falsification audit → V2 revision record

The V1 audit intentionally attempted to falsify twenty common testing/QA doctrines and concluded that the V1 architecture required material revision.

## 63.1 Major audit findings closed in V2

| Audit finding | V2 closure |
|---|---|
| assurance levels too coarse | §§6, 54–56 define evidence burden, independence and waivers |
| QE not operationalized | §9 lifecycle QE operating model |
| oracle design too late | §§3.7, 10.3, 36 make oracle strategy foundational |
| static verification underweighted | §13 |
| regression selection unsafe | §20 selection controls/reference runs |
| suite health incomplete | §43 test lifecycle/health/retirement |
| test-data/privacy weak | §§33, 37 |
| CI timing not distinguished | §41 multi-stage gates |
| chaos safety incomplete | §30 explicit hypothesis/abort/blast radius |
| recovery lacks reconciliation | §31 |
| security modes conflated | §32 requirements/automation/adversarial layers |
| AI stochastic treatment weak | §47 repeated trials/distributions |
| eval leakage absent | §§37.4, 47.5 |
| RAG/agent mechanisms conflated | §§48–49 |
| LLM judge undercontrolled | §50 |
| post-deploy AI triggers weak | §51 |
| formal model-to-implementation gap | §28.2–28.3 |
| accessibility conformance/usability conflated | §34 |
| metrics lack decision contracts | §45 |
| evidence not tied to artifact | §§52–53 |
| independence vague | §54 |
| test retirement absent | §43.2 |
| test harness not verified | §39 |
| exploratory testing absent | §19 |

## 63.2 Source-status corrections

V2 explicitly records:

- IEEE 730-2026 as the current active SQA process standard [SQA01];
- ISO/IEC/IEEE DIS 25000-70 as draft quality-engineering framework, not final [QE-DRAFT01];
- ISO/IEC 25059:2023 as current AI quality model with replacement FDIS pending [AIQUAL01][AIQUAL-DRAFT01];
- ISO/IEC 33063:2015 as current test-process assessment standard with replacement draft pending [PROCASS01][PROCASS-DRAFT01];
- NIST TEVV-Athlon as Initial Public Draft [TEVV-DRAFT01];
- OWASP WSTG 4.2 as stable while v5 remains development content [WSTG01].

---

# 64. Sanity / falsification verdict for V2

V2 was challenged against these failure cases.

## 64.1 Low-risk ordinary SaaS

**Test:** Does the standard force high-assurance ceremony?

**Result:** PASS. C0/C1 can use lightweight claim-driven verification without traceability matrices, formal methods or independent V&V unless context demands them.

## 64.2 Material customer/data workflow

**Test:** Does it force evidence beyond unit tests?

**Result:** PASS. C2 requires representative boundary/system/recovery/security evidence where material and ties it to the released artifact.

## 64.3 Distributed/concurrent system

**Test:** Does ordinary CI hide schedule/order risk?

**Result:** PASS. V2 explicitly routes concurrency/state claims to controlled schedule/model/stress/formal methods as appropriate.

## 64.4 Security-sensitive application

**Test:** Could one scanner or pentest create false confidence?

**Result:** PASS. V2 separates security requirements verification, automated evidence and adversarial assessment.

## 64.5 High-consequence recovery

**Test:** Could “service restored” hide corruption?

**Result:** PASS. Reconciliation is part of recovery acceptance.

## 64.6 Accessibility

**Test:** Could automation falsely establish complete conformance/usability?

**Result:** PASS. Automated/manual/AT/user evidence are separated.

## 64.7 AI/LLM system

**Test:** Could a single benchmark or LLM judge produce false certainty?

**Result:** PASS. V2 requires system-context evaluation, repeated trials where stochastic, holdout/contamination controls, judge calibration and post-deployment monitoring.

## 64.8 Agentic system

**Test:** Could prompt instructions substitute for authorization?

**Result:** PASS. Agent controls require external authorization, action limits, idempotency, audit, kill/recovery and adversarial tool-chain tests.

## 64.9 Safety/mission critical

**Test:** Could this playbook pretend to replace a domain certification regime?

**Result:** PASS. C4 explicitly defers to the governing specialist/domain standard and treats this document as a general assurance constitution.

## 64.10 Anti-bureaucracy test

**Test:** Does every possible control become mandatory?

**Result:** PASS. Method/traceability/independence depth is consequence-driven; every technique is contextual unless a scoped authority makes it mandatory.

### Verdict

**RESEARCH / ARCHITECTURE VERDICT: PASS WITH FIELD-VALIDATION REQUIREMENT.**

No material internal contradiction was found that requires another architecture rewrite. Remaining promotion to `VALIDATED` requires representative non-author use and field evidence under the governing Master Playbook Standard.

---

# 65. Standards watchlist and evergreen triggers

| Item | Status at 2026-09-27 | Action |
|---|---|---|
| IEEE 1012-2024 | current approved V&V baseline; P1012 revision project exists | monitor revision |
| IEEE 730-2026 | current active SQA process standard | baseline |
| ISO/IEC/IEEE 29119-1:2022 | current concepts/definitions | baseline |
| ISO/IEC/IEEE 29119-2:2021 | current test processes | baseline |
| ISO/IEC/IEEE 29119-3:2021 | current test documentation | baseline |
| ISO/IEC/IEEE 29119-4:2021 | current test techniques | baseline |
| ISO/IEC/IEEE 29119-5:2024 | current keyword-driven testing | contextual baseline |
| ISO/IEC/IEEE 29119-6:2021 | current agile testing | contextual baseline |
| ISO/IEC TR 29119-11:2020 | published AI testing guide; under review | monitor |
| ISO/IEC 20246:2017 | current work-product review standard | baseline |
| ISO/IEC 25010:2023 | current product-quality model | baseline |
| ISO/IEC 25040:2024 | current quality-evaluation framework | baseline |
| ISO/IEC 25023:2016 | current measurement standard; revision in development | monitor |
| ISO/IEC 25059:2023 | current AI quality model; FDIS replacement pending | monitor closely |
| ISO/IEC/IEEE DIS 25000-70 | draft quality-engineering framework | watch only |
| ISO/IEC 33063:2015 | current testing-process assessment; replacement draft pending | optional/process assessment |
| OWASP ASVS 5.0 | current stable application-security verification standard | baseline for app security |
| OWASP WSTG 4.2 | current stable release; v5 development content exists | stable baseline + watch |
| WCAG 2.2 / ISO/IEC 40500:2025 | current web accessibility baseline | baseline |
| NIST AI 200-3 ARIA | published 2026-09-18 | current AI evaluation guidance |
| NIST AI 800-4 | published 2026-03-06 | current deployed-AI monitoring guidance |
| NIST AI 200-2 TEVV-Athlon | Initial Public Draft; comment period open at cutoff | emerging only |
| OWASP Agent Control Standard | released 2026-09-01 | current emerging agent-control reference; monitor maturity |

---

# 66. One-page Golden Standard

If only one section is used:

1. Define intended behavior, users, environment and unacceptable failure.
2. Classify C0–C4 criticality before choosing assurance depth.
3. Express material requirements/risks as assurance claims.
4. Define a trustworthy oracle for each critical claim.
5. Select verification/validation methods from failure mechanisms, not ritual.
6. Prefer prevention/static enforcement when it removes a defect class reliably.
7. Use unit/domain tests for local semantics; integration tests for real boundary semantics; system/E2E for composition/user journeys.
8. Do not treat the test pyramid, coverage or mutation score as universal assurance laws.
9. Test error, negative, concurrency, partial-failure, recovery and adversarial paths where plausible.
10. Use property tests for meaningful invariants, fuzzing for malformed/untrusted input and formal methods for scoped high-consequence state/protocol properties where justified.
11. Make regression selection measurable and challenge it with deeper/reference runs.
12. Treat flaky tests and broken harnesses as defects in the assurance system.
13. Govern test data and environment semantics; production realism is not permission to leak sensitive data.
14. Separate security requirement verification from adversarial/pentest evidence.
15. Accessibility requires more than automated scanning; separate conformance and usability.
16. Performance evidence needs a workload model, distributions and overload behavior.
17. Recovery is proven by restore/failover plus data/state reconciliation.
18. Chaos is a bounded hypothesis-driven experiment, not random failure injection.
19. Tie evidence to the exact source/build/config/model artifact released.
20. Increase independent assurance with consequence and correlated-failure risk.
21. Use staged CI gates so fast deterministic evidence is early and deeper evidence runs at the right decision point.
22. Use bounded canaries/production verification when production context provides unique evidence.
23. AI evaluation is multi-method, statistical/contextual and system-level; one benchmark is not enough.
24. Control eval leakage/contamination and calibrate LLM judges against human/domain evidence when material.
25. Evaluate RAG retrieval/grounding and agent tool/authorization behavior separately enough to diagnose.
26. Re-evaluate AI systems when model, prompt, data, retrieval, tools, permissions or usage context changes materially.
27. A model can propose an action; external policy must authorize material agent actions.
28. Waivers are explicit risk decisions with owner, compensating control and expiry.
29. Metrics must inform decisions; test count/pass rate/coverage are never quality by themselves.
30. Feed escaped defects/incidents back into requirements, oracles, methods and architecture—not only one new regression test.

---

# 67. V2 source-status discipline

V2 distinguishes four evidence states:

**CURRENT FINAL** — may serve as present baseline where scope fits.

**CURRENT + REVISION PENDING** — current publication remains baseline; watch replacement.

**DRAFT / IPD / DIS / FDIS** — directional/emerging; do not represent as final normative requirement.

**OPERATIONAL / EMPIRICAL EVIDENCE** — useful for mechanisms and trade-offs; do not transform one organization's practice or one study into a universal mandate.

---

# 68. Governance and ownership

Every production assurance system SHOULD name:

- engineering/product owner for intended behavior;
- QE/testing owner or accountable capability owner where scale warrants;
- security/privacy owners where applicable;
- release/risk decision owner;
- monitoring/incident owner;
- evidence/standard owner for C3/C4 programs.

A QA team MUST NOT become the dumping ground for quality responsibility created elsewhere.

---

# 69. Review cadence

Review this playbook:

- on scheduled cadence based on volatility;
- when watched standards become final/superseded;
- after material escaped defects expose a method gap;
- after major changes in AI evaluation/agent control practice;
- when teams repeatedly bypass a gate;
- when evidence shows controls create more cost/noise than assurance value;
- when new system classes reveal missing failure modes.

Every review SHOULD end in `retain`, `refresh`, `partial update`, `full update`, `watch`, or `deprecate`.

---

# 70. Change log

## 2.0-GOLDEN-MASTER — 2026-09-27

- rebuilt V1 after explicit falsification audit;
- separated criticality from concrete assurance burden;
- moved oracle design into the core strategy;
- strengthened static verification and prevention;
- added safe regression-selection controls;
- added test-suite lifecycle/health/retirement;
- added test-harness assurance;
- expanded test data/privacy/environment fidelity;
- separated CI evidence timing into gate classes;
- strengthened resilience/chaos/recovery/reconciliation;
- separated security control verification from adversarial testing;
- separated accessibility conformance from usability;
- strengthened formal model→implementation linkage;
- added AI statistical/holdout/contamination/evaluator controls;
- added RAG and agent-specific overlays;
- added post-deployment AI re-evaluation triggers;
- tied evidence to released artifact/config/model versions;
- defined independence and waiver rules;
- updated 2026 standards status/watchlist.

---
# 71. Evidence map and annotated source register

> **Evidence-map rule:** inclusion does not imply equal authority. Formal standards establish scoped normative/process baselines; empirical studies inform effects and limitations; mature operator guidance demonstrates mechanisms in real systems; local evidence remains necessary for local assurance decisions.

## VV01 — IEEE 1012-2024 — System, Software, and Hardware Verification and Validation

**Source:** IEEE Standards Association  
**Status:** current approved standard at cutoff; P1012 revision project exists.  
**Evidence role:** `E1 — FORMAL_STANDARD`  
**Used for:** V&V as broader than test execution; analysis/review/inspection/assessment/testing; integrity/risk-proportional V&V.  
**Finding:** supports scaling V&V rigor according to integrity/consequence rather than uniform maximum process.  
**Limitation:** high-assurance standard; its full task set is not economically justified for ordinary low-risk software.  
**URL:** https://standards.ieee.org/ieee/1012/7324/

## SQA01 — IEEE 730-2026 — IEEE Standard for Software Quality Assurance Processes

**Source:** IEEE Standards Association  
**Status:** Active Standard; published 2026-08-21; supersedes IEEE 730-2014.  
**Evidence role:** `E1 — FORMAL_STANDARD`  
**Used for:** lifecycle software quality-assurance process, planning/control/execution, quality as a development/maintenance responsibility rather than a downstream test phase.  
**Limitation:** SQA process requirements do not determine one universal test architecture or product-specific acceptance threshold.  
**URL:** https://standards.ieee.org/ieee/730/10854/

## QE-DRAFT01 — ISO/IEC/IEEE DIS 25000-70 — SQuaRE Quality Engineering Framework

**Source:** ISO/IEC/IEEE  
**Status:** **Draft International Standard**; DIS registered 2026-09-03; under development.  
**Evidence role:** `E1-DRAFT — EMERGING_FORMAL_STANDARD`  
**Used for:** watch item; confirms emerging formal framing of quality engineering across lifecycle, processes, methods, measures, tools and responsibilities.  
**Limitation:** MUST NOT be represented as a final international standard until publication.  
**URL:** https://www.iso.org/standard/88835.html

## TESTSTD04 — ISO/IEC/IEEE 29119-4:2021 — Software Testing — Part 4: Test Techniques

**Source:** ISO/IEC/IEEE  
**Status:** published/current at cutoff.  
**Evidence role:** `E1 — INTERNATIONAL_TEST_STANDARD`  
**Used for:** systematic test-design technique families and terminology.  
**Limitation:** technique catalog does not imply every technique is required or one portfolio distribution is optimal. Adjacent current 29119 publications include Part 1:2022, Parts 2/3:2021, Part 5:2024 and Part 6:2021; TR 29119-11:2020 covers AI-system testing guidance and is under review.  
**URL:** https://www.iso.org/standard/79430.html

## REVIEWSTD01 — ISO/IEC 20246:2017 — Work Product Reviews

**Source:** ISO/IEC  
**Status:** published/current; confirmed in review cycle.  
**Evidence role:** `E1 — INTERNATIONAL_STANDARD`  
**Used for:** systematic review processes and review evidence.  
**Limitation:** review process standard; reviewer competence, independence and depth remain context/risk dependent.  
**URL:** https://www.iso.org/standard/67407.html

## QUAL01 — ISO/IEC 25010:2023 — Product Quality Model

**Source:** ISO/IEC JTC 1/SC 7  
**Status:** published/current.  
**Evidence role:** `E1 — INTERNATIONAL_STANDARD`  
**Used for:** quality characteristics as a requirements/evaluation reference model.  
**Finding:** quality is multidimensional and should not be collapsed into one universal score.  
**Limitation:** project priorities/thresholds remain contextual; this playbook adds operational/change-safety/assurance concerns around the model.  
**URL:** https://www.iso.org/standard/78176.html

## NASA01 — NASA Software Engineering Handbook — Classification and Safety-Critical Assessment

**Source:** NASA  
**Status:** current institutional high-assurance guidance.  
**Evidence role:** `E4 — GOVERNMENT_HIGH_ASSURANCE_GUIDANCE`  
**Used for:** criticality classification and scaling assurance obligations.  
**Limitation:** mission/safety context; use for proportionality principle, not as ordinary SaaS ceremony.  
**URL:** https://swehb.nasa.gov/spaces/7150/pages/16449773/7.02+-+Classification+and+Safety-Critical+Assessment

## SEC01 — NIST SP 800-218 — Secure Software Development Framework (SSDF) v1.1

**Source:** NIST  
**Status:** current final baseline at cutoff; Rev.1/SSDF 1.2 remains draft.  
**Evidence role:** `E4 — GOVERNMENT_SECURITY_FRAMEWORK`  
**Used for:** secure-development lifecycle, security verification integrated with engineering.  
**Limitation:** high-level framework; concrete assurance depends on application, threat model and risk.  
**URL:** https://csrc.nist.gov/pubs/sp/800/218/final

## ASVS01 — OWASP Application Security Verification Standard 5.0

**Source:** OWASP  
**Status:** current stable application-security verification standard at cutoff.  
**Evidence role:** `E4 — OPEN_CONSENSUS_SECURITY_STANDARD`  
**Used for:** concrete application-security verification requirements and assurance levels.  
**Limitation:** application-focused; not a full product safety/privacy/infra/threat-model certification.  
**URL:** https://owasp.org/www-project-application-security-verification-standard/

## WSTG01 — OWASP Web Security Testing Guide

**Source:** OWASP  
**Status:** stable release 4.2; version 5 development content exists at cutoff.  
**Evidence role:** `E4/E7 — OPEN_SECURITY_TESTING_GUIDANCE`  
**Used for:** web security test methodology/adversarial assessment.  
**Limitation:** a testing guide is not proof of complete security; v5 development material must not silently replace stable release.  
**URL:** https://owasp.org/www-project-web-security-testing-guide/

## FUZZ01 — NIST — Fuzz Testing for Software Assurance

**Source:** NIST  
**Evidence role:** `E4 — GOVERNMENT_SOFTWARE_ASSURANCE_GUIDANCE`  
**Used for:** fuzzing as invalid/unexpected/generated-input assurance method.  
**Finding:** fuzzing is effective for discovering robustness/security failures on suitable input surfaces.  
**Limitation:** crash-only fuzzing does not establish semantic correctness and does not replace specification/review/formal methods.  
**URL:** https://www.nist.gov/publications/fuzz-testing-software-assurance

## MUT01 — Petrović et al. — Long Term Effects of Mutation Testing

**Source:** Google Research  
**Evidence role:** `E3/E5 — INDUSTRIAL_EMPIRICAL_STUDY`  
**Used for:** mutation testing as a test-strength feedback mechanism.  
**Finding:** large-scale Google evidence linked mutation feedback to test improvements and found relationships between surviving mutants and historical faults.  
**Limitation:** Google tooling/scale are unusual; mutation score remains a proxy and cost/equivalent mutants matter.  
**URL:** https://research.google/pubs/long-term-effects-of-mutation-testing/

## COVER01 — Chekam et al. — Mutation, Statement and Branch Coverage Fault Revelation

**Source:** ICSE peer-reviewed research  
**Evidence role:** `E3 — EMPIRICAL_TESTING_STUDY`  
**Used for:** limits of statement/branch coverage as assurance proxies.  
**Finding:** adequacy measures differ in fault revelation; execution coverage is not correctness proof.  
**Limitation:** subject programs/methodology are scoped; no adequacy metric alone proves correctness.  
**URL:** https://doi.org/10.1109/ICSE.2017.61

## PBT01 — de Oliveira et al. — Property-based testing in Python: empirical insights (2026)

**Source:** Empirical Software Engineering  
**Evidence role:** `E3 — PEER_REVIEWED_EMPIRICAL_STUDY`  
**Used for:** real-world PBT patterns, generator/property challenges and boundary conditions.  
**Finding:** PBT is used for meaningful properties but realistic generators/properties are non-trivial; automated property generation remains limited.  
**Limitation:** Python/Hypothesis context; not causal proof of universal quality improvement.  
**URL:** https://link.springer.com/article/10.1007/s10664-026-10953-w

## FORMAL01 — Newcombe et al. — How Amazon Web Services Uses Formal Methods

**Source:** AWS/Amazon Science, peer-reviewed industrial experience  
**Evidence role:** `E3/E5 — INDUSTRIAL_FORMAL_METHODS`  
**Used for:** formal specification/model checking for difficult distributed-system state/protocol properties.  
**Finding:** formal methods can expose subtle design errors in real critical systems beyond safety-certification domains.  
**Limitation:** proves modeled properties under assumptions; requirement/model/implementation fidelity remain separate assurance problems.  
**URL:** https://www.amazon.science/publications/how-amazon-web-services-uses-formal-methods

## ORACLE01 — Barr et al. — The Oracle Problem in Software Testing: A Survey

**Source:** IEEE Transactions on Software Engineering  
**Evidence role:** `E2/E3 — PEER_REVIEWED_SURVEY`  
**Used for:** oracle problem, partial/pseudo-oracles, metamorphic/differential approaches.  
**Finding:** determining correct outcomes is a fundamental testing limitation; test execution without a credible oracle can be weak evidence.  
**Limitation:** method survey rather than universal implementation recipe; domain-specific oracles still require judgment.  
**URL:** https://doi.org/10.1109/TSE.2014.2372785

## FLAKE01 — Lam et al. — A Study on the Lifecycle of Flaky Tests

**Source:** Microsoft Research / ICSE 2020  
**Evidence role:** `E3/E5 — INDUSTRIAL_EMPIRICAL_STUDY`  
**Used for:** flakiness as misleading regression evidence, lifecycle/root-cause/fix challenges.  
**Finding:** large proprietary systems show persistent flaky-test behavior; asynchronous behavior is a major cause and claimed fixes may not actually fix flakiness.  
**Limitation:** Microsoft projects; exact prevalence and causes vary by stack.  
**URL:** https://www.microsoft.com/en-us/research/publication/a-study-on-the-lifecycle-of-flaky-tests/

## FLAKE02 — Google Testing Blog — Flaky Tests at Google and mitigation guidance

**Source:** Google Engineering  
**Evidence role:** `E5 — LARGE_SCALE_OPERATIONAL_EVIDENCE`  
**Used for:** effect of flaky tests on CI trust, release decisions and developer behavior.  
**Finding:** nondeterministic results create large investigation cost and can cause legitimate failures to be ignored.  
**Limitation:** Google-specific scale/tooling; use mechanism, not prevalence numbers as universal constants.  
**URL:** https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html

## TESTSEL01 — Yu & Wang — Regression Test Selection in Continuous Integration Environments

**Source:** IEEE ISSRE 2018 peer-reviewed study; complemented by Microsoft Azure Test Impact Analysis operational guidance.  
**Evidence role:** `E3/E6 — EMPIRICAL + PLATFORM_OPERATIONAL`  
**Used for:** economic motivation/trade-offs in regression-test selection and need for safe fallback/reference full runs.  
**Finding:** CI-scale regression selection can reduce feedback cost, but granularity/selection trade-offs matter; Microsoft's TIA uses safe fallback and periodic full runs.  
**Limitation:** techniques/tools are context-specific; selection false negatives must be measured locally.  
**URLs:** https://doi.org/10.1109/ISSRE.2018.00024 ; https://learn.microsoft.com/en-us/azure/devops/pipelines/test/test-impact-analysis

## CONC01 — Microsoft Coyote — Systematic Concurrency Testing

**Source:** Microsoft open-source engineering documentation / research lineage  
**Evidence role:** `E5/E6 — OPERATIONAL_TOOL_METHOD`  
**Used for:** controlled exploration and deterministic reproduction of concurrency schedules.  
**Finding:** systematic control of nondeterminism can find/reproduce concurrency bugs that repeated stress may miss.  
**Limitation:** supported runtimes/sources of nondeterminism are scoped; Coyote is not formal verification.  
**URL:** https://microsoft.github.io/coyote/concepts/concurrency-unit-testing/

## CANARY01 — Google SRE Workbook — Canarying Releases

**Source:** Google SRE  
**Evidence role:** `E5 — MATURE_OPERATIONAL_GUIDANCE`  
**Used for:** progressive production evidence with reduced blast radius.  
**Finding:** production canaries can detect defects that preproduction cannot reproduce when cohorts/signals are representative.  
**Limitation:** weak if traffic is unrepresentative, health signals lag or rollback is ineffective.  
**URL:** https://sre.google/workbook/canarying-releases/

## OVERLOAD01 — Google SRE — Addressing Cascading Failures

**Source:** Google SRE  
**Evidence role:** `E5 — MATURE_OPERATIONAL_GUIDANCE`  
**Used for:** overload, queues, retry amplification, load shedding and capacity failure testing.  
**Finding:** overload can create positive-feedback cascades; resilience requires bounded work and testing beyond happy throughput.  
**Limitation:** Google-scale service context; exact mechanisms should be adapted to workload semantics.  
**URL:** https://sre.google/sre-book/addressing-cascading-failures/

## CHAOS01 — AWS Prescriptive Guidance — Chaos Engineering on AWS

**Source:** AWS  
**Evidence role:** `E5/E6 — MATURE_VENDOR_OPERATIONAL_GUIDANCE`  
**Used for:** distinction between deterministic resilience testing and hypothesis-based chaos engineering.  
**Finding:** known failure modes should be validated reproducibly; chaos explores broader/end-to-end unknown failure interactions with explicit hypotheses.  
**Limitation:** AWS context; neither method is universally required for low-risk/simple systems.  
**URL:** https://docs.aws.amazon.com/prescriptive-guidance/latest/chaos-engineering-on-aws/overview.html

## CHAOS02 — AWS Well-Architected — Test Reliability / Chaos Engineering

**Source:** AWS Well-Architected Framework  
**Evidence role:** `E5/E6 — OPERATIONAL_GUIDANCE`  
**Used for:** repeated resiliency testing, game days, fault injection and validation of production resilience.  
**Limitation:** cloud-workload guidance; production experiments require local safety/blast-radius controls.  
**URL:** https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/test-reliability.html

## ACC01 — WCAG 2.2 / ISO/IEC 40500:2025

**Source:** W3C WAI / ISO  
**Status:** WCAG 2.2 W3C Recommendation; approved as ISO/IEC 40500:2025.  
**Evidence role:** `E1/E4 — INTERNATIONAL_WEB_ACCESSIBILITY_STANDARD`  
**Used for:** testable accessibility conformance baseline for web content.  
**Limitation:** not complete usability evidence and not the only possible platform/jurisdictional accessibility requirement.  
**URL:** https://www.w3.org/WAI/standards-guidelines/wcag/

## ACC02 — W3C WAI — Evaluating Web Accessibility Overview

**Source:** W3C WAI  
**Evidence role:** `E4 — AUTHORITATIVE_ACCESSIBILITY_GUIDANCE`  
**Used for:** automated vs manual evaluation limits and representative accessibility evaluation.  
**Finding:** evaluation tools assist but cannot automatically determine all accessibility requirements.  
**Limitation:** exact manual/AT/user-test depth remains audience/risk dependent.  
**URL:** https://www.w3.org/WAI/test-evaluate/

## ARIA01 — NIST AI 200-3 — ARIA Evaluation Planning Manual

**Source:** NIST Center for AI Standards and Innovation  
**Status:** published 2026-09-18.  
**Evidence role:** `E4 — CURRENT_GOVERNMENT_AI_EVALUATION_GUIDANCE`  
**Used for:** multi-method AI evaluation combining model testing, red teaming and user testing; evaluation planning tailored to evidence needs.  
**Limitation:** AI-specific, new publication; field implementation practice will continue to mature.  
**URL:** https://www.nist.gov/publications/aria-evaluation-planning-manual-elements-aria-style-ai-evaluations

## AIMON01 — NIST AI 800-4 — Challenges to the Monitoring of Deployed AI Systems

**Source:** NIST Center for AI Standards and Innovation  
**Status:** published 2026-03-06.  
**Evidence role:** `E4 — CURRENT_GOVERNMENT_AI_MONITORING_GUIDANCE`  
**Used for:** post-deployment monitoring, dynamic inputs, non-determinism and unforeseen outcomes.  
**Finding:** pre-deployment evaluation alone cannot reveal all deployed behavior; monitoring is a distinct continuing assurance layer.  
**Limitation:** monitoring itself does not guarantee safe behavior and can suffer observability/ground-truth limits.  
**URL:** https://www.nist.gov/publications/challenges-monitoring-deployed-ai-systems-center-ai-standards-and-innovation

## TEVV-DRAFT01 — NIST AI 200-2 — TEVV-Athlon Framework

**Source:** NIST  
**Status:** **Initial Public Draft** at cutoff; comment period open through 2026-10-06.  
**Evidence role:** `E4-DRAFT — EMERGING_AI_TEVV_FRAMEWORK`  
**Used for:** watch item/context-specific AI evaluation architecture.  
**Limitation:** MUST NOT be represented as final normative NIST guidance while draft.  
**URL:** https://www.nist.gov/artificial-intelligence/ai-research/tevv-athlon-framework-evaluating-ai-systems

## NISTAI01 — NIST AI 600-1 — Generative AI Profile

**Source:** NIST  
**Status:** published.  
**Evidence role:** `E4 — GOVERNMENT_AI_RISK_FRAMEWORK`  
**Used for:** GenAI TEVV, adversarial testing, human oversight, provenance and risk-based controls.  
**Limitation:** voluntary risk-management guidance; system-specific verification still required.  
**URL:** https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence

## AML01 — NIST AI 100-2e2025 — Adversarial Machine Learning Taxonomy and Terminology

**Source:** NIST  
**Evidence role:** `E4 — GOVERNMENT_AI_SECURITY_GUIDANCE`  
**Used for:** adversarial-ML threat/failure taxonomy and structured attack reasoning.  
**Limitation:** taxonomy/guidance does not itself prove mitigation effectiveness in a deployed system.  
**URL:** https://csrc.nist.gov/pubs/ai/100/2/e2025/final

## ACS01 — OWASP Agent Control Standard

**Source:** OWASP GenAI Security Project  
**Status:** released 2026-09-01; very new at cutoff.  
**Evidence role:** `E4 — OPEN_AGENT_CONTROL_STANDARD / EMERGING_OPERATIONAL_REFERENCE`  
**Used for:** agent inspectability, traceability, instrumentation and runtime policy/control hooks.  
**Limitation:** implementation maturity and empirical completeness are still evolving; not a standalone safety certification.  
**URL:** https://genai.owasp.org/resource/agent-control-standard-acs/

## AIQUAL01 — ISO/IEC 25059:2023 — Quality Model for AI Systems

**Source:** ISO/IEC JTC 1/SC 7  
**Status:** current published standard at cutoff.  
**Evidence role:** `E1 — INTERNATIONAL_AI_QUALITY_STANDARD`  
**Used for:** AI-system quality-model reference.  
**Limitation:** quality model does not prescribe one evaluation suite or threshold; replacement is already at final-draft stage.  
**URL:** https://www.iso.org/standard/80655.html

## AIQUAL-DRAFT01 — ISO/IEC FDIS 25059 — replacement of 25059:2023

**Source:** ISO/IEC  
**Status:** Final Draft International Standard / under development at cutoff.  
**Evidence role:** `E1-DRAFT — WATCH_ITEM`  
**Used for:** evergreen review trigger only.  
**Limitation:** current published baseline remains ISO/IEC 25059:2023 until replacement is published.  
**URL:** https://www.iso.org/standard/88234.html

## PROCASS01 — ISO/IEC 33063:2015 — Process Assessment Model for Software Testing

**Source:** ISO/IEC  
**Status:** current published standard at cutoff; replacement under development.  
**Evidence role:** `E1 — INTERNATIONAL_PROCESS_ASSESSMENT_STANDARD`  
**Used for:** optional assessment of testing-process capability/maturity, not product correctness.  
**Limitation:** process capability is not equivalent to delivered software quality.  
**URL:** https://www.iso.org/standard/55154.html

## PROCASS-DRAFT01 — ISO/IEC FDIS 33063 — Testing Process Assessment Model revision

**Source:** ISO/IEC  
**Status:** under development/final-draft stage at cutoff.  
**Evidence role:** `E1-DRAFT — WATCH_ITEM`  
**Used for:** evergreen review trigger.  
**Limitation:** MUST NOT replace the current published 2015 baseline until publication.  
**URL:** https://www.iso.org/standard/90135.html

---

# 72. Research-method note

This V2 was constructed as a structured evidence synthesis and standards audit rather than a formal systematic review.

The research sequence was:

1. inherit risk/evidence/traceability requirements from MPS-001 and SWE-00;
2. map current formal V&V, SQA, testing, quality, security, accessibility and AI evaluation standards;
3. add empirical/operational evidence where a formal standard does not establish practical effect;
4. draft V1;
5. run explicit falsification against common testing dogmas, high-risk failure modes and AI-era gaps;
6. search current replacement/draft status for volatile standards;
7. rewrite V2 around claim→oracle→evidence rather than test-level taxonomy;
8. mechanically audit evidence IDs, code fences and unresolved drafting markers;
9. preserve field validation as a remaining requirement instead of self-labeling the document `VALIDATED`.

---

# 73. Final status

**Status: `REVIEWED` — V2 Golden Master.**

It has passed the research, freshness, internal-consistency and falsification architecture review represented in this file. It SHOULD become `TESTED` only after representative teams apply it to materially different software contexts, and `VALIDATED` only after the governing Master Playbook Standard's non-author/field-use requirements are satisfied.
