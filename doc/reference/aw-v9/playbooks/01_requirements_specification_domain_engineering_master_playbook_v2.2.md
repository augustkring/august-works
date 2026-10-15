# 01 — Requirements, Specification & Domain Engineering — V2.2
## Evidence-weighted evergreen standard for turning intent, domain reality, constraints, uncertainty, and risk into verifiable engineering agreements

```yaml
document_id: SWE-01
title: Requirements, Specification & Domain Engineering
artifact_type: domain_capability_playbook
version: "2.2"
release_label: V2.2 Golden Master — Third-Pass Falsification & Freshness Audit
status: REVIEWED
created: 2026-09-27
last_updated: 2026-09-27
last_reviewed: 2026-09-27
evidence_cutoff: 2026-09-27
canonical_language: English
owner: Playbooks
research_rigor: R3 / CONTROLLED
operational_rigor: risk-proportionate
volatility: MODERATE
fast_volatility_overlays:
  - AI and agent requirements
  - interface specification versions
  - regulatory requirements
  - emerging formal standards
inherits:
  - 00 — Universal Software & AI Engineering Master Playbook V2.0
  - Master Playbook Standard v2.0-RC1
primary_archetypes:
  - Capability
  - Decision
  - Discovery
  - Execution
applies_to:
  - software systems
  - web/mobile/desktop applications
  - APIs and services
  - data-intensive systems
  - distributed systems
  - AI/ML/LLM systems
  - agentic systems
  - embedded/system software
  - software-enabled products
  - product lines/platform families
out_of_scope:
  - substituting for domain-specific safety certification
  - legal interpretation
  - prescribing one requirements document format
  - prescribing one development methodology
  - prescribing one modeling notation
  - prescribing one product-management framework
next_scheduled_review: 2027-03-27
review_triggers:
  - publication of ISO/IEC/IEEE 29148 Edition 3
  - publication of ISO/IEC 25059 Edition 2
  - material change to ISO/IEC/IEEE 12207
  - material change to AI/agent assurance standards
  - evidence that a core rule causes systematic execution failure
  - representative field-test findings
```

> **Status note.** This V2.2 is a third-pass research/falsification-audited Golden Master, not a field-validated universal truth. It was built from
> the inherited engineering/playbook standards, the full V1 working draft, two prior falsification passes, and a third
> standards-freshness + claim-by-claim audit. No honest engineering standard can guarantee literal “100% correctness”: standards change,
> empirical evidence is incomplete in several RE subfields, and fitness for use must be demonstrated in representative
> contexts. Under the governing Master Playbook Standard, `VALIDATED` status requires representative execution and closure
> of material defects discovered in use. Until that occurs, `REVIEWED` is the correct lifecycle status.

---

# Executive synthesis

Software is not correct because a ticket was implemented. It is correct only relative to an intended purpose,
environment, domain, set of constraints, quality expectations, prohibited outcomes, and evidence.

Requirements engineering therefore is not “writing requirements.” It is the continuing discipline of establishing,
challenging, communicating, and maintaining the agreements that make engineering decisions testable.

The durable chain in this playbook is:

```text
PURPOSE / OUTCOME
→ STAKEHOLDERS / AFFECTED PARTIES
→ ENVIRONMENT + DOMAIN REALITY
→ GOALS + CONSTRAINTS + RISKS
→ CANDIDATE NEEDS / REQUIREMENTS
→ ANALYSIS + NEGOTIATION
→ SPECIFICATION AT THE NEEDED PRECISION
→ ACCEPTANCE + VERIFICATION STRATEGY
→ TRACEABILITY + DECISION RECORD
→ IMPLEMENTATION / OPERATIONAL EVIDENCE
→ CHANGE + LEARNING
```

The central V2 doctrine is:

> **Specify the least amount of information, at the lightest level of formality, that is sufficient to make the
> consequential intent, boundary, quality, risk, and acceptance evidence unambiguous enough for the decision at hand;
> increase rigor when consequence, uncertainty, irreversibility, scale, regulatory exposure, or autonomy increases.**

A requirements artifact is therefore successful only if it improves at least one of the following:

- decision quality;
- shared understanding;
- correctness;
- risk control;
- acceptance clarity;
- verification;
- change impact;
- auditability;
- implementation safety;
- learning.

Document volume is not an outcome.

---

# V2 falsification verdict

V1's core direction survived, but the audit rejected several popular absolutes.

## Strongly retained

1. Requirements are lifecycle engineering assets, not a one-time phase.
2. Correctness begins with explicit intent, constraints, quality, assumptions, and acceptance.
3. Stakeholder communication and domain understanding are not replaced by documentation.
4. Material requirements must be observable or otherwise objectively verifiable.
5. Quality requirements belong in requirements work rather than being deferred to architecture/testing.
6. Requirement rationale, assumptions, change triggers, and verification strategy materially improve maintainability.
7. Traceability creates real value when it supports change, assurance, regulation, or impact analysis.
8. Requirements methods must be selected to fit the question and context.
9. AI can assist requirements work but does not own agreement, authorization, or truth.
10. Domain engineering matters when domain complexity or cross-product variability is consequential.

## Deliberately downgraded from “best practice” to contextual technique

- `shall` syntax;
- user stories;
- INVEST/QUS story heuristics;
- BDD/Gherkin;
- DDD;
- bounded contexts;
- goal models;
- SysML/UML;
- formal methods;
- full traceability;
- AHP/MoSCoW/WSJF-style prioritization;
- one canonical PRD/SRS format;
- one requirements-management tool.

## Second-pass deep audit additions

The second audit re-checked all 60 V1 candidate principles rather than only the original open questions. Material changes:

- **V&V semantics were corrected.** Requirement verification, requirement validation, system verification, and system
  validation are now treated as four distinct assurance questions rather than collapsed into two.
- **Requirements-quality characteristics remain review controls, not a universal quality score.** Systematic reviews show
  a fragmented evidence base, few replications, and small-scale validation for many proposed methods.
- **Stakeholder involvement is representative and decision-linked, not maximal.** More participation is not itself an
  outcome and empirical results on user-involvement/system-success are heterogeneous.
- **Domain understanding is universal; a formal domain model is not.** Dedicated modeling is required only when it reduces
  material ambiguity, coupling, change risk, or verification difficulty.
- **User stories are strengthened as boundary/coordination objects.** Their usefulness does not make them complete
  specifications, and written stories can decay without surrounding conversation/context.
- **BDD/Gherkin remains contextual.** The research base is broad but industrial outcome evidence and metrics are limited.
- **Prioritization algorithms remain decision aids.** Large-scale industrial validation is sparse and scalability is a
  known weakness of several methods.
- **AI-assisted elicitation remains candidate-generation technology.** A 2026 mapping study found automation depth falls
  sharply after identification and stakeholder validation is rarely engineered into the loop.
- **AI requirements explicitly extend into production monitoring.** Pre-deployment evaluation cannot establish all
  real-world behavior for non-deterministic, changing systems.

The complete second-pass audit is retained as `SWE-01-AUDIT-2`.

## Third-pass falsification additions

A third full pass re-checked V1/V2.1 against current standard status and newer 2025–2026 evidence. It produced six
material refinements rather than merely reaffirming the prior text:

- **Quality-in-use is now explicit.** ISO/IEC 25019:2023 separates quality-in-use from product quality and makes context of
  use a prerequisite. Product quality alone is not a complete statement of whether a system works acceptably in actual use.
- **IEEE 1012-2024 is added as the direct V&V process baseline.** It reinforces that V&V spans analysis, evaluation, review,
  inspection, assessment, and testing and scales tasks by integrity level; testing alone is not V&V.
- **Requirements-smell rules are evidence-weighted by impact.** Recent practitioner evidence identifies ambiguity and
  unverifiability as especially consequential, while a controlled Bayesian experiment found ambiguous pronouns materially
  more harmful than passive voice in its studied domain-modeling task. A lint rule is therefore a review signal, not an
  equal-severity defect taxonomy.
- **AI quality assessment remains triage, not semantic authority.** A 2026 SLR finds AI methods concentrated on detecting
  requirement issues, with incomplete criterion coverage and relatively little actionable improvement/real-world integration.
- **Vocabulary freshness is corrected.** ISO/IEC/IEEE 24765:2017 was confirmed again in 2026; the Edition 3 committee-draft
  project was cancelled on 20 September 2026. V2.2 therefore treats the 2017 vocabulary as current and does not imply an
  active successor.
- **Canonical truth means authoritative identity, not one physical file.** Controlled requirements may have synchronized or
  generated views across tools, provided authoritative ownership and drift detection remain unambiguous.

The complete third-pass assurance record is retained as `SWE-01-AUDIT-3`.

## Explicitly rejected as universal doctrine

- “complete requirements before design”;
- “every requirement must map to one test”;
- “requirements must always be solution-free”;
- “bounded context = microservice”;
- “one enterprise-wide ubiquitous language”;
- “a prototype is the specification”;
- “a schema/API file is the full requirement”;
- “an AI can autonomously elicit and approve requirements end-to-end”;
- “more formal notation automatically means better requirements”;
- “more traceability is always better”;
- “priority scores are objective truth.”

---

# 1. How to use this playbook

Use this playbook when a team needs to decide **what a system should do, under which conditions, how well, what it must
not do, why those constraints exist, and what evidence will establish success**.

It is designed for:

- greenfield products;
- major features;
- architecture-driving changes;
- integrations and APIs;
- migrations;
- regulated or high-assurance systems;
- AI/agent systems;
- long-lived platforms;
- product families;
- legacy-system evolution.

It is not a mandatory waterfall sequence. Activities may run concurrently and iteratively.

The playbook owns the requirements/domain-engineering layer. It hands off deeper implementation choices to specialist
playbooks for architecture, security, privacy, reliability, testing, data, APIs, AI, agents, and platform engineering.

---

# 2. Inherited non-negotiables from `00`

This specialist playbook MUST NOT silently weaken the root engineering standard.

The following root principles remain governing:

1. start from intended behavior, users, constraints, and unacceptable failure—not a preferred stack;
2. make material requirements and acceptance conditions observable enough to verify;
3. separate functional behavior from quality attributes and operational constraints;
4. make consequential assumptions visible;
5. classify criticality before selecting assurance depth;
6. increase rigor with consequence, exposure, irreversibility, uncertainty, blast radius, and autonomy;
7. protect important invariants structurally where practical;
8. make state, authority, ordering, trust boundaries, and ownership explicit;
9. define interface success, failure, timeout, compatibility, and evolution semantics where material;
10. treat security, privacy, reliability, operability, maintenance, and retirement as lifecycle responsibilities;
11. treat AI-generated engineering output as untrusted until independently validated;
12. use evidence that matches the claim;
13. encode boundary conditions when evidence is contextual;
14. prefer the least complex adequate system and the least burdensome adequate assurance process.

---

# 3. Evidence model

This playbook inherits the root evidence lanes.

| Lane | Source family | Strongest legitimate use |
|---|---|---|
| `E0` | law / regulation / contract | scoped mandatory obligations |
| `E1` | international/formal technical standard | normative terminology, process, quality, assurance baseline |
| `E2` | systematic review / meta-analysis | aggregate empirical state, heterogeneity, gaps |
| `E3` | peer-reviewed empirical study | observed effects in studied tasks/populations |
| `E4` | government / professional / open consensus framework | risk/control model, shared practice |
| `E5` | mature operational evidence | mechanisms demonstrated in production |
| `E6` | official platform/protocol/spec documentation | exact supported semantics/version behavior |
| `E7` | repeated practitioner pattern | useful hypothesis/pattern |
| `E8` | opinion/fashion/folklore | idea generation only |

## 3.1 Rule status

| Class | Meaning |
|---|---|
| `A` | durable near-universal engineering principle |
| `B` | strong contextual principle |
| `C` | control whose necessity rises with risk/criticality |
| `D` | useful heuristic/pattern |
| `E` | implementation/notation/tool choice |
| `F` | overgeneralization or anti-pattern claim |

A source's prestige does not determine rule strength. Claim fit does.

## 3.2 Research design used for V2

The V2 research pass was `R3 / CONTROLLED` and included:

- current official standards/version checks;
- systematic-review and mapping-study evidence;
- foundational requirements/domain-engineering literature where the mechanism remains durable;
- mature high-assurance engineering guidance;
- current AI/agent assurance sources;
- contradiction and limitation searches;
- explicit downgrade of weak universal claims;
- source-status watch items;
- a V1 → falsification → V2 change record.

The research is **not** represented as a formal systematic review of all requirements-engineering literature.

---

# 4. Canonical ontology — do not collapse these concepts

Category confusion is one of the largest sources of weak specifications.

## 4.1 Problem / opportunity

A real-world condition worth changing or understanding.

Example:

> Customers abandon checkout when final shipping cost appears too late.

A problem is not yet a requirement.

## 4.2 Outcome / goal

A desired state or result.

Example:

> Customers can understand total payable cost before committing to purchase.

A goal can be satisfied by multiple designs.

## 4.3 Stakeholder need / expectation

A need or expectation expressed by or derived for an affected party.

It can be incomplete, conflicting, infeasible, or solution-biased.

## 4.4 Requirement

A necessary capability, behavior, quality, constraint, or property that the system or its surrounding solution must
satisfy in the stated context.

A requirement is stronger than a suggestion. It should have a knowable reason and an acceptance/verification path when
material.

## 4.5 Constraint

A restriction on the solution space.

Sources can include:

- law;
- safety;
- contracts;
- interoperability;
- platform/environment;
- migration;
- budget/time;
- architecture decisions already accepted;
- procurement;
- organizational policy.

A constraint is not invalid merely because it is implementation-specific. What matters is whether it is **justified and
owned**.

## 4.6 Quality requirement

A required level of a product/system quality such as performance, reliability, security, maintainability, interaction
quality, compatibility, flexibility, or safety.

Avoid using “non-functional” as a dumping ground when the actual quality can be named.

## 4.7 Invariant

A property that must remain true across allowed states or transitions.

Example:

```text
order.status = SHIPPED
→ payment.status = AUTHORIZED
→ shipment_id exists
```

## 4.8 Negative requirement / prohibited outcome

Behavior or state that must not occur.

Example:

> A user without the required authorization MUST NOT read another tenant's invoice data.

Negative requirements are essential when unacceptable failure matters.

## 4.9 Assumption

A proposition treated as true for planning/design but not guaranteed.

Assumptions are not hidden facts. Material assumptions require evidence, an owner, and a trigger for re-evaluation.

## 4.10 Specification

A representation of agreed requirements, constraints, rules, or behavior at a chosen level of precision.

A specification may be distributed across:

- controlled natural language;
- tables;
- scenarios;
- examples;
- models;
- schemas;
- API contracts;
- state machines;
- formal properties;
- policy files;
- acceptance/evaluation definitions.

There is no universal requirement that “the specification” be one document.

## 4.11 Acceptance condition

A condition under which stakeholders/decision owners agree that the relevant outcome or behavior is acceptable.

## 4.12 Verification evidence

Evidence that a specified requirement/property was implemented or satisfied.

Verification can include:

- review;
- inspection;
- analysis;
- demonstration;
- testing;
- simulation;
- formal proof/model checking;
- runtime/production evidence.

## 4.13 Validation evidence

Evidence that the requirement/specification itself is appropriate for intended users, goals, and context.

## 4.14 Domain model

A representation of concepts, rules, relationships, behaviors, events, state, language, and constraints in the problem
domain.

It is not automatically the database schema.

## 4.15 Decision

A deliberate choice among alternatives.

A requirement should not be used to hide an architecture/product decision whose alternatives and trade-offs matter.

---

# 5. Requirements assurance depth

The root playbook's criticality model remains primary.

| Criticality | Typical RE posture |
|---|---|
| `C0 — Experimental` | lean intent, explicit non-production boundary, few high-value acceptance checks |
| `C1 — Ordinary` | structured product requirements, quality scan, acceptance criteria, assumptions, lightweight traceability |
| `C2 — Material` | controlled requirements, quality scenarios, explicit risks/constraints, change impact, deeper validation and verification planning |
| `C3 — High assurance` | independent challenge, strong traceability, formal baselines, evidence retention, stronger model/analysis where useful |
| `C4 — Safety/mission critical` | domain standard governs; independent V&V, hazard/safety requirements, audit-grade traceability and potentially formal methods |

## 5.1 Depth is not document length

Increase depth when one or more rise:

- consequence of wrong behavior;
- security/privacy exposure;
- irreversible state change;
- financial materiality;
- user vulnerability;
- legal/regulatory obligation;
- cross-team/system dependency;
- system lifetime;
- novelty;
- uncertainty;
- concurrency/distribution complexity;
- model autonomy;
- blast radius;
- difficulty detecting error after release.

A 100-page specification with weak assumptions and unverifiable language can be lower assurance than a 10-page
specification with explicit contracts, invariants, tests, and ownership.

---

# 6. Golden Requirements & Domain Engineering Standards

These are the V2.2 root rules for this specialist domain.

## 6.1 Intent and scope

1. **A — Start from purpose before artifact.** Define the problem/outcome before deciding PRD, backlog, SRS, story,
   schema, or model format.
2. **A — Define the system-of-interest and environment.** Requirements without a boundary create hidden responsibility.
3. **A — Define relevant users and affected stakeholders proportionately.** Direct users are not the only people who can create or bear
   consequences; representation should be sufficient for the decision/risk, not maximized as ceremony.
4. **A — Record unacceptable outcomes.** Correctness includes what must not happen.
5. **A — Distinguish need from proposed solution.** Preserve alternatives until a solution constraint is justified.
6. **B — Preserve legitimate constraints.** “Solution-free requirements” is not a universal law.
7. **A — State consequential assumptions.** Unrecorded assumptions become latent defects.
8. **C — Assign requirement rigor from criticality.** Do not apply high-assurance ceremony indiscriminately.

## 6.2 Domain understanding

9. **A — Understand domain terms before encoding them.**
10. **A — Make ambiguous terms operationally scoped.**
11. **B — Make consequential domain rules, states, events, exceptions, and invariants explicit; use a dedicated model when it materially improves shared understanding, analysis, change isolation, or verification.**
12. **B — Separate domain concepts from persistence/UI implementation.**
13. **B — Allow different meanings across legitimate contexts; map translations rather than forcing false global
    uniformity.**
