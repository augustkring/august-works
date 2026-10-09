# 03 — Engineering Workflow, SDLC & Configuration Management

> **Evidence-based evergreen standard for turning engineering intent into controlled, reviewable, releasable, operable and traceable software change — for human, AI-assisted and agentic engineering workflows.**

```yaml
document_id: PB-03
title: Engineering Workflow, SDLC & Configuration Management
version: 2.0-RC1
status: REVIEWED
artifact_type: specialist_engineering_playbook
primary_archetype:
  - operating
  - execution
  - capability
created: 2026-09-27
last_updated: 2026-09-27
last_reviewed: 2026-09-27
evidence_cutoff: 2026-09-27
canonical_language: English
inherits:
  - Master Playbook Standard v2.0-RC1
  - Universal Software & AI Engineering Master Playbook v2.0
rigor_level: R3_CONTROLLED_default
critical_overlay: R4_CRITICAL_when_required
volatility: moderate_with_fast_AI_and_platform_edges
research_design:
  - targeted_scoping_review
  - current_standard_status_verification
  - claim_fit_evidence_appraisal
  - adversarial_falsification_audit
  - scenario_dry_runs
review_triggers:
  - software_lifecycle_standard_change
  - configuration_management_standard_change
  - secure_SDLC_standard_change
  - supply_chain_standard_change
  - major_AI_engineering_evidence_change
  - material_incident_or_audit_finding
  - persistent_delivery_or_change_failure_regression
  - regulatory_or_contractual_change
automation_scope:
  - human_engineering
  - AI_assisted_engineering
  - bounded_agentic_engineering
```

**Release-status note.** This V2 is a research-audited Golden Master candidate. It has passed the documented V1 falsification audit and scenario dry-runs in this file. It is intentionally marked `REVIEWED`, not `VALIDATED`, because field validation by independent teams in representative real delivery environments has not yet been performed.

---

# Executive standard

Engineering workflow is not a ticket pipeline and configuration management is not merely Git.

The engineering system must preserve a trustworthy chain from intended change to observed production behavior:

```text
INTENT / SPECIFICATION
→ CHANGE CLASSIFICATION
→ IMPLEMENTATION
→ VERIFICATION
→ REVIEW
→ INTEGRATION
→ IDENTIFIED BUILD / ARTIFACT
→ RELEASE DECISION
→ DEPLOYMENT / EXPOSURE
→ PRODUCTION VERIFICATION
→ OPERATION
→ LEARNING / FOLLOW-UP
```

The chain is iterative, concurrent and recursive where appropriate. It is **not a mandated waterfall**. ISO/IEC/IEEE 12207:2026 explicitly supports iterative and concurrent application of lifecycle processes and does not prescribe one lifecycle model or development methodology [LIFE01].

The configuration-management spine running through that chain is:

```text
IDENTIFY
→ VERSION
→ BASELINE
→ CONTROL CHANGE
→ RECORD STATUS
→ BUILD / PACKAGE
→ RELEASE
→ VERIFY CONFIGURATION
→ TRACE
→ AUDIT
```

The operational objective is:

> **Make every material software change small enough to reason about, controlled enough to trust, identified enough to reproduce, verified enough for its risk, observable enough to detect harm, and traceable enough to reconstruct what happened.**

The standard protects the following invariants:

1. A material change MUST have a knowable intent and acceptance basis.
2. The required assurance MUST increase with consequence, exposure, irreversibility, uncertainty, blast radius and autonomy.
3. The authoritative source revision and configuration state MUST be identifiable.
4. A released/deployed artifact MUST be attributable to controlled source/build inputs.
5. Configuration that can materially change behavior MUST be treated as engineering state.
6. Automated checks SHOULD carry deterministic, repeatable verification; human attention SHOULD focus on semantics, risk and judgment.
7. Integration SHOULD happen frequently enough to prevent uncontrolled divergence.
8. A change MUST NOT be considered safe merely because CI is green.
9. Release and deployment MUST preserve enough identity to connect production behavior to code, configuration, schema, policy and dependencies.
10. Recovery strategy MUST reflect state compatibility; rollback is not automatically safer than roll-forward.
11. Production verification MUST close the loop after release for material changes.
12. AI-generated engineering output MUST be treated as candidate work until independently verified.
13. AI or agent output MUST NOT be its own sole authority, reviewer or policy enforcement mechanism for consequential changes.
14. Traceability MUST be proportionate: enough to reconstruct consequential change without creating documentation theatre.
15. The workflow itself MUST be measured and improved; process ceremony is not a quality outcome.

These rules inherit the Master Playbook Standard's risk-proportionate, evidence-aware, traceable and human+AI-compatible architecture [MPS00], and the Universal Software & AI Engineering Master Playbook's lifecycle, build, configuration, review, release, recovery and AI assurance principles [ENG00].

---

# PART I — V1 CANDIDATE

## 1. V1 research question

**Primary question**

> What engineering workflow and configuration-management controls best preserve correctness, integration safety, release integrity, operational recoverability and traceability from specification through operation without forcing one development methodology on every software context?

**Subquestions**

1. Which lifecycle responsibilities are durable across agile, continuous-delivery, regulated and high-assurance contexts?
2. What belongs inside software configuration management in modern software systems?
3. Which configuration items need versioning, baselines, change control and status accounting?
4. How should branch, review and integration practices be selected?
5. Which release controls are universal versus contextual?
6. What level of traceability is justified by different risk levels?
7. How should emergency changes differ without becoming an uncontrolled bypass?
8. What additional controls are needed when AI assistants or coding agents generate, review, merge or deploy change?
9. Which popular practices are useful defaults but not universal standards?

## 2. V1 initial evidence model

V1 used five evidence lanes:

- **Formal lifecycle/configuration standards** — lifecycle responsibilities, V&V, quality and configuration-management baselines.
- **Government/security standards** — secure SDLC, controlled configuration, supply-chain integrity.
- **Consensus bodies of knowledge** — discipline coverage and terminology.
- **Mature operational evidence** — continuous integration, release engineering, change approval and deployment.
- **Tool/platform guidance** — concrete implementation examples only.

No vendor implementation was treated as a universal requirement.

## 3. V1 candidate doctrine

V1 proposed the following initial workflow:

```text
SPEC
→ IMPLEMENT
→ LOCAL VERIFY
→ REVIEW
→ MERGE
→ CI
→ BUILD
→ RELEASE APPROVAL
→ DEPLOY
→ VERIFY
→ OPERATE
```

### V1 candidate rules

1. Every production change SHOULD begin from a written change intent.
2. Every material requirement SHOULD have observable acceptance criteria.
3. Every change SHOULD receive a risk classification before merge.
4. Source code SHOULD be managed in version control.
5. Production-affecting configuration SHOULD be version controlled where feasible.
6. Teams SHOULD integrate small changes frequently.
7. Trunk-based development SHOULD be the default branch strategy for ordinary software teams.
8. Every production code change SHOULD pass automated build and risk-relevant tests before integration.
9. Every material change SHOULD receive peer review.
10. High-risk changes SHOULD receive independent specialist review where relevant.
11. A green CI pipeline SHOULD be necessary but not sufficient for release.
12. Build outputs SHOULD be uniquely identified.
13. Teams SHOULD build once and promote the same immutable artifact across environments.
14. Every release SHOULD have a release record connecting source revision, build and deployment.
15. Semantic Versioning SHOULD be used for released software unless a stronger domain scheme applies.
16. Runtime configuration SHOULD have schema validation, ownership and change history.
17. Secrets MUST NOT be committed to ordinary source control.
18. Feature flags SHOULD have owners and expiry/removal rules.
19. Production configuration drift SHOULD be detectable.
20. GitOps SHOULD be preferred for declarative infrastructure and platform configuration.
21. Database/schema changes SHOULD be co-designed with rollout and recovery.
22. Rollback SHOULD be the preferred recovery mechanism where feasible.
23. Emergency changes MAY use an expedited path but MUST retain source, reviewer, build and deployment traceability.
24. AI-generated code SHOULD pass the same engineering gates as human-authored code.
25. AI-generated material changes SHOULD receive human review.
26. An AI reviewer SHOULD NOT count as independent assurance for a change produced by the same or a closely related model.
27. Production deployment SHOULD emit a machine-queryable deployment/version marker.
28. Operational incidents SHOULD link back to the release/change that introduced or exposed the condition where known.
29. Workflow metrics SHOULD combine throughput and instability.
30. Configuration-management controls SHOULD scale with criticality.

V1 was intentionally strong enough to expose where apparently sensible rules became overgeneralized.

---

# PART II — ADVERSARIAL / FALSIFICATION AUDIT OF V1

## 4. Audit method

V1 was challenged against:

- current lifecycle and requirements standards;
- current configuration-management guidance;
- current V&V and software quality-assurance standards;
- current NIST secure-development and configuration controls;
- current supply-chain provenance guidance;
- DORA continuous-integration, trunk-based-development and change-approval guidance;
- Google SRE release-engineering practice;
- contemporary human+AI engineering guidance;
- ordinary SaaS, high-risk migration, emergency-change and agentic-change scenarios.

The audit asked:

1. Is the rule genuinely universal?
2. Does the source support the exact claim?
3. Is the source current?
4. Does the rule survive low-risk, high-assurance, embedded, packaged, cloud and AI-assisted contexts?
5. Could the rule create process theatre, bottlenecks or false assurance?
6. Does a supposedly safe control fail under stateful or irreversible change?
7. Could an AI agent satisfy the wording while defeating the intent?

## 5. V1 audit findings

| ID | V1 assumption | Finding | Severity | V2 correction |
|---|---|---|---|---|
| A01 | The lifecycle can be represented as one fixed linear workflow | Too rigid. Current ISO lifecycle guidance explicitly permits iterative, concurrent and recursive process application. | MAJOR | Treat stages as responsibilities/states with loops, not a waterfall. |
| A02 | Trunk-based development should be the universal default | Strong DORA evidence supports frequent integration and short-lived divergence, but exact branch topology remains contextual, especially for regulated release lines, packaged products and high-assurance maintenance. | MAJOR | Protect the integration invariant; classify trunk-based development as a strong contextual default, not universal law. |
| A03 | Every production change needs the same review mechanism | Overbroad. Risk, automation quality, domain regulation and type of change matter. | MAJOR | Require review/verification appropriate to risk; allow technically enforced equivalent controls for routine low-risk changes. |
| A04 | Central manual approval increases safety | Falsified as a universal claim. DORA explicitly warns that centralized CAB approval for all changes introduces delay and can reduce useful attention to true high-risk work [DORA04]. | MAJOR | Put routine review close to the work; escalate risk/sign-off only when consequence or governance requires it. |
| A05 | Build-once/promote-same-artifact is always possible | Strong default but not universal. Some platforms legitimately produce target-specific artifacts. | MINOR | Prefer immutable promotion; otherwise require separately identified, reproducible target builds from the same controlled source/baseline. |
| A06 | Semantic Versioning should be the general version scheme | Overbroad. SemVer is defined around a declared public API [VER01]. | MAJOR | Use SemVer only when its compatibility semantics fit. Separate source, build, release, API/schema and deployment identities. |
| A07 | GitOps should generally be preferred | Too technology-specific. OpenGitOps requires declarative desired state, pull and continuous reconciliation; many valid environments do not fit this model [GITOPS01]. | MAJOR | Treat GitOps as a contextual configuration-delivery architecture. Preserve versioned desired-state and drift-control principles independently. |
| A08 | Rollback is the preferred recovery mechanism | Unsafe for irreversible schema/data/external side effects. | BLOCKER | Select rollback vs roll-forward from state compatibility and fastest safe restoration. |
| A09 | CI success establishes integration safety | False assurance. CI only proves the checks actually run against the identified revision/environment. | BLOCKER | Treat CI as evidence, not a release certificate. Add readiness, config, migration, security and operational gates. |
| A10 | Source commit is enough to identify a production version | Incomplete for modern systems with runtime configuration, feature flags, infrastructure, model/prompt versions and schemas. | BLOCKER | Define a deployable configuration baseline that can bind artifact + config + policy + schema + relevant model/tool versions. |
| A11 | Configuration means environment variables plus IaC | Too narrow. Configuration can include dependencies, build rules, policy, flags, schemas, model settings, prompt/instruction files and release manifests. | MAJOR | Introduce a configuration-item taxonomy. |
| A12 | All controlled configuration belongs in the same repository | Overbroad and unsafe for secrets or externally authoritative state. | MAJOR | Require a canonical controlled source and traceability, not one physical repository. Secret values remain in approved secret systems. |
| A13 | Full traceability should exist for every change | Creates low-value bureaucracy at low risk. | MAJOR | Risk-proportionate traceability tiers; R3/R4 explicit trace spine, lower levels can rely on linked VCS/CI/deployment metadata. |
| A14 | PR approval is synonymous with peer review | Tool-specific. Pairing, synchronous review, signed review records or regulated independent verification may satisfy the objective differently. | MINOR | Specify review outcome/evidence, not a particular UI artifact. |
| A15 | A human must review all AI-generated production changes | Too absolute for bounded, low-risk, policy-enforced automation; too weak for critical changes if the human is a rubber stamp. | MAJOR | Scale human review with consequence; require independent evidence and externally enforced policy. |
| A16 | AI provenance means storing complete prompts/reasoning | Can leak sensitive data and is unnecessary; hidden reasoning is not an assurance artifact. | BLOCKER | Retain minimal operational provenance needed to reconstruct inputs, task/spec, tool/model identity where relevant, changes, tests, approvals and effects—without requiring hidden reasoning. |
| A17 | Emergency change is a separate shortcut workflow | Dangerous if it becomes a permanent bypass. | BLOCKER | Same safety invariants with an expedited path, narrower scope, stronger observability and mandatory post-change reconciliation/review. |
| A18 | A release record is mainly release notes | Too human-text-centric. Operational reconstruction needs machine-queryable IDs/digests and deployment markers. | MAJOR | Define a release manifest and deployment record. |
| A19 | Configuration drift should always be auto-reconciled | Auto-reconciliation can repeat harm or overwrite intentional emergency state. | MAJOR | Detect drift universally where material; automate reconciliation only when safe and authorized. |
| A20 | More gates increase assurance | False. Gates without decision value create queueing and rubber-stamping. | MAJOR | Every gate must block a defined failure mode or satisfy a scoped obligation; otherwise automate, merge or remove it. |
| A21 | Branch protection is the standard | Platform-specific implementation. | MINOR | Require protected integration semantics; GitHub branch protection is one example. |
| A22 | Change freezes are inherently wrong | Overbroad. DORA warns against freezes as a substitute for integration capability, but temporary freezes can be justified by business or high-assurance constraints. | MINOR | Treat freezes as contextual risk controls with explicit rationale and exit. |
| A23 | Rebuilding an old revision proves reproducibility | Not unless build environment/dependencies/instructions are controlled. | MAJOR | Use reproducibility/attestation appropriate to risk [BUILD01][SUP01]. |
| A24 | Version numbers alone establish identity | False. Mutable tags or reused version labels destroy provenance. | BLOCKER | Bind releases/deployments to immutable digests/revisions and treat labels as aliases. |
| A25 | The workflow ends at deployment | Incomplete. Release defects often appear only in production. | BLOCKER | Add production verification, operation, incident linkage and learning closure. |

