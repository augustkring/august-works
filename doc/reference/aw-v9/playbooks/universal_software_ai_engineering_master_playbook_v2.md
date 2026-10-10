# Universal Software & AI Engineering Master Playbook — V2.0
## Evergreen standard for correctness, security, reliability, maintainability, evolvability, operability and trustworthy AI-assisted development

**Version:** 2.0 — Double-Validated, Falsification-Weighted Golden Standard  
**Research cutoff:** 27 September 2026  
**Scope:** Technology-neutral engineering principles for software systems, applications, services, APIs, websites, engines, infrastructure, AI/ML/LLM systems, agentic systems, embedded/system software and software-enabled products.  
**Document type:** Evergreen master standard. It is not a framework manual, language style guide, cloud cookbook, compliance checklist or substitute for domain-specific safety/regulatory standards.  

---

# Executive synthesis

Software engineering is not the act of producing code. It is the discipline of turning intent into a system that behaves acceptably over time, under change, failure, attack, load, human use, organizational constraints and operational reality.

The durable sequence is:

```text
UNDERSTAND THE INTENT
→ DEFINE ACCEPTABLE BEHAVIOR, QUALITY AND FAILURE
→ CLASSIFY CONSEQUENCE / CRITICALITY
→ DESIGN THE SIMPLEST ADEQUATE SYSTEM
→ MAKE STATE, BOUNDARIES, AUTHORITY AND FAILURE EXPLICIT
→ BUILD WITH CONTROLLED DEPENDENCIES
→ VERIFY IN PROPORTION TO RISK
→ RELEASE IN SMALL, OBSERVABLE, RECOVERABLE STEPS
→ OPERATE AGAINST USER-RELEVANT TARGETS
→ CONTROL OVERLOAD AND DEPENDENCY FAILURE
→ LEARN FROM REAL BEHAVIOR
→ EVOLVE WITHOUT LOSING CONTROL
→ RETIRE SAFELY
```

The strongest cross-disciplinary standards, research and operational evidence reviewed for V2 support twenty recurring ideas:

1. **Correctness begins with explicit intent and constraints.** Requirements, invariants, quality attributes and acceptance conditions are engineering inputs, not paperwork added after implementation [REQ01][LIFE01].
2. **Quality is multidimensional and context-weighted.** ISO/IEC 25010:2023 provides nine product-quality characteristics, while production engineering also requires explicit lifecycle, operational, change-safety and supply-chain reasoning [QUAL01][LIFE01].
3. **Rigor should be proportional to consequence, exposure and recoverability.** Verification and control depth should increase with criticality rather than applying maximum ceremony everywhere [VV01][NASA01].
4. **Simplicity means minimizing unjustified complexity, not minimizing capability.** Information hiding, cohesion and explicit boundaries improve local reasoning and change isolation [MOD01][ARCH01].
5. **Architecture is consequential decision-making under trade-offs.** Named styles are options; quality scenarios, constraints, failure modes and evolution pressure determine whether they are justified [ARCH01][ARCH02].
6. **State, ordering and authority must be explicit.** Concurrent and distributed systems cannot safely infer causal ordering from wall-clock appearance or assume one global sequence unless the system provides that guarantee [DIST01].
7. **Security is a lifecycle property.** Secure development, secure defaults, least privilege, threat modeling, protected build/release paths and vulnerability handling are engineering responsibilities [SEC01][SEC02][SEC03].
8. **Security guidance must be version-aware.** NIST SSDF 1.1 remains the current final baseline at this cutoff; SSDF 1.2 is still an Initial Public Draft, while NIST's 2026 DevSecOps live work is implementation guidance under active development [SEC01][SEC05][DEVSEC01].
9. **Privacy is distinct from security.** A system can resist attackers while still collecting, retaining or exposing more personal data than justified. NIST Privacy Framework 1.1 is still an Initial Public Draft at this cutoff [PRIV01].
10. **Reliability is a user outcome, not a prestige uptime number.** SLOs should represent relevant behavior and consequence; 100% is rarely a sensible general default [REL01].
11. **Overload control is part of correctness for networked systems.** Unbounded queues, concurrency and retries can turn local slowness into cascading failure; systems should bound work, shed/degrade load intentionally and prevent retry amplification [RES01].
12. **Retries are a resource-consuming recovery tactic, not free reliability.** Retry only plausible transient failures that are safe to repeat, within a total deadline and retry budget [PROTO01][RES01].
13. **Observability exists to support questions and decisions.** Logs, metrics and traces are telemetry; diagnosability, detection and actionable operational signals are the actual goal [OBS01][REL03].
14. **Change is a major source of production risk.** Smaller changes, automated checks, progressive exposure, observable rollout and credible recovery paths reduce blast radius [REL02][DORA01].
15. **Testing provides evidence, not proof.** Coverage is not correctness; property-based testing, fuzzing, model checking/formal methods, integration testing and production verification each fit different failure modes [VV01][TEST04][TEST05][TEST06][FORMAL01].
16. **Supply-chain assurance is broader than dependency inventory.** Provenance, SBOMs, reproducible builds and supplier/product due diligence answer different questions and none alone proves that software is secure [SUP01][SUP02][SUP03][SUP04].
17. **Maintenance is a lifecycle discipline.** Compatibility, migration, technical debt, dependency support, deprecation and retirement need owners and evidence [MAINT01][LIFE01].
18. **AI changes the economics of generating candidate work, not the assurance obligation.** Productivity evidence remains heterogeneous; current studies show task- and context-dependent speedups/slowdowns, measurement bias and possible code-understanding trade-offs [AI07][AI08][AI10][AI11][AI13].
19. **AI-generated code is neither inherently secure nor inherently insecure.** Contemporary evidence shows current models can assist vulnerability detection/repair but still miss issues and answer confidently incorrectly; independent verification remains necessary [AI09][AI12].
20. **There is no universally best architecture, language, framework, test method, cloud platform or AI workflow.** Context, failure consequences, team/system constraints and evidence determine the appropriate choice [ARCHMS01][PL02][TEST02].

The practical doctrine is therefore:

> **Build the least complex system that can demonstrably satisfy its intended behavior and risk profile; make state, authority, ordering, boundaries and failure explicit; bound work and blast radius; verify what matters with evidence suited to the claim; make change observable and recoverable; and never let tools, standards, metrics, benchmarks or AI substitute for engineering judgment.**

---

# V2 research and sanity-check verdict

V2 is a **falsification, freshness and evidence-reweighting pass** over V1. The goal was not to reward V1 for having many sources. The audit asked four harder questions:

> **Is the source current? Does it support the exact claim? Is the claim truly universal? Does the rule survive adversarial use across low-risk product software, large distributed systems, AI/agentic systems, embedded systems and high-assurance contexts?**

The V2 research pass re-checked formal software-engineering standards, current security/privacy guidance, SRE/operations, supply-chain standards, accessibility, AI/agentic controls and newer 2026 empirical software-engineering research.

## What survived strongly

- Requirements and acceptance conditions must exist in a form precise enough to verify [REQ01].
- Quality must be treated as interacting attributes, never collapsed into a single universal score [QUAL01].
- Criticality and consequence should determine assurance rigor [VV01][NASA01].
- Information hiding, explicit state ownership, controlled dependencies and local reasoning remain durable design principles [MOD01][ARCH01].
- Security, privacy, reliability, maintenance and retirement are lifecycle concerns [SEC01][PRIV01][LIFE01][MAINT01].
- User-relevant reliability targets and controlled change remain stronger than prestige metrics [REL01][DORA01].
- Supply-chain integrity and release evidence are first-class engineering concerns [SUP01][SUP04].
- AI assistance does not remove ordinary correctness, security, testing, review or ownership obligations [AI03][AI04][AI11][AI12].

## What V2 strengthens

1. **Overload and backpressure become core failure-engineering concerns.** V1 discussed backpressure under scalability but underweighted queues, in-flight work, load shedding and retry amplification as cascading-failure mechanisms [RES01].
2. **Distributed ordering becomes explicit doctrine.** V2 adds causal/ordering assumptions as a first-class state-design issue rather than hiding them under generic concurrency advice [DIST01].
3. **Verification gets a stronger method-selection layer.** Property-based testing and formal specification/model checking are explicitly retained as contextual tools for invariants, state spaces and high-consequence coordination problems [TEST06][FORMAL01].
4. **Supply-chain assurance expands from artifacts to suppliers.** NIST SP 1326 (final July 2026) adds a current due-diligence layer around supplier provenance, resilience, foundational cyber practices and supply-chain tiers [SUP04].
5. **AI engineering distinguishes output volume from engineering outcome.** V2 explicitly protects code comprehension/ownership and measures accepted outcomes, rework, defects and review burden rather than generated lines or benchmark passes alone [AI10][AI11][AI14].
6. **Accessibility is updated to the current international status.** WCAG 2.2 is also ISO/IEC 40500:2025 [ACC01].

## What V2 corrects or downgrades

1. **NIST Privacy Framework 1.1 is not final.** As of the V2 cutoff it remains an Initial Public Draft; Privacy Framework 1.0 remains the established published framework [PRIV01].
2. **NIST SSDF 1.2 is not final.** SP 800-218 Rev. 1 / SSDF 1.2 remains an Initial Public Draft; SSDF 1.1 remains the final baseline [SEC01][SEC05].
3. **SLSA 1.1 is no longer the current specification.** V2 updates to approved SLSA v1.2 [SUP01].
4. **Early-2025 AI productivity results cannot be treated as a current universal estimate.** METR's February 2026 follow-up found serious task/developer selection and time-measurement problems and explicitly treats the newer estimate as unreliable for a precise current effect [AI08][AI10].
5. **AI benchmark passes are not equivalent to mergeable production work.** A 2026 METR maintainer-review study found a material gap between automated benchmark success and maintainer acceptance in its sampled repositories [AI14].
6. **Environmental sustainability is not an equal-weight requirement for every software change.** Resource and environmental impact remain engineering constraints when material by scale, domain, contract or policy; V2 avoids treating them as an identical optimization target for every project.
7. **Formal methods are neither only for safety-critical software nor a universal requirement.** Industrial evidence shows model checking can uncover difficult design problems in critical distributed systems, but it proves scoped properties of a model/specification—not that the specification itself is correct [FORMAL01].

## V2 doctrine

The evidence supports a hard distinction between **principles** and **prescriptions**:

```text
HARDER / MORE UNIVERSAL
intent
correctness
explicit invariants
controlled authority
state ownership
bounded failure
risk-proportional assurance
security/privacy by lifecycle
observable/recoverable change
maintainability/evolution

SOFTER / CONTEXTUAL
architecture style
language
framework
cloud
service decomposition
test distribution
branch strategy
formal method
AI tool/model
specific rollout mechanism
```

V2 therefore becomes stricter about **what must be protected** and more conservative about **how it must be implemented**.

# 1. How to use this playbook

This is the root standard for the engineering playbook system.

Use it to:

- define what “done”, “production-ready” and “safe to change” mean;
- establish quality and risk language across humans and AI agents;
- review architecture, implementation and operational decisions;
- select how much assurance a change requires;
- reject fashionable complexity without evidence;
- identify which specialist playbook or regulatory overlay must be added.

Do **not** use it as:

- a substitute for a language/runtime profile;
- a framework tutorial;
- a cloud vendor reference architecture;
- a safety certification standard;
- a legal opinion;
- a fixed process that every team must execute identically.

The master playbook owns **principles, quality attributes, decision logic and minimum controls**. Specialist playbooks own deeper implementation guidance.

---

# 2. Evidence model

Engineering guidance fails when different kinds of authority are forced into one fake ranking. A law, an ISO standard, a randomized study, an RFC and a decade of production experience answer different questions.

V2 therefore uses **evidence lanes + rule status**. The `E0–E8` labels remain for source auditing and continuity, but they are **not a single total ordering of truth**. Claim-source fit comes first.

## 2.1 Evidence lanes and source classes

| Code | Source class | Strongest legitimate use | Common misuse |
|---|---|---|---|
| **E0** | Binding law / regulation / contractual obligation | What is mandatory where scope applies | Treating legal mandate as proof of technical optimality |
| **E1** | International/formal technical standard | Normative terminology, process/quality/assurance baseline | Treating consensus standard as causal experiment or universal maximum |
| **E2** | Meta-analysis / systematic review | Average empirical effects, heterogeneity, state of evidence | Ignoring study quality, recency or boundary conditions |
| **E3** | Peer-reviewed controlled/large empirical research | What happened in the studied tasks/populations | Generalizing one population/tool/version to all engineering |
| **E4** | Government/security framework or open consensus specification | Risk/control model, interoperability/security consensus | Treating guidance/awareness list as certification or proof |
| **E5** | Mature large-scale operational evidence | Mechanisms demonstrated in real production systems | Cargo-culting scale-specific implementation into smaller/different systems |
| **E6** | Official language/platform/protocol documentation | Exact semantics and supported behavior of that technology | Inferring that choosing the technology is universally best |
| **E7** | Repeated practitioner pattern / field heuristic | Useful starting hypothesis and implementation pattern | Calling popularity “evidence” or hiding trade-offs |
| **E8** | Opinion, fashion, tradition or folklore | Idea generation only | Presenting slogans as engineering law |

### Claim-fit rule

Use the evidence lane that matches the claim:

```text
“What must we comply with?”              → E0 / scoped contract
“What does this standard require/define?” → E1 / E4
“What usually changes an outcome?”        → E2 / E3
“What survives real operations at scale?” → E5
“What exactly does this protocol do?”      → E6
“What is a useful pattern to try?”         → E7
```

A prestigious source cannot rescue a mismatched claim. Google operating something successfully does not prove causal optimality; a randomized experiment does not override a binding legal requirement; ISO does not prove one implementation maximizes performance.

## 2.2 Rule status

| Class | Meaning | Default treatment |
|---|---|---|
| **A — Universal principle** | Durable across most software contexts | Preserve unless a stronger scoped constraint conflicts |
| **B — Strong contextual principle** | Strong mechanism, but architecture/product/task matters | Use when the stated boundary conditions fit |
| **C — Risk/criticality control** | Required when consequence, threat, exposure or irreversibility crosses a threshold | Scale with criticality and evidence burden |
| **D — Heuristic/pattern** | Often useful organizing rule | Start here, then test against context |
| **E — Implementation choice** | Technology, architecture or process option | Never present as universal by default |
| **F — Dogma/anti-pattern claim** | Unsupported, dangerously absolute or misleading | Reject as a general rule |

## 2.3 Three kinds of “best practice”

Every recommendation should be recognizable as one of:

1. **Normative requirement** — required by a scoped law, contract, standard or platform semantic.
2. **Evidence-backed engineering principle** — supported by research, consensus or mature operational mechanisms within stated bounds.
3. **Pragmatic pattern** — useful because it often works, but neither mandatory nor proven optimal everywhere.

Never silently convert category 3 into category 1.

## 2.4 Freshness and version status

Fast-moving facts require explicit status:

- regulations: effective dates and applicability;
- standards: published vs draft vs withdrawn;
- security frameworks: current released version;
- protocols/platforms: current semantics/documentation;
- AI studies: model/tool generation, study date, task and population.

A newer draft can inform future direction without silently replacing the current final standard [SEC05][REQ01].

## 2.5 Triangulation rule

For consequential universal claims, prefer triangulation across more than one lane when possible:

```text
NORMATIVE BASELINE
+ EMPIRICAL / MECHANISTIC EVIDENCE
+ OPERATIONAL EXPERIENCE
+ LOCAL SYSTEM EVIDENCE
```

Local production evidence can overturn an implementation hypothesis; it does not erase scoped legal, safety or security obligations.

# 3. Scope and non-scope

## 3.1 In scope

This master applies to the engineering of:

- websites and web applications;
- backend services and APIs;
- desktop and mobile applications;
- data platforms and software engines;
- distributed/cloud systems;
- AI/ML/LLM-enabled systems;
- agentic systems with tools and autonomy;
- infrastructure and deployment software;
- embedded and systems software;
- smart contracts and other software where state transitions have material consequences.

## 3.2 Specialist topics intentionally deferred

Detailed prescriptions belong to specialist playbooks for:

- architecture/system design;
- security;
- privacy;
- testing/quality engineering;
- reliability/SRE;
- performance/scalability;
- supply chain/CI/CD;
- cloud/infrastructure;
- databases/data;
- distributed systems/APIs;
- web, backend, mobile/desktop;
- AI/ML/LLM;
- agentic AI;
- blockchain/smart contracts;
- embedded/real-time;
- specific languages/runtimes.

## 3.3 Regulatory and domain overlays

High-risk contexts may require overlays such as:

- safety-critical;
- healthcare/medical devices;
- automotive;
- aviation;
- finance/payments;
- public sector;
- EU software/cybersecurity/data/AI regulation;
- critical infrastructure;
- high-assurance cryptographic or smart-contract systems.

An overlay may make a normally contextual control mandatory.

## 3.4 Professional responsibility and engineering economics

Software engineering is a socio-technical profession, not only a code-production activity. SWEBOK treats professional practice and software engineering economics as first-class knowledge areas, while the ACM Code of Ethics makes wider impact, competence, honesty, privacy, security and the public good explicit professional responsibilities [BODY01][ETH01].

Universal implications for this playbook:

- **Do not conceal material risk, uncertainty, limitations or known failure modes from decision-makers or affected stakeholders.**
- **Work within competence, or obtain appropriate review/expertise when consequence exceeds it.**
- **Treat security, privacy, safety, accessibility, licensing and user impact as engineering responsibilities where applicable, not external polish.**
- **Evaluate alternatives on lifecycle value and total cost, not implementation cost alone.** Acquisition, migration, operations, incidents, dependency risk, maintenance and retirement can dominate lifetime economics.
- **Time-to-market and cost are legitimate constraints, but they do not erase material quality, safety, legal or ethical obligations.** Reduce scope or assurance only with explicit risk ownership.
- **Engineering evidence must be communicated honestly.** A passing test, benchmark, audit, metric or AI-generated explanation must not be represented as stronger assurance than it provides.

This master does not replace organizational management, finance or professional codes. It treats their material constraints as inputs to sound engineering judgment.

---

# 4. Universal software quality model

ISO/IEC 25010:2023 provides the core product-quality reference model with nine characteristics [QUAL01]. A universal **engineering** standard must additionally reason about intent, lifecycle, operations, change safety, supply-chain evidence and risk. V2 therefore uses a synthesis rather than pretending that every row below is an ISO characteristic.

## 4.1 Fifteen engineering quality questions

### 1. Intent and value alignment
Does the system solve the intended problem for the intended users/stakeholders under real constraints?

### 2. Functional correctness
Does observable behavior satisfy its contract, including important edge cases and invariants?

### 3. Safety
Can failure cause unacceptable harm to people, assets, critical processes or the environment? If the credible consequence is negligible, safety assurance need not dominate the process.

### 4. Security
Can the system resist unauthorized access, misuse, tampering and exploitation within its threat model?

### 5. Privacy
Does the system collect, infer, retain, expose and process personal/sensitive data only as justified and controlled?

### 6. Data and state integrity
Can state become invalid, contradictory, duplicated, lost, reordered or silently corrupted?

### 7. Reliability and resilience
Does the system continue to meet user-relevant expectations under normal variation and plausible failure, and can it recover?

### 8. Performance and capacity
Does the system meet latency, throughput, concurrency, resource and capacity requirements under relevant workloads and overload conditions?

### 9. Interoperability and compatibility
Can components, versions and external systems interact without unintended breakage?

### 10. Interaction quality and accessibility
Can intended users complete tasks effectively, including users with accessibility needs where an interface exists [ACC01]?

### 11. Operability and observability
Can operators understand, control, diagnose, protect and restore the system?

### 12. Maintainability and evolvability
Can the system be understood, tested, changed and extended without disproportionate cost or risk?

### 13. Delivery safety and recoverability
Can changes be introduced incrementally, detected when harmful and rolled back/forward or otherwise recovered from without unacceptable impact?

### 14. Resource, economic and environmental efficiency
Does delivered value justify compute, storage, network, energy, licensing and human operational cost? Environmental impact becomes a material engineering requirement when scale, domain, contract, regulation or organizational goals make it material; it is not an identical optimization target for every change.

### 15. Supply-chain and provenance integrity
Can the organization establish which source, dependencies, suppliers, build process and artifacts produced the released system, and assess material supplier risk [SUP01][SUP04]?

## 4.2 Core questions vs conditional emphasis

Every project should **ask** all fifteen questions, but not every project should invest equally in all fifteen.

| Posture | Examples |
|---|---|
| **Always establish** | intended behavior, correctness, state integrity, security baseline, change/ownership, maintainability, evidence appropriate to risk |
| **Material when exposed** | privacy, interoperability, accessibility, external supply chain, network resilience |
| **Escalate with consequence** | safety, formal assurance, disaster recovery, fraud/financial integrity, cryptographic/key custody |
| **Escalate with scale/workload** | capacity, overload control, cost, energy/environmental efficiency, multi-region distribution |

The rule is not “optimize everything.” It is **identify what becomes unacceptable if neglected**.

## 4.3 Quality is not one number

Do not collapse these qualities into a fake universal score. A medical device, advertising website, smart contract, embedded controller and internal analytics tool legitimately have different quality profiles.

The correct question is:

> **Which qualities are material here, what threshold is acceptable, what evidence demonstrates it, and what happens if that evidence is wrong?**

# 5. Criticality and assurance model

“Highest standard” does not mean “maximum ceremony everywhere.” It means **sufficient assurance for the consequence of failure**.

## 5.1 Five criticality levels

| Level | Typical consequence | Default assurance posture |
|---|---|---|
| **C0 — Experimental** | Disposable prototype, no material users/data/value | Fast learning; basic security/hygiene; explicit non-production status |
| **C1 — Ordinary** | Limited operational impact, recoverable inconvenience | Normal automated tests/review/monitoring/backup discipline |
| **C2 — Material** | Revenue, customer data, important business operations | Stronger threat model, staged rollout, recovery drills, deeper verification |
| **C3 — High assurance** | Major financial, privacy, security or societal impact | Independent review, stronger segregation, formalized evidence, extensive failure testing |
| **C4 — Safety/mission critical** | Serious injury, loss of life or catastrophic/mission loss | Domain-certified processes, hazard analysis and potentially formal verification; specialist standard governs |