14. **D — Use DDD when semantic/boundary complexity justifies it.**
15. **F — Do not equate a DDD bounded context with a microservice, team, repository, or database by default.**
16. **B — Use systematic commonality/variability analysis only when a product-family/reuse objective exists.**
17. **A — Domain experts are evidence sources, not infallible authorities; conflicting domain interpretations must be
    resolved or recorded.**

## 6.3 Elicitation

18. **A — Elicitation is evidence gathering, not transcription.**
19. **A — Select elicitation methods from the uncertainty and source type.**
20. **B — Triangulate when omission or bias would materially affect the decision.**
21. **A — Include non-person sources where relevant: law, contracts, existing systems, incidents, logs, analytics,
    tickets, documents, APIs, data, and competitor/market evidence.**
22. **B — Observe real work when reported process and actual process may diverge.**
23. **B — Use workshops when conflicts/shared language need resolution, not merely to collect opinions.**
24. **B — Use prototypes to reduce a named uncertainty; record what the prototype does not validate.**
25. **B — AI/data-mining can expand candidate discovery but does not replace negotiated stakeholder validation.**
26. **A — Preserve provenance of candidate requirements.**

## 6.4 Analysis and requirement formation

27. **A — Separate goals, requirements, constraints, assumptions, decisions, and evidence.**
28. **A — Remove contradictions or make them explicit before implementation.**
29. **A — Check feasibility before baselining consequential commitments.**
30. **A — Identify requirement dependencies and preconditions.**
31. **A — Make material edge/adverse conditions part of the requirement set.**
32. **A — Include quality requirements whenever quality can determine real-world success.**
33. **B — Prefer named quality requirements over an undifferentiated NFR bucket.**
34. **A — Record rationale for consequential requirements.**
35. **A — Do not use priority labels to hide unresolved conflict.**
36. **B — Use goal models when goals, alternatives, conflicts, and refinements are complex enough to benefit.**

## 6.5 Specification

37. **A — Use the least formal representation that is sufficiently precise.**
38. **A — Increase precision where ambiguity is expensive.**
39. **B — Controlled natural language is useful for baselined obligations, but one keyword convention is not universal.**
40. **A — Define ambiguous quantities and adjectives operationally.**
41. **B — Keep controlled requirements singular/coherent enough that obligation, scope, and verification are understandable; do not force arbitrary one-clause atomicity when the semantics cannot be separated safely.**
42. **A — Separate rationale from the normative obligation.**
43. **A — Include condition/context when behavior differs by state, actor, environment, or dependency.**
44. **A — Include units/tolerances/time windows when a threshold matters.**
45. **A — Define exceptions explicitly rather than relying on “as appropriate.”**
46. **B — Use decision tables for combinatorial policy/rules.**
47. **B — Use state machines for lifecycle/state transition correctness.**
48. **B — Use sequence/interaction models for ordering/handoff complexity.**
49. **B — Use schemas/contracts for machine-checkable interface/data structure.**
50. **C — Use formal specification/model checking when critical state/coordination properties justify the cost.**
51. **A — Formal syntax does not validate domain truth.**

## 6.6 User stories, examples, and acceptance

52. **D — User stories are useful boundary/coordination objects that can trigger conversation and adaptation; they are not a complete specification by default and their written meaning can degrade without maintained context.**
53. **D — Story-quality heuristics can detect weak stories; they do not cover every quality/interface/safety need.**
54. **B — Acceptance criteria should describe observable acceptance, not internal implementation steps unless the
    implementation itself is a required constraint.**
55. **D — Specification by example/BDD can be useful when concrete examples expose rule ambiguity; current research does not justify BDD/Gherkin as a universal default or proven industrial outcome optimizer.**
56. **F — Gherkin is not mandatory for executable acceptance.**
57. **A — Examples never replace general invariants when behavior spans more states than the examples.**
58. **A — Acceptance must include relevant failure/negative paths, not only happy-path output.**

## 6.7 Quality, operations, and lifecycle

59. **B — Use ISO/IEC 25010 product-quality and ISO/IEC 25019 quality-in-use characteristics as completeness lenses where relevant; do not treat either as an equal-weight score or a complete domain-specific requirement set.**
60. **A — Specify user-relevant performance as workload + percentile/distribution + condition, not “fast.”**
61. **A — Specify reliability from user/system outcome and consequence, not prestige uptime.**
62. **A — Specify security authorization at trusted boundaries when access matters.**
63. **A — Specify privacy purpose, access, retention, deletion, and propagation where personal/sensitive data exists.**
64. **A — Specify accessibility/interactions where humans use the system.**
65. **A — Specify capacity/overload/degraded behavior when load can make correctness unavailable.**
66. **A — Specify observability/diagnosability requirements for critical operational behaviors.**
67. **A — Specify recovery/data-loss objectives where failure recovery matters.**
68. **A — Specify compatibility/migration/deprecation when consumers or stored state will outlive one release.**
69. **A — Specify retirement/data disposition where lifecycle obligations remain after shutdown.**

## 6.8 Traceability and change

70. **A — Trace for a purpose, not for decoration.**
71. **C — Critical requirements should trace backward to authority/rationale and forward to implementation/control and
    verification evidence.**
72. **B — Traceability depth should rise with criticality, regulation, change cost, lifespan, and multi-team dependency.**
73. **A — Trace links are controlled information and can become stale.**
74. **A — Requirement change must trigger impact analysis proportional to consequence.**
75. **A — Update acceptance/verification evidence when meaning changes.**
76. **A — Preserve stable identifiers when downstream evidence depends on them.**
77. **A — Retire/supersede obsolete requirements so old truth does not remain executable.**

## 6.9 Prioritization and decisions

78. **A — Mandatory/legal/safety constraints are not preference scores.**
79. **A — Expose dependency and sequencing before ranking.**
80. **B — Evaluate value, consequence, learning value, urgency, cost, feasibility, reversibility, and opportunity cost as
    relevant.**
81. **F — Do not treat a weighted score as objective truth.**
82. **D — AHP/MoSCoW/WSJF-like methods are decision aids whose assumptions, evidence quality, sensitivity, and scaling limits must remain visible; current reviews do not establish one universal large-scale winner.**
83. **A — Name the decision owner for material trade-offs.**
84. **A — Record why a material requirement was deferred, narrowed, or rejected.**

## 6.10 AI and agents

85. **A — AI system requirements must acknowledge probabilistic and data-dependent behavior.**
86. **A — Specify intended task/use context separately from model benchmark capability.**
87. **A — Specify evaluation population/slices, pass thresholds, guardrails, and unacceptable failure where material.**
88. **A — Specify data provenance/quality/permissions when model behavior depends on data.**
89. **A — Specify human oversight/fallback when consequence requires it.**
90. **A — Specify post-deployment monitoring when behavior can drift or context changes.**
91. **A — Agent tool permissions and consequential action limits must be enforceable outside model persuasion.**
92. **A — Specify approval boundaries, budget/rate limits, idempotency, audit, stop/revoke, and recovery where agent
    side effects are material.**
93. **B — AI may draft, classify, extract, compare, and challenge candidate requirements; authorized humans/processes retain
    responsibility for source validation, negotiation, commitment, and residual-risk acceptance.**
94. **A — AI-generated requirements must preserve source provenance and uncertainty.**
95. **F — AI self-review is not strong independent assurance by itself.**

## 6.11 Measurement

96. **A — Do not measure RE success by requirement count, story count, or document pages.**
97. **B — Measure requirement defect escape, ambiguity/rework, decision latency, change impact, verification coverage,
    or outcome linkage where useful.**
98. **A — A metric must have a decision use and known gaming risk.**
99. **A — Local production evidence can invalidate an implementation hypothesis but not erase scoped legal/safety
    obligations.**
100. **A — Requirements work is complete only relative to a decision/risk boundary, never because uncertainty has
     disappeared.**

---

# 7. Requirements system model

A robust requirements system is a graph, not a document stack.

```text
AUTHORITY / EVIDENCE
        ↓
PROBLEM / OPPORTUNITY
        ↓
GOAL / OUTCOME
        ↓
DOMAIN FACTS + ASSUMPTIONS
        ↓
STAKEHOLDER NEEDS
        ↓
REQUIREMENTS / CONSTRAINTS / INVARIANTS
        ↓
SPECIFICATION FORMS
        ↓
ACCEPTANCE / VERIFICATION PLAN
        ↓
ARCHITECTURE / IMPLEMENTATION / CONTROL
        ↓
TEST / ANALYSIS / REVIEW / RUNTIME EVIDENCE
        ↓
OBSERVED OUTCOME
        ↓
CHANGE / LEARNING
```

Not every low-risk item needs every link stored in a tool. At higher rigor, material links SHOULD be reconstructable.

## 7.1 The minimum useful record

For a material requirement, be able to recover:

```yaml
id:
statement_or_property:
type:
scope_and_conditions:
rationale_or_source:
owner:
status:
criticality:
assumptions:
dependencies:
acceptance_or_verification:
change_trigger:
```

Add deeper fields only when they reduce a real risk.

---

# 8. Problem framing and system boundary

## 8.1 Problem framing questions

Before eliciting solution requirements, answer:

- What real-world problem/opportunity exists?
- For whom?
- What outcome should change?
- What evidence suggests the problem exists?
- What happens if nothing changes?
- What outcome would be unacceptable?
- What decisions are in scope now?
- What is explicitly out of scope?
- What constraints already bind the problem?
- What uncertainty is most likely to change the decision?

## 8.2 Boundary model

Define at least:

```yaml
system_of_interest:
users:
affected_stakeholders:
external_systems:
data_sources:
trust_boundaries:
operational_environment:
physical_environment_if_relevant:
human_procedures:
organizational_dependencies:
regulatory_jurisdictions:
ownership_boundaries:
out_of_scope:
```

A boundary is a responsibility statement. If a dependency is “outside scope” but system success depends on it, its
contract/failure assumptions still belong in the requirement model.

## 8.3 Context-of-use

For user-facing behavior, context includes:

- user capabilities;
- device/interface;
- network conditions;
- language/locale;
- accessibility needs;
- workload/time pressure;
- environmental conditions;
- frequency of use;
- safety/security sensitivity;
- support/training assumptions.

A requirement that only works for an imagined ideal user in an ideal environment is not fully specified.

---

# 9. Stakeholder engineering

## 9.1 Stakeholder classes

Consider:

- direct users;
- customers/buyers;
- administrators/operators;
- maintainers/support;
- business owners;
- domain experts;
- security/privacy/legal/compliance;
- data owners;
- partner/integration owners;
- downstream consumers;
- accessibility/safety stakeholders;
- people affected by decisions without using the interface;
- regulators/auditors where applicable.

## 9.2 Stakeholder role is not equal voting weight

Record:

```yaml
stakeholder_group:
interest_or_impact:
authority:
knowledge:
risk_if_missing:
representation_method:
decision_right:
conflicts:
```

Authority, expertise, lived impact, ownership, and regulatory mandate answer different questions.

## 9.3 Decision rights

For material conflicts distinguish:

- who provides evidence;
- who is affected;
- who recommends;
- who must agree/approve;
- who decides;
- who implements;
- who accepts residual risk.

Avoid “stakeholder consensus” as a substitute for governance.

## 9.4 Representation is risk-proportionate

Stakeholder involvement is not improved by maximizing participant count or meeting volume. Systematic review evidence on
user involvement and system success is heterogeneous, and stakeholder-identification methods themselves have coverage
limits. Select representation by decision impact, knowledge, authority, affected population, vulnerability, and consequence
of omission. For human-facing interactive systems, human-centred design provides a stronger lifecycle basis than assuming a
single product-owner proxy captures all user needs.

Practical rule:

```text
ENOUGH REPRESENTATION TO EXPOSE MATERIAL NEEDS / CONFLICT / HARM
+ CLEAR DECISION RIGHTS
+ TARGETED VALIDATION
≠ CONSENSUS BY EVERY STAKEHOLDER ON EVERY REQUIREMENT
```

---

# 10. Domain engineering

This playbook uses **domain engineering** in two related but distinct senses:

1. understanding/modeling a problem domain for one or more software systems; and
2. systematic product-line domain engineering for reusable assets/commonality/variability.

Do not silently import the second when only the first is needed.

## 10.1 Basic domain discovery

For a non-trivial domain, map as needed:

- core nouns/concepts;
- actors/roles;
- capabilities;
- decisions;
- business rules;
- policies;
- events;
- states;
- transitions;
- invariants;
- calculations;
- time/ordering semantics;
- exceptions;
- authorizations;
- data classifications;
- sources of truth;
- external dependencies;
- lifecycle/retention;
- common/variable behavior.

## 10.2 Domain language record

```yaml
term:
meaning:
semantic_scope:
owner_or_authority:
synonyms:
forbidden_or_deprecated_synonyms:
examples:
counterexamples:
translation_to_other_contexts:
```

“Same word, different meaning” is often legitimate across contexts. Make the translation explicit.

## 10.3 Domain model quality test

A useful domain model should help answer at least one real decision:

- What states are valid?
- What transition is allowed?
- Who has authority?
- What rule applies?
- Which concept owns this invariant?
- What causes this event?
- What can vary?
- Which terms conflict?
- What data is authoritative?
- What boundary contains the rule?

If it only produces aesthetically pleasing boxes, it is not earning its maintenance cost.

## 10.4 When to use DDD

DDD is a good candidate when several are true:

- business/domain rules are a major complexity source;
- terminology ambiguity causes recurring defects;
- subdomains have genuinely different models;
- domain experts can participate;
- the system is expected to evolve for years;
- architecture boundaries need stronger semantic grounding;
- a simple CRUD/data-schema model is insufficient.

DDD is probably excessive when:

- the application is mostly simple workflow/CRUD;
- the domain is stable and obvious;
- integration/platform complexity dominates business rules;
- the team cannot sustain the modeling discipline;
- the artifact is short-lived/experimental.

## 10.5 Bounded-context rule

A bounded context is a boundary within which a model/language has a coherent meaning.

Do **not** infer automatically:

```text
bounded context = microservice
bounded context = team
bounded context = repository
bounded context = database
```

Those can align when architecture/team trade-offs justify it, but alignment is a separate decision.

## 10.6 Product-line/domain engineering overlay

Use the ISO 26550/26551 product-line lens when:

- multiple related products are intentionally developed as a family;
- common assets will be reused systematically;
- variability is strategic rather than incidental;
- the organization can govern shared assets/versioning.

Model:

```yaml
product_line_scope:
common_features:
variable_features:
variation_points:
variants:
constraints_between_variants:
shared_quality_requirements:
product_specific_requirements:
reuse_assets:
economic_rationale:
governance:
```

Product-line engineering is not “we share a component library.” It is an explicit commonality/variability strategy.

---

## 10.6 Domain understanding vs. domain-model mandate

Every material domain MUST be understood well enough to make consequential terminology, rules, state, events, exceptions,
and invariants explicit. A dedicated domain model is **not** universally mandatory. The 2025 DDD review and broader
research on domain-oriented specification both show useful mechanisms alongside incomplete/inconsistent methods and limited
real-world evaluation. Escalate modeling when it changes a decision, exposes hidden semantics, reduces coupling, or provides
verification value.

# 11. Elicitation strategy

No elicitation technique is universally best.

## 11.1 Match method to uncertainty

| Need / uncertainty | Strong candidate methods |
|---|---|
| tacit domain knowledge | contextual interview, observation, apprenticeship/shadowing |
| conflict / shared language | workshop, facilitated modeling, decision session |
| current workflow | observation, process walk-through, logs/telemetry |
| authoritative rule | law/contract/standard/policy analysis |
| legacy behavior | code/data/API analysis, incident history, operator interview |
| interaction uncertainty | prototype/usability test |
| demand/behavior at scale | analytics, search/support data, experiments |
| rare adverse condition | incident review, threat/hazard analysis, tabletop scenario |
| future concept | prototype, scenario, experiment, expert elicitation |
| large text corpus | NLP/LLM-assisted candidate extraction + human validation |
| product family variability | domain analysis, feature/commonality analysis |

## 11.2 Triangulation

Triangulate when a single source is likely to be biased or incomplete.

Example:

```text
INTERVIEW CLAIM
+ OBSERVED WORKFLOW
+ SYSTEM LOG / INCIDENT DATA
+ POLICY / CONTRACT
→ stronger domain picture
```

Do not “average” conflicting evidence. Resolve the reason for disagreement.

## 11.3 Observation

Use observation when:

- workarounds are likely;
- users cannot easily articulate tacit steps;
- interruption/hand-off matters;
- actual process differs from documented process;
- safety/human factors matter.

Record workarounds rather than treating them automatically as noncompliance; they can indicate a defective system or
procedure.

## 11.4 Interviews

Interviews are strong for:

- goals;
- rationale;
- exceptions;
- terminology;
- tacit knowledge;
- pain points;
- constraints.

Weaknesses include:

- recall bias;
- social desirability;
- stakeholder blind spots;
- hypothetical behavior;
- interviewer framing.

Use prompts that ask for concrete recent cases, not only opinions.

## 11.5 Workshops

Use workshops for:

- conflict exposure;
- collaborative modeling;
- scope;
- rule clarification;
- cross-functional trade-offs;
- vocabulary;
- prioritization decisions.

Do not use a workshop when authority or conflict makes open participation unsafe/unproductive; use separate elicitation
first.

## 11.6 Existing artifacts

Potential sources:

- policies;
- contracts;
- existing requirements;
- support tickets;
- incident/postmortem records;
- audit findings;
- process documentation;
- API schemas;
- code/data models;
- telemetry;
- dashboards;
- customer feedback;
- training material;
- regulations;
- competitor behavior.

Existing artifacts are evidence of the current system, not automatic proof of desired behavior.

## 11.7 Data-driven and AI-assisted elicitation

AI/NLP may:

- cluster feedback;
- identify candidate requirements;
- classify quality themes;
- summarize interviews;
- detect duplicates;
- suggest edge cases;
- link related artifacts;
- flag ambiguous language.

