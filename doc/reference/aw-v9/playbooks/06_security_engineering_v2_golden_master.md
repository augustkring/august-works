# 06 — Security Engineering — V2.0 Research-Audited Golden Master

> **Evergreen secure-by-design engineering standard for system security, application security, identity, authorization, secrets, cryptography, threat modeling, abuse resistance, vulnerability management, assurance, detection, response, recovery, and security lifecycle governance**

```yaml
document_id: SWE-06-SECURITY
title: "06 — Security Engineering"
artifact_type: specialist_engineering_playbook
primary_archetype:
  - Operating
  - Capability
  - Decision
  - Execution
  - Response
version: "2.0"
release_label: "RESEARCH_AUDITED_GOLDEN_MASTER"
lifecycle_status: REVIEWED
created: 2026-09-28
last_updated: 2026-09-28
last_reviewed: 2026-09-28
evidence_cutoff: 2026-09-28
canonical_language: English
owner_role: Security Engineering Capability Owner
owner_assignment: REQUIRED_BEFORE_VALIDATED
research_rigor: R4_CRITICAL
operational_rigor: risk_proportionate_C0_to_C4
default_production_posture: C2_MATERIAL
critical_overlays:
  - C3_HIGH_ASSURANCE
  - C4_DOMAIN_SPECIFIC
volatility:
  core_security_principles: MODERATE
  threat_intelligence: FAST
  vulnerability_status: REAL_TIME
  identity_and_protocol_guidance: FAST
  AI_agent_security: FAST
  legal_regulatory_overlays: FAST
research_design:
  - parent_standard_inheritance_review
  - current_primary_standard_status_verification
  - targeted_scoping_review
  - foundational_security_principle_review
  - adversarial_falsification_audit
  - contradiction_search
  - claim_to_source_fit_audit
  - scenario_dry_runs
  - freshness_watchlist
validation_state:
  research_review: complete
  v1_candidate: complete
  adversarial_falsification_audit: complete
  v2_synthesis: complete
  mechanical_document_audit: complete
  non_author_field_execution: pending
  independent_security_expert_review: pending
  representative_repository_or_system_trials: pending
next_scheduled_review: 2026-12-28
review_triggers:
  - material security incident or near miss
  - new high-severity attack class
  - material NIST SSDF revision/finalization
  - material OWASP ASVS, SAMM, WSTG, API or GenAI security revision
  - material MITRE ATT&CK/CWE/CAPEC revision
  - material NIST digital identity or zero-trust revision
  - cryptographic deprecation or cryptanalytic break
  - material IETF/W3C authentication, federation, TLS or authorization change
  - material supply-chain standard/specification change
  - applicable legal/regulatory change
  - evidence that a control in this standard systematically creates harm or false assurance
  - representative field-test findings
inherits:
  - "MPS-001 — Master Playbook Standard v2.0-RC1"
  - "Universal Software & AI Engineering Master Playbook v2.0"
interfaces_with:
  - "01 — Requirements, Specification & Domain Engineering"
  - "02 — Software Architecture & System Design"
  - "03 — Engineering Workflow, SDLC & Configuration Management"
  - "04 — Software Construction & Code Quality"
  - "05 — Verification, Validation, Testing & Quality Engineering"
  - "07 — Privacy & Data Protection Engineering"
  - "08 — Reliability, Resilience, Observability & SRE"
  - "09 — Performance, Scalability, Resource & Cost Engineering"
  - "10 — DevOps, CI/CD, Release, Platform & Software Supply Chain"
  - "11 — Maintenance, Evolution, Migration & Technical Debt"
  - "12 — Data, Database & Storage Engineering"
  - "13 — API, Integration & Distributed Systems Engineering"
  - "14 — Web & Frontend Engineering"
  - "15 — Backend, Services & Engine Engineering"
  - "16 — Mobile & Desktop Application Engineering"
  - "17 — Cloud, Infrastructure, Networking & IaC"
  - "18 — AI / ML / LLM Systems Engineering"
  - "19 — Agentic AI Engineering"
  - "20 — Blockchain & Smart Contract Engineering"
  - "21 — Systems, Embedded & Real-Time Engineering"
  - "22 — Language & Runtime Engineering Standards"
legal_status: >
  Engineering standard, not legal advice, certification, regulatory attestation,
  penetration-test report, or guarantee of security. Applicable law, regulation,
  contract, sector standard, platform rule, and safety requirement take precedence.
```

---

## Release-status note

This document is the canonical **V2 research-audited release** of Playbook 06. It was constructed under the Master Playbook Standard's R4 research posture because errors in security guidance can create severe confidentiality, integrity, authorization, financial, safety, privacy, operational, and societal consequences.

`RESEARCH_AUDITED_GOLDEN_MASTER` is a release label, not a claim that the playbook is externally certified or universally proven.

The governing Master Playbook Standard defines `VALIDATED` as a stronger lifecycle state than research review. Representative non-author execution, appropriate independent/domain review, closure or explicit acceptance of material defects, and real-use evidence are still required before this artifact can honestly move from `REVIEWED` to `VALIDATED` [BASE00].

No static security playbook can guarantee a secure system. Threats, implementations, dependencies, operators, users, legal requirements, attack economics, and adversary capabilities change. A secure design claim is therefore always bounded by:

- the actual system and version;
- the actual deployment and configuration;
- the modeled threat and authority boundaries;
- the evidence obtained;
- the time at which that evidence was collected;
- known residual risk and unknowns.

---

# Executive standard

Security engineering is not the act of adding authentication, encryption, a WAF, a scanner, a penetration test, or a compliance checklist to software.

It is the discipline of engineering a socio-technical system so that **only authorized behavior occurs with acceptable confidentiality, integrity, availability, authenticity, isolation, accountability and resilience — even when the system is misused, attacked, partially compromised, misconfigured, overloaded, changed, or operated under adverse conditions**.

The durable security chain is:

```text
MISSION / USER / BUSINESS OUTCOME
→ PROTECTED ASSETS + UNACCEPTABLE HARM
→ AUTHORITY + TRUST + SYSTEM BOUNDARIES
→ ADVERSARIES + ABUSE / THREAT MODEL
→ SECURITY REQUIREMENTS + INVARIANTS
→ LEAST-COMPLEX ADEQUATE ARCHITECTURE
→ PREVENT / CONSTRAIN / ISOLATE
→ VERIFY / ATTACK / FALSIFY
→ IDENTIFIED + CONTROLLED RELEASE
→ OBSERVE / DETECT / INVESTIGATE
→ CONTAIN / REVOKE / RECOVER
→ REMEDIATE ROOT CAUSES
→ LEARN / RE-MODEL / EVOLVE
→ RETIRE ACCESS, DATA, KEYS AND ATTACK SURFACE
```

The governing doctrine is:

> **Design security from the assets, authority and unacceptable outcomes that matter; assume every boundary can receive hostile or misleading input; grant only explicit, reviewable and revocable authority; prevent classes of failure structurally where practical; contain blast radius when prevention fails; make privileged behavior observable; verify controls with evidence suited to the threat; and preserve a credible path to revoke, contain, recover and learn after compromise.**

The standard intentionally separates five questions that are often collapsed:

1. **What must be protected?** — assets, people, business outcomes, safety, authority.
2. **From whom or what?** — threat actors, misuse, compromised components, accidents, failure.
3. **Which behavior is permitted?** — identity, policy, authorization, state transitions.
4. **Which mechanisms enforce that behavior?** — architecture, controls, cryptography, isolation, validation, process.
5. **Why should we believe the mechanisms work?** — threat-model coverage, verification, adversarial tests, runtime evidence, independent assurance.

A list of controls answers only question 4. Mature security engineering must answer all five.

---

# V2 decisive conclusions

The research and falsification pass supports the following high-confidence conclusions.

1. **Security is a lifecycle property.** Security requirements, design, implementation, release, operation, vulnerability handling, incident response, maintenance and retirement are connected engineering responsibilities [NIST02][NIST04][ISO04][IEC01].
2. **Secure by design and secure by default are stronger than customer hardening.** Product security should minimize the amount of expert configuration a customer must perform to obtain a safe ordinary posture [CISA01][CISA02].
3. **Authority is the center of the security model.** Authentication identifies or establishes a principal; authorization determines what that principal may do. Authentication success does not imply authorization [NIST08][NIST10][OWASP01][OWASP02].
4. **Network location is not authorization.** Internal networks, VPNs, VPCs, subnets and service meshes can constrain reachability but do not create identity or permission by themselves [NIST10][NIST11].
5. **Least privilege is durable; exact authorization models are contextual.** RBAC, ABAC, relationship-based access control, capabilities, ACLs and policy engines are mechanisms, not universal winners [RESEARCH01][NIST10].
6. **Threat modeling is a process, not one mandatory mnemonic.** System modeling, threat/abuse discovery, response, and validation are durable; STRIDE, attack trees, CAPEC, misuse cases, PASTA and similar techniques are context-dependent [OWASP06].
7. **CIA is insufficient as a complete security engineering model.** Confidentiality, integrity and availability remain useful, but authenticity, authorization, accountability, isolation, resilience, privacy, safety and recovery can be independently material.
8. **Defense in depth means independent failure resistance, not control accumulation.** Multiple controls with the same hidden dependency can fail together.
9. **Security defaults are part of product behavior.** An optional secure mode that ordinary users never enable is not equivalent to a secure default [CISA01].
10. **Identity assurance must match consequence.** NIST SP 800-63-4/63B-4 is current; it distinguishes assurance levels and explicitly treats phishing resistance as required at AAL3 and recommended/available at AAL2 [NIST08][NIST09].
11. **Password folklore has materially changed.** Current NIST guidance rejects arbitrary composition rules and periodic password changes absent evidence of compromise, and requires blocklisting of common/compromised choices [NIST09].
12. **MFA is not one security property.** OTP, push, cryptographic authenticators and phishing-resistant WebAuthn-style credentials resist different attacks. “MFA enabled” is therefore an incomplete assurance claim [NIST09][W3C01].
13. **OAuth is not an authorization model for application objects.** OAuth controls delegated access to protected resources; resource-level authorization still belongs to the application/service policy. RFC 9700 is the current OAuth 2.0 Security BCP; OAuth 2.1 remains an Internet-Draft at this cutoff [IETF01][IETF02].
14. **Cryptography is a system with lifecycle and authority, not a primitive choice.** Algorithm, protocol, key generation, storage, distribution, use, rotation, recovery, revocation, destruction, implementation and operational access all matter [NIST15][NIST16].
15. **Encryption does not replace access control.** Correctly encrypted data can still be exposed by an authorized-but-overprivileged process, compromised endpoint, leaked key, or permitted export path.
16. **TLS protects a channel under stated assumptions; it does not prove endpoint trust or application authorization.** TLS 1.3 is now RFC 9846; BCP 195/RFC 9325 remains the protocol-configuration recommendation baseline at this cutoff [IETF03][IETF04].
17. **Memory safety removes important vulnerability classes but does not make software secure.** Memory-safe language adoption should be treated as a strategic risk-reduction mechanism, not as proof of application correctness or a mandate to rewrite every existing system immediately [CISA05].
18. **Input validation is not a universal “sanitize strings” step.** Validate syntax and semantics at trust/representation boundaries; use safe APIs and structured encodings; separate data from code; encode for the output context; constrain interpreters and side effects.
19. **Business logic is part of the attack surface.** A request can be syntactically valid, authenticated and authorized at a coarse level while still violating a business invariant or enabling abuse [OWASP01][OWASP03].
20. **Security testing is a portfolio.** Review, static analysis, dependency analysis, secrets scanning, dynamic testing, authorization tests, fuzzing, misuse tests, penetration testing, formal methods and production monitoring detect different failure classes [OWASP02][OWASP04][ENG00].
21. **A penetration test is evidence, not a secure-development lifecycle.** The absence of findings in a sampled engagement cannot establish the absence of exploitable flaws.
22. **Vulnerability severity is not remediation priority.** CVSS communicates vulnerability characteristics/severity; EPSS estimates near-term exploitation probability; CISA KEV records known exploitation; environment, reachability, asset value, controls and consequence still matter [FIRST01][FIRST02][CISA03][CISA04].
23. **A fixed patch SLA based only on CVSS is not an evidence-based universal rule.** Vulnerability response must account for exploitation, exposure, asset criticality, available mitigation, update safety and operational consequence.
24. **Vulnerability disclosure and handling are product capabilities.** ISO/IEC 29147:2018 and ISO/IEC 30111:2019 remain current and define complementary disclosure and handling responsibilities [ISO05][ISO06].
25. **Supply-chain security is not an SBOM.** Source integrity, dependencies, build identity, provenance, builders, signing, artifact repositories, promotion, verification and supplier due diligence answer different questions [NIST02][NIST13][NIST14][SLSA01].
26. **A valid signature is not authorization.** It demonstrates a cryptographic relation under a key/identity; release policy must separately establish whether that identity was authorized to attest, build, sign or release that artifact.
27. **Logs are security evidence only if the event model, coverage, integrity, time context, retention, access and alerting are adequate.** Logging everything can create cost, privacy leakage and secret exposure while still missing the events that matter [OWASP01][NIST12].
28. **Detection does not excuse preventable design defects.** Detection and response are essential because prevention is imperfect; they are not substitutes for inexpensive structural prevention.
29. **Security and resilience intersect but are not identical.** A secure system needs credible behavior under attack, compromise and recovery; NIST SP 800-160 Vol. 2 explicitly treats cyber resilience as anticipate/withstand/recover/adapt [NIST05].
30. **Zero trust is a set of authorization/trust principles, not a product, network topology or maturity badge** [NIST10].
31. **Compliance and certification are scoped evidence.** ISO/IEC 27001, Common Criteria, PCI-style requirements, sector standards or regulatory conformity can be necessary and valuable; none proves that every real threat to the deployed system is controlled.
32. **Common Criteria is a product-evaluation framework, not a universal application-security checklist.** ISO/IEC 15408 Parts 1–5 and ISO/IEC 18045 were updated to 2026 editions and must not be silently cited as 2022 current baselines [ISO07][ISO08].
33. **Adversary knowledge must be versioned.** MITRE ATT&CK is useful for observed adversary behaviors and detection/coverage reasoning; CAPEC is useful for attack patterns; CWE is useful for weakness taxonomy. None replaces a system-specific threat model [MITRE01][MITRE02][MITRE03].
34. **AI/LLM/agent security inherits ordinary security and adds control-loop risk.** Prompt injection, malicious retrieved content, tool misuse, memory/context poisoning, insecure output handling, identity/privilege abuse and autonomous side effects require explicit trust and authority boundaries [OWASP07][OWASP08][OWASP09].
35. **A prompt is not a security boundary.** High-impact tool access, authorization, tenant boundaries, spending limits, destructive operations and credential grants must be enforced outside the probabilistic model [ENG00][OWASP09].
36. **“Read-only” is not automatically low-risk in AI or automation.** Read access can enable bulk sensitive-data exfiltration, inference, reconnaissance and secret leakage.
37. **Human approval is not automatically independent assurance.** Approval quality depends on information, time, competence, incentives, action semantics and whether the approver can actually detect the failure.
38. **Security controls can create new failure modes.** Rate limits, lockouts, network segmentation, key rotation, fail-closed behavior, mandatory reauthentication, scanning gates and emergency controls need availability, usability and recovery analysis.
39. **Recovery paths are security paths.** Password reset, account recovery, key recovery, backup restore, break-glass, support impersonation and emergency administration often have authority equivalent to the primary path and must be secured accordingly.
40. **The weakest path to equivalent authority determines effective security.** A hardened primary control is defeated if a weaker recovery, support, admin, integration or deployment path can reach the same outcome.

---

# 0. How to use this playbook

Use four layers.

## Layer 1 — Orientation

Use:

- Executive standard;
- domain model;
- protected security invariants;
- Golden Security Standards;
- criticality and assurance posture.

## Layer 2 — Decision

Use the decision frameworks when choosing:

- security assurance depth;
- threat-model method;
- authentication assurance;
- authorization model;
- privilege elevation;
- cryptographic protection;
- key/secrets design;
- external exposure;
- dependency/supplier controls;
- vulnerability priority;
- security-test portfolio;
- penetration test or red-team scope;
- formal methods;
- memory-safety migration;
- AI/agent autonomy;
- exception/risk acceptance.

## Layer 3 — Execution

Use:

- Plays;
- runbooks;
- templates;
- checklists;
- security requirement/control records;
- threat-model records;
- vulnerability triage records;
- incident and exception records.

## Layer 4 — Assurance and learning

Use:

- claim/control/test traceability;
- assurance evidence package;
- source register;
- current-version registry;
- adversarial audit;
- security metrics;
- incidents and near misses;
- vulnerability/root-cause learning;
- review triggers.

Do not execute every control mechanically.

A low-risk internal prototype and a public identity provider, payment service, multi-tenant SaaS control plane, cryptographic signing service, healthcare system, industrial controller or autonomous agent do not warrant the same assurance burden.

---

# 1. Purpose

This playbook exists to make security engineering:

- **secure by design** rather than dependent on downstream hardening;
- **secure by default** for ordinary users and deployments;
- **authority-explicit** rather than inferred from location or UI;
- **threat-informed** rather than checklist-only;
- **risk-proportionate** rather than maximal everywhere;
- **structural** where recurring human discipline is too weak;
- **verifiable** rather than trust-based;
- **observable** without leaking unnecessary sensitive data;
- **revocable and recoverable** after compromise;
- **maintainable** as threats, dependencies and systems evolve;
- **traceable** enough for high-consequence decisions;
- **usable by humans and AI-assisted engineering systems** without allowing automation to become its own authority.

The playbook standardizes **security outcomes, invariants, decision logic, minimum control expectations, assurance logic, threat-model practice and operating response**.

It does not prescribe one security product, identity provider, cloud, programming language, WAF, SIEM, scanner, policy engine, architecture style, threat-model notation, pentest firm, or compliance regime.

---

# 2. Scope and boundaries

## 2.1 In scope

This playbook owns the cross-cutting security engineering layer for:

- security objectives and requirements;
- assets, authority, trust and threat boundaries;
- attack surface and abuse-case modeling;
- secure-by-design and secure-by-default product behavior;
- identity and authentication requirements;
- authorization and privilege;
- session and delegated-access security;
- secrets and cryptographic key lifecycle;
- cryptographic decision principles;
- application and service security;
- web/API security at the cross-cutting level;
- input/output and interpreter boundaries;
- business-logic abuse and misuse resistance;
- tenant and administrative isolation from a security perspective;
- privileged operations and break-glass;
- runtime security boundaries;
- configuration/hardening/default posture;
- security logging, detection and security evidence;
- vulnerability intake, triage, remediation, disclosure and learning;
- security assurance, adversarial testing and independent review;
- security incident containment and trust reset;
- security implications of AI/LLM/agentic systems;
- security exceptions and residual-risk acceptance;
- security retirement: access, keys, identities, routes, secrets and exposed attack surface.

## 2.2 Specialist topics this playbook interfaces with rather than duplicates

### Privacy

`07 — Privacy & Data Protection Engineering` owns:

- purpose limitation;
- data minimization;
- lawful/authorized processing overlays;
- retention/deletion/rights;
- privacy threat modeling;
- privacy harm to people.

Security protects information and authority against defined threats. Privacy determines whether the processing itself is justified and appropriately bounded. A system can be secure and still privacy-invasive.

### Verification and testing

`05 — Verification, Validation, Testing & Quality Engineering` owns the general assurance-science layer: method selection, test evidence, independence, oracles, coverage claims and release confidence.

This playbook defines **security-specific claims, adversarial methods and security acceptance conditions**.

### DevOps / supply chain

`10 — DevOps, CI/CD, Release, Platform & Software Supply Chain` owns deep implementation for:

- provenance;
- SBOM/VEX;
- signing;
- builders;
- artifact identity/repositories;
- CI/CD identity;
- promotion/deployment policy.

This playbook defines the security invariants those mechanisms must preserve.

### Cloud / infrastructure

`17 — Cloud, Infrastructure, Networking & IaC` owns deep infrastructure implementation. This playbook owns the security intent: explicit identity, least privilege, no location-based trust, exposure control, isolation, secret boundaries and verification.

### Data/storage

`12 — Data, Database & Storage Engineering` owns integrity, transactions, storage semantics, concurrency and recovery. This playbook owns security access, cryptographic protection, privilege, exfiltration, tampering and administrative threat boundaries.

### APIs/distributed systems

`13 — API, Integration & Distributed Systems Engineering` owns protocol/failure/idempotency/ordering semantics. This playbook owns identity, authorization, input trust, replay/abuse security, service-to-service authority and attacker-controlled boundary assumptions.

### AI and agents

`18 — AI / ML / LLM Systems Engineering` and `19 — Agentic AI Engineering` own detailed model, RAG, memory, tool, orchestration and autonomy engineering. This playbook owns the cross-cutting security invariants and routes deeper agent controls to those standards.

### Systems / embedded / blockchain

Playbooks 20 and 21 own domain-specific irreversible state, custody, firmware, timing, hardware and safety overlays. Their stronger scoped controls supersede ordinary defaults where applicable.

## 2.3 Explicit non-scope

This document is not:

- a legal opinion;
- a compliance certification;
- an ISO/IEC 27001 implementation manual;
- a Common Criteria evaluation package;
- a PCI-DSS checklist;
- a SOC 2 control catalogue;
- an industry-specific safety/security standard;
- a malware reverse-engineering manual;
- a penetration-testing payload catalogue;
- a cryptographic primitive design textbook;
- an intelligence-analysis platform;
- a universal mandate to use “zero trust,” microsegmentation, passkeys, formal methods, memory-safe languages, a service mesh, or any other named implementation.

---

# 3. Inherited parent doctrine

The specialist standard MUST NOT silently weaken its parents.

The following inherited rules remain governing [BASE00][ENG00]:

1. Start from intended outcomes, users, constraints and unacceptable failure.
2. Increase rigor with consequence, exposure, irreversibility, uncertainty, blast radius and autonomy.
3. Make state, authority, ordering, trust boundaries, ownership and failure explicit.
4. Prefer the least complex system that can demonstrably satisfy its required behavior and risk profile.
5. Treat quality as multidimensional.
6. Treat testing as evidence, not proof.
7. Treat production evidence as part of assurance.
8. Make change observable and recoverable.
9. Preserve exact source/artifact/configuration identity where material.
10. Treat AI-generated engineering output as candidate work until independently verified.
11. Do not let the same automated system be its own sole producer, policy authority and independent assurance mechanism for high-consequence work.
12. Make residual uncertainty visible.
13. Match evidence to the question rather than source prestige.
14. Retain traceability and assurance evidence for R3/R4 work.
15. Do not claim `VALIDATED` status without representative execution and the applicable Definition of Done.

The Master Playbook Standard defines a playbook as an operational knowledge system that converts evidence into decisions, actions, verifiable outputs and learning. Security Engineering follows that model rather than becoming a static control inventory [BASE00].

---

# 4. Normative, evidence and confidence language

## 4.1 Requirement words

- **MUST / MUST NOT** — mandatory in this house standard. A deviation requires an explicit exception, rationale, accountable risk owner and acceptance where material.
- **SHOULD / SHOULD NOT** — strong default. A deviation can be correct when context provides a better outcome and the reason is reviewable.
- **MAY** — optional mechanism.
- **JUDGMENT REQUIRED** — competent context-sensitive judgment is intentionally required because no safe universal prescription is justified.

A `MUST` is not automatically an external requirement. External requirements are labeled `REQ` with scoped authority.

## 4.2 Claim status

| Label | Meaning |
|---|---|
| `REQ` | Externally applicable requirement in a stated scope |
| `EST` | Well-established mechanism/principle supported by strong relevant evidence |
| `DEF` | Recommended default with known exceptions |
| `CTX` | Context-dependent practice or mechanism |
| `EMG` | Emerging / fast-moving practice with incomplete maturity |
| `HOUSE` | Deliberate internal synthesis derived from evidence |
| `EXP` | Hypothesis or experiment requiring local validation |
| `UNK` | Material unresolved uncertainty |

## 4.3 Rule class

| Class | Treatment |
|---|---|
| `A` | Durable cross-context security invariant/principle |
| `B` | Strong contextual default |
| `C` | Control triggered by consequence/exposure/criticality |
| `D` | Technique/heuristic |
| `E` | Implementation choice |
| `F` | Rejected dogma or unsupported universalization |

## 4.4 Evidence lanes

The parent evidence lanes apply:

| Lane | Typical source | Best use |
|---|---|---|
| `E0` | law/regulation/contract/certification basis | scoped obligation |
| `E1` | ISO/IEC/IEEE/IETF/W3C formal standard/specification | definitions, protocol semantics, assurance baseline |
| `E2` | systematic review/meta-analysis | aggregate empirical effect |
| `E3` | peer-reviewed/foundational empirical or formal research | mechanisms, attack/effect evidence |
| `E4` | NIST/CISA/MITRE/open-consensus framework | public risk/control/threat guidance |
| `E5` | mature operational evidence | mechanisms observed in real systems |
| `E6` | official platform/protocol/runtime documentation | exact implementation semantics |
| `E7` | repeated practitioner pattern | hypothesis/default |
| `E8` | opinion/folklore | idea only; never sole assurance evidence |

There is no universal total ranking. A final RFC is stronger than a randomized trial for defining wire semantics; a controlled exploit study may be stronger than a standard for determining whether a mitigation blocks an attack; local production evidence may be strongest for whether the control works in the actual system.

## 4.5 Confidence

Use only for a specific claim:

- `HIGH`
- `MODERATE`
- `LOW`
- `INSUFFICIENT`

Do not derive normative strength mechanically from confidence. A `MUST` can arise from a binding requirement or deliberate house safety rule even where causal research is sparse.

---

# 5. Research protocol and source architecture

## 5.1 Primary research question

> **What secure-by-design engineering standard best preserves authorized behavior and acceptable confidentiality, integrity, availability, authenticity, isolation, accountability and recoverability across the software/system lifecycle, without turning one framework, control catalogue, threat model, product or compliance regime into universal dogma?**

## 5.2 Subquestions

1. Which security principles survive across ordinary SaaS, distributed platforms, cloud infrastructure, AI/agents, embedded systems and high-assurance products?
2. Which controls are universal invariants versus risk-triggered or contextual mechanisms?
3. How should assets, trust, authority and threat boundaries be represented?
4. How should authentication and authorization assurance scale with consequence?
5. Which cryptographic/key-management requirements are durable across implementations?
6. How should secure defaults differ from customer hardening guidance?
7. How should vulnerability priority combine severity, exploitation, exposure and business consequence?
8. What evidence is needed to claim a security control works?
9. How do security controls fail operationally?
10. What security properties must remain outside probabilistic AI/agent decision authority?
11. Which standards are current versus draft/superseded as of 2026-09-28?
12. Which common security slogans fail under adversarial falsification?

## 5.3 Source families deliberately triangulated

- ISO/IEC security management, risk, application-security, vulnerability and evaluation standards;
- NIST secure software, systems security engineering, identity, control, zero-trust, incident and supply-chain guidance;
- CISA secure-by-design, vulnerability, memory-safety and procurement guidance;
- IETF/W3C protocol and identity specifications;
- OWASP ASVS, SAMM, WSTG, Top 10, API and GenAI/agent security guidance;
- MITRE CWE, CAPEC and ATT&CK;
- FIRST CVSS and EPSS;
- SLSA supply-chain specification;
- CIS Controls;
- selected foundational and empirical research;
- applicable EU Cyber Resilience Act source text as a regulatory overlay example;
- inherited local Playbook 00 and Universal Engineering standards.

## 5.4 Inclusion rules

Prefer:

- current final primary sources for version/status claims;
- exact standards for protocol semantics;
- security standards and public-framework sources for engineering controls;
- empirical/foundational research for effectiveness/mechanism claims;
- current threat/weakness catalogues for adversary/weakness coverage;
- local evidence for implementation fitness.

## 5.5 Exclusion/downgrade rules

Downgrade or exclude:

- superseded standards when a current final edition exists;
- drafts represented as final;
- vendor product marketing presented as independent security evidence;
- checklist popularity presented as causal proof;
- breach anecdotes presented as universal base rates;
- “best practice” claims without boundary conditions;
- exact numeric security thresholds that lack authoritative or context-specific justification;
- security products treated as architecture.

## 5.6 Research limitations

This was a controlled targeted synthesis, not a formal systematic review.

Limitations include:

- proprietary ISO/IEC/IEC text was not reproduced; public abstracts/status pages were used for version/scope validation;
- fast-moving threat intelligence cannot be exhaustively captured in a static release;
- absence of a vulnerability from public catalogues is not evidence of safety;
- empirical security studies are often context-specific and can become stale as attacker behavior and platforms change;
- legal applicability requires qualified jurisdictional interpretation;
- representative non-author field execution of this V2 remains pending.

---

# 6. Current source-status register — material freshness facts

These facts materially changed or constrain V2.

