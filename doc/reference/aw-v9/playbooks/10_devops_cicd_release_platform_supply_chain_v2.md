# 10 — DevOps, CI/CD, Release, Platform & Software Supply Chain — V2

> **Research-reviewed, falsification-weighted specialist engineering standard for controlled software change, build integrity, release safety, platform enablement, and software supply-chain assurance**

```yaml
document_id: SW-AI-ENG-10
title: DevOps, CI/CD, Release, Platform & Software Supply Chain
version: 2.0-RC1
status: REVIEWED
created: 2026-09-27
last_updated: 2026-09-27
last_reviewed: 2026-09-27
evidence_cutoff: 2026-09-27
canonical_language: English
owner_role: Software Delivery & Platform Governance
primary_archetype: Operating + Capability + Execution + Response
rigor_default: R3 / CONTROLLED for production delivery systems
volatility: FAST
inherits:
  - MPS-001 — Master Playbook Standard v2.0-RC1
  - Universal Software & AI Engineering Master Playbook v2.0
supersedes:
  - SW-AI-ENG-10 v1.0-DRAFT
review_cadence: quarterly plus event-driven
review_triggers:
  - material change to SLSA, SSDF, SPDX, CycloneDX, TUF, Sigstore, DORA, OCI, or relevant regulatory baselines
  - significant CI/CD or software-supply-chain incident
  - material change to build, signing, artifact, deployment, platform, or identity architecture
  - repeated release or rollback failure
  - new evidence falsifying a normative default
```

**Status note.** This V2 is the corrected successor to the V1 draft and its dedicated falsification audit. It is deliberately `REVIEWED`, not `TESTED` or `VALIDATED`. Under Playbook 00, research review and internal verification are not substitutes for representative non-author execution and real-use validation. Promotion to `TESTED` requires execution of the defined scenarios; promotion to `VALIDATED` requires the applicable Definition of Done and field evidence.

---

# Executive standard

A software delivery system is a **privileged production system and chain of custody**. It converts source, configuration, dependencies, identities, build instructions, and policy into artifacts, release evidence, deployments, and ultimately user-visible behavior.

The delivery problem is therefore not “how do we automate deployment?” It is:

> **How do we preserve trustworthy identity, controlled authority, verifiable evidence, bounded blast radius, and recoverability while software changes continuously?**

The canonical chain is:

```text
INTENT / APPROVED CHANGE
→ SOURCE + CONFIGURATION REVISION
→ CONTROLLED BUILD INPUTS
→ BUILD EXECUTION
→ CONTENT-IDENTIFIED ARTIFACT
→ EVIDENCE
    ├─ tests / verification
    ├─ provenance / attestations
    ├─ SBOM / dependency inventory
    ├─ vulnerability / VEX context
    └─ signature / identity evidence
→ ARTIFACT REPOSITORY / DISTRIBUTION
→ CONSUMER-SIDE POLICY VERIFICATION
→ PROMOTION / RELEASE AUTHORIZATION
→ DEPLOYMENT
→ RELEASE / EXPOSURE
→ PRODUCTION VERIFICATION
→ RECOVERY / TRUST RESET IF NEEDED
→ LEARNING
```

The durable V2 doctrine is:

1. **Treat CI/CD, artifact repositories, signing services, deployment controllers, and platform control planes as production infrastructure.**
2. **Preserve exact identity.** A release decision MUST be attributable to an immutable content identity, not only a mutable name, branch, or tag.
3. **Build from controlled inputs and preserve lineage.** A build result without reconstructable source, dependency, builder, and workflow context is weak evidence.
4. **Promote evidence with the artifact.** Tests, provenance, SBOM, signing, vulnerability context, approvals, and policy decisions answer different questions and MUST NOT be collapsed into one “trusted” badge.
5. **Verify at the consumer boundary.** Producer-generated evidence has little assurance value if deployment/promotion systems do not validate the evidence under an explicit policy.
6. **Separate cryptographic validity from authorization.** “Signature valid” means a cryptographic relation verified; it does not by itself mean the signer was authorized, the build was safe, or the artifact should be released.
7. **Prefer short-lived, scoped workload identity where practical.** Long-lived CI secrets increase compromise persistence; identity federation reduces that class of exposure but creates trust in the identity provider and policy conditions.
8. **Separate deploy from release when it reduces risk.** Exposure controls, canaries, rings, flags, and routing are useful only when health can be attributed and evaluated.
9. **Progressive delivery is an experiment, not a ritual.** A canary is useful only if the cohort, observation window, signal quality, state interactions, and stop criteria can reveal the failure being managed.
10. **Recovery is a state problem.** Rollback, roll-forward, disable, compensate, restore, or quarantine must be selected from actual state compatibility and failure mode.
11. **Build internal platforms as products, not mandatory abstraction layers.** Self-service and guardrails should reduce cognitive load and risk without creating a “golden cage.”
12. **Measure safe valuable flow, not pipeline activity.** Deployment count, gate count, scan count, SBOM count, or signature count can all be high while delivery quality is poor.

The practical goal is:

> **Make valuable change small enough to reason about, fast enough to learn from, controlled enough to trust, observable enough to detect harm, and recoverable enough to contain failure.**

---

# V2 research and falsification verdict

V1 was challenged against current primary standards/specifications, mature operational evidence, and adversarial scenarios spanning ordinary SaaS, high-assurance systems, stateful migrations, desktop/mobile/firmware delivery, air-gapped operation, open-source and proprietary dependencies, multi-repository releases, compromised CI/signing infrastructure, and AI/agent-driven pipelines.

The audit result was:

> **`PASS_WITH_MATERIAL_REVISIONS`**

No fundamental architecture break was found. The central model survived:

```text
CONTROLLED SOURCE
→ CONTROLLED BUILD
→ IDENTIFIED ARTIFACT
→ VERIFIED EVIDENCE
→ CONTROLLED PROMOTION
→ OBSERVABLE RELEASE
→ COMPATIBLE RECOVERY
```

However, V1 contained several defaults that were too easy to cargo-cult. V2 corrects them:

- SLSA levels are no longer mapped mechanically to application criticality.
- Trunk-based development remains a strong delivery pattern, not a universal branch law.
- “Build once, promote many” is refined to preserve **artifact lineage** across legitimate platform-specific outputs.
- Reproducible and hermetic builds are separated; neither is equated with security.
- Signing is explicitly separated into cryptographic validity, signer identity, authorization, provenance, and policy.
- SBOM completeness, freshness, correction, and VEX/context workflows are first-class.
- The artifact repository and build cache are explicit security boundaries.
- Pipeline checks have `PASS / FAIL / ERROR / UNAVAILABLE / EXCEPTION` semantics; scanner outage is not silently equivalent to success or failure.
- Canary and automatic rollback require an evaluability/compatibility test before use.
- Platform engineering is treated as an internal product whose adoption and outcomes must be measured, not an inevitable maturity step.
- Supply-chain incident recovery requires a clean trust path, not merely rebuilding through the same possibly compromised system.
- AI/agent outputs can propose changes but cannot authorize or independently validate high-consequence pipeline actions.

---

# 1. Purpose

This playbook defines the engineering standard for the controlled path from accepted software change to safely operated release.

It exists to make delivery systems:

- fast enough to support frequent learning;
- deterministic enough where determinism matters;
- secure enough for their threat model;
- traceable enough for investigation and audit;
- reproducible enough where independent verification matters;
- observable enough to diagnose release behavior;
- recoverable enough to bound damage;
- maintainable enough to evolve;
- usable enough that teams choose the safe path voluntarily;
- compatible with human, automated, and AI-assisted execution.

It is a **specialist standard**, not a vendor cookbook. It defines invariants, decision logic, assurance expectations, anti-patterns, Plays, and templates. Vendor-specific implementation belongs in profiles/runbooks.

---

# 2. Scope and non-scope

## 2.1 In scope

This standard covers:

- source and release-path controls relevant to delivery;
- version/control of production-affecting definitions;
- continuous integration;
- build engineering;
- build caches and build workers;
- dependencies, plugins, actions, base images, packages, models, and suppliers;
- artifact identity, storage, immutability, retention, and promotion;
- provenance and attestations;
- SBOM generation, distribution, correction, and vulnerability context;
- signing and signature verification;
- trust roots, signing identities, and keyless/key-based signing;
- CI/CD workload identity and secret handling;
- environment semantics and configuration;
- feature flags and release configuration;
- continuous delivery and continuous deployment;
- deployment vs release;
- canary, rolling, blue/green, ring, shadow, dark, and flag-based exposure;
- rollback, roll-forward, disable, compensation, restore, and quarantine;
- schema/data/configuration migration interactions with delivery;
- platform engineering and internal developer platforms;
- GitOps/reconciliation as a contextual operating pattern;
- policy-as-code and release policy;
- change approval, separation of duties, and break-glass release;
- delivery observability and runtime identity verification;
- software supply-chain incident response;
- AI/agentic engineering inside delivery systems;
- delivery metrics and improvement.

## 2.2 Out of scope but interfacing

This standard does not replace:

- `03 — Engineering Workflow, SDLC & Configuration Management`;
- `05 — Verification, Validation, Testing & Quality Engineering`;
- `06 — Security Engineering`;
- `08 — Reliability, Resilience, Observability & SRE`;
- `11 — Maintenance, Evolution, Migration & Technical Debt`;
- `12 — Data, Database & Storage Engineering`;
- `13 — API, Integration & Distributed Systems Engineering`;
- `17 — Cloud, Infrastructure, Networking & IaC`;
- `18 — AI / ML / LLM Systems Engineering`;
- `19 — Agentic AI Engineering`;
- `20 — Blockchain & Smart Contract Engineering`;
- `21 — Systems, Embedded & Real-Time Engineering`;
- applicable regulatory, safety, medical, automotive, aviation, financial, or critical-infrastructure standards.

Those overlays MAY strengthen or replace a local default in this playbook when they have scoped authority.

---

# 3. How to use this playbook

Use four reading modes.

## Layer 1 — Orientation

Use §§1–7 to understand the delivery system, criticality, trust boundaries, and Golden Standards.

## Layer 2 — Decision

Use the decision frameworks in §§31–33 when choosing:

- CI blocking vs non-blocking checks;
- build strategy;
- SLSA posture;
- signing model;
- SBOM/VEX policy;
- environment strategy;
- progressive rollout mechanism;
- rollback vs roll-forward;
- platform capability;
- GitOps;
- manual approval/separation of duties.

## Layer 3 — Execution

Use the Plays and checklists in §§34–36 for repeatable delivery outcomes.

## Layer 4 — Assurance and learning

Use §§37–42 for traceability, audit, evidence, versioning, review, and source status.

For high-consequence work, do not use a checklist as a substitute for specialist competence or domain-specific assurance.

---

# 4. Normative and evidence language

This playbook inherits the Playbook 00 claim taxonomy:

| Label | Meaning in this playbook |
|---|---|
| `REQ` | Externally applicable requirement with stated authority/scope |
| `EST` | Well-established practice supported across strong relevant evidence |
| `DEF` | Recommended default with explicit exceptions |
| `CTX` | Context-dependent mechanism or pattern |
| `EMG` | Emerging practice whose evidence/maturity is incomplete |
| `HOUSE` | Deliberate internal standard derived from evidence but not externally standardized |
| `EXP` | Experiment/hypothesis to test locally |
| `UNK` | Important unresolved uncertainty |

Evidence strength and rule strength remain separate. A `MUST` can arise from a scoped security or organizational control. A mature external practice can still remain `CTX`.

## 4.1 Source-status discipline at the cutoff

At 27 September 2026:

- **SLSA v1.2** is the approved/current SLSA specification. Build and Source tracks are current; Build Environment and Dependency work remains draft/watch material. [SLSA01][SLSA02][SLSA03]
- **NIST SP 800-218 / SSDF 1.1** remains the final baseline. SP 800-218 Rev.1 / SSDF 1.2 remains an Initial Public Draft. [NIST01][NIST02]
- NIST NCCoE's 2026 DevSecOps publication is current applied/live guidance, not a final universal architecture standard. [NIST03]
- **NIST SP 1326** was finalized in July 2026 and provides current supplier due-diligence guidance. [NIST04]
- **SPDX 3.0** and **CycloneDX 1.7** are current major software/supply-chain BOM specifications reviewed here. [SPDX01][CDX01]
- CISA's **2025 Minimum Elements for an SBOM** is the current U.S. federal minimum-elements guidance reviewed here. [CISA01]

Every implementation MUST re-check current version/effective status when compliance, procurement, or a security baseline depends on it.

---

# 5. Delivery-system model

The delivery system is a graph of trust transitions, not merely a YAML pipeline.

## 5.1 Canonical objects

```yaml
change:
  intent_id:
  source_revision:
  review_evidence:
  risk_classification:
  related_requirements:

source_revision:
  repository:
  immutable_revision:
  branch_or_tag_alias:
  author_identity:
  reviewer_identities:

build:
  build_id:
  builder_identity:
  workflow_revision:
  external_inputs:
  resolved_dependencies:
  build_environment:
  cache_inputs:
  start_end_time:

artifact:
  artifact_type:
  digest:
  size:
  repository:
  platform_variant_if_any:
  lineage_parent_if_any:

release_evidence_bundle:
  artifact_digest:
  source_revision:
  test_evidence:
  provenance:
  sbom:
  vulnerability_context:
  signature_or_attestation:
  policy_decision:
  exception_records:

promotion:
  from_stage:
  to_stage:
  artifact_digest:
  policy_version:
  actor_or_controller:
  evidence_bundle_digest:

deployment:
  environment:
  artifact_digest:
  config_revision:
  secret_reference_versions:
  deployment_controller:
  desired_state_revision:

runtime_observation:
  observed_artifact_identity:
  observed_config_revision:
  cohort:
  health_signals:
  verification_time:

recovery:
  selected_strategy:
  compatibility_preconditions:
  target_state:
  operator_or_controller:
  verification:
```

## 5.2 Chain-of-custody invariant

For a material running deployment, the organization SHOULD be able to reconstruct:

```text
RUNNING INSTANCE / DISTRIBUTED RELEASE
→ ACTUAL ARTIFACT IDENTITY
→ DEPLOYMENT + CONFIG REVISION
→ PROMOTION DECISION
→ RELEASE EVIDENCE BUNDLE
→ BUILD + BUILDER
→ RESOLVED INPUTS / DEPENDENCIES
→ SOURCE REVISION
→ CHANGE / REVIEW / REQUIREMENT
```

For C3/C4 or regulated systems, gaps in that chain SHOULD be treated as assurance defects, not documentation trivia.

---

# 6. Threat model for software delivery

A delivery threat model SHOULD consider compromise, misuse, error, and ambiguity at each stage.

| Stage | Representative failures / attacks |
|---|---|
| Source | stolen maintainer identity, bypassed review, malicious contributor, compromised SCM, history rewrite |
| Workflow | privileged pipeline changed, untrusted input interpolated into commands, dangerous pull-request trigger |
| Dependency | malicious update, typosquat, compromised maintainer, transitive substitution, mutable base image |
| Builder | poisoned runner, shared-state leakage, malicious build step, host compromise, hidden input |
| Cache | poisoned cache entry, cross-tenant leakage, stale/unverified cache restore |
| Artifact | replacement, mutable tag confusion, repository compromise, retention deletion |
| Evidence | forged/stale/mismatched provenance or SBOM, wrong subject digest, unverified attestation |
| Signing | stolen key, wrong identity, compromised identity provider/CA, unauthorized signer |
| Promotion | policy bypass, stale exception, approval spoofing, wrong artifact selected |
| Deploy controller | over-privileged controller, drift, wrong environment, admission mutation |
| Runtime | mixed versions, image substitution, sidecar/injection mutation, config drift |
| Update client | rollback/freeze/mix-and-match/wrong-target update, malicious mirror |
| Recovery | re-signing compromised output, rebuilding through compromised trust path |

The threat model MUST distinguish **integrity**, **authorization**, **availability**, and **recoverability**. A control that improves one can weaken another; for example, fail-closed scanner policy improves integrity only if scanner outages do not create unacceptable delivery or incident-response risk.

---

# 7. Criticality and assurance

This playbook inherits the C0–C4 engineering criticality model.