The 2026 systematic mapping of automated requirements elicitation is encouraging but also a warning against automation
laundering: across 74 peer-reviewed studies, candidate identification is much more mature than downstream structuring,
consolidation, stakeholder validation, and industrial workflow integration. Treat benchmark accuracy as task evidence, not
proof that the resulting requirement set is correct or agreed.

It MUST NOT silently:

- invent authority;
- convert frequency into priority;
- treat sentiment as product strategy;
- resolve stakeholder conflict;
- approve legal/safety constraints;
- erase provenance;
- infer permission from text;
- claim completeness.

### Automated quality assessment

AI/NLP tools MAY triage candidate ambiguity, incompleteness, duplication, classification, and other requirement-quality
signals. A 2026 systematic review finds that current methods concentrate on issue detection, cover quality criteria
unevenly, and relatively few provide actionable improvements or mature real-world integration [REAIQA01]. Therefore:

- automated quality assessment is pre-review evidence, not requirement validation;
- a model-generated rewrite MUST be re-checked against source intent and authority;
- confidence/benchmark scores MUST NOT be treated as semantic correctness;
- high-consequence requirements require independent evidence proportional to risk.

---

# 12. Analysis and synthesis

Elicitation produces **candidate evidence**, not automatically approved requirements.

## 12.1 Analysis pipeline

```text
RAW EVIDENCE
→ NORMALIZE TERMS
→ CLASSIFY
→ DEDUPLICATE
→ IDENTIFY GAPS
→ IDENTIFY CONFLICTS
→ CHECK FEASIBILITY
→ IDENTIFY ASSUMPTIONS
→ MAP DEPENDENCIES
→ DEFINE QUALITY / FAILURE
→ NEGOTIATE
→ DECIDE
→ SPECIFY
```

## 12.2 Candidate classification

Classify candidate items as:

- problem evidence;
- goal/outcome;
- user/stakeholder need;
- domain fact;
- assumption;
- constraint;
- functional behavior;
- quality requirement;
- security/privacy/safety requirement;
- interface contract;
- data/state requirement;
- operational requirement;
- lifecycle requirement;
- architecture/design decision;
- experiment/hypothesis;
- open question.

Misclassification is a defect. A design choice hidden as a “requirement” prevents proper trade-off analysis.

## 12.3 Conflict types

Look for:

- stakeholder vs stakeholder;
- goal vs goal;
- requirement vs requirement;
- requirement vs constraint;
- quality vs quality;
- local optimum vs system outcome;
- privacy vs analytics;
- reliability vs cost;
- speed vs assurance;
- usability vs security friction;
- consistency vs availability;
- interoperability vs autonomy;
- current need vs migration compatibility.

Resolve with explicit decision rights, evidence, trade-offs, and rationale.

## 12.4 Assumption challenge

For every material assumption ask:

1. What evidence supports it?
2. What changes if false?
3. Can we test it now?
4. Can the system enforce or monitor it?
5. Who owns it?
6. When does it expire?
7. Which requirements/architecture decisions depend on it?

---

# 13. Requirements taxonomy

Use this as a completeness map, not a mandatory document hierarchy.

## 13.1 Outcome and stakeholder requirements

Describe intended real-world result and affected stakeholder needs.

## 13.2 Functional / behavioral requirements

Describe what the system must do.

Include:

- trigger;
- actor/system;
- precondition;
- behavior;
- output/state change;
- failure/negative behavior;
- relevant timing/order.

## 13.3 Quality requirements

Name the quality explicitly.

Current ISO/IEC 25010:2023 provides nine product-quality characteristics as a reference model. Use them to prompt
completeness, not as equal-weight mandatory targets.

## 13.4 Data/state requirements

Cover as relevant:

- source of truth;
- identity/uniqueness;
- schema/shape;
- invariants;
- consistency;
- concurrency;
- retention;
- lineage;
- classification;
- residency;
- deletion;
- backup/recovery;
- audit history.

## 13.5 Interface / integration requirements

Cover as relevant:

- protocol/schema;
- authentication/authorization;
- success response;
- error semantics;
- timeout/deadline;
- cancellation;
- idempotency;
- ordering;
- consistency/freshness;
- rate/capacity;
- versioning;
- compatibility;
- deprecation.

## 13.6 Security requirements

Derive from threat model and asset exposure, not generic checklists alone.

Include:

- principal/resource/action;
- trust boundaries;
- least privilege;
- security event/audit;
- secret/key expectations;
- abuse/resource limits;
- secure failure.

## 13.7 Privacy requirements

Include:

- purpose;
- data categories;
- collection/minimization;
- lawful/policy basis where applicable;
- access;
- sharing;
- retention;
- deletion;
- user rights/process;
- telemetry/model exposure.

## 13.8 Reliability/resilience requirements

Include where material:

- user-relevant SLI/SLO;
- dependency failure behavior;
- overload/degradation;
- recovery objective;
- RTO/RPO;
- retry/idempotency semantics;
- failover;
- data integrity priority.

## 13.9 Performance/capacity requirements

Specify workload context:

```yaml
operation:
workload:
concurrency:
payload_or_dataset:
environment:
latency_distribution_or_percentile:
throughput:
resource_limit:
overload_behavior:
measurement_method:
```

## 13.10 Accessibility/interaction requirements

Use applicable accessibility standards and real user needs.

Include:

- keyboard/non-pointer operation;
- focus;
- semantics;
- contrast;
- reflow/zoom;
- target/input characteristics;
- errors/recovery;
- assistive technology;
- cognitive/language needs where material.

## 13.11 Operability/observability requirements

Specify:

- health/readiness;
- telemetry necessary for critical questions;
- audit events;
- alert conditions;
- repair/admin controls;
- runbook/support expectations;
- correlation to release/config versions.

## 13.12 Lifecycle requirements

Include:

- installation/provisioning;
- migration;
- backward compatibility;
- upgrade;
- data conversion;
- support horizon;
- deprecation;
- export;
- retirement;
- evidence retention.

## 13.13 Regulatory/contractual requirements

Every externally mandatory item SHOULD record:

```yaml
authority:
citation_or_clause:
jurisdiction_or_scope:
applicability:
effective_date:
required_behavior_or_control:
evidence_required:
owner:
review_trigger:
```

Do not copy a regulation into a backlog and call the mapping complete.

---

# 14. Quality requirements engineering

## 14.1 Quality is contextual

Do not write:

> The system shall be secure, scalable, reliable, and user friendly.

Instead define relevant quality scenarios and thresholds.

## 14.2 Quality scenario structure

```yaml
quality:
stakeholder_or_source:
stimulus:
environment:
system_or_artifact:
expected_response:
measure:
target_or_threshold:
guardrail:
verification:
```

## 14.3 Example — performance

Weak:

> Search must be fast.

Stronger:

> Under the agreed production workload profile, the search API SHOULD return successful requests within the target
> p95 latency and MUST remain below the declared timeout/error threshold while the supported dataset and concurrency
> assumptions hold.

The actual numerical threshold belongs to the project context; do not invent one universally.

## 14.4 Example — reliability

Weak:

> The platform must be highly available.

Stronger structure:

```yaml
user_journey: submit_order
indicator: successful durable order acceptance
measurement_window: project-defined
target: consequence-derived
excluded_conditions: explicitly defined
data_integrity_guardrail: no accepted order may be silently lost
```

## 14.5 Example — security

Weak:

> Only admins can access reports.

Stronger:

> A principal MUST be authorized for the requested report resource and action at a trusted server-side boundary before
> report data is returned; client-side visibility MUST NOT grant authority.

## 14.6 Completeness scan

Use product-quality and quality-in-use models as **lenses**, not as a universal scoring formula [QUAL01][QUAL03]. For a
material system, ask whether failure can arise from:

- functional suitability;
- performance;
- compatibility;
- interaction quality;
- reliability;
- security;
- maintainability;
- flexibility;
- safety;
- data/state integrity;
- operability;
- privacy;
- deployment/change safety;
- supply-chain constraints;
- cost/resource limits.

Not all become requirements. They become requirements when neglect can make the intended outcome unacceptable.

## 14.7 Quality-in-use and context of use

ISO/IEC 25019:2023 defines quality-in-use separately from product quality and explicitly treats **context of use as a
prerequisite** [QUAL03]. Requirements SHOULD therefore identify material context conditions when system value or harm
depends on them, for example:

- user groups/capabilities and accessibility needs;
- tasks/goals and frequency of use;
- physical/social/organizational environment;
- device/network/locale conditions;
- workload, time pressure, training, and support assumptions;
- downstream consequences to affected stakeholders.

A product can satisfy an internal product-quality target and still fail in use because the assumed context is wrong.
Conversely, a context-specific quality-in-use result does not establish universal fitness across other populations or
environments.

## 14.8 Requirements-quality assurance is multi-dimensional

Clarity, completeness, consistency, correctness, feasibility, necessity, singularity/coherence, and verifiability are useful
review dimensions, but the empirical requirements-quality literature does not justify collapsing them into one universal
numeric score. Systematic reviews report many definitions, limited replication, and small-scale evaluation for several
proposed quality-requirements methods.

Therefore [REQUAL01][REQUAL02][SMELL02][SMELL03]:

- lint/smell checks MAY flag candidates for review;
- smell categories MUST NOT be assumed to have equal downstream impact;
- ambiguity/unverifiability deserve particular attention, but severity remains context-dependent;
- passive voice is not prohibited merely because a style guide flags it; the actual missing/ambiguous semantic information is what matters;
- a high “quality score” MUST NOT be represented as semantic correctness;
- set-level quality matters as well as statement-level quality;
- a requirement can be beautifully written and still express the wrong need;
- a correct need can still be specified in a way that is impossible to verify reliably.

---

# 15. Specification forms — choose by information need

No representation is universally best.

| Representation | Strong fit | Weak fit / failure mode |
|---|---|---|
| controlled natural language | obligations, policy, broad accessibility | combinatorial/state-heavy logic |
| user story | conversation, outcome slice, agile planning | full behavior/quality contract |
| scenario/use case | interaction flow, exceptions | global invariants, numeric quality |
| example table | rule examples, boundaries | proving completeness |
| decision table | combinatorial policy | rich temporal/state behavior |
| state machine | states/transitions/guards | broad goals/rationale |
| sequence model | interactions/order | domain policy by itself |
| data schema | structure/constraints | business semantics/intent |
| OpenAPI/interface spec | machine-readable interface contract | full product need/rationale |
| JSON Schema | data validation/shape | temporal/workflow semantics |
| SysML/UML | multi-view model when competence/tooling fit | lightweight work without model value |
| goal model | alternatives/conflicts/refinement | straightforward known behavior |
| mathematical/formal spec | critical invariants/protocol/state | stakeholder-accessible discovery unless paired with other forms |
| prototype | interaction/feasibility learning | authoritative specification unless explicitly baselined |

## 15.1 Dual representation is often correct

A high-value behavior may need:

```text
HUMAN / DOMAIN SEMANTICS
+ MACHINE-READABLE CONTRACT
+ ACCEPTANCE / VERIFICATION EVIDENCE
```

Example: an API can have OpenAPI for structure, policy text for authorization/idempotency/deprecation semantics, and
contract tests for evidence.

---

# 16. Controlled natural-language requirements

Use this section when requirements are baselined as controlled statements.

## 16.1 Minimum quality

A requirement SHOULD be:

- necessary;
- correct enough for current evidence;
- clear;
- unambiguous enough for consequence;
- singular/atomic enough to reason about;
- feasible;
- consistent;
- verifiable;
- traceable where required;
- scoped;
- maintainable.

## 16.2 Preferred structure

```text
[Subject]
[obligation keyword if controlled syntax is used]
[behavior/property]
[condition/context]
[measurable bound/tolerance if material]
[exception if material]
```

Example:

> When a valid order is accepted, the order service MUST persist a unique order identifier before returning a successful
> acceptance response.

## 16.3 Ambiguity blacklist

Words that require operational definition when consequential:

- fast;
- easy;
- seamless;
- intuitive;
- scalable;
- secure;
- robust;
- flexible;
- real-time;
- soon;
- normally;
- appropriate;
- sufficient;
- high performance;
- best effort;
- etc.;
- as needed;
- where possible.

The words are not banned; undefined use is the defect. Requirements-smell checks are triage, not truth: empirical
impact differs materially by smell and context [SMELL02][SMELL03]. In particular, do not ban passive voice mechanically
when the actor/obligation is already unambiguous.

## 16.4 “Shall”, “must”, “should”, “may”

For controlled internal specifications, choose one convention and document it.

This playbook's normative language follows:

- `MUST / MUST NOT` — mandatory inside this house playbook;
- `SHOULD / SHOULD NOT` — strong default with contextual deviation allowed;
- `MAY` — optional;
- `JUDGMENT REQUIRED` — intentionally non-deterministic.

Do not claim one English keyword is scientifically superior for all requirements artifacts.

## 16.5 Rationale

Store rationale separately when possible:

```yaml
requirement: ...
rationale: ...
source: ...
assumptions: ...
alternatives_rejected: ...
```

Rationale often changes slower than implementation and makes future requirement deletion/refinement safer.

---

# 17. User stories, acceptance criteria, and specification by example

## 17.1 User story role

A user story can be:

- a planning item;
- a reminder for conversation;
- a thin outcome slice;
- an index into deeper acceptance/domain material.

It is not automatically a complete requirement.

## 17.2 Story quality prompts

Useful checks:

- actor/beneficiary is meaningful;
- outcome/value is knowable;
- scope is coherent;
- dependencies are visible;
- acceptance can be observed;
- quality/constraints are linked;
- wording is not merely a technical task.

Bad:

> As a developer, I want Redis so the app is fast.

Better problem statement:

> Repeated reads of the product summary exceed the agreed latency target under the supported workload.

The cache may be one implementation option.

## 17.3 Acceptance criteria

Criteria should answer:

- what observable behavior matters?;
- under which condition?;
- with what valid/invalid input?;
- what state/result must follow?;
- what must not happen?;
- which threshold matters?;
- what evidence will be collected?

Avoid criteria that only restate internal implementation unless the implementation is itself a constraint.

## 17.4 Specification by example

Use examples to expose:

- boundary values;
- rule combinations;
- conflict;
- rounding;
- state transitions;
- permission distinctions;
- error behavior.

Then ask:

> What general rule do these examples imply, and what input/state space remains uncovered?

## 17.5 BDD/Gherkin

Use Gherkin when:

- product/domain participants can read it;
- automation/tooling creates real leverage;
- scenario-shaped behavior dominates;
- maintenance cost is acceptable.

Do not use it for everything. Numeric quality, invariants, privacy, reliability, formal state, and AI evaluation often need
other representations.

**Evidence boundary.** The 2026 user-story review characterizes stories as boundary objects across knowledge boundaries but
also reports limited theory and degradation of written stories over time. The 2023 BDD mapping identified 166 papers yet
found scarce industry insight and a shortage of process/artifact metrics. These support contextual use, not universal
prescription.

---

# 18. State, time, ordering, and concurrency requirements

Many requirements defects appear only when multiple states/actors exist.

## 18.1 State model

Define:

```yaml
entity_or_process:
states:
initial_state:
terminal_states:
transitions:
guards:
authorized_actors:
side_effects:
invalid_transitions:
recovery_transitions:
```

## 18.2 Time

Distinguish:

- event time;
- processing time;
- wall-clock time;
- monotonic duration;
- deadline;
- timeout;
- retention period;
- effective date;
- scheduled date;
- timezone/locale.

“Within 5 minutes” is ambiguous until start event, clock, and completion condition are defined.

## 18.3 Ordering

For distributed/async systems specify:

- per-key order?;
- partition order?;
- causal order?;
- transaction/serialization order?;
- user-visible order?;
- duplicate tolerance?;
- out-of-order behavior?;
- replay behavior?

Do not derive business correctness from timestamps unless the ordering guarantee actually supports it.

## 18.4 Concurrency

Specify conflicts:

- optimistic version check;
- lock/lease;
- single writer;
- merge;
- last-write-wins;
- domain-specific conflict resolution;
- rejection/retry.

If conflict resolution changes business truth, it is a requirement/domain decision, not a low-level implementation detail.

---

# 19. Interfaces and specification-as-code

## 19.1 Interface contract layers

A mature interface contract may include:

```text
STRUCTURE / SCHEMA
+ SEMANTIC MEANING
+ AUTHORIZATION
+ ERROR MODEL
+ TIMEOUT / CANCELLATION
+ IDEMPOTENCY
+ ORDER / CONSISTENCY
+ CAPACITY / RATE
+ COMPATIBILITY
+ DEPRECATION
```

## 19.2 OpenAPI / JSON Schema

Machine-readable schemas are valuable when they enable:

- validation;
- documentation;
- generated clients;
- contract tests;
- compatibility analysis;
- tooling.

They are incomplete when the real requirement depends on:

- business rationale;
- trust/authorization;
- non-local state;
- temporal behavior;
- operational policy;
- failure recovery;
- user outcome.

## 19.3 Contract source of truth

Choose a canonical contract workflow deliberately:

```text
design-first
code-first
schema-first
hybrid
```

The rule is not which direction is universally best. The rule is that drift must be detectable and one artifact/version
must be authoritative for each contract property.

---

# 20. Model-based and formal specification

## 20.1 Escalation triggers

Consider stronger modeling/formalization when:

- state space is large;
- concurrency/interleavings are material;
- safety/security invariants have high consequence;
- timing/order is critical;
- requirements interact non-locally;
- prose disputes recur;
- certification/assurance expects it;
- exhaustive reasoning over an abstract model has high value.

## 20.2 Model choices

Possible forms include:

- state machines;
- sequence diagrams;
- activity/process models;
- data/domain models;
- goal models;
- SysML/UML;
- temporal logic;
- TLA+/PlusCal-like specifications;
- Alloy-like relational models;
- theorem/proof systems.

This playbook does not choose one.

## 20.3 Formal-method boundary

Formal verification can establish:

> A scoped property holds for the modeled system under stated assumptions.

It does not automatically establish:

- the requirement is desirable;
- the model matches production;
- assumptions hold;
- unmodeled properties are correct;
- users will accept the system.

Pair formal verification with validation of the specification and model-to-implementation evidence.

## 20.4 Evidence boundary

A 2026 systematic review of 109 model-based requirements-engineering studies confirms substantial activity across UML,
SysML, transformation, analysis, and assurance, but also substantial variation in methods, domains, and practical maturity.
The existence of a popular notation does not establish that it is the best representation for a given requirement set.

---

# 21. Prioritization, scoping, and negotiation

Prioritization is a decision under constraints, not a sorting ritual.

## 21.1 First separate gates from preferences

### Mandatory gates

Examples:

- legal requirement;
- safety constraint;
- security control;
- contractual compatibility;
- critical migration prerequisite.

These are handled by applicability/risk governance, not a popularity score.

### Trade-off candidates

Evaluate as relevant:

- user/business outcome;
- consequence if absent;
- strategic fit;
- risk reduction;
- learning value;
- time criticality;
- dependency/unblocking;
- effort/cost;
- reversibility;
- uncertainty;
- operational burden;
- option value.

## 21.2 Dependency before rank

A “lower priority” prerequisite can need earlier implementation.

Create:

```yaml
requirement:
depends_on:
blocks:
must_precede:
can_parallelize:
migration_order:
```

## 21.3 Scoring methods

AHP, MoSCoW, WSJF-like ratios, weighted scoring, pairwise comparison, and voting can all be useful.

They MUST NOT hide:

- uncertain inputs;
- conflicting stakeholders;
- non-linear dependencies;
- hard constraints;
- correlation/double counting;
- sensitivity to weights;
- scalability limitations.

## 21.4 Evidence boundary

Requirements-prioritization reviews identify many techniques but comparatively weak large-scale industrial validation.
The 2025 scalability review found only a small fraction of included studies addressing large-scale functional requirements,
with many evaluations based on simulated or imaginary projects. Do not present a method's mathematical precision as
measurement precision when values, weights, costs, or dependencies are uncertain.

## 21.5 Decision record

```yaml
decision:
owner:
date:
options:
mandatory_constraints:
criteria:
evidence:
uncertainties:
dependencies:
tradeoffs:
selected_scope_or_order:
rationale:
revisit_trigger:
```

---

# 22. Traceability and change management

## 22.1 Traceability purpose

Good traceability answers a question.

Examples:

- Why does this requirement exist?
- What breaks if it changes?
- Which control implements this obligation?
- Which tests/evidence verify it?
- Which customer/contract/regulation depends on it?
- Which release contains it?
- Which requirements are unverified?

Do not trace artifacts “because traceability is good.”

## 22.2 Recommended trace relationships

For critical material:

```text
AUTHORITY / NEED
↔ REQUIREMENT
↔ DESIGN / CONTROL / IMPLEMENTATION
↔ VERIFICATION EVIDENCE
↔ RELEASE / OBSERVATION
```

Optional links:

- requirement ↔ assumption;
- requirement ↔ risk;
- requirement ↔ decision;
- requirement ↔ domain rule;
- requirement ↔ incident/defect;
- requirement ↔ migration;
- requirement ↔ metric.

## 22.3 Depth decision

Increase depth with:

- C2–C4 criticality;
- regulation;
- safety/security/privacy;
- long lifecycle;
- expensive change;
- multiple vendors/teams;
- product line reuse;
- complex dependencies;
- audit/assurance needs.

Use leaner links for low-risk, disposable work.

## 22.4 Link quality

A trace link should have:

```yaml
from:
to:
relationship:
purpose:
confidence:
owner:
last_verified:
```

A link generated by similarity/AI without semantic confirmation should retain confidence/provenance.

## 22.5 Change impact

When a material requirement changes, review:

- upstream goal/authority;
- dependent requirements;
- domain model;
- architecture;
- data/schema;
- interface contracts;
- tests/evals;
- security/privacy model;
- operations/runbooks;
- migration;
- training/support;
- documentation;
- monitoring;
- downstream consumers.

## 22.6 Baselines

Baseline when coordinated agreement or assurance requires a stable reference.

Do not freeze uncertainty merely to say the baseline is complete.

Use states such as:

```text
CANDIDATE → ANALYZED → AGREED → BASELINED → IMPLEMENTED → VERIFIED
                               ↘ SUPERSEDED / REJECTED
```

---

# 23. Four assurance questions — requirements verification, requirements validation, system verification, system validation

Requirements work becomes ambiguous when “verification” and “validation” are used as if there were only one pair of
questions. V2.2 separates four lifecycle assurance questions. This is consistent with current INCOSE Requirements Working
Group guidance. IEEE 1012-2024 provides the complementary formal V&V process baseline: V&V can include analysis, evaluation,
review, inspection, assessment, and testing, and the required tasks scale by integrity level [VV01]. This also preserves the
broader 00 distinction between building specified properties correctly and validating fitness for intended use.

## 23.1 Requirement verification — is the requirement expression fit for controlled use?

Question:

> Does the individual requirement/expression and the relevant set conform to the selected quality rules well enough to be
> interpreted, managed, traced, and verified later?

Review as applicable:

- necessary / justified;
- appropriate to level and scope;
- unambiguous enough for consequence;
- complete enough for the decision;
- singular/coherent enough to interpret and trace;
- feasible;
- verifiable;
- internally correct/conforming;
- set-level consistency and coverage;
- required metadata/provenance.

Methods can include structured review, peer inspection, lint/smell tools as pre-review evidence, model/schema validation,
and automated consistency checks. Passing a writing rule does **not** prove the requirement is the right requirement.

## 23.2 Requirement validation — does the requirement correctly represent its source need / intent?

Question:

> Is this the right obligation/constraint, given the stakeholder need, parent requirement, authority, intended outcome,
> operating context, and accepted risk?

Methods can include:

- stakeholder/domain review;
- source/parent trace analysis;
- scenario walkthrough;
- prototype or user research;
- simulation;
- feasibility spike;
- experiment;
- contradiction/edge-case review;
- expert/authority review where scoped requirements demand it.

A requirement may be well-written and still fail validation because it encodes the wrong need, wrong boundary, wrong
assumption, or obsolete context.

## 23.3 System verification — does the realized system satisfy the requirement?

Question:

> Does objective evidence show that the realized system/design/element satisfies the specified requirement under the
> relevant conditions?

Methods can include [VV01]:

- inspection;
- analysis;
- demonstration;
- test;
- simulation;
- static analysis;
- contract/schema check;
- formal proof/model check where linked to implementation;
- production observation where appropriate.

## 23.4 System validation — does the realized system satisfy the intended need/use in context?

Question:

> Does the realized system solve the intended stakeholder/mission/user need under representative operational conditions,
> including material unintended effects and constraints?

Methods can include representative user/operational evaluation, field trials, acceptance evaluation, mission/use-case
validation, process/outcome measurement, accessibility/usability studies, and—where causal outcome claims matter—stronger
evaluation designs.

System verification can pass while system validation fails if the specification itself was wrong or incomplete.

## 23.5 Assurance matrix

For C2+ material requirements, retain enough evidence to reconstruct the chain:

| Need/source | Requirement | Requirement verification | Requirement validation | System verification method/evidence | System validation link/outcome | Owner | Status |
|---|---|---|---|---|---|---|---|

Not every low-risk requirement requires a heavy matrix. The purpose is to prevent four different assurance claims from
being silently conflated.

## 23.6 One requirement ≠ one test

Relationships can be:

```text
one requirement → many verification activities
many requirements → one integrated scenario
one invariant → property/model test + runtime monitor
one quality target → load test + production SLI
one need → multiple requirements + system validation evidence
```

The trace should reflect reality.

## 23.7 Non-author challenge

For material specifications, a competent non-author SHOULD attempt to:

- interpret the requirement;
- identify the source need/authority;
- derive expected system behavior;
- identify missing context and contradictions;
- propose system-verification evidence;
- explain how the requirement would be validated against its source;
- identify the intended-use/system-validation question.

If they cannot do so without coaching, the artifact may not be sufficiently executable or traceable.

---

# 24. AI / ML / LLM requirements engineering

AI systems add uncertainty that conventional deterministic requirements alone do not capture.

## 24.1 Separate layers

```text
PRODUCT / USER OUTCOME
↓
AI TASK / ROLE
↓
MODEL / DATA BEHAVIOR
↓
TOOL / SYSTEM CONTROLS
↓
EVALUATION
↓
PRODUCTION MONITORING
```

Do not substitute a model metric for the product outcome.

## 24.2 AI requirement record

```yaml
intended_use:
excluded_or_prohibited_use:
target_users:
decision_or_task:
model_role:
data_sources:
data_permissions:
representative_population:
critical_slices:
expected_behavior:
acceptable_error:
unacceptable_failure:
uncertainty_handling:
explainability_or_transparency_need:
human_oversight:
fallback:
evaluation_methods:
guardrails:
monitoring:
change_trigger:
```

## 24.3 Evaluation requirements

Pre-deployment evaluation is necessary but not sufficient for material AI behavior. NIST AI 800-4 (March 2026) emphasizes
that non-determinism, changing inputs, and deployment context can reveal unforeseen behavior and consequences; it also notes
that monitoring methods remain nascent. Requirements therefore SHOULD define which deployed behaviors, slices, harms,
drift/context changes, and model/provider updates trigger review or revalidation.

Where material combine:

- model testing;
- task/scenario evaluation;
- red teaming/adversarial tests;
- user/human-in-the-loop testing;
- integration/system testing;
- production monitoring.

No single benchmark establishes holistic trustworthiness.

## 24.4 Data requirements

Specify:

- provenance;
- representativeness;
- permission/licensing;
- quality;
- missingness;
- sensitive attributes;
- temporal validity;
- drift;
- labeling/ground truth limitations;
- deletion/retention;
- train/eval contamination concerns where relevant.

## 24.5 Probabilistic acceptance

A requirement can define:

- distribution-level performance;
- minimum slice performance;
- false-positive/negative bounds;
- abstention/fallback behavior;
- confidence/calibration use;
- escalation;
- harmful-output rate;
- latency/cost guardrails.

Avoid one global “accuracy” number when failure cost differs by case.

## 24.6 Model/provider change

Define whether a provider/model/version change is:

- implementation-only;
- compatibility change;
- requirement-impacting change;
- full revalidation trigger.

If model behavior is part of the accepted product behavior, changing the model can require new evidence even when the
API is identical.

---

# 25. Agentic-system requirements

Agentic systems combine probabilistic reasoning with tools and side effects.

## 25.1 Capability inventory

Enumerate:

```text
READ PUBLIC
READ PRIVATE
WRITE INTERNAL
SEND EXTERNAL
EXECUTE CODE
MODIFY PRODUCTION
SPEND MONEY
DELETE DATA
CREATE/GRANT CREDENTIALS
```

## 25.2 Requirements by capability × consequence

As consequence rises, specify:

- agent identity;
- tool allowlist;
- resource/action authorization;
- least privilege;
- trusted/untrusted input boundaries;
- transaction/value limits;
- rate/concurrency limits;
- approval gates;
- idempotency/deduplication;
- timeout/retry/cost budget;
- audit/provenance;
- anomaly detection;
- cancellation/kill/revoke;
- compensation/recovery;
- human escalation.

## 25.3 Authority rule

> **Model output is not authorization.**

A prompt can express intended behavior; it cannot be the only enforcement mechanism for high-consequence permission.

## 25.4 Memory requirements

For persistent agent memory specify:

- allowed sources;
- provenance;
- sensitivity;
- write authority;
- conflict resolution;
- correction;
- retention;
- deletion;
- poisoning/misleading-content handling;
- tenant/user isolation.

## 25.5 Agent acceptance

A successful agent requirement must define more than task completion:

- was the intent satisfied?;
- were policy/permissions preserved?;
- were side effects correct?;
- was cost bounded?;
- was provenance retained?;
- were approvals valid?;
- could execution be stopped/recovered?;
- did repeated/concurrent execution remain safe?

---

# 26. Agile and continuous requirements engineering

Agile changes artifact timing, not the need for engineering clarity.

## 26.1 Progressive elaboration

Use:

```text
OUTCOME / PROBLEM
→ THIN DISCOVERY
→ SLICE / HYPOTHESIS
→ IMPLEMENTATION-NEAR SPECIFICATION
→ ACCEPTANCE EVIDENCE
→ PRODUCTION LEARNING
→ NEXT REFINEMENT
```

Do not force low-value detail months before a decision. Do not defer architecture-driving quality/security/data
constraints until implementation.

## 26.2 Definition of Ready — risk-based

A work item is ready enough when:

- intended outcome is clear;
- scope is coherent;
- important domain terms are understood;
- material constraints/risks are visible;
- dependencies are known enough;
- acceptance/evaluation is possible;
- unknowns are bounded or explicitly part of the work.

“Ready” does not mean all uncertainty is gone.

## 26.3 Continuous discovery

Production evidence can create requirements:

- repeated support issue;
- incident;
- accessibility failure;
- security finding;
- conversion/retention behavior;
- model drift;
- performance saturation;
- integration change.

Route these through the same provenance/decision system rather than bypassing requirements governance.

---

# 27. Decision framework — how much specification is enough?

Ask in order:

```text
1. What decision/implementation will this specification support?
2. What can go wrong if meaning is ambiguous?
3. How reversible is the change?
4. How many teams/systems/users depend on it?
5. Is there legal/safety/security/privacy exposure?
6. Is state/concurrency/temporal behavior complex?
7. Can we detect a wrong interpretation before harm?
8. Is the requirement stable or still discovery-heavy?
9. What representation gives the cheapest adequate evidence?
```

## Output

### Lean

Use when consequence is low and feedback is fast:

- outcome;
- key behavior;
- key quality/constraint;
- acceptance;
- important assumptions.

### Standard

Add:

- structured requirement records;
- domain terms;
- edge/failure cases;
- quality scenarios;
- change ownership;
- selective traceability.

### Controlled

Add:

- baselined critical requirements;
- traceability;
- verification matrix;
- independent review;
- model/state analysis;
- stronger change impact.

### Critical

Use domain-specific assurance standard and qualified specialists.

---

# 28. Decision framework — elicitation method

```text
Is the uncertainty primarily tacit human/domain knowledge?
  → interview + observation

Is it conflict/shared meaning?
  → facilitated workshop/modeling + decision rights

Is it authoritative external constraint?
  → primary-source rule/contract/regulation analysis

Is it actual observed system/user behavior?
  → telemetry, incidents, support/data analysis

Is it interaction/feasibility uncertainty?
  → prototype + representative user/technical test

Is it large-scale textual evidence?
  → AI/NLP-assisted extraction + provenance + human validation

Is omission expensive?
  → combine independent methods
```

Do not choose the method because it is the team's favorite workshop template.

---

# 29. Decision framework — specification representation

```text
Simple obligation/policy?
  → controlled prose

Combinatorial business rules?
  → decision table

State lifecycle/transitions?
  → state machine

Interaction/order across actors?
  → scenario/sequence model

Data structure/constraints?
  → schema + semantic notes

API/interface?
  → machine contract + semantic/failure/authorization rules

Concrete boundary examples?
  → specification by example

Complex goals/conflicts/alternatives?
  → goal model / decision model

High-consequence protocol/state invariant?
  → formal specification/model checking candidate
```

Use multiple forms when each carries different information.

---

# 30. Decision framework — traceability depth

Score no fake number. Ask:

- regulatory/audit requirement?;
- safety/security/privacy consequence?;
- C2+ materiality?;
- multiple teams/vendors?;
- long life?;
- high change rate?;
- reuse across product line?;
- hard-to-detect failure?;
- expensive regression?;
- need for impact analysis?;

### If mostly no

Use lightweight issue/commit/test linkage.

### If several yes

Use stable IDs and bidirectional critical links.

### If C3/C4 / regulated

Use assurance-grade traceability with explicit ownership and validation of link completeness/accuracy.

---

# 31. Decision framework — DDD/domain modeling depth

```text
Is business/domain complexity a primary difficulty?
  ├─ NO → lightweight glossary + rule/state model
  └─ YES
      Are language conflicts/subdomain boundaries recurring?
        ├─ NO → richer domain model may be enough
        └─ YES
            Can domain experts participate and team sustain discipline?
              ├─ NO → targeted modeling first
              └─ YES → strategic DDD is a strong candidate
```

Then decide architecture boundaries separately.

---

# 32. Decision framework — formal methods

Consider formal specification when:

```text
CONSEQUENCE × STATE/INTERLEAVING COMPLEXITY × AMBIGUITY COST
```

is high enough to justify modeling expertise.

Strong candidates:

- distributed coordination;
- consensus/locking;
- cryptographic/key workflows;
- payment/ledger invariants;
- safety state machines;
- access-control policy;
- irreversible migration protocol.

Do not formalize low-risk CRUD behavior merely for prestige.

---

# 33. Decision framework — priority / scope

1. Remove non-applicable items.
2. Separate mandatory constraints.
3. Map dependencies.
4. Identify decision deadline/capacity.
5. Compare outcomes, risk reduction, learning value, cost, reversibility, uncertainty.
6. Stress-test ranking against alternative weights/assumptions if scoring is used.
7. Name the decision owner.
8. Record why excluded/deferred items are acceptable.
9. Set revisit trigger.

---

# 34. End-to-end operating model

## Stage 0 — Frame

Outputs:

- problem/outcome brief;
- system boundary;
- criticality;
- research/elicitation plan;
- known constraints/authorities;
- uncertainty register.

## Stage 1 — Domain discovery

Outputs:

- glossary;
- domain model;
- workflows/state/rules;
- sources of truth;
- stakeholder map;
- context map;
- variability map if relevant.

## Stage 2 — Elicit

Outputs:

- evidence register;
- candidate needs;
- candidate requirements/constraints;
- conflicts;
- observations;
- open questions.

## Stage 3 — Analyze

Outputs:

- normalized taxonomy;
- dependencies;
- assumptions;
- quality/failure completeness scan;
- feasibility findings;
- conflict decisions.

## Stage 4 — Specify

Outputs:

- controlled requirements;
- models/contracts/examples;
- quality scenarios;
- rationale;
- acceptance/verification plan.

## Stage 5 — Validate

Outputs:

- stakeholder/domain validation evidence;
- prototype/scenario evidence where relevant;
- defect log;
- residual uncertainty;
- approvals/decisions.

## Stage 6 — Baseline / plan implementation

Outputs:

- agreed scope;
- traceability;
- verification matrix;
- change governance;
- implementation handoff.

## Stage 7 — Verify / release / observe

Outputs:

- verification evidence;
- production signals;
- defects/incident links;
- requirement changes;
- learning.

---

# 35. Atomic Plays

## PLAY-REQ-001 — Frame a problem and system boundary

### Objective

Produce a decision-ready problem/outcome frame that prevents solution-first requirements.

### Use when

- starting a product/feature/system;
- ambiguity exists about responsibility;
- several teams/systems are involved;
- a request arrives as a proposed technology rather than a need.

### Inputs

- request/opportunity;
- available evidence;
- stakeholder list;
- known constraints.

### Method

1. State the real-world problem/opportunity.
2. Name primary outcome and unacceptable outcomes.
3. Identify users and materially affected stakeholders.
4. Draw the system/environment boundary.
5. Record authoritative constraints.
6. List assumptions and highest-value unknowns.
7. Assign criticality and decision owner.
8. Validate the frame with a non-author stakeholder/domain reviewer.

### Output

A Problem & Boundary Brief.

### Acceptance

- [ ] Outcome can be described without naming an implementation unless implementation is a real constraint.
- [ ] Boundary responsibilities are explicit.
- [ ] Important affected parties are represented.
- [ ] Critical unknowns are visible.

---

## PLAY-DOM-001 — Establish domain language and model

### Objective

Create enough shared domain understanding to prevent semantic defects.

### Method

1. Collect terms from real artifacts and operators.
2. Identify conflicting meanings.
3. Map concepts, rules, state, events, calculations, permissions, and exceptions.
4. Mark semantic scopes/contexts.
5. Identify source-of-truth owners.
6. Test the model on recent real cases and edge cases.
7. Record unresolved ambiguity.

### Acceptance

- [ ] Critical terms have operational meaning.
- [ ] Model explains real cases, not only ideal examples.
- [ ] Persistence/UI concepts are not silently treated as domain truth.
- [ ] Context translations exist where the same term differs.

---

## PLAY-REQ-002 — Design an elicitation plan

### Objective

Select evidence sources/methods proportional to uncertainty and omission risk.

### Method

For each key question:

```yaml
question:
why_it_matters:
best_source:
method:
bias_or_limit:
corroborating_source:
stop_condition:
owner:
```

### Acceptance

- [ ] No critical question depends on a weak source solely because it is convenient.
- [ ] Authoritative sources are used for mandatory constraints.
- [ ] Omission-risk areas use triangulation where practical.

---

## PLAY-REQ-003 — Convert evidence into controlled requirements

### Objective

Transform candidate evidence into agreed, scoped, verifiable requirements without laundering uncertainty.

### Method

1. Classify evidence.
2. Separate need, fact, assumption, constraint, decision.
3. Resolve terminology.
4. Identify conflict/dependency.
5. Define requirement/property.
6. Add conditions, negative behavior, quality, and failure semantics.
7. Add rationale/source.
8. Define acceptance/verification.
9. Retain unresolved uncertainty as an uncertainty item, not a fake requirement.

### Acceptance

- [ ] Requirement meaning is interpretable without author coaching.
- [ ] Rationale/source is known.
- [ ] Verification route is credible.
- [ ] No unresolved contradiction is hidden.

---

## PLAY-REQ-004 — Define a quality requirement

### Objective

Replace vague adjectives with measurable or objectively assessable quality expectations.

### Method

Use:

```yaml
quality:
stakeholder:
stimulus:
environment:
response:
measure_or_evidence:
target:
guardrail:
verification:
```

### Acceptance

- [ ] Target is linked to outcome/consequence.
- [ ] Environment/workload is stated.
- [ ] Measurement method is feasible.
- [ ] Guardrails prevent local metric optimization from harming correctness/security/safety.

---

## PLAY-REQ-005 — Validate requirements before commitment

### Objective

Challenge whether the specification describes the right system behavior.

### Method

1. Independent desk review.
2. Domain/stakeholder walkthrough.
3. Normal scenario.
4. Constrained/edge scenario.
5. Failure/adverse scenario.
6. Feasibility check.
7. Verification-method check.
8. Conflict/assumption review.
9. Fix or explicitly accept residual defects.

### Acceptance

- [ ] No BLOCKER defects.
- [ ] Material stakeholders/context represented.
- [ ] Critical assumptions have owner.
- [ ] Requirements are feasible enough for commitment.

---

## PLAY-REQ-006 — Plan verification and acceptance

### Objective

Make assurance strategy explicit before implementation removes options.

### Method

For each material requirement choose method by property:

- inspection;
- analysis;
- demonstration;
- test;
- simulation;
- formal method;
- runtime observation.

Record environment, data, thresholds, independence, and retained evidence.

### Acceptance

- [ ] Evidence can actually establish the specified claim.
- [ ] High-risk requirements do not rely only on producer self-attestation.
- [ ] Test/environment fidelity is appropriate.

---

## PLAY-REQ-007 — Evaluate a requirement change

### Objective

Change meaning without uncontrolled downstream breakage.

### Method

1. Identify changed statement/rationale.
2. Identify affected assumptions/authority.
3. Traverse dependent requirements.
4. Review architecture/data/interfaces.
5. Review acceptance/tests/evals.
6. Review operations/migration.
7. Revalidate affected behavior.
8. update baseline/trace links.
9. communicate version impact.

### Acceptance

- [ ] No known orphan evidence.
- [ ] Compatibility/migration impact understood.
- [ ] New/removed risk explicitly accepted.

---

## PLAY-AI-REQ-001 — Specify AI/agent behavior and evaluation

### Objective

Turn probabilistic capability into bounded product requirements.

### Method

1. Define product outcome and model role.
2. Define intended/prohibited use.
3. Define data and representative evaluation population.
4. Define error classes and consequence.
5. Define task metrics + quality slices + guardrails.
6. Define human oversight/fallback.
7. Define tool permissions/side effects if agentic.
8. Define evaluation methods.
9. Define production monitoring and change triggers.

### Acceptance

- [ ] Benchmark score is not the only acceptance evidence.
- [ ] High-impact actions are externally authorized.
- [ ] Failure/fallback behavior is explicit.
- [ ] Monitoring can detect material drift/failure.

---

# 36. Review checklists

## 36.1 Problem / scope checklist

- [ ] Real problem/opportunity stated.
- [ ] Intended outcome stated.
- [ ] Unacceptable outcomes stated.
- [ ] System-of-interest defined.
- [ ] External environment/dependencies defined.
- [ ] Users and affected stakeholders defined.
- [ ] Criticality assigned.
- [ ] Regulatory/contractual applicability checked.
- [ ] Important unknowns explicit.

## 36.2 Domain checklist

- [ ] Critical terms have scoped definitions.
- [ ] Rules and exceptions are represented.
- [ ] State/events/transitions are represented where material.
- [ ] Sources of truth are known.
- [ ] Permissions/authority are represented where material.
- [ ] Context-specific language differences are mapped.
- [ ] Database/UI representation is not mistaken for domain model.
- [ ] Commonality/variability modeled only if product-family value exists.

## 36.3 Requirement-quality checklist

- [ ] Necessary?
- [ ] Correct relative to current evidence?
- [ ] Scoped?
- [ ] Clear?
- [ ] Feasible?
- [ ] Consistent?
- [ ] Observable/verifiable?
- [ ] Rationale/source known?
- [ ] Assumptions visible?
- [ ] Conditions/exceptions visible?
- [ ] Quantity/unit/tolerance defined if material?
- [ ] Quality/failure implications included?
- [ ] Solution constraint justified?
- [ ] Change trigger/owner known for consequential items?

## 36.4 Quality-requirement checklist

- [ ] Named quality characteristic.
- [ ] Stimulus/context.
- [ ] Environment/workload.
- [ ] Expected response.
- [ ] Measure/evidence.
- [ ] Target/threshold derived from actual need.
- [ ] Guardrail.
- [ ] Verification method.
- [ ] No arbitrary prestige target.

## 36.5 Interface checklist

- [ ] Input/schema.
- [ ] Semantic validation.
- [ ] Authentication/authorization.
- [ ] Success result.
- [ ] Error model.
- [ ] Timeout/deadline.
- [ ] Cancellation.
- [ ] Idempotency/duplicate handling.
- [ ] Ordering/consistency.
- [ ] Rate/capacity.
- [ ] Versioning/compatibility.
- [ ] Deprecation/migration.
- [ ] Observability/audit where needed.

## 36.6 Data/state checklist

- [ ] Source of truth.
- [ ] Owner/writers.
- [ ] Valid states/invariants.
- [ ] Concurrency/conflict rule.
- [ ] Classification/privacy.
- [ ] Retention/deletion.
- [ ] Lineage/audit.
- [ ] Backup/recovery.
- [ ] Migration/version.
- [ ] Reconciliation/repair where needed.

## 36.7 AI/agent checklist

- [ ] Intended/prohibited use.
- [ ] Model role vs deterministic system role.
- [ ] Data provenance/permission.
- [ ] Representative eval population/slices.
- [ ] Error classes and unacceptable failure.
- [ ] Multi-method evaluation.
- [ ] Human oversight/fallback.
- [ ] Post-deployment monitoring.
- [ ] Model/provider version-change policy.
- [ ] Tool permissions outside prompt.
- [ ] Side-effect/value/rate limits.
- [ ] Approval gates.
- [ ] Audit/provenance.
- [ ] Kill/revoke/recovery.
- [ ] Memory lifecycle if persistent.

---

# 37. Canonical templates

## 37.1 Problem & Boundary Brief

```yaml
id:
problem_or_opportunity:
evidence:
users:
affected_stakeholders:
primary_outcome:
unacceptable_outcomes:
system_of_interest:
external_environment:
dependencies:
trust_boundaries:
regulatory_or_contractual_constraints:
criticality:
known_assumptions:
key_unknowns:
decision_owner:
review_trigger:
```

## 37.2 Requirement record

```yaml
id:
title:
type:
status:
statement:
scope:
conditions:
exceptions:
negative_requirement:
rationale:
source_or_authority:
stakeholders:
criticality:
assumptions:
dependencies:
priority_or_decision_class:
acceptance:
verification_method:
evidence_location:
owner:
version:
change_trigger:
```

## 37.3 Quality requirement

```yaml
id:
quality_characteristic:
stakeholder_or_source:
stimulus:
environment:
system_or_artifact:
response:
measure:
target:
guardrail:
verification_method:
owner:
```

## 37.4 Assumption record

```yaml
id:
assumption:
source:
evidence:
why_it_matters:
requirements_depending_on_it:
risk_if_false:
validation_method:
owner:
expiry_or_trigger:
status:
```

## 37.5 Domain rule

```yaml
id:
semantic_scope:
rule:
rationale:
authority:
inputs:
conditions:
exceptions:
result:
state_effect:
examples:
counterexamples:
owner:
```

## 37.6 State model record

```yaml
entity:
states:
initial:
terminal:
transitions:
  - from:
    trigger:
    guard:
    actor:
    to:
    side_effects:
invalid_transitions:
recovery:
```

## 37.7 Trace link

```yaml
from:
to:
relationship:
purpose:
confidence:
generated_by:
verified_by:
last_verified:
```

## 37.8 Uncertainty register

```markdown
| Unknown | Why it matters | Current evidence | Risk if wrong | How to resolve | Owner | Trigger/date |
|---|---|---|---|---|---|---|
```

## 37.9 Verification matrix

```markdown
| Requirement | Property / risk | Method | Environment/data | Pass evidence | Owner | Independence | Status |
|---|---|---|---|---|---|---|---|
```

## 37.10 Requirement change record

```yaml
change_id:
requirement_ids:
old_meaning:
new_meaning:
reason:
source:
assumptions_changed:
affected_artifacts:
compatibility_impact:
migration_impact:
verification_retest:
approver:
effective_version:
```

## 37.11 AI evaluation contract

```yaml
system_or_feature:
intended_use:
prohibited_use:
model_role:
model_or_provider_version_policy:
data_sources:
evaluation_population:
critical_slices:
tasks:
metrics:
thresholds:
unacceptable_failures:
guardrails:
red_team_scope:
user_test_scope:
human_oversight:
fallback:
production_monitoring:
revalidation_triggers:
```

---

# 38. Anti-patterns

## 38.1 Solution-first requirement

**Symptom:** “We need Kafka/Redis/Kubernetes/LLM X.”

**Failure:** hides the need and blocks alternatives.

**Fix:** state the required capability/quality/failure property; retain technology only when it is a justified constraint.

## 38.2 The user-story monoculture

**Symptom:** every requirement forced into “As a… I want… so that…”.

**Failure:** quality, state, security, interfaces, data, regulation, and operational properties disappear.

**Fix:** use stories where they help coordination; link specialized specifications.

## 38.3 Mockup-as-specification

**Symptom:** screenshot defines the “requirements.”

**Failure:** visual flow omits authority, data, failure, quality, accessibility, backend, and operational behavior.

**Fix:** treat mockup as one evidence/specification layer.

## 38.4 “NFR later”

**Symptom:** performance/security/reliability discussed after architecture.

**Failure:** architecture becomes unable to satisfy real requirements cheaply.

**Fix:** identify architecture-driving qualities early.

## 38.5 “Make it scalable”

**Symptom:** no workload, threshold, or failure policy.

**Fix:** define capacity, workload, response and overload behavior.

## 38.6 “Solution-free at all costs”

**Symptom:** legitimate regulatory/interoperability/migration constraints are deleted to preserve purity.

**Fix:** preserve justified constraints and their rationale.

## 38.7 Premature specification

**Symptom:** deep requirement detail before the problem/domain is understood.

**Fix:** progressive elaboration and targeted experiments.

## 38.8 False completeness

**Symptom:** baseline treated as proof that no unknowns remain.

**Fix:** track sufficiency for decision + explicit uncertainty.

## 38.9 One global domain language

**Symptom:** same term forced to one meaning across unrelated subdomains.

**Fix:** scope vocabulary and map translations.

## 38.10 Database-driven domain

**Symptom:** tables/entities treated as domain ontology.

**Fix:** model behavior/rules/state first; map persistence separately.

## 38.11 DDD cosplay

**Symptom:** aggregates/events/bounded contexts renamed without real domain reasoning.

**Fix:** use DDD only when semantic complexity creates measurable value.

## 38.12 Bounded context = microservice

**Symptom:** semantic boundary instantly becomes network deployment boundary.

**Fix:** decide deployment/ownership independently using architecture trade-offs.

## 38.13 Gherkin everywhere

**Symptom:** latency, privacy, reliability, security and invariants forced into verbose scenarios.

**Fix:** match representation to property.

## 38.14 Requirement linting as semantic QA

**Symptom:** “smell” tool passes, therefore requirement is correct.

**Fix:** use automated linting as pre-review only.

## 38.15 Formalism theatre

**Symptom:** sophisticated notation no stakeholder can validate.

**Fix:** pair formal properties with accessible semantics/examples and independent validation.

## 38.16 One requirement = one test

**Symptom:** traceability matrix forces artificial one-to-one links.

**Fix:** trace requirements to verification evidence sets.

## 38.17 Trace everything

**Symptom:** huge stale link graph nobody uses.

**Fix:** purpose-driven, risk-proportionate traceability.

## 38.18 AI trace-link confidence laundering

**Symptom:** similarity-generated link stored as fact.

**Fix:** record confidence/provenance and verify consequential links.

## 38.19 Priority score absolutism

**Symptom:** weighted spreadsheet becomes “objective” order.

**Fix:** separate hard constraints, dependency, uncertainty, and judgment.

## 38.20 MoSCoW without scarcity

**Symptom:** most items become “Must.”

**Fix:** define actual capacity/decision rule and who owns trade-offs.

## 38.21 Prototype commitment

**Symptom:** stakeholders assume prototype behavior is contracted.

**Fix:** label what is exploratory vs accepted.

## 38.22 Requirements by memory

**Symptom:** rationale and decisions live in meetings/chat.

**Fix:** durable decision/requirement record for consequential items.

## 38.23 Permanent TBD/TBR

**Symptom:** unresolved value survives into implementation unnoticed.

**Fix:** owner, resolution method, expiry/trigger, risk.

## 38.24 Stakeholder democracy theatre

**Symptom:** every participant appears to have equal authority on every question.

**Fix:** separate evidence, impact, expertise, approval, and decision rights.

## 38.25 “The user”

**Symptom:** one abstract persona represents all roles, accessibility needs, and affected people.

**Fix:** identify relevant actors and segments.

## 38.26 Requirements freeze

**Symptom:** change treated as process failure.

**Fix:** control change, preserve rationale, and learn.

## 38.27 Endless change

**Symptom:** nothing is stable enough for engineering commitment.

**Fix:** baseline decision-relevant interfaces/invariants while allowing managed evolution.

## 38.28 AI as requirements owner

**Symptom:** model generates, prioritizes, and “approves” requirements.

**Fix:** AI assists; authorized humans/governance own commitment and risk.

## 38.29 AI benchmark as product requirement

**Symptom:** “model must score X” substitutes for user/system outcome.

**Fix:** connect model metric to task/outcome, slices, guardrails, and production behavior.

## 38.30 Prompt-only agent policy

**Symptom:** “do not spend over $X” exists only in system prompt.

**Fix:** external runtime enforcement.

## 38.31 Document-volume KPI

**Symptom:** pages, requirements count, or story count = progress.

**Fix:** measure decision/execution quality and defect/rework outcomes.

## 38.32 Spec copied into many tools

**Symptom:** conflicting truth across docs/backlog/test suite/schema.

**Fix:** canonical home + generated/linked views.

## 38.33 Architecture disguised as requirement

**Symptom:** consequential design choice bypasses trade-off review by being declared mandatory.