## 6. V1 audit verdict

V1 contained the right **shape** but over-prescribed several mechanisms.

The strongest surviving principles were:

- explicit intent and acceptance;
- risk-proportional assurance;
- controlled configuration identity;
- frequent integration;
- automated deterministic verification;
- review close to the work;
- build/release provenance;
- safe state-aware recovery;
- production verification;
- bidirectional traceability;
- AI output treated as untrusted candidate work;
- workflow learning from operational evidence.

The following were downgraded from “best practice” to contextual mechanisms:

```text
trunk-based development
pull requests
manual approvals / CABs
Semantic Versioning
GitOps
build-once promotion in every environment
rollback-first recovery
human review of every single AI change
change freezes
specific branch-protection products
```

That distinction is the basis of V2.

---

# PART III — V2 GOLDEN MASTER

# 7. Purpose

This playbook defines a technology-neutral engineering operating system for moving software change from intent to operation while preserving:

- correctness;
- reviewability;
- integration integrity;
- configuration integrity;
- release identity;
- security;
- recoverability;
- traceability;
- human/team understanding;
- operational learning.

It specializes the lifecycle and change-safety principles of the Universal Software & AI Engineering Master Playbook [ENG00] and follows the Master Playbook Standard's evidence, rigor, traceability, audit and human+AI rules [MPS00].

---

# 8. Scope and non-scope

## 8.1 In scope

This standard applies to engineering workflows for:

- application and service source code;
- libraries/packages;
- APIs and schemas;
- database migrations and backfills;
- infrastructure and infrastructure-as-code;
- deployment configuration;
- policy-as-code;
- build definitions;
- CI/CD workflows;
- feature flags and runtime configuration;
- AI model/application configuration;
- prompts/instruction files that materially influence system behavior;
- agents and tool configurations;
- operational runbooks that can change production state;
- release manifests and deployment metadata.

## 8.2 Out of scope

Deep implementation detail is delegated to specialist playbooks for:

- requirements/domain engineering;
- architecture/system design;
- construction/code quality;
- testing/V&V;
- security;
- privacy;
- reliability/SRE;
- DevOps/platform/supply chain;
- data/database/storage;
- APIs/distributed systems;
- AI/ML/LLM;
- agentic AI;
- language/runtime profiles.

This playbook coordinates those disciplines through one controlled change lifecycle; it does not replace them.

## 8.3 Regulatory and domain overlays

Safety, medical, automotive, aviation, finance, public-sector, critical-infrastructure, cryptographic, smart-contract and other high-assurance contexts MAY impose stronger:

- independence;
- formal traceability;
- segregation of duties;
- documented approvals;
- qualified tools;
- signed baselines;
- evidence retention;
- release authorization;
- audit requirements.

A scoped external requirement overrides a weaker house default.

---

# 9. Normative language and claim status

`MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` follow the Master Playbook Standard's house use of BCP 14-style normative language [MPS00].

Recommendations use these claim classes where useful:

- `REQ` — scoped external requirement;
- `EST` — strongly established practice/mechanism;
- `DEF` — recommended default;
- `CTX` — context-dependent mechanism;
- `EMG` — emerging practice;
- `HOUSE` — deliberate standard defined here.

Normative strength and evidence strength are separate.

---

# 10. Evidence and source-status doctrine

## 10.1 Claim-fit first

Use sources according to what they can establish:

| Question | Strongest evidence family |
|---|---|
| What lifecycle responsibilities exist? | current formal lifecycle standards |
| What configuration-management functions belong in the discipline? | current CM guidance + consensus body of knowledge |
| What assurance level is appropriate? | V&V/quality standards + risk context |
| Which secure-development controls apply? | security standards/frameworks + threat model |
| What branch/integration pattern performs well in software delivery? | empirical/operational research |
| What does a platform feature guarantee? | current official platform documentation |
| What AI workflow is safe enough? | secure-development controls + empirical evidence + local evaluation |

## 10.2 Important current-status corrections at the 2026-09-27 cutoff

1. **ISO/IEC/IEEE 12207:2026** is the current published software lifecycle standard [LIFE01].
2. **ISO/IEC/IEEE 29148:2018** remains current but is expected to be replaced by a new DIS edition; use 2018 as the normative published baseline and track the draft [REQ01].
3. **ISO 10007:2017** remains current configuration-management guidance, confirmed in 2023, but is marked for revision [CM01].
4. **IEEE 828-2012** is `Inactive-Reserved` since 2023 and MUST NOT be represented as the current active configuration-management standard [CMHIST01].
5. **IEEE 1012-2024** is the current active V&V standard used here for risk-proportional assurance [VV01].
6. **IEEE 730-2026** is the current active software quality-assurance process standard [QA01].
7. **NIST SSDF 1.1** remains final; **SSDF 1.2 / SP 800-218 Rev.1** remains an Initial Public Draft at this cutoff [SEC01][SEC02].
8. **SLSA v1.2** is approved/current [SUP01].
9. **SWEBOK v4.0a** is the current IEEE Computer Society body of knowledge, updated September 2025 [BODY01].

---

# 11. Foundational principles

## P01 — Lifecycle responsibilities are not a waterfall

`EST / HIGH`

The workflow MUST preserve required lifecycle responsibilities, but teams MAY execute them iteratively, concurrently and recursively.

Bad:

```text
requirements complete
→ design complete
→ implementation complete
→ testing complete
```

Better:

```text
change intent
↔ design
↔ implementation
↔ verification
↔ review
→ controlled integration
→ release
→ production evidence
→ learning
```

ISO/IEC/IEEE 12207:2026 explicitly permits iterative/concurrent/recursive process use and does not mandate a lifecycle method [LIFE01].

## P02 — Change starts from intent, not code

`EST / HIGH`

A material change MUST have enough specification to answer:

- what outcome is intended;
- which behavior changes;
- which behavior MUST remain invariant;
- which constraints apply;
- what failure is unacceptable;
- how completion will be verified.

The artifact can be a requirement, issue, change brief, ADR, testable spec or equivalent. The standard does not mandate one document format.

## P03 — Assurance scales with consequence

`EST / HIGH`

Review, testing, approval, traceability and release control MUST increase with:

- system criticality;
- security/privacy impact;
- financial impact;
- data irreversibility;
- blast radius;
- regulatory exposure;
- novelty/uncertainty;
- operational dependency;
- autonomy;
- difficulty of detection/recovery.

IEEE 1012 scales V&V by integrity level [VV01]; the parent playbooks apply the same risk-proportional doctrine [MPS00][ENG00].

## P04 — Configuration is anything that can materially change behavior or the ability to reproduce it

`HOUSE / HIGH`

Do not reduce configuration management to source code.

Potential configuration items include:

- code;
- build definitions;
- dependency resolution;
- schemas/migrations;
- infrastructure;
- deployment manifests;
- policy;
- runtime settings;
- feature flags;
- model/prompt/tool versions;
- generated artifacts;
- test/eval assets;
- runbooks;
- release manifests.

## P05 — One material state, one authoritative source

`EST / HIGH`

Each controlled configuration item MUST have an identifiable canonical authority.

Copies, mirrors and caches MAY exist. Authority MUST NOT be ambiguous.

## P06 — Integrate before divergence becomes expensive

`DEF / MODERATE-HIGH`

Teams SHOULD integrate changes into an authoritative shared baseline frequently enough that:

- merge conflict remains bounded;
- integrated behavior is continuously testable;
- hidden divergence does not accumulate;
- production candidates are derived from current integrated state.

DORA operational evidence strongly supports small batches and frequent integration [DORA02][DORA03]. Exact branch strategy remains contextual.

## P07 — CI is evidence, not authorization

`EST / HIGH`

A green pipeline proves only that the configured checks passed for the identified inputs.

It does not establish:

- correct requirements;
- sufficient test coverage;
- production readiness;
- safe migration;
- safe configuration;
- safe rollback;
- regulatory approval;
- absence of unknown defects.

## P08 — Build identity is part of correctness

`EST / HIGH`

Every material release MUST be traceable to the source/configuration/build inputs that produced it.

Where consequence justifies it, strengthen with:

- reproducible builds;
- provenance attestations;
- signed/verified artifacts;
- immutable digests;
- protected builders;
- dependency provenance.

SLSA v1.2 provides current supply-chain provenance/control structures [SUP01]. Reproducible-build definitions require controlled source, environment and instructions [BUILD01].

## P09 — Labels are not identity

`HOUSE / HIGH`

Version labels, tags and release names MAY be human-friendly aliases.

For material artifacts, immutable identity SHOULD use one or more of:

- source revision;
- artifact digest;
- signed attestation identity;
- immutable release ID;
- deployment ID.

A mutable `latest`, branch name or reused tag MUST NOT be the sole production identity.

## P10 — Release and deployment are different decisions when exposure can be controlled independently

`DEF / HIGH`

Where architecture supports it:

```text
DEPLOY = make an identified artifact/configuration available
RELEASE = expose behavior to users/workload
```

Feature flags, routing, staged rollout or entitlement MAY separate the two.

Do not force the distinction where the product/platform genuinely couples them.

## P11 — Recovery is state-aware

`EST / HIGH`

Choose rollback, roll-forward, disablement, compensation, restore or another recovery path according to actual state compatibility.

A rollback MUST NOT be declared safe merely because an older binary exists.

## P12 — Review close to the work; escalate risk, not bureaucracy

`DEF / MODERATE-HIGH`

Routine technical changes SHOULD be reviewed/verified by people and automation that understand the change.

Higher organizational approval SHOULD be reserved for decisions that actually require business, risk, security, compliance or segregation-of-duties authority.

DORA warns against centralized approval of every change and recommends peer review, automated testing and risk-sensitive scrutiny [DORA04].

## P13 — Traceability should be machine-assisted by default

`HOUSE / HIGH`

Do not make engineers manually re-enter the same identifiers across tickets, PRs, CI, releases and deployments.

Tooling SHOULD automatically propagate stable IDs and links.

Humans SHOULD add rationale and risk decisions only where judgment is required.

## P14 — Production closes the verification loop

`EST / HIGH`

For material change, pre-production evidence is incomplete without post-deployment verification.

The workflow SHOULD define:

- expected production signals;
- observation window;
- stop/rollback/roll-forward criteria;
- owner;
- closure condition.

## P15 — AI changes authorship, not assurance obligations

`EST / HIGH`

AI-generated code, tests, configuration, migrations, infrastructure and release actions are candidate outputs until verified [ENG00][AI01].

The required evidence follows the **risk of the change**, not whether the author was human or AI.

## P16 — Generator self-review is weak evidence

`HOUSE / HIGH`

The same AI process that generated a material change MUST NOT be treated as its sole independent assurance source.

Independent evidence can include:

- compiler/type checker;
- deterministic tests;
- security analysis;
- schema/invariant verification;
- runtime evidence;
- separate authorized reviewer;
- specialist review;
- controlled canary evidence.

A second model MAY add diversity but is not automatically independent.

## P17 — Emergency means expedited, not uncontrolled

`EST / HIGH`

Emergency workflows MAY shorten or defer noncritical ceremony, but MUST retain the safety invariants necessary to:

- identify the change;
- know who/what authorized it;
- bound scope;
- build/deploy an attributable artifact/configuration;
- observe impact;
- restore/compensate if needed;
- reconcile documentation/baselines afterward.

## P18 — Workflow quality is an engineering system property

`EST / HIGH`

Measure the delivery system as a system.

DORA's current model combines throughput and instability rather than treating speed alone as success [DORA01].

---

# 12. Criticality and change-assurance model

This playbook inherits the engineering master's C0–C4 criticality model [ENG00].

| Level | Typical consequence | Workflow posture |
|---|---|---|
| **C0 — Experimental** | Disposable/non-production; no material users/data | Fast iteration; explicit non-production boundary; minimal traceability |
| **C1 — Ordinary** | Recoverable inconvenience | Normal automated verification; ordinary review; standard deployment |
| **C2 — Material** | Revenue, customer data, important operations | Stronger review, migration/recovery evidence, staged rollout, explicit production verification |
| **C3 — High assurance** | Major financial, privacy, security or societal impact | Independent review, strong traceability, separation where needed, release evidence package |
| **C4 — Safety/mission critical** | Serious harm/catastrophic consequence | Domain standard governs; formal configuration baselines, independent assurance and controlled release likely required |