| Source / topic | Current status at 2026-09-28 | Security-engineering consequence |
|---|---|---|
| NIST SSDF | **SP 800-218 / SSDF 1.1 is final** | Use as current final secure-development baseline [NIST02] |
| NIST SSDF 1.2 | **SP 800-218 Rev.1 is Initial Public Draft** | Watch/inform; do not represent as final [NIST03] |
| NIST Digital Identity | **SP 800-63-4 family final, July 2025** | Supersedes 800-63-3 family [NIST08][NIST09] |
| NIST CSF | **CSF 2.0 final** | High-level cybersecurity outcome/governance taxonomy, not implementation recipe [NIST01] |
| NIST SP 800-53 | **Rev.5 Release 5.2.0 current (Aug 2025)** | Control catalog; not universal minimum set [NIST06] |
| NIST API Protection | **SP 800-228 final; March 13 2026 update current** | Risk-based API-lifecycle protection guidance; REST-specific SP 800-228A remains draft [NIST17] |
| NIST Key Management | **SP 800-57 Part 1 Rev.5 final; Rev.6 Initial Public Draft** | Use Rev.5 as final baseline; treat Rev.6/PQC integration as watch item [NIST15] |
| NIST PQC | **FIPS 203/204/205 final (Aug 2024)** | Current NIST ML-KEM, ML-DSA and SLH-DSA standards; migration requires crypto-agility planning [NIST16] |
| ISO/IEC 27001 | **2022 Edition 3 + Amendment 1:2024** | ISMS management requirement, not complete product-security proof [ISO01] |
| ISO/IEC 27002 | **2022 Edition 3** | Control guidance [ISO02] |
| ISO/IEC 27005 | **2022 Edition 4** | Information-security risk guidance [ISO03] |
| ISO/IEC 27034-1 | **2011 remains current; confirmed 2022** | Application-security concepts remain current despite age [ISO04] |
| ISO/IEC 29147 | **2018 current; confirmed 2024** | Vulnerability disclosure baseline [ISO05] |
| ISO/IEC 30111 | **2019 current; confirmed 2025** | Vulnerability handling baseline [ISO06] |
| Common Criteria ISO/IEC 15408 | **Parts 1–5 updated to 2026 editions** | 2022 editions are withdrawn/superseded [ISO07] |
| ISO/IEC 18045 | **2026 Edition 4** | Current Common Criteria evaluation methodology [ISO08] |
| IEC 62443-4-1 | **2018 published/current; Edition 2 in development** | Current secure product-development lifecycle baseline for IACS scope [IEC01] |
| OWASP ASVS | **5.0.0 latest stable** | Current open app-security verification baseline [OWASP02] |
| OWASP Top 10 | **2025 release current** | Awareness/risk taxonomy; not verification standard [OWASP01] |
| OWASP API Security Top 10 | **2023 current project release** | API risk awareness; use ASVS/tests for verification [OWASP03] |
| OWASP WSTG | **4.2 stable; 5.0 in development** | Do not cite v5 as stable [OWASP04] |
| OWASP SAMM | **2.2.0 current project version** | Maturity/assurance program model, not application certification [OWASP05] |
| OWASP LLM Top 10 | **2026 latest** | Fast-moving GenAI risk consensus [OWASP07] |
| OWASP Agentic Top 10 | **2026 current** | Fast-moving agentic risk consensus [OWASP08] |
| OWASP Agent Control Standard | **released/joined OWASP GenAI project Sep 2026** | Emerging runtime-control guidance; do not overstate maturity [OWASP09] |
| MITRE ATT&CK | **v19.2 current; Aug 6 2026 agile release** | Version threat-coverage mappings [MITRE03] |
| CAPEC | **v3.9; 559 attack patterns** | Attack-pattern library, not complete threat model [MITRE02] |
| CWE Top 25 | **2025 current list** | Weakness prioritization signal, not exhaustive secure coding standard [MITRE01] |
| FIRST CVSS | **v4.0** | Severity/characteristics; not remediation priority by itself [FIRST01] |
| FIRST EPSS | **v5 since 2026-06-15** | Probabilistic exploitation signal; model version matters [FIRST02] |
| CISA KEV | continuously updated | Known exploitation signal [CISA03] |
| OAuth | **RFC 9700 / BCP 240 final Jan 2025** | Current OAuth 2.0 security BCP [IETF01] |
| OAuth 2.1 | **Internet-Draft v16 at cutoff** | Do not represent as final RFC [IETF02] |
| TLS 1.3 | **RFC 9846 published Jul 2026, obsoletes RFC 8446/5246** | Current TLS 1.3 RFC [IETF03] |
| TLS recommendations | **RFC 9325 / BCP 195** | Current secure TLS/DTLS usage recommendations [IETF04] |
| JWT | **RFC 8725 / BCP 225** | Current JSON Web Token Best Current Practices; JWT security remains profile/application dependent [IETF05] |
| WebAuthn | **Level 3 W3C Recommendation, 25 Aug 2026** | Current WebAuthn Recommendation [W3C01] |
| SLSA | **v1.2 Approved/current** | Current supply-chain source/build provenance specification [SLSA01] |
| CIS Controls | **v8.1 current** | Prioritized defense catalogue; adapt to context [CIS01] |
| EU CRA | Regulation (EU) 2024/2847; Art.14 reporting applies **11 Sep 2026**; main application **11 Dec 2027** | Binding only where applicable; legal interpretation required [EU01] |

Draft status, supersession status and publication date are part of the evidence. A draft MAY guide a watchlist; it MUST NOT silently replace a final baseline.

---

# 7. V1 candidate standard

> **PART I — V1 CANDIDATE STANDARD**

V1 was deliberately written strongly enough to expose hidden absolutism during the audit. It is retained here as assurance history and is **not the canonical operational standard**.

## 7. V1 candidate doctrine

V1 proposed:

> **Identify assets and threats; implement least privilege, secure defaults, strong authentication, encryption, input validation, defense in depth, vulnerability scanning, security testing, logging and incident response; block releases with material findings; patch quickly; and apply zero trust throughout production.**

This direction was broadly sensible but contained several phrases that were too easy to cargo-cult.

## 7.1 V1 candidate security chain

```text
ASSETS
→ THREATS
→ CONTROLS
→ SECURE IMPLEMENTATION
→ SECURITY TESTING
→ RELEASE GATE
→ MONITORING
→ PATCHING
→ INCIDENT RESPONSE
```

## 7.2 V1 candidate rules

V1 proposed the following candidate rules.

1. Every production system MUST have a threat model.
2. STRIDE SHOULD be the default threat-model method.
3. Security SHOULD be expressed primarily through confidentiality, integrity and availability.
4. Default deny SHOULD apply to all security decisions.
5. Every production user SHOULD use MFA.
6. Privileged users SHOULD use phishing-resistant MFA.
7. Passwords SHOULD meet complexity requirements and rotate periodically.
8. RBAC SHOULD be the default authorization model.
9. All internal services SHOULD authenticate each other.
10. Internal network location MUST NOT create implicit trust.
11. Least privilege MUST apply to every human and workload identity.
12. Secrets MUST live outside source code.
13. Secrets SHOULD rotate on a fixed schedule.
14. All sensitive data SHOULD be encrypted at rest and in transit.
15. TLS 1.3 SHOULD be the default transport protocol where supported.
16. Custom cryptography MUST NOT be used.
17. All untrusted input MUST be validated and sanitized.
18. All database access SHOULD use parameterized queries.
19. Browser applications SHOULD deploy CSP.
20. Public applications SHOULD use a WAF.
21. APIs SHOULD validate schemas.
22. APIs SHOULD rate-limit requests.
23. Every privileged action SHOULD be logged.
24. Security logs SHOULD be immutable.
25. Every repository SHOULD run SAST, dependency and secret scanning.
26. Every internet-facing system SHOULD run DAST.
27. Every material system SHOULD receive an annual penetration test.
28. High-risk systems SHOULD receive red-team testing.
29. Releases MUST block on critical/high vulnerabilities.
30. Vulnerability SLAs SHOULD be defined by CVSS severity.
31. All dependencies SHOULD be patched immediately.
32. Every release SHOULD include an SBOM.
33. Every release SHOULD be cryptographically signed.
34. SLSA SHOULD be used for software supply-chain maturity.
35. Production systems SHOULD follow zero-trust architecture.
36. Network segmentation SHOULD isolate trust zones.
37. Containers SHOULD run as non-root.
38. Production should use immutable infrastructure where practical.
39. Memory-safe languages SHOULD be preferred for new security-sensitive components.
40. Existing memory-unsafe security-critical code SHOULD have a migration roadmap.
41. Security tests SHOULD shift left into CI.
42. Production detection SHOULD map to MITRE ATT&CK.
43. Known exploited vulnerabilities SHOULD receive priority.
44. Security incidents SHOULD revoke compromised credentials and preserve evidence.
45. Account recovery SHOULD receive the same scrutiny as login.
46. Break-glass access SHOULD be time-bound and audited.
47. AI-generated security-sensitive code SHOULD receive human review.
48. AI/agent tools SHOULD have least privilege.
49. High-impact AI/agent actions SHOULD require human approval.
50. Prompt injection SHOULD be mitigated through instruction hardening and tool controls.
51. Security exceptions SHOULD have an expiry date and accountable owner.
52. Security metrics SHOULD include vulnerability backlog, patch time, test coverage and incident performance.
53. Security control coverage SHOULD increase with criticality.
54. Compliance SHOULD never be treated as sufficient proof of security.
55. Security requirements and test evidence SHOULD be traceable for high-assurance systems.

V1 intentionally mixed invariants, defaults and techniques. The falsification audit below separates them.

---

# 8. Adversarial / falsification audit of V1

> **PART II — ADVERSARIAL / FALSIFICATION AUDIT OF V1**

## 8. Audit objective

The audit did not ask whether V1 looked professional.

It asked:

> **Can a competent adversary, implementer, operator, auditor, product team or AI coding agent satisfy the wording while defeating the security intent?**

The audit also tested whether each rule:

- is actually universal;
- is supported by a current source;
- confuses framework guidance with causal evidence;
- fails under high availability or safety constraints;
- creates security theatre;
- creates unbounded operational cost;
- produces a weaker recovery path;
- can be bypassed through equivalent authority;
- mistakes a tool signal for a security property;
- remains valid for AI/agentic and multi-tenant systems;
- is current at the 2026-09-28 evidence cutoff.

## 8.1 Adversarial scenarios used

V1 was challenged against:

1. low-risk internal CRUD application;
2. public consumer SaaS;
3. multi-tenant B2B SaaS;
4. payment/financial state transition;
5. identity provider / SSO platform;
6. secrets/signing service;
7. Kubernetes/cloud control plane;
8. dependency/build/release compromise;
9. internet-facing API;
10. webhook/integration ecosystem;
11. database with privileged support tooling;
12. compromised employee account;
13. malicious tenant administrator;
14. insider with legitimate access;
15. stolen session token;
16. OAuth token substitution/misbinding;
17. recovery/support social engineering;
18. credential stuffing/phishing;
19. ransomware/destructive operator;
20. dependency vulnerability with high CVSS but no reachable code path;
21. medium-severity vulnerability with active exploitation;
22. emergency patch with regression risk;
23. offline or partially disconnected environment;
24. safety-relevant system where fail-closed can create physical harm;
25. LLM application exposed to prompt injection;
26. agent with read access to sensitive systems;
27. agent with write/tool authority;
28. prompt/memory poisoning;
29. compromised tool server;
30. high-assurance embedded/blockchain overlay.

## 8.2 Material falsification findings

| ID | V1 assumption | Finding | Severity | V2 correction |
|---|---|---|---|---|
| A01 | CIA is the primary complete security model | Too narrow. Authentication, authorization, authenticity, isolation, accountability, resilience and recovery can fail independently. | BLOCKER | Use an expanded security-property model. |
| A02 | Every system needs the same style of threat model | Right intent, wrong uniformity. Small low-risk systems need lighter analysis than high-assurance control planes. | MAJOR | Require threat reasoning proportional to consequence; formal artifact threshold is risk-based. |
| A03 | STRIDE should be the default universal method | OWASP itself states there is no universally accepted one right process. | MAJOR | Require system modeling + threat discovery + treatment + validation; make STRIDE contextual. |
| A04 | Default deny applies to all failure conditions | Authorization default-deny is strong; system-wide “fail closed” can destroy availability or safety. | BLOCKER | Deny unauthorized action by default; define failure/degraded behavior per invariant. |
| A05 | MFA is one homogeneous control | False. OTP/push/cryptographic authenticators differ materially in phishing and replay resistance. | MAJOR | Select authentication assurance and phishing resistance from consequence/threat. |
| A06 | Complexity rules + periodic password rotation are best practice | Stale against current NIST SP 800-63B-4. | BLOCKER | Use length, compromised/common-password blocklists, no arbitrary composition, change on compromise. |
| A07 | RBAC is the universal authorization default | Too narrow for relationships, object ownership, context, delegation and capability systems. | MAJOR | Start from authorization policy semantics; choose RBAC/ABAC/ReBAC/capability mechanisms contextually. |
| A08 | Service-to-service authentication is enough | Authentication without action/resource authorization can still grant excessive authority. | MAJOR | Bind workload identity to explicit authorization and resource scope. |
| A09 | Fixed secret rotation always improves security | Rotation can fail operationally, trigger outages, or create secret sprawl; short-lived credentials and compromise-triggered rotation may be stronger. | MAJOR | Define secret lifetime from exposure and recovery model; require rotatability and tested rotation, not one interval. |
| A10 | Encrypt sensitive data everywhere is a complete rule | “Sensitive” and trust boundary are underspecified; encryption can add keys without reducing real exposure. | MAJOR | Define threat, plaintext boundary, key authority and access path; encrypt where it changes risk or is required. |
| A11 | “No custom crypto” is literally universal | Strong default, but cryptographic research/protocol-development domains exist. | MINOR | Do not invent primitives/protocols for ordinary products; exceptional cryptographic design requires specialist competence and independent analysis. |
| A12 | Validate and sanitize input | “Sanitize” is ambiguous and often context-wrong. | BLOCKER | Validate at trust/representation boundaries; separate data from code; encode for output context; use safe parsers/APIs. |
| A13 | Parameterized SQL solves injection generally | It addresses a major SQL injection class, not command/template/path/LDAP/NoSQL/script injection or unsafe dynamic identifiers. | MAJOR | Model each interpreter boundary. |
| A14 | CSP should be universal | Strong browser defense-in-depth where applicable, not a substitute for safe rendering or universal requirement for non-web systems. | MINOR | Browser-specific contextual control routed to Playbook 14. |
| A15 | Public applications should use a WAF | A WAF can help for exposure/legacy/emergency controls, but is not universally necessary and can create false assurance. | MAJOR | Use WAF/API gateway controls when threat/cost fit; never as secure-design substitute. |
| A16 | Schema validation secures APIs | Schemas cannot establish object authorization, business invariants, rate economics, downstream safety or semantic validity. | MAJOR | Validate syntax + semantics + identity + authorization + side effects. |
| A17 | Rate limiting is always protective | Poorly chosen limits can become denial-of-service against legitimate users or fail to stop distributed abuse. | MAJOR | Treat abuse/resource controls as threat- and identity-aware. |
| A18 | Immutable logs are enough | “Immutable” can be unavailable, incomplete, forged before ingestion, or useless without alerts/context. | MAJOR | Engineer event coverage, integrity, access, time, retention, correlation, alerting and recovery. |
| A19 | Run every scanner everywhere | Scanner monoculture creates noise and bottlenecks; methods detect different defect classes. | MAJOR | Build a risk-driven verification portfolio. |
| A20 | Annual pentest is a universal release control | Calendar cadence is not threat-based; major changes may require earlier tests; low-risk static tools may not need yearly pentests. | MAJOR | Trigger penetration testing from risk, change, exposure, regulation and evidence need. |
| A21 | Block every high/critical scan finding | Tool severity can be wrong and exploitability/context can differ. | BLOCKER | Define triage states and risk ownership; block unresolved material release risk, not labels mechanically. |
| A22 | CVSS defines remediation priority | Explicitly falsified. CVSS communicates severity; KEV/EPSS/exposure/environment add different information. | BLOCKER | Multi-signal vulnerability decision model. |
| A23 | Patch every dependency immediately | Can introduce regression/availability risk and is not feasible for all dependencies. | MAJOR | Prioritize by exploitation/exposure/consequence; test updates; mitigate/quarantine/remove where patch unavailable. |
| A24 | SBOM equals supply-chain assurance | False. Inventory does not prove origin, build integrity, authorization or runtime use. | BLOCKER | Separate inventory, provenance, supplier due diligence, signing, verification and release policy. |
| A25 | Signature means trusted release | False. A stolen or unauthorized signing identity can produce a valid signature. | BLOCKER | Separate cryptographic validity, identity, authorization, provenance and policy. |
| A26 | SLSA level maps mechanically to system criticality | Overgeneralized; SLSA defines scoped supply-chain guarantees. | MAJOR | Select SLSA controls/levels from threat model and verify consumer policy. |
| A27 | “Zero trust architecture” is a target topology | NIST defines principles/models, not one topology. | MAJOR | Protect the no-implicit-trust and per-request authorization invariants. |
| A28 | More segmentation always improves security | Segmentation adds policy and operational complexity and can fail open/closed unexpectedly. | MAJOR | Segment where it reduces blast radius or enforces trust boundaries with measurable benefit. |
| A29 | Non-root container = secure container | Important hardening, insufficient for kernel escape, capabilities, mounts, secrets, supply chain, network and identity. | MAJOR | Treat runtime isolation as multi-control. |
| A30 | Immutable infrastructure = security property | Immutability can reduce drift but does not guarantee secure images, identities or deployments. | MINOR | Treat it as a change-control mechanism, not proof. |
| A31 | Memory-safe language = secure system | Removes/reduces memory-safety classes, not logic/auth/business vulnerabilities. | MAJOR | Prefer memory safety where fit; preserve full security lifecycle. |
| A32 | Shift-left means security is solved in CI | Pre-release prevention is necessary but runtime compromise/exploitation still requires detection and response. | MAJOR | “Start early, verify continuously, observe after release.” |
| A33 | Detection must map to ATT&CK | ATT&CK is valuable but not exhaustive and may not model application/business abuse. | MAJOR | Use ATT&CK as one coverage lens alongside system-specific threats. |
| A34 | KEV priority implies only KEV matters | KEV is authoritative known exploitation input, not exhaustive of dangerous vulnerabilities. | MAJOR | KEV raises urgency; retain context and non-KEV severe threat analysis. |
| A35 | Account recovery gets same scrutiny as login | Correct direction but sometimes recovery deserves **more** assurance because it bypasses primary authenticators. | MINOR | Treat equivalent-authority paths at least as strongly as primary. |
| A36 | Break-glass only needs audit + expiry | It also needs protected issuance, independent trigger where warranted, scope, revocation and post-use review. | MAJOR | Define complete emergency-authority lifecycle. |
| A37 | Human review is sufficient for AI security-sensitive code | Reviewers can miss confident model errors and common-mode assumptions. | MAJOR | Independent verification suited to consequence; human review is one evidence source. |
| A38 | Least privilege makes AI tools safe | Read-only access can exfiltrate; small write permissions can chain into high impact; model can be socially/prompt manipulated. | BLOCKER | Add data sensitivity, action semantics, budgets, sandboxing, approval, postconditions and runtime enforcement. |
| A39 | Human approval makes high-impact agent actions safe | Approval can be rubber-stamped or presented without enough context. | BLOCKER | Approval is a control only if approver can understand exact action, scope, delta and consequence. |
| A40 | Prompt hardening mitigates prompt injection sufficiently | A prompt is probabilistic influence, not an enforcement boundary. | BLOCKER | Treat external content as untrusted; enforce tool authority outside model; validate outputs/actions. |
| A41 | Security exceptions with expiry are enough | Expiry without monitoring, owner and compensating controls can still create hidden risk. | MAJOR | Exception record includes scope, rationale, owner, residual risk, compensating controls, expiry/review trigger and closure proof. |
| A42 | Vulnerability count/backlog measures security | Goodhart risk: counts reward hiding/splitting findings and ignore exposure/consequence/root cause. | MAJOR | Measure risk/outcomes, control effectiveness, exploit exposure and recurrence alongside inventory. |
| A43 | Security “coverage” is one percentage | Coverage denominator and threat relevance are often unclear. | MAJOR | Tie coverage to named assets, requirements, threats, attack paths and controls. |
| A44 | Compliance never proves security | Retained. But applicable external requirements still take precedence and may provide valuable assurance evidence. | MINOR | Distinguish obligation, conformance evidence and technical risk. |
| A45 | Full traceability should apply everywhere | Too much ceremony for low-risk work. | MINOR | R3/R4 material claims/controls require traceability; lighter records for C0/C1. |

## 8.3 What survived strongly

High-confidence principles that survived adversarial challenge:

- security as a lifecycle property;
- secure by design/default;
- explicit authority and trust boundaries;
- least privilege;
- no implicit authorization from network location;
- separation of authentication and authorization;
- structural prevention of recurring defect classes;
- secrets outside ordinary source code;
- key/secret lifecycle ownership;
- threat modeling proportional to consequence;
- multiple independent assurance methods;
- supply-chain lineage and consumer-side policy verification;
- vulnerability handling and disclosure ownership;
- known-exploitation signals in remediation;
- detection + containment + recovery;
- secure recovery paths;
- security of admin/debug/support paths;
- independent assurance for high-consequence systems;
- deterministic security boundaries around probabilistic AI/agents.

## 8.4 What V2 deliberately downgrades to contextual

- STRIDE;
- RBAC;
- ABAC;
- relationship-based authorization;
- capabilities;
- service mesh;
- microsegmentation;
- WAF;
- CSP;
- immutable infrastructure;
- containers;
- Kubernetes security policies;
- annual penetration testing;
- red teaming;
- fixed secret-rotation intervals;
- fixed patch SLAs;
- exact vulnerability risk formula;
- formal methods;
- memory-safe rewrites;
- SLSA level targets;
- specific SIEM/SOAR architecture;
- specific zero-trust topology.

## 8.5 Explicitly rejected as universal doctrine

V2 rejects:

- “inside the network means trusted”;
- “authenticated means authorized”;
- “MFA means phishing-resistant”;
- “passwords should be changed every 90 days”;
- “password complexity rules improve security by default”;
- “OAuth means application authorization is solved”;
- “JWT means stateless and secure”;
- “TLS means the peer is trustworthy”;
- “encryption solves data security”;
- “sanitize all input” as a complete injection strategy;
- “CORS is authorization”;
- “CSP fixes XSS”;
- “WAF fixes insecure design”;
- “a clean pentest means the application is secure”;
- “green security scans mean production is safe”;
- “CVSS is remediation priority”;
- “SBOM = supply-chain security”;
- “signed = trusted”;
- “zero trust = buy a zero-trust product”;
- “more controls = more security”;
- “fail closed is always safest”;
- “security through obscurity is a primary control”;
- “security and privacy are the same property”;
- “compliance = security”;
- “memory safe = secure”;
- “read-only agent tools are low risk”;
- “prompt instructions are policy enforcement”;
- “human-in-the-loop automatically makes autonomy safe”;
- “a security scanner can independently approve its own generated fix.”

---

> **PART III — V2 CANONICAL SECURITY ENGINEERING STANDARD**

# 9. Security domain model

A security review that begins with a list of controls is already too late. The system must first be modeled in terms of **value, authority, trust, state, exposure and recovery**.

## 9.1 The eight security planes

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ 1. MISSION / ASSET PLANE                                                    │
│ people, safety, money, data, business capability, reputation, legal duties  │
└──────────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│ 2. IDENTITY / AUTHORITY PLANE                                               │
│ users, services, workloads, agents, devices, roles, grants, delegation      │
└──────────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│ 3. DATA / STATE PLANE                                                       │
│ authoritative state, copies, secrets, credentials, logs, caches, backups    │
└──────────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│ 4. EXECUTION PLANE                                                          │
│ application code, workers, runtimes, interpreters, models, devices, jobs     │
└──────────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│ 5. COMMUNICATION / INTEGRATION PLANE                                        │
│ APIs, messages, files, browser boundaries, IPC, external providers          │
└──────────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│ 6. DELIVERY / SUPPLY-CHAIN PLANE                                            │
│ source, dependencies, builders, CI, packages, artifacts, signing, deploy     │
└──────────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│ 7. OPERATIONS / CONTROL PLANE                                               │
│ admin, support, observability, policy, configuration, automation, consoles   │
└──────────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│ 8. RECOVERY / TRUST-RESET PLANE                                             │
│ reset, revoke, rotate, restore, break-glass, rebuild, quarantine, retire     │
└──────────────────────────────────────────────────────────────────────────────┘
```

The planes are not a deployment architecture. They are a reasoning model. A single component can participate in several planes.

## 9.2 Security follows authority, not diagrams

For each material action identify:

```text
PRINCIPAL
  → authenticated identity / execution identity
  → delegated or native authority
  → requested action
  → target resource / state
  → policy decision
  → enforcement point
  → side effect
  → audit evidence
  → recovery / revocation path
```

A trust boundary exists wherever one side must not assume that the other side is truthful, authorized, uncompromised or semantically correct.

Trust boundaries may exist between:

- browser and server;
- mobile/desktop client and backend;
- service and service;
- tenant and tenant;
- user and support operator;
- workload and control plane;
- application and database;
- application and model provider;
- agent and tool;
- retriever and retrieved content;
- CI job and artifact repository;
- vendor and customer;
- primary operation and recovery path;
- production and non-production;
- human approval and automated execution;
- privileged and unprivileged runtime domains.

## 9.3 Canonical terminology

### Asset

Anything whose compromise can create unacceptable harm or loss of capability.

Assets include more than stored data:

- human safety;
- authorization power;
- money and value-bearing state;
- credentials and keys;
- integrity of decisions;
- availability of critical workflows;
- confidential information;
- intellectual property;
- audit evidence;
- source/build/release integrity;
- operational control;
- public trust and contractual commitments.

### Authority

The ability to cause a consequential effect.

Examples:

- read customer records;
- change a bank account;
- approve a payment;
- deploy code;
- rotate a key;
- restore a backup;
- impersonate a user;
- issue a token;
- modify authorization policy;
- call an agent tool;
- install an upgrade;
- delete or export data.

Authority is a security asset even when no conventional secret is present.

### Principal

An entity to which identity and authority can be attributed: person, workload, service, device, process, agent or organization.

### Trust boundary

A boundary across which assumptions about identity, integrity, confidentiality, provenance, authorization or correctness change.

### Attack surface

The set of reachable interfaces, inputs, capabilities, dependencies and operational paths through which an attacker or compromised component can influence protected assets or authority.

### Exposure

The degree to which an attack surface is reachable by relevant threat actors under real deployment conditions.

### Threat

A plausible event or actor behavior that could violate a protected security property.

### Vulnerability / weakness

A condition that can contribute to violating a protected property. CWE is useful for software weakness taxonomy; it is not a complete system-risk model [MITRE03].

### Control

A preventive, constraining, detective, responsive or recovery mechanism intended to reduce risk.

### Security invariant

A statement that must remain true across permitted system states.

Examples:

```text
A user cannot approve their own privileged access elevation.
A tenant-scoped principal cannot read another tenant's records.
A deployment cannot reach production unless its artifact identity is verified.
A support operator cannot impersonate a customer without a recorded, authorized elevation.
A compromised low-privilege service cannot mint higher-privilege credentials.
```

### Security claim

A proposition whose truth matters to a security decision.

### Residual risk

Risk remaining after controls and evidence are considered.

Residual risk is not the same as “known vulnerabilities.” It includes uncertainty, untested assumptions, dependency risk, operational limitations and credible unknowns.

### Compromise

Loss of a material security property or reasonable confidence in one. Compromise can require trust reset even when the exact attacker action is unknown.

## 9.4 The weakest equivalent-authority path rule

For any high-value action, enumerate every path that can reach equivalent authority:

```text
PRIMARY PATH
ADMIN PATH
SUPPORT PATH
RECOVERY PATH
AUTOMATION PATH
CI/CD PATH
DATABASE / REPAIR PATH
VENDOR / PROVIDER PATH
AGENT / TOOL PATH
BACKUP / RESTORE PATH
```

Security is bounded by the weakest path that can produce the same consequential effect.

---

# 10. Security outcome and harm model

Security is multidimensional. Do not reduce the objective to CIA or to a numeric “security score.”

## 10.1 Core security properties

For each material workflow assess which properties must hold.

| Property | Core question |
|---|---|
| Confidentiality | Can information be learned only by permitted parties? |
| Integrity | Can state, code, evidence and decisions be changed only in permitted ways? |
| Availability | Can permitted users obtain required capability within acceptable conditions? |
| Authenticity | Can identity, source, artifact or message origin be established strongly enough? |
| Authorization | Can only permitted principals perform the action on the target in context? |
| Isolation | Can one tenant, process, workload or failure domain affect another beyond allowed bounds? |
| Accountability | Can consequential actions be attributed and reconstructed sufficiently? |
| Non-repudiation where applicable | Is evidence strong enough for the domain's dispute model? |
| Resilience | Can the system withstand, contain, recover and adapt under attack/compromise? |
| Recoverability | Can trusted operation and state be re-established after compromise? |
| Safety | Can security failure create physical or other safety harm? |
| Privacy | Can processing harm people even when the system is technically secure? Delegate full treatment to Playbook 07. |

## 10.2 Harm classes

Threat prioritization SHOULD begin from harm, not vulnerability labels.

Potential harm includes:

- unauthorized disclosure;
- unauthorized modification;
- fraud or theft;
- account takeover;
- privilege escalation;
- cross-tenant compromise;
- destructive action;
- extortion or ransomware;
- loss of operational control;
- safety impact;
- regulatory or contractual breach;
- privacy harm;
- denial or degradation of service;
- manipulation of business decisions;
- corruption of evidence or audit history;
- supply-chain compromise;
- persistent foothold;
- model/agent tool misuse;
- reputation/trust loss where causally material.

## 10.3 Security success is bounded acceptable risk

The objective is not “zero vulnerabilities.”

A security posture is acceptable only when:

1. protected assets and unacceptable outcomes are known enough;
2. material threats are modeled;
3. required controls are implemented at trustworthy boundaries;
4. controls have evidence appropriate to consequence;
5. residual risk and uncertainty are visible;
6. risk acceptance has an accountable owner;
7. detection, containment and recovery exist for plausible control failure;
8. the posture remains monitored as the system and threat environment change.

---

# 11. Criticality and security assurance posture

This playbook inherits the engineering master's C0–C4 criticality model [ENG00]. Security assurance depth MUST increase with consequence, exposure, irreversibility, blast radius, uncertainty and autonomy, and MAY decrease when harmful deviation is rapidly detectable and reliably recoverable.

## 11.1 Security posture by criticality

| Level | Typical security context | Minimum posture |
|---|---|---|
| `C0 — Experimental` | disposable prototype; no material users, secrets, sensitive data or value | isolated/non-production; no real secrets if avoidable; basic dependency hygiene; explicit disposal |
| `C1 — Ordinary` | limited recoverable harm | basic threat scan; secure defaults; authz at trusted boundary; secrets management; routine scanning/review; logging of material events |
| `C2 — Material` | customer data, revenue, production business operations, internet exposure | documented threat model; explicit invariants; independent review of security-sensitive changes; stronger IAM; abuse tests; vulnerability ownership; incident/recovery plan |
| `C3 — High assurance` | major financial/security/privacy/societal impact; broad privilege; critical control plane | independent security review; segregation; adversarial testing; stronger identity/crypto/key custody; rigorous traceability; exercised containment/recovery; deeper supply-chain controls |
| `C4 — Safety/mission critical` | catastrophic or safety/mission consequence | applicable domain/security certification overlay; specialist assurance; formal hazard/security integration; potentially formal methods/qualified tooling; independent evidence required |

## 11.2 Security assurance modifiers

Escalate assurance when any of these increase:

```text
EXTERNAL REACHABILITY
PRIVILEGE / AUTHORITY
TENANT COUNT
SENSITIVE DATA
FINANCIAL VALUE
IRREVERSIBLE EFFECTS
SAFETY COUPLING
AUTONOMY
SUPPLY-CHAIN DEPENDENCE
RECOVERY DIFFICULTY
DETECTION DELAY
ADVERSARY INCENTIVE
NOVELTY / UNCERTAINTY
COMMON-MODE DEPENDENCIES
```

## 11.3 A decision heuristic, not a formula

```text
required_security_assurance ∝
    consequence
  × exposure
  × authority
  × adversary_incentive
  × irreversibility
  × blast_radius
  × uncertainty
  × autonomy
  ÷ (detectability × containment × recoverability)
```

Do not calculate a fake precise score. Use the model to force explicit reasoning.

## 11.4 Mandatory escalation triggers

Escalate to specialist/security review when a change introduces or materially changes:

- authentication or account recovery;
- authorization or tenant isolation;
- privileged/admin/support access;
- cryptographic key custody or signing;
- payment/value transfer;
- production deployment authority;
- sensitive data export;
- external code execution or interpreter access;
- sandbox escape boundary;
- public upload/parser surface;
- identity federation;
- large-scale automation or agents with side effects;
- externally reachable control-plane access;
- a security boundary implemented by custom cryptography;
- a migration that weakens a previously trusted security invariant;
- break-glass or recovery authority.

---

# 12. Security context, assets, authority and trust boundaries

Before choosing controls, build a **Security Context Record** for C2+ systems or material changes.

## 12.1 Security Context Record

```yaml
security_context_id:
system_or_change:
owner:
criticality: C0|C1|C2|C3|C4
mission_or_business_outcome:
users_and_affected_parties: []