**Fix:** classify as decision/constraint and record rationale/alternatives.

## 38.34 Compliance copy-paste

**Symptom:** regulation text pasted into backlog without applicability/control/evidence mapping.

**Fix:** scoped authority → engineering requirement/control → evidence.

## 38.35 Requirements stop at release

**Symptom:** no monitoring/change trigger after launch.

**Fix:** connect volatile/quality/AI requirements to runtime evidence.

---

# 39. QA gates for a requirements baseline

## Gate 0 — Scope

Pass when:

- problem/outcome clear;
- boundary clear;
- users/stakeholders clear;
- criticality selected;
- authorities/constraints identified;
- unknowns visible.

## Gate 1 — Domain/evidence

Pass when:

- domain sources are credible enough;
- critical terms defined;
- candidate requirements have provenance;
- conflicts and limitations visible;
- important non-person evidence checked.

## Gate 2 — Requirement quality

Pass when:

- requirements correctly classified;
- important quality/failure behavior included;
- ambiguity proportionate to risk;
- feasibility checked;
- assumptions/rationale visible;
- justified solution constraints explicit.

## Gate 3 — Validation

Pass when:

- representative stakeholder/domain challenge performed;
- critical normal/edge/adverse scenarios evaluated;
- wrong-system risk acceptably reduced;
- no unresolved BLOCKER defect.

## Gate 4 — Verification readiness

Pass when:

- material requirements have credible verification route;
- environment/data/thresholds known;
- required independence selected;
- traceability sufficient for criticality.

## Gate 5 — Change governance

Pass when:

- canonical source known;
- owner/version/status known;
- change impact route defined;
- review triggers known;
- stale/superseded artifacts controlled.

## Gate 6 — Operational learning

Ongoing:

- requirement defect escape;
- incident links;
- runtime quality signals;
- AI/model drift;
- assumption failures;
- new regulation/standards;
- user evidence;
- deprecation/migration.

---

# 40. Defect severity for requirements

## BLOCKER

- requirement contradicts mandatory authority;
- unsafe/high-impact behavior is ambiguous;
- critical requirement cannot be verified;
- wrong authorization/data isolation;
- impossible/infeasible requirement treated as committed;
- material conflict unresolved with no decision owner;
- critical assumption known false;
- AI/agent high-impact action lacks enforceable authority boundary.

## MAJOR

- likely divergent implementation;
- missing important quality requirement;
- missing failure behavior;
- stale critical trace link;
- dependency/order omitted;
- unowned material TBD/uncertainty;
- incomplete stakeholder representation likely to change decision.

## MINOR

- clarity/friction issue unlikely to change outcome.

## EDITORIAL

- style/format/non-material consistency.

A baseline cannot be `VALIDATED` with unresolved BLOCKER defects.

---

# 41. Metrics and learning

Select only metrics with a decision use.

## 41.1 Candidate signals

### Discovery quality

- critical unknowns retired;
- contradictory evidence discovered;
- stakeholder/domain coverage.

### Requirement quality

- ambiguity defects found before implementation;
- requirement defects escaped downstream;
- percentage of critical requirements with verification evidence;
- stale trace-link rate;
- unresolved assumptions beyond expiry.

### Flow

- decision latency;
- time from source change to impact assessment;
- requirement-change rework;
- review turnaround.

### Outcome

- user/business outcome linked to requirement;
- incident frequency tied to specification defects;
- failed acceptance due to requirement misunderstanding.

### AI-specific

- eval/production divergence;
- critical slice failure;
- guardrail breach;
- fallback/abstention rate;
- unapproved agent action attempts;
- model-change revalidation burden.

## 41.2 Metrics to avoid as primary success proof

- requirement count;
- story points;
- pages;
- number of workshops;
- percentage “documented”;
- AI-generated requirement volume;
- trace-link count;
- one aggregate requirement-quality score.

---

# 42. Governance and repository standard

## 42.1 Canonical truth

Each controlled requirement/property MUST have one unambiguous **authoritative identity/source of truth**. That does not
require one physical file or one tool. The canonical record may be referenced, synchronized, or rendered into other systems
provided authority, version, and conflict resolution are explicit.

Derived views may exist in:

- product docs;
- backlog;
- test/eval system;
- API docs;
- model repository;
- compliance matrix.

Drift between authoritative and derived/synchronized views must be detectable for critical material.

## 42.2 Ownership

Define:

- requirements/domain owner;
- decision owner;
- technical owner;
- verification owner;
- approval/risk owner for high consequence.

## 42.3 Access

Requirements may contain:

- security-sensitive architecture;
- personal data examples;
- contract information;
- incident details;
- unreleased strategy.

Apply access controls proportionate to sensitivity without making critical operational requirements unavailable to
those who need them.

## 42.4 Change control

Material change record SHOULD include:

```yaml
version:
date:
change:
reason:
source:
affected_requirements:
affected_systems:
evidence_updated:
tests_or_evals_rerun:
migration_required:
approved_by:
```

## 42.5 Review cadence

Use event-triggered review when:

- authority changes;
- domain rule changes;
- interface/provider changes;
- architecture invalidates assumption;
- incident exposes gap;
- AI/model behavior changes;
- quality target is persistently missed;
- product strategy changes;
- user evidence contradicts assumptions.

Scheduled review complements these triggers.

---

# 43. V1 → V2.2 falsification and assurance record

The V1 working draft was deliberately treated as a hypothesis set. V2.1 re-audited all 60 V1 candidate
principles, the operating model, artifacts, decision rules, anti-patterns, release checklist, and all 15 original open
falsification targets. V2.2 then performed a third independent freshness/falsification pass focused on missing standards,
method overclaim, requirements-quality causal evidence, AI-assisted QA, and source-status drift. The complete assurance record is retained separately as
`01_requirements_specification_domain_engineering_v1_deep_falsification_audit_v2.1.md` (`SWE-01-AUDIT-2`).

| Claim tested | V2 result |
|---|---|
| universal `shall` syntax | downgraded to contextual controlled-language convention |
| all requirements solution-free | rejected; justified constraints retained with rationale |
| one requirement → one test | rejected; verification evidence can be many-to-many |
| full traceability everywhere | rejected; risk/purpose-proportionate |
| user stories sufficient | rejected |
| BDD/Gherkin universal | rejected |
| DDD universal for complex software | downgraded to contextual pattern |
| bounded context = service/team | rejected |
| one ubiquitous enterprise language | rejected |
| interviews best elicitation method | rejected; method fit matters |
| requirements complete before design | rejected; lifecycle is iterative |
| all quality attributes equal | rejected; model used as completeness aid |
| NFR bucket adequate | replaced by explicit qualities/constraints |
| priority score objective | rejected |
| automated requirement linting sufficient | rejected; semantic review required |
| formal specification superior by default | rejected; property/risk-driven |
| schema/API contract = full requirement | rejected; semantic layer preserved |
| AI can automate elicitation end-to-end | rejected |
| LLM self-review = independent assurance | rejected |
| conventional quality model sufficient for AI | extended with AI quality/evaluation overlay |
| prompt can enforce agent permissions | rejected; runtime authority required |
| requirement count indicates progress | rejected |

## 43.1 Second-pass rule audit disposition

- all 60 V1 candidate principles were explicitly reviewed;
- no rule survived solely by authority or popularity;
- domain-model mandates, stakeholder-involvement maximalism, rigid atomicity, and generic “verification” terminology were
  corrected or bounded;
- requirements-quality checks are explicitly treated as multi-dimensional controls rather than a universal score;
- the V&V model is now four-part;
- 2025–2026 evidence strengthened the boundaries around DDD, user stories, BDD, MBRE, prioritization, automated elicitation,
  and deployed-AI monitoring;
- standards freshness was re-verified for 29148, 12207, 15288, 24748-1, 15289, 9241-210, SysML, OpenAPI, JSON Schema, NIST
  ARIA/AI monitoring, and OWASP ACS.

## 43.2 Third-pass V2.2 disposition

The third pass did not reverse the architecture, but it found material omissions/boundaries that required correction:

1. `QUAL03` — quality-in-use/context-of-use added; product quality alone was incomplete for real-use fitness.
2. `VV01` — IEEE 1012-2024 added as the direct V&V process standard and integrity-scaled assurance anchor.
3. `VOCAB01` — 24765:2017 confirmed current in 2026; the proposed Edition 3 project was cancelled 20 September 2026.
4. `SMELL02/03` — requirements-smell guidance now distinguishes detected style indicators from demonstrated downstream harm.
5. `REAIQA01` — AI requirement-quality tools explicitly limited to triage/decision support absent independent semantic validation.
6. canonical truth clarified as authoritative identity rather than a mandatory single physical document/tool.

The full rule-by-rule third-pass audit is retained separately as `SWE-01-AUDIT-3`.

## 43.3 What was added after falsification

V2 adds:

- canonical requirements ontology;
- negative/forbidden behavior;
- temporal/concurrency/ordering requirements;
- overload/degradation/operability requirements;
- explicit data lifecycle/state model;
- risk-based specification depth;
- domain/DDD decision rules;
- product-line domain engineering overlay;
- interface/specification-as-code layer;
- AI/agent requirement contracts;
- uncertainty register;
- verification matrix;
- purpose-driven traceability;
- change-impact model;
- field-validation status boundary.

---

# 44. Contradiction ledger

| Tension | Evidence-weighted conclusion |
|---|---|
| upfront specification vs emergence | specify architecture-/risk-driving constraints early; progressively elaborate uncertain details |
| prose vs models | choose the representation that reduces the relevant ambiguity at acceptable cost |
| user story vs detailed requirement | story for coordination; deeper spec for quality/state/interface/assurance as needed |
| solution-free vs constrained | avoid accidental prescription; preserve legitimate constraints |
| traceability vs overhead | trace when change/assurance value exceeds creation/maintenance cost |
| domain model vs data model | link them, do not equate them |
| one language vs contextual language | consistent inside scope; translate across contexts |
| DDD vs simple model | DDD when semantic complexity earns it |
| formal methods vs testing | complement each other; formal methods strengthen scoped properties, tests observe implementation |
| acceptance examples vs invariants | examples communicate; invariants generalize |
| product owner judgment vs stakeholder evidence | decision rights do not erase evidence from affected groups |
| quality comprehensiveness vs bureaucracy | scan broadly, deepen only material qualities |
| baseline vs learning | baseline coordination-critical meaning while keeping controlled change |
| AI automation vs human agreement | automate candidate work; human/governance retains authority and validation |
| model metric vs user outcome | connect model behavior to task/system/user impact |
| agent autonomy vs approval | autonomy requires stronger external policy, auditability, limits, and recovery |

---

# 45. Source status watchlist

## 45.1 ISO/IEC/IEEE 29148

- `2018 Edition 2` remains the current published requirements-engineering standard at the evidence cutoff.
- ISO identifies an Edition 3 DIS as expected replacement.
- V2 uses 2018 as current baseline and treats Edition 3 as a watch item.

## 45.2 ISO/IEC 25059

- `2023 Edition 1` remains the published AI quality model at the evidence cutoff.
- Edition 2 is at FDIS approval stage.
- Do not cite Edition 2 as final until published.

## 45.3 AI/agent standards

- NIST ARIA AI 200-3 was published 18 September 2026 and is new.
- OWASP Agent Control Standard was released 1 September 2026 and is an emerging open control standard.
- Treat detailed implementation guidance as fast-moving.

## 45.4 Lifecycle/documentation standards

- ISO/IEC/IEEE 15288:2023 remains the current published system life-cycle standard.
- ISO/IEC/IEEE 24748-1:2024 remains the current life-cycle-management guidance reviewed here.
- ISO/IEC/IEEE 15289:2019 remains current but has status `International Standard to be revised`; a replacement is under
  development. Treat it as the current documentation baseline while tracking the revision.
- ISO 9241-210:2019 was reviewed/confirmed in 2025 and remains current for human-centred design of interactive systems.

## 45.5 Vocabulary standard

- ISO/IEC/IEEE 24765:2017 remains the current published systems/software engineering vocabulary and was confirmed in 2026.
- The proposed Edition 3 committee-draft project was cancelled on **20 September 2026**.
- Therefore V2.2 does **not** represent an Edition 3 vocabulary replacement as actively progressing at the evidence cutoff.

## 45.6 Modeling and interface specifications

- OMG SysML 2.0 is formally adopted; the current language specification is formal/2026-03-02.
- OpenAPI 3.2.1 was published 10 September 2026.
- JSON Schema's current published specification remains Draft 2020-12 according to json-schema.org.
- These are modeling/implementation/contract standards, not universal product-requirements frameworks.

---

# 46. Audited evidence map and source register

> Sources have different roles. Formal standards establish definitions/process baselines; systematic reviews summarize
> evidence; empirical studies are scoped to studied contexts; high-assurance organizations provide mature mechanisms;
> emerging AI/agent sources require faster re-checking.

## [REQ01] ISO/IEC/IEEE 29148:2018 — Requirements engineering

**URL:** https://www.iso.org/standard/72089.html  
**Lane:** `E1 — International standard`  
**Status:** Current published Edition 2; reviewed/confirmed 2024. ISO states it is expected to be replaced by Edition 3
DIS.  
**Used for:** requirements-engineering lifecycle/process baseline, requirements-related processes and information items.  
**Limitation:** Full standard is copyrighted; this playbook relies on public official metadata/abstract plus independent
companion sources. Formality must remain proportionate.

## [REQ02] ISO/IEC/IEEE DIS 29148 — Edition 3 watch item

**URL:** https://www.iso.org/standard/94091.html  
**Lane:** `E1 — Draft international standard`  
**Status:** Under development at the evidence cutoff.  
**Use:** future migration watch only.  
**Limitation:** MUST NOT be represented as final current standard.

## [LIFE01] ISO/IEC/IEEE 12207:2026 — Software life cycle processes

**URL:** https://www.iso.org/standard/90219.html  
**Lane:** `E1`  
**Status:** Published Edition 2, April 2026.  
**Finding:** lifecycle processes span acquisition/supply/development/operation/maintenance/disposal and do not imply one
waterfall methodology.  
**Use:** requirements as lifecycle responsibility; controlled evolution.  
**Limitation:** process framework, not proof that more documentation improves outcomes.

## [QUAL01] ISO/IEC 25010:2023 — Product quality model

**URL:** https://www.iso.org/standard/78176.html  
**Lane:** `E1`  
**Finding:** current product-quality model contains nine characteristics and can support elicitation, specification,
testing objectives and acceptance criteria.  
**Use:** completeness scan for quality requirements.  
**Limitation:** not an equal-weight checklist or one-number scoring system.

## [QUAL02] ISO/IEC 25030:2019 — Quality requirements framework

**URL:** https://www.iso.org/standard/72116.html  
**Lane:** `E1`  
**Status:** Current; reviewed/confirmed 2025.  
**Finding:** framework for eliciting, defining, using and governing quality requirements; does not prescribe one
development process.  
**Use:** quality requirement lifecycle.  
**Limitation:** focused on quality requirements rather than every functional/domain requirement.

## [QUAL03] ISO/IEC 25019:2023 — Quality-in-use model

**URL:** https://www.iso.org/standard/78177.html  
**Lane:** `E1 — International standard`  
**Status:** Published Edition 1, November 2023.  
**Finding:** defines three quality-in-use characteristics and explicitly makes context of use a prerequisite for specifying,
measuring, evaluating, and improving quality-in-use.  
**Use:** context-of-use, quality-in-use, and real-world fitness requirements.  
**Limitation:** quality-in-use model, not a complete requirements method or domain-specific acceptance standard.

## [VV01] IEEE 1012-2024 — System, Software, and Hardware Verification and Validation

**URL:** https://ieeexplore.ieee.org/document/11134780  
**Lane:** `E1 — Formal IEEE standard`  
**Status:** Active/approved 1012-2024; published 22 August 2025. A new P1012 revision project was authorized in 2026, so
1012-2024 remains the current approved standard at this cutoff.  
**Finding:** V&V determines conformance to activity requirements and fitness for intended use/user needs; V&V may include
analysis, evaluation, review, inspection, assessment, and testing; minimum V&V tasks scale across a four-level integrity schema.  
**Use:** direct V&V process baseline and risk-proportionate assurance.  
**Limitation:** process standard; exact task depth and independence must be tailored to system integrity/risk.

## [VOCAB01] ISO/IEC/IEEE 24765:2017 — Systems and software engineering vocabulary

**URL:** https://www.iso.org/standard/71952.html  
**Lane:** `E1 — International standard`  
**Status:** Published Edition 2; reviewed and confirmed in 2026. The Edition 3 CD project was cancelled 20 September 2026.  
**Finding:** provides common systems/software engineering vocabulary and links definitions to source standards.  
**Use:** terminology disambiguation and source-status control.  
**Limitation:** vocabulary reference, not a requirements process or evidence of method effectiveness.

## [BODY01] IEEE Computer Society — SWEBOK v4 / Software Requirements

**URL:** https://www.computer.org/education/bodies-of-knowledge/software-engineering  
**Companion chapter:** https://swebokwiki.org/Chapter_1%3A_Software_Requirements  
**Lane:** `E4 — Consensus body of knowledge`  
**Finding:** software requirements covers elicitation, analysis, specification, validation and lifecycle management.  
**Use:** scope/completeness map.  
**Limitation:** disciplinary body of knowledge, not causal proof for every method.

## [NASA01] NASA Systems Engineering Handbook — Technical Requirements Definition

**URL:** https://www.nasa.gov/reference/4-2-technical-requirements-definition/  
**Lane:** `E4/E5 — Government high-assurance guidance`  
**Finding:** technical requirement definition is recursive/iterative; emphasizes stakeholder communication,
traceability, assumptions, feasibility, verifiability, redundancy/overspecification checks.  
**Use:** strong high-assurance mechanisms and validation logic.  
**Limitation:** mission/safety context; do not cargo-cult its ceremony into ordinary product work.

## [NASA02] NASA Systems Engineering Handbook — Appendix C/D/E/F