IEEE 1012 explicitly scales verification and validation rigor by integrity level, supporting the core principle that assurance should increase with consequence rather than being uniform [VV01]. NASA software assurance similarly classifies software and assurance obligations by criticality [NASA01].

## 5.2 Criticality is multidimensional

Assess at least:

- human/safety consequence;
- security exposure;
- privacy sensitivity;
- financial consequence;
- data irreversibility;
- operational dependency;
- number and vulnerability of affected users;
- blast radius;
- recoverability;
- regulatory/contractual obligation;
- novelty/uncertainty;
- autonomy and permissions, especially for agents.

## 5.3 Assurance selection rule

```text
FAILURE CONSEQUENCE
× EXPOSURE
× IRREVERSIBILITY
× UNCERTAINTY
× BLAST RADIUS
× AUTONOMY
÷ (RECOVERABILITY × DETECTABILITY)
= REQUIRED ASSURANCE
```

This is a decision model, not a literal arithmetic formula. `AUTONOMY` raises the assurance burden when software/agents can act without timely review. `DETECTABILITY` reduces practical risk only when harmful deviation is likely to be discovered before unacceptable consequence.

---

# 6. Universal lifecycle model

ISO/IEC/IEEE 12207:2026 treats software across the full lifecycle and explicitly does not prescribe one development methodology [LIFE01]. V2 therefore treats lifecycle stages as **responsibilities**, not a waterfall.

```text
INTENT
→ REQUIREMENTS / CONSTRAINTS
→ ARCHITECTURE / DESIGN
→ IMPLEMENTATION
→ VERIFICATION / VALIDATION
→ REVIEW / INTEGRATION
→ RELEASE / DEPLOYMENT
→ OBSERVATION / OPERATION
→ LEARNING / INCIDENT FEEDBACK
→ MAINTENANCE / EVOLUTION
→ DEPRECATION / RETIREMENT
```

In iterative delivery these responsibilities may happen continuously and concurrently.

For every material change, ask:

1. What behavior are we changing?
2. What assumptions/constraints are relevant?
3. What can fail?
4. What evidence makes us confident?
5. How will we know after release?
6. How do we contain or reverse harm?
7. What documentation/ownership must remain after the change?

---

# 7. The Golden Engineering Standards

These are the V2 root rules. They are intentionally mechanism-oriented rather than technology-oriented.

1. **Start from intended outcomes, users, constraints and unacceptable failure—not from a preferred stack.**
2. **Make material requirements observable enough to verify [REQ01].**
3. **Separate functional behavior from quality attributes and operational constraints.**
4. **Record consequential assumptions; unrecorded assumptions become latent defects.**
5. **Classify criticality before deciding how much assurance is enough [VV01][NASA01].**
6. **Increase assurance with consequence, exposure, irreversibility, uncertainty, blast radius and autonomy.**
7. **Prefer the least complex design that satisfies demonstrated requirements and credible constraints.**
8. **Minimize accidental complexity; preserve essential domain complexity.**
9. **Use information hiding to isolate decisions likely to change [MOD01].**
10. **Prefer high cohesion and controlled coupling over arbitrary layer count.**
11. **Make ownership of modules, state, credentials and operational responsibilities explicit.**
12. **Treat architecture as quality trade-offs and consequential decisions, not diagram compliance [ARCH01][ARCH02].**
13. **Do not introduce distributed-system complexity without a requirement that earns it.**
14. **Do not infer causal or total ordering from wall-clock timestamps unless the system provides that guarantee [DIST01].**
15. **Define consistency and conflict semantics wherever multiple actors can update the same logical state.**
16. **Give each persistent fact a source of truth and lifecycle.**
17. **Represent important invariants in enforceable structures where practical: types, schemas, constraints, transactions, state machines or policy.**
18. **Make invalid or unauthorized states difficult to create and visible when they occur.**
19. **Validate untrusted input at trust boundaries; internal hops do not magically create trust.**
20. **Define interface contracts for success, failure, timeout, cancellation, versioning and compatibility—not only the happy schema.**
21. **Prefer backward-compatible evolution while consumers still depend on the old contract; deprecate deliberately.**
22. **Treat partial failure as normal whenever work spans processes, machines, providers or independent transactions.**
23. **Give remote/dependent work a finite total deadline or cancellation policy; infinite waiting is an undefined resource/failure policy.**
24. **Retry only plausibly transient failures that are safe to repeat and still fit the total time/resource budget [PROTO01][RES01].**
25. **Budget retries across layers; independent retry loops can multiply load and make an outage worse [RES01].**
26. **Use backoff/jitter or equivalent de-correlation when synchronized retries can amplify failure.**
27. **Design idempotency/deduplication wherever duplicate delivery or retry is plausible.**
28. **Bound queues, in-flight concurrency and resource admission where overload can exhaust the system [RES01].**
29. **Prefer early load shedding or explicit degraded service over uncontrolled saturation when the domain permits it [RES01].**
30. **Load-test capacity and the overload failure mode—not only the happy throughput number [RES01].**
31. **Prefer explicit failure over silent corruption.**
32. **Define restoration and data-loss objectives where availability/durability matter; test restoration.**
33. **Design security through the lifecycle; a final penetration test cannot retroactively create secure architecture [SEC01][SEC02].**
34. **Default to least privilege and deny-by-default where unauthorized capability is material.**
35. **Separate authentication, authorization and business policy; identity alone does not grant action.**
36. **Threat-model assets, actors, boundaries, abuse paths and recovery for material systems.**
37. **Keep security frameworks version-aware: final standards govern baseline; drafts inform future direction [SEC01][SEC05].**
38. **Treat secrets as short-lived, scoped and auditable where platform capability permits; avoid unnecessary duplicated long-lived credentials.**
39. **Prefer memory-safe implementation paths for new security-sensitive code when practical, while treating migration constraints explicitly [MSAFE01][MSAFE02].**
40. **Treat privacy as its own risk discipline; secure storage does not justify unnecessary collection [PRIV01].**
41. **Minimize sensitive data by purpose, access, retention and replication.**
42. **Set reliability objectives from user-relevant behavior and consequence, not infrastructure vanity metrics [REL01].**
43. **Do not default to 100% reliability; allocate reliability effort where failure consequence justifies it [REL01].**
44. **Instrument critical paths so failures can be detected before users become the primary monitoring system.**
45. **Measure latency as a distribution and include tail behavior when user experience or capacity depends on it.**
46. **Use traffic, errors, latency and saturation as a strong baseline for online services, then add domain signals [REL03].**
47. **Logs, metrics and traces are telemetry; observability is the ability to answer operational questions from evidence [OBS01].**
48. **Every paging alert should imply a meaningful human or automated action.**
49. **Measure before optimizing unless a known hard constraint requires design-time optimization.**
50. **Optimize end-to-end outcomes before local microbenchmarks.**
51. **Treat scalability as multiple dimensions: workload, data, geography, organization, dependency and failure.**
52. **Treat resource/cost efficiency as an engineering requirement when it can materially affect viability, scale or external impact.**
53. **Design long-lived systems for change: schemas, contracts, dependencies, data and deployment environments will evolve.**
54. **Keep changes as small as reasonably possible without fragmenting one coherent outcome.**
55. **Make material changes observable after release.**
56. **Prefer reversible changes; where reversal is impossible, increase pre-release assurance.**
57. **Separate deploy from release when independent exposure control materially reduces risk.**
58. **Use progressive exposure/canaries when representative production evidence is valuable and blast radius justifies it [REL02].**
59. **A rollback plan is valid only if state, schema and external side effects remain compatible with rollback.**
60. **Use roll-forward when rollback would recreate or amplify corruption; decide intentionally.**
61. **Automate repeatable deterministic verification when automation reliably reduces error and latency.**
62. **Do not automate a poorly understood unsafe process merely to make it faster.**
63. **Choose verification methods from failure modes and required assurance, not from a fixed test pyramid [VV01].**
64. **Treat code coverage as diagnostic execution evidence, never proof of correctness [TEST01][TEST04].**
65. **Test invariants, boundaries, error paths, concurrency/state transitions and recovery—not only happy examples.**
66. **Use property-based testing when generative inputs and invariant properties can explore meaningful state/input space more effectively than hand-picked examples [TEST06].**
67. **Use fuzzing where malformed/unexpected input is a material risk [TEST05].**
68. **Use formal specification/model checking when scoped high-consequence coordination or state-machine properties justify the modeling cost [FORMAL01].**
69. **Formal verification proves only the modeled property under the model/assumptions; validate the specification itself.**
70. **Code review should focus human attention on semantics, risk, maintainability and knowledge transfer—not formatting a tool can enforce [REVIEW01][REVIEW02].**
71. **Prefer machine-enforced formatting and deterministic checks over recurring style debate.**
72. **Document why consequential decisions exist, what assumptions support them and what would trigger reconsideration.**
73. **Keep documentation close enough to reality that drift becomes detectable.**
74. **Dependencies create both capability and liability; add them intentionally and remove unused ones.**
75. **Pin/lock high-risk build dependencies for reproducibility, then monitor and deliberately update them [GH01].**
76. **Use provenance and SBOMs as evidence layers, not security certificates [SUP01][SUP02][SUP03].**
77. **Evaluate material suppliers/products, not only package names; provenance, resilience and supply-chain tiers can matter [SUP04].**
78. **Use reproducible/deterministic builds where independent artifact verification materially improves assurance [BUILD01].**
79. **Treat production configuration, policy and privileged workflows as controlled engineering state.**
80. **Practice backup restoration; an untested backup is an unverified recovery hypothesis.**
81. **Run incident reviews to improve system conditions and controls, not to manufacture a single-person story for complex failure.**
82. **Track technical debt by consequence, option loss and change friction—not aesthetic dislike.**
83. **AI-generated code, SQL, configuration, tests and tool calls are untrusted until validated [AI03][AI04].**
84. **AI assistance does not lower review, security or testing requirements for a change.**
85. **Measure AI engineering impact on accepted outcomes, quality, rework, review load, defects and time—not generated lines, tokens or self-reported speed alone [AI10][AI11].**
86. **Preserve sufficient human/team understanding of critical code and system behavior; higher throughput that destroys code ownership can create deferred risk [AI11].**
87. **Treat benchmark success as evidence about the benchmark, not automatic evidence of mergeability or production usefulness [AI14].**
88. **Scale agent autonomy with capability, consequence, permissions, observability, auditability and reversibility [AI05][AI06].**
89. **Keep authorization outside model persuasion: an AI may propose an action; policy/enforcement determines whether it is allowed.**
90. **When evidence is weak, fast-moving or context-sensitive, preserve uncertainty and make the boundary condition part of the rule.**

## 7.1 Traceability of the Golden Standards

The 90 rules are a **synthesis layer**, not 90 claims copied from one authority. Inline IDs mark rules tightly bound to a specific source; rules without an inline ID are derived from the cited body sections and should be read with their stated boundary conditions. This prevents a consensus standard, empirical study, operational practice and V2 synthesis from being given false equivalence.

| Rules | Primary body support | Evidence families most relevant |
|---|---|---|
| 1–6 | §§4–8 | [REQ01][VV01][NASA01][QUAL01] |
| 7–13 | §§10–12 | [MOD01][ARCH01][ARCH02][BODY01] |
| 14–32 | §§9, 13, 16–18 | [DIST01][PROTO01][RES01][REL01][REL03] |
| 33–41 | §§14–15 | [SEC01][SEC02][SEC05][MSAFE01][MSAFE02][PRIV01] |
| 42–52 | §§16–18 | [REL01][REL02][REL03][OBS01][QUAL01] |
| 53–62 | §§19, 26–31 | [LIFE01][MAINT01][REL02][DORA01] |
| 63–73 | §§24–25 | [VV01][TEST01][TEST04][TEST05][TEST06][FORMAL01][REVIEW01][REVIEW02] |
| 74–82 | §§22, 28–31 | [GH01][SUP01][SUP02][SUP03][SUP04][BUILD01][MAINT01] |
| 83–90 | §§32–33, 51 | [AI03][AI04][AI05][AI06][AI10][AI11][AI14] |

The table is a navigation aid, not a claim that every source supports every sentence in its range. Exact findings and limitations remain in the evidence map.

---

# 8. Intent, requirements and acceptance

Software cannot be judged correct without an intended behavior, environment and set of constraints. ISO/IEC/IEEE 29148 treats requirements engineering as a lifecycle discipline rather than a one-time document [REQ01].

## 8.1 Start with the problem, not the stack

Before choosing architecture or tools, establish:

- user/stakeholder problem;
- system boundary;
- actors and trust boundaries;
- required behavior;
- forbidden behavior;
- data involved;
- latency/availability/security/privacy expectations;
- operational environment;
- external dependencies;
- regulatory/contractual constraints;
- expected change horizon;
- known unknowns.

A technology choice made before these constraints are understood is a hypothesis, not a design conclusion.

## 8.2 Functional vs quality requirements

A requirement such as “users can submit an order” is incomplete when the relevant outcome also depends on:

- acceptable response time;
- authentication/authorization;
- idempotency;
- durability;
- auditability;
- accessibility;
- privacy;
- retry behavior;
- failure message;
- capacity;
- recovery objective.

When a quality attribute can make the feature fail in practice, it belongs in the requirement set.

## 8.3 Acceptance criteria

Prefer acceptance criteria that are:

- observable;
- testable or otherwise verifiable;
- tied to a user/system outcome;
- explicit about important edge/failure cases;
- measurable when a threshold actually matters.

Weak:

> The service should be fast and reliable.

Stronger:

> For the checkout confirmation path, 99.9% of successful requests measured over a rolling 30-day window should complete within the agreed latency SLO, excluding explicitly documented maintenance windows and client-side failures.

The exact target remains contextual; the improvement is making the promise verifiable.

## 8.4 Assumption ledger

Material assumptions should be recorded where a future maintainer can discover them. Examples:

- expected maximum payload size;
- clock/timezone assumptions;
- uniqueness assumptions;
- ordering assumptions;
- third-party rate limits;
- data-retention assumptions;
- maximum concurrency;
- network trust assumptions;
- expected model/tool behavior in an AI system.

When an assumption is safety-, security- or data-critical, convert it into an enforced invariant or monitored condition where feasible.

## 8.5 Requirements anti-patterns

Avoid:

- requirements that only name a solution (“use Kafka”) without the need it serves;
- undefined terms such as “real-time”, “secure”, “scalable” or “AI-native”;
- acceptance criteria that merely restate implementation details;
- ignoring operational/maintenance requirements until release;
- treating a mockup as the complete behavioral specification;
- assuming “edge cases” are too rare to matter when their consequence is high.

---

# 9. Correctness, invariants and state

Correctness is not “the code runs.” It is the degree to which observable behavior satisfies the intended contract under relevant conditions.

## 9.1 Define invariants

Examples:

```text
account_balance = sum(valid_posted_ledger_entries)

order.status = SHIPPED
→ payment.authorized = true
→ shipment_id exists

user.role != ADMIN
→ privileged_action cannot succeed
```

The value of an invariant is that it states what must remain true independent of implementation path.

## 9.2 Invalid states

Where practical, design types, schemas, constructors, state machines and validation so invalid states are difficult to represent or persist.

This does **not** mean every possible invariant belongs in the static type system. Runtime systems still need boundary validation, database constraints and operational checks.

## 9.3 State ownership

For each material state, know:

```yaml
source_of_truth:
owner:
writers:
readers:
consistency_model:
mutation_rules:
retention:
backup_recovery:
classification:
```

Ambiguous ownership is a common source of race conditions, duplicate truth and irreconcilable data.

## 9.4 Concurrency, ordering and time

Concurrency requires explicit rules for:

- which operations may overlap;
- which state transitions must be serialized;
- conflict resolution;
- idempotency/deduplication;
- cancellation;
- lock/version ownership;
- ordering guarantees and their scope.

For distributed systems, distinguish:

```text
physical / wall-clock time
logical / causal order
message delivery order
commit / serialization order
user-visible order
```

Lamport's foundational result formalizes that distributed events naturally form a partial causal ordering; one cannot safely infer a globally meaningful “first” event merely from unsynchronized or imperfect physical clocks [DIST01].

Practical consequences:

- do not use wall-clock timestamps alone as a universal conflict-resolution mechanism;
- document when ordering is per-key, per-partition, causal, transactional or globally serialized;
- design duplicate/out-of-order event handling where transports can produce it;
- treat clock skew and leap/time-source behavior as explicit assumptions when time changes correctness;
- use monotonic elapsed-time sources for local durations when available rather than wall-clock time.

If correctness depends on one global order, the architecture must actually provide and verify that guarantee.

## 9.5 Data integrity controls

Use the strongest appropriate layer:

- type/domain constraints;
- application validation;
- schema constraints;
- unique keys;
- foreign keys;
- transaction boundaries;
- checksums/hashes where relevant;
- append-only/audit mechanisms when justified;
- reconciliation jobs;
- repair tooling.

Defense in depth is particularly valuable for high-consequence invariants.

---

# 10. Simplicity, complexity and abstraction

## 10.1 Essential vs accidental complexity

Some complexity belongs to the problem: distributed state, regulatory rules, pricing logic, synchronization, real-time constraints. Other complexity is introduced by the solution: unnecessary layers, generic frameworks, excessive indirection, duplicate state, ornamental architecture.

The engineering objective is not “minimum code.” It is:

> **minimum unjustified complexity for the required behavior, risk and future change horizon.**

## 10.2 KISS with boundaries

KISS is strongest when interpreted as:

- direct over clever;
- explicit over magical when correctness matters;
- known requirement over speculative flexibility;
- one source of truth over synchronized duplicates;
- boring, well-understood mechanisms over novelty without payoff;
- local reasoning over hidden global behavior.

It does **not** justify:

- ignoring security;
- deleting necessary error handling;
- hardcoding business rules likely to vary;
- building an unstructured “simple” monolith with global coupling;
- omitting tests or observability.

## 10.3 Abstraction threshold

Abstract when several of these are true:

- the duplicated concept is actually the same domain rule;
- simultaneous change is already recurring;
- a stable policy/boundary must be enforced;
- substitutability is a real requirement;
- the abstraction reduces total cognitive/change cost;
- the interface can be named in domain terms without leaking all implementation details.

Delay abstraction when:

- similarity may be accidental;
- requirements are still diverging;
- abstraction requires many flags/modes;
- callers still need implementation knowledge;
- the generic layer is larger/more complex than explicit code.

## 10.4 DRY correctly interpreted

The useful principle behind DRY is avoiding **multiple independent representations of the same knowledge**. Literal code duplication is not always knowledge duplication.

Prefer a small amount of explicit duplication over a premature shared abstraction that couples unrelated change paths.

## 10.5 Cognitive load budget

Every mechanism consumes mental capacity:

- frameworks;
- service boundaries;
- custom DSLs;
- metaprogramming;
- asynchronous flows;
- inheritance;
- generic type machinery;
- implicit configuration;
- distributed transactions;
- feature flag combinations.

Treat cognitive load as a limited system resource, especially for systems expected to live for years.

---

# 11. Architecture, modularity and boundaries

Software architecture is the set of structures and decisions that materially constrain quality attributes, system evolution and risk [ARCH01]. Architecture evaluation methods such as ATAM make trade-offs and quality-attribute scenarios explicit rather than treating architecture as aesthetic preference [ARCH02].

## 11.1 Architecture starts from quality attributes

Do not ask:

> Should we use microservices?

Ask:

- what must scale independently?
- what failure isolation is needed?
- what deployment independence matters?
- what latency budget exists?
- what consistency is required?
- what team/ownership boundaries exist?
- what operational complexity can we support?

The architecture follows from those constraints.

## 11.2 Information hiding

Parnas' information-hiding principle remains durable: modules should encapsulate design decisions likely to change rather than merely grouping steps in an execution sequence [MOD01].

Good boundaries hide things such as:

- storage representation;
- third-party vendor specifics;
- authentication mechanics;
- serialization format;
- calculation policy;
- caching strategy;
- model provider implementation.

## 11.3 Cohesion and coupling

Aim for:

- high semantic cohesion inside a module/service;
- explicit, narrow contracts across boundaries;
- controlled dependency direction;
- minimal shared mutable state;
- ownership aligned with responsibility.

Coupling cannot be eliminated. The objective is to put it where its consequences are understood and manageable.

## 11.4 Architecture decision records

Record consequential decisions with:

```yaml
title:
status: proposed | accepted | superseded | deprecated
context:
decision:
alternatives:
quality_attributes_affected:
tradeoffs:
risks:
assumptions:
reversal_cost:
evidence:
review_trigger:
```

Do not write ADRs for trivial choices. Use them where future teams will otherwise ask “why is this like this?”

## 11.5 Architecture fitness

Architecture should be continuously tested against relevant fitness properties:

- dependency rules;
- performance budgets;
- API compatibility;
- security boundaries;
- deployment independence;
- data ownership;
- recovery behavior.

A diagram that no longer matches the executable system is documentation debt, not architecture governance.

---

# 12. Interfaces, contracts and compatibility

## 12.1 A contract is more than a schema

A robust interface contract can include:

- accepted inputs;
- validation rules;
- output shape;
- authorization semantics;
- error/failure semantics;
- idempotency;
- ordering;
- timeout expectations;
- consistency/freshness;
- rate/capacity constraints;
- version/deprecation policy.

## 12.2 Trust boundaries

Validate at the point where trust changes:

```text
internet → edge/API
client → server
service A → service B (when trust differs)
model → tool
user-controlled file → parser
CI input → privileged build step
third-party webhook → internal state
```

Validation means semantic validation, not merely successful parsing.

## 12.3 Compatibility

For live contracts, prefer staged evolution:

```text
EXPAND
→ DEPLOY COMPATIBLE READERS/WRITERS
→ MIGRATE/OBSERVE
→ REMOVE OLD PATH
→ CONTRACT
```

This applies to APIs, event schemas, database schemas and configuration contracts.

## 12.4 Versioning

Version only when there is a compatibility need; version numbers do not themselves create compatibility.

Maintain a deprecation policy for externally consumed contracts:

- announcement;
- migration path;
- usage telemetry where appropriate;
- support window;
- owner;
- final removal criteria.

---