assets:
  - asset:
    owner:
    required_properties: []
    unacceptable_harm: []

principals:
  - principal_type:
    identity_source:
    permitted_authority: []
    privileged: false

high_value_actions:
  - action:
    target:
    required_authority:
    reversibility:
    max_blast_radius:

trust_boundaries: []
entry_points: []
external_exposures: []
dependencies: []
admin_support_recovery_paths: []
security_invariants: []
material_threats: []
controls: []
assurance_evidence: []
residual_risks: []
risk_owner:
review_triggers: []
last_reviewed:
```

## 12.2 Asset discovery rules

Do not restrict asset discovery to database tables.

Ask:

- What action would be valuable to an attacker?
- What information would enable another attack?
- Which system can grant or manufacture authority?
- Which component can modify trusted policy?
- Which logs/evidence are needed to investigate compromise?
- Which recovery material can recreate production access?
- Which dependency can inject executable behavior?
- Which operational feature can impersonate a user?
- Which state is irreversible or expensive to reconstruct?
- Which failure would create safety or broad customer harm?

## 12.3 Authority inventory

For C2+ systems, maintain a recoverable inventory of material authority:

```yaml
principal:
identity_source:
authentication_assurance:
credential_type:
authority:
  resources: []
  actions: []
  conditions: []
  delegation: []
enforcement_points: []
review_frequency:
revocation_path:
recovery_path:
audit_events: []
owner:
```

## 12.4 Boundary evidence

A drawn boundary is not a control. For material boundaries establish:

- what crosses it;
- how identity is established;
- what integrity/provenance is checked;
- what authorization is enforced;
- what is untrusted even after authentication;
- how failures are handled;
- how attempts are logged;
- how compromise can be contained;
- how credentials/authority can be revoked.

---

# 13. Threat modeling standard

Threat modeling is required when consequence, exposure or authority is material. OWASP's four-question framing is a useful method-neutral baseline: **What are we building? What can go wrong? What are we going to do about it? Did we do a good enough job?** [OWASP06].

## 13.1 Threat-model lifecycle

```text
DEFINE SCOPE + DECISION
→ MODEL SYSTEM / DATA / AUTHORITY / TRUST
→ IDENTIFY ADVERSARIES + MISUSE
→ ENUMERATE THREATS / ATTACK PATHS
→ PRIORITIZE BY HARM + PLAUSIBILITY + EXPOSURE
→ SELECT CONTROLS / DESIGN CHANGES
→ SPECIFY VERIFICATION
→ TEST / ATTACK / REVIEW
→ RECORD RESIDUAL RISK
→ MONITOR ASSUMPTIONS
→ RE-MODEL ON CHANGE / INCIDENT / NEW THREAT
```

## 13.2 Threat actors

Model only actors relevant to the system, but consider:

- unauthenticated internet attacker;
- authenticated malicious user;
- malicious tenant;
- compromised user account;
- compromised endpoint/device;
- compromised service/workload;
- malicious or compromised dependency;
- malicious insider;
- overprivileged operator;
- compromised CI/build/release actor;
- supplier/vendor compromise;
- cloud/provider control-plane compromise;
- automated abuse/bot operator;
- financially motivated criminal;
- targeted espionage actor where relevant;
- accidental operator/developer error;
- probabilistic AI/agent acting outside intended scope;
- malicious content influencing an AI/agent;
- natural/technical failure that creates security-equivalent outcomes.

Do not assume every project needs nation-state threat modeling. Threat sophistication must fit real exposure and stakes.

## 13.3 Threat discovery methods

Methods MAY be combined.

| Method | Strong use | Limitation |
|---|---|---|
| Abuse/misuse cases | business workflows and harmful user behavior | can miss infrastructure mechanics |
| STRIDE | structured category prompts for system/data-flow review | taxonomy is not proof of completeness |
| Attack trees | multi-step paths to a named attacker goal | tree quality depends on model quality |
| CAPEC | reusable attack-pattern prompts | generic patterns require system mapping [MITRE02] |
| CWE | weakness classification and prevention/verification mapping | weakness list is not threat prioritization [MITRE03] |
| ATT&CK | observed adversary behavior/detection/coverage reasoning | enterprise behavior matrix is not a product threat model [MITRE01] |
| Kill-chain/path analysis | sequence and detection opportunities | can overfit linear attacks |
| Data-flow / trust-boundary review | interface and privilege changes | can underweight business abuse |
| Hazard-style analysis | high-consequence security/safety interaction | requires stronger competence/effort |
| Red-team hypothesis | realistic adversarial objective | expensive and scope-sensitive |

## 13.4 Threat statement format

Write threats in causal form rather than as labels:

```text
ACTOR
can use ENTRY / PRECONDITION
against COMPONENT / BOUNDARY
by MECHANISM
causing SECURITY PROPERTY VIOLATION
leading to HARM.
```

Example:

```text
An authenticated tenant administrator can submit a guessed foreign resource ID
through the invoice-export endpoint; if object-level authorization is missing,
the service may export another tenant's invoice, violating isolation and
confidentiality and creating reportable customer data exposure.
```

## 13.5 Threat register

```yaml
threat_id:
asset_or_authority:
actor:
preconditions:
attack_path:
security_property_violated:
harm:
exposure:
existing_controls: []
control_gaps: []
preventive_controls: []
detective_controls: []
containment_recovery: []
verification: []
residual_risk:
owner:
status:
review_trigger:
```

## 13.6 Threat prioritization

Prioritize from:

- harm/consequence;
- exposure/reachability;
- attacker prerequisites;
- attacker incentive;
- exploit maturity/known exploitation where relevant;
- control effectiveness;
- blast radius;
- detection latency;
- recovery difficulty;
- uncertainty.

A high-severity weakness with no plausible exposure can be lower priority than an actively exploited medium-severity path to a critical asset. CVSS, EPSS and KEV are inputs, not the decision [FIRST01][FIRST02][CISA03].

## 13.7 Change triggers for re-modeling

Re-run or update the threat model when:

- a new trust boundary is introduced;
- authority/permission changes;
- authentication or recovery changes;
- data sensitivity/volume changes;
- public exposure changes;
- a new integration/provider is added;
- an interpreter/upload/parser surface is added;
- a model/agent receives new tools or autonomy;
- build/deploy/signing architecture changes;
- tenancy model changes;
- cryptography/key custody changes;
- a material incident/near miss occurs;
- credible new attack behavior invalidates prior assumptions.

## 13.8 Threat-model acceptance gate

For C2+ changes, no threat model is complete unless:

- scope and system version are known;
- assets and authority are known;
- boundaries/entry points are represented;
- business misuse and technical attack are both considered;
- material threats have owners;
- controls map to threats/invariants;
- controls have verification plans;
- residual risk is explicit;
- change triggers are defined.

---

# 14. Security requirements and invariants

Security requirements convert threat reasoning into verifiable engineering agreements.

## 14.1 Requirement sources

Security requirements can arise from:

- mission/business harm analysis;
- threat model;
- safety analysis;
- privacy/data requirements;
- architecture boundaries;
- applicable law/regulation;
- contractual obligations;
- sector/customer standards;
- platform/protocol requirements;
- organizational policy;
- incident learning;
- vulnerability/adversary intelligence.

## 14.2 Requirement classes

Use explicit classes where useful:

```text
IDENTITY
AUTHENTICATION
AUTHORIZATION
ISOLATION
CONFIDENTIALITY
INTEGRITY
AVAILABILITY / ABUSE RESISTANCE
CRYPTOGRAPHY / KEY MANAGEMENT
SECRETS
INPUT / OUTPUT / INTERPRETER SAFETY
SUPPLY CHAIN
CONFIGURATION / HARDENING
AUDIT / DETECTION
INCIDENT / REVOCATION / RECOVERY
VULNERABILITY MANAGEMENT
RETENTION / SECURITY EVIDENCE
AI / AGENT CONTROL
```

## 14.3 Security requirement quality

A material requirement SHOULD state:

```yaml
security_requirement_id:
protected_asset_or_property:
principal_or_population:
required_behavior:
prohibited_behavior:
conditions:
threat_or_rationale:
enforcement_boundary:
verification_method:
monitoring_if_required:
owner:
exception_process:
```

Avoid:

- “use best-practice encryption”;
- “system must be secure”;
- “implement zero trust”;
- “validate all inputs”;
- “follow OWASP”;
- “use MFA” without assurance requirements;
- “all vulnerabilities must be patched immediately.”

## 14.4 Security invariants

High-value invariants SHOULD be enforced at the strongest practical layer and tested adversarially.

Examples:

```text
AUTHZ-01: No caller can mutate a resource unless policy authorizes
          principal + action + resource + context at a trusted boundary.

TENANT-01: A tenant-scoped workload can access only rows/objects/queues/
           keys that belong to its trusted tenant context.

SIGN-01:  A release artifact cannot be promoted to production unless
          policy verifies its immutable identity and required provenance.

KEY-01:   Application workloads cannot export the private key material
          used for production release signing.

REC-01:   Account recovery cannot establish stronger authority than the
          primary authentication path without equal-or-stronger assurance.

AGENT-01: A model cannot grant itself credentials or expand its own tool
          authority through natural-language instructions.
```

---

# 15. Golden Security Standards

These are the V2 root rules. A `MUST` is a house requirement unless explicitly identified as an external `REQ`.

## 15.1 Mission, assets and ownership

1. **Start security design from protected outcomes, assets, authority and unacceptable harm — not from a control catalogue.**
2. **Every material security property MUST have an accountable owner.**
3. **Every high-value action MUST have an explicit authorization boundary.**
4. **Every privileged or equivalent-authority recovery path MUST be included in the security model.**
5. **Material security assumptions MUST be written where their failure changes the design.**
6. **A control without a named threat, invariant, requirement or governance reason SHOULD be challenged for removal or simplification.**
7. **Security architecture SHOULD minimize the number of components that need to be trusted for a high-value outcome.**
8. **A boundary labeled “trusted” MUST state what is trusted, why, and how that trust can be revoked or re-established.**
9. **Security posture MUST be evaluated against the deployed system, not only the intended architecture.**
10. **Customer-visible security claims MUST be bounded by actual system evidence.**

## 15.2 Secure by design / secure by default

11. **Security is a product and engineering requirement, not a post-build hardening phase** [CISA01][NIST02].
12. **Ordinary safe use SHOULD require less expert configuration than unsafe use.**
13. **Security-critical defaults MUST be explicit, testable and version-controlled.**
14. **Dangerous optional capability SHOULD be off by default unless the product's core use requires it and adequate controls exist.**
15. **Debug, test, sample, guest and development modes MUST NOT silently become production authority paths.**
16. **Secure configuration SHOULD be automatable and drift-detectable when configuration materially affects security.**
17. **Unsafe legacy compatibility SHOULD have an owner, bounded exposure and retirement plan.**
18. **A product MUST NOT shift avoidable security burden to users merely because a hardening option exists.**

## 15.3 Trust boundaries and mediation

19. **Treat all external input and cross-trust-boundary data as untrusted until the required properties are established.**
20. **Authenticate identity at the boundary where identity matters.**
21. **Authorize every material action at a trusted enforcement point.**
22. **Authorization MUST evaluate the target resource/action/context required by the policy, not only a broad role or route.**
23. **Do not infer authorization from network position, UI visibility, object identifiers, URL knowledge or possession of a client-side flag.**
24. **Complete mediation is the default principle for consequential authorization decisions** [RESEARCH01].
25. **Caches of security decisions MUST define freshness, invalidation and revocation semantics.**
26. **Security-sensitive derived state MUST identify its authoritative source and synchronization semantics.**
27. **No component SHOULD be able to mint authority stronger than its own unless a separately authorized delegation mechanism permits it.**

## 15.4 Identity and authentication

28. **Authentication assurance MUST be chosen from threat/consequence, not convenience alone.**
29. **MFA mechanisms MUST be classified by the attacks they resist; “MFA enabled” is not sufficient evidence.**
30. **Phishing resistance SHOULD be preferred for privileged, high-value and high-risk external access; C3+ human access normally requires it unless a stronger domain-specific alternative governs** [NIST09][W3C01].
31. **Password policies MUST NOT impose arbitrary composition rules or periodic changes contrary to current NIST guidance without a scoped reason** [NIST09].
32. **Passwords MUST be checked against an appropriate blocklist of common/compromised values when password authentication is used** [NIST09].
33. **Password storage MUST use a suitable salted password-hashing scheme; reversible storage is prohibited absent exceptional scoped requirement** [NIST09].
34. **Account recovery MUST be threat-modeled as an authentication path.**
35. **Identity proofing and authentication MUST NOT be conflated; they answer different questions.**
36. **Machine/workload identities SHOULD use short-lived, scoped credentials where practical.**
37. **Device identity SHOULD NOT be treated as user authorization unless policy explicitly binds them.**

## 15.5 Authorization and privilege

38. **Least privilege applies to humans, services, CI jobs, agents, support tools and emergency paths.**
39. **Privilege MUST be scoped across resource, action, tenant, environment, duration and conditions where material.**
40. **Tenant selection is not tenant authorization.**
41. **Client-supplied tenant/resource ownership claims MUST be re-established at a trusted boundary.**
42. **High-risk privilege elevation SHOULD be time-bounded and auditable.**
43. **Standing privilege SHOULD be reduced where just-in-time or scoped delegation achieves the operational need without unacceptable fragility.**
44. **Separation of duties is required where one principal controlling the full action chain creates unacceptable fraud or security risk.**
45. **Break-glass authority MUST have narrower purpose, stronger evidence and explicit post-use review — not weaker controls.**
46. **Support impersonation or “login as user” capability MUST be treated as privileged production authority.**
47. **Authorization policy changes MUST receive change controls proportional to the authority they can grant.**

## 15.6 Sessions, tokens and delegated access

48. **Session identifiers and bearer tokens MUST be treated as credentials.**
49. **Token lifetime SHOULD reflect compromise consequence, revocation capability and user/workload behavior.**
50. **Refresh/reissuance paths MUST NOT silently create unlimited credential lifetime.**
51. **Logout/revocation semantics MUST be defined at the scopes that matter; UI logout alone is not necessarily server-side revocation.**
52. **OAuth/OIDC implementations MUST follow current security BCP and exact provider/protocol semantics; OAuth 2.1 draft status MUST remain explicit** [IETF01][IETF02].
53. **Redirect URIs, state/nonce/PKCE or equivalent protocol controls MUST be used according to the selected OAuth/OIDC flow's current security requirements.**
54. **A token's cryptographic validity MUST NOT be confused with application authorization.**
55. **JWTs MUST have explicit issuer, audience, algorithm/key, time and claim-validation rules; “it decodes” is not validation.**

## 15.7 Secrets, cryptography and keys

56. **Do not invent cryptographic primitives or protocols for production security without exceptional need and qualified review.**
57. **Use current, supported, well-analyzed cryptographic protocols and libraries.**
58. **Cryptographic requirements MUST include key lifecycle, not only algorithm names.**
59. **Secrets MUST NOT be embedded in ordinary source code, images, client bundles or logs.**
60. **Secrets SHOULD be scoped to the least required authority and environment.**
61. **Short-lived credentials SHOULD replace long-lived secrets where operationally feasible and the federation trust model is acceptable.**
62. **Key/secret rotation MUST be event- and threat-aware; fixed rotation intervals are contextual, not universal proof of security.**
63. **Compromise response MUST define credential/key revocation and re-establishment of trust.**
64. **Production signing or root trust keys SHOULD be isolated from ordinary application execution.**
65. **Key backup/recovery MUST NOT create a weaker equivalent-authority path.**
66. **Encryption-at-rest and in-transit claims MUST identify the attacker and key boundary they protect against.**
67. **TLS configuration MUST follow current protocol and BCP guidance; protocol negotiation and certificate/peer validation MUST be tested** [IETF03][IETF04].
68. **Cryptographic agility SHOULD be designed where system lifetime, regulatory requirements or cryptographic transition risk justify it.**
69. **Post-quantum migration SHOULD be inventory- and lifetime-driven rather than marketing-driven; use current NIST standards where applicable.**

## 15.8 Input, parsing and interpreter safety

70. **Validate untrusted data when trust or representation changes.**
71. **Validation MUST include semantics where syntax alone cannot protect the invariant.**
72. **Separate data from executable instructions using safe APIs, structured encodings and parameterization.**
73. **Output encoding MUST match the destination interpreter/context.**
74. **File uploads MUST be treated as hostile content and constrained by type, size, parser, storage, execution and retrieval behavior.**
75. **Parsers for complex untrusted formats SHOULD be bounded, isolated and fuzzed when consequence justifies it.**
76. **Path, shell, template, query, expression, serialization and deserialization boundaries MUST have interpreter-specific defenses.**
77. **Do not use “sanitize” as an unspecified security requirement. State the grammar, boundary and safe operation.**
78. **Server-side request behavior MUST constrain destination/protocol/address semantics where SSRF or network pivoting is credible.**
79. **Dynamic code evaluation MUST be prohibited or tightly isolated unless the product explicitly requires it.**

## 15.9 Application, API and business logic

80. **Object-, function- and property-level authorization MUST be explicit at APIs that expose those objects/functions/properties** [OWASP03].
81. **Business invariants MUST survive concurrency, replay, retries and attacker-chosen sequencing.**
82. **Sensitive workflows SHOULD defend against enumeration and identifier guessing without treating unguessable IDs as authorization.**
83. **Rate/resource controls MUST protect a named resource or abuse case; one global requests-per-minute number is not a security architecture.**
84. **High-value actions SHOULD have idempotency/replay controls when duplicate execution can cause harm.**
85. **Workflow steps MUST NOT rely on the client to enforce required sequencing.**
86. **Administrative APIs MUST receive at least the same security rigor as user-facing APIs.**
87. **GraphQL/RPC/event systems inherit the same authorization, resource, abuse and input-boundary requirements as REST.**
88. **CORS is a browser response-sharing policy and MUST NOT be used as server authorization.**
89. **CSRF defenses MUST be explicit when browser ambient credentials can authorize state-changing requests.**
90. **CSP SHOULD be treated as defense in depth against specific browser injection/execution paths, not a replacement for safe construction.**

## 15.10 Isolation and multi-tenancy

91. **Tenant isolation is a system invariant spanning identity, authorization, data, caches, queues, jobs, telemetry, admin and recovery.**
92. **Tenant context MUST originate from trusted authenticated/authorized state, not arbitrary client input.**
93. **Cross-tenant negative tests are mandatory for material multi-tenant boundaries.**
94. **Resource isolation/noisy-neighbor controls become security controls when one tenant can deny service or exhaust shared quotas.**
95. **Administrative cross-tenant capabilities MUST be separately privileged and auditable.**
96. **Backups, exports, analytics and support tooling MUST preserve tenant boundaries where relevant.**

## 15.11 Infrastructure and runtime

97. **Public exposure MUST be intentional, inventoried and owned.**
98. **Network segmentation MAY constrain attack paths but MUST NOT substitute for identity and authorization.**
99. **Management/control-plane interfaces SHOULD have stronger access requirements than ordinary workload traffic when compromise has broad authority.**
100. **Runtime privileges, host access, device access, kernel capabilities and filesystem permissions MUST be minimized according to threat model.**
101. **Containerization is isolation technology with boundaries and escape assumptions; “runs in a container” is not a security claim.**
102. **Running as non-root is a useful defense, not sufficient container security.**
103. **Host/cluster/cloud metadata and instance/workload identity endpoints MUST be protected from untrusted workloads and SSRF-like pivots.**
104. **Production configuration and infrastructure changes MUST be attributable and reviewable.**
105. **Security-relevant drift SHOULD be detectable.**
106. **Default-deny network policy is contextual; fail behavior must preserve critical recovery/control paths where needed.**

## 15.12 Supply chain and delivery

107. **Treat source control, CI/CD, build workers, artifact stores, signing services and deployment controllers as privileged production systems.**
108. **Dependencies, build actions/plugins, base images, models and generators are executable supply-chain inputs and require ownership.**
109. **Released artifacts MUST have an immutable identity sufficient to connect deployment to controlled source/build evidence.**
110. **Provenance, SBOM, signatures and vulnerability records answer different questions and MUST NOT be collapsed into one trust badge.**
111. **Consumer-side release/deployment policy SHOULD verify the evidence required by the threat model.**
112. **Build/release credentials SHOULD be short-lived and scoped where practical.**
113. **A compromised build system requires a clean trust-recovery path; rebuilding through the same untrusted path is not sufficient.**
114. **Supplier/product due diligence SHOULD scale with supplier authority, dependency depth, recoverability and blast radius** [NIST14].
115. **Third-party security attestations are inputs; the consuming system still owns integration risk.**

## 15.13 Vulnerability management

116. **Every production software asset SHOULD have a vulnerability-handling owner and supported-version policy.**
117. **Vulnerability intake MUST distinguish finding validity, affected asset/version, exposure, exploitability, consequence and available mitigation.**
118. **Use KEV and credible exploitation intelligence to elevate known-active threats; use EPSS as a probabilistic input, not certainty** [CISA03][FIRST02].
119. **CVSS MUST NOT be the sole remediation-priority mechanism** [FIRST01].
120. **Fix timing MUST consider update risk and service consequence; compensating mitigation may temporarily outrank a dangerous rushed patch.**
121. **Vulnerability exceptions MUST have owner, rationale, compensating controls, expiry/review trigger and residual risk.**
122. **Disclosure and handling workflows SHOULD align with ISO/IEC 29147 and ISO/IEC 30111 where they fit product scope** [ISO05][ISO06].
123. **Security debt MUST NOT be hidden indefinitely by “accepted risk” without review triggers.**

## 15.14 Detection, incident response and recovery

124. **Material privileged actions MUST emit sufficient audit evidence for investigation.**
125. **Security logging MUST avoid credentials/secrets and unjustified sensitive data.**
126. **Alerting SHOULD be tied to plausible harmful behavior or control failure, not log volume.**
127. **Detection coverage SHOULD map to material threat paths, not ATT&CK checkbox counts.**
128. **Incident containment MUST include authority revocation where compromised credentials/identities may remain valid.**
129. **Recovery MUST establish why the restored state is trustworthy.**
130. **Backups/restores used for security recovery MUST be protected from the compromise paths they are expected to recover from.**
131. **Compromise of a root of trust, signing key or control plane MUST trigger explicit trust-reset reasoning.**
132. **Incident response SHOULD feed changed threat models, controls and regression tests** [NIST12].

## 15.15 AI, LLM and agents

133. **Treat prompts, retrieved documents, web content, tool output and inter-agent messages as untrusted input unless provenance/trust is established.**
134. **Prompt injection MUST be modeled as an influence attack; natural-language instructions MUST NOT override deterministic authorization.**
135. **Tool authorization MUST be enforced outside the model.**
136. **Agent credentials MUST be scoped to the minimum resources/actions/time needed.**
137. **High-impact actions MUST have deterministic policy, limits and approval requirements appropriate to consequence.**
138. **An agent MUST NOT be able to grant itself broader credentials, increase its own budget or modify the policy that constrains it without separately authorized control.**
139. **Persistent memory MUST have write provenance, access control, correction/deletion semantics and injection/poisoning defenses.**
140. **Tool results MUST be treated as potentially malicious or misleading input to subsequent reasoning.**
141. **Read-only tools MUST still receive data-minimization, bulk-exfiltration and sensitive-query controls.**
142. **Model output that becomes executable code/query/command MUST pass interpreter-specific validation and authorization.**
143. **Human approval SHOULD expose exact intended side effects and relevant context; opaque “Approve” prompts are weak controls.**
144. **Agents MUST have bounded execution, stop/revoke paths, auditability and safe retry/replay semantics where autonomous work is material.**
145. **Security evaluation MUST include indirect prompt injection, malicious tools/content, memory poisoning, confused-deputy behavior and privilege escalation** [OWASP07][OWASP08][OWASP09].

## 15.16 Verification and evidence

146. **Security assurance MUST be claim-driven: identify what property the test or analysis can establish.**
147. **No single scanner, test suite, pentest or audit is proof of security.**
148. **Security-sensitive authorization and tenant-isolation code SHOULD receive independent review for C2+ changes.**
149. **Negative/adversarial tests SHOULD target prohibited outcomes, not only expected successful flows.**
150. **Fuzzing SHOULD be used where untrusted structured input and parser/state complexity justify it.**
151. **Formal specification/model checking MAY be used for high-consequence state/authority protocols where the state space or concurrency risk warrants it.**
152. **A formal proof establishes only the scoped property of the model/specification under stated assumptions.**
153. **Penetration testing SHOULD be scoped by threat model and major change, not calendar ritual alone.**
154. **Red teaming is contextual and most valuable when realistic adversarial objectives cannot be answered by lower-cost assurance.**
155. **Security verification results MUST identify the exact version/configuration/environment tested.**
156. **Production monitoring is part of security assurance because pre-release evidence cannot cover every real deployment behavior.**

## 15.17 Human and organizational security

157. **Security-critical procedures MUST be designed for realistic operator workload and error, not idealized perfect execution.**
158. **High-consequence manual steps SHOULD use independent verification or structural safeguards where human slips are plausible.**
159. **Security training MUST NOT substitute for a fixable unsafe product design.**
160. **Security incentives SHOULD reward truthful risk reporting and early defect discovery rather than suppressing findings.**
161. **Exception paths MUST be easier to audit than ordinary safe paths, not easier to abuse.**
162. **Operators MUST know how to revoke, contain and escalate without depending on the component that may be compromised.**

## 15.18 Maintenance and retirement

163. **Supported-version and end-of-life policy is a security control.**
164. **Unsupported runtimes/dependencies MUST be treated as explicit security debt.**
165. **Deprecation MUST include removal of old credentials, routes, listeners, integrations and policy grants.**
166. **Retirement MUST remove or archive data according to lifecycle rules and revoke residual authority.**
167. **Old signing keys, service identities, DNS records, cloud roles, API tokens and backup access MUST NOT survive retirement without a reason.**
168. **Security architecture MUST be re-evaluated when threat, technology or authority materially changes.**

---

# 16. Secure-by-design lifecycle

Security work is continuous but not uniform. The lifecycle is a set of responsibilities that can run iteratively and concurrently.

```text
INTENT
→ SECURITY CONTEXT / CRITICALITY
→ REQUIREMENTS + THREAT MODEL
→ ARCHITECTURE / CONTROL DESIGN
→ SECURE CONSTRUCTION
→ VERIFICATION / ADVERSARIAL TESTING
→ RELEASE / EXPOSURE DECISION
→ PRODUCTION MONITORING
→ VULNERABILITY + INCIDENT HANDLING
→ RECOVERY / TRUST RESET
→ MAINTENANCE / CHANGE
→ RETIREMENT
→ LEARNING
```

NIST SSDF is explicitly designed to integrate secure-development practices into varied SDLCs rather than prescribe one development methodology [NIST02]. IEC 62443-4-1 provides a stronger product-development lifecycle baseline for its industrial automation/control scope [IEC01].

## 16.1 Security intake

Before implementation, determine:

```yaml
change_or_system:
criticality:
external_exposure:
protected_assets:
high_value_actions:
new_or_changed_authority:
new_trust_boundaries:
new_data_or_sensitivity:
new_dependencies_or_suppliers:
new_interpreters_or_uploads:
new_admin_recovery_paths:
ai_agent_autonomy_change:
applicable_external_requirements:
required_security_review_depth:
```

## 16.2 Design gate

A material design is security-ready when:

- assets and high-value actions are explicit;
- trust and authority boundaries are represented;
- prohibited outcomes/security invariants are stated;
- material threats are modeled;
- controls are attached to threats/invariants;
- recovery/containment exists for plausible control failure;
- assurance methods are selected;
- residual risk has a decision owner.

## 16.3 Construction gate

Implementation MUST preserve:

- trusted-boundary enforcement;
- secure defaults;
- least privilege;
- safe error/failure behavior;
- secret separation;
- dependency controls;
- security telemetry;
- change traceability;
- testability of security invariants.

## 16.4 Release gate

For C2+ releases, security release evidence SHOULD answer:

```text
WHAT EXACTLY IS BEING RELEASED?
WHICH SECURITY-SENSITIVE CHANGE OCCURRED?
WHICH THREATS / REQUIREMENTS ARE AFFECTED?
WHICH TESTS / REVIEWS PASSED?
WHICH FINDINGS REMAIN?
WHAT IS THE EXPOSURE / BLAST RADIUS?
HOW WILL HARM BE DETECTED?
HOW WILL AUTHORITY BE REVOKED OR RELEASE STOPPED?
WHAT IS THE RECOVERY PATH?
WHO ACCEPTS RESIDUAL RISK?
```

## 16.5 Operation gate

Security operation requires:

- attack-surface/exposure inventory that is sufficiently current;
- identity/privilege lifecycle;
- vulnerability monitoring;
- relevant security telemetry;
- incident ownership;
- credential/key lifecycle;
- configuration/drift control;
- dependency/provider watch;
- recovery/trust-reset readiness;
- change-triggered threat-model updates.

---

# 17. Identity and authentication engineering

Identity systems are security control planes. Compromise or ambiguity in identity can invalidate every downstream authorization decision.

## 17.1 Separate the identity questions

```text
IDENTIFICATION      — which claimed identity is being referenced?
IDENTITY PROOFING   — how strongly was a real-world identity established, if needed?
AUTHENTICATION      — how is control of an authenticator established now?
AUTHENTICATOR BINDING — how was the authenticator bound to the account/principal?
SESSION ESTABLISHMENT — how is continued authenticated state represented?
AUTHORIZATION       — what may the authenticated principal do?
DELEGATION          — what authority may one principal grant another?
RECOVERY            — how can identity/control be re-established?
REVOCATION          — how is compromised or obsolete authority terminated?
```

NIST SP 800-63-4 and 63B-4 are the current U.S. federal digital-identity baseline at this evidence cutoff [NIST08][NIST09]. They are strong identity-engineering references, not automatically binding requirements for every product.

## 17.2 Authentication assurance decision

Choose authentication based on:

- protected authority;
- remote vs local access;
- attacker incentive;
- phishing exposure;
- device/environment constraints;
- account recovery path;
- usability/accessibility;
- population scale;
- fraud model;
- federation trust;
- regulatory/contractual scope.

### Default posture

| Context | Recommended posture |
|---|---|
| low-risk consumer feature | appropriate modern password/passkey/social auth; abuse and recovery considered |
| ordinary production workforce | MFA; stronger assurance for admin/control-plane access |
| privileged/admin access | phishing-resistant authentication preferred; device/session posture where justified |
| C3 high-value external action | phishing-resistant cryptographic auth or equivalent risk-proportionate mechanism; step-up where context changes |
| C4/domain critical | domain-specific assurance governs |

## 17.3 Password standard

When passwords are used, follow current NIST direction [NIST09]:

- permit long passwords/passphrases;
- single-factor password minimum length is 15 characters under current NIST federal guidance; password used as part of MFA may have a lower minimum under that guidance;
- allow at least 64 characters;
- do not impose arbitrary composition requirements as a security default;
- do not force periodic changes absent compromise or scoped reason;
- compare new passwords against common/compromised values;
- use secure salted password hashing;
- rate-limit guessing appropriately;
- support password-manager paste/autofill rather than blocking it.

Do not copy numeric NIST requirements into a regulated/private product without first establishing applicability and usability needs; preserve the underlying security mechanisms.

## 17.4 Passkeys/WebAuthn

W3C WebAuthn Level 3 became a Recommendation on 25 August 2026 [W3C01].

Use WebAuthn/passkeys where they fit because cryptographic origin binding can provide phishing-resistant authentication. Still threat-model:

- account recovery;
- device loss;
- sync-provider security;
- enterprise attestation needs;
- shared-device behavior;
- fallback authentication;
- credential enrollment/replacement;
- cross-device flows.

The fallback can determine the effective assurance level.

## 17.5 Authentication events that deserve audit evidence

At minimum for C2+ systems, consider:

- authenticator enrollment/removal;
- MFA/passkey change;
- recovery initiation/completion;
- password reset;
- privileged session start;
- suspicious or blocked authentication;
- risk/step-up challenge;
- federation trust/config change;
- service/workload credential issuance;
- revocation.

## 17.6 Account recovery

Recovery MUST answer:

```text
Who may initiate recovery?
What evidence is required?
What existing sessions/credentials are revoked?
Can an attacker change the destination of recovery first?
Can support bypass normal recovery?
What happens if primary factors are unavailable?
How is high-value authority restored?
How is recovery logged and notified?
How can fraudulent recovery be stopped/reversed?
```

A weaker recovery path makes stronger primary authentication largely cosmetic.

---

# 18. Authorization, privilege and tenant isolation

Authorization is the enforcement of permitted behavior. It must be evaluated from the exact policy required by the resource/action, not from a UI concept.

## 18.1 Canonical authorization question

```text
MAY principal P
perform action A
on resource R
for tenant / owner T
under context C
at time / state S
with delegation D?
```

If the policy cannot answer that question, it is probably underspecified.

## 18.2 Authorization models are contextual

### RBAC

Strong fit when:

- job functions map cleanly to stable permission bundles;
- reviewability matters;
- role count remains manageable.

Risks:

- role explosion;
- overbroad inherited permissions;
- poor resource/context specificity.

### ABAC / policy conditions

Strong fit when:

- context, attributes, environment or resource properties drive decisions;
- centrally expressed policy reduces duplication.

Risks:

- invisible complexity;
- stale/untrusted attributes;
- hard-to-explain policy interactions.

### Relationship-based authorization

Strong fit when access follows graph relationships such as owner/member/editor/team/project.

Risks:

- graph consistency;
- transitive grants;
- stale relationships;
- expensive or ambiguous checks.

### Capability-based authorization

Strong fit when explicit delegated authority tokens/handles fit the domain.

Risks:

- delegation leakage;
- revocation complexity;
- bearer handling.

No model is universally superior. Choose the least complex mechanism that can express and enforce the real policy.

## 18.3 Authorization architecture

For material systems define:

```yaml
policy_source_of_truth:
policy_language_or_model:
trusted_identity_attributes:
resource_owner_authority:
decision_point:
enforcement_points: []
policy_cache_semantics:
revocation_semantics:
delegation_semantics:
tenant_context_source:
audit_events:
negative_tests:
```

## 18.4 Server-side / trusted-boundary enforcement

A frontend MAY hide unavailable actions for UX. That is not authorization.

Trusted enforcement is required for:

- API requests;
- background jobs;
- event handlers;
- admin/support tools;
- batch exports;
- direct database/repair paths;
- agent tool actions;
- scheduled work;
- webhook/integration actions.

## 18.5 Tenant isolation

Treat tenant isolation as a multi-plane invariant:

```text
IDENTITY
→ TENANT RESOLUTION
→ AUTHORIZATION
→ DATA / OBJECTS
→ CACHE
→ QUEUE / JOB
→ FILE / SEARCH / VECTOR
→ TELEMETRY
→ ADMIN / SUPPORT
→ BACKUP / EXPORT / RESTORE
→ DELETE / RETIRE
```

Required tests for C2+ multi-tenant systems SHOULD include:

- foreign object identifiers;
- cross-tenant list/search/filter;
- cache-key collision/missing tenant key;
- background job with wrong tenant context;
- import/export boundary;
- support/admin bypass;
- derived store/vector/search isolation;
- backup/restore/export isolation;
- async message context tampering;
- tenant deletion/move/reassignment.

## 18.6 Privilege elevation and just-in-time access

Use temporary elevation where it materially reduces standing privilege and the operational system can support it reliably.

Elevation records SHOULD include:

```yaml
principal:
requested_privilege:
resource_scope:
reason:
approver_or_policy:
start:
expiry:
session_or_ticket:
actions_audited:
revocation:
```

## 18.7 Separation of duties

Use separation when one actor controlling all stages creates unacceptable opportunity for fraud or irreversible abuse.

Potential separations:

- request vs approve;
- code author vs production release;
- key custodian vs transaction approver;
- support request vs impersonation approval;
- policy author vs policy deployment;
- backup administrator vs deletion authority.

Do not force segregation into low-risk work if it only creates ceremony and bypass pressure.

---

# 19. Sessions, tokens, federation and delegated access

## 19.1 Session contract

For each authenticated session define:

```yaml
session_type:
principal:
authenticator_assurance:
issued_by:
credential_representation:
audience:
scope:
issued_at:
absolute_expiry:
inactivity_expiry_if_any:
refresh_or_reauth_rules:
rotation_rules:
revocation_semantics:
logout_semantics:
device_binding_if_any:
step_up_conditions:
audit_events:
```

## 19.2 Bearer token rule

A bearer token is authority in whoever possesses it.

Protect against:

- browser/storage exposure;
- logs/URLs/referrers;
- clipboard/error telemetry;
- overly broad audience/scope;
- long lifetime;
- replay;
- weak transport;
- accidental forwarding to another service.

## 19.3 JWT validation

When JWTs are used, validation MUST establish the claims the application depends on.

At minimum where applicable:

- expected issuer;
- intended audience;
- allowed algorithm and key source;
- signature;
- time validity (`exp`, `nbf`, `iat` semantics where used);
- token type/use separation where relevant;
- required subject/client/scope/authorization context;
- key rollover behavior.

Do not accept algorithm/key selection directly from untrusted token input without a constrained trust model. RFC 8725 / BCP 225 is the current JWT Best Current Practice and should be used when JWTs are part of the design [IETF05].

## 19.4 OAuth 2.0 / OAuth 2.1 status

RFC 9700 / BCP 240 is the current OAuth 2.0 Security Best Current Practice [IETF01].

OAuth 2.1 remains an Internet-Draft at the evidence cutoff [IETF02]. It MAY inform design direction, but it MUST NOT be represented as a final RFC.

When implementing OAuth/OIDC:

- select the flow for the client and threat model;
- use exact redirect matching and trusted redirect configuration;
- use PKCE where current protocol guidance requires/recommends it;
- validate issuer/audience/nonce/state as applicable;
- protect authorization codes/tokens from leakage/replay;
- scope delegated access;
- avoid legacy/deprecated flows unless a constrained compatibility reason exists;
- verify provider-specific semantics from current official documentation.

## 19.5 Federation

Federation moves trust; it does not remove it.

Model:

```text
Identity Provider compromise
→ account linking errors
→ stale group/role claims
→ tenant-domain confusion
→ issuer mix-up
→ key rollover
→ deprovisioning delay
→ recovery / support overrides
```

The relying party remains responsible for its own resource authorization.

## 19.6 Service-to-service access

Prefer workload identity/federation over shared static secrets when the platform supports it and the identity/control-plane trust is acceptable.

Define:

- who issues identity;
- how workload identity is bound to runtime;
- audience/resource scope;
- credential lifetime;
- delegation/impersonation rights;
- revocation;
- cross-environment isolation;
- logging;
- fallback behavior if identity provider/control plane is unavailable.

---

# 20. Secrets, cryptography and key management

Cryptography is a lifecycle system. NIST SP 800-57 remains a key-management baseline; current draft revisions must not silently replace final publications [NIST15].

## 20.1 Classify security material

Distinguish:

- password verifier;
- API key;
- bearer token;
- refresh token;
- client secret;
- private key;
- symmetric encryption key;
- signing key;
- root/CA key;
- HSM/KMS key handle;
- recovery key/share;
- certificate;
- seed phrase/private wallet key;
- bootstrap secret;
- database credential;
- service-account credential;
- CI/deployment credential.

They have different compromise and recovery semantics.

## 20.2 Secret lifecycle

```text
CREATE / ISSUE
→ DISTRIBUTE / BIND
→ STORE
→ USE
→ OBSERVE WITHOUT DISCLOSURE
→ ROTATE / RENEW
→ REVOKE
→ RECOVER / RE-ESTABLISH
→ DESTROY / EXPIRE
→ AUDIT
```

For material secrets record:

```yaml
secret_or_key_id:
purpose:
owner:
authority_granted:
issuer_or_generator:
storage_boundary:
readable_exportable: true|false
consumers: []
scope:
expiry:
rotation_trigger:
revocation_path:
recovery_path:
audit_events:
compromise_play:
```

## 20.3 Secret storage

Production secrets SHOULD use a secret-management or platform-protected facility appropriate to the threat model.

Do not store live secrets in:

- source code;
- committed `.env` files;
- public/client bundles;
- ordinary logs;
- screenshots/tickets/chat;
- container images;
- unprotected preferences/local storage;
- test fixtures copied from production.

## 20.4 Rotation

Rotate because the risk model justifies it:

- suspected/confirmed compromise;
- personnel/tenant/consumer change;
- cryptographic or provider requirement;
- bounded credential lifetime;
- algorithm/key migration;
- policy/contract;
- periodic operational hygiene where compromise-detection assumptions justify it.

Do not rotate high-risk keys blindly if rotation itself can create outage, split-brain trust or irreversible loss. Rehearse critical rotation.

## 20.5 Key custody and separation

For high-value keys, separate where justified:

- key material from ordinary application memory;
- key management from transaction/business approval;
- signing authority from artifact creation;
- recovery shares from primary operators;
- production keys from development/test;
- key policy administration from key use.

## 20.6 Cryptographic primitive/protocol selection

Use:

- current standardized algorithms/protocols;
- maintained libraries/providers;
- platform cryptographic services where they fit;
- secure randomness;
- correct nonce/IV semantics;
- authenticated encryption where confidentiality + integrity are required;
- context/domain separation where protocol design requires it.

Custom primitive design requires qualified cryptographic expertise and exceptional justification.

## 20.7 Post-quantum transition

NIST finalized FIPS 203, 204 and 205 in 2024 as post-quantum cryptographic standards [NIST16].

A migration decision SHOULD consider:

- data confidentiality lifetime (“harvest now, decrypt later” exposure);
- signature verification lifetime;
- protocol/ecosystem readiness;
- provider/library support;
- hybrid/interoperability requirements;
- key/certificate sizes and performance;
- rollback/compatibility;
- external regulatory/customer requirements.

Do not replace proven classical cryptography with experimental constructions merely to claim “quantum safe.”

## 20.8 TLS

RFC 9846 is the current TLS 1.3 RFC and obsoletes RFC 8446/RFC 5246; RFC 9325 remains current BCP guidance for secure TLS/DTLS use [IETF03][IETF04].

A TLS security claim should establish:

- protocol versions;
- certificate validation and hostname/identity binding;
- trust store/root policy;
- cipher/algorithm policy where configurable;
- client authentication if required;
- key lifecycle;
- termination points;
- internal plaintext boundaries if any;
- observability that does not leak keys/content;
- downgrade/legacy behavior.

## 20.9 Cryptography decision record

```yaml
crypto_decision_id:
asset_or_property:
threat:
protocol_or_primitive:
standard_and_version:
library_or_service:
key_type_and_length:
key_owner:
generation:
storage:
use_boundary:
rotation:
revocation:
recovery:
algorithm_agility:
interoperability:
verification:
residual_risk:
review_trigger:
```

---

# 21. Input, output, parsing and interpreter security

Most injection failures are boundary failures: attacker-controlled data reaches an interpreter or privileged operation with more meaning than intended.

## 21.1 Boundary classification

For every material untrusted input identify:

```yaml
input:
source:
trust_level:
representation:
expected_grammar:
semantic_constraints:
max_size_or_resource_cost:
interpreter_or_sink:
privileged_side_effects:
validation:
normalization:
output_encoding:
isolation:
error_behavior:
fuzzing_or_negative_tests:
```

## 21.2 Validation model

Validation can include:

- type/schema validation;
- length/range/cardinality;
- allowed enum/state;
- identifier syntax;
- semantic ownership/existence;
- business invariant;
- canonicalization/normalization where required;
- resource limits;
- content-type/magic-byte checks;
- protocol/URL/address restrictions;
- authorization of the requested effect.

Validation MUST occur again when data crosses into a boundary that needs stronger guarantees.

## 21.3 Injection prevention hierarchy

Prefer, in order of strength where applicable:

1. **Avoid an interpreter boundary** when unnecessary.
2. **Use typed/structured APIs that separate code from data.**
3. **Use allowlisted operations/identifiers when the grammar is constrained.**
4. **Parameterize values using the interpreter's safe mechanism.**
5. **Encode/escape for the exact output context.**
6. **Constrain execution privileges and resources.**
7. **Add detection/WAF-like controls as defense in depth where useful.**

“Escape user input” is not a universal rule because escaping depends on the exact grammar/context.

## 21.4 SQL/query boundaries

Use parameterized values for data values. Do not assume parameterization protects dynamic identifiers, sort expressions, operators or entire query fragments.

For dynamic query structure:

- map user options to internal allowlisted fields/operators;
- enforce authorization independently from query construction;
- bound result size and cost;
- verify row/tenant predicates;
- avoid exposing raw ORM/filter DSLs unless intentionally sandboxed.

Database constraints remain important even when application validation exists.

## 21.5 Shell/command execution

Avoid shell construction when a direct process/API invocation exists.

When command execution is required:

- use argument arrays rather than string concatenation where supported;
- allowlist executable/operations;
- constrain environment and working directory;
- avoid inheriting unnecessary credentials;
- set resource/time limits;
- isolate filesystem/network privileges;
- treat exit code/stdout/stderr as untrusted outputs;
- never authorize an operation because an LLM generated the command.

## 21.6 Template / HTML / browser output

For web output:

- prefer frameworks/templates with context-aware escaping;
- distinguish HTML text, attributes, URLs, CSS and JavaScript contexts;
- avoid inserting untrusted data into executable contexts;
- use CSP/Trusted Types or equivalent browser defenses where they materially reduce residual risk;
- test DOM-based paths in real browsers.

CSP is defense in depth. It does not repair arbitrary unsafe DOM/script construction.

## 21.7 Deserialization

Treat deserialization formats that can instantiate arbitrary types or execute callbacks as high risk.

Prefer:

- simple data formats;
- explicit schemas;
- allowlisted types;
- no executable object graphs;
- bounded nesting/size;
- safe parser modes;
- cryptographic integrity only when authenticity/integrity is actually needed — not as a substitute for safe parsing.

## 21.8 Files and uploads

Model the complete file lifecycle:

```text
UPLOAD
→ TRANSPORT LIMIT
→ TEMP STORAGE
→ TYPE / CONTENT INSPECTION
→ PARSE / TRANSFORM
→ MALWARE / CONTENT SCAN IF JUSTIFIED
→ DURABLE STORAGE
→ METADATA
→ ACCESS CONTROL
→ DOWNLOAD / RENDER / EXECUTE
→ RETENTION / DELETE
```

Potential controls:

- size/count quotas;
- random server-side names;
- storage outside executable/public web roots;
- safe content disposition;
- image/document re-encoding where appropriate;
- parser isolation;
- archive-bomb limits;
- antivirus/content scanning where threat-fit;
- no trust in client MIME/extension alone;
- authorization on upload and retrieval;
- separate untrusted content origins.

## 21.9 URL/SSRF boundaries

When servers fetch attacker-influenced destinations:

- define permitted schemes;
- resolve/validate destination according to network threat model;
- protect metadata/control-plane endpoints;
- handle redirects under the same policy;
- bound response size/time;
- block credentials in arbitrary destinations;
- separate DNS/IP checks from authorization where rebinding/routing changes are possible;
- isolate egress where consequence warrants it.

## 21.10 XML, archives, media and complex parsers

Complex parsers can create:

- entity expansion;
- path traversal;
- decompression bombs;
- memory/CPU exhaustion;
- parser differential behavior;
- native-code memory corruption;
- embedded script/macro execution.

Disable unnecessary features and test representative hostile inputs.

---

# 22. Application, web and API security

This section defines cross-application security invariants. Browser-specific engineering belongs in Playbook 14; API/distributed semantics belong in Playbook 13; backend runtime depth belongs in Playbook 15.

## 22.1 Application security baseline

OWASP ASVS 5.0.0 is the current stable application-security verification standard at this cutoff [OWASP02]. It is a useful requirement/verification catalogue, not a substitute for a system-specific threat model.

OWASP Top 10:2025 is a current awareness taxonomy, not a complete security standard [OWASP01].

NIST SP 800-228 (including its March 13, 2026 update) provides current lifecycle-oriented API protection guidance and explicitly supports incremental, risk-based control selection; the REST-specific SP 800-228A remains an Initial Public Draft and is therefore a watch item rather than a final baseline [NIST17].

## 22.2 Browser/server authority

The browser/client can represent state and prevent accidental actions. It cannot be the final authority for:

- resource ownership;
- tenant membership;
- role/permission;
- price/discount authority;
- entitlement;
- workflow completion;
- financial limits;
- trusted timestamps;
- admin status.

Enforce consequential policy server-side or at another trusted boundary.

## 22.3 CSRF

CSRF becomes relevant when a browser automatically attaches credentials to a state-changing request and an attacker can cause that request cross-site.

Choose defenses based on architecture:

- SameSite cookies as defense in depth;
- anti-CSRF tokens;
- origin/referer verification where appropriate;
- avoid state change on safe/idempotent methods;
- custom headers/non-simple requests where architecture supports it;
- explicit reauthentication/step-up for high-value actions.

SameSite alone is not automatically complete CSRF protection.

## 22.4 CORS

CORS governs whether browser JavaScript can read certain cross-origin responses. It does not prevent non-browser callers and is not resource authorization.

CORS configuration SHOULD:

- allow only needed origins/methods/headers;
- avoid wildcard credentials combinations;
- handle origin reflection carefully;
- separate public APIs from authenticated browser APIs where useful.

## 22.5 Cookies

For authentication/session cookies where applicable:

- `Secure`;
- `HttpOnly` when JS access is unnecessary;
- appropriate `SameSite`;
- minimal domain/path scope;
- bounded lifetime;
- rotation/invalidation semantics;
- do not place secret/session material in URLs.

## 22.6 Browser storage

Browser-accessible storage is readable by origin JavaScript. Do not treat local/session storage as a credential vault. Prefer storage/session architectures that reduce credential exposure to injected script when feasible.

## 22.7 API authorization

OWASP API Security Top 10 2023 emphasizes object- and function-level authorization and resource consumption among recurring API risks [OWASP03].

For every API operation, verify:

```text
principal
+ tenant / organization
+ resource ownership / relationship
+ action
+ field/property scope
+ workflow state
+ environmental/conditional policy
```

## 22.8 API resource abuse

Protect expensive operations by the resource actually at risk:

- CPU;
- memory;
- DB queries/locks;
- queue depth;
- external API cost;
- AI token/compute cost;
- file/storage growth;
- email/SMS spend;
- financial/transaction action;
- object enumeration.

Controls can include quotas, concurrency bounds, cost budgets, pagination, query complexity, admission control, rate limits and async queues — selected by failure mode.

## 22.9 Error handling

Errors MUST NOT leak secrets, credentials, stack internals or unnecessary sensitive state to untrusted callers.

But “generic errors everywhere” can harm operations. Use separate channels:

```text
USER / CLIENT RESPONSE
→ safe category + actionable message