**URL:** https://www.nasa.gov/reference/system-engineering-handbook-appendix/  
**Lane:** `E4/E5`  
**Finding:** public guidance includes requirement-writing checks, verification matrices, validation planning, functional,
timing and state analysis.  
**Use:** controlled-language/checklist and V&V mechanics.  
**Limitation:** same high-assurance context constraint.

## [PRO01] IREB CPRE — Foundation & Practitioner syllabi

**URL:** https://cpre.ireb.org/en/downloads-and-resources/downloads  
**Lane:** `E4/E7 — Professional consensus/practice`  
**Status at cutoff:** Foundation syllabus v3.3.0; practitioner material maintained separately.  
**Use:** applied terminology/practice triangulation.  
**Limitation:** certification curriculum, not empirical proof or binding standard.

## [NORM01] IETF RFC 8174 / BCP 14

**URL:** https://www.rfc-editor.org/info/rfc8174/  
**Lane:** `E4/E6 — Internet standards convention`  
**Finding:** clarifies uppercase normative keywords and explicitly notes such keywords are not required for normative
text.  
**Use:** disciplined MUST/SHOULD/MAY language and falsification of universal `shall` dogma.  
**Limitation:** IETF document convention, not a universal requirements-writing standard.

## [FOUND01] Nuseibeh & Easterbrook — Requirements Engineering: A Roadmap

**DOI:** https://doi.org/10.1145/336512.336523  
**Lane:** `E3 — Foundational peer-reviewed synthesis`  
**Finding:** frames RE as discovering system purpose through stakeholders/needs and documenting it for analysis,
communication and implementation.  
**Use:** durable purpose/communication framing.  
**Limitation:** 2000 source; modern tooling/AI practice requires newer evidence.

## [FOUND02] Zave & Jackson — Four Dark Corners of Requirements Engineering

**DOI:** https://doi.org/10.1145/237432.237434  
**Lane:** `E3 — Foundational peer-reviewed theory`  
**Finding:** distinguishes requirements, specifications and domain knowledge and emphasizes environment/domain
descriptions.  
**Use:** ontology and problem/environment boundary.  
**Limitation:** conceptual foundation; not a contemporary process standard.

## [ELIC01] Pacheco, García & Reyes (2018) — Requirements elicitation techniques SLR

**DOI:** https://doi.org/10.1049/iet-sen.2017.0144  
**Lane:** `E2 — Systematic literature review`  
**Finding:** 140 studies; technique effectiveness depends on product, stakeholder characteristics, information type and
other context.  
**Use:** reject one universal elicitation technique.  
**Limitation:** literature through 2015; technique/tool landscape has evolved.

## [ELIC02] Lim, Henriksson & Zdravkovic (2021) — Data-Driven Requirements Elicitation SLR

**DOI:** https://doi.org/10.1007/s42979-020-00416-4  
**Lane:** `E2`  
**Finding:** 68 studies; automated approaches frequently identify/classify requirement-related information rather than
produce ready-to-use agreed requirements.  
**Use:** data/AI-assisted elicitation boundary.  
**Limitation:** studies precede latest LLM generation; automation capability is fast-moving.

## [ELIC03] Eltahier et al. (2026) — Automated Software Requirements Elicitation mapping study

**DOI:** https://doi.org/10.3390/info17080777  
**Lane:** `E2 — Recent systematic mapping`  
**Finding:** 74 studies (2021–2025); automation strongest at identification, thins through structuring/consolidation and
stakeholder validation; industrial validation remains limited.  
**Use:** current falsification of end-to-end autonomous elicitation claims.  
**Limitation:** new study; mapping quality depends on included literature and benchmark diversity.

## [REEMP01] Méndez Fernández et al. — Naming the pain in requirements engineering

**DOI:** https://doi.org/10.1007/s10664-016-9451-7  
**Lane:** `E3 — Multi-country empirical survey`  
**Finding:** qualitative analysis from 228 companies across 10 countries identifies recurring practical RE problems.  
**Use:** practitioner reality check and reminder that RE is context-dependent and organizational.  
**Limitation:** survey data and older practice snapshot; not causal evidence for specific methods.

## [AGILE01] Inayat et al. (2015) — Agile RE SLR

**DOI:** https://doi.org/10.1016/j.chb.2014.10.046  
**Lane:** `E2`  
**Finding:** identified 17 agile RE practices, benefits and challenges; evidence gaps remained, including quality
requirements.  
**Use:** reject “agile means no RE” and “user stories cover everything.”  
**Limitation:** evidence through mid-2013.

## [AGILE02] Schön, Thomaschewski & Escalona (2017) — Agile RE SLR

**DOI:** https://doi.org/10.1016/j.csi.2016.08.011  
**Lane:** `E2`  
**Finding:** user stories, prototypes, use cases, scenarios and story cards are recurring artifacts; shared user
understanding remains challenging.  
**Use:** artifact plurality and progressive elaboration.  
**Limitation:** older agile landscape.

## [STORY01] Lucassen et al. (2016) — Quality User Story framework

**DOI:** https://doi.org/10.1007/s00766-016-0250-x  
**Lane:** `E3/E7 — Empirical applied framework`  
**Finding:** evaluated 1,023 stories from 18 companies and identified practical quality defects/tooling opportunities.  
**Use:** story-quality prompts.  
**Limitation:** user-story quality does not establish story sufficiency as full specification.

## [SMELL01] Femmer et al. (2017) — Requirements Smells

**DOI:** https://doi.org/10.1016/j.jss.2016.02.047  
**Lane:** `E3 — Empirical requirements QA`  
**Finding:** lightweight automated smell detection can surface relevant natural-language quality defects.  
**Use:** lint/pre-review support.  
**Limitation:** cannot establish semantic/domain correctness; automated detection remains imperfect.

## [SMELL02] Gervasi et al. (2025) — Practitioners’ perceptions on requirements smells

**DOI:** https://doi.org/10.1016/j.infsof.2025.107823  
**Lane:** `E3 — Industrial mixed-method empirical study`  
**Finding:** interviews plus survey in a safety-critical company found ambiguity and unverifiability perceived as the most
severe smells, with ambiguity and incompleteness among the most frequent; effects vary by smell type and project stage.  
**Use:** prioritize smell review by likely impact rather than treating all lint findings equally.  
**Limitation:** one company/domain; practitioner perception is not a universal causal effect estimate.

## [SMELL03] Frattini et al. (2025) — Bayesian causal analysis of requirements quality

**URL:** https://link.springer.com/article/10.1007/s10664-024-10582-1  
**Lane:** `E3 — Controlled experiment`  
**Finding:** in a 25-participant domain-modeling experiment, passive voice had only minor downstream impact while ambiguous
pronouns produced substantially stronger errors, demonstrating that quality defects can differ materially in effect.  
**Use:** reject equal-severity style/lint dogma and focus on semantic consequence.  
**Limitation:** small controlled task/population; effect sizes must not be generalized to all requirements or downstream tasks.

## [TRACE01] Mäder & Egyed (2015) — Traceability controlled experiment

**DOI:** https://doi.org/10.1007/s10664-014-9314-z  
**Lane:** `E3`  
**Finding:** controlled experiment with 71 subjects on maintenance tasks found traceability-supported subjects performed
faster and produced more correct solutions in that setting.  
**Use:** evidence that traceability can provide real maintenance/change value.  
**Limitation:** scoped task/project setting; does not justify universal maximal traceability.

## [TRACE02] Tian et al. (2021) — Traceability maintenance/evolution mapping study

**DOI:** https://doi.org/10.1002/smr.2374  
**Lane:** `E2`  
**Finding:** 63 studies; change management is a major benefit while establishing/maintaining trace links is a major cost;
stronger industrial evidence is still needed.  
**Use:** purpose-driven/risk-proportionate traceability.  
**Limitation:** evidence through May 2020.

## [TRACE03] Mucha, Kaufmann & Riehle (2024) — Pre-requirements traceability SLR

**DOI:** https://doi.org/10.1007/s00766-023-00412-z  
**Lane:** `E2`  
**Use:** rationale/source/provenance traceability before formal requirement specification.  
**Limitation:** focused research question; not a complete traceability doctrine.

## [TRACE04] Machine-learning approaches for automated software traceability SLR (2025)

**DOI:** https://doi.org/10.1016/j.jss.2025.112536  
**Lane:** `E2`  
**Finding:** automated traceability research is expanding, including LLMs, but real-world data/ground-truth limitations
remain.  
**Use:** AI-assisted trace links require confidence/provenance.  
**Limitation:** fast-moving ML field.

## [PRIO01] Bukhsh, Bukhsh & Daneva (2020) — Requirements prioritization SLR

**DOI:** https://doi.org/10.1016/j.csi.2019.103389  
**Lane:** `E2`  
**Finding:** reviewed 102 studies; techniques have context assumptions; AHP was common/accurate in studied evidence but
scalability remains a major limitation.  
**Use:** reject universal priority method and expose scaling assumptions.  
**Limitation:** evidence through 2019.

## [PRIO02] Yaseen et al. (2025) — Prioritization scalability SLR

**DOI:** https://doi.org/10.1002/smr.70039  
**Lane:** `E2`  
**Finding:** 53 primary studies; little large-scale functional-requirement work and limited real industrial execution.  
**Use:** confidence downgrade for algorithmic priority “best practices.”  
**Limitation:** review scope/method determines included techniques.

## [GOAL01] Horkoff et al. — Goal-oriented RE systematic mapping

**URL:** https://pmc.ncbi.nlm.nih.gov/articles/PMC6555435/  
**Lane:** `E2`  
**Finding:** 246 highly cited publications; goals help model alternatives/conflicts, but literature contains many proposals
and heterogeneous evaluation.  
**Use:** goal modeling as contextual technique.  
**Limitation:** citation-threshold sampling and field heterogeneity.

## [DDD01] Özkan, Babur & van den Brand (2025) — DDD SLR

**DOI:** https://doi.org/10.1016/j.jss.2025.112537  
**Lane:** `E2`  
**Finding:** 36 peer-reviewed studies; DDD shows potential benefits but inconsistent application/evaluation, expertise and
onboarding challenges, and need for more empirical research.  
**Use:** strong contextual—not universal—DDD recommendation.  
**Limitation:** young/heterogeneous evidence base.

## [DOMAIN01] SEI — Feature-Oriented Domain Analysis (FODA)

**URL:** https://www.sei.cmu.edu/library/feature-oriented-domain-analysis-foda-feasibility-study/  
**Lane:** `E4/E5 — Foundational domain-engineering practice`  
**Finding:** domain analysis systematically identifies commonality/variability across related systems.  
**Use:** domain/product-family modeling foundation.  
**Limitation:** 1990 product-line context; methods/tools have evolved.

## [SPL01] ISO/IEC 26550:2015 — Product line engineering reference model

**URL:** https://www.iso.org/standard/69529.html  
**Lane:** `E1`  
**Status:** Current; confirmed 2022.  
**Use:** product-line/domain-engineering scope/reference model.  
**Limitation:** framework; does not prescribe detailed methods/tools.

## [SPL02] ISO/IEC 26551:2016 — Product line requirements engineering

**URL:** https://www.iso.org/standard/69530.html  
**Lane:** `E1`  
**Status:** Current; confirmed 2022.  
**Use:** product-line scoping/domain/application requirements engineering.  
**Limitation:** applies to intentional product-line engineering, not every reused component.

## [SPL03] Chen & Babar (2010) — Product-line RE SLR

**DOI:** https://doi.org/10.1016/j.infsof.2010.03.014  
**Lane:** `E2`  
**Finding:** 49 studies; historical evidence maturity was limited and many approaches relied on toy examples.  
**Use:** caution against product-line method cargo cult.  
**Limitation:** older evidence; use current ISO standards for normative baseline.

## [SYSML01] OMG SysML v2

**URL:** https://www.omg.org/spec/SysML/2.0/  
**Lane:** `E4/E6 — Formal modeling specification`  
**Status:** Version 2.0 formally adopted September 2025; current language specification document `formal/2026-03-02`.  
**Use:** optional model-based specification method.  
**Limitation:** tool/language choice, not universal requirements method.

## [JSON01] JSON Schema Draft 2020-12

**URL:** https://json-schema.org/specification  
**Lane:** `E4/E6`  
**Status:** current published JSON Schema version at cutoff.  
**Use:** machine-readable data structure/validation contracts.  
**Limitation:** cannot encode all product/domain/temporal semantics.

## [OAS01] OpenAPI Specification 3.2.1

**URL:** https://spec.openapis.org/oas/v3.2.1.html  
**Lane:** `E4/E6`  
**Status:** published 10 September 2026.  
**Use:** current example of machine-readable HTTP API specification.  
**Limitation:** API contract format, not complete requirements framework.

## [REAIQA01] — Quality assessment of software requirements using AI methods (2026 SLR)

**DOI:** https://doi.org/10.1016/j.infsof.2025.107979  
**Lane:** `E2 — Systematic literature review`  
**Finding:** AI methods primarily detect requirement-quality issues; coverage across quality criteria is incomplete and few
approaches provide actionable improvements, with fragmentation in terminology, data, and evaluation.  
**Use:** bound automated requirement-quality assessment to triage/decision support rather than semantic authority.  
**Limitation:** rapidly evolving models/tools; review evidence cannot establish current model-specific performance in a local workflow.

## [RE4AI01] Habiba et al. (2024) — RE for AI systems mapping study

**DOI:** https://doi.org/10.1007/s00766-024-00432-3  
**Lane:** `E2`  
**Finding:** 126 primary studies; recurring challenges include specification, explainability, and gap between ML engineers
and end users.  
**Use:** AI-specific requirements overlay.  
**Limitation:** literature captured through July 2023; fast-moving field.

## [AIQUAL01] ISO/IEC 25059:2023 — AI system quality model

**URL:** https://www.iso.org/standard/80655.html  
**Lane:** `E1`  
**Status:** current published Edition 1; expected to be replaced by Edition 2.  
**Use:** AI quality terminology/completeness.  
**Limitation:** successor at FDIS stage; re-check on publication.

## [AIQUAL02] ISO/IEC FDIS 25059 — Edition 2 watch item

**URL:** https://www.iso.org/standard/88234.html  
**Lane:** `E1 — Draft final international standard`  
**Status:** approval stage at cutoff.  
**Use:** watch item only.  
**Limitation:** MUST NOT be represented as final until publication.

## [NISTAI01] NIST AI 200-3 — ARIA Evaluation Planning Manual

**URL:** https://www.nist.gov/publications/aria-evaluation-planning-manual-elements-aria-style-ai-evaluations  
**Lane:** `E4 — Current government AI evaluation guidance`  
**Published:** 18 September 2026.  
**Finding:** holistic AI evaluation combines model testing, red teaming, and user testing.  
**Use:** AI evaluation requirements.  
**Limitation:** new AI-specific guidance; implementation practice will evolve.

## [AGENT01] OWASP Agent Control Standard

**URL:** https://genai.owasp.org/resource/agent-control-standard-acs/  
**Lane:** `E4 — Emerging open agent-control standard`  
**Released:** 1 September 2026.  
**Finding:** emphasizes inspectability, traceability, instrumentation, and runtime policy/control hooks.  
**Use:** agent runtime-control requirements.  
**Limitation:** very new; empirical completeness/effectiveness not established.

---

## [SYS01] ISO/IEC/IEEE 15288:2023 — System life cycle processes

**URL:** https://www.iso.org/standard/81702.html  
**Lane:** `E1 — International standard`  
**Status:** Current published Edition 2.  
**Finding:** system lifecycle processes can be applied iteratively, concurrently, and recursively and do not prescribe one
life-cycle model or method.  
**Use:** system/stakeholder lifecycle context and anti-waterfall interpretation.  
**Limitation:** process framework, not evidence that one elicitation/specification technique is superior.

## [LCM01] ISO/IEC/IEEE 24748-1:2024 — Guidelines for life cycle management

**URL:** https://www.iso.org/standard/84709.html  
**Lane:** `E1 — International standard / guidance`  
**Status:** Current published Edition 2.  
**Finding:** complements 15288/12207 with lifecycle concepts, stages, adaptation and management guidance.  
**Use:** tailoring, progressive elaboration, lifecycle management.  
**Limitation:** guidance must be adapted to project/domain risk.

## [DOC01] ISO/IEC/IEEE 15289:2019 — Content of life-cycle information items

**URL:** https://www.iso.org/standard/74909.html  
**Lane:** `E1 — International standard`  
**Status:** Current published Edition 4, confirmed 2025; status changed to `to be revised` in June 2026 and a replacement is
under development.  
**Finding:** specifies purposes/content of lifecycle information items rather than one mandatory document hierarchy.  
**Use:** controlled artifacts, canonical information, baselines, document status.  
**Limitation:** references older 12207/15288 editions internally and is itself under revision.

## [HCD01] ISO 9241-210:2019 — Human-centred design for interactive systems

**URL:** https://www.iso.org/standard/77520.html  
**Lane:** `E1 — International standard`  
**Status:** Current; reviewed and confirmed in 2025.  
**Finding:** human-centred design principles and activities apply throughout the lifecycle of interactive systems.  
**Use:** stakeholder/user representation, prototypes, validation in use context.  
**Limitation:** interactive-system scope; not a complete requirements standard.

## [INCOSE01] INCOSE Requirements Working Group — Needs and Requirements Manual v2

**URL:** https://www.incose.org/group/requirements-working-group/  
**Lane:** `E4/E5 — Professional systems-engineering consensus guidance`  
**Status:** NRM v2 published December 2024; current RWG product at the cutoff.  
**Finding:** treats needs, requirements, verification and validation as managed lifecycle threads.  
**Use:** NRVV lifecycle architecture and terminology.  
**Limitation:** professional guidance, not controlled causal evidence of one process's superiority.

## [INCOSE02] INCOSE Guide to Writing Requirements v4 / Summary Sheet

**URL:** https://www.incose.org/docs/default-source/working-groups/requirements-wg/guidetowritingrequirements/incose_rwg_gtwr_v4_summary_sheet.pdf  
**Lane:** `E4/E5 — Professional systems-engineering guidance`  
**Status:** v4, updated July 2023; current RWG product reviewed in this audit.  
**Finding:** defines well-formed need/requirement characteristics and distinguishes needs, requirement expressions and sets.  
**Use:** controlled-language quality checks, requirement expression metadata.  
**Limitation:** writing guidance must remain risk/context proportional and does not prove that a well-formed requirement is
semantically the right requirement.

