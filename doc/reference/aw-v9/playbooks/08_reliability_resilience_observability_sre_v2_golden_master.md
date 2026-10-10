# 08 — Reliability, Resilience, Observability & SRE — V2 Golden Master

## Evergreen standard for production reliability, failure engineering, SLOs, overload control, recovery, observability, operability, incidents, and continuous reliability improvement

```yaml
document_id: ENG-08-REL-SRE
title: Reliability, Resilience, Observability & SRE
version: 2.0
release_label: GOLDEN_MASTER
lifecycle_status: REVIEWED
created: 2026-09-27
last_updated: 2026-09-27
last_reviewed: 2026-09-27
evidence_cutoff: 2026-09-27
canonical_language: English
artifact_type: domain_playbook
primary_archetype:
  - operating
  - capability
  - response
  - execution
  - decision
inherits:
  - MPS-001 Master Playbook Standard v2.0-RC1
  - Universal Software & AI Engineering Master Playbook v2.0
research_rigor: R3_CONTROLLED
criticality_model: inherit_C0_to_C4_from_engineering_master
volatility: MODERATE_WITH_FAST_IMPLEMENTATION_SURFACE
review_cadence: 6_months_plus_event_driven
next_scheduled_review: 2027-03-27
review_triggers:
  - material change to parent playbooks
  - material change to Google SRE guidance used here
  - material change to OpenTelemetry stable semantics
  - material change to NIST incident-response guidance
  - material change to major cloud reliability guidance
  - major reliability incident exposing a missing mechanism
  - repeated failure of a control prescribed by this playbook
  - new high-quality evidence that changes a material recommendation
out_of_scope:
  - vendor-specific cloud implementation cookbook
  - detailed application security controls
  - detailed performance optimization
  - detailed database/distributed-consensus design
  - domain-specific safety certification
```

> **Lifecycle status note.** `GOLDEN_MASTER` means this is the canonical V2 content baseline produced after a full research, contradiction, and falsification pass. Under the parent Master Playbook Standard, it remains `REVIEWED` rather than `VALIDATED` because representative non-author field execution and organization-specific operating validation have not yet occurred. A polished document is not field evidence.

---

# Executive synthesis

Production reliability is not “keeping servers up.”

It is the capability of a socio-technical system to **deliver the intended user or business outcome with acceptable correctness, integrity, latency, freshness, availability, durability, and recovery behavior under real operating conditions**—including change, partial failure, overload, dependency failure, operator error, and recovery.

The durable operating chain is:

```text
INTENDED USER OUTCOME
→ CRITICAL FLOW
→ RELIABILITY OBJECTIVE
→ MEASUREMENT / SLI
→ FAILURE MODEL
→ BOUNDED WORK + BLAST RADIUS
→ OBSERVABILITY + ALERTING
→ SAFE CHANGE
→ INCIDENT RESPONSE
→ RECOVERY
→ VERIFIED LEARNING
→ SYSTEM CHANGE
→ RE-VALIDATION
```

The central doctrine is:

> **Protect correctness and critical invariants first; define reliability from user-relevant outcomes; bound work before overload becomes collapse; assume dependencies can become slow, partial, stale, wrong, or unavailable; make failure diagnosable; recover from tested mechanisms rather than paper plans; and require incidents to produce verified system improvement.**

The strongest cross-source findings are:

1. **Reliability is user-relative and outcome-relative.** Component uptime is not sufficient evidence that the critical user flow works.
2. **Reliability is multidimensional.** Availability, correctness, latency, freshness, durability, capacity behavior, recoverability, and operability interact.
3. **SLOs are decision tools, not prestige numbers.** They should protect meaningful outcomes and trigger explicit reliability decisions.
4. **100% is not a sensible default for ordinary availability/latency objectives, but some invariants legitimately tolerate zero violations.**
5. **Error budgets are risk/priority signals, not permission to create failures.**
6. **Failure is a design input.** Slow, partial, stale, duplicated, reordered, overloaded, and gray failure matter as much as clean fail-stop failure.
7. **Overload is a feedback-loop problem.** Unbounded queues, concurrency, retries, and expensive fallback can transform local degradation into systemic collapse.
8. **Retries consume capacity.** They are safe only when failure is plausibly transient, the operation is safe to repeat, and the total deadline/resource budget still makes sense.
9. **Redundancy only helps when failures are sufficiently independent and failover itself works.**
10. **Replication is not backup; backup is not disaster recovery; a DR document is not recovery evidence.**
11. **Recovery objectives are acceptance criteria.** RTO/RPO need demonstrated recovery evidence, not only declared targets.
12. **Observability is a capability to answer questions.** Logs, metrics, traces, profiles, events, and probes are evidence sources, not the goal.
13. **Alerting should protect human attention.** Page only when a timely action is needed.
14. **Change is a major controllable reliability risk.** Small observable changes, progressive exposure, and state-compatible recovery reduce blast radius.
15. **Incident management is coordination as well as debugging.** Roles, command, communication, timeline, and handoff must be designed before the incident.
16. **Postmortems matter only when learning changes the system.** Blamelessness and accountability are compatible.
17. **Reliability testing needs multiple methods.** Load, overload, failover, restore, fault injection, game days, and chaos experiments answer different questions.
18. **Chaos engineering is contextual, not mandatory.** Production chaos requires a reason that lower-risk testing cannot provide.
19. **SRE is an engineering capability, not a mandatory org chart.**
20. **Google/AWS/Azure/GCP practices are operational evidence, not universal topology prescriptions.**
21. **AI/agentic systems inherit ordinary distributed-systems reliability problems and add probabilistic decisions, tool side effects, external model dependencies, and autonomy.**
22. **Local production evidence ultimately matters.** A famous organization’s practice is a hypothesis until it fits the system being operated.

---

# V2 research and falsification verdict

V2 is a material revision of V1, not an editorial pass.

The audit specifically attempted to falsify:

- uptime as the definition of reliability;
- 100% as always wrong;
- request-based SLOs as universal;
- burn-rate alerting as universal;
- four golden signals as complete observability;
- retries as free reliability;
- queues as resilience;
- autoscaling as overload protection;
- circuit breakers as universal;
- fallback as safer;
- redundancy as monotonically beneficial;
- multi-region/active-active as maturity;
- replication as backup;
- successful backups as recovery evidence;
- automated failover as always superior;
- canaries as release safety guarantees;
- rollback as always safest;
- chaos engineering as a universal gold standard;
- a singular “root cause” as a complete incident explanation;
- MTTR as a sufficient incident metric;
- a dedicated SRE team as required;
- Google-specific toil/pager/capacity thresholds as industry laws.

## What survived strongly

**HIGH confidence / broadly durable**

- user-relevant reliability objectives;
- risk-proportionate assurance;
- bounded work and overload control;
- total deadlines and cancellation;
- bounded retry budgets and idempotency;
- explicit failure domains;
- tested backup restoration and DR;
- observable critical flows;
- actionable alerting;
- structured incident command for major incidents;
- postmortem action ownership and closure;
- progressive/recoverable change;
- repeated reliability testing;
- continuous learning from real operation.

## What was downgraded to contextual

- exact SLO windows and targets;
- exact burn-rate thresholds;
- circuit breakers;
- hedged requests;
- multi-region;
- active-active;
- N+1/N+2 capacity formulas;
- feature flags/canaries/blue-green;
- chaos in production;
- dedicated SRE organization;
- Google’s 50% toil cap;
- fixed pager thresholds.

## What V2 newly makes first-class

- gray failure and differential observability;
- common-mode/correlated failure;
- hidden shared dependencies/control planes;
- telemetry data quality and telemetry-pipeline reliability;
- low-traffic/high-value reliability objectives;
- queue age/in-flight work, not queue depth alone;
- recovery bootstrap and failback;
- DR drift;
- recovery evidence packages;
- action-item validation;
- responder human factors;
- AI/agentic operational reliability.

---

# 1. Purpose

This playbook exists to enable teams to answer, repeatedly and defensibly:

> **What must this production system continue to do, what failure can it safely tolerate, how will we detect meaningful degradation, how will we prevent local failure from becoming systemic failure, how will we restore an acceptable state, and what evidence demonstrates that the plan actually works?**

It is a specialist overlay on the Universal Software & AI Engineering Master Playbook.

It deepens the parent requirements for:

- reliability;
- resilience;
- overload control;
- production observability;
- operational readiness;
- recovery;
- incident response;
- post-incident learning.

It does not replace security, quality engineering, distributed systems, performance, data, or safety specialist playbooks.

---

# 2. How to use this playbook

Use four layers.

## Layer 1 — Orientation

Use:

- definitions;
- Golden Reliability Standards;
- domain model;
- criticality/assurance posture.

## Layer 2 — Decision

Use:

- SLO selection rules;
- dependency/retry/queue/redundancy decision frameworks;
- recovery topology decisions;
- page vs ticket;
- rollback vs roll-forward;
- chaos/fault-injection selection.

## Layer 3 — Execution

Use:

- Plays;
- runbooks;
- checklists;
- templates.

## Layer 4 — Assurance and learning

Use:

- evidence map;
- source register;
- falsification findings;
- reliability test evidence;
- incident/postmortem evidence;
- recovery drill records;
- review/change history.

---

# 3. Scope and boundaries

## 3.1 In scope

This playbook applies to:

- internet services and APIs;
- web/mobile/backend systems;
- distributed services;
- stateful applications;
- data-processing pipelines;
- asynchronous workflows;
- queues/streams/workers;
- cloud and hybrid systems;
- internal business-critical software;
- AI/ML/LLM systems;
- tool-using/agentic systems;
- operational control planes;
- supporting infrastructure where application reliability depends on it.

## 3.2 Specialist topics delegated

Detailed prescriptions belong elsewhere for:

- secure design/threat modeling → `06 — Security Engineering`;
- test portfolio and verification science → `05 — Verification, Validation, Testing & Quality Engineering`;
- database consistency/consensus → data/distributed-systems playbooks;
- deep performance tuning → performance/scalability playbook;
- supply-chain/release integrity → CI/CD/supply-chain playbook;
- safety certification → applicable domain overlay;
- privacy → privacy specialist playbook.

This playbook still names those concerns when they constrain reliability.

## 3.3 Applicability

Not every system needs SRE ceremony.

A low-risk single-process internal tool may need:

- backups;
- basic health monitoring;
- owner;
- error handling;
- simple restore instructions.

A global payment service or high-consequence agent may need:

- multiple reliability objectives;
- independent review;
- failure-domain analysis;
- explicit capacity/overload controls;
- resilience tests;
- on-call/incident command;
- DR exercises;
- recovery evidence;
- formal change gates.

Rigor follows consequence, not fashion.

---

# 4. Evidence and normative model

This playbook inherits the parent Master Playbook Standard claim taxonomy.

| Label | Meaning in this playbook |
|---|---|
| `REQ` | externally required in the stated scope |
| `EST` | well-established engineering principle with strong cross-source support |
| `DEF` | recommended default |
| `CTX` | contextual mechanism whose value depends on architecture/workload |
| `EMG` | emerging practice/evidence |
| `HOUSE` | deliberate synthesis used by this playbook |
| `EXP` | experiment/hypothesis to validate |
| `UNK` | unresolved material question |

Evidence provenance follows the engineering master’s lanes:

| Lane | Strong use |
|---|---|
| E1 | formal/international standards |
| E3 | peer-reviewed empirical/foundational research |
| E4 | government/open consensus framework/specification |
| E5 | mature operational evidence |
| E6 | protocol/platform semantics |
| E7 | repeated practitioner pattern |

A strong operational source can demonstrate a mechanism without proving that its exact topology or threshold is universally optimal.

---

# 5. Operational definitions

## 5.1 Reliability

**Reliability** is the degree to which a system consistently performs its intended functions under defined conditions over time.

For production software, the relevant outcome MAY include:

- correctness;
- data integrity;
- availability;
- latency;
- freshness;
- durability;
- successful completion;
- capacity behavior;
- recoverability;
- operability.

Reliability is not identical to any single one of these.

## 5.2 Availability

**Availability** describes whether the intended function can be used when required, under the defined measurement boundary.

Availability can be expressed as:

- successful events / valid events;
- healthy time / valid time;
- completion before deadline / valid jobs;

depending on the system.

## 5.3 Resilience

**Resilience** is the capability to withstand disruption, limit impact, adapt, and recover while preserving prioritized outcomes.

Resilience is not simply redundancy.

## 5.4 Recoverability

**Recoverability** is the capability to restore an acceptable service/state after disruption within agreed objectives.

## 5.5 Durability

**Durability** is the degree to which committed state remains preserved and recoverable as required.

## 5.6 Fault, failure, incident, disaster

**Fault** — a condition that can cause incorrect or degraded behavior.  
**Failure** — the system does not meet a required behavior/objective.  
**Incident** — an event requiring coordinated response because impact or risk crosses the organization’s threshold.  
**Disaster** — a disruption large enough that ordinary component-level resilience is insufficient and a broader recovery strategy is required.

## 5.7 Degraded mode

A known operating mode that intentionally delivers reduced capability while preserving protected invariants.

## 5.8 Failure domain

A boundary within which one fault can plausibly cause correlated failure.

Examples:

- process;
- node;
- rack;
- zone;
- region;
- provider;
- tenant;
- shard;
- worker pool;
- dependency;
- identity/control plane.

## 5.9 Blast radius

The users, transactions, data, tenants, regions, capabilities, or systems that can be affected by one failure/change.

## 5.10 Observability

The capability to answer relevant questions about system behavior using emitted evidence.

## 5.11 Monitoring

The ongoing collection, evaluation, and presentation of selected system signals.

## 5.12 Operability

The capability of humans and automation to safely understand, control, diagnose, change, and restore the system.

## 5.13 SLI, SLO, SLA, error budget

**SLI** — measurement of a relevant behavior.  
**SLO** — target attached to an SLI over a defined scope/window.  
**SLA** — external/contractual service commitment where applicable.  
**Error budget** — tolerated unreliability implied by an SLO and measurement model.

## 5.14 Toil

Repetitive, manual, tactical operational work that is automatable, has little enduring value, and tends to scale with service growth.

## 5.15 Gray failure

A partial/subtle failure where components have different perceptions of whether the system is healthy; traditional health detection may miss real application impact.

---

# 6. Reliability system model

A production reliability system can be reasoned about as:

```text
USER / DEPENDENT SYSTEM
        ↓
CRITICAL FLOW
        ↓
ADMISSION
        ↓
IN-FLIGHT WORK
        ↓
DEPENDENCIES + STATE
        ↓
RESULT / SIDE EFFECT
        ↓
USER-OBSERVED OUTCOME
```

Cross-cutting controls:

```text
RELIABILITY OBJECTIVES
OBSERVABILITY
CAPACITY / OVERLOAD CONTROL
ISOLATION
RECOVERY
CHANGE CONTROL
INCIDENT RESPONSE
LEARNING
```

Failure can enter from:

```text
CHANGE
DEMAND
DEPENDENCY
STATE / DATA
INFRASTRUCTURE
NETWORK
CONTROL PLANE
IDENTITY / CREDENTIAL
TIME / CLOCK
OPERATOR
EXTERNAL PROVIDER
AI MODEL / TOOL
UNKNOWN INTERACTION
```

A strong reliability design does not attempt to prevent every fault.

It aims to:

1. prevent high-consequence faults where practical;
2. detect material failure early;
3. contain blast radius;
4. degrade intentionally;
5. preserve protected invariants;
6. restore acceptable service;
7. verify state after recovery;
8. learn enough to reduce recurrence.

---

# 7. The Golden Reliability Standards

The following are the root rules for this specialist playbook.

## Outcomes and objectives

1. **EST:** Define reliability from intended user/business outcomes, not component uptime.
2. **EST:** Identify critical flows before defining service metrics.
3. **EST:** Protect correctness, data integrity, security, and safety constraints before nominal availability.
4. **EST:** Make material reliability requirements observable enough to verify.
5. **DEF:** Use SLOs or equivalent measurable objectives for material production flows.
6. **CTX:** Use request-based SLOs only when request/event populations are meaningful.
7. **DEF:** Keep SLO sets small enough to drive decisions but broad enough to protect materially different outcomes.
8. **DEF:** Define denominator, good event, bad event, invalid/excluded event, window, and data source for every material SLI.
9. **EST:** Treat measurement/data quality as part of SLO validity.
10. **EST:** Do not default ordinary availability/latency objectives to 100%.
11. **EST:** Do not use an ordinary error budget for security, safety, or known corruption/integrity violations unless an applicable domain standard explicitly defines tolerable risk.
12. **EST:** Error budgets exist to change decisions; a budget that never changes action is reporting, not reliability control.
13. **CTX:** Internal SLOs need not equal external SLAs; design margin from actual risk and contract semantics.
14. **DEF:** Review SLOs when product behavior, user harm, traffic, architecture, or measurement changes materially.

## Failure engineering

15. **EST:** Treat failure as a design input.
16. **EST:** Model slow, partial, stale, wrong, duplicate, reordered, overloaded, and gray failure—not only clean outages.
17. **EST:** Identify common-mode and correlated failures before counting redundancy as protection.
18. **DEF:** Map hidden shared dependencies such as DNS, identity, secrets, certificates, time sources, control planes, quotas, build/release infrastructure, and observability.
19. **EST:** Prefer explicit failure over silent corruption.
20. **DEF:** Define degraded behavior before an incident when degradation is an allowed strategy.
21. **EST:** Degradation MUST preserve protected correctness/security/safety/data-integrity invariants.
22. **DEF:** Make every material fallback either continuously/regularly exercised or explicitly treated as unverified.
23. **CTX:** Prefer equivalent failover or primary-path robustness over rarely executed bimodal fallback when feasible.

## Time, retries, and side effects

24. **EST:** Give remote/resource-consuming work a finite total deadline or cancellation policy.
25. **EST:** Distinguish caller timeout from actual downstream cancellation.
26. **EST:** Retry only plausibly transient failures that remain useful within the total deadline/resource budget.
27. **EST:** Retry mutating operations only when side effects are idempotent, deduplicated, reconciled, or known not to have occurred.
28. **EST:** Assign retry responsibility; independent retry loops across layers MUST be bounded as one system.
29. **EST:** Use backoff and de-correlation/jitter when synchronized retries can amplify failure.
30. **DEF:** Represent “outcome unknown” explicitly when a timeout makes side-effect state ambiguous.
31. **CTX:** Hedged/speculative requests MAY reduce tail latency for safe operations but MUST be capped and suppressed under overload.