OPERATOR EVIDENCE
→ structured internal context + correlation + diagnostic detail
```

## 22.10 Security headers/browser policies

Use browser security policies where the threat model fits:

- CSP;
- frame-ancestors / clickjacking controls;
- MIME sniffing protections;
- referrer policy;
- Permissions Policy;
- HSTS where HTTPS-only assumptions are correct.

Treat each as a scoped mechanism, not a “security headers score.”

## 22.11 WebSockets/streaming

Long-lived connections still require:

- authenticated principal/context;
- authorization per subscription/resource/action;
- tenant isolation;
- origin considerations for browser clients;
- message validation;
- resource/concurrency limits;
- revocation/re-auth policy for long sessions;
- safe reconnect/replay semantics.

## 22.12 GraphQL

Threat-model:

- object/field authorization;
- query depth/complexity;
- batching/amplification;
- introspection policy where material;
- data-loader/cache tenant keys;
- error leakage;
- subscriptions;
- mutations and workflow authorization.

GraphQL itself is neither more nor less secure than REST; implementation semantics determine risk.

## 22.13 Webhooks

Webhook consumers SHOULD define:

- trusted sender/authentication;
- integrity/authenticity mechanism;
- replay window/nonce/event ID where needed;
- duplicate handling;
- payload schema + semantics;
- source IP as optional defense, not identity by itself;
- timeouts/resource bounds;
- delayed/reordered delivery behavior;
- dead-letter/reconciliation;
- secret rotation.

---

# 23. Business-logic security, abuse and fraud resistance

Traditional vulnerability classes do not cover all economically harmful behavior.

## 23.1 Business invariant first

Examples:

```text
A refund cannot exceed captured value.
A coupon cannot be redeemed beyond its permitted population/limit.
A user cannot vote more times than policy permits.
A withdrawal cannot exceed available authorized balance.
A booking cannot consume inventory after it has been allocated elsewhere.
An inviter cannot create unlimited high-value referral rewards through self-dealing.
```

Make these invariants explicit and enforce them transactionally where required.

## 23.2 Abuse model

For high-value flows ask:

- How can a legitimate feature be used at illegitimate scale?
- What if identities are cheap or synthetic?
- What if many accounts coordinate?
- What if requests are reordered/replayed?
- What if state changes concurrently?
- What if an attacker automates the UI/API?
- What if credits/refunds/rewards can loop?
- What if a privileged operator colludes?
- What if external providers return stale/manipulated data?

## 23.3 Controls

Possible controls include:

- domain constraints;
- idempotency/effect identity;
- velocity limits;
- risk-based step-up;
- delayed settlement;
- cooling periods;
- anomaly detection;
- device/account linkage where lawful and justified;
- manual review for high-value outliers;
- dual authorization;
- cumulative limits;
- reputation/history;
- reconciliation.

No single fraud score should be the sole control for irreversible high-value actions unless the decision risk is justified and monitored.

## 23.4 Enumeration and scraping

Enumeration can expose data or enable downstream attacks even when each response is authorized.

Controls may include:

- access-control scope;
- query/result limits;
- response minimization;
- pagination and quotas;
- anti-automation controls;
- detection;
- avoiding unnecessary existence oracles;
- rate/resource budgets.

Do not rely on UUID randomness alone as an authorization control.

## 23.5 Anti-automation

CAPTCHAs and bot challenges are contextual. They can create accessibility and user-friction costs and may be bypassed.

Use them only as one layer in an abuse strategy when they protect a defined scarce resource or attack path.

---

# 24. Data and storage security interface

Detailed data integrity, transactions, consistency, recovery and storage design belong to Playbook 12. Privacy purpose/minimization/retention/rights belong to Playbook 07. Security owns unauthorized access, mutation, exfiltration, corruption, isolation and security-recovery requirements.

## 24.1 Data security classification

For security decisions classify data by consequence of:

```text
DISCLOSURE
UNAUTHORIZED MODIFICATION
DELETION / LOSS
STALE OR INCORRECT VALUE
UNAVAILABILITY
BULK EXTRACTION
CORRELATION / REIDENTIFICATION
```

## 24.2 Data access

Protect data at the strongest practical layer:

- application/service authorization;
- database grants/roles;
- row/tenant controls;
- storage ACLs/policies;
- encryption/key boundaries;
- network reachability;
- admin/support tooling.

Defense in depth is strongest when controls fail independently.

## 24.3 Database authorization

Database accounts SHOULD be scoped by workload purpose/environment.

Avoid:

- application superuser access;
- shared admin credentials;
- broad cross-environment accounts;
- direct user-provided table/column access;
- repair scripts with indefinite standing privilege.

## 24.4 Row-level and tenant isolation

Database RLS or equivalent MAY provide strong defense in depth when:

- policy is correctly bound to trusted tenant/user context;
- privileged bypass roles are controlled;
- connection pooling/session state cannot leak context;
- migrations/maintenance paths preserve isolation;
- tests exercise bypass/cross-tenant cases.

RLS does not automatically secure application-level resources or caches.

## 24.5 Encryption at rest

Ask what threat it addresses:

- stolen physical media;
- snapshot/object-store disclosure;
- cloud/provider boundary;
- backup media;
- tenant/application separation;
- privileged database operators.

Provider-managed disk encryption may protect lost media while doing little against an overprivileged application process.

## 24.6 Backups

Backups are security-sensitive because they may contain:

- full data history;
- old secrets;
- deleted records;
- system configuration;
- key material.

Backups SHOULD have:

- access control separate enough from normal workloads;
- encryption/key policy;
- retention;
- immutability/isolation when ransomware/destructive compromise is relevant;
- restore testing;
- audit evidence;
- deletion/privacy handling under the applicable lifecycle.

## 24.7 Repair and emergency data access

A one-off SQL command can be more privileged than application code.

Treat repair as a controlled production mutation:

```text
INTENT
→ SCOPE / TARGET
→ AUTHORIZATION
→ BACKUP / PRECONDITION
→ DRY RUN / QUERY PREVIEW
→ BOUNDED EXECUTION
→ AUDIT
→ RECONCILIATION
→ VERIFY POSTCONDITION
```

---

# 25. Infrastructure, network, cloud, container and runtime security

Detailed platform/IaC engineering belongs to Playbook 17. This section defines the security invariants that infrastructure implementations must preserve.

## 25.1 Infrastructure security model

Protect:

- management plane;
- identity plane;
- network ingress/egress;
- compute/runtime isolation;
- metadata/workload identity;
- persistent state;
- secrets/KMS;
- configuration/IaC;
- image/artifact supply chain;
- observability evidence;
- backup/recovery plane.

## 25.2 Administrative hierarchy and blast radius

Cloud/account/project/subscription/cluster/namespace boundaries SHOULD be used intentionally to reduce:

- privilege inheritance;
- accidental cross-environment access;
- resource blast radius;
- billing/resource abuse;
- policy drift;
- secret sharing.

A cloud “account” or Kubernetes namespace is not automatically a hard security boundary; verify actual platform semantics.

## 25.3 Management plane

Control-plane access generally has disproportionate authority.

For C2+ production:

- strong human authentication;
- scoped roles;
- workload identity for automation;
- separate production/non-production where useful;
- privileged actions audited;
- break-glass defined;
- root/owner accounts protected and rarely used;
- recovery contacts/credentials secured;
- provider-level policy changes controlled.

## 25.4 Network security

Network controls can:

- reduce reachability;
- contain lateral movement;
- constrain egress;
- isolate environments;
- protect management surfaces.

They cannot replace:

- service identity;
- authorization;
- tenant/resource policy;
- safe application construction.

NIST zero-trust guidance explicitly rejects implicit trust based only on network location [NIST10].

## 25.5 Ingress

For each exposed listener know:

```yaml
service:
protocol:
port_or_route:
audience:
identity_or_auth:
authorization:
rate_resource_controls:
tls_termination:
public_or_private:
owner:
required_exposure:
```

Remove orphaned listeners/routes/domains.

## 25.6 Egress

Egress can enable:

- exfiltration;
- command-and-control;
- SSRF pivots;
- supply-chain download;
- data residency violations;
- unbounded cost.

Use egress constraints when they materially reduce credible risk without breaking necessary recovery/operations.

## 25.7 Containers

A container threat model should consider:

- image provenance;
- vulnerable packages;
- excessive Linux capabilities;
- privileged mode;
- host mounts/devices;
- namespace isolation;
- runtime/socket access;
- kernel/shared-host risk;
- secret injection;
- network policy;
- writable filesystem;
- resource limits;
- metadata/workload identity access.

Do not treat “non-root” or “read-only root filesystem” as sufficient alone.

## 25.8 Orchestrators

For Kubernetes-like systems consider:

- API/control-plane access;
- RBAC/policy;
- service accounts/workload identity;
- admission/policy controls;
- secrets;
- network policy;
- node privilege;
- image sources;
- namespace/tenant assumptions;
- audit logs;
- etcd/control-plane backup;
- cluster-admin break-glass.

Do not introduce an orchestrator only for security prestige; complexity can create new attack surface.

## 25.9 Serverless/managed services

Managed services shift responsibilities but do not eliminate them.

Model:

- provider/customer responsibility boundary;
- service identity;
- event source authorization;
- trigger replay/duplication;
- secret/config injection;
- provider control-plane roles;
- network/data exposure;
- build/dependency supply chain;
- logs;
- region/backup/recovery.

## 25.10 IaC and policy as code

Production-affecting infrastructure definitions SHOULD be versioned and reviewed according to consequence.

Security-relevant changes include:

- public exposure;
- firewall/security group;
- IAM role/policy;
- KMS/key policy;
- secret access;
- cluster privilege;
- storage ACL;
- logging/audit disablement;
- backup/retention;
- DNS/domain ownership;
- CI/deployment permissions.

Use static/policy checks where they reliably detect meaningful unsafe states. Do not equate policy-as-code coverage with secure runtime state.

---

# 26. Software supply-chain and delivery security interface

Playbook 10 owns full delivery/supply-chain engineering. Security defines the threat, authority and assurance requirements that delivery must satisfy.

## 26.1 Supply-chain security questions

```text
WHO MAY CHANGE SOURCE?
WHAT INPUTS CAN EXECUTE DURING BUILD?
WHO/WHAT MAY BUILD?
CAN BUILDERS ACCESS SECRETS OR NETWORK?
HOW IS ARTIFACT IDENTITY ESTABLISHED?
WHAT PROVENANCE EXISTS?
WHO MAY SIGN / ATTEST?
WHO MAY PROMOTE / DEPLOY?
DO CONSUMERS VERIFY POLICY?
HOW IS A COMPROMISED TRUST ROOT RESET?
```

## 26.2 Dependency governance

Before adding a material dependency, consider:

- capability gained;
- maintenance/support status;
- transitive graph;
- install/build scripts;
- maintainer ownership/bus factor where material;
- release/signing/provenance practices;
- known vulnerabilities;
- license/legal constraints as adjacent governance;
- update cadence;
- replacement/exit cost;
- privilege/execution position.

A tiny build plugin with CI credentials can be higher security risk than a large runtime library with no privilege.

## 26.3 Version and resolution controls

Use lockfiles/pins/checksums/immutable references appropriate to the ecosystem and update model.

Pinning improves reproducibility but creates patch-lag risk if no update process exists.

## 26.4 Build isolation

For C2+ builds, consider:

- ephemeral workers;
- minimal credentials;
- network restrictions/hermeticity where useful;
- controlled dependency sources;
- isolated secrets;
- untrusted pull-request restrictions;
- cache integrity;
- deterministic/reproducible evidence where required.

## 26.5 Provenance and SLSA

SLSA v1.2 is current at this cutoff [SLSA01].

Use SLSA as a structured supply-chain assurance specification, not as a direct C0–C4 mapping.

Determine required provenance from:

- artifact consequence;
- attacker incentive;
- supplier/build trust;
- consumer verification capability;
- ecosystem constraints;
- audit/regulatory requirements.

## 26.6 SBOM

SBOMs can support:

- component inventory;
- vulnerability impact analysis;
- customer disclosure;
- incident response;
- license/governance processes.

They do not by themselves prove:

- completeness;
- absence of malicious code;
- provenance;
- exploitability;
- secure build;
- authorized release.

Track SBOM freshness/correction and product identity.

## 26.7 Signing and verification

Separate:

```text
CRYPTOGRAPHIC VALIDITY
SIGNER IDENTITY
SIGNER AUTHORIZATION
ARTIFACT IDENTITY
PROVENANCE
POLICY DECISION
```

Do not collapse them into “signed = trusted.”

## 26.8 CI workflow security

CI jobs can execute attacker-controlled code while possessing powerful credentials.

Controls SHOULD address:

- untrusted fork/PR execution;
- secrets availability;
- workflow permissions;
- third-party action/plugin pinning;
- artifact upload/download integrity;
- cache poisoning;
- OIDC/workload federation policy;
- protected environment/release approvals;
- branch/repository policy;
- runner isolation.

## 26.9 Supplier due diligence

NIST SP 1326 (final July 2026) adds current supplier/product due-diligence guidance, including provenance, resilience, foundational practices, supply-chain tiers and foreign-ownership/control considerations where relevant [NIST14].

Supplier review SHOULD be proportionate to:

- authority;
- data access;
- execution privilege;
- dependency concentration;
- substitutability;
- incident history;
- support horizon;
- recovery/exit capability.

---

# 27. Configuration, defaults, admin, support and break-glass security

These paths are routinely under-modeled because they are considered “operational” rather than product functionality.

## 27.1 Configuration as security state

Security-relevant configuration includes:

- identity providers;
- trusted issuers/audiences;
- authorization policy;
- network exposure;
- CORS/CSP;
- TLS/certificates;
- key/secret references;
- feature flags enabling dangerous capability;
- tenant isolation mode;
- logging/alerting;
- backup/retention;
- agent tool permissions;
- rate/abuse controls.

Configuration MUST have ownership and change traceability proportional to consequence.

## 27.2 Secure defaults

A secure default should:

- minimize unnecessary exposure;
- deny unprovisioned privilege;
- avoid default credentials;
- avoid public access unless the product requires it;
- use current secure protocols;
- require explicit enablement for dangerous legacy behavior;
- preserve recovery/operability.

Secure default does **not** mean “deny everything even when the product can no longer safely recover.”

## 27.3 Admin interfaces

Admin surfaces SHOULD have:

- stronger authentication;
- explicit privileged authorization;
- narrow exposure;
- short/controlled sessions;
- audited changes;
- step-up for highly consequential actions;
- CSRF/browser protections when web-based;
- separate tenant/resource context;
- no hidden default accounts;
- emergency/recovery behavior.

## 27.4 Support tools

Support tooling often bypasses ordinary flows.

Treat these as first-class privileged capabilities:

- user lookup;
- data export;
- impersonation;
- password/MFA reset;
- subscription/entitlement change;
- refund/credit;
- manual data correction;
- tenant migration;
- account unlock.

Log who did what, for whom, why, and under which approval/policy.

## 27.5 Break-glass

Break-glass exists for cases where ordinary controls cannot safely restore service or security.

It MUST specify:

```yaml
trigger:
eligible_roles:
credential_or_access_mechanism:
strong_authentication:
required_approval_if_possible:
maximum_scope:
maximum_duration:
audit:
notification:
post_use_review:
credential_rotation_or_reseal:
owner:
```

Break-glass SHOULD be exercised periodically at a frequency justified by consequence and change rate.

## 27.6 Debug and diagnostics

Production diagnostics can expose:

- memory/state;
- stack traces;
- environment variables;
- secrets;
- user data;
- admin operations.

Debug endpoints, profilers, remote shells and support bundles MUST be protected according to their actual authority.

---

# 28. Memory safety, unsafe code and low-level boundaries

CISA/NSA and partner guidance encourages memory-safe language roadmaps where feasible for security-sensitive software [CISA05].

## 28.1 Rule

Memory-safe languages and safe subsets materially reduce broad memory-corruption classes. They do not remove:

- authorization defects;
- injection;
- business-logic flaws;
- race conditions at higher layers;
- cryptographic misuse;
- supply-chain compromise;
- unsafe FFI/native dependencies;
- denial-of-service;
- privacy failures.

## 28.2 When to prefer memory-safe implementation

Preference strengthens when:

- parsing untrusted data;
- network exposed;
- privileged;
- sandbox/runtime boundary;
- cryptographic/key handling;
- long-lived infrastructure;
- high attacker incentive;
- history of memory-safety defects;
- greenfield/rewrite cost is low enough.

## 28.3 Existing C/C++ and unsafe code

Do not mandate blanket rewrite without lifecycle evidence.

Risk-reduction options include:

- isolate unsafe components;
- reduce privilege;
- sandbox;
- harden compiler/runtime;
- sanitizers in testing;
- fuzzing;
- static analysis;
- safer APIs/types;
- memory-safe replacement at high-risk seams;
- strict review of unsafe blocks/FFI;
- exploit mitigations.

## 28.4 Unsafe escape hatch record

For C2+ material unsafe boundaries:

```yaml
unsafe_boundary:
reason_required:
inputs:
privilege:
memory_or_type_assumptions:
containment:
verification:
fuzzing_sanitizers:
owner:
replacement_or_review_trigger:
```

---

# 29. Security logging, detection and threat-informed monitoring

Security observability exists to detect, investigate and contain harmful behavior. More logs are not automatically better.

## 29.1 Security event model

For each material threat path, ask which evidence could establish:

```text
ATTEMPT
SUCCESS / FAILURE
TARGET
PRINCIPAL
AUTHORITY USED
SOURCE / EXECUTION CONTEXT
CHANGE / SIDE EFFECT
CORRELATION
TIME
POLICY DECISION
```

## 29.2 Events commonly worth capturing

For C2+ systems, consider:

- authentication success/failure anomalies;
- authenticator/recovery changes;
- authorization denial on high-value resources;
- privilege elevation;
- admin/support actions;
- policy/IAM changes;
- key/secret/certificate lifecycle events;
- data export/bulk access;
- release/deployment/security-config changes;
- break-glass use;
- destructive operations;
- vulnerability/patch state changes;
- agent high-impact tool execution;
- security-control disablement.

Do not record sensitive payloads by default merely because the event is important.

## 29.3 Log integrity and access

Security logs SHOULD have:

- defined source identity;
- reliable timestamps/time context;
- restricted write/delete access;
- appropriate retention;
- integrity/tamper controls proportional to dispute/forensic needs;
- searchable correlation;
- controlled analyst access;
- privacy/data minimization.

“Immutable logs” are contextual. Append-only/tamper-evident external evidence may be justified for high-value actions, but exact architecture depends on threat and operations.

## 29.4 Detection engineering

A detection SHOULD specify:

```yaml
detection_id:
threat_or_behavior:
data_sources:
logic:
expected_signal:
known_false_positive_causes:
severity:
action:
owner:
test_method:
coverage_limitations:
```

## 29.5 ATT&CK use

MITRE ATT&CK v19.2 is current at the evidence cutoff [MITRE01].

Use ATT&CK to:

- structure adversary behavior coverage;
- identify telemetry opportunities;
- exercise detections;
- communicate techniques.

Do not use number of ATT&CK techniques covered as a security KPI without threat relevance.

## 29.6 Detection testing

Test detections with:

- controlled synthetic events;
- attack simulations;
- purple-team exercises;
- known incident replays where safe;
- unit tests for detection logic;
- telemetry-loss tests.

A detection that has never seen a representative event is a hypothesis.

## 29.7 Security telemetry failure

Threat-model:

- dropped logs;
- clock drift;
- schema change;
- ingestion backlog;
- disabled source;
- attacker tampering;
- provider outage;
- alert routing failure;
- analyst overload.

Critical detections SHOULD have a way to detect their own evidence-path degradation.

---

# 30. Vulnerability management and coordinated disclosure

Vulnerability management is a lifecycle from discovery to validated remediation — not a backlog of CVEs.

## 30.1 Vulnerability lifecycle

```text
DISCOVER / RECEIVE
→ VALIDATE
→ IDENTIFY AFFECTED ASSET + VERSION
→ EXPOSURE / EXPLOITABILITY / CONSEQUENCE
→ PRIORITIZE
→ CONTAIN / MITIGATE
→ REMEDIATE
→ VERIFY
→ DEPLOY
→ MONITOR
→ DISCLOSE / COORDINATE AS REQUIRED
→ LEARN / PREVENT RECURRENCE
```

ISO/IEC 29147:2018 remains the vulnerability-disclosure baseline; ISO/IEC 30111:2019 remains the vulnerability-handling baseline at this cutoff [ISO05][ISO06].

## 30.2 Intake sources

Include where relevant:

- internal testing;
- customers/researchers;
- bug bounty/VDP;
- dependency advisories;
- OS/vendor advisories;
- KEV;
- threat intelligence;
- incidents;
- scanners;
- supplier notifications;
- code review.

## 30.3 Risk triage inputs

```text
VALIDITY
AFFECTED VERSION / ASSET
REACHABILITY / EXPOSURE
ATTACKER PREREQUISITES
KNOWN EXPLOITATION (KEV / credible intel)
EPSS PROBABILITY SIGNAL
CVSS CHARACTERISTICS
ASSET CRITICALITY
PRIVILEGE / DATA / TENANT IMPACT
BLAST RADIUS
DETECTION / CONTAINMENT
FIX / MITIGATION AVAILABILITY
PATCH CHANGE RISK
```

CVSS v4.0 and EPSS have different jobs [FIRST01][FIRST02].

## 30.4 Prioritization framework

Use qualitative decision bands instead of a fake universal score:

### P0 — Emergency

Examples:

- credible active exploitation of an exposed high-value path;
- compromised credential/key/root of trust;
- unauthenticated remote path to severe harm;
- active cross-tenant or mass data exposure.

Actions:

- incident command;
- contain/revoke first if needed;
- patch/mitigate immediately under emergency change control;
- verify containment;
- communicate under applicable requirements.

### P1 — Urgent

- high plausible exploitation + material consequence;
- known exploit with relevant exposure;
- security control bypass affecting critical assets.

### P2 — Planned material remediation

- valid exploitable weakness with bounded exposure or meaningful compensating controls;
- patch requires coordinated safe rollout.

### P3 — Hygiene / debt

- low current exploitability/consequence;
- defense-in-depth weakness;
- obsolete unsupported component not yet exposed but requiring lifecycle action.

The organization SHOULD define response targets from its risk and operations, not copy a universal CVSS SLA.

## 30.5 Exceptions

A vulnerability exception MUST include:

```yaml
finding:
affected_assets:
risk_summary:
why_not_fixed_now:
compensating_controls:
exposure:
owner:
approver:
expiry_or_review_date:
trigger_for_immediate_revisit:
verification:
```

## 30.6 Coordinated vulnerability disclosure

A product SHOULD provide a discoverable security contact/process appropriate to its user population.

A mature VDP handles:

- intake;
- acknowledgment;
- researcher safe-harbor/policy where organization chooses;
- reproduction;
- severity/risk assessment;
- remediation ownership;
- status communication;
- disclosure coordination;
- CVE/CNA path where applicable;
- credit;
- lessons/prevention.

## 30.7 EU Cyber Resilience Act watch/applicability

Regulation (EU) 2024/2847 creates product cybersecurity obligations within its scope. At this evidence cutoff, Article 14 reporting obligations for actively exploited vulnerabilities and severe incidents have applied since **11 September 2026**, while the main regulation applies from **11 December 2027** [EU01].

Applicability, product classification, conformity and reporting require qualified legal/regulatory interpretation. This playbook treats CRA as a scoped external overlay, not a global technical standard.

---

# 31. Security verification and adversarial assurance

Security assurance asks:

> **Which security claims matter, what evidence can falsify them, which attacker behaviors must be represented, how independent must the evidence be, and what uncertainty remains?**

Detailed V&V method selection belongs to Playbook 05.

## 31.1 Assurance portfolio

| Method | Strong use | Blind spot |
|---|---|---|
| architecture/threat review | boundary/authority/design flaws | implementation defects |
| code review | semantic defects in changed code | unseen runtime/config/dependency behavior |
| SAST | known code patterns/data flow | false positives/negatives; business logic |
| SCA/dependency scanning | known component vulnerabilities | malicious packages/unknown vulns/runtime reachability |
| secret scanning | committed secret patterns | secrets outside scanned sources; validity |
| DAST | running application behavior | coverage, authenticated/business workflows |
| API authz negative tests | object/function/tenant isolation | unrelated vulnerability classes |
| fuzzing | parser/state robustness | oracle/business policy gaps |
| property-based tests | invariants over broad generated inputs | model/oracle quality |
| mutation/security unit tests | test sensitivity | real environment attack paths |
| penetration test | expert adversarial integration assessment | sampled time/scope; no lifecycle proof |
| red team | realistic objective/defense exercise | cost, scope, not universal |
| formal methods | scoped properties/state protocols | wrong/incomplete spec; implementation gap |
| production detection | real-world attack/control behavior | reacts after exposure; telemetry blind spots |

## 31.2 Security assurance plan

For C2+ material work:

```yaml
security_claims:
  - id:
    claim:
    consequence_if_false:
    evidence_methods: []
    independence_required:
    environment:
    acceptance_rule:
    residual_uncertainty:

threat_scenarios: []
negative_tests: []
fuzz_targets: []
manual_review_scope: []
pentest_or_redteam_scope: []
production_monitoring: []
release_security_gates: []
```

## 31.3 Authorization tests

Authorization tests SHOULD cover:

- no credential;
- valid wrong user;
- valid wrong tenant;
- lower privilege;
- stale/revoked privilege;
- foreign resource ID;
- alternate HTTP/API method;
- bulk/list/search/export;
- background/asynchronous path;
- admin/support path;
- race/replay where policy can change;
- policy cache invalidation;
- hidden/direct endpoint.

## 31.4 Fuzzing

Use fuzzing particularly for:

- parsers;
- protocol decoders;
- native/memory-unsafe boundaries;
- file/media/archive processing;
- state machines;
- serialization/deserialization;
- security protocol edge cases.

Define crash/hang/resource/invariant oracles. A fuzzer producing inputs without meaningful oracles can miss semantic security failure.

## 31.5 Penetration testing decision

Use a penetration test when:

- integrated attack paths matter;
- an independent adversarial perspective can discover unknown composition flaws;
- a customer/regulator requires it;
- a major material release changes attack surface;
- pre-release evidence still leaves important threat uncertainty.

Do not schedule a yearly pentest solely because “security best practice says annual” unless the cadence fits risk/compliance. Event-driven testing may matter more.

## 31.6 Red-team decision

Use red teaming when the question is closer to:

> Can a realistic adversary achieve an important objective against the combined technology, people, detection and response system?

A red team is not needed for every ordinary SaaS feature.

## 31.7 Formal methods

Consider formal methods for:

- authorization policy/state machines;
- distributed locks/fencing;
- cryptographic protocols;
- high-value transaction invariants;
- signing/key-rotation workflows;
- security-sensitive concurrency;
- safety/security state interactions.

AWS's published TLA+ experience is useful mature operational evidence that formal specification can find design errors in distributed systems, but it does not make formal methods universally necessary [RESEARCH02].

## 31.8 Independent assurance

Independence requirements increase with consequence.

For C3/C4:

- do not let the author be the only reviewer of critical security claims;
- avoid the same AI/model being sole producer and sole validator;
- use independent evidence or diverse methods;
- retain decision/audit evidence.

---

# 32. AI, LLM and agentic security

Detailed AI/LLM and agent engineering belongs to Playbooks 18 and 19. Security owns the adversarial, identity, authority, trust and containment constraints.

OWASP's 2026 LLM and Agentic guidance and Agent Control Standard provide current applied threat/control taxonomies; they are fast-moving community standards, not proofs of completeness [OWASP07][OWASP08][OWASP09].

## 32.1 AI/agent threat boundary

A production AI/agent security model SHOULD include:

```text
SYSTEM INSTRUCTIONS / POLICY
MODEL / ROUTER
USER INPUT
RETRIEVED CONTENT
MEMORY
TOOLS / CONNECTORS
SUB-AGENTS
FILES / WEB / MESSAGES
CODE EXECUTION
CREDENTIALS
OUTPUT RENDERING
ACTIONS / SIDE EFFECTS
TELEMETRY
HUMAN APPROVAL
```

## 32.2 Prompt injection doctrine

Prompt injection is possible because data and instructions can share the same model context and the model does not provide a deterministic security boundary.

Therefore:

- treat external content as untrusted influence;
- label/provenance context where possible;
- minimize sensitive context;
- constrain tools and authority externally;
- separate untrusted-content processing from high-impact action where useful;
- validate structured outputs;
- require policy checks at action time;
- do not rely on a “do not obey malicious instructions” prompt as the primary control.

## 32.3 Tool security

Every tool SHOULD declare:

```yaml
tool:
owner:
input_schema:
output_schema:
required_identity:
required_permissions:
resource_scope:
side_effects:
reversibility:
idempotency_or_effect_identity:
rate_cost_limits:
sensitive_data_access:
confirmation_or_approval_policy:
postcondition_verification:
audit_event:
revoke_kill_path:
```

Tool schemas improve correctness but do not prove authorization or safe semantics.

## 32.4 Agent identity

An agent SHOULD act under a distinct attributable identity or delegated execution context when practical.

Avoid giving an agent an unrestricted copy of a human's full credential set.

Prefer:

- scoped delegated tokens;
- per-tool/action policies;
- time limits;
- tenant/resource scope;
- budget/transaction limits;
- separable audit identity.

## 32.5 Approval design

Human approval can reduce risk only if the human can make a meaningful decision.

Approval UX SHOULD show:

- exact action;
- target/resource;
- material parameters;
- money/data impact;
- external recipient;
- reversibility;
- agent rationale/provenance where useful;
- conflicts/warnings;
- ability to inspect/change/deny.

Avoid generic “Allow agent to continue?” for high-impact side effects.

## 32.6 Memory security

Persistent agent memory can become a durable injection or privilege-confusion channel.

Memory writes SHOULD record:

```yaml
memory_item:
source:
writer_identity:
provenance:
tenant_or_owner:
sensitivity:
confidence_or_status:
expiry_or_review:
allowed_consumers:
correction_deletion:
security_flags:
```

Do not let arbitrary retrieved content silently become durable trusted policy.

## 32.7 RAG/retrieval security

Threat-model:

- malicious document injection;
- permission-filter bypass;
- stale ACLs;
- cross-tenant vectors/indexes;
- poisoned metadata;
- hidden instructions in files/web pages;
- data exfiltration through retrieval queries;
- leakage of private corpus through generated output;
- index rebuild/embedding model change.

Authorization MUST be enforced on the retrieved source set, not merely on generated output.

## 32.8 Computer/browser/code-use agents

These agents can cross many conventional security boundaries.

Controls MAY include:

- isolated browser/profile;
- sandbox/container/VM;
- scoped filesystem;
- network allowlist/egress policy;
- no ambient secrets;
- disposable credentials;
- command policy;
- transaction limits;
- explicit approval for destructive/high-value actions;
- screenshots/audit/trace;
- process/time/step budgets;
- kill/revoke outside model control.

## 32.9 Multi-agent systems

More agents create more identities, messages, delegation and trust boundaries.

Threat-model:

- confused deputy;
- malicious/compromised peer;
- instruction laundering;
- delegation loops;
- authority amplification;
- memory contamination;
- forged agent identity/metadata;
- duplicate side effects;
- supervisor over-trust.

A supervisor model is not a security monitor unless deterministic policy and independent evidence support it.

## 32.10 Agent red-team suite

For C2+ tool-using agents test:

- direct prompt injection;
- indirect injection in retrieved web/docs/email/files;
- malicious tool output;
- tool argument manipulation;
- unauthorized resource/tenant target;
- credential discovery/exfiltration;
- memory poisoning;
- instruction hierarchy conflict;
- approval bypass;
- retry/duplicate side effects;
- compromised sub-agent;
- data leakage through logs/context;
- budget/rate-limit bypass;
- kill/revoke behavior.

---

# 33. Security incident containment, recovery and trust reset

NIST SP 800-61 Rev. 3 (2025) integrates incident response into cybersecurity risk management and emphasizes preparation, response, recovery and improvement [NIST12].

## 33.1 Incident security objectives

```text
PROTECT PEOPLE / CRITICAL ASSETS
→ STOP OR CONTAIN HARM
→ PRESERVE DECISION-RELEVANT EVIDENCE
→ REVOKE COMPROMISED AUTHORITY
→ UNDERSTAND SCOPE
→ RESTORE TRUSTED OPERATION
→ VERIFY RECOVERY
→ COMMUNICATE AS REQUIRED
→ REMOVE PERSISTENCE / ROOT CAUSES
→ LEARN / RE-MODEL
```

## 33.2 Containment is threat-specific

Options include:

- revoke tokens/sessions;
- disable account/workload;
- rotate key/secret;
- quarantine host/service/tenant;
- block route/indicator;
- disable feature/tool;
- freeze withdrawals/transactions;
- reduce permissions;
- stop release pipeline;
- isolate build environment;
- disable integration;
- move to degraded read-only mode;
- shut down only when consequence and recovery justify it.

“Turn everything off” is not always safest.

## 33.3 Trust reset

A trust reset is required when ordinary credentials/configuration can no longer establish confidence.

Examples:

- root/admin compromise;
- signing-key compromise;
- identity-provider compromise;
- CI/build compromise;
- KMS/key-policy compromise;
- malware persistence;
- backup/admin compromise.

Trust reset asks:

```text
What roots of trust remain credible?
Which credentials/artifacts/configurations are suspect?
Which known-clean bootstrap path exists?
How are new keys/identities issued?
How are old identities invalidated?
How is recovered state verified?
How do we prevent the compromised system from authorizing its own recovery?
```

## 33.4 Forensic/evidence discipline

Evidence collection should be proportionate and lawful.

Consider:

- volatile state;
- logs/traces;
- identity/IAM history;
- cloud audit events;
- deployment/build provenance;
- snapshots/images;
- network evidence;
- affected artifact hashes;
- timeline;
- customer/tenant scope.

Do not preserve evidence in a way that unnecessarily spreads sensitive data or malware.

## 33.5 Recovery acceptance

Recovery is not complete because the service responds.

Verify:

- compromised authority revoked;
- known persistence removed;
- patched/mitigated vulnerable path;
- restored data integrity;
- authorization/tenant isolation;
- security telemetry functioning;
- trusted artifact/config identity;
- backup/restore integrity where used;
- elevated monitoring for recurrence;
- required communication complete.

## 33.6 Post-incident learning

Convert incident findings into:

- new/changed security invariant;
- regression/adversarial test;
- architecture change;
- detection improvement;
- credential/key policy change;
- supplier/process change;
- threat-model update;
- runbook improvement;
- deprecation/retirement;
- playbook update if the standard was deficient.

Avoid action items that only say “be more careful.”

---

# 34. Security maintenance, deprecation and retirement

Security degrades when software, identity, cryptography and dependencies outlive their support model.

## 34.1 Security maintenance inventory

Track:

- runtime/language support;
- OS/base image;
- libraries/dependencies;
- cryptographic algorithms/protocols;
- certificates;
- keys/secrets;
- IdP/federation integrations;
- domains/DNS;
- third-party suppliers;
- security policies;
- unsupported API versions;
- agent/model/tool providers;
- security monitoring dependencies.

## 34.2 End-of-life decision

An unsupported component MAY remain temporarily only with:

- explicit owner;
- known support gap;
- exposure analysis;
- compensating controls;
- migration plan;
- review/expiry trigger;
- risk acceptance proportional to consequence.

## 34.3 Retirement checklist

Retirement is not “delete the server.”

Remove/revoke as applicable:

- public routes/endpoints;
- DNS/domains/certificates;
- service accounts;
- API keys/tokens;
- cloud IAM roles;
- OAuth clients;
- signing keys;
- secrets;
- database users;
- firewall/network grants;
- CI jobs/deploy hooks;
- webhooks/integrations;
- agent tools/permissions;
- backups/archives according to lifecycle;
- monitoring/alerts no longer needed;
- vendor accounts/contracts where relevant.

Verify that obsolete authority cannot still reach live systems.

---

# 35. Security decision frameworks

Security decisions need repeatable logic without pretending that one named control is universally correct.

## 35.1 Assurance-depth decision

```text
CONSEQUENCE OF FALSE SECURITY CLAIM
→ exposure / attacker incentive
→ authority / sensitive assets
→ irreversibility / blast radius
→ uncertainty / novelty
→ detectability / containment / recovery
→ selected C0–C4 assurance posture
→ independence + adversarial evidence required
```

Use C0/C1 for disposable/ordinary risk, C2 for material customer/business/data risk, C3 for major security/financial/privacy/societal risk, and C4 when domain-critical safety/mission assurance governs.

## 35.2 Threat-model method selection

| Need | Useful starting method |
|---|---|
| ordinary product/system change | system + authority flows, OWASP four questions, abuse cases |
| structured technical prompting | STRIDE as a prompt set |
| high-value attacker objective | attack tree / attack-path analysis |
| reusable software patterns | CAPEC + CWE |
| adversary/detection behavior | ATT&CK |
| high-consequence security/safety | threat + hazard co-analysis, attack trees, stronger assurance |
| AI/agent | tool/authority/context/memory model + indirect-injection scenarios |
| supply chain | source → build → artifact → signer → promotion → consumer trust chain |

The method is successful only if it exposes the material threats and drives controls/tests.

## 35.3 Authentication-strength decision

Ask:

1. Which authority can the account/session exercise?
2. Is phishing a realistic path to harm?
3. Is the user/device population compatible with phishing-resistant authenticators?
4. What fallback/recovery exists?
5. What friction/accessibility cost is acceptable?
6. Is federation concentrating or reducing risk?

Default progression:

```text
LOW CONSEQUENCE
→ modern password/passkey/social auth + abuse controls

MATERIAL
→ MFA/stronger assurance where risk warrants + recovery model

PRIVILEGED / HIGH VALUE
→ phishing-resistant authentication preferred + step-up/context controls

C3+
→ phishing-resistant privileged access, strong recovery, bounded sessions,
  independent assurance and domain overlays as required
```

## 35.4 Authorization-model decision

```text
Stable job functions dominate?          → RBAC may fit
Resource/context attributes dominate?   → ABAC/policy model may fit
Ownership/membership graph dominates?   → relationship-based model may fit
Delegated possession is the domain?     → capability/token model may fit
Otherwise                               → use the simplest explicit policy
```

Combine models only when the additional expressiveness is worth the review/operational complexity.

## 35.5 Central vs distributed authorization

Prefer common/centralized **policy semantics** when drift across many services is the primary risk. Prefer enforcement close to the authoritative resource when the service owns the state/context and a central runtime dependency would create unacceptable failure.

A strong pattern is often:

```text
CENTRAL POLICY DEFINITION / GOVERNANCE
+ DISTRIBUTED TRUSTED ENFORCEMENT
+ COMMON TESTS / TELEMETRY / REVOCATION SEMANTICS
```

## 35.6 Static secret vs workload identity

Prefer workload identity/federation when a trustworthy issuer can strongly bind workload identity, issue short-lived scoped credentials and enforce audience/subject conditions.

Use managed static secrets when target/platform/offline constraints require them and the simpler architecture is safer overall.

Both require owner, scope, storage, revocation, audit and compromise response.

## 35.7 Encryption decision

```text
Which attacker should encryption stop?
  ↓
Can that attacker access the key or endpoint plaintext?
  YES → encryption alone does not solve the threat
  NO  → choose confidentiality/integrity/authenticity property needed
        and design the key boundary accordingly
```

## 35.8 HSM/KMS/key-isolation decision

Escalate key isolation when keys grant broad financial/release/root authority, export creates persistent compromise, independent custody is required, or application-host compromise must not reveal raw material.

Balance availability, latency, provider dependency, quotas, recovery and migration. FIPS 140-3 may be externally required in some scopes; validation of a module is not proof that the application uses it securely.

## 35.9 Network-segmentation / zero-trust decision

Use segmentation when it blocks a named lateral-movement/exposure path or bounds blast radius. Do not use it to replace service identity/resource authorization. NIST zero trust removes implicit trust from network location; it does not mandate one mesh/topology [NIST10][NIST11].

## 35.10 WAF / edge-control decision

Use edge controls when they can cheaply block a known attack pattern, constrain abusive volume, normalize protocol behavior, or provide temporary virtual patching.

Do not use a WAF as acceptance of insecure authorization, injection or architecture.

## 35.11 CSP / browser-execution-policy decision

Use CSP/Trusted Types or equivalent when browser injection consequence is material and policies can be maintained without broad unsafe exceptions. Treat them as defense in depth, not repair for unsafe DOM/script construction.

## 35.12 Vulnerability priority decision

```text
KNOWN / CREDIBLE EXPLOITATION?
  YES → elevate strongly
  NO ↓
AFFECTED + REACHABLE IN THIS DEPLOYMENT?
  NO → track lifecycle debt, lower immediate exploitation risk
  YES ↓
ATTACKER PREREQUISITES + EPSS / exploit maturity
  ↓
ASSET AUTHORITY + CONSEQUENCE + BLAST RADIUS
  ↓
COMPENSATING CONTROLS + DETECTION + RECOVERY
  ↓
FIX / MITIGATION SAFETY
  ↓