## [INCOSE03] INCOSE RWG — Requirement verification and validation distinction

**URL:** https://www.incose.org/docs/default-source/working-groups/requirements-wg/shared_gtwr/gtwr_characteristics_section_4_050423.pdf  
**Lane:** `E4/E5 — Professional systems-engineering guidance`  
**Finding:** explicitly distinguishes requirement-expression verification/validation from downstream design/system
verification and validation.  
**Use:** V2.2 four-assurance-question model.  
**Limitation:** terminology differs across communities; the playbook defines the terms explicitly rather than assuming
universal vocabulary.

## [REQUAL01] Montgomery et al. (2022) — Empirical research on requirements quality: systematic mapping

**URL:** https://link.springer.com/article/10.1007/s00766-021-00367-z  
**Lane:** `E2 — Systematic mapping study`  
**Finding:** 105 primary studies; requirements-quality research emphasizes improvement techniques and has relatively few
studies providing evidence-based definitions/evaluations of quality attributes.  
**Use:** prevents quality-checklist/score overclaim.  
**Limitation:** maps published evidence; does not invalidate individual quality dimensions.

## [REQUAL02] Olsson, Sentilles & Papatheocharous (2022) — Empirical quality requirements SLR

**URL:** https://link.springer.com/article/10.1007/s00766-022-00373-9  
**Lane:** `E2 — Systematic literature review`  
**Finding:** 84 included studies; no replication studies found; proposed solutions often small-scale/academic and long-term
cost/impact rarely studied.  
**Use:** calibrated confidence for quality-requirements methods.  
**Limitation:** review evidence extends through 2019.

## [STAKE01] Pacheco & Garcia (2012) — Stakeholder identification methods SLR

**URL:** https://doi.org/10.1016/j.jss.2012.04.075  
**Lane:** `E2 — Systematic literature review`  
**Finding:** stakeholder-identification approaches have serious coverage limitations.  
**Use:** systematic stakeholder mapping plus humility about completeness.  
**Limitation:** older evidence base.

## [STAKE02] Bano & Zowghi (2015) — User involvement and system success SLR

**URL:** https://doi.org/10.1016/j.infsof.2014.06.011  
**Lane:** `E2 — Systematic literature review`  
**Finding:** empirical user-involvement/system-success results are not uniformly positive and the relationship is complex.  
**Use:** rejects stakeholder-involvement maximalism.  
**Limitation:** heterogeneous studies and older development contexts.

## [STAKE03] 2026 stakeholder-framework SLR — systems engineering

**URL:** https://doi.org/10.1016/j.procir.2026.05.347  
**Lane:** `E2 — Systematic literature review`  
**Finding:** 34 approaches; no framework satisfactorily covers all stakeholder identification, interaction, integration,
traceability and requirement-definition dimensions.  
**Use:** reinforces fit-for-purpose stakeholder method selection.  
**Limitation:** short Procedia review and emerging evidence.

## [STORY02] Sporsem, Dingsøyr & Stol (2026) — User stories as boundary objects

**URL:** https://doi.org/10.1016/j.jss.2025.112693  
**Lane:** `E2/E3 — Peer-reviewed theoretical literature review`  
**Finding:** review of 14 industry studies frames user stories as boundary objects enabling knowledge transfer/adaptation;
written stories can degrade over time and the evidence base is still limited.  
**Use:** story-as-coordination/index doctrine.  
**Limitation:** theoretical review, not causal meta-analysis.

## [BDD01] Binamungu & Maro (2023) — Behaviour Driven Development systematic mapping

**URL:** https://doi.org/10.1016/j.jss.2023.111749  
**Lane:** `E2 — Systematic mapping study`  
**Finding:** 166 mapped papers; industry insight and metrics remain scarce.  
**Use:** keep BDD/Gherkin contextual.  
**Limitation:** state-of-research map, not proof of effect on delivery outcomes.

## [MBRE01] 2026 — Model-Based Requirements Engineering SLR

**URL:** https://doi.org/10.1016/j.jss.2026.112836  
**Lane:** `E2 — Systematic literature review`  
**Finding:** 109 studies from 2010–2025 across modeling technologies, RE activities, QA and domains; substantial method and
context variation remains.  
**Use:** model/formal-method escalation without notation dogma.  
**Limitation:** review does not establish one universal modeling winner.

## [AIELIC01] Eltahier et al. (2026) — Automated Software Requirements Elicitation systematic mapping

**URL:** https://www.mdpi.com/2078-2489/17/8/777  
**Lane:** `E2 — Systematic mapping study`  
**Finding:** 74 peer-reviewed studies (2021–2025); automation is strongest at candidate identification and becomes much
thinner for structuring, consolidation, and stakeholder validation.  
**Use:** AI candidate-generation boundary and provenance/human-validation requirement.  
**Limitation:** fast-moving model/tool landscape; benchmark/task quality varies.

## [MONAI01] NIST AI 800-4 (2026) — Challenges to monitoring deployed AI systems

**URL:** https://www.nist.gov/publications/challenges-monitoring-deployed-ai-systems-center-ai-standards-and-innovation  
**Lane:** `E4 — Government AI assurance research/guidance`  
**Status:** Published 6 March 2026.  
**Finding:** pre-deployment evaluation cannot capture all real-world behavior; post-deployment monitoring is crucial, while
validated methods/terminology remain nascent.  
**Use:** AI production-monitoring and revalidation requirements.  
**Limitation:** identifies categories/challenges rather than one validated monitoring method.

# 47. Research confidence summary

## HIGH confidence

- requirements must be understood across the lifecycle, not written once;
- intent/context/constraints must precede technology prescription;
- material requirements need verifiability;
- requirement verification, requirement validation, system verification, and system validation are distinct assurance questions;
- quality requirements must be explicit when they affect success;
- method/formality should be proportional to consequence;
- traceability can add value but has real maintenance cost;
- no single elicitation/prioritization/specification format is universally best;
- AI/agent requirements need additional uncertainty, evaluation, authority and monitoring controls.

## MODERATE confidence

- DDD is beneficial in many complex-domain contexts;
- story-quality frameworks improve user-story hygiene;
- automated smell/lint tools can surface candidate defects, but impact differs by smell and context;
- AI-assisted traceability, elicitation, and quality triage can reduce candidate-processing effort in some tasks, but current evidence does not justify autonomous semantic approval.

These remain context/tool dependent.

## EMERGING / WATCH

- mature industrial end-to-end AI requirements automation;
- universal agent-control architectures;
- final Edition 3 of ISO/IEC/IEEE 29148;
- final Edition 2 of ISO/IEC 25059.

---

# 48. Definition of Ready for requirements work

A consequential requirements effort is ready when:

- [ ] decision/problem is known;
- [ ] intended outcome is known;
- [ ] system boundary is at least provisionally defined;
- [ ] criticality is selected;
- [ ] stakeholder/evidence plan exists;
- [ ] authoritative sources are known where applicable;
- [ ] key uncertainties are listed;
- [ ] domain expertise access is sufficient;
- [ ] requirements artifacts/canonical location are chosen;
- [ ] verification/validation depth is selected.

---

# 49. Definition of Done for a requirements baseline

A baseline can be treated as production-ready for its intended risk only when applicable conditions pass.

## Scope

- [ ] Problem/outcome and boundary are explicit.
- [ ] Users/affected stakeholders are represented.
- [ ] Out-of-scope is explicit.
- [ ] Criticality and assurance depth are justified.

## Domain

- [ ] Critical terms are defined/scoped.
- [ ] Rules, states, events, exceptions and invariants are represented where material.
- [ ] Semantic boundaries are understood.
- [ ] Sources of truth/authority are clear.

## Requirements

- [ ] Functional behavior is sufficient for current decision.
- [ ] Material quality requirements are explicit.
- [ ] Negative/adverse behavior is represented.
- [ ] Data/state/interface/lifecycle requirements are included where relevant.
- [ ] Security/privacy/accessibility/safety/operability requirements are included where relevant.
- [ ] Assumptions and dependencies are explicit.
- [ ] Consequential solution constraints have rationale.

## Specification quality

- [ ] Representation fits the property/decision.
- [ ] Material ambiguity is resolved.
- [ ] Units/tolerances/conditions are explicit where needed.
- [ ] Rationale/source is traceable.
- [ ] No false “complete” claim hides material unknowns.

## Requirement verification / validation

- [ ] Material requirement expressions passed the selected writing/structure/consistency checks.
- [ ] Requirements were validated against source needs/parent requirements/authority and intended context.
- [ ] Representative domain/stakeholder challenge completed where it can change the decision.
- [ ] Normal, edge, failure/adverse scenarios considered.
- [ ] Feasibility is acceptable.
- [ ] BLOCKER defects = zero.
- [ ] MAJOR defects = zero or explicitly accepted.

## System verification / validation readiness

- [ ] Material requirements have system-verification method/evidence defined.
- [ ] Acceptance/pass evidence is defined.
- [ ] Intended-use/system-validation question and evidence are defined where consequence warrants.
- [ ] Environment/data assumptions are known.
- [ ] Required independent review is defined.
- [ ] Critical traceability is sufficient.

## Change

- [ ] Owner/version/status/canonical source known.
- [ ] Change-impact path exists.
- [ ] Review triggers exist.
- [ ] Superseded requirements can be retired safely.

## AI/agent

- [ ] Probabilistic behavior/evaluation defined if applicable.
- [ ] Data/model/provider assumptions defined.
- [ ] Human fallback/monitoring defined if material.
- [ ] Agent authority/side effects externally controlled if applicable.

---

# 50. One-page Golden Standard

If only one page is retained:

1. **Start from the real outcome, affected people, environment, constraints, and unacceptable failure—not a proposed
   stack or document template.**
2. **Treat requirements as lifecycle engineering agreements, not a phase or file.**
3. **Separate problem, goal, domain fact, requirement, constraint, assumption, decision, and evidence.**
4. **Define system responsibility and external boundaries explicitly.**
5. **Use evidence sources that fit the question; stakeholder statements are evidence, not infallible truth.**
6. **Triangulate when omission or bias can materially change the decision.**
7. **Model domain language, rules, state, events, exceptions, and invariants when prose is insufficient.**
8. **Use DDD only when semantic/domain complexity earns its cost; never equate bounded context with microservice by
   default.**
9. **Use product-line domain engineering only when systematic commonality/variability across a family is an objective.**
10. **Specify material functional behavior, product quality, quality-in-use/context assumptions, and material failure behavior together.**
11. **Prefer named quality requirements over a residual “NFR” bucket.**
12. **Make material requirements observable or otherwise objectively verifiable.**
13. **Use the least formal representation that is sufficiently precise; increase rigor with consequence and ambiguity
   cost.**
14. **Controlled prose, stories, scenarios, decision tables, state machines, schemas, models, and formal methods are
   complementary tools—not universal winners.**
15. **A user story is not automatically a complete requirement.**
16. **An example is not an invariant; a prototype is not automatically the specification.**
17. **A schema/API contract is valuable executable evidence but may not contain full semantics, rationale, authority, or
   lifecycle behavior.**
18. **Record material rationale, assumptions, dependencies, and change triggers.**
19. **Trace for a real assurance/change/compliance purpose; stale traceability is worse than lean traceability.**
20. **Do not force one requirement to one test; select verification evidence that can actually establish the property.**
21. **Separate four assurance questions: verify the requirement expression, validate it against its source need, verify the realized system against the requirement, and validate the realized system against intended need/use.**
22. **Separate mandatory constraints from preference-based prioritization.**
23. **Use scores only as transparent decision aids; dependencies, uncertainty, and decision rights remain visible.**
24. **Specify state, time, ordering, concurrency, duplicate/retry behavior when they affect correctness.**
25. **Specify security/privacy/accessibility/reliability/performance/operability/recovery/lifecycle properties before
   architecture makes them expensive to change.**
26. **For AI, specify intended use, data, uncertainty, evaluation slices, guardrails, human fallback, model-change
   policy, and production monitoring.**
27. **For agents, model output is not authority; tool access, side effects, limits, approvals, audit, stop, and recovery
   need external enforcement where consequence is material.**
28. **AI can draft and analyze candidate requirements; it does not own stakeholder agreement, risk acceptance, or
   legal/organizational authority.**
29. **Measure requirements work by reduced ambiguity, rework, defect escape, better decisions, and verified outcomes—not
   pages or requirement count.**
30. **A requirements baseline is complete only enough for a defined decision/risk boundary; keep learning and change
   controlled after release.**

---

# 51. Release QA and mechanical audit

A final mechanical audit was executed on the delivered Markdown artifact after the research, falsification, source-status,
and scope passes.

```text
RESULT: PASS

- full V1 candidate principles re-audited: 60 / 60
- separate second-pass assurance record present: yes
- separate third-pass assurance record present: yes
- unresolved authoring placeholder syntax: 0
- Markdown code-fence markers: 106
- Markdown code fences balanced: yes
- numbered major sections present: 52 / 52
- Golden standards present: 100 / 100
- audited source IDs defined: 63
- duplicate source IDs: 0
- unresolved source IDs: 0
- source-status watch items present: yes
- ISO/IEC 25019 quality-in-use baseline present: yes
- IEEE 1012-2024 V&V baseline present: yes
- ISO/IEC/IEEE 24765 current + cancelled Edition 3 project status preserved: yes
- requirements-smell impact heterogeneity explicit: yes
- AI-assisted requirements-quality assessment bounded to triage: yes
- explicit lifecycle status: REVIEWED
- incorrect VALIDATED status: no
- ISO/IEC/IEEE 29148 current-vs-DIS distinction preserved: yes
- ISO/IEC/IEEE 12207 current edition verified as 2026: yes
- ISO/IEC/IEEE 15288 current edition verified as 2023: yes
- ISO/IEC/IEEE 15289 current-but-to-be-revised status preserved: yes
- ISO 9241-210 current/confirmed status preserved: yes
- ISO/IEC 25059 current-vs-FDIS distinction preserved: yes
- SysML 2.0 current formal status preserved: yes
- OpenAPI 3.2.1 current published status preserved: yes
- JSON Schema current 2020-12 status preserved: yes
- AI/agent emerging-source limits preserved: yes
- four-part V&V assurance distinction present: yes
- requirements-quality evidence limitations explicit: yes
- stakeholder-involvement boundary explicit: yes
- decision frameworks present: yes
- anti-patterns present: yes
- checklists present: yes
- templates present: yes
- Definition of Ready / Done present: yes
- one-page Golden Standard present: yes
```

Field validation still remains a real-world gate. A future `TESTED`/`VALIDATED` revision should execute representative
scenarios with at least:

1. an ordinary SaaS/product feature;
2. a stateful/distributed integration;
3. an AI/agent workflow;
4. a C3/C4 or regulated requirement set reviewed by a qualified specialist.

---

# 52. Change log

## 2.2 — 2026-09-27

- Performed a third full V1/V2.1 falsification and freshness audit rather than a confirmatory review.
- Added ISO/IEC 25019:2023 quality-in-use/context-of-use as a missing quality-requirements lens.
- Added IEEE 1012-2024 as the direct V&V process baseline and preserved INCOSE's four assurance questions.
- Added 2025 industrial/experimental requirements-smell evidence; smell checks are now explicitly impact-weighted triage,
  not equal-severity style law.
- Added the 2026 SLR on AI-assisted requirements-quality assessment and strengthened the rule that automated QA is not
  semantic validation.
- Corrected ISO/IEC/IEEE 24765 status: 2017 was confirmed in 2026; Edition 3 CD project cancelled 20 September 2026.
- Clarified canonical truth as one authoritative identity/source of truth with permitted synchronized/generated views.
- Re-ran mechanical source-ID, heading, Golden-standard, code-fence, and placeholder checks.
- Retained lifecycle status `REVIEWED`; field execution remains required before `TESTED`/`VALIDATED`.

## 2.1 — 2026-09-27

- Re-audited all 60 V1 candidate principles plus the complete operating model, artifacts, decision rules, anti-patterns,
  release checklist, and original falsification targets.
- Added a separate `SWE-01-AUDIT-2` assurance record with rule-by-rule disposition.
- Corrected V&V semantics into requirement verification, requirement validation, system verification, and system validation.
- Added current 15288:2023, 24748-1:2024, 15289:2019 revision status, 9241-210:2019 confirmation, INCOSE NRM/GtWR,
  requirements-quality reviews, stakeholder reviews, 2026 user-story/MBRE evidence, BDD mapping, 2026 automated-elicitation
  evidence, and NIST deployed-AI monitoring.
- Removed the implication that formal domain modeling is mandatory for every non-trivial domain.
- Strengthened evidence boundaries for stakeholder involvement, requirement quality, user stories, BDD, prioritization,
  model-based RE, AI elicitation, and AI production monitoring.
- Re-verified SysML 2.0, OpenAPI 3.2.1, and JSON Schema current status.
- Preserved `REVIEWED` rather than claiming unsupported `VALIDATED` or literal 100% correctness.

## 2.0 — 2026-09-27

- Built on `00 — Universal Software & AI Engineering Master Playbook V2.0`.
- Applied `Master Playbook Standard v2.0-RC1` R3/CONTROLLED research and falsification logic.
- Created V1 working draft.
- Performed authority/freshness, empirical, contradiction, domain, traceability, prioritization, AI, and agent sanity
  checks.
- Replaced artifact-centric requirements guidance with question/property-centric specification architecture.
- Downgraded user stories, BDD/Gherkin, DDD, full traceability, prioritization algorithms, and formal methods from
  universal prescriptions to contextual mechanisms.
- Added explicit domain ontology, negative requirements, state/time/order/concurrency, quality scenarios,
  specification-as-code, product-line overlay, AI/agent contracts, uncertainty, traceability purpose, change impact,
  verification matrix, decision frameworks, anti-patterns, checklists, and audited sources.
- Set status to `REVIEWED`; field testing remains required for `TESTED` / `VALIDATED`.