## 12.1 Change-specific modifiers

A change MAY require higher assurance than the surrounding system baseline.

Escalate when the change:

- modifies authorization/identity/tenant boundaries;
- changes cryptography/key handling;
- changes financial ledger/payment logic;
- deletes or irreversibly transforms data;
- changes schema compatibility;
- changes production infrastructure/network boundaries;
- changes build/release permissions;
- adds privileged dependency/tooling;
- changes secrets handling;
- introduces a new external side effect;
- modifies concurrency/order/transaction semantics;
- changes safety controls;
- expands agent autonomy/tool permission;
- changes high-impact AI model/tool behavior;
- has unusually large blast radius;
- is difficult to observe or reverse.

## 12.2 No arithmetic risk theatre

Do not force a pseudo-precise score.

The classification record SHOULD state:

```yaml
system_criticality:
change_risk:
material_risk_drivers:
recoverability:
detectability:
required_assurance:
reviewers_or_approvers:
release_strategy:
residual_risk:
```

---

# 13. Canonical workflow state model

The default lifecycle state model is:

```text
PROPOSED
  ↓
SPECIFIED
  ↓
IMPLEMENTING
  ↓
VERIFIED_FOR_REVIEW
  ↓
REVIEWED
  ↓
INTEGRATED
  ↓
RELEASE_CANDIDATE
  ↓
RELEASED / DEPLOYED
  ↓
PRODUCTION_VERIFIED
  ↓
CLOSED
```

Allowed loops include:

```text
REVIEWED → IMPLEMENTING
INTEGRATED → IMPLEMENTING
RELEASE_CANDIDATE → IMPLEMENTING
DEPLOYED → MITIGATION / ROLLBACK / ROLL_FORWARD
PRODUCTION_VERIFIED → FOLLOW_UP_CHANGE
```

For incident/hotfix work:

```text
INCIDENT
→ EMERGENCY_CHANGE
→ EXPEDITED_VERIFY
→ CONTROLLED_DEPLOY
→ PRODUCTION_VERIFY
→ RECONCILE_BASELINE
→ POST_CHANGE_REVIEW
```

State names are a `HOUSE` taxonomy. Teams MAY rename them while preserving the control meanings.

---

# 14. Gate 0 — Change intake and specification

## 14.1 Minimum change intent

Before material implementation begins, make recoverable:

```yaml
change_id:
objective:
current_behavior:
intended_behavior:
non_goals:
constraints:
critical_invariants:
acceptance_criteria:
risk_drivers:
dependencies:
affected_configuration_items:
migration_or_state_change:
observability_needed:
recovery_hypothesis:
owner:
```

Fields MAY live across linked systems rather than one file.

## 14.2 Specification quality

A specification SHOULD be:

- precise enough to falsify;
- small enough to review;
- explicit about material edge/failure conditions;
- clear about compatibility;
- clear about authorization/security changes;
- clear about data/state changes;
- clear about operational expectations.

ISO/IEC/IEEE 29148:2018 remains the current published requirements-engineering baseline at this cutoff [REQ01].

## 14.3 Specification gate

Pass when:

- [ ] objective is clear;
- [ ] acceptance basis is observable;
- [ ] material invariants are explicit;
- [ ] affected boundaries/state/configuration are known enough to begin;
- [ ] criticality/change risk is classified;
- [ ] required reviewers/assurance are known;
- [ ] irreversible operations are identified;
- [ ] unknowns that could invalidate implementation are visible.

Do not demand a long document when executable tests, schemas or concise acceptance conditions carry the intent better.

---

# 15. Implementation workflow

## 15.1 Controlled working state

Implementation MUST occur against identifiable source/configuration state.

The engineer or agent SHOULD know:

- base revision;
- dependency resolution;
- runtime/toolchain version where relevant;
- target architecture/environment assumptions;
- feature/config assumptions;
- test commands;
- generated-code policy;
- permitted change scope.

## 15.2 Small coherent changes

`DEF / MODERATE-HIGH`

Prefer the smallest **independently understandable and safely integrable** change.

Small does not mean arbitrarily splitting one invariant across fragments that cannot be understood independently.

Benefits include:

- easier review;
- quicker feedback;
- lower merge divergence;
- smaller blast radius;
- easier diagnosis/recovery.

DORA's current guidance also recommends smaller change batches as an improvement mechanism for throughput and stability [DORA01].

## 15.3 Local verification

Before asking others to review, the author SHOULD run the fastest relevant evidence available:

- compiler/type checker;
- formatting/lint;
- focused tests;
- schema validation;
- static analysis;
- security checks;
- migration dry-run;
- configuration validation;
- generated-file check.

Do not require expensive full-system suites locally when centralized CI provides more reliable execution.

## 15.4 Dependency changes

A change that adds or changes a dependency SHOULD record as relevant:

```yaml
dependency:
reason:
version_or_digest:
source:
license:
privileges:
transitive_risk:
update_strategy:
rollback_or_removal:
supply_chain_evidence:
```

Dependency lock/resolution files are configuration items when they affect released behavior.

## 15.5 Generated artifacts

Generated files SHOULD be either:

1. deterministically generated in the build and not treated as hand-maintained truth; or
2. committed/versioned only where review, tooling or distribution requires it.

The canonical source and regeneration method MUST be clear.

---

# 16. Human + AI implementation workflow

## 16.1 AI task contract

Before an AI assistant/agent performs a material engineering task, provide a bounded task contract:

```yaml
task_id:
objective:
authoritative_spec:
allowed_scope:
protected_invariants:
files_or_components_in_scope:
do_not_touch:
approved_dependencies:
commands_allowed:
network_or_external_access:
secrets_policy:
verification_required:
review_required:
deployment_permission:
stop_conditions:
escalation:
```

The exact representation MAY be prompt, repository instruction, task metadata or policy.

## 16.2 AI context discipline

AI context SHOULD distinguish:

- authoritative project instructions;
- trusted source documents;
- untrusted external/retrieved content;
- current repository state;
- assumptions generated by the model.

Untrusted content MUST NOT silently redefine authorization or policy.

## 16.3 Candidate-output rule

Treat as untrusted until verified:

- source;
- tests;
- test oracles;
- SQL/migrations;
- shell commands;
- CI/CD changes;
- infrastructure;
- authorization logic;
- security claims;
- dependency/API claims;
- runbook commands;
- tool calls.

GitHub's current guidance likewise emphasizes tests, static analysis, intent/context review and human oversight for AI-generated code [AI01].

## 16.4 AI provenance

Retain only the provenance useful for assurance, audit or reproduction.

For material AI-assisted change, that MAY include:

```yaml
task_id:
agent_or_tool:
model_family_or_version_if_material:
instruction_policy_version:
authoritative_context_refs:
base_revision:
files_changed:
external_sources_relied_on:
tools_or_commands_invoked:
tests_and_checks_run:
reviewers:
approvals:
resulting_revision:
```

Do **not** require storage of hidden chain-of-thought or raw sensitive prompt contents.

## 16.5 AI autonomy tiers

| Tier | Capability | Default control |
|---|---|---|
| A0 | Explain/read only | no mutation |
| A1 | Edit local/worktree | human controls commit/integration |
| A2 | Create commit/PR/change request | automated checks + review policy |
| A3 | Merge/integrate bounded change | policy-enforced checks, scoped identity, strong audit |
| A4 | Deploy/release bounded change | explicit release policy, production telemetry, revoke/kill path |
| A5 | Privileged/irreversible engineering action | C3/C4-style approval/segregation, strict limits, recovery design |

These tiers are `HOUSE` operational categories.

## 16.6 AI review independence

For C2+ changes, an AI reviewer MAY assist but SHOULD NOT be the only review evidence if:

- the same agent/model generated the change;
- the review depends on unstated project context;
- the change touches authorization, secrets, migrations, infrastructure or high-value state;
- the test oracle was generated by the same process;
- consequence is high.

## 16.7 Do not let AI optimize the gate

Agents MUST NOT be permitted to:

- weaken tests merely to make them pass;
- disable required checks;
- silently broaden permissions;
- modify their own authorization policy;
- bypass protected integration/release controls;
- redefine acceptance criteria after seeing failure without explicit approval.

## 16.8 Evaluate the AI engineering system

Measure the combined human+AI workflow on:

- accepted useful outcomes;
- cycle time;
- review time;
- rework;
- escaped defects;
- incidents;
- security findings;
- test/evidence quality;
- maintainability/change friction;
- responsible-engineer understanding;
- compute/tool cost.

Do not use tokens, generated LOC or agent task count as primary productivity evidence.

NIST's 2026 ARIA manual reinforces multi-method AI evaluation rather than single-score assurance [AI02].

---

# 17. Review standard

## 17.1 Review objective

Review SHOULD answer:

1. Does the change satisfy the intended behavior?
2. What unintended behavior can it introduce?
3. Are material invariants preserved?
4. Are data/state changes safe?
5. Are security/privacy boundaries preserved?
6. Is the verification evidence appropriate?
7. Can it be operated and recovered?
8. Is the complexity justified?
9. Is the change understandable by an accountable maintainer?
10. Are configuration and release implications captured?

## 17.2 Automate mechanical review

Automate when reliable:

- formatting;
- lint;
- type checking;
- generated-file consistency;
- schema checks;
- policy rules;
- known secret scanning;
- dependency/vulnerability checks;
- basic configuration validation.

Human review SHOULD spend attention on semantics, trade-offs, edge cases, architecture, risk and knowledge transfer.

## 17.3 Review independence

Independence MUST scale with risk.

Possible levels:

```text
self-check
→ peer review
→ owner/domain review
→ security/data/platform specialist
→ independent assurance
→ external/domain-required approval
```

C0/C1 work does not automatically require multiple human approvers.

C3/C4 MAY require formal independence or segregation of duties.

## 17.4 Approval evidence

A review record SHOULD identify:

- reviewer or enforcing control;
- revision reviewed;
- material comments/findings;
- disposition;
- approval/waiver;
- unresolved risk.

A pull request is one implementation. It is not the standard itself.

## 17.5 Review anti-rubber-stamp rule

If approval volume is too high for a reviewer to understand risk, the control is failing.

Fix the system by:

- reducing batch size;
- improving automated evidence;
- routing by ownership/risk;
- removing low-value approval;
- increasing specialist capacity;
- redesigning permission boundaries.

---

# 18. Version control and integration strategy

## 18.1 Integration invariant

The authoritative integrated baseline MUST remain identifiable and SHOULD remain close enough to current development that integration risk is bounded.

## 18.2 Strong default for ordinary product teams

`DEF / MODERATE-HIGH`

When architecture/tooling supports it, prefer:

- one authoritative mainline;
- small changes;
- short-lived branches or direct controlled mainline changes;
- integration at least daily for active work;
- automated checks at integration;
- prompt repair/revert of a broken baseline.

DORA characterizes trunk-based development and frequent integration as important CI practices and associates them with stronger delivery/operational outcomes [DORA02][DORA03].

## 18.3 When other branch models are justified

Longer-lived or release branches MAY be justified for:

- supported product versions;
- offline/embedded release trains;
- regulated qualification lines;
- coordinated hardware/software baselines;
- customer-specific maintained variants;
- security embargoes;
- large migration isolation;
- contractual maintenance streams.

The team MUST still define:

- authority;
- merge/cherry-pick direction;
- compatibility;
- divergence limit;
- test responsibility;
- support lifetime;
- closure/deprecation.

## 18.4 Merge queue

A merge queue MAY reduce stale-check and integration race risk in high-concurrency repositories.

GitHub's implementation, for example, tests queued changes against the latest target state [VCS01].

This is an implementation pattern, not a universal requirement.

## 18.5 Broken baseline

If the authoritative integrated baseline fails required checks:

1. make failure visible;
2. assign immediate ownership;
3. fix or revert quickly;
4. prevent additional unrelated risk from accumulating;
5. record systemic causes if recurrence is meaningful.

A perpetually red mainline destroys CI as an assurance signal.

---

# 19. Continuous integration standard

## 19.1 Purpose

CI exists to discover integration defects while the causal change set is still small.

## 19.2 Minimum CI properties

For normal production software, the CI system SHOULD:

- trigger from controlled changes;
- build identifiable outputs;
- run fast deterministic checks;
- make result status visible;
- retain enough logs/evidence for diagnosis;
- fail closed for required checks;
- identify the source revision;
- protect secrets and privileged credentials;
- avoid untrusted code gaining excessive CI authority.

DORA recommends automated builds and tests on each commit/check-in with rapid feedback [DORA02].

## 19.3 Fast lane and deep lane

Do not force all assurance into one blocking pipeline.

Recommended structure:

```text
FAST / BLOCKING
- compile/type
- lint
- focused tests
- critical policy/security checks
- schema/config validation

DEEP / PARALLEL OR PRE-RELEASE
- broad integration
- E2E
- performance
- fuzz
- deep security
- compatibility matrix
- long-running AI evals
- soak/reliability
```

A deep check that discovers material release risk MUST feed a gate before exposure, even if it is not merge-blocking.

## 19.4 Flaky checks

Flaky required checks are defects.

They SHOULD be:

- identified;
- owned;
- repaired;
- quarantined only with visibility and expiry;
- prevented from becoming “rerun until green” culture.

## 19.5 CI security

Treat CI as privileged infrastructure.

At minimum:

- least-privilege tokens;
- protected secrets;
- clear fork/untrusted-input boundaries;
- reviewed privileged workflow changes;
- dependency/action pinning where material;
- logs that do not expose credentials;
- controlled release permissions.

NIST SSDF integrates secure practices into the SDLC [SEC01], and current NIST configuration/security controls include configuration management as a first-class control family [CMSEC02].

---

# 20. Configuration-management model

SWEBOK v4.0a's SCM knowledge area covers management/planning, configuration identification, change control, status accounting, configuration auditing, build/release management and tools [BODY01]. ISO 10007:2017 remains current general configuration-management guidance at the cutoff [CM01].

This playbook uses the following operational model:

```text
1. IDENTIFY configuration items
2. DEFINE authority and attributes
3. ESTABLISH baselines where needed
4. CONTROL material change
5. RECORD status
6. BUILD/package from known inputs
7. VERIFY configuration
8. RELEASE/deliver
9. AUDIT and reconcile
```

## 20.1 Configuration item (CI) definition

A configuration item is any item whose identity/version/state must be controlled to preserve one or more of:

- correctness;
- compatibility;
- security;
- reproducibility;
- release integrity;
- auditability;
- recovery;
- maintenance.

Not every file is a separately governed CI.

## 20.2 Recommended configuration-item taxonomy

| Category | Examples |
|---|---|
| Source | application code, libraries, scripts |
| Contracts | APIs, event schemas, data schemas |
| Build | build rules, compiler/runtime settings, lockfiles |
| Test/eval | critical test assets, fixtures, eval sets |
| Infrastructure | IaC, images, manifests, network policy |
| Deployment | release manifests, environment mappings |
| Runtime configuration | settings, quotas, routing, flags |
| Security policy | IAM/policy-as-code, admission rules |
| Data evolution | migrations, backfill logic, reference data |
| AI behavior | model ID, prompt/instruction policy, tool configuration, eval policy |
| Operations | runbooks with state-changing commands |
| Supply chain | dependency sets, builder identity, provenance |
| Documentation | specs/ADRs that define controlled behavior |

## 20.3 CI record

For material items:

```yaml
ci_id:
category:
canonical_source:
owner:
version_identity:
mutable_or_immutable:
environment_scope:
sensitivity:
change_authority:
validation:
dependencies:
downstream_consumers:
retention:
audit_requirements:
```

---

# 21. Baselines

## 21.1 Baseline definition

A baseline is an identified set of configuration items and versions accepted as a reference state for a defined purpose.

Examples:

- integration baseline;
- release candidate;
- production deployment baseline;
- regulated qualification baseline;
- disaster-recovery baseline.

## 21.2 Modern deployment baseline

For a software service, a useful production baseline can include:

```yaml
deployment_id:
application_artifact_digest:
source_revision:
build_id:
build_provenance:
dependency_lock_or_SBOM_ref:
runtime_version:
config_revision:
feature_flag_snapshot_or_policy_ref:
infrastructure_revision:
policy_revision:
schema_version:
migration_state:
model_version_if_applicable:
prompt_or_agent_policy_version_if_material:
environment:
deployed_at:
deployed_by_identity:
```

Capture only dimensions that can materially affect behavior.

## 21.3 Baseline invariants

A baseline SHOULD be:

- uniquely identifiable;
- immutable as a historical record;
- reconstructable enough for its risk level;
- linked to approval/evidence where required;
- queryable during incidents.

A baseline record does not require all underlying items to be immutable at runtime; it requires that the relevant deployed state can be reconstructed.

---

# 22. Configuration as controlled engineering state

## 22.1 Configuration requirements

Material configuration SHOULD have:

- schema/type validation;
- documented semantics;
- owner;
- safe defaults;
- bounded values;
- version/change history;
- environment scope;
- failure behavior;
- observability;
- secret separation;
- rollback/recovery semantics.

## 22.2 Canonical source

Configuration MAY live in:

- version control;
- configuration service;
- policy store;
- feature-flag system;
- secret manager;
- cloud control plane;
- database/admin system.

The rule is not “everything in Git.”

The rule is:

> **Every material configuration has a canonical controlled authority, change history and production identity appropriate to its risk.**

## 22.3 Secrets

Live secret values MUST NOT be embedded in ordinary source repositories or documents.

Version control MAY contain:

- secret names/references;
- access policy;
- rotation policy;
- expected schema;
- non-sensitive metadata.

The secret system remains authoritative for values.

## 22.4 Typed configuration

Untyped free-form configuration SHOULD be avoided where invalid values can cause material harm.

Prefer:

- schemas;
- generated typed accessors;
- constraints;
- validation at load/change time;
- semantic validation;
- explicit unknown-key behavior.

## 22.5 Configuration change rollout

Configuration can be as dangerous as code.

High-impact configuration change SHOULD support:

- preview/diff;
- review;
- validation;
- scoped rollout;
- monitoring;
- revert or compensation;
- audit.

---

# 23. Feature flags and runtime controls

Feature flags can reduce deployment exposure, but create combinatorial state and cleanup debt.

Every material flag SHOULD define:

```yaml
flag_id:
owner:
purpose:
default:
scope:
created:
expiry_or_review:
safe_off_behavior:
dependencies_or_interactions:
metrics:
cleanup_plan:
```

## 23.1 Flag classes

Useful classes include:

- release flag;
- experiment flag;
- operational kill switch;
- permission/entitlement flag;
- temporary migration flag.

Do not use a generic feature-flag mechanism to bypass authorization controls.

## 23.2 Flag debt

Monitor:

- expired flags;
- permanently-on temporary flags;
- unreachable branches;
- interaction explosion;
- stale owners.

Flags that no longer provide decision value SHOULD be removed.

---

# 24. Configuration drift

## 24.1 Drift definition

Drift exists when actual controlled state differs from the intended/approved state or when the authority relationship becomes ambiguous.

## 24.2 Drift controls

For material environments:

- define desired/approved state;
- observe actual state;
- detect unauthorized/unexpected difference;
- classify drift;
- route to an owner;
- reconcile or explicitly accept;
- preserve emergency/break-glass context.

## 24.3 Automatic reconciliation

Auto-reconciliation is appropriate only when:

- desired state is authoritative;
- reconciliation is safe and idempotent;
- emergency/manual override semantics are defined;
- loops/failure are bounded;
- reconciliation itself is observable.

Do not blindly overwrite intentional incident mitigation.

## 24.4 GitOps

OpenGitOps v1.0.0 describes GitOps systems as declarative, versioned/immutable, automatically pulled and continuously reconciled [GITOPS01].

Use GitOps when those semantics fit the system.

Do not call ordinary “configuration stored in Git” GitOps unless pull/reconciliation semantics actually exist.

---

# 25. Versioning and identity

There is no one universal version number for a modern system.

Separate the identities that answer different questions.

## 25.1 Source revision

Answers:

> Which source history state?

Examples:

- commit hash;
- immutable VCS revision.

## 25.2 Build identity

Answers:

> Which build execution/output?

Examples:

- build ID;
- artifact digest;
- provenance attestation.

## 25.3 Release identity

Answers:

> Which product/release grouping was intentionally published?

Examples:

- release number;
- channel;
- signed manifest.

## 25.4 API/package compatibility version

Answers:

> What compatibility promise applies to consumers?

Semantic Versioning 2.0.0 is useful where a public API is declared; its own specification starts from that condition [VER01].

Do not impose SemVer on systems where:

- no public API contract exists;
- date/build/release train is the meaningful identity;
- regulated configuration IDs govern;
- schema/protocol compatibility has separate versioning.

## 25.5 Schema/data version

Answers:

> Which persistent-state contract applies?

Schema version MUST be coordinated with application compatibility and rollout.

## 25.6 Configuration version

Answers:

> Which runtime/policy settings materially shaped behavior?

This MAY be a revision, snapshot ID or set of versioned references.

## 25.7 Deployment identity

Answers:

> What exactly was running where and when?

Deployment identity SHOULD bind:

```text
artifact + config + environment + time + actor + rollout cohort
```

---

# 26. Build and artifact standard

## 26.1 Build as controlled process

Material builds SHOULD be:

- automated;
- versioned as code/configuration;
- repeatable;
- isolated from accidental workstation state;
- dependency-controlled;
- observable;
- uniquely identified.

Google SRE release engineering emphasizes reproducible/automated release processes and build identification [REL01].

## 26.2 Immutable promotion default

Where practical:

```text
BUILD ONCE
→ IDENTIFY / ATTEST
→ TEST
→ PROMOTE SAME ARTIFACT
```

This reduces environment-specific drift.

If target-specific rebuilding is necessary:

- same controlled source revision;
- controlled build definition;
- identified target inputs;
- reproducible process where risk justifies;
- distinct artifact identity;
- equivalent verification.

## 26.3 Reproducible builds

A reproducible build permits another party to regenerate bit-for-bit identical specified artifacts from the same source, build environment and instructions [BUILD01].

Use stronger reproducibility when:

- tampering risk is material;
- independent verification matters;
- regulated evidence requires it;
- package consumers need strong provenance.

Do not equate reproducibility with correctness.

## 26.4 Artifact provenance

For C2+ or distributed software supply chains, consider provenance recording:

- source repository/revision;
- build workflow;
- builder identity;
- dependency/material inputs;
- artifact digest;
- invocation/context;
- attestation.

SLSA v1.2 is the current approved specification used here as the primary supply-chain reference [SUP01].

---

# 27. Integration gate

A change can enter the authoritative integration baseline when applicable controls pass.

## 27.1 Standard gate

- [ ] change intent/acceptance basis exists;
- [ ] required automated checks pass;
- [ ] review requirement satisfied;
- [ ] material security/privacy/data impact addressed;
- [ ] migrations/config updates are included;
- [ ] dependency changes are acceptable;
- [ ] no unresolved blocker defect;
- [ ] resulting integrated revision is identifiable.

## 27.2 Higher-assurance additions

C3/C4 MAY add:

- independent reviewer;
- formal change request;
- signed approval;
- traceability matrix update;
- configuration audit;
- qualified tool evidence;
- segregation of duties;
- formal baseline establishment.

## 27.3 Integration is not release

A merged change MAY remain unreleased until:

- deeper verification completes;
- compatibility window is ready;
- customer/business release decision is made;
- external approval exists;
- migration/preconditions are satisfied.

---

# 28. Release candidate standard

A release candidate MUST bind the release intent to identified artifacts/configuration.

Recommended release-candidate manifest:

```yaml
release_candidate_id:
source_revision:
artifact_digests:
build_ids:
provenance_refs:
config_baseline:
schema_state:
migrations:
dependency_manifest_or_SBOM:
known_risks:
verification_evidence:
required_approvals:
release_strategy:
rollback_or_rollforward:
production_verification:
owner:
```

A release candidate SHOULD be immutable as a record even when the candidate is rejected.

---

# 29. Change approval

## 29.1 Principle

Approval is useful only when the approver owns a real decision or provides real independent assurance.

## 29.2 Routine change

For ordinary changes, prefer:

```text
peer/domain review
+ automated verification
+ protected integration
+ production observability
```

DORA's current change-approval guidance recommends peer review supported by automated testing and risk analysis rather than centralized review of every individual change [DORA04].

## 29.3 High-risk change

Escalate to security, data, platform, legal/compliance, business or independent assurance when the change crosses their decision boundary.

## 29.4 Central CAB

A CAB MAY be valuable for:

- cross-team coordination;
- strategic risk trade-offs;
- business scheduling;
- process improvement;
- portfolio-level visibility.

It SHOULD NOT be the default technical correctness reviewer for every code/configuration change.

## 29.5 Approval automation

Automation MAY approve routine change when:

- policy is explicit;
- evidence is machine-verifiable;
- authorization is externally enforced;
- exception/escalation exists;
- audit record is retained.

---

# 30. Deployment and release strategy

## 30.1 Select strategy from risk

Possible mechanisms:

- all-at-once;
- rolling;
- canary;
- blue/green;
- feature-flag exposure;
- ring/cohort rollout;
- shadow;
- parallel run;
- offline/package release;
- staged customer rollout.

No mechanism is universally best.

## 30.2 Progressive exposure

Use progressive rollout when:

- production behavior is hard to reproduce pre-release;
- blast radius is material;
- health signals can detect failure;
- traffic/users can be meaningfully segmented.

Define:

```yaml
cohort:
start_condition:
observation_window:
success_signals:
guardrails:
stop_thresholds:
expand_rule:
rollback_or_rollforward:
decision_owner:
```

## 30.3 Deployment preflight

Before material deployment:

- target artifact/config identified;
- environment authority verified;
- migration order verified;
- required secrets/permissions available;
- capacity/dependency preconditions satisfied;
- health signals ready;
- recovery path credible;
- operator ownership available.

## 30.4 Production marker

Every material deployment SHOULD emit or store:

- deployment ID;
- artifact/version/digest;
- configuration revision;
- environment;
- timestamp;
- deployment actor/automation identity;
- rollout cohort/status.

Operational telemetry SHOULD make deployment correlation easy.

---

# 31. Schema, data and migration changes

State-changing migrations are configuration-management and release-management concerns.

## 31.1 Prefer compatible staged evolution

For live systems, a strong default is:

```text
EXPAND
→ DEPLOY COMPATIBLE READERS/WRITERS
→ MIGRATE / BACKFILL
→ OBSERVE / RECONCILE
→ STOP OLD PATH
→ CONTRACT
```

## 31.2 Migration requirements

Material migration SHOULD define:

- source/target schema;
- compatibility window;
- ordering;
- transaction/batch strategy;
- idempotency/resume;
- rate/load limits;
- stop condition;
- reconciliation;
- rollback/roll-forward;
- backup/recovery;
- operational telemetry.