# 13. Failure engineering, resilience and recovery

Failure engineering is not a collection of resilience patterns. It is the explicit design of what happens when assumptions become false.

## 13.1 Failure is a design input

For each material dependency or operation, ask:

```text
What if it is slow?
What if it is unavailable?
What if it returns malformed, stale or inconsistent data?
What if the request is duplicated or reordered?
What if the caller disconnects or cancels?
What if only half the operation succeeds?
What if capacity is exhausted?
What if recovery happens while another recovery is running?
```

## 13.2 Deadlines, timeouts and cancellation

Remote or resource-consuming work needs a finite policy for abandonment/cancellation. A timeout value should be derived from:

- upstream user/request deadline;
- downstream latency distribution;
- retry policy;
- consequence of abandonment;
- concurrency/resource limits;
- whether timed-out work actually stops downstream.

A timeout that causes the caller to give up while the downstream continues expensive work can worsen overload. Propagate cancellation/deadlines where the protocol/runtime supports it.

## 13.3 Retries and retry budgets

RFC 9110 distinguishes safe/idempotent semantics and cautions automatic retries of non-idempotent requests unless the client knows they are safe [PROTO01]. Google SRE's cascading-failure guidance also shows how retries after missed deadlines can add load to an already overloaded service [RES01].

Retry only when:

- failure is plausibly transient;
- operation is idempotent, deduplicated or known not to have applied;
- retry stays inside the total deadline/resource budget;
- retry will not violate rate/financial/side-effect constraints;
- overload policy permits it.

Avoid independent retry loops at many layers. If three layers each retry three times, one user operation can expand into many downstream attempts. Define **where retries live** and a bounded retry budget.

Use backoff/jitter or another de-correlation mechanism when clients can synchronize their retries.

## 13.4 Idempotency and duplicate handling

Common mechanisms:

- idempotency keys;
- unique transaction keys;
- compare-and-set/version conditions;
- deduplication tables/windows;
- state-machine guards;
- transactional outbox/inbox patterns where appropriate.

“Exactly once” should be treated skeptically unless every relevant boundary and failure mode genuinely provides the guarantee. Many robust systems implement the required business outcome through at-least-once delivery plus idempotent effects.

## 13.5 Bounded work, queues and backpressure

Unbounded work is an availability defect when traffic can exceed service capacity.

Google SRE documents server overload as a common trigger of cascading failure: increased latency raises in-flight work, queues grow, resources exhaust, health checks fail and retries add more load [RES01].

For workload-bearing components, explicitly decide:

- maximum in-flight concurrency;
- queue bound and queueing policy;
- admission control/rate limit;
- overload signal;
- which work can be rejected, delayed or degraded;
- per-tenant/fairness isolation where needed;
- upstream backpressure mechanism.

Queueing can absorb bounded bursts. It cannot make sustained demand greater than capacity disappear.

## 13.6 Load shedding and graceful degradation

When the domain permits it, fail early and cheaply before saturation turns into total collapse [RES01].

Possible strategies:

- reject low-priority work;
- shed requests above a safe in-flight limit;
- serve cached/stale-but-acceptable reads;
- omit expensive optional features;
- switch to read-only/manual paths;
- reduce result quality/precision when explicitly acceptable.

Degradation must **not** silently weaken authorization, privacy, financial correctness, safety constraints or data integrity.

Exercise degraded paths. Rarely used fallback code is unverified code.

## 13.7 Isolation and blast-radius control

Use isolation when shared resource exhaustion can cascade:

- independent worker pools;
- per-tenant quotas;
- bulkheads/resource partitions;
- circuit breaking where state/control complexity is justified;
- separate critical from best-effort work;
- provider/region fallback where the added complexity earns its cost.

Isolation spends resources and complexity; apply it to material failure domains rather than mechanically everywhere.

## 13.8 Recovery objectives

Where data/service loss matters, define:

- **RTO** — acceptable restoration time;
- **RPO** — acceptable data-loss window;
- restoration procedure;
- dependency prerequisites;
- recovery ordering;
- validation after restore;
- authority for declaring recovery complete.

Backups are not enough. Periodically demonstrate restoration and, for high criticality, recovery under representative dependency-loss conditions.

# 14. Security engineering baseline

NIST SSDF defines secure software-development practices intended to integrate into varied SDLCs rather than replace them [SEC01]. CISA Secure by Design similarly emphasizes security as a core product objective and safe defaults [SEC02]. OWASP ASVS provides a more concrete application-security verification baseline [SEC03].

**Version-status rule:** NIST SP 800-218 / SSDF v1.1 remains the current final publication at the 27 September 2026 cutoff. SP 800-218 Rev. 1 / SSDF v1.2 is an Initial Public Draft whose comment period has closed but which is not yet final [SEC05]. NIST NCCoE's 2026 DevSecOps live document provides current implementation demonstrations aligned to SSDF, but it remains a live/draft practice guide rather than a replacement normative baseline [DEVSEC01].

## 14.1 Security principles

- secure by design;
- secure by default;
- least privilege;
- complete mediation at authorization boundaries;
- minimize attack surface;
- defense in depth for high-consequence controls;
- explicit trust boundaries;
- strong identity for privileged actors/services;
- secrets separation;
- fail securely;
- audit material security events;
- vulnerability lifecycle ownership.

## 14.2 Threat modeling

For material changes, identify:

```yaml
assets:
actors:
trust_boundaries:
entry_points:
privileged_actions:
data_flows:
likely_threats:
misuse_cases:
controls:
residual_risk:
verification:
```

Threat modeling is most valuable before architecture is expensive to change.

## 14.3 Authentication and authorization

Authentication answers **who/what is this?**  
Authorization answers **may this principal perform this action on this resource in this context?**

Do not infer authorization from:

- possession of a UI route;
- client-side flags;
- hidden controls;
- object identifiers;
- role names without resource/action checks.

For high-value systems, prefer centralized policy semantics with distributed enforcement where it reduces inconsistency.

## 14.4 Secrets

Secrets should be:

- external to source code;
- scoped to least privilege;
- short-lived where practical;
- rotatable;
- auditable;
- unavailable to untrusted build steps;
- excluded from logs/error reports.

GitHub recommends least workflow permissions and pinning third-party Actions to full-length commit SHAs as key supply-chain controls [GH01][GH02]. OIDC can replace long-lived cloud credentials in supported CI/CD flows [GH03].

## 14.5 Memory safety

Memory-safe languages eliminate or strongly reduce broad classes of memory-corruption vulnerabilities. CISA and major platform/security organizations recommend memory-safe roadmaps where feasible for security-sensitive software [MSAFE01][MSAFE02].

This is a **strong contextual principle**, not a claim that every legacy C/C++ system should be immediately rewritten.

## 14.6 Security verification

Depending on risk, combine:

- code review;
- static application security testing;
- dependency scanning;
- secret scanning;
- dynamic testing;
- fuzzing;
- authorization tests;
- threat-model review;
- penetration testing;
- formal methods for high-consequence components.

A penetration test cannot compensate for insecure architecture or unknown asset ownership.

---

# 15. Privacy and data-protection engineering

Privacy risk is not reducible to confidentiality. NIST's Privacy Framework treats privacy as a distinct risk-management discipline [PRIV01]. At the V2 cutoff, Privacy Framework 1.1 remains an **Initial Public Draft**; do not silently cite it as a final standard. Use current published law/requirements for compliance and treat the draft as directional guidance where useful.

The NIST Privacy Framework treats privacy risk as a distinct organizational/engineering concern rather than a subset of cybersecurity [PRIV01].

## 15.1 Privacy engineering questions

For every personal/sensitive data element:

```yaml
what_is_collected:
why_needed:
source:
legal_policy_basis_if_applicable:
users_affected:
where_stored:
who_can_access:
where_sent:
retention:
deletion:
backup_behavior:
telemetry_exposure:
model_training_or_inference_use:
```

## 15.2 Data minimization

Collecting data “in case it is useful later” creates:

- breach impact;
- compliance scope;
- access-control complexity;
- retention obligations;
- user trust risk;
- AI training/inference leakage risk.

Default to the least data necessary for the justified purpose.

## 15.3 Privacy by architecture

Prefer designs that reduce exposure structurally:

- process locally when feasible;
- pseudonymize or aggregate where identity is unnecessary;
- isolate tenants;
- reduce broad internal access;
- limit production data in development/test;
- redact telemetry;
- enforce retention automatically;
- make deletion/export workflows testable.

## 15.4 AI-specific privacy

Model prompts, conversation history, embeddings, vector stores and tool traces can contain sensitive data even when the original database is protected. Treat them as data stores with classification, access, retention and deletion requirements.

---

# 16. Reliability and SRE doctrine

## 16.1 Reliability is user-relative

Google SRE recommends defining service-level indicators and objectives around behavior users actually care about [REL01].

A database may be “up” while checkout fails. A service may have low average latency while 1% of users experience severe timeouts.

## 16.2 SLI → SLO → error budget

```text
SLI = measurement of a relevant behavior
SLO = target for that behavior
ERROR BUDGET = tolerated unreliability implied by the target
```

Use error budgets as a decision mechanism, not as an excuse to deliberately create failures.

## 16.3 Why 100% is rarely the right default

A 100% target can:

- require disproportionate cost;
- slow safe change;
- create meaningless paging for tiny deviations;
- exceed the reliability of dependencies or user networks.

High-assurance/safety contexts may justify extremely strict targets, but the target must come from consequence analysis, not prestige [REL01].

## 16.4 Reliability hierarchy

Protect, in roughly this order when relevant:

1. correctness/data integrity;
2. security/safety;
3. core availability;
4. freshness/latency;
5. optional capability.

Do not preserve “availability” by serving known-corrupt financial or authorization results.

## 16.5 Progressive delivery

Google SRE identifies change as a major source of incidents and advocates canarying/progressive exposure to reduce blast radius [REL02].

Progressive rollout should define:

- cohort;
- duration/observation window;
- health signals;
- stop thresholds;
- automated/manual decision ownership;
- rollback/roll-forward path.

---

# 17. Observability, monitoring and operability

OpenTelemetry defines observability as the ability to understand a system's internal state through its outputs; telemetry such as traces, metrics and logs supplies evidence for that goal [OBS01].

## 17.1 Start with questions

Before adding telemetry, ask what operators must answer:

- Is the user journey working?
- Which dependency is responsible for latency?
- Is one tenant/region/version affected?
- When did failure begin?
- Which deployment/config change preceded it?
- Is data stale or missing?
- Is a queue growing faster than it drains?
- Is an AI model/tool failing selectively?

Instrumentation that cannot help answer a meaningful question may be noise or compliance overhead.

## 17.2 Four golden signals

For online services, Google SRE's four golden signals are a strong baseline [REL03]:

- latency;
- traffic;
- errors;
- saturation.

They are not a universal complete dashboard. Business correctness, data freshness, queue health, security and domain-specific signals may matter more.

## 17.3 Structured logs

Prefer structured events with:

- timestamp;
- severity;
- service/component;
- operation;
- correlation/trace identifiers;
- safe contextual dimensions;
- outcome/error category.

Never log credentials, tokens or unnecessarily sensitive data.

## 17.4 Alert quality

An alert should generally be:

- tied to user/system consequence;
- actionable;
- routed to an owner;
- documented with first diagnostic steps;
- low enough in noise that it retains attention.

Alert fatigue is an observability failure.

## 17.5 Operability as architecture

Operational controls should exist for:

- safe shutdown/restart;
- draining traffic/work;
- retry/replay where safe;
- feature disablement;
- dependency isolation;
- configuration inspection;
- health/readiness;
- maintenance mode;
- data repair with auditability.

---

# 18. Performance, scalability, resource and cost efficiency

## 18.1 Performance is workload-specific

Define:

- latency percentiles;
- throughput;
- concurrency;
- payload/data size;
- warm/cold behavior;
- network/geography;
- CPU/memory/storage/I/O limits;
- dependency budgets.

“Fast” without workload and percentile is not a useful requirement.

## 18.2 Measure end-to-end first

A 50% faster internal function may have no user impact if the request is dominated by a database/network dependency.

Profile before optimizing unless:

- a hard real-time constraint exists;
- the algorithmic complexity is obviously unacceptable;
- known platform limits force a design decision.

## 18.3 Scalability dimensions

Separate:

- request/load scaling;
- data-volume scaling;
- geographic scaling;
- tenant scaling;
- team/organizational scaling;
- deployment scaling;
- failure-domain scaling.

A microservice architecture can improve some while making others worse.

## 18.4 Backpressure and admission control

Systems should have a policy for load beyond capacity:

- queue with bounded size;
- reject/load-shed;
- degrade optional work;
- rate limit;
- prioritize critical traffic;
- autoscale where latency allows.

Unbounded queues convert load spikes into memory exhaustion and delayed failure.

## 18.5 Caching

Cache only when the benefit justifies consistency and invalidation cost.

Before adding a cache define:

```yaml
source_of_truth:
key:
ttl:
invalidation:
staleness_tolerance:
miss_behavior:
cache_failure_behavior:
privacy_isolation:
```

“Cache invalidation is hard” is not a reason to avoid caches; it is a reason to make their semantics explicit.

## 18.6 Cost efficiency

AWS, Azure, Google Cloud and IBM all treat cost/financial efficiency as an architecture dimension alongside security, reliability, performance and operations [CLOUD01][CLOUD02][CLOUD03][CLOUD04].

Track major drivers:

- compute;
- storage;
- egress/network;
- managed-service premiums;
- model/token/inference cost;
- license cost;
- observability volume;
- engineer/operator time.

Cost optimization that increases incident risk or engineering complexity can be false economy.

---

# 19. Maintainability, evolvability and technical debt

Maintainability is not how aesthetically pleasing code feels. It is how effectively the system can be understood, diagnosed, tested and changed while preserving required behavior [QUAL01][MAINT01].

## 19.1 Maintainability signals

Material indicators include:

- change lead time;
- defect/change-failure patterns;
- dependency coupling;
- test feedback time;
- onboarding/change comprehension;
- repeated incident causes;
- upgrade/migration difficulty;
- ownership gaps;
- dead code/configuration;
- inability to observe behavior.

## 19.2 Technical debt

Technical debt should describe a **future cost/risk created by an earlier engineering choice**, not simply code someone dislikes.

Record significant debt as:

```yaml
item:
current_shortcut_or_constraint:
consequence:
interest_paid_today:
trigger_for_action:
remediation_options:
owner:
```

Research on technical-debt prioritization shows no universal prioritization method has strong enough evidence to replace contextual judgment [TECH01].

## 19.3 Refactor vs rewrite

Refactor when:

- core semantics are valuable and understood;
- risks can be reduced incrementally;
- tests/observability can create a safety net;
- architecture can evolve behind stable boundaries.

A rewrite becomes more defensible when:

- the current platform cannot meet a hard requirement;
- critical assumptions are fundamentally invalid;
- supported migration boundaries exist;
- parallel validation is feasible;
- the organization can afford duplicate-system risk.

Rewrites reset known technical debt but create new unknown behavior and migration risk.

## 19.4 Deprecation as product work

Every long-lived dependency/API/schema eventually needs retirement. A mature system includes:

- usage discovery;
- migration tooling;
- communication;
- compatibility window;
- telemetry;
- final deletion and validation.

Unused compatibility code is still code that can fail and must be maintained.

---
# 20. Accessibility and human interaction quality

Accessibility is an engineering quality for user-facing systems, not a visual finishing pass. WCAG 2.2 is a W3C Recommendation and was approved as **ISO/IEC 40500:2025**, strengthening its role as an international web-accessibility baseline [ACC01].

## 20.1 Universal baseline for interactive software

Where humans interact with software, protect:

- perceivability/readability;
- keyboard and non-pointer operation where applicable;
- semantic structure;
- focus visibility/order;
- target size and input alternatives;
- color-independent meaning;
- contrast;
- motion control;
- error identification/recovery;
- assistive-technology semantics;
- zoom/reflow/text resizing where platform supports it.

WCAG is strongest as a web-content conformance baseline. Native, embedded, kiosk, voice, spatial and safety-critical interfaces can require platform/domain-specific standards beyond WCAG.

## 20.2 Accessibility is architectural

Late fixes become expensive when accessibility is broken by:

- non-semantic component primitives;
- inaccessible custom widgets;
- state that exists only visually;
- keyboard-incompatible interaction models;
- content/data models that cannot carry alternatives/labels;
- rendering assumptions that prevent resizing/reflow.

Choose accessible primitives and component contracts early.

## 20.3 Conformance is necessary evidence, not complete usability proof

A WCAG-conforming interface can still be confusing, slow or inappropriate for its users. Pair standards/conformance checks with representative assistive-technology testing and user research when consequence and audience justify it.

Do not trade accessibility away for aesthetic minimalism or framework convenience.

# 21. Safety and high-assurance overlays

Safety is context-dependent but non-negotiable where software can contribute to unacceptable physical or mission harm.

## 21.1 When safety becomes first-class

Escalate when software can materially influence:

- physical control;
- medical diagnosis/treatment;
- transport/vehicle behavior;
- industrial hazards;
- critical infrastructure;
- irreversible high-value state;
- emergency response;
- life-critical communication.

## 21.2 High-assurance principles

Depending on domain standard, expect stronger use of:

- hazard analysis;
- requirements traceability;
- independence of verification;
- deterministic behavior;
- formalized configuration management;
- qualified tools;
- fault containment;
- redundancy/diversity;
- formal methods;
- evidence retention;
- controlled change.

NASA software assurance explicitly scales assurance and safety practices according to software classification/criticality [NASA01].

## 21.3 Do not cargo-cult certification practice

A C1 SaaS application does not become safer merely because it copies documentation ceremony from aerospace. The transferable principle is **risk-proportional assurance**, not maximum paperwork.

---

# 22. Dependencies, software supply chain and provenance

Modern software is assembled from source, packages, model artifacts, build tools, CI actions, base images, hosted services and suppliers. Supply-chain integrity therefore belongs inside the system boundary.

## 22.1 Dependency and supplier decision

Before adding a material dependency or supplier, assess proportionately:

```yaml
need:
alternative_without_dependency:
maintenance_activity:
ownership/governance:
license:
security_history:
transitive_dependencies:
provenance:
update_strategy:
lock/pinning_strategy:
runtime_privilege:
supplier_resilience:
supply_chain_tiers:
exit_cost:
```

A tiny utility dependency may create more supply-chain surface than code saved. A mature security/crypto library may be far safer than a bespoke replacement. NIST SP 1326 (final July 2026) reinforces that due diligence can include supplier provenance, resilience, foundational cyber practices and supply-chain tiers—not just the artifact itself [SUP04].

## 22.2 Pinning and updating

Pinning improves reproducibility and protects against unreviewed upstream change; never updating creates vulnerability/support/compatibility debt.

The durable combination is:

```text
PIN / LOCK
+ MONITOR
+ DELIBERATELY UPDATE
+ VERIFY
```

For GitHub Actions, GitHub's security guidance recommends full commit-SHA pinning as the strongest immutable action reference [GH01].

## 22.3 Provenance

The approved **SLSA v1.2** specification formalizes progressively stronger supply-chain guarantees and provenance concepts intended to support reasoning about how artifacts were produced [SUP01].

For material releases, be able to establish as justified:

- source revision;
- dependency resolution;
- build workflow;
- builder identity/environment;
- artifact digest;
- attestation/signing path;
- release approver/automation path.

Provenance tells you **how/where an artifact came from**. It does not prove the source is correct or vulnerability-free.

## 22.4 SBOM

SPDX and CycloneDX provide standardized representations for components and broader supply-chain/BOM information [SUP02][SUP03].

An SBOM is inventory/transparency evidence. It does **not** prove:

- vulnerabilities are absent;
- the named component actually produced the artifact unless provenance supports it;
- components were built securely;
- a vulnerability is exploitable in the deployed context;
- discovered risk is remediated.

Use SBOMs as one layer feeding vulnerability, licensing, incident and procurement processes.

## 22.5 Supplier due diligence

For material vendors/services/components, due diligence can include [SUP04]:

- ownership/control concerns where relevant;
- provenance and product origin;
- supplier/product resilience;
- foundational cybersecurity practices;
- upstream/downstream supply-chain tiers;
- support/vulnerability-disclosure capability;
- concentration and exit risk.

Scale this to consequence. A CSS utility package and a privileged identity provider do not require the same procurement analysis.

## 22.6 Reproducible builds

A reproducible build yields bit-for-bit identical specified output from the same source/build inputs under a defined environment, enabling independent verification [BUILD01].

It is especially valuable where:

- artifact tampering is high consequence;
- independent distributors/users need verification;
- opaque build steps are risky.

Reproducibility proves consistency, not source safety. Non-determinism should not be accidental where verification matters.

# 23. Build, configuration, secrets and environment discipline

## 23.1 Build as code

A reliable build should be:

- versioned;
- automated;
- isolated enough to avoid hidden workstation state;
- repeatable;
- dependency-controlled;
- observable on failure;
- producing identifiable artifacts.

“Works on my machine” is evidence of environmental coupling.

## 23.2 Configuration

Separate configuration from code when values legitimately vary by environment/deployment, but do not create a sprawling untyped configuration language.

Configuration needs:

- schema/validation;
- safe defaults;
- ownership;
- change history;
- secrets separation;
- startup/failure semantics;
- discoverability.

## 23.3 Environment parity

Perfect identical environments are often impractical. Preserve parity in **semantics that affect correctness**:

- database/version features;
- queue semantics;
- auth policy;
- runtime version;
- architecture/OS assumptions;
- external API behavior;
- feature flags/config;
- network/security constraints.

Use emulators/mocks only with explicit awareness of what they fail to reproduce.

## 23.4 Secrets in CI/CD

Prefer short-lived identity federation such as OIDC where supported rather than static cloud credentials [GH03].

Treat CI/CD as privileged production infrastructure:

- least permissions;
- protected secrets/environments;
- untrusted fork/PR boundaries;
- reviewed privileged workflows;
- dependency pinning;
- audit trail.

---

# 24. Verification, validation, testing and quality engineering

IEEE 1012 treats verification and validation as broader than executing test cases; analysis, reviews, inspections, assessments and testing all contribute evidence [VV01]. V2 therefore treats testing as one assurance instrument among several.