## Overload and capacity

32. **EST:** Unbounded queues or concurrency are availability defects when demand can exceed sustainable capacity.
33. **EST:** Define sustainable capacity and overload behavior, not only peak benchmark throughput.
34. **EST:** Bound in-flight work where resource exhaustion can cascade.
35. **EST:** Bound queues and define what happens at the bound.
36. **EST:** Queue age/wait time SHOULD be monitored where it better represents user harm than queue depth.
37. **EST:** Queueing absorbs finite bursts; it does not solve sustained demand above service capacity.
38. **DEF:** Apply admission control before expensive work where rejection is safer than saturation.
39. **DEF:** Use load shedding/degradation before uncontrolled collapse where domain semantics permit it.
40. **EST:** Do not silently drop durable, financial, safety, or otherwise mandatory work to preserve uptime.
41. **DEF:** Define priority/fairness where one tenant/work class could starve others.
42. **CTX:** Autoscaling is a capacity mechanism, not a substitute for overload protection.
43. **EST:** Suppress or constrain retries during overload when retries would worsen saturation.
44. **DEF:** Load-test the overload failure mode, not only happy-path throughput.
45. **EST:** Account for failed/degraded capacity when setting capacity headroom; no fixed N+1/N+2 formula is universal.

## Isolation and redundancy

46. **EST:** Define material failure domains and desired containment boundaries.
47. **EST:** Redundancy only counts as reliability protection when failure independence, capacity, state semantics, detection, and failover are credible.
48. **CTX:** Use bulkheads/cells/per-tenant pools when shared resource exhaustion creates unacceptable blast radius.
49. **CTX:** Use circuit breakers when repeated calls to a failing dependency materially amplify harm; do not add them mechanically.
50. **CTX:** Multi-zone/multi-region/provider diversity MUST be justified by objectives and correlated-failure analysis.
51. **CTX:** Active-active is not inherently more reliable than active-passive.
52. **EST:** Failover capacity MUST meet the load required by the recovery objective, including degraded-mode assumptions.
53. **DEF:** Test failover and failback; failback is a separate risk event.

## Data, backup, and recovery

54. **EST:** Replication is not backup when corruption/deletion can propagate.
55. **EST:** A successful backup job is not evidence of recoverability.
56. **EST:** Periodically restore backups and validate application/data invariants.
57. **DEF:** Define RTO/RPO where downtime or data loss is material.
58. **EST:** RTO/RPO are acceptance criteria and SHOULD be measured in drills.
59. **EST:** Recovery design MUST include data, configuration, identity, secrets/keys, network/DNS, dependencies, and operator access needed to bootstrap.
60. **DEF:** Identify recovery ordering and dependency cycles.
61. **DEF:** Detect and control configuration/data drift in recovery environments.
62. **EST:** Define who has authority to declare recovery complete.
63. **EST:** Validate restored state before reopening normal writes/traffic.
64. **CTX:** Automate deterministic, tested recovery steps; preserve human control where state is ambiguous or consequence high.

## Observability and alerting

65. **EST:** Start observability design from questions and decisions.
66. **EST:** Treat logs, metrics, traces, profiles, events, probes, and audit records as telemetry—not observability by themselves.
67. **DEF:** For online services, latency, traffic, errors, and saturation are a strong baseline, then add domain signals.
68. **EST:** Critical flows SHOULD have end-to-end/black-box evidence in addition to component health where practical.
69. **EST:** Monitor telemetry pipeline/data quality sufficiently to distinguish “healthy” from “blind.”
70. **DEF:** Correlate material deployments/config/model changes with operational telemetry.
71. **DEF:** Use structured, stable-enough telemetry semantics for critical dashboards/alerts.
72. **EST:** Bound telemetry cardinality, volume, retention, privacy exposure, and cost.
73. **EST:** Every page SHOULD correspond to a timely human action or escalation.
74. **DEF:** Separate page, ticket, and retained-log response classes.
75. **CTX:** Multiwindow multi-burn-rate alerting is a strong default for sufficiently high-volume SLOs, not for every workload.
76. **EST:** Low-traffic and single high-value flows need consequence-aware alerting beyond aggregate burn rate.
77. **DEF:** Alerts SHOULD link to ownership, impact context, first diagnostic steps, and relevant runbook.
78. **EST:** Alert fatigue is a reliability defect because it degrades detection/response capability.

## Change reliability

79. **EST:** Treat code, config, schema, policy, data, model, and infrastructure changes as potential production changes.
80. **DEF:** Keep changes as small and coherent as practical.
81. **EST:** Make material changes observable after release.
82. **DEF:** Separate deploy from exposure/release where it materially reduces risk.
83. **CTX:** Use canaries/progressive exposure when representative production evidence can reduce blast radius.
84. **EST:** State canary isolation assumptions; shared dependencies/global state can invalidate the control.
85. **EST:** Define stop criteria before progressive rollout.
86. **EST:** A rollback plan is valid only when current state/schema/external side effects remain backward-compatible.
87. **DEF:** Use roll-forward when rollback would recreate corruption or violate state compatibility.
88. **DEF:** Give feature flags/temporary bypasses owners and expiry/cleanup triggers.
89. **EST:** High-irreversibility change requires stronger pre-release assurance.

## Incidents and learning

90. **EST:** Define incident severity from consequence, not emotional intensity.
91. **DEF:** Declare major incidents early rather than waiting for complete diagnosis.
92. **EST:** During active impact, prioritize containment and safe restoration before exhaustive causal analysis.
93. **EST:** Major incidents need explicit coordination, command, communication, and timeline ownership.
94. **DEF:** Preserve current facts, uncertainty, decisions, and actions in an incident record.
95. **EST:** Design incident handoff; long incidents exceed one person’s sustainable cognitive window.
96. **EST:** Blameless analysis and remediation accountability are compatible.
97. **EST:** Do not force one root cause when interacting contributing conditions explain the incident better.
98. **EST:** Postmortem actions SHOULD be specific, owned, prioritized, tracked, and verifiably closed.
99. **DEF:** Track repeated incident classes; recurrence indicates learning/control failure.
100. **EST:** Incident learning is complete only when relevant system/process/training/tooling changes are implemented or risk is explicitly accepted.

## SRE capability and human factors

101. **EST:** SRE is an engineering capability; a dedicated SRE team is optional.
102. **EST:** Product/development ownership of reliability cannot be outsourced completely to operations.
103. **DEF:** Measure toil and engineer down recurring manual work that scales with the service.
104. **CTX:** Google’s 50% toil cap is an example, not a universal requirement.
105. **EST:** On-call must be staffed and designed so responders can make high-quality decisions.
106. **DEF:** Monitor pager load, escalation load, sleep/shift impact, follow-up time, and team health.
107. **CTX:** No universal page-per-shift or shift-length number applies across organizations/jurisdictions.
108. **EST:** Runbooks, training, drills, and escalation paths are separate controls from operator competence; one does not replace the other.

## Reliability testing

109. **EST:** Test failure and recovery paths, not only steady-state success.
110. **EST:** Combine methods according to failure mode: load, overload, restore, failover, fault injection, game day, and incident exercise.
111. **DEF:** Reliability tests SHOULD use SLO/RTO/RPO or other explicit outcomes as pass/fail criteria.
112. **DEF:** Begin fault injection at the lowest-risk environment that can answer the question.
113. **CTX:** Production chaos requires a hypothesis, containment, abort conditions, observability, ownership, and a reason production evidence is necessary.
114. **EST:** Random disruption without a decision-driving hypothesis is not strong reliability engineering.
115. **DEF:** Re-run material resilience/recovery tests after architecture, dependency, data, or recovery-path changes.

## AI / agentic operations

116. **EST:** Treat model/provider/tool dependencies as ordinary failure dependencies plus probabilistic behavior.
117. **EST:** Bound tool-call retries, concurrency, loops, time, and cost.
118. **EST:** External side effects from agents need idempotency/reconciliation exactly as human-written workflows do.
119. **DEF:** Instrument model/tool/version, latency, failure category, token/cost pressure, fallback/routing, and side-effect outcome when material.
120. **EST:** Agent stop/revoke/kill paths MUST work without model cooperation for material capability.
121. **DEF:** Define degraded/manual fallback for agent-dependent critical workflows where continued operation matters.
122. **EST:** Human approval does not repair an unobservable or non-recoverable agent workflow; ordinary reliability controls remain required.

---

# 8. Criticality and reliability assurance

This playbook inherits C0–C4 criticality from the engineering master.

| Criticality | Reliability posture |
|---|---|
| C0 Experimental | explicit non-production status; basic owner/logging; no implied SLO |
| C1 Ordinary | basic objectives, monitoring, backups, change/recovery discipline |
| C2 Material | explicit critical flows, SLOs/equivalent, overload controls, restore test, incident ownership, staged change |
| C3 High assurance | independent reliability review, deeper failure analysis, DR drills, fault isolation, resilience tests, recovery evidence |
| C4 Safety/mission critical | specialist domain standard governs; formal hazard/assurance methods may supersede ordinary SRE practices |

## 8.1 Escalation dimensions

Increase reliability assurance with:

- human/safety consequence;
- security/privacy consequence;
- financial consequence;
- data irreversibility;
- business dependency;
- affected users;
- blast radius;
- low detectability;
- slow recovery;
- novelty;
- external dependency concentration;
- autonomous agent capability;
- regulatory/contractual requirement.

## 8.2 Reliability assurance principle

```text
REQUIRED RELIABILITY ASSURANCE
increases with
CONSEQUENCE × EXPOSURE × IRREVERSIBILITY × UNCERTAINTY × BLAST RADIUS
and decreases only when
DETECTABILITY × CONTAINMENT × RECOVERABILITY
are demonstrated, not assumed.
```

This is a decision model, not literal arithmetic.

---

# 9. Critical-flow model

Reliability should be reasoned about through critical flows.

Examples:

- sign in;
- checkout;
- place payment;
- receive booking confirmation;
- persist document;
- process payroll batch;
- deliver message;
- complete AI agent action;
- restore account;
- reconcile financial ledger.

For each critical flow record:

```yaml
flow_id:
name:
user_or_consumer:
business_outcome:
entry_point:
completion_condition:
protected_invariants:
dependencies:
state_mutated:
latency_or_deadline:
failure_consequence:
degraded_mode:
slo_or_equivalent:
recovery_objective:
owner:
```

## 9.1 Flow classes

A practical `HOUSE` classification:

- **P0 — invariant critical:** corruption/security/safety violation is unacceptable;
- **P1 — mission critical:** sustained failure creates major user/business impact;
- **P2 — important:** degradation is tolerable for a bounded period;
- **P3 — best effort:** may be delayed/omitted under pressure.

The labels are house terminology. The principle—different work has different consequence—is external and durable.

## 9.2 Protect the core

When overload or failure occurs, systems SHOULD have an intentional answer to:

> Which capability must keep working, which may degrade, which may queue, and which may be rejected?

Do not discover priority during the outage.


---

# 10. SLI, SLO and error-budget engineering

An SLO is a reliability decision expressed through a measurable user- or consumer-relevant signal. It is not a decorative uptime target.

## 10.1 Design sequence

Use this order:

```text
CRITICAL USER / CONSUMER OUTCOME
→ FAILURE MODE
→ MEASURABLE SLI
→ VALID MEASUREMENT POPULATION
→ TARGET / SLO
→ WINDOW
→ ERROR BUDGET
→ DECISION POLICY
→ ALERT / REVIEW SIGNAL
→ ITERATION
```

Do not start by choosing “three nines.”

## 10.2 SLI types

Common SLI families include:

### Request / event success

```text
successful eligible events
────────────────────────────
all eligible events
```

Useful for API requests, transactions, task executions, deliveries, jobs, and workflow steps.

### Latency

```text
eligible events completed within threshold
───────────────────────────────────────────
all eligible events
```

This often behaves better as an SLO than an average latency target because it preserves user-relevant tail behavior.

### Availability

A special form of success measurement where the relevant capability is usable when expected.

### Freshness

Examples:

- age of newest processed event;
- data lag behind source;
- time since last successful model/index refresh;
- time from event creation to materialization.

### Durability / data integrity

Examples:

- acknowledged writes retained;
- reconciled records match invariant;
- no unrecoverable corruption;
- backup restore produces verified state.

### Batch / asynchronous completion

Examples:

- payroll completes before deadline;
- invoice export completes by business cutoff;
- queue item completes within bounded age;
- agent workflow reaches verified terminal state within policy.

### Quality / correctness

Some systems need SLIs that measure *correct result*, not merely response status. Examples:

- price calculation reconciles;
- authorization outcome is valid;
- document transformation passes semantic validation;
- AI action meets a deterministic postcondition.

## 10.3 Choose the denominator carefully

The denominator defines what promise is being measured.

Document:

```yaml
sli_name:
good_event:
valid_event_population:
excluded_events:
measurement_source:
aggregation:
segments:
window:
known_bias:
data_quality_checks:
owner:
```

Potential denominator defects include:

- excluding the hardest users or regions;
- silently excluding timeouts;
- measuring only requests that reach an internal component;
- counting retries as independent successes/failures without intent;
- including synthetic traffic in a user SLO without distinction;
- excluding incidents through broad “maintenance” labels;
- measuring a backend dependency while claiming a user journey SLO.

## 10.4 Measurement point

Prefer measurement as close to the consumer-observed outcome as practical.

Possible layers:

```text
CLIENT / EXTERNAL PROBE
↓
EDGE / LOAD BALANCER
↓
SERVICE
↓
DEPENDENCY
↓
DATA STORE
```

A server-side metric can be precise and still miss DNS, CDN, client, auth, routing or network failures.

Use multiple measurement points when a single source cannot answer both:

- “Are users succeeding?”
- “Where is the failure?”

## 10.5 Tail latency

Average latency can hide severe minority experience.

Use, as appropriate:

- threshold-based good-event ratios;
- p50 for typical behavior;
- p95/p99/p99.9 for tail;
- max only when it has decision value;
- distribution/histogram analysis.

Tail thresholds SHOULD be tied to a user or system deadline rather than selected because a percentile is fashionable.

## 10.6 Segmentation

Global aggregation can hide localized failure.

Segment when materially relevant by:

- region / zone;
- tenant / customer tier;
- endpoint / operation;
- dependency;
- application version;
- platform/device;
- workflow type;
- model/provider/version;
- priority class.

Avoid unlimited dimensions. High-cardinality telemetry can create cost and operational risk.

## 10.7 SLO target selection

Select a target from:

1. consequence of failure;
2. user expectation / contractual need;
3. dependency envelope;
4. feasible architecture;
5. historical baseline;
6. cost of improvement;
7. change velocity / innovation need;
8. recovery capability;
9. measurement uncertainty.

A target MAY initially be provisional when no trustworthy baseline exists. Label it and revisit after measurement.

## 10.8 100% targets

`CTX — HIGH confidence`

100% is usually a poor default for ordinary online services because:

- measurement itself can be imperfect;
- dependencies and user networks fail;
- a zero-error objective can produce disproportionate cost;
- it removes a useful budget for managed change.

Exceptions exist where a particular **invariant** must be absolute. Examples:

- unauthorized payment MUST NOT be treated as acceptable error-budget consumption;
- known corrupt ledger output MUST NOT be served to preserve availability;
- safety constraints may require near-zero or zero tolerated violation under an applicable domain standard.

Distinguish:

```text
SERVICE RELIABILITY SLO
from
PROTECTED INVARIANT / SAFETY / SECURITY REQUIREMENT
```

## 10.9 Error budget

For a simple event-based SLO:

```text
allowed_bad_fraction = 1 - SLO_target
error_budget_events = eligible_events × allowed_bad_fraction
```

For a time-based approximation:

```text
allowed_unreliable_time = window_duration × (1 - SLO_target)
```

Use time-based math only when the SLI genuinely represents time availability.

## 10.10 Burn rate

A useful normalized definition:

```text
burn_rate
=
observed_bad_fraction
─────────────────────
allowed_bad_fraction
```

Interpretation:

- `1×` consumes the budget at the planned long-run rate;
- `>1×` consumes it faster;
- `<1×` consumes it slower.

If a burn rate `B` were sustained, a rough time-to-exhaustion is:

```text
budget_window / B
```

This is a decision aid, not a prediction; traffic and failure rates change.

## 10.11 Multi-window burn-rate alerts

`CTX — strong pattern, not universal constants`

Google SRE documents multi-window, multi-burn-rate alerting to combine fast detection with lower false-positive rate. For a 99.9% SLO, Google's worked example includes combinations such as:

- page around `14.4×` burn over `1h`, confirmed by a short window;
- page around `6×` over `6h`, confirmed by a shorter window;
- lower urgency around `1×` over multi-day windows.

These values are **examples derived from a specific policy shape**, not universal thresholds. Recalculate from:

- SLO;
- budget window;
- incident consequence;
- desired detection time;
- traffic volume;
- paging burden.

Low-volume services may need different techniques because ratios can become noisy or a single failure can dominate.

## 10.12 Error-budget policy

An error budget becomes useful only when it changes decisions.

A policy SHOULD define:

```yaml
scope:
slo:
window:
budget_source_of_truth:
normal_posture:
warning_posture:
exhausted_posture:
security_safety_integrity_exclusions:
change_controls:
reliability_work_trigger:
exception_authority:
reset_or_recovery_logic:
owner:
review_cadence:
```

Possible responses to fast budget burn:

- slow or pause risky releases;
- prioritize remediation;
- narrow rollout;
- disable unstable optional features;
- add temporary safeguards;
- require higher review;
- invoke incident response.

Do not make “budget exhausted → freeze all change” universal. Some changes are the reliability fix.

## 10.13 SLA vs SLO

An SLA is an external or contractual commitment. An SLO is an operational target.

Usually:

```text
INTERNAL RELIABILITY TARGET
should provide sufficient margin for
EXTERNAL COMMITMENT
```

The margin depends on measurement, consequence, recovery and contract—not a fixed percentage.

## 10.14 Composite journeys