## 31.3 Irreversible migration

If old software cannot interpret new state, application rollback may be unsafe.

Increase pre-release assurance and plan roll-forward/restore/compensation explicitly.

---

# 32. Release gate

A material release passes when applicable evidence shows:

## Intent
- [ ] released behavior corresponds to approved intent;
- [ ] release contents are unambiguous.

## Artifact/configuration
- [ ] artifacts are identified;
- [ ] configuration baseline is identified;
- [ ] schema/migration compatibility is understood;
- [ ] feature-flag defaults/exposure are known;
- [ ] dependency/supply-chain evidence meets required level.

## Verification
- [ ] relevant tests/checks passed for the release candidate;
- [ ] unresolved findings have disposition;
- [ ] security/privacy review is complete where required.

## Operations
- [ ] deployment strategy is selected;
- [ ] production success/guardrail signals exist;
- [ ] stop/recovery criteria exist;
- [ ] operator/owner is known.

## Governance
- [ ] required approvals/waivers exist;
- [ ] traceability evidence meets criticality;
- [ ] regulated/contractual conditions are satisfied.

Green CI alone is never this gate.

---

# 33. Production verification

A material deployment is not closed at “deployment succeeded.”

Verify:

- correct version/config active;
- health/readiness;
- critical user journey;
- error/latency/availability signals;
- queue/saturation where relevant;
- data/schema reconciliation;
- security/authorization behavior where changed;
- business/domain correctness signal;
- rollout guardrails;
- unexpected side effects.

## 33.1 Verification window

Choose a window that reflects:

- traffic volume;
- delayed processing;
- batch schedules;
- conversion delay;
- model behavior;
- data backfill;
- dependency cycles.

A five-minute “looks fine” check is inadequate when failure manifests hours later.

## 33.2 Closure states

```text
VERIFIED
MONITORING
PAUSED
ROLLED_BACK
ROLLED_FORWARD
MITIGATED
REQUIRES_FOLLOW_UP
```

---

# 34. Operational configuration and change control

## 34.1 Production mutation rule

Manual production mutation SHOULD be minimized where a controlled declarative/automated path can safely perform the same action.

When manual mutation is necessary:

- authenticate/authorize;
- record actor/time/reason;
- bound scope;
- preserve before/after state where practical;
- validate result;
- reconcile canonical desired state afterward.

## 34.2 Break-glass

Break-glass capability SHOULD define:

```yaml
trigger:
eligible_roles:
authentication:
temporary_privilege:
scope:
logging:
notification:
expiry:
post_action_review:
baseline_reconciliation:
```

Break-glass MUST NOT silently become the normal workflow.

---

# 35. Emergency change standard

## 35.1 Trigger

Use only when normal lead time creates greater expected harm than the expedited path.

Examples:

- active incident;
- exploitable vulnerability;
- data corruption;
- critical outage;
- failed release requiring immediate repair;
- regulatory deadline requiring immediate control change.

## 35.2 Minimum non-waivable controls

Unless physically impossible and explicitly risk-accepted:

- identifiable change;
- authorized actor;
- bounded scope;
- relevant verification;
- identifiable artifact/configuration;
- deployment log;
- production monitoring;
- recovery/mitigation path.

## 35.3 Deferred controls

The emergency process MAY defer:

- long-form documentation;
- noncritical secondary review;
- full release notes;
- low-value approval ceremony.

Deferred items MUST have an owner and reconciliation deadline.

## 35.4 Post-emergency reconciliation

After stabilization:

1. ensure emergency state is in canonical source/configuration;
2. run deferred verification;
3. complete review;
4. remove temporary privileges/workarounds;
5. update baseline;
6. link to incident;
7. create systemic follow-up;
8. verify closure.

---

# 36. Traceability architecture

The Master Playbook Standard requires stronger traceability for higher-rigor work [MPS00].

This specialist playbook uses a software change trace:

```text
REQUIREMENT / INTENT
↕
CHANGE ID
↕
SOURCE REVISION
↕
REVIEW + TEST EVIDENCE
↕
BUILD / ARTIFACT DIGEST
↕
CONFIGURATION BASELINE
↕
RELEASE
↕
DEPLOYMENT / COHORT
↕
PRODUCTION SIGNALS
↕
INCIDENT / DEFECT / LEARNING
```

## 36.1 Traceability tiers

### T0 — Experimental

Minimum:

- source revision;
- basic outcome note.

### T1 — Ordinary

Minimum:

- issue/spec or change intent;
- source revision/PR;
- CI result;
- deployment identity.

### T2 — Material

Adds:

- explicit acceptance evidence;
- review;
- release manifest;
- config/schema identity;
- production verification;
- recovery record if invoked.

### T3 — High assurance

Adds:

- bidirectional requirement/control/test links;
- independent review;
- formal baseline;
- approval/waiver;
- retained release evidence;
- change-impact analysis.

### T4 — Critical

Domain-specific audit-grade traceability governs.

## 36.2 Traceability automation

Prefer automatic linkage via:

- VCS metadata;
- CI IDs;
- artifact attestations;
- deployment systems;
- telemetry deployment markers;
- incident/change references.

Manual matrices SHOULD be reserved for cases where machine linkage is insufficient or formal evidence requires them.

## 36.3 Orphan detection

At T2+ regularly detect:

- change with no intent;
- requirement with no implementation;
- critical control with no test;
- release with unknown artifact;
- deployment with unknown configuration;
- test with no current purpose;
- stale flag;
- incident with unresolved follow-up;
- emergency mutation not reconciled.

---

# 37. Configuration status accounting

For controlled items, the organization SHOULD be able to answer:

- what is current?;
- what changed?;
- who/what changed it?;
- why?;
- what version is in each environment?;
- what is pending?;
- which changes are approved/rejected?;
- which baseline governs?;
- which exceptions/waivers exist?;
- what is obsolete/superseded?;
- what is affected by a proposed change?

This does not require a single CM database. Federated systems are acceptable if relationships remain queryable and authoritative.

---

# 38. Configuration verification and audit

## 38.1 Verification

Verify that the intended configuration is actually represented by the released/deployed system.

Methods include:

- digest comparison;
- manifest reconciliation;
- config snapshot;
- policy validation;
- schema check;
- SBOM/provenance verification;
- feature-flag inspection;
- environment drift check.

## 38.2 Audit

Higher-risk systems SHOULD periodically sample:

- configuration-item inventory;
- baseline accuracy;
- unauthorized change;
- stale/unknown items;
- release-to-source traceability;
- emergency change reconciliation;
- separation of duties;
- production drift;
- obsolete feature flags;
- access control to build/release systems.

NIST SP 800-128 provides security-focused configuration-management guidance [CMSEC01]; NIST SP 800-53 Rev.5 Release 5.2.0 retains Configuration Management as a control family [CMSEC02].

---

# 39. Supply-chain and build security

The workflow boundary includes:

- source repositories;
- CI/CD;
- build runners;
- package managers;
- third-party actions/plugins;
- dependencies;
- base images;
- model artifacts;
- artifact registries;
- signing/attestation services.

## 39.1 Source controls

At risk-appropriate levels:

- protected authoritative branches/baselines;
- authenticated contributor identity;
- review requirements;
- restricted administrative bypass;
- tamper-evident history;
- controlled workflow changes.

SLSA v1.2 adds a Source Track concerned with source history/provenance and continuous enforcement of technical source controls [SUP01].

## 39.2 Build controls

Where material:

- isolated builders;
- least privilege;
- pinned/controlled build dependencies;
- ephemeral credentials;
- artifact digests;
- provenance;
- signing/attestation;
- independent verification.

## 39.3 Platform-specific example

GitHub protected branches can require review, status checks, signed commits, merge queues and restrictions [VCS01].

GitHub artifact attestations can bind a build to repository, workflow, commit and environment metadata, but GitHub explicitly warns that attestation is **not proof the artifact is secure** [PROV01].

Use platform features as implementations of the control objective, not as the definition of the standard.

---

# 40. Documentation-as-configuration

Documentation becomes controlled configuration when incorrect/stale content can cause material engineering or operational behavior.

Examples:

- architecture decision records;
- deployment procedures;
- disaster-recovery runbooks;
- migration procedures;
- AI agent instruction files;
- security operation steps;
- release policies.

## 40.1 Documentation controls

Material operational docs SHOULD have:

- canonical location;
- owner;
- version/history;
- review trigger;
- change linkage;
- last-tested date where procedural;
- superseded/deprecated state.

ISO/IEC/IEEE 15289:2019 remains current lifecycle information-item guidance [DOC01].

---

# 41. Quality gates

Gates are evidence checkpoints, not meetings.

## G0 — Ready to implement

- intent/acceptance clear;
- risk classified;
- key state/config impacts known.

## G1 — Ready for review

- implementation coherent;
- local/fast verification complete;
- change self-described;
- known risks visible.

## G2 — Ready to integrate

- required review complete;
- blocking CI checks pass;
- integration compatibility acceptable;
- no blocker findings.

## G3 — Ready for release

- release candidate identified;
- deep/risk-relevant evidence complete;
- config/schema/migration known;
- release/recovery strategy ready;
- required approval satisfied.

## G4 — Ready to expand exposure

- initial production verification passes;
- guardrails healthy;
- no stop threshold crossed.

## G5 — Ready to close

- intended outcome verified enough for the change;
- temporary controls/flags/workarounds owned;
- incidents/defects linked;
- follow-up created;
- trace/baseline complete.

## 41.1 Gate deletion rule

A gate SHOULD exist only if it:

- prevents/detects a material failure;
- satisfies a scoped requirement;
- establishes required independent judgment;
- protects a significant trust/authority transition.

Otherwise automate, combine or remove it.

---

# 42. Decision framework — choose an integration/branch model

```text
Do we require multiple simultaneously supported release lines?
  ├─ YES → use release/maintenance branches with explicit merge/cherry-pick policy
  └─ NO
       ↓
Can active work be integrated in small safe increments?
  ├─ YES → short-lived branch/mainline or trunk-style integration is a strong default
  └─ NO
       ↓
Why not?
  ├─ feature exposure problem → decouple deploy/release with flags/routing if safe
  ├─ test/build too slow → improve feedback architecture
  ├─ hardware/regulatory qualification → use controlled branch/baseline strategy
  ├─ giant migration → isolate deliberately, define convergence plan
  └─ habit/process → treat long divergence as a workflow risk
```

The decision criterion is **bounded divergence and integration evidence**, not branch ideology.

---

# 43. Decision framework — choose a version scheme

```text
Is there a public compatibility contract/API?
  ├─ YES → can SemVer's major/minor/patch semantics be applied honestly?
  │          ├─ YES → SemVer is reasonable
  │          └─ NO  → choose a domain-specific compatibility scheme
  └─ NO
       ↓
Is user-facing release chronology the main need?
  ├─ YES → release train/date/product version may be better
  └─ NO  → immutable build/deployment identity may be sufficient internally
```

Always keep immutable technical identity underneath the human label.

---

# 44. Decision framework — configuration delivery

```text
Can desired state be declared completely enough to be authoritative?
  ├─ NO → use controlled imperative/runtime configuration with audit
  └─ YES
       ↓
Can actual state be observed and safely reconciled?
  ├─ NO → version desired state but use explicit apply/verify workflow
  └─ YES
       ↓
Would pull-based continuous reconciliation reduce risk?
  ├─ YES → GitOps-style architecture may fit
  └─ NO → other configuration-as-code delivery may be simpler
```

---

# 45. Decision framework — manual approval

```text
Does this change require a judgment that automation/peer review cannot own?
  ├─ NO → avoid extra approval
  └─ YES
       ↓
What decision is being owned?
  ├─ technical correctness → qualified technical review
  ├─ security/privacy risk → security/privacy authority
  ├─ business timing/risk → product/business owner
  ├─ regulatory/SoD → required independent approver
  └─ unknown → clarify governance before adding a gate
```

A generic manager click is not assurance.

---

# 46. Decision framework — rollback vs roll-forward

## Prefer rollback when

- previous version can safely interpret current state;
- external side effects are compatible/reversible;
- rollback is tested;
- restoration is faster/safer.

## Prefer roll-forward when

- state has irreversibly changed;
- old version would corrupt/misread state;
- external effects cannot be undone;
- minimal corrective change is safer;
- rollback would reintroduce known vulnerability.

## Consider compensation/restore when

- business action must be reversed semantically;
- data must be restored/reconciled;
- distributed side effects require explicit compensating actions.

---

# 47. Decision framework — AI autonomy in engineering

```text
Can the AI only suggest/read?
  └─ A0/A1 controls

Can it mutate source but not integrate?
  └─ A1/A2 + standard verification

Can it merge?
  └─ require externally enforced merge policy + audit + bounded scope

Can it deploy/release?
  └─ require release policy + scoped identity + production gates + revoke/kill

Can it alter privileged security/data/infra or irreversible state?
  └─ C3/C4 controls; human/independent approval where consequence requires
```

Never use the model's own statement “this is safe” as authorization.

---

# 48. Definition of Ready — engineering change

A material change is ready for implementation when:

- [ ] change ID/owner exists;
- [ ] intended outcome is clear;
- [ ] acceptance conditions are clear enough to verify;
- [ ] non-goals/scope are bounded;
- [ ] criticality/change risk is assigned;
- [ ] protected invariants are identified;
- [ ] impacted interfaces/state/configuration are known enough;
- [ ] security/privacy/data implications are identified where relevant;
- [ ] required reviewers/approvers are known;
- [ ] migration/recovery implications are considered;
- [ ] AI task boundaries are explicit if an agent will act;
- [ ] unresolved unknowns do not make implementation direction arbitrary.