## 24.1 Verification vs validation

- **Verification:** did we implement the specified property/behavior correctly?
- **Validation:** is the specified behavior actually appropriate for the intended use/context?

A mathematically verified implementation of the wrong requirement can still be a product failure.

## 24.2 Risk-driven verification

Choose methods from failure modes and evidence needs:

| Risk / question | Strong candidate methods |
|---|---|
| business-rule examples | unit/domain tests, review |
| broad input/state invariants | property-based testing [TEST06] |
| component boundary fidelity | integration/contract tests |
| full user journey | end-to-end/acceptance tests |
| parsing/input robustness | fuzzing/property testing [TEST05][TEST06] |
| race/concurrency | stress/model/concurrency tests |
| distributed state-machine design | formal specification/model checking where justified [FORMAL01] |
| performance/capacity | benchmark/load/stress/soak/overload testing [RES01] |
| security boundary | threat-model tests, SAST/DAST, fuzzing, penetration testing |
| schema/API evolution | compatibility/contract/migration tests |
| safety/high-consequence property | independent review, formal methods, traceability as domain requires |
| AI behavior | representative eval sets, adversarial evals, human/domain review, production monitoring |

## 24.3 Test pyramid is a heuristic

A broad base of cheap tests and fewer expensive end-to-end tests is often useful, but the correct portfolio depends on architecture and failure cost.

Do not preserve a “pyramid” if integration is where most risk lives, mocks erase the behavior under test or other methods provide stronger/cheaper evidence.

## 24.4 Coverage

Coverage answers “was this code executed under tests?” It does not answer “was the behavior correct?” Mutation-testing evidence reinforces that coverage and fault revelation are related but non-equivalent [TEST01][TEST04].

Use coverage to identify suspiciously unexercised areas, not as an assurance certificate.

## 24.5 Mutation testing

Large-scale Google evidence found mutation feedback could expose weak tests and influence test improvement [TEST01].

Use mutation testing selectively where assertion strength matters and cost is justified. Do not maximize mutation score mechanically across generated/low-value code.

## 24.6 Property-based testing

Property-based testing (PBT) generates many inputs/states against properties/invariants rather than relying only on hand-picked examples. A 2026 empirical study across Python projects found real adoption but also substantial challenges around data generation and limited automation of realistic properties [TEST06].

Use PBT when:

- meaningful invariants can be stated;
- input/state space is large;
- edge combinations matter;
- round-trip, oracle, bounds or “never happens” properties exist.

Do not use it as magic random testing. Weak properties merely generate many weak tests.

## 24.7 TDD

Meta-analytic evidence on Test-Driven Development shows context-dependent quality effects and no universal productivity benefit [TEST02].

Classification: **D — useful development technique, not universal law.**

Use it when test-first feedback clarifies behavior/design. Do not force ritual order where exploration or another assurance method is more effective.

## 24.8 Pair programming

Meta-analysis finds context-dependent trade-offs among quality, elapsed time and total effort [TEST03].

Classification: **D — collaboration technique, not universal default.**

Strong use cases can include high-risk changes, onboarding/knowledge transfer, difficult debugging and architectural exploration.

## 24.9 Fuzzing

NIST describes fuzzing as a software-assurance technique for finding robustness/security defects by feeding invalid, unexpected or generated inputs [TEST05].

Use it especially at parsers, decoders, protocol/file boundaries and security-sensitive inputs.

## 24.10 Formal specification and model checking

AWS has publicly documented using formal specification/model checking since 2011 to reason about difficult design problems in critical systems [FORMAL01].

Formal methods are especially attractive when:

- a small state-machine/protocol property carries high consequence;
- concurrency/interleavings are difficult to enumerate manually;
- subtle safety/liveness invariants matter;
- exhaustive model-state exploration is feasible enough to justify cost.

Boundary condition:

> **A proof/model check can establish a scoped property of a model under assumptions. It cannot prove that the model captures the right requirement, production implementation or environment unless those links are separately justified.**

## 24.11 Flaky tests

A test that fails nondeterministically degrades trust in the verification system.

Treat flakiness as a defect:

- isolate;
- find timing/shared-state/environment dependencies;
- repair or quarantine with explicit owner/expiry;
- never normalize “rerun until green” as the primary strategy.

## 24.12 Independence of evidence

The same mechanism should not be the sole producer and judge of high-consequence output when independent evidence is practical.

Examples:

- AI writes code → compiler/tests/static/runtime evidence + review;
- migration tool generates SQL → schema/data invariants + rehearsal;
- formal model proves property → implementation conformance still verified;
- security scanner passes → threat model and runtime/configuration evidence still matter.

# 25. Code review, collaboration and documentation

Large-scale Google research describes modern code review as a central engineering practice with goals including code improvement, defect discovery and knowledge transfer [REVIEW01]. Microsoft research similarly identifies awareness and knowledge sharing as important review benefits [REVIEW02].

## 25.1 Review the change, not the author

Review for:

- intended behavior;
- unintended behavior;
- risk/criticality;
- correctness;
- security/privacy;
- failure handling;
- data/schema effects;
- maintainability;
- test evidence;
- operational impact;
- compatibility;
- unnecessary complexity.

## 25.2 Change size

Smaller coherent changes generally reduce review burden and blast radius. But splitting one invariant across many independently deployable commits can reduce comprehensibility.

Target:

> **the smallest independently understandable and safely integrable change.**

## 25.3 Automate mechanical review

Use tools for:

- formatting;
- basic linting;
- type checking;
- generated-file consistency;
- known dependency/security scans;
- deterministic policy checks.

Reserve human attention for semantics, architecture, risk and maintainability.

## 25.4 Documentation layers

Useful documentation includes:

- README/getting started;
- architecture/system context;
- ADRs;
- API/schema contracts;
- runbooks;
- deployment/recovery procedures;
- data ownership/classification;
- non-obvious code comments;
- incident learning.

## 25.5 Comments

Prefer comments that explain:

- why a non-obvious decision exists;
- external constraint/bug;
- invariant;
- surprising performance/security behavior;
- removal condition for workaround.

Avoid comments that merely restate syntax and rot independently.

---

# 26. Version control and change design

## 26.1 Atomic/coherent history

A useful change should be:

- independently understandable;
- reviewable;
- attributable;
- testable;
- revertible where feasible.

Do not optimize Git history aesthetics at the expense of preserving meaningful context.

## 26.2 Branching

No branching model is universal. Optimize for:

- integration frequency;
- change isolation needs;
- release model;
- compliance constraints;
- team distribution;
- repository scale.

Long-lived branches increase integration divergence; high-assurance release branches may still be justified.

## 26.3 Feature flags

Feature flags can decouple deploy from release and reduce exposure risk, but create state-space and cleanup debt.

Every material flag should have:

```yaml
owner:
purpose:
default:
expiry_or_review_date:
segments:
interaction_with_other_flags:
rollback_behavior:
cleanup_plan:
```

Do not let the runtime accumulate permanent hidden product configurations unintentionally.

---

# 27. CI/CD, release and deployment

DORA treats delivery performance through both throughput and instability and cautions against treating a single metric as the goal [DORA01].

## 27.1 Continuous integration

CI should make integration problems cheap to discover:

- frequent integration;
- fast deterministic checks;
- reproducible build;
- relevant tests;
- policy/security checks;
- clear failure ownership.

A pipeline that takes hours and is routinely ignored is weak feedback even if comprehensive.

## 27.2 Deployment vs release

Where useful:

```text
DEPLOY = make code available in production environment
RELEASE = expose behavior to users/traffic
```

Feature flags, canaries and routing can separate the two.

## 27.3 Safe deployment controls

Depending on criticality:

- immutable/identified artifact;
- deployment manifest/config review;
- preflight checks;
- progressive rollout;
- health/SLO gates;
- automated stop/rollback;
- schema compatibility;
- audit/provenance;
- post-deployment verification.

## 27.4 Do not optimize deployment frequency in isolation

A deployment metric can be gamed by splitting trivial changes or create risk when the system lacks test/recovery capability. DORA's model explicitly pairs throughput with instability [DORA01].

The useful goal is:

> **make valuable change safe, fast and sustainable.**

---

# 28. Migrations and backwards compatibility

Migrations are among the most dangerous routine engineering activities because they combine state change, version coexistence and rollback constraints.

## 28.1 Database migration pattern

Prefer expand/migrate/contract for live systems:

```text
1. Add compatible new schema
2. Deploy code that supports old + new
3. Backfill/migrate with observability
4. Switch reads/writes deliberately
5. Verify consistency
6. Stop old writers/readers
7. Remove old schema later
```

## 28.2 Destructive changes

Before destructive operations:

- confirm usage;
- create/verify backup or recovery path;
- bound affected rows/objects;
- use transactions/batches where suitable;
- test with representative volume;
- monitor locks/load;
- make stop criteria explicit.

## 28.3 Data backfills

Backfills should be:

- resumable;
- idempotent where possible;
- rate controlled;
- observable;
- safe under partial completion;
- reconciled after completion.

## 28.4 Rollback limits

Application rollback is unsafe when the newer version has irreversibly changed state the old version cannot interpret.

Therefore rollback strategy must be co-designed with schema/state evolution, not written after deployment.

---

# 29. Production readiness and operations

A feature is not production-ready merely because it passed functional tests.

## 29.1 Production readiness dimensions

Confirm:

- requirements/ownership;
- security/privacy;
- capacity/performance;
- dependencies;
- monitoring/alerts;
- failure/degraded modes;
- data backup/recovery;
- deployment/rollback;
- runbooks;
- on-call/support ownership;
- cost expectations;
- compliance/overlay requirements.

## 29.2 Third-party dependency readiness

Know for each critical vendor/service:

- SLA/SLO if any;
- quota/rate limits;
- timeout/retry behavior;
- data residency/privacy implications;
- outage behavior;
- substitution/exit path;
- status/support path;
- billing/cost failure mode.

“Managed” transfers operation, not accountability for your user outcome.

## 29.3 Backups and disaster recovery

Test:

- restore procedure;
- credentials/access during incident;
- restore time;
- consistency after restore;
- application compatibility;
- DNS/network dependencies;
- operator knowledge.

A paper RTO is not evidence that restoration can meet it.

---

# 30. Incident engineering and learning

## 30.1 Incident response loop

```text
DETECT
→ TRIAGE
→ CONTAIN
→ MITIGATE / RESTORE
→ VERIFY
→ COMMUNICATE
→ LEARN
→ CHANGE SYSTEM
```

During an incident, optimize first for safe restoration and containment. Deep causal analysis can follow once the system is stable.

## 30.2 Severity

Severity should reflect consequence, not emotional intensity. Define levels from:

- user impact;
- duration;
- data/security consequence;
- financial/operational effect;
- regulatory reporting requirements.

## 30.3 Post-incident analysis

Avoid a single “root cause” when failure emerged from interacting conditions.

Capture:

```yaml
impact:
timeline:
detection:
trigger:
contributing_conditions:
what_worked:
what_failed:
why_controls_did_not_prevent_or_contain:
recovery:
actions:
owners:
validation_of_actions:
```

## 30.4 Blameless does not mean accountability-free

A learning-oriented review avoids simplistic blame while still assigning clear ownership for remediation, policy and system improvement.

---

# 31. Maintenance, deprecation and retirement

ISO/IEC/IEEE 14764 treats software maintenance as a distinct lifecycle discipline [MAINT01]. ISO/IEC/IEEE 12207:2026 includes operation, support and retirement in the lifecycle [LIFE01].

## 31.1 Maintenance types

Plan for:

- corrective — defects;
- adaptive — environment/dependency/platform change;
- perfective — capability/performance improvement;
- preventive — reducing future failure/change risk.

## 31.2 Dependency/platform upgrades

Do not choose between “always latest” and “never touch stable software.”

Use:

- support/EOL horizon;
- security advisories;
- compatibility tests;
- controlled update cadence;
- staged release;
- migration budget.

## 31.3 Retirement

Retirement requires more than turning off compute:

- identify users/dependents;
- migrate/export data;
- apply retention/deletion requirements;
- revoke credentials;
- remove DNS/integrations;
- archive required evidence/source;
- stop monitoring/billing intentionally;
- communicate end state.

Zombie infrastructure is cost and attack surface.

---

# 32. AI-assisted software engineering

The 2026 evidence base is now strong enough to reject both simplistic stories—“AI always makes developers faster” and “AI-generated code is inherently worse”—while still being too heterogeneous and fast-moving to justify one universal productivity number.

Evidence currently points to several simultaneous truths:

- bounded tasks can show substantial completion-time gains [AI07];
- experienced developers in mature repositories were slowed by early-2025 tools in one RCT [AI08];
- METR's late-2025/early-2026 follow-up became difficult to interpret because developers/tasks likely to benefit most increasingly selected out of AI-disallowed conditions and concurrent agents complicated time measurement [AI10];
- a 2026 experiment found much higher task completeness with AI but lower ability to answer technical questions about the produced code, suggesting a code-ownership/comprehension trade-off in that setting [AI11];
- a 2026 maintainability experiment found no clear systematic downstream advantage or disadvantage when other developers evolved AI-co-developed code in its studied Java tasks [AI13];
- current LLMs can detect/repair many vulnerabilities when explicitly tasked, but still miss issues and can answer confidently incorrectly [AI12].

The engineering conclusion is:

> **AI changes the cost, throughput and shape of candidate work. Quality depends on the combined human–tool–verification system, and the effect must be measured on the outcome that matters.**

## 32.1 Universal rules for AI-generated engineering output

Treat as untrusted until verified:

- source code;
- tests and test oracles;
- migrations/SQL;
- shell commands;
- infrastructure/configuration;
- regex/parsers;
- cryptographic/security code;
- dependency recommendations;
- security claims;
- architectural assumptions;
- documentation that affects operations;
- tool calls/actions.

OpenSSF and GitHub guidance both preserve ordinary review/testing/security controls around AI-generated code [AI03][AI04].

## 32.2 AI review is not independent evidence by default

An AI that generates a change and then asserts that the same change is correct is not strong independent verification.

For material changes, combine candidate generation with independent signals such as:

- compiler/type checker;
- deterministic tests;
- static analysis;
- fuzz/property tests;
- schema/invariant checks;
- runtime evidence;
- human/domain/security review;
- production canary/telemetry.

A second model can add diversity but is still correlated software, not an automatic independent assurance authority.

## 32.3 Prompt/instruction files are engineering inputs, not enforcement

Repository instructions for coding agents should specify:

- architecture boundaries;
- commands/tests;
- security/privacy constraints;
- dependency policy;
- file ownership/do-not-touch zones;
- formatting/linting;
- acceptance criteria;
- prohibited shortcuts;
- documentation/change expectations.

Critical controls must be technically enforced outside the prompt when bypass matters.

## 32.4 Measure outcomes, not AI activity

Do not use these alone as productivity proof:

- generated lines of code;
- accepted completion percentage;
- tokens/calls;
- number of agent tasks;
- benchmark pass rate;
- self-reported speed.

AI can change which tasks people attempt, parallelize work and change output quality, making simple time comparisons difficult [AI10]. Benchmark success can also exceed real maintainer acceptability [AI14].

Prefer a balanced local outcome set:

```text
accepted useful outcome / cycle time
+ review and rework effort
+ escaped defects / incidents
+ security findings
+ test/evidence quality
+ maintainability / change friction
+ developer/system understanding
+ cost / latency / tool overhead
```

## 32.5 Protect code and system ownership

Higher output throughput is not an unqualified win if critical code becomes opaque to the people accountable for it.

A 2026 IEEE TSE experiment found AI users completed substantially more of the assigned task but scored lower on technical questions about the code they implemented [AI11]. Treat this as a boundary-condition signal, not a universal effect size.

For high-consequence code:

- require reviewers/owners to explain relevant invariants and failure modes;
- keep generated changes small enough to review;
- avoid merging large opaque diffs solely because tests pass;
- preserve architecture and operational documentation;
- track repeated areas where humans cannot confidently modify/debug without the generating agent.

## 32.6 Security evidence is moving, not solved

Older user studies found security risks with earlier AI assistants [AI09]. A 2026 study of 2,315 real-world C/C++/C# snippets found current models could detect and repair roughly three-quarters or more of confirmed vulnerabilities when explicitly prompted, but they still missed issues and could provide confident incorrect answers [AI12].

Therefore neither of these claims is justified:

```text
AI-WRITTEN CODE IS INHERENTLY INSECURE
AI CAN RELIABLY SELF-SECURE ITS OWN OUTPUT
```

Security remains an independent verification problem.

## 32.7 Maintainability evidence is currently neutral/uncertain

A preregistered 2026 controlled study with a predominantly professional participant pool found no significant downstream difference in completion time or code quality when new developers evolved solutions that had been produced with vs without AI assistance in the studied task [AI13].

Do not claim AI-generated code is inherently less maintainable—or more maintainable—from current evidence. Measure local code health, reviewability and evolution cost.

## 32.8 DORA amplifier principle

DORA's 2025 research characterizes AI as an amplifier of underlying organizational strengths and weaknesses [DORA02]. Use this as an organization-level framing, not a task-level causal effect size.

```text
GOOD ENGINEERING SYSTEM + AI
→ faster candidate generation + strong feedback can increase useful throughput

WEAK ENGINEERING SYSTEM + AI
→ faster production of unreviewed complexity, weak evidence and operational risk
```

The bottleneck increasingly shifts from typing toward **specification, judgment, verification, integration and system comprehension**.

# 33. Agentic AI universal controls

NIST's GenAI Profile and SSDF AI extension add AI-specific risk and secure-development considerations [AI01][AI02]. OWASP's 2026 agentic guidance highlights threats created when models can plan, use tools and take actions [AI05]. Its **Agent Control Standard, released 1 September 2026**, focuses on inspectability, traceability, instrumentation and runtime policy hooks [AI06]. Because ACS is very new, V2 treats its control architecture as strong current consensus direction rather than empirically proven completeness.

## 33.1 Capability × consequence model

An agent capable only of reading public data needs less control than an agent that can:

```text
READ PRIVATE DATA
→ WRITE INTERNAL STATE
→ SEND EXTERNAL MESSAGES
→ EXECUTE CODE
→ MODIFY PRODUCTION
→ SPEND MONEY
→ DELETE DATA
→ CREATE/GRANT CREDENTIALS
```

As capability and consequence increase, strengthen:

- identity;
- scoped authorization;
- sandboxing/isolation;
- input/output validation;
- tool policy;
- approval gates;
- transaction limits;
- audit log;
- idempotency;
- reversibility;
- kill switch;
- anomaly detection.

## 33.2 Model output is not authority

The model may propose an action; authorization must come from a policy/enforcement layer outside the model where consequence is material.

Never rely on a prompt alone for:

- tenant isolation;
- spending limits;
- production permissions;
- data access control;
- irreversible deletion restrictions.

## 33.3 Prompt injection is a boundary problem

Treat retrieved documents, websites, emails, tool output and user-provided files as untrusted content that may contain instructions.

Separate:

- data content;
- system/developer policy;
- tool authorization;
- user intent.

Do not let untrusted content silently redefine permission.

## 33.4 Memory

Agent memory creates persistent state and therefore needs:

- source/provenance;
- ownership;
- sensitivity classification;
- update rules;
- conflict handling;
- retention/deletion;
- poisoning resistance;
- user correction path.

## 33.5 Human-in-the-loop

Human approval is useful when:

- consequence is high;
- intent is ambiguous;
- action is irreversible;
- policy requires separation;
- model confidence/evidence is insufficient.

It is weak when the human is asked to rubber-stamp hundreds of opaque actions. Design approvals around understandable risk and evidence.

---


## 33.6 Runtime control and kill paths

For agents with material write/execute/spend/delete/credential capability, design runtime control outside the model:

- enumerate capabilities/tools;
- authorize by identity, resource, action and context;
- enforce transaction/rate/value limits;
- log tool decisions and resulting effects;
- allow suspension/revocation without model cooperation;
- make in-flight work cancelable where feasible;
- define recovery/compensation for partially completed action chains.

A “stop” instruction in a prompt is not a kill switch [AI06].

## 33.7 Autonomy does not erase software-engineering controls

Agentic execution can increase uncertainty and concurrency, so ordinary controls become more important:

- idempotency for repeated actions;
- bounded concurrency/queues;
- retries with budgets;
- explicit state/ownership;
- deterministic policy enforcement;
- production change gates;
- least privilege;
- audit and incident response.

Treat agent orchestration as software engineering with an untrusted probabilistic decision component—not as a separate universe.

# 34. Regulatory and jurisdictional overlays

This master playbook is not legal advice. Regulation should be translated into explicit engineering constraints with qualified legal/compliance input.

## 34.1 EU Cyber Resilience Act example

The EU Cyber Resilience Act imposes cybersecurity requirements for products with digital elements, including lifecycle vulnerability-handling obligations. Reporting obligations began to apply on **11 September 2026**, while the main body of requirements applies from **11 December 2027** [REG01].

Engineering implication:

> Product security, vulnerability intake/remediation, supported lifetime and software supply-chain evidence can become legal lifecycle obligations—not optional best practice.

## 34.2 EU AI Act example

The EU AI Act has phased applicability; Article 50 transparency obligations became applicable on **2 August 2026** [REG02].

Engineering implication:

AI-system classification, transparency, logging, oversight and other controls may be legally scoped. Keep regulatory obligations in a maintained jurisdictional overlay because timelines and guidance evolve faster than universal engineering principles.

## 34.3 Overlay rule

When an applicable regulation conflicts with a lower-tier heuristic, the scoped legal requirement wins. When regulation defines a minimum, do not assume minimum legal compliance equals optimal engineering quality.

---

# 35. Metrics and Goodhart resistance

Metrics are useful when they improve decisions. They become dangerous when the number replaces the outcome.

## 35.1 Metric design

For every engineering metric define:

```yaml
question_it_answers:
mechanism_expected:
decision_it_informs:
known_failure_modes:
segments:
review_period:
```

## 35.2 Common metric traps

### Code coverage
Can incentivize low-value tests while missing correctness [TEST04].

### Deployment frequency
Can incentivize trivial splitting; evaluate with instability and value [DORA01].

### Uptime
Can hide broken core user journeys; use user-relevant SLIs [REL01].