For a user journey containing multiple steps, measure the end-to-end outcome where possible.

Do not blindly multiply component availability to derive user reliability unless:

- the topology is serial in the relevant way;
- failures are sufficiently independent;
- all components use compatible definitions/windows;
- retries/fallbacks do not change the path;
- shared dependencies are accounted for.

Correlated failure invalidates naive multiplication.

## 10.15 SLO quality review

Reject or revise an SLO when:

- the metric can be green while users fail materially;
- the denominator is manipulable;
- exclusions erase real incidents;
- the source is unreliable during outages;
- no owner exists;
- no decision changes when the target is missed;
- it measures a component with no causal link to the claimed outcome;
- it encourages violation of protected invariants;
- the target is copied from another company without consequence analysis.

---

# 11. Failure engineering

Failure engineering makes assumptions and failure behavior explicit before production discovers them.

## 11.1 Failure-mode dimensions

For each material component/dependency, consider:

### Omission
- unavailable;
- request dropped;
- event missing;
- job never scheduled.

### Timing
- slow;
- deadline exceeded;
- stalled;
- delayed queue;
- clock skew;
- timeout without cancellation.

### Value
- malformed response;
- stale response;
- partial response;
- semantically wrong result;
- corrupt state.

### Multiplicity / order
- duplicate;
- out of order;
- replayed;
- concurrent execution;
- split-brain / conflicting writers.

### Capacity
- CPU/memory exhausted;
- connection/thread pool exhausted;
- storage full;
- quota/rate limit exhausted;
- queue saturation;
- model/token/provider quota exhausted.

### Control plane
- config cannot update;
- deployment system unavailable;
- identity/secret service unavailable;
- feature flag/control plane unreachable.

### Dependency / network
- partition;
- DNS failure;
- packet loss;
- regional/provider degradation;
- certificate expiry;
- upstream API schema/behavior drift.

### Operator / automation
- wrong command;
- stale runbook;
- repair script races;
- automation loops;
- concurrent recovery actions;
- privileged agent repeats action.

## 11.2 Failure-mode record

```yaml
failure_mode_id:
asset_or_flow:
assumption:
failure:
trigger:
user_effect:
invariant_risk:
detection:
containment:
degraded_behavior:
recovery:
maximum_tolerable_duration:
test_method:
owner:
residual_risk:
```

## 11.3 Gray failures

A gray failure occurs when system participants disagree about whether a component is healthy.

Examples:

- health check succeeds while real traffic fails;
- one region can reach a service but another cannot;
- control plane reports healthy while data plane stalls;
- provider status is green while a subset of tenants fails;
- AI model endpoint returns 200 responses with unusable content.

Controls MAY include:

- independent black-box probes;
- multiple vantage points;
- real-work probes;
- dependency-specific semantic checks;
- quorum/cross-view reasoning where appropriate;
- operator-visible uncertainty.

Do not equate “health endpoint returns 200” with service health.

## 11.4 Common-mode failure

Redundant components do not create independent reliability when they share:

- one region;
- one identity provider;
- one DNS path;
- one database;
- one certificate authority;
- one deployment/config pipeline;
- one software bug;
- one feature flag;
- one cloud account/project;
- one operator credential;
- one model/provider;
- one network edge;
- one unsafe automation.

Map shared fate explicitly.

## 11.5 Partial failure

Distributed workflows SHOULD define what happens when only part succeeds.

Patterns include:

- transaction where one atomic boundary exists;
- idempotent compensation;
- saga/state machine;
- durable work queue;
- reconciliation;
- explicit `PARTIAL` / `NEEDS_REPAIR` state;
- operator repair flow.

Never hide partial completion behind a generic “failed” response if side effects may already exist.

## 11.6 Recovery races

Recovery logic is production logic.

Ask:

- Can two operators run recovery simultaneously?
- Can an automation and human both repair?
- Is a retry running while rollback runs?
- Can failover happen twice?
- Is restore writing into a live writer?
- Can replay duplicate external side effects?

Use locks, leases, idempotency, fencing, version checks or explicit state transitions when concurrency is material.

---

# 12. Deadlines, timeouts, cancellation and retries

## 12.1 End-to-end deadline first

Start from the consumer deadline.

```text
END-TO-END DEADLINE
=
client/network
+ service processing
+ downstream calls
+ queueing
+ retry allowance
+ safety margin
```

A downstream timeout chosen independently can consume the entire upstream budget.

## 12.2 Timeout design

A timeout SHOULD consider:

- downstream latency distribution;
- connection establishment separately where relevant;
- normal cold-start behavior;
- consequence of false timeout;
- downstream resource cost after caller abandons;
- retry policy;
- total user deadline;
- overload behavior.

A timeout that does not cancel downstream work may reduce caller latency while increasing system saturation.

## 12.3 Cancellation

Propagate cancellation or deadline context when supported and safe.

Cancellation semantics MUST define:

- what work actually stops;
- what side effects can already exist;
- whether cleanup is required;
- whether later completion is visible;
- whether retry is allowed.

## 12.4 Retry eligibility

Retry only when all applicable conditions hold:

- failure is plausibly transient;
- operation is safe to repeat or deduplicated;
- total deadline remains;
- resource/retry budget remains;
- overload policy allows it;
- repeated external side effects are controlled.

## 12.5 Retry placement

Prefer one deliberate retry owner for a call chain when practical.

Document:

```yaml
operation:
retry_owner:
retryable_errors:
non_retryable_errors:
max_attempts:
max_elapsed_time:
backoff:
jitter:
idempotency:
rate_limit_interaction:
overload_disable_condition:
telemetry:
```

Nested retries can amplify load multiplicatively.

## 12.6 Backoff and jitter

Use exponential or otherwise increasing backoff when immediate retry is likely to encounter the same condition.

Use jitter when many clients may synchronize.

Backoff is not a substitute for:

- admission control;
- rate limiting;
- fixing capacity;
- dependency recovery;
- a total retry budget.

## 12.7 Idempotency

Design the business effect, not only the HTTP method, to tolerate repeat delivery where necessary.

Mechanisms:

- idempotency keys;
- unique business transaction IDs;
- conditional writes;
- state-machine transition guards;
- deduplication window/store;
- outbox/inbox;
- replay-safe event consumers.

Define idempotency lifetime and scope.

## 12.8 Retry storms

Detect:

- attempts per original operation;
- retry rate vs primary rate;
- downstream QPS amplification;
- repeated same-error attempts;
- retry queue growth.

During overload, reducing retries can improve successful throughput.

## 12.9 Hedging

`CTX`

Hedged requests can reduce tail latency by issuing duplicate work when a request is unusually slow.

Use only when:

- operation is safe to duplicate;
- dependency capacity can tolerate extra work;
- tail latency is a material outcome;
- cancellation of losing requests works where possible;
- cost is measured.

Do not hedge writes or expensive work casually.

## 12.10 Fallback

`CTX`

Fallback can help when it produces a known acceptable degraded result.

Fallback can harm when:

- path is untested;
- it hides a serious dependency problem;
- it weakens authorization/security;
- it uses stale/inconsistent data beyond tolerance;
- it activates only during peak load and adds more load;
- operators cannot tell fallback is active.

Every material fallback SHOULD have:

```yaml
trigger:
allowed_output:
forbidden_invariants:
maximum_duration:
capacity:
telemetry:
test:
exit_condition:
```

---

# 13. Overload, capacity, backpressure and load shedding

## 13.1 Overload is a correctness concern

When demand exceeds sustainable capacity, a system without an explicit overload policy eventually adopts an accidental one:

- huge latency;
- memory exhaustion;
- thread/connection starvation;
- timeout storms;
- retry amplification;
- widespread health-check failure;
- process crash;
- cascading dependency failure.

## 13.2 Capacity model

For a material service define:

```yaml
workload:
normal_rate:
peak_rate:
burst_shape:
request_cost_distribution:
concurrency:
service_time_distribution:
critical_resource:
safe_utilization_range:
hard_limit:
dependency_quotas:
autoscaling_signal:
autoscaling_delay:
queue_bound:
shedding_threshold:
priority_classes:
test_evidence:
```

## 13.3 Little's Law

For a stable system under appropriate assumptions:

```text
L = λW
```

where:

- `L` = average number of items in the system;
- `λ` = long-run average arrival/throughput rate;
- `W` = average time in system.

Use it as a reasoning tool, not a universal instantaneous law. Stationarity/stability assumptions matter.

Practical implication:

> Higher latency at the same arrival rate increases in-flight work, which consumes resources and can create positive feedback.

## 13.4 Bound concurrency

Concurrency limits protect scarce resources.

Possible scopes:

- process;
- endpoint;
- dependency;
- tenant;
- priority class;
- expensive operation;
- agent/tool executor.

Select the limit from measured saturation and queue behavior, not arbitrary round numbers.

## 13.5 Bound queues

A queue needs:

- purpose;
- maximum size;
- maximum age;
- admission/rejection behavior;
- priority/fairness rule;
- poison-message handling;
- retry/dead-letter semantics;
- capacity/consumer scaling;
- telemetry.

A longer queue is not additional capacity.

## 13.6 Backpressure

Backpressure communicates that downstream cannot safely accept work at the current rate.

Mechanisms include:

- bounded channel/queue;
- 429/503 with policy;
- flow control;
- pull-based consumption;
- token bucket/leaky bucket;
- concurrency semaphore;
- producer pause;
- broker limits.

Backpressure should propagate far enough to prevent hidden accumulation.

## 13.7 Load shedding

Reject or degrade work before total saturation when the domain permits.

Order of preference often follows business criticality:

```text
PROTECT P0/P1
→ reduce optional expensive work
→ reject best-effort work
→ reject lower priority new work
→ preserve bounded recovery capacity
```

Load shedding MUST NOT:

- bypass authentication;
- weaken authorization;
- skip financial integrity checks;
- serve known corrupt state;
- violate safety constraints.

## 13.8 Admission control

Admission control decides whether work may enter the constrained resource domain.

Use:

- concurrency budgets;
- rate limits;
- quotas;
- resource tokens;
- per-tenant budgets;
- cost-aware admission for expensive workloads.

Rate limiting controls arrival rate; concurrency limiting controls simultaneous in-flight work. They solve different problems.

## 13.9 Fairness and noisy neighbors

Shared systems SHOULD decide whether one tenant/workload may consume all capacity.

Mechanisms:

- per-tenant quotas;
- weighted fair queues;
- reservations;
- priority classes;
- isolation pools;
- cost accounting.

Fairness policy is a product/business decision as well as an engineering decision.

## 13.10 Autoscaling

Autoscaling is a capacity response, not an overload policy by itself.

It can fail because:

- startup is slower than overload growth;
- scaling signal lags;
- dependency quota cannot scale;
- database is bottleneck;
- new instances trigger cold-start work;
- cost limit is reached;
- regional capacity is unavailable.

Always define pre-autoscale containment.

## 13.11 Capacity headroom

No universal “N+2” or fixed CPU percentage applies.

Headroom depends on:

- scaling latency;
- failure tolerance;
- traffic volatility;
- dependency limits;
- failover demand;
- maintenance/upgrade needs;
- cost;
- workload tail;
- recovery reserve.

## 13.12 Overload test

Test beyond nominal load to observe:

1. first saturation signal;
2. queue growth;
3. latency curve;
4. error behavior;
5. retry amplification;
6. shedding/admission activation;
7. recovery after load drops.

Pass criteria are about **controlled degradation and recovery**, not only maximum throughput.

---

# 14. Isolation, redundancy and failure domains

## 14.1 Isolation goal

Isolation prevents one failure domain from consuming or corrupting unrelated capacity/state.

Options:

- worker pools;
- bulkheads;
- tenant partitions;
- cell architecture;
- account/project separation;
- separate queues;
- per-region data/service partitions;
- critical vs best-effort resource pools.

Isolation adds cost and operational complexity; use it where shared fate is material.

## 14.2 Circuit breaker

`CTX`

A circuit breaker MAY prevent repeated calls to a failing dependency and allow recovery.

Use when:

- failure is persistent enough that repeated calls cause material harm;
- open/half-open behavior is understandable;
- fallback/failure path is safe;
- breaker state can be observed;
- parameters are tested.

Do not add circuit breakers mechanically. They create state and can cause synchronized recovery or false isolation.

## 14.3 Redundancy

Redundancy only improves reliability when redundant paths do not fail for the same cause.

Evaluate:

```yaml
component:
duplicate_paths:
shared_dependencies:
shared_control_plane:
shared_deployment:
shared_credentials:
shared_data:
shared_bug_surface:
failover_detection:
failover_time:
capacity_after_failover:
state_consistency:
test_evidence:
```

## 14.4 Multi-zone / multi-region

`CTX`

Use only when the required failure domain justifies:

- replicated state complexity;
- consistency trade-offs;
- higher cost;
- failover control;
- network partition behavior;
- operational burden.

A multi-region system with one shared identity/control/config/data dependency can still have one effective failure domain.

## 14.5 Active-active

Active-active can reduce switchover time but introduces difficult questions:

- concurrent writes;
- conflict resolution;
- replication lag;
- global uniqueness;
- split brain;
- capacity balance;
- routing convergence;
- failback.

Do not choose active-active because it sounds more resilient.

## 14.6 Cell-based architecture

`CTX`

Cells can bound blast radius by partitioning users/workloads into semi-independent stacks.

Consider when:

- one global failure would be unacceptable;
- workload can be partitioned;
- operational automation supports many cells;
- cross-cell dependencies are minimized;
- routing/placement is reliable.

Cells trade global simplicity for containment.

---

# 15. Recovery, backups and disaster recovery

Recovery engineering SHOULD align ICT restoration with the business continuity outcome it protects. For higher-impact continuity programs, ISO/IEC 27031:2025 provides a current ICT-readiness reference and ISO 22301:2019 remains the published business-continuity management-system baseline at this cutoff; the 2026 Edition 3 work is still a Committee Draft.

## 15.1 Recovery is an engineered capability

A backup file, replica or failover diagram is not evidence of recoverability.

Recovery evidence requires successful restoration/reconciliation under defined conditions.

## 15.2 Recovery objectives

Define where material:

- **RTO:** maximum acceptable time to restore the required capability;
- **RPO:** maximum acceptable data-loss interval relative to a recovery point.

Also define:

- maximum tolerable outage if different from RTO;
- minimum acceptable degraded capability;
- recovery priority/order;
- data-integrity acceptance criteria.

## 15.3 RTO/RPO are business constraints

Do not derive them solely from current infrastructure.

Ask:

- What consequence accumulates with outage duration?
- How much re-entry/reconciliation is possible?
- Which data can be recreated?
- Which transactions cannot be lost?
- What contractual/regulatory requirements apply?
- What recovery cost is justified?

## 15.4 Replication is not backup

Replication improves availability/read scaling/restore speed depending on design, but can replicate:

- accidental deletion;
- corrupt writes;
- ransomware;
- application bugs;
- malicious changes.

Backups SHOULD provide an independent historical recovery path where data loss matters.

## 15.5 Backup design

Define:

```yaml
data_scope:
backup_method:
frequency:
retention:
immutable_or_isolated_copy:
encryption:
key_dependency:
region_account_isolation:
restore_tooling:
restore_environment:
integrity_check:
rpo_claim:
rto_claim:
last_successful_restore_test:
owner:
```

## 15.6 Restore test

A representative restore test SHOULD verify:

1. backup can be located;
2. credentials/keys are available under incident conditions;
3. data can be restored;
4. application versions can read it;
5. schema/migrations align;
6. integrity/reconciliation checks pass;
7. DNS/network/identity dependencies work;
8. measured restore time supports the objective;
9. operators can execute the procedure.

## 15.7 Recovery bootstrap problem

Ask what recovery depends on.

Examples:

- secret manager;
- identity provider;
- DNS;
- CI/CD;
- source repository;
- cloud control plane;
- documentation;
- hardware token;
- one operator;
- vendor support.

A recovery plan that depends on the failed system is incomplete.

## 15.8 Disaster recovery strategy

Common patterns, from simpler to more expensive, include:

- backup and restore;
- pilot light;
- warm standby;
- active/passive;
- active/active.

This is not a maturity ranking. Choose by RTO/RPO, failure domain, cost, data semantics and operational capability.

## 15.9 Failover

Failover needs:

- trigger;
- authority;
- state/data preconditions;
- capacity validation;
- routing change;
- monitoring;
- user communication;
- verification;
- rollback/failback policy.

Automatic failover is not always safer. A bad detector can move traffic into a worse state.

## 15.10 Failback

Failback is a separate change.

Define:

- source of truth after failover;
- data reconciliation;
- replication direction;
- capacity;
- traffic shift;
- observation window;
- abort condition.

Never assume “returning home” is trivial.

## 15.11 Recovery drills

Exercise progressively:

```text
TABLETOP
→ COMPONENT RESTORE
→ SERVICE RESTORE
→ DEPENDENCY LOSS
→ ZONE / REGION SCENARIO
→ FULL BUSINESS-FLOW RECOVERY
```

Depth follows criticality.

---

# 16. Change reliability and progressive delivery

Change is a major production risk source. Reliability engineering therefore governs how change is exposed.

## 16.1 Change-risk factors

Increase controls when a change has:

- schema/state migration;
- auth/security effect;
- large blast radius;
- irreversible external side effect;
- new dependency;
- high traffic/capacity effect;
- control-plane change;
- novel architecture;
- opaque AI-generated diff;
- difficult rollback;
- weak observability.

## 16.2 Separate deploy and release

Where useful:

```text
DEPLOY
= artifact exists in production environment

RELEASE
= behavior is exposed to users/workload
```

Feature flags, routing, cohorts and shadow traffic may decouple them.

## 16.3 Progressive exposure

A rollout plan SHOULD define:

```yaml
change:
artifact_version:
cohort:
start_size:
step_schedule_or_criteria:
minimum_observation:
sli_guardrails:
domain_guardrails:
capacity_guardrails:
error_budget_condition:
stop_condition:
rollback_or_rollforward:
decision_owner:
```

## 16.4 Canary

A canary is useful only if:

- traffic is representative enough;
- failure can be detected;
- comparison is interpretable;
- impact is bounded;
- mitigation is fast.

A tiny canary that never sees the failing workload gives false confidence.