---

# 49. Definition of Done — engineering change

A production change is done only when all applicable items pass.

## Intent
- [ ] intended behavior implemented;
- [ ] acceptance evidence exists;
- [ ] non-goals not accidentally expanded.

## Verification
- [ ] risk-relevant automated checks passed;
- [ ] manual/specialist verification completed where required;
- [ ] generated/AI output independently validated as required;
- [ ] no unresolved blocker finding.

## Review/integration
- [ ] required review completed against identified revision;
- [ ] authoritative baseline remains healthy;
- [ ] dependency/config/schema changes are controlled.

## Build/release
- [ ] artifact/release identity is immutable enough for reconstruction;
- [ ] release candidate maps to source/build/config;
- [ ] supply-chain evidence meets required assurance;
- [ ] recovery strategy is credible.

## Production
- [ ] deployed version/config is known;
- [ ] post-deploy checks passed;
- [ ] guardrail monitoring completed for the required observation window;
- [ ] migration/backfill/reconciliation complete or explicitly ongoing.

## Governance
- [ ] required approval/waiver recorded;
- [ ] emergency/break-glass state reconciled;
- [ ] traceability meets tier.

## Learning
- [ ] follow-up defects/debt have owner;
- [ ] temporary flags/workarounds have removal/review date;
- [ ] material new knowledge is reflected in tests, docs, tooling or policy.

---

# 50. Release checklist

- [ ] Intended source revision is unambiguous
- [ ] Release candidate/artifact digest is identified
- [ ] Build evidence corresponds to this artifact
- [ ] Critical security/dependency findings are resolved or accepted
- [ ] Runtime/config baseline is identified
- [ ] Schema/config rollout order is compatible
- [ ] Feature-flag defaults/exposure are confirmed
- [ ] Migration/backfill is bounded and observable
- [ ] Release notes/operator notes exist where useful
- [ ] Progressive cohort/strategy is defined where used
- [ ] Health/guardrail stop conditions are defined
- [ ] Rollback/roll-forward/compensation path is credible
- [ ] Required release owner/approver is available
- [ ] Production deployment marker will be emitted
- [ ] Post-release verification is defined
- [ ] Temporary controls have cleanup owner/date

---

# 51. Pull-request / change-review checklist

## Intent
- [ ] Reason and acceptance condition are clear
- [ ] Scope is coherent
- [ ] Unrelated churn is absent or justified

## Correctness
- [ ] Important invariants remain true
- [ ] Boundary/error states handled
- [ ] concurrency/order/time assumptions reviewed where relevant
- [ ] state transitions are valid

## Security/privacy
- [ ] authorization/trust changes reviewed
- [ ] untrusted inputs validated
- [ ] secrets/sensitive data not exposed
- [ ] dependency/supply-chain change reviewed

## Configuration
- [ ] new/changed configuration has schema/default/owner
- [ ] feature flags have lifecycle
- [ ] CI/CD/IaC changes receive appropriate scrutiny
- [ ] environment assumptions are explicit

## Verification
- [ ] evidence matches risk
- [ ] tests do not merely restate implementation
- [ ] regressions considered
- [ ] flaky/ignored checks do not hide failure

## Operations
- [ ] observability adequate
- [ ] migration/recovery considered
- [ ] performance/cost impact considered where material
- [ ] release/deployment implications understood

## Maintainability
- [ ] change is understandable
- [ ] new abstraction is justified
- [ ] docs/ADR/runbook updated where decision changed

## AI-assisted
- [ ] generated dependency/API claims verified where material
- [ ] AI did not weaken gates
- [ ] reviewer understands critical behavior
- [ ] AI self-review is not the sole independent evidence

---

# 52. Configuration-item template

```yaml
ci_id:
name:
category:
purpose:
canonical_source:
owner:
criticality:
sensitivity:
version_identity:
baseline_membership:
environment_scope:
dependencies:
consumers:
change_process:
required_validation:
required_review:
drift_detection:
retention:
deprecation:
```

---

# 53. Change record template

```yaml
change_id:
title:
owner:
status:

objective:
current_behavior:
intended_behavior:
non_goals:

system_criticality:
change_risk:
risk_drivers:

requirements_or_spec_refs:
protected_invariants:
affected_components:
affected_configuration_items:
interfaces:
data_or_schema_change:
security_privacy_change:

implementation_revision:
review_evidence:
verification_evidence:

build_id:
artifact_digest:
config_baseline:
release_id:
deployment_id:

release_strategy:
recovery_strategy:
production_verification:

exceptions_or_waivers:
residual_risk:
follow_up:
```

---

# 54. Release manifest template

```yaml
release_id:
created_at:
owner:

source_revision:
build_id:
artifacts:
  - name:
    digest:
    provenance_ref:

dependency_manifest_ref:
config_baseline:
schema_version:
migration_refs:
infrastructure_revision:
policy_revision:
feature_flag_policy_ref:
ai_model_or_prompt_versions_if_material:

verification:
security_review:
approvals:
known_issues:
residual_risk:

deployment_strategy:
target_environments:
production_success_signals:
guardrails:
stop_conditions:
recovery:
```

---

# 55. Emergency change record

```yaml
emergency_change_id:
incident_or_trigger:
declared_by:
authorized_by:
start_time:

harm_of_waiting:
scope:
risk:
affected_state:

source_revision:
verification_run:
review_or_pair:
artifact_or_config_identity:
deployment_actor:

production_signals:
recovery_path:
result:

temporary_bypasses:
baseline_reconciled:
deferred_checks:
post_change_review:
follow_up_actions:
closed_at:
```

---

# 56. AI engineering task template

```yaml
task_id:
objective:
authoritative_spec_refs:
base_revision:

allowed_scope:
protected_invariants:
do_not_touch:
approved_dependencies:

agent_identity_or_tool:
instruction_policy_version:
allowed_tools:
write_scope:
network_scope:
secrets_policy:

required_tests:
required_static_checks:
required_human_or_independent_review:
merge_permission:
release_permission:

stop_conditions:
escalation_conditions:

result_revision:
evidence:
review:
```

---

# 57. Traceability matrix template — C3/R3+ when needed

| Requirement / risk | Change/control | Source revision | Test/evidence | Reviewer | Artifact/release | Deployment | Production evidence | Status |
|---|---|---|---|---|---|---|---|---|

Do not maintain this manually if trustworthy linked systems can generate the same evidence.

---

# 58. Exception / waiver template

```yaml
exception_id:
rule_or_control:
scope:
reason:
risk_if_wrong:
compensating_controls:
owner:
approved_by:
starts:
expires:
monitoring:
revisit_trigger:
closure:
```

Permanent exceptions SHOULD become explicit policy/architecture or be removed.

---

# 59. Metrics and measurement

## 59.1 Delivery flow

Potential measures:

- change lead time;
- deployment frequency;
- review wait time;
- merge/integration queue time;
- batch size;
- work-in-progress age.

DORA's current five metrics use change lead time, deployment frequency and failed deployment recovery time for throughput, plus change fail rate and deployment rework rate for instability [DORA01].

## 59.2 Stability

- change fail rate;
- deployment rework rate;
- failed-deployment recovery time;
- rollback/roll-forward frequency;
- incident rate linked to change;
- escaped defect rate.

## 59.3 Integration health

- branch/divergence age;
- time authoritative baseline is red;
- CI feedback latency;
- required-check flake rate;
- merge conflict/rework rate;
- merge queue wait.

Do not create universal numeric targets without local evidence.

## 59.4 Configuration health

- unknown/unowned CIs;
- unauthorized drift;
- time-to-detect drift;
- unreconciled emergency changes;
- configuration-caused incidents;
- stale flags;
- stale secrets/credential references;
- unversioned production changes.

## 59.5 Traceability health

- deployments with known source/artifact/config identity;
- releases missing provenance where required;
- orphan requirements/tests;
- incident-to-change linkage;
- time to reconstruct a production baseline.

## 59.6 AI workflow health

- accepted AI-assisted outcomes;
- review/rework burden;
- escaped defect/security finding rate;
- rollback/rework attributable to AI-assisted change;
- reviewer comprehension;
- large opaque AI diff rate;
- agent permission violations/blocked actions;
- tool/model cost per accepted outcome.

## 59.7 Goodhart safeguard

For every metric define:

```yaml
question:
decision:
population:
source:
owner:
failure_modes:
gaming_risk:
segments:
review_trigger:
```

Never optimize deployment frequency, PR throughput, test count, code coverage, AI LOC or agent-task count in isolation.

---

# 60. Anti-patterns

## 60.1 “Green CI means releasable”

**Why it fails:** CI can omit migration, configuration, production, security and recovery risks.

**Better rule:** CI is one evidence layer; release readiness is broader.

## 60.2 “Every production change needs a CAB”

**Why it fails:** central reviewers can lack technical context and create delay/batch growth [DORA04].

**Better rule:** routine technical assurance close to the work; escalate true risk decisions.

## 60.3 “Trunk-based development is always best”

**Why it fails:** release lines, regulatory baselines and packaged/hardware products can require different branch structures.

**Better rule:** minimize divergence and integrate frequently; choose topology from release/support constraints.

## 60.4 “Long-lived branches are harmless if CI is good”

**Why it fails:** isolated CI does not test the eventual integrated state.

**Better rule:** bound divergence and verify integrated combinations.

## 60.5 “Semantic Versioning is universal”

**Why it fails:** SemVer assumes a declared public API [VER01].

**Better rule:** version according to the compatibility contract; preserve immutable underlying identity.

## 60.6 “GitOps means storing YAML in Git”

**Why it fails:** OpenGitOps includes declarative desired state, automatic pull and continuous reconciliation [GITOPS01].

**Better rule:** call the architecture by its real semantics.

## 60.7 “Everything belongs in one repository”

**Why it fails:** secrets and externally authoritative control-plane state may not.

**Better rule:** one canonical authority per item, linked by traceability.

## 60.8 “Configuration is not code, so it is low risk”

**Why it fails:** config can alter authorization, routing, capacity and behavior instantly.

**Better rule:** govern by effect, not file extension.

## 60.9 “Rollback is always safest”

**Why it fails:** old binaries may be incompatible with mutated state.

**Better rule:** choose recovery from state compatibility.

## 60.10 “Build once” as dogma

**Why it fails:** target-specific binaries/packages can be legitimate.

**Better rule:** prefer immutable promotion; otherwise make target builds controlled, reproducible and distinct.

## 60.11 “A tag/version proves what is running”

**Why it fails:** labels can be mutable or ambiguous.

**Better rule:** bind to digest/revision/deployment record.

## 60.12 “More approvals mean more safety”

**Why it fails:** attention becomes diluted and rubber-stamped.

**Better rule:** fewer meaningful decision gates with better evidence.

## 60.13 “Manual production fix now, source later”

**Why it fails:** creates invisible drift.

**Better rule:** emergency mutation must be logged and reconciled promptly.

## 60.14 “Feature flags are free rollback”

**Why it fails:** flags create state combinations and may not reverse data side effects.

**Better rule:** verify safe-off semantics and clean up flags.

## 60.15 “Staging proves production”

**Why it fails:** production has real traffic, scale, data and dependencies.

**Better rule:** staging evidence + proportionate production verification/progressive exposure.

## 60.16 “AI-generated tests independently validate AI-generated code”

**Why it fails:** the same assumptions can infect implementation and oracle.

**Better rule:** use independent deterministic/domain/runtime evidence.

## 60.17 “Human-in-the-loop solves AI risk”

**Why it fails:** humans can rubber-stamp opaque high-volume change.

**Better rule:** bound capability, enforce policy, improve evidence and require understandable review at consequence thresholds.

## 60.18 “Store the entire AI conversation for traceability”

**Why it fails:** sensitive leakage, high noise, no guarantee of assurance value.

**Better rule:** retain minimal execution provenance and decisions; never require hidden reasoning.

## 60.19 “Emergency change means bypass CI/review”

**Why it fails:** emergencies increase consequence.

**Better rule:** shorten latency while protecting essential evidence/identity/recovery.

## 60.20 “Full traceability matrix for every typo”

**Why it fails:** bureaucracy obscures critical traceability.

**Better rule:** proportional tiers and machine-generated links.

## 60.21 “Rebuild the same commit = same artifact”

**Why it fails:** dependencies/toolchain/environment can differ.

**Better rule:** control/record build inputs; use reproducibility/provenance when needed.

## 60.22 “Signed artifact = safe artifact”

**Why it fails:** a signature establishes linkage to identity/key, not semantic correctness.

**Better rule:** combine provenance with verification and policy.

## 60.23 “Change freeze fixes instability”

**Why it fails:** it can defer integration and enlarge batches.

**Better rule:** improve verification/recovery; use freezes only for explicit business/high-assurance constraints.

## 60.24 “AI can merge because it passed its own review”

**Why it fails:** generation, review and authorization are correlated.

**Better rule:** external policy gate + independent evidence.

## 60.25 “The workflow ends at deploy”

**Why it fails:** deployment success is not user/system outcome.

**Better rule:** production verification and learning close the change.

---

# 61. Human roles and decision rights

A team SHOULD make these responsibilities unambiguous, even when one person fills several roles:

- **Change owner** — accountable for intended outcome.
- **Implementer** — human or AI process producing the change.
- **Reviewer** — challenges semantics/risk.
- **Configuration owner** — accountable for controlled item/baseline.
- **Release owner** — accountable for release decision.
- **Deployment automation/operator** — executes controlled deployment.
- **Service/operator owner** — accountable for production outcome.
- **Risk/security/privacy specialist** — owns scoped specialist decisions.
- **Assurance/auditor** — independent where criticality requires.
- **AI policy owner** — defines agent capability/permission boundaries where agentic engineering is used.