### Story points / lines of code
Do not measure delivered value or quality; both are easily gamed.

### Vulnerability counts
Can rise because detection improves. Severity, exposure, exploitability and remediation time matter.

### AI token/code volume
Generated volume is not engineering productivity.

## 35.3 Balanced metric doctrine

Prefer sets that expose trade-offs:

```text
THROUGHPUT + INSTABILITY
PERFORMANCE + ERROR RATE
RELIABILITY + CHANGE RATE
COST + USER OUTCOME
SECURITY FINDINGS + REMEDIATION / EXPOSURE
AI SPEED + QUALITY / REWORK / INCIDENTS
```

---
# 36. Universal engineering decision framework

When a material engineering decision is disputed, use this sequence before arguing technologies.

## Step 1 — Define the outcome

What user/system outcome must improve or remain protected?

## Step 2 — Define constraints

Identify:

- scale/load;
- data/state;
- latency;
- reliability;
- security/privacy;
- regulatory;
- team/skills;
- budget;
- time horizon;
- existing system constraints.

## Step 3 — Identify failure modes

What can each option cause to fail, and how severe/recoverable is it?

## Step 4 — Identify quality-attribute trade-offs

```yaml
correctness:
security:
privacy:
reliability:
performance:
maintainability:
operability:
compatibility:
cost:
reversibility:
```

## Step 5 — Prefer the least irreversible adequate option

When two solutions satisfy requirements, prefer the one with:

- lower accidental complexity;
- easier observability;
- smaller blast radius;
- more reversible adoption;
- fewer novel operational dependencies;
- clearer ownership.

## Step 6 — Gather evidence proportionate to uncertainty

Use:

- benchmark;
- prototype;
- threat model;
- load test;
- architecture spike;
- user test;
- failure injection;
- cost model;
- formal analysis.

## Step 7 — Record consequential decisions

Capture why, alternatives and review trigger.

## Step 8 — Revisit when assumptions change

Architecture is not permanent merely because an ADR says “accepted.”

---

# 37. Core decision trees

## 37.1 Build vs buy

```text
Is the capability differentiating or tightly coupled to core domain/IP?
  ├─ YES → Does building create sustainable advantage/control worth lifetime cost?
  │          ├─ YES → consider BUILD
  │          └─ NO  → evaluate BUY / managed / OSS
  └─ NO  → Does a mature option meet security, privacy, reliability and exit constraints?
             ├─ YES → prefer BUY / managed / OSS
             └─ NO  → build the missing minimum
```

Always include:

- vendor lock-in/exit;
- data portability;
- failure dependency;
- compliance;
- total operational cost;
- integration surface;
- roadmap dependence.

## 37.2 Monolith vs services

```text
Do we need independent scaling, deployment, failure isolation or ownership?
  ├─ NO → default toward one deployable with strong internal modules
  └─ YES → Can a modular monolith satisfy it without harmful coupling?
             ├─ YES → prefer simpler topology
             └─ NO  → isolate the justified service boundary
```

Do not create network boundaries merely to imitate a large company's architecture.

## 37.3 Synchronous vs asynchronous

Use synchronous when:

- caller needs immediate result;
- latency/dependency reliability fits budget;
- operation is simple and bounded.

Use asynchronous when:

- work is long-running;
- buffering/backpressure helps;
- temporary dependency failure should not block caller;
- event decoupling is valuable;
- retries/replay are part of the model.

Async introduces:

- ordering;
- duplicates;
- eventual consistency;
- queue operations;
- observability complexity.

## 37.4 Add a cache?

```text
Is performance/load actually constrained?
  ├─ NO → don't cache yet
  └─ YES → Can source query/computation be improved first?
             ├─ YES → optimize source
             └─ NO  → Is acceptable staleness/invalidation explicit?
                        ├─ NO → define semantics first
                        └─ YES → add measured cache
```

## 37.5 Add a dependency?

```text
Does dependency solve material complexity/risk better than local implementation?
  ├─ NO → avoid
  └─ YES → Is project maintained, compatible, licensable and securable?
             ├─ NO → seek alternative
             └─ YES → pin/monitor/update intentionally
```

## 37.6 Abstract duplicated code?

```text
Is duplication the same knowledge/business rule?
  ├─ NO / UNSURE → keep explicit for now
  └─ YES → Does it change together repeatedly?
             ├─ NO → delay abstraction
             └─ YES → create smallest stable abstraction
```

## 37.7 Roll back or roll forward?

**Rollback** when previous version can safely interpret current state and rollback is faster/lower risk.  
**Roll forward** when state migration is irreversible, corruption would be amplified, or a minimal fix is safer than reintroducing old behavior.

The decision must include database/schema/config compatibility.

## 37.8 Add a queue?

Add when buffering, asynchronous durability or decoupled consumption solves a real requirement. Before adoption define:

- delivery semantics;
- ordering;
- retries/dead letter;
- deduplication/idempotency;
- retention;
- backpressure;
- replay;
- observability;
- poison-message handling.

## 37.9 Add AI to a workflow?

```text
Is the task tolerant of probabilistic error?
  ├─ NO → AI may assist but deterministic guard/verification must own correctness
  └─ YES → Can quality be evaluated with representative cases?
             ├─ NO → first build evaluation method
             └─ YES → Is AI materially better than simpler deterministic/human process?
                        ├─ NO → avoid unnecessary AI dependency
                        └─ YES → deploy with evals, telemetry, fallback/control
```

---

# 38. Architecture review standard

Use for material new systems or consequential architecture changes.

## 38.1 Context

- [ ] Problem and intended users are clear
- [ ] System boundary is defined
- [ ] Key requirements and constraints are explicit
- [ ] Criticality level is assigned
- [ ] Assumptions are recorded

## 38.2 Quality attributes

- [ ] Correctness/invariants identified
- [ ] Security/threat model appropriate
- [ ] Privacy/data flows understood
- [ ] Reliability/SLO expectations stated
- [ ] Performance/capacity model exists where relevant
- [ ] Maintainability/evolution considered
- [ ] Cost constraints considered
- [ ] Accessibility/safety overlays considered where applicable

## 38.3 Structure

- [ ] Boundaries have clear responsibilities
- [ ] State/source-of-truth ownership is clear
- [ ] Dependency direction is intentional
- [ ] Contracts/failure semantics are explicit
- [ ] Shared mutable state minimized or controlled
- [ ] Cross-boundary communication cost justified

## 38.4 Failure and operations

- [ ] Critical dependency failures considered
- [ ] Timeouts/retries/idempotency defined where needed
- [ ] Degraded behavior defined
- [ ] Observability designed
- [ ] Recovery/backup requirements defined
- [ ] Operational owner identified

## 38.5 Change/evolution

- [ ] Compatibility strategy exists
- [ ] Migration strategy exists
- [ ] Rollback/roll-forward constraints understood
- [ ] Vendor/dependency exit risk understood
- [ ] Irreversible decisions minimized or explicitly justified

## 38.6 Evidence

- [ ] Consequential alternatives compared
- [ ] Benchmark/prototype used where uncertainty material
- [ ] ADR created for high-impact decision
- [ ] No named architecture adopted without a requirement it serves

---

# 39. Change / pull-request review standard

## 39.1 Intent

- [ ] Change has a clear reason and acceptance condition
- [ ] Scope is coherent and no larger than necessary
- [ ] Unrelated refactors are separated where useful

## 39.2 Correctness

- [ ] Important invariants remain true
- [ ] Boundary/invalid inputs handled
- [ ] Error paths handled intentionally
- [ ] Concurrency/state implications considered
- [ ] Time/date/locale/ordering assumptions considered where relevant

## 39.3 Security/privacy

- [ ] Authorization changes reviewed
- [ ] New inputs/trust boundaries validated
- [ ] Secrets/sensitive data not exposed
- [ ] Data collection/retention justified
- [ ] Dependencies reviewed where new/changed

## 39.4 Verification

- [ ] Tests/evidence address actual risk
- [ ] Existing behavior regression considered
- [ ] Static/tooling checks pass
- [ ] No flaky/ignored test hides failure

## 39.5 Operations

- [ ] Logs/metrics/traces are sufficient and safe
- [ ] Performance/cost implication considered
- [ ] Feature/config flags have ownership/cleanup
- [ ] Migration and rollback/roll-forward are compatible

## 39.6 Maintainability

- [ ] New abstraction justified
- [ ] Naming reflects domain behavior
- [ ] Complexity not hidden behind “clean” layering
- [ ] Documentation/ADR/runbook updated if decision changed

## 39.7 AI-generated changes

- [ ] Reviewer does not rely on AI self-assessment alone
- [ ] Generated dependency/API claims verified against authoritative source
- [ ] Generated migrations/commands inspected before execution
- [ ] Security-sensitive code receives appropriate independent verification

---

# 40. Security review standard

Use depth proportionate to risk.

## 40.1 Assets and boundaries

- [ ] Assets/sensitive data identified
- [ ] Entry points identified
- [ ] Trust boundaries documented
- [ ] Privileged operations enumerated

## 40.2 Identity and access

- [ ] Authentication appropriate to threat model
- [ ] Authorization enforced server-side/at trusted boundary
- [ ] Least privilege applied
- [ ] Tenant/resource isolation verified
- [ ] Machine/agent identities scoped and rotatable

## 40.3 Input/output

- [ ] Untrusted input validated semantically
- [ ] Injection risks mitigated
- [ ] Output encoding/context handling correct
- [ ] Uploaded/parser inputs bounded/fuzzed where justified

## 40.4 Data/crypto

- [ ] Sensitive data classification defined
- [ ] Encryption/keys use established primitives/services
- [ ] No custom cryptography without exceptional justification/expert review
- [ ] Secrets stored/rotated safely
- [ ] Logs do not leak sensitive material

## 40.5 Supply chain

- [ ] New dependencies justified
- [ ] Lock/pin policy appropriate
- [ ] Vulnerability monitoring exists
- [ ] CI permissions minimized
- [ ] Artifact/provenance requirements satisfied

## 40.6 Failure/abuse

- [ ] Rate/resource abuse considered
- [ ] Security control failure behavior defined
- [ ] Audit events captured
- [ ] Incident/revocation mechanism exists

## 40.7 AI/agentic

- [ ] Prompt injection/untrusted content considered
- [ ] Tool actions independently authorized
- [ ] Agent permissions scoped
- [ ] Irreversible/high-consequence actions gated
- [ ] Memory/data retention controlled

---

# 41. Production readiness standard

## Product / ownership
- [ ] Product/system owner
- [ ] Engineering owner
- [ ] Support/on-call owner where required
- [ ] Critical user journeys identified

## Reliability
- [ ] Relevant SLIs/SLOs defined
- [ ] Capacity/load assumptions validated
- [ ] Dependency failure behavior tested
- [ ] Backup/restore tested
- [ ] RTO/RPO defined where material

## Observability
- [ ] Critical-path telemetry
- [ ] Actionable alerts
- [ ] Version/deployment correlation
- [ ] Runbook links from alerts where useful
- [ ] Sensitive data excluded/redacted

## Release
- [ ] Artifact identified
- [ ] Config/secret changes reviewed
- [ ] Migration tested
- [ ] Progressive rollout where justified
- [ ] Stop/rollback/roll-forward criteria defined

## Security/privacy
- [ ] Threat model appropriate
- [ ] Least privilege
- [ ] Vulnerability/dependency checks
- [ ] Privacy/data lifecycle reviewed
- [ ] Required audit logging

## Operability
- [ ] Health/readiness meaningful
- [ ] Safe restart/drain
- [ ] Failure isolation/degraded mode
- [ ] Manual repair/admin paths controlled and audited

## Governance
- [ ] Regulatory/domain overlay checked
- [ ] Licenses/third parties acceptable
- [ ] Cost expectations understood
- [ ] Documentation/ADR current

---

# 42. Release checklist

- [ ] Intended revision/artifact is unambiguous
- [ ] CI verification corresponds to this artifact
- [ ] Critical security/dependency findings addressed or explicitly accepted
- [ ] Schema/config changes compatible with rollout order
- [ ] Feature flag defaults confirmed
- [ ] Migration/backfill has bounds and observability
- [ ] Release notes/operator notes prepared where needed
- [ ] Canary/progressive cohort defined if used
- [ ] Health/SLO gates defined
- [ ] Rollback/roll-forward path validated
- [ ] Owner available for material release window where required
- [ ] Post-release verification executed
- [ ] Temporary flags/workarounds get cleanup owner/date

---

# 43. Incident / postmortem template

```yaml
incident_id:
severity:
start:
detection:
mitigation:
resolved:

user_impact:
business_security_data_impact:

systems_affected:

trigger:
contributing_conditions:
why_prevention_failed:
why_detection_took_this_long:
why_blast_radius_was_this_size:

what_worked:
what_did_not:

recovery_actions:

follow_up:
  - action:
    owner:
    due:
    validation:

long_term_learning:
```

Action items should improve system conditions, not merely instruct humans to “be more careful.”

---

# 44. AI-assisted change checklist

Before accepting an AI-produced material change:

- [ ] Intent/specification supplied to the AI was correct
- [ ] Generated code is understood by a responsible reviewer
- [ ] External API/library claims verified against current official docs where material
- [ ] New dependencies checked
- [ ] Tests include risk-relevant edge/failure cases
- [ ] AI did not weaken existing tests/controls to make CI pass
- [ ] No secrets/sensitive data introduced into prompt/log/source
- [ ] Security/authorization logic independently reviewed
- [ ] Migrations/SQL/shell commands inspected before execution
- [ ] Performance/resource assumptions validated if material
- [ ] Existing architecture boundaries preserved or deliberately changed
- [ ] Diff contains no unrelated generated churn
- [ ] Documentation/ADR updated where necessary
- [ ] Deployment/recovery plan appropriate

For autonomous execution additionally:

- [ ] Identity and permission scope explicit
- [ ] Tool policy enforced outside model prompt
- [ ] Spending/deletion/production limits enforced
- [ ] Audit trail retained
- [ ] Idempotency/replay behavior safe
- [ ] Human approval required at appropriate consequence threshold
- [ ] Kill/revoke mechanism works

---

# 45. Anti-playbook — claims to actively resist

## 45.1 “Microservices scale better.”

**Verdict:** `E — implementation choice`.  
Microservices can improve independent scaling, deployment or team ownership but add network failure, distributed state, observability and operational overhead. Systematic reviews/mappings report both motivations and substantial migration/operations challenges [ARCHMS01][ARCHMS02].

**Better rule:** Extract a service when an independently valuable boundary justifies the distributed-system cost.

## 45.2 “Monoliths don't scale.”

**Verdict:** `F — overgeneralization`.  
A well-modularized monolith can scale vertically/horizontally for many workloads; organizational and data constraints determine the limit.

**Better rule:** Separate deployment units only when the boundary buys something material.

## 45.3 “DRY everything.”

**Verdict:** `F — overgeneralization`.  
Removing superficial duplication can couple unrelated concepts.

**Better rule:** Avoid duplicated knowledge; tolerate explicit code duplication until shared semantics are stable.

## 45.4 “Every function/class should be under N lines.”

**Verdict:** `F — arbitrary threshold`.

**Better rule:** Optimize semantic cohesion, readability and testability; split where a unit has multiple reasons/responsibilities or is difficult to reason about.

## 45.5 “Clean Architecture is best practice.”

**Verdict:** `E — architecture option`.

**Better rule:** Apply dependency inversion/boundaries only where they reduce real coupling and change cost.

## 45.6 “100% coverage means quality.”

**Verdict:** `F — false assurance` [TEST01][TEST04].

**Better rule:** Verify important behavior/failure modes; use coverage to locate missing execution evidence.

## 45.7 “TDD is always best.”

**Verdict:** `D — contextual technique` [TEST02].

**Better rule:** Use test-first when it improves specification/design feedback; judge by outcomes.

## 45.8 “Pair programming is always more productive.”

**Verdict:** `D — contextual technique` [TEST03].

**Better rule:** Use pairing where quality/knowledge/problem-solving value justifies two-person effort.

## 45.9 “Strong typing prevents bugs.”

**Verdict:** `B/E — useful mechanism, overbroad claim`.

**Better rule:** Use type systems to eliminate representable classes of invalid state; still validate runtime/business/environmental behavior.

## 45.10 “Language X produces better software.”

**Verdict:** `F — broad causal claim unsupported`.  
Large repository studies have reported language associations, but careful reanalysis substantially weakens broad causal conclusions and emphasizes small effects/confounding [PL01][PL02].

**Better rule:** Choose language/runtime from safety, ecosystem, team, performance and operability requirements.

## 45.11 “Memory-safe languages make security solved.”

**Verdict:** `F — overgeneralization`.

**Better rule:** Memory safety removes important vulnerability classes [MSAFE01][MSAFE02]; authorization, logic, injection, supply chain and configuration risks remain.

## 45.12 “Serverless is cheaper.”

**Verdict:** `E — workload-dependent`.

**Better rule:** Model real request profile, idle time, latency, data transfer and operational labor.

## 45.13 “Kubernetes is required for scale.”

**Verdict:** `F — false`.

**Better rule:** Adopt orchestration only when its scheduling, deployment, isolation and ecosystem benefits exceed its operational complexity.

## 45.14 “Event-driven architecture is more scalable.”

**Verdict:** `E — contextual`.

**Better rule:** Use events when asynchronous decoupling, buffering or multi-consumer semantics justify ordering, duplication and observability complexity.

## 45.15 “Retries increase reliability.”

**Verdict:** `B — only under conditions`.

**Better rule:** Retry transient failures with safe/idempotent semantics, bounds and backoff [PROTO01].

## 45.16 “Exactly-once delivery solves duplicates.”

**Verdict:** `F — misleading abstraction outside tightly scoped guarantees`.

**Better rule:** Model business idempotency and state transitions explicitly.

## 45.17 “More logs = more observability.”

**Verdict:** `F`.

**Better rule:** Instrument signals that answer operational questions; excessive logs create cost/noise/privacy risk [OBS01].

## 45.18 “Five nines is more professional.”

**Verdict:** `F`.

**Better rule:** Set reliability from user/consequence need and cost [REL01].

## 45.19 “Never deploy on Friday.”

**Verdict:** `D/F — heuristic masking capability gaps`.

**Better rule:** Deploy when monitoring, recovery, ownership and staffing are sufficient for the risk. Calendar rules may be reasonable local policy but are not engineering law.

## 45.20 “Rollback is always safest.”

**Verdict:** `F`.

**Better rule:** Choose rollback or roll-forward from state compatibility and fastest safe restoration.

## 45.21 “Feature flags make release safe.”

**Verdict:** `B`.

**Better rule:** Flags reduce exposure risk only when kill behavior works and flag debt/interactions are controlled.

## 45.22 “Security testing belongs after feature completion.”

**Verdict:** `F` [SEC01][SEC02].

**Better rule:** Integrate threat analysis and secure design early; test controls continuously and independently when risk requires.

## 45.23 “Passing OWASP Top 10 means the app is secure.”

**Verdict:** `F`.

**Better rule:** Top lists are awareness/risk taxonomies, not complete verification standards; use threat modeling and an appropriate verification standard such as ASVS [SEC03][SEC04].

## 45.24 “An SBOM proves supply-chain security.”

**Verdict:** `F`.

**Better rule:** SBOM gives component transparency; combine with provenance, vulnerability management, build integrity and response [SUP01][SUP02][SUP03].

## 45.25 “A signed artifact is trustworthy.”

**Verdict:** `F`.

**Better rule:** A signature proves linkage to a key/identity; trust also depends on source, build process, key security and policy.

## 45.26 “AI makes developers faster.”

**Why tempting:** AI lowers the cost of generating code and many users perceive large gains.

**Evidence verdict:** Context-dependent and rapidly changing. Bounded-task experiments show gains [AI07]; early-2025 mature-repository work found slowdown [AI08]; later METR measurement was materially confounded by selection/task substitution/concurrent-agent timing [AI10].

**Better rule:** Measure the relevant local outcome—accepted useful work, quality, rework, review burden, comprehension and cycle time—rather than importing one headline speedup.

## 45.27 “AI-generated code is inherently insecure.”

**Evidence verdict:** Too absolute. Earlier assistant studies exposed real insecure-code/confidence risks [AI09], while 2026 evidence shows current LLMs can detect/repair many vulnerabilities yet still miss some and hallucinate confidence [AI12].

**Better rule:** Authorship does not determine security; independent secure-development and verification controls do.

## 45.28 “Human-in-the-loop makes an agent safe.”

**Verdict:** `F`.

**Better rule:** Human approval is one control; capability restrictions, policy enforcement, auditability and reversibility remain necessary.

## 45.29 “More agents solve complex tasks better.”

**Verdict:** `E — architecture choice`.

**Better rule:** Add agents/roles only when decomposition, specialization or isolation benefits exceed coordination/error propagation cost.

## 45.30 “Avoid dependencies; write it yourself.”

**Verdict:** `F`.

**Better rule:** Compare dependency risk with bespoke implementation/security/maintenance risk.

## 45.31 “Always update to the latest dependency immediately.”

**Verdict:** `F`.

**Better rule:** Monitor continuously and update deliberately based on security/support/compatibility urgency.

## 45.32 “Never break backward compatibility.”

**Verdict:** `F`.

**Better rule:** Preserve compatibility while consumers need it; deprecate/migrate/remove deliberately when indefinite compatibility creates excessive risk or complexity.

## 45.33 “Rewrite legacy code to remove technical debt.”

**Verdict:** `E — high-risk option`.

**Better rule:** Prefer incremental replacement unless a hard constraint invalidates the existing foundation.

## 45.34 “Never rewrite.”

**Verdict:** `F`.

**Better rule:** Rewrite only with a bounded migration strategy and evidence that incremental evolution cannot meet a material requirement.

## 45.35 “Technical debt is bad code.”

**Verdict:** `F`.

**Better rule:** Debt is future change/risk cost from a choice or constraint; some is rational and should be managed [TECH01].

## 45.36 “Good code is self-documenting.”

**Verdict:** `F`.

**Better rule:** Clear code documents mechanics; architecture rationale, external constraints and operational procedures often require separate durable explanation.

## 45.37 “More comments improve maintainability.”

**Verdict:** `F`.

**Better rule:** Comment rationale and non-obvious constraints; remove redundant/stale narration.