## 16.5 Shadow traffic

Useful for read-only/computation paths when duplicated input does not produce unsafe effects.

Control:

- PII/data handling;
- cost;
- provider quotas;
- side effects;
- sampling bias.

## 16.6 Rollback vs roll-forward

Rollback is appropriate when:

- previous version can interpret current state;
- external effects are compatible;
- rollback is faster and lower risk.

Roll-forward is often safer when:

- migration is irreversible;
- old code cannot read new state;
- rollback would repeat corruption;
- a minimal fix is simpler.

## 16.7 Database/schema change

Prefer expand → migrate → verify → contract for live systems.

Do not couple destructive schema contraction to initial rollout unless high assurance justifies it.

## 16.8 Config and feature flags

Treat production config as code/state with:

- schema validation;
- audit history;
- owner;
- safe default;
- rollout;
- rollback;
- expiry for temporary flags.

Many incidents are config changes, not code changes.

---

# 17. Observability architecture

Observability is a system property: operators can answer important questions about behavior from available evidence.

## 17.1 Start from questions

For every critical flow, define questions such as:

- Is it working for users?
- What fraction is failing?
- Which segment is affected?
- When did it begin?
- Which change preceded it?
- Which dependency contributes latency/failure?
- Is state stale/corrupt?
- Is queue age growing?
- Is capacity exhausted?
- Is degradation active?
- Is recovery progressing?
- Is an AI/model/tool failing selectively?

Instrumentation is justified by questions and decisions.

## 17.2 Telemetry families

### Metrics
Strong for:
- rates;
- ratios;
- distributions;
- saturation;
- long-term trends;
- alerting.

### Logs/events
Strong for:
- discrete state/action detail;
- audit;
- error context;
- forensic sequence.

### Traces
Strong for:
- distributed request path;
- dependency latency;
- causal correlation across services.

### Profiles
Strong for:
- resource hot spots;
- CPU/allocation behavior;
- performance diagnosis.

### Synthetic probes
Strong for:
- black-box critical journey checks;
- external vantage points.

### Domain/reconciliation signals
Strong for:
- correctness that generic telemetry cannot infer.

No telemetry type is universally sufficient.

## 17.3 Black-box and white-box monitoring

Use both where consequence warrants:

- **black-box:** consumer-visible behavior;
- **white-box:** internal causes/resources.

Black-box answers “are users failing?”  
White-box helps answer “why?”

## 17.4 Four golden signals

Latency, traffic, errors and saturation are a strong online-service baseline.

They are not complete.

Add as relevant:

- freshness;
- queue age/depth;
- data integrity;
- dependency health;
- business transaction completion;
- security;
- model/tool quality;
- cost;
- recovery status.

## 17.5 Semantic telemetry contracts

Telemetry fields become interfaces consumed by:

- dashboards;
- alerts;
- traces;
- incident tools;
- analytics;
- automations.

Version and test material telemetry schema changes.

OpenTelemetry provides stable signal specifications in important areas, but individual semantic conventions can have different maturity status. Check current status before treating a convention as stable.

## 17.6 Correlation

Prefer stable correlation across:

- request;
- trace;
- job;
- workflow;
- user/tenant with privacy-safe identifiers;
- deployment version;
- region/zone;
- dependency;
- agent/tool execution.

Do not log secrets or raw sensitive identifiers merely for correlation.

## 17.7 Cardinality

High-cardinality dimensions can create:

- cost explosions;
- query failures;
- storage pressure;
- telemetry pipeline overload.

Classify attributes:

```text
SAFE LOW-CARDINALITY DIMENSIONS
vs
HIGH-CARDINALITY SEARCH CONTEXT
vs
SENSITIVE / PROHIBITED DATA
```

Use logs/traces or dedicated stores for high-cardinality context when metrics systems cannot safely support it.

## 17.8 Sampling

Sampling trades cost for detail.

Define:

- head vs tail sampling;
- minimum error retention;
- rare/high-value path retention;
- incident override;
- statistical interpretation.

A sampled signal MUST NOT be presented as complete event count unless corrected appropriately.

## 17.9 Telemetry pipeline reliability

Monitoring can fail during the incident.

Design for:

- local buffering bounds;
- export failure visibility;
- dropped telemetry counters;
- backend quota/capacity;
- degraded query behavior;
- secondary signals for critical incidents.

A missing metric can mean “healthy” or “monitoring broken.” Distinguish the states.

## 17.10 Privacy and security

Telemetry MUST avoid:

- credentials;
- tokens;
- private keys;
- unnecessary personal data;
- full sensitive prompts/documents;
- regulated data without justified control.

Apply retention and access control.

---

# 18. Monitoring and alerting

## 18.1 Monitor outcomes and causes

A useful monitoring stack has layers:

```text
USER / BUSINESS OUTCOME
↓
SLI / SLO
↓
SERVICE GOLDEN SIGNALS
↓
DEPENDENCY / QUEUE / DATA STATE
↓
RESOURCE / PLATFORM
↓
CHANGE / VERSION / CONFIG
```

Do not page on every layer.

## 18.2 Paging criterion

Page when all are substantially true:

- meaningful consequence exists or is imminent;
- timely human action can improve outcome;
- the responsible person can act;
- signal has acceptable precision;
- delay to business hours would be harmful.

Otherwise use:

- ticket;
- dashboard;
- automated remediation;
- periodic review.

## 18.3 Symptom vs cause alerts

Prefer symptom/user-impact paging.

Cause alerts can be useful when:

- the cause predicts imminent material impact;
- mitigation must happen before users fail;
- the signal is sufficiently precise.

Avoid duplicate pages for one incident.

## 18.4 Alert record

```yaml
alert_id:
name:
owner:
signal:
condition:
user_or_system_consequence:
urgency:
routing:
expected_action:
first_diagnostic_step:
runbook:
silence_condition:
dependency:
known_false_positive_modes:
test_date:
review_date:
```

## 18.5 Alert quality metrics

Track selectively:

- pages per on-call shift;
- actionable-page rate;
- false-positive/no-action rate;
- duplicate page rate;
- time to acknowledge;
- time to meaningful action;
- pages outside operator control;
- stale alerts;
- alerts without owner/runbook.

Never optimize “fewer alerts” if important failures become invisible.

## 18.6 Alert fatigue

Signs:

- pages ignored;
- blanket silences;
- repeated no-op acknowledgements;
- operators cannot explain alerts;
- alerts fire during normal behavior;
- dozens of alerts fire for one root incident.

Treat this as a reliability defect.

## 18.7 Missing-data semantics

Every critical alert SHOULD define what happens when the metric disappears.

Possible interpretations:

- exporter failed;
- service failed;
- traffic stopped;
- query failed;
- telemetry backend failed.

Silence is not health.


---

# 19. Production readiness and operational readiness

Production readiness asks whether a system can be safely operated, changed and recovered—not merely whether feature tests pass.

## 19.1 Minimum review domains

### Ownership
- product owner;
- engineering owner;
- service owner;
- on-call/support owner;
- dependency owners;
- recovery authority.

### Critical flows
- identified;
- protected invariants;
- SLO/equivalent;
- failure behavior;
- degraded mode.

### Capacity
- workload model;
- load/overload evidence;
- dependency quotas;
- queue/concurrency bounds;
- headroom/failover capacity.

### Reliability
- failure modes;
- isolation;
- retry/deadline semantics;
- recovery;
- backup/restore;
- RTO/RPO where material.

### Observability
- user-outcome telemetry;
- critical path traceability;
- deployment/config correlation;
- actionable alerts;
- telemetry loss visibility.

### Change
- safe deployment;
- progressive rollout where justified;
- migration;
- rollback/roll-forward;
- config/flag ownership.

### Security / privacy
- current threat/privacy controls;
- secrets;
- telemetry sanitization;
- emergency access.

### Runbooks / competence
- material runbooks tested;
- operators trained/rehearsed;
- break-glass access tested.

## 19.2 Production-readiness gate

A material service SHOULD NOT enter production when any of these remains unexplained:

- no accountable owner;
- no way to detect failure;
- unknown recovery path for important state;
- unbounded overload path;
- destructive migration without recovery strategy;
- dependency whose outage behavior is unknown;
- no safe emergency access for critical operation;
- paging without a capable responder;
- material runbook never executed;
- SLO promise with no trustworthy measurement.

Exceptions require explicit risk owner and expiry/review trigger.

---

# 20. Incident engineering

Incident response is a reliability capability, not an improvised chat room.

## 20.1 Objectives during incident

In order:

1. protect safety/security/data integrity;
2. establish impact and scope;
3. contain blast radius;
4. restore acceptable service;
5. verify recovery;
6. communicate;
7. preserve enough evidence for later learning.

Deep causal analysis can wait until stability.

## 20.2 Declare early when coordination helps

An incident declaration SHOULD lower coordination cost.

Declare when one or more apply:

- material user impact;
- protected invariant at risk;
- sustained SLO burn requiring coordinated response;
- multiple teams/dependencies involved;
- unclear or expanding blast radius;
- security/privacy/regulatory concern;
- recovery requires privileged or risky actions.

Do not delay declaration because severity is uncertain.

## 20.3 Severity

Define severity from consequence, not stress.

Consider:

- affected users/tenants;
- critical flow impact;
- duration;
- data integrity;
- security/privacy;
- safety;
- revenue/business operations;
- regulatory/contractual reporting;
- recovery complexity.

Avoid universal severity names. A local `SEV1–SEV4` scheme is `HOUSE`.

## 20.4 Core incident roles

For material incidents, separate roles as scale requires:

### Incident commander
- owns coordination and objectives;
- assigns roles;
- maintains priorities;
- approves risky recovery actions under policy;
- ensures handoff.

### Operations / technical lead
- leads diagnosis and mitigation;
- coordinates technical responders;
- reports evidence/state.

### Communications
- internal/external updates;
- stakeholder expectations;
- status cadence.

### Scribe / state keeper
- timeline;
- decisions;
- hypotheses;
- actions;
- current state.

Small incidents MAY combine roles. Large incidents SHOULD not force one person to diagnose, coordinate and communicate simultaneously.

## 20.5 Incident state document

Maintain one current working record:

```yaml
incident_id:
declared_at:
severity:
incident_commander:
ops_lead:
communications:
scribe:
current_user_impact:
protected_invariants:
systems:
suspected_scope:
current_hypotheses:
mitigations_attempted:
current_mitigation:
next_decision:
owners:
communication_cadence:
last_update:
recovery_criteria:
```

## 20.6 Response loop

```text
DETECT
→ DECLARE / TRIAGE
→ STABILIZE
→ CONTAIN
→ MITIGATE / RESTORE
→ VERIFY
→ MONITOR
→ CLOSE / HAND OFF
→ LEARN
```

The loop can repeat.

## 20.7 Stabilization rules

During severe incidents:

- reduce change surface;
- pause unrelated risky work;
- avoid speculative simultaneous fixes;
- use one owner for production mutations;
- record high-impact actions;
- prefer reversible mitigations;
- protect evidence before destructive repair when practical.

## 20.8 Hypothesis discipline

Use:

```text
OBSERVATION
→ HYPOTHESIS
→ PREDICTION
→ SAFE CHECK
→ UPDATE
```

Do not let the loudest guess become fact.

Record disproven hypotheses when they prevent repeated work.

## 20.9 Communication

Communicate what is known, not what is hoped.

Useful update:

```text
Impact:
Current state:
What changed since last update:
Mitigation underway:
Next checkpoint:
```

Avoid speculative root cause during active response unless necessary and clearly labeled.

## 20.10 Recovery verification

Do not close because graphs “look better.”

Verify:

- critical user flow;
- error rate;
- latency/tail;
- queues/backlogs;
- data integrity;
- dependency state;
- degraded mode exit;
- recovery automation state;
- no hidden retry/replay surge;
- monitoring pipeline health.

## 20.11 Handoffs

For long incidents, handoff must transfer:

- current impact;
- system state;
- actions already tried;
- known unsafe actions;
- open hypotheses;
- credentials/access constraints;
- next decision;
- communication obligations.

Operator fatigue is a reliability risk.

## 20.12 Incident metrics

Use metrics for system improvement, not operator ranking.

Potential measures:

- time to detect;
- time to declare;
- time to contain;
- time to restore critical flow;
- duration of user impact;
- error budget consumed;
- recurrence;
- action closure;
- detection source;
- escalation delay.

“MTTR” is ambiguous. Spell out the exact interval being measured.

---

# 21. Post-incident learning

A postmortem is successful when it changes future system behavior or decision quality.

## 21.1 Trigger

Write a proportionate review when:

- major user/business impact;
- protected invariant threatened or violated;
- surprising near miss;
- recovery failed or was unusually difficult;
- detection materially lagged;
- repeated class of incident;
- novel failure mode;
- significant manual heroics;
- security/privacy overlap;
- error-budget policy requires it.

Not every small incident needs a long document.

## 21.2 System-focused analysis

Avoid:

> Operator X made mistake Y.

Ask:

- Why was the action possible?
- Why was the risk not visible?
- Why did detection not catch it?
- Why did containment fail?
- Why was blast radius large?
- Why was recovery slow?
- Which incentives/processes/tools shaped behavior?

Human actions remain part of the event; the goal is to improve conditions, not erase responsibility.

## 21.3 Causal model

Prefer contributing conditions over one simplistic “root cause.”

Possible categories:

- trigger;
- latent design condition;
- change/release defect;
- dependency failure;
- control-plane failure;
- capacity;
- observability gap;
- process/ownership gap;
- recovery defect;
- human factors;
- organizational incentive;
- common-mode dependency.

## 21.4 Postmortem template

```yaml
incident_id:
date:
authors:
reviewers:
summary:
user_business_security_data_impact:
timeline:
trigger:
contributing_conditions:
why_detection_did_or_did_not_work:
why_containment_did_or_did_not_work:
why_recovery_did_or_did_not_work:
what_worked:
what_did_not:
counterfactuals:
actions:
lessons_to_propagate:
```

## 21.5 Action quality

Weak:

- “be more careful”;
- “monitor better”;
- “add tests”;
- “document it.”

Stronger:

```yaml
action:
failure_mechanism_addressed:
owner:
priority:
due:
verification:
expected_risk_reduction:
possible_side_effect:
```

## 21.6 Action portfolio

Use a mix when appropriate:

- eliminate failure mode;
- reduce blast radius;
- improve detection;
- improve mitigation;
- improve recovery;
- improve operator interface;
- improve runbook/training;
- improve change guard;
- add reconciliation;
- improve capacity.

Do not solve every incident by adding an alert.

## 21.7 Verify closure

An action is not complete because a ticket is closed.

Evidence may include:

- test;
- failure injection;
- restore drill;
- production telemetry;
- config/policy check;
- runbook execution;
- architecture change review.

## 21.8 Learning distribution

Relevant lessons SHOULD update:

- code;
- architecture;
- tests;
- monitoring;
- runbooks;
- onboarding/training;
- review checklist;
- production-readiness criteria;
- other services with same failure mechanism.

A postmortem repository nobody reuses is weak organizational learning.

---

# 22. SRE operating model

SRE is a capability for engineering reliable production systems. It is not one mandatory org chart.

## 22.1 Responsibilities

A mature reliability capability covers:

- reliability requirements/SLOs;
- production engineering;
- observability;
- capacity;
- change safety;
- incident response;
- recovery;
- automation;
- reliability testing;
- learning;
- reduction of repetitive manual operational work.

## 22.2 Product engineering retains ownership

A separate SRE team MUST NOT become a dumping ground for unreliable software.

Product/service engineering remains responsible for:

- correctness;
- operability;
- failure handling;
- tests;
- production-safe change;
- service-specific expertise.

SRE can provide platform, policy, consultation, escalation and shared operations.

## 22.3 SRE organizational patterns

`CTX`

Possible models:

- embedded reliability engineer;
- central SRE team;
- platform/reliability enabling team;
- shared on-call between product and SRE;
- product-owned operations with central reliability standards.

Choose from:

- scale;
- service count;
- team maturity;
- 24/7 requirement;
- complexity;
- shared infrastructure;
- specialization needs.

## 22.4 Toil

Toil is repetitive operational work that is substantially:

- manual;
- automatable;
- tactical;
- recurring;
- low enduring value;
- scaling with service growth.

Not every manual task is toil. Judgment-heavy incident diagnosis may be valuable engineering work.

## 22.5 Toil management

Track:

- repeated task;
- frequency;
- person-hours;
- error risk;
- scaling behavior;
- automation opportunity;
- underlying system defect.

Google's specific organizational targets such as a 50% toil cap are evidence about one operating model, not universal requirements.

## 22.6 On-call sustainability

An on-call system SHOULD provide:

- clear ownership;
- actionable pages;
- enough competent responders;
- training;
- escalation;
- documentation;
- protected recovery/rest;
- post-incident support;
- manageable frequency.

Do not import fixed Google pager thresholds as universal laws.

Measure local human reliability:

- page load;
- night interruptions;
- page actionability;
- cognitive burden;
- unresolved training gaps;
- attrition/burnout signals where appropriately measured.

## 22.7 Runbook competence

A runbook supports competence; it does not create it.

Material operational procedures SHOULD be:

- tested by a non-author where risk warrants;
- rehearsed;
- updated from incidents;
- accessible during control-plane failure;
- explicit about dangerous steps;
- explicit about expected results and rollback.

---

# 23. Reliability testing and resilience validation

Reliability claims require evidence.

## 23.1 Test ladder

### RLT-1 — Static design review
Review failure model, SLO, dependencies, state, recovery.

### RLT-2 — Deterministic component/integration failure tests
Inject known errors/timeouts at safe boundaries.

### RLT-3 — Load/capacity test
Test representative normal and peak load.

### RLT-4 — Overload/stress test
Cross capacity threshold and observe containment/recovery.

### RLT-5 — Recovery/restore test
Restore data/service from backup/recovery procedure.

### RLT-6 — Dependency/failover exercise
Remove or degrade a dependency/zone/provider path.

### RLT-7 — Game day/tabletop
Cross-functional rehearsal with realistic scenario.

### RLT-8 — Controlled fault injection / chaos experiment
Inject bounded failure to test a reliability hypothesis.

### RLT-9 — Production resilience experiment
Only when risk, maturity and safeguards justify it.