Do not create a role just to fill a RACI box. Create decision clarity.

---

# 62. Repository and access-control standard

Production engineering repositories SHOULD provide, proportionate to risk:

- authenticated access;
- least-privilege writes;
- protected authoritative baselines;
- visible history;
- required checks;
- ownership routing;
- restricted bypass;
- audit of privileged changes;
- availability sufficient for engineering/incident needs.

High-risk changes to the **workflow itself**—CI definitions, release policies, branch rules, deployment credentials, agent permission files—SHOULD receive at least the scrutiny of application code because they can redefine assurance.

---

# 63. Change impact and dependency control

Before material changes to a shared artifact, determine affected downstream/upstream relationships.

Examples:

```text
API schema
  → generated clients
  → services
  → tests
  → customer integrations

build workflow
  → all artifacts
  → provenance
  → release pipeline

agent instruction policy
  → generated changes
  → tool behavior
  → security boundary
```

Changes to critical shared configuration SHOULD trigger targeted re-verification of dependents.

---

# 64. Review cadence and triggers for this standard

Review this playbook when:

- ISO/IEC/IEEE 12207 changes materially;
- ISO 10007 is replaced/revised;
- ISO/IEC/IEEE 29148 replacement publishes;
- IEEE 1012/730 change materially;
- NIST SSDF 1.2 becomes final or changes status;
- SLSA changes approved version;
- major DORA research revises integration/change-approval evidence;
- AI coding-agent evidence changes materially;
- a serious incident exposes a workflow/control defect;
- metrics show persistent review/integration/release bottlenecks;
- users routinely bypass controls.

Default scheduled review: **6–12 months**, shortened for AI/platform-specific implementation profiles.

---

# 65. Scenario dry-runs of V2

## Scenario A — Ordinary SaaS feature

**Change:** add a recoverable UI/API feature behind a flag.

**Expected path:** C1 → concise spec → short-lived change → fast CI → peer review → integrate → identified artifact → deploy → flag exposure → production verify.

**Result:** PASS.

**Why:** no formal matrix/CAB required; still preserves intent, integration, artifact identity and operational closure.

## Scenario B — High-risk database migration

**Change:** transform production customer state with limited rollback.

**Expected path:** C2/C3 → explicit migration spec/invariants → rehearsal → independent review → expand/migrate/observe/contract → immutable release manifest → production reconciliation → roll-forward/restore decision.

**Result:** PASS.

**Key audit property:** V2 does not falsely require binary rollback.

## Scenario C — AI coding agent proposes and merges infrastructure change

**Change:** agent edits IAM/IaC and wants to merge.

**Expected path:** risk escalation → A2/A3 boundary → agent can propose change but external policy blocks self-authorized merge → security/platform review + deterministic policy/test evidence → identified integration → controlled release.

**Result:** PASS.

**Key audit property:** model output is not authority; self-review cannot satisfy independence.

## Scenario D — Severe incident hotfix

**Change:** emergency production fix during outage.

**Expected path:** emergency record → bounded change → fastest relevant tests/review → attributable artifact → controlled deploy → intensive production verification → baseline reconciliation → deferred review/post-incident action.

**Result:** PASS.

**Key audit property:** emergency flow reduces ceremony without losing essential identity and recovery.

## Scenario E — Regulated multi-release product

**Change:** patch two supported customer release lines.

**Expected path:** release branches are permitted → branch policy identifies support lines and cherry-pick/merge direction → separate identified baselines → required independent evidence/approval → release packages.

**Result:** PASS.

**Key audit property:** V2 does not force trunk topology where lifecycle constraints justify maintained release lines.

---

# 66. Adversarial perspective audit

## Maintainer

PASS if:

- can reconstruct why change exists;
- can identify running version/config;
- can safely modify/revert/replace;
- AI did not leave opaque unowned code.

## Reviewer

PASS if:

- batch size is reviewable;
- automated evidence handles mechanics;
- risk is visible;
- no meaningless approval burden.

## SRE/operator

PASS if:

- deploy is attributable;
- version/config correlate with telemetry;
- recovery is state-aware;
- production verification exists.

## Security engineer

PASS if:

- CI/build/release are treated as privileged systems;
- configuration changes are governed;
- supply-chain provenance is available where required;
- AI cannot self-authorize privileged change.

## Data engineer

PASS if:

- schema/state evolution is staged;
- migrations are resumable/observable where appropriate;
- rollback assumptions are not fictional.

## Regulated/high-assurance reviewer

PASS if:

- stronger independence/traceability can be layered without changing the base model;
- baselines and approvals are durable;
- exceptions are explicit.

## AI/agent engineer

PASS if:

- task scope and permissions are explicit;
- candidate output is verified;
- agent autonomy scales with consequence;
- minimal operational provenance exists;
- stop/revoke path exists for material authority.

**Audit verdict:** PASS with field-validation requirement remaining.

---

# 67. Evidence map — principal conclusions

| Claim | Classification | Confidence | Evidence |
|---|---|---:|---|
| Lifecycle processes need not be waterfall and can be iterative/concurrent | EST | HIGH | [LIFE01][LCM01] |
| Requirements/acceptance need lifecycle discipline | EST | HIGH | [REQ01] |
| SCM covers identification, control, status accounting, audit, build/release | EST | HIGH | [BODY01][CM01] |
| IEEE 828-2012 is not a current active standard | REQ-status | HIGH | [CMHIST01] |
| Assurance should scale with integrity/criticality | EST | HIGH | [VV01][MPS00][ENG00] |
| SQA is a lifecycle process with planning/control/execution | EST | HIGH | [QA01] |
| Secure practices must be integrated into the SDLC | EST | HIGH | [SEC01] |
| NIST SSDF 1.2 is still draft | REQ-status | HIGH | [SEC02] |
| Configuration security/change monitoring is a first-class security concern | EST | HIGH | [CMSEC01][CMSEC02] |
| Frequent integration and small batches are strong delivery mechanisms | DEF/CTX | MODERATE-HIGH | [DORA01][DORA02][DORA03] |
| Centralized manual approval for every change is a weak universal default | CTX | MODERATE | [DORA04] |
| Reproducible/identified releases reduce accidental release variance | EST/DEF | HIGH | [REL01][BUILD01] |
| Provenance provides origin/build evidence, not proof of semantic security | EST | HIGH | [SUP01][PROV01] |
| SemVer requires a declared public API and is not universal | CTX | HIGH | [VER01] |
| GitOps has specific declarative/pull/reconciliation semantics | CTX | HIGH | [GITOPS01] |
| AI-generated code requires testing/contextual/human verification | EST | HIGH | [ENG00][AI01] |
| AI evaluation benefits from multiple complementary evaluation modes | EST | HIGH for AI systems | [AI02] |

---

# 68. V2 sanity-check conclusions

## What is strongly supported

### A. Lifecycle responsibilities, not one methodology
**Confidence: HIGH.**

Current ISO/IEC/IEEE 12207 explicitly supports multiple formal engineering approaches and iterative/concurrent application [LIFE01].

### B. Configuration management is broader than version control
**Confidence: HIGH.**

SWEBOK v4.0a explicitly covers configuration identification, change control, status accounting, auditing and release management [BODY01]. ISO 10007 provides current cross-product/service guidance [CM01].

### C. Risk-proportional assurance
**Confidence: HIGH.**

Supported across IEEE 1012 and both parent playbooks [VV01][MPS00][ENG00].

### D. Frequent integration is a strong modern default, not universal topology
**Confidence: MODERATE-HIGH.**

DORA evidence strongly supports small batches, frequent mainline integration and continuous feedback [DORA02][DORA03]. The evidence is operational/empirical, not a formal requirement for every release model.

### E. Build/release identity and provenance matter
**Confidence: HIGH.**

Google SRE, reproducible-build definitions and SLSA converge on controlled, identifiable release inputs/outputs [REL01][BUILD01][SUP01].

### F. Manual approval should be risk-targeted
**Confidence: MODERATE-HIGH.**

DORA operational evidence argues against centralized approval of every change and for peer review + automation + targeted high-risk scrutiny [DORA04]. Regulatory requirements can override.

### G. AI does not lower assurance
**Confidence: HIGH for principle; MODERATE for exact workflow mechanics.**

The parent engineering standard and current AI review guidance converge on independent verification [ENG00][AI01]. Exact AI agent tools/models remain fast-moving.

## What remains HOUSE synthesis

The following are deliberate architecture choices for this playbook, not external standards:

- exact workflow state names;
- C0–C4 application details in this file;
- A0–A5 AI engineering autonomy tiers;
- exact G0–G5 gate sequence;
- traceability tiers T0–T4;
- exact release manifest fields;
- exact CI taxonomy;
- the “deployment baseline” schema;
- exact Definition of Ready/Done;
- exact templates.

## What remains uncertain / should be field-piloted

1. Which traceability fields provide the best value for C2 SaaS teams without excessive tooling burden.
2. How much AI provenance is useful before it becomes noise/privacy risk.
3. Optimal human-review thresholds for bounded autonomous coding agents.
4. Whether teams can measure “reviewer/system understanding” reliably enough to use as an AI guardrail.
5. How to normalize deployment/configuration identity across heterogeneous platforms.
6. Which automated configuration-audit controls best detect meaningful drift without alert fatigue.
7. Whether G0–G5 should be explicitly represented in tooling or remain conceptual.
8. How branch-age/integration metrics behave across monorepos, release trains and regulated products.
9. How much artifact provenance should be mandatory at C2 versus selected high-risk changes.
10. Whether this standard needs separate profiles for packaged/embedded vs continuously deployed services.

---

# 69. Source register

> Sources have different evidentiary roles. Formal standards define processes/requirements; operational research supports delivery mechanisms; vendor documentation establishes platform semantics; none is treated as a universal proof outside its scope.

## [MPS00] — Master Playbook Standard v2.0-RC1

**Source:** user-provided canonical Playbook 00.  
**Used for:** evidence model, risk-proportional rigor, traceability spine, audit architecture, statuses, version/change control, human+AI execution compatibility, Definitions of Ready/Done.  
**Limitation:** exact house taxonomies are internal synthesis and are not external ISO/NIST requirements.

## [ENG00] — Universal Software & AI Engineering Master Playbook v2.0

**Source:** user-provided engineering root standard.  
**Used for:** lifecycle model, criticality, build/configuration discipline, version control, code review, CI/CD, release/deployment, migration, production readiness and AI-assisted change controls.  
**Limitation:** specialist playbook must add depth without converting contextual mechanisms into universal rules.

## [BODY01] — IEEE Computer Society — SWEBOK v4.0a

**URL:** https://www.computer.org/education/bodies-of-knowledge/software-engineering  
**Status:** current; v4.0a update 25 September 2025.  
**Evidence role:** consensus body of knowledge.  
**Used for:** Software Configuration Management domain coverage. SWEBOK's current topic map includes SCM planning, configuration identification, change control, status accounting, auditing, build/release management and tools.  
**Limitation:** body of knowledge, not proof that every listed technique is optimal for every project.

## [LIFE01] — ISO/IEC/IEEE 12207:2026 — Software life cycle processes

**URL:** https://www.iso.org/standard/90219.html  
**Status:** Published April 2026; current.  
**Evidence role:** international lifecycle standard.  
**Used for:** full software lifecycle, iterative/concurrent/recursive applicability, methodology neutrality, control/improvement of lifecycle processes.  
**Limitation:** does not prescribe one engineering methodology or specific CI/CD design.

## [LCM01] — ISO/IEC/IEEE 24748-1:2024 — Guidelines for life cycle management

**URL:** https://www.iso.org/standard/84709.html  
**Status:** current.  
**Evidence role:** international lifecycle-management guidance.  
**Used for:** lifecycle concepts, adaptation/tailoring and project lifecycle management.  
**Limitation:** general lifecycle management; detailed software workflow mechanisms remain contextual.

## [PLAN01] — ISO/IEC/IEEE 24748-5:2017 — Software development planning

**URL:** https://www.iso.org/standard/60062.html  
**Status:** confirmed 2022; current at cutoff.  
**Evidence role:** international planning/control guidance.  
**Used for:** planning and controlling technical activities across conception-to-retirement.  
**Limitation:** planning standard; modern implementation tooling evolves faster.

## [REQ01] — ISO/IEC/IEEE 29148:2018 — Requirements engineering

**URL:** https://www.iso.org/standard/72089.html  
**Status:** current published edition, confirmed 2024; marked to be revised; DIS replacement under development in 2026.  
**Evidence role:** international requirements-engineering standard.  
**Used for:** requirements lifecycle and specification quality.  
**Limitation:** replacement is approaching; re-check when new edition publishes.

## [DOC01] — ISO/IEC/IEEE 15289:2019 — Life-cycle information items

**URL:** https://committee.iso.org/standard/74909.html  
**Status:** current; confirmed 2025.  
**Evidence role:** international documentation/information-item standard.  
**Used for:** controlled lifecycle documentation and information artifacts.  
**Limitation:** does not mandate that every information item be a separate document.

## [CM01] — ISO 10007:2017 — Guidelines for configuration management

**URL:** https://www.iso.org/standard/70400.html  
**Status:** current at cutoff, confirmed 2023; marked for revision.  
**Evidence role:** international configuration-management guidance.  
**Used for:** configuration management across product/service lifecycle.  
**Limitation:** broad quality-management guidance; software-specific implementation is supplemented by SWEBOK and engineering sources.

## [CMHIST01] — IEEE 828-2012 — Configuration Management in Systems and Software Engineering