## 45.38 “Infrastructure as code makes infrastructure reproducible.”

**Verdict:** `B — incomplete`.

**Better rule:** IaC improves versioned intent; external state, mutable images, secrets, provider behavior and unpinned dependencies can still destroy reproducibility.

## 45.39 “Green CI means releasable.”

**Verdict:** `F`.

**Better rule:** CI is evidence; production readiness also depends on migration, config, capacity, security, observability and recovery.

## 45.40 “Staging proves production safety.”

**Verdict:** `F`.

**Better rule:** Staging catches classes of defects; only production has production traffic, scale, data, dependencies and emergent interactions. Use progressive release.

## 45.41 “Compliance means secure.”

**Verdict:** `F`.

**Better rule:** Compliance demonstrates scoped controls/evidence; security remains threat- and system-dependent.

## 45.42 “Design patterns are best practices.”

**Verdict:** `D/E`.

**Better rule:** A pattern names a recurring solution/trade-off; use only when the recurring problem exists.

## 45.43 “Premature optimization is the root of all evil, so ignore performance until later.”

**Verdict:** `F — misuse of a heuristic`.

**Better rule:** Avoid speculative micro-optimization while respecting hard architectural performance constraints early.

## 45.44 “Only optimize what users complain about.”

**Verdict:** `F`.

**Better rule:** Measure user and system constraints proactively; users cannot report silent resource waste, security degradation or approaching capacity cliffs.

## 45.45 “Automate everything.”

**Verdict:** `F`.

**Better rule:** Automate stable, understood, repeatable processes where automation lowers total error/cost; preserve human judgment for ambiguity/consequence.


## 45.46 “Passing SWE-bench means the patch is production-ready.”

**Evidence verdict:** False. A 2026 maintainer-review study found a substantial gap between automated SWE-bench pass rates and maintainer merge decisions in its sampled repositories [AI14].

**Better rule:** Benchmarks measure the defined benchmark. Production usefulness also includes maintainability, local conventions, integration, review, operations and risk.

## 45.47 “More generated code means more developer productivity.”

**Evidence verdict:** False as a universal metric. Output can increase while review load, understanding or change cost worsens [AI10][AI11].

**Better rule:** Measure delivered outcome and downstream burden, not production volume.

## 45.48 “Property-based testing replaces example tests.”

**Evidence verdict:** False. PBT is powerful when meaningful properties exist, but 2026 empirical work documents real adoption challenges and limited automated property generation [TEST06].

**Better rule:** Use properties for invariants/state spaces and examples for concrete behavior/explanation; combine according to risk.

## 45.49 “Formal verification proves the system is correct.”

**Evidence verdict:** False. Formal methods can establish specified properties of a model/implementation under assumptions; requirements/model fidelity remain separate validation problems [FORMAL01].

**Better rule:** Use formal methods to strengthen assurance for scoped critical properties, then verify the assumptions and model-to-implementation link.

## 45.50 “A longer queue makes the system more resilient to load.”

**Evidence verdict:** False as a general rule. Under sustained overload, queues primarily add latency/memory and can delay failure until resources exhaust [RES01].

**Better rule:** Size queues for known burst absorption, bound them, and combine with admission control/backpressure/load shedding.


---
# 46. Contradiction ledger

Engineering quality often lives in tensions, not absolutes.

| Debate | Evidence-weighted conclusion |
|---|---|
| Simplicity vs flexibility | Prefer simplicity until credible variability requires a stable extension point. Speculative flexibility is accidental complexity. |
| DRY vs duplication | Remove duplicated knowledge; tolerate explicit code duplication when semantic sameness is uncertain. |
| Monolith vs microservices | A modular monolith reduces distributed complexity; services earn their cost through independent scaling/deployment/ownership/isolation [ARCHMS01][ARCHMS02]. |
| Sync vs async | Sync is simpler for immediate bounded work; async adds buffering/decoupling but requires explicit ordering, duplication, backpressure and consistency semantics. |
| Wall-clock order vs causal order | Physical timestamps are useful metadata but do not by themselves define causality/global order across distributed actors [DIST01]. |
| SQL vs NoSQL | Choose data model, transaction, consistency and query needs first; both families can scale under suitable architectures. |
| Consistency vs availability | There is no universal winner; define what state may be stale/unavailable under which partitions/failures. |
| Strong typing vs dynamic typing | Strong types can prevent classes of representable errors; runtime/business correctness, ecosystem and team needs remain. Broad language-quality causal claims are weak [PL01][PL02]. |
| Unit vs integration tests | Unit tests give fast/local feedback; integration tests provide stronger evidence about real boundaries. Use the risk distribution, not dogma. |
| Example vs property tests | Examples communicate known scenarios; property tests explore generated space against invariants. Use both where each gives stronger evidence [TEST06]. |
| Testing vs formal methods | Tests sample executions; formal methods can exhaustively reason over scoped models/properties. Neither validates the requirement by itself [FORMAL01]. |
| Mocks vs real dependencies | Mocks isolate/accelerate; they can encode false behavior. Preserve contract fidelity at material boundaries. |
| Coverage vs test quality | Coverage locates executed code; it does not establish assertion quality or real-fault detection [TEST01][TEST04]. |
| TDD vs test-after | TDD can improve feedback/design for some work, but effects vary; use where the mechanism helps [TEST02]. |
| Pair vs solo | Pairing trades person-time for potential quality/knowledge/duration benefits depending on task and expertise [TEST03]. |
| Reliability vs velocity | Mature delivery can improve both; use user outcomes, error budgets and change safety rather than assuming a fixed trade-off [REL01][DORA01]. |
| Queue vs reject | Bounded queues can absorb bursts; under sustained overload, reject/degrade/backpressure can preserve useful capacity better than unbounded waiting [RES01]. |
| Retry vs fail fast | Retry transient safe operations within total deadline/resource budget; retries can amplify overload [PROTO01][RES01]. |
| Rollback vs roll-forward | Rollback is fast only when state/external effects remain compatible; roll-forward may be safer after irreversible migration. |
| Manual approval vs automation | Automation improves repeatability; human judgment helps with ambiguity/consequence. Rubber-stamp gates add delay without assurance. |
| Buy vs build | Buy commodity capabilities when acceptable; build where differentiation/control/constraints justify lifetime ownership. |
| Managed vs self-host | Managed services reduce some operations but add dependency, cost and control constraints. Accountability does not disappear. |
| Abstraction vs explicitness | Abstract stable shared policy; preserve explicit duplication while concepts are still diverging. |
| Caching vs source optimization | Fix source/algorithm first where feasible; cache when measured benefit exceeds staleness/invalidation complexity. |
| Performance vs maintainability | Prefer maintainable design until performance evidence shows a material constraint; document/test necessary optimizations. |
| Security vs usability | Reduce unnecessary friction but never remove required protection. Better design can often improve both. |
| Privacy vs analytics | Collect justified data; improve analytics design rather than assuming maximal collection is necessary [PRIV01]. |
| Observability vs data minimization | Instrument enough to operate safely while excluding/redacting unnecessary personal/secrets data. |
| Pin vs update dependencies | Pin for reproducibility; monitor and deliberately update for security/support. |
| SBOM vs security | SBOM improves inventory/transparency; provenance, exploitability, supplier risk and remediation are separate questions [SUP01][SUP02][SUP04]. |
| Stability vs upgrades | Avoid needless churn, but unsupported dependencies create security/compatibility debt. |
| Compatibility vs cleanup | Maintain compatibility while consumers need it; planned deprecation prevents permanent complexity. |
| Rewrite vs evolve | Incremental evolution preserves known behavior; rewrite only when constraints justify migration risk. |
| AI speed vs understanding | AI can increase output/completeness while effects on time and code ownership vary; measure both delivered value and comprehension where material [AI10][AI11]. |
| AI code vs human code security | Neither provenance alone establishes security; current AI can both introduce/miss and detect/repair vulnerabilities [AI09][AI12]. |
| AI benchmark vs usefulness | Automated task success is evidence about a benchmark, not guaranteed mergeability or production readiness [AI14]. |
| Agent autonomy vs human approval | Autonomy increases throughput; controls must scale with capability/consequence. Human review is one control, not the policy engine [AI05][AI06]. |
| Open source vs proprietary dependency | Neither is inherently more secure/reliable. Evaluate governance, support, provenance, updateability and exit risk. |
| Generality vs specialization | General systems increase reuse but add abstraction; specialize when the domain is stable/material. |
| Serverless vs persistent compute | Serverless can reduce operations for bursty workloads; persistent compute may be cheaper/predictable for steady workloads. Model it. |
| Kubernetes vs simpler PaaS | Kubernetes offers orchestration/control; simpler platforms can deliver required behavior with lower operational complexity. |
| Feature flags vs branches | Flags enable runtime exposure control; branches isolate code before integration. Both create different divergence/debt. |
| Fast CI vs exhaustive CI | Fast feedback supports integration; deeper checks can run asynchronously/pre-release where needed. Match blocking checks to risk. |
| Alert sensitivity vs noise | Sensitive alerts detect earlier but destroy attention when noisy. Page on actionable consequence. |
| Immutable infrastructure vs patch-in-place | Immutability improves reproducibility; emergencies can require controlled mutation. Preserve auditability either way. |
| Formal methods vs testing | Formal methods strengthen scoped assurance; testing observes implementation behavior. They complement rather than universally replace each other [FORMAL01]. |

# 47. Heuristics — useful, but not laws

## 47.1 YAGNI

**Use:** avoid speculative capability/abstraction.  
**Boundary:** known compliance, migration or scaling constraints may require early design.

## 47.2 KISS

**Use:** prefer direct understandable solutions.  
**Boundary:** “simple” cannot mean omitting necessary safety/security/failure handling.

## 47.3 DRY

**Use:** prevent duplicated knowledge/inconsistent rules.  
**Boundary:** premature shared abstraction can be worse than duplicated code.

## 47.4 SOLID

**Use:** prompts for responsibility/dependency reasoning in object-oriented/module design.  
**Boundary:** not a formal quality model; literal application can create indirection and tiny abstractions.

## 47.5 Test pyramid

**Use:** keep most feedback fast/cheap and minimize brittle expensive paths.  
**Boundary:** architecture/risk may justify different test distribution.

## 47.6 12-factor app

**Use:** useful cloud-service operational conventions.  
**Boundary:** not a universal standard for all software, especially stateful, embedded, desktop or high-assurance systems.

## 47.7 Semantic Versioning

**Use:** communicate compatibility intent for public versioned packages/APIs.  
**Boundary:** only meaningful when the public API and compatibility semantics are actually defined.

## 47.8 Conventional Commits

**Use:** machine-readable changelog/release automation.  
**Boundary:** commit syntax does not create good changes or traceability by itself.

## 47.9 Trunk-based development

**Use:** reduce long-lived integration divergence.  
**Boundary:** release/regulatory/large-scale constraints may require additional branch structures.

## 47.10 Blue/green deployment

**Use:** fast environment-level cutover/rollback.  
**Boundary:** databases/external side effects can make rollback unsafe.

## 47.11 Canary deployment

**Use:** reduce blast radius and gather production evidence [REL02].  
**Boundary:** canaries are weak when traffic is unrepresentative or health metrics cannot detect the failure.

## 47.12 Circuit breaker

**Use:** stop repeated calls to a failing dependency and allow recovery.  
**Boundary:** parameters/state can create their own failure mode; not every call path needs one.

## 47.13 Bulkhead

**Use:** isolate resource/failure domains.  
**Boundary:** isolation consumes resources and operational complexity.

## 47.14 CQRS

**Use:** separate read/write models when their needs materially diverge.  
**Boundary:** introduces synchronization/eventual-consistency complexity.

## 47.15 Event sourcing

**Use:** preserve event history/audit/replay when domain genuinely benefits.  
**Boundary:** projections, versioning, privacy deletion and mental complexity are substantial.

## 47.16 Repository/service layers

**Use:** hide volatile persistence/integration boundaries.  
**Boundary:** layers that merely proxy one-to-one add indirection without information hiding.

## 47.17 Dependency injection

**Use:** make dependencies explicit/substitutable.  
**Boundary:** containers/reflection can hide object graphs and complicate local reasoning.

## 47.18 “Boring technology”

**Use:** prefer well-understood tools for non-differentiating infrastructure.  
**Boundary:** old familiarity can become unsupported or fail a new requirement.

## 47.19 80/20 performance optimization

**Use:** focus on dominant bottlenecks.  
**Boundary:** high-assurance/real-time systems may require guarantees beyond average optimization.

## 47.20 Error budgets

**Use:** balance reliability and change using user-relevant SLOs [REL01].  
**Boundary:** safety/security integrity should not be deliberately “spent” as ordinary unreliability.

---

# 48. Project startup engineering brief

Use this to translate the master standard into project-specific constraints.

```yaml
project:
owner:
criticality: C0 | C1 | C2 | C3 | C4

problem:
users:
primary_outcome:

system_boundary:
external_dependencies:

functional_requirements:
quality_requirements:
  correctness:
  security:
  privacy:
  reliability:
  performance:
  accessibility:
  maintainability:
  cost:

state_and_data:
  sources_of_truth:
  sensitive_data:
  retention:
  consistency:

failure_model:
  critical_failures:
  degraded_modes:
  recovery_objectives:

architecture:
  key_boundaries:
  deployment_units:
  major_dependencies:
  irreversible_decisions:

verification:
  acceptance:
  automated_tests:
  security_checks:
  performance_checks:
  manual_independent_review:

operations:
  slis_slos:
  observability:
  alerts:
  backup_restore:
  runbooks:

release:
  migration:
  progressive_rollout:
  rollback_or_rollforward:

ai_if_used:
  model_role:
  evals:
  tool_permissions:
  human_approval_threshold:
  fallback:

regulatory_overlays:

known_assumptions:
known_risks:
review_triggers:
```

---

# 49. One-page Golden Standard

If only one section of this playbook may be used:

1. **Understand intended behavior, users, constraints and unacceptable failure before selecting technology.**
2. **Make material requirements and acceptance conditions observable enough to verify.**
3. **Classify criticality; increase assurance with consequence, exposure, irreversibility, uncertainty, blast radius and autonomy.**
4. **Use evidence that matches the claim; law, standards, experiments, operations and documentation answer different questions.**
5. **Build the least complex architecture that satisfies demonstrated requirements and credible constraints.**
6. **Minimize accidental complexity, not essential domain complexity.**
7. **Use high cohesion, controlled coupling and information hiding to contain change.**
8. **Make state, dependency direction, authority and operational ownership explicit.**
9. **Protect important invariants structurally where practical.**
10. **Do not infer distributed causal/global ordering from wall-clock timestamps without an actual guarantee.**
11. **Treat every trust boundary as a validation and authorization boundary.**
12. **Define interface success, failure, timeout, cancellation and compatibility semantics.**
13. **Assume dependencies can be slow, unavailable, duplicated, reordered or wrong.**
14. **Use finite deadlines/cancellation for remote work; retry only safe transient failures within a bounded budget.**
15. **Bound queues and concurrency; use backpressure/load shedding before overload becomes cascading failure.**
16. **Design idempotency/deduplication where retry or duplicate delivery is plausible.**
17. **Prefer explicit failure over silent corruption.**
18. **Design secure by default with least privilege, threat modeling and lifecycle vulnerability ownership.**
19. **Keep security/privacy/framework version status current; do not promote drafts to final standards.**
20. **Treat privacy separately from security and minimize sensitive collection, access and retention.**
21. **Set reliability objectives from user-relevant behavior rather than prestige uptime.**
22. **Instrument critical paths to answer operational questions; telemetry volume is not observability.**
23. **Measure latency distributions, errors, traffic, saturation and domain outcomes where relevant.**
24. **Profile before optimizing unless a hard constraint requires design-time action.**
25. **Treat scalability as workload, data, geography, organization, dependency and failure—not one number.**
26. **Treat cost/resource/environmental impact as constraints when materially relevant.**
27. **Design long-lived systems for compatibility, migration, deprecation and retirement.**
28. **Keep changes small, coherent, observable and recoverable where possible.**
29. **Use progressive exposure when production evidence is valuable and blast radius matters.**
30. **Design state/schema changes together with rollback/roll-forward strategy.**
31. **Select verification from failure modes and criticality, not a fixed testing ritual.**
32. **Coverage is execution evidence, not proof of quality.**
33. **Use property tests for meaningful invariants/state spaces, fuzzing for hostile/unexpected inputs and formal methods for scoped high-consequence properties where justified.**
34. **Automate deterministic checks; focus human review on semantics, risk and understanding.**
35. **Document why consequential decisions exist and what would invalidate them.**
36. **Treat dependencies, suppliers, CI/build and provenance as part of the product boundary.**
37. **Pin for reproducibility, monitor for risk, update deliberately.**
38. **SBOM/provenance/signatures are evidence layers, not proof of security.**
39. **Test restoration; an untested backup is not verified recoverability.**
40. **Learn from incidents by improving system conditions, controls and assumptions.**
41. **Treat AI-generated engineering output as untrusted until independently validated.**
42. **Measure AI by accepted outcomes, rework, defects, review cost and understanding—not tokens or generated code.**
43. **Preserve human/team ownership of critical systems even when AI increases throughput.**
44. **Scale agent permissions, runtime controls, approvals, auditability and reversibility with capability × consequence.**
45. **When evidence is contextual, uncertain or fast-moving, encode the boundary condition instead of inventing a universal rule.**

---

# 50. Research evidence map

This appendix makes V2 auditable. Each ID used in the body maps to one source or evidence family and records the useful finding, limitation and—where material—version/status at the 27 September 2026 cutoff. Formal standards are not treated as causal experiments; company frameworks are not treated as universal laws; empirical studies are not generalized beyond their populations without caution.

## Core lifecycle, quality, requirements and architecture

### BODY01 — IEEE Computer Society — Guide to the Software Engineering Body of Knowledge (SWEBOK) v4.0a
**URL:** https://www.computer.org/education/bodies-of-knowledge/software-engineering  
**Evidence:** `E4 — CONSENSUS_BODY_OF_KNOWLEDGE`  
**Finding:** Defines generally accepted, consensus-driven software-engineering knowledge across 18 knowledge areas. Version 4 adds Software Architecture, Software Engineering Operations and Software Security and explicitly includes professional practice, engineering economics and engineering foundations. The IEEE Computer Society identifies the September 2025 minor revision as v4.0a.  
**Limitation:** A disciplinary map and consensus reference, not causal evidence that every described practice is optimal or mandatory for every project.

### ETH01 — ACM — Code of Ethics and Professional Conduct
**URL:** https://www.acm.org/code-of-ethics  
**Evidence:** `E4 — PROFESSIONAL_ETHICS_STANDARD`  
**Finding:** Frames computing professionals' responsibilities around public good, avoiding harm, honesty/trustworthiness, competence, privacy, security, quality and responsible leadership.  
**Limitation:** Normative professional guidance rather than empirical evidence for specific technical implementations; local law, contracts and domain standards may impose additional duties.

### QUAL01 — ISO/IEC 25010:2023 — Product quality model
**URL:** https://www.iso.org/standard/78176.html  
**Evidence:** `E1 — INTERNATIONAL_STANDARD`  
**Finding:** Defines a product quality model with nine characteristics and positions the model for requirements, design, testing, quality control and evaluation across the lifecycle.  
**Limitation:** A reference model, not proof that all projects should weight every characteristic equally or use one aggregate quality score.

### LIFE01 — ISO/IEC/IEEE 12207:2026 — Software life cycle processes
**URL:** https://www.iso.org/standard/90219.html  
**Evidence:** `E1 — INTERNATIONAL_STANDARD`  
**Finding:** Establishes a common framework for software lifecycle processes spanning acquisition/supply, development, operation, maintenance and disposal/retirement.  
**Limitation:** Process standard; it does not mandate one agile/waterfall methodology or prove that more process is better.

### REQ01 — ISO/IEC/IEEE 29148:2018 — Requirements engineering
**URL:** https://www.iso.org/standard/72089.html  
**Evidence:** `E1 — INTERNATIONAL_STANDARD`  
**Finding:** Defines requirements-engineering processes and characteristics of requirements/specifications across system/software lifecycle contexts. The 2018 edition remains the current published standard at this playbook's research cutoff.  
**Limitation:** Requirements formality should scale with criticality; ordinary product discovery need not become document-heavy. A third edition is already under development as ISO/IEC/IEEE DIS 29148 (DIS ballot initiated 14 September 2026), so this reference should be revisited when the replacement is published.

### VV01 — IEEE 1012-2024 — System, software, and hardware verification and validation
**URL:** https://standards.ieee.org/ieee/1012/7324/  
**Evidence:** `E1 — FORMAL_STANDARD`  
**Finding:** Treats V&V broadly and scales tasks/rigor using integrity levels, supporting risk-proportional assurance.  
**Limitation:** High-assurance standard; not every activity is justified for low-consequence software.

### MAINT01 — ISO/IEC/IEEE 14764:2022 — Software maintenance
**URL:** https://www.iso.org/standard/80710.html  
**Evidence:** `E1 — INTERNATIONAL_STANDARD`  
**Finding:** Provides detailed guidance for software maintenance processes and types of maintenance.  
**Limitation:** Focuses maintenance rather than all operational functions; pair with lifecycle/operations guidance.

### NASA01 — NASA Software Engineering Handbook — Classification and Safety-Critical Assessment
**URL:** https://swehb.nasa.gov/spaces/7150/pages/16449773/7.02%2B-%2BClassification%2Band%2BSafety-Critical%2BAssessment  
**Evidence:** `E4 — GOVERNMENT_HIGH_ASSURANCE_GUIDANCE`  
**Finding:** NASA software classification and safety criticality determine the minimum applicable engineering/assurance requirements.  
**Limitation:** NASA mission context; use as evidence for risk-proportional assurance, not as a baseline process for ordinary commercial software.

### ARCH01 — Carnegie Mellon SEI — Quality attributes / software architecture practice
**URL:** https://www.sei.cmu.edu/library/quality-attributes/  
**Evidence:** `E4/E5 — RESEARCH_AND_PRACTICE_BODY`  
**Finding:** Treats software quality as interacting attributes shaped by architecture and emphasizes systematic reasoning about quality trade-offs.  
**Limitation:** Foundational architecture framework; individual tactics still require system-specific validation.