| Level | Typical delivery posture |
|---|---|
| `C0 — Experimental` | Disposable/non-production; basic hygiene; no production-assurance claim |
| `C1 — Ordinary` | Automated build/test, controlled artifact identity, ordinary access/dependency/recovery controls |
| `C2 — Material` | Stronger provenance, protected CI identity, tested recovery, progressive exposure where evaluable, deeper dependency controls |
| `C3 — High assurance` | Hardened build path, independent verification, stronger separation, explicit signing/trust policy, retained evidence, controlled promotion |
| `C4 — Safety/mission critical` | Applicable domain-certified configuration/release assurance governs; this playbook is a baseline only |

Required delivery assurance increases with:

```text
CONSEQUENCE
× EXPOSURE
× IRREVERSIBILITY
× SUPPLY-CHAIN DEPENDENCE
× BLAST RADIUS
× AUTOMATION / AUTONOMY
× UPDATE DISTRIBUTION REACH
÷ (DETECTABILITY × RECOVERABILITY)
```

This is not arithmetic. It is a forcing function for judgment.

## 7.1 Do not map criticality mechanically to SLSA

SLSA provides supply-chain guarantees and track levels; application criticality is a broader system-risk concept. V2 therefore does **not** state “C2 = SLSA Build L2” or similar.

Instead ask:

1. What supply-chain threat must be mitigated?
2. Which build/source guarantees are material?
3. Can the selected ecosystem produce and verify those guarantees?
4. What residual risk remains outside SLSA?
5. Does the evidence justify the cost/complexity?

---

# 8. Golden Delivery Standards

These are the root rules. `MUST`/`SHOULD` strength is deliberate; context labels prevent cargo-cult use.

## 8.1 Source, revision, and change

1. **EST:** Production-affecting source, build definitions, deployment definitions, migrations, and policy SHOULD have controlled version history.
2. **DEF:** Every material release candidate MUST identify an immutable source revision or equivalent controlled source snapshot.
3. **DEF:** Protect the canonical integration/release path from unauthorized direct mutation.
4. **DEF:** Review material changes in proportion to consequence; automate mechanical checks and preserve human attention for semantics/risk.
5. **DEF:** Prefer changes small enough to review, integrate, observe, and recover without fragmenting one coherent invariant.
6. **CTX:** Frequent integration is a strong default; the exact branching model remains contextual.
7. **CTX:** Release branches MAY be appropriate for supported release lines, regulated baselines, patch trains, or products with long distribution cycles.
8. **DEF:** Production configuration and feature-flag definitions are executable state and MUST receive change control proportionate to impact.

## 8.2 Dependencies and suppliers

9. **EST:** Build tools, packages, actions/plugins, base images, compilers, model artifacts, hosted services, and suppliers are part of the delivery attack surface.
10. **DEF:** Pin/lock dependencies where unreviewed upstream movement can alter a material build.
11. **DEF:** Pin privileged CI actions/plugins/images to immutable identifiers when the ecosystem supports it. [GH01]
12. **DEF:** Pair pinning with monitoring and deliberate update; “never update” is not supply-chain safety.
13. **DEF:** Dependency automation MAY propose updates but MUST NOT silently weaken required verification.
14. **CTX:** Material supplier due diligence SHOULD scale with privilege, data access, resilience dependence, provenance, concentration, support capability, and exit cost. [NIST04]
15. **DEF:** New dependency evaluation SHOULD compare third-party risk with bespoke implementation/maintenance/security risk.
16. **DEF:** Remove unused dependencies and obsolete build tooling; dormant code still creates maintenance and attack surface.

## 8.3 Build

17. **EST:** A production build SHOULD be automated, versioned, observable, and isolated from undocumented developer workstation state.
18. **DEF:** Build outputs MUST have stable content identity suitable for verification/promotion.
19. **DEF:** Record material external parameters and resolved dependencies in provenance/evidence where assurance requires it. [SLSA02]
20. **DEF:** Treat build cache entries as inputs with trust, isolation, invalidation, and provenance implications.
21. **CTX:** Hermetic builds are valuable when hidden/environmental inputs materially threaten reproducibility or integrity; they are not universally mandatory.
22. **CTX:** Reproducible builds strengthen independent consistency verification where useful; reproducibility does not establish source safety. [REPRO01]
23. **DEF:** Non-determinism that affects verification SHOULD be intentional, bounded, and documented.
24. **DEF:** User-controlled/untrusted build steps MUST NOT have unbounded access to signing credentials, production credentials, or unrelated tenants.

## 8.4 Continuous integration

25. **EST:** CI SHOULD make integration defects cheap to discover through frequent integration and fast feedback. [DORA02]
26. **DEF:** Blocking checks SHOULD be fast, deterministic enough for reliable gating, and tied to a named release risk.
27. **DEF:** Deeper/expensive checks MAY run later or asynchronously when they need not block every commit.
28. **DEF:** Every gate MUST define semantics for `PASS`, `FAIL`, `ERROR`, `UNAVAILABLE`, and approved `EXCEPTION`.
29. **DEF:** A broken required check MUST have a named owner/path; “rerun until green” is not a reliability strategy.
30. **DEF:** Flaky gates are defects because they corrupt trust in the release decision.
31. **DEF:** Do not weaken tests, scanners, or policy solely to make CI pass without explicit risk acceptance.
32. **HOUSE:** A green pipeline is release evidence, not proof of releasability.

## 8.5 Artifact and repository

33. **EST:** Material releases SHOULD use immutable/content-addressed artifact identity where ecosystem support exists. [OCI01]
34. **DEF:** Mutable tags, channels, and human-friendly versions are aliases; security/promotion decisions SHOULD resolve to immutable identity.
35. **DEF:** The artifact repository/registry is a security boundary with access, retention, immutability, audit, availability, and compromise-recovery requirements.
36. **DEF:** Promotion SHOULD reference the exact artifact lineage that was verified.
37. **DEF:** Rebuilding for each environment SHOULD be avoided when the same deployable can be configured safely at runtime.
38. **CTX:** When platform-specific artifacts are legitimately required, preserve a common source/build lineage and independently identify/verify each output rather than pretending the bytes are identical.
39. **DEF:** Release evidence SHOULD remain bound to the subject artifact digest.

## 8.6 Provenance, attestations, SBOM, and vulnerability context

40. **EST:** Provenance answers how/where an artifact was produced; it does not prove correctness or vulnerability absence. [SLSA01]
41. **DEF:** Material provenance SHOULD identify source, builder, build process, relevant external parameters, dependencies, and artifact subject as justified by risk.
42. **DEF:** Promotion/deployment policy SHOULD verify provenance instead of only storing it.
43. **EST:** An SBOM is component/transparency evidence, not a security certificate. [SPDX01][CDX01]
44. **DEF:** SBOM generation SHOULD be tied to the relevant release/build and updated when the component set changes materially. [CISA01]
45. **DEF:** SBOM policy SHOULD define component depth, known-unknown/redaction handling, correction, retention, access, and distribution.
46. **CTX:** VEX or equivalent contextual vulnerability status MAY reduce false urgency by expressing whether a known vulnerability affects the product, but VEX itself requires trustworthy analysis. [VEX01]
47. **DEF:** Vulnerability presence MUST NOT be collapsed mechanically into “release forbidden” without severity/exposure/exploitability/context and applicable policy.
48. **DEF:** Evidence consumers MUST verify that the evidence subject matches the artifact under decision.

## 8.7 Signing and trust

49. **EST:** A valid signature proves a cryptographic relation to a key/certificate/identity under a verification process; it does not alone prove authorization or safety.
50. **DEF:** Signing policy MUST define who/what may sign which artifact class, under which workflow/context, and what verifiers must check.
51. **CTX:** Keyless signing using short-lived identity can reduce long-lived key management burden where identity-provider, CA, transparency, and policy trust are acceptable. [SIG01]
52. **CTX:** Long-lived/offline/threshold keys MAY be preferable in disconnected, long-lived, regulatory, firmware, or high-assurance trust models.
53. **DEF:** High-assurance build and signing authority SHOULD be separable so compromise of arbitrary build steps cannot silently issue trusted release signatures.
54. **DEF:** Signing trust roots and identity conditions MUST have rotation/revocation/compromise handling.
55. **CTX:** Software update systems exposed to rollback/freeze/mirror/mix-and-match attacks SHOULD evaluate TUF-like signed metadata and role separation rather than relying on one artifact signature. [TUF01]

## 8.8 Identity, secrets, and privileged execution

56. **EST:** CI/CD is privileged production infrastructure and SHOULD use least privilege.
57. **DEF:** Prefer short-lived workload identity/federation over duplicated long-lived cloud secrets where supported and correctly constrained. [GH02]
58. **DEF:** Identity federation MUST bind trust conditions to the intended repository/workflow/environment/subject as supported; OIDC issuance alone is not authorization.
59. **DEF:** Untrusted pull requests, forks, generated content, package scripts, and build logs MUST NOT silently cross into privileged execution.
60. **DEF:** Secrets MUST NOT be exposed to untrusted build contexts or logged.
61. **DEF:** Privileged runners/builders SHOULD have isolation and lifecycle controls proportionate to tenant/trust mixing.
62. **DEF:** Emergency credentials/break-glass paths MUST be bounded, auditable, revocable, and reviewed after use.

## 8.9 Environment and configuration

63. **DEF:** Preserve semantic parity for properties that affect correctness; perfect byte-for-byte environment identity is not a universal requirement.
64. **DEF:** Environment differences that can invalidate tests MUST be visible and treated as test gaps.
65. **DEF:** Environment-specific configuration SHOULD be separated from the immutable application artifact when practical. [DORA03]
66. **DEF:** Configuration requires schema/validation, ownership, change history, startup/failure semantics, and secrets separation.
67. **DEF:** Production changes to feature flags, routing, policy, and configuration SHOULD be attributable and observable.
68. **DEF:** Staging is one evidence source; it MUST NOT be represented as proof of production safety.

## 8.10 Release and progressive delivery

69. **EST:** Continuous delivery means keeping software in a releasable state and being able to release on demand; continuous deployment automatically deploys qualifying changes. [DORA01]
70. **DEF:** Distinguish `build`, `deploy`, and `release` when exposure control materially changes risk.
71. **DEF:** A release decision SHOULD reference an exact artifact, configuration, policy version, and evidence bundle.
72. **DEF:** Production deployment MUST produce enough telemetry to correlate behavior with the deployed artifact/configuration.
73. **CTX:** Progressive delivery SHOULD be used when production evidence can reveal failures with acceptably bounded exposure.
74. **DEF:** Before canarying, verify that cohort selection, signal attribution, observation time, traffic volume, state sharing, and stop criteria can detect the target failure. [SRE01]
75. **CTX:** Blue/green is useful for environment/traffic cutover but does not make state rollback automatically safe.
76. **CTX:** Feature flags can decouple deploy/release but require ownership, default, scope, expiry, interaction, and cleanup control.
77. **DEF:** Promotion/rollback automation MUST include anti-flap/hysteresis or equivalent safeguards when noisy signals could oscillate state.

## 8.11 Recovery

78. **EST:** Rollback is safe only when the prior version can interpret current state and external side effects acceptably.
79. **DEF:** Preselect recovery options from `rollback`, `roll-forward`, `disable`, `compensate`, `restore`, `quarantine`, or combinations.
80. **DEF:** Schema/data/config changes MUST be co-designed with rollout/recovery.
81. **DEF:** Automatic rollback MUST require a trustworthy trigger and state-compatible recovery path.
82. **DEF:** When rollback can amplify corruption or incompatibility, prefer roll-forward or compensation.
83. **DEF:** Recovery completion MUST be verified against user/system outcomes, not merely deployment-controller success.
84. **DEF:** Repeated failed releases SHOULD trigger system-level analysis, not only tighter human approval.

## 8.12 Platform engineering and GitOps

85. **CTX:** Build an internal platform only when repeated developer/operator needs justify the product and operational cost.
86. **DEF:** Platform capabilities SHOULD be designed as an internal product with user research, discoverability, documentation, reliability, feedback, and lifecycle ownership. [DORA04][CNCF01]
87. **DEF:** Prefer self-service paved/golden paths that encode safe defaults while preserving controlled escape paths for legitimate needs.
88. **DEF:** A platform MUST NOT hide critical operational/security semantics so completely that teams cannot reason about failure or ownership.
89. **DEF:** Measure platform outcomes such as task success, lead time, reliability, adoption, cognitive load, support burden, and team autonomy—not catalog size.
90. **CTX:** GitOps is a useful reconciliation pattern when declarative/versioned desired state and pull/reconcile semantics fit the system; it is not universal. [GITOPS01]
91. **DEF:** Platform control planes and shared templates/actions are supply-chain dependencies and require their own availability, security, versioning, and incident response.
92. **DEF:** Golden paths SHOULD have version/lifecycle/exception feedback so today's default does not become tomorrow's frozen constraint.

## 8.13 Governance, AI, and learning

93. **DEF:** Manual approval SHOULD be used where competent judgment, legal authority, or separation of duties adds evidence—not as ceremonial delay.
94. **DEF:** Deterministic policy/checks SHOULD be automated when automation is trustworthy and reduces error/latency.
95. **DEF:** Release exceptions require reason, scope, owner, compensating controls, expiry/review trigger, and retained evidence.
96. **DEF:** DORA metrics and other delivery metrics are diagnostic signals, not individual/team quotas. [DORA05]
97. **DEF:** AI-generated pipeline/configuration/deployment changes are untrusted production-affecting code until independently verified.
98. **DEF:** Model output is not authorization; privileged actions require policy/enforcement outside the model.
99. **DEF:** AI agents MUST NOT self-approve high-consequence changes using only their own generated assessment.
100. **DEF:** Delivery incidents, near misses, exceptions, and repeated friction SHOULD feed changes to tooling, platform, policy, training, or architecture.

---

# 9. Source and revision control

## 9.1 Production-affecting state

Version/control, as applicable:

- application source;
- infrastructure definitions;
- CI workflow definitions;
- build scripts/toolchain manifests;
- deployment manifests;
- policy-as-code;
- database/schema migrations;
- configuration schemas/defaults;
- feature-flag definitions;
- release metadata;
- dependency lockfiles;
- container/base-image references;
- generated artifacts only when their governance requires source retention.

DORA guidance treats production-affecting configuration and scripts as part of version control and traceability, while the engineering master standard already requires production configuration to be controlled engineering state. [DORA03][ENG00]

## 9.2 Change identity

A material change SHOULD carry:

```yaml
change_id:
intent_or_requirement:
risk_classification:
source_revision:
affected_artifacts:
migration_impact:
security_privacy_impact:
release_strategy:
recovery_strategy:
reviewers:
exceptions:
```

## 9.3 Branching decision

No one branching model is mandatory.

Prefer lower divergence when:

- integration conflicts are frequent;
- teams deliver continuously;
- automated verification is strong;
- incomplete work can be safely hidden/decoupled.

Use additional release/maintenance branches when:

- multiple supported versions require independent servicing;
- regulatory baselines require controlled stabilization;
- distribution cycles are long;
- hotfix isolation is required;
- integration and release timing are materially decoupled.

The invariant is **controlled integration with understandable divergence**, not “everyone must use trunk.”

---

# 10. Dependency and supplier engineering

## 10.1 Dependency decision record

For a material dependency/supplier, assess:

```yaml
need:
alternative_without_dependency:
scope_of_use:
runtime_or_build_time:
privileges:
data_access:
maintenance_activity:
governance:
license:
security_history:
vulnerability_disclosure:
transitive_dependencies:
provenance:
update_strategy:
pin_or_lock_strategy:
supplier_resilience:
concentration_risk:
supply_chain_tiers_if_material:
exit_cost:
replacement_path:
```

NIST SP 1326 supports supplier due diligence that extends beyond package inventory to provenance, resilience, foundational cybersecurity, and supply-chain tiers. [NIST04]

## 10.2 Pinning policy

Use:

```text
PIN / LOCK
+ MONITOR
+ DELIBERATELY UPDATE
+ VERIFY
```

Pinning reduces uncontrolled change. It does not remove:

- compromised upstream releases;
- existing vulnerability;
- maintainer/account takeover;
- dependency abandonment;
- transitive compromise;
- license/support risk.