P0 / P1 / P2 / P3 + owner
```

Never sort the remediation backlog solely by CVSS [FIRST01][FIRST02][CISA03].

## 35.13 Security-test portfolio decision

| Failure class | Strong evidence candidates |
|---|---|
| architecture/authority | threat + architecture review |
| code/data-flow weakness | review + SAST |
| known dependency vulnerability | SCA + inventory/advisories |
| secrets | secret scanning + runtime/config review |
| parser/native robustness | fuzzing + sanitizers |
| authorization/tenant isolation | negative integration/property tests |
| deployed config/runtime | DAST/config assessment |
| unknown composition flaw | penetration test |
| realistic adversary + detection | red/purple team |
| high-consequence state protocol | model checking/formal reasoning where fit |
| real-world abuse | production telemetry + incident learning |

## 35.14 Penetration test vs red/purple team

**Penetration test:** discover exploitable weaknesses in a scoped system/release.  
**Red team:** determine whether a realistic adversary can achieve an objective across technology, identity, humans, detection and response.  
**Purple team:** collaboratively validate detection/control behavior.

Select the least expensive method that can answer the decision question.

## 35.15 Memory-safe migration decision

Prioritize memory-safe replacement when an unsafe component is exposed, privileged, parser-heavy, long-lived or high-consequence and migration can reduce risk without creating larger change risk. Where immediate rewrite is not justified, isolate, reduce privilege, fuzz, use sanitizers/static analysis and progressively replace high-risk seams [CISA05].

## 35.16 Supply-chain assurance depth

Escalate assurance with dependency/build input authority:

```text
OWNED INVENTORY / LOCK
→ VULNERABILITY MONITORING
→ RELEASE IDENTITY
→ SBOM
→ SIGNATURE
→ PROVENANCE
→ BUILD ISOLATION
→ REPRODUCIBILITY / INDEPENDENT VERIFICATION
→ SUPPLIER DUE DILIGENCE
→ CONSUMER-SIDE POLICY GATE
```

This is not a mandatory maturity ladder or direct C0–C4-to-SLSA mapping [SLSA01].

## 35.17 AI/agent autonomy decision

| Consequence | Default posture |
|---|---|
| low + reversible + observable | bounded autonomous action may fit |
| material but reversible | bounded autonomy + postcondition verification |
| external communication/spend/high-impact | scoped tools + deterministic limits + approval as justified |
| destructive/financial/privilege/secrets | strict policy, strong approval/dual control, transaction limits |
| safety/mission critical | domain controls; model is not final authority |

Choose autonomy from authority, reversibility, detectability and recovery — not benchmark score.

## 35.18 Fail-open / fail-closed / fail-safe decision

Compare harms:

- harm if legitimate work is denied;
- harm if work proceeds without control;
- safety implications;
- duration of control outage;
- whether bounded cached policy is safe;
- whether controlled emergency access exists;
- whether a degraded mode preserves the critical invariant.

“Fail closed” is a default for many authorization decisions, not a universal system rule.

## 35.19 Build vs buy security capability

Prefer managed capability when it is commodity but difficult to implement safely and provider trust/support/exit fit the threat model. Prefer build/internal policy when semantics are core domain logic or provider dependency cannot express required trust/offline/latency constraints.

Evaluate total attack and operational surface; neither vendor nor in-house is inherently safer.

---

# 36. Security anti-patterns and rejected dogma

| ID | Claim / anti-pattern | Verdict | Better rule |
|---|---|---|---|
| AP-01 | “Inside VPN/network = trusted” | Rejected | authenticate/authorize resources; network only reduces reachability [NIST10] |
| AP-02 | “Authenticated = authorized” | Rejected | evaluate principal + action + resource + context |
| AP-03 | “Use RBAC everywhere” | Contextual | choose policy model from real semantics |
| AP-04 | “MFA solves account takeover” | Overbroad | classify factor resistance, sessions and recovery |
| AP-05 | “Change passwords every 90 days” | Rejected | follow current compromise/blocklist/length guidance [NIST09] |
| AP-06 | “Complexity rules make passwords strong” | Rejected | length, blocklist, secure hashing, stronger authenticators [NIST09] |
| AP-07 | “JWT = secure stateless session” | Rejected | validate issuer/audience/key/time + lifecycle/revocation |
| AP-08 | “OAuth solves application authorization” | Rejected | secure delegation protocol + separate resource policy [IETF01] |
| AP-09 | “TLS = trusted peer/application” | Rejected | channel/peer validation + app authorization |
| AP-10 | “Encrypted DB = secure data” | Rejected | map key/attacker boundary + access control |
| AP-11 | “Sanitize all input” | Underspecified | validate grammar/semantics + safe interpreter APIs |
| AP-12 | “Parameterized SQL solves all injection” | Incomplete | parameterize values, allowlist structure, authorize, bound cost |
| AP-13 | “CORS protects API” | Rejected | CORS is browser sharing policy, not authz |
| AP-14 | “CSP fixes XSS” | Rejected | safe construction first; CSP defense in depth |
| AP-15 | “WAF fixes app security” | Rejected | root design + scoped edge defense |
| AP-16 | “Fail closed always” | Rejected | compare security/safety/availability harms |
| AP-17 | “Deny-by-default solves authz” | Incomplete | retain resource policy, revocation and bypass analysis |
| AP-18 | “More controls = defense in depth” | Rejected | prefer independent attack-path breaks |
| AP-19 | “Green SAST/DAST = secure” | Rejected | tool evidence only for detectable classes |
| AP-20 | “Annual pentest = security program” | Rejected | lifecycle + threat-driven assurance |
| AP-21 | “Highest CVSS always first” | Rejected | exploitation + exposure + consequence + controls [FIRST01][FIRST02] |
| AP-22 | “Patch everything immediately” | Overbroad | reduce risk urgently while preserving safe change |
| AP-23 | “SBOM = supply-chain security” | Rejected | inventory + provenance + build/supplier/consumer verification |
| AP-24 | “Signed = trusted” | Rejected | validity + identity + authorization + provenance + policy |
| AP-25 | “SLSA level = app criticality” | Rejected | select supply-chain evidence from threat model [SLSA01] |
| AP-26 | “Zero trust = mesh/microsegmentation” | Rejected | explicit identity/policy; topology contextual [NIST10][NIST11] |
| AP-27 | “Container = security boundary” | Contextual | state kernel/runtime/host isolation assumptions |
| AP-28 | “Non-root container = secure” | Rejected | one control among image/capability/host/network/secret controls |
| AP-29 | “Immutable infra prevents compromise” | Overbroad | can reduce drift/persistence in scoped layer only |
| AP-30 | “Memory safe = secure” | Rejected | removes vulnerability classes; ordinary controls remain [CISA05] |
| AP-31 | “Rewrite all C/C++ now” | Rejected | prioritize high-risk seams by lifecycle economics |
| AP-32 | “Security shifts left” | Incomplete | move preventable decisions earlier and keep runtime security |
| AP-33 | “ATT&CK coverage count = security” | Rejected | map relevant threats to tested detections [MITRE03] |
| AP-34 | “Compliance = security” | Rejected | scoped evidence, not threat completeness |
| AP-35 | “Common Criteria certified = universally secure” | Rejected | read exact TOE/assurance/config scope [ISO07][ISO08] |
| AP-36 | “Read-only agent = low risk” | Rejected | model sensitive bulk read/exfiltration/inference |
| AP-37 | “Prompt hardening = authorization” | Rejected | deterministic tool/action policy [OWASP08][OWASP09] |
| AP-38 | “Human approval = safe agent” | Rejected | meaningful informed approval + hard limits |
| AP-39 | “AI can be sole reviewer of its security fix” | Weak assurance | independent deterministic/human/diverse evidence |
| AP-40 | “Security through obscurity never has value” | Nuanced | secrecy may reduce opportunism but cannot be primary material control [RESEARCH01] |

---

# 37. Risk-tier control matrix

This matrix routes assurance; it is not a certification checklist.

| Area | C0 | C1 | C2 | C3 | C4 |
|---|---|---|---|---|---|
| Environment | disposable/non-prod | basic separation | explicit trust/env separation | strong admin/blast boundaries | domain governed |
| Threat model | informal | lightweight | documented/owned | independent challenge | domain hazard/security method |
| Requirements | basic | key controls | explicit invariants | traceable claims/controls/tests | formal/domain traceability |
| Authentication | local/basic | fit to risk | stronger/MFA where needed | phishing-resistant privileged default | domain governed |
| Authorization | basic | trusted-boundary checks | explicit model + negative tests | independent review/segregation | domain governed |
| Tenant isolation | n/a/basic | negative tests | cross-plane isolation tests | deeper admin/recovery isolation | domain governed |
| Secrets | no prod | managed | scoped/rotatable/audited | short-lived/strong custody | qualified/domain custody |
| Crypto | libraries | current protocols | key lifecycle documented | stronger custody/agility | certified/domain as applicable |
| Dependencies | minimal | lock/monitor | owned inventory + SCA | provenance/supplier scrutiny | domain supply-chain assurance |
| Build/release | basic CI | controlled | immutable artifact + gate | provenance/signing/separation | qualified/reproducible as required |
| Review | basic | peer | independent security-sensitive | specialist/segregated | independent/domain |
| Fuzzing | where obvious | targeted | hostile parser/state targets | systematic high-risk | domain assurance |
| Pentest | optional | event driven | based on exposure/change | independent adversarial | domain required if applicable |
| Detection | minimal | key auth/admin | threat-mapped | exercised/purple-team | domain operations |
| Incident | contact | owner | documented plays | exercised trust reset | domain command/evidence |
| Recovery | disposable | revoke/restore | tested security recovery | independent bootstrap | domain recovery assurance |
| Vulnerability handling | updates | owner/intake | context/KEV/EPSS triage | formal PSIRT/VDP style | domain/regulatory |
| AI/agent | sandbox | low-risk scoped | external policy + adversarial evals | strict authority/approval/red team | domain governed |
| Evidence | minimal | CI records | release/security package | traceable assurance package | certification/audit evidence |

Higher tiers mean stronger confidence, not simply more tools or paperwork.

---

# 38. Core Security Plays

Every Play retains objective, trigger, inputs, method, output, acceptance criteria and risk-appropriate evidence.

## SEC-PLAY-01 — Threat-model a material change

**Objective:** discover credible harmful paths before architecture hardens.  
**Trigger:** C2+ change to authority, trust boundary, sensitive data, exposure, integration, interpreter/upload or agent autonomy.  
**Inputs:** architecture/flows, assets, principals, applicable requirements, prior incidents/findings.

**Method:**
1. scope exact change/version;
2. identify assets/harm and high-value actions;
3. map principals, boundaries, entry points and equivalent-authority paths;
4. generate business misuse + technical attacks;
5. prioritize using consequence/exposure/prerequisites/controls/recovery;
6. attach prevent/detect/contain/recover controls;
7. define verification;
8. record residual risk/owner/change triggers.

**Output:** Security Context + Threat Register + changed invariants.  
**Acceptance:** no unexplained material authority path; each material threat has owner/control/test.  
**Evidence:** retain for C2+; independent challenge for C3+.

## SEC-PLAY-02 — Define security invariants

**Objective:** turn vague security intent into enforceable/testable rules.  
**Method:** prohibited outcome → invariant → authoritative state → enforcement point → failure behavior → test → runtime signal/recovery.  
**Acceptance:** material rules are observable/verifiable and not merely “use MFA/encryption/OWASP.”

## SEC-PLAY-03 — Design authentication and recovery

**Trigger:** login/MFA/passkey/federation/recovery change.  
**Method:** classify authority; model phishing/credential/session/recovery attacks; choose assurance; design binding/session/recovery/revocation; test lost-factor and attacker-recovery scenarios.  
**Acceptance:** fallback/recovery is not uncontrolled weakest path; privileged assurance matches consequence.

## SEC-PLAY-04 — Design authorization and tenant isolation

**Method:** model principal+action+resource+tenant+context; choose policy model; identify trusted data; place enforcement; define cache/revocation; enumerate admin/support/async bypasses; build negative matrix.  
**Acceptance:** client claims cannot create authorization; cross-tenant and alternative execution paths tested.

## SEC-PLAY-05 — Introduce or rotate a secret/key

**Method:** classify authority; generate from trusted source; establish storage/export boundary; scope consumers; plan overlap/activation; rehearse C3 rotation; revoke old material; verify rejection; audit without disclosure.  
**Acceptance:** old authority removed as required; recovery path not weaker than custody.

## SEC-PLAY-06 — Security-review a material release

**Inputs:** immutable artifact, threat delta, requirements, findings, verification, dependency/vulnerability state.  
**Method:** confirm exact release; review security-sensitive diff/config; confirm controls/tests; triage unresolved findings; verify IAM/secrets/policy; define runtime detection/containment; record residual-risk owner; post-release verify.  
**Acceptance:** no BLOCKER; MAJOR fixed or properly accepted; evidence matches released artifact/config.

## SEC-PLAY-07 — Triage/remediate a vulnerability

**Method:** validate → identify deployed affected assets → check KEV/active exploitation → use EPSS/CVSS appropriately → assess consequence/controls/change risk → assign P0–P3 → contain if urgent → patch/mitigate → verify → prevent recurrence.  
**Acceptance:** actual risk reduced and verified; exceptions time-bounded.

## SEC-PLAY-08 — Respond to compromised credentials

**Method:** classify authority → revoke/rotate → revoke derivatives → inspect usage → find leak/copies → rotate dependencies if needed → verify old rejection → repair root cause.  
**Acceptance:** compromised authority cannot continue; trust re-established through clean path.

## SEC-PLAY-09 — Verify multi-tenant isolation

**Method:** enumerate stores/caches/queues/jobs/search/vector/admin/backup paths; test foreign resource IDs/list/search/export; test wrong async context; test admin bypass; test noisy-neighbor controls where material.  
**Acceptance:** no unauthorized cross-tenant behavior in scoped evidence; privileged bypasses controlled/audited.

## SEC-PLAY-10 — Review dependency/supplier

**Method:** classify privilege/execution; evaluate maintenance/transitives/install scripts; verify identity/signing/provenance; assess vulnerabilities and due diligence [NIST14]; define pin/update/incident/exit; name owner.  
**Acceptance:** security cost justified by capability; high-authority suppliers have adequate assurance/exit.

## SEC-PLAY-11 — Review AI agent tool/capability

**Method:** define reads/writes/side effects; agent identity/delegation; scope tenant/resource/time/budget; enforce policy outside model; approval/postconditions; idempotency/replay; injection/tool-output/memory/exfiltration tests; kill/revoke.  
**Acceptance:** natural language cannot expand authority; high-impact action has deterministic constraint and tested revocation.

## SEC-PLAY-12 — Plan pentest/red-team evidence

**Method:** state decision/threat hypotheses; select assessment type; scope exact versions; rules of engagement; evidence/reproduction requirements; risk-triage findings; verify remediation; feed systemic defects into tests/standards.  
**Acceptance:** assessment answers named questions; limitations visible; no “clean report = secure” conclusion.

## SEC-PLAY-13 — Execute break-glass access

**Method:** validate trigger → authorized emergency identity → strong auth → narrow scope/duration → audit/notify → execute → revoke/reseal → mandatory post-use review.  
**Acceptance:** no unintended standing privilege remains; ordinary controls restored.

## SEC-PLAY-14 — Trust reset after IdP/build/signing/control-plane compromise

**Method:** freeze affected trust path; identify independent root; enumerate suspect credentials/artifacts; revoke; rebuild control path from clean source; issue new roots/identities; redeploy if required; independently validate production; hunt persistence; reopen gradually.  
**Acceptance:** compromised path cannot authorize production; new trust does not depend on old compromised authority.

## SEC-PLAY-15 — Secure retirement

**Method:** inventory routes/identities/keys/data/integrations/DNS/jobs; stop new use; migrate needed state; revoke; remove exposure/hooks; archive/delete per lifecycle; verify obsolete authority cannot reach live systems.  
**Acceptance:** no unexplained residual credential, route or attack surface.

---

# 39. Compact security runbooks

## RUN-SEC-01 — Leaked API key/token

```text
CLASSIFY authority → REVOKE → ROTATE cleanly → invalidate derivatives
→ SEARCH use → FIND leak source/copies → FIX source → VERIFY old rejection
→ escalate to incident if misuse/high authority.
```

## RUN-SEC-02 — Actively exploited dependency

```text
CONFIRM deployed affected versions → determine exposure → CONTAIN
→ PATCH/UPGRADE/REPLACE → VERIFY exploit path closed → HUNT prior abuse
→ update inventory/regressions → communicate if required.
```

## RUN-SEC-03 — Suspected account takeover

```text
BOUND high-risk actions → revoke sessions/tokens → secure recovery/rebind
→ review recovery/MFA/API keys/privilege → review high-value actions/exports
→ restore legitimate access → investigate cause.
```

## RUN-SEC-04 — Cross-tenant exposure

```text
STOP path → identify tenants/data/time → preserve evidence → fix authz/context
→ run cross-tenant regression suite → check caches/derived stores/exports/logs
→ route incident/privacy/legal duties → re-model equivalent paths.
```

## RUN-SEC-05 — Compromised signing key

```text
STOP signing/releases → revoke/mark key compromised → identify signed-window artifacts
→ establish clean replacement custody → update verifier policy → rebuild/re-sign/revoke
as ecosystem requires → hunt unauthorized releases → complete trust reset.
```

## RUN-SEC-06 — Publicly exposed storage

```text
REMOVE unintended public access → preserve access evidence → classify data/duration
→ determine access → rotate embedded secrets → fix policy/IaC cause
→ add drift/regression control → route reporting/privacy duties.
```

## RUN-SEC-07 — Unsafe agent actions

```text
REVOKE tool/agent identity outside model → stop bounded in-flight work
→ freeze consequential operations → identify prompts/content/tools/memory
→ reconcile/compensate actions → fix deterministic policy boundary
→ adversarial regression → restore at reduced scope + heightened monitoring.
```

---

# 40. Templates and reusable control artifacts

These templates are `HOUSE` artifacts. They are derived from the evidence and parent playbook system; they are not ISO/NIST forms.

## 40.1 Security Decision Record

```yaml
security_decision_id:
title:
date:
owner:
system_or_change:
criticality:

question:
protected_assets_or_properties: []
threats_or_failure_modes: []
constraints: []

alternatives:
  - option:
    benefits: []
    risks: []
    assumptions: []
    evidence: []
    operational_cost:
    recovery_implications:

selected_option:
rationale:
security_invariants: []
controls: []
verification: []
residual_risk: []
risk_owner:
review_triggers: []
```

## 40.2 Security Requirement Record

```yaml
security_requirement_id:
status: proposed|approved|implemented|verified|retired
source: threat|external_requirement|policy|incident|architecture|other
source_reference:
protected_asset_or_property:
principal_or_population:
required_behavior:
prohibited_behavior:
conditions:
rationale_or_threat:
enforcement_boundary:
implementation_reference:
verification_method:
production_signal:
owner:
exception_process:
```

## 40.3 Security Invariant Register

```yaml
invariants:
  - id:
    statement:
    consequence_if_false:
    authoritative_state:
    enforcement_points: []
    bypass_or_equivalent_authority_paths: []
    tests: []
    runtime_detection: []
    recovery: []
    owner:
```

## 40.4 Threat Model Record

```yaml
threat_model_id:
system_or_change:
version_or_revision:
date:
participants: []
reviewer:
criticality:
scope:
out_of_scope: []

assets: []
principals: []
high_value_actions: []
trust_boundaries: []
entry_points: []
data_flows: []
admin_support_recovery_paths: []
external_dependencies: []

threats:
  - id:
    actor:
    preconditions:
    attack_path:
    asset_or_authority:
    violated_property:
    harm:
    exposure:
    existing_controls: []
    required_controls: []
    verification: []
    containment_recovery: []
    residual_risk:
    owner:

unknowns: []
review_triggers: []
```

## 40.5 Authentication & Recovery Contract

```yaml
principal_population:
account_authority:
authentication_assurance_target:
identity_proofing_if_any:
primary_authenticators: []
phishing_resistance:
secondary_or_step_up: []
enrollment:
binding:
session:
re_authentication:

recovery:
  eligible_recovery_methods: []
  evidence_required:
  support_override:
  existing_session_revocation:
  notification:
  fraud_stop_or_appeal:

revocation:
audit_events: []
accessibility_and_usability_constraints: []
security_tests: []
```

## 40.6 Authorization Policy Contract

```yaml
policy_id:
owner:
resources: []
actions: []
principals: []
tenant_or_organization_model:
trusted_attributes: []
relationship_sources: []
conditions: []
default_policy:
decision_point:
enforcement_points: []
cache_freshness:
revocation:
delegation:
privileged_bypasses: []
audit_events: []
negative_tests: []
```

## 40.7 Privilege Elevation Record

```yaml
request_id:
principal:
base_authority:
requested_authority:
resource_scope:
reason:
change_or_incident_reference:
approval_or_policy:
start:
expiry:
session_binding:
actions_recorded:
revocation:
post_use_review:
```

## 40.8 Key / Secret Lifecycle Record

```yaml
material_id:
type:
purpose:
owner:
authority_or_property:
issuer_or_generator:
algorithm_or_protocol_if_applicable:
key_or_secret_location:
exportable:
consumers: []
access_policy:
created:
expires:
rotation_triggers: []
revocation:
recovery:
backup:
destruction:
audit_events: []
compromise_play:
verification:
```

## 40.9 Vulnerability Decision Record

```yaml
finding_id:
discovered:
source:
validity:
cve_or_advisory_if_any:
cwe_if_known:
cvss_if_available:
epss_if_available:
kev_or_known_exploitation:

affected_assets: []
affected_versions: []
actual_deployment_exposure:
attack_prerequisites:
asset_consequence:
blast_radius:
existing_controls: []
detection:
fix_or_mitigation_options: []
change_risk:

priority_band: P0|P1|P2|P3
decision:
owner:
target_or_review_date:
exception:
verification:
root_cause_prevention:
```

## 40.10 Dependency / Supplier Security Record

```yaml
dependency_or_supplier:
version_or_service:
owner:
purpose:
execution_position:
credentials_or_data_access:
transitive_dependencies:
release_identity:
provenance_or_signing:
support_status:
known_vulnerability_process:
supplier_due_diligence:
pin_or_resolution_policy:
update_policy:
incident_contact:
exit_or_replacement_path:
residual_risk:
```

## 40.11 Security Release Record

```yaml
release_id:
artifact_identity:
source_revision:
configuration_revision:
date:
owner:
criticality:
security_significant_changes: []
threat_model_delta:
security_requirements_affected: []

verification:
  code_review:
  automated_checks: []
  authz_or_isolation_tests: []
  fuzzing:
  pentest_or_redteam:
  manual_security_review:

open_findings: []
risk_acceptances: []
exposure_strategy:
detection_signals: []
containment_or_revoke:
rollback_rollforward:
post_release_security_checks: []
decision:
approved_by:
```

## 40.12 Agent Tool Security Contract

```yaml
agent_or_capability:
tool:
owner:
user_or_business_outcome:
agent_identity:
delegation_source:

inputs:
input_schema:
untrusted_input_sources: []
outputs:
output_schema:

read_scope: []
write_scope: []
external_side_effects: []
secrets_or_sensitive_data: []
resource_or_tenant_scope:
rate_budget_limits:
reversibility:
idempotency_or_effect_identity:

policy_enforcement_point:
approval_policy:
postcondition_verification:
audit_event:
kill_or_revoke:

adversarial_tests:
  - direct_prompt_injection
  - indirect_prompt_injection
  - malicious_tool_output
  - unauthorized_target
  - credential_exfiltration
  - memory_poisoning
  - duplicate_side_effect
  - policy_bypass