### ARCH02 — Carnegie Mellon SEI — Architecture Tradeoff Analysis Method (ATAM)
**URL:** https://www.sei.cmu.edu/library/atam-method-for-architecture-evaluation/  
**Evidence:** `E4/E5 — ARCHITECTURE_EVALUATION_METHOD`  
**Finding:** Provides a structured method for identifying architecture risks, sensitivities and trade-offs among qualities such as performance, availability, security and modifiability.  
**Limitation:** Formal ATAM execution can be heavier than needed for small/low-risk systems; the transferable principle is explicit scenario/trade-off analysis.

### MOD01 — Parnas — On the Criteria To Be Used in Decomposing Systems into Modules
**URL:** https://doi.org/10.1145/361598.361623  
**Evidence:** `E3 — FOUNDATIONAL_PEER_REVIEWED_SOFTWARE_ENGINEERING`  
**Finding:** Argues for modular decomposition by information hiding/design decisions likely to change rather than by processing steps alone.  
**Limitation:** Foundational 1972 work; modern distributed/system constraints add concerns beyond modular decomposition.


### DIST01 — Leslie Lamport — Time, Clocks, and the Ordering of Events in a Distributed System
**URL:** https://www.microsoft.com/en-us/research/publication/time-clocks-ordering-events-distributed-system/  
**Evidence:** `E3 — FOUNDATIONAL_PEER_REVIEWED_DISTRIBUTED_SYSTEMS`  
**Finding:** Formalizes the “happened-before” causal relation as a partial ordering and logical clocks for consistent ordering, establishing why distributed event causality cannot generally be derived from one perfectly shared physical time.  
**Limitation:** Foundational model rather than a modern implementation cookbook; contemporary databases/streaming systems can provide stronger scoped ordering guarantees that must be understood from their actual contracts.

## Security, privacy and memory safety

### SEC01 — NIST SP 800-218 — Secure Software Development Framework (SSDF) v1.1
**URL:** https://csrc.nist.gov/pubs/sp/800/218/final  
**Evidence:** `E4 — GOVERNMENT_SECURITY_FRAMEWORK`  
**Finding:** Defines high-level secure-development practices intended to integrate into different SDLCs and reduce vulnerabilities and root causes.  
**Limitation:** Framework baseline; concrete implementation/verifications depend on technology, threat model and risk.

### SEC02 — CISA — Secure by Design
**URL:** https://www.cisa.gov/securebydesign  
**Evidence:** `E4 — GOVERNMENT_SECURITY_GUIDANCE`  
**Finding:** Promotes security as a core product requirement, secure defaults and manufacturer ownership of security outcomes.  
**Limitation:** Security principles/guidance, not a complete technical verification standard.

### SEC03 — OWASP Application Security Verification Standard 5.0
**URL:** https://owasp.org/www-project-application-security-verification-standard/  
**Evidence:** `E4 — OPEN_CONSENSUS_APPLICATION_SECURITY_STANDARD`  
**Finding:** Provides concrete application-security verification requirements and assurance levels.  
**Limitation:** Application-focused; infrastructure, business risk, privacy, safety and full threat model may require additional controls.

### SEC04 — OWASP Top 10:2025
**URL:** https://top10.owasp.org/2025/  
**Evidence:** `E4/E7 — SECURITY_AWARENESS_CONSENSUS`  
**Finding:** Current web application risk-awareness list includes access control, misconfiguration, software supply chain, cryptography, injection, insecure design, authentication, integrity, logging/alerting and exceptional-condition risks.  
**Limitation:** OWASP explicitly positions it as an awareness document; passing the Top 10 is not a security certification.


### SEC05 — NIST SP 800-218 Rev. 1 Initial Public Draft — SSDF v1.2
**URL:** https://csrc.nist.gov/pubs/sp/800/218/r1/ipd  
**Evidence:** `E4 — GOVERNMENT_SECURITY_FRAMEWORK_DRAFT`  
**Finding:** Released 17 December 2025 as an Initial Public Draft with new/improved SSDF practices, tasks and examples. At the V2 cutoff it remains draft; NIST's C-SCRM publication status page still lists it as such.  
**Limitation:** Draft material can change and must not silently replace final SSDF v1.1 in compliance/baseline claims.

### DEVSEC01 — NIST NCCoE — Secure Software Development, Security, and Operations (DevSecOps) Practices live document
**URL:** https://www.nccoe.nist.gov/projects/secure-software-development-security-and-operations-devsecops-practices  
**Evidence:** `E4/E5 — GOVERNMENT_APPLIED_LIVE_GUIDANCE`  
**Finding:** 2026 live/draft NCCoE project demonstrates risk-based implementations of SSDF in modern DevSecOps environments; September 2026 updates added SSDF mapping, additional implementation/demonstration material and an updated AI section.  
**Limitation:** Active live document under public feedback, focused on demonstration/example implementations; not a final universal architecture standard.

### PRIV01 — NIST Privacy Framework 1.0 / Privacy Framework 1.1 Initial Public Draft
**URL:** https://www.nist.gov/privacy-framework  
**Evidence:** `E4 — GOVERNMENT_PRIVACY_RISK_FRAMEWORK`  
**Finding:** Treats privacy risk management as a distinct organizational/system concern. At the V2 cutoff, the NIST site still identifies Privacy Framework 1.1 as an Initial Public Draft and says the final 1.1 is coming soon; do not cite 1.1 as final.  
**Limitation:** Voluntary framework; legal requirements vary by jurisdiction/use case, and draft 1.1 material can change before final publication.

### MSAFE01 — CISA — The Case for Memory Safe Roadmaps
**URL:** https://www.cisa.gov/resources-tools/resources/case-memory-safe-roadmaps  
**Evidence:** `E4 — GOVERNMENT_SECURITY_GUIDANCE`  
**Finding:** Recommends software manufacturers develop roadmaps toward memory-safe languages to eliminate broad memory-safety vulnerability classes.  
**Limitation:** Migration feasibility, performance, interoperability and legacy constraints can make immediate replacement inappropriate.

### MSAFE02 — Google Security Blog — Secure by Design: Google's perspective on memory safety
**URL:** https://security.googleblog.com/2024/03/secure-by-design-googles-perspective-on.html  
**Evidence:** `E5 — LARGE_SCALE_SECURITY_OPERATIONAL_EVIDENCE`  
**Finding:** Describes memory safety as a major vulnerability driver and Google's multi-pronged approach including memory-safe languages and hardened existing code.  
**Limitation:** Google-specific engineering context; does not establish that one language is universally best.

## Supply chain, builds and CI security

### SUP01 — SLSA specification v1.2 / provenance
**URL:** https://slsa.dev/spec/v1.2/  
**Evidence:** `E4 — OPEN_SUPPLY_CHAIN_STANDARD`  
**Finding:** SLSA v1.2 is the current approved specification at the V2 cutoff and defines levels/tracks and provenance/attestation concepts for incrementally stronger software supply-chain guarantees.  
**Limitation:** SLSA addresses supply-chain integrity; it does not prove source correctness, vulnerability absence, supplier trustworthiness or complete product security.

### SUP02 — SPDX specifications
**URL:** https://spdx.dev/use/specifications/  
**Evidence:** `E4/E1 — OPEN_STANDARD / ISO_BASE`  
**Finding:** SPDX provides a standardized machine-readable model for software/system bill-of-materials and related license, security and provenance data; SPDX 3.0 is the current project specification, while ISO/IEC 5962:2021 standardizes the earlier SPDX base and a new ISO revision is in development.  
**Limitation:** Inventory/transparency format; an SPDX document does not prove artifact or component security.

### SUP03 — CycloneDX 1.7
**URL:** https://cyclonedx.org/specification/overview/  
**Evidence:** `E4 — OPEN_SUPPLY_CHAIN_STANDARD`  
**Finding:** Current CycloneDX specification models components, services, dependencies and broader supply-chain/BOM information.  
**Limitation:** Transparency representation; security depends on data quality, provenance, analysis and remediation processes.


### SUP04 — NIST SP 1326 — C-SCRM Due Diligence Assessment Quick-Start Guide
**URL:** https://csrc.nist.gov/pubs/sp/1326/final  
**Evidence:** `E4 — FINAL_GOVERNMENT_SUPPLY_CHAIN_GUIDANCE`  
**Finding:** Finalized 8 July 2026. Provides implementation-oriented ICT supplier due-diligence considerations including foreign ownership/control/influence, provenance, resilience, foundational cyber practices and supply-chain tiers.  
**Limitation:** Quick-start guide for C-SCRM supplier assessment, not proof that a supplier/product is secure and not proportionate for every low-risk dependency.

### BUILD01 — Reproducible Builds — definition
**URL:** https://reproducible-builds.org/docs/definition/  
**Evidence:** `E4/E7 — OPEN_BUILD_INTEGRITY_PRACTICE`  
**Finding:** Defines reproducibility as recreating bit-for-bit identical specified artifacts from the same source, build environment and instructions.  
**Limitation:** Reproducibility proves consistency of build results, not that source or dependencies are safe.

### GH01 — GitHub Actions Secure Use Reference — pin actions
**URL:** https://docs.github.com/en/actions/reference/security/secure-use  
**Evidence:** `E6 — OFFICIAL_PLATFORM_SECURITY_GUIDANCE`  
**Finding:** GitHub states pinning an action to a full-length commit SHA is the only immutable release reference and recommends auditing third-party workflow/action code.  
**Limitation:** GitHub-specific; SHA pinning still requires an update/vulnerability-monitoring process.

### GH02 — GitHub Actions Secure Use Reference — least privilege / workflow security
**URL:** https://docs.github.com/en/actions/reference/security/secure-use  
**Evidence:** `E6 — OFFICIAL_PLATFORM_SECURITY_GUIDANCE`  
**Finding:** Provides controls for minimizing workflow risk, permissions and third-party automation exposure.  
**Limitation:** Does not substitute for broader CI/CD threat modeling or cloud IAM design.

### GH03 — GitHub Actions OpenID Connect
**URL:** https://docs.github.com/en/actions/concepts/security/openid-connect  
**Evidence:** `E6 — OFFICIAL_PLATFORM_SECURITY_GUIDANCE`  
**Finding:** OIDC enables workflows to obtain scoped short-lived cloud credentials instead of storing duplicated long-lived cloud secrets.  
**Limitation:** Trust-policy conditions and cloud-side IAM must still be configured correctly.

## Reliability, observability, delivery and cloud operations

### REL01 — Google SRE Workbook — Implementing SLOs
**URL:** https://sre.google/workbook/implementing-slos/  
**Evidence:** `E5 — MATURE_LARGE_SCALE_OPERATIONAL_GUIDANCE`  
**Finding:** SLOs should reflect customer/user-relevant reliability; Google explicitly argues that 100% reliability is generally the wrong target and uses error budgets to balance reliability and change.  
**Limitation:** SRE model must be adapted for offline, embedded, safety-critical or small systems; error budgets do not license security/safety violations.

### REL02 — Google SRE Workbook — Canarying Releases
**URL:** https://sre.google/workbook/canarying-releases/  
**Evidence:** `E5 — MATURE_LARGE_SCALE_OPERATIONAL_GUIDANCE`  
**Finding:** Production canaries expose a change to a limited cohort to detect defects with reduced impact and acknowledge that tests cannot perfectly reproduce production.  
**Limitation:** Canary effectiveness depends on representative traffic, useful health signals and fast mitigation.

### REL03 — Google SRE Book — Monitoring Distributed Systems
**URL:** https://sre.google/sre-book/monitoring-distributed-systems/  
**Evidence:** `E5 — MATURE_LARGE_SCALE_OPERATIONAL_GUIDANCE`  
**Finding:** Defines latency, traffic, errors and saturation as four strong baseline signals for user-facing systems.  
**Limitation:** Four signals are not a complete domain-specific observability model.


### RES01 — Google SRE — Addressing Cascading Failures / Handling Overload
**URL:** https://sre.google/sre-book/addressing-cascading-failures/  
**Evidence:** `E5 — MATURE_LARGE_SCALE_OPERATIONAL_GUIDANCE`  
**Finding:** Documents overload as a common cascading-failure mechanism and discusses bounded queues, load shedding, graceful degradation, retry/backoff/jitter and capacity testing to prevent positive feedback and resource exhaustion.  
**Limitation:** Google-scale service guidance; exact queue/concurrency/load-shedding design depends on workload semantics and smaller/offline systems may need much simpler controls.

### OBS01 — OpenTelemetry — Observability primer
**URL:** https://opentelemetry.io/docs/concepts/observability-primer/  
**Evidence:** `E4/E6 — OPEN_TELEMETRY_STANDARD_GUIDANCE`  
**Finding:** Defines observability as understanding a system from the outside through emitted signals and distinguishes the goal from individual telemetry types.  
**Limitation:** OpenTelemetry is an instrumentation ecosystem; using it does not automatically make a system diagnosable.

### DORA01 — DORA software delivery performance metrics
**URL:** https://dora.dev/guides/dora-metrics/  
**Evidence:** `E2/E5 — LONGITUDINAL_INDUSTRY_RESEARCH`  
**Finding:** Current model uses five metrics grouped into throughput (change lead time, deployment frequency, failed deployment recovery time) and instability (change fail rate, deployment rework rate); DORA warns against metric gaming and notes speed/stability are not inherent trade-offs.  
**Limitation:** Application/service context matters; the metrics are not individual-developer productivity measures or universal targets.

### DORA02 — DORA State of AI-assisted Software Development 2025
**URL:** https://dora.dev/research/2025/dora-report/  
**Evidence:** `E2/E5 — LARGE_INDUSTRY_RESEARCH`  
**Finding:** Characterizes AI primarily as an amplifier of underlying organizational strengths and weaknesses rather than a standalone transformation mechanism.  
**Limitation:** Survey/industry-system evidence; effect size for a particular coding task/tool/repository must be measured locally.

### CLOUD01 — AWS Well-Architected Framework
**URL:** https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html  
**Evidence:** `E5/E6 — MATURE_VENDOR_ARCHITECTURE_FRAMEWORK`  
**Finding:** Organizes cloud architecture around operational excellence, security, reliability, performance efficiency, cost optimization and sustainability.  
**Limitation:** AWS/cloud-specific operational guidance, not independent proof of universal architecture optimality.

### CLOUD02 — Microsoft Azure Well-Architected Framework
**URL:** https://learn.microsoft.com/en-us/azure/well-architected/  
**Evidence:** `E5/E6 — MATURE_VENDOR_ARCHITECTURE_FRAMEWORK`  
**Finding:** Uses reliability, security, cost optimization, operational excellence and performance efficiency as workload pillars and explicitly discusses trade-offs.  
**Limitation:** Azure-specific implementation context.

### CLOUD03 — Google Cloud Well-Architected Framework
**URL:** https://docs.cloud.google.com/architecture/framework  
**Evidence:** `E5/E6 — MATURE_VENDOR_ARCHITECTURE_FRAMEWORK`  
**Finding:** Current framework covers operational excellence, security/privacy/compliance, reliability, cost, performance and sustainability, with technology/industry perspectives.  
**Limitation:** Google Cloud implementation guidance; principles generalize more than service choices.

### CLOUD04 — IBM Well-Architected Framework
**URL:** https://www.ibm.com/think/architectures/well-architected  
**Evidence:** `E5/E6 — MATURE_VENDOR_ARCHITECTURE_FRAMEWORK`  
**Finding:** Uses hybrid/portable, resiliency, efficient operations, security/compliance, performance, and financial operations/sustainability pillars.  
**Limitation:** IBM/hybrid-cloud perspective; included as triangulation, not causal evidence.


## Accessibility, protocol semantics and regulatory overlays

### ACC01 — WCAG 2.2 / ISO/IEC 40500:2025
**URL:** https://www.w3.org/WAI/standards-guidelines/wcag/  
**Evidence:** `E1/E4 — INTERNATIONAL_WEB_ACCESSIBILITY_STANDARD`  
**Finding:** WCAG 2.2 defines testable accessibility success criteria for perceivable, operable, understandable and robust web content and was approved as ISO/IEC 40500:2025 on 21 October 2025.  
**Limitation:** WCAG is a web-accessibility baseline, not a complete usability model or universal native/embedded interface standard; jurisdictions/platforms can impose additional requirements.

### PROTO01 — IETF RFC 9110 — HTTP Semantics / idempotent methods
**URL:** https://www.rfc-editor.org/rfc/rfc9110.html  
**Evidence:** `E4/E6 — INTERNET_STANDARD / PROTOCOL_SEMANTICS`  
**Finding:** Defines safe and idempotent HTTP method semantics and explains why automatic retry is appropriate for idempotent requests, while clients should not automatically retry non-idempotent requests unless they know the operation is safe to repeat or was not applied.  
**Limitation:** HTTP method idempotency is protocol semantics; business operations may require explicit idempotency keys, deduplication or state checks beyond the method name.

### REG01 — EU Cyber Resilience Act (Regulation (EU) 2024/2847)
**URL:** https://digital-strategy.ec.europa.eu/en/policies/cra-summary  
**Evidence:** `E0 — BINDING_EU_REGULATION`  
**Finding:** Establishes horizontal cybersecurity requirements for products with digital elements, including secure design/development and lifecycle vulnerability handling. Reporting obligations under Article 14 apply from 11 September 2026; the main provisions apply from 11 December 2027.  
**Limitation:** Applicability depends on product, role, market and exemptions; this playbook is not legal advice and projects must assess the authoritative regulation and current Commission/ENISA guidance.

### REG02 — EU AI Act — Article 50 transparency obligations
**URL:** https://digital-strategy.ec.europa.eu/en/library/guidelines-transparency-obligations-providers-and-deployers-ai-systems  
**Evidence:** `E0 — BINDING_EU_REGULATION / OFFICIAL_GUIDANCE`  
**Finding:** The European Commission states that Article 50 transparency obligations apply from 2 August 2026 and provides current guidance for providers and deployers of AI systems subject to those obligations.  
**Limitation:** Article 50 is only one part of the AI Act; obligations differ by actor, system category and date, and some legacy-system marking/detection duties have a limited grace period.

## AI, agentic systems and AI-assisted development

### AI01 — NIST AI 600-1 — Generative Artificial Intelligence Profile
**URL:** https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence  
**Evidence:** `E4 — GOVERNMENT_AI_RISK_FRAMEWORK`  
**Finding:** Provides a cross-sectoral companion profile to the NIST AI RMF for identifying and managing risks specific to generative AI across design, development, use and evaluation.  
**Limitation:** Voluntary risk-management guidance; it does not prescribe one architecture or prove the effectiveness of every listed mitigation.

### AI02 — NIST SP 800-218A — Secure Software Development Practices for Generative AI and Dual-Use Foundation Models
**URL:** https://csrc.nist.gov/pubs/sp/800/218/a/final  
**Evidence:** `E4 — GOVERNMENT_SECURE_DEVELOPMENT_PROFILE`  
**Finding:** Extends SSDF v1.1 with AI-model-specific secure-development practices, tasks and considerations for model producers, AI-system producers and acquirers across the software lifecycle.  
**Limitation:** Focused on secure development and AI-model risks; broader product quality, safety, privacy and operational assurance still require complementary controls.

### AI03 — OpenSSF — Security-Focused Guide for AI Code Assistant Instructions
**URL:** https://best.openssf.org/Security-Focused-Guide-for-AI-Code-Assistant-Instructions  
**Evidence:** `E4/E7 — OPEN_SECURITY_CONSENSUS_GUIDANCE`  
**Finding:** Treats AI code assistants as tools that can produce insecure or incorrect output and recommends explicit security-focused instructions while preserving ordinary software-security controls and validation.  
**Limitation:** Practical guidance rather than controlled evidence that a particular prompt or assistant configuration guarantees secure code.

### AI04 — GitHub Docs — Review AI-generated code / responsible use
**URL:** https://docs.github.com/en/copilot/tutorials/review-ai-generated-code  
**Evidence:** `E6 — OFFICIAL_TOOL_SAFETY_GUIDANCE`  
**Finding:** GitHub recommends functional checks, automated tests, static analysis, contextual review and dependency scrutiny for AI-generated code, explicitly treating human review and testing as essential verification steps.  
**Limitation:** GitHub/Copilot-specific guidance; independent assurance must remain tied to the software risk rather than the vendor or model used.

### AI05 — OWASP Top 10 for Agentic Applications for 2026
**URL:** https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/  
**Evidence:** `E4 — OPEN_SECURITY_CONSENSUS_FRAMEWORK`  
**Finding:** Identifies critical risks created by autonomous/agentic systems that plan, use tools and take actions, including goal hijacking, tool misuse, identity/privilege abuse, supply-chain risk, unexpected execution, memory/context poisoning and cascading failures.  
**Limitation:** A risk-awareness and mitigation framework, not a complete agent-security certification or proof that listed controls are sufficient for every system.

### AI06 — OWASP Agent Control Standard (ACS)
**URL:** https://genai.owasp.org/resource/agent-control-standard-acs/  
**Evidence:** `E4 — OPEN_AGENT_CONTROL_STANDARD`  
**Finding:** Defines an open control foundation for agent inspectability, traceability, instrumentation and runtime policy enforcement through portable middleware/control hooks.  
**Limitation:** New 2026 standard with evolving implementation maturity; effective safety still depends on identity, authorization, sandboxing, policy quality and system-specific recovery controls.

### AI07 — Peng et al. — The Impact of AI on Developer Productivity: Evidence from GitHub Copilot
**URL:** https://arxiv.org/abs/2302.06590  
**Evidence:** `E3 — CONTROLLED_EXPERIMENT`  
**Finding:** In a bounded experiment where developers implemented a JavaScript HTTP server, participants with GitHub Copilot completed the task 55.8% faster on average than the control group.  
**Limitation:** One constrained task, tool generation and participant setting; the result must not be generalized to mature repositories, long-horizon work, quality outcomes or all AI coding systems.

### AI08 — METR — Measuring the Impact of Early-2025 AI on Experienced Open-Source Developer Productivity
**URL:** https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/  
**Evidence:** `E3 — RANDOMIZED_FIELD_EXPERIMENT`  
**Finding:** In an RCT with experienced open-source developers working on their own repositories, access to early-2025 AI tools increased task completion time by 19% on average in the studied setting.  
**Limitation:** Snapshot of particular 2025 models, developers and repositories; fast-moving tool capability means the sign and magnitude of effects can change and should be re-measured.