Not every service needs every level.

## 23.2 Test nominal and degraded state

For critical flows test:

- normal;
- dependency slow;
- dependency unavailable;
- malformed/stale response;
- timeout;
- retry;
- duplicate;
- out-of-order;
- queue pressure;
- resource saturation;
- shutdown/restart;
- partial completion;
- recovery;
- concurrent recovery.

## 23.3 Load-test realism

Representative tests consider:

- traffic distribution;
- payload size;
- hot/cold cache;
- write/read mix;
- tenant skew;
- dependency latency;
- connection setup;
- long-lived requests;
- batch overlap;
- retry behavior.

Synthetic uniform load can hide real hotspots.

## 23.4 Chaos engineering classification

`CTX / MODERATE confidence as a generalized practice`

Recent systematic literature reviews show active and useful fault-injection/chaos practice in microservices and distributed systems, but methods, tooling and evidence remain heterogeneous.

Therefore:

> Chaos engineering is a **risk-based resilience validation method**, not a mandatory production ritual.

## 23.5 Chaos experiment gate

Before an experiment:

```yaml
hypothesis:
system:
critical_flow:
fault:
expected_steady_state:
protected_invariants:
blast_radius:
environment:
observation:
stop_conditions:
automatic_kill:
recovery:
operator:
communications:
approval:
```

## 23.6 Progressive chaos

Prefer:

```text
MODEL / TABLETOP
→ TEST ENVIRONMENT
→ STAGING / REPRESENTATIVE ENVIRONMENT
→ SHADOW / LIMITED TRAFFIC
→ SMALL PRODUCTION BLAST RADIUS
```

Production experimentation requires stronger evidence and recovery.

## 23.7 Abort conditions

Abort immediately if:

- protected invariant violated;
- blast radius exceeds scope;
- monitoring is unreliable;
- recovery path fails;
- incident already active;
- operator cannot retain control;
- unintended cost/security/privacy effect appears.

## 23.8 Fault injection is not proof of resilience

Passing one injected scenario establishes only scoped evidence.

Continue to reason about:

- untested fault combinations;
- common-mode failure;
- control-plane failure;
- unknown unknowns;
- dependency behavior drift.

---

# 24. AI and agentic operational reliability

AI systems add probabilistic behavior, model/provider dependencies and tool side effects to ordinary reliability concerns.

## 24.1 Reliability layers

Separate:

1. **infrastructure availability;**
2. **model/provider availability;**
3. **tool/integration availability;**
4. **task completion;**
5. **semantic correctness/quality;**
6. **policy/authorization correctness;**
7. **side-effect correctness;**
8. **recovery/reconciliation.**

A 200 response from a model endpoint is not successful task execution.

## 24.2 AI/agent SLIs

Potential signals:

- task completion ratio;
- deterministic postcondition pass ratio;
- tool-call success;
- invalid schema output;
- human escalation;
- rollback/compensation;
- repeated loop/timeout;
- provider fallback use;
- latency;
- cost;
- unsafe action blocked;
- stale/poisoned context detection.

Use human/model quality scores only when measurement validity is understood.

## 24.3 Bounded agent execution

Material agents SHOULD define:

- maximum runtime;
- maximum tool calls;
- maximum concurrency;
- spend/token budget;
- retry budget;
- recursion/loop limit;
- allowed capabilities;
- approval thresholds;
- kill/revoke mechanism.

## 24.4 Provider fallback

`CTX`

Multi-model/provider fallback can improve service continuity but can introduce:

- quality drift;
- schema differences;
- safety-policy differences;
- data-residency/privacy changes;
- latency/cost changes;
- non-deterministic state.

Treat provider failover as a tested compatibility path.

## 24.5 Agent incident handling

Preserve:

- triggering request;
- model/provider/version;
- play/policy version;
- relevant context provenance;
- tool decisions;
- approvals;
- side effects;
- retries;
- final state.

The logging design MUST respect privacy/security.

## 24.6 Recovery from partial agent action

For multi-step agents, model:

```text
PLANNED
→ AUTHORIZED
→ EXECUTING
→ PARTIAL
→ VERIFIED
→ COMPENSATING
→ RECOVERED
→ MANUAL_REVIEW
```

Do not collapse a partial external-action chain into “failed.”

---

# 25. Reliability decision framework

Use this sequence for material reliability decisions.

## Step 1 — Define the outcome

Which user/business/system capability must remain acceptable?

## Step 2 — Define protected invariants

What MUST NOT be sacrificed to preserve availability?

## Step 3 — Define credible failures

What assumptions can become false?

## Step 4 — Define consequence and tolerance

How long/large can failure be tolerated?

## Step 5 — Define evidence

Which SLI, test or recovery demonstration will prove adequate behavior?

## Step 6 — Select the least-complex adequate control

Avoid redundancy, queues, circuit breakers, multi-region, chaos or automation unless the mechanism solves a credible risk.

## Step 7 — Define operation

Who detects, decides, mitigates, communicates and recovers?

## Step 8 — Verify under failure

Test the control in representative conditions.

## Step 9 — Observe production

Use real incidents and SLO behavior to update assumptions.

---

# 26. Decision trees

## 26.1 Do we need an SLO?

```text
Is there a recurring user/consumer outcome whose reliability changes decisions?
├─ NO → use simpler health/acceptance monitoring
└─ YES
   ├─ Can it be measured validly?
   │  ├─ NO → build measurement first
   │  └─ YES → define SLI + provisional/confirmed target + policy
```

## 26.2 Retry?

```text
Is failure plausibly transient?
├─ NO → fail / alternate explicit path
└─ YES
   ├─ Is repeat execution safe/idempotent/deduplicated?
   │  ├─ NO → do not automatic-retry
   │  └─ YES
   │     ├─ Deadline/resource budget remains?
   │     │  ├─ NO → stop
   │     │  └─ YES → retry with bounded policy
```

## 26.3 Queue?

```text
Do we need durable async decoupling or bounded burst absorption?
├─ NO → avoid queue complexity
└─ YES
   ├─ Can max size/age and overload behavior be defined?
   │  ├─ NO → architecture incomplete
   │  └─ YES → use bounded queue with backpressure/rejection
```

## 26.4 Circuit breaker?

```text
Does repeated calling a failing dependency materially worsen outcome?
├─ NO → simpler timeout/retry policy may suffice
└─ YES
   ├─ Can breaker state/recovery/fallback be safely modeled and tested?
   │  ├─ NO → do not add yet
   │  └─ YES → use scoped breaker
```

## 26.5 Add redundancy / another region?

```text
Does a credible failure domain exceed tolerated consequence?
├─ NO → simpler architecture
└─ YES
   ├─ Will the redundant path avoid the same failure cause?
   │  ├─ NO → redundancy is cosmetic
   │  └─ YES
   │     ├─ Can state/failover/recovery complexity be operated?
   │     │  ├─ NO → improve recovery or isolation first
   │     │  └─ YES → evaluate redundancy
```

## 26.6 Page or ticket?

```text
Will delayed response until business hours cause material extra harm?
├─ NO → ticket/review
└─ YES
   ├─ Can a responder take a meaningful action now?
   │  ├─ NO → don't page; improve automation/control
   │  └─ YES → page
```

## 26.7 Chaos experiment?

```text
Is there an important resilience hypothesis not adequately tested otherwise?
├─ NO → don't inject failure
└─ YES
   ├─ Can blast radius and protected invariants be bounded?
   │  ├─ NO → lower-risk test first
   │  └─ YES
   │     ├─ Is recovery/kill path verified?
   │     │  ├─ NO → test recovery first
   │     │  └─ YES → run proportionate experiment
```

## 26.8 Fail over?

```text
Is current path failing beyond tolerated threshold?
├─ NO → continue diagnosis/containment
└─ YES
   ├─ Is target path healthy and adequately provisioned?
   │  ├─ NO → failover may worsen incident
   │  └─ YES
   │     ├─ Is state sufficiently current/consistent for the objective?
   │     │  ├─ NO → invoke data-loss/recovery decision
   │     │  └─ YES → controlled failover + verify
```

---

# 27. End-to-end reliability operating model

```text
1. IDENTIFY CRITICAL FLOWS
2. DEFINE PROTECTED INVARIANTS
3. MODEL FAILURE / DEPENDENCIES
4. SET USER-RELEVANT RELIABILITY OBJECTIVES
5. DESIGN BOUNDED WORK / CONTAINMENT
6. DESIGN RECOVERY
7. INSTRUMENT QUESTIONS / DECISIONS
8. TEST NORMAL + DEGRADED + RECOVERY
9. RELEASE PROGRESSIVELY
10. OPERATE AGAINST SLO / CONSEQUENCE
11. RESPOND TO INCIDENTS
12. LEARN / UPDATE SYSTEM
```

## 27.1 Cadence

### Per change
- risk;
- observability;
- rollout/recovery;
- relevant tests.

### Per service review
- SLO quality;
- error-budget trend;
- capacity;
- alerts;
- dependencies;
- backup/recovery evidence;
- on-call/toil;
- unresolved incidents/actions.

### Per incident
- stabilize;
- communicate;
- restore;
- learn;
- verify actions.

### Periodic higher-level review
- critical-flow inventory;
- dependency concentration;
- DR objectives;
- failure-domain assumptions;
- stale runbooks;
- telemetry cost/quality;
- systemic reliability investment.


---

# 28. Production Plays

The Plays below are canonical operating units. Teams MAY adapt wording and tooling while preserving protected invariants.

# PLAY-REL-001 — Define or revise a reliability objective

## Objective
Create a decision-useful SLI/SLO or equivalent reliability objective for a critical flow.

## Use when
- launching a material production capability;
- an existing uptime metric does not represent user outcome;
- an SLO repeatedly creates bad decisions;
- architecture or user expectation changes.

## Do not use when
A low-risk internal task needs only a simple acceptance/health threshold.

## Preconditions
- critical flow identified;
- accountable owner;
- measurement source available or gap explicitly known.

## Inputs
- user/business outcome;
- historical behavior;
- dependency envelope;
- consequence of failure;
- contract/SLA if applicable;
- incident history;
- cost/change constraints.

## Roles / decision rights
- Owner: service/product engineering owner
- Decision owner: service owner
- Contributors: product, SRE/operations, data/analytics as needed
- Escalation: risk owner for protected-invariant or contractual conflict

## Method
1. Define the consumer-visible outcome.
2. Identify the failure modes that matter.
3. Define `good` and `valid` event/time population.
4. Select measurement point.
5. Test the SLI against known incidents.
6. Establish baseline.
7. Select target from consequence and economics.
8. Define window.
9. Calculate error budget if appropriate.
10. Define decision policy.
11. Define review triggers.

## Decision logic

| Condition | Action |
|---|---|
| metric stays green during known user failure | reject metric |
| no trustworthy baseline | use provisional target + measurement-improvement action |
| target exceeds dependency capability without mitigation | redesign path or revise claim |
| target conflicts with protected invariant | invariant wins |
| missing target has no decision consequence | use simpler health measure |

## Guardrails
- MUST NOT copy a “nines” target without context.
- MUST define denominator/exclusions.
- MUST preserve security/safety/data integrity outside ordinary error-budget spending.
- SHOULD include segment analysis where aggregate hides material failure.

## Output
An approved SLO record and linked policy.

## Acceptance criteria
- [ ] user/consumer outcome is explicit
- [ ] SLI can be computed reproducibly
- [ ] denominator is defensible
- [ ] historical incidents were replayed against the metric where possible
- [ ] target rationale exists
- [ ] error-budget response exists where used
- [ ] owner/review trigger exists

## Failure modes and recovery
If measurement is invalid, downgrade confidence, stop using it for automated gates, repair instrumentation, and re-baseline.

---

# PLAY-REL-002 — Respond to rapid error-budget burn

## Objective
Prevent a reliability objective from exhausting its tolerated failure budget without creating unsafe change freezes.

## Trigger
Burn-rate or equivalent reliability signal crosses the policy threshold.

## Inputs
- SLO;
- current burn by window/segment;
- recent changes;
- active incidents;
- dependency health;
- planned releases.

## Execution
1. Verify telemetry validity.
2. Determine affected critical flow/segments.
3. Check whether an incident should be declared.
4. Identify whether burn is change-related, dependency-related, load-related or unknown.
5. Apply the predeclared policy.
6. Pause only changes that increase relevant risk.
7. Permit remediation changes with appropriate higher assurance.
8. Track budget recovery and recurrence.

## Guardrails
- MUST NOT treat security/safety/integrity violations as ordinary budget consumption.
- MUST NOT blindly freeze all change.
- SHOULD prefer root risk reduction over metric manipulation.

## Acceptance criteria
- [ ] burn is confirmed
- [ ] owner/action posture is explicit
- [ ] relevant changes are gated
- [ ] remediation is tracked
- [ ] policy effectiveness is reviewed after event

---

# PLAY-REL-003 — Stabilize an overloaded service

## Objective
Restore useful throughput and prevent overload from cascading.

## Trigger
One or more:
- saturation rising;
- latency/in-flight work growing;
- queue age/depth exceeds safe envelope;
- timeout/retry amplification;
- memory/thread/connection exhaustion;
- load-related error surge.

## Preconditions
- protected traffic classes known where possible;
- authority to shed/degrade/limit work.

## Execution
1. Confirm overload rather than only downstream failure.
2. Protect P0/P1 flows.
3. Stop nonessential expensive work.
4. Reduce retries if they amplify load.
5. Activate/load-tighten admission control.
6. Shed lower-priority work early.
7. Bound queues/in-flight work.
8. Scale only if the bottleneck can actually scale.
9. Check downstream quotas/bottlenecks.
10. Verify successful throughput, not only lower CPU.
11. Drain backlog at a safe rate.
12. Exit degraded mode gradually.

## Decision logic

| Observation | Likely response |
|---|---|
| queue grows, consumers saturated | shed/backpressure; add consumer capacity if bottleneck permits |
| retries exceed primary load | reduce/disable retries; increase backoff |
| CPU low but connections exhausted | fix connection/concurrency bound |
| instances scale but DB saturates | stop front-end scale amplification; protect DB |
| one tenant dominates | enforce tenant fairness/quota |
| backlog remains after traffic normalizes | controlled drain with freshness/expiry policy |

## Guardrails
- MUST NOT weaken authorization or integrity checks.
- MUST preserve recovery capacity.
- MUST record temporary limits for later cleanup.

## Acceptance criteria
- useful throughput stabilized;
- critical latency/error rate recovering;
- resource saturation below unsafe level;
- queue age controlled;
- retry amplification controlled;
- backlog policy explicit.

---

# PLAY-REL-004 — Manage a degrading dependency

## Objective
Contain dependency failure without creating wider cascading failure.

## Trigger
Dependency is slow, erroring, quota-limited, stale, partially reachable or semantically wrong.

## Execution
1. Measure user impact, not only dependency status.
2. Identify shared callers/flows.
3. Tighten total deadline/retry policy if needed.
4. Activate safe fallback only if verified.
5. Shed optional dependency usage.
6. Isolate affected workload/tenant/region where possible.
7. Protect dependency from retry storm.
8. Communicate with provider/owner.
9. Verify exit and stale/fallback state after recovery.

## Guardrails
- MUST NOT silently accept invalid security/data results as fallback.
- SHOULD make fallback/degraded use observable.
- SHOULD reconcile state created during degraded mode.

## Acceptance criteria
- blast radius bounded;
- critical flow has explicit status;
- dependency load controlled;
- exit/reconciliation completed.

---

# PLAY-REL-005 — Restore data from backup

## Objective
Restore a verified usable state that meets the declared recovery objective as closely as possible.

## Trigger
- accidental deletion;
- corruption;
- destructive migration;
- ransomware/security event after security authority approves restore path;
- primary data loss.

## Preconditions
- incident/recovery authority assigned;
- target restore point selected;
- active writers stopped or isolated as required.

## Inputs
- RPO/RTO;
- backup inventory;
- encryption keys;
- application/schema versions;
- integrity checks;
- dependency order.

## Execution
1. Determine last known good point.
2. Preserve forensic evidence where needed.
3. Select clean backup.
4. Verify backup integrity/availability.
5. Restore into isolated target where practical.
6. Apply required schema/application compatibility.
7. Run invariants/reconciliation.
8. Measure data-loss interval.
9. Reconnect dependent services in order.
10. Run critical user-flow verification.
11. Resume writes deliberately.
12. Monitor for replay/duplication/inconsistent replicas.

## Guardrails
- MUST NOT restore over the only remaining evidence without explicit authorization.
- MUST NOT assume replica = clean backup.
- MUST verify credentials/keys and application compatibility.
- SHOULD preserve an audit record.

## Acceptance criteria
- state passes integrity checks;
- observed RPO is recorded;
- restore duration is recorded;
- critical flows pass;
- replication/backups re-established;
- data gap/reconciliation plan exists.

---

# PLAY-REL-006 — Execute service failover and controlled failback

## Objective
Move a critical flow to an alternate failure domain and later return or normalize safely.

## Trigger
Current failure domain exceeds tolerance and alternate domain can satisfy the minimum acceptable service.

## Preconditions
- target health verified;
- target capacity verified;
- state consistency/freshness understood;
- routing authority available.

## Execution — failover
1. Declare incident/recovery mode.
2. Freeze risky unrelated changes.
3. Validate target capacity and dependencies.
4. Determine acceptable data-loss/staleness.
5. Stop/confine conflicting writers as required.
6. change routing.
7. verify critical flows externally.
8. watch saturation, error, state divergence.
9. communicate resulting degradation/data implications.

## Execution — failback
1. Define canonical state.
2. reconcile writes/data.
3. restore replication direction.
4. verify target/original health.
5. shift traffic progressively.
6. validate.
7. retire temporary controls.
8. update recovery evidence.

## Acceptance criteria
- critical flow restored;
- data/state consequence known;
- no split-brain/conflicting writers;
- capacity stable;
- failback or stable new primary documented.

---

# PLAY-REL-007 — Run a major production incident

## Objective
Contain impact and restore acceptable operation through clear coordination.

## Trigger
Local severity/incident declaration threshold met.

## Roles
- Incident commander
- Operations/technical lead
- Communications
- Scribe
- Subject-matter responders