**URL:** https://standards.ieee.org/ieee/828/5367/  
**Status:** `Inactive-Reserved`; inactivated 30 March 2023; no active replacement shown by IEEE at cutoff.  
**Evidence role:** historical configuration-management process reference only.  
**Used for:** historical concepts such as configuration identification, change control, status accounting, builds/releases.  
**Limitation:** MUST NOT be represented as a current active standard.

## [VV01] — IEEE 1012-2024 — System, Software, and Hardware Verification and Validation

**URL:** https://standards.ieee.org/ieee/1012/7324/  
**Status:** Active.  
**Evidence role:** formal V&V standard.  
**Used for:** risk/integrity-level proportional assurance and broad V&V methods.  
**Limitation:** higher-assurance orientation; not all activities belong in low-risk software.

## [QA01] — IEEE 730-2026 — Software Quality Assurance Processes

**URL:** https://standards.ieee.org/ieee/730/10854/  
**Status:** Active; approved February 2026.  
**Evidence role:** formal software quality-assurance process standard.  
**Used for:** initiating, planning, controlling and executing SQA processes in development/maintenance.  
**Limitation:** process standard, not a fixed CI/CD architecture.

## [SEC01] — NIST SP 800-218 — SSDF v1.1

**URL:** https://csrc.nist.gov/pubs/sp/800/218/final  
**Status:** Final.  
**Evidence role:** government secure-development framework.  
**Used for:** integrating secure practices throughout the SDLC.  
**Limitation:** high-level framework; implementation depends on technology/threat model.

## [SEC02] — NIST SP 800-218 Rev.1 — SSDF v1.2

**URL:** https://csrc.nist.gov/pubs/sp/800/218/r1/ipd  
**Status:** Initial Public Draft; comment period closed; not final at cutoff.  
**Evidence role:** watch item / emerging secure-development update.  
**Used for:** future-direction awareness only.  
**Limitation:** MUST NOT replace SSDF 1.1 as current final baseline.

## [CMSEC01] — NIST SP 800-128 Update 1 — Security-Focused Configuration Management

**URL:** https://csrc.nist.gov/pubs/sp/800/128/upd1/final  
**Status:** Final update.  
**Evidence role:** government security-focused CM guidance.  
**Used for:** configuration monitoring/control as security-risk management.  
**Limitation:** U.S. federal security focus; not the general software CM standard.

## [CMSEC02] — NIST SP 800-53 Rev.5, Release 5.2.0

**URL:** https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final  
**Status:** current Rev.5 with Release 5.2.0 update issued August 2025.  
**Evidence role:** government security/privacy controls.  
**Used for:** Configuration Management control-family relevance and secure update/deployment context.  
**Limitation:** control catalog; applicability depends on governance/regulatory environment.

## [SUP01] — SLSA v1.2

**URL:** https://slsa.dev/spec/v1.2/  
**Status:** Approved/current.  
**Evidence role:** open supply-chain specification.  
**Used for:** source/build provenance and progressively stronger supply-chain controls.  
**Limitation:** provenance/security controls do not prove semantic correctness or vulnerability absence.

## [BUILD01] — Reproducible Builds — Definition

**URL:** https://reproducible-builds.org/docs/definition/  
**Evidence role:** open build-integrity definition/practice.  
**Used for:** precise reproducible-build semantics.  
**Limitation:** reproducibility proves consistency of build result, not correctness/security.

## [REL01] — Google SRE — Release Engineering

**URL:** https://sre.google/sre-book/release-engineering/  
**Evidence role:** mature large-scale operational practice.  
**Used for:** reproducible/automated releases, build identity, source-to-deployment discipline, controlled release operations.  
**Limitation:** Google-scale practices; mechanisms should be tailored.

## [DORA01] — DORA — Software delivery performance metrics

**URL:** https://dora.dev/guides/dora-metrics/  
**Status:** current page last updated 5 January 2026.  
**Evidence role:** longitudinal industry research/practice.  
**Used for:** current five-metric throughput/instability model and small-batch improvement logic.  
**Limitation:** team/application delivery measures, not individual productivity targets.

## [DORA02] — DORA — Continuous integration

**URL:** https://dora.dev/capabilities/continuous-integration/  
**Evidence role:** operational/research-backed delivery capability.  
**Used for:** automated builds/tests, rapid feedback, frequent integration, authoritative packages.  
**Limitation:** recommendations are strongest for software delivery contexts that can support continuous integration.

## [DORA03] — DORA — Trunk-based development

**URL:** https://dora.dev/capabilities/trunk-based-development/  
**Evidence role:** operational/research-backed delivery capability.  
**Used for:** small batches, short-lived divergence and frequent mainline integration.  
**Limitation:** underlying cited DORA association research is older and context-dependent; exact branch strategy is not universal.

## [DORA04] — DORA — Streamlining change approval

**URL:** https://dora.dev/capabilities/streamlining-change-approval/  
**Status:** current page updated 30 October 2025.  
**Evidence role:** operational/research-backed change-management guidance.  
**Used for:** peer review + automation + risk-targeted approval; criticism of centralized CAB review for every change.  
**Limitation:** external/regulatory approval can still be mandatory.

## [VCS01] — GitHub Docs — Protected branches / merge queue

**URL:** https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches  
**Evidence role:** official platform semantics/example.  
**Used for:** examples of enforced review/status checks, merge queue and protected baselines.  
**Limitation:** GitHub-specific; equivalent controls exist elsewhere.

## [PROV01] — GitHub Docs — Artifact attestations

**URL:** https://docs.github.com/en/actions/concepts/security/artifact-attestations  
**Evidence role:** official platform implementation example.  
**Used for:** build provenance metadata and explicit warning that attestation is not proof of artifact security.  
**Limitation:** GitHub-specific and its SLSA implementation details may lag the newest SLSA spec version.

## [VER01] — Semantic Versioning 2.0.0

**URL:** https://semver.org/  
**Status:** 2.0.0 specification.  
**Evidence role:** open versioning convention.  
**Used for:** compatibility versioning where a public API is explicitly declared.  
**Limitation:** not a universal product/build/deployment version scheme.

## [GITOPS01] — OpenGitOps Principles v1.0.0

**URL:** https://opengitops.dev/  
**Evidence role:** open GitOps definition.  
**Used for:** declarative, versioned/immutable, pull-based, continuously reconciled GitOps semantics.  
**Limitation:** implementation architecture for suitable systems, not a universal CM requirement.

## [AI01] — GitHub Docs — Review AI-generated code

**URL:** https://docs.github.com/en/copilot/tutorials/review-ai-generated-code  
**Evidence role:** current official tool-safety guidance.  
**Used for:** functional checks, static analysis, context/intent review and human oversight of AI-generated change.  
**Limitation:** GitHub/Copilot-specific practical guidance, not independent causal proof.

## [AI02] — NIST AI 200-3 — ARIA Evaluation Planning Manual

**URL:** https://www.nist.gov/publications/aria-evaluation-planning-manual-elements-aria-style-ai-evaluations  
**Status:** Published 18 September 2026.  
**Evidence role:** current government AI-evaluation guidance.  
**Used for:** multi-method AI evaluation combining model testing, red teaming and user testing.  
**Limitation:** evaluates AI applications broadly; exact coding-agent workflow controls remain context-specific.

## [REVIEW01] — Sadowski et al. — Modern Code Review: A Case Study at Google

**URL:** https://research.google/pubs/modern-code-review-a-case-study-at-google/  
**Evidence role:** large-scale industrial empirical research.  
**Used for:** modern review as code improvement, defect detection and knowledge transfer.  
**Limitation:** Google tooling/culture/scale differ from other organizations.

## [REVIEW02] — Bacchelli & Bird — Expectations, Outcomes, and Challenges of Modern Code Review

**URL:** https://www.microsoft.com/en-us/research/publication/expectations-outcomes-and-challenges-of-modern-code-review/  
**Evidence role:** industrial empirical study.  
**Used for:** review's knowledge/awareness role and the importance of understanding changes.  
**Limitation:** observational/qualitative evidence; does not make manual review universally sufficient.

---

# 70. Research audit trail

## Sources deliberately rejected as current normative baselines

### IEEE 828-2012 as “the current CM standard”
Rejected. IEEE marks it `Inactive-Reserved` [CMHIST01].

### NIST SSDF 1.2 as final
Rejected. Rev.1 remains an Initial Public Draft [SEC02].

### One universal branch model
Rejected. DORA supports frequent integration/trunk-style mechanisms, while the current lifecycle standard is methodology-neutral and real products can require maintained release lines [LIFE01][DORA03].

### SemVer as universal
Rejected. SemVer explicitly assumes a public API [VER01].

### GitOps as universal configuration management
Rejected. OpenGitOps defines a specific declarative/pull/reconciliation architecture [GITOPS01].

### Central manual approval as universal safety gate
Rejected. Current DORA guidance recommends peer review/automation for routine change and targeted scrutiny for higher risk [DORA04].

---

# 71. V2 mechanical and logical QA requirements

Before publication, verify mechanically:

- all evidence IDs used are defined;
- no duplicate evidence IDs;
- Markdown fences are balanced;
- no unresolved drafting markers;
- every `MUST` has a meaningful control purpose;
- no statement represents IEEE 828 as active;
- no statement represents SSDF 1.2 as final;
- no statement makes trunk/GitOps/SemVer/CAB universal;
- rollback claims include state compatibility;
- AI workflow does not treat self-review as independent assurance;
- emergency path includes baseline reconciliation;
- release identity includes configuration, not code alone.

---

## 71.1 Mechanical audit result for this release

```text
source IDs used: 31
source IDs defined: 31
missing source definitions: 0
unused source definitions: 0
Markdown fence markers: 90
Markdown fences balanced: yes
unresolved drafting markers: 0
```

The audit is structural evidence only. It does not substitute for the field-validation requirement stated in the release-status note.

# 72. One-page operating standard

If only one page is used, use this:

1. **Start every material change from explicit intent, acceptance conditions and protected invariants.**
2. **Classify consequence before selecting review, testing, approval and traceability.**
3. **Treat lifecycle phases as responsibilities, not a waterfall.**
4. **Identify every material configuration item and its canonical authority.**
5. **Keep active development close to an authoritative integrated baseline; frequent small integration is the strong default.**
6. **Make deterministic checks automatic and fast; keep humans focused on semantics, risk and understanding.**
7. **Treat CI as evidence, never as a release certificate.**
8. **Bind every material release to identifiable source, build and configuration state.**
9. **Use immutable artifact/revision identity underneath human version labels.**
10. **Prefer promotion of the same identified artifact across environments; if rebuilding is necessary, make each target build controlled and reproducible enough for its risk.**
11. **Treat runtime configuration, flags, IaC, policy, schemas, CI/CD and AI instruction/model configuration as engineering state when they can change behavior.**
12. **Keep secret values outside ordinary source control.**
13. **Detect material configuration drift; reconcile automatically only when safe.**
14. **Use SemVer only when its public-API compatibility model actually fits.**
15. **Use GitOps only when declarative desired state, pull and continuous reconciliation actually fit.**
16. **Review close to the work; add higher approvals only for real risk/business/regulatory decisions.**
17. **Do not force one branch model; protect small batches, frequent integration and bounded divergence.**
18. **Build and release from controlled inputs; use provenance/reproducibility/signing as evidence layers according to risk.**
19. **Co-design schema/data evolution with deployment order and recovery.**
20. **Choose rollback, roll-forward, restore or compensation from state compatibility—not habit.**
21. **Separate deploy from release when independent exposure control reduces risk.**
22. **For material change, verify production behavior after deployment and correlate telemetry with deployment/configuration identity.**
23. **Emergency change is expedited, not exempt; reconcile the canonical baseline afterward.**
24. **Automate traceability instead of making humans duplicate metadata.**
25. **Treat AI-generated code/config/migrations/actions as candidate work until independently verified.**
26. **Do not let the same AI generation process become its sole reviewer or authority for consequential change.**
27. **Enforce agent permissions outside prompts and scale autonomy with consequence.**
28. **Measure useful delivery outcomes together with instability, rework, configuration health and recovery.**
29. **Remove gates that do not prevent a defined failure or satisfy a real obligation.**
30. **Close every material change with production evidence and learning, not merely a successful deployment.**

---

# 73. Final V2 verdict

The strongest available evidence does **not** support one universal SDLC, one branch model, one approval process, one versioning scheme or one configuration-delivery architecture.

It does support a stricter set of engineering invariants:

```text
EXPLICIT INTENT
→ RISK-PROPORTIONAL ASSURANCE
→ CONTROLLED CONFIGURATION
→ SMALL / FREQUENT INTEGRATION
→ INDEPENDENT VERIFICATION
→ IDENTIFIED BUILD
→ TRACEABLE RELEASE
→ STATE-AWARE RECOVERY
→ PRODUCTION VERIFICATION
→ LEARNING
```

The V2 standard is therefore intentionally:

- **stricter** about identity, authority, traceability, configuration, evidence and recovery;
- **less dogmatic** about branches, tools, ceremonies and deployment patterns;
- **stronger** for AI-assisted and agentic workflows without creating an entirely separate AI SDLC;
- **lighter** for low-risk change and **stronger** for consequential change;
- built so that a human team, coding assistant or bounded engineering agent can operate inside the same assurance system.

**Status:** `REVIEWED`  
**Next promotion:** `TESTED` after independent real-team field execution in at least:
1. an ordinary continuously delivered web/service system;
2. a stateful migration/high-impact production change;
3. an AI-assisted or agentic engineering workflow;
4. a multi-release or high-assurance environment.

Only after defects from those tests are closed or explicitly accepted should this playbook be promoted to `VALIDATED`.