## 10.3 Automation tiers

Example policy:

| Change | Automation posture |
|---|---|
| low-risk patch, mature package, deterministic tests | MAY auto-open + auto-merge after policy passes |
| security patch with known exploitability | expedite, but preserve risk-relevant verification |
| major version / behavior change | human review + compatibility evidence |
| privileged build/deploy dependency | stronger review, provenance, and rollback plan |
| crypto/auth/security primitive | specialist review where material |
| unmaintained/new/opaque supplier | due diligence or replacement decision |

Dependency bots are workflow accelerators, not independent assurance.

## 10.4 OpenSSF Scorecard

OpenSSF Scorecard MAY be used as one signal for repository practices, but aggregate score MUST NOT become a universal procurement/release truth. Examine the underlying checks and local threat model. [OSSF01]

---

# 11. Build engineering

## 11.1 Build properties

A material build SHOULD be: [SRE02]

- attributable to an exact build invocation;
- attributable to an exact builder identity/environment class;
- based on controlled source revision;
- based on controlled dependency resolution;
- isolated from unintended host state;
- repeatable enough for diagnosis;
- observable on failure;
- content-identifiable;
- capable of emitting provenance/evidence where required.

## 11.2 Controlled inputs

Classify inputs:

```text
DECLARED SOURCE
DECLARED CONFIG / PARAMETERS
RESOLVED DEPENDENCIES
TOOLCHAIN / COMPILER / BASE IMAGE
BUILD SERVICE / RUNNER IMAGE
CACHE CONTENT
NETWORK-FETCHED MATERIAL
TIME / LOCALE / RNG / HOST STATE
SECRETS / IDENTITY
```

Hidden inputs are assurance debt because they can alter output without an obvious source change.

## 11.3 Reproducible vs hermetic

**Reproducible build:** same defined source/build inputs/environment can reproduce the specified artifact bit-for-bit. [REPRO01]

**Hermetic build:** build execution is isolated so undeclared external inputs cannot influence the result, within the defined model.

They are related but different.

- Reproducibility can expose hidden nondeterminism.
- Hermeticity can reduce hidden inputs.
- Neither establishes semantic correctness.
- Neither establishes authorization.
- Neither proves dependencies are trustworthy.

## 11.4 Build once, promote lineage

Default:

> **Produce a canonical artifact once and promote that exact content identity through environments when the runtime/package model supports it.**

Exceptions include:

- architecture-specific native binaries;
- platform-store packaging;
- signed/notarized distribution variants;
- firmware variants;
- compile-time configuration that cannot be removed;
- legally distinct packaging.

In those cases:

> **Preserve common source/build lineage and independently identify every output.**

Do not rebuild casually per environment because it breaks evidence continuity.

## 11.5 Build caches

Caches MUST be threat-modeled when material.

Define:

```yaml
cache_scope:
tenant_isolation:
key_derivation:
writer_permissions:
reader_permissions:
integrity_verification:
expiry:
poisoning_response:
provenance_effect:
```

A cache miss is a performance event. A poisoned cache hit can become a supply-chain event.

## 11.6 SLSA decision

Use SLSA to ask concrete questions about the build/source chain rather than chase a badge.

For material artifacts evaluate:

- Is provenance available?
- Is it authenticated?
- Is the build platform hosted/controlled?
- Can user-defined build steps reach signing secrets?
- Are builds isolated enough to prevent cross-run influence?
- Are source controls/review guarantees relevant?
- Will consumers verify the evidence?

SLSA v1.2 provides the current approved Build and Source track framework; draft future tracks should be treated as watch items. [SLSA01][SLSA02][SLSA03]

---

# 12. Continuous integration architecture

## 12.1 CI objectives

CI exists to:

1. integrate change frequently enough to reduce divergence;
2. produce fast evidence about correctness/integration;
3. protect the canonical branch/release path;
4. build the release candidate through a controlled process;
5. preserve traceability of what was checked.

CI is not “all tests on every commit.”

## 12.2 Check lanes

A practical layered model:

```text
PRE-COMMIT / LOCAL
  formatting, linting, targeted unit checks

PR / CHANGE BLOCKING
  compile/typecheck
  fast deterministic risk-relevant tests
  policy / secret checks
  affected contract/security checks

POST-MERGE / INTEGRATION
  broader integration/system checks
  package/build verification
  heavier static analysis

PRE-RELEASE / RELEASE EVIDENCE
  risk-selected security/performance/migration/compatibility checks
  SBOM/provenance/attestation generation
  release-policy verification

PRODUCTION / PROGRESSIVE
  runtime smoke/health/business invariant checks
  canary/ring evaluation
  actual artifact/config identity verification
```

The exact distribution is contextual.

## 12.3 Gate contract

Every material gate SHOULD define:

```yaml
gate_id:
risk_controlled:
inputs:
subject_artifact_or_revision:
result:
  PASS:
  FAIL:
  ERROR:
  UNAVAILABLE:
  EXCEPTION:
timeout:
retry_policy:
owner:
exception_authority:
evidence_retention:
```

Do not map scanner timeout to `PASS`. Do not always map it to `FAIL` without considering availability/incident-response requirements. Define policy intentionally.

## 12.4 Flakiness

If a gate is nondeterministic enough that engineers normalize reruns:

- identify source of flakiness;
- isolate/quarantine only with owner/expiry;
- distinguish product flakiness from test infrastructure failure;
- repair the trust channel;
- track recurrence.

“Green after third rerun” is not equivalent to one clean pass.

## 12.5 Untrusted vs privileged workflows

Strongly separate:

- untrusted PR/fork evaluation;
- trusted post-merge builds;
- signing;
- production deployment;
- secret-bearing operations.

Untrusted content includes PR text, commit content, build output, logs, package metadata, and AI-generated instructions. It MUST NOT acquire privilege merely by being rendered inside a trusted job.

---

# 13. Artifact identity, repository, and promotion

## 13.1 Identity hierarchy

Prefer:

```text
CONTENT DIGEST / IMMUTABLE OBJECT ID
    ↑ stronger identity
VERSION / RELEASE ID
TAG / CHANNEL / "latest"
BRANCH / HUMAN LABEL
    ↓ weaker alias
```

OCI-style descriptors use content digests as content identifiers and require digest verification when content comes from untrusted sources. [OCI01]

## 13.2 Registry/repository controls

For material artifact repositories define:

- writer identities;
- promotion identities;
- delete/retention policy;
- tag mutability;
- immutability controls;
- digest verification;
- audit log;
- malware/vulnerability scanning role;
- replication/mirror trust;
- backup/restore;
- compromise/quarantine process;
- evidence/attestation storage linkage;
- availability objective;
- cross-tenant isolation where shared.

## 13.3 Promotion

Prefer:

```text
VERIFY ARTIFACT DIGEST
→ VERIFY REQUIRED EVIDENCE
→ EVALUATE POLICY VERSION
→ RECORD POLICY DECISION
→ PROMOTE SAME DIGEST / VERIFIED LINEAGE
```

Promotion is a policy event, not a file-copy ritual.

## 13.4 Release sets

Some systems cannot release safely as one artifact.

Use a **release set** when correctness depends on coordinated versions across:

- multiple services;
- client + server;
- schema + application;
- model + runtime;
- firmware + cloud;
- contract + consumers.

```yaml
release_set_id:
members:
compatibility_matrix:
deployment_order:
partial_success_policy:
recovery_strategy:
```

Avoid inventing a distributed release set when ordinary backward-compatible evolution can remove the coupling.

---

# 14. Release Evidence Bundle

V2 introduces a canonical `Release Evidence Bundle` (`REB`).

The REB is a `HOUSE` object: it is not an external standard. It composes evidence defined by multiple standards/practices.

```yaml
release_evidence_bundle:
  reb_version:
  release_candidate_id:
  artifact_subjects:
    - digest:
      type:
      platform:
  source:
    repository:
    revision:
    review_reference:
  build:
    build_id:
    builder_identity:
    workflow_revision:
    provenance_ref:
  verification:
    test_results:
    security_results:
    compatibility_results:
    migration_results:
    performance_results:
  supply_chain:
    sbom_ref:
    vulnerability_context_ref:
    dependency_policy_result:
  signing:
    signature_or_attestation_refs:
    signer_identity:
    verification_policy:
  release:
    configuration_revision:
    feature_flag_baseline:
    target_environment:
    rollout_strategy:
    recovery_strategy:
  policy:
    policy_version:
    decision:
    exceptions:
  retention:
    evidence_location:
    retention_class:
```

## 14.1 REB rules

- The REB MUST identify exact artifact subjects.
- Evidence MAY be stored separately; the REB can reference immutable evidence.
- Missing evidence MUST be explicit, not silently absent.
- Exceptions MUST identify authority and expiry/review trigger.
- Consumers SHOULD verify the evidence they rely on.
- The REB SHOULD be generated mechanically where possible but remain understandable to competent reviewers.
- The REB MUST NOT be treated as proof that the release is safe; it is an assurance package.

---

# 15. Provenance and attestations

## 15.1 What provenance answers

Provenance can establish:

- what artifact is the subject;
- which builder/build service produced it;
- which source/materials were used;
- which external parameters influenced the build;
- which workflow/process was invoked.

SLSA v1.2 is the primary reviewed specification for build/source provenance expectations. GitHub artifact attestations are one platform-specific example of signed build provenance bound to workflow/repository/commit context. [SLSA01][SLSA02][GH03]

## 15.2 What provenance does not answer alone

It does not prove:

- requirements were correct;
- source was benign;
- tests were sufficient;
- dependencies lacked exploitable vulnerabilities;
- signer was authorized for this release;
- the artifact actually running in production is the intended artifact;
- production configuration is safe.

## 15.3 Attestation verification

Verification policy SHOULD check, as appropriate:

```yaml
subject_digest_matches: true
predicate_type_allowed: true
builder_identity_allowed: true
source_repository_allowed: true
source_revision_policy: passed
workflow_identity_allowed: true
external_parameters_policy: passed
materials_policy: passed
signature_or_certificate_valid: true
identity_claims_match_policy: true
freshness_or_replay_policy: passed
```

## 15.4 in-toto

in-toto MAY be used when the organization needs explicit supply-chain step/actor expectations and link metadata across a multi-step chain. It is a contextual mechanism, not a mandatory layer for every application. [INTOTO01]


---

# 16. SBOM, VEX, and vulnerability-context engineering

## 16.1 SBOM purpose

An SBOM is structured inventory/transparency evidence about components and relationships. SPDX and CycloneDX are current major specifications reviewed for this release. [SPDX01][CDX01]

Use an SBOM to support:

- asset/component discovery;
- vulnerability response;
- licensing/compliance workflows;
- supplier/customer transparency;
- incident scoping;
- dependency investigations;
- release evidence;
- procurement/security review.

Do not use an SBOM as a binary “secure/not secure” certificate.

## 16.2 Minimum operational requirements

For material releases define:

```yaml
sbom_subject:
  artifact_digest:
generation_point:
format_and_version:
component_depth:
transitive_dependency_policy:
generated_components:
container_os_components:
services_if_relevant:
known_unknowns:
redactions:
distribution:
access_control:
retention:
correction_process:
consumer_owner:
```

CISA's 2025 Minimum Elements guidance reinforces release/build freshness, transitive component depth, known-unknown handling, distribution, and correction as operational concerns. [CISA01]

## 16.3 Freshness

An SBOM tied to an earlier component set MUST NOT silently represent a later release.

Generate/update when:

- the released artifact/component graph changes;
- dependency resolution changes;
- a new platform-specific release artifact changes components;
- the prior SBOM is discovered to be materially incomplete or wrong.

A vulnerability database update does not necessarily require regenerating the component inventory; it requires re-evaluating current inventory against new vulnerability intelligence.

## 16.4 Completeness

“Complete” is contextual.

Possible blind spots include:

- dynamically downloaded plugins;
- runtime extensions;
- vendored binaries;
- base OS packages;
- generated code;
- models/model adapters;
- external services;
- package-manager metadata that does not reflect actual shipped content.

Record known gaps instead of claiming false completeness.

## 16.5 VEX and vulnerability state

VEX expresses a product-specific status such as affected, not affected, fixed, or under investigation under a defined profile. CycloneDX and CSAF provide mechanisms relevant to this use. [VEX01]

A vulnerability decision SHOULD distinguish:

```yaml
component_present:
version_matches:
vulnerability_applicable:
reachable_or_exploitable_context:
mitigation_present:
runtime_exposure:
known_exploitation:
fix_available:
fix_risk:
decision:
owner:
revisit_trigger:
```

Do not auto-block solely on CVE count. Do not auto-ignore solely because a VEX says “not affected” without trusting its producer/rationale.

## 16.6 SBOM distribution

SBOMs MAY be:

- public;
- customer-distributed;
- authenticated/private;
- regulator/procurement supplied;
- retained internally only.

Choose based on transparency obligation, customer need, sensitivity, and threat model. “Every SBOM must be public” is not a universal rule.

---

# 17. Signing, verification, and trust

## 17.1 Five separate questions

A robust signing decision asks:

1. **Artifact:** What exact bytes/object are signed?
2. **Cryptography:** Is the signature/certificate/proof valid?
3. **Identity:** Which key/workload/person/organization does the verifier associate with it?
4. **Authorization:** Was that identity permitted to sign/release this artifact in this context?
5. **Provenance/policy:** Does the evidence establish the required source/build/release conditions?

Do not compress these into “signed = trusted.”

## 17.2 Key-based signing

Use persistent/offline/HSM-backed/threshold keys when the trust model benefits from:

- long-lived verifiability independent of an online identity provider;
- disconnected environments;
- regulatory/key-custody requirements;
- firmware or long support windows;
- multi-party release authority;
- explicit organizational key ceremonies.

Controls can include:

- protected key generation;
- HSM/KMS custody;
- least privilege;
- approval/separation;
- rotation;
- revocation;
- timestamping where relevant;
- recovery from lost/compromised keys.

## 17.3 Keyless signing

Sigstore's keyless model uses short-lived certificates bound to an OIDC identity and transparency evidence, reducing persistent private-key handling. [SIG01]

Keyless is attractive when:

- online identity is reliable;
- issuer/subject claims can be strongly constrained;
- transparency is acceptable;
- build identities are ephemeral;
- verifiers can evaluate the trust root/policy.

It is not universally superior. Its trust shifts toward:

- identity provider;
- certificate authority/trust root;
- transparency infrastructure;
- workflow identity conditions;
- verifier policy.

## 17.4 Verification policy

Example:

```yaml
artifact_digest:
signature_scheme:
trusted_root:
allowed_issuers:
allowed_subjects:
allowed_workflows:
source_repository:
required_provenance:
required_builder:
timestamp_or_transparency_policy:
revocation_policy:
exception_policy:
```

Verification MUST occur where the result controls a decision. Storing signatures without verifying them is weak assurance.

## 17.5 Trust-root compromise

A signing incident plan SHOULD answer:

- how trust is revoked/rotated;
- how consumers learn the new trust root;
- which historical artifacts remain acceptable;
- whether timestamps/transparency can bound the compromise;
- how affected signatures/artifacts are quarantined;
- which clean infrastructure may re-sign or rebuild;
- how offline/embedded clients recover.

---

# 18. Secure update and distribution

Artifact signing alone may be insufficient for update systems exposed to malicious mirrors, rollback, freeze, mix-and-match, wrong-target, or compromised-key threats.

TUF is designed around signed metadata roles, freshness/versioning, threshold/role separation, and attack resistance for software update systems. [TUF01]

Evaluate a TUF-like model when:

- clients install updates from mirrors/CDNs;
- old-but-valid software could be maliciously replayed;
- update metadata itself is security-critical;
- devices are long-lived;
- multiple signing roles/thresholds improve compromise tolerance;
- offline roots are useful;
- rollback/freeze defense matters.

Do not add TUF ceremony to an internal low-risk deployment path when existing authenticated artifact/promotion controls already satisfy the threat model.

## 18.1 Client-side verification

For distributed clients, define:

```yaml
trusted_root_bootstrap:
metadata_freshness:
target_identity:
target_version:
rollback_protection:
expiration:
mirror_behavior:
offline_behavior:
key_rotation:
root_rotation:
compromise_recovery:
partial_update_recovery:
```