## Execution
1. Declare and create incident record.
2. Assign roles.
3. State current impact and protected invariants.
4. Stop uncontrolled concurrent changes.
5. Establish working hypotheses.
6. Choose safest high-value mitigation.
7. Execute and observe.
8. repeat until critical flow restored.
9. verify recovery.
10. communicate closure/current residual risk.
11. schedule proportionate learning review.

## Guardrails
- MUST prioritize containment/restoration over perfect diagnosis.
- MUST record risky production actions.
- MUST maintain one current source of incident truth.
- SHOULD rotate responders during long incidents.

## Acceptance criteria
- impact ended or accepted degraded state declared;
- recovery verified;
- residual risk handed off;
- timeline/evidence retained;
- follow-up owner assigned.

---

# PLAY-REL-008 — Conduct a post-incident review

## Objective
Reduce recurrence, blast radius, detection delay or recovery time through verified system improvements.

## Inputs
- incident record;
- telemetry;
- changes;
- communication;
- operator accounts;
- recovery evidence.

## Execution
1. Reconstruct timeline.
2. Validate impact.
3. Separate trigger from contributing conditions.
4. Analyze why prevention/detection/containment/recovery behaved as observed.
5. Identify what worked.
6. Generate actions tied to failure mechanisms.
7. prioritize by risk reduction.
8. assign owner/due/verification.
9. disseminate reusable lessons.
10. verify actions later.

## Guardrails
- MUST NOT reduce complex incidents to blame.
- MUST NOT use “root cause” to hide interacting conditions.
- SHOULD retain human factors and accountability without punitive simplification.

## Acceptance criteria
- causal/contributing conditions supported by evidence;
- actions have validation;
- no vague “be careful” action;
- cross-service lesson propagation considered.

---

# PLAY-REL-009 — Perform a production readiness / reliability review

## Objective
Decide whether a material service/change is adequately operable and recoverable for production risk.

## Use when
- new critical service;
- major architecture;
- new region/provider;
- material migration;
- high-capability agent;
- ownership transfer.

## Execution
Review sections from §19 against criticality.

Decision:

```text
READY
READY WITH TIME-BOUND ACCEPTED RISK
NOT READY
```

## Blockers by default
- unknown owner;
- unobservable critical flow;
- unbounded overload;
- no recovery for important persistent state;
- untested destructive migration path;
- no responder for paging;
- missing protected invariants;
- unknown high-risk dependency behavior.

## Output
Signed readiness record with exceptions and expiry.

---

# PLAY-REL-010 — Repair a noisy or non-actionable alert

## Objective
Restore trust in paging without hiding material incidents.

## Trigger
- repeated no-action pages;
- duplicates;
- frequent false positives;
- alert has no owner/runbook;
- operators routinely silence it.

## Execution
1. Identify the consequence the alert is supposed to protect.
2. Check whether it detects symptom or proxy.
3. compare alert history with real incidents/actions.
4. remove duplicate/cause-level page if user-impact page is sufficient.
5. tune threshold/window only with evidence.
6. convert to ticket/dashboard if urgency does not justify page.
7. add missing-data behavior.
8. test firing/routing/runbook.
9. monitor actionability after change.

## Guardrails
- MUST NOT delete an alert solely to reduce page count without checking protected outcome.
- SHOULD prefer SLO/consequence signals.

---

# PLAY-REL-011 — Run a high-risk resilience experiment

## Objective
Test a specific resilience hypothesis with controlled blast radius.

## Preconditions
- hypothesis written;
- protected invariants defined;
- stop/kill tested;
- baseline healthy;
- no active incident;
- recovery owner present;
- approval appropriate to criticality.

## Execution
1. record steady-state measures.
2. inject one bounded fault.
3. observe predicted behavior.
4. stop immediately on abort condition.
5. recover.
6. verify full return to normal.
7. compare evidence with hypothesis.
8. create defects/actions.
9. decide whether next experiment can increase scope.

## Acceptance criteria
- no uncontrolled blast radius;
- recovery completed;
- hypothesis outcome recorded;
- findings linked to controls/tests.

---

# PLAY-REL-012 — Reduce operational toil and fragile heroics

## Objective
Remove repetitive/manual operational burden that creates reliability or scalability risk.

## Trigger
- repeated manual recovery;
- same runbook action many times;
- on-call overload;
- one-person knowledge dependency;
- operational work scales linearly with service growth.

## Execution
1. quantify task frequency/cost/error risk.
2. determine whether root issue should be eliminated instead of automated.
3. standardize safe known path.
4. add pre/postconditions.
5. automate where deterministic.
6. preserve human approval for judgment/high consequence.
7. test automation failure/rollback.
8. measure burden reduction and new failure modes.

## Guardrails
- MUST NOT automate a poorly understood unsafe process.
- MUST NOT remove human understanding of critical recovery.
- SHOULD eliminate work before automating it.

---

# 29. Canonical Runbooks

# RUN-REL-001 — First response to a production page

## Purpose
Establish impact, ownership and safe first action.

## Steps
1. Acknowledge page.
2. Confirm whether signal is real and telemetry itself is healthy.
3. Check critical user flow / SLO.
4. Identify current change/deployment/config.
5. Check scope: tenant/region/version/dependency.
6. If incident threshold met, declare and assign roles.
7. Prefer a known reversible containment action.
8. Escalate if action/ownership is unclear.
9. Record actions and outcome.

## Expected result
Either issue is safely resolved or a coordinated incident exists.

## Escalation
Escalate immediately for safety/security/data integrity or broad unknown impact.

---

# RUN-REL-002 — Overload stabilization

## Purpose
Prevent saturation from becoming cascading failure.

## Preconditions
Authority to adjust admission/retries/degraded features.

## Steps
1. Confirm saturation and bottleneck.
2. protect critical traffic.
3. disable optional expensive work.
4. reduce retry amplification.
5. tighten concurrency/admission.
6. shed best-effort load.
7. scale only if bottleneck supports it.
8. monitor useful throughput.
9. drain backlog safely.
10. restore normal settings gradually.

## Verification
- error/latency decline;
- saturation stabilizes;
- queue age decreases;
- critical success throughput holds.

---

# RUN-REL-003 — Backup restoration drill

## Purpose
Demonstrate real recoverability without harming production.

## Steps
1. select representative backup.
2. create isolated restore target.
3. retrieve required keys/credentials through normal emergency path.
4. restore data.
5. apply compatible application/schema version.
6. run integrity/reconciliation.
7. run critical-flow read/test.
8. measure restore time and observed recovery point.
9. destroy/sanitize test environment according to policy.
10. update runbook and evidence.

## Failure handling
Any missing key, incompatible schema, corrupt backup, unexpected manual knowledge dependency or excessive duration is a recovery defect.

---

# RUN-REL-004 — Enter and exit degraded mode

## Purpose
Preserve protected capability under dependency/capacity failure.

## Steps
1. confirm trigger.
2. announce/record degraded state.
3. disable only predefined optional functions.
4. validate protected invariants.
5. monitor fallback capacity and stale-data tolerance.
6. periodically re-evaluate exit criteria.
7. restore normal capability progressively.
8. reconcile state/backlog.
9. verify no degraded path remains stuck.

---

# 30. Templates and operational records

## 30.1 Service Reliability Profile

```yaml
service:
owner:
criticality:
critical_flows:
protected_invariants:
dependencies:
failure_domains:
slos:
capacity_model:
overload_policy:
degraded_modes:
recovery:
rto:
rpo:
backup:
observability:
paging:
runbooks:
on_call:
last_load_test:
last_restore_test:
last_failover_test:
open_reliability_risks:
```

## 30.2 SLO Record

```yaml
slo_id:
critical_flow:
consumer:
description:
sli:
good_event:
valid_population:
measurement_source:
segments:
target:
window:
exclusions:
error_budget:
policy:
sla_relationship:
historical_baseline:
known_bias:
owner:
last_review:
review_trigger:
```

## 30.3 Error Budget Policy

```yaml
slo_id:
normal:
warning:
fast_burn:
exhausted:
release_response:
remediation_change_exception:
security_safety_integrity_rule:
approval:
recovery_condition:
review_after_event:
```

## 30.4 Failure Mode Register

```markdown
| ID | Flow/dependency | Assumption | Failure mode | Consequence | Detection | Containment | Recovery | Test | Owner |
|---|---|---|---|---|---|---|---|---|---|
```

## 30.5 Dependency Reliability Record

```yaml
dependency:
owner:
critical_flows:
contract_or_sla:
observed_slo:
timeout:
retry:
idempotency:
quota:
failure_modes:
fallback:
isolation:
shared_fate:
status_support_path:
exit_strategy:
last_failure_test:
```

## 30.6 Capacity / Overload Record

```yaml
service:
workload:
normal:
peak:
burst:
safe_concurrency:
queue_bound:
queue_age_limit:
critical_resource:
dependency_limits:
scaling_delay:
admission:
shedding:
priority:
headroom_rationale:
last_test:
```

## 30.7 Observability Question Map

```markdown
| Question | Signal | Source | Segment | Decision | Owner | Failure of telemetry |
|---|---|---|---|---|---|---|
```

## 30.8 Alert Record

```yaml
alert_id:
owner:
critical_flow:
condition:
consequence:
urgency:
routing:
expected_action:
runbook:
missing_data_behavior:
known_noise:
last_test:
last_review:
```

## 30.9 Disaster Recovery Plan

```yaml
scope:
disaster_scenarios:
critical_flows:
rto:
rpo:
minimum_service:
recovery_site_or_method:
data_restore:
identity:
dns_network:
secrets_keys:
control_plane:
dependency_order:
failover:
failback:
communications:
decision_authority:
last_dr_test:
known_gaps:
```

## 30.10 Recovery Test Record

```yaml
test_id:
date:
scenario:
environment:
starting_state:
objective:
expected_rto:
expected_rpo:
actual_restore_time:
actual_recovery_point:
integrity_result:
critical_flow_result:
manual_steps:
unexpected_dependencies:
defects:
actions:
reviewer:
```

## 30.11 Incident Record

```yaml
incident_id:
severity:
declared:
resolved:
impact:
incident_commander:
ops_lead:
communications:
scribe:
systems:
timeline:
changes:
mitigations:
recovery_verification:
residual_risk:
postmortem_required:
```

## 30.12 Postmortem Action Record

```markdown
| Action | Failure mechanism | Risk reduction | Owner | Due | Verification | Status |
|---|---|---|---|---|---|---|
```

## 30.13 Resilience Experiment Record

```yaml
experiment_id:
hypothesis:
fault:
environment:
blast_radius:
protected_invariants:
steady_state:
stop_condition:
kill_path:
expected_behavior:
observed_behavior:
recovery:
result: PASS | FAIL | PARTIAL
defects:
next_scope:
```

## 30.14 On-call Health Review

```yaml
team:
period:
pages:
night_pages:
actionable_fraction:
duplicate_fraction:
top_alerts:
escalations:
training_gaps:
runbook_gaps:
toil_hours:
repeat_incidents:
actions:
```

---

# 31. Reliability metrics and Goodhart resistance

Metrics are for decisions. They are not the goal.

## 31.1 Outcome metrics
- critical-flow success;
- latency threshold success;
- freshness;
- durability/reconciliation;
- SLO attainment;
- customer-visible incident time.

## 31.2 Resilience metrics
- blast radius;
- degraded-mode success;
- failover success;
- restore success;
- achieved RTO/RPO;
- recovery test pass;
- dependency isolation effectiveness.

## 31.3 Operational metrics
- actionable pages;
- incident recurrence;
- detection source;
- change-related incidents;
- unresolved postmortem actions;
- toil;
- runbook success.

## 31.4 Capacity metrics
- utilization;
- concurrency;
- queue depth/age;
- rejected/shed work;
- retry amplification;
- saturation;
- scaling lag.

## 31.5 Observability quality
- telemetry drops;
- missing critical signal;
- query failure;
- stale dashboard/alert;
- unowned telemetry;
- cardinality/cost.

## 31.6 Anti-metrics

Do not use alone as “reliability performance”:

- uptime number without user flow;
- incident count;
- MTTR without interval definition;
- alert count;
- page count;
- CPU utilization;
- number of dashboards;
- number of logs;
- chaos experiments run;
- postmortems written.

## 31.7 Metric integrity record

For material metrics:

```yaml
metric:
question:
decision:
population:
source:
quality:
segments:
gaming_risk:
owner:
review:
```

---

# 32. Anti-pattern catalogue

## 32.1 Five nines as prestige
**Failure:** target selected for appearance.  
**Correction:** derive from consequence, cost and dependency reality.

## 32.2 Green infrastructure = healthy product
**Failure:** component metrics mask broken journey.  
**Correction:** measure critical flow.

## 32.3 Average latency
**Failure:** tail disappears.  
**Correction:** distribution/threshold SLI.

## 32.4 Error budget as permission to break things
**Failure:** tolerated unreliability becomes target.  
**Correction:** use budget to make trade-offs.

## 32.5 Broad maintenance exclusions
**Failure:** denominator is sanitized.  
**Correction:** explicit narrow exclusions tied to promise.

## 32.6 Retry everything
**Failure:** duplicate effects and retry storms.  
**Correction:** transient + safe + bounded.

## 32.7 Timeout = cancellation
**Failure:** caller stops while downstream keeps consuming.  
**Correction:** propagate cancellation or account for orphaned work.

## 32.8 Unbounded queue
**Failure:** overload becomes delayed crash.  
**Correction:** bound size/age and define rejection.

## 32.9 Longer queue = more resilience
**Failure:** sustained overload creates latency/memory.  
**Correction:** burst buffer only; combine with admission.

## 32.10 Autoscaling solves overload
**Failure:** scale lag or downstream bottleneck remains.  
**Correction:** containment first.

## 32.11 Circuit breaker everywhere
**Failure:** extra state and recovery instability.  
**Correction:** add only where repeated calls materially harm.

## 32.12 Fallback by default
**Failure:** rarely tested hidden code fails during incident.  
**Correction:** only known acceptable degraded paths.

## 32.13 Multi-region = resilient
**Failure:** shared dependencies/common bugs remain.  
**Correction:** map shared fate and recovery.

## 32.14 Replication = backup
**Failure:** corruption/deletion replicates.  
**Correction:** independent historical restore path.

## 32.15 Backup = recovery
**Failure:** restore cannot complete.  
**Correction:** restore tests.

## 32.16 RTO/RPO on paper
**Failure:** no evidence.  
**Correction:** measured drills.

## 32.17 Automatic failover is always safer
**Failure:** bad health detector moves traffic incorrectly.  
**Correction:** test detector/state/capacity.

## 32.18 Rollback is always safest
**Failure:** state incompatible.  
**Correction:** choose rollback/forward from state.

## 32.19 Canary proves safety
**Failure:** unrepresentative cohort misses defect.  
**Correction:** validate representativeness/detection.

## 32.20 Never deploy Friday
**Failure:** calendar substitutes capability.  
**Correction:** release when ownership, observability and recovery fit risk.

## 32.21 More logs = observability
**Failure:** noise/cost/privacy without questions.  
**Correction:** question-driven telemetry.

## 32.22 Dashboard wall
**Failure:** visual volume substitutes decisions.  
**Correction:** role/decision-oriented views.

## 32.23 Page on every anomaly
**Failure:** attention exhausted.  
**Correction:** page on actionable consequence.

## 32.24 Missing metric = zero
**Failure:** monitoring outage looks healthy.  
**Correction:** explicit missing-data state.

## 32.25 One health endpoint
**Failure:** gray failure hidden.  
**Correction:** semantic/black-box multi-vantage checks.

## 32.26 One root cause
**Failure:** interacting system conditions disappear.  
**Correction:** trigger + contributing conditions.

## 32.27 Blameless = accountability-free
**Failure:** nobody owns improvement.  
**Correction:** system focus + explicit owners.

## 32.28 Postmortem = learning
**Failure:** document exists; system unchanged.  
**Correction:** verified actions/propagation.

## 32.29 More alerts after every incident
**Failure:** noise accumulates.  
**Correction:** eliminate/contain/detect/recover portfolio.

## 32.30 Hero operator
**Failure:** reliability depends on one person.  
**Correction:** tooling, runbooks, rehearsal, shared competence.

## 32.31 Automate the toil blindly
**Failure:** unsafe process executes faster.  
**Correction:** eliminate/understand first.

## 32.32 Chaos in production = maturity
**Failure:** ritual risk.  
**Correction:** hypothesis/risk-based progression.

## 32.33 Fault injection proves resilience
**Failure:** scoped success becomes universal claim.  
**Correction:** retain residual unknowns.

## 32.34 SRE owns reliability
**Failure:** product teams externalize operability.  
**Correction:** shared responsibility.

## 32.35 Managed service owns the outcome
**Failure:** provider transfers operation, not customer accountability.  
**Correction:** model dependency failure and exit.

## 32.36 SLA = SLO
**Failure:** contractual threshold becomes internal design target.  
**Correction:** maintain margin and operational objective.

## 32.37 Fixed headroom percentage
**Failure:** workload/scaling/failure model ignored.  
**Correction:** capacity model and tests.

## 32.38 Fixed on-call/page threshold
**Failure:** one organization's numbers cargo-culted.  
**Correction:** local human reliability measures.

## 32.39 Fixed toil percentage
**Failure:** Google organizational practice treated as law.  
**Correction:** track burden and capability outcome.

## 32.40 “Self-healing”
**Failure:** automation hides repeated defect or loops.  
**Correction:** bounded remediation, verification, escalation, kill path.

## 32.41 Active-active is highest maturity
**Failure:** complexity treated as sophistication.  
**Correction:** choose simplest topology meeting objectives.

## 32.42 Health checks as user SLO
**Failure:** shallow check misses journey.  
**Correction:** external critical-flow measure.

## 32.43 No incidents = reliable
**Failure:** hidden failures/low usage/poor detection.  
**Correction:** combine SLO, tests, incidents and recovery evidence.

## 32.44 Reliability by overprovisioning
**Failure:** does not solve bugs, dependencies, recovery or correlated failures.  
**Correction:** use capacity plus failure engineering.

## 32.45 Reliability review as checklist theatre
**Failure:** headings pass, operation untested.  
**Correction:** require evidence from tests and real behavior.

---

# 33. Contradiction ledger