```

## 40.13 Security Exception / Risk Acceptance

```yaml
exception_id:
requested_by:
date:
scope:
control_or_requirement:
reason_for_exception:
risk_statement:
affected_assets:
threats:
exposure:
compensating_controls: []
verification:
residual_risk:
risk_owner:
approver:
start_date:
expiry_or_mandatory_review:
revisit_triggers: []
remediation_plan:
status:
```

Rules:

- no exception without owner;
- no indefinite exception by default;
- exception MUST NOT silently weaken an externally binding requirement;
- expiry does not automatically mean “accept again”; it means re-evaluate;
- recurring exceptions SHOULD trigger architecture/process review.

## 40.14 Security Incident Trust-Reset Record

```yaml
incident_id:
compromised_or_suspect_roots: []
credible_roots_remaining: []
credentials_to_revoke: []
artifacts_to_distrust: []
config_or_state_to_verify: []
known_clean_bootstrap:
new_identity_or_key_generation:
rebuild_or_redeploy_scope: []
independent_verification: []
reopen_criteria: []
heightened_monitoring: []
owner:
reviewer:
```

## 40.15 Security Traceability Matrix

```markdown
| ID | Threat / Requirement | Evidence / Authority | Control / Design | Implementation | Verification | Runtime Signal | Recovery | Owner | Status |
|---|---|---|---|---|---|---|---|---|---|
```

Use for C3/C4 and selected C2 work where traceability materially improves assurance.

---

# 41. Security checklists

Checklists support review. They are not substitutes for threat modeling or competence.

## 41.1 New production capability security intake

- [ ] Intended outcome and criticality known.
- [ ] Protected assets and high-value actions identified.
- [ ] Public/internal exposure identified.
- [ ] New principals/credentials/permissions identified.
- [ ] Trust boundaries identified.
- [ ] Sensitive data and tenant implications identified.
- [ ] Admin/support/recovery paths included.
- [ ] New dependencies/providers/build inputs identified.
- [ ] Upload/parser/interpreter boundaries identified.
- [ ] AI/agent tool/autonomy changes identified.
- [ ] Applicable external requirements checked.
- [ ] Security review depth selected.

## 41.2 Architecture security review

- [ ] Authority flows are explicit.
- [ ] Authentication and authorization are separated conceptually.
- [ ] Authorization enforcement points are trusted.
- [ ] Tenant/resource ownership cannot be established by client claim alone.
- [ ] Least privilege applied to human and workload identities.
- [ ] Equivalent-authority recovery/admin paths modeled.
- [ ] Secrets/keys have lifecycle/custody.
- [ ] External inputs cross validation/interpreter-safe boundaries.
- [ ] Network location is not used as sole trust.
- [ ] High-value state transitions have concurrency/replay semantics.
- [ ] Detection/containment/recovery exist for material control failure.
- [ ] Supply-chain/control-plane trust assumptions visible.
- [ ] Threat model covers technical + business abuse.
- [ ] Residual risks have owners.

## 41.3 Security-sensitive code review

- [ ] Change intent understood.
- [ ] Security invariants affected identified.
- [ ] Authorization checks use trusted principal/resource context.
- [ ] No alternate code path bypasses checks.
- [ ] Error/failure path preserves security property.
- [ ] Untrusted input validated semantically where needed.
- [ ] Safe APIs separate data from code/interpreter.
- [ ] Secrets not introduced to code/logs/tests.
- [ ] Sensitive output minimized/encoded correctly.
- [ ] Race/replay/idempotency considered for high-value mutation.
- [ ] New dependency justified.
- [ ] Negative/adversarial tests added.
- [ ] Audit event added/updated for material privileged action.
- [ ] Reviewer is independent enough for consequence.

## 41.4 Authentication checklist

- [ ] Account authority classified.
- [ ] Phishing threat assessed.
- [ ] Password rules follow current guidance if passwords used.
- [ ] MFA type/assurance is explicit, not merely “MFA.”
- [ ] Privileged/high-value access uses phishing-resistant auth where justified.
- [ ] Enrollment/binding protected.
- [ ] Recovery has equal/appropriate assurance.
- [ ] Session/token lifetime and revocation defined.
- [ ] Suspicious auth/recovery events logged.
- [ ] Accessibility and fallback do not create an uncontrolled weak path.

## 41.5 Authorization / multi-tenant checklist

- [ ] Policy expressed as principal/action/resource/context.
- [ ] Trusted tenant context source identified.
- [ ] Default behavior explicit.
- [ ] Resource ownership/relationship authoritative.
- [ ] List/search/export endpoints tested.
- [ ] Background/async paths tested.
- [ ] Admin/support bypass controlled.
- [ ] Cache/revocation semantics tested.
- [ ] Cross-tenant negative cases tested.
- [ ] Derived stores/search/vector/analytics paths covered.
- [ ] Backup/export/restore path covered where relevant.

## 41.6 Secrets / crypto checklist

- [ ] No live secret in source/client/log.
- [ ] Secret/key authority and owner known.
- [ ] Storage boundary appropriate.
- [ ] Least privilege consumers.
- [ ] Rotation and revocation defined.
- [ ] Compromise response exists.
- [ ] Recovery does not create weaker equivalent authority.
- [ ] Standard protocol/library used.
- [ ] TLS peer/identity validation correct.
- [ ] Algorithm/key lifetime/support horizon checked.
- [ ] Cryptographic claims state actual threat boundary.

## 41.7 Web/API checklist

- [ ] Server-side/trusted authorization on every material operation.
- [ ] CSRF model explicit for browser ambient credentials.
- [ ] CORS not used as authorization.
- [ ] Cookies/storage appropriate.
- [ ] Injection/interpreter boundaries handled contextually.
- [ ] Object/function/property authorization tested.
- [ ] Resource/query abuse bounded.
- [ ] Uploads/parsers constrained.
- [ ] SSRF/egress paths considered.
- [ ] Errors do not leak secrets/sensitive internals.
- [ ] Webhooks verify source/integrity/replay as required.
- [ ] Security headers/policies selected by threat, not score.

## 41.8 Infrastructure/cloud checklist

- [ ] Public exposures inventoried/owned.
- [ ] Management plane strongly protected.
- [ ] Root/owner emergency accounts protected.
- [ ] Human/workload IAM least privilege.
- [ ] Network policy reduces named attack paths.
- [ ] Metadata/workload identity endpoints protected.
- [ ] Containers/runtime capabilities minimized.
- [ ] IaC/config source controlled.
- [ ] Security drift detectable where material.
- [ ] Logs/audit enabled and protected.
- [ ] Backup/recovery plane isolated enough.
- [ ] Provider break-glass/recovery path known.

## 41.9 Supply-chain checklist

- [ ] Dependency/plugin/action/base image/model owner known.
- [ ] Version/resolution controlled.
- [ ] Known vulnerability monitoring exists.
- [ ] Build executes with minimum credentials.
- [ ] Untrusted PR/fork path cannot steal production secrets.
- [ ] Artifact immutable identity exists.
- [ ] Provenance/signing/SBOM requirements selected from threat.
- [ ] Consumer verifies required evidence.
- [ ] Artifact repository/cache trust considered.
- [ ] Supplier due diligence proportional to authority.
- [ ] Compromised-build trust reset exists.

## 41.10 Vulnerability handling checklist

- [ ] Finding validity confirmed.
- [ ] Affected versions/assets identified.
- [ ] Real deployment exposure known.
- [ ] KEV/active exploitation checked.
- [ ] CVSS and EPSS used only as appropriate inputs.
- [ ] Asset consequence/blast radius assessed.
- [ ] Mitigation vs patch decision includes change risk.
- [ ] Owner/response band assigned.
- [ ] Fix/mitigation verified.
- [ ] Exception expires/reviews if unresolved.
- [ ] Recurrence/root cause considered.
- [ ] Disclosure/reporting obligations checked.

## 41.11 AI/agent security checklist

- [ ] Model is not final authorization authority.
- [ ] Agent has attributable/scoped identity.
- [ ] Tool/resource/tenant permissions bounded.
- [ ] Prompt/retrieval/tool output treated as untrusted influence.
- [ ] High-impact action policy enforced outside model.
- [ ] Approval shows exact side effects.
- [ ] Memory write/read provenance and isolation controlled.
- [ ] RAG authorization enforced at source retrieval.
- [ ] Code/command/query output validated before execution.
- [ ] Budget/rate/step/time limits exist.
- [ ] Direct and indirect injection tested.
- [ ] Credential exfiltration/memory poisoning tested.
- [ ] Kill/revoke mechanism works outside model.
- [ ] Duplicate/retry/partial-action recovery defined.

## 41.12 Production security readiness checklist

- [ ] Security Context Record current.
- [ ] Criticality and external requirements confirmed.
- [ ] Threat model current for release.
- [ ] Material security requirements/invariants verified.
- [ ] Identity/authz/tenant tests pass.
- [ ] Secrets/key changes reviewed.
- [ ] Dependency/vulnerability findings triaged.
- [ ] Build/artifact/provenance policy satisfied.
- [ ] Security-sensitive configuration reviewed.
- [ ] Detection and audit events live.
- [ ] Incident owner/runbooks exist.
- [ ] Credential/key revocation works.
- [ ] Backup/security recovery path tested where material.
- [ ] Open security exceptions approved/time-bounded.
- [ ] Residual risk owner named.
- [ ] Post-release verification plan exists.

---

# 42. Security measurement and feedback

Metrics exist to improve decisions, not to prove security.

## 42.1 Measurement model

Use layers:

```text
READINESS
→ CONTROL IMPLEMENTATION
→ CONTROL BEHAVIOR / EFFECTIVENESS
→ ATTACK / INCIDENT OUTCOMES
→ RECOVERY / LEARNING
```

Do not collapse them into one maturity/security score.

## 42.2 Readiness signals

Examples:

- percentage of material systems with named security owner;
- percentage of C2+ systems with current threat model;
- percentage of high-value actions with explicit authorization invariant;
- percentage of critical credentials with revocation owner/play;
- supported/EOL software exposure;
- incident response/recovery exercise completion.

Coverage metrics are process indicators, not outcome proof.

## 42.3 Security defect metrics

Useful views:

- vulnerabilities by root cause/CWE class;
- recurrence rate;
- escaped-to-production security defects;
- authorization/tenant defects;
- secret leaks;
- insecure-default defects;
- dependency/supply-chain findings;
- mean/median age by response priority **with distribution**;
- percentage of exceptions past expiry;
- defect discovery phase.

Do not reward teams for creating more scanner findings or closing low-value findings while high-risk paths remain.

## 42.4 Vulnerability response metrics

Measure by meaningful priority bands:

- time to validate;
- time to containment for P0/P1;
- time to risk reduction;
- time to verified remediation;
- exceptions and age;
- recurrence/root-cause prevention;
- actively exploited exposure duration.

“MTTR for all CVEs” can hide high-risk tails and low-value churn.

## 42.5 Identity/authorization metrics

Potential signals:

- privileged accounts/workloads;
- standing vs time-bounded privilege;
- stale grants;
- failed/rejected cross-tenant authorization tests;
- account takeover incidents;
- recovery fraud;
- phishing-resistant coverage for privileged access;
- revocation latency;
- orphaned identities.

## 42.6 Secrets/key metrics

- leaked secrets discovered;
- credentials older than supported lifecycle where age matters;
- exportable vs non-exportable high-value keys;
- rotation drill success;
- revocation latency;
- orphaned credentials;
- secrets with unknown owner;
- use of long-lived CI/service credentials where federation is available and justified.

## 42.7 Supply-chain metrics

- percentage of production artifacts with immutable identity;
- provenance verification coverage where required;
- SBOM freshness/completeness indicators where SBOM is used;
- unowned dependencies;
- unsupported dependencies;
- dependency update lag by risk/support status;
- third-party build actions/plugins with privileged CI access;
- supplier incidents/exit readiness.

## 42.8 Detection metrics

Prefer:

- detection for named high-risk behaviors;
- time to detect representative simulated attacks;
- telemetry-source health;
- false-positive/alert burden;
- detection regression failures;
- investigation completeness;
- missed incident signals identified postmortem.

Do not optimize “number of alerts” or ATT&CK technique count.

## 42.9 Incident/recovery metrics

- time to contain material authority;
- time to revoke compromised credentials;
- time to establish trusted recovery state;
- recurrence;
- action-item closure **and validation**;
- recovery drill success;
- incident scope uncertainty;
- evidence gaps.

## 42.10 Secure-development metrics

Potential signals:

- security-sensitive changes receiving appropriate review;
- threat-model defects found before implementation;
- authz/tenant regression coverage;
- fuzz target effectiveness/crashes fixed;
- security defect recurrence;
- risky dependency intake;
- developer security enablement/paved-path adoption.

Do not use “security training completed” as the primary outcome metric.

## 42.11 Agentic security metrics

- unauthorized tool attempts blocked;
- high-impact actions requiring approval vs auto-executed;
- tool policy violations;
- indirect prompt-injection eval pass rates by scenario **without treating benchmark as production proof**;
- agent credential scope/age;
- failed postcondition checks;
- duplicate/compensated side effects;
- kill/revoke drill success;
- sensitive-data access volume/anomalies.

## 42.12 Metric anti-Goodhart rules

A security metric SHOULD state:

```yaml
metric:
decision_supported:
what_it_measures:
what_it_does_not_measure:
population_or_scope:
data_quality_limits:
possible_gaming:
guardrails:
review_trigger:
```

If a metric becomes a target, assume behavior will adapt around it.

---

# 43. Security governance, roles and exception management

## 43.1 Ownership model

Every material production system SHOULD identify:

- product/system owner;
- engineering owner;
- security decision owner or escalation path;
- identity/IAM owner where shared;
- key/secret owner;
- vulnerability handling owner;
- incident commander/on-call route;
- supplier/dependency owner;
- data/privacy owner as delegated to Playbook 07;
- risk-acceptance authority.

## 43.2 Security does not “own” all security

Security specialists provide expertise, independent challenge, shared controls and governance. Engineering/product/platform teams retain ownership of security properties created by their systems.

Avoid the anti-pattern:

```text
engineering builds → security receives ticket → security “approves security”
```

Prefer:

```text
shared requirements + secure platform primitives + engineering ownership
+ risk-based specialist challenge + independent assurance where needed
```

## 43.3 Decision rights

For C2+ systems define who can:

- approve new public exposure;
- grant production/admin access;
- accept a material security exception;
- release with unresolved findings;
- activate break-glass;
- declare containment complete;
- declare trust reset/recovery complete;
- rotate/revoke root/signing keys;
- disclose vulnerability/incidents externally;
- decommission security controls.

## 43.4 Exception governance

Exceptions are controlled deviations, not backdoors around the standard.

An exception MUST include:

- exact control/requirement;
- scope;
- reason;
- threat/risk;
- compensating controls;
- owner;
- approver/risk authority;
- expiry/review trigger;
- remediation or explicit long-term disposition.

## 43.5 Recurring exception rule

If the same exception repeats, investigate whether:

- control is wrong for context;
- secure path is too difficult;
- platform capability is missing;
- requirement is under-specified;
- incentives favor bypass;
- technical debt needs funded remediation.

Do not normalize repeated exception paperwork as safety.

## 43.6 Security champions / distributed capability

Security champions MAY improve local capability when:

- role is voluntary/supported;
- training and specialist escalation exist;
- champions do not become unpaid security gatekeepers;
- product teams still own outcomes;
- central security provides reusable primitives and review support.

Exact organizational model is contextual.

## 43.7 Security policy hierarchy

Keep the hierarchy knowable:

```text
EXTERNAL LAW / REGULATION / CONTRACT / CERTIFICATION
→ ORGANIZATIONAL SECURITY POLICY
→ ENGINEERING STANDARD (THIS PLAYBOOK)
→ DOMAIN / PLATFORM PROFILES
→ SYSTEM SECURITY REQUIREMENTS
→ IMPLEMENTATION / CONFIG / RUNBOOK
→ EVIDENCE
```

A lower layer may strengthen a higher-level requirement; it MUST NOT silently weaken a binding one.

---

# 44. Security traceability and assurance package

Playbook 00 requires stronger traceability at higher rigor. For C3/C4, material security claims SHOULD have no unexplained orphan state [BASE00].

## 44.1 Traceability spine

```text
ASSET / HARM
→ THREAT / EXTERNAL REQUIREMENT
→ SECURITY INVARIANT
→ CONTROL / DESIGN
→ IMPLEMENTATION
→ VERIFICATION
→ RUNTIME SIGNAL
→ RECOVERY
→ OBSERVED RESULT / INCIDENT LEARNING
```

## 44.2 Orphan conditions

Investigate:

- high-value asset with no threat analysis;
- material threat with no control;
- control with no threat/requirement;
- critical authorization rule with no enforcement owner;
- security requirement with no verification;
- detection with no response owner;
- key/credential with no revocation path;
- exception with no expiry/review;
- recovery plan with no tested bootstrap;
- source citation with superseded or draft status represented incorrectly.

## 44.3 Assurance package for C3/C4

Retain as applicable:

```text
APPROVED SECURITY SCOPE / CRITICALITY
THREAT MODEL + ASSUMPTIONS
SECURITY REQUIREMENTS / INVARIANTS
SECURITY DECISION RECORDS
CONTROL / ARCHITECTURE EVIDENCE
SECURITY-SENSITIVE REVIEW RECORDS
AUTOMATED TEST / SCAN / FUZZ EVIDENCE
PENTEST / RED TEAM / FORMAL EVIDENCE WHERE USED
VULNERABILITY / EXCEPTION RECORD
SUPPLY-CHAIN / ARTIFACT IDENTITY EVIDENCE
RELEASE RECORD
INCIDENT / RECOVERY / DRILL EVIDENCE
OPEN RESIDUAL RISKS
APPROVALS / OWNERS
MONITORING PLAN
```

## 44.4 Evidence independence

Independence can come from:

- different reviewer;
- different team;
- specialist assessor;
- deterministic test against independently defined invariant;
- different tool/method;
- external assessment;
- formal proof + independent implementation check;
- diverse model/human review in AI-assisted work.

Independence is about reducing common-mode error, not organizational theater.

## 44.5 Evidence retention

Retain evidence long enough for:

- incident investigation;
- audit/regulatory/contractual need;
- release reconstruction;
- trend/root-cause learning;
- vulnerability disclosure;
- safety/security assurance.

Do not retain sensitive evidence indefinitely without purpose. Privacy/data lifecycle rules apply.

---

# 45. Implementation and adoption model

A security standard that cannot be executed safely will produce bypasses.

## 45.1 Implementation doctrine

```text
SECURITY REQUIREMENT
→ SAFE DEFAULT / PLATFORM PRIMITIVE
→ LOW-FRICTION DEVELOPER PATH
→ AUTOMATED VERIFICATION WHERE RELIABLE
→ HUMAN JUDGMENT WHERE SEMANTICS MATTER
→ ESCALATION FOR HIGH CONSEQUENCE
→ FEEDBACK FROM INCIDENTS / EXCEPTIONS / USERS
```

## 45.2 Paved paths

Prefer reusable secure capability for recurring problems:

- authentication/session libraries;
- authorization policy helpers;
- tenant context propagation;
- secrets/workload identity;
- secure HTTP/client defaults;
- safe query/serialization APIs;
- signing/provenance verification;
- security logging helpers;
- secure upload/storage patterns;
- agent tool authorization middleware.

A paved path SHOULD make the secure choice easier **without hiding important semantics or creating a golden cage**.

## 45.3 Automation

Automate deterministic checks such as:

- secret detection;
- dependency/advisory monitoring;
- policy/config rules;
- known unsafe patterns;
- artifact/provenance verification;
- IaC exposure checks;
- selected ASVS-aligned tests;
- authorization regression tests;
- fuzzing in CI/nightly where stable.

Do not automate semantic approval of high-consequence behavior merely because a scanner/model can output a pass/fail.

## 45.4 Developer enablement

Provide:

- examples of secure patterns;
- documented security invariants;
- clear escalation route;
- threat-model facilitation;
- platform primitives;
- realistic security tests;
- concise code-review guidance;
- access to security expertise.

Training should target real tasks and recurring defect classes.

## 45.5 Rollout of this playbook

For an organization adopting Playbook 06:

1. classify systems by C0–C4;
2. inventory material production systems and owners;
3. pilot Security Context Record + Threat Model on one C2 system;
4. pilot one authz/tenant negative-test program;
5. establish vulnerability priority process with KEV/EPSS/context;
6. establish key/secret ownership and compromise play;
7. connect release process to security-significant change classification;
8. establish exception governance;
9. exercise one incident/trust-reset scenario;
10. measure bypasses/friction and simplify controls that do not improve outcomes.

## 45.6 Local adaptation

Organizations MAY adapt:

- exact tools;
- role names;
- threat-model notation;
- review workflow;
- automation platform;
- ticket/status system;
- implementation details.

They SHOULD NOT silently weaken protected invariants:

- explicit authorization;
- least privilege;
- secure defaults;
- secrets separation;
- verified high-value boundaries;
- vulnerability ownership;
- incident containment/revocation;
- recovery/trust reset;
- risk-proportionate assurance.

---

# 46. Security production-readiness gate

A C2+ production capability is security-ready only when the following questions have defensible answers.

## 46.1 Ownership / scope

- [ ] System/change and exact release identity known.
- [ ] Security owner/escalation path known.
- [ ] Criticality/risk posture selected.
- [ ] Applicable external requirements checked.

## 46.2 Assets / threats

- [ ] Protected assets/authority identified.
- [ ] Unacceptable harm identified.
- [ ] Trust boundaries/entry points known.
- [ ] Admin/support/recovery paths included.
- [ ] Threat model current enough for release.

## 46.3 Identity / authorization

- [ ] Authentication matches consequence.
- [ ] Resource/action/tenant authorization enforced at trusted boundary.
- [ ] Least privilege applied.
- [ ] Privileged paths independently reviewed where required.
- [ ] Recovery/fallback not weaker than accepted risk.

## 46.4 Data / secrets / crypto

- [ ] Sensitive data access bounded.
- [ ] Secrets/key lifecycle owned.
- [ ] No secrets leaked to source/log/client artifacts.
- [ ] Current standard protocols/libraries used.
- [ ] Key compromise/revocation path exists.

## 46.5 Input / application / abuse

- [ ] Untrusted interpreter boundaries secured.
- [ ] Business abuse/invariants tested.
- [ ] Resource abuse bounded.
- [ ] Upload/parser/SSRF paths reviewed where present.
- [ ] Error paths fail safely for context.

## 46.6 Infrastructure / supply chain

- [ ] Public exposure intentional.
- [ ] Management plane protected.
- [ ] Build/deploy authority controlled.
- [ ] Dependencies/suppliers owned.
- [ ] Artifact identity/provenance/signing requirements satisfied.

## 46.7 Verification

- [ ] Security-sensitive code/design reviewed.
- [ ] Negative authorization/tenant tests pass.
- [ ] Automated security checks triaged — no silent scanner-error-as-pass.
- [ ] Fuzzing/pentest/red team/formal evidence completed where required.
- [ ] Open findings/risks explicitly accepted or blocked.

## 46.8 Detection / incident / recovery

- [ ] Material privileged/security events observable.
- [ ] Required detections/alerts live.
- [ ] Incident owner/runbooks ready.
- [ ] Credentials/keys can be revoked.
- [ ] Recovery/trust-reset path credible and exercised where consequence warrants.

## 46.9 AI/agent if applicable

- [ ] Prompt/model not final authority.
- [ ] Tool policy enforced externally.
- [ ] Agent identity/permissions bounded.
- [ ] Direct/indirect injection and exfiltration tests executed.
- [ ] High-impact actions bounded/approved appropriately.
- [ ] Kill/revoke path tested.

## 46.10 Release decision

A release MAY proceed only when:

- no unresolved BLOCKER exists;
- MAJOR findings are remediated or explicitly accepted by the proper risk authority;
- residual risk is visible;
- monitoring/containment/recovery match the remaining uncertainty;
- evidence belongs to the artifact/configuration being released.

---
# 47. Audited evidence and source register

This register records the material sources actually used to construct and falsify this release. Inclusion does not imply equal weight. Each source is used only for claims that fit its scope.

## 47.1 Register rules

1. Primary/final standards are preferred for normative semantics and version status.
2. Government/open-consensus frameworks are used for risk/control architecture, not as proof that one implementation is universally optimal.
3. OWASP/CIS/MITRE/FIRST sources are applied security consensus, taxonomies, verification standards, or prioritization inputs; none is treated as a certification of system security.
4. Foundational research is used for durable mechanism/principle claims, not for current platform details.
5. Drafts, working drafts, and newly released emerging standards are explicitly labeled and kept out of the normative baseline unless a scoped external requirement says otherwise.
6. The parent Playbooks are `HOUSE` standards. They govern this document's evidence, rigor, lifecycle, and engineering invariants but are not external ISO/NIST standards.

## 47.2 Parent standards

### [BASE00] — Master Playbook Standard v2.0-RC1

- **Status at cutoff:** `REVIEWED`, current house standard supplied with this project.
- **Used for:** evidence architecture; `REQ/EST/DEF/CTX/EMG/HOUSE/EXP/UNK`; R1–R4 research rigor; quality gates; lifecycle/status; non-author validation; traceability; assurance package; source-status discipline.
- **Limitation:** internal playbook standard, not an external certification.
- **Canonical source:** project artifact `master_playbook_standard_v2.0.md`.

### [ENG00] — Universal Software & AI Engineering Master Playbook v2.0

- **Status at cutoff:** research/falsification-reviewed house engineering root.
- **Used for:** C0–C4 criticality; explicit state/authority/boundaries; lifecycle security; bounded failure; supply-chain assurance; verification; recovery; AI/agent constraints.
- **Limitation:** cross-domain root standard; this Security playbook provides the specialist depth.
- **Canonical source:** project artifact `universal_software_ai_engineering_master_playbook_v2.md`.

## 47.3 NIST

### [NIST01] — NIST Cybersecurity Framework 2.0

- **Status:** Final, 2024-02-26.
- **Used for:** organization-level cybersecurity outcomes, governance, identify/protect/detect/respond/recover framing, risk-management context.
- **Limitation:** outcome framework, not a product-security implementation cookbook.
- **URL:** https://www.nist.gov/cyberframework

### [NIST02] — NIST SP 800-218 — Secure Software Development Framework (SSDF) v1.1

- **Status:** Final, 2022; current final SSDF baseline at the cutoff.
- **Used for:** secure-development lifecycle outcomes, organizational preparation, software protection, well-secured software production, vulnerability response.
- **Limitation:** intentionally outcome-oriented and tailorable; does not prescribe one SDLC or toolchain.
- **URL:** https://csrc.nist.gov/pubs/sp/800/218/final

### [NIST03] — NIST SP 800-218 Rev. 1 / SSDF v1.2

- **Status:** Initial Public Draft, published 2025-12-17; not final at the cutoff.
- **Used for:** watchlist and emerging direction only.
- **Rule:** MUST NOT silently replace SSDF 1.1 as the current final baseline.
- **URL:** https://csrc.nist.gov/pubs/sp/800/218/r1/ipd

### [NIST04] — NIST SP 800-160 Vol. 1 Rev. 1 — Engineering Trustworthy Secure Systems

- **Status:** Final, 2022.
- **Used for:** systems-security engineering, trustworthiness, security throughout the engineering lifecycle, assurance and system concerns.
- **Limitation:** broad systems-engineering guidance; local/product implementation still requires a threat model.
- **URL:** https://csrc.nist.gov/pubs/sp/800/160/v1/r1/final

### [NIST05] — NIST SP 800-160 Vol. 2 Rev. 1 — Developing Cyber-Resilient Systems

- **Status:** Final, 2021.
- **Used for:** adversary-aware resilience, anticipate/withstand/recover/adapt logic, cyber-resiliency engineering.
- **Limitation:** resilience objectives are contextual; not every software component needs every technique.
- **URL:** https://csrc.nist.gov/pubs/sp/800/160/v2/r1/final

### [NIST06] — NIST SP 800-53 Rev. 5 / Release 5.2.0

- **Status:** Final control catalog; Release 5.2.0 issued 2025-08-27.
- **Used for:** broad security-control coverage, control families, software-update/patch-resiliency controls, control-assessment routing.
- **Limitation:** a control catalog and federal baseline source; this playbook does not copy it into a universal checklist.
- **URL:** https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final

### [NIST08] — NIST SP 800-63-4 family — Digital Identity Guidelines

- **Status:** Final family, 2025.
- **Used for:** digital identity architecture, identity proofing/authentication/federation concepts, assurance-level reasoning.
- **Limitation:** federal digital-identity guidance; applicability and exact assurance level are contextual outside its scope.
- **URL:** https://pages.nist.gov/800-63-4/

### [NIST09] — NIST SP 800-63B-4 — Authentication and Authenticator Management

- **Status:** Final, 2025.
- **Used for:** authenticator assurance, passwords, phishing resistance, rate limiting, recovery-related authentication controls.
- **Material falsification:** periodic password rotation and arbitrary composition rules are not retained as universal doctrine.
- **URL:** https://pages.nist.gov/800-63-4/sp800-63b.html

### [NIST10] — NIST SP 800-207 — Zero Trust Architecture

- **Status:** Final, 2020.
- **Used for:** no implicit trust from network location, resource-centric authorization, explicit authentication/authorization before access.
- **Limitation:** zero trust is a security model/principle, not a product topology or mandatory service-mesh architecture.
- **URL:** https://csrc.nist.gov/pubs/sp/800/207/final

### [NIST11] — NIST SP 800-207A — Zero Trust Architecture Model for Access Control in Cloud-Native Applications in Multi-Cloud Environments

- **Status:** Final, 2023.
- **Used for:** cloud-native identity/policy enforcement examples and access-control architecture.
- **Limitation:** cloud-native contextual guidance; not a universal requirement to adopt a specific mesh or policy engine.
- **URL:** https://csrc.nist.gov/pubs/sp/800/207/a/final

### [NIST12] — NIST SP 800-61 Rev. 3 — Incident Response Recommendations and Considerations for Cybersecurity Risk Management

- **Status:** Final, 2025-04.
- **Used for:** preparation, detection, response, recovery, integration of incident response into risk management.
- **Limitation:** organizational guidance; system-specific containment/recovery semantics still need engineering design.
- **URL:** https://csrc.nist.gov/pubs/sp/800/61/r3/final

### [NIST13] — NIST SP 800-161 Rev. 1 Update 1 — Cybersecurity Supply Chain Risk Management Practices

- **Status:** Final; update published 2024-11.
- **Used for:** supplier and supply-chain risk-management architecture.
- **Limitation:** broad C-SCRM; detailed software delivery/provenance belongs to Playbook 10.
- **URL:** https://csrc.nist.gov/pubs/sp/800/161/r1/upd1/final

### [NIST14] — NIST SP 1326 — Cybersecurity Supply Chain Risk Management: Due Diligence Assessment Quick-Start Guide

- **Status:** Final, 2026-07-08.
- **Used for:** supplier due diligence, provenance/resilience/foundational-practice assessment.
- **Limitation:** supplier assessment input; it does not make a product secure by itself.
- **URL:** https://csrc.nist.gov/pubs/sp/1326/final

### [NIST15] — NIST SP 800-57 Part 1 Rev. 5 — Recommendation for Key Management: Part 1 — General

- **Status:** Rev. 5 is final/current published baseline; Rev. 6 is an Initial Public Draft at the cutoff.
- **Used for:** cryptographic key lifecycle, protection, generation, distribution, storage, rotation/replacement, revocation/destruction principles.
- **Rule:** Rev. 6 may inform the watchlist but MUST NOT be represented as final.
- **URL:** https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final

### [NIST16] — NIST FIPS 203 / 204 / 205 — Post-Quantum Cryptography Standards

- **Status:** Final, 2024-08-13.
- **Used for:** current post-quantum algorithm standards and cryptographic-agility planning.
- **Limitation:** adoption timing and protocol integration require system-specific migration analysis.
- **URLs:** https://csrc.nist.gov/pubs/fips/203/final ; https://csrc.nist.gov/pubs/fips/204/final ; https://csrc.nist.gov/pubs/fips/205/final

### [NIST17] — NIST SP 800-228 — Guidelines for API Protection for Cloud-Native Systems

- **Status:** Final update published 2026-03-13; supersedes the original June 2025 release. REST-specific SP 800-228A remains an Initial Public Draft dated 2026-05-18.
- **Used for:** API-lifecycle threat/control analysis, incremental risk-based API protection, pre-runtime/runtime control selection.
- **Limitation:** cloud-native/API-specific guidance; the REST supplement is draft and MUST NOT be represented as final.
- **URL:** https://csrc.nist.gov/pubs/sp/800/228/upd1/final

## 47.4 CISA / US government secure-by-design guidance

### [CISA01] — CISA Secure by Design / Shifting the Balance of Cybersecurity Risk

- **Status:** Current joint guidance/initiative at cutoff.
- **Used for:** security as a core product requirement, secure defaults, manufacturer responsibility, reducing customer security burden.
- **Limitation:** voluntary/public guidance; not an independent empirical proof for every control.
- **URL:** https://www.cisa.gov/securebydesign

### [CISA02] — CISA/FBI Product Security Bad Practices

- **Status:** Updated guidance released 2025-01-17.
- **Used for:** anti-pattern falsification, hard-coded/default credentials, unsafe product-security practices, memory-safe language direction, KEV remediation emphasis.
- **Limitation:** especially oriented toward manufacturers supporting critical infrastructure; broader use is strong guidance, not universal law.
- **URL:** https://www.cisa.gov/news-events/alerts/2025/01/17/cisa-and-fbi-release-updated-guidance-product-security-bad-practices

### [CISA03] — CISA Known Exploited Vulnerabilities (KEV) Catalog

- **Status:** Continuously updated.
- **Used for:** evidence of known active exploitation and vulnerability-priority escalation.
- **Limitation:** absence from KEV does not mean safe; presence does not replace context/exposure analysis.
- **URL:** https://www.cisa.gov/known-exploited-vulnerabilities-catalog

### [CISA04] — CISA Stakeholder-Specific Vulnerability Categorization (SSVC) Guide

- **Status:** Current public guidance.
- **Used for:** decision-tree vulnerability prioritization based on exploitation, technical impact, mission prevalence, and stakeholder context.
- **Limitation:** decision aid; local risk ownership and system evidence remain required.
- **URL:** https://www.cisa.gov/resources-tools/resources/cisa-stakeholder-specific-vulnerability-categorization-ssvc

### [CISA05] — CISA/FBI/NSA et al. — The Case for Memory Safe Roadmaps

- **Status:** Published 2023-12-06; current strategic guidance.
- **Used for:** memory-safety migration/roadmap rationale for security-sensitive software.
- **Limitation:** supports a roadmap, not indiscriminate rewrite of every legacy system.
- **URL:** https://www.cisa.gov/resources-tools/resources/case-memory-safe-roadmaps

## 47.5 ISO / IEC

### [ISO01] — ISO/IEC 27001:2022 — Information security management systems — Requirements

- **Status:** Published Edition 3; Amendment 1:2024 exists.
- **Used for:** management-system risk/governance/control ownership context.
- **Limitation:** certification to an ISMS standard is not proof that a particular software product is secure.
- **URL:** https://www.iso.org/standard/27001

### [ISO02] — ISO/IEC 27002:2022 — Information security controls

- **Status:** Published Edition 3, current.
- **Used for:** broad control guidance and control-language cross-check.
- **Limitation:** control guidance requires contextual risk selection and implementation evidence.
- **URL:** https://www.iso.org/standard/75652.html

### [ISO03] — ISO/IEC 27005:2022 — Guidance on managing information security risks

- **Status:** Published Edition 4, current.
- **Used for:** information-security risk-management concepts and treatment context.
- **Limitation:** risk process guidance does not replace technical threat modeling.
- **URL:** https://www.iso.org/search.html?q=ISO%2FIEC%2027005%3A2022

### [ISO04] — ISO/IEC 27034-1:2011 — Application security — Overview and concepts

- **Status:** Published; confirmed in 2022 and current at cutoff.
- **Used for:** integrating application security into application-management processes.
- **Limitation:** older but still current conceptual standard; implementation detail is supplemented by newer OWASP/NIST sources.
- **URL:** https://www.iso.org/standard/44378.html

### [ISO05] — ISO/IEC 29147:2018 — Vulnerability disclosure

- **Status:** Published; confirmed 2024; marked “to be revised” and replacement work is under development.
- **Used for:** receiving/disclosing vulnerability reports and coordinated disclosure process.
- **Limitation:** watch active revision; do not silently cite a future edition.
- **URL:** https://www.iso.org/standard/72311.html

### [ISO06] — ISO/IEC 30111:2019 — Vulnerability handling processes

- **Status:** Published; reviewed/confirmed in 2025 and current, with revision watch.
- **Used for:** intake, triage, remediation, verification, and vulnerability handling lifecycle.
- **URL:** https://www.iso.org/standard/69725.html

### [ISO07] — ISO/IEC 15408 series:2026 — Evaluation criteria for IT security / Common Criteria

- **Status:** Parts 1–5 published in 2026; supersede the 2022 series.
- **Used for:** high-assurance product-security evaluation concepts, TOE/security target/assurance reasoning.
- **Limitation:** Common Criteria evaluation is a scoped assurance mechanism, not a universal product-security requirement.
- **Anchor URL:** https://www.iso.org/standard/15408-1

### [ISO08] — ISO/IEC 18045:2026 — Requirements and methodology for IT security evaluation

- **Status:** Published Edition 4, 2026-05; 2022 edition withdrawn.
- **Used for:** evaluator actions and evaluation-methodology context aligned with the 2026 ISO/IEC 15408 series.
- **Limitation:** specialized high-assurance evaluation; not required for ordinary SaaS.
- **URL:** https://www.iso.org/standard/18045

### [IEC01] — IEC 62443-4-1:2018 — Secure product development lifecycle requirements

- **Status:** Published final baseline; Edition 2 is under development at cutoff.
- **Used for:** secure product-development lifecycle in industrial/automation/control-system contexts and as high-assurance SDL corroboration.
- **Limitation:** domain-scoped; does not become a universal application-security certification requirement.
- **URL:** https://webstore.iec.ch/en/publication/33615

## 47.6 OWASP

### [OWASP01] — OWASP Top 10:2025

- **Status:** Current released OWASP Top 10 awareness list at cutoff.
- **Used for:** common application-risk awareness and coverage sanity check.
- **Limitation:** awareness taxonomy, not a complete security standard or verification plan.
- **URL:** https://owasp.org/Top10/2025/

### [OWASP02] — OWASP Application Security Verification Standard (ASVS) 5.0.0

- **Status:** Latest stable release at cutoff.
- **Used for:** concrete application-security requirements and verification coverage.
- **Limitation:** requirements baseline requiring tailoring; passing ASVS controls is not proof against all threats.
- **URL:** https://owasp.org/www-project-application-security-verification-standard/

### [OWASP03] — OWASP API Security Top 10 — 2023

- **Status:** Current released API risk list at cutoff.
- **Used for:** API abuse/broken authorization/resource-consumption/security-misconfiguration awareness.
- **Limitation:** risk awareness list, not a full API-security architecture.
- **URL:** https://owasp.org/API-Security/editions/2023/en/0x00-header/

### [OWASP04] — OWASP Web Security Testing Guide

- **Status:** v4.2 stable; v5.0 development at cutoff.
- **Used for:** web-application security testing coverage and methodology examples.
- **Rule:** v5 development material is not treated as the stable baseline.
- **URL:** https://owasp.org/www-project-web-security-testing-guide/

### [OWASP05] — OWASP Software Assurance Maturity Model (SAMM) 2.2.0

- **Status:** Current 2.x release at cutoff.
- **Used for:** secure-software capability/maturity assessment and improvement planning.
- **Limitation:** maturity model, not direct evidence that a particular product is secure.
- **URL:** https://owaspsamm.org/model/

### [OWASP06] — OWASP Threat Modeling Cheat Sheet / Threat Modeling Project

- **Status:** Current applied guidance.
- **Used for:** the four-question threat-model loop and method selection.
- **Material rule:** no one named threat-modeling method is universal.
- **URL:** https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html

### [OWASP07] — OWASP Top 10 for LLM / Generative AI Applications — 2026 release

- **Status:** Current 2026 applied GenAI security guidance at cutoff.
- **Used for:** prompt injection, sensitive-information disclosure, insecure output/tool interaction, excessive agency and related AI-system risks.
- **Limitation:** fast-moving applied consensus; local AI threat/eval evidence is still required.
- **URL:** https://genai.owasp.org/

### [OWASP08] — OWASP Top 10 for Agentic Applications — 2026

- **Status:** Released 2025-12-09 for the 2026 cycle.
- **Used for:** agentic risk categories across goal manipulation, tool misuse, identity/privilege, memory/context, inter-agent trust and autonomy.
- **Limitation:** applied consensus, not proof that the list is complete.
- **URL:** https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/

### [OWASP09] — OWASP Agent Control Standard (ACS)

- **Status:** Joined OWASP GenAI Security Project / published 2026-09-01; very new at cutoff.
- **Used for:** emerging runtime hooks, inspectability, traceability and policy-enforcement concepts for agents.
- **Rule:** classified `EMG`; MUST NOT be represented as mature empirical completeness or a universal protocol requirement.
- **URL:** https://genai.owasp.org/resource/agent-control-standard-acs/

## 47.7 MITRE / FIRST / CIS / SLSA

### [MITRE01] — 2025 CWE Top 25 Most Dangerous Software Weaknesses

- **Status:** 2025 release current at cutoff.
- **Used for:** weakness prevalence/impact sanity check and secure-construction education.
- **Limitation:** ranked weakness list is not a threat model and does not define local risk.
- **URL:** https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html

### [MITRE02] — MITRE CAPEC v3.9

- **Status:** Current CAPEC release used at cutoff.
- **Used for:** attack-pattern vocabulary and threat-model elicitation.
- **Limitation:** catalog coverage does not establish exploitability in a particular system.
- **URL:** https://capec.mitre.org/

### [MITRE03] — MITRE ATT&CK v19.2

- **Status:** Current ATT&CK release from 2026-08-06 at cutoff.
- **Used for:** threat-informed detection/adversary technique coverage and purple/red-team planning.
- **Limitation:** ATT&CK is a knowledge base, not a prescriptive control baseline.
- **URL:** https://attack.mitre.org/resources/updates/

### [FIRST01] — FIRST CVSS v4.0

- **Status:** Current published CVSS standard; specification document v1.2.
- **Used for:** vulnerability technical-severity characterization and structured communication.
- **Material rule:** CVSS Base score alone MUST NOT be treated as the remediation priority.
- **URL:** https://www.first.org/cvss/v4.0/

### [FIRST02] — FIRST Exploit Prediction Scoring System (EPSS), model v5

- **Status:** v5 operational from 2026-06-15.
- **Used for:** probability-oriented signal of exploitation in the next 30 days as one vulnerability-prioritization input.
- **Limitation:** prediction signal, not impact/exposure/business-risk truth and not a patch decision by itself.
- **URL:** https://www.first.org/epss/

### [CIS01] — CIS Critical Security Controls v8.1

- **Status:** Current v8.1 release at cutoff.
- **Used for:** prioritized defensive-control coverage and implementation-group context.
- **Limitation:** organization-level control set; not a substitute for product threat modeling or assurance.
- **URL:** https://www.cisecurity.org/controls/v8-1

### [SLSA01] — Supply-chain Levels for Software Artifacts (SLSA) v1.2

- **Status:** v1.2 approved/current at cutoff.
- **Used for:** software artifact/source provenance, build integrity, producer/consumer verification concepts.
- **Limitation:** provenance/integrity assurance does not prove absence of malicious or vulnerable source logic.
- **URL:** https://slsa.dev/spec/v1.2/

## 47.8 IETF / W3C protocol and authentication sources

### [IETF01] — RFC 9700 / BCP 240 — Best Current Practice for OAuth 2.0 Security

- **Status:** Final Best Current Practice, 2025.
- **Used for:** current OAuth security baseline, redirect security, PKCE, token/flow hardening and deprecated insecure patterns.
- **URL:** https://www.rfc-editor.org/info/rfc9700/

### [IETF02] — OAuth 2.1 Authorization Framework — draft-ietf-oauth-v2-1-16

- **Status:** Active Internet-Draft, updated 2026-09-02; not an RFC/final standard at cutoff.
- **Used for:** emerging consolidated direction only.
- **Rule:** final security claims anchor in RFC 9700 and other final RFCs rather than silently treating OAuth 2.1 as final.
- **URL:** https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/

### [IETF03] — RFC 9846 — Transport Layer Security (TLS) Protocol Version 1.3

- **Status:** Final RFC, 2026-07; obsoletes RFC 8446 and RFC 5246.
- **Used for:** current TLS 1.3 protocol baseline/version status.
- **Limitation:** secure deployment also depends on certificate/endpoint/configuration/application semantics.
- **URL:** https://www.rfc-editor.org/info/rfc9846/

### [IETF04] — RFC 9325 / BCP 195 — Recommendations for Secure Use of TLS and DTLS

- **Status:** Final BCP, 2022.
- **Used for:** TLS/DTLS deployment recommendations.
- **URL:** https://www.rfc-editor.org/info/rfc9325/

### [IETF05] — RFC 8725 / BCP 225 — JSON Web Token Best Current Practices

- **Status:** Final Best Current Practice, 2020.
- **Used for:** JWT algorithm verification, issuer/audience/profile separation, secure deployment of JWS/JWE/JWT-based tokens.
- **Limitation:** a BCP floor for JWT use; the enclosing OAuth/OIDC/application profile may impose stricter requirements.
- **URL:** https://www.rfc-editor.org/info/rfc8725/

### [W3C01] — Web Authentication: An API for accessing Public Key Credentials — Level 3

- **Status:** W3C Recommendation, 2026-08-25.
- **Used for:** current WebAuthn/passkey public-key credential platform standard and phishing-resistant authentication architecture.
- **Limitation:** user/account recovery, attestation policy, lifecycle and fallback paths still need system-specific design.
- **URL:** https://www.w3.org/TR/webauthn-3/

## 47.9 European regulatory overlay

### [EU01] — Regulation (EU) 2024/2847 — Cyber Resilience Act (CRA)

- **Status:** In force; Article 14 reporting obligations for actively exploited vulnerabilities/severe incidents apply from 2026-09-11; the Regulation generally applies from 2027-12-11, subject to its transitional provisions.
- **Used for:** engineering awareness of vulnerability/incident reporting, product lifecycle, vulnerability handling and regulatory review triggers for in-scope products with digital elements.
- **Limitation:** this playbook is not legal advice; applicability, roles, deadlines and conformity obligations require current qualified legal/regulatory interpretation.
- **URL:** https://eur-lex.europa.eu/eli/reg/2024/2847/oj

## 47.10 Foundational research

### [RESEARCH01] — Saltzer & Schroeder (1975), “The Protection of Information in Computer Systems”

- **Status:** Foundational peer-reviewed systems-security paper.
- **Used for:** economy of mechanism, fail-safe defaults, complete mediation, least privilege, separation of privilege, least common mechanism and psychological acceptability as enduring design mechanisms.
- **Limitation:** foundational principles require translation to modern architectures; the paper is not a current product-security standard.
- **Reference:** J. H. Saltzer and M. D. Schroeder, Proceedings of the IEEE, 63(9), 1975, DOI 10.1109/PROC.1975.9939.

### [RESEARCH02] — Newcombe et al. (2015), “How Amazon Web Services Uses Formal Methods”

- **Status:** Published industrial experience report.
- **Used for:** evidence that formal specification/model checking can expose subtle design defects in distributed/high-consequence systems.
- **Limitation:** formal methods prove/check scoped model properties under assumptions; they do not prove the specification is the right one or the deployed system perfectly matches it.
- **Reference:** Communications of the ACM 58(4), 2015.
- **URL:** https://lamport.azurewebsites.net/tla/formal-methods-amazon.pdf

---

# 48. Freshness watchlist and event-driven review triggers

Security guidance is unusually volatile at the implementation edge. Stable principles SHOULD remain stable; current standards, protocols, exploit intelligence and regulatory overlays MUST be rechecked when material.

| Watch item | Status at 2026-09-28 | Trigger / required action |
|---|---|---|
| NIST SSDF 1.2 / SP 800-218 Rev. 1 | Initial Public Draft | Re-map lifecycle controls when final publication appears; do not pre-declare new requirements final. |
| NIST SP 800-57 Part 1 Rev. 6 | Initial Public Draft | Re-evaluate key-management guidance when finalized. |
| OAuth 2.1 | Internet-Draft `-16`, 2026-09-02 | Keep RFC 9700 + final RFCs as normative baseline until OAuth 2.1 is actually published as an RFC. |
| WebAuthn Level 4 | Early/W3C work after Level 3 Recommendation | Treat only Level 3 as the current W3C Recommendation unless status changes. |
| OWASP WSTG 5.0 | Development | Keep WSTG 4.2 as stable testing-guide baseline until release. |
| OWASP Agent Control Standard | Very new, 2026-09-01 | Reassess maturity, interoperability, adoption and empirical failure modes quarterly. |
| OWASP GenAI/Agentic risk lists | FAST | Recheck at least quarterly and after major agent exploit classes/incidents. |
| IEC 62443-4-1 Edition 2 | Under development | Preserve 2018 edition as current final baseline until replacement is published. |
| ISO/IEC 29147 revision | Under development | Recheck vulnerability-disclosure process when replacement is published. |
| ISO/IEC 30111 revision | Revision watch | Recheck handling lifecycle and terminology on new edition. |
| Common Criteria / ISO/IEC 15408 + 18045 | 2026 editions now current | Remove any lingering 2022 references from implementation profiles. |
| MITRE ATT&CK | v19.2 current, agile updates introduced | Recheck before material threat-informed validation/red-team campaigns. |
| CISA KEV | Continuous | Query current catalog during vulnerability triage; never cache as a yearly static appendix. |
| EPSS | v5 from 2026-06-15 | Recheck model/version before automated prioritization thresholds. |
| SLSA | v1.2 current | Recheck on specification release; do not hard-code current track/level semantics forever. |
| NIST SP 800-53 | Release 5.2.0 current | Re-map control overlays when catalog/control release changes. |
| Post-quantum standards | FIPS 203/204/205 final; ecosystem migration active | Re-evaluate crypto inventories, hybrid migration and protocol/library support at least annually and before long-lived cryptographic commitments. |
| EU Cyber Resilience Act | Article 14 reporting live from 2026-09-11; broader application 2027-12-11 | Qualified legal/regulatory review before release/compliance claims for in-scope products; update engineering evidence package before 2027 main application. |
| Product/platform authentication standards | FAST | Recheck passkey/WebAuthn/platform authenticator and recovery semantics before material identity changes. |
| Major exploit class / ecosystem compromise | Event-driven | Immediate threat-model, exposure and control re-evaluation. |
| Security incident / near miss | Event-driven | Re-run relevant threat model/control assumptions and update playbook if a missing mechanism was systemic. |

### 48.1 Review cadence

Default:

```text
CORE PRINCIPLES           → annual + event-driven review
SECURITY STANDARD STATUS  → quarterly + event-driven review
THREAT INTELLIGENCE       → execution-time/current lookup
VULNERABILITY PRIORITY    → current evidence at each material decision
AI/AGENT SECURITY         → quarterly + major-incident/protocol-triggered review
REGULATORY OVERLAYS       → qualified current review before reliance
```

A calendar review does not replace event-driven review.

---

# 49. V2 research and assurance verdict

## 49.1 Release verdict

```text
V1 CANDIDATE
→ CURRENT-STANDARD RESEARCH
→ CONTRADICTION SEARCH
→ 45-FINDING ADVERSARIAL / FALSIFICATION AUDIT
→ MATERIAL REVISIONS
→ V2 CONTROL + DECISION + EXECUTION ARCHITECTURE
→ SOURCE-STATUS AUDIT
→ MECHANICAL QA
= PASS_WITH_MATERIAL_REVISIONS
```

No architecture-breaking blocker remains known at the evidence cutoff.

The V2 doctrine survives the falsification pass:

> **Security is the engineering discipline of keeping unacceptable authority, state, data and capability changes outside permitted boundaries — before, during and after attack — with controls and evidence proportional to consequence.**

## 49.2 Strongly retained conclusions

`HIGH confidence / broadly durable`:

- security is a lifecycle property;
- authority and protected assets must be explicit;
- trust boundaries matter more than network labels;
- secure defaults materially reduce customer/user burden;
- least privilege and complete mediation remain durable mechanisms;
- high-consequence authorization must be enforced outside untrusted clients/models;
- threat modeling should precede expensive architecture lock-in;
- privileged/recovery/support paths belong in the threat model;
- secrets/keys need full lifecycle control and revocation;
- vulnerability priority needs exploitation/exposure/impact/context, not CVSS alone;
- supply-chain evidence is multi-dimensional and must be consumer-verified where material;
- a pentest is evidence about a scope/time/model, not a secure lifecycle;
- incident response needs revocation/containment/recovery/trust-reset engineering;
- AI/agents must separate probabilistic reasoning from deterministic authorization/control;
- residual risk must remain visible.

## 49.3 Deliberately contextualized controls

These can be strong controls, but V2 rejects them as universal laws:

- MFA for every action;
- specific authentication factor or passkey mandate;
- RBAC vs ABAC/ReBAC/policy-engine choice;
- zero-trust product topology;
- WAF;
- CSP;
- service mesh/mTLS everywhere;
- HSM for every key;
- static secret rotation interval;
- manual approval;
- segregation of duties;
- memory-safe rewrite;
- SAST/DAST scanner brand or mandatory universal gate;
- penetration-test cadence;
- formal verification;
- red team;
- container/non-root requirement regardless of runtime;
- network segmentation pattern;
- universal patch SLA by CVSS band;
- fail-closed behavior without availability/safety consequence analysis.

## 49.4 Explicitly rejected doctrine

V2 rejects as unsafe or misleading universal claims:

- “inside the network means trusted”;
- “authenticated means authorized”;
- “the frontend disabled the button, so access is controlled”;
- “MFA makes account takeover solved”;
- “rotate all passwords/secrets every N days to be secure”;
- “complexity rules make passwords strong”;
- “encryption means the data is secure”;
- “signature valid means artifact authorized and safe”;
- “SBOM present means supply chain secure”;
- “CVSS Critical means patch first in every system”;
- “not in KEV means not exploited”;
- “green scanner means secure”;
- “passed pentest means secure”;
- “zero trust means deny everything or buy a specific platform”;
- “prompt instructions can secure an agent”;
- “human-in-the-loop is automatically sufficient”;
- “read-only agent tools are automatically low risk”;
- “formal proof means the whole product is secure”;
- “rollback always restores trust after compromise”;
- “security team owns security on behalf of engineering.”

## 49.5 Remaining validation debt

This artifact is `REVIEWED`, not `VALIDATED`.

Before promotion, Playbook 00 requires representative use and non-author challenge. For this security standard, the minimum validation program SHOULD include:

1. a non-author threat-model execution on an ordinary SaaS feature;
2. a non-author threat-model execution on a C2/C3 authorization or multi-tenant feature;
3. a source-to-control traceability audit on one real repository/service;
4. an authorization/tenant negative-test exercise;
5. a secrets/key compromise and revocation simulation;
6. a vulnerability-triage dry run using CVSS + KEV + EPSS + local exposure/context;
7. a supply-chain/release evidence review against a real release;
8. an incident trust-reset tabletop or game day;
9. an AI/agentic tool-authorization/red-team scenario where applicable;
10. independent qualified security review of at least one C3/R4 application;
11. closure or explicit governed acceptance of all BLOCKER/MAJOR defects discovered;
12. regression review of this playbook after the pilot findings.

A researched document is not field evidence.

---

# 50. Mechanical QA, contradiction audit and release record

The final V2 artifact received a deterministic document-QA pass after research, falsification, source-status review and execution-layer synthesis.

## 50.1 Mechanical audit result

| Check | Result |
|---|---|
| Numbered top-level sections | `0–53`, continuous |
| Golden Security Standards | `168/168`, sequential |
| Security decision frameworks | `19` |
| Security anti-patterns / rejected dogma | `40` |
| Core Security Plays | `15` |
| Compact security runbooks | `7` |
| Evidence/source IDs used | `57` |
| Evidence/source definitions present | `57` |
| Missing source definitions | `0` |
| Dead source definitions | `0` |
| Markdown code-fence markers before this text-only section | `194`, balanced |
| Unresolved drafting scaffolding | `0` |
| V1 candidate retained for falsification traceability | `PASS` |
| Explicit adversarial/falsification audit retained | `PASS` |
| V2 canonical control architecture present | `PASS` |
| Risk-tier control matrix present | `PASS` |
| Threat/control/test/recovery traceability model present | `PASS` |
| Current-vs-draft source-status discipline present | `PASS` |
| Source watchlist / event-driven review triggers present | `PASS` |
| Production-readiness gate present | `PASS` |
| Field-validation gate present | `PASS` |
| Validation debt visible | `PASS` |

Mechanical consistency can detect structural defects and evidence-definition failures. It cannot establish that the controls are sufficient for every real system; §53 remains the field-validation gate.

## 50.2 Final falsification checks

The release was re-checked specifically to ensure it does **not** silently assert that:

- one threat-modeling method or one control catalog is universally best;
- OAuth 2.1 or SSDF 1.2 is already final;
- WebAuthn Level 3 is still merely a draft;
- the 2022 Common Criteria / ISO/IEC 18045 editions remain current;
- arbitrary periodic password rotation or composition rules are universal security requirements;
- MFA is equivalent to phishing resistance;
- network location, authentication, encryption or a valid signature implies authorization;
- zero trust prescribes one topology;
- WAF, CSP, segmentation, service mesh, containers or non-root execution are universal security laws;
- an SBOM, provenance statement, SLSA posture or signature individually proves a released artifact is safe;
- CVSS Base score is remediation priority;
- absence from KEV/EPSS proves absence of exploitation;
- a scanner, pentest or red team can substitute for secure design and lifecycle ownership;
- fail-closed behavior is always safer regardless of safety/availability consequence;
- human approval automatically makes an AI/agent action safe;
- read-only agent capability is automatically low risk;
- formal verification proves the complete real product is secure;
- ordinary rollback alone restores trust after identity/build/signing/control-plane compromise.

## 50.3 Release disposition

```text
RESEARCH / CURRENT-SOURCE REVIEW      PASS
V1 CONSTRUCTION                       PASS
ADVERSARIAL / FALSIFICATION AUDIT     PASS
V2 CORRECTIVE SYNTHESIS               PASS
MECHANICAL DOCUMENT QA                PASS
NON-AUTHOR FIELD EXECUTION            PENDING
INDEPENDENT SECURITY EXPERT REVIEW    PENDING
REPRESENTATIVE IMPLEMENTATION TRIALS  PENDING