The consumer is part of the security boundary.

---

# 19. CI/CD identity, runners, and secrets

## 19.1 Identity first

Every privileged action should be attributable to a principal:

- human;
- CI workflow;
- build service;
- deployment controller;
- platform controller;
- signing service;
- AI agent with delegated identity.

Avoid “shared deployment user” when individual/workload attribution is materially useful.

## 19.2 OIDC / short-lived federation

GitHub Actions and major cloud providers support OIDC-based federation in which a workflow obtains short-lived credentials instead of storing a duplicated long-lived cloud key. [GH02]

Benefits can include:

- shorter credential lifetime;
- no duplicated static cloud secret in CI;
- context claims about repository/workflow/environment;
- centralized cloud-side policy.

Risks remain:

- overbroad trust conditions;
- compromised SCM/workflow identity;
- issuer compromise;
- confused-deputy policy;
- credentials used during their valid window;
- policy drift.

Therefore:

> **OIDC reduces one class of secret risk; it does not remove authorization design.**

## 19.3 Runner trust classes

Define runner classes, for example:

| Class | Typical use | Key controls |
|---|---|---|
| Untrusted ephemeral | fork/PR checks | no production secrets, strong sandbox, disposable |
| Trusted ephemeral | post-merge build | controlled image, short-lived identity, clean lifecycle |
| Privileged release | signing/deploy | minimal workloads, protected policy, strong audit |
| Specialized/self-hosted | hardware/private network | patching, isolation, persistence risk, explicit ownership |

Persistent self-hosted runners require special attention because cross-job residue can survive.

## 19.4 Secret handling

Secrets SHOULD be:

- outside source;
- scoped;
- short-lived where practical;
- rotatable;
- auditable;
- unavailable to untrusted contexts;
- redacted from logs;
- inaccessible to arbitrary third-party actions;
- revoked when workflow/service ownership ends.

Never assume a masked log value means the underlying secret cannot leak through encoding, artifacts, caches, or side channels.

## 19.5 Environment protections

Protected environments MAY require:

- allowed branches/tags;
- trusted workflow identity;
- explicit reviewers;
- deployment windows;
- scoped secrets;
- policy checks.

Use these controls because they mitigate named risks, not because “production must have more gates.”

---

# 20. Environment and configuration engineering

## 20.1 Parity principle

The goal is not visually identical environments. Preserve parity in semantics that can change correctness or release evidence:

- runtime version;
- CPU/architecture where relevant;
- database engine/version/features;
- transaction/consistency semantics;
- queue/event semantics;
- authorization policy;
- TLS/network policy;
- service mesh/admission behavior;
- base image/OS;
- external service contracts;
- feature flags/configuration;
- secret/reference behavior;
- region-specific dependencies.

## 20.2 Parity gap register

```yaml
difference:
why_it_exists:
risk:
what_tests_it_invalidates:
compensating_evidence:
owner:
revisit_trigger:
```

A known difference can be acceptable. An unrecognized difference creates false confidence.

## 20.3 Configuration as controlled state

For material config:

```yaml
schema:
validation:
owner:
source_of_truth:
default:
environment_overrides:
secret_fields:
rollout_behavior:
compatibility:
audit_history:
rollback_behavior:
```

Configuration MUST fail predictably. A missing/invalid critical value should not silently fall back to a dangerous default.

## 20.4 Feature flags

Every material flag SHOULD have:

```yaml
flag:
owner:
purpose:
type: release | experiment | ops | permission | kill_switch
default:
segments:
created:
expiry_or_review:
interactions:
observability:
failure_mode:
cleanup_plan:
```

Flag debt can create a combinatorial product-state space. Remove obsolete release flags.

## 20.5 Test data

Do not obtain environment parity by casually cloning sensitive production data.

Use:

- synthetic data;
- sanitized/pseudonymized subsets;
- carefully controlled snapshots;
- replay/simulation;
- production canary evidence where safe.

Privacy/security controls remain applicable to CI/staging.

---

# 21. Continuous delivery, continuous deployment, deploy, and release

## 21.1 Terms

```text
CONTINUOUS INTEGRATION
= frequently integrate and verify change

CONTINUOUS DELIVERY
= keep software in a releasable state and make release routine/on-demand

CONTINUOUS DEPLOYMENT
= automatically deploy qualifying changes

DEPLOYMENT
= place/activate software in an environment

RELEASE
= expose behavior/capability to intended users/traffic
```

DORA explicitly distinguishes continuous delivery from continuous deployment and associates high-performing delivery with automation, CI, version control, testing, database change management, and observability rather than one tool. [DORA01]

## 21.2 Release candidate

A release candidate SHOULD identify:

- artifact digest(s);
- source revision;
- config baseline;
- required migrations;
- REB;
- intended environment;
- rollout strategy;
- health gates;
- recovery strategy;
- owner/automation authority.

## 21.3 Promotion state machine

```text
BUILT
→ VERIFIED
→ ELIGIBLE
→ STAGED / PREPARED
→ DEPLOYED
→ RELEASED
→ VERIFIED_IN_PRODUCTION
→ STABLE
```

Failure paths:

```text
ANY STATE
→ BLOCKED
→ QUARANTINED
→ ROLLED_BACK
→ ROLLED_FORWARD
→ DISABLED
→ COMPENSATED
→ RESTORED
```

Do not model the pipeline as one boolean `green`.

## 21.4 Build vs release separation

Separating deploy from release is useful when:

- feature exposure can be safely controlled independently;
- production environment evidence is valuable before user exposure;
- rapid kill/disable matters;
- experimentation/ring rollout is required.

It can add complexity when flags/routing are hard to reason about. Use it when the risk reduction exceeds the state-space cost.

---

# 22. Progressive delivery

## 22.1 Progressive delivery mechanisms

| Mechanism | Main benefit | Key risk |
|---|---|---|
| Rolling | bounded infrastructure replacement | mixed versions, slow detection |
| Canary | limited production exposure + evidence | poor representativeness/attribution |
| Ring/cohort | exposure by user/device/tenant group | cohort bias |
| Blue/green | fast environment traffic switch | duplicate cost + shared state |
| Feature flag | deploy/release decoupling | flag debt/interaction |
| Shadow | observe new path without user effect | side effects/data privacy/false equivalence |
| Dark launch | production code path without full exposure | hidden resource/state effects |
| A/B experiment | causal product comparison | not automatically release-safety detection |

## 22.2 Canary evaluability gate

Before choosing a canary, answer:

1. Can the suspected failure occur in the canary cohort?
2. Is the cohort representative enough for the target risk?
3. Can telemetry attribute the outcome to the candidate version?
4. Is traffic volume sufficient?
5. Is the observation window long enough?
6. Do shared databases/caches/queues destroy isolation?
7. Are lagged/asynchronous failures visible in time?
8. Are user/business guardrails available?
9. Is rollback/forward compatible with changed state?
10. Who/what owns promotion/abort?

If several answers are “no,” canarying may create false assurance. Google SRE explicitly treats canary effectiveness as dependent on population, duration, signal quality, and production context. [SRE01]

## 22.3 Health gates

Use multiple signal classes where relevant:

```text
SYSTEM HEALTH
latency / errors / saturation / crashes

BUSINESS CORRECTNESS
conversion / order integrity / payment success / domain invariants

DATA HEALTH
freshness / duplicates / reconciliation / corruption indicators

SECURITY / PRIVACY
authorization failures / anomalous access / sensitive-data leakage signals

COST / RESOURCE
unexpected resource or model/token cost

USER EXPERIENCE
task success / client crash / accessibility regressions
```

Avoid promoting solely on infrastructure health when the change can fail semantically.

## 22.4 Automated promotion

Automated promotion is strong when:

- signals are trustworthy;
- thresholds are predeclared;
- enough observations exist;
- artifact/config identity is unambiguous;
- rollback/forward path is safe;
- evaluation logic itself is versioned/tested;
- noise cannot cause flapping.

Use hysteresis, minimum observation windows, multi-signal confirmation, or human judgment where needed.

## 22.5 Blue/green nuance

Blue/green can make **traffic reversal** easy. It does not automatically reverse:

- database writes;
- messages/events;
- external API effects;
- customer-visible communications;
- irreversible migrations;
- caches/state;
- financial transactions.

Model those separately.

---

# 23. Recovery engineering

## 23.1 Recovery menu

A delivery system SHOULD support a deliberate choice among:

### Rollback
Return executable software to an earlier compatible version.

### Roll-forward
Deploy a correction that preserves/understands current state.

### Disable
Turn off capability via routing/flag/config.

### Compensate
Apply a domain-specific corrective action for already-committed side effects.

### Restore
Recover data/state/infrastructure from backup/snapshot/log.

### Quarantine
Prevent promotion/use of a suspect artifact, identity, dependency, or evidence set.

These can be combined.

## 23.2 Decision table

| Condition | Preferred consideration |
|---|---|
| previous version interprets current state safely; failure local to code | rollback can be fastest |
| irreversible/new schema/state exists | roll-forward or compatibility layer |
| externally visible side effects already occurred | compensate + code recovery |
| feature isolated behind flag | disable may be fastest |
| data corrupted | contain writes, restore/reconcile, then code recovery |
| artifact/supply-chain compromise | quarantine + trust reset + clean rebuild |
| deployment controller/config wrong | restore desired config/controller state |
| uncertain blast radius | stop exposure, preserve evidence, choose safest containment |

## 23.3 Recovery preconditions

```yaml
strategy:
trigger:
state_compatibility:
schema_compatibility:
external_side_effects:
data_loss_risk:
estimated_time:
operator_or_controller:
required_permissions:
verification:
abort_condition:
```

## 23.4 Automatic rollback

Automatic rollback is appropriate when:

- the signal strongly correlates with candidate harm;
- false positives are tolerable;
- reversal is compatible;
- rollback does not erase forensic evidence;
- repeated oscillation is prevented.

It can be harmful when:

- signal is noisy;
- rollback causes another migration;
- old code cannot read new state;
- external effects have already happened;
- upstream dependency outage causes every new deployment to flap.

## 23.5 Recovery verification

After recovery verify:

- user journey;
- domain/data invariants;
- queue/backlog health;
- dependency state;
- runtime identity;
- config/flag state;
- security/authorization behavior;
- residual impact;
- observability/alerts.

“Deployment succeeded” is not “service recovered.”

---

# 24. Migration-safe delivery

## 24.1 Expand → migrate → contract

For live schema/API/event changes, prefer compatible evolution where feasible:

```text
1. EXPAND — introduce backward-compatible representation/path
2. DEPLOY COMPATIBLE READERS / WRITERS
3. MIGRATE / BACKFILL progressively
4. OBSERVE / RECONCILE
5. SWITCH authoritative reads/writes
6. REMOVE old writers/readers
7. CONTRACT old representation later
```

## 24.2 Backfills

Backfills SHOULD be:

- bounded;
- resumable;
- idempotent where practical;
- rate-limited;
- observable;
- safe under partial completion;
- compatible with concurrent production traffic;
- reconciled after completion.

## 24.3 Migration release evidence

Record:

```yaml
migration_id:
schema_from:
schema_to:
compatible_versions:
backfill:
estimated_scope:
lock_load_risk:
stop_condition:
resume_strategy:
rollback_limit:
reconciliation:
owner:
```

## 24.4 Client compatibility

Rollback may be impossible when old clients, mobile apps, desktop apps, firmware, or external API consumers cannot be forcibly updated.

Design:

- server backward compatibility;
- protocol/version negotiation;
- feature capability detection;
- phased deprecation;
- minimum supported version;
- emergency block only where safe/legal;
- migration windows.

“Just roll back” is often a server-centric assumption.

---

# 25. Platform engineering

## 25.1 Purpose

Platform engineering exists to reduce repeated cognitive/operational work and make good engineering defaults easy to consume.

It is not:

- a new name for a ticket-based infrastructure team;
- an excuse to centralize every tool decision;
- a dashboard/catalog as an end in itself;
- a mandatory maturity stage for every organization.

Current DORA evidence reports meaningful potential benefits but also mixed delivery effects when platforms are poorly implemented or constrain teams. [DORA04]

## 25.2 Platform as product

A platform SHOULD have:

```yaml
target_users:
jobs_to_be_done:
product_owner:
service_owner:
capabilities:
non_goals:
support_model:
documentation:
onboarding:
feedback_channels:
slo_or_service_expectations:
security_model:
cost_model:
deprecation_policy:
escape_hatch:
outcome_metrics:
```

## 25.3 Paved/golden paths

A paved path SHOULD:

- encode secure/reliable defaults;
- provide self-service;
- minimize repeated configuration;
- expose enough semantics for debugging/ownership;
- remain versioned/evolvable;
- permit approved deviations;
- incorporate feedback from exceptions.

CNCF platform guidance and DORA capability guidance both emphasize self-service/product thinking rather than pure standardization. [CNCF01][CNCF02][DORA04]

## 25.4 Golden cage anti-pattern

Symptoms:

- platform is mandatory even when it cannot meet requirements;
- teams open tickets for ordinary lifecycle actions;
- abstraction hides logs/config/ownership;
- escape requires political escalation;
- platform release cadence blocks product teams;
- unsupported edge cases multiply local workarounds.

Fix:

- define supported paths honestly;
- provide bounded escape hatches;
- capture exception demand as product feedback;
- measure user outcomes;
- retire obsolete templates;
- reduce constraints that no longer protect a material invariant.

## 25.5 Platform reliability

The platform itself can become a shared failure domain.

Define:

- platform SLO/availability need;
- degraded/manual path;
- change management;
- tenant isolation;
- secret/identity boundaries;
- shared action/template provenance;
- compatibility policy;
- incident response;
- disaster recovery;
- release process.

A platform that makes all delivery depend on one brittle control plane can reduce organizational resilience.

## 25.6 Minimum viable platform

Start with repeated high-friction/high-risk jobs such as:

- standard service bootstrap;
- CI templates;
- artifact publication;
- environment provisioning;
- workload identity;
- observability defaults;
- secure deployment path;
- dependency/update policy.

Do not build a broad internal cloud before demand justifies it.

---

# 26. GitOps and reconciliation

OpenGitOps describes principles around declarative desired state, versioned/immutable state, automatic pull, and continuous reconciliation. [GITOPS01]

GitOps is useful when:

- desired state is naturally declarative;
- reconciliation is safe/idempotent;
- version control is an appropriate authoritative source;
- drift detection matters;
- pull-based access reduces deployment credential exposure.

It is weaker when:

- imperative orchestration is primary;
- secret/state handling does not fit Git;
- workflow requires complex external transactions;
- reconciliation can repeat harmful side effects;
- human-readable Git state cannot represent the true runtime state.

## 26.1 Git is not the entire source of truth

Even in GitOps, production truth can include:

- actual runtime artifact;
- controller version;
- admission mutation;
- cluster/service state;
- external secrets;
- cloud-managed state;
- mutable external dependencies.

Observe actual runtime, not only desired state.

## 26.2 Drift

Define drift classes:

```text
AUTHORIZED EMERGENCY DRIFT
CONTROLLER LAG
MANUAL UNAUTHORIZED DRIFT
PROVIDER / EXTERNAL DRIFT
GENERATED / MUTATED RUNTIME STATE
```

Every class does not require the same response.

---

# 27. Release policy, approvals, and separation of duties

## 27.1 Policy types

Separate:

- deterministic technical policy;
- risk/exception judgment;
- legal/compliance approval;
- business release decision;
- security acceptance;
- high-assurance separation of duties.

## 27.2 Automate deterministic controls

Examples:

- required status checks;
- artifact digest match;
- provenance builder allowlist;
- signature/identity verification;
- SBOM presence;
- policy version check;
- environment authorization;
- prohibited dependency/license rule.

## 27.3 Human approval

Human review is strong when the reviewer has:

- relevant competence;
- understandable evidence;
- actual decision authority;
- time/attention;
- a material judgment to make.

Human review is weak when:

- hundreds of releases are rubber-stamped;
- the reviewer cannot understand the evidence;
- approval occurs after the real decision;
- no rejection/exception path exists.