| Tension | V2 conclusion |
|---|---|
| reliability vs feature velocity | use user-relevant SLO/error-budget decision mechanisms; no assumed fixed trade-off |
| availability vs correctness | protected correctness/integrity wins when serving wrong data is worse |
| redundancy vs simplicity | redundancy earns cost only when it removes a credible failure domain |
| retry vs fail fast | retry safe transient failure inside deadline/budget; otherwise stop |
| queue vs reject | bounded queue absorbs bursts; sustained overload requires backpressure/shedding |
| autoscale vs shed | scaling adds capacity when bottleneck can scale; shedding protects before scale arrives |
| circuit breaker vs simple timeout | breaker only when repeated calls materially worsen failure |
| fallback vs explicit failure | fallback only when degraded output is safe/tested |
| active-active vs active-passive | choose from RTO/RPO/state/operations, not maturity prestige |
| rollback vs roll-forward | decide from state compatibility and fastest safe recovery |
| auto-failover vs human decision | automation when detection/action are sufficiently reliable; human gate when ambiguity/consequence dominates |
| black-box vs white-box | consumer outcome + internal diagnosis complement each other |
| metrics vs logs vs traces | choose by operational question; no universal winner |
| high telemetry vs cost/privacy | collect enough evidence while controlling sensitivity/cardinality/volume |
| sensitive alert vs noisy alert | optimize actionable consequence, not raw sensitivity |
| blameless vs accountability | remove punitive simplification while keeping action ownership |
| chaos vs deterministic testing | chaos complements cheaper deterministic/failure tests; not a replacement |
| central SRE vs product ownership | org model contextual; responsibility for reliable service stays shared |
| manual recovery vs automation | automate known safe paths; preserve judgment for ambiguous/high-impact recovery |
| exact SLO vs measurement uncertainty | expose uncertainty and improve measurement rather than fake precision |

---

# 34. Reliability assurance and audit

## 34.1 Audit dimensions

Review:

1. scope / critical flows;
2. reliability objectives;
3. protected invariants;
4. failure model;
5. overload/capacity;
6. isolation/common mode;
7. recovery;
8. observability;
9. alerts/on-call;
10. change safety;
11. incidents/learning;
12. resilience test evidence;
13. dependency concentration;
14. AI/agent reliability where relevant.

## 34.2 Evidence sample

A serious audit SHOULD sample actual evidence such as:

- SLI queries;
- incident timeline;
- deployment record;
- load test;
- restore test;
- failover test;
- alert history;
- runbook execution;
- postmortem action validation;
- telemetry-drop evidence;
- capacity trend.

Document presence alone is weak assurance.

## 34.3 Defect severity

### BLOCKER
- protected invariant unsafe;
- material unbounded overload;
- false recovery claim;
- critical state cannot be restored within accepted risk;
- critical flow unobservable;
- known severe failure path with no containment/acceptance.

### MAJOR
- SLO materially mismeasures user outcome;
- noisy paging threatens response;
- dependency failure path untested;
- stale recovery procedure;
- large common-mode risk unexplained.

### MINOR
Operational friction unlikely to alter material outcome.

### EDITORIAL
Non-material documentation defect.

---

# 35. Reliability Definition of Ready

A reliability capability or material reliability change is ready to build/test when:

- [ ] critical flow defined
- [ ] owner defined
- [ ] consequence/criticality known
- [ ] protected invariants listed
- [ ] main dependencies known
- [ ] failure hypotheses identified
- [ ] measurement question defined
- [ ] recovery consequence understood
- [ ] test environment/method selected
- [ ] security/privacy constraints included
- [ ] decision authority known

---

# 36. Reliability Definition of Done

A production reliability design/change is done only when applicable conditions are met.

## Outcome
- [ ] critical user/consumer outcome explicit
- [ ] SLI/SLO/equivalent is decision-useful
- [ ] denominator and exclusions reviewed
- [ ] protected invariants are separate from ordinary error budget

## Failure engineering
- [ ] slow/unavailable/malformed/stale/duplicate/partial failure considered
- [ ] timeout/deadline semantics defined
- [ ] retries bounded and safe
- [ ] idempotency/deduplication exists where required
- [ ] queues/concurrency bounded
- [ ] overload policy exists
- [ ] common-mode failure considered

## Recovery
- [ ] RTO/RPO defined where material
- [ ] backup is restorable
- [ ] recovery bootstrap dependencies known
- [ ] failover/failback logic tested where claimed
- [ ] recovery verification is explicit

## Observability
- [ ] critical-flow telemetry works
- [ ] relevant segments exist
- [ ] deployment/config correlation exists
- [ ] missing telemetry detectable
- [ ] sensitive data controlled
- [ ] alerts are actionable and owned

## Change safety
- [ ] rollout has stop criteria
- [ ] schema/state compatible with rollback/roll-forward
- [ ] canary/progressive exposure used where justified
- [ ] emergency disable/degraded path works where claimed

## Operations
- [ ] on-call/support competence exists
- [ ] runbooks tested where material
- [ ] incident roles/escalation defined
- [ ] postmortem/action mechanism exists

## Validation
- [ ] normal load tested
- [ ] overload behavior tested where relevant
- [ ] dependency failure tested where relevant
- [ ] restore tested where state matters
- [ ] resilience experiment proportionate to criticality
- [ ] BLOCKER defects zero
- [ ] MAJOR defects closed or explicitly accepted

---

# 37. Governance and maintenance

## 37.1 Ownership

Every material production service MUST have an accountable reliability owner.

The owner is responsible for:

- critical-flow inventory;
- SLO health;
- reliability debt;
- readiness review;
- recovery evidence;
- incident learning;
- review cadence.

## 37.2 Exceptions

```yaml
rule:
exception:
reason:
risk:
compensating_control:
owner:
approver:
expires:
review_trigger:
```

Permanent invisible exceptions are not acceptable.

## 37.3 Review triggers

Review this playbook/application when:

- major incident;
- repeated SLO miss;
- architecture/topology change;
- new region/provider;
- major dependency change;
- data/storage change;
- monitoring platform change;
- on-call model change;
- relevant standard/guidance change;
- new evidence changes a material recommendation.

## 37.4 Volatility

Principles are `MODERATE`; vendor/platform implementations are `FAST`.

The playbook SHOULD receive:

- scheduled review at least every 6–12 months for current production engineering practice;
- event-driven review for source version changes or material incidents;
- faster review for AI/agent reliability controls.


---

# 38. Evidence map and source register

> Inclusion does not imply equal weight. Primary standards and official specifications establish their own requirements/semantics. Mature operator guidance demonstrates mechanisms in context. Empirical/systematic research is used for descriptive/effectiveness claims. HOUSE synthesis is explicitly labeled.

## BASE00 — Master Playbook Standard V2.0-RC1

**Source:** user-provided canonical foundation.  
**Used for:** outcome/evidence/decision/action chain; R3 research; contradiction search; risk-proportionate rigor; quality gates; atomic Plays; assurance and audit.  
**Strength:** governing methodology for this playbook system.  
**Limitation:** HOUSE standard, not external certification.

## ENG00 — Universal Software & AI Engineering Master Playbook V2.0

**Source:** user-provided engineering master.  
**Used for:** inherited engineering constitution; failure engineering; bounded queues/concurrency; SLO doctrine; observability; progressive delivery; RTO/RPO; production readiness; incidents.  
**Strength:** already double-validated/falsification-weighted engineering synthesis.  
**Limitation:** broad master; this playbook adds specialist depth.


## ISOQ01 — ISO/IEC 25010:2023 — Product quality model

**URL:** https://www.iso.org/standard/78176.html  
**Status at cutoff:** Published/current Edition 2 (2023).  
**Evidence:** international standard.  
**Finding:** defines a nine-characteristic ICT/software product-quality model usable for requirements, design, testing, acceptance and evaluation across the lifecycle.  
**Used for:** reliability as one interacting quality domain and assurance framing.  
**Limitation:** the quality model does not prescribe one SRE operating model, SLO value or resilience architecture.

## ISOBC01 — ISO 22301:2019 — Business continuity management systems

**URL:** https://www.iso.org/standard/75106.html  
**Status at cutoff:** published/current Edition 2; Edition 3 is a Committee Draft in 2026 and MUST NOT be represented as final.  
**Evidence:** international management-system standard.  
**Finding:** provides requirements for establishing, operating, monitoring, maintaining and improving business continuity so organizations can prepare for, respond to and recover from disruptions.  
**Used for:** business-continuity boundary and high-impact recovery governance.  
**Limitation:** organization-wide BCMS standard; it does not define software-specific SLO, overload or observability engineering.

## ISOICT01 — ISO/IEC 27031:2025 — ICT readiness for business continuity

**URL:** https://www.iso.org/standard/27031  
**Status at cutoff:** Published Edition 2, May 2025.  
**Evidence:** international standard/guidance.  
**Finding:** addresses ICT readiness to support business continuity, including prevention, response, recovery, restoration within agreed timeframes and third-party ICT dependencies.  
**Used for:** §15 recovery/DR and dependency-readiness cross-check.  
**Limitation:** continuity/readiness guidance; detailed architecture and engineering controls remain context-specific.

## REL01 — Google SRE Workbook — Implementing SLOs

**URL:** https://sre.google/workbook/implementing-slos/  
**Evidence:** mature large-scale operational guidance.  
**Finding:** SLOs should represent customer/user-relevant reliability and provide a basis for error-budget decisions. 100% is generally a poor default for ordinary service reliability.  
**Used for:** §§10, 25, PLAY-REL-001/002.  
**Limitation:** Google SRE context; exact targets/windows are contextual.

## REL02 — Google SRE Workbook — Alerting on SLOs

**URL:** https://sre.google/workbook/alerting-on-slos/  
**Evidence:** mature operational guidance with mathematical policy examples.  
**Finding:** multi-window/multi-burn-rate alerts can combine timely detection with lower false positives; worked examples depend on SLO/window/traffic.  
**Used for:** §10.11, §18.  
**Limitation:** exact burn-rate constants are not universal; low-traffic services need care.

## REL03 — Google SRE Book — Monitoring Distributed Systems

**URL:** https://sre.google/sre-book/monitoring-distributed-systems/  
**Evidence:** mature operational guidance.  
**Finding:** latency, traffic, errors and saturation form a strong baseline for online services.  
**Used for:** §§17–18.  
**Limitation:** not a complete domain monitoring model.

## RES01 — Google SRE Book — Handling Overload

**URL:** https://sre.google/sre-book/handling-overload/  
**Evidence:** mature large-scale operational guidance.  
**Finding:** overload should be handled explicitly; graceful degradation/load management preserve useful service.  
**Used for:** §13 and PLAY-REL-003.  
**Limitation:** Google-scale mechanisms require adaptation.

## RES02 — Google SRE Book — Addressing Cascading Failures

**URL:** https://sre.google/sre-book/addressing-cascading-failures/  
**Evidence:** mature large-scale operational guidance.  
**Finding:** overload, queueing, retries and synchronized clients can create positive feedback/cascading failure; backoff/jitter and controlled load are relevant defenses.  
**Used for:** §§12–13.  
**Limitation:** implementation thresholds are workload-specific.

## REL04 — Google SRE Workbook — Canarying Releases

**URL:** https://sre.google/workbook/canarying-releases/  
**Evidence:** mature operational guidance.  
**Finding:** partial production exposure can reduce blast radius and supply evidence unavailable in staging.  
**Used for:** §16.  
**Limitation:** canaries are weak when traffic/signals are unrepresentative.

## INC01 — Google SRE Workbook — Incident Response

**URL:** https://sre.google/workbook/incident-response/  
**Evidence:** mature production operations.  
**Finding:** early declaration, clear roles, incident command, communication and a shared working record improve coordinated response.  
**Used for:** §20 and PLAY-REL-007.  
**Limitation:** role structure must scale to team/incident size.

## INC02 — Google SRE Workbook — Postmortem Culture

**URL:** https://sre.google/workbook/postmortem-culture/  
**Evidence:** mature production operations.  
**Finding:** postmortems should be learning-oriented and produce specific trackable actions rather than blame.  
**Used for:** §21 and PLAY-REL-008.  
**Limitation:** “blameless” does not remove accountability or action ownership.

## SRE01 — Google SRE Workbook — On-Call

**URL:** https://sre.google/workbook/on-call/  
**Evidence:** mature operational practice.  
**Finding:** sustainable on-call requires manageable paging, competence and support.  
**Used for:** §22.6.  
**Limitation:** Google-specific numeric staffing/page thresholds are not universal.

## SRE02 — Google SRE Book — Eliminating Toil

**URL:** https://sre.google/sre-book/eliminating-toil/  
**Evidence:** mature operational practice.  
**Finding:** recurring manual automatable operational work can consume engineering capacity and should be controlled/eliminated.  
**Used for:** §22 and PLAY-REL-012.  
**Limitation:** Google's 50% organizational cap is not a universal requirement.

## SRE03 — Google SRE Workbook — Example Error Budget Policy

**URL:** https://sre.google/workbook/error-budget-policy/  
**Evidence:** worked operational policy example.  
**Finding:** error budgets can govern release/reliability trade-offs.  
**Used for:** §10.12.  
**Limitation:** explicitly an example policy, not a universal rule.

## AWS01 — AWS Well-Architected — Reliability Pillar

**URL:** https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html  
**Evidence:** mature vendor operational framework.  
**Finding:** reliability spans foundations, workload architecture, change management and failure management.  
**Used for:** cross-check of completeness.  
**Limitation:** AWS-specific implementation context.

## AWS02 — AWS Well-Architected — Back up data

**URL:** https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_planning_for_recovery_backup_data.html  
**Evidence:** official platform operational guidance.  
**Finding:** backups should be automated/protected and restoration should be periodically tested.  
**Used for:** §15, RUN-REL-003.  
**Limitation:** service-specific mechanics are AWS-specific.

## AWS03 — AWS Well-Architected — Plan for disaster recovery

**URL:** https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_planning_for_recovery_disaster_recovery.html  
**Evidence:** official operational guidance.  
**Finding:** recovery design should be based on recovery objectives, tested, automated where justified, and monitored for drift.  
**Used for:** §15.  
**Limitation:** architectural options and terminology are cloud-specific.

## AWS04 — AWS Well-Architected — Fault isolation

**URL:** https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_fault_isolation.html  
**Evidence:** official operational guidance.  
**Finding:** isolation/bulkheads can limit failure propagation.  
**Used for:** §14.  
**Limitation:** isolation spends resources/complexity.

## AWS05 — Amazon Builders’ Library — Timeouts, retries, and backoff with jitter

**URL:** https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/  
**Evidence:** mature large-scale operational practice.  
**Finding:** retries consume resources and can worsen overload; timeouts, bounded retry, backoff and jitter should be co-designed.  
**Used for:** §12.  
**Limitation:** implementation choices depend on request semantics/workload.

## AWS06 — Amazon Builders’ Library — Making retries safe with idempotent APIs

**URL:** https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/  
**Evidence:** mature operational pattern.  
**Finding:** explicit idempotency semantics can make repeated client requests safe.  
**Used for:** §12.7.  
**Limitation:** idempotency scope/lifetime/business semantics remain domain-specific.

## AWS07 — Amazon Builders’ Library — Avoiding fallback in distributed systems

**URL:** https://aws.amazon.com/builders-library/avoiding-fallback-in-distributed-systems/  
**Evidence:** mature practitioner experience.  
**Finding:** fallback paths can fail unexpectedly because they are activated rarely and under exceptional load.  
**Used for:** §12.10.  
**Limitation:** does not imply all fallback is bad.

## AZ01 — Microsoft Azure Well-Architected — Reliability principles/checklist

**URLs:**  
- https://learn.microsoft.com/en-us/azure/well-architected/reliability/principles  
- https://learn.microsoft.com/en-us/azure/well-architected/reliability/checklist

**Status at cutoff:** current official guidance; checklist updated in 2026.  
**Finding:** reliability requires business requirements, resilience, recovery, operations and deliberate simplicity.  
**Used for:** architecture/completeness cross-check.  
**Limitation:** Azure context.

## AZ02 — Microsoft Azure Well-Architected — Reliability testing

**URL:** https://learn.microsoft.com/en-us/azure/well-architected/reliability/reliability-test  
**Evidence:** official operational guidance.  
**Finding:** test end-to-end behavior against SLO/RTO/RPO, failure, restoration, degradation and DR; production fault injection requires safeguards/maturity.  
**Used for:** §23.  
**Limitation:** “gold standard” language about production chaos is vendor guidance, not universal evidence; V2 downgrades production chaos to contextual.

## GCP01 — Google Cloud Well-Architected — Reliability pillar

**URL:** https://docs.cloud.google.com/architecture/framework/reliability  
**Evidence:** official cloud architecture guidance.  
**Used for:** resilience/recovery triangulation.  
**Limitation:** Google Cloud context.

## GCP02 — Google Cloud — Test recovery from failures

**URL:** https://docs.cloud.google.com/architecture/framework/reliability/perform-testing-for-recovery-from-failures  
**Evidence:** official operational guidance.  
**Finding:** recovery/failover should be tested and monitored against recovery objectives.  
**Used for:** §15, §23.  
**Limitation:** cloud-specific examples.

## GCP03 — Google Cloud — Test recovery from data loss

**URL:** https://docs.cloud.google.com/architecture/framework/reliability/perform-testing-for-recovery-from-data-loss  
**Evidence:** official operational guidance.  
**Finding:** restoration should include data integrity and full application-stack recovery, not only backup presence.  
**Used for:** §15.  
**Limitation:** cloud-specific mechanics.

## NIST01 — NIST SP 800-61 Rev. 3

**URL:** https://csrc.nist.gov/pubs/sp/800/61/r3/final  
**Status:** Final, April 2025; supersedes Rev.2.  
**Evidence:** government cybersecurity incident-response guidance.  
**Finding:** incident response should integrate preparation, detection/response/recovery and learning with broader risk management.  
**Used for:** incident-response cross-check, especially security overlap.  
**Limitation:** cybersecurity incidents are only a subset of reliability incidents.

## OTEL01 — OpenTelemetry — Observability primer