LIFECYCLE STATUS                      REVIEWED
```

No wording in this file should be interpreted as claiming ISO certification, Common Criteria evaluation, regulatory conformity, external audit approval or universal security validation.

## 50.4 Release change record

### v2.0 — 2026-09-28 — Research-Audited Golden Master / `REVIEWED`

The V2 release materially:

- recentered security on protected assets, authority, trust boundaries, unacceptable harm and verified controls;
- introduced C0–C4 assurance, 168 Golden Standards, 19 decision frameworks and 40 anti-patterns;
- added executable Plays, runbooks, templates, checklists and a production-readiness gate;
- separated authentication from resource/action/tenant authorization and recovery;
- made equivalent-authority, admin/support/break-glass and control-plane paths explicit;
- added secrets/key compromise recovery and cryptographic-agility requirements;
- made business-logic abuse, multi-tenant isolation and resource abuse first-class concerns;
- decomposed supply-chain assurance into source/dependency/builder/artifact/provenance/signing/authorization/supplier/consumer evidence;
- replaced severity-only vulnerability triage with exploitation, exposure, consequence and local context;
- added memory-safety migration as risk-driven strategy rather than rewrite dogma;
- added AI/LLM/agent control-plane security with deterministic authority outside probabilistic model output;
- separated service restoration from trust reset after compromise;
- corrected current 2026 source status across Common Criteria/ISO 18045, TLS, WebAuthn, OAuth, API protection, ATT&CK, EPSS and the EU CRA phase-in;
- retained explicit field-validation debt instead of overstating assurance.

### v1.0 candidate — 2026-09-28 — superseded inside this artifact

The V1 material in §7 is retained solely as the falsification target and audit trail. It is not the canonical operating standard.

---

# 51. One-page Golden Security Standard

```text
SECURITY ENGINEERING = CONTROLLED AUTHORITY UNDER ADVERSARIAL CONDITIONS

1. START WITH HARM, NOT CONTROLS.
   Identify unacceptable outcomes, protected assets, authority and blast radius.

2. DRAW THE REAL BOUNDARY.
   Include users, services, data, admin/support/recovery, CI/CD, suppliers,
   management planes, AI/tools and any path to equivalent authority.

3. MODEL ADVERSARIES BEFORE LOCK-IN.
   Assets → actors → entry points → trust boundaries → abuse/threat paths
   → controls → residual risk → tests.

4. MAKE AUTHORITY EXPLICIT.
   Authentication identifies; authorization decides whether this principal may
   perform this action on this resource/tenant in this context.

5. DEFAULT SAFELY.
   Minimize exposed capability, privilege, public reachability and insecure
   customer configuration. Do not make users assemble basic safety manually.

6. ENFORCE AT TRUSTED BOUNDARIES.
   Client/UI/model/prompt state may explain or propose. It is not final authority
   for consequential access or side effects.

7. CONSTRAIN PRIVILEGE AND BLAST RADIUS.
   Least privilege, bounded credentials, isolation, quotas, separation where
   justified, and explicit equivalent-authority/recovery paths.

8. TREAT SECRETS + KEYS AS AUTHORITY.
   Inventory → generate → distribute → use → store → observe → rotate/replace
   → revoke → recover → destroy. Design compromise recovery before compromise.

9. VALIDATE INTERPRETER BOUNDARIES.
   Injection/SSRF/upload/parser/deserialization/template/shell/SQL/model/tool
   boundaries require contextual encoding/validation and bounded effects.

10. DESIGN BUSINESS-LOGIC SECURITY.
    Abuse, race conditions, replay, duplicated effects, quota bypass, fraud and
    workflow manipulation are security failures even when no classic injection exists.

11. PROTECT THE DELIVERY CHAIN.
    Control source, dependencies, builders, caches, identities, artifacts,
    provenance, signatures, promotion and deployment. Verify evidence at consumption.

12. PRIORITIZE VULNERABILITIES BY REAL RISK.
    Severity + exploit evidence + reachability/exposure + asset consequence
    + compensating controls + remediation cost/urgency. CVSS alone is not the queue.

13. VERIFY CLAIMS, NOT TOOL ACTIVITY.
    Review/static/dynamic/fuzz/property/formal/pentest/red-team/runtime evidence
    are complementary. Select by failure mode and consequence.

14. ASSUME COMPROMISE CAN HAPPEN.
    Detect material security events; contain; revoke; rotate; isolate; repair;
    restore from a trustworthy path; re-establish identity/authority before closure.

15. DO NOT LET AI BECOME POLICY.
    Models may reason/propose/route. Deterministic systems own identity,
    authorization, budgets, approvals, tenant boundaries, destructive limits and kill paths.

16. SCALE ASSURANCE WITH CONSEQUENCE.
    C0 prototype ≠ C3 identity/payment/key-custody/agent control plane.
    Increase independence, traceability, adversarial testing and recovery evidence.

17. MAKE RESIDUAL RISK VISIBLE.
    A green CI/pentest/scanner/compliance badge is not zero risk.

18. KEEP CURRENT FACTS CURRENT.
    Protocols, vulnerabilities, exploit intelligence, AI threats and regulations change.
    Stable principles stay in core; volatile details live in current profiles/watchlists.

19. RECOVER TRUST, NOT JUST SERVICE.
    Availability restoration is incomplete if credentials, keys, artifacts,
    state authority or control planes remain suspect.

20. LEARN INTO THE SYSTEM.
    Incidents, near misses, exceptions and failed controls must change threat models,
    design, tests, paved paths and this standard when evidence warrants it.
```

---

# 52. Conformance and Definition of Done overlay

A team MAY claim conformance to this **house Security Engineering standard** only for a defined system/scope/version and only when the applicable controls/evidence are demonstrated. Conformance is not an ISO/NIST/OWASP certification.

## 52.1 Minimum scope record

```yaml
system_or_product:
version_or_release:
security_owner:
criticality: C0|C1|C2|C3|C4
scope:
out_of_scope:
assets:
unacceptable_harm:
trust_boundaries:
privileged_and_recovery_paths:
applicable_external_requirements: []
threat_model_ref:
control_profile_ref:
verification_evidence_ref:
open_risks: []
exceptions: []
release_decision:
review_date:
```

## 52.2 `REVIEWED` security readiness

Pass when:

- architecture/threat/control guidance has undergone competent challenge;
- source status and material claims are current enough;
- no known contradiction is hidden;
- controls are mapped to intended threats/invariants;
- material exceptions and residual risks are visible.

## 52.3 `TESTED` security readiness

Additionally pass when defined security tests/scenarios have been executed and scope/results recorded, including the applicable §53 representative negative/adversarial scenarios.

## 52.4 `VALIDATED` security readiness

Additionally pass Playbook 00's applicable Definition of Done and §53 promotion criteria, demonstrating fitness in representative real use, competent non-author execution/challenge, appropriate independent review, and closure/acceptance of material defects.

## 52.5 Non-conformance blockers

A release MUST NOT claim Security Engineering conformance when any of the following is knowingly true without an applicable higher-authority exception:

- a material protected asset/authority boundary is unknown;
- a privileged path has no owner;
- authorization depends only on untrusted client/model state;
- a high-impact secret/key cannot be revoked or recovered;
- cross-tenant/resource isolation is materially untested where applicable;
- known actively exploited exposure is ignored without explicit risk decision;
- critical build/deployment authority is uncontrolled;
- a BLOCKER security finding is unresolved;
- required incident containment/recovery authority is unavailable;
- a material security exception is invisible or ownerless;
- a draft/obsolete standard is knowingly represented as a current final requirement.

---

# 53. Validation, field-testing and status-promotion gate

This V2 has completed research construction, source-status review, mechanical QA and internal adversarial review. It has **not** completed the field-validation conditions required by Playbook 00.

The current lifecycle status therefore remains:

```text
REVIEWED
```

not `TESTED` and not `VALIDATED`.

## 53.1 Why research review is not enough

A security standard can be internally consistent, well sourced and still fail when:

- developers interpret a control differently than the author intended;
- the control conflicts with a real platform constraint;
- operators bypass the control under incident pressure;
- secure defaults create an unacceptable safety/availability failure;
- a threat-model method misses the attack path that matters;
- a checklist produces false confidence;
- evidence collection is too expensive to sustain;
- a high-assurance rule cannot be executed by a competent non-author;
- an AI/coding agent satisfies the words while defeating the control intent.

Playbook 00 therefore requires representative non-author execution and appropriate independent challenge before `VALIDATED` status [BASE00].

## 53.2 Minimum V2 field-validation suite

Before promotion to `TESTED`, execute and record at least the following representative scenarios.

### Scenario SEC-V01 — Cross-tenant authorization attempt

**Target:** a multi-tenant web/API system.

Must demonstrate:

- valid authentication but unauthorized resource access is denied;
- object, property and action authorization are independently exercised;
- administrative/support paths cannot silently bypass tenant policy;
- negative tests cover direct identifiers, guessed identifiers, stale membership and bulk operations;
- audit evidence is sufficient to reconstruct the attempt.

### Scenario SEC-V02 — Account recovery takeover attempt

**Target:** an account with material authority.

Must test:

- normal login;
- lost authenticator;
- account recovery;
- support-assisted recovery;
- factor replacement;
- session/token invalidation;
- notification/escalation.

The recovery path MUST NOT silently undercut the claimed authentication assurance.

### Scenario SEC-V03 — Secret/credential compromise

Assume one production credential is disclosed.

Must demonstrate:

- owner and blast radius can be identified;
- credential can be revoked/rotated;
- dependent systems recover safely;
- active sessions/derived credentials are considered;
- evidence can identify suspicious use;
- the system does not require an unavailable compromised component to restore trust.

### Scenario SEC-V04 — Actively exploited dependency

Select a representative deployed dependency and simulate a credible `KEV`/active-exploitation condition.

Must demonstrate:

- affected inventory can be identified;
- reachability/exposure is determined;
- business/system consequence is assessed;
- temporary mitigation and permanent remediation are distinguished;
- update safety and rollback/roll-forward constraints are considered;
- decision ownership is explicit.

### Scenario SEC-V05 — CI/build/signing compromise

Assume the ordinary build or signing path is untrusted.

Must demonstrate:

- released artifacts and affected trust roots can be bounded;
- signing validity is not confused with authorization;
- compromised evidence can be revoked/distrusted;
- a clean rebuild/re-sign/re-release path exists;
- consumers can verify the restored trust path.

### Scenario SEC-V06 — Parser/upload hostile input

Exercise malformed, oversized, nested, ambiguous and adversarial input against a parser/upload boundary.

Must demonstrate:

- resource bounds;
- safe failure;
- no interpreter escape;
- no path/metadata trust error;
- isolation/quarantine where relevant;
- fuzz/regression evidence appropriate to consequence.

### Scenario SEC-V07 — Detection and response exercise

Select one material threat from the threat model.

Must demonstrate:

- the event is observable;
- the signal reaches the right operator;
- the operator can distinguish it from ordinary failure;
- containment action is authorized and executable;
- the post-incident state can be verified.

### Scenario SEC-V08 — Break-glass under degraded control plane

Assume the normal identity/policy path is unavailable.

Must demonstrate:

- emergency access is bounded;
- use is strongly attributable;
- access expires/revokes;
- later reconciliation/audit occurs;
- the break-glass path does not become an ordinary bypass.

### Scenario SEC-V09 — Agent prompt/tool attack

For a tool-using AI/agent capability, attempt direct and indirect instruction injection plus malicious retrieved/tool content.

Must demonstrate:

- model output cannot grant itself authority;
- tool calls are independently authorized;
- high-impact action is bounded/approved as required;
- sensitive read access is scoped;
- memory/context poisoning is considered;
- kill/revoke path works.

### Scenario SEC-V10 — Secure retirement

Retire a representative credential-bearing/system capability.

Must demonstrate removal or disposition of:

- public routes;
- identities/service accounts;
- secrets/keys/certificates;
- DNS/endpoints;
- scheduled jobs/webhooks;
- storage/data according to applicable lifecycle rules;
- monitoring/alerts;
- supplier/integration access.

## 53.3 Independent review requirement

Before `VALIDATED`:

- at least one competent security reviewer who did not author this playbook SHOULD challenge the V2 control architecture;
- at least one C3-style scenario SHOULD receive independent specialist review;
- any C4 use MUST be reviewed under the applicable domain/certification standard rather than treating this playbook as sufficient authority;
- BLOCKER findings MUST be closed;
- MAJOR findings MUST be closed or explicitly accepted by the authorized risk owner under §43.

## 53.4 Promotion criteria

### `REVIEWED → TESTED`

Requires:

- defined representative scenario suite executed;
- test scope/version recorded;
- defects recorded and triaged;
- no open BLOCKER;
- regression check after material correction.

### `TESTED → VALIDATED`

Requires:

- Playbook 00 Definition of Done satisfied for this artifact;
- representative non-author execution;
- independent/domain review appropriate to risk;
- field evidence that the controls can be executed and maintained;
- implementation/adoption friction evaluated;
- material defects closed or explicitly accepted;
- owner assigned;
- ongoing review/surveillance mechanism active.

---