DORA's change-approval guidance favors peer review and automated evidence over heavyweight external approval boards as a general delivery mechanism. [DORA06]

## 27.4 Separation of duties

Separation remains appropriate where:

- regulation requires it;
- financial/fraud risk is material;
- one compromised identity would otherwise control source + build + sign + deploy;
- safety/high-assurance governance requires independent authority.

Automate evidence collection; do not automate away legitimately independent authority.

## 27.5 Exception record

```yaml
exception_id:
policy_or_rule:
scope:
reason:
risk:
compensating_controls:
requested_by:
approved_by:
created:
expires:
revisit_trigger:
evidence:
```

Permanent exceptions SHOULD become explicit policy/architecture decisions rather than invisible bypasses.

## 27.6 Break-glass release

A break-glass path SHOULD define:

- trigger/severity;
- authorized role;
- bounded privileges;
- protected credentials;
- minimum mandatory evidence;
- monitoring;
- expiry/revocation;
- retrospective review;
- restoration of normal controls.

Emergency response is not a justification for an undocumented permanent bypass.

---

# 28. Delivery observability and runtime verification

## 28.1 Questions delivery telemetry must answer

- What exact artifact/config is running?
- Where?
- Since when?
- Which release/deployment introduced it?
- What percentage/cohort is exposed?
- Did error/latency/resource behavior change?
- Did domain correctness change?
- Did security/privacy signals change?
- Did cost change?
- Is the rollout mixed/incomplete?
- Can we stop/disable/recover?

## 28.2 Runtime identity

Post-deployment verification SHOULD observe actual runtime identity where technically feasible:

- container/image digest;
- binary/build identifier;
- application version + commit;
- package signature;
- configuration revision;
- feature-flag baseline;
- model/version;
- deployment controller revision.

This catches the gap between “we intended to deploy X” and “runtime is actually X.”

## 28.3 Deployment markers

Telemetry SHOULD correlate:

```yaml
release_id:
artifact_digest:
config_revision:
environment:
cohort:
deploy_time:
source_revision:
```

Avoid high-cardinality telemetry designs that make observability unaffordable; retain release correlation at the right aggregation.

## 28.4 Release SLOs

Possible delivery capability signals:

- release pipeline availability;
- build success/failure due to infrastructure;
- time to deterministic feedback;
- artifact publication latency;
- promotion latency;
- failed release recovery time;
- rate of emergency exceptions;
- rollback success;
- evidence verification failure;
- runtime identity mismatch.

The pipeline itself is a service.

---

# 29. Delivery metrics and Goodhart resistance

DORA's current model uses five software-delivery metrics across throughput and instability: change lead time, deployment frequency, failed deployment recovery time, change fail rate, and deployment rework rate. [DORA05]

Use them as diagnostic system signals, not targets for individuals.

## 29.1 Balanced measurement stack

### Flow
- change lead time;
- deployment/release frequency;
- queue/wait time;
- CI feedback time.

### Instability
- change fail rate;
- deployment rework;
- failed deployment recovery time;
- rollback/forward frequency;
- emergency release frequency.

### Assurance
- policy exceptions;
- provenance/SBOM/signature verification failures;
- runtime identity mismatches;
- unpinned privileged dependencies;
- overdue dependency risk;
- stale golden paths.

### Platform
- task success;
- time-to-first-deploy;
- adoption by capability;
- support tickets/manual handoffs;
- platform SLO;
- developer cognitive load/satisfaction;
- escape-hatch use and reasons.

### Outcome
- user/business reliability;
- incident rate/severity;
- security events;
- delivery cost;
- engineering time saved/consumed.

## 29.2 Metric integrity template

```yaml
metric:
question_it_answers:
decision_it_informs:
population:
data_source:
owner:
expected_mechanism:
known_gaming_risk:
segments:
threshold_or_trend_use:
review_cadence:
```

## 29.3 Anti-metrics

Do not treat these alone as success:

- number of pipeline steps;
- number of security tools;
- number of signatures;
- number of SBOMs;
- percent automation;
- platform catalog size;
- deployment count;
- test count;
- vulnerability count;
- “compliance checks passed.”

---

# 30. Software supply-chain incident response

## 30.1 Trigger examples

- compromised package/dependency;
- compromised maintainer account;
- malicious CI action/plugin;
- stolen signing key;
- compromised OIDC issuer/trust path;
- build runner compromise;
- poisoned cache;
- registry/artifact replacement;
- provenance mismatch;
- SBOM fraud/incompleteness affecting response;
- unauthorized release;
- malicious update distribution;
- platform shared-component compromise.

## 30.2 Response loop

```text
DETECT
→ FREEZE / CONTAIN RELEVANT TRUST PATH
→ IDENTIFY AFFECTED ARTIFACTS / IDENTITIES / BUILDS
→ QUARANTINE / DENYLIST
→ ASSESS CONSUMER / RUNTIME EXPOSURE
→ ESTABLISH CLEAN TRUST ANCHOR
→ REBUILD / RE-ATTEST / RE-SIGN AS APPROPRIATE
→ REDEPLOY / UPDATE
→ VERIFY RUNTIME / CONSUMER STATE
→ ROTATE / REVOKE
→ LEARN + HARDEN
```

## 30.3 Trust-reset invariant

Do **not** “recover” by:

- rebuilding through the same unverified compromised builder;
- re-signing with the same suspect key;
- trusting provenance emitted by the compromised control plane;
- pulling from the same suspect cache/registry without verification.

First establish what is clean enough to act as a new trust anchor/path.

## 30.4 Impact discovery

Be able to query, as appropriate:

```text
Which artifacts contain dependency X?
Which builds used builder/image Y?
Which releases were signed by identity/key Z?
Which deployments run digest D?
Which customers/devices received update U?
Which environments used configuration C?
```

SBOM, provenance, registry metadata, deployment telemetry, and release records are valuable partly because they enable this investigation.

## 30.5 Quarantine

Quarantine can target:

- artifact digest;
- package version;
- builder identity;
- signer identity;
- certificate issuer;
- workflow revision;
- cache namespace;
- registry path;
- source revision.

Quarantine MUST be precise enough not to create unnecessary outage unless the threat justifies it.

---

# 31. AI and agentic DevOps controls

AI can generate or modify:

- pipeline YAML;
- IaC;
- deployment config;
- scripts;
- release notes;
- migration commands;
- dependency updates;
- rollout decisions;
- incident actions.

These are production-affecting outputs.

## 31.1 Core rule

> **AI may propose, synthesize, diagnose, or execute within delegated capability; model output is never the root of authorization or independent assurance.**

## 31.2 Threats

- prompt/instruction injection from PRs, issues, docs, logs, artifacts;
- malicious package metadata;
- model hallucination about API/policy semantics;
- agent weakening tests to pass;
- agent editing privileged workflow;
- agent leaking secrets to model/tool/log;
- recursive tool loops;
- duplicated deployment actions;
- self-approval;
- stale context/policy;
- broad cloud credentials.

## 31.3 Required controls for material agent actions

```yaml
agent_identity:
allowed_tools:
allowed_repositories:
allowed_environments:
read_write_scope:
max_side_effect_class:
approval_threshold:
policy_engine:
schema_validation:
idempotency:
concurrency:
timeout:
retry_budget:
cost_budget:
logging:
provenance:
kill_revoke:
recovery:
```

## 31.4 Privileged boundaries

Require deterministic external policy for:

- production deploy;
- secret read;
- signing;
- artifact deletion;
- release-policy bypass;
- infrastructure destruction;
- key/credential creation;
- spending or high-value external actions.

## 31.5 Independent evidence

If AI generates a change, stronger evidence comes from:

- compiler/type checker;
- deterministic tests;
- static/security checks;
- policy engine;
- provenance/signature verification;
- human specialist review where needed;
- production telemetry/canary.

A second AI model may add diversity but is not automatically independent assurance.

---

# 32. Decision frameworks

## 32.1 Should this check block CI?

```text
Does failure indicate a release-risk condition that should prevent integration/release?
  ├─ NO → advisory / later lane
  └─ YES → Is the check fast and reliable enough for blocking?
           ├─ YES → block
           └─ NO  → improve it, move to later gate, or add compensating evidence
```

Ask:

- consequence if missed;
- false positive rate;
- false negative rate;
- latency;
- ownership;
- outage semantics;
- whether failure is revision-specific or environment-specific.

## 32.2 Build once or rebuild per target?

```text
Can the same artifact safely vary by external configuration?
  ├─ YES → build once, promote exact digest
  └─ NO  → Is target-specific compilation/packaging inherently required?
           ├─ YES → produce identified sibling artifacts from common lineage
           └─ NO  → remove unnecessary compile-time/environment coupling
```

## 32.3 How much SLSA assurance?

```text
What supply-chain attack are we mitigating?
→ Which provenance/source/build guarantees reduce it?
→ Can our ecosystem produce + verify those guarantees?
→ What threats remain outside SLSA?
→ Is added assurance worth operational cost?
```

Do not start from “we need level N.”

## 32.4 Should we sign?

Sign when a consumer needs to establish artifact/evidence identity/integrity under a trust policy.

Then choose:

```text
online workload identity?
long-lived offline verification?
regulatory key custody?
threshold authority?
transparency useful?
air-gapped client?
key rotation constraints?
```

Select keyless/key-based/threshold accordingly.

## 32.5 Should we require an SBOM?

Usually yes for material products where dependency transparency, vulnerability response, customer/procurement needs, or regulation justify it.

But define:

- subject;
- scope;
- freshness;
- distribution;
- correction;
- consumer use.

An unused SBOM is documentation output, not an operating capability.

## 32.6 Should we canary?

```text
Can production exposure be bounded?
  ├─ NO → use another assurance strategy
  └─ YES → Can the target failure be measured/attributed during the canary?
           ├─ NO → canary may create false assurance; improve signals or choose another method
           └─ YES → define cohort + window + gates + abort + recovery
```

## 32.7 Rollback or roll-forward?

```text
Can old version interpret current schema/state/external effects safely?
  ├─ YES → rollback may be fastest
  └─ NO  → Can a minimal forward fix/compatibility layer restore safely?
           ├─ YES → roll forward
           └─ NO  → disable / compensate / restore / isolate
```

## 32.8 Build an internal platform?

```text
Are repeated cross-team jobs creating material friction/risk?
  ├─ NO → standardize locally; do not build platform bureaucracy
  └─ YES → Can a shared product remove repeated work without hiding critical semantics?
           ├─ NO → improve docs/tools/ownership first
           └─ YES → build minimum viable platform capability, measure outcomes
```

## 32.9 GitOps?

```text
Is desired state declarative and safely reconcilable?
  ├─ NO → GitOps is poor fit
  └─ YES → Is version control an appropriate authority and can secrets/external state be handled safely?
           ├─ NO → hybrid/other deployment control
           └─ YES → GitOps can be a strong pattern
```

## 32.10 Manual approval?

```text
Is there a material judgment / legal authority / separation-of-duties need?
  ├─ NO → automate deterministic policy
  └─ YES → provide reviewer with understandable evidence and real reject/exception authority
```

---

# 33. Contradiction ledger

| Tension | V2 conclusion |
|---|---|
| Speed vs safety | Small changes, strong feedback, and recovery can improve both; do not assume inherent opposition |
| Automation vs judgment | Automate deterministic repeatable controls; retain competent judgment for ambiguity/consequence |
| Build once vs multi-platform | Prefer one artifact where possible; preserve shared lineage when multiple outputs are inherently required |
| Pin vs update | Pin for reproducibility/control; monitor and deliberately update |
| Hermetic vs practical build | Hermeticity reduces hidden inputs; use when assurance value exceeds complexity |
| Reproducible vs secure | Reproducibility proves consistency under defined inputs, not benign source |
| Signature vs trust | Signature is cryptographic evidence; authorization/provenance/policy decide trust |
| Keyless vs key-based | Choose from operational/trust model; neither is universal |
| SBOM transparency vs sensitivity | Provide needed transparency while respecting authorized distribution/sensitive details |
| CVE block vs risk context | Use vulnerability + product context + policy; no universal count threshold |
| Fast CI vs exhaustive CI | Layer checks; keep critical feedback fast while deeper evidence runs where it adds value |
| Fail closed vs pipeline availability | Define gate outage semantics from consequence; security tools are dependencies too |
| Staging vs production | Staging catches classes of defects; production verification remains distinct |
| Canary vs broad rollout | Canary reduces exposure only when representative/evaluable |
| Auto rollback vs human | Automation is powerful with trustworthy signals/state; dangerous with ambiguity |
| Rollback vs roll-forward | State compatibility decides; neither is default in all failures |
| Blue/green vs rolling | Different blast-radius/capacity/state trade-offs |
| Platform standardization vs autonomy | Encode safe defaults but preserve bounded choice/escape |
| GitOps vs imperative orchestration | GitOps strong for declarative reconciliation; contextual otherwise |
| Central platform vs resilience | Shared platform can reduce duplication but create shared failure domain |
| Separation of duties vs flow | Preserve where threat/regulation justifies it; avoid ceremonial approvals |
| Security gate vs developer experience | Safe path should be easy; friction without risk reduction creates bypass |
| DORA metrics vs targets | Use for diagnosis/improvement; quotas invite gaming |
| AI automation vs accountability | AI can increase throughput; responsibility and deterministic authorization remain |

---

# 34. Anti-playbook — claims to actively resist

## 34.1 “Green CI means releasable.”
**Verdict:** false.  
**Better rule:** CI is one evidence layer; production readiness also depends on migration, config, security, observability, capacity, supply-chain evidence, and recovery.

## 34.2 “More gates make releases safer.”
**Verdict:** false.  
**Better rule:** every gate must control a named risk and justify false-positive, latency, and availability cost.

## 34.3 “Every check must run on every commit.”
**Verdict:** false.  
**Better rule:** layer checks by feedback value, cost, and consequence.

## 34.4 “Trunk-based development is always best.”
**Verdict:** contextual.  
**Better rule:** minimize integration divergence; select branch/release structures from product and governance needs.

## 34.5 “Build once, promote the same bytes everywhere.”
**Verdict:** strong default with legitimate exceptions.  
**Better rule:** preserve exact artifact identity where possible and common lineage where platform-specific outputs are necessary.

## 34.6 “Reproducible builds are secure builds.”
**Verdict:** false.  
**Better rule:** reproducibility proves consistent output from defined inputs, not trustworthy inputs.

## 34.7 “Hermetic builds are mandatory for all software.”
**Verdict:** false.  
**Better rule:** use hermeticity when hidden inputs materially threaten assurance.

## 34.8 “Higher SLSA level means the product is secure.”
**Verdict:** false.  
**Better rule:** SLSA addresses supply-chain guarantees; product correctness/security requires additional evidence.

## 34.9 “A signed artifact is trustworthy.”
**Verdict:** false.  
**Better rule:** verify subject, cryptography, identity, authorization, provenance, and policy.

## 34.10 “Keyless signing is always better.”
**Verdict:** false.  
**Better rule:** choose signing architecture from trust, distribution, connectivity, lifetime, and custody needs.

## 34.11 “An SBOM proves supply-chain security.”
**Verdict:** false.  
**Better rule:** an SBOM is structured inventory; combine with provenance, vulnerability/context analysis, and response.

## 34.12 “Any known CVE should block release.”
**Verdict:** false as a universal rule.  
**Better rule:** evaluate applicability/exposure/severity/exploitation/fix risk and scoped policy.

## 34.13 “SBOMs should always be public.”
**Verdict:** false.  
**Better rule:** distribute to the consumers who need them under an appropriate access model.

## 34.14 “Staging proves production safety.”
**Verdict:** false.  
**Better rule:** staging reduces uncertainty for reproduced conditions; production still contains unique traffic, scale, dependencies, data, and interactions.

## 34.15 “Canary is always safer.”
**Verdict:** false.  
**Better rule:** use canaries only when exposure is bounded and the target failure is observable/attributable.

## 34.16 “Blue/green makes rollback trivial.”
**Verdict:** false for stateful/external effects.  
**Better rule:** traffic reversal can be simple while state reversal remains unsafe.

## 34.17 “Automatic rollback is always safer.”
**Verdict:** false.  
**Better rule:** automate only with trustworthy signals and state-compatible recovery.