### AI09 — Perry et al. — Do Users Write More Insecure Code with AI Assistants?
**URL:** https://doi.org/10.1145/3576915.3623157  
**Evidence:** `E3 — PEER_REVIEWED_CONTROLLED_USER_STUDY`  
**Finding:** In a security-focused user study across Python, JavaScript and C tasks, participants with an AI coding assistant produced less secure solutions on most tasks and were more likely to believe insecure solutions were secure.  
**Limitation:** Used an earlier Codex-era model and a limited participant/task set; it demonstrates a real risk mechanism, not the security performance of every current assistant.


### AI10 — METR — We are Changing our Developer Productivity Experiment Design (2026)
**URL:** https://metr.org/blog/2026-02-24-uplift-update/  
**Evidence:** `E3 — FIELD_EXPERIMENT_METHODOLOGY_UPDATE`  
**Finding:** METR reports that its late-2025 follow-up experiment no longer provides a reliable precise current AI productivity estimate because developers/tasks expected to benefit from AI increasingly selected out of AI-disallowed participation and concurrent agent use complicated time measurement.  
**Limitation:** The update is itself evidence about measurement limitations and selection, not a reliable universal speedup estimate; METR believes current uplift likely increased but explicitly calls the magnitude weakly evidenced.

### AI11 — “More Code, Less Understanding?” — IEEE Transactions on Software Engineering (2026)
**URL:** https://ieeexplore.ieee.org/document/11458664/  
**Evidence:** `E3 — PEER_REVIEWED_CONTROLLED_EXPERIMENT`  
**Finding:** In a 69-participant experiment, AI assistance produced much higher median task completeness while participants showed lower ability to answer technical questions about the code they implemented (a code-ownership proxy); time effects were not strongly established.  
**Limitation:** Mixed student/researcher/professional sample and bounded tasks; the measured ownership effect is a risk signal rather than a universal effect size for all modern agentic workflows.

### AI12 — Secure coding with AI — Empirical Software Engineering (2026)
**URL:** https://link.springer.com/article/10.1007/s10664-026-10812-8  
**Evidence:** `E3 — PEER_REVIEWED_EMPIRICAL_SECURITY_STUDY`  
**Finding:** Analysis of 2,315 C/C++/C# DevGPT snippets identified 56 confirmed vulnerabilities in 48 files; GPT-4.1, GPT-5 and Claude Opus 4.1 detected/repaired roughly three-quarters to four-fifths when explicitly tasked, while still missing vulnerabilities and sometimes responding confidently incorrectly. The study found generated code in its dataset about as likely to contain vulnerabilities as developer-written code.  
**Limitation:** Specific languages/dataset/prompts and model versions; scanner/manual-review methodology and rapid model evolution limit universal security-rate claims.

### AI13 — Echoes of AI: downstream effects on software maintainability — Empirical Software Engineering (2026)
**URL:** https://link.springer.com/article/10.1007/s10664-026-10889-1  
**Evidence:** `E3 — PREREGISTERED_CONTROLLED_EXPERIMENT`  
**Finding:** Two-phase study with 151 participants (95% professional developers) found no significant downstream difference in evolution completion time or code quality when new developers evolved Java solutions co-developed with versus without AI in the studied setting; any advantage was small/uncertain.  
**Limitation:** Tasks were Java/web and data were collected before the latest autonomous coding-agent generation; it does not settle maintainability effects of current large agentic changes.

### AI14 — METR — Many SWE-bench-Passing PRs Would Not Be Merged into Main (2026)
**URL:** https://metr.org/notes/2026-03-10-many-swe-bench-passing-prs-would-not-be-merged-into-main/  
**Evidence:** `E3 — MAINTAINER_REVIEW_EMPIRICAL_STUDY`  
**Finding:** In 296 AI-generated PR reviews across three SWE-bench Verified repositories, maintainer merge decisions were materially below automated grader pass rates, demonstrating that benchmark success does not map directly to real maintainer acceptance.  
**Limitation:** Three repositories, one benchmark/harness context and no iterative agent response to review; supports benchmark-to-workflow caution rather than a general model capability ceiling.

## Architecture and programming-language evidence

### ARCHMS01 — Migration of monolithic systems to microservices: A systematic mapping study
**URL:** https://doi.org/10.1016/j.infsof.2024.107590  
**Evidence:** `E2 — SYSTEMATIC_MAPPING_STUDY`  
**Finding:** Review of 114 selected studies finds migration to microservices complex and heterogeneous; scalability and maintenance are common drivers, while communication and database migration are major challenges and relatively few studies directly assess claimed benefits.  
**Limitation:** Focused on migration literature rather than all greenfield architecture decisions; study quality and reported industrial contexts vary.

### ARCHMS02 — Razzaq — Systematic mapping from monolithic to microservice architecture
**URL:** https://doi.org/10.1002/cae.22586  
**Evidence:** `E2 — SYSTEMATIC_MAPPING_STUDY`  
**Finding:** Synthesizes 73 studies on microservice adoption/migration, including motivations, migration approaches, challenges, success factors and industrial adoption, reinforcing that microservices introduce substantial context-dependent trade-offs rather than a universal improvement.  
**Limitation:** Mapping study largely reflects literature through 2021 and cannot establish a single causal architecture winner.

### PL01 — Ray et al. — A Large-Scale Study of Programming Languages and Code Quality in GitHub
**URL:** https://doi.org/10.1145/3126905  
**Evidence:** `E3 — LARGE_OBSERVATIONAL_SOFTWARE_ENGINEERING_STUDY`  
**Finding:** Reported statistically significant but modest associations between some language characteristics and defect-related outcomes across a large GitHub dataset, while emphasizing that process factors dominated the effects and causal interpretation was not justified.  
**Limitation:** Observational repository mining is vulnerable to classification, measurement and confounding problems; later reproduction/reanalysis materially weakened the findings [PL02].

### PL02 — Berger et al. — On the Impact of Programming Languages on Code Quality: A Reproduction Study
**URL:** https://doi.org/10.1145/3340571  
**Evidence:** `E3 — PEER_REVIEWED_REPRODUCTION_AND_REANALYSIS`  
**Finding:** Reanalysis of the earlier GitHub language/quality study found methodological problems, reduced the number of reported language associations substantially and found exceedingly small practical effects; it explicitly rejects causal claims from the dataset.  
**Limitation:** Still analyzes observational repository data; it supports epistemic caution rather than proving that language choice never affects defect classes or engineering outcomes.

## Testing and quality-engineering evidence

### TEST01 — Petrović et al. — Long Term Effects of Mutation Testing
**URL:** https://research.google/pubs/long-term-effects-of-mutation-testing/  
**Evidence:** `E3/E5 — LARGE_SCALE_INDUSTRIAL_EMPIRICAL_STUDY`  
**Finding:** Analysis of roughly 15 million mutants at Google found evidence that mutation feedback led developers to add higher-quality tests and that surviving mutants were coupled with historical real faults.  
**Limitation:** Google-scale workflow and mutation infrastructure are unusual; mutation testing remains a proxy and can be costly or less useful for some code types.

### TEST02 — Rafique & Mišić — Effects of Test-Driven Development on External Quality and Productivity: A Meta-Analysis
**URL:** https://doi.org/10.1109/TSE.2012.28  
**Evidence:** `E2 — META_ANALYSIS`  
**Finding:** Across 27 studies, TDD showed a small positive average effect on external quality and little/no overall productivity effect, with substantial differences between academic and industrial settings and other moderators.  
**Limitation:** Evidence predates many modern toolchains and study designs vary; it supports context-dependent use rather than a universal TDD mandate.

### TEST03 — Hannay et al. — The effectiveness of pair programming: A meta-analysis
**URL:** https://doi.org/10.1016/j.infsof.2009.02.001  
**Evidence:** `E2 — META_ANALYSIS`  
**Finding:** Pair programming showed context-dependent trade-offs among quality, elapsed duration and total effort, with meaningful between-study variance and task-complexity interactions.  
**Limitation:** Older evidence and heterogeneous tasks/populations; pairing benefits depend strongly on task, expertise, objective and collaboration quality.

### TEST04 — Chekam et al. — Mutation, Statement and Branch Coverage Fault Revelation
**URL:** https://doi.org/10.1109/ICSE.2017.61  
**Evidence:** `E3 — PEER_REVIEWED_EMPIRICAL_TESTING_STUDY`  
**Finding:** Finds that fault revelation varies substantially by adequacy criterion; strong mutation testing outperformed statement/branch coverage in the studied setting, and coverage levels alone did not constitute proof of test-suite effectiveness.  
**Limitation:** Specific subject programs/methodology; no single adequacy metric proves correctness, and mutation analysis has cost/equivalent-mutant limitations.

### TEST05 — NIST — Fuzz Testing for Software Assurance
**URL:** https://www.nist.gov/publications/fuzz-testing-software-assurance  
**Evidence:** `E4 — GOVERNMENT_SOFTWARE_ASSURANCE_GUIDANCE`  
**Finding:** Describes fuzzing as supplying invalid, unexpected or random inputs while monitoring undesirable behavior and notes its effectiveness for discovering robustness/security vulnerabilities.  
**Limitation:** Fuzzing is strongest at suitable input surfaces and cannot replace specification-based tests, semantic validation, review or formal analysis where those are required.


### TEST06 — de Oliveira et al. — Property-based testing in Python: empirical insights (2026)
**URL:** https://link.springer.com/article/10.1007/s10664-026-10953-w  
**Evidence:** `E3 — PEER_REVIEWED_EMPIRICAL_TESTING_STUDY`  
**Finding:** Analyzes real property-based tests across 244 Python projects plus developer questions/tool support; documents common property categories, data-generation difficulties and that current automated generation fully reproduced only a minority of sampled real tests.  
**Limitation:** Python/Hypothesis-specific observational evidence; demonstrates adoption/challenges rather than a causal quality improvement for every project.

### FORMAL01 — Newcombe et al. — How Amazon Web Services uses formal methods
**URL:** https://www.amazon.science/publications/how-amazon-web-services-uses-formal-methods  
**Evidence:** `E3/E5 — PEER_REVIEWED_INDUSTRIAL_FORMAL_METHODS`  
**Finding:** AWS engineers report using formal specification and model checking since 2011 to solve difficult design problems in critical distributed systems, showing practical value beyond purely academic/safety-certification settings.  
**Limitation:** Industrial experience in selected critical designs; formal models require expertise and validate scoped modeled properties/assumptions, not the complete real system or business requirement.

## Code review and technical debt evidence

### REVIEW01 — Sadowski et al. — Modern Code Review: A Case Study at Google
**URL:** https://research.google/pubs/modern-code-review-a-case-study-at-google/  
**Evidence:** `E3/E5 — LARGE_SCALE_INDUSTRIAL_EMPIRICAL_STUDY`  
**Finding:** Analysis including review logs for nine million reviewed changes plus interviews/survey data documents modern review as a mature practice used for code improvement, defect detection, consistency and knowledge sharing.  
**Limitation:** Google’s tooling, culture and scale are not universal; review quality depends on change size, reviewer expertise, incentives and automation.

### REVIEW02 — Bacchelli & Bird — Expectations, Outcomes, and Challenges of Modern Code Review
**URL:** https://www.microsoft.com/en-us/research/publication/expectations-outcomes-and-challenges-of-modern-code-review/  
**Evidence:** `E3/E5 — INDUSTRIAL_EMPIRICAL_STUDY`  
**Finding:** Microsoft field research found that while defect finding is an important motivation, modern review also provides knowledge transfer, team awareness and alternative solutions; understanding the change is a central reviewer need.  
**Limitation:** Observational/qualitative industrial evidence; it does not show that every manual review produces these benefits or that review should replace automated checks.

### TECH01 — Lenarduzzi et al. — Systematic literature review on Technical Debt prioritization
**URL:** https://doi.org/10.1016/j.jss.2020.110827  
**Evidence:** `E2 — SYSTEMATIC_LITERATURE_REVIEW`  
**Finding:** Review of 44 primary studies found many technical-debt prioritization approaches and factors but insufficient validated evidence or consensus to establish one universal prioritization method.  
**Limitation:** Literature through 2020 and uneven empirical maturity; teams still need local economic, risk, architecture and roadmap judgment.

---

# 51. Evidence handling rules

1. **Match evidence to the claim.** Law, standards, experiments, operations and protocol documentation answer different questions; there is no one-dimensional prestige ladder.
2. **A citation supports only the claim it actually studies or normatively defines.** Do not extend a web-security control into a universal architecture law or an observational association into causality.
3. **Binding law outranks convenience only where it applies.** Legal/contractual obligations are mandatory in scope, but their existence is not empirical proof of technical optimality.
4. **Formal standards are baselines, definitions or normative processes—not automatic maxima.** Add stronger controls when consequence demands them; avoid ceremonial overapplication at low risk.
5. **Version status is evidence.** Distinguish final, draft, withdrawn and superseded material. At this cutoff SSDF 1.1 is final while 1.2 is draft; Privacy Framework 1.1 is draft; SLSA 1.2 is approved [SEC05][PRIV01][SUP01].
6. **Meta-analyses/systematic reviews are strong for average empirical claims, but heterogeneity and study quality remain material.**
7. **Single empirical studies remain scoped to population, task, tool/version and measurement.** Replication and mechanism matter.
8. **Operational evidence is valuable but contextual.** Google/AWS/Microsoft/IBM/GitHub practices show mechanisms that worked under particular systems, not mandatory implementations everywhere.
9. **Protocol/platform documentation is authoritative about supported semantics.** It does not prove that selecting that protocol/platform is the best architecture choice.
10. **Security awareness lists are not verification standards.** OWASP Top 10 identifies important risk categories; assurance requires threat-model-appropriate controls and evidence.
11. **Metrics are proxies.** Coverage, deploy frequency, vulnerability counts, benchmark scores and AI acceptance rates become dangerous when optimized without the outcome they represent.
12. **AI benchmark results are timestamped and task-bound.** Rapid tool evolution, task substitution and selection effects can invalidate naive longitudinal comparisons [AI10][AI14].
13. **Self-reported productivity is not interchangeable with measured delivered value.** Use it as one signal, not the sole effect estimate [AI10].
14. **Association is not causation.** Repository mining/surveys should retain confounders and uncertainty rather than becoming deterministic rules [PL01][PL02].
15. **Old evidence can remain strong for durable mechanisms.** Lamport's causal-order result and Parnas's information-hiding argument are not obsolete simply because they are old [DIST01][MOD01].
16. **Current platform/security/regulatory facts require current verification.** Re-check versions/effective dates before applying the playbook to compliance or procurement.
17. **Absence of evidence is not evidence of no effect.** Downgrade confidence rather than converting uncertainty into prohibition.
18. **Conflicting evidence becomes a boundary condition.** Preserve when each side is reasonable instead of selecting a fashionable winner.
19. **Criticality changes the burden of proof.** Higher consequence demands stronger, more independent and representative assurance.
20. **Evidence should be sufficiently independent of the producer.** A generator grading itself is weaker assurance than diverse deterministic/runtime/human evidence.
21. **Local evidence matters.** Measure the real system/workflow once deployed; do not continue a pattern solely because a famous organization uses it.
22. **The final engineering question is demonstrated behavior under real requirements and risk.** Standards/research inform that demonstration; they do not replace it.

# 52. V2 validation note — research cutoff 27 September 2026

V2 was re-audited against the current software lifecycle/quality standards, security/privacy framework status, reliability/SRE guidance, supply-chain standards, accessibility standards, 2026 agentic controls and the newest relevant 2026 empirical work located during this pass.

## 52.1 Deliberate falsification targets

The V2 pass specifically attempted to falsify or bound V1's strongest claims around:

- evidence hierarchy itself;
- “universal” quality attributes;
- timeouts/retries as resilience;
- queueing and overload behavior;
- distributed ordering/time assumptions;
- code coverage/test pyramid;
- property-based testing and formal methods;
- SBOM/provenance as supply-chain assurance;
- privacy/security framework version status;
- AI developer productivity;
- AI code security;
- AI code maintainability/ownership;
- coding-agent benchmark interpretation;
- agent runtime control.

## 52.2 Material V2 changes

V2:

- replaces a one-dimensional source-authority interpretation with **claim-fit evidence lanes**;
- adds **bounded concurrency, queues, load shedding and retry budgets** to root failure engineering;
- makes **distributed causal/ordering semantics** explicit;
- adds current empirical treatment of **property-based testing** and industrial **formal methods**;
- updates **SLSA v1.2**, **WCAG 2.2 / ISO/IEC 40500:2025**, NIST **SP 1326 (2026)** and draft/final status for **SSDF 1.2** and **Privacy Framework 1.1**;
- rewrites AI engineering around **outcomes, selection bias, code ownership, maintainability and benchmark-to-production gaps**;
- strengthens runtime controls for high-capability agents using the September 2026 OWASP Agent Control Standard while explicitly recording its newness/limited empirical maturity;
- keeps the architecture technology-neutral and avoids promoting any one cloud, language, framework, architecture style, test ritual or AI tool.

## 52.3 Adversarial perspective check

The final doctrine was checked from seven perspectives:

1. **Software architect:** avoids named-style dogma; trade-offs, state, compatibility and evolution are explicit.
2. **Security engineer:** secure lifecycle, trust boundaries, least privilege, supply chain and version status are first-class.
3. **SRE/operations engineer:** overload, retries, capacity, observability, release safety, recovery and incidents are first-class.
4. **Data/distributed-systems engineer:** state ownership, causal/ordering assumptions, idempotency, consistency and migrations are explicit.
5. **AI/agent engineer:** probabilistic output, tool authority, memory, runtime policy, outcome measurement and independent evidence are explicit.
6. **Embedded/high-assurance engineer:** criticality scales rigor and safety/formal assurance can escalate without imposing aerospace ceremony on ordinary SaaS.
7. **Maintainer:** change size, comprehension, documentation, dependencies, debt, deprecation and retirement remain protected.

## 52.4 SWEBOK scope-completeness cross-check

SWEBOK v4.0a is used here as a **coverage map**, not as a claim that this playbook replaces the body of knowledge or that every SWEBOK topic belongs at equal depth in a universal master standard [BODY01]. The cross-check below records where each of its 18 knowledge areas is represented and where deeper implementation detail is intentionally delegated to specialist playbooks.

| SWEBOK v4.0a knowledge area | V2 coverage | Master-playbook treatment |
|---|---|---|
| Software Requirements | §§4, 6, 8, 36 | First-class: intent, constraints, acceptance, non-functional requirements and traceability |
| Software Architecture | §§11–12, 36–38 | First-class: boundaries, state, contracts, trade-offs and architecture decisions |
| Software Design | §§9–13, 36–38 | First-class principles; pattern/catalog depth belongs in specialist playbooks |
| Software Construction | §§10, 23, 25–27 | First-class construction/change discipline; language/runtime mechanics delegated to profiles |
| Software Testing | §24 | First-class risk-based verification/validation strategy |
| Software Engineering Operations | §§16–18, 29–30 | First-class reliability, observability, production readiness, recovery and incidents |
| Software Maintenance | §§19, 28, 31 | First-class evolution, migrations, debt, deprecation and retirement |
| Software Configuration Management | §§23, 26–27 | First-class version/configuration/change/release integrity |
| Software Engineering Management | §§5–6, 35–42 | Risk, evidence, metrics and review gates included; staffing/program-management detail is intentionally out of scope |
| Software Engineering Process | §§6, 25–31, 51 | Lifecycle responsibilities and evidence-driven process adaptation are first-class |
| Software Engineering Models and Methods | §§9, 24, 36–38 | Models/methods are selected by problem and criticality; no named method is universalized |
| Software Quality | §§4, 7, 24, 41 | Root quality model, golden standards, assurance and quality review are first-class |
| Software Security | §§14, 22, 40 | First-class secure lifecycle, trust boundaries, supply chain and security review |
| Software Engineering Professional Practice | §§3.4, 25, 51 | Responsibility, competence, evidence handling and communication are included at universal level |
| Software Engineering Economics | §§3.4, 18, 35–37 | Cost/resource trade-offs and lifecycle economics are included; finance/program economics stay specialist |
| Computing Foundations | §§9–13, 17–18 | Relevant universal foundations are embedded; language/runtime/OS depth is delegated |
| Mathematical Foundations | §§9.4, 24.10 | Ordering/causality and higher-assurance formal methods are included where material |
| Engineering Foundations | §§2, 5, 30, 35, 51 | Evidence, measurement, assurance, incident learning and disciplined trade-offs are first-class |

**Coverage verdict:** no SWEBOK knowledge area is silently absent. Areas whose detailed practice depends heavily on organization, language/runtime, hardware or domain are intentionally acknowledged at `00` level and delegated rather than superficially expanded.

## 52.5 Mechanical audit

The delivered file was mechanically checked after the V2 synthesis and final scope pass:

```text
72 evidence IDs used
72 evidence IDs defined
0 missing definitions
0 duplicate definitions
0 dead evidence IDs
84 Markdown code-fence markers; balanced = yes
0 unresolved placeholder markers
```

The V2 standard deliberately gives stronger status to higher-order engineering invariants than to named methods or technologies:

```text
INTENT / REQUIREMENTS
→ CORRECTNESS + INTEGRITY
→ EXPLICIT STATE / ORDER / AUTHORITY
→ SECURITY + PRIVACY
→ BOUNDED WORK + FAILURE CONTAINMENT
→ OBSERVABILITY / OPERABILITY
→ RISK-PROPORTIONAL VERIFICATION
→ SMALL + CONTROLLED CHANGE
→ MAINTAINABILITY / EVOLUTION
→ MEASURED PERFORMANCE + ECONOMICS
→ SAFE RETIREMENT
```

No source reviewed justifies a universal “best” architecture style, language, test methodology, cloud, database family, AI model or coding-agent workflow.

V2 should therefore be used as an **evidence-weighted engineering constitution and decision system**. Specialist playbooks inherit these principles, add domain-specific implementation depth and may strengthen assurance controls; they should not silently weaken the master standard.