**URL:** https://opentelemetry.io/docs/concepts/observability-primer/  
**Evidence:** open observability/instrumentation standard ecosystem guidance.  
**Finding:** observability concerns understanding system state through outputs; metrics/logs/traces are signals/evidence rather than the goal.  
**Used for:** §17.  
**Limitation:** adopting OpenTelemetry does not automatically create useful observability.

## OTEL02 — OpenTelemetry specifications — semantic conventions / stability

**URLs:**  
- https://opentelemetry.io/docs/specs/otel/semantic-conventions/  
- https://opentelemetry.io/docs/specs/otel/versioning-and-stability/

**Finding:** telemetry signals and semantic conventions have explicit version/stability rules; individual conventions can carry different maturity.  
**Used for:** §17.5.  
**Limitation:** status evolves; verify current convention before treating it as stable.

## IETF01 — RFC 9110 — HTTP Semantics

**URL:** https://www.rfc-editor.org/rfc/rfc9110.html  
**Evidence:** Internet standard/protocol semantics.  
**Finding:** distinguishes safe/idempotent methods and constrains automatic retry of non-idempotent requests unless known safe/not applied.  
**Used for:** retry/idempotency semantics.  
**Limitation:** HTTP method semantics do not replace business idempotency.

## DORA01 — DORA — Software delivery performance metrics

**URL:** https://dora.dev/guides/dora-metrics/  
**Evidence:** longitudinal industry research/practice.  
**Finding:** delivery performance must balance throughput and instability; current metric set includes failed-deployment recovery and rework alongside flow measures.  
**Used for:** change-reliability/metrics sanity check.  
**Limitation:** organization/service context matters; metrics are not universal targets.

## GRAY01 — Huang et al. — Gray Failure: The Achilles’ Heel of Cloud-Scale Systems

**URL:** https://www.microsoft.com/en-us/research/publication/gray-failure-achilles-heel-cloud-scale-systems/  
**Evidence:** peer-reviewed systems research (HotOS 2017).  
**Finding:** differential observability can cause components to disagree about failure, defeating simple health detection.  
**Used for:** §11.3.  
**Limitation:** conceptual/system evidence; implementation controls remain contextual.

## TAIL01 — Dean & Barroso — The Tail at Scale

**URL:** https://research.google/pubs/the-tail-at-scale/  
**Evidence:** peer-reviewed large-scale systems research.  
**Finding:** tail latency can dominate user-visible latency in fan-out/large services and motivates tail-aware techniques.  
**Used for:** §10.5 and contextual hedging.  
**Limitation:** scale/topology matters; techniques are not universal.

## LITTLE01 — Little — A Proof for the Queuing Formula: L = λW

**URL:** https://doi.org/10.1287/opre.9.3.383  
**Evidence:** foundational queueing theory.  
**Finding:** establishes Little’s Law under its assumptions.  
**Used for:** §13.3.  
**Limitation:** long-run/stability assumptions matter; not an instantaneous overload formula.

## CHAOS01 — Systematic literature review of chaos engineering in microservice architecture

**URL:** https://doi.org/10.1145/3777375  
**Status:** current review located in the 2026 research pass.  
**Evidence:** systematic literature review.  
**Finding:** chaos engineering/fault injection is actively used/researched for microservice resilience, with heterogeneous tools/methods and open issues.  
**Used for:** §23.4.  
**Limitation:** evidence does not justify mandatory production chaos for every system.

## FAULT01 — Systematic review of fault injection testing for microservices

**URL:** https://doi.org/10.1109/TSC.2025.3621564  
**Evidence:** systematic review, IEEE Transactions on Services Computing (2025).  
**Finding:** surveys fault-injection testing approaches/challenges for microservice systems.  
**Used for:** §23.  
**Limitation:** microservice focus; not all software needs these methods.

---

# 39. Claim–evidence map

| Claim ID | Material claim | Class | Confidence | Main evidence |
|---|---|---|---|---|
| C01 | Reliability should be defined from user/consumer-relevant outcomes | EST | HIGH | ENG00, REL01 |
| C02 | 100% is usually not a sensible default service SLO | CTX | HIGH in ordinary online services | REL01 |
| C03 | protected integrity/security/safety constraints are not ordinary error budget | EST/HOUSE synthesis | HIGH | ENG00 + domain reasoning |
| C04 | multi-window burn-rate alerting is a strong SLO alert pattern | CTX | HIGH for suitable SLO services | REL02 |
| C05 | four golden signals are a strong baseline, not complete observability | CTX | HIGH | REL03, OTEL01 |
| C06 | unbounded work can create cascading availability failure | EST | HIGH | ENG00, RES01, RES02 |
| C07 | retries can amplify overload | EST | HIGH | RES02, AWS05 |
| C08 | business idempotency is needed where retries/duplicates are plausible | EST | HIGH | ENG00, IETF01, AWS06 |
| C09 | queues absorb bounded bursts but do not create sustained capacity | EST | HIGH | RES01, LITTLE01 |
| C10 | early load shedding/degradation can preserve useful capacity | CTX | HIGH for overload-prone online systems | RES01 |
| C11 | redundancy only helps against sufficiently independent failure | EST | HIGH | fault-domain reasoning, AWS04 |
| C12 | replication is not equivalent to backup | EST | HIGH | AWS02, GCP03 |
| C13 | recovery claims need restore/failover evidence | EST | HIGH | AWS02, AWS03, AZ02, GCP02/03 |
| C14 | RTO/RPO are business recovery objectives, not backup configuration | EST | HIGH | AWS03, AZ02, GCP02/03 |
| C15 | canaries can reduce change blast radius but depend on representative traffic/signals | CTX | HIGH | REL04 |
| C16 | observability is question/understanding capability, not telemetry volume | EST | HIGH | OTEL01, ENG00 |
| C17 | gray failures defeat simplistic health checks | EST | MODERATE-HIGH | GRAY01 |
| C18 | paging should correspond to actionable urgent consequence | DEF | HIGH operational consensus | REL02, SRE01 |
| C19 | structured incident roles improve coordination for material incidents | DEF | HIGH | INC01, NIST01 |
| C20 | postmortems should drive specific verified system actions | DEF | HIGH | INC02, ENG00 |
| C21 | fixed SRE toil/on-call numeric thresholds are not universal | CTX boundary | HIGH | SRE01/02 + falsification |
| C22 | production chaos is not universal; use risk-based progression | CTX | MODERATE-HIGH | AZ02, CHAOS01, FAULT01 |
| C23 | tail latency can materially affect user experience at scale | EST | HIGH within applicable topology | TAIL01 |
| C24 | telemetry conventions require version/status awareness | EST | HIGH | OTEL02 |
| C25 | AI/agent reliability requires task/postcondition/side-effect signals beyond endpoint uptime | HOUSE + inherited principle | MODERATE-HIGH | ENG00 |
| C26 | recovery design should align ICT recovery with business continuity objectives | EST | HIGH | ISOBC01, ISOICT01 |
| C27 | reliability is one quality concern within a wider software/ICT product-quality model | EST | HIGH | ISOQ01, ENG00 |

---

# 40. V1 → falsification audit → V2 change record

## 40.1 V1 scope

V1 established:

- user-relative reliability;
- SLI/SLO/error-budget doctrine;
- failure engineering;
- retries/idempotency;
- overload/backpressure;
- recovery;
- observability;
- incident response;
- SRE/toil;
- resilience testing.

## 40.2 Falsification questions

The audit deliberately attempted to break V1 by asking:

1. Can availability be high while user outcome fails?
2. Can an SLO incentivize corruption or security compromise?
3. Can 100% ever be justified?
4. Can error budgets create perverse permission?
5. Can burn-rate formulas fail at low volume?
6. Can four golden signals miss domain failure?
7. Can more telemetry reduce observability?
8. Can health checks miss gray failure?
9. Can timeouts worsen overload?
10. Can retries lower reliability?
11. Can a circuit breaker create new failure?
12. Can fallback be worse than failure?
13. Can hedging overload dependencies?
14. Can queues make sustained overload worse?
15. Can autoscaling fail to save overload?
16. Can shedding harm integrity?
17. Can redundancy share the same failure?
18. Can multi-region preserve a global shared failure?
19. Can active-active reduce reliability through state conflict?
20. Can a replica copy corruption?
21. Can valid backups be unrestorable?
22. Can paper RTO/RPO be fiction?
23. Can automatic failover choose a worse state?
24. Can failback create a second incident?
25. Can canaries miss rare/cohort-specific failure?
26. Can rollback corrupt state?
27. Can a green dashboard hide user failure?
28. Can monitoring disappear during incident?
29. Can paging worsen human reliability?
30. Can “blameless” remove accountability?
31. Can “root cause” hide system interactions?
32. Can incident-count metrics punish good detection?
33. Can MTTR mean incompatible intervals?
34. Can fixed toil targets become cargo cult?
35. Can fixed pager thresholds misfit local systems?
36. Can SRE ownership reduce product responsibility?
37. Can chaos engineering itself cause unacceptable failure?
38. Can passing fault injection overclaim resilience?
39. Can self-healing loop destructively?
40. Can a managed service leave user outcome unowned?
41. Can SLA targets be too weak as internal SLO?
42. Can service dependency multiplication be mathematically misleading?
43. Can a fixed headroom rule fail different workloads?
44. Can latency averages hide tail collapse?
45. Can a health endpoint be semantically wrong?
46. Can AI endpoint uptime hide task failure?
47. Can provider fallback change model quality/policy?
48. Can recovery automation race with humans?
49. Can incident learning stop at documentation?
50. Can more reliability architecture create net reliability loss through complexity?

## 40.3 Material revisions after audit

V2:

- separates protected invariants from service error budgets;
- makes SLO denominator and measurement validity first-class;
- treats Google burn-rate numbers as examples, not standards;
- adds low-volume SLO caveats;
- adds gray-failure analysis;
- tightens timeout/cancellation interaction;
- treats retry, fallback, circuit breaker and hedging as contextual;
- adds retry amplification and overload test requirements;
- rejects unbounded queues and fixed queue/headroom rules;
- adds noisy-neighbor/fairness policy;
- separates scaling from overload protection;
- adds common-mode/shared-fate analysis;
- explicitly downgrades multi-region/active-active as contextual;
- distinguishes replication, backup, restore, DR, failover and failback;
- requires recovery bootstrap analysis;
- adds telemetry-pipeline failure and semantic-version concerns;
- separates urgent page from nonurgent ticket;
- makes operator fatigue a reliability concern;
- replaces one-root-cause thinking with contributing conditions;
- removes fixed Google SRE staffing/toil/page numbers from normative rules;
- classifies chaos as risk-based validation rather than universal best practice;
- adds AI/agent task/postcondition/side-effect reliability;
- adds 12 production Plays and 4 runbooks;
- adds evidence-linked DoR/DoD and audit gates.

## 40.4 Audit verdict

**PASS WITH MATERIAL REVISION → V2 REVIEWED GOLDEN MASTER**

No material claim from V1 was retained solely because it was familiar or used by a prestigious operator.

---

# 41. Sanity / adversarial audit of V2

## 41.1 Low-scale SaaS perspective

Pass:
- does not require multi-region, chaos, SRE team or complex circuit breakers;
- permits simple monitoring/recovery where consequence is low;
- preserves bounded work and tested restore as scale-independent principles.

## 41.2 Large distributed system perspective

Pass:
- explicit overload, retry amplification, tails, gray failure, failure domains, cells, failover, telemetry and incident command.

## 41.3 Data/financial integrity perspective

Pass:
- protected invariants outrank uptime;
- partial completion, idempotency, reconciliation, RPO and restore integrity are explicit.

## 41.4 Security perspective

Pass:
- reliability degradation cannot silently weaken auth/security;
- incident/recovery recognizes security authority/evidence;
- telemetry privacy and emergency access are controlled.

## 41.5 SRE/operator perspective

Pass:
- actionable paging;
- on-call sustainability;
- toil;
- incident roles;
- runbook competence;
- recovery drills;
- alert quality.

## 41.6 Product/business perspective

Pass:
- SLO and RTO/RPO are tied to consequence/value;
- SLA distinction;
- reliability architecture must earn complexity/cost.

## 41.7 AI/agent perspective

Pass:
- uptime is separated from semantic/task correctness;
- bounded execution, provider fallback, partial side effects, audit/recovery are represented.

## 41.8 High-assurance perspective

Conditional pass:
- the playbook escalates to C3/C4 and explicitly defers to applicable safety/mission/regulatory standards.
- It MUST NOT be treated as replacing certified domain assurance.

---

# 42. Known limits and open research questions

These remain visible rather than converted into false certainty.

1. No universal optimal SLO target exists.
2. No universal burn-rate window/threshold exists.
3. The best alert strategy depends on event volume, consequence and traffic shape.
4. Circuit breakers can help or hurt depending on parameters/topology.
5. Production chaos evidence remains context-heavy and tooling/methodology heterogeneous.
6. “Self-healing” reliability depends on the correctness of detectors and repair logic.
7. Cross-region/provider resilience economics vary dramatically by system.
8. Human on-call sustainability metrics are organization-specific.
9. AI/agent reliability measurement lacks one mature universal outcome taxonomy.
10. Observability cost/cardinality and sampling optimization remain platform/workload dependent.
11. Dependency correlation makes analytical end-to-end availability models fragile.
12. Recovery evidence can decay as architecture, credentials, data volume and teams change.

Each should be revisited through local evidence and future research.

---

# 43. Quality gates for this playbook

## Gate 0 — Scope
**PASS**
- outcome defined;
- domain boundaries defined;
- R3 selected;
- target users: engineers, architects, SRE/operations, platform teams, AI agents under supervision.

## Gate 1 — Evidence
**PASS**
- primary/official sources;
- mature operational guidance;
- foundational research;
- current systematic reviews;
- contradiction search;
- source limitations;
- current version/status checks.

## Gate 2 — Architecture
**PASS**
- orientation;
- decision frameworks;
- execution Plays/runbooks;
- assurance/evidence;
- no fixed cloud/tool architecture.

## Gate 3 — Construction verification
**PASS subject to mechanical checks in §46**
- Plays have objectives/triggers/guardrails/acceptance;
- failure and recovery branches explicit;
- no unresolved placeholder intended.

## Gate 4 — User/scenario validation
**NOT YET SATISFIED FOR `TESTED` / `VALIDATED`**
- research/adversarial scenarios completed;
- independent non-author field execution has not been demonstrated in this artifact.

## Gate 5 — Release
**PASS FOR `REVIEWED`**
- version/status/cutoff/review triggers defined;
- V1/audit/V2 traceability retained.

## Gate 6 — Learning
**ONGOING**

---

# 44. One-page Reliability Golden Standard

1. Define reliability from critical user/consumer outcomes.
2. Protect correctness, security, safety and data integrity before availability.
3. Use SLOs only when the SLI and denominator validly represent the outcome.
4. Do not select “nines” by prestige.
5. Use error budgets as decision mechanisms, not permission to fail.
6. Measure tail behavior where minorities or fan-out matter.
7. Treat slow, unavailable, stale, malformed, duplicate, reordered and partial outcomes as design inputs.
8. Give remote work finite deadlines/cancellation semantics.
9. Retry only safe transient work within deadline/resource budget.
10. Budget retries across layers and use backoff/jitter when synchronization can amplify failure.
11. Design idempotency/deduplication for repeat delivery.
12. Bound queues, concurrency and work admission.
13. Protect critical traffic through priority, backpressure, shedding or degradation when necessary.
14. Test overload and recovery, not just nominal throughput.
15. Map failure domains and common-mode dependencies.
16. Add redundancy only when it removes a credible failure domain.
17. Choose multi-region/active-active only when objectives earn the state/operational complexity.
18. Distinguish replication, backup, restore, disaster recovery, failover and failback.
19. Derive RTO/RPO from business consequence and demonstrate them.
20. A backup is unverified until restored successfully.
21. Analyze recovery bootstrap dependencies.
22. Instrument critical paths to answer operational questions.
23. Use golden signals as a baseline, then add domain correctness/freshness/queue/recovery signals.
24. Design for gray failures and monitoring failure.
25. Page only on urgent actionable consequence.
26. Treat alert fatigue and operator fatigue as reliability defects.
27. Make production changes small, observable and recoverable.
28. Use progressive exposure when representative production evidence is valuable.
29. Co-design schema/state changes with rollback/roll-forward.
30. Declare incidents early when coordination helps.
31. Separate incident command, technical work and communication when incident scale requires it.
32. Restore safely before demanding perfect diagnosis.
33. Verify recovery through critical flows and integrity signals.
34. Use postmortems to change system conditions, not assign simplistic blame.
35. Verify follow-up actions.
36. Treat SRE as a capability, not one mandatory team topology.
37. Reduce toil and hero dependencies.
38. Use chaos/fault injection as risk-based validation, not ritual.
39. Scale reliability assurance with consequence, uncertainty, blast radius and recoverability.
40. For AI/agents, measure task/postcondition/side-effect reliability—not endpoint uptime alone.
41. Prefer the least complex architecture that demonstrably meets the reliability objective.
42. Revisit the model when incidents or evidence invalidate assumptions.

---

# 45. Change log

| Version | Date | Status | Material change |
|---|---|---|---|
| 1.0 | 2026-09-27 | DRAFT | Initial R3 specialist synthesis |
| Audit | 2026-09-27 | COMPLETE | 50 falsification targets + cross-perspective audit |
| 2.0 | 2026-09-27 | REVIEWED / GOLDEN_MASTER | Material revision, expanded Plays, recovery, overload, observability, incident and evidence architecture |

---

# 46. Release verification record

Mechanical release checks completed after final synthesis:

```text
V2 lines: 5,438 before final verification-note normalization
Markdown fence markers: 140; balanced = yes
Source IDs used: 38
Source IDs defined: 38
Missing source definitions: 0
Duplicate Play IDs: 0
Duplicate Runbook IDs: 0
Unresolved placeholder markers: 0
V1 artifact present: yes
Falsification-audit artifact present: yes
V2 artifact present: yes
```

The file was also checked for unique `PLAY-REL-*` and `RUN-REL-*` identifiers and for evidence IDs without definitions.

Lifecycle status remains `REVIEWED`, not `VALIDATED`, until representative non-author operational execution satisfies the parent Master Playbook Standard.

---

# End of 08 — Reliability, Resilience, Observability & SRE — V2 Golden Master