## 34.18 “Rollback is the default recovery.”
**Verdict:** false.  
**Better rule:** choose rollback, roll-forward, disable, compensate, restore, or quarantine from actual failure/state.

## 34.19 “GitOps is the mature end-state.”
**Verdict:** false.  
**Better rule:** GitOps is a strong contextual reconciliation pattern.

## 34.20 “Platform engineering always improves delivery.”
**Verdict:** false.  
**Better rule:** platform value depends on product quality, self-service, reliability, autonomy, and user outcomes.

## 34.21 “One golden path should be mandatory.”
**Verdict:** false.  
**Better rule:** paved paths should encode safe defaults and allow governed exceptions when requirements differ.

## 34.22 “Manual approval makes deployment safe.”
**Verdict:** false.  
**Better rule:** approval only adds assurance when reviewer competence/authority/evidence match a material judgment.

## 34.23 “Separation of duties slows DevOps and should be removed.”
**Verdict:** false.  
**Better rule:** preserve separation where threat model, fraud risk, safety, or regulation requires independent authority.

## 34.24 “Maximize deployment frequency.”
**Verdict:** false.  
**Better rule:** optimize safe valuable flow with throughput + instability + outcome signals.

## 34.25 “Mutable tags are good enough.”
**Verdict:** false for security identity.  
**Better rule:** use immutable content identity for verification/promotion; tags remain aliases.

## 34.26 “Registry scanning means the artifact is safe.”
**Verdict:** false.  
**Better rule:** scanning is one evidence source with coverage/freshness limits.

## 34.27 “Automatically merge all dependency security updates.”
**Verdict:** false.  
**Better rule:** risk-tiered automation with independent verification.

## 34.28 “Dependency bots are independent security review.”
**Verdict:** false.  
**Better rule:** updater, source, tests, policy, and human/runtime evidence are separate layers.

## 34.29 “Infrastructure as code makes the environment reproducible.”
**Verdict:** incomplete.  
**Better rule:** IaC versions intent; mutable images, provider state, secrets, external resources, and policy can still diverge.

## 34.30 “The GitOps repository tells us what is running.”
**Verdict:** incomplete.  
**Better rule:** desired state must be reconciled with observed runtime identity/configuration.

## 34.31 “A compliance pass means the pipeline is secure.”
**Verdict:** false.  
**Better rule:** compliance proves scoped evidence; threat-driven security remains.

## 34.32 “Freeze releases on Fridays.”
**Verdict:** folklore as a universal rule.  
**Better rule:** release when staffing, observability, recovery, and risk are adequate; local calendar rules can be rational policy.

## 34.33 “Automate everything.”
**Verdict:** false.  
**Better rule:** automate stable understood decisions; preserve judgment where uncertainty/consequence demands it.

## 34.34 “Never allow emergency bypass.”
**Verdict:** unsafe rigidity.  
**Better rule:** define a bounded, auditable break-glass path before the emergency.

## 34.35 “Security scanner unavailable = pass.”
**Verdict:** false.  
**Better rule:** model `UNAVAILABLE` distinctly and apply explicit risk policy.

## 34.36 “Security scanner unavailable = always fail closed.”
**Verdict:** also false as a universal rule.  
**Better rule:** choose fail/continue/exception behavior from consequence, incident severity, compensating evidence, and outage duration.

## 34.37 “A release signature should be produced by the same arbitrary build step.”
**Verdict:** weak high-assurance design.  
**Better rule:** separate signing authority from user-defined build code where compromise consequence is high.

## 34.38 “If provenance exists, the artifact is trustworthy.”
**Verdict:** false.  
**Better rule:** provenance explains production lineage; consumers still evaluate policy and source/build trust.

## 34.39 “AI can review its own deployment change.”
**Verdict:** insufficient for material risk.  
**Better rule:** combine AI generation with deterministic policy/tests/runtime evidence and human/specialist review where needed.

## 34.40 “The pipeline is just developer tooling.”
**Verdict:** false.  
**Better rule:** delivery infrastructure can mutate production and must be engineered/operated accordingly.

---

# 35. Core Plays

## PLAY-10-01 — Release a material production change

### Objective
Release an exact verified artifact/configuration with bounded exposure and a credible recovery path.

### Trigger
A production candidate has passed its required development/integration verification.

### Preconditions
- exact artifact/release-set identity exists;
- risk/criticality known;
- required REB evidence exists or approved exceptions are recorded;
- migration/config/flag changes identified;
- rollout and recovery strategy selected;
- owner/controller authorized.

### Execution
1. Resolve the exact artifact digest(s).
2. Verify required provenance/signature/SBOM/policy evidence.
3. Verify configuration and migration ordering.
4. Verify target environment authorization and current state.
5. Start bounded deployment/exposure.
6. Record release/deployment markers.
7. Observe defined system/business/data/security guardrails.
8. Promote, hold, abort, rollback/forward, or disable according to predeclared decision logic.
9. Verify actual runtime identity/configuration.
10. Mark stable only when post-release criteria pass.
11. Schedule cleanup of temporary flags/workarounds.

### Acceptance criteria
- exact artifact identity matches decision;
- required evidence policy passes or explicit exception exists;
- no unaccepted critical guardrail breach;
- runtime identity verified;
- recovery remains viable or updated;
- release record retained.

---

## PLAY-10-02 — Respond to a compromised dependency or supplier

### Objective
Identify exposure, stop propagation, remediate safely, and re-establish trust.

### Execution
1. Validate incident/advisory authenticity.
2. Identify affected dependency versions/suppliers.
3. Query SBOM/provenance/build history for affected artifacts.
4. Identify running/distributed releases.
5. Block/quarantine affected versions/digests if warranted.
6. Assess exploitability/exposure and compensating controls.
7. Select patched/replacement version.
8. Verify provenance/source of replacement.
9. Rebuild through a trusted path.
10. Execute risk-appropriate verification.
11. Release progressively where useful.
12. Verify no affected runtime remains.
13. Update supplier/dependency policy and postmortem.

---

## PLAY-10-03 — Respond to compromised CI/build/signing infrastructure

### Objective
Re-establish a clean trust path before issuing new trusted artifacts.

### Guardrail
**MUST NOT** treat rebuilding/re-signing through the same unverified compromised path as recovery.

### Execution
1. Freeze suspect signing/promotion capability.
2. Preserve logs/evidence.
3. Identify compromised identities, builders, caches, registries, workflows, time window.
4. Revoke/rotate affected credentials/trust roots as needed.
5. Quarantine suspect artifacts/evidence.
6. Establish clean builder/cache/dependency sources.
7. Establish clean signing/attestation identity.
8. Rebuild/re-attest high-risk artifacts from known source revisions.
9. Verify consumers/runtimes and redeploy/update as necessary.
10. Publish/communicate trust-root changes where consumers require them.
11. Investigate historical exposure and close control gaps.

---

## PLAY-10-04 — Progressive rollout

### Objective
Gather production evidence while bounding exposure.

### Preconditions
- canary evaluability gate passes;
- exact candidate identity known;
- cohort/routing mechanism controlled;
- metrics/guardrails attributable;
- observation window defined;
- recovery compatible.

### Decision logic
| Condition | Action |
|---|---|
| critical guardrail breach | abort exposure and execute recovery |
| insufficient sample/time | hold; do not promote |
| telemetry unavailable | follow explicit `UNAVAILABLE` policy |
| system healthy but domain invariant fails | abort; infrastructure health does not override correctness |
| all criteria pass | promote to next cohort |
| ambiguous result | hold/escalate, do not infer success |

---

## PLAY-10-05 — Choose rollback vs roll-forward

### Inputs
- current version/state/schema;
- previous version compatibility;
- external effects;
- data integrity;
- estimated repair time;
- blast radius.

### Decision
Use the framework in §32.7 and record why the selected strategy is lower risk.

### Acceptance
Recovery verified through user/domain/system evidence.

---

## PLAY-10-06 — Introduce or revise a golden path

### Objective
Reduce repeated developer effort/risk without creating a rigid platform constraint.

### Execution
1. Identify repeated job/friction/risk from user evidence.
2. Define protected invariants vs configurable choices.
3. Build the minimum self-service path.
4. Provide documentation and observable error states.
5. Define support/SLO/owner.
6. Pilot with representative teams.
7. Measure task success, lead time, reliability, cognitive load, support burden.
8. Record exceptions and missing capabilities.
9. Iterate or retire.
10. Version/deprecate old path deliberately.

---

## PLAY-10-07 — Emergency production change

### Objective
Mitigate urgent harm faster without abandoning control.

### Preconditions
- incident/severity justifies emergency path;
- authorized break-glass role;
- minimum non-waivable controls known.

### Execution
1. Record trigger/owner.
2. Bound emergency privilege.
3. Apply minimum required verification.
4. Deploy smallest coherent mitigation.
5. Verify impact.
6. Restore normal privilege/pipeline.
7. Complete deferred evidence/review where legitimate.
8. Run retrospective and close bypass gaps.

---

# 36. Checklists and templates

## 36.1 Production release checklist

### Identity and evidence
- [ ] Exact artifact/release-set digest(s) identified
- [ ] Source revision identified
- [ ] Required build provenance verified
- [ ] Required signature/attestation identity verified
- [ ] Required SBOM exists and matches subject
- [ ] Vulnerability/context policy passed or explicit exception accepted
- [ ] REB references the candidate under decision

### Configuration and state
- [ ] Configuration revision reviewed/validated
- [ ] Feature-flag defaults/cohorts confirmed
- [ ] Schema/data migration order is compatible
- [ ] Backfill bounds/stop conditions defined if applicable
- [ ] Previous-version compatibility understood

### Environment and authorization
- [ ] Target environment is correct
- [ ] Actor/controller identity authorized
- [ ] Privileged credentials are scoped
- [ ] Known environment parity gaps considered

### Release
- [ ] Deployment vs release strategy explicit
- [ ] Canary/ring cohort defined if used
- [ ] Observation window defined
- [ ] Health/domain/security guardrails defined
- [ ] Gate `UNAVAILABLE` behavior defined
- [ ] Promotion/abort authority defined

### Recovery
- [ ] Rollback compatibility checked
- [ ] Roll-forward/disable/compensation alternatives known
- [ ] Data recovery path known where relevant
- [ ] Quarantine path exists for supply-chain suspicion

### Post-release
- [ ] Actual runtime artifact identity verified
- [ ] Config/flag state verified
- [ ] User/domain outcomes checked
- [ ] Temporary flags/workarounds have owner + expiry
- [ ] Release record/evidence retained

## 36.2 Release decision record

```yaml
release_id:
change_id:
criticality:
artifact_subjects:
source_revision:
config_revision:
release_evidence_bundle:
policy_version:
policy_result:
exceptions:
rollout_strategy:
health_gates:
recovery_strategy:
decision_owner_or_controller:
decision:
time:
post_release_verification:
```

## 36.3 Platform capability brief

```yaml
capability:
target_users:
job_to_be_done:
current_friction_or_risk:
protected_invariants:
self_service_interface:
allowed_customization:
escape_hatch:
owner:
support:
slo:
security_model:
cost:
success_metrics:
pilot:
deprecation_policy:
```

## 36.4 Supply-chain assurance decision record

```yaml
artifact_or_product:
threats:
criticality:
supplier_risk:
build_risk:
source_risk:
distribution_risk:
required_provenance:
required_signing:
required_sbom:
required_vex_or_vulnerability_context:
required_slsa_properties:
consumer_verification:
evidence_retention:
residual_risk:
approver:
review_trigger:
```

## 36.5 Gate specification

```yaml
gate_id:
purpose:
risk_controlled:
subject:
inputs:
tool_or_service:
PASS:
FAIL:
ERROR:
UNAVAILABLE:
EXCEPTION:
timeout:
retry:
owner:
evidence:
retention:
```

## 36.6 Canary specification

```yaml
candidate:
baseline:
cohort:
allocation:
representativeness:
metrics:
guardrails:
sample_or_traffic_requirement:
minimum_observation_time:
max_observation_time:
promotion_rule:
hold_rule:
abort_rule:
unavailable_signal_rule:
anti_flap:
recovery:
owner:
```

## 36.7 Break-glass record

```yaml
incident_or_trigger:
authorized_role:
privileges_granted:
start:
expires:
minimum_controls:
actions:
artifacts_changed:
deployments:
verification:
privileges_revoked:
deferred_review:
follow_up:
```


---

# 37. Definition of Ready

A delivery capability/change is ready to enter production-release engineering when:

## Change
- [ ] Intended outcome/change is explicit
- [ ] Criticality/risk is classified
- [ ] Source/revision ownership is known
- [ ] Relevant security/privacy/regulatory overlays identified
- [ ] State/schema/configuration effects identified

## Build and supply chain
- [ ] Build path and artifact type known
- [ ] Dependency strategy defined
- [ ] Required provenance/signing/SBOM posture selected from threat/risk
- [ ] Artifact repository/distribution path identified
- [ ] CI trust boundaries known

## Verification
- [ ] Required CI/release checks selected from actual failure modes
- [ ] Gate failure/unavailable semantics defined
- [ ] Required independent evidence identified
- [ ] Environment/test gaps known

## Release and recovery
- [ ] Deployment vs release model chosen
- [ ] Progressive delivery evaluability decided
- [ ] Migration ordering known
- [ ] Recovery candidates identified
- [ ] Observability/runtime identity mechanism available

## Governance
- [ ] Release decision authority defined
- [ ] Exception path defined
- [ ] Evidence retention requirements known
- [ ] Human vs automated decision boundaries explicit
- [ ] AI/agent privilege boundaries explicit if applicable

---

# 38. Definition of Done

A release capability or major delivery-system change can be considered production-ready when all applicable conditions are satisfied.

## Architecture and trust
- [ ] Delivery threat model covers source → build → evidence → artifact → promotion → deploy → runtime
- [ ] Trust boundaries and privileged identities are explicit
- [ ] Artifact identity is immutable/content-addressed where supported
- [ ] Artifact repository/cache trust is addressed
- [ ] Consumer-side verification exists for evidence relied upon

## Build
- [ ] Build is controlled/versioned/observable
- [ ] Undeclared inputs are minimized or understood
- [ ] Dependency resolution is controlled
- [ ] Build cache policy exists where cache is material
- [ ] Reproducibility/hermeticity decisions are justified rather than assumed
- [ ] Build signing/attestation authority cannot be trivially reached by untrusted steps at high assurance

## CI
- [ ] Fast blocking checks correspond to named risks
- [ ] Deeper checks are correctly placed
- [ ] Required checks are not normalized as flaky
- [ ] Gate `ERROR/UNAVAILABLE/EXCEPTION` semantics are defined
- [ ] Untrusted PR/fork paths cannot access privileged secrets/actions
- [ ] CI output is attributable to the revision/artifact under decision

## Supply chain
- [ ] Dependency/supplier due diligence is proportionate
- [ ] Pinning/locking and update strategy coexist
- [ ] Provenance requirements are explicit
- [ ] SBOM subject/scope/freshness/correction/distribution are explicit where required
- [ ] Vulnerability/VEX handling is contextual and owned
- [ ] Signing trust policy is explicit
- [ ] Trust rotation/revocation path exists
- [ ] Secure update/TUF-like controls considered where distribution threat justifies them

## Environment and release
- [ ] Semantic environment differences that affect correctness are known
- [ ] Production configuration is validated/versioned appropriately
- [ ] Feature flags have owners/lifecycle
- [ ] Exact release candidate + REB exist
- [ ] Release policy identifies artifact/config/evidence versions
- [ ] Deployment/release telemetry correlates behavior to the change
- [ ] Post-deploy actual runtime identity can be checked where feasible

## Progressive delivery and recovery
- [ ] Progressive rollout is used only where evaluable
- [ ] Promotion/abort rules exist
- [ ] Automated rollback has trustworthy trigger + compatible state if used
- [ ] Roll-forward/disable/compensate/restore alternatives are defined
- [ ] Schema/data migrations are compatible with rollout/recovery
- [ ] Recovery has been tested in proportion to risk
- [ ] Supply-chain quarantine/trust-reset path exists for material systems

## Platform
- [ ] Platform capability has users/jobs-to-be-done
- [ ] Self-service and ownership are clear
- [ ] Platform failure/degraded path is known
- [ ] Golden paths have controlled escape/exception paths
- [ ] Platform outcomes are measured, not catalog size
- [ ] Shared templates/actions/platform components are governed as dependencies

## Governance and AI
- [ ] Manual approvals exist only where they add material assurance/authority
- [ ] Exceptions are bounded and expire/review
- [ ] Break-glass path is auditable
- [ ] AI-generated production-affecting output receives independent verification
- [ ] Model/agent cannot self-authorize material production actions
- [ ] High-impact agent actions have kill/revoke/recovery paths

## Evidence and learning
- [ ] Traceability from change to runtime exists at the required assurance level
- [ ] Release evidence retention is defined
- [ ] Relevant delivery metrics have decision use and gaming risks documented
- [ ] Incident/near-miss/exception feedback path exists
- [ ] No unresolved BLOCKER defect remains
- [ ] MAJOR defects are zero or explicitly accepted under the applicable governance model

---

# 39. Validation and test strategy

This playbook follows Playbook 00's principle that a researched document is not validated merely because it is comprehensive. [P00]

## 39.1 Required V2 validation scenarios

Before promoting this playbook from `REVIEWED` to `TESTED`, execute at least the following scenarios with a competent non-author reviewer/operator.

### Scenario A — Ordinary SaaS release
- stateless service;
- normal package dependencies;
- cloud deployment;
- canary available;
- routine database-compatible change.

Validate that the standard remains usable without unnecessary high-assurance ceremony.

### Scenario B — Stateful schema migration
- mixed application versions;
- expand/migrate/contract;
- backfill;
- rollback incompatibility discovered mid-rollout.

Validate roll-forward/disable/compensation logic.

### Scenario C — Compromised dependency
- transitive dependency compromised;
- SBOM and provenance available;
- multiple deployed versions.

Validate impact discovery, quarantine, clean rebuild, and rollout.

### Scenario D — Compromised signing/build path
- signer identity suspected;
- previous provenance no longer fully trusted;
- emergency remediation required.

Validate trust-reset rather than circular re-attestation.

### Scenario E — Desktop/mobile/firmware-like distribution
- clients cannot be forcibly rolled back;
- long-lived trust;
- update replay/freeze concerns.

Validate update-distribution and key model boundaries.

### Scenario F — Internal platform rollout
- platform provides a golden path;
- one product team has legitimate unsupported requirements.

Validate self-service, exception, autonomy, and feedback rather than “golden cage.”

### Scenario G — AI agent modifies CI/CD
- agent reads untrusted PR/log content;
- proposes pipeline change;
- attempts production action.

Validate external policy, permissions, independent evidence, and kill/revoke.

### Scenario H — Gate dependency outage
- required scanner/policy service unavailable during urgent production incident.

Validate explicit `UNAVAILABLE` semantics and break-glass governance.

## 39.2 Test levels

Use, proportionately:

- desk review of logic/evidence;
- tabletop release walkthrough;
- dry-run in isolated environment;
- shadow execution against current process;
- supervised live release;
- adversarial supply-chain scenario;
- recovery game day;
- platform pilot with representative teams;
- regression test after material playbook change.

## 39.3 Validation evidence to retain

```yaml
scenario:
playbook_version:
tester:
baseline_competence:
system_context:
criticality:
path_used:
ambiguities:
unsafe_or_wrong_behavior:
time_burden:
result:
defects:
changes_required:
retest:
```

---

# 40. Traceability and assurance spine

For C2+ material releases, traceability SHOULD be recoverable across:

```text
REQUIREMENT / CHANGE
→ SOURCE REVISION
→ REVIEW / POLICY
→ BUILD
→ ARTIFACT DIGEST
→ TEST / PROVENANCE / SBOM / SIGNATURE
→ RELEASE EVIDENCE BUNDLE
→ PROMOTION DECISION
→ DEPLOYMENT
→ ACTUAL RUNTIME IDENTITY
→ PRODUCTION OUTCOME
→ INCIDENT / LEARNING
```

For C3/C4, use explicit stable IDs and retained evidence where applicable.

## 40.1 Traceability matrix

| ID | Requirement / risk | Control | Evidence | Artifact / subject | Policy decision | Runtime verification | Status |
|---|---|---|---|---|---|---|---|

## 40.2 Orphan checks

Higher-assurance audit SHOULD detect:

- policy with no enforcing control;
- control with no test;
- test with no current risk/requirement;
- artifact with no source/build lineage;
- provenance not verified by any consumer;
- SBOM never used by response/procurement/security;
- signature with no authorization policy;
- deployment with no actual runtime identity;
- exception with no expiry;
- platform path with no owner;
- alert/metric with no decision use.

---

# 41. Audit standard for delivery systems

Audit the operating capability, not only the pipeline files.

## 41.1 Audit dimensions

### Scope
Does the delivery system cover the actual product/distribution path?

### Source/change
Can unauthorized source/workflow/config changes bypass control?

### Build
Can hidden/untrusted input change the artifact? Can one build influence another?

### Dependency/supplier
Are privileged dependencies intentionally selected, monitored, and updated?

### Evidence
Does provenance/SBOM/signing refer to the correct subject? Is evidence verified?

### Artifact repository
Can artifacts/tags/evidence be replaced or deleted without detection?

### Identity
Are workload/user permissions scoped? Are trust conditions correct?

### Environment/config
Can production behavior change outside the recorded release path?

### Progressive delivery
Are canary signals representative and attributable?

### Recovery
Has rollback/forward/restore/quarantine behavior actually been exercised?

### Platform
Does the platform reduce friction/risk or create a brittle mandatory dependency?

### AI
Can an agent cross from untrusted content into privileged action or self-approval?

### Learning
Do incidents/exceptions change controls or only create documentation?

## 41.2 Adversarial questions

Ask:

- What if the source maintainer is compromised?
- What if the CI platform is compromised?
- What if the builder is malicious?
- What if the cache is poisoned?
- What if the registry tag moves?
- What if the artifact repository is unavailable?
- What if the signer is compromised?
- What if OIDC claims are overbroad?
- What if the SBOM is incomplete?
- What if vulnerability intelligence changes after release?
- What if the scanner is down?
- What if the canary cohort never exercises the failing path?
- What if rollback restores old code against new data?
- What if the platform team releases a broken shared template?
- What if an agent follows malicious instructions embedded in a build log?
- What clean trust source remains after compromise?

---

# 42. Lifecycle, versioning, review, and change control

## 42.1 Status

```text
DRAFT
→ REVIEWED
→ TESTED
→ VALIDATED
→ SUPERSEDED / DEPRECATED
```

This V2 is `REVIEWED`.

## 42.2 Versioning

Use semantic intent:

- `MAJOR` — changes protected invariants, decision logic, operating model, or compatibility;
- `MINOR` — backward-compatible capabilities/Plays/evidence;
- `PATCH` — non-material clarification/source refresh.

## 42.3 Event-triggered review

Review this specialist standard when:

- SLSA changes approved version/track status;
- SSDF or relevant NIST guidance changes status;
- SPDX/CycloneDX/TUF/Sigstore materially change;
- DORA capability/metric research changes;
- a major software-supply-chain incident reveals a missing control;
- new distribution/update technology changes trust assumptions;
- AI/agent delivery control practice materially changes;
- one of the V2 validation scenarios fails.

## 42.4 Change record

```yaml
version:
date:
reason:
sections:
behavior_or_decision_impact:
sources_added_removed:
falsification_targets:
tests_run:
defects:
migration_required:
reviewer:
status:
```

---

# 43. V1 → V2 correction log

| Audit finding | V2 correction |
|---|---|
| SLSA current/draft status needed precision | explicit approved v1.2 baseline + draft watch-items |
| Build once too absolute | same artifact default + platform-specific lineage exception |
| Environment parity too absolute | semantic parity + parity-gap register |
| Reproducible vs hermetic conflated | separate definitions and assurance roles |
| SLSA criticality mapping too rigid | threat/property decision framework |
| Trunk-based too strong | contextual branch decision |
| Every check every commit | layered check lanes |
| Green CI false assurance | CI as evidence, not releasability proof |
| Gates can add false assurance | named-risk gates + error/unavailable semantics |
| Signature ≠ trust | five-part signing/trust model |
| Keyless not universally superior | keyless/key-based decision model |
| Build/sign authority | explicit high-assurance separation |
| SBOM freshness/completeness | operational SBOM policy |
| CVE count misuse | VEX/product-context workflow |
| Secure updates underweighted | TUF/update-distribution section |
| Mutable tags | digest-first identity hierarchy |
| Canary conditional | canary evaluability gate |
| Blue/green nuance | traffic vs state reversal |
| Auto rollback risk | trustworthy trigger + anti-flap + state compatibility |
| Roll-forward underweighted | first-class recovery menu |
| GitOps contextual | explicit fit decision |
| Platform can harm | platform-as-product + outcome measures |
| Golden cage | escape/exception/lifecycle controls |
| Manual approval weak | evidence/authority criteria |
| Separation of duties legitimate | retained where threat/regulation warrants |
| DORA Goodhart risk | balanced measurement + anti-metrics |
| Scorecard not truth | signal-only policy |
| Bots not independent | automation tiers + independent evidence |
| Scanner/gate outage | `UNAVAILABLE` semantics |
| Cache underweighted | cache trust model |
| Registry underweighted | dedicated security-boundary controls |
| Intended vs actual runtime | post-deploy runtime identity verification |
| Supply-chain trust reset | clean trust path Play |
| AI pipeline boundary | deterministic policy + scoped identity + no self-approval |
| Cross-repo releases | release-set model |
| Break glass | explicit emergency Play |
| Evidence retention | REB/retention fields |
| Client rollback limits | mobile/desktop/firmware compatibility section |

---

# 44. Research sanity check

## 44.1 High-confidence findings

### A. Delivery infrastructure is security-critical production infrastructure
Supported by SSDF, GitHub CI security guidance, SLSA, NIST DevSecOps, and operational practice.  
**Confidence: HIGH.**

### B. Exact artifact identity is foundational
Content-addressed artifact models and provenance depend on unambiguous subject identity.  
**Confidence: HIGH.**

### C. Provenance, signatures, SBOMs, vulnerability scans, and test results answer different questions
No reviewed source supports collapsing them into one assurance claim.  
**Confidence: HIGH.**

### D. Supply-chain evidence must be verified
Evidence that is produced but never evaluated at a policy/consumer boundary provides weak operational assurance.  
**Confidence: HIGH.**

### E. Pinning and deliberate updating are complementary
Pinning prevents uncontrolled movement; updates prevent vulnerability/support stagnation.  
**Confidence: HIGH.**

### F. Progressive delivery is conditional
Canaries reduce blast radius only when the cohort and signals can detect the target failure.  
**Confidence: HIGH.**

### G. Rollback is state-dependent
Application binary reversal can be unsafe after incompatible data/schema/external effects.  
**Confidence: HIGH.**

### H. Platform engineering is not automatically beneficial
Current DORA/CNCF evidence supports product/self-service/platform thinking while DORA also reports mixed negative delivery effects from poor platform implementations.  
**Confidence: HIGH** for conditionality; exact effect sizes remain context-dependent.

### I. DORA metrics should not become performance quotas
DORA itself emphasizes balanced throughput/instability interpretation and anti-gaming.  
**Confidence: HIGH.**

### J. Manual approval is not automatically safer
Review quality depends on competence, evidence, authority, and actual judgment.  
**Confidence: HIGH** as a general governance principle.

## 44.2 Strong contextual mechanisms

- trunk-based development;
- GitOps;
- SLSA level selection;
- keyless signing;
- reproducible/hermetic builds;
- blue/green;
- canary;
- feature flags;
- automated rollback;
- platform engineering;
- TUF-like update architecture;
- manual approval/separation of duties.

These are powerful because of their mechanisms, not because they are fashionable labels.

## 44.3 House synthesis

The following are `HOUSE` constructs:

- the exact Golden Delivery Standards list;
- the Release Evidence Bundle schema;
- the delivery assurance formula;
- the exact layered CI lanes;
- the exact gate result taxonomy;
- the canary evaluability gate;
- the exact recovery menu;
- the platform capability brief;
- the cross-domain Definition of Done;
- the V2 criticality/control mapping;
- the exact traceability spine.

They synthesize external evidence but are not external standards.

## 44.4 Remaining unknowns to validate in use

1. Whether the REB is lightweight enough for C1/C2 teams.
2. Which evidence should be stored inline vs referenced.
3. How much runtime identity verification is feasible across serverless/managed platforms.
4. Which platform outcome metrics best detect “golden cage” effects without survey overload.
5. How organizations should balance fail-closed security gates with emergency availability.
6. Which AI-agent delivery controls can be safely automated without rubber-stamp human review.
7. How much SBOM/VEX depth produces decision value for smaller products.
8. Which cross-repository release-set patterns reduce risk without recreating monolithic release coupling.

These MUST be resolved through field use, not invented certainty.

---

# 45. Source register and evidence map

> Sources have different roles. A formal standard/specification defines scoped semantics or controls; operational guidance demonstrates mature mechanisms; industry research supplies empirical signals; platform documentation is authoritative for its platform. Inclusion does not mean equal weight.

## Parent standards

### P00 — Master Playbook Standard v2.0-RC1
**Source:** uploaded canonical parent playbook.  
**Used for:** risk-proportionate rigor, evidence/claim taxonomy, falsification, verification/validation, traceability, quality gates, statuses, human+AI control design.  
**Limitation:** meta-standard; it does not define DevOps implementation details.

### ENG00 — Universal Software & AI Engineering Master Playbook v2.0
**Source:** uploaded engineering master playbook.  
**Used for:** supply-chain baseline, build/configuration discipline, CI/CD/release doctrine, rollback limits, production readiness, anti-dogma rules, risk-proportionate engineering.  
**Limitation:** root engineering standard; specialist implementation depth belongs here.

## Supply-chain standards and specifications

### SLSA01 — SLSA v1.2 Specification
**Institution:** OpenSSF / SLSA community.  
**Status at cutoff:** approved/current v1.2.  
**URL:** https://slsa.dev/spec/v1.2/  
**Used for:** Build/Source tracks, provenance concepts, progressive supply-chain guarantees.  
**Limitation:** does not prove product correctness/security and must not be mechanically equated to application criticality.

### SLSA02 — SLSA Build Track / Provenance
**Institution:** OpenSSF / SLSA.  
**URL:** https://slsa.dev/spec/v1.2/levels  
**Used for:** build provenance, authenticated provenance, hardened build-service properties, builder/provenance reasoning.  
**Limitation:** exact applicability depends on ecosystem and threat model.

### SLSA03 — SLSA working/draft track status
**Institution:** OpenSSF / SLSA.  
**URL:** https://slsa.dev/  
**Used for:** status discipline: Build Environment / Dependency-related newer work remains draft/watch rather than silently replacing approved v1.2.  
**Limitation:** draft content can change.

### INTOTO01 — in-toto v1.0 / Attestation Framework
**Institution:** in-toto / Linux Foundation ecosystem.  
**URL:** https://in-toto.io/  
**Used for:** explicit supply-chain step/actor layout and link/attestation reasoning.  
**Limitation:** contextual architecture; not necessary for every low-risk delivery path.

### SPDX01 — SPDX 3.0
**Institution:** SPDX / Linux Foundation.  
**URL:** https://spdx.dev/use/specifications/  
**Used for:** standardized SBOM/supply-chain data representation.  
**Limitation:** data representation; document quality and security depend on generation/provenance/use.

### CDX01 — CycloneDX 1.7
**Institution:** OWASP CycloneDX.  
**URL:** https://cyclonedx.org/specification/overview/  
**Used for:** BOM/component/service/dependency/vulnerability/formulation representation.  
**Limitation:** transparency format, not product-security proof.

### CISA01 — CISA 2025 Minimum Elements for an SBOM
**Institution:** U.S. Cybersecurity and Infrastructure Security Agency.  
**URL:** https://www.cisa.gov/resources-tools/resources/2025-minimum-elements-software-bill-materials-sbom  
**Used for:** release/build freshness, transitive dependency depth, known unknowns, distribution, correction.  
**Limitation:** U.S. federal minimum-elements guidance; applicability and required disclosure vary.

### VEX01 — CSAF 2.0 VEX / CycloneDX VEX
**Institutions:** OASIS / OWASP CycloneDX.  
**URLs:**  
- https://docs.oasis-open.org/csaf/csaf/v2.0/  
- https://cyclonedx.org/capabilities/vex/  
**Used for:** product-specific vulnerability status/context.  
**Limitation:** VEX assertion quality depends on producer evidence and trust.

### TUF01 — The Update Framework
**Institution:** Linux Foundation / CNCF-hosted security project ecosystem.  
**URL:** https://theupdateframework.io/  
**Used for:** software-update threat model including rollback/freeze/mix-and-match/mirror/key compromise and signed metadata role separation.  
**Limitation:** heavier than necessary for many internal deploy paths.

### REPRO01 — Reproducible Builds definition
**Institution:** Reproducible Builds project.  
**URL:** https://reproducible-builds.org/docs/definition/  
**Used for:** precise reproducible-build definition.  
**Limitation:** reproducibility proves consistency, not source trust/security.

### OCI01 — OCI Image Specification
**Institution:** Open Container Initiative.  
**URL:** https://specs.opencontainers.org/image-spec/  
**Used for:** content-addressable descriptors/digests and artifact identity reasoning.  
**Limitation:** image/object identity semantics do not define full release security.

## NIST / public secure-development guidance

### NIST01 — NIST SP 800-218 — Secure Software Development Framework (SSDF) v1.1
**Institution:** NIST.  
**Status:** final/current baseline at cutoff.  
**URL:** https://csrc.nist.gov/pubs/sp/800/218/final  
**Used for:** secure development, protecting software/components, integrity/provenance concepts.  
**Limitation:** high-level framework; implementation is context-specific.

### NIST02 — NIST SP 800-218 Rev.1 / SSDF v1.2 Initial Public Draft
**Institution:** NIST.  
**Status:** Initial Public Draft at cutoff.  
**URL:** https://csrc.nist.gov/pubs/sp/800/218/r1/ipd  
**Used for:** watch item/current direction.  
**Limitation:** not final; MUST NOT silently replace v1.1.

### NIST03 — NIST NCCoE DevSecOps Practices live document
**Institution:** NIST NCCoE.  
**Status:** active/live applied guidance in 2026.  
**URL:** https://www.nccoe.nist.gov/projects/secure-software-development-security-and-operations-devsecops-practices  
**Used for:** current applied DevSecOps implementation mapping and examples.  
**Limitation:** live/draft practice guidance rather than final universal normative architecture.

### NIST04 — NIST SP 1326 — C-SCRM Due Diligence Assessment Quick-Start Guide
**Institution:** NIST.  
**Status:** final July 2026.  
**URL:** https://csrc.nist.gov/pubs/sp/1326/final  
**Used for:** supplier provenance, resilience, foundational cyber practices, supply-chain tiers, due diligence.  
**Limitation:** supplier due-diligence guide, not proof a product/supplier is secure.

## Delivery / reliability / platform evidence

### DORA01 — Continuous Delivery capability
**Institution:** DORA / Google Cloud.  
**URL:** https://dora.dev/capabilities/continuous-delivery/  
**Used for:** continuous delivery vs continuous deployment, integrated capability model.  
**Limitation:** application/service delivery context; local constraints matter.

### DORA02 — Continuous Integration capability
**Institution:** DORA.  
**URL:** https://dora.dev/capabilities/continuous-integration/  
**Used for:** frequent integration, fast feedback, automated tests, fixing broken builds, small batches.  
**Limitation:** exact branching/check architecture remains contextual.

### DORA03 — Deployment automation / version control capabilities
**Institution:** DORA.  
**URLs:**  
- https://dora.dev/capabilities/deployment-automation/  
- https://dora.dev/capabilities/version-control/  
**Used for:** same deployable packages, config separation, artifact repositories, production-affecting state under version control.  
**Limitation:** complex environments cannot be made perfectly reproducible merely by versioning intent.

### DORA04 — Platform Engineering capability / 2024–2026 research
**Institution:** DORA.  
**URL:** https://dora.dev/capabilities/platform-engineering/  
**Used for:** platform-as-product, self-service/golden paths, extensibility, feedback, balanced outcomes; evidence that platform quality can help or hurt delivery.  
**Limitation:** empirical organizational evidence, not one required platform architecture.

### DORA05 — DORA metrics
**Institution:** DORA.  
**URL:** https://dora.dev/guides/dora-metrics/  
**Used for:** current five-metric throughput/instability model and anti-gaming interpretation.  
**Limitation:** system/team delivery diagnostics, not individual productivity targets.

### DORA06 — Change approval
**Institution:** DORA.  
**URL:** https://dora.dev/capabilities/streamlining-change-approval/  
**Used for:** peer review/automation over heavyweight external change boards as general delivery practice.  
**Limitation:** separation/legal approvals remain valid when independently required.

### SRE01 — Google SRE Workbook — Canarying Releases
**Institution:** Google.  
**URL:** https://sre.google/workbook/canarying-releases/  
**Used for:** limited production exposure, representativeness, observation windows, signal attribution, canary limitations.  
**Limitation:** large-scale online-service context; other distribution models differ.

### SRE02 — Google SRE — Release Engineering
**Institution:** Google.  
**URL:** https://sre.google/sre-book/release-engineering/  
**Used for:** automated/reproducible build/release processes, frequent releases, release-engineering principles.  
**Limitation:** Google-scale implementation should not be copied literally.

### CNCF01 — CNCF Platforms White Paper
**Institution:** Cloud Native Computing Foundation.  
**URL:** https://tag-app-delivery.cncf.io/whitepapers/platforms/  
**Used for:** platform concepts, self-service, golden paths/paved roads, developer enablement.  
**Limitation:** cloud-native practitioner guidance.

### CNCF02 — CNCF Platform Engineering / maturity guidance
**Institution:** CNCF.  
**URL:** https://tag-app-delivery.cncf.io/  
**Used for:** platform capability/maturity, customization/guardrail reasoning.  
**Limitation:** field framework, not causal proof of one maturity sequence.

### GITOPS01 — OpenGitOps Principles v1.0
**Institution:** OpenGitOps / CNCF ecosystem.  
**URL:** https://opengitops.dev/  
**Used for:** declarative, versioned/immutable, pulled automatically, continuously reconciled principles.  
**Limitation:** contextual pattern; not all delivery is declarative/reconcilable.

## Platform-specific security evidence used as implementation examples

### GH01 — GitHub Actions Secure Use Reference
**Institution:** GitHub.  
**URL:** https://docs.github.com/en/actions/reference/security/secure-use  
**Used for:** least privilege and full-length commit SHA pinning for third-party actions.  
**Limitation:** GitHub-specific implementation guidance.

### GH02 — GitHub Actions OpenID Connect
**Institution:** GitHub.  
**URL:** https://docs.github.com/en/actions/concepts/security/openid-connect  
**Used for:** short-lived federated workload credentials and trust conditions.  
**Limitation:** security depends on provider-side IAM/trust policy.

### GH03 — GitHub Artifact Attestations
**Institution:** GitHub.  
**URL:** https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations  
**Used for:** example of platform-generated cryptographically signed build provenance bound to repo/workflow/commit identity.  
**Limitation:** GitHub-specific; attestation still requires verification/policy.

### SIG01 — Sigstore security model / keyless signing
**Institution:** Sigstore.  
**URL:** https://docs.sigstore.dev/about/security/  
**Used for:** ephemeral keys, OIDC-bound short-lived certificates, transparency, verification/trust model.  
**Limitation:** identity/CA/transparency trust remains; keyless is not universally optimal.

### OSSF01 — OpenSSF Scorecard
**Institution:** OpenSSF.  
**URL:** https://scorecard.dev/  
**Used for:** repository practice/risk signals such as dangerous workflows, pinned dependencies, permissions, branch protection.  
**Limitation:** aggregate score is not proof of security or universal allow/deny criterion.

---

# 46. Falsification evidence summary

The final standard was challenged against the following claims and rejected the universal form of each:

```text
GREEN CI = RELEASABLE
MORE GATES = SAFER
TRUNK-BASED = ALWAYS BEST
EVERY CHECK = EVERY COMMIT
REPRODUCIBLE = SECURE
HERMETIC = MANDATORY
HIGHER SLSA = SECURE PRODUCT
SIGNED = TRUSTED
KEYLESS = ALWAYS SUPERIOR
SBOM = SECURE
ANY CVE = BLOCK
STAGING = PRODUCTION PROOF
CANARY = ALWAYS SAFER
BLUE/GREEN = TRIVIAL ROLLBACK
AUTO-ROLLBACK = ALWAYS SAFER
ROLLBACK = DEFAULT
GITOPS = END STATE
PLATFORM = ALWAYS GOOD
ONE GOLDEN PATH = MATURE
MANUAL APPROVAL = SAFETY
NO SEPARATION OF DUTIES = DEVOPS
MAX DEPLOY FREQUENCY = PERFORMANCE
MUTABLE TAG = IDENTITY
SCANNER PASS = ARTIFACT SAFE
DEPENDENCY BOT = INDEPENDENT REVIEW
IAC = FULL REPRODUCIBILITY
AI SELF-REVIEW = ASSURANCE
```

The surviving mechanisms are encoded with boundary conditions in V2.

---

# 47. One-page Golden Standard

If only one section of this playbook may be used:

1. Treat source control, CI/CD, builders, caches, artifact stores, signers, deploy controllers, and internal platforms as production systems.
2. Identify every material release by immutable artifact content identity.
3. Preserve traceable lineage from running artifact back to deployment, policy, evidence, build, dependencies, source, and change.
4. Keep production-affecting source/config/pipeline/policy/migrations under controlled change.
5. Integrate frequently enough to prevent dangerous divergence; do not universalize one branching model.
6. Layer CI checks by risk and feedback cost; define `PASS/FAIL/ERROR/UNAVAILABLE/EXCEPTION`.
7. A green pipeline is evidence, not proof of production readiness.
8. Pin/lock material dependencies where uncontrolled movement matters; monitor and deliberately update.
9. Treat privileged actions/plugins/base images/build tooling as dependencies with their own provenance and update policy.
10. Build through a controlled process and record the inputs/identity required for your assurance level.
11. Use reproducibility/hermeticity when their assurance value justifies them; neither means secure.
12. Promote an exact verified artifact or explicit sibling artifact lineage, not an ambiguous mutable tag.
13. Harden the artifact repository and build cache as security boundaries.
14. Use provenance to explain artifact origin/build; verify it at the consumer policy boundary.
15. Use SBOMs as inventory evidence with explicit subject, scope, freshness, correction, and distribution.
16. Use VEX/context to improve vulnerability decisions without treating it as unchallengeable truth.
17. Treat signatures as cryptographic evidence, then separately verify identity, authorization, provenance, and policy.
18. Choose keyless/key-based/threshold signing from the trust/distribution/lifetime model.
19. Prefer short-lived scoped workload identity over static secrets where supported, but constrain federation policy.
20. Preserve semantic environment parity; record meaningful differences rather than chasing cosmetic sameness.
21. Treat production configuration and feature flags as versioned/owned executable state.
22. Distinguish CI, continuous delivery, continuous deployment, deployment, and release.
23. Progressive delivery is useful only when the target failure is observable and exposure is bounded.
24. Verify the actual artifact/config running after deployment where feasible.
25. Co-design migrations with rollout and recovery.
26. Choose rollback, roll-forward, disable, compensate, restore, or quarantine from state compatibility.
27. Automatic rollback requires trustworthy signals, compatible state, and anti-flap safeguards.
28. Use TUF-like update protections when rollback/freeze/mirror/key-compromise threats justify them.
29. Build platforms as user-centered self-service products with safe defaults, observability, lifecycle ownership, and escape paths.
30. GitOps is a contextual reconciliation pattern, not a universal maturity target.
31. Automate deterministic policy; use humans where competence, judgment, authority, or separation adds assurance.
32. Define a bounded break-glass path before an incident.
33. Preserve a Release Evidence Bundle for material releases.
34. Make supply-chain incident response capable of quarantine, exposure discovery, and clean trust reset.
35. Treat AI-generated pipeline/config/deployment changes as untrusted until independently verified.
36. Model/agent output is not authorization.
37. Measure safe valuable flow with balanced throughput, instability, assurance, platform, and user/business outcomes.
38. Use DORA metrics diagnostically; never mechanically rank individuals by them.
39. Keep every strong pattern tied to the failure mode it controls.
40. When evidence is uncertain or contextual, preserve the boundary condition instead of inventing a universal rule.

---

# 48. Release status and next validation gate

This V2 satisfies the **research/falsification and construction-verification** intent of Playbook 00 to the extent possible in this authoring pass:

- parent standards were used explicitly;
- current high-value sources were freshness-checked;
- V1 was frozen before falsification;
- 37 material V1 findings were recorded;
- strong claims were downgraded where boundary conditions broke them;
- missing trust boundaries and failure modes were added;
- V2 includes decision logic, Plays, runbooks/checklists, evidence map, traceability, Definition of Ready/Done, and explicit field-validation scenarios.

It remains `REVIEWED`.

To become `TESTED`, execute the representative scenarios in §39 with competent non-author users/operators and close resulting BLOCKER/MAJOR defects.

To become `VALIDATED`, demonstrate fitness in representative real delivery contexts and satisfy the applicable Definition of Done under the Master Playbook Standard.

---

# 49. Change log

## v2.0-RC1 — 2026-09-27

Research-reviewed and falsification-weighted Golden Master candidate.

Major changes from V1:

- moved from “pipeline” framing to end-to-end delivery chain of custody;
- added explicit delivery threat model;
- expanded Golden Delivery Standards from 72 draft candidates to 100 risk-bounded rules;
- introduced Release Evidence Bundle;
- added consumer-side provenance/signature/evidence verification;
- separated artifact identity, cryptographic validity, signer identity, authorization, provenance, and release policy;
- added SBOM freshness/completeness/correction/distribution and VEX context;
- added TUF/update-distribution decision logic;
- added build-cache and artifact-repository trust boundaries;
- added layered CI check lanes and explicit gate outage/error semantics;
- replaced rigid SLSA-level mapping with threat/property decision framework;
- refined build-once to multi-platform artifact lineage;
- added canary evaluability and anti-flap controls;
- made runtime identity verification first-class;
- elevated roll-forward/disable/compensate/restore/quarantine beside rollback;
- added client/mobile/desktop/firmware rollback boundaries;
- deepened platform-as-product, platform SLO, escape-hatch, golden-path lifecycle, and platform supply-chain controls;
- retained GitOps as contextual rather than universal;
- strengthened approval/separation-of-duties/break-glass governance;
- added supply-chain trust-reset Play;
- strengthened AI/agent pipeline authorization and independent-evidence controls;
- added validation scenarios, audit standard, Definition of Ready/Done, and formal traceability spine.

---

# 50. Final doctrine

A mature DevOps system is not the system with the most automation, the most deployment frequency, the largest internal platform, the highest framework badge, or the longest compliance checklist.

It is the system in which a competent team can answer, quickly and with evidence:

> **What changed? Who or what was authorized to change it? What exact artifact is this? How was it built? What did it depend on? What evidence supports releasing it? Which policy evaluated that evidence? What is actually running? How is the change behaving? What can we safely do if it is wrong? And how do we re-establish trust if the delivery system itself is compromised?**

The V2 operating chain is therefore:

```text
UNDERSTAND THE CHANGE
→ CONTROL SOURCE + AUTHORITY
→ CONTROL BUILD INPUTS
→ IDENTIFY THE ARTIFACT
→ PRODUCE DISTINCT EVIDENCE
→ VERIFY EVIDENCE UNDER POLICY
→ PROMOTE EXACT IDENTITY
→ RELEASE PROGRESSIVELY WHEN EVALUABLE
→ VERIFY ACTUAL RUNTIME
→ RECOVER ACCORDING TO STATE
→ RESET TRUST WHEN NECESSARY
→ LEARN + IMPROVE THE DELIVERY SYSTEM
```

That is the canonical standard for `10 — DevOps, CI/CD, Release, Platform & Software Supply Chain`.
